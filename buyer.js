const litecore = require('litecore-lib');
const Swap = require('./swap');
const Encode = require('./encoder'); // Use encoder.js for payload generation
const BigNumber = require('bignumber.js');
const { buildLitecoinTransaction, buildTokenTradeTransaction, buildFuturesTransaction, getUTXOFromCommit } = require('./litecoreTxBuilder');
const WalletListener = require('./walletListener'); // Import WalletListener to use tl_getChannelColumn
 // Bitcoin RPC module
const util = require('util');

const createclient = require('./client');  // Adjust the path as necessary

// Create a testnet or mainnet client
const client = createclient(true);  // Pass 'true' for testnet, 'false' for mainnet


// Promisify the necessary client functions
const getRawTransactionAsync = util.promisify(client.getRawTransaction.bind(client));
const getBlockDataAsync = util.promisify(client.getBlock.bind(client))
const createRawTransactionAsync = util.promisify(client.createRawTransaction.bind(client));
const listUnspentAsync = util.promisify(client.cmd.bind(client, 'listunspent'));
const decoderawtransactionAsync = util.promisify(client.cmd.bind(client, 'decoderawtransaction'));
const dumpprivkeyAsync = util.promisify(client.cmd.bind(client, 'dumpprivkey'))
const sendrawtransactionAsync = util.promisify(client.cmd.bind(client,'sendrawtransaction'))
const validateAddress = util.promisify(client.cmd.bind(client,'validateaddress'))
const getBlockCountAsync = util.promisify(client.cmd.bind(client, 'getblockcount'))
const loadWalletAsync = util.promisify(client.cmd.bind(client, 'loadwallet'))



class BuySwapper extends Swap {
  constructor(tradeInfo, buyerInfo, sellerInfo, socket) {
    super('BUY', tradeInfo, buyerInfo, sellerInfo, socket);
    this.handleOnEvents();
    this.onReady();
  }

  handleOnEvents() {
    const eventName = `${this.cpInfo.socketId}::swap`;
    this.socket.on(eventName, (eventData) => {
      switch (eventData.eventName) {
        case 'SELLER:STEP1':
          this.onStep1(eventData);
          break;
        case 'SELLER:STEP3':
          this.onStep3(eventData);
          break;
        case 'SELLER:STEP5':
          this.onStep5(eventData);
          break;
        default:
          break;
      }
    });
  }

  // Step 1: Create multisig address and verify
  async onStep1(msData) {
    try {
      const pubKeys = [this.myInfo.address.pubkey, this.cpInfo.keypair.pubkey].map(litecore.PublicKey);
      const multisigAddress = litecore.Address.createMultisig(pubKeys, 2);
      
      if (multisigAddress.toString() !== msData.address) {
        throw new Error('Multisig address mismatch');
      }

      this.multySigChannelData = msData;
      this.socket.emit(`${this.myInfo.socketId}::swap`, { eventName: 'BUYER:STEP2' });
    } catch (error) {
      this.terminateTrade(`Step 1: ${error.message}`);
    }
  }

async onStep3(cpId, commitUTXO, trade) {
    this.logTime('Step 3 Start');
    try {
        if (cpId !== this.cpInfo.socketId) throw new Error(`Error with p2p connection`);
        if (!this.multySigChannelData) throw new Error(`Wrong Multisig Data Provided`);

        // **Fetch the current block count**
        const gbcRes = await client.getBlockCount();
        if (!gbcRes) throw new Error('Failed to get block count from Litecoin node');
        const bbData = gbcRes + 1000; // For expiryBlock calculation

        // **Step 1: Determine the type of trade (Futures or Spot)**
        if (this.typeTrade === ETradeType.SPOT && 'propIdDesired' in trade) {
            const { propIdDesired, amountDesired, amountForSale, propIdForSale, transfer } = trade;
            console.log('importing transfer', transfer);
            if (transfer === undefined) transfer = false;

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
                const column = await WalletListener.tl_getChannelColumn(this.myInfo.address.address, this.cpInfo.keypair.address);
                const isA = column === 'A' ? 1 : 0;

                const payload = ENCODER.encodeTradeTokenForUTXO({
                    propertyId: ltcForSale ? propIdForSale : propIdDesired,
                    amount: ltcForSale ? amountForSale : amountDesired,
                    columnA: isA,
                    satsExpected: ltcForSale ? amountDesired : amountForSale,
                    tokenOutput: 0,
                    payToAddress: 1
                });

                const buildOptions = {
                    buyerKeyPair: this.myInfo.address,
                    sellerKeyPair: this.cpInfo.keypair,
                    commitUTXOs: [commitUTXO],
                    payload,
                    amount: amountForSale,
                };

                // **Build Litecoin Transaction**
                const rawHexRes = await buildLitecoinTransaction(buildOptions);
                if (!rawHexRes?.psbtHex) throw new Error(`Build Trade: Failed to build Litecoin transaction`);
                const swapEvent = new SwapEvent('BUYER:STEP4', this.myInfo.socketId, rawHexRes.psbtHex);
                this.socket.emit(`${this.myInfo.socketId}::swap`, swapEvent);

            } else {
                // **Handle Token Trades**
                let payload;
                if (transfer) {
                    payload = ENCODER.encodeTransfer({
                        propertyId: propIdDesired,
                        amount: amountDesired,
                        isColumnA: true, // Adjust as needed
                        destinationAddr: this.multySigChannelData.address,
                    });
                } else {
                    payload = ENCODER.encodeCommit({
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
                if (!commitTxRes?.signedHex) throw new Error('Failed to sign and send the token transaction');

                // **Extract UTXO from commit**
                const utxoData = await getUTXOFromCommit(commitTxRes.signedHex);

                const tradePayload = ENCODER.encodeTradeTokensChannel({
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
                if (!rawHexRes?.psbtHex) throw new Error(`Build Trade: Failed to build token trade`);

                const swapEvent = new SwapEvent('BUYER:STEP4', this.myInfo.socketId, rawHexRes.psbtHex);
                this.socket.emit(`${this.myInfo.socketId}::swap`, swapEvent);
            }

        } else if (this.typeTrade === ETradeType.FUTURES && 'contract_id' in trade) {
            // **Handle Futures Trade**
            const { contract_id, amount, price, transfer } = trade;
            let payload;
                if (transfer) {
                    payload = ENCODER.encodeTransfer({
                        propertyId: propIdDesired,
                        amount: amountDesired,
                        isColumnA: true, // Adjust as needed
                        destinationAddr: this.multySigChannelData.address,
                    });
                } else {
                    payload = ENCODER.encodeCommit({
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

            const futuresPayload = ENCODER.encodeTradeContractChannel({
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

            const swapEvent = new SwapEvent('BUYER:STEP4', this.myInfo.socketId, rawHexRes.psbtHex);
            this.socket.emit(`${this.myInfo.socketId}::swap`, swapEvent);

        } else {
            throw new Error(`Unrecognized Trade Type: ${this.typeTrade}`);
        }

    } catch (error) {
        const errorMessage = error.message || 'Undefined Error';
        this.terminateTrade(`Step 3: ${errorMessage}`);
    }
}

  // Step 5: Sign the PSBT using Litecore and send the final transaction
  async onStep5(psbtHex) {
      try {
          // Sign the PSBT transaction using the wallet
          const signedPsbt = await signrawtransactionwithwalletAsync(psbtHex);
          if (!signedPsbt || !signedPsbt.hex) throw new Error('Failed to sign PSBT');

          // Send the signed transaction
          const sentTx = await sendrawtransactionAsync(signedPsbt.hex);
          if (!sentTx) throw new Error('Failed to send the transaction');

          // Emit the next step event
          this.socket.emit(`${this.myInfo.socketId}::swap`, { eventName: 'BUYER:STEP6', data: sentTx });
      } catch (error) {
          this.terminateTrade(`Step 5: ${error.message}`);
      }
  }


  // Helper function to send transaction (placeholder)
  async sendTx(signedTx) {
    // Implement transaction broadcast logic here
    console.log('Sending transaction:', signedTx);
    // Simulate transaction broadcasting
    return 'txid_placeholder';
  }
}

module.exports = BuySwapper;
