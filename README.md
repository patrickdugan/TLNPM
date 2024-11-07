# TradeLayer NPM Setup Guide

This NPM package helps you connect to the TradeLayer API, set up a Litecoin node, and perform peer-to-peer trading on decentralized orderbooks. Follow the steps below to initialize the environment and get everything running smoothly.

## Prerequisites

- **Node.js**: Ensure that you have Node.js installed. You can download it from [here](https://nodejs.org/).
- **Git**: Git must be installed on your system. You can download Git from [here](https://git-scm.com/).
- **wget**: Ensure you have wget installed to download the Litecoin binaries.

## Installation and Setup

### Step 1: Install the NPM package

In the directory of your choice, run the following command to install this package:

```bash

npm i tradelayer
```
## Step 2: Setup

To run the TradeLayer setup script, use the following command from the root of your project where the NPM package is installed, chose the win or lin version for Windos and Linux formatting differences:

```

cd node_modules/tradelayer/

./setup-win.sh

./setup-lin.sh
```
If you get an err "Permission denied" running the bash, try:

```
chmod +x setup-lin.sh
```

Run the included setup script to automatically:

- Fetch and install Litecoin binaries.
- defines litecoin.conf file with default user/pass credentials and 18332 testnet port
- Start `litecoind`.
- Clone the TradeLayer.js repository and check out the correct branch (`txIndexRefactor`).
- waits for RPC to become available on litecoind
- Generates an address and saves to .env
- Start the TradeLayer API.

Here's the rest of the example script to illustrate:


```js

const ApiWrapper = require('tradelayer');
const litecore = require('litecore-lib');
const litecoinClient = require('tradelayer/litecoinClient');
const api = new ApiWrapper('http://172.81.181.19', 9191);
const OrderbookSession = require('tradelayer/orderbook');
const io = require('socket.io-client');
const socket = new io('ws://172.81.181.19');
const myInfo = { address: process.env.USER_ADDRESS, pubkey: process.env.USER_PUBKEY };
require('dotenv').config(); // Load the .env file
const client = litecoinClient(); // Use the litecoinClient for RPC commands

// Start listening for order matches and handle swaps
const orderbookSession = new OrderbookSession(socket, myInfo, client);
const savedOrderUUIDs = []; // Array to store UUIDs of orders

// Function to call the init method and check for success
async function initUntilSuccess() {
    let success = false;

    while (!success) {
        try {
            const response = await axios.post(`${serverUrl}/tl_initmain`, { test: true });
            success = response.data.success; // Assuming the response contains a 'success' field
            console.log('Init response:', response.data);
            if (!success) {
                console.log('Init not successful, retrying...');
                await new Promise(resolve => setTimeout(resolve, 5000)); // Wait before retrying
            }
        } catch (error) {
            console.error('Error during init:', error.response ? error.response.data : error.message);
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait before retrying
        }
    }

    console.log('Init successful!');
}

// Call the init function
initUntilSuccess();

// Example of fetching UTXO balances for a test address
async function getUTXOBalances(address) {
    try {
        const utxos = await client.listUnspent(); // Fetch unspent transactions
        const totalBalance = utxos.reduce((sum, utxo) => {
            if (utxo.address === address) {
                return sum + utxo.amount; // Sum balances for the specific address
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
        const response = await api.getAllBalancesForAddress(address); // Assuming this method exists
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

```