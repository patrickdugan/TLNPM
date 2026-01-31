#!/usr/bin/env node
/**
 * Generates a new BIP39 seed phrase and derives a default address.
 *
 * Usage:
 *   node createWallet.js [network]
 *
 * Examples:
 *   node createWallet.js              # defaults to LTCTEST
 *   node createWallet.js LTC
 *   node createWallet.js BTC
 *
 * BIP44 paths:
 *   LTC / LTCTEST : m/44'/2'/0'/0/0
 *   BTC / BTCTEST : m/44'/0'/0'/0/0
 */

const nodeCrypto = require('crypto');
const bip39 = require('bip39');
const { BIP32Factory } = require('bip32');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('tiny-secp256k1');
const { ECPairFactory } = require('ecpair');
const networks = require('./networks');

const ECPair = ECPairFactory(ecc);
const bip32 = BIP32Factory(ecc);
bitcoin.initEccLib(ecc);

const networkPaths = {
    LTC:      "m/84'/2'/0'/0",
    LTCTEST:  "m/84'/1'/0'/0",
    BTC:      "m/84'/0'/0'/0",
    BTCTEST:  "m/84'/1'/0'/0",
};

const networkName = (process.argv[2] || 'LTCTEST').toUpperCase();
const net = networks[networkName];
const basePath = networkPaths[networkName];
if (!net || !basePath) {
    console.error(`Unknown network "${networkName}". Choose from: ${Object.keys(networkPaths).join(', ')}`);
    process.exit(1);
}

const derivePath = `${basePath}/0`;
const mnemonic = bip39.generateMnemonic(256);
const seed = bip39.mnemonicToSeedSync(mnemonic);
const root = bip32.fromSeed(seed, net);
const child = root.derivePath(derivePath);

const { address } = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(child.publicKey),
    network: net,
});

const pubkey = Buffer.from(child.publicKey).toString('hex');

console.log('');
console.log('=== NEW WALLET ===');
console.log('');
console.log(`Network : ${networkName}`);
console.log(`Path    : ${derivePath}`);
console.log('');
console.log('SEED PHRASE (write this down, do NOT share):');
console.log('');
console.log(`  ${mnemonic}`);
console.log('');
console.log(`Address : ${address}`);
console.log(`PubKey  : ${pubkey}`);
console.log('');
console.log('Fund this address, then start the API:');
console.log('');
console.log(`  const ApiWrapper = require('./algoAPI');`);
console.log(`  const api = new ApiWrapper(obURL, obPort, ${networkName.includes('TEST')}, true, '${address}', '${pubkey}', '${networkName}');`);
console.log('');
