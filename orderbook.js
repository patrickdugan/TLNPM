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
            this.socket.on('new-channel', async (swapConfig) => {
                try {
                    const { tradeInfo, isBuyer } = swapConfig; // Extract the relevant trade info and buyer/seller flag

                    const { buyer, seller, props, type } = tradeInfo; // Get buyer/seller info and trade properties

                    // Make sure the buyer/seller addresses are properly matched
                    if (this.myInfo.address === buyer.address) {
                        console.log('Initiating Buy Swap...');
                        await this.initiateBuySwap(type, tradeInfo, buyer, seller);
                    } else if (this.myInfo.address === seller.address) {
                        console.log('Initiating Sell Swap...');
                        await this.initiateSellSwap(type, tradeInfo, buyer, seller);
                    } else {
                        console.log('Address mismatch, cannot proceed with swap.');
                    }
                } catch (error) {
                    console.error('Error handling matched order:', error);
                }
            });
        }

        // Initialize buy swap
        async initiateBuySwap(typeTrade, tradeInfo, buyerInfo, sellerInfo) {
            try {
                const buySwapper = new BuySwapper(typeTrade, tradeInfo, buyerInfo, sellerInfo, this.client, this.socket);
                const res = await buySwapper.onReady();
                if (res.error) {
                    console.error(`Buy Swap Failed: ${res.error}`);
                } else {
                    console.log(`Buy Swap Complete: ${res.data}`);
                }
            } catch (error) {
                console.error('Error initiating Buy Swap:', error);
            }
        }

        // Initialize sell swap
        async initiateSellSwap(typeTrade, tradeInfo, buyerInfo, sellerInfo) {
            try {
                const sellSwapper = new SellSwapper(typeTrade, tradeInfo, sellerInfo, buyerInfo, this.client, this.socket);
                const res = await sellSwapper.onReady();
                if (res.error) {
                    console.error(`Sell Swap Failed: ${res.error}`);
                } else {
                    console.log(`Sell Swap Complete: ${res.data}`);
                }
            } catch (error) {
                console.error('Error initiating Sell Swap:', error);
            }
        }
}

module.exports = OrderbookSession