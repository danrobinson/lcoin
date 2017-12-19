/*!
 * fullnode.js - full node for bcoin
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
var Node = require('./node');
var Chain = require('../blockchain/chain');
var Fees = require('../mempool/fees');
var Mempool = require('../mempool/mempool');
var Pool = require('../net/pool');
var Miner = require('../mining/miner');
var HTTPServer = require('../http/server');
var RPC = require('../http/rpc');

/**
 * Respresents a fullnode complete with a
 * chain, mempool, miner, etc.
 * @alias module:node.FullNode
 * @extends Node
 * @constructor
 * @param {Object?} options
 * @property {Chain} chain
 * @property {PolicyEstimator} fees
 * @property {Mempool} mempool
 * @property {Pool} pool
 * @property {Miner} miner
 * @property {HTTPServer} http
 * @emits FullNode#block
 * @emits FullNode#tx
 * @emits FullNode#connect
 * @emits FullNode#disconnect
 * @emits FullNode#reset
 * @emits FullNode#error
 */

function FullNode(options) {
  if (!(this instanceof FullNode)) return new FullNode(options);

  Node.call(this, options);

  // SPV flag.
  this.spv = false;

  // Instantiate blockchain.
  this.chain = new Chain({
    network: this.network,
    logger: this.logger,
    db: this.config.str('db'),
    prefix: this.config.prefix,
    maxFiles: this.config.num('max-files'),
    cacheSize: this.config.mb('cache-size'),
    forceWitness: this.config.bool('force-witness'),
    forcePrune: this.config.bool('force-prune'),
    prune: this.config.bool('prune'),
    checkpoints: this.config.bool('checkpoints'),
    coinCache: this.config.mb('coin-cache'),
    entryCache: this.config.num('entry-cache'),
    indexTX: this.config.bool('index-tx'),
    indexAddress: this.config.bool('index-address')
  });

  // Fee estimation.
  this.fees = new Fees(this.logger);
  this.fees.init();

  // Mempool needs access to the chain.
  this.mempool = new Mempool({
    network: this.network,
    logger: this.logger,
    chain: this.chain,
    fees: this.fees,
    db: this.config.str('db'),
    prefix: this.config.prefix,
    persistent: this.config.bool('persistent-mempool'),
    maxSize: this.config.mb('mempool-size'),
    limitFree: this.config.bool('limit-free'),
    limitFreeRelay: this.config.num('limit-free-relay'),
    requireStandard: this.config.bool('require-standard'),
    rejectAbsurdFees: this.config.bool('reject-absurd-fees'),
    replaceByFee: this.config.bool('replace-by-fee'),
    indexAddress: this.config.bool('index-address')
  });

  // Pool needs access to the chain and mempool.
  this.pool = new Pool({
    network: this.network,
    logger: this.logger,
    chain: this.chain,
    mempool: this.mempool,
    prefix: this.config.prefix,
    selfish: this.config.bool('selfish'),
    compact: this.config.bool('compact'),
    bip37: this.config.bool('bip37'),
    bip151: this.config.bool('bip151'),
    bip150: this.config.bool('bip150'),
    identityKey: this.config.buf('identity-key'),
    maxOutbound: this.config.num('max-outbound'),
    maxInbound: this.config.num('max-inbound'),
    proxy: this.config.str('proxy'),
    onion: this.config.bool('onion'),
    upnp: this.config.bool('upnp'),
    seeds: this.config.array('seeds'),
    nodes: this.config.array('nodes'),
    only: this.config.array('only'),
    publicHost: this.config.str('public-host'),
    publicPort: this.config.num('public-port'),
    host: this.config.str('host'),
    port: this.config.num('port'),
    listen: this.config.bool('listen'),
    persistent: this.config.bool('persistent')
  });

  // Miner needs access to the chain and mempool.
  this.miner = new Miner({
    network: this.network,
    logger: this.logger,
    chain: this.chain,
    mempool: this.mempool,
    address: this.config.array('coinbase-address'),
    coinbaseFlags: this.config.str('coinbase-flags'),
    preverify: this.config.bool('preverify'),
    maxWeight: this.config.num('max-weight'),
    reservedWeight: this.config.num('reserved-weight'),
    reservedSigops: this.config.num('reserved-sigops')
  });

  // RPC needs access to the node.
  this.rpc = new RPC(this);

  // HTTP needs access to the node.
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

  this._init();
}

util.inherits(FullNode, Node);

/**
 * Initialize the node.
 * @private
 */

FullNode.prototype._init = function _init() {
  var self = this;
  var onError = this.error.bind(this);

  // Bind to errors
  this.chain.on('error', onError);
  this.mempool.on('error', onError);
  this.pool.on('error', onError);
  this.miner.on('error', onError);

  if (this.http) this.http.on('error', onError);

  this.mempool.on('tx', function (tx) {
    self.miner.cpu.notifyEntry();
    self.emit('tx', tx);
  });

  this.chain.hook('connect', co( /*#__PURE__*/_regenerator2.default.mark(function _callee(entry, block) {
    return _regenerator2.default.wrap(function _callee$(_context) {
      while (1) {
        switch (_context.prev = _context.next) {
          case 0:
            _context.prev = 0;
            _context.next = 3;
            return self.mempool._addBlock(entry, block.txs);

          case 3:
            _context.next = 8;
            break;

          case 5:
            _context.prev = 5;
            _context.t0 = _context['catch'](0);

            self.error(_context.t0);

          case 8:
            self.emit('block', block);
            self.emit('connect', entry, block);

          case 10:
          case 'end':
            return _context.stop();
        }
      }
    }, _callee, this, [[0, 5]]);
  })));

  this.chain.hook('disconnect', co( /*#__PURE__*/_regenerator2.default.mark(function _callee2(entry, block) {
    return _regenerator2.default.wrap(function _callee2$(_context2) {
      while (1) {
        switch (_context2.prev = _context2.next) {
          case 0:
            _context2.prev = 0;
            _context2.next = 3;
            return self.mempool._removeBlock(entry, block.txs);

          case 3:
            _context2.next = 8;
            break;

          case 5:
            _context2.prev = 5;
            _context2.t0 = _context2['catch'](0);

            self.error(_context2.t0);

          case 8:
            self.emit('disconnect', entry, block);

          case 9:
          case 'end':
            return _context2.stop();
        }
      }
    }, _callee2, this, [[0, 5]]);
  })));

  this.chain.hook('reset', co( /*#__PURE__*/_regenerator2.default.mark(function _callee3(tip) {
    return _regenerator2.default.wrap(function _callee3$(_context3) {
      while (1) {
        switch (_context3.prev = _context3.next) {
          case 0:
            _context3.prev = 0;
            _context3.next = 3;
            return self.mempool._reset();

          case 3:
            _context3.next = 8;
            break;

          case 5:
            _context3.prev = 5;
            _context3.t0 = _context3['catch'](0);

            self.error(_context3.t0);

          case 8:
            self.emit('reset', tip);

          case 9:
          case 'end':
            return _context3.stop();
        }
      }
    }, _callee3, this, [[0, 5]]);
  })));

  this.loadPlugins();
};

/**
 * Open the node and all its child objects,
 * wait for the database to load.
 * @alias FullNode#open
 * @returns {Promise}
 */

FullNode.prototype._open = co( /*#__PURE__*/_regenerator2.default.mark(function open() {
  return _regenerator2.default.wrap(function open$(_context4) {
    while (1) {
      switch (_context4.prev = _context4.next) {
        case 0:
          _context4.next = 2;
          return this.chain.open();

        case 2:
          _context4.next = 4;
          return this.mempool.open();

        case 4:
          _context4.next = 6;
          return this.miner.open();

        case 6:
          _context4.next = 8;
          return this.pool.open();

        case 8:
          _context4.next = 10;
          return this.openPlugins();

        case 10:
          if (!this.http) {
            _context4.next = 13;
            break;
          }

          _context4.next = 13;
          return this.http.open();

        case 13:

          this.logger.info('Node is loaded.');

        case 14:
        case 'end':
          return _context4.stop();
      }
    }
  }, open, this);
}));

/**
 * Close the node, wait for the database to close.
 * @alias FullNode#close
 * @returns {Promise}
 */

FullNode.prototype._close = co( /*#__PURE__*/_regenerator2.default.mark(function close() {
  return _regenerator2.default.wrap(function close$(_context5) {
    while (1) {
      switch (_context5.prev = _context5.next) {
        case 0:
          if (!this.http) {
            _context5.next = 3;
            break;
          }

          _context5.next = 3;
          return this.http.close();

        case 3:
          _context5.next = 5;
          return this.closePlugins();

        case 5:
          _context5.next = 7;
          return this.pool.close();

        case 7:
          _context5.next = 9;
          return this.miner.close();

        case 9:
          _context5.next = 11;
          return this.mempool.close();

        case 11:
          _context5.next = 13;
          return this.chain.close();

        case 13:

          this.logger.info('Node is closed.');

        case 14:
        case 'end':
          return _context5.stop();
      }
    }
  }, close, this);
}));

/**
 * Rescan for any missed transactions.
 * @param {Number|Hash} start - Start block.
 * @param {Bloom} filter
 * @param {Function} iter - Iterator.
 * @returns {Promise}
 */

FullNode.prototype.scan = function scan(start, filter, iter) {
  return this.chain.scan(start, filter, iter);
};

/**
 * Broadcast a transaction (note that this will _not_ be verified
 * by the mempool - use with care, lest you get banned from
 * bitcoind nodes).
 * @param {TX|Block} item
 * @returns {Promise}
 */

FullNode.prototype.broadcast = co( /*#__PURE__*/_regenerator2.default.mark(function broadcast(item) {
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
 * Add transaction to mempool, broadcast.
 * @param {TX} tx
 */

FullNode.prototype.sendTX = co( /*#__PURE__*/_regenerator2.default.mark(function sendTX(tx) {
  var missing;
  return _regenerator2.default.wrap(function sendTX$(_context7) {
    while (1) {
      switch (_context7.prev = _context7.next) {
        case 0:
          _context7.prev = 0;
          _context7.next = 3;
          return this.mempool.addTX(tx);

        case 3:
          missing = _context7.sent;
          _context7.next = 15;
          break;

        case 6:
          _context7.prev = 6;
          _context7.t0 = _context7['catch'](0);

          if (!(_context7.t0.type === 'VerifyError' && _context7.t0.score === 0)) {
            _context7.next = 14;
            break;
          }

          this.error(_context7.t0);
          this.logger.warning('Verification failed for tx: %s.', tx.txid());
          this.logger.warning('Attempting to broadcast anyway...');
          this.broadcast(tx);
          return _context7.abrupt('return');

        case 14:
          throw _context7.t0;

        case 15:
          if (!missing) {
            _context7.next = 20;
            break;
          }

          this.logger.warning('TX was orphaned in mempool: %s.', tx.txid());
          this.logger.warning('Attempting to broadcast anyway...');
          this.broadcast(tx);
          return _context7.abrupt('return');

        case 20:

          // We need to announce by hand if
          // we're running in selfish mode.
          if (this.pool.options.selfish) this.pool.broadcast(tx);

        case 21:
        case 'end':
          return _context7.stop();
      }
    }
  }, sendTX, this, [[0, 6]]);
}));

/**
 * Add transaction to mempool, broadcast. Silence errors.
 * @param {TX} tx
 * @returns {Promise}
 */

FullNode.prototype.relay = co( /*#__PURE__*/_regenerator2.default.mark(function relay(tx) {
  return _regenerator2.default.wrap(function relay$(_context8) {
    while (1) {
      switch (_context8.prev = _context8.next) {
        case 0:
          _context8.prev = 0;
          _context8.next = 3;
          return this.sendTX(tx);

        case 3:
          _context8.next = 8;
          break;

        case 5:
          _context8.prev = 5;
          _context8.t0 = _context8['catch'](0);

          this.error(_context8.t0);

        case 8:
        case 'end':
          return _context8.stop();
      }
    }
  }, relay, this, [[0, 5]]);
}));

/**
 * Connect to the network.
 * @returns {Promise}
 */

FullNode.prototype.connect = function connect() {
  return this.pool.connect();
};

/**
 * Disconnect from the network.
 * @returns {Promise}
 */

FullNode.prototype.disconnect = function disconnect() {
  return this.pool.disconnect();
};

/**
 * Start the blockchain sync.
 */

FullNode.prototype.startSync = function startSync() {
  return this.pool.startSync();
};

/**
 * Stop syncing the blockchain.
 */

FullNode.prototype.stopSync = function stopSync() {
  return this.pool.stopSync();
};

/**
 * Retrieve a block from the chain database.
 * @param {Hash} hash
 * @returns {Promise} - Returns {@link Block}.
 */

FullNode.prototype.getBlock = function getBlock(hash) {
  return this.chain.db.getBlock(hash);
};

/**
 * Retrieve a coin from the mempool or chain database.
 * Takes into account spent coins in the mempool.
 * @param {Hash} hash
 * @param {Number} index
 * @returns {Promise} - Returns {@link Coin}.
 */

FullNode.prototype.getCoin = function getCoin(hash, index) {
  var coin = this.mempool.getCoin(hash, index);

  if (coin) return _promise2.default.resolve(coin);

  if (this.mempool.isSpent(hash, index)) return _promise2.default.resolve();

  return this.chain.db.getCoin(hash, index);
};

/**
 * Get coins that pertain to an address from the mempool or chain database.
 * Takes into account spent coins in the mempool.
 * @param {Address} addresses
 * @returns {Promise} - Returns {@link Coin}[].
 */

FullNode.prototype.getCoinsByAddress = co( /*#__PURE__*/_regenerator2.default.mark(function getCoinsByAddress(addresses) {
  var mempool, chain, out, i, coin, spent;
  return _regenerator2.default.wrap(function getCoinsByAddress$(_context9) {
    while (1) {
      switch (_context9.prev = _context9.next) {
        case 0:
          mempool = this.mempool.getCoinsByAddress(addresses);
          _context9.next = 3;
          return this.chain.db.getCoinsByAddress(addresses);

        case 3:
          chain = _context9.sent;
          out = [];
          i = 0;

        case 6:
          if (!(i < chain.length)) {
            _context9.next = 15;
            break;
          }

          coin = chain[i];
          spent = this.mempool.isSpent(coin.hash, coin.index);

          if (!spent) {
            _context9.next = 11;
            break;
          }

          return _context9.abrupt('continue', 12);

        case 11:

          out.push(coin);

        case 12:
          i++;
          _context9.next = 6;
          break;

        case 15:

          for (i = 0; i < mempool.length; i++) {
            coin = mempool[i];
            out.push(coin);
          }

          return _context9.abrupt('return', out);

        case 17:
        case 'end':
          return _context9.stop();
      }
    }
  }, getCoinsByAddress, this);
}));

/**
 * Retrieve transactions pertaining to an
 * address from the mempool or chain database.
 * @param {Address} addresses
 * @returns {Promise} - Returns {@link TXMeta}[].
 */

FullNode.prototype.getMetaByAddress = co( /*#__PURE__*/_regenerator2.default.mark(function getTXByAddress(addresses) {
  var mempool, chain;
  return _regenerator2.default.wrap(function getTXByAddress$(_context10) {
    while (1) {
      switch (_context10.prev = _context10.next) {
        case 0:
          mempool = this.mempool.getMetaByAddress(addresses);
          _context10.next = 3;
          return this.chain.db.getMetaByAddress(addresses);

        case 3:
          chain = _context10.sent;
          return _context10.abrupt('return', chain.concat(mempool));

        case 5:
        case 'end':
          return _context10.stop();
      }
    }
  }, getTXByAddress, this);
}));

/**
 * Retrieve a transaction from the mempool or chain database.
 * @param {Hash} hash
 * @returns {Promise} - Returns {@link TXMeta}.
 */

FullNode.prototype.getMeta = co( /*#__PURE__*/_regenerator2.default.mark(function getMeta(hash) {
  var meta;
  return _regenerator2.default.wrap(function getMeta$(_context11) {
    while (1) {
      switch (_context11.prev = _context11.next) {
        case 0:
          meta = this.mempool.getMeta(hash);

          if (!meta) {
            _context11.next = 3;
            break;
          }

          return _context11.abrupt('return', meta);

        case 3:
          _context11.next = 5;
          return this.chain.db.getMeta(hash);

        case 5:
          return _context11.abrupt('return', _context11.sent);

        case 6:
        case 'end':
          return _context11.stop();
      }
    }
  }, getMeta, this);
}));

/**
 * Retrieve a spent coin viewpoint from mempool or chain database.
 * @param {TXMeta} meta
 * @returns {Promise} - Returns {@link CoinView}.
 */

FullNode.prototype.getMetaView = co( /*#__PURE__*/_regenerator2.default.mark(function getMetaView(meta) {
  return _regenerator2.default.wrap(function getMetaView$(_context12) {
    while (1) {
      switch (_context12.prev = _context12.next) {
        case 0:
          if (!(meta.height === -1)) {
            _context12.next = 2;
            break;
          }

          return _context12.abrupt('return', this.mempool.getSpentView(meta.tx));

        case 2:
          return _context12.abrupt('return', this.chain.getSpentView(meta.tx));

        case 3:
        case 'end':
          return _context12.stop();
      }
    }
  }, getMetaView, this);
}));

/**
 * Retrieve transactions pertaining to an
 * address from the mempool or chain database.
 * @param {Address} addresses
 * @returns {Promise} - Returns {@link TX}[].
 */

FullNode.prototype.getTXByAddress = co( /*#__PURE__*/_regenerator2.default.mark(function getTXByAddress(addresses) {
  var mtxs, out, i, mtx;
  return _regenerator2.default.wrap(function getTXByAddress$(_context13) {
    while (1) {
      switch (_context13.prev = _context13.next) {
        case 0:
          _context13.next = 2;
          return this.getMetaByAddress(addresses);

        case 2:
          mtxs = _context13.sent;
          out = [];


          for (i = 0; i < mtxs.length; i++) {
            mtx = mtxs[i];
            out.push(mtx.tx);
          }

          return _context13.abrupt('return', out);

        case 6:
        case 'end':
          return _context13.stop();
      }
    }
  }, getTXByAddress, this);
}));

/**
 * Retrieve a transaction from the mempool or chain database.
 * @param {Hash} hash
 * @returns {Promise} - Returns {@link TX}.
 */

FullNode.prototype.getTX = co( /*#__PURE__*/_regenerator2.default.mark(function getTX(hash) {
  var mtx;
  return _regenerator2.default.wrap(function getTX$(_context14) {
    while (1) {
      switch (_context14.prev = _context14.next) {
        case 0:
          _context14.next = 2;
          return this.getMeta(hash);

        case 2:
          mtx = _context14.sent;

          if (mtx) {
            _context14.next = 5;
            break;
          }

          return _context14.abrupt('return');

        case 5:
          return _context14.abrupt('return', mtx.tx);

        case 6:
        case 'end':
          return _context14.stop();
      }
    }
  }, getTX, this);
}));

/**
 * Test whether the mempool or chain contains a transaction.
 * @param {Hash} hash
 * @returns {Promise} - Returns Boolean.
 */

FullNode.prototype.hasTX = co( /*#__PURE__*/_regenerator2.default.mark(function hasTX(hash) {
  return _regenerator2.default.wrap(function hasTX$(_context15) {
    while (1) {
      switch (_context15.prev = _context15.next) {
        case 0:
          if (!this.mempool.hasEntry(hash)) {
            _context15.next = 2;
            break;
          }

          return _context15.abrupt('return', true);

        case 2:
          _context15.next = 4;
          return this.chain.db.hasTX(hash);

        case 4:
          return _context15.abrupt('return', _context15.sent);

        case 5:
        case 'end':
          return _context15.stop();
      }
    }
  }, hasTX, this);
}));

/*
 * Expose
 */

module.exports = FullNode;