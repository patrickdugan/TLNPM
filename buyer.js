const litecore = require('bitcore-lib-ltc');
const Encode = require('./tradelayer.js/src/txEncoder.js'); // Use encoder.js for payload generation
const BigNumber = require('bignumber.js');
const { buildLitecoinTransaction, buildTokenTradeTransaction, buildFuturesTransaction, getUTXOFromCommit, signPsbtRawTx } = require('./litecoreTxBuilder');
const WalletListener = require('./tradelayer.js/src/walletInterface.js'); // Import WalletListener to use tl_getChannelColumn
const util = require('util');
const {Psbt}= require('bitcoinjs-lib')

class BuySwapper {
    constructor(
        typeTrade, // New parameter for trade type ('BUY')
        tradeInfo, // Trade information
        buyerInfo, // Buyer information
        sellerInfo, // Seller information
        client, // Litecoin client or another client service
        socket, // Socket for communication
        test
    ) {
        this.typeTrade = typeTrade;  // 'BUY' or 'SELL'
        this.tradeInfo = tradeInfo;  // Trade information (e.g., amount, price, etc.)
        this.myInfo = buyerInfo;  // Information about the buyer
        this.cpInfo = sellerInfo;  // Information about the seller
        this.socket = socket;  // Socket connection for real-time events
        this.client = client;  // Client for making RPC calls
        this.test= test        
        this.multySigChannelData = null;  // Initialize multisig channel data

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
        this.importmultiAsync = util.promisify(client.cmd.bind(client, 'importmulti'));
        
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

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async sendTxWithSpecRetry(rawTx) {
        const _sendTxWithRetry = async (rawTx, retriesLeft, ms) => {
            try {
                // Attempt to send the transaction
                const result = await this.sendrawtransactionAsync(rawTx);
                // If there's an error and retries are left, try again
                if (result.error && result.error.includes('bad-txns-inputs-missingorspent') && retriesLeft > 0) {
                    await new Promise(resolve => setTimeout(resolve, ms));
                    console.log('Retrying to send the transaction... Remaining retries:', retriesLeft);
                    return _sendTxWithRetry(rawTx, retriesLeft - 1, ms);
                }
                // If successful, return the result
                return result;
            } catch (error) {
                // If an error occurs during sendrawtransactionAsync, handle it here
                console.error('Error during transaction send:', error.message);
                if (retriesLeft > 0) {
                    console.log('Retrying after error... Remaining retries:', retriesLeft);
                    await new Promise(resolve => setTimeout(resolve, ms));
                    return _sendTxWithRetry(rawTx, retriesLeft - 1, ms);
                }
                return { error: 'Transaction failed after retries' }; // Return an error after all retries
            }
        }

        // Start the retry process with 15 retries and 800ms interval
        return _sendTxWithRetry(rawTx, 15, 800);
    }

    async importMultisigNoRescan(address, redeemScriptHex) {
      try {
        // Build the request array (can hold multiple scripts)
        const request = [
          {
            // For P2WSH, Bitcoin/Litecoin Core typically uses the 'redeemscript' field
            // even though it's actually the "witnessScript."
            scriptPubKey: { address },   // The address to track
            redeemscript: redeemScriptHex,
            watchonly: true,
            timestamp: 'now',           // or block timestamp if you had it
          }
        ];

        // Pass options { rescan: false } to avoid a full chain rescan
        const options = { rescan: false };

        // Execute the importmulti call
        const result = await this.importmultiAsync(request, options);

        console.log('importmulti result:', result);
        // result is typically an array of objects with "success" and "warnings" fields
      } catch (err) {
        console.error('importMultisigNoRescan error:', err);
      }
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
                    this.onStep3(socketId,data);
                    break;
                case 'SELLER:STEP5':
                console.log('about to call step 5 func ' +socketId+' '+JSON.stringify(data))
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
        try {
            // Check that the provided cpId matches the expected socketId
            if (cpId !==  this.cpInfo.socketId) {
                console.log('cp socket mismatch '+Boolean(cpId !==  this.cpInfo.socketId))
                return new Error(`Error with p2p connection: Socket ID mismatch.`);
            }

            let pubKeys = [this.cpInfo.keypair.pubkey,this.myInfo.keypair.pubkey]
            if (this.typeTrade === 'SPOT' && 'propIdDesired' in this.tradeInfo.props){
                let { propIdDesired, propIdForSale } = this.tradeInfo.props;
                if(propIdDesired==0||propIdForSale==0){
                     pubKeys = [this.myInfo.keypair.pubkey,this.cpInfo.keypair.pubkey];
                }
              }
            console.log(JSON.stringify(pubKeys))
            const multisigAddress = await this.addMultisigAddressAsync(2, pubKeys);
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

            await this.importMultisigNoRescan(multisigAddress.address,multisigAddress.redeemscript)

        // Step 5: Store the multisig data
            this.multySigChannelData = msData;

            // Emit the event to the correct socketId
            console.log('about to emit step 2 '+this.myInfo.socketId)

            const step1Time = Date.now() - startStep1Time; // Time taken for Step 1
            console.log(`Time taken for Step 1: ${step1Time} ms`);
            this.socket.emit(`${this.myInfo.socketId}::swap`, { eventName: 'BUYER:STEP2', socketId: this.myInfo.socketId });

        } catch (error) {
            this.terminateTrade(`Step 1: ${error.message}`);
        }
    }

    async onStep3(cpId, commitUTXO) {
                const startStep3Time = Date.now(); // Start timing Step 3
        try{
            if (cpId !== this.cpInfo.socketId) throw new Error(`Error with p2p connection`);
            if (!this.multySigChannelData) throw new Error(`Wrong Multisig Data Provided`);

            // **Fetch the current block count**
            const gbcRes = await this.getBlockCountAsync();
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
                    const column = "A" //await WalletListener.getColumn(this.myInfo.keypair.address, this.cpInfo.keypair.address);
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

                    
                    console.log('show commit UTXO object' +JSON.stringify(commitUTXO))
                    const network = this.test ? "LTCTEST" : "LTC";
                    const buildOptions = {
                        buyerKeyPair: this.myInfo.keypair,
                        sellerKeyPair: this.cpInfo.keypair,
                        commitUTXOs: [commitUTXO],
                        payload,
                        amount: satsExpected,
                        network: network
                    };


                    const rawHexRes = await buildLitecoinTransaction(buildOptions, this.client);
                    console.log('returned object from psbt ' +JSON.stringify(rawHexRes))
                     // Select additional UTXOs for the trade
                    /*const utxos = await listUnspentAsync(); // Get unspent UTXOs from the wallet
                    const selectedInputs = [commitUTXO];  // Start with the commitUTXO

                    let totalAmount = commitUTXO.amount;
                    for (const utxo of utxos) {
                        if (totalAmount >= satsExpected) break;
                        selectedInputs.push(utxo); // Add the unspent UTXOs to meet the satsExpected
                        totalAmount += utxo.amount;
                    }

                    // Prepare the transaction inputs and outputs
                    const inputs = selectedInputs.map(input => ({
                        txid: input.txid,
                        vout: input.vout,
                        scriptPubKey: input.scriptPubKey,
                        amount: input.amount
                    }));

                    const address1 = this.myInfo.keypair.address.toString()
                    const address2 = this.cpInfo.keypair.address.toString()

                  const outputs = [
                        { [address1]: (totalAmount - satsExpected - 0.00005).toFixed(8) }, // Change output
                        { [address2]: satsExpected.toFixed(8) }, // Payment output
                        { data: Buffer.from(payload, 'utf8').toString('hex') } // OP_RETURN output for the payload
                    ];

                    const payloadBuff = Buffer.from(payload, 'utf8').toString('hex')
                    const createpsbtAsync = util.promisify(client.cmd.bind(client, 'createpsbt'));
                    //console.log(payloadBuff)
                    const output = [{ data: payloadBuff }]
                    // **Build Litecoin Transaction**

                    console.log(inputs,outputs)
                    //const rawHexRes = await createpsbtAsync(inputs,outputs);//await buildLitecoinTransaction(buildOptions, false);
                    //console.log('built utxo trade returns ' +JSON.stringify(rawHexRes.data.psbtHex))
                    //const decode = await decoderawtransactionAsync(rawHexRes.data.rawtx)
                    //console.log('checking decode of unsigned psbt '+JSON.stringify(decode))
                    //if (!rawHexRes?.psbtHex) return new Error(`Build Trade: Failed to build Litecoin transaction`);
                    const psbtDecode = await decodepsbtAsync(rawHexRes)
                    console.log(psbtDecode)*/
                     const step3Time = Date.now() - startStep3Time; // Time taken for Step 3
                    console.log(`Time taken for Step 3: ${step3Time} ms`);
                    
                    const eventData = { eventName: 'BUYER:STEP4', socketId: this.myInfo.socketId, data: rawHexRes.data.psbtHex}
                    console.log('event data ending step 3 '+JSON.stringify(eventData))
                    this.socket.emit(`${this.myInfo.socketId}::swap`, eventData)
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
                    const network = this.test ? "LTCTEST" : "LTC";

                    const commitTxConfig = {
                        fromKeyPair: this.myInfo.address,
                        toKeyPair: this.cpInfo.keypair,
                        payload,
                        network: network 
                    };

                    // **Build Token Trade Transaction**
                    const commitTxRes = await buildTokenTradeTransaction(commitTxConfig, this.client);
                    if (!commitTxRes?.signedHex) return new Error('Failed to sign and send the token transaction');

                    // **Extract UTXO from commit**
                    const utxoData = await getUTXOFromCommit(commitTxRes.signedHex, this.client);

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
                        network: network
                    };

                    const rawHexRes = await buildTokenTradeTransaction(tradeOptions, this.client);
                    if (!rawHexRes?.psbtHex) return new Error(`Build Trade: Failed to build token trade`);
                    const step3Time = Date.now() - startStep3Time; // Time taken for Step 3
                    console.log(`Time taken for Step 3: ${step3Time} ms`);
                    this.socket.emit(`${this.myInfo.socketId}::swap`, { eventName: 'BUYER:STEP4', socketId: this.myInfo.socketId, data: rawHexRes.psbtHex});
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
                    network: network
                };

                const rawHexRes = await buildFuturesTransaction(futuresOptions, this.client);
                
                if (!rawHexRes?.psbtHex) throw new Error(`Build Futures Trade: Failed to build futures trade`);
                  const step3Time = Date.now() - startStep3Time; // Time taken for Step 3
                    console.log(`Time taken for Step 3: ${step3Time} ms`);
                 
                this.socket.emit(`${this.myInfo.socketId}::swap`, { eventName: 'BUYER:STEP4', socketId: this.myInfo.socketId, data: rawHexRes.psbtHex});
            } else {
                throw new Error(`Unrecognized Trade Type: ${this.typeTrade}`);
            }
        } catch (error) {
            const errorMessage = error.message || 'Undefined Error';
            this.terminateTrade(`Step 3: ${errorMessage}`);
        }
    }

    // Step 5: Sign the PSBT using Litecore and send the final transaction
    async onStep5(cpId, psbtHex) {
        const startStep5Time = Date.now();

        /*let signed = await signpsbtAsync(psbtHex.data.psbt)
        const final = await finalizeAsync(signed.psbt)
        console.log('final '+JSON.stringify(final))
        
        const timeToCoSign = Date.now()-this.tradeStartTime
            console.log('Cosigned trade in '+timeToCoSign)

        
        console.log(sentTx)
        const psbt = Psbt.fromHex(psbtHex);
        const bigIntReplacer = (key, value) => {
          if (typeof value === 'bigint') {
            return value.toString(); // Convert BigInt to string
          }
          return value;
        };*/

        // Now, use this replacer when calling JSON.stringify
        

        // Ensure that each input has the necessary witness data
     
        try{
            // Sign the PSBT transaction using the wallet
            let wif = await this.dumpprivkeyAsync(this.myInfo.keypair.address)
            console.log('wif '+wif)
            let network = "LTC"
            if(this.test==true){
                network = "LTCTEST"
            }
            //console.log('network')
            //const signedPsbt = await signpsbtAsync(psbtHex,true)
            const signedPsbt = await signPsbtRawTx({wif:wif,network:network,psbtHex:psbtHex}, this.client);
            wif = ''
            //if (!signedPsbt || !signedPsbt.hex) return new Error('Failed to sign PSBT');
            const timeToCoSign = Date.now()-this.tradeStartTime
            console.log('Cosigned trade in '+timeToCoSign)
            console.log('complete psbt hex, finished? '+signedPsbt.data.isFinished+' '+signedPsbt.data.psbtHex)
            
            /*const psbtDecode = await decodepsbtAsync(signedPsbt.data.psbtHex)
            console.log(psbtDecode)*/
            
            const sentTx = await this.sendTxWithSpecRetry(signedPsbt.data.hex);
            //console.log(JSON.stringify(Psbt.fromHex(signedPsbt.data.psbtHex), bigIntReplacer))
            /*const decode = await decoderawtransactionAsync(signedPsbt.data.hex)
            console.log('decoded final tx '+ JSON.stringify(decode))

            // Send the signed transaction
            const sentTx = await sendrawtransactionAsync(signedPsbt.data.hex);
            if (!sentTx) return new Error('Failed to send the transaction');
            */
            // Emit the next step event
            const step5Time = Date.now() - startStep5Time; // Time taken for Step 3
                    //console.log(`Time taken for Step 5: ${step5Time} ms`);
            
            console.log('checking socket id'+this.myInfo.socketId)
            this.socket.emit(`${this.myInfo.socketId}::swap`, { eventName: 'BUYER:STEP6', socketId: this.myInfo.socketId, data: sentTx });
        } catch (error) {
            this.terminateTrade(`Step 5: ${error.message}`);
        }
    }
}

module.exports = BuySwapper;
