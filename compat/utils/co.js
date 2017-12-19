/*!
 * co.js - promise and generator control flow for bcoin
 * Originally based on yoursnetwork's "asink" module.
 * Copyright (c) 2014-2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

/**
 * @module utils/co
 */

var _regenerator = require('babel-runtime/regenerator');

var _regenerator2 = _interopRequireDefault(_regenerator);

var _promise = require('babel-runtime/core-js/promise');

var _promise2 = _interopRequireDefault(_promise);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var assert = require('assert');
var nextTick = require('./nexttick');
var every;

/**
 * Execute an instantiated generator.
 * @param {Generator} gen
 * @returns {Promise}
 */

function exec(gen) {
  return new _promise2.default(function (resolve, reject) {
    function step(value, rejection) {
      var next;

      try {
        if (rejection) next = gen.throw(value);else next = gen.next(value);
      } catch (e) {
        reject(e);
        return;
      }

      if (next.done) {
        resolve(next.value);
        return;
      }

      if (!isPromise(next.value)) {
        step(next.value, false);
        return;
      }

      next.value.then(succeed, fail);
    }

    function succeed(value) {
      step(value, false);
    }

    function fail(value) {
      step(value, true);
    }

    step(undefined, false);
  });
}

/**
 * Execute generator function
 * with a context and execute.
 * @param {GeneratorFunction} generator
 * @param {Object} ctx
 * @returns {Promise}
 */

function spawn(generator, ctx) {
  var gen = generator.call(ctx);
  return exec(gen);
}

/**
 * Wrap a generator function to be
 * executed into a function that
 * returns a promise.
 * @param {GeneratorFunction}
 * @returns {Function}
 */

function co(generator) {
  return function () {
    var gen = generator.apply(this, arguments);
    return exec(gen);
  };
}

/**
 * Test whether an object is a promise.
 * @param {Object} obj
 * @returns {Boolean}
 */

function isPromise(obj) {
  return obj && typeof obj.then === 'function';
}

/**
 * Wrap a generator function to be
 * executed into a function that
 * accepts a node.js style callback.
 * @param {GeneratorFunction}
 * @returns {Function}
 */

function cob(generator) {
  return function (_) {
    var i, args, callback, gen;

    if (arguments.length === 0 || typeof arguments[arguments.length - 1] !== 'function') {
      throw new Error((generator.name || 'Function') + ' requires a callback.');
    }

    args = new Array(arguments.length - 1);
    callback = arguments[arguments.length - 1];

    for (i = 0; i < args.length; i++) {
      args[i] = arguments[i];
    }gen = generator.apply(this, args);

    exec(gen).then(function (value) {
      nextTick(function () {
        callback(null, value);
      });
    }, function (err) {
      nextTick(function () {
        callback(err);
      });
    });
  };
}

/**
 * Wait for a nextTick with a promise.
 * @returns {Promise}
 */

function wait() {
  return new _promise2.default(tick);
};

/**
 * Wait for a nextTick.
 * @private
 * @param {Function} resolve
 * @param {Function} reject
 */

function tick(resolve, reject) {
  nextTick(resolve);
}

/**
 * Wait for a timeout with a promise.
 * @param {Number} time
 * @returns {Promise}
 */

function timeout(time) {
  return new _promise2.default(function (resolve, reject) {
    setTimeout(resolve, time);
  });
}

/**
 * Wrap `resolve` and `reject` into
 * a node.js style callback.
 * @param {Function} resolve
 * @param {Function} reject
 * @returns {Function}
 */

function wrap(resolve, reject) {
  return function (err, result) {
    if (err) {
      reject(err);
      return;
    }
    resolve(result);
  };
}

/**
 * Wrap a function that accepts node.js
 * style callbacks into a function that
 * returns a promise.
 * @param {Function} func
 * @param {Object?} ctx
 * @returns {Function}
 */

function promisify(func, ctx) {
  return function () {
    var self = this;
    var args = new Array(arguments.length);
    var i;

    for (i = 0; i < arguments.length; i++) {
      args[i] = arguments[i];
    }return new _promise2.default(function (resolve, reject) {
      args.push(wrap(resolve, reject));
      func.apply(ctx || self, args);
    });
  };
}

/**
 * Execute each promise and
 * have them pass a truth test.
 * @method
 * @param {Promise[]} jobs
 * @returns {Promise}
 */

every = co( /*#__PURE__*/_regenerator2.default.mark(function every(jobs) {
  var result, i;
  return _regenerator2.default.wrap(function every$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:
          _context.next = 2;
          return _promise2.default.all(jobs);

        case 2:
          result = _context.sent;
          i = 0;

        case 4:
          if (!(i < result.length)) {
            _context.next = 10;
            break;
          }

          if (result[i]) {
            _context.next = 7;
            break;
          }

          return _context.abrupt('return', false);

        case 7:
          i++;
          _context.next = 4;
          break;

        case 10:
          return _context.abrupt('return', true);

        case 11:
        case 'end':
          return _context.stop();
      }
    }
  }, every, this);
}));

/**
 * Start an interval. Wait for promise
 * to resolve on each iteration.
 * @param {Function} func
 * @param {Number?} time
 * @param {Object?} self
 * @returns {Object}
 */

function startInterval(func, time, self) {
  var cb, ctx;

  ctx = {
    timer: null,
    stopped: false
  };

  cb = co( /*#__PURE__*/_regenerator2.default.mark(function _callee() {
    return _regenerator2.default.wrap(function _callee$(_context2) {
      while (1) {
        switch (_context2.prev = _context2.next) {
          case 0:
            assert(ctx.timer != null);
            ctx.timer = null;

            _context2.prev = 2;
            _context2.next = 5;
            return func.call(self);

          case 5:
            _context2.prev = 5;

            if (!ctx.stopped) ctx.timer = setTimeout(cb, time);
            return _context2.finish(5);

          case 8:
          case 'end':
            return _context2.stop();
        }
      }
    }, _callee, this, [[2,, 5, 8]]);
  }));

  ctx.timer = setTimeout(cb, time);

  return ctx;
}

/**
 * Clear an interval.
 * @param {Object} ctx
 */

function stopInterval(ctx) {
  assert(ctx);
  if (ctx.timer != null) {
    clearTimeout(ctx.timer);
    ctx.timer = null;
  }
  ctx.stopped = true;
}

/**
 * Start a timeout.
 * @param {Function} func
 * @param {Number?} time
 * @param {Object?} self
 * @returns {Object}
 */

function startTimeout(func, time, self) {
  return {
    timer: setTimeout(func.bind(self), time),
    stopped: false
  };
}

/**
 * Clear a timeout.
 * @param {Object} ctx
 */

function stopTimeout(ctx) {
  assert(ctx);
  if (ctx.timer != null) {
    clearTimeout(ctx.timer);
    ctx.timer = null;
  }
  ctx.stopped = true;
}

/**
 * Create a job object.
 * @returns {Job}
 */

function job(resolve, reject) {
  return new Job(resolve, reject);
}

/**
 * Job
 * @constructor
 * @ignore
 * @param {Function} resolve
 * @param {Function} reject
 * @property {Function} resolve
 * @property {Function} reject
 */

function Job(resolve, reject) {
  this.resolve = resolve;
  this.reject = reject;
}

/*
 * This drives me nuts.
 */

if (typeof window !== 'undefined' && window) {
  window.onunhandledrejection = function (event) {
    throw event.reason;
  };
} else if (typeof process !== 'undefined' && process) {
  process.on('unhandledRejection', function (err, promise) {
    throw err;
  });
}

/*
 * Expose
 */

exports = co;
exports.exec = exec;
exports.spawn = spawn;
exports.co = co;
exports.cob = cob;
exports.wait = wait;
exports.timeout = timeout;
exports.wrap = wrap;
exports.promisify = promisify;
exports.every = every;
exports.setInterval = startInterval;
exports.clearInterval = stopInterval;
exports.setTimeout = startTimeout;
exports.clearTimeout = stopTimeout;
exports.job = job;

module.exports = exports;