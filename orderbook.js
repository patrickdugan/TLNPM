const SellSwapper = require('./seller.js')
const BuySwapper = require('./buyer.js')

class OrderbookSession {
    constructor(socket, myInfo, client) {
        this.socket = socket;
        this.myInfo = myInfo;
        this.client = client;
        
        // Start the session and listen for various events
        this.startSession();
    }

    // Start the session and manage connection lifecycle
    startSession() {
        this.socket.on('connection', () => {
            console.log('Connected to the orderbook server.');
            this.subscribeToOrderbook();
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from the orderbook server.');
            // Reconnection logic could be added here if necessary
        });

        this.handleOrderMatches();
        this.handleNewOrders();
        this.handleOrderUpdates();
        this.handleClosedOrders();
    }

    // Subscribe to orderbook updates after connection
    subscribeToOrderbook() {
        // Subscribe to specific assets or full orderbook
        this.socket.emit('subscribe', { event: 'update-orderbook', assets: ['LTC', 'BTC'] });
        console.log('Subscribed to orderbook data for assets: LTC, BTC.');

        // Listening for general orderbook updates
        this.socket.on('update-orderbook', (data) => {
            console.log('Orderbook Updated:', data);
            // You can update your local orderbook or UI here
        });
    }

    // Handle new orders
    handleNewOrders() {
        this.socket.on('new-order', (newOrderData) => {
            console.log('New Order:', newOrderData);
            // You can update the UI or alert the user about new orders
        });

        this.socket.on('many-orders', (bulkOrdersData) => {
            console.log('Many Orders Received:', bulkOrdersData);
            // Handle bulk order updates (e.g., refreshing the full orderbook)
        });
    }

    // Handle updates to existing orders in the orderbook
    handleOrderUpdates() {
        this.socket.on('update-orderbook', (updateData) => {
            console.log('Orderbook Update:', updateData);
            // Handle any updates to the orderbook here
        });
    }

    // Handle order closing or cancellations
    handleClosedOrders() {
        this.socket.on('close-order', (orderUUID) => {
            console.log(`Order ${orderUUID} closed or canceled.`);
            // Remove the order from the UI or local state
        });
    }

    // Handle matched orders and initiate trade swaps
    handleOrderMatches() {
        this.socket.on('orderMatched', (matchData) => {
            console.log('Order Matched:', matchData);
            const { buyerInfo, sellerInfo, tradeInfo, typeTrade } = matchData;

            if (this.myInfo.address === buyerInfo.address) {
                this.initiateBuySwap(typeTrade, tradeInfo, buyerInfo, sellerInfo);
            } else if (this.myInfo.address === sellerInfo.address) {
                this.initiateSellSwap(typeTrade, tradeInfo, buyerInfo, sellerInfo);
            }
        });
    }

    // Initialize buy swap
    initiateBuySwap(typeTrade, tradeInfo, buyerInfo, sellerInfo) {
        const buySwapper = new BuySwapper(typeTrade, tradeInfo, buyerInfo, sellerInfo, this.client, this.socket);
        buySwapper.onReady().then((res) => {
            if (res.error) {
                console.error(`Buy Swap Failed: ${res.error}`);
            } else {
                console.log(`Buy Swap Complete: ${res.data}`);
            }
        });
    }

    // Initialize sell swap
    initiateSellSwap(typeTrade, tradeInfo, buyerInfo, sellerInfo) {
        const sellSwapper = new SellSwapper(typeTrade, tradeInfo, sellerInfo, buyerInfo, this.client, this.socket);
        sellSwapper.onReady().then((res) => {
            if (res.error) {
                console.error(`Sell Swap Failed: ${res.error}`);
            } else {
                console.log(`Sell Swap Complete: ${res.data}`);
            }
        });
    }
}

module.exports = OrderbookSession