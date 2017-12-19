/*!
 * spvnode.js - spv node for bcoin
 * Copyright (c) 2014-2015, Fedor Indutny (MIT License)
 * Copyright (c) 2014-2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

var _promise = require('babel-runtime/core-js/promise');

var _promise2 = _interopRequireDefault(_promise);

var _regenerator = require('babel-runtime/regenerator');

var _regenerator2 = _interopRequireDefault(_regenerator);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var util = require('../utils/util');
var co = require('../utils/co');
var Lock = require('../utils/lock');
var Node = require('./node');
var Chain = require('../blockchain/chain');
var Pool = require('../net/pool');
var HTTPServer = require('../http/server');
var RPC = require('../http/rpc');

/**
 * Create an spv node which only maintains
 * a chain, a pool, and an http server.
 * @alias module:node.SPVNode
 * @extends Node
 * @constructor
 * @param {Object?} options
 * @param {Buffer?} options.sslKey
 * @param {Buffer?} options.sslCert
 * @param {Number?} options.httpPort
 * @param {String?} options.httpHost
 * @property {Boolean} loaded
 * @property {Chain} chain
 * @property {Pool} pool
 * @property {HTTPServer} http
 * @emits SPVNode#block
 * @emits SPVNode#tx
 * @emits SPVNode#error
 */

function SPVNode(options) {
  if (!(this instanceof SPVNode)) return new SPVNode(options);

  Node.call(this, options);

  // SPV flag.
  this.spv = true;

  this.chain = new Chain({
    network: this.network,
    logger: this.logger,
    db: this.config.str('db'),
    prefix: this.config.prefix,
    maxFiles: this.config.num('max-files'),
    cacheSize: this.config.mb('cache-size'),
    entryCache: this.config.num('entry-cache'),
    forceWitness: this.config.bool('force-witness'),
    checkpoints: this.config.bool('checkpoints'),
    spv: true
  });

  this.pool = new Pool({
    network: this.network,
    logger: this.logger,
    chain: this.chain,
    prefix: this.config.prefix,
    proxy: this.config.str('proxy'),
    onion: this.config.bool('onion'),
    upnp: this.config.bool('upnp'),
    seeds: this.config.array('seeds'),
    nodes: this.config.array('nodes'),
    only: this.config.array('only'),
    bip151: this.config.bool('bip151'),
    bip150: this.config.bool('bip150'),
    identityKey: this.config.buf('identity-key'),
    maxOutbound: this.config.num('max-outbound'),
    persistent: this.config.bool('persistent'),
    selfish: true,
    listen: false
  });

  this.rpc = new RPC(this);

  if (!HTTPServer.unsupported) {
    this.http = new HTTPServer({
      network: this.network,
      logger: this.logger,
      node: this,
      prefix: this.config.prefix,
      ssl: this.config.bool('ssl'),
      keyFile: this.config.path('ssl-key'),
      certFile: this.config.path('ssl-cert'),
      host: this.config.str('http-host'),
      port: this.config.num('http-port'),
      apiKey: this.config.str('api-key'),
      noAuth: this.config.bool('no-auth')
    });
  }

  this.rescanJob = null;
  this.scanLock = new Lock();
  this.watchLock = new Lock();

  this._init();
}

util.inherits(SPVNode, Node);

/**
 * Initialize the node.
 * @private
 */

SPVNode.prototype._init = function _init() {
  var self = this;
  var onError = this.error.bind(this);

  // Bind to errors
  this.chain.on('error', onError);
  this.pool.on('error', onError);

  if (this.http) this.http.on('error', onError);

  this.pool.on('tx', function (tx) {
    if (self.rescanJob) return;

    self.emit('tx', tx);
  });

  this.chain.on('block', function (block) {
    self.emit('block', block);
  });

  this.chain.on('connect', co( /*#__PURE__*/_regenerator2.default.mark(function _callee(entry, block) {
    return _regenerator2.default.wrap(function _callee$(_context) {
      while (1) {
        switch (_context.prev = _context.next) {
          case 0:
            if (!self.rescanJob) {
              _context.next = 10;
              break;
            }

            _context.prev = 1;
            _context.next = 4;
            return self.watchBlock(entry, block);

          case 4:
            _context.next = 9;
            break;

          case 6:
            _context.prev = 6;
            _context.t0 = _context['catch'](1);

            self.error(_context.t0);

          case 9:
            return _context.abrupt('return');

          case 10:

            self.emit('connect', entry, block);

          case 11:
          case 'end':
            return _context.stop();
        }
      }
    }, _callee, this, [[1, 6]]);
  })));

  this.chain.on('disconnect', function (entry, block) {
    self.emit('disconnect', entry);
  });

  this.chain.on('reset', function (tip) {
    self.emit('reset', tip);
  });

  this.loadPlugins();
};

/**
 * Open the node and all its child objects,
 * wait for the database to load.
 * @alias SPVNode#open
 * @returns {Promise}
 */

SPVNode.prototype._open = co( /*#__PURE__*/_regenerator2.default.mark(function open(callback) {
  return _regenerator2.default.wrap(function open$(_context2) {
    while (1) {
      switch (_context2.prev = _context2.next) {
        case 0:
          _context2.next = 2;
          return this.chain.open();

        case 2:
          _context2.next = 4;
          return this.pool.open();

        case 4:
          _context2.next = 6;
          return this.openPlugins();

        case 6:
          if (!this.http) {
            _context2.next = 9;
            break;
          }

          _context2.next = 9;
          return this.http.open();

        case 9:

          this.logger.info('Node is loaded.');

        case 10:
        case 'end':
          return _context2.stop();
      }
    }
  }, open, this);
}));

/**
 * Close the node, wait for the database to close.
 * @alias SPVNode#close
 * @returns {Promise}
 */

SPVNode.prototype._close = co( /*#__PURE__*/_regenerator2.default.mark(function close() {
  return _regenerator2.default.wrap(function close$(_context3) {
    while (1) {
      switch (_context3.prev = _context3.next) {
        case 0:
          if (!this.http) {
            _context3.next = 3;
            break;
          }

          _context3.next = 3;
          return this.http.close();

        case 3:
          _context3.next = 5;
          return this.closePlugins();

        case 5:
          _context3.next = 7;
          return this.pool.close();

        case 7:
          _context3.next = 9;
          return this.chain.close();

        case 9:
        case 'end':
          return _context3.stop();
      }
    }
  }, close, this);
}));

/**
 * Scan for any missed transactions.
 * Note that this will replay the blockchain sync.
 * @param {Number|Hash} start - Start block.
 * @param {Bloom} filter
 * @param {Function} iter - Iterator.
 * @returns {Promise}
 */

SPVNode.prototype.scan = co( /*#__PURE__*/_regenerator2.default.mark(function scan(start, filter, iter) {
  var unlock, height;
  return _regenerator2.default.wrap(function scan$(_context4) {
    while (1) {
      switch (_context4.prev = _context4.next) {
        case 0:
          _context4.next = 2;
          return this.scanLock.lock();

        case 2:
          unlock = _context4.sent;
          height = this.chain.height;
          _context4.prev = 4;
          _context4.next = 7;
          return this.chain.replay(start);

        case 7:

          if (this.chain.height < height) {
            // We need to somehow defer this.
            // yield this.connect();
            // this.startSync();
            // yield this.watchUntil(height, iter);
          }

        case 8:
          _context4.prev = 8;

          unlock();
          return _context4.finish(8);

        case 11:
        case 'end':
          return _context4.stop();
      }
    }
  }, scan, this, [[4,, 8, 11]]);
}));

/**
 * Watch the blockchain until a certain height.
 * @param {Number} height
 * @param {Function} iter
 * @returns {Promise}
 */

SPVNode.prototype.watchUntil = function watchUntil(height, iter) {
  var self = this;
  return new _promise2.default(function (resolve, reject) {
    self.rescanJob = new RescanJob(resolve, reject, height, iter);
  });
};

/**
 * Handled watched block.
 * @param {ChainEntry} entry
 * @param {MerkleBlock} block
 * @returns {Promise}
 */

SPVNode.prototype.watchBlock = co( /*#__PURE__*/_regenerator2.default.mark(function watchBlock(entry, block) {
  var unlock;
  return _regenerator2.default.wrap(function watchBlock$(_context5) {
    while (1) {
      switch (_context5.prev = _context5.next) {
        case 0:
          _context5.next = 2;
          return this.watchLock.lock();

        case 2:
          unlock = _context5.sent;
          _context5.prev = 3;

          if (!(entry.height < this.rescanJob.height)) {
            _context5.next = 8;
            break;
          }

          _context5.next = 7;
          return this.rescanJob.iter(entry, block.txs);

        case 7:
          return _context5.abrupt('return');

        case 8:
          this.rescanJob.resolve();
          this.rescanJob = null;
          _context5.next = 16;
          break;

        case 12:
          _context5.prev = 12;
          _context5.t0 = _context5['catch'](3);

          this.rescanJob.reject(_context5.t0);
          this.rescanJob = null;

        case 16:
          _context5.prev = 16;

          unlock();
          return _context5.finish(16);

        case 19:
        case 'end':
          return _context5.stop();
      }
    }
  }, watchBlock, this, [[3, 12, 16, 19]]);
}));

/**
 * Broadcast a transaction (note that this will _not_ be verified
 * by the mempool - use with care, lest you get banned from
 * bitcoind nodes).
 * @param {TX|Block} item
 * @returns {Promise}
 */

SPVNode.prototype.broadcast = co( /*#__PURE__*/_regenerator2.default.mark(function broadcast(item) {
  return _regenerator2.default.wrap(function broadcast$(_context6) {
    while (1) {
      switch (_context6.prev = _context6.next) {
        case 0:
          _context6.prev = 0;
          _context6.next = 3;
          return this.pool.broadcast(item);

        case 3:
          _context6.next = 8;
          break;

        case 5:
          _context6.prev = 5;
          _context6.t0 = _context6['catch'](0);

          this.emit('error', _context6.t0);

        case 8:
        case 'end':
          return _context6.stop();
      }
    }
  }, broadcast, this, [[0, 5]]);
}));

/**
 * Broadcast a transaction (note that this will _not_ be verified
 * by the mempool - use with care, lest you get banned from
 * bitcoind nodes).
 * @param {TX} tx
 * @returns {Promise}
 */

SPVNode.prototype.sendTX = function sendTX(tx) {
  return this.broadcast(tx);
};

/**
 * Broadcast a transaction. Silence errors.
 * @param {TX} tx
 * @returns {Promise}
 */

SPVNode.prototype.relay = function relay(tx) {
  return this.broadcast(tx);
};

/**
 * Connect to the network.
 * @returns {Promise}
 */

SPVNode.prototype.connect = function connect() {
  return this.pool.connect();
};

/**
 * Disconnect from the network.
 * @returns {Promise}
 */

SPVNode.prototype.disconnect = function disconnect() {
  return this.pool.disconnect();
};

/**
 * Start the blockchain sync.
 */

SPVNode.prototype.startSync = function startSync() {
  return this.pool.startSync();
};

/**
 * Stop syncing the blockchain.
 */

SPVNode.prototype.stopSync = function stopSync() {
  return this.pool.stopSync();
};

/*
 * Helpers
 */

function RescanJob(resolve, reject, height, iter) {
  this.resolve = resolve;
  this.reject = reject;
  this.height = height;
  this.iter = iter;
}

/*
 * Expose
 */

module.exports = SPVNode;