/*!
 * miner.js - block generator for bcoin
 * Copyright (c) 2014-2015, Fedor Indutny (MIT License)
 * Copyright (c) 2014-2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

var _typeof2 = require('babel-runtime/helpers/typeof');

var _typeof3 = _interopRequireDefault(_typeof2);

var _regenerator = require('babel-runtime/regenerator');

var _regenerator2 = _interopRequireDefault(_regenerator);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var assert = require('assert');
var util = require('../utils/util');
var co = require('../utils/co');
var Heap = require('../utils/heap');
var AsyncObject = require('../utils/asyncobject');
var Amount = require('../btc/amount');
var Address = require('../primitives/address');
var BlockTemplate = require('./template');
var Network = require('../protocol/network');
var consensus = require('../protocol/consensus');
var policy = require('../protocol/policy');
var CPUMiner = require('./cpuminer');
var BlockEntry = BlockTemplate.BlockEntry;

/**
 * A bitcoin miner and block generator.
 * @alias module:mining.Miner
 * @constructor
 * @param {Object} options
 */

function Miner(options) {
  if (!(this instanceof Miner)) return new Miner(options);

  AsyncObject.call(this);

  this.options = new MinerOptions(options);
  this.network = this.options.network;
  this.logger = this.options.logger.context('miner');
  this.chain = this.options.chain;
  this.mempool = this.options.mempool;
  this.addresses = this.options.addresses;
  this.locker = this.chain.locker;
  this.cpu = new CPUMiner(this);

  this.init();
}

util.inherits(Miner, AsyncObject);

/**
 * Open the miner, wait for the chain and mempool to load.
 * @method
 * @alias module:mining.Miner#open
 * @returns {Promise}
 */

Miner.prototype.init = function init() {
  var self = this;

  this.cpu.on('error', function (err) {
    self.emit('error', err);
  });
};

/**
 * Open the miner, wait for the chain and mempool to load.
 * @method
 * @alias module:mining.Miner#open
 * @returns {Promise}
 */

Miner.prototype._open = co( /*#__PURE__*/_regenerator2.default.mark(function open() {
  return _regenerator2.default.wrap(function open$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:
          _context.next = 2;
          return this.chain.open();

        case 2:
          if (!this.mempool) {
            _context.next = 5;
            break;
          }

          _context.next = 5;
          return this.mempool.open();

        case 5:
          _context.next = 7;
          return this.cpu.open();

        case 7:

          this.logger.info('Miner loaded (flags=%s).', this.options.coinbaseFlags.toString('utf8'));

          if (this.addresses.length === 0) this.logger.warning('No reward address is set for miner!');

        case 9:
        case 'end':
          return _context.stop();
      }
    }
  }, open, this);
}));

/**
 * Close the miner.
 * @method
 * @alias module:mining.Miner#close
 * @returns {Promise}
 */

Miner.prototype._close = co( /*#__PURE__*/_regenerator2.default.mark(function close() {
  return _regenerator2.default.wrap(function close$(_context2) {
    while (1) {
      switch (_context2.prev = _context2.next) {
        case 0:
          _context2.next = 2;
          return this.cpu.close();

        case 2:
        case 'end':
          return _context2.stop();
      }
    }
  }, close, this);
}));

/**
 * Create a block template.
 * @method
 * @param {ChainEntry?} tip
 * @param {Address?} address
 * @returns {Promise} - Returns {@link BlockTemplate}.
 */

Miner.prototype.createBlock = co( /*#__PURE__*/_regenerator2.default.mark(function createBlock(tip, address) {
  var unlock;
  return _regenerator2.default.wrap(function createBlock$(_context3) {
    while (1) {
      switch (_context3.prev = _context3.next) {
        case 0:
          _context3.next = 2;
          return this.locker.lock();

        case 2:
          unlock = _context3.sent;
          _context3.prev = 3;
          _context3.next = 6;
          return this._createBlock(tip, address);

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
  }, createBlock, this, [[3,, 7, 10]]);
}));

/**
 * Create a block template (without a lock).
 * @method
 * @private
 * @param {ChainEntry?} tip
 * @param {Address?} address
 * @returns {Promise} - Returns {@link BlockTemplate}.
 */

Miner.prototype._createBlock = co( /*#__PURE__*/_regenerator2.default.mark(function createBlock(tip, address) {
  var version, ts, mtp, locktime, target, attempt, block, state;
  return _regenerator2.default.wrap(function createBlock$(_context4) {
    while (1) {
      switch (_context4.prev = _context4.next) {
        case 0:
          version = this.options.version;


          if (!tip) tip = this.chain.tip;

          if (!address) address = this.getAddress();

          if (!(version === -1)) {
            _context4.next = 7;
            break;
          }

          _context4.next = 6;
          return this.chain.computeBlockVersion(tip);

        case 6:
          version = _context4.sent;

        case 7:
          _context4.next = 9;
          return tip.getMedianTime();

        case 9:
          mtp = _context4.sent;

          ts = Math.max(this.network.now(), mtp + 1);
          locktime = ts;

          _context4.next = 14;
          return this.chain.getDeployments(ts, tip);

        case 14:
          state = _context4.sent;


          if (state.hasMTP()) locktime = mtp;

          _context4.next = 18;
          return this.chain.getTarget(ts, tip);

        case 18:
          target = _context4.sent;


          attempt = new BlockTemplate({
            prevBlock: tip.hash,
            height: tip.height + 1,
            version: version,
            ts: ts,
            bits: target,
            locktime: locktime,
            mtp: mtp,
            flags: state.flags,
            address: address,
            coinbaseFlags: this.options.coinbaseFlags,
            witness: state.hasWitness(),
            interval: this.network.halvingInterval,
            weight: this.options.reservedWeight,
            sigops: this.options.reservedSigops
          });

          this.assemble(attempt);

          this.logger.debug('Created block template (height=%d, weight=%d, fees=%d, txs=%s, diff=%d).', attempt.height, attempt.weight, Amount.btc(attempt.fees), attempt.items.length + 1, attempt.getDifficulty());

          if (!this.options.preverify) {
            _context4.next = 37;
            break;
          }

          block = attempt.toBlock();

          _context4.prev = 24;
          _context4.next = 27;
          return this.chain._verifyBlock(block);

        case 27:
          _context4.next = 36;
          break;

        case 29:
          _context4.prev = 29;
          _context4.t0 = _context4['catch'](24);

          if (!(_context4.t0.type === 'VerifyError')) {
            _context4.next = 35;
            break;
          }

          this.logger.warning('Miner created invalid block!');
          this.logger.error(_context4.t0);
          throw new Error('BUG: Miner created invalid block.');

        case 35:
          throw _context4.t0;

        case 36:

          this.logger.debug('Preverified block %d successfully!', attempt.height);

        case 37:
          return _context4.abrupt('return', attempt);

        case 38:
        case 'end':
          return _context4.stop();
      }
    }
  }, createBlock, this, [[24, 29]]);
}));

/**
 * Update block timestamp.
 * @param {BlockTemplate} attempt
 */

Miner.prototype.updateTime = function updateTime(attempt) {
  attempt.ts = Math.max(this.network.now(), attempt.mtp + 1);
};

/**
 * Create a cpu miner job.
 * @method
 * @param {ChainEntry?} tip
 * @param {Address?} address
 * @returns {Promise} Returns {@link CPUJob}.
 */

Miner.prototype.createJob = function createJob(tip, address) {
  return this.cpu.createJob(tip, address);
};

/**
 * Mine a single block.
 * @method
 * @param {ChainEntry?} tip
 * @param {Address?} address
 * @returns {Promise} Returns {@link Block}.
 */

Miner.prototype.mineBlock = function mineBlock(tip, address) {
  return this.cpu.mineBlock(tip, address);
};

/**
 * Add an address to the address list.
 * @param {Address} address
 */

Miner.prototype.addAddress = function addAddress(address) {
  this.addresses.push(Address(address));
};

/**
 * Get a random address from the address list.
 * @returns {Address}
 */

Miner.prototype.getAddress = function getAddress() {
  if (this.addresses.length === 0) return new Address();
  return this.addresses[Math.random() * this.addresses.length | 0];
};

/**
 * Get mempool entries, sort by dependency order.
 * Prioritize by priority and fee rates.
 * @param {BlockTemplate} attempt
 * @returns {MempoolEntry[]}
 */

Miner.prototype.assemble = function assemble(attempt) {
  var depMap = {};
  var queue = new Heap(cmpRate);
  var priority = this.options.priorityWeight > 0;
  var i, j, entry, item, tx, hash, input;
  var prev, deps, hashes, weight, sigops, block;

  if (priority) queue.set(cmpPriority);

  if (!this.mempool) {
    attempt.refresh();
    return [];
  }

  assert(this.mempool.tip === this.chain.tip.hash, 'Mempool/chain tip mismatch! Unsafe to create block.');

  hashes = this.mempool.getSnapshot();

  for (i = 0; i < hashes.length; i++) {
    hash = hashes[i];
    entry = this.mempool.getEntry(hash);
    item = BlockEntry.fromEntry(entry, attempt);
    tx = item.tx;

    if (tx.isCoinbase()) throw new Error('Cannot add coinbase to block.');

    for (j = 0; j < tx.inputs.length; j++) {
      input = tx.inputs[j];
      prev = input.prevout.hash;

      if (!this.mempool.hasEntry(prev)) continue;

      item.depCount += 1;

      if (!depMap[prev]) depMap[prev] = [];

      depMap[prev].push(item);
    }

    if (item.depCount > 0) continue;

    queue.insert(item);
  }

  while (queue.size() > 0) {
    item = queue.shift();
    tx = item.tx;
    hash = item.hash;
    weight = attempt.weight;
    sigops = attempt.sigops;

    if (!tx.isFinal(attempt.height, attempt.locktime)) continue;

    if (!attempt.witness && tx.hasWitness()) continue;

    weight += tx.getWeight();

    if (weight > this.options.maxWeight) continue;

    sigops += item.sigops;

    if (sigops > this.options.maxSigops) continue;

    if (priority) {
      if (weight > this.options.priorityWeight || item.priority < this.options.priorityThreshold) {
        priority = false;
        queue.set(cmpRate);
        queue.init();
        queue.insert(item);
        continue;
      }
    } else {
      if (item.free && weight >= this.options.minWeight) continue;
    }

    attempt.weight = weight;
    attempt.sigops = sigops;
    attempt.fees += item.fee;
    attempt.items.push(item);

    deps = depMap[hash];

    if (!deps) continue;

    for (j = 0; j < deps.length; j++) {
      item = deps[j];
      if (--item.depCount === 0) queue.insert(item);
    }
  }

  attempt.refresh();

  assert(attempt.weight <= consensus.MAX_BLOCK_WEIGHT, 'Block exceeds reserved weight!');

  if (this.options.preverify) {
    block = attempt.toBlock();

    assert(block.getWeight() <= attempt.weight, 'Block exceeds reserved weight!');

    assert(block.getBaseSize() <= consensus.MAX_BLOCK_SIZE, 'Block exceeds max block size.');
  }
};

/**
 * MinerOptions
 * @alias module:mining.MinerOptions
 * @constructor
 * @param {Object}
 */

function MinerOptions(options) {
  if (!(this instanceof MinerOptions)) return new MinerOptions(options);

  this.network = Network.primary;
  this.logger = null;
  this.chain = null;
  this.mempool = null;

  this.version = -1;
  this.addresses = [];
  this.coinbaseFlags = Buffer.from('mined by bcoin', 'ascii');
  this.preverify = false;

  this.minWeight = policy.MIN_BLOCK_WEIGHT;
  this.maxWeight = policy.MAX_BLOCK_WEIGHT;
  this.priorityWeight = policy.BLOCK_PRIORITY_WEIGHT;
  this.priorityThreshold = policy.BLOCK_PRIORITY_THRESHOLD;
  this.maxSigops = consensus.MAX_BLOCK_SIGOPS_COST;
  this.reservedWeight = 4000;
  this.reservedSigops = 400;

  this.fromOptions(options);
}

/**
 * Inject properties from object.
 * @private
 * @param {Object} options
 * @returns {MinerOptions}
 */

MinerOptions.prototype.fromOptions = function fromOptions(options) {
  var i, flags;

  assert(options, 'Miner requires options.');
  assert(options.chain && (0, _typeof3.default)(options.chain) === 'object', 'Miner requires a blockchain.');

  this.chain = options.chain;
  this.network = options.chain.network;
  this.logger = options.chain.logger;

  if (options.logger != null) {
    assert((0, _typeof3.default)(options.logger) === 'object');
    this.logger = options.logger;
  }

  if (options.mempool != null) {
    assert((0, _typeof3.default)(options.mempool) === 'object');
    this.mempool = options.mempool;
  }

  if (options.version != null) {
    assert(util.isNumber(options.version));
    this.version = options.version;
  }

  if (options.address) {
    if (Array.isArray(options.address)) {
      for (i = 0; i < options.address.length; i++) {
        this.addresses.push(new Address(options.address[i]));
      }
    } else {
      this.addresses.push(new Address(options.address));
    }
  }

  if (options.addresses) {
    assert(Array.isArray(options.addresses));
    for (i = 0; i < options.addresses.length; i++) {
      this.addresses.push(new Address(options.addresses[i]));
    }
  }

  if (options.coinbaseFlags) {
    flags = options.coinbaseFlags;
    if (typeof flags === 'string') flags = Buffer.from(flags, 'utf8');
    assert(Buffer.isBuffer(flags));
    assert(flags.length <= 20, 'Coinbase flags > 20 bytes.');
    this.coinbaseFlags = flags;
  }

  if (options.preverify != null) {
    assert(typeof options.preverify === 'boolean');
    this.preverify = options.preverify;
  }

  if (options.minWeight != null) {
    assert(util.isNumber(options.minWeight));
    this.minWeight = options.minWeight;
  }

  if (options.maxWeight != null) {
    assert(util.isNumber(options.maxWeight));
    assert(options.maxWeight <= consensus.MAX_BLOCK_WEIGHT, 'Max weight must be below MAX_BLOCK_WEIGHT');
    this.maxWeight = options.maxWeight;
  }

  if (options.maxSigops != null) {
    assert(util.isNumber(options.maxSigops));
    assert(options.maxSigops <= consensus.MAX_BLOCK_SIGOPS_COST, 'Max sigops must be below MAX_BLOCK_SIGOPS_COST');
    this.maxSigops = options.maxSigops;
  }

  if (options.priorityWeight != null) {
    assert(util.isNumber(options.priorityWeight));
    this.priorityWeight = options.priorityWeight;
  }

  if (options.priorityThreshold != null) {
    assert(util.isNumber(options.priorityThreshold));
    this.priorityThreshold = options.priorityThreshold;
  }

  if (options.reservedWeight != null) {
    assert(util.isNumber(options.reservedWeight));
    this.reservedWeight = options.reservedWeight;
  }

  if (options.reservedSigops != null) {
    assert(util.isNumber(options.reservedSigops));
    this.reservedSigops = options.reservedSigops;
  }

  return this;
};

/**
 * Instantiate miner options from object.
 * @param {Object} options
 * @returns {MinerOptions}
 */

MinerOptions.fromOptions = function fromOptions(options) {
  return new MinerOptions().fromOptions(options);
};

/*
 * Helpers
 */

function cmpPriority(a, b) {
  if (a.priority === b.priority) return cmpRate(a, b);
  return b.priority - a.priority;
}

function cmpRate(a, b) {
  var x = a.rate;
  var y = b.rate;

  if (a.descRate > a.rate) x = a.descRate;

  if (b.descRate > b.rate) y = b.descRate;

  if (x === y) {
    x = a.priority;
    y = b.priority;
  }

  return y - x;
}

/*
 * Expose
 */

module.exports = Miner;