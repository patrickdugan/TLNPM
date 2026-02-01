const Litecoin = require('litecoin');
const Bitcoin = require('bitcoin')
const { RelayerClient, createFallbackClient, DEFAULT_RELAYER_HOST, DEFAULT_RELAYER_PORT } = require('./relayerClient');

const createLitecoinClient = (test = true, relayerOpts) => {
    const config = {
        host: '127.0.0.1',
        port: test ? 19332 : 9332,  // Switch between testnet and mainnet
        user: 'user',               // Make sure to replace these with your actual credentials
        pass: 'pass',
        timeout: 10000
    };

    const local = new Litecoin.Client(config);

    if (relayerOpts === false) {
        // Explicitly disabled
        return local;
    }

    return createFallbackClient(local, relayerOpts || {});
};

const createBitcoinClient = (test = true, relayerOpts) => {
    const config = {
        host: '127.0.0.1',
        port: test ? 18332 : 8332,  // Switch between testnet and mainnet
        user: 'user',               // Make sure to replace these with your actual credentials
        pass: 'pass',
        timeout: 10000
    };

    const local = new Bitcoin.Client(config);

    if (relayerOpts === false) {
        return local;
    }

    return createFallbackClient(local, relayerOpts || {});
};

/**
 * Create a relayer-only client (no local node needed).
 */
const createRelayerOnlyClient = (opts) => {
    return new RelayerClient(opts);
};


module.exports = {createLitecoinClient, createBitcoinClient, createRelayerOnlyClient};
