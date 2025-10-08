'use strict';
/**
 * bbo_tracker_min.js
 * - Keeps exactly 2 live orders: 1 BUY at Binance best bid, 1 SELL at Binance best ask
 * - On BBO change (≥ tick), cancels existing side and places a fresh one
 * - Logs Binance BBO and every place/cancel
 * - Uses the same ApiWrapper patterns as mmEx.js (sendOrder returns UUID string; cancelOrder exists)
 */

const ccxt = require('ccxt');
const ApiWrapper = require('./algoAPI.js');

// ===== Config (mirror mmEx style) =====
const CFG = {
  TL_WS_HOST: 'ws://127.0.0.1',
  TL_WS_PORT: 3001,
  TL_NETWORK: 'LTCTEST',
  TL_ADDR: 'tltc1qvlwcnwlhnja7wlj685ptwxej75mms9nyv7vuy8',

  BASE_ID: 0,    // LTC
  QUOTE_ID: 5,   // USDTt

  SYMBOL_CCXT: 'LTC/USDT',
  POLL_MS: 200,
  SIZE: 0.10,
  TICK: 0.0001,           // rounding tick
  EDGE_BPS: 0.0,          // add/subtract this from bid/ask (0 mirrors exactly)

  PLACE_TIMEOUT_MS: 200,
  CANCEL_TIMEOUT_MS: 200,
};

// ===== Helpers =====
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const bps = (x) => x / 10000.0;
const roundDown = (x, tick) => Math.floor(x / tick) * tick;
const roundUp   = (x, tick) => Math.ceil(x / tick) * tick;
const num = (v, d=8) => Number(Number(v).toFixed(d));

async function withTimeout(p, ms, tag) {
  let t; const killer = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${tag||'op'} timeout`)), ms); });
  try { return await Promise.race([p, killer]); } finally { clearTimeout(t); }
}

// ===== TL order builders (same shape as mmEx) =====
function toTLBuy(cfg, price, amount) {
  return { type: 'SPOT', action: 'BUY',  props: { id_for_sale: cfg.QUOTE_ID, id_desired: cfg.BASE_ID,  price, amount, transfer: false } };
}
function toTLSell(cfg, price, amount) {
  return { type: 'SPOT', action: 'SELL', props: { id_for_sale: cfg.BASE_ID,  id_desired: cfg.QUOTE_ID, price, amount, transfer: false } };
}

// ===== External deps =====
const binance = new ccxt.binance({ enableRateLimit: true });
const api = new ApiWrapper(
  CFG.TL_WS_HOST, CFG.TL_WS_PORT,
  true,  // debug
  true,  // autoConnect
  { address: CFG.TL_ADDR, otherAddrs: [] },
  CFG.TL_NETWORK
);

// ===== State =====
let live = { BUY: null, SELL: null }; // { uuid, px }
let lastBBO = { bid: null, ask: null };

// ===== Ops =====
async function place(side, px, sz) {
  const det = side === 'BUY' ? toTLBuy(CFG, px, sz) : toTLSell(CFG, px, sz);
  console.log('[TL] sendOrder request', det);
  const uuid = await withTimeout(api.sendOrder(det), CFG.PLACE_TIMEOUT_MS, 'place');
  const id = uuid?.orderUuid || uuid;
  live[side] = { uuid: id, px };
  console.log('PLACED', side, num(px, 6), 'uuid=', id);
}

async function cancel(side, reason) {
  const cur = live[side];
  if (!cur?.uuid) return;
  try {
    await withTimeout(api.cancelOrder(cur.uuid), CFG.CANCEL_TIMEOUT_MS, 'cancel');
    console.log('CANCELED', side, num(cur.px, 6), 'uuid=', cur.uuid, 'reason=', reason);
  } catch (e) {
    console.log('CANCEL FAIL', side, cur.uuid, e.message || e);
  } finally {
    live[side] = null;
  }
}

function targetsFromBBO(bid, ask) {
  const b = roundDown(bid * (1 - bps(CFG.EDGE_BPS)), CFG.TICK);
  const a = roundUp(  ask * (1 + bps(CFG.EDGE_BPS)), CFG.TICK);
  return { buyPx: b, sellPx: a };
}

function pxChanged(oldPx, newPx, tick) {
  if (oldPx == null) return true;
  return Math.abs(oldPx - newPx) >= tick; // only refresh if at least one tick
}

async function tickOnce() {
  // 1) Fetch BBO
  const tkr = await binance.fetchTicker(CFG.SYMBOL_CCXT);
  const bid = Number(tkr.bid);
  const ask = Number(tkr.ask);
  if (!isFinite(bid) || !isFinite(ask)) return;
  lastBBO = { bid, ask };
  console.log(`[BINANCE] ${CFG.SYMBOL_CCXT} bid=${bid} ask=${ask}`);

  // 2) Compute targets
  const { buyPx, sellPx } = targetsFromBBO(bid, ask);

  // 3) BUY side
  if (pxChanged(live.BUY?.px ?? null, buyPx, CFG.TICK)) {
    await cancel('BUY', 'replace');
    await place('BUY', buyPx, CFG.SIZE);
  }

  // 4) SELL side
  if (pxChanged(live.SELL?.px ?? null, sellPx, CFG.TICK)) {
    await cancel('SELL', 'replace');
    await place('SELL', sellPx, CFG.SIZE);
  }
}

(async () => {
  console.log('Starting minimal BBO tracker (2 orders)…');
  while (true) {
    try {
      await tickOnce();
    } catch (e) {
      console.log('Loop error:', e.message || e);
    }
    await sleep(CFG.POLL_MS);
  }
})();
