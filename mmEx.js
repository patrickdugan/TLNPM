/**
 * @algo-meta
 * {
 *   "name": "mmEx"
 *   "description": "Simple market making strategy on LTC/USDT"
 *   "mode": "SPOT",
 *   "market": "LTC/USDT",
 *   "exchange": "binance",
 *   "instrument": "LTC",
 *   "counterAsset": "USDT"
 * }
 */

const fs = require("fs");
const path = require("path");

const LOG_PATH = path.join(process.env.HOME || process.env.USERPROFILE, "Downloads", "mmEx.log");
const logStream = fs.createWriteStream(LOG_PATH, { flags: "a" });

function logLine(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  if (!logStream.destroyed) logStream.write(line);
}


const ccxt = require('ccxt');
const ApiWrapper = require('./algoAPI.js');
const axios = require('axios');
const WebSocket = require('ws');
const {apiKey, secret } = require('./keys.js')
const BigNumber = require('bignumber.js')
// Initialize Binance using CCXTconst ccxt = require('ccxt');
// Initialize Binance using CCXT
const binance = new ccxt.binance({
    apiKey: apiKey,
    secret: secret,
    enableRateLimit: true,
});

let inventory = {exchangeLTC:0,tlLTC:0,exchangeCash:0,tlCash:0}
const MAX_INVENTORY = 30; // adjust

// Initialize TradeLayer API

let myInfo = { address: 'tltc1qvlwcnwlhnja7wlj685ptwxej75mms9nyv7vuy8', otherAddrs: [] };
const api = new ApiWrapper('ws://172.26.37.103', 3001, true,true,myInfo, 'LTCTEST');

let orderIds = []

// Define target exposure in LTC// Normalize the key to match what allocateAlgo wrote
const envKey = 'MMEX_TARGET_EXPOSURE';
const targetExposure = Number(process.env[envKey] ?? 1);
const cashPropertyId = 5
// WebSocket for Binance Spot BTC/USDT market data
const websocketUrl = 'wss://stream.binance.com:9443/ws';
const ws = new WebSocket(websocketUrl);

ws.on('open', () => {
    const subscriptionMessage = JSON.stringify({
        method: 'SUBSCRIBE',
        params: [
            'ltcusdt@depth'
        ],
        id: 1
    });
    ws.send(subscriptionMessage);
    logLine('Subscribed to btcusdt@aggTrade and btcusdt@depth');
});


// Variables for order tracking
    let previousOrders = [];  // To track previous orders and cancel them
    function sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    let bidPrice = null
    let askPrice = null
// Connect to Binance WebSocket
ws.on('message', (data) => {
    const orderBookData = JSON.parse(data);
    try{  
        if(!orderBookData||!orderBookData.b||!orderBookData.a){
                    logLine('orderBookData issue')
        }else{
            bidPrice = orderBookData.b[0][0] || null;
            askPrice = orderBookData.a[0][0] || null;
        }
        if(bidPrice!=null&&askPrice!=null){
                logLine('updating prices outside func '+bidPrice+askPrice)
        }
    }catch(err){
        logLine('err with incoming exchange data '+err)
    }
});

// Fetch account balances from Binance
async function getBinanceAccountBalance() {
    try {
        const balance = await binance.fetchBalance();
        //logLine('Binance Account Balance:', balance)
        return balance || {'total':{'BTC': 0,'LTC':0,'USDT':0}};
    } catch (error) {
        console.error('Error fetching Binance account balance:', error);
    }
}

    // Fetch token balances and UTXOs from TradeLayer
    async function getTradeLayerBalances(address) {
        try {
            const tokenBalances = await api.getAllTokenBalancesForAddress(address);
            const utxoData = await api.getUTXOBalances(address);
            logLine(`TradeLayer Balances for ${address}:`, tokenBalances);
            logLine(`TradeLayer UTXOs for ${address}:`, utxoData);
            return { tokens: tokenBalances, LTC: utxoData };
        } catch (error) {
            console.error('Error fetching data from TradeLayer:', error);
        }
    }

    // Adjust orders based on market conditions
    async function adjustOrders(bidPrice, askPrice) {
        const orderSide = 'buy';  // Example: Place buy orders for both platforms
        const amount = 0.1; // Amount to buy/sell

        if(bidPrice==null||askPrice==null){return}
        let mid = askPrice-bidPrice/2
        //try {
            /*try{
                if (previousOrders) {
                    // Cancel the previous order
                    await binance.cancelOrder("LTC/USDT", previousOrders.id);
                    logLine(`Canceled previous order with ID: ${previousOrder.id}`);
                }
            }catch(error){
                logLine('error canceling on Binance '+error)
            }*/


            const tlBid = new BigNumber(bidPrice).times(0.999925).toNumber()
            const tlAsk = new BigNumber(askPrice).times(1.000075).toNumber()
            const tlBid2 = new BigNumber(bidPrice).times(0.99985).toNumber()
            const tlAsk2 = new BigNumber(askPrice).times(1.000125).toNumber() 

            orderIds = api.getOrders() 

            //logLine("My Orders: ", orderIds);  // Debug log to check structure


            logLine('tl order ids length '+orderIds.length)

            if(orderIds.length>0){
                for (let i = 0; i < orderIds.length; i++){
                    let order = orderIds[i]
                    logLine('showing element in myOrders' +JSON.stringify(order))
                    if(order.details!=undefined){
                        logLine('checking orders to cancel '+order.details.action+' '+order.details.props.price)
                        if((order.details.action=="BUY"&&order.details.props.price>tlBid)||(order.details.action=="SELL"&&order.details.props.price<tlAsk)){
                             api.cancelOrder(order.id)
                        }
                    }else{
                         orderIds.pop(id)
                        logLine('Orders coming in undefined, check socket connection '+JSON.stringify(id))
                        logLine('order Ids post removal '+orderIds.length)
                    }
                }
            }
           
            // Place two orders on TradeLayer
            const tradeLayerOrders = [
                {
                    type: 'SPOT',
                    action: 'BUY',
                    props: { id_for_sale: cashPropertyId, id_desired: 0, price: tlBid, amount: amount, transfer: false }
                },
                {
                    type: 'SPOT',
                    action: 'SELL',
                    props: { id_for_sale: 0, id_desired: cashPropertyId, price: tlAsk, amount: amount, transfer: false }
                },
                {
                    type: 'SPOT',
                    action: 'BUY',
                    props: { id_for_sale: cashPropertyId, id_desired: 0, price: tlBid2, amount: amount, transfer: false }
                },
                {
                    type: 'SPOT',
                    action: 'SELL',
                    props: { id_for_sale: 0, id_desired: cashPropertyId, price: tlAsk2, amount: amount, transfer: false }
                }
            ];

            logLine('tl Orders '+JSON.stringify(tradeLayerOrders))

            for (let orderDetails of tradeLayerOrders) {
                try{
                    const orderUUID = await api.sendOrder(orderDetails);
                    //orderIds.push({details: orderDetails,id:orderUUID})
                    logLine('Order sent on TradeLayer, UUID:', orderUUID);
                    previousOrders.push({ orderUUID, details: orderDetails });
                }catch(err){
                    logLine('err with tl order '+err)
                }            
            }

            // prune orders too far from market
            if (mid) {
              cancelOutOfSyncOrders(bidPrice,askPrice,mid)
            }

            // Now place a corresponding hedge on Binance (opposite of what was placed on TradeLayer)
            const binanceOrders = [
                {
                    symbol: 'LTC/USDT',
                    type: 'MARKET',
                    side: 'sell', // Hedge the buy order on TradeLayer by selling on Binance
                    //price: bidPrice,
                    amount: amount,
                },
                {
                    symbol: 'LTC/USDT',
                    type: 'MARKET',
                    side: 'buy', // Hedge the sell order on TradeLayer by buying on Binance
                    //price: askPrice,
                    amount: amount,
                }
            ];

            // Place corresponding hedge orders on Binance
                for (let orderParams of binanceOrders) {
                    try{
                        const newOrder = await binance.createOrder(orderParams.symbol, orderParams.type, orderParams.side, orderParams.amount, orderParams.price);
                        logLine('Placed hedge order on Binance:', newOrder);
                    }catch(err){
                        logLine('error posting Binance order '+err)
                    }
                    
                }

            //} catch (error) {
            //    console.error('Error adjusting orders:', error);
            //}
        }

    async function cancelOutOfSyncOrders(binanceBid, binanceAsk,mid) {

        const THRESHOLD_BPS = 10; // 10 basis points = 0.1%

      for (let i = previousOrders.length - 1; i >= 0; i--) {
        const o = previousOrders[i];
        const pctDiff = Math.abs(o.details.price - mid) / mid;
                if (pctDiff > THRESHOLD_BPS / 10000) {
                  try {
                    await api.cancelOrder(o.orderUUID);
                    logLine(`Canceled stale order ${o.orderUUID} @ ${o.details.price}`);
                    previousOrders.splice(i, 1);
                  } catch (err) {
                    logLine('err canceling order ' + err);
                  }
                }

        // Bids that are more aggressive than Binance bid
        if (o.side === 'BUY' && o.price > binanceBid) {
          await cancelAndRemove(o, i, 'bid > Binance bid');
        }

        // Asks that are more aggressive than Binance ask
        if (o.side === 'SELL' && o.price < binanceAsk) {
          await cancelAndRemove(o, i, 'ask < Binance ask');
        }
      }
    }

    async function cancelAndRemove(order, index, reason) {
      try {
        await api.cancelOrder(order.orderUUID);
        logLine(`Canceled ${order.side} ${order.orderUUID} @ ${order.price} (${reason})`);
        previousOrders.splice(index, 1);
      } catch (err) {
        logLine(`Error canceling order ${order.orderUUID}`, err);
      }
    }

// Main loop for the Market Maker Bot
async function marketMakingLoop() {
    try {
        // Start by fetching initial data
        await getBinanceAccountBalance();
        await getTradeLayerBalances(myInfo.address);

        // Every 10 seconds, check and update target exposure
        setInterval(async () => {
            await manageTargetExposure();
            // Adjust orders based on the orderbook data
            if (bidPrice != null && askPrice != null) {
              await adjustOrders(bidPrice, askPrice);
            }
        }, 500);

        // Start the WebSocket connection to Binance and adjust orders based on market conditions
        /*ws.on('message', async (data) => {
            const orderBookData = JSON.parse(data);
            logLine('ws ping '+Date.now())
            //logLine('orderBookData '+JSON.stringify(orderBookData))
            let bidPrice = null
            let askPrice = null

            if(!orderBookData||!orderBookData.b||!orderBookData.a){
                logLine('orderBookData issue')
            }else if(){
                bidPrice = orderBookData.b[0][0] || null;
                askPrice = orderBookData.a[0][0] || null;
            }
            if(bidPrice!=null&&askPrice!=null){
                logLine('updating prices '+bidPrice+' ' +askPrice)
                await adjustOrders(bidPrice, askPrice);
            }
        });*/

    } catch (error) {
        console.error('Error in market-making loop:', error);
    }
}

// Function to manage target exposure (balances)
async function manageTargetExposure() {
    const binanceBalance = await getBinanceAccountBalance();
    const tradeLayerData = await getTradeLayerBalances(myInfo.address);
    if(binanceBalance){
        inventory.exchangeLTC = binanceBalance.total.LTC || 0;
        inventory.exchangeCash = binanceBalance.total.USDT || 0
    }else{
        inventory.exchangeLTC = 0;
        inventory.exchangeCash = 0;
    }
    //logLine('tradelayer Data '+JSON.stringify(tradeLayerData))
    if(tradeLayerData!=undefined&&tradeLayerData.LTC!=undefined){
        inventory.tlLTC = tradeLayerData.LTC || 0;
    }

    if(tradeLayerData!=undefined&&tradeLayerData.tokenBalances!=undefined){
        for(const property in tradeLayerData.tokenBalances){
            if(property.propertyId==cashPropertyId){
                inventory.tlCash=property.amount
            }
        }
    }
    
    // Check if exposure is off-target, and adjust positions
    if (inventory.exchangeLTC < targetExposure) {
        const deficit = targetExposure - inventory.exchangeLTC;
        logLine(`Target exposure not met, buying ${deficit} LTC from Binance`);
        // Place a buy order on Binance
        //adjustOrders(deficit);
    } else if (inventory.tlLTC < targetExposure) {
        const deficit = targetExposure - inventory.tlLTC;
        logLine(`Target exposure not met, buying ${deficit} LTC from TradeLayer`);
        // Place a buy order on TradeLayer (Add your logic here)
    } else {
        logLine('Target exposure met.');
    }
}

// Run the market-making loop
api.delay(6000)
marketMakingLoop();