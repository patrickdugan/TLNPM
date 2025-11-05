'use strict';

/**
 * bb_scalper_binance_tl.js
 *
 * 5-second Bollinger Band scalper:
 *  - Price feed: Binance futures aggTrade stream (e.g. BTCUSDT)
 *  - Build 5s bars from trades
 *  - Compute Bollinger Bands on last N closes
 *  - Flat:
 *      * close <= lower -> LONG TL market (market order)
 *      * close >= upper -> SHORT TL market (market order)
 *  - In position:
 *      * TP at +TP_BPS
 *      * SL at -SL_BPS
 *
 * Execution: TradeLayer via ApiWrapper (same family as run_bbo_tracker.js).
 */

const WebSocket = require('ws');
const { ApiWrapper } = require('./algoAPI'); // adjust path if different

// -------- TL API SETUP --------
const tlApi = new ApiWrapper(
  process.env.TL_BASE_URL || 'http://127.0.0.1',
  Number(process.env.TL_PORT || 3001),
  process.env.TL_TEST === 'true',
  process.env.TL_ALREADY_ON === 'true',
  process.env.TL_ADDRESS,
  process.env.TL_PUBKEY,
  process.env.TL_NETWORK || 'LTCTEST'
);

// -------- CONFIG --------
const CFG = {
  // Binance side (price oracle)
  BINANCE_SYMBOL: (process.env.BINANCE_SYMBOL || 'BTCUSDT').toLowerCase(),
  // Binance futures aggTrade stream
  BINANCE_WS_URL_BASE: 'wss://fstream.binance.com/ws',

  // TL side
  TL_MARKET: process.env.TL_MARKET || 'BTC-PERP', // your TL futures/synth market
  ORDER_SIZE: Number(process.env.TL_ORDER_SIZE || 1),

  // Bar / indicator settings
  BAR_MS: 5000,      // 5-second bars
  BB_PERIOD: 60,     // 60 bars => 5 minutes of history at 5s
  BB_K: 2,           // standard deviation multiplier

  // Risk
  TP_BPS: 3,         // take profit at +3 bps
  SL_BPS: 3,         // stop loss at -3 bps

  LOG_EVERY_BAR: true
};

// -------- STATE --------

// 5-second bucket
let bucketStart = null;
let bucketOpen = null;
let bucketHigh = null;
let bucketLow = null;
let bucketLast = null;

// bar history: { t, o, h, l, c }
const bars = [];

/**
 * Position in TL we track locally:
 *  { side: 'long' | 'short', qty: number, entryPrice: number }
 */
let position = null;

// -------- HELPERS --------

function bpsDiff(entry, current, side) {
  if (side === 'long') {
    return ((current - entry) / entry) * 10_000;
  }
  return ((entry - current) / entry) * 10_000; // short
}

async function tlMarketOrder(side, qty) {
  console.log(`[TL] MARKET ${side} ${qty} ${CFG.TL_MARKET}`);

  // Adjust this to your real ApiWrapper method.
  if (typeof tlApi.placeOrder === 'function') {
    return tlApi.placeOrder({
      market: CFG.TL_MARKET,
      side, // 'buy' | 'sell'
      type: 'MARKET',
      size: qty
    });
  }

  // Fallback example if you have a different signature:
  // return tlApi.spotMarketOrder(CFG.TL_MARKET, side, qty);
}

async function openPosition(side, price) {
  if (position) return;
  const qty = CFG.ORDER_SIZE;

  await tlMarketOrder(side === 'long' ? 'buy' : 'sell', qty);
  position = { side, qty, entryPrice: price };

  console.log(
    `[ENTRY] ${side.toUpperCase()} qty=${qty} entry=${price.toFixed(8)}`
  );
}

async function closePosition(price, reason) {
  if (!position) return;

  const exitSide = position.side === 'long' ? 'sell' : 'buy';
  await tlMarketOrder(exitSide, position.qty);

  const pnlBps = bpsDiff(position.entryPrice, price, position.side);

  console.log(
    `[EXIT] reason=${reason} side=${position.side} qty=${position.qty} entry=${position.entryPrice.toFixed(
      8
    )} exit=${price.toFixed(8)} pnl=${pnlBps.toFixed(2)}bps`
  );

  position = null;
}

function computeBollinger() {
  if (bars.length < CFG.BB_PERIOD) return null;

  const lastN = bars.slice(bars.length - CFG.BB_PERIOD);
  const closes = lastN.map(b => b.c);
  const n = closes.length;

  const mean =
    closes.reduce((s, x) => s + x, 0) / n;

  const variance =
    closes.reduce((s, x) => s + (x - mean) * (x - mean), 0) / n;

  const std = Math.sqrt(variance);

  return {
    mean,
    upper: mean + CFG.BB_K * std,
    lower: mean - CFG.BB_K * std
  };
}

async function onNewBar(bar) {
  bars.push(bar);

  // keep history bounded
  const maxBars = CFG.BB_PERIOD * 3;
  if (bars.length > maxBars) {
    bars.splice(0, bars.length - maxBars);
  }

  const bb = computeBollinger();
  if (!bb) return;

  const price = bar.c;

  if (CFG.LOG_EVERY_BAR) {
    console.log(
      `[BAR] t=${new Date(bar.t).toISOString()} close=${price.toFixed(
        2
      )} mean=${bb.mean.toFixed(2)} upper=${bb.upper.toFixed(
        2
      )} lower=${bb.lower.toFixed(2)}`
    );
  }

  // 1) Manage existing position TP/SL
  if (position) {
    const pnlBps = bpsDiff(position.entryPrice, price, position.side);

    if (pnlBps >= CFG.TP_BPS) {
      await closePosition(price, 'TP');
      return;
    }

    if (pnlBps <= -CFG.SL_BPS) {
      await closePosition(price, 'SL');
      return;
    }

    return; // still in position
  }

  // 2) Flat: look for entries
  if (price <= bb.lower) {
    await openPosition('long', price);
  } else if (price >= bb.upper) {
    await openPosition('short', price);
  }
}

// 5-second bar builder from trade ticks
async function onPriceTick(price, ts = Date.now()) {
  const bucket = Math.floor(ts / CFG.BAR_MS) * CFG.BAR_MS;

  if (bucketStart === null) {
    bucketStart = bucket;
    bucketOpen = price;
    bucketHigh = price;
    bucketLow = price;
    bucketLast = price;
    return;
  }

  if (bucket !== bucketStart) {
    // close bar
    const bar = {
      t: bucketStart,
      o: bucketOpen,
      h: bucketHigh,
      l: bucketLow,
      c: bucketLast
    };
    await onNewBar(bar);

    // new bucket
    bucketStart = bucket;
    bucketOpen = price;
    bucketHigh = price;
    bucketLow = price;
    bucketLast = price;
  } else {
    // update current bucket
    bucketLast = price;
    if (price > bucketHigh) bucketHigh = price;
    if (price < bucketLow) bucketLow = price;
  }
}

// -------- BINANCE WS WIRING --------

function startBinanceStream() {
  const streamName = `${CFG.BINANCE_SYMBOL}@aggTrade`; // futures aggregated trades
  const url = `${CFG.BINANCE_WS_URL_BASE}/${streamName}`;

  console.log(`[WS] connecting to ${url}`);

  const ws = new WebSocket(url);

  ws.on('open', () => {
    console.log('[WS] connected to Binance aggTrade');
  });

  ws.on('message', async msg => {
    try {
      const data = JSON.parse(msg.toString());
      // aggTrade payload: { p: "price", T: tradeTime, ... }
      const price = Number(data.p);
      if (!price || !isFinite(price)) return;

      const ts = Number(data.T) || Date.now();
      await onPriceTick(price, ts);
    } catch (e) {
      console.log('[WS] message error:', e.message || e);
    }
  });

  ws.on('close', () => {
    console.log('[WS] closed. Reconnecting in 5s...');
    setTimeout(startBinanceStream, 5000);
  });

  ws.on('error', err => {
    console.log('[WS] error:', err.message || err);
    ws.close();
  });
}

// -------- ENTRYPOINT --------

console.log(
  `BB scalper starting:
   Binance symbol: ${CFG.BINANCE_SYMBOL.toUpperCase()}
   TL market:      ${CFG.TL_MARKET}
   Bar:            ${CFG.BAR_MS / 1000}s
   BB:             period=${CFG.BB_PERIOD}, k=${CFG.BB_K}
   TP/SL:          ${CFG.TP_BPS} / ${CFG.SL_BPS} bps
  `
);

startBinanceStream();
