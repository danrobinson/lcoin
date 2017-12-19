/*!
 * node.js - node object for bcoin
 * Copyright (c) 2014-2015, Fedor Indutny (MIT License)
 * Copyright (c) 2014-2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

var _regenerator = require('babel-runtime/regenerator');

var _regenerator2 = _interopRequireDefault(_regenerator);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var assert = require('assert');
var AsyncObject = require('../utils/asyncobject');
var util = require('../utils/util');
var co = require('../utils/co');
var Network = require('../protocol/network');
var Logger = require('./logger');
var workerPool = require('../workers/workerpool').pool;
var ec = require('../crypto/ec');
var native = require('../utils/native');
var Config = require('./config');

/**
 * Base class from which every other
 * Node-like object inherits.
 * @alias module:node.Node
 * @constructor
 * @abstract
 * @param {Object} options
 */

function Node(options) {
  if (!(this instanceof Node)) return new Node(options);

  AsyncObject.call(this);

  this.config = new Config('lcoin');
  this.config.inject(options);
  this.config.load(options);

  if (options.config) this.config.open('lcoin.conf');

  this.network = Network.get(this.config.network);
  this.startTime = -1;
  this.bound = [];
  this.plugins = {};
  this.stack = [];

  this.spv = false;
  this.logger = null;
  this.chain = null;
  this.fees = null;
  this.mempool = null;
  this.pool = null;
  this.miner = null;
  this.http = null;

  this.init();
}

util.inherits(Node, AsyncObject);

/**
 * Initialize options.
 * @private
 * @param {Object} options
 */

Node.prototype.initOptions = function initOptions() {
  var logger = new Logger();
  var config = this.config;

  if (config.has('logger')) logger = config.obj('logger');

  logger.set({
    filename: config.bool('log-file') ? config.location('debug.log') : null,
    level: config.str('log-level'),
    console: config.bool('log-console'),
    shrink: config.bool('log-shrink')
  });

  this.logger = logger.context('node');
};

/**
 * Initialize node.
 * @private
 * @param {Object} options
 */

Node.prototype.init = function init() {
  var self = this;

  this.initOptions();

  this.hook('preopen', function () {
    return self.handlePreopen();
  });

  this.hook('preopen', function () {
    return self.handlePreclose();
  });

  this.hook('open', function () {
    return self.handleOpen();
  });

  this.hook('close', function () {
    return self.handleClose();
  });
};

/**
 * Ensure prefix directory.
 * @returns {Promise}
 */

Node.prototype.ensure = function ensure() {
  return this.config.ensure();
};

/**
 * Create a file path using `prefix`.
 * @param {String} file
 * @returns {String}
 */

Node.prototype.location = function location(name) {
  return this.config.location(name);
};

/**
 * Open node. Bind all events.
 * @private
 */

Node.prototype.handlePreopen = co( /*#__PURE__*/_regenerator2.default.mark(function handlePreopen() {
  var self;
  return _regenerator2.default.wrap(function handlePreopen$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:
          self = this;
          _context.next = 3;
          return this.logger.open();

        case 3:

          this.bind(this.network.time, 'offset', function (offset) {
            self.logger.info('Time offset: %d (%d minutes).', offset, offset / 60 | 0);
          });

          this.bind(this.network.time, 'sample', function (sample, total) {
            self.logger.debug('Added time data: samples=%d, offset=%d (%d minutes).', total, sample, sample / 60 | 0);
          });

          this.bind(this.network.time, 'mismatch', function () {
            self.logger.warning('Adjusted time mismatch!');
            self.logger.warning('Please make sure your system clock is correct!');
          });

          this.bind(workerPool, 'spawn', function (child) {
            self.logger.info('Spawning worker process: %d.', child.id);
          });

          this.bind(workerPool, 'exit', function (code, child) {
            self.logger.warning('Worker %d exited: %s.', child.id, code);
          });

          this.bind(workerPool, 'error', function (err, child) {
            if (child) {
              self.logger.error('Worker %d error: %s', child.id, err.message);
              return;
            }
            self.emit('error', err);
          });

        case 9:
        case 'end':
          return _context.stop();
      }
    }
  }, handlePreopen, this);
}));

/**
 * Open node.
 * @private
 */

Node.prototype.handleOpen = co( /*#__PURE__*/_regenerator2.default.mark(function handleOpen() {
  return _regenerator2.default.wrap(function handleOpen$(_context2) {
    while (1) {
      switch (_context2.prev = _context2.next) {
        case 0:
          this.startTime = util.now();

          if (!ec.binding) {
            this.logger.warning('Warning: secp256k1-node was not built.');
            this.logger.warning('Verification will be slow.');
          }

          if (!native.binding) {
            this.logger.warning('Warning: bcoin-native was not built.');
            this.logger.warning('Hashing will be slow.');
          }

          if (!workerPool.enabled) {
            this.logger.warning('Warning: worker pool is disabled.');
            this.logger.warning('Verification will be slow.');
          }

        case 4:
        case 'end':
          return _context2.stop();
      }
    }
  }, handleOpen, this);
}));

/**
 * Open node. Bind all events.
 * @private
 */

Node.prototype.handlePreclose = co( /*#__PURE__*/_regenerator2.default.mark(function handlePreclose() {
  return _regenerator2.default.wrap(function handlePreclose$(_context3) {
    while (1) {
      switch (_context3.prev = _context3.next) {
        case 0:
        case 'end':
          return _context3.stop();
      }
    }
  }, handlePreclose, this);
}));

/**
 * Close node. Unbind all events.
 * @private
 */

Node.prototype.handleClose = co( /*#__PURE__*/_regenerator2.default.mark(function handleClose() {
  var i, bound;
  return _regenerator2.default.wrap(function handleClose$(_context4) {
    while (1) {
      switch (_context4.prev = _context4.next) {
        case 0:

          this.startTime = -1;

          for (i = 0; i < this.bound.length; i++) {
            bound = this.bound[i];
            bound[0].removeListener(bound[1], bound[2]);
          }

          this.bound.length = 0;

          _context4.next = 5;
          return this.logger.close();

        case 5:
        case 'end':
          return _context4.stop();
      }
    }
  }, handleClose, this);
}));

/**
 * Bind to an event on `obj`, save listener for removal.
 * @private
 * @param {EventEmitter} obj
 * @param {String} event
 * @param {Function} listener
 */

Node.prototype.bind = function bind(obj, event, listener) {
  this.bound.push([obj, event, listener]);
  obj.on(event, listener);
};

/**
 * Emit and log an error.
 * @private
 * @param {Error} err
 */

Node.prototype.error = function error(err) {
  if (!err) return;

  if (err.type === 'VerifyError') {
    switch (err.reason) {
      case 'insufficient priority':
      case 'non-final':
        this.logger.spam(err.message);
        break;
      default:
        this.logger.error(err.message);
        break;
    }
  } else if (typeof err.code === 'string' && err.code[0] === 'E') {
    this.logger.error(err.message);
  } else {
    this.logger.error(err);
  }

  this.emit('error', err);
};

/**
 * Get node uptime in seconds.
 * @returns {Number}
 */

Node.prototype.uptime = function uptime() {
  if (this.startTime === -1) return 0;

  return util.now() - this.startTime;
};

/**
 * Attach a plugin.
 * @param {Object} plugin
 * @returns {Object} Plugin instance.
 */

Node.prototype.use = function use(plugin) {
  var instance;

  assert(plugin, 'Plugin must be an object.');
  assert(typeof plugin.init === 'function', '`init` must be a function.');

  assert(!this.loaded, 'Cannot add plugin after node is loaded.');

  instance = plugin.init(this);

  assert(!instance.open || typeof instance.open === 'function', '`open` must be a function.');
  assert(!instance.close || typeof instance.close === 'function', '`close` must be a function.');

  if (plugin.id) {
    assert(typeof plugin.id === 'string', '`id` must be a string.');

    // Reserved names
    switch (plugin.id) {
      case 'logger':
      case 'chain':
      case 'fees':
      case 'mempool':
      case 'miner':
      case 'pool':
        assert(false, plugin.id + ' is already added.');
        break;
    }

    assert(!this.plugins[plugin.id], plugin.id + ' is already added.');

    this.plugins[plugin.id] = instance;
  }

  this.stack.push(instance);

  return instance;
};

/**
 * Test whether a plugin is available.
 * @param {String} name
 * @returns {Boolean}
 */

Node.prototype.has = function has(name) {
  return this.plugins[name] != null;
};

/**
 * Require a plugin.
 * @param {String} name
 * @returns {Object}
 */

Node.prototype.require = function require(name) {
  var plugin;

  assert(typeof name === 'string', 'Plugin name must be a string.');

  switch (name) {
    case 'logger':
      assert(this.logger, 'logger is not loaded.');
      return this.logger;
    case 'chain':
      assert(this.chain, 'chain is not loaded.');
      return this.chain;
    case 'fees':
      assert(this.fees, 'fees is not loaded.');
      return this.fees;
    case 'mempool':
      assert(this.mempool, 'mempool is not loaded.');
      return this.mempool;
    case 'miner':
      assert(this.miner, 'miner is not loaded.');
      return this.miner;
    case 'pool':
      assert(this.pool, 'pool is not loaded.');
      return this.pool;
  }

  plugin = this.plugins[name];
  assert(plugin, name + ' is not loaded.');

  return plugin;
};

/**
 * Load plugins.
 * @private
 */

Node.prototype.loadPlugins = function loadPlugins() {
  var plugins = this.config.array('plugins', []);
  var loader = this.config.func('loader');
  var i, name, plugin;

  if (!loader) return;

  for (i = 0; i < plugins.length; i++) {
    name = plugins[i];

    assert(typeof name === 'string', 'Plugin name must be a string.');

    plugin = loader(name);

    this.use(plugin);
  }
};

/**
 * Open plugins.
 * @private
 */

Node.prototype.openPlugins = co( /*#__PURE__*/_regenerator2.default.mark(function openPlugins() {
  var i, plugin;
  return _regenerator2.default.wrap(function openPlugins$(_context5) {
    while (1) {
      switch (_context5.prev = _context5.next) {
        case 0:
          i = 0;

        case 1:
          if (!(i < this.stack.length)) {
            _context5.next = 9;
            break;
          }

          plugin = this.stack[i];

          if (!plugin.open) {
            _context5.next = 6;
            break;
          }

          _context5.next = 6;
          return plugin.open();

        case 6:
          i++;
          _context5.next = 1;
          break;

        case 9:
        case 'end':
          return _context5.stop();
      }
    }
  }, openPlugins, this);
}));

/**
 * Close plugins.
 * @private
 */

Node.prototype.closePlugins = co( /*#__PURE__*/_regenerator2.default.mark(function closePlugins() {
  var i, plugin;
  return _regenerator2.default.wrap(function closePlugins$(_context6) {
    while (1) {
      switch (_context6.prev = _context6.next) {
        case 0:
          i = 0;

        case 1:
          if (!(i < this.stack.length)) {
            _context6.next = 9;
            break;
          }

          plugin = this.stack[i];

          if (!plugin.close) {
            _context6.next = 6;
            break;
          }

          _context6.next = 6;
          return plugin.close();

        case 6:
          i++;
          _context6.next = 1;
          break;

        case 9:
        case 'end':
          return _context6.stop();
      }
    }
  }, closePlugins, this);
}));

/*
 * Expose
 */

module.exports = Node;