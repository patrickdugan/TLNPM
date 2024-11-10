const ApiWrapper = require('./algoAPI.js');
const litecore = require('litecore-lib');
const litecoinClient = require('./litecoinClient.js');
const api = new ApiWrapper('http://172.81.181.19', 9191);
const OrderbookSession = require('./orderbook.js');
const io = require('socket.io-client');
const axios = require('axios')
const socket = new io('ws://172.81.181.19');
require('dotenv').config(); // Load the .env file
const myInfo = {address:'',otherAddrs:[]};

const client = litecoinClient(); // Use the litecoinClient for RPC commands

// Start listening for order matches and handle swaps
const orderbookSession = new OrderbookSession(socket, myInfo, client);
const savedOrderUUIDs = []; // Array to store UUIDs of orders

let globalSyncState = {
    realTimeModeHeight: null,
    txIndexHeight: null,
    consensusParseHeight: null
};

async function displaySyncStatus() {
    try {
        const syncData = await api.checkSync(); // Call the checkSync method
        console.log('Sync Status:', syncData); // Display the sync data in the console

        // Update global variables
        globalSyncState.realTimeModeHeight = syncData.realTimeModeHeight;
        globalSyncState.txIndexHeight = syncData.txIndexHeight;
        globalSyncState.consensusParseHeight = syncData.consensusParseHeight;

        console.log('Global Sync State Updated:', globalSyncState);
    } catch (error) {
        console.error('Error checking sync status:', error);
    }
}

async function initializeApiAndStartSync() {
    await api.initUntilSuccess(); // Call the init function and wait for it to complete
    console.log('API Initialized successfully.');

    // Start checking sync status every 10 seconds
    setInterval(displaySyncStatus, 10000);
}

// Example usage: call the function to initialize the API and start periodic sync checks
initializeApiAndStartSync();
// Example of fetching UTXO balances for a test address
async function getUTXOBalances(address) {
    try {
        const utxos = await api.listUnspent(); // Fetch unspent transactions
        const totalBalance = utxos.reduce((sum, utxo) => {
            if (utxo.address === address) {
                return sum + utxo.amount; // Sum balances for the specific address
            }else if(address==''&&myInfo.address==''){
                myInfo.address=utxo.address
                return sum+ utxo.amount
            }else if(address==''&&myInfo.address!=''){
                myInfo.otherAddrs.push(utxo.address)
                return sum+ utxo.amount
            }
            return sum;
        }, 0);
        console.log(`Total UTXO balance for address ${address}:`, totalBalance);
    } catch (error) {
        console.error('Error fetching UTXO balances:', error);
    }
}

// Call getUTXOBalances with your test address
const testAddress = myInfo.address // Replace with actual test address
getUTXOBalances(testAddress);

// Example of calling token balances
async function getTokenBalances(address) {
    try {
        const response = await api.getAllTokenBalancesForAddress(address); // Assuming this method exists
        console.log(`Token balances for address ${address}:`, response);
    } catch (error) {
        console.error('Error fetching token balances:', error);
    }
}

// Call getTokenBalances with your test address
getTokenBalances(testAddress);

// Example of fetching spot markets
api.getSpotMarkets()
    .then(markets => console.log('Spot Markets:', markets))
    .catch(error => console.error('Error:', error));

api.getFuturesMarkets()
    .then(markets => console.log('Futures Markets:', markets))
    .catch(error => console.error('Error:', error));

// Example of sending an order
const orderDetails = {
    type: 'SPOT',
    action: 'BUY',
    props: { id_for_sale: 0, id_desired: 1, price: 0.01, amount: 0.5 },
    keypair: { address: 'some-address', pubkey: 'some-pubkey' },
    isLimitOrder: true
};

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
