/*
 * request.js - http request for bcoin
 * Copyright (c) 2014-2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

/* jshint -W069 */

var _promise = require('babel-runtime/core-js/promise');

var _promise2 = _interopRequireDefault(_promise);

var _stringify = require('babel-runtime/core-js/json/stringify');

var _stringify2 = _interopRequireDefault(_stringify);

var _typeof2 = require('babel-runtime/helpers/typeof');

var _typeof3 = _interopRequireDefault(_typeof2);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var Stream = require('stream').Stream;
var assert = require('assert');
var url, qs, http, https, StringDecoder;

/*
 * Constants
 */

var USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_1)' + ' AppleWebKit/537.36 (KHTML, like Gecko) Chrome/41.0.2227.1 Safari/537.36';

/**
 * Request Options
 * @constructor
 * @ignore
 * @param {Object} options
 */

function RequestOptions(options) {
  if (!(this instanceof RequestOptions)) return new RequestOptions(options);

  this.uri = 'http://localhost:80/';
  this.host = 'localhost';
  this.path = '/';
  this.port = 80;
  this.ssl = false;
  this.method = 'GET';
  this.strictSSL = true;
  this.pool = false;
  this.agent = USER_AGENT;

  this.type = null;
  this.expect = null;
  this.query = null;
  this.body = null;
  this.auth = null;
  this.limit = 10 << 20;
  this.maxRedirects = 5;
  this.timeout = 5000;
  this.buffer = false;
  this.headers = null;

  // Hack
  ensureRequires();

  if (options) this.fromOptions(options);
}

RequestOptions.prototype.setURI = function setURI(uri) {
  var parts;

  assert(typeof uri === 'string');

  if (!/:\/\//.test(uri)) uri = (this.ssl ? 'https://' : 'http://') + uri;

  uri = url.parse(uri);

  assert(uri.protocol === 'http:' || uri.protocol === 'https:');

  this.uri = uri;
  this.ssl = uri.protocol === 'https:';

  if (uri.search) this.query = qs.parse(uri.search);

  this.host = uri.hostname;
  this.path = uri.pathname;
  this.port = uri.port || (this.ssl ? 443 : 80);

  if (uri.auth) {
    parts = uri.auth.split(':');
    this.auth = {
      username: parts[0] || '',
      password: parts[1] || ''
    };
  }
};

RequestOptions.prototype.fromOptions = function fromOptions(options) {
  if (typeof options === 'string') options = { uri: options };

  if (options.ssl != null) {
    assert(typeof options.ssl === 'boolean');
    this.ssl = options.ssl;
  }

  if (options.uri != null) this.setURI(options.uri);

  if (options.url != null) this.setURI(options.url);

  if (options.method != null) {
    assert(typeof options.method === 'string');
    this.method = options.method.toUpperCase();
  }

  if (options.strictSSL != null) {
    assert(typeof options.strictSSL === 'boolean');
    this.strictSSL = options.strictSSL;
  }

  if (options.pool != null) {
    assert(typeof options.pool === 'boolean');
    this.pool = options.pool;
  }

  if (options.agent != null) {
    assert(typeof options.agent === 'string');
    this.agent = options.agent;
  }

  if (options.auth != null) {
    assert((0, _typeof3.default)(options.auth) === 'object');
    assert(typeof options.auth.username === 'string');
    assert(typeof options.auth.password === 'string');
    this.auth = options.auth;
  }

  if (options.query != null) {
    if (typeof options.query === 'string') {
      this.query = qs.stringify(options.query);
    } else {
      assert((0, _typeof3.default)(options.query) === 'object');
      this.query = options.query;
    }
  }

  if (options.json != null) {
    assert((0, _typeof3.default)(options.json) === 'object');
    this.body = Buffer.from((0, _stringify2.default)(options.json), 'utf8');
    this.type = 'json';
  }

  if (options.form != null) {
    assert((0, _typeof3.default)(options.form) === 'object');
    this.body = Buffer.from(qs.stringify(options.form), 'utf8');
    this.type = 'form';
  }

  if (options.type != null) {
    assert(typeof options.type === 'string');
    assert(getType(options.type));
    this.type = options.type;
  }

  if (options.expect != null) {
    assert(typeof options.expect === 'string');
    assert(getType(options.expect));
    this.expect = options.expect;
  }

  if (options.body != null) {
    if (typeof options.body === 'string') {
      this.body = Buffer.from(options.body, 'utf8');
    } else {
      assert(Buffer.isBuffer(options.body));
      this.body = options.body;
    }
  }

  if (options.timeout != null) {
    assert(typeof options.timeout === 'number');
    this.timeout = options.timeout;
  }

  if (options.limit != null) {
    assert(typeof options.limit === 'number');
    this.limit = options.limit;
  }

  if (options.maxRedirects != null) {
    assert(typeof options.maxRedirects === 'number');
    this.maxRedirects = options.maxRedirects;
  }

  if (options.buffer != null) {
    assert(typeof options.buffer === 'boolean');
    this.buffer = options.buffer;
  }

  if (options.headers != null) {
    assert((0, _typeof3.default)(options.headers) === 'object');
    this.headers = options.headers;
  }
};

RequestOptions.prototype.isExpected = function isExpected(type) {
  if (!this.expect) return true;

  return this.expect === type;
};

RequestOptions.prototype.isOverflow = function isOverflow(length) {
  if (!length) return false;

  if (!this.buffer) return false;

  length = parseInt(length, 10);

  if (length !== length) return true;

  return length > this.limit;
};

RequestOptions.prototype.getBackend = function getBackend() {
  ensureRequires(this.ssl);
  return this.ssl ? https : http;
};

RequestOptions.prototype.getHeaders = function getHeaders() {
  var headers, auth;

  if (this.headers) return this.headers;

  headers = {};

  headers['User-Agent'] = this.agent;

  if (this.type) headers['Content-Type'] = getType(this.type);

  if (this.body) headers['Content-Length'] = this.body.length + '';

  if (this.auth) {
    auth = this.auth.username + ':' + this.auth.password;
    headers['Authorization'] = 'Basic ' + Buffer.from(auth, 'utf8').toString('base64');
  }

  return headers;
};

RequestOptions.prototype.toHTTP = function toHTTP() {
  var query = '';

  if (this.query) query = '?' + qs.stringify(this.query);

  return {
    method: this.method,
    host: this.host,
    port: this.port,
    path: this.path + query,
    headers: this.getHeaders(),
    agent: this.pool ? null : false,
    rejectUnauthorized: this.strictSSL
  };
};

/**
 * Request
 * @alias module:http.Request
 * @constructor
 * @private
 * @param {Object} options
 */

function Request(options) {
  if (!(this instanceof Request)) return new Request(options);

  Stream.call(this);

  this.options = new RequestOptions(options);
  this.request = null;
  this.response = null;
  this.statusCode = 0;
  this.headers = null;
  this.type = 'bin';
  this.redirects = 0;
  this.timeout = null;
  this.finished = false;

  this.onResponse = this._onResponse.bind(this);
  this.onData = this._onData.bind(this);
  this.onEnd = this._onEnd.bind(this);

  this.total = 0;
  this.decoder = null;
  this.body = null;
}

Request.prototype.__proto__ = Stream.prototype;

Request.prototype.startTimeout = function startTimeout() {
  var self = this;

  if (!this.options.timeout) return;

  this.timeout = setTimeout(function () {
    self.finish(new Error('Request timed out.'));
  }, this.options.timeout);
};

Request.prototype.stopTimeout = function stopTimeout() {
  if (this.timeout != null) {
    clearTimeout(this.timeout);
    this.timeout = null;
  }
};

Request.prototype.cleanup = function cleanup() {
  this.stopTimeout();

  if (this.request) {
    this.request.removeListener('response', this.onResponse);
    this.request.removeListener('error', this.onEnd);
    this.request.addListener('error', nop);
  }

  if (this.response) {
    this.response.removeListener('data', this.onData);
    this.response.removeListener('error', this.onEnd);
    this.response.removeListener('end', this.onEnd);
    this.response.addListener('error', nop);
  }
};

Request.prototype.close = function close() {
  if (this.request) {
    try {
      this.request.abort();
    } catch (e) {
      ;
    }
  }

  if (this.response) {
    try {
      this.response.destroy();
    } catch (e) {
      ;
    }
  }

  this.cleanup();

  this.request = null;
  this.response = null;
};

Request.prototype.destroy = function destroy() {
  this.close();
};

Request.prototype.start = function start() {
  var backend = this.options.getBackend();
  var options = this.options.toHTTP();

  this.startTimeout();

  this.request = backend.request(options);
  this.response = null;

  if (this.options.body) this.request.write(this.options.body);

  this.request.on('response', this.onResponse);
  this.request.on('error', this.onEnd);
};

Request.prototype.write = function write(data) {
  return this.request.write(data);
};

Request.prototype.end = function end() {
  return this.request.end();
};

Request.prototype.finish = function finish(err) {
  if (this.finished) return;

  this.finished = true;

  if (err) {
    this.destroy();
    this.emit('error', err);
    return;
  }

  this.cleanup();

  if (this.options.buffer && this.body) {
    switch (this.type) {
      case 'bin':
        this.body = Buffer.concat(this.body);
        break;
      case 'json':
        try {
          this.body = JSON.parse(this.body);
        } catch (e) {
          this.emit('error', e);
          return;
        }
        break;
      case 'form':
        try {
          this.body = qs.parse(this.body);
        } catch (e) {
          this.emit('error', e);
          return;
        }
        break;
    }
  }

  this.emit('end');
  this.emit('close');
};

Request.prototype._onResponse = function _onResponse(response) {
  var type = response.headers['content-type'];
  var length = response.headers['content-length'];
  var location = response.headers['location'];

  if (location) {
    if (++this.redirects > this.options.maxRedirects) {
      this.finish(new Error('Too many redirects.'));
      return;
    }
    this.close();
    this.options.setURI(location);
    this.start();
    this.end();
    return;
  }

  type = parseType(type);

  if (!this.options.isExpected(type)) {
    this.finish(new Error('Wrong content-type for response.'));
    return;
  }

  if (this.options.isOverflow(length)) {
    this.finish(new Error('Response exceeded limit.'));
    return;
  }

  this.response = response;
  this.statusCode = response.statusCode;
  this.headers = response.headers;
  this.type = type;

  this.response.on('data', this.onData);
  this.response.on('error', this.onEnd);
  this.response.on('end', this.onEnd);

  this.emit('headers', response.headers);
  this.emit('type', this.type);
  this.emit('response', response);

  if (this.options.buffer) {
    if (this.type !== 'bin') {
      this.decoder = new StringDecoder('utf8');
      this.body = '';
    } else {
      this.body = [];
    }
  }
};

Request.prototype._onData = function _onData(data) {
  this.total += data.length;

  this.emit('data', data);

  if (this.options.buffer) {
    if (this.options.limit) {
      if (this.total > this.options.limit) {
        this.finish(new Error('Response exceeded limit.'));
        return;
      }
    }
    if (this.decoder) {
      this.body += this.decoder.write(data);
      return;
    }
    this.body.push(data);
  }
};

Request.prototype._onEnd = function _onEnd(err) {
  this.finish(err);
};

/**
 * Make an HTTP request.
 * @alias module:http.request
 * @param {Object} options
 * @param {String} options.uri
 * @param {Object?} options.query
 * @param {Object?} options.body
 * @param {Object?} options.json
 * @param {Object?} options.form
 * @param {String?} options.type - One of `"json"`,
 * `"form"`, `"text"`, or `"bin"`.
 * @param {String?} options.agent - User agent string.
 * @param {Object?} [options.strictSSL=true] - Whether to accept bad certs.
 * @param {Object?} options.method - HTTP method.
 * @param {Object?} options.auth
 * @param {String?} options.auth.username
 * @param {String?} options.auth.password
 * @param {String?} options.expect - Type to expect (see options.type).
 * Error will be returned if the response is not of this type.
 * @param {Number?} options.limit - Byte limit on response.
 * @returns {Promise}
 */

function request(options) {
  if (typeof options === 'string') options = { uri: options };

  options.buffer = true;

  return new _promise2.default(function (resolve, reject) {
    var stream = new Request(options);

    stream.on('error', function (err) {
      reject(err);
    });

    stream.on('end', function () {
      resolve(stream);
    });

    stream.start();
    stream.end();
  });
}

request.stream = function _stream(options) {
  var stream = new Request(options);
  stream.start();
  return stream;
};

/*
 * Helpers
 */

function parseType(type) {
  type = type || '';
  type = type.split(';')[0];
  type = type.toLowerCase();
  type = type.trim();

  switch (type) {
    case 'text/x-json':
    case 'application/json':
      return 'json';
    case 'application/x-www-form-urlencoded':
      return 'form';
    case 'text/html':
    case 'application/xhtml+xml':
      return 'html';
    case 'text/xml':
    case 'application/xml':
      return 'xml';
    case 'text/javascript':
    case 'application/javascript':
      return 'js';
    case 'text/css':
      return 'css';
    case 'text/plain':
      return 'txt';
    case 'application/octet-stream':
      return 'bin';
    default:
      return 'bin';
  }
}

function getType(type) {
  switch (type) {
    case 'json':
      return 'application/json; charset=utf-8';
    case 'form':
      return 'application/x-www-form-urlencoded; charset=utf-8';
    case 'html':
      return 'text/html; charset=utf-8';
    case 'xml':
      return 'application/xml; charset=utf-8';
    case 'js':
      return 'application/javascript; charset=utf-8';
    case 'css':
      return 'text/css; charset=utf-8';
    case 'txt':
      return 'text/plain; charset=utf-8';
    case 'bin':
      return 'application/octet-stream';
    default:
      throw new Error('Unknown type: ' + type);
  }
}

function ensureRequires(ssl) {
  if (!url) url = require('url');

  if (!qs) qs = require('querystring');

  if (!http) http = require('http');

  if (ssl && !https) https = require('https');

  if (!StringDecoder) StringDecoder = require('string_decoder').StringDecoder;
}

function nop() {}

/*
 * Expose
 */

module.exports = request;