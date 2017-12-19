/*!
 * chaindb.js - blockchain data management for bcoin
 * Copyright (c) 2014-2015, Fedor Indutny (MIT License)
 * Copyright (c) 2014-2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

var _keys = require('babel-runtime/core-js/object/keys');

var _keys2 = _interopRequireDefault(_keys);

var _promise = require('babel-runtime/core-js/promise');

var _promise2 = _interopRequireDefault(_promise);

var _regenerator = require('babel-runtime/regenerator');

var _regenerator2 = _interopRequireDefault(_regenerator);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var assert = require('assert');
var util = require('../utils/util');
var BufferReader = require('../utils/reader');
var StaticWriter = require('../utils/staticwriter');
var Amount = require('../btc/amount');
var encoding = require('../utils/encoding');
var co = require('../utils/co');
var Network = require('../protocol/network');
var CoinView = require('../coins/coinview');
var Coins = require('../coins/coins');
var UndoCoins = require('../coins/undocoins');
var LDB = require('../db/ldb');
var layout = require('./layout');
var LRU = require('../utils/lru');
var Block = require('../primitives/block');
var Outpoint = require('../primitives/outpoint');
var Address = require('../primitives/address');
var ChainEntry = require('./chainentry');
var TXMeta = require('../primitives/txmeta');
var U8 = encoding.U8;
var U32 = encoding.U32;
var DUMMY = Buffer.from([0]);

/**
 * The database backend for the {@link Chain} object.
 * @alias module:blockchain.ChainDB
 * @constructor
 * @param {Chain} chain
 * @param {Boolean?} options.prune - Whether to prune the chain.
 * @param {Boolean?} options.spv - SPV-mode, will not save block
 * data, only entries.
 * @param {String?} options.name - Database name
 * @param {String?} options.location - Database location
 * @param {String?} options.db - Database backend name
 * @property {Boolean} prune
 * @emits ChainDB#open
 * @emits ChainDB#error
 */

function ChainDB(chain) {
  if (!(this instanceof ChainDB)) return new ChainDB(chain);

  this.chain = chain;
  this.options = chain.options;
  this.network = this.options.network;
  this.logger = this.options.logger.context('chaindb');

  this.db = LDB(this.options);
  this.stateCache = new StateCache(this.network);
  this.state = new ChainState();
  this.pending = null;
  this.current = null;

  this.coinCache = new LRU(this.options.coinCache, getSize);
  this.cacheHash = new LRU(this.options.entryCache);
  this.cacheHeight = new LRU(this.options.entryCache);
}

/**
 * Database layout.
 * @type {Object}
 */

ChainDB.layout = layout;

/**
 * Open the chain db, wait for the database to load.
 * @method
 * @returns {Promise}
 */

ChainDB.prototype.open = co( /*#__PURE__*/_regenerator2.default.mark(function open() {
  var state;
  return _regenerator2.default.wrap(function open$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:

          this.logger.info('Opening ChainDB...');

          _context.next = 3;
          return this.db.open();

        case 3:
          _context.next = 5;
          return this.db.checkVersion('V', 2);

        case 5:
          _context.next = 7;
          return this.getState();

        case 7:
          state = _context.sent;

          if (!state) {
            _context.next = 20;
            break;
          }

          _context.next = 11;
          return this.verifyFlags(state);

        case 11:
          _context.next = 13;
          return this.verifyDeployments();

        case 13:
          _context.next = 15;
          return this.getStateCache();

        case 15:
          this.stateCache = _context.sent;


          // Grab the chainstate if we have one.
          this.state = state;

          this.logger.info('ChainDB successfully loaded.');
          _context.next = 27;
          break;

        case 20:
          _context.next = 22;
          return this.saveFlags();

        case 22:
          _context.next = 24;
          return this.saveDeployments();

        case 24:
          _context.next = 26;
          return this.saveGenesis();

        case 26:

          this.logger.info('ChainDB successfully initialized.');

        case 27:

          this.logger.info('Chain State: hash=%s tx=%d coin=%d value=%s.', this.state.rhash(), this.state.tx, this.state.coin, Amount.btc(this.state.value));

        case 28:
        case 'end':
          return _context.stop();
      }
    }
  }, open, this);
}));

/**
 * Close the chain db, wait for the database to close.
 * @returns {Promise}
 */

ChainDB.prototype.close = function close() {
  return this.db.close();
};

/**
 * Start a batch.
 * @returns {Batch}
 */

ChainDB.prototype.start = function start() {
  assert(!this.current);
  assert(!this.pending);

  this.current = this.db.batch();
  this.pending = this.state.clone();

  this.coinCache.start();
  this.cacheHash.start();
  this.cacheHeight.start();

  return this.current;
};

/**
 * Put key and value to current batch.
 * @param {String} key
 * @param {Buffer} value
 */

ChainDB.prototype.put = function put(key, value) {
  assert(this.current);
  this.current.put(key, value);
};

/**
 * Delete key from current batch.
 * @param {String} key
 */

ChainDB.prototype.del = function del(key) {
  assert(this.current);
  this.current.del(key);
};

/**
 * Get current batch.
 * @returns {Batch}
 */

ChainDB.prototype.batch = function batch() {
  assert(this.current);
  return this.current;
};

/**
 * Drop current batch.
 * @returns {Batch}
 */

ChainDB.prototype.drop = function drop() {
  var batch = this.current;

  assert(this.current);
  assert(this.pending);

  this.current = null;
  this.pending = null;

  this.coinCache.drop();
  this.cacheHash.drop();
  this.cacheHeight.drop();
  this.stateCache.drop();

  batch.clear();
};

/**
 * Commit current batch.
 * @method
 * @returns {Promise}
 */

ChainDB.prototype.commit = co( /*#__PURE__*/_regenerator2.default.mark(function commit() {
  return _regenerator2.default.wrap(function commit$(_context2) {
    while (1) {
      switch (_context2.prev = _context2.next) {
        case 0:
          assert(this.current);
          assert(this.pending);

          _context2.prev = 2;
          _context2.next = 5;
          return this.current.write();

        case 5:
          _context2.next = 15;
          break;

        case 7:
          _context2.prev = 7;
          _context2.t0 = _context2['catch'](2);

          this.current = null;
          this.pending = null;
          this.coinCache.drop();
          this.cacheHash.drop();
          this.cacheHeight.drop();
          throw _context2.t0;

        case 15:

          // Overwrite the entire state
          // with our new best state
          // only if it is committed.
          // Note that alternate chain
          // tips do not commit anything.
          if (this.pending.committed) this.state = this.pending;

          this.current = null;
          this.pending = null;

          this.coinCache.commit();
          this.cacheHash.commit();
          this.cacheHeight.commit();
          this.stateCache.commit();

        case 22:
        case 'end':
          return _context2.stop();
      }
    }
  }, commit, this, [[2, 7]]);
}));

/**
 * Test the cache for a present entry hash or height.
 * @param {Hash|Number} block - Hash or height.
 */

ChainDB.prototype.hasCache = function hasCache(block) {
  if (typeof block === 'number') return this.cacheHeight.has(block);

  assert(typeof block === 'string');

  return this.cacheHash.has(block);
};

/**
 * Get an entry directly from the LRU cache. This is
 * useful for optimization if we don't want to wait on a
 * nextTick during a `get()` call.
 * @param {Hash|Number} block - Hash or height.
 */

ChainDB.prototype.getCache = function getCache(block) {
  if (typeof block === 'number') return this.cacheHeight.get(block);

  assert(typeof block === 'string');

  return this.cacheHash.get(block);
};

/**
 * Get the height of a block by hash.
 * @method
 * @param {Hash} hash
 * @returns {Promise} - Returns Number.
 */

ChainDB.prototype.getHeight = co( /*#__PURE__*/_regenerator2.default.mark(function getHeight(hash) {
  var entry, height;
  return _regenerator2.default.wrap(function getHeight$(_context3) {
    while (1) {
      switch (_context3.prev = _context3.next) {
        case 0:
          if (!(typeof hash === 'number')) {
            _context3.next = 2;
            break;
          }

          return _context3.abrupt('return', hash);

        case 2:

          assert(typeof hash === 'string');

          if (!(hash === encoding.NULL_HASH)) {
            _context3.next = 5;
            break;
          }

          return _context3.abrupt('return', -1);

        case 5:

          entry = this.cacheHash.get(hash);

          if (!entry) {
            _context3.next = 8;
            break;
          }

          return _context3.abrupt('return', entry.height);

        case 8:
          _context3.next = 10;
          return this.db.get(layout.h(hash));

        case 10:
          height = _context3.sent;

          if (height) {
            _context3.next = 13;
            break;
          }

          return _context3.abrupt('return', -1);

        case 13:
          return _context3.abrupt('return', height.readUInt32LE(0, true));

        case 14:
        case 'end':
          return _context3.stop();
      }
    }
  }, getHeight, this);
}));

/**
 * Get the hash of a block by height. Note that this
 * will only return hashes in the main chain.
 * @method
 * @param {Number} height
 * @returns {Promise} - Returns {@link Hash}.
 */

ChainDB.prototype.getHash = co( /*#__PURE__*/_regenerator2.default.mark(function getHash(height) {
  var entry, hash;
  return _regenerator2.default.wrap(function getHash$(_context4) {
    while (1) {
      switch (_context4.prev = _context4.next) {
        case 0:
          if (!(typeof height === 'string')) {
            _context4.next = 2;
            break;
          }

          return _context4.abrupt('return', height);

        case 2:

          assert(typeof height === 'number');

          if (!(height < 0)) {
            _context4.next = 5;
            break;
          }

          return _context4.abrupt('return');

        case 5:

          entry = this.cacheHeight.get(height);

          if (!entry) {
            _context4.next = 8;
            break;
          }

          return _context4.abrupt('return', entry.hash);

        case 8:
          _context4.next = 10;
          return this.db.get(layout.H(height));

        case 10:
          hash = _context4.sent;

          if (hash) {
            _context4.next = 13;
            break;
          }

          return _context4.abrupt('return');

        case 13:
          return _context4.abrupt('return', hash.toString('hex'));

        case 14:
        case 'end':
          return _context4.stop();
      }
    }
  }, getHash, this);
}));

/**
 * Retrieve a chain entry by height.
 * @method
 * @param {Number} height
 * @returns {Promise} - Returns {@link ChainEntry}.
 */

ChainDB.prototype.getEntryByHeight = co( /*#__PURE__*/_regenerator2.default.mark(function getEntryByHeight(height) {
  var state, entry, hash;
  return _regenerator2.default.wrap(function getEntryByHeight$(_context5) {
    while (1) {
      switch (_context5.prev = _context5.next) {
        case 0:

          assert(typeof height === 'number');

          if (!(height < 0)) {
            _context5.next = 3;
            break;
          }

          return _context5.abrupt('return');

        case 3:

          entry = this.cacheHeight.get(height);

          if (!entry) {
            _context5.next = 6;
            break;
          }

          return _context5.abrupt('return', entry);

        case 6:
          _context5.next = 8;
          return this.db.get(layout.H(height));

        case 8:
          hash = _context5.sent;

          if (hash) {
            _context5.next = 11;
            break;
          }

          return _context5.abrupt('return');

        case 11:

          hash = hash.toString('hex');
          state = this.chain.state;

          _context5.next = 15;
          return this.getEntryByHash(hash);

        case 15:
          entry = _context5.sent;

          if (entry) {
            _context5.next = 18;
            break;
          }

          return _context5.abrupt('return');

        case 18:

          // By the time getEntry has completed,
          // a reorg may have occurred. This entry
          // may not be on the main chain anymore.
          if (this.chain.state === state) this.cacheHeight.set(entry.height, entry);

          return _context5.abrupt('return', entry);

        case 20:
        case 'end':
          return _context5.stop();
      }
    }
  }, getEntryByHeight, this);
}));

/**
 * Retrieve a chain entry by hash.
 * @method
 * @param {Hash} hash
 * @returns {Promise} - Returns {@link ChainEntry}.
 */

ChainDB.prototype.getEntryByHash = co( /*#__PURE__*/_regenerator2.default.mark(function getEntryByHash(hash) {
  var entry, raw;
  return _regenerator2.default.wrap(function getEntryByHash$(_context6) {
    while (1) {
      switch (_context6.prev = _context6.next) {
        case 0:

          assert(typeof hash === 'string');

          if (!(hash === encoding.NULL_HASH)) {
            _context6.next = 3;
            break;
          }

          return _context6.abrupt('return');

        case 3:

          entry = this.cacheHash.get(hash);

          if (!entry) {
            _context6.next = 6;
            break;
          }

          return _context6.abrupt('return', entry);

        case 6:
          _context6.next = 8;
          return this.db.get(layout.e(hash));

        case 8:
          raw = _context6.sent;

          if (raw) {
            _context6.next = 11;
            break;
          }

          return _context6.abrupt('return');

        case 11:

          entry = ChainEntry.fromRaw(this.chain, raw);

          // There's no efficient way to check whether
          // this is in the main chain or not, so
          // don't add it to the height cache.
          this.cacheHash.set(entry.hash, entry);

          return _context6.abrupt('return', entry);

        case 14:
        case 'end':
          return _context6.stop();
      }
    }
  }, getEntryByHash, this);
}));

/**
 * Retrieve a chain entry.
 * @param {Number|Hash} block - Height or hash.
 * @returns {Promise} - Returns {@link ChainEntry}.
 */

ChainDB.prototype.getEntry = function getEntry(block) {
  if (typeof block === 'number') return this.getEntryByHeight(block);
  return this.getEntryByHash(block);
};

/**
 * Test whether the chain contains a block.
 * @method
 * @param {Hash} hash
 * @returns {Promise} - Returns Boolean.
 */

ChainDB.prototype.hasEntry = co( /*#__PURE__*/_regenerator2.default.mark(function hasEntry(hash) {
  var height;
  return _regenerator2.default.wrap(function hasEntry$(_context7) {
    while (1) {
      switch (_context7.prev = _context7.next) {
        case 0:
          _context7.next = 2;
          return this.getHeight(hash);

        case 2:
          height = _context7.sent;
          return _context7.abrupt('return', height !== -1);

        case 4:
        case 'end':
          return _context7.stop();
      }
    }
  }, hasEntry, this);
}));

/**
 * Retrieve the tip entry from the tip record.
 * @returns {Promise} - Returns {@link ChainEntry}.
 */

ChainDB.prototype.getTip = function getTip() {
  return this.getEntry(this.state.hash());
};

/**
 * Retrieve the tip entry from the tip record.
 * @method
 * @returns {Promise} - Returns {@link ChainState}.
 */

ChainDB.prototype.getState = co( /*#__PURE__*/_regenerator2.default.mark(function getState() {
  var data;
  return _regenerator2.default.wrap(function getState$(_context8) {
    while (1) {
      switch (_context8.prev = _context8.next) {
        case 0:
          _context8.next = 2;
          return this.db.get(layout.R);

        case 2:
          data = _context8.sent;

          if (data) {
            _context8.next = 5;
            break;
          }

          return _context8.abrupt('return');

        case 5:
          return _context8.abrupt('return', ChainState.fromRaw(data));

        case 6:
        case 'end':
          return _context8.stop();
      }
    }
  }, getState, this);
}));

/**
 * Write genesis block to database.
 * @method
 * @returns {Promise}
 */

ChainDB.prototype.saveGenesis = co( /*#__PURE__*/_regenerator2.default.mark(function saveGenesis() {
  var genesis, block, entry;
  return _regenerator2.default.wrap(function saveGenesis$(_context9) {
    while (1) {
      switch (_context9.prev = _context9.next) {
        case 0:
          genesis = this.network.genesisBlock;
          block = Block.fromRaw(genesis, 'hex');
          entry = ChainEntry.fromBlock(this.chain, block);


          this.logger.info('Writing genesis block to ChainDB.');

          _context9.next = 6;
          return this.save(entry, block, new CoinView());

        case 6:
        case 'end':
          return _context9.stop();
      }
    }
  }, saveGenesis, this);
}));

/**
 * Retrieve the database flags.
 * @method
 * @returns {Promise} - Returns {@link ChainFlags}.
 */

ChainDB.prototype.getFlags = co( /*#__PURE__*/_regenerator2.default.mark(function getFlags() {
  var data;
  return _regenerator2.default.wrap(function getFlags$(_context10) {
    while (1) {
      switch (_context10.prev = _context10.next) {
        case 0:
          _context10.next = 2;
          return this.db.get(layout.O);

        case 2:
          data = _context10.sent;

          if (data) {
            _context10.next = 5;
            break;
          }

          return _context10.abrupt('return');

        case 5:
          return _context10.abrupt('return', ChainFlags.fromRaw(data));

        case 6:
        case 'end':
          return _context10.stop();
      }
    }
  }, getFlags, this);
}));

/**
 * Verify current options against db options.
 * @method
 * @param {ChainState} state
 * @returns {Promise}
 */

ChainDB.prototype.verifyFlags = co( /*#__PURE__*/_regenerator2.default.mark(function verifyFlags(state) {
  var options, flags, needsWitness, needsPrune;
  return _regenerator2.default.wrap(function verifyFlags$(_context11) {
    while (1) {
      switch (_context11.prev = _context11.next) {
        case 0:
          options = this.options;
          _context11.next = 3;
          return this.getFlags();

        case 3:
          flags = _context11.sent;
          needsWitness = false;
          needsPrune = false;

          if (flags) {
            _context11.next = 8;
            break;
          }

          throw new Error('No flags found.');

        case 8:
          if (!(options.network !== flags.network)) {
            _context11.next = 10;
            break;
          }

          throw new Error('Network mismatch for chain.');

        case 10:
          if (!(options.spv && !flags.spv)) {
            _context11.next = 12;
            break;
          }

          throw new Error('Cannot retroactively enable SPV.');

        case 12:
          if (!(!options.spv && flags.spv)) {
            _context11.next = 14;
            break;
          }

          throw new Error('Cannot retroactively disable SPV.');

        case 14:
          if (flags.witness) {
            _context11.next = 18;
            break;
          }

          if (options.forceWitness) {
            _context11.next = 17;
            break;
          }

          throw new Error('Cannot retroactively enable witness.');

        case 17:
          needsWitness = true;

        case 18:
          if (!(options.prune && !flags.prune)) {
            _context11.next = 22;
            break;
          }

          if (options.forcePrune) {
            _context11.next = 21;
            break;
          }

          throw new Error('Cannot retroactively prune.');

        case 21:
          needsPrune = true;

        case 22:
          if (!(!options.prune && flags.prune)) {
            _context11.next = 24;
            break;
          }

          throw new Error('Cannot retroactively unprune.');

        case 24:
          if (!(options.indexTX && !flags.indexTX)) {
            _context11.next = 26;
            break;
          }

          throw new Error('Cannot retroactively enable TX indexing.');

        case 26:
          if (!(!options.indexTX && flags.indexTX)) {
            _context11.next = 28;
            break;
          }

          throw new Error('Cannot retroactively disable TX indexing.');

        case 28:
          if (!(options.indexAddress && !flags.indexAddress)) {
            _context11.next = 30;
            break;
          }

          throw new Error('Cannot retroactively enable address indexing.');

        case 30:
          if (!(!options.indexAddress && flags.indexAddress)) {
            _context11.next = 32;
            break;
          }

          throw new Error('Cannot retroactively disable address indexing.');

        case 32:
          if (!needsWitness) {
            _context11.next = 37;
            break;
          }

          _context11.next = 35;
          return this.logger.info('Writing witness bit to chain flags.');

        case 35:
          _context11.next = 37;
          return this.saveFlags();

        case 37:
          if (!needsPrune) {
            _context11.next = 42;
            break;
          }

          _context11.next = 40;
          return this.logger.info('Retroactively pruning chain.');

        case 40:
          _context11.next = 42;
          return this.prune(state.hash());

        case 42:
        case 'end':
          return _context11.stop();
      }
    }
  }, verifyFlags, this);
}));

/**
 * Get state caches.
 * @method
 * @returns {Promise} - Returns {@link StateCache}.
 */

ChainDB.prototype.getStateCache = co( /*#__PURE__*/_regenerator2.default.mark(function getStateCache() {
  var stateCache, i, items, item, key, bit, hash, state;
  return _regenerator2.default.wrap(function getStateCache$(_context12) {
    while (1) {
      switch (_context12.prev = _context12.next) {
        case 0:
          stateCache = new StateCache(this.network);
          _context12.next = 3;
          return this.db.range({
            gte: layout.v(0, encoding.ZERO_HASH),
            lte: layout.v(255, encoding.MAX_HASH),
            values: true
          });

        case 3:
          items = _context12.sent;


          for (i = 0; i < items.length; i++) {
            item = items[i];
            key = layout.vv(item.key);
            bit = key[0];
            hash = key[1];
            state = item.value[0];
            stateCache.insert(bit, hash, state);
          }

          return _context12.abrupt('return', stateCache);

        case 6:
        case 'end':
          return _context12.stop();
      }
    }
  }, getStateCache, this);
}));

/**
 * Save deployment table.
 * @returns {Promise}
 */

ChainDB.prototype.saveDeployments = function saveDeployments() {
  var batch = this.db.batch();
  this.writeDeployments(batch);
  return batch.write();
};

/**
 * Save deployment table.
 * @returns {Promise}
 */

ChainDB.prototype.writeDeployments = function writeDeployments(batch) {
  var bw = new StaticWriter(1 + 9 * this.network.deploys.length);
  var i, deployment;

  bw.writeU8(this.network.deploys.length);

  for (i = 0; i < this.network.deploys.length; i++) {
    deployment = this.network.deploys[i];
    bw.writeU8(deployment.bit);
    bw.writeU32(deployment.startTime);
    bw.writeU32(deployment.timeout);
  }

  batch.put(layout.V, bw.render());
};

/**
 * Check for outdated deployments.
 * @method
 * @private
 * @returns {Promise}
 */

ChainDB.prototype.checkDeployments = co( /*#__PURE__*/_regenerator2.default.mark(function checkDeployments() {
  var raw, invalid, i, br, count, deployment, bit, start, timeout;
  return _regenerator2.default.wrap(function checkDeployments$(_context13) {
    while (1) {
      switch (_context13.prev = _context13.next) {
        case 0:
          _context13.next = 2;
          return this.db.get(layout.V);

        case 2:
          raw = _context13.sent;
          invalid = [];


          assert(raw, 'No deployment table found.');

          br = new BufferReader(raw);

          count = br.readU8();

          i = 0;

        case 8:
          if (!(i < count)) {
            _context13.next = 19;
            break;
          }

          bit = br.readU8();
          start = br.readU32();
          timeout = br.readU32();
          deployment = this.network.byBit(bit);

          if (!(deployment && start === deployment.startTime && timeout === deployment.timeout)) {
            _context13.next = 15;
            break;
          }

          return _context13.abrupt('continue', 16);

        case 15:

          invalid.push(bit);

        case 16:
          i++;
          _context13.next = 8;
          break;

        case 19:
          return _context13.abrupt('return', invalid);

        case 20:
        case 'end':
          return _context13.stop();
      }
    }
  }, checkDeployments, this);
}));

/**
 * Potentially invalidate state cache.
 * @method
 * @returns {Promise}
 */

ChainDB.prototype.verifyDeployments = co( /*#__PURE__*/_regenerator2.default.mark(function verifyDeployments() {
  var invalid, i, bit, batch;
  return _regenerator2.default.wrap(function verifyDeployments$(_context14) {
    while (1) {
      switch (_context14.prev = _context14.next) {
        case 0:
          _context14.next = 2;
          return this.checkDeployments();

        case 2:
          invalid = _context14.sent;

          if (!(invalid.length === 0)) {
            _context14.next = 5;
            break;
          }

          return _context14.abrupt('return', true);

        case 5:

          batch = this.db.batch();

          i = 0;

        case 7:
          if (!(i < invalid.length)) {
            _context14.next = 16;
            break;
          }

          bit = invalid[i];
          this.logger.warning('Versionbit deployment params modified.');
          this.logger.warning('Invalidating cache for bit %d.', bit);
          _context14.next = 13;
          return this.invalidateCache(bit, batch);

        case 13:
          i++;
          _context14.next = 7;
          break;

        case 16:

          this.writeDeployments(batch);

          _context14.next = 19;
          return batch.write();

        case 19:
          return _context14.abrupt('return', false);

        case 20:
        case 'end':
          return _context14.stop();
      }
    }
  }, verifyDeployments, this);
}));

/**
 * Invalidate state cache.
 * @method
 * @private
 * @returns {Promise}
 */

ChainDB.prototype.invalidateCache = co( /*#__PURE__*/_regenerator2.default.mark(function invalidateCache(bit, batch) {
  var i, keys, key;
  return _regenerator2.default.wrap(function invalidateCache$(_context15) {
    while (1) {
      switch (_context15.prev = _context15.next) {
        case 0:
          _context15.next = 2;
          return this.db.keys({
            gte: layout.v(bit, encoding.ZERO_HASH),
            lte: layout.v(bit, encoding.MAX_HASH)
          });

        case 2:
          keys = _context15.sent;


          for (i = 0; i < keys.length; i++) {
            key = keys[i];
            batch.del(key);
          }

        case 4:
        case 'end':
          return _context15.stop();
      }
    }
  }, invalidateCache, this);
}));

/**
 * Retroactively prune the database.
 * @method
 * @param {Hash} tip
 * @returns {Promise}
 */

ChainDB.prototype.prune = co( /*#__PURE__*/_regenerator2.default.mark(function prune(tip) {
  var options, keepBlocks, pruneAfter, flags, height, i, start, end, batch, hash;
  return _regenerator2.default.wrap(function prune$(_context16) {
    while (1) {
      switch (_context16.prev = _context16.next) {
        case 0:
          options = this.options;
          keepBlocks = this.network.block.keepBlocks;
          pruneAfter = this.network.block.pruneAfterHeight;
          _context16.next = 5;
          return this.getFlags();

        case 5:
          flags = _context16.sent;
          _context16.next = 8;
          return this.getHeight(tip);

        case 8:
          height = _context16.sent;

          if (!flags.prune) {
            _context16.next = 11;
            break;
          }

          throw new Error('Chain is already pruned.');

        case 11:
          if (!(height <= pruneAfter + keepBlocks)) {
            _context16.next = 13;
            break;
          }

          return _context16.abrupt('return', false);

        case 13:

          batch = this.db.batch();
          start = pruneAfter + 1;
          end = height - keepBlocks;

          i = start;

        case 17:
          if (!(i <= end)) {
            _context16.next = 28;
            break;
          }

          _context16.next = 20;
          return this.getHash(i);

        case 20:
          hash = _context16.sent;

          if (hash) {
            _context16.next = 23;
            break;
          }

          throw new Error('Cannot find hash for ' + i);

        case 23:

          batch.del(layout.b(hash));
          batch.del(layout.u(hash));

        case 25:
          i++;
          _context16.next = 17;
          break;

        case 28:
          _context16.prev = 28;

          options.prune = true;

          flags = ChainFlags.fromOptions(options);
          assert(flags.prune);

          batch.put(layout.O, flags.toRaw());

          _context16.next = 35;
          return batch.write();

        case 35:
          _context16.next = 41;
          break;

        case 37:
          _context16.prev = 37;
          _context16.t0 = _context16['catch'](28);

          options.prune = false;
          throw _context16.t0;

        case 41:
          _context16.next = 43;
          return this.db.compactRange();

        case 43:
          return _context16.abrupt('return', true);

        case 44:
        case 'end':
          return _context16.stop();
      }
    }
  }, prune, this, [[28, 37]]);
}));

/**
 * Get the _next_ block hash (does not work by height).
 * @method
 * @param {Hash} hash
 * @returns {Promise} - Returns {@link Hash}.
 */

ChainDB.prototype.getNextHash = co( /*#__PURE__*/_regenerator2.default.mark(function getNextHash(hash) {
  var data;
  return _regenerator2.default.wrap(function getNextHash$(_context17) {
    while (1) {
      switch (_context17.prev = _context17.next) {
        case 0:
          _context17.next = 2;
          return this.db.get(layout.n(hash));

        case 2:
          data = _context17.sent;

          if (data) {
            _context17.next = 5;
            break;
          }

          return _context17.abrupt('return');

        case 5:
          return _context17.abrupt('return', data.toString('hex'));

        case 6:
        case 'end':
          return _context17.stop();
      }
    }
  }, getNextHash, this);
}));

/**
 * Check to see if a block is on the main chain.
 * @method
 * @param {ChainEntry|Hash} hash
 * @returns {Promise} - Returns Boolean.
 */

ChainDB.prototype.isMainChain = co( /*#__PURE__*/_regenerator2.default.mark(function isMainChain(hash) {
  var entry;
  return _regenerator2.default.wrap(function isMainChain$(_context18) {
    while (1) {
      switch (_context18.prev = _context18.next) {
        case 0:

          assert(typeof hash === 'string');

          if (!(hash === this.chain.tip.hash || hash === this.network.genesis.hash)) {
            _context18.next = 3;
            break;
          }

          return _context18.abrupt('return', true);

        case 3:
          if (!(hash === encoding.NULL_HASH)) {
            _context18.next = 5;
            break;
          }

          return _context18.abrupt('return', false);

        case 5:

          entry = this.cacheHash.get(hash);

          if (!entry) {
            _context18.next = 10;
            break;
          }

          entry = this.cacheHeight.get(entry.height);

          if (!entry) {
            _context18.next = 10;
            break;
          }

          return _context18.abrupt('return', entry.hash === hash);

        case 10:
          _context18.next = 12;
          return this.getNextHash(hash);

        case 12:
          if (!_context18.sent) {
            _context18.next = 14;
            break;
          }

          return _context18.abrupt('return', true);

        case 14:
          return _context18.abrupt('return', false);

        case 15:
        case 'end':
          return _context18.stop();
      }
    }
  }, isMainChain, this);
}));

/**
 * Get all entries.
 * @returns {Promise} - Returns {@link ChainEntry}[].
 */

ChainDB.prototype.getEntries = function getEntries() {
  var self = this;
  return this.db.values({
    gte: layout.e(encoding.ZERO_HASH),
    lte: layout.e(encoding.MAX_HASH),
    parse: function parse(value) {
      return ChainEntry.fromRaw(self.chain, value);
    }
  });
};

/**
 * Get all tip hashes.
 * @returns {Promise} - Returns {@link Hash}[].
 */

ChainDB.prototype.getTips = function getTips() {
  return this.db.keys({
    gte: layout.p(encoding.ZERO_HASH),
    lte: layout.p(encoding.MAX_HASH),
    parse: layout.pp
  });
};

/**
 * Get a coin (unspents only).
 * @method
 * @param {Hash} hash
 * @param {Number} index
 * @returns {Promise} - Returns {@link Coin}.
 */

ChainDB.prototype.getCoin = co( /*#__PURE__*/_regenerator2.default.mark(function getCoin(hash, index) {
  var state, raw;
  return _regenerator2.default.wrap(function getCoin$(_context19) {
    while (1) {
      switch (_context19.prev = _context19.next) {
        case 0:
          state = this.state;

          if (!this.options.spv) {
            _context19.next = 3;
            break;
          }

          return _context19.abrupt('return');

        case 3:

          raw = this.coinCache.get(hash);

          if (!raw) {
            _context19.next = 6;
            break;
          }

          return _context19.abrupt('return', Coins.parseCoin(raw, hash, index));

        case 6:
          _context19.next = 8;
          return this.db.get(layout.c(hash));

        case 8:
          raw = _context19.sent;

          if (raw) {
            _context19.next = 11;
            break;
          }

          return _context19.abrupt('return');

        case 11:

          if (state === this.state) this.coinCache.set(hash, raw);

          return _context19.abrupt('return', Coins.parseCoin(raw, hash, index));

        case 13:
        case 'end':
          return _context19.stop();
      }
    }
  }, getCoin, this);
}));

/**
 * Get coins (unspents only).
 * @method
 * @param {Hash} hash
 * @returns {Promise} - Returns {@link Coins}.
 */

ChainDB.prototype.getCoins = co( /*#__PURE__*/_regenerator2.default.mark(function getCoins(hash) {
  var raw;
  return _regenerator2.default.wrap(function getCoins$(_context20) {
    while (1) {
      switch (_context20.prev = _context20.next) {
        case 0:
          if (!this.options.spv) {
            _context20.next = 2;
            break;
          }

          return _context20.abrupt('return');

        case 2:

          raw = this.coinCache.get(hash);

          if (!raw) {
            _context20.next = 5;
            break;
          }

          return _context20.abrupt('return', Coins.fromRaw(raw, hash));

        case 5:
          _context20.next = 7;
          return this.db.get(layout.c(hash));

        case 7:
          raw = _context20.sent;

          if (raw) {
            _context20.next = 10;
            break;
          }

          return _context20.abrupt('return');

        case 10:
          return _context20.abrupt('return', Coins.fromRaw(raw, hash));

        case 11:
        case 'end':
          return _context20.stop();
      }
    }
  }, getCoins, this);
}));

/**
 * Check whether coins are still unspent. Necessary for bip30.
 * @see https://bitcointalk.org/index.php?topic=67738.0
 * @param {Hash} hash
 * @returns {Promise} - Returns Boolean.
 */

ChainDB.prototype.hasCoins = function hasCoins(hash) {
  return this.db.has(layout.c(hash));
};

/**
 * Get coin viewpoint.
 * @method
 * @param {TX} tx
 * @returns {Promise} - Returns {@link CoinView}.
 */

ChainDB.prototype.getCoinView = co( /*#__PURE__*/_regenerator2.default.mark(function getCoinView(tx) {
  var view, prevout, i, hash, coins;
  return _regenerator2.default.wrap(function getCoinView$(_context21) {
    while (1) {
      switch (_context21.prev = _context21.next) {
        case 0:
          view = new CoinView();
          prevout = tx.getPrevout();
          i = 0;

        case 3:
          if (!(i < prevout.length)) {
            _context21.next = 17;
            break;
          }

          hash = prevout[i];
          _context21.next = 7;
          return this.getCoins(hash);

        case 7:
          coins = _context21.sent;

          if (coins) {
            _context21.next = 13;
            break;
          }

          coins = new Coins();
          coins.hash = hash;
          view.add(coins);
          return _context21.abrupt('continue', 14);

        case 13:

          view.add(coins);

        case 14:
          i++;
          _context21.next = 3;
          break;

        case 17:
          return _context21.abrupt('return', view);

        case 18:
        case 'end':
          return _context21.stop();
      }
    }
  }, getCoinView, this);
}));

/**
 * Get coin viewpoint (historical).
 * @method
 * @param {TX} tx
 * @returns {Promise} - Returns {@link CoinView}.
 */

ChainDB.prototype.getSpentView = co( /*#__PURE__*/_regenerator2.default.mark(function getSpentView(tx) {
  var view, entries, i, coins, meta;
  return _regenerator2.default.wrap(function getSpentView$(_context22) {
    while (1) {
      switch (_context22.prev = _context22.next) {
        case 0:
          _context22.next = 2;
          return this.getCoinView(tx);

        case 2:
          view = _context22.sent;
          entries = view.toArray();
          i = 0;

        case 5:
          if (!(i < entries.length)) {
            _context22.next = 18;
            break;
          }

          coins = entries[i];

          if (coins.isEmpty()) {
            _context22.next = 9;
            break;
          }

          return _context22.abrupt('continue', 15);

        case 9:
          _context22.next = 11;
          return this.getMeta(coins.hash);

        case 11:
          meta = _context22.sent;

          if (meta) {
            _context22.next = 14;
            break;
          }

          return _context22.abrupt('continue', 15);

        case 14:

          view.addTX(meta.tx, meta.height);

        case 15:
          i++;
          _context22.next = 5;
          break;

        case 18:
          return _context22.abrupt('return', view);

        case 19:
        case 'end':
          return _context22.stop();
      }
    }
  }, getSpentView, this);
}));

/**
 * Get coins necessary to be resurrected during a reorg.
 * @method
 * @param {Hash} hash
 * @returns {Promise} - Returns {@link Coin}[].
 */

ChainDB.prototype.getUndoCoins = co( /*#__PURE__*/_regenerator2.default.mark(function getUndoCoins(hash) {
  var data;
  return _regenerator2.default.wrap(function getUndoCoins$(_context23) {
    while (1) {
      switch (_context23.prev = _context23.next) {
        case 0:
          _context23.next = 2;
          return this.db.get(layout.u(hash));

        case 2:
          data = _context23.sent;

          if (data) {
            _context23.next = 5;
            break;
          }

          return _context23.abrupt('return', new UndoCoins());

        case 5:
          return _context23.abrupt('return', UndoCoins.fromRaw(data));

        case 6:
        case 'end':
          return _context23.stop();
      }
    }
  }, getUndoCoins, this);
}));

/**
 * Retrieve a block from the database (not filled with coins).
 * @method
 * @param {Hash} hash
 * @returns {Promise} - Returns {@link Block}.
 */

ChainDB.prototype.getBlock = co( /*#__PURE__*/_regenerator2.default.mark(function getBlock(hash) {
  var data;
  return _regenerator2.default.wrap(function getBlock$(_context24) {
    while (1) {
      switch (_context24.prev = _context24.next) {
        case 0:
          _context24.next = 2;
          return this.getRawBlock(hash);

        case 2:
          data = _context24.sent;

          if (data) {
            _context24.next = 5;
            break;
          }

          return _context24.abrupt('return');

        case 5:
          return _context24.abrupt('return', Block.fromRaw(data));

        case 6:
        case 'end':
          return _context24.stop();
      }
    }
  }, getBlock, this);
}));

/**
 * Retrieve a block from the database (not filled with coins).
 * @method
 * @param {Hash} hash
 * @returns {Promise} - Returns {@link Block}.
 */

ChainDB.prototype.getRawBlock = co( /*#__PURE__*/_regenerator2.default.mark(function getRawBlock(block) {
  var hash;
  return _regenerator2.default.wrap(function getRawBlock$(_context25) {
    while (1) {
      switch (_context25.prev = _context25.next) {
        case 0:
          if (!this.options.spv) {
            _context25.next = 2;
            break;
          }

          return _context25.abrupt('return');

        case 2:
          _context25.next = 4;
          return this.getHash(block);

        case 4:
          hash = _context25.sent;

          if (hash) {
            _context25.next = 7;
            break;
          }

          return _context25.abrupt('return');

        case 7:
          _context25.next = 9;
          return this.db.get(layout.b(hash));

        case 9:
          return _context25.abrupt('return', _context25.sent);

        case 10:
        case 'end':
          return _context25.stop();
      }
    }
  }, getRawBlock, this);
}));

/**
 * Get a historical block coin viewpoint.
 * @method
 * @param {Block} hash
 * @returns {Promise} - Returns {@link CoinView}.
 */

ChainDB.prototype.getBlockView = co( /*#__PURE__*/_regenerator2.default.mark(function getBlockView(block) {
  var view, undo, i, j, tx, input, prev, coins;
  return _regenerator2.default.wrap(function getBlockView$(_context26) {
    while (1) {
      switch (_context26.prev = _context26.next) {
        case 0:
          view = new CoinView();
          _context26.next = 3;
          return this.getUndoCoins(block.hash());

        case 3:
          undo = _context26.sent;

          if (!undo.isEmpty()) {
            _context26.next = 6;
            break;
          }

          return _context26.abrupt('return', view);

        case 6:

          for (i = block.txs.length - 1; i > 0; i--) {
            tx = block.txs[i];

            for (j = tx.inputs.length - 1; j >= 0; j--) {
              input = tx.inputs[j];
              prev = input.prevout.hash;

              if (!view.has(prev)) {
                assert(!undo.isEmpty());

                if (undo.top().height === -1) {
                  coins = new Coins();
                  coins.hash = prev;
                  coins.coinbase = false;
                  view.add(coins);
                }
              }

              undo.apply(view, input.prevout);
            }
          }

          // Undo coins should be empty.
          assert(undo.isEmpty(), 'Undo coins data inconsistency.');

          return _context26.abrupt('return', view);

        case 9:
        case 'end':
          return _context26.stop();
      }
    }
  }, getBlockView, this);
}));

/**
 * Get a transaction with metadata.
 * @method
 * @param {Hash} hash
 * @returns {Promise} - Returns {@link TXMeta}.
 */

ChainDB.prototype.getMeta = co( /*#__PURE__*/_regenerator2.default.mark(function getMeta(hash) {
  var data;
  return _regenerator2.default.wrap(function getMeta$(_context27) {
    while (1) {
      switch (_context27.prev = _context27.next) {
        case 0:
          if (this.options.indexTX) {
            _context27.next = 2;
            break;
          }

          return _context27.abrupt('return');

        case 2:
          _context27.next = 4;
          return this.db.get(layout.t(hash));

        case 4:
          data = _context27.sent;

          if (data) {
            _context27.next = 7;
            break;
          }

          return _context27.abrupt('return');

        case 7:
          return _context27.abrupt('return', TXMeta.fromRaw(data));

        case 8:
        case 'end':
          return _context27.stop();
      }
    }
  }, getMeta, this);
}));

/**
 * Retrieve a transaction.
 * @method
 * @param {Hash} hash
 * @returns {Promise} - Returns {@link TX}.
 */

ChainDB.prototype.getTX = co( /*#__PURE__*/_regenerator2.default.mark(function getTX(hash) {
  var meta;
  return _regenerator2.default.wrap(function getTX$(_context28) {
    while (1) {
      switch (_context28.prev = _context28.next) {
        case 0:
          _context28.next = 2;
          return this.getMeta(hash);

        case 2:
          meta = _context28.sent;

          if (meta) {
            _context28.next = 5;
            break;
          }

          return _context28.abrupt('return');

        case 5:
          return _context28.abrupt('return', meta.tx);

        case 6:
        case 'end':
          return _context28.stop();
      }
    }
  }, getTX, this);
}));

/**
 * @param {Hash} hash
 * @returns {Promise} - Returns Boolean.
 */

ChainDB.prototype.hasTX = function hasTX(hash) {
  if (!this.options.indexTX) return _promise2.default.resolve();

  return this.db.has(layout.t(hash));
};

/**
 * Get all coins pertinent to an address.
 * @method
 * @param {Address[]} addresses
 * @returns {Promise} - Returns {@link Coin}[].
 */

ChainDB.prototype.getCoinsByAddress = co( /*#__PURE__*/_regenerator2.default.mark(function getCoinsByAddress(addresses) {
  var coins, i, j, address, hash, keys, key, coin;
  return _regenerator2.default.wrap(function getCoinsByAddress$(_context29) {
    while (1) {
      switch (_context29.prev = _context29.next) {
        case 0:
          coins = [];

          if (this.options.indexAddress) {
            _context29.next = 3;
            break;
          }

          return _context29.abrupt('return', coins);

        case 3:

          if (!Array.isArray(addresses)) addresses = [addresses];

          i = 0;

        case 5:
          if (!(i < addresses.length)) {
            _context29.next = 25;
            break;
          }

          address = addresses[i];
          hash = Address.getHash(address);

          _context29.next = 10;
          return this.db.keys({
            gte: layout.C(hash, encoding.ZERO_HASH, 0),
            lte: layout.C(hash, encoding.MAX_HASH, 0xffffffff),
            parse: layout.Cc
          });

        case 10:
          keys = _context29.sent;
          j = 0;

        case 12:
          if (!(j < keys.length)) {
            _context29.next = 22;
            break;
          }

          key = keys[j];
          _context29.next = 16;
          return this.getCoin(key[0], key[1]);

        case 16:
          coin = _context29.sent;

          assert(coin);
          coins.push(coin);

        case 19:
          j++;
          _context29.next = 12;
          break;

        case 22:
          i++;
          _context29.next = 5;
          break;

        case 25:
          return _context29.abrupt('return', coins);

        case 26:
        case 'end':
          return _context29.stop();
      }
    }
  }, getCoinsByAddress, this);
}));

/**
 * Get all transaction hashes to an address.
 * @method
 * @param {Address[]} addresses
 * @returns {Promise} - Returns {@link Hash}[].
 */

ChainDB.prototype.getHashesByAddress = co( /*#__PURE__*/_regenerator2.default.mark(function getHashesByAddress(addresses) {
  var hashes, i, address, hash;
  return _regenerator2.default.wrap(function getHashesByAddress$(_context30) {
    while (1) {
      switch (_context30.prev = _context30.next) {
        case 0:
          hashes = {};

          if (!(!this.options.indexTX || !this.options.indexAddress)) {
            _context30.next = 3;
            break;
          }

          return _context30.abrupt('return', []);

        case 3:
          i = 0;

        case 4:
          if (!(i < addresses.length)) {
            _context30.next = 12;
            break;
          }

          address = addresses[i];
          hash = Address.getHash(address);

          _context30.next = 9;
          return this.db.keys({
            gte: layout.T(hash, encoding.ZERO_HASH),
            lte: layout.T(hash, encoding.MAX_HASH),
            parse: function parse(key) {
              var hash = layout.Tt(key);
              hashes[hash] = true;
            }
          });

        case 9:
          i++;
          _context30.next = 4;
          break;

        case 12:
          return _context30.abrupt('return', (0, _keys2.default)(hashes));

        case 13:
        case 'end':
          return _context30.stop();
      }
    }
  }, getHashesByAddress, this);
}));

/**
 * Get all transactions pertinent to an address.
 * @method
 * @param {Address[]} addresses
 * @returns {Promise} - Returns {@link TX}[].
 */

ChainDB.prototype.getTXByAddress = co( /*#__PURE__*/_regenerator2.default.mark(function getTXByAddress(addresses) {
  var mtxs, out, i, mtx;
  return _regenerator2.default.wrap(function getTXByAddress$(_context31) {
    while (1) {
      switch (_context31.prev = _context31.next) {
        case 0:
          _context31.next = 2;
          return this.getMetaByAddress(addresses);

        case 2:
          mtxs = _context31.sent;
          out = [];


          for (i = 0; i < mtxs.length; i++) {
            mtx = mtxs[i];
            out.push(mtx.tx);
          }

          return _context31.abrupt('return', out);

        case 6:
        case 'end':
          return _context31.stop();
      }
    }
  }, getTXByAddress, this);
}));

/**
 * Get all transactions pertinent to an address.
 * @method
 * @param {Address[]} addresses
 * @returns {Promise} - Returns {@link TXMeta}[].
 */

ChainDB.prototype.getMetaByAddress = co( /*#__PURE__*/_regenerator2.default.mark(function getTXByAddress(addresses) {
  var txs, i, hashes, hash, tx;
  return _regenerator2.default.wrap(function getTXByAddress$(_context32) {
    while (1) {
      switch (_context32.prev = _context32.next) {
        case 0:
          txs = [];

          if (!(!this.options.indexTX || !this.options.indexAddress)) {
            _context32.next = 3;
            break;
          }

          return _context32.abrupt('return', txs);

        case 3:

          if (!Array.isArray(addresses)) addresses = [addresses];

          _context32.next = 6;
          return this.getHashesByAddress(addresses);

        case 6:
          hashes = _context32.sent;
          i = 0;

        case 8:
          if (!(i < hashes.length)) {
            _context32.next = 18;
            break;
          }

          hash = hashes[i];
          _context32.next = 12;
          return this.getMeta(hash);

        case 12:
          tx = _context32.sent;

          assert(tx);
          txs.push(tx);

        case 15:
          i++;
          _context32.next = 8;
          break;

        case 18:
          return _context32.abrupt('return', txs);

        case 19:
        case 'end':
          return _context32.stop();
      }
    }
  }, getTXByAddress, this);
}));

/**
 * Scan the blockchain for transactions containing specified address hashes.
 * @method
 * @param {Hash} start - Block hash to start at.
 * @param {Bloom} filter - Bloom filter containing tx and address hashes.
 * @param {Function} iter - Iterator.
 * @returns {Promise}
 */

ChainDB.prototype.scan = co( /*#__PURE__*/_regenerator2.default.mark(function scan(start, filter, iter) {
  var total, i, j, entry, hash, tx, txs, block, found, input, output, prevout;
  return _regenerator2.default.wrap(function scan$(_context33) {
    while (1) {
      switch (_context33.prev = _context33.next) {
        case 0:
          total = 0;


          if (start == null) start = this.network.genesis.hash;

          if (typeof start === 'number') this.logger.info('Scanning from height %d.', start);else this.logger.info('Scanning from block %s.', util.revHex(start));

          _context33.next = 5;
          return this.getEntry(start);

        case 5:
          entry = _context33.sent;

          if (entry) {
            _context33.next = 8;
            break;
          }

          return _context33.abrupt('return');

        case 8:
          _context33.next = 10;
          return entry.isMainChain();

        case 10:
          if (_context33.sent) {
            _context33.next = 12;
            break;
          }

          throw new Error('Cannot rescan an alternate chain.');

        case 12:
          if (!entry) {
            _context33.next = 67;
            break;
          }

          _context33.next = 15;
          return this.getBlock(entry.hash);

        case 15:
          block = _context33.sent;

          txs = [];
          total++;

          if (block) {
            _context33.next = 27;
            break;
          }

          if (!(!this.options.spv && !this.options.prune)) {
            _context33.next = 21;
            break;
          }

          throw new Error('Block not found.');

        case 21:
          _context33.next = 23;
          return iter(entry, txs);

        case 23:
          _context33.next = 25;
          return entry.getNext();

        case 25:
          entry = _context33.sent;
          return _context33.abrupt('continue', 12);

        case 27:

          this.logger.info('Scanning block %s (%d).', entry.rhash(), entry.height);

          i = 0;

        case 29:
          if (!(i < block.txs.length)) {
            _context33.next = 60;
            break;
          }

          tx = block.txs[i];
          found = false;

          j = 0;

        case 33:
          if (!(j < tx.outputs.length)) {
            _context33.next = 42;
            break;
          }

          output = tx.outputs[j];
          hash = output.getHash();

          if (hash) {
            _context33.next = 38;
            break;
          }

          return _context33.abrupt('continue', 39);

        case 38:

          if (filter.test(hash)) {
            prevout = Outpoint.fromTX(tx, j);
            filter.add(prevout.toRaw());
            found = true;
          }

        case 39:
          j++;
          _context33.next = 33;
          break;

        case 42:
          if (!found) {
            _context33.next = 45;
            break;
          }

          txs.push(tx);
          return _context33.abrupt('continue', 57);

        case 45:
          if (!(i === 0)) {
            _context33.next = 47;
            break;
          }

          return _context33.abrupt('continue', 57);

        case 47:
          j = 0;

        case 48:
          if (!(j < tx.inputs.length)) {
            _context33.next = 57;
            break;
          }

          input = tx.inputs[j];
          prevout = input.prevout;

          if (!filter.test(prevout.toRaw())) {
            _context33.next = 54;
            break;
          }

          txs.push(tx);
          return _context33.abrupt('break', 57);

        case 54:
          j++;
          _context33.next = 48;
          break;

        case 57:
          i++;
          _context33.next = 29;
          break;

        case 60:
          _context33.next = 62;
          return iter(entry, txs);

        case 62:
          _context33.next = 64;
          return entry.getNext();

        case 64:
          entry = _context33.sent;
          _context33.next = 12;
          break;

        case 67:

          this.logger.info('Finished scanning %d blocks.', total);

        case 68:
        case 'end':
          return _context33.stop();
      }
    }
  }, scan, this);
}));

/**
 * Save an entry to the database and optionally
 * connect it as the tip. Note that this method
 * does _not_ perform any verification which is
 * instead performed in {@link Chain#add}.
 * @method
 * @param {ChainEntry} entry
 * @param {Block} block
 * @param {CoinView?} view - Will not connect if null.
 * @returns {Promise}
 */

ChainDB.prototype.save = co( /*#__PURE__*/_regenerator2.default.mark(function save(entry, block, view) {
  return _regenerator2.default.wrap(function save$(_context34) {
    while (1) {
      switch (_context34.prev = _context34.next) {
        case 0:
          this.start();
          _context34.prev = 1;
          _context34.next = 4;
          return this._save(entry, block, view);

        case 4:
          _context34.next = 10;
          break;

        case 6:
          _context34.prev = 6;
          _context34.t0 = _context34['catch'](1);

          this.drop();
          throw _context34.t0;

        case 10:
          _context34.next = 12;
          return this.commit();

        case 12:
        case 'end':
          return _context34.stop();
      }
    }
  }, save, this, [[1, 6]]);
}));

/**
 * Save an entry without a batch.
 * @method
 * @private
 * @param {ChainEntry} entry
 * @param {Block} block
 * @param {CoinView?} view
 * @returns {Promise}
 */

ChainDB.prototype._save = co( /*#__PURE__*/_regenerator2.default.mark(function save(entry, block, view) {
  var hash;
  return _regenerator2.default.wrap(function save$(_context35) {
    while (1) {
      switch (_context35.prev = _context35.next) {
        case 0:
          hash = block.hash();

          // Hash->height index.

          this.put(layout.h(hash), U32(entry.height));

          // Entry data.
          this.put(layout.e(hash), entry.toRaw());
          this.cacheHash.push(entry.hash, entry);

          // Tip index.
          this.del(layout.p(entry.prevBlock));
          this.put(layout.p(hash), DUMMY);

          // Update state caches.
          this.saveUpdates();

          if (view) {
            _context35.next = 11;
            break;
          }

          _context35.next = 10;
          return this.saveBlock(entry, block);

        case 10:
          return _context35.abrupt('return');

        case 11:

          // Hash->next-block index.
          this.put(layout.n(entry.prevBlock), hash);

          // Height->hash index.
          this.put(layout.H(entry.height), hash);
          this.cacheHeight.push(entry.height, entry);

          // Connect block and save data.
          _context35.next = 16;
          return this.saveBlock(entry, block, view);

        case 16:

          // Commit new chain state.
          this.put(layout.R, this.pending.commit(hash));

        case 17:
        case 'end':
          return _context35.stop();
      }
    }
  }, save, this);
}));

/**
 * Reconnect the block to the chain.
 * @method
 * @param {ChainEntry} entry
 * @param {Block} block
 * @param {CoinView} view
 * @returns {Promise}
 */

ChainDB.prototype.reconnect = co( /*#__PURE__*/_regenerator2.default.mark(function reconnect(entry, block, view) {
  return _regenerator2.default.wrap(function reconnect$(_context36) {
    while (1) {
      switch (_context36.prev = _context36.next) {
        case 0:
          this.start();
          _context36.prev = 1;
          _context36.next = 4;
          return this._reconnect(entry, block, view);

        case 4:
          _context36.next = 10;
          break;

        case 6:
          _context36.prev = 6;
          _context36.t0 = _context36['catch'](1);

          this.drop();
          throw _context36.t0;

        case 10:
          _context36.next = 12;
          return this.commit();

        case 12:
        case 'end':
          return _context36.stop();
      }
    }
  }, reconnect, this, [[1, 6]]);
}));

/**
 * Reconnect block without a batch.
 * @method
 * @private
 * @param {ChainEntry} entry
 * @param {Block} block
 * @param {CoinView} view
 * @returns {Promise}
 */

ChainDB.prototype._reconnect = co( /*#__PURE__*/_regenerator2.default.mark(function reconnect(entry, block, view) {
  var hash;
  return _regenerator2.default.wrap(function reconnect$(_context37) {
    while (1) {
      switch (_context37.prev = _context37.next) {
        case 0:
          hash = block.hash();

          // We can now add a hash->next-block index.

          this.put(layout.n(entry.prevBlock), hash);

          // We can now add a height->hash index.
          this.put(layout.H(entry.height), hash);
          this.cacheHeight.push(entry.height, entry);

          // Re-insert into cache.
          this.cacheHash.push(entry.hash, entry);

          // Update state caches.
          this.saveUpdates();

          // Connect inputs.
          _context37.next = 8;
          return this.connectBlock(entry, block, view);

        case 8:

          // Update chain state.
          this.put(layout.R, this.pending.commit(hash));

        case 9:
        case 'end':
          return _context37.stop();
      }
    }
  }, reconnect, this);
}));

/**
 * Disconnect block from the chain.
 * @method
 * @param {ChainEntry} entry
 * @param {Block} block
 * @returns {Promise}
 */

ChainDB.prototype.disconnect = co( /*#__PURE__*/_regenerator2.default.mark(function disconnect(entry, block) {
  var view;
  return _regenerator2.default.wrap(function disconnect$(_context38) {
    while (1) {
      switch (_context38.prev = _context38.next) {
        case 0:

          this.start();

          _context38.prev = 1;
          _context38.next = 4;
          return this._disconnect(entry, block);

        case 4:
          view = _context38.sent;
          _context38.next = 11;
          break;

        case 7:
          _context38.prev = 7;
          _context38.t0 = _context38['catch'](1);

          this.drop();
          throw _context38.t0;

        case 11:
          _context38.next = 13;
          return this.commit();

        case 13:
          return _context38.abrupt('return', view);

        case 14:
        case 'end':
          return _context38.stop();
      }
    }
  }, disconnect, this, [[1, 7]]);
}));

/**
 * Disconnect block without a batch.
 * @private
 * @method
 * @param {ChainEntry} entry
 * @param {Block} block
 * @returns {Promise} - Returns {@link CoinView}.
 */

ChainDB.prototype._disconnect = co( /*#__PURE__*/_regenerator2.default.mark(function disconnect(entry, block) {
  var view;
  return _regenerator2.default.wrap(function disconnect$(_context39) {
    while (1) {
      switch (_context39.prev = _context39.next) {
        case 0:

          // Remove hash->next-block index.
          this.del(layout.n(entry.prevBlock));

          // Remove height->hash index.
          this.del(layout.H(entry.height));
          this.cacheHeight.unpush(entry.height);

          // Update state caches.
          this.saveUpdates();

          // Disconnect inputs.
          _context39.next = 6;
          return this.disconnectBlock(entry, block);

        case 6:
          view = _context39.sent;


          // Revert chain state to previous tip.
          this.put(layout.R, this.pending.commit(entry.prevBlock));

          return _context39.abrupt('return', view);

        case 9:
        case 'end':
          return _context39.stop();
      }
    }
  }, disconnect, this);
}));

/**
 * Save state cache updates.
 * @private
 */

ChainDB.prototype.saveUpdates = function saveUpdates() {
  var updates = this.stateCache.updates;
  var i, update;

  if (updates.length === 0) return;

  this.logger.info('Saving %d state cache updates.', updates.length);

  for (i = 0; i < updates.length; i++) {
    update = updates[i];
    this.put(layout.v(update.bit, update.hash), update.toRaw());
  }
};

/**
 * Reset the chain to a height or hash. Useful for replaying
 * the blockchain download for SPV.
 * @method
 * @param {Hash|Number} block - hash/height
 * @returns {Promise}
 */

ChainDB.prototype.reset = co( /*#__PURE__*/_regenerator2.default.mark(function reset(block) {
  var entry, tip;
  return _regenerator2.default.wrap(function reset$(_context40) {
    while (1) {
      switch (_context40.prev = _context40.next) {
        case 0:
          _context40.next = 2;
          return this.getEntry(block);

        case 2:
          entry = _context40.sent;

          if (entry) {
            _context40.next = 5;
            break;
          }

          throw new Error('Block not found.');

        case 5:
          _context40.next = 7;
          return entry.isMainChain();

        case 7:
          if (_context40.sent) {
            _context40.next = 9;
            break;
          }

          throw new Error('Cannot reset on alternate chain.');

        case 9:
          if (!this.options.prune) {
            _context40.next = 11;
            break;
          }

          throw new Error('Cannot reset when pruned.');

        case 11:
          _context40.next = 13;
          return this.removeChains();

        case 13:
          _context40.next = 15;
          return this.getTip();

        case 15:
          tip = _context40.sent;

          assert(tip);

          this.logger.debug('Resetting main chain to: %s', entry.rhash());

        case 18:
          this.start();

          // Stop once we hit our target tip.

          if (!(tip.hash === entry.hash)) {
            _context40.next = 24;
            break;
          }

          this.put(layout.R, this.pending.commit(tip.hash));
          _context40.next = 23;
          return this.commit();

        case 23:
          return _context40.abrupt('break', 51);

        case 24:

          assert(!tip.isGenesis());

          // Revert the tip index.
          this.del(layout.p(tip.hash));
          this.put(layout.p(tip.prevBlock), DUMMY);

          // Remove all records (including
          // main-chain-only records).
          this.del(layout.H(tip.height));
          this.del(layout.h(tip.hash));
          this.del(layout.e(tip.hash));
          this.del(layout.n(tip.prevBlock));

          // Disconnect and remove block data.
          _context40.prev = 31;
          _context40.next = 34;
          return this.removeBlock(tip);

        case 34:
          _context40.next = 40;
          break;

        case 36:
          _context40.prev = 36;
          _context40.t0 = _context40['catch'](31);

          this.drop();
          throw _context40.t0;

        case 40:

          // Revert chain state to previous tip.
          this.put(layout.R, this.pending.commit(tip.prevBlock));

          _context40.next = 43;
          return this.commit();

        case 43:

          // Update caches _after_ successful commit.
          this.cacheHeight.remove(tip.height);
          this.cacheHash.remove(tip.hash);

          _context40.next = 47;
          return this.getEntry(tip.prevBlock);

        case 47:
          tip = _context40.sent;

          assert(tip);

        case 49:
          _context40.next = 18;
          break;

        case 51:
          return _context40.abrupt('return', tip);

        case 52:
        case 'end':
          return _context40.stop();
      }
    }
  }, reset, this, [[31, 36]]);
}));

/**
 * Remove all alternate chains.
 * @method
 * @returns {Promise}
 */

ChainDB.prototype.removeChains = co( /*#__PURE__*/_regenerator2.default.mark(function removeChains() {
  var tips, i;
  return _regenerator2.default.wrap(function removeChains$(_context41) {
    while (1) {
      switch (_context41.prev = _context41.next) {
        case 0:
          _context41.next = 2;
          return this.getTips();

        case 2:
          tips = _context41.sent;


          // Note that this has to be
          // one giant atomic write!
          this.start();

          _context41.prev = 4;
          i = 0;

        case 6:
          if (!(i < tips.length)) {
            _context41.next = 12;
            break;
          }

          _context41.next = 9;
          return this._removeChain(tips[i]);

        case 9:
          i++;
          _context41.next = 6;
          break;

        case 12:
          _context41.next = 18;
          break;

        case 14:
          _context41.prev = 14;
          _context41.t0 = _context41['catch'](4);

          this.drop();
          throw _context41.t0;

        case 18:
          _context41.next = 20;
          return this.commit();

        case 20:
        case 'end':
          return _context41.stop();
      }
    }
  }, removeChains, this, [[4, 14]]);
}));

/**
 * Remove an alternate chain.
 * @method
 * @private
 * @param {Hash} hash - Alternate chain tip.
 * @returns {Promise}
 */

ChainDB.prototype._removeChain = co( /*#__PURE__*/_regenerator2.default.mark(function removeChain(hash) {
  var tip;
  return _regenerator2.default.wrap(function removeChain$(_context42) {
    while (1) {
      switch (_context42.prev = _context42.next) {
        case 0:
          _context42.next = 2;
          return this.getEntry(hash);

        case 2:
          tip = _context42.sent;

          if (tip) {
            _context42.next = 5;
            break;
          }

          throw new Error('Alternate chain tip not found.');

        case 5:

          this.logger.debug('Removing alternate chain: %s.', tip.rhash());

        case 6:
          _context42.next = 8;
          return tip.isMainChain();

        case 8:
          if (!_context42.sent) {
            _context42.next = 10;
            break;
          }

          return _context42.abrupt('break', 22);

        case 10:

          assert(!tip.isGenesis());

          // Remove all non-main-chain records.
          this.del(layout.p(tip.hash));
          this.del(layout.h(tip.hash));
          this.del(layout.e(tip.hash));
          this.del(layout.b(tip.hash));

          // Queue up hash to be removed
          // on successful write.
          this.cacheHash.unpush(tip.hash);

          _context42.next = 18;
          return this.getEntry(tip.prevBlock);

        case 18:
          tip = _context42.sent;

          assert(tip);

        case 20:
          _context42.next = 6;
          break;

        case 22:
        case 'end':
          return _context42.stop();
      }
    }
  }, removeChain, this);
}));

/**
 * Save a block (not an entry) to the
 * database and potentially connect the inputs.
 * @method
 * @param {ChainEntry} entry
 * @param {Block} block
 * @param {CoinView?} view
 * @returns {Promise} - Returns {@link Block}.
 */

ChainDB.prototype.saveBlock = co( /*#__PURE__*/_regenerator2.default.mark(function saveBlock(entry, block, view) {
  var hash;
  return _regenerator2.default.wrap(function saveBlock$(_context43) {
    while (1) {
      switch (_context43.prev = _context43.next) {
        case 0:
          hash = block.hash();

          if (!this.options.spv) {
            _context43.next = 3;
            break;
          }

          return _context43.abrupt('return');

        case 3:

          // Write actual block data (this may be
          // better suited to flat files in the future).
          this.put(layout.b(hash), block.toRaw());

          if (view) {
            _context43.next = 6;
            break;
          }

          return _context43.abrupt('return');

        case 6:
          _context43.next = 8;
          return this.connectBlock(entry, block, view);

        case 8:
        case 'end':
          return _context43.stop();
      }
    }
  }, saveBlock, this);
}));

/**
 * Remove a block (not an entry) to the database.
 * Disconnect inputs.
 * @method
 * @param {ChainEntry} entry
 * @returns {Promise} - Returns {@link Block}.
 */

ChainDB.prototype.removeBlock = co( /*#__PURE__*/_regenerator2.default.mark(function removeBlock(entry) {
  var block;
  return _regenerator2.default.wrap(function removeBlock$(_context44) {
    while (1) {
      switch (_context44.prev = _context44.next) {
        case 0:
          if (!this.options.spv) {
            _context44.next = 2;
            break;
          }

          return _context44.abrupt('return');

        case 2:
          _context44.next = 4;
          return this.getBlock(entry.hash);

        case 4:
          block = _context44.sent;

          if (block) {
            _context44.next = 7;
            break;
          }

          throw new Error('Block not found.');

        case 7:

          this.del(layout.b(block.hash()));

          _context44.next = 10;
          return this.disconnectBlock(entry, block);

        case 10:
          return _context44.abrupt('return', _context44.sent);

        case 11:
        case 'end':
          return _context44.stop();
      }
    }
  }, removeBlock, this);
}));

/**
 * Commit coin view to database.
 * @private
 * @param {CoinView} view
 */

ChainDB.prototype.saveView = function saveView(view) {
  var i, coins, raw;

  view = view.toArray();

  for (i = 0; i < view.length; i++) {
    coins = view[i];
    if (coins.isEmpty()) {
      this.del(layout.c(coins.hash));
      this.coinCache.unpush(coins.hash);
    } else {
      raw = coins.toRaw();
      this.put(layout.c(coins.hash), raw);
      this.coinCache.push(coins.hash, raw);
    }
  }
};

/**
 * Connect block inputs.
 * @method
 * @param {ChainEntry} entry
 * @param {Block} block
 * @param {CoinView} view
 * @returns {Promise} - Returns {@link Block}.
 */

ChainDB.prototype.connectBlock = co( /*#__PURE__*/_regenerator2.default.mark(function connectBlock(entry, block, view) {
  var hash, i, j, tx, input, output;
  return _regenerator2.default.wrap(function connectBlock$(_context45) {
    while (1) {
      switch (_context45.prev = _context45.next) {
        case 0:
          hash = block.hash();

          if (!this.options.spv) {
            _context45.next = 3;
            break;
          }

          return _context45.abrupt('return');

        case 3:

          this.pending.connect(block);

          // Genesis block's coinbase is unspendable.

          if (!this.chain.isGenesis(block)) {
            _context45.next = 6;
            break;
          }

          return _context45.abrupt('return');

        case 6:
          i = 0;

        case 7:
          if (!(i < block.txs.length)) {
            _context45.next = 23;
            break;
          }

          tx = block.txs[i];

          if (i > 0) {
            for (j = 0; j < tx.inputs.length; j++) {
              input = tx.inputs[j];
              this.pending.spend(view.getOutput(input));
            }
          }

          j = 0;

        case 11:
          if (!(j < tx.outputs.length)) {
            _context45.next = 19;
            break;
          }

          output = tx.outputs[j];

          if (!output.script.isUnspendable()) {
            _context45.next = 15;
            break;
          }

          return _context45.abrupt('continue', 16);

        case 15:

          this.pending.add(output);

        case 16:
          j++;
          _context45.next = 11;
          break;

        case 19:

          // Index the transaction if enabled.
          this.indexTX(tx, view, entry, i);

        case 20:
          i++;
          _context45.next = 7;
          break;

        case 23:

          // Commit new coin state.
          this.saveView(view);

          // Write undo coins (if there are any).
          if (!view.undo.isEmpty()) this.put(layout.u(hash), view.undo.commit());

          // Prune height-288 if pruning is enabled.
          _context45.next = 27;
          return this.pruneBlock(entry);

        case 27:
        case 'end':
          return _context45.stop();
      }
    }
  }, connectBlock, this);
}));

/**
 * Disconnect block inputs.
 * @method
 * @param {ChainEntry} entry
 * @param {Block} block
 * @returns {Promise} - Returns {@link CoinView}.
 */

ChainDB.prototype.disconnectBlock = co( /*#__PURE__*/_regenerator2.default.mark(function disconnectBlock(entry, block) {
  var view, hash, i, j, undo, tx, input, output;
  return _regenerator2.default.wrap(function disconnectBlock$(_context46) {
    while (1) {
      switch (_context46.prev = _context46.next) {
        case 0:
          view = new CoinView();
          hash = block.hash();

          if (!this.options.spv) {
            _context46.next = 4;
            break;
          }

          return _context46.abrupt('return', view);

        case 4:
          _context46.next = 6;
          return this.getUndoCoins(hash);

        case 6:
          undo = _context46.sent;


          this.pending.disconnect(block);

          // Disconnect all transactions.
          i = block.txs.length - 1;

        case 9:
          if (!(i >= 0)) {
            _context46.next = 29;
            break;
          }

          tx = block.txs[i];

          if (!(i > 0)) {
            _context46.next = 15;
            break;
          }

          _context46.next = 14;
          return view.ensureInputs(this, tx);

        case 14:

          for (j = tx.inputs.length - 1; j >= 0; j--) {
            input = tx.inputs[j];
            undo.apply(view, input.prevout);
            this.pending.add(view.getOutput(input));
          }

        case 15:

          // Remove any created coins.
          view.removeTX(tx, entry.height);

          j = tx.outputs.length - 1;

        case 17:
          if (!(j >= 0)) {
            _context46.next = 25;
            break;
          }

          output = tx.outputs[j];

          if (!output.script.isUnspendable()) {
            _context46.next = 21;
            break;
          }

          return _context46.abrupt('continue', 22);

        case 21:

          this.pending.spend(output);

        case 22:
          j--;
          _context46.next = 17;
          break;

        case 25:

          // Remove from transaction index.
          this.unindexTX(tx, view);

        case 26:
          i--;
          _context46.next = 9;
          break;

        case 29:

          // Undo coins should be empty.
          assert(undo.isEmpty(), 'Undo coins data inconsistency.');

          // Commit new coin state.
          this.saveView(view);

          // Remove undo coins.
          this.del(layout.u(hash));

          return _context46.abrupt('return', view);

        case 33:
        case 'end':
          return _context46.stop();
      }
    }
  }, disconnectBlock, this);
}));

/**
 * Prune a block from the chain and
 * add current block to the prune queue.
 * @method
 * @private
 * @param {ChainEntry} entry
 * @returns {Promise}
 */

ChainDB.prototype.pruneBlock = co( /*#__PURE__*/_regenerator2.default.mark(function pruneBlock(entry) {
  var height, hash;
  return _regenerator2.default.wrap(function pruneBlock$(_context47) {
    while (1) {
      switch (_context47.prev = _context47.next) {
        case 0:
          if (!this.options.spv) {
            _context47.next = 2;
            break;
          }

          return _context47.abrupt('return');

        case 2:
          if (this.options.prune) {
            _context47.next = 4;
            break;
          }

          return _context47.abrupt('return');

        case 4:

          height = entry.height - this.network.block.keepBlocks;

          if (!(height <= this.network.block.pruneAfterHeight)) {
            _context47.next = 7;
            break;
          }

          return _context47.abrupt('return');

        case 7:
          _context47.next = 9;
          return this.getHash(height);

        case 9:
          hash = _context47.sent;

          if (hash) {
            _context47.next = 12;
            break;
          }

          return _context47.abrupt('return');

        case 12:

          this.del(layout.b(hash));
          this.del(layout.u(hash));

        case 14:
        case 'end':
          return _context47.stop();
      }
    }
  }, pruneBlock, this);
}));

/**
 * Save database options.
 * @returns {Promise}
 */

ChainDB.prototype.saveFlags = function saveFlags() {
  var flags = ChainFlags.fromOptions(this.options);
  return this.db.put(layout.O, flags.toRaw());
};

/**
 * Index a transaction by txid and address.
 * @private
 * @param {TX} tx
 * @param {CoinView} view
 * @param {ChainEntry} entry
 * @param {Number} index
 */

ChainDB.prototype.indexTX = function indexTX(tx, view, entry, index) {
  var hash = tx.hash();
  var i, meta, input, output;
  var prevout, hashes, addr;

  if (this.options.indexTX) {
    meta = TXMeta.fromTX(tx, entry, index);

    this.put(layout.t(hash), meta.toRaw());

    if (this.options.indexAddress) {
      hashes = tx.getHashes(view);
      for (i = 0; i < hashes.length; i++) {
        addr = hashes[i];
        this.put(layout.T(addr, hash), DUMMY);
      }
    }
  }

  if (!this.options.indexAddress) return;

  if (!tx.isCoinbase()) {
    for (i = 0; i < tx.inputs.length; i++) {
      input = tx.inputs[i];
      prevout = input.prevout;
      addr = view.getOutput(input).getHash();

      if (!addr) continue;

      this.del(layout.C(addr, prevout.hash, prevout.index));
    }
  }

  for (i = 0; i < tx.outputs.length; i++) {
    output = tx.outputs[i];
    addr = output.getHash();

    if (!addr) continue;

    this.put(layout.C(addr, hash, i), DUMMY);
  }
};

/**
 * Remove transaction from index.
 * @private
 * @param {TX} tx
 * @param {CoinView} view
 */

ChainDB.prototype.unindexTX = function unindexTX(tx, view) {
  var hash = tx.hash();
  var i, input, output, prevout, hashes, addr;

  if (this.options.indexTX) {
    this.del(layout.t(hash));
    if (this.options.indexAddress) {
      hashes = tx.getHashes(view);
      for (i = 0; i < hashes.length; i++) {
        addr = hashes[i];
        this.del(layout.T(addr, hash));
      }
    }
  }

  if (!this.options.indexAddress) return;

  if (!tx.isCoinbase()) {
    for (i = 0; i < tx.inputs.length; i++) {
      input = tx.inputs[i];
      prevout = input.prevout;
      addr = view.getOutput(input).getHash();

      if (!addr) continue;

      this.put(layout.C(addr, prevout.hash, prevout.index), DUMMY);
    }
  }

  for (i = 0; i < tx.outputs.length; i++) {
    output = tx.outputs[i];
    addr = output.getHash();

    if (!addr) continue;

    this.del(layout.C(addr, hash, i));
  }
};

/**
 * Chain Flags
 * @alias module:blockchain.ChainFlags
 * @constructor
 */

function ChainFlags(options) {
  if (!(this instanceof ChainFlags)) return new ChainFlags(options);

  this.network = Network.primary;
  this.spv = false;
  this.witness = true;
  this.prune = false;
  this.indexTX = false;
  this.indexAddress = false;

  if (options) this.fromOptions(options);
}

ChainFlags.prototype.fromOptions = function fromOptions(options) {
  this.network = Network.get(options.network);

  if (options.spv != null) {
    assert(typeof options.spv === 'boolean');
    this.spv = options.spv;
  }

  if (options.prune != null) {
    assert(typeof options.prune === 'boolean');
    this.prune = options.prune;
  }

  if (options.indexTX != null) {
    assert(typeof options.indexTX === 'boolean');
    this.indexTX = options.indexTX;
  }

  if (options.indexAddress != null) {
    assert(typeof options.indexAddress === 'boolean');
    this.indexAddress = options.indexAddress;
  }

  return this;
};

ChainFlags.fromOptions = function fromOptions(data) {
  return new ChainFlags().fromOptions(data);
};

ChainFlags.prototype.toRaw = function toRaw() {
  var bw = new StaticWriter(12);
  var flags = 0;

  if (this.spv) flags |= 1 << 0;

  if (this.witness) flags |= 1 << 1;

  if (this.prune) flags |= 1 << 2;

  if (this.indexTX) flags |= 1 << 3;

  if (this.indexAddress) flags |= 1 << 4;

  bw.writeU32(this.network.magic);
  bw.writeU32(flags);
  bw.writeU32(0);

  return bw.render();
};

ChainFlags.prototype.fromRaw = function fromRaw(data) {
  var br = new BufferReader(data);
  var flags;

  this.network = Network.fromMagic(br.readU32());

  flags = br.readU32();

  this.spv = (flags & 1) !== 0;
  this.witness = (flags & 2) !== 0;
  this.prune = (flags & 4) !== 0;
  this.indexTX = (flags & 8) !== 0;
  this.indexAddress = (flags & 16) !== 0;

  return this;
};

ChainFlags.fromRaw = function fromRaw(data) {
  return new ChainFlags().fromRaw(data);
};

/**
 * Chain State
 * @alias module:blockchain.ChainState
 * @constructor
 */

function ChainState() {
  this.tip = encoding.ZERO_HASH;
  this.tx = 0;
  this.coin = 0;
  this.value = 0;
  this.committed = false;
}

ChainState.prototype.hash = function () {
  return this.tip.toString('hex');
};

ChainState.prototype.rhash = function () {
  return util.revHex(this.hash());
};

ChainState.prototype.clone = function clone() {
  var state = new ChainState();
  state.tip = this.tip;
  state.tx = this.tx;
  state.coin = this.coin;
  state.value = this.value;
  return state;
};

ChainState.prototype.connect = function connect(block) {
  this.tx += block.txs.length;
};

ChainState.prototype.disconnect = function connect(block) {
  this.tx -= block.txs.length;
};

ChainState.prototype.add = function add(coin) {
  this.coin++;
  this.value += coin.value;
};

ChainState.prototype.spend = function spend(coin) {
  this.coin--;
  this.value -= coin.value;
};

ChainState.prototype.commit = function commit(hash) {
  if (typeof hash === 'string') hash = Buffer.from(hash, 'hex');
  this.tip = hash;
  this.committed = true;
  return this.toRaw();
};

ChainState.prototype.toRaw = function toRaw() {
  var bw = new StaticWriter(56);
  bw.writeHash(this.tip);
  bw.writeU64(this.tx);
  bw.writeU64(this.coin);
  bw.writeU64(this.value);
  return bw.render();
};

ChainState.fromRaw = function fromRaw(data) {
  var state = new ChainState();
  var br = new BufferReader(data);
  state.tip = br.readHash();
  state.tx = br.readU53();
  state.coin = br.readU53();
  state.value = br.readU53();
  return state;
};

/**
 * StateCache
 * @alias module:blockchain.StateCache
 * @constructor
 */

function StateCache(network) {
  this.network = network;
  this.bits = [];
  this.updates = [];
  this._init();
}

StateCache.prototype._init = function _init() {
  var i, deployment;

  for (i = 0; i < 32; i++) {
    this.bits.push(null);
  }for (i = 0; i < this.network.deploys.length; i++) {
    deployment = this.network.deploys[i];
    assert(!this.bits[deployment.bit]);
    this.bits[deployment.bit] = {};
  }
};

StateCache.prototype.set = function set(bit, entry, state) {
  var cache = this.bits[bit];

  assert(cache);

  if (cache[entry.hash] !== state) {
    cache[entry.hash] = state;
    this.updates.push(new CacheUpdate(bit, entry.hash, state));
  }
};

StateCache.prototype.get = function get(bit, entry) {
  var cache = this.bits[bit];
  var state;

  assert(cache);

  state = cache[entry.hash];

  if (state == null) return -1;

  return state;
};

StateCache.prototype.commit = function commit() {
  this.updates.length = 0;
};

StateCache.prototype.drop = function drop() {
  var i, update, cache;

  for (i = 0; i < this.updates.length; i++) {
    update = this.updates[i];
    cache = this.bits[update.bit];
    assert(cache);
    delete cache[update.hash];
  }

  this.updates.length = 0;
};

StateCache.prototype.insert = function insert(bit, hash, state) {
  var cache = this.bits[bit];
  assert(cache);
  cache[hash] = state;
};

/**
 * CacheUpdate
 * @constructor
 * @ignore
 */

function CacheUpdate(bit, hash, state) {
  this.bit = bit;
  this.hash = hash;
  this.state = state;
}

CacheUpdate.prototype.toRaw = function toRaw() {
  return U8(this.state);
};

/*
 * Helpers
 */

function getSize(value) {
  return value.length + 80;
}

/*
 * Expose
 */

module.exports = ChainDB;