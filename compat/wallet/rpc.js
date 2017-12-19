/*!
 * rpc.js - bitcoind-compatible json rpc for bcoin.
 * Copyright (c) 2014-2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

var _keys = require('babel-runtime/core-js/object/keys');

var _keys2 = _interopRequireDefault(_keys);

var _regenerator = require('babel-runtime/regenerator');

var _regenerator2 = _interopRequireDefault(_regenerator);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var assert = require('assert');
var fs = require('../utils/fs');
var util = require('../utils/util');
var co = require('../utils/co');
var crypto = require('../crypto/crypto');
var Amount = require('../btc/amount');
var Script = require('../script/script');
var Address = require('../primitives/address');
var KeyRing = require('../primitives/keyring');
var MerkleBlock = require('../primitives/merkleblock');
var MTX = require('../primitives/mtx');
var Outpoint = require('../primitives/outpoint');
var Output = require('../primitives/output');
var TX = require('../primitives/tx');
var encoding = require('../utils/encoding');
var RPCBase = require('../http/rpcbase');
var pkg = require('../pkg');
var Validator = require('../utils/validator');
var common = require('./common');
var RPCError = RPCBase.RPCError;
var errs = RPCBase.errors;
var MAGIC_STRING = RPCBase.MAGIC_STRING;

/**
 * Bitcoin Core RPC
 * @alias module:wallet.RPC
 * @constructor
 * @param {WalletDB} wdb
 */

function RPC(wdb) {
  if (!(this instanceof RPC)) return new RPC(wdb);

  RPCBase.call(this);

  assert(wdb, 'RPC requires a WalletDB.');

  this.wdb = wdb;
  this.network = wdb.network;
  this.logger = wdb.logger.context('rpc');
  this.client = wdb.client;

  this.wallet = null;
  this.feeRate = null;

  this.init();
}

util.inherits(RPC, RPCBase);

RPC.prototype.init = function init() {
  this.add('help', this.help);
  this.add('stop', this.stop);
  this.add('fundrawtransaction', this.fundRawTransaction);
  this.add('resendwallettransactions', this.resendWalletTransactions);
  this.add('abandontransaction', this.abandonTransaction);
  this.add('addmultisigaddress', this.addMultisigAddress);
  this.add('addwitnessaddress', this.addWitnessAddress);
  this.add('backupwallet', this.backupWallet);
  this.add('dumpprivkey', this.dumpPrivKey);
  this.add('dumpwallet', this.dumpWallet);
  this.add('encryptwallet', this.encryptWallet);
  this.add('getaccountaddress', this.getAccountAddress);
  this.add('getaccount', this.getAccount);
  this.add('getaddressesbyaccount', this.getAddressesByAccount);
  this.add('getbalance', this.getBalance);
  this.add('getnewaddress', this.getNewAddress);
  this.add('getrawchangeaddress', this.getRawChangeAddress);
  this.add('getreceivedbyaccount', this.getReceivedByAccount);
  this.add('getreceivedbyaddress', this.getReceivedByAddress);
  this.add('gettransaction', this.getTransaction);
  this.add('getunconfirmedbalance', this.getUnconfirmedBalance);
  this.add('getwalletinfo', this.getWalletInfo);
  this.add('importprivkey', this.importPrivKey);
  this.add('importwallet', this.importWallet);
  this.add('importaddress', this.importAddress);
  this.add('importprunedfunds', this.importPrunedFunds);
  this.add('importpubkey', this.importPubkey);
  this.add('keypoolrefill', this.keyPoolRefill);
  this.add('listaccounts', this.listAccounts);
  this.add('listaddressgroupings', this.listAddressGroupings);
  this.add('listlockunspent', this.listLockUnspent);
  this.add('listreceivedbyaccount', this.listReceivedByAccount);
  this.add('listreceivedbyaddress', this.listReceivedByAddress);
  this.add('listsinceblock', this.listSinceBlock);
  this.add('listtransactions', this.listTransactions);
  this.add('listunspent', this.listUnspent);
  this.add('lockunspent', this.lockUnspent);
  this.add('move', this.move);
  this.add('sendfrom', this.sendFrom);
  this.add('sendmany', this.sendMany);
  this.add('sendtoaddress', this.sendToAddress);
  this.add('setaccount', this.setAccount);
  this.add('settxfee', this.setTXFee);
  this.add('signmessage', this.signMessage);
  this.add('walletlock', this.walletLock);
  this.add('walletpassphrasechange', this.walletPassphraseChange);
  this.add('walletpassphrase', this.walletPassphrase);
  this.add('removeprunedfunds', this.removePrunedFunds);
  this.add('selectwallet', this.selectWallet);
  this.add('getmemoryinfo', this.getMemoryInfo);
  this.add('setloglevel', this.setLogLevel);
};

RPC.prototype.help = co( /*#__PURE__*/_regenerator2.default.mark(function _help(args, help) {
  var json;
  return _regenerator2.default.wrap(function _help$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:
          if (!(args.length === 0)) {
            _context.next = 2;
            break;
          }

          return _context.abrupt('return', 'Select a command.');

        case 2:

          json = {
            method: args[0],
            params: []
          };

          _context.next = 5;
          return this.execute(json, true);

        case 5:
          return _context.abrupt('return', _context.sent);

        case 6:
        case 'end':
          return _context.stop();
      }
    }
  }, _help, this);
}));

RPC.prototype.stop = co( /*#__PURE__*/_regenerator2.default.mark(function stop(args, help) {
  return _regenerator2.default.wrap(function stop$(_context2) {
    while (1) {
      switch (_context2.prev = _context2.next) {
        case 0:
          if (!(help || args.length !== 0)) {
            _context2.next = 2;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'stop');

        case 2:

          this.wdb.close();

          return _context2.abrupt('return', 'Stopping.');

        case 4:
        case 'end':
          return _context2.stop();
      }
    }
  }, stop, this);
}));

RPC.prototype.fundRawTransaction = co( /*#__PURE__*/_regenerator2.default.mark(function fundRawTransaction(args, help) {
  var valid, data, options, wallet, rate, change, tx;
  return _regenerator2.default.wrap(function fundRawTransaction$(_context3) {
    while (1) {
      switch (_context3.prev = _context3.next) {
        case 0:
          valid = new Validator([args]);
          data = valid.buf(0);
          options = valid.obj(1);
          wallet = this.wallet;
          rate = this.feeRate;

          if (!(help || args.length < 1 || args.length > 2)) {
            _context3.next = 7;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'fundrawtransaction "hexstring" ( options )');

        case 7:
          if (data) {
            _context3.next = 9;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid hex string.');

        case 9:

          tx = MTX.fromRaw(data);

          if (!(tx.outputs.length === 0)) {
            _context3.next = 12;
            break;
          }

          throw new RPCError(errs.INVALID_PARAMETER, 'TX must have at least one output.');

        case 12:

          if (options) {
            valid = new Validator([options]);
            change = valid.str('changeAddress');
            rate = valid.btc('feeRate');

            if (change) change = parseAddress(change, this.network);
          }

          options = {
            rate: rate,
            changeAddress: change
          };

          _context3.next = 16;
          return wallet.fund(tx, options);

        case 16:
          return _context3.abrupt('return', {
            hex: tx.toRaw().toString('hex'),
            changepos: tx.changeIndex,
            fee: Amount.btc(tx.getFee(), true)
          });

        case 17:
        case 'end':
          return _context3.stop();
      }
    }
  }, fundRawTransaction, this);
}));

/*
 * Wallet
 */

RPC.prototype.resendWalletTransactions = co( /*#__PURE__*/_regenerator2.default.mark(function resendWalletTransactions(args, help) {
  var wallet, hashes, i, tx, txs;
  return _regenerator2.default.wrap(function resendWalletTransactions$(_context4) {
    while (1) {
      switch (_context4.prev = _context4.next) {
        case 0:
          wallet = this.wallet;
          hashes = [];

          if (!(help || args.length !== 0)) {
            _context4.next = 4;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'resendwallettransactions');

        case 4:
          _context4.next = 6;
          return wallet.resend();

        case 6:
          txs = _context4.sent;


          for (i = 0; i < txs.length; i++) {
            tx = txs[i];
            hashes.push(tx.txid());
          }

          return _context4.abrupt('return', hashes);

        case 9:
        case 'end':
          return _context4.stop();
      }
    }
  }, resendWalletTransactions, this);
}));

RPC.prototype.addMultisigAddress = co( /*#__PURE__*/_regenerator2.default.mark(function addMultisigAddress(args, help) {
  return _regenerator2.default.wrap(function addMultisigAddress$(_context5) {
    while (1) {
      switch (_context5.prev = _context5.next) {
        case 0:
          if (!(help || args.length < 2 || args.length > 3)) {
            _context5.next = 2;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'addmultisigaddress nrequired ["key",...] ( "account" )');

        case 2:
          throw new Error('Not implemented.');

        case 3:
        case 'end':
          return _context5.stop();
      }
    }
  }, addMultisigAddress, this);
}));

RPC.prototype.addWitnessAddress = co( /*#__PURE__*/_regenerator2.default.mark(function addWitnessAddress(args, help) {
  return _regenerator2.default.wrap(function addWitnessAddress$(_context6) {
    while (1) {
      switch (_context6.prev = _context6.next) {
        case 0:
          if (!(help || args.length < 1 || args.length > 1)) {
            _context6.next = 2;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'addwitnessaddress "address"');

        case 2:
          throw new Error('Not implemented.');

        case 3:
        case 'end':
          return _context6.stop();
      }
    }
  }, addWitnessAddress, this);
}));

RPC.prototype.backupWallet = co( /*#__PURE__*/_regenerator2.default.mark(function backupWallet(args, help) {
  var valid, dest;
  return _regenerator2.default.wrap(function backupWallet$(_context7) {
    while (1) {
      switch (_context7.prev = _context7.next) {
        case 0:
          valid = new Validator([args]);
          dest = valid.str(0);

          if (!(help || args.length !== 1 || !dest)) {
            _context7.next = 4;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'backupwallet "destination"');

        case 4:
          _context7.next = 6;
          return this.wdb.backup(dest);

        case 6:
          return _context7.abrupt('return', null);

        case 7:
        case 'end':
          return _context7.stop();
      }
    }
  }, backupWallet, this);
}));

RPC.prototype.dumpPrivKey = co( /*#__PURE__*/_regenerator2.default.mark(function dumpPrivKey(args, help) {
  var wallet, valid, addr, hash, ring;
  return _regenerator2.default.wrap(function dumpPrivKey$(_context8) {
    while (1) {
      switch (_context8.prev = _context8.next) {
        case 0:
          wallet = this.wallet;
          valid = new Validator([args]);
          addr = valid.str(0, '');

          if (!(help || args.length !== 1)) {
            _context8.next = 5;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'dumpprivkey "bitcoinaddress"');

        case 5:

          hash = parseHash(addr, this.network);
          _context8.next = 8;
          return wallet.getPrivateKey(hash);

        case 8:
          ring = _context8.sent;

          if (ring) {
            _context8.next = 11;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'Key not found.');

        case 11:
          return _context8.abrupt('return', ring.toSecret());

        case 12:
        case 'end':
          return _context8.stop();
      }
    }
  }, dumpPrivKey, this);
}));

RPC.prototype.dumpWallet = co( /*#__PURE__*/_regenerator2.default.mark(function dumpWallet(args, help) {
  var wallet, valid, file, time, i, tip, addr, fmt, str, out, hash, hashes, ring;
  return _regenerator2.default.wrap(function dumpWallet$(_context9) {
    while (1) {
      switch (_context9.prev = _context9.next) {
        case 0:
          wallet = this.wallet;
          valid = new Validator([args]);
          file = valid.str(0);
          time = util.date();

          if (!(help || args.length !== 1)) {
            _context9.next = 6;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'dumpwallet "filename"');

        case 6:
          if (file) {
            _context9.next = 8;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid parameter.');

        case 8:
          _context9.next = 10;
          return this.wdb.getTip();

        case 10:
          tip = _context9.sent;


          out = [util.fmt('# Wallet Dump created by Bcoin %s', pkg.version), util.fmt('# * Created on %s', time), util.fmt('# * Best block at time of backup was %d (%s).', tip.height, util.revHex(tip.hash)), util.fmt('# * File: %s', file), ''];

          _context9.next = 14;
          return wallet.getAddressHashes();

        case 14:
          hashes = _context9.sent;
          i = 0;

        case 16:
          if (!(i < hashes.length)) {
            _context9.next = 31;
            break;
          }

          hash = hashes[i];
          _context9.next = 20;
          return wallet.getPrivateKey(hash);

        case 20:
          ring = _context9.sent;

          if (ring) {
            _context9.next = 23;
            break;
          }

          return _context9.abrupt('continue', 28);

        case 23:

          addr = ring.getAddress('string');
          fmt = '%s %s label= addr=%s';

          if (ring.branch === 1) fmt = '%s %s change=1 addr=%s';

          str = util.fmt(fmt, ring.toSecret(), time, addr);

          out.push(str);

        case 28:
          i++;
          _context9.next = 16;
          break;

        case 31:

          out.push('');
          out.push('# End of dump');
          out.push('');

          out = out.join('\n');

          if (!fs.unsupported) {
            _context9.next = 37;
            break;
          }

          return _context9.abrupt('return', out);

        case 37:
          _context9.next = 39;
          return fs.writeFile(file, out, 'utf8');

        case 39:
          return _context9.abrupt('return', null);

        case 40:
        case 'end':
          return _context9.stop();
      }
    }
  }, dumpWallet, this);
}));

RPC.prototype.encryptWallet = co( /*#__PURE__*/_regenerator2.default.mark(function encryptWallet(args, help) {
  var wallet, valid, passphrase;
  return _regenerator2.default.wrap(function encryptWallet$(_context10) {
    while (1) {
      switch (_context10.prev = _context10.next) {
        case 0:
          wallet = this.wallet;
          valid = new Validator([args]);
          passphrase = valid.str(0, '');

          if (!(!wallet.master.encrypted && (help || args.length !== 1))) {
            _context10.next = 5;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'encryptwallet "passphrase"');

        case 5:
          if (!wallet.master.encrypted) {
            _context10.next = 7;
            break;
          }

          throw new RPCError(errs.WALLET_WRONG_ENC_STATE, 'Already running with an encrypted wallet.');

        case 7:
          if (!(passphrase.length < 1)) {
            _context10.next = 9;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'encryptwallet "passphrase"');

        case 9:
          _context10.prev = 9;
          _context10.next = 12;
          return wallet.setPassphrase(passphrase);

        case 12:
          _context10.next = 17;
          break;

        case 14:
          _context10.prev = 14;
          _context10.t0 = _context10['catch'](9);
          throw new RPCError(errs.WALLET_ENCRYPTION_FAILED, 'Encryption failed.');

        case 17:
          return _context10.abrupt('return', 'wallet encrypted; we do not need to stop!');

        case 18:
        case 'end':
          return _context10.stop();
      }
    }
  }, encryptWallet, this, [[9, 14]]);
}));

RPC.prototype.getAccountAddress = co( /*#__PURE__*/_regenerator2.default.mark(function getAccountAddress(args, help) {
  var valid, wallet, name, account;
  return _regenerator2.default.wrap(function getAccountAddress$(_context11) {
    while (1) {
      switch (_context11.prev = _context11.next) {
        case 0:
          valid = new Validator([args]);
          wallet = this.wallet;
          name = valid.str(0, '');

          if (!(help || args.length !== 1)) {
            _context11.next = 5;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getaccountaddress "account"');

        case 5:

          if (!name) name = 'default';

          _context11.next = 8;
          return wallet.getAccount(name);

        case 8:
          account = _context11.sent;

          if (account) {
            _context11.next = 11;
            break;
          }

          return _context11.abrupt('return', '');

        case 11:
          return _context11.abrupt('return', account.receive.getAddress('string'));

        case 12:
        case 'end':
          return _context11.stop();
      }
    }
  }, getAccountAddress, this);
}));

RPC.prototype.getAccount = co( /*#__PURE__*/_regenerator2.default.mark(function getAccount(args, help) {
  var wallet, valid, addr, hash, path;
  return _regenerator2.default.wrap(function getAccount$(_context12) {
    while (1) {
      switch (_context12.prev = _context12.next) {
        case 0:
          wallet = this.wallet;
          valid = new Validator([args]);
          addr = valid.str(0, '');

          if (!(help || args.length !== 1)) {
            _context12.next = 5;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getaccount "bitcoinaddress"');

        case 5:

          hash = parseHash(addr, this.network);
          _context12.next = 8;
          return wallet.getPath(hash);

        case 8:
          path = _context12.sent;

          if (path) {
            _context12.next = 11;
            break;
          }

          return _context12.abrupt('return', '');

        case 11:
          return _context12.abrupt('return', path.name);

        case 12:
        case 'end':
          return _context12.stop();
      }
    }
  }, getAccount, this);
}));

RPC.prototype.getAddressesByAccount = co( /*#__PURE__*/_regenerator2.default.mark(function getAddressesByAccount(args, help) {
  var wallet, valid, name, i, path, address, addrs, paths;
  return _regenerator2.default.wrap(function getAddressesByAccount$(_context13) {
    while (1) {
      switch (_context13.prev = _context13.next) {
        case 0:
          wallet = this.wallet;
          valid = new Validator([args]);
          name = valid.str(0, '');

          if (!(help || args.length !== 1)) {
            _context13.next = 5;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getaddressesbyaccount "account"');

        case 5:

          if (name === '') name = 'default';

          addrs = [];

          _context13.next = 9;
          return wallet.getPaths(name);

        case 9:
          paths = _context13.sent;


          for (i = 0; i < paths.length; i++) {
            path = paths[i];
            address = path.toAddress();
            addrs.push(address.toString(this.network));
          }

          return _context13.abrupt('return', addrs);

        case 12:
        case 'end':
          return _context13.stop();
      }
    }
  }, getAddressesByAccount, this);
}));

RPC.prototype.getBalance = co( /*#__PURE__*/_regenerator2.default.mark(function getBalance(args, help) {
  var wallet, valid, name, minconf, watchOnly, value, balance;
  return _regenerator2.default.wrap(function getBalance$(_context14) {
    while (1) {
      switch (_context14.prev = _context14.next) {
        case 0:
          wallet = this.wallet;
          valid = new Validator([args]);
          name = valid.str(0);
          minconf = valid.u32(1, 0);
          watchOnly = valid.bool(2, false);

          if (!(help || args.length > 3)) {
            _context14.next = 7;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getbalance ( "account" minconf includeWatchonly )');

        case 7:

          if (name === '') name = 'default';

          if (name === '*') name = null;

          if (!(wallet.watchOnly !== watchOnly)) {
            _context14.next = 11;
            break;
          }

          return _context14.abrupt('return', 0);

        case 11:
          _context14.next = 13;
          return wallet.getBalance(name);

        case 13:
          balance = _context14.sent;


          if (minconf > 0) value = balance.confirmed;else value = balance.unconfirmed;

          return _context14.abrupt('return', Amount.btc(value, true));

        case 16:
        case 'end':
          return _context14.stop();
      }
    }
  }, getBalance, this);
}));

RPC.prototype.getNewAddress = co( /*#__PURE__*/_regenerator2.default.mark(function getNewAddress(args, help) {
  var wallet, valid, name, address;
  return _regenerator2.default.wrap(function getNewAddress$(_context15) {
    while (1) {
      switch (_context15.prev = _context15.next) {
        case 0:
          wallet = this.wallet;
          valid = new Validator([args]);
          name = valid.str(0);

          if (!(help || args.length > 1)) {
            _context15.next = 5;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getnewaddress ( "account" )');

        case 5:

          if (name === '') name = 'default';

          _context15.next = 8;
          return wallet.createReceive(name);

        case 8:
          address = _context15.sent;
          return _context15.abrupt('return', address.getAddress('string'));

        case 10:
        case 'end':
          return _context15.stop();
      }
    }
  }, getNewAddress, this);
}));

RPC.prototype.getRawChangeAddress = co( /*#__PURE__*/_regenerator2.default.mark(function getRawChangeAddress(args, help) {
  var wallet, address;
  return _regenerator2.default.wrap(function getRawChangeAddress$(_context16) {
    while (1) {
      switch (_context16.prev = _context16.next) {
        case 0:
          wallet = this.wallet;

          if (!(help || args.length > 1)) {
            _context16.next = 3;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getrawchangeaddress');

        case 3:
          _context16.next = 5;
          return wallet.createChange();

        case 5:
          address = _context16.sent;
          return _context16.abrupt('return', address.getAddress('string'));

        case 7:
        case 'end':
          return _context16.stop();
      }
    }
  }, getRawChangeAddress, this);
}));

RPC.prototype.getReceivedByAccount = co( /*#__PURE__*/_regenerator2.default.mark(function getReceivedByAccount(args, help) {
  var wallet, valid, name, minconf, height, total, filter, lastConf, i, j, path, wtx, output, conf, hash, paths, txs;
  return _regenerator2.default.wrap(function getReceivedByAccount$(_context17) {
    while (1) {
      switch (_context17.prev = _context17.next) {
        case 0:
          wallet = this.wallet;
          valid = new Validator([args]);
          name = valid.str(0);
          minconf = valid.u32(0, 0);
          height = this.wdb.state.height;
          total = 0;
          filter = {};
          lastConf = -1;

          if (!(help || args.length < 1 || args.length > 2)) {
            _context17.next = 10;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getreceivedbyaccount "account" ( minconf )');

        case 10:

          if (name === '') name = 'default';

          _context17.next = 13;
          return wallet.getPaths(name);

        case 13:
          paths = _context17.sent;


          for (i = 0; i < paths.length; i++) {
            path = paths[i];
            filter[path.hash] = true;
          }

          _context17.next = 17;
          return wallet.getHistory(name);

        case 17:
          txs = _context17.sent;
          i = 0;

        case 19:
          if (!(i < txs.length)) {
            _context17.next = 29;
            break;
          }

          wtx = txs[i];

          conf = wtx.getDepth(height);

          if (!(conf < minconf)) {
            _context17.next = 24;
            break;
          }

          return _context17.abrupt('continue', 26);

        case 24:

          if (lastConf === -1 || conf < lastConf) lastConf = conf;

          for (j = 0; j < wtx.tx.outputs.length; j++) {
            output = wtx.tx.outputs[j];
            hash = output.getHash('hex');
            if (hash && filter[hash]) total += output.value;
          }

        case 26:
          i++;
          _context17.next = 19;
          break;

        case 29:
          return _context17.abrupt('return', Amount.btc(total, true));

        case 30:
        case 'end':
          return _context17.stop();
      }
    }
  }, getReceivedByAccount, this);
}));

RPC.prototype.getReceivedByAddress = co( /*#__PURE__*/_regenerator2.default.mark(function getReceivedByAddress(args, help) {
  var wallet, valid, addr, minconf, height, total, i, j, hash, wtx, output, txs;
  return _regenerator2.default.wrap(function getReceivedByAddress$(_context18) {
    while (1) {
      switch (_context18.prev = _context18.next) {
        case 0:
          wallet = this.wallet;
          valid = new Validator([args]);
          addr = valid.str(0, '');
          minconf = valid.u32(1, 0);
          height = this.wdb.state.height;
          total = 0;

          if (!(help || args.length < 1 || args.length > 2)) {
            _context18.next = 8;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getreceivedbyaddress "bitcoinaddress" ( minconf )');

        case 8:

          hash = parseHash(addr, this.network);
          _context18.next = 11;
          return wallet.getHistory();

        case 11:
          txs = _context18.sent;
          i = 0;

        case 13:
          if (!(i < txs.length)) {
            _context18.next = 21;
            break;
          }

          wtx = txs[i];

          if (!(wtx.getDepth(height) < minconf)) {
            _context18.next = 17;
            break;
          }

          return _context18.abrupt('continue', 18);

        case 17:

          for (j = 0; j < wtx.tx.outputs.length; j++) {
            output = wtx.tx.outputs[j];
            if (output.getHash('hex') === hash) total += output.value;
          }

        case 18:
          i++;
          _context18.next = 13;
          break;

        case 21:
          return _context18.abrupt('return', Amount.btc(total, true));

        case 22:
        case 'end':
          return _context18.stop();
      }
    }
  }, getReceivedByAddress, this);
}));

RPC.prototype._toWalletTX = co( /*#__PURE__*/_regenerator2.default.mark(function _toWalletTX(wtx) {
  var wallet, details, det, sent, received, receive, i, member;
  return _regenerator2.default.wrap(function _toWalletTX$(_context19) {
    while (1) {
      switch (_context19.prev = _context19.next) {
        case 0:
          wallet = this.wallet;
          _context19.next = 3;
          return wallet.toDetails(wtx);

        case 3:
          details = _context19.sent;
          det = [];
          sent = 0;
          received = 0;
          receive = true;

          if (details) {
            _context19.next = 10;
            break;
          }

          throw new RPCError(errs.WALLET_ERROR, 'TX not found.');

        case 10:
          i = 0;

        case 11:
          if (!(i < details.inputs.length)) {
            _context19.next = 19;
            break;
          }

          member = details.inputs[i];

          if (!member.path) {
            _context19.next = 16;
            break;
          }

          receive = false;
          return _context19.abrupt('break', 19);

        case 16:
          i++;
          _context19.next = 11;
          break;

        case 19:
          i = 0;

        case 20:
          if (!(i < details.outputs.length)) {
            _context19.next = 35;
            break;
          }

          member = details.outputs[i];

          if (!member.path) {
            _context19.next = 28;
            break;
          }

          if (!(member.path.branch === 1)) {
            _context19.next = 25;
            break;
          }

          return _context19.abrupt('continue', 32);

        case 25:

          det.push({
            account: member.path.name,
            address: member.address.toString(this.network),
            category: 'receive',
            amount: Amount.btc(member.value, true),
            label: member.path.name,
            vout: i
          });

          received += member.value;

          return _context19.abrupt('continue', 32);

        case 28:
          if (!receive) {
            _context19.next = 30;
            break;
          }

          return _context19.abrupt('continue', 32);

        case 30:

          det.push({
            account: '',
            address: member.address ? member.address.toString(this.network) : null,
            category: 'send',
            amount: -Amount.btc(member.value, true),
            fee: -Amount.btc(details.fee, true),
            vout: i
          });

          sent += member.value;

        case 32:
          i++;
          _context19.next = 20;
          break;

        case 35:
          return _context19.abrupt('return', {
            amount: Amount.btc(receive ? received : -sent, true),
            confirmations: details.confirmations,
            blockhash: details.block ? util.revHex(details.block) : null,
            blockindex: details.index,
            blocktime: details.ts,
            txid: util.revHex(details.hash),
            walletconflicts: [],
            time: details.ps,
            timereceived: details.ps,
            'bip125-replaceable': 'no',
            details: det,
            hex: details.tx.toRaw().toString('hex')
          });

        case 36:
        case 'end':
          return _context19.stop();
      }
    }
  }, _toWalletTX, this);
}));

RPC.prototype.getTransaction = co( /*#__PURE__*/_regenerator2.default.mark(function getTransaction(args, help) {
  var wallet, valid, hash, watchOnly, wtx;
  return _regenerator2.default.wrap(function getTransaction$(_context20) {
    while (1) {
      switch (_context20.prev = _context20.next) {
        case 0:
          wallet = this.wallet;
          valid = new Validator([args]);
          hash = valid.hash(0);
          watchOnly = valid.bool(1, false);

          if (!(help || args.length < 1 || args.length > 2)) {
            _context20.next = 6;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'gettransaction "txid" ( includeWatchonly )');

        case 6:
          if (hash) {
            _context20.next = 8;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid parameter');

        case 8:
          _context20.next = 10;
          return wallet.getTX(hash);

        case 10:
          wtx = _context20.sent;

          if (wtx) {
            _context20.next = 13;
            break;
          }

          throw new RPCError(errs.WALLET_ERROR, 'TX not found.');

        case 13:
          _context20.next = 15;
          return this._toWalletTX(wtx, watchOnly);

        case 15:
          return _context20.abrupt('return', _context20.sent);

        case 16:
        case 'end':
          return _context20.stop();
      }
    }
  }, getTransaction, this);
}));

RPC.prototype.abandonTransaction = co( /*#__PURE__*/_regenerator2.default.mark(function abandonTransaction(args, help) {
  var wallet, valid, hash, result;
  return _regenerator2.default.wrap(function abandonTransaction$(_context21) {
    while (1) {
      switch (_context21.prev = _context21.next) {
        case 0:
          wallet = this.wallet;
          valid = new Validator([args]);
          hash = valid.hash(0);

          if (!(help || args.length !== 1)) {
            _context21.next = 5;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'abandontransaction "txid"');

        case 5:
          if (hash) {
            _context21.next = 7;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid parameter.');

        case 7:
          _context21.next = 9;
          return wallet.abandon(hash);

        case 9:
          result = _context21.sent;

          if (result) {
            _context21.next = 12;
            break;
          }

          throw new RPCError(errs.WALLET_ERROR, 'Transaction not in wallet.');

        case 12:
          return _context21.abrupt('return', null);

        case 13:
        case 'end':
          return _context21.stop();
      }
    }
  }, abandonTransaction, this);
}));

RPC.prototype.getUnconfirmedBalance = co( /*#__PURE__*/_regenerator2.default.mark(function getUnconfirmedBalance(args, help) {
  var wallet, balance;
  return _regenerator2.default.wrap(function getUnconfirmedBalance$(_context22) {
    while (1) {
      switch (_context22.prev = _context22.next) {
        case 0:
          wallet = this.wallet;

          if (!(help || args.length > 0)) {
            _context22.next = 3;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getunconfirmedbalance');

        case 3:
          _context22.next = 5;
          return wallet.getBalance();

        case 5:
          balance = _context22.sent;
          return _context22.abrupt('return', Amount.btc(balance.unconfirmed, true));

        case 7:
        case 'end':
          return _context22.stop();
      }
    }
  }, getUnconfirmedBalance, this);
}));

RPC.prototype.getWalletInfo = co( /*#__PURE__*/_regenerator2.default.mark(function getWalletInfo(args, help) {
  var wallet, balance;
  return _regenerator2.default.wrap(function getWalletInfo$(_context23) {
    while (1) {
      switch (_context23.prev = _context23.next) {
        case 0:
          wallet = this.wallet;

          if (!(help || args.length !== 0)) {
            _context23.next = 3;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getwalletinfo');

        case 3:
          _context23.next = 5;
          return wallet.getBalance();

        case 5:
          balance = _context23.sent;
          return _context23.abrupt('return', {
            walletid: wallet.id,
            walletversion: 6,
            balance: Amount.btc(balance.unconfirmed, true),
            unconfirmed_balance: Amount.btc(balance.unconfirmed, true),
            txcount: wallet.txdb.state.tx,
            keypoololdest: 0,
            keypoolsize: 0,
            unlocked_until: wallet.master.until,
            paytxfee: this.feeRate != null ? Amount.btc(this.feeRate, true) : 0
          });

        case 7:
        case 'end':
          return _context23.stop();
      }
    }
  }, getWalletInfo, this);
}));

RPC.prototype.importPrivKey = co( /*#__PURE__*/_regenerator2.default.mark(function importPrivKey(args, help) {
  var wallet, valid, secret, rescan, key;
  return _regenerator2.default.wrap(function importPrivKey$(_context24) {
    while (1) {
      switch (_context24.prev = _context24.next) {
        case 0:
          wallet = this.wallet;
          valid = new Validator([args]);
          secret = valid.str(0);
          rescan = valid.bool(2, false);

          if (!(help || args.length < 1 || args.length > 3)) {
            _context24.next = 6;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'importprivkey "bitcoinprivkey" ( "label" rescan )');

        case 6:

          key = parseSecret(secret, this.network);

          _context24.next = 9;
          return wallet.importKey(0, key);

        case 9:
          if (!rescan) {
            _context24.next = 12;
            break;
          }

          _context24.next = 12;
          return this.wdb.rescan(0);

        case 12:
          return _context24.abrupt('return', null);

        case 13:
        case 'end':
          return _context24.stop();
      }
    }
  }, importPrivKey, this);
}));

RPC.prototype.importWallet = co( /*#__PURE__*/_regenerator2.default.mark(function importWallet(args, help) {
  var wallet, valid, file, rescan, keys, i, lines, line, parts, secret, time, label, addr, data, key;
  return _regenerator2.default.wrap(function importWallet$(_context25) {
    while (1) {
      switch (_context25.prev = _context25.next) {
        case 0:
          wallet = this.wallet;
          valid = new Validator([args]);
          file = valid.str(0);
          rescan = valid.bool(1, false);
          keys = [];

          if (!(help || args.length !== 1)) {
            _context25.next = 7;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'importwallet "filename" ( rescan )');

        case 7:
          if (!fs.unsupported) {
            _context25.next = 9;
            break;
          }

          throw new RPCError(errs.INTERNAL_ERROR, 'FS not available.');

        case 9:
          _context25.next = 11;
          return fs.readFile(file, 'utf8');

        case 11:
          data = _context25.sent;


          lines = data.split(/\n+/);

          i = 0;

        case 14:
          if (!(i < lines.length)) {
            _context25.next = 31;
            break;
          }

          line = lines[i].trim();

          if (!(line.length === 0)) {
            _context25.next = 18;
            break;
          }

          return _context25.abrupt('continue', 28);

        case 18:
          if (!/^\s*#/.test(line)) {
            _context25.next = 20;
            break;
          }

          return _context25.abrupt('continue', 28);

        case 20:

          parts = line.split(/\s+/);

          if (!(parts.length < 4)) {
            _context25.next = 23;
            break;
          }

          throw new RPCError(errs.DESERIALIZATION_ERROR, 'Malformed wallet.');

        case 23:

          secret = parseSecret(parts[0], this.network);

          time = +parts[1];
          label = parts[2];
          addr = parts[parts.length - 1];

          keys.push(secret);

        case 28:
          i++;
          _context25.next = 14;
          break;

        case 31:
          i = 0;

        case 32:
          if (!(i < keys.length)) {
            _context25.next = 39;
            break;
          }

          key = keys[i];
          _context25.next = 36;
          return wallet.importKey(0, key);

        case 36:
          i++;
          _context25.next = 32;
          break;

        case 39:
          if (!rescan) {
            _context25.next = 42;
            break;
          }

          _context25.next = 42;
          return this.wdb.rescan(0);

        case 42:
          return _context25.abrupt('return', null);

        case 43:
        case 'end':
          return _context25.stop();
      }
    }
  }, importWallet, this);
}));

RPC.prototype.importAddress = co( /*#__PURE__*/_regenerator2.default.mark(function importAddress(args, help) {
  var wallet, valid, addr, rescan, p2sh, script;
  return _regenerator2.default.wrap(function importAddress$(_context26) {
    while (1) {
      switch (_context26.prev = _context26.next) {
        case 0:
          wallet = this.wallet;
          valid = new Validator([args]);
          addr = valid.str(0, '');
          rescan = valid.bool(2, false);
          p2sh = valid.bool(3, false);

          if (!(help || args.length < 1 || args.length > 4)) {
            _context26.next = 7;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'importaddress "address" ( "label" rescan p2sh )');

        case 7:
          if (!p2sh) {
            _context26.next = 16;
            break;
          }

          script = valid.buf(0);

          if (script) {
            _context26.next = 11;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid parameters.');

        case 11:

          script = Script.fromRaw(script);
          script = Script.fromScripthash(script.hash160());

          addr = script.getAddress();
          _context26.next = 17;
          break;

        case 16:
          addr = parseAddress(addr, this.network);

        case 17:
          _context26.next = 19;
          return wallet.importAddress(0, addr);

        case 19:
          if (!rescan) {
            _context26.next = 22;
            break;
          }

          _context26.next = 22;
          return this.wdb.rescan(0);

        case 22:
          return _context26.abrupt('return', null);

        case 23:
        case 'end':
          return _context26.stop();
      }
    }
  }, importAddress, this);
}));

RPC.prototype.importPubkey = co( /*#__PURE__*/_regenerator2.default.mark(function importPubkey(args, help) {
  var wallet, valid, data, rescan, key;
  return _regenerator2.default.wrap(function importPubkey$(_context27) {
    while (1) {
      switch (_context27.prev = _context27.next) {
        case 0:
          wallet = this.wallet;
          valid = new Validator([args]);
          data = valid.buf(0);
          rescan = valid.bool(2, false);

          if (!(help || args.length < 1 || args.length > 4)) {
            _context27.next = 6;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'importpubkey "pubkey" ( "label" rescan )');

        case 6:
          if (data) {
            _context27.next = 8;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid parameter.');

        case 8:

          key = KeyRing.fromPublic(data, this.network);

          _context27.next = 11;
          return wallet.importKey(0, key);

        case 11:
          if (!rescan) {
            _context27.next = 14;
            break;
          }

          _context27.next = 14;
          return this.wdb.rescan(0);

        case 14:
          return _context27.abrupt('return', null);

        case 15:
        case 'end':
          return _context27.stop();
      }
    }
  }, importPubkey, this);
}));

RPC.prototype.keyPoolRefill = co( /*#__PURE__*/_regenerator2.default.mark(function keyPoolRefill(args, help) {
  return _regenerator2.default.wrap(function keyPoolRefill$(_context28) {
    while (1) {
      switch (_context28.prev = _context28.next) {
        case 0:
          if (!(help || args.length > 1)) {
            _context28.next = 2;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'keypoolrefill ( newsize )');

        case 2:
          return _context28.abrupt('return', null);

        case 3:
        case 'end':
          return _context28.stop();
      }
    }
  }, keyPoolRefill, this);
}));

RPC.prototype.listAccounts = co( /*#__PURE__*/_regenerator2.default.mark(function listAccounts(args, help) {
  var wallet, valid, minconf, watchOnly, map, i, accounts, account, balance, value;
  return _regenerator2.default.wrap(function listAccounts$(_context29) {
    while (1) {
      switch (_context29.prev = _context29.next) {
        case 0:
          wallet = this.wallet;
          valid = new Validator([args]);
          minconf = valid.u32(0, 0);
          watchOnly = valid.bool(1, false);
          map = {};

          if (!(help || args.length > 2)) {
            _context29.next = 7;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'listaccounts ( minconf includeWatchonly)');

        case 7:
          _context29.next = 9;
          return wallet.getAccounts();

        case 9:
          accounts = _context29.sent;
          i = 0;

        case 11:
          if (!(i < accounts.length)) {
            _context29.next = 23;
            break;
          }

          account = accounts[i];
          _context29.next = 15;
          return wallet.getBalance(account);

        case 15:
          balance = _context29.sent;


          value = balance.unconfirmed;

          if (minconf > 0) value = balance.confirmed;

          if (wallet.watchOnly !== watchOnly) value = 0;

          map[account] = Amount.btc(value, true);

        case 20:
          i++;
          _context29.next = 11;
          break;

        case 23:
          return _context29.abrupt('return', map);

        case 24:
        case 'end':
          return _context29.stop();
      }
    }
  }, listAccounts, this);
}));

RPC.prototype.listAddressGroupings = co( /*#__PURE__*/_regenerator2.default.mark(function listAddressGroupings(args, help) {
  return _regenerator2.default.wrap(function listAddressGroupings$(_context30) {
    while (1) {
      switch (_context30.prev = _context30.next) {
        case 0:
          if (!help) {
            _context30.next = 2;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'listaddressgroupings');

        case 2:
          throw new Error('Not implemented.');

        case 3:
        case 'end':
          return _context30.stop();
      }
    }
  }, listAddressGroupings, this);
}));

RPC.prototype.listLockUnspent = co( /*#__PURE__*/_regenerator2.default.mark(function listLockUnspent(args, help) {
  var wallet, i, outpoints, outpoint, out;
  return _regenerator2.default.wrap(function listLockUnspent$(_context31) {
    while (1) {
      switch (_context31.prev = _context31.next) {
        case 0:
          wallet = this.wallet;

          if (!(help || args.length > 0)) {
            _context31.next = 3;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'listlockunspent');

        case 3:

          outpoints = wallet.getLocked();
          out = [];

          for (i = 0; i < outpoints.length; i++) {
            outpoint = outpoints[i];
            out.push({
              txid: outpoint.txid(),
              vout: outpoint.index
            });
          }

          return _context31.abrupt('return', out);

        case 7:
        case 'end':
          return _context31.stop();
      }
    }
  }, listLockUnspent, this);
}));

RPC.prototype.listReceivedByAccount = co( /*#__PURE__*/_regenerator2.default.mark(function listReceivedByAccount(args, help) {
  var valid, minconf, includeEmpty, watchOnly;
  return _regenerator2.default.wrap(function listReceivedByAccount$(_context32) {
    while (1) {
      switch (_context32.prev = _context32.next) {
        case 0:
          valid = new Validator([args]);
          minconf = valid.u32(0, 0);
          includeEmpty = valid.bool(1, false);
          watchOnly = valid.bool(2, false);

          if (!(help || args.length > 3)) {
            _context32.next = 6;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'listreceivedbyaccount ( minconf includeempty includeWatchonly )');

        case 6:
          _context32.next = 8;
          return this._listReceived(minconf, includeEmpty, watchOnly, true);

        case 8:
          return _context32.abrupt('return', _context32.sent);

        case 9:
        case 'end':
          return _context32.stop();
      }
    }
  }, listReceivedByAccount, this);
}));

RPC.prototype.listReceivedByAddress = co( /*#__PURE__*/_regenerator2.default.mark(function listReceivedByAddress(args, help) {
  var valid, minconf, includeEmpty, watchOnly;
  return _regenerator2.default.wrap(function listReceivedByAddress$(_context33) {
    while (1) {
      switch (_context33.prev = _context33.next) {
        case 0:
          valid = new Validator([args]);
          minconf = valid.u32(0, 0);
          includeEmpty = valid.bool(1, false);
          watchOnly = valid.bool(2, false);

          if (!(help || args.length > 3)) {
            _context33.next = 6;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'listreceivedbyaddress ( minconf includeempty includeWatchonly )');

        case 6:
          _context33.next = 8;
          return this._listReceived(minconf, includeEmpty, watchOnly, false);

        case 8:
          return _context33.abrupt('return', _context33.sent);

        case 9:
        case 'end':
          return _context33.stop();
      }
    }
  }, listReceivedByAddress, this);
}));

RPC.prototype._listReceived = co( /*#__PURE__*/_regenerator2.default.mark(function _listReceived(minconf, empty, watchOnly, account) {
  var wallet, paths, height, out, result, map, i, j, path, wtx, output, conf, hash, entry, address, keys, key, item, txs;
  return _regenerator2.default.wrap(function _listReceived$(_context34) {
    while (1) {
      switch (_context34.prev = _context34.next) {
        case 0:
          wallet = this.wallet;
          _context34.next = 3;
          return wallet.getPaths();

        case 3:
          paths = _context34.sent;
          height = this.wdb.state.height;
          out = [];
          result = [];
          map = {};


          for (i = 0; i < paths.length; i++) {
            path = paths[i];
            address = path.toAddress();
            map[path.hash] = {
              involvesWatchonly: wallet.watchOnly,
              address: address.toString(this.network),
              account: path.name,
              amount: 0,
              confirmations: -1,
              label: ''
            };
          }

          _context34.next = 11;
          return wallet.getHistory();

        case 11:
          txs = _context34.sent;
          i = 0;

        case 13:
          if (!(i < txs.length)) {
            _context34.next = 33;
            break;
          }

          wtx = txs[i];

          conf = wtx.getDepth(height);

          if (!(conf < minconf)) {
            _context34.next = 18;
            break;
          }

          return _context34.abrupt('continue', 30);

        case 18:
          j = 0;

        case 19:
          if (!(j < wtx.tx.outputs.length)) {
            _context34.next = 30;
            break;
          }

          output = wtx.tx.outputs[j];
          address = output.getAddress();

          if (address) {
            _context34.next = 24;
            break;
          }

          return _context34.abrupt('continue', 27);

        case 24:

          hash = address.getHash('hex');
          entry = map[hash];

          if (entry) {
            if (entry.confirmations === -1 || conf < entry.confirmations) entry.confirmations = conf;
            entry.address = address.toString(this.network);
            entry.amount += output.value;
          }

        case 27:
          j++;
          _context34.next = 19;
          break;

        case 30:
          i++;
          _context34.next = 13;
          break;

        case 33:

          keys = (0, _keys2.default)(map);

          for (i = 0; i < keys.length; i++) {
            key = keys[i];
            entry = map[key];
            out.push(entry);
          }

          if (!account) {
            _context34.next = 52;
            break;
          }

          map = {};

          i = 0;

        case 38:
          if (!(i < out.length)) {
            _context34.next = 49;
            break;
          }

          entry = out[i];
          item = map[entry.account];

          if (item) {
            _context34.next = 45;
            break;
          }

          map[entry.account] = entry;
          entry.address = undefined;
          return _context34.abrupt('continue', 46);

        case 45:
          item.amount += entry.amount;

        case 46:
          i++;
          _context34.next = 38;
          break;

        case 49:

          out = [];
          keys = (0, _keys2.default)(map);

          for (i = 0; i < keys.length; i++) {
            key = keys[i];
            entry = map[key];
            out.push(entry);
          }

        case 52:
          i = 0;

        case 53:
          if (!(i < out.length)) {
            _context34.next = 63;
            break;
          }

          entry = out[i];

          if (!(!empty && entry.amount === 0)) {
            _context34.next = 57;
            break;
          }

          return _context34.abrupt('continue', 60);

        case 57:

          if (entry.confirmations === -1) entry.confirmations = 0;

          entry.amount = Amount.btc(entry.amount, true);
          result.push(entry);

        case 60:
          i++;
          _context34.next = 53;
          break;

        case 63:
          return _context34.abrupt('return', result);

        case 64:
        case 'end':
          return _context34.stop();
      }
    }
  }, _listReceived, this);
}));

RPC.prototype.listSinceBlock = co( /*#__PURE__*/_regenerator2.default.mark(function listSinceBlock(args, help) {
  var wallet, chainHeight, valid, block, minconf, watchOnly, height, out, i, entry, highest, txs, wtx, json;
  return _regenerator2.default.wrap(function listSinceBlock$(_context35) {
    while (1) {
      switch (_context35.prev = _context35.next) {
        case 0:
          wallet = this.wallet;
          chainHeight = this.wdb.state.height;
          valid = new Validator([args]);
          block = valid.hash(0);
          minconf = valid.u32(1, 0);
          watchOnly = valid.bool(2, false);
          height = -1;
          out = [];

          if (!help) {
            _context35.next = 10;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'listsinceblock ( "blockhash" target-confirmations includeWatchonly)');

        case 10:
          if (!(wallet.watchOnly !== watchOnly)) {
            _context35.next = 12;
            break;
          }

          return _context35.abrupt('return', out);

        case 12:
          if (!block) {
            _context35.next = 17;
            break;
          }

          _context35.next = 15;
          return this.client.getEntry(block);

        case 15:
          entry = _context35.sent;

          if (entry) height = entry.height;

        case 17:

          if (height === -1) height = this.chain.height;

          _context35.next = 20;
          return wallet.getHistory();

        case 20:
          txs = _context35.sent;
          i = 0;

        case 22:
          if (!(i < txs.length)) {
            _context35.next = 36;
            break;
          }

          wtx = txs[i];

          if (!(wtx.height < height)) {
            _context35.next = 26;
            break;
          }

          return _context35.abrupt('continue', 33);

        case 26:
          if (!(wtx.getDepth(chainHeight) < minconf)) {
            _context35.next = 28;
            break;
          }

          return _context35.abrupt('continue', 33);

        case 28:

          if (!highest || wtx.height > highest) highest = wtx;

          _context35.next = 31;
          return this._toListTX(wtx);

        case 31:
          json = _context35.sent;


          out.push(json);

        case 33:
          i++;
          _context35.next = 22;
          break;

        case 36:
          return _context35.abrupt('return', {
            transactions: out,
            lastblock: highest && highest.block ? util.revHex(highest.block) : encoding.NULL_HASH
          });

        case 37:
        case 'end':
          return _context35.stop();
      }
    }
  }, listSinceBlock, this);
}));

RPC.prototype._toListTX = co( /*#__PURE__*/_regenerator2.default.mark(function _toListTX(wtx) {
  var wallet, details, sent, received, receive, sendMember, recMember, sendIndex, recIndex, i, member, index;
  return _regenerator2.default.wrap(function _toListTX$(_context36) {
    while (1) {
      switch (_context36.prev = _context36.next) {
        case 0:
          wallet = this.wallet;
          _context36.next = 3;
          return wallet.toDetails(wtx);

        case 3:
          details = _context36.sent;
          sent = 0;
          received = 0;
          receive = true;

          if (details) {
            _context36.next = 9;
            break;
          }

          throw new RPCError(errs.WALLET_ERROR, 'TX not found.');

        case 9:
          i = 0;

        case 10:
          if (!(i < details.inputs.length)) {
            _context36.next = 18;
            break;
          }

          member = details.inputs[i];

          if (!member.path) {
            _context36.next = 15;
            break;
          }

          receive = false;
          return _context36.abrupt('break', 18);

        case 15:
          i++;
          _context36.next = 10;
          break;

        case 18:
          i = 0;

        case 19:
          if (!(i < details.outputs.length)) {
            _context36.next = 34;
            break;
          }

          member = details.outputs[i];

          if (!member.path) {
            _context36.next = 28;
            break;
          }

          if (!(member.path.branch === 1)) {
            _context36.next = 24;
            break;
          }

          return _context36.abrupt('continue', 31);

        case 24:
          received += member.value;
          recMember = member;
          recIndex = i;
          return _context36.abrupt('continue', 31);

        case 28:

          sent += member.value;
          sendMember = member;
          sendIndex = i;

        case 31:
          i++;
          _context36.next = 19;
          break;

        case 34:

          if (receive) {
            member = recMember;
            index = recIndex;
          } else {
            member = sendMember;
            index = sendIndex;
          }

          // In the odd case where we send to ourselves.
          if (!member) {
            assert(!receive);
            member = recMember;
            index = recIndex;
          }

          return _context36.abrupt('return', {
            account: member.path ? member.path.name : '',
            address: member.address ? member.address.toString(this.network) : null,
            category: receive ? 'receive' : 'send',
            amount: Amount.btc(receive ? received : -sent, true),
            label: member.path ? member.path.name : undefined,
            vout: index,
            confirmations: details.getDepth(),
            blockhash: details.block ? util.revHex(details.block) : null,
            blockindex: details.index,
            blocktime: details.ts,
            txid: util.revHex(details.hash),
            walletconflicts: [],
            time: details.ps,
            timereceived: details.ps,
            'bip125-replaceable': 'no'
          });

        case 37:
        case 'end':
          return _context36.stop();
      }
    }
  }, _toListTX, this);
}));

RPC.prototype.listTransactions = co( /*#__PURE__*/_regenerator2.default.mark(function listTransactions(args, help) {
  var wallet, valid, name, count, from, watchOnly, end, out, i, txs, wtx, json;
  return _regenerator2.default.wrap(function listTransactions$(_context37) {
    while (1) {
      switch (_context37.prev = _context37.next) {
        case 0:
          wallet = this.wallet;
          valid = new Validator([args]);
          name = valid.str(0);
          count = valid.u32(1, 10);
          from = valid.u32(2, 0);
          watchOnly = valid.bool(3, false);
          end = from + count;
          out = [];

          if (!(help || args.length > 4)) {
            _context37.next = 10;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'listtransactions ( "account" count from includeWatchonly)');

        case 10:
          if (!(wallet.watchOnly !== watchOnly)) {
            _context37.next = 12;
            break;
          }

          return _context37.abrupt('return', out);

        case 12:

          if (name === '') name = 'default';

          _context37.next = 15;
          return wallet.getHistory();

        case 15:
          txs = _context37.sent;


          common.sortTX(txs);

          end = Math.min(end, txs.length);

          i = from;

        case 19:
          if (!(i < end)) {
            _context37.next = 28;
            break;
          }

          wtx = txs[i];
          _context37.next = 23;
          return this._toListTX(wtx);

        case 23:
          json = _context37.sent;

          out.push(json);

        case 25:
          i++;
          _context37.next = 19;
          break;

        case 28:
          return _context37.abrupt('return', out);

        case 29:
        case 'end':
          return _context37.stop();
      }
    }
  }, listTransactions, this);
}));

RPC.prototype.listUnspent = co( /*#__PURE__*/_regenerator2.default.mark(function listUnspent(args, help) {
  var wallet, valid, minDepth, maxDepth, addrs, height, out, map, i, depth, address, hash, coins, coin, ring;
  return _regenerator2.default.wrap(function listUnspent$(_context38) {
    while (1) {
      switch (_context38.prev = _context38.next) {
        case 0:
          wallet = this.wallet;
          valid = new Validator([args]);
          minDepth = valid.u32(0, 1);
          maxDepth = valid.u32(1, 9999999);
          addrs = valid.array(2);
          height = this.wdb.state.height;
          out = [];
          map = {};

          if (!(help || args.length > 3)) {
            _context38.next = 10;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'listunspent ( minconf maxconf  ["address",...] )');

        case 10:
          if (!addrs) {
            _context38.next = 22;
            break;
          }

          valid = new Validator([addrs]);
          i = 0;

        case 13:
          if (!(i < addrs.length)) {
            _context38.next = 22;
            break;
          }

          address = valid.str(i, '');
          hash = parseHash(address, this.network);

          if (!map[hash]) {
            _context38.next = 18;
            break;
          }

          throw new RPCError(errs.INVALID_PARAMETER, 'Duplicate address.');

        case 18:

          map[hash] = true;

        case 19:
          i++;
          _context38.next = 13;
          break;

        case 22:
          _context38.next = 24;
          return wallet.getCoins();

        case 24:
          coins = _context38.sent;


          common.sortCoins(coins);

          i = 0;

        case 27:
          if (!(i < coins.length)) {
            _context38.next = 46;
            break;
          }

          coin = coins[i];
          depth = coin.getDepth(height);

          if (depth >= minDepth && depth <= maxDepth) {
            _context38.next = 32;
            break;
          }

          return _context38.abrupt('continue', 43);

        case 32:

          address = coin.getAddress();

          if (address) {
            _context38.next = 35;
            break;
          }

          return _context38.abrupt('continue', 43);

        case 35:

          hash = coin.getHash('hex');

          if (!addrs) {
            _context38.next = 39;
            break;
          }

          if (!(!hash || !map[hash])) {
            _context38.next = 39;
            break;
          }

          return _context38.abrupt('continue', 43);

        case 39:
          _context38.next = 41;
          return wallet.getKey(hash);

        case 41:
          ring = _context38.sent;


          out.push({
            txid: coin.txid(),
            vout: coin.index,
            address: address ? address.toString(this.network) : null,
            account: ring ? ring.name : undefined,
            redeemScript: ring && ring.script ? ring.script.toJSON() : undefined,
            scriptPubKey: coin.script.toJSON(),
            amount: Amount.btc(coin.value, true),
            confirmations: depth,
            spendable: !wallet.isLocked(coin),
            solvable: true
          });

        case 43:
          i++;
          _context38.next = 27;
          break;

        case 46:
          return _context38.abrupt('return', out);

        case 47:
        case 'end':
          return _context38.stop();
      }
    }
  }, listUnspent, this);
}));

RPC.prototype.lockUnspent = co( /*#__PURE__*/_regenerator2.default.mark(function lockUnspent(args, help) {
  var wallet, valid, unlock, outputs, i, output, outpoint, hash, index;
  return _regenerator2.default.wrap(function lockUnspent$(_context39) {
    while (1) {
      switch (_context39.prev = _context39.next) {
        case 0:
          wallet = this.wallet;
          valid = new Validator([args]);
          unlock = valid.bool(0, false);
          outputs = valid.array(1);

          if (!(help || args.length < 1 || args.length > 2)) {
            _context39.next = 6;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'lockunspent unlock ([{"txid":"txid","vout":n},...])');

        case 6:
          if (!(args.length === 1)) {
            _context39.next = 9;
            break;
          }

          if (unlock) wallet.unlockCoins();
          return _context39.abrupt('return', true);

        case 9:
          if (outputs) {
            _context39.next = 11;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid parameter.');

        case 11:
          i = 0;

        case 12:
          if (!(i < outputs.length)) {
            _context39.next = 29;
            break;
          }

          output = outputs[i];
          valid = new Validator([output]);
          hash = valid.hash('txid');
          index = valid.u32('vout');

          if (!(hash == null || index == null)) {
            _context39.next = 19;
            break;
          }

          throw new RPCError(errs.INVALID_PARAMETER, 'Invalid parameter.');

        case 19:

          outpoint = new Outpoint();
          outpoint.hash = hash;
          outpoint.index = index;

          if (!unlock) {
            _context39.next = 25;
            break;
          }

          wallet.unlockCoin(outpoint);
          return _context39.abrupt('continue', 26);

        case 25:

          wallet.lockCoin(outpoint);

        case 26:
          i++;
          _context39.next = 12;
          break;

        case 29:
          return _context39.abrupt('return', true);

        case 30:
        case 'end':
          return _context39.stop();
      }
    }
  }, lockUnspent, this);
}));

RPC.prototype.move = co( /*#__PURE__*/_regenerator2.default.mark(function move(args, help) {
  return _regenerator2.default.wrap(function move$(_context40) {
    while (1) {
      switch (_context40.prev = _context40.next) {
        case 0:
          throw new Error('Not implemented.');

        case 1:
        case 'end':
          return _context40.stop();
      }
    }
  }, move, this);
}));

RPC.prototype.sendFrom = co( /*#__PURE__*/_regenerator2.default.mark(function sendFrom(args, help) {
  var wallet, valid, name, addr, value, minconf, options, tx;
  return _regenerator2.default.wrap(function sendFrom$(_context41) {
    while (1) {
      switch (_context41.prev = _context41.next) {
        case 0:
          wallet = this.wallet;
          valid = new Validator([args]);
          name = valid.str(0);
          addr = valid.str(1);
          value = valid.btc(2);
          minconf = valid.u32(3, 0);

          if (!(help || args.length < 3 || args.length > 6)) {
            _context41.next = 8;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'sendfrom "fromaccount" "tobitcoinaddress"' + ' amount ( minconf "comment" "comment-to" )');

        case 8:
          if (!(!addr || value == null)) {
            _context41.next = 10;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid parameter.');

        case 10:

          addr = parseAddress(addr, this.network);

          if (name === '') name = 'default';

          options = {
            account: name,
            subtractFee: false,
            rate: this.feeRate,
            depth: minconf,
            outputs: [{
              address: addr,
              value: value
            }]
          };

          _context41.next = 15;
          return wallet.send(options);

        case 15:
          tx = _context41.sent;
          return _context41.abrupt('return', tx.txid());

        case 17:
        case 'end':
          return _context41.stop();
      }
    }
  }, sendFrom, this);
}));

RPC.prototype.sendMany = co( /*#__PURE__*/_regenerator2.default.mark(function sendMany(args, help) {
  var wallet, valid, name, sendTo, minconf, subtractFee, outputs, uniq, i, keys, tx, key, value, address, hash, output, options;
  return _regenerator2.default.wrap(function sendMany$(_context42) {
    while (1) {
      switch (_context42.prev = _context42.next) {
        case 0:
          wallet = this.wallet;
          valid = new Validator([args]);
          name = valid.str(0);
          sendTo = valid.obj(1);
          minconf = valid.u32(2, 1);
          subtractFee = valid.bool(4, false);
          outputs = [];
          uniq = {};

          if (!(help || args.length < 2 || args.length > 5)) {
            _context42.next = 10;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'sendmany "fromaccount" {"address":amount,...}' + ' ( minconf "comment" ["address",...] )');

        case 10:

          if (name === '') name = 'default';

          if (sendTo) {
            _context42.next = 13;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid parameter.');

        case 13:

          keys = (0, _keys2.default)(sendTo);
          valid = new Validator([sendTo]);

          i = 0;

        case 16:
          if (!(i < keys.length)) {
            _context42.next = 33;
            break;
          }

          key = keys[i];
          value = valid.btc(key);
          address = parseAddress(key, this.network);
          hash = address.getHash('hex');

          if (!(value == null)) {
            _context42.next = 23;
            break;
          }

          throw new RPCError(errs.INVALID_PARAMETER, 'Invalid parameter.');

        case 23:
          if (!uniq[hash]) {
            _context42.next = 25;
            break;
          }

          throw new RPCError(errs.INVALID_PARAMETER, 'Invalid parameter.');

        case 25:

          uniq[hash] = true;

          output = new Output();
          output.value = value;
          output.script.fromAddress(address);
          outputs.push(output);

        case 30:
          i++;
          _context42.next = 16;
          break;

        case 33:

          options = {
            outputs: outputs,
            subtractFee: subtractFee,
            account: name,
            depth: minconf
          };

          _context42.next = 36;
          return wallet.send(options);

        case 36:
          tx = _context42.sent;
          return _context42.abrupt('return', tx.txid());

        case 38:
        case 'end':
          return _context42.stop();
      }
    }
  }, sendMany, this);
}));

RPC.prototype.sendToAddress = co( /*#__PURE__*/_regenerator2.default.mark(function sendToAddress(args, help) {
  var wallet, valid, addr, value, subtractFee, options, tx;
  return _regenerator2.default.wrap(function sendToAddress$(_context43) {
    while (1) {
      switch (_context43.prev = _context43.next) {
        case 0:
          wallet = this.wallet;
          valid = new Validator([args]);
          addr = valid.str(0);
          value = valid.btc(1);
          subtractFee = valid.bool(4, false);

          if (!(help || args.length < 2 || args.length > 5)) {
            _context43.next = 7;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'sendtoaddress "bitcoinaddress" amount' + ' ( "comment" "comment-to" subtractfeefromamount )');

        case 7:

          addr = parseAddress(addr, this.network);

          if (!(!addr || value == null)) {
            _context43.next = 10;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid parameter.');

        case 10:

          options = {
            subtractFee: subtractFee,
            rate: this.feeRate,
            outputs: [{
              address: addr,
              value: value
            }]
          };

          _context43.next = 13;
          return wallet.send(options);

        case 13:
          tx = _context43.sent;
          return _context43.abrupt('return', tx.txid());

        case 15:
        case 'end':
          return _context43.stop();
      }
    }
  }, sendToAddress, this);
}));

RPC.prototype.setAccount = co( /*#__PURE__*/_regenerator2.default.mark(function setAccount(args, help) {
  return _regenerator2.default.wrap(function setAccount$(_context44) {
    while (1) {
      switch (_context44.prev = _context44.next) {
        case 0:
          if (!(help || args.length < 1 || args.length > 2)) {
            _context44.next = 2;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'setaccount "bitcoinaddress" "account"');

        case 2:
          throw new Error('Not implemented.');

        case 3:
        case 'end':
          return _context44.stop();
      }
    }
  }, setAccount, this);
}));

RPC.prototype.setTXFee = co( /*#__PURE__*/_regenerator2.default.mark(function setTXFee(args, help) {
  var valid, rate;
  return _regenerator2.default.wrap(function setTXFee$(_context45) {
    while (1) {
      switch (_context45.prev = _context45.next) {
        case 0:
          valid = new Validator([args]);
          rate = valid.btc(0);

          if (!(help || args.length < 1 || args.length > 1)) {
            _context45.next = 4;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'settxfee amount');

        case 4:
          if (!(rate == null)) {
            _context45.next = 6;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid parameter.');

        case 6:

          this.feeRate = rate;

          return _context45.abrupt('return', true);

        case 8:
        case 'end':
          return _context45.stop();
      }
    }
  }, setTXFee, this);
}));

RPC.prototype.signMessage = co( /*#__PURE__*/_regenerator2.default.mark(function signMessage(args, help) {
  var wallet, valid, addr, msg, sig, ring;
  return _regenerator2.default.wrap(function signMessage$(_context46) {
    while (1) {
      switch (_context46.prev = _context46.next) {
        case 0:
          wallet = this.wallet;
          valid = new Validator([args]);
          addr = valid.str(0, '');
          msg = valid.str(1, '');

          if (!(help || args.length !== 2)) {
            _context46.next = 6;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'signmessage "bitcoinaddress" "message"');

        case 6:

          addr = parseHash(addr, this.network);

          _context46.next = 9;
          return wallet.getKey(addr);

        case 9:
          ring = _context46.sent;

          if (ring) {
            _context46.next = 12;
            break;
          }

          throw new RPCError(errs.WALLET_ERROR, 'Address not found.');

        case 12:
          if (wallet.master.key) {
            _context46.next = 14;
            break;
          }

          throw new RPCError(errs.WALLET_UNLOCK_NEEDED, 'Wallet is locked.');

        case 14:

          msg = Buffer.from(MAGIC_STRING + msg, 'utf8');
          msg = crypto.hash256(msg);

          sig = ring.sign(msg);

          return _context46.abrupt('return', sig.toString('base64'));

        case 18:
        case 'end':
          return _context46.stop();
      }
    }
  }, signMessage, this);
}));

RPC.prototype.walletLock = co( /*#__PURE__*/_regenerator2.default.mark(function walletLock(args, help) {
  var wallet;
  return _regenerator2.default.wrap(function walletLock$(_context47) {
    while (1) {
      switch (_context47.prev = _context47.next) {
        case 0:
          wallet = this.wallet;

          if (!(help || wallet.master.encrypted && args.length !== 0)) {
            _context47.next = 3;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'walletlock');

        case 3:
          if (wallet.master.encrypted) {
            _context47.next = 5;
            break;
          }

          throw new RPCError(errs.WALLET_WRONG_ENC_STATE, 'Wallet is not encrypted.');

        case 5:
          _context47.next = 7;
          return wallet.lock();

        case 7:
          return _context47.abrupt('return', null);

        case 8:
        case 'end':
          return _context47.stop();
      }
    }
  }, walletLock, this);
}));

RPC.prototype.walletPassphraseChange = co( /*#__PURE__*/_regenerator2.default.mark(function walletPassphraseChange(args, help) {
  var wallet, valid, old, new_;
  return _regenerator2.default.wrap(function walletPassphraseChange$(_context48) {
    while (1) {
      switch (_context48.prev = _context48.next) {
        case 0:
          wallet = this.wallet;
          valid = new Validator([args]);
          old = valid.str(0, '');
          new_ = valid.str(1, '');

          if (!(help || wallet.master.encrypted && args.length !== 2)) {
            _context48.next = 6;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'walletpassphrasechange' + ' "oldpassphrase" "newpassphrase"');

        case 6:
          if (wallet.master.encrypted) {
            _context48.next = 8;
            break;
          }

          throw new RPCError(errs.WALLET_WRONG_ENC_STATE, 'Wallet is not encrypted.');

        case 8:
          if (!(old.length < 1 || new_.length < 1)) {
            _context48.next = 10;
            break;
          }

          throw new RPCError(errs.INVALID_PARAMETER, 'Invalid parameter');

        case 10:
          _context48.next = 12;
          return wallet.setPassphrase(old, new_);

        case 12:
          return _context48.abrupt('return', null);

        case 13:
        case 'end':
          return _context48.stop();
      }
    }
  }, walletPassphraseChange, this);
}));

RPC.prototype.walletPassphrase = co( /*#__PURE__*/_regenerator2.default.mark(function walletPassphrase(args, help) {
  var wallet, valid, passphrase, timeout;
  return _regenerator2.default.wrap(function walletPassphrase$(_context49) {
    while (1) {
      switch (_context49.prev = _context49.next) {
        case 0:
          wallet = this.wallet;
          valid = new Validator([args]);
          passphrase = valid.str(0, '');
          timeout = valid.u32(1);

          if (!(help || wallet.master.encrypted && args.length !== 2)) {
            _context49.next = 6;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'walletpassphrase "passphrase" timeout');

        case 6:
          if (wallet.master.encrypted) {
            _context49.next = 8;
            break;
          }

          throw new RPCError(errs.WALLET_WRONG_ENC_STATE, 'Wallet is not encrypted.');

        case 8:
          if (!(passphrase.length < 1)) {
            _context49.next = 10;
            break;
          }

          throw new RPCError(errs.INVALID_PARAMETER, 'Invalid parameter');

        case 10:
          if (!(timeout == null)) {
            _context49.next = 12;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid parameter');

        case 12:
          _context49.next = 14;
          return wallet.unlock(passphrase, timeout);

        case 14:
          return _context49.abrupt('return', null);

        case 15:
        case 'end':
          return _context49.stop();
      }
    }
  }, walletPassphrase, this);
}));

RPC.prototype.importPrunedFunds = co( /*#__PURE__*/_regenerator2.default.mark(function importPrunedFunds(args, help) {
  var valid, tx, block, hash, height;
  return _regenerator2.default.wrap(function importPrunedFunds$(_context50) {
    while (1) {
      switch (_context50.prev = _context50.next) {
        case 0:
          valid = new Validator([args]);
          tx = valid.buf(0);
          block = valid.buf(1);

          if (!(help || args.length < 2 || args.length > 3)) {
            _context50.next = 5;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'importprunedfunds "rawtransaction" "txoutproof" ( "label" )');

        case 5:
          if (!(!tx || !block)) {
            _context50.next = 7;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid parameter.');

        case 7:

          tx = TX.fromRaw(tx);
          block = MerkleBlock.fromRaw(block);
          hash = block.hash('hex');

          if (block.verify()) {
            _context50.next = 12;
            break;
          }

          throw new RPCError(errs.VERIFY_ERROR, 'Invalid proof.');

        case 12:
          if (block.hasTX(tx.hash('hex'))) {
            _context50.next = 14;
            break;
          }

          throw new RPCError(errs.VERIFY_ERROR, 'Invalid proof.');

        case 14:
          _context50.next = 16;
          return this.client.getEntry(hash);

        case 16:
          height = _context50.sent;

          if (!(height === -1)) {
            _context50.next = 19;
            break;
          }

          throw new RPCError(errs.VERIFY_ERROR, 'Invalid proof.');

        case 19:

          block = {
            hash: hash,
            ts: block.ts,
            height: height
          };

          _context50.next = 22;
          return this.wdb.addTX(tx, block);

        case 22:
          if (_context50.sent) {
            _context50.next = 24;
            break;
          }

          throw new RPCError(errs.WALLET_ERROR, 'No tracked address for TX.');

        case 24:
          return _context50.abrupt('return', null);

        case 25:
        case 'end':
          return _context50.stop();
      }
    }
  }, importPrunedFunds, this);
}));

RPC.prototype.removePrunedFunds = co( /*#__PURE__*/_regenerator2.default.mark(function removePrunedFunds(args, help) {
  var wallet, valid, hash;
  return _regenerator2.default.wrap(function removePrunedFunds$(_context51) {
    while (1) {
      switch (_context51.prev = _context51.next) {
        case 0:
          wallet = this.wallet;
          valid = new Validator([args]);
          hash = valid.hash(0);

          if (!(help || args.length !== 1)) {
            _context51.next = 5;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'removeprunedfunds "txid"');

        case 5:
          if (hash) {
            _context51.next = 7;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid parameter.');

        case 7:
          _context51.next = 9;
          return wallet.remove(hash);

        case 9:
          if (_context51.sent) {
            _context51.next = 11;
            break;
          }

          throw new RPCError(errs.WALLET_ERROR, 'Transaction not in wallet.');

        case 11:
          return _context51.abrupt('return', null);

        case 12:
        case 'end':
          return _context51.stop();
      }
    }
  }, removePrunedFunds, this);
}));

RPC.prototype.selectWallet = co( /*#__PURE__*/_regenerator2.default.mark(function selectWallet(args, help) {
  var valid, id, wallet;
  return _regenerator2.default.wrap(function selectWallet$(_context52) {
    while (1) {
      switch (_context52.prev = _context52.next) {
        case 0:
          valid = new Validator([args]);
          id = valid.str(0);

          if (!(help || args.length !== 1)) {
            _context52.next = 4;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'selectwallet "id"');

        case 4:
          _context52.next = 6;
          return this.wdb.get(id);

        case 6:
          wallet = _context52.sent;

          if (wallet) {
            _context52.next = 9;
            break;
          }

          throw new RPCError(errs.WALLET_ERROR, 'Wallet not found.');

        case 9:

          this.wallet = wallet;

          return _context52.abrupt('return', null);

        case 11:
        case 'end':
          return _context52.stop();
      }
    }
  }, selectWallet, this);
}));

RPC.prototype.getMemoryInfo = co( /*#__PURE__*/_regenerator2.default.mark(function getMemoryInfo(args, help) {
  return _regenerator2.default.wrap(function getMemoryInfo$(_context53) {
    while (1) {
      switch (_context53.prev = _context53.next) {
        case 0:
          if (!(help || args.length !== 0)) {
            _context53.next = 2;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getmemoryinfo');

        case 2:
          return _context53.abrupt('return', util.memoryUsage());

        case 3:
        case 'end':
          return _context53.stop();
      }
    }
  }, getMemoryInfo, this);
}));

RPC.prototype.setLogLevel = co( /*#__PURE__*/_regenerator2.default.mark(function setLogLevel(args, help) {
  var valid, level;
  return _regenerator2.default.wrap(function setLogLevel$(_context54) {
    while (1) {
      switch (_context54.prev = _context54.next) {
        case 0:
          valid = new Validator([args]);
          level = valid.str(0, '');

          if (!(help || args.length !== 1)) {
            _context54.next = 4;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'setloglevel "level"');

        case 4:

          this.logger.setLevel(level);

          return _context54.abrupt('return', null);

        case 6:
        case 'end':
          return _context54.stop();
      }
    }
  }, setLogLevel, this);
}));

/*
 * Helpers
 */

function parseHash(raw, network) {
  var addr = parseAddress(raw, network);
  return addr.getHash('hex');
}

function parseAddress(raw, network) {
  try {
    return Address.fromString(raw, network);
  } catch (e) {
    throw new RPCError(errs.INVALID_ADDRESS_OR_KEY, 'Invalid address.');
  }
}

function parseSecret(raw, network) {
  try {
    return KeyRing.fromSecret(raw, network);
  } catch (e) {
    throw new RPCError(errs.INVALID_ADDRESS_OR_KEY, 'Invalid key.');
  }
}

/*
 * Expose
 */

module.exports = RPC;