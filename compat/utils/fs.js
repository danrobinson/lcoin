/*!
 * fs.js - promisified fs module for bcoin
 * Copyright (c) 2014-2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

var _regenerator = require('babel-runtime/regenerator');

var _regenerator2 = _interopRequireDefault(_regenerator);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var fs = require('fs');
var co = require('./co');

exports.access = co.promisify(fs.access);
exports.accessSync = fs.accessSync;
exports.appendFile = co.promisify(fs.appendFile);
exports.appendFileSync = fs.appendFileSync;
exports.chmod = co.promisify(fs.chmod);
exports.chmodSync = fs.chmodSync;
exports.chown = co.promisify(fs.chown);
exports.chownSync = fs.chownSync;
exports.close = co.promisify(fs.close);
exports.closeSync = fs.closeSync;
exports.constants = fs.constants;
exports.createReadStream = fs.createReadStream;
exports.createWriteStream = fs.createWriteStream;
exports.exists = co.promisify(fs.exists);
exports.existsSync = fs.existsSync;
exports.fchmod = co.promisify(fs.fchmod);
exports.fchmodSync = fs.fchmodSync;
exports.fchown = co.promisify(fs.fchown);
exports.fchownSync = fs.fchownSync;
exports.fdatasync = co.promisify(fs.fdatasync);
exports.fdatasyncSync = fs.fdatasyncSync;
exports.fstat = co.promisify(fs.fstat);
exports.fstatSync = fs.fstatSync;
exports.fsync = co.promisify(fs.fsync);
exports.fsyncSync = fs.fsyncSync;
exports.ftruncate = co.promisify(fs.ftruncate);
exports.ftruncateSync = fs.ftruncateSync;
exports.futimes = co.promisify(fs.futimes);
exports.futimesSync = fs.futimesSync;
exports.lchmod = co.promisify(fs.lchmod);
exports.lchmodSync = fs.lchmodSync;
exports.lchown = co.promisify(fs.lchown);
exports.lchownSync = fs.lchownSync;
exports.link = co.promisify(fs.link);
exports.linkSync = fs.linkSync;
exports.lstat = co.promisify(fs.lstat);
exports.lstatSync = fs.lstatSync;
exports.mkdir = co.promisify(fs.mkdir);
exports.mkdirSync = fs.mkdirSync;
exports.mkdtemp = co.promisify(fs.mkdtemp);
exports.mkdtempSync = fs.mkdtempSync;
exports.open = co.promisify(fs.open);
exports.openSync = fs.openSync;
exports.read = co.promisify(fs.read);
exports.readSync = fs.readSync;
exports.readdir = co.promisify(fs.readdir);
exports.readdirSync = fs.readdirSync;
exports.readFile = co.promisify(fs.readFile);
exports.readFileSync = fs.readFileSync;
exports.readlink = co.promisify(fs.readlink);
exports.readlinkSync = fs.readlinkSync;
exports.realpath = co.promisify(fs.realpath);
exports.realpathSync = fs.realpathSync;
exports.rename = co.promisify(fs.rename);
exports.renameSync = fs.renameSync;
exports.rmdir = co.promisify(fs.rmdir);
exports.rmdirSync = fs.rmdirSync;
exports.stat = co.promisify(fs.stat);
exports.statSync = fs.statSync;
exports.symlink = co.promisify(fs.symlink);
exports.symlinkSync = fs.symlinkSync;
exports.truncate = co.promisify(fs.truncate);
exports.truncateSync = fs.truncateSync;
exports.unlink = co.promisify(fs.unlink);
exports.unlinkSync = fs.unlinkSync;
exports.unwatchFile = fs.unwatchFile;
exports.utimes = co.promisify(fs.utimes);
exports.utimesSync = fs.utimesSync;
exports.watch = fs.watch;
exports.watchFile = fs.watchFile;
exports.write = co.promisify(fs.write);
exports.writeSync = fs.writeSync;
exports.writeFile = co.promisify(fs.writeFile);
exports.writeFileSync = fs.writeFileSync;

exports.mkdirpSync = function mkdirpSync(dir, mode) {
  var data = getParts(dir);
  var parts = data.parts;
  var path = data.path;
  var i, stat;

  if (mode == null) mode = 488; // 0755

  for (i = 0; i < parts.length; i++) {
    path += parts[i];

    try {
      stat = exports.statSync(path);
      if (!stat.isDirectory()) throw new Error('Could not create directory.');
    } catch (e) {
      if (e.code === 'ENOENT') exports.mkdirSync(path, mode);else throw e;
    }

    path += '/';
  }
};

exports.mkdirp = co( /*#__PURE__*/_regenerator2.default.mark(function mkdirp(dir, mode) {
  var data, parts, path, i, stat;
  return _regenerator2.default.wrap(function mkdirp$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:
          data = getParts(dir);
          parts = data.parts;
          path = data.path;


          if (mode == null) mode = 488; // 0755

          i = 0;

        case 5:
          if (!(i < parts.length)) {
            _context.next = 27;
            break;
          }

          path += parts[i];

          _context.prev = 7;
          _context.next = 10;
          return exports.stat(path);

        case 10:
          stat = _context.sent;

          if (stat.isDirectory()) {
            _context.next = 13;
            break;
          }

          throw new Error('Could not create directory.');

        case 13:
          _context.next = 23;
          break;

        case 15:
          _context.prev = 15;
          _context.t0 = _context['catch'](7);

          if (!(_context.t0.code === 'ENOENT')) {
            _context.next = 22;
            break;
          }

          _context.next = 20;
          return exports.mkdir(path, mode);

        case 20:
          _context.next = 23;
          break;

        case 22:
          throw _context.t0;

        case 23:

          path += '/';

        case 24:
          i++;
          _context.next = 5;
          break;

        case 27:
        case 'end':
          return _context.stop();
      }
    }
  }, mkdirp, this, [[7, 15]]);
}));

function getParts(path) {
  var parts;

  path = path.replace(/\\/g, '/');
  path = path.replace(/(^|\/)\.\//, '$1');
  path = path.replace(/\/+\.?$/, '');
  parts = path.split(/\/+/);
  path = '';

  if (process.platform === 'win32') {
    if (parts[0].indexOf(':') !== -1) path = parts.shift() + '/';
  }

  if (parts.length > 0) {
    if (parts[0].length === 0) {
      parts.shift();
      path = '/';
    }
  }

  return {
    path: path,
    parts: parts
  };
}