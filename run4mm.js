'use strict';

const FourQuoteMM = require('./4MM.js');
const ApiWrapper  = require('./algoAPI.js');

// ——— edit these quickly ———
const TL_WS_HOST = 'ws://127.0.0.1';
const TL_WS_PORT = 3001;
const TL_NETWORK = 'LTCTEST';
const TL_ADDR    = 'tltc1qvlwcnwlhnja7wlj685ptwxej75mms9nyv7vuy8';

(async function main(){
  try {
    console.log('run4mm starting…');

    const api = new ApiWrapper(
      TL_WS_HOST,
      TL_WS_PORT,
      true,   // debug
      true,   // autoConnect
      { address: TL_ADDR, otherAddrs: [] },
      TL_NETWORK
    );

    // give the socket a moment to be ready
    await new Promise(r => setTimeout(r, 800));
    console.log('ApiWrapper initialized; launching 4-quote MM…');

    // spin up the MM with a static mid; change startPx to your liking
    const mm = new FourQuoteMM(api, {
      id_for_sale: 5,   // TLTC
      id_desired: 0,    // USDTt
      startPx: 116.70,  // initial mid
      baseAmount: 0.10,
      tickSize: 0.0001,
      edgeTicks: 12,
      stepTicks: 6,
      replaceTolTicks: 3,
      debounceMs: 180,
      opsPerSecond: 6
    });

    // OPTIONAL: If your ApiWrapper emits price info anywhere, update mid here.
    // Example tolerant hook; tweak to your actual payload:
    if (typeof api.onMessage === 'function') {
      api.onMessage((msg) => {
        try {
          const b = Number(msg?.bestBid ?? msg?.bid);
          const a = Number(msg?.bestAsk ?? msg?.ask);
          if (Number.isFinite(b) && Number.isFinite(a) && a > b) {
            mm.setMid((b + a) / 2);
          } else if (Number.isFinite(msg?.lastPrice)) {
            mm.setMid(Number(msg.lastPrice));
          }
        } catch {}
      });
    }

    mm.start();

    const shutdown = async () => {
      console.log('Shutdown: cancel outstanding…');
      mm.stop();
      for (const side of ['BUY','SELL']) {
        const list = mm.live[side].slice();
        for (let i = list.length - 1; i >= 0; i--) {
          const idx = mm.live[side].findIndex(x => x?.uuid === list[i]?.uuid);
          if (idx >= 0) { try { await mm._cancel(side, idx, 'shutdown'); } catch {} }
        }
      }
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (e) {
    console.error('Fatal error:', e);
    process.exit(1);
  }
})();
