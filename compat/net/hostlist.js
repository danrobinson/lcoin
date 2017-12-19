/*!
 * hostlist.js - address management for bcoin
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

var _stringify = require('babel-runtime/core-js/json/stringify');

var _stringify2 = _interopRequireDefault(_stringify);

var _regenerator = require('babel-runtime/regenerator');

var _regenerator2 = _interopRequireDefault(_regenerator);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var assert = require('assert');
var util = require('../utils/util');
var IP = require('../utils/ip');
var co = require('../utils/co');
var Network = require('../protocol/network');
var NetAddress = require('../primitives/netaddress');
var List = require('../utils/list');
var murmur3 = require('../utils/murmur3');
var Map = require('../utils/map');
var common = require('./common');
var seeds = require('./seeds');
var dns = require('./dns');
var Logger = require('../node/logger');
var fs = require('../utils/fs');

/**
 * Host List
 * @alias module:net.HostList
 * @constructor
 * @param {Object} options
 */

function HostList(options) {
  if (!(this instanceof HostList)) return new HostList(options);

  this.options = new HostListOptions(options);
  this.network = this.options.network;
  this.logger = this.options.logger.context('hostlist');
  this.address = this.options.address;
  this.resolve = this.options.resolve;

  this.dnsSeeds = [];
  this.dnsNodes = [];

  this.map = {};
  this.fresh = [];
  this.totalFresh = 0;
  this.used = [];
  this.totalUsed = 0;
  this.nodes = [];
  this.local = new Map();
  this.banned = {};

  this.timer = null;
  this.needsFlush = false;

  this._init();
}

/**
 * Number of days before considering
 * an address stale.
 * @const {Number}
 * @default
 */

HostList.HORIZON_DAYS = 30;

/**
 * Number of retries (without success)
 * before considering an address stale.
 * @const {Number}
 * @default
 */

HostList.RETRIES = 3;

/**
 * Number of days after reaching
 * MAX_FAILURES to consider an
 * address stale.
 * @const {Number}
 * @default
 */

HostList.MIN_FAIL_DAYS = 7;

/**
 * Maximum number of failures
 * allowed before considering
 * an address stale.
 * @const {Number}
 * @default
 */

HostList.MAX_FAILURES = 10;

/**
 * Maximum number of references
 * in fresh buckets.
 * @const {Number}
 * @default
 */

HostList.MAX_REFS = 8;

/**
 * Serialization version.
 * @const {Number}
 * @default
 */

HostList.VERSION = 0;

/**
 * Local address scores.
 * @enum {Number}
 * @default
 */

HostList.scores = {
  NONE: 0,
  IF: 1,
  BIND: 2,
  UPNP: 3,
  HTTP: 3,
  MANUAL: 4,
  MAX: 5
};

/**
 * Initialize list.
 * @private
 */

HostList.prototype._init = function init() {
  var options = this.options;
  var scores = HostList.scores;
  var hosts = IP.getPublic();
  var port = this.address.port;
  var i, host;

  for (i = 0; i < this.options.maxBuckets; i++) {
    this.fresh.push(new Map());
  }for (i = 0; i < this.options.maxBuckets; i++) {
    this.used.push(new List());
  }this.setSeeds(options.seeds);
  this.setNodes(options.nodes);

  this.pushLocal(this.address, scores.MANUAL);
  this.addLocal(options.host, options.port, scores.BIND);

  for (i = 0; i < hosts.length; i++) {
    host = hosts[i];
    this.addLocal(host, port, scores.IF);
  }
};

/**
 * Open hostlist and read hosts file.
 * @method
 * @returns {Promise}
 */

HostList.prototype.open = co( /*#__PURE__*/_regenerator2.default.mark(function open() {
  return _regenerator2.default.wrap(function open$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:
          _context.prev = 0;
          _context.next = 3;
          return this.loadFile();

        case 3:
          _context.next = 9;
          break;

        case 5:
          _context.prev = 5;
          _context.t0 = _context['catch'](0);

          this.logger.warning('Hosts deserialization failed.');
          this.logger.error(_context.t0);

        case 9:

          if (this.size() === 0) this.injectSeeds();

          _context.next = 12;
          return this.discoverNodes();

        case 12:

          this.start();

        case 13:
        case 'end':
          return _context.stop();
      }
    }
  }, open, this, [[0, 5]]);
}));

/**
 * Close hostlist.
 * @method
 * @returns {Promise}
 */

HostList.prototype.close = co( /*#__PURE__*/_regenerator2.default.mark(function close() {
  return _regenerator2.default.wrap(function close$(_context2) {
    while (1) {
      switch (_context2.prev = _context2.next) {
        case 0:
          this.stop();
          _context2.next = 3;
          return this.flush();

        case 3:
          this.reset();

        case 4:
        case 'end':
          return _context2.stop();
      }
    }
  }, close, this);
}));

/**
 * Start flush interval.
 */

HostList.prototype.start = function start() {
  if (!this.options.persistent) return;

  if (!this.options.filename) return;

  assert(this.timer == null);
  this.timer = co.setInterval(this.flush, this.options.flushInterval, this);
};

/**
 * Stop flush interval.
 */

HostList.prototype.stop = function stop() {
  if (!this.options.persistent) return;

  if (!this.options.filename) return;

  assert(this.timer != null);
  co.clearInterval(this.timer);
  this.timer = null;
};

/**
 * Read and initialize from hosts file.
 * @method
 * @returns {Promise}
 */

HostList.prototype.injectSeeds = function injectSeeds() {
  var nodes = seeds.get(this.network.type);
  var i, node, addr;

  for (i = 0; i < nodes.length; i++) {
    node = nodes[i];
    addr = NetAddress.fromHostname(node, this.network);

    if (!addr.isRoutable()) continue;

    if (!this.options.onion && addr.isOnion()) continue;

    if (addr.port === 0) continue;

    this.add(addr);
  }
};

/**
 * Read and initialize from hosts file.
 * @method
 * @returns {Promise}
 */

HostList.prototype.loadFile = co( /*#__PURE__*/_regenerator2.default.mark(function loadFile() {
  var filename, data, json;
  return _regenerator2.default.wrap(function loadFile$(_context3) {
    while (1) {
      switch (_context3.prev = _context3.next) {
        case 0:
          filename = this.options.filename;

          if (!fs.unsupported) {
            _context3.next = 3;
            break;
          }

          return _context3.abrupt('return');

        case 3:
          if (this.options.persistent) {
            _context3.next = 5;
            break;
          }

          return _context3.abrupt('return');

        case 5:
          if (filename) {
            _context3.next = 7;
            break;
          }

          return _context3.abrupt('return');

        case 7:
          _context3.prev = 7;
          _context3.next = 10;
          return fs.readFile(filename, 'utf8');

        case 10:
          data = _context3.sent;
          _context3.next = 18;
          break;

        case 13:
          _context3.prev = 13;
          _context3.t0 = _context3['catch'](7);

          if (!(_context3.t0.code === 'ENOENT')) {
            _context3.next = 17;
            break;
          }

          return _context3.abrupt('return');

        case 17:
          throw _context3.t0;

        case 18:

          json = JSON.parse(data);

          this.fromJSON(json);

        case 20:
        case 'end':
          return _context3.stop();
      }
    }
  }, loadFile, this, [[7, 13]]);
}));

/**
 * Flush addrs to hosts file.
 * @method
 * @returns {Promise}
 */

HostList.prototype.flush = co( /*#__PURE__*/_regenerator2.default.mark(function flush() {
  var filename, json, data;
  return _regenerator2.default.wrap(function flush$(_context4) {
    while (1) {
      switch (_context4.prev = _context4.next) {
        case 0:
          filename = this.options.filename;

          if (!fs.unsupported) {
            _context4.next = 3;
            break;
          }

          return _context4.abrupt('return');

        case 3:
          if (this.options.persistent) {
            _context4.next = 5;
            break;
          }

          return _context4.abrupt('return');

        case 5:
          if (filename) {
            _context4.next = 7;
            break;
          }

          return _context4.abrupt('return');

        case 7:
          if (this.needsFlush) {
            _context4.next = 9;
            break;
          }

          return _context4.abrupt('return');

        case 9:

          this.needsFlush = false;

          this.logger.debug('Writing hosts to %s.', filename);

          json = this.toJSON();
          data = (0, _stringify2.default)(json);

          _context4.prev = 13;
          _context4.next = 16;
          return fs.writeFile(filename, data, 'utf8');

        case 16:
          _context4.next = 22;
          break;

        case 18:
          _context4.prev = 18;
          _context4.t0 = _context4['catch'](13);

          this.logger.warning('Writing hosts failed.');
          this.logger.error(_context4.t0);

        case 22:
        case 'end':
          return _context4.stop();
      }
    }
  }, flush, this, [[13, 18]]);
}));

/**
 * Get list size.
 * @returns {Number}
 */

HostList.prototype.size = function size() {
  return this.totalFresh + this.totalUsed;
};

/**
 * Test whether the host list is full.
 * @returns {Boolean}
 */

HostList.prototype.isFull = function isFull() {
  var max = this.options.maxBuckets * this.options.maxEntries;
  return this.size() >= max;
};

/**
 * Reset host list.
 */

HostList.prototype.reset = function reset() {
  var i, bucket;

  this.map = {};

  for (i = 0; i < this.fresh.length; i++) {
    bucket = this.fresh[i];
    bucket.reset();
  }

  for (i = 0; i < this.used.length; i++) {
    bucket = this.used[i];
    bucket.reset();
  }

  this.totalFresh = 0;
  this.totalUsed = 0;

  this.nodes.length = 0;
};

/**
 * Mark a peer as banned.
 * @param {String} host
 */

HostList.prototype.ban = function ban(host) {
  this.banned[host] = util.now();
};

/**
 * Unban host.
 * @param {String} host
 */

HostList.prototype.unban = function unban(host) {
  delete this.banned[host];
};

/**
 * Clear banned hosts.
 */

HostList.prototype.clearBanned = function clearBanned() {
  this.banned = {};
};

/**
 * Test whether the host is banned.
 * @param {String} host
 * @returns {Boolean}
 */

HostList.prototype.isBanned = function isBanned(host) {
  var time = this.banned[host];

  if (time == null) return false;

  if (util.now() > time + this.options.banTime) {
    delete this.banned[host];
    return false;
  }

  return true;
};

/**
 * Allocate a new host.
 * @returns {HostEntry}
 */

HostList.prototype.getHost = function getHost() {
  var now = this.network.now();
  var buckets = null;
  var factor = 1;
  var index, key, bucket, entry, num;

  if (this.totalFresh > 0) buckets = this.fresh;

  if (this.totalUsed > 0) {
    if (this.totalFresh === 0 || util.random(0, 2) === 0) buckets = this.used;
  }

  if (!buckets) return;

  for (;;) {
    index = util.random(0, buckets.length);
    bucket = buckets[index];

    if (bucket.size === 0) continue;

    index = util.random(0, bucket.size);

    if (buckets === this.used) {
      entry = bucket.head;
      while (index--) {
        entry = entry.next;
      }
    } else {
      key = bucket.keys()[index];
      entry = bucket.get(key);
    }

    num = util.random(0, 1 << 30);

    if (num < factor * entry.chance(now) * (1 << 30)) return entry;

    factor *= 1.2;
  }
};

/**
 * Get fresh bucket for host.
 * @private
 * @param {HostEntry} entry
 * @returns {Map}
 */

HostList.prototype.freshBucket = function freshBucket(entry) {
  var addr = entry.addr;
  var src = entry.src;
  var data, hash, index;

  data = util.concat(addr.raw, src.raw);
  hash = murmur3(data, 0xfba4c795);
  index = hash % this.fresh.length;

  return this.fresh[index];
};

/**
 * Get used bucket for host.
 * @private
 * @param {HostEntry} entry
 * @returns {List}
 */

HostList.prototype.usedBucket = function usedBucket(entry) {
  var addr = entry.addr;
  var hash = murmur3(addr.raw, 0xfba4c795);
  var index = hash % this.used.length;
  return this.used[index];
};

/**
 * Add host to host list.
 * @param {NetAddress} addr
 * @param {NetAddress?} src
 * @returns {Boolean}
 */

HostList.prototype.add = function add(addr, src) {
  var now = this.network.now();
  var penalty = 2 * 60 * 60;
  var interval = 24 * 60 * 60;
  var factor = 1;
  var i, entry, bucket;

  assert(addr.port !== 0);

  entry = this.map[addr.hostname];

  if (entry) {
    // No source means we're inserting
    // this ourselves. No penalty.
    if (!src) penalty = 0;

    // Update services.
    entry.addr.services |= addr.services;
    entry.addr.services >>>= 0;

    // Online?
    if (now - addr.ts < 24 * 60 * 60) interval = 60 * 60;

    // Periodically update time.
    if (entry.addr.ts < addr.ts - interval - penalty) {
      entry.addr.ts = addr.ts;
      this.needsFlush = true;
    }

    // Do not update if no new
    // information is present.
    if (entry.addr.ts && addr.ts <= entry.addr.ts) return false;

    // Do not update if the entry was
    // already in the "used" table.
    if (entry.used) return false;

    assert(entry.refCount > 0);

    // Do not update if the max
    // reference count is reached.
    if (entry.refCount === HostList.MAX_REFS) return false;

    assert(entry.refCount < HostList.MAX_REFS);

    // Stochastic test: previous refCount
    // N: 2^N times harder to increase it.
    for (i = 0; i < entry.refCount; i++) {
      factor *= 2;
    }if (util.random(0, factor) !== 0) return false;
  } else {
    if (this.isFull()) return false;

    if (!src) src = this.address;

    entry = new HostEntry(addr, src);

    this.totalFresh++;
  }

  bucket = this.freshBucket(entry);

  if (bucket.has(entry.key())) return false;

  if (bucket.size >= this.options.maxEntries) this.evictFresh(bucket);

  bucket.set(entry.key(), entry);
  entry.refCount++;

  this.map[entry.key()] = entry;
  this.needsFlush = true;

  return true;
};

/**
 * Evict a host from fresh bucket.
 * @param {Map} bucket
 */

HostList.prototype.evictFresh = function evictFresh(bucket) {
  var keys = bucket.keys();
  var i, key, entry, old;

  for (i = 0; i < keys.length; i++) {
    key = keys[i];
    entry = bucket.get(key);

    if (this.isStale(entry)) {
      bucket.remove(entry.key());

      if (--entry.refCount === 0) {
        delete this.map[entry.key()];
        this.totalFresh--;
      }

      continue;
    }

    if (!old) {
      old = entry;
      continue;
    }

    if (entry.addr.ts < old.addr.ts) old = entry;
  }

  if (!old) return;

  bucket.remove(old.key());

  if (--old.refCount === 0) {
    delete this.map[old.key()];
    this.totalFresh--;
  }
};

/**
 * Test whether a host is evictable.
 * @param {HostEntry} entry
 * @returns {Boolean}
 */

HostList.prototype.isStale = function isStale(entry) {
  var now = this.network.now();

  if (entry.lastAttempt && entry.lastAttempt >= now - 60) return false;

  if (entry.addr.ts > now + 10 * 60) return true;

  if (entry.addr.ts === 0) return true;

  if (now - entry.addr.ts > HostList.HORIZON_DAYS * 24 * 60 * 60) return true;

  if (entry.lastSuccess === 0 && entry.attempts >= HostList.RETRIES) return true;

  if (now - entry.lastSuccess > HostList.MIN_FAIL_DAYS * 24 * 60 * 60) {
    if (entry.attempts >= HostList.MAX_FAILURES) return true;
  }

  return false;
};

/**
 * Remove host from host list.
 * @param {String} hostname
 * @returns {NetAddress}
 */

HostList.prototype.remove = function remove(hostname) {
  var entry = this.map[hostname];
  var i, head, bucket;

  if (!entry) return;

  if (entry.used) {
    assert(entry.refCount === 0);

    head = entry;
    while (head.prev) {
      head = head.prev;
    }for (i = 0; i < this.used.length; i++) {
      bucket = this.used[i];
      if (bucket.head === head) {
        bucket.remove(entry);
        this.totalUsed--;
        break;
      }
    }

    assert(i < this.used.length);
  } else {
    for (i = 0; i < this.fresh.length; i++) {
      bucket = this.fresh[i];
      if (bucket.remove(entry.key())) entry.refCount--;
    }

    this.totalFresh--;
    assert(entry.refCount === 0);
  }

  delete this.map[entry.key()];

  return entry.addr;
};

/**
 * Mark host as failed.
 * @param {String} hostname
 */

HostList.prototype.markAttempt = function markAttempt(hostname) {
  var entry = this.map[hostname];
  var now = this.network.now();

  if (!entry) return;

  entry.attempts++;
  entry.lastAttempt = now;
};

/**
 * Mark host as successfully connected.
 * @param {String} hostname
 */

HostList.prototype.markSuccess = function markSuccess(hostname) {
  var entry = this.map[hostname];
  var now = this.network.now();

  if (!entry) return;

  if (now - entry.addr.ts > 20 * 60) entry.addr.ts = now;
};

/**
 * Mark host as successfully ack'd.
 * @param {String} hostname
 * @param {Number} services
 */

HostList.prototype.markAck = function markAck(hostname, services) {
  var entry = this.map[hostname];
  var now = this.network.now();
  var i, bucket, evicted, old, fresh;

  if (!entry) return;

  entry.addr.services |= services;
  entry.addr.services >>>= 0;

  entry.lastSuccess = now;
  entry.lastAttempt = now;
  entry.attempts = 0;

  if (entry.used) return;

  assert(entry.refCount > 0);

  // Remove from fresh.
  for (i = 0; i < this.fresh.length; i++) {
    bucket = this.fresh[i];
    if (bucket.remove(entry.key())) {
      entry.refCount--;
      old = bucket;
    }
  }

  assert(old);
  assert(entry.refCount === 0);
  this.totalFresh--;

  // Find room in used bucket.
  bucket = this.usedBucket(entry);

  if (bucket.size < this.options.maxEntries) {
    entry.used = true;
    bucket.push(entry);
    this.totalUsed++;
    return;
  }

  // No room. Evict.
  evicted = this.evictUsed(bucket);
  fresh = this.freshBucket(evicted);

  // Move to entry's old bucket if no room.
  if (fresh.size >= this.options.maxEntries) fresh = old;

  // Swap to evicted's used bucket.
  entry.used = true;
  bucket.replace(evicted, entry);

  // Move evicted to fresh bucket.
  evicted.used = false;
  fresh.set(evicted.key(), evicted);
  assert(evicted.refCount === 0);
  evicted.refCount++;
  this.totalFresh++;
};

/**
 * Pick used for eviction.
 * @param {List} bucket
 */

HostList.prototype.evictUsed = function evictUsed(bucket) {
  var old = bucket.head;
  var entry;

  for (entry = bucket.head; entry; entry = entry.next) {
    if (entry.addr.ts < old.addr.ts) old = entry;
  }

  return old;
};

/**
 * Convert address list to array.
 * @returns {NetAddress[]}
 */

HostList.prototype.toArray = function toArray() {
  var keys = (0, _keys2.default)(this.map);
  var out = [];
  var i, key, entry;

  for (i = 0; i < keys.length; i++) {
    key = keys[i];
    entry = this.map[key];
    out.push(entry.addr);
  }

  assert.equal(out.length, this.size());

  return out;
};

/**
 * Add a preferred seed.
 * @param {String} host
 */

HostList.prototype.addSeed = function addSeed(host) {
  var addr = IP.fromHostname(host, this.network.port);

  if (addr.type === IP.types.DNS) {
    // Defer for resolution.
    this.dnsSeeds.push(addr);
    return;
  }

  addr = NetAddress.fromHost(addr.host, addr.port, this.network);

  this.add(addr);

  return addr;
};

/**
 * Add a priority node.
 * @param {String} host
 * @returns {NetAddress}
 */

HostList.prototype.addNode = function addNode(host) {
  var addr = IP.fromHostname(host, this.network.port);

  if (addr.type === IP.types.DNS) {
    // Defer for resolution.
    this.dnsNodes.push(addr);
    return;
  }

  addr = NetAddress.fromHost(addr.host, addr.port, this.network);

  this.nodes.push(addr);
  this.add(addr);

  return addr;
};

/**
 * Remove a priority node.
 * @param {String} host
 * @returns {Boolean}
 */

HostList.prototype.removeNode = function removeNode(host) {
  var addr = IP.fromHostname(host, this.network.port);
  var i, node;

  for (i = 0; i < this.nodes.length; i++) {
    node = this.nodes[i];

    if (node.host !== addr.host) continue;

    if (node.port !== addr.port) continue;

    this.nodes.splice(i, 1);

    return true;
  }

  return false;
};

/**
 * Set initial seeds.
 * @param {String[]} seeds
 */

HostList.prototype.setSeeds = function setSeeds(seeds) {
  var i, host;

  this.dnsSeeds.length = 0;

  for (i = 0; i < seeds.length; i++) {
    host = seeds[i];
    this.addSeed(host);
  }
};

/**
 * Set priority nodes.
 * @param {String[]} nodes
 */

HostList.prototype.setNodes = function setNodes(nodes) {
  var i, host;

  this.dnsNodes.length = 0;
  this.nodes.length = 0;

  for (i = 0; i < nodes.length; i++) {
    host = nodes[i];
    this.addNode(host);
  }
};

/**
 * Add a local address.
 * @param {String} host
 * @param {Number} port
 * @param {Number} score
 * @returns {Boolean}
 */

HostList.prototype.addLocal = function addLocal(host, port, score) {
  var addr = NetAddress.fromHost(host, port, this.network);
  addr.services = this.options.services;
  return this.pushLocal(addr, score);
};

/**
 * Add a local address.
 * @param {NetAddress} addr
 * @param {Number} score
 * @returns {Boolean}
 */

HostList.prototype.pushLocal = function pushLocal(addr, score) {
  var local;

  if (!addr.isRoutable()) return false;

  if (this.local.has(addr.hostname)) return false;

  local = new LocalAddress(addr, score);

  this.local.set(addr.hostname, local);

  return true;
};

/**
 * Get local address based on reachability.
 * @param {NetAddress?} src
 * @returns {NetAddress}
 */

HostList.prototype.getLocal = function getLocal(src) {
  var keys = this.local.keys();
  var bestReach = -1;
  var bestScore = -1;
  var bestDest = null;
  var i, key, dest, reach;

  if (!src) src = this.address;

  if (keys.length === 0) return null;

  for (i = 0; i < keys.length; i++) {
    key = keys[i];
    dest = this.local.get(key);
    reach = src.getReachability(dest.addr);

    if (reach < bestReach) continue;

    if (reach > bestReach || dest.score > bestScore) {
      bestReach = reach;
      bestScore = dest.score;
      bestDest = dest.addr;
    }
  }

  bestDest.ts = this.network.now();

  return bestDest;
};

/**
 * Mark local address as seen during a handshake.
 * @param {NetAddress} addr
 * @returns {Boolean}
 */

HostList.prototype.markLocal = function markLocal(addr) {
  var local = this.local.get(addr.hostname);

  if (!local) return false;

  local.score++;

  return true;
};

/**
 * Discover hosts from seeds.
 * @method
 * @returns {Promise}
 */

HostList.prototype.discoverSeeds = co( /*#__PURE__*/_regenerator2.default.mark(function discoverSeeds() {
  var jobs, i, seed;
  return _regenerator2.default.wrap(function discoverSeeds$(_context5) {
    while (1) {
      switch (_context5.prev = _context5.next) {
        case 0:
          jobs = [];


          for (i = 0; i < this.dnsSeeds.length; i++) {
            seed = this.dnsSeeds[i];
            jobs.push(this.populateSeed(seed));
          }

          _context5.next = 4;
          return _promise2.default.all(jobs);

        case 4:
        case 'end':
          return _context5.stop();
      }
    }
  }, discoverSeeds, this);
}));

/**
 * Discover hosts from nodes.
 * @method
 * @returns {Promise}
 */

HostList.prototype.discoverNodes = co( /*#__PURE__*/_regenerator2.default.mark(function discoverNodes() {
  var jobs, i, node;
  return _regenerator2.default.wrap(function discoverNodes$(_context6) {
    while (1) {
      switch (_context6.prev = _context6.next) {
        case 0:
          jobs = [];


          for (i = 0; i < this.dnsNodes.length; i++) {
            node = this.dnsNodes[i];
            jobs.push(this.populateNode(node));
          }

          _context6.next = 4;
          return _promise2.default.all(jobs);

        case 4:
        case 'end':
          return _context6.stop();
      }
    }
  }, discoverNodes, this);
}));

/**
 * Lookup node's domain.
 * @method
 * @param {Object} addr
 * @returns {Promise}
 */

HostList.prototype.populateNode = co( /*#__PURE__*/_regenerator2.default.mark(function populateNode(addr) {
  var addrs;
  return _regenerator2.default.wrap(function populateNode$(_context7) {
    while (1) {
      switch (_context7.prev = _context7.next) {
        case 0:
          _context7.next = 2;
          return this.populate(addr);

        case 2:
          addrs = _context7.sent;

          if (!(addrs.length === 0)) {
            _context7.next = 5;
            break;
          }

          return _context7.abrupt('return');

        case 5:

          this.nodes.push(addrs[0]);
          this.add(addrs[0]);

        case 7:
        case 'end':
          return _context7.stop();
      }
    }
  }, populateNode, this);
}));

/**
 * Populate from seed.
 * @method
 * @param {Object} seed
 * @returns {Promise}
 */

HostList.prototype.populateSeed = co( /*#__PURE__*/_regenerator2.default.mark(function populateSeed(seed) {
  var addrs, i, addr;
  return _regenerator2.default.wrap(function populateSeed$(_context8) {
    while (1) {
      switch (_context8.prev = _context8.next) {
        case 0:
          _context8.next = 2;
          return this.populate(seed);

        case 2:
          addrs = _context8.sent;


          for (i = 0; i < addrs.length; i++) {
            addr = addrs[i];
            this.add(addr);
          }

        case 4:
        case 'end':
          return _context8.stop();
      }
    }
  }, populateSeed, this);
}));

/**
 * Lookup hosts from dns host.
 * @method
 * @param {Object} target
 * @returns {Promise}
 */

HostList.prototype.populate = co( /*#__PURE__*/_regenerator2.default.mark(function populate(target) {
  var addrs, i, addr, hosts, host;
  return _regenerator2.default.wrap(function populate$(_context9) {
    while (1) {
      switch (_context9.prev = _context9.next) {
        case 0:
          addrs = [];


          assert(target.type === IP.types.DNS, 'Resolved host passed.');

          this.logger.info('Resolving host: %s.', target.host);

          _context9.prev = 3;
          _context9.next = 6;
          return this.resolve(target.host);

        case 6:
          hosts = _context9.sent;
          _context9.next = 13;
          break;

        case 9:
          _context9.prev = 9;
          _context9.t0 = _context9['catch'](3);

          this.logger.error(_context9.t0);
          return _context9.abrupt('return', addrs);

        case 13:

          for (i = 0; i < hosts.length; i++) {
            host = hosts[i];
            addr = NetAddress.fromHost(host, target.port, this.network);
            addrs.push(addr);
          }

          return _context9.abrupt('return', addrs);

        case 15:
        case 'end':
          return _context9.stop();
      }
    }
  }, populate, this, [[3, 9]]);
}));

/**
 * Convert host list to json-friendly object.
 * @returns {Object}
 */

HostList.prototype.toJSON = function toJSON() {
  var addrs = [];
  var fresh = [];
  var used = [];
  var i, keys, key, bucket, entry;

  keys = (0, _keys2.default)(this.map);

  for (i = 0; i < keys.length; i++) {
    key = keys[i];
    entry = this.map[key];
    addrs.push(entry.toJSON());
  }

  for (i = 0; i < this.fresh.length; i++) {
    bucket = this.fresh[i];
    keys = bucket.keys();
    fresh.push(keys);
  }

  for (i = 0; i < this.used.length; i++) {
    bucket = this.used[i];
    keys = [];
    for (entry = bucket.head; entry; entry = entry.next) {
      keys.push(entry.key());
    }used.push(keys);
  }

  return {
    version: HostList.VERSION,
    addrs: addrs,
    fresh: fresh,
    used: used
  };
};

/**
 * Inject properties from json object.
 * @private
 * @param {Object} json
 * @returns {HostList}
 */

HostList.prototype.fromJSON = function fromJSON(json) {
  var sources = {};
  var map = {};
  var fresh = [];
  var totalFresh = 0;
  var used = [];
  var totalUsed = 0;
  var i, j, bucket, keys, key, addr, entry, src;

  assert(json && (typeof json === 'undefined' ? 'undefined' : (0, _typeof3.default)(json)) === 'object');

  assert(json.version === HostList.VERSION, 'Bad address serialization version.');

  assert(Array.isArray(json.addrs));

  for (i = 0; i < json.addrs.length; i++) {
    addr = json.addrs[i];
    entry = HostEntry.fromJSON(addr, this.network);
    src = sources[entry.src.hostname];

    // Save some memory.
    if (!src) {
      src = entry.src;
      sources[src.hostname] = src;
    }

    entry.src = src;

    map[entry.key()] = entry;
  }

  assert(Array.isArray(json.fresh));
  assert(json.fresh.length <= this.options.maxBuckets, 'Buckets mismatch.');

  for (i = 0; i < json.fresh.length; i++) {
    keys = json.fresh[i];
    bucket = new Map();

    for (j = 0; j < keys.length; j++) {
      key = keys[j];
      entry = map[key];
      assert(entry);
      if (entry.refCount === 0) totalFresh++;
      entry.refCount++;
      bucket.set(key, entry);
    }

    assert(bucket.size <= this.options.maxEntries, 'Bucket size mismatch.');

    fresh.push(bucket);
  }

  assert(fresh.length === this.fresh.length, 'Buckets mismatch.');

  assert(Array.isArray(json.used));
  assert(json.used.length <= this.options.maxBuckets, 'Buckets mismatch.');

  for (i = 0; i < json.used.length; i++) {
    keys = json.used[i];
    bucket = new List();

    for (j = 0; j < keys.length; j++) {
      key = keys[j];
      entry = map[key];
      assert(entry);
      assert(entry.refCount === 0);
      assert(!entry.used);
      entry.used = true;
      totalUsed++;
      bucket.push(entry);
    }

    assert(bucket.size <= this.options.maxEntries, 'Bucket size mismatch.');

    used.push(bucket);
  }

  assert(used.length === this.used.length, 'Buckets mismatch.');

  keys = (0, _keys2.default)(map);

  for (i = 0; i < keys.length; i++) {
    key = keys[i];
    entry = map[key];
    assert(entry.used || entry.refCount > 0);
  }

  this.map = map;
  this.fresh = fresh;
  this.totalFresh = totalFresh;
  this.used = used;
  this.totalUsed = totalUsed;

  return this;
};

/**
 * Instantiate host list from json object.
 * @param {Object} options
 * @param {Object} json
 * @returns {HostList}
 */

HostList.fromJSON = function fromJSON(options, json) {
  return new HostEntry(options).fromJSON(json);
};

/**
 * HostEntry
 * @alias module:net.HostEntry
 * @constructor
 * @param {NetAddress} addr
 * @param {NetAddress} src
 */

function HostEntry(addr, src) {
  if (!(this instanceof HostEntry)) return new HostEntry(addr, src);

  this.addr = addr || new NetAddress();
  this.src = src || new NetAddress();
  this.prev = null;
  this.next = null;
  this.used = false;
  this.refCount = 0;
  this.attempts = 0;
  this.lastSuccess = 0;
  this.lastAttempt = 0;

  if (addr) this.fromOptions(addr, src);
}

/**
 * Inject properties from options.
 * @private
 * @param {NetAddress} addr
 * @param {NetAddress} src
 * @returns {HostEntry}
 */

HostEntry.prototype.fromOptions = function fromOptions(addr, src) {
  assert(addr instanceof NetAddress);
  assert(src instanceof NetAddress);
  this.addr = addr;
  this.src = src;
  return this;
};

/**
 * Instantiate host entry from options.
 * @param {NetAddress} addr
 * @param {NetAddress} src
 * @returns {HostEntry}
 */

HostEntry.fromOptions = function fromOptions(addr, src) {
  return new HostEntry().fromOptions(addr, src);
};

/**
 * Get key suitable for a hash table (hostname).
 * @returns {String}
 */

HostEntry.prototype.key = function key() {
  return this.addr.hostname;
};

/**
 * Get host priority.
 * @param {Number} now
 * @returns {Number}
 */

HostEntry.prototype.chance = function _chance(now) {
  var attempts = this.attempts;
  var chance = 1;

  if (now - this.lastAttempt < 60 * 10) chance *= 0.01;

  chance *= Math.pow(0.66, Math.min(attempts, 8));

  return chance;
};

/**
 * Inspect host address.
 * @returns {Object}
 */

HostEntry.prototype.inspect = function inspect() {
  return {
    addr: this.addr,
    src: this.src,
    used: this.used,
    refCount: this.refCount,
    attempts: this.attempts,
    lastSuccess: util.date(this.lastSuccess),
    lastAttempt: util.date(this.lastAttempt)
  };
};

/**
 * Convert host entry to json-friendly object.
 * @returns {Object}
 */

HostEntry.prototype.toJSON = function toJSON() {
  return {
    addr: this.addr.hostname,
    src: this.src.hostname,
    services: this.addr.services.toString(2),
    ts: this.addr.ts,
    attempts: this.attempts,
    lastSuccess: this.lastSuccess,
    lastAttempt: this.lastAttempt
  };
};

/**
 * Inject properties from json object.
 * @private
 * @param {Object} json
 * @param {Network} network
 * @returns {HostEntry}
 */

HostEntry.prototype.fromJSON = function fromJSON(json, network) {
  assert(json && (typeof json === 'undefined' ? 'undefined' : (0, _typeof3.default)(json)) === 'object');
  assert(typeof json.addr === 'string');
  assert(typeof json.src === 'string');

  this.addr.fromHostname(json.addr, network);

  if (json.services != null) {
    assert(typeof json.services === 'string');
    assert(json.services.length > 0);
    assert(json.services.length <= 32);
    this.addr.services = parseInt(json.services, 2);
    assert(util.isUInt32(this.addr.services));
  }

  if (json.ts != null) {
    assert(util.isNumber(json.ts));
    assert(json.ts >= 0);
    this.addr.ts = json.ts;
  }

  if (json.src != null) {
    assert(typeof json.src === 'string');
    this.src.fromHostname(json.src, network);
  }

  if (json.attempts != null) {
    assert(util.isNumber(json.attempts));
    assert(json.attempts >= 0);
    this.attempts = json.attempts;
  }

  if (json.lastSuccess != null) {
    assert(util.isNumber(json.lastSuccess));
    assert(json.lastSuccess >= 0);
    this.lastSuccess = json.lastSuccess;
  }

  if (json.lastAttempt != null) {
    assert(util.isNumber(json.lastAttempt));
    assert(json.lastAttempt >= 0);
    this.lastAttempt = json.lastAttempt;
  }

  return this;
};

/**
 * Instantiate host entry from json object.
 * @param {Object} json
 * @param {Network} network
 * @returns {HostEntry}
 */

HostEntry.fromJSON = function fromJSON(json, network) {
  return new HostEntry().fromJSON(json, network);
};

/**
 * LocalAddress
 * @alias module:net.LocalAddress
 * @constructor
 * @param {NetAddress} addr
 * @param {Number?} score
 */

function LocalAddress(addr, score) {
  this.addr = addr;
  this.score = score || 0;
}

/**
 * Host List Options
 * @alias module:net.HostListOptions
 * @constructor
 * @param {Object?} options
 */

function HostListOptions(options) {
  if (!(this instanceof HostListOptions)) return new HostListOptions(options);

  this.network = Network.primary;
  this.logger = Logger.global;
  this.resolve = dns.lookup;
  this.host = '0.0.0.0';
  this.port = this.network.port;
  this.services = common.LOCAL_SERVICES;
  this.onion = false;
  this.banTime = common.BAN_TIME;

  this.address = new NetAddress();
  this.address.services = this.services;
  this.address.ts = this.network.now();

  this.seeds = this.network.seeds;
  this.nodes = [];

  this.maxBuckets = 20;
  this.maxEntries = 50;

  this.prefix = null;
  this.filename = null;
  this.persistent = false;
  this.flushInterval = 120000;

  if (options) this.fromOptions(options);
}

/**
 * Inject properties from options.
 * @private
 * @param {Object} options
 */

HostListOptions.prototype.fromOptions = function fromOptions(options) {
  var raw;

  assert(options, 'Options are required.');

  if (options.network != null) {
    this.network = Network.get(options.network);
    this.seeds = this.network.seeds;
    this.address.port = this.network.port;
    this.port = this.network.port;
  }

  if (options.logger != null) {
    assert((0, _typeof3.default)(options.logger) === 'object');
    this.logger = options.logger;
  }

  if (options.resolve != null) {
    assert(typeof options.resolve === 'function');
    this.resolve = options.resolve;
  }

  if (options.banTime != null) {
    assert(options.banTime >= 0);
    this.banTime = options.banTime;
  }

  if (options.seeds) {
    assert(Array.isArray(options.seeds));
    this.seeds = options.seeds;
  }

  if (options.nodes) {
    assert(Array.isArray(options.nodes));
    this.nodes = options.nodes;
  }

  if (options.host != null) {
    assert(typeof options.host === 'string');
    raw = IP.toBuffer(options.host);
    this.host = IP.toString(raw);
    if (IP.isRoutable(raw)) this.address.setHost(this.host);
  }

  if (options.port != null) {
    assert(typeof options.port === 'number');
    assert(options.port > 0 && options.port <= 0xffff);
    this.port = options.port;
    this.address.setPort(this.port);
  }

  if (options.publicHost != null) {
    assert(typeof options.publicHost === 'string');
    this.address.setHost(options.publicHost);
  }

  if (options.publicPort != null) {
    assert(typeof options.publicPort === 'number');
    assert(options.publicPort > 0 && options.publicPort <= 0xffff);
    this.address.setPort(options.publicPort);
  }

  if (options.services != null) {
    assert(typeof options.services === 'number');
    this.services = options.services;
  }

  if (options.onion != null) {
    assert(typeof options.onion === 'boolean');
    this.onion = options.onion;
  }

  if (options.maxBuckets != null) {
    assert(typeof options.maxBuckets === 'number');
    this.maxBuckets = options.maxBuckets;
  }

  if (options.maxEntries != null) {
    assert(typeof options.maxEntries === 'number');
    this.maxEntries = options.maxEntries;
  }

  if (options.persistent != null) {
    assert(typeof options.persistent === 'boolean');
    this.persistent = options.persistent;
  }

  if (options.prefix != null) {
    assert(typeof options.prefix === 'string');
    this.prefix = options.prefix;
    this.filename = this.prefix + '/hosts.json';
  }

  if (options.filename != null) {
    assert(typeof options.filename === 'string');
    this.filename = options.filename;
  }

  if (options.flushInterval != null) {
    assert(options.flushInterval >= 0);
    this.flushInterval = options.flushInterval;
  }

  this.address.ts = this.network.now();
  this.address.services = this.services;

  return this;
};

/*
 * Expose
 */

module.exports = HostList;