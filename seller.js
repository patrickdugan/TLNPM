const litecore = require('bitcore-lib-ltc');
const Encode = require('./tradelayer.js/src/txEncoder.js');
const { buildLitecoinTransaction, buildTokenTradeTransaction, buildFuturesTransaction, getUTXOFromCommit,signPsbtRawTx } = require('./litecoreTxBuilder');
const WalletListener = require('./tradelayer.js/src/walletInterface.js');
const util = require('util');

    const BigNumber = require('bignumber.js');
class SellSwapper {
    constructor(typeTrade, tradeInfo, sellerInfo, buyerInfo, client, socket,test) {
        this.typeTrade = typeTrade;
        this.tradeInfo = tradeInfo;
        this.sellerInfo = sellerInfo;
        this.buyerInfo = buyerInfo;
        this.myInfo = sellerInfo
        this.cpInfo = buyerInfo
        this.socket = socket;
        this.client = client;
        this.test = test
        this.multySigChannelData = null
        this.tradeStartTime = Date.now();
         // Promisify methods for the given client
        this.getRawTransactionAsync = util.promisify(this.client.getRawTransaction.bind(this.client));
        this.getBlockDataAsync = util.promisify(this.client.getBlock.bind(this.client));
        this.createRawTransactionAsync = util.promisify(this.client.createRawTransaction.bind(this.client));
        this.listUnspentAsync = util.promisify(this.client.cmd.bind(this.client, 'listunspent'));
        this.decoderawtransactionAsync = util.promisify(this.client.cmd.bind(this.client, 'decoderawtransaction'));
        this.dumpprivkeyAsync = util.promisify(this.client.cmd.bind(this.client, 'dumpprivkey'));
        this.sendrawtransactionAsync = util.promisify(this.client.cmd.bind(this.client, 'sendrawtransaction'));
        this.validateAddress = util.promisify(this.client.cmd.bind(this.client, 'validateaddress'));
        this.getBlockCountAsync = util.promisify(this.client.cmd.bind(this.client, 'getblockcount'));
        this.addMultisigAddressAsync = util.promisify(this.client.cmd.bind(this.client, 'addmultisigaddress'));
        this.signrawtransactionwithwalletAsync = util.promisify(this.client.cmd.bind(this.client, 'signrawtransactionwithwallet'));
        this.signrawtransactionwithkeyAsync = util.promisify(this.client.cmd.bind(this.client, 'signrawtransactionwithkey'));

        this.handleOnEvents();
        this.onReady();
        this.initTrade();
    }

    logTime(stage) {
        const currentTime = Date.now();
        console.log(`Time taken for ${stage}: ${currentTime - this.tradeStartTime} ms`);
    }

    onReady() {
        return new Promise((resolve, reject) => {
            this.readyRes = resolve;
            // If the readyRes is not called within 60 seconds, terminate the trade
            setTimeout(() => this.terminateTrade('Undefined Error code 1'), 60000);
        });
    }


    removePreviousListeners() {
        // Correctly using template literals with backticks
        this.socket.off(`${this.cpInfo.socketId}::swap`);
    }

    terminateTrade(reason){
        // Emit the TERMINATE_TRADE event to the socket
        const eventData = {event:'TERMINATE_TRADE', socketId: this.myInfo.socketId, reason: reason};
        const tag = `${this.myInfo.socketId}::swap`;  // Correct string concatenation
        this.socket.emit(tag, eventData);
        this.removePreviousListeners(); 
    }

    handleOnEvents() {
        this.removePreviousListeners()
        const eventName = `${this.buyerInfo.socketId}::swap`;
        this.socket.on(eventName, async (eventData) => {
            const { socketId, data } = eventData;
            switch (eventData.eventName) {
                case 'BUYER:STEP2':
                    await this.onStep2(socketId, data);
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
            let pubKeys = [this.sellerInfo.keypair.pubkey, this.buyerInfo.keypair.pubkey];
              if (this.typeTrade === 'SPOT' && 'propIdDesired' in this.tradeInfo.props){
                let { propIdDesired, propIdForSale } = this.tradeInfo.props;
                if(propIdDesired==0||propIdForSale==0){
                     pubKeys = [this.buyerInfo.keypair.pubkey,this.sellerInfo.keypair.pubkey];
                }
              }
            console.log('pubkeys for multisig '+JSON.stringify(pubKeys))
            const multisigAddress = await this.addMultisigAddressAsync(2, pubKeys);
            this.multySigChannelData = multisigAddress

            console.log('generating multisig in sell init '+JSON.stringify(multisigAddress))
            const validateMS = await this.validateAddress(multisigAddress.address.toString());
            console.log('validated '+JSON.stringify(validateMS))
            if (validateMS.error || !validateMS.isvalid) throw new Error(`Multisig address validation failed`);

            this.multySigChannelData = { address: multisigAddress.address.toString(), redeemScript: multisigAddress.redeemScript.toString(), scriptPubKey: validateMS.scriptPubKey };
            console.log('checking this.multisig '+this.multySigChannelData)
            const swapEvent = { eventName: 'SELLER:STEP1', socketId: this.myInfo.socketId, data: this.multySigChannelData };
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

            let { propIdDesired, amountDesired, transfer = false } = this.tradeInfo.props;

            // Fetch if the seller is on column A or B
            const columnRes = "A" //await WalletListener.getColumn(this.sellerInfo.keypair.address, this.buyerInfo.keypair.address);
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
            console.log('calling list unspent '+this.sellerInfo.keypair.address)
            const utxos = await this.listUnspentAsync(0, 999999, [this.sellerInfo.keypair.address]);
                        // Sort the UTXOs by amount in descending order to get the largest one
            const sortedUTXOs = utxos.sort((a, b) => b.amount - a.amount);

            // Select the UTXO with the largest amount
            const largestUtxo = sortedUTXOs[0];

            console.log('Largest UTXO:', JSON.stringify(largestUtxo));

            // Now you can use the largest UTXO in your transaction
            const commitUTXOs = [{
                txid: largestUtxo.txid,
                vout: largestUtxo.vout,
                scriptPubKey: largestUtxo.scriptPubKey,
                amount: largestUtxo.amount
            }];

            console.log('commitUTXOs:', JSON.stringify(commitUTXOs));

            const hexPayload = Buffer.from(payload, 'utf8').toString('hex');
            console.log('payload ' + payload + ' hex ' + hexPayload);

            // Build the transaction using the appropriate builder
            const _insForRawTx = commitUTXOs.map(({ txid, vout }) => ({ txid, vout }));
            const change = new BigNumber(largestUtxo.amount).minus(0.000086).toNumber();
            const dust = 0.000056
            const _outsForRawTx = [
                { [this.multySigChannelData.address]: dust },
                { [this.myInfo.keypair.address]:change},
                { "data": hexPayload }
            ];

            console.log('inputs for create raw tx ' + JSON.stringify(_insForRawTx) + ' outs ' + JSON.stringify(_outsForRawTx));

            // Create the raw transaction
            let crtRes = await this.createRawTransactionAsync(_insForRawTx, _outsForRawTx);

            const decoded = await this.decoderawtransactionAsync(crtRes)
            console.log('decoded '+JSON.stringify(decoded))
            console.log('created commit tx '+crtRes+' type of '+typeof(crtRes))
            const wif = await this.dumpprivkeyAsync(this.myInfo.keypair.address)
            const signResKey = await this.signrawtransactionwithkeyAsync(crtRes,[wif])
            console.log('signed with key '+JSON.stringify(signResKey))
            // Sign the transaction using Litecoin Client
            /*const signRes = await signrawtransactionwithwalletAsync(crtRes);
            if (!signRes || !signRes.complete) return new Error(`Failed to sign the transaction`);*/

            // Send the signed transaction
            const sendRes = await this.sendrawtransactionAsync(signResKey.hex);
            if (!sendRes) return new Error(`Failed to broadcast the transaction`);
            console.log('sent commit '+JSON.stringify(sendRes))
            // Fetch UTXO from the transaction
            const utxoData = {
                amount: dust,
                vout: 0,
                txid: sendRes,
                scriptPubKey: this.multySigChannelData.scriptPubKey,
                redeemScript: this.multySigChannelData.redeemScript,
            };

            const swapEvent = { eventName: 'SELLER:STEP3', socketId: this.myInfo.socketId, data: utxoData };
            this.socket.emit(`${this.sellerInfo.socketId}::swap`, swapEvent);
        } catch (error) {
            console.error(`Step 2 Error: ${error.message}`);
        }
    }

    async onStep4(cpId, psbtHex) {
        this.logTime('Step 4 Start');
        try {
            if (cpId !== this.buyerInfo.socketId) return new Error(`Connection Error`);
            if (!psbtHex) return new Error(`Missing PSBT Hex`);
            let network = "LTC"
            if(this.test==true){
                network = "LTCTEST"
            }
            const wif = await this.dumpprivkeyAsync(this.myInfo.keypair.address)
            const signRes = await signPsbtRawTx({wif:wif,network:network,psbtHex:psbtHex}, this.client);
            //if (!signRes || !signRes.complete) return new Error(`Failed to sign the PSBT`);
            console.log('sign res for psbt in step 4 '+JSON.stringify(signRes))
            const swapEvent = { eventName: 'SELLER:STEP5', socketId:this.myInfo.socketId, data: signRes.data.psbtHex };
            this.socket.emit(`${this.sellerInfo.socketId}::swap`, swapEvent);
        } catch (error) {
            console.error(`Step 4 Error: ${error.message}`);
        }
    }

    async onStep6(cpId, finalTx) {
        this.logTime('Step 6 Start');
        try {
            if (cpId !== this.buyerInfo.socketId){console.log(`Connection Error`)};

            const data = { txid: finalTx, seller: true, trade: this.tradeInfo };
            this.socket.emit(`${this.sellerInfo.socketId}::complete`, data);
        } catch (error) {
            console.error(`Step 6 Error: ${error.message}`);
        }
    }
}

module.exports = SellSwapper;
