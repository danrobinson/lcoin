/*!
 * nodeclient.js - node client for bcoin
 * Copyright (c) 2014-2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

var _regenerator = require('babel-runtime/regenerator');

var _regenerator2 = _interopRequireDefault(_regenerator);

var _promise = require('babel-runtime/core-js/promise');

var _promise2 = _interopRequireDefault(_promise);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var util = require('../utils/util');
var co = require('../utils/co');
var AsyncObject = require('../utils/asyncobject');

/**
 * NodeClient
 * Sort of a fake local client for separation of concerns.
 * @alias module:node.NodeClient
 * @constructor
 */

function NodeClient(node) {
  if (!(this instanceof NodeClient)) return new NodeClient(node);

  AsyncObject.call(this);

  this.node = node;
  this.network = node.network;
  this.filter = null;
  this.listen = false;

  this._init();
}

util.inherits(NodeClient, AsyncObject);

/**
 * Initialize the client.
 * @returns {Promise}
 */

NodeClient.prototype._init = function init() {
  var self = this;

  this.node.on('connect', function (entry, block) {
    if (!self.listen) return;

    self.emit('block connect', entry, block.txs);
  });

  this.node.on('disconnect', function (entry, block) {
    if (!self.listen) return;

    self.emit('block disconnect', entry);
  });

  this.node.on('tx', function (tx) {
    if (!self.listen) return;

    self.emit('tx', tx);
  });

  this.node.on('reset', function (tip) {
    if (!self.listen) return;

    self.emit('chain reset', tip);
  });
};

/**
 * Open the client.
 * @returns {Promise}
 */

NodeClient.prototype._open = function open(options) {
  this.listen = true;
  return _promise2.default.resolve();
};

/**
 * Close the client.
 * @returns {Promise}
 */

NodeClient.prototype._close = function close() {
  this.listen = false;
  return _promise2.default.resolve();
};

/**
 * Get chain tip.
 * @returns {Promise}
 */

NodeClient.prototype.getTip = function getTip() {
  return _promise2.default.resolve(this.node.chain.tip);
};

/**
 * Get chain entry.
 * @param {Hash} hash
 * @returns {Promise}
 */

NodeClient.prototype.getEntry = co( /*#__PURE__*/_regenerator2.default.mark(function getEntry(hash) {
  var entry;
  return _regenerator2.default.wrap(function getEntry$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:
          _context.next = 2;
          return this.node.chain.db.getEntry(hash);

        case 2:
          entry = _context.sent;

          if (entry) {
            _context.next = 5;
            break;
          }

          return _context.abrupt('return');

        case 5:
          _context.next = 7;
          return entry.isMainChain();

        case 7:
          if (_context.sent) {
            _context.next = 9;
            break;
          }

          return _context.abrupt('return');

        case 9:
          return _context.abrupt('return', entry);

        case 10:
        case 'end':
          return _context.stop();
      }
    }
  }, getEntry, this);
}));

/**
 * Send a transaction. Do not wait for promise.
 * @param {TX} tx
 * @returns {Promise}
 */

NodeClient.prototype.send = function send(tx) {
  this.node.relay(tx);
  return _promise2.default.resolve();
};

/**
 * Set bloom filter.
 * @param {Bloom} filter
 * @returns {Promise}
 */

NodeClient.prototype.setFilter = function setFilter(filter) {
  this.filter = filter;
  this.node.pool.setFilter(filter);
  return _promise2.default.resolve();
};

/**
 * Add data to filter.
 * @param {Buffer} data
 * @returns {Promise}
 */

NodeClient.prototype.addFilter = function addFilter(data) {
  this.node.pool.queueFilterLoad();
  return _promise2.default.resolve();
};

/**
 * Reset filter.
 * @returns {Promise}
 */

NodeClient.prototype.resetFilter = function resetFilter() {
  this.node.pool.queueFilterLoad();
  return _promise2.default.resolve();
};

/**
 * Esimate smart fee.
 * @param {Number?} blocks
 * @returns {Promise}
 */

NodeClient.prototype.estimateFee = function estimateFee(blocks) {
  if (!this.node.fees) return _promise2.default.resolve(this.network.feeRate);
  return _promise2.default.resolve(this.node.fees.estimateFee(blocks));
};

/**
 * Rescan for any missed transactions.
 * @param {Number|Hash} start - Start block.
 * @param {Bloom} filter
 * @param {Function} iter - Iterator.
 * @returns {Promise}
 */

NodeClient.prototype.rescan = function rescan(start) {
  var self = this;
  return this.node.chain.scan(start, this.filter, function (entry, txs) {
    return self.fire('block rescan', entry, txs);
  });
};

/*
 * Expose
 */

module.exports = NodeClient;