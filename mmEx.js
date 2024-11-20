const ccxt = require('ccxt');
const ApiWrapper = require('tradelayer');
const axios = require('axios');
const WebSocket = require('ws');
const {apiKey, secret } = require('./keys.js')
// Initialize Binance using CCXTconst ccxt = require('ccxt');
// Initialize Binance using CCXT
const binance = new ccxt.binance({
    apiKey: apiKey,
    secret: secret,
    enableRateLimit: true,
});

let inventory = {exchangeLTC:0,tlLTC:0,exchangeCash:0,tlCash:0}

// Initialize TradeLayer API
const api = new ApiWrapper('http://172.81.181.19', 9191, true);

let myInfo = { address: '', otherAddrs: [] };
const orderIds = []

// Define target exposure in LTC
const targetExposure = 1; // Example: 1 LTC
const cashPropertyId = 7
// WebSocket for Binance Spot BTC/USDT market data
const websocketUrl = 'wss://stream.binance.com:9443/ws/btcusdt@depth';
const ws = new WebSocket(websocketUrl);

// Variables for order tracking
let previousOrder = null;  // To track previous orders and cancel them

// Connect to Binance WebSocket
ws.on('message', (data) => {
    const orderBookData = JSON.parse(data);
    const bidPrice = orderBookData.bids[0][0];
    const askPrice = orderBookData.asks[0][0];

    // Adjust orders based on the orderbook data
    adjustOrders(bidPrice, askPrice);
});

// Fetch account balances from Binance
async function getBinanceAccountBalance() {
    try {
        const balance = await binance.fetchBalance();
        console.log('Binance Account Balance:', balance);
        return balance;
    } catch (error) {
        console.error('Error fetching Binance account balance:', error);
    }
}

// Fetch token balances and UTXOs from TradeLayer
async function getTradeLayerBalances(address) {
    try {
        const tokenBalances = await api.getAllTokenBalancesForAddress(address);
        const utxoData = await api.getUTXOsForAddress(address);
        console.log(`TradeLayer Balances for ${address}:`, tokenBalances);
        console.log(`TradeLayer UTXOs for ${address}:`, utxoData);
        return { tokens: tokenBalances, LTC: utxoData };
    } catch (error) {
        console.error('Error fetching data from TradeLayer:', error);
    }
}

// Adjust orders based on market conditions
async function adjustOrders(bidPrice, askPrice) {
    const orderSide = 'buy';  // Example: Place buy orders for both platforms
    const amount = 0.1; // Amount to buy/sell

    try {
        if (previousOrder) {
            // Cancel the previous order
            await binance.cancelOrder(previousOrder.symbol, previousOrder.id);
            console.log(`Canceled previous order with ID: ${previousOrder.id}`);
        }

        if(orderIds.length>0){
            for(id in orderIds){
                apis.cancelOrder(id)
            }
        }

        // Place two orders on TradeLayer
        const tradeLayerOrders = [
            {
                type: 'SPOT',
                action: 'BUY',
                props: { id_for_sale: 0, id_desired: 1, price: askPrice, amount: amount, transfer: false }
            },
            {
                type: 'SPOT',
                action: 'SELL',
                props: { id_for_sale: 1, id_desired: 0, price: bidPrice, amount: amount, transfer: false }
            }
        ];

        for (let orderDetails of tradeLayerOrders) {
            const orderUUID = await api.sendOrder(orderDetails);
            orderIds.push(orderUUID)
            console.log('Order sent on TradeLayer, UUID:', orderUUID);
            previousOrder = orderUUID;  // Store the order for potential cancellation
        }

        // Now place a corresponding hedge on Binance (opposite of what was placed on TradeLayer)
        const binanceOrders = [
            {
                symbol: 'BTC/USDT',
                type: 'LIMIT',
                side: 'sell', // Hedge the buy order on TradeLayer by selling on Binance
                price: bidPrice,
                amount: amount,
            },
            {
                symbol: 'BTC/USDT',
                type: 'LIMIT',
                side: 'buy', // Hedge the sell order on TradeLayer by buying on Binance
                price: askPrice,
                amount: amount,
            }
        ];

        // Place corresponding hedge orders on Binance
        for (let orderParams of binanceOrders) {
            const newOrder = await binance.createOrder(orderParams.symbol, orderParams.type, orderParams.side, orderParams.amount, orderParams.price);
            console.log('Placed hedge order on Binance:', newOrder);
        }

    } catch (error) {
        console.error('Error adjusting orders:', error);
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
        }, 10000);

        // Start the WebSocket connection to Binance and adjust orders based on market conditions
        ws.on('message', async (data) => {
            const orderBookData = JSON.parse(data);
            const bidPrice = orderBookData.bids[0][0];
            const askPrice = orderBookData.asks[0][0];
            await adjustOrders(bidPrice, askPrice);
        });

    } catch (error) {
        console.error('Error in market-making loop:', error);
    }
}

// Function to manage target exposure (balances)
async function manageTargetExposure() {
    const binanceBalance = await getBinanceAccountBalance();
    const tradeLayerData = await getTradeLayerBalances(myInfo.address);

    inventory.exchangeLTC = binanceBalance.total.LTC;
    inventory.exchangeCash = binanceBalance.total.USDT
    inventory.tlLTC = tradeLayerData.LTC || 0;

    for(const property in tradeLayerData.tokenBalances){
        if(property.propertyId==cashPropertyId){
            inventory.tlCash=property.amount
        }
    }
    // Check if exposure is off-target, and adjust positions
    if (binanceBTC < targetExposure) {
        const deficit = targetExposure - binanceBTC;
        console.log(`Target exposure not met, buying ${deficit} BTC from Binance`);
        // Place a buy order on Binance
        adjustOrders(deficit);
    } else if (tradeLayerLTC < targetExposure) {
        const deficit = targetExposure - tradeLayerLTC;
        console.log(`Target exposure not met, buying ${deficit} LTC from TradeLayer`);
        // Place a buy order on TradeLayer (Add your logic here)
    } else {
        console.log('Target exposure met.');
    }
}

// Run the market-making loop
api.delay(6000)
marketMakingLoop();
