const io = require('socket.io-client');

// Connect to the Orderbook Server
const socket = io('http://172.81.181.19:9191');

// Listen for connection success
socket.on('connect', () => {
    console.log(`Connected to Orderbook Server with ID: ${socket.id}`);
    
    // Example: Emit a new order
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

    socket.emit('new-order', newOrder);
});

// Listen for order save confirmation
socket.on('order:saved', (orderUuid) => {
    console.log(`Order saved with UUID: ${orderUuid}`);
});

// Listen for order errors
socket.on('order:error', (error) => {
    console.error('Order error:', error);
});

// Listen for orderbook data updates
socket.on('orderbook-data', (data) => {
    console.log('Orderbook Data:', data);
});

// Example: Emit an orderbook update request
socket.emit('update-orderbook', { first_token: 1, second_token: 2, type: 'SPOT' });

// Listen for disconnect events
socket.on('disconnect', (reason) => {
    console.log(`Disconnected: ${reason}`);
});
