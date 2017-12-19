/*!
 * walletdb.js - storage for wallets
 * Copyright (c) 2014-2015, Fedor Indutny (MIT License)
 * Copyright (c) 2014-2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

var _typeof2 = require('babel-runtime/helpers/typeof');

var _typeof3 = _interopRequireDefault(_typeof2);

var _promise = require('babel-runtime/core-js/promise');

var _promise2 = _interopRequireDefault(_promise);

var _keys = require('babel-runtime/core-js/object/keys');

var _keys2 = _interopRequireDefault(_keys);

var _regenerator = require('babel-runtime/regenerator');

var _regenerator2 = _interopRequireDefault(_regenerator);

var _create = require('babel-runtime/core-js/object/create');

var _create2 = _interopRequireDefault(_create);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var assert = require('assert');
var AsyncObject = require('../utils/asyncobject');
var util = require('../utils/util');
var co = require('../utils/co');
var Lock = require('../utils/lock');
var LRU = require('../utils/lru');
var encoding = require('../utils/encoding');
var crypto = require('../crypto/crypto');
var Network = require('../protocol/network');
var Path = require('./path');
var common = require('./common');
var Wallet = require('./wallet');
var Account = require('./account');
var LDB = require('../db/ldb');
var Bloom = require('../utils/bloom');
var Logger = require('../node/logger');
var Outpoint = require('../primitives/outpoint');
var layouts = require('./layout');
var records = require('./records');
var HTTPServer = require('./http');
var RPC = require('./rpc');
var layout = layouts.walletdb;
var ChainState = records.ChainState;
var BlockMapRecord = records.BlockMapRecord;
var BlockMeta = records.BlockMeta;
var PathMapRecord = records.PathMapRecord;
var OutpointMapRecord = records.OutpointMapRecord;
var TXRecord = records.TXRecord;
var U32 = encoding.U32;
var DUMMY = Buffer.from([0]);

/**
 * WalletDB
 * @alias module:wallet.WalletDB
 * @constructor
 * @param {Object} options
 * @param {String?} options.name - Database name.
 * @param {String?} options.location - Database file location.
 * @param {String?} options.db - Database backend (`"leveldb"` by default).
 * @param {Boolean?} options.verify - Verify transactions as they
 * come in (note that this will not happen on the worker pool).
 * @property {Boolean} loaded
 */

function WalletDB(options) {
  if (!(this instanceof WalletDB)) return new WalletDB(options);

  AsyncObject.call(this);

  this.options = new WalletOptions(options);

  this.network = this.options.network;
  this.logger = this.options.logger.context('wallet');
  this.client = this.options.client;
  this.db = LDB(this.options);
  this.rpc = new RPC(this);
  this.primary = null;
  this.http = null;

  if (!HTTPServer.unsupported) {
    this.http = new HTTPServer({
      walletdb: this,
      network: this.network,
      logger: this.logger,
      prefix: this.options.prefix,
      apiKey: this.options.apiKey,
      walletAuth: this.options.walletAuth,
      noAuth: this.options.noAuth,
      host: this.options.host,
      port: this.options.port,
      ssl: this.options.ssl
    });
  }

  this.state = new ChainState();
  this.wallets = (0, _create2.default)(null);
  this.depth = 0;
  this.rescanning = false;
  this.bound = false;

  this.readLock = new Lock.Mapped();
  this.writeLock = new Lock();
  this.txLock = new Lock();

  this.widCache = new LRU(10000);
  this.pathMapCache = new LRU(100000);

  this.filter = new Bloom();

  this._init();
}

util.inherits(WalletDB, AsyncObject);

/**
 * Database layout.
 * @type {Object}
 */

WalletDB.layout = layout;

/**
 * Initialize walletdb.
 * @private
 */

WalletDB.prototype._init = function _init() {
  var items = 1000000;
  var flag = -1;

  // Highest number of items with an
  // FPR of 0.001. We have to do this
  // by hand because Bloom.fromRate's
  // policy limit enforcing is fairly
  // naive.
  if (this.options.spv) {
    items = 20000;
    flag = Bloom.flags.ALL;
  }

  this.filter = Bloom.fromRate(items, 0.001, flag);
};

/**
 * Open the walletdb, wait for the database to load.
 * @alias WalletDB#open
 * @returns {Promise}
 */

WalletDB.prototype._open = co( /*#__PURE__*/_regenerator2.default.mark(function open() {
  var wallet;
  return _regenerator2.default.wrap(function open$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:
          if (!this.options.listen) {
            _context.next = 3;
            break;
          }

          _context.next = 3;
          return this.logger.open();

        case 3:
          _context.next = 5;
          return this.db.open();

        case 5:
          _context.next = 7;
          return this.db.checkVersion('V', 6);

        case 7:
          _context.next = 9;
          return this.getDepth();

        case 9:
          this.depth = _context.sent;

          if (!this.options.wipeNoReally) {
            _context.next = 13;
            break;
          }

          _context.next = 13;
          return this.wipe();

        case 13:
          _context.next = 15;
          return this.load();

        case 15:

          this.logger.info('WalletDB loaded (depth=%d, height=%d, start=%d).', this.depth, this.state.height, this.state.startHeight);

          _context.next = 18;
          return this.ensure({
            id: 'primary'
          });

        case 18:
          wallet = _context.sent;


          this.logger.info('Loaded primary wallet (id=%s, wid=%d, address=%s)', wallet.id, wallet.wid, wallet.getAddress());

          this.primary = wallet;
          this.rpc.wallet = wallet;

          if (!(this.http && this.options.listen)) {
            _context.next = 25;
            break;
          }

          _context.next = 25;
          return this.http.open();

        case 25:
        case 'end':
          return _context.stop();
      }
    }
  }, open, this);
}));

/**
 * Close the walletdb, wait for the database to close.
 * @alias WalletDB#close
 * @returns {Promise}
 */

WalletDB.prototype._close = co( /*#__PURE__*/_regenerator2.default.mark(function close() {
  var keys, i, key, wallet;
  return _regenerator2.default.wrap(function close$(_context2) {
    while (1) {
      switch (_context2.prev = _context2.next) {
        case 0:
          keys = (0, _keys2.default)(this.wallets);
          _context2.next = 3;
          return this.disconnect();

        case 3:
          if (!(this.http && this.options.listen)) {
            _context2.next = 6;
            break;
          }

          _context2.next = 6;
          return this.http.close();

        case 6:
          i = 0;

        case 7:
          if (!(i < keys.length)) {
            _context2.next = 15;
            break;
          }

          key = keys[i];
          wallet = this.wallets[key];
          _context2.next = 12;
          return wallet.destroy();

        case 12:
          i++;
          _context2.next = 7;
          break;

        case 15:
          _context2.next = 17;
          return this.db.close();

        case 17:
          if (!this.options.listen) {
            _context2.next = 20;
            break;
          }

          _context2.next = 20;
          return this.logger.close();

        case 20:
        case 'end':
          return _context2.stop();
      }
    }
  }, close, this);
}));

/**
 * Load the walletdb.
 * @returns {Promise}
 */

WalletDB.prototype.load = co( /*#__PURE__*/_regenerator2.default.mark(function load() {
  var unlock;
  return _regenerator2.default.wrap(function load$(_context3) {
    while (1) {
      switch (_context3.prev = _context3.next) {
        case 0:
          _context3.next = 2;
          return this.txLock.lock();

        case 2:
          unlock = _context3.sent;
          _context3.prev = 3;
          _context3.next = 6;
          return this.connect();

        case 6:
          _context3.next = 8;
          return this.init();

        case 8:
          _context3.next = 10;
          return this.watch();

        case 10:
          _context3.next = 12;
          return this.sync();

        case 12:
          _context3.next = 14;
          return this.resend();

        case 14:
          _context3.prev = 14;

          unlock();
          return _context3.finish(14);

        case 17:
        case 'end':
          return _context3.stop();
      }
    }
  }, load, this, [[3,, 14, 17]]);
}));

/**
 * Bind to node events.
 * @private
 */

WalletDB.prototype.bind = function bind() {
  var self = this;

  if (!this.client) return;

  if (this.bound) return;

  this.bound = true;

  this.client.on('error', function (err) {
    self.emit('error', err);
  });

  this.client.on('block connect', co( /*#__PURE__*/_regenerator2.default.mark(function _callee(entry, txs) {
    return _regenerator2.default.wrap(function _callee$(_context4) {
      while (1) {
        switch (_context4.prev = _context4.next) {
          case 0:
            _context4.prev = 0;
            _context4.next = 3;
            return self.addBlock(entry, txs);

          case 3:
            _context4.next = 8;
            break;

          case 5:
            _context4.prev = 5;
            _context4.t0 = _context4['catch'](0);

            self.emit('error', _context4.t0);

          case 8:
          case 'end':
            return _context4.stop();
        }
      }
    }, _callee, this, [[0, 5]]);
  })));

  this.client.on('block disconnect', co( /*#__PURE__*/_regenerator2.default.mark(function _callee2(entry) {
    return _regenerator2.default.wrap(function _callee2$(_context5) {
      while (1) {
        switch (_context5.prev = _context5.next) {
          case 0:
            _context5.prev = 0;
            _context5.next = 3;
            return self.removeBlock(entry);

          case 3:
            _context5.next = 8;
            break;

          case 5:
            _context5.prev = 5;
            _context5.t0 = _context5['catch'](0);

            self.emit('error', _context5.t0);

          case 8:
          case 'end':
            return _context5.stop();
        }
      }
    }, _callee2, this, [[0, 5]]);
  })));

  this.client.hook('block rescan', co( /*#__PURE__*/_regenerator2.default.mark(function _callee3(entry, txs) {
    return _regenerator2.default.wrap(function _callee3$(_context6) {
      while (1) {
        switch (_context6.prev = _context6.next) {
          case 0:
            _context6.prev = 0;
            _context6.next = 3;
            return self.rescanBlock(entry, txs);

          case 3:
            _context6.next = 8;
            break;

          case 5:
            _context6.prev = 5;
            _context6.t0 = _context6['catch'](0);

            self.emit('error', _context6.t0);

          case 8:
          case 'end':
            return _context6.stop();
        }
      }
    }, _callee3, this, [[0, 5]]);
  })));

  this.client.on('tx', co( /*#__PURE__*/_regenerator2.default.mark(function _callee4(tx) {
    return _regenerator2.default.wrap(function _callee4$(_context7) {
      while (1) {
        switch (_context7.prev = _context7.next) {
          case 0:
            _context7.prev = 0;
            _context7.next = 3;
            return self.addTX(tx);

          case 3:
            _context7.next = 8;
            break;

          case 5:
            _context7.prev = 5;
            _context7.t0 = _context7['catch'](0);

            self.emit('error', _context7.t0);

          case 8:
          case 'end':
            return _context7.stop();
        }
      }
    }, _callee4, this, [[0, 5]]);
  })));

  this.client.on('chain reset', co( /*#__PURE__*/_regenerator2.default.mark(function _callee5(tip) {
    return _regenerator2.default.wrap(function _callee5$(_context8) {
      while (1) {
        switch (_context8.prev = _context8.next) {
          case 0:
            _context8.prev = 0;
            _context8.next = 3;
            return self.resetChain(tip);

          case 3:
            _context8.next = 8;
            break;

          case 5:
            _context8.prev = 5;
            _context8.t0 = _context8['catch'](0);

            self.emit('error', _context8.t0);

          case 8:
          case 'end':
            return _context8.stop();
        }
      }
    }, _callee5, this, [[0, 5]]);
  })));
};

/**
 * Connect to the node server (client required).
 * @returns {Promise}
 */

WalletDB.prototype.connect = co( /*#__PURE__*/_regenerator2.default.mark(function connect() {
  return _regenerator2.default.wrap(function connect$(_context9) {
    while (1) {
      switch (_context9.prev = _context9.next) {
        case 0:
          if (this.client) {
            _context9.next = 2;
            break;
          }

          return _context9.abrupt('return');

        case 2:

          this.bind();

          _context9.next = 5;
          return this.client.open();

        case 5:
          _context9.next = 7;
          return this.setFilter();

        case 7:
        case 'end':
          return _context9.stop();
      }
    }
  }, connect, this);
}));

/**
 * Disconnect from node server (client required).
 * @returns {Promise}
 */

WalletDB.prototype.disconnect = co( /*#__PURE__*/_regenerator2.default.mark(function disconnect() {
  return _regenerator2.default.wrap(function disconnect$(_context10) {
    while (1) {
      switch (_context10.prev = _context10.next) {
        case 0:
          if (this.client) {
            _context10.next = 2;
            break;
          }

          return _context10.abrupt('return');

        case 2:
          _context10.next = 4;
          return this.client.close();

        case 4:
        case 'end':
          return _context10.stop();
      }
    }
  }, disconnect, this);
}));

/**
 * Initialize and write initial sync state.
 * @returns {Promise}
 */

WalletDB.prototype.init = co( /*#__PURE__*/_regenerator2.default.mark(function init() {
  var state, startHeight, tip;
  return _regenerator2.default.wrap(function init$(_context11) {
    while (1) {
      switch (_context11.prev = _context11.next) {
        case 0:
          _context11.next = 2;
          return this.getState();

        case 2:
          state = _context11.sent;
          startHeight = this.options.startHeight;

          if (!state) {
            _context11.next = 7;
            break;
          }

          this.state = state;
          return _context11.abrupt('return');

        case 7:
          if (!this.client) {
            _context11.next = 22;
            break;
          }

          if (!(startHeight != null)) {
            _context11.next = 16;
            break;
          }

          _context11.next = 11;
          return this.client.getEntry(startHeight);

        case 11:
          tip = _context11.sent;

          if (tip) {
            _context11.next = 14;
            break;
          }

          throw new Error('WDB: Could not find start block.');

        case 14:
          _context11.next = 19;
          break;

        case 16:
          _context11.next = 18;
          return this.client.getTip();

        case 18:
          tip = _context11.sent;

        case 19:
          tip = BlockMeta.fromEntry(tip);
          _context11.next = 23;
          break;

        case 22:
          tip = BlockMeta.fromEntry(this.network.genesis);

        case 23:

          this.logger.info('Initializing WalletDB chain state at %s (%d).', util.revHex(tip.hash), tip.height);

          _context11.next = 26;
          return this.resetState(tip, false);

        case 26:
        case 'end':
          return _context11.stop();
      }
    }
  }, init, this);
}));

/**
 * Watch addresses and outpoints.
 * @private
 * @returns {Promise}
 */

WalletDB.prototype.watch = co( /*#__PURE__*/_regenerator2.default.mark(function watch() {
  var hashes, outpoints, iter, item, data, outpoint, items;
  return _regenerator2.default.wrap(function watch$(_context12) {
    while (1) {
      switch (_context12.prev = _context12.next) {
        case 0:
          hashes = 0;
          outpoints = 0;


          iter = this.db.iterator({
            gte: layout.p(encoding.NULL_HASH),
            lte: layout.p(encoding.HIGH_HASH)
          });

        case 3:
          _context12.next = 5;
          return iter.next();

        case 5:
          item = _context12.sent;

          if (item) {
            _context12.next = 8;
            break;
          }

          return _context12.abrupt('break', 21);

        case 8:
          _context12.prev = 8;

          data = layout.pp(item.key);
          this.filter.add(data, 'hex');
          _context12.next = 18;
          break;

        case 13:
          _context12.prev = 13;
          _context12.t0 = _context12['catch'](8);
          _context12.next = 17;
          return iter.end();

        case 17:
          throw _context12.t0;

        case 18:

          hashes++;

        case 19:
          _context12.next = 3;
          break;

        case 21:

          iter = this.db.iterator({
            gte: layout.o(encoding.NULL_HASH, 0),
            lte: layout.o(encoding.HIGH_HASH, 0xffffffff)
          });

        case 22:
          _context12.next = 24;
          return iter.next();

        case 24:
          item = _context12.sent;

          if (item) {
            _context12.next = 27;
            break;
          }

          return _context12.abrupt('break', 42);

        case 27:
          _context12.prev = 27;

          items = layout.oo(item.key);
          outpoint = new Outpoint(items[0], items[1]);
          data = outpoint.toRaw();
          this.filter.add(data);
          _context12.next = 39;
          break;

        case 34:
          _context12.prev = 34;
          _context12.t1 = _context12['catch'](27);
          _context12.next = 38;
          return iter.end();

        case 38:
          throw _context12.t1;

        case 39:

          outpoints++;

        case 40:
          _context12.next = 22;
          break;

        case 42:

          this.logger.info('Added %d hashes to WalletDB filter.', hashes);
          this.logger.info('Added %d outpoints to WalletDB filter.', outpoints);

          _context12.next = 46;
          return this.setFilter();

        case 46:
        case 'end':
          return _context12.stop();
      }
    }
  }, watch, this, [[8, 13], [27, 34]]);
}));

/**
 * Connect and sync with the chain server.
 * @private
 * @returns {Promise}
 */

WalletDB.prototype.sync = co( /*#__PURE__*/_regenerator2.default.mark(function sync() {
  var height, tip, entry;
  return _regenerator2.default.wrap(function sync$(_context13) {
    while (1) {
      switch (_context13.prev = _context13.next) {
        case 0:
          height = this.state.height;

          if (this.client) {
            _context13.next = 3;
            break;
          }

          return _context13.abrupt('return');

        case 3:
          if (!(height >= 0)) {
            _context13.next = 17;
            break;
          }

          _context13.next = 6;
          return this.getBlock(height);

        case 6:
          tip = _context13.sent;

          if (tip) {
            _context13.next = 9;
            break;
          }

          return _context13.abrupt('break', 17);

        case 9:
          _context13.next = 11;
          return this.client.getEntry(tip.hash);

        case 11:
          entry = _context13.sent;

          if (!entry) {
            _context13.next = 14;
            break;
          }

          return _context13.abrupt('break', 17);

        case 14:

          height--;
          _context13.next = 3;
          break;

        case 17:
          if (entry) {
            _context13.next = 23;
            break;
          }

          height = this.state.startHeight;
          _context13.next = 21;
          return this.client.getEntry(this.state.startHash);

        case 21:
          entry = _context13.sent;


          if (!entry) height = 0;

        case 23:
          _context13.next = 25;
          return this.scan(height);

        case 25:
        case 'end':
          return _context13.stop();
      }
    }
  }, sync, this);
}));

/**
 * Rescan blockchain from a given height.
 * @private
 * @param {Number?} height
 * @returns {Promise}
 */

WalletDB.prototype.scan = co( /*#__PURE__*/_regenerator2.default.mark(function scan(height) {
  var tip;
  return _regenerator2.default.wrap(function scan$(_context14) {
    while (1) {
      switch (_context14.prev = _context14.next) {
        case 0:
          if (this.client) {
            _context14.next = 2;
            break;
          }

          return _context14.abrupt('return');

        case 2:

          if (height == null) height = this.state.startHeight;

          assert(util.isUInt32(height), 'WDB: Must pass in a height.');

          _context14.next = 6;
          return this.rollback(height);

        case 6:

          this.logger.info('WalletDB is scanning %d blocks.', this.state.height - height + 1);

          _context14.next = 9;
          return this.getTip();

        case 9:
          tip = _context14.sent;
          _context14.prev = 10;

          this.rescanning = true;
          _context14.next = 14;
          return this.client.rescan(tip.hash);

        case 14:
          _context14.prev = 14;

          this.rescanning = false;
          return _context14.finish(14);

        case 17:
        case 'end':
          return _context14.stop();
      }
    }
  }, scan, this, [[10,, 14, 17]]);
}));

/**
 * Force a rescan.
 * @param {Number} height
 * @returns {Promise}
 */

WalletDB.prototype.rescan = co( /*#__PURE__*/_regenerator2.default.mark(function rescan(height) {
  var unlock;
  return _regenerator2.default.wrap(function rescan$(_context15) {
    while (1) {
      switch (_context15.prev = _context15.next) {
        case 0:
          _context15.next = 2;
          return this.txLock.lock();

        case 2:
          unlock = _context15.sent;
          _context15.prev = 3;
          _context15.next = 6;
          return this._rescan(height);

        case 6:
          return _context15.abrupt('return', _context15.sent);

        case 7:
          _context15.prev = 7;

          unlock();
          return _context15.finish(7);

        case 10:
        case 'end':
          return _context15.stop();
      }
    }
  }, rescan, this, [[3,, 7, 10]]);
}));

/**
 * Force a rescan (without a lock).
 * @private
 * @param {Number} height
 * @returns {Promise}
 */

WalletDB.prototype._rescan = co( /*#__PURE__*/_regenerator2.default.mark(function rescan(height) {
  return _regenerator2.default.wrap(function rescan$(_context16) {
    while (1) {
      switch (_context16.prev = _context16.next) {
        case 0:
          _context16.next = 2;
          return this.scan(height);

        case 2:
          return _context16.abrupt('return', _context16.sent);

        case 3:
        case 'end':
          return _context16.stop();
      }
    }
  }, rescan, this);
}));

/**
 * Broadcast a transaction via chain server.
 * @param {TX} tx
 * @returns {Promise}
 */

WalletDB.prototype.send = co( /*#__PURE__*/_regenerator2.default.mark(function send(tx) {
  return _regenerator2.default.wrap(function send$(_context17) {
    while (1) {
      switch (_context17.prev = _context17.next) {
        case 0:
          if (this.client) {
            _context17.next = 3;
            break;
          }

          this.emit('send', tx);
          return _context17.abrupt('return');

        case 3:
          _context17.next = 5;
          return this.client.send(tx);

        case 5:
        case 'end':
          return _context17.stop();
      }
    }
  }, send, this);
}));

/**
 * Estimate smart fee from chain server.
 * @param {Number} blocks
 * @returns {Promise}
 */

WalletDB.prototype.estimateFee = co( /*#__PURE__*/_regenerator2.default.mark(function estimateFee(blocks) {
  var rate;
  return _regenerator2.default.wrap(function estimateFee$(_context18) {
    while (1) {
      switch (_context18.prev = _context18.next) {
        case 0:
          if (this.client) {
            _context18.next = 2;
            break;
          }

          return _context18.abrupt('return', this.network.feeRate);

        case 2:
          _context18.next = 4;
          return this.client.estimateFee(blocks);

        case 4:
          rate = _context18.sent;

          if (!(rate < this.network.feeRate)) {
            _context18.next = 7;
            break;
          }

          return _context18.abrupt('return', this.network.feeRate);

        case 7:
          if (!(rate > this.network.maxFeeRate)) {
            _context18.next = 9;
            break;
          }

          return _context18.abrupt('return', this.network.maxFeeRate);

        case 9:
          return _context18.abrupt('return', rate);

        case 10:
        case 'end':
          return _context18.stop();
      }
    }
  }, estimateFee, this);
}));

/**
 * Send filter to the remote node.
 * @private
 * @returns {Promise}
 */

WalletDB.prototype.setFilter = function setFilter() {
  if (!this.client) {
    this.emit('set filter', this.filter);
    return _promise2.default.resolve();
  }

  return this.client.setFilter(this.filter);
};

/**
 * Add data to remote filter.
 * @private
 * @param {Buffer} data
 * @returns {Promise}
 */

WalletDB.prototype.addFilter = function addFilter(data) {
  if (!this.client) {
    this.emit('add filter', data);
    return _promise2.default.resolve();
  }

  return this.client.addFilter(data);
};

/**
 * Reset remote filter.
 * @private
 * @returns {Promise}
 */

WalletDB.prototype.resetFilter = function resetFilter() {
  if (!this.client) {
    this.emit('reset filter');
    return _promise2.default.resolve();
  }

  return this.client.resetFilter();
};

/**
 * Backup the wallet db.
 * @param {String} path
 * @returns {Promise}
 */

WalletDB.prototype.backup = function backup(path) {
  return this.db.backup(path);
};

/**
 * Wipe the txdb - NEVER USE.
 * @returns {Promise}
 */

WalletDB.prototype.wipe = co( /*#__PURE__*/_regenerator2.default.mark(function wipe() {
  var batch, total, iter, item;
  return _regenerator2.default.wrap(function wipe$(_context19) {
    while (1) {
      switch (_context19.prev = _context19.next) {
        case 0:
          batch = this.db.batch();
          total = 0;


          this.logger.warning('Wiping WalletDB TXDB...');
          this.logger.warning('I hope you know what you\'re doing.');

          iter = this.db.iterator({
            gte: Buffer.from([0x00]),
            lte: Buffer.from([0xff])
          });

        case 5:
          _context19.next = 7;
          return iter.next();

        case 7:
          item = _context19.sent;

          if (item) {
            _context19.next = 10;
            break;
          }

          return _context19.abrupt('break', 26);

        case 10:
          _context19.prev = 10;
          _context19.t0 = item.key[0];
          _context19.next = _context19.t0 === 0x62 ? 14 : _context19.t0 === 0x63 ? 14 : _context19.t0 === 0x65 ? 14 : _context19.t0 === 0x74 ? 14 : _context19.t0 === 0x6f ? 14 : _context19.t0 === 0x68 ? 14 : _context19.t0 === 0x52 ? 14 : 17;
          break;

        case 14:
          // R
          batch.del(item.key);
          total++;
          return _context19.abrupt('break', 17);

        case 17:
          _context19.next = 24;
          break;

        case 19:
          _context19.prev = 19;
          _context19.t1 = _context19['catch'](10);
          _context19.next = 23;
          return iter.end();

        case 23:
          throw _context19.t1;

        case 24:
          _context19.next = 5;
          break;

        case 26:

          this.logger.warning('Wiped %d txdb records.', total);

          _context19.next = 29;
          return batch.write();

        case 29:
        case 'end':
          return _context19.stop();
      }
    }
  }, wipe, this, [[10, 19]]);
}));

/**
 * Get current wallet wid depth.
 * @private
 * @returns {Promise}
 */

WalletDB.prototype.getDepth = co( /*#__PURE__*/_regenerator2.default.mark(function getDepth() {
  var iter, item, depth;
  return _regenerator2.default.wrap(function getDepth$(_context20) {
    while (1) {
      switch (_context20.prev = _context20.next) {
        case 0:

          // This may seem like a strange way to do
          // this, but updating a global state when
          // creating a new wallet is actually pretty
          // damn tricky. There would be major atomicity
          // issues if updating a global state inside
          // a "scoped" state. So, we avoid all the
          // nonsense of adding a global lock to
          // walletdb.create by simply seeking to the
          // highest wallet wid.
          iter = this.db.iterator({
            gte: layout.w(0x00000000),
            lte: layout.w(0xffffffff),
            reverse: true,
            limit: 1
          });

          _context20.next = 3;
          return iter.next();

        case 3:
          item = _context20.sent;

          if (item) {
            _context20.next = 6;
            break;
          }

          return _context20.abrupt('return', 1);

        case 6:
          _context20.next = 8;
          return iter.end();

        case 8:

          depth = layout.ww(item.key);

          return _context20.abrupt('return', depth + 1);

        case 10:
        case 'end':
          return _context20.stop();
      }
    }
  }, getDepth, this);
}));

/**
 * Start batch.
 * @private
 * @param {WalletID} wid
 */

WalletDB.prototype.start = function start(wallet) {
  assert(!wallet.current, 'WDB: Batch already started.');
  wallet.current = this.db.batch();
  wallet.accountCache.start();
  wallet.pathCache.start();
  return wallet.current;
};

/**
 * Drop batch.
 * @private
 * @param {WalletID} wid
 */

WalletDB.prototype.drop = function drop(wallet) {
  var batch = this.batch(wallet);
  wallet.current = null;
  wallet.accountCache.drop();
  wallet.pathCache.drop();
  batch.clear();
};

/**
 * Clear batch.
 * @private
 * @param {WalletID} wid
 */

WalletDB.prototype.clear = function clear(wallet) {
  var batch = this.batch(wallet);
  wallet.accountCache.clear();
  wallet.pathCache.clear();
  batch.clear();
};

/**
 * Get batch.
 * @private
 * @param {WalletID} wid
 * @returns {Leveldown.Batch}
 */

WalletDB.prototype.batch = function batch(wallet) {
  assert(wallet.current, 'WDB: Batch does not exist.');
  return wallet.current;
};

/**
 * Save batch.
 * @private
 * @param {WalletID} wid
 * @returns {Promise}
 */

WalletDB.prototype.commit = co( /*#__PURE__*/_regenerator2.default.mark(function commit(wallet) {
  var batch;
  return _regenerator2.default.wrap(function commit$(_context21) {
    while (1) {
      switch (_context21.prev = _context21.next) {
        case 0:
          batch = this.batch(wallet);
          _context21.prev = 1;
          _context21.next = 4;
          return batch.write();

        case 4:
          _context21.next = 12;
          break;

        case 6:
          _context21.prev = 6;
          _context21.t0 = _context21['catch'](1);

          wallet.current = null;
          wallet.accountCache.drop();
          wallet.pathCache.drop();
          throw _context21.t0;

        case 12:

          wallet.current = null;
          wallet.accountCache.commit();
          wallet.pathCache.commit();

        case 15:
        case 'end':
          return _context21.stop();
      }
    }
  }, commit, this, [[1, 6]]);
}));

/**
 * Test the bloom filter against a tx or address hash.
 * @private
 * @param {Hash} hash
 * @returns {Boolean}
 */

WalletDB.prototype.testFilter = function testFilter(data) {
  return this.filter.test(data, 'hex');
};

/**
 * Add hash to local and remote filters.
 * @private
 * @param {Hash} hash
 */

WalletDB.prototype.addHash = function addHash(hash) {
  this.filter.add(hash, 'hex');
  return this.addFilter(hash);
};

/**
 * Add outpoint to local filter.
 * @private
 * @param {Hash} hash
 * @param {Number} index
 */

WalletDB.prototype.addOutpoint = function addOutpoint(hash, index) {
  var outpoint = new Outpoint(hash, index);
  this.filter.add(outpoint.toRaw());
};

/**
 * Dump database (for debugging).
 * @returns {Promise} - Returns Object.
 */

WalletDB.prototype.dump = function dump() {
  return this.db.dump();
};

/**
 * Register an object with the walletdb.
 * @param {Object} object
 */

WalletDB.prototype.register = function register(wallet) {
  assert(!this.wallets[wallet.wid]);
  this.wallets[wallet.wid] = wallet;
};

/**
 * Unregister a object with the walletdb.
 * @param {Object} object
 * @returns {Boolean}
 */

WalletDB.prototype.unregister = function unregister(wallet) {
  assert(this.wallets[wallet.wid]);
  delete this.wallets[wallet.wid];
};

/**
 * Map wallet id to wid.
 * @param {String} id
 * @returns {Promise} - Returns {WalletID}.
 */

WalletDB.prototype.getWalletID = co( /*#__PURE__*/_regenerator2.default.mark(function getWalletID(id) {
  var wid, data;
  return _regenerator2.default.wrap(function getWalletID$(_context22) {
    while (1) {
      switch (_context22.prev = _context22.next) {
        case 0:
          if (id) {
            _context22.next = 2;
            break;
          }

          return _context22.abrupt('return');

        case 2:
          if (!(typeof id === 'number')) {
            _context22.next = 4;
            break;
          }

          return _context22.abrupt('return', id);

        case 4:

          wid = this.widCache.get(id);

          if (!wid) {
            _context22.next = 7;
            break;
          }

          return _context22.abrupt('return', wid);

        case 7:
          _context22.next = 9;
          return this.db.get(layout.l(id));

        case 9:
          data = _context22.sent;

          if (data) {
            _context22.next = 12;
            break;
          }

          return _context22.abrupt('return');

        case 12:

          wid = data.readUInt32LE(0, true);

          this.widCache.set(id, wid);

          return _context22.abrupt('return', wid);

        case 15:
        case 'end':
          return _context22.stop();
      }
    }
  }, getWalletID, this);
}));

/**
 * Get a wallet from the database, setup watcher.
 * @param {WalletID} wid
 * @returns {Promise} - Returns {@link Wallet}.
 */

WalletDB.prototype.get = co( /*#__PURE__*/_regenerator2.default.mark(function get(id) {
  var wid, unlock;
  return _regenerator2.default.wrap(function get$(_context23) {
    while (1) {
      switch (_context23.prev = _context23.next) {
        case 0:
          _context23.next = 2;
          return this.getWalletID(id);

        case 2:
          wid = _context23.sent;

          if (wid) {
            _context23.next = 5;
            break;
          }

          return _context23.abrupt('return');

        case 5:
          _context23.next = 7;
          return this.readLock.lock(wid);

        case 7:
          unlock = _context23.sent;
          _context23.prev = 8;
          _context23.next = 11;
          return this._get(wid);

        case 11:
          return _context23.abrupt('return', _context23.sent);

        case 12:
          _context23.prev = 12;

          unlock();
          return _context23.finish(12);

        case 15:
        case 'end':
          return _context23.stop();
      }
    }
  }, get, this, [[8,, 12, 15]]);
}));

/**
 * Get a wallet from the database without a lock.
 * @private
 * @param {WalletID} wid
 * @returns {Promise} - Returns {@link Wallet}.
 */

WalletDB.prototype._get = co( /*#__PURE__*/_regenerator2.default.mark(function get(wid) {
  var wallet, data;
  return _regenerator2.default.wrap(function get$(_context24) {
    while (1) {
      switch (_context24.prev = _context24.next) {
        case 0:
          wallet = this.wallets[wid];

          if (!wallet) {
            _context24.next = 3;
            break;
          }

          return _context24.abrupt('return', wallet);

        case 3:
          _context24.next = 5;
          return this.db.get(layout.w(wid));

        case 5:
          data = _context24.sent;

          if (data) {
            _context24.next = 8;
            break;
          }

          return _context24.abrupt('return');

        case 8:

          wallet = Wallet.fromRaw(this, data);

          _context24.next = 11;
          return wallet.open();

        case 11:

          this.register(wallet);

          return _context24.abrupt('return', wallet);

        case 13:
        case 'end':
          return _context24.stop();
      }
    }
  }, get, this);
}));

/**
 * Save a wallet to the database.
 * @param {Wallet} wallet
 */

WalletDB.prototype.save = function save(wallet) {
  var wid = wallet.wid;
  var id = wallet.id;
  var batch = this.batch(wallet);

  this.widCache.set(id, wid);

  batch.put(layout.w(wid), wallet.toRaw());
  batch.put(layout.l(id), U32(wid));
};

/**
 * Rename a wallet.
 * @param {Wallet} wallet
 * @param {String} id
 * @returns {Promise}
 */

WalletDB.prototype.rename = co( /*#__PURE__*/_regenerator2.default.mark(function rename(wallet, id) {
  var unlock;
  return _regenerator2.default.wrap(function rename$(_context25) {
    while (1) {
      switch (_context25.prev = _context25.next) {
        case 0:
          _context25.next = 2;
          return this.writeLock.lock();

        case 2:
          unlock = _context25.sent;
          _context25.prev = 3;
          _context25.next = 6;
          return this._rename(wallet, id);

        case 6:
          return _context25.abrupt('return', _context25.sent);

        case 7:
          _context25.prev = 7;

          unlock();
          return _context25.finish(7);

        case 10:
        case 'end':
          return _context25.stop();
      }
    }
  }, rename, this, [[3,, 7, 10]]);
}));

/**
 * Rename a wallet without a lock.
 * @private
 * @param {Wallet} wallet
 * @param {String} id
 * @returns {Promise}
 */

WalletDB.prototype._rename = co( /*#__PURE__*/_regenerator2.default.mark(function _rename(wallet, id) {
  var old, i, paths, path, batch;
  return _regenerator2.default.wrap(function _rename$(_context26) {
    while (1) {
      switch (_context26.prev = _context26.next) {
        case 0:
          old = wallet.id;

          if (common.isName(id)) {
            _context26.next = 3;
            break;
          }

          throw new Error('WDB: Bad wallet ID.');

        case 3:
          _context26.next = 5;
          return this.has(id);

        case 5:
          if (!_context26.sent) {
            _context26.next = 7;
            break;
          }

          throw new Error('WDB: ID not available.');

        case 7:

          batch = this.start(wallet);
          batch.del(layout.l(old));

          wallet.id = id;

          this.save(wallet);

          _context26.next = 13;
          return this.commit(wallet);

        case 13:

          this.widCache.remove(old);

          paths = wallet.pathCache.values();

          for (i = 0; i < paths.length; i++) {
            path = paths[i];
            path.id = id;
          }

        case 16:
        case 'end':
          return _context26.stop();
      }
    }
  }, _rename, this);
}));

/**
 * Rename an account.
 * @param {Account} account
 * @param {String} name
 */

WalletDB.prototype.renameAccount = function renameAccount(account, name) {
  var wallet = account.wallet;
  var batch = this.batch(wallet);

  // Remove old wid/name->account index.
  batch.del(layout.i(account.wid, account.name));

  account.name = name;

  this.saveAccount(account);
};

/**
 * Get a wallet with token auth first.
 * @param {WalletID} wid
 * @param {String|Buffer} token
 * @returns {Promise} - Returns {@link Wallet}.
 */

WalletDB.prototype.auth = co( /*#__PURE__*/_regenerator2.default.mark(function auth(wid, token) {
  var wallet;
  return _regenerator2.default.wrap(function auth$(_context27) {
    while (1) {
      switch (_context27.prev = _context27.next) {
        case 0:
          _context27.next = 2;
          return this.get(wid);

        case 2:
          wallet = _context27.sent;

          if (wallet) {
            _context27.next = 5;
            break;
          }

          return _context27.abrupt('return');

        case 5:
          if (!(typeof token === 'string')) {
            _context27.next = 9;
            break;
          }

          if (util.isHex256(token)) {
            _context27.next = 8;
            break;
          }

          throw new Error('WDB: Authentication error.');

        case 8:
          token = Buffer.from(token, 'hex');

        case 9:
          if (crypto.ccmp(token, wallet.token)) {
            _context27.next = 11;
            break;
          }

          throw new Error('WDB: Authentication error.');

        case 11:
          return _context27.abrupt('return', wallet);

        case 12:
        case 'end':
          return _context27.stop();
      }
    }
  }, auth, this);
}));

/**
 * Create a new wallet, save to database, setup watcher.
 * @param {Object} options - See {@link Wallet}.
 * @returns {Promise} - Returns {@link Wallet}.
 */

WalletDB.prototype.create = co( /*#__PURE__*/_regenerator2.default.mark(function create(options) {
  var unlock;
  return _regenerator2.default.wrap(function create$(_context28) {
    while (1) {
      switch (_context28.prev = _context28.next) {
        case 0:
          _context28.next = 2;
          return this.writeLock.lock();

        case 2:
          unlock = _context28.sent;


          if (!options) options = {};

          _context28.prev = 4;
          _context28.next = 7;
          return this._create(options);

        case 7:
          return _context28.abrupt('return', _context28.sent);

        case 8:
          _context28.prev = 8;

          unlock();
          return _context28.finish(8);

        case 11:
        case 'end':
          return _context28.stop();
      }
    }
  }, create, this, [[4,, 8, 11]]);
}));

/**
 * Create a new wallet, save to database without a lock.
 * @private
 * @param {Object} options - See {@link Wallet}.
 * @returns {Promise} - Returns {@link Wallet}.
 */

WalletDB.prototype._create = co( /*#__PURE__*/_regenerator2.default.mark(function create(options) {
  var exists, wallet;
  return _regenerator2.default.wrap(function create$(_context29) {
    while (1) {
      switch (_context29.prev = _context29.next) {
        case 0:
          _context29.next = 2;
          return this.has(options.id);

        case 2:
          exists = _context29.sent;

          if (!exists) {
            _context29.next = 5;
            break;
          }

          throw new Error('WDB: Wallet already exists.');

        case 5:

          wallet = Wallet.fromOptions(this, options);
          wallet.wid = this.depth++;

          _context29.next = 9;
          return wallet.init(options);

        case 9:

          this.register(wallet);

          this.logger.info('Created wallet %s in WalletDB.', wallet.id);

          return _context29.abrupt('return', wallet);

        case 12:
        case 'end':
          return _context29.stop();
      }
    }
  }, create, this);
}));

/**
 * Test for the existence of a wallet.
 * @param {WalletID} id
 * @returns {Promise}
 */

WalletDB.prototype.has = co( /*#__PURE__*/_regenerator2.default.mark(function has(id) {
  var wid;
  return _regenerator2.default.wrap(function has$(_context30) {
    while (1) {
      switch (_context30.prev = _context30.next) {
        case 0:
          _context30.next = 2;
          return this.getWalletID(id);

        case 2:
          wid = _context30.sent;
          return _context30.abrupt('return', wid != null);

        case 4:
        case 'end':
          return _context30.stop();
      }
    }
  }, has, this);
}));

/**
 * Attempt to create wallet, return wallet if already exists.
 * @param {Object} options - See {@link Wallet}.
 * @returns {Promise}
 */

WalletDB.prototype.ensure = co( /*#__PURE__*/_regenerator2.default.mark(function ensure(options) {
  var wallet;
  return _regenerator2.default.wrap(function ensure$(_context31) {
    while (1) {
      switch (_context31.prev = _context31.next) {
        case 0:
          _context31.next = 2;
          return this.get(options.id);

        case 2:
          wallet = _context31.sent;

          if (!wallet) {
            _context31.next = 5;
            break;
          }

          return _context31.abrupt('return', wallet);

        case 5:
          _context31.next = 7;
          return this.create(options);

        case 7:
          return _context31.abrupt('return', _context31.sent);

        case 8:
        case 'end':
          return _context31.stop();
      }
    }
  }, ensure, this);
}));

/**
 * Get an account from the database by wid.
 * @private
 * @param {WalletID} wid
 * @param {Number} index - Account index.
 * @returns {Promise} - Returns {@link Wallet}.
 */

WalletDB.prototype.getAccount = co( /*#__PURE__*/_regenerator2.default.mark(function getAccount(wid, index) {
  var data;
  return _regenerator2.default.wrap(function getAccount$(_context32) {
    while (1) {
      switch (_context32.prev = _context32.next) {
        case 0:
          _context32.next = 2;
          return this.db.get(layout.a(wid, index));

        case 2:
          data = _context32.sent;

          if (data) {
            _context32.next = 5;
            break;
          }

          return _context32.abrupt('return');

        case 5:
          return _context32.abrupt('return', Account.fromRaw(this, data));

        case 6:
        case 'end':
          return _context32.stop();
      }
    }
  }, getAccount, this);
}));

/**
 * List account names and indexes from the db.
 * @param {WalletID} wid
 * @returns {Promise} - Returns Array.
 */

WalletDB.prototype.getAccounts = function getAccounts(wid) {
  return this.db.values({
    gte: layout.n(wid, 0x00000000),
    lte: layout.n(wid, 0xffffffff),
    parse: function parse(data) {
      return data.toString('ascii');
    }
  });
};

/**
 * Lookup the corresponding account name's index.
 * @param {WalletID} wid
 * @param {String} name - Account name/index.
 * @returns {Promise} - Returns Number.
 */

WalletDB.prototype.getAccountIndex = co( /*#__PURE__*/_regenerator2.default.mark(function getAccountIndex(wid, name) {
  var index;
  return _regenerator2.default.wrap(function getAccountIndex$(_context33) {
    while (1) {
      switch (_context33.prev = _context33.next) {
        case 0:
          _context33.next = 2;
          return this.db.get(layout.i(wid, name));

        case 2:
          index = _context33.sent;

          if (index) {
            _context33.next = 5;
            break;
          }

          return _context33.abrupt('return', -1);

        case 5:
          return _context33.abrupt('return', index.readUInt32LE(0, true));

        case 6:
        case 'end':
          return _context33.stop();
      }
    }
  }, getAccountIndex, this);
}));

/**
 * Lookup the corresponding account index's name.
 * @param {WalletID} wid
 * @param {Number} index
 * @returns {Promise} - Returns Number.
 */

WalletDB.prototype.getAccountName = co( /*#__PURE__*/_regenerator2.default.mark(function getAccountName(wid, index) {
  var name;
  return _regenerator2.default.wrap(function getAccountName$(_context34) {
    while (1) {
      switch (_context34.prev = _context34.next) {
        case 0:
          _context34.next = 2;
          return this.db.get(layout.n(wid, index));

        case 2:
          name = _context34.sent;

          if (name) {
            _context34.next = 5;
            break;
          }

          return _context34.abrupt('return');

        case 5:
          return _context34.abrupt('return', name.toString('ascii'));

        case 6:
        case 'end':
          return _context34.stop();
      }
    }
  }, getAccountName, this);
}));

/**
 * Save an account to the database.
 * @param {Account} account
 * @returns {Promise}
 */

WalletDB.prototype.saveAccount = function saveAccount(account) {
  var wid = account.wid;
  var wallet = account.wallet;
  var index = account.accountIndex;
  var name = account.name;
  var batch = this.batch(wallet);

  // Account data
  batch.put(layout.a(wid, index), account.toRaw());

  // Name->Index lookups
  batch.put(layout.i(wid, name), U32(index));

  // Index->Name lookups
  batch.put(layout.n(wid, index), Buffer.from(name, 'ascii'));

  wallet.accountCache.push(index, account);
};

/**
 * Test for the existence of an account.
 * @param {WalletID} wid
 * @param {String|Number} acct
 * @returns {Promise} - Returns Boolean.
 */

WalletDB.prototype.hasAccount = function hasAccount(wid, index) {
  return this.db.has(layout.a(wid, index));
};

/**
 * Lookup the corresponding account name's index.
 * @param {WalletID} wid
 * @param {String|Number} name - Account name/index.
 * @returns {Promise} - Returns Number.
 */

WalletDB.prototype.getPathMap = co( /*#__PURE__*/_regenerator2.default.mark(function getPathMap(hash) {
  var map, data;
  return _regenerator2.default.wrap(function getPathMap$(_context35) {
    while (1) {
      switch (_context35.prev = _context35.next) {
        case 0:
          map = this.pathMapCache.get(hash);

          if (!map) {
            _context35.next = 3;
            break;
          }

          return _context35.abrupt('return', map);

        case 3:
          _context35.next = 5;
          return this.db.get(layout.p(hash));

        case 5:
          data = _context35.sent;

          if (data) {
            _context35.next = 8;
            break;
          }

          return _context35.abrupt('return');

        case 8:

          map = PathMapRecord.fromRaw(hash, data);

          this.pathMapCache.set(hash, map);

          return _context35.abrupt('return', map);

        case 11:
        case 'end':
          return _context35.stop();
      }
    }
  }, getPathMap, this);
}));

/**
 * Save an address to the path map.
 * @param {Wallet} wallet
 * @param {WalletKey} ring
 * @returns {Promise}
 */

WalletDB.prototype.saveKey = function saveKey(wallet, ring) {
  return this.savePath(wallet, ring.toPath());
};

/**
 * Save a path to the path map.
 *
 * The path map exists in the form of:
 *   - `p[address-hash] -> wid map`
 *   - `P[wid][address-hash] -> path data`
 *   - `r[wid][account-index][address-hash] -> dummy`
 *
 * @param {Wallet} wallet
 * @param {Path} path
 * @returns {Promise}
 */

WalletDB.prototype.savePath = co( /*#__PURE__*/_regenerator2.default.mark(function savePath(wallet, path) {
  var wid, hash, batch, map;
  return _regenerator2.default.wrap(function savePath$(_context36) {
    while (1) {
      switch (_context36.prev = _context36.next) {
        case 0:
          wid = wallet.wid;
          hash = path.hash;
          batch = this.batch(wallet);
          _context36.next = 5;
          return this.addHash(hash);

        case 5:
          _context36.next = 7;
          return this.getPathMap(hash);

        case 7:
          map = _context36.sent;


          if (!map) map = new PathMapRecord(hash);

          if (map.add(wid)) {
            _context36.next = 11;
            break;
          }

          return _context36.abrupt('return');

        case 11:

          this.pathMapCache.set(hash, map);
          wallet.pathCache.push(hash, path);

          // Address Hash -> Wallet Map
          batch.put(layout.p(hash), map.toRaw());

          // Wallet ID + Address Hash -> Path Data
          batch.put(layout.P(wid, hash), path.toRaw());

          // Wallet ID + Account Index + Address Hash -> Dummy
          batch.put(layout.r(wid, path.account, hash), DUMMY);

        case 16:
        case 'end':
          return _context36.stop();
      }
    }
  }, savePath, this);
}));

/**
 * Retrieve path by hash.
 * @param {WalletID} wid
 * @param {Hash} hash
 * @returns {Promise}
 */

WalletDB.prototype.getPath = co( /*#__PURE__*/_regenerator2.default.mark(function getPath(wid, hash) {
  var data, path;
  return _regenerator2.default.wrap(function getPath$(_context37) {
    while (1) {
      switch (_context37.prev = _context37.next) {
        case 0:
          _context37.next = 2;
          return this.db.get(layout.P(wid, hash));

        case 2:
          data = _context37.sent;

          if (data) {
            _context37.next = 5;
            break;
          }

          return _context37.abrupt('return');

        case 5:

          path = Path.fromRaw(data);
          path.wid = wid;
          path.hash = hash;

          return _context37.abrupt('return', path);

        case 9:
        case 'end':
          return _context37.stop();
      }
    }
  }, getPath, this);
}));

/**
 * Test whether a wallet contains a path.
 * @param {WalletID} wid
 * @param {Hash} hash
 * @returns {Promise}
 */

WalletDB.prototype.hasPath = function hasPath(wid, hash) {
  return this.db.has(layout.P(wid, hash));
};

/**
 * Get all address hashes.
 * @returns {Promise}
 */

WalletDB.prototype.getHashes = function getHashes() {
  return this.db.keys({
    gte: layout.p(encoding.NULL_HASH),
    lte: layout.p(encoding.HIGH_HASH),
    parse: layout.pp
  });
};

/**
 * Get all outpoints.
 * @returns {Promise}
 */

WalletDB.prototype.getOutpoints = function getOutpoints() {
  return this.db.keys({
    gte: layout.o(encoding.NULL_HASH, 0),
    lte: layout.o(encoding.HIGH_HASH, 0xffffffff),
    parse: function parse(key) {
      var items = layout.oo(key);
      return new Outpoint(items[0], items[1]);
    }
  });
};

/**
 * Get all address hashes.
 * @param {WalletID} wid
 * @returns {Promise}
 */

WalletDB.prototype.getWalletHashes = function getWalletHashes(wid) {
  return this.db.keys({
    gte: layout.P(wid, encoding.NULL_HASH),
    lte: layout.P(wid, encoding.HIGH_HASH),
    parse: layout.Pp
  });
};

/**
 * Get all account address hashes.
 * @param {WalletID} wid
 * @param {Number} account
 * @returns {Promise}
 */

WalletDB.prototype.getAccountHashes = function getAccountHashes(wid, account) {
  return this.db.keys({
    gte: layout.r(wid, account, encoding.NULL_HASH),
    lte: layout.r(wid, account, encoding.HIGH_HASH),
    parse: layout.rr
  });
};

/**
 * Get all paths for a wallet.
 * @param {WalletID} wid
 * @returns {Promise}
 */

WalletDB.prototype.getWalletPaths = co( /*#__PURE__*/_regenerator2.default.mark(function getWalletPaths(wid) {
  var i, item, items, hash, path;
  return _regenerator2.default.wrap(function getWalletPaths$(_context38) {
    while (1) {
      switch (_context38.prev = _context38.next) {
        case 0:
          _context38.next = 2;
          return this.db.range({
            gte: layout.P(wid, encoding.NULL_HASH),
            lte: layout.P(wid, encoding.HIGH_HASH)
          });

        case 2:
          items = _context38.sent;


          for (i = 0; i < items.length; i++) {
            item = items[i];
            hash = layout.Pp(item.key);
            path = Path.fromRaw(item.value);

            path.hash = hash;
            path.wid = wid;

            items[i] = path;
          }

          return _context38.abrupt('return', items);

        case 5:
        case 'end':
          return _context38.stop();
      }
    }
  }, getWalletPaths, this);
}));

/**
 * Get all wallet ids.
 * @returns {Promise}
 */

WalletDB.prototype.getWallets = function getWallets() {
  return this.db.keys({
    gte: layout.l('\x00'),
    lte: layout.l('\xff'),
    parse: layout.ll
  });
};

/**
 * Encrypt all imported keys for a wallet.
 * @param {WalletID} wid
 * @param {Buffer} key
 * @returns {Promise}
 */

WalletDB.prototype.encryptKeys = co( /*#__PURE__*/_regenerator2.default.mark(function encryptKeys(wallet, key) {
  var wid, paths, batch, i, path, iv;
  return _regenerator2.default.wrap(function encryptKeys$(_context39) {
    while (1) {
      switch (_context39.prev = _context39.next) {
        case 0:
          wid = wallet.wid;
          _context39.next = 3;
          return wallet.getPaths();

        case 3:
          paths = _context39.sent;
          batch = this.batch(wallet);
          i = 0;

        case 6:
          if (!(i < paths.length)) {
            _context39.next = 21;
            break;
          }

          path = paths[i];

          if (path.data) {
            _context39.next = 10;
            break;
          }

          return _context39.abrupt('continue', 18);

        case 10:

          assert(!path.encrypted);

          iv = Buffer.from(path.hash, 'hex');
          iv = iv.slice(0, 16);

          path = path.clone();
          path.data = crypto.encipher(path.data, key, iv);
          path.encrypted = true;

          wallet.pathCache.push(path.hash, path);

          batch.put(layout.P(wid, path.hash), path.toRaw());

        case 18:
          i++;
          _context39.next = 6;
          break;

        case 21:
        case 'end':
          return _context39.stop();
      }
    }
  }, encryptKeys, this);
}));

/**
 * Decrypt all imported keys for a wallet.
 * @param {WalletID} wid
 * @param {Buffer} key
 * @returns {Promise}
 */

WalletDB.prototype.decryptKeys = co( /*#__PURE__*/_regenerator2.default.mark(function decryptKeys(wallet, key) {
  var wid, paths, batch, i, path, iv;
  return _regenerator2.default.wrap(function decryptKeys$(_context40) {
    while (1) {
      switch (_context40.prev = _context40.next) {
        case 0:
          wid = wallet.wid;
          _context40.next = 3;
          return wallet.getPaths();

        case 3:
          paths = _context40.sent;
          batch = this.batch(wallet);
          i = 0;

        case 6:
          if (!(i < paths.length)) {
            _context40.next = 21;
            break;
          }

          path = paths[i];

          if (path.data) {
            _context40.next = 10;
            break;
          }

          return _context40.abrupt('continue', 18);

        case 10:

          assert(path.encrypted);

          iv = Buffer.from(path.hash, 'hex');
          iv = iv.slice(0, 16);

          path = path.clone();
          path.data = crypto.decipher(path.data, key, iv);
          path.encrypted = false;

          wallet.pathCache.push(path.hash, path);

          batch.put(layout.P(wid, path.hash), path.toRaw());

        case 18:
          i++;
          _context40.next = 6;
          break;

        case 21:
        case 'end':
          return _context40.stop();
      }
    }
  }, decryptKeys, this);
}));

/**
 * Resend all pending transactions.
 * @returns {Promise}
 */

WalletDB.prototype.resend = co( /*#__PURE__*/_regenerator2.default.mark(function resend() {
  var i, keys, key, wid;
  return _regenerator2.default.wrap(function resend$(_context41) {
    while (1) {
      switch (_context41.prev = _context41.next) {
        case 0:
          _context41.next = 2;
          return this.db.keys({
            gte: layout.w(0x00000000),
            lte: layout.w(0xffffffff)
          });

        case 2:
          keys = _context41.sent;
          i = 0;

        case 4:
          if (!(i < keys.length)) {
            _context41.next = 12;
            break;
          }

          key = keys[i];
          wid = layout.ww(key);
          _context41.next = 9;
          return this.resendPending(wid);

        case 9:
          i++;
          _context41.next = 4;
          break;

        case 12:
        case 'end':
          return _context41.stop();
      }
    }
  }, resend, this);
}));

/**
 * Resend all pending transactions for a specific wallet.
 * @private
 * @param {WalletID} wid
 * @returns {Promise}
 */

WalletDB.prototype.resendPending = co( /*#__PURE__*/_regenerator2.default.mark(function resendPending(wid) {
  var layout, txs, i, key, keys, hash, data, wtx, tx;
  return _regenerator2.default.wrap(function resendPending$(_context42) {
    while (1) {
      switch (_context42.prev = _context42.next) {
        case 0:
          layout = layouts.txdb;
          txs = [];
          _context42.next = 4;
          return this.db.keys({
            gte: layout.prefix(wid, layout.p(encoding.NULL_HASH)),
            lte: layout.prefix(wid, layout.p(encoding.HIGH_HASH))
          });

        case 4:
          keys = _context42.sent;

          if (!(keys.length === 0)) {
            _context42.next = 7;
            break;
          }

          return _context42.abrupt('return');

        case 7:

          this.logger.info('Rebroadcasting %d transactions for %d.', keys.length, wid);

          i = 0;

        case 9:
          if (!(i < keys.length)) {
            _context42.next = 25;
            break;
          }

          key = keys[i];

          hash = layout.pp(key);
          key = layout.prefix(wid, layout.t(hash));

          _context42.next = 15;
          return this.db.get(key);

        case 15:
          data = _context42.sent;

          if (data) {
            _context42.next = 18;
            break;
          }

          return _context42.abrupt('continue', 22);

        case 18:

          wtx = TXRecord.fromRaw(data);

          if (!wtx.tx.isCoinbase()) {
            _context42.next = 21;
            break;
          }

          return _context42.abrupt('continue', 22);

        case 21:

          txs.push(wtx.tx);

        case 22:
          i++;
          _context42.next = 9;
          break;

        case 25:

          txs = common.sortDeps(txs);

          i = 0;

        case 27:
          if (!(i < txs.length)) {
            _context42.next = 34;
            break;
          }

          tx = txs[i];
          _context42.next = 31;
          return this.send(tx);

        case 31:
          i++;
          _context42.next = 27;
          break;

        case 34:
        case 'end':
          return _context42.stop();
      }
    }
  }, resendPending, this);
}));

/**
 * Get all wallet ids by output addresses and outpoints.
 * @param {Hash[]} hashes
 * @returns {Promise}
 */

WalletDB.prototype.getWalletsByTX = co( /*#__PURE__*/_regenerator2.default.mark(function getWalletsByTX(tx) {
  var hashes, result, i, j, input, prevout, hash, map;
  return _regenerator2.default.wrap(function getWalletsByTX$(_context43) {
    while (1) {
      switch (_context43.prev = _context43.next) {
        case 0:
          hashes = tx.getOutputHashes('hex');
          result = [];

          if (tx.isCoinbase()) {
            _context43.next = 18;
            break;
          }

          i = 0;

        case 4:
          if (!(i < tx.inputs.length)) {
            _context43.next = 18;
            break;
          }

          input = tx.inputs[i];
          prevout = input.prevout;

          if (this.testFilter(prevout.toRaw())) {
            _context43.next = 9;
            break;
          }

          return _context43.abrupt('continue', 15);

        case 9:
          _context43.next = 11;
          return this.getOutpointMap(prevout.hash, prevout.index);

        case 11:
          map = _context43.sent;

          if (map) {
            _context43.next = 14;
            break;
          }

          return _context43.abrupt('continue', 15);

        case 14:

          for (j = 0; j < map.wids.length; j++) {
            util.binaryInsert(result, map.wids[j], cmp, true);
          }

        case 15:
          i++;
          _context43.next = 4;
          break;

        case 18:
          i = 0;

        case 19:
          if (!(i < hashes.length)) {
            _context43.next = 32;
            break;
          }

          hash = hashes[i];

          if (this.testFilter(hash)) {
            _context43.next = 23;
            break;
          }

          return _context43.abrupt('continue', 29);

        case 23:
          _context43.next = 25;
          return this.getPathMap(hash);

        case 25:
          map = _context43.sent;

          if (map) {
            _context43.next = 28;
            break;
          }

          return _context43.abrupt('continue', 29);

        case 28:

          for (j = 0; j < map.wids.length; j++) {
            util.binaryInsert(result, map.wids[j], cmp, true);
          }

        case 29:
          i++;
          _context43.next = 19;
          break;

        case 32:
          if (!(result.length === 0)) {
            _context43.next = 34;
            break;
          }

          return _context43.abrupt('return');

        case 34:
          return _context43.abrupt('return', result);

        case 35:
        case 'end':
          return _context43.stop();
      }
    }
  }, getWalletsByTX, this);
}));

/**
 * Get the best block hash.
 * @returns {Promise}
 */

WalletDB.prototype.getState = co( /*#__PURE__*/_regenerator2.default.mark(function getState() {
  var data;
  return _regenerator2.default.wrap(function getState$(_context44) {
    while (1) {
      switch (_context44.prev = _context44.next) {
        case 0:
          _context44.next = 2;
          return this.db.get(layout.R);

        case 2:
          data = _context44.sent;

          if (data) {
            _context44.next = 5;
            break;
          }

          return _context44.abrupt('return');

        case 5:
          return _context44.abrupt('return', ChainState.fromRaw(data));

        case 6:
        case 'end':
          return _context44.stop();
      }
    }
  }, getState, this);
}));

/**
 * Reset the chain state to a tip/start-block.
 * @param {BlockMeta} tip
 * @returns {Promise}
 */

WalletDB.prototype.resetState = co( /*#__PURE__*/_regenerator2.default.mark(function resetState(tip, marked) {
  var batch, state, iter, item;
  return _regenerator2.default.wrap(function resetState$(_context45) {
    while (1) {
      switch (_context45.prev = _context45.next) {
        case 0:
          batch = this.db.batch();
          state = this.state.clone();


          iter = this.db.iterator({
            gte: layout.h(0),
            lte: layout.h(0xffffffff),
            values: false
          });

        case 3:
          _context45.next = 5;
          return iter.next();

        case 5:
          item = _context45.sent;

          if (item) {
            _context45.next = 8;
            break;
          }

          return _context45.abrupt('break', 19);

        case 8:
          _context45.prev = 8;

          batch.del(item.key);
          _context45.next = 17;
          break;

        case 12:
          _context45.prev = 12;
          _context45.t0 = _context45['catch'](8);
          _context45.next = 16;
          return iter.end();

        case 16:
          throw _context45.t0;

        case 17:
          _context45.next = 3;
          break;

        case 19:

          state.startHeight = tip.height;
          state.startHash = tip.hash;
          state.height = tip.height;
          state.marked = marked;

          batch.put(layout.h(tip.height), tip.toHash());
          batch.put(layout.R, state.toRaw());

          _context45.next = 27;
          return batch.write();

        case 27:

          this.state = state;

        case 28:
        case 'end':
          return _context45.stop();
      }
    }
  }, resetState, this, [[8, 12]]);
}));

/**
 * Sync the current chain state to tip.
 * @param {BlockMeta} tip
 * @returns {Promise}
 */

WalletDB.prototype.syncState = co( /*#__PURE__*/_regenerator2.default.mark(function syncState(tip) {
  var batch, state, i, height, blocks;
  return _regenerator2.default.wrap(function syncState$(_context46) {
    while (1) {
      switch (_context46.prev = _context46.next) {
        case 0:
          batch = this.db.batch();
          state = this.state.clone();


          if (tip.height < state.height) {
            // Hashes ahead of our new tip
            // that we need to delete.
            height = state.height;
            blocks = height - tip.height;

            if (blocks > this.options.keepBlocks) blocks = this.options.keepBlocks;

            for (i = 0; i < blocks; i++) {
              batch.del(layout.h(height));
              height--;
            }
          } else if (tip.height > state.height) {
            // Prune old hashes.
            assert(tip.height === state.height + 1, 'Bad chain sync.');

            height = tip.height - this.options.keepBlocks;

            if (height >= 0) batch.del(layout.h(height));
          }

          state.height = tip.height;

          // Save tip and state.
          batch.put(layout.h(tip.height), tip.toHash());
          batch.put(layout.R, state.toRaw());

          _context46.next = 8;
          return batch.write();

        case 8:

          this.state = state;

        case 9:
        case 'end':
          return _context46.stop();
      }
    }
  }, syncState, this);
}));

/**
 * Mark the start block once a confirmed tx is seen.
 * @param {BlockMeta} tip
 * @returns {Promise}
 */

WalletDB.prototype.maybeMark = co( /*#__PURE__*/_regenerator2.default.mark(function maybeMark(tip) {
  return _regenerator2.default.wrap(function maybeMark$(_context47) {
    while (1) {
      switch (_context47.prev = _context47.next) {
        case 0:
          if (!this.state.marked) {
            _context47.next = 2;
            break;
          }

          return _context47.abrupt('return');

        case 2:

          this.logger.info('Marking WalletDB start block at %s (%d).', util.revHex(tip.hash), tip.height);

          _context47.next = 5;
          return this.resetState(tip, true);

        case 5:
        case 'end':
          return _context47.stop();
      }
    }
  }, maybeMark, this);
}));

/**
 * Get a block->wallet map.
 * @param {Number} height
 * @returns {Promise}
 */

WalletDB.prototype.getBlockMap = co( /*#__PURE__*/_regenerator2.default.mark(function getBlockMap(height) {
  var data;
  return _regenerator2.default.wrap(function getBlockMap$(_context48) {
    while (1) {
      switch (_context48.prev = _context48.next) {
        case 0:
          _context48.next = 2;
          return this.db.get(layout.b(height));

        case 2:
          data = _context48.sent;

          if (data) {
            _context48.next = 5;
            break;
          }

          return _context48.abrupt('return');

        case 5:
          return _context48.abrupt('return', BlockMapRecord.fromRaw(height, data));

        case 6:
        case 'end':
          return _context48.stop();
      }
    }
  }, getBlockMap, this);
}));

/**
 * Add block to the global block map.
 * @param {Wallet} wallet
 * @param {Number} height
 * @param {BlockMapRecord} block
 */

WalletDB.prototype.writeBlockMap = function writeBlockMap(wallet, height, block) {
  var batch = this.batch(wallet);
  batch.put(layout.b(height), block.toRaw());
};

/**
 * Remove a block from the global block map.
 * @param {Wallet} wallet
 * @param {Number} height
 */

WalletDB.prototype.unwriteBlockMap = function unwriteBlockMap(wallet, height) {
  var batch = this.batch(wallet);
  batch.del(layout.b(height));
};

/**
 * Get a Unspent->Wallet map.
 * @param {Hash} hash
 * @param {Number} index
 * @returns {Promise}
 */

WalletDB.prototype.getOutpointMap = co( /*#__PURE__*/_regenerator2.default.mark(function getOutpointMap(hash, index) {
  var data;
  return _regenerator2.default.wrap(function getOutpointMap$(_context49) {
    while (1) {
      switch (_context49.prev = _context49.next) {
        case 0:
          _context49.next = 2;
          return this.db.get(layout.o(hash, index));

        case 2:
          data = _context49.sent;

          if (data) {
            _context49.next = 5;
            break;
          }

          return _context49.abrupt('return');

        case 5:
          return _context49.abrupt('return', OutpointMapRecord.fromRaw(hash, index, data));

        case 6:
        case 'end':
          return _context49.stop();
      }
    }
  }, getOutpointMap, this);
}));

/**
 * Add an outpoint to global unspent map.
 * @param {Wallet} wallet
 * @param {Hash} hash
 * @param {Number} index
 * @param {OutpointMapRecord} map
 */

WalletDB.prototype.writeOutpointMap = function writeOutpointMap(wallet, hash, index, map) {
  var batch = this.batch(wallet);

  this.addOutpoint(hash, index);

  batch.put(layout.o(hash, index), map.toRaw());
};

/**
 * Remove an outpoint from global unspent map.
 * @param {Wallet} wallet
 * @param {Hash} hash
 * @param {Number} index
 */

WalletDB.prototype.unwriteOutpointMap = function unwriteOutpointMap(wallet, hash, index) {
  var batch = this.batch(wallet);
  batch.del(layout.o(hash, index));
};

/**
 * Get a wallet block meta.
 * @param {Hash} hash
 * @returns {Promise}
 */

WalletDB.prototype.getBlock = co( /*#__PURE__*/_regenerator2.default.mark(function getBlock(height) {
  var data, block;
  return _regenerator2.default.wrap(function getBlock$(_context50) {
    while (1) {
      switch (_context50.prev = _context50.next) {
        case 0:
          _context50.next = 2;
          return this.db.get(layout.h(height));

        case 2:
          data = _context50.sent;

          if (data) {
            _context50.next = 5;
            break;
          }

          return _context50.abrupt('return');

        case 5:

          block = new BlockMeta();
          block.hash = data.toString('hex');
          block.height = height;

          return _context50.abrupt('return', block);

        case 9:
        case 'end':
          return _context50.stop();
      }
    }
  }, getBlock, this);
}));

/**
 * Get wallet tip.
 * @param {Hash} hash
 * @returns {Promise}
 */

WalletDB.prototype.getTip = co( /*#__PURE__*/_regenerator2.default.mark(function getTip() {
  var tip;
  return _regenerator2.default.wrap(function getTip$(_context51) {
    while (1) {
      switch (_context51.prev = _context51.next) {
        case 0:
          _context51.next = 2;
          return this.getBlock(this.state.height);

        case 2:
          tip = _context51.sent;

          if (tip) {
            _context51.next = 5;
            break;
          }

          throw new Error('WDB: Tip not found!');

        case 5:
          return _context51.abrupt('return', tip);

        case 6:
        case 'end':
          return _context51.stop();
      }
    }
  }, getTip, this);
}));

/**
 * Sync with chain height.
 * @param {Number} height
 * @returns {Promise}
 */

WalletDB.prototype.rollback = co( /*#__PURE__*/_regenerator2.default.mark(function rollback(height) {
  var tip, marked;
  return _regenerator2.default.wrap(function rollback$(_context52) {
    while (1) {
      switch (_context52.prev = _context52.next) {
        case 0:
          if (!(height > this.state.height)) {
            _context52.next = 2;
            break;
          }

          throw new Error('WDB: Cannot rollback to the future.');

        case 2:
          if (!(height === this.state.height)) {
            _context52.next = 5;
            break;
          }

          this.logger.debug('Rolled back to same height (%d).', height);
          return _context52.abrupt('return', true);

        case 5:

          this.logger.info('Rolling back %d WalletDB blocks to height %d.', this.state.height - height, height);

          _context52.next = 8;
          return this.getBlock(height);

        case 8:
          tip = _context52.sent;

          if (!tip) {
            _context52.next = 15;
            break;
          }

          _context52.next = 12;
          return this.revert(tip.height);

        case 12:
          _context52.next = 14;
          return this.syncState(tip);

        case 14:
          return _context52.abrupt('return', true);

        case 15:

          tip = new BlockMeta();

          if (height >= this.state.startHeight) {
            tip.height = this.state.startHeight;
            tip.hash = this.state.startHash;
            marked = this.state.marked;

            this.logger.warning('Rolling back WalletDB to start block (%d).', tip.height);
          } else {
            tip.height = 0;
            tip.hash = this.network.genesis.hash;
            marked = false;

            this.logger.warning('Rolling back WalletDB to genesis block.');
          }

          _context52.next = 19;
          return this.revert(tip.height);

        case 19:
          _context52.next = 21;
          return this.resetState(tip, marked);

        case 21:
          return _context52.abrupt('return', false);

        case 22:
        case 'end':
          return _context52.stop();
      }
    }
  }, rollback, this);
}));

/**
 * Revert TXDB to an older state.
 * @param {Number} target
 * @returns {Promise}
 */

WalletDB.prototype.revert = co( /*#__PURE__*/_regenerator2.default.mark(function revert(target) {
  var total, i, iter, item, height, block, tx;
  return _regenerator2.default.wrap(function revert$(_context53) {
    while (1) {
      switch (_context53.prev = _context53.next) {
        case 0:
          total = 0;


          iter = this.db.iterator({
            gte: layout.b(target + 1),
            lte: layout.b(0xffffffff),
            reverse: true,
            values: true
          });

        case 2:
          _context53.next = 4;
          return iter.next();

        case 4:
          item = _context53.sent;

          if (item) {
            _context53.next = 7;
            break;
          }

          return _context53.abrupt('break', 28);

        case 7:
          _context53.prev = 7;

          height = layout.bb(item.key);
          block = BlockMapRecord.fromRaw(height, item.value);
          total += block.txs.length;

          i = block.txs.length - 1;

        case 12:
          if (!(i >= 0)) {
            _context53.next = 19;
            break;
          }

          tx = block.txs[i];
          _context53.next = 16;
          return this._unconfirm(tx);

        case 16:
          i--;
          _context53.next = 12;
          break;

        case 19:
          _context53.next = 26;
          break;

        case 21:
          _context53.prev = 21;
          _context53.t0 = _context53['catch'](7);
          _context53.next = 25;
          return iter.end();

        case 25:
          throw _context53.t0;

        case 26:
          _context53.next = 2;
          break;

        case 28:

          this.logger.info('Rolled back %d WalletDB transactions.', total);

        case 29:
        case 'end':
          return _context53.stop();
      }
    }
  }, revert, this, [[7, 21]]);
}));

/**
 * Add a block's transactions and write the new best hash.
 * @param {ChainEntry} entry
 * @returns {Promise}
 */

WalletDB.prototype.addBlock = co( /*#__PURE__*/_regenerator2.default.mark(function addBlock(entry, txs) {
  var unlock;
  return _regenerator2.default.wrap(function addBlock$(_context54) {
    while (1) {
      switch (_context54.prev = _context54.next) {
        case 0:
          _context54.next = 2;
          return this.txLock.lock();

        case 2:
          unlock = _context54.sent;
          _context54.prev = 3;
          _context54.next = 6;
          return this._addBlock(entry, txs);

        case 6:
          return _context54.abrupt('return', _context54.sent);

        case 7:
          _context54.prev = 7;

          unlock();
          return _context54.finish(7);

        case 10:
        case 'end':
          return _context54.stop();
      }
    }
  }, addBlock, this, [[3,, 7, 10]]);
}));

/**
 * Add a block's transactions without a lock.
 * @private
 * @param {ChainEntry} entry
 * @param {TX[]} txs
 * @returns {Promise}
 */

WalletDB.prototype._addBlock = co( /*#__PURE__*/_regenerator2.default.mark(function addBlock(entry, txs) {
  var tip, total, i, tx;
  return _regenerator2.default.wrap(function addBlock$(_context55) {
    while (1) {
      switch (_context55.prev = _context55.next) {
        case 0:
          tip = BlockMeta.fromEntry(entry);
          total = 0;

          if (!(tip.height < this.state.height)) {
            _context55.next = 5;
            break;
          }

          this.logger.warning('WalletDB is connecting low blocks (%d).', tip.height);
          return _context55.abrupt('return', total);

        case 5:
          if (!(tip.height === this.state.height)) {
            _context55.next = 9;
            break;
          }

          // We let blocks of the same height
          // through specifically for rescans:
          // we always want to rescan the last
          // block since the state may have
          // updated before the block was fully
          // processed (in the case of a crash).
          this.logger.warning('Already saw WalletDB block (%d).', tip.height);
          _context55.next = 11;
          break;

        case 9:
          if (!(tip.height !== this.state.height + 1)) {
            _context55.next = 11;
            break;
          }

          throw new Error('WDB: Bad connection (height mismatch).');

        case 11:
          _context55.next = 13;
          return this.syncState(tip);

        case 13:
          if (!this.options.checkpoints) {
            _context55.next = 16;
            break;
          }

          if (!(tip.height <= this.network.lastCheckpoint)) {
            _context55.next = 16;
            break;
          }

          return _context55.abrupt('return', total);

        case 16:
          i = 0;

        case 17:
          if (!(i < txs.length)) {
            _context55.next = 26;
            break;
          }

          tx = txs[i];
          _context55.next = 21;
          return this._insert(tx, tip);

        case 21:
          if (!_context55.sent) {
            _context55.next = 23;
            break;
          }

          total++;

        case 23:
          i++;
          _context55.next = 17;
          break;

        case 26:

          if (total > 0) {
            this.logger.info('Connected WalletDB block %s (tx=%d).', util.revHex(tip.hash), total);
          }

          return _context55.abrupt('return', total);

        case 28:
        case 'end':
          return _context55.stop();
      }
    }
  }, addBlock, this);
}));

/**
 * Unconfirm a block's transactions
 * and write the new best hash (SPV version).
 * @param {ChainEntry} entry
 * @returns {Promise}
 */

WalletDB.prototype.removeBlock = co( /*#__PURE__*/_regenerator2.default.mark(function removeBlock(entry) {
  var unlock;
  return _regenerator2.default.wrap(function removeBlock$(_context56) {
    while (1) {
      switch (_context56.prev = _context56.next) {
        case 0:
          _context56.next = 2;
          return this.txLock.lock();

        case 2:
          unlock = _context56.sent;
          _context56.prev = 3;
          _context56.next = 6;
          return this._removeBlock(entry);

        case 6:
          return _context56.abrupt('return', _context56.sent);

        case 7:
          _context56.prev = 7;

          unlock();
          return _context56.finish(7);

        case 10:
        case 'end':
          return _context56.stop();
      }
    }
  }, removeBlock, this, [[3,, 7, 10]]);
}));

/**
 * Unconfirm a block's transactions.
 * @private
 * @param {ChainEntry} entry
 * @returns {Promise}
 */

WalletDB.prototype._removeBlock = co( /*#__PURE__*/_regenerator2.default.mark(function removeBlock(entry) {
  var tip, i, tx, prev, block;
  return _regenerator2.default.wrap(function removeBlock$(_context57) {
    while (1) {
      switch (_context57.prev = _context57.next) {
        case 0:
          tip = BlockMeta.fromEntry(entry);

          if (!(tip.height > this.state.height)) {
            _context57.next = 4;
            break;
          }

          this.logger.warning('WalletDB is disconnecting high blocks (%d).', tip.height);
          return _context57.abrupt('return', 0);

        case 4:
          if (!(tip.height !== this.state.height)) {
            _context57.next = 6;
            break;
          }

          throw new Error('WDB: Bad disconnection (height mismatch).');

        case 6:
          _context57.next = 8;
          return this.getBlock(tip.height - 1);

        case 8:
          prev = _context57.sent;

          if (prev) {
            _context57.next = 11;
            break;
          }

          throw new Error('WDB: Bad disconnection (no previous block).');

        case 11:
          _context57.next = 13;
          return this.getBlockMap(tip.height);

        case 13:
          block = _context57.sent;

          if (block) {
            _context57.next = 18;
            break;
          }

          _context57.next = 17;
          return this.syncState(prev);

        case 17:
          return _context57.abrupt('return', 0);

        case 18:
          i = block.txs.length - 1;

        case 19:
          if (!(i >= 0)) {
            _context57.next = 26;
            break;
          }

          tx = block.txs[i];
          _context57.next = 23;
          return this._unconfirm(tx);

        case 23:
          i--;
          _context57.next = 19;
          break;

        case 26:
          _context57.next = 28;
          return this.syncState(prev);

        case 28:

          this.logger.warning('Disconnected wallet block %s (tx=%d).', util.revHex(tip.hash), block.txs.length);

          return _context57.abrupt('return', block.txs.length);

        case 30:
        case 'end':
          return _context57.stop();
      }
    }
  }, removeBlock, this);
}));

/**
 * Rescan a block.
 * @private
 * @param {ChainEntry} entry
 * @param {TX[]} txs
 * @returns {Promise}
 */

WalletDB.prototype.rescanBlock = co( /*#__PURE__*/_regenerator2.default.mark(function rescanBlock(entry, txs) {
  return _regenerator2.default.wrap(function rescanBlock$(_context58) {
    while (1) {
      switch (_context58.prev = _context58.next) {
        case 0:
          if (this.rescanning) {
            _context58.next = 3;
            break;
          }

          this.logger.warning('Unsolicited rescan block: %s.', entry.height);
          return _context58.abrupt('return');

        case 3:
          _context58.prev = 3;
          _context58.next = 6;
          return this._addBlock(entry, txs);

        case 6:
          _context58.next = 12;
          break;

        case 8:
          _context58.prev = 8;
          _context58.t0 = _context58['catch'](3);

          this.emit('error', _context58.t0);
          throw _context58.t0;

        case 12:
        case 'end':
          return _context58.stop();
      }
    }
  }, rescanBlock, this, [[3, 8]]);
}));

/**
 * Add a transaction to the database, map addresses
 * to wallet IDs, potentially store orphans, resolve
 * orphans, or confirm a transaction.
 * @param {TX} tx
 * @returns {Promise}
 */

WalletDB.prototype.addTX = co( /*#__PURE__*/_regenerator2.default.mark(function addTX(tx) {
  var unlock;
  return _regenerator2.default.wrap(function addTX$(_context59) {
    while (1) {
      switch (_context59.prev = _context59.next) {
        case 0:
          _context59.next = 2;
          return this.txLock.lock();

        case 2:
          unlock = _context59.sent;
          _context59.prev = 3;
          _context59.next = 6;
          return this._insert(tx);

        case 6:
          return _context59.abrupt('return', _context59.sent);

        case 7:
          _context59.prev = 7;

          unlock();
          return _context59.finish(7);

        case 10:
        case 'end':
          return _context59.stop();
      }
    }
  }, addTX, this, [[3,, 7, 10]]);
}));

/**
 * Add a transaction to the database without a lock.
 * @private
 * @param {TX} tx
 * @param {BlockMeta} block
 * @returns {Promise}
 */

WalletDB.prototype._insert = co( /*#__PURE__*/_regenerator2.default.mark(function insert(tx, block) {
  var result, i, wids, wid, wallet;
  return _regenerator2.default.wrap(function insert$(_context60) {
    while (1) {
      switch (_context60.prev = _context60.next) {
        case 0:
          result = false;


          assert(!tx.mutable, 'WDB: Cannot add mutable TX.');

          _context60.next = 4;
          return this.getWalletsByTX(tx);

        case 4:
          wids = _context60.sent;

          if (wids) {
            _context60.next = 7;
            break;
          }

          return _context60.abrupt('return');

        case 7:

          this.logger.info('Incoming transaction for %d wallets in WalletDB (%s).', wids.length, tx.txid());

          // If this is our first transaction
          // in a block, set the start block here.

          if (!block) {
            _context60.next = 11;
            break;
          }

          _context60.next = 11;
          return this.maybeMark(block);

        case 11:
          i = 0;

        case 12:
          if (!(i < wids.length)) {
            _context60.next = 26;
            break;
          }

          wid = wids[i];
          _context60.next = 16;
          return this.get(wid);

        case 16:
          wallet = _context60.sent;


          assert(wallet);

          _context60.next = 20;
          return wallet.add(tx, block);

        case 20:
          if (!_context60.sent) {
            _context60.next = 23;
            break;
          }

          this.logger.info('Added transaction to wallet in WalletDB: %s (%d).', wallet.id, wid);
          result = true;

        case 23:
          i++;
          _context60.next = 12;
          break;

        case 26:
          if (result) {
            _context60.next = 28;
            break;
          }

          return _context60.abrupt('return');

        case 28:
          return _context60.abrupt('return', wids);

        case 29:
        case 'end':
          return _context60.stop();
      }
    }
  }, insert, this);
}));

/**
 * Unconfirm a transaction from all
 * relevant wallets without a lock.
 * @private
 * @param {TXMapRecord} tx
 * @returns {Promise}
 */

WalletDB.prototype._unconfirm = co( /*#__PURE__*/_regenerator2.default.mark(function unconfirm(tx) {
  var i, wid, wallet;
  return _regenerator2.default.wrap(function unconfirm$(_context61) {
    while (1) {
      switch (_context61.prev = _context61.next) {
        case 0:
          i = 0;

        case 1:
          if (!(i < tx.wids.length)) {
            _context61.next = 12;
            break;
          }

          wid = tx.wids[i];
          _context61.next = 5;
          return this.get(wid);

        case 5:
          wallet = _context61.sent;

          assert(wallet);
          _context61.next = 9;
          return wallet.unconfirm(tx.hash);

        case 9:
          i++;
          _context61.next = 1;
          break;

        case 12:
        case 'end':
          return _context61.stop();
      }
    }
  }, unconfirm, this);
}));

/**
 * Handle a chain reset.
 * @param {ChainEntry} entry
 * @returns {Promise}
 */

WalletDB.prototype.resetChain = co( /*#__PURE__*/_regenerator2.default.mark(function resetChain(entry) {
  var unlock;
  return _regenerator2.default.wrap(function resetChain$(_context62) {
    while (1) {
      switch (_context62.prev = _context62.next) {
        case 0:
          _context62.next = 2;
          return this.txLock.lock();

        case 2:
          unlock = _context62.sent;
          _context62.prev = 3;
          _context62.next = 6;
          return this._resetChain(entry);

        case 6:
          return _context62.abrupt('return', _context62.sent);

        case 7:
          _context62.prev = 7;

          unlock();
          return _context62.finish(7);

        case 10:
        case 'end':
          return _context62.stop();
      }
    }
  }, resetChain, this, [[3,, 7, 10]]);
}));

/**
 * Handle a chain reset without a lock.
 * @private
 * @param {ChainEntry} entry
 * @returns {Promise}
 */

WalletDB.prototype._resetChain = co( /*#__PURE__*/_regenerator2.default.mark(function resetChain(entry) {
  return _regenerator2.default.wrap(function resetChain$(_context63) {
    while (1) {
      switch (_context63.prev = _context63.next) {
        case 0:
          if (!(entry.height > this.state.height)) {
            _context63.next = 2;
            break;
          }

          throw new Error('WDB: Bad reset height.');

        case 2:
          _context63.next = 4;
          return this.rollback(entry.height);

        case 4:
          if (!_context63.sent) {
            _context63.next = 6;
            break;
          }

          return _context63.abrupt('return');

        case 6:
          _context63.next = 8;
          return this.scan();

        case 8:
        case 'end':
          return _context63.stop();
      }
    }
  }, resetChain, this);
}));

/**
 * WalletOptions
 * @alias module:wallet.WalletOptions
 * @constructor
 * @param {Object} options
 */

function WalletOptions(options) {
  if (!(this instanceof WalletOptions)) return new WalletOptions(options);

  this.network = Network.primary;
  this.logger = Logger.global;
  this.client = null;

  this.prefix = null;
  this.location = null;
  this.db = 'memory';
  this.maxFiles = 64;
  this.cacheSize = 16 << 20;
  this.compression = true;
  this.bufferKeys = layout.binary;

  this.spv = false;
  this.witness = true;
  this.checkpoints = false;
  this.startHeight = 0;
  this.keepBlocks = this.network.block.keepBlocks;
  this.wipeNoReally = false;
  this.apiKey = null;
  this.walletAuth = false;
  this.noAuth = false;
  this.ssl = false;
  this.host = '127.0.0.1';
  this.port = this.network.rpcPort + 2;
  this.listen = false;

  if (options) this.fromOptions(options);
}

/**
 * Inject properties from object.
 * @private
 * @param {Object} options
 * @returns {WalletOptions}
 */

WalletOptions.prototype.fromOptions = function fromOptions(options) {
  if (options.network != null) {
    this.network = Network.get(options.network);
    this.keepBlocks = this.network.block.keepBlocks;
    this.port = this.network.rpcPort + 2;
  }

  if (options.logger != null) {
    assert((0, _typeof3.default)(options.logger) === 'object');
    this.logger = options.logger;
  }

  if (options.client != null) {
    assert((0, _typeof3.default)(options.client) === 'object');
    this.client = options.client;
  }

  if (options.prefix != null) {
    assert(typeof options.prefix === 'string');
    this.prefix = options.prefix;
    this.location = this.prefix + '/walletdb';
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
    assert(util.isNumber(options.maxFiles));
    this.maxFiles = options.maxFiles;
  }

  if (options.cacheSize != null) {
    assert(util.isNumber(options.cacheSize));
    this.cacheSize = options.cacheSize;
  }

  if (options.compression != null) {
    assert(typeof options.compression === 'boolean');
    this.compression = options.compression;
  }

  if (options.spv != null) {
    assert(typeof options.spv === 'boolean');
    this.spv = options.spv;
  }

  if (options.witness != null) {
    assert(typeof options.witness === 'boolean');
    this.witness = options.witness;
  }

  if (options.checkpoints != null) {
    assert(typeof options.checkpoints === 'boolean');
    this.checkpoints = options.checkpoints;
  }

  if (options.startHeight != null) {
    assert(typeof options.startHeight === 'number');
    assert(options.startHeight >= 0);
    this.startHeight = options.startHeight;
  }

  if (options.wipeNoReally != null) {
    assert(typeof options.wipeNoReally === 'boolean');
    this.wipeNoReally = options.wipeNoReally;
  }

  if (options.apiKey != null) {
    assert(typeof options.apiKey === 'string');
    this.apiKey = options.apiKey;
  }

  if (options.walletAuth != null) {
    assert(typeof options.walletAuth === 'boolean');
    this.walletAuth = options.walletAuth;
  }

  if (options.noAuth != null) {
    assert(typeof options.noAuth === 'boolean');
    this.noAuth = options.noAuth;
  }

  if (options.ssl != null) {
    assert(typeof options.ssl === 'boolean');
    this.ssl = options.ssl;
  }

  if (options.host != null) {
    assert(typeof options.host === 'string');
    this.host = options.host;
  }

  if (options.port != null) {
    assert(typeof options.port === 'number');
    this.port = options.port;
  }

  if (options.listen != null) {
    assert(typeof options.listen === 'boolean');
    this.listen = options.listen;
  }

  return this;
};

/**
 * Instantiate chain options from object.
 * @param {Object} options
 * @returns {WalletOptions}
 */

WalletOptions.fromOptions = function fromOptions(options) {
  return new WalletOptions().fromOptions(options);
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

module.exports = WalletDB;