/*!
 * rpcclient.js - json rpc client for bcoin
 * Copyright (c) 2014-2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

var _regenerator = require('babel-runtime/regenerator');

var _regenerator2 = _interopRequireDefault(_regenerator);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var Network = require('../protocol/network');
var request = require('./request');
var util = require('../utils/util');
var co = require('../utils/co');

/**
 * Bcoin RPC client.
 * @alias module:http.RPCClient
 * @constructor
 * @param {String} uri
 * @param {Object?} options
 */

function RPCClient(options) {
  if (!(this instanceof RPCClient)) return new RPCClient(options);

  if (!options) options = {};

  if (typeof options === 'string') options = { uri: options };

  this.options = options;
  this.network = Network.get(options.network);

  this.uri = options.uri || 'http://localhost:' + this.network.rpcPort;
  this.apiKey = options.apiKey;
  this.id = 0;
}

/**
 * Make a json rpc request.
 * @private
 * @param {String} method - RPC method name.
 * @param {Array} params - RPC parameters.
 * @returns {Promise} - Returns Object?.
 */

RPCClient.prototype.execute = co( /*#__PURE__*/_regenerator2.default.mark(function execute(method, params) {
  var res;
  return _regenerator2.default.wrap(function execute$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:
          _context.next = 2;
          return request({
            method: 'POST',
            uri: this.uri,
            pool: true,
            json: {
              method: method,
              params: params,
              id: this.id++
            },
            auth: {
              username: 'bitcoinrpc',
              password: this.apiKey || ''
            }
          });

        case 2:
          res = _context.sent;

          if (!(res.statusCode === 401)) {
            _context.next = 5;
            break;
          }

          throw new RPCError('Unauthorized (bad API key).', -1);

        case 5:
          if (!(res.statusCode !== 200)) {
            _context.next = 7;
            break;
          }

          throw new Error('Status code: ' + res.statusCode);

        case 7:
          if (!(res.type !== 'json')) {
            _context.next = 9;
            break;
          }

          throw new Error('Bad response (wrong content-type).');

        case 9:
          if (res.body) {
            _context.next = 11;
            break;
          }

          throw new Error('No body for JSON-RPC response.');

        case 11:
          if (!res.body.error) {
            _context.next = 13;
            break;
          }

          throw new RPCError(res.body.error.message, res.body.error.code);

        case 13:
          return _context.abrupt('return', res.body.result);

        case 14:
        case 'end':
          return _context.stop();
      }
    }
  }, execute, this);
}));

/*
 * Helpers
 */

function RPCError(msg, code) {
  Error.call(this);

  if (Error.captureStackTrace) Error.captureStackTrace(this, RPCError);

  this.type = 'RPCError';
  this.message = msg + '';
  this.code = code >>> 0;
}

util.inherits(RPCError, Error);

/*
 * Expose
 */

module.exports = RPCClient;