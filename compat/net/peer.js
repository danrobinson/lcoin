/*!
 * peer.js - peer object for bcoin
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
var util = require('../utils/util');
var co = require('../utils/co');
var Map = require('../utils/map');
var Parser = require('./parser');
var Framer = require('./framer');
var packets = require('./packets');
var consensus = require('../protocol/consensus');
var common = require('./common');
var InvItem = require('../primitives/invitem');
var Lock = require('../utils/lock');
var Bloom = require('../utils/bloom');
var BIP151 = require('./bip151');
var BIP150 = require('./bip150');
var BIP152 = require('./bip152');
var Block = require('../primitives/block');
var TX = require('../primitives/tx');
var encoding = require('../utils/encoding');
var NetAddress = require('../primitives/netaddress');
var Network = require('../protocol/network');
var Logger = require('../node/logger');
var tcp = require('./tcp');
var services = common.services;
var invTypes = InvItem.types;
var packetTypes = packets.types;

/**
 * Represents a remote peer.
 * @alias module:net.Peer
 * @constructor
 * @param {PeerOptions} options
 * @property {net.Socket} socket
 * @property {NetAddress} address
 * @property {Parser} parser
 * @property {Framer} framer
 * @property {Number} version
 * @property {Boolean} destroyed
 * @property {Boolean} ack - Whether verack has been received.
 * @property {Boolean} connected
 * @property {Number} ts
 * @property {Boolean} preferHeaders - Whether the peer has
 * requested getheaders.
 * @property {Hash?} hashContinue - The block hash at which to continue
 * the sync for the peer.
 * @property {Bloom?} spvFilter - The _peer's_ bloom spvFilter.
 * @property {Boolean} noRelay - Whether to relay transactions
 * immediately to the peer.
 * @property {BN} challenge - Local nonce.
 * @property {Number} lastPong - Timestamp for last `pong`
 * received (unix time).
 * @property {Number} lastPing - Timestamp for last `ping`
 * sent (unix time).
 * @property {Number} minPing - Lowest ping time seen.
 * @property {Number} banScore
 * @emits Peer#ack
 */

function Peer(options) {
  if (!(this instanceof Peer)) return new Peer(options);

  EventEmitter.call(this);

  this.options = options;
  this.network = this.options.network;
  this.logger = this.options.logger.context('peer');
  this.locker = new Lock();

  this.parser = new Parser(this.network);
  this.framer = new Framer(this.network);

  this.id = -1;
  this.socket = null;
  this.opened = false;
  this.outbound = false;
  this.loader = false;
  this.address = new NetAddress();
  this.local = new NetAddress();
  this.connected = false;
  this.destroyed = false;
  this.ack = false;
  this.handshake = false;
  this.ts = 0;
  this.lastSend = 0;
  this.lastRecv = 0;
  this.drainSize = 0;
  this.drainQueue = [];
  this.banScore = 0;
  this.invQueue = [];
  this.onPacket = null;

  this.next = null;
  this.prev = null;

  this.version = -1;
  this.services = 0;
  this.height = -1;
  this.agent = null;
  this.noRelay = false;
  this.preferHeaders = false;
  this.hashContinue = null;
  this.spvFilter = null;
  this.feeRate = -1;
  this.bip151 = null;
  this.bip150 = null;
  this.compactMode = -1;
  this.compactWitness = false;
  this.merkleBlock = null;
  this.merkleTime = -1;
  this.merkleMatches = 0;
  this.merkleMap = null;
  this.syncing = false;
  this.sentAddr = false;
  this.sentGetAddr = false;
  this.challenge = null;
  this.lastPong = -1;
  this.lastPing = -1;
  this.minPing = -1;
  this.blockTime = -1;

  this.bestHash = null;
  this.bestHeight = -1;

  this.connectTimeout = null;
  this.pingTimer = null;
  this.invTimer = null;
  this.stallTimer = null;

  this.addrFilter = new Bloom.Rolling(5000, 0.001);
  this.invFilter = new Bloom.Rolling(50000, 0.000001);

  this.blockMap = new Map();
  this.txMap = new Map();
  this.responseMap = new Map();
  this.compactBlocks = new Map();

  this._init();
}

util.inherits(Peer, EventEmitter);

/**
 * Max output bytes buffered before
 * invoking stall behavior for peer.
 * @const {Number}
 * @default
 */

Peer.DRAIN_MAX = 10 << 20;

/**
 * Interval to check for drainage
 * and required responses from peer.
 * @const {Number}
 * @default
 */

Peer.STALL_INTERVAL = 5000;

/**
 * Interval for pinging peers.
 * @const {Number}
 * @default
 */

Peer.PING_INTERVAL = 30000;

/**
 * Interval to flush invs.
 * Higher means more invs (usually
 * txs) will be accumulated before
 * flushing.
 * @const {Number}
 * @default
 */

Peer.INV_INTERVAL = 5000;

/**
 * Required time for peers to
 * respond to messages (i.e.
 * getblocks/getdata).
 * @const {Number}
 * @default
 */

Peer.RESPONSE_TIMEOUT = 30000;

/**
 * Required time for loader to
 * respond with block/merkleblock.
 * @const {Number}
 * @default
 */

Peer.BLOCK_TIMEOUT = 120000;

/**
 * Required time for loader to
 * respond with a tx.
 * @const {Number}
 * @default
 */

Peer.TX_TIMEOUT = 120000;

/**
 * Generic timeout interval.
 * @const {Number}
 * @default
 */

Peer.TIMEOUT_INTERVAL = 20 * 60000;

/**
 * Create inbound peer from socket.
 * @param {PeerOptions} options
 * @param {net.Socket} socket
 * @returns {Peer}
 */

Peer.fromInbound = function fromInbound(options, socket) {
  var peer = new Peer(options);
  peer.accept(socket);
  return peer;
};

/**
 * Create outbound peer from net address.
 * @param {PeerOptions} options
 * @param {NetAddress} addr
 * @returns {Peer}
 */

Peer.fromOutbound = function fromOutbound(options, addr) {
  var peer = new Peer(options);
  peer.connect(addr);
  return peer;
};

/**
 * Create a peer from options.
 * @param {Object} options
 * @returns {Peer}
 */

Peer.fromOptions = function fromOptions(options) {
  return new Peer(new PeerOptions(options));
};

/**
 * Begin peer initialization.
 * @private
 */

Peer.prototype._init = function init() {
  var self = this;

  this.parser.on('packet', co( /*#__PURE__*/_regenerator2.default.mark(function _callee(packet) {
    return _regenerator2.default.wrap(function _callee$(_context) {
      while (1) {
        switch (_context.prev = _context.next) {
          case 0:
            _context.prev = 0;
            _context.next = 3;
            return self.readPacket(packet);

          case 3:
            _context.next = 9;
            break;

          case 5:
            _context.prev = 5;
            _context.t0 = _context['catch'](0);

            self.error(_context.t0);
            self.destroy();

          case 9:
          case 'end':
            return _context.stop();
        }
      }
    }, _callee, this, [[0, 5]]);
  })));

  this.parser.on('error', function (err) {
    if (self.destroyed) return;

    self.error(err);
    self.sendReject('malformed', 'error parsing message');
    self.increaseBan(10);
  });
};

/**
 * Getter to retrieve hostname.
 * @returns {String}
 */

Peer.prototype.hostname = function hostname() {
  return this.address.hostname;
};

/**
 * Frame a payload with a header.
 * @param {String} cmd - Packet type.
 * @param {Buffer} payload
 * @returns {Buffer} Payload with header prepended.
 */

Peer.prototype.framePacket = function framePacket(cmd, payload, checksum) {
  if (this.bip151 && this.bip151.handshake) return this.bip151.packet(cmd, payload);
  return this.framer.packet(cmd, payload, checksum);
};

/**
 * Feed data to the parser.
 * @param {Buffer} data
 */

Peer.prototype.feedParser = function feedParser(data) {
  if (this.bip151 && this.bip151.handshake) return this.bip151.feed(data);
  return this.parser.feed(data);
};

/**
 * Set BIP151 cipher type.
 * @param {Number} cipher
 */

Peer.prototype.setCipher = function setCipher(cipher) {
  var self = this;

  assert(!this.bip151, 'BIP151 already set.');
  assert(this.socket, 'Peer must be initialized with a socket.');
  assert(!this.opened, 'Cannot set cipher after open.');

  this.bip151 = new BIP151(cipher);

  this.bip151.on('error', function (err) {
    self.error(err);
    self.destroy();
  });

  this.bip151.on('rekey', function () {
    if (self.destroyed) return;

    self.logger.debug('Rekeying with peer (%s).', self.hostname());
    self.send(self.bip151.toRekey());
  });

  this.bip151.on('packet', function (cmd, body) {
    var payload;
    try {
      payload = self.parser.parsePayload(cmd, body);
    } catch (e) {
      self.parser.error(e);
      return;
    }
    self.parser.emit('packet', payload);
  });
};

/**
 * Set BIP150 auth.
 * @param {AuthDB} db
 * @param {Buffer} key
 */

Peer.prototype.setAuth = function setAuth(db, key) {
  var bip151 = this.bip151;
  var hostname = this.hostname();
  var outbound = this.outbound;

  assert(this.bip151, 'BIP151 not set.');
  assert(!this.bip150, 'BIP150 already set.');
  assert(this.socket, 'Peer must be initialized with a socket.');
  assert(!this.opened, 'Cannot set auth after open.');

  this.bip150 = new BIP150(bip151, hostname, outbound, db, key);
  this.bip151.bip150 = this.bip150;
};

/**
 * Bind to socket.
 * @param {net.Socket} socket
 */

Peer.prototype.bind = function bind(socket) {
  var self = this;

  assert(!this.socket);

  this.socket = socket;

  this.socket.once('error', function (err) {
    if (!self.connected) return;

    self.error(err);
    self.destroy();
  });

  this.socket.once('close', function () {
    self.error('Socket hangup.');
    self.destroy();
  });

  this.socket.on('drain', function () {
    self.handleDrain();
  });

  this.socket.on('data', function (chunk) {
    self.lastRecv = util.ms();
    self.feedParser(chunk);
  });

  this.socket.setNoDelay(true);
};

/**
 * Accept an inbound socket.
 * @param {net.Socket} socket
 * @returns {net.Socket}
 */

Peer.prototype.accept = function accept(socket) {
  assert(!this.socket);

  this.address = NetAddress.fromSocket(socket, this.network);
  this.address.services = 0;
  this.ts = util.ms();
  this.outbound = false;
  this.connected = true;

  this.bind(socket);

  return socket;
};

/**
 * Create the socket and begin connecting. This method
 * will use `options.createSocket` if provided.
 * @param {NetAddress} addr
 * @returns {net.Socket}
 */

Peer.prototype.connect = function connect(addr) {
  var socket;

  assert(!this.socket);

  socket = this.options.createSocket(addr.port, addr.host);

  this.address = addr;
  this.outbound = true;
  this.connected = false;

  this.bind(socket);

  return socket;
};

/**
 * Open and perform initial handshake (without rejection).
 * @method
 * @returns {Promise}
 */

Peer.prototype.tryOpen = co( /*#__PURE__*/_regenerator2.default.mark(function tryOpen() {
  return _regenerator2.default.wrap(function tryOpen$(_context2) {
    while (1) {
      switch (_context2.prev = _context2.next) {
        case 0:
          _context2.prev = 0;
          _context2.next = 3;
          return this.open();

        case 3:
          _context2.next = 8;
          break;

        case 5:
          _context2.prev = 5;
          _context2.t0 = _context2['catch'](0);

          ;

        case 8:
        case 'end':
          return _context2.stop();
      }
    }
  }, tryOpen, this, [[0, 5]]);
}));

/**
 * Open and perform initial handshake.
 * @method
 * @returns {Promise}
 */

Peer.prototype.open = co( /*#__PURE__*/_regenerator2.default.mark(function open() {
  return _regenerator2.default.wrap(function open$(_context3) {
    while (1) {
      switch (_context3.prev = _context3.next) {
        case 0:
          _context3.prev = 0;
          _context3.next = 3;
          return this._open();

        case 3:
          _context3.next = 10;
          break;

        case 5:
          _context3.prev = 5;
          _context3.t0 = _context3['catch'](0);

          this.error(_context3.t0);
          this.destroy();
          throw _context3.t0;

        case 10:
        case 'end':
          return _context3.stop();
      }
    }
  }, open, this, [[0, 5]]);
}));

/**
 * Open and perform initial handshake.
 * @method
 * @returns {Promise}
 */

Peer.prototype._open = co( /*#__PURE__*/_regenerator2.default.mark(function open() {
  return _regenerator2.default.wrap(function open$(_context4) {
    while (1) {
      switch (_context4.prev = _context4.next) {
        case 0:
          this.opened = true;

          // Connect to peer.
          _context4.next = 3;
          return this.initConnect();

        case 3:
          _context4.next = 5;
          return this.initStall();

        case 5:
          _context4.next = 7;
          return this.initBIP151();

        case 7:
          _context4.next = 9;
          return this.initBIP150();

        case 9:
          _context4.next = 11;
          return this.initVersion();

        case 11:
          _context4.next = 13;
          return this.finalize();

        case 13:

          assert(!this.destroyed);

          // Finally we can let the pool know
          // that this peer is ready to go.
          this.emit('open');

        case 15:
        case 'end':
          return _context4.stop();
      }
    }
  }, open, this);
}));

/**
 * Wait for connection.
 * @private
 * @returns {Promise}
 */

Peer.prototype.initConnect = function initConnect() {
  var self = this;

  if (this.connected) {
    assert(!this.outbound);
    return co.wait();
  }

  return new _promise2.default(function (resolve, reject) {
    function cleanup() {
      if (self.connectTimeout != null) {
        clearTimeout(self.connectTimeout);
        self.connectTimeout = null;
      }
      self.socket.removeListener('error', onError);
    }

    function onError(err) {
      cleanup();
      reject(err);
    }

    self.socket.once('connect', function () {
      self.ts = util.ms();
      self.connected = true;
      self.emit('connect');

      cleanup();
      resolve();
    });

    self.socket.once('error', onError);

    self.connectTimeout = setTimeout(function () {
      self.connectTimeout = null;
      cleanup();
      reject(new Error('Connection timed out.'));
    }, 10000);
  });
};

/**
 * Setup stall timer.
 * @private
 * @returns {Promise}
 */

Peer.prototype.initStall = function initStall() {
  var self = this;
  assert(!this.stallTimer);
  assert(!this.destroyed);
  this.stallTimer = setInterval(function () {
    self.maybeTimeout();
  }, Peer.STALL_INTERVAL);
  return _promise2.default.resolve();
};

/**
 * Handle `connect` event (called immediately
 * if a socket was passed into peer).
 * @method
 * @private
 * @returns {Promise}
 */

Peer.prototype.initBIP151 = co( /*#__PURE__*/_regenerator2.default.mark(function initBIP151() {
  return _regenerator2.default.wrap(function initBIP151$(_context5) {
    while (1) {
      switch (_context5.prev = _context5.next) {
        case 0:
          assert(!this.destroyed);

          // Send encinit. Wait for handshake to complete.

          if (this.bip151) {
            _context5.next = 3;
            break;
          }

          return _context5.abrupt('return');

        case 3:

          assert(!this.bip151.completed);

          this.logger.info('Attempting BIP151 handshake (%s).', this.hostname());

          this.send(this.bip151.toEncinit());

          _context5.prev = 6;
          _context5.next = 9;
          return this.bip151.wait(3000);

        case 9:
          _context5.next = 14;
          break;

        case 11:
          _context5.prev = 11;
          _context5.t0 = _context5['catch'](6);

          this.error(_context5.t0);

        case 14:
          if (!this.destroyed) {
            _context5.next = 16;
            break;
          }

          throw new Error('Peer was destroyed during BIP151 handshake.');

        case 16:

          assert(this.bip151.completed);

          if (this.bip151.handshake) {
            this.logger.info('BIP151 handshake complete (%s).', this.hostname());
            this.logger.info('Connection is encrypted (%s).', this.hostname());
          }

        case 18:
        case 'end':
          return _context5.stop();
      }
    }
  }, initBIP151, this, [[6, 11]]);
}));

/**
 * Handle post bip151-handshake.
 * @method
 * @private
 * @returns {Promise}
 */

Peer.prototype.initBIP150 = co( /*#__PURE__*/_regenerator2.default.mark(function initBIP150() {
  return _regenerator2.default.wrap(function initBIP150$(_context6) {
    while (1) {
      switch (_context6.prev = _context6.next) {
        case 0:
          assert(!this.destroyed);

          if (this.bip150) {
            _context6.next = 3;
            break;
          }

          return _context6.abrupt('return');

        case 3:

          assert(this.bip151);
          assert(!this.bip150.completed);

          if (this.bip151.handshake) {
            _context6.next = 7;
            break;
          }

          throw new Error('BIP151 handshake was not completed for BIP150.');

        case 7:

          this.logger.info('Attempting BIP150 handshake (%s).', this.hostname());

          if (!this.bip150.outbound) {
            _context6.next = 12;
            break;
          }

          if (this.bip150.peerIdentity) {
            _context6.next = 11;
            break;
          }

          throw new Error('No known identity for peer.');

        case 11:
          this.send(this.bip150.toChallenge());

        case 12:
          _context6.next = 14;
          return this.bip150.wait(3000);

        case 14:

          assert(!this.destroyed);
          assert(this.bip150.completed);

          if (this.bip150.auth) {
            this.logger.info('BIP150 handshake complete (%s).', this.hostname());
            this.logger.info('Peer is authed (%s): %s.', this.hostname(), this.bip150.getAddress());
          }

        case 17:
        case 'end':
          return _context6.stop();
      }
    }
  }, initBIP150, this);
}));

/**
 * Handle post handshake.
 * @method
 * @private
 * @returns {Promise}
 */

Peer.prototype.initVersion = co( /*#__PURE__*/_regenerator2.default.mark(function initVersion() {
  return _regenerator2.default.wrap(function initVersion$(_context7) {
    while (1) {
      switch (_context7.prev = _context7.next) {
        case 0:
          assert(!this.destroyed);

          // Say hello.
          this.sendVersion();

          if (this.ack) {
            _context7.next = 6;
            break;
          }

          _context7.next = 5;
          return this.wait(packetTypes.VERACK, 10000);

        case 5:
          assert(this.ack);

        case 6:
          if (!(this.version === -1)) {
            _context7.next = 11;
            break;
          }

          this.logger.debug('Peer sent a verack without a version (%s).', this.hostname());

          _context7.next = 10;
          return this.wait(packetTypes.VERSION, 10000);

        case 10:

          assert(this.version !== -1);

        case 11:
          if (!this.destroyed) {
            _context7.next = 13;
            break;
          }

          throw new Error('Peer was destroyed during handshake.');

        case 13:

          this.handshake = true;

          this.logger.debug('Version handshake complete (%s).', this.hostname());

        case 15:
        case 'end':
          return _context7.stop();
      }
    }
  }, initVersion, this);
}));

/**
 * Finalize peer after handshake.
 * @method
 * @private
 * @returns {Promise}
 */

Peer.prototype.finalize = co( /*#__PURE__*/_regenerator2.default.mark(function finalize() {
  var self;
  return _regenerator2.default.wrap(function finalize$(_context8) {
    while (1) {
      switch (_context8.prev = _context8.next) {
        case 0:
          self = this;


          assert(!this.destroyed);

          // Setup the ping interval.
          this.pingTimer = setInterval(function () {
            self.sendPing();
          }, Peer.PING_INTERVAL);

          // Setup the inv flusher.
          this.invTimer = setInterval(function () {
            self.flushInv();
          }, Peer.INV_INTERVAL);

        case 4:
        case 'end':
          return _context8.stop();
      }
    }
  }, finalize, this);
}));

/**
 * Broadcast blocks to peer.
 * @param {Block[]} blocks
 */

Peer.prototype.announceBlock = function announceBlock(blocks) {
  var inv = [];
  var i, block;

  if (!this.handshake) return;

  if (this.destroyed) return;

  if (!Array.isArray(blocks)) blocks = [blocks];

  for (i = 0; i < blocks.length; i++) {
    block = blocks[i];

    assert(block instanceof Block);

    // Don't send if they already have it.
    if (this.invFilter.test(block.hash())) continue;

    // Send them the block immediately if
    // they're using compact block mode 1.
    if (this.compactMode === 1) {
      this.invFilter.add(block.hash());
      this.sendCompactBlock(block);
      continue;
    }

    // Convert item to block headers
    // for peers that request it.
    if (this.preferHeaders) {
      inv.push(block.toHeaders());
      continue;
    }

    inv.push(block.toInv());
  }

  if (this.preferHeaders) {
    this.sendHeaders(inv);
    return;
  }

  this.queueInv(inv);
};

/**
 * Broadcast transactions to peer.
 * @param {TX[]} txs
 */

Peer.prototype.announceTX = function announceTX(txs) {
  var inv = [];
  var i, tx, hash, rate;

  if (!this.handshake) return;

  if (this.destroyed) return;

  // Do not send txs to spv clients
  // that have relay unset.
  if (this.noRelay) return;

  if (!Array.isArray(txs)) txs = [txs];

  for (i = 0; i < txs.length; i++) {
    tx = txs[i];

    assert(tx instanceof TX);

    // Don't send if they already have it.
    if (this.invFilter.test(tx.hash())) continue;

    // Check the peer's bloom
    // filter if they're using spv.
    if (this.spvFilter) {
      if (!tx.isWatched(this.spvFilter)) continue;
    }

    // Check the fee filter.
    if (this.feeRate !== -1) {
      hash = tx.hash('hex');
      rate = this.options.getRate(hash);
      if (rate !== -1 && rate < this.feeRate) continue;
    }

    inv.push(tx.toInv());
  }

  this.queueInv(inv);
};

/**
 * Send inv to a peer.
 * @param {InvItem[]} items
 */

Peer.prototype.queueInv = function queueInv(items) {
  var hasBlock = false;
  var i, item;

  if (!this.handshake) return;

  if (this.destroyed) return;

  if (!Array.isArray(items)) items = [items];

  for (i = 0; i < items.length; i++) {
    item = items[i];
    if (item.type === invTypes.BLOCK) hasBlock = true;
    this.invQueue.push(item);
  }

  if (this.invQueue.length >= 500 || hasBlock) this.flushInv();
};

/**
 * Flush inv queue.
 * @private
 */

Peer.prototype.flushInv = function flushInv() {
  var queue = this.invQueue.slice();
  var items = [];
  var i, item, chunk;

  if (this.destroyed) return;

  if (queue.length === 0) return;

  this.invQueue.length = 0;

  this.logger.spam('Serving %d inv items to %s.', queue.length, this.hostname());

  for (i = 0; i < queue.length; i++) {
    item = queue[i];

    if (!this.invFilter.added(item.hash, 'hex')) continue;

    items.push(item);
  }

  for (i = 0; i < items.length; i += 1000) {
    chunk = items.slice(i, i + 1000);
    this.send(new packets.InvPacket(chunk));
  }
};

/**
 * Force send an inv (no filter check).
 * @param {InvItem[]} items
 */

Peer.prototype.sendInv = function sendInv(items) {
  var i, item, chunk;

  if (!this.handshake) return;

  if (this.destroyed) return;

  if (!Array.isArray(items)) items = [items];

  for (i = 0; i < items.length; i++) {
    item = items[i];
    this.invFilter.add(item.hash, 'hex');
  }

  if (items.length === 0) return;

  this.logger.spam('Serving %d inv items to %s.', items.length, this.hostname());

  for (i = 0; i < items.length; i += 1000) {
    chunk = items.slice(i, i + 1000);
    this.send(new packets.InvPacket(chunk));
  }
};

/**
 * Send headers to a peer.
 * @param {Headers[]} items
 */

Peer.prototype.sendHeaders = function sendHeaders(items) {
  var i, item, chunk;

  if (!this.handshake) return;

  if (this.destroyed) return;

  if (!Array.isArray(items)) items = [items];

  for (i = 0; i < items.length; i++) {
    item = items[i];
    this.invFilter.add(item.hash());
  }

  if (items.length === 0) return;

  this.logger.spam('Serving %d headers to %s.', items.length, this.hostname());

  for (i = 0; i < items.length; i += 2000) {
    chunk = items.slice(i, i + 2000);
    this.send(new packets.HeadersPacket(chunk));
  }
};

/**
 * Send a compact block.
 * @private
 * @param {Block} block
 * @returns {Boolean}
 */

Peer.prototype.sendCompactBlock = function sendCompactBlock(block) {
  var witness = this.compactWitness;
  var compact = BIP152.CompactBlock.fromBlock(block, witness);
  this.send(new packets.CmpctBlockPacket(compact, witness));
};

/**
 * Send a `version` packet.
 */

Peer.prototype.sendVersion = function sendVersion() {
  var packet = new packets.VersionPacket();
  packet.version = this.options.version;
  packet.services = this.options.services;
  packet.ts = this.network.now();
  packet.remote = this.address;
  packet.local.setNull();
  packet.local.services = this.options.services;
  packet.nonce = this.options.createNonce(this.hostname());
  packet.agent = this.options.agent;
  packet.height = this.options.getHeight();
  packet.noRelay = this.options.noRelay;
  this.send(packet);
};

/**
 * Send a `getaddr` packet.
 */

Peer.prototype.sendGetAddr = function sendGetAddr() {
  if (this.sentGetAddr) return;

  this.sentGetAddr = true;
  this.send(new packets.GetAddrPacket());
};

/**
 * Send a `ping` packet.
 */

Peer.prototype.sendPing = function sendPing() {
  if (!this.handshake) return;

  if (this.version <= common.PONG_VERSION) {
    this.send(new packets.PingPacket());
    return;
  }

  if (this.challenge) {
    this.logger.debug('Peer has not responded to ping (%s).', this.hostname());
    return;
  }

  this.lastPing = util.ms();
  this.challenge = util.nonce();

  this.send(new packets.PingPacket(this.challenge));
};

/**
 * Send `filterload` to update the local bloom filter.
 */

Peer.prototype.sendFilterLoad = function sendFilterLoad(filter) {
  if (!this.handshake) return;

  if (!this.options.spv) return;

  if (!(this.services & services.BLOOM)) return;

  this.send(new packets.FilterLoadPacket(filter));
};

/**
 * Set a fee rate filter for the peer.
 * @param {Rate} rate
 */

Peer.prototype.sendFeeRate = function sendFeeRate(rate) {
  if (!this.handshake) return;

  this.send(new packets.FeeFilterPacket(rate));
};

/**
 * Disconnect from and destroy the peer.
 */

Peer.prototype.destroy = function destroy() {
  var connected = this.connected;
  var i, keys, cmd, entry, jobs, job;

  if (this.destroyed) return;

  this.destroyed = true;
  this.connected = false;

  this.socket.destroy();
  this.socket = null;

  if (this.bip151) this.bip151.destroy();

  if (this.bip150) this.bip150.destroy();

  if (this.pingTimer != null) {
    clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  if (this.invTimer != null) {
    clearInterval(this.invTimer);
    this.invTimer = null;
  }

  if (this.stallTimer != null) {
    clearInterval(this.stallTimer);
    this.stallTimer = null;
  }

  if (this.connectTimeout != null) {
    clearTimeout(this.connectTimeout);
    this.connectTimeout = null;
  }

  jobs = this.drainQueue;

  this.drainSize = 0;
  this.drainQueue = [];

  for (i = 0; i < jobs.length; i++) {
    job = jobs[i];
    job.reject(new Error('Peer was destroyed.'));
  }

  keys = this.responseMap.keys();

  for (i = 0; i < keys.length; i++) {
    cmd = keys[i];
    entry = this.responseMap.get(cmd);
    this.responseMap.remove(cmd);
    entry.reject(new Error('Peer was destroyed.'));
  }

  this.locker.destroy();

  this.emit('close', connected);
};

/**
 * Write data to the peer's socket.
 * @param {Buffer} data
 */

Peer.prototype.write = function write(data) {
  if (this.destroyed) throw new Error('Peer is destroyed (write).');

  this.lastSend = util.ms();

  if (this.socket.write(data) === false) this.needsDrain(data.length);
};

/**
 * Send a packet.
 * @param {Packet} packet
 */

Peer.prototype.send = function send(packet) {
  var tx, checksum;

  if (this.destroyed) throw new Error('Peer is destroyed (send).');

  // Used cached hashes as the
  // packet checksum for speed.
  if (packet.type === packetTypes.TX) {
    tx = packet.tx;
    if (packet.witness) {
      if (!tx.isCoinbase()) checksum = tx.witnessHash();
    } else {
      checksum = tx.hash();
    }
  }

  this.sendRaw(packet.cmd, packet.toRaw(), checksum);

  this.addTimeout(packet);
};

/**
 * Send a packet.
 * @param {Packet} packet
 */

Peer.prototype.sendRaw = function sendRaw(cmd, body, checksum) {
  var payload = this.framePacket(cmd, body, checksum);
  this.write(payload);
};

/**
 * Wait for a drain event.
 * @returns {Promise}
 */

Peer.prototype.drain = function drain() {
  var self = this;

  if (this.destroyed) return _promise2.default.reject(new Error('Peer is destroyed.'));

  if (this.drainSize === 0) return _promise2.default.resolve();

  return new _promise2.default(function (resolve, reject) {
    self.drainQueue.push(co.job(resolve, reject));
  });
};

/**
 * Handle drain event.
 * @private
 */

Peer.prototype.handleDrain = function handleDrain() {
  var jobs = this.drainQueue;
  var i, job;

  this.drainSize = 0;

  if (jobs.length === 0) return;

  this.drainQueue = [];

  for (i = 0; i < jobs.length; i++) {
    job = jobs[i];
    job.resolve();
  }
};

/**
 * Add to drain counter.
 * @private
 * @param {Number} size
 */

Peer.prototype.needsDrain = function needsDrain(size) {
  this.drainSize += size;

  if (this.drainSize >= Peer.DRAIN_MAX) {
    this.logger.warning('Peer is not reading: %dmb buffered (%s).', util.mb(this.drainSize), this.hostname());
    this.error('Peer stalled (drain).');
    this.destroy();
  }
};

/**
 * Potentially add response timeout.
 * @private
 * @param {Packet} packet
 */

Peer.prototype.addTimeout = function addTimeout(packet) {
  var timeout = Peer.RESPONSE_TIMEOUT;

  if (!this.outbound) return;

  switch (packet.type) {
    case packetTypes.MEMPOOL:
      this.request(packetTypes.INV, timeout);
      break;
    case packetTypes.GETBLOCKS:
      if (!this.options.isFull()) this.request(packetTypes.INV, timeout);
      break;
    case packetTypes.GETHEADERS:
      this.request(packetTypes.HEADERS, timeout * 2);
      break;
    case packetTypes.GETDATA:
      this.request(packetTypes.DATA, timeout * 2);
      break;
    case packetTypes.GETBLOCKTXN:
      this.request(packetTypes.BLOCKTXN, timeout);
      break;
  }
};

/**
 * Potentially finish response timeout.
 * @private
 * @param {Packet} packet
 */

Peer.prototype.fulfill = function fulfill(packet) {
  var entry;

  switch (packet.type) {
    case packetTypes.BLOCK:
    case packetTypes.CMPCTBLOCK:
    case packetTypes.MERKLEBLOCK:
    case packetTypes.TX:
    case packetTypes.NOTFOUND:
      entry = this.response(packetTypes.DATA, packet);
      assert(!entry || entry.jobs.length === 0);
      break;
  }

  return this.response(packet.type, packet);
};

/**
 * Potentially timeout peer if it hasn't responded.
 * @private
 */

Peer.prototype.maybeTimeout = function maybeTimeout() {
  var keys = this.responseMap.keys();
  var now = util.ms();
  var i, key, entry, name, ts, block, mult;

  for (i = 0; i < keys.length; i++) {
    key = keys[i];
    entry = this.responseMap.get(key);
    if (now > entry.timeout) {
      name = packets.typesByVal[key];
      this.error('Peer is stalling (%s).', name.toLowerCase());
      this.destroy();
      return;
    }
  }

  if (this.merkleBlock) {
    assert(this.merkleTime !== -1);
    if (now > this.merkleTime + Peer.BLOCK_TIMEOUT) {
      this.error('Peer is stalling (merkleblock).');
      this.destroy();
      return;
    }
  }

  if (this.syncing && this.loader && !this.options.isFull()) {
    if (now > this.blockTime + Peer.BLOCK_TIMEOUT) {
      this.error('Peer is stalling (block).');
      this.destroy();
      return;
    }
  }

  if (this.options.isFull() || !this.syncing) {
    keys = this.blockMap.keys();

    for (i = 0; i < keys.length; i++) {
      key = keys[i];
      ts = this.blockMap.get(key);
      if (now > ts + Peer.BLOCK_TIMEOUT) {
        this.error('Peer is stalling (block).');
        this.destroy();
        return;
      }
    }

    keys = this.txMap.keys();

    for (i = 0; i < keys.length; i++) {
      key = keys[i];
      ts = this.txMap.get(key);
      if (now > ts + Peer.TX_TIMEOUT) {
        this.error('Peer is stalling (tx).');
        this.destroy();
        return;
      }
    }

    keys = this.compactBlocks.keys();

    for (i = 0; i < keys.length; i++) {
      key = keys[i];
      block = this.compactBlocks.get(key);
      if (now > block.now + Peer.RESPONSE_TIMEOUT) {
        this.error('Peer is stalling (blocktxn).');
        this.destroy();
        return;
      }
    }
  }

  if (now > this.ts + 60000) {
    assert(this.ts !== 0);

    if (this.lastRecv === 0 || this.lastSend === 0) {
      this.error('Peer is stalling (no message).');
      this.destroy();
      return;
    }

    if (now > this.lastSend + Peer.TIMEOUT_INTERVAL) {
      this.error('Peer is stalling (send).');
      this.destroy();
      return;
    }

    mult = this.version <= common.PONG_VERSION ? 4 : 1;

    if (now > this.lastRecv + Peer.TIMEOUT_INTERVAL * mult) {
      this.error('Peer is stalling (recv).');
      this.destroy();
      return;
    }

    if (this.challenge && now > this.lastPing + Peer.TIMEOUT_INTERVAL) {
      this.error('Peer is stalling (ping).');
      this.destroy();
      return;
    }
  }
};

/**
 * Wait for a packet to be received from peer.
 * @private
 * @param {Number} type - Packet type.
 * @param {Number} timeout
 * @returns {RequestEntry}
 */

Peer.prototype.request = function request(type, timeout) {
  var entry = this.responseMap.get(type);

  if (this.destroyed) return;

  if (!entry) {
    entry = new RequestEntry();
    this.responseMap.set(type, entry);
  }

  entry.setTimeout(timeout);

  return entry;
};

/**
 * Fulfill awaiting requests created with {@link Peer#request}.
 * @private
 * @param {Number} type - Packet type.
 * @param {Object} payload
 */

Peer.prototype.response = function response(type, payload) {
  var entry = this.responseMap.get(type);

  if (!entry) return;

  this.responseMap.remove(type);

  return entry;
};

/**
 * Wait for a packet to be received from peer.
 * @private
 * @param {Number} type - Packet type.
 * @returns {Promise} - Returns Object(payload).
 * Executed on timeout or once packet is received.
 */

Peer.prototype.wait = function wait(type, timeout) {
  var self = this;
  return new _promise2.default(function (resolve, reject) {
    var entry;

    if (self.destroyed) {
      reject(new Error('Peer is destroyed (request).'));
      return;
    }

    entry = self.request(type);

    entry.setTimeout(timeout);
    entry.addJob(resolve, reject);
  });
};

/**
 * Emit an error and destroy the peer.
 * @private
 * @param {...String|Error} err
 */

Peer.prototype.error = function error(err) {
  var msg;

  if (this.destroyed) return;

  if (typeof err === 'string') {
    msg = util.fmt.apply(util, arguments);
    err = new Error(msg);
  }

  if (typeof err.code === 'string' && err.code[0] === 'E') {
    msg = err.code;
    err = new Error(msg);
    err.code = msg;
    err.message = 'Socket Error: ' + msg;
  }

  err.message += ' (' + this.hostname() + ')';

  this.emit('error', err);
};

/**
 * Calculate peer block inv type (filtered,
 * compact, witness, or non-witness).
 * @returns {Number}
 */

Peer.prototype.blockType = function blockType() {
  if (this.options.spv) return invTypes.FILTERED_BLOCK;

  if (this.options.compact && this.hasCompactSupport() && this.hasCompact()) {
    return invTypes.CMPCT_BLOCK;
  }

  if (this.hasWitness()) return invTypes.WITNESS_BLOCK;

  return invTypes.BLOCK;
};

/**
 * Calculate peer tx inv type (witness or non-witness).
 * @returns {Number}
 */

Peer.prototype.txType = function txType() {
  if (this.hasWitness()) return invTypes.WITNESS_TX;

  return invTypes.TX;
};

/**
 * Send `getdata` to peer.
 * @param {InvItem[]} items
 */

Peer.prototype.getData = function getData(items) {
  this.send(new packets.GetDataPacket(items));
};

/**
 * Send batched `getdata` to peer.
 * @param {InvType} type
 * @param {Hash[]} hashes
 */

Peer.prototype.getItems = function getItems(type, hashes) {
  var items = [];
  var i, hash;

  for (i = 0; i < hashes.length; i++) {
    hash = hashes[i];
    items.push(new InvItem(type, hash));
  }

  if (items.length === 0) return;

  this.getData(items);
};

/**
 * Send batched `getdata` to peer (blocks).
 * @param {Hash[]} hashes
 */

Peer.prototype.getBlock = function getBlock(hashes) {
  this.getItems(this.blockType(), hashes);
};

/**
 * Send batched `getdata` to peer (txs).
 * @param {Hash[]} hashes
 */

Peer.prototype.getTX = function getTX(hashes) {
  this.getItems(this.txType(), hashes);
};

/**
 * Send `getdata` to peer for a single block.
 * @param {Hash} hash
 */

Peer.prototype.getFullBlock = function getFullBlock(hash) {
  var type = invTypes.BLOCK;

  assert(!this.options.spv);

  if (this.hasWitness()) type |= InvItem.WITNESS_FLAG;

  this.getItems(type, [hash]);
};

/**
 * Handle a packet payload.
 * @method
 * @private
 * @param {Packet} packet
 */

Peer.prototype.readPacket = co( /*#__PURE__*/_regenerator2.default.mark(function readPacket(packet) {
  var unlock;
  return _regenerator2.default.wrap(function readPacket$(_context9) {
    while (1) {
      switch (_context9.prev = _context9.next) {
        case 0:
          if (!this.destroyed) {
            _context9.next = 2;
            break;
          }

          return _context9.abrupt('return');

        case 2:
          _context9.t0 = packet.type;
          _context9.next = _context9.t0 === packetTypes.ENCINIT ? 5 : _context9.t0 === packetTypes.ENCACK ? 5 : _context9.t0 === packetTypes.AUTHCHALLENGE ? 5 : _context9.t0 === packetTypes.AUTHREPLY ? 5 : _context9.t0 === packetTypes.AUTHPROPOSE ? 5 : 13;
          break;

        case 5:
          _context9.prev = 5;

          this.socket.pause();
          _context9.next = 9;
          return this.handlePacket(packet);

        case 9:
          _context9.prev = 9;

          if (!this.destroyed) this.socket.resume();
          return _context9.finish(9);

        case 12:
          return _context9.abrupt('break', 25);

        case 13:
          _context9.next = 15;
          return this.locker.lock();

        case 15:
          unlock = _context9.sent;
          _context9.prev = 16;

          this.socket.pause();
          _context9.next = 20;
          return this.handlePacket(packet);

        case 20:
          _context9.prev = 20;

          if (!this.destroyed) this.socket.resume();
          unlock();
          return _context9.finish(20);

        case 24:
          return _context9.abrupt('break', 25);

        case 25:
        case 'end':
          return _context9.stop();
      }
    }
  }, readPacket, this, [[5,, 9, 12], [16,, 20, 24]]);
}));

/**
 * Handle a packet payload without a lock.
 * @method
 * @private
 * @param {Packet} packet
 */

Peer.prototype.handlePacket = co( /*#__PURE__*/_regenerator2.default.mark(function handlePacket(packet) {
  var entry;
  return _regenerator2.default.wrap(function handlePacket$(_context10) {
    while (1) {
      switch (_context10.prev = _context10.next) {
        case 0:
          if (!this.destroyed) {
            _context10.next = 2;
            break;
          }

          throw new Error('Destroyed peer sent a packet.');

        case 2:

          if (this.bip151 && this.bip151.job && !this.bip151.completed && packet.type !== packetTypes.ENCINIT && packet.type !== packetTypes.ENCACK) {
            this.bip151.reject(new Error('Message before BIP151 handshake.'));
          }

          if (this.bip150 && this.bip150.job && !this.bip150.completed && packet.type !== packetTypes.AUTHCHALLENGE && packet.type !== packetTypes.AUTHREPLY && packet.type !== packetTypes.AUTHPROPOSE) {
            this.bip150.reject(new Error('Message before BIP150 auth.'));
          }

          entry = this.fulfill(packet);

          _context10.t0 = packet.type;
          _context10.next = _context10.t0 === packetTypes.VERSION ? 8 : _context10.t0 === packetTypes.VERACK ? 11 : _context10.t0 === packetTypes.PING ? 14 : _context10.t0 === packetTypes.PONG ? 17 : _context10.t0 === packetTypes.SENDHEADERS ? 20 : _context10.t0 === packetTypes.FILTERLOAD ? 23 : _context10.t0 === packetTypes.FILTERADD ? 26 : _context10.t0 === packetTypes.FILTERCLEAR ? 29 : _context10.t0 === packetTypes.FEEFILTER ? 32 : _context10.t0 === packetTypes.SENDCMPCT ? 35 : _context10.t0 === packetTypes.ENCINIT ? 38 : _context10.t0 === packetTypes.ENCACK ? 41 : _context10.t0 === packetTypes.AUTHCHALLENGE ? 44 : _context10.t0 === packetTypes.AUTHREPLY ? 47 : _context10.t0 === packetTypes.AUTHPROPOSE ? 50 : 53;
          break;

        case 8:
          _context10.next = 10;
          return this.handleVersion(packet);

        case 10:
          return _context10.abrupt('break', 53);

        case 11:
          _context10.next = 13;
          return this.handleVerack(packet);

        case 13:
          return _context10.abrupt('break', 53);

        case 14:
          _context10.next = 16;
          return this.handlePing(packet);

        case 16:
          return _context10.abrupt('break', 53);

        case 17:
          _context10.next = 19;
          return this.handlePong(packet);

        case 19:
          return _context10.abrupt('break', 53);

        case 20:
          _context10.next = 22;
          return this.handleSendHeaders(packet);

        case 22:
          return _context10.abrupt('break', 53);

        case 23:
          _context10.next = 25;
          return this.handleFilterLoad(packet);

        case 25:
          return _context10.abrupt('break', 53);

        case 26:
          _context10.next = 28;
          return this.handleFilterAdd(packet);

        case 28:
          return _context10.abrupt('break', 53);

        case 29:
          _context10.next = 31;
          return this.handleFilterClear(packet);

        case 31:
          return _context10.abrupt('break', 53);

        case 32:
          _context10.next = 34;
          return this.handleFeeFilter(packet);

        case 34:
          return _context10.abrupt('break', 53);

        case 35:
          _context10.next = 37;
          return this.handleSendCmpct(packet);

        case 37:
          return _context10.abrupt('break', 53);

        case 38:
          _context10.next = 40;
          return this.handleEncinit(packet);

        case 40:
          return _context10.abrupt('break', 53);

        case 41:
          _context10.next = 43;
          return this.handleEncack(packet);

        case 43:
          return _context10.abrupt('break', 53);

        case 44:
          _context10.next = 46;
          return this.handleAuthChallenge(packet);

        case 46:
          return _context10.abrupt('break', 53);

        case 47:
          _context10.next = 49;
          return this.handleAuthReply(packet);

        case 49:
          return _context10.abrupt('break', 53);

        case 50:
          _context10.next = 52;
          return this.handleAuthPropose(packet);

        case 52:
          return _context10.abrupt('break', 53);

        case 53:
          if (!this.onPacket) {
            _context10.next = 56;
            break;
          }

          _context10.next = 56;
          return this.onPacket(packet);

        case 56:

          this.emit('packet', packet);

          if (entry) entry.resolve(packet);

        case 58:
        case 'end':
          return _context10.stop();
      }
    }
  }, handlePacket, this);
}));

/**
 * Handle `version` packet.
 * @method
 * @private
 * @param {VersionPacket} packet
 */

Peer.prototype.handleVersion = co( /*#__PURE__*/_regenerator2.default.mark(function handleVersion(packet) {
  return _regenerator2.default.wrap(function handleVersion$(_context11) {
    while (1) {
      switch (_context11.prev = _context11.next) {
        case 0:
          if (!(this.version !== -1)) {
            _context11.next = 2;
            break;
          }

          throw new Error('Peer sent a duplicate version.');

        case 2:

          this.version = packet.version;
          this.services = packet.services;
          this.height = packet.height;
          this.agent = packet.agent;
          this.noRelay = packet.noRelay;
          this.local = packet.remote;

          if (this.network.selfConnect) {
            _context11.next = 11;
            break;
          }

          if (!this.options.hasNonce(packet.nonce)) {
            _context11.next = 11;
            break;
          }

          throw new Error('We connected to ourself. Oops.');

        case 11:
          if (!(this.version < common.MIN_VERSION)) {
            _context11.next = 13;
            break;
          }

          throw new Error('Peer does not support required protocol version.');

        case 13:
          if (!this.outbound) {
            _context11.next = 28;
            break;
          }

          if (this.services & services.NETWORK) {
            _context11.next = 16;
            break;
          }

          throw new Error('Peer does not support network services.');

        case 16:
          if (!this.options.headers) {
            _context11.next = 19;
            break;
          }

          if (!(this.version < common.HEADERS_VERSION)) {
            _context11.next = 19;
            break;
          }

          throw new Error('Peer does not support getheaders.');

        case 19:
          if (!this.options.spv) {
            _context11.next = 24;
            break;
          }

          if (this.services & services.BLOOM) {
            _context11.next = 22;
            break;
          }

          throw new Error('Peer does not support BIP37.');

        case 22:
          if (!(this.version < common.BLOOM_VERSION)) {
            _context11.next = 24;
            break;
          }

          throw new Error('Peer does not support BIP37.');

        case 24:
          if (!this.options.hasWitness()) {
            _context11.next = 27;
            break;
          }

          if (this.services & services.WITNESS) {
            _context11.next = 27;
            break;
          }

          throw new Error('Peer does not support segregated witness.');

        case 27:

          if (this.options.compact) {
            if (!this.hasCompactSupport()) {
              this.logger.debug('Peer does not support compact blocks (%s).', this.hostname());
            }
          }

        case 28:

          this.send(new packets.VerackPacket());

        case 29:
        case 'end':
          return _context11.stop();
      }
    }
  }, handleVersion, this);
}));

/**
 * Handle `verack` packet.
 * @method
 * @private
 * @param {VerackPacket} packet
 */

Peer.prototype.handleVerack = co( /*#__PURE__*/_regenerator2.default.mark(function handleVerack(packet) {
  return _regenerator2.default.wrap(function handleVerack$(_context12) {
    while (1) {
      switch (_context12.prev = _context12.next) {
        case 0:
          if (!this.ack) {
            _context12.next = 3;
            break;
          }

          this.logger.debug('Peer sent duplicate ack (%s).', this.hostname());
          return _context12.abrupt('return');

        case 3:

          this.ack = true;
          this.logger.debug('Received verack (%s).', this.hostname());

        case 5:
        case 'end':
          return _context12.stop();
      }
    }
  }, handleVerack, this);
}));

/**
 * Handle `ping` packet.
 * @method
 * @private
 * @param {PingPacket} packet
 */

Peer.prototype.handlePing = co( /*#__PURE__*/_regenerator2.default.mark(function handlePing(packet) {
  return _regenerator2.default.wrap(function handlePing$(_context13) {
    while (1) {
      switch (_context13.prev = _context13.next) {
        case 0:
          if (packet.nonce) {
            _context13.next = 2;
            break;
          }

          return _context13.abrupt('return');

        case 2:

          this.send(new packets.PongPacket(packet.nonce));

        case 3:
        case 'end':
          return _context13.stop();
      }
    }
  }, handlePing, this);
}));

/**
 * Handle `pong` packet.
 * @method
 * @private
 * @param {PongPacket} packet
 */

Peer.prototype.handlePong = co( /*#__PURE__*/_regenerator2.default.mark(function handlePong(packet) {
  var nonce, now;
  return _regenerator2.default.wrap(function handlePong$(_context14) {
    while (1) {
      switch (_context14.prev = _context14.next) {
        case 0:
          nonce = packet.nonce;
          now = util.ms();

          if (this.challenge) {
            _context14.next = 5;
            break;
          }

          this.logger.debug('Peer sent an unsolicited pong (%s).', this.hostname());
          return _context14.abrupt('return');

        case 5:
          if (nonce.equals(this.challenge)) {
            _context14.next = 12;
            break;
          }

          if (!nonce.equals(encoding.ZERO_U64)) {
            _context14.next = 10;
            break;
          }

          this.logger.debug('Peer sent a zero nonce (%s).', this.hostname());
          this.challenge = null;
          return _context14.abrupt('return');

        case 10:
          this.logger.debug('Peer sent the wrong nonce (%s).', this.hostname());
          return _context14.abrupt('return');

        case 12:

          if (now >= this.lastPing) {
            this.lastPong = now;
            if (this.minPing === -1) this.minPing = now - this.lastPing;
            this.minPing = Math.min(this.minPing, now - this.lastPing);
          } else {
            this.logger.debug('Timing mismatch (what?) (%s).', this.hostname());
          }

          this.challenge = null;

        case 14:
        case 'end':
          return _context14.stop();
      }
    }
  }, handlePong, this);
}));

/**
 * Handle `sendheaders` packet.
 * @method
 * @private
 * @param {SendHeadersPacket} packet
 */

Peer.prototype.handleSendHeaders = co( /*#__PURE__*/_regenerator2.default.mark(function handleSendHeaders(packet) {
  return _regenerator2.default.wrap(function handleSendHeaders$(_context15) {
    while (1) {
      switch (_context15.prev = _context15.next) {
        case 0:
          if (!this.preferHeaders) {
            _context15.next = 3;
            break;
          }

          this.logger.debug('Peer sent a duplicate sendheaders (%s).', this.hostname());
          return _context15.abrupt('return');

        case 3:

          this.preferHeaders = true;

        case 4:
        case 'end':
          return _context15.stop();
      }
    }
  }, handleSendHeaders, this);
}));

/**
 * Handle `filterload` packet.
 * @method
 * @private
 * @param {FilterLoadPacket} packet
 */

Peer.prototype.handleFilterLoad = co( /*#__PURE__*/_regenerator2.default.mark(function handleFilterLoad(packet) {
  return _regenerator2.default.wrap(function handleFilterLoad$(_context16) {
    while (1) {
      switch (_context16.prev = _context16.next) {
        case 0:
          if (packet.isWithinConstraints()) {
            _context16.next = 3;
            break;
          }

          this.increaseBan(100);
          return _context16.abrupt('return');

        case 3:

          this.spvFilter = packet.filter;
          this.noRelay = false;

        case 5:
        case 'end':
          return _context16.stop();
      }
    }
  }, handleFilterLoad, this);
}));

/**
 * Handle `filteradd` packet.
 * @method
 * @private
 * @param {FilterAddPacket} packet
 */

Peer.prototype.handleFilterAdd = co( /*#__PURE__*/_regenerator2.default.mark(function handleFilterAdd(packet) {
  var data;
  return _regenerator2.default.wrap(function handleFilterAdd$(_context17) {
    while (1) {
      switch (_context17.prev = _context17.next) {
        case 0:
          data = packet.data;

          if (!(data.length > consensus.MAX_SCRIPT_PUSH)) {
            _context17.next = 4;
            break;
          }

          this.increaseBan(100);
          return _context17.abrupt('return');

        case 4:

          if (this.spvFilter) this.spvFilter.add(data);

          this.noRelay = false;

        case 6:
        case 'end':
          return _context17.stop();
      }
    }
  }, handleFilterAdd, this);
}));

/**
 * Handle `filterclear` packet.
 * @method
 * @private
 * @param {FilterClearPacket} packet
 */

Peer.prototype.handleFilterClear = co( /*#__PURE__*/_regenerator2.default.mark(function handleFilterClear(packet) {
  return _regenerator2.default.wrap(function handleFilterClear$(_context18) {
    while (1) {
      switch (_context18.prev = _context18.next) {
        case 0:
          if (this.spvFilter) this.spvFilter.reset();

          this.noRelay = false;

        case 2:
        case 'end':
          return _context18.stop();
      }
    }
  }, handleFilterClear, this);
}));

/**
 * Handle `feefilter` packet.
 * @method
 * @private
 * @param {FeeFilterPacket} packet
 */

Peer.prototype.handleFeeFilter = co( /*#__PURE__*/_regenerator2.default.mark(function handleFeeFilter(packet) {
  var rate;
  return _regenerator2.default.wrap(function handleFeeFilter$(_context19) {
    while (1) {
      switch (_context19.prev = _context19.next) {
        case 0:
          rate = packet.rate;

          if (rate >= 0 && rate <= consensus.MAX_MONEY) {
            _context19.next = 4;
            break;
          }

          this.increaseBan(100);
          return _context19.abrupt('return');

        case 4:

          this.feeRate = rate;

        case 5:
        case 'end':
          return _context19.stop();
      }
    }
  }, handleFeeFilter, this);
}));

/**
 * Handle `sendcmpct` packet.
 * @method
 * @private
 * @param {SendCmpctPacket}
 */

Peer.prototype.handleSendCmpct = co( /*#__PURE__*/_regenerator2.default.mark(function handleSendCmpct(packet) {
  return _regenerator2.default.wrap(function handleSendCmpct$(_context20) {
    while (1) {
      switch (_context20.prev = _context20.next) {
        case 0:
          if (!(this.compactMode !== -1)) {
            _context20.next = 3;
            break;
          }

          this.logger.debug('Peer sent a duplicate sendcmpct (%s).', this.hostname());
          return _context20.abrupt('return');

        case 3:
          if (!(packet.version > 2)) {
            _context20.next = 6;
            break;
          }

          // Ignore
          this.logger.info('Peer request compact blocks version %d (%s).', packet.version, this.hostname());
          return _context20.abrupt('return');

        case 6:
          if (!(packet.mode > 1)) {
            _context20.next = 9;
            break;
          }

          this.logger.info('Peer request compact blocks mode %d (%s).', packet.mode, this.hostname());
          return _context20.abrupt('return');

        case 9:

          this.logger.info('Peer initialized compact blocks (mode=%d, version=%d) (%s).', packet.mode, packet.version, this.hostname());

          this.compactMode = packet.mode;
          this.compactWitness = packet.version === 2;

        case 12:
        case 'end':
          return _context20.stop();
      }
    }
  }, handleSendCmpct, this);
}));

/**
 * Handle `encinit` packet.
 * @method
 * @private
 * @param {EncinitPacket} packet
 */

Peer.prototype.handleEncinit = co( /*#__PURE__*/_regenerator2.default.mark(function handleEncinit(packet) {
  return _regenerator2.default.wrap(function handleEncinit$(_context21) {
    while (1) {
      switch (_context21.prev = _context21.next) {
        case 0:
          if (this.bip151) {
            _context21.next = 2;
            break;
          }

          return _context21.abrupt('return');

        case 2:

          this.bip151.encinit(packet.publicKey, packet.cipher);

          this.send(this.bip151.toEncack());

        case 4:
        case 'end':
          return _context21.stop();
      }
    }
  }, handleEncinit, this);
}));

/**
 * Handle `encack` packet.
 * @method
 * @private
 * @param {EncackPacket} packet
 */

Peer.prototype.handleEncack = co( /*#__PURE__*/_regenerator2.default.mark(function handleEncack(packet) {
  return _regenerator2.default.wrap(function handleEncack$(_context22) {
    while (1) {
      switch (_context22.prev = _context22.next) {
        case 0:
          if (this.bip151) {
            _context22.next = 2;
            break;
          }

          return _context22.abrupt('return');

        case 2:

          this.bip151.encack(packet.publicKey);

        case 3:
        case 'end':
          return _context22.stop();
      }
    }
  }, handleEncack, this);
}));

/**
 * Handle `authchallenge` packet.
 * @method
 * @private
 * @param {AuthChallengePacket} packet
 */

Peer.prototype.handleAuthChallenge = co( /*#__PURE__*/_regenerator2.default.mark(function handleAuthChallenge(packet) {
  var sig;
  return _regenerator2.default.wrap(function handleAuthChallenge$(_context23) {
    while (1) {
      switch (_context23.prev = _context23.next) {
        case 0:
          if (this.bip150) {
            _context23.next = 2;
            break;
          }

          return _context23.abrupt('return');

        case 2:

          sig = this.bip150.challenge(packet.hash);

          this.send(new packets.AuthReplyPacket(sig));

        case 4:
        case 'end':
          return _context23.stop();
      }
    }
  }, handleAuthChallenge, this);
}));

/**
 * Handle `authreply` packet.
 * @method
 * @private
 * @param {AuthReplyPacket} packet
 */

Peer.prototype.handleAuthReply = co( /*#__PURE__*/_regenerator2.default.mark(function handleAuthReply(packet) {
  var hash;
  return _regenerator2.default.wrap(function handleAuthReply$(_context24) {
    while (1) {
      switch (_context24.prev = _context24.next) {
        case 0:
          if (this.bip150) {
            _context24.next = 2;
            break;
          }

          return _context24.abrupt('return');

        case 2:

          hash = this.bip150.reply(packet.signature);

          if (hash) this.send(new packets.AuthProposePacket(hash));

        case 4:
        case 'end':
          return _context24.stop();
      }
    }
  }, handleAuthReply, this);
}));

/**
 * Handle `authpropose` packet.
 * @method
 * @private
 * @param {AuthProposePacket} packet
 */

Peer.prototype.handleAuthPropose = co( /*#__PURE__*/_regenerator2.default.mark(function handleAuthPropose(packet) {
  var hash;
  return _regenerator2.default.wrap(function handleAuthPropose$(_context25) {
    while (1) {
      switch (_context25.prev = _context25.next) {
        case 0:
          if (this.bip150) {
            _context25.next = 2;
            break;
          }

          return _context25.abrupt('return');

        case 2:

          hash = this.bip150.propose(packet.hash);

          this.send(new packets.AuthChallengePacket(hash));

        case 4:
        case 'end':
          return _context25.stop();
      }
    }
  }, handleAuthPropose, this);
}));

/**
 * Send `getheaders` to peer. Note that unlike
 * `getblocks`, `getheaders` can have a null locator.
 * @param {Hash[]?} locator - Chain locator.
 * @param {Hash?} stop - Hash to stop at.
 */

Peer.prototype.sendGetHeaders = function sendGetHeaders(locator, stop) {
  var packet = new packets.GetHeadersPacket(locator, stop);
  var hash = null;
  var end = null;

  if (packet.locator.length > 0) hash = util.revHex(packet.locator[0]);

  if (stop) end = util.revHex(stop);

  this.logger.debug('Requesting headers packet from peer with getheaders (%s).', this.hostname());

  this.logger.debug('Sending getheaders (hash=%s, stop=%s).', hash, end);

  this.send(packet);
};

/**
 * Send `getblocks` to peer.
 * @param {Hash[]} locator - Chain locator.
 * @param {Hash?} stop - Hash to stop at.
 */

Peer.prototype.sendGetBlocks = function getBlocks(locator, stop) {
  var packet = new packets.GetBlocksPacket(locator, stop);
  var hash = null;
  var end = null;

  if (packet.locator.length > 0) hash = util.revHex(packet.locator[0]);

  if (stop) end = util.revHex(stop);

  this.logger.debug('Requesting inv packet from peer with getblocks (%s).', this.hostname());

  this.logger.debug('Sending getblocks (hash=%s, stop=%s).', hash, end);

  this.send(packet);
};

/**
 * Send `mempool` to peer.
 */

Peer.prototype.sendMempool = function sendMempool() {
  if (!this.handshake) return;

  if (!(this.services & services.BLOOM)) {
    this.logger.debug('Cannot request mempool for non-bloom peer (%s).', this.hostname());
    return;
  }

  this.logger.debug('Requesting inv packet from peer with mempool (%s).', this.hostname());

  this.send(new packets.MempoolPacket());
};

/**
 * Send `reject` to peer.
 * @param {Number} code
 * @param {String} reason
 * @param {String} msg
 * @param {Hash} hash
 */

Peer.prototype.sendReject = function sendReject(code, reason, msg, hash) {
  var reject = packets.RejectPacket.fromReason(code, reason, msg, hash);

  if (msg) {
    this.logger.debug('Rejecting %s %s (%s): code=%s reason=%s.', msg, util.revHex(hash), this.hostname(), code, reason);
  } else {
    this.logger.debug('Rejecting packet from %s: code=%s reason=%s.', this.hostname(), code, reason);
  }

  this.logger.debug('Sending reject packet to peer (%s).', this.hostname());

  this.send(reject);
};

/**
 * Send a `sendcmpct` packet.
 * @param {Number} mode
 */

Peer.prototype.sendCompact = function sendCompact(mode) {
  if (this.services & common.services.WITNESS) {
    if (this.version >= common.COMPACT_WITNESS_VERSION) {
      this.logger.info('Initializing witness compact blocks (%s).', this.hostname());
      this.send(new packets.SendCmpctPacket(mode, 2));
      return;
    }
  }

  if (this.version >= common.COMPACT_VERSION) {
    this.logger.info('Initializing normal compact blocks (%s).', this.hostname());

    this.send(new packets.SendCmpctPacket(mode, 1));
  }
};

/**
 * Increase banscore on peer.
 * @param {Number} score
 * @returns {Boolean}
 */

Peer.prototype.increaseBan = function increaseBan(score) {
  this.banScore += score;

  if (this.banScore >= this.options.banScore) {
    this.logger.debug('Ban threshold exceeded (%s).', this.hostname());
    this.ban();
    return true;
  }

  return false;
};

/**
 * Ban peer.
 */

Peer.prototype.ban = function ban() {
  this.emit('ban');
};

/**
 * Send a `reject` packet to peer.
 * @param {String} msg
 * @param {VerifyError} err
 * @returns {Boolean}
 */

Peer.prototype.reject = function reject(msg, err) {
  this.sendReject(err.code, err.reason, msg, err.hash);
  return this.increaseBan(err.score);
};

/**
 * Test whether required services are available.
 * @param {Number} services
 * @returns {Boolean}
 */

Peer.prototype.hasServices = function hasServices(services) {
  return (this.services & services) === services;
};

/**
 * Test whether the WITNESS service bit is set.
 * @returns {Boolean}
 */

Peer.prototype.hasWitness = function hasWitness() {
  return (this.services & services.WITNESS) !== 0;
};

/**
 * Test whether the peer supports compact blocks.
 * @returns {Boolean}
 */

Peer.prototype.hasCompactSupport = function hasCompactSupport() {
  if (this.version < common.COMPACT_VERSION) return false;

  if (!this.options.hasWitness()) return true;

  if (!(this.services & services.WITNESS)) return false;

  return this.version >= common.COMPACT_WITNESS_VERSION;
};

/**
 * Test whether the peer sent us a
 * compatible compact block handshake.
 * @returns {Boolean}
 */

Peer.prototype.hasCompact = function hasCompact() {
  if (this.compactMode === -1) return false;

  if (!this.options.hasWitness()) return true;

  if (!this.compactWitness) return false;

  return true;
};

/**
 * Inspect the peer.
 * @returns {String}
 */

Peer.prototype.inspect = function inspect() {
  return '<Peer:' + ' handshake=' + this.handshake + ' host=' + this.hostname() + ' outbound=' + this.outbound + ' ping=' + this.minPing + '>';
};

/**
 * PeerOptions
 * @alias module:net.PeerOptions
 * @constructor
 */

function PeerOptions(options) {
  if (!(this instanceof PeerOptions)) return new PeerOptions(options);

  this.network = Network.primary;
  this.logger = Logger.global;

  this.createSocket = tcp.createSocket;
  this.version = common.PROTOCOL_VERSION;
  this.services = common.LOCAL_SERVICES;
  this.agent = common.USER_AGENT;
  this.noRelay = false;
  this.spv = false;
  this.compact = false;
  this.headers = false;
  this.banScore = common.BAN_SCORE;

  this.getHeight = PeerOptions.getHeight;
  this.isFull = PeerOptions.isFull;
  this.hasWitness = PeerOptions.hasWitness;
  this.createNonce = PeerOptions.createNonce;
  this.hasNonce = PeerOptions.hasNonce;
  this.getRate = PeerOptions.getRate;

  if (options) this.fromOptions(options);
}

/**
 * Inject properties from object.
 * @private
 * @param {Object} options
 * @returns {PeerOptions}
 */

PeerOptions.prototype.fromOptions = function fromOptions(options) {
  assert(options, 'Options are required.');

  if (options.network != null) this.network = Network.get(options.network);

  if (options.logger != null) {
    assert((0, _typeof3.default)(options.logger) === 'object');
    this.logger = options.logger;
  }

  if (options.createSocket != null) {
    assert(typeof options.createSocket === 'function');
    this.createSocket = options.createSocket;
  }

  if (options.version != null) {
    assert(typeof options.version === 'number');
    this.version = options.version;
  }

  if (options.services != null) {
    assert(typeof options.services === 'number');
    this.services = options.services;
  }

  if (options.agent != null) {
    assert(typeof options.agent === 'string');
    this.agent = options.agent;
  }

  if (options.noRelay != null) {
    assert(typeof options.noRelay === 'boolean');
    this.noRelay = options.noRelay;
  }

  if (options.spv != null) {
    assert(typeof options.spv === 'boolean');
    this.spv = options.spv;
  }

  if (options.compact != null) {
    assert(typeof options.compact === 'boolean');
    this.compact = options.compact;
  }

  if (options.headers != null) {
    assert(typeof options.headers === 'boolean');
    this.headers = options.headers;
  }

  if (options.banScore != null) {
    assert(typeof options.banScore === 'number');
    this.banScore = options.banScore;
  }

  if (options.getHeight != null) {
    assert(typeof options.getHeight === 'function');
    this.getHeight = options.getHeight;
  }

  if (options.isFull != null) {
    assert(typeof options.isFull === 'function');
    this.isFull = options.isFull;
  }

  if (options.hasWitness != null) {
    assert(typeof options.hasWitness === 'function');
    this.hasWitness = options.hasWitness;
  }

  if (options.createNonce != null) {
    assert(typeof options.createNonce === 'function');
    this.createNonce = options.createNonce;
  }

  if (options.hasNonce != null) {
    assert(typeof options.hasNonce === 'function');
    this.hasNonce = options.hasNonce;
  }

  if (options.getRate != null) {
    assert(typeof options.getRate === 'function');
    this.getRate = options.getRate;
  }

  return this;
};

/**
 * Instantiate options from object.
 * @param {Object} options
 * @returns {PeerOptions}
 */

PeerOptions.fromOptions = function fromOptions(options) {
  return new PeerOptions().fromOptions(options);
};

/**
 * Get the chain height.
 * @private
 * @returns {Number}
 */

PeerOptions.getHeight = function getHeight() {
  return 0;
};

/**
 * Test whether the chain is synced.
 * @private
 * @returns {Boolean}
 */

PeerOptions.isFull = function isFull() {
  return false;
};

/**
 * Whether segwit is enabled.
 * @private
 * @returns {Boolean}
 */

PeerOptions.hasWitness = function hasWitness() {
  return true;
};

/**
 * Create a version packet nonce.
 * @private
 * @param {String} hostname
 * @returns {Buffer}
 */

PeerOptions.createNonce = function createNonce(hostname) {
  return util.nonce();
};

/**
 * Test whether version nonce is ours.
 * @private
 * @param {Buffer} nonce
 * @returns {Boolean}
 */

PeerOptions.hasNonce = function hasNonce(nonce) {
  return false;
};

/**
 * Get fee rate for txid.
 * @private
 * @param {Hash} hash
 * @returns {Rate}
 */

PeerOptions.getRate = function getRate(hash) {
  return -1;
};

/**
 * RequestEntry
 * @constructor
 * @ignore
 */

function RequestEntry() {
  this.timeout = 0;
  this.jobs = [];
}

RequestEntry.prototype.addJob = function addJob(resolve, reject) {
  this.jobs.push(co.job(resolve, reject));
};

RequestEntry.prototype.setTimeout = function setTimeout(timeout) {
  this.timeout = util.ms() + timeout;
};

RequestEntry.prototype.reject = function reject(err) {
  var i, job;

  for (i = 0; i < this.jobs.length; i++) {
    job = this.jobs[i];
    job.reject(err);
  }

  this.jobs.length = 0;
};

RequestEntry.prototype.resolve = function resolve(result) {
  var i, job;

  for (i = 0; i < this.jobs.length; i++) {
    job = this.jobs[i];
    job.resolve(result);
  }

  this.jobs.length = 0;
};

/*
 * Expose
 */

module.exports = Peer;