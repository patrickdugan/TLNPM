/**
 * mmEx_clean.js — minimalist, deterministic TL <-> Binance MM
 * - Quotes 2x bid/ask on TLTC/USDTt using Binance LTC/USDT as reference
 * - Safe cancel/replace with per-side debounce + timeouts
 * - No UUID reuse, no duplicate WS handlers, no hidden chars in side flags
 */

'use strict';

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const ccxt = require('ccxt');
const { apiKey, secret } = require('./keys.js');
const ApiWrapper = require('./algoAPI.js');

// ---------- config ----------
const LOG_PATH = path.join(process.env.HOME || process.env.USERPROFILE || '.', 'Downloads', 'mmEx.clean.log');
const TL_WS_HOST = 'ws://172.26.37.103';
const TL_WS_PORT = 3001;
const TL_NETWORK = 'LTCTEST';
const TL_ADDR = 'tltc1qvlwcnwlhnja7wlj685ptwxej75mms9nyv7vuy8';

const BASE_ID = 0;       // LTC (on TL)
const QUOTE_ID = 5;      // USDTt (on TL)
const SYMBOL = 'LTC/USDT';

// quoting params
const LEVELS = 2;                // bids 2, asks 2
const SIZE = 0.10;               // per order size
const MAKER_EDGE_BPS = 7.5;      // each side away from Binance mid in bps (0.75‰)
const LEVEL_STEP_BPS = 7.5;      // gap between L1/L2
const MAX_ACTIVE_PER_SIDE = 2;

const SIDE_REPLACE_DEBOUNCE_MS = 300;   // per-side “don’t thrash” window
const CANCEL_TIMEOUT_MS = 1500;
const PLACE_TIMEOUT_MS  = 1500;

const MIN_SPREAD_USD = 0.01;     // don’t quote if exchange spread is absurdly tight
const MAX_SPREAD_USD = 1.00;     // safety
const MAX_SKEW_BPS   = 150;      // cancel if order drifts > this vs reference

// ---------- logging ----------
const logStream = fs.createWriteStream(LOG_PATH, { flags: 'a' });
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(' ')}\n`;
  if (!logStream.destroyed) logStream.write(line);
  console.log(...args);
}

// ---------- externals ----------
const binance = new ccxt.binance({ apiKey, secret, enableRateLimit: true });
const api = new ApiWrapper(TL_WS_HOST, TL_WS_PORT, true, true, { address: TL_ADDR, otherAddrs: [] }, TL_NETWORK);

// ---------- shared state ----------
let bestBid = null, bestAsk = null; // from Binance WS
let lastTickTs = 0;

const active = {
  BUY:  [], // [{uuid, px, sz}]
  SELL: []  // [{uuid, px, sz}]
};
const sideLocks = { BUY: 0, SELL: 0 }; // debounce timestamps

// ---------- price feed (Binance WS depth) ----------
const ws = new WebSocket('wss://stream.binance.com:9443/ws');
ws.on('open', () => {
  ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: ['ltcusdt@depth'], id: 1 }));
  log('WS subscribed: ltcusdt@depth');
});
ws.on('message', (raw) => {
  try {
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.b) || !Array.isArray(data.a)) return;
    const b = Number(data.b?.[0]?.[0]);
    const a = Number(data.a?.[0]?.[0]);
    if (Number.isFinite(b) && Number.isFinite(a) && a > b) {
      bestBid = b; bestAsk = a; lastTickTs = Date.now();
    }
  } catch { /* ignore */ }
});
ws.on('error', (e) => log('WS error', e.message || e));
ws.on('close', () => log('WS closed'));

// ---------- helpers ----------
const bps = (x) => x / 10000;
function targetLevels(bid, ask) {
  const mid = (bid + ask) / 2;
  const make = bps(MAKER_EDGE_BPS);
  const step = bps(LEVEL_STEP_BPS);
  const bids = [];
  const asks = [];
  for (let i = 0; i < LEVELS; i++) {
    const dx = make + i * step;
    bids.push({ px: mid * (1 - dx), sz: SIZE });
    asks.push({ px: mid * (1 + dx), sz: SIZE });
  }
  return { bids, asks, mid };
}

function now() { return Date.now(); }
function sideBusy(side) { return now() - sideLocks[side] < SIDE_REPLACE_DEBOUNCE_MS; }
function touch(side) { sideLocks[side] = now(); }

function toTLBuy(price, amount) {
  return { type: 'SPOT', action: 'BUY', props: { id_for_sale: QUOTE_ID, id_desired: BASE_ID, price, amount, transfer: false } };
}
function toTLSell(price, amount) {
  return { type: 'SPOT', action: 'SELL', props: { id_for_sale: BASE_ID, id_desired: QUOTE_ID, price, amount, transfer: false } };
}

async function withTimeout(promise, ms, tag) {
  let t; const killer = new Promise((_, rej) => t = setTimeout(() => rej(new Error(`${tag} timeout ${ms}ms`)), ms));
  try { return await Promise.race([promise, killer]); }
  finally { clearTimeout(t); }
}

function driftBps(px, ref) {
  return Math.abs((px - ref) / ref) * 10000;
}

// ---------- TL ops ----------
async function place(side, px, sz) {
  const details = side === 'BUY' ? toTLBuy(px, sz) : toTLSell(px, sz);
  const uuid = await withTimeout(api.sendOrder(details), PLACE_TIMEOUT_MS, 'place');
  active[side].push({ uuid, px, sz });
  log('PLACED', side, px.toFixed(6), 'uuid=', (uuid?.orderUuid || uuid));
}

async function cancel(side, idx, reason) {
  const item = active[side][idx];
  if (!item) return;
  const id = item.uuid?.orderUuid || item.uuid;
  try {
    await withTimeout(api.cancelOrder(id), CANCEL_TIMEOUT_MS, 'cancel');
    log('CANCELED', side, (item.px).toFixed(6), 'uuid=', id, 'reason=', reason);
  } catch (e) {
    log('CANCEL FAIL', side, id, e.message || e);
  } finally {
    active[side].splice(idx, 1);
  }
}

// idempotent reconcile per side: keep <= MAX_ACTIVE_PER_SIDE near targets
async function reconcileSide(side, targets, refPx) {
  if (sideBusy(side)) return; // don’t thrash
  touch(side);

  // 1) cancel anything too far or too many
  for (let i = active[side].length - 1; i >= 0; i--) {
    const px = active[side][i].px;
    const miss = Math.min(...targets.map(t => Math.abs(t.px - px)));
    const isFar = driftBps(px, refPx) > MAX_SKEW_BPS;
    if (isFar || active[side].length > MAX_ACTIVE_PER_SIDE || miss > (refPx * bps(LEVEL_STEP_BPS * 1.5))) {
      await cancel(side, i, isFar ? `drift>${MAX_SKEW_BPS}bps` : 'excess/retarget');
    }
  }

  // 2) place missing levels closest to target
  const need = Math.max(0, MAX_ACTIVE_PER_SIDE - active[side].length);
  if (need === 0) return;

  // pick top-N target levels not already “close enough”
  const existing = active[side].map(x => x.px);
  const chosen = [];
  for (const t of targets) {
    const tooClose = existing.some(px => Math.abs(px - t.px) <= (refPx * bps(LEVEL_STEP_BPS * 0.6)));
    if (!tooClose) chosen.push(t);
    if (chosen.length >= need) break;
  }

  for (const c of chosen) {
    await place(side, c.px, c.sz);
  }
}

// ---------- main tick ----------
async function tick() {
  if (!Number.isFinite(bestBid) || !Number.isFinite(bestAsk)) return;
  const spread = bestAsk - bestBid;
  if (spread < MIN_SPREAD_USD || spread > MAX_SPREAD_USD) return;

  const { bids, asks, mid } = targetLevels(bestBid, bestAsk);

  // reconcile SELLs vs ask side reference
  await reconcileSide('SELL', asks, bestAsk);
  // reconcile BUYs vs bid side reference
  await reconcileSide('BUY', bids, bestBid);
}

// ---------- exposure mgmt (stub) ----------
async function manageExposure() {
  // optional: read balances, limit inventory, hedge on Binance
  // const bal = await binance.fetchBalance();
  // TODO: implement when needed; omitted for stability in first pass
}

// ---------- graceful shutdown ----------
async function shutdown() {
  log('Shutting down, canceling open orders…');
  for (const side of ['BUY', 'SELL']) {
    for (let i = active[side].length - 1; i >= 0; i--) {
      try { await cancel(side, i, 'shutdown'); } catch {}
    }
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ---------- scheduler ----------
(async () => {
  log('mmEx_clean starting…');
  // simple warmup
  await new Promise(r => setTimeout(r, 2000));

  // fast tick (every 120ms), exposure (every 5s)
  setInterval(() => { tick().catch(e => log('tick err', e.message || e)); }, 120);
  setInterval(() => { manageExposure().catch(() => {}); }, 5000);
})();
