const ApiWrapper = require('./algoAPI.js');
const litecore = require('bitcore-lib-ltc');
const litecoinClient = require('./litecoinClient.js');
const api = new ApiWrapper('http://172.81.181.19', 9191);
const io = require('socket.io-client');
const axios = require('axios')
require('dotenv').config(); // Load the .env file
let myInfo = {address:'',otherAddrs:[]};

// Start listening for order matches and handle swaps
let orderbookSession = []
let savedOrderUUIDs = []; // Array to store UUIDs of orders

// Example of calling token balances
async function getTokenBalances(address) {
    try {
        const response = await api.getAllTokenBalancesForAddress(address); // Assuming this method exists
        console.log(`Token balances for address ${address}:`, response);
    } catch (error) {
        console.error('Error fetching token balances:', error);
    }
}

async function performTradeOperations(testAddress) {
      console.log("awaiting init and address load")
        await api.delay(10000);
            myInfo = api.getMyInfo()


// Call getTokenBalances with your test address
getTokenBalances(testAddress);

// Example of fetching spot markets
api.getSpotMarkets()
    .then(markets => console.log('Spot Markets:', markets))
    .catch(error => console.error('Error:', error));

api.getFuturesMarkets()
    .then(markets => console.log('Futures Markets:', markets))
    .catch(error => console.error('Error:', error));

myInfo = api.getMyInfo()

// Example of sending an order
const orderDetails = {
    type: 'SPOT',
    action: 'BUY',
    props: { id_for_sale: 0, id_desired: 1, price: 0.01, amount: 0.1, transfer: false }
};

console.log('order details '+JSON.stringify(orderDetails))
api.sendOrder(orderDetails)
    .then(orderUUID => {
        console.log('Order sent, UUID:', orderUUID);
        savedOrderUUIDs.push(orderUUID); // Save UUID to the array

        // After saving, attempt to cancel the first order in the array
        if (savedOrderUUIDs.length > 0) {
            const orderToCancel = savedOrderUUIDs[0];
            console.log(`Attempting to cancel order with UUID: ${orderToCancel}`);

            api.cancelOrder(orderToCancel)
                .then(response => {
                    console.log(`Order with UUID: ${orderToCancel} canceled successfully!`);
                })
                .catch(error => {
                    console.error(`Error canceling order with UUID: ${orderToCancel}`, error);
                });
        }
    })
    .catch(error => console.error('Error sending order:', error));

// Example of getting orderbook data
const filter = { type: 'SPOT', first_token: 0, second_token: 1 };
api.getOrderbookData(filter)
    .then(orderbookData => console.log('Orderbook Data:', orderbookData))
    .catch(error => console.error('Error fetching orderbook data:', error));
}

// Example usage of the function
performTradeOperations(myInfo.address);
