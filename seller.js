const litecore = require('litecore-lib');
const Swap = require('./swap');
const TxUtils = require('./txUtils');
const WalletListener = require('./walletlistener');

class SellSwapper extends Swap {
  constructor(tradeInfo, sellerInfo, buyerInfo, socket) {
    super('SELL', tradeInfo, sellerInfo, buyerInfo, socket);
    this.handleOnEvents();
    this.initTrade();
  }

  handleOnEvents() {
    const eventName = `${this.cpInfo.socketId}::swap`;
    this.socket.on(eventName, (eventData) => {
      switch (eventData.eventName) {
        case 'BUYER:STEP2':
          this.onStep2();
          break;
        case 'BUYER:STEP4':
          this.onStep4(eventData.data);
          break;
        default:
          break;
      }
    });
  }

  async initTrade() {
    try {
      const pubKeys = [this.myInfo.keypair.pubkey, this.cpInfo.keypair.pubkey];
      const multisigAddress = litecore.Address.createMultisig(pubKeys, 2);

      const validateRes = await WalletListener.validateAddress(multisigAddress.toString());
      this.multySigChannelData = { address: multisigAddress.toString(), scriptPubKey: validateRes.scriptPubKey };

      this.socket.emit(`${this.myInfo.socketId}::swap`, { eventName: 'SELLER:STEP1', data: this.multySigChannelData });
    } catch (error) {
      this.terminateTrade(`InitTrade: ${error.message}`);
    }
  }

  async onStep2() {
    try {
      const commitPayload = await WalletListener.createPayload(this.tradeInfo.propIdForSale, this.tradeInfo.amountForSale);
      const commitTx = await TxUtils.buildTx(this.myInfo.keypair, this.multySigChannelData.address, commitPayload);

      const signedTx = await TxUtils.signTx(commitTx, this.myInfo.keypair);
      const sentTx = await WalletListener.sendTx(signedTx);

      this.socket.emit(`${this.myInfo.socketId}::swap`, { eventName: 'SELLER:STEP3', data: sentTx });
    } catch (error) {
      this.terminateTrade(`Step 2: ${error.message}`);
    }
  }

  async onStep4(psbtHex) {
    try {
      const signedPsbt = await WalletListener.signPsbt(this.myInfo.keypair, psbtHex);
      this.socket.emit(`${this.myInfo.socketId}::swap`, { eventName: 'SELLER:STEP5', data: signedPsbt });
    } catch (error) {
      this.terminateTrade(`Step 4: ${error.message}`);
    }
  }
}

module.exports = SellSwapper;
