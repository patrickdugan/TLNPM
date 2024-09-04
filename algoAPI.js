const axios = require('axios');

class ApiWrapper {
    constructor(baseURL, port) {
        this.baseURL = baseURL;
        this.port = port;
        this.apiUrl = `${this.baseURL}:${this.port}/api`;
    }

    async getSpotMarkets() {
        try {
            const response = await axios.get(`${this.apiUrl}/markets/spot`);
            return response.data;
        } catch (error) {
            console.error('Error fetching spot markets:', error);
            throw error;
        }
    }

    async getFuturesMarkets() {
        try {
            const response = await axios.get(`${this.apiUrl}/markets/futures`);
            return response.data;
        } catch (error) {
            console.error('Error fetching futures markets:', error);
            throw error;
        }
    }

    async sendOrder(orderDetails) {
        try {
            const socket = require('socket.io-client')(this.apiUrl);
            socket.emit('new_order', orderDetails);
            return new Promise((resolve, reject) => {
                socket.on('order_saved', (orderUUID) => {
                    resolve(orderUUID);
                    socket.disconnect();
                });
                socket.on('error', (err) => {
                    reject(err);
                    socket.disconnect();
                });
            });
        } catch (error) {
            console.error('Error sending order:', error);
            throw error;
        }
    }

    async cancelOrder(orderUUID) {
        try {
            const socket = require('socket.io-client')(this.apiUrl);
            socket.emit('close_order', { orderUUID });
            return new Promise((resolve, reject) => {
                socket.on('order_canceled', (confirmation) => {
                    resolve(confirmation);
                    socket.disconnect();
                });
                socket.on('error', (err) => {
                    reject(err);
                    socket.disconnect();
                });
            });
        } catch (error) {
            console.error('Error canceling order:', error);
            throw error;
        }
    }

    async getOrderbookData(filter) {
        try {
            const socket = require('socket.io-client')(this.apiUrl);
            socket.emit('update_orderbook', filter);
            return new Promise((resolve, reject) => {
                socket.on('orderbook_data', (data) => {
                    resolve(data);
                    socket.disconnect();
                });
                socket.on('error', (err) => {
                    reject(err);
                    socket.disconnect();
                });
            });
        } catch (error) {
            console.error('Error fetching orderbook data:', error);
            throw error;
        }
    }
}

module.exports = ApiWrapper;
