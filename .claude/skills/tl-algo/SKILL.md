---
name: tl-algo
description: Scaffold and develop trading algorithms using the TradeLayer NPM package (tradelayer). Use when the user wants to create a new algo, strategy, or bot that trades on TradeLayer.
argument-hint: [strategy-description]
---

# TradeLayer Algorithm Creation

You are building a trading algorithm using the `tradelayer` NPM package. The user will describe a strategy and you will produce a working script.

## Package API Reference

### Initialization

```javascript
const ApiWrapper = require('tradelayer');

const api = new ApiWrapper(
  baseURL,      // 'http://127.0.0.1' or 'ws://...'
  port,         // 3001 (typical)
  test,         // true for testnet
  tlAlreadyOn,  // true if TL node already running
  address,      // LTC address string
  pubkey,       // hex pubkey string
  network,      // 'LTCTEST' | 'LTC' | 'BTCTEST' | 'BTC'
  relayerOpts   // optional { host, port } for fallback relay
);
```

### Market Data

- `api.getSpotMarkets()` — returns `[{ markets: [{id1, id2, ...}] }]`
- `api.getFuturesMarkets()` — returns available contract markets
- `api.getOrderbookData({ type: 'SPOT', first_token, second_token })` — returns `{ bids, asks }` (each level is `{ price, amount, count }`)
- `api.getOrderbookData({ type: 'FUTURES', contract_id })` — futures book (perp in the orderbook server; see wire format below)
- `api.getOnChainSpotOrderbook(id1, id2)` — on-chain spot book
- `api.getOnChainContractOrderbook(contractId)` — on-chain futures book

#### Orderbook server wire format (WebSocket)

If you are talking to the orderbook server directly (not through a wrapper), expect the following:

**Snapshot request (client → server)**

Send one of these payload shapes:

- By key:
  - `{ "marketKey": "0-5", "depth": 50, "network": "LTCTEST" }`
  - `{ "symbol": "0-5", "depth": 50, "network": "LTCTEST" }`
- By identifiers (server derives `marketKey`):
  - Spot: `{ "type": "SPOT", "first_token": 0, "second_token": 5, "depth": 50, "network": "LTCTEST" }`
    - Spot `marketKey` is normalized to `min(idA,idB)-max(idA,idB)`.
  - Futures: `{ "type": "FUTURES", "contract_id": 3, "depth": 50, "network": "LTCTEST" }`
    - Futures `marketKey` is `${contract_id}-perp` in this server (no expiry dimension here).

**Snapshot response (server → client)**

The server emits an `ORDERBOOK_DATA` event with this shape:

```json
{
  "event": "ORDERBOOK_DATA",
  "marketKey": "0-5",
  "orders": {
    "symbol": "0-5",
    "timestamp": 1700000000000,
    "bids": [{ "price": 1.23, "amount": 10.5, "count": 3 }],
    "asks": [{ "price": 1.24, "amount": 9.0, "count": 2 }],
    "checksum": ""
  },
  "isDelta": false,
  "openedOrders": [],
  "history": []
}
```

**Level encoding rules (important for algos)**

- Levels are **objects**, not `[price, amount]` tuples: `{ price, amount, count }`.
- Prices are scaled from engine units as: `price = enginePrice / 100`.
- Quantities are scaled from engine units as: `amount = abs(engineVisibleQty) / 1e8`.
- `count` is the number of orders at that level (may be `0` if unavailable).

> Note: The `tradelayer` wrapper may return just `{ bids, asks }`; if so, treat those arrays as already-normalized `{ price, amount, count }` in human units.

### Balances & Positions

- `api.getAllTokenBalancesForAddress(address)` — all token holdings
- `api.getUTXOBalances(address)` — confirmed LTC balance
- `api.listUnspent(minConf, maxConf, [addresses])` — raw UTXOs
- `api.getPosition(address, contractId)` — contract position
- `api.getFundingHistory(contractId)` — perpetual funding rates

### Order Placement

```javascript
// Spot order
const uuid = await api.sendOrder({
  type: 'SPOT',
  action: 'BUY' | 'SELL',
  isLimitOrder: true,
  keypair: { address, pubkey },
  props: {
    id_for_sale: Number,    // property ID being sold
    id_desired: Number,     // property ID being bought
    price: Number,          // price per unit
    amount: Number,         // quantity
    transfer: false         // immediate settlement flag
  }
});

// Futures order
const uuid = await api.sendOrder({
  type: 'FUTURES',
  action: 'BUY' | 'SELL',
  isLimitOrder: true,
  keypair: { address, pubkey },
  props: {
    contract_id: Number,
    price: Number,
    amount: Number,         // whole integer contracts
    expiry: Number | 'perp' // block height or 'perp'
  }
});
```

- `api.sendManyOrders([orderDetailsArray])` — batch placement
- `api.cancelOrder(uuid)` — cancel by UUID

### Funding Manager

```javascript
api.funding.canAfford({ ltc: 0.01, contracts: { 5: 100 } });
const lockId = api.funding.reserve({ ltc: 0.01 });
api.funding.commit(lockId);   // on fill
api.funding.release(lockId);  // on cancel/fail
```

### Utilities

- `api.delay(ms)` — async sleep
- `api.checkSync()` — blockchain sync status
- `api.getBlockCount()` — current block height
- `api.getMyInfo()` — returns `{ address, pubkey }`

### WebSocket Events (automatic via sendOrder)

- `'new-channel'` — order matched, swap coordination begins automatically
- `'order:saved'` — order confirmed in orderbook
- `'order:error'` — order rejected
- `'order:canceled'` — cancel acknowledged

## Property IDs

- `0` = LTC (native coin, used in UTXO trades)
- `1` = TL (TradeLayer native token)
- `2` = VEST (vesting token — cannot be traded on spot)
- `3` = LIQ (liquidity reward token)
- Other IDs = user-issued tokens or synthetic tokens (`s-{propId}-{contractId}`)

## Rules & Constraints

1. **Contract amounts must be whole integers** — no fractional contracts
2. **Spot amounts use 8 decimal precision** — use `bignumber.js` for arithmetic
3. **UTXO trades** (propertyId 0) use a different flow than token-to-token
4. **Vesting tokens (id 2, 3)** cannot be traded on spot markets
5. **Order settlement is automatic** — after `sendOrder()`, the package handles multisig swap coordination via WebSocket events
6. **Testnet** — always develop with `test: true` and `network: 'LTCTEST'` first
7. **Block confirmation** — trades settle on-chain, expect ~2.5 min per LTC block

## Channel Concepts (for advanced algos)

- Tokens are committed to multisig channels for off-chain trading
- Channel trades (type 19 contracts, type 20 tokens) execute within a channel
- `clearLists` on channels restrict counterparties — at least one side must be attested
- `payEnabled` allows instant-pay (type 21) within channels

## Algorithm Structure Template

Every algo should follow this skeleton:

```javascript
require('dotenv').config();
const ApiWrapper = require('tradelayer');
const BigNumber = require('bignumber.js');

// --- Config ---
const CONFIG = {
  base: process.env.TL_BASE_URL || 'http://127.0.0.1',
  port: Number(process.env.TL_PORT) || 3001,
  test: process.env.TL_TEST === 'true',
  address: process.env.TL_ADDRESS,
  pubkey: process.env.TL_PUBKEY,
  network: process.env.TL_NETWORK || 'LTCTEST',
};

// --- Strategy parameters (user-defined) ---
const PARAMS = {
  // Fill in based on strategy description
};

async function main() {
  const api = new ApiWrapper(
    CONFIG.base, CONFIG.port, CONFIG.test, true,
    CONFIG.address, CONFIG.pubkey, CONFIG.network
  );

  // 1. Wait for sync
  await api.delay(3000);

  // 2. Fetch initial state
  const balances = await api.getAllTokenBalancesForAddress(CONFIG.address);
  console.log('Balances:', JSON.stringify(balances));

  // 3. Main loop
  while (true) {
    try {
      // a. Fetch market data
      // b. Compute signal
      // c. Size position / check risk
      // d. Place or cancel orders
      // e. Log state

      await api.delay(PARAMS.interval || 5000);
    } catch (err) {
      console.error('Loop error:', err.message);
      await api.delay(10000);
    }
  }
}

main().catch(console.error);
```

## When generating an algo:

1. Start from the template above
2. Fill in PARAMS based on the user's strategy description
3. Implement signal logic in the main loop
4. Use `api.funding.canAfford()` before placing orders
5. Handle errors gracefully — network issues are common
6. Log all order UUIDs for debugging
7. Include a graceful shutdown handler (`process.on('SIGINT', ...)`)
8. If the strategy involves external price feeds (Binance, etc.), use `ccxt` or direct WebSocket — the package has `ccxt` as a dependency
9. For market making, use `sendManyOrders()` for atomic bid/ask placement
10. Read existing examples in the project for patterns: `mmEx.js` (market making), `bb_hyperscalper.js` (Bollinger scalper), `daytrader.js` (Fibonacci SMA)

## Files to reference for patterns

When creating an algo, read these files for real-world examples:
- `C:\projects\TLNPM\TLNPM\mmEx.js` — dual-layer market maker with Binance hedge
- `C:\projects\TLNPM\TLNPM\bb_hyperscalper.js` — Bollinger band scalper
- `C:\projects\TLNPM\TLNPM\daytrader.js` — SMA ladder signals
- `C:\projects\TLNPM\TLNPM\quick.js` — minimal order example
- `C:\projects\TLNPM\TLNPM\algoAPI.js` — full API source (read when unsure about a method)
