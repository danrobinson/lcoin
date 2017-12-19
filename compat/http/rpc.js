/*!
 * rpc.js - bitcoind-compatible json rpc for bcoin.
 * Copyright (c) 2014-2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

var _promise = require('babel-runtime/core-js/promise');

var _promise2 = _interopRequireDefault(_promise);

var _keys = require('babel-runtime/core-js/object/keys');

var _keys2 = _interopRequireDefault(_keys);

var _regenerator = require('babel-runtime/regenerator');

var _regenerator2 = _interopRequireDefault(_regenerator);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var util = require('../utils/util');
var co = require('../utils/co');
var crypto = require('../crypto/crypto');
var assert = require('assert');
var common = require('../blockchain/common');
var ec = require('../crypto/ec');
var Amount = require('../btc/amount');
var NetAddress = require('../primitives/netaddress');
var Script = require('../script/script');
var Address = require('../primitives/address');
var Block = require('../primitives/block');
var Headers = require('../primitives/headers');
var Input = require('../primitives/input');
var KeyRing = require('../primitives/keyring');
var MerkleBlock = require('../primitives/merkleblock');
var MTX = require('../primitives/mtx');
var Network = require('../protocol/network');
var Output = require('../primitives/output');
var TX = require('../primitives/tx');
var IP = require('../utils/ip');
var encoding = require('../utils/encoding');
var consensus = require('../protocol/consensus');
var Validator = require('../utils/validator');
var RPCBase = require('./rpcbase');
var pkg = require('../pkg');
var RPCError = RPCBase.RPCError;
var errs = RPCBase.errors;
var MAGIC_STRING = RPCBase.MAGIC_STRING;

/**
 * Bitcoin Core RPC
 * @alias module:http.RPC
 * @constructor
 * @param {Node} node
 */

function RPC(node) {
  if (!(this instanceof RPC)) return new RPC(node);

  RPCBase.call(this);

  assert(node, 'RPC requires a Node.');

  this.node = node;
  this.network = node.network;
  this.chain = node.chain;
  this.mempool = node.mempool;
  this.pool = node.pool;
  this.fees = node.fees;
  this.miner = node.miner;
  this.logger = node.logger.context('rpc');

  this.mining = false;
  this.procLimit = 0;
  this.attempt = null;
  this.lastActivity = 0;
  this.boundChain = false;
  this.nonce1 = 0;
  this.nonce2 = 0;
  this.merkleMap = {};
  this.pollers = [];

  this.init();
}

util.inherits(RPC, RPCBase);

RPC.prototype.init = function init() {
  this.add('stop', this.stop);
  this.add('help', this.help);

  this.add('getblockchaininfo', this.getBlockchainInfo);
  this.add('getbestblockhash', this.getBestBlockHash);
  this.add('getblockcount', this.getBlockCount);
  this.add('getblock', this.getBlock);
  this.add('getblockbyheight', this.getBlockByHeight);
  this.add('getblockhash', this.getBlockHash);
  this.add('getblockheader', this.getBlockHeader);
  this.add('getchaintips', this.getChainTips);
  this.add('getdifficulty', this.getDifficulty);
  this.add('getmempoolancestors', this.getMempoolAncestors);
  this.add('getmempooldescendants', this.getMempoolDescendants);
  this.add('getmempoolentry', this.getMempoolEntry);
  this.add('getmempoolinfo', this.getMempoolInfo);
  this.add('getrawmempool', this.getRawMempool);
  this.add('gettxout', this.getTXOut);
  this.add('gettxoutsetinfo', this.getTXOutSetInfo);
  this.add('pruneblockchain', this.pruneBlockchain);
  this.add('verifychain', this.verifyChain);

  this.add('invalidateblock', this.invalidateBlock);
  this.add('reconsiderblock', this.reconsiderBlock);

  this.add('getnetworkhashps', this.getNetworkHashPS);
  this.add('getmininginfo', this.getMiningInfo);
  this.add('prioritisetransaction', this.prioritiseTransaction);
  this.add('getwork', this.getWork);
  this.add('getworklp', this.getWorkLongpoll);
  this.add('getblocktemplate', this.getBlockTemplate);
  this.add('submitblock', this.submitBlock);
  this.add('verifyblock', this.verifyBlock);

  this.add('setgenerate', this.setGenerate);
  this.add('getgenerate', this.getGenerate);
  this.add('generate', this.generate);
  this.add('generatetoaddress', this.generateToAddress);

  this.add('estimatefee', this.estimateFee);
  this.add('estimatepriority', this.estimatePriority);
  this.add('estimatesmartfee', this.estimateSmartFee);
  this.add('estimatesmartpriority', this.estimateSmartPriority);

  this.add('getinfo', this.getInfo);
  this.add('validateaddress', this.validateAddress);
  this.add('createmultisig', this.createMultisig);
  this.add('createwitnessaddress', this.createWitnessAddress);
  this.add('verifymessage', this.verifyMessage);
  this.add('signmessagewithprivkey', this.signMessageWithPrivkey);

  this.add('setmocktime', this.setMockTime);

  this.add('getconnectioncount', this.getConnectionCount);
  this.add('ping', this.ping);
  this.add('getpeerinfo', this.getPeerInfo);
  this.add('addnode', this.addNode);
  this.add('disconnectnode', this.disconnectNode);
  this.add('getaddednodeinfo', this.getAddedNodeInfo);
  this.add('getnettotals', this.getNetTotals);
  this.add('getnetworkinfo', this.getNetworkInfo);
  this.add('setban', this.setBan);
  this.add('listbanned', this.listBanned);
  this.add('clearbanned', this.clearBanned);

  this.add('getrawtransaction', this.getRawTransaction);
  this.add('createrawtransaction', this.createRawTransaction);
  this.add('decoderawtransaction', this.decodeRawTransaction);
  this.add('decodescript', this.decodeScript);
  this.add('sendrawtransaction', this.sendRawTransaction);
  this.add('signrawtransaction', this.signRawTransaction);

  this.add('gettxoutproof', this.getTXOutProof);
  this.add('verifytxoutproof', this.verifyTXOutProof);

  this.add('getmemoryinfo', this.getMemoryInfo);
  this.add('setloglevel', this.setLogLevel);
};

/*
 * Overall control/query calls
 */

RPC.prototype.getInfo = co( /*#__PURE__*/_regenerator2.default.mark(function getInfo(args, help) {
  return _regenerator2.default.wrap(function getInfo$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:
          if (!(help || args.length !== 0)) {
            _context.next = 2;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getinfo');

        case 2:
          return _context.abrupt('return', {
            version: pkg.version,
            protocolversion: this.pool.options.version,
            walletversion: 0,
            balance: 0,
            blocks: this.chain.height,
            timeoffset: this.network.time.offset,
            connections: this.pool.peers.size(),
            proxy: '',
            difficulty: toDifficulty(this.chain.tip.bits),
            testnet: this.network !== Network.main,
            keypoololdest: 0,
            keypoolsize: 0,
            unlocked_until: 0,
            paytxfee: Amount.btc(this.network.feeRate, true),
            relayfee: Amount.btc(this.network.minRelay, true),
            errors: ''
          });

        case 3:
        case 'end':
          return _context.stop();
      }
    }
  }, getInfo, this);
}));

RPC.prototype.help = co( /*#__PURE__*/_regenerator2.default.mark(function _help(args, help) {
  var json;
  return _regenerator2.default.wrap(function _help$(_context2) {
    while (1) {
      switch (_context2.prev = _context2.next) {
        case 0:
          if (!(args.length === 0)) {
            _context2.next = 2;
            break;
          }

          return _context2.abrupt('return', 'Select a command.');

        case 2:

          json = {
            method: args[0],
            params: []
          };

          _context2.next = 5;
          return this.execute(json, true);

        case 5:
          return _context2.abrupt('return', _context2.sent);

        case 6:
        case 'end':
          return _context2.stop();
      }
    }
  }, _help, this);
}));

RPC.prototype.stop = co( /*#__PURE__*/_regenerator2.default.mark(function stop(args, help) {
  var self;
  return _regenerator2.default.wrap(function stop$(_context4) {
    while (1) {
      switch (_context4.prev = _context4.next) {
        case 0:
          self = this;

          if (!(help || args.length !== 0)) {
            _context4.next = 3;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'stop');

        case 3:

          co( /*#__PURE__*/_regenerator2.default.mark(function _callee() {
            return _regenerator2.default.wrap(function _callee$(_context3) {
              while (1) {
                switch (_context3.prev = _context3.next) {
                  case 0:
                    _context3.prev = 0;
                    _context3.next = 3;
                    return self.node.close();

                  case 3:
                    _context3.next = 9;
                    break;

                  case 5:
                    _context3.prev = 5;
                    _context3.t0 = _context3['catch'](0);

                    if (process.exit) process.exit(1);
                    return _context3.abrupt('return');

                  case 9:
                    if (process.exit) process.exit(0);

                  case 10:
                  case 'end':
                    return _context3.stop();
                }
              }
            }, _callee, this, [[0, 5]]);
          }))();

          return _context4.abrupt('return', 'Stopping.');

        case 5:
        case 'end':
          return _context4.stop();
      }
    }
  }, stop, this);
}));

/*
 * P2P networking
 */

RPC.prototype.getNetworkInfo = co( /*#__PURE__*/_regenerator2.default.mark(function getNetworkInfo(args, help) {
  var hosts, locals, i, keys, key, local;
  return _regenerator2.default.wrap(function getNetworkInfo$(_context5) {
    while (1) {
      switch (_context5.prev = _context5.next) {
        case 0:
          hosts = this.pool.hosts;
          locals = [];

          if (!(help || args.length !== 0)) {
            _context5.next = 4;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getnetworkinfo');

        case 4:

          keys = hosts.local.keys();

          for (i = 0; i < keys.length; i++) {
            key = keys[i];
            local = hosts.local.get(key);
            locals.push({
              address: local.addr.host,
              port: local.addr.port,
              score: local.score
            });
          }

          return _context5.abrupt('return', {
            version: pkg.version,
            subversion: this.pool.options.agent,
            protocolversion: this.pool.options.version,
            localservices: util.hex32(this.pool.options.services),
            localrelay: !this.pool.options.noRelay,
            timeoffset: this.network.time.offset,
            networkactive: this.pool.connected,
            connections: this.pool.peers.size(),
            networks: [],
            relayfee: Amount.btc(this.network.minRelay, true),
            incrementalfee: 0,
            localaddresses: locals,
            warnings: ''
          });

        case 7:
        case 'end':
          return _context5.stop();
      }
    }
  }, getNetworkInfo, this);
}));

RPC.prototype.addNode = co( /*#__PURE__*/_regenerator2.default.mark(function addNode(args, help) {
  var valid, node, cmd, addr, peer;
  return _regenerator2.default.wrap(function addNode$(_context6) {
    while (1) {
      switch (_context6.prev = _context6.next) {
        case 0:
          valid = new Validator([args]);
          node = valid.str(0, '');
          cmd = valid.str(1, '');

          if (!(help || args.length !== 2)) {
            _context6.next = 5;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'addnode "node" "add|remove|onetry"');

        case 5:
          _context6.t0 = cmd;
          _context6.next = _context6.t0 === 'add' ? 8 : _context6.t0 === 'onetry' ? 10 : _context6.t0 === 'remove' ? 13 : 15;
          break;

        case 8:
          addr = this.pool.hosts.addNode(node);
          ;

        case 10:
          addr = parseNetAddress(node, this.network);

          if (!this.pool.peers.get(addr.hostname)) {
            peer = this.pool.createOutbound(addr);
            this.pool.peers.add(peer);
          }

          return _context6.abrupt('break', 15);

        case 13:
          this.pool.hosts.removeNode(node);
          return _context6.abrupt('break', 15);

        case 15:
          return _context6.abrupt('return', null);

        case 16:
        case 'end':
          return _context6.stop();
      }
    }
  }, addNode, this);
}));

RPC.prototype.disconnectNode = co( /*#__PURE__*/_regenerator2.default.mark(function disconnectNode(args, help) {
  var valid, addr, peer;
  return _regenerator2.default.wrap(function disconnectNode$(_context7) {
    while (1) {
      switch (_context7.prev = _context7.next) {
        case 0:
          valid = new Validator([args]);
          addr = valid.str(0, '');

          if (!(help || args.length !== 1)) {
            _context7.next = 4;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'disconnectnode "node"');

        case 4:

          addr = parseIP(addr, this.network);
          peer = this.pool.peers.get(addr.hostname);

          if (peer) peer.destroy();

          return _context7.abrupt('return', null);

        case 8:
        case 'end':
          return _context7.stop();
      }
    }
  }, disconnectNode, this);
}));

RPC.prototype.getAddedNodeInfo = co( /*#__PURE__*/_regenerator2.default.mark(function getAddedNodeInfo(args, help) {
  var hosts, valid, addr, result, i, target, node, peer;
  return _regenerator2.default.wrap(function getAddedNodeInfo$(_context8) {
    while (1) {
      switch (_context8.prev = _context8.next) {
        case 0:
          hosts = this.pool.hosts;
          valid = new Validator([args]);
          addr = valid.str(0, '');
          result = [];

          if (!(help || args.length > 1)) {
            _context8.next = 6;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getaddednodeinfo ( "node" )');

        case 6:

          if (args.length === 1) target = parseIP(addr, this.network);

          i = 0;

        case 8:
          if (!(i < hosts.nodes.length)) {
            _context8.next = 23;
            break;
          }

          node = hosts.nodes[i];

          if (!target) {
            _context8.next = 15;
            break;
          }

          if (!(node.host !== target.host)) {
            _context8.next = 13;
            break;
          }

          return _context8.abrupt('continue', 20);

        case 13:
          if (!(node.port !== target.port)) {
            _context8.next = 15;
            break;
          }

          return _context8.abrupt('continue', 20);

        case 15:

          peer = this.pool.peers.get(node.hostname);

          if (!(!peer || !peer.connected)) {
            _context8.next = 19;
            break;
          }

          result.push({
            addednode: node.hostname,
            connected: false,
            addresses: []
          });
          return _context8.abrupt('continue', 20);

        case 19:

          result.push({
            addednode: node.hostname,
            connected: peer.connected,
            addresses: [{
              address: peer.hostname(),
              connected: peer.outbound ? 'outbound' : 'inbound'
            }]
          });

        case 20:
          i++;
          _context8.next = 8;
          break;

        case 23:
          if (!(target && result.length === 0)) {
            _context8.next = 25;
            break;
          }

          throw new RPCError(errs.CLIENT_NODE_NOT_ADDED, 'Node has not been added.');

        case 25:
          return _context8.abrupt('return', result);

        case 26:
        case 'end':
          return _context8.stop();
      }
    }
  }, getAddedNodeInfo, this);
}));

RPC.prototype.getConnectionCount = co( /*#__PURE__*/_regenerator2.default.mark(function getConnectionCount(args, help) {
  return _regenerator2.default.wrap(function getConnectionCount$(_context9) {
    while (1) {
      switch (_context9.prev = _context9.next) {
        case 0:
          if (!(help || args.length !== 0)) {
            _context9.next = 2;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getconnectioncount');

        case 2:
          return _context9.abrupt('return', this.pool.peers.size());

        case 3:
        case 'end':
          return _context9.stop();
      }
    }
  }, getConnectionCount, this);
}));

RPC.prototype.getNetTotals = co( /*#__PURE__*/_regenerator2.default.mark(function getNetTotals(args, help) {
  var sent, recv, peer;
  return _regenerator2.default.wrap(function getNetTotals$(_context10) {
    while (1) {
      switch (_context10.prev = _context10.next) {
        case 0:
          sent = 0;
          recv = 0;

          if (!(help || args.length > 0)) {
            _context10.next = 4;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getnettotals');

        case 4:

          for (peer = this.pool.peers.head(); peer; peer = peer.next) {
            sent += peer.socket.bytesWritten;
            recv += peer.socket.bytesRead;
          }

          return _context10.abrupt('return', {
            totalbytesrecv: recv,
            totalbytessent: sent,
            timemillis: util.ms()
          });

        case 6:
        case 'end':
          return _context10.stop();
      }
    }
  }, getNetTotals, this);
}));

RPC.prototype.getPeerInfo = co( /*#__PURE__*/_regenerator2.default.mark(function getPeerInfo(args, help) {
  var peers, peer, offset;
  return _regenerator2.default.wrap(function getPeerInfo$(_context11) {
    while (1) {
      switch (_context11.prev = _context11.next) {
        case 0:
          peers = [];

          if (!(help || args.length !== 0)) {
            _context11.next = 3;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getpeerinfo');

        case 3:

          for (peer = this.pool.peers.head(); peer; peer = peer.next) {
            offset = this.network.time.known[peer.hostname()];

            if (offset == null) offset = 0;

            peers.push({
              id: peer.id,
              addr: peer.hostname(),
              addrlocal: !peer.local.isNull() ? peer.local.hostname : undefined,
              services: util.hex32(peer.services),
              relaytxes: !peer.noRelay,
              lastsend: peer.lastSend / 1000 | 0,
              lastrecv: peer.lastRecv / 1000 | 0,
              bytessent: peer.socket.bytesWritten,
              bytesrecv: peer.socket.bytesRead,
              conntime: peer.ts !== 0 ? (util.ms() - peer.ts) / 1000 | 0 : 0,
              timeoffset: offset,
              pingtime: peer.lastPong !== -1 ? (peer.lastPong - peer.lastPing) / 1000 : -1,
              minping: peer.minPing !== -1 ? peer.minPing / 1000 : -1,
              version: peer.version,
              subver: peer.agent,
              inbound: !peer.outbound,
              startingheight: peer.height,
              besthash: peer.bestHash ? util.revHex(peer.bestHash) : null,
              bestheight: peer.bestHeight,
              banscore: peer.banScore,
              inflight: peer.blockMap.keys().map(util.revHex),
              whitelisted: false
            });
          }

          return _context11.abrupt('return', peers);

        case 5:
        case 'end':
          return _context11.stop();
      }
    }
  }, getPeerInfo, this);
}));

RPC.prototype.ping = co( /*#__PURE__*/_regenerator2.default.mark(function ping(args, help) {
  var peer;
  return _regenerator2.default.wrap(function ping$(_context12) {
    while (1) {
      switch (_context12.prev = _context12.next) {
        case 0:
          if (!(help || args.length !== 0)) {
            _context12.next = 2;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'ping');

        case 2:

          for (peer = this.pool.peers.head(); peer; peer = peer.next) {
            peer.sendPing();
          }return _context12.abrupt('return', null);

        case 4:
        case 'end':
          return _context12.stop();
      }
    }
  }, ping, this);
}));

RPC.prototype.setBan = co( /*#__PURE__*/_regenerator2.default.mark(function setBan(args, help) {
  var valid, addr, action;
  return _regenerator2.default.wrap(function setBan$(_context13) {
    while (1) {
      switch (_context13.prev = _context13.next) {
        case 0:
          valid = new Validator([args]);
          addr = valid.str(0, '');
          action = valid.str(1, '');

          if (!(help || args.length < 2 || action !== 'add' && action !== 'remove')) {
            _context13.next = 5;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'setban "ip(/netmask)" "add|remove" (bantime) (absolute)');

        case 5:

          addr = parseNetAddress(addr, this.network);

          _context13.t0 = action;
          _context13.next = _context13.t0 === 'add' ? 9 : _context13.t0 === 'remove' ? 11 : 13;
          break;

        case 9:
          this.pool.ban(addr);
          return _context13.abrupt('break', 13);

        case 11:
          this.pool.unban(addr);
          return _context13.abrupt('break', 13);

        case 13:
          return _context13.abrupt('return', null);

        case 14:
        case 'end':
          return _context13.stop();
      }
    }
  }, setBan, this);
}));

RPC.prototype.listBanned = co( /*#__PURE__*/_regenerator2.default.mark(function listBanned(args, help) {
  var i, banned, keys, host, time;
  return _regenerator2.default.wrap(function listBanned$(_context14) {
    while (1) {
      switch (_context14.prev = _context14.next) {
        case 0:
          if (!(help || args.length !== 0)) {
            _context14.next = 2;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'listbanned');

        case 2:

          banned = [];
          keys = (0, _keys2.default)(this.pool.hosts.banned);

          for (i = 0; i < keys.length; i++) {
            host = keys[i];
            time = this.pool.hosts.banned[host];
            banned.push({
              address: host,
              banned_until: time + this.pool.options.banTime,
              ban_created: time,
              ban_reason: ''
            });
          }

          return _context14.abrupt('return', banned);

        case 6:
        case 'end':
          return _context14.stop();
      }
    }
  }, listBanned, this);
}));

RPC.prototype.clearBanned = co( /*#__PURE__*/_regenerator2.default.mark(function clearBanned(args, help) {
  return _regenerator2.default.wrap(function clearBanned$(_context15) {
    while (1) {
      switch (_context15.prev = _context15.next) {
        case 0:
          if (!(help || args.length !== 0)) {
            _context15.next = 2;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'clearbanned');

        case 2:

          this.pool.hosts.clearBanned();

          return _context15.abrupt('return', null);

        case 4:
        case 'end':
          return _context15.stop();
      }
    }
  }, clearBanned, this);
}));

/* Block chain and UTXO */
RPC.prototype.getBlockchainInfo = co( /*#__PURE__*/_regenerator2.default.mark(function getBlockchainInfo(args, help) {
  return _regenerator2.default.wrap(function getBlockchainInfo$(_context16) {
    while (1) {
      switch (_context16.prev = _context16.next) {
        case 0:
          if (!(help || args.length !== 0)) {
            _context16.next = 2;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getblockchaininfo');

        case 2:
          _context16.t0 = this.network.type !== 'testnet' ? this.network.type : 'test';
          _context16.t1 = this.chain.height;
          _context16.t2 = this.chain.height;
          _context16.t3 = this.chain.tip.rhash();
          _context16.t4 = toDifficulty(this.chain.tip.bits);
          _context16.next = 9;
          return this.chain.tip.getMedianTime();

        case 9:
          _context16.t5 = _context16.sent;
          _context16.t6 = this.chain.getProgress();
          _context16.t7 = this.chain.tip.chainwork.toString('hex', 64);
          _context16.t8 = this.chain.options.prune;
          _context16.t9 = this.getSoftforks();
          _context16.next = 16;
          return this.getBIP9Softforks();

        case 16:
          _context16.t10 = _context16.sent;
          _context16.t11 = this.chain.options.prune ? Math.max(0, this.chain.height - this.network.block.keepBlocks) : null;
          return _context16.abrupt('return', {
            chain: _context16.t0,
            blocks: _context16.t1,
            headers: _context16.t2,
            bestblockhash: _context16.t3,
            difficulty: _context16.t4,
            mediantime: _context16.t5,
            verificationprogress: _context16.t6,
            chainwork: _context16.t7,
            pruned: _context16.t8,
            softforks: _context16.t9,
            bip9_softforks: _context16.t10,
            pruneheight: _context16.t11
          });

        case 19:
        case 'end':
          return _context16.stop();
      }
    }
  }, getBlockchainInfo, this);
}));

RPC.prototype.getBestBlockHash = co( /*#__PURE__*/_regenerator2.default.mark(function getBestBlockHash(args, help) {
  return _regenerator2.default.wrap(function getBestBlockHash$(_context17) {
    while (1) {
      switch (_context17.prev = _context17.next) {
        case 0:
          if (!(help || args.length !== 0)) {
            _context17.next = 2;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getbestblockhash');

        case 2:
          return _context17.abrupt('return', this.chain.tip.rhash());

        case 3:
        case 'end':
          return _context17.stop();
      }
    }
  }, getBestBlockHash, this);
}));

RPC.prototype.getBlockCount = co( /*#__PURE__*/_regenerator2.default.mark(function getBlockCount(args, help) {
  return _regenerator2.default.wrap(function getBlockCount$(_context18) {
    while (1) {
      switch (_context18.prev = _context18.next) {
        case 0:
          if (!(help || args.length !== 0)) {
            _context18.next = 2;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getblockcount');

        case 2:
          return _context18.abrupt('return', this.chain.tip.height);

        case 3:
        case 'end':
          return _context18.stop();
      }
    }
  }, getBlockCount, this);
}));

RPC.prototype.getBlock = co( /*#__PURE__*/_regenerator2.default.mark(function getBlock(args, help) {
  var valid, hash, verbose, details, entry, block;
  return _regenerator2.default.wrap(function getBlock$(_context19) {
    while (1) {
      switch (_context19.prev = _context19.next) {
        case 0:
          valid = new Validator([args]);
          hash = valid.hash(0);
          verbose = valid.bool(1, true);
          details = valid.bool(2, false);

          if (!(help || args.length < 1 || args.length > 3)) {
            _context19.next = 6;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getblock "hash" ( verbose )');

        case 6:
          if (hash) {
            _context19.next = 8;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid block hash.');

        case 8:
          _context19.next = 10;
          return this.chain.db.getEntry(hash);

        case 10:
          entry = _context19.sent;

          if (entry) {
            _context19.next = 13;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'Block not found');

        case 13:
          _context19.next = 15;
          return this.chain.db.getBlock(entry.hash);

        case 15:
          block = _context19.sent;

          if (block) {
            _context19.next = 22;
            break;
          }

          if (!this.chain.options.spv) {
            _context19.next = 19;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'Block not available (spv mode)');

        case 19:
          if (!this.chain.options.prune) {
            _context19.next = 21;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'Block not available (pruned data)');

        case 21:
          throw new RPCError(errs.MISC_ERROR, 'Can\'t read block from disk');

        case 22:
          if (verbose) {
            _context19.next = 24;
            break;
          }

          return _context19.abrupt('return', block.toRaw().toString('hex'));

        case 24:
          _context19.next = 26;
          return this.blockToJSON(entry, block, details);

        case 26:
          return _context19.abrupt('return', _context19.sent);

        case 27:
        case 'end':
          return _context19.stop();
      }
    }
  }, getBlock, this);
}));

RPC.prototype.getBlockByHeight = co( /*#__PURE__*/_regenerator2.default.mark(function getBlockByHeight(args, help) {
  var valid, height, verbose, details, entry, block;
  return _regenerator2.default.wrap(function getBlockByHeight$(_context20) {
    while (1) {
      switch (_context20.prev = _context20.next) {
        case 0:
          valid = new Validator([args]);
          height = valid.u32(0, -1);
          verbose = valid.bool(1, true);
          details = valid.bool(2, false);

          if (!(help || args.length < 1 || args.length > 3)) {
            _context20.next = 6;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getblockbyheight "height" ( verbose )');

        case 6:
          if (!(height === -1)) {
            _context20.next = 8;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid block height.');

        case 8:
          _context20.next = 10;
          return this.chain.db.getEntry(height);

        case 10:
          entry = _context20.sent;

          if (entry) {
            _context20.next = 13;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'Block not found');

        case 13:
          _context20.next = 15;
          return this.chain.db.getBlock(entry.hash);

        case 15:
          block = _context20.sent;

          if (block) {
            _context20.next = 22;
            break;
          }

          if (!this.chain.options.spv) {
            _context20.next = 19;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'Block not available (spv mode)');

        case 19:
          if (!this.chain.options.prune) {
            _context20.next = 21;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'Block not available (pruned data)');

        case 21:
          throw new RPCError(errs.DATABASE_ERROR, 'Can\'t read block from disk');

        case 22:
          if (verbose) {
            _context20.next = 24;
            break;
          }

          return _context20.abrupt('return', block.toRaw().toString('hex'));

        case 24:
          _context20.next = 26;
          return this.blockToJSON(entry, block, details);

        case 26:
          return _context20.abrupt('return', _context20.sent);

        case 27:
        case 'end':
          return _context20.stop();
      }
    }
  }, getBlockByHeight, this);
}));

RPC.prototype.getBlockHash = co( /*#__PURE__*/_regenerator2.default.mark(function getBlockHash(args, help) {
  var valid, height, hash;
  return _regenerator2.default.wrap(function getBlockHash$(_context21) {
    while (1) {
      switch (_context21.prev = _context21.next) {
        case 0:
          valid = new Validator([args]);
          height = valid.u32(0);

          if (!(help || args.length !== 1)) {
            _context21.next = 4;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getblockhash index');

        case 4:
          if (!(height == null || height > this.chain.height)) {
            _context21.next = 6;
            break;
          }

          throw new RPCError(errs.INVALID_PARAMETER, 'Block height out of range.');

        case 6:
          _context21.next = 8;
          return this.chain.db.getHash(height);

        case 8:
          hash = _context21.sent;

          if (hash) {
            _context21.next = 11;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'Not found.');

        case 11:
          return _context21.abrupt('return', util.revHex(hash));

        case 12:
        case 'end':
          return _context21.stop();
      }
    }
  }, getBlockHash, this);
}));

RPC.prototype.getBlockHeader = co( /*#__PURE__*/_regenerator2.default.mark(function getBlockHeader(args, help) {
  var valid, hash, verbose, entry;
  return _regenerator2.default.wrap(function getBlockHeader$(_context22) {
    while (1) {
      switch (_context22.prev = _context22.next) {
        case 0:
          valid = new Validator([args]);
          hash = valid.hash(0);
          verbose = valid.bool(1, true);

          if (!(help || args.length < 1 || args.length > 2)) {
            _context22.next = 5;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getblockheader "hash" ( verbose )');

        case 5:
          if (hash) {
            _context22.next = 7;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'Invalid block hash.');

        case 7:
          _context22.next = 9;
          return this.chain.db.getEntry(hash);

        case 9:
          entry = _context22.sent;

          if (entry) {
            _context22.next = 12;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'Block not found');

        case 12:
          if (verbose) {
            _context22.next = 14;
            break;
          }

          return _context22.abrupt('return', entry.toRaw().toString('hex', 0, 80));

        case 14:
          _context22.next = 16;
          return this.headerToJSON(entry);

        case 16:
          return _context22.abrupt('return', _context22.sent);

        case 17:
        case 'end':
          return _context22.stop();
      }
    }
  }, getBlockHeader, this);
}));

RPC.prototype.getChainTips = co( /*#__PURE__*/_regenerator2.default.mark(function getChainTips(args, help) {
  var i, hash, tips, result, entry, fork, main;
  return _regenerator2.default.wrap(function getChainTips$(_context23) {
    while (1) {
      switch (_context23.prev = _context23.next) {
        case 0:
          if (!(help || args.length !== 0)) {
            _context23.next = 2;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getchaintips');

        case 2:
          _context23.next = 4;
          return this.chain.db.getTips();

        case 4:
          tips = _context23.sent;

          result = [];

          i = 0;

        case 7:
          if (!(i < tips.length)) {
            _context23.next = 23;
            break;
          }

          hash = tips[i];
          _context23.next = 11;
          return this.chain.db.getEntry(hash);

        case 11:
          entry = _context23.sent;

          assert(entry);

          _context23.next = 15;
          return this.findFork(entry);

        case 15:
          fork = _context23.sent;
          _context23.next = 18;
          return entry.isMainChain();

        case 18:
          main = _context23.sent;


          result.push({
            height: entry.height,
            hash: entry.rhash(),
            branchlen: entry.height - fork.height,
            status: main ? 'active' : 'valid-headers'
          });

        case 20:
          i++;
          _context23.next = 7;
          break;

        case 23:
          return _context23.abrupt('return', result);

        case 24:
        case 'end':
          return _context23.stop();
      }
    }
  }, getChainTips, this);
}));

RPC.prototype.getDifficulty = co( /*#__PURE__*/_regenerator2.default.mark(function getDifficulty(args, help) {
  return _regenerator2.default.wrap(function getDifficulty$(_context24) {
    while (1) {
      switch (_context24.prev = _context24.next) {
        case 0:
          if (!(help || args.length !== 0)) {
            _context24.next = 2;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getdifficulty');

        case 2:
          return _context24.abrupt('return', toDifficulty(this.chain.tip.bits));

        case 3:
        case 'end':
          return _context24.stop();
      }
    }
  }, getDifficulty, this);
}));

RPC.prototype.getMempoolInfo = co( /*#__PURE__*/_regenerator2.default.mark(function getMempoolInfo(args, help) {
  return _regenerator2.default.wrap(function getMempoolInfo$(_context25) {
    while (1) {
      switch (_context25.prev = _context25.next) {
        case 0:
          if (!(help || args.length !== 0)) {
            _context25.next = 2;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getmempoolinfo');

        case 2:
          if (this.mempool) {
            _context25.next = 4;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'No mempool available.');

        case 4:
          return _context25.abrupt('return', {
            size: this.mempool.totalTX,
            bytes: this.mempool.getSize(),
            usage: this.mempool.getSize(),
            maxmempool: this.mempool.options.maxSize,
            mempoolminfee: Amount.btc(this.mempool.options.minRelay, true)
          });

        case 5:
        case 'end':
          return _context25.stop();
      }
    }
  }, getMempoolInfo, this);
}));

RPC.prototype.getMempoolAncestors = co( /*#__PURE__*/_regenerator2.default.mark(function getMempoolAncestors(args, help) {
  var valid, hash, verbose, out, i, entry, entries;
  return _regenerator2.default.wrap(function getMempoolAncestors$(_context26) {
    while (1) {
      switch (_context26.prev = _context26.next) {
        case 0:
          valid = new Validator([args]);
          hash = valid.hash(0);
          verbose = valid.bool(1, false);
          out = [];

          if (!(help || args.length < 1 || args.length > 2)) {
            _context26.next = 6;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getmempoolancestors txid (verbose)');

        case 6:
          if (this.mempool) {
            _context26.next = 8;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'No mempool available.');

        case 8:
          if (hash) {
            _context26.next = 10;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid TXID.');

        case 10:

          entry = this.mempool.getEntry(hash);

          if (entry) {
            _context26.next = 13;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'Transaction not in mempool.');

        case 13:

          entries = this.mempool.getAncestors(entry);

          if (verbose) {
            for (i = 0; i < entries.length; i++) {
              entry = entries[i];
              out.push(this.entryToJSON(entry));
            }
          } else {
            for (i = 0; i < entries.length; i++) {
              entry = entries[i];
              out.push(entry.txid());
            }
          }

          return _context26.abrupt('return', out);

        case 16:
        case 'end':
          return _context26.stop();
      }
    }
  }, getMempoolAncestors, this);
}));

RPC.prototype.getMempoolDescendants = co( /*#__PURE__*/_regenerator2.default.mark(function getMempoolDescendants(args, help) {
  var valid, hash, verbose, out, i, entry, entries;
  return _regenerator2.default.wrap(function getMempoolDescendants$(_context27) {
    while (1) {
      switch (_context27.prev = _context27.next) {
        case 0:
          valid = new Validator([args]);
          hash = valid.hash(0);
          verbose = valid.bool(1, false);
          out = [];

          if (!(help || args.length < 1 || args.length > 2)) {
            _context27.next = 6;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getmempooldescendants txid (verbose)');

        case 6:
          if (this.mempool) {
            _context27.next = 8;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'No mempool available.');

        case 8:
          if (hash) {
            _context27.next = 10;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid TXID.');

        case 10:

          entry = this.mempool.getEntry(hash);

          if (entry) {
            _context27.next = 13;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'Transaction not in mempool.');

        case 13:

          entries = this.mempool.getDescendants(entry);

          if (verbose) {
            for (i = 0; i < entries.length; i++) {
              entry = entries[i];
              out.push(this.entryToJSON(entry));
            }
          } else {
            for (i = 0; i < entries.length; i++) {
              entry = entries[i];
              out.push(entry.txid());
            }
          }

          return _context27.abrupt('return', out);

        case 16:
        case 'end':
          return _context27.stop();
      }
    }
  }, getMempoolDescendants, this);
}));

RPC.prototype.getMempoolEntry = co( /*#__PURE__*/_regenerator2.default.mark(function getMempoolEntry(args, help) {
  var valid, hash, entry;
  return _regenerator2.default.wrap(function getMempoolEntry$(_context28) {
    while (1) {
      switch (_context28.prev = _context28.next) {
        case 0:
          valid = new Validator([args]);
          hash = valid.hash(0);

          if (!(help || args.length !== 1)) {
            _context28.next = 4;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getmempoolentry txid');

        case 4:
          if (this.mempool) {
            _context28.next = 6;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'No mempool available.');

        case 6:
          if (hash) {
            _context28.next = 8;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid TXID.');

        case 8:

          entry = this.mempool.getEntry(hash);

          if (entry) {
            _context28.next = 11;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'Transaction not in mempool.');

        case 11:
          return _context28.abrupt('return', this.entryToJSON(entry));

        case 12:
        case 'end':
          return _context28.stop();
      }
    }
  }, getMempoolEntry, this);
}));

RPC.prototype.getRawMempool = co( /*#__PURE__*/_regenerator2.default.mark(function getRawMempool(args, help) {
  var valid, verbose, out, i, hashes, hash, entry;
  return _regenerator2.default.wrap(function getRawMempool$(_context29) {
    while (1) {
      switch (_context29.prev = _context29.next) {
        case 0:
          valid = new Validator([args]);
          verbose = valid.bool(0, false);
          out = {};

          if (!(help || args.length > 1)) {
            _context29.next = 5;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getrawmempool ( verbose )');

        case 5:
          if (this.mempool) {
            _context29.next = 7;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'No mempool available.');

        case 7:
          if (!verbose) {
            _context29.next = 20;
            break;
          }

          hashes = this.mempool.getSnapshot();

          i = 0;

        case 10:
          if (!(i < hashes.length)) {
            _context29.next = 19;
            break;
          }

          hash = hashes[i];
          entry = this.mempool.getEntry(hash);

          if (entry) {
            _context29.next = 15;
            break;
          }

          return _context29.abrupt('continue', 16);

        case 15:

          out[entry.txid()] = this.entryToJSON(entry);

        case 16:
          i++;
          _context29.next = 10;
          break;

        case 19:
          return _context29.abrupt('return', out);

        case 20:

          hashes = this.mempool.getSnapshot();

          return _context29.abrupt('return', hashes.map(util.revHex));

        case 22:
        case 'end':
          return _context29.stop();
      }
    }
  }, getRawMempool, this);
}));

RPC.prototype.getTXOut = co( /*#__PURE__*/_regenerator2.default.mark(function getTXOut(args, help) {
  var valid, hash, index, mempool, coin;
  return _regenerator2.default.wrap(function getTXOut$(_context30) {
    while (1) {
      switch (_context30.prev = _context30.next) {
        case 0:
          valid = new Validator([args]);
          hash = valid.hash(0);
          index = valid.u32(1);
          mempool = valid.bool(2, true);

          if (!(help || args.length < 2 || args.length > 3)) {
            _context30.next = 6;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'gettxout "txid" n ( includemempool )');

        case 6:
          if (!this.chain.options.spv) {
            _context30.next = 8;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'Cannot get coins in SPV mode.');

        case 8:
          if (!this.chain.options.prune) {
            _context30.next = 10;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'Cannot get coins when pruned.');

        case 10:
          if (!(!hash || index == null)) {
            _context30.next = 12;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid outpoint.');

        case 12:
          if (!mempool) {
            _context30.next = 16;
            break;
          }

          if (this.mempool) {
            _context30.next = 15;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'No mempool available.');

        case 15:
          coin = this.mempool.getCoin(hash, index);

        case 16:
          if (coin) {
            _context30.next = 20;
            break;
          }

          _context30.next = 19;
          return this.chain.db.getCoin(hash, index);

        case 19:
          coin = _context30.sent;

        case 20:
          if (coin) {
            _context30.next = 22;
            break;
          }

          return _context30.abrupt('return', null);

        case 22:
          return _context30.abrupt('return', {
            bestblock: this.chain.tip.rhash(),
            confirmations: coin.getDepth(this.chain.height),
            value: Amount.btc(coin.value, true),
            scriptPubKey: this.scriptToJSON(coin.script, true),
            version: coin.version,
            coinbase: coin.coinbase
          });

        case 23:
        case 'end':
          return _context30.stop();
      }
    }
  }, getTXOut, this);
}));

RPC.prototype.getTXOutProof = co( /*#__PURE__*/_regenerator2.default.mark(function getTXOutProof(args, help) {
  var valid, txids, hash, uniq, i, block, txid, tx, coins;
  return _regenerator2.default.wrap(function getTXOutProof$(_context31) {
    while (1) {
      switch (_context31.prev = _context31.next) {
        case 0:
          valid = new Validator([args]);
          txids = valid.array(0);
          hash = valid.hash(1);
          uniq = {};

          if (!(help || args.length !== 1 && args.length !== 2)) {
            _context31.next = 6;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'gettxoutproof ["txid",...] ( blockhash )');

        case 6:
          if (!this.chain.options.spv) {
            _context31.next = 8;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'Cannot get coins in SPV mode.');

        case 8:
          if (!this.chain.options.prune) {
            _context31.next = 10;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'Cannot get coins when pruned.');

        case 10:
          if (!(!txids || txids.length === 0)) {
            _context31.next = 12;
            break;
          }

          throw new RPCError(errs.INVALID_PARAMETER, 'Invalid TXIDs.');

        case 12:

          valid = new Validator([txids]);

          i = 0;

        case 14:
          if (!(i < txids.length)) {
            _context31.next = 25;
            break;
          }

          txid = valid.hash(i);

          if (txid) {
            _context31.next = 18;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid TXID.');

        case 18:
          if (!uniq[txid]) {
            _context31.next = 20;
            break;
          }

          throw new RPCError(errs.INVALID_PARAMETER, 'Duplicate txid.');

        case 20:

          uniq[txid] = true;
          txids[i] = txid;

        case 22:
          i++;
          _context31.next = 14;
          break;

        case 25:
          if (!hash) {
            _context31.next = 31;
            break;
          }

          _context31.next = 28;
          return this.chain.db.getBlock(hash);

        case 28:
          block = _context31.sent;
          _context31.next = 50;
          break;

        case 31:
          if (!this.chain.options.indexTX) {
            _context31.next = 42;
            break;
          }

          _context31.next = 34;
          return this.chain.db.getMeta(txid);

        case 34:
          tx = _context31.sent;

          if (tx) {
            _context31.next = 37;
            break;
          }

          return _context31.abrupt('return');

        case 37:
          _context31.next = 39;
          return this.chain.db.getBlock(tx.block);

        case 39:
          block = _context31.sent;
          _context31.next = 50;
          break;

        case 42:
          _context31.next = 44;
          return this.chain.db.getCoins(txid);

        case 44:
          coins = _context31.sent;

          if (coins) {
            _context31.next = 47;
            break;
          }

          return _context31.abrupt('return');

        case 47:
          _context31.next = 49;
          return this.chain.db.getBlock(coins.height);

        case 49:
          block = _context31.sent;

        case 50:
          if (block) {
            _context31.next = 52;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'Block not found.');

        case 52:
          i = 0;

        case 53:
          if (!(i < txids.length)) {
            _context31.next = 60;
            break;
          }

          txid = txids[i];

          if (block.hasTX(txid)) {
            _context31.next = 57;
            break;
          }

          throw new RPCError(errs.VERIFY_ERROR, 'Block does not contain all txids.');

        case 57:
          i++;
          _context31.next = 53;
          break;

        case 60:

          block = MerkleBlock.fromHashes(block, txids);

          return _context31.abrupt('return', block.toRaw().toString('hex'));

        case 62:
        case 'end':
          return _context31.stop();
      }
    }
  }, getTXOutProof, this);
}));

RPC.prototype.verifyTXOutProof = co( /*#__PURE__*/_regenerator2.default.mark(function verifyTXOutProof(args, help) {
  var valid, data, out, i, block, hash, entry;
  return _regenerator2.default.wrap(function verifyTXOutProof$(_context32) {
    while (1) {
      switch (_context32.prev = _context32.next) {
        case 0:
          valid = new Validator([args]);
          data = valid.buf(0);
          out = [];

          if (!(help || args.length !== 1)) {
            _context32.next = 5;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'verifytxoutproof "proof"');

        case 5:
          if (data) {
            _context32.next = 7;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid hex string.');

        case 7:

          block = MerkleBlock.fromRaw(data);

          if (block.verify()) {
            _context32.next = 10;
            break;
          }

          return _context32.abrupt('return', out);

        case 10:
          _context32.next = 12;
          return this.chain.db.getEntry(block.hash('hex'));

        case 12:
          entry = _context32.sent;

          if (entry) {
            _context32.next = 15;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'Block not found in chain.');

        case 15:

          for (i = 0; i < block.tree.matches.length; i++) {
            hash = block.tree.matches[i];
            out.push(util.revHex(hash));
          }

          return _context32.abrupt('return', out);

        case 17:
        case 'end':
          return _context32.stop();
      }
    }
  }, verifyTXOutProof, this);
}));

RPC.prototype.getTXOutSetInfo = co( /*#__PURE__*/_regenerator2.default.mark(function getTXOutSetInfo(args, help) {
  return _regenerator2.default.wrap(function getTXOutSetInfo$(_context33) {
    while (1) {
      switch (_context33.prev = _context33.next) {
        case 0:
          if (!(help || args.length !== 0)) {
            _context33.next = 2;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'gettxoutsetinfo');

        case 2:
          if (!this.chain.options.spv) {
            _context33.next = 4;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'Chainstate not available (SPV mode).');

        case 4:
          return _context33.abrupt('return', {
            height: this.chain.height,
            bestblock: this.chain.tip.rhash(),
            transactions: this.chain.db.state.tx,
            txouts: this.chain.db.state.coin,
            bytes_serialized: 0,
            hash_serialized: 0,
            total_amount: Amount.btc(this.chain.db.state.value, true)
          });

        case 5:
        case 'end':
          return _context33.stop();
      }
    }
  }, getTXOutSetInfo, this);
}));

RPC.prototype.pruneBlockchain = co( /*#__PURE__*/_regenerator2.default.mark(function pruneBlockchain(args, help) {
  return _regenerator2.default.wrap(function pruneBlockchain$(_context34) {
    while (1) {
      switch (_context34.prev = _context34.next) {
        case 0:
          if (!(help || args.length !== 0)) {
            _context34.next = 2;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'pruneblockchain');

        case 2:
          if (!this.chain.options.spv) {
            _context34.next = 4;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'Cannot prune chain in SPV mode.');

        case 4:
          if (!this.chain.options.prune) {
            _context34.next = 6;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'Chain is already pruned.');

        case 6:
          if (!(this.chain.height < this.network.block.pruneAfterHeight)) {
            _context34.next = 8;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'Chain is too short for pruning.');

        case 8:
          _context34.prev = 8;
          _context34.next = 11;
          return this.chain.prune();

        case 11:
          _context34.next = 16;
          break;

        case 13:
          _context34.prev = 13;
          _context34.t0 = _context34['catch'](8);
          throw new RPCError(errs.DATABASE_ERROR, _context34.t0.message);

        case 16:
        case 'end':
          return _context34.stop();
      }
    }
  }, pruneBlockchain, this, [[8, 13]]);
}));

RPC.prototype.verifyChain = co( /*#__PURE__*/_regenerator2.default.mark(function verifyChain(args, help) {
  var valid, level, blocks;
  return _regenerator2.default.wrap(function verifyChain$(_context35) {
    while (1) {
      switch (_context35.prev = _context35.next) {
        case 0:
          valid = new Validator([args]);
          level = valid.u32(0);
          blocks = valid.u32(1);

          if (!(help || args.length > 2)) {
            _context35.next = 5;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'verifychain ( checklevel numblocks )');

        case 5:
          if (!(level == null || blocks == null)) {
            _context35.next = 7;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Missing parameters.');

        case 7:
          if (!this.chain.options.spv) {
            _context35.next = 9;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'Cannot verify chain in SPV mode.');

        case 9:
          if (!this.chain.options.prune) {
            _context35.next = 11;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'Cannot verify chain when pruned.');

        case 11:
          return _context35.abrupt('return', null);

        case 12:
        case 'end':
          return _context35.stop();
      }
    }
  }, verifyChain, this);
}));

/*
 * Mining
 */

RPC.prototype.submitWork = co( /*#__PURE__*/_regenerator2.default.mark(function submitWork(data) {
  var unlock;
  return _regenerator2.default.wrap(function submitWork$(_context36) {
    while (1) {
      switch (_context36.prev = _context36.next) {
        case 0:
          _context36.next = 2;
          return this.locker.lock();

        case 2:
          unlock = _context36.sent;
          _context36.prev = 3;
          _context36.next = 6;
          return this._submitWork(data);

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
  }, submitWork, this, [[3,, 7, 10]]);
}));

RPC.prototype._submitWork = co( /*#__PURE__*/_regenerator2.default.mark(function _submitWork(data) {
  var attempt, header, nonce, ts, nonces, n1, n2, proof, block, entry;
  return _regenerator2.default.wrap(function _submitWork$(_context37) {
    while (1) {
      switch (_context37.prev = _context37.next) {
        case 0:
          attempt = this.attempt;

          if (attempt) {
            _context37.next = 3;
            break;
          }

          return _context37.abrupt('return', false);

        case 3:
          if (!(data.length !== 128)) {
            _context37.next = 5;
            break;
          }

          throw new RPCError(errs.INVALID_PARAMETER, 'Invalid work size.');

        case 5:

          header = Headers.fromAbbr(data);

          data = data.slice(0, 80);
          data = swap32(data);

          if (!(header.prevBlock !== attempt.prevBlock || header.bits !== attempt.bits)) {
            _context37.next = 10;
            break;
          }

          return _context37.abrupt('return', false);

        case 10:
          if (header.verify()) {
            _context37.next = 12;
            break;
          }

          return _context37.abrupt('return', false);

        case 12:

          nonces = this.merkleMap[header.merkleRoot];

          if (nonces) {
            _context37.next = 15;
            break;
          }

          return _context37.abrupt('return', false);

        case 15:

          n1 = nonces.nonce1;
          n2 = nonces.nonce2;
          nonce = header.nonce;
          ts = header.ts;

          proof = attempt.getProof(n1, n2, ts, nonce);

          if (proof.verify(attempt.target)) {
            _context37.next = 22;
            break;
          }

          return _context37.abrupt('return', false);

        case 22:

          block = attempt.commit(proof);

          _context37.prev = 23;
          _context37.next = 26;
          return this.chain.add(block);

        case 26:
          entry = _context37.sent;
          _context37.next = 35;
          break;

        case 29:
          _context37.prev = 29;
          _context37.t0 = _context37['catch'](23);

          if (!(_context37.t0.type === 'VerifyError')) {
            _context37.next = 34;
            break;
          }

          this.logger.warning('RPC block rejected: %s (%s).', block.rhash(), _context37.t0.reason);
          return _context37.abrupt('return', false);

        case 34:
          throw _context37.t0;

        case 35:
          if (entry) {
            _context37.next = 38;
            break;
          }

          this.logger.warning('RPC block rejected: %s (bad-prevblk).', block.rhash());
          return _context37.abrupt('return', false);

        case 38:
          return _context37.abrupt('return', true);

        case 39:
        case 'end':
          return _context37.stop();
      }
    }
  }, _submitWork, this, [[23, 29]]);
}));

RPC.prototype.createWork = co( /*#__PURE__*/_regenerator2.default.mark(function createWork(data) {
  var unlock;
  return _regenerator2.default.wrap(function createWork$(_context38) {
    while (1) {
      switch (_context38.prev = _context38.next) {
        case 0:
          _context38.next = 2;
          return this.locker.lock();

        case 2:
          unlock = _context38.sent;
          _context38.prev = 3;
          _context38.next = 6;
          return this._createWork(data);

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
  }, createWork, this, [[3,, 7, 10]]);
}));

RPC.prototype._createWork = co( /*#__PURE__*/_regenerator2.default.mark(function _createWork() {
  var attempt, n1, n2, ts, data, root, head;
  return _regenerator2.default.wrap(function _createWork$(_context39) {
    while (1) {
      switch (_context39.prev = _context39.next) {
        case 0:
          _context39.next = 2;
          return this.updateWork();

        case 2:
          attempt = _context39.sent;
          n1 = this.nonce1;
          n2 = this.nonce2;
          ts = attempt.ts;


          data = Buffer.allocUnsafe(128);
          data.fill(0);

          root = attempt.getRoot(n1, n2);
          head = attempt.getHeader(root, ts, 0);

          head.copy(data, 0);

          data[80] = 0x80;
          data.writeUInt32BE(80 * 8, data.length - 4, true);

          data = swap32(data);

          return _context39.abrupt('return', {
            data: data.toString('hex'),
            target: attempt.target.toString('hex'),
            height: attempt.height
          });

        case 15:
        case 'end':
          return _context39.stop();
      }
    }
  }, _createWork, this);
}));

RPC.prototype.getWorkLongpoll = co( /*#__PURE__*/_regenerator2.default.mark(function getWorkLongpoll(args, help) {
  return _regenerator2.default.wrap(function getWorkLongpoll$(_context40) {
    while (1) {
      switch (_context40.prev = _context40.next) {
        case 0:
          _context40.next = 2;
          return this.longpoll();

        case 2:
          _context40.next = 4;
          return this.createWork();

        case 4:
          return _context40.abrupt('return', _context40.sent);

        case 5:
        case 'end':
          return _context40.stop();
      }
    }
  }, getWorkLongpoll, this);
}));

RPC.prototype.getWork = co( /*#__PURE__*/_regenerator2.default.mark(function getWork(args, help) {
  var valid, data;
  return _regenerator2.default.wrap(function getWork$(_context41) {
    while (1) {
      switch (_context41.prev = _context41.next) {
        case 0:
          valid = new Validator([args]);
          data = valid.buf(0);

          if (!(args.length > 1)) {
            _context41.next = 4;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getwork ( "data" )');

        case 4:
          if (!(args.length === 1)) {
            _context41.next = 10;
            break;
          }

          if (data) {
            _context41.next = 7;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid work data.');

        case 7:
          _context41.next = 9;
          return this.submitWork(data);

        case 9:
          return _context41.abrupt('return', _context41.sent);

        case 10:
          _context41.next = 12;
          return this.createWork();

        case 12:
          return _context41.abrupt('return', _context41.sent);

        case 13:
        case 'end':
          return _context41.stop();
      }
    }
  }, getWork, this);
}));

RPC.prototype.submitBlock = co( /*#__PURE__*/_regenerator2.default.mark(function submitBlock(args, help) {
  var valid, data, block;
  return _regenerator2.default.wrap(function submitBlock$(_context42) {
    while (1) {
      switch (_context42.prev = _context42.next) {
        case 0:
          valid = new Validator([args]);
          data = valid.buf(0);

          if (!(help || args.length < 1 || args.length > 2)) {
            _context42.next = 4;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'submitblock "hexdata" ( "jsonparametersobject" )');

        case 4:

          block = Block.fromRaw(data);

          _context42.next = 7;
          return this.addBlock(block);

        case 7:
          return _context42.abrupt('return', _context42.sent);

        case 8:
        case 'end':
          return _context42.stop();
      }
    }
  }, submitBlock, this);
}));

RPC.prototype.getBlockTemplate = co( /*#__PURE__*/_regenerator2.default.mark(function getBlockTemplate(args, help) {
  var validator, options, valid, mode, lpid, data, rules, capabilities, maxVersion, coinbase, txnCap, valueCap, i, capability, block;
  return _regenerator2.default.wrap(function getBlockTemplate$(_context43) {
    while (1) {
      switch (_context43.prev = _context43.next) {
        case 0:
          validator = new Validator([args]);
          options = validator.obj(0, {});
          valid = new Validator([options]);
          mode = valid.str('mode', 'template');
          lpid = valid.str('longpollid');
          data = valid.buf('data');
          rules = valid.array('rules');
          capabilities = valid.array('capabilities');
          maxVersion = valid.u32('maxversion', -1);
          coinbase = false;
          txnCap = false;
          valueCap = false;

          if (!(help || args.length > 1)) {
            _context43.next = 14;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getblocktemplate ( "jsonrequestobject" )');

        case 14:
          if (!(mode !== 'template' && mode !== 'proposal')) {
            _context43.next = 16;
            break;
          }

          throw new RPCError(errs.INVALID_PARAMETER, 'Invalid mode.');

        case 16:
          if (!(mode === 'proposal')) {
            _context43.next = 33;
            break;
          }

          if (data) {
            _context43.next = 19;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Missing data parameter.');

        case 19:

          block = Block.fromRaw(data);

          if (!(block.prevBlock !== this.chain.tip.hash)) {
            _context43.next = 22;
            break;
          }

          return _context43.abrupt('return', 'inconclusive-not-best-prevblk');

        case 22:
          _context43.prev = 22;
          _context43.next = 25;
          return this.chain.verifyBlock(block);

        case 25:
          _context43.next = 32;
          break;

        case 27:
          _context43.prev = 27;
          _context43.t0 = _context43['catch'](22);

          if (!(_context43.t0.type === 'VerifyError')) {
            _context43.next = 31;
            break;
          }

          return _context43.abrupt('return', _context43.t0.reason);

        case 31:
          throw _context43.t0;

        case 32:
          return _context43.abrupt('return', null);

        case 33:

          if (rules) maxVersion = -1;

          if (!capabilities) {
            _context43.next = 55;
            break;
          }

          i = 0;

        case 36:
          if (!(i < capabilities.length)) {
            _context43.next = 50;
            break;
          }

          capability = capabilities[i];

          if (!(typeof capability !== 'string')) {
            _context43.next = 40;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid capability.');

        case 40:
          _context43.t1 = capability;
          _context43.next = _context43.t1 === 'coinbasetxn' ? 43 : _context43.t1 === 'coinbasevalue' ? 45 : 47;
          break;

        case 43:
          txnCap = true;
          return _context43.abrupt('break', 47);

        case 45:
          // Prefer value if they support it.
          valueCap = true;
          return _context43.abrupt('break', 47);

        case 47:
          i++;
          _context43.next = 36;
          break;

        case 50:

          // BIP22 states that we can't have coinbasetxn
          // _and_ coinbasevalue in the same template.
          // The problem is, many clients _say_ they
          // support coinbasetxn when they don't (ckpool).
          // To make matters worse, some clients will
          // parse an undefined `coinbasevalue` as zero.
          // Because of all of this, coinbasetxn is
          // disabled for now.
          valueCap = true;

          if (!(txnCap && !valueCap)) {
            _context43.next = 55;
            break;
          }

          if (!(this.miner.addresses.length === 0)) {
            _context43.next = 54;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'No addresses available for coinbase.');

        case 54:
          coinbase = true;

        case 55:
          if (this.network.selfConnect) {
            _context43.next = 60;
            break;
          }

          if (!(this.pool.peers.size() === 0)) {
            _context43.next = 58;
            break;
          }

          throw new RPCError(errs.CLIENT_NOT_CONNECTED, 'Bitcoin is not connected!');

        case 58:
          if (this.chain.synced) {
            _context43.next = 60;
            break;
          }

          throw new RPCError(errs.CLIENT_IN_INITIAL_DOWNLOAD, 'Bitcoin is downloading blocks...');

        case 60:
          if (!lpid) {
            _context43.next = 63;
            break;
          }

          _context43.next = 63;
          return this.handleLongpoll(lpid);

        case 63:
          _context43.next = 65;
          return this.createTemplate(maxVersion, coinbase, rules);

        case 65:
          return _context43.abrupt('return', _context43.sent);

        case 66:
        case 'end':
          return _context43.stop();
      }
    }
  }, getBlockTemplate, this, [[22, 27]]);
}));

RPC.prototype.createTemplate = co( /*#__PURE__*/_regenerator2.default.mark(function createTemplate(maxVersion, coinbase, rules) {
  var unlock;
  return _regenerator2.default.wrap(function createTemplate$(_context44) {
    while (1) {
      switch (_context44.prev = _context44.next) {
        case 0:
          _context44.next = 2;
          return this.locker.lock();

        case 2:
          unlock = _context44.sent;
          _context44.prev = 3;
          _context44.next = 6;
          return this._createTemplate(maxVersion, coinbase, rules);

        case 6:
          return _context44.abrupt('return', _context44.sent);

        case 7:
          _context44.prev = 7;

          unlock();
          return _context44.finish(7);

        case 10:
        case 'end':
          return _context44.stop();
      }
    }
  }, createTemplate, this, [[3,, 7, 10]]);
}));

RPC.prototype._createTemplate = co( /*#__PURE__*/_regenerator2.default.mark(function _createTemplate(maxVersion, coinbase, rules) {
  var attempt, version, scale, mutable, txs, index, vbavailable, vbrules, i, j, entry, tx, input, output, dep, deps, json, name, deploy, state;
  return _regenerator2.default.wrap(function _createTemplate$(_context45) {
    while (1) {
      switch (_context45.prev = _context45.next) {
        case 0:
          _context45.next = 2;
          return this.getTemplate();

        case 2:
          attempt = _context45.sent;
          version = attempt.version;
          scale = attempt.witness ? 1 : consensus.WITNESS_SCALE_FACTOR;
          mutable = ['time', 'transactions', 'prevblock'];
          txs = [];
          index = {};
          vbavailable = {};
          vbrules = [];


          // The miner doesn't support
          // versionbits. Force them to
          // encode our version.
          if (maxVersion >= 2) mutable.push('version/force');

          // Allow the miner to change
          // our provided coinbase.
          // Note that these are implied
          // without `coinbasetxn`.
          if (coinbase) {
            mutable.push('coinbase');
            mutable.push('coinbase/append');
            mutable.push('generation');
          }

          // Build an index of every transaction.
          for (i = 0; i < attempt.items.length; i++) {
            entry = attempt.items[i];
            index[entry.hash] = i + 1;
          }

          // Calculate dependencies for each transaction.
          i = 0;

        case 14:
          if (!(i < attempt.items.length)) {
            _context45.next = 32;
            break;
          }

          entry = attempt.items[i];
          tx = entry.tx;
          deps = [];

          j = 0;

        case 19:
          if (!(j < tx.inputs.length)) {
            _context45.next = 28;
            break;
          }

          input = tx.inputs[j];
          dep = index[input.prevout.hash];

          if (!(dep == null)) {
            _context45.next = 24;
            break;
          }

          return _context45.abrupt('continue', 25);

        case 24:

          if (deps.indexOf(dep) === -1) {
            assert(dep < i + 1);
            deps.push(dep);
          }

        case 25:
          j++;
          _context45.next = 19;
          break;

        case 28:

          txs.push({
            data: tx.toRaw().toString('hex'),
            txid: tx.txid(),
            hash: tx.wtxid(),
            depends: deps,
            fee: entry.fee,
            sigops: entry.sigops / scale | 0,
            weight: tx.getWeight()
          });

        case 29:
          i++;
          _context45.next = 14;
          break;

        case 32:
          i = 0;

        case 33:
          if (!(i < this.network.deploys.length)) {
            _context45.next = 58;
            break;
          }

          deploy = this.network.deploys[i];
          _context45.next = 37;
          return this.chain.getState(this.chain.tip, deploy);

        case 37:
          state = _context45.sent;

          name = deploy.name;

          _context45.t0 = state;
          _context45.next = _context45.t0 === common.thresholdStates.DEFINED ? 42 : _context45.t0 === common.thresholdStates.FAILED ? 42 : _context45.t0 === common.thresholdStates.LOCKED_IN ? 43 : _context45.t0 === common.thresholdStates.STARTED ? 44 : _context45.t0 === common.thresholdStates.ACTIVE ? 47 : 53;
          break;

        case 42:
          return _context45.abrupt('break', 55);

        case 43:
          version |= 1 << deploy.bit;

        case 44:
          if (!deploy.force) {
            if (!rules || rules.indexOf(name) === -1) version &= ~(1 << deploy.bit);
            name = '!' + name;
          }
          vbavailable[name] = deploy.bit;
          return _context45.abrupt('break', 55);

        case 47:
          if (deploy.force) {
            _context45.next = 51;
            break;
          }

          if (!(!rules || rules.indexOf(name) === -1)) {
            _context45.next = 50;
            break;
          }

          throw new RPCError(errs.INVALID_PARAMETER, 'Client must support ' + name + '.');

        case 50:
          name = '!' + name;

        case 51:
          vbrules.push(name);
          return _context45.abrupt('break', 55);

        case 53:
          assert(false, 'Bad state.');
          return _context45.abrupt('break', 55);

        case 55:
          i++;
          _context45.next = 33;
          break;

        case 58:

          version >>>= 0;

          json = {
            capabilities: ['proposal'],
            mutable: mutable,
            version: version,
            rules: vbrules,
            vbavailable: vbavailable,
            vbrequired: 0,
            height: attempt.height,
            previousblockhash: util.revHex(attempt.prevBlock),
            target: util.revHex(attempt.target.toString('hex')),
            bits: util.hex32(attempt.bits),
            noncerange: '00000000ffffffff',
            curtime: attempt.ts,
            mintime: attempt.mtp + 1,
            maxtime: attempt.ts + 7200,
            expires: attempt.ts + 7200,
            sigoplimit: consensus.MAX_BLOCK_SIGOPS_COST / scale | 0,
            sizelimit: consensus.MAX_BLOCK_SIZE,
            weightlimit: undefined,
            longpollid: this.chain.tip.rhash() + util.pad32(this.totalTX()),
            submitold: false,
            coinbaseaux: {
              flags: attempt.coinbaseFlags.toString('hex')
            },
            coinbasevalue: undefined,
            coinbasetxn: undefined,
            default_witness_commitment: undefined,
            transactions: txs
          };

          // See:
          // bitcoin/bitcoin#9fc7f0bce94f1cea0239b1543227f22a3f3b9274
          if (attempt.witness) {
            json.sizelimit = consensus.MAX_RAW_BLOCK_SIZE;
            json.weightlimit = consensus.MAX_BLOCK_WEIGHT;
          }

          // The client wants a coinbasetxn
          // instead of a coinbasevalue.
          if (coinbase) {
            tx = attempt.toCoinbase();

            // Pop off the nonces.
            tx.inputs[0].script.code.pop();
            tx.inputs[0].script.compile();

            if (attempt.witness) {
              // We don't include the commitment
              // output (see bip145).
              output = tx.outputs.pop();
              assert(output.script.isCommitment());

              // Also not including the witness nonce.
              tx.inputs[0].witness.length = 0;
              tx.inputs[0].witness.compile();

              tx.refresh();
            }

            json.coinbasetxn = {
              data: tx.toRaw().toString('hex'),
              txid: tx.txid(),
              hash: tx.wtxid(),
              depends: [],
              fee: 0,
              sigops: tx.getSigopsCost() / scale | 0,
              weight: tx.getWeight()
            };
          } else {
            json.coinbasevalue = attempt.getReward();
          }

          if (rules && rules.indexOf('segwit') !== -1) json.default_witness_commitment = attempt.getWitnessScript().toJSON();

          return _context45.abrupt('return', json);

        case 64:
        case 'end':
          return _context45.stop();
      }
    }
  }, _createTemplate, this);
}));

RPC.prototype.getMiningInfo = co( /*#__PURE__*/_regenerator2.default.mark(function getMiningInfo(args, help) {
  var attempt, size, weight, txs, diff, i, item;
  return _regenerator2.default.wrap(function getMiningInfo$(_context46) {
    while (1) {
      switch (_context46.prev = _context46.next) {
        case 0:
          attempt = this.attempt;
          size = 0;
          weight = 0;
          txs = 0;
          diff = 0;

          if (!(help || args.length !== 0)) {
            _context46.next = 7;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getmininginfo');

        case 7:

          if (attempt) {
            weight = attempt.weight;
            txs = attempt.items.length + 1;
            diff = attempt.getDifficulty();
            size = 1000;
            for (i = 0; i < attempt.items.length; i++) {
              item = attempt.items[i];
              size += item.tx.getBaseSize();
            }
          }

          _context46.t0 = this.chain.height;
          _context46.t1 = size;
          _context46.t2 = weight;
          _context46.t3 = txs;
          _context46.t4 = diff;
          _context46.t5 = this.procLimit;
          _context46.next = 16;
          return this.getHashRate(120);

        case 16:
          _context46.t6 = _context46.sent;
          _context46.t7 = this.totalTX();
          _context46.t8 = this.network !== Network.main;
          _context46.t9 = this.network.type !== 'testnet' ? this.network.type : 'test';
          _context46.t10 = this.mining;
          return _context46.abrupt('return', {
            blocks: _context46.t0,
            currentblocksize: _context46.t1,
            currentblockweight: _context46.t2,
            currentblocktx: _context46.t3,
            difficulty: _context46.t4,
            errors: '',
            genproclimit: _context46.t5,
            networkhashps: _context46.t6,
            pooledtx: _context46.t7,
            testnet: _context46.t8,
            chain: _context46.t9,
            generate: _context46.t10
          });

        case 22:
        case 'end':
          return _context46.stop();
      }
    }
  }, getMiningInfo, this);
}));

RPC.prototype.getNetworkHashPS = co( /*#__PURE__*/_regenerator2.default.mark(function getNetworkHashPS(args, help) {
  var valid, lookup, height;
  return _regenerator2.default.wrap(function getNetworkHashPS$(_context47) {
    while (1) {
      switch (_context47.prev = _context47.next) {
        case 0:
          valid = new Validator([args]);
          lookup = valid.u32(0, 120);
          height = valid.u32(1);

          if (!(help || args.length > 2)) {
            _context47.next = 5;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getnetworkhashps ( blocks height )');

        case 5:
          _context47.next = 7;
          return this.getHashRate(lookup, height);

        case 7:
          return _context47.abrupt('return', _context47.sent);

        case 8:
        case 'end':
          return _context47.stop();
      }
    }
  }, getNetworkHashPS, this);
}));

RPC.prototype.prioritiseTransaction = co( /*#__PURE__*/_regenerator2.default.mark(function prioritiseTransaction(args, help) {
  var valid, hash, pri, fee, entry;
  return _regenerator2.default.wrap(function prioritiseTransaction$(_context48) {
    while (1) {
      switch (_context48.prev = _context48.next) {
        case 0:
          valid = new Validator([args]);
          hash = valid.hash(0);
          pri = valid.num(1);
          fee = valid.i64(2);

          if (!(help || args.length !== 3)) {
            _context48.next = 6;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'prioritisetransaction <txid> <priority delta> <fee delta>');

        case 6:
          if (this.mempool) {
            _context48.next = 8;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'No mempool available.');

        case 8:
          if (hash) {
            _context48.next = 10;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid TXID');

        case 10:
          if (!(pri == null || fee == null)) {
            _context48.next = 12;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid fee or priority.');

        case 12:

          entry = this.mempool.getEntry(hash);

          if (entry) {
            _context48.next = 15;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'Transaction not in mempool.');

        case 15:

          this.mempool.prioritise(entry, pri, fee);

          return _context48.abrupt('return', true);

        case 17:
        case 'end':
          return _context48.stop();
      }
    }
  }, prioritiseTransaction, this);
}));

RPC.prototype.verifyBlock = co( /*#__PURE__*/_regenerator2.default.mark(function verifyBlock(args, help) {
  var valid, data, block;
  return _regenerator2.default.wrap(function verifyBlock$(_context49) {
    while (1) {
      switch (_context49.prev = _context49.next) {
        case 0:
          valid = new Validator([args]);
          data = valid.buf(0);

          if (!(help || args.length !== 1)) {
            _context49.next = 4;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'verifyblock "block-hex"');

        case 4:
          if (data) {
            _context49.next = 6;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid block hex.');

        case 6:
          if (!this.chain.options.spv) {
            _context49.next = 8;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'Cannot verify block in SPV mode.');

        case 8:

          block = Block.fromRaw(data);

          _context49.prev = 9;
          _context49.next = 12;
          return this.chain.verifyBlock(block);

        case 12:
          _context49.next = 19;
          break;

        case 14:
          _context49.prev = 14;
          _context49.t0 = _context49['catch'](9);

          if (!(_context49.t0.type === 'VerifyError')) {
            _context49.next = 18;
            break;
          }

          return _context49.abrupt('return', _context49.t0.reason);

        case 18:
          throw _context49.t0;

        case 19:
          return _context49.abrupt('return', null);

        case 20:
        case 'end':
          return _context49.stop();
      }
    }
  }, verifyBlock, this, [[9, 14]]);
}));

/*
 * Coin generation
 */

RPC.prototype.getGenerate = co( /*#__PURE__*/_regenerator2.default.mark(function getGenerate(args, help) {
  return _regenerator2.default.wrap(function getGenerate$(_context50) {
    while (1) {
      switch (_context50.prev = _context50.next) {
        case 0:
          if (!(help || args.length !== 0)) {
            _context50.next = 2;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getgenerate');

        case 2:
          return _context50.abrupt('return', this.mining);

        case 3:
        case 'end':
          return _context50.stop();
      }
    }
  }, getGenerate, this);
}));

RPC.prototype.setGenerate = co( /*#__PURE__*/_regenerator2.default.mark(function setGenerate(args, help) {
  var valid, mine, limit;
  return _regenerator2.default.wrap(function setGenerate$(_context51) {
    while (1) {
      switch (_context51.prev = _context51.next) {
        case 0:
          valid = new Validator([args]);
          mine = valid.bool(0, false);
          limit = valid.u32(1, 0);

          if (!(help || args.length < 1 || args.length > 2)) {
            _context51.next = 5;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'setgenerate mine ( proclimit )');

        case 5:
          if (!(mine && this.miner.addresses.length === 0)) {
            _context51.next = 7;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'No addresses available for coinbase.');

        case 7:

          this.mining = mine;
          this.procLimit = limit;

          if (!mine) {
            _context51.next = 12;
            break;
          }

          this.miner.cpu.start();
          return _context51.abrupt('return', true);

        case 12:
          _context51.next = 14;
          return this.miner.cpu.stop();

        case 14:
          return _context51.abrupt('return', false);

        case 15:
        case 'end':
          return _context51.stop();
      }
    }
  }, setGenerate, this);
}));

RPC.prototype.generate = co( /*#__PURE__*/_regenerator2.default.mark(function generate(args, help) {
  var valid, blocks, tries;
  return _regenerator2.default.wrap(function generate$(_context52) {
    while (1) {
      switch (_context52.prev = _context52.next) {
        case 0:
          valid = new Validator([args]);
          blocks = valid.u32(0, 1);
          tries = valid.u32(1);

          if (!(help || args.length < 1 || args.length > 2)) {
            _context52.next = 5;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'generate numblocks ( maxtries )');

        case 5:
          if (!(this.miner.addresses.length === 0)) {
            _context52.next = 7;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'No addresses available for coinbase.');

        case 7:
          _context52.next = 9;
          return this.mineBlocks(blocks, null, tries);

        case 9:
          return _context52.abrupt('return', _context52.sent);

        case 10:
        case 'end':
          return _context52.stop();
      }
    }
  }, generate, this);
}));

RPC.prototype.generateToAddress = co( /*#__PURE__*/_regenerator2.default.mark(function _generateToAddress(args, help) {
  var valid, blocks, addr, tries;
  return _regenerator2.default.wrap(function _generateToAddress$(_context53) {
    while (1) {
      switch (_context53.prev = _context53.next) {
        case 0:
          valid = new Validator([args]);
          blocks = valid.u32(0, 1);
          addr = valid.str(1, '');
          tries = valid.u32(2);

          if (!(help || args.length < 2 || args.length > 3)) {
            _context53.next = 6;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'generatetoaddress numblocks address ( maxtries )');

        case 6:

          addr = parseAddress(addr, this.network);

          _context53.next = 9;
          return this.mineBlocks(blocks, addr, tries);

        case 9:
          return _context53.abrupt('return', _context53.sent);

        case 10:
        case 'end':
          return _context53.stop();
      }
    }
  }, _generateToAddress, this);
}));

/*
 * Raw transactions
 */

RPC.prototype.createRawTransaction = co( /*#__PURE__*/_regenerator2.default.mark(function createRawTransaction(args, help) {
  var valid, inputs, sendTo, locktime, i, tx, input, output, hash, index, sequence, keys, addrs, key, value, address, b58;
  return _regenerator2.default.wrap(function createRawTransaction$(_context54) {
    while (1) {
      switch (_context54.prev = _context54.next) {
        case 0:
          valid = new Validator([args]);
          inputs = valid.array(0);
          sendTo = valid.obj(1);
          locktime = valid.u32(2);

          if (!(help || args.length < 2 || args.length > 3)) {
            _context54.next = 6;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'createrawtransaction' + ' [{"txid":"id","vout":n},...]' + ' {"address":amount,"data":"hex",...}' + ' ( locktime )');

        case 6:
          if (!(!inputs || !sendTo)) {
            _context54.next = 8;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid parameters (inputs and sendTo).');

        case 8:

          tx = new MTX();

          if (locktime != null) tx.locktime = locktime;

          i = 0;

        case 11:
          if (!(i < inputs.length)) {
            _context54.next = 28;
            break;
          }

          input = inputs[i];
          valid = new Validator([input]);

          hash = valid.hash('txid');
          index = valid.u32('vout');
          sequence = valid.u32('sequence', 0xffffffff);

          if (tx.locktime) sequence--;

          if (!(!hash || index == null)) {
            _context54.next = 20;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid outpoint.');

        case 20:

          input = new Input();
          input.prevout.hash = hash;
          input.prevout.index = index;
          input.sequence = sequence;

          tx.inputs.push(input);

        case 25:
          i++;
          _context54.next = 11;
          break;

        case 28:

          keys = (0, _keys2.default)(sendTo);
          valid = new Validator([sendTo]);
          addrs = {};

          i = 0;

        case 32:
          if (!(i < keys.length)) {
            _context54.next = 58;
            break;
          }

          key = keys[i];

          if (!(key === 'data')) {
            _context54.next = 43;
            break;
          }

          value = valid.buf(key);

          if (value) {
            _context54.next = 38;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid nulldata..');

        case 38:

          output = new Output();
          output.value = 0;
          output.script.fromNulldata(value);
          tx.outputs.push(output);

          return _context54.abrupt('continue', 55);

        case 43:

          address = parseAddress(key, this.network);
          b58 = address.toString(this.network);

          if (!addrs[b58]) {
            _context54.next = 47;
            break;
          }

          throw new RPCError(errs.INVALID_PARAMETER, 'Duplicate address');

        case 47:

          addrs[b58] = true;

          value = valid.btc(key);

          if (!(value == null)) {
            _context54.next = 51;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid output value.');

        case 51:

          output = new Output();
          output.value = value;
          output.script.fromAddress(address);

          tx.outputs.push(output);

        case 55:
          i++;
          _context54.next = 32;
          break;

        case 58:
          return _context54.abrupt('return', tx.toRaw().toString('hex'));

        case 59:
        case 'end':
          return _context54.stop();
      }
    }
  }, createRawTransaction, this);
}));

RPC.prototype.decodeRawTransaction = co( /*#__PURE__*/_regenerator2.default.mark(function decodeRawTransaction(args, help) {
  var valid, data, tx;
  return _regenerator2.default.wrap(function decodeRawTransaction$(_context55) {
    while (1) {
      switch (_context55.prev = _context55.next) {
        case 0:
          valid = new Validator([args]);
          data = valid.buf(0);

          if (!(help || args.length !== 1)) {
            _context55.next = 4;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'decoderawtransaction "hexstring"');

        case 4:
          if (data) {
            _context55.next = 6;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid hex string.');

        case 6:

          tx = TX.fromRaw(data);

          return _context55.abrupt('return', this.txToJSON(tx));

        case 8:
        case 'end':
          return _context55.stop();
      }
    }
  }, decodeRawTransaction, this);
}));

RPC.prototype.decodeScript = co( /*#__PURE__*/_regenerator2.default.mark(function decodeScript(args, help) {
  var valid, data, script, address;
  return _regenerator2.default.wrap(function decodeScript$(_context56) {
    while (1) {
      switch (_context56.prev = _context56.next) {
        case 0:
          valid = new Validator([args]);
          data = valid.buf(0);

          if (!(help || args.length !== 1)) {
            _context56.next = 4;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'decodescript "hex"');

        case 4:

          script = new Script();

          if (data) script = Script.fromRaw(data);

          address = Address.fromScripthash(script.hash160());

          script = this.scriptToJSON(script);
          script.p2sh = address.toString(this.network);

          return _context56.abrupt('return', script);

        case 10:
        case 'end':
          return _context56.stop();
      }
    }
  }, decodeScript, this);
}));

RPC.prototype.getRawTransaction = co( /*#__PURE__*/_regenerator2.default.mark(function getRawTransaction(args, help) {
  var valid, hash, verbose, json, meta, tx, entry;
  return _regenerator2.default.wrap(function getRawTransaction$(_context57) {
    while (1) {
      switch (_context57.prev = _context57.next) {
        case 0:
          valid = new Validator([args]);
          hash = valid.hash(0);
          verbose = valid.bool(1, false);

          if (!(help || args.length < 1 || args.length > 2)) {
            _context57.next = 5;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getrawtransaction "txid" ( verbose )');

        case 5:
          if (hash) {
            _context57.next = 7;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid TXID.');

        case 7:
          _context57.next = 9;
          return this.node.getMeta(hash);

        case 9:
          meta = _context57.sent;

          if (meta) {
            _context57.next = 12;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'Transaction not found.');

        case 12:

          tx = meta.tx;

          if (verbose) {
            _context57.next = 15;
            break;
          }

          return _context57.abrupt('return', tx.toRaw().toString('hex'));

        case 15:
          if (!meta.block) {
            _context57.next = 19;
            break;
          }

          _context57.next = 18;
          return this.chain.db.getEntry(meta.block);

        case 18:
          entry = _context57.sent;

        case 19:

          json = this.txToJSON(tx, entry);
          json.time = meta.ps;
          json.hex = tx.toRaw().toString('hex');

          return _context57.abrupt('return', json);

        case 23:
        case 'end':
          return _context57.stop();
      }
    }
  }, getRawTransaction, this);
}));

RPC.prototype.sendRawTransaction = co( /*#__PURE__*/_regenerator2.default.mark(function sendRawTransaction(args, help) {
  var valid, data, tx;
  return _regenerator2.default.wrap(function sendRawTransaction$(_context58) {
    while (1) {
      switch (_context58.prev = _context58.next) {
        case 0:
          valid = new Validator([args]);
          data = valid.buf(0);

          if (!(help || args.length < 1 || args.length > 2)) {
            _context58.next = 4;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'sendrawtransaction "hexstring" ( allowhighfees )');

        case 4:
          if (data) {
            _context58.next = 6;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid hex string.');

        case 6:

          tx = TX.fromRaw(data);

          this.node.relay(tx);

          return _context58.abrupt('return', tx.txid());

        case 9:
        case 'end':
          return _context58.stop();
      }
    }
  }, sendRawTransaction, this);
}));

RPC.prototype.signRawTransaction = co( /*#__PURE__*/_regenerator2.default.mark(function signRawTransaction(args, help) {
  var valid, data, prevout, secrets, sighash, type, keys, map, i, j, tx, secret, key, coin, hash, index, script, value, prev, redeem, op, parts;
  return _regenerator2.default.wrap(function signRawTransaction$(_context59) {
    while (1) {
      switch (_context59.prev = _context59.next) {
        case 0:
          valid = new Validator([args]);
          data = valid.buf(0);
          prevout = valid.array(1);
          secrets = valid.array(2);
          sighash = valid.str(3);
          type = Script.hashType.ALL;
          keys = [];
          map = {};

          if (!(help || args.length < 1 || args.length > 4)) {
            _context59.next = 10;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'signrawtransaction' + ' "hexstring" (' + ' [{"txid":"id","vout":n,"scriptPubKey":"hex",' + 'redeemScript":"hex"},...] ["privatekey1",...]' + ' sighashtype )');

        case 10:
          if (data) {
            _context59.next = 12;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid hex string.');

        case 12:
          if (this.mempool) {
            _context59.next = 14;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'No mempool available.');

        case 14:

          tx = MTX.fromRaw(data);
          _context59.next = 17;
          return this.mempool.getSpentView(tx);

        case 17:
          tx.view = _context59.sent;


          if (secrets) {
            valid = new Validator([secrets]);
            for (i = 0; i < secrets.length; i++) {
              secret = valid.str(i, '');
              key = parseSecret(secret, this.network);
              map[key.getPublicKey('hex')] = key;
              keys.push(key);
            }
          }

          if (!prevout) {
            _context59.next = 60;
            break;
          }

          i = 0;

        case 21:
          if (!(i < prevout.length)) {
            _context59.next = 60;
            break;
          }

          prev = prevout[i];
          valid = new Validator([prev]);
          hash = valid.hash('txid');
          index = valid.u32('index');
          script = valid.buf('scriptPubKey');
          value = valid.btc('amount');
          redeem = valid.buf('redeemScript');

          if (!(!hash || index == null || !script || value == null)) {
            _context59.next = 31;
            break;
          }

          throw new RPCError(errs.INVALID_PARAMETER, 'Invalid UTXO.');

        case 31:

          script = Script.fromRaw(script);

          coin = new Output();
          coin.script = script;
          coin.value = value;

          tx.view.addOutput(hash, index, coin);

          if (!(keys.length === 0 || !redeem)) {
            _context59.next = 38;
            break;
          }

          return _context59.abrupt('continue', 57);

        case 38:
          if (!(!script.isScripthash() && !script.isWitnessScripthash())) {
            _context59.next = 40;
            break;
          }

          return _context59.abrupt('continue', 57);

        case 40:
          if (redeem) {
            _context59.next = 42;
            break;
          }

          throw new RPCError(errs.INVALID_PARAMETER, 'P2SH requires redeem script.');

        case 42:

          redeem = Script.fromRaw(redeem);

          j = 0;

        case 44:
          if (!(j < redeem.code.length)) {
            _context59.next = 57;
            break;
          }

          op = redeem.code[j];

          if (op.data) {
            _context59.next = 48;
            break;
          }

          return _context59.abrupt('continue', 54);

        case 48:

          key = map[op.data.toString('hex')];

          if (!key) {
            _context59.next = 54;
            break;
          }

          key.script = redeem;
          key.witness = script.isWitnessScripthash();
          key.refresh();
          return _context59.abrupt('break', 57);

        case 54:
          j++;
          _context59.next = 44;
          break;

        case 57:
          i++;
          _context59.next = 21;
          break;

        case 60:
          if (!sighash) {
            _context59.next = 71;
            break;
          }

          parts = sighash.split('|');
          type = Script.hashType[parts[0]];

          if (!(type == null)) {
            _context59.next = 65;
            break;
          }

          throw new RPCError(errs.INVALID_PARAMETER, 'Invalid sighash type.');

        case 65:
          if (!(parts.length > 2)) {
            _context59.next = 67;
            break;
          }

          throw new RPCError(errs.INVALID_PARAMETER, 'Invalid sighash type.');

        case 67:
          if (!(parts.length === 2)) {
            _context59.next = 71;
            break;
          }

          if (!(parts[1] !== 'ANYONECANPAY')) {
            _context59.next = 70;
            break;
          }

          throw new RPCError(errs.INVALID_PARAMETER, 'Invalid sighash type.');

        case 70:
          type |= Script.hashType.ANYONECANPAY;

        case 71:
          _context59.next = 73;
          return tx.signAsync(keys, type);

        case 73:
          return _context59.abrupt('return', {
            hex: tx.toRaw().toString('hex'),
            complete: tx.isSigned()
          });

        case 74:
        case 'end':
          return _context59.stop();
      }
    }
  }, signRawTransaction, this);
}));

/*
 * Utility Functions
 */

RPC.prototype.createMultisig = co( /*#__PURE__*/_regenerator2.default.mark(function createMultisig(args, help) {
  var valid, keys, m, n, i, script, key, address;
  return _regenerator2.default.wrap(function createMultisig$(_context60) {
    while (1) {
      switch (_context60.prev = _context60.next) {
        case 0:
          valid = new Validator([args]);
          keys = valid.array(1, []);
          m = valid.u32(0, 0);
          n = keys.length;

          if (!(help || args.length < 2 || args.length > 2)) {
            _context60.next = 6;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'createmultisig nrequired ["key",...]');

        case 6:
          if (!(m < 1 || n < m || n > 16)) {
            _context60.next = 8;
            break;
          }

          throw new RPCError(errs.INVALID_PARAMETER, 'Invalid m and n values.');

        case 8:

          valid = new Validator([keys]);

          i = 0;

        case 10:
          if (!(i < keys.length)) {
            _context60.next = 20;
            break;
          }

          key = valid.buf(i);

          if (key) {
            _context60.next = 14;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid key.');

        case 14:
          if (ec.publicKeyVerify(key)) {
            _context60.next = 16;
            break;
          }

          throw new RPCError(errs.INVALID_ADDRESS_OR_KEY, 'Invalid key.');

        case 16:

          keys[i] = key;

        case 17:
          i++;
          _context60.next = 10;
          break;

        case 20:

          script = Script.fromMultisig(m, n, keys);

          if (!(script.getSize() > consensus.MAX_SCRIPT_PUSH)) {
            _context60.next = 23;
            break;
          }

          throw new RPCError(errs.VERIFY_ERROR, 'Redeem script exceeds size limit.');

        case 23:

          address = script.getAddress();

          return _context60.abrupt('return', {
            address: address.toString(this.network),
            redeemScript: script.toJSON()
          });

        case 25:
        case 'end':
          return _context60.stop();
      }
    }
  }, createMultisig, this);
}));

RPC.prototype.createWitnessAddress = co( /*#__PURE__*/_regenerator2.default.mark(function createWitnessAddress(args, help) {
  var valid, raw, script, program, address;
  return _regenerator2.default.wrap(function createWitnessAddress$(_context61) {
    while (1) {
      switch (_context61.prev = _context61.next) {
        case 0:
          valid = new Validator([args]);
          raw = valid.buf(0);

          if (!(help || args.length !== 1)) {
            _context61.next = 4;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'createwitnessaddress "script"');

        case 4:
          if (raw) {
            _context61.next = 6;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid script hex.');

        case 6:

          script = Script.fromRaw(raw);
          program = script.forWitness();
          address = program.getAddress();

          return _context61.abrupt('return', {
            address: address.toString(this.network),
            witnessScript: program.toJSON()
          });

        case 10:
        case 'end':
          return _context61.stop();
      }
    }
  }, createWitnessAddress, this);
}));

RPC.prototype.validateAddress = co( /*#__PURE__*/_regenerator2.default.mark(function validateAddress(args, help) {
  var valid, b58, address, script;
  return _regenerator2.default.wrap(function validateAddress$(_context62) {
    while (1) {
      switch (_context62.prev = _context62.next) {
        case 0:
          valid = new Validator([args]);
          b58 = valid.str(0, '');

          if (!(help || args.length !== 1)) {
            _context62.next = 4;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'validateaddress "bitcoinaddress"');

        case 4:
          _context62.prev = 4;

          address = Address.fromString(b58, this.network);
          _context62.next = 11;
          break;

        case 8:
          _context62.prev = 8;
          _context62.t0 = _context62['catch'](4);
          return _context62.abrupt('return', {
            isvalid: false
          });

        case 11:

          script = Script.fromAddress(address);

          return _context62.abrupt('return', {
            isvalid: true,
            address: address.toString(this.network),
            scriptPubKey: script.toJSON(),
            ismine: false,
            iswatchonly: false
          });

        case 13:
        case 'end':
          return _context62.stop();
      }
    }
  }, validateAddress, this, [[4, 8]]);
}));

RPC.prototype.verifyMessage = co( /*#__PURE__*/_regenerator2.default.mark(function verifyMessage(args, help) {
  var valid, b58, sig, msg, addr, key;
  return _regenerator2.default.wrap(function verifyMessage$(_context63) {
    while (1) {
      switch (_context63.prev = _context63.next) {
        case 0:
          valid = new Validator([args]);
          b58 = valid.str(0, '');
          sig = valid.buf(1, null, 'base64');
          msg = valid.str(2);

          if (!(help || args.length !== 3)) {
            _context63.next = 6;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'verifymessage "bitcoinaddress" "signature" "message"');

        case 6:
          if (!(!sig || !msg)) {
            _context63.next = 8;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid parameters.');

        case 8:

          addr = parseAddress(b58, this.network);

          msg = Buffer.from(MAGIC_STRING + msg, 'utf8');
          msg = crypto.hash256(msg);

          key = ec.recover(msg, sig, 0, true);

          if (key) {
            _context63.next = 14;
            break;
          }

          return _context63.abrupt('return', false);

        case 14:

          key = crypto.hash160(key);

          return _context63.abrupt('return', crypto.ccmp(key, addr.hash));

        case 16:
        case 'end':
          return _context63.stop();
      }
    }
  }, verifyMessage, this);
}));

RPC.prototype.signMessageWithPrivkey = co( /*#__PURE__*/_regenerator2.default.mark(function signMessageWithPrivkey(args, help) {
  var valid, key, msg, sig;
  return _regenerator2.default.wrap(function signMessageWithPrivkey$(_context64) {
    while (1) {
      switch (_context64.prev = _context64.next) {
        case 0:
          valid = new Validator([args]);
          key = valid.str(0, '');
          msg = valid.str(1, '');

          if (!(help || args.length !== 2)) {
            _context64.next = 5;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'signmessagewithprivkey "privkey" "message"');

        case 5:

          key = parseSecret(key, this.network);
          msg = Buffer.from(MAGIC_STRING + msg, 'utf8');
          msg = crypto.hash256(msg);

          sig = key.sign(msg);

          return _context64.abrupt('return', sig.toString('base64'));

        case 10:
        case 'end':
          return _context64.stop();
      }
    }
  }, signMessageWithPrivkey, this);
}));

RPC.prototype.estimateFee = co( /*#__PURE__*/_regenerator2.default.mark(function estimateFee(args, help) {
  var valid, blocks, fee;
  return _regenerator2.default.wrap(function estimateFee$(_context65) {
    while (1) {
      switch (_context65.prev = _context65.next) {
        case 0:
          valid = new Validator([args]);
          blocks = valid.u32(0, 1);

          if (!(help || args.length !== 1)) {
            _context65.next = 4;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'estimatefee nblocks');

        case 4:
          if (this.fees) {
            _context65.next = 6;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'Fee estimation not available.');

        case 6:

          if (blocks < 1) blocks = 1;

          fee = this.fees.estimateFee(blocks, false);

          if (!(fee === 0)) {
            _context65.next = 10;
            break;
          }

          return _context65.abrupt('return', -1);

        case 10:
          return _context65.abrupt('return', Amount.btc(fee, true));

        case 11:
        case 'end':
          return _context65.stop();
      }
    }
  }, estimateFee, this);
}));

RPC.prototype.estimatePriority = co( /*#__PURE__*/_regenerator2.default.mark(function estimatePriority(args, help) {
  var valid, blocks;
  return _regenerator2.default.wrap(function estimatePriority$(_context66) {
    while (1) {
      switch (_context66.prev = _context66.next) {
        case 0:
          valid = new Validator([args]);
          blocks = valid.u32(0, 1);

          if (!(help || args.length !== 1)) {
            _context66.next = 4;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'estimatepriority nblocks');

        case 4:
          if (this.fees) {
            _context66.next = 6;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'Priority estimation not available.');

        case 6:

          if (blocks < 1) blocks = 1;

          return _context66.abrupt('return', this.fees.estimatePriority(blocks, false));

        case 8:
        case 'end':
          return _context66.stop();
      }
    }
  }, estimatePriority, this);
}));

RPC.prototype.estimateSmartFee = co( /*#__PURE__*/_regenerator2.default.mark(function estimateSmartFee(args, help) {
  var valid, blocks, fee;
  return _regenerator2.default.wrap(function estimateSmartFee$(_context67) {
    while (1) {
      switch (_context67.prev = _context67.next) {
        case 0:
          valid = new Validator([args]);
          blocks = valid.u32(0, 1);

          if (!(help || args.length !== 1)) {
            _context67.next = 4;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'estimatesmartfee nblocks');

        case 4:
          if (this.fees) {
            _context67.next = 6;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'Fee estimation not available.');

        case 6:

          if (blocks < 1) blocks = 1;

          fee = this.fees.estimateFee(blocks, true);

          if (fee === 0) fee = -1;else fee = Amount.btc(fee, true);

          return _context67.abrupt('return', {
            fee: fee,
            blocks: blocks
          });

        case 10:
        case 'end':
          return _context67.stop();
      }
    }
  }, estimateSmartFee, this);
}));

RPC.prototype.estimateSmartPriority = co( /*#__PURE__*/_regenerator2.default.mark(function estimateSmartPriority(args, help) {
  var valid, blocks, pri;
  return _regenerator2.default.wrap(function estimateSmartPriority$(_context68) {
    while (1) {
      switch (_context68.prev = _context68.next) {
        case 0:
          valid = new Validator([args]);
          blocks = valid.u32(0, 1);

          if (!(help || args.length !== 1)) {
            _context68.next = 4;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'estimatesmartpriority nblocks');

        case 4:
          if (this.fees) {
            _context68.next = 6;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'Priority estimation not available.');

        case 6:

          if (blocks < 1) blocks = 1;

          pri = this.fees.estimatePriority(blocks, true);

          return _context68.abrupt('return', {
            priority: pri,
            blocks: blocks
          });

        case 9:
        case 'end':
          return _context68.stop();
      }
    }
  }, estimateSmartPriority, this);
}));

RPC.prototype.invalidateBlock = co( /*#__PURE__*/_regenerator2.default.mark(function invalidateBlock(args, help) {
  var valid, hash;
  return _regenerator2.default.wrap(function invalidateBlock$(_context69) {
    while (1) {
      switch (_context69.prev = _context69.next) {
        case 0:
          valid = new Validator([args]);
          hash = valid.hash(0);

          if (!(help || args.length !== 1)) {
            _context69.next = 4;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'invalidateblock "hash"');

        case 4:
          if (hash) {
            _context69.next = 6;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid block hash.');

        case 6:
          _context69.next = 8;
          return this.chain.invalidate(hash);

        case 8:
          return _context69.abrupt('return', null);

        case 9:
        case 'end':
          return _context69.stop();
      }
    }
  }, invalidateBlock, this);
}));

RPC.prototype.reconsiderBlock = co( /*#__PURE__*/_regenerator2.default.mark(function reconsiderBlock(args, help) {
  var valid, hash;
  return _regenerator2.default.wrap(function reconsiderBlock$(_context70) {
    while (1) {
      switch (_context70.prev = _context70.next) {
        case 0:
          valid = new Validator([args]);
          hash = valid.hash(0);

          if (!(help || args.length !== 1)) {
            _context70.next = 4;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'reconsiderblock "hash"');

        case 4:
          if (hash) {
            _context70.next = 6;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid block hash.');

        case 6:

          this.chain.removeInvalid(hash);

          return _context70.abrupt('return', null);

        case 8:
        case 'end':
          return _context70.stop();
      }
    }
  }, reconsiderBlock, this);
}));

RPC.prototype.setMockTime = co( /*#__PURE__*/_regenerator2.default.mark(function setMockTime(args, help) {
  var valid, ts, delta;
  return _regenerator2.default.wrap(function setMockTime$(_context71) {
    while (1) {
      switch (_context71.prev = _context71.next) {
        case 0:
          valid = new Validator([args]);
          ts = valid.u32(0);

          if (!(help || args.length !== 1)) {
            _context71.next = 4;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'setmocktime timestamp');

        case 4:
          if (!(ts == null)) {
            _context71.next = 6;
            break;
          }

          throw new RPCError(errs.TYPE_ERROR, 'Invalid timestamp.');

        case 6:

          this.network.time.offset = 0;

          delta = this.network.now() - ts;

          this.network.time.offset = -delta;

          return _context71.abrupt('return', null);

        case 10:
        case 'end':
          return _context71.stop();
      }
    }
  }, setMockTime, this);
}));

RPC.prototype.getMemoryInfo = co( /*#__PURE__*/_regenerator2.default.mark(function getMemoryInfo(args, help) {
  return _regenerator2.default.wrap(function getMemoryInfo$(_context72) {
    while (1) {
      switch (_context72.prev = _context72.next) {
        case 0:
          if (!(help || args.length !== 0)) {
            _context72.next = 2;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'getmemoryinfo');

        case 2:
          return _context72.abrupt('return', util.memoryUsage());

        case 3:
        case 'end':
          return _context72.stop();
      }
    }
  }, getMemoryInfo, this);
}));

RPC.prototype.setLogLevel = co( /*#__PURE__*/_regenerator2.default.mark(function setLogLevel(args, help) {
  var valid, level;
  return _regenerator2.default.wrap(function setLogLevel$(_context73) {
    while (1) {
      switch (_context73.prev = _context73.next) {
        case 0:
          valid = new Validator([args]);
          level = valid.str(0, '');

          if (!(help || args.length !== 1)) {
            _context73.next = 4;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'setloglevel "level"');

        case 4:

          this.logger.setLevel(level);

          return _context73.abrupt('return', null);

        case 6:
        case 'end':
          return _context73.stop();
      }
    }
  }, setLogLevel, this);
}));

/*
 * Helpers
 */

RPC.prototype.handleLongpoll = co( /*#__PURE__*/_regenerator2.default.mark(function handleLongpoll(lpid) {
  var watched, lastTX;
  return _regenerator2.default.wrap(function handleLongpoll$(_context74) {
    while (1) {
      switch (_context74.prev = _context74.next) {
        case 0:
          if (!(lpid.length !== 74)) {
            _context74.next = 2;
            break;
          }

          throw new RPCError(errs.INVALID_PARAMETER, 'Invalid longpoll ID.');

        case 2:

          watched = lpid.slice(0, 64);
          lastTX = +lpid.slice(64, 74);

          if (!(!util.isHex(watched) || !util.isNumber(lastTX) || lastTX < 0)) {
            _context74.next = 6;
            break;
          }

          throw new RPCError(errs.INVALID_PARAMETER, 'Invalid longpoll ID.');

        case 6:

          watched = util.revHex(watched);

          if (!(this.chain.tip.hash !== watched)) {
            _context74.next = 9;
            break;
          }

          return _context74.abrupt('return');

        case 9:
          _context74.next = 11;
          return this.longpoll();

        case 11:
        case 'end':
          return _context74.stop();
      }
    }
  }, handleLongpoll, this);
}));

RPC.prototype.longpoll = function longpoll() {
  var self = this;
  return new _promise2.default(function (resolve, reject) {
    self.pollers.push(co.job(resolve, reject));
  });
};

RPC.prototype.refreshBlock = function refreshBlock() {
  var pollers = this.pollers;
  var i, job;

  this.attempt = null;
  this.lastActivity = 0;
  this.merkleMap = {};
  this.nonce1 = 0;
  this.nonce2 = 0;
  this.pollers = [];

  for (i = 0; i < pollers.length; i++) {
    job = pollers[i];
    job.resolve();
  }
};

RPC.prototype.bindChain = function bindChain() {
  var self = this;

  if (this.boundChain) return;

  this.boundChain = true;

  this.node.on('connect', function () {
    if (!self.attempt) return;

    self.refreshBlock();
  });

  if (!this.mempool) return;

  this.node.on('tx', function () {
    if (!self.attempt) return;

    if (util.now() - self.lastActivity > 10) self.refreshBlock();
  });
};

RPC.prototype.getTemplate = co( /*#__PURE__*/_regenerator2.default.mark(function getTemplate() {
  var attempt;
  return _regenerator2.default.wrap(function getTemplate$(_context75) {
    while (1) {
      switch (_context75.prev = _context75.next) {
        case 0:
          attempt = this.attempt;


          this.bindChain();

          if (!attempt) {
            _context75.next = 6;
            break;
          }

          this.miner.updateTime(attempt);
          _context75.next = 11;
          break;

        case 6:
          _context75.next = 8;
          return this.miner.createBlock();

        case 8:
          attempt = _context75.sent;

          this.attempt = attempt;
          this.lastActivity = util.now();

        case 11:
          return _context75.abrupt('return', attempt);

        case 12:
        case 'end':
          return _context75.stop();
      }
    }
  }, getTemplate, this);
}));

RPC.prototype.updateWork = co( /*#__PURE__*/_regenerator2.default.mark(function updateWork() {
  var attempt, root, n1, n2;
  return _regenerator2.default.wrap(function updateWork$(_context76) {
    while (1) {
      switch (_context76.prev = _context76.next) {
        case 0:
          attempt = this.attempt;


          this.bindChain();

          if (!attempt) {
            _context76.next = 13;
            break;
          }

          if (!attempt.address.isNull()) {
            _context76.next = 5;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'No addresses available for coinbase.');

        case 5:

          this.miner.updateTime(attempt);

          if (++this.nonce2 === 0x100000000) {
            this.nonce2 = 0;
            this.nonce1++;
          }

          n1 = this.nonce1;
          n2 = this.nonce2;

          root = attempt.getRoot(n1, n2);
          root = root.toString('hex');

          this.merkleMap[root] = new Nonces(n1, n2);

          return _context76.abrupt('return', attempt);

        case 13:
          if (!(this.miner.addresses.length === 0)) {
            _context76.next = 15;
            break;
          }

          throw new RPCError(errs.MISC_ERROR, 'No addresses available for coinbase.');

        case 15:
          _context76.next = 17;
          return this.miner.createBlock();

        case 17:
          attempt = _context76.sent;


          n1 = this.nonce1;
          n2 = this.nonce2;

          root = attempt.getRoot(n1, n2);
          root = root.toString('hex');

          this.attempt = attempt;
          this.lastActivity = util.now();
          this.merkleMap[root] = new Nonces(n1, n2);

          return _context76.abrupt('return', attempt);

        case 26:
        case 'end':
          return _context76.stop();
      }
    }
  }, updateWork, this);
}));

RPC.prototype.addBlock = co( /*#__PURE__*/_regenerator2.default.mark(function addBlock(block) {
  var unlock1, unlock2;
  return _regenerator2.default.wrap(function addBlock$(_context77) {
    while (1) {
      switch (_context77.prev = _context77.next) {
        case 0:
          _context77.next = 2;
          return this.locker.lock();

        case 2:
          unlock1 = _context77.sent;
          _context77.next = 5;
          return this.chain.locker.lock();

        case 5:
          unlock2 = _context77.sent;
          _context77.prev = 6;
          _context77.next = 9;
          return this._addBlock(block);

        case 9:
          return _context77.abrupt('return', _context77.sent);

        case 10:
          _context77.prev = 10;

          unlock2();
          unlock1();
          return _context77.finish(10);

        case 14:
        case 'end':
          return _context77.stop();
      }
    }
  }, addBlock, this, [[6,, 10, 14]]);
}));

RPC.prototype._addBlock = co( /*#__PURE__*/_regenerator2.default.mark(function _addBlock(block) {
  var entry, prev, state, tx;
  return _regenerator2.default.wrap(function _addBlock$(_context78) {
    while (1) {
      switch (_context78.prev = _context78.next) {
        case 0:

          this.logger.info('Handling submitted block: %s.', block.rhash());

          _context78.next = 3;
          return this.chain.db.getEntry(block.prevBlock);

        case 3:
          prev = _context78.sent;

          if (!prev) {
            _context78.next = 9;
            break;
          }

          _context78.next = 7;
          return this.chain.getDeployments(block.ts, prev);

        case 7:
          state = _context78.sent;


          // Fix eloipool bug (witness nonce is not present).
          if (state.hasWitness() && block.getCommitmentHash()) {
            tx = block.txs[0];
            if (!tx.hasWitness()) {
              this.logger.warning('Submitted block had no witness nonce.');
              this.logger.debug(tx);

              // Recreate witness nonce (all zeroes).
              tx.inputs[0].witness.set(0, encoding.ZERO_HASH);
              tx.inputs[0].witness.compile();

              tx.refresh();
              block.refresh();
            }
          }

        case 9:
          _context78.prev = 9;
          _context78.next = 12;
          return this.chain._add(block);

        case 12:
          entry = _context78.sent;
          _context78.next = 21;
          break;

        case 15:
          _context78.prev = 15;
          _context78.t0 = _context78['catch'](9);

          if (!(_context78.t0.type === 'VerifyError')) {
            _context78.next = 20;
            break;
          }

          this.logger.warning('RPC block rejected: %s (%s).', block.rhash(), _context78.t0.reason);
          return _context78.abrupt('return', 'rejected: ' + _context78.t0.reason);

        case 20:
          throw _context78.t0;

        case 21:
          if (entry) {
            _context78.next = 24;
            break;
          }

          this.logger.warning('RPC block rejected: %s (bad-prevblk).', block.rhash());
          return _context78.abrupt('return', 'rejected: bad-prevblk');

        case 24:
          return _context78.abrupt('return', null);

        case 25:
        case 'end':
          return _context78.stop();
      }
    }
  }, _addBlock, this, [[9, 15]]);
}));

RPC.prototype.totalTX = function totalTX() {
  return this.mempool ? this.mempool.totalTX : 0;
};

RPC.prototype.getSoftforks = function getSoftforks() {
  return [toDeployment('bip34', 2, this.chain.state.hasBIP34()), toDeployment('bip66', 3, this.chain.state.hasBIP66()), toDeployment('bip65', 4, this.chain.state.hasCLTV())];
};

RPC.prototype.getBIP9Softforks = co( /*#__PURE__*/_regenerator2.default.mark(function getBIP9Softforks() {
  var tip, forks, i, deployment, state, status;
  return _regenerator2.default.wrap(function getBIP9Softforks$(_context79) {
    while (1) {
      switch (_context79.prev = _context79.next) {
        case 0:
          tip = this.chain.tip;
          forks = {};
          i = 0;

        case 3:
          if (!(i < this.network.deploys.length)) {
            _context79.next = 27;
            break;
          }

          deployment = this.network.deploys[i];
          _context79.next = 7;
          return this.chain.getState(tip, deployment);

        case 7:
          state = _context79.sent;
          _context79.t0 = state;
          _context79.next = _context79.t0 === common.thresholdStates.DEFINED ? 11 : _context79.t0 === common.thresholdStates.STARTED ? 13 : _context79.t0 === common.thresholdStates.LOCKED_IN ? 15 : _context79.t0 === common.thresholdStates.ACTIVE ? 17 : _context79.t0 === common.thresholdStates.FAILED ? 19 : 21;
          break;

        case 11:
          status = 'defined';
          return _context79.abrupt('break', 23);

        case 13:
          status = 'started';
          return _context79.abrupt('break', 23);

        case 15:
          status = 'locked_in';
          return _context79.abrupt('break', 23);

        case 17:
          status = 'active';
          return _context79.abrupt('break', 23);

        case 19:
          status = 'failed';
          return _context79.abrupt('break', 23);

        case 21:
          assert(false, 'Bad state.');
          return _context79.abrupt('break', 23);

        case 23:

          forks[deployment.name] = {
            status: status,
            bit: deployment.bit,
            startTime: deployment.startTime,
            timeout: deployment.timeout
          };

        case 24:
          i++;
          _context79.next = 3;
          break;

        case 27:
          return _context79.abrupt('return', forks);

        case 28:
        case 'end':
          return _context79.stop();
      }
    }
  }, getBIP9Softforks, this);
}));

RPC.prototype.getHashRate = co( /*#__PURE__*/_regenerator2.default.mark(function getHashRate(lookup, height) {
  var tip, i, minTime, maxTime, workDiff, timeDiff, ps, entry;
  return _regenerator2.default.wrap(function getHashRate$(_context80) {
    while (1) {
      switch (_context80.prev = _context80.next) {
        case 0:
          tip = this.chain.tip;

          if (!(height != null)) {
            _context80.next = 5;
            break;
          }

          _context80.next = 4;
          return this.chain.db.getEntry(height);

        case 4:
          tip = _context80.sent;

        case 5:
          if (tip) {
            _context80.next = 7;
            break;
          }

          return _context80.abrupt('return', 0);

        case 7:

          if (lookup <= 0) lookup = tip.height % this.network.pow.retargetInterval + 1;

          if (lookup > tip.height) lookup = tip.height;

          minTime = tip.ts;
          maxTime = minTime;
          entry = tip;

          i = 0;

        case 13:
          if (!(i < lookup)) {
            _context80.next = 24;
            break;
          }

          _context80.next = 16;
          return entry.getPrevious();

        case 16:
          entry = _context80.sent;

          if (entry) {
            _context80.next = 19;
            break;
          }

          throw new RPCError(errs.DATABASE_ERROR, 'Not found.');

        case 19:

          minTime = Math.min(entry.ts, minTime);
          maxTime = Math.max(entry.ts, maxTime);

        case 21:
          i++;
          _context80.next = 13;
          break;

        case 24:
          if (!(minTime === maxTime)) {
            _context80.next = 26;
            break;
          }

          return _context80.abrupt('return', 0);

        case 26:

          workDiff = tip.chainwork.sub(entry.chainwork);
          timeDiff = maxTime - minTime;
          ps = +workDiff.toString(10) / timeDiff;

          return _context80.abrupt('return', ps);

        case 30:
        case 'end':
          return _context80.stop();
      }
    }
  }, getHashRate, this);
}));

RPC.prototype.mineBlocks = co( /*#__PURE__*/_regenerator2.default.mark(function mineBlocks(blocks, address, tries) {
  var unlock;
  return _regenerator2.default.wrap(function mineBlocks$(_context81) {
    while (1) {
      switch (_context81.prev = _context81.next) {
        case 0:
          _context81.next = 2;
          return this.locker.lock();

        case 2:
          unlock = _context81.sent;
          _context81.prev = 3;
          _context81.next = 6;
          return this._mineBlocks(blocks, address, tries);

        case 6:
          return _context81.abrupt('return', _context81.sent);

        case 7:
          _context81.prev = 7;

          unlock();
          return _context81.finish(7);

        case 10:
        case 'end':
          return _context81.stop();
      }
    }
  }, mineBlocks, this, [[3,, 7, 10]]);
}));

RPC.prototype._mineBlocks = co( /*#__PURE__*/_regenerator2.default.mark(function _mineBlocks(blocks, address, tries) {
  var hashes, i, block;
  return _regenerator2.default.wrap(function _mineBlocks$(_context82) {
    while (1) {
      switch (_context82.prev = _context82.next) {
        case 0:
          hashes = [];
          i = 0;

        case 2:
          if (!(i < blocks)) {
            _context82.next = 15;
            break;
          }

          _context82.next = 5;
          return this.miner.mineBlock(null, address);

        case 5:
          block = _context82.sent;

          hashes.push(block.rhash());
          _context82.t0 = assert;
          _context82.next = 10;
          return this.chain.add(block);

        case 10:
          _context82.t1 = _context82.sent;
          (0, _context82.t0)(_context82.t1);

        case 12:
          i++;
          _context82.next = 2;
          break;

        case 15:
          return _context82.abrupt('return', hashes);

        case 16:
        case 'end':
          return _context82.stop();
      }
    }
  }, _mineBlocks, this);
}));

RPC.prototype.findFork = co( /*#__PURE__*/_regenerator2.default.mark(function findFork(entry) {
  return _regenerator2.default.wrap(function findFork$(_context83) {
    while (1) {
      switch (_context83.prev = _context83.next) {
        case 0:
          if (!entry) {
            _context83.next = 10;
            break;
          }

          _context83.next = 3;
          return entry.isMainChain();

        case 3:
          if (!_context83.sent) {
            _context83.next = 5;
            break;
          }

          return _context83.abrupt('return', entry);

        case 5:
          _context83.next = 7;
          return entry.getPrevious();

        case 7:
          entry = _context83.sent;
          _context83.next = 0;
          break;

        case 10:
          throw new Error('Fork not found.');

        case 11:
        case 'end':
          return _context83.stop();
      }
    }
  }, findFork, this);
}));

RPC.prototype.txToJSON = function txToJSON(tx, entry) {
  var height = -1;
  var conf = 0;
  var time = 0;
  var hash = null;
  var vin = [];
  var vout = [];
  var i, input, output, json;

  if (entry) {
    height = entry.height;
    time = entry.ts;
    hash = entry.rhash();
    conf = this.chain.height - height + 1;
  }

  for (i = 0; i < tx.inputs.length; i++) {
    input = tx.inputs[i];

    json = {
      coinbase: undefined,
      txid: undefined,
      scriptSig: undefined,
      txinwitness: undefined,
      sequence: input.sequence
    };

    if (tx.isCoinbase()) {
      json.coinbase = input.script.toJSON();
    } else {
      json.txid = input.prevout.txid();
      json.vout = input.prevout.index;
      json.scriptSig = {
        asm: input.script.toASM(),
        hex: input.script.toJSON()
      };
    }

    if (input.witness.items.length > 0) {
      json.txinwitness = input.witness.items.map(function (item) {
        return item.toString('hex');
      });
    }

    vin.push(json);
  }

  for (i = 0; i < tx.outputs.length; i++) {
    output = tx.outputs[i];
    vout.push({
      value: Amount.btc(output.value, true),
      n: i,
      scriptPubKey: this.scriptToJSON(output.script, true)
    });
  }

  return {
    txid: tx.txid(),
    hash: tx.wtxid(),
    size: tx.getSize(),
    vsize: tx.getVirtualSize(),
    version: tx.version,
    locktime: tx.locktime,
    vin: vin,
    vout: vout,
    blockhash: hash,
    confirmations: conf,
    time: time,
    blocktime: time,
    hex: undefined
  };
};

RPC.prototype.scriptToJSON = function scriptToJSON(script, hex) {
  var type = script.getType();
  var address = script.getAddress();
  var out;

  out = {
    asm: script.toASM(),
    hex: undefined,
    type: Script.typesByVal[type],
    reqSigs: 1,
    addresses: [],
    p2sh: undefined
  };

  if (hex) out.hex = script.toJSON();

  if (script.isMultisig()) out.reqSigs = script.getSmall(0);

  if (address) {
    address = address.toString(this.network);
    out.addresses.push(address);
  }

  return out;
};

RPC.prototype.headerToJSON = co( /*#__PURE__*/_regenerator2.default.mark(function headerToJSON(entry) {
  var medianTime, nextHash;
  return _regenerator2.default.wrap(function headerToJSON$(_context84) {
    while (1) {
      switch (_context84.prev = _context84.next) {
        case 0:
          _context84.next = 2;
          return entry.getMedianTime();

        case 2:
          medianTime = _context84.sent;
          _context84.next = 5;
          return this.chain.db.getNextHash(entry.hash);

        case 5:
          nextHash = _context84.sent;
          return _context84.abrupt('return', {
            hash: entry.rhash(),
            confirmations: this.chain.height - entry.height + 1,
            height: entry.height,
            version: entry.version,
            versionHex: util.hex32(entry.version),
            merkleroot: util.revHex(entry.merkleRoot),
            time: entry.ts,
            mediantime: medianTime,
            bits: entry.bits,
            difficulty: toDifficulty(entry.bits),
            chainwork: entry.chainwork.toString('hex', 64),
            previousblockhash: entry.prevBlock !== encoding.NULL_HASH ? util.revHex(entry.prevBlock) : null,
            nextblockhash: nextHash ? util.revHex(nextHash) : null
          });

        case 7:
        case 'end':
          return _context84.stop();
      }
    }
  }, headerToJSON, this);
}));

RPC.prototype.blockToJSON = co( /*#__PURE__*/_regenerator2.default.mark(function blockToJSON(entry, block, details) {
  var mtp, nextHash, txs, i, tx, json;
  return _regenerator2.default.wrap(function blockToJSON$(_context85) {
    while (1) {
      switch (_context85.prev = _context85.next) {
        case 0:
          _context85.next = 2;
          return entry.getMedianTime();

        case 2:
          mtp = _context85.sent;
          _context85.next = 5;
          return this.chain.db.getNextHash(entry.hash);

        case 5:
          nextHash = _context85.sent;
          txs = [];
          i = 0;

        case 8:
          if (!(i < block.txs.length)) {
            _context85.next = 18;
            break;
          }

          tx = block.txs[i];

          if (!details) {
            _context85.next = 14;
            break;
          }

          json = this.txToJSON(tx, entry);
          txs.push(json);
          return _context85.abrupt('continue', 15);

        case 14:

          txs.push(tx.txid());

        case 15:
          i++;
          _context85.next = 8;
          break;

        case 18:
          return _context85.abrupt('return', {
            hash: entry.rhash(),
            confirmations: this.chain.height - entry.height + 1,
            strippedsize: block.getBaseSize(),
            size: block.getSize(),
            weight: block.getWeight(),
            height: entry.height,
            version: entry.version,
            versionHex: util.hex32(entry.version),
            merkleroot: util.revHex(entry.merkleRoot),
            coinbase: block.txs[0].inputs[0].script.toJSON(),
            tx: txs,
            time: entry.ts,
            mediantime: mtp,
            bits: entry.bits,
            difficulty: toDifficulty(entry.bits),
            chainwork: entry.chainwork.toString('hex', 64),
            previousblockhash: entry.prevBlock !== encoding.NULL_HASH ? util.revHex(entry.prevBlock) : null,
            nextblockhash: nextHash ? util.revHex(nextHash) : null
          });

        case 19:
        case 'end':
          return _context85.stop();
      }
    }
  }, blockToJSON, this);
}));

RPC.prototype.entryToJSON = function entryToJSON(entry) {
  return {
    size: entry.size,
    fee: Amount.btc(entry.deltaFee, true),
    modifiedfee: 0,
    time: entry.ts,
    height: entry.height,
    startingpriority: entry.priority,
    currentpriority: entry.getPriority(this.chain.height),
    descendantcount: this.mempool.countDescendants(entry),
    descendantsize: entry.descSize,
    descendantfees: entry.descFee,
    ancestorcount: this.mempool.countAncestors(entry),
    ancestorsize: 0,
    ancestorfees: 0,
    depends: this.mempool.getDepends(entry.tx).map(util.revHex)
  };
};

/*
 * Helpers
 */

function swap32(data) {
  var i, field;
  for (i = 0; i < data.length; i += 4) {
    field = data.readUInt32LE(i, true);
    data.writeUInt32BE(field, i, true);
  }
  return data;
}

function toDeployment(id, version, status) {
  return {
    id: id,
    version: version,
    reject: {
      status: status
    }
  };
}

function Nonces(n1, n2) {
  this.nonce1 = n1;
  this.nonce2 = n2;
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

function parseIP(addr, network) {
  try {
    return IP.fromHostname(addr, network.port);
  } catch (e) {
    throw new RPCError(errs.CLIENT_INVALID_IP_OR_SUBNET, 'Invalid IP address or subnet.');
  }
}

function parseNetAddress(addr, network) {
  try {
    return NetAddress.fromHostname(addr, network);
  } catch (e) {
    throw new RPCError(errs.CLIENT_INVALID_IP_OR_SUBNET, 'Invalid IP address or subnet.');
  }
}

function toDifficulty(bits) {
  var shift = bits >>> 24 & 0xff;
  var diff = 0x0000ffff / (bits & 0x00ffffff);

  while (shift < 29) {
    diff *= 256.0;
    shift++;
  }

  while (shift > 29) {
    diff /= 256.0;
    shift--;
  }

  return diff;
}

/*
 * Expose
 */

module.exports = RPC;