const litecore = require('bitcore-lib-ltc');
const Encode = require('./tradelayer.js/src/txEncoder.js'); // Use encoder.js for payload generation
const BigNumber = require('bignumber.js');
const { buildLitecoinTransaction, buildTokenTradeTransaction, buildFuturesTransaction, getUTXOFromCommit } = require('./litecoreTxBuilder');
const WalletListener = require('./tradelayer.js/src/walletInterface.js'); // Import WalletListener to use tl_getChannelColumn
const util = require('util');

const createclient = require('./litecoinClient.js');  // Adjust the path as necessary

// Create a testnet or mainnet client
const client = createclient(true);  // Pass 'true' for testnet, 'false' for mainnet

// Promisify the necessary client functions
const getRawTransactionAsync = util.promisify(client.getRawTransaction.bind(client));
const getBlockDataAsync = util.promisify(client.getBlock.bind(client));
const createRawTransactionAsync = util.promisify(client.createRawTransaction.bind(client));
const listUnspentAsync = util.promisify(client.cmd.bind(client, 'listunspent'));
const decoderawtransactionAsync = util.promisify(client.cmd.bind(client, 'decoderawtransaction'));
const dumpprivkeyAsync = util.promisify(client.cmd.bind(client, 'dumpprivkey'));
const sendrawtransactionAsync = util.promisify(client.cmd.bind(client,'sendrawtransaction'));
const validateAddress = util.promisify(client.cmd.bind(client,'validateaddress'));
const getBlockCountAsync = util.promisify(client.cmd.bind(client, 'getblockcount'));
const loadWalletAsync = util.promisify(client.cmd.bind(client, 'loadwallet'));
const addMultisigAddressAsync = util.promisify(client.cmd.bind(client, 'addmultisigaddress'));
const signrawtransactionwithwalletAsync = util.promisify(client.cmd.bind(client, 'signrawtransactionwithwallet'));

class BuySwapper {
    constructor(
        typeTrade, // New parameter for trade type ('BUY')
        tradeInfo, // Trade information
        buyerInfo, // Buyer information
        sellerInfo, // Seller information
        client, // Litecoin client or another client service
        socket // Socket for communication
    ) {
        this.typeTrade = typeTrade;  // 'BUY' or 'SELL'
        this.tradeInfo = tradeInfo;  // Trade information (e.g., amount, price, etc.)
        this.myInfo = buyerInfo;  // Information about the buyer
        this.cpInfo = sellerInfo;  // Information about the seller
        this.socket = socket;  // Socket connection for real-time events
        this.client = client;  // Client for making RPC calls
        
        this.multySigChannelData = null;  // Initialize multisig channel data

        this.handleOnEvents();  // Set up event listeners
        this.onReady();  // Prepare for trade execution
        this.tradeStartTime = Date.now();
    }

    // Other methods for the BuySwapper class (e.g., handleOnEvents, onReady, etc.)
    onReady() {
        return new Promise((resolve, reject) => {
            this.readyRes = resolve;
            // If the readyRes is not called within 60 seconds, terminate the trade
            setTimeout(() => this.terminateTrade('Undefined Error code 1'), 60000);
        });
    }

    logTime(stage) {
        const currentTime = Date.now();
        console.log(`Time taken for ${stage}: ${currentTime - this.tradeStartTime} ms`);
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
        const eventName = `${this.cpInfo.socketId}::swap`;
          console.log('Received event:', JSON.stringify(eventName)); 
        this.socket.on(eventName, (eventData) => {
            console.log('event name '+eventData.eventName)
             const { socketId, data } = eventData;
            switch (eventData.eventName) {
                case 'SELLER:STEP1':
                    this.onStep1(socketId,data);
                    break;
                case 'SELLER:STEP3':
                    //console.log('about to call step 3 func ' +socketId+' '+JSON.stringify(data))
                    this.onStep3(socketId,data);
                    break;
                case 'SELLER:STEP5':
                    this.onStep5(socketId,data);
                    break;
                default:
                    break;
            }
        });
    }

    // Step 1: Create multisig address and verify
      async onStep1(cpId, msData) {
        console.log('cp socket Id '+JSON.stringify(cpId)+'my CP socketId '+ this.cpInfo.socketId)  
        console.log('examining trade info obj '+JSON.stringify(this.tradeInfo))
        const startStep1Time = Date.now(); // Start timing Step 1
        //try {
            // Check that the provided cpId matches the expected socketId
            if (cpId !==  this.cpInfo.socketId) {
                console.log('cp socket mismatch '+Boolean(cpId !==  this.cpInfo.socketId))
                return new Error(`Error with p2p connection: Socket ID mismatch.`);
            }

            const pubKeys = [this.cpInfo.keypair.pubkey,this.myInfo.keypair.pubkey]
            console.log(JSON.stringify(pubKeys))
            const multisigAddress = await addMultisigAddressAsync(2, pubKeys);
            console.log('Created Multisig address:', multisigAddress.address, msData.address);

            if (multisigAddress.address !== msData.address){
                console.log('multisig address mismatch '+msData.address+multisigAddress.address+Boolean(multisigAddress.toString() !== msData.address))
                return new Error('Multisig address mismatch');
            }

               // Step 4: Validate redeemScript
            if (multisigAddress.redeemScript !== msData.redeemScript) {
                console.log('redeem script mismatch '+multisigAddress.redeemScript+msData.redeemScript+Boolean(multisigAddress.redeemScript !== msData.redeemScript))
                return new Error('Redeem script mismatch');
            }

        // Step 5: Store the multisig data
        this.multySigChannelData = msData;

            this.multySigChannelData = msData;

            // Emit the event to the correct socketId
            console.log('about to emit step 2 '+this.myInfo.socketId)

            const step1Time = Date.now() - startStep1Time; // Time taken for Step 1
            console.log(`Time taken for Step 1: ${step1Time} ms`);
            this.socket.emit(`${this.myInfo.socketId}::swap`, { eventName: 'BUYER:STEP2', socketId: this.myInfo.socketId });

        //} catch (error) {
        //    this.terminateTrade(`Step 1: ${error.message}`);
        //}
    }

    async onStep3(cpId, commitUTXO) {
                const startStep3Time = Date.now(); // Start timing Step 3
        
            if (cpId !== this.cpInfo.socketId) return new Error(`Error with p2p connection`);
            if (!this.multySigChannelData) return new Error(`Wrong Multisig Data Provided`);

            // **Fetch the current block count**
            const gbcRes = await getBlockCountAsync();
            if (!gbcRes) return new Error('Failed to get block count from Litecoin node');
            const bbData = gbcRes + 10; // For expiryBlock calculation
            console.log('step 3 details '+bbData+' '+gbcRes+' '+this.typeTrade+' '+JSON.stringify(this.tradeInfo))
            // **Step 1: Determine the type of trade (Futures or Spot)**
            if (this.typeTrade === 'SPOT' && 'propIdDesired' in this.tradeInfo.props){
                let { propIdDesired, amountDesired, amountForSale, propIdForSale, transfer } = this.tradeInfo.props;
                console.log('importing transfer', transfer);
                if (!transfer){transfer = false;}

                let ltcTrade = false;
                let ltcForSale = false;
                if (propIdDesired === 0) {
                    ltcTrade = true;
                } else if (propIdForSale === 0) {
                    ltcTrade = true;
                    ltcForSale = true;
                }

                if (ltcTrade) {
                    // **Handle LTC Trades**
                    const column = await WalletListener.getColumn(this.myInfo.keypair.address, this.cpInfo.keypair.address);
                    const isA = column === 'A' ? 1 : 0;
                    console.log('checking ltc trade params '+column +' '+ltcForSale+ ' '+amountDesired+ ' '+amountForSale)
                    const satsExpected = ltcForSale ? amountForSale : amountDesired
                    const params = {
                        propertyId: ltcForSale ? propIdForSale : propIdDesired,
                        amount: ltcForSale ? amountForSale : amountDesired,
                        columnA: isA,
                        satsExpected: satsExpected,
                        tokenOutput: 0,
                        payToAddress: 1
                    }
                    //console.log('utxo trade payload params '+JSON.stringify(params))
                    const payload = Encode.encodeTradeTokenForUTXO(params);

                    //console.log('show commit UTXO object' +JSON.stringify(commitUTXO))

                    const buildOptions = {
                        buyerKeyPair: this.myInfo.keypair,
                        sellerKeyPair: this.cpInfo.keypair,
                        commitUTXOs: [commitUTXO],
                        payload,
                        satsExpected: satsExpected,
                    };

                    // **Build Litecoin Transaction**
                    const rawHexRes = await buildLitecoinTransaction(buildOptions, false);
                    console.log('built utxo trade returns ' +JSON.stringify(rawHexRes))
                    //if (!rawHexRes?.psbtHex) return new Error(`Build Trade: Failed to build Litecoin transaction`);
                      const step3Time = Date.now() - startStep3Time; // Time taken for Step 3
                    console.log(`Time taken for Step 3: ${step3Time} ms`);
                   
                    this.socket.emit(`${this.myInfo.socketId}::swap`, { eventName: 'BUYER:STEP4', socketId: this.myInfo.socketId, psbtHex: rawHexRes.psbtHex })
                } else {
                    // **Handle Token Trades**
                    let payload;
                    if (transfer) {
                        payload = Encode.encodeTransfer({
                            propertyId: propIdDesired,
                            amount: amountDesired,
                            isColumnA: true, // Adjust as needed
                            destinationAddr: this.multySigChannelData.address,
                        });
                    } else {
                        payload = Encode.encodeCommit({
                            amount: amountDesired,
                            propertyId: propIdDesired,
                            channelAddress: this.multySigChannelData.address,
                        });
                    }

                    const commitTxConfig = {
                        fromKeyPair: this.myInfo.address,
                        toKeyPair: this.cpInfo.keypair,
                        payload,
                    };

                    // **Build Token Trade Transaction**
                    const commitTxRes = await buildTokenTradeTransaction(commitTxConfig);
                    if (!commitTxRes?.signedHex) return new Error('Failed to sign and send the token transaction');

                    // **Extract UTXO from commit**
                    const utxoData = await getUTXOFromCommit(commitTxRes.signedHex);

                    const tradePayload = Encode.encodeTradeTokensChannel({
                        propertyId1: propIdDesired,
                        propertyId2: propIdForSale,
                        amountOffered1: amountForSale,
                        amountDesired2: amountForSale,
                        columnAIsOfferer: true,
                        expiryBlock: bbData,
                    });

                    const tradeOptions = {
                        buyerKeyPair: this.myInfo.address,
                        sellerKeyPair: this.cpInfo.keypair,
                        commitUTXOs: [commitUTXO, utxoData],
                        payload: tradePayload,
                        amount: 0,
                    };

                    const rawHexRes = await buildTokenTradeTransaction(tradeOptions);
                    if (!rawHexRes?.psbtHex) return new Error(`Build Trade: Failed to build token trade`);
                    const step3Time = Date.now() - startStep3Time; // Time taken for Step 3
                    console.log(`Time taken for Step 3: ${step3Time} ms`);
                    this.socket.emit(`${this.myInfo.socketId}::swap`, { eventName: 'BUYER:STEP4', socketId: this.myInfo.socketId, psbtHex: rawHexRes.psbtHex });
                }

            } else if (this.typeTrade === 'FUTURES' && 'contract_id' in trade) {
                // **Handle Futures Trade**
                const { contract_id, amount, price, transfer } = trade;
                let payload;
                if (transfer) {
                    payload = Encode.encodeTransfer({
                        propertyId: propIdDesired,
                        amount: amountDesired,
                        isColumnA: true, // Adjust as needed
                        destinationAddr: this.multySigChannelData.address,
                    });
                } else {
                    payload = Encode.encodeCommit({
                        amount: amountDesired,
                        propertyId: propIdDesired,
                        channelAddress: this.multySigChannelData.address,
                    });
                }

                const commitTxConfig = {
                    fromKeyPair: this.myInfo.address,
                    toKeyPair: this.cpInfo.keypair,
                    payload: commitPayload,
                };

                const commitTxRes = await buildFuturesTransaction(commitTxConfig);
                if (!commitTxRes?.signedHex) throw new Error('Failed to sign and send the futures transaction');

                const utxoData = await getUTXOFromCommit(commitTxRes.signedHex);

                const futuresPayload = Encode.encodeTradeContractChannel({
                    contractId: contract_id,
                    price,
                    amount,
                    columnAIsSeller: true, // Adjust based on context
                    expiryBlock: bbData,
                    insurance: false, // Set as per logic
                });

                const futuresOptions = {
                    buyerKeyPair: this.myInfo.address,
                    sellerKeyPair: this.cpInfo.keypair,
                    commitUTXOs: [commitUTXO, utxoData],
                    payload: futuresPayload,
                    amount: 0,
                };

                const rawHexRes = await buildFuturesTransaction(futuresOptions);
                
                if (!rawHexRes?.psbtHex) throw new Error(`Build Futures Trade: Failed to build futures trade`);
                  const step3Time = Date.now() - startStep3Time; // Time taken for Step 3
                    console.log(`Time taken for Step 3: ${step3Time} ms`);
                 
                this.socket.emit(`${this.myInfo.socketId}::swap`, { eventName: 'BUYER:STEP4', socketId: this.myInfo.socketId, psbtHex: rawHexRes.psbtHex });
            } else {
                throw new Error(`Unrecognized Trade Type: ${this.typeTrade}`);
            }

        /*} catch (error) {
            const errorMessage = error.message || 'Undefined Error';
            this.terminateTrade(`Step 3: ${errorMessage}`);
        }*/
    }

    // Step 5: Sign the PSBT using Litecore and send the final transaction
    async onStep5(psbtHex) {
        const startStep5Time = Date.now();
        try {
            // Sign the PSBT transaction using the wallet
            const signedPsbt = await signrawtransactionwithwalletAsync(psbtHex);
            if (!signedPsbt || !signedPsbt.hex) return new Error('Failed to sign PSBT');
              const timeToCoSign = Date.now()-this.tradeStartTime
            console.log('Cosigned trade in '+timeToCoSign)
            // Send the signed transaction
            const sentTx = await sendrawtransactionAsync(signedPsbt.hex);
            if (!sentTx) return new Error('Failed to send the transaction');

            // Emit the next step event
              const step5Time = Date.now() - startStep5Time; // Time taken for Step 3
                    console.log(`Time taken for Step 3: ${step3Time} ms`);
              
            this.socket.emit(`${this.myInfo.socketId}::swap`, { eventName: 'BUYER:STEP6', data: sentTx });
        } catch (error) {
            this.terminateTrade(`Step 5: ${error.message}`);
        }
    }
}

module.exports = BuySwapper;
