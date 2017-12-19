/*!
 * async.js - async object class for bcoin
 * Copyright (c) 2016-2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

var _regenerator = require('babel-runtime/regenerator');

var _regenerator2 = _interopRequireDefault(_regenerator);

var _create = require('babel-runtime/core-js/object/create');

var _create2 = _interopRequireDefault(_create);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var assert = require('assert');
var EventEmitter = require('events').EventEmitter;
var util = require('./util');
var co = require('./co');
var Lock = require('./lock');

/**
 * An abstract object that handles state and
 * provides recallable open and close methods.
 * @alias module:utils.AsyncObject
 * @constructor
 * @property {Boolean} loading
 * @property {Boolean} closing
 * @property {Boolean} loaded
 */

function AsyncObject() {
  assert(this instanceof AsyncObject);

  EventEmitter.call(this);

  this._asyncLock = new Lock();
  this._hooks = (0, _create2.default)(null);

  this.loading = false;
  this.closing = false;
  this.loaded = false;
}

util.inherits(AsyncObject, EventEmitter);

/**
 * Open the object (recallable).
 * @method
 * @returns {Promise}
 */

AsyncObject.prototype.open = co( /*#__PURE__*/_regenerator2.default.mark(function open() {
  var unlock;
  return _regenerator2.default.wrap(function open$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:
          _context.next = 2;
          return this._asyncLock.lock();

        case 2:
          unlock = _context.sent;
          _context.prev = 3;
          _context.next = 6;
          return this.__open();

        case 6:
          return _context.abrupt('return', _context.sent);

        case 7:
          _context.prev = 7;

          unlock();
          return _context.finish(7);

        case 10:
        case 'end':
          return _context.stop();
      }
    }
  }, open, this, [[3,, 7, 10]]);
}));

/**
 * Open the object (without a lock).
 * @method
 * @private
 * @returns {Promise}
 */

AsyncObject.prototype.__open = co( /*#__PURE__*/_regenerator2.default.mark(function open() {
  return _regenerator2.default.wrap(function open$(_context2) {
    while (1) {
      switch (_context2.prev = _context2.next) {
        case 0:
          if (!this.loaded) {
            _context2.next = 2;
            break;
          }

          return _context2.abrupt('return');

        case 2:
          _context2.next = 4;
          return this.fire('preopen');

        case 4:

          this.loading = true;

          _context2.prev = 5;
          _context2.next = 8;
          return this._open();

        case 8:
          _context2.next = 15;
          break;

        case 10:
          _context2.prev = 10;
          _context2.t0 = _context2['catch'](5);

          this.loading = false;
          this.emit('error', _context2.t0);
          throw _context2.t0;

        case 15:

          this.loading = false;
          this.loaded = true;

          _context2.next = 19;
          return this.fire('open');

        case 19:
        case 'end':
          return _context2.stop();
      }
    }
  }, open, this, [[5, 10]]);
}));

/**
 * Close the object (recallable).
 * @method
 * @returns {Promise}
 */

AsyncObject.prototype.close = co( /*#__PURE__*/_regenerator2.default.mark(function close() {
  var unlock;
  return _regenerator2.default.wrap(function close$(_context3) {
    while (1) {
      switch (_context3.prev = _context3.next) {
        case 0:
          _context3.next = 2;
          return this._asyncLock.lock();

        case 2:
          unlock = _context3.sent;
          _context3.prev = 3;
          _context3.next = 6;
          return this.__close();

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
  }, close, this, [[3,, 7, 10]]);
}));

/**
 * Close the object (without a lock).
 * @method
 * @private
 * @returns {Promise}
 */

AsyncObject.prototype.__close = co( /*#__PURE__*/_regenerator2.default.mark(function close() {
  return _regenerator2.default.wrap(function close$(_context4) {
    while (1) {
      switch (_context4.prev = _context4.next) {
        case 0:
          if (this.loaded) {
            _context4.next = 2;
            break;
          }

          return _context4.abrupt('return');

        case 2:
          _context4.next = 4;
          return this.fire('preclose');

        case 4:

          this.closing = true;

          _context4.prev = 5;
          _context4.next = 8;
          return this._close();

        case 8:
          _context4.next = 15;
          break;

        case 10:
          _context4.prev = 10;
          _context4.t0 = _context4['catch'](5);

          this.closing = false;
          this.emit('error', _context4.t0);
          throw _context4.t0;

        case 15:

          this.closing = false;
          this.loaded = false;

          _context4.next = 19;
          return this.fire('close');

        case 19:
        case 'end':
          return _context4.stop();
      }
    }
  }, close, this, [[5, 10]]);
}));

/**
 * Close the object (recallable).
 * @method
 * @returns {Promise}
 */

AsyncObject.prototype.destroy = AsyncObject.prototype.close;

/**
 * Initialize the object.
 * @private
 * @returns {Promise}
 */

AsyncObject.prototype._open = function _open(callback) {
  throw new Error('Abstract method.');
};

/**
 * Close the object.
 * @private
 * @returns {Promise}
 */

AsyncObject.prototype._close = function _close(callback) {
  throw new Error('Abstract method.');
};

/**
 * Add a hook listener.
 * @param {String} type
 * @param {Function} handler
 */

AsyncObject.prototype.hook = function hook(type, handler) {
  assert(typeof type === 'string', '`type` must be a string.');

  if (!this._hooks[type]) this._hooks[type] = [];

  this._hooks[type].push(handler);
};

/**
 * Emit events and hooks for type.
 * @method
 * @param {String} type
 * @param {...Object} args
 * @returns {Promise}
 */

AsyncObject.prototype.fire = co( /*#__PURE__*/_regenerator2.default.mark(function fire() {
  var _args5 = arguments;
  return _regenerator2.default.wrap(function fire$(_context5) {
    while (1) {
      switch (_context5.prev = _context5.next) {
        case 0:
          _context5.next = 2;
          return this.fireHook.apply(this, _args5);

        case 2:
          this.emit.apply(this, _args5);

        case 3:
        case 'end':
          return _context5.stop();
      }
    }
  }, fire, this);
}));

/**
 * Emit an asynchronous event (hook).
 * Wait for promises to resolve.
 * @method
 * @param {String} type
 * @param {...Object} args
 * @returns {Promise}
 */

AsyncObject.prototype.fireHook = co( /*#__PURE__*/_regenerator2.default.mark(function fireHook(type) {
  var i,
      j,
      listeners,
      args,
      handler,
      _args6 = arguments;
  return _regenerator2.default.wrap(function fireHook$(_context6) {
    while (1) {
      switch (_context6.prev = _context6.next) {
        case 0:

          assert(typeof type === 'string', '`type` must be a string.');

          listeners = this._hooks[type];

          if (!(!listeners || listeners.length === 0)) {
            _context6.next = 4;
            break;
          }

          return _context6.abrupt('return');

        case 4:
          i = 0;

        case 5:
          if (!(i < listeners.length)) {
            _context6.next = 29;
            break;
          }

          handler = listeners[i];

          _context6.t0 = _args6.length;
          _context6.next = _context6.t0 === 1 ? 10 : _context6.t0 === 2 ? 13 : _context6.t0 === 3 ? 16 : _context6.t0 === 4 ? 19 : 22;
          break;

        case 10:
          _context6.next = 12;
          return handler();

        case 12:
          return _context6.abrupt('break', 26);

        case 13:
          _context6.next = 15;
          return handler(_args6[1]);

        case 15:
          return _context6.abrupt('break', 26);

        case 16:
          _context6.next = 18;
          return handler(_args6[1], _args6[2]);

        case 18:
          return _context6.abrupt('break', 26);

        case 19:
          _context6.next = 21;
          return handler(_args6[1], _args6[2], _args6[3]);

        case 21:
          return _context6.abrupt('break', 26);

        case 22:
          if (!args) {
            args = new Array(_args6.length - 1);
            for (j = 1; j < _args6.length; j++) {
              args[j - 1] = _args6[j];
            }
          }
          _context6.next = 25;
          return handler.apply(null, args);

        case 25:
          return _context6.abrupt('break', 26);

        case 26:
          i++;
          _context6.next = 5;
          break;

        case 29:
        case 'end':
          return _context6.stop();
      }
    }
  }, fireHook, this);
}));

/*
 * Expose
 */

module.exports = AsyncObject;