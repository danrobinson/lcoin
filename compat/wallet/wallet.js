/*!
 * wallet.js - wallet object for bcoin
 * Copyright (c) 2014-2015, Fedor Indutny (MIT License)
 * Copyright (c) 2014-2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

var _typeof2 = require('babel-runtime/helpers/typeof');

var _typeof3 = _interopRequireDefault(_typeof2);

var _regenerator = require('babel-runtime/regenerator');

var _regenerator2 = _interopRequireDefault(_regenerator);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var assert = require('assert');
var EventEmitter = require('events').EventEmitter;
var Network = require('../protocol/network');
var util = require('../utils/util');
var encoding = require('../utils/encoding');
var Lock = require('../utils/lock');
var co = require('../utils/co');
var crypto = require('../crypto/crypto');
var BufferReader = require('../utils/reader');
var StaticWriter = require('../utils/staticwriter');
var base58 = require('../utils/base58');
var TXDB = require('./txdb');
var Path = require('./path');
var common = require('./common');
var Address = require('../primitives/address');
var MTX = require('../primitives/mtx');
var WalletKey = require('./walletkey');
var HD = require('../hd/hd');
var Output = require('../primitives/output');
var Account = require('./account');
var MasterKey = require('./masterkey');
var LRU = require('../utils/lru');
var policy = require('../protocol/policy');
var consensus = require('../protocol/consensus');
var Mnemonic = HD.Mnemonic;

/**
 * BIP44 Wallet
 * @alias module:wallet.Wallet
 * @constructor
 * @param {Object} options
 * @param {WalletDB} options.db
 * present, no coins will be available.
 * @param {(HDPrivateKey|HDPublicKey)?} options.master - Master HD key. If not
 * present, it will be generated.
 * @param {Boolean?} options.witness - Whether to use witness programs.
 * @param {Number?} options.accountIndex - The BIP44 account index (default=0).
 * @param {Number?} options.receiveDepth - The index of the _next_ receiving
 * address.
 * @param {Number?} options.changeDepth - The index of the _next_ change
 * address.
 * @param {String?} options.type - Type of wallet (pubkeyhash, multisig)
 * (default=pubkeyhash).
 * @param {Boolean?} options.compressed - Whether to use compressed
 * public keys (default=true).
 * @param {Number?} options.m - `m` value for multisig.
 * @param {Number?} options.n - `n` value for multisig.
 * @param {String?} options.id - Wallet ID (used for storage)
 * (default=account key "address").
 */

function Wallet(db, options) {
  if (!(this instanceof Wallet)) return new Wallet(db, options);

  EventEmitter.call(this);

  assert(db, 'DB required.');

  this.db = db;
  this.network = db.network;
  this.logger = db.logger;
  this.readLock = new Lock.Mapped();
  this.writeLock = new Lock();
  this.fundLock = new Lock();
  this.indexCache = new LRU(10000);
  this.accountCache = new LRU(10000);
  this.pathCache = new LRU(100000);
  this.current = null;

  this.wid = 0;
  this.id = null;
  this.initialized = false;
  this.watchOnly = false;
  this.accountDepth = 0;
  this.token = encoding.ZERO_HASH;
  this.tokenDepth = 0;
  this.master = new MasterKey();

  this.txdb = new TXDB(this);
  this.account = null;

  if (options) this.fromOptions(options);
}

util.inherits(Wallet, EventEmitter);

/**
 * Inject properties from options object.
 * @private
 * @param {Object} options
 */

Wallet.prototype.fromOptions = function fromOptions(options) {
  var key = options.master;
  var id, token, mnemonic;

  if (key) {
    if (typeof key === 'string') key = HD.PrivateKey.fromBase58(key, this.network);

    assert(HD.isPrivate(key), 'Must create wallet with hd private key.');
  } else {
    mnemonic = new Mnemonic(options.mnemonic);
    key = HD.fromMnemonic(mnemonic, this.network);
  }

  assert(key.network === this.network, 'Network mismatch for master key.');

  this.master.fromKey(key, mnemonic);

  if (options.wid != null) {
    assert(util.isNumber(options.wid));
    this.wid = options.wid;
  }

  if (options.id) {
    assert(common.isName(options.id), 'Bad wallet ID.');
    id = options.id;
  }

  if (options.initialized != null) {
    assert(typeof options.initialized === 'boolean');
    this.initialized = options.initialized;
  }

  if (options.watchOnly != null) {
    assert(typeof options.watchOnly === 'boolean');
    this.watchOnly = options.watchOnly;
  }

  if (options.accountDepth != null) {
    assert(util.isNumber(options.accountDepth));
    this.accountDepth = options.accountDepth;
  }

  if (options.token) {
    assert(Buffer.isBuffer(options.token));
    assert(options.token.length === 32);
    token = options.token;
  }

  if (options.tokenDepth != null) {
    assert(util.isNumber(options.tokenDepth));
    this.tokenDepth = options.tokenDepth;
  }

  if (!id) id = this.getID();

  if (!token) token = this.getToken(this.tokenDepth);

  this.id = id;
  this.token = token;

  return this;
};

/**
 * Instantiate wallet from options.
 * @param {WalletDB} db
 * @param {Object} options
 * @returns {Wallet}
 */

Wallet.fromOptions = function fromOptions(db, options) {
  return new Wallet(db).fromOptions(options);
};

/**
 * Attempt to intialize the wallet (generating
 * the first addresses along with the lookahead
 * addresses). Called automatically from the
 * walletdb.
 * @returns {Promise}
 */

Wallet.prototype.init = co( /*#__PURE__*/_regenerator2.default.mark(function init(options) {
  var passphrase, account;
  return _regenerator2.default.wrap(function init$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:
          passphrase = options.passphrase;


          assert(!this.initialized);
          this.initialized = true;

          if (!passphrase) {
            _context.next = 6;
            break;
          }

          _context.next = 6;
          return this.master.encrypt(passphrase);

        case 6:
          _context.next = 8;
          return this._createAccount(options, passphrase);

        case 8:
          account = _context.sent;

          assert(account);

          this.account = account;

          this.logger.info('Wallet initialized (%s).', this.id);

          _context.next = 14;
          return this.txdb.open();

        case 14:
        case 'end':
          return _context.stop();
      }
    }
  }, init, this);
}));

/**
 * Open wallet (done after retrieval).
 * @returns {Promise}
 */

Wallet.prototype.open = co( /*#__PURE__*/_regenerator2.default.mark(function open() {
  var account;
  return _regenerator2.default.wrap(function open$(_context2) {
    while (1) {
      switch (_context2.prev = _context2.next) {
        case 0:

          assert(this.initialized);

          _context2.next = 3;
          return this.getAccount(0);

        case 3:
          account = _context2.sent;

          if (account) {
            _context2.next = 6;
            break;
          }

          throw new Error('Default account not found.');

        case 6:

          this.account = account;

          this.logger.info('Wallet opened (%s).', this.id);

          _context2.next = 10;
          return this.txdb.open();

        case 10:
        case 'end':
          return _context2.stop();
      }
    }
  }, open, this);
}));

/**
 * Close the wallet, unregister with the database.
 * @returns {Promise}
 */

Wallet.prototype.destroy = co( /*#__PURE__*/_regenerator2.default.mark(function destroy() {
  var unlock1, unlock2;
  return _regenerator2.default.wrap(function destroy$(_context3) {
    while (1) {
      switch (_context3.prev = _context3.next) {
        case 0:
          _context3.next = 2;
          return this.writeLock.lock();

        case 2:
          unlock1 = _context3.sent;
          _context3.next = 5;
          return this.fundLock.lock();

        case 5:
          unlock2 = _context3.sent;
          _context3.prev = 6;

          this.db.unregister(this);
          _context3.next = 10;
          return this.master.destroy();

        case 10:
          this.readLock.destroy();
          this.writeLock.destroy();
          this.fundLock.destroy();

        case 13:
          _context3.prev = 13;

          unlock2();
          unlock1();
          return _context3.finish(13);

        case 17:
        case 'end':
          return _context3.stop();
      }
    }
  }, destroy, this, [[6,, 13, 17]]);
}));

/**
 * Add a public account key to the wallet (multisig).
 * Saves the key in the wallet database.
 * @param {(Number|String)} acct
 * @param {HDPublicKey} key
 * @returns {Promise}
 */

Wallet.prototype.addSharedKey = co( /*#__PURE__*/_regenerator2.default.mark(function addSharedKey(acct, key) {
  var unlock;
  return _regenerator2.default.wrap(function addSharedKey$(_context4) {
    while (1) {
      switch (_context4.prev = _context4.next) {
        case 0:
          _context4.next = 2;
          return this.writeLock.lock();

        case 2:
          unlock = _context4.sent;
          _context4.prev = 3;
          _context4.next = 6;
          return this._addSharedKey(acct, key);

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
  }, addSharedKey, this, [[3,, 7, 10]]);
}));

/**
 * Add a public account key to the wallet without a lock.
 * @private
 * @param {(Number|String)} acct
 * @param {HDPublicKey} key
 * @returns {Promise}
 */

Wallet.prototype._addSharedKey = co( /*#__PURE__*/_regenerator2.default.mark(function addSharedKey(acct, key) {
  var account, result;
  return _regenerator2.default.wrap(function addSharedKey$(_context5) {
    while (1) {
      switch (_context5.prev = _context5.next) {
        case 0:

          if (!key) {
            key = acct;
            acct = null;
          }

          if (acct == null) acct = 0;

          _context5.next = 4;
          return this.getAccount(acct);

        case 4:
          account = _context5.sent;

          if (account) {
            _context5.next = 7;
            break;
          }

          throw new Error('Account not found.');

        case 7:

          this.start();

          _context5.prev = 8;
          _context5.next = 11;
          return account.addSharedKey(key);

        case 11:
          result = _context5.sent;
          _context5.next = 18;
          break;

        case 14:
          _context5.prev = 14;
          _context5.t0 = _context5['catch'](8);

          this.drop();
          throw _context5.t0;

        case 18:
          _context5.next = 20;
          return this.commit();

        case 20:
          return _context5.abrupt('return', result);

        case 21:
        case 'end':
          return _context5.stop();
      }
    }
  }, addSharedKey, this, [[8, 14]]);
}));

/**
 * Remove a public account key from the wallet (multisig).
 * @param {(Number|String)} acct
 * @param {HDPublicKey} key
 * @returns {Promise}
 */

Wallet.prototype.removeSharedKey = co( /*#__PURE__*/_regenerator2.default.mark(function removeSharedKey(acct, key) {
  var unlock;
  return _regenerator2.default.wrap(function removeSharedKey$(_context6) {
    while (1) {
      switch (_context6.prev = _context6.next) {
        case 0:
          _context6.next = 2;
          return this.writeLock.lock();

        case 2:
          unlock = _context6.sent;
          _context6.prev = 3;
          _context6.next = 6;
          return this._removeSharedKey(acct, key);

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
  }, removeSharedKey, this, [[3,, 7, 10]]);
}));

/**
 * Remove a public account key from the wallet (multisig).
 * @private
 * @param {(Number|String)} acct
 * @param {HDPublicKey} key
 * @returns {Promise}
 */

Wallet.prototype._removeSharedKey = co( /*#__PURE__*/_regenerator2.default.mark(function removeSharedKey(acct, key) {
  var account, result;
  return _regenerator2.default.wrap(function removeSharedKey$(_context7) {
    while (1) {
      switch (_context7.prev = _context7.next) {
        case 0:

          if (!key) {
            key = acct;
            acct = null;
          }

          if (acct == null) acct = 0;

          _context7.next = 4;
          return this.getAccount(acct);

        case 4:
          account = _context7.sent;

          if (account) {
            _context7.next = 7;
            break;
          }

          throw new Error('Account not found.');

        case 7:

          this.start();

          _context7.prev = 8;
          _context7.next = 11;
          return account.removeSharedKey(key);

        case 11:
          result = _context7.sent;
          _context7.next = 18;
          break;

        case 14:
          _context7.prev = 14;
          _context7.t0 = _context7['catch'](8);

          this.drop();
          throw _context7.t0;

        case 18:
          _context7.next = 20;
          return this.commit();

        case 20:
          return _context7.abrupt('return', result);

        case 21:
        case 'end':
          return _context7.stop();
      }
    }
  }, removeSharedKey, this, [[8, 14]]);
}));

/**
 * Change or set master key's passphrase.
 * @param {(String|Buffer)?} old
 * @param {String|Buffer} new_
 * @returns {Promise}
 */

Wallet.prototype.setPassphrase = co( /*#__PURE__*/_regenerator2.default.mark(function setPassphrase(old, new_) {
  return _regenerator2.default.wrap(function setPassphrase$(_context8) {
    while (1) {
      switch (_context8.prev = _context8.next) {
        case 0:
          if (new_ == null) {
            new_ = old;
            old = null;
          }

          if (!(old != null)) {
            _context8.next = 4;
            break;
          }

          _context8.next = 4;
          return this.decrypt(old);

        case 4:
          if (!(new_ != null)) {
            _context8.next = 7;
            break;
          }

          _context8.next = 7;
          return this.encrypt(new_);

        case 7:
        case 'end':
          return _context8.stop();
      }
    }
  }, setPassphrase, this);
}));

/**
 * Encrypt the wallet permanently.
 * @param {String|Buffer} passphrase
 * @returns {Promise}
 */

Wallet.prototype.encrypt = co( /*#__PURE__*/_regenerator2.default.mark(function encrypt(passphrase) {
  var unlock;
  return _regenerator2.default.wrap(function encrypt$(_context9) {
    while (1) {
      switch (_context9.prev = _context9.next) {
        case 0:
          _context9.next = 2;
          return this.writeLock.lock();

        case 2:
          unlock = _context9.sent;
          _context9.prev = 3;
          _context9.next = 6;
          return this._encrypt(passphrase);

        case 6:
          return _context9.abrupt('return', _context9.sent);

        case 7:
          _context9.prev = 7;

          unlock();
          return _context9.finish(7);

        case 10:
        case 'end':
          return _context9.stop();
      }
    }
  }, encrypt, this, [[3,, 7, 10]]);
}));

/**
 * Encrypt the wallet permanently, without a lock.
 * @private
 * @param {String|Buffer} passphrase
 * @returns {Promise}
 */

Wallet.prototype._encrypt = co( /*#__PURE__*/_regenerator2.default.mark(function encrypt(passphrase) {
  var key;
  return _regenerator2.default.wrap(function encrypt$(_context10) {
    while (1) {
      switch (_context10.prev = _context10.next) {
        case 0:
          _context10.next = 2;
          return this.master.encrypt(passphrase, true);

        case 2:
          key = _context10.sent;


          this.start();

          _context10.prev = 4;
          _context10.next = 7;
          return this.db.encryptKeys(this, key);

        case 7:
          _context10.next = 14;
          break;

        case 9:
          _context10.prev = 9;
          _context10.t0 = _context10['catch'](4);

          crypto.cleanse(key);
          this.drop();
          throw _context10.t0;

        case 14:

          crypto.cleanse(key);

          this.save();

          _context10.next = 18;
          return this.commit();

        case 18:
        case 'end':
          return _context10.stop();
      }
    }
  }, encrypt, this, [[4, 9]]);
}));

/**
 * Decrypt the wallet permanently.
 * @param {String|Buffer} passphrase
 * @returns {Promise}
 */

Wallet.prototype.decrypt = co( /*#__PURE__*/_regenerator2.default.mark(function decrypt(passphrase) {
  var unlock;
  return _regenerator2.default.wrap(function decrypt$(_context11) {
    while (1) {
      switch (_context11.prev = _context11.next) {
        case 0:
          _context11.next = 2;
          return this.writeLock.lock();

        case 2:
          unlock = _context11.sent;
          _context11.prev = 3;
          _context11.next = 6;
          return this._decrypt(passphrase);

        case 6:
          return _context11.abrupt('return', _context11.sent);

        case 7:
          _context11.prev = 7;

          unlock();
          return _context11.finish(7);

        case 10:
        case 'end':
          return _context11.stop();
      }
    }
  }, decrypt, this, [[3,, 7, 10]]);
}));

/**
 * Decrypt the wallet permanently, without a lock.
 * @private
 * @param {String|Buffer} passphrase
 * @returns {Promise}
 */

Wallet.prototype._decrypt = co( /*#__PURE__*/_regenerator2.default.mark(function decrypt(passphrase) {
  var key;
  return _regenerator2.default.wrap(function decrypt$(_context12) {
    while (1) {
      switch (_context12.prev = _context12.next) {
        case 0:
          _context12.next = 2;
          return this.master.decrypt(passphrase, true);

        case 2:
          key = _context12.sent;


          this.start();

          _context12.prev = 4;
          _context12.next = 7;
          return this.db.decryptKeys(this, key);

        case 7:
          _context12.next = 14;
          break;

        case 9:
          _context12.prev = 9;
          _context12.t0 = _context12['catch'](4);

          crypto.cleanse(key);
          this.drop();
          throw _context12.t0;

        case 14:

          crypto.cleanse(key);

          this.save();

          _context12.next = 18;
          return this.commit();

        case 18:
        case 'end':
          return _context12.stop();
      }
    }
  }, decrypt, this, [[4, 9]]);
}));

/**
 * Generate a new token.
 * @param {(String|Buffer)?} passphrase
 * @returns {Promise}
 */

Wallet.prototype.retoken = co( /*#__PURE__*/_regenerator2.default.mark(function retoken(passphrase) {
  var unlock;
  return _regenerator2.default.wrap(function retoken$(_context13) {
    while (1) {
      switch (_context13.prev = _context13.next) {
        case 0:
          _context13.next = 2;
          return this.writeLock.lock();

        case 2:
          unlock = _context13.sent;
          _context13.prev = 3;
          _context13.next = 6;
          return this._retoken(passphrase);

        case 6:
          return _context13.abrupt('return', _context13.sent);

        case 7:
          _context13.prev = 7;

          unlock();
          return _context13.finish(7);

        case 10:
        case 'end':
          return _context13.stop();
      }
    }
  }, retoken, this, [[3,, 7, 10]]);
}));

/**
 * Generate a new token without a lock.
 * @private
 * @param {(String|Buffer)?} passphrase
 * @returns {Promise}
 */

Wallet.prototype._retoken = co( /*#__PURE__*/_regenerator2.default.mark(function retoken(passphrase) {
  return _regenerator2.default.wrap(function retoken$(_context14) {
    while (1) {
      switch (_context14.prev = _context14.next) {
        case 0:
          _context14.next = 2;
          return this.unlock(passphrase);

        case 2:

          this.tokenDepth++;
          this.token = this.getToken(this.tokenDepth);

          this.start();
          this.save();

          _context14.next = 8;
          return this.commit();

        case 8:
          return _context14.abrupt('return', this.token);

        case 9:
        case 'end':
          return _context14.stop();
      }
    }
  }, retoken, this);
}));

/**
 * Rename the wallet.
 * @param {String} id
 * @returns {Promise}
 */

Wallet.prototype.rename = co( /*#__PURE__*/_regenerator2.default.mark(function rename(id) {
  var unlock;
  return _regenerator2.default.wrap(function rename$(_context15) {
    while (1) {
      switch (_context15.prev = _context15.next) {
        case 0:
          _context15.next = 2;
          return this.writeLock.lock();

        case 2:
          unlock = _context15.sent;
          _context15.prev = 3;
          _context15.next = 6;
          return this.db.rename(this, id);

        case 6:
          return _context15.abrupt('return', _context15.sent);

        case 7:
          _context15.prev = 7;

          unlock();
          return _context15.finish(7);

        case 10:
        case 'end':
          return _context15.stop();
      }
    }
  }, rename, this, [[3,, 7, 10]]);
}));

/**
 * Rename account.
 * @param {(String|Number)?} acct
 * @param {String} name
 * @returns {Promise}
 */

Wallet.prototype.renameAccount = co( /*#__PURE__*/_regenerator2.default.mark(function renameAccount(acct, name) {
  var unlock;
  return _regenerator2.default.wrap(function renameAccount$(_context16) {
    while (1) {
      switch (_context16.prev = _context16.next) {
        case 0:
          _context16.next = 2;
          return this.writeLock.lock();

        case 2:
          unlock = _context16.sent;
          _context16.prev = 3;
          _context16.next = 6;
          return this._renameAccount(acct, name);

        case 6:
          return _context16.abrupt('return', _context16.sent);

        case 7:
          _context16.prev = 7;

          unlock();
          return _context16.finish(7);

        case 10:
        case 'end':
          return _context16.stop();
      }
    }
  }, renameAccount, this, [[3,, 7, 10]]);
}));

/**
 * Rename account without a lock.
 * @private
 * @param {(String|Number)?} acct
 * @param {String} name
 * @returns {Promise}
 */

Wallet.prototype._renameAccount = co( /*#__PURE__*/_regenerator2.default.mark(function _renameAccount(acct, name) {
  var i, account, old, paths, path;
  return _regenerator2.default.wrap(function _renameAccount$(_context17) {
    while (1) {
      switch (_context17.prev = _context17.next) {
        case 0:
          if (common.isName(name)) {
            _context17.next = 2;
            break;
          }

          throw new Error('Bad account name.');

        case 2:
          _context17.next = 4;
          return this.getAccount(acct);

        case 4:
          account = _context17.sent;

          if (account) {
            _context17.next = 7;
            break;
          }

          throw new Error('Account not found.');

        case 7:
          if (!(account.accountIndex === 0)) {
            _context17.next = 9;
            break;
          }

          throw new Error('Cannot rename default account.');

        case 9:
          _context17.next = 11;
          return this.hasAccount(name);

        case 11:
          if (!_context17.sent) {
            _context17.next = 13;
            break;
          }

          throw new Error('Account name not available.');

        case 13:

          old = account.name;

          this.start();

          this.db.renameAccount(account, name);

          _context17.next = 18;
          return this.commit();

        case 18:

          this.indexCache.remove(old);

          paths = this.pathCache.values();

          i = 0;

        case 21:
          if (!(i < paths.length)) {
            _context17.next = 29;
            break;
          }

          path = paths[i];

          if (!(path.account !== account.accountIndex)) {
            _context17.next = 25;
            break;
          }

          return _context17.abrupt('continue', 26);

        case 25:

          path.name = name;

        case 26:
          i++;
          _context17.next = 21;
          break;

        case 29:
        case 'end':
          return _context17.stop();
      }
    }
  }, _renameAccount, this);
}));

/**
 * Lock the wallet, destroy decrypted key.
 */

Wallet.prototype.lock = co( /*#__PURE__*/_regenerator2.default.mark(function lock() {
  var unlock1, unlock2;
  return _regenerator2.default.wrap(function lock$(_context18) {
    while (1) {
      switch (_context18.prev = _context18.next) {
        case 0:
          _context18.next = 2;
          return this.writeLock.lock();

        case 2:
          unlock1 = _context18.sent;
          _context18.next = 5;
          return this.fundLock.lock();

        case 5:
          unlock2 = _context18.sent;
          _context18.prev = 6;
          _context18.next = 9;
          return this.master.lock();

        case 9:
          _context18.prev = 9;

          unlock2();
          unlock1();
          return _context18.finish(9);

        case 13:
        case 'end':
          return _context18.stop();
      }
    }
  }, lock, this, [[6,, 9, 13]]);
}));

/**
 * Unlock the key for `timeout` seconds.
 * @param {Buffer|String} passphrase
 * @param {Number?} [timeout=60]
 */

Wallet.prototype.unlock = function unlock(passphrase, timeout) {
  return this.master.unlock(passphrase, timeout);
};

/**
 * Generate the wallet ID if none was passed in.
 * It is represented as HASH160(m/44->public|magic)
 * converted to an "address" with a prefix
 * of `0x03be04` (`WLT` in base58).
 * @private
 * @returns {Base58String}
 */

Wallet.prototype.getID = function getID() {
  var bw, key, hash;

  assert(this.master.key, 'Cannot derive id.');

  key = this.master.key.derive(44);

  bw = new StaticWriter(37);
  bw.writeBytes(key.publicKey);
  bw.writeU32(this.network.magic);

  hash = crypto.hash160(bw.render());

  bw = new StaticWriter(27);
  bw.writeU8(0x03);
  bw.writeU8(0xbe);
  bw.writeU8(0x04);
  bw.writeBytes(hash);
  bw.writeChecksum();

  return base58.encode(bw.render());
};

/**
 * Generate the wallet api key if none was passed in.
 * It is represented as HASH256(m/44'->private|nonce).
 * @private
 * @param {HDPrivateKey} master
 * @param {Number} nonce
 * @returns {Buffer}
 */

Wallet.prototype.getToken = function getToken(nonce) {
  var bw, key;

  assert(this.master.key, 'Cannot derive token.');

  key = this.master.key.derive(44, true);

  bw = new StaticWriter(36);
  bw.writeBytes(key.privateKey);
  bw.writeU32(nonce);

  return crypto.hash256(bw.render());
};

/**
 * Create an account. Requires passphrase if master key is encrypted.
 * @param {Object} options - See {@link Account} options.
 * @returns {Promise} - Returns {@link Account}.
 */

Wallet.prototype.createAccount = co( /*#__PURE__*/_regenerator2.default.mark(function createAccount(options, passphrase) {
  var unlock;
  return _regenerator2.default.wrap(function createAccount$(_context19) {
    while (1) {
      switch (_context19.prev = _context19.next) {
        case 0:
          _context19.next = 2;
          return this.writeLock.lock();

        case 2:
          unlock = _context19.sent;
          _context19.prev = 3;
          _context19.next = 6;
          return this._createAccount(options, passphrase);

        case 6:
          return _context19.abrupt('return', _context19.sent);

        case 7:
          _context19.prev = 7;

          unlock();
          return _context19.finish(7);

        case 10:
        case 'end':
          return _context19.stop();
      }
    }
  }, createAccount, this, [[3,, 7, 10]]);
}));

/**
 * Create an account without a lock.
 * @param {Object} options - See {@link Account} options.
 * @returns {Promise} - Returns {@link Account}.
 */

Wallet.prototype._createAccount = co( /*#__PURE__*/_regenerator2.default.mark(function createAccount(options, passphrase) {
  var name, key, account, exists;
  return _regenerator2.default.wrap(function createAccount$(_context20) {
    while (1) {
      switch (_context20.prev = _context20.next) {
        case 0:
          name = options.name;


          if (!name) name = this.accountDepth + '';

          _context20.next = 4;
          return this.hasAccount(name);

        case 4:
          exists = _context20.sent;

          if (!exists) {
            _context20.next = 7;
            break;
          }

          throw new Error('Account already exists.');

        case 7:
          _context20.next = 9;
          return this.unlock(passphrase);

        case 9:
          if (!(this.watchOnly && options.accountKey)) {
            _context20.next = 17;
            break;
          }

          key = options.accountKey;

          if (typeof key === 'string') key = HD.PublicKey.fromBase58(key, this.network);

          if (HD.isPublic(key)) {
            _context20.next = 14;
            break;
          }

          throw new Error('Must add HD public keys to watch only wallet.');

        case 14:

          assert(key.network === this.network, 'Network mismatch for watch only key.');
          _context20.next = 20;
          break;

        case 17:
          assert(this.master.key);
          key = this.master.key.deriveAccount44(this.accountDepth);
          key = key.toPublic();

        case 20:

          options = {
            wid: this.wid,
            id: this.id,
            name: this.accountDepth === 0 ? 'default' : name,
            witness: options.witness,
            watchOnly: this.watchOnly,
            accountKey: key,
            accountIndex: this.accountDepth,
            type: options.type,
            m: options.m,
            n: options.n,
            keys: options.keys
          };

          this.start();

          _context20.prev = 22;

          account = Account.fromOptions(this.db, options);
          account.wallet = this;
          _context20.next = 27;
          return account.init();

        case 27:
          _context20.next = 33;
          break;

        case 29:
          _context20.prev = 29;
          _context20.t0 = _context20['catch'](22);

          this.drop();
          throw _context20.t0;

        case 33:

          this.logger.info('Created account %s/%s/%d.', account.id, account.name, account.accountIndex);

          this.accountDepth++;
          this.save();

          _context20.next = 38;
          return this.commit();

        case 38:
          return _context20.abrupt('return', account);

        case 39:
        case 'end':
          return _context20.stop();
      }
    }
  }, createAccount, this, [[22, 29]]);
}));

/**
 * Ensure an account. Requires passphrase if master key is encrypted.
 * @param {Object} options - See {@link Account} options.
 * @returns {Promise} - Returns {@link Account}.
 */

Wallet.prototype.ensureAccount = co( /*#__PURE__*/_regenerator2.default.mark(function ensureAccount(options, passphrase) {
  var name, account;
  return _regenerator2.default.wrap(function ensureAccount$(_context21) {
    while (1) {
      switch (_context21.prev = _context21.next) {
        case 0:
          name = options.name;
          _context21.next = 3;
          return this.getAccount(name);

        case 3:
          account = _context21.sent;

          if (!account) {
            _context21.next = 6;
            break;
          }

          return _context21.abrupt('return', account);

        case 6:
          _context21.next = 8;
          return this.createAccount(options, passphrase);

        case 8:
          return _context21.abrupt('return', _context21.sent);

        case 9:
        case 'end':
          return _context21.stop();
      }
    }
  }, ensureAccount, this);
}));

/**
 * List account names and indexes from the db.
 * @returns {Promise} - Returns Array.
 */

Wallet.prototype.getAccounts = function getAccounts() {
  return this.db.getAccounts(this.wid);
};

/**
 * Get all wallet address hashes.
 * @param {(String|Number)?} acct
 * @returns {Promise} - Returns Array.
 */

Wallet.prototype.getAddressHashes = function getAddressHashes(acct) {
  if (acct != null) return this.getAccountHashes(acct);
  return this.db.getWalletHashes(this.wid);
};

/**
 * Get all account address hashes.
 * @param {String|Number} acct
 * @returns {Promise} - Returns Array.
 */

Wallet.prototype.getAccountHashes = co( /*#__PURE__*/_regenerator2.default.mark(function getAccountHashes(acct) {
  var index;
  return _regenerator2.default.wrap(function getAccountHashes$(_context22) {
    while (1) {
      switch (_context22.prev = _context22.next) {
        case 0:
          _context22.next = 2;
          return this.ensureIndex(acct, true);

        case 2:
          index = _context22.sent;
          _context22.next = 5;
          return this.db.getAccountHashes(this.wid, index);

        case 5:
          return _context22.abrupt('return', _context22.sent);

        case 6:
        case 'end':
          return _context22.stop();
      }
    }
  }, getAccountHashes, this);
}));

/**
 * Retrieve an account from the database.
 * @param {Number|String} acct
 * @returns {Promise} - Returns {@link Account}.
 */

Wallet.prototype.getAccount = co( /*#__PURE__*/_regenerator2.default.mark(function getAccount(acct) {
  var index, unlock;
  return _regenerator2.default.wrap(function getAccount$(_context23) {
    while (1) {
      switch (_context23.prev = _context23.next) {
        case 0:
          if (!this.account) {
            _context23.next = 3;
            break;
          }

          if (!(acct === 0 || acct === 'default')) {
            _context23.next = 3;
            break;
          }

          return _context23.abrupt('return', this.account);

        case 3:
          _context23.next = 5;
          return this.getAccountIndex(acct);

        case 5:
          index = _context23.sent;

          if (!(index === -1)) {
            _context23.next = 8;
            break;
          }

          return _context23.abrupt('return');

        case 8:
          _context23.next = 10;
          return this.readLock.lock(index);

        case 10:
          unlock = _context23.sent;
          _context23.prev = 11;
          _context23.next = 14;
          return this._getAccount(index);

        case 14:
          return _context23.abrupt('return', _context23.sent);

        case 15:
          _context23.prev = 15;

          unlock();
          return _context23.finish(15);

        case 18:
        case 'end':
          return _context23.stop();
      }
    }
  }, getAccount, this, [[11,, 15, 18]]);
}));

/**
 * Retrieve an account from the database without a lock.
 * @param {Number} index
 * @returns {Promise} - Returns {@link Account}.
 */

Wallet.prototype._getAccount = co( /*#__PURE__*/_regenerator2.default.mark(function getAccount(index) {
  var account;
  return _regenerator2.default.wrap(function getAccount$(_context24) {
    while (1) {
      switch (_context24.prev = _context24.next) {
        case 0:
          account = this.accountCache.get(index);

          if (!account) {
            _context24.next = 3;
            break;
          }

          return _context24.abrupt('return', account);

        case 3:
          _context24.next = 5;
          return this.db.getAccount(this.wid, index);

        case 5:
          account = _context24.sent;

          if (account) {
            _context24.next = 8;
            break;
          }

          return _context24.abrupt('return');

        case 8:

          account.wallet = this;
          account.wid = this.wid;
          account.id = this.id;
          account.watchOnly = this.watchOnly;

          _context24.next = 14;
          return account.open();

        case 14:

          this.accountCache.set(index, account);

          return _context24.abrupt('return', account);

        case 16:
        case 'end':
          return _context24.stop();
      }
    }
  }, getAccount, this);
}));

/**
 * Lookup the corresponding account name's index.
 * @param {WalletID} wid
 * @param {String|Number} name - Account name/index.
 * @returns {Promise} - Returns Number.
 */

Wallet.prototype.getAccountIndex = co( /*#__PURE__*/_regenerator2.default.mark(function getAccountIndex(name) {
  var index;
  return _regenerator2.default.wrap(function getAccountIndex$(_context25) {
    while (1) {
      switch (_context25.prev = _context25.next) {
        case 0:
          if (!(name == null)) {
            _context25.next = 2;
            break;
          }

          return _context25.abrupt('return', -1);

        case 2:
          if (!(typeof name === 'number')) {
            _context25.next = 4;
            break;
          }

          return _context25.abrupt('return', name);

        case 4:

          index = this.indexCache.get(name);

          if (!(index != null)) {
            _context25.next = 7;
            break;
          }

          return _context25.abrupt('return', index);

        case 7:
          _context25.next = 9;
          return this.db.getAccountIndex(this.wid, name);

        case 9:
          index = _context25.sent;

          if (!(index === -1)) {
            _context25.next = 12;
            break;
          }

          return _context25.abrupt('return', -1);

        case 12:

          this.indexCache.set(name, index);

          return _context25.abrupt('return', index);

        case 14:
        case 'end':
          return _context25.stop();
      }
    }
  }, getAccountIndex, this);
}));

/**
 * Lookup the corresponding account index's name.
 * @param {WalletID} wid
 * @param {Number} index - Account index.
 * @returns {Promise} - Returns String.
 */

Wallet.prototype.getAccountName = co( /*#__PURE__*/_regenerator2.default.mark(function getAccountName(index) {
  var account;
  return _regenerator2.default.wrap(function getAccountName$(_context26) {
    while (1) {
      switch (_context26.prev = _context26.next) {
        case 0:
          if (!(typeof index === 'string')) {
            _context26.next = 2;
            break;
          }

          return _context26.abrupt('return', index);

        case 2:

          account = this.accountCache.get(index);

          if (!account) {
            _context26.next = 5;
            break;
          }

          return _context26.abrupt('return', account.name);

        case 5:
          _context26.next = 7;
          return this.db.getAccountName(this.wid, index);

        case 7:
          return _context26.abrupt('return', _context26.sent);

        case 8:
        case 'end':
          return _context26.stop();
      }
    }
  }, getAccountName, this);
}));

/**
 * Test whether an account exists.
 * @param {Number|String} acct
 * @returns {Promise} - Returns {@link Boolean}.
 */

Wallet.prototype.hasAccount = co( /*#__PURE__*/_regenerator2.default.mark(function hasAccount(acct) {
  var index;
  return _regenerator2.default.wrap(function hasAccount$(_context27) {
    while (1) {
      switch (_context27.prev = _context27.next) {
        case 0:
          _context27.next = 2;
          return this.getAccountIndex(acct);

        case 2:
          index = _context27.sent;

          if (!(index === -1)) {
            _context27.next = 5;
            break;
          }

          return _context27.abrupt('return', false);

        case 5:
          if (!this.accountCache.has(index)) {
            _context27.next = 7;
            break;
          }

          return _context27.abrupt('return', true);

        case 7:
          _context27.next = 9;
          return this.db.hasAccount(this.wid, index);

        case 9:
          return _context27.abrupt('return', _context27.sent);

        case 10:
        case 'end':
          return _context27.stop();
      }
    }
  }, hasAccount, this);
}));

/**
 * Create a new receiving address (increments receiveDepth).
 * @param {(Number|String)?} acct
 * @returns {Promise} - Returns {@link WalletKey}.
 */

Wallet.prototype.createReceive = function createReceive(acct) {
  return this.createKey(acct, 0);
};

/**
 * Create a new change address (increments receiveDepth).
 * @param {(Number|String)?} acct
 * @returns {Promise} - Returns {@link WalletKey}.
 */

Wallet.prototype.createChange = function createChange(acct) {
  return this.createKey(acct, 1);
};

/**
 * Create a new nested address (increments receiveDepth).
 * @param {(Number|String)?} acct
 * @returns {Promise} - Returns {@link WalletKey}.
 */

Wallet.prototype.createNested = function createNested(acct) {
  return this.createKey(acct, 2);
};

/**
 * Create a new address (increments depth).
 * @param {(Number|String)?} acct
 * @param {Number} branch
 * @returns {Promise} - Returns {@link WalletKey}.
 */

Wallet.prototype.createKey = co( /*#__PURE__*/_regenerator2.default.mark(function createKey(acct, branch) {
  var unlock;
  return _regenerator2.default.wrap(function createKey$(_context28) {
    while (1) {
      switch (_context28.prev = _context28.next) {
        case 0:
          _context28.next = 2;
          return this.writeLock.lock();

        case 2:
          unlock = _context28.sent;
          _context28.prev = 3;
          _context28.next = 6;
          return this._createKey(acct, branch);

        case 6:
          return _context28.abrupt('return', _context28.sent);

        case 7:
          _context28.prev = 7;

          unlock();
          return _context28.finish(7);

        case 10:
        case 'end':
          return _context28.stop();
      }
    }
  }, createKey, this, [[3,, 7, 10]]);
}));

/**
 * Create a new address (increments depth) without a lock.
 * @private
 * @param {(Number|String)?} acct
 * @param {Number} branche
 * @returns {Promise} - Returns {@link WalletKey}.
 */

Wallet.prototype._createKey = co( /*#__PURE__*/_regenerator2.default.mark(function createKey(acct, branch) {
  var account, result;
  return _regenerator2.default.wrap(function createKey$(_context29) {
    while (1) {
      switch (_context29.prev = _context29.next) {
        case 0:

          if (branch == null) {
            branch = acct;
            acct = null;
          }

          if (acct == null) acct = 0;

          _context29.next = 4;
          return this.getAccount(acct);

        case 4:
          account = _context29.sent;

          if (account) {
            _context29.next = 7;
            break;
          }

          throw new Error('Account not found.');

        case 7:

          this.start();

          _context29.prev = 8;
          _context29.next = 11;
          return account.createKey(branch);

        case 11:
          result = _context29.sent;
          _context29.next = 18;
          break;

        case 14:
          _context29.prev = 14;
          _context29.t0 = _context29['catch'](8);

          this.drop();
          throw _context29.t0;

        case 18:
          _context29.next = 20;
          return this.commit();

        case 20:
          return _context29.abrupt('return', result);

        case 21:
        case 'end':
          return _context29.stop();
      }
    }
  }, createKey, this, [[8, 14]]);
}));

/**
 * Save the wallet to the database. Necessary
 * when address depth and keys change.
 * @returns {Promise}
 */

Wallet.prototype.save = function save() {
  return this.db.save(this);
};

/**
 * Start batch.
 * @private
 */

Wallet.prototype.start = function start() {
  return this.db.start(this);
};

/**
 * Drop batch.
 * @private
 */

Wallet.prototype.drop = function drop() {
  return this.db.drop(this);
};

/**
 * Clear batch.
 * @private
 */

Wallet.prototype.clear = function clear() {
  return this.db.clear(this);
};

/**
 * Save batch.
 * @returns {Promise}
 */

Wallet.prototype.commit = function commit() {
  return this.db.commit(this);
};

/**
 * Test whether the wallet possesses an address.
 * @param {Address|Hash} address
 * @returns {Promise} - Returns Boolean.
 */

Wallet.prototype.hasAddress = co( /*#__PURE__*/_regenerator2.default.mark(function hasAddress(address) {
  var hash, path;
  return _regenerator2.default.wrap(function hasAddress$(_context30) {
    while (1) {
      switch (_context30.prev = _context30.next) {
        case 0:
          hash = Address.getHash(address, 'hex');
          _context30.next = 3;
          return this.getPath(hash);

        case 3:
          path = _context30.sent;
          return _context30.abrupt('return', path != null);

        case 5:
        case 'end':
          return _context30.stop();
      }
    }
  }, hasAddress, this);
}));

/**
 * Get path by address hash.
 * @param {Address|Hash} address
 * @returns {Promise} - Returns {@link Path}.
 */

Wallet.prototype.getPath = co( /*#__PURE__*/_regenerator2.default.mark(function getPath(address) {
  var path;
  return _regenerator2.default.wrap(function getPath$(_context31) {
    while (1) {
      switch (_context31.prev = _context31.next) {
        case 0:
          _context31.next = 2;
          return this.readPath(address);

        case 2:
          path = _context31.sent;

          if (path) {
            _context31.next = 5;
            break;
          }

          return _context31.abrupt('return');

        case 5:
          _context31.next = 7;
          return this.getAccountName(path.account);

        case 7:
          path.name = _context31.sent;


          assert(path.name);

          this.pathCache.set(path.hash, path);

          return _context31.abrupt('return', path);

        case 11:
        case 'end':
          return _context31.stop();
      }
    }
  }, getPath, this);
}));

/**
 * Get path by address hash (without account name).
 * @private
 * @param {Address|Hash} address
 * @returns {Promise} - Returns {@link Path}.
 */

Wallet.prototype.readPath = co( /*#__PURE__*/_regenerator2.default.mark(function readPath(address) {
  var hash, path;
  return _regenerator2.default.wrap(function readPath$(_context32) {
    while (1) {
      switch (_context32.prev = _context32.next) {
        case 0:
          hash = Address.getHash(address, 'hex');
          path = this.pathCache.get(hash);

          if (!path) {
            _context32.next = 4;
            break;
          }

          return _context32.abrupt('return', path);

        case 4:
          _context32.next = 6;
          return this.db.getPath(this.wid, hash);

        case 6:
          path = _context32.sent;

          if (path) {
            _context32.next = 9;
            break;
          }

          return _context32.abrupt('return');

        case 9:

          path.id = this.id;

          return _context32.abrupt('return', path);

        case 11:
        case 'end':
          return _context32.stop();
      }
    }
  }, readPath, this);
}));

/**
 * Test whether the wallet contains a path.
 * @param {Address|Hash} address
 * @returns {Promise} - Returns {Boolean}.
 */

Wallet.prototype.hasPath = co( /*#__PURE__*/_regenerator2.default.mark(function hasPath(address) {
  var hash;
  return _regenerator2.default.wrap(function hasPath$(_context33) {
    while (1) {
      switch (_context33.prev = _context33.next) {
        case 0:
          hash = Address.getHash(address, 'hex');

          if (!this.pathCache.has(hash)) {
            _context33.next = 3;
            break;
          }

          return _context33.abrupt('return', true);

        case 3:
          _context33.next = 5;
          return this.db.hasPath(this.wid, hash);

        case 5:
          return _context33.abrupt('return', _context33.sent);

        case 6:
        case 'end':
          return _context33.stop();
      }
    }
  }, hasPath, this);
}));

/**
 * Get all wallet paths.
 * @param {(String|Number)?} acct
 * @returns {Promise} - Returns {@link Path}.
 */

Wallet.prototype.getPaths = co( /*#__PURE__*/_regenerator2.default.mark(function getPaths(acct) {
  var i, paths, path, result;
  return _regenerator2.default.wrap(function getPaths$(_context34) {
    while (1) {
      switch (_context34.prev = _context34.next) {
        case 0:
          if (!(acct != null)) {
            _context34.next = 4;
            break;
          }

          _context34.next = 3;
          return this.getAccountPaths(acct);

        case 3:
          return _context34.abrupt('return', _context34.sent);

        case 4:
          _context34.next = 6;
          return this.db.getWalletPaths(this.wid);

        case 6:
          paths = _context34.sent;

          result = [];

          i = 0;

        case 9:
          if (!(i < paths.length)) {
            _context34.next = 21;
            break;
          }

          path = paths[i];
          path.id = this.id;
          _context34.next = 14;
          return this.getAccountName(path.account);

        case 14:
          path.name = _context34.sent;


          assert(path.name);

          this.pathCache.set(path.hash, path);

          result.push(path);

        case 18:
          i++;
          _context34.next = 9;
          break;

        case 21:
          return _context34.abrupt('return', result);

        case 22:
        case 'end':
          return _context34.stop();
      }
    }
  }, getPaths, this);
}));

/**
 * Get all account paths.
 * @param {String|Number} acct
 * @returns {Promise} - Returns {@link Path}.
 */

Wallet.prototype.getAccountPaths = co( /*#__PURE__*/_regenerator2.default.mark(function getAccountPaths(acct) {
  var index, hashes, name, result, i, hash, path;
  return _regenerator2.default.wrap(function getAccountPaths$(_context35) {
    while (1) {
      switch (_context35.prev = _context35.next) {
        case 0:
          _context35.next = 2;
          return this.ensureIndex(acct, true);

        case 2:
          index = _context35.sent;
          _context35.next = 5;
          return this.getAccountHashes(index);

        case 5:
          hashes = _context35.sent;
          _context35.next = 8;
          return this.getAccountName(acct);

        case 8:
          name = _context35.sent;
          result = [];


          assert(name);

          i = 0;

        case 12:
          if (!(i < hashes.length)) {
            _context35.next = 25;
            break;
          }

          hash = hashes[i];
          _context35.next = 16;
          return this.readPath(hash);

        case 16:
          path = _context35.sent;


          assert(path);
          assert(path.account === index);

          path.name = name;

          this.pathCache.set(path.hash, path);

          result.push(path);

        case 22:
          i++;
          _context35.next = 12;
          break;

        case 25:
          return _context35.abrupt('return', result);

        case 26:
        case 'end':
          return _context35.stop();
      }
    }
  }, getAccountPaths, this);
}));

/**
 * Import a keyring (will not exist on derivation chain).
 * Rescanning must be invoked manually.
 * @param {(String|Number)?} acct
 * @param {WalletKey} ring
 * @param {(String|Buffer)?} passphrase
 * @returns {Promise}
 */

Wallet.prototype.importKey = co( /*#__PURE__*/_regenerator2.default.mark(function importKey(acct, ring, passphrase) {
  var unlock;
  return _regenerator2.default.wrap(function importKey$(_context36) {
    while (1) {
      switch (_context36.prev = _context36.next) {
        case 0:
          _context36.next = 2;
          return this.writeLock.lock();

        case 2:
          unlock = _context36.sent;
          _context36.prev = 3;
          _context36.next = 6;
          return this._importKey(acct, ring, passphrase);

        case 6:
          return _context36.abrupt('return', _context36.sent);

        case 7:
          _context36.prev = 7;

          unlock();
          return _context36.finish(7);

        case 10:
        case 'end':
          return _context36.stop();
      }
    }
  }, importKey, this, [[3,, 7, 10]]);
}));

/**
 * Import a keyring (will not exist on derivation chain) without a lock.
 * @private
 * @param {(String|Number)?} acct
 * @param {WalletKey} ring
 * @param {(String|Buffer)?} passphrase
 * @returns {Promise}
 */

Wallet.prototype._importKey = co( /*#__PURE__*/_regenerator2.default.mark(function importKey(acct, ring, passphrase) {
  var account, exists, path;
  return _regenerator2.default.wrap(function importKey$(_context37) {
    while (1) {
      switch (_context37.prev = _context37.next) {
        case 0:

          if (acct && (typeof acct === 'undefined' ? 'undefined' : (0, _typeof3.default)(acct)) === 'object') {
            passphrase = ring;
            ring = acct;
            acct = null;
          }

          if (acct == null) acct = 0;

          assert(ring.network === this.network, 'Network mismatch for key.');

          if (this.watchOnly) {
            _context37.next = 8;
            break;
          }

          if (ring.privateKey) {
            _context37.next = 6;
            break;
          }

          throw new Error('Cannot import pubkey into non watch-only wallet.');

        case 6:
          _context37.next = 10;
          break;

        case 8:
          if (!ring.privateKey) {
            _context37.next = 10;
            break;
          }

          throw new Error('Cannot import privkey into watch-only wallet.');

        case 10:
          _context37.next = 12;
          return this.getPath(ring.getHash('hex'));

        case 12:
          exists = _context37.sent;

          if (!exists) {
            _context37.next = 15;
            break;
          }

          throw new Error('Key already exists.');

        case 15:
          _context37.next = 17;
          return this.getAccount(acct);

        case 17:
          account = _context37.sent;

          if (account) {
            _context37.next = 20;
            break;
          }

          throw new Error('Account not found.');

        case 20:
          if (!(account.type !== Account.types.PUBKEYHASH)) {
            _context37.next = 22;
            break;
          }

          throw new Error('Cannot import into non-pkh account.');

        case 22:
          _context37.next = 24;
          return this.unlock(passphrase);

        case 24:

          ring = WalletKey.fromRing(account, ring);
          path = ring.toPath();

          if (this.master.encrypted) {
            path.data = this.master.encipher(path.data, path.hash);
            assert(path.data);
            path.encrypted = true;
          }

          this.start();

          _context37.prev = 28;
          _context37.next = 31;
          return account.savePath(path);

        case 31:
          _context37.next = 37;
          break;

        case 33:
          _context37.prev = 33;
          _context37.t0 = _context37['catch'](28);

          this.drop();
          throw _context37.t0;

        case 37:
          _context37.next = 39;
          return this.commit();

        case 39:
        case 'end':
          return _context37.stop();
      }
    }
  }, importKey, this, [[28, 33]]);
}));

/**
 * Import a keyring (will not exist on derivation chain).
 * Rescanning must be invoked manually.
 * @param {(String|Number)?} acct
 * @param {WalletKey} ring
 * @param {(String|Buffer)?} passphrase
 * @returns {Promise}
 */

Wallet.prototype.importAddress = co( /*#__PURE__*/_regenerator2.default.mark(function importAddress(acct, address) {
  var unlock;
  return _regenerator2.default.wrap(function importAddress$(_context38) {
    while (1) {
      switch (_context38.prev = _context38.next) {
        case 0:
          _context38.next = 2;
          return this.writeLock.lock();

        case 2:
          unlock = _context38.sent;
          _context38.prev = 3;
          _context38.next = 6;
          return this._importAddress(acct, address);

        case 6:
          return _context38.abrupt('return', _context38.sent);

        case 7:
          _context38.prev = 7;

          unlock();
          return _context38.finish(7);

        case 10:
        case 'end':
          return _context38.stop();
      }
    }
  }, importAddress, this, [[3,, 7, 10]]);
}));

/**
 * Import a keyring (will not exist on derivation chain) without a lock.
 * @private
 * @param {(String|Number)?} acct
 * @param {WalletKey} ring
 * @param {(String|Buffer)?} passphrase
 * @returns {Promise}
 */

Wallet.prototype._importAddress = co( /*#__PURE__*/_regenerator2.default.mark(function importAddress(acct, address) {
  var account, exists, path;
  return _regenerator2.default.wrap(function importAddress$(_context39) {
    while (1) {
      switch (_context39.prev = _context39.next) {
        case 0:

          if (!address) {
            address = acct;
            acct = null;
          }

          if (acct == null) acct = 0;

          assert(address.network === this.network, 'Network mismatch for address.');

          if (this.watchOnly) {
            _context39.next = 5;
            break;
          }

          throw new Error('Cannot import address into non watch-only wallet.');

        case 5:
          _context39.next = 7;
          return this.getPath(address);

        case 7:
          exists = _context39.sent;

          if (!exists) {
            _context39.next = 10;
            break;
          }

          throw new Error('Address already exists.');

        case 10:
          _context39.next = 12;
          return this.getAccount(acct);

        case 12:
          account = _context39.sent;

          if (account) {
            _context39.next = 15;
            break;
          }

          throw new Error('Account not found.');

        case 15:
          if (!(account.type !== Account.types.PUBKEYHASH)) {
            _context39.next = 17;
            break;
          }

          throw new Error('Cannot import into non-pkh account.');

        case 17:

          path = Path.fromAddress(account, address);

          this.start();

          _context39.prev = 19;
          _context39.next = 22;
          return account.savePath(path);

        case 22:
          _context39.next = 28;
          break;

        case 24:
          _context39.prev = 24;
          _context39.t0 = _context39['catch'](19);

          this.drop();
          throw _context39.t0;

        case 28:
          _context39.next = 30;
          return this.commit();

        case 30:
        case 'end':
          return _context39.stop();
      }
    }
  }, importAddress, this, [[19, 24]]);
}));

/**
 * Fill a transaction with inputs, estimate
 * transaction size, calculate fee, and add a change output.
 * @see MTX#selectCoins
 * @see MTX#fill
 * @param {MTX} mtx - _Must_ be a mutable transaction.
 * @param {Object?} options
 * @param {(String|Number)?} options.account - If no account is
 * specified, coins from the entire wallet will be filled.
 * @param {String?} options.selection - Coin selection priority. Can
 * be `age`, `random`, or `all`. (default=age).
 * @param {Boolean} options.round - Whether to round to the nearest
 * kilobyte for fee calculation.
 * See {@link TX#getMinFee} vs. {@link TX#getRoundFee}.
 * @param {Rate} options.rate - Rate used for fee calculation.
 * @param {Boolean} options.confirmed - Select only confirmed coins.
 * @param {Boolean} options.free - Do not apply a fee if the
 * transaction priority is high enough to be considered free.
 * @param {Amount?} options.hardFee - Use a hard fee rather than
 * calculating one.
 * @param {Number|Boolean} options.subtractFee - Whether to subtract the
 * fee from existing outputs rather than adding more inputs.
 */

Wallet.prototype.fund = co( /*#__PURE__*/_regenerator2.default.mark(function fund(mtx, options, force) {
  var unlock;
  return _regenerator2.default.wrap(function fund$(_context40) {
    while (1) {
      switch (_context40.prev = _context40.next) {
        case 0:
          _context40.next = 2;
          return this.fundLock.lock(force);

        case 2:
          unlock = _context40.sent;
          _context40.prev = 3;
          _context40.next = 6;
          return this._fund(mtx, options);

        case 6:
          return _context40.abrupt('return', _context40.sent);

        case 7:
          _context40.prev = 7;

          unlock();
          return _context40.finish(7);

        case 10:
        case 'end':
          return _context40.stop();
      }
    }
  }, fund, this, [[3,, 7, 10]]);
}));

/**
 * Fill a transaction with inputs without a lock.
 * @private
 * @see MTX#selectCoins
 * @see MTX#fill
 */

Wallet.prototype._fund = co( /*#__PURE__*/_regenerator2.default.mark(function fund(mtx, options) {
  var rate, account, coins;
  return _regenerator2.default.wrap(function fund$(_context41) {
    while (1) {
      switch (_context41.prev = _context41.next) {
        case 0:

          if (!options) options = {};

          if (this.initialized) {
            _context41.next = 3;
            break;
          }

          throw new Error('Wallet is not initialized.');

        case 3:
          if (!this.watchOnly) {
            _context41.next = 5;
            break;
          }

          throw new Error('Cannot fund from watch-only wallet.');

        case 5:
          if (!(options.account != null)) {
            _context41.next = 13;
            break;
          }

          _context41.next = 8;
          return this.getAccount(options.account);

        case 8:
          account = _context41.sent;

          if (account) {
            _context41.next = 11;
            break;
          }

          throw new Error('Account not found.');

        case 11:
          _context41.next = 14;
          break;

        case 13:
          account = this.account;

        case 14:
          if (account.initialized) {
            _context41.next = 16;
            break;
          }

          throw new Error('Account is not initialized.');

        case 16:

          rate = options.rate;

          if (!(rate == null)) {
            _context41.next = 21;
            break;
          }

          _context41.next = 20;
          return this.db.estimateFee(options.blocks);

        case 20:
          rate = _context41.sent;

        case 21:
          if (!options.smart) {
            _context41.next = 27;
            break;
          }

          _context41.next = 24;
          return this.getSmartCoins(options.account);

        case 24:
          coins = _context41.sent;
          _context41.next = 31;
          break;

        case 27:
          _context41.next = 29;
          return this.getCoins(options.account);

        case 29:
          coins = _context41.sent;

          coins = this.txdb.filterLocked(coins);

        case 31:
          _context41.next = 33;
          return mtx.fund(coins, {
            selection: options.selection,
            round: options.round,
            depth: options.depth,
            hardFee: options.hardFee,
            subtractFee: options.subtractFee,
            changeAddress: account.change.getAddress(),
            height: this.db.state.height,
            rate: rate,
            maxFee: options.maxFee,
            estimate: this.estimateSize.bind(this)
          });

        case 33:

          assert(mtx.getFee() <= MTX.Selector.MAX_FEE, 'TX exceeds MAX_FEE.');

        case 34:
        case 'end':
          return _context41.stop();
      }
    }
  }, fund, this);
}));

/**
 * Get account by address.
 * @param {Address} address
 * @returns {Account}
 */

Wallet.prototype.getAccountByAddress = co( /*#__PURE__*/_regenerator2.default.mark(function getAccountByAddress(address) {
  var hash, path;
  return _regenerator2.default.wrap(function getAccountByAddress$(_context42) {
    while (1) {
      switch (_context42.prev = _context42.next) {
        case 0:
          hash = Address.getHash(address, 'hex');
          _context42.next = 3;
          return this.getPath(hash);

        case 3:
          path = _context42.sent;

          if (path) {
            _context42.next = 6;
            break;
          }

          return _context42.abrupt('return');

        case 6:
          _context42.next = 8;
          return this.getAccount(path.account);

        case 8:
          return _context42.abrupt('return', _context42.sent);

        case 9:
        case 'end':
          return _context42.stop();
      }
    }
  }, getAccountByAddress, this);
}));

/**
 * Input size estimator for max possible tx size.
 * @param {Script} prev
 * @returns {Number}
 */

Wallet.prototype.estimateSize = co( /*#__PURE__*/_regenerator2.default.mark(function estimateSize(prev) {
  var scale, address, size, account;
  return _regenerator2.default.wrap(function estimateSize$(_context43) {
    while (1) {
      switch (_context43.prev = _context43.next) {
        case 0:
          scale = consensus.WITNESS_SCALE_FACTOR;
          address = prev.getAddress();
          size = 0;

          if (address) {
            _context43.next = 5;
            break;
          }

          return _context43.abrupt('return', -1);

        case 5:
          _context43.next = 7;
          return this.getAccountByAddress(address);

        case 7:
          account = _context43.sent;

          if (account) {
            _context43.next = 10;
            break;
          }

          return _context43.abrupt('return', -1);

        case 10:
          if (!prev.isScripthash()) {
            _context43.next = 21;
            break;
          }

          if (!account.witness) {
            _context43.next = 21;
            break;
          }

          _context43.t0 = account.type;
          _context43.next = _context43.t0 === Account.types.PUBKEYHASH ? 15 : _context43.t0 === Account.types.MULTISIG ? 18 : 21;
          break;

        case 15:
          size += 23; // redeem script
          size *= 4; // vsize
          return _context43.abrupt('break', 21);

        case 18:
          size += 35; // redeem script
          size *= 4; // vsize
          return _context43.abrupt('break', 21);

        case 21:
          _context43.t1 = account.type;
          _context43.next = _context43.t1 === Account.types.PUBKEYHASH ? 24 : _context43.t1 === Account.types.MULTISIG ? 27 : 35;
          break;

        case 24:
          // P2PKH
          // OP_PUSHDATA0 [signature]
          size += 1 + 73;
          // OP_PUSHDATA0 [key]
          size += 1 + 33;
          return _context43.abrupt('break', 35);

        case 27:
          // P2SH Multisig
          // OP_0
          size += 1;
          // OP_PUSHDATA0 [signature] ...
          size += (1 + 73) * account.m;
          // OP_PUSHDATA2 [redeem]
          size += 3;
          // m value
          size += 1;
          // OP_PUSHDATA0 [key] ...
          size += (1 + 33) * account.n;
          // n value
          size += 1;
          // OP_CHECKMULTISIG
          size += 1;
          return _context43.abrupt('break', 35);

        case 35:

          if (account.witness) {
            // Varint witness items length.
            size += 1;
            // Calculate vsize if
            // we're a witness program.
            size = (size + scale - 1) / scale | 0;
          } else {
            // Byte for varint
            // size of input script.
            size += encoding.sizeVarint(size);
          }

          return _context43.abrupt('return', size);

        case 37:
        case 'end':
          return _context43.stop();
      }
    }
  }, estimateSize, this);
}));

/**
 * Build a transaction, fill it with outputs and inputs,
 * sort the members according to BIP69 (set options.sort=false
 * to avoid sorting), set locktime, and template it.
 * @param {Object} options - See {@link Wallet#fund options}.
 * @param {Object[]} options.outputs - See {@link MTX#addOutput}.
 * @returns {Promise} - Returns {@link MTX}.
 */

Wallet.prototype.createTX = co( /*#__PURE__*/_regenerator2.default.mark(function createTX(options, force) {
  var outputs, mtx, i, output, addr, total;
  return _regenerator2.default.wrap(function createTX$(_context44) {
    while (1) {
      switch (_context44.prev = _context44.next) {
        case 0:
          outputs = options.outputs;
          mtx = new MTX();


          assert(Array.isArray(outputs), 'Outputs must be an array.');
          assert(outputs.length > 0, 'No outputs available.');

          // Add the outputs
          i = 0;

        case 5:
          if (!(i < outputs.length)) {
            _context44.next = 19;
            break;
          }

          output = new Output(outputs[i]);
          addr = output.getAddress();

          if (!output.isDust()) {
            _context44.next = 10;
            break;
          }

          throw new Error('Output is dust.');

        case 10:
          if (!(output.value > 0)) {
            _context44.next = 15;
            break;
          }

          if (addr) {
            _context44.next = 13;
            break;
          }

          throw new Error('Cannot send to unknown address.');

        case 13:
          if (!addr.isNull()) {
            _context44.next = 15;
            break;
          }

          throw new Error('Cannot send to null address.');

        case 15:

          mtx.outputs.push(output);

        case 16:
          i++;
          _context44.next = 5;
          break;

        case 19:
          _context44.next = 21;
          return this.fund(mtx, options, force);

        case 21:

          // Sort members a la BIP69
          if (options.sort !== false) mtx.sortMembers();

          // Set the locktime to target value.
          if (options.locktime != null) mtx.setLocktime(options.locktime);

          // Consensus sanity checks.
          assert(mtx.isSane(), 'TX failed sanity check.');
          assert(mtx.checkInputs(this.db.state.height + 1), 'CheckInputs failed.');

          _context44.next = 27;
          return this.template(mtx);

        case 27:
          total = _context44.sent;

          if (!(total === 0)) {
            _context44.next = 30;
            break;
          }

          throw new Error('Templating failed.');

        case 30:
          return _context44.abrupt('return', mtx);

        case 31:
        case 'end':
          return _context44.stop();
      }
    }
  }, createTX, this);
}));

/**
 * Build a transaction, fill it with outputs and inputs,
 * sort the members according to BIP69, set locktime,
 * sign and broadcast. Doing this all in one go prevents
 * coins from being double spent.
 * @param {Object} options - See {@link Wallet#fund options}.
 * @param {Object[]} options.outputs - See {@link MTX#addOutput}.
 * @returns {Promise} - Returns {@link TX}.
 */

Wallet.prototype.send = co( /*#__PURE__*/_regenerator2.default.mark(function send(options, passphrase) {
  var unlock;
  return _regenerator2.default.wrap(function send$(_context45) {
    while (1) {
      switch (_context45.prev = _context45.next) {
        case 0:
          _context45.next = 2;
          return this.fundLock.lock();

        case 2:
          unlock = _context45.sent;
          _context45.prev = 3;
          _context45.next = 6;
          return this._send(options, passphrase);

        case 6:
          return _context45.abrupt('return', _context45.sent);

        case 7:
          _context45.prev = 7;

          unlock();
          return _context45.finish(7);

        case 10:
        case 'end':
          return _context45.stop();
      }
    }
  }, send, this, [[3,, 7, 10]]);
}));

/**
 * Build and send a transaction without a lock.
 * @private
 * @param {Object} options - See {@link Wallet#fund options}.
 * @param {Object[]} options.outputs - See {@link MTX#addOutput}.
 * @returns {Promise} - Returns {@link TX}.
 */

Wallet.prototype._send = co( /*#__PURE__*/_regenerator2.default.mark(function send(options, passphrase) {
  var mtx, tx;
  return _regenerator2.default.wrap(function send$(_context46) {
    while (1) {
      switch (_context46.prev = _context46.next) {
        case 0:
          _context46.next = 2;
          return this.createTX(options, true);

        case 2:
          mtx = _context46.sent;
          _context46.next = 5;
          return this.sign(mtx, passphrase);

        case 5:
          if (mtx.isSigned()) {
            _context46.next = 7;
            break;
          }

          throw new Error('TX could not be fully signed.');

        case 7:

          tx = mtx.toTX();

          // Policy sanity checks.

          if (!(tx.getSigopsCost(mtx.view) > policy.MAX_TX_SIGOPS_COST)) {
            _context46.next = 10;
            break;
          }

          throw new Error('TX exceeds policy sigops.');

        case 10:
          if (!(tx.getWeight() > policy.MAX_TX_WEIGHT)) {
            _context46.next = 12;
            break;
          }

          throw new Error('TX exceeds policy weight.');

        case 12:
          _context46.next = 14;
          return this.db.addTX(tx);

        case 14:

          this.logger.debug('Sending wallet tx (%s): %s', this.id, tx.txid());

          _context46.next = 17;
          return this.db.send(tx);

        case 17:
          return _context46.abrupt('return', tx);

        case 18:
        case 'end':
          return _context46.stop();
      }
    }
  }, send, this);
}));

/**
 * Intentionally double-spend outputs by
 * increasing fee for an existing transaction.
 * @param {Hash} hash
 * @param {Rate} rate
 * @param {(String|Buffer)?} passphrase
 * @returns {Promise} - Returns {@link TX}.
 */

Wallet.prototype.increaseFee = co( /*#__PURE__*/_regenerator2.default.mark(function increaseFee(hash, rate, passphrase) {
  var wtx, i, tx, mtx, view, oldFee, fee, path, input, output, change, addr;
  return _regenerator2.default.wrap(function increaseFee$(_context47) {
    while (1) {
      switch (_context47.prev = _context47.next) {
        case 0:
          _context47.next = 2;
          return this.getTX(hash);

        case 2:
          wtx = _context47.sent;


          assert(util.isUInt32(rate), 'Rate must be a number.');

          if (wtx) {
            _context47.next = 6;
            break;
          }

          throw new Error('Transaction not found.');

        case 6:
          if (!(wtx.height !== -1)) {
            _context47.next = 8;
            break;
          }

          throw new Error('Transaction is confirmed.');

        case 8:

          tx = wtx.tx;

          if (!tx.isCoinbase()) {
            _context47.next = 11;
            break;
          }

          throw new Error('Transaction is a coinbase.');

        case 11:
          _context47.next = 13;
          return this.getSpentView(tx);

        case 13:
          view = _context47.sent;

          if (tx.hasCoins(view)) {
            _context47.next = 16;
            break;
          }

          throw new Error('Not all coins available.');

        case 16:

          oldFee = tx.getFee(view);
          fee = tx.getMinFee(null, rate);

          if (fee > MTX.Selector.MAX_FEE) fee = MTX.Selector.MAX_FEE;

          if (!(oldFee >= fee)) {
            _context47.next = 21;
            break;
          }

          throw new Error('Fee is not increasing.');

        case 21:

          mtx = MTX.fromTX(tx);
          mtx.view = view;

          for (i = 0; i < mtx.inputs.length; i++) {
            input = mtx.inputs[i];
            input.script.length = 0;
            input.script.compile();
            input.witness.length = 0;
            input.witness.compile();
          }

          i = 0;

        case 25:
          if (!(i < mtx.outputs.length)) {
            _context47.next = 42;
            break;
          }

          output = mtx.outputs[i];
          addr = output.getAddress();

          if (addr) {
            _context47.next = 30;
            break;
          }

          return _context47.abrupt('continue', 39);

        case 30:
          _context47.next = 32;
          return this.getPath(addr);

        case 32:
          path = _context47.sent;

          if (path) {
            _context47.next = 35;
            break;
          }

          return _context47.abrupt('continue', 39);

        case 35:
          if (!(path.branch === 1)) {
            _context47.next = 39;
            break;
          }

          change = output;
          mtx.changeIndex = i;
          return _context47.abrupt('break', 42);

        case 39:
          i++;
          _context47.next = 25;
          break;

        case 42:
          if (change) {
            _context47.next = 44;
            break;
          }

          throw new Error('No change output.');

        case 44:

          change.value += oldFee;

          if (!(mtx.getFee() !== 0)) {
            _context47.next = 47;
            break;
          }

          throw new Error('Arithmetic error for change.');

        case 47:

          change.value -= fee;

          if (!(change.value < 0)) {
            _context47.next = 50;
            break;
          }

          throw new Error('Fee is too high.');

        case 50:

          if (change.isDust()) {
            mtx.outputs.splice(mtx.changeIndex, 1);
            mtx.changeIndex = -1;
          }

          _context47.next = 53;
          return this.sign(mtx, passphrase);

        case 53:
          if (mtx.isSigned()) {
            _context47.next = 55;
            break;
          }

          throw new Error('TX could not be fully signed.');

        case 55:

          tx = mtx.toTX();

          this.logger.debug('Increasing fee for wallet tx (%s): %s', this.id, tx.txid());

          _context47.next = 59;
          return this.db.addTX(tx);

        case 59:
          _context47.next = 61;
          return this.db.send(tx);

        case 61:
          return _context47.abrupt('return', tx);

        case 62:
        case 'end':
          return _context47.stop();
      }
    }
  }, increaseFee, this);
}));

/**
 * Resend pending wallet transactions.
 * @returns {Promise}
 */

Wallet.prototype.resend = co( /*#__PURE__*/_regenerator2.default.mark(function resend() {
  var wtxs, txs, i, wtx;
  return _regenerator2.default.wrap(function resend$(_context48) {
    while (1) {
      switch (_context48.prev = _context48.next) {
        case 0:
          _context48.next = 2;
          return this.getPending();

        case 2:
          wtxs = _context48.sent;
          txs = [];


          if (wtxs.length > 0) this.logger.info('Rebroadcasting %d transactions.', wtxs.length);

          for (i = 0; i < wtxs.length; i++) {
            wtx = wtxs[i];
            txs.push(wtx.tx);
          }

          txs = common.sortDeps(txs);

          i = 0;

        case 8:
          if (!(i < txs.length)) {
            _context48.next = 14;
            break;
          }

          _context48.next = 11;
          return this.db.send(txs[i]);

        case 11:
          i++;
          _context48.next = 8;
          break;

        case 14:
          return _context48.abrupt('return', txs);

        case 15:
        case 'end':
          return _context48.stop();
      }
    }
  }, resend, this);
}));

/**
 * Derive necessary addresses for signing a transaction.
 * @param {MTX} mtx
 * @param {Number?} index - Input index.
 * @returns {Promise} - Returns {@link WalletKey}[].
 */

Wallet.prototype.deriveInputs = co( /*#__PURE__*/_regenerator2.default.mark(function deriveInputs(mtx) {
  var rings, i, paths, path, account, ring;
  return _regenerator2.default.wrap(function deriveInputs$(_context49) {
    while (1) {
      switch (_context49.prev = _context49.next) {
        case 0:
          rings = [];


          assert(mtx.mutable);

          _context49.next = 4;
          return this.getInputPaths(mtx);

        case 4:
          paths = _context49.sent;
          i = 0;

        case 6:
          if (!(i < paths.length)) {
            _context49.next = 18;
            break;
          }

          path = paths[i];
          _context49.next = 10;
          return this.getAccount(path.account);

        case 10:
          account = _context49.sent;

          if (account) {
            _context49.next = 13;
            break;
          }

          return _context49.abrupt('continue', 15);

        case 13:

          ring = account.derivePath(path, this.master);

          if (ring) rings.push(ring);

        case 15:
          i++;
          _context49.next = 6;
          break;

        case 18:
          return _context49.abrupt('return', rings);

        case 19:
        case 'end':
          return _context49.stop();
      }
    }
  }, deriveInputs, this);
}));

/**
 * Retrieve a single keyring by address.
 * @param {Address|Hash} hash
 * @returns {Promise}
 */

Wallet.prototype.getKey = co( /*#__PURE__*/_regenerator2.default.mark(function getKey(address) {
  var hash, path, account;
  return _regenerator2.default.wrap(function getKey$(_context50) {
    while (1) {
      switch (_context50.prev = _context50.next) {
        case 0:
          hash = Address.getHash(address, 'hex');
          _context50.next = 3;
          return this.getPath(hash);

        case 3:
          path = _context50.sent;

          if (path) {
            _context50.next = 6;
            break;
          }

          return _context50.abrupt('return');

        case 6:
          _context50.next = 8;
          return this.getAccount(path.account);

        case 8:
          account = _context50.sent;

          if (account) {
            _context50.next = 11;
            break;
          }

          return _context50.abrupt('return');

        case 11:
          return _context50.abrupt('return', account.derivePath(path, this.master));

        case 12:
        case 'end':
          return _context50.stop();
      }
    }
  }, getKey, this);
}));

/**
 * Retrieve a single keyring by address
 * (with the private key reference).
 * @param {Address|Hash} hash
 * @param {(Buffer|String)?} passphrase
 * @returns {Promise}
 */

Wallet.prototype.getPrivateKey = co( /*#__PURE__*/_regenerator2.default.mark(function getPrivateKey(address, passphrase) {
  var hash, path, account, key;
  return _regenerator2.default.wrap(function getPrivateKey$(_context51) {
    while (1) {
      switch (_context51.prev = _context51.next) {
        case 0:
          hash = Address.getHash(address, 'hex');
          _context51.next = 3;
          return this.getPath(hash);

        case 3:
          path = _context51.sent;

          if (path) {
            _context51.next = 6;
            break;
          }

          return _context51.abrupt('return');

        case 6:
          _context51.next = 8;
          return this.getAccount(path.account);

        case 8:
          account = _context51.sent;

          if (account) {
            _context51.next = 11;
            break;
          }

          return _context51.abrupt('return');

        case 11:
          _context51.next = 13;
          return this.unlock(passphrase);

        case 13:

          key = account.derivePath(path, this.master);

          if (key.privateKey) {
            _context51.next = 16;
            break;
          }

          return _context51.abrupt('return');

        case 16:
          return _context51.abrupt('return', key);

        case 17:
        case 'end':
          return _context51.stop();
      }
    }
  }, getPrivateKey, this);
}));

/**
 * Map input addresses to paths.
 * @param {MTX} mtx
 * @returns {Promise} - Returns {@link Path}[].
 */

Wallet.prototype.getInputPaths = co( /*#__PURE__*/_regenerator2.default.mark(function getInputPaths(mtx) {
  var paths, i, hashes, hash, path;
  return _regenerator2.default.wrap(function getInputPaths$(_context52) {
    while (1) {
      switch (_context52.prev = _context52.next) {
        case 0:
          paths = [];


          assert(mtx.mutable);

          if (mtx.hasCoins()) {
            _context52.next = 4;
            break;
          }

          throw new Error('Not all coins available.');

        case 4:

          hashes = mtx.getInputHashes('hex');

          i = 0;

        case 6:
          if (!(i < hashes.length)) {
            _context52.next = 15;
            break;
          }

          hash = hashes[i];
          _context52.next = 10;
          return this.getPath(hash);

        case 10:
          path = _context52.sent;

          if (path) paths.push(path);

        case 12:
          i++;
          _context52.next = 6;
          break;

        case 15:
          return _context52.abrupt('return', paths);

        case 16:
        case 'end':
          return _context52.stop();
      }
    }
  }, getInputPaths, this);
}));

/**
 * Map output addresses to paths.
 * @param {TX} tx
 * @returns {Promise} - Returns {@link Path}[].
 */

Wallet.prototype.getOutputPaths = co( /*#__PURE__*/_regenerator2.default.mark(function getOutputPaths(tx) {
  var paths, hashes, i, hash, path;
  return _regenerator2.default.wrap(function getOutputPaths$(_context53) {
    while (1) {
      switch (_context53.prev = _context53.next) {
        case 0:
          paths = [];
          hashes = tx.getOutputHashes('hex');
          i = 0;

        case 3:
          if (!(i < hashes.length)) {
            _context53.next = 12;
            break;
          }

          hash = hashes[i];
          _context53.next = 7;
          return this.getPath(hash);

        case 7:
          path = _context53.sent;

          if (path) paths.push(path);

        case 9:
          i++;
          _context53.next = 3;
          break;

        case 12:
          return _context53.abrupt('return', paths);

        case 13:
        case 'end':
          return _context53.stop();
      }
    }
  }, getOutputPaths, this);
}));

/**
 * Increase lookahead for account.
 * @param {(Number|String)?} account
 * @param {Number} lookahead
 * @returns {Promise}
 */

Wallet.prototype.setLookahead = co( /*#__PURE__*/_regenerator2.default.mark(function setLookahead(acct, lookahead) {
  var unlock;
  return _regenerator2.default.wrap(function setLookahead$(_context54) {
    while (1) {
      switch (_context54.prev = _context54.next) {
        case 0:
          _context54.next = 2;
          return this.writeLock.lock();

        case 2:
          unlock = _context54.sent;
          _context54.prev = 3;
          return _context54.abrupt('return', this._setLookahead(acct, lookahead));

        case 5:
          _context54.prev = 5;

          unlock();
          return _context54.finish(5);

        case 8:
        case 'end':
          return _context54.stop();
      }
    }
  }, setLookahead, this, [[3,, 5, 8]]);
}));

/**
 * Increase lookahead for account (without a lock).
 * @private
 * @param {(Number|String)?} account
 * @param {Number} lookahead
 * @returns {Promise}
 */

Wallet.prototype._setLookahead = co( /*#__PURE__*/_regenerator2.default.mark(function setLookahead(acct, lookahead) {
  var account;
  return _regenerator2.default.wrap(function setLookahead$(_context55) {
    while (1) {
      switch (_context55.prev = _context55.next) {
        case 0:

          if (lookahead == null) {
            lookahead = acct;
            acct = null;
          }

          if (acct == null) acct = 0;

          _context55.next = 4;
          return this.getAccount(acct);

        case 4:
          account = _context55.sent;

          if (account) {
            _context55.next = 7;
            break;
          }

          throw new Error('Account not found.');

        case 7:

          this.start();

          _context55.prev = 8;
          _context55.next = 11;
          return account.setLookahead(lookahead);

        case 11:
          _context55.next = 17;
          break;

        case 13:
          _context55.prev = 13;
          _context55.t0 = _context55['catch'](8);

          this.drop();
          throw _context55.t0;

        case 17:
          _context55.next = 19;
          return this.commit();

        case 19:
        case 'end':
          return _context55.stop();
      }
    }
  }, setLookahead, this, [[8, 13]]);
}));

/**
 * Sync address depths based on a transaction's outputs.
 * This is used for deriving new addresses when
 * a confirmed transaction is seen.
 * @param {Details} details
 * @returns {Promise}
 */

Wallet.prototype.syncOutputDepth = co( /*#__PURE__*/_regenerator2.default.mark(function syncOutputDepth(details) {
  var derived, accounts, i, j, path, paths, acct, account, receive, change, nested, ring;
  return _regenerator2.default.wrap(function syncOutputDepth$(_context56) {
    while (1) {
      switch (_context56.prev = _context56.next) {
        case 0:
          derived = [];
          accounts = {};

          if (details) {
            _context56.next = 4;
            break;
          }

          return _context56.abrupt('return', derived);

        case 4:
          i = 0;

        case 5:
          if (!(i < details.outputs.length)) {
            _context56.next = 16;
            break;
          }

          path = details.outputs[i].path;

          if (path) {
            _context56.next = 9;
            break;
          }

          return _context56.abrupt('continue', 13);

        case 9:
          if (!(path.index === -1)) {
            _context56.next = 11;
            break;
          }

          return _context56.abrupt('continue', 13);

        case 11:

          if (!accounts[path.account]) accounts[path.account] = [];

          accounts[path.account].push(path);

        case 13:
          i++;
          _context56.next = 5;
          break;

        case 16:

          accounts = util.values(accounts);

          i = 0;

        case 18:
          if (!(i < accounts.length)) {
            _context56.next = 53;
            break;
          }

          paths = accounts[i];
          acct = paths[0].account;
          receive = -1;
          change = -1;
          nested = -1;

          j = 0;

        case 25:
          if (!(j < paths.length)) {
            _context56.next = 39;
            break;
          }

          path = paths[j];

          _context56.t0 = path.branch;
          _context56.next = _context56.t0 === 0 ? 30 : _context56.t0 === 1 ? 32 : _context56.t0 === 2 ? 34 : 36;
          break;

        case 30:
          if (path.index > receive) receive = path.index;
          return _context56.abrupt('break', 36);

        case 32:
          if (path.index > change) change = path.index;
          return _context56.abrupt('break', 36);

        case 34:
          if (path.index > nested) nested = path.index;
          return _context56.abrupt('break', 36);

        case 36:
          j++;
          _context56.next = 25;
          break;

        case 39:

          receive += 2;
          change += 2;
          nested += 2;

          _context56.next = 44;
          return this.getAccount(acct);

        case 44:
          account = _context56.sent;

          assert(account);

          _context56.next = 48;
          return account.syncDepth(receive, change, nested);

        case 48:
          ring = _context56.sent;


          if (ring) derived.push(ring);

        case 50:
          i++;
          _context56.next = 18;
          break;

        case 53:
          return _context56.abrupt('return', derived);

        case 54:
        case 'end':
          return _context56.stop();
      }
    }
  }, syncOutputDepth, this);
}));

/**
 * Get a redeem script or witness script by hash.
 * @param {Hash} hash - Can be a ripemd160 or a sha256.
 * @returns {Script}
 */

Wallet.prototype.getRedeem = co( /*#__PURE__*/_regenerator2.default.mark(function getRedeem(hash) {
  var ring;
  return _regenerator2.default.wrap(function getRedeem$(_context57) {
    while (1) {
      switch (_context57.prev = _context57.next) {
        case 0:

          if (typeof hash === 'string') hash = Buffer.from(hash, 'hex');

          _context57.next = 3;
          return this.getKey(hash.toString('hex'));

        case 3:
          ring = _context57.sent;

          if (ring) {
            _context57.next = 6;
            break;
          }

          return _context57.abrupt('return');

        case 6:
          return _context57.abrupt('return', ring.getRedeem(hash));

        case 7:
        case 'end':
          return _context57.stop();
      }
    }
  }, getRedeem, this);
}));

/**
 * Build input scripts templates for a transaction (does not
 * sign, only creates signature slots). Only builds scripts
 * for inputs that are redeemable by this wallet.
 * @param {MTX} mtx
 * @returns {Promise} - Returns Number
 * (total number of scripts built).
 */

Wallet.prototype.template = co( /*#__PURE__*/_regenerator2.default.mark(function template(mtx) {
  var rings;
  return _regenerator2.default.wrap(function template$(_context58) {
    while (1) {
      switch (_context58.prev = _context58.next) {
        case 0:
          _context58.next = 2;
          return this.deriveInputs(mtx);

        case 2:
          rings = _context58.sent;
          return _context58.abrupt('return', mtx.template(rings));

        case 4:
        case 'end':
          return _context58.stop();
      }
    }
  }, template, this);
}));

/**
 * Build input scripts and sign inputs for a transaction. Only attempts
 * to build/sign inputs that are redeemable by this wallet.
 * @param {MTX} tx
 * @param {Object|String|Buffer} options - Options or passphrase.
 * @returns {Promise} - Returns Number (total number
 * of inputs scripts built and signed).
 */

Wallet.prototype.sign = co( /*#__PURE__*/_regenerator2.default.mark(function sign(mtx, passphrase) {
  var rings;
  return _regenerator2.default.wrap(function sign$(_context59) {
    while (1) {
      switch (_context59.prev = _context59.next) {
        case 0:
          if (!this.watchOnly) {
            _context59.next = 2;
            break;
          }

          throw new Error('Cannot sign from a watch-only wallet.');

        case 2:
          _context59.next = 4;
          return this.unlock(passphrase);

        case 4:
          _context59.next = 6;
          return this.deriveInputs(mtx);

        case 6:
          rings = _context59.sent;
          _context59.next = 9;
          return mtx.signAsync(rings);

        case 9:
          return _context59.abrupt('return', _context59.sent);

        case 10:
        case 'end':
          return _context59.stop();
      }
    }
  }, sign, this);
}));

/**
 * Get a coin viewpoint.
 * @param {TX} tx
 * @returns {Promise} - Returns {@link CoinView}.
 */

Wallet.prototype.getCoinView = function getCoinView(tx) {
  return this.txdb.getCoinView(tx);
};

/**
 * Get a historical coin viewpoint.
 * @param {TX} tx
 * @returns {Promise} - Returns {@link CoinView}.
 */

Wallet.prototype.getSpentView = function getSpentView(tx) {
  return this.txdb.getSpentView(tx);
};

/**
 * Convert transaction to transaction details.
 * @param {TXRecord} wtx
 * @returns {Promise} - Returns {@link Details}.
 */

Wallet.prototype.toDetails = function toDetails(wtx) {
  return this.txdb.toDetails(wtx);
};

/**
 * Get transaction details.
 * @param {Hash} hash
 * @returns {Promise} - Returns {@link Details}.
 */

Wallet.prototype.getDetails = function getDetails(hash) {
  return this.txdb.getDetails(hash);
};

/**
 * Get a coin from the wallet.
 * @param {Hash} hash
 * @param {Number} index
 * @returns {Promise} - Returns {@link Coin}.
 */

Wallet.prototype.getCoin = function getCoin(hash, index) {
  return this.txdb.getCoin(hash, index);
};

/**
 * Get a transaction from the wallet.
 * @param {Hash} hash
 * @returns {Promise} - Returns {@link TX}.
 */

Wallet.prototype.getTX = function getTX(hash) {
  return this.txdb.getTX(hash);
};

/**
 * List blocks for the wallet.
 * @returns {Promise} - Returns {@link BlockRecord}.
 */

Wallet.prototype.getBlocks = function getBlocks() {
  return this.txdb.getBlocks();
};

/**
 * Get a block from the wallet.
 * @param {Number} height
 * @returns {Promise} - Returns {@link BlockRecord}.
 */

Wallet.prototype.getBlock = function getBlock(height) {
  return this.txdb.getBlock(height);
};

/**
 * Add a transaction to the wallets TX history.
 * @param {TX} tx
 * @returns {Promise}
 */

Wallet.prototype.add = co( /*#__PURE__*/_regenerator2.default.mark(function add(tx, block) {
  var unlock;
  return _regenerator2.default.wrap(function add$(_context60) {
    while (1) {
      switch (_context60.prev = _context60.next) {
        case 0:
          _context60.next = 2;
          return this.writeLock.lock();

        case 2:
          unlock = _context60.sent;
          _context60.prev = 3;
          _context60.next = 6;
          return this._add(tx, block);

        case 6:
          return _context60.abrupt('return', _context60.sent);

        case 7:
          _context60.prev = 7;

          unlock();
          return _context60.finish(7);

        case 10:
        case 'end':
          return _context60.stop();
      }
    }
  }, add, this, [[3,, 7, 10]]);
}));

/**
 * Add a transaction to the wallet without a lock.
 * Potentially resolves orphans.
 * @private
 * @param {TX} tx
 * @returns {Promise}
 */

Wallet.prototype._add = co( /*#__PURE__*/_regenerator2.default.mark(function add(tx, block) {
  var details, derived;
  return _regenerator2.default.wrap(function add$(_context61) {
    while (1) {
      switch (_context61.prev = _context61.next) {
        case 0:

          this.txdb.start();

          _context61.prev = 1;
          _context61.next = 4;
          return this.txdb._add(tx, block);

        case 4:
          details = _context61.sent;
          _context61.next = 7;
          return this.syncOutputDepth(details);

        case 7:
          derived = _context61.sent;
          _context61.next = 14;
          break;

        case 10:
          _context61.prev = 10;
          _context61.t0 = _context61['catch'](1);

          this.txdb.drop();
          throw _context61.t0;

        case 14:
          _context61.next = 16;
          return this.txdb.commit();

        case 16:

          if (derived.length > 0) {
            this.db.emit('address', this.id, derived);
            this.emit('address', derived);
          }

          return _context61.abrupt('return', details);

        case 18:
        case 'end':
          return _context61.stop();
      }
    }
  }, add, this, [[1, 10]]);
}));

/**
 * Unconfirm a wallet transcation.
 * @param {Hash} hash
 * @returns {Promise}
 */

Wallet.prototype.unconfirm = co( /*#__PURE__*/_regenerator2.default.mark(function unconfirm(hash) {
  var unlock;
  return _regenerator2.default.wrap(function unconfirm$(_context62) {
    while (1) {
      switch (_context62.prev = _context62.next) {
        case 0:
          _context62.next = 2;
          return this.writeLock.lock();

        case 2:
          unlock = _context62.sent;
          _context62.prev = 3;
          _context62.next = 6;
          return this.txdb.unconfirm(hash);

        case 6:
          return _context62.abrupt('return', _context62.sent);

        case 7:
          _context62.prev = 7;

          unlock();
          return _context62.finish(7);

        case 10:
        case 'end':
          return _context62.stop();
      }
    }
  }, unconfirm, this, [[3,, 7, 10]]);
}));

/**
 * Remove a wallet transaction.
 * @param {Hash} hash
 * @returns {Promise}
 */

Wallet.prototype.remove = co( /*#__PURE__*/_regenerator2.default.mark(function remove(hash) {
  var unlock;
  return _regenerator2.default.wrap(function remove$(_context63) {
    while (1) {
      switch (_context63.prev = _context63.next) {
        case 0:
          _context63.next = 2;
          return this.writeLock.lock();

        case 2:
          unlock = _context63.sent;
          _context63.prev = 3;
          _context63.next = 6;
          return this.txdb.remove(hash);

        case 6:
          return _context63.abrupt('return', _context63.sent);

        case 7:
          _context63.prev = 7;

          unlock();
          return _context63.finish(7);

        case 10:
        case 'end':
          return _context63.stop();
      }
    }
  }, remove, this, [[3,, 7, 10]]);
}));

/**
 * Zap stale TXs from wallet.
 * @param {(Number|String)?} acct
 * @param {Number} age - Age threshold (unix time, default=72 hours).
 * @returns {Promise}
 */

Wallet.prototype.zap = co( /*#__PURE__*/_regenerator2.default.mark(function zap(acct, age) {
  var unlock;
  return _regenerator2.default.wrap(function zap$(_context64) {
    while (1) {
      switch (_context64.prev = _context64.next) {
        case 0:
          _context64.next = 2;
          return this.writeLock.lock();

        case 2:
          unlock = _context64.sent;
          _context64.prev = 3;
          _context64.next = 6;
          return this._zap(acct, age);

        case 6:
          return _context64.abrupt('return', _context64.sent);

        case 7:
          _context64.prev = 7;

          unlock();
          return _context64.finish(7);

        case 10:
        case 'end':
          return _context64.stop();
      }
    }
  }, zap, this, [[3,, 7, 10]]);
}));

/**
 * Zap stale TXs from wallet without a lock.
 * @private
 * @param {(Number|String)?} acct
 * @param {Number} age
 * @returns {Promise}
 */

Wallet.prototype._zap = co( /*#__PURE__*/_regenerator2.default.mark(function zap(acct, age) {
  var account;
  return _regenerator2.default.wrap(function zap$(_context65) {
    while (1) {
      switch (_context65.prev = _context65.next) {
        case 0:
          _context65.next = 2;
          return this.ensureIndex(acct);

        case 2:
          account = _context65.sent;
          _context65.next = 5;
          return this.txdb.zap(account, age);

        case 5:
          return _context65.abrupt('return', _context65.sent);

        case 6:
        case 'end':
          return _context65.stop();
      }
    }
  }, zap, this);
}));

/**
 * Abandon transaction.
 * @param {Hash} hash
 * @returns {Promise}
 */

Wallet.prototype.abandon = co( /*#__PURE__*/_regenerator2.default.mark(function abandon(hash) {
  var unlock;
  return _regenerator2.default.wrap(function abandon$(_context66) {
    while (1) {
      switch (_context66.prev = _context66.next) {
        case 0:
          _context66.next = 2;
          return this.writeLock.lock();

        case 2:
          unlock = _context66.sent;
          _context66.prev = 3;
          _context66.next = 6;
          return this._abandon(hash);

        case 6:
          return _context66.abrupt('return', _context66.sent);

        case 7:
          _context66.prev = 7;

          unlock();
          return _context66.finish(7);

        case 10:
        case 'end':
          return _context66.stop();
      }
    }
  }, abandon, this, [[3,, 7, 10]]);
}));

/**
 * Abandon transaction without a lock.
 * @private
 * @param {Hash} hash
 * @returns {Promise}
 */

Wallet.prototype._abandon = function abandon(hash) {
  return this.txdb.abandon(hash);
};

/**
 * Lock a single coin.
 * @param {Coin|Outpoint} coin
 */

Wallet.prototype.lockCoin = function lockCoin(coin) {
  return this.txdb.lockCoin(coin);
};

/**
 * Unlock a single coin.
 * @param {Coin|Outpoint} coin
 */

Wallet.prototype.unlockCoin = function unlockCoin(coin) {
  return this.txdb.unlockCoin(coin);
};

/**
 * Test locked status of a single coin.
 * @param {Coin|Outpoint} coin
 */

Wallet.prototype.isLocked = function isLocked(coin) {
  return this.txdb.isLocked(coin);
};

/**
 * Return an array of all locked outpoints.
 * @returns {Outpoint[]}
 */

Wallet.prototype.getLocked = function getLocked() {
  return this.txdb.getLocked();
};

/**
 * Get all transactions in transaction history.
 * @param {(String|Number)?} acct
 * @returns {Promise} - Returns {@link TX}[].
 */

Wallet.prototype.getHistory = co( /*#__PURE__*/_regenerator2.default.mark(function getHistory(acct) {
  var account;
  return _regenerator2.default.wrap(function getHistory$(_context67) {
    while (1) {
      switch (_context67.prev = _context67.next) {
        case 0:
          _context67.next = 2;
          return this.ensureIndex(acct);

        case 2:
          account = _context67.sent;
          return _context67.abrupt('return', this.txdb.getHistory(account));

        case 4:
        case 'end':
          return _context67.stop();
      }
    }
  }, getHistory, this);
}));

/**
 * Get all available coins.
 * @param {(String|Number)?} account
 * @returns {Promise} - Returns {@link Coin}[].
 */

Wallet.prototype.getCoins = co( /*#__PURE__*/_regenerator2.default.mark(function getCoins(acct) {
  var account;
  return _regenerator2.default.wrap(function getCoins$(_context68) {
    while (1) {
      switch (_context68.prev = _context68.next) {
        case 0:
          _context68.next = 2;
          return this.ensureIndex(acct);

        case 2:
          account = _context68.sent;
          _context68.next = 5;
          return this.txdb.getCoins(account);

        case 5:
          return _context68.abrupt('return', _context68.sent);

        case 6:
        case 'end':
          return _context68.stop();
      }
    }
  }, getCoins, this);
}));

/**
 * Get all available credits.
 * @param {(String|Number)?} account
 * @returns {Promise} - Returns {@link Credit}[].
 */

Wallet.prototype.getCredits = co( /*#__PURE__*/_regenerator2.default.mark(function getCredits(acct) {
  var account;
  return _regenerator2.default.wrap(function getCredits$(_context69) {
    while (1) {
      switch (_context69.prev = _context69.next) {
        case 0:
          _context69.next = 2;
          return this.ensureIndex(acct);

        case 2:
          account = _context69.sent;
          _context69.next = 5;
          return this.txdb.getCredits(account);

        case 5:
          return _context69.abrupt('return', _context69.sent);

        case 6:
        case 'end':
          return _context69.stop();
      }
    }
  }, getCredits, this);
}));

/**
 * Get "smart" coins.
 * @param {(String|Number)?} account
 * @returns {Promise} - Returns {@link Coin}[].
 */

Wallet.prototype.getSmartCoins = co( /*#__PURE__*/_regenerator2.default.mark(function getSmartCoins(acct) {
  var credits, coins, i, credit, coin;
  return _regenerator2.default.wrap(function getSmartCoins$(_context70) {
    while (1) {
      switch (_context70.prev = _context70.next) {
        case 0:
          _context70.next = 2;
          return this.getCredits(acct);

        case 2:
          credits = _context70.sent;
          coins = [];
          i = 0;

        case 5:
          if (!(i < credits.length)) {
            _context70.next = 21;
            break;
          }

          credit = credits[i];
          coin = credit.coin;

          if (!credit.spent) {
            _context70.next = 10;
            break;
          }

          return _context70.abrupt('continue', 18);

        case 10:
          if (!this.txdb.isLocked(coin)) {
            _context70.next = 12;
            break;
          }

          return _context70.abrupt('continue', 18);

        case 12:
          if (!(coin.height !== -1)) {
            _context70.next = 15;
            break;
          }

          coins.push(coin);
          return _context70.abrupt('continue', 18);

        case 15:
          if (credit.own) {
            _context70.next = 17;
            break;
          }

          return _context70.abrupt('continue', 18);

        case 17:

          coins.push(coin);

        case 18:
          i++;
          _context70.next = 5;
          break;

        case 21:
          return _context70.abrupt('return', coins);

        case 22:
        case 'end':
          return _context70.stop();
      }
    }
  }, getSmartCoins, this);
}));

/**
 * Get all pending/unconfirmed transactions.
 * @param {(String|Number)?} acct
 * @returns {Promise} - Returns {@link TX}[].
 */

Wallet.prototype.getPending = co( /*#__PURE__*/_regenerator2.default.mark(function getPending(acct) {
  var account;
  return _regenerator2.default.wrap(function getPending$(_context71) {
    while (1) {
      switch (_context71.prev = _context71.next) {
        case 0:
          _context71.next = 2;
          return this.ensureIndex(acct);

        case 2:
          account = _context71.sent;
          _context71.next = 5;
          return this.txdb.getPending(account);

        case 5:
          return _context71.abrupt('return', _context71.sent);

        case 6:
        case 'end':
          return _context71.stop();
      }
    }
  }, getPending, this);
}));

/**
 * Get wallet balance.
 * @param {(String|Number)?} acct
 * @returns {Promise} - Returns {@link Balance}.
 */

Wallet.prototype.getBalance = co( /*#__PURE__*/_regenerator2.default.mark(function getBalance(acct) {
  var account;
  return _regenerator2.default.wrap(function getBalance$(_context72) {
    while (1) {
      switch (_context72.prev = _context72.next) {
        case 0:
          _context72.next = 2;
          return this.ensureIndex(acct);

        case 2:
          account = _context72.sent;
          _context72.next = 5;
          return this.txdb.getBalance(account);

        case 5:
          return _context72.abrupt('return', _context72.sent);

        case 6:
        case 'end':
          return _context72.stop();
      }
    }
  }, getBalance, this);
}));

/**
 * Get a range of transactions between two timestamps.
 * @param {(String|Number)?} acct
 * @param {Object} options
 * @param {Number} options.start
 * @param {Number} options.end
 * @returns {Promise} - Returns {@link TX}[].
 */

Wallet.prototype.getRange = co( /*#__PURE__*/_regenerator2.default.mark(function getRange(acct, options) {
  var account;
  return _regenerator2.default.wrap(function getRange$(_context73) {
    while (1) {
      switch (_context73.prev = _context73.next) {
        case 0:
          if (acct && (typeof acct === 'undefined' ? 'undefined' : (0, _typeof3.default)(acct)) === 'object') {
            options = acct;
            acct = null;
          }
          _context73.next = 3;
          return this.ensureIndex(acct);

        case 3:
          account = _context73.sent;
          _context73.next = 6;
          return this.txdb.getRange(account, options);

        case 6:
          return _context73.abrupt('return', _context73.sent);

        case 7:
        case 'end':
          return _context73.stop();
      }
    }
  }, getRange, this);
}));

/**
 * Get the last N transactions.
 * @param {(String|Number)?} acct
 * @param {Number} limit
 * @returns {Promise} - Returns {@link TX}[].
 */

Wallet.prototype.getLast = co( /*#__PURE__*/_regenerator2.default.mark(function getLast(acct, limit) {
  var account;
  return _regenerator2.default.wrap(function getLast$(_context74) {
    while (1) {
      switch (_context74.prev = _context74.next) {
        case 0:
          _context74.next = 2;
          return this.ensureIndex(acct);

        case 2:
          account = _context74.sent;
          _context74.next = 5;
          return this.txdb.getLast(account, limit);

        case 5:
          return _context74.abrupt('return', _context74.sent);

        case 6:
        case 'end':
          return _context74.stop();
      }
    }
  }, getLast, this);
}));

/**
 * Resolve account index.
 * @private
 * @param {(Number|String)?} acct
 * @param {Function} errback - Returns [Error].
 * @returns {Promise}
 */

Wallet.prototype.ensureIndex = co( /*#__PURE__*/_regenerator2.default.mark(function ensureIndex(acct, enforce) {
  var index;
  return _regenerator2.default.wrap(function ensureIndex$(_context75) {
    while (1) {
      switch (_context75.prev = _context75.next) {
        case 0:
          if (!(acct == null)) {
            _context75.next = 4;
            break;
          }

          if (!enforce) {
            _context75.next = 3;
            break;
          }

          throw new Error('No account provided.');

        case 3:
          return _context75.abrupt('return', null);

        case 4:
          _context75.next = 6;
          return this.getAccountIndex(acct);

        case 6:
          index = _context75.sent;

          if (!(index === -1)) {
            _context75.next = 9;
            break;
          }

          throw new Error('Account not found.');

        case 9:
          return _context75.abrupt('return', index);

        case 10:
        case 'end':
          return _context75.stop();
      }
    }
  }, ensureIndex, this);
}));

/**
 * Get current receive address.
 * @param {String?} enc - `"base58"` or `null`.
 * @returns {Address|Base58Address}
 */

Wallet.prototype.getAddress = function getAddress(enc) {
  return this.account.getAddress(enc);
};

/**
 * Get current receive address.
 * @param {String?} enc - `"base58"` or `null`.
 * @returns {Address|Base58Address}
 */

Wallet.prototype.getReceive = function getReceive(enc) {
  return this.account.getReceive(enc);
};

/**
 * Get current change address.
 * @param {String?} enc - `"base58"` or `null`.
 * @returns {Address|Base58Address}
 */

Wallet.prototype.getChange = function getChange(enc) {
  return this.account.getChange(enc);
};

/**
 * Get current nested address.
 * @param {String?} enc - `"base58"` or `null`.
 * @returns {Address|Base58Address}
 */

Wallet.prototype.getNested = function getNested(enc) {
  return this.account.getNested(enc);
};

/**
 * Convert the wallet to a more inspection-friendly object.
 * @returns {Object}
 */

Wallet.prototype.inspect = function inspect() {
  return {
    wid: this.wid,
    id: this.id,
    network: this.network.type,
    initialized: this.initialized,
    accountDepth: this.accountDepth,
    token: this.token.toString('hex'),
    tokenDepth: this.tokenDepth,
    state: this.txdb.state ? this.txdb.state.toJSON(true) : null,
    master: this.master,
    account: this.account
  };
};

/**
 * Convert the wallet to an object suitable for
 * serialization.
 * @param {Boolean?} unsafe - Whether to include
 * the master key in the JSON.
 * @returns {Object}
 */

Wallet.prototype.toJSON = function toJSON(unsafe) {
  return {
    network: this.network.type,
    wid: this.wid,
    id: this.id,
    initialized: this.initialized,
    watchOnly: this.watchOnly,
    accountDepth: this.accountDepth,
    token: this.token.toString('hex'),
    tokenDepth: this.tokenDepth,
    state: this.txdb.state.toJSON(true),
    master: this.master.toJSON(unsafe),
    account: this.account.toJSON(true)
  };
};

/**
 * Calculate serialization size.
 * @returns {Number}
 */

Wallet.prototype.getSize = function getSize() {
  var size = 0;
  size += 50;
  size += encoding.sizeVarString(this.id, 'ascii');
  size += encoding.sizeVarlen(this.master.getSize());
  return size;
};

/**
 * Serialize the wallet.
 * @returns {Buffer}
 */

Wallet.prototype.toRaw = function toRaw() {
  var size = this.getSize();
  var bw = new StaticWriter(size);

  bw.writeU32(this.network.magic);
  bw.writeU32(this.wid);
  bw.writeVarString(this.id, 'ascii');
  bw.writeU8(this.initialized ? 1 : 0);
  bw.writeU8(this.watchOnly ? 1 : 0);
  bw.writeU32(this.accountDepth);
  bw.writeBytes(this.token);
  bw.writeU32(this.tokenDepth);
  bw.writeVarBytes(this.master.toRaw());

  return bw.render();
};

/**
 * Inject properties from serialized data.
 * @private
 * @param {Buffer} data
 */

Wallet.prototype.fromRaw = function fromRaw(data) {
  var br = new BufferReader(data);
  var network = Network.fromMagic(br.readU32());

  this.wid = br.readU32();
  this.id = br.readVarString('ascii');
  this.initialized = br.readU8() === 1;
  this.watchOnly = br.readU8() === 1;
  this.accountDepth = br.readU32();
  this.token = br.readBytes(32);
  this.tokenDepth = br.readU32();
  this.master.fromRaw(br.readVarBytes());

  assert(network === this.db.network, 'Wallet network mismatch.');

  return this;
};

/**
 * Instantiate a wallet from serialized data.
 * @param {Buffer} data
 * @returns {Wallet}
 */

Wallet.fromRaw = function fromRaw(db, data) {
  return new Wallet(db).fromRaw(data);
};

/**
 * Test an object to see if it is a Wallet.
 * @param {Object} obj
 * @returns {Boolean}
 */

Wallet.isWallet = function isWallet(obj) {
  return obj && typeof obj.accountDepth === 'number' && obj.template === 'function';
};

/*
 * Expose
 */

module.exports = Wallet;