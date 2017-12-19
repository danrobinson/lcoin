/*!
 * account.js - account object for bcoin
 * Copyright (c) 2014-2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

var _promise = require('babel-runtime/core-js/promise');

var _promise2 = _interopRequireDefault(_promise);

var _regenerator = require('babel-runtime/regenerator');

var _regenerator2 = _interopRequireDefault(_regenerator);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var util = require('../utils/util');
var co = require('../utils/co');
var assert = require('assert');
var BufferReader = require('../utils/reader');
var StaticWriter = require('../utils/staticwriter');
var encoding = require('../utils/encoding');
var Path = require('./path');
var common = require('./common');
var Script = require('../script/script');
var WalletKey = require('./walletkey');
var HD = require('../hd/hd');

/**
 * Represents a BIP44 Account belonging to a {@link Wallet}.
 * Note that this object does not enforce locks. Any method
 * that does a write is internal API only and will lead
 * to race conditions if used elsewhere.
 * @alias module:wallet.Account
 * @constructor
 * @param {Object} options
 * @param {WalletDB} options.db
 * @param {HDPublicKey} options.accountKey
 * @param {Boolean?} options.witness - Whether to use witness programs.
 * @param {Number} options.accountIndex - The BIP44 account index.
 * @param {Number?} options.receiveDepth - The index of the _next_ receiving
 * address.
 * @param {Number?} options.changeDepth - The index of the _next_ change
 * address.
 * @param {String?} options.type - Type of wallet (pubkeyhash, multisig)
 * (default=pubkeyhash).
 * @param {Number?} options.m - `m` value for multisig.
 * @param {Number?} options.n - `n` value for multisig.
 * @param {String?} options.wid - Wallet ID
 * @param {String?} options.name - Account name
 */

function Account(db, options) {
  if (!(this instanceof Account)) return new Account(db, options);

  assert(db, 'Database is required.');

  this.db = db;
  this.network = db.network;
  this.wallet = null;

  this.receive = null;
  this.change = null;
  this.nested = null;

  this.wid = 0;
  this.id = null;
  this.name = null;
  this.initialized = false;
  this.witness = this.db.options.witness === true;
  this.watchOnly = false;
  this.type = Account.types.PUBKEYHASH;
  this.m = 1;
  this.n = 1;
  this.accountIndex = 0;
  this.receiveDepth = 0;
  this.changeDepth = 0;
  this.nestedDepth = 0;
  this.lookahead = 10;
  this.accountKey = null;
  this.keys = [];

  if (options) this.fromOptions(options);
}

/**
 * Account types.
 * @enum {Number}
 * @default
 */

Account.types = {
  PUBKEYHASH: 0,
  MULTISIG: 1
};

/**
 * Account types by value.
 * @const {RevMap}
 */

Account.typesByVal = {
  0: 'pubkeyhash',
  1: 'multisig'
};

/**
 * Inject properties from options object.
 * @private
 * @param {Object} options
 */

Account.prototype.fromOptions = function fromOptions(options) {
  var i;

  assert(options, 'Options are required.');
  assert(util.isNumber(options.wid));
  assert(common.isName(options.id), 'Bad Wallet ID.');
  assert(HD.isHD(options.accountKey), 'Account key is required.');
  assert(util.isNumber(options.accountIndex), 'Account index is required.');

  this.wid = options.wid;
  this.id = options.id;

  if (options.name != null) {
    assert(common.isName(options.name), 'Bad account name.');
    this.name = options.name;
  }

  if (options.initialized != null) {
    assert(typeof options.initialized === 'boolean');
    this.initialized = options.initialized;
  }

  if (options.witness != null) {
    assert(typeof options.witness === 'boolean');
    this.witness = options.witness;
  }

  if (options.watchOnly != null) {
    assert(typeof options.watchOnly === 'boolean');
    this.watchOnly = options.watchOnly;
  }

  if (options.type != null) {
    if (typeof options.type === 'string') {
      this.type = Account.types[options.type.toUpperCase()];
      assert(this.type != null);
    } else {
      assert(typeof options.type === 'number');
      this.type = options.type;
      assert(Account.typesByVal[this.type]);
    }
  }

  if (options.m != null) {
    assert(util.isNumber(options.m));
    this.m = options.m;
  }

  if (options.n != null) {
    assert(util.isNumber(options.n));
    this.n = options.n;
  }

  if (options.accountIndex != null) {
    assert(util.isNumber(options.accountIndex));
    this.accountIndex = options.accountIndex;
  }

  if (options.receiveDepth != null) {
    assert(util.isNumber(options.receiveDepth));
    this.receiveDepth = options.receiveDepth;
  }

  if (options.changeDepth != null) {
    assert(util.isNumber(options.changeDepth));
    this.changeDepth = options.changeDepth;
  }

  if (options.nestedDepth != null) {
    assert(util.isNumber(options.nestedDepth));
    this.nestedDepth = options.nestedDepth;
  }

  if (options.lookahead != null) {
    assert(util.isNumber(options.lookahead));
    assert(options.lookahead >= 0);
    assert(options.lookahead <= Account.MAX_LOOKAHEAD);
    this.lookahead = options.lookahead;
  }

  this.accountKey = options.accountKey;

  if (this.n > 1) this.type = Account.types.MULTISIG;

  if (!this.name) this.name = this.accountIndex + '';

  if (this.m < 1 || this.m > this.n) throw new Error('m ranges between 1 and n');

  if (options.keys) {
    assert(Array.isArray(options.keys));
    for (i = 0; i < options.keys.length; i++) {
      this.pushKey(options.keys[i]);
    }
  }

  return this;
};

/**
 * Instantiate account from options.
 * @param {WalletDB} db
 * @param {Object} options
 * @returns {Account}
 */

Account.fromOptions = function fromOptions(db, options) {
  return new Account(db).fromOptions(options);
};

/*
 * Default address lookahead.
 * @const {Number}
 */

Account.MAX_LOOKAHEAD = 40;

/**
 * Attempt to intialize the account (generating
 * the first addresses along with the lookahead
 * addresses). Called automatically from the
 * walletdb.
 * @returns {Promise}
 */

Account.prototype.init = co( /*#__PURE__*/_regenerator2.default.mark(function init() {
  return _regenerator2.default.wrap(function init$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:
          if (!(this.keys.length !== this.n - 1)) {
            _context.next = 4;
            break;
          }

          assert(!this.initialized);
          this.save();
          return _context.abrupt('return');

        case 4:

          assert(this.receiveDepth === 0);
          assert(this.changeDepth === 0);
          assert(this.nestedDepth === 0);

          this.initialized = true;

          _context.next = 10;
          return this.initDepth();

        case 10:
        case 'end':
          return _context.stop();
      }
    }
  }, init, this);
}));

/**
 * Open the account (done after retrieval).
 * @returns {Promise}
 */

Account.prototype.open = function open() {
  if (!this.initialized) return _promise2.default.resolve();

  if (this.receive) return _promise2.default.resolve();

  this.receive = this.deriveReceive(this.receiveDepth - 1);
  this.change = this.deriveChange(this.changeDepth - 1);

  if (this.witness) this.nested = this.deriveNested(this.nestedDepth - 1);

  return _promise2.default.resolve();
};

/**
 * Add a public account key to the account (multisig).
 * Does not update the database.
 * @param {HDPublicKey} key - Account (bip44)
 * key (can be in base58 form).
 * @throws Error on non-hdkey/non-accountkey.
 */

Account.prototype.pushKey = function pushKey(key) {
  var index;

  if (typeof key === 'string') key = HD.PublicKey.fromBase58(key, this.network);

  assert(key.network === this.network, 'Network mismatch for account key.');

  if (!HD.isPublic(key)) throw new Error('Must add HD keys to wallet.');

  if (!key.isAccount44()) throw new Error('Must add HD account keys to BIP44 wallet.');

  if (this.type !== Account.types.MULTISIG) throw new Error('Cannot add keys to non-multisig wallet.');

  if (key.equal(this.accountKey)) throw new Error('Cannot add own key.');

  index = util.binaryInsert(this.keys, key, cmp, true);

  if (index === -1) return false;

  if (this.keys.length > this.n - 1) {
    util.binaryRemove(this.keys, key, cmp);
    throw new Error('Cannot add more keys.');
  }

  return true;
};

/**
 * Remove a public account key to the account (multisig).
 * Does not update the database.
 * @param {HDPublicKey} key - Account (bip44)
 * key (can be in base58 form).
 * @throws Error on non-hdkey/non-accountkey.
 */

Account.prototype.spliceKey = function spliceKey(key) {
  if (typeof key === 'string') key = HD.PublicKey.fromBase58(key, this.network);

  assert(key.network === this.network, 'Network mismatch for account key.');

  if (!HD.isPublic(key)) throw new Error('Must add HD keys to wallet.');

  if (!key.isAccount44()) throw new Error('Must add HD account keys to BIP44 wallet.');

  if (this.type !== Account.types.MULTISIG) throw new Error('Cannot remove keys from non-multisig wallet.');

  if (this.keys.length === this.n - 1) throw new Error('Cannot remove key.');

  return util.binaryRemove(this.keys, key, cmp);
};

/**
 * Add a public account key to the account (multisig).
 * Saves the key in the wallet database.
 * @param {HDPublicKey} key
 * @returns {Promise}
 */

Account.prototype.addSharedKey = co( /*#__PURE__*/_regenerator2.default.mark(function addSharedKey(key) {
  var result, exists;
  return _regenerator2.default.wrap(function addSharedKey$(_context2) {
    while (1) {
      switch (_context2.prev = _context2.next) {
        case 0:
          result = this.pushKey(key);
          _context2.next = 3;
          return this._hasDuplicate();

        case 3:
          exists = _context2.sent;

          if (!exists) {
            _context2.next = 7;
            break;
          }

          this.spliceKey(key);
          throw new Error('Cannot add a key from another account.');

        case 7:
          _context2.next = 9;
          return this.init();

        case 9:
          return _context2.abrupt('return', result);

        case 10:
        case 'end':
          return _context2.stop();
      }
    }
  }, addSharedKey, this);
}));

/**
 * Ensure accounts are not sharing keys.
 * @private
 * @returns {Promise}
 */

Account.prototype._hasDuplicate = function _hasDuplicate() {
  var ring, hash;

  if (this.keys.length !== this.n - 1) return false;

  ring = this.deriveReceive(0);
  hash = ring.getScriptHash('hex');

  return this.wallet.hasAddress(hash);
};

/**
 * Remove a public account key from the account (multisig).
 * Remove the key from the wallet database.
 * @param {HDPublicKey} key
 * @returns {Promise}
 */

Account.prototype.removeSharedKey = function removeSharedKey(key) {
  var result = this.spliceKey(key);

  if (!result) return false;

  this.save();

  return true;
};

/**
 * Create a new receiving address (increments receiveDepth).
 * @returns {WalletKey}
 */

Account.prototype.createReceive = function createReceive() {
  return this.createKey(0);
};

/**
 * Create a new change address (increments receiveDepth).
 * @returns {WalletKey}
 */

Account.prototype.createChange = function createChange() {
  return this.createKey(1);
};

/**
 * Create a new change address (increments receiveDepth).
 * @returns {WalletKey}
 */

Account.prototype.createNested = function createNested() {
  return this.createKey(2);
};

/**
 * Create a new address (increments depth).
 * @param {Boolean} change
 * @returns {Promise} - Returns {@link WalletKey}.
 */

Account.prototype.createKey = co( /*#__PURE__*/_regenerator2.default.mark(function createKey(branch) {
  var key, lookahead;
  return _regenerator2.default.wrap(function createKey$(_context3) {
    while (1) {
      switch (_context3.prev = _context3.next) {
        case 0:
          _context3.t0 = branch;
          _context3.next = _context3.t0 === 0 ? 3 : _context3.t0 === 1 ? 10 : _context3.t0 === 2 ? 17 : 24;
          break;

        case 3:
          key = this.deriveReceive(this.receiveDepth);
          lookahead = this.deriveReceive(this.receiveDepth + this.lookahead);
          _context3.next = 7;
          return this.saveKey(lookahead);

        case 7:
          this.receiveDepth++;
          this.receive = key;
          return _context3.abrupt('break', 25);

        case 10:
          key = this.deriveChange(this.changeDepth);
          lookahead = this.deriveReceive(this.changeDepth + this.lookahead);
          _context3.next = 14;
          return this.saveKey(lookahead);

        case 14:
          this.changeDepth++;
          this.change = key;
          return _context3.abrupt('break', 25);

        case 17:
          key = this.deriveNested(this.nestedDepth);
          lookahead = this.deriveNested(this.nestedDepth + this.lookahead);
          _context3.next = 21;
          return this.saveKey(lookahead);

        case 21:
          this.nestedDepth++;
          this.nested = key;
          return _context3.abrupt('break', 25);

        case 24:
          throw new Error('Bad branch: ' + branch);

        case 25:

          this.save();

          return _context3.abrupt('return', key);

        case 27:
        case 'end':
          return _context3.stop();
      }
    }
  }, createKey, this);
}));

/**
 * Derive a receiving address at `index`. Do not increment depth.
 * @param {Number} index
 * @returns {WalletKey}
 */

Account.prototype.deriveReceive = function deriveReceive(index, master) {
  return this.deriveKey(0, index, master);
};

/**
 * Derive a change address at `index`. Do not increment depth.
 * @param {Number} index
 * @returns {WalletKey}
 */

Account.prototype.deriveChange = function deriveChange(index, master) {
  return this.deriveKey(1, index, master);
};

/**
 * Derive a nested address at `index`. Do not increment depth.
 * @param {Number} index
 * @returns {WalletKey}
 */

Account.prototype.deriveNested = function deriveNested(index, master) {
  if (!this.witness) throw new Error('Cannot derive nested on non-witness account.');

  return this.deriveKey(2, index, master);
};

/**
 * Derive an address from `path` object.
 * @param {Path} path
 * @param {MasterKey} master
 * @returns {WalletKey}
 */

Account.prototype.derivePath = function derivePath(path, master) {
  var data = path.data;
  var ring;

  switch (path.keyType) {
    case Path.types.HD:
      return this.deriveKey(path.branch, path.index, master);
    case Path.types.KEY:
      assert(this.type === Account.types.PUBKEYHASH);

      if (path.encrypted) {
        data = master.decipher(data, path.hash);
        if (!data) return;
      }

      ring = WalletKey.fromImport(this, data);

      return ring;
    case Path.types.ADDRESS:
      return;
    default:
      assert(false, 'Bad key type.');
  }
};

/**
 * Derive an address at `index`. Do not increment depth.
 * @param {Number} branch - Whether the address on the change branch.
 * @param {Number} index
 * @returns {WalletKey}
 */

Account.prototype.deriveKey = function deriveKey(branch, index, master) {
  var keys = [];
  var i, key, shared, ring;

  assert(typeof branch === 'number');

  if (master && master.key && !this.watchOnly) {
    key = master.key.deriveAccount44(this.accountIndex);
    key = key.derive(branch).derive(index);
  } else {
    key = this.accountKey.derive(branch).derive(index);
  }

  ring = WalletKey.fromHD(this, key, branch, index);

  switch (this.type) {
    case Account.types.PUBKEYHASH:
      break;
    case Account.types.MULTISIG:
      keys.push(key.publicKey);

      for (i = 0; i < this.keys.length; i++) {
        shared = this.keys[i];
        shared = shared.derive(branch).derive(index);
        keys.push(shared.publicKey);
      }

      ring.script = Script.fromMultisig(this.m, this.n, keys);

      break;
  }

  return ring;
};

/**
 * Save the account to the database. Necessary
 * when address depth and keys change.
 * @returns {Promise}
 */

Account.prototype.save = function save() {
  return this.db.saveAccount(this);
};

/**
 * Save addresses to path map.
 * @param {WalletKey[]} rings
 * @returns {Promise}
 */

Account.prototype.saveKey = function saveKey(ring) {
  return this.db.saveKey(this.wallet, ring);
};

/**
 * Save paths to path map.
 * @param {Path[]} rings
 * @returns {Promise}
 */

Account.prototype.savePath = function savePath(path) {
  return this.db.savePath(this.wallet, path);
};

/**
 * Initialize address depths (including lookahead).
 * @returns {Promise}
 */

Account.prototype.initDepth = co( /*#__PURE__*/_regenerator2.default.mark(function initDepth() {
  var i, key;
  return _regenerator2.default.wrap(function initDepth$(_context4) {
    while (1) {
      switch (_context4.prev = _context4.next) {
        case 0:

          // Receive Address
          this.receive = this.deriveReceive(0);
          this.receiveDepth = 1;

          _context4.next = 4;
          return this.saveKey(this.receive);

        case 4:
          i = 0;

        case 5:
          if (!(i < this.lookahead)) {
            _context4.next = 12;
            break;
          }

          key = this.deriveReceive(i + 1);
          _context4.next = 9;
          return this.saveKey(key);

        case 9:
          i++;
          _context4.next = 5;
          break;

        case 12:

          // Change Address
          this.change = this.deriveChange(0);
          this.changeDepth = 1;

          _context4.next = 16;
          return this.saveKey(this.change);

        case 16:
          i = 0;

        case 17:
          if (!(i < this.lookahead)) {
            _context4.next = 24;
            break;
          }

          key = this.deriveChange(i + 1);
          _context4.next = 21;
          return this.saveKey(key);

        case 21:
          i++;
          _context4.next = 17;
          break;

        case 24:
          if (!this.witness) {
            _context4.next = 37;
            break;
          }

          this.nested = this.deriveNested(0);
          this.nestedDepth = 1;

          _context4.next = 29;
          return this.saveKey(this.nested);

        case 29:
          i = 0;

        case 30:
          if (!(i < this.lookahead)) {
            _context4.next = 37;
            break;
          }

          key = this.deriveNested(i + 1);
          _context4.next = 34;
          return this.saveKey(key);

        case 34:
          i++;
          _context4.next = 30;
          break;

        case 37:

          this.save();

        case 38:
        case 'end':
          return _context4.stop();
      }
    }
  }, initDepth, this);
}));

/**
 * Allocate new lookahead addresses if necessary.
 * @param {Number} receiveDepth
 * @param {Number} changeDepth
 * @param {Number} nestedDepth
 * @returns {Promise} - Returns {@link WalletKey}.
 */

Account.prototype.syncDepth = co( /*#__PURE__*/_regenerator2.default.mark(function syncDepth(receive, change, nested) {
  var derived, result, i, depth, key;
  return _regenerator2.default.wrap(function syncDepth$(_context5) {
    while (1) {
      switch (_context5.prev = _context5.next) {
        case 0:
          derived = false;
          result = null;

          if (!(receive > this.receiveDepth)) {
            _context5.next = 17;
            break;
          }

          depth = this.receiveDepth + this.lookahead;

          assert(receive <= depth + 1);

          i = depth;

        case 6:
          if (!(i < receive + this.lookahead)) {
            _context5.next = 13;
            break;
          }

          key = this.deriveReceive(i);
          _context5.next = 10;
          return this.saveKey(key);

        case 10:
          i++;
          _context5.next = 6;
          break;

        case 13:

          this.receive = this.deriveReceive(receive - 1);
          this.receiveDepth = receive;

          derived = true;
          result = this.receive;

        case 17:
          if (!(change > this.changeDepth)) {
            _context5.next = 31;
            break;
          }

          depth = this.changeDepth + this.lookahead;

          assert(change <= depth + 1);

          i = depth;

        case 21:
          if (!(i < change + this.lookahead)) {
            _context5.next = 28;
            break;
          }

          key = this.deriveChange(i);
          _context5.next = 25;
          return this.saveKey(key);

        case 25:
          i++;
          _context5.next = 21;
          break;

        case 28:

          this.change = this.deriveChange(change - 1);
          this.changeDepth = change;

          derived = true;

        case 31:
          if (!(this.witness && nested > this.nestedDepth)) {
            _context5.next = 46;
            break;
          }

          depth = this.nestedDepth + this.lookahead;

          assert(nested <= depth + 1);

          i = depth;

        case 35:
          if (!(i < nested + this.lookahead)) {
            _context5.next = 42;
            break;
          }

          key = this.deriveNested(i);
          _context5.next = 39;
          return this.saveKey(key);

        case 39:
          i++;
          _context5.next = 35;
          break;

        case 42:

          this.nested = this.deriveNested(nested - 1);
          this.nestedDepth = nested;

          derived = true;
          result = this.nested;

        case 46:

          if (derived) this.save();

          return _context5.abrupt('return', result);

        case 48:
        case 'end':
          return _context5.stop();
      }
    }
  }, syncDepth, this);
}));

/**
 * Allocate new lookahead addresses.
 * @param {Number} lookahead
 * @returns {Promise}
 */

Account.prototype.setLookahead = co( /*#__PURE__*/_regenerator2.default.mark(function setLookahead(lookahead) {
  var i, diff, key, depth, target;
  return _regenerator2.default.wrap(function setLookahead$(_context6) {
    while (1) {
      switch (_context6.prev = _context6.next) {
        case 0:
          if (!(lookahead === this.lookahead)) {
            _context6.next = 3;
            break;
          }

          this.db.logger.warning('Lookahead is not changing for: %s/%s.', this.id, this.name);
          return _context6.abrupt('return');

        case 3:
          if (!(lookahead < this.lookahead)) {
            _context6.next = 13;
            break;
          }

          diff = this.lookahead - lookahead;

          this.receiveDepth += diff;
          this.receive = this.deriveReceive(this.receiveDepth - 1);

          this.changeDepth += diff;
          this.change = this.deriveChange(this.changeDepth - 1);

          if (this.witness) {
            this.nestedDepth += diff;
            this.nested = this.deriveNested(this.nestedDepth - 1);
          }

          this.lookahead = lookahead;

          this.save();

          return _context6.abrupt('return');

        case 13:

          depth = this.receiveDepth + this.lookahead;
          target = this.receiveDepth + lookahead;

          i = depth;

        case 16:
          if (!(i < target)) {
            _context6.next = 23;
            break;
          }

          key = this.deriveReceive(i);
          _context6.next = 20;
          return this.saveKey(key);

        case 20:
          i++;
          _context6.next = 16;
          break;

        case 23:

          depth = this.changeDepth + this.lookahead;
          target = this.changeDepth + lookahead;

          i = depth;

        case 26:
          if (!(i < target)) {
            _context6.next = 33;
            break;
          }

          key = this.deriveChange(i);
          _context6.next = 30;
          return this.saveKey(key);

        case 30:
          i++;
          _context6.next = 26;
          break;

        case 33:
          if (!this.witness) {
            _context6.next = 44;
            break;
          }

          depth = this.nestedDepth + this.lookahead;
          target = this.nestedDepth + lookahead;

          i = depth;

        case 37:
          if (!(i < target)) {
            _context6.next = 44;
            break;
          }

          key = this.deriveNested(i);
          _context6.next = 41;
          return this.saveKey(key);

        case 41:
          i++;
          _context6.next = 37;
          break;

        case 44:

          this.lookahead = lookahead;
          this.save();

        case 46:
        case 'end':
          return _context6.stop();
      }
    }
  }, setLookahead, this);
}));

/**
 * Get current receive address.
 * @param {String?} enc - `"base58"` or `null`.
 * @returns {Address|Base58Address}
 */

Account.prototype.getAddress = function getAddress(enc) {
  return this.getReceive(enc);
};

/**
 * Get current receive address.
 * @param {String?} enc - `"base58"` or `null`.
 * @returns {Address|Base58Address}
 */

Account.prototype.getReceive = function getReceive(enc) {
  if (!this.receive) return;
  return this.receive.getAddress(enc);
};

/**
 * Get current change address.
 * @param {String?} enc - `"base58"` or `null`.
 * @returns {Address|Base58Address}
 */

Account.prototype.getChange = function getChange(enc) {
  if (!this.change) return;
  return this.change.getAddress(enc);
};

/**
 * Get current nested address.
 * @param {String?} enc - `"base58"` or `null`.
 * @returns {Address|Base58Address}
 */

Account.prototype.getNested = function getNested(enc) {
  if (!this.nested) return;
  return this.nested.getAddress(enc);
};

/**
 * Convert the account to a more inspection-friendly object.
 * @returns {Object}
 */

Account.prototype.inspect = function inspect() {
  return {
    wid: this.wid,
    name: this.name,
    network: this.network,
    initialized: this.initialized,
    witness: this.witness,
    watchOnly: this.watchOnly,
    type: Account.typesByVal[this.type].toLowerCase(),
    m: this.m,
    n: this.n,
    accountIndex: this.accountIndex,
    receiveDepth: this.receiveDepth,
    changeDepth: this.changeDepth,
    nestedDepth: this.nestedDepth,
    lookahead: this.lookahead,
    address: this.initialized ? this.receive.getAddress() : null,
    nestedAddress: this.initialized && this.nested ? this.nested.getAddress() : null,
    accountKey: this.accountKey.toBase58(),
    keys: this.keys.map(function (key) {
      return key.toBase58();
    })
  };
};

/**
 * Convert the account to an object suitable for
 * serialization.
 * @returns {Object}
 */

Account.prototype.toJSON = function toJSON(minimal) {
  return {
    wid: minimal ? undefined : this.wid,
    id: minimal ? undefined : this.id,
    name: this.name,
    initialized: this.initialized,
    witness: this.witness,
    watchOnly: this.watchOnly,
    type: Account.typesByVal[this.type].toLowerCase(),
    m: this.m,
    n: this.n,
    accountIndex: this.accountIndex,
    receiveDepth: this.receiveDepth,
    changeDepth: this.changeDepth,
    nestedDepth: this.nestedDepth,
    lookahead: this.lookahead,
    receiveAddress: this.receive ? this.receive.getAddress('string') : null,
    nestedAddress: this.nested ? this.nested.getAddress('string') : null,
    changeAddress: this.change ? this.change.getAddress('string') : null,
    accountKey: this.accountKey.toBase58(),
    keys: this.keys.map(function (key) {
      return key.toBase58();
    })
  };
};

/**
 * Calculate serialization size.
 * @returns {Number}
 */

Account.prototype.getSize = function getSize() {
  var size = 0;
  size += encoding.sizeVarString(this.name, 'ascii');
  size += 105;
  size += this.keys.length * 82;
  return size;
};

/**
 * Serialize the account.
 * @returns {Buffer}
 */

Account.prototype.toRaw = function toRaw() {
  var size = this.getSize();
  var bw = new StaticWriter(size);
  var i, key;

  bw.writeVarString(this.name, 'ascii');
  bw.writeU8(this.initialized ? 1 : 0);
  bw.writeU8(this.witness ? 1 : 0);
  bw.writeU8(this.type);
  bw.writeU8(this.m);
  bw.writeU8(this.n);
  bw.writeU32(this.accountIndex);
  bw.writeU32(this.receiveDepth);
  bw.writeU32(this.changeDepth);
  bw.writeU32(this.nestedDepth);
  bw.writeU8(this.lookahead);
  bw.writeBytes(this.accountKey.toRaw());
  bw.writeU8(this.keys.length);

  for (i = 0; i < this.keys.length; i++) {
    key = this.keys[i];
    bw.writeBytes(key.toRaw());
  }

  return bw.render();
};

/**
 * Inject properties from serialized data.
 * @private
 * @param {Buffer} data
 * @returns {Object}
 */

Account.prototype.fromRaw = function fromRaw(data) {
  var br = new BufferReader(data);
  var i, count, key;

  this.name = br.readVarString('ascii');
  this.initialized = br.readU8() === 1;
  this.witness = br.readU8() === 1;
  this.type = br.readU8();
  this.m = br.readU8();
  this.n = br.readU8();
  this.accountIndex = br.readU32();
  this.receiveDepth = br.readU32();
  this.changeDepth = br.readU32();
  this.nestedDepth = br.readU32();
  this.lookahead = br.readU8();
  this.accountKey = HD.PublicKey.fromRaw(br.readBytes(82));

  assert(Account.typesByVal[this.type]);

  count = br.readU8();

  for (i = 0; i < count; i++) {
    key = HD.PublicKey.fromRaw(br.readBytes(82));
    this.pushKey(key);
  }

  return this;
};

/**
 * Instantiate a account from serialized data.
 * @param {WalletDB} data
 * @param {Buffer} data
 * @returns {Account}
 */

Account.fromRaw = function fromRaw(db, data) {
  return new Account(db).fromRaw(data);
};

/**
 * Test an object to see if it is a Account.
 * @param {Object} obj
 * @returns {Boolean}
 */

Account.isAccount = function isAccount(obj) {
  return obj && typeof obj.receiveDepth === 'number' && obj.deriveKey === 'function';
};

/*
 * Helpers
 */

function cmp(key1, key2) {
  return key1.compare(key2);
}

/*
 * Expose
 */

module.exports = Account;