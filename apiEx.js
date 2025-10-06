/* @algo
{
  "name": "API Ex",
  "symbol": "TLITE/LTC",
  "venue": "TradeLayer",
  "mode": "SPOT",
  "leverage": 1,
  "timeframe": "15m",
  "description": "Simple order placement demo.",
  "tags": ["mean-reversion","btc","futures"],

  "parameters": {
    "window":   { "type": "int",    "default": 20, "min": 1,  "max": 500 },
    "zEntry":   { "type": "number", "default": 1.5, "min": 0, "max": 5, "step": 0.1 },
    "zExit":    { "type": "number", "default": 0.3, "min": 0, "max": 2, "step": 0.1 },
    "maxPos":   { "type": "int",    "default": 1,   "min": 1, "max": 10 }
  },

  "risk": {
    "stopLossPct": 2.0,
    "takeProfitPct": 3.5,
    "maxLeverage": 5
  },

  "author": "you",
  "version": "1.0.0"
}
@algo */
 
// … actual trading code below …



const ApiWrapper = require('tradelayer');
let myInfo = {address:'tltc1q89kkgaslk0lt8l90jkl3cgwg7dkkszn73u4d2t',otherAddrs:[]};
const api = new ApiWrapper('ws://172.26.37.103', 3001, true,true, myInfo, 'LTCTEST');

// Start listening for order matches and handle swaps
let orderbookSession = []
let savedOrderUUIDs = []; // Array to store UUIDs of orders


async function performTradeOperations(testAddress) {
      console.log("awaiting init and address load")
        await api.delay(6000);
            myInfo = api.getMyInfo()


// Call getTokenBalances with your test address
console.log('checking we have address loaded before tokenBalances load '+myInfo.keypair.address)
const tokenBalances = await api.getAllTokenBalancesForAddress(myInfo.keypair.address);
console.log('tokens '+JSON.stringify(tokenBalances))
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
    props: { id_for_sale: 0, id_desired:1, price: 0.0003, amount: 0.3, transfer: false }
};

await api.delay(3000) 
api.sendOrder(orderDetails)
    .then(orderUUID => {
        console.log('Order sent, UUID:', orderUUID+' '+ JSON.stringify(orderDetails));
        
        savedOrderUUIDs.push({id: orderUUID, details: orderDetails}); // Save UUID to the array
    })
    console.log('delay and test cancel')
    
    console.log(JSON.stringify(savedOrderUUIDs))
    /*console.log('about to cancel this order '+savedOrderUUIDs[0].id)
    api.cancelOrder(savedOrderUUIDs[0].id)
                .then(response => {
                    savedOrderUUIDs = savedOrderUUIDs.filter(order => order.id !== savedOrderUUIDs[0].id);
                    console.log(`Order with UUID: ${orderToCancel} canceled successfully!`);
                })*/

// Example of getting orderbook data
const filter = { type: 'SPOT', first_token: 0, second_token: 1 };
api.getOrderbookData(filter)
    .then(orderbookData => console.log('Orderbook Data:', orderbookData))
    .catch(error => console.error('Error fetching orderbook data:', error));
}

// Example usage of the function
performTradeOperations(myInfo.address);
