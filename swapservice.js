import { BuySwapper, SellSwapper } from './swapper';  // Reuse the swapper classes
import { Socket } from 'socket.io-client';  // Import socket.io-client for socket communication
import { TxsService } from './services/txs.service';  // Reuse transaction utilities

// Create a class to abstract the swap service for algorithmic trading
class SwapApi {
    constructor(socketUrl, rpcService) {
        this.socket = new Socket(socketUrl);  // Initiate socket connection
        this.rpcService = rpcService;  // RPC service for making wallet calls
        this.txsService = new TxsService();  // Reuse transaction utilities
        this.toastrService = null;  // Optional: Notification service, can be customized
        this.currentSwapper = null;  // Store the current swapper instance
    }

    // Initialize the Swap API
    init() {
        this.socket.on('connect', () => {
            console.log('Socket connected');
        });

        this.socket.on('disconnect', () => {
            console.log('Socket disconnected');
        });
    }

    // Listen for trade events on the socket (abstracting swap logic)
    onTradeSuccess(callback) {
        this.socket.on('trade-success', callback);
    }

    onTradeError(callback) {
        this.socket.on('trade-error', callback);
    }

    // Function to start a new trade
    async initiateTrade(type, tradeInfo, isBuyer) {
        try {
            // Destructure the buyer and seller info from the trade
            const { buyer, seller } = tradeInfo;

            // Initialize the correct swapper (Buyer or Seller)
            if (isBuyer) {
                this.currentSwapper = new BuySwapper(
                    type,
                    tradeInfo.props,
                    buyer,
                    seller,
                    this.rpcService.rpc.bind(this.rpcService),
                    this.socket,
                    this.txsService,
                    this.toastrService  // Optional: Pass a toastr service for notifications
                );
            } else {
                this.currentSwapper = new SellSwapper(
                    type,
                    tradeInfo.props,
                    seller,
                    buyer,
                    this.rpcService.rpc.bind(this.rpcService),
                    this.socket,
                    this.txsService
                );
            }

            // Subscribe to trade events
            this.currentSwapper.eventSubs$.subscribe(eventData => {
                console.log('Event received:', eventData);

                // Emit success or error based on the event type
                if (eventData.eventName.includes('STEP')) {
                    this.socket.emit('trade-success', eventData);
                } else {
                    this.socket.emit('trade-error', eventData);
                }
            });

            // Wait for the trade to be ready and resolve the result
            const res = await this.currentSwapper.onReady();
            return res;
        } catch (error) {
            console.error('Error initiating trade:', error);
            this.socket.emit('trade-error', { error });
        }
    }

    // Function to terminate an active trade
    terminateTrade(reason = 'User terminated') {
        if (this.currentSwapper) {
            this.currentSwapper.terminateTrade(reason);
            this.currentSwapper = null;  // Reset the swapper
            console.log('Trade terminated:', reason);
        } else {
            console.warn('No active trade to terminate');
        }
    }
}

// Export a singleton instance of the API
export const swapApi = new SwapApi('http://localhost:3000', rpcServiceInstance);  // Pass in socket URL and RPC service instance

