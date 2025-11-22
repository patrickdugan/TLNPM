'use strict';

/**
 * fib_sma_taker_tl.js
 *
 * TL-style ETF taker algo:
 *  - Signals + PnL from Alpaca ETF bars (SPY by default)
 *  - Executes ETF synth on TradeLayer via ApiWrapper
 *  - Optional hedge with Alpaca options (nearest strike put/call)
 *  - Fibonacci SMA ladder: 13, 21, 34, 55, 89, 144
 *      * We look for stacked triples like [55, 89, 144]:
 *          uptrend: SMA13 > SMA21 > ... > SMA144
 *          downtrend: SMA13 < SMA21 < ... < SMA144
 *      * For each triple [pShort, pMid, pLong], if stacked:
 *          - uptrend: SMA(pShort) > SMA(pMid) > SMA(pLong)
 *          - downtrend: SMA(pShort) < SMA(pMid) < SMA(pLong)
 *        we pick the triple with the *largest* pLong and enter
 *        on retrace to SMA(pShort) (“next one when the longer ones
 *        are above each other”).
 *
 *  - Trailing stop using last 5 bars once PnL >= 10 bps
 *  - Hard stop -20 bps if no hedge
 *
 * This is example code. Backtest before real money.
 */

const Alpaca = require('@alpacahq/alpaca-trade-api');
const axios = require('axios');

// ===== TL ApiWrapper (wire this to match run_bbo_tracker) =====
/**
 * Adjust this import/path to match however run_bbo_tracker.js pulls ApiWrapper.
 * If that file does something like:
 *   const { ApiWrapper } = require('./algoAPI');
 * then keep this exactly the same.
 */
const { ApiWrapper } = require('./algoAPI'); // <--- CHECK THIS PATH

// Example env-driven TL config; mirror whatever you use in quick_env / BBO tracker.
const tlApi = new ApiWrapper(
  process.env.TL_BASE_URL || 'http://127.0.0.1',
  Number(process.env.TL_PORT || 3001),
  process.env.TL_TEST === 'true',
  process.env.TL_ALREADY_ON === 'true',
  process.env.TL_ADDRESS,
  process.env.TL_PUBKEY,
  process.env.TL_NETWORK || 'LTCTEST'
);

// ===== Global state for TL position tracking =====
/**
 * We track TL position in-process instead of querying the node:
 *   currentPosition = {
 *     side: 'long' | 'short',
 *     qty: number,
 *     entryPrice: number // from Alpaca ETF price at entry
 *   }
 */
let currentPosition = null;
let currentHedgeSymbol = null;

// ===== Config =====
const CFG = {
  // Alpaca ETF (price + bars + hedge)
  ETF_SYMBOL: 'SPY',         // Underlying ETF on Alpaca
  BAR_TIMEFRAME: '1Min',     // Alpaca bars: 1Min, 5Min, 15Min, etc.
  BAR_LOOKBACK_DAYS: 3,
  BAR_LIMIT: 800,

  // TL market symbol for ETF synth (whatever you use on TradeLayer)
  TL_MARKET: 'SPY-PERP',     // TODO: adjust to your TL symbol

  // Fibonacci SMA ladder
  FIB_PERIODS: [13, 21, 34, 55, 89, 144],
  // Triples we consider for trend; we’ll pick the one with largest max period
  FIB_TRIPLES: [
    [13, 21, 34],
    [21, 34, 55],
    [34, 55, 89],
    [55, 89, 144],
  ],

  USE_OPTION_HEDGE: true,
  HEDGE_MIN_DTE: 3,
  HEDGE_MAX_DTE: 30,

  BASE_NOTIONAL_USD: 5_000,      // per trade (notional on ETF synth)
  PROFIT_TRAIL_TRIGGER_BPS: 10,  // start trailing at +10 bps
  DEFAULT_STOP_BPS: 20,          // hard stop at -20 bps when unhedged

  POLL_MS: 30_000,               // loop delay
};

// ===== Alpaca setup =====
const alpaca = new Alpaca({
  keyId: process.env.ALPACA_KEY_ID,
  secretKey: process.env.ALPACA_SECRET_KEY,
  paper: process.env.ALPACA_PAPER !== 'false',
  rate_limit: true,
});

const ALPACA_REST_BASE =
  process.env.ALPACA_PAPER === 'false'
    ? 'https://api.alpaca.markets'
    : 'https://paper-api.alpaca.markets';

const AUTH_HEADERS = {
  'APCA-API-KEY-ID': process.env.ALPACA_KEY_ID,
  'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY,
};

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

// ===== Data + SMA helpers (Alpaca ETF bars) =====

async function fetchRecentBars(symbol) {
  const end = new Date().toISOString();
  const start = new Date(
    Date.now() - CFG.BAR_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const bars = [];
  const gen = alpaca.getBarsV2(symbol, {
    start,
    end,
    timeframe: CFG.BAR_TIMEFRAME,
    limit: CFG.BAR_LIMIT,
  });

  for await (const b of gen) {
    bars.push(b);
  }

  bars.sort((a, b) => new Date(a.t) - new Date(b.t)); // ascending
  return bars;
}

function smaForPeriod(bars, period, field = 'c') {
  if (bars.length < period) return null;
  let sum = 0;
  for (let i = bars.length - period; i < bars.length; i++) {
    sum += Number(bars[i][field]);
  }
  return sum / period;
}

function lastN(bars, n) {
  if (bars.length <= n) return bars.slice();
  return bars.slice(bars.length - n);
}

// ===== Multi-fib trend + retrace detection =====

/**
 * Detect trend + retrace using a ladder of Fibonacci SMAs:
 *
 * 1. Compute SMA for all CFG.FIB_PERIODS.
 * 2. For each triple [pShort, pMid, pLong] in CFG.FIB_TRIPLES (ascending):
 *      uptrend: SMA(pShort) > SMA(pMid) > SMA(pLong)
 *      downtrend: SMA(pShort) < SMA(pMid) < SMA(pLong)
 *    Keep the triple with the *largest pLong* that matches (longest “stack”).
 * 3. Entry level is SMA(pShort) of that best triple (“next one” below the longer two).
 * 4. Retrace condition:
 *      prev bar range crosses entry SMA
 *      last bar closes back in direction of trend.
 *
 * Returns:
 *   null OR
 *   { side: 'LONG' | 'SHORT', entryPeriod: number, triple: [pShort,pMid,pLong] }
 */
function detectFibSignal(bars) {
  if (bars.length < 200) return null; // sanity; you can relax this

  const latest = bars[bars.length - 1];
  const prev = bars[bars.length - 2];

  // 1) SMA map
  const smaMap = {};
  for (const p of CFG.FIB_PERIODS) {
    smaMap[p] = smaForPeriod(bars, p);
  }

  // 2) find best triple (largest pLong)
  let best = null;

  for (const triple of CFG.FIB_TRIPLES) {
    const [pShort, pMid, pLong] = triple;
    const sShort = smaMap[pShort];
    const sMid = smaMap[pMid];
    const sLong = smaMap[pLong];

    if (sShort == null || sMid == null || sLong == null) continue;

    const upTrend = sShort > sMid && sMid > sLong;
    const downTrend = sShort < sMid && sMid < sLong;

    if (!upTrend && !downTrend) continue;

    if (
      !best ||
      pLong > best.triple[2] // prefer triple with longest long-period
    ) {
      best = {
        side: upTrend ? 'LONG' : 'SHORT',
        triple: triple,
        entryPeriod: pShort, // “next one when the longer ones are above each other”
        smaEntry: sShort,
      };
    }
  }

  if (!best) return null;

  // 3) retrace condition to entry SMA
  const entrySma = best.smaEntry;
  const prevTouched =
    Number(prev.l) <= entrySma && Number(prev.h) >= entrySma;

  if (!prevTouched) return null;

  if (best.side === 'LONG') {
    if (Number(latest.c) > entrySma) return best;
  } else {
    if (Number(latest.c) < entrySma) return best;
  }

  return null;
}

// ===== Options hedge helpers (Alpaca) =====

async function pickClosestOption(symbol, type, underlyingPx) {
  const url = `${ALPACA_REST_BASE}/v2/options/contracts`;

  const res = await axios.get(url, {
    headers: AUTH_HEADERS,
    params: {
      underlying_symbols: symbol,
      type, // 'call' | 'put'
      limit: 500,
    },
  });

  const contracts = (res.data.option_contracts || []).filter(c => c.tradable);
  if (!contracts.length) return null;

  const today = new Date();

  function dte(expStr) {
    const d = new Date(expStr + 'T16:00:00Z');
    return (d - today) / (24 * 60 * 60 * 1000);
  }

  const filtered = contracts.filter(c => {
    const d = dte(c.expiration_date);
    return d >= CFG.HEDGE_MIN_DTE && d <= CFG.HEDGE_MAX_DTE;
  });

  const pool = filtered.length ? filtered : contracts;

  let best = null;
  let bestDiff = Infinity;
  for (const c of pool) {
    const strike = Number(c.strike_price);
    const diff = Math.abs(strike - underlyingPx);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = c;
    }
  }
  return best || null;
}

// ===== TL order helpers (TODO: wire these to your ApiWrapper methods) =====

/**
 * Place a TL market order via ApiWrapper.
 *
 * You *must* adapt this to your actual API. For example, if you have:
 *   api.spotMarketOrder({ market, side, amount })
 * or
 *   api.placeOrder({ market, side, type: 'MARKET', size })
 * then use that here.
 */
async function tlMarketOrder(side, qty) {
  console.log(`[TL] MARKET ${side} ${qty} ${CFG.TL_MARKET}`);

  // TODO: replace this with your real call.
  // Example placeholder:
  if (typeof tlApi.placeOrder === 'function') {
    return tlApi.placeOrder({
      market: CFG.TL_MARKET,
      side,              // 'buy' | 'sell'
      type: 'MARKET',
      size: qty,
    });
  }

  // If your wrapper uses a different signature, adjust accordingly:
  // return tlApi.spotMarketOrder(CFG.TL_MARKET, side, qty);
}

// ===== Hedge management =====

async function closeHedgeIfAny() {
  if (!currentHedgeSymbol) return;

  try {
    const positions = await alpaca.getPositions();
    const hedgePos = positions.find(
      p => p.symbol === currentHedgeSymbol && p.asset_class === 'option'
    );
    if (!hedgePos) {
      currentHedgeSymbol = null;
      return;
    }

    const qty = Number(hedgePos.qty);
    if (!qty) {
      currentHedgeSymbol = null;
      return;
    }

    const side = hedgePos.side === 'long' ? 'sell' : 'buy';
    console.log(`[EXIT HEDGE] ${currentHedgeSymbol} ${side} ${qty}`);

    await alpaca.createOrder({
      symbol: currentHedgeSymbol,
      qty,
      side,
      type: 'market',
      time_in_force: 'day',
    });

    currentHedgeSymbol = null;
  } catch (e) {
    console.log('Error closing hedge:', e.message || e);
  }
}

// ===== Position & risk helpers =====

function bpsFrom(entry, current, side) {
  if (side === 'long') {
    return ((current - entry) / entry) * 10_000;
  }
  // short: profit when price goes down
  return ((entry - current) / entry) * 10_000;
}

async function openTlAndMaybeHedge(signal, lastPrice) {
  if (currentPosition) {
    console.log('[SKIP] Already in TL position.');
    return;
  }

  const shares = Math.max(1, Math.floor(CFG.BASE_NOTIONAL_USD / lastPrice));
  const side = signal.side === 'LONG' ? 'buy' : 'sell';

  console.log(
    `[ENTRY] ${signal.side} TL ${CFG.TL_MARKET} ${shares} @ ETF≈${lastPrice.toFixed(
      2
    )} using triple ${signal.triple.join('/')}`
  );

  await tlMarketOrder(side, shares);

  currentPosition = {
    side: signal.side === 'LONG' ? 'long' : 'short',
    qty: shares,
    entryPrice: lastPrice,
  };

  if (!CFG.USE_OPTION_HEDGE) {
    console.log('[HEDGE] Disabled (USE_OPTION_HEDGE = false)');
    return;
  }

  try {
    const hedgeType = signal.side === 'LONG' ? 'put' : 'call';
    const contract = await pickClosestOption(CFG.ETF_SYMBOL, hedgeType, lastPrice);
    if (!contract) {
      console.log('[HEDGE] No suitable option contract found.');
      return;
    }

    const optSize = Number(contract.size || '100'); // contract multiplier
    const optQty = Math.max(1, Math.round(shares / optSize));

    console.log(
      `[HEDGE] Buying ${optQty} ${contract.symbol} (${hedgeType}) near ${contract.strike_price}`
    );

    await alpaca.createOrder({
      symbol: contract.symbol,
      qty: optQty,
      side: 'buy',
      type: 'market',
      time_in_force: 'day',
    });

    currentHedgeSymbol = contract.symbol;
  } catch (e) {
    console.log('Error creating hedge order:', e.message || e);
  }
}

async function closeTlAndHedge() {
  if (!currentPosition) return;

  const exitSide = currentPosition.side === 'long' ? 'sell' : 'buy';

  console.log(
    `[EXIT] TL ${CFG.TL_MARKET} ${exitSide} ${currentPosition.qty}`
  );
  await tlMarketOrder(exitSide, currentPosition.qty);

  await closeHedgeIfAny();
  currentPosition = null;
}

// ===== Stop logic (last 5 bars + hard stop) =====

async function manageStops(bars) {
  if (!currentPosition) return;

  const last = bars[bars.length - 1];
  const lastPrice = Number(last.c);
  const entry = currentPosition.entryPrice;
  const pnlBps = bpsFrom(entry, lastPrice, currentPosition.side);

  // Hard stop when unhedged
  if (!CFG.USE_OPTION_HEDGE && pnlBps <= -CFG.DEFAULT_STOP_BPS) {
    console.log(
      `[STOP] Hard stop hit at ${pnlBps.toFixed(
        2
      )} bps (no hedge). Closing TL position.`
    );
    await closeTlAndHedge();
    return;
  }

  // Trailing stop once sufficiently in profit
  if (pnlBps >= CFG.PROFIT_TRAIL_TRIGGER_BPS) {
    const last5 = lastN(bars, 5);
    const lows = last5.map(b => Number(b.l));
    const highs = last5.map(b => Number(b.h));

    const trailLevelLong = Math.min(...lows);
    const trailLevelShort = Math.max(...highs);

    if (
      currentPosition.side === 'long' &&
      lastPrice <= trailLevelLong
    ) {
      console.log(
        `[TRAIL] Long stop triggered @ ${lastPrice} <= ${trailLevelLong}`
      );
      await closeTlAndHedge();
      return;
    }

    if (
      currentPosition.side === 'short' &&
      lastPrice >= trailLevelShort
    ) {
      console.log(
        `[TRAIL] Short stop triggered @ ${lastPrice} >= ${trailLevelShort}`
      );
      await closeTlAndHedge();
      return;
    }
  }
}

// ===== Main loop =====

async function mainLoop() {
  console.log(
    `Starting fib_sma_taker_tl for TL market=${CFG.TL_MARKET}, ETF=${CFG.ETF_SYMBOL}, timeframe=${CFG.BAR_TIMEFRAME}, hedge=${CFG.USE_OPTION_HEDGE ? 'ON' : 'OFF'}`
  );

  while (true) {
    try {
      const bars = await fetchRecentBars(CFG.ETF_SYMBOL);
      if (!bars.length) {
        console.log('[WARN] No bars returned, skipping loop.');
        await sleep(CFG.POLL_MS);
        continue;
      }

      const last = bars[bars.length - 1];
      const lastPx = Number(last.c);

      // 1) manage open TL position
      await manageStops(bars);

      // 2) consider new entry if flat
      if (!currentPosition) {
        const sig = detectFibSignal(bars);
        if (sig) {
          console.log(
            `[SIGNAL] ${sig.side} @ close=${lastPx.toFixed(
              4
            )} using triple ${sig.triple.join('/')}, entry SMA=${sig.entryPeriod}`
          );
          await openTlAndMaybeHedge(sig, lastPx);
        } else {
          console.log('[NO SIGNAL] Waiting…');
        }
      } else {
        console.log(
          `[IN POSITION] side=${currentPosition.side} qty=${currentPosition.qty} entry=${currentPosition.entryPrice.toFixed(
            4
          )} etf_last=${lastPx.toFixed(4)}`
        );
      }
    } catch (e) {
      console.error('Loop error:', e.message || e);
    }

    await sleep(CFG.POLL_MS);
  }
}

mainLoop().catch(e => {
  console.error('Fatal error:', e.message || e);
  process.exit(1);
});
