const io = require('socket.io-client');
const axios = require('axios')
const util = require('util'); // Add util to handle logging circular structures
const OrderbookSession = require('./orderbook.js');  // Add the session class
const createLitecoinClient = require('./litecoinClient.js');
const client = createLitecoinClient(); // Call the function to create the client
const walletListener = require('./tradelayer.js/src/walletInterface');



class ApiWrapper {
    constructor(baseURL, port) {
        this.baseURL = baseURL;
        this.port = port;
        this.apiUrl = `${this.baseURL}:${this.port}`;
        this.socket = null;
          // Create an instance of your TxService
        this.myInfo = {};  // Add buyer/seller info as needed
        this.client = client;  // Use a client or wallet service instance

        this._initializeSocket();
    }

    delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
    }

     async initUntilSuccess() {
            try {
                const response = await walletListener.initMain()
               // Assuming the response contains a 'success' field
                console.log('Init response:', response);
            } catch (error) {
                console.error('Error during init:', error.response ? error.response.data : error.message);
                await new Promise(resolve => setTimeout(resolve, 15000)); // Wait before retrying
            }
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

    // Initialize function to check blockchain status
     async init() {
        try {
            const response = await client.cmd('getblockchaininfo'); // Use your client to fetch blockchain info
            if (response.error) {
                throw new Error(`Error fetching blockchain info: ${response.error}`);
            }

            // Check if initial block download is complete
            const isIndexed = response.data && !response.data.initialblockdownload;

            if (isIndexed) {
                console.log('Block indexing is complete. Calling wallet listener init.');
                await walletListener.initMain(); // Call initMain from walletListener
            }

            return {
                success: isIndexed,
                message: isIndexed ? 'Block indexing is complete.' : 'Block indexing is still in progress.'
            };
        } catch (error) {
            console.error('Initialization error:', error);
            return {
                success: false,
                message: error.message
            };
        }
    }

  getBlockchainInfo() {
    return util.promisify(this.client.cmd.bind(this.client, 'getblockchaininfo'))();
  }

  getRawTransaction(txId, verbose = true, blockHash) {
    return util.promisify(this.client.cmd.bind(this.client, 'getrawtransaction'))(txId, verbose);
  }


  getNetworkInfo(){
    return util.promisify(this.client.cmd.bind(this.client, 'getnetworkinfo'))()
  }

  getTransaction(txId) {
    return util.promisify(this.client.cmd.bind(this.client, 'gettransaction'))(txId);
  }

  getBlock(blockHash) {
    return util.promisify(this.client.cmd.bind(this.client, 'getblock'))(blockHash);
  }

  getBlockHash(height) {
    return util.promisify(this.client.cmd.bind(this.client, 'getblockhash'))(height);
  }

  createRawTransaction(...params) {
    return util.promisify(this.client.cmd.bind(this.client, 'createrawtransaction'))(...params);
  }

  listUnspent(...params) {
    return util.promisify(this.client.cmd.bind(this.client, 'listunspent'))(...params);
  }

  decoderawtransaction(...params) {
    return util.promisify(this.client.cmd.bind(this.client, 'decoderawtransaction'))(...params);
  }

  signrawtransactionwithwallet(...params) {
    return util.promisify(this.client.cmd.bind(this.client, 'signrawtransactionwithwallet'))(...params);
  }

  dumpprivkey(...params) {
    return util.promisify(this.client.cmd.bind(this.client, 'dumpprivkey'))(...params);
  }

  sendrawtransaction(...params) {
    return util.promisify(this.client.cmd.bind(this.client, 'sendrawtransaction'))(...params);
  }

  validateAddress(...params) {
    return util.promisify(this.client.cmd.bind(this.client, 'validateaddress'))(...params);
  }

  getBlockCount() {
      return util.promisify(this.client.cmd.bind(this.client, 'getblockcount'))();
  }

  loadWallet(...params) {
    return util.promisify(this.client.cmd.bind(this.client, 'loadwallet'))(...params);
  }


    async startOrderbookSession() {
        // Initialize an OrderbookSession when the socket connects
        this.orderbookSession = new OrderbookSession(this.socket, this.myInfo, this.txsService, this.client);
    }

    async getAllTokenBalancesForAddress(address){
        const tokens = await walletListener.getAllBalancesForAddress(address)
    }

    async getAllUTXOsForAddress(address){
        try {
        // Fetch the unspent outputs for the given address
        return await client.cmd('listunspent', 0, 9999999, [address]);
        } catch (error) {
            console.error('Error in getAllBalancesForAddress:', error.message || error);
            throw error;
        }
    }

    async getOnChainSpotOrderbook(id1, id2){
        return await walletListener.getOrderBook({id1,id2})
    }

    async getOnChainContractOrderbook(id){
        return await walletListener.getContractOrderBook({id})
    }

    async getPosition(address, contractId) {
       return await walletListener.getContractPositionForAddressAndContractId({address,contractId})
    }

    async getFundingHistory(contractId){
        return await walletListener.getFundingHistory(contractId)
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

    async checkSync(){
        const track = await walletListener.getTrackHeight()
        const sync = await walletListener.checkSync()

        return {realTimeModeHeight: track, txIndexHeight: sync.txIndex, consensusParseHeight: sync.consensus}
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