const litecore = require('litecore-lib');
const Swap = require('./swap');
const TxUtils = require('./txUtils'); // This contains the custom transaction building methods
const WalletListener = require('./walletlistener'); // Manages the wallet connection

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

  async onStep1(msData) {
    try {
      const pubKeys = [this.myInfo.keypair.pubkey, this.cpInfo.keypair.pubkey];
      const multisigAddress = litecore.Address.createMultisig(pubKeys, 2);
      if (multisigAddress.toString() !== msData.address) throw new Error('Multisig address mismatch');

      this.multySigChannelData = msData;
      this.socket.emit(`${this.myInfo.socketId}::swap`, { eventName: 'BUYER:STEP2' });
    } catch (error) {
      this.terminateTrade(`Step 1: ${error.message}`);
    }
  }

  async onStep3(commitUTXO) {
    try {
      const { propIdDesired, amountDesired, amountForSale } = this.tradeInfo;

      const commitPayload = await WalletListener.createPayload(propIdDesired, amountDesired);
      const commitTx = await TxUtils.buildTx(commitUTXO, this.multySigChannelData.address, commitPayload);

      const signedTx = await TxUtils.signTx(commitTx, this.myInfo.keypair);
      const sentTx = await WalletListener.sendTx(signedTx);

      this.socket.emit(`${this.myInfo.socketId}::swap`, { eventName: 'BUYER:STEP4', data: sentTx });
    } catch (error) {
      this.terminateTrade(`Step 3: ${error.message}`);
    }
  }

  async onStep5(psbtHex) {
    try {
      const signedPsbt = await WalletListener.signPsbt(this.myInfo.keypair, psbtHex);
      const finalTx = await WalletListener.sendTx(signedPsbt);

      this.socket.emit(`${this.myInfo.socketId}::swap`, { eventName: 'BUYER:STEP6', data: finalTx });
    } catch (error) {
      this.terminateTrade(`Step 5: ${error.message}`);
    }
  }
}

module.exports = BuySwapper;
