const axios = require('axios');

const DEFAULT_RELAYER_HOST = '170.75.168.246';
const DEFAULT_RELAYER_PORT = 8000;

/**
 * RPC client that proxies calls through a tl-relayer HTTP server
 * instead of connecting to a local litecoin/bitcoin daemon.
 *
 * Exposes a `.cmd(method, ...args, callback)` interface identical to the
 * `litecoin` / `bitcoin` npm packages so it can be used as a drop-in
 * replacement.
 */
class RelayerClient {
    constructor(opts = {}) {
        this.host = opts.host || DEFAULT_RELAYER_HOST;
        this.port = opts.port || DEFAULT_RELAYER_PORT;
        this.timeout = opts.timeout || 30000;
        this.baseUrl = `http://${this.host}:${this.port}`;
    }

    /**
     * Matches the signature used by the litecoin/bitcoin npm clients:
     *   client.cmd('method', arg1, arg2, ..., callback)
     *
     * The last argument is always the node-style callback (err, result).
     */
    cmd(...allArgs) {
        const cb = typeof allArgs[allArgs.length - 1] === 'function'
            ? allArgs.pop()
            : null;

        const method = allArgs.shift();
        const params = allArgs;

        const promise = this._call(method, params);

        if (cb) {
            promise.then(r => cb(null, r)).catch(cb);
        } else {
            return promise;
        }
    }

    async _call(method, params) {
        const url = `${this.baseUrl}/rpc/${method}`;
        const res = await axios.post(url, { params }, { timeout: this.timeout });

        // The relayer wraps RPC results in { data, error, ... }
        const body = res.data;
        if (body && body.error) {
            const err = new Error(typeof body.error === 'string' ? body.error : JSON.stringify(body.error));
            err.code = body.error?.code;
            throw err;
        }
        // Return the inner `data` field if present, otherwise the full body
        return body.data !== undefined ? body.data : body;
    }
}

/**
 * Create a client that tries the local RPC daemon first and automatically
 * falls back to the relayer if the local connection is refused.
 *
 * The returned object has the same `.cmd()` interface.
 */
function createFallbackClient(localClient, relayerOpts) {
    const relayer = new RelayerClient(relayerOpts);
    let useRelayer = false;

    return {
        _localClient: localClient,
        _relayerClient: relayer,
        _useRelayer: () => useRelayer,

        cmd(...allArgs) {
            const cb = typeof allArgs[allArgs.length - 1] === 'function'
                ? allArgs.pop()
                : null;

            const method = allArgs[0];
            const args = allArgs.slice(1);

            const attempt = async () => {
                if (useRelayer) {
                    return relayer._call(method, args);
                }

                try {
                    // Try local
                    return await new Promise((resolve, reject) => {
                        localClient.cmd(...allArgs, (err, result) => {
                            if (err) reject(err);
                            else resolve(result);
                        });
                    });
                } catch (err) {
                    if (err.code === 'ECONNREFUSED' || err.errno === -4078 || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
                        console.log(`[relayer-fallback] Local RPC failed (${err.code}), switching to relayer at ${relayer.baseUrl}`);
                        useRelayer = true;
                        return relayer._call(method, args);
                    }
                    throw err;
                }
            };

            const promise = attempt();
            if (cb) {
                promise.then(r => cb(null, r)).catch(cb);
            } else {
                return promise;
            }
        }
    };
}

module.exports = { RelayerClient, createFallbackClient, DEFAULT_RELAYER_HOST, DEFAULT_RELAYER_PORT };
