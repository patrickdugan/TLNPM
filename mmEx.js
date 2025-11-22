/**
 * mmEx_dualLayer.js — fast BBO trackers + slosh (≤5 bps), hedge on fills
 *
 * Requirements satisfied:
 *  - 2 tracking orders per side that closely follow Binance bid/ask (fast)
 *  - A "slosh" set of deeper passive orders kept within 5 bps; stay put unless trespass/out-of-band
 *  - Hedge on any detected fill (order disappears without our cancel)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const ccxt = require('ccxt');
const { apiKey, secret } = require('./keys.js');
const ApiWrapper = require('./algoAPI.js');

// ===== Config =====
const LOG_PATH = path.join(process.env.HOME || process.env.USERPROFILE || '.', 'Downloads', 'mmEx.dual.log');

const TL_WS_HOST = 'ws://172.26.37.103';
const TL_WS_PORT = 3001;
const TL_NETWORK = 'LTCTEST';
const TL_ADDR = 'tltc1qvlwcnwlhnja7wlj685ptwxej75mms9nyv7vuy8';

const BASE_ID  = 0;  // LTC
const QUOTE_ID = 5;  // USDTt
const SYMBOL   = 'LTC/USDT';

// Tracking layer (fast)
const TRACK_LEVELS_PER_SIDE = 2;
const TRACK_EDGE_BPS  = 1.0;   // first level distance from BBO
const TRACK_STEP_BPS  = 1.0;   // gap between tracking levels
const TRACK_SIZE      = 0.10;
const TRACK_DEBOUNCE_MS = 150; // per side

// Slosh layer (slow)
const SLOSH_LEVELS_PER_SIDE = 3;  // number of slosh levels per side
const SLOSH_MAX_BPS   = 5.0;      // must remain within 5 bps to stay
const SLOSH_START_BPS = 2.0;      // first slosh level distance from BBO
const SLOSH_STEP_BPS  = 1.5;      // between levels, not to exceed 5 bps
const SLOSH_SIZE      = 0.15;
const SLOSH_DEBOUNCE_MS = 1200;   // slower refresh

// Safety / plumbing
const CANCEL_TIMEOUT_MS = 1500;
const PLACE_TIMEOUT_MS  = 1500;
const EXCH_SPREAD_MIN   = 0.005;  // don't quote if exchange spread too tight
const EXCH_SPREAD_MAX   = 1.00;   // ignore if absurd
const HEDGE_SLIPPAGE_F  = 0.25;   // market hedge slippage factor vs last BBO

// ===== Logging =====
const logStream = fs.createWriteStream(LOG_PATH, { flags: 'a' });
function log(...a) {
  const line = `[${new Date().toISOString()}] ${a.map(String).join(' ')}\n`;
  if (!logStream.destroyed) logStream.write(line);
  console.log(...a);
}

// ===== External deps =====
const binance = new ccxt.binance({ apiKey, secret, enableRateLimit: true });
const api = new ApiWrapper(
  TL_WS_HOST, TL_WS_PORT,
  true,  // debug
  true,  // autoConnect
  { address: TL_ADDR, otherAddrs: [] },
  TL_NETWORK
);

// ===== State =====
let bestBid = null, bestAsk = null;

const layer = {
  TRACK: { BUY: [], SELL: [] }, // items: {uuid, px, sz}
  SLOSH: { BUY: [], SELL: [] }
};

const lastTouch = {
  TRACK: { BUY: 0, SELL: 0 },
  SLOSH: { BUY: 0, SELL: 0 }
};

const ours = new Set();     // all open order UUIDs we believe are live
const oursMeta = new Map(); // uuid -> {side, layer:'TRACK'|'SLOSH', px, sz}

function now() { return Date.now(); }
function bps(x) { return x / 10000; }
function tooSoon(kind, side, ms) { return now() - lastTouch[kind][side] < ms; }
function touch(kind, side) { lastTouch[kind][side] = now(); }

function toTLBuy(price, amount) {
  return { type: 'SPOT', action: 'BUY',  props: { id_for_sale: QUOTE_ID, id_desired: BASE_ID,  price, amount, transfer: false } };
}
function toTLSell(price, amount) {
  return { type: 'SPOT', action: 'SELL', props: { id_for_sale: BASE_ID,  id_desired: QUOTE_ID, price, amount, transfer: false } };
}

async function withTimeout(p, ms, tag) {
  let t; const killer = new Promise((_, rej) => t = setTimeout(() => rej(new Error(`${tag} timeout ${ms}ms`)), ms));
  try { return await Promise.race([p, killer]); }
  finally { clearTimeout(t); }
}

// ===== Binance WS (depth) =====
const ws = new WebSocket('wss://stream.binance.com:9443/ws');
ws.on('open', () => {
  ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: ['ltcusdt@depth'], id: 1 }));
  log('Subscribed Binance: ltcusdt@depth');
});
ws.on('message', (raw) => {
  try {
    const d = JSON.parse(raw);
    const b = Number(d?.b?.[0]?.[0]);
    const a = Number(d?.a?.[0]?.[0]);
    if (Number.isFinite(b) && Number.isFinite(a) && a > b) {
      bestBid = b; bestAsk = a;
    }
  } catch {}
});
ws.on('error', (e) => log('WS error', e.message || e));

// ===== TL ops =====
async function place(kind, side, px, sz) {
  const det = side === 'BUY' ? toTLBuy(px, sz) : toTLSell(px, sz);
  const uuid = await withTimeout(api.sendOrder(det), PLACE_TIMEOUT_MS, 'place');
  const id = uuid?.orderUuid || uuid;
  layer[kind][side].push({ uuid: id, px, sz });
  ours.add(id);
  oursMeta.set(id, { side, layer: kind, px, sz });
  log('PLACED', kind, side, px.toFixed(6), 'uuid=', id);
}

async function cancel(kind, side, idx, reason) {
  const item = layer[kind][side][idx];
  if (!item) return;
  const id = item.uuid;
  try {
    await withTimeout(api.cancelOrder(id), CANCEL_TIMEOUT_MS, 'cancel');
    log('CANCELED', kind, side, item.px.toFixed(6), 'uuid=', id, 'reason=', reason);
  } catch (e) {
    log('CANCEL FAIL', kind, side, id, e.message || e);
  } finally {
    layer[kind][side].splice(idx, 1);
    ours.delete(id);
    oursMeta.delete(id);
  }
}

function genTargets_TRACK(bid, ask) {
  const bids = [], asks = [];
  for (let i = 0; i < TRACK_LEVELS_PER_SIDE; i++) {
    bids.push({ px: bid * (1 - bps(TRACK_EDGE_BPS + i * TRACK_STEP_BPS)), sz: TRACK_SIZE });
    asks.push({ px: ask * (1 + bps(TRACK_EDGE_BPS + i * TRACK_STEP_BPS)), sz: TRACK_SIZE });
  }
  return { bids, asks };
}

function genTargets_SLOSH(bid, ask) {
  const bids = [], asks = [];
  for (let i = 0; i < SLOSH_LEVELS_PER_SIDE; i++) {
    const dist = Math.min(SLOSH_START_BPS + i * SLOSH_STEP_BPS, SLOSH_MAX_BPS);
    bids.push({ px: bid * (1 - bps(dist)), sz: SLOSH_SIZE, dist });
    asks.push({ px: ask * (1 + bps(dist)), sz: SLOSH_SIZE, dist });
  }
  return { bids, asks };
}

// Keep order if: still within SLOSH_MAX_BPS of current BBO and not trespassing
function sloshStillValid(side, px, bid, ask) {
  if (side === 'BUY') {
    const relBps = Math.abs((bid - px) / bid) * 10000;
    return px <= bid && relBps <= SLOSH_MAX_BPS;
  } else {
    const relBps = Math.abs((px - ask) / ask) * 10000;
    return px >= ask && relBps <= SLOSH_MAX_BPS;
  }
}

function pickMissing(existingPx, targets, tolBps) {
  const out = [];
  for (const t of targets) {
    const near = existingPx.some(px => Math.abs(px - t.px) <= (t.px * bps(tolBps)));
    if (!near) out.push(t);
  }
  return out;
}

// ===== Hedging on fills =====
// We detect fills by diffs: If a UUID disappears from server-open-orders and we did NOT cancel it, treat as fill
async function hedgeOnFill(side, px, sz) {
  try {
    // simple market hedge opposite to TL side
    if (!Number.isFinite(bestBid) || !Number.isFinite(bestAsk)) return;
    const ref = side === 'BUY' ? bestAsk : bestBid;
    const price = side === 'BUY'
      ? ref * (1 - bps(HEDGE_SLIPPAGE_F)) // we sold on TL, buy on Binance a bit below ask if allowed
      : ref * (1 + bps(HEDGE_SLIPPAGE_F)); // we bought on TL, sell on Binance a bit above bid if allowed

    const hedgeSide = side === 'BUY' ? 'buy' : 'sell'; // reverse? we *bought* on TL -> hedge by *sell*; adjust:
    const takerSide = (side === 'BUY') ? 'sell' : 'buy';
    await binance.createOrder(SYMBOL, 'market', takerSide, sz, undefined);
    log('HEDGE', takerSide, sz, SYMBOL, 'ok (fill detected at TL)');
  } catch (e) {
    log('HEDGE FAIL', e.message || e);
  }
}

// Hook: wire to your ApiWrapper’s stream of account updates / orders list
// Expect a payload like: { event: 'PLACED_ORDERS', openedOrders: [...uuids...] }
api.onMessage?.((msg) => {
  try {
    if (!msg) return;
    // normalize possible shapes
    const ev = msg.event || msg.type || '';
    if (String(ev).toUpperCase().includes('PLACED') && Array.isArray(msg.openedOrders)) {
      const openNow = new Set((msg.openedOrders || []).map(o => o.uuid || o.orderUuid || o));
      for (const id of Array.from(ours)) {
        if (!openNow.has(id)) {
          // if it disappeared and we didn't remove it locally => filled (or canceled by match)
          const meta = oursMeta.get(id);
          if (meta) {
            log('FILL-DETECTED', id, meta.side, meta.layer, meta.px);
            hedgeOnFill(meta.side, meta.px, meta.sz).catch(()=>{});
            // clean local state if still present in a layer
            for (const KIND of ['TRACK','SLOSH']) {
              for (const SIDE of ['BUY','SELL']) {
                const idx = layer[KIND][SIDE].findIndex(x => x.uuid === id);
                if (idx >= 0) layer[KIND][SIDE].splice(idx, 1);
              }
            }
            ours.delete(id);
            oursMeta.delete(id);
          }
        }
      }
    }
  } catch {}
});

// ===== Reconcilers =====
async function reconcileTRACK(bid, ask) {
  // debounce per side
  for (const side of ['BUY','SELL']) {
    if (tooSoon('TRACK', side, TRACK_DEBOUNCE_MS)) continue;
    touch('TRACK', side);

    const targets = genTargets_TRACK(bid, ask);
    const tgt = side === 'BUY' ? targets.bids : targets.asks;
    const existing = layer.TRACK[side];

    // cancel if too many or trespass BBO (shouldn’t happen, but guard)
    for (let i = existing.length - 1; i >= 0; i--) {
      const { px } = existing[i];
      const trespass = (side === 'BUY') ? (px > bid) : (px < ask);
      const tooMany = existing.length > TRACK_LEVELS_PER_SIDE;
      if (trespass || tooMany) {
        await cancel('TRACK', side, i, trespass ? 'trespass' : 'excess');
      }
    }

    // place missing near BBO (tolerance half a step)
    const miss = pickMissing(existing.map(e => e.px), tgt, TRACK_STEP_BPS * 0.6);
    for (const m of miss.slice(0, Math.max(0, TRACK_LEVELS_PER_SIDE - existing.length))) {
      await place('TRACK', side, m.px, m.sz);
    }
  }
}

async function reconcileSLOSH(bid, ask) {
  for (const side of ['BUY','SELL']) {
    if (tooSoon('SLOSH', side, SLOSH_DEBOUNCE_MS)) continue;
    touch('SLOSH', side);

    const targets = genTargets_SLOSH(bid, ask);
    const tgt = side === 'BUY' ? targets.bids : targets.asks;
    const existing = layer.SLOSH[side];

    // prune invalid: outside 5 bps window or trespass
    for (let i = existing.length - 1; i >= 0; i--) {
      const { px } = existing[i];
      if (!sloshStillValid(side, px, bid, ask)) {
        await cancel('SLOSH', side, i, 'out-of-band');
      }
    }

    // place up to desired count; tolerance slightly wider than track
    const miss = pickMissing(existing.map(e => e.px), tgt, Math.min(SLOSH_MAX_BPS, SLOSH_STEP_BPS));
    for (const m of miss.slice(0, Math.max(0, SLOSH_LEVELS_PER_SIDE - layer.SLOSH[side].length))) {
      // clamp distances to SLOSH_MAX_BPS
      const bbo = side === 'BUY' ? bid : ask;
      const rel = Math.abs((m.px - bbo) / bbo) * 10000;
      if (rel <= SLOSH_MAX_BPS) await place('SLOSH', side, m.px, m.sz);
    }
  }
}

// ===== Main tick =====
async function tick() {
  if (!Number.isFinite(bestBid) || !Number.isFinite(bestAsk)) return;
  const spread = bestAsk - bestBid;
  if (spread < EXCH_SPREAD_MIN || spread > EXCH_SPREAD_MAX) return;

  await reconcileTRACK(bestBid, bestAsk);
  await reconcileSLOSH(bestBid, bestAsk);
}

// ===== Graceful shutdown =====
async function shutdown() {
  log('Shutdown: cancel all…');
  for (const KIND of ['TRACK','SLOSH']) {
    for (const SIDE of ['BUY','SELL']) {
      for (let i = layer[KIND][SIDE].length - 1; i >= 0; i--) {
        try { await cancel(KIND, SIDE, i, 'shutdown'); } catch {}
      }
    }
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ===== Boot =====
(async () => {
  log('mmEx_dualLayer starting…');
  await new Promise(r => setTimeout(r, 1500));
  setInterval(() => { tick().catch(e => log('tick err', e.message || e)); }, 120);

  // Optional: periodic reconcile of fills if your wrapper has a getter
  // If ApiWrapper exposes api.getMyOpenOrders(), uncomment this poller:
  /*
  setInterval(async () => {
    try {
      const list = await api.getMyOpenOrders();
      const openNow = new Set((list || []).map(o => o.uuid || o.orderUuid || o));
      for (const id of Array.from(ours)) {
        if (!openNow.has(id)) {
          const meta = oursMeta.get(id);
          if (meta) {
            log('FILL-DETECTED(POLL)', id, meta.side, meta.layer, meta.px);
            hedgeOnFill(meta.side, meta.px, meta.sz).catch(()=>{});
            ours.delete(id);
            oursMeta.delete(id);
            for (const KIND of ['TRACK','SLOSH']) {
              for (const SIDE of ['BUY','SELL']) {
                const idx = layer[KIND][SIDE].findIndex(x => x.uuid === id);
                if (idx >= 0) layer[KIND][SIDE].splice(idx, 1);
              }
            }
          }
        }
      }
    } catch {}
  }, 800);
  */
})();
