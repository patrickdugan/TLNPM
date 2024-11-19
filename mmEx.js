const ccxt = require('ccxt');
const ApiWrapper = require('tradelayer');
const axios = require('axios');
const WebSocket = require('ws');

// Initialize Binance using CCXT
const binance = new ccxt.binance({
    apiKey: 'your-api-key',
    secret: 'your-api-secret',
    enableRateLimit: true,
});

// Initialize TradeLayer API
const api = new ApiWrapper('http://172.81.181.19', 9191, true);

let myInfo = { address: '', otherAddrs: [] };

// Example of setting up WebSocket connection to Binance Spot BTC/USDT market
const websocketUrl = 'wss://stream.binance.com:9443/ws/btcusdt@depth';
const ws = new WebSocket(websocketUrl);

// Variables for order tracking
let previousOrder = null;  // To track previous orders and cancel them
let savedOrderUUIDs = [];

// Define target exposure in LTC
const targetExposure = 1; // Example: 1 LTC

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

// Fetch token balances and UTXO from TradeLayer
async function getTradeLayerBalances(address) {
    try {
        const tokenBalances = await api.getAllTokenBalancesForAddress(address);
        const utxoData = await api.getUTXOsForAddress(address);
        console.log(`TradeLayer Balances for ${address}:`, tokenBalances);
        console.log(`TradeLayer UTXOs for ${address}:`, utxoData);
        return { tokenBalances, utxoData };
    } catch (error) {
        console.error('Error fetching data from TradeLayer:', error);
    }
}

// Adjust orders based on market conditions
async function adjustOrders(bidPrice, askPrice) {
    const orderSide = 'buy';  // For example, we'll place a buy order
    const amount = 0.1; // Amount to buy/sell

    try {
        if (previousOrder) {
            // Cancel the previous order
            await binance.cancelOrder(previousOrder.symbol, previousOrder.id);
            console.log(`Canceled previous order with ID: ${previousOrder.id}`);
        }

        // Place a new order (Buy or Sell)
        const orderParams = {
            symbol: 'BTC/USDT',
            type: 'LIMIT',
            side: orderSide,
            price: orderSide === 'buy' ? bidPrice : askPrice,
            amount: amount,
        };

        const newOrder = await binance.createOrder(orderParams.symbol, orderParams.type, orderParams.side, orderParams.amount, orderParams.price);
        console.log('Placed new order:', newOrder);

        // Store the new order details for cancellation on the next loop
        previousOrder = newOrder;

    } catch (error) {
        console.error('Error adjusting orders:', error);
    }
}

// Manage target exposure
async function manageTargetExposure() {
    // Fetch Binance balances
    const binanceBalance = await getBinanceAccountBalance();

    // Fetch TradeLayer balances and UTXOs
    const tradeLayerData = await getTradeLayerBalances(myInfo.address);

    const binanceBTC = binanceBalance.total.BTC;
    const tradeLayerLTC = tradeLayerData.tokenBalances['LTC'] || 0;

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

// Main loop for the Market Maker Bot
async function marketMakingLoop() {
    try {
        // Start by fetching initial data
        await getBinanceAccountBalance();
        await getTradeLayerBalances(myInfo.address);

        // Start the WebSocket connection to Binance and adjust orders based on market conditions
        ws.on('message', async (data) => {
            const orderBookData = JSON.parse(data);
            const bidPrice = orderBookData.bids[0][0];
            const askPrice = orderBookData.asks[0][0];
            await adjustOrders(bidPrice, askPrice);
        });

        // Every 10 seconds, check and update target exposure
        setInterval(async () => {
            await manageTargetExposure();
        }, 500);

    } catch (error) {
        console.error('Error in market-making loop:', error);
    }
}

// Run the market-making loop
marketMakingLoop();
