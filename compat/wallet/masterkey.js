/*!
 * masterkey.js - master bip32 key object for bcoin
 * Copyright (c) 2014-2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

var _regenerator = require('babel-runtime/regenerator');

var _regenerator2 = _interopRequireDefault(_regenerator);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var assert = require('assert');
var util = require('../utils/util');
var Lock = require('../utils/lock');
var co = require('../utils/co');
var crypto = require('../crypto/crypto');
var BufferReader = require('../utils/reader');
var StaticWriter = require('../utils/staticwriter');
var encoding = require('../utils/encoding');
var HD = require('../hd/hd');
var Mnemonic = HD.Mnemonic;

/**
 * Master BIP32 key which can exist
 * in a timed out encrypted state.
 * @alias module:wallet.MasterKey
 * @constructor
 * @param {Object} options
 */

function MasterKey(options) {
  if (!(this instanceof MasterKey)) return new MasterKey(options);

  this.encrypted = false;
  this.iv = null;
  this.ciphertext = null;
  this.key = null;
  this.mnemonic = null;

  this.alg = MasterKey.alg.PBKDF2;
  this.N = 50000;
  this.r = 0;
  this.p = 0;

  this.aesKey = null;
  this.timer = null;
  this.until = 0;
  this._onTimeout = this.lock.bind(this);
  this.locker = new Lock();

  if (options) this.fromOptions(options);
}

/**
 * Key derivation salt.
 * @const {Buffer}
 * @default
 */

MasterKey.SALT = Buffer.from('bcoin', 'ascii');

/**
 * Key derivation algorithms.
 * @enum {Number}
 * @default
 */

MasterKey.alg = {
  PBKDF2: 0,
  SCRYPT: 1
};

/**
 * Key derivation algorithms by value.
 * @enum {String}
 * @default
 */

MasterKey.algByVal = {
  0: 'PBKDF2',
  1: 'SCRYPT'
};

/**
 * Inject properties from options object.
 * @private
 * @param {Object} options
 */

MasterKey.prototype.fromOptions = function fromOptions(options) {
  assert(options);

  if (options.encrypted != null) {
    assert(typeof options.encrypted === 'boolean');
    this.encrypted = options.encrypted;
  }

  if (options.iv) {
    assert(Buffer.isBuffer(options.iv));
    this.iv = options.iv;
  }

  if (options.ciphertext) {
    assert(Buffer.isBuffer(options.ciphertext));
    this.ciphertext = options.ciphertext;
  }

  if (options.key) {
    assert(HD.isPrivate(options.key));
    this.key = options.key;
  }

  if (options.mnemonic) {
    assert(options.mnemonic instanceof Mnemonic);
    this.mnemonic = options.mnemonic;
  }

  if (options.alg != null) {
    if (typeof options.alg === 'string') {
      this.alg = MasterKey.alg[options.alg.toUpperCase()];
      assert(this.alg != null, 'Unknown algorithm.');
    } else {
      assert(typeof options.alg === 'number');
      assert(MasterKey.algByVal[options.alg]);
      this.alg = options.alg;
    }
  }

  if (options.rounds != null) {
    assert(util.isNumber(options.rounds));
    this.N = options.rounds;
  }

  if (options.N != null) {
    assert(util.isNumber(options.N));
    this.N = options.N;
  }

  if (options.r != null) {
    assert(util.isNumber(options.r));
    this.r = options.r;
  }

  if (options.p != null) {
    assert(util.isNumber(options.p));
    this.p = options.p;
  }

  assert(this.encrypted ? !this.key : this.key);

  return this;
};

/**
 * Instantiate master key from options.
 * @returns {MasterKey}
 */

MasterKey.fromOptions = function fromOptions(options) {
  return new MasterKey().fromOptions(options);
};

/**
 * Decrypt the key and set a timeout to destroy decrypted data.
 * @param {Buffer|String} passphrase - Zero this yourself.
 * @param {Number} [timeout=60000] timeout in ms.
 * @returns {Promise} - Returns {@link HDPrivateKey}.
 */

MasterKey.prototype.unlock = co( /*#__PURE__*/_regenerator2.default.mark(function _unlock(passphrase, timeout) {
  var unlock;
  return _regenerator2.default.wrap(function _unlock$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:
          _context.next = 2;
          return this.locker.lock();

        case 2:
          unlock = _context.sent;
          _context.prev = 3;
          _context.next = 6;
          return this._unlock(passphrase, timeout);

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
  }, _unlock, this, [[3,, 7, 10]]);
}));

/**
 * Decrypt the key without a lock.
 * @private
 * @param {Buffer|String} passphrase - Zero this yourself.
 * @param {Number} [timeout=60000] timeout in ms.
 * @returns {Promise} - Returns {@link HDPrivateKey}.
 */

MasterKey.prototype._unlock = co( /*#__PURE__*/_regenerator2.default.mark(function _unlock(passphrase, timeout) {
  var data, key;
  return _regenerator2.default.wrap(function _unlock$(_context2) {
    while (1) {
      switch (_context2.prev = _context2.next) {
        case 0:
          if (!this.key) {
            _context2.next = 3;
            break;
          }

          if (this.encrypted) {
            assert(this.timer != null);
            this.start(timeout);
          }
          return _context2.abrupt('return', this.key);

        case 3:
          if (passphrase) {
            _context2.next = 5;
            break;
          }

          throw new Error('No passphrase.');

        case 5:

          assert(this.encrypted);

          _context2.next = 8;
          return this.derive(passphrase);

        case 8:
          key = _context2.sent;

          data = crypto.decipher(this.ciphertext, key, this.iv);

          this.fromKeyRaw(data);

          this.start(timeout);

          this.aesKey = key;

          return _context2.abrupt('return', this.key);

        case 14:
        case 'end':
          return _context2.stop();
      }
    }
  }, _unlock, this);
}));

/**
 * Start the destroy timer.
 * @private
 * @param {Number} [timeout=60000] timeout in ms.
 */

MasterKey.prototype.start = function start(timeout) {
  if (!timeout) timeout = 60;

  this.stop();

  if (timeout === -1) return;

  this.until = util.now() + timeout;
  this.timer = setTimeout(this._onTimeout, timeout * 1000);
};

/**
 * Stop the destroy timer.
 * @private
 */

MasterKey.prototype.stop = function stop() {
  if (this.timer != null) {
    clearTimeout(this.timer);
    this.timer = null;
    this.until = 0;
  }
};

/**
 * Derive an aes key based on params.
 * @param {String|Buffer} passphrase
 * @returns {Promise}
 */

MasterKey.prototype.derive = co( /*#__PURE__*/_regenerator2.default.mark(function derive(passwd) {
  var salt, N, r, p;
  return _regenerator2.default.wrap(function derive$(_context3) {
    while (1) {
      switch (_context3.prev = _context3.next) {
        case 0:
          salt = MasterKey.SALT;
          N = this.N;
          r = this.r;
          p = this.p;


          if (typeof passwd === 'string') passwd = Buffer.from(passwd, 'utf8');

          _context3.t0 = this.alg;
          _context3.next = _context3.t0 === MasterKey.alg.PBKDF2 ? 8 : _context3.t0 === MasterKey.alg.SCRYPT ? 11 : 14;
          break;

        case 8:
          _context3.next = 10;
          return crypto.pbkdf2Async(passwd, salt, N, 32, 'sha256');

        case 10:
          return _context3.abrupt('return', _context3.sent);

        case 11:
          _context3.next = 13;
          return crypto.scryptAsync(passwd, salt, N, r, p, 32);

        case 13:
          return _context3.abrupt('return', _context3.sent);

        case 14:
          throw new Error('Unknown algorithm: ' + this.alg);

        case 15:
        case 'end':
          return _context3.stop();
      }
    }
  }, derive, this);
}));

/**
 * Encrypt data with in-memory aes key.
 * @param {Buffer} data
 * @param {Buffer} iv
 * @returns {Buffer}
 */

MasterKey.prototype.encipher = function encipher(data, iv) {
  if (!this.aesKey) return;

  if (typeof iv === 'string') iv = Buffer.from(iv, 'hex');

  return crypto.encipher(data, this.aesKey, iv.slice(0, 16));
};

/**
 * Decrypt data with in-memory aes key.
 * @param {Buffer} data
 * @param {Buffer} iv
 * @returns {Buffer}
 */

MasterKey.prototype.decipher = function decipher(data, iv) {
  if (!this.aesKey) return;

  if (typeof iv === 'string') iv = Buffer.from(iv, 'hex');

  return crypto.decipher(data, this.aesKey, iv.slice(0, 16));
};

/**
 * Destroy the key by zeroing the
 * privateKey and chainCode. Stop
 * the timer if there is one.
 * @returns {Promise}
 */

MasterKey.prototype.lock = co( /*#__PURE__*/_regenerator2.default.mark(function _lock() {
  var unlock;
  return _regenerator2.default.wrap(function _lock$(_context4) {
    while (1) {
      switch (_context4.prev = _context4.next) {
        case 0:
          _context4.next = 2;
          return this.locker.lock();

        case 2:
          unlock = _context4.sent;
          _context4.prev = 3;
          _context4.next = 6;
          return this._lock();

        case 6:
          return _context4.abrupt('return', _context4.sent);

        case 7:
          _context4.prev = 7;

          unlock();
          return _context4.finish(7);

        case 10:
        case 'end':
          return _context4.stop();
      }
    }
  }, _lock, this, [[3,, 7, 10]]);
}));

/**
 * Destroy the key by zeroing the
 * privateKey and chainCode. Stop
 * the timer if there is one.
 */

MasterKey.prototype._lock = function lock() {
  if (!this.encrypted) {
    assert(this.timer == null);
    assert(this.key);
    return;
  }

  this.stop();

  if (this.key) {
    this.key.destroy(true);
    this.key = null;
  }

  if (this.aesKey) {
    crypto.cleanse(this.aesKey);
    this.aesKey = null;
  }
};

/**
 * Destroy the key permanently.
 */

MasterKey.prototype.destroy = co( /*#__PURE__*/_regenerator2.default.mark(function destroy() {
  return _regenerator2.default.wrap(function destroy$(_context5) {
    while (1) {
      switch (_context5.prev = _context5.next) {
        case 0:
          _context5.next = 2;
          return this.lock();

        case 2:
          this.locker.destroy();

        case 3:
        case 'end':
          return _context5.stop();
      }
    }
  }, destroy, this);
}));

/**
 * Decrypt the key permanently.
 * @param {Buffer|String} passphrase - Zero this yourself.
 * @returns {Promise}
 */

MasterKey.prototype.decrypt = co( /*#__PURE__*/_regenerator2.default.mark(function decrypt(passphrase, clean) {
  var unlock;
  return _regenerator2.default.wrap(function decrypt$(_context6) {
    while (1) {
      switch (_context6.prev = _context6.next) {
        case 0:
          _context6.next = 2;
          return this.locker.lock();

        case 2:
          unlock = _context6.sent;
          _context6.prev = 3;
          _context6.next = 6;
          return this._decrypt(passphrase, clean);

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
  }, decrypt, this, [[3,, 7, 10]]);
}));

/**
 * Decrypt the key permanently without a lock.
 * @private
 * @param {Buffer|String} passphrase - Zero this yourself.
 * @returns {Promise}
 */

MasterKey.prototype._decrypt = co( /*#__PURE__*/_regenerator2.default.mark(function decrypt(passphrase, clean) {
  var key, data;
  return _regenerator2.default.wrap(function decrypt$(_context7) {
    while (1) {
      switch (_context7.prev = _context7.next) {
        case 0:
          if (this.encrypted) {
            _context7.next = 2;
            break;
          }

          throw new Error('Master key is not encrypted.');

        case 2:
          if (passphrase) {
            _context7.next = 4;
            break;
          }

          throw new Error('No passphrase provided.');

        case 4:

          this._lock();

          _context7.next = 7;
          return this.derive(passphrase);

        case 7:
          key = _context7.sent;

          data = crypto.decipher(this.ciphertext, key, this.iv);

          this.fromKeyRaw(data);
          this.encrypted = false;
          this.iv = null;
          this.ciphertext = null;

          if (clean) {
            _context7.next = 16;
            break;
          }

          crypto.cleanse(key);
          return _context7.abrupt('return');

        case 16:
          return _context7.abrupt('return', key);

        case 17:
        case 'end':
          return _context7.stop();
      }
    }
  }, decrypt, this);
}));

/**
 * Encrypt the key permanently.
 * @param {Buffer|String} passphrase - Zero this yourself.
 * @returns {Promise}
 */

MasterKey.prototype.encrypt = co( /*#__PURE__*/_regenerator2.default.mark(function encrypt(passphrase, clean) {
  var unlock;
  return _regenerator2.default.wrap(function encrypt$(_context8) {
    while (1) {
      switch (_context8.prev = _context8.next) {
        case 0:
          _context8.next = 2;
          return this.locker.lock();

        case 2:
          unlock = _context8.sent;
          _context8.prev = 3;
          _context8.next = 6;
          return this._encrypt(passphrase, clean);

        case 6:
          return _context8.abrupt('return', _context8.sent);

        case 7:
          _context8.prev = 7;

          unlock();
          return _context8.finish(7);

        case 10:
        case 'end':
          return _context8.stop();
      }
    }
  }, encrypt, this, [[3,, 7, 10]]);
}));

/**
 * Encrypt the key permanently without a lock.
 * @private
 * @param {Buffer|String} passphrase - Zero this yourself.
 * @returns {Promise}
 */

MasterKey.prototype._encrypt = co( /*#__PURE__*/_regenerator2.default.mark(function encrypt(passphrase, clean) {
  var key, data, iv;
  return _regenerator2.default.wrap(function encrypt$(_context9) {
    while (1) {
      switch (_context9.prev = _context9.next) {
        case 0:
          if (!this.encrypted) {
            _context9.next = 2;
            break;
          }

          throw new Error('Master key is already encrypted.');

        case 2:
          if (passphrase) {
            _context9.next = 4;
            break;
          }

          throw new Error('No passphrase provided.');

        case 4:

          data = this.toKeyRaw();
          iv = crypto.randomBytes(16);

          this.stop();

          _context9.next = 9;
          return this.derive(passphrase);

        case 9:
          key = _context9.sent;

          data = crypto.encipher(data, key, iv);

          this.key = null;
          this.mnemonic = null;
          this.encrypted = true;
          this.iv = iv;
          this.ciphertext = data;

          if (clean) {
            _context9.next = 19;
            break;
          }

          crypto.cleanse(key);
          return _context9.abrupt('return');

        case 19:
          return _context9.abrupt('return', key);

        case 20:
        case 'end':
          return _context9.stop();
      }
    }
  }, encrypt, this);
}));

/**
 * Calculate key serialization size.
 * @returns {Number}
 */

MasterKey.prototype.getKeySize = function getKeySize() {
  var size = 0;

  size += this.key.getSize();
  size += 1;

  if (this.mnemonic) size += this.mnemonic.getSize();

  return size;
};

/**
 * Serialize key and menmonic to a single buffer.
 * @returns {Buffer}
 */

MasterKey.prototype.toKeyRaw = function toKeyRaw() {
  var bw = new StaticWriter(this.getKeySize());

  this.key.toWriter(bw);

  if (this.mnemonic) {
    bw.writeU8(1);
    this.mnemonic.toWriter(bw);
  } else {
    bw.writeU8(0);
  }

  return bw.render();
};

/**
 * Inject properties from serialized key.
 * @param {Buffer} data
 */

MasterKey.prototype.fromKeyRaw = function fromKeyRaw(data) {
  var br = new BufferReader(data);

  this.key = HD.PrivateKey.fromReader(br);

  if (br.readU8() === 1) this.mnemonic = Mnemonic.fromReader(br);

  return this;
};

/**
 * Calculate serialization size.
 * @returns {Number}
 */

MasterKey.prototype.getSize = function getSize() {
  var size = 0;

  if (this.encrypted) {
    size += 1;
    size += encoding.sizeVarBytes(this.iv);
    size += encoding.sizeVarBytes(this.ciphertext);
    size += 13;
    return size;
  }

  size += 1;
  size += encoding.sizeVarlen(this.getKeySize());

  return size;
};

/**
 * Serialize the key in the form of:
 * `[enc-flag][iv?][ciphertext?][extended-key?]`
 * @returns {Buffer}
 */

MasterKey.prototype.toRaw = function toRaw() {
  var size = this.getSize();
  var bw = new StaticWriter(size);

  if (this.encrypted) {
    bw.writeU8(1);
    bw.writeVarBytes(this.iv);
    bw.writeVarBytes(this.ciphertext);

    bw.writeU8(this.alg);
    bw.writeU32(this.N);
    bw.writeU32(this.r);
    bw.writeU32(this.p);

    return bw.render();
  }

  bw.writeU8(0);

  // NOTE: useless varint
  size = this.getKeySize();
  bw.writeVarint(size);

  bw.writeBytes(this.key.toRaw());

  if (this.mnemonic) {
    bw.writeU8(1);
    this.mnemonic.toWriter(bw);
  } else {
    bw.writeU8(0);
  }

  return bw.render();
};

/**
 * Inject properties from serialized data.
 * @private
 * @param {Buffer} raw
 */

MasterKey.prototype.fromRaw = function fromRaw(raw) {
  var br = new BufferReader(raw);

  this.encrypted = br.readU8() === 1;

  if (this.encrypted) {
    this.iv = br.readVarBytes();
    this.ciphertext = br.readVarBytes();

    this.alg = br.readU8();

    assert(MasterKey.algByVal[this.alg]);

    this.N = br.readU32();
    this.r = br.readU32();
    this.p = br.readU32();

    return this;
  }

  // NOTE: useless varint
  br.skipVarint();

  this.key = HD.PrivateKey.fromRaw(br.readBytes(82));

  if (br.readU8() === 1) this.mnemonic = Mnemonic.fromReader(br);

  return this;
};

/**
 * Instantiate master key from serialized data.
 * @returns {MasterKey}
 */

MasterKey.fromRaw = function fromRaw(raw) {
  return new MasterKey().fromRaw(raw);
};

/**
 * Inject properties from an HDPrivateKey.
 * @private
 * @param {HDPrivateKey} key
 * @param {Mnemonic?} mnemonic
 */

MasterKey.prototype.fromKey = function fromKey(key, mnemonic) {
  this.encrypted = false;
  this.iv = null;
  this.ciphertext = null;
  this.key = key;
  this.mnemonic = mnemonic || null;
  return this;
};

/**
 * Instantiate master key from an HDPrivateKey.
 * @param {HDPrivateKey} key
 * @param {Mnemonic?} mnemonic
 * @returns {MasterKey}
 */

MasterKey.fromKey = function fromKey(key, mnemonic) {
  return new MasterKey().fromKey(key, mnemonic);
};

/**
 * Convert master key to a jsonifiable object.
 * @param {Boolean?} unsafe - Whether to include
 * the key data in the JSON.
 * @returns {Object}
 */

MasterKey.prototype.toJSON = function toJSON(unsafe) {
  if (this.encrypted) {
    return {
      encrypted: true,
      until: this.until,
      iv: this.iv.toString('hex'),
      ciphertext: unsafe ? this.ciphertext.toString('hex') : undefined,
      algorithm: MasterKey.algByVal[this.alg].toLowerCase(),
      N: this.N,
      r: this.r,
      p: this.p
    };
  }

  return {
    encrypted: false,
    key: unsafe ? this.key.toJSON() : undefined,
    mnemonic: unsafe && this.mnemonic ? this.mnemonic.toJSON() : undefined
  };
};

/**
 * Inspect the key.
 * @returns {Object}
 */

MasterKey.prototype.inspect = function inspect() {
  var json = this.toJSON(true);

  if (this.key) json.key = this.key.toJSON();

  if (this.mnemonic) json.mnemonic = this.mnemonic.toJSON();

  return json;
};

/**
 * Test whether an object is a MasterKey.
 * @param {Object} obj
 * @returns {Boolean}
 */

MasterKey.isMasterKey = function isMasterKey(obj) {
  return obj && typeof obj.encrypted === 'boolean' && typeof obj.decrypt === 'function';
};

/*
 * Expose
 */

module.exports = MasterKey;