const litecore = require('litecore-lib');
const Encode = require('./encoder');
const { buildLitecoinTransaction, buildTokenTradeTransaction, buildFuturesTransaction, getUTXOFromCommit } = require('./litecoreTxBuilder');
const litecoinClient = require('./litecoinClient');
const util = require('util');

// Promisify Litecoin Client functions
const getRawTransactionAsync = util.promisify(litecoinClient.getRawTransaction.bind(litecoinClient));
const getBlockDataAsync = util.promisify(litecoinClient.getBlock.bind(litecoinClient));
const createRawTransactionAsync = util.promisify(litecoinClient.createRawTransaction.bind(litecoinClient));
const listUnspentAsync = util.promisify(litecoinClient.cmd.bind(litecoinClient, 'listunspent'));
const decoderawtransactionAsync = util.promisify(litecoinClient.cmd.bind(litecoinClient, 'decoderawtransaction'));
const signrawtransactionwithwalletAsync = util.promisify(litecoinClient.cmd.bind(litecoinClient, 'signrawtransactionwithwallet'));
const sendrawtransactionAsync = util.promisify(litecoinClient.cmd.bind(litecoinClient, 'sendrawtransaction'));
const validateAddress = util.promisify(litecoinClient.cmd.bind(litecoinClient, 'validateaddress'));
const getBlockCountAsync = util.promisify(litecoinClient.cmd.bind(litecoinClient, 'getblockcount'));

class SellSwapper {
    constructor(typeTrade, tradeInfo, sellerInfo, buyerInfo, socket) {
        this.typeTrade = typeTrade;
        this.tradeInfo = tradeInfo;
        this.sellerInfo = sellerInfo;
        this.buyerInfo = buyerInfo;
        this.socket = socket;
        this.tradeStartTime = Date.now();
        this.handleOnEvents();
        this.initTrade();
    }

    logTime(stage) {
        const currentTime = Date.now();
        console.log(`Time taken for ${stage}: ${currentTime - this.tradeStartTime} ms`);
    }

    handleOnEvents() {
        this.removePreviousListeners();
        const eventName = `${this.buyerInfo.socketId}::swap`;
        this.socket.on(eventName, async (eventData) => {
            const { socketId, data } = eventData;
            switch (eventData.eventName) {
                case 'BUYER:STEP2':
                    await this.onStep2(socketId);
                    break;
                case 'BUYER:STEP4':
                    await this.onStep4(socketId, data);
                    break;
                case 'BUYER:STEP6':
                    await this.onStep6(socketId, data);
                    break;
                default:
                    break;
            }
        });
    }

    async initTrade() {
        try {
            const pubKeys = [this.sellerInfo.keypair.pubkey, this.buyerInfo.keypair.pubkey];
            const multisigAddress = litecore.Address.createMultisig(pubKeys, 2);

            const validateMS = await validateAddress([multisigAddress.toString()]);
            if (validateMS.error || !validateMS.isvalid) throw new Error(`Multisig address validation failed`);

            this.multySigChannelData = { address: multisigAddress.toString(), scriptPubKey: validateMS.scriptPubKey };
            const swapEvent = { eventName: 'SELLER:STEP1', data: this.multySigChannelData };
            this.socket.emit(`${this.sellerInfo.socketId}::swap`, swapEvent);
        } catch (error) {
            console.error(`InitTrade Error: ${error.message}`);
        }
    }

    async onStep2(cpId) {
        this.logTime('Step 2 Start');
        try {
            if (!this.multySigChannelData?.address) throw new Error(`No Multisig Address`);
            if (cpId !== this.buyerInfo.socketId) throw new Error(`Connection Error`);

            const { propIdDesired, amountDesired, transfer = false } = this.tradeInfo;

            // Fetch if the seller is on column A or B
            const columnRes = await litecoinClient.tl_getChannelColumn(this.sellerInfo.keypair.address, this.buyerInfo.keypair.address);
            const isColumnA = columnRes.data === 'A';

            // Generate the appropriate payload for commit or transfer
            let payload;
            if (transfer) {
                payload = Encode.encodeTransfer({
                    propertyId: propIdDesired,
                    amount: amountDesired,
                    isColumnA: isColumnA,
                    destinationAddr: this.multySigChannelData.address,
                });
            } else {
                payload = Encode.encodeCommit({
                    amount: amountDesired,
                    propertyId: propIdDesired,
                    channelAddress: this.multySigChannelData.address,
                });
            }

            const utxos = await listUnspentAsync([0, 999999, [this.sellerInfo.keypair.address]]);
            const commitUTXOs = utxos.map(u => ({ txid: u.txid, vout: u.vout, scriptPubKey: u.scriptPubKey, amount: u.amount }));

            // Build the transaction using the appropriate builder
            const transaction = await buildLitecoinTransaction(this.tradeInfo, this.sellerInfo.keypair, this.buyerInfo.keypair, commitUTXOs);

            const rawtx = transaction.toString();

            // Sign the transaction using Litecoin Client
            const signRes = await signrawtransactionwithwalletAsync([rawtx]);
            if (!signRes || !signRes.complete) throw new Error(`Failed to sign the transaction`);

            // Send the signed transaction
            const sendRes = await sendrawtransactionAsync([signRes.hex]);
            if (!sendRes) throw new Error(`Failed to broadcast the transaction`);

            // Fetch UTXO from the transaction
            const utxoData = await getUTXOFromCommit(rawtx);

            const swapEvent = { eventName: 'SELLER:STEP3', data: utxoData };
            this.socket.emit(`${this.sellerInfo.socketId}::swap`, swapEvent);
        } catch (error) {
            console.error(`Step 2 Error: ${error.message}`);
        }
    }

    async onStep4(cpId, psbtHex) {
        this.logTime('Step 4 Start');
        try {
            if (cpId !== this.buyerInfo.socketId) throw new Error(`Connection Error`);
            if (!psbtHex) throw new Error(`Missing PSBT Hex`);

            const signRes = await signrawtransactionwithwalletAsync([psbtHex]);
            if (!signRes || !signRes.complete) throw new Error(`Failed to sign the PSBT`);

            const swapEvent = { eventName: 'SELLER:STEP5', data: signRes.hex };
            this.socket.emit(`${this.sellerInfo.socketId}::swap`, swapEvent);
        } catch (error) {
            console.error(`Step 4 Error: ${error.message}`);
        }
    }

    async onStep6(cpId, finalTx) {
        this.logTime('Step 6 Start');
        try {
            if (cpId !== this.buyerInfo.socketId) throw new Error(`Connection Error`);

            const data = { txid: finalTx, seller: true, trade: this.tradeInfo };
            this.socket.emit(`${this.sellerInfo.socketId}::complete`, data);
        } catch (error) {
            console.error(`Step 6 Error: ${error.message}`);
        }
    }
}

module.exports = SellSwapper;
