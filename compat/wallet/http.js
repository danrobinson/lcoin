/*!
 * server.js - http server for bcoin
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
var HTTPBase = require('../http/base');
var util = require('../utils/util');
var co = require('../utils/co');
var base58 = require('../utils/base58');
var MTX = require('../primitives/mtx');
var Outpoint = require('../primitives/outpoint');
var Script = require('../script/script');
var crypto = require('../crypto/crypto');
var Network = require('../protocol/network');
var Validator = require('../utils/validator');
var common = require('./common');

/**
 * HTTPServer
 * @alias module:wallet.HTTPServer
 * @constructor
 * @param {Object} options
 * @see HTTPBase
 * @emits HTTPServer#socket
 */

function HTTPServer(options) {
  if (!(this instanceof HTTPServer)) return new HTTPServer(options);

  options = new HTTPOptions(options);

  HTTPBase.call(this, options);

  this.options = options;
  this.network = this.options.network;
  this.logger = this.options.logger.context('http');
  this.walletdb = this.options.walletdb;

  this.server = new HTTPBase(this.options);
  this.rpc = this.walletdb.rpc;

  this.init();
}

util.inherits(HTTPServer, HTTPBase);

/**
 * Attach to server.
 * @private
 * @param {HTTPServer} server
 */

HTTPServer.prototype.attach = function attach(server) {
  server.mount('/wallet', this);
};

/**
 * Initialize http server.
 * @private
 */

HTTPServer.prototype.init = function init() {
  var self = this;

  this.on('request', function (req, res) {
    if (req.method === 'POST' && req.pathname === '/') return;

    self.logger.debug('Request for method=%s path=%s (%s).', req.method, req.pathname, req.socket.remoteAddress);
  });

  this.on('listening', function (address) {
    self.logger.info('HTTP server listening on %s (port=%d).', address.address, address.port);
  });

  this.initRouter();
  this.initSockets();
};

/**
 * Initialize routes.
 * @private
 */

HTTPServer.prototype.initRouter = function initRouter() {
  this.use(this.cors());

  if (!this.options.noAuth) {
    this.use(this.basicAuth({
      password: this.options.apiKey,
      realm: 'wallet'
    }));
  }

  this.use(this.bodyParser({
    contentType: 'json'
  }));

  this.use(this.jsonRPC(this.rpc));

  this.hook(co( /*#__PURE__*/_regenerator2.default.mark(function _callee(req, res) {
    var valid, id, token, wallet;
    return _regenerator2.default.wrap(function _callee$(_context) {
      while (1) {
        switch (_context.prev = _context.next) {
          case 0:
            valid = req.valid();

            if (!(req.path.length === 0)) {
              _context.next = 3;
              break;
            }

            return _context.abrupt('return');

          case 3:
            if (!(req.path[0] === '_admin')) {
              _context.next = 5;
              break;
            }

            return _context.abrupt('return');

          case 5:
            if (!(req.method === 'PUT' && req.path.length === 1)) {
              _context.next = 7;
              break;
            }

            return _context.abrupt('return');

          case 7:

            id = valid.str('id');
            token = valid.buf('token');

            if (this.options.walletAuth) {
              _context.next = 18;
              break;
            }

            _context.next = 12;
            return this.walletdb.get(id);

          case 12:
            wallet = _context.sent;

            if (wallet) {
              _context.next = 16;
              break;
            }

            res.send(404);
            return _context.abrupt('return');

          case 16:

            req.wallet = wallet;

            return _context.abrupt('return');

          case 18:
            _context.prev = 18;
            _context.next = 21;
            return this.walletdb.auth(id, token);

          case 21:
            wallet = _context.sent;
            _context.next = 29;
            break;

          case 24:
            _context.prev = 24;
            _context.t0 = _context['catch'](18);

            this.logger.info('Auth failure for %s: %s.', id, _context.t0.message);
            res.error(403, _context.t0);
            return _context.abrupt('return');

          case 29:
            if (wallet) {
              _context.next = 32;
              break;
            }

            res.send(404);
            return _context.abrupt('return');

          case 32:

            req.wallet = wallet;

            this.logger.info('Successful auth for %s.', id);

          case 34:
          case 'end':
            return _context.stop();
        }
      }
    }, _callee, this, [[18, 24]]);
  })));

  // Rescan
  this.post('/_admin/rescan', co( /*#__PURE__*/_regenerator2.default.mark(function _callee2(req, res) {
    var valid, height;
    return _regenerator2.default.wrap(function _callee2$(_context2) {
      while (1) {
        switch (_context2.prev = _context2.next) {
          case 0:
            valid = req.valid();
            height = valid.u32('height');


            res.send(200, { success: true });

            _context2.next = 5;
            return this.walletdb.rescan(height);

          case 5:
          case 'end':
            return _context2.stop();
        }
      }
    }, _callee2, this);
  })));

  // Resend
  this.post('/_admin/resend', co( /*#__PURE__*/_regenerator2.default.mark(function _callee3(req, res) {
    return _regenerator2.default.wrap(function _callee3$(_context3) {
      while (1) {
        switch (_context3.prev = _context3.next) {
          case 0:
            _context3.next = 2;
            return this.walletdb.resend();

          case 2:
            res.send(200, { success: true });

          case 3:
          case 'end':
            return _context3.stop();
        }
      }
    }, _callee3, this);
  })));

  // Backup WalletDB
  this.post('/_admin/backup', co( /*#__PURE__*/_regenerator2.default.mark(function _callee4(req, res) {
    var valid, path;
    return _regenerator2.default.wrap(function _callee4$(_context4) {
      while (1) {
        switch (_context4.prev = _context4.next) {
          case 0:
            valid = req.valid();
            path = valid.str('path');


            enforce(path, 'Path is required.');

            _context4.next = 5;
            return this.walletdb.backup(path);

          case 5:

            res.send(200, { success: true });

          case 6:
          case 'end':
            return _context4.stop();
        }
      }
    }, _callee4, this);
  })));

  // List wallets
  this.get('/_admin/wallets', co( /*#__PURE__*/_regenerator2.default.mark(function _callee5(req, res) {
    var wallets;
    return _regenerator2.default.wrap(function _callee5$(_context5) {
      while (1) {
        switch (_context5.prev = _context5.next) {
          case 0:
            _context5.next = 2;
            return this.walletdb.getWallets();

          case 2:
            wallets = _context5.sent;

            res.send(200, wallets);

          case 4:
          case 'end':
            return _context5.stop();
        }
      }
    }, _callee5, this);
  })));

  // Get wallet
  this.get('/:id', function (req, res) {
    res.send(200, req.wallet.toJSON());
  });

  // Get wallet master key
  this.get('/:id/master', function (req, res) {
    res.send(200, req.wallet.master.toJSON(true));
  });

  // Create wallet (compat)
  this.post('/', co( /*#__PURE__*/_regenerator2.default.mark(function _callee6(req, res) {
    var valid, wallet;
    return _regenerator2.default.wrap(function _callee6$(_context6) {
      while (1) {
        switch (_context6.prev = _context6.next) {
          case 0:
            valid = req.valid();
            _context6.next = 3;
            return this.walletdb.create({
              id: valid.str('id'),
              type: valid.str('type'),
              m: valid.u32('m'),
              n: valid.u32('n'),
              passphrase: valid.str('passphrase'),
              master: valid.str('master'),
              mnemonic: valid.str('mnemonic'),
              witness: valid.bool('witness'),
              accountKey: valid.str('accountKey'),
              watchOnly: valid.bool('watchOnly')
            });

          case 3:
            wallet = _context6.sent;


            res.send(200, wallet.toJSON());

          case 5:
          case 'end':
            return _context6.stop();
        }
      }
    }, _callee6, this);
  })));

  // Create wallet
  this.put('/:id', co( /*#__PURE__*/_regenerator2.default.mark(function _callee7(req, res) {
    var valid, wallet;
    return _regenerator2.default.wrap(function _callee7$(_context7) {
      while (1) {
        switch (_context7.prev = _context7.next) {
          case 0:
            valid = req.valid();
            _context7.next = 3;
            return this.walletdb.create({
              id: valid.str('id'),
              type: valid.str('type'),
              m: valid.u32('m'),
              n: valid.u32('n'),
              passphrase: valid.str('passphrase'),
              master: valid.str('master'),
              mnemonic: valid.str('mnemonic'),
              witness: valid.bool('witness'),
              accountKey: valid.str('accountKey'),
              watchOnly: valid.bool('watchOnly')
            });

          case 3:
            wallet = _context7.sent;


            res.send(200, wallet.toJSON());

          case 5:
          case 'end':
            return _context7.stop();
        }
      }
    }, _callee7, this);
  })));

  // List accounts
  this.get('/:id/account', co( /*#__PURE__*/_regenerator2.default.mark(function _callee8(req, res) {
    var accounts;
    return _regenerator2.default.wrap(function _callee8$(_context8) {
      while (1) {
        switch (_context8.prev = _context8.next) {
          case 0:
            _context8.next = 2;
            return req.wallet.getAccounts();

          case 2:
            accounts = _context8.sent;

            res.send(200, accounts);

          case 4:
          case 'end':
            return _context8.stop();
        }
      }
    }, _callee8, this);
  })));

  // Get account
  this.get('/:id/account/:account', co( /*#__PURE__*/_regenerator2.default.mark(function _callee9(req, res) {
    var valid, acct, account;
    return _regenerator2.default.wrap(function _callee9$(_context9) {
      while (1) {
        switch (_context9.prev = _context9.next) {
          case 0:
            valid = req.valid();
            acct = valid.str('account');
            _context9.next = 4;
            return req.wallet.getAccount(acct);

          case 4:
            account = _context9.sent;

            if (account) {
              _context9.next = 8;
              break;
            }

            res.send(404);
            return _context9.abrupt('return');

          case 8:

            res.send(200, account.toJSON());

          case 9:
          case 'end':
            return _context9.stop();
        }
      }
    }, _callee9, this);
  })));

  // Create account (compat)
  this.post('/:id/account', co( /*#__PURE__*/_regenerator2.default.mark(function _callee10(req, res) {
    var valid, passphrase, options, account;
    return _regenerator2.default.wrap(function _callee10$(_context10) {
      while (1) {
        switch (_context10.prev = _context10.next) {
          case 0:
            valid = req.valid();
            passphrase = valid.str('passphrase');


            options = {
              name: valid.str(['account', 'name']),
              witness: valid.bool('witness'),
              watchOnly: valid.bool('watchOnly'),
              type: valid.str('type'),
              m: valid.u32('m'),
              n: valid.u32('n'),
              accountKey: valid.str('accountKey'),
              lookahead: valid.u32('lookahead')
            };

            _context10.next = 5;
            return req.wallet.createAccount(options, passphrase);

          case 5:
            account = _context10.sent;

            if (account) {
              _context10.next = 9;
              break;
            }

            res.send(404);
            return _context10.abrupt('return');

          case 9:

            res.send(200, account.toJSON());

          case 10:
          case 'end':
            return _context10.stop();
        }
      }
    }, _callee10, this);
  })));

  // Create account
  this.put('/:id/account/:account', co( /*#__PURE__*/_regenerator2.default.mark(function _callee11(req, res) {
    var valid, passphrase, options, account;
    return _regenerator2.default.wrap(function _callee11$(_context11) {
      while (1) {
        switch (_context11.prev = _context11.next) {
          case 0:
            valid = req.valid();
            passphrase = valid.str('passphrase');


            options = {
              name: valid.str('account'),
              witness: valid.bool('witness'),
              watchOnly: valid.bool('watchOnly'),
              type: valid.str('type'),
              m: valid.u32('m'),
              n: valid.u32('n'),
              accountKey: valid.str('accountKey'),
              lookahead: valid.u32('lookahead')
            };

            _context11.next = 5;
            return req.wallet.createAccount(options, passphrase);

          case 5:
            account = _context11.sent;

            if (account) {
              _context11.next = 9;
              break;
            }

            res.send(404);
            return _context11.abrupt('return');

          case 9:

            res.send(200, account.toJSON());

          case 10:
          case 'end':
            return _context11.stop();
        }
      }
    }, _callee11, this);
  })));

  // Change passphrase
  this.post('/:id/passphrase', co( /*#__PURE__*/_regenerator2.default.mark(function _callee12(req, res) {
    var valid, old, new_;
    return _regenerator2.default.wrap(function _callee12$(_context12) {
      while (1) {
        switch (_context12.prev = _context12.next) {
          case 0:
            valid = req.valid();
            old = valid.str('old');
            new_ = valid.str('new');

            enforce(old || new_, 'Passphrase is required.');
            _context12.next = 6;
            return req.wallet.setPassphrase(old, new_);

          case 6:
            res.send(200, { success: true });

          case 7:
          case 'end':
            return _context12.stop();
        }
      }
    }, _callee12, this);
  })));

  // Unlock wallet
  this.post('/:id/unlock', co( /*#__PURE__*/_regenerator2.default.mark(function _callee13(req, res) {
    var valid, passphrase, timeout;
    return _regenerator2.default.wrap(function _callee13$(_context13) {
      while (1) {
        switch (_context13.prev = _context13.next) {
          case 0:
            valid = req.valid();
            passphrase = valid.str('passphrase');
            timeout = valid.u32('timeout');

            enforce(passphrase, 'Passphrase is required.');
            _context13.next = 6;
            return req.wallet.unlock(passphrase, timeout);

          case 6:
            res.send(200, { success: true });

          case 7:
          case 'end':
            return _context13.stop();
        }
      }
    }, _callee13, this);
  })));

  // Lock wallet
  this.post('/:id/lock', co( /*#__PURE__*/_regenerator2.default.mark(function _callee14(req, res) {
    return _regenerator2.default.wrap(function _callee14$(_context14) {
      while (1) {
        switch (_context14.prev = _context14.next) {
          case 0:
            _context14.next = 2;
            return req.wallet.lock();

          case 2:
            res.send(200, { success: true });

          case 3:
          case 'end':
            return _context14.stop();
        }
      }
    }, _callee14, this);
  })));

  // Import key
  this.post('/:id/import', co( /*#__PURE__*/_regenerator2.default.mark(function _callee15(req, res) {
    var valid, acct, pub, priv, address;
    return _regenerator2.default.wrap(function _callee15$(_context15) {
      while (1) {
        switch (_context15.prev = _context15.next) {
          case 0:
            valid = req.valid();
            acct = valid.str('account');
            pub = valid.str('publicKey');
            priv = valid.str('privateKey');
            address = valid.str('address');

            if (!pub) {
              _context15.next = 10;
              break;
            }

            _context15.next = 8;
            return req.wallet.importKey(acct, pub);

          case 8:
            res.send(200, { success: true });
            return _context15.abrupt('return');

          case 10:
            if (!priv) {
              _context15.next = 15;
              break;
            }

            _context15.next = 13;
            return req.wallet.importKey(acct, priv);

          case 13:
            res.send(200, { success: true });
            return _context15.abrupt('return');

          case 15:
            if (!address) {
              _context15.next = 20;
              break;
            }

            _context15.next = 18;
            return req.wallet.importAddress(acct, address);

          case 18:
            res.send(200, { success: true });
            return _context15.abrupt('return');

          case 20:

            enforce(false, 'Key or address is required.');

          case 21:
          case 'end':
            return _context15.stop();
        }
      }
    }, _callee15, this);
  })));

  // Generate new token
  this.post('/:id/retoken', co( /*#__PURE__*/_regenerator2.default.mark(function _callee16(req, res) {
    var valid, passphrase, token;
    return _regenerator2.default.wrap(function _callee16$(_context16) {
      while (1) {
        switch (_context16.prev = _context16.next) {
          case 0:
            valid = req.valid();
            passphrase = valid.str('passphrase');
            _context16.next = 4;
            return req.wallet.retoken(passphrase);

          case 4:
            token = _context16.sent;

            res.send(200, { token: token.toString('hex') });

          case 6:
          case 'end':
            return _context16.stop();
        }
      }
    }, _callee16, this);
  })));

  // Send TX
  this.post('/:id/send', co( /*#__PURE__*/_regenerator2.default.mark(function _callee17(req, res) {
    var valid, passphrase, outputs, i, options, tx, details, output, script;
    return _regenerator2.default.wrap(function _callee17$(_context17) {
      while (1) {
        switch (_context17.prev = _context17.next) {
          case 0:
            valid = req.valid();
            passphrase = valid.str('passphrase');
            outputs = valid.array('outputs');


            options = {
              rate: valid.amt('rate'),
              blocks: valid.u32('blocks'),
              maxFee: valid.amt('maxFee'),
              selection: valid.str('selection'),
              smart: valid.bool('smart'),
              subtractFee: valid.bool('subtractFee'),
              depth: valid.u32(['confirmations', 'depth']),
              outputs: []
            };

            for (i = 0; i < outputs.length; i++) {
              output = outputs[i];
              valid = new Validator(output);
              script = null;

              if (valid.has('script')) {
                script = valid.buf('script');
                script = Script.fromRaw(script);
              }

              options.outputs.push({
                script: script,
                address: valid.str('address'),
                value: valid.amt('value')
              });
            }

            _context17.next = 7;
            return req.wallet.send(options, passphrase);

          case 7:
            tx = _context17.sent;
            _context17.next = 10;
            return req.wallet.getDetails(tx.hash('hex'));

          case 10:
            details = _context17.sent;


            res.send(200, details.toJSON());

          case 12:
          case 'end':
            return _context17.stop();
        }
      }
    }, _callee17, this);
  })));

  // Create TX
  this.post('/:id/create', co( /*#__PURE__*/_regenerator2.default.mark(function _callee18(req, res) {
    var valid, passphrase, outputs, i, options, tx, output, script;
    return _regenerator2.default.wrap(function _callee18$(_context18) {
      while (1) {
        switch (_context18.prev = _context18.next) {
          case 0:
            valid = req.valid();
            passphrase = valid.str('passphrase');
            outputs = valid.array('outputs');


            options = {
              rate: valid.amt('rate'),
              maxFee: valid.amt('maxFee'),
              selection: valid.str('selection'),
              smart: valid.bool('smart'),
              subtractFee: valid.bool('subtractFee'),
              depth: valid.u32(['confirmations', 'depth']),
              outputs: []
            };

            for (i = 0; i < outputs.length; i++) {
              output = outputs[i];
              valid = new Validator(output);
              script = null;

              if (valid.has('script')) {
                script = valid.buf('script');
                script = Script.fromRaw(script);
              }

              options.outputs.push({
                script: script,
                address: valid.str('address'),
                value: valid.amt('value')
              });
            }

            _context18.next = 7;
            return req.wallet.createTX(options);

          case 7:
            tx = _context18.sent;
            _context18.next = 10;
            return req.wallet.sign(tx, passphrase);

          case 10:
            res.send(200, tx.getJSON(this.network));

          case 11:
          case 'end':
            return _context18.stop();
        }
      }
    }, _callee18, this);
  })));

  // Sign TX
  this.post('/:id/sign', co( /*#__PURE__*/_regenerator2.default.mark(function _callee19(req, res) {
    var valid, passphrase, raw, tx;
    return _regenerator2.default.wrap(function _callee19$(_context19) {
      while (1) {
        switch (_context19.prev = _context19.next) {
          case 0:
            valid = req.valid();
            passphrase = valid.str('passphrase');
            raw = valid.buf('tx');


            enforce(raw, 'TX is required.');

            tx = MTX.fromRaw(raw);

            _context19.next = 7;
            return req.wallet.sign(tx, passphrase);

          case 7:

            res.send(200, tx.getJSON(this.network));

          case 8:
          case 'end':
            return _context19.stop();
        }
      }
    }, _callee19, this);
  })));

  // Zap Wallet TXs
  this.post('/:id/zap', co( /*#__PURE__*/_regenerator2.default.mark(function _callee20(req, res) {
    var valid, acct, age;
    return _regenerator2.default.wrap(function _callee20$(_context20) {
      while (1) {
        switch (_context20.prev = _context20.next) {
          case 0:
            valid = req.valid();
            acct = valid.str('account');
            age = valid.u32('age');

            enforce(age, 'Age is required.');
            _context20.next = 6;
            return req.wallet.zap(acct, age);

          case 6:
            res.send(200, { success: true });

          case 7:
          case 'end':
            return _context20.stop();
        }
      }
    }, _callee20, this);
  })));

  // Abandon Wallet TX
  this.del('/:id/tx/:hash', co( /*#__PURE__*/_regenerator2.default.mark(function _callee21(req, res) {
    var valid, hash;
    return _regenerator2.default.wrap(function _callee21$(_context21) {
      while (1) {
        switch (_context21.prev = _context21.next) {
          case 0:
            valid = req.valid();
            hash = valid.hash('hash');

            enforce(hash, 'Hash is required.');
            _context21.next = 5;
            return req.wallet.abandon(hash);

          case 5:
            res.send(200, { success: true });

          case 6:
          case 'end':
            return _context21.stop();
        }
      }
    }, _callee21, this);
  })));

  // List blocks
  this.get('/:id/block', co( /*#__PURE__*/_regenerator2.default.mark(function _callee22(req, res) {
    var heights;
    return _regenerator2.default.wrap(function _callee22$(_context22) {
      while (1) {
        switch (_context22.prev = _context22.next) {
          case 0:
            _context22.next = 2;
            return req.wallet.getBlocks();

          case 2:
            heights = _context22.sent;

            res.send(200, heights);

          case 4:
          case 'end':
            return _context22.stop();
        }
      }
    }, _callee22, this);
  })));

  // Get Block Record
  this.get('/:id/block/:height', co( /*#__PURE__*/_regenerator2.default.mark(function _callee23(req, res) {
    var valid, height, block;
    return _regenerator2.default.wrap(function _callee23$(_context23) {
      while (1) {
        switch (_context23.prev = _context23.next) {
          case 0:
            valid = req.valid();
            height = valid.u32('height');


            enforce(height != null, 'Height is required.');

            _context23.next = 5;
            return req.wallet.getBlock(height);

          case 5:
            block = _context23.sent;

            if (block) {
              _context23.next = 9;
              break;
            }

            res.send(404);
            return _context23.abrupt('return');

          case 9:

            res.send(200, block.toJSON());

          case 10:
          case 'end':
            return _context23.stop();
        }
      }
    }, _callee23, this);
  })));

  // Add key
  this.put('/:id/shared-key', co( /*#__PURE__*/_regenerator2.default.mark(function _callee24(req, res) {
    var valid, acct, key;
    return _regenerator2.default.wrap(function _callee24$(_context24) {
      while (1) {
        switch (_context24.prev = _context24.next) {
          case 0:
            valid = req.valid();
            acct = valid.str('account');
            key = valid.str('accountKey');

            enforce(key, 'Key is required.');
            _context24.next = 6;
            return req.wallet.addSharedKey(acct, key);

          case 6:
            res.send(200, { success: true });

          case 7:
          case 'end':
            return _context24.stop();
        }
      }
    }, _callee24, this);
  })));

  // Remove key
  this.del('/:id/shared-key', co( /*#__PURE__*/_regenerator2.default.mark(function _callee25(req, res) {
    var valid, acct, key;
    return _regenerator2.default.wrap(function _callee25$(_context25) {
      while (1) {
        switch (_context25.prev = _context25.next) {
          case 0:
            valid = req.valid();
            acct = valid.str('account');
            key = valid.str('accountKey');

            enforce(key, 'Key is required.');
            _context25.next = 6;
            return req.wallet.removeSharedKey(acct, key);

          case 6:
            res.send(200, { success: true });

          case 7:
          case 'end':
            return _context25.stop();
        }
      }
    }, _callee25, this);
  })));

  // Get key by address
  this.get('/:id/key/:address', co( /*#__PURE__*/_regenerator2.default.mark(function _callee26(req, res) {
    var valid, address, key;
    return _regenerator2.default.wrap(function _callee26$(_context26) {
      while (1) {
        switch (_context26.prev = _context26.next) {
          case 0:
            valid = req.valid();
            address = valid.str('address');


            enforce(address, 'Address is required.');

            _context26.next = 5;
            return req.wallet.getKey(address);

          case 5:
            key = _context26.sent;

            if (key) {
              _context26.next = 9;
              break;
            }

            res.send(404);
            return _context26.abrupt('return');

          case 9:

            res.send(200, key.toJSON());

          case 10:
          case 'end':
            return _context26.stop();
        }
      }
    }, _callee26, this);
  })));

  // Get private key
  this.get('/:id/wif/:address', co( /*#__PURE__*/_regenerator2.default.mark(function _callee27(req, res) {
    var valid, address, passphrase, key;
    return _regenerator2.default.wrap(function _callee27$(_context27) {
      while (1) {
        switch (_context27.prev = _context27.next) {
          case 0:
            valid = req.valid();
            address = valid.str('address');
            passphrase = valid.str('passphrase');


            enforce(address, 'Address is required.');

            _context27.next = 6;
            return req.wallet.getPrivateKey(address, passphrase);

          case 6:
            key = _context27.sent;

            if (key) {
              _context27.next = 10;
              break;
            }

            res.send(404);
            return _context27.abrupt('return');

          case 10:

            res.send(200, { privateKey: key.toSecret() });

          case 11:
          case 'end':
            return _context27.stop();
        }
      }
    }, _callee27, this);
  })));

  // Create address
  this.post('/:id/address', co( /*#__PURE__*/_regenerator2.default.mark(function _callee28(req, res) {
    var valid, acct, address;
    return _regenerator2.default.wrap(function _callee28$(_context28) {
      while (1) {
        switch (_context28.prev = _context28.next) {
          case 0:
            valid = req.valid();
            acct = valid.str('account');
            _context28.next = 4;
            return req.wallet.createReceive(acct);

          case 4:
            address = _context28.sent;

            res.send(200, address.toJSON());

          case 6:
          case 'end':
            return _context28.stop();
        }
      }
    }, _callee28, this);
  })));

  // Create change address
  this.post('/:id/change', co( /*#__PURE__*/_regenerator2.default.mark(function _callee29(req, res) {
    var valid, acct, address;
    return _regenerator2.default.wrap(function _callee29$(_context29) {
      while (1) {
        switch (_context29.prev = _context29.next) {
          case 0:
            valid = req.valid();
            acct = valid.str('account');
            _context29.next = 4;
            return req.wallet.createChange(acct);

          case 4:
            address = _context29.sent;

            res.send(200, address.toJSON());

          case 6:
          case 'end':
            return _context29.stop();
        }
      }
    }, _callee29, this);
  })));

  // Create nested address
  this.post('/:id/nested', co( /*#__PURE__*/_regenerator2.default.mark(function _callee30(req, res) {
    var valid, acct, address;
    return _regenerator2.default.wrap(function _callee30$(_context30) {
      while (1) {
        switch (_context30.prev = _context30.next) {
          case 0:
            valid = req.valid();
            acct = valid.str('account');
            _context30.next = 4;
            return req.wallet.createNested(acct);

          case 4:
            address = _context30.sent;

            res.send(200, address.toJSON());

          case 6:
          case 'end':
            return _context30.stop();
        }
      }
    }, _callee30, this);
  })));

  // Wallet Balance
  this.get('/:id/balance', co( /*#__PURE__*/_regenerator2.default.mark(function _callee31(req, res) {
    var valid, acct, balance;
    return _regenerator2.default.wrap(function _callee31$(_context31) {
      while (1) {
        switch (_context31.prev = _context31.next) {
          case 0:
            valid = req.valid();
            acct = valid.str('account');
            _context31.next = 4;
            return req.wallet.getBalance(acct);

          case 4:
            balance = _context31.sent;

            if (balance) {
              _context31.next = 8;
              break;
            }

            res.send(404);
            return _context31.abrupt('return');

          case 8:

            res.send(200, balance.toJSON());

          case 9:
          case 'end':
            return _context31.stop();
        }
      }
    }, _callee31, this);
  })));

  // Wallet UTXOs
  this.get('/:id/coin', co( /*#__PURE__*/_regenerator2.default.mark(function _callee32(req, res) {
    var valid, acct, coins, result, i, coin;
    return _regenerator2.default.wrap(function _callee32$(_context32) {
      while (1) {
        switch (_context32.prev = _context32.next) {
          case 0:
            valid = req.valid();
            acct = valid.str('account');
            _context32.next = 4;
            return req.wallet.getCoins(acct);

          case 4:
            coins = _context32.sent;
            result = [];


            common.sortCoins(coins);

            for (i = 0; i < coins.length; i++) {
              coin = coins[i];
              result.push(coin.getJSON(this.network));
            }

            res.send(200, result);

          case 9:
          case 'end':
            return _context32.stop();
        }
      }
    }, _callee32, this);
  })));

  // Locked coins
  this.get('/:id/locked', co( /*#__PURE__*/_regenerator2.default.mark(function _callee33(req, res) {
    var locked, result, i, outpoint;
    return _regenerator2.default.wrap(function _callee33$(_context33) {
      while (1) {
        switch (_context33.prev = _context33.next) {
          case 0:
            locked = this.wallet.getLocked();
            result = [];


            for (i = 0; i < locked.length; i++) {
              outpoint = locked[i];
              result.push(outpoint.toJSON());
            }

            res.send(200, result);

          case 4:
          case 'end':
            return _context33.stop();
        }
      }
    }, _callee33, this);
  })));

  // Lock coin
  this.put('/:id/locked/:hash/:index', co( /*#__PURE__*/_regenerator2.default.mark(function _callee34(req, res) {
    var valid, hash, index, outpoint;
    return _regenerator2.default.wrap(function _callee34$(_context34) {
      while (1) {
        switch (_context34.prev = _context34.next) {
          case 0:
            valid = req.valid();
            hash = valid.hash('hash');
            index = valid.u32('index');


            enforce(hash, 'Hash is required.');
            enforce(index != null, 'Index is required.');

            outpoint = new Outpoint(hash, index);

            this.wallet.lockCoin(outpoint);

          case 7:
          case 'end':
            return _context34.stop();
        }
      }
    }, _callee34, this);
  })));

  // Unlock coin
  this.del('/:id/locked/:hash/:index', co( /*#__PURE__*/_regenerator2.default.mark(function _callee35(req, res) {
    var valid, hash, index, outpoint;
    return _regenerator2.default.wrap(function _callee35$(_context35) {
      while (1) {
        switch (_context35.prev = _context35.next) {
          case 0:
            valid = req.valid();
            hash = valid.hash('hash');
            index = valid.u32('index');


            enforce(hash, 'Hash is required.');
            enforce(index != null, 'Index is required.');

            outpoint = new Outpoint(hash, index);

            this.wallet.unlockCoin(outpoint);

          case 7:
          case 'end':
            return _context35.stop();
        }
      }
    }, _callee35, this);
  })));

  // Wallet Coin
  this.get('/:id/coin/:hash/:index', co( /*#__PURE__*/_regenerator2.default.mark(function _callee36(req, res) {
    var valid, hash, index, coin;
    return _regenerator2.default.wrap(function _callee36$(_context36) {
      while (1) {
        switch (_context36.prev = _context36.next) {
          case 0:
            valid = req.valid();
            hash = valid.hash('hash');
            index = valid.u32('index');


            enforce(hash, 'Hash is required.');
            enforce(index != null, 'Index is required.');

            _context36.next = 7;
            return req.wallet.getCoin(hash, index);

          case 7:
            coin = _context36.sent;

            if (coin) {
              _context36.next = 11;
              break;
            }

            res.send(404);
            return _context36.abrupt('return');

          case 11:

            res.send(200, coin.getJSON(this.network));

          case 12:
          case 'end':
            return _context36.stop();
        }
      }
    }, _callee36, this);
  })));

  // Wallet TXs
  this.get('/:id/tx/history', co( /*#__PURE__*/_regenerator2.default.mark(function _callee37(req, res) {
    var valid, acct, txs, result, i, details, item;
    return _regenerator2.default.wrap(function _callee37$(_context37) {
      while (1) {
        switch (_context37.prev = _context37.next) {
          case 0:
            valid = req.valid();
            acct = valid.str('account');
            _context37.next = 4;
            return req.wallet.getHistory(acct);

          case 4:
            txs = _context37.sent;
            result = [];


            common.sortTX(txs);

            _context37.next = 9;
            return req.wallet.toDetails(txs);

          case 9:
            details = _context37.sent;


            for (i = 0; i < details.length; i++) {
              item = details[i];
              result.push(item.toJSON());
            }

            res.send(200, result);

          case 12:
          case 'end':
            return _context37.stop();
        }
      }
    }, _callee37, this);
  })));

  // Wallet Pending TXs
  this.get('/:id/tx/unconfirmed', co( /*#__PURE__*/_regenerator2.default.mark(function _callee38(req, res) {
    var valid, acct, txs, result, i, details, item;
    return _regenerator2.default.wrap(function _callee38$(_context38) {
      while (1) {
        switch (_context38.prev = _context38.next) {
          case 0:
            valid = req.valid();
            acct = valid.str('account');
            _context38.next = 4;
            return req.wallet.getPending(acct);

          case 4:
            txs = _context38.sent;
            result = [];


            common.sortTX(txs);

            _context38.next = 9;
            return req.wallet.toDetails(txs);

          case 9:
            details = _context38.sent;


            for (i = 0; i < details.length; i++) {
              item = details[i];
              result.push(item.toJSON());
            }

            res.send(200, result);

          case 12:
          case 'end':
            return _context38.stop();
        }
      }
    }, _callee38, this);
  })));

  // Wallet TXs within time range
  this.get('/:id/tx/range', co( /*#__PURE__*/_regenerator2.default.mark(function _callee39(req, res) {
    var valid, acct, result, i, options, txs, details, item;
    return _regenerator2.default.wrap(function _callee39$(_context39) {
      while (1) {
        switch (_context39.prev = _context39.next) {
          case 0:
            valid = req.valid();
            acct = valid.str('account');
            result = [];


            options = {
              start: valid.u32('start'),
              end: valid.u32('end'),
              limit: valid.u32('limit'),
              reverse: valid.bool('reverse')
            };

            _context39.next = 6;
            return req.wallet.getRange(acct, options);

          case 6:
            txs = _context39.sent;
            _context39.next = 9;
            return req.wallet.toDetails(txs);

          case 9:
            details = _context39.sent;


            for (i = 0; i < details.length; i++) {
              item = details[i];
              result.push(item.toJSON());
            }

            res.send(200, result);

          case 12:
          case 'end':
            return _context39.stop();
        }
      }
    }, _callee39, this);
  })));

  // Last Wallet TXs
  this.get('/:id/tx/last', co( /*#__PURE__*/_regenerator2.default.mark(function _callee40(req, res) {
    var valid, acct, limit, txs, details, result, i, item;
    return _regenerator2.default.wrap(function _callee40$(_context40) {
      while (1) {
        switch (_context40.prev = _context40.next) {
          case 0:
            valid = req.valid();
            acct = valid.str('account');
            limit = valid.u32('limit');
            _context40.next = 5;
            return req.wallet.getLast(acct, limit);

          case 5:
            txs = _context40.sent;
            _context40.next = 8;
            return req.wallet.toDetails(txs);

          case 8:
            details = _context40.sent;
            result = [];


            for (i = 0; i < details.length; i++) {
              item = details[i];
              result.push(item.toJSON());
            }

            res.send(200, result);

          case 12:
          case 'end':
            return _context40.stop();
        }
      }
    }, _callee40, this);
  })));

  // Wallet TX
  this.get('/:id/tx/:hash', co( /*#__PURE__*/_regenerator2.default.mark(function _callee41(req, res) {
    var valid, hash, tx, details;
    return _regenerator2.default.wrap(function _callee41$(_context41) {
      while (1) {
        switch (_context41.prev = _context41.next) {
          case 0:
            valid = req.valid();
            hash = valid.hash('hash');


            enforce(hash, 'Hash is required.');

            _context41.next = 5;
            return req.wallet.getTX(hash);

          case 5:
            tx = _context41.sent;

            if (tx) {
              _context41.next = 9;
              break;
            }

            res.send(404);
            return _context41.abrupt('return');

          case 9:
            _context41.next = 11;
            return req.wallet.toDetails(tx);

          case 11:
            details = _context41.sent;


            res.send(200, details.toJSON());

          case 13:
          case 'end':
            return _context41.stop();
        }
      }
    }, _callee41, this);
  })));

  // Resend
  this.post('/:id/resend', co( /*#__PURE__*/_regenerator2.default.mark(function _callee42(req, res) {
    return _regenerator2.default.wrap(function _callee42$(_context42) {
      while (1) {
        switch (_context42.prev = _context42.next) {
          case 0:
            _context42.next = 2;
            return req.wallet.resend();

          case 2:
            res.send(200, { success: true });

          case 3:
          case 'end':
            return _context42.stop();
        }
      }
    }, _callee42, this);
  })));
};

/**
 * Initialize websockets.
 * @private
 */

HTTPServer.prototype.initSockets = function initSockets() {
  var self = this;

  if (!this.io) return;

  this.on('socket', function (socket) {
    self.handleSocket(socket);
  });

  this.walletdb.on('tx', function (id, tx, details) {
    var json = details.toJSON();
    var channel = 'w:' + id;
    self.to(channel, 'wallet tx', json);
    self.to('!all', 'wallet tx', id, json);
  });

  this.walletdb.on('confirmed', function (id, tx, details) {
    var json = details.toJSON();
    var channel = 'w:' + id;
    self.to(channel, 'wallet confirmed', json);
    self.to('!all', 'wallet confirmed', id, json);
  });

  this.walletdb.on('unconfirmed', function (id, tx, details) {
    var json = details.toJSON();
    var channel = 'w:' + id;
    self.to(channel, 'wallet unconfirmed', json);
    self.to('!all', 'wallet unconfirmed', id, json);
  });

  this.walletdb.on('conflict', function (id, tx, details) {
    var json = details.toJSON();
    var channel = 'w:' + id;
    self.to(channel, 'wallet conflict', json);
    self.to('!all', 'wallet conflict', id, json);
  });

  this.walletdb.on('balance', function (id, balance) {
    var json = balance.toJSON();
    var channel = 'w:' + id;
    self.to(channel, 'wallet balance', json);
    self.to('!all', 'wallet balance', id, json);
  });

  this.walletdb.on('address', function (id, receive) {
    var channel = 'w:' + id;
    var json = [];
    var i, address;

    for (i = 0; i < receive.length; i++) {
      address = receive[i];
      json.push(address.toJSON());
    }

    self.to(channel, 'wallet address', json);
    self.to('!all', 'wallet address', id, json);
  });
};

/**
 * Handle new websocket.
 * @private
 * @param {WebSocket} socket
 */

HTTPServer.prototype.handleSocket = function handleSocket(socket) {
  var self = this;

  socket.hook('wallet auth', function (args) {
    var valid = new Validator([args]);
    var key = valid.str(0);
    var hash;

    if (socket.auth) throw new Error('Already authed.');

    if (!self.options.noAuth) {
      hash = hash256(key);
      if (!crypto.ccmp(hash, self.options.apiHash)) throw new Error('Bad key.');
    }

    socket.auth = true;

    self.logger.info('Successful auth from %s.', socket.host);

    self.handleAuth(socket);

    return null;
  });
};

/**
 * Handle new auth'd websocket.
 * @private
 * @param {WebSocket} socket
 */

HTTPServer.prototype.handleAuth = function handleAuth(socket) {
  var self = this;

  socket.hook('wallet join', co( /*#__PURE__*/_regenerator2.default.mark(function _callee43(args) {
    var valid, id, token, channel, wallet;
    return _regenerator2.default.wrap(function _callee43$(_context43) {
      while (1) {
        switch (_context43.prev = _context43.next) {
          case 0:
            valid = new Validator([args]);
            id = valid.str(0, '');
            token = valid.buf(1);
            channel = 'w:' + id;

            if (id) {
              _context43.next = 6;
              break;
            }

            throw new Error('Invalid parameter.');

          case 6:
            if (self.options.walletAuth) {
              _context43.next = 9;
              break;
            }

            socket.join(channel);
            return _context43.abrupt('return', null);

          case 9:
            if (token) {
              _context43.next = 11;
              break;
            }

            throw new Error('Invalid parameter.');

          case 11:
            _context43.prev = 11;
            _context43.next = 14;
            return self.walletdb.auth(id, token);

          case 14:
            wallet = _context43.sent;
            _context43.next = 21;
            break;

          case 17:
            _context43.prev = 17;
            _context43.t0 = _context43['catch'](11);

            self.logger.info('Wallet auth failure for %s: %s.', id, _context43.t0.message);
            throw new Error('Bad token.');

          case 21:
            if (wallet) {
              _context43.next = 23;
              break;
            }

            throw new Error('Wallet does not exist.');

          case 23:

            self.logger.info('Successful wallet auth for %s.', id);

            socket.join(channel);

            return _context43.abrupt('return', null);

          case 26:
          case 'end':
            return _context43.stop();
        }
      }
    }, _callee43, this, [[11, 17]]);
  })));

  socket.hook('wallet leave', function (args) {
    var valid = new Validator([args]);
    var id = valid.str(0, '');
    var channel = 'w:' + id;

    if (!id) throw new Error('Invalid parameter.');

    socket.leave(channel);

    return null;
  });
};

/**
 * HTTPOptions
 * @alias module:http.HTTPOptions
 * @constructor
 * @param {Object} options
 */

function HTTPOptions(options) {
  if (!(this instanceof HTTPOptions)) return new HTTPOptions(options);

  this.network = Network.primary;
  this.logger = null;
  this.walletdb = null;
  this.apiKey = base58.encode(crypto.randomBytes(20));
  this.apiHash = hash256(this.apiKey);
  this.serviceHash = this.apiHash;
  this.noAuth = false;
  this.walletAuth = false;

  this.prefix = null;
  this.host = '127.0.0.1';
  this.port = 8080;
  this.ssl = false;
  this.keyFile = null;
  this.certFile = null;

  this.fromOptions(options);
}

/**
 * Inject properties from object.
 * @private
 * @param {Object} options
 * @returns {HTTPOptions}
 */

HTTPOptions.prototype.fromOptions = function fromOptions(options) {
  assert(options);
  assert(options.walletdb && (0, _typeof3.default)(options.walletdb) === 'object', 'HTTP Server requires a WalletDB.');

  this.walletdb = options.walletdb;
  this.network = options.walletdb.network;
  this.logger = options.walletdb.logger;
  this.port = this.network.rpcPort + 2;

  if (options.logger != null) {
    assert((0, _typeof3.default)(options.logger) === 'object');
    this.logger = options.logger;
  }

  if (options.apiKey != null) {
    assert(typeof options.apiKey === 'string', 'API key must be a string.');
    assert(options.apiKey.length <= 200, 'API key must be under 200 bytes.');
    this.apiKey = options.apiKey;
    this.apiHash = hash256(this.apiKey);
  }

  if (options.noAuth != null) {
    assert(typeof options.noAuth === 'boolean');
    this.noAuth = options.noAuth;
  }

  if (options.walletAuth != null) {
    assert(typeof options.walletAuth === 'boolean');
    this.walletAuth = options.walletAuth;
  }

  if (options.prefix != null) {
    assert(typeof options.prefix === 'string');
    this.prefix = options.prefix;
    this.keyFile = this.prefix + '/key.pem';
    this.certFile = this.prefix + '/cert.pem';
  }

  if (options.host != null) {
    assert(typeof options.host === 'string');
    this.host = options.host;
  }

  if (options.port != null) {
    assert(typeof options.port === 'number', 'Port must be a number.');
    assert(options.port > 0 && options.port <= 0xffff);
    this.port = options.port;
  }

  if (options.ssl != null) {
    assert(typeof options.ssl === 'boolean');
    this.ssl = options.ssl;
  }

  if (options.keyFile != null) {
    assert(typeof options.keyFile === 'string');
    this.keyFile = options.keyFile;
  }

  if (options.certFile != null) {
    assert(typeof options.certFile === 'string');
    this.certFile = options.certFile;
  }

  // Allow no-auth implicitly
  // if we're listening locally.
  if (!options.apiKey) {
    if (this.host === '127.0.0.1' || this.host === '::1') this.noAuth = true;
  }

  return this;
};

/**
 * Instantiate http options from object.
 * @param {Object} options
 * @returns {HTTPOptions}
 */

HTTPOptions.fromOptions = function fromOptions(options) {
  return new HTTPOptions().fromOptions(options);
};

/*
 * Helpers
 */

function hash256(data) {
  if (typeof data !== 'string') return Buffer.alloc(0);

  if (data.length > 200) return Buffer.alloc(0);

  return crypto.hash256(Buffer.from(data, 'utf8'));
}

function enforce(value, msg) {
  var err;

  if (!value) {
    err = new Error(msg);
    err.statusCode = 400;
    throw err;
  }
}

/*
 * Expose
 */

module.exports = HTTPServer;