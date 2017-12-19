/*!
 * upnp.js - upnp for bcoin
 * Copyright (c) 2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

var _stringify = require('babel-runtime/core-js/json/stringify');

var _stringify2 = _interopRequireDefault(_stringify);

var _promise = require('babel-runtime/core-js/promise');

var _promise2 = _interopRequireDefault(_promise);

var _regenerator = require('babel-runtime/regenerator');

var _regenerator2 = _interopRequireDefault(_regenerator);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var assert = require('assert');
var dgram = require('dgram');
var url = require('url');
var request = require('../http/request');
var co = require('../utils/co');
var Lock = require('../utils/lock');
var IP = require('../utils/ip');

/**
 * UPNP
 * @alias module:net.UPNP
 * @constructor
 * @param {String?} host - Multicast IP.
 * @param {Number?} port - Multicast port.
 * @param {String?} gateway - Gateway name.
 */

function UPNP(host, port, gateway) {
  if (!(this instanceof UPNP)) return new UPNP(host, port, gateway);

  this.host = host || '239.255.255.250';
  this.port = port || 1900;
  this.gateway = gateway || UPNP.INTERNET_GATEWAY;
  this.locker = new Lock();
  this.timeout = null;
  this.job = null;
}

/**
 * Default internet gateway string.
 * @const {String}
 * @default
 */

UPNP.INTERNET_GATEWAY = 'urn:schemas-upnp-org:device:InternetGatewayDevice:1';

/**
 * Default service types.
 * @const {String[]}
 * @default
 */

UPNP.WAN_SERVICES = ['urn:schemas-upnp-org:service:WANIPConnection:1', 'urn:schemas-upnp-org:service:WANPPPConnection:1'];

/**
 * Timeout before killing request.
 * @const {Number}
 * @default
 */

UPNP.RESPONSE_TIMEOUT = 1000;

/**
 * Clean up current job.
 * @private
 * @returns {Job}
 */

UPNP.prototype.cleanupJob = function cleanupJob() {
  var job = this.job;

  assert(this.socket);
  assert(this.job);

  this.job = null;

  this.socket.close();
  this.socket = null;

  this.stopTimeout();

  return job;
};

/**
 * Reject current job.
 * @private
 * @param {Error} err
 */

UPNP.prototype.rejectJob = function rejectJob(err) {
  var job = this.cleanupJob();
  job.reject(err);
};

/**
 * Resolve current job.
 * @private
 * @param {Object} result
 */

UPNP.prototype.resolveJob = function resolveJob(result) {
  var job = this.cleanupJob();
  job.resolve(result);
};

/**
 * Start gateway timeout.
 * @private
 */

UPNP.prototype.startTimeout = function startTimeout() {
  var self = this;
  this.stopTimeout();
  this.timeout = setTimeout(function () {
    self.timeout = null;
    self.rejectJob(new Error('Request timed out.'));
  }, UPNP.RESPONSE_TIMEOUT);
};

/**
 * Stop gateway timeout.
 * @private
 */

UPNP.prototype.stopTimeout = function stopTimeout() {
  if (this.timeout != null) {
    clearTimeout(this.timeout);
    this.timeout = null;
  }
};

/**
 * Discover gateway.
 * @returns {Promise} Location string.
 */

UPNP.prototype.discover = co( /*#__PURE__*/_regenerator2.default.mark(function discover() {
  var unlock;
  return _regenerator2.default.wrap(function discover$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:
          _context.next = 2;
          return this.locker.lock();

        case 2:
          unlock = _context.sent;
          _context.prev = 3;
          _context.next = 6;
          return this._discover();

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
  }, discover, this, [[3,, 7, 10]]);
}));

/**
 * Discover gateway (without a lock).
 * @private
 * @returns {Promise} Location string.
 */

UPNP.prototype._discover = co( /*#__PURE__*/_regenerator2.default.mark(function discover() {
  var self, socket, msg;
  return _regenerator2.default.wrap(function discover$(_context2) {
    while (1) {
      switch (_context2.prev = _context2.next) {
        case 0:
          self = this;


          socket = dgram.createSocket('udp4');

          socket.on('error', function (err) {
            self.rejectJob(err);
          });

          socket.on('message', function (data, rinfo) {
            var msg = data.toString('utf8');
            self.handleMsg(msg);
          });

          this.socket = socket;
          this.startTimeout();

          msg = '' + 'M-SEARCH * HTTP/1.1\r\n' + 'HOST: ' + this.host + ':' + this.port + '\r\n' + 'MAN: ssdp:discover\r\n' + 'MX: 10\r\n' + 'ST: ssdp:all\r\n';

          socket.send(msg, this.port, this.host);

          _context2.next = 10;
          return new _promise2.default(function (resolve, reject) {
            self.job = co.job(resolve, reject);
          });

        case 10:
          return _context2.abrupt('return', _context2.sent);

        case 11:
        case 'end':
          return _context2.stop();
      }
    }
  }, discover, this);
}));

/**
 * Handle incoming UDP message.
 * @private
 * @param {String} msg
 * @returns {Promise}
 */

UPNP.prototype.handleMsg = co( /*#__PURE__*/_regenerator2.default.mark(function handleMsg(msg) {
  var headers;
  return _regenerator2.default.wrap(function handleMsg$(_context3) {
    while (1) {
      switch (_context3.prev = _context3.next) {
        case 0:
          if (this.socket) {
            _context3.next = 2;
            break;
          }

          return _context3.abrupt('return');

        case 2:
          _context3.prev = 2;

          headers = UPNP.parseHeader(msg);
          _context3.next = 9;
          break;

        case 6:
          _context3.prev = 6;
          _context3.t0 = _context3['catch'](2);
          return _context3.abrupt('return');

        case 9:
          if (headers.location) {
            _context3.next = 11;
            break;
          }

          return _context3.abrupt('return');

        case 11:
          if (!(headers.st !== this.gateway)) {
            _context3.next = 13;
            break;
          }

          return _context3.abrupt('return');

        case 13:

          this.resolveJob(headers.location);

        case 14:
        case 'end':
          return _context3.stop();
      }
    }
  }, handleMsg, this, [[2, 6]]);
}));

/**
 * Resolve service parameters from location.
 * @param {String} location
 * @param {String[]} targets - Target services.
 * @returns {Promise}
 */

UPNP.prototype.resolve = co( /*#__PURE__*/_regenerator2.default.mark(function resolve(location, targets) {
  var host, res, xml, services, service;
  return _regenerator2.default.wrap(function resolve$(_context4) {
    while (1) {
      switch (_context4.prev = _context4.next) {
        case 0:
          host = parseHost(location);


          if (!targets) targets = UPNP.WAN_SERVICES;

          _context4.next = 4;
          return request({
            method: 'GET',
            uri: location,
            timeout: UPNP.RESPONSE_TIMEOUT,
            expect: 'xml'
          });

        case 4:
          res = _context4.sent;


          xml = XMLElement.fromRaw(res.body);

          services = parseServices(xml);
          assert(services.length > 0, 'No services found.');

          service = extractServices(services, targets);
          assert(service, 'No service found.');
          assert(service.serviceId, 'No service ID found.');
          assert(service.serviceId.length > 0, 'No service ID found.');
          assert(service.controlURL, 'No control URL found.');
          assert(service.controlURL.length > 0, 'No control URL found.');

          service.controlURL = prependHost(host, service.controlURL);

          if (service.eventSubURL) service.eventSubURL = prependHost(host, service.eventSubURL);

          if (service.SCPDURL) service.SCPDURL = prependHost(host, service.SCPDURL);

          return _context4.abrupt('return', service);

        case 18:
        case 'end':
          return _context4.stop();
      }
    }
  }, resolve, this);
}));

/**
 * Parse UPNP datagram.
 * @private
 * @param {String} str
 * @returns {Object}
 */

UPNP.parseHeader = function parseHeader(str) {
  var lines = str.split(/\r?\n/);
  var headers = {};
  var i, line, index, left, right;

  for (i = 0; i < lines.length; i++) {
    line = lines[i];

    line = line.trim();

    if (line.length === 0) continue;

    index = line.indexOf(':');

    if (index === -1) {
      left = line.toLowerCase();
      headers[left] = '';
      continue;
    }

    left = line.substring(0, index);
    right = line.substring(index + 1);

    left = left.trim();
    right = right.trim();

    left = left.toLowerCase();

    headers[left] = right;
  }

  return headers;
};

/**
 * Discover gateway and resolve service.
 * @param {String?} host - Multicast IP.
 * @param {Number?} port - Multicast port.
 * @param {String?} gateway - Gateway type.
 * @param {String[]?} targets - Target service types.
 * @returns {Promise} Service.
 */

UPNP.discover = co( /*#__PURE__*/_regenerator2.default.mark(function discover(host, port, gateway, targets) {
  var upnp, location, service;
  return _regenerator2.default.wrap(function discover$(_context5) {
    while (1) {
      switch (_context5.prev = _context5.next) {
        case 0:
          upnp = new UPNP(host, port, gateway);
          _context5.next = 3;
          return upnp.discover();

        case 3:
          location = _context5.sent;
          _context5.next = 6;
          return upnp.resolve(location, targets);

        case 6:
          service = _context5.sent;
          return _context5.abrupt('return', new UPNPService(service));

        case 8:
        case 'end':
          return _context5.stop();
      }
    }
  }, discover, this);
}));

/**
 * Gateway Service
 * @constructor
 * @ignore
 * @param {Object} options - Service parameters.
 */

function UPNPService(options) {
  if (!(this instanceof UPNPService)) return new UPNPService(options);

  this.serviceType = options.serviceType;
  this.serviceId = options.serviceId;
  this.controlURL = options.controlURL;
  this.eventSubURL = options.eventSubURL;
  this.SCPDURL = options.SCPDURL;
}

/**
 * Compile SOAP request.
 * @private
 * @param {String} action
 * @param {String[]} args
 * @returns {String}
 */

UPNPService.prototype.createRequest = function createRequest(action, args) {
  var params = '';
  var i, arg;

  for (i = 0; i < args.length; i++) {
    arg = args[i];
    params += '<' + arg[0] + '>';
    if (arg.length > 1) params += arg[1];
    params += '</' + arg[0] + '>';
  }

  return '' + '<?xml version="1.0"?>' + '<s:Envelope ' + 'xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' + 's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' + '<s:Body>' + '<u:' + action + ' xmlns:u=' + (0, _stringify2.default)(this.serviceType) + '>' + params + '</u:' + action + '>' + '</s:Body>' + '</s:Envelope>';
};

/**
 * Send SOAP request and parse XML response.
 * @private
 * @param {String} action
 * @param {String[]} args
 * @returns {XMLElement}
 */

UPNPService.prototype.soapRequest = co( /*#__PURE__*/_regenerator2.default.mark(function soapRequest(action, args) {
  var req, res, xml, err;
  return _regenerator2.default.wrap(function soapRequest$(_context6) {
    while (1) {
      switch (_context6.prev = _context6.next) {
        case 0:
          req = this.createRequest(action, args);
          _context6.next = 3;
          return request({
            method: 'POST',
            uri: this.controlURL,
            timeout: UPNP.RESPONSE_TIMEOUT,
            expect: 'xml',
            headers: {
              'Content-Type': 'text/xml; charset="utf-8"',
              'Content-Length': Buffer.byteLength(req, 'utf8') + '',
              'Connection': 'close',
              'SOAPAction': (0, _stringify2.default)(this.serviceType + '#' + action)
            },
            body: req
          });

        case 3:
          res = _context6.sent;


          xml = XMLElement.fromRaw(res.body);
          err = findError(xml);

          if (!err) {
            _context6.next = 8;
            break;
          }

          throw err;

        case 8:
          return _context6.abrupt('return', xml);

        case 9:
        case 'end':
          return _context6.stop();
      }
    }
  }, soapRequest, this);
}));

/**
 * Attempt to get external IP from service (wan).
 * @returns {Promise}
 */

UPNPService.prototype.getExternalIP = co( /*#__PURE__*/_regenerator2.default.mark(function getExternalIP() {
  var action, xml, ip;
  return _regenerator2.default.wrap(function getExternalIP$(_context7) {
    while (1) {
      switch (_context7.prev = _context7.next) {
        case 0:
          action = 'GetExternalIPAddress';
          _context7.next = 3;
          return this.soapRequest(action, []);

        case 3:
          xml = _context7.sent;
          ip = findIP(xml);

          if (ip) {
            _context7.next = 7;
            break;
          }

          throw new Error('Could not find external IP.');

        case 7:
          return _context7.abrupt('return', ip);

        case 8:
        case 'end':
          return _context7.stop();
      }
    }
  }, getExternalIP, this);
}));

/**
 * Attempt to add port mapping to local IP.
 * @param {String} remote - Remote IP.
 * @param {Number} src - Remote port.
 * @param {Number} dest - Local port.
 * @returns {Promise}
 */

UPNPService.prototype.addPortMapping = co( /*#__PURE__*/_regenerator2.default.mark(function addPortMapping(remote, src, dest) {
  var action, local, xml, child;
  return _regenerator2.default.wrap(function addPortMapping$(_context8) {
    while (1) {
      switch (_context8.prev = _context8.next) {
        case 0:
          action = 'AddPortMapping';
          local = IP.getPrivate();

          if (!(local.length === 0)) {
            _context8.next = 4;
            break;
          }

          throw new Error('Cannot determine local IP.');

        case 4:
          _context8.next = 6;
          return this.soapRequest(action, [['NewRemoteHost', remote], ['NewExternalPort', src], ['NewProtocol', 'TCP'], ['NewInternalClient', local[0]], ['NewInternalPort', dest], ['NewEnabled', 'True'], ['NewPortMappingDescription', 'upnp:bcoin'], ['NewLeaseDuration', 0]]);

        case 6:
          xml = _context8.sent;


          child = xml.find('AddPortMappingResponse');

          if (child) {
            _context8.next = 10;
            break;
          }

          throw new Error('Port mapping failed.');

        case 10:
          return _context8.abrupt('return', child.text);

        case 11:
        case 'end':
          return _context8.stop();
      }
    }
  }, addPortMapping, this);
}));

/**
 * Attempt to remove port mapping from local IP.
 * @param {String} remote - Remote IP.
 * @param {Number} port - Remote port.
 * @returns {Promise}
 */

UPNPService.prototype.removePortMapping = co( /*#__PURE__*/_regenerator2.default.mark(function removePortMapping(remote, port) {
  var action, xml, child;
  return _regenerator2.default.wrap(function removePortMapping$(_context9) {
    while (1) {
      switch (_context9.prev = _context9.next) {
        case 0:
          action = 'DeletePortMapping';
          _context9.next = 3;
          return this.soapRequest(action, [['NewRemoteHost', remote], ['NewExternalPort', port], ['NewProtocol', 'TCP']]);

        case 3:
          xml = _context9.sent;


          child = xml.find('DeletePortMappingResponse');

          if (child) {
            _context9.next = 7;
            break;
          }

          throw new Error('Port unmapping failed.');

        case 7:
          return _context9.abrupt('return', child.text);

        case 8:
        case 'end':
          return _context9.stop();
      }
    }
  }, removePortMapping, this);
}));

/**
 * XML Element
 * @constructor
 * @ignore
 */

function XMLElement(name) {
  this.name = name;
  this.type = name.replace(/^[^:]:/, '');
  this.children = [];
  this.text = '';
}

/**
 * Insantiate element from raw XML.
 * @param {String} xml
 * @returns {XMLElement}
 */

XMLElement.fromRaw = function fromRaw(xml) {
  var sentinel = new XMLElement('');
  var current = sentinel;
  var stack = [];
  var decl = false;
  var m, element, name, text, trailing;

  stack.push(sentinel);

  while (xml.length) {
    if (m = /^<\?xml[^<>]*\?>/i.exec(xml)) {
      xml = xml.substring(m[0].length);
      assert(current === sentinel, 'XML declaration inside element.');
      assert(!decl, 'XML declaration seen twice.');
      decl = true;
      continue;
    }

    if (m = /^<([\w:]+)[^<>]*?(\/?)>/i.exec(xml)) {
      xml = xml.substring(m[0].length);
      name = m[1];
      trailing = m[2] === '/';
      element = new XMLElement(name);

      if (trailing) {
        current.add(element);
        continue;
      }

      stack.push(element);
      current.add(element);
      current = element;

      continue;
    }

    if (m = /^<\/([\w:]+)[^<>]*>/i.exec(xml)) {
      xml = xml.substring(m[0].length);
      name = m[1];
      assert(stack.length !== 1, 'No start tag.');
      element = stack.pop();
      assert(element.name === name, 'Tag mismatch.');
      current = stack[stack.length - 1];
      if (current === sentinel) break;
      continue;
    }

    if (m = /^([^<]+)/i.exec(xml)) {
      xml = xml.substring(m[0].length);
      text = m[1];
      current.text = text.trim();
      continue;
    }

    throw new Error('XML parse error.');
  }

  assert(sentinel.children.length > 0, 'No root element.');

  return sentinel.children[0];
};

/**
 * Push element onto children.
 * @param {XMLElement} child
 * @returns {Number}
 */

XMLElement.prototype.add = function add(child) {
  return this.children.push(child);
};

/**
 * Collect all descendants with matching name.
 * @param {String} name
 * @returns {XMLElement[]}
 */

XMLElement.prototype.collect = function collect(name) {
  return this._collect(name, []);
};

/**
 * Collect all descendants with matching name.
 * @private
 * @param {String} name
 * @param {XMLElement[]} result
 * @returns {XMLElement[]}
 */

XMLElement.prototype._collect = function _collect(name, result) {
  var i, child;

  for (i = 0; i < this.children.length; i++) {
    child = this.children[i];

    if (child.type === name) {
      result.push(child);
      continue;
    }

    child._collect(name, result);
  }

  return result;
};

/**
 * Find child element with matching name.
 * @param {String} name
 * @returns {XMLElement|null}
 */

XMLElement.prototype.find = function find(name) {
  var i, child;

  for (i = 0; i < this.children.length; i++) {
    child = this.children[i];

    if (child.type === name) return child;

    child = child.find(name);

    if (child) return child;
  }
};

/*
 * XML Helpers
 */

function parseServices(el) {
  var children = el.collect('service');
  var services = [];
  var i, child;

  for (i = 0; i < children.length; i++) {
    child = children[i];
    services.push(parseService(children[i]));
  }

  return services;
}

function parseService(el) {
  var service = {};
  var i, child;

  for (i = 0; i < el.children.length; i++) {
    child = el.children[i];

    if (child.children.length > 0) continue;

    service[child.type] = child.text;
  }

  return service;
}

function findService(services, name) {
  var i, service;

  for (i = 0; i < services.length; i++) {
    service = services[i];
    if (service.serviceType === name) return service;
  }
}

function extractServices(services, targets) {
  var i, name, service;

  for (i = 0; i < targets.length; i++) {
    name = targets[i];
    service = findService(services, name);
    if (service) return service;
  }
}

function findIP(el) {
  var child = el.find('NewExternalIPAddress');

  if (!child) return;

  return IP.normalize(child.text);
}

function findError(el) {
  var child = el.find('UPnPError');
  var code = -1;
  var desc = 'Unknown';
  var ccode, cdesc;

  if (!child) return;

  ccode = child.find('errorCode');
  cdesc = child.find('errorDescription');

  if (ccode && /^\d+$/.test(ccode.text)) code = +ccode.text;

  if (cdesc) desc = cdesc.text;

  return new Error('UPnPError: ' + desc + ' (' + code + ')');
}

/*
 * Helpers
 */

function parseHost(uri) {
  var data = url.parse(uri);

  assert(data.protocol === 'http:' || data.protocol === 'https:', 'Bad URL for location.');

  return data.protocol + '//' + data.host;
}

function prependHost(host, uri) {
  if (uri.indexOf('://') === -1) {
    if (uri[0] !== '/') uri = '/' + uri;
    uri = host + uri;
  }
  return uri;
}

/*
 * Expose
 */

module.exports = UPNP;