/*!
 * bip150.js - peer auth.
 * Copyright (c) 2016-2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 * Resources:
 *   https://github.com/bitcoin/bips/blob/master/bip-0150.mediawiki
 */

'use strict';

var _keys = require('babel-runtime/core-js/object/keys');

var _keys2 = _interopRequireDefault(_keys);

var _regenerator = require('babel-runtime/regenerator');

var _regenerator2 = _interopRequireDefault(_regenerator);

var _typeof2 = require('babel-runtime/helpers/typeof');

var _typeof3 = _interopRequireDefault(_typeof2);

var _promise = require('babel-runtime/core-js/promise');

var _promise2 = _interopRequireDefault(_promise);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var assert = require('assert');
var EventEmitter = require('events').EventEmitter;
var util = require('../utils/util');
var co = require('../utils/co');
var crypto = require('../crypto/crypto');
var packets = require('./packets');
var ec = require('../crypto/ec');
var StaticWriter = require('../utils/staticwriter');
var base58 = require('../utils/base58');
var encoding = require('../utils/encoding');
var IP = require('../utils/ip');
var dns = require('./dns');
var fs = require('../utils/fs');
var Logger = require('../node/logger');

/**
 * Represents a BIP150 input/output stream.
 * @alias module:net.BIP150
 * @constructor
 * @param {BIP151} bip151
 * @param {String} host
 * @param {Boolean} outbound
 * @param {AuthDB} db
 * @param {Buffer} key - Identity key.
 * @property {BIP151} bip151
 * @property {BIP151Stream} input
 * @property {BIP151Stream} output
 * @property {String} hostname
 * @property {Boolean} outbound
 * @property {AuthDB} db
 * @property {Buffer} privateKey
 * @property {Buffer} publicKey
 * @property {Buffer} peerIdentity
 * @property {Boolean} challengeReceived
 * @property {Boolean} replyReceived
 * @property {Boolean} proposeReceived
 * @property {Boolean} challengeSent
 * @property {Boolean} auth
 * @property {Boolean} completed
 */

function BIP150(bip151, host, outbound, db, key) {
  if (!(this instanceof BIP150)) return new BIP150(bip151, host, outbound, db, key);

  EventEmitter.call(this);

  assert(bip151, 'BIP150 requires BIP151.');
  assert(typeof host === 'string', 'Hostname required.');
  assert(typeof outbound === 'boolean', 'Outbound flag required.');
  assert(db instanceof AuthDB, 'Auth DB required.');
  assert(Buffer.isBuffer(key), 'Identity key required.');

  this.bip151 = bip151;
  this.input = bip151.input;
  this.output = bip151.output;
  this.hostname = host;
  this.outbound = outbound;
  this.db = db;
  this.privateKey = key;
  this.publicKey = ec.publicKeyCreate(key, true);

  this.peerIdentity = null;
  this.challengeReceived = false;
  this.replyReceived = false;
  this.proposeReceived = false;
  this.challengeSent = false;
  this.auth = false;
  this.completed = false;
  this.job = null;
  this.timeout = null;
  this.onAuth = null;

  this._init();
}

util.inherits(BIP150, EventEmitter);

/**
 * Initialize BIP150.
 * @private
 */

BIP150.prototype._init = function _init() {
  if (this.outbound) this.peerIdentity = this.db.getKnown(this.hostname);
};

/**
 * Test whether the state should be
 * considered authed. This differs
 * for inbound vs. outbound.
 * @returns {Boolean}
 */

BIP150.prototype.isAuthed = function isAuthed() {
  if (this.outbound) return this.challengeSent && this.challengeReceived;
  return this.challengeReceived && this.replyReceived;
};

/**
 * Handle a received challenge hash.
 * Returns an authreply signature.
 * @param {Buffer} hash
 * @returns {Buffer}
 * @throws on auth failure
 */

BIP150.prototype.challenge = function challenge(hash) {
  var type = this.outbound ? 'r' : 'i';
  var msg, sig;

  assert(this.bip151.handshake, 'No BIP151 handshake before challenge.');
  assert(!this.challengeReceived, 'Peer challenged twice.');
  this.challengeReceived = true;

  if (hash.equals(encoding.ZERO_HASH)) throw new Error('Auth failure.');

  msg = this.hash(this.input.sid, type, this.publicKey);

  if (!crypto.ccmp(hash, msg)) return encoding.ZERO_SIG64;

  if (this.isAuthed()) {
    this.auth = true;
    this.emit('auth');
  }

  sig = ec.sign(msg, this.privateKey);

  // authreply
  return ec.fromDER(sig);
};

/**
 * Handle a received reply signature.
 * Returns an authpropose hash.
 * @param {Buffer} data
 * @returns {Buffer}
 * @throws on auth failure
 */

BIP150.prototype.reply = function reply(data) {
  var type = this.outbound ? 'i' : 'r';
  var sig, msg, result;

  assert(this.challengeSent, 'Unsolicited reply.');
  assert(!this.replyReceived, 'Peer replied twice.');
  this.replyReceived = true;

  if (data.equals(encoding.ZERO_SIG64)) throw new Error('Auth failure.');

  if (!this.peerIdentity) return crypto.randomBytes(32);

  sig = ec.toDER(data);
  msg = this.hash(this.output.sid, type, this.peerIdentity);

  result = ec.verify(msg, sig, this.peerIdentity);

  if (!result) return crypto.randomBytes(32);

  if (this.isAuthed()) {
    this.auth = true;
    this.emit('auth');
    return;
  }

  assert(this.outbound, 'No challenge received before reply on inbound.');

  // authpropose
  return this.hash(this.input.sid, 'p', this.publicKey);
};

/**
 * Handle a received propose hash.
 * Returns an authchallenge hash.
 * @param {Buffer} hash
 * @returns {Buffer}
 */

BIP150.prototype.propose = function propose(hash) {
  var match;

  assert(!this.outbound, 'Outbound peer tried to propose.');
  assert(!this.challengeSent, 'Unsolicited propose.');
  assert(!this.proposeReceived, 'Peer proposed twice.');
  this.proposeReceived = true;

  match = this.findAuthorized(hash);

  if (!match) return encoding.ZERO_HASH;

  this.peerIdentity = match;

  // Add them in case we ever connect to them.
  this.db.addKnown(this.hostname, this.peerIdentity);

  this.challengeSent = true;

  // authchallenge
  return this.hash(this.output.sid, 'r', this.peerIdentity);
};

/**
 * Create initial authchallenge hash
 * for the peer. The peer's identity
 * key must be known.
 * @returns {AuthChallengePacket}
 */

BIP150.prototype.toChallenge = function toChallenge() {
  var msg;

  assert(this.bip151.handshake, 'No BIP151 handshake before challenge.');
  assert(this.outbound, 'Cannot challenge an inbound connection.');
  assert(this.peerIdentity, 'Cannot challenge without a peer identity.');

  msg = this.hash(this.output.sid, 'i', this.peerIdentity);

  assert(!this.challengeSent, 'Cannot initiate challenge twice.');
  this.challengeSent = true;

  return new packets.AuthChallengePacket(msg);
};

/**
 * Derive new cipher keys based on
 * BIP150 data. This differs from
 * the regular key derivation of BIP151.
 * @param {Buffer} sid - Sesson ID
 * @param {Buffer} key - `k1` or `k2`
 * @param {Buffer} req - Requesting Identity Key
 * @param {Buffer} res - Response Identity Key
 * @returns {Buffer}
 */

BIP150.prototype.rekey = function rekey(sid, key, req, res) {
  var seed = Buffer.allocUnsafe(130);
  sid.copy(seed, 0);
  key.copy(seed, 32);
  req.copy(seed, 64);
  res.copy(seed, 97);
  return crypto.hash256(seed);
};

/**
 * Rekey the BIP151 input stream
 * using BIP150-style derivation.
 */

BIP150.prototype.rekeyInput = function rekeyInput() {
  var stream = this.input;
  var req = this.peerIdentity;
  var res = this.publicKey;
  var k1 = this.rekey(stream.sid, stream.k1, req, res);
  var k2 = this.rekey(stream.sid, stream.k2, req, res);
  stream.rekey(k1, k2);
};

/**
 * Rekey the BIP151 output stream
 * using BIP150-style derivation.
 */

BIP150.prototype.rekeyOutput = function rekeyOutput() {
  var stream = this.output;
  var req = this.publicKey;
  var res = this.peerIdentity;
  var k1 = this.rekey(stream.sid, stream.k1, req, res);
  var k2 = this.rekey(stream.sid, stream.k2, req, res);
  stream.rekey(k1, k2);
};

/**
 * Create a hash using the session ID.
 * @param {Buffer} sid
 * @param {String} ch
 * @param {Buffer} key
 * @returns {Buffer}
 */

BIP150.prototype.hash = function hash(sid, ch, key) {
  var data = Buffer.allocUnsafe(66);
  sid.copy(data, 0);
  data[32] = ch.charCodeAt(0);
  key.copy(data, 33);
  return crypto.hash256(data);
};

/**
 * Find an authorized peer in the Auth
 * DB based on a proposal hash. Note
 * that the hash to find is specific
 * to the state of BIP151. This results
 * in an O(n) search.
 * @param {Buffer} hash
 * @returns {Buffer|null}
 */

BIP150.prototype.findAuthorized = function findAuthorized(hash) {
  var i, key, msg;

  // Scary O(n) stuff.
  for (i = 0; i < this.db.authorized.length; i++) {
    key = this.db.authorized[i];
    msg = this.hash(this.output.sid, 'p', key);

    // XXX Do we really need a constant
    // time compare here? Do it just to
    // be safe I guess.
    if (crypto.ccmp(msg, hash)) return key;
  }
};

/**
 * Destroy the BIP150 stream and
 * any current running wait job.
 */

BIP150.prototype.destroy = function destroy() {
  if (!this.job) return;

  this.reject(new Error('BIP150 stream was destroyed.'));
};

/**
 * Cleanup wait job.
 * @private
 * @returns {Job}
 */

BIP150.prototype.cleanup = function cleanup(err) {
  var job = this.job;

  assert(!this.completed, 'Already completed.');
  assert(job, 'No completion job.');

  this.completed = true;
  this.job = null;

  if (this.timeout != null) {
    clearTimeout(this.timeout);
    this.timeout = null;
  }

  if (this.onAuth) {
    this.removeListener('auth', this.onAuth);
    this.onAuth = null;
  }

  return job;
};

/**
 * Resolve the current wait job.
 * @private
 * @param {Object} result
 */

BIP150.prototype.resolve = function resolve(result) {
  var job = this.cleanup();
  job.resolve(result);
};

/**
 * Reject the current wait job.
 * @private
 * @param {Error} err
 */

BIP150.prototype.reject = function reject(err) {
  var job = this.cleanup();
  job.reject(err);
};

/**
 * Wait for handshake to complete.
 * @param {Number} timeout
 * @returns {Promise}
 */

BIP150.prototype.wait = function wait(timeout) {
  var self = this;
  return new _promise2.default(function (resolve, reject) {
    self._wait(timeout, resolve, reject);
  });
};

/**
 * Wait for handshake to complete.
 * @private
 * @param {Number} timeout
 * @param {Function} resolve
 * @param {Function} reject
 */

BIP150.prototype._wait = function wait(timeout, resolve, reject) {
  var self = this;

  assert(!this.auth, 'Cannot wait for init after handshake.');

  this.job = co.job(resolve, reject);

  if (this.outbound && !this.peerIdentity) {
    this.reject(new Error('No identity for ' + this.hostname + '.'));
    return;
  }

  this.timeout = setTimeout(function () {
    self.reject(new Error('BIP150 handshake timed out.'));
  }, timeout);

  this.onAuth = this.resolve.bind(this);
  this.once('auth', this.onAuth);
};

/**
 * Serialize the peer's identity
 * key as a BIP150 "address".
 * @returns {Base58String}
 */

BIP150.prototype.getAddress = function getAddress() {
  assert(this.peerIdentity, 'Cannot serialize address.');
  return BIP150.address(this.peerIdentity);
};

/**
 * Serialize an identity key as a
 * BIP150 "address".
 * @returns {Base58String}
 */

BIP150.address = function address(key) {
  var bw = new StaticWriter(27);
  bw.writeU8(0x0f);
  bw.writeU16BE(0xff01);
  bw.writeBytes(crypto.hash160(key));
  bw.writeChecksum();
  return base58.encode(bw.render());
};

/**
 * AuthDB
 * @alias module:net.AuthDB
 * @constructor
 */

function AuthDB(options) {
  if (!(this instanceof AuthDB)) return new AuthDB(options);

  this.logger = Logger.global;
  this.resolve = dns.lookup;
  this.prefix = null;
  this.dnsKnown = [];

  this.known = {};
  this.authorized = [];

  this._init(options);
}

/**
 * Initialize authdb with options.
 * @param {Object} options
 */

AuthDB.prototype._init = function _init(options) {
  if (!options) return;

  if (options.logger != null) {
    assert((0, _typeof3.default)(options.logger) === 'object');
    this.logger = options.logger.context('authdb');
  }

  if (options.resolve != null) {
    assert(typeof options.resolve === 'function');
    this.resolve = options.resolve;
  }

  if (options.knownPeers != null) {
    assert((0, _typeof3.default)(options.knownPeers) === 'object');
    this.setKnown(options.knownPeers);
  }

  if (options.authPeers != null) {
    assert(Array.isArray(options.authPeers));
    this.setAuthorized(options.authPeers);
  }

  if (options.prefix != null) {
    assert(typeof options.prefix === 'string');
    this.prefix = options.prefix;
  }
};

/**
 * Open auth database (lookup known peers).
 * @method
 * @returns {Promise}
 */

AuthDB.prototype.open = co( /*#__PURE__*/_regenerator2.default.mark(function open() {
  return _regenerator2.default.wrap(function open$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:
          _context.next = 2;
          return this.readKnown();

        case 2:
          _context.next = 4;
          return this.readAuth();

        case 4:
          _context.next = 6;
          return this.lookup();

        case 6:
        case 'end':
          return _context.stop();
      }
    }
  }, open, this);
}));

/**
 * Close auth database.
 * @method
 * @returns {Promise}
 */

AuthDB.prototype.close = co( /*#__PURE__*/_regenerator2.default.mark(function close() {
  return _regenerator2.default.wrap(function close$(_context2) {
    while (1) {
      switch (_context2.prev = _context2.next) {
        case 0:
          ;

        case 1:
        case 'end':
          return _context2.stop();
      }
    }
  }, close, this);
}));

/**
 * Add a known peer.
 * @param {String} host - Peer Hostname
 * @param {Buffer} key - Identity Key
 */

AuthDB.prototype.addKnown = function addKnown(host, key) {
  var addr;

  assert(typeof host === 'string', 'Known host must be a string.');

  assert(Buffer.isBuffer(key) && key.length === 33, 'Invalid public key for known peer.');

  addr = IP.fromHostname(host);

  if (addr.type === IP.types.DNS) {
    // Defer this for resolution.
    this.dnsKnown.push([addr, key]);
    return;
  }

  this.known[host] = key;
};

/**
 * Add an authorized peer.
 * @param {Buffer} key - Identity Key
 */

AuthDB.prototype.addAuthorized = function addAuthorized(key) {
  assert(Buffer.isBuffer(key) && key.length === 33, 'Invalid public key for authorized peer.');
  this.authorized.push(key);
};

/**
 * Initialize known peers with a host->key map.
 * @param {Object} map
 */

AuthDB.prototype.setKnown = function setKnown(map) {
  var keys = (0, _keys2.default)(map);
  var i, host, key;

  this.known = {};

  for (i = 0; i < keys.length; i++) {
    host = keys[i];
    key = map[host];
    this.addKnown(host, key);
  }
};

/**
 * Initialize authorized peers with a list of keys.
 * @param {Buffer[]} keys
 */

AuthDB.prototype.setAuthorized = function setAuthorized(keys) {
  var i, key;

  this.authorized.length = 0;

  for (i = 0; i < keys.length; i++) {
    key = keys[i];
    this.addAuthorized(key);
  }
};

/**
 * Get a known peer key by hostname.
 * @param {String} hostname
 * @returns {Buffer|null}
 */

AuthDB.prototype.getKnown = function getKnown(hostname) {
  var known = this.known[hostname];
  var addr;

  if (known) return known;

  addr = IP.fromHostname(hostname);

  return this.known[addr.host];
};

/**
 * Lookup known peers.
 * @method
 * @returns {Promise}
 */

AuthDB.prototype.lookup = co( /*#__PURE__*/_regenerator2.default.mark(function lookup() {
  var jobs, i, addr;
  return _regenerator2.default.wrap(function lookup$(_context3) {
    while (1) {
      switch (_context3.prev = _context3.next) {
        case 0:
          jobs = [];


          for (i = 0; i < this.dnsKnown.length; i++) {
            addr = this.dnsKnown[i];
            jobs.push(this.populate(addr[0], addr[1]));
          }

          _context3.next = 4;
          return _promise2.default.all(jobs);

        case 4:
        case 'end':
          return _context3.stop();
      }
    }
  }, lookup, this);
}));

/**
 * Populate known peers with hosts.
 * @method
 * @private
 * @param {Object} addr
 * @param {Buffer} key
 * @returns {Promise}
 */

AuthDB.prototype.populate = co( /*#__PURE__*/_regenerator2.default.mark(function populate(addr, key) {
  var i, hosts, host;
  return _regenerator2.default.wrap(function populate$(_context4) {
    while (1) {
      switch (_context4.prev = _context4.next) {
        case 0:

          assert(addr.type === IP.types.DNS, 'Resolved host passed.');

          this.logger.info('Resolving authorized hosts from: %s.', addr.host);

          _context4.prev = 2;
          _context4.next = 5;
          return this.resolve(addr.host);

        case 5:
          hosts = _context4.sent;
          _context4.next = 12;
          break;

        case 8:
          _context4.prev = 8;
          _context4.t0 = _context4['catch'](2);

          this.logger.error(_context4.t0);
          return _context4.abrupt('return');

        case 12:

          for (i = 0; i < hosts.length; i++) {
            host = hosts[i];

            if (addr.port !== 0) host = IP.toHostname(host, addr.port);

            this.known[host] = key;
          }

        case 13:
        case 'end':
          return _context4.stop();
      }
    }
  }, populate, this, [[2, 8]]);
}));

/**
 * Parse known peers.
 * @param {String} text
 * @returns {Object}
 */

AuthDB.prototype.readKnown = co( /*#__PURE__*/_regenerator2.default.mark(function readKnown() {
  var file, text;
  return _regenerator2.default.wrap(function readKnown$(_context5) {
    while (1) {
      switch (_context5.prev = _context5.next) {
        case 0:
          if (!fs.unsupported) {
            _context5.next = 2;
            break;
          }

          return _context5.abrupt('return');

        case 2:
          if (this.prefix) {
            _context5.next = 4;
            break;
          }

          return _context5.abrupt('return');

        case 4:

          file = this.prefix + '/known-peers';

          _context5.prev = 5;
          _context5.next = 8;
          return fs.readFile(file, 'utf8');

        case 8:
          text = _context5.sent;
          _context5.next = 16;
          break;

        case 11:
          _context5.prev = 11;
          _context5.t0 = _context5['catch'](5);

          if (!(_context5.t0.code === 'ENOENT')) {
            _context5.next = 15;
            break;
          }

          return _context5.abrupt('return');

        case 15:
          throw _context5.t0;

        case 16:

          this.parseKnown(text);

        case 17:
        case 'end':
          return _context5.stop();
      }
    }
  }, readKnown, this, [[5, 11]]);
}));

/**
 * Parse known peers.
 * @param {String} text
 * @returns {Object}
 */

AuthDB.prototype.parseKnown = function parseKnown(text) {
  var lines = text.split(/\n+/);
  var i, line, parts, hostname, host, ip, key;

  for (i = 0; i < lines.length; i++) {
    line = lines[i].trim();

    if (line.length === 0) continue;

    if (/^\s*#/.test(line)) continue;

    parts = line.split(/\s+/);

    if (parts.length < 2) continue;

    hostname = parts[0].trim().split(',');

    if (hostname.length >= 2) {
      host = hostname[0];
      ip = hostname[1];
    } else {
      host = null;
      ip = hostname[0];
    }

    key = parts[1].trim();
    key = Buffer.from(key, 'hex');

    if (key.length !== 33) throw new Error('Invalid key: ' + parts[1]);

    if (host && host.length > 0) this.addKnown(host, key);

    if (ip.length === 0) continue;

    this.addKnown(ip, key);
  }
};

/**
 * Parse known peers.
 * @param {String} text
 * @returns {Object}
 */

AuthDB.prototype.readAuth = co( /*#__PURE__*/_regenerator2.default.mark(function readAuth() {
  var file, text;
  return _regenerator2.default.wrap(function readAuth$(_context6) {
    while (1) {
      switch (_context6.prev = _context6.next) {
        case 0:
          if (!fs.unsupported) {
            _context6.next = 2;
            break;
          }

          return _context6.abrupt('return');

        case 2:
          if (this.prefix) {
            _context6.next = 4;
            break;
          }

          return _context6.abrupt('return');

        case 4:

          file = this.prefix + '/authorized-peers';

          _context6.prev = 5;
          _context6.next = 8;
          return fs.readFile(file, 'utf8');

        case 8:
          text = _context6.sent;
          _context6.next = 16;
          break;

        case 11:
          _context6.prev = 11;
          _context6.t0 = _context6['catch'](5);

          if (!(_context6.t0.code === 'ENOENT')) {
            _context6.next = 15;
            break;
          }

          return _context6.abrupt('return');

        case 15:
          throw _context6.t0;

        case 16:

          this.parseAuth(text);

        case 17:
        case 'end':
          return _context6.stop();
      }
    }
  }, readAuth, this, [[5, 11]]);
}));

/**
 * Parse authorized peers.
 * @param {String} text
 * @returns {Buffer[]} keys
 */

AuthDB.prototype.parseAuth = function parseAuth(text) {
  var lines = text.split(/\n+/);
  var i, line, key;

  for (i = 0; i < lines.length; i++) {
    line = lines[i].trim();

    if (line.length === 0) continue;

    if (/^\s*#/.test(line)) continue;

    key = Buffer.from(line, 'hex');

    if (key.length !== 33) throw new Error('Invalid key: ' + line);

    this.addAuthorized(key);
  }
};

/*
 * Expose
 */

exports = BIP150;

exports.BIP150 = BIP150;
exports.AuthDB = AuthDB;

module.exports = exports;