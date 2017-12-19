/*!
 * logger.js - basic logger for bcoin
 * Copyright (c) 2014-2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

var _promise = require('babel-runtime/core-js/promise');

var _promise2 = _interopRequireDefault(_promise);

var _typeof2 = require('babel-runtime/helpers/typeof');

var _typeof3 = _interopRequireDefault(_typeof2);

var _regenerator = require('babel-runtime/regenerator');

var _regenerator2 = _interopRequireDefault(_regenerator);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var assert = require('assert');
var fs = require('../utils/fs');
var util = require('../utils/util');
var co = require('../utils/co');
var Lock = require('../utils/lock');

/**
 * Basic stdout and file logger.
 * @alias module:node.Logger
 * @constructor
 * @param {(String|Object)?} options/level
 * @param {String?} options.level
 * @param {Boolean} [options.colors=true]
 */

function Logger(options) {
  if (!(this instanceof Logger)) return new Logger(options);

  this.level = Logger.levels.NONE;
  this.colors = Logger.HAS_TTY;
  this.console = true;
  this.shrink = true;
  this.closed = true;
  this.closing = false;
  this.filename = null;
  this.stream = null;
  this.contexts = {};
  this.locker = new Lock();

  if (options) this.set(options);
}

/**
 * Whether stdout is a tty FD.
 * @const {Boolean}
 */

Logger.HAS_TTY = !!(process.stdout && process.stdout.isTTY);

/**
 * Maximum file size.
 * @const {Number}
 * @default
 */

Logger.MAX_FILE_SIZE = 20 << 20;

/**
 * Available log levels.
 * @enum {Number}
 */

Logger.levels = {
  NONE: 0,
  ERROR: 1,
  WARNING: 2,
  INFO: 3,
  DEBUG: 4,
  SPAM: 5
};

/**
 * Available log levels.
 * @const {String[]}
 * @default
 */

Logger.levelsByVal = ['none', 'error', 'warning', 'info', 'debug', 'spam'];

/**
 * Available log levels.
 * @const {String[]}
 * @default
 */

Logger.prefixByVal = ['N', 'E', 'W', 'I', 'D', 'S'];

/**
 * Default CSI colors.
 * @const {String[]}
 * @default
 */

Logger.styles = ['0', '1;31', '1;33', '94', '90', '90'];

/**
 * Set logger options.
 * @param {Object} options
 */

Logger.prototype.set = function set(options) {
  assert(options);
  assert(this.closed);

  if (typeof options === 'string') {
    this.setLevel(options);
    return;
  }

  if (options.level != null) {
    assert(typeof options.level === 'string');
    this.setLevel(options.level);
  }

  if (options.colors != null && Logger.HAS_TTY) {
    assert(typeof options.colors === 'boolean');
    this.colors = options.colors;
  }

  if (options.console != null) {
    assert(typeof options.console === 'boolean');
    this.console = options.console;
  }

  if (options.shrink != null) {
    assert(typeof options.shrink === 'boolean');
    this.shrink = options.shrink;
  }

  if (options.filename != null) {
    assert(typeof options.filename === 'string', 'Bad file.');
    this.filename = options.filename;
  }
};

/**
 * Open the logger.
 * @method
 * @returns {Promise}
 */

Logger.prototype.open = co( /*#__PURE__*/_regenerator2.default.mark(function open() {
  var unlock;
  return _regenerator2.default.wrap(function open$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:
          _context.next = 2;
          return this.locker.lock();

        case 2:
          unlock = _context.sent;
          _context.prev = 3;
          _context.next = 6;
          return this._open();

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
 * Open the logger (no lock).
 * @method
 * @returns {Promise}
 */

Logger.prototype._open = co( /*#__PURE__*/_regenerator2.default.mark(function open() {
  return _regenerator2.default.wrap(function open$(_context2) {
    while (1) {
      switch (_context2.prev = _context2.next) {
        case 0:
          if (this.filename) {
            _context2.next = 3;
            break;
          }

          this.closed = false;
          return _context2.abrupt('return');

        case 3:
          if (!this.stream) {
            _context2.next = 6;
            break;
          }

          this.closed = false;
          return _context2.abrupt('return');

        case 6:
          if (!fs.unsupported) {
            _context2.next = 9;
            break;
          }

          this.closed = false;
          return _context2.abrupt('return');

        case 9:
          if (!this.shrink) {
            _context2.next = 12;
            break;
          }

          _context2.next = 12;
          return this.truncate();

        case 12:
          _context2.next = 14;
          return openStream(this.filename);

        case 14:
          this.stream = _context2.sent;

          this.stream.once('error', this.handleError.bind(this));
          this.closed = false;

        case 17:
        case 'end':
          return _context2.stop();
      }
    }
  }, open, this);
}));

/**
 * Destroy the write stream.
 * @method
 * @returns {Promise}
 */

Logger.prototype.close = co( /*#__PURE__*/_regenerator2.default.mark(function close() {
  var unlock;
  return _regenerator2.default.wrap(function close$(_context3) {
    while (1) {
      switch (_context3.prev = _context3.next) {
        case 0:
          _context3.next = 2;
          return this.locker.lock();

        case 2:
          unlock = _context3.sent;
          _context3.prev = 3;
          _context3.next = 6;
          return this._close();

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
 * Destroy the write stream (no lock).
 * @method
 * @returns {Promise}
 */

Logger.prototype._close = co( /*#__PURE__*/_regenerator2.default.mark(function close() {
  return _regenerator2.default.wrap(function close$(_context4) {
    while (1) {
      switch (_context4.prev = _context4.next) {
        case 0:
          if (this.timer != null) {
            co.clearTimeout(this.timer);
            this.timer = null;
          }

          if (!fs.unsupported) {
            _context4.next = 5;
            break;
          }

          this.closed = true;
          this.stream = null;
          return _context4.abrupt('return');

        case 5:
          if (!this.stream) {
            _context4.next = 14;
            break;
          }

          _context4.prev = 6;

          this.closing = true;
          _context4.next = 10;
          return closeStream(this.stream);

        case 10:
          _context4.prev = 10;

          this.closing = false;
          return _context4.finish(10);

        case 13:
          this.stream = null;

        case 14:

          this.closed = true;

        case 15:
        case 'end':
          return _context4.stop();
      }
    }
  }, close, this, [[6,, 10, 13]]);
}));

/**
 * Truncate the log file to the last 20mb.
 * @method
 * @private
 * @returns {Promise}
 */

Logger.prototype.truncate = co( /*#__PURE__*/_regenerator2.default.mark(function truncate() {
  var maxSize, stat, data, fd;
  return _regenerator2.default.wrap(function truncate$(_context5) {
    while (1) {
      switch (_context5.prev = _context5.next) {
        case 0:
          maxSize = Logger.MAX_FILE_SIZE;

          if (this.filename) {
            _context5.next = 3;
            break;
          }

          return _context5.abrupt('return');

        case 3:
          if (!fs.unsupported) {
            _context5.next = 5;
            break;
          }

          return _context5.abrupt('return');

        case 5:

          assert(!this.stream);

          _context5.prev = 6;
          _context5.next = 9;
          return fs.stat(this.filename);

        case 9:
          stat = _context5.sent;
          _context5.next = 17;
          break;

        case 12:
          _context5.prev = 12;
          _context5.t0 = _context5['catch'](6);

          if (!(_context5.t0.code === 'ENOENT')) {
            _context5.next = 16;
            break;
          }

          return _context5.abrupt('return');

        case 16:
          throw _context5.t0;

        case 17:
          if (!(stat.size <= maxSize + maxSize / 10)) {
            _context5.next = 19;
            break;
          }

          return _context5.abrupt('return');

        case 19:

          this.debug('Truncating log file to %d bytes.', maxSize);

          _context5.next = 22;
          return fs.open(this.filename, 'r+');

        case 22:
          fd = _context5.sent;


          data = Buffer.allocUnsafe(maxSize);
          _context5.next = 26;
          return fs.read(fd, data, 0, maxSize, stat.size - maxSize);

        case 26:
          _context5.next = 28;
          return fs.ftruncate(fd, maxSize);

        case 28:
          _context5.next = 30;
          return fs.write(fd, data, 0, maxSize, 0);

        case 30:
          _context5.next = 32;
          return fs.close(fd);

        case 32:
        case 'end':
          return _context5.stop();
      }
    }
  }, truncate, this, [[6, 12]]);
}));

/**
 * Handle write stream error.
 * @param {Error} err
 */

Logger.prototype.handleError = function handleError(err) {
  try {
    this.stream.close();
  } catch (e) {
    ;
  }

  this.stream = null;
  this.retry();
};

/**
 * Try to reopen the logger.
 * @method
 * @private
 * @returns {Promise}
 */

Logger.prototype.reopen = co( /*#__PURE__*/_regenerator2.default.mark(function reopen() {
  var unlock;
  return _regenerator2.default.wrap(function reopen$(_context6) {
    while (1) {
      switch (_context6.prev = _context6.next) {
        case 0:
          _context6.next = 2;
          return this.locker.lock();

        case 2:
          unlock = _context6.sent;
          _context6.prev = 3;
          _context6.next = 6;
          return this._reopen();

        case 6:
          return _context6.abrupt('return', _context6.sent);

        case 7:
          _context6.prev = 7;

          unlock();
          return _context6.finish(7);

        case 10:
        case 'end':
          return _context6.stop();
      }
    }
  }, reopen, this, [[3,, 7, 10]]);
}));

/**
 * Try to reopen the logger (no lock).
 * @method
 * @private
 * @returns {Promise}
 */

Logger.prototype._reopen = co( /*#__PURE__*/_regenerator2.default.mark(function reopen() {
  return _regenerator2.default.wrap(function reopen$(_context7) {
    while (1) {
      switch (_context7.prev = _context7.next) {
        case 0:
          if (!this.stream) {
            _context7.next = 2;
            break;
          }

          return _context7.abrupt('return');

        case 2:
          if (!this.closed) {
            _context7.next = 4;
            break;
          }

          return _context7.abrupt('return');

        case 4:
          if (!fs.unsupported) {
            _context7.next = 6;
            break;
          }

          return _context7.abrupt('return');

        case 6:
          _context7.prev = 6;
          _context7.next = 9;
          return openStream(this.filename);

        case 9:
          this.stream = _context7.sent;
          _context7.next = 16;
          break;

        case 12:
          _context7.prev = 12;
          _context7.t0 = _context7['catch'](6);

          this.retry();
          return _context7.abrupt('return');

        case 16:

          this.stream.once('error', this.handleError.bind(this));

        case 17:
        case 'end':
          return _context7.stop();
      }
    }
  }, reopen, this, [[6, 12]]);
}));

/**
 * Try to reopen the logger after a timeout.
 * @method
 * @private
 * @returns {Promise}
 */

Logger.prototype.retry = /*#__PURE__*/_regenerator2.default.mark(function retry() {
  return _regenerator2.default.wrap(function retry$(_context8) {
    while (1) {
      switch (_context8.prev = _context8.next) {
        case 0:
          assert(this.timer == null);
          this.timer = co.setTimeout(function () {
            this.timer = null;
            this.reopen();
          }, 10000, this);

        case 2:
        case 'end':
          return _context8.stop();
      }
    }
  }, retry, this);
});

/**
 * Set the log file location.
 * @param {String} filename
 */

Logger.prototype.setFile = function setFile(filename) {
  assert(typeof filename === 'string');
  assert(!this.stream, 'Log stream has already been created.');
  this.filename = filename;
};

/**
 * Set or reset the log level.
 * @param {String} level
 */

Logger.prototype.setLevel = function setLevel(name) {
  var level = Logger.levels[name.toUpperCase()];
  assert(level != null, 'Invalid log level.');
  this.level = level;
};

/**
 * Output a log to the `error` log level.
 * @param {String|Object|Error} err
 * @param {...Object} args
 */

Logger.prototype.error = function error(err) {
  var i, args;

  if (this.level < Logger.levels.ERROR) return;

  if (err instanceof Error) return this.logError(Logger.levels.ERROR, null, err);

  args = new Array(arguments.length);

  for (i = 0; i < args.length; i++) {
    args[i] = arguments[i];
  }this.log(Logger.levels.ERROR, null, args);
};

/**
 * Output a log to the `warning` log level.
 * @param {String|Object} obj
 * @param {...Object} args
 */

Logger.prototype.warning = function warning(err) {
  var i, args;

  if (this.level < Logger.levels.WARNING) return;

  if (err instanceof Error) return this.logError(Logger.levels.WARNING, null, err);

  args = new Array(arguments.length);

  for (i = 0; i < args.length; i++) {
    args[i] = arguments[i];
  }this.log(Logger.levels.WARNING, null, args);
};

/**
 * Output a log to the `info` log level.
 * @param {String|Object} obj
 * @param {...Object} args
 */

Logger.prototype.info = function info(err) {
  var i, args;

  if (this.level < Logger.levels.INFO) return;

  if (err instanceof Error) return this.logError(Logger.levels.INFO, null, err);

  args = new Array(arguments.length);

  for (i = 0; i < args.length; i++) {
    args[i] = arguments[i];
  }this.log(Logger.levels.INFO, null, args);
};

/**
 * Output a log to the `debug` log level.
 * @param {String|Object} obj
 * @param {...Object} args
 */

Logger.prototype.debug = function debug(err) {
  var i, args;

  if (this.level < Logger.levels.DEBUG) return;

  if (err instanceof Error) return this.logError(Logger.levels.DEBUG, null, err);

  args = new Array(arguments.length);

  for (i = 0; i < args.length; i++) {
    args[i] = arguments[i];
  }this.log(Logger.levels.DEBUG, null, args);
};

/**
 * Output a log to the `spam` log level.
 * @param {String|Object} obj
 * @param {...Object} args
 */

Logger.prototype.spam = function spam(err) {
  var i, args;

  if (this.level < Logger.levels.SPAM) return;

  if (err instanceof Error) return this.logError(Logger.levels.SPAM, null, err);

  args = new Array(arguments.length);

  for (i = 0; i < args.length; i++) {
    args[i] = arguments[i];
  }this.log(Logger.levels.SPAM, null, args);
};

/**
 * Output a log to the desired log level.
 * Note that this bypasses the level check.
 * @param {String} level
 * @param {String|null} module
 * @param {Object[]} args
 */

Logger.prototype.log = function log(level, module, args) {
  if (this.closed) return;

  if (this.level < level) return;

  this.writeConsole(level, module, args);
  this.writeStream(level, module, args);
};

/**
 * Create logger context.
 * @param {String} module
 * @returns {LoggerContext}
 */

Logger.prototype.context = function context(module) {
  var context = this.contexts[module];

  if (!context) {
    context = new LoggerContext(this, module);
    this.contexts[module] = context;
  }

  return context;
};

/**
 * Write log to the console.
 * @param {String} level
 * @param {String|null} module
 * @param {Object[]} args
 */

Logger.prototype.writeConsole = function writeConsole(level, module, args) {
  var name = Logger.levelsByVal[level];
  var msg = '';
  var color;

  assert(name, 'Invalid log level.');

  if (!this.console) return;

  if (!process.stdout) {
    msg += '[' + name + '] ';

    if (module) msg += '(' + module + ') ';

    if ((0, _typeof3.default)(args[0]) === 'object') {
      return level === Logger.levels.ERROR ? console.error(msg, args[0]) : console.log(msg, args[0]);
    }

    msg += util.format(args, false);

    return level === Logger.levels.ERROR ? console.error(msg) : console.log(msg);
  }

  if (this.colors) {
    color = Logger.styles[level];
    assert(color);

    msg += '\x1b[' + color + 'm';
    msg += '[' + name + ']';
    msg += '\x1b[m ';
  } else {
    msg += '[' + name + '] ';
  }

  if (module) msg += '(' + module + ') ';

  msg += util.format(args, this.colors);
  msg += '\n';

  return level === Logger.levels.ERROR ? process.stderr.write(msg) : process.stdout.write(msg);
};

/**
 * Write a string to the output stream (usually a file).
 * @param {String} level
 * @param {String|null} module
 * @param {Object[]} args
 */

Logger.prototype.writeStream = function writeStream(level, module, args) {
  var name = Logger.prefixByVal[level];
  var msg = '';

  assert(name, 'Invalid log level.');

  if (!this.stream) return;

  if (this.closing) return;

  msg += '[';
  msg += name;
  msg += ':' + util.date();
  msg += '] ';

  if (module) msg += '(' + module + ') ';

  msg += util.format(args, false);
  msg += '\n';

  this.stream.write(msg);
};

/**
 * Helper to parse an error into a nicer
 * format. Call's `log` internally.
 * @private
 * @param {Number} level
 * @param {String|null} module
 * @param {Error} err
 */

Logger.prototype.logError = function logError(level, module, err) {
  var msg;

  if (this.closed) return;

  if (fs.unsupported && this.console) {
    if (level <= Logger.levels.WARNING) console.error(err);
  }

  msg = (err.message + '').replace(/^ *Error: */, '');

  if (level !== Logger.levels.ERROR) msg = 'Error: ' + msg;

  this.log(level, module, [msg]);

  if (level <= Logger.levels.WARNING) {
    if (this.stream) this.stream.write(err.stack + '\n');
  }
};

/**
 * Log the current memory usage.
 * @param {String|null} module
 */

Logger.prototype.memory = function memory(module) {
  var mem = util.memoryUsage();

  this.log(Logger.levels.DEBUG, module, ['Memory: rss=%dmb, js-heap=%d/%dmb native-heap=%dmb', mem.total, mem.jsHeap, mem.jsHeapTotal, mem.nativeHeap]);
};

/**
 * Basic stdout and file logger.
 * @constructor
 * @ignore
 * @param {Logger} logger
 * @param {String} module
 */

function LoggerContext(logger, module) {
  if (!(this instanceof LoggerContext)) return new LoggerContext(logger, module);

  assert(typeof module === 'string');

  this.logger = logger;
  this.module = module;
}

/**
 * Open the logger.
 * @returns {Promise}
 */

LoggerContext.prototype.open = function open() {
  return this.logger.open();
};

/**
 * Destroy the write stream.
 * @returns {Promise}
 */

LoggerContext.prototype.close = function close() {
  return this.logger.close();
};

/**
 * Set the log file location.
 * @param {String} filename
 */

LoggerContext.prototype.setFile = function setFile(filename) {
  this.logger.setFile(filename);
};

/**
 * Set or reset the log level.
 * @param {String} level
 */

LoggerContext.prototype.setLevel = function setLevel(name) {
  this.logger.setLevel(name);
};

/**
 * Output a log to the `error` log level.
 * @param {String|Object|Error} err
 * @param {...Object} args
 */

LoggerContext.prototype.error = function error(err) {
  var i, args;

  if (this.logger.level < Logger.levels.ERROR) return;

  if (err instanceof Error) return this.logError(Logger.levels.ERROR, err);

  args = new Array(arguments.length);

  for (i = 0; i < args.length; i++) {
    args[i] = arguments[i];
  }this.log(Logger.levels.ERROR, args);
};

/**
 * Helper to parse an error into a nicer
 * format. Call's `log` internally.
 * @private
 * @param {Number} level
 * @param {Error} err
 */

LoggerContext.prototype.logError = function logError(level, err) {
  this.logger.logError(level, this.module, err);
};

/**
 * Output a log to the `warning` log level.
 * @param {String|Object} obj
 * @param {...Object} args
 */

LoggerContext.prototype.warning = function warning(err) {
  var i, args;

  if (this.logger.level < Logger.levels.WARNING) return;

  if (err instanceof Error) return this.logError(Logger.levels.WARNING, err);

  args = new Array(arguments.length);

  for (i = 0; i < args.length; i++) {
    args[i] = arguments[i];
  }this.log(Logger.levels.WARNING, args);
};

/**
 * Output a log to the `info` log level.
 * @param {String|Object} obj
 * @param {...Object} args
 */

LoggerContext.prototype.info = function info(err) {
  var i, args;

  if (this.logger.level < Logger.levels.INFO) return;

  if (err instanceof Error) return this.logError(Logger.levels.INFO, err);

  args = new Array(arguments.length);

  for (i = 0; i < args.length; i++) {
    args[i] = arguments[i];
  }this.log(Logger.levels.INFO, args);
};

/**
 * Output a log to the `debug` log level.
 * @param {String|Object} obj
 * @param {...Object} args
 */

LoggerContext.prototype.debug = function debug(err) {
  var i, args;

  if (this.logger.level < Logger.levels.DEBUG) return;

  if (err instanceof Error) return this.logError(Logger.levels.DEBUG, err);

  args = new Array(arguments.length);

  for (i = 0; i < args.length; i++) {
    args[i] = arguments[i];
  }this.log(Logger.levels.DEBUG, args);
};

/**
 * Output a log to the `spam` log level.
 * @param {String|Object} obj
 * @param {...Object} args
 */

LoggerContext.prototype.spam = function spam(err) {
  var i, args;

  if (this.logger.level < Logger.levels.SPAM) return;

  if (err instanceof Error) return this.logError(Logger.levels.SPAM, err);

  args = new Array(arguments.length);

  for (i = 0; i < args.length; i++) {
    args[i] = arguments[i];
  }this.log(Logger.levels.SPAM, args);
};

/**
 * Output a log to the desired log level.
 * Note that this bypasses the level check.
 * @param {String} level
 * @param {Object[]} args
 */

LoggerContext.prototype.log = function log(level, args) {
  this.logger.log(level, this.module, args);
};

/**
 * Create logger context.
 * @param {String} module
 * @returns {LoggerContext}
 */

LoggerContext.prototype.context = function context(module) {
  return new LoggerContext(this.logger, module);
};

/**
 * Log the current memory usage.
 */

LoggerContext.prototype.memory = function memory() {
  this.logger.memory(this.module);
};

/*
 * Default
 */

Logger.global = new Logger();

/*
 * Helpers
 */

function openStream(filename) {
  return new _promise2.default(function (resolve, reject) {
    var stream = fs.createWriteStream(filename, { flags: 'a' });

    function onError(err) {
      try {
        stream.close();
      } catch (e) {
        ;
      }
      cleanup();
      reject(err);
    }

    function onOpen() {
      cleanup();
      resolve(stream);
    }

    function cleanup() {
      stream.removeListener('error', onError);
      stream.removeListener('open', onOpen);
    }

    stream.once('error', onError);
    stream.once('open', onOpen);
  });
}

function closeStream(stream) {
  return new _promise2.default(function (resolve, reject) {
    function onError(err) {
      cleanup();
      reject(err);
    }

    function onClose() {
      cleanup();
      resolve(stream);
    }

    function cleanup() {
      stream.removeListener('error', onError);
      stream.removeListener('close', onClose);
    }

    stream.removeAllListeners('error');
    stream.removeAllListeners('close');
    stream.once('error', onError);
    stream.once('close', onClose);

    stream.close();
  });
}

/*
 * Expose
 */

module.exports = Logger;