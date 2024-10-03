const ApiWrapper = require('./algoAPI.js');

const api = new ApiWrapper('http://172.81.181.19', 9191);

// Example of fetching spot markets
api.getSpotMarkets()
    .then(markets => console.log('Spot Markets:'+ markets))
    .catch(error => console.error('Error:', error));

api.getFuturesMarkets()
    .then(markets => console.log('Futures Markets:'+ markets))
    .catch(error => console.error('Error:', error));
// Example of sending an order
const orderDetails = {
    type: 'SPOT',
    action: 'BUY',
    props: { id_for_sale: 0, id_desired: 1, price: .01, amount: 0.5 },
    keypair: { address: 'some-address', pubkey: 'some-pubkey' },
    isLimitOrder: true
};

api.sendOrder(orderDetails)
    .then(orderUUID => console.log('Order sent, UUID:', orderUUID))
    .catch(error => console.error('Error:', error));

// Example of canceling an order
api.cancelOrder('some-order-uuid')
    .then(response => console.log('Order canceled:', response))
    .catch(error => console.error('Error:', error));

// Example of getting orderbook data
const filter = { type: 'SPOT', first_token: 0, second_token: 1 };
api.getOrderbookData(filter)
    .then(orderbookData => console.log('Orderbook Data:', orderbookData))
    .catch(error => console.error('Error:', error));
