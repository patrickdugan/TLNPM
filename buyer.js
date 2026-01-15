const litecore = require('bitcore-lib-ltc');
const Encode = require('./tradelayer.js/src/txEncoder.js'); // Use encoder.js for payload generation
const BigNumber = require('bignumber.js');
const { buildLitecoinTransaction, buildTokenTradeTransaction, buildFuturesTransaction, buildSignAndBroadcastCommitTx, signPsbtRawTx } = require('./litecoreTxBuilder');
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
        test,
        tradeUUID
    ) {
        this.typeTrade = typeTrade;  // 'BUY' or 'SELL'
        this.tradeInfo = tradeInfo;  // Trade information (e.g., amount, price, etc.)
        this.myInfo = buyerInfo;  // Information about the buyer
        this.cpInfo = sellerInfo;  // Information about the seller
        this.socket = socket;  // Socket connection for real-time events
        this.client = client;  // Client for making RPC calls
        this.test= test        
        this.multySigChannelData = null;  // Initialize multisig channel data
        this.tradeUUID = tradeUUID
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

    async ensureFuturesMargin(tradeProps) {
      if (this._futuresMargin) return this._futuresMargin;

      if (!tradeProps || !tradeProps.contract_id || !tradeProps.price || !tradeProps.amount) {
        throw new Error('Invalid futures trade props for margin calculation');
      }

      const { contract_id, price, amount } = tradeProps;

      // 1) Fetch contract info
      const contractInfo = await WalletListener.getContractInfo(contract_id);
      if (!contractInfo) {
        throw new Error(`No contract info for contract ${contract_id}`);
      }

      // 2) Per-contract margin
      const perContractMargin = await WalletListener.getInitialMargin(
        contract_id,
        price
      );

      if (!perContractMargin || perContractMargin <= 0) {
        throw new Error('Invalid per-contract margin');
      }

      // 3) Scale by number of contracts
      const initMargin = perContractMargin * amount;

      // 4) Collateral propertyId
      const collateral = contractInfo.collateralPropertyId;

      if (!collateral || initMargin <= 0) {
        throw new Error('Computed invalid futures margin parameters');
      }

      this._futuresMargin = {
        collateral,
        initMargin,
        perContractMargin,
        leverage: contractInfo.leverage,
        inverse: contractInfo.inverse
      };

      console.log('[FUTURES] margin prepared', this._futuresMargin);
      return this._futuresMargin;
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
        return _sendTxWithRetry(rawTx, 15, 1200);
    }

    async importMultisigNoRescan(address, redeemScriptHex) {
      const request = [{
        scriptPubKey: { address },
        redeemscript: redeemScriptHex,
        watchonly: true,
        timestamp: 'now'
      }];

      try {
        const result = await this.importmultiAsync(request, { rescan: false });

        const r = result?.[0];
        if (!r) return;

        if (!r.success) {
          if (r.error?.code === -4) {
            // Already imported → OK
            console.log('Multisig already present, continuing');
            return;
          }
          throw new Error(r.error?.message || 'importmulti failed');
        }
      } catch (err) {
        throw err;
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
            if (eventData.data?.tradeUUID && eventData.data.tradeUUID !== this.tradeUUID){
                return;
            }

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
        const startStep3Time = Date.now();
      try {
        console.log('cpId and socketId '+cpId+' '+this.cpInfo?.socketId)
        // --- guards ---
        if (cpId !== this.cpInfo?.socketId) throw new Error(`Error with p2p connection`);
         
        console.log('multi '+!this.multySigChannelData?.address)
       
        if (!this.multySigChannelData?.address) throw new Error(`Wrong Multisig Data Provided`);

        // --- block height -> expiryBlock ---
        const gbcRes = await this.getBlockCountAsync();
        console.log('gbcRes '+gbcRes)
        if (!Number.isFinite(gbcRes)) throw new Error('Failed to get block count from Litecoin node');
        const bbData = Number(gbcRes) + 10;

        // --- normalize trade kind (SPOT / FUTURES) ---
        const ti = this.tradeInfo ?? {};
        const props = ti.props ?? {};
        const kindRaw = String(this.typeTrade || ti.type || '').toUpperCase();
        const isSpot    = (kindRaw === 'SPOT') || ('propIdDesired' in props) || ('propIdForSale' in props);
        const isFutures = (kindRaw === 'FUTURES') || ('contract_id' in ti) || ('contractId' in ti);
        console.log('isFutures '+isFutures)
        if (!isSpot && !isFutures) throw new Error('Unrecognized Trade Type');

        // --- column A/B (prefer RPC if available) ---
        let isA = 1; // default A
        try {
          if (typeof WalletListener?.getColumn === 'function') {
            const col = await WalletListener.getColumn(this.myInfo?.keypair?.address, this.cpInfo?.keypair?.address);
            const tag = col?.data ?? col;
            isA = (tag === 'A') ? 0 : 1;
          }
        } catch (_) {
          // keep default isA = 1
        }
      
        console.log('column '+isA)

        // =========================
        // SPOT
        // =========================
        if (isSpot) {
          // safer props
          let {
            propIdDesired  = props.propertyId ?? 0,
            amountDesired  = props.amount    ?? 0,
            amountForSale  = props.amountForSale ?? 0,
            propIdForSale  = props.propIdForSale ?? 0,
            transfer       = props.transfer ?? false,
            sellerIsMaker  = props.sellerIsMaker ?? false,
          } = props;

           const columnAIsMaker = (isA === 1)
            ? (sellerIsMaker ? 1 : 0)     // seller is A
            : (!sellerIsMaker ? 1 : 0);   // seller is B



          // LTC vs token trade
          let ltcTrade = false;
          let ltcForSale = false;
          if (propIdDesired === 0) {
            ltcTrade = true;             // buyer wants LTC -> tokens
            ltcForSale = false;
          } else if (propIdForSale === 0) {
            ltcTrade = true;             // seller offers LTC -> buyer pays tokens
            ltcForSale = true;           // <-- this was wrong in one earlier snippet
          }

          if (ltcTrade) {
            // ========== LTC <-> TOKEN (IT) ==========
            const tokenId      = ltcForSale ? propIdDesired : propIdForSale;
            const tokensSold   = ltcForSale ? amountDesired : amountForSale;
            const satsExpected = ltcForSale ? amountForSale : amountDesired;

            const payload = Encode.encodeTradeTokenForUTXO({
              propertyId:   tokenId,
              amount:       tokensSold,
              columnA:      isA != 1,     // boolean
              satsExpected,                // sats expected on-chain
              tokenOutput:  1,             // token output index preference (as in your code)
              payToAddress: 0              // same as your call surface
            });

            const network = this.test ? "LTCTEST" : "LTC";
            const buildOptions = {
              buyerKeyPair:  this.myInfo.keypair,
              sellerKeyPair: this.cpInfo.keypair,
              commitUTXOs:   [commitUTXO],
              payload,
              amount:        satsExpected,
              network
            };

            const rawHexRes = await buildLitecoinTransaction(buildOptions, this.client);
            if (!rawHexRes?.data?.psbtHex) throw new Error(`Build IT Trade: No PSBT returned`);

            const step3Time = Date.now() - startStep3Time;
            console.log(`Time taken for Step 3: ${step3Time} ms`);

            const eventData = {
              eventName: 'BUYER:STEP4',
              socketId:  this.myInfo.socketId,
              psbtHex:   rawHexRes.data.psbtHex,
              commitTxId: '' // not available here; commit comes from SELLER
            };
            this.socket.emit(`${this.myInfo.socketId}::swap`, eventData);

          } else {
            // ========== TOKEN <-> TOKEN (Channel) ==========
            // First, fund (commit or transfer) buyer-to-channel for the side they must fund:
            const commitPayload = transfer
              ? Encode.encodeTransfer({
                  propertyId:      propIdDesired,
                  amount:          amountDesired,
                  isColumnA:       isA === 1,
                  destinationAddr: this.multySigChannelData.address,
                })
              : Encode.encodeCommit({
                  amount:         amountDesired,
                  propertyId:     propIdDesired,
                  channelAddress: this.multySigChannelData.address,
                });

            const network = this.test ? "LTCTEST" : "LTC";

            // Your NPM flow uses custom builder(s); keeping surface:
            const commitTxConfig = {
              fromKeyPair: this.myInfo.address,   // keeping your original shape
              toKeyPair:   this.cpInfo.keypair,
              payload:     commitPayload,
              network
            };

            const commitTxRes = await buildTokenTradeTransaction(commitTxConfig, this.client);
            if (!commitTxRes?.signedHex) throw new Error('Failed to sign and send the token transaction');

            // Extract UTXO from commit hex for chaining
            const utxoData = await getUTXOFromCommit(commitTxRes.signedHex, this.client);
            if (!utxoData) throw new Error('Failed to extract UTXO from commit');

            // Channel trade payload (tokens-for-tokens)
            const tradePayload = Encode.encodeTradeTokensChannel({
              propertyId1:       propIdDesired,
              propertyId2:       propIdForSale,
              amountOffered1:    amountDesired,
              amountDesired2:    amountForSale,
              columnAIsOfferer:  isA,
              expiryBlock:       bbData,
              columnAIsMaker: columnAIsMaker
            });
            console.log('keypairs '+JSON.stringify(this.myInfo.keypair)+' '+JSON.stringify(this.cpInfo.keypair))

            const tradeOptions = {
              buyerKeyPair:  this.myInfo.keypair,
              sellerKeyPair: this.cpInfo.keypair,
              commitUTXOs:   [commitUTXO, utxoData],
              payload:       tradePayload,
              amount:        0,
              network
            };

            const rawHexRes = await buildTokenTradeTransaction(tradeOptions, this.client);
            if (!rawHexRes?.psbtHex) throw new Error(`Build Trade: Failed to build token trade`);

            const step3Time = Date.now() - startStep3Time;
            console.log(`Time taken for Step 3: ${step3Time} ms`);

            this.socket.emit(
              `${this.myInfo.socketId}::swap`,
              { eventName: 'BUYER:STEP4', socketId: this.myInfo.socketId, psbtHex: rawHexRes.psbtHex, commitTxId: commitTxRes.signedHex }
            );
          }

          return; // done with SPOT
        }

        // =========================
        // FUTURES
        // =========================
        if(isFutures){
          const trade = ti; // your desktop shape puts futures fields at top-level, not in props
          const {
            contract_id,
            amount,
            price,
            transfer = props.transfer ?? false,
            sellerIsMaker = props.sellerIsMaker ?? false
          } = trade.props;

          console.log('trade props '+JSON.stringify(ti)+' '+JSON.stringify(trade))

            const margin = await this.ensureFuturesMargin(trade.props)
            const initMargin= margin.initMargin
            const collateral= margin.collateral
           

          console.log('margin and collateral '+initMargin+' '+collateral)

          // column/maker role (desktop logic)
          const columnAIsMaker = (isA === 1)
            ? (sellerIsMaker ? 1 : 0)     // seller is A
            : (!sellerIsMaker ? 1 : 0);   // seller is B

          // commit or transfer futures collateral
          const commitPayload = transfer
            ? Encode.encodeTransfer({
                propertyId:      collateral,
                amount:          initMargin,
                isColumnA:       isA === 1,
                destinationAddr: this.multySigChannelData.address,
              })
            : Encode.encodeCommit({
                propertyId:     collateral,
                amount:         initMargin,
                channelAddress: this.multySigChannelData.address,
              });

            console.log('payload '+commitPayload)
          // In buyer's onStep3:

          // Build, sign, and broadcast the commit transaction
          // This function will call listUnspent internally to get buyer's UTXO
          const commitTxRes = await buildSignAndBroadcastCommitTx({
            buyerKeyPair: this.myInfo.keypair,
            sellerKeyPair: this.cpInfo.keypair,
            payload: commitPayload,      // The commit payload (tl45...)
            multySigChannelData: this.multySigChannelData
          }, this.client);

          console.log('[STEP3] Commit tx broadcast:', JSON.stringify({
            txid: commitTxRes.txid,
            broadcast: commitTxRes.broadcast
          }));

          // The commit UTXO is already in the response
          const utxoData = commitTxRes.commitUtxoData;
          console.log('[STEP3] Commit UTXO:', JSON.stringify(utxoData));

          // Now build the settlement transaction payload
          const channelPayload = Encode.encodeTradeContractChannel({
            contractId: contract_id,
            amount,
            price,
            expiryBlock: bbData,
            columnAIsSeller: isA,
            insurance: false,
            columnAIsMaker
          });

          // Build the settlement transaction (unsigned)
          const settlementTxRes = await buildFuturesTransaction({
            buyerKeyPair: this.myInfo.keypair,
            sellerKeyPair: this.cpInfo.keypair,
            commitUTXOs: [utxoData],     // The UTXO we just created
            payload: channelPayload
          }, this.client);

          // Emit to seller
          this.socket.emit(`${this.myInfo.socketId}::swap`, {
            eventName: 'BUYER:STEP4',
            socketId: this.myInfo.socketId,
            data: {
              psbtHex: settlementTxRes.psbtHex,
              commitHex: commitTxRes.signedHex,
              commitTxId: commitTxRes.txid,
              prevTxs: settlementTxRes.prevTxs
            }
          });

          return;
        }

        throw new Error(`Unrecognized Trade Type: ${this.typeTrade}`);
      } catch (error) {
        const errorMessage = error?.message || 'Undefined Error';
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
            
            const sentTx = await this.sendTxWithSpecRetry(signedPsbt.data.finalHex);
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
