/*!
 * asyncemitter.js - event emitter which resolves promises.
 * Copyright (c) 2014-2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

var _regenerator = require('babel-runtime/regenerator');

var _regenerator2 = _interopRequireDefault(_regenerator);

var _create = require('babel-runtime/core-js/object/create');

var _create2 = _interopRequireDefault(_create);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var assert = require('assert');
var co = require('./co');

/**
 * Represents a promise-resolving event emitter.
 * @alias module:utils.AsyncEmitter
 * @see EventEmitter
 * @constructor
 */

function AsyncEmitter() {
  if (!(this instanceof AsyncEmitter)) return new AsyncEmitter();

  this._events = (0, _create2.default)(null);
}

/**
 * Add a listener.
 * @param {String} type
 * @param {Function} handler
 */

AsyncEmitter.prototype.addListener = function addListener(type, handler) {
  return this._push(type, handler, false);
};

/**
 * Add a listener.
 * @param {String} type
 * @param {Function} handler
 */

AsyncEmitter.prototype.on = function on(type, handler) {
  return this.addListener(type, handler);
};

/**
 * Add a listener to execute once.
 * @param {String} type
 * @param {Function} handler
 */

AsyncEmitter.prototype.once = function once(type, handler) {
  return this._push(type, handler, true);
};

/**
 * Prepend a listener.
 * @param {String} type
 * @param {Function} handler
 */

AsyncEmitter.prototype.prependListener = function prependListener(type, handler) {
  return this._unshift(type, handler, false);
};

/**
 * Prepend a listener to execute once.
 * @param {String} type
 * @param {Function} handler
 */

AsyncEmitter.prototype.prependOnceListener = function prependOnceListener(type, handler) {
  return this._unshift(type, handler, true);
};

/**
 * Push a listener.
 * @private
 * @param {String} type
 * @param {Function} handler
 * @param {Boolean} once
 */

AsyncEmitter.prototype._push = function _push(type, handler, once) {
  assert(typeof type === 'string', '`type` must be a string.');

  if (!this._events[type]) this._events[type] = [];

  this._events[type].push(new Listener(handler, once));

  this.emit('newListener', type, handler);
};

/**
 * Unshift a listener.
 * @param {String} type
 * @param {Function} handler
 * @param {Boolean} once
 */

AsyncEmitter.prototype._unshift = function _unshift(type, handler, once) {
  assert(typeof type === 'string', '`type` must be a string.');

  if (!this._events[type]) this._events[type] = [];

  this._events[type].unshift(new Listener(handler, once));

  this.emit('newListener', type, handler);
};

/**
 * Remove a listener.
 * @param {String} type
 * @param {Function} handler
 */

AsyncEmitter.prototype.removeListener = function removeListener(type, handler) {
  var i, listeners, listener;
  var index = -1;

  assert(typeof type === 'string', '`type` must be a string.');

  listeners = this._events[type];

  if (!listeners) return;

  for (i = 0; i < listeners.length; i++) {
    listener = listeners[i];
    if (listener.handler === handler) {
      index = i;
      break;
    }
  }

  if (index === -1) return;

  listeners.splice(index, 1);

  if (listeners.length === 0) delete this._events[type];

  this.emit('removeListener', type, handler);
};

/**
 * Set max listeners.
 * @param {Number} max
 */

AsyncEmitter.prototype.setMaxListeners = function setMaxListeners(max) {
  assert(typeof max === 'number', '`max` must be a number.');
  assert(max >= 0, '`max` must be non-negative.');
  assert(max % 1 === 0, '`max` must be an integer.');
};

/**
 * Remove all listeners.
 * @param {String?} type
 */

AsyncEmitter.prototype.removeAllListeners = function removeAllListeners(type) {
  if (arguments.length === 0) {
    this._events = (0, _create2.default)(null);
    return;
  }

  assert(typeof type === 'string', '`type` must be a string.');

  delete this._events[type];
};

/**
 * Get listeners array.
 * @param {String} type
 * @returns {Function[]}
 */

AsyncEmitter.prototype.listeners = function listeners(type) {
  var i, listeners, listener;
  var result = [];

  assert(typeof type === 'string', '`type` must be a string.');

  listeners = this._events[type];

  if (!listeners) return result;

  for (i = 0; i < listeners.length; i++) {
    listener = listeners[i];
    result.push(listener.handler);
  }

  return result;
};

/**
 * Get listener count for an event.
 * @param {String} type
 */

AsyncEmitter.prototype.listenerCount = function listenerCount(type) {
  var listeners;

  assert(typeof type === 'string', '`type` must be a string.');

  listeners = this._events[type];

  if (!listeners) return 0;

  return listeners.length;
};

/**
 * Emit an event synchronously.
 * @method
 * @param {String} type
 * @param {...Object} args
 * @returns {Promise}
 */

AsyncEmitter.prototype.emit = function emit(type) {
  var i, j, listeners, error, err, args, listener, handler;

  assert(typeof type === 'string', '`type` must be a string.');

  listeners = this._events[type];

  if (!listeners || listeners.length === 0) {
    if (type === 'error') {
      error = arguments[1];

      if (error instanceof Error) throw error;

      err = new Error('Uncaught, unspecified "error" event. (' + error + ')');
      err.context = error;
      throw err;
    }
    return;
  }

  for (i = 0; i < listeners.length; i++) {
    listener = listeners[i];
    handler = listener.handler;

    if (listener.once) {
      listeners.splice(i, 1);
      i--;
    }

    switch (arguments.length) {
      case 1:
        handler();
        break;
      case 2:
        handler(arguments[1]);
        break;
      case 3:
        handler(arguments[1], arguments[2]);
        break;
      case 4:
        handler(arguments[1], arguments[2], arguments[3]);
        break;
      default:
        if (!args) {
          args = new Array(arguments.length - 1);
          for (j = 1; j < arguments.length; j++) {
            args[j - 1] = arguments[j];
          }
        }
        handler.apply(null, args);
        break;
    }
  }
};

/**
 * Emit an event. Wait for promises to resolve.
 * @method
 * @param {String} type
 * @param {...Object} args
 * @returns {Promise}
 */

AsyncEmitter.prototype.fire = co( /*#__PURE__*/_regenerator2.default.mark(function fire(type) {
  var i,
      j,
      listeners,
      error,
      err,
      args,
      listener,
      handler,
      _args = arguments;
  return _regenerator2.default.wrap(function fire$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:

          assert(typeof type === 'string', '`type` must be a string.');

          listeners = this._events[type];

          if (!(!listeners || listeners.length === 0)) {
            _context.next = 11;
            break;
          }

          if (!(type === 'error')) {
            _context.next = 10;
            break;
          }

          error = _args[1];

          if (!(error instanceof Error)) {
            _context.next = 7;
            break;
          }

          throw error;

        case 7:

          err = new Error('Uncaught, unspecified "error" event. (' + error + ')');
          err.context = error;
          throw err;

        case 10:
          return _context.abrupt('return');

        case 11:
          i = 0;

        case 12:
          if (!(i < listeners.length)) {
            _context.next = 38;
            break;
          }

          listener = listeners[i];
          handler = listener.handler;

          if (listener.once) {
            listeners.splice(i, 1);
            i--;
          }

          _context.t0 = _args.length;
          _context.next = _context.t0 === 1 ? 19 : _context.t0 === 2 ? 22 : _context.t0 === 3 ? 25 : _context.t0 === 4 ? 28 : 31;
          break;

        case 19:
          _context.next = 21;
          return handler();

        case 21:
          return _context.abrupt('break', 35);

        case 22:
          _context.next = 24;
          return handler(_args[1]);

        case 24:
          return _context.abrupt('break', 35);

        case 25:
          _context.next = 27;
          return handler(_args[1], _args[2]);

        case 27:
          return _context.abrupt('break', 35);

        case 28:
          _context.next = 30;
          return handler(_args[1], _args[2], _args[3]);

        case 30:
          return _context.abrupt('break', 35);

        case 31:
          if (!args) {
            args = new Array(_args.length - 1);
            for (j = 1; j < _args.length; j++) {
              args[j - 1] = _args[j];
            }
          }
          _context.next = 34;
          return handler.apply(null, args);

        case 34:
          return _context.abrupt('break', 35);

        case 35:
          i++;
          _context.next = 12;
          break;

        case 38:
        case 'end':
          return _context.stop();
      }
    }
  }, fire, this);
}));

/**
 * Emit an event. Ignore rejections.
 * @method
 * @param {String} type
 * @param {...Object} args
 * @returns {Promise}
 */

AsyncEmitter.prototype.tryFire = co( /*#__PURE__*/_regenerator2.default.mark(function tryFire(type) {
  var _args2 = arguments;
  return _regenerator2.default.wrap(function tryFire$(_context2) {
    while (1) {
      switch (_context2.prev = _context2.next) {
        case 0:
          _context2.prev = 0;
          _context2.next = 3;
          return this.emit.apply(this, _args2);

        case 3:
          _context2.next = 17;
          break;

        case 5:
          _context2.prev = 5;
          _context2.t0 = _context2['catch'](0);

          if (!(type === 'error')) {
            _context2.next = 9;
            break;
          }

          return _context2.abrupt('return');

        case 9:
          _context2.prev = 9;
          _context2.next = 12;
          return this.emit('error', _context2.t0);

        case 12:
          _context2.next = 17;
          break;

        case 14:
          _context2.prev = 14;
          _context2.t1 = _context2['catch'](9);

          ;

        case 17:
        case 'end':
          return _context2.stop();
      }
    }
  }, tryFire, this, [[0, 5], [9, 14]]);
}));

/**
 * Event Listener
 * @constructor
 * @ignore
 * @param {Function} handler
 * @param {Boolean} once
 * @property {Function} handler
 * @property {Boolean} once
 */

function Listener(handler, once) {
  assert(typeof handler === 'function', '`handler` must be a function.');
  assert(typeof once === 'boolean', '`once` must be a function.');
  this.handler = handler;
  this.once = once;
}

/*
 * Expose
 */

module.exports = AsyncEmitter;