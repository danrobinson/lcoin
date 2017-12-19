/*!
 * cpuminer.js - inefficient cpu miner for bcoin (because we can)
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

var assert = require('assert');
var util = require('../utils/util');
var co = require('../utils/co');
var AsyncObject = require('../utils/asyncobject');
var workerPool = require('../workers/workerpool').pool;
var mine = require('./mine');
var Lock = require('../utils/lock');

/**
 * CPU miner.
 * @alias module:mining.CPUMiner
 * @constructor
 * @param {Miner} miner
 * @emits CPUMiner#block
 * @emits CPUMiner#status
 */

function CPUMiner(miner) {
  if (!(this instanceof CPUMiner)) return new CPUMiner(miner);

  AsyncObject.call(this);

  this.miner = miner;
  this.network = this.miner.network;
  this.logger = this.miner.logger.context('cpuminer');
  this.chain = this.miner.chain;
  this.locker = new Lock();

  this.running = false;
  this.stopping = false;
  this.job = null;
  this.stopJob = null;

  this._init();
}

util.inherits(CPUMiner, AsyncObject);

/**
 * Nonce range interval.
 * @const {Number}
 * @default
 */

CPUMiner.INTERVAL = 0xffffffff / 1500 | 0;

/**
 * Initialize the miner.
 * @private
 */

CPUMiner.prototype._init = function _init() {
  var self = this;

  this.chain.on('tip', function (tip) {
    if (!self.job) return;

    if (self.job.attempt.prevBlock === tip.prevBlock) self.job.destroy();
  });
};

/**
 * Open the miner.
 * @method
 * @alias module:mining.CPUMiner#open
 * @returns {Promise}
 */

CPUMiner.prototype._open = co( /*#__PURE__*/_regenerator2.default.mark(function open() {
  return _regenerator2.default.wrap(function open$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:
        case 'end':
          return _context.stop();
      }
    }
  }, open, this);
}));

/**
 * Close the miner.
 * @method
 * @alias module:mining.CPUMiner#close
 * @returns {Promise}
 */

CPUMiner.prototype._close = co( /*#__PURE__*/_regenerator2.default.mark(function close() {
  return _regenerator2.default.wrap(function close$(_context2) {
    while (1) {
      switch (_context2.prev = _context2.next) {
        case 0:
          _context2.next = 2;
          return this.stop();

        case 2:
        case 'end':
          return _context2.stop();
      }
    }
  }, close, this);
}));

/**
 * Start mining.
 * @method
 */

CPUMiner.prototype.start = function start() {
  assert(!this.running, 'Miner is already running.');
  this._start().catch(util.nop);
};

/**
 * Start mining.
 * @method
 * @private
 * @returns {Promise}
 */

CPUMiner.prototype._start = co( /*#__PURE__*/_regenerator2.default.mark(function start() {
  var block, entry, job;
  return _regenerator2.default.wrap(function start$(_context3) {
    while (1) {
      switch (_context3.prev = _context3.next) {
        case 0:

          assert(!this.running, 'Miner is already running.');

          this.running = true;
          this.stopping = false;

        case 3:
          this.job = null;

          _context3.prev = 4;
          _context3.next = 7;
          return this.createJob();

        case 7:
          this.job = _context3.sent;
          _context3.next = 16;
          break;

        case 10:
          _context3.prev = 10;
          _context3.t0 = _context3['catch'](4);

          if (!this.stopping) {
            _context3.next = 14;
            break;
          }

          return _context3.abrupt('break', 60);

        case 14:
          this.emit('error', _context3.t0);
          return _context3.abrupt('break', 60);

        case 16:
          if (!this.stopping) {
            _context3.next = 18;
            break;
          }

          return _context3.abrupt('break', 60);

        case 18:
          _context3.prev = 18;
          _context3.next = 21;
          return this.mineAsync(this.job);

        case 21:
          block = _context3.sent;
          _context3.next = 30;
          break;

        case 24:
          _context3.prev = 24;
          _context3.t1 = _context3['catch'](18);

          if (!this.stopping) {
            _context3.next = 28;
            break;
          }

          return _context3.abrupt('break', 60);

        case 28:
          this.emit('error', _context3.t1);
          return _context3.abrupt('break', 60);

        case 30:
          if (!this.stopping) {
            _context3.next = 32;
            break;
          }

          return _context3.abrupt('break', 60);

        case 32:
          if (block) {
            _context3.next = 34;
            break;
          }

          return _context3.abrupt('continue', 58);

        case 34:
          _context3.prev = 34;
          _context3.next = 37;
          return this.chain.add(block);

        case 37:
          entry = _context3.sent;
          _context3.next = 50;
          break;

        case 40:
          _context3.prev = 40;
          _context3.t2 = _context3['catch'](34);

          if (!this.stopping) {
            _context3.next = 44;
            break;
          }

          return _context3.abrupt('break', 60);

        case 44:
          if (!(_context3.t2.type === 'VerifyError')) {
            _context3.next = 48;
            break;
          }

          this.logger.warning('Mined an invalid block!');
          this.logger.error(_context3.t2);
          return _context3.abrupt('continue', 58);

        case 48:

          this.emit('error', _context3.t2);
          return _context3.abrupt('break', 60);

        case 50:
          if (entry) {
            _context3.next = 53;
            break;
          }

          this.logger.warning('Mined a bad-prevblk (race condition?)');
          return _context3.abrupt('continue', 58);

        case 53:
          if (!this.stopping) {
            _context3.next = 55;
            break;
          }

          return _context3.abrupt('break', 60);

        case 55:

          // Log the block hex as a failsafe (in case we can't send it).
          this.logger.info('Found block: %d (%s).', entry.height, entry.rhash());
          this.logger.debug('Raw: %s', block.toRaw().toString('hex'));

          this.emit('block', block, entry);

        case 58:
          _context3.next = 3;
          break;

        case 60:

          job = this.stopJob;

          if (job) {
            this.stopJob = null;
            job.resolve();
          }

        case 62:
        case 'end':
          return _context3.stop();
      }
    }
  }, start, this, [[4, 10], [18, 24], [34, 40]]);
}));

/**
 * Stop mining.
 * @method
 * @returns {Promise}
 */

CPUMiner.prototype.stop = co( /*#__PURE__*/_regenerator2.default.mark(function stop() {
  var unlock;
  return _regenerator2.default.wrap(function stop$(_context4) {
    while (1) {
      switch (_context4.prev = _context4.next) {
        case 0:
          _context4.next = 2;
          return this.locker.lock();

        case 2:
          unlock = _context4.sent;
          _context4.prev = 3;
          _context4.next = 6;
          return this._stop();

        case 6:
          return _context4.abrupt('return', _context4.sent);

        case 7:
          _context4.prev = 7;

          unlock();
          return _context4.finish(7);

        case 10:
        case 'end':
          return _context4.stop();
      }
    }
  }, stop, this, [[3,, 7, 10]]);
}));

/**
 * Stop mining (without a lock).
 * @method
 * @returns {Promise}
 */

CPUMiner.prototype._stop = co( /*#__PURE__*/_regenerator2.default.mark(function _stop() {
  return _regenerator2.default.wrap(function _stop$(_context5) {
    while (1) {
      switch (_context5.prev = _context5.next) {
        case 0:
          if (this.running) {
            _context5.next = 2;
            break;
          }

          return _context5.abrupt('return');

        case 2:

          assert(this.running, 'Miner is not running.');
          assert(!this.stopping, 'Miner is already stopping.');

          this.stopping = true;

          if (this.job) {
            this.job.destroy();
            this.job = null;
          }

          _context5.next = 8;
          return this.wait();

        case 8:

          this.running = false;
          this.stopping = false;
          this.job = null;

        case 11:
        case 'end':
          return _context5.stop();
      }
    }
  }, _stop, this);
}));

/**
 * Wait for `done` event.
 * @private
 * @returns {Promise}
 */

CPUMiner.prototype.wait = function wait() {
  var self = this;
  return new _promise2.default(function (resolve, reject) {
    assert(!self.stopJob);
    self.stopJob = co.job(resolve, reject);
  });
};

/**
 * Create a mining job.
 * @method
 * @param {ChainEntry?} tip
 * @param {Address?} address
 * @returns {Promise} - Returns {@link Job}.
 */

CPUMiner.prototype.createJob = co( /*#__PURE__*/_regenerator2.default.mark(function createJob(tip, address) {
  var attempt;
  return _regenerator2.default.wrap(function createJob$(_context6) {
    while (1) {
      switch (_context6.prev = _context6.next) {
        case 0:
          _context6.next = 2;
          return this.miner.createBlock(tip, address);

        case 2:
          attempt = _context6.sent;
          return _context6.abrupt('return', new CPUJob(this, attempt));

        case 4:
        case 'end':
          return _context6.stop();
      }
    }
  }, createJob, this);
}));

/**
 * Mine a single block.
 * @method
 * @param {ChainEntry?} tip
 * @param {Address?} address
 * @returns {Promise} - Returns [{@link Block}].
 */

CPUMiner.prototype.mineBlock = co( /*#__PURE__*/_regenerator2.default.mark(function mineBlock(tip, address) {
  var job;
  return _regenerator2.default.wrap(function mineBlock$(_context7) {
    while (1) {
      switch (_context7.prev = _context7.next) {
        case 0:
          _context7.next = 2;
          return this.createJob(tip, address);

        case 2:
          job = _context7.sent;
          _context7.next = 5;
          return this.mineAsync(job);

        case 5:
          return _context7.abrupt('return', _context7.sent);

        case 6:
        case 'end':
          return _context7.stop();
      }
    }
  }, mineBlock, this);
}));

/**
 * Notify the miner that a new
 * tx has entered the mempool.
 */

CPUMiner.prototype.notifyEntry = function notifyEntry() {
  if (!this.running) return;

  if (!this.job) return;

  if (util.now() - this.job.start > 10) {
    this.job.destroy();
    this.job = null;
  }
};

/**
 * Hash until the nonce overflows.
 * @param {CPUJob} job
 * @returns {Number} nonce
 */

CPUMiner.prototype.findNonce = function findNonce(job) {
  var data = job.getHeader();
  var target = job.attempt.target;
  var interval = CPUMiner.INTERVAL;
  var min = 0;
  var max = interval;
  var nonce;

  while (max <= 0xffffffff) {
    nonce = mine(data, target, min, max);

    if (nonce !== -1) break;

    this.sendStatus(job, max);

    min += interval;
    max += interval;
  }

  return nonce;
};

/**
 * Hash until the nonce overflows.
 * @method
 * @param {CPUJob} job
 * @returns {Promise} Returns Number.
 */

CPUMiner.prototype.findNonceAsync = co( /*#__PURE__*/_regenerator2.default.mark(function findNonceAsync(job) {
  var data, target, interval, min, max, nonce;
  return _regenerator2.default.wrap(function findNonceAsync$(_context8) {
    while (1) {
      switch (_context8.prev = _context8.next) {
        case 0:
          data = job.getHeader();
          target = job.attempt.target;
          interval = CPUMiner.INTERVAL;
          min = 0;
          max = interval;

        case 5:
          if (!(max <= 0xffffffff)) {
            _context8.next = 18;
            break;
          }

          _context8.next = 8;
          return workerPool.mine(data, target, min, max);

        case 8:
          nonce = _context8.sent;

          if (!(nonce !== -1)) {
            _context8.next = 11;
            break;
          }

          return _context8.abrupt('break', 18);

        case 11:
          if (!job.destroyed) {
            _context8.next = 13;
            break;
          }

          return _context8.abrupt('return', nonce);

        case 13:

          this.sendStatus(job, max);

          min += interval;
          max += interval;
          _context8.next = 5;
          break;

        case 18:
          return _context8.abrupt('return', nonce);

        case 19:
        case 'end':
          return _context8.stop();
      }
    }
  }, findNonceAsync, this);
}));

/**
 * Mine synchronously until the block is found.
 * @param {CPUJob} job
 * @returns {Block}
 */

CPUMiner.prototype.mine = function mine(job) {
  var nonce;

  job.start = util.now();

  for (;;) {
    nonce = this.findNonce(job);

    if (nonce !== -1) break;

    job.updateNonce();

    this.sendStatus(job, 0);
  }

  return job.commit(nonce);
};

/**
 * Mine asynchronously until the block is found.
 * @method
 * @param {CPUJob} job
 * @returns {Promise} - Returns {@link Block}.
 */

CPUMiner.prototype.mineAsync = co( /*#__PURE__*/_regenerator2.default.mark(function mineAsync(job) {
  var nonce;
  return _regenerator2.default.wrap(function mineAsync$(_context9) {
    while (1) {
      switch (_context9.prev = _context9.next) {
        case 0:

          job.start = util.now();

        case 1:
          _context9.next = 3;
          return this.findNonceAsync(job);

        case 3:
          nonce = _context9.sent;

          if (!(nonce !== -1)) {
            _context9.next = 6;
            break;
          }

          return _context9.abrupt('break', 12);

        case 6:
          if (!job.destroyed) {
            _context9.next = 8;
            break;
          }

          return _context9.abrupt('return');

        case 8:

          job.updateNonce();

          this.sendStatus(job, 0);

        case 10:
          _context9.next = 1;
          break;

        case 12:
          return _context9.abrupt('return', job.commit(nonce));

        case 13:
        case 'end':
          return _context9.stop();
      }
    }
  }, mineAsync, this);
}));

/**
 * Send a progress report (emits `status`).
 * @param {CPUJob} job
 * @param {Number} nonce
 */

CPUMiner.prototype.sendStatus = function sendStatus(job, nonce) {
  var attempt = job.attempt;
  var tip = util.revHex(attempt.prevBlock);
  var hashes = job.getHashes(nonce);
  var hashrate = job.getRate(nonce);

  this.logger.info('Status: hashrate=%dkhs hashes=%d target=%d height=%d tip=%s', Math.floor(hashrate / 1000), hashes, attempt.bits, attempt.height, tip);

  this.emit('status', job, hashes, hashrate);
};

/**
 * Mining Job
 * @constructor
 * @ignore
 * @param {CPUMiner} miner
 * @param {BlockTemplate} attempt
 */

function CPUJob(miner, attempt) {
  this.miner = miner;
  this.attempt = attempt;
  this.destroyed = false;
  this.committed = false;
  this.start = util.now();
  this.nonce1 = 0;
  this.nonce2 = 0;
  this.refresh();
}

/**
 * Get the raw block header.
 * @param {Number} nonce
 * @returns {Buffer}
 */

CPUJob.prototype.getHeader = function getHeader() {
  var attempt = this.attempt;
  var n1 = this.nonce1;
  var n2 = this.nonce2;
  var ts = attempt.ts;
  var root = attempt.getRoot(n1, n2);
  var data = attempt.getHeader(root, ts, 0);
  return data;
};

/**
 * Commit job and return a block.
 * @param {Number} nonce
 * @returns {Block}
 */

CPUJob.prototype.commit = function commit(nonce) {
  var attempt = this.attempt;
  var n1 = this.nonce1;
  var n2 = this.nonce2;
  var ts = attempt.ts;
  var proof;

  assert(!this.committed, 'Job already committed.');
  this.committed = true;

  proof = attempt.getProof(n1, n2, ts, nonce);

  return attempt.commit(proof);
};

/**
 * Mine block synchronously.
 * @returns {Block}
 */

CPUJob.prototype.mine = function mine() {
  return this.miner.mine(this);
};

/**
 * Mine block asynchronously.
 * @returns {Promise}
 */

CPUJob.prototype.mineAsync = function mineAsync() {
  return this.miner.mineAsync(this);
};

/**
 * Refresh the block template.
 */

CPUJob.prototype.refresh = function refresh() {
  return this.attempt.refresh();
};

/**
 * Increment the extraNonce.
 */

CPUJob.prototype.updateNonce = function updateNonce() {
  if (++this.nonce2 === 0x100000000) {
    this.nonce2 = 0;
    this.nonce1++;
  }
};

/**
 * Destroy the job.
 */

CPUJob.prototype.destroy = function destroy() {
  assert(!this.destroyed, 'Job already destroyed.');
  this.destroyed = true;
};

/**
 * Calculate number of hashes computed.
 * @param {Number} nonce
 * @returns {Number}
 */

CPUJob.prototype.getHashes = function getHashes(nonce) {
  var extra = this.nonce1 * 0x100000000 + this.nonce2;
  return extra * 0xffffffff + nonce;
};

/**
 * Calculate hashrate.
 * @param {Number} nonce
 * @returns {Number}
 */

CPUJob.prototype.getRate = function getRate(nonce) {
  var hashes = this.getHashes(nonce);
  var seconds = util.now() - this.start;
  return Math.floor(hashes / seconds);
};

/**
 * Add a transaction to the block.
 * @param {TX} tx
 * @param {CoinView} view
 */

CPUJob.prototype.addTX = function addTX(tx, view) {
  return this.attempt.addTX(tx, view);
};

/**
 * Add a transaction to the block
 * (less verification than addTX).
 * @param {TX} tx
 * @param {CoinView?} view
 */

CPUJob.prototype.pushTX = function pushTX(tx, view) {
  return this.attempt.pushTX(tx, view);
};

/*
 * Expose
 */

module.exports = CPUMiner;