/*!
 * server.js - http server for bcoin
 * Copyright (c) 2014-2015, Fedor Indutny (MIT License)
 * Copyright (c) 2014-2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

var _typeof2 = require('babel-runtime/helpers/typeof');

var _typeof3 = _interopRequireDefault(_typeof2);

var _promise = require('babel-runtime/core-js/promise');

var _promise2 = _interopRequireDefault(_promise);

var _regenerator = require('babel-runtime/regenerator');

var _regenerator2 = _interopRequireDefault(_regenerator);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var assert = require('assert');
var HTTPBase = require('./base');
var util = require('../utils/util');
var co = require('../utils/co');
var base58 = require('../utils/base58');
var Amount = require('../btc/amount');
var Bloom = require('../utils/bloom');
var TX = require('../primitives/tx');
var Outpoint = require('../primitives/outpoint');
var crypto = require('../crypto/crypto');
var Network = require('../protocol/network');
var Validator = require('../utils/validator');
var pkg = require('../pkg');

/**
 * HTTPServer
 * @alias module:http.Server
 * @constructor
 * @param {Object} options
 * @param {Fullnode} options.node
 * @see HTTPBase
 * @emits HTTPServer#socket
 */

function HTTPServer(options) {
  if (!(this instanceof HTTPServer)) return new HTTPServer(options);

  options = new HTTPOptions(options);

  HTTPBase.call(this, options);

  this.options = options;
  this.network = this.options.network;
  this.logger = this.options.logger.context('http');
  this.node = this.options.node;

  this.chain = this.node.chain;
  this.mempool = this.node.mempool;
  this.pool = this.node.pool;
  this.fees = this.node.fees;
  this.miner = this.node.miner;
  this.rpc = this.node.rpc;

  this.init();
}

util.inherits(HTTPServer, HTTPBase);

/**
 * Initialize routes.
 * @private
 */

HTTPServer.prototype.init = function init() {
  var self = this;

  this.on('request', function (req, res) {
    if (req.method === 'POST' && req.pathname === '/') return;

    self.logger.debug('Request for method=%s path=%s (%s).', req.method, req.pathname, req.socket.remoteAddress);
  });

  this.on('listening', function (address) {
    self.logger.info('Node HTTP server listening on %s (port=%d).', address.address, address.port);
  });

  this.initRouter();
  this.initSockets();
};

/**
 * Initialize routes.
 * @private
 */

HTTPServer.prototype.initRouter = function initRouter() {
  this.use(this.cors());

  if (!this.options.noAuth) {
    this.use(this.basicAuth({
      password: this.options.apiKey,
      realm: 'node'
    }));
  }

  this.use(this.bodyParser({
    contentType: 'json'
  }));

  this.use(this.jsonRPC(this.rpc));

  this.get('/', co( /*#__PURE__*/_regenerator2.default.mark(function _callee(req, res) {
    var totalTX, size, addr;
    return _regenerator2.default.wrap(function _callee$(_context) {
      while (1) {
        switch (_context.prev = _context.next) {
          case 0:
            totalTX = this.mempool ? this.mempool.totalTX : 0;
            size = this.mempool ? this.mempool.getSize() : 0;
            addr = this.pool.hosts.getLocal();


            if (!addr) addr = this.pool.hosts.address;

            res.send(200, {
              version: pkg.version,
              network: this.network.type,
              chain: {
                height: this.chain.height,
                tip: this.chain.tip.rhash(),
                progress: this.chain.getProgress()
              },
              pool: {
                host: addr.host,
                port: addr.port,
                agent: this.pool.options.agent,
                services: this.pool.options.services.toString(2),
                outbound: this.pool.peers.outbound,
                inbound: this.pool.peers.inbound
              },
              mempool: {
                tx: totalTX,
                size: size
              },
              time: {
                uptime: this.node.uptime(),
                system: util.now(),
                adjusted: this.network.now(),
                offset: this.network.time.offset
              },
              memory: util.memoryUsage()
            });

          case 5:
          case 'end':
            return _context.stop();
        }
      }
    }, _callee, this);
  })));

  // UTXO by address
  this.get('/coin/address/:address', co( /*#__PURE__*/_regenerator2.default.mark(function _callee2(req, res) {
    var valid, address, result, i, coins, coin;
    return _regenerator2.default.wrap(function _callee2$(_context2) {
      while (1) {
        switch (_context2.prev = _context2.next) {
          case 0:
            valid = req.valid();
            address = valid.str('address');
            result = [];


            enforce(address, 'Address is required.');
            enforce(!this.chain.options.spv, 'Cannot get coins in SPV mode.');

            _context2.next = 7;
            return this.node.getCoinsByAddress(address);

          case 7:
            coins = _context2.sent;


            for (i = 0; i < coins.length; i++) {
              coin = coins[i];
              result.push(coin.getJSON(this.network));
            }

            res.send(200, result);

          case 10:
          case 'end':
            return _context2.stop();
        }
      }
    }, _callee2, this);
  })));

  // UTXO by id
  this.get('/coin/:hash/:index', co( /*#__PURE__*/_regenerator2.default.mark(function _callee3(req, res) {
    var valid, hash, index, coin;
    return _regenerator2.default.wrap(function _callee3$(_context3) {
      while (1) {
        switch (_context3.prev = _context3.next) {
          case 0:
            valid = req.valid();
            hash = valid.hash('hash');
            index = valid.u32('index');


            enforce(hash, 'Hash is required.');
            enforce(index != null, 'Index is required.');
            enforce(!this.chain.options.spv, 'Cannot get coins in SPV mode.');

            _context3.next = 8;
            return this.node.getCoin(hash, index);

          case 8:
            coin = _context3.sent;

            if (coin) {
              _context3.next = 12;
              break;
            }

            res.send(404);
            return _context3.abrupt('return');

          case 12:

            res.send(200, coin.getJSON(this.network));

          case 13:
          case 'end':
            return _context3.stop();
        }
      }
    }, _callee3, this);
  })));

  // Bulk read UTXOs
  this.post('/coin/address', co( /*#__PURE__*/_regenerator2.default.mark(function _callee4(req, res) {
    var valid, address, result, i, coins, coin;
    return _regenerator2.default.wrap(function _callee4$(_context4) {
      while (1) {
        switch (_context4.prev = _context4.next) {
          case 0:
            valid = req.valid();
            address = valid.array('addresses');
            result = [];


            enforce(address, 'Address is required.');
            enforce(!this.chain.options.spv, 'Cannot get coins in SPV mode.');

            _context4.next = 7;
            return this.node.getCoinsByAddress(address);

          case 7:
            coins = _context4.sent;


            for (i = 0; i < coins.length; i++) {
              coin = coins[i];
              result.push(coin.getJSON(this.network));
            }

            res.send(200, result);

          case 10:
          case 'end':
            return _context4.stop();
        }
      }
    }, _callee4, this);
  })));

  // TX by hash
  this.get('/tx/:hash', co( /*#__PURE__*/_regenerator2.default.mark(function _callee5(req, res) {
    var valid, hash, meta, view;
    return _regenerator2.default.wrap(function _callee5$(_context5) {
      while (1) {
        switch (_context5.prev = _context5.next) {
          case 0:
            valid = req.valid();
            hash = valid.hash('hash');


            enforce(hash, 'Hash is required.');
            enforce(!this.chain.options.spv, 'Cannot get TX in SPV mode.');

            _context5.next = 6;
            return this.node.getMeta(hash);

          case 6:
            meta = _context5.sent;

            if (meta) {
              _context5.next = 10;
              break;
            }

            res.send(404);
            return _context5.abrupt('return');

          case 10:
            _context5.next = 12;
            return this.node.getMetaView(meta);

          case 12:
            view = _context5.sent;


            res.send(200, meta.getJSON(this.network, view));

          case 14:
          case 'end':
            return _context5.stop();
        }
      }
    }, _callee5, this);
  })));

  // TX by address
  this.get('/tx/address/:address', co( /*#__PURE__*/_regenerator2.default.mark(function _callee6(req, res) {
    var valid, address, result, i, metas, meta, view;
    return _regenerator2.default.wrap(function _callee6$(_context6) {
      while (1) {
        switch (_context6.prev = _context6.next) {
          case 0:
            valid = req.valid();
            address = valid.str('address');
            result = [];


            enforce(address, 'Address is required.');
            enforce(!this.chain.options.spv, 'Cannot get TX in SPV mode.');

            _context6.next = 7;
            return this.node.getMetaByAddress(address);

          case 7:
            metas = _context6.sent;
            i = 0;

          case 9:
            if (!(i < metas.length)) {
              _context6.next = 18;
              break;
            }

            meta = metas[i];
            _context6.next = 13;
            return this.node.getMetaView(meta);

          case 13:
            view = _context6.sent;

            result.push(meta.getJSON(this.network, view));

          case 15:
            i++;
            _context6.next = 9;
            break;

          case 18:

            res.send(200, result);

          case 19:
          case 'end':
            return _context6.stop();
        }
      }
    }, _callee6, this);
  })));

  // Bulk read TXs
  this.post('/tx/address', co( /*#__PURE__*/_regenerator2.default.mark(function _callee7(req, res) {
    var valid, address, result, i, metas, meta, view;
    return _regenerator2.default.wrap(function _callee7$(_context7) {
      while (1) {
        switch (_context7.prev = _context7.next) {
          case 0:
            valid = req.valid();
            address = valid.array('address');
            result = [];


            enforce(address, 'Address is required.');
            enforce(!this.chain.options.spv, 'Cannot get TX in SPV mode.');

            _context7.next = 7;
            return this.node.getMetaByAddress(address);

          case 7:
            metas = _context7.sent;
            i = 0;

          case 9:
            if (!(i < metas.length)) {
              _context7.next = 18;
              break;
            }

            meta = metas[i];
            _context7.next = 13;
            return this.node.getMetaView(meta);

          case 13:
            view = _context7.sent;

            result.push(meta.getJSON(this.network, view));

          case 15:
            i++;
            _context7.next = 9;
            break;

          case 18:

            res.send(200, result);

          case 19:
          case 'end':
            return _context7.stop();
        }
      }
    }, _callee7, this);
  })));

  // Block by hash/height
  this.get('/block/:block', co( /*#__PURE__*/_regenerator2.default.mark(function _callee8(req, res) {
    var valid, hash, block, view, height;
    return _regenerator2.default.wrap(function _callee8$(_context8) {
      while (1) {
        switch (_context8.prev = _context8.next) {
          case 0:
            valid = req.valid();
            hash = valid.get('block');


            enforce(typeof hash === 'string', 'Hash or height required.');
            enforce(!this.chain.options.spv, 'Cannot get block in SPV mode.');

            if (hash.length === 64) hash = util.revHex(hash);else hash = +hash;

            _context8.next = 7;
            return this.chain.db.getBlock(hash);

          case 7:
            block = _context8.sent;

            if (block) {
              _context8.next = 11;
              break;
            }

            res.send(404);
            return _context8.abrupt('return');

          case 11:
            _context8.next = 13;
            return this.chain.db.getBlockView(block);

          case 13:
            view = _context8.sent;

            if (view) {
              _context8.next = 17;
              break;
            }

            res.send(404);
            return _context8.abrupt('return');

          case 17:
            _context8.next = 19;
            return this.chain.db.getHeight(hash);

          case 19:
            height = _context8.sent;


            res.send(200, block.getJSON(this.network, view, height));

          case 21:
          case 'end':
            return _context8.stop();
        }
      }
    }, _callee8, this);
  })));

  // Mempool snapshot
  this.get('/mempool', co( /*#__PURE__*/_regenerator2.default.mark(function _callee9(req, res) {
    var result, i, hash, hashes;
    return _regenerator2.default.wrap(function _callee9$(_context9) {
      while (1) {
        switch (_context9.prev = _context9.next) {
          case 0:
            result = [];


            enforce(this.mempool, 'No mempool available.');

            hashes = this.mempool.getSnapshot();

            for (i = 0; i < hashes.length; i++) {
              hash = hashes[i];
              result.push(util.revHex(hash));
            }

            res.send(200, result);

          case 5:
          case 'end':
            return _context9.stop();
        }
      }
    }, _callee9, this);
  })));

  // Broadcast TX
  this.post('/broadcast', co( /*#__PURE__*/_regenerator2.default.mark(function _callee10(req, res) {
    var valid, tx;
    return _regenerator2.default.wrap(function _callee10$(_context10) {
      while (1) {
        switch (_context10.prev = _context10.next) {
          case 0:
            valid = req.valid();
            tx = valid.buf('tx');

            enforce(tx, 'TX is required.');
            _context10.next = 5;
            return this.node.sendTX(tx);

          case 5:
            res.send(200, { success: true });

          case 6:
          case 'end':
            return _context10.stop();
        }
      }
    }, _callee10, this);
  })));

  // Estimate fee
  this.get('/fee', function (req, res) {
    var valid = req.valid();
    var blocks = valid.u32('blocks');
    var fee;

    if (!this.fees) {
      res.send(200, { rate: Amount.btc(this.network.feeRate) });
      return;
    }

    fee = this.fees.estimateFee(blocks);

    res.send(200, { rate: Amount.btc(fee) });
  });

  // Reset chain
  this.post('/reset', co( /*#__PURE__*/_regenerator2.default.mark(function _callee11(req, res) {
    var valid, height;
    return _regenerator2.default.wrap(function _callee11$(_context11) {
      while (1) {
        switch (_context11.prev = _context11.next) {
          case 0:
            valid = req.valid();
            height = valid.u32('height');


            enforce(height != null, 'Height is required.');

            _context11.next = 5;
            return this.chain.reset(height);

          case 5:

            res.send(200, { success: true });

          case 6:
          case 'end':
            return _context11.stop();
        }
      }
    }, _callee11, this);
  })));
};

/**
 * Initialize websockets.
 * @private
 */

HTTPServer.prototype.initSockets = function initSockets() {
  var self = this;

  if (!this.io) return;

  this.on('socket', function (socket) {
    self.handleSocket(socket);
  });
};

/**
 * Handle new websocket.
 * @private
 * @param {WebSocket} socket
 */

HTTPServer.prototype.handleSocket = function handleSocket(socket) {
  socket.hook('auth', function (args) {
    var valid = new Validator([args]);
    var hash = this.options.apiHash;
    var key = valid.str(0);

    if (socket.auth) throw new Error('Already authed.');

    if (!this.options.noAuth) {
      if (!crypto.ccmp(hash256(key), hash)) throw new Error('Bad key.');
    }

    socket.auth = true;

    this.logger.info('Successful auth from %s.', socket.remoteAddress);
    this.handleAuth(socket);

    return null;
  });

  socket.emit('version', {
    version: pkg.version,
    network: this.network.type
  });
};

/**
 * Handle new auth'd websocket.
 * @private
 * @param {WebSocket} socket
 */

HTTPServer.prototype.handleAuth = function handleAuth(socket) {
  socket.hook('watch chain', function (args) {
    socket.join('chain');
    return null;
  });

  socket.hook('unwatch chain', function (args) {
    socket.leave('chain');
    return null;
  });

  socket.hook('watch mempool', function (args) {
    socket.join('mempool');
    return null;
  });

  socket.hook('unwatch mempool', function (args) {
    socket.leave('mempool');
    return null;
  });

  socket.hook('set filter', function (args) {
    var valid = new Validator([args]);
    var data = valid.buf(0);

    if (!data) throw new Error('Invalid parameter.');

    socket.filter = Bloom.fromRaw(data);

    return null;
  });

  socket.hook('get tip', function (args) {
    return this.chain.tip.toRaw();
  });

  socket.hook('get entry', co( /*#__PURE__*/_regenerator2.default.mark(function _callee12(args) {
    var valid, block, entry;
    return _regenerator2.default.wrap(function _callee12$(_context12) {
      while (1) {
        switch (_context12.prev = _context12.next) {
          case 0:
            valid = new Validator([args]);
            block = valid.numhash(0);

            if (!(block == null)) {
              _context12.next = 4;
              break;
            }

            throw new Error('Invalid parameter.');

          case 4:
            _context12.next = 6;
            return this.chain.db.getEntry(block);

          case 6:
            entry = _context12.sent;
            _context12.next = 9;
            return entry.isMainChain();

          case 9:
            if (_context12.sent) {
              _context12.next = 11;
              break;
            }

            entry = null;

          case 11:
            if (entry) {
              _context12.next = 13;
              break;
            }

            return _context12.abrupt('return', null);

          case 13:
            return _context12.abrupt('return', entry.toRaw());

          case 14:
          case 'end':
            return _context12.stop();
        }
      }
    }, _callee12, this);
  })));

  socket.hook('add filter', function (args) {
    var valid = new Validator([args]);
    var chunks = valid.array(0);
    var i, data;

    if (!chunks) throw new Error('Invalid parameter.');

    if (!socket.filter) throw new Error('No filter set.');

    valid = new Validator([chunks]);

    for (i = 0; i < chunks.length; i++) {
      data = valid.buf(i);

      if (!data) throw new Error('Bad data chunk.');

      this.filter.add(data);

      if (this.node.spv) this.pool.watch(data);
    }

    return null;
  });

  socket.hook('reset filter', function (args) {
    socket.filter = null;
    return null;
  });

  socket.hook('estimate fee', function (args) {
    var valid = new Validator([args]);
    var blocks = valid.u32(0);
    var rate;

    if (!this.fees) {
      rate = this.network.feeRate;
      rate = Amount.btc(rate);
      return rate;
    }

    rate = this.fees.estimateFee(blocks);
    rate = Amount.btc(rate);

    return rate;
  });

  socket.hook('send', function (args) {
    var valid = new Validator([args]);
    var data = valid.buf(0);
    var tx;

    if (!data) throw new Error('Invalid parameter.');

    tx = TX.fromRaw(data);

    this.node.send(tx);

    return null;
  });

  socket.hook('rescan', function (args) {
    var valid = new Validator([args]);
    var start = valid.numhash(0);

    if (start == null) throw new Error('Invalid parameter.');

    return this.scan(socket, start);
  });

  this.bindChain();
};

/**
 * Bind to chain events.
 * @private
 */

HTTPServer.prototype.bindChain = function bindChain() {
  var self = this;
  var pool = this.mempool || this.pool;

  this.chain.on('connect', function (entry, block, view) {
    var list = self.channel('chain');
    var item, socket, raw, txs;

    if (!list) return;

    raw = entry.toRaw();

    self.to('chain', 'chain connect', raw);

    for (item = list.head; item; item = item.next) {
      socket = item.value;
      txs = self.filterBlock(socket, block);
      socket.emit('block connect', raw, txs);
    }
  });

  this.chain.on('disconnect', function (entry, block, view) {
    var list = self.channel('chain');
    var raw;

    if (!list) return;

    raw = entry.toRaw();

    self.to('chain', 'chain disconnect', raw);
    self.to('chain', 'block disconnect', raw);
  });

  this.chain.on('reset', function (tip) {
    var list = self.channel('chain');
    var raw;

    if (!list) return;

    raw = tip.toRaw();

    self.to('chain', 'chain reset', raw);
  });

  pool.on('tx', function (tx) {
    var list = self.channel('mempool');
    var item, socket, raw;

    if (!list) return;

    raw = tx.toRaw();

    for (item = list.head; item; item = item.next) {
      socket = item.value;

      if (!self.filterTX(socket, tx)) continue;

      socket.emit('tx', raw);
    }
  });
};

/**
 * Filter block by socket.
 * @private
 * @param {WebSocket} socket
 * @param {Block} block
 * @returns {TX[]}
 */

HTTPServer.prototype.filterBlock = function filterBlock(socket, block) {
  var txs = [];
  var i, tx;

  if (!socket.filter) return txs;

  for (i = 0; i < block.txs.length; i++) {
    tx = block.txs[i];
    if (this.filterTX(socket, tx)) txs.push(tx.toRaw());
  }

  return txs;
};

/**
 * Filter transaction by socket.
 * @private
 * @param {WebSocket} socket
 * @param {TX} tx
 * @returns {Boolean}
 */

HTTPServer.prototype.filterTX = function filterTX(socket, tx) {
  var found = false;
  var i, hash, input, prevout, output;

  if (!socket.filter) return false;

  for (i = 0; i < tx.outputs.length; i++) {
    output = tx.outputs[i];
    hash = output.getHash();

    if (!hash) continue;

    if (socket.filter.test(hash)) {
      prevout = Outpoint.fromTX(tx, i);
      socket.filter.add(prevout.toRaw());
      found = true;
    }
  }

  if (found) return true;

  if (!tx.isCoinbase()) {
    for (i = 0; i < tx.inputs.length; i++) {
      input = tx.inputs[i];
      prevout = input.prevout;
      if (socket.filter.test(prevout.toRaw())) return true;
    }
  }

  return false;
};

/**
 * Scan using a socket's filter.
 * @private
 * @param {WebSocket} socket
 * @param {Hash} start
 * @returns {Promise}
 */

HTTPServer.prototype.scan = co( /*#__PURE__*/_regenerator2.default.mark(function scan(socket, start) {
  var scanner;
  return _regenerator2.default.wrap(function scan$(_context13) {
    while (1) {
      switch (_context13.prev = _context13.next) {
        case 0:
          scanner = this.scanner.bind(this, socket);
          _context13.next = 3;
          return this.node.scan(start, socket.filter, scanner);

        case 3:
          return _context13.abrupt('return', null);

        case 4:
        case 'end':
          return _context13.stop();
      }
    }
  }, scan, this);
}));

/**
 * Handle rescan iteration.
 * @private
 * @param {WebSocket} socket
 * @param {ChainEntry} entry
 * @param {TX[]} txs
 * @returns {Promise}
 */

HTTPServer.prototype.scanner = function scanner(socket, entry, txs) {
  var block = entry.toRaw();
  var raw = [];
  var i, tx;

  for (i = 0; i < txs.length; i++) {
    tx = txs[i];
    raw.push(tx.toRaw());
  }

  socket.emit('block rescan', block, raw);

  return _promise2.default.resolve();
};

/**
 * HTTPOptions
 * @alias module:http.HTTPOptions
 * @constructor
 * @param {Object} options
 */

function HTTPOptions(options) {
  if (!(this instanceof HTTPOptions)) return new HTTPOptions(options);

  this.network = Network.primary;
  this.logger = null;
  this.node = null;
  this.apiKey = base58.encode(crypto.randomBytes(20));
  this.apiHash = hash256(this.apiKey);
  this.noAuth = false;

  this.prefix = null;
  this.host = '127.0.0.1';
  this.port = 8080;
  this.ssl = false;
  this.keyFile = null;
  this.certFile = null;

  this.fromOptions(options);
}

/**
 * Inject properties from object.
 * @private
 * @param {Object} options
 * @returns {HTTPOptions}
 */

HTTPOptions.prototype.fromOptions = function fromOptions(options) {
  assert(options);
  assert(options.node && (0, _typeof3.default)(options.node) === 'object', 'HTTP Server requires a Node.');

  this.node = options.node;
  this.network = options.node.network;
  this.logger = options.node.logger;

  this.port = this.network.rpcPort;

  if (options.logger != null) {
    assert((0, _typeof3.default)(options.logger) === 'object');
    this.logger = options.logger;
  }

  if (options.apiKey != null) {
    assert(typeof options.apiKey === 'string', 'API key must be a string.');
    assert(options.apiKey.length <= 200, 'API key must be under 200 bytes.');
    this.apiKey = options.apiKey;
    this.apiHash = hash256(this.apiKey);
  }

  if (options.noAuth != null) {
    assert(typeof options.noAuth === 'boolean');
    this.noAuth = options.noAuth;
  }

  if (options.prefix != null) {
    assert(typeof options.prefix === 'string');
    this.prefix = options.prefix;
    this.keyFile = this.prefix + '/key.pem';
    this.certFile = this.prefix + '/cert.pem';
  }

  if (options.host != null) {
    assert(typeof options.host === 'string');
    this.host = options.host;
  }

  if (options.port != null) {
    assert(typeof options.port === 'number', 'Port must be a number.');
    assert(options.port > 0 && options.port <= 0xffff);
    this.port = options.port;
  }

  if (options.ssl != null) {
    assert(typeof options.ssl === 'boolean');
    this.ssl = options.ssl;
  }

  if (options.keyFile != null) {
    assert(typeof options.keyFile === 'string');
    this.keyFile = options.keyFile;
  }

  if (options.certFile != null) {
    assert(typeof options.certFile === 'string');
    this.certFile = options.certFile;
  }

  // Allow no-auth implicitly
  // if we're listening locally.
  if (!options.apiKey) {
    if (this.host === '127.0.0.1' || this.host === '::1') this.noAuth = true;
  }

  return this;
};

/**
 * Instantiate http options from object.
 * @param {Object} options
 * @returns {HTTPOptions}
 */

HTTPOptions.fromOptions = function fromOptions(options) {
  return new HTTPOptions().fromOptions(options);
};

/*
 * Helpers
 */

function hash256(data) {
  if (typeof data !== 'string') return Buffer.alloc(0);

  if (data.length > 200) return Buffer.alloc(0);

  return crypto.hash256(Buffer.from(data, 'utf8'));
}

function enforce(value, msg) {
  var err;

  if (!value) {
    err = new Error(msg);
    err.statusCode = 400;
    throw err;
  }
}

/*
 * Expose
 */

module.exports = HTTPServer;