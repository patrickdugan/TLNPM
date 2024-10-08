const io = require('socket.io-client');
const axios = require('axios')
const util = require('util'); // Add util to handle logging circular structures
const OrderbookSession = require('./orderbook.js');  // Add the session class
const litecoinClient = require('./litecoinClient.js')


class ApiWrapper {
    constructor(baseURL, port) {
        this.baseURL = baseURL;
        this.port = port;
        this.apiUrl = `${this.baseURL}:${this.port}`;
        this.socket = null;
          // Create an instance of your TxService
        this.myInfo = {};  // Add buyer/seller info as needed
        this.client = null;  // Use a client or wallet service instance

        this._initializeSocket();
    }

    // Function to initialize a socket connection
    _initializeSocket() {
        this.socket = io(this.apiUrl, { transports: ['websocket'] });

        // Listen for connection success
        this.socket.on('connect', () => {
            console.log(`Connected to Orderbook Server with ID: ${this.socket.id}`);
        });

        // Listen for disconnect events
        this.socket.on('disconnect', (reason) => {
            console.log(`Disconnected: ${reason}`);
        });

        // Listen for order save confirmation
        this.socket.on('order:saved', (orderUuid) => {
            console.log(`Order saved with UUID: ${orderUuid}`);
        });

        // Listen for order errors
        this.socket.on('order:error', (error) => {
            console.error('Order error:', error);
        });

        // Listen for orderbook data updates
        this.socket.on('orderbook-data', (data) => {
            console.log('Orderbook Data:', data);
        });
    }

    startOrderbookSession() {
        // Initialize an OrderbookSession when the socket connects
        this.orderbookSession = new OrderbookSession(this.socket, this.myInfo, this.txsService, this.client);
    }

    // Emit a new order
    sendOrder(orderDetails) {
        return new Promise((resolve, reject) => {
            this.socket.emit('new-order', orderDetails);
            this.socket.on('order:saved', (orderUuid) => {
                resolve(orderUuid);
            });
            this.socket.on('order:error', (error) => {
                reject(error);
            });
        });
    }

    // Fetch the orderbook data through socket
    getOrderbookData(filter) {
        return new Promise((resolve, reject) => {
            this.socket.emit('update-orderbook', filter);
            this.socket.on('orderbook-data', (data) => {
                resolve(data);
            });
            this.socket.on('order:error', (error) => {
                reject(error);
            });
        });
    }

    // Cancel an existing order through socket
    cancelOrder(orderUUID) {
        return new Promise((resolve, reject) => {
            this.socket.emit('close-order', { orderUUID });
            this.socket.on('order:canceled', (confirmation) => {
                resolve(confirmation);
            });
            this.socket.on('order:error', (error) => {
                reject(error);
            });
        });
    }

   // Modified getSpotMarkets with error handling for undefined response
   // Modified getSpotMarkets with safer logging
    async getSpotMarkets() {
        try {
            const response = await axios.get(`${this.apiUrl}/markets/spot`);
            
            // Log just the response data instead of the whole response
            console.log('Spot Markets Response Data:', util.inspect(response.data, { depth: null }));

            if (response.data && response.data[0] && response.data[0].markets) {
                const markets = response.data[0].markets;
                //console.log('Spot Markets:', JSON.stringify(markets, null, 2));
                return markets;
            } else {
                throw new Error('Invalid response format: markets not found');
            }
        } catch (error) {
            console.error('Error fetching spot markets:', error.message || error);
            throw error;
        }
    }

    // Modified getFuturesMarkets with safer logging
    async getFuturesMarkets() {
        try {
            const response = await axios.get(`${this.apiUrl}/markets/futures`);
            
            // Log just the response data instead of the whole response
            //console.log('Futures Markets Response Data:', util.inspect(response.data, { depth: null }));

            if (response.data && response.data[0] && response.data[0].markets) {
                const markets = response.data[0].markets;
                //console.log('Futures Markets:', JSON.stringify(markets, null, 2));
                return markets;
            } else {
                throw new Error('Invalid response format: markets not found');
            }
        } catch (error) {
            console.error('Error fetching futures markets:', error.message || error);
            throw error;
        }
    }
}

module.exports = ApiWrapper
// Example usage
/*const api = new ApiWrapper('http://172.81.181.19', 9191);

// Example: Sending a new order
const newOrder = {
    isLimitOrder: true,
    props: {
        id_desired: 1,
        id_for_sale: 2,
        amount: 100,
        price: 0.05
    },
    action: 'BUY'
};

api.sendOrder(newOrder)
    .then(orderUuid => {
        console.log(`Order saved with UUID: ${orderUuid}`);
    })
    .catch(error => {
        console.error(`Order failed: ${error}`);
    });

// Example: Fetching orderbook data
api.getOrderbookData({ first_token: 1, second_token: 2, type: 'SPOT' })
    .then(data => {
        console.log('Orderbook Data:', data);
    })
    .catch(error => {
        console.error('Failed to fetch orderbook data:', error);
    });

*/