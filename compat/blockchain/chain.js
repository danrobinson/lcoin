/*!
 * chain.js - blockchain management for bcoin
 * Copyright (c) 2014-2015, Fedor Indutny (MIT License)
 * Copyright (c) 2014-2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

var _typeof2 = require('babel-runtime/helpers/typeof');

var _typeof3 = _interopRequireDefault(_typeof2);

var _keys = require('babel-runtime/core-js/object/keys');

var _keys2 = _interopRequireDefault(_keys);

var _regenerator = require('babel-runtime/regenerator');

var _regenerator2 = _interopRequireDefault(_regenerator);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var assert = require('assert');
var AsyncObject = require('../utils/asyncobject');
var Network = require('../protocol/network');
var Logger = require('../node/logger');
var ChainDB = require('./chaindb');
var common = require('./common');
var consensus = require('../protocol/consensus');
var util = require('../utils/util');
var Lock = require('../utils/lock');
var LRU = require('../utils/lru');
var ChainEntry = require('./chainentry');
var CoinView = require('../coins/coinview');
var Script = require('../script/script');
var errors = require('../protocol/errors');
var co = require('../utils/co');
var VerifyError = errors.VerifyError;
var VerifyResult = errors.VerifyResult;

/**
 * Represents a blockchain.
 * @alias module:blockchain.Chain
 * @constructor
 * @param {Object} options
 * @param {String?} options.name - Database name.
 * @param {String?} options.location - Database file location.
 * @param {String?} options.db - Database backend (`"leveldb"` by default).
 * @param {Number?} options.maxOrphans
 * @param {Boolean?} options.spv
 * @property {Boolean} loaded
 * @property {ChainDB} db - Note that Chain `options` will be passed
 * to the instantiated ChainDB.
 * @property {Lock} locker
 * @property {Object} invalid
 * @property {ChainEntry?} tip
 * @property {Number} height
 * @property {DeploymentState} state
 * @property {Object} orphan - Orphan map.
 * @emits Chain#open
 * @emits Chain#error
 * @emits Chain#block
 * @emits Chain#competitor
 * @emits Chain#resolved
 * @emits Chain#checkpoint
 * @emits Chain#fork
 * @emits Chain#reorganize
 * @emits Chain#invalid
 * @emits Chain#exists
 * @emits Chain#purge
 * @emits Chain#connect
 * @emits Chain#reconnect
 * @emits Chain#disconnect
 */

function Chain(options) {
  if (!(this instanceof Chain)) return new Chain(options);

  AsyncObject.call(this);

  this.options = new ChainOptions(options);

  this.network = this.options.network;
  this.logger = this.options.logger.context('chain');
  this.checkpoints = this.options.checkpoints;

  this.locker = new Lock(true);
  this.invalid = new LRU(100);
  this.state = new DeploymentState();

  this.tip = null;
  this.height = -1;
  this.synced = false;

  this.orphanMap = {};
  this.orphanPrev = {};
  this.orphanCount = 0;

  this.db = new ChainDB(this);
}

util.inherits(Chain, AsyncObject);

/**
 * Open the chain, wait for the database to load.
 * @method
 * @alias Chain#open
 * @returns {Promise}
 */

Chain.prototype._open = co( /*#__PURE__*/_regenerator2.default.mark(function open() {
  var tip, state;
  return _regenerator2.default.wrap(function open$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:

          this.logger.info('Chain is loading.');

          if (this.options.checkpoints) this.logger.info('Checkpoints are enabled.');

          if (this.options.coinCache) this.logger.info('Coin cache is enabled.');

          _context.next = 5;
          return this.db.open();

        case 5:
          _context.next = 7;
          return this.db.getTip();

        case 7:
          tip = _context.sent;


          assert(tip);

          this.tip = tip;
          this.height = tip.height;

          this.logger.info('Chain Height: %d', tip.height);

          this.logger.memory();

          _context.next = 15;
          return this.getDeploymentState();

        case 15:
          state = _context.sent;


          this.setDeploymentState(state);

          this.logger.memory();

          this.emit('tip', tip);

          this.maybeSync();

        case 20:
        case 'end':
          return _context.stop();
      }
    }
  }, open, this);
}));

/**
 * Close the chain, wait for the database to close.
 * @alias Chain#close
 * @returns {Promise}
 */

Chain.prototype._close = function close() {
  return this.db.close();
};

/**
 * Perform all necessary contextual verification on a block.
 * @method
 * @private
 * @param {Block} block
 * @param {ChainEntry} prev
 * @param {Number} flags
 * @returns {Promise} - Returns {@link ContextResult}.
 */

Chain.prototype.verifyContext = co( /*#__PURE__*/_regenerator2.default.mark(function verifyContext(block, prev, flags) {
  var state, view;
  return _regenerator2.default.wrap(function verifyContext$(_context2) {
    while (1) {
      switch (_context2.prev = _context2.next) {
        case 0:
          _context2.next = 2;
          return this.verify(block, prev, flags);

        case 2:
          state = _context2.sent;
          _context2.next = 5;
          return this.verifyDuplicates(block, prev, state);

        case 5:
          _context2.next = 7;
          return this.verifyInputs(block, prev, state);

        case 7:
          view = _context2.sent;
          return _context2.abrupt('return', new ContextResult(view, state));

        case 9:
        case 'end':
          return _context2.stop();
      }
    }
  }, verifyContext, this);
}));

/**
 * Perform all necessary contextual verification
 * on a block, without POW check.
 * @method
 * @param {Block} block
 * @returns {Promise}
 */

Chain.prototype.verifyBlock = co( /*#__PURE__*/_regenerator2.default.mark(function verifyBlock(block) {
  var unlock;
  return _regenerator2.default.wrap(function verifyBlock$(_context3) {
    while (1) {
      switch (_context3.prev = _context3.next) {
        case 0:
          _context3.next = 2;
          return this.locker.lock();

        case 2:
          unlock = _context3.sent;
          _context3.prev = 3;
          _context3.next = 6;
          return this._verifyBlock(block);

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
  }, verifyBlock, this, [[3,, 7, 10]]);
}));

/**
 * Perform all necessary contextual verification
 * on a block, without POW check (no lock).
 * @method
 * @private
 * @param {Block} block
 * @returns {Promise}
 */

Chain.prototype._verifyBlock = co( /*#__PURE__*/_regenerator2.default.mark(function verifyBlock(block) {
  var flags;
  return _regenerator2.default.wrap(function verifyBlock$(_context4) {
    while (1) {
      switch (_context4.prev = _context4.next) {
        case 0:
          flags = common.flags.DEFAULT_FLAGS & ~common.flags.VERIFY_POW;
          _context4.next = 3;
          return this.verifyContext(block, this.tip, flags);

        case 3:
          return _context4.abrupt('return', _context4.sent);

        case 4:
        case 'end':
          return _context4.stop();
      }
    }
  }, verifyBlock, this);
}));

/**
 * Test whether a block is the genesis block.
 * @param {Block} block
 * @returns {Boolean}
 */

Chain.prototype.isGenesis = function isGenesis(block) {
  return block.hash('hex') === this.network.genesis.hash;
};

/**
 * Contextual verification for a block, including
 * version deployments (IsSuperMajority), versionbits,
 * coinbase height, finality checks.
 * @method
 * @private
 * @param {Block} block
 * @param {ChainEntry} prev
 * @param {Number} flags
 * @returns {Promise} - Returns {@link DeploymentState}.
 */

Chain.prototype.verify = co( /*#__PURE__*/_regenerator2.default.mark(function verify(block, prev, flags) {
  var hash, ret, now, height, i, ts, tx, mtp, commit, state, bits;
  return _regenerator2.default.wrap(function verify$(_context5) {
    while (1) {
      switch (_context5.prev = _context5.next) {
        case 0:
          hash = block.hash('hex');
          ret = new VerifyResult();
          now = this.network.now();
          height = prev.height + 1;


          assert(typeof flags === 'number');

          // Extra sanity check.

          if (!(block.prevBlock !== prev.hash)) {
            _context5.next = 7;
            break;
          }

          throw new VerifyError(block, 'invalid', 'bad-prevblk', 0);

        case 7:
          if (this.verifyCheckpoint(prev, hash)) {
            _context5.next = 9;
            break;
          }

          throw new VerifyError(block, 'checkpoint', 'checkpoint mismatch', 100);

        case 9:
          if (!prev.isHistorical()) {
            _context5.next = 15;
            break;
          }

          if (!this.options.spv) {
            _context5.next = 12;
            break;
          }

          return _context5.abrupt('return', new DeploymentState());

        case 12:
          if (!(!block.hasWitness() && !block.getCommitmentHash())) {
            _context5.next = 14;
            break;
          }

          return _context5.abrupt('return', new DeploymentState());

        case 14:

          flags &= ~common.flags.VERIFY_BODY;

        case 15:
          if (!(flags & common.flags.VERIFY_BODY)) {
            _context5.next = 18;
            break;
          }

          if (block.verifyBody(ret)) {
            _context5.next = 18;
            break;
          }

          throw new VerifyError(block, 'invalid', ret.reason, ret.score, true);

        case 18:
          if (!this.options.spv) {
            _context5.next = 20;
            break;
          }

          return _context5.abrupt('return', this.state);

        case 20:
          _context5.next = 22;
          return this.getTarget(block.ts, prev);

        case 22:
          bits = _context5.sent;

          if (!(block.bits !== bits)) {
            _context5.next = 25;
            break;
          }

          throw new VerifyError(block, 'invalid', 'bad-diffbits', 100);

        case 25:
          _context5.next = 27;
          return prev.getMedianTime();

        case 27:
          mtp = _context5.sent;

          if (!(block.ts <= mtp)) {
            _context5.next = 30;
            break;
          }

          throw new VerifyError(block, 'invalid', 'time-too-old', 0);

        case 30:
          if (!(block.ts > now + 2 * 60 * 60)) {
            _context5.next = 32;
            break;
          }

          throw new VerifyError(block, 'invalid', 'time-too-new', 0, true);

        case 32:
          if (!(block.version < 2 && height >= this.network.block.bip34height)) {
            _context5.next = 34;
            break;
          }

          throw new VerifyError(block, 'obsolete', 'bad-version', 0);

        case 34:
          if (!(block.version < 3 && height >= this.network.block.bip66height)) {
            _context5.next = 36;
            break;
          }

          throw new VerifyError(block, 'obsolete', 'bad-version', 0);

        case 36:
          if (!(block.version < 4 && height >= this.network.block.bip65height)) {
            _context5.next = 38;
            break;
          }

          throw new VerifyError(block, 'obsolete', 'bad-version', 0);

        case 38:
          _context5.next = 40;
          return this.getDeployments(block.ts, prev);

        case 40:
          state = _context5.sent;


          // Get timestamp for tx.isFinal().
          ts = state.hasMTP() ? mtp : block.ts;

          // Transactions must be finalized with
          // regards to nSequence and nLockTime.
          i = 0;

        case 43:
          if (!(i < block.txs.length)) {
            _context5.next = 50;
            break;
          }

          tx = block.txs[i];

          if (tx.isFinal(height, ts)) {
            _context5.next = 47;
            break;
          }

          throw new VerifyError(block, 'invalid', 'bad-txns-nonfinal', 10);

        case 47:
          i++;
          _context5.next = 43;
          break;

        case 50:
          if (!state.hasBIP34()) {
            _context5.next = 53;
            break;
          }

          if (!(block.getCoinbaseHeight() !== height)) {
            _context5.next = 53;
            break;
          }

          throw new VerifyError(block, 'invalid', 'bad-cb-height', 100);

        case 53:
          if (!state.hasWitness()) {
            _context5.next = 60;
            break;
          }

          commit = block.getCommitmentHash();

          if (!commit) {
            _context5.next = 60;
            break;
          }

          if (block.getWitnessNonce()) {
            _context5.next = 58;
            break;
          }

          throw new VerifyError(block, 'invalid', 'bad-witness-nonce-size', 100, true);

        case 58:
          if (commit.equals(block.createCommitmentHash())) {
            _context5.next = 60;
            break;
          }

          throw new VerifyError(block, 'invalid', 'bad-witness-merkle-match', 100, true);

        case 60:
          if (commit) {
            _context5.next = 63;
            break;
          }

          if (!block.hasWitness()) {
            _context5.next = 63;
            break;
          }

          throw new VerifyError(block, 'invalid', 'unexpected-witness', 100, true);

        case 63:
          if (!(block.getWeight() > consensus.MAX_BLOCK_WEIGHT)) {
            _context5.next = 65;
            break;
          }

          throw new VerifyError(block, 'invalid', 'bad-blk-weight', 100);

        case 65:
          return _context5.abrupt('return', state);

        case 66:
        case 'end':
          return _context5.stop();
      }
    }
  }, verify, this);
}));

/**
 * Check all deployments on a chain, ranging from p2sh to segwit.
 * @method
 * @param {Number} ts
 * @param {ChainEntry} prev
 * @returns {Promise} - Returns [{@link VerifyError}, {@link DeploymentState}].
 */

Chain.prototype.getDeployments = co( /*#__PURE__*/_regenerator2.default.mark(function getDeployments(ts, prev) {
  var deployments, height, state, active;
  return _regenerator2.default.wrap(function getDeployments$(_context6) {
    while (1) {
      switch (_context6.prev = _context6.next) {
        case 0:
          deployments = this.network.deployments;
          height = prev.height + 1;
          state = new DeploymentState();


          // For some reason bitcoind has p2sh in the
          // mandatory flags by default, when in reality
          // it wasn't activated until march 30th 2012.
          // The first p2sh output and redeem script
          // appeared on march 7th 2012, only it did
          // not have a signature. See:
          // 6a26d2ecb67f27d1fa5524763b49029d7106e91e3cc05743073461a719776192
          // 9c08a4d78931342b37fd5f72900fb9983087e6f46c4a097d8a1f52c74e28eaf6
          if (ts >= consensus.BIP16_TIME) state.flags |= Script.flags.VERIFY_P2SH;

          // Coinbase heights are now enforced (bip34).
          if (height >= this.network.block.bip34height) state.bip34 = true;

          // Signature validation is now enforced (bip66).
          if (height >= this.network.block.bip66height) state.flags |= Script.flags.VERIFY_DERSIG;

          // CHECKLOCKTIMEVERIFY is now usable (bip65)
          if (height >= this.network.block.bip65height) state.flags |= Script.flags.VERIFY_CHECKLOCKTIMEVERIFY;

          // CHECKSEQUENCEVERIFY and median time
          // past locktimes are now usable (bip9 & bip113).
          _context6.next = 9;
          return this.isActive(prev, deployments.csv);

        case 9:
          active = _context6.sent;

          if (active) {
            state.flags |= Script.flags.VERIFY_CHECKSEQUENCEVERIFY;
            state.lockFlags |= common.lockFlags.VERIFY_SEQUENCE;
            state.lockFlags |= common.lockFlags.MEDIAN_TIME_PAST;
          }

          // Segregrated witness is now usable (bip141 - segnet4)
          _context6.next = 13;
          return this.isActive(prev, deployments.segwit);

        case 13:
          active = _context6.sent;

          if (active) {
            state.flags |= Script.flags.VERIFY_WITNESS;
            // BIP147
            state.flags |= Script.flags.VERIFY_NULLDUMMY;
          }

          return _context6.abrupt('return', state);

        case 16:
        case 'end':
          return _context6.stop();
      }
    }
  }, getDeployments, this);
}));

/**
 * Set a new deployment state.
 * @param {DeploymentState} state
 */

Chain.prototype.setDeploymentState = function setDeploymentState(state) {
  if (!this.state.hasP2SH() && state.hasP2SH()) this.logger.warning('P2SH has been activated.');

  if (!this.state.hasBIP34() && state.hasBIP34()) this.logger.warning('BIP34 has been activated.');

  if (!this.state.hasBIP66() && state.hasBIP66()) this.logger.warning('BIP66 has been activated.');

  if (!this.state.hasCLTV() && state.hasCLTV()) this.logger.warning('BIP65 has been activated.');

  if (!this.state.hasCSV() && state.hasCSV()) this.logger.warning('CSV has been activated.');

  if (!this.state.hasWitness() && state.hasWitness()) this.logger.warning('Segwit has been activated.');

  this.state = state;
};

/**
 * Determine whether to check block for duplicate txids in blockchain
 * history (BIP30). If we're on a chain that has bip34 activated, we
 * can skip this.
 * @method
 * @private
 * @see https://github.com/bitcoin/bips/blob/master/bip-0030.mediawiki
 * @param {Block} block
 * @param {ChainEntry} prev
 * @returns {Promise}
 */

Chain.prototype.verifyDuplicates = co( /*#__PURE__*/_regenerator2.default.mark(function verifyDuplicates(block, prev, state) {
  var height, i, tx, result;
  return _regenerator2.default.wrap(function verifyDuplicates$(_context7) {
    while (1) {
      switch (_context7.prev = _context7.next) {
        case 0:
          height = prev.height + 1;

          if (!this.options.spv) {
            _context7.next = 3;
            break;
          }

          return _context7.abrupt('return');

        case 3:
          if (!prev.isHistorical()) {
            _context7.next = 5;
            break;
          }

          return _context7.abrupt('return');

        case 5:
          if (!state.hasBIP34()) {
            _context7.next = 7;
            break;
          }

          return _context7.abrupt('return');

        case 7:
          i = 0;

        case 8:
          if (!(i < block.txs.length)) {
            _context7.next = 21;
            break;
          }

          tx = block.txs[i];
          _context7.next = 12;
          return this.db.hasCoins(tx.hash());

        case 12:
          result = _context7.sent;

          if (!result) {
            _context7.next = 18;
            break;
          }

          if (!this.network.bip30[height]) {
            _context7.next = 17;
            break;
          }

          if (!(block.hash('hex') === this.network.bip30[height])) {
            _context7.next = 17;
            break;
          }

          return _context7.abrupt('continue', 18);

        case 17:
          throw new VerifyError(block, 'invalid', 'bad-txns-BIP30', 100);

        case 18:
          i++;
          _context7.next = 8;
          break;

        case 21:
        case 'end':
          return _context7.stop();
      }
    }
  }, verifyDuplicates, this);
}));

/**
 * Check block transactions for all things pertaining
 * to inputs. This function is important because it is
 * what actually fills the coins into the block. This
 * function will check the block reward, the sigops,
 * the tx values, and execute and verify the scripts (it
 * will attempt to do this on the worker pool). If
 * `checkpoints` is enabled, it will skip verification
 * for historical data.
 * @method
 * @private
 * @see TX#checkInputs
 * @param {Block} block
 * @param {ChainEntry} prev
 * @param {DeploymentState} state
 * @returns {Promise} - Returns {@link CoinView}.
 */

Chain.prototype.verifyInputs = co( /*#__PURE__*/_regenerator2.default.mark(function verifyInputs(block, prev, state) {
  var interval, ret, view, height, historical, sigops, reward, jobs, i, tx, valid, fee;
  return _regenerator2.default.wrap(function verifyInputs$(_context8) {
    while (1) {
      switch (_context8.prev = _context8.next) {
        case 0:
          interval = this.network.halvingInterval;
          ret = new VerifyResult();
          view = new CoinView();
          height = prev.height + 1;
          historical = prev.isHistorical();
          sigops = 0;
          reward = 0;
          jobs = [];

          if (!this.options.spv) {
            _context8.next = 10;
            break;
          }

          return _context8.abrupt('return', view);

        case 10:
          i = 0;

        case 11:
          if (!(i < block.txs.length)) {
            _context8.next = 43;
            break;
          }

          tx = block.txs[i];

          // Ensure tx is not double spending an output.

          if (!(i > 0)) {
            _context8.next = 19;
            break;
          }

          _context8.next = 16;
          return view.spendInputs(this.db, tx);

        case 16:
          if (_context8.sent) {
            _context8.next = 19;
            break;
          }

          assert(!historical, 'BUG: Spent inputs in historical data!');
          throw new VerifyError(block, 'invalid', 'bad-txns-inputs-missingorspent', 100);

        case 19:
          if (!historical) {
            _context8.next = 22;
            break;
          }

          view.addTX(tx, height);
          return _context8.abrupt('continue', 40);

        case 22:
          if (!(i > 0 && tx.version >= 2)) {
            _context8.next = 28;
            break;
          }

          _context8.next = 25;
          return this.verifyLocks(prev, tx, view, state.lockFlags);

        case 25:
          valid = _context8.sent;

          if (valid) {
            _context8.next = 28;
            break;
          }

          throw new VerifyError(block, 'invalid', 'bad-txns-nonfinal', 100);

        case 28:

          // Count sigops (legacy + scripthash? + witness?)
          sigops += tx.getSigopsCost(view, state.flags);

          if (!(sigops > consensus.MAX_BLOCK_SIGOPS_COST)) {
            _context8.next = 31;
            break;
          }

          throw new VerifyError(block, 'invalid', 'bad-blk-sigops', 100);

        case 31:
          if (!(i > 0)) {
            _context8.next = 39;
            break;
          }

          fee = tx.checkContext(view, height, ret);

          if (!(fee === -1)) {
            _context8.next = 35;
            break;
          }

          throw new VerifyError(block, 'invalid', ret.reason, ret.score);

        case 35:

          reward += fee;

          if (!(reward > consensus.MAX_MONEY)) {
            _context8.next = 38;
            break;
          }

          throw new VerifyError(block, 'invalid', 'bad-cb-amount', 100);

        case 38:

          // Push onto verification queue.
          jobs.push(tx.verifyAsync(view, state.flags));

        case 39:

          // Add new coins.
          view.addTX(tx, height);

        case 40:
          i++;
          _context8.next = 11;
          break;

        case 43:
          if (!historical) {
            _context8.next = 45;
            break;
          }

          return _context8.abrupt('return', view);

        case 45:

          // Make sure the miner isn't trying to conjure more coins.
          reward += consensus.getReward(height, interval);

          if (!(block.getClaimed() > reward)) {
            _context8.next = 48;
            break;
          }

          throw new VerifyError(block, 'invalid', 'bad-cb-amount', 100);

        case 48:
          _context8.next = 50;
          return co.every(jobs);

        case 50:
          valid = _context8.sent;

          if (valid) {
            _context8.next = 53;
            break;
          }

          throw new VerifyError(block, 'invalid', 'mandatory-script-verify-flag-failed', 100);

        case 53:
          return _context8.abrupt('return', view);

        case 54:
        case 'end':
          return _context8.stop();
      }
    }
  }, verifyInputs, this);
}));

/**
 * Get the cached height for a hash if present.
 * @private
 * @param {Hash} hash
 * @returns {Number}
 */

Chain.prototype.checkHeight = function checkHeight(hash) {
  var entry = this.db.getCache(hash);

  if (!entry) return -1;

  return entry.height;
};

/**
 * Find the block at which a fork ocurred.
 * @private
 * @method
 * @param {ChainEntry} fork - The current chain.
 * @param {ChainEntry} longer - The competing chain.
 * @returns {Promise}
 */

Chain.prototype.findFork = co( /*#__PURE__*/_regenerator2.default.mark(function findFork(fork, longer) {
  return _regenerator2.default.wrap(function findFork$(_context9) {
    while (1) {
      switch (_context9.prev = _context9.next) {
        case 0:
          if (!(fork.hash !== longer.hash)) {
            _context9.next = 18;
            break;
          }

        case 1:
          if (!(longer.height > fork.height)) {
            _context9.next = 9;
            break;
          }

          _context9.next = 4;
          return longer.getPrevious();

        case 4:
          longer = _context9.sent;

          if (longer) {
            _context9.next = 7;
            break;
          }

          throw new Error('No previous entry for new tip.');

        case 7:
          _context9.next = 1;
          break;

        case 9:
          if (!(fork.hash === longer.hash)) {
            _context9.next = 11;
            break;
          }

          return _context9.abrupt('return', fork);

        case 11:
          _context9.next = 13;
          return fork.getPrevious();

        case 13:
          fork = _context9.sent;

          if (fork) {
            _context9.next = 16;
            break;
          }

          throw new Error('No previous entry for old tip.');

        case 16:
          _context9.next = 0;
          break;

        case 18:
          return _context9.abrupt('return', fork);

        case 19:
        case 'end':
          return _context9.stop();
      }
    }
  }, findFork, this);
}));

/**
 * Reorganize the blockchain (connect and disconnect inputs).
 * Called when a competing chain with a higher chainwork
 * is received.
 * @method
 * @private
 * @param {ChainEntry} competitor - The competing chain's tip.
 * @param {Block} block - The being being added.
 * @returns {Promise}
 */

Chain.prototype.reorganize = co( /*#__PURE__*/_regenerator2.default.mark(function reorganize(competitor, block) {
  var tip, fork, disconnect, connect, i, entry;
  return _regenerator2.default.wrap(function reorganize$(_context10) {
    while (1) {
      switch (_context10.prev = _context10.next) {
        case 0:
          tip = this.tip;
          _context10.next = 3;
          return this.findFork(tip, competitor);

        case 3:
          fork = _context10.sent;
          disconnect = [];
          connect = [];


          assert(fork, 'No free space or data corruption.');

          // Blocks to disconnect.
          entry = tip;

        case 8:
          if (!(entry.hash !== fork.hash)) {
            _context10.next = 16;
            break;
          }

          disconnect.push(entry);
          _context10.next = 12;
          return entry.getPrevious();

        case 12:
          entry = _context10.sent;

          assert(entry);
          _context10.next = 8;
          break;

        case 16:

          // Blocks to connect.
          entry = competitor;

        case 17:
          if (!(entry.hash !== fork.hash)) {
            _context10.next = 25;
            break;
          }

          connect.push(entry);
          _context10.next = 21;
          return entry.getPrevious();

        case 21:
          entry = _context10.sent;

          assert(entry);
          _context10.next = 17;
          break;

        case 25:
          i = 0;

        case 26:
          if (!(i < disconnect.length)) {
            _context10.next = 33;
            break;
          }

          entry = disconnect[i];
          _context10.next = 30;
          return this.disconnect(entry);

        case 30:
          i++;
          _context10.next = 26;
          break;

        case 33:
          i = connect.length - 1;

        case 34:
          if (!(i >= 1)) {
            _context10.next = 41;
            break;
          }

          entry = connect[i];
          _context10.next = 38;
          return this.reconnect(entry);

        case 38:
          i--;
          _context10.next = 34;
          break;

        case 41:

          this.logger.warning('Chain reorganization: old=%s(%d) new=%s(%d)', tip.rhash(), tip.height, competitor.rhash(), competitor.height);

          this.emit('reorganize', tip, competitor);

        case 43:
        case 'end':
          return _context10.stop();
      }
    }
  }, reorganize, this);
}));

/**
 * Reorganize the blockchain for SPV. This
 * will reset the chain to the fork block.
 * @method
 * @private
 * @param {ChainEntry} competitor - The competing chain's tip.
 * @param {Block} block - The being being added.
 * @returns {Promise}
 */

Chain.prototype.reorganizeSPV = co( /*#__PURE__*/_regenerator2.default.mark(function reorganizeSPV(competitor, block) {
  var tip, fork, disconnect, entry, i, headers, view;
  return _regenerator2.default.wrap(function reorganizeSPV$(_context11) {
    while (1) {
      switch (_context11.prev = _context11.next) {
        case 0:
          tip = this.tip;
          _context11.next = 3;
          return this.findFork(tip, competitor);

        case 3:
          fork = _context11.sent;
          disconnect = [];
          entry = tip;


          assert(fork, 'No free space or data corruption.');

          // Buffer disconnected blocks.

        case 7:
          if (!(entry.hash !== fork.hash)) {
            _context11.next = 15;
            break;
          }

          disconnect.push(entry);
          _context11.next = 11;
          return entry.getPrevious();

        case 11:
          entry = _context11.sent;

          assert(entry);
          _context11.next = 7;
          break;

        case 15:
          _context11.next = 17;
          return this._reset(fork.hash, true);

        case 17:
          i = 0;

        case 18:
          if (!(i < disconnect.length)) {
            _context11.next = 27;
            break;
          }

          entry = disconnect[i];
          headers = entry.toHeaders();
          view = new CoinView();
          _context11.next = 24;
          return this.fire('disconnect', entry, headers, view);

        case 24:
          i++;
          _context11.next = 18;
          break;

        case 27:

          this.logger.warning('SPV reorganization: old=%s(%d) new=%s(%d)', tip.rhash(), tip.height, competitor.rhash(), competitor.height);

          this.logger.warning('Chain replay from height %d necessary.', fork.height);

          this.emit('reorganize', tip, competitor);

        case 30:
        case 'end':
          return _context11.stop();
      }
    }
  }, reorganizeSPV, this);
}));

/**
 * Disconnect an entry from the chain (updates the tip).
 * @method
 * @param {ChainEntry} entry
 * @returns {Promise}
 */

Chain.prototype.disconnect = co( /*#__PURE__*/_regenerator2.default.mark(function disconnect(entry) {
  var block, prev, view;
  return _regenerator2.default.wrap(function disconnect$(_context12) {
    while (1) {
      switch (_context12.prev = _context12.next) {
        case 0:
          _context12.next = 2;
          return this.db.getBlock(entry.hash);

        case 2:
          block = _context12.sent;

          if (block) {
            _context12.next = 7;
            break;
          }

          if (this.options.spv) {
            _context12.next = 6;
            break;
          }

          throw new Error('Block not found.');

        case 6:
          block = entry.toHeaders();

        case 7:
          _context12.next = 9;
          return entry.getPrevious();

        case 9:
          prev = _context12.sent;
          _context12.next = 12;
          return this.db.disconnect(entry, block);

        case 12:
          view = _context12.sent;


          assert(prev);

          this.tip = prev;
          this.height = prev.height;

          this.emit('tip', prev);

          _context12.next = 19;
          return this.fire('disconnect', entry, block, view);

        case 19:
        case 'end':
          return _context12.stop();
      }
    }
  }, disconnect, this);
}));

/**
 * Reconnect an entry to the chain (updates the tip).
 * This will do contextual-verification on the block
 * (necessary because we cannot validate the inputs
 * in alternate chains when they come in).
 * @method
 * @param {ChainEntry} entry
 * @param {Number} flags
 * @returns {Promise}
 */

Chain.prototype.reconnect = co( /*#__PURE__*/_regenerator2.default.mark(function reconnect(entry) {
  var block, flags, prev, result;
  return _regenerator2.default.wrap(function reconnect$(_context13) {
    while (1) {
      switch (_context13.prev = _context13.next) {
        case 0:
          _context13.next = 2;
          return this.db.getBlock(entry.hash);

        case 2:
          block = _context13.sent;
          flags = common.flags.VERIFY_NONE;

          if (block) {
            _context13.next = 8;
            break;
          }

          if (this.options.spv) {
            _context13.next = 7;
            break;
          }

          throw new Error('Block not found.');

        case 7:
          block = entry.toHeaders();

        case 8:
          _context13.next = 10;
          return entry.getPrevious();

        case 10:
          prev = _context13.sent;

          assert(prev);

          _context13.prev = 12;
          _context13.next = 15;
          return this.verifyContext(block, prev, flags);

        case 15:
          result = _context13.sent;
          _context13.next = 22;
          break;

        case 18:
          _context13.prev = 18;
          _context13.t0 = _context13['catch'](12);

          if (_context13.t0.type === 'VerifyError') {
            if (!_context13.t0.malleated) this.setInvalid(entry.hash);
            this.logger.warning('Tried to reconnect invalid block: %s (%d).', entry.rhash(), entry.height);
          }
          throw _context13.t0;

        case 22:
          _context13.next = 24;
          return this.db.reconnect(entry, block, result.view);

        case 24:

          this.tip = entry;
          this.height = entry.height;
          this.setDeploymentState(result.state);

          this.emit('tip', entry);
          this.emit('reconnect', entry, block);

          _context13.next = 31;
          return this.fire('connect', entry, block, result.view);

        case 31:
        case 'end':
          return _context13.stop();
      }
    }
  }, reconnect, this, [[12, 18]]);
}));

/**
 * Set the best chain. This is called on every valid block
 * that comes in. It may add and connect the block (main chain),
 * save the block without connection (alternate chain), or
 * reorganize the chain (a higher fork).
 * @method
 * @private
 * @param {ChainEntry} entry
 * @param {Block} block
 * @param {ChainEntry} prev
 * @param {Number} flags
 * @returns {Promise}
 */

Chain.prototype.setBestChain = co( /*#__PURE__*/_regenerator2.default.mark(function setBestChain(entry, block, prev, flags) {
  var result;
  return _regenerator2.default.wrap(function setBestChain$(_context14) {
    while (1) {
      switch (_context14.prev = _context14.next) {
        case 0:
          if (!(entry.prevBlock !== this.tip.hash)) {
            _context14.next = 8;
            break;
          }

          this.logger.warning('WARNING: Reorganizing chain.');

          // In spv-mode, we reset the
          // chain and redownload the blocks.

          if (!this.options.spv) {
            _context14.next = 6;
            break;
          }

          _context14.next = 5;
          return this.reorganizeSPV(entry, block);

        case 5:
          return _context14.abrupt('return', _context14.sent);

        case 6:
          _context14.next = 8;
          return this.reorganize(entry, block);

        case 8:

          // Warn of unknown versionbits.
          if (entry.hasUnknown()) {
            this.logger.warning('Unknown version bits in block %d: %d.', entry.height, entry.version);
          }

          // Otherwise, everything is in order.
          // Do "contextual" verification on our block
          // now that we're certain its previous
          // block is in the chain.
          _context14.prev = 9;
          _context14.next = 12;
          return this.verifyContext(block, prev, flags);

        case 12:
          result = _context14.sent;
          _context14.next = 19;
          break;

        case 15:
          _context14.prev = 15;
          _context14.t0 = _context14['catch'](9);

          if (_context14.t0.type === 'VerifyError') {
            if (!_context14.t0.malleated) this.setInvalid(entry.hash);
            this.logger.warning('Tried to connect invalid block: %s (%d).', entry.rhash(), entry.height);
          }
          throw _context14.t0;

        case 19:
          _context14.next = 21;
          return this.db.save(entry, block, result.view);

        case 21:

          // Expose the new state.
          this.tip = entry;
          this.height = entry.height;
          this.setDeploymentState(result.state);

          this.emit('tip', entry);
          this.emit('block', block, entry);

          _context14.next = 28;
          return this.fire('connect', entry, block, result.view);

        case 28:
        case 'end':
          return _context14.stop();
      }
    }
  }, setBestChain, this, [[9, 15]]);
}));

/**
 * Save block on an alternate chain.
 * @method
 * @private
 * @param {ChainEntry} entry
 * @param {Block} block
 * @param {ChainEntry} prev
 * @param {Number} flags
 * @returns {Promise}
 */

Chain.prototype.saveAlternate = co( /*#__PURE__*/_regenerator2.default.mark(function saveAlternate(entry, block, prev, flags) {
  return _regenerator2.default.wrap(function saveAlternate$(_context15) {
    while (1) {
      switch (_context15.prev = _context15.next) {
        case 0:
          _context15.prev = 0;
          _context15.next = 3;
          return this.verify(block, prev, flags);

        case 3:
          _context15.next = 9;
          break;

        case 5:
          _context15.prev = 5;
          _context15.t0 = _context15['catch'](0);

          if (_context15.t0.type === 'VerifyError') {
            if (!_context15.t0.malleated) this.setInvalid(entry.hash);
            this.logger.warning('Invalid block on alternate chain: %s (%d).', entry.rhash(), entry.height);
          }
          throw _context15.t0;

        case 9:

          // Warn of unknown versionbits.
          if (entry.hasUnknown()) {
            this.logger.warning('Unknown version bits in block %d: %d.', entry.height, entry.version);
          }

          _context15.next = 12;
          return this.db.save(entry, block);

        case 12:

          this.logger.warning('Heads up: Competing chain at height %d:' + ' tip-height=%d competitor-height=%d' + ' tip-hash=%s competitor-hash=%s' + ' tip-chainwork=%s competitor-chainwork=%s' + ' chainwork-diff=%s', entry.height, this.tip.height, entry.height, this.tip.rhash(), entry.rhash(), this.tip.chainwork.toString(), entry.chainwork.toString(), this.tip.chainwork.sub(entry.chainwork).toString());

          // Emit as a "competitor" block.
          this.emit('competitor', block, entry);

        case 14:
        case 'end':
          return _context15.stop();
      }
    }
  }, saveAlternate, this, [[0, 5]]);
}));

/**
 * Reset the chain to the desired block. This
 * is useful for replaying the blockchain download
 * for SPV.
 * @method
 * @param {Hash|Number} block
 * @returns {Promise}
 */

Chain.prototype.reset = co( /*#__PURE__*/_regenerator2.default.mark(function reset(block) {
  var unlock;
  return _regenerator2.default.wrap(function reset$(_context16) {
    while (1) {
      switch (_context16.prev = _context16.next) {
        case 0:
          _context16.next = 2;
          return this.locker.lock();

        case 2:
          unlock = _context16.sent;
          _context16.prev = 3;
          _context16.next = 6;
          return this._reset(block, false);

        case 6:
          return _context16.abrupt('return', _context16.sent);

        case 7:
          _context16.prev = 7;

          unlock();
          return _context16.finish(7);

        case 10:
        case 'end':
          return _context16.stop();
      }
    }
  }, reset, this, [[3,, 7, 10]]);
}));

/**
 * Reset the chain to the desired block without a lock.
 * @method
 * @private
 * @param {Hash|Number} block
 * @returns {Promise}
 */

Chain.prototype._reset = co( /*#__PURE__*/_regenerator2.default.mark(function reset(block, silent) {
  var tip, state;
  return _regenerator2.default.wrap(function reset$(_context17) {
    while (1) {
      switch (_context17.prev = _context17.next) {
        case 0:
          _context17.next = 2;
          return this.db.reset(block);

        case 2:
          tip = _context17.sent;


          // Reset state.
          this.tip = tip;
          this.height = tip.height;
          this.synced = false;

          _context17.next = 8;
          return this.getDeploymentState();

        case 8:
          state = _context17.sent;


          this.setDeploymentState(state);

          this.emit('tip', tip);

          if (silent) {
            _context17.next = 14;
            break;
          }

          _context17.next = 14;
          return this.fire('reset', tip);

        case 14:

          // Reset the orphan map completely. There may
          // have been some orphans on a forked chain we
          // no longer need.
          this.purgeOrphans();

          this.maybeSync();

        case 16:
        case 'end':
          return _context17.stop();
      }
    }
  }, reset, this);
}));

/**
 * Reset the chain to a height or hash. Useful for replaying
 * the blockchain download for SPV.
 * @method
 * @param {Hash|Number} block - hash/height
 * @returns {Promise}
 */

Chain.prototype.replay = co( /*#__PURE__*/_regenerator2.default.mark(function replay(block) {
  var unlock;
  return _regenerator2.default.wrap(function replay$(_context18) {
    while (1) {
      switch (_context18.prev = _context18.next) {
        case 0:
          _context18.next = 2;
          return this.locker.lock();

        case 2:
          unlock = _context18.sent;
          _context18.prev = 3;
          _context18.next = 6;
          return this._replay(block, true);

        case 6:
          return _context18.abrupt('return', _context18.sent);

        case 7:
          _context18.prev = 7;

          unlock();
          return _context18.finish(7);

        case 10:
        case 'end':
          return _context18.stop();
      }
    }
  }, replay, this, [[3,, 7, 10]]);
}));

/**
 * Reset the chain without a lock.
 * @method
 * @private
 * @param {Hash|Number} block - hash/height
 * @param {Boolean?} silent
 * @returns {Promise}
 */

Chain.prototype._replay = co( /*#__PURE__*/_regenerator2.default.mark(function replay(block, silent) {
  var entry;
  return _regenerator2.default.wrap(function replay$(_context19) {
    while (1) {
      switch (_context19.prev = _context19.next) {
        case 0:
          _context19.next = 2;
          return this.db.getEntry(block);

        case 2:
          entry = _context19.sent;

          if (entry) {
            _context19.next = 5;
            break;
          }

          throw new Error('Block not found.');

        case 5:
          _context19.next = 7;
          return entry.isMainChain();

        case 7:
          if (_context19.sent) {
            _context19.next = 9;
            break;
          }

          throw new Error('Cannot reset on alternate chain.');

        case 9:
          if (!entry.isGenesis()) {
            _context19.next = 13;
            break;
          }

          _context19.next = 12;
          return this._reset(entry.hash, silent);

        case 12:
          return _context19.abrupt('return', _context19.sent);

        case 13:
          _context19.next = 15;
          return this._reset(entry.prevBlock, silent);

        case 15:
        case 'end':
          return _context19.stop();
      }
    }
  }, replay, this);
}));

/**
 * Invalidate block.
 * @method
 * @param {Hash} hash
 * @returns {Promise}
 */

Chain.prototype.invalidate = co( /*#__PURE__*/_regenerator2.default.mark(function invalidate(hash) {
  var unlock;
  return _regenerator2.default.wrap(function invalidate$(_context20) {
    while (1) {
      switch (_context20.prev = _context20.next) {
        case 0:
          _context20.next = 2;
          return this.locker.lock();

        case 2:
          unlock = _context20.sent;
          _context20.prev = 3;
          _context20.next = 6;
          return this._invalidate(hash);

        case 6:
          return _context20.abrupt('return', _context20.sent);

        case 7:
          _context20.prev = 7;

          unlock();
          return _context20.finish(7);

        case 10:
        case 'end':
          return _context20.stop();
      }
    }
  }, invalidate, this, [[3,, 7, 10]]);
}));

/**
 * Invalidate block (no lock).
 * @method
 * @param {Hash} hash
 * @returns {Promise}
 */

Chain.prototype._invalidate = co( /*#__PURE__*/_regenerator2.default.mark(function _invalidate(hash) {
  return _regenerator2.default.wrap(function _invalidate$(_context21) {
    while (1) {
      switch (_context21.prev = _context21.next) {
        case 0:
          _context21.next = 2;
          return this._replay(hash, false);

        case 2:
          this.chain.setInvalid(hash);

        case 3:
        case 'end':
          return _context21.stop();
      }
    }
  }, _invalidate, this);
}));

/**
 * Retroactively prune the database.
 * @method
 * @returns {Promise}
 */

Chain.prototype.prune = co( /*#__PURE__*/_regenerator2.default.mark(function prune() {
  var unlock;
  return _regenerator2.default.wrap(function prune$(_context22) {
    while (1) {
      switch (_context22.prev = _context22.next) {
        case 0:
          _context22.next = 2;
          return this.locker.lock();

        case 2:
          unlock = _context22.sent;
          _context22.prev = 3;
          _context22.next = 6;
          return this.db.prune(this.tip.hash);

        case 6:
          return _context22.abrupt('return', _context22.sent);

        case 7:
          _context22.prev = 7;

          unlock();
          return _context22.finish(7);

        case 10:
        case 'end':
          return _context22.stop();
      }
    }
  }, prune, this, [[3,, 7, 10]]);
}));

/**
 * Scan the blockchain for transactions containing specified address hashes.
 * @method
 * @param {Hash} start - Block hash to start at.
 * @param {Bloom} filter - Bloom filter containing tx and address hashes.
 * @param {Function} iter - Iterator.
 * @returns {Promise}
 */

Chain.prototype.scan = co( /*#__PURE__*/_regenerator2.default.mark(function scan(start, filter, iter) {
  var unlock;
  return _regenerator2.default.wrap(function scan$(_context23) {
    while (1) {
      switch (_context23.prev = _context23.next) {
        case 0:
          _context23.next = 2;
          return this.locker.lock();

        case 2:
          unlock = _context23.sent;
          _context23.prev = 3;
          _context23.next = 6;
          return this.db.scan(start, filter, iter);

        case 6:
          return _context23.abrupt('return', _context23.sent);

        case 7:
          _context23.prev = 7;

          unlock();
          return _context23.finish(7);

        case 10:
        case 'end':
          return _context23.stop();
      }
    }
  }, scan, this, [[3,, 7, 10]]);
}));

/**
 * Add a block to the chain, perform all necessary verification.
 * @method
 * @param {Block} block
 * @param {Number?} flags
 * @param {Number?} id
 * @returns {Promise}
 */

Chain.prototype.add = co( /*#__PURE__*/_regenerator2.default.mark(function add(block, flags, id) {
  var hash, unlock;
  return _regenerator2.default.wrap(function add$(_context24) {
    while (1) {
      switch (_context24.prev = _context24.next) {
        case 0:
          hash = block.hash('hex');
          _context24.next = 3;
          return this.locker.lock(hash);

        case 3:
          unlock = _context24.sent;
          _context24.prev = 4;
          _context24.next = 7;
          return this._add(block, flags, id);

        case 7:
          return _context24.abrupt('return', _context24.sent);

        case 8:
          _context24.prev = 8;

          unlock();
          return _context24.finish(8);

        case 11:
        case 'end':
          return _context24.stop();
      }
    }
  }, add, this, [[4,, 8, 11]]);
}));

/**
 * Add a block to the chain without a lock.
 * @method
 * @private
 * @param {Block} block
 * @param {Number?} flags
 * @param {Number?} id
 * @returns {Promise}
 */

Chain.prototype._add = co( /*#__PURE__*/_regenerator2.default.mark(function add(block, flags, id) {
  var hash, entry, prev;
  return _regenerator2.default.wrap(function add$(_context25) {
    while (1) {
      switch (_context25.prev = _context25.next) {
        case 0:
          hash = block.hash('hex');


          if (flags == null) flags = common.flags.DEFAULT_FLAGS;

          if (id == null) id = -1;

          // Special case for genesis block.

          if (!(hash === this.network.genesis.hash)) {
            _context25.next = 6;
            break;
          }

          this.logger.debug('Saw genesis block: %s.', block.rhash());
          throw new VerifyError(block, 'duplicate', 'duplicate', 0);

        case 6:
          if (!this.hasPending(hash)) {
            _context25.next = 9;
            break;
          }

          this.logger.debug('Already have pending block: %s.', block.rhash());
          throw new VerifyError(block, 'duplicate', 'duplicate', 0);

        case 9:
          if (!this.hasOrphan(hash)) {
            _context25.next = 12;
            break;
          }

          this.logger.debug('Already have orphan block: %s.', block.rhash());
          throw new VerifyError(block, 'duplicate', 'duplicate', 0);

        case 12:
          if (!this.hasInvalid(block)) {
            _context25.next = 15;
            break;
          }

          this.logger.debug('Invalid ancestors for block: %s.', block.rhash());
          throw new VerifyError(block, 'duplicate', 'duplicate', 100);

        case 15:
          if (!(flags & common.flags.VERIFY_POW)) {
            _context25.next = 18;
            break;
          }

          if (block.verifyPOW()) {
            _context25.next = 18;
            break;
          }

          throw new VerifyError(block, 'invalid', 'high-hash', 50);

        case 18:
          _context25.next = 20;
          return this.db.hasEntry(hash);

        case 20:
          if (!_context25.sent) {
            _context25.next = 23;
            break;
          }

          this.logger.debug('Already have block: %s.', block.rhash());
          throw new VerifyError(block, 'duplicate', 'duplicate', 0);

        case 23:
          _context25.next = 25;
          return this.db.getEntry(block.prevBlock);

        case 25:
          prev = _context25.sent;

          if (prev) {
            _context25.next = 29;
            break;
          }

          this.storeOrphan(block, flags, id);
          return _context25.abrupt('return', null);

        case 29:
          _context25.next = 31;
          return this.connect(prev, block, flags);

        case 31:
          entry = _context25.sent;

          if (!this.hasNextOrphan(hash)) {
            _context25.next = 35;
            break;
          }

          _context25.next = 35;
          return this.handleOrphans(entry);

        case 35:
          return _context25.abrupt('return', entry);

        case 36:
        case 'end':
          return _context25.stop();
      }
    }
  }, add, this);
}));

/**
 * Connect block to chain.
 * @method
 * @private
 * @param {ChainEntry} prev
 * @param {Block} block
 * @param {Number} flags
 * @returns {Promise}
 */

Chain.prototype.connect = co( /*#__PURE__*/_regenerator2.default.mark(function connect(prev, block, flags) {
  var start, entry;
  return _regenerator2.default.wrap(function connect$(_context26) {
    while (1) {
      switch (_context26.prev = _context26.next) {
        case 0:
          start = util.hrtime();


          // Sanity check.
          assert(block.prevBlock === prev.hash);

          // Explanation: we try to keep as much data
          // off the javascript heap as possible. Blocks
          // in the future may be 8mb or 20mb, who knows.
          // In fullnode-mode we store the blocks in
          // "compact" form (the headers plus the raw
          // Buffer object) until they're ready to be
          // fully validated here. They are deserialized,
          // validated, and connected. Hopefully the
          // deserialized blocks get cleaned up by the
          // GC quickly.

          if (!block.memory) {
            _context26.next = 11;
            break;
          }

          _context26.prev = 3;

          block = block.toBlock();
          _context26.next = 11;
          break;

        case 7:
          _context26.prev = 7;
          _context26.t0 = _context26['catch'](3);

          this.logger.error(_context26.t0);
          throw new VerifyError(block, 'malformed', 'error parsing message', 10);

        case 11:

          // Create a new chain entry.
          entry = ChainEntry.fromBlock(this, block, prev);

          // The block is on a alternate chain if the
          // chainwork is less than or equal to
          // our tip's. Add the block but do _not_
          // connect the inputs.

          if (!(entry.chainwork.cmp(this.tip.chainwork) <= 0)) {
            _context26.next = 17;
            break;
          }

          _context26.next = 15;
          return this.saveAlternate(entry, block, prev, flags);

        case 15:
          _context26.next = 19;
          break;

        case 17:
          _context26.next = 19;
          return this.setBestChain(entry, block, prev, flags);

        case 19:

          // Keep track of stats.
          this.logStatus(start, block, entry);

          // Check sync state.
          this.maybeSync();

          return _context26.abrupt('return', entry);

        case 22:
        case 'end':
          return _context26.stop();
      }
    }
  }, connect, this, [[3, 7]]);
}));

/**
 * Handle orphans.
 * @method
 * @private
 * @param {ChainEntry} entry
 * @returns {Promise}
 */

Chain.prototype.handleOrphans = co( /*#__PURE__*/_regenerator2.default.mark(function handleOrphans(entry) {
  var orphan, block, flags, id;
  return _regenerator2.default.wrap(function handleOrphans$(_context27) {
    while (1) {
      switch (_context27.prev = _context27.next) {
        case 0:
          orphan = this.resolveOrphan(entry.hash);

        case 1:
          if (!orphan) {
            _context27.next = 23;
            break;
          }

          block = orphan.block;
          flags = orphan.flags;
          id = orphan.id;

          _context27.prev = 5;
          _context27.next = 8;
          return this.connect(entry, block, flags);

        case 8:
          entry = _context27.sent;
          _context27.next = 18;
          break;

        case 11:
          _context27.prev = 11;
          _context27.t0 = _context27['catch'](5);

          if (!(_context27.t0.type === 'VerifyError')) {
            _context27.next = 17;
            break;
          }

          this.logger.warning('Could not resolve orphan block %s: %s.', block.rhash(), _context27.t0.message);

          this.emit('bad orphan', _context27.t0, id);

          return _context27.abrupt('break', 23);

        case 17:
          throw _context27.t0;

        case 18:

          this.logger.debug('Orphan block was resolved: %s (%d).', block.rhash(), entry.height);

          this.emit('resolved', block, entry);

          orphan = this.resolveOrphan(entry.hash);
          _context27.next = 1;
          break;

        case 23:
        case 'end':
          return _context27.stop();
      }
    }
  }, handleOrphans, this, [[5, 11]]);
}));

/**
 * Test whether the chain has reached its slow height.
 * @private
 * @returns {Boolean}
 */

Chain.prototype.isSlow = function isSlow() {
  if (this.options.spv) return false;

  if (this.synced) return true;

  if (this.height === 1 || this.height % 20 === 0) return true;

  if (this.height >= this.network.block.slowHeight) return true;

  return false;
};

/**
 * Calculate the time difference from
 * start time and log block.
 * @private
 * @param {Array} start
 * @param {Block} block
 * @param {ChainEntry} entry
 */

Chain.prototype.logStatus = function logStatus(start, block, entry) {
  var elapsed;

  if (!this.isSlow()) return;

  // Report memory for debugging.
  this.logger.memory();

  elapsed = util.hrtime(start);

  this.logger.info('Block %s (%d) added to chain (size=%d txs=%d time=%d).', entry.rhash(), entry.height, block.getSize(), block.txs.length, elapsed);

  if (this.db.coinCache.capacity > 0) {
    this.logger.debug('Coin Cache: size=%dmb, items=%d.', util.mb(this.db.coinCache.size), this.db.coinCache.items);
  }
};

/**
 * Verify a block hash and height against the checkpoints.
 * @private
 * @param {ChainEntry} prev
 * @param {Hash} hash
 * @returns {Boolean}
 */

Chain.prototype.verifyCheckpoint = function verifyCheckpoint(prev, hash) {
  var height = prev.height + 1;
  var checkpoint;

  if (!this.checkpoints) return true;

  checkpoint = this.network.checkpointMap[height];

  if (!checkpoint) return true;

  if (hash === checkpoint) {
    this.logger.debug('Hit checkpoint block %s (%d).', util.revHex(hash), height);
    this.emit('checkpoint', hash, height);
    return true;
  }

  // Someone is either mining on top of
  // an old block for no reason, or the
  // consensus protocol is broken and
  // there was a 20k+ block reorg.
  this.logger.warning('Checkpoint mismatch at height %d: expected=%s received=%s', height, util.revHex(checkpoint), util.revHex(hash));

  this.purgeOrphans();

  return false;
};

/**
 * Store an orphan.
 * @private
 * @param {Block} block
 * @param {Number?} flags
 * @param {Number?} id
 */

Chain.prototype.storeOrphan = function storeOrphan(block, flags, id) {
  var hash = block.hash('hex');
  var height = block.getCoinbaseHeight();
  var orphan = this.orphanPrev[block.prevBlock];

  // The orphan chain forked.
  if (orphan) {
    assert(orphan.block.hash('hex') !== hash);
    assert(orphan.block.prevBlock === block.prevBlock);

    this.logger.warning('Removing forked orphan block: %s (%d).', orphan.block.rhash(), height);

    this.removeOrphan(orphan);
  }

  this.limitOrphans();

  orphan = new Orphan(block, flags, id);

  this.addOrphan(orphan);

  this.logger.debug('Storing orphan block: %s (%d).', block.rhash(), height);

  this.emit('orphan', block);
};

/**
 * Add an orphan.
 * @private
 * @param {Orphan} orphan
 * @returns {Orphan}
 */

Chain.prototype.addOrphan = function addOrphan(orphan) {
  var block = orphan.block;
  var hash = block.hash('hex');

  assert(!this.orphanMap[hash]);
  assert(!this.orphanPrev[block.prevBlock]);
  assert(this.orphanCount >= 0);

  this.orphanMap[hash] = orphan;
  this.orphanPrev[block.prevBlock] = orphan;
  this.orphanCount += 1;

  return orphan;
};

/**
 * Remove an orphan.
 * @private
 * @param {Orphan} orphan
 * @returns {Orphan}
 */

Chain.prototype.removeOrphan = function removeOrphan(orphan) {
  var block = orphan.block;
  var hash = block.hash('hex');

  assert(this.orphanMap[hash]);
  assert(this.orphanPrev[block.prevBlock]);
  assert(this.orphanCount > 0);

  delete this.orphanMap[hash];
  delete this.orphanPrev[block.prevBlock];
  this.orphanCount -= 1;

  return orphan;
};

/**
 * Test whether a hash would resolve the next orphan.
 * @private
 * @param {Hash} hash - Previous block hash.
 * @returns {Boolean}
 */

Chain.prototype.hasNextOrphan = function hasNextOrphan(hash) {
  return this.orphanPrev[hash] != null;
};

/**
 * Resolve an orphan.
 * @private
 * @param {Hash} hash - Previous block hash.
 * @returns {Orphan}
 */

Chain.prototype.resolveOrphan = function resolveOrphan(hash) {
  var orphan = this.orphanPrev[hash];

  if (!orphan) return;

  return this.removeOrphan(orphan);
};

/**
 * Purge any waiting orphans.
 */

Chain.prototype.purgeOrphans = function purgeOrphans() {
  var count = this.orphanCount;

  if (count === 0) return;

  this.orphanMap = {};
  this.orphanPrev = {};
  this.orphanCount = 0;

  this.logger.debug('Purged %d orphans.', count);
};

/**
 * Prune orphans, only keep the orphan with the highest
 * coinbase height (likely to be the peer's tip).
 */

Chain.prototype.limitOrphans = function limitOrphans() {
  var now = util.now();
  var hashes = (0, _keys2.default)(this.orphanMap);
  var i, hash, orphan, oldest;

  for (i = 0; i < hashes.length; i++) {
    hash = hashes[i];
    orphan = this.orphanMap[hash];

    if (now < orphan.ts + 60 * 60) {
      if (!oldest || orphan.ts < oldest.ts) oldest = orphan;
      continue;
    }

    this.removeOrphan(orphan);
  }

  if (this.orphanCount < this.options.maxOrphans) return;

  if (!oldest) return;

  this.removeOrphan(oldest);
};

/**
 * Test whether an invalid block hash has been seen.
 * @private
 * @param {Block} block
 * @returns {Boolean}
 */

Chain.prototype.hasInvalid = function hasInvalid(block) {
  var hash = block.hash('hex');

  if (this.invalid.has(hash)) return true;

  if (this.invalid.has(block.prevBlock)) {
    this.setInvalid(hash);
    return true;
  }

  return false;
};

/**
 * Mark a block as invalid.
 * @private
 * @param {Hash} hash
 */

Chain.prototype.setInvalid = function setInvalid(hash) {
  this.invalid.set(hash, true);
};

/**
 * Forget an invalid block hash.
 * @private
 * @param {Hash} hash
 */

Chain.prototype.removeInvalid = function removeInvalid(hash) {
  this.invalid.remove(hash);
};

/**
 * Test the chain to see if it contains
 * a block, or has recently seen a block.
 * @method
 * @param {Hash} hash
 * @returns {Promise} - Returns Boolean.
 */

Chain.prototype.has = co( /*#__PURE__*/_regenerator2.default.mark(function has(hash) {
  return _regenerator2.default.wrap(function has$(_context28) {
    while (1) {
      switch (_context28.prev = _context28.next) {
        case 0:
          if (!this.hasOrphan(hash)) {
            _context28.next = 2;
            break;
          }

          return _context28.abrupt('return', true);

        case 2:
          if (!this.locker.has(hash)) {
            _context28.next = 4;
            break;
          }

          return _context28.abrupt('return', true);

        case 4:
          if (!this.invalid.has(hash)) {
            _context28.next = 6;
            break;
          }

          return _context28.abrupt('return', true);

        case 6:
          _context28.next = 8;
          return this.hasEntry(hash);

        case 8:
          return _context28.abrupt('return', _context28.sent);

        case 9:
        case 'end':
          return _context28.stop();
      }
    }
  }, has, this);
}));

/**
 * Find the corresponding block entry by hash or height.
 * @param {Hash|Number} hash/height
 * @returns {Promise} - Returns {@link ChainEntry}.
 */

Chain.prototype.getEntry = function getEntry(hash) {
  return this.db.getEntry(hash);
};

/**
 * Test the chain to see if it contains a block.
 * @param {Hash} hash
 * @returns {Promise} - Returns Boolean.
 */

Chain.prototype.hasEntry = function hasEntry(hash) {
  return this.db.hasEntry(hash);
};

/**
 * Get an orphan block.
 * @param {Hash} hash
 * @returns {Block}
 */

Chain.prototype.getOrphan = function getOrphan(hash) {
  return this.orphanMap[hash] || null;
};

/**
 * Test the chain to see if it contains an orphan.
 * @param {Hash} hash
 * @returns {Promise} - Returns Boolean.
 */

Chain.prototype.hasOrphan = function hasOrphan(hash) {
  return this.orphanMap[hash] != null;
};

/**
 * Test the chain to see if it contains a pending block in its queue.
 * @param {Hash} hash
 * @returns {Promise} - Returns Boolean.
 */

Chain.prototype.hasPending = function hasPending(hash) {
  return this.locker.hasPending(hash);
};

/**
 * Get coin viewpoint (spent).
 * @method
 * @param {TX} tx
 * @returns {Promise} - Returns {@link CoinView}.
 */

Chain.prototype.getSpentView = co( /*#__PURE__*/_regenerator2.default.mark(function getSpentView(tx) {
  var unlock;
  return _regenerator2.default.wrap(function getSpentView$(_context29) {
    while (1) {
      switch (_context29.prev = _context29.next) {
        case 0:
          _context29.next = 2;
          return this.locker.lock();

        case 2:
          unlock = _context29.sent;
          _context29.prev = 3;
          _context29.next = 6;
          return this.db.getSpentView(tx);

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
  }, getSpentView, this, [[3,, 7, 10]]);
}));

/**
 * Test the chain to see if it is synced.
 * @returns {Boolean}
 */

Chain.prototype.isFull = function isFull() {
  return this.synced;
};

/**
 * Potentially emit a `full` event.
 * @private
 */

Chain.prototype.maybeSync = function maybeSync() {
  if (this.synced) return;

  if (this.checkpoints) {
    if (this.tip.height < this.network.lastCheckpoint) return;

    this.logger.info('Last checkpoint reached. Disabling checkpoints.');
    this.checkpoints = false;
  }

  if (this.tip.ts < util.now() - this.network.block.maxTipAge) return;

  if (!this.hasChainwork()) return;

  this.synced = true;
  this.emit('full');
};

/**
 * Test the chain to see if it has the
 * minimum required chainwork for the
 * network.
 * @returns {Boolean}
 */

Chain.prototype.hasChainwork = function hasChainwork() {
  return this.tip.chainwork.cmp(this.network.pow.chainwork) >= 0;
};

/**
 * Get the fill percentage.
 * @returns {Number} percent - Ranges from 0.0 to 1.0.
 */

Chain.prototype.getProgress = function getProgress() {
  var start = this.network.genesis.ts;
  var current = this.tip.ts - start;
  var end = util.now() - start - 40 * 60;
  return Math.min(1, current / end);
};

/**
 * Calculate chain locator (an array of hashes).
 * @method
 * @param {Hash?} start - Height or hash to treat as the tip.
 * The current tip will be used if not present. Note that this can be a
 * non-existent hash, which is useful for headers-first locators.
 * @returns {Promise} - Returns {@link Hash}[].
 */

Chain.prototype.getLocator = co( /*#__PURE__*/_regenerator2.default.mark(function getLocator(start) {
  var unlock;
  return _regenerator2.default.wrap(function getLocator$(_context30) {
    while (1) {
      switch (_context30.prev = _context30.next) {
        case 0:
          _context30.next = 2;
          return this.locker.lock();

        case 2:
          unlock = _context30.sent;
          _context30.prev = 3;
          _context30.next = 6;
          return this._getLocator(start);

        case 6:
          return _context30.abrupt('return', _context30.sent);

        case 7:
          _context30.prev = 7;

          unlock();
          return _context30.finish(7);

        case 10:
        case 'end':
          return _context30.stop();
      }
    }
  }, getLocator, this, [[3,, 7, 10]]);
}));

/**
 * Calculate chain locator without a lock.
 * @method
 * @private
 * @param {Hash?} start
 * @returns {Promise}
 */

Chain.prototype._getLocator = co( /*#__PURE__*/_regenerator2.default.mark(function getLocator(start) {
  var hashes, step, height, entry, main, hash;
  return _regenerator2.default.wrap(function getLocator$(_context31) {
    while (1) {
      switch (_context31.prev = _context31.next) {
        case 0:
          hashes = [];
          step = 1;


          if (start == null) start = this.tip.hash;

          assert(typeof start === 'string');

          _context31.next = 6;
          return this.db.getEntry(start);

        case 6:
          entry = _context31.sent;

          if (entry) {
            _context31.next = 9;
            break;
          }

          throw new Error('Tip not found.');

        case 9:

          hash = entry.hash;
          height = entry.height;
          _context31.next = 13;
          return entry.isMainChain();

        case 13:
          main = _context31.sent;


          hashes.push(hash);

        case 15:
          if (!(height > 0)) {
            _context31.next = 34;
            break;
          }

          height -= step;

          if (height < 0) height = 0;

          if (hashes.length > 10) step *= 2;

          if (!main) {
            _context31.next = 26;
            break;
          }

          _context31.next = 22;
          return this.db.getHash(height);

        case 22:
          hash = _context31.sent;

          assert(hash);
          _context31.next = 31;
          break;

        case 26:
          _context31.next = 28;
          return entry.getAncestor(height);

        case 28:
          entry = _context31.sent;

          assert(entry);
          hash = entry.hash;

        case 31:

          hashes.push(hash);
          _context31.next = 15;
          break;

        case 34:
          return _context31.abrupt('return', hashes);

        case 35:
        case 'end':
          return _context31.stop();
      }
    }
  }, getLocator, this);
}));

/**
 * Calculate the orphan root of the hash (if it is an orphan).
 * @param {Hash} hash
 * @returns {Hash}
 */

Chain.prototype.getOrphanRoot = function getOrphanRoot(hash) {
  var root, orphan;

  assert(hash);

  for (;;) {
    orphan = this.orphanMap[hash];

    if (!orphan) break;

    root = hash;
    hash = orphan.block.prevBlock;
  }

  return root;
};

/**
 * Calculate the time difference (in seconds)
 * between two blocks by examining chainworks.
 * @param {ChainEntry} to
 * @param {ChainEntry} from
 * @returns {Number}
 */

Chain.prototype.getProofTime = function getProofTime(to, from) {
  var pow = this.network.pow;
  var sign, work;

  if (to.chainwork.cmp(from.chainwork) > 0) {
    work = to.chainwork.sub(from.chainwork);
    sign = 1;
  } else {
    work = from.chainwork.sub(to.chainwork);
    sign = -1;
  }

  work = work.imuln(pow.targetSpacing);
  work = work.div(this.tip.getProof());

  if (work.bitLength() > 53) return sign * util.MAX_SAFE_INTEGER;

  return sign * work.toNumber();
};

/**
 * Calculate the next target based on the chain tip.
 * @method
 * @returns {Promise} - returns Number
 * (target is in compact/mantissa form).
 */

Chain.prototype.getCurrentTarget = co( /*#__PURE__*/_regenerator2.default.mark(function getCurrentTarget() {
  return _regenerator2.default.wrap(function getCurrentTarget$(_context32) {
    while (1) {
      switch (_context32.prev = _context32.next) {
        case 0:
          _context32.next = 2;
          return this.getTarget(this.network.now(), this.tip);

        case 2:
          return _context32.abrupt('return', _context32.sent);

        case 3:
        case 'end':
          return _context32.stop();
      }
    }
  }, getCurrentTarget, this);
}));

/**
 * Calculate the next target.
 * @method
 * @param {Number} ts - Next block timestamp.
 * @param {ChainEntry} prev - Previous entry.
 * @returns {Promise} - returns Number
 * (target is in compact/mantissa form).
 */

Chain.prototype.getTarget = co( /*#__PURE__*/_regenerator2.default.mark(function getTarget(ts, prev) {
  var pow, first, cache, height, back;
  return _regenerator2.default.wrap(function getTarget$(_context33) {
    while (1) {
      switch (_context33.prev = _context33.next) {
        case 0:
          pow = this.network.pow;

          if (prev) {
            _context33.next = 4;
            break;
          }

          assert(ts === this.network.genesis.ts);
          return _context33.abrupt('return', pow.bits);

        case 4:
          if (!((prev.height + 1) % pow.retargetInterval !== 0)) {
            _context33.next = 20;
            break;
          }

          if (!pow.targetReset) {
            _context33.next = 19;
            break;
          }

          if (!(ts > prev.ts + pow.targetSpacing * 2)) {
            _context33.next = 8;
            break;
          }

          return _context33.abrupt('return', pow.bits);

        case 8:
          if (!(prev.height !== 0 && prev.height % pow.retargetInterval !== 0 && prev.bits === pow.bits)) {
            _context33.next = 19;
            break;
          }

          cache = prev.getPrevCache();

          if (!cache) {
            _context33.next = 13;
            break;
          }

          prev = cache;
          return _context33.abrupt('continue', 8);

        case 13:
          _context33.next = 15;
          return prev.getPrevious();

        case 15:
          prev = _context33.sent;

          assert(prev);
          _context33.next = 8;
          break;

        case 19:
          return _context33.abrupt('return', prev.bits);

        case 20:

          // Back 2 weeks
          back = pow.retargetInterval - 1;

          if (prev.height + 1 !== pow.retargetInterval) back = pow.retargetInterval;

          height = prev.height - back;
          assert(height >= 0);

          _context33.next = 26;
          return prev.getAncestor(height);

        case 26:
          first = _context33.sent;

          assert(first);

          return _context33.abrupt('return', this.retarget(prev, first));

        case 29:
        case 'end':
          return _context33.stop();
      }
    }
  }, getTarget, this);
}));

/**
 * Retarget. This is called when the chain height
 * hits a retarget diff interval.
 * @param {ChainEntry} prev - Previous entry.
 * @param {ChainEntry} first - Chain entry from 2 weeks prior.
 * @returns {Number} target - Target in compact/mantissa form.
 */

Chain.prototype.retarget = function retarget(prev, first) {
  var pow = this.network.pow;
  var targetTimespan = pow.targetTimespan;
  var actualTimespan, target;

  if (pow.noRetargeting) return prev.bits;

  actualTimespan = prev.ts - first.ts;
  target = consensus.fromCompact(prev.bits);

  if (actualTimespan < targetTimespan / 4 | 0) actualTimespan = targetTimespan / 4 | 0;

  if (actualTimespan > targetTimespan * 4) actualTimespan = targetTimespan * 4;

  target.imuln(actualTimespan);
  target.idivn(targetTimespan);

  if (target.cmp(pow.limit) > 0) return pow.bits;

  return consensus.toCompact(target);
};

/**
 * Find a locator. Analagous to bitcoind's `FindForkInGlobalIndex()`.
 * @method
 * @param {Hash[]} locator - Hashes.
 * @returns {Promise} - Returns {@link Hash} (the
 * hash of the latest known block).
 */

Chain.prototype.findLocator = co( /*#__PURE__*/_regenerator2.default.mark(function findLocator(locator) {
  var i, hash;
  return _regenerator2.default.wrap(function findLocator$(_context34) {
    while (1) {
      switch (_context34.prev = _context34.next) {
        case 0:
          i = 0;

        case 1:
          if (!(i < locator.length)) {
            _context34.next = 10;
            break;
          }

          hash = locator[i];
          _context34.next = 5;
          return this.db.isMainChain(hash);

        case 5:
          if (!_context34.sent) {
            _context34.next = 7;
            break;
          }

          return _context34.abrupt('return', hash);

        case 7:
          i++;
          _context34.next = 1;
          break;

        case 10:
          return _context34.abrupt('return', this.network.genesis.hash);

        case 11:
        case 'end':
          return _context34.stop();
      }
    }
  }, findLocator, this);
}));

/**
 * Check whether a versionbits deployment is active (BIP9: versionbits).
 * @example
 * yield chain.isActive(tip, deployments.segwit);
 * @method
 * @see https://github.com/bitcoin/bips/blob/master/bip-0009.mediawiki
 * @param {ChainEntry} prev - Previous chain entry.
 * @param {String} id - Deployment id.
 * @returns {Promise} - Returns Number.
 */

Chain.prototype.isActive = co( /*#__PURE__*/_regenerator2.default.mark(function isActive(prev, deployment) {
  var state;
  return _regenerator2.default.wrap(function isActive$(_context35) {
    while (1) {
      switch (_context35.prev = _context35.next) {
        case 0:
          _context35.next = 2;
          return this.getState(prev, deployment);

        case 2:
          state = _context35.sent;
          return _context35.abrupt('return', state === common.thresholdStates.ACTIVE);

        case 4:
        case 'end':
          return _context35.stop();
      }
    }
  }, isActive, this);
}));

/**
 * Get chain entry state for a deployment (BIP9: versionbits).
 * @method
 * @example
 * yield chain.getState(tip, deployments.segwit);
 * @see https://github.com/bitcoin/bips/blob/master/bip-0009.mediawiki
 * @param {ChainEntry} prev - Previous chain entry.
 * @param {String} id - Deployment id.
 * @returns {Promise} - Returns Number.
 */

Chain.prototype.getState = co( /*#__PURE__*/_regenerator2.default.mark(function getState(prev, deployment) {
  var period, threshold, thresholdStates, bit, compute, i, entry, count, state, cached, block, time, height;
  return _regenerator2.default.wrap(function getState$(_context36) {
    while (1) {
      switch (_context36.prev = _context36.next) {
        case 0:
          period = this.network.minerWindow;
          threshold = this.network.activationThreshold;
          thresholdStates = common.thresholdStates;
          bit = deployment.bit;
          compute = [];

          if (!((prev.height + 1) % period !== 0)) {
            _context36.next = 14;
            break;
          }

          height = prev.height - (prev.height + 1) % period;
          _context36.next = 9;
          return prev.getAncestor(height);

        case 9:
          prev = _context36.sent;

          if (prev) {
            _context36.next = 12;
            break;
          }

          return _context36.abrupt('return', thresholdStates.DEFINED);

        case 12:

          assert(prev.height === height);
          assert((prev.height + 1) % period === 0);

        case 14:

          entry = prev;
          state = thresholdStates.DEFINED;

        case 16:
          if (!entry) {
            _context36.next = 35;
            break;
          }

          cached = this.db.stateCache.get(bit, entry);

          if (!(cached !== -1)) {
            _context36.next = 21;
            break;
          }

          state = cached;
          return _context36.abrupt('break', 35);

        case 21:
          _context36.next = 23;
          return entry.getMedianTime();

        case 23:
          time = _context36.sent;

          if (!(time < deployment.startTime)) {
            _context36.next = 28;
            break;
          }

          state = thresholdStates.DEFINED;
          this.db.stateCache.set(bit, entry, state);
          return _context36.abrupt('break', 35);

        case 28:

          compute.push(entry);

          height = entry.height - period;
          _context36.next = 32;
          return entry.getAncestor(height);

        case 32:
          entry = _context36.sent;
          _context36.next = 16;
          break;

        case 35:
          if (!compute.length) {
            _context36.next = 80;
            break;
          }

          entry = compute.pop();

          _context36.t0 = state;
          _context36.next = _context36.t0 === thresholdStates.DEFINED ? 40 : _context36.t0 === thresholdStates.STARTED ? 50 : _context36.t0 === thresholdStates.LOCKED_IN ? 72 : _context36.t0 === thresholdStates.FAILED ? 74 : _context36.t0 === thresholdStates.ACTIVE ? 74 : 75;
          break;

        case 40:
          _context36.next = 42;
          return entry.getMedianTime();

        case 42:
          time = _context36.sent;

          if (!(time >= deployment.timeout)) {
            _context36.next = 46;
            break;
          }

          state = thresholdStates.FAILED;
          return _context36.abrupt('break', 77);

        case 46:
          if (!(time >= deployment.startTime)) {
            _context36.next = 49;
            break;
          }

          state = thresholdStates.STARTED;
          return _context36.abrupt('break', 77);

        case 49:
          return _context36.abrupt('break', 77);

        case 50:
          _context36.next = 52;
          return entry.getMedianTime();

        case 52:
          time = _context36.sent;

          if (!(time >= deployment.timeout)) {
            _context36.next = 56;
            break;
          }

          state = thresholdStates.FAILED;
          return _context36.abrupt('break', 77);

        case 56:

          block = entry;
          count = 0;

          i = 0;

        case 59:
          if (!(i < period)) {
            _context36.next = 71;
            break;
          }

          if (block.hasBit(bit)) count++;

          if (!(count >= threshold)) {
            _context36.next = 64;
            break;
          }

          state = thresholdStates.LOCKED_IN;
          return _context36.abrupt('break', 71);

        case 64:
          _context36.next = 66;
          return block.getPrevious();

        case 66:
          block = _context36.sent;

          assert(block);

        case 68:
          i++;
          _context36.next = 59;
          break;

        case 71:
          return _context36.abrupt('break', 77);

        case 72:
          state = thresholdStates.ACTIVE;
          return _context36.abrupt('break', 77);

        case 74:
          return _context36.abrupt('break', 77);

        case 75:
          assert(false, 'Bad state.');
          return _context36.abrupt('break', 77);

        case 77:

          this.db.stateCache.set(bit, entry, state);
          _context36.next = 35;
          break;

        case 80:
          return _context36.abrupt('return', state);

        case 81:
        case 'end':
          return _context36.stop();
      }
    }
  }, getState, this);
}));

/**
 * Compute the version for a new block (BIP9: versionbits).
 * @method
 * @see https://github.com/bitcoin/bips/blob/master/bip-0009.mediawiki
 * @param {ChainEntry} prev - Previous chain entry (usually the tip).
 * @returns {Promise} - Returns Number.
 */

Chain.prototype.computeBlockVersion = co( /*#__PURE__*/_regenerator2.default.mark(function computeBlockVersion(prev) {
  var version, i, deployment, state;
  return _regenerator2.default.wrap(function computeBlockVersion$(_context37) {
    while (1) {
      switch (_context37.prev = _context37.next) {
        case 0:
          version = 0;
          i = 0;

        case 2:
          if (!(i < this.network.deploys.length)) {
            _context37.next = 11;
            break;
          }

          deployment = this.network.deploys[i];
          _context37.next = 6;
          return this.getState(prev, deployment);

        case 6:
          state = _context37.sent;


          if (state === common.thresholdStates.LOCKED_IN || state === common.thresholdStates.STARTED) {
            version |= 1 << deployment.bit;
          }

        case 8:
          i++;
          _context37.next = 2;
          break;

        case 11:

          version |= consensus.VERSION_TOP_BITS;
          version >>>= 0;

          return _context37.abrupt('return', version);

        case 14:
        case 'end':
          return _context37.stop();
      }
    }
  }, computeBlockVersion, this);
}));

/**
 * Get the current deployment state of the chain. Called on load.
 * @method
 * @private
 * @returns {Promise} - Returns {@link DeploymentState}.
 */

Chain.prototype.getDeploymentState = co( /*#__PURE__*/_regenerator2.default.mark(function getDeploymentState() {
  var prev;
  return _regenerator2.default.wrap(function getDeploymentState$(_context38) {
    while (1) {
      switch (_context38.prev = _context38.next) {
        case 0:
          _context38.next = 2;
          return this.tip.getPrevious();

        case 2:
          prev = _context38.sent;

          if (prev) {
            _context38.next = 6;
            break;
          }

          assert(this.tip.isGenesis());
          return _context38.abrupt('return', this.state);

        case 6:
          if (!this.options.spv) {
            _context38.next = 8;
            break;
          }

          return _context38.abrupt('return', this.state);

        case 8:
          _context38.next = 10;
          return this.getDeployments(this.tip.ts, prev);

        case 10:
          return _context38.abrupt('return', _context38.sent);

        case 11:
        case 'end':
          return _context38.stop();
      }
    }
  }, getDeploymentState, this);
}));

/**
 * Check transaction finality, taking into account MEDIAN_TIME_PAST
 * if it is present in the lock flags.
 * @method
 * @param {ChainEntry} prev - Previous chain entry.
 * @param {TX} tx
 * @param {LockFlags} flags
 * @returns {Promise} - Returns Boolean.
 */

Chain.prototype.verifyFinal = co( /*#__PURE__*/_regenerator2.default.mark(function verifyFinal(prev, tx, flags) {
  var height, ts;
  return _regenerator2.default.wrap(function verifyFinal$(_context39) {
    while (1) {
      switch (_context39.prev = _context39.next) {
        case 0:
          height = prev.height + 1;

          if (!(tx.locktime < consensus.LOCKTIME_THRESHOLD)) {
            _context39.next = 3;
            break;
          }

          return _context39.abrupt('return', tx.isFinal(height, -1));

        case 3:
          if (!(flags & common.lockFlags.MEDIAN_TIME_PAST)) {
            _context39.next = 8;
            break;
          }

          _context39.next = 6;
          return prev.getMedianTime();

        case 6:
          ts = _context39.sent;
          return _context39.abrupt('return', tx.isFinal(height, ts));

        case 8:
          return _context39.abrupt('return', tx.isFinal(height, this.network.now()));

        case 9:
        case 'end':
          return _context39.stop();
      }
    }
  }, verifyFinal, this);
}));

/**
 * Get the necessary minimum time and height sequence locks for a transaction.
 * @method
 * @param {ChainEntry} prev
 * @param {TX} tx
 * @param {CoinView} view
 * @param {LockFlags} flags
 * @returns {Promise}
 * [Error, Number(minTime), Number(minHeight)].
 */

Chain.prototype.getLocks = co( /*#__PURE__*/_regenerator2.default.mark(function getLocks(prev, tx, view, flags) {
  var mask, granularity, disableFlag, typeFlag, hasFlag, nextHeight, minHeight, minTime, coinHeight, coinTime, i, input, entry;
  return _regenerator2.default.wrap(function getLocks$(_context40) {
    while (1) {
      switch (_context40.prev = _context40.next) {
        case 0:
          mask = consensus.SEQUENCE_MASK;
          granularity = consensus.SEQUENCE_GRANULARITY;
          disableFlag = consensus.SEQUENCE_DISABLE_FLAG;
          typeFlag = consensus.SEQUENCE_TYPE_FLAG;
          hasFlag = flags & common.lockFlags.VERIFY_SEQUENCE;
          nextHeight = this.height + 1;
          minHeight = -1;
          minTime = -1;

          if (!(tx.isCoinbase() || tx.version < 2 || !hasFlag)) {
            _context40.next = 10;
            break;
          }

          return _context40.abrupt('return', new LockTimes(minHeight, minTime));

        case 10:
          i = 0;

        case 11:
          if (!(i < tx.inputs.length)) {
            _context40.next = 33;
            break;
          }

          input = tx.inputs[i];

          if (!(input.sequence & disableFlag)) {
            _context40.next = 15;
            break;
          }

          return _context40.abrupt('continue', 30);

        case 15:

          coinHeight = view.getHeight(input);

          if (coinHeight === -1) coinHeight = nextHeight;

          if (!((input.sequence & typeFlag) === 0)) {
            _context40.next = 21;
            break;
          }

          coinHeight += (input.sequence & mask) - 1;
          minHeight = Math.max(minHeight, coinHeight);
          return _context40.abrupt('continue', 30);

        case 21:
          _context40.next = 23;
          return prev.getAncestor(Math.max(coinHeight - 1, 0));

        case 23:
          entry = _context40.sent;

          assert(entry, 'Database is corrupt.');

          _context40.next = 27;
          return entry.getMedianTime();

        case 27:
          coinTime = _context40.sent;

          coinTime += ((input.sequence & mask) << granularity) - 1;
          minTime = Math.max(minTime, coinTime);

        case 30:
          i++;
          _context40.next = 11;
          break;

        case 33:
          return _context40.abrupt('return', new LockTimes(minHeight, minTime));

        case 34:
        case 'end':
          return _context40.stop();
      }
    }
  }, getLocks, this);
}));

/**
 * Verify sequence locks.
 * @method
 * @param {ChainEntry} prev
 * @param {TX} tx
 * @param {CoinView} view
 * @param {LockFlags} flags
 * @returns {Promise} - Returns Boolean.
 */

Chain.prototype.verifyLocks = co( /*#__PURE__*/_regenerator2.default.mark(function verifyLocks(prev, tx, view, flags) {
  var locks, mtp;
  return _regenerator2.default.wrap(function verifyLocks$(_context41) {
    while (1) {
      switch (_context41.prev = _context41.next) {
        case 0:
          _context41.next = 2;
          return this.getLocks(prev, tx, view, flags);

        case 2:
          locks = _context41.sent;

          if (!(locks.height >= prev.height + 1)) {
            _context41.next = 5;
            break;
          }

          return _context41.abrupt('return', false);

        case 5:
          if (!(locks.time === -1)) {
            _context41.next = 7;
            break;
          }

          return _context41.abrupt('return', true);

        case 7:
          _context41.next = 9;
          return prev.getMedianTime();

        case 9:
          mtp = _context41.sent;

          if (!(locks.time >= mtp)) {
            _context41.next = 12;
            break;
          }

          return _context41.abrupt('return', false);

        case 12:
          return _context41.abrupt('return', true);

        case 13:
        case 'end':
          return _context41.stop();
      }
    }
  }, verifyLocks, this);
}));

/**
 * ChainOptions
 * @alias module:blockchain.ChainOptions
 * @constructor
 * @param {Object} options
 */

function ChainOptions(options) {
  if (!(this instanceof ChainOptions)) return new ChainOptions(options);

  this.network = Network.primary;
  this.logger = Logger.global;

  this.prefix = null;
  this.location = null;
  this.db = 'memory';
  this.maxFiles = 64;
  this.cacheSize = 32 << 20;
  this.compression = true;
  this.bufferKeys = ChainDB.layout.binary;

  this.spv = false;
  this.prune = false;
  this.indexTX = false;
  this.indexAddress = false;
  this.forceWitness = false;
  this.forcePrune = false;

  this.coinCache = 0;
  this.entryCache = 5000;
  this.maxOrphans = 20;
  this.checkpoints = true;

  if (options) this.fromOptions(options);
}

/**
 * Inject properties from object.
 * @private
 * @param {Object} options
 * @returns {ChainOptions}
 */

ChainOptions.prototype.fromOptions = function fromOptions(options) {
  if (options.network != null) this.network = Network.get(options.network);

  if (options.logger != null) {
    assert((0, _typeof3.default)(options.logger) === 'object');
    this.logger = options.logger;
  }

  if (options.spv != null) {
    assert(typeof options.spv === 'boolean');
    this.spv = options.spv;
  }

  if (options.prefix != null) {
    assert(typeof options.prefix === 'string');
    this.prefix = options.prefix;
    this.location = this.spv ? this.prefix + '/spvchain' : this.prefix + '/chain';
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

  if (options.prune != null) {
    assert(typeof options.prune === 'boolean');
    this.prune = options.prune;
  }

  if (options.indexTX != null) {
    assert(typeof options.indexTX === 'boolean');
    this.indexTX = options.indexTX;
  }

  if (options.indexAddress != null) {
    assert(typeof options.indexAddress === 'boolean');
    this.indexAddress = options.indexAddress;
  }

  if (options.forceWitness != null) {
    assert(typeof options.forceWitness === 'boolean');
    this.forceWitness = options.forceWitness;
  }

  if (options.forcePrune != null) {
    assert(typeof options.forcePrune === 'boolean');
    this.forcePrune = options.forcePrune;
    if (options.forcePrune) this.prune = true;
  }

  if (options.coinCache != null) {
    assert(util.isNumber(options.coinCache));
    this.coinCache = options.coinCache;
  }

  if (options.entryCache != null) {
    assert(util.isNumber(options.entryCache));
    this.entryCache = options.entryCache;
  }

  if (options.maxOrphans != null) {
    assert(util.isNumber(options.maxOrphans));
    this.maxOrphans = options.maxOrphans;
  }

  if (options.checkpoints != null) {
    assert(typeof options.checkpoints === 'boolean');
    this.checkpoints = options.checkpoints;
  }

  return this;
};

/**
 * Instantiate chain options from object.
 * @param {Object} options
 * @returns {ChainOptions}
 */

ChainOptions.fromOptions = function fromOptions(options) {
  return new ChainOptions().fromOptions(options);
};

/**
 * Represents the deployment state of the chain.
 * @alias module:blockchain.DeploymentState
 * @constructor
 * @property {VerifyFlags} flags
 * @property {LockFlags} lockFlags
 * @property {Boolean} bip34
 */

function DeploymentState() {
  if (!(this instanceof DeploymentState)) return new DeploymentState();

  this.flags = Script.flags.MANDATORY_VERIFY_FLAGS;
  this.flags &= ~Script.flags.VERIFY_P2SH;
  this.lockFlags = common.lockFlags.MANDATORY_LOCKTIME_FLAGS;
  this.bip34 = false;
}

/**
 * Test whether p2sh is active.
 * @returns {Boolean}
 */

DeploymentState.prototype.hasP2SH = function hasP2SH() {
  return (this.flags & Script.flags.VERIFY_P2SH) !== 0;
};

/**
 * Test whether bip34 (coinbase height) is active.
 * @returns {Boolean}
 */

DeploymentState.prototype.hasBIP34 = function hasBIP34() {
  return this.bip34;
};

/**
 * Test whether bip66 (VERIFY_DERSIG) is active.
 * @returns {Boolean}
 */

DeploymentState.prototype.hasBIP66 = function hasBIP66() {
  return (this.flags & Script.flags.VERIFY_DERSIG) !== 0;
};

/**
 * Test whether cltv is active.
 * @returns {Boolean}
 */

DeploymentState.prototype.hasCLTV = function hasCLTV() {
  return (this.flags & Script.flags.VERIFY_CHECKLOCKTIMEVERIFY) !== 0;
};

/**
 * Test whether median time past locktime is active.
 * @returns {Boolean}
 */

DeploymentState.prototype.hasMTP = function hasMTP() {
  return (this.lockFlags & common.lockFlags.MEDIAN_TIME_PAST) !== 0;
};

/**
 * Test whether csv is active.
 * @returns {Boolean}
 */

DeploymentState.prototype.hasCSV = function hasCSV() {
  return (this.flags & Script.flags.VERIFY_CHECKSEQUENCEVERIFY) !== 0;
};

/**
 * Test whether segwit is active.
 * @returns {Boolean}
 */

DeploymentState.prototype.hasWitness = function hasWitness() {
  return (this.flags & Script.flags.VERIFY_WITNESS) !== 0;
};

/**
 * LockTimes
 * @constructor
 * @ignore
 */

function LockTimes(height, time) {
  this.height = height;
  this.time = time;
}

/**
 * ContextResult
 * @constructor
 * @ignore
 */

function ContextResult(view, state) {
  this.view = view;
  this.state = state;
}

/**
 * Orphan
 * @constructor
 * @ignore
 */

function Orphan(block, flags, id) {
  this.block = block;
  this.flags = flags;
  this.id = id;
  this.ts = util.now();
}

/*
 * Expose
 */

module.exports = Chain;