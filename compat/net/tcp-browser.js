/*!
 * tcp.js - tcp backend for bcoin
 * Copyright (c) 2014-2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

var _promise = require('babel-runtime/core-js/promise');

var _promise2 = _interopRequireDefault(_promise);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var ProxySocket = require('./proxysocket');
var EventEmitter = require('events').EventEmitter;
var tcp = exports;

tcp.createSocket = function createSocket(port, host, proxy) {
  return ProxySocket.connect(proxy, port, host);
};

tcp.createServer = function createServer() {
  var server = new EventEmitter();

  server.listen = function listen(port, host) {
    server.emit('listening');
    return _promise2.default.resolve();
  };

  server.close = function close() {
    return _promise2.default.resolve();
  };

  server.address = function address() {
    return {
      address: '127.0.0.1',
      port: 0
    };
  };

  server.maxConnections = undefined;

  return server;
};