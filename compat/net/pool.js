/*!
 * pool.js - peer management for bcoin
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
var EventEmitter = require('events').EventEmitter;
var AsyncObject = require('../utils/asyncobject');
var util = require('../utils/util');
var IP = require('../utils/ip');
var co = require('../utils/co');
var common = require('./common');
var chainCommon = require('../blockchain/common');
var Address = require('../primitives/address');
var BIP150 = require('./bip150');
var BIP151 = require('./bip151');
var BIP152 = require('./bip152');
var Bloom = require('../utils/bloom');
var ec = require('../crypto/ec');
var Lock = require('../utils/lock');
var Network = require('../protocol/network');
var Peer = require('./peer');
var request = require('../http/request');
var List = require('../utils/list');
var tcp = require('./tcp');
var dns = require('./dns');
var HostList = require('./hostlist');
var UPNP = require('./upnp');
var InvItem = require('../primitives/invitem');
var Map = require('../utils/map');
var packets = require('./packets');
var services = common.services;
var invTypes = InvItem.types;
var packetTypes = packets.types;
var scores = HostList.scores;

/**
 * A pool of peers for handling all network activity.
 * @alias module:net.Pool
 * @constructor
 * @param {Object} options
 * @param {Chain} options.chain
 * @param {Mempool?} options.mempool
 * @param {Number?} [options.maxOutbound=8] - Maximum number of peers.
 * @param {Boolean?} options.spv - Do an SPV sync.
 * @param {Boolean?} options.noRelay - Whether to ask
 * for relayed transactions.
 * @param {Number?} [options.feeRate] - Fee filter rate.
 * @param {Number?} [options.invTimeout=60000] - Timeout for broadcasted
 * objects.
 * @param {Boolean?} options.listen - Whether to spin up a server socket
 * and listen for peers.
 * @param {Boolean?} options.selfish - A selfish pool. Will not serve blocks,
 * headers, hashes, utxos, or transactions to peers.
 * @param {Boolean?} options.broadcast - Whether to automatically broadcast
 * transactions accepted to our mempool.
 * @param {String[]} options.seeds
 * @param {Function?} options.createSocket - Custom function to create a socket.
 * Must accept (port, host) and return a node-like socket.
 * @param {Function?} options.createServer - Custom function to create a server.
 * Must return a node-like server.
 * @emits Pool#block
 * @emits Pool#tx
 * @emits Pool#peer
 * @emits Pool#open
 * @emits Pool#close
 * @emits Pool#error
 * @emits Pool#reject
 */

function Pool(options) {
  if (!(this instanceof Pool)) return new Pool(options);

  AsyncObject.call(this);

  this.options = new PoolOptions(options);

  this.network = this.options.network;
  this.logger = this.options.logger.context('net');
  this.chain = this.options.chain;
  this.mempool = this.options.mempool;
  this.server = this.options.createServer();
  this.nonces = this.options.nonces;

  this.locker = new Lock(true);
  this.connected = false;
  this.disconnecting = false;
  this.syncing = false;
  this.spvFilter = null;
  this.txFilter = null;
  this.blockMap = new Map();
  this.txMap = new Map();
  this.compactBlocks = new Map();
  this.invMap = new Map();
  this.pendingFilter = null;
  this.pendingRefill = null;

  this.checkpoints = false;
  this.headerChain = new List();
  this.headerNext = null;
  this.headerTip = null;
  this.headerFails = 0;

  this.peers = new PeerList();
  this.authdb = new BIP150.AuthDB(this.options);
  this.hosts = new HostList(this.options);
  this.id = 0;

  if (this.options.spv) this.spvFilter = Bloom.fromRate(20000, 0.001, Bloom.flags.ALL);

  if (!this.options.mempool) this.txFilter = new Bloom.Rolling(50000, 0.000001);

  this._init();
};

util.inherits(Pool, AsyncObject);

/**
 * Max number of header chain failures
 * before disabling checkpoints.
 * @const {Number}
 * @default
 */

Pool.MAX_HEADER_FAILS = 1000;

/**
 * Discovery interval for UPNP and DNS seeds.
 * @const {Number}
 * @default
 */

Pool.DISCOVERY_INTERVAL = 120000;

/**
 * Initialize the pool.
 * @private
 */

Pool.prototype._init = function _init() {
  var self = this;

  this.server.on('error', function (err) {
    self.emit('error', err);
  });

  this.server.on('connection', function (socket) {
    self.handleSocket(socket);
    self.emit('connection', socket);
  });

  this.server.on('listening', function () {
    var data = self.server.address();
    self.logger.info('Pool server listening on %s (port=%d).', data.address, data.port);
    self.emit('listening', data);
  });

  this.chain.on('block', function (block, entry) {
    self.emit('block', block, entry);
  });

  this.chain.on('reset', function () {
    if (self.checkpoints) self.resetChain();
    self.forceSync();
  });

  this.chain.on('full', function () {
    self.sync();
    self.emit('full');
    self.logger.info('Chain is fully synced (height=%d).', self.chain.height);
  });

  if (this.mempool) {
    this.mempool.on('tx', function (tx) {
      self.emit('tx', tx);
    });
  }

  if (!this.options.selfish && !this.options.spv) {
    if (this.mempool) {
      this.mempool.on('tx', function (tx) {
        self.announceTX(tx);
      });

      this.mempool.on('bad orphan', function (err, id) {
        self.handleBadOrphan('tx', err, id);
      });
    }

    // Normally we would also broadcast
    // competing chains, but we want to
    // avoid getting banned if an evil
    // miner sends us an invalid competing
    // chain that we can't connect and
    // verify yet.
    this.chain.on('block', function (block) {
      if (!self.chain.synced) return;
      self.announceBlock(block);
    });

    this.chain.on('bad orphan', function (err, id) {
      self.handleBadOrphan('block', err, id);
    });
  }
};

/**
 * Open the pool, wait for the chain to load.
 * @method
 * @alias Pool#open
 * @returns {Promise}
 */

Pool.prototype._open = co( /*#__PURE__*/_regenerator2.default.mark(function _open() {
  var key;
  return _regenerator2.default.wrap(function _open$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:
          if (!this.mempool) {
            _context.next = 5;
            break;
          }

          _context.next = 3;
          return this.mempool.open();

        case 3:
          _context.next = 7;
          break;

        case 5:
          _context.next = 7;
          return this.chain.open();

        case 7:

          this.logger.info('Pool loaded (maxpeers=%d).', this.options.maxOutbound);

          if (this.options.bip150) {
            key = ec.publicKeyCreate(this.options.identityKey, true);
            this.logger.info('Identity public key: %s.', key.toString('hex'));
            this.logger.info('Identity address: %s.', BIP150.address(key));
          }

          this.resetChain();

        case 10:
        case 'end':
          return _context.stop();
      }
    }
  }, _open, this);
}));

/**
 * Reset header chain.
 */

Pool.prototype.resetChain = function resetChain() {
  var tip = this.chain.tip;

  if (!this.options.checkpoints) return;

  this.checkpoints = false;
  this.chain.checkpoints = false;
  this.headerTip = null;
  this.headerChain.reset();
  this.headerNext = null;

  if (tip.height < this.network.lastCheckpoint) {
    this.checkpoints = true;
    this.chain.checkpoints = true;
    this.headerTip = this.getNextTip(tip.height);
    this.headerChain.push(new HeaderEntry(tip.hash, tip.height));
    this.logger.info('Initialized header chain to height %d (checkpoint=%s).', tip.height, util.revHex(this.headerTip.hash));
  }
};

/**
 * Close and destroy the pool.
 * @method
 * @alias Pool#close
 * @returns {Promise}
 */

Pool.prototype._close = co( /*#__PURE__*/_regenerator2.default.mark(function close() {
  return _regenerator2.default.wrap(function close$(_context2) {
    while (1) {
      switch (_context2.prev = _context2.next) {
        case 0:
          _context2.next = 2;
          return this.disconnect();

        case 2:
        case 'end':
          return _context2.stop();
      }
    }
  }, close, this);
}));

/**
 * Connect to the network.
 * @method
 * @returns {Promise}
 */

Pool.prototype.connect = co( /*#__PURE__*/_regenerator2.default.mark(function connect() {
  var unlock;
  return _regenerator2.default.wrap(function connect$(_context3) {
    while (1) {
      switch (_context3.prev = _context3.next) {
        case 0:
          _context3.next = 2;
          return this.locker.lock();

        case 2:
          unlock = _context3.sent;
          _context3.prev = 3;
          _context3.next = 6;
          return this._connect();

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
  }, connect, this, [[3,, 7, 10]]);
}));

/**
 * Connect to the network (no lock).
 * @method
 * @returns {Promise}
 */

Pool.prototype._connect = co( /*#__PURE__*/_regenerator2.default.mark(function connect() {
  return _regenerator2.default.wrap(function connect$(_context4) {
    while (1) {
      switch (_context4.prev = _context4.next) {
        case 0:
          assert(this.loaded, 'Pool is not loaded.');

          if (!this.connected) {
            _context4.next = 3;
            break;
          }

          return _context4.abrupt('return');

        case 3:
          _context4.next = 5;
          return this.hosts.open();

        case 5:
          _context4.next = 7;
          return this.authdb.open();

        case 7:
          _context4.next = 9;
          return this.discoverGateway();

        case 9:
          _context4.next = 11;
          return this.discoverExternal();

        case 11:
          _context4.next = 13;
          return this.discoverSeeds();

        case 13:

          this.fillOutbound();

          _context4.next = 16;
          return this.listen();

        case 16:

          this.startTimer();

          this.connected = true;

        case 18:
        case 'end':
          return _context4.stop();
      }
    }
  }, connect, this);
}));

/**
 * Disconnect from the network.
 * @method
 * @returns {Promise}
 */

Pool.prototype.disconnect = co( /*#__PURE__*/_regenerator2.default.mark(function disconnect() {
  var unlock;
  return _regenerator2.default.wrap(function disconnect$(_context5) {
    while (1) {
      switch (_context5.prev = _context5.next) {
        case 0:
          _context5.next = 2;
          return this.locker.lock();

        case 2:
          unlock = _context5.sent;
          _context5.prev = 3;
          _context5.next = 6;
          return this._disconnect();

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
  }, disconnect, this, [[3,, 7, 10]]);
}));

/**
 * Disconnect from the network.
 * @method
 * @returns {Promise}
 */

Pool.prototype._disconnect = co( /*#__PURE__*/_regenerator2.default.mark(function disconnect() {
  var i, item, hashes, hash;
  return _regenerator2.default.wrap(function disconnect$(_context6) {
    while (1) {
      switch (_context6.prev = _context6.next) {
        case 0:

          assert(this.loaded, 'Pool is not loaded.');

          if (this.connected) {
            _context6.next = 3;
            break;
          }

          return _context6.abrupt('return');

        case 3:

          this.disconnecting = true;

          hashes = this.invMap.keys();

          for (i = 0; i < hashes.length; i++) {
            hash = hashes[i];
            item = this.invMap.get(hash);
            item.resolve();
          }

          this.peers.destroy();

          this.blockMap.reset();
          this.txMap.reset();

          if (this.pendingFilter != null) {
            clearTimeout(this.pendingFilter);
            this.pendingFilter = null;
          }

          if (this.pendingRefill != null) {
            clearTimeout(this.pendingRefill);
            this.pendingRefill = null;
          }

          this.checkpoints = false;
          this.chain.checkpoints = false;
          this.headerTip = null;
          this.headerChain.reset();
          this.headerNext = null;

          this.stopTimer();

          _context6.next = 19;
          return this.authdb.close();

        case 19:
          _context6.next = 21;
          return this.hosts.close();

        case 21:
          _context6.next = 23;
          return this.unlisten();

        case 23:

          this.disconnecting = false;
          this.syncing = false;
          this.connected = false;

        case 26:
        case 'end':
          return _context6.stop();
      }
    }
  }, disconnect, this);
}));

/**
 * Start listening on a server socket.
 * @method
 * @private
 * @returns {Promise}
 */

Pool.prototype.listen = co( /*#__PURE__*/_regenerator2.default.mark(function listen() {
  return _regenerator2.default.wrap(function listen$(_context7) {
    while (1) {
      switch (_context7.prev = _context7.next) {
        case 0:
          assert(this.server);
          assert(!this.connected, 'Already listening.');

          if (this.options.listen) {
            _context7.next = 4;
            break;
          }

          return _context7.abrupt('return');

        case 4:

          this.server.maxConnections = this.options.maxInbound;

          _context7.next = 7;
          return this.server.listen(this.options.port, this.options.host);

        case 7:
        case 'end':
          return _context7.stop();
      }
    }
  }, listen, this);
}));

/**
 * Stop listening on server socket.
 * @method
 * @private
 * @returns {Promise}
 */

Pool.prototype.unlisten = co( /*#__PURE__*/_regenerator2.default.mark(function unlisten() {
  return _regenerator2.default.wrap(function unlisten$(_context8) {
    while (1) {
      switch (_context8.prev = _context8.next) {
        case 0:
          assert(this.server);
          assert(this.connected, 'Not listening.');

          if (this.options.listen) {
            _context8.next = 4;
            break;
          }

          return _context8.abrupt('return');

        case 4:
          _context8.next = 6;
          return this.server.close();

        case 6:
        case 'end':
          return _context8.stop();
      }
    }
  }, unlisten, this);
}));

/**
 * Start discovery timer.
 * @private
 */

Pool.prototype.startTimer = function startTimer() {
  assert(this.timer == null, 'Timer already started.');
  this.timer = co.setInterval(this.discover, Pool.DISCOVERY_INTERVAL, this);
};

/**
 * Stop discovery timer.
 * @private
 */

Pool.prototype.stopTimer = function stopTimer() {
  assert(this.timer != null, 'Timer already stopped.');
  co.clearInterval(this.timer);
  this.timer = null;
};

/**
 * Rediscover seeds and internet gateway.
 * Attempt to add port mapping once again.
 * @returns {Promise}
 */

Pool.prototype.discover = co( /*#__PURE__*/_regenerator2.default.mark(function discover() {
  return _regenerator2.default.wrap(function discover$(_context9) {
    while (1) {
      switch (_context9.prev = _context9.next) {
        case 0:
          _context9.next = 2;
          return this.discoverGateway();

        case 2:
          _context9.next = 4;
          return this.discoverSeeds(true);

        case 4:
        case 'end':
          return _context9.stop();
      }
    }
  }, discover, this);
}));

/**
 * Attempt to add port mapping (i.e.
 * remote:8333->local:8333) via UPNP.
 * @returns {Promise}
 */

Pool.prototype.discoverGateway = co( /*#__PURE__*/_regenerator2.default.mark(function discoverGateway() {
  var src, dest, wan, host;
  return _regenerator2.default.wrap(function discoverGateway$(_context10) {
    while (1) {
      switch (_context10.prev = _context10.next) {
        case 0:
          src = this.options.publicPort;
          dest = this.options.port;

          if (this.options.listen) {
            _context10.next = 4;
            break;
          }

          return _context10.abrupt('return');

        case 4:
          if (this.options.upnp) {
            _context10.next = 6;
            break;
          }

          return _context10.abrupt('return');

        case 6:
          _context10.prev = 6;

          this.logger.debug('Discovering internet gateway (upnp).');
          _context10.next = 10;
          return UPNP.discover();

        case 10:
          wan = _context10.sent;
          _context10.next = 18;
          break;

        case 13:
          _context10.prev = 13;
          _context10.t0 = _context10['catch'](6);

          this.logger.debug('Could not discover internet gateway (upnp).');
          this.logger.debug(_context10.t0);
          return _context10.abrupt('return', false);

        case 18:
          _context10.prev = 18;
          _context10.next = 21;
          return wan.getExternalIP();

        case 21:
          host = _context10.sent;
          _context10.next = 29;
          break;

        case 24:
          _context10.prev = 24;
          _context10.t1 = _context10['catch'](18);

          this.logger.debug('Could not find external IP (upnp).');
          this.logger.debug(_context10.t1);
          return _context10.abrupt('return', false);

        case 29:

          if (this.hosts.addLocal(host, src, scores.UPNP)) this.logger.info('External IP found (upnp): %s.', host);

          this.logger.debug('Adding port mapping %d->%d.', src, dest);

          _context10.prev = 31;
          _context10.next = 34;
          return wan.addPortMapping(host, src, dest);

        case 34:
          _context10.next = 41;
          break;

        case 36:
          _context10.prev = 36;
          _context10.t2 = _context10['catch'](31);

          this.logger.debug('Could not add port mapping (upnp).');
          this.logger.debug(_context10.t2);
          return _context10.abrupt('return', false);

        case 41:
          return _context10.abrupt('return', true);

        case 42:
        case 'end':
          return _context10.stop();
      }
    }
  }, discoverGateway, this, [[6, 13], [18, 24], [31, 36]]);
}));

/**
 * Attempt to resolve DNS seeds if necessary.
 * @param {Boolean} checkPeers
 * @returns {Promise}
 */

Pool.prototype.discoverSeeds = co( /*#__PURE__*/_regenerator2.default.mark(function discoverSeeds(checkPeers) {
  var max, size, total, peer;
  return _regenerator2.default.wrap(function discoverSeeds$(_context11) {
    while (1) {
      switch (_context11.prev = _context11.next) {
        case 0:
          max = Math.min(2, this.options.maxOutbound);
          size = this.hosts.size();
          total = 0;

          if (!(this.hosts.dnsSeeds.length === 0)) {
            _context11.next = 5;
            break;
          }

          return _context11.abrupt('return');

        case 5:
          peer = this.peers.head();

        case 6:
          if (!peer) {
            _context11.next = 15;
            break;
          }

          if (peer.outbound) {
            _context11.next = 9;
            break;
          }

          return _context11.abrupt('continue', 12);

        case 9:
          if (!peer.connected) {
            _context11.next = 12;
            break;
          }

          if (!(++total > max)) {
            _context11.next = 12;
            break;
          }

          return _context11.abrupt('break', 15);

        case 12:
          peer = peer.next;
          _context11.next = 6;
          break;

        case 15:
          if (!(size === 0 || checkPeers && total < max)) {
            _context11.next = 22;
            break;
          }

          this.logger.warning('Could not find enough peers.');
          this.logger.warning('Hitting DNS seeds...');

          _context11.next = 20;
          return this.hosts.discoverSeeds();

        case 20:

          this.logger.info('Resolved %d hosts from DNS seeds.', this.hosts.size() - size);

          this.refill();

        case 22:
        case 'end':
          return _context11.stop();
      }
    }
  }, discoverSeeds, this);
}));

/**
 * Attempt to discover external IP via HTTP.
 * @returns {Promise}
 */

Pool.prototype.discoverExternal = co( /*#__PURE__*/_regenerator2.default.mark(function discoverExternal() {
  var port, host;
  return _regenerator2.default.wrap(function discoverExternal$(_context12) {
    while (1) {
      switch (_context12.prev = _context12.next) {
        case 0:
          port = this.options.publicPort;

          if (this.options.listen) {
            _context12.next = 3;
            break;
          }

          return _context12.abrupt('return');

        case 3:
          if (!this.options.proxy) {
            _context12.next = 5;
            break;
          }

          return _context12.abrupt('return');

        case 5:
          if (!(this.hosts.local.size > 0)) {
            _context12.next = 7;
            break;
          }

          return _context12.abrupt('return');

        case 7:
          _context12.prev = 7;
          _context12.next = 10;
          return this.getIP();

        case 10:
          host = _context12.sent;
          _context12.next = 18;
          break;

        case 13:
          _context12.prev = 13;
          _context12.t0 = _context12['catch'](7);

          this.logger.debug('Could not find external IP (http).');
          this.logger.debug(_context12.t0);
          return _context12.abrupt('return');

        case 18:

          if (this.hosts.addLocal(host, port, scores.HTTP)) this.logger.info('External IP found (http): %s.', host);

        case 19:
        case 'end':
          return _context12.stop();
      }
    }
  }, discoverExternal, this, [[7, 13]]);
}));

/**
 * Handle incoming connection.
 * @private
 * @param {net.Socket} socket
 */

Pool.prototype.handleSocket = function handleSocket(socket) {
  var host;

  if (!socket.remoteAddress) {
    this.logger.debug('Ignoring disconnected peer.');
    socket.destroy();
    return;
  }

  host = IP.normalize(socket.remoteAddress);

  if (this.peers.inbound >= this.options.maxInbound) {
    this.logger.debug('Ignoring peer: too many inbound (%s).', host);
    socket.destroy();
    return;
  }

  if (this.hosts.isBanned(host)) {
    this.logger.debug('Ignoring banned peer (%s).', host);
    socket.destroy();
    return;
  }

  host = IP.toHostname(host, socket.remotePort);

  assert(!this.peers.map[host], 'Port collision.');

  this.addInbound(socket);
};

/**
 * Add a loader peer. Necessary for
 * a sync to even begin.
 * @private
 */

Pool.prototype.addLoader = function addLoader() {
  var peer, addr;

  if (!this.loaded) return;

  assert(!this.peers.load);

  for (peer = this.peers.head(); peer; peer = peer.next) {
    if (!peer.outbound) continue;

    this.logger.info('Repurposing peer for loader (%s).', peer.hostname());

    this.setLoader(peer);

    return;
  }

  addr = this.getHost();

  if (!addr) return;

  peer = this.createOutbound(addr);

  this.logger.info('Adding loader peer (%s).', peer.hostname());

  this.peers.add(peer);

  this.setLoader(peer);
};

/**
 * Add a loader peer. Necessary for
 * a sync to even begin.
 * @private
 */

Pool.prototype.setLoader = function setLoader(peer) {
  if (!this.loaded) return;

  assert(peer.outbound);
  assert(!this.peers.load);
  assert(!peer.loader);

  peer.loader = true;
  this.peers.load = peer;

  this.sendSync(peer);

  this.emit('loader', peer);
};

/**
 * Start the blockchain sync.
 */

Pool.prototype.startSync = function startSync() {
  if (!this.loaded) return;

  assert(this.connected, 'Pool is not connected!');

  this.syncing = true;
  this.resync(false);
};

/**
 * Force sending of a sync to each peer.
 */

Pool.prototype.forceSync = function forceSync() {
  if (!this.loaded) return;

  assert(this.connected, 'Pool is not connected!');

  this.resync(true);
};

/**
 * Send a sync to each peer.
 */

Pool.prototype.sync = /*#__PURE__*/_regenerator2.default.mark(function sync(force) {
  return _regenerator2.default.wrap(function sync$(_context13) {
    while (1) {
      switch (_context13.prev = _context13.next) {
        case 0:
          this.resync(false);

        case 1:
        case 'end':
          return _context13.stop();
      }
    }
  }, sync, this);
});

/**
 * Stop the sync.
 * @private
 */

Pool.prototype.stopSync = function stopSync() {
  var peer;

  if (!this.syncing) return;

  this.syncing = false;

  for (peer = this.peers.head(); peer; peer = peer.next) {
    if (!peer.outbound) continue;

    if (!peer.syncing) continue;

    peer.syncing = false;
    peer.merkleBlock = null;
    peer.merkleTime = -1;
    peer.merkleMatches = 0;
    peer.merkleMap = null;
    peer.blockTime = -1;
    peer.blockMap.reset();
    peer.compactBlocks.reset();
  }

  this.blockMap.reset();
  this.compactBlocks.reset();
};

/**
 * Send a sync to each peer.
 * @private
 * @param {Boolean?} force
 * @returns {Promise}
 */

Pool.prototype.resync = co( /*#__PURE__*/_regenerator2.default.mark(function resync(force) {
  var peer, locator;
  return _regenerator2.default.wrap(function resync$(_context14) {
    while (1) {
      switch (_context14.prev = _context14.next) {
        case 0:
          if (this.syncing) {
            _context14.next = 2;
            break;
          }

          return _context14.abrupt('return');

        case 2:
          _context14.prev = 2;
          _context14.next = 5;
          return this.chain.getLocator();

        case 5:
          locator = _context14.sent;
          _context14.next = 12;
          break;

        case 8:
          _context14.prev = 8;
          _context14.t0 = _context14['catch'](2);

          this.emit('error', _context14.t0);
          return _context14.abrupt('return');

        case 12:
          peer = this.peers.head();

        case 13:
          if (!peer) {
            _context14.next = 22;
            break;
          }

          if (peer.outbound) {
            _context14.next = 16;
            break;
          }

          return _context14.abrupt('continue', 19);

        case 16:
          if (!(!force && peer.syncing)) {
            _context14.next = 18;
            break;
          }

          return _context14.abrupt('continue', 19);

        case 18:

          this.sendLocator(locator, peer);

        case 19:
          peer = peer.next;
          _context14.next = 13;
          break;

        case 22:
        case 'end':
          return _context14.stop();
      }
    }
  }, resync, this, [[2, 8]]);
}));

/**
 * Test whether a peer is sync-worthy.
 * @param {Peer} peer
 * @returns {Boolean}
 */

Pool.prototype.isSyncable = function isSyncable(peer) {
  if (!this.syncing) return false;

  if (peer.destroyed) return false;

  if (!peer.handshake) return false;

  if (!(peer.services & services.NETWORK)) return false;

  if (this.options.hasWitness() && !peer.hasWitness()) return false;

  if (!peer.loader) {
    if (!this.chain.synced) return false;
  }

  return true;
};

/**
 * Start syncing from peer.
 * @method
 * @param {Peer} peer
 * @returns {Promise}
 */

Pool.prototype.sendSync = co( /*#__PURE__*/_regenerator2.default.mark(function sendSync(peer) {
  var locator;
  return _regenerator2.default.wrap(function sendSync$(_context15) {
    while (1) {
      switch (_context15.prev = _context15.next) {
        case 0:
          if (!peer.syncing) {
            _context15.next = 2;
            break;
          }

          return _context15.abrupt('return', false);

        case 2:
          if (this.isSyncable(peer)) {
            _context15.next = 4;
            break;
          }

          return _context15.abrupt('return', false);

        case 4:

          peer.syncing = true;
          peer.blockTime = util.ms();

          _context15.prev = 6;
          _context15.next = 9;
          return this.chain.getLocator();

        case 9:
          locator = _context15.sent;
          _context15.next = 18;
          break;

        case 12:
          _context15.prev = 12;
          _context15.t0 = _context15['catch'](6);

          peer.syncing = false;
          peer.blockTime = -1;
          this.emit('error', _context15.t0);
          return _context15.abrupt('return', false);

        case 18:
          return _context15.abrupt('return', this.sendLocator(locator, peer));

        case 19:
        case 'end':
          return _context15.stop();
      }
    }
  }, sendSync, this, [[6, 12]]);
}));

/**
 * Send a chain locator and start syncing from peer.
 * @method
 * @param {Hash[]} locator
 * @param {Peer} peer
 * @returns {Boolean}
 */

Pool.prototype.sendLocator = function sendLocator(locator, peer) {
  if (!this.isSyncable(peer)) return false;

  // Ask for the mempool if we're synced.
  if (this.network.requestMempool) {
    if (peer.loader && this.chain.synced) peer.sendMempool();
  }

  peer.syncing = true;
  peer.blockTime = util.ms();

  if (this.checkpoints) {
    peer.sendGetHeaders(locator, this.headerTip.hash);
    return true;
  }

  peer.sendGetBlocks(locator);

  return true;
};

/**
 * Send `mempool` to all peers.
 */

Pool.prototype.sendMempool = function sendMempool() {
  var peer;

  for (peer = this.peers.head(); peer; peer = peer.next) {
    peer.sendMempool();
  }
};

/**
 * Send `getaddr` to all peers.
 */

Pool.prototype.sendGetAddr = function sendGetAddr() {
  var peer;

  for (peer = this.peers.head(); peer; peer = peer.next) {
    peer.sendGetAddr();
  }
};

/**
 * Request current header chain blocks.
 * @private
 * @param {Peer} peer
 */

Pool.prototype.resolveHeaders = function resolveHeaders(peer) {
  var items = [];
  var node;

  for (node = this.headerNext; node; node = node.next) {
    this.headerNext = node.next;

    items.push(node.hash);

    if (items.length === 50000) break;
  }

  this.getBlock(peer, items);
};

/**
 * Update all peer heights by their best hash.
 * @param {Hash} hash
 * @param {Number} height
 */

Pool.prototype.resolveHeight = function resolveHeight(hash, height) {
  var total = 0;
  var peer;

  for (peer = this.peers.head(); peer; peer = peer.next) {
    if (peer.bestHash !== hash) continue;

    if (peer.bestHeight !== height) {
      peer.bestHeight = height;
      total++;
    }
  }

  if (total > 0) this.logger.debug('Resolved height for %d peers.', total);
};

/**
 * Find the next checkpoint.
 * @private
 * @param {Number} height
 * @returns {Object}
 */

Pool.prototype.getNextTip = function getNextTip(height) {
  var i, next;

  for (i = 0; i < this.network.checkpoints.length; i++) {
    next = this.network.checkpoints[i];
    if (next.height > height) return new HeaderEntry(next.hash, next.height);
  }

  throw new Error('Next checkpoint not found.');
};

/**
 * Announce broadcast list to peer.
 * @param {Peer} peer
 */

Pool.prototype.announceList = function announceList(peer) {
  var blocks = [];
  var txs = [];
  var hashes = this.invMap.keys();
  var i, hash, item;

  for (i = 0; i < hashes.length; i++) {
    hash = hashes[i];
    item = this.invMap.get(hash);

    switch (item.type) {
      case invTypes.BLOCK:
        blocks.push(item.msg);
        break;
      case invTypes.TX:
        txs.push(item.msg);
        break;
      default:
        assert(false, 'Bad item type.');
        break;
    }
  }

  if (blocks.length > 0) peer.announceBlock(blocks);

  if (txs.length > 0) peer.announceTX(txs);
};

/**
 * Get a block/tx from the broadcast map.
 * @private
 * @param {Peer} peer
 * @param {InvItem} item
 * @returns {Promise}
 */

Pool.prototype.getBroadcasted = function getBroadcasted(peer, item) {
  var type = item.isTX() ? invTypes.TX : invTypes.BLOCK;
  var entry = this.invMap.get(item.hash);

  if (!entry) return;

  if (type !== entry.type) {
    this.logger.debug('Peer requested item with the wrong type (%s).', peer.hostname());
    return;
  }

  this.logger.debug('Peer requested %s %s as a %s packet (%s).', item.isTX() ? 'tx' : 'block', item.rhash(), item.hasWitness() ? 'witness' : 'normal', peer.hostname());

  entry.handleAck(peer);

  return entry.msg;
};

/**
 * Get a block/tx either from the broadcast map, mempool, or blockchain.
 * @method
 * @private
 * @param {Peer} peer
 * @param {InvItem} item
 * @returns {Promise}
 */

Pool.prototype.getItem = co( /*#__PURE__*/_regenerator2.default.mark(function getItem(peer, item) {
  var entry;
  return _regenerator2.default.wrap(function getItem$(_context16) {
    while (1) {
      switch (_context16.prev = _context16.next) {
        case 0:
          entry = this.getBroadcasted(peer, item);

          if (!entry) {
            _context16.next = 3;
            break;
          }

          return _context16.abrupt('return', entry);

        case 3:
          if (!this.options.selfish) {
            _context16.next = 5;
            break;
          }

          return _context16.abrupt('return');

        case 5:
          if (!item.isTX()) {
            _context16.next = 9;
            break;
          }

          if (this.mempool) {
            _context16.next = 8;
            break;
          }

          return _context16.abrupt('return');

        case 8:
          return _context16.abrupt('return', this.mempool.getTX(item.hash));

        case 9:
          if (!this.chain.options.spv) {
            _context16.next = 11;
            break;
          }

          return _context16.abrupt('return');

        case 11:
          if (!this.chain.options.prune) {
            _context16.next = 13;
            break;
          }

          return _context16.abrupt('return');

        case 13:
          _context16.next = 15;
          return this.chain.db.getBlock(item.hash);

        case 15:
          return _context16.abrupt('return', _context16.sent);

        case 16:
        case 'end':
          return _context16.stop();
      }
    }
  }, getItem, this);
}));

/**
 * Send a block from the broadcast list or chain.
 * @method
 * @private
 * @param {Peer} peer
 * @param {InvItem} item
 * @returns {Boolean}
 */

Pool.prototype.sendBlock = co( /*#__PURE__*/_regenerator2.default.mark(function sendBlock(peer, item, witness) {
  var block;
  return _regenerator2.default.wrap(function sendBlock$(_context17) {
    while (1) {
      switch (_context17.prev = _context17.next) {
        case 0:
          block = this.getBroadcasted(peer, item);

          // Check for a broadcasted item first.

          if (!block) {
            _context17.next = 4;
            break;
          }

          peer.send(new packets.BlockPacket(block, witness));
          return _context17.abrupt('return', true);

        case 4:
          if (!(this.options.selfish || this.chain.options.spv || this.chain.options.prune)) {
            _context17.next = 6;
            break;
          }

          return _context17.abrupt('return', false);

        case 6:
          if (!(witness || !this.options.hasWitness())) {
            _context17.next = 14;
            break;
          }

          _context17.next = 9;
          return this.chain.db.getRawBlock(item.hash);

        case 9:
          block = _context17.sent;

          if (!block) {
            _context17.next = 13;
            break;
          }

          peer.sendRaw('block', block);
          return _context17.abrupt('return', true);

        case 13:
          return _context17.abrupt('return', false);

        case 14:
          _context17.next = 16;
          return this.chain.db.getBlock(item.hash);

        case 16:
          block = _context17.sent;

          if (!block) {
            _context17.next = 20;
            break;
          }

          peer.send(new packets.BlockPacket(block, witness));
          return _context17.abrupt('return', true);

        case 20:
          return _context17.abrupt('return', false);

        case 21:
        case 'end':
          return _context17.stop();
      }
    }
  }, sendBlock, this);
}));

/**
 * Create an outbound peer with no special purpose.
 * @private
 * @param {NetAddress} addr
 * @returns {Peer}
 */

Pool.prototype.createOutbound = function createOutbound(addr) {
  var cipher = BIP151.ciphers.CHACHAPOLY;
  var identity = this.options.identityKey;
  var peer = Peer.fromOutbound(this.options, addr);

  this.hosts.markAttempt(addr.hostname);

  if (this.options.bip151) peer.setCipher(cipher);

  if (this.options.bip150) peer.setAuth(this.authdb, identity);

  this.bindPeer(peer);

  this.logger.debug('Connecting to %s.', peer.hostname());

  peer.tryOpen();

  return peer;
};

/**
 * Accept an inbound socket.
 * @private
 * @param {net.Socket} socket
 * @returns {Peer}
 */

Pool.prototype.createInbound = function createInbound(socket) {
  var cipher = BIP151.ciphers.CHACHAPOLY;
  var identity = this.options.identityKey;
  var peer = Peer.fromInbound(this.options, socket);

  if (this.options.bip151) peer.setCipher(cipher);

  if (this.options.bip150) peer.setAuth(this.authdb, identity);

  this.bindPeer(peer);

  peer.tryOpen();

  return peer;
};

/**
 * Allocate new peer id.
 * @returns {Number}
 */

Pool.prototype.uid = function uid() {
  var MAX = util.MAX_SAFE_INTEGER;

  if (this.id >= MAX - this.peers.size() - 1) this.id = 0;

  // Once we overflow, there's a chance
  // of collisions. Unlikely to happen
  // unless we have tried to connect 9
  // quadrillion times, but still
  // account for it.
  do {
    this.id += 1;
  } while (this.peers.find(this.id));

  return this.id;
};

/**
 * Bind to peer events.
 * @private
 * @param {Peer} peer
 */

Pool.prototype.bindPeer = function bindPeer(peer) {
  var self = this;

  peer.id = this.uid();

  peer.onPacket = function onPacket(packet) {
    return self.handlePacket(peer, packet);
  };

  peer.on('error', function (err) {
    self.logger.debug(err);
  });

  peer.once('connect', function () {
    self.handleConnect(peer);
  });

  peer.once('open', function () {
    self.handleOpen(peer);
  });

  peer.once('close', function (connected) {
    self.handleClose(peer, connected);
  });

  peer.once('ban', function () {
    self.handleBan(peer);
  });
};

/**
 * Handle peer packet event.
 * @method
 * @private
 * @param {Peer} peer
 * @param {Packet} packet
 * @returns {Promise}
 */

Pool.prototype.handlePacket = co( /*#__PURE__*/_regenerator2.default.mark(function handlePacket(peer, packet) {
  return _regenerator2.default.wrap(function handlePacket$(_context18) {
    while (1) {
      switch (_context18.prev = _context18.next) {
        case 0:
          _context18.t0 = packet.type;
          _context18.next = _context18.t0 === packetTypes.VERSION ? 3 : _context18.t0 === packetTypes.VERACK ? 6 : _context18.t0 === packetTypes.PING ? 9 : _context18.t0 === packetTypes.PONG ? 12 : _context18.t0 === packetTypes.GETADDR ? 15 : _context18.t0 === packetTypes.ADDR ? 18 : _context18.t0 === packetTypes.INV ? 21 : _context18.t0 === packetTypes.GETDATA ? 24 : _context18.t0 === packetTypes.NOTFOUND ? 27 : _context18.t0 === packetTypes.GETBLOCKS ? 30 : _context18.t0 === packetTypes.GETHEADERS ? 33 : _context18.t0 === packetTypes.HEADERS ? 36 : _context18.t0 === packetTypes.SENDHEADERS ? 39 : _context18.t0 === packetTypes.BLOCK ? 42 : _context18.t0 === packetTypes.TX ? 45 : _context18.t0 === packetTypes.REJECT ? 48 : _context18.t0 === packetTypes.MEMPOOL ? 51 : _context18.t0 === packetTypes.FILTERLOAD ? 54 : _context18.t0 === packetTypes.FILTERADD ? 57 : _context18.t0 === packetTypes.FILTERCLEAR ? 60 : _context18.t0 === packetTypes.MERKLEBLOCK ? 63 : _context18.t0 === packetTypes.FEEFILTER ? 66 : _context18.t0 === packetTypes.SENDCMPCT ? 69 : _context18.t0 === packetTypes.CMPCTBLOCK ? 72 : _context18.t0 === packetTypes.GETBLOCKTXN ? 75 : _context18.t0 === packetTypes.BLOCKTXN ? 78 : _context18.t0 === packetTypes.ENCINIT ? 81 : _context18.t0 === packetTypes.ENCACK ? 84 : _context18.t0 === packetTypes.AUTHCHALLENGE ? 87 : _context18.t0 === packetTypes.AUTHREPLY ? 90 : _context18.t0 === packetTypes.AUTHPROPOSE ? 93 : _context18.t0 === packetTypes.UNKNOWN ? 96 : 99;
          break;

        case 3:
          _context18.next = 5;
          return this.handleVersion(peer, packet);

        case 5:
          return _context18.abrupt('break', 101);

        case 6:
          _context18.next = 8;
          return this.handleVerack(peer, packet);

        case 8:
          return _context18.abrupt('break', 101);

        case 9:
          _context18.next = 11;
          return this.handlePing(peer, packet);

        case 11:
          return _context18.abrupt('break', 101);

        case 12:
          _context18.next = 14;
          return this.handlePong(peer, packet);

        case 14:
          return _context18.abrupt('break', 101);

        case 15:
          _context18.next = 17;
          return this.handleGetAddr(peer, packet);

        case 17:
          return _context18.abrupt('break', 101);

        case 18:
          _context18.next = 20;
          return this.handleAddr(peer, packet);

        case 20:
          return _context18.abrupt('break', 101);

        case 21:
          _context18.next = 23;
          return this.handleInv(peer, packet);

        case 23:
          return _context18.abrupt('break', 101);

        case 24:
          _context18.next = 26;
          return this.handleGetData(peer, packet);

        case 26:
          return _context18.abrupt('break', 101);

        case 27:
          _context18.next = 29;
          return this.handleNotFound(peer, packet);

        case 29:
          return _context18.abrupt('break', 101);

        case 30:
          _context18.next = 32;
          return this.handleGetBlocks(peer, packet);

        case 32:
          return _context18.abrupt('break', 101);

        case 33:
          _context18.next = 35;
          return this.handleGetHeaders(peer, packet);

        case 35:
          return _context18.abrupt('break', 101);

        case 36:
          _context18.next = 38;
          return this.handleHeaders(peer, packet);

        case 38:
          return _context18.abrupt('break', 101);

        case 39:
          _context18.next = 41;
          return this.handleSendHeaders(peer, packet);

        case 41:
          return _context18.abrupt('break', 101);

        case 42:
          _context18.next = 44;
          return this.handleBlock(peer, packet);

        case 44:
          return _context18.abrupt('break', 101);

        case 45:
          _context18.next = 47;
          return this.handleTX(peer, packet);

        case 47:
          return _context18.abrupt('break', 101);

        case 48:
          _context18.next = 50;
          return this.handleReject(peer, packet);

        case 50:
          return _context18.abrupt('break', 101);

        case 51:
          _context18.next = 53;
          return this.handleMempool(peer, packet);

        case 53:
          return _context18.abrupt('break', 101);

        case 54:
          _context18.next = 56;
          return this.handleFilterLoad(peer, packet);

        case 56:
          return _context18.abrupt('break', 101);

        case 57:
          _context18.next = 59;
          return this.handleFilterAdd(peer, packet);

        case 59:
          return _context18.abrupt('break', 101);

        case 60:
          _context18.next = 62;
          return this.handleFilterClear(peer, packet);

        case 62:
          return _context18.abrupt('break', 101);

        case 63:
          _context18.next = 65;
          return this.handleMerkleBlock(peer, packet);

        case 65:
          return _context18.abrupt('break', 101);

        case 66:
          _context18.next = 68;
          return this.handleFeeFilter(peer, packet);

        case 68:
          return _context18.abrupt('break', 101);

        case 69:
          _context18.next = 71;
          return this.handleSendCmpct(peer, packet);

        case 71:
          return _context18.abrupt('break', 101);

        case 72:
          _context18.next = 74;
          return this.handleCmpctBlock(peer, packet);

        case 74:
          return _context18.abrupt('break', 101);

        case 75:
          _context18.next = 77;
          return this.handleGetBlockTxn(peer, packet);

        case 77:
          return _context18.abrupt('break', 101);

        case 78:
          _context18.next = 80;
          return this.handleBlockTxn(peer, packet);

        case 80:
          return _context18.abrupt('break', 101);

        case 81:
          _context18.next = 83;
          return this.handleEncinit(peer, packet);

        case 83:
          return _context18.abrupt('break', 101);

        case 84:
          _context18.next = 86;
          return this.handleEncack(peer, packet);

        case 86:
          return _context18.abrupt('break', 101);

        case 87:
          _context18.next = 89;
          return this.handleAuthChallenge(peer, packet);

        case 89:
          return _context18.abrupt('break', 101);

        case 90:
          _context18.next = 92;
          return this.handleAuthReply(peer, packet);

        case 92:
          return _context18.abrupt('break', 101);

        case 93:
          _context18.next = 95;
          return this.handleAuthPropose(peer, packet);

        case 95:
          return _context18.abrupt('break', 101);

        case 96:
          _context18.next = 98;
          return this.handleUnknown(peer, packet);

        case 98:
          return _context18.abrupt('break', 101);

        case 99:
          assert(false, 'Bad packet type.');
          return _context18.abrupt('break', 101);

        case 101:

          this.emit('packet', packet, peer);

        case 102:
        case 'end':
          return _context18.stop();
      }
    }
  }, handlePacket, this);
}));

/**
 * Handle peer connect event.
 * @method
 * @private
 * @param {Peer} peer
 */

Pool.prototype.handleConnect = co( /*#__PURE__*/_regenerator2.default.mark(function handleConnect(peer) {
  return _regenerator2.default.wrap(function handleConnect$(_context19) {
    while (1) {
      switch (_context19.prev = _context19.next) {
        case 0:
          this.logger.info('Connected to %s.', peer.hostname());

          if (peer.outbound) this.hosts.markSuccess(peer.hostname());

          this.emit('peer connect', peer);

        case 3:
        case 'end':
          return _context19.stop();
      }
    }
  }, handleConnect, this);
}));

/**
 * Handle peer open event.
 * @method
 * @private
 * @param {Peer} peer
 */

Pool.prototype.handleOpen = co( /*#__PURE__*/_regenerator2.default.mark(function handleOpen(peer) {
  var addr;
  return _regenerator2.default.wrap(function handleOpen$(_context20) {
    while (1) {
      switch (_context20.prev = _context20.next) {
        case 0:

          // Advertise our address.
          if (!this.options.selfish && this.options.listen) {
            addr = this.hosts.getLocal(peer.address);
            if (addr) peer.send(new packets.AddrPacket([addr]));
          }

          // We want compact blocks!
          if (this.options.compact) peer.sendCompact(this.options.blockMode);

          // Find some more peers.
          if (!this.hosts.isFull()) peer.sendGetAddr();

          // Relay our spv filter if we have one.
          if (this.spvFilter) peer.sendFilterLoad(this.spvFilter);

          // Announce our currently broadcasted items.
          this.announceList(peer);

          // Set a fee rate filter.
          if (this.options.feeRate !== -1) peer.sendFeeRate(this.options.feeRate);

          // Start syncing the chain.
          if (peer.outbound) this.sendSync(peer);

          if (peer.outbound) {
            this.hosts.markAck(peer.hostname(), peer.services);

            // If we don't have an ack'd
            // loader yet consider it dead.
            if (!peer.loader) {
              if (this.peers.load && !this.peers.load.handshake) {
                assert(this.peers.load.loader);
                this.peers.load.loader = false;
                this.peers.load = null;
              }
            }

            // If we do not have a loader,
            // use this peer.
            if (!this.peers.load) this.setLoader(peer);
          }

          this.emit('peer open', peer);

        case 9:
        case 'end':
          return _context20.stop();
      }
    }
  }, handleOpen, this);
}));

/**
 * Handle peer close event.
 * @method
 * @private
 * @param {Peer} peer
 * @param {Boolean} connected
 */

Pool.prototype.handleClose = co( /*#__PURE__*/_regenerator2.default.mark(function handleClose(peer, connected) {
  var outbound, loader, size;
  return _regenerator2.default.wrap(function handleClose$(_context21) {
    while (1) {
      switch (_context21.prev = _context21.next) {
        case 0:
          outbound = peer.outbound;
          loader = peer.loader;
          size = peer.blockMap.size;


          this.removePeer(peer);

          if (loader) {
            this.logger.info('Removed loader peer (%s).', peer.hostname());
            if (this.checkpoints) this.resetChain();
          }

          this.nonces.remove(peer.hostname());

          this.emit('peer close', peer, connected);

          if (this.loaded) {
            _context21.next = 9;
            break;
          }

          return _context21.abrupt('return');

        case 9:
          if (!this.disconnecting) {
            _context21.next = 11;
            break;
          }

          return _context21.abrupt('return');

        case 11:

          if (this.chain.synced && size > 0) {
            this.logger.warning('Peer disconnected with requested blocks.');
            this.logger.warning('Resending sync...');
            this.forceSync();
          }

          if (outbound) {
            _context21.next = 14;
            break;
          }

          return _context21.abrupt('return');

        case 14:

          this.refill();

        case 15:
        case 'end':
          return _context21.stop();
      }
    }
  }, handleClose, this);
}));

/**
 * Handle ban event.
 * @method
 * @private
 * @param {Peer} peer
 */

Pool.prototype.handleBan = co( /*#__PURE__*/_regenerator2.default.mark(function handleBan(peer) {
  return _regenerator2.default.wrap(function handleBan$(_context22) {
    while (1) {
      switch (_context22.prev = _context22.next) {
        case 0:
          this.ban(peer.address);
          this.emit('ban', peer);

        case 2:
        case 'end':
          return _context22.stop();
      }
    }
  }, handleBan, this);
}));

/**
 * Handle peer version event.
 * @method
 * @private
 * @param {Peer} peer
 * @param {VersionPacket} packet
 */

Pool.prototype.handleVersion = co( /*#__PURE__*/_regenerator2.default.mark(function handleVersion(peer, packet) {
  return _regenerator2.default.wrap(function handleVersion$(_context23) {
    while (1) {
      switch (_context23.prev = _context23.next) {
        case 0:
          this.logger.info('Received version (%s): version=%d height=%d services=%s agent=%s', peer.hostname(), packet.version, packet.height, packet.services.toString(2), packet.agent);

          this.network.time.add(peer.hostname(), packet.ts);
          this.nonces.remove(peer.hostname());

          if (!peer.outbound && packet.remote.isRoutable()) this.hosts.markLocal(packet.remote);

        case 4:
        case 'end':
          return _context23.stop();
      }
    }
  }, handleVersion, this);
}));

/**
 * Handle `verack` packet.
 * @method
 * @private
 * @param {Peer} peer
 * @param {VerackPacket} packet
 */

Pool.prototype.handleVerack = co( /*#__PURE__*/_regenerator2.default.mark(function handleVerack(peer, packet) {
  return _regenerator2.default.wrap(function handleVerack$(_context24) {
    while (1) {
      switch (_context24.prev = _context24.next) {
        case 0:
          ;

        case 1:
        case 'end':
          return _context24.stop();
      }
    }
  }, handleVerack, this);
}));

/**
 * Handle `ping` packet.
 * @method
 * @private
 * @param {Peer} peer
 * @param {PingPacket} packet
 */

Pool.prototype.handlePing = co( /*#__PURE__*/_regenerator2.default.mark(function handlePing(peer, packet) {
  return _regenerator2.default.wrap(function handlePing$(_context25) {
    while (1) {
      switch (_context25.prev = _context25.next) {
        case 0:
          ;

        case 1:
        case 'end':
          return _context25.stop();
      }
    }
  }, handlePing, this);
}));

/**
 * Handle `pong` packet.
 * @method
 * @private
 * @param {Peer} peer
 * @param {PongPacket} packet
 */

Pool.prototype.handlePong = co( /*#__PURE__*/_regenerator2.default.mark(function handlePong(peer, packet) {
  return _regenerator2.default.wrap(function handlePong$(_context26) {
    while (1) {
      switch (_context26.prev = _context26.next) {
        case 0:
          ;

        case 1:
        case 'end':
          return _context26.stop();
      }
    }
  }, handlePong, this);
}));

/**
 * Handle `getaddr` packet.
 * @method
 * @private
 * @param {Peer} peer
 * @param {GetAddrPacket} packet
 */

Pool.prototype.handleGetAddr = co( /*#__PURE__*/_regenerator2.default.mark(function handleGetAddr(peer, packet) {
  var items, i, addrs, addr;
  return _regenerator2.default.wrap(function handleGetAddr$(_context27) {
    while (1) {
      switch (_context27.prev = _context27.next) {
        case 0:
          items = [];

          if (!this.options.selfish) {
            _context27.next = 3;
            break;
          }

          return _context27.abrupt('return');

        case 3:
          if (!peer.sentAddr) {
            _context27.next = 6;
            break;
          }

          this.logger.debug('Ignoring repeated getaddr (%s).', peer.hostname());
          return _context27.abrupt('return');

        case 6:

          peer.sentAddr = true;

          addrs = this.hosts.toArray();

          i = 0;

        case 9:
          if (!(i < addrs.length)) {
            _context27.next = 19;
            break;
          }

          addr = addrs[i];

          if (peer.addrFilter.added(addr.hostname, 'ascii')) {
            _context27.next = 13;
            break;
          }

          return _context27.abrupt('continue', 16);

        case 13:

          items.push(addr);

          if (!(items.length === 1000)) {
            _context27.next = 16;
            break;
          }

          return _context27.abrupt('break', 19);

        case 16:
          i++;
          _context27.next = 9;
          break;

        case 19:
          if (!(items.length === 0)) {
            _context27.next = 21;
            break;
          }

          return _context27.abrupt('return');

        case 21:

          this.logger.debug('Sending %d addrs to peer (%s)', items.length, peer.hostname());

          peer.send(new packets.AddrPacket(items));

        case 23:
        case 'end':
          return _context27.stop();
      }
    }
  }, handleGetAddr, this);
}));

/**
 * Handle peer addr event.
 * @method
 * @private
 * @param {Peer} peer
 * @param {AddrPacket} packet
 */

Pool.prototype.handleAddr = co( /*#__PURE__*/_regenerator2.default.mark(function handleAddr(peer, packet) {
  var addrs, now, services, i, addr;
  return _regenerator2.default.wrap(function handleAddr$(_context28) {
    while (1) {
      switch (_context28.prev = _context28.next) {
        case 0:
          addrs = packet.items;
          now = this.network.now();
          services = this.options.getRequiredServices();
          i = 0;

        case 4:
          if (!(i < addrs.length)) {
            _context28.next = 18;
            break;
          }

          addr = addrs[i];

          peer.addrFilter.add(addr.hostname, 'ascii');

          if (addr.isRoutable()) {
            _context28.next = 9;
            break;
          }

          return _context28.abrupt('continue', 15);

        case 9:
          if (addr.hasServices(services)) {
            _context28.next = 11;
            break;
          }

          return _context28.abrupt('continue', 15);

        case 11:

          if (addr.ts <= 100000000 || addr.ts > now + 10 * 60) addr.ts = now - 5 * 24 * 60 * 60;

          if (!(addr.port === 0)) {
            _context28.next = 14;
            break;
          }

          return _context28.abrupt('continue', 15);

        case 14:

          this.hosts.add(addr, peer.address);

        case 15:
          i++;
          _context28.next = 4;
          break;

        case 18:

          this.logger.info('Received %d addrs (hosts=%d, peers=%d) (%s).', addrs.length, this.hosts.size(), this.peers.size(), peer.hostname());

          this.fillOutbound();

        case 20:
        case 'end':
          return _context28.stop();
      }
    }
  }, handleAddr, this);
}));

/**
 * Handle `inv` packet.
 * @method
 * @private
 * @param {Peer} peer
 * @param {InvPacket} packet
 */

Pool.prototype.handleInv = co( /*#__PURE__*/_regenerator2.default.mark(function handleInv(peer, packet) {
  var unlock;
  return _regenerator2.default.wrap(function handleInv$(_context29) {
    while (1) {
      switch (_context29.prev = _context29.next) {
        case 0:
          _context29.next = 2;
          return this.locker.lock();

        case 2:
          unlock = _context29.sent;
          _context29.prev = 3;
          _context29.next = 6;
          return this._handleInv(peer, packet);

        case 6:
          return _context29.abrupt('return', _context29.sent);

        case 7:
          _context29.prev = 7;

          unlock();
          return _context29.finish(7);

        case 10:
        case 'end':
          return _context29.stop();
      }
    }
  }, handleInv, this, [[3,, 7, 10]]);
}));

/**
 * Handle `inv` packet (without a lock).
 * @method
 * @private
 * @param {Peer} peer
 * @param {InvPacket} packet
 */

Pool.prototype._handleInv = co( /*#__PURE__*/_regenerator2.default.mark(function handleInv(peer, packet) {
  var items, blocks, txs, unknown, i, item;
  return _regenerator2.default.wrap(function handleInv$(_context30) {
    while (1) {
      switch (_context30.prev = _context30.next) {
        case 0:
          items = packet.items;
          blocks = [];
          txs = [];
          unknown = -1;

          if (!(items.length > 50000)) {
            _context30.next = 7;
            break;
          }

          peer.increaseBan(100);
          return _context30.abrupt('return');

        case 7:
          i = 0;

        case 8:
          if (!(i < items.length)) {
            _context30.next = 23;
            break;
          }

          item = items[i];
          _context30.t0 = item.type;
          _context30.next = _context30.t0 === invTypes.BLOCK ? 13 : _context30.t0 === invTypes.TX ? 15 : 17;
          break;

        case 13:
          blocks.push(item.hash);
          return _context30.abrupt('break', 19);

        case 15:
          txs.push(item.hash);
          return _context30.abrupt('break', 19);

        case 17:
          unknown = item.type;
          return _context30.abrupt('continue', 20);

        case 19:
          peer.invFilter.add(item.hash, 'hex');

        case 20:
          i++;
          _context30.next = 8;
          break;

        case 23:

          this.logger.spam('Received inv packet with %d items: blocks=%d txs=%d (%s).', items.length, blocks.length, txs.length, peer.hostname());

          if (unknown !== -1) {
            this.logger.warning('Peer sent an unknown inv type: %d (%s).', unknown, peer.hostname());
          }

          if (!(blocks.length > 0)) {
            _context30.next = 28;
            break;
          }

          _context30.next = 28;
          return this.handleBlockInv(peer, blocks);

        case 28:
          if (!(txs.length > 0)) {
            _context30.next = 31;
            break;
          }

          _context30.next = 31;
          return this.handleTXInv(peer, txs);

        case 31:
        case 'end':
          return _context30.stop();
      }
    }
  }, handleInv, this);
}));

/**
 * Handle `inv` packet from peer (containing only BLOCK types).
 * @method
 * @private
 * @param {Peer} peer
 * @param {Hash[]} hashes
 * @returns {Promise}
 */

Pool.prototype.handleBlockInv = co( /*#__PURE__*/_regenerator2.default.mark(function handleBlockInv(peer, hashes) {
  var items, i, hash, exists, height;
  return _regenerator2.default.wrap(function handleBlockInv$(_context31) {
    while (1) {
      switch (_context31.prev = _context31.next) {
        case 0:
          items = [];


          assert(hashes.length > 0);

          if (this.syncing) {
            _context31.next = 4;
            break;
          }

          return _context31.abrupt('return');

        case 4:

          // Always keep track of the peer's best hash.
          if (!peer.loader || this.chain.synced) {
            hash = hashes[hashes.length - 1];
            peer.bestHash = hash;
          }

          // Ignore for now if we're still syncing

          if (!(!this.chain.synced && !peer.loader)) {
            _context31.next = 7;
            break;
          }

          return _context31.abrupt('return');

        case 7:
          if (!(this.options.hasWitness() && !peer.hasWitness())) {
            _context31.next = 9;
            break;
          }

          return _context31.abrupt('return');

        case 9:
          if (!this.checkpoints) {
            _context31.next = 11;
            break;
          }

          return _context31.abrupt('return');

        case 11:

          this.logger.debug('Received %s block hashes from peer (%s).', hashes.length, peer.hostname());

          i = 0;

        case 13:
          if (!(i < hashes.length)) {
            _context31.next = 33;
            break;
          }

          hash = hashes[i];

          // Resolve orphan chain.

          if (!this.chain.hasOrphan(hash)) {
            _context31.next = 20;
            break;
          }

          this.logger.debug('Received known orphan hash (%s).', peer.hostname());
          _context31.next = 19;
          return this.resolveOrphan(peer, hash);

        case 19:
          return _context31.abrupt('continue', 30);

        case 20:
          _context31.next = 22;
          return this.hasBlock(hash);

        case 22:
          if (_context31.sent) {
            _context31.next = 25;
            break;
          }

          items.push(hash);
          return _context31.abrupt('continue', 30);

        case 25:

          exists = hash;

          // Normally we request the hashContinue.
          // In the odd case where we already have
          // it, we can do one of two things: either
          // force re-downloading of the block to
          // continue the sync, or do a getblocks
          // from the last hash (this will reset
          // the hashContinue on the remote node).

          if (!(i === hashes.length - 1)) {
            _context31.next = 30;
            break;
          }

          this.logger.debug('Received existing hash (%s).', peer.hostname());
          _context31.next = 30;
          return this.getBlocks(peer, hash);

        case 30:
          i++;
          _context31.next = 13;
          break;

        case 33:
          if (!(exists && this.chain.synced)) {
            _context31.next = 38;
            break;
          }

          _context31.next = 36;
          return this.chain.db.getHeight(exists);

        case 36:
          height = _context31.sent;

          if (height !== -1) peer.bestHeight = height;

        case 38:

          this.getBlock(peer, items);

        case 39:
        case 'end':
          return _context31.stop();
      }
    }
  }, handleBlockInv, this);
}));

/**
 * Handle peer inv packet (txs).
 * @method
 * @private
 * @param {Peer} peer
 * @param {Hash[]} hashes
 */

Pool.prototype.handleTXInv = co( /*#__PURE__*/_regenerator2.default.mark(function handleTXInv(peer, hashes) {
  return _regenerator2.default.wrap(function handleTXInv$(_context32) {
    while (1) {
      switch (_context32.prev = _context32.next) {
        case 0:
          assert(hashes.length > 0);

          if (!(this.syncing && !this.chain.synced)) {
            _context32.next = 3;
            break;
          }

          return _context32.abrupt('return');

        case 3:

          this.ensureTX(peer, hashes);

        case 4:
        case 'end':
          return _context32.stop();
      }
    }
  }, handleTXInv, this);
}));

/**
 * Handle `getdata` packet.
 * @method
 * @private
 * @param {Peer} peer
 * @param {GetDataPacket} packet
 */

Pool.prototype.handleGetData = co( /*#__PURE__*/_regenerator2.default.mark(function handleGetData(peer, packet) {
  var items, notFound, txs, blocks, compact, unknown, i, j, item, tx, block, result, height;
  return _regenerator2.default.wrap(function handleGetData$(_context33) {
    while (1) {
      switch (_context33.prev = _context33.next) {
        case 0:
          items = packet.items;
          notFound = [];
          txs = 0;
          blocks = 0;
          compact = 0;
          unknown = -1;

          if (!(items.length > 50000)) {
            _context33.next = 11;
            break;
          }

          this.logger.warning('Peer sent inv with >50k items (%s).', peer.hostname());
          peer.increaseBan(100);
          peer.destroy();
          return _context33.abrupt('return');

        case 11:
          i = 0;

        case 12:
          if (!(i < items.length)) {
            _context33.next = 88;
            break;
          }

          item = items[i];

          if (!item.isTX()) {
            _context33.next = 28;
            break;
          }

          _context33.next = 17;
          return this.getItem(peer, item);

        case 17:
          tx = _context33.sent;

          if (tx) {
            _context33.next = 21;
            break;
          }

          notFound.push(item);
          return _context33.abrupt('continue', 85);

        case 21:
          if (!tx.isCoinbase()) {
            _context33.next = 25;
            break;
          }

          notFound.push(item);
          this.logger.warning('Failsafe: tried to relay a coinbase.');
          return _context33.abrupt('continue', 85);

        case 25:

          peer.send(new packets.TXPacket(tx, item.hasWitness()));

          txs++;

          return _context33.abrupt('continue', 85);

        case 28:
          _context33.t0 = item.type;
          _context33.next = _context33.t0 === invTypes.BLOCK ? 31 : _context33.t0 === invTypes.WITNESS_BLOCK ? 31 : _context33.t0 === invTypes.FILTERED_BLOCK ? 39 : _context33.t0 === invTypes.WITNESS_FILTERED_BLOCK ? 39 : _context33.t0 === invTypes.CMPCT_BLOCK ? 57 : 79;
          break;

        case 31:
          _context33.next = 33;
          return this.sendBlock(peer, item, item.hasWitness());

        case 33:
          result = _context33.sent;

          if (result) {
            _context33.next = 37;
            break;
          }

          notFound.push(item);
          return _context33.abrupt('continue', 85);

        case 37:
          blocks++;
          return _context33.abrupt('break', 82);

        case 39:
          if (this.options.bip37) {
            _context33.next = 43;
            break;
          }

          this.logger.debug('Peer requested a merkleblock without bip37 enabled (%s).', peer.hostname());
          peer.destroy();
          return _context33.abrupt('return');

        case 43:
          if (peer.spvFilter) {
            _context33.next = 46;
            break;
          }

          notFound.push(item);
          return _context33.abrupt('continue', 85);

        case 46:
          _context33.next = 48;
          return this.getItem(peer, item);

        case 48:
          block = _context33.sent;

          if (block) {
            _context33.next = 52;
            break;
          }

          notFound.push(item);
          return _context33.abrupt('continue', 85);

        case 52:

          block = block.toMerkle(peer.spvFilter);

          peer.send(new packets.MerkleBlockPacket(block));

          for (j = 0; j < block.txs.length; j++) {
            tx = block.txs[j];
            peer.send(new packets.TXPacket(tx, item.hasWitness()));
            txs++;
          }

          blocks++;

          return _context33.abrupt('break', 82);

        case 57:
          _context33.next = 59;
          return this.chain.db.getHeight(item.hash);

        case 59:
          height = _context33.sent;

          if (!(height < this.chain.tip.height - 10)) {
            _context33.next = 69;
            break;
          }

          _context33.next = 63;
          return this.sendBlock(peer, item, peer.compactWitness);

        case 63:
          result = _context33.sent;

          if (result) {
            _context33.next = 67;
            break;
          }

          notFound.push(item);
          return _context33.abrupt('continue', 85);

        case 67:
          blocks++;
          return _context33.abrupt('break', 82);

        case 69:
          _context33.next = 71;
          return this.getItem(peer, item);

        case 71:
          block = _context33.sent;

          if (block) {
            _context33.next = 75;
            break;
          }

          notFound.push(item);
          return _context33.abrupt('continue', 85);

        case 75:

          peer.sendCompactBlock(block);

          blocks++;
          compact++;

          return _context33.abrupt('break', 82);

        case 79:
          unknown = item.type;
          notFound.push(item);
          return _context33.abrupt('continue', 85);

        case 82:

          if (item.hash === peer.hashContinue) {
            peer.sendInv([new InvItem(invTypes.BLOCK, this.chain.tip.hash)]);
            peer.hashContinue = null;
          }

          // Wait for the peer to read
          // before we pull more data
          // out of the database.
          _context33.next = 85;
          return peer.drain();

        case 85:
          i++;
          _context33.next = 12;
          break;

        case 88:

          if (notFound.length > 0) peer.send(new packets.NotFoundPacket(notFound));

          if (txs > 0) {
            this.logger.debug('Served %d txs with getdata (notfound=%d) (%s).', txs, notFound.length, peer.hostname());
          }

          if (blocks > 0) {
            this.logger.debug('Served %d blocks with getdata (notfound=%d, cmpct=%d) (%s).', blocks, notFound.length, compact, peer.hostname());
          }

          if (unknown !== -1) {
            this.logger.warning('Peer sent an unknown getdata type: %s (%d).', unknown, peer.hostname());
          }

        case 92:
        case 'end':
          return _context33.stop();
      }
    }
  }, handleGetData, this);
}));

/**
 * Handle peer notfound packet.
 * @method
 * @private
 * @param {Peer} peer
 * @param {NotFoundPacket} packet
 */

Pool.prototype.handleNotFound = co( /*#__PURE__*/_regenerator2.default.mark(function handleNotFound(peer, packet) {
  var items, i, item;
  return _regenerator2.default.wrap(function handleNotFound$(_context34) {
    while (1) {
      switch (_context34.prev = _context34.next) {
        case 0:
          items = packet.items;
          i = 0;

        case 2:
          if (!(i < items.length)) {
            _context34.next = 11;
            break;
          }

          item = items[i];

          if (this.resolveItem(peer, item)) {
            _context34.next = 8;
            break;
          }

          this.logger.warning('Peer sent notfound for unrequested item: %s (%s).', item.hash, peer.hostname());
          peer.destroy();
          return _context34.abrupt('return');

        case 8:
          i++;
          _context34.next = 2;
          break;

        case 11:
        case 'end':
          return _context34.stop();
      }
    }
  }, handleNotFound, this);
}));

/**
 * Handle `getblocks` packet.
 * @method
 * @private
 * @param {Peer} peer
 * @param {GetBlocksPacket} packet
 */

Pool.prototype.handleGetBlocks = co( /*#__PURE__*/_regenerator2.default.mark(function handleGetBlocks(peer, packet) {
  var blocks, hash;
  return _regenerator2.default.wrap(function handleGetBlocks$(_context35) {
    while (1) {
      switch (_context35.prev = _context35.next) {
        case 0:
          blocks = [];

          if (this.chain.synced) {
            _context35.next = 3;
            break;
          }

          return _context35.abrupt('return');

        case 3:
          if (!this.options.selfish) {
            _context35.next = 5;
            break;
          }

          return _context35.abrupt('return');

        case 5:
          if (!this.chain.options.spv) {
            _context35.next = 7;
            break;
          }

          return _context35.abrupt('return');

        case 7:
          if (!this.chain.options.prune) {
            _context35.next = 9;
            break;
          }

          return _context35.abrupt('return');

        case 9:
          _context35.next = 11;
          return this.chain.findLocator(packet.locator);

        case 11:
          hash = _context35.sent;

          if (!hash) {
            _context35.next = 16;
            break;
          }

          _context35.next = 15;
          return this.chain.db.getNextHash(hash);

        case 15:
          hash = _context35.sent;

        case 16:
          if (!hash) {
            _context35.next = 28;
            break;
          }

          blocks.push(new InvItem(invTypes.BLOCK, hash));

          if (!(hash === packet.stop)) {
            _context35.next = 20;
            break;
          }

          return _context35.abrupt('break', 28);

        case 20:
          if (!(blocks.length === 500)) {
            _context35.next = 23;
            break;
          }

          peer.hashContinue = hash;
          return _context35.abrupt('break', 28);

        case 23:
          _context35.next = 25;
          return this.chain.db.getNextHash(hash);

        case 25:
          hash = _context35.sent;
          _context35.next = 16;
          break;

        case 28:

          peer.sendInv(blocks);

        case 29:
        case 'end':
          return _context35.stop();
      }
    }
  }, handleGetBlocks, this);
}));

/**
 * Handle `getheaders` packet.
 * @method
 * @private
 * @param {Peer} peer
 * @param {GetHeadersPacket} packet
 */

Pool.prototype.handleGetHeaders = co( /*#__PURE__*/_regenerator2.default.mark(function handleGetHeaders(peer, packet) {
  var headers, hash, entry;
  return _regenerator2.default.wrap(function handleGetHeaders$(_context36) {
    while (1) {
      switch (_context36.prev = _context36.next) {
        case 0:
          headers = [];

          if (this.chain.synced) {
            _context36.next = 3;
            break;
          }

          return _context36.abrupt('return');

        case 3:
          if (!this.options.selfish) {
            _context36.next = 5;
            break;
          }

          return _context36.abrupt('return');

        case 5:
          if (!this.chain.options.spv) {
            _context36.next = 7;
            break;
          }

          return _context36.abrupt('return');

        case 7:
          if (!this.chain.options.prune) {
            _context36.next = 9;
            break;
          }

          return _context36.abrupt('return');

        case 9:
          if (!(packet.locator.length > 0)) {
            _context36.next = 19;
            break;
          }

          _context36.next = 12;
          return this.chain.findLocator(packet.locator);

        case 12:
          hash = _context36.sent;

          if (!hash) {
            _context36.next = 17;
            break;
          }

          _context36.next = 16;
          return this.chain.db.getNextHash(hash);

        case 16:
          hash = _context36.sent;

        case 17:
          _context36.next = 20;
          break;

        case 19:
          hash = packet.stop;

        case 20:
          if (!hash) {
            _context36.next = 24;
            break;
          }

          _context36.next = 23;
          return this.chain.db.getEntry(hash);

        case 23:
          entry = _context36.sent;

        case 24:
          if (!entry) {
            _context36.next = 35;
            break;
          }

          headers.push(entry.toHeaders());

          if (!(entry.hash === packet.stop)) {
            _context36.next = 28;
            break;
          }

          return _context36.abrupt('break', 35);

        case 28:
          if (!(headers.length === 2000)) {
            _context36.next = 30;
            break;
          }

          return _context36.abrupt('break', 35);

        case 30:
          _context36.next = 32;
          return entry.getNext();

        case 32:
          entry = _context36.sent;
          _context36.next = 24;
          break;

        case 35:

          peer.sendHeaders(headers);

        case 36:
        case 'end':
          return _context36.stop();
      }
    }
  }, handleGetHeaders, this);
}));

/**
 * Handle `headers` packet from a given peer.
 * @method
 * @private
 * @param {Peer} peer
 * @param {HeadersPacket} packet
 * @returns {Promise}
 */

Pool.prototype.handleHeaders = co( /*#__PURE__*/_regenerator2.default.mark(function handleHeaders(peer, packet) {
  var unlock;
  return _regenerator2.default.wrap(function handleHeaders$(_context37) {
    while (1) {
      switch (_context37.prev = _context37.next) {
        case 0:
          _context37.next = 2;
          return this.locker.lock();

        case 2:
          unlock = _context37.sent;
          _context37.prev = 3;
          _context37.next = 6;
          return this._handleHeaders(peer, packet);

        case 6:
          return _context37.abrupt('return', _context37.sent);

        case 7:
          _context37.prev = 7;

          unlock();
          return _context37.finish(7);

        case 10:
        case 'end':
          return _context37.stop();
      }
    }
  }, handleHeaders, this, [[3,, 7, 10]]);
}));

/**
 * Handle `headers` packet from
 * a given peer without a lock.
 * @method
 * @private
 * @param {Peer} peer
 * @param {HeadersPacket} packet
 * @returns {Promise}
 */

Pool.prototype._handleHeaders = co( /*#__PURE__*/_regenerator2.default.mark(function handleHeaders(peer, packet) {
  var headers, checkpoint, i, header, hash, height, last, node;
  return _regenerator2.default.wrap(function handleHeaders$(_context38) {
    while (1) {
      switch (_context38.prev = _context38.next) {
        case 0:
          headers = packet.items;
          checkpoint = false;

          if (this.checkpoints) {
            _context38.next = 4;
            break;
          }

          return _context38.abrupt('return');

        case 4:
          if (this.syncing) {
            _context38.next = 6;
            break;
          }

          return _context38.abrupt('return');

        case 6:
          if (peer.loader) {
            _context38.next = 8;
            break;
          }

          return _context38.abrupt('return');

        case 8:
          if (!(headers.length === 0)) {
            _context38.next = 10;
            break;
          }

          return _context38.abrupt('return');

        case 10:
          if (!(headers.length > 2000)) {
            _context38.next = 13;
            break;
          }

          peer.increaseBan(100);
          return _context38.abrupt('return');

        case 13:

          assert(this.headerChain.size > 0);

          i = 0;

        case 15:
          if (!(i < headers.length)) {
            _context38.next = 51;
            break;
          }

          header = headers[i];
          last = this.headerChain.tail;
          hash = header.hash('hex');
          height = last.height + 1;

          if (header.verify()) {
            _context38.next = 25;
            break;
          }

          this.logger.warning('Peer sent an invalid header (%s).', peer.hostname());
          peer.increaseBan(100);
          peer.destroy();
          return _context38.abrupt('return');

        case 25:
          if (!(header.prevBlock !== last.hash)) {
            _context38.next = 34;
            break;
          }

          this.logger.warning('Peer sent a bad header chain (%s).', peer.hostname());

          if (!(++this.headerFails < Pool.MAX_HEADER_FAILS)) {
            _context38.next = 30;
            break;
          }

          peer.destroy();
          return _context38.abrupt('return');

        case 30:

          this.logger.warning('Switching to getblocks (%s).', peer.hostname());

          _context38.next = 33;
          return this.switchSync(peer);

        case 33:
          return _context38.abrupt('return');

        case 34:

          node = new HeaderEntry(hash, height);

          if (!(node.height === this.headerTip.height)) {
            _context38.next = 46;
            break;
          }

          if (!(node.hash !== this.headerTip.hash)) {
            _context38.next = 45;
            break;
          }

          this.logger.warning('Peer sent an invalid checkpoint (%s).', peer.hostname());

          if (!(++this.headerFails < Pool.MAX_HEADER_FAILS)) {
            _context38.next = 41;
            break;
          }

          peer.destroy();
          return _context38.abrupt('return');

        case 41:

          this.logger.warning('Switching to getblocks (%s).', peer.hostname());

          _context38.next = 44;
          return this.switchSync(peer);

        case 44:
          return _context38.abrupt('return');

        case 45:
          checkpoint = true;

        case 46:

          if (!this.headerNext) this.headerNext = node;

          this.headerChain.push(node);

        case 48:
          i++;
          _context38.next = 15;
          break;

        case 51:

          this.logger.debug('Received %s headers from peer (%s).', headers.length, peer.hostname());

          // If we received a valid header
          // chain, consider this a "block".
          peer.blockTime = util.ms();

          // Request the blocks we just added.

          if (!checkpoint) {
            _context38.next = 57;
            break;
          }

          this.headerChain.shift();
          this.resolveHeaders(peer);
          return _context38.abrupt('return');

        case 57:

          // Request more headers.
          peer.sendGetHeaders([node.hash], this.headerTip.hash);

        case 58:
        case 'end':
          return _context38.stop();
      }
    }
  }, handleHeaders, this);
}));

/**
 * Handle `sendheaders` packet.
 * @method
 * @private
 * @param {Peer} peer
 * @param {SendHeadersPacket} packet
 * @returns {Promise}
 */

Pool.prototype.handleSendHeaders = co( /*#__PURE__*/_regenerator2.default.mark(function handleSendHeaders(peer, packet) {
  return _regenerator2.default.wrap(function handleSendHeaders$(_context39) {
    while (1) {
      switch (_context39.prev = _context39.next) {
        case 0:
          ;

        case 1:
        case 'end':
          return _context39.stop();
      }
    }
  }, handleSendHeaders, this);
}));

/**
 * Handle `block` packet. Attempt to add to chain.
 * @method
 * @private
 * @param {Peer} peer
 * @param {BlockPacket} packet
 * @returns {Promise}
 */

Pool.prototype.handleBlock = co( /*#__PURE__*/_regenerator2.default.mark(function handleBlock(peer, packet) {
  var flags;
  return _regenerator2.default.wrap(function handleBlock$(_context40) {
    while (1) {
      switch (_context40.prev = _context40.next) {
        case 0:
          flags = chainCommon.flags.DEFAULT_FLAGS;

          if (!this.options.spv) {
            _context40.next = 4;
            break;
          }

          this.logger.warning('Peer sent unsolicited block (%s).', peer.hostname());
          return _context40.abrupt('return');

        case 4:
          _context40.next = 6;
          return this.addBlock(peer, packet.block, flags);

        case 6:
          return _context40.abrupt('return', _context40.sent);

        case 7:
        case 'end':
          return _context40.stop();
      }
    }
  }, handleBlock, this);
}));

/**
 * Attempt to add block to chain.
 * @method
 * @private
 * @param {Peer} peer
 * @param {Block} block
 * @returns {Promise}
 */

Pool.prototype.addBlock = co( /*#__PURE__*/_regenerator2.default.mark(function addBlock(peer, block, flags) {
  var hash, unlock;
  return _regenerator2.default.wrap(function addBlock$(_context41) {
    while (1) {
      switch (_context41.prev = _context41.next) {
        case 0:
          hash = block.hash('hex');
          _context41.next = 3;
          return this.locker.lock(hash);

        case 3:
          unlock = _context41.sent;
          _context41.prev = 4;
          _context41.next = 7;
          return this._addBlock(peer, block, flags);

        case 7:
          return _context41.abrupt('return', _context41.sent);

        case 8:
          _context41.prev = 8;

          unlock();
          return _context41.finish(8);

        case 11:
        case 'end':
          return _context41.stop();
      }
    }
  }, addBlock, this, [[4,, 8, 11]]);
}));

/**
 * Attempt to add block to chain (without a lock).
 * @method
 * @private
 * @param {Peer} peer
 * @param {Block} block
 * @returns {Promise}
 */

Pool.prototype._addBlock = co( /*#__PURE__*/_regenerator2.default.mark(function addBlock(peer, block, flags) {
  var hash, entry, height;
  return _regenerator2.default.wrap(function addBlock$(_context42) {
    while (1) {
      switch (_context42.prev = _context42.next) {
        case 0:
          hash = block.hash('hex');

          if (this.syncing) {
            _context42.next = 3;
            break;
          }

          return _context42.abrupt('return');

        case 3:
          if (this.resolveBlock(peer, hash)) {
            _context42.next = 7;
            break;
          }

          this.logger.warning('Received unrequested block: %s (%s).', block.rhash(), peer.hostname());
          peer.destroy();
          return _context42.abrupt('return');

        case 7:

          peer.blockTime = util.ms();

          _context42.prev = 8;
          _context42.next = 11;
          return this.chain.add(block, flags, peer.id);

        case 11:
          entry = _context42.sent;
          _context42.next = 21;
          break;

        case 14:
          _context42.prev = 14;
          _context42.t0 = _context42['catch'](8);

          if (!(_context42.t0.type === 'VerifyError')) {
            _context42.next = 20;
            break;
          }

          peer.reject('block', _context42.t0);
          this.logger.warning(_context42.t0);
          return _context42.abrupt('return');

        case 20:
          throw _context42.t0;

        case 21:
          if (entry) {
            _context42.next = 31;
            break;
          }

          if (!this.checkpoints) {
            _context42.next = 25;
            break;
          }

          this.logger.warning('Peer sent orphan block with getheaders (%s).', peer.hostname());
          return _context42.abrupt('return');

        case 25:

          // During a getblocks sync, peers send
          // their best tip frequently. We can grab
          // the height commitment from the coinbase.
          height = block.getCoinbaseHeight();

          if (height !== -1) {
            peer.bestHash = hash;
            peer.bestHeight = height;
            this.resolveHeight(hash, height);
          }

          this.logger.debug('Peer sent an orphan block. Resolving.');

          _context42.next = 30;
          return this.resolveOrphan(peer, hash);

        case 30:
          return _context42.abrupt('return');

        case 31:

          if (this.chain.synced) {
            peer.bestHash = entry.hash;
            peer.bestHeight = entry.height;
            this.resolveHeight(entry.hash, entry.height);
          }

          this.logStatus(block);

          _context42.next = 35;
          return this.resolveChain(peer, hash);

        case 35:
        case 'end':
          return _context42.stop();
      }
    }
  }, addBlock, this, [[8, 14]]);
}));

/**
 * Resolve header chain.
 * @method
 * @private
 * @param {Peer} peer
 * @param {Hash} hash
 * @returns {Promise}
 */

Pool.prototype.resolveChain = co( /*#__PURE__*/_regenerator2.default.mark(function resolveChain(peer, hash) {
  var node;
  return _regenerator2.default.wrap(function resolveChain$(_context43) {
    while (1) {
      switch (_context43.prev = _context43.next) {
        case 0:
          node = this.headerChain.head;

          if (this.checkpoints) {
            _context43.next = 3;
            break;
          }

          return _context43.abrupt('return');

        case 3:
          if (peer.loader) {
            _context43.next = 5;
            break;
          }

          return _context43.abrupt('return');

        case 5:
          if (!peer.destroyed) {
            _context43.next = 7;
            break;
          }

          throw new Error('Peer was destroyed (header chain resolution).');

        case 7:

          assert(node);

          if (!(hash !== node.hash)) {
            _context43.next = 12;
            break;
          }

          this.logger.warning('Header hash mismatch %s != %s (%s).', util.revHex(hash), util.revHex(node.hash), peer.hostname());

          peer.destroy();

          return _context43.abrupt('return');

        case 12:
          if (!(node.height < this.network.lastCheckpoint)) {
            _context43.next = 21;
            break;
          }

          if (!(node.height === this.headerTip.height)) {
            _context43.next = 18;
            break;
          }

          this.logger.info('Received checkpoint %s (%d).', util.revHex(node.hash), node.height);

          this.headerTip = this.getNextTip(node.height);

          peer.sendGetHeaders([hash], this.headerTip.hash);

          return _context43.abrupt('return');

        case 18:

          this.headerChain.shift();
          this.resolveHeaders(peer);

          return _context43.abrupt('return');

        case 21:

          this.logger.info('Switching to getblocks (%s).', peer.hostname());

          _context43.next = 24;
          return this.switchSync(peer, hash);

        case 24:
        case 'end':
          return _context43.stop();
      }
    }
  }, resolveChain, this);
}));

/**
 * Switch to getblocks.
 * @method
 * @private
 * @param {Peer} peer
 * @param {Hash} hash
 * @returns {Promise}
 */

Pool.prototype.switchSync = co( /*#__PURE__*/_regenerator2.default.mark(function switchSync(peer, hash) {
  return _regenerator2.default.wrap(function switchSync$(_context44) {
    while (1) {
      switch (_context44.prev = _context44.next) {
        case 0:
          assert(this.checkpoints);

          this.checkpoints = false;
          this.chain.checkpoints = false;
          this.headerTip = null;
          this.headerChain.reset();
          this.headerNext = null;

          _context44.next = 8;
          return this.getBlocks(peer, hash);

        case 8:
        case 'end':
          return _context44.stop();
      }
    }
  }, switchSync, this);
}));

/**
 * Handle bad orphan.
 * @method
 * @private
 * @param {String} msg
 * @param {VerifyError} err
 * @param {Number} id
 */

Pool.prototype.handleBadOrphan = function handleBadOrphan(msg, err, id) {
  var peer = this.peers.find(id);

  if (!peer) {
    this.logger.warning('Could not find offending peer for orphan: %s (%d).', util.revHex(err.hash), id);
    return;
  }

  this.logger.debug('Punishing peer for sending a bad orphan (%s).', peer.hostname());

  // Punish the original peer who sent this.
  peer.reject(msg, err);
};

/**
 * Log sync status.
 * @private
 * @param {Block} block
 */

Pool.prototype.logStatus = function logStatus(block) {
  if (this.chain.height % 20 === 0) {
    this.logger.debug('Status:' + ' ts=%s height=%d progress=%s' + ' orphans=%d active=%d' + ' target=%s peers=%d', util.date(block.ts), this.chain.height, (this.chain.getProgress() * 100).toFixed(2) + '%', this.chain.orphanCount, this.blockMap.size, block.bits, this.peers.size());
  }

  if (this.chain.height % 2000 === 0) {
    this.logger.info('Received 2000 more blocks (height=%d, hash=%s).', this.chain.height, block.rhash());
  }
};

/**
 * Handle a transaction. Attempt to add to mempool.
 * @method
 * @private
 * @param {Peer} peer
 * @param {TXPacket} packet
 * @returns {Promise}
 */

Pool.prototype.handleTX = co( /*#__PURE__*/_regenerator2.default.mark(function handleTX(peer, packet) {
  var hash, unlock;
  return _regenerator2.default.wrap(function handleTX$(_context45) {
    while (1) {
      switch (_context45.prev = _context45.next) {
        case 0:
          hash = packet.tx.hash('hex');
          _context45.next = 3;
          return this.locker.lock(hash);

        case 3:
          unlock = _context45.sent;
          _context45.prev = 4;
          _context45.next = 7;
          return this._handleTX(peer, packet);

        case 7:
          return _context45.abrupt('return', _context45.sent);

        case 8:
          _context45.prev = 8;

          unlock();
          return _context45.finish(8);

        case 11:
        case 'end':
          return _context45.stop();
      }
    }
  }, handleTX, this, [[4,, 8, 11]]);
}));

/**
 * Handle a transaction. Attempt to add to mempool (without a lock).
 * @method
 * @private
 * @param {Peer} peer
 * @param {TXPacket} packet
 * @returns {Promise}
 */

Pool.prototype._handleTX = co( /*#__PURE__*/_regenerator2.default.mark(function handleTX(peer, packet) {
  var tx, hash, flags, block, missing;
  return _regenerator2.default.wrap(function handleTX$(_context46) {
    while (1) {
      switch (_context46.prev = _context46.next) {
        case 0:
          tx = packet.tx;
          hash = tx.hash('hex');
          flags = chainCommon.flags.VERIFY_NONE;
          block = peer.merkleBlock;

          if (!block) {
            _context46.next = 22;
            break;
          }

          assert(peer.merkleMatches > 0);
          assert(peer.merkleMap);

          if (!block.hasTX(hash)) {
            _context46.next = 22;
            break;
          }

          if (!peer.merkleMap.has(hash)) {
            _context46.next = 12;
            break;
          }

          this.logger.warning('Peer sent duplicate merkle tx: %s (%s).', tx.txid(), peer.hostname());
          peer.increaseBan(100);
          return _context46.abrupt('return');

        case 12:

          peer.merkleMap.insert(hash);

          block.addTX(tx);

          if (!(--peer.merkleMatches === 0)) {
            _context46.next = 21;
            break;
          }

          peer.merkleBlock = null;
          peer.merkleTime = -1;
          peer.merkleMatches = 0;
          peer.merkleMap = null;
          _context46.next = 21;
          return this._addBlock(peer, block, flags);

        case 21:
          return _context46.abrupt('return');

        case 22:
          if (this.resolveTX(peer, hash)) {
            _context46.next = 26;
            break;
          }

          this.logger.warning('Peer sent unrequested tx: %s (%s).', tx.txid(), peer.hostname());
          peer.destroy();
          return _context46.abrupt('return');

        case 26:
          if (this.mempool) {
            _context46.next = 29;
            break;
          }

          this.emit('tx', tx);
          return _context46.abrupt('return');

        case 29:
          _context46.prev = 29;
          _context46.next = 32;
          return this.mempool.addTX(tx, peer.id);

        case 32:
          missing = _context46.sent;
          _context46.next = 42;
          break;

        case 35:
          _context46.prev = 35;
          _context46.t0 = _context46['catch'](29);

          if (!(_context46.t0.type === 'VerifyError')) {
            _context46.next = 41;
            break;
          }

          peer.reject('tx', _context46.t0);
          this.logger.info(_context46.t0);
          return _context46.abrupt('return');

        case 41:
          throw _context46.t0;

        case 42:

          if (missing && missing.length > 0) {
            this.logger.debug('Requesting %d missing transactions (%s).', missing.length, peer.hostname());

            this.ensureTX(peer, missing);
          }

        case 43:
        case 'end':
          return _context46.stop();
      }
    }
  }, handleTX, this, [[29, 35]]);
}));

/**
 * Handle peer reject event.
 * @method
 * @private
 * @param {Peer} peer
 * @param {RejectPacket} packet
 */

Pool.prototype.handleReject = co( /*#__PURE__*/_regenerator2.default.mark(function handleReject(peer, packet) {
  var entry;
  return _regenerator2.default.wrap(function handleReject$(_context47) {
    while (1) {
      switch (_context47.prev = _context47.next) {
        case 0:

          this.logger.warning('Received reject (%s): msg=%s code=%s reason=%s hash=%s.', peer.hostname(), packet.message, packet.getCode(), packet.reason, packet.rhash());

          if (packet.hash) {
            _context47.next = 3;
            break;
          }

          return _context47.abrupt('return');

        case 3:

          entry = this.invMap.get(packet.hash);

          if (entry) {
            _context47.next = 6;
            break;
          }

          return _context47.abrupt('return');

        case 6:

          entry.handleReject(peer);

        case 7:
        case 'end':
          return _context47.stop();
      }
    }
  }, handleReject, this);
}));

/**
 * Handle `mempool` packet.
 * @method
 * @private
 * @param {Peer} peer
 * @param {MempoolPacket} packet
 */

Pool.prototype.handleMempool = co( /*#__PURE__*/_regenerator2.default.mark(function handleMempool(peer, packet) {
  var items, i, hash, hashes;
  return _regenerator2.default.wrap(function handleMempool$(_context48) {
    while (1) {
      switch (_context48.prev = _context48.next) {
        case 0:
          items = [];

          if (this.mempool) {
            _context48.next = 3;
            break;
          }

          return _context48.abrupt('return');

        case 3:
          if (this.chain.synced) {
            _context48.next = 5;
            break;
          }

          return _context48.abrupt('return');

        case 5:
          if (!this.options.selfish) {
            _context48.next = 7;
            break;
          }

          return _context48.abrupt('return');

        case 7:
          if (this.options.bip37) {
            _context48.next = 11;
            break;
          }

          this.logger.debug('Peer requested mempool without bip37 enabled (%s).', peer.hostname());
          peer.destroy();
          return _context48.abrupt('return');

        case 11:

          hashes = this.mempool.getSnapshot();

          for (i = 0; i < hashes.length; i++) {
            hash = hashes[i];
            items.push(new InvItem(invTypes.TX, hash));
          }

          this.logger.debug('Sending mempool snapshot (%s).', peer.hostname());

          peer.queueInv(items);

        case 15:
        case 'end':
          return _context48.stop();
      }
    }
  }, handleMempool, this);
}));

/**
 * Handle `filterload` packet.
 * @method
 * @private
 * @param {Peer} peer
 * @param {FilterLoadPacket} packet
 */

Pool.prototype.handleFilterLoad = co( /*#__PURE__*/_regenerator2.default.mark(function handleFilterLoad(peer, packet) {
  return _regenerator2.default.wrap(function handleFilterLoad$(_context49) {
    while (1) {
      switch (_context49.prev = _context49.next) {
        case 0:
          ;

        case 1:
        case 'end':
          return _context49.stop();
      }
    }
  }, handleFilterLoad, this);
}));

/**
 * Handle `filteradd` packet.
 * @method
 * @private
 * @param {Peer} peer
 * @param {FilterAddPacket} packet
 */

Pool.prototype.handleFilterAdd = co( /*#__PURE__*/_regenerator2.default.mark(function handleFilterAdd(peer, packet) {
  return _regenerator2.default.wrap(function handleFilterAdd$(_context50) {
    while (1) {
      switch (_context50.prev = _context50.next) {
        case 0:
          ;

        case 1:
        case 'end':
          return _context50.stop();
      }
    }
  }, handleFilterAdd, this);
}));

/**
 * Handle `filterclear` packet.
 * @method
 * @private
 * @param {Peer} peer
 * @param {FilterClearPacket} packet
 */

Pool.prototype.handleFilterClear = co( /*#__PURE__*/_regenerator2.default.mark(function handleFilterClear(peer, packet) {
  return _regenerator2.default.wrap(function handleFilterClear$(_context51) {
    while (1) {
      switch (_context51.prev = _context51.next) {
        case 0:
          ;

        case 1:
        case 'end':
          return _context51.stop();
      }
    }
  }, handleFilterClear, this);
}));

/**
 * Handle `merkleblock` packet.
 * @method
 * @private
 * @param {Peer} peer
 * @param {MerkleBlockPacket} block
 */

Pool.prototype.handleMerkleBlock = co( /*#__PURE__*/_regenerator2.default.mark(function handleMerkleBlock(peer, packet) {
  var hash, unlock;
  return _regenerator2.default.wrap(function handleMerkleBlock$(_context52) {
    while (1) {
      switch (_context52.prev = _context52.next) {
        case 0:
          hash = packet.block.hash('hex');
          _context52.next = 3;
          return this.locker.lock(hash);

        case 3:
          unlock = _context52.sent;
          _context52.prev = 4;
          _context52.next = 7;
          return this._handleMerkleBlock(peer, packet);

        case 7:
          return _context52.abrupt('return', _context52.sent);

        case 8:
          _context52.prev = 8;

          unlock();
          return _context52.finish(8);

        case 11:
        case 'end':
          return _context52.stop();
      }
    }
  }, handleMerkleBlock, this, [[4,, 8, 11]]);
}));

/**
 * Handle `merkleblock` packet (without a lock).
 * @method
 * @private
 * @param {Peer} peer
 * @param {MerkleBlockPacket} block
 */

Pool.prototype._handleMerkleBlock = co( /*#__PURE__*/_regenerator2.default.mark(function handleMerkleBlock(peer, packet) {
  var block, hash, flags;
  return _regenerator2.default.wrap(function handleMerkleBlock$(_context53) {
    while (1) {
      switch (_context53.prev = _context53.next) {
        case 0:
          block = packet.block;
          hash = block.hash('hex');
          flags = chainCommon.flags.VERIFY_NONE;

          if (this.syncing) {
            _context53.next = 5;
            break;
          }

          return _context53.abrupt('return');

        case 5:
          if (this.options.spv) {
            _context53.next = 9;
            break;
          }

          this.logger.warning('Peer sent unsolicited merkleblock (%s).', peer.hostname());
          peer.increaseBan(100);
          return _context53.abrupt('return');

        case 9:
          if (peer.blockMap.has(hash)) {
            _context53.next = 13;
            break;
          }

          this.logger.warning('Peer sent an unrequested merkleblock (%s).', peer.hostname());
          peer.destroy();
          return _context53.abrupt('return');

        case 13:
          if (!peer.merkleBlock) {
            _context53.next = 17;
            break;
          }

          this.logger.warning('Peer sent a merkleblock prematurely (%s).', peer.hostname());
          peer.increaseBan(100);
          return _context53.abrupt('return');

        case 17:
          if (block.verify()) {
            _context53.next = 21;
            break;
          }

          this.logger.warning('Peer sent an invalid merkleblock (%s).', peer.hostname());
          peer.increaseBan(100);
          return _context53.abrupt('return');

        case 21:
          if (!(block.tree.matches.length === 0)) {
            _context53.next = 25;
            break;
          }

          _context53.next = 24;
          return this._addBlock(peer, block, flags);

        case 24:
          return _context53.abrupt('return');

        case 25:

          peer.merkleBlock = block;
          peer.merkleTime = util.ms();
          peer.merkleMatches = block.tree.matches.length;
          peer.merkleMap = new Map();

        case 29:
        case 'end':
          return _context53.stop();
      }
    }
  }, handleMerkleBlock, this);
}));

/**
 * Handle `sendcmpct` packet.
 * @method
 * @private
 * @param {Peer} peer
 * @param {FeeFilterPacket} packet
 */

Pool.prototype.handleFeeFilter = co( /*#__PURE__*/_regenerator2.default.mark(function handleFeeFilter(peer, packet) {
  return _regenerator2.default.wrap(function handleFeeFilter$(_context54) {
    while (1) {
      switch (_context54.prev = _context54.next) {
        case 0:
          ;

        case 1:
        case 'end':
          return _context54.stop();
      }
    }
  }, handleFeeFilter, this);
}));

/**
 * Handle `sendcmpct` packet.
 * @method
 * @private
 * @param {Peer} peer
 * @param {SendCmpctPacket} packet
 */

Pool.prototype.handleSendCmpct = co( /*#__PURE__*/_regenerator2.default.mark(function handleSendCmpct(peer, packet) {
  return _regenerator2.default.wrap(function handleSendCmpct$(_context55) {
    while (1) {
      switch (_context55.prev = _context55.next) {
        case 0:
          ;

        case 1:
        case 'end':
          return _context55.stop();
      }
    }
  }, handleSendCmpct, this);
}));

/**
 * Handle `cmpctblock` packet.
 * @method
 * @private
 * @param {Peer} peer
 * @param {CompactBlockPacket} packet
 */

Pool.prototype.handleCmpctBlock = co( /*#__PURE__*/_regenerator2.default.mark(function handleCmpctBlock(peer, packet) {
  var block, hash, witness, flags, result;
  return _regenerator2.default.wrap(function handleCmpctBlock$(_context56) {
    while (1) {
      switch (_context56.prev = _context56.next) {
        case 0:
          block = packet.block;
          hash = block.hash('hex');
          witness = peer.compactWitness;
          flags = chainCommon.flags.VERIFY_BODY;

          if (this.syncing) {
            _context56.next = 6;
            break;
          }

          return _context56.abrupt('return');

        case 6:
          if (this.options.compact) {
            _context56.next = 10;
            break;
          }

          this.logger.info('Peer sent unsolicited cmpctblock (%s).', peer.hostname());
          this.destroy();
          return _context56.abrupt('return');

        case 10:
          if (!(!peer.hasCompactSupport() || !peer.hasCompact())) {
            _context56.next = 14;
            break;
          }

          this.logger.info('Peer sent unsolicited cmpctblock (%s).', peer.hostname());
          this.destroy();
          return _context56.abrupt('return');

        case 14:
          if (!peer.compactBlocks.has(hash)) {
            _context56.next = 17;
            break;
          }

          this.logger.debug('Peer sent us a duplicate compact block (%s).', peer.hostname());
          return _context56.abrupt('return');

        case 17:
          if (!this.compactBlocks.has(hash)) {
            _context56.next = 20;
            break;
          }

          this.logger.debug('Already waiting for compact block %s (%s).', hash, peer.hostname());
          return _context56.abrupt('return');

        case 20:
          if (peer.blockMap.has(hash)) {
            _context56.next = 28;
            break;
          }

          if (!(this.options.blockMode !== 1)) {
            _context56.next = 25;
            break;
          }

          this.logger.warning('Peer sent us an unrequested compact block (%s).', peer.hostname());
          peer.destroy();
          return _context56.abrupt('return');

        case 25:
          peer.blockMap.set(hash, util.ms());
          assert(!this.blockMap.has(hash));
          this.blockMap.insert(hash);

        case 28:
          if (this.mempool) {
            _context56.next = 31;
            break;
          }

          this.logger.warning('Requesting compact blocks without a mempool!');
          return _context56.abrupt('return');

        case 31:
          if (block.verify()) {
            _context56.next = 35;
            break;
          }

          this.logger.debug('Peer sent an invalid compact block (%s).', peer.hostname());
          peer.increaseBan(100);
          return _context56.abrupt('return');

        case 35:
          _context56.prev = 35;

          result = block.init();
          _context56.next = 44;
          break;

        case 39:
          _context56.prev = 39;
          _context56.t0 = _context56['catch'](35);

          this.logger.debug('Peer sent an invalid compact block (%s).', peer.hostname());
          peer.increaseBan(100);
          return _context56.abrupt('return');

        case 44:
          if (result) {
            _context56.next = 49;
            break;
          }

          this.logger.warning('Siphash collision for %s. Requesting full block (%s).', block.rhash(), peer.hostname());
          peer.getFullBlock(hash);
          peer.increaseBan(10);
          return _context56.abrupt('return');

        case 49:

          result = block.fillMempool(witness, this.mempool);

          if (!result) {
            _context56.next = 55;
            break;
          }

          this.logger.debug('Received full compact block %s (%s).', block.rhash(), peer.hostname());
          _context56.next = 54;
          return this.addBlock(peer, block.toBlock(), flags);

        case 54:
          return _context56.abrupt('return');

        case 55:
          if (!(this.options.blockMode === 1)) {
            _context56.next = 60;
            break;
          }

          if (!(peer.compactBlocks.size >= 15)) {
            _context56.next = 60;
            break;
          }

          this.logger.warning('Compact block DoS attempt (%s).', peer.hostname());
          peer.destroy();
          return _context56.abrupt('return');

        case 60:

          block.now = util.ms();

          assert(!peer.compactBlocks.has(hash));
          peer.compactBlocks.set(hash, block);

          this.compactBlocks.insert(hash);

          this.logger.debug('Received non-full compact block %s tx=%d/%d (%s).', block.rhash(), block.count, block.totalTX, peer.hostname());

          peer.send(new packets.GetBlockTxnPacket(block.toRequest()));

        case 66:
        case 'end':
          return _context56.stop();
      }
    }
  }, handleCmpctBlock, this, [[35, 39]]);
}));

/**
 * Handle `getblocktxn` packet.
 * @method
 * @private
 * @param {Peer} peer
 * @param {GetBlockTxnPacket} packet
 */

Pool.prototype.handleGetBlockTxn = co( /*#__PURE__*/_regenerator2.default.mark(function handleGetBlockTxn(peer, packet) {
  var req, res, item, block, height;
  return _regenerator2.default.wrap(function handleGetBlockTxn$(_context57) {
    while (1) {
      switch (_context57.prev = _context57.next) {
        case 0:
          req = packet.request;

          if (!this.chain.options.spv) {
            _context57.next = 3;
            break;
          }

          return _context57.abrupt('return');

        case 3:
          if (!this.chain.options.prune) {
            _context57.next = 5;
            break;
          }

          return _context57.abrupt('return');

        case 5:
          if (!this.options.selfish) {
            _context57.next = 7;
            break;
          }

          return _context57.abrupt('return');

        case 7:

          item = new InvItem(invTypes.BLOCK, req.hash);

          _context57.next = 10;
          return this.getItem(peer, item);

        case 10:
          block = _context57.sent;

          if (block) {
            _context57.next = 15;
            break;
          }

          this.logger.debug('Peer sent getblocktxn for non-existent block (%s).', peer.hostname());
          peer.increaseBan(100);
          return _context57.abrupt('return');

        case 15:
          _context57.next = 17;
          return this.chain.db.getHeight(req.hash);

        case 17:
          height = _context57.sent;

          if (!(height < this.chain.tip.height - 15)) {
            _context57.next = 21;
            break;
          }

          this.logger.debug('Peer sent a getblocktxn for a block > 15 deep (%s)', peer.hostname());
          return _context57.abrupt('return');

        case 21:

          this.logger.debug('Sending blocktxn for %s to peer (%s).', block.rhash(), peer.hostname());

          res = BIP152.TXResponse.fromBlock(block, req);

          peer.send(new packets.BlockTxnPacket(res, peer.compactWitness));

        case 24:
        case 'end':
          return _context57.stop();
      }
    }
  }, handleGetBlockTxn, this);
}));

/**
 * Handle `blocktxn` packet.
 * @method
 * @private
 * @param {Peer} peer
 * @param {BlockTxnPacket} packet
 */

Pool.prototype.handleBlockTxn = co( /*#__PURE__*/_regenerator2.default.mark(function handleBlockTxn(peer, packet) {
  var res, block, flags;
  return _regenerator2.default.wrap(function handleBlockTxn$(_context58) {
    while (1) {
      switch (_context58.prev = _context58.next) {
        case 0:
          res = packet.response;
          block = peer.compactBlocks.get(res.hash);
          flags = chainCommon.flags.VERIFY_BODY;

          if (block) {
            _context58.next = 6;
            break;
          }

          this.logger.debug('Peer sent unsolicited blocktxn (%s).', peer.hostname());
          return _context58.abrupt('return');

        case 6:

          peer.compactBlocks.remove(res.hash);

          assert(this.compactBlocks.has(res.hash));
          this.compactBlocks.remove(res.hash);

          if (block.fillMissing(res)) {
            _context58.next = 14;
            break;
          }

          this.logger.warning('Peer sent non-full blocktxn for %s. Requesting full block (%s).', block.rhash(), peer.hostname());
          peer.getFullBlock(res.hash);
          peer.increaseBan(10);
          return _context58.abrupt('return');

        case 14:

          this.logger.debug('Filled compact block %s (%s).', block.rhash(), peer.hostname());

          _context58.next = 17;
          return this.addBlock(peer, block.toBlock(), flags);

        case 17:
        case 'end':
          return _context58.stop();
      }
    }
  }, handleBlockTxn, this);
}));

/**
 * Handle `encinit` packet.
 * @method
 * @private
 * @param {Peer} peer
 * @param {EncinitPacket} packet
 */

Pool.prototype.handleEncinit = co( /*#__PURE__*/_regenerator2.default.mark(function handleEncinit(peer, packet) {
  return _regenerator2.default.wrap(function handleEncinit$(_context59) {
    while (1) {
      switch (_context59.prev = _context59.next) {
        case 0:
          ;

        case 1:
        case 'end':
          return _context59.stop();
      }
    }
  }, handleEncinit, this);
}));

/**
 * Handle `encack` packet.
 * @method
 * @private
 * @param {Peer} peer
 * @param {EncackPacket} packet
 */

Pool.prototype.handleEncack = co( /*#__PURE__*/_regenerator2.default.mark(function handleEncack(peer, packet) {
  return _regenerator2.default.wrap(function handleEncack$(_context60) {
    while (1) {
      switch (_context60.prev = _context60.next) {
        case 0:
          ;

        case 1:
        case 'end':
          return _context60.stop();
      }
    }
  }, handleEncack, this);
}));

/**
 * Handle `authchallenge` packet.
 * @method
 * @private
 * @param {Peer} peer
 * @param {AuthChallengePacket} packet
 */

Pool.prototype.handleAuthChallenge = co( /*#__PURE__*/_regenerator2.default.mark(function handleAuthChallenge(peer, packet) {
  return _regenerator2.default.wrap(function handleAuthChallenge$(_context61) {
    while (1) {
      switch (_context61.prev = _context61.next) {
        case 0:
          ;

        case 1:
        case 'end':
          return _context61.stop();
      }
    }
  }, handleAuthChallenge, this);
}));

/**
 * Handle `authreply` packet.
 * @method
 * @private
 * @param {Peer} peer
 * @param {AuthReplyPacket} packet
 */

Pool.prototype.handleAuthReply = co( /*#__PURE__*/_regenerator2.default.mark(function handleAuthReply(peer, packet) {
  return _regenerator2.default.wrap(function handleAuthReply$(_context62) {
    while (1) {
      switch (_context62.prev = _context62.next) {
        case 0:
          ;

        case 1:
        case 'end':
          return _context62.stop();
      }
    }
  }, handleAuthReply, this);
}));

/**
 * Handle `authpropose` packet.
 * @method
 * @private
 * @param {Peer} peer
 * @param {AuthProposePacket} packet
 */

Pool.prototype.handleAuthPropose = co( /*#__PURE__*/_regenerator2.default.mark(function handleAuthPropose(peer, packet) {
  return _regenerator2.default.wrap(function handleAuthPropose$(_context63) {
    while (1) {
      switch (_context63.prev = _context63.next) {
        case 0:
          ;

        case 1:
        case 'end':
          return _context63.stop();
      }
    }
  }, handleAuthPropose, this);
}));

/**
 * Handle `unknown` packet.
 * @method
 * @private
 * @param {Peer} peer
 * @param {UnknownPacket} packet
 */

Pool.prototype.handleUnknown = co( /*#__PURE__*/_regenerator2.default.mark(function handleUnknown(peer, packet) {
  return _regenerator2.default.wrap(function handleUnknown$(_context64) {
    while (1) {
      switch (_context64.prev = _context64.next) {
        case 0:
          this.logger.warning('Unknown packet: %s (%s).', packet.cmd, peer.hostname());

        case 1:
        case 'end':
          return _context64.stop();
      }
    }
  }, handleUnknown, this);
}));

/**
 * Create an inbound peer from an existing socket.
 * @private
 * @param {net.Socket} socket
 */

Pool.prototype.addInbound = function addInbound(socket) {
  var peer;

  if (!this.loaded) {
    socket.destroy();
    return;
  }

  peer = this.createInbound(socket);

  this.logger.info('Added inbound peer (%s).', peer.hostname());

  this.peers.add(peer);
};

/**
 * Allocate a host from the host list.
 * @returns {NetAddress}
 */

Pool.prototype.getHost = function getHost() {
  var services = this.options.getRequiredServices();
  var now = this.network.now();
  var i, entry, addr;

  for (i = 0; i < this.hosts.nodes.length; i++) {
    addr = this.hosts.nodes[i];

    if (this.peers.has(addr.hostname)) continue;

    return addr;
  }

  for (i = 0; i < 100; i++) {
    entry = this.hosts.getHost();

    if (!entry) break;

    addr = entry.addr;

    if (this.peers.has(addr.hostname)) continue;

    if (!addr.isValid()) continue;

    if (!addr.hasServices(services)) continue;

    if (!this.options.onion && addr.isOnion()) continue;

    if (i < 30 && now - entry.lastAttempt < 600) continue;

    if (i < 50 && addr.port !== this.network.port) continue;

    if (i < 95 && this.hosts.isBanned(addr.host)) continue;

    return entry.addr;
  }
};

/**
 * Create an outbound non-loader peer. These primarily
 * exist for transaction relaying.
 * @private
 */

Pool.prototype.addOutbound = function addOutbound() {
  var peer, addr;

  if (!this.loaded) return;

  if (this.peers.outbound >= this.options.maxOutbound) return;

  // Hang back if we don't
  // have a loader peer yet.
  if (!this.peers.load) return;

  addr = this.getHost();

  if (!addr) return;

  peer = this.createOutbound(addr);

  this.peers.add(peer);

  this.emit('peer', peer);
};

/**
 * Attempt to refill the pool with peers (no lock).
 * @private
 */

Pool.prototype.fillOutbound = function fillOutbound() {
  var need = this.options.maxOutbound - this.peers.outbound;
  var i;

  if (!this.peers.load) this.addLoader();

  if (need <= 0) return;

  this.logger.debug('Refilling peers (%d/%d).', this.peers.outbound, this.options.maxOutbound);

  for (i = 0; i < need; i++) {
    this.addOutbound();
  }
};

/**
 * Attempt to refill the pool with peers (no lock).
 * @private
 */

Pool.prototype.refill = function refill() {
  var self = this;

  if (this.pendingRefill != null) return;

  this.pendingRefill = setTimeout(function () {
    self.pendingRefill = null;
    self.fillOutbound();
  }, 3000);
};

/**
 * Remove a peer from any list. Drop all load requests.
 * @private
 * @param {Peer} peer
 */

Pool.prototype.removePeer = function removePeer(peer) {
  var i, hashes, hash;

  this.peers.remove(peer);

  hashes = peer.blockMap.keys();

  for (i = 0; i < hashes.length; i++) {
    hash = hashes[i];
    this.resolveBlock(peer, hash);
  }

  hashes = peer.txMap.keys();

  for (i = 0; i < hashes.length; i++) {
    hash = hashes[i];
    this.resolveTX(peer, hash);
  }

  hashes = peer.compactBlocks.keys();

  for (i = 0; i < hashes.length; i++) {
    hash = hashes[i];
    assert(this.compactBlocks.has(hash));
    this.compactBlocks.remove(hash);
  }

  peer.compactBlocks.reset();
};

/**
 * Ban peer.
 * @param {NetAddress} addr
 */

Pool.prototype.ban = function ban(addr) {
  var peer = this.peers.get(addr.hostname);

  this.logger.debug('Banning peer (%s).', addr.hostname);

  this.hosts.ban(addr.host);
  this.hosts.remove(addr.hostname);

  if (peer) peer.destroy();
};

/**
 * Unban peer.
 * @param {NetAddress} addr
 */

Pool.prototype.unban = function unban(addr) {
  this.hosts.unban(addr.host);
};

/**
 * Set the spv filter.
 * @param {Bloom} filter
 * @param {String?} enc
 */

Pool.prototype.setFilter = function setFilter(filter) {
  if (!this.options.spv) return;

  this.spvFilter = filter;
  this.queueFilterLoad();
};

/**
 * Watch a an address hash (filterload, SPV-only).
 * @param {Buffer|Hash} data
 * @param {String?} enc
 */

Pool.prototype.watch = function watch(data, enc) {
  if (!this.options.spv) return;

  this.spvFilter.add(data, enc);
  this.queueFilterLoad();
};

/**
 * Reset the spv filter (filterload, SPV-only).
 */

Pool.prototype.unwatch = function unwatch() {
  if (!this.options.spv) return;

  this.spvFilter.reset();
  this.queueFilterLoad();
};

/**
 * Queue a resend of the bloom filter.
 */

Pool.prototype.queueFilterLoad = function queueFilterLoad() {
  var self = this;

  if (!this.options.spv) return;

  if (this.pendingFilter != null) return;

  this.pendingFilter = setTimeout(function () {
    self.pendingFilter = null;
    self.sendFilterLoad();
  }, 100);
};

/**
 * Resend the bloom filter to peers.
 */

Pool.prototype.sendFilterLoad = function sendFilterLoad() {
  var peer;

  if (!this.options.spv) return;

  assert(this.spvFilter);

  for (peer = this.peers.head(); peer; peer = peer.next) {
    peer.sendFilterLoad(this.spvFilter);
  }
};

/**
 * Add an address to the bloom filter (SPV-only).
 * @param {Address|Base58Address} address
 */

Pool.prototype.watchAddress = function watchAddress(address) {
  var hash = Address.getHash(address);
  this.watch(hash);
};

/**
 * Add an outpoint to the bloom filter (SPV-only).
 * @param {Outpoint} outpoint
 */

Pool.prototype.watchOutpoint = function watchOutpoint(outpoint) {
  this.watch(outpoint.toRaw());
};

/**
 * Send `getblocks` to peer after building
 * locator and resolving orphan root.
 * @method
 * @param {Peer} peer
 * @param {Hash} orphan - Orphan hash to resolve.
 * @returns {Promise}
 */

Pool.prototype.resolveOrphan = co( /*#__PURE__*/_regenerator2.default.mark(function resolveOrphan(peer, orphan) {
  var locator, root;
  return _regenerator2.default.wrap(function resolveOrphan$(_context65) {
    while (1) {
      switch (_context65.prev = _context65.next) {
        case 0:
          _context65.next = 2;
          return this.chain.getLocator();

        case 2:
          locator = _context65.sent;
          root = this.chain.getOrphanRoot(orphan);


          assert(root);

          peer.sendGetBlocks(locator, root);

        case 6:
        case 'end':
          return _context65.stop();
      }
    }
  }, resolveOrphan, this);
}));

/**
 * Send `getheaders` to peer after building locator.
 * @method
 * @param {Peer} peer
 * @param {Hash} tip - Tip to build chain locator from.
 * @param {Hash?} stop
 * @returns {Promise}
 */

Pool.prototype.getHeaders = co( /*#__PURE__*/_regenerator2.default.mark(function getHeaders(peer, tip, stop) {
  var locator;
  return _regenerator2.default.wrap(function getHeaders$(_context66) {
    while (1) {
      switch (_context66.prev = _context66.next) {
        case 0:
          _context66.next = 2;
          return this.chain.getLocator(tip);

        case 2:
          locator = _context66.sent;

          peer.sendGetHeaders(locator, stop);

        case 4:
        case 'end':
          return _context66.stop();
      }
    }
  }, getHeaders, this);
}));

/**
 * Send `getblocks` to peer after building locator.
 * @method
 * @param {Peer} peer
 * @param {Hash} tip - Tip hash to build chain locator from.
 * @param {Hash?} stop
 * @returns {Promise}
 */

Pool.prototype.getBlocks = co( /*#__PURE__*/_regenerator2.default.mark(function getBlocks(peer, tip, stop) {
  var locator;
  return _regenerator2.default.wrap(function getBlocks$(_context67) {
    while (1) {
      switch (_context67.prev = _context67.next) {
        case 0:
          _context67.next = 2;
          return this.chain.getLocator(tip);

        case 2:
          locator = _context67.sent;

          peer.sendGetBlocks(locator, stop);

        case 4:
        case 'end':
          return _context67.stop();
      }
    }
  }, getBlocks, this);
}));

/**
 * Queue a `getdata` request to be sent.
 * @param {Peer} peer
 * @param {Hash[]} hashes
 */

Pool.prototype.getBlock = function getBlock(peer, hashes) {
  var now = util.ms();
  var items = [];
  var i, hash;

  if (!this.loaded) return;

  if (!peer.handshake) throw new Error('Peer handshake not complete (getdata).');

  if (peer.destroyed) throw new Error('Peer is destroyed (getdata).');

  for (i = 0; i < hashes.length; i++) {
    hash = hashes[i];

    if (this.blockMap.has(hash)) continue;

    this.blockMap.insert(hash);
    peer.blockMap.set(hash, now);

    if (this.chain.synced) now += 100;

    items.push(hash);
  }

  if (items.length === 0) return;

  this.logger.debug('Requesting %d/%d blocks from peer with getdata (%s).', items.length, this.blockMap.size, peer.hostname());

  peer.getBlock(items);
};

/**
 * Queue a `getdata` request to be sent.
 * @param {Peer} peer
 * @param {Hash[]} hashes
 */

Pool.prototype.getTX = function getTX(peer, hashes) {
  var now = util.ms();
  var items = [];
  var i, hash;

  if (!this.loaded) return;

  if (!peer.handshake) throw new Error('Peer handshake not complete (getdata).');

  if (peer.destroyed) throw new Error('Peer is destroyed (getdata).');

  for (i = 0; i < hashes.length; i++) {
    hash = hashes[i];

    if (this.txMap.has(hash)) continue;

    this.txMap.insert(hash);
    peer.txMap.set(hash, now);

    now += 50;

    items.push(hash);
  }

  if (items.length === 0) return;

  this.logger.debug('Requesting %d/%d txs from peer with getdata (%s).', items.length, this.txMap.size, peer.hostname());

  peer.getTX(items);
};

/**
 * Test whether the chain has or has seen an item.
 * @method
 * @param {Hash} hash
 * @returns {Promise} - Returns Boolean.
 */

Pool.prototype.hasBlock = co( /*#__PURE__*/_regenerator2.default.mark(function hasBlock(hash) {
  return _regenerator2.default.wrap(function hasBlock$(_context68) {
    while (1) {
      switch (_context68.prev = _context68.next) {
        case 0:
          if (!this.locker.has(hash)) {
            _context68.next = 2;
            break;
          }

          return _context68.abrupt('return', true);

        case 2:
          _context68.next = 4;
          return this.chain.has(hash);

        case 4:
          if (!_context68.sent) {
            _context68.next = 6;
            break;
          }

          return _context68.abrupt('return', true);

        case 6:
          return _context68.abrupt('return', false);

        case 7:
        case 'end':
          return _context68.stop();
      }
    }
  }, hasBlock, this);
}));

/**
 * Test whether the mempool has or has seen an item.
 * @param {Hash} hash
 * @returns {Boolean}
 */

Pool.prototype.hasTX = function hasTX(hash) {
  // Check the lock queue.
  if (this.locker.has(hash)) return true;

  if (!this.mempool) {
    // Check the TX filter if
    // we don't have a mempool.
    if (!this.txFilter.added(hash, 'hex')) return true;
  } else {
    // Check the mempool.
    if (this.mempool.has(hash)) return true;

    // If we recently rejected this item. Ignore.
    if (this.mempool.hasReject(hash)) {
      this.logger.spam('Saw known reject of %s.', util.revHex(hash));
      return true;
    }
  }

  return false;
};

/**
 * Queue a `getdata` request to be sent.
 * Check tx existence before requesting.
 * @param {Peer} peer
 * @param {Hash[]} hashes
 */

Pool.prototype.ensureTX = function ensureTX(peer, hashes) {
  var items = [];
  var i, hash;

  for (i = 0; i < hashes.length; i++) {
    hash = hashes[i];

    if (this.hasTX(hash)) continue;

    items.push(hash);
  }

  this.getTX(peer, items);
};

/**
 * Fulfill a requested tx.
 * @param {Peer} peer
 * @param {Hash} hash
 * @returns {Boolean}
 */

Pool.prototype.resolveTX = function resolveTX(peer, hash) {
  if (!peer.txMap.has(hash)) return false;

  peer.txMap.remove(hash);

  assert(this.txMap.has(hash));
  this.txMap.remove(hash);

  return true;
};

/**
 * Fulfill a requested block.
 * @param {Peer} peer
 * @param {Hash} hash
 * @returns {Boolean}
 */

Pool.prototype.resolveBlock = function resolveBlock(peer, hash) {
  if (!peer.blockMap.has(hash)) return false;

  peer.blockMap.remove(hash);

  assert(this.blockMap.has(hash));
  this.blockMap.remove(hash);

  return true;
};

/**
 * Fulfill a requested item.
 * @param {Peer} peer
 * @param {InvItem} item
 * @returns {Boolean}
 */

Pool.prototype.resolveItem = function resolveItem(peer, item) {
  if (item.isBlock()) return this.resolveBlock(peer, item.hash);

  if (item.isTX()) return this.resolveTX(peer, item.hash);

  return false;
};

/**
 * Broadcast a transaction or block.
 * @param {TX|Block} msg
 * @returns {Promise}
 */

Pool.prototype.broadcast = function broadcast(msg) {
  var hash = msg.hash('hex');
  var item = this.invMap.get(hash);

  if (item) {
    item.refresh();
    item.announce();
  } else {
    item = new BroadcastItem(this, msg);
    item.start();
    item.announce();
  }

  return new _promise2.default(function (resolve, reject) {
    item.addJob(resolve, reject);
  });
};

/**
 * Announce a block to all peers.
 * @param {Block} tx
 */

Pool.prototype.announceBlock = function announceBlock(msg) {
  var peer;

  for (peer = this.peers.head(); peer; peer = peer.next) {
    peer.announceBlock(msg);
  }
};

/**
 * Announce a transaction to all peers.
 * @param {TX} tx
 */

Pool.prototype.announceTX = function announceTX(msg) {
  var peer;

  for (peer = this.peers.head(); peer; peer = peer.next) {
    peer.announceTX(msg);
  }
};

/**
 * Attempt to retrieve external IP from icanhazip.com.
 * @method
 * @returns {Promise}
 */

Pool.prototype.getIP = co( /*#__PURE__*/_regenerator2.default.mark(function getIP() {
  var res, ip;
  return _regenerator2.default.wrap(function getIP$(_context69) {
    while (1) {
      switch (_context69.prev = _context69.next) {
        case 0:
          if (!request.unsupported) {
            _context69.next = 2;
            break;
          }

          throw new Error('Could not find IP.');

        case 2:
          _context69.prev = 2;
          _context69.next = 5;
          return request({
            method: 'GET',
            uri: 'http://icanhazip.com',
            expect: 'txt',
            timeout: 2000
          });

        case 5:
          res = _context69.sent;
          _context69.next = 13;
          break;

        case 8:
          _context69.prev = 8;
          _context69.t0 = _context69['catch'](2);
          _context69.next = 12;
          return this.getIP2();

        case 12:
          return _context69.abrupt('return', _context69.sent);

        case 13:

          ip = res.body.trim();

          _context69.prev = 14;

          ip = IP.normalize(ip);
          _context69.next = 23;
          break;

        case 18:
          _context69.prev = 18;
          _context69.t1 = _context69['catch'](14);
          _context69.next = 22;
          return this.getIP2();

        case 22:
          return _context69.abrupt('return', _context69.sent);

        case 23:
          return _context69.abrupt('return', ip);

        case 24:
        case 'end':
          return _context69.stop();
      }
    }
  }, getIP, this, [[2, 8], [14, 18]]);
}));

/**
 * Attempt to retrieve external IP from dyndns.org.
 * @method
 * @returns {Promise}
 */

Pool.prototype.getIP2 = co( /*#__PURE__*/_regenerator2.default.mark(function getIP2() {
  var res, match, ip;
  return _regenerator2.default.wrap(function getIP2$(_context70) {
    while (1) {
      switch (_context70.prev = _context70.next) {
        case 0:
          if (!request.unsupported) {
            _context70.next = 2;
            break;
          }

          throw new Error('Could not find IP.');

        case 2:
          _context70.next = 4;
          return request({
            method: 'GET',
            uri: 'http://checkip.dyndns.org',
            expect: 'html',
            timeout: 2000
          });

        case 4:
          res = _context70.sent;


          match = /IP Address:\s*([0-9a-f.:]+)/i.exec(res.body);

          if (match) {
            _context70.next = 8;
            break;
          }

          throw new Error('Could not find IP.');

        case 8:

          ip = match[1];

          return _context70.abrupt('return', IP.normalize(ip));

        case 10:
        case 'end':
          return _context70.stop();
      }
    }
  }, getIP2, this);
}));

/**
 * PoolOptions
 * @alias module:net.PoolOptions
 * @constructor
 */

function PoolOptions(options) {
  if (!(this instanceof PoolOptions)) return new PoolOptions(options);

  this.network = Network.primary;
  this.logger = null;
  this.chain = null;
  this.mempool = null;

  this.nonces = new NonceList();

  this.prefix = null;
  this.checkpoints = true;
  this.spv = false;
  this.bip37 = false;
  this.listen = false;
  this.compact = true;
  this.noRelay = false;
  this.host = '0.0.0.0';
  this.port = this.network.port;
  this.publicHost = '0.0.0.0';
  this.publicPort = this.network.port;
  this.maxOutbound = 8;
  this.maxInbound = 8;
  this.createSocket = this._createSocket.bind(this);
  this.createServer = tcp.createServer;
  this.resolve = this._resolve.bind(this);
  this.proxy = null;
  this.onion = false;
  this.upnp = false;
  this.selfish = false;
  this.version = common.PROTOCOL_VERSION;
  this.agent = common.USER_AGENT;
  this.bip151 = false;
  this.bip150 = false;
  this.authPeers = [];
  this.knownPeers = {};
  this.identityKey = ec.generatePrivateKey();
  this.banScore = common.BAN_SCORE;
  this.banTime = common.BAN_TIME;
  this.feeRate = -1;
  this.seeds = this.network.seeds;
  this.nodes = [];
  this.invTimeout = 60000;
  this.blockMode = 0;
  this.services = common.LOCAL_SERVICES;
  this.requiredServices = common.REQUIRED_SERVICES;
  this.persistent = false;

  this.fromOptions(options);
}

/**
 * Inject properties from object.
 * @private
 * @param {Object} options
 * @returns {PoolOptions}
 */

PoolOptions.prototype.fromOptions = function fromOptions(options) {
  var raw;

  assert(options, 'Pool requires options.');
  assert(options.chain && (0, _typeof3.default)(options.chain) === 'object', 'Pool options require a blockchain.');

  this.chain = options.chain;
  this.network = options.chain.network;
  this.logger = options.chain.logger;

  this.port = this.network.port;
  this.seeds = this.network.seeds;
  this.port = this.network.port;
  this.publicPort = this.network.port;

  if (options.logger != null) {
    assert((0, _typeof3.default)(options.logger) === 'object');
    this.logger = options.logger;
  }

  if (options.mempool != null) {
    assert((0, _typeof3.default)(options.mempool) === 'object');
    this.mempool = options.mempool;
  }

  if (options.prefix != null) {
    assert(typeof options.prefix === 'string');
    this.prefix = options.prefix;
  }

  if (options.checkpoints != null) {
    assert(typeof options.checkpoints === 'boolean');
    assert(options.checkpoints === this.chain.options.checkpoints);
    this.checkpoints = options.checkpoints;
  } else {
    this.checkpoints = this.chain.options.checkpoints;
  }

  if (options.spv != null) {
    assert(typeof options.spv === 'boolean');
    assert(options.spv === this.chain.options.spv);
    this.spv = options.spv;
  } else {
    this.spv = this.chain.options.spv;
  }

  if (options.bip37 != null) {
    assert(typeof options.bip37 === 'boolean');
    this.bip37 = options.bip37;
  }

  if (options.listen != null) {
    assert(typeof options.listen === 'boolean');
    this.listen = options.listen;
  }

  if (options.compact != null) {
    assert(typeof options.compact === 'boolean');
    this.compact = options.compact;
  }

  if (options.noRelay != null) {
    assert(typeof options.noRelay === 'boolean');
    this.noRelay = options.noRelay;
  }

  if (options.host != null) {
    assert(typeof options.host === 'string');
    raw = IP.toBuffer(options.host);
    this.host = IP.toString(raw);
    if (IP.isRoutable(raw)) this.publicHost = this.host;
  }

  if (options.port != null) {
    assert(typeof options.port === 'number');
    assert(options.port > 0 && options.port <= 0xffff);
    this.port = options.port;
    this.publicPort = options.port;
  }

  if (options.publicHost != null) {
    assert(typeof options.publicHost === 'string');
    this.publicHost = IP.normalize(options.publicHost);
  }

  if (options.publicPort != null) {
    assert(typeof options.publicPort === 'number');
    assert(options.publicPort > 0 && options.publicPort <= 0xffff);
    this.publicPort = options.publicPort;
  }

  if (options.maxOutbound != null) {
    assert(typeof options.maxOutbound === 'number');
    assert(options.maxOutbound > 0);
    this.maxOutbound = options.maxOutbound;
  }

  if (options.maxInbound != null) {
    assert(typeof options.maxInbound === 'number');
    this.maxInbound = options.maxInbound;
  }

  if (options.createSocket) {
    assert(typeof options.createSocket === 'function');
    this.createSocket = options.createSocket;
  }

  if (options.createServer) {
    assert(typeof options.createServer === 'function');
    this.createServer = options.createServer;
  }

  if (options.resolve) {
    assert(typeof options.resolve === 'function');
    this.resolve = options.resolve;
  }

  if (options.proxy) {
    assert(typeof options.proxy === 'string');
    this.proxy = options.proxy;
  }

  if (options.onion != null) {
    assert(typeof options.onion === 'boolean');
    this.onion = options.onion;
  }

  if (options.upnp != null) {
    assert(typeof options.upnp === 'boolean');
    this.upnp = options.upnp;
  }

  if (options.selfish) {
    assert(typeof options.selfish === 'boolean');
    this.selfish = options.selfish;
  }

  if (options.version) {
    assert(typeof options.version === 'number');
    this.version = options.version;
  }

  if (options.agent) {
    assert(typeof options.agent === 'string');
    assert(options.agent.length <= 255);
    this.agent = options.agent;
  }

  if (options.bip151 != null) {
    assert(typeof options.bip151 === 'boolean');
    this.bip151 = options.bip151;
  }

  if (options.bip150 != null) {
    assert(typeof options.bip150 === 'boolean');
    assert(this.bip151, 'Cannot enable bip150 without bip151.');

    if (options.knownPeers) {
      assert((0, _typeof3.default)(options.knownPeers) === 'object');
      assert(!Array.isArray(options.knownPeers));
      this.knownPeers = options.knownPeers;
    }

    if (options.authPeers) {
      assert(Array.isArray(options.authPeers));
      this.authPeers = options.authPeers;
    }

    if (options.identityKey) {
      assert(Buffer.isBuffer(options.identityKey), 'Identity key must be a buffer.');
      assert(ec.privateKeyVerify(options.identityKey), 'Invalid identity key.');
      this.identityKey = options.identityKey;
    }
  }

  if (options.banScore != null) {
    assert(typeof this.options.banScore === 'number');
    this.banScore = this.options.banScore;
  }

  if (options.banTime != null) {
    assert(typeof this.options.banTime === 'number');
    this.banTime = this.options.banTime;
  }

  if (options.feeRate != null) {
    assert(typeof this.options.feeRate === 'number');
    this.feeRate = this.options.feeRate;
  }

  if (options.seeds) {
    assert(Array.isArray(options.seeds));
    this.seeds = options.seeds;
  }

  if (options.nodes) {
    assert(Array.isArray(options.nodes));
    this.nodes = options.nodes;
  }

  if (options.only != null) {
    assert(Array.isArray(options.only));
    if (options.only.length > 0) {
      this.nodes = options.only;
      this.maxOutbound = options.only.length;
    }
  }

  if (options.invTimeout != null) {
    assert(typeof options.invTimeout === 'number');
    this.invTimeout = options.invTimeout;
  }

  if (options.blockMode != null) {
    assert(typeof options.blockMode === 'number');
    this.blockMode = options.blockMode;
  }

  if (options.persistent != null) {
    assert(typeof options.persistent === 'boolean');
    this.persistent = options.persistent;
  }

  if (this.spv) {
    this.requiredServices |= common.services.BLOOM;
    this.services &= ~common.services.NETWORK;
    this.noRelay = true;
    this.checkpoints = true;
    this.compact = false;
    this.bip37 = false;
    this.listen = false;
  }

  if (this.selfish) {
    this.services &= ~common.services.NETWORK;
    this.bip37 = false;
  }

  if (this.bip37) this.services |= common.services.BLOOM;

  if (this.proxy) this.listen = false;

  if (options.services != null) {
    assert(util.isUInt32(options.services));
    this.services = options.services;
  }

  if (options.requiredServices != null) {
    assert(util.isUInt32(options.requiredServices));
    this.requiredServices = options.requiredServices;
  }

  return this;
};

/**
 * Instantiate options from object.
 * @param {Object} options
 * @returns {PoolOptions}
 */

PoolOptions.fromOptions = function fromOptions(options) {
  return new PoolOptions().fromOptions(options);
};

/**
 * Get the chain height.
 * @private
 * @returns {Number}
 */

PoolOptions.prototype.getHeight = function getHeight() {
  return this.chain.height;
};

/**
 * Test whether the chain is synced.
 * @private
 * @returns {Boolean}
 */

PoolOptions.prototype.isFull = function isFull() {
  return this.chain.synced;
};

/**
 * Get required services for outbound peers.
 * @private
 * @returns {Number}
 */

PoolOptions.prototype.getRequiredServices = function getRequiredServices() {
  var services = this.requiredServices;
  if (this.hasWitness()) services |= common.services.WITNESS;
  return services;
};

/**
 * Whether segwit is enabled.
 * @private
 * @returns {Boolean}
 */

PoolOptions.prototype.hasWitness = function hasWitness() {
  return this.chain.state.hasWitness();
};

/**
 * Create a version packet nonce.
 * @private
 * @param {String} hostname
 * @returns {Buffer}
 */

PoolOptions.prototype.createNonce = function createNonce(hostname) {
  return this.nonces.alloc(hostname);
};

/**
 * Test whether version nonce is ours.
 * @private
 * @param {Buffer} nonce
 * @returns {Boolean}
 */

PoolOptions.prototype.hasNonce = function hasNonce(nonce) {
  return this.nonces.has(nonce);
};

/**
 * Get fee rate for txid.
 * @private
 * @param {Hash} hash
 * @returns {Rate}
 */

PoolOptions.prototype.getRate = function getRate(hash) {
  var entry;

  if (!this.mempool) return -1;

  entry = this.mempool.getEntry(hash);

  if (!entry) return -1;

  return entry.getRate();
};

/**
 * Default createSocket call.
 * @private
 * @param {Number} port
 * @param {String} host
 * @returns {net.Socket}
 */

PoolOptions.prototype._createSocket = function createSocket(port, host) {
  return tcp.createSocket(port, host, this.proxy);
};

/**
 * Default resolve call.
 * @private
 * @param {String} name
 * @returns {String[]}
 */

PoolOptions.prototype._resolve = function resolve(name) {
  if (this.onion) return dns.lookup(name, this.proxy);

  return dns.lookup(name);
};

/**
 * Peer List
 * @alias module:net.PeerList
 * @constructor
 * @param {Object} options
 */

function PeerList() {
  this.map = {};
  this.ids = {};
  this.list = new List();
  this.load = null;
  this.inbound = 0;
  this.outbound = 0;
}

/**
 * Get the list head.
 * @returns {Peer}
 */

PeerList.prototype.head = function head() {
  return this.list.head;
};

/**
 * Get the list tail.
 * @returns {Peer}
 */

PeerList.prototype.tail = function tail() {
  return this.list.tail;
};

/**
 * Get list size.
 * @returns {Number}
 */

PeerList.prototype.size = function size() {
  return this.list.size;
};

/**
 * Add peer to list.
 * @param {Peer} peer
 */

PeerList.prototype.add = function add(peer) {
  assert(this.list.push(peer));

  assert(!this.map[peer.hostname()]);
  this.map[peer.hostname()] = peer;

  assert(!this.ids[peer.id]);
  this.ids[peer.id] = peer;

  if (peer.outbound) this.outbound++;else this.inbound++;
};

/**
 * Remove peer from list.
 * @param {Peer} peer
 */

PeerList.prototype.remove = function remove(peer) {
  assert(this.list.remove(peer));

  assert(this.ids[peer.id]);
  delete this.ids[peer.id];

  assert(this.map[peer.hostname()]);
  delete this.map[peer.hostname()];

  if (peer === this.load) {
    assert(peer.loader);
    peer.loader = false;
    this.load = null;
  }

  if (peer.outbound) this.outbound--;else this.inbound--;
};

/**
 * Get peer by hostname.
 * @param {String} hostname
 * @returns {Peer}
 */

PeerList.prototype.get = function get(hostname) {
  return this.map[hostname];
};

/**
 * Test whether a peer exists.
 * @param {String} hostname
 * @returns {Boolean}
 */

PeerList.prototype.has = function has(hostname) {
  return this.map[hostname] != null;
};

/**
 * Get peer by ID.
 * @param {Number} id
 * @returns {Peer}
 */

PeerList.prototype.find = function find(id) {
  return this.ids[id];
};

/**
 * Destroy peer list (kills peers).
 */

PeerList.prototype.destroy = function destroy() {
  var peer, next;

  for (peer = this.list.head; peer; peer = next) {
    next = peer.next;
    peer.destroy();
  }
};

/**
 * Represents an item that is broadcasted via an inv/getdata cycle.
 * @alias module:net.BroadcastItem
 * @constructor
 * @private
 * @param {Pool} pool
 * @param {TX|Block} msg
 * @emits BroadcastItem#ack
 * @emits BroadcastItem#reject
 * @emits BroadcastItem#timeout
 */

function BroadcastItem(pool, msg) {
  var item;

  if (!(this instanceof BroadcastItem)) return new BroadcastItem(pool, msg);

  assert(!msg.mutable, 'Cannot broadcast mutable item.');

  item = msg.toInv();

  this.pool = pool;
  this.hash = item.hash;
  this.type = item.type;
  this.msg = msg;
  this.jobs = [];
}

util.inherits(BroadcastItem, EventEmitter);

/**
 * Add a job to be executed on ack, timeout, or reject.
 * @returns {Promise}
 */

BroadcastItem.prototype.addJob = function addJob(resolve, reject) {
  this.jobs.push(co.job(resolve, reject));
};

/**
 * Start the broadcast.
 */

BroadcastItem.prototype.start = function start() {
  assert(!this.timeout, 'Already started.');
  assert(!this.pool.invMap.has(this.hash), 'Already started.');

  this.pool.invMap.set(this.hash, this);

  this.refresh();

  return this;
};

/**
 * Refresh the timeout on the broadcast.
 */

BroadcastItem.prototype.refresh = function refresh() {
  var self = this;

  if (this.timeout != null) {
    clearTimeout(this.timeout);
    this.timeout = null;
  }

  this.timeout = setTimeout(function () {
    self.emit('timeout');
    self.reject(new Error('Timed out.'));
  }, this.pool.options.invTimeout);
};

/**
 * Announce the item.
 */

BroadcastItem.prototype.announce = function announce() {
  switch (this.type) {
    case invTypes.TX:
      this.pool.announceTX(this.msg);
      break;
    case invTypes.BLOCK:
      this.pool.announceBlock(this.msg);
      break;
    default:
      assert(false, 'Bad type.');
      break;
  }
};

/**
 * Finish the broadcast.
 */

BroadcastItem.prototype.cleanup = function cleanup() {
  assert(this.timeout != null, 'Already finished.');
  assert(this.pool.invMap.has(this.hash), 'Already finished.');

  clearTimeout(this.timeout);
  this.timeout = null;

  this.pool.invMap.remove(this.hash);
};

/**
 * Finish the broadcast, return with an error.
 * @param {Error} err
 */

BroadcastItem.prototype.reject = function reject(err) {
  var i, job;

  this.cleanup();

  for (i = 0; i < this.jobs.length; i++) {
    job = this.jobs[i];
    job.reject(err);
  }

  this.jobs.length = 0;
};

/**
 * Finish the broadcast successfully.
 */

BroadcastItem.prototype.resolve = function resolve() {
  var i, job;

  this.cleanup();

  for (i = 0; i < this.jobs.length; i++) {
    job = this.jobs[i];
    job.resolve(false);
  }

  this.jobs.length = 0;
};

/**
 * Handle an ack from a peer.
 * @param {Peer} peer
 */

BroadcastItem.prototype.handleAck = function handleAck(peer) {
  var self = this;
  var i, job;

  setTimeout(function () {
    self.emit('ack', peer);

    for (i = 0; i < self.jobs.length; i++) {
      job = self.jobs[i];
      job.resolve(true);
    }

    self.jobs.length = 0;
  }, 1000);
};

/**
 * Handle a reject from a peer.
 * @param {Peer} peer
 */

BroadcastItem.prototype.handleReject = function handleReject(peer) {
  var i, job;

  this.emit('reject', peer);

  for (i = 0; i < this.jobs.length; i++) {
    job = this.jobs[i];
    job.resolve(false);
  }

  this.jobs.length = 0;
};

/**
 * Inspect the broadcast item.
 * @returns {String}
 */

BroadcastItem.prototype.inspect = function inspect() {
  return '<BroadcastItem:' + ' type=' + (this.type === invTypes.TX ? 'tx' : 'block') + ' hash=' + util.revHex(this.hash) + '>';
};

/**
 * NonceList
 * @constructor
 * @ignore
 */

function NonceList() {
  this.map = {};
  this.hosts = {};
}

NonceList.prototype.alloc = function alloc(hostname) {
  var nonce, key;

  for (;;) {
    nonce = util.nonce();
    key = nonce.toString('hex');
    if (!this.map[key]) {
      this.map[key] = hostname;
      assert(!this.hosts[hostname]);
      this.hosts[hostname] = key;
      break;
    }
  }

  return nonce;
};

NonceList.prototype.has = function has(nonce) {
  var key = nonce.toString('hex');
  return this.map[key] != null;
};

NonceList.prototype.remove = function remove(hostname) {
  var key = this.hosts[hostname];

  if (!key) return false;

  delete this.hosts[hostname];

  assert(this.map[key]);
  delete this.map[key];

  return true;
};

/**
 * HeaderEntry
 * @constructor
 * @ignore
 */

function HeaderEntry(hash, height) {
  this.hash = hash;
  this.height = height;
  this.prev = null;
  this.next = null;
}

/*
 * Expose
 */

module.exports = Pool;