class OrderbookAPI {
    constructor(orderbookManager) {
        this.orderbookManager = orderbookManager;
    }

    // Add an order to the orderbook
    async addOrder(order) {
        try {
            // Add the order via OrderbookManager
            const result = await this.orderbookManager.addOrder(order);
            if (result.error) {
                throw new Error(result.error);
            }
            return result.data;  // Return the added order or trade info
        } catch (error) {
            console.error('Error adding order:', error.message);
            return { error: error.message };
        }
    }

    // Remove an order by UUID and socket_id
    async removeOrder(orderUuid, socketId) {
        try {
            const result = this.orderbookManager.removeOrder(orderUuid, socketId);
            if (result.error) {
                throw new Error(result.error);
            }
            return { success: true, message: result.data };
        } catch (error) {
            console.error('Error removing order:', error.message);
            return { error: error.message };
        }
    }

    // Follow a match/channel execution and get updates about the trade process
    async followChannel(tradeInfo) {
        try {
            // Start a new trade channel via Orderbook
            const result = await this.orderbookManager.newChannel(tradeInfo);
            if (result.error) {
                throw new Error(result.error);
            }
            return { success: true, data: result.data };
        } catch (error) {
            console.error('Error following trade channel:', error.message);
            return { error: error.message };
        }
    }
}

module.exports = OrderbookAPI;

