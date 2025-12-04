const WebSocket = require('ws');
const ccxt = require('ccxt');

//
// CONFIG
//
const OB_URL = 'ws://172.81.181.19:3001/ws';
const CONTRACT_ID = 2;
const NETWORK = 'BTC';

// dummy keypair (server does NOT verify sigs for demo)
const KEYP = {
    address: 'btc_demo_bot',
    pubkey: '02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
};

// quoting values (adjust for visuals)
const SIZE = 1;              // 1 contract
const SPREAD = 3;            // dollars above/below mark
const COLLATERAL = 50;       // fake
const MARGIN = 0.1;          // 10%

//
// Connect to Orderbook Server
//
console.log("[MM] Connecting to OB server:", OB_URL);
const ws = new WebSocket(OB_URL);

ws.on('open', () => {
    console.log("[OB] Connected");

    // join market (important!)
    ws.send(JSON.stringify({
        event: "orderbook:join",
        data: {
            marketKey: `FUTURES:${CONTRACT_ID}`,
            network: NETWORK
        }
    }));

    startLoop();
});

ws.on('message', (msg) => {
    console.log("[OB] >>", msg.toString());
});

ws.on('close', () => console.log("[OB] Closed"));
ws.on('error', (e) => console.log("[OB] Error:", e.message));


//
// Binance spot ticker loop (fetchTicker, not WS, simple & stable)
//
const binance = new ccxt.binance();

async function getMarkPrice() {
    try {
        const t = await binance.fetchTicker('BTC/USDT');
        return t.last; // mid or last is fine for demo
    } catch (err) {
        console.log("[WARN] Binance error:", err.message);
        return null;
    }
}

//
// Send an order in TL FUTURES shape
//
function sendFuturesOrder(side, price) {
    const msg = {
        event: "new-order",
        keypair: KEYP,
        action: side,
        type: "FUTURES",
        props: {
            contract_id: CONTRACT_ID,
            amount: SIZE,
            price: price,
            collateral: COLLATERAL,
            margin: MARGIN,
            transfer: false
        },
        isLimitOrder: true,
        marketName: `FUTURES:${CONTRACT_ID}`,
        network: NETWORK
    };

    console.log("[SEND]", side, "@", price);
    ws.send(JSON.stringify(msg));
}

//
// Main quoting loop
//
async function startLoop() {
    console.log("[MM] Starting futures MM loop on contract", CONTRACT_ID);

    setInterval(async () => {
        const mark = await getMarkPrice();
        if (!mark) return;

        // create BUY and SELL around mark
        const buy = mark - SPREAD;
        const sell = mark + SPREAD;

        sendFuturesOrder("BUY", buy);
        sendFuturesOrder("SELL", sell);

    }, 1500);
}
