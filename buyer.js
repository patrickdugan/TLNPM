const litecore = require('litecore-lib');
const Swap = require('./swap');
const Encode = require('./encoder'); // Use encoder.js for payload generation
const BigNumber = require('bignumber.js');

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
      const pubKeys = [this.myInfo.keypair.pubkey, this.cpInfo.keypair.pubkey].map(litecore.PublicKey);
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

  // Step 3: Build and sign the transaction using Litecore and encoder.js
  async onStep3(commitUTXO) {
    try {
      const { propIdDesired, amountDesired, amountForSale } = this.tradeInfo;

      // Use encoder.js to generate the commit payload
      const commitPayload = Encode.encodeCommit({
        propertyId: propIdDesired,
        amount: amountDesired,
        channelAddress: this.multySigChannelData.address,
      });

      // Build the transaction with Litecore using the UTXO and payload
      const utxo = new litecore.Transaction.UnspentOutput({
        txid: commitUTXO.txid,
        vout: commitUTXO.vout,
        address: this.multySigChannelData.address,
        scriptPubKey: commitUTXO.scriptPubKey,
        amount: commitUTXO.amount
      });

      const transaction = new litecore.Transaction()
        .from(utxo)
        .addOutput(new litecore.Transaction.Output({
          script: litecore.Script.buildDataOut(commitPayload),
          satoshis: new BigNumber(amountForSale).times(1e8).toNumber() // Convert to satoshis
        }))
        .sign(this.myInfo.keypair.privateKey); // Sign the transaction with buyer's private key

      // Send the signed transaction
      const sentTx = await this.sendTx(transaction.toString()); // Implement sendTx

      // Notify the seller that step 3 is complete
      this.socket.emit(`${this.myInfo.socketId}::swap`, { eventName: 'BUYER:STEP4', data: sentTx });
    } catch (error) {
      this.terminateTrade(`Step 3: ${error.message}`);
    }
  }

  // Step 5: Sign the PSBT using Litecore and send the final transaction
  async onStep5(psbtHex) {
    try {
      const psbt = litecore.Transaction(psbtHex);
      const signedPsbt = psbt.sign(this.myInfo.keypair.privateKey); // Sign the PSBT

      // Send the final transaction
      const finalTx = await this.sendTx(signedPsbt.toString());

      // Notify the seller that the transaction is complete
      this.socket.emit(`${this.myInfo.socketId}::swap`, { eventName: 'BUYER:STEP6', data: finalTx });
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
