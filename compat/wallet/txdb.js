/*!
 * txdb.js - persistent transaction pool
 * Copyright (c) 2014-2015, Fedor Indutny (MIT License)
 * Copyright (c) 2014-2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

var _typeof2 = require('babel-runtime/helpers/typeof');

var _typeof3 = _interopRequireDefault(_typeof2);

var _keys = require('babel-runtime/core-js/object/keys');

var _keys2 = _interopRequireDefault(_keys);

var _promise = require('babel-runtime/core-js/promise');

var _promise2 = _interopRequireDefault(_promise);

var _regenerator = require('babel-runtime/regenerator');

var _regenerator2 = _interopRequireDefault(_regenerator);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var util = require('../utils/util');
var LRU = require('../utils/lru');
var co = require('../utils/co');
var assert = require('assert');
var BufferReader = require('../utils/reader');
var StaticWriter = require('../utils/staticwriter');
var Amount = require('../btc/amount');
var CoinView = require('../coins/coinview');
var Coin = require('../primitives/coin');
var Outpoint = require('../primitives/outpoint');
var records = require('./records');
var layout = require('./layout').txdb;
var encoding = require('../utils/encoding');
var policy = require('../protocol/policy');
var Script = require('../script/script');
var BlockMapRecord = records.BlockMapRecord;
var OutpointMapRecord = records.OutpointMapRecord;
var TXRecord = records.TXRecord;
var DUMMY = Buffer.from([0]);

/**
 * TXDB
 * @alias module:wallet.TXDB
 * @constructor
 * @param {Wallet} wallet
 */

function TXDB(wallet) {
  if (!(this instanceof TXDB)) return new TXDB(wallet);

  this.wallet = wallet;
  this.walletdb = wallet.db;
  this.db = wallet.db.db;
  this.logger = wallet.db.logger;
  this.network = wallet.db.network;
  this.options = wallet.db.options;
  this.coinCache = new LRU(10000);

  this.locked = {};
  this.state = null;
  this.pending = null;
  this.events = [];
}

/**
 * Database layout.
 * @type {Object}
 */

TXDB.layout = layout;

/**
 * Open TXDB.
 * @returns {Promise}
 */

TXDB.prototype.open = co( /*#__PURE__*/_regenerator2.default.mark(function open() {
  var state;
  return _regenerator2.default.wrap(function open$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:
          _context.next = 2;
          return this.getState();

        case 2:
          state = _context.sent;


          if (state) {
            this.state = state;
            this.logger.info('TXDB loaded for %s.', this.wallet.id);
          } else {
            this.state = new TXDBState(this.wallet.wid, this.wallet.id);
            this.logger.info('TXDB created for %s.', this.wallet.id);
          }

          this.logger.info('TXDB State: tx=%d coin=%s.', this.state.tx, this.state.coin);

          this.logger.info('Balance: unconfirmed=%s confirmed=%s.', Amount.btc(this.state.unconfirmed), Amount.btc(this.state.confirmed));

        case 6:
        case 'end':
          return _context.stop();
      }
    }
  }, open, this);
}));

/**
 * Start batch.
 * @private
 */

TXDB.prototype.start = function start() {
  this.pending = this.state.clone();
  this.coinCache.start();
  return this.wallet.start();
};

/**
 * Drop batch.
 * @private
 */

TXDB.prototype.drop = function drop() {
  this.pending = null;
  this.events.length = 0;
  this.coinCache.drop();
  return this.wallet.drop();
};

/**
 * Clear batch.
 * @private
 */

TXDB.prototype.clear = function clear() {
  this.pending = this.state.clone();
  this.events.length = 0;
  this.coinCache.clear();
  return this.wallet.clear();
};

/**
 * Save batch.
 * @returns {Promise}
 */

TXDB.prototype.commit = co( /*#__PURE__*/_regenerator2.default.mark(function commit() {
  var i, item;
  return _regenerator2.default.wrap(function commit$(_context2) {
    while (1) {
      switch (_context2.prev = _context2.next) {
        case 0:
          _context2.prev = 0;
          _context2.next = 3;
          return this.wallet.commit();

        case 3:
          _context2.next = 11;
          break;

        case 5:
          _context2.prev = 5;
          _context2.t0 = _context2['catch'](0);

          this.pending = null;
          this.events.length = 0;
          this.coinCache.drop();
          throw _context2.t0;

        case 11:

          // Overwrite the entire state
          // with our new committed state.
          if (this.pending.committed) {
            this.state = this.pending;

            // Emit buffered events now that
            // we know everything is written.
            for (i = 0; i < this.events.length; i++) {
              item = this.events[i];
              this.walletdb.emit(item[0], this.wallet.id, item[1], item[2]);
              this.wallet.emit(item[0], item[1], item[2]);
            }
          }

          this.pending = null;
          this.events.length = 0;
          this.coinCache.commit();

        case 15:
        case 'end':
          return _context2.stop();
      }
    }
  }, commit, this, [[0, 5]]);
}));

/**
 * Emit transaction event.
 * @private
 * @param {String} event
 * @param {Object} data
 * @param {Details} details
 */

TXDB.prototype.emit = function emit(event, data, details) {
  this.events.push([event, data, details]);
};

/**
 * Prefix a key.
 * @param {Buffer} key
 * @returns {Buffer} Prefixed key.
 */

TXDB.prototype.prefix = function prefix(key) {
  assert(this.wallet.wid);
  return layout.prefix(this.wallet.wid, key);
};

/**
 * Put key and value to current batch.
 * @param {String} key
 * @param {Buffer} value
 */

TXDB.prototype.put = function put(key, value) {
  assert(this.wallet.current);
  this.wallet.current.put(this.prefix(key), value);
};

/**
 * Delete key from current batch.
 * @param {String} key
 */

TXDB.prototype.del = function del(key) {
  assert(this.wallet.current);
  this.wallet.current.del(this.prefix(key));
};

/**
 * Get.
 * @param {String} key
 */

TXDB.prototype.get = function get(key) {
  return this.db.get(this.prefix(key));
};

/**
 * Has.
 * @param {String} key
 */

TXDB.prototype.has = function has(key) {
  return this.db.has(this.prefix(key));
};

/**
 * Iterate.
 * @param {Object} options
 * @returns {Promise}
 */

TXDB.prototype.range = function range(options) {
  if (options.gte) options.gte = this.prefix(options.gte);
  if (options.lte) options.lte = this.prefix(options.lte);
  return this.db.range(options);
};

/**
 * Iterate.
 * @param {Object} options
 * @returns {Promise}
 */

TXDB.prototype.keys = function keys(options) {
  if (options.gte) options.gte = this.prefix(options.gte);
  if (options.lte) options.lte = this.prefix(options.lte);
  return this.db.keys(options);
};

/**
 * Iterate.
 * @param {Object} options
 * @returns {Promise}
 */

TXDB.prototype.values = function values(options) {
  if (options.gte) options.gte = this.prefix(options.gte);
  if (options.lte) options.lte = this.prefix(options.lte);
  return this.db.values(options);
};

/**
 * Get wallet path for output.
 * @param {Output} output
 * @returns {Promise} - Returns {@link Path}.
 */

TXDB.prototype.getPath = function getPath(output) {
  var addr = output.getAddress();

  if (!addr) return _promise2.default.resolve();

  return this.wallet.getPath(addr);
};

/**
 * Test whether path exists for output.
 * @param {Output} output
 * @returns {Promise} - Returns Boolean.
 */

TXDB.prototype.hasPath = function hasPath(output) {
  var addr = output.getAddress();

  if (!addr) return _promise2.default.resolve(false);

  return this.wallet.hasPath(addr);
};

/**
 * Save credit.
 * @param {Credit} credit
 * @param {Path} path
 */

TXDB.prototype.saveCredit = co( /*#__PURE__*/_regenerator2.default.mark(function saveCredit(credit, path) {
  var coin, key, raw;
  return _regenerator2.default.wrap(function saveCredit$(_context3) {
    while (1) {
      switch (_context3.prev = _context3.next) {
        case 0:
          coin = credit.coin;
          key = coin.toKey();
          raw = credit.toRaw();
          _context3.next = 5;
          return this.addOutpointMap(coin.hash, coin.index);

        case 5:

          this.put(layout.c(coin.hash, coin.index), raw);
          this.put(layout.C(path.account, coin.hash, coin.index), DUMMY);

          this.coinCache.push(key, raw);

        case 8:
        case 'end':
          return _context3.stop();
      }
    }
  }, saveCredit, this);
}));

/**
 * Remove credit.
 * @param {Credit} credit
 * @param {Path} path
 */

TXDB.prototype.removeCredit = co( /*#__PURE__*/_regenerator2.default.mark(function removeCredit(credit, path) {
  var coin, key;
  return _regenerator2.default.wrap(function removeCredit$(_context4) {
    while (1) {
      switch (_context4.prev = _context4.next) {
        case 0:
          coin = credit.coin;
          key = coin.toKey();
          _context4.next = 4;
          return this.removeOutpointMap(coin.hash, coin.index);

        case 4:

          this.del(layout.c(coin.hash, coin.index));
          this.del(layout.C(path.account, coin.hash, coin.index));

          this.coinCache.unpush(key);

        case 7:
        case 'end':
          return _context4.stop();
      }
    }
  }, removeCredit, this);
}));

/**
 * Spend credit.
 * @param {Credit} credit
 * @param {TX} tx
 * @param {Number} index
 */

TXDB.prototype.spendCredit = function spendCredit(credit, tx, index) {
  var prevout = tx.inputs[index].prevout;
  var spender = Outpoint.fromTX(tx, index);
  this.put(layout.s(prevout.hash, prevout.index), spender.toRaw());
  this.put(layout.d(spender.hash, spender.index), credit.coin.toRaw());
};

/**
 * Unspend credit.
 * @param {TX} tx
 * @param {Number} index
 */

TXDB.prototype.unspendCredit = function unspendCredit(tx, index) {
  var prevout = tx.inputs[index].prevout;
  var spender = Outpoint.fromTX(tx, index);
  this.del(layout.s(prevout.hash, prevout.index));
  this.del(layout.d(spender.hash, spender.index));
};

/**
 * Write input record.
 * @param {TX} tx
 * @param {Number} index
 */

TXDB.prototype.writeInput = function writeInput(tx, index) {
  var prevout = tx.inputs[index].prevout;
  var spender = Outpoint.fromTX(tx, index);
  this.put(layout.s(prevout.hash, prevout.index), spender.toRaw());
};

/**
 * Remove input record.
 * @param {TX} tx
 * @param {Number} index
 */

TXDB.prototype.removeInput = function removeInput(tx, index) {
  var prevout = tx.inputs[index].prevout;
  this.del(layout.s(prevout.hash, prevout.index));
};

/**
 * Resolve orphan input.
 * @param {TX} tx
 * @param {Number} index
 * @param {Number} height
 * @param {Path} path
 * @returns {Boolean}
 */

TXDB.prototype.resolveInput = co( /*#__PURE__*/_regenerator2.default.mark(function resolveInput(tx, index, height, path, own) {
  var hash, spent, stx, credit;
  return _regenerator2.default.wrap(function resolveInput$(_context5) {
    while (1) {
      switch (_context5.prev = _context5.next) {
        case 0:
          hash = tx.hash('hex');
          _context5.next = 3;
          return this.getSpent(hash, index);

        case 3:
          spent = _context5.sent;

          if (spent) {
            _context5.next = 6;
            break;
          }

          return _context5.abrupt('return', false);

        case 6:
          _context5.next = 8;
          return this.hasSpentCoin(spent);

        case 8:
          if (!_context5.sent) {
            _context5.next = 10;
            break;
          }

          return _context5.abrupt('return', false);

        case 10:
          _context5.next = 12;
          return this.getTX(spent.hash);

        case 12:
          stx = _context5.sent;

          assert(stx);

          // Crete the credit and add the undo coin.
          credit = Credit.fromTX(tx, index, height);
          credit.own = own;

          this.spendCredit(credit, stx.tx, spent.index);

          // If the spender is unconfirmed, save
          // the credit as well, and mark it as
          // unspent in the mempool. This is the
          // same behavior `insert` would have
          // done for inputs. We're just doing
          // it retroactively.

          if (!(stx.height === -1)) {
            _context5.next = 22;
            break;
          }

          credit.spent = true;
          _context5.next = 21;
          return this.saveCredit(credit, path);

        case 21:
          if (height !== -1) this.pending.confirmed += credit.coin.value;

        case 22:
          return _context5.abrupt('return', true);

        case 23:
        case 'end':
          return _context5.stop();
      }
    }
  }, resolveInput, this);
}));

/**
 * Test an entire transaction to see
 * if any of its outpoints are a double-spend.
 * @param {TX} tx
 * @returns {Promise} - Returns Boolean.
 */

TXDB.prototype.isDoubleSpend = co( /*#__PURE__*/_regenerator2.default.mark(function isDoubleSpend(tx) {
  var i, input, prevout, spent;
  return _regenerator2.default.wrap(function isDoubleSpend$(_context6) {
    while (1) {
      switch (_context6.prev = _context6.next) {
        case 0:
          i = 0;

        case 1:
          if (!(i < tx.inputs.length)) {
            _context6.next = 12;
            break;
          }

          input = tx.inputs[i];
          prevout = input.prevout;
          _context6.next = 6;
          return this.isSpent(prevout.hash, prevout.index);

        case 6:
          spent = _context6.sent;

          if (!spent) {
            _context6.next = 9;
            break;
          }

          return _context6.abrupt('return', true);

        case 9:
          i++;
          _context6.next = 1;
          break;

        case 12:
          return _context6.abrupt('return', false);

        case 13:
        case 'end':
          return _context6.stop();
      }
    }
  }, isDoubleSpend, this);
}));

/**
 * Test an entire transaction to see
 * if any of its outpoints are replace by fee.
 * @param {TX} tx
 * @returns {Promise} - Returns Boolean.
 */

TXDB.prototype.isRBF = co( /*#__PURE__*/_regenerator2.default.mark(function isRBF(tx) {
  var i, input, prevout;
  return _regenerator2.default.wrap(function isRBF$(_context7) {
    while (1) {
      switch (_context7.prev = _context7.next) {
        case 0:
          if (!tx.isRBF()) {
            _context7.next = 2;
            break;
          }

          return _context7.abrupt('return', true);

        case 2:
          i = 0;

        case 3:
          if (!(i < tx.inputs.length)) {
            _context7.next = 13;
            break;
          }

          input = tx.inputs[i];
          prevout = input.prevout;
          _context7.next = 8;
          return this.has(layout.r(prevout.hash));

        case 8:
          if (!_context7.sent) {
            _context7.next = 10;
            break;
          }

          return _context7.abrupt('return', true);

        case 10:
          i++;
          _context7.next = 3;
          break;

        case 13:
          return _context7.abrupt('return', false);

        case 14:
        case 'end':
          return _context7.stop();
      }
    }
  }, isRBF, this);
}));

/**
 * Test a whether a coin has been spent.
 * @param {Hash} hash
 * @param {Number} index
 * @returns {Promise} - Returns Boolean.
 */

TXDB.prototype.getSpent = co( /*#__PURE__*/_regenerator2.default.mark(function getSpent(hash, index) {
  var data;
  return _regenerator2.default.wrap(function getSpent$(_context8) {
    while (1) {
      switch (_context8.prev = _context8.next) {
        case 0:
          _context8.next = 2;
          return this.get(layout.s(hash, index));

        case 2:
          data = _context8.sent;

          if (data) {
            _context8.next = 5;
            break;
          }

          return _context8.abrupt('return');

        case 5:
          return _context8.abrupt('return', Outpoint.fromRaw(data));

        case 6:
        case 'end':
          return _context8.stop();
      }
    }
  }, getSpent, this);
}));

/**
 * Test a whether a coin has been spent.
 * @param {Hash} hash
 * @param {Number} index
 * @returns {Promise} - Returns Boolean.
 */

TXDB.prototype.isSpent = function isSpent(hash, index) {
  return this.has(layout.s(hash, index));
};

/**
 * Append to the global unspent record.
 * @param {Hash} hash
 * @param {Number} index
 * @returns {Promise}
 */

TXDB.prototype.addOutpointMap = co( /*#__PURE__*/_regenerator2.default.mark(function addOutpointMap(hash, i) {
  var map;
  return _regenerator2.default.wrap(function addOutpointMap$(_context9) {
    while (1) {
      switch (_context9.prev = _context9.next) {
        case 0:
          _context9.next = 2;
          return this.walletdb.getOutpointMap(hash, i);

        case 2:
          map = _context9.sent;


          if (!map) map = new OutpointMapRecord(hash, i);

          if (map.add(this.wallet.wid)) {
            _context9.next = 6;
            break;
          }

          return _context9.abrupt('return');

        case 6:

          this.walletdb.writeOutpointMap(this.wallet, hash, i, map);

        case 7:
        case 'end':
          return _context9.stop();
      }
    }
  }, addOutpointMap, this);
}));

/**
 * Remove from the global unspent record.
 * @param {Hash} hash
 * @param {Number} index
 * @returns {Promise}
 */

TXDB.prototype.removeOutpointMap = co( /*#__PURE__*/_regenerator2.default.mark(function removeOutpointMap(hash, i) {
  var map;
  return _regenerator2.default.wrap(function removeOutpointMap$(_context10) {
    while (1) {
      switch (_context10.prev = _context10.next) {
        case 0:
          _context10.next = 2;
          return this.walletdb.getOutpointMap(hash, i);

        case 2:
          map = _context10.sent;

          if (map) {
            _context10.next = 5;
            break;
          }

          return _context10.abrupt('return');

        case 5:
          if (map.remove(this.wallet.wid)) {
            _context10.next = 7;
            break;
          }

          return _context10.abrupt('return');

        case 7:
          if (!(map.wids.length === 0)) {
            _context10.next = 10;
            break;
          }

          this.walletdb.unwriteOutpointMap(this.wallet, hash, i);
          return _context10.abrupt('return');

        case 10:

          this.walletdb.writeOutpointMap(this.wallet, hash, i, map);

        case 11:
        case 'end':
          return _context10.stop();
      }
    }
  }, removeOutpointMap, this);
}));

/**
 * Append to the global block record.
 * @param {Hash} hash
 * @param {Number} height
 * @returns {Promise}
 */

TXDB.prototype.addBlockMap = co( /*#__PURE__*/_regenerator2.default.mark(function addBlockMap(hash, height) {
  var block;
  return _regenerator2.default.wrap(function addBlockMap$(_context11) {
    while (1) {
      switch (_context11.prev = _context11.next) {
        case 0:
          _context11.next = 2;
          return this.walletdb.getBlockMap(height);

        case 2:
          block = _context11.sent;


          if (!block) block = new BlockMapRecord(height);

          if (block.add(hash, this.wallet.wid)) {
            _context11.next = 6;
            break;
          }

          return _context11.abrupt('return');

        case 6:

          this.walletdb.writeBlockMap(this.wallet, height, block);

        case 7:
        case 'end':
          return _context11.stop();
      }
    }
  }, addBlockMap, this);
}));

/**
 * Remove from the global block record.
 * @param {Hash} hash
 * @param {Number} height
 * @returns {Promise}
 */

TXDB.prototype.removeBlockMap = co( /*#__PURE__*/_regenerator2.default.mark(function removeBlockMap(hash, height) {
  var block;
  return _regenerator2.default.wrap(function removeBlockMap$(_context12) {
    while (1) {
      switch (_context12.prev = _context12.next) {
        case 0:
          _context12.next = 2;
          return this.walletdb.getBlockMap(height);

        case 2:
          block = _context12.sent;

          if (block) {
            _context12.next = 5;
            break;
          }

          return _context12.abrupt('return');

        case 5:
          if (block.remove(hash, this.wallet.wid)) {
            _context12.next = 7;
            break;
          }

          return _context12.abrupt('return');

        case 7:
          if (!(block.txs.length === 0)) {
            _context12.next = 10;
            break;
          }

          this.walletdb.unwriteBlockMap(this.wallet, height);
          return _context12.abrupt('return');

        case 10:

          this.walletdb.writeBlockMap(this.wallet, height, block);

        case 11:
        case 'end':
          return _context12.stop();
      }
    }
  }, removeBlockMap, this);
}));

/**
 * List block records.
 * @returns {Promise}
 */

TXDB.prototype.getBlocks = function getBlocks() {
  return this.keys({
    gte: layout.b(0),
    lte: layout.b(0xffffffff),
    parse: function parse(key) {
      return layout.bb(key);
    }
  });
};

/**
 * Get block record.
 * @param {Number} height
 * @returns {Promise}
 */

TXDB.prototype.getBlock = co( /*#__PURE__*/_regenerator2.default.mark(function getBlock(height) {
  var data;
  return _regenerator2.default.wrap(function getBlock$(_context13) {
    while (1) {
      switch (_context13.prev = _context13.next) {
        case 0:
          _context13.next = 2;
          return this.get(layout.b(height));

        case 2:
          data = _context13.sent;

          if (data) {
            _context13.next = 5;
            break;
          }

          return _context13.abrupt('return');

        case 5:
          return _context13.abrupt('return', BlockRecord.fromRaw(data));

        case 6:
        case 'end':
          return _context13.stop();
      }
    }
  }, getBlock, this);
}));

/**
 * Append to the global block record.
 * @param {Hash} hash
 * @param {BlockMeta} meta
 * @returns {Promise}
 */

TXDB.prototype.addBlock = co( /*#__PURE__*/_regenerator2.default.mark(function addBlock(hash, meta) {
  var key, data, block, size;
  return _regenerator2.default.wrap(function addBlock$(_context14) {
    while (1) {
      switch (_context14.prev = _context14.next) {
        case 0:
          key = layout.b(meta.height);
          _context14.next = 3;
          return this.get(key);

        case 3:
          data = _context14.sent;


          if (!data) {
            block = BlockRecord.fromMeta(meta);
            data = block.toRaw();
          }

          block = Buffer.allocUnsafe(data.length + 32);
          data.copy(block, 0);

          size = block.readUInt32LE(40, true);
          block.writeUInt32LE(size + 1, 40, true);
          hash.copy(block, data.length);

          this.put(key, block);

        case 11:
        case 'end':
          return _context14.stop();
      }
    }
  }, addBlock, this);
}));

/**
 * Remove from the global block record.
 * @param {Hash} hash
 * @param {Number} height
 * @returns {Promise}
 */

TXDB.prototype.removeBlock = co( /*#__PURE__*/_regenerator2.default.mark(function removeBlock(hash, height) {
  var key, data, block, size;
  return _regenerator2.default.wrap(function removeBlock$(_context15) {
    while (1) {
      switch (_context15.prev = _context15.next) {
        case 0:
          key = layout.b(height);
          _context15.next = 3;
          return this.get(key);

        case 3:
          data = _context15.sent;

          if (data) {
            _context15.next = 6;
            break;
          }

          return _context15.abrupt('return');

        case 6:

          size = data.readUInt32LE(40, true);

          assert(size > 0);
          assert(data.slice(-32).equals(hash));

          if (!(size === 1)) {
            _context15.next = 12;
            break;
          }

          this.del(key);
          return _context15.abrupt('return');

        case 12:

          block = data.slice(0, -32);
          block.writeUInt32LE(size - 1, 40, true);

          this.put(key, block);

        case 15:
        case 'end':
          return _context15.stop();
      }
    }
  }, removeBlock, this);
}));

/**
 * Append to the global block record.
 * @param {Hash} hash
 * @param {BlockMeta} meta
 * @returns {Promise}
 */

TXDB.prototype.addBlockSlow = co( /*#__PURE__*/_regenerator2.default.mark(function addBlockSlow(hash, meta) {
  var block;
  return _regenerator2.default.wrap(function addBlockSlow$(_context16) {
    while (1) {
      switch (_context16.prev = _context16.next) {
        case 0:
          _context16.next = 2;
          return this.getBlock(meta.height);

        case 2:
          block = _context16.sent;


          if (!block) block = BlockRecord.fromMeta(meta);

          if (block.add(hash)) {
            _context16.next = 6;
            break;
          }

          return _context16.abrupt('return');

        case 6:

          this.put(layout.b(meta.height), block.toRaw());

        case 7:
        case 'end':
          return _context16.stop();
      }
    }
  }, addBlockSlow, this);
}));

/**
 * Remove from the global block record.
 * @param {Hash} hash
 * @param {Number} height
 * @returns {Promise}
 */

TXDB.prototype.removeBlockSlow = co( /*#__PURE__*/_regenerator2.default.mark(function removeBlockSlow(hash, height) {
  var block;
  return _regenerator2.default.wrap(function removeBlockSlow$(_context17) {
    while (1) {
      switch (_context17.prev = _context17.next) {
        case 0:
          _context17.next = 2;
          return this.getBlock(height);

        case 2:
          block = _context17.sent;

          if (block) {
            _context17.next = 5;
            break;
          }

          return _context17.abrupt('return');

        case 5:
          if (block.remove(hash)) {
            _context17.next = 7;
            break;
          }

          return _context17.abrupt('return');

        case 7:
          if (!(block.hashes.length === 0)) {
            _context17.next = 10;
            break;
          }

          this.del(layout.b(height));
          return _context17.abrupt('return');

        case 10:

          this.put(layout.b(height), block.toRaw());

        case 11:
        case 'end':
          return _context17.stop();
      }
    }
  }, removeBlockSlow, this);
}));

/**
 * Add transaction, potentially runs
 * `confirm()` and `removeConflicts()`.
 * @param {TX} tx
 * @param {BlockMeta} block
 * @returns {Promise}
 */

TXDB.prototype.add = co( /*#__PURE__*/_regenerator2.default.mark(function add(tx, block) {
  var result;
  return _regenerator2.default.wrap(function add$(_context18) {
    while (1) {
      switch (_context18.prev = _context18.next) {
        case 0:

          this.start();

          _context18.prev = 1;
          _context18.next = 4;
          return this._add(tx, block);

        case 4:
          result = _context18.sent;
          _context18.next = 11;
          break;

        case 7:
          _context18.prev = 7;
          _context18.t0 = _context18['catch'](1);

          this.drop();
          throw _context18.t0;

        case 11:
          _context18.next = 13;
          return this.commit();

        case 13:
          return _context18.abrupt('return', result);

        case 14:
        case 'end':
          return _context18.stop();
      }
    }
  }, add, this, [[1, 7]]);
}));

/**
 * Add transaction without a batch.
 * @private
 * @param {TX} tx
 * @returns {Promise}
 */

TXDB.prototype._add = co( /*#__PURE__*/_regenerator2.default.mark(function add(tx, block) {
  var hash, existing, wtx;
  return _regenerator2.default.wrap(function add$(_context19) {
    while (1) {
      switch (_context19.prev = _context19.next) {
        case 0:
          hash = tx.hash('hex');
          _context19.next = 3;
          return this.getTX(hash);

        case 3:
          existing = _context19.sent;


          assert(!tx.mutable, 'Cannot add mutable TX to wallet.');

          if (!existing) {
            _context19.next = 13;
            break;
          }

          if (!(existing.height !== -1)) {
            _context19.next = 8;
            break;
          }

          return _context19.abrupt('return');

        case 8:
          if (block) {
            _context19.next = 10;
            break;
          }

          return _context19.abrupt('return');

        case 10:
          _context19.next = 12;
          return this._confirm(existing, block);

        case 12:
          return _context19.abrupt('return', _context19.sent);

        case 13:

          wtx = TXRecord.fromTX(tx, block);

          if (block) {
            _context19.next = 26;
            break;
          }

          _context19.next = 17;
          return this.isRBF(tx);

        case 17:
          if (!_context19.sent) {
            _context19.next = 20;
            break;
          }

          // We need to index every spender
          // hash to detect "passive"
          // replace-by-fee.
          this.put(layout.r(hash), DUMMY);
          return _context19.abrupt('return');

        case 20:
          _context19.next = 22;
          return this.removeConflicts(tx, true);

        case 22:
          if (_context19.sent) {
            _context19.next = 24;
            break;
          }

          return _context19.abrupt('return');

        case 24:
          _context19.next = 29;
          break;

        case 26:
          _context19.next = 28;
          return this.removeConflicts(tx, false);

        case 28:

          // Delete the replace-by-fee record.
          this.del(layout.r(hash));

        case 29:
          _context19.next = 31;
          return this.insert(wtx, block);

        case 31:
          return _context19.abrupt('return', _context19.sent);

        case 32:
        case 'end':
          return _context19.stop();
      }
    }
  }, add, this);
}));

/**
 * Insert transaction.
 * @private
 * @param {TXRecord} wtx
 * @param {BlockMeta} block
 * @returns {Promise}
 */

TXDB.prototype.insert = co( /*#__PURE__*/_regenerator2.default.mark(function insert(wtx, block) {
  var tx, hash, height, details, own, updated, i, input, output, coin, prevout, credit, path, account;
  return _regenerator2.default.wrap(function insert$(_context20) {
    while (1) {
      switch (_context20.prev = _context20.next) {
        case 0:
          tx = wtx.tx;
          hash = wtx.hash;
          height = block ? block.height : -1;
          details = new Details(this, wtx, block);
          own = false;
          updated = false;

          if (tx.isCoinbase()) {
            _context20.next = 46;
            break;
          }

          i = 0;

        case 8:
          if (!(i < tx.inputs.length)) {
            _context20.next = 46;
            break;
          }

          input = tx.inputs[i];
          prevout = input.prevout;
          _context20.next = 13;
          return this.getCredit(prevout.hash, prevout.index);

        case 13:
          credit = _context20.sent;

          if (credit) {
            _context20.next = 17;
            break;
          }

          // Maintain an stxo list for every
          // spent input (even ones we don't
          // recognize). This is used for
          // detecting double-spends (as best
          // we can), as well as resolving
          // inputs we didn't know were ours
          // at the time. This built-in error
          // correction is not technically
          // necessary assuming no messages
          // are ever missed from the mempool,
          // but shit happens.
          this.writeInput(tx, i);
          return _context20.abrupt('continue', 43);

        case 17:

          coin = credit.coin;

          // Do some verification.

          if (block) {
            _context20.next = 24;
            break;
          }

          _context20.next = 21;
          return this.verifyInput(tx, i, coin);

        case 21:
          if (_context20.sent) {
            _context20.next = 24;
            break;
          }

          this.clear();
          return _context20.abrupt('return');

        case 24:
          _context20.next = 26;
          return this.getPath(coin);

        case 26:
          path = _context20.sent;

          assert(path);

          // Build the tx details object
          // as we go, for speed.
          details.setInput(i, path, coin);

          // Write an undo coin for the credit
          // and add it to the stxo set.
          this.spendCredit(credit, tx, i);

          // Unconfirmed balance should always
          // be updated as it reflects the on-chain
          // balance _and_ mempool balance assuming
          // everything in the mempool were to confirm.
          this.pending.coin--;
          this.pending.unconfirmed -= coin.value;

          if (block) {
            _context20.next = 38;
            break;
          }

          // If the tx is not mined, we do not
          // disconnect the coin, we simply mark
          // a `spent` flag on the credit. This
          // effectively prevents the mempool
          // from altering our utxo state
          // permanently. It also makes it
          // possible to compare the on-chain
          // state vs. the mempool state.
          credit.spent = true;
          _context20.next = 36;
          return this.saveCredit(credit, path);

        case 36:
          _context20.next = 41;
          break;

        case 38:
          // If the tx is mined, we can safely
          // remove the coin being spent. This
          // coin will be indexed as an undo
          // coin so it can be reconnected
          // later during a reorg.
          this.pending.confirmed -= coin.value;
          _context20.next = 41;
          return this.removeCredit(credit, path);

        case 41:

          updated = true;
          own = true;

        case 43:
          i++;
          _context20.next = 8;
          break;

        case 46:
          i = 0;

        case 47:
          if (!(i < tx.outputs.length)) {
            _context20.next = 71;
            break;
          }

          output = tx.outputs[i];
          _context20.next = 51;
          return this.getPath(output);

        case 51:
          path = _context20.sent;

          if (path) {
            _context20.next = 54;
            break;
          }

          return _context20.abrupt('continue', 68);

        case 54:

          details.setOutput(i, path);

          // Attempt to resolve an input we
          // did not know was ours at the time.
          _context20.next = 57;
          return this.resolveInput(tx, i, height, path, own);

        case 57:
          if (!_context20.sent) {
            _context20.next = 60;
            break;
          }

          updated = true;
          return _context20.abrupt('continue', 68);

        case 60:

          credit = Credit.fromTX(tx, i, height);
          credit.own = own;

          this.pending.coin++;
          this.pending.unconfirmed += output.value;

          if (block) this.pending.confirmed += output.value;

          _context20.next = 67;
          return this.saveCredit(credit, path);

        case 67:

          updated = true;

        case 68:
          i++;
          _context20.next = 47;
          break;

        case 71:
          if (updated) {
            _context20.next = 74;
            break;
          }

          // Clear the spent list inserts.
          this.clear();
          return _context20.abrupt('return');

        case 74:

          // Save and index the transaction record.
          this.put(layout.t(hash), wtx.toRaw());
          this.put(layout.m(wtx.ps, hash), DUMMY);

          if (!block) this.put(layout.p(hash), DUMMY);else this.put(layout.h(height, hash), DUMMY);

          // Do some secondary indexing for account-based
          // queries. This saves us a lot of time for
          // queries later.
          for (i = 0; i < details.accounts.length; i++) {
            account = details.accounts[i];

            this.put(layout.T(account, hash), DUMMY);
            this.put(layout.M(account, wtx.ps, hash), DUMMY);

            if (!block) this.put(layout.P(account, hash), DUMMY);else this.put(layout.H(account, height, hash), DUMMY);
          }

          // Update block records.

          if (!block) {
            _context20.next = 83;
            break;
          }

          _context20.next = 81;
          return this.addBlockMap(hash, height);

        case 81:
          _context20.next = 83;
          return this.addBlock(tx.hash(), block);

        case 83:

          // Update the transaction counter and
          // commit the new state. This state will
          // only overwrite the best state once
          // the batch has actually been written
          // to disk.
          this.pending.tx++;
          this.put(layout.R, this.pending.commit());

          // This transaction may unlock some
          // coins now that we've seen it.
          this.unlockTX(tx);

          // Emit events for potential local and
          // websocket listeners. Note that these
          // will only be emitted if the batch is
          // successfully written to disk.
          this.emit('tx', tx, details);
          this.emit('balance', this.pending.toBalance(), details);

          return _context20.abrupt('return', details);

        case 89:
        case 'end':
          return _context20.stop();
      }
    }
  }, insert, this);
}));

/**
 * Attempt to confirm a transaction.
 * @private
 * @param {TX} tx
 * @param {BlockMeta} block
 * @returns {Promise}
 */

TXDB.prototype.confirm = co( /*#__PURE__*/_regenerator2.default.mark(function confirm(hash, block) {
  var wtx, details;
  return _regenerator2.default.wrap(function confirm$(_context21) {
    while (1) {
      switch (_context21.prev = _context21.next) {
        case 0:
          _context21.next = 2;
          return this.getTX(hash);

        case 2:
          wtx = _context21.sent;

          if (wtx) {
            _context21.next = 5;
            break;
          }

          return _context21.abrupt('return');

        case 5:
          if (!(wtx.height !== -1)) {
            _context21.next = 7;
            break;
          }

          throw new Error('TX is already confirmed.');

        case 7:

          assert(block);

          this.start();

          _context21.prev = 9;
          _context21.next = 12;
          return this._confirm(wtx, block);

        case 12:
          details = _context21.sent;
          _context21.next = 19;
          break;

        case 15:
          _context21.prev = 15;
          _context21.t0 = _context21['catch'](9);

          this.drop();
          throw _context21.t0;

        case 19:
          _context21.next = 21;
          return this.commit();

        case 21:
          return _context21.abrupt('return', details);

        case 22:
        case 'end':
          return _context21.stop();
      }
    }
  }, confirm, this, [[9, 15]]);
}));

/**
 * Attempt to confirm a transaction.
 * @private
 * @param {TXRecord} wtx
 * @param {BlockMeta} block
 * @returns {Promise}
 */

TXDB.prototype._confirm = co( /*#__PURE__*/_regenerator2.default.mark(function confirm(wtx, block) {
  var tx, hash, height, details, i, account, output, coin, input, prevout, path, credit, credits;
  return _regenerator2.default.wrap(function confirm$(_context22) {
    while (1) {
      switch (_context22.prev = _context22.next) {
        case 0:
          tx = wtx.tx;
          hash = wtx.hash;
          height = block.height;
          details = new Details(this, wtx, block);


          wtx.setBlock(block);

          if (tx.isCoinbase()) {
            _context22.next = 36;
            break;
          }

          _context22.next = 8;
          return this.getSpentCredits(tx);

        case 8:
          credits = _context22.sent;
          i = 0;

        case 10:
          if (!(i < tx.inputs.length)) {
            _context22.next = 36;
            break;
          }

          input = tx.inputs[i];
          prevout = input.prevout;
          credit = credits[i];

          // There may be new credits available
          // that we haven't seen yet.

          if (credit) {
            _context22.next = 23;
            break;
          }

          _context22.next = 17;
          return this.getCredit(prevout.hash, prevout.index);

        case 17:
          credit = _context22.sent;

          if (credit) {
            _context22.next = 20;
            break;
          }

          return _context22.abrupt('continue', 33);

        case 20:

          // Add a spend record and undo coin
          // for the coin we now know is ours.
          // We don't need to remove the coin
          // since it was never added in the
          // first place.
          this.spendCredit(credit, tx, i);

          this.pending.coin--;
          this.pending.unconfirmed -= credit.coin.value;

        case 23:

          coin = credit.coin;

          assert(coin.height !== -1);

          _context22.next = 27;
          return this.getPath(coin);

        case 27:
          path = _context22.sent;

          assert(path);

          details.setInput(i, path, coin);

          // We can now safely remove the credit
          // entirely, now that we know it's also
          // been removed on-chain.
          this.pending.confirmed -= coin.value;

          _context22.next = 33;
          return this.removeCredit(credit, path);

        case 33:
          i++;
          _context22.next = 10;
          break;

        case 36:
          i = 0;

        case 37:
          if (!(i < tx.outputs.length)) {
            _context22.next = 60;
            break;
          }

          output = tx.outputs[i];
          _context22.next = 41;
          return this.getPath(output);

        case 41:
          path = _context22.sent;

          if (path) {
            _context22.next = 44;
            break;
          }

          return _context22.abrupt('continue', 57);

        case 44:

          details.setOutput(i, path);

          _context22.next = 47;
          return this.getCredit(hash, i);

        case 47:
          credit = _context22.sent;

          assert(credit);

          // Credits spent in the mempool add an
          // undo coin for ease. If this credit is
          // spent in the mempool, we need to
          // update the undo coin's height.

          if (!credit.spent) {
            _context22.next = 52;
            break;
          }

          _context22.next = 52;
          return this.updateSpentCoin(tx, i, height);

        case 52:

          // Update coin height and confirmed
          // balance. Save once again.
          coin = credit.coin;
          coin.height = height;

          this.pending.confirmed += output.value;

          _context22.next = 57;
          return this.saveCredit(credit, path);

        case 57:
          i++;
          _context22.next = 37;
          break;

        case 60:

          // Remove the RBF index if we have one.
          this.del(layout.r(hash));

          // Save the new serialized transaction as
          // the block-related properties have been
          // updated. Also reindex for height.
          this.put(layout.t(hash), wtx.toRaw());
          this.del(layout.p(hash));
          this.put(layout.h(height, hash), DUMMY);

          // Secondary indexing also needs to change.
          for (i = 0; i < details.accounts.length; i++) {
            account = details.accounts[i];
            this.del(layout.P(account, hash));
            this.put(layout.H(account, height, hash), DUMMY);
          }

          if (!block) {
            _context22.next = 70;
            break;
          }

          _context22.next = 68;
          return this.addBlockMap(hash, height);

        case 68:
          _context22.next = 70;
          return this.addBlock(tx.hash(), block);

        case 70:

          // Commit the new state. The balance has updated.
          this.put(layout.R, this.pending.commit());

          this.unlockTX(tx);

          this.emit('confirmed', tx, details);
          this.emit('balance', this.pending.toBalance(), details);

          return _context22.abrupt('return', details);

        case 75:
        case 'end':
          return _context22.stop();
      }
    }
  }, confirm, this);
}));

/**
 * Recursively remove a transaction
 * from the database.
 * @param {Hash} hash
 * @returns {Promise}
 */

TXDB.prototype.remove = co( /*#__PURE__*/_regenerator2.default.mark(function remove(hash) {
  var wtx;
  return _regenerator2.default.wrap(function remove$(_context23) {
    while (1) {
      switch (_context23.prev = _context23.next) {
        case 0:
          _context23.next = 2;
          return this.getTX(hash);

        case 2:
          wtx = _context23.sent;

          if (wtx) {
            _context23.next = 5;
            break;
          }

          return _context23.abrupt('return');

        case 5:
          _context23.next = 7;
          return this.removeRecursive(wtx);

        case 7:
          return _context23.abrupt('return', _context23.sent);

        case 8:
        case 'end':
          return _context23.stop();
      }
    }
  }, remove, this);
}));

/**
 * Remove a transaction from the
 * database. Disconnect inputs.
 * @private
 * @param {TXRecord} wtx
 * @returns {Promise}
 */

TXDB.prototype.erase = co( /*#__PURE__*/_regenerator2.default.mark(function erase(wtx, block) {
  var tx, hash, height, details, i, path, account, credits, input, output, coin, credit;
  return _regenerator2.default.wrap(function erase$(_context24) {
    while (1) {
      switch (_context24.prev = _context24.next) {
        case 0:
          tx = wtx.tx;
          hash = wtx.hash;
          height = block ? block.height : -1;
          details = new Details(this, wtx, block);

          if (tx.isCoinbase()) {
            _context24.next = 30;
            break;
          }

          _context24.next = 7;
          return this.getSpentCredits(tx);

        case 7:
          credits = _context24.sent;
          i = 0;

        case 9:
          if (!(i < tx.inputs.length)) {
            _context24.next = 30;
            break;
          }

          input = tx.inputs[i];
          credit = credits[i];

          if (credit) {
            _context24.next = 15;
            break;
          }

          // This input never had an undo
          // coin, but remove it from the
          // stxo set.
          this.removeInput(tx, i);
          return _context24.abrupt('continue', 27);

        case 15:

          coin = credit.coin;
          _context24.next = 18;
          return this.getPath(coin);

        case 18:
          path = _context24.sent;

          assert(path);

          details.setInput(i, path, coin);

          // Recalculate the balance, remove
          // from stxo set, remove the undo
          // coin, and resave the credit.
          this.pending.coin++;
          this.pending.unconfirmed += coin.value;

          if (block) this.pending.confirmed += coin.value;

          this.unspendCredit(tx, i);
          _context24.next = 27;
          return this.saveCredit(credit, path);

        case 27:
          i++;
          _context24.next = 9;
          break;

        case 30:
          i = 0;

        case 31:
          if (!(i < tx.outputs.length)) {
            _context24.next = 48;
            break;
          }

          output = tx.outputs[i];
          _context24.next = 35;
          return this.getPath(output);

        case 35:
          path = _context24.sent;

          if (path) {
            _context24.next = 38;
            break;
          }

          return _context24.abrupt('continue', 45);

        case 38:

          details.setOutput(i, path);

          credit = Credit.fromTX(tx, i, height);

          this.pending.coin--;
          this.pending.unconfirmed -= output.value;

          if (block) this.pending.confirmed -= output.value;

          _context24.next = 45;
          return this.removeCredit(credit, path);

        case 45:
          i++;
          _context24.next = 31;
          break;

        case 48:

          // Remove the RBF index if we have one.
          this.del(layout.r(hash));

          // Remove the transaction data
          // itself as well as unindex.
          this.del(layout.t(hash));
          this.del(layout.m(wtx.ps, hash));

          if (!block) this.del(layout.p(hash));else this.del(layout.h(height, hash));

          // Remove all secondary indexing.
          for (i = 0; i < details.accounts.length; i++) {
            account = details.accounts[i];

            this.del(layout.T(account, hash));
            this.del(layout.M(account, wtx.ps, hash));

            if (!block) this.del(layout.P(account, hash));else this.del(layout.H(account, height, hash));
          }

          // Update block records.

          if (!block) {
            _context24.next = 58;
            break;
          }

          _context24.next = 56;
          return this.removeBlockMap(hash, height);

        case 56:
          _context24.next = 58;
          return this.removeBlockSlow(hash, height);

        case 58:

          // Update the transaction counter
          // and commit new state due to
          // balance change.
          this.pending.tx--;
          this.put(layout.R, this.pending.commit());

          this.emit('remove tx', tx, details);
          this.emit('balance', this.pending.toBalance(), details);

          return _context24.abrupt('return', details);

        case 63:
        case 'end':
          return _context24.stop();
      }
    }
  }, erase, this);
}));

/**
 * Remove a transaction and recursively
 * remove all of its spenders.
 * @private
 * @param {TXRecord} wtx
 * @returns {Promise}
 */

TXDB.prototype.removeRecursive = co( /*#__PURE__*/_regenerator2.default.mark(function removeRecursive(wtx) {
  var tx, hash, i, spent, stx, details;
  return _regenerator2.default.wrap(function removeRecursive$(_context25) {
    while (1) {
      switch (_context25.prev = _context25.next) {
        case 0:
          tx = wtx.tx;
          hash = wtx.hash;
          i = 0;

        case 3:
          if (!(i < tx.outputs.length)) {
            _context25.next = 18;
            break;
          }

          _context25.next = 6;
          return this.getSpent(hash, i);

        case 6:
          spent = _context25.sent;

          if (spent) {
            _context25.next = 9;
            break;
          }

          return _context25.abrupt('continue', 15);

        case 9:
          _context25.next = 11;
          return this.getTX(spent.hash);

        case 11:
          stx = _context25.sent;


          assert(stx);

          _context25.next = 15;
          return this.removeRecursive(stx);

        case 15:
          i++;
          _context25.next = 3;
          break;

        case 18:

          this.start();

          // Remove the spender.
          _context25.next = 21;
          return this.erase(wtx, wtx.getBlock());

        case 21:
          details = _context25.sent;


          assert(details);

          _context25.next = 25;
          return this.commit();

        case 25:
          return _context25.abrupt('return', details);

        case 26:
        case 'end':
          return _context25.stop();
      }
    }
  }, removeRecursive, this);
}));

/**
 * Unconfirm a transaction. Necessary after a reorg.
 * @param {Hash} hash
 * @returns {Promise}
 */

TXDB.prototype.unconfirm = co( /*#__PURE__*/_regenerator2.default.mark(function unconfirm(hash) {
  var details;
  return _regenerator2.default.wrap(function unconfirm$(_context26) {
    while (1) {
      switch (_context26.prev = _context26.next) {
        case 0:

          this.start();

          _context26.prev = 1;
          _context26.next = 4;
          return this._unconfirm(hash);

        case 4:
          details = _context26.sent;
          _context26.next = 11;
          break;

        case 7:
          _context26.prev = 7;
          _context26.t0 = _context26['catch'](1);

          this.drop();
          throw _context26.t0;

        case 11:
          _context26.next = 13;
          return this.commit();

        case 13:
          return _context26.abrupt('return', details);

        case 14:
        case 'end':
          return _context26.stop();
      }
    }
  }, unconfirm, this, [[1, 7]]);
}));

/**
 * Unconfirm a transaction without a batch.
 * @private
 * @param {Hash} hash
 * @returns {Promise}
 */

TXDB.prototype._unconfirm = co( /*#__PURE__*/_regenerator2.default.mark(function unconfirm(hash) {
  var wtx;
  return _regenerator2.default.wrap(function unconfirm$(_context27) {
    while (1) {
      switch (_context27.prev = _context27.next) {
        case 0:
          _context27.next = 2;
          return this.getTX(hash);

        case 2:
          wtx = _context27.sent;

          if (wtx) {
            _context27.next = 5;
            break;
          }

          return _context27.abrupt('return');

        case 5:
          if (!(wtx.height === -1)) {
            _context27.next = 7;
            break;
          }

          return _context27.abrupt('return');

        case 7:
          _context27.next = 9;
          return this.disconnect(wtx, wtx.getBlock());

        case 9:
          return _context27.abrupt('return', _context27.sent);

        case 10:
        case 'end':
          return _context27.stop();
      }
    }
  }, unconfirm, this);
}));

/**
 * Unconfirm a transaction. Necessary after a reorg.
 * @param {TXRecord} wtx
 * @returns {Promise}
 */

TXDB.prototype.disconnect = co( /*#__PURE__*/_regenerator2.default.mark(function disconnect(wtx, block) {
  var tx, hash, height, details, i, account, output, coin, credits, input, path, credit;
  return _regenerator2.default.wrap(function disconnect$(_context28) {
    while (1) {
      switch (_context28.prev = _context28.next) {
        case 0:
          tx = wtx.tx;
          hash = wtx.hash;
          height = block.height;
          details = new Details(this, wtx, block);


          assert(block);

          wtx.unsetBlock();

          if (tx.isCoinbase()) {
            _context28.next = 30;
            break;
          }

          _context28.next = 9;
          return this.getSpentCredits(tx);

        case 9:
          credits = _context28.sent;
          i = 0;

        case 11:
          if (!(i < tx.inputs.length)) {
            _context28.next = 30;
            break;
          }

          input = tx.inputs[i];
          credit = credits[i];

          if (credit) {
            _context28.next = 16;
            break;
          }

          return _context28.abrupt('continue', 27);

        case 16:

          coin = credit.coin;

          assert(coin.height !== -1);

          _context28.next = 20;
          return this.getPath(coin);

        case 20:
          path = _context28.sent;

          assert(path);

          details.setInput(i, path, coin);

          this.pending.confirmed += coin.value;

          // Resave the credit and mark it
          // as spent in the mempool instead.
          credit.spent = true;
          _context28.next = 27;
          return this.saveCredit(credit, path);

        case 27:
          i++;
          _context28.next = 11;
          break;

        case 30:
          i = 0;

        case 31:
          if (!(i < tx.outputs.length)) {
            _context28.next = 57;
            break;
          }

          output = tx.outputs[i];
          _context28.next = 35;
          return this.getPath(output);

        case 35:
          path = _context28.sent;

          if (path) {
            _context28.next = 38;
            break;
          }

          return _context28.abrupt('continue', 54);

        case 38:
          _context28.next = 40;
          return this.getCredit(hash, i);

        case 40:
          credit = _context28.sent;

          if (credit) {
            _context28.next = 45;
            break;
          }

          _context28.next = 44;
          return this.updateSpentCoin(tx, i, height);

        case 44:
          return _context28.abrupt('continue', 54);

        case 45:
          if (!credit.spent) {
            _context28.next = 48;
            break;
          }

          _context28.next = 48;
          return this.updateSpentCoin(tx, i, height);

        case 48:

          details.setOutput(i, path);

          // Update coin height and confirmed
          // balance. Save once again.
          coin = credit.coin;
          coin.height = -1;

          this.pending.confirmed -= output.value;

          _context28.next = 54;
          return this.saveCredit(credit, path);

        case 54:
          i++;
          _context28.next = 31;
          break;

        case 57:
          _context28.next = 59;
          return this.removeBlockMap(hash, height);

        case 59:
          _context28.next = 61;
          return this.removeBlock(tx.hash(), height);

        case 61:

          // We need to update the now-removed
          // block properties and reindex due
          // to the height change.
          this.put(layout.t(hash), wtx.toRaw());
          this.put(layout.p(hash), DUMMY);
          this.del(layout.h(height, hash));

          // Secondary indexing also needs to change.
          for (i = 0; i < details.accounts.length; i++) {
            account = details.accounts[i];
            this.put(layout.P(account, hash), DUMMY);
            this.del(layout.H(account, height, hash));
          }

          // Commit state due to unconfirmed
          // vs. confirmed balance change.
          this.put(layout.R, this.pending.commit());

          this.emit('unconfirmed', tx, details);
          this.emit('balance', this.pending.toBalance(), details);

          return _context28.abrupt('return', details);

        case 69:
        case 'end':
          return _context28.stop();
      }
    }
  }, disconnect, this);
}));

/**
 * Remove spenders that have not been confirmed. We do this in the
 * odd case of stuck transactions or when a coin is double-spent
 * by a newer transaction. All previously-spending transactions
 * of that coin that are _not_ confirmed will be removed from
 * the database.
 * @private
 * @param {Hash} hash
 * @param {TX} ref - Reference tx, the tx that double-spent.
 * @returns {Promise} - Returns Boolean.
 */

TXDB.prototype.removeConflict = co( /*#__PURE__*/_regenerator2.default.mark(function removeConflict(wtx) {
  var tx, details;
  return _regenerator2.default.wrap(function removeConflict$(_context29) {
    while (1) {
      switch (_context29.prev = _context29.next) {
        case 0:
          tx = wtx.tx;


          this.logger.warning('Handling conflicting tx: %s.', tx.txid());

          this.drop();

          _context29.next = 5;
          return this.removeRecursive(wtx);

        case 5:
          details = _context29.sent;


          this.start();

          this.logger.warning('Removed conflict: %s.', tx.txid());

          // Emit the _removed_ transaction.
          this.emit('conflict', tx, details);

          return _context29.abrupt('return', details);

        case 10:
        case 'end':
          return _context29.stop();
      }
    }
  }, removeConflict, this);
}));

/**
 * Retrieve coins for own inputs, remove
 * double spenders, and verify inputs.
 * @private
 * @param {TX} tx
 * @returns {Promise}
 */

TXDB.prototype.removeConflicts = co( /*#__PURE__*/_regenerator2.default.mark(function removeConflicts(tx, conf) {
  var hash, spends, i, input, prevout, spent, spender, block;
  return _regenerator2.default.wrap(function removeConflicts$(_context30) {
    while (1) {
      switch (_context30.prev = _context30.next) {
        case 0:
          hash = tx.hash('hex');
          spends = [];

          if (!tx.isCoinbase()) {
            _context30.next = 4;
            break;
          }

          return _context30.abrupt('return', true);

        case 4:
          i = 0;

        case 5:
          if (!(i < tx.inputs.length)) {
            _context30.next = 26;
            break;
          }

          input = tx.inputs[i];
          prevout = input.prevout;

          // Is it already spent?
          _context30.next = 10;
          return this.getSpent(prevout.hash, prevout.index);

        case 10:
          spent = _context30.sent;

          if (spent) {
            _context30.next = 13;
            break;
          }

          return _context30.abrupt('continue', 23);

        case 13:
          if (!(spent.hash === hash)) {
            _context30.next = 15;
            break;
          }

          return _context30.abrupt('continue', 23);

        case 15:
          _context30.next = 17;
          return this.getTX(spent.hash);

        case 17:
          spender = _context30.sent;

          assert(spender);
          block = spender.getBlock();

          if (!(conf && block)) {
            _context30.next = 22;
            break;
          }

          return _context30.abrupt('return', false);

        case 22:

          spends[i] = spender;

        case 23:
          i++;
          _context30.next = 5;
          break;

        case 26:
          i = 0;

        case 27:
          if (!(i < tx.inputs.length)) {
            _context30.next = 36;
            break;
          }

          spender = spends[i];

          if (spender) {
            _context30.next = 31;
            break;
          }

          return _context30.abrupt('continue', 33);

        case 31:
          _context30.next = 33;
          return this.removeConflict(spender);

        case 33:
          i++;
          _context30.next = 27;
          break;

        case 36:
          return _context30.abrupt('return', true);

        case 37:
        case 'end':
          return _context30.stop();
      }
    }
  }, removeConflicts, this);
}));

/**
 * Attempt to verify an input.
 * @private
 * @param {TX} tx
 * @param {Number} index
 * @param {Coin} coin
 * @returns {Promise}
 */

TXDB.prototype.verifyInput = co( /*#__PURE__*/_regenerator2.default.mark(function verifyInput(tx, index, coin) {
  var flags;
  return _regenerator2.default.wrap(function verifyInput$(_context31) {
    while (1) {
      switch (_context31.prev = _context31.next) {
        case 0:
          flags = Script.flags.MANDATORY_VERIFY_FLAGS;

          if (this.options.verify) {
            _context31.next = 3;
            break;
          }

          return _context31.abrupt('return', true);

        case 3:
          _context31.next = 5;
          return tx.verifyInputAsync(index, coin, flags);

        case 5:
          return _context31.abrupt('return', _context31.sent);

        case 6:
        case 'end':
          return _context31.stop();
      }
    }
  }, verifyInput, this);
}));

/**
 * Lock all coins in a transaction.
 * @param {TX} tx
 */

TXDB.prototype.lockTX = function lockTX(tx) {
  var i, input;

  if (tx.isCoinbase()) return;

  for (i = 0; i < tx.inputs.length; i++) {
    input = tx.inputs[i];
    this.lockCoin(input.prevout);
  }
};

/**
 * Unlock all coins in a transaction.
 * @param {TX} tx
 */

TXDB.prototype.unlockTX = function unlockTX(tx) {
  var i, input;

  if (tx.isCoinbase()) return;

  for (i = 0; i < tx.inputs.length; i++) {
    input = tx.inputs[i];
    this.unlockCoin(input.prevout);
  }
};

/**
 * Lock a single coin.
 * @param {Coin|Outpoint} coin
 */

TXDB.prototype.lockCoin = function lockCoin(coin) {
  var key = coin.toKey();
  this.locked[key] = true;
};

/**
 * Unlock a single coin.
 * @param {Coin|Outpoint} coin
 */

TXDB.prototype.unlockCoin = function unlockCoin(coin) {
  var key = coin.toKey();
  delete this.locked[key];
};

/**
 * Test locked status of a single coin.
 * @param {Coin|Outpoint} coin
 */

TXDB.prototype.isLocked = function isLocked(coin) {
  var key = coin.toKey();
  return this.locked[key] === true;
};

/**
 * Filter array of coins or outpoints
 * for only unlocked ones.
 * @param {Coin[]|Outpoint[]}
 * @returns {Array}
 */

TXDB.prototype.filterLocked = function filterLocked(coins) {
  var out = [];
  var i, coin;

  for (i = 0; i < coins.length; i++) {
    coin = coins[i];
    if (!this.isLocked(coin)) out.push(coin);
  }

  return out;
};

/**
 * Return an array of all locked outpoints.
 * @returns {Outpoint[]}
 */

TXDB.prototype.getLocked = function getLocked() {
  var keys = (0, _keys2.default)(this.locked);
  var outpoints = [];
  var i, key;

  for (i = 0; i < keys.length; i++) {
    key = keys[i];
    outpoints.push(Outpoint.fromKey(key));
  }

  return outpoints;
};

/**
 * Get hashes of all transactions in the database.
 * @param {Number?} account
 * @returns {Promise} - Returns {@link Hash}[].
 */

TXDB.prototype.getAccountHistoryHashes = function getHistoryHashes(account) {
  return this.keys({
    gte: layout.T(account, encoding.NULL_HASH),
    lte: layout.T(account, encoding.HIGH_HASH),
    parse: function parse(key) {
      key = layout.Tt(key);
      return key[1];
    }
  });
};

/**
 * Get hashes of all transactions in the database.
 * @param {Number?} account
 * @returns {Promise} - Returns {@link Hash}[].
 */

TXDB.prototype.getHistoryHashes = function getHistoryHashes(account) {
  if (account != null) return this.getAccountHistoryHashes(account);

  return this.keys({
    gte: layout.t(encoding.NULL_HASH),
    lte: layout.t(encoding.HIGH_HASH),
    parse: function parse(key) {
      return layout.tt(key);
    }
  });
};

/**
 * Get hashes of all unconfirmed transactions in the database.
 * @param {Number?} account
 * @returns {Promise} - Returns {@link Hash}[].
 */

TXDB.prototype.getAccountPendingHashes = function getAccountPendingHashes(account) {
  return this.keys({
    gte: layout.P(account, encoding.NULL_HASH),
    lte: layout.P(account, encoding.HIGH_HASH),
    parse: function parse(key) {
      key = layout.Pp(key);
      return key[1];
    }
  });
};

/**
 * Get hashes of all unconfirmed transactions in the database.
 * @param {Number?} account
 * @returns {Promise} - Returns {@link Hash}[].
 */

TXDB.prototype.getPendingHashes = function getPendingHashes(account) {
  if (account != null) return this.getAccountPendingHashes(account);

  return this.keys({
    gte: layout.p(encoding.NULL_HASH),
    lte: layout.p(encoding.HIGH_HASH),
    parse: function parse(key) {
      return layout.pp(key);
    }
  });
};

/**
 * Get all coin hashes in the database.
 * @param {Number?} account
 * @returns {Promise} - Returns {@link Hash}[].
 */

TXDB.prototype.getAccountOutpoints = function getAccountOutpoints(account) {
  return this.keys({
    gte: layout.C(account, encoding.NULL_HASH, 0),
    lte: layout.C(account, encoding.HIGH_HASH, 0xffffffff),
    parse: function parse(key) {
      key = layout.Cc(key);
      return new Outpoint(key[1], key[2]);
    }
  });
};

/**
 * Get all coin hashes in the database.
 * @param {Number?} account
 * @returns {Promise} - Returns {@link Hash}[].
 */

TXDB.prototype.getOutpoints = function getOutpoints(account) {
  if (account != null) return this.getAccountOutpoints(account);

  return this.keys({
    gte: layout.c(encoding.NULL_HASH, 0),
    lte: layout.c(encoding.HIGH_HASH, 0xffffffff),
    parse: function parse(key) {
      key = layout.cc(key);
      return new Outpoint(key[0], key[1]);
    }
  });
};

/**
 * Get TX hashes by height range.
 * @param {Number?} account
 * @param {Object} options
 * @param {Number} options.start - Start height.
 * @param {Number} options.end - End height.
 * @param {Number?} options.limit - Max number of records.
 * @param {Boolean?} options.reverse - Reverse order.
 * @returns {Promise} - Returns {@link Hash}[].
 */

TXDB.prototype.getAccountHeightRangeHashes = function getAccountHeightRangeHashes(account, options) {
  var start = options.start || 0;
  var end = options.end || 0xffffffff;

  return this.keys({
    gte: layout.H(account, start, encoding.NULL_HASH),
    lte: layout.H(account, end, encoding.HIGH_HASH),
    limit: options.limit,
    reverse: options.reverse,
    parse: function parse(key) {
      key = layout.Hh(key);
      return key[2];
    }
  });
};

/**
 * Get TX hashes by height range.
 * @param {Number?} account
 * @param {Object} options
 * @param {Number} options.start - Start height.
 * @param {Number} options.end - End height.
 * @param {Number?} options.limit - Max number of records.
 * @param {Boolean?} options.reverse - Reverse order.
 * @returns {Promise} - Returns {@link Hash}[].
 */

TXDB.prototype.getHeightRangeHashes = function getHeightRangeHashes(account, options) {
  var start, end;

  if (account && (typeof account === 'undefined' ? 'undefined' : (0, _typeof3.default)(account)) === 'object') {
    options = account;
    account = null;
  }

  if (account != null) return this.getAccountHeightRangeHashes(account, options);

  start = options.start || 0;
  end = options.end || 0xffffffff;

  return this.keys({
    gte: layout.h(start, encoding.NULL_HASH),
    lte: layout.h(end, encoding.HIGH_HASH),
    limit: options.limit,
    reverse: options.reverse,
    parse: function parse(key) {
      key = layout.hh(key);
      return key[1];
    }
  });
};

/**
 * Get TX hashes by height.
 * @param {Number} height
 * @returns {Promise} - Returns {@link Hash}[].
 */

TXDB.prototype.getHeightHashes = function getHeightHashes(height) {
  return this.getHeightRangeHashes({ start: height, end: height });
};

/**
 * Get TX hashes by timestamp range.
 * @param {Number?} account
 * @param {Object} options
 * @param {Number} options.start - Start height.
 * @param {Number} options.end - End height.
 * @param {Number?} options.limit - Max number of records.
 * @param {Boolean?} options.reverse - Reverse order.
 * @returns {Promise} - Returns {@link Hash}[].
 */

TXDB.prototype.getAccountRangeHashes = function getAccountRangeHashes(account, options) {
  var start = options.start || 0;
  var end = options.end || 0xffffffff;

  return this.keys({
    gte: layout.M(account, start, encoding.NULL_HASH),
    lte: layout.M(account, end, encoding.HIGH_HASH),
    limit: options.limit,
    reverse: options.reverse,
    parse: function parse(key) {
      key = layout.Mm(key);
      return key[2];
    }
  });
};

/**
 * Get TX hashes by timestamp range.
 * @param {Number?} account
 * @param {Object} options
 * @param {Number} options.start - Start height.
 * @param {Number} options.end - End height.
 * @param {Number?} options.limit - Max number of records.
 * @param {Boolean?} options.reverse - Reverse order.
 * @returns {Promise} - Returns {@link Hash}[].
 */

TXDB.prototype.getRangeHashes = function getRangeHashes(account, options) {
  var start, end;

  if (account && (typeof account === 'undefined' ? 'undefined' : (0, _typeof3.default)(account)) === 'object') {
    options = account;
    account = null;
  }

  if (account != null) return this.getAccountRangeHashes(account, options);

  start = options.start || 0;
  end = options.end || 0xffffffff;

  return this.keys({
    gte: layout.m(start, encoding.NULL_HASH),
    lte: layout.m(end, encoding.HIGH_HASH),
    limit: options.limit,
    reverse: options.reverse,
    parse: function parse(key) {
      key = layout.mm(key);
      return key[1];
    }
  });
};

/**
 * Get transactions by timestamp range.
 * @param {Number?} account
 * @param {Object} options
 * @param {Number} options.start - Start time.
 * @param {Number} options.end - End time.
 * @param {Number?} options.limit - Max number of records.
 * @param {Boolean?} options.reverse - Reverse order.
 * @returns {Promise} - Returns {@link TX}[].
 */

TXDB.prototype.getRange = co( /*#__PURE__*/_regenerator2.default.mark(function getRange(account, options) {
  var txs, i, hashes, hash, tx;
  return _regenerator2.default.wrap(function getRange$(_context32) {
    while (1) {
      switch (_context32.prev = _context32.next) {
        case 0:
          txs = [];


          if (account && (typeof account === 'undefined' ? 'undefined' : (0, _typeof3.default)(account)) === 'object') {
            options = account;
            account = null;
          }

          _context32.next = 4;
          return this.getRangeHashes(account, options);

        case 4:
          hashes = _context32.sent;
          i = 0;

        case 6:
          if (!(i < hashes.length)) {
            _context32.next = 17;
            break;
          }

          hash = hashes[i];
          _context32.next = 10;
          return this.getTX(hash);

        case 10:
          tx = _context32.sent;

          if (tx) {
            _context32.next = 13;
            break;
          }

          return _context32.abrupt('continue', 14);

        case 13:

          txs.push(tx);

        case 14:
          i++;
          _context32.next = 6;
          break;

        case 17:
          return _context32.abrupt('return', txs);

        case 18:
        case 'end':
          return _context32.stop();
      }
    }
  }, getRange, this);
}));

/**
 * Get last N transactions.
 * @param {Number?} account
 * @param {Number} limit - Max number of transactions.
 * @returns {Promise} - Returns {@link TX}[].
 */

TXDB.prototype.getLast = function getLast(account, limit) {
  return this.getRange(account, {
    start: 0,
    end: 0xffffffff,
    reverse: true,
    limit: limit || 10
  });
};

/**
 * Get all transactions.
 * @param {Number?} account
 * @returns {Promise} - Returns {@link TX}[].
 */

TXDB.prototype.getHistory = function getHistory(account) {
  // Slow case
  if (account != null) return this.getAccountHistory(account);

  // Fast case
  return this.values({
    gte: layout.t(encoding.NULL_HASH),
    lte: layout.t(encoding.HIGH_HASH),
    parse: TXRecord.fromRaw
  });
};

/**
 * Get all account transactions.
 * @param {Number?} account
 * @returns {Promise} - Returns {@link TX}[].
 */

TXDB.prototype.getAccountHistory = co( /*#__PURE__*/_regenerator2.default.mark(function getAccountHistory(account) {
  var hashes, txs, i, hash, tx;
  return _regenerator2.default.wrap(function getAccountHistory$(_context33) {
    while (1) {
      switch (_context33.prev = _context33.next) {
        case 0:
          _context33.next = 2;
          return this.getHistoryHashes(account);

        case 2:
          hashes = _context33.sent;
          txs = [];
          i = 0;

        case 5:
          if (!(i < hashes.length)) {
            _context33.next = 16;
            break;
          }

          hash = hashes[i];
          _context33.next = 9;
          return this.getTX(hash);

        case 9:
          tx = _context33.sent;

          if (tx) {
            _context33.next = 12;
            break;
          }

          return _context33.abrupt('continue', 13);

        case 12:

          txs.push(tx);

        case 13:
          i++;
          _context33.next = 5;
          break;

        case 16:
          return _context33.abrupt('return', txs);

        case 17:
        case 'end':
          return _context33.stop();
      }
    }
  }, getAccountHistory, this);
}));

/**
 * Get unconfirmed transactions.
 * @param {Number?} account
 * @returns {Promise} - Returns {@link TX}[].
 */

TXDB.prototype.getPending = co( /*#__PURE__*/_regenerator2.default.mark(function getPending(account) {
  var hashes, txs, i, hash, tx;
  return _regenerator2.default.wrap(function getPending$(_context34) {
    while (1) {
      switch (_context34.prev = _context34.next) {
        case 0:
          _context34.next = 2;
          return this.getPendingHashes(account);

        case 2:
          hashes = _context34.sent;
          txs = [];
          i = 0;

        case 5:
          if (!(i < hashes.length)) {
            _context34.next = 16;
            break;
          }

          hash = hashes[i];
          _context34.next = 9;
          return this.getTX(hash);

        case 9:
          tx = _context34.sent;

          if (tx) {
            _context34.next = 12;
            break;
          }

          return _context34.abrupt('continue', 13);

        case 12:

          txs.push(tx);

        case 13:
          i++;
          _context34.next = 5;
          break;

        case 16:
          return _context34.abrupt('return', txs);

        case 17:
        case 'end':
          return _context34.stop();
      }
    }
  }, getPending, this);
}));

/**
 * Get coins.
 * @param {Number?} account
 * @returns {Promise} - Returns {@link Coin}[].
 */

TXDB.prototype.getCredits = function getCredits(account) {
  var self = this;

  // Slow case
  if (account != null) return this.getAccountCredits(account);

  // Fast case
  return this.range({
    gte: layout.c(encoding.NULL_HASH, 0x00000000),
    lte: layout.c(encoding.HIGH_HASH, 0xffffffff),
    parse: function parse(key, value) {
      var parts = layout.cc(key);
      var hash = parts[0];
      var index = parts[1];
      var credit = Credit.fromRaw(value);
      var ckey = Outpoint.toKey(hash, index);
      credit.coin.hash = hash;
      credit.coin.index = index;
      self.coinCache.set(ckey, value);
      return credit;
    }
  });
};

/**
 * Get coins by account.
 * @param {Number} account
 * @returns {Promise} - Returns {@link Coin}[].
 */

TXDB.prototype.getAccountCredits = co( /*#__PURE__*/_regenerator2.default.mark(function getAccountCredits(account) {
  var outpoints, credits, i, prevout, credit;
  return _regenerator2.default.wrap(function getAccountCredits$(_context35) {
    while (1) {
      switch (_context35.prev = _context35.next) {
        case 0:
          _context35.next = 2;
          return this.getOutpoints(account);

        case 2:
          outpoints = _context35.sent;
          credits = [];
          i = 0;

        case 5:
          if (!(i < outpoints.length)) {
            _context35.next = 16;
            break;
          }

          prevout = outpoints[i];
          _context35.next = 9;
          return this.getCredit(prevout.hash, prevout.index);

        case 9:
          credit = _context35.sent;

          if (credit) {
            _context35.next = 12;
            break;
          }

          return _context35.abrupt('continue', 13);

        case 12:

          credits.push(credit);

        case 13:
          i++;
          _context35.next = 5;
          break;

        case 16:
          return _context35.abrupt('return', credits);

        case 17:
        case 'end':
          return _context35.stop();
      }
    }
  }, getAccountCredits, this);
}));

/**
 * Fill a transaction with coins (all historical coins).
 * @param {TX} tx
 * @returns {Promise} - Returns {@link TX}.
 */

TXDB.prototype.getSpentCredits = co( /*#__PURE__*/_regenerator2.default.mark(function getSpentCredits(tx) {
  var credits, i, hash;
  return _regenerator2.default.wrap(function getSpentCredits$(_context36) {
    while (1) {
      switch (_context36.prev = _context36.next) {
        case 0:
          credits = [];


          for (i = 0; i < tx.inputs.length; i++) {
            credits.push(null);
          }
          if (!tx.isCoinbase()) {
            _context36.next = 4;
            break;
          }

          return _context36.abrupt('return', credits);

        case 4:

          hash = tx.hash('hex');

          _context36.next = 7;
          return this.range({
            gte: layout.d(hash, 0x00000000),
            lte: layout.d(hash, 0xffffffff),
            parse: function parse(key, value) {
              var index = layout.dd(key)[1];
              var coin = Coin.fromRaw(value);
              var input = tx.inputs[index];
              assert(input);
              coin.hash = input.prevout.hash;
              coin.index = input.prevout.index;
              credits[index] = new Credit(coin);
            }
          });

        case 7:
          return _context36.abrupt('return', credits);

        case 8:
        case 'end':
          return _context36.stop();
      }
    }
  }, getSpentCredits, this);
}));

/**
 * Get coins.
 * @param {Number?} account
 * @returns {Promise} - Returns {@link Coin}[].
 */

TXDB.prototype.getCoins = co( /*#__PURE__*/_regenerator2.default.mark(function getCoins(account) {
  var credits, coins, i, credit;
  return _regenerator2.default.wrap(function getCoins$(_context37) {
    while (1) {
      switch (_context37.prev = _context37.next) {
        case 0:
          _context37.next = 2;
          return this.getCredits(account);

        case 2:
          credits = _context37.sent;
          coins = [];
          i = 0;

        case 5:
          if (!(i < credits.length)) {
            _context37.next = 13;
            break;
          }

          credit = credits[i];

          if (!credit.spent) {
            _context37.next = 9;
            break;
          }

          return _context37.abrupt('continue', 10);

        case 9:

          coins.push(credit.coin);

        case 10:
          i++;
          _context37.next = 5;
          break;

        case 13:
          return _context37.abrupt('return', coins);

        case 14:
        case 'end':
          return _context37.stop();
      }
    }
  }, getCoins, this);
}));

/**
 * Get coins by account.
 * @param {Number} account
 * @returns {Promise} - Returns {@link Coin}[].
 */

TXDB.prototype.getAccountCoins = co( /*#__PURE__*/_regenerator2.default.mark(function getAccountCoins(account) {
  var credits, coins, i, credit;
  return _regenerator2.default.wrap(function getAccountCoins$(_context38) {
    while (1) {
      switch (_context38.prev = _context38.next) {
        case 0:
          _context38.next = 2;
          return this.getAccountCredits(account);

        case 2:
          credits = _context38.sent;
          coins = [];
          i = 0;

        case 5:
          if (!(i < credits.length)) {
            _context38.next = 13;
            break;
          }

          credit = credits[i];

          if (!credit.spent) {
            _context38.next = 9;
            break;
          }

          return _context38.abrupt('continue', 10);

        case 9:

          coins.push(credit.coin);

        case 10:
          i++;
          _context38.next = 5;
          break;

        case 13:
          return _context38.abrupt('return', coins);

        case 14:
        case 'end':
          return _context38.stop();
      }
    }
  }, getAccountCoins, this);
}));

/**
 * Get historical coins for a transaction.
 * @param {TX} tx
 * @returns {Promise} - Returns {@link TX}.
 */

TXDB.prototype.getSpentCoins = co( /*#__PURE__*/_regenerator2.default.mark(function getSpentCoins(tx) {
  var coins, i, input, credits, credit;
  return _regenerator2.default.wrap(function getSpentCoins$(_context39) {
    while (1) {
      switch (_context39.prev = _context39.next) {
        case 0:
          coins = [];

          if (!tx.isCoinbase()) {
            _context39.next = 3;
            break;
          }

          return _context39.abrupt('return', coins);

        case 3:
          _context39.next = 5;
          return this.getSpentCredits(tx);

        case 5:
          credits = _context39.sent;
          i = 0;

        case 7:
          if (!(i < tx.inputs.length)) {
            _context39.next = 17;
            break;
          }

          input = tx.inputs[i];
          credit = credits[i];

          if (credit) {
            _context39.next = 13;
            break;
          }

          coins.push(null);
          return _context39.abrupt('continue', 14);

        case 13:

          coins.push(credit.coin);

        case 14:
          i++;
          _context39.next = 7;
          break;

        case 17:
          return _context39.abrupt('return', coins);

        case 18:
        case 'end':
          return _context39.stop();
      }
    }
  }, getSpentCoins, this);
}));

/**
 * Get a coin viewpoint.
 * @param {TX} tx
 * @returns {Promise} - Returns {@link CoinView}.
 */

TXDB.prototype.getCoinView = co( /*#__PURE__*/_regenerator2.default.mark(function getCoinView(tx) {
  var view, i, input, prevout, coin;
  return _regenerator2.default.wrap(function getCoinView$(_context40) {
    while (1) {
      switch (_context40.prev = _context40.next) {
        case 0:
          view = new CoinView();

          if (!tx.isCoinbase()) {
            _context40.next = 3;
            break;
          }

          return _context40.abrupt('return', view);

        case 3:
          i = 0;

        case 4:
          if (!(i < tx.inputs.length)) {
            _context40.next = 16;
            break;
          }

          input = tx.inputs[i];
          prevout = input.prevout;
          _context40.next = 9;
          return this.getCoin(prevout.hash, prevout.index);

        case 9:
          coin = _context40.sent;

          if (coin) {
            _context40.next = 12;
            break;
          }

          return _context40.abrupt('continue', 13);

        case 12:

          view.addCoin(coin);

        case 13:
          i++;
          _context40.next = 4;
          break;

        case 16:
          return _context40.abrupt('return', view);

        case 17:
        case 'end':
          return _context40.stop();
      }
    }
  }, getCoinView, this);
}));

/**
 * Get historical coin viewpoint.
 * @param {TX} tx
 * @returns {Promise} - Returns {@link CoinView}.
 */

TXDB.prototype.getSpentView = co( /*#__PURE__*/_regenerator2.default.mark(function getSpentView(tx) {
  var view, i, coins, coin;
  return _regenerator2.default.wrap(function getSpentView$(_context41) {
    while (1) {
      switch (_context41.prev = _context41.next) {
        case 0:
          view = new CoinView();

          if (!tx.isCoinbase()) {
            _context41.next = 3;
            break;
          }

          return _context41.abrupt('return', view);

        case 3:
          _context41.next = 5;
          return this.getSpentCoins(tx);

        case 5:
          coins = _context41.sent;
          i = 0;

        case 7:
          if (!(i < coins.length)) {
            _context41.next = 15;
            break;
          }

          coin = coins[i];

          if (coin) {
            _context41.next = 11;
            break;
          }

          return _context41.abrupt('continue', 12);

        case 11:

          view.addCoin(coin);

        case 12:
          i++;
          _context41.next = 7;
          break;

        case 15:
          return _context41.abrupt('return', view);

        case 16:
        case 'end':
          return _context41.stop();
      }
    }
  }, getSpentView, this);
}));

/**
 * Get TXDB state.
 * @returns {Promise}
 */

TXDB.prototype.getState = co( /*#__PURE__*/_regenerator2.default.mark(function getState() {
  var data;
  return _regenerator2.default.wrap(function getState$(_context42) {
    while (1) {
      switch (_context42.prev = _context42.next) {
        case 0:
          _context42.next = 2;
          return this.get(layout.R);

        case 2:
          data = _context42.sent;

          if (data) {
            _context42.next = 5;
            break;
          }

          return _context42.abrupt('return');

        case 5:
          return _context42.abrupt('return', TXDBState.fromRaw(this.wallet.wid, this.wallet.id, data));

        case 6:
        case 'end':
          return _context42.stop();
      }
    }
  }, getState, this);
}));

/**
 * Get transaction.
 * @param {Hash} hash
 * @returns {Promise} - Returns {@link TX}.
 */

TXDB.prototype.getTX = co( /*#__PURE__*/_regenerator2.default.mark(function getTX(hash) {
  var raw;
  return _regenerator2.default.wrap(function getTX$(_context43) {
    while (1) {
      switch (_context43.prev = _context43.next) {
        case 0:
          _context43.next = 2;
          return this.get(layout.t(hash));

        case 2:
          raw = _context43.sent;

          if (raw) {
            _context43.next = 5;
            break;
          }

          return _context43.abrupt('return');

        case 5:
          return _context43.abrupt('return', TXRecord.fromRaw(raw));

        case 6:
        case 'end':
          return _context43.stop();
      }
    }
  }, getTX, this);
}));

/**
 * Get transaction details.
 * @param {Hash} hash
 * @returns {Promise} - Returns {@link TXDetails}.
 */

TXDB.prototype.getDetails = co( /*#__PURE__*/_regenerator2.default.mark(function getDetails(hash) {
  var wtx;
  return _regenerator2.default.wrap(function getDetails$(_context44) {
    while (1) {
      switch (_context44.prev = _context44.next) {
        case 0:
          _context44.next = 2;
          return this.getTX(hash);

        case 2:
          wtx = _context44.sent;

          if (wtx) {
            _context44.next = 5;
            break;
          }

          return _context44.abrupt('return');

        case 5:
          _context44.next = 7;
          return this.toDetails(wtx);

        case 7:
          return _context44.abrupt('return', _context44.sent);

        case 8:
        case 'end':
          return _context44.stop();
      }
    }
  }, getDetails, this);
}));

/**
 * Convert transaction to transaction details.
 * @param {TXRecord[]} wtxs
 * @returns {Promise}
 */

TXDB.prototype.toDetails = co( /*#__PURE__*/_regenerator2.default.mark(function toDetails(wtxs) {
  var i, out, wtx, details;
  return _regenerator2.default.wrap(function toDetails$(_context45) {
    while (1) {
      switch (_context45.prev = _context45.next) {
        case 0:
          if (Array.isArray(wtxs)) {
            _context45.next = 4;
            break;
          }

          _context45.next = 3;
          return this._toDetails(wtxs);

        case 3:
          return _context45.abrupt('return', _context45.sent);

        case 4:

          out = [];

          i = 0;

        case 6:
          if (!(i < wtxs.length)) {
            _context45.next = 17;
            break;
          }

          wtx = wtxs[i];
          _context45.next = 10;
          return this._toDetails(wtx);

        case 10:
          details = _context45.sent;

          if (details) {
            _context45.next = 13;
            break;
          }

          return _context45.abrupt('continue', 14);

        case 13:

          out.push(details);

        case 14:
          i++;
          _context45.next = 6;
          break;

        case 17:
          return _context45.abrupt('return', out);

        case 18:
        case 'end':
          return _context45.stop();
      }
    }
  }, toDetails, this);
}));

/**
 * Convert transaction to transaction details.
 * @private
 * @param {TXRecord} wtx
 * @returns {Promise}
 */

TXDB.prototype._toDetails = co( /*#__PURE__*/_regenerator2.default.mark(function _toDetails(wtx) {
  var tx, block, details, coins, i, coin, path, output;
  return _regenerator2.default.wrap(function _toDetails$(_context46) {
    while (1) {
      switch (_context46.prev = _context46.next) {
        case 0:
          tx = wtx.tx;
          block = wtx.getBlock();
          details = new Details(this, wtx, block);
          _context46.next = 5;
          return this.getSpentCoins(tx);

        case 5:
          coins = _context46.sent;
          i = 0;

        case 7:
          if (!(i < tx.inputs.length)) {
            _context46.next = 18;
            break;
          }

          coin = coins[i];
          path = null;

          if (!coin) {
            _context46.next = 14;
            break;
          }

          _context46.next = 13;
          return this.getPath(coin);

        case 13:
          path = _context46.sent;

        case 14:

          details.setInput(i, path, coin);

        case 15:
          i++;
          _context46.next = 7;
          break;

        case 18:
          i = 0;

        case 19:
          if (!(i < tx.outputs.length)) {
            _context46.next = 28;
            break;
          }

          output = tx.outputs[i];
          _context46.next = 23;
          return this.getPath(output);

        case 23:
          path = _context46.sent;

          details.setOutput(i, path);

        case 25:
          i++;
          _context46.next = 19;
          break;

        case 28:
          return _context46.abrupt('return', details);

        case 29:
        case 'end':
          return _context46.stop();
      }
    }
  }, _toDetails, this);
}));

/**
 * Test whether the database has a transaction.
 * @param {Hash} hash
 * @returns {Promise} - Returns Boolean.
 */

TXDB.prototype.hasTX = function hasTX(hash) {
  return this.has(layout.t(hash));
};

/**
 * Get coin.
 * @param {Hash} hash
 * @param {Number} index
 * @returns {Promise} - Returns {@link Coin}.
 */

TXDB.prototype.getCoin = co( /*#__PURE__*/_regenerator2.default.mark(function getCoin(hash, index) {
  var credit;
  return _regenerator2.default.wrap(function getCoin$(_context47) {
    while (1) {
      switch (_context47.prev = _context47.next) {
        case 0:
          _context47.next = 2;
          return this.getCredit(hash, index);

        case 2:
          credit = _context47.sent;

          if (credit) {
            _context47.next = 5;
            break;
          }

          return _context47.abrupt('return');

        case 5:
          return _context47.abrupt('return', credit.coin);

        case 6:
        case 'end':
          return _context47.stop();
      }
    }
  }, getCoin, this);
}));

/**
 * Get coin.
 * @param {Hash} hash
 * @param {Number} index
 * @returns {Promise} - Returns {@link Coin}.
 */

TXDB.prototype.getCredit = co( /*#__PURE__*/_regenerator2.default.mark(function getCredit(hash, index) {
  var state, key, data, credit;
  return _regenerator2.default.wrap(function getCredit$(_context48) {
    while (1) {
      switch (_context48.prev = _context48.next) {
        case 0:
          state = this.state;
          key = Outpoint.toKey(hash, index);
          data = this.coinCache.get(key);

          if (!data) {
            _context48.next = 8;
            break;
          }

          credit = Credit.fromRaw(data);
          credit.coin.hash = hash;
          credit.coin.index = index;
          return _context48.abrupt('return', credit);

        case 8:
          _context48.next = 10;
          return this.get(layout.c(hash, index));

        case 10:
          data = _context48.sent;

          if (data) {
            _context48.next = 13;
            break;
          }

          return _context48.abrupt('return');

        case 13:

          credit = Credit.fromRaw(data);
          credit.coin.hash = hash;
          credit.coin.index = index;

          if (state === this.state) this.coinCache.set(key, data);

          return _context48.abrupt('return', credit);

        case 18:
        case 'end':
          return _context48.stop();
      }
    }
  }, getCredit, this);
}));

/**
 * Get spender coin.
 * @param {Outpoint} spent
 * @param {Outpoint} prevout
 * @returns {Promise} - Returns {@link Coin}.
 */

TXDB.prototype.getSpentCoin = co( /*#__PURE__*/_regenerator2.default.mark(function getSpentCoin(spent, prevout) {
  var data, coin;
  return _regenerator2.default.wrap(function getSpentCoin$(_context49) {
    while (1) {
      switch (_context49.prev = _context49.next) {
        case 0:
          _context49.next = 2;
          return this.get(layout.d(spent.hash, spent.index));

        case 2:
          data = _context49.sent;

          if (data) {
            _context49.next = 5;
            break;
          }

          return _context49.abrupt('return');

        case 5:

          coin = Coin.fromRaw(data);
          coin.hash = prevout.hash;
          coin.index = prevout.index;

          return _context49.abrupt('return', coin);

        case 9:
        case 'end':
          return _context49.stop();
      }
    }
  }, getSpentCoin, this);
}));

/**
 * Test whether the database has a spent coin.
 * @param {Outpoint} spent
 * @returns {Promise} - Returns {@link Coin}.
 */

TXDB.prototype.hasSpentCoin = function hasSpentCoin(spent) {
  return this.has(layout.d(spent.hash, spent.index));
};

/**
 * Update spent coin height in storage.
 * @param {TX} tx - Sending transaction.
 * @param {Number} index
 * @param {Number} height
 * @returns {Promise}
 */

TXDB.prototype.updateSpentCoin = co( /*#__PURE__*/_regenerator2.default.mark(function updateSpentCoin(tx, index, height) {
  var prevout, spent, coin;
  return _regenerator2.default.wrap(function updateSpentCoin$(_context50) {
    while (1) {
      switch (_context50.prev = _context50.next) {
        case 0:
          prevout = Outpoint.fromTX(tx, index);
          _context50.next = 3;
          return this.getSpent(prevout.hash, prevout.index);

        case 3:
          spent = _context50.sent;

          if (spent) {
            _context50.next = 6;
            break;
          }

          return _context50.abrupt('return');

        case 6:
          _context50.next = 8;
          return this.getSpentCoin(spent, prevout);

        case 8:
          coin = _context50.sent;

          if (coin) {
            _context50.next = 11;
            break;
          }

          return _context50.abrupt('return');

        case 11:

          coin.height = height;

          this.put(layout.d(spent.hash, spent.index), coin.toRaw());

        case 13:
        case 'end':
          return _context50.stop();
      }
    }
  }, updateSpentCoin, this);
}));

/**
 * Test whether the database has a transaction.
 * @param {Hash} hash
 * @returns {Promise} - Returns Boolean.
 */

TXDB.prototype.hasCoin = function hasCoin(hash, index) {
  var key = Outpoint.toKey(hash, index);

  if (this.coinCache.has(key)) return _promise2.default.resolve(true);

  return this.has(layout.c(hash, index));
};

/**
 * Calculate balance.
 * @param {Number?} account
 * @returns {Promise} - Returns {@link Balance}.
 */

TXDB.prototype.getBalance = co( /*#__PURE__*/_regenerator2.default.mark(function getBalance(account) {
  return _regenerator2.default.wrap(function getBalance$(_context51) {
    while (1) {
      switch (_context51.prev = _context51.next) {
        case 0:
          if (!(account != null)) {
            _context51.next = 4;
            break;
          }

          _context51.next = 3;
          return this.getAccountBalance(account);

        case 3:
          return _context51.abrupt('return', _context51.sent);

        case 4:
          return _context51.abrupt('return', this.state.toBalance());

        case 5:
        case 'end':
          return _context51.stop();
      }
    }
  }, getBalance, this);
}));

/**
 * Calculate balance.
 * @param {Number?} account
 * @returns {Promise} - Returns {@link Balance}.
 */

TXDB.prototype.getWalletBalance = co( /*#__PURE__*/_regenerator2.default.mark(function getWalletBalance() {
  var credits, balance, i, credit, coin;
  return _regenerator2.default.wrap(function getWalletBalance$(_context52) {
    while (1) {
      switch (_context52.prev = _context52.next) {
        case 0:
          _context52.next = 2;
          return this.getCredits();

        case 2:
          credits = _context52.sent;
          balance = new Balance(this.wallet.wid, this.wallet.id, -1);


          for (i = 0; i < credits.length; i++) {
            credit = credits[i];
            coin = credit.coin;

            if (coin.height !== -1) balance.confirmed += coin.value;

            if (!credit.spent) balance.unconfirmed += coin.value;
          }

          return _context52.abrupt('return', balance);

        case 6:
        case 'end':
          return _context52.stop();
      }
    }
  }, getWalletBalance, this);
}));

/**
 * Calculate balance by account.
 * @param {Number} account
 * @returns {Promise} - Returns {@link Balance}.
 */

TXDB.prototype.getAccountBalance = co( /*#__PURE__*/_regenerator2.default.mark(function getAccountBalance(account) {
  var credits, balance, i, credit, coin;
  return _regenerator2.default.wrap(function getAccountBalance$(_context53) {
    while (1) {
      switch (_context53.prev = _context53.next) {
        case 0:
          _context53.next = 2;
          return this.getAccountCredits(account);

        case 2:
          credits = _context53.sent;
          balance = new Balance(this.wallet.wid, this.wallet.id, account);


          for (i = 0; i < credits.length; i++) {
            credit = credits[i];
            coin = credit.coin;

            if (coin.height !== -1) balance.confirmed += coin.value;

            if (!credit.spent) balance.unconfirmed += coin.value;
          }

          return _context53.abrupt('return', balance);

        case 6:
        case 'end':
          return _context53.stop();
      }
    }
  }, getAccountBalance, this);
}));

/**
 * Zap pending transactions older than `age`.
 * @param {Number?} account
 * @param {Number} age - Age delta (delete transactions older than `now - age`).
 * @returns {Promise}
 */

TXDB.prototype.zap = co( /*#__PURE__*/_regenerator2.default.mark(function zap(account, age) {
  var hashes, now, i, txs, wtx;
  return _regenerator2.default.wrap(function zap$(_context54) {
    while (1) {
      switch (_context54.prev = _context54.next) {
        case 0:
          hashes = [];
          now = util.now();


          assert(util.isUInt32(age));

          _context54.next = 5;
          return this.getRange(account, {
            start: 0,
            end: now - age
          });

        case 5:
          txs = _context54.sent;
          i = 0;

        case 7:
          if (!(i < txs.length)) {
            _context54.next = 19;
            break;
          }

          wtx = txs[i];

          if (!(wtx.height !== -1)) {
            _context54.next = 11;
            break;
          }

          return _context54.abrupt('continue', 16);

        case 11:

          assert(now - wtx.ps >= age);

          this.logger.debug('Zapping TX: %s (%s)', wtx.tx.txid(), this.wallet.id);

          _context54.next = 15;
          return this.remove(wtx.hash);

        case 15:

          hashes.push(wtx.hash);

        case 16:
          i++;
          _context54.next = 7;
          break;

        case 19:
          return _context54.abrupt('return', hashes);

        case 20:
        case 'end':
          return _context54.stop();
      }
    }
  }, zap, this);
}));

/**
 * Abandon transaction.
 * @param {Hash} hash
 * @returns {Promise}
 */

TXDB.prototype.abandon = co( /*#__PURE__*/_regenerator2.default.mark(function abandon(hash) {
  var result;
  return _regenerator2.default.wrap(function abandon$(_context55) {
    while (1) {
      switch (_context55.prev = _context55.next) {
        case 0:
          _context55.next = 2;
          return this.has(layout.p(hash));

        case 2:
          result = _context55.sent;

          if (result) {
            _context55.next = 5;
            break;
          }

          throw new Error('TX not eligible.');

        case 5:
          _context55.next = 7;
          return this.remove(hash);

        case 7:
          return _context55.abrupt('return', _context55.sent);

        case 8:
        case 'end':
          return _context55.stop();
      }
    }
  }, abandon, this);
}));

/**
 * Balance
 * @alias module:wallet.Balance
 * @constructor
 * @param {WalletID} wid
 * @param {String} id
 * @param {Number} account
 */

function Balance(wid, id, account) {
  if (!(this instanceof Balance)) return new Balance(wid, id, account);

  this.wid = wid;
  this.id = id;
  this.account = account;
  this.unconfirmed = 0;
  this.confirmed = 0;
}

/**
 * Test whether a balance is equal.
 * @param {Balance} balance
 * @returns {Boolean}
 */

Balance.prototype.equal = function equal(balance) {
  return this.wid === balance.wid && this.confirmed === balance.confirmed && this.unconfirmed === balance.unconfirmed;
};

/**
 * Convert balance to a more json-friendly object.
 * @param {Boolean?} minimal
 * @returns {Object}
 */

Balance.prototype.toJSON = function toJSON(minimal) {
  return {
    wid: !minimal ? this.wid : undefined,
    id: !minimal ? this.id : undefined,
    account: !minimal ? this.account : undefined,
    unconfirmed: Amount.btc(this.unconfirmed),
    confirmed: Amount.btc(this.confirmed)
  };
};

/**
 * Convert balance to human-readable string.
 * @returns {String}
 */

Balance.prototype.toString = function toString() {
  return '<Balance' + ' unconfirmed=' + Amount.btc(this.unconfirmed) + ' confirmed=' + Amount.btc(this.confirmed) + '>';
};

/**
 * Inspect balance.
 * @param {String}
 */

Balance.prototype.inspect = function inspect() {
  return this.toString();
};

/**
 * Chain State
 * @alias module:wallet.ChainState
 * @constructor
 * @param {WalletID} wid
 * @param {String} id
 */

function TXDBState(wid, id) {
  this.wid = wid;
  this.id = id;
  this.tx = 0;
  this.coin = 0;
  this.unconfirmed = 0;
  this.confirmed = 0;
  this.committed = false;
}

/**
 * Clone the state.
 * @returns {TXDBState}
 */

TXDBState.prototype.clone = function clone() {
  var state = new TXDBState(this.wid, this.id);
  state.tx = this.tx;
  state.coin = this.coin;
  state.unconfirmed = this.unconfirmed;
  state.confirmed = this.confirmed;
  return state;
};

/**
 * Commit and serialize state.
 * @returns {Buffer}
 */

TXDBState.prototype.commit = function commit() {
  this.committed = true;
  return this.toRaw();
};

/**
 * Convert state to a balance object.
 * @returns {Balance}
 */

TXDBState.prototype.toBalance = function toBalance() {
  var balance = new Balance(this.wid, this.id, -1);
  balance.unconfirmed = this.unconfirmed;
  balance.confirmed = this.confirmed;
  return balance;
};

/**
 * Serialize state.
 * @returns {Buffer}
 */

TXDBState.prototype.toRaw = function toRaw() {
  var bw = new StaticWriter(32);

  bw.writeU64(this.tx);
  bw.writeU64(this.coin);
  bw.writeU64(this.unconfirmed);
  bw.writeU64(this.confirmed);

  return bw.render();
};

/**
 * Inject properties from serialized data.
 * @private
 * @param {Buffer} data
 * @returns {TXDBState}
 */

TXDBState.prototype.fromRaw = function fromRaw(data) {
  var br = new BufferReader(data);
  this.tx = br.readU53();
  this.coin = br.readU53();
  this.unconfirmed = br.readU53();
  this.confirmed = br.readU53();
  return this;
};

/**
 * Instantiate txdb state from serialized data.
 * @param {Buffer} data
 * @returns {TXDBState}
 */

TXDBState.fromRaw = function fromRaw(wid, id, data) {
  return new TXDBState(wid, id).fromRaw(data);
};

/**
 * Convert state to a more json-friendly object.
 * @param {Boolean?} minimal
 * @returns {Object}
 */

TXDBState.prototype.toJSON = function toJSON(minimal) {
  return {
    wid: !minimal ? this.wid : undefined,
    id: !minimal ? this.id : undefined,
    tx: this.tx,
    coin: this.coin,
    unconfirmed: Amount.btc(this.unconfirmed),
    confirmed: Amount.btc(this.confirmed)
  };
};

/**
 * Inspect the state.
 * @returns {Object}
 */

TXDBState.prototype.inspect = function inspect() {
  return this.toJSON();
};

/**
 * Credit (wrapped coin)
 * @alias module:wallet.Credit
 * @constructor
 * @param {Coin} coin
 * @param {Boolean?} spent
 * @property {Coin} coin
 * @property {Boolean} spent
 */

function Credit(coin, spent) {
  if (!(this instanceof Credit)) return new Credit(coin, spent);

  this.coin = coin || new Coin();
  this.spent = spent || false;
  this.own = false;
}

/**
 * Inject properties from serialized data.
 * @private
 * @param {Buffer} data
 */

Credit.prototype.fromRaw = function fromRaw(data) {
  var br = new BufferReader(data);
  this.coin.fromReader(br);
  this.spent = br.readU8() === 1;
  this.own = true;

  // Note: soft-fork
  if (br.left() > 0) this.own = br.readU8() === 1;

  return this;
};

/**
 * Instantiate credit from serialized data.
 * @param {Buffer} data
 * @returns {Credit}
 */

Credit.fromRaw = function fromRaw(data) {
  return new Credit().fromRaw(data);
};

/**
 * Get serialization size.
 * @returns {Number}
 */

Credit.prototype.getSize = function getSize() {
  return this.coin.getSize() + 2;
};

/**
 * Serialize credit.
 * @returns {Buffer}
 */

Credit.prototype.toRaw = function toRaw() {
  var size = this.getSize();
  var bw = new StaticWriter(size);
  this.coin.toWriter(bw);
  bw.writeU8(this.spent ? 1 : 0);
  bw.writeU8(this.own ? 1 : 0);
  return bw.render();
};

/**
 * Inject properties from tx object.
 * @private
 * @param {TX} tx
 * @param {Number} index
 * @returns {Credit}
 */

Credit.prototype.fromTX = function fromTX(tx, index, height) {
  this.coin.fromTX(tx, index, height);
  this.spent = false;
  this.own = false;
  return this;
};

/**
 * Instantiate credit from transaction.
 * @param {TX} tx
 * @param {Number} index
 * @returns {Credit}
 */

Credit.fromTX = function fromTX(tx, index, height) {
  return new Credit().fromTX(tx, index, height);
};

/**
 * Transaction Details
 * @alias module:wallet.Details
 * @constructor
 * @param {TXDB} txdb
 * @param {TX} tx
 */

function Details(txdb, wtx, block) {
  if (!(this instanceof Details)) return new Details(txdb, wtx, block);

  this.wallet = txdb.wallet;
  this.network = this.wallet.network;
  this.wid = this.wallet.wid;
  this.id = this.wallet.id;

  this.chainHeight = txdb.walletdb.state.height;

  this.hash = wtx.hash;
  this.tx = wtx.tx;
  this.ps = wtx.ps;
  this.size = this.tx.getSize();
  this.vsize = this.tx.getVirtualSize();

  this.block = null;
  this.height = -1;
  this.ts = 0;
  this.index = -1;

  if (block) {
    this.block = block.hash;
    this.height = block.height;
    this.ts = block.ts;
  }

  this.inputs = [];
  this.outputs = [];
  this.accounts = [];

  this.init();
}

/**
 * Initialize transaction details.
 * @private
 */

Details.prototype.init = function init() {
  var i, input, output, member;

  for (i = 0; i < this.tx.inputs.length; i++) {
    input = this.tx.inputs[i];
    member = new DetailsMember();
    member.address = input.getAddress();
    this.inputs.push(member);
  }

  for (i = 0; i < this.tx.outputs.length; i++) {
    output = this.tx.outputs[i];
    member = new DetailsMember();
    member.value = output.value;
    member.address = output.getAddress();
    this.outputs.push(member);
  }
};

/**
 * Add necessary info to input member.
 * @param {Number} i
 * @param {Path} path
 * @param {Coin} coin
 */

Details.prototype.setInput = function setInput(i, path, coin) {
  var member = this.inputs[i];

  if (coin) {
    member.value = coin.value;
    member.address = coin.getAddress();
  }

  if (path) {
    member.path = path;
    util.binaryInsert(this.accounts, path.account, cmp, true);
  }
};

/**
 * Add necessary info to output member.
 * @param {Number} i
 * @param {Path} path
 */

Details.prototype.setOutput = function setOutput(i, path) {
  var member = this.outputs[i];

  if (path) {
    member.path = path;
    util.binaryInsert(this.accounts, path.account, cmp, true);
  }
};

/**
 * Calculate confirmations.
 * @returns {Number}
 */

Details.prototype.getDepth = function getDepth() {
  var depth;

  if (this.height === -1) return 0;

  depth = this.chainHeight - this.height;

  if (depth < 0) return 0;

  return depth + 1;
};

/**
 * Calculate fee. Only works if wallet
 * owns all inputs. Returns 0 otherwise.
 * @returns {Amount}
 */

Details.prototype.getFee = function getFee() {
  var inputValue = 0;
  var outputValue = 0;
  var i, input, output;

  for (i = 0; i < this.inputs.length; i++) {
    input = this.inputs[i];

    if (!input.path) return 0;

    inputValue += input.value;
  }

  for (i = 0; i < this.outputs.length; i++) {
    output = this.outputs[i];
    outputValue += output.value;
  }

  return inputValue - outputValue;
};

/**
 * Calculate fee rate. Only works if wallet
 * owns all inputs. Returns 0 otherwise.
 * @param {Amount} fee
 * @returns {Rate}
 */

Details.prototype.getRate = function getRate(fee) {
  return policy.getRate(this.vsize, fee);
};

/**
 * Convert details to a more json-friendly object.
 * @returns {Object}
 */

Details.prototype.toJSON = function toJSON() {
  var self = this;
  var fee = this.getFee();
  var rate = this.getRate(fee);

  // Rate can exceed 53 bits in testing.
  if (!util.isSafeInteger(rate)) rate = 0;

  return {
    wid: this.wid,
    id: this.id,
    hash: util.revHex(this.hash),
    height: this.height,
    block: this.block ? util.revHex(this.block) : null,
    ts: this.ts,
    ps: this.ps,
    date: util.date(this.ts || this.ps),
    index: this.index,
    size: this.size,
    virtualSize: this.vsize,
    fee: Amount.btc(fee),
    rate: Amount.btc(rate),
    confirmations: this.getDepth(),
    inputs: this.inputs.map(function (input) {
      return input.getJSON(self.network);
    }),
    outputs: this.outputs.map(function (output) {
      return output.getJSON(self.network);
    }),
    tx: this.tx.toRaw().toString('hex')
  };
};

/**
 * Transaction Details Member
 * @alias module:wallet.DetailsMember
 * @constructor
 * @property {Number} value
 * @property {Address} address
 * @property {Path} path
 */

function DetailsMember() {
  if (!(this instanceof DetailsMember)) return new DetailsMember();

  this.value = 0;
  this.address = null;
  this.path = null;
}

/**
 * Convert the member to a more json-friendly object.
 * @returns {Object}
 */

DetailsMember.prototype.toJSON = function toJSON() {
  return this.getJSON();
};

/**
 * Convert the member to a more json-friendly object.
 * @param {Network} network
 * @returns {Object}
 */

DetailsMember.prototype.getJSON = function getJSON(network) {
  return {
    value: Amount.btc(this.value),
    address: this.address ? this.address.toString(network) : null,
    path: this.path ? this.path.toJSON() : null
  };
};

/**
 * Block Record
 * @alias module:wallet.BlockRecord
 * @constructor
 * @param {Hash} hash
 * @param {Number} height
 * @param {Number} ts
 */

function BlockRecord(hash, height, ts) {
  if (!(this instanceof BlockRecord)) return new BlockRecord(hash, height, ts);

  this.hash = hash || encoding.NULL_HASH;
  this.height = height != null ? height : -1;
  this.ts = ts || 0;
  this.hashes = [];
  this.index = {};
}

/**
 * Add transaction to block record.
 * @param {Hash} hash
 * @returns {Boolean}
 */

BlockRecord.prototype.add = function add(hash) {
  if (this.index[hash]) return false;

  this.index[hash] = true;
  this.hashes.push(hash);

  return true;
};

/**
 * Remove transaction from block record.
 * @param {Hash} hash
 * @returns {Boolean}
 */

BlockRecord.prototype.remove = function remove(hash) {
  var index;

  if (!this.index[hash]) return false;

  delete this.index[hash];

  // Fast case
  if (this.hashes[this.hashes.length - 1] === hash) {
    this.hashes.pop();
    return true;
  }

  index = this.hashes.indexOf(hash);

  assert(index !== -1);

  this.hashes.splice(index, 1);

  return true;
};

/**
 * Instantiate wallet block from serialized tip data.
 * @private
 * @param {Buffer} data
 */

BlockRecord.prototype.fromRaw = function fromRaw(data) {
  var br = new BufferReader(data);
  var i, hash, count;

  this.hash = br.readHash('hex');
  this.height = br.readU32();
  this.ts = br.readU32();

  count = br.readU32();

  for (i = 0; i < count; i++) {
    hash = br.readHash('hex');
    this.index[hash] = true;
    this.hashes.push(hash);
  }

  return this;
};

/**
 * Instantiate wallet block from serialized data.
 * @param {Buffer} data
 * @returns {BlockRecord}
 */

BlockRecord.fromRaw = function fromRaw(data) {
  return new BlockRecord().fromRaw(data);
};

/**
 * Get serialization size.
 * @returns {Number}
 */

BlockRecord.prototype.getSize = function getSize() {
  return 44 + this.hashes.length * 32;
};

/**
 * Serialize the wallet block as a tip (hash and height).
 * @returns {Buffer}
 */

BlockRecord.prototype.toRaw = function toRaw() {
  var size = this.getSize();
  var bw = new StaticWriter(size);
  var i;

  bw.writeHash(this.hash);
  bw.writeU32(this.height);
  bw.writeU32(this.ts);

  bw.writeU32(this.hashes.length);

  for (i = 0; i < this.hashes.length; i++) {
    bw.writeHash(this.hashes[i]);
  }return bw.render();
};

/**
 * Convert the block to a more json-friendly object.
 * @returns {Object}
 */

BlockRecord.prototype.toJSON = function toJSON() {
  return {
    hash: util.revHex(this.hash),
    height: this.height,
    ts: this.ts,
    hashes: this.hashes.map(util.revHex)
  };
};

/**
 * Instantiate wallet block from block meta.
 * @private
 * @param {BlockMeta} block
 */

BlockRecord.prototype.fromMeta = function fromMeta(block) {
  this.hash = block.hash;
  this.height = block.height;
  this.ts = block.ts;
  return this;
};

/**
 * Instantiate wallet block from block meta.
 * @param {BlockMeta} block
 * @returns {BlockRecord}
 */

BlockRecord.fromMeta = function fromMeta(block) {
  return new BlockRecord().fromMeta(block);
};

/*
 * Helpers
 */

function cmp(a, b) {
  return a - b;
}

/*
 * Expose
 */

module.exports = TXDB;