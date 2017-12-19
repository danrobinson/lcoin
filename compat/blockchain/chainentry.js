/*!
 * chainentry.js - chainentry object for bcoin
 * Copyright (c) 2014-2015, Fedor Indutny (MIT License)
 * Copyright (c) 2014-2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

var _regenerator = require('babel-runtime/regenerator');

var _regenerator2 = _interopRequireDefault(_regenerator);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var assert = require('assert');
var BN = require('bn.js');
var consensus = require('../protocol/consensus');
var util = require('../utils/util');
var crypto = require('../crypto/crypto');
var encoding = require('../utils/encoding');
var BufferReader = require('../utils/reader');
var StaticWriter = require('../utils/staticwriter');
var Headers = require('../primitives/headers');
var InvItem = require('../primitives/invitem');
var co = require('../utils/co');

/**
 * Represents an entry in the chain. Unlike
 * other bitcoin fullnodes, we store the
 * chainwork _with_ the entry in order to
 * avoid reading the entire chain index on
 * boot and recalculating the chainworks.
 * @alias module:blockchain.ChainEntry
 * @constructor
 * @param {Chain} chain
 * @param {Object} options
 * @param {ChainEntry} prev
 * @property {Hash} hash
 * @property {Number} version - Transaction version. Note that Bcoin reads
 * versions as unsigned even though they are signed at the protocol level.
 * This value will never be negative.
 * @property {Hash} prevBlock
 * @property {Hash} merkleRoot
 * @property {Number} ts
 * @property {Number} bits
 * @property {Number} nonce
 * @property {Number} height
 * @property {BN} chainwork
 * @property {ReversedHash} rhash - Reversed block hash (uint256le).
 */

function ChainEntry(chain, options, prev) {
  if (!(this instanceof ChainEntry)) return new ChainEntry(chain, options, prev);

  this.chain = chain;
  this.hash = encoding.NULL_HASH;
  this.version = 1;
  this.prevBlock = encoding.NULL_HASH;
  this.merkleRoot = encoding.NULL_HASH;
  this.ts = 0;
  this.bits = 0;
  this.nonce = 0;
  this.height = -1;
  this.chainwork = null;

  if (options) this.fromOptions(options, prev);
}

/**
 * The max chainwork (1 << 256).
 * @const {BN}
 */

ChainEntry.MAX_CHAINWORK = new BN(1).ushln(256);

/**
 * Size of set to pick median time from.
 * @const {Number}
 * @default
 */

ChainEntry.MEDIAN_TIMESPAN = 11;

/**
 * Inject properties from options.
 * @private
 * @param {Object} options
 * @param {ChainEntry} prev - Previous entry.
 */

ChainEntry.prototype.fromOptions = function fromOptions(options, prev) {
  assert(options, 'Block data is required.');
  assert(typeof options.hash === 'string');
  assert(util.isNumber(options.version));
  assert(typeof options.prevBlock === 'string');
  assert(typeof options.merkleRoot === 'string');
  assert(util.isNumber(options.ts));
  assert(util.isNumber(options.bits));
  assert(util.isNumber(options.nonce));
  assert(!options.chainwork || BN.isBN(options.chainwork));

  this.hash = options.hash;
  this.version = options.version;
  this.prevBlock = options.prevBlock;
  this.merkleRoot = options.merkleRoot;
  this.ts = options.ts;
  this.bits = options.bits;
  this.nonce = options.nonce;
  this.height = options.height;
  this.chainwork = options.chainwork;

  if (!this.chainwork) this.chainwork = this.getChainwork(prev);

  return this;
};

/**
 * Instantiate chainentry from options.
 * @param {Chain} chain
 * @param {Object} options
 * @param {ChainEntry} prev - Previous entry.
 * @returns {ChainEntry}
 */

ChainEntry.fromOptions = function fromOptions(chain, options, prev) {
  return new ChainEntry(chain).fromOptions(options, prev);
};

/**
 * Calculate the proof: (1 << 256) / (target + 1)
 * @returns {BN} proof
 */

ChainEntry.prototype.getProof = function getProof() {
  var target = consensus.fromCompact(this.bits);
  if (target.isNeg() || target.cmpn(0) === 0) return new BN(0);
  return ChainEntry.MAX_CHAINWORK.div(target.iaddn(1));
};

/**
 * Calculate the chainwork by
 * adding proof to previous chainwork.
 * @returns {BN} chainwork
 */

ChainEntry.prototype.getChainwork = function getChainwork(prev) {
  var proof = this.getProof();

  if (!prev) return proof;

  return proof.iadd(prev.chainwork);
};

/**
 * Test against the genesis block.
 * @returns {Boolean}
 */

ChainEntry.prototype.isGenesis = function isGenesis() {
  return this.hash === this.chain.network.genesis.hash;
};

/**
 * Test whether the entry is in the main chain.
 * @method
 * @returns {Promise} - Return Boolean.
 */

ChainEntry.prototype.isMainChain = co( /*#__PURE__*/_regenerator2.default.mark(function isMainChain() {
  var entry;
  return _regenerator2.default.wrap(function isMainChain$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:
          if (!(this.hash === this.chain.tip.hash || this.hash === this.chain.network.genesis.hash)) {
            _context.next = 2;
            break;
          }

          return _context.abrupt('return', true);

        case 2:

          entry = this.chain.db.getCache(this.height);

          if (!entry) {
            _context.next = 7;
            break;
          }

          if (!(entry.hash === this.hash)) {
            _context.next = 6;
            break;
          }

          return _context.abrupt('return', true);

        case 6:
          return _context.abrupt('return', false);

        case 7:
          _context.next = 9;
          return this.chain.db.getNextHash(this.hash);

        case 9:
          if (!_context.sent) {
            _context.next = 11;
            break;
          }

          return _context.abrupt('return', true);

        case 11:
          return _context.abrupt('return', false);

        case 12:
        case 'end':
          return _context.stop();
      }
    }
  }, isMainChain, this);
}));

/**
 * Get ancestor by `height`.
 * @method
 * @param {Number} height
 * @returns {Promise} - Returns ChainEntry[].
 */

ChainEntry.prototype.getAncestor = co( /*#__PURE__*/_regenerator2.default.mark(function getAncestor(height) {
  var entry;
  return _regenerator2.default.wrap(function getAncestor$(_context2) {
    while (1) {
      switch (_context2.prev = _context2.next) {
        case 0:
          entry = this;

          if (!(height < 0)) {
            _context2.next = 3;
            break;
          }

          return _context2.abrupt('return');

        case 3:

          assert(height >= 0);
          assert(height <= this.height);

          _context2.next = 7;
          return this.isMainChain();

        case 7:
          if (!_context2.sent) {
            _context2.next = 11;
            break;
          }

          _context2.next = 10;
          return this.chain.db.getEntry(height);

        case 10:
          return _context2.abrupt('return', _context2.sent);

        case 11:
          if (!(entry.height !== height)) {
            _context2.next = 18;
            break;
          }

          _context2.next = 14;
          return entry.getPrevious();

        case 14:
          entry = _context2.sent;

          assert(entry);
          _context2.next = 11;
          break;

        case 18:
          return _context2.abrupt('return', entry);

        case 19:
        case 'end':
          return _context2.stop();
      }
    }
  }, getAncestor, this);
}));

/**
 * Get previous entry.
 * @returns {Promise} - Returns ChainEntry.
 */

ChainEntry.prototype.getPrevious = function getPrevious() {
  return this.chain.db.getEntry(this.prevBlock);
};

/**
 * Get previous cached entry.
 * @returns {ChainEntry|null}
 */

ChainEntry.prototype.getPrevCache = function getPrevCache() {
  return this.chain.db.getCache(this.prevBlock);
};

/**
 * Get next entry.
 * @method
 * @returns {Promise} - Returns ChainEntry.
 */

ChainEntry.prototype.getNext = co( /*#__PURE__*/_regenerator2.default.mark(function getNext() {
  var hash;
  return _regenerator2.default.wrap(function getNext$(_context3) {
    while (1) {
      switch (_context3.prev = _context3.next) {
        case 0:
          _context3.next = 2;
          return this.chain.db.getNextHash(this.hash);

        case 2:
          hash = _context3.sent;

          if (hash) {
            _context3.next = 5;
            break;
          }

          return _context3.abrupt('return');

        case 5:
          _context3.next = 7;
          return this.chain.db.getEntry(hash);

        case 7:
          return _context3.abrupt('return', _context3.sent);

        case 8:
        case 'end':
          return _context3.stop();
      }
    }
  }, getNext, this);
}));

/**
 * Get next entry.
 * @method
 * @returns {Promise} - Returns ChainEntry.
 */

ChainEntry.prototype.getNextEntry = co( /*#__PURE__*/_regenerator2.default.mark(function getNextEntry() {
  var entry;
  return _regenerator2.default.wrap(function getNextEntry$(_context4) {
    while (1) {
      switch (_context4.prev = _context4.next) {
        case 0:
          _context4.next = 2;
          return this.chain.db.getEntry(this.height + 1);

        case 2:
          entry = _context4.sent;

          if (entry) {
            _context4.next = 5;
            break;
          }

          return _context4.abrupt('return');

        case 5:
          if (!(entry.prevBlock !== this.hash)) {
            _context4.next = 7;
            break;
          }

          return _context4.abrupt('return');

        case 7:
          return _context4.abrupt('return', entry);

        case 8:
        case 'end':
          return _context4.stop();
      }
    }
  }, getNextEntry, this);
}));

/**
 * Calculate median time past.
 * @method
 * @returns {Promise} - Returns Number.
 */

ChainEntry.prototype.getMedianTime = co( /*#__PURE__*/_regenerator2.default.mark(function getMedianTime() {
  var timespan, entry, median, i, cache;
  return _regenerator2.default.wrap(function getMedianTime$(_context5) {
    while (1) {
      switch (_context5.prev = _context5.next) {
        case 0:
          timespan = ChainEntry.MEDIAN_TIMESPAN;
          entry = this;
          median = [];
          i = 0;

        case 4:
          if (!(i < timespan && entry)) {
            _context5.next = 16;
            break;
          }

          median.push(entry.ts);

          cache = entry.getPrevCache();

          if (!cache) {
            _context5.next = 10;
            break;
          }

          entry = cache;
          return _context5.abrupt('continue', 13);

        case 10:
          _context5.next = 12;
          return entry.getPrevious();

        case 12:
          entry = _context5.sent;

        case 13:
          i++;
          _context5.next = 4;
          break;

        case 16:

          median.sort(cmp);

          return _context5.abrupt('return', median[median.length >>> 1]);

        case 18:
        case 'end':
          return _context5.stop();
      }
    }
  }, getMedianTime, this);
}));

/**
 * Test whether the entry is potentially
 * an ancestor of a checkpoint.
 * @returns {Boolean}
 */

ChainEntry.prototype.isHistorical = function isHistorical() {
  if (this.chain.checkpoints) {
    if (this.height + 1 <= this.chain.network.lastCheckpoint) return true;
  }
  return false;
};

/**
 * Test whether the entry contains an unknown version bit.
 * @returns {Boolean}
 */

ChainEntry.prototype.hasUnknown = function hasUnknown() {
  var bits = this.version & consensus.VERSION_TOP_MASK;
  var topBits = consensus.VERSION_TOP_BITS;

  if (bits >>> 0 !== topBits) return false;

  return (this.version & this.chain.network.unknownBits) !== 0;
};

/**
 * Test whether the entry contains a version bit.
 * @param {Number} bit
 * @returns {Boolean}
 */

ChainEntry.prototype.hasBit = function hasBit(bit) {
  var bits = this.version & consensus.VERSION_TOP_MASK;
  var topBits = consensus.VERSION_TOP_BITS;
  var mask = 1 << bit;
  return bits >>> 0 === topBits && (this.version & mask) !== 0;
};

/**
 * Get little-endian block hash.
 * @returns {Hash}
 */

ChainEntry.prototype.rhash = function () {
  return util.revHex(this.hash);
};

/**
 * Inject properties from block.
 * @private
 * @param {Block|MerkleBlock} block
 * @param {ChainEntry} prev - Previous entry.
 */

ChainEntry.prototype.fromBlock = function fromBlock(block, prev) {
  this.hash = block.hash('hex');
  this.version = block.version;
  this.prevBlock = block.prevBlock;
  this.merkleRoot = block.merkleRoot;
  this.ts = block.ts;
  this.bits = block.bits;
  this.nonce = block.nonce;
  this.height = prev ? prev.height + 1 : 0;
  this.chainwork = this.getChainwork(prev);
  return this;
};

/**
 * Instantiate chainentry from block.
 * @param {Chain} chain
 * @param {Block|MerkleBlock} block
 * @param {ChainEntry} prev - Previous entry.
 * @returns {ChainEntry}
 */

ChainEntry.fromBlock = function fromBlock(chain, block, prev) {
  return new ChainEntry(chain).fromBlock(block, prev);
};

/**
 * Serialize the entry to internal database format.
 * @returns {Buffer}
 */

ChainEntry.prototype.toRaw = function toRaw() {
  var bw = new StaticWriter(116);

  bw.writeU32(this.version);
  bw.writeHash(this.prevBlock);
  bw.writeHash(this.merkleRoot);
  bw.writeU32(this.ts);
  bw.writeU32(this.bits);
  bw.writeU32(this.nonce);
  bw.writeU32(this.height);
  bw.writeBytes(this.chainwork.toArrayLike(Buffer, 'le', 32));

  return bw.render();
};

/**
 * Inject properties from serialized data.
 * @private
 * @param {Buffer} data
 */

ChainEntry.prototype.fromRaw = function fromRaw(data) {
  var br = new BufferReader(data, true);
  var hash = crypto.hash256(br.readBytes(80));

  br.seek(-80);

  this.hash = hash.toString('hex');
  this.version = br.readU32();
  this.prevBlock = br.readHash('hex');
  this.merkleRoot = br.readHash('hex');
  this.ts = br.readU32();
  this.bits = br.readU32();
  this.nonce = br.readU32();
  this.height = br.readU32();
  this.chainwork = new BN(br.readBytes(32), 'le');

  return this;
};

/**
 * Deserialize the entry.
 * @param {Chain} chain
 * @param {Buffer} data
 * @returns {ChainEntry}
 */

ChainEntry.fromRaw = function fromRaw(chain, data) {
  return new ChainEntry(chain).fromRaw(data);
};

/**
 * Serialize the entry to an object more
 * suitable for JSON serialization.
 * @returns {Object}
 */

ChainEntry.prototype.toJSON = function toJSON() {
  return {
    hash: util.revHex(this.hash),
    version: this.version,
    prevBlock: util.revHex(this.prevBlock),
    merkleRoot: util.revHex(this.merkleRoot),
    ts: this.ts,
    bits: this.bits,
    nonce: this.nonce,
    height: this.height,
    chainwork: this.chainwork.toString('hex', 64)
  };
};

/**
 * Inject properties from json object.
 * @private
 * @param {Object} json
 */

ChainEntry.prototype.fromJSON = function fromJSON(json) {
  assert(json, 'Block data is required.');
  assert(typeof json.hash === 'string');
  assert(util.isUInt32(json.version));
  assert(typeof json.prevBlock === 'string');
  assert(typeof json.merkleRoot === 'string');
  assert(util.isUInt32(json.ts));
  assert(util.isUInt32(json.bits));
  assert(util.isUInt32(json.nonce));
  assert(typeof json.chainwork === 'string');

  this.hash = util.revHex(json.hash);
  this.version = json.version;
  this.prevBlock = util.revHex(json.prevBlock);
  this.merkleRoot = util.revHex(json.merkleRoot);
  this.ts = json.ts;
  this.bits = json.bits;
  this.nonce = json.nonce;
  this.height = json.height;
  this.chainwork = new BN(json.chainwork, 'hex');

  return this;
};

/**
 * Instantiate block from jsonified object.
 * @param {Chain} chain
 * @param {Object} json
 * @returns {ChainEntry}
 */

ChainEntry.fromJSON = function fromJSON(chain, json) {
  return new ChainEntry(chain).fromJSON(json);
};

/**
 * Convert the entry to a headers object.
 * @returns {Headers}
 */

ChainEntry.prototype.toHeaders = function toHeaders() {
  return Headers.fromEntry(this);
};

/**
 * Convert the entry to an inv item.
 * @returns {InvItem}
 */

ChainEntry.prototype.toInv = function toInv() {
  return new InvItem(InvItem.types.BLOCK, this.hash);
};

/**
 * Return a more user-friendly object.
 * @returns {Object}
 */

ChainEntry.prototype.inspect = function inspect() {
  var json = this.toJSON();
  json.version = util.hex32(json.version);
  return json;
};

/**
 * Test whether an object is a {@link ChainEntry}.
 * @param {Object} obj
 * @returns {Boolean}
 */

ChainEntry.isChainEntry = function isChainEntry(obj) {
  return obj && BN.isBN(obj.chainwork) && typeof obj.getMedianTime === 'function';
};

/*
 * Helpers
 */

function cmp(a, b) {
  return a - b;
}

/*
 * Expose
 */

module.exports = ChainEntry;