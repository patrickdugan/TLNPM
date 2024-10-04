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

npm install tradelayer-npm
```
## Step 2: Navigate to the package folder

Change directory to the folder where the NPM package is installed:

```bash
cd node_modules/tradelayer-npm
```
## Step 3: Run the setup script

Run the included setup script `setup.sh` to automatically:

- Fetch and install Litecoin binaries.
- Start `litecoind`.
- Clone the TradeLayer.js repository and check out the correct branch (`txIndexRefactor`).
- Start the TradeLayer API.

```bash
./setup.sh
```
### Step 4: Wait for litecoind to be fully synchronized

Before running any RPC commands, wait for the Litecoin node to fully synchronize. You can check the progress by running the following command:

```bash
litecoin-cli -conf=litecoin.conf getblockchaininfo
```
### Step 5: Generate a new address and create an `.env` file

After litecoind is fully synced, run the `address.sh` script to generate a new Litecoin address and save it into a `.env` file. This address will be used in the API for transactions.

```bash
./address.sh
```
The .env file will be created in the current directory, containing the generated address.

### Step 6: Verify the setup

Once the script completes, `litecoind` and the TradeLayer API should be running successfully. You can check the logs for any issues or verify the blockchain sync status using the following command:

```bash
litecoin-cli -conf=litecoin.conf getblockchaininfo
```

If everything is set up properly, the API should be available, and you can begin working with the TradeLayer decentralized orderbook.
Updated apiEx.js

We will modify apiEx.js to use the newly created .env file to populate the user address.

```js

require('dotenv').config();  // Load the .env file

// Assuming myKeyPair is already generated or imported elsewhere
const myKeyPair = { /* keypair generation logic */ };

const myInfo = { 
    address: process.env.USER_ADDRESS,  // Load address from .env
    keypair: myKeyPair 
};

console.log("User Address: ", myInfo.address);

// Your API logic here...
```
This uses the dotenv package to load environment variables from the .env file, specifically the USER_ADDRESS that was generated in the address.sh script.

Here's the rest of the example script to illustrate:


```js

const ApiWrapper = require('./algoAPI.js');
const litecore = require('litecore')

const api = new ApiWrapper('http://172.81.181.19', 9191);

const socket = new SocketClient('ws://172.81.181.19');
const myInfo = { address: process.env.USER_ADDRESS, pubkey:process.env.USER_PUBKEY}
require('dotenv').config();  // Load the .env file
const txsService = new TxsService(); // Assuming you have a transaction service
const client = litecoinClient; // Use the litecoinClient for RPC commands

// Start listening for order matches and handle swaps
const orderbookSession = new OrderbookSession(socket, myInfo, txsService, client);


const savedOrderUUIDs = []; // Array to store UUIDs of orders

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