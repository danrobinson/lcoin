/*!
 * mempool.js - mempool for bcoin
 * Copyright (c) 2014-2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

var _typeof2 = require('babel-runtime/helpers/typeof');

var _typeof3 = _interopRequireDefault(_typeof2);

var _keys = require('babel-runtime/core-js/object/keys');

var _keys2 = _interopRequireDefault(_keys);

var _regenerator = require('babel-runtime/regenerator');

var _regenerator2 = _interopRequireDefault(_regenerator);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var assert = require('assert');
var AsyncObject = require('../utils/asyncobject');
var common = require('../blockchain/common');
var policy = require('../protocol/policy');
var util = require('../utils/util');
var co = require('../utils/co');
var crypto = require('../crypto/crypto');
var errors = require('../protocol/errors');
var Bloom = require('../utils/bloom');
var Address = require('../primitives/address');
var Coin = require('../primitives/coin');
var Script = require('../script/script');
var Outpoint = require('../primitives/outpoint');
var TX = require('../primitives/tx');
var Coin = require('../primitives/coin');
var TXMeta = require('../primitives/txmeta');
var MempoolEntry = require('./mempoolentry');
var Network = require('../protocol/network');
var encoding = require('../utils/encoding');
var layout = require('./layout');
var LDB = require('../db/ldb');
var Fees = require('./fees');
var Map = require('../utils/map');
var CoinView = require('../coins/coinview');
var Coins = require('../coins/coins');
var Heap = require('../utils/heap');
var VerifyError = errors.VerifyError;
var VerifyResult = errors.VerifyResult;

/**
 * Represents a mempool.
 * @alias module:mempool.Mempool
 * @constructor
 * @param {Object} options
 * @param {String?} options.name - Database name.
 * @param {String?} options.location - Database file location.
 * @param {String?} options.db - Database backend (`"memory"` by default).
 * @param {Boolean?} options.limitFree
 * @param {Number?} options.limitFreeRelay
 * @param {Number?} options.maxSize - Max pool size (default ~300mb).
 * @param {Boolean?} options.relayPriority
 * @param {Boolean?} options.requireStandard
 * @param {Boolean?} options.rejectAbsurdFees
 * @param {Boolean?} options.relay
 * @property {Boolean} loaded
 * @property {Object} db
 * @property {Number} size
 * @property {Number} totalOrphans
 * @property {Lock} locker
 * @property {Number} freeCount
 * @property {Number} lastTime
 * @property {Number} maxSize
 * @property {Rate} minRelayFee
 * @emits Mempool#open
 * @emits Mempool#error
 * @emits Mempool#tx
 * @emits Mempool#add tx
 * @emits Mempool#remove tx
 */

function Mempool(options) {
  if (!(this instanceof Mempool)) return new Mempool(options);

  AsyncObject.call(this);

  this.options = new MempoolOptions(options);

  this.network = this.options.network;
  this.logger = this.options.logger.context('mempool');
  this.chain = this.options.chain;
  this.fees = this.options.fees;

  this.locker = this.chain.locker;

  this.cache = new MempoolCache(this.options);

  this.size = 0;
  this.totalOrphans = 0;
  this.totalTX = 0;
  this.freeCount = 0;
  this.lastTime = 0;
  this.lastFlush = 0;
  this.tip = this.network.genesis.hash;

  this.waiting = {};
  this.orphans = {};
  this.map = {};
  this.spents = {};
  this.rejects = new Bloom.Rolling(120000, 0.000001);

  this.coinIndex = new CoinIndex();
  this.txIndex = new TXIndex();
}

util.inherits(Mempool, AsyncObject);

/**
 * Open the chain, wait for the database to load.
 * @method
 * @alias Mempool#open
 * @returns {Promise}
 */

Mempool.prototype._open = co( /*#__PURE__*/_regenerator2.default.mark(function open() {
  var size, i, entries, entry, view, fees;
  return _regenerator2.default.wrap(function open$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:
          size = (this.options.maxSize / 1024).toFixed(2);
          _context.next = 3;
          return this.chain.open();

        case 3:
          _context.next = 5;
          return this.cache.open();

        case 5:
          if (!this.options.persistent) {
            _context.next = 28;
            break;
          }

          _context.next = 8;
          return this.cache.getEntries();

        case 8:
          entries = _context.sent;


          for (i = 0; i < entries.length; i++) {
            entry = entries[i];
            this.trackEntry(entry);
          }

          i = 0;

        case 11:
          if (!(i < entries.length)) {
            _context.next = 22;
            break;
          }

          entry = entries[i];

          this.updateAncestors(entry, addFee);

          if (!this.options.indexAddress) {
            _context.next = 19;
            break;
          }

          _context.next = 17;
          return this.getCoinView(entry.tx);

        case 17:
          view = _context.sent;

          this.indexEntry(entry, view);

        case 19:
          i++;
          _context.next = 11;
          break;

        case 22:

          this.logger.info('Loaded mempool from disk (%d entries).', entries.length);

          if (!this.fees) {
            _context.next = 28;
            break;
          }

          _context.next = 26;
          return this.cache.getFees();

        case 26:
          fees = _context.sent;


          if (fees) {
            this.fees.inject(fees);
            this.logger.info('Loaded mempool fee data (rate=%d).', this.fees.estimateFee());
          }

        case 28:

          this.tip = this.chain.tip.hash;

          this.logger.info('Mempool loaded (maxsize=%dkb).', size);

        case 30:
        case 'end':
          return _context.stop();
      }
    }
  }, open, this);
}));

/**
 * Close the chain, wait for the database to close.
 * @alias Mempool#close
 * @returns {Promise}
 */

Mempool.prototype._close = co( /*#__PURE__*/_regenerator2.default.mark(function close() {
  return _regenerator2.default.wrap(function close$(_context2) {
    while (1) {
      switch (_context2.prev = _context2.next) {
        case 0:
          _context2.next = 2;
          return this.cache.close();

        case 2:
        case 'end':
          return _context2.stop();
      }
    }
  }, close, this);
}));

/**
 * Notify the mempool that a new block has come
 * in (removes all transactions contained in the
 * block from the mempool).
 * @method
 * @param {ChainEntry} block
 * @param {TX[]} txs
 * @returns {Promise}
 */

Mempool.prototype.addBlock = co( /*#__PURE__*/_regenerator2.default.mark(function addBlock(block, txs) {
  var unlock;
  return _regenerator2.default.wrap(function addBlock$(_context3) {
    while (1) {
      switch (_context3.prev = _context3.next) {
        case 0:
          _context3.next = 2;
          return this.locker.lock();

        case 2:
          unlock = _context3.sent;
          _context3.prev = 3;
          _context3.next = 6;
          return this._addBlock(block, txs);

        case 6:
          return _context3.abrupt('return', _context3.sent);

        case 7:
          _context3.prev = 7;

          unlock();
          return _context3.finish(7);

        case 10:
        case 'end':
          return _context3.stop();
      }
    }
  }, addBlock, this, [[3,, 7, 10]]);
}));

/**
 * Notify the mempool that a new block
 * has come without a lock.
 * @private
 * @param {ChainEntry} block
 * @param {TX[]} txs
 * @returns {Promise}
 */

Mempool.prototype._addBlock = co( /*#__PURE__*/_regenerator2.default.mark(function addBlock(block, txs) {
  var i, entries, entry, tx, hash;
  return _regenerator2.default.wrap(function addBlock$(_context4) {
    while (1) {
      switch (_context4.prev = _context4.next) {
        case 0:
          if (!(this.totalTX === 0)) {
            _context4.next = 3;
            break;
          }

          this.tip = block.hash;
          return _context4.abrupt('return');

        case 3:

          entries = [];

          i = txs.length - 1;

        case 5:
          if (!(i >= 1)) {
            _context4.next = 20;
            break;
          }

          tx = txs[i];
          hash = tx.hash('hex');
          entry = this.getEntry(hash);

          if (entry) {
            _context4.next = 14;
            break;
          }

          this.removeOrphan(hash);
          this.resolveOrphans(tx);
          this.removeDoubleSpends(tx);
          return _context4.abrupt('continue', 17);

        case 14:

          this.removeEntry(entry);

          this.emit('confirmed', tx, block);

          entries.push(entry);

        case 17:
          i--;
          _context4.next = 5;
          break;

        case 20:

          // We need to reset the rejects filter periodically.
          // There may be a locktime in a TX that is now valid.
          this.rejects.reset();

          if (this.fees) {
            this.fees.processBlock(block.height, entries, this.chain.synced);
            this.cache.writeFees(this.fees);
          }

          this.cache.sync(block.hash);

          _context4.next = 25;
          return this.cache.flush();

        case 25:

          this.tip = block.hash;

          if (!(entries.length === 0)) {
            _context4.next = 28;
            break;
          }

          return _context4.abrupt('return');

        case 28:

          this.logger.debug('Removed %d txs from mempool for block %d.', entries.length, block.height);

        case 29:
        case 'end':
          return _context4.stop();
      }
    }
  }, addBlock, this);
}));

/**
 * Notify the mempool that a block has been disconnected
 * from the main chain (reinserts transactions into the mempool).
 * @method
 * @param {ChainEntry} block
 * @param {TX[]} txs
 * @returns {Promise}
 */

Mempool.prototype.removeBlock = co( /*#__PURE__*/_regenerator2.default.mark(function removeBlock(block, txs) {
  var unlock;
  return _regenerator2.default.wrap(function removeBlock$(_context5) {
    while (1) {
      switch (_context5.prev = _context5.next) {
        case 0:
          _context5.next = 2;
          return this.locker.lock();

        case 2:
          unlock = _context5.sent;
          _context5.prev = 3;
          _context5.next = 6;
          return this._removeBlock(block, txs);

        case 6:
          return _context5.abrupt('return', _context5.sent);

        case 7:
          _context5.prev = 7;

          unlock();
          return _context5.finish(7);

        case 10:
        case 'end':
          return _context5.stop();
      }
    }
  }, removeBlock, this, [[3,, 7, 10]]);
}));

/**
 * Notify the mempool that a block
 * has been disconnected without a lock.
 * @method
 * @private
 * @param {ChainEntry} block
 * @param {TX[]} txs
 * @returns {Promise}
 */

Mempool.prototype._removeBlock = co( /*#__PURE__*/_regenerator2.default.mark(function removeBlock(block, txs) {
  var total, i, tx, hash;
  return _regenerator2.default.wrap(function removeBlock$(_context6) {
    while (1) {
      switch (_context6.prev = _context6.next) {
        case 0:
          total = 0;

          if (!(this.totalTX === 0)) {
            _context6.next = 4;
            break;
          }

          this.tip = block.prevBlock;
          return _context6.abrupt('return');

        case 4:
          i = 1;

        case 5:
          if (!(i < txs.length)) {
            _context6.next = 24;
            break;
          }

          tx = txs[i];
          hash = tx.hash('hex');

          if (!this.hasEntry(hash)) {
            _context6.next = 10;
            break;
          }

          return _context6.abrupt('continue', 21);

        case 10:
          _context6.prev = 10;
          _context6.next = 13;
          return this.insertTX(tx, -1);

        case 13:
          total++;
          _context6.next = 20;
          break;

        case 16:
          _context6.prev = 16;
          _context6.t0 = _context6['catch'](10);

          this.emit('error', _context6.t0);
          return _context6.abrupt('continue', 21);

        case 20:

          this.emit('unconfirmed', tx, block);

        case 21:
          i++;
          _context6.next = 5;
          break;

        case 24:

          this.rejects.reset();

          this.cache.sync(block.prevBlock);

          _context6.next = 28;
          return this.cache.flush();

        case 28:

          this.tip = block.prevBlock;

          if (!(total === 0)) {
            _context6.next = 31;
            break;
          }

          return _context6.abrupt('return');

        case 31:

          this.logger.debug('Added %d txs back into the mempool for block %d.', total, block.height);

        case 32:
        case 'end':
          return _context6.stop();
      }
    }
  }, removeBlock, this, [[10, 16]]);
}));

/**
 * Reset the mempool.
 * @method
 * @returns {Promise}
 */

Mempool.prototype.reset = co( /*#__PURE__*/_regenerator2.default.mark(function reset() {
  var unlock;
  return _regenerator2.default.wrap(function reset$(_context7) {
    while (1) {
      switch (_context7.prev = _context7.next) {
        case 0:
          _context7.next = 2;
          return this.locker.lock();

        case 2:
          unlock = _context7.sent;
          _context7.prev = 3;
          _context7.next = 6;
          return this._reset();

        case 6:
          return _context7.abrupt('return', _context7.sent);

        case 7:
          _context7.prev = 7;

          unlock();
          return _context7.finish(7);

        case 10:
        case 'end':
          return _context7.stop();
      }
    }
  }, reset, this, [[3,, 7, 10]]);
}));

/**
 * Reset the mempool without a lock.
 * @private
 */

Mempool.prototype._reset = co( /*#__PURE__*/_regenerator2.default.mark(function reset() {
  return _regenerator2.default.wrap(function reset$(_context8) {
    while (1) {
      switch (_context8.prev = _context8.next) {
        case 0:
          this.logger.info('Mempool reset (%d txs removed).', this.totalTX);

          this.size = 0;
          this.totalOrphans = 0;
          this.totalTX = 0;

          this.waiting = {};
          this.orphans = {};
          this.map = {};
          this.spents = {};
          this.coinIndex.reset();
          this.txIndex.reset();

          this.freeCount = 0;
          this.lastTime = 0;

          if (this.fees) this.fees.reset();

          this.rejects.reset();

          if (!this.options.persistent) {
            _context8.next = 18;
            break;
          }

          _context8.next = 17;
          return this.cache.wipe();

        case 17:
          this.cache.clear();

        case 18:

          this.tip = this.chain.tip.hash;

        case 19:
        case 'end':
          return _context8.stop();
      }
    }
  }, reset, this);
}));

/**
 * Ensure the size of the mempool stays below `maxSize`.
 * Evicts entries by timestamp and cumulative fee rate.
 * @param {MempoolEntry} added
 * @returns {Promise}
 */

Mempool.prototype.limitSize = function limitSize(added) {
  var maxSize = this.options.maxSize;
  var threshold = maxSize - maxSize / 10;
  var expiryTime = this.options.expiryTime;
  var now = util.now();
  var i, queue, hashes, hash, entry, start;

  if (this.size <= maxSize) return false;

  queue = new Heap(cmpRate);
  hashes = this.getSnapshot();

  start = util.hrtime();

  for (i = 0; i < hashes.length; i++) {
    hash = hashes[i];
    entry = this.getEntry(hash);

    if (!entry) continue;

    if (this.hasDepends(entry.tx)) continue;

    if (now < entry.ts + expiryTime) {
      queue.insert(entry);
      continue;
    }

    this.logger.debug('Removing package %s from mempool (too old).', entry.txid());

    this.evictEntry(entry);
  }

  if (this.size <= threshold) return !this.hasEntry(added);

  this.logger.debug('(bench) Heap mempool traversal: %d.', util.hrtime(start));

  start = util.hrtime();

  this.logger.debug('(bench) Heap mempool queue size: %d.', queue.size());

  while (queue.size() > 0) {
    entry = queue.shift();
    hash = entry.hash('hex');

    assert(this.hasEntry(hash));

    this.logger.debug('Removing package %s from mempool (low fee).', entry.txid());

    this.evictEntry(entry);

    if (this.size <= threshold) break;
  }

  this.logger.debug('(bench) Heap mempool map removal: %d.', util.hrtime(start));

  return !this.hasEntry(added);
};

/**
 * Retrieve a transaction from the mempool.
 * @param {Hash} hash
 * @returns {TX}
 */

Mempool.prototype.getTX = function getTX(hash) {
  var entry = this.map[hash];
  if (!entry) return;
  return entry.tx;
};

/**
 * Retrieve a transaction from the mempool.
 * @param {Hash} hash
 * @returns {MempoolEntry}
 */

Mempool.prototype.getEntry = function getEntry(hash) {
  return this.map[hash];
};

/**
 * Retrieve a coin from the mempool (unspents only).
 * @param {Hash} hash
 * @param {Number} index
 * @returns {Coin}
 */

Mempool.prototype.getCoin = function getCoin(hash, index) {
  var entry = this.map[hash];

  if (!entry) return;

  if (this.isSpent(hash, index)) return;

  if (index >= entry.tx.outputs.length) return;

  return Coin.fromTX(entry.tx, index, -1);
};

/**
 * Check to see if a coin has been spent. This differs from
 * {@link ChainDB#isSpent} in that it actually maintains a
 * map of spent coins, whereas ChainDB may return `true`
 * for transaction outputs that never existed.
 * @param {Hash} hash
 * @param {Number} index
 * @returns {Boolean}
 */

Mempool.prototype.isSpent = function isSpent(hash, index) {
  var key = Outpoint.toKey(hash, index);
  return this.spents[key] != null;
};

/**
 * Get an output's spender entry.
 * @param {Hash} hash
 * @param {Number} index
 * @returns {MempoolEntry}
 */

Mempool.prototype.getSpent = function getSpent(hash, index) {
  var key = Outpoint.toKey(hash, index);
  return this.spents[key];
};

/**
 * Get an output's spender transaction.
 * @param {Hash} hash
 * @param {Number} index
 * @returns {MempoolEntry}
 */

Mempool.prototype.getSpentTX = function getSpentTX(hash, index) {
  var key = Outpoint.toKey(hash, index);
  var entry = this.spents[key];

  if (!entry) return;

  return entry.tx;
};

/**
 * Find all coins pertaining to a certain address.
 * @param {Address[]} addresses
 * @returns {Coin[]}
 */

Mempool.prototype.getCoinsByAddress = function getCoinsByAddress(addresses) {
  var coins = [];
  var i, j, coin, hash;

  if (!Array.isArray(addresses)) addresses = [addresses];

  for (i = 0; i < addresses.length; i++) {
    hash = Address.getHash(addresses[i], 'hex');
    coin = this.coinIndex.get(hash);

    for (j = 0; j < coin.length; j++) {
      coins.push(coin[j]);
    }
  }

  return coins;
};

/**
 * Find all transactions pertaining to a certain address.
 * @param {Address[]} addresses
 * @returns {TX[]}
 */

Mempool.prototype.getTXByAddress = function getTXByAddress(addresses) {
  var txs = [];
  var i, j, tx, hash;

  if (!Array.isArray(addresses)) addresses = [addresses];

  for (i = 0; i < addresses.length; i++) {
    hash = Address.getHash(addresses[i], 'hex');
    tx = this.txIndex.get(hash);

    for (j = 0; j < tx.length; j++) {
      txs.push(tx[j]);
    }
  }

  return txs;
};

/**
 * Find all transactions pertaining to a certain address.
 * @param {Address[]} addresses
 * @returns {TXMeta[]}
 */

Mempool.prototype.getMetaByAddress = function getMetaByAddress(addresses) {
  var txs = [];
  var i, j, tx, hash;

  if (!Array.isArray(addresses)) addresses = [addresses];

  for (i = 0; i < addresses.length; i++) {
    hash = Address.getHash(addresses[i], 'hex');
    tx = this.txIndex.getMeta(hash);

    for (j = 0; j < tx.length; j++) {
      txs.push(tx[j]);
    }
  }

  return txs;
};

/**
 * Retrieve a transaction from the mempool.
 * @param {Hash} hash
 * @returns {TXMeta}
 */

Mempool.prototype.getMeta = function getMeta(hash) {
  var entry = this.getEntry(hash);
  var meta;

  if (!entry) return;

  meta = TXMeta.fromTX(entry.tx);
  meta.ps = entry.ts;

  return meta;
};

/**
 * Test the mempool to see if it contains a transaction.
 * @param {Hash} hash
 * @returns {Boolean}
 */

Mempool.prototype.hasEntry = function hasEntry(hash) {
  return this.map[hash] != null;
};

/**
 * Test the mempool to see if it
 * contains a transaction or an orphan.
 * @param {Hash} hash
 * @returns {Boolean}
 */

Mempool.prototype.has = function has(hash) {
  if (this.locker.has(hash)) return true;

  if (this.hasOrphan(hash)) return true;

  return this.hasEntry(hash);
};

/**
 * Test the mempool to see if it
 * contains a transaction or an orphan.
 * @private
 * @param {Hash} hash
 * @returns {Boolean}
 */

Mempool.prototype.exists = function exists(hash) {
  if (this.locker.hasPending(hash)) return true;

  if (this.hasOrphan(hash)) return true;

  return this.hasEntry(hash);
};

/**
 * Test the mempool to see if it
 * contains a recent reject.
 * @param {Hash} hash
 * @returns {Boolean}
 */

Mempool.prototype.hasReject = function hasReject(hash) {
  return this.rejects.test(hash, 'hex');
};

/**
 * Add a transaction to the mempool. Note that this
 * will lock the mempool until the transaction is
 * fully processed.
 * @method
 * @param {TX} tx
 * @param {Number?} id
 * @returns {Promise}
 */

Mempool.prototype.addTX = co( /*#__PURE__*/_regenerator2.default.mark(function addTX(tx, id) {
  var hash, unlock;
  return _regenerator2.default.wrap(function addTX$(_context9) {
    while (1) {
      switch (_context9.prev = _context9.next) {
        case 0:
          hash = tx.hash('hex');
          _context9.next = 3;
          return this.locker.lock(hash);

        case 3:
          unlock = _context9.sent;
          _context9.prev = 4;
          _context9.next = 7;
          return this._addTX(tx, id);

        case 7:
          return _context9.abrupt('return', _context9.sent);

        case 8:
          _context9.prev = 8;

          unlock();
          return _context9.finish(8);

        case 11:
        case 'end':
          return _context9.stop();
      }
    }
  }, addTX, this, [[4,, 8, 11]]);
}));

/**
 * Add a transaction to the mempool without a lock.
 * @method
 * @private
 * @param {TX} tx
 * @param {Number?} id
 * @returns {Promise}
 */

Mempool.prototype._addTX = co( /*#__PURE__*/_regenerator2.default.mark(function _addTX(tx, id) {
  var missing;
  return _regenerator2.default.wrap(function _addTX$(_context10) {
    while (1) {
      switch (_context10.prev = _context10.next) {
        case 0:

          if (id == null) id = -1;

          _context10.prev = 1;
          _context10.next = 4;
          return this.insertTX(tx, id);

        case 4:
          missing = _context10.sent;
          _context10.next = 11;
          break;

        case 7:
          _context10.prev = 7;
          _context10.t0 = _context10['catch'](1);

          if (_context10.t0.type === 'VerifyError') {
            if (!tx.hasWitness() && !_context10.t0.malleated) this.rejects.add(tx.hash());
          }
          throw _context10.t0;

        case 11:
          if (!(util.now() - this.lastFlush > 10)) {
            _context10.next = 15;
            break;
          }

          _context10.next = 14;
          return this.cache.flush();

        case 14:
          this.lastFlush = util.now();

        case 15:
          return _context10.abrupt('return', missing);

        case 16:
        case 'end':
          return _context10.stop();
      }
    }
  }, _addTX, this, [[1, 7]]);
}));

/**
 * Add a transaction to the mempool without a lock.
 * @method
 * @private
 * @param {TX} tx
 * @param {Number?} id
 * @returns {Promise}
 */

Mempool.prototype.insertTX = co( /*#__PURE__*/_regenerator2.default.mark(function insertTX(tx, id) {
  var lockFlags, height, hash, ret, entry, view, missing;
  return _regenerator2.default.wrap(function insertTX$(_context11) {
    while (1) {
      switch (_context11.prev = _context11.next) {
        case 0:
          lockFlags = common.lockFlags.STANDARD_LOCKTIME_FLAGS;
          height = this.chain.height;
          hash = tx.hash('hex');
          ret = new VerifyResult();


          assert(!tx.mutable, 'Cannot add mutable TX to mempool.');

          // Basic sanity checks.
          // This is important because it ensures
          // other functions will be overflow safe.

          if (tx.isSane(ret)) {
            _context11.next = 7;
            break;
          }

          throw new VerifyError(tx, 'invalid', ret.reason, ret.score);

        case 7:
          if (!tx.isCoinbase()) {
            _context11.next = 9;
            break;
          }

          throw new VerifyError(tx, 'invalid', 'coinbase', 100);

        case 9:
          if (!this.options.requireStandard) {
            _context11.next = 12;
            break;
          }

          if (!(!this.chain.state.hasCSV() && tx.version >= 2)) {
            _context11.next = 12;
            break;
          }

          throw new VerifyError(tx, 'nonstandard', 'premature-version2-tx', 0);

        case 12:
          if (!(!this.chain.state.hasWitness() && !this.options.prematureWitness)) {
            _context11.next = 15;
            break;
          }

          if (!tx.hasWitness()) {
            _context11.next = 15;
            break;
          }

          throw new VerifyError(tx, 'nonstandard', 'no-witness-yet', 0, true);

        case 15:
          if (!this.options.requireStandard) {
            _context11.next = 21;
            break;
          }

          if (tx.isStandard(ret)) {
            _context11.next = 18;
            break;
          }

          throw new VerifyError(tx, 'nonstandard', ret.reason, ret.score);

        case 18:
          if (this.options.replaceByFee) {
            _context11.next = 21;
            break;
          }

          if (!tx.isRBF()) {
            _context11.next = 21;
            break;
          }

          throw new VerifyError(tx, 'nonstandard', 'replace-by-fee', 0);

        case 21:
          _context11.next = 23;
          return this.verifyFinal(tx, lockFlags);

        case 23:
          if (_context11.sent) {
            _context11.next = 25;
            break;
          }

          throw new VerifyError(tx, 'nonstandard', 'non-final', 0);

        case 25:
          if (!this.exists(hash)) {
            _context11.next = 27;
            break;
          }

          throw new VerifyError(tx, 'alreadyknown', 'txn-already-in-mempool', 0);

        case 27:
          _context11.next = 29;
          return this.chain.db.hasCoins(hash);

        case 29:
          if (!_context11.sent) {
            _context11.next = 31;
            break;
          }

          throw new VerifyError(tx, 'alreadyknown', 'txn-already-known', 0);

        case 31:
          if (!this.isDoubleSpend(tx)) {
            _context11.next = 34;
            break;
          }

          this.emit('conflict', tx);
          throw new VerifyError(tx, 'duplicate', 'bad-txns-inputs-spent', 0);

        case 34:
          _context11.next = 36;
          return this.getCoinView(tx);

        case 36:
          view = _context11.sent;


          // Find missing outpoints.
          missing = this.findMissing(tx, view);

          // Maybe store as an orphan.

          if (!missing) {
            _context11.next = 40;
            break;
          }

          return _context11.abrupt('return', this.storeOrphan(tx, missing, id));

        case 40:

          // Create a new mempool entry
          // at current chain height.
          entry = MempoolEntry.fromTX(tx, view, height);

          // Contextual verification.
          _context11.next = 43;
          return this.verify(entry, view);

        case 43:
          _context11.next = 45;
          return this.addEntry(entry, view);

        case 45:
          if (!this.limitSize(hash)) {
            _context11.next = 47;
            break;
          }

          throw new VerifyError(tx, 'insufficientfee', 'mempool full', 0);

        case 47:
          return _context11.abrupt('return', null);

        case 48:
        case 'end':
          return _context11.stop();
      }
    }
  }, insertTX, this);
}));

/**
 * Verify a transaction with mempool standards.
 * @method
 * @param {TX} tx
 * @param {CoinView} view
 * @returns {Promise}
 */

Mempool.prototype.verify = co( /*#__PURE__*/_regenerator2.default.mark(function verify(entry, view) {
  var height, lockFlags, flags, ret, tx, now, minFee, result;
  return _regenerator2.default.wrap(function verify$(_context12) {
    while (1) {
      switch (_context12.prev = _context12.next) {
        case 0:
          height = this.chain.height + 1;
          lockFlags = common.lockFlags.STANDARD_LOCKTIME_FLAGS;
          flags = Script.flags.STANDARD_VERIFY_FLAGS;
          ret = new VerifyResult();
          tx = entry.tx;
          _context12.next = 7;
          return this.verifyLocks(tx, view, lockFlags);

        case 7:
          if (_context12.sent) {
            _context12.next = 9;
            break;
          }

          throw new VerifyError(tx, 'nonstandard', 'non-BIP68-final', 0);

        case 9:
          if (!this.options.requireStandard) {
            _context12.next = 15;
            break;
          }

          if (tx.hasStandardInputs(view)) {
            _context12.next = 12;
            break;
          }

          throw new VerifyError(tx, 'nonstandard', 'bad-txns-nonstandard-inputs', 0);

        case 12:
          if (!this.chain.state.hasWitness()) {
            _context12.next = 15;
            break;
          }

          if (tx.hasStandardWitness(view)) {
            _context12.next = 15;
            break;
          }

          throw new VerifyError(tx, 'nonstandard', 'bad-witness-nonstandard', 0, true);

        case 15:
          if (!(entry.sigops > policy.MAX_TX_SIGOPS_COST)) {
            _context12.next = 17;
            break;
          }

          throw new VerifyError(tx, 'nonstandard', 'bad-txns-too-many-sigops', 0);

        case 17:

          // Make sure this guy gave a decent fee.
          minFee = policy.getMinFee(entry.size, this.options.minRelay);

          if (!(this.options.relayPriority && entry.fee < minFee)) {
            _context12.next = 21;
            break;
          }

          if (entry.isFree(height)) {
            _context12.next = 21;
            break;
          }

          throw new VerifyError(tx, 'insufficientfee', 'insufficient priority', 0);

        case 21:
          if (!(this.options.limitFree && entry.fee < minFee)) {
            _context12.next = 28;
            break;
          }

          now = util.now();

          // Use an exponentially decaying ~10-minute window.
          this.freeCount *= Math.pow(1 - 1 / 600, now - this.lastTime);
          this.lastTime = now;

          // The limitFreeRelay unit is thousand-bytes-per-minute
          // At default rate it would take over a month to fill 1GB.

          if (!(this.freeCount > this.options.limitFreeRelay * 10 * 1000)) {
            _context12.next = 27;
            break;
          }

          throw new VerifyError(tx, 'insufficientfee', 'rate limited free transaction', 0);

        case 27:

          this.freeCount += entry.size;

        case 28:
          if (!(this.options.rejectAbsurdFees && entry.fee > minFee * 10000)) {
            _context12.next = 30;
            break;
          }

          throw new VerifyError(tx, 'highfee', 'absurdly-high-fee', 0);

        case 30:
          if (!(this.countAncestors(entry) + 1 > this.options.maxAncestors)) {
            _context12.next = 32;
            break;
          }

          throw new VerifyError(tx, 'nonstandard', 'too-long-mempool-chain', 0);

        case 32:
          if (tx.checkInputs(view, height, ret)) {
            _context12.next = 34;
            break;
          }

          throw new VerifyError(tx, 'invalid', ret.reason, ret.score);

        case 34:
          _context12.prev = 34;
          _context12.next = 37;
          return this.verifyInputs(tx, view, flags);

        case 37:
          _context12.next = 58;
          break;

        case 39:
          _context12.prev = 39;
          _context12.t0 = _context12['catch'](34);

          if (!tx.hasWitness()) {
            _context12.next = 43;
            break;
          }

          throw _context12.t0;

        case 43:

          // Try without segwit and cleanstack.
          flags &= ~Script.flags.VERIFY_WITNESS;
          flags &= ~Script.flags.VERIFY_CLEANSTACK;
          _context12.next = 47;
          return this.verifyResult(tx, view, flags);

        case 47:
          result = _context12.sent;

          if (result) {
            _context12.next = 50;
            break;
          }

          throw _context12.t0;

        case 50:

          // If it succeeded, segwit may be causing the
          // failure. Try with segwit but without cleanstack.
          flags |= Script.flags.VERIFY_CLEANSTACK;
          _context12.next = 53;
          return this.verifyResult(tx, view, flags);

        case 53:
          result = _context12.sent;

          if (!result) {
            _context12.next = 56;
            break;
          }

          throw _context12.t0;

        case 56:

          // Do not insert into reject cache.
          _context12.t0.malleated = true;
          throw _context12.t0;

        case 58:
          if (!this.options.paranoidChecks) {
            _context12.next = 64;
            break;
          }

          flags = Script.flags.MANDATORY_VERIFY_FLAGS;
          _context12.next = 62;
          return this.verifyResult(tx, view, flags);

        case 62:
          result = _context12.sent;

          assert(result, 'BUG: Verify failed for mandatory but not standard.');

        case 64:
        case 'end':
          return _context12.stop();
      }
    }
  }, verify, this, [[34, 39]]);
}));

/**
 * Verify inputs, return a boolean
 * instead of an error based on success.
 * @method
 * @param {TX} tx
 * @param {CoinView} view
 * @param {VerifyFlags} flags
 * @returns {Promise}
 */

Mempool.prototype.verifyResult = co( /*#__PURE__*/_regenerator2.default.mark(function verifyResult(tx, view, flags) {
  return _regenerator2.default.wrap(function verifyResult$(_context13) {
    while (1) {
      switch (_context13.prev = _context13.next) {
        case 0:
          _context13.prev = 0;
          _context13.next = 3;
          return this.verifyInputs(tx, view, flags);

        case 3:
          _context13.next = 10;
          break;

        case 5:
          _context13.prev = 5;
          _context13.t0 = _context13['catch'](0);

          if (!(_context13.t0.type === 'VerifyError')) {
            _context13.next = 9;
            break;
          }

          return _context13.abrupt('return', false);

        case 9:
          throw _context13.t0;

        case 10:
          return _context13.abrupt('return', true);

        case 11:
        case 'end':
          return _context13.stop();
      }
    }
  }, verifyResult, this, [[0, 5]]);
}));

/**
 * Verify inputs for standard
 * _and_ mandatory flags on failure.
 * @method
 * @param {TX} tx
 * @param {CoinView} view
 * @param {VerifyFlags} flags
 * @returns {Promise}
 */

Mempool.prototype.verifyInputs = co( /*#__PURE__*/_regenerator2.default.mark(function verifyInputs(tx, view, flags) {
  return _regenerator2.default.wrap(function verifyInputs$(_context14) {
    while (1) {
      switch (_context14.prev = _context14.next) {
        case 0:
          _context14.next = 2;
          return tx.verifyAsync(view, flags);

        case 2:
          if (!_context14.sent) {
            _context14.next = 4;
            break;
          }

          return _context14.abrupt('return');

        case 4:
          if (!(flags & Script.flags.ONLY_STANDARD_VERIFY_FLAGS)) {
            _context14.next = 10;
            break;
          }

          flags &= ~Script.flags.ONLY_STANDARD_VERIFY_FLAGS;

          _context14.next = 8;
          return tx.verifyAsync(view, flags);

        case 8:
          if (!_context14.sent) {
            _context14.next = 10;
            break;
          }

          throw new VerifyError(tx, 'nonstandard', 'non-mandatory-script-verify-flag', 0);

        case 10:
          throw new VerifyError(tx, 'nonstandard', 'mandatory-script-verify-flag', 100);

        case 11:
        case 'end':
          return _context14.stop();
      }
    }
  }, verifyInputs, this);
}));

/**
 * Add a transaction to the mempool without performing any
 * validation. Note that this method does not lock the mempool
 * and may lend itself to race conditions if used unwisely.
 * This function will also resolve orphans if possible (the
 * resolved orphans _will_ be validated).
 * @method
 * @param {MempoolEntry} entry
 * @param {CoinView} view
 * @returns {Promise}
 */

Mempool.prototype.addEntry = co( /*#__PURE__*/_regenerator2.default.mark(function addEntry(entry, view) {
  var tx;
  return _regenerator2.default.wrap(function addEntry$(_context15) {
    while (1) {
      switch (_context15.prev = _context15.next) {
        case 0:
          tx = entry.tx;


          this.trackEntry(entry, view);

          this.updateAncestors(entry, addFee);

          this.emit('tx', tx, view);
          this.emit('add entry', entry);

          if (this.fees) this.fees.processTX(entry, this.chain.synced);

          this.logger.debug('Added %s to mempool (txs=%d).', tx.txid(), this.totalTX);

          this.cache.save(entry);

          _context15.next = 10;
          return this.handleOrphans(tx);

        case 10:
        case 'end':
          return _context15.stop();
      }
    }
  }, addEntry, this);
}));

/**
 * Remove a transaction from the mempool.
 * Generally only called when a new block
 * is added to the main chain.
 * @param {MempoolEntry} entry
 */

Mempool.prototype.removeEntry = function removeEntry(entry) {
  var tx = entry.tx;
  var hash = tx.hash('hex');

  this.untrackEntry(entry);

  if (this.fees) this.fees.removeTX(hash);

  this.cache.remove(tx.hash());

  this.emit('remove entry', entry);
};

/**
 * Remove a transaction from the mempool.
 * Recursively remove its spenders.
 * @param {MempoolEntry} entry
 */

Mempool.prototype.evictEntry = function evictEntry(entry) {
  this.removeSpenders(entry);
  this.updateAncestors(entry, removeFee);
  this.removeEntry(entry);
};

/**
 * Recursively remove spenders of a transaction.
 * @private
 * @param {MempoolEntry} entry
 */

Mempool.prototype.removeSpenders = function removeSpenders(entry) {
  var tx = entry.tx;
  var hash = tx.hash('hex');
  var i, spender;

  for (i = 0; i < tx.outputs.length; i++) {
    spender = this.getSpent(hash, i);

    if (!spender) continue;

    this.removeSpenders(spender);
    this.removeEntry(spender);
  }
};

/**
 * Count the highest number of
 * ancestors a transaction may have.
 * @param {MempoolEntry} entry
 * @returns {Number}
 */

Mempool.prototype.countAncestors = function countAncestors(entry) {
  return this._countAncestors(entry, 0, {}, entry, nop);
};

/**
 * Count the highest number of
 * ancestors a transaction may have.
 * Update descendant fees and size.
 * @param {MempoolEntry} entry
 * @param {Function} map
 * @returns {Number}
 */

Mempool.prototype.updateAncestors = function updateAncestors(entry, map) {
  return this._countAncestors(entry, 0, {}, entry, map);
};

/**
 * Traverse ancestors and count.
 * @private
 * @param {MempoolEntry} entry
 * @param {Number} count
 * @param {Object} set
 * @param {MempoolEntry} child
 * @param {Function} map
 * @returns {Number}
 */

Mempool.prototype._countAncestors = function countAncestors(entry, count, set, child, map) {
  var tx = entry.tx;
  var i, input, hash, parent;

  for (i = 0; i < tx.inputs.length; i++) {
    input = tx.inputs[i];
    hash = input.prevout.hash;
    parent = this.getEntry(hash);

    if (!parent) continue;

    if (set[hash]) continue;

    set[hash] = true;
    count += 1;

    map(parent, child);

    if (count > this.options.maxAncestors) break;

    count = this._countAncestors(parent, count, set, child, map);

    if (count > this.options.maxAncestors) break;
  }

  return count;
};

/**
 * Count the highest number of
 * descendants a transaction may have.
 * @param {MempoolEntry} entry
 * @returns {Number}
 */

Mempool.prototype.countDescendants = function countDescendants(entry) {
  return this._countDescendants(entry, 0, {});
};

/**
 * Count the highest number of
 * descendants a transaction may have.
 * @private
 * @param {MempoolEntry} entry
 * @param {Number} count
 * @param {Object} set
 * @returns {Number}
 */

Mempool.prototype._countDescendants = function countDescendants(entry, count, set) {
  var tx = entry.tx;
  var hash = tx.hash('hex');
  var i, child, next;

  for (i = 0; i < tx.outputs.length; i++) {
    child = this.getSpent(hash, i);

    if (!child) continue;

    next = child.hash('hex');

    if (set[next]) continue;

    set[next] = true;
    count += 1;

    count = this._countDescendants(child, count, set);
  }

  return count;
};

/**
 * Get all transaction ancestors.
 * @param {MempoolEntry} entry
 * @returns {MempoolEntry[]}
 */

Mempool.prototype.getAncestors = function getAncestors(entry) {
  return this._getAncestors(entry, [], {});
};

/**
 * Get all transaction ancestors.
 * @private
 * @param {MempoolEntry} entry
 * @param {MempoolEntry[]} entries
 * @param {Object} set
 * @returns {MempoolEntry[]}
 */

Mempool.prototype._getAncestors = function getAncestors(entry, entries, set) {
  var tx = entry.tx;
  var i, hash, input, parent;

  for (i = 0; i < tx.inputs.length; i++) {
    input = tx.inputs[i];
    hash = input.prevout.hash;
    parent = this.getEntry(hash);

    if (!parent) continue;

    if (set[hash]) continue;

    set[hash] = true;
    entries.push(parent);

    this._getAncestors(parent, entries, set);
  }

  return entries;
};

/**
 * Get all a transaction descendants.
 * @param {MempoolEntry} entry
 * @returns {MempoolEntry[]}
 */

Mempool.prototype.getDescendants = function getDescendants(entry) {
  return this._getDescendants(entry, [], {});
};

/**
 * Get all a transaction descendants.
 * @param {MempoolEntry} entry
 * @param {MempoolEntry[]} entries
 * @param {Object} set
 * @returns {MempoolEntry[]}
 */

Mempool.prototype._getDescendants = function getDescendants(entry, entries, set) {
  var tx = entry.tx;
  var hash = tx.hash('hex');
  var i, child, next;

  for (i = 0; i < tx.outputs.length; i++) {
    child = this.getSpent(hash, i);

    if (!child) continue;

    next = child.hash('hex');

    if (set[next]) continue;

    set[next] = true;
    entries.push(child);

    this._getDescendants(child, entries, set);
  }

  return entries;
};

/**
 * Find a unconfirmed transactions that
 * this transaction depends on.
 * @param {TX} tx
 * @returns {Hash[]}
 */

Mempool.prototype.getDepends = function getDepends(tx) {
  var prevout = tx.getPrevout();
  var depends = [];
  var i, hash;

  for (i = 0; i < prevout.length; i++) {
    hash = prevout[i];
    if (this.hasEntry(hash)) depends.push(hash);
  }

  return depends;
};

/**
 * Test whether a transaction has dependencies.
 * @param {TX} tx
 * @returns {Boolean}
 */

Mempool.prototype.hasDepends = function hasDepends(tx) {
  var i, input, hash;

  for (i = 0; i < tx.inputs.length; i++) {
    input = tx.inputs[i];
    hash = input.prevout.hash;
    if (this.hasEntry(hash)) return true;
  }

  return false;
};

/**
 * Return the full balance of all unspents in the mempool
 * (not very useful in practice, only used for testing).
 * @returns {Amount}
 */

Mempool.prototype.getBalance = function getBalance() {
  var hashes = this.getSnapshot();
  var total = 0;
  var i, j, tx, hash, coin;

  for (i = 0; i < hashes.length; i++) {
    hash = hashes[i];
    tx = this.getTX(hash);

    assert(tx);

    hash = tx.hash('hex');

    for (j = 0; j < tx.outputs.length; j++) {
      coin = this.getCoin(hash, j);
      if (coin) total += coin.value;
    }
  }

  return total;
};

/**
 * Retrieve _all_ transactions from the mempool.
 * @returns {TX[]}
 */

Mempool.prototype.getHistory = function getHistory() {
  var hashes = this.getSnapshot();
  var txs = [];
  var i, hash, tx;

  for (i = 0; i < hashes.length; i++) {
    hash = hashes[i];
    tx = this.getTX(hash);

    assert(tx);

    txs.push(tx);
  }

  return txs;
};

/**
 * Retrieve an orphan transaction.
 * @param {Hash} hash
 * @returns {TX}
 */

Mempool.prototype.getOrphan = function getOrphan(hash) {
  return this.orphans[hash];
};

/**
 * @param {Hash} hash
 * @returns {Boolean}
 */

Mempool.prototype.hasOrphan = function hasOrphan(hash) {
  return this.orphans[hash] != null;
};

/**
 * Store an orphaned transaction.
 * @param {TX} tx
 * @param {Hash[]} missing
 * @param {Number} id
 */

Mempool.prototype.storeOrphan = function storeOrphan(tx, missing, id) {
  var hash = tx.hash('hex');
  var i, prev;

  if (tx.getWeight() > policy.MAX_TX_WEIGHT) {
    this.logger.debug('Ignoring large orphan: %s', tx.txid());
    if (!tx.hasWitness()) this.rejects.add(tx.hash());
    return [];
  }

  for (i = 0; i < missing.length; i++) {
    prev = missing[i];
    if (this.hasReject(prev)) {
      this.logger.debug('Not storing orphan %s (rejected parents).', tx.txid());
      this.rejects.add(tx.hash());
      return [];
    }
  }

  if (this.options.maxOrphans === 0) return [];

  this.limitOrphans();

  for (i = 0; i < missing.length; i++) {
    prev = missing[i];

    if (!this.waiting[prev]) this.waiting[prev] = new Map();

    this.waiting[prev].insert(hash);
  }

  this.orphans[hash] = new Orphan(tx, missing.length, id);
  this.totalOrphans++;

  this.logger.debug('Added orphan %s to mempool.', tx.txid());

  this.emit('add orphan', tx);

  return missing;
};

/**
 * Resolve orphans and attempt to add to mempool.
 * @method
 * @param {TX} parent
 * @returns {Promise} - Returns {@link TX}[].
 */

Mempool.prototype.handleOrphans = co( /*#__PURE__*/_regenerator2.default.mark(function handleOrphans(parent) {
  var resolved, i, orphan, tx, missing;
  return _regenerator2.default.wrap(function handleOrphans$(_context16) {
    while (1) {
      switch (_context16.prev = _context16.next) {
        case 0:
          resolved = this.resolveOrphans(parent);
          i = 0;

        case 2:
          if (!(i < resolved.length)) {
            _context16.next = 31;
            break;
          }

          orphan = resolved[i];

          _context16.prev = 4;

          tx = orphan.toTX();
          _context16.next = 12;
          break;

        case 8:
          _context16.prev = 8;
          _context16.t0 = _context16['catch'](4);

          this.logger.warning('%s %s', 'Warning: possible memory corruption.', 'Orphan failed deserialization.');
          return _context16.abrupt('continue', 28);

        case 12:
          _context16.prev = 12;
          _context16.next = 15;
          return this.insertTX(tx, -1);

        case 15:
          missing = _context16.sent;
          _context16.next = 26;
          break;

        case 18:
          _context16.prev = 18;
          _context16.t1 = _context16['catch'](12);

          if (!(_context16.t1.type === 'VerifyError')) {
            _context16.next = 25;
            break;
          }

          this.logger.debug('Could not resolve orphan %s: %s.', tx.txid(), _context16.t1.message);

          if (!tx.hasWitness() && !_context16.t1.malleated) this.rejects.add(tx.hash());

          this.emit('bad orphan', _context16.t1, orphan.id);

          return _context16.abrupt('continue', 28);

        case 25:
          throw _context16.t1;

        case 26:

          assert(!missing);

          this.logger.debug('Resolved orphan %s in mempool.', tx.txid());

        case 28:
          i++;
          _context16.next = 2;
          break;

        case 31:
        case 'end':
          return _context16.stop();
      }
    }
  }, handleOrphans, this, [[4, 8], [12, 18]]);
}));

/**
 * Potentially resolve any transactions
 * that redeem the passed-in transaction.
 * Deletes all orphan entries and
 * returns orphan objects.
 * @param {TX} parent
 * @returns {Orphan[]}
 */

Mempool.prototype.resolveOrphans = function resolveOrphans(parent) {
  var hash = parent.hash('hex');
  var map = this.waiting[hash];
  var resolved = [];
  var i, hashes, orphanHash, orphan;

  if (!map) return resolved;

  hashes = map.keys();
  assert(hashes.length > 0);

  for (i = 0; i < hashes.length; i++) {
    orphanHash = hashes[i];
    orphan = this.getOrphan(orphanHash);

    assert(orphan);

    if (--orphan.missing === 0) {
      delete this.orphans[orphanHash];
      this.totalOrphans--;
      resolved.push(orphan);
    }
  }

  delete this.waiting[hash];

  return resolved;
};

/**
 * Remove a transaction from the mempool.
 * @param {Hash} tx
 * @returns {Boolean}
 */

Mempool.prototype.removeOrphan = function removeOrphan(hash) {
  var orphan = this.getOrphan(hash);
  var i, tx, map, prevout, prev;

  if (!orphan) return false;

  try {
    tx = orphan.toTX();
  } catch (e) {
    delete this.orphans[hash];
    this.totalOrphans--;
    this.logger.warning('%s %s', 'Warning: possible memory corruption.', 'Orphan failed deserialization.');
    return;
  }

  prevout = tx.getPrevout();

  for (i = 0; i < prevout.length; i++) {
    prev = prevout[i];
    map = this.waiting[prev];

    if (!map) continue;

    assert(map.has(hash));

    map.remove(hash);

    if (map.size === 0) delete this.waiting[prev];
  }

  delete this.orphans[hash];
  this.totalOrphans--;

  this.emit('remove orphan', tx);

  return true;
};

/**
 * Remove a random orphan transaction from the mempool.
 * @returns {Boolean}
 */

Mempool.prototype.limitOrphans = function limitOrphans() {
  var hashes = (0, _keys2.default)(this.orphans);
  var index, hash;

  if (this.totalOrphans < this.options.maxOrphans) return false;

  index = crypto.randomRange(0, hashes.length);
  hash = hashes[index];

  this.logger.debug('Removing orphan %s from mempool.', util.revHex(hash));

  this.removeOrphan(hash);

  return true;
};

/**
 * Test all of a transactions outpoints to see if they are doublespends.
 * Note that this will only test against the mempool spents, not the
 * blockchain's. The blockchain spents are not checked against because
 * the blockchain does not maintain a spent list. The transaction will
 * be seen as an orphan rather than a double spend.
 * @param {TX} tx
 * @returns {Promise} - Returns Boolean.
 */

Mempool.prototype.isDoubleSpend = function isDoubleSpend(tx) {
  var i, input, prevout;

  for (i = 0; i < tx.inputs.length; i++) {
    input = tx.inputs[i];
    prevout = input.prevout;
    if (this.isSpent(prevout.hash, prevout.index)) return true;
  }

  return false;
};

/**
 * Get coin viewpoint (lock).
 * @method
 * @param {TX} tx
 * @returns {Promise} - Returns {@link CoinView}.
 */

Mempool.prototype.getSpentView = co( /*#__PURE__*/_regenerator2.default.mark(function getSpentView(tx) {
  var unlock;
  return _regenerator2.default.wrap(function getSpentView$(_context17) {
    while (1) {
      switch (_context17.prev = _context17.next) {
        case 0:
          _context17.next = 2;
          return this.locker.lock();

        case 2:
          unlock = _context17.sent;
          _context17.prev = 3;
          _context17.next = 6;
          return this.getCoinView(tx);

        case 6:
          return _context17.abrupt('return', _context17.sent);

        case 7:
          _context17.prev = 7;

          unlock();
          return _context17.finish(7);

        case 10:
        case 'end':
          return _context17.stop();
      }
    }
  }, getSpentView, this, [[3,, 7, 10]]);
}));

/**
 * Get coin viewpoint (no lock).
 * @method
 * @param {TX} tx
 * @returns {Promise} - Returns {@link CoinView}.
 */

Mempool.prototype.getCoinView = co( /*#__PURE__*/_regenerator2.default.mark(function getCoinView(tx) {
  var view, prevout, i, hash, entry, coins;
  return _regenerator2.default.wrap(function getCoinView$(_context18) {
    while (1) {
      switch (_context18.prev = _context18.next) {
        case 0:
          view = new CoinView();
          prevout = tx.getPrevout();
          i = 0;

        case 3:
          if (!(i < prevout.length)) {
            _context18.next = 21;
            break;
          }

          hash = prevout[i];
          entry = this.getEntry(hash);

          if (!entry) {
            _context18.next = 9;
            break;
          }

          view.addTX(entry.tx, -1);
          return _context18.abrupt('continue', 18);

        case 9:
          _context18.next = 11;
          return this.chain.db.getCoins(hash);

        case 11:
          coins = _context18.sent;

          if (coins) {
            _context18.next = 17;
            break;
          }

          coins = new Coins();
          coins.hash = hash;
          view.add(coins);
          return _context18.abrupt('continue', 18);

        case 17:

          view.add(coins);

        case 18:
          i++;
          _context18.next = 3;
          break;

        case 21:
          return _context18.abrupt('return', view);

        case 22:
        case 'end':
          return _context18.stop();
      }
    }
  }, getCoinView, this);
}));

/**
 * Find missing outpoints.
 * @param {TX} tx
 * @param {CoinView} view
 * @returns {Hash[]}
 */

Mempool.prototype.findMissing = function findMissing(tx, view) {
  var missing = [];
  var i, input;

  for (i = 0; i < tx.inputs.length; i++) {
    input = tx.inputs[i];

    if (view.hasEntry(input)) continue;

    missing.push(input.prevout.hash);
  }

  if (missing.length === 0) return;

  return missing;
};

/**
 * Get a snapshot of all transaction hashes in the mempool. Used
 * for generating INV packets in response to MEMPOOL packets.
 * @returns {Hash[]}
 */

Mempool.prototype.getSnapshot = function getSnapshot() {
  return (0, _keys2.default)(this.map);
};

/**
 * Check sequence locks on a transaction against the current tip.
 * @param {TX} tx
 * @param {CoinView} view
 * @param {LockFlags} flags
 * @returns {Promise} - Returns Boolean.
 */

Mempool.prototype.verifyLocks = function verifyLocks(tx, view, flags) {
  return this.chain.verifyLocks(this.chain.tip, tx, view, flags);
};

/**
 * Check locktime on a transaction against the current tip.
 * @param {TX} tx
 * @param {LockFlags} flags
 * @returns {Promise} - Returns Boolean.
 */

Mempool.prototype.verifyFinal = function verifyFinal(tx, flags) {
  return this.chain.verifyFinal(this.chain.tip, tx, flags);
};

/**
 * Map a transaction to the mempool.
 * @private
 * @param {MempoolEntry} entry
 * @param {CoinView} view
 */

Mempool.prototype.trackEntry = function trackEntry(entry, view) {
  var tx = entry.tx;
  var hash = tx.hash('hex');
  var i, input, key;

  assert(!this.map[hash]);
  this.map[hash] = entry;

  assert(!tx.isCoinbase());

  for (i = 0; i < tx.inputs.length; i++) {
    input = tx.inputs[i];
    key = input.prevout.toKey();
    this.spents[key] = entry;
  }

  if (this.options.indexAddress && view) this.indexEntry(entry, view);

  this.size += entry.memUsage();
  this.totalTX++;
};

/**
 * Unmap a transaction from the mempool.
 * @private
 * @param {MempoolEntry} entry
 */

Mempool.prototype.untrackEntry = function untrackEntry(entry) {
  var tx = entry.tx;
  var hash = tx.hash('hex');
  var i, input, key;

  assert(this.map[hash]);
  delete this.map[hash];

  assert(!tx.isCoinbase());

  for (i = 0; i < tx.inputs.length; i++) {
    input = tx.inputs[i];
    key = input.prevout.toKey();
    delete this.spents[key];
  }

  if (this.options.indexAddress) this.unindexEntry(entry);

  this.size -= entry.memUsage();
  this.totalTX--;
};

/**
 * Index an entry by address.
 * @private
 * @param {MempoolEntry} entry
 * @param {CoinView} view
 */

Mempool.prototype.indexEntry = function indexEntry(entry, view) {
  var tx = entry.tx;
  var i, input, prev;

  this.txIndex.insert(entry, view);

  for (i = 0; i < tx.inputs.length; i++) {
    input = tx.inputs[i];
    prev = input.prevout;
    this.coinIndex.remove(prev.hash, prev.index);
  }

  for (i = 0; i < tx.outputs.length; i++) {
    this.coinIndex.insert(tx, i);
  }
};

/**
 * Unindex an entry by address.
 * @private
 * @param {MempoolEntry} entry
 */

Mempool.prototype.unindexEntry = function unindexEntry(entry) {
  var tx = entry.tx;
  var hash = tx.hash('hex');
  var i, input, prevout, prev;

  this.txIndex.remove(hash);

  for (i = 0; i < tx.inputs.length; i++) {
    input = tx.inputs[i];
    prevout = input.prevout.hash;
    prev = this.getTX(prevout.hash);

    if (!prev) continue;

    this.coinIndex.insert(prev, prevout.index);
  }

  for (i = 0; i < tx.outputs.length; i++) {
    this.coinIndex.remove(hash, i);
  }
};

/**
 * Recursively remove double spenders
 * of a mined transaction's outpoints.
 * @private
 * @param {TX} tx
 */

Mempool.prototype.removeDoubleSpends = function removeDoubleSpends(tx) {
  var i, input, prevout, spent;

  for (i = 0; i < tx.inputs.length; i++) {
    input = tx.inputs[i];
    prevout = input.prevout;
    spent = this.getSpent(prevout.hash, prevout.index);

    if (!spent) continue;

    this.logger.debug('Removing double spender from mempool: %s.', spent.txid());

    this.evictEntry(spent);

    this.emit('double spend', spent);
  }
};

/**
 * Calculate the memory usage of the entire mempool.
 * @see DynamicMemoryUsage()
 * @returns {Number} Usage in bytes.
 */

Mempool.prototype.getSize = function getSize() {
  return this.size;
};

/**
 * Prioritise transaction.
 * @param {MempoolEntry} entry
 * @param {Number} pri
 * @param {Amount} fee
 */

Mempool.prototype.prioritise = function _prioritise(entry, pri, fee) {
  if (-pri > entry.priority) pri = -entry.priority;

  entry.priority += pri;

  if (-fee > entry.deltaFee) fee = -entry.deltaFee;

  if (fee === 0) return;

  this.updateAncestors(entry, preprioritise);

  entry.deltaFee += fee;
  entry.descFee += fee;

  this.updateAncestors(entry, prioritise);
};

/**
 * MempoolOptions
 * @alias module:mempool.MempoolOptions
 * @constructor
 * @param {Object}
 */

function MempoolOptions(options) {
  if (!(this instanceof MempoolOptions)) return new MempoolOptions(options);

  this.network = Network.primary;
  this.chain = null;
  this.logger = null;
  this.fees = null;

  this.limitFree = true;
  this.limitFreeRelay = 15;
  this.relayPriority = true;
  this.requireStandard = this.network.requireStandard;
  this.rejectAbsurdFees = true;
  this.prematureWitness = false;
  this.paranoidChecks = false;
  this.replaceByFee = false;

  this.maxSize = policy.MEMPOOL_MAX_SIZE;
  this.maxOrphans = policy.MEMPOOL_MAX_ORPHANS;
  this.maxAncestors = policy.MEMPOOL_MAX_ANCESTORS;
  this.expiryTime = policy.MEMPOOL_EXPIRY_TIME;
  this.minRelay = this.network.minRelay;

  this.prefix = null;
  this.location = null;
  this.db = 'memory';
  this.maxFiles = 64;
  this.cacheSize = 32 << 20;
  this.compression = true;
  this.bufferKeys = layout.binary;

  this.persistent = false;

  this.fromOptions(options);
}

/**
 * Inject properties from object.
 * @private
 * @param {Object} options
 * @returns {MempoolOptions}
 */

MempoolOptions.prototype.fromOptions = function fromOptions(options) {
  assert(options, 'Mempool requires options.');
  assert(options.chain && (0, _typeof3.default)(options.chain) === 'object', 'Mempool requires a blockchain.');

  this.chain = options.chain;
  this.network = options.chain.network;
  this.logger = options.chain.logger;

  this.requireStandard = this.network.requireStandard;
  this.minRelay = this.network.minRelay;

  if (options.logger != null) {
    assert((0, _typeof3.default)(options.logger) === 'object');
    this.logger = options.logger;
  }

  if (options.fees != null) {
    assert((0, _typeof3.default)(options.fees) === 'object');
    this.fees = options.fees;
  }

  if (options.limitFree != null) {
    assert(typeof options.limitFree === 'boolean');
    this.limitFree = options.limitFree;
  }

  if (options.limitFreeRelay != null) {
    assert(util.isUInt32(options.limitFreeRelay));
    this.limitFreeRelay = options.limitFreeRelay;
  }

  if (options.relayPriority != null) {
    assert(typeof options.relayPriority === 'boolean');
    this.relayPriority = options.relayPriority;
  }

  if (options.requireStandard != null) {
    assert(typeof options.requireStandard === 'boolean');
    this.requireStandard = options.requireStandard;
  }

  if (options.rejectAbsurdFees != null) {
    assert(typeof options.rejectAbsurdFees === 'boolean');
    this.rejectAbsurdFees = options.rejectAbsurdFees;
  }

  if (options.prematureWitness != null) {
    assert(typeof options.prematureWitness === 'boolean');
    this.prematureWitness = options.prematureWitness;
  }

  if (options.paranoidChecks != null) {
    assert(typeof options.paranoidChecks === 'boolean');
    this.paranoidChecks = options.paranoidChecks;
  }

  if (options.replaceByFee != null) {
    assert(typeof options.replaceByFee === 'boolean');
    this.replaceByFee = options.replaceByFee;
  }

  if (options.maxSize != null) {
    assert(util.isUInt53(options.maxSize));
    this.maxSize = options.maxSize;
  }

  if (options.maxOrphans != null) {
    assert(util.isUInt32(options.maxOrphans));
    this.maxOrphans = options.maxOrphans;
  }

  if (options.maxAncestors != null) {
    assert(util.isUInt32(options.maxAncestors));
    this.maxAncestors = options.maxAncestors;
  }

  if (options.expiryTime != null) {
    assert(util.isUInt32(options.expiryTime));
    this.expiryTime = options.expiryTime;
  }

  if (options.minRelay != null) {
    assert(util.isUint53(options.minRelay));
    this.minRelay = options.minRelay;
  }

  if (options.prefix != null) {
    assert(typeof options.prefix === 'string');
    this.prefix = options.prefix;
    this.location = this.prefix + '/mempool';
  }

  if (options.location != null) {
    assert(typeof options.location === 'string');
    this.location = options.location;
  }

  if (options.db != null) {
    assert(typeof options.db === 'string');
    this.db = options.db;
  }

  if (options.maxFiles != null) {
    assert(util.isUInt32(options.maxFiles));
    this.maxFiles = options.maxFiles;
  }

  if (options.cacheSize != null) {
    assert(util.isUInt53(options.cacheSize));
    this.cacheSize = options.cacheSize;
  }

  if (options.compression != null) {
    assert(typeof options.compression === 'boolean');
    this.compression = options.compression;
  }

  if (options.persistent != null) {
    assert(typeof options.persistent === 'boolean');
    this.persistent = options.persistent;
  }

  if (options.indexAddress != null) {
    assert(typeof options.indexAddress === 'boolean');
    this.indexAddress = options.indexAddress;
  }

  return this;
};

/**
 * Instantiate mempool options from object.
 * @param {Object} options
 * @returns {MempoolOptions}
 */

MempoolOptions.fromOptions = function fromOptions(options) {
  return new MempoolOptions().fromOptions(options);
};

/**
 * TX Address Index
 * @constructor
 * @ignore
 */

function TXIndex() {
  // Map of addr->entries.
  this.index = {};

  // Map of txid->addrs.
  this.map = {};
}

TXIndex.prototype.reset = function reset() {
  this.index = {};
  this.map = {};
};

TXIndex.prototype.get = function get(addr) {
  var items = this.index[addr];
  var out = [];
  var i, keys, entry;

  if (!items) return out;

  keys = items.keys();

  for (i = 0; i < keys.length; i++) {
    entry = items.get(keys[i]);
    out.push(entry.tx);
  }

  return out;
};

TXIndex.prototype.getMeta = function getMeta(addr) {
  var items = this.index[addr];
  var out = [];
  var i, entry, keys, meta;

  if (!items) return out;

  keys = items.keys();

  for (i = 0; i < keys.length; i++) {
    entry = items.get(keys[i]);
    meta = TXMeta.fromTX(entry.tx);
    meta.ps = entry.ts;
    out.push(meta);
  }

  return out;
};

TXIndex.prototype.insert = function insert(entry, view) {
  var tx = entry.tx;
  var hash = tx.hash('hex');
  var addrs = tx.getHashes(view, 'hex');
  var i, addr, items;

  if (addrs.length === 0) return;

  for (i = 0; i < addrs.length; i++) {
    addr = addrs[i];
    items = this.index[addr];

    if (!items) {
      items = new Map();
      this.index[addr] = items;
    }

    assert(!items.has(hash));
    items.set(hash, entry);
  }

  this.map[hash] = addrs;
};

TXIndex.prototype.remove = function remove(hash) {
  var addrs = this.map[hash];
  var i, addr, items;

  if (!addrs) return;

  for (i = 0; i < addrs.length; i++) {
    addr = addrs[i];
    items = this.index[addr];

    assert(items);
    assert(items.has(hash));

    items.remove(hash);

    if (items.size === 0) delete this.index[addr];
  }

  delete this.map[hash];
};

/**
 * Coin Address Index
 * @constructor
 * @ignore
 */

function CoinIndex() {
  // Map of addr->coins.
  this.index = {};

  // Map of outpoint->addr.
  this.map = {};
}

CoinIndex.prototype.reset = function reset() {
  this.index = {};
  this.map = {};
};

CoinIndex.prototype.get = function get(addr) {
  var items = this.index[addr];
  var out = [];
  var i, keys, coin;

  if (!items) return out;

  keys = items.keys();

  for (i = 0; i < keys.length; i++) {
    coin = items.get(keys[i]);
    assert(coin);
    out.push(coin.toCoin());
  }

  return out;
};

CoinIndex.prototype.insert = function insert(tx, index) {
  var output = tx.outputs[index];
  var hash = tx.hash('hex');
  var addr = output.getHash('hex');
  var items, key;

  if (!addr) return;

  items = this.index[addr];

  if (!items) {
    items = new Map();
    this.index[addr] = items;
  }

  key = Outpoint.toKey(hash, index);

  assert(!items.has(key));
  items.set(key, new IndexedCoin(tx, index));

  this.map[key] = addr;
};

CoinIndex.prototype.remove = function remove(hash, index) {
  var key = Outpoint.toKey(hash, index);
  var addr = this.map[key];
  var items;

  if (!addr) return;

  items = this.index[addr];

  assert(items);
  assert(items.has(key));
  items.remove(key);

  if (items.size === 0) delete this.index[addr];

  delete this.map[key];
};

/**
 * IndexedCoin
 * @constructor
 * @ignore
 * @param {TX} tx
 * @param {Number} index
 */

function IndexedCoin(tx, index) {
  this.tx = tx;
  this.index = index;
}

IndexedCoin.prototype.toCoin = function toCoin() {
  return Coin.fromTX(this.tx, this.index, -1);
};

/**
 * Orphan
 * @constructor
 * @ignore
 * @param {TX} tx
 * @param {Hash[]} missing
 * @param {Number} id
 */

function Orphan(tx, missing, id) {
  this.raw = tx.toRaw();
  this.missing = missing;
  this.id = id;
}

Orphan.prototype.toTX = function toTX() {
  return TX.fromRaw(this.raw);
};

/**
 * Mempool Cache
 * @ignore
 * @constructor
 * @param {Object} options
 */

function MempoolCache(options) {
  if (!(this instanceof MempoolCache)) return new MempoolCache(options);

  this.logger = options.logger;
  this.chain = options.chain;
  this.network = options.network;
  this.db = null;
  this.batch = null;

  if (options.persistent) this.db = LDB(options);
}

MempoolCache.VERSION = 2;

MempoolCache.prototype.getVersion = co( /*#__PURE__*/_regenerator2.default.mark(function getVersion() {
  var data;
  return _regenerator2.default.wrap(function getVersion$(_context19) {
    while (1) {
      switch (_context19.prev = _context19.next) {
        case 0:
          _context19.next = 2;
          return this.db.get(layout.V);

        case 2:
          data = _context19.sent;

          if (data) {
            _context19.next = 5;
            break;
          }

          return _context19.abrupt('return', -1);

        case 5:
          return _context19.abrupt('return', data.readUInt32LE(0, true));

        case 6:
        case 'end':
          return _context19.stop();
      }
    }
  }, getVersion, this);
}));

MempoolCache.prototype.getTip = co( /*#__PURE__*/_regenerator2.default.mark(function getTip() {
  var hash;
  return _regenerator2.default.wrap(function getTip$(_context20) {
    while (1) {
      switch (_context20.prev = _context20.next) {
        case 0:
          _context20.next = 2;
          return this.db.get(layout.R);

        case 2:
          hash = _context20.sent;

          if (hash) {
            _context20.next = 5;
            break;
          }

          return _context20.abrupt('return');

        case 5:
          return _context20.abrupt('return', hash.toString('hex'));

        case 6:
        case 'end':
          return _context20.stop();
      }
    }
  }, getTip, this);
}));

MempoolCache.prototype.getFees = co( /*#__PURE__*/_regenerator2.default.mark(function getFees() {
  var data, fees;
  return _regenerator2.default.wrap(function getFees$(_context21) {
    while (1) {
      switch (_context21.prev = _context21.next) {
        case 0:
          _context21.next = 2;
          return this.db.get(layout.F);

        case 2:
          data = _context21.sent;

          if (data) {
            _context21.next = 5;
            break;
          }

          return _context21.abrupt('return');

        case 5:

          try {
            fees = Fees.fromRaw(data);
          } catch (e) {
            this.logger.warning('Fee data failed deserialization: %s.', e.message);
          }

          return _context21.abrupt('return', fees);

        case 7:
        case 'end':
          return _context21.stop();
      }
    }
  }, getFees, this);
}));

MempoolCache.prototype.getEntries = function getEntries() {
  return this.db.values({
    gte: layout.e(encoding.ZERO_HASH),
    lte: layout.e(encoding.MAX_HASH),
    parse: MempoolEntry.fromRaw
  });
};

MempoolCache.prototype.getKeys = function getKeys() {
  return this.db.keys({
    gte: layout.e(encoding.ZERO_HASH),
    lte: layout.e(encoding.MAX_HASH)
  });
};

MempoolCache.prototype.open = co( /*#__PURE__*/_regenerator2.default.mark(function open() {
  return _regenerator2.default.wrap(function open$(_context22) {
    while (1) {
      switch (_context22.prev = _context22.next) {
        case 0:
          if (this.db) {
            _context22.next = 2;
            break;
          }

          return _context22.abrupt('return');

        case 2:
          _context22.next = 4;
          return this.db.open();

        case 4:
          _context22.next = 6;
          return this.verify();

        case 6:

          this.batch = this.db.batch();

        case 7:
        case 'end':
          return _context22.stop();
      }
    }
  }, open, this);
}));

MempoolCache.prototype.close = co( /*#__PURE__*/_regenerator2.default.mark(function close() {
  return _regenerator2.default.wrap(function close$(_context23) {
    while (1) {
      switch (_context23.prev = _context23.next) {
        case 0:
          if (this.db) {
            _context23.next = 2;
            break;
          }

          return _context23.abrupt('return');

        case 2:
          _context23.next = 4;
          return this.db.close();

        case 4:

          this.batch = null;

        case 5:
        case 'end':
          return _context23.stop();
      }
    }
  }, close, this);
}));

MempoolCache.prototype.save = function save(entry) {
  if (!this.db) return;

  this.batch.put(layout.e(entry.tx.hash()), entry.toRaw());
};

MempoolCache.prototype.remove = function remove(hash) {
  if (!this.db) return;

  this.batch.del(layout.e(hash));
};

MempoolCache.prototype.sync = function sync(hash) {
  if (!this.db) return;

  this.batch.put(layout.R, Buffer.from(hash, 'hex'));
};

MempoolCache.prototype.writeFees = function writeFees(fees) {
  if (!this.db) return;

  this.batch.put(layout.F, fees.toRaw());
};

MempoolCache.prototype.clear = function clear() {
  this.batch.clear();
  this.batch = this.db.batch();
};

MempoolCache.prototype.flush = co( /*#__PURE__*/_regenerator2.default.mark(function flush() {
  return _regenerator2.default.wrap(function flush$(_context24) {
    while (1) {
      switch (_context24.prev = _context24.next) {
        case 0:
          if (this.db) {
            _context24.next = 2;
            break;
          }

          return _context24.abrupt('return');

        case 2:
          _context24.next = 4;
          return this.batch.write();

        case 4:

          this.batch = this.db.batch();

        case 5:
        case 'end':
          return _context24.stop();
      }
    }
  }, flush, this);
}));

MempoolCache.prototype.init = co( /*#__PURE__*/_regenerator2.default.mark(function init(hash) {
  var batch;
  return _regenerator2.default.wrap(function init$(_context25) {
    while (1) {
      switch (_context25.prev = _context25.next) {
        case 0:
          batch = this.db.batch();

          batch.put(layout.V, encoding.U32(MempoolCache.VERSION));
          batch.put(layout.R, Buffer.from(hash, 'hex'));
          _context25.next = 5;
          return batch.write();

        case 5:
        case 'end':
          return _context25.stop();
      }
    }
  }, init, this);
}));

MempoolCache.prototype.verify = co( /*#__PURE__*/_regenerator2.default.mark(function verify() {
  var version, tip;
  return _regenerator2.default.wrap(function verify$(_context26) {
    while (1) {
      switch (_context26.prev = _context26.next) {
        case 0:
          _context26.next = 2;
          return this.getVersion();

        case 2:
          version = _context26.sent;

          if (!(version === -1)) {
            _context26.next = 9;
            break;
          }

          version = MempoolCache.VERSION;
          tip = this.chain.tip.hash;

          this.logger.info('Mempool cache is empty. Writing tip %s.', util.revHex(tip));

          _context26.next = 9;
          return this.init(tip);

        case 9:
          if (!(version !== MempoolCache.VERSION)) {
            _context26.next = 15;
            break;
          }

          this.logger.warning('Mempool cache version mismatch (%d != %d)!', version, MempoolCache.VERSION);
          this.logger.warning('Invalidating mempool cache.');
          _context26.next = 14;
          return this.wipe();

        case 14:
          return _context26.abrupt('return', false);

        case 15:
          _context26.next = 17;
          return this.getTip();

        case 17:
          tip = _context26.sent;

          if (!(tip !== this.chain.tip.hash)) {
            _context26.next = 24;
            break;
          }

          this.logger.warning('Mempool tip not consistent with chain tip (%s != %s)!', util.revHex(tip), this.chain.tip.rhash());
          this.logger.warning('Invalidating mempool cache.');
          _context26.next = 23;
          return this.wipe();

        case 23:
          return _context26.abrupt('return', false);

        case 24:
          return _context26.abrupt('return', true);

        case 25:
        case 'end':
          return _context26.stop();
      }
    }
  }, verify, this);
}));

MempoolCache.prototype.wipe = co( /*#__PURE__*/_regenerator2.default.mark(function wipe() {
  var batch, keys, i, key;
  return _regenerator2.default.wrap(function wipe$(_context27) {
    while (1) {
      switch (_context27.prev = _context27.next) {
        case 0:
          batch = this.db.batch();
          _context27.next = 3;
          return this.getKeys();

        case 3:
          keys = _context27.sent;


          for (i = 0; i < keys.length; i++) {
            key = keys[i];
            batch.del(key);
          }

          batch.put(layout.V, encoding.U32(MempoolCache.VERSION));
          batch.put(layout.R, Buffer.from(this.chain.tip.hash, 'hex'));
          batch.del(layout.F);

          _context27.next = 10;
          return batch.write();

        case 10:

          this.logger.info('Removed %d mempool entries from disk.', keys.length);

        case 11:
        case 'end':
          return _context27.stop();
      }
    }
  }, wipe, this);
}));

/*
 * Helpers
 */

function nop(parent, child) {
  ;
}

function addFee(parent, child) {
  parent.descFee += child.deltaFee;
  parent.descSize += child.size;
}

function removeFee(parent, child) {
  parent.descFee -= child.descFee;
  parent.descSize -= child.descSize;
}

function preprioritise(parent, child) {
  parent.descFee -= child.deltaFee;
}

function prioritise(parent, child) {
  parent.descFee += child.deltaFee;
}

function cmpRate(a, b) {
  var xf = a.deltaFee;
  var xs = a.size;
  var yf = b.deltaFee;
  var ys = b.size;
  var x, y;

  if (useDesc(a)) {
    xf = a.descFee;
    xs = a.descSize;
  }

  if (useDesc(b)) {
    yf = b.descFee;
    ys = b.descSize;
  }

  x = xf * ys;
  y = xs * yf;

  if (x === y) {
    x = a.ts;
    y = b.ts;
  }

  return x - y;
}

function useDesc(a) {
  var x = a.deltaFee * a.descSize;
  var y = a.descFee * a.size;
  return y > x;
}

/*
 * Expose
 */

module.exports = Mempool;