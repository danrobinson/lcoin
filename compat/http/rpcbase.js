/*!
 * rpcbase.js - json rpc for bcoin.
 * Copyright (c) 2014-2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

var _regenerator = require('babel-runtime/regenerator');

var _regenerator2 = _interopRequireDefault(_regenerator);

var _typeof2 = require('babel-runtime/helpers/typeof');

var _typeof3 = _interopRequireDefault(_typeof2);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var assert = require('assert');
var EventEmitter = require('events').EventEmitter;
var util = require('../utils/util');
var co = require('../utils/co');
var Lock = require('../utils/lock');
var Logger = require('../node/logger');

/**
 * JSON RPC
 * @alias module:http.RPCBase
 * @constructor
 */

function RPCBase() {
  if (!(this instanceof RPCBase)) return new RPCBase();

  EventEmitter.call(this);

  this.logger = Logger.global;
  this.calls = {};
  this.mounts = [];
  this.locker = new Lock();
}

util.inherits(RPCBase, EventEmitter);

/**
 * RPC errors.
 * @enum {Number}
 * @default
 */

RPCBase.errors = {
  // Standard JSON-RPC 2.0 errors
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  PARSE_ERROR: -32700,

  // General application defined errors
  MISC_ERROR: -1,
  FORBIDDEN_BY_SAFE_MODE: -2,
  TYPE_ERROR: -3,
  INVALID_ADDRESS_OR_KEY: -5,
  OUT_OF_MEMORY: -7,
  INVALID_PARAMETER: -8,
  DATABASE_ERROR: -20,
  DESERIALIZATION_ERROR: -22,
  VERIFY_ERROR: -25,
  VERIFY_REJECTED: -26,
  VERIFY_ALREADY_IN_CHAIN: -27,
  IN_WARMUP: -28,

  // Aliases for backward compatibility
  TRANSACTION_ERROR: -25,
  TRANSACTION_REJECTED: -26,
  TRANSACTION_ALREADY_IN_CHAIN: -27,

  // P2P client errors
  CLIENT_NOT_CONNECTED: -9,
  CLIENT_IN_INITIAL_DOWNLOAD: -10,
  CLIENT_NODE_ALREADY_ADDED: -23,
  CLIENT_NODE_NOT_ADDED: -24,
  CLIENT_NODE_NOT_CONNECTED: -29,
  CLIENT_INVALID_IP_OR_SUBNET: -30,
  CLIENT_P2P_DISABLED: -31,

  // Wallet errors
  WALLET_ERROR: -4,
  WALLET_INSUFFICIENT_FUNDS: -6,
  WALLET_INVALID_ACCOUNT_NAME: -11,
  WALLET_KEYPOOL_RAN_OUT: -12,
  WALLET_UNLOCK_NEEDED: -13,
  WALLET_PASSPHRASE_INCORRECT: -14,
  WALLET_WRONG_ENC_STATE: -15,
  WALLET_ENCRYPTION_FAILED: -16,
  WALLET_ALREADY_UNLOCKED: -17
};

/**
 * Magic string for signing.
 * @const {String}
 * @default
 */

RPCBase.MAGIC_STRING = 'Bitcoin Signed Message:\n';

/**
 * Execute batched RPC calls.
 * @param {Object|Object[]} body
 * @param {Object} query
 * @returns {Promise}
 */

RPCBase.prototype.call = co( /*#__PURE__*/_regenerator2.default.mark(function call(body, query) {
  var cmds, out, array, i, cmd, result, code;
  return _regenerator2.default.wrap(function call$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:
          cmds = body;
          out = [];
          array = true;


          if (!Array.isArray(cmds)) {
            cmds = [cmds];
            array = false;
          }

          i = 0;

        case 5:
          if (!(i < cmds.length)) {
            _context.next = 53;
            break;
          }

          cmd = cmds[i];

          if (!(!cmd || (typeof cmd === 'undefined' ? 'undefined' : (0, _typeof3.default)(cmd)) !== 'object')) {
            _context.next = 10;
            break;
          }

          out.push({
            result: null,
            error: {
              message: 'Invalid request.',
              code: RPCBase.errors.INVALID_REQUEST
            },
            id: null
          });
          return _context.abrupt('continue', 50);

        case 10:
          if (!(cmd.id && (0, _typeof3.default)(cmd.id) === 'object')) {
            _context.next = 13;
            break;
          }

          out.push({
            result: null,
            error: {
              message: 'Invalid ID.',
              code: RPCBase.errors.INVALID_REQUEST
            },
            id: null
          });
          return _context.abrupt('continue', 50);

        case 13:

          if (cmd.id == null) cmd.id = null;

          if (!cmd.params) cmd.params = [];

          if (!(typeof cmd.method !== 'string')) {
            _context.next = 18;
            break;
          }

          out.push({
            result: null,
            error: {
              message: 'Method not found.',
              code: RPCBase.errors.METHOD_NOT_FOUND
            },
            id: cmd.id
          });
          return _context.abrupt('continue', 50);

        case 18:
          if (Array.isArray(cmd.params)) {
            _context.next = 21;
            break;
          }

          out.push({
            result: null,
            error: {
              message: 'Invalid params.',
              code: RPCBase.errors.INVALID_PARAMS
            },
            id: cmd.id
          });
          return _context.abrupt('continue', 50);

        case 21:

          if (cmd.method !== 'getwork' && cmd.method !== 'getblocktemplate' && cmd.method !== 'getbestblockhash') {
            this.logger.debug('Handling RPC call: %s.', cmd.method);
            if (cmd.method !== 'submitblock' && cmd.method !== 'getmemorypool') {
              this.logger.debug(cmd.params);
            }
          }

          if (cmd.method === 'getwork') {
            if (query.longpoll) cmd.method = 'getworklp';
          }

          _context.prev = 23;
          _context.next = 26;
          return this.execute(cmd);

        case 26:
          result = _context.sent;
          _context.next = 48;
          break;

        case 29:
          _context.prev = 29;
          _context.t0 = _context['catch'](23);
          _context.t1 = _context.t0.type;
          _context.next = _context.t1 === 'RPCError' ? 34 : _context.t1 === 'ValidationError' ? 36 : _context.t1 === 'EncodingError' ? 38 : _context.t1 === 'FundingError' ? 40 : 42;
          break;

        case 34:
          code = _context.t0.code;
          return _context.abrupt('break', 46);

        case 36:
          code = RPCBase.errors.TYPE_ERROR;
          return _context.abrupt('break', 46);

        case 38:
          code = RPCBase.errors.DESERIALIZATION_ERROR;
          return _context.abrupt('break', 46);

        case 40:
          code = RPCBase.errors.WALLET_INSUFFICIENT_FUNDS;
          return _context.abrupt('break', 46);

        case 42:
          code = RPCBase.errors.INTERNAL_ERROR;
          this.logger.error('RPC internal error.');
          this.logger.error(_context.t0);
          return _context.abrupt('break', 46);

        case 46:

          out.push({
            result: null,
            error: {
              message: _context.t0.message,
              code: code
            },
            id: cmd.id
          });

          return _context.abrupt('continue', 50);

        case 48:

          if (result === undefined) result = null;

          out.push({
            result: result,
            error: null,
            id: cmd.id
          });

        case 50:
          i++;
          _context.next = 5;
          break;

        case 53:

          if (!array) out = out[0];

          return _context.abrupt('return', out);

        case 55:
        case 'end':
          return _context.stop();
      }
    }
  }, call, this, [[23, 29]]);
}));

/**
 * Execute an RPC call.
 * @private
 * @param {Object} json
 * @param {Boolean} help
 * @returns {Promise}
 */

RPCBase.prototype.execute = co( /*#__PURE__*/_regenerator2.default.mark(function execute(json, help) {
  var func, i, mount;
  return _regenerator2.default.wrap(function execute$(_context2) {
    while (1) {
      switch (_context2.prev = _context2.next) {
        case 0:
          func = this.calls[json.method];

          if (func) {
            _context2.next = 13;
            break;
          }

          i = 0;

        case 3:
          if (!(i < this.mounts.length)) {
            _context2.next = 12;
            break;
          }

          mount = this.mounts[i];

          if (!mount.calls[json.method]) {
            _context2.next = 9;
            break;
          }

          _context2.next = 8;
          return mount.execute(json, help);

        case 8:
          return _context2.abrupt('return', _context2.sent);

        case 9:
          i++;
          _context2.next = 3;
          break;

        case 12:
          throw new RPCError(RPCBase.errors.METHOD_NOT_FOUND, 'Method not found: ' + json.method + '.');

        case 13:
          _context2.next = 15;
          return func.call(this, json.params, help);

        case 15:
          return _context2.abrupt('return', _context2.sent);

        case 16:
        case 'end':
          return _context2.stop();
      }
    }
  }, execute, this);
}));

/**
 * Add a custom RPC call.
 * @param {String} name
 * @param {Function} func
 */

RPCBase.prototype.add = function add(name, func) {
  assert(typeof func === 'function', 'Handler must be a function.');
  assert(!this.calls[name], 'Duplicate RPC call.');
  this.calls[name] = func;
};

/**
 * Mount another RPC object.
 * @param {Object} rpc
 */

RPCBase.prototype.mount = function mount(rpc) {
  assert(rpc, 'RPC must be an object.');
  assert(typeof rpc.execute === 'function', 'Execute must be a method.');
  this.mounts.push(rpc);
};

/**
 * Attach to another RPC object.
 * @param {Object} rpc
 */

RPCBase.prototype.attach = function attach(rpc) {
  assert(rpc, 'RPC must be an object.');
  assert(typeof rpc.execute === 'function', 'Execute must be a method.');
  rpc.mount(this);
};

/**
 * RPC Error
 * @constructor
 * @ignore
 */

function RPCError(code, msg) {
  Error.call(this);

  if (Error.captureStackTrace) Error.captureStackTrace(this, RPCError);

  assert(typeof code === 'number');
  assert(typeof msg === 'string');

  this.type = 'RPCError';
  this.message = msg;
  this.code = code;
}

util.inherits(RPCError, Error);

/*
 * Expose
 */

exports = RPCBase;
exports.RPCError = RPCError;

module.exports = exports;