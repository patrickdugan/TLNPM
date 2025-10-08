'use strict';

/**
 * FourQuoteMM (basic)
 * - Keeps 2 BUY + 2 SELL live at all times
 * - Places immediately using a configured mid
 * - Cancels/replaces if drift from target > replaceTolTicks
 * - No dependency on external BBO; you can update mid via setMid(px)
 */

const DEFAULTS = {
  id_for_sale: 5,           // TLTC
  id_desired: 0,            // USDTt
  baseAmount: 0.10,
  tickSize: 0.0001,
  edgeTicks: 12,
  stepTicks: 6,
  replaceTolTicks: 3,
  debounceMs: 180,
  cancelTimeoutMs: 1500,
  placeTimeoutMs: 1500,
  opsPerSecond: 6,
  startPx: 116.70
};

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }
function withTimeout(p, ms, tag){
  let t; const killer = new Promise((_,rej)=>t=setTimeout(()=>rej(new Error(`${tag} timeout ${ms}ms`)), ms));
  return Promise.race([p, killer]).finally(()=>clearTimeout(t));
}

class FourQuoteMM {
  constructor(api, cfg = {}) {
    this.api = api;
    this.cfg = { ...DEFAULTS, ...cfg };
    this.mid = this.cfg.startPx;

    this.live = { BUY: [], SELL: [] }; // [{uuid, px, sz}]
    this.lastTouch = { BUY: 0, SELL: 0 };

    // simple token bucket to avoid races
    this.bucketCap = this.cfg.opsPerSecond;
    this.bucket = this.bucketCap;
    setInterval(()=>{ this.bucket = this.bucketCap; }, 1000);

    this._runner = null;
    this._started = false;
  }

  setMid(px){
    if (Number.isFinite(px) && px > 0) this.mid = px;
  }

  start(){
    if (this._started) return;
    this._started = true;
    // fire quickly so we place right away
    this._runner = setInterval(()=>this._tick().catch(()=>{}), 120);
  }

  stop(){
    if (!this._started) return;
    clearInterval(this._runner);
    this._runner = null;
    this._started = false;
  }

  _now(){ return Date.now(); }
  _tooSoon(side, ms){ return this._now() - this.lastTouch[side] < ms; }
  _touch(side){ this.lastTouch[side] = this._now(); }
  _allowOp(){ if (this.bucket <= 0) return false; this.bucket--; return true; }

  _targets(mid){
    const { tickSize, edgeTicks, stepTicks, baseAmount } = this.cfg;
    const edge = edgeTicks * tickSize;
    const step = stepTicks * tickSize;

    const BUY  = [
      { px: +(mid - edge).toFixed(8),         sz: baseAmount },
      { px: +(mid - edge - step).toFixed(8),  sz: baseAmount },
    ];
    const SELL = [
      { px: +(mid + edge).toFixed(8),         sz: baseAmount },
      { px: +(mid + edge + step).toFixed(8),  sz: baseAmount },
    ];
    return { BUY, SELL };
  }

  async _place(side, px, sz){
    if (!this._allowOp()) return false;
    const det = (side === 'BUY')
      ? { type:'SPOT', action:'BUY',  props:{ id_for_sale:this.cfg.id_desired, id_desired:this.cfg.id_for_sale, price:px, amount:sz, transfer:false } }
      : { type:'SPOT', action:'SELL', props:{ id_for_sale:this.cfg.id_for_sale, id_desired:this.cfg.id_desired, price:px, amount:sz, transfer:false } };
    try {
      const res = await withTimeout(this.api.sendOrder(det), this.cfg.placeTimeoutMs, 'place');
      const uuid = res?.orderUuid || res?.uuid || res;
      if (!uuid) throw new Error('no uuid');
      this.live[side].push({ uuid, px, sz });
      console.log('PLACED', side, px, 'uuid=', uuid);
      return true;
    } catch(e) {
      console.log('PLACE FAIL', side, px, e.message || e);
      return false;
    }
  }

  async _cancel(side, idx, reason){
    if (idx < 0 || idx >= this.live[side].length) return;
    const item = this.live[side][idx];
    if (!item) return;
    if (!this._allowOp()) return;
    try {
      await withTimeout(this.api.cancelOrder(item.uuid), this.cfg.cancelTimeoutMs, 'cancel');
      console.log('CANCELED', side, item.px, 'uuid=', item.uuid, 'reason=', reason);
    } catch(e) {
      console.log('CANCEL FAIL', side, item.uuid, e.message || e);
    } finally {
      this.live[side].splice(idx, 1);
    }
  }

  _needReplacePx(curPx, tgtPx){
    const tol = this.cfg.replaceTolTicks * this.cfg.tickSize;
    return Math.abs(curPx - tgtPx) > tol;
  }

  async _ensureSide(side, targets){
    if (this._tooSoon(side, this.cfg.debounceMs)) return;
    this._touch(side);

    // trim any excess
    while (this.live[side].length > 2) {
      await this._cancel(side, this.live[side].length - 1, 'excess');
    }

    // replace where drifted
    for (let i = 0; i < Math.min(2, this.live[side].length); i++) {
      const live = this.live[side][i];
      const tgt  = targets[i];
      if (!live || !tgt) continue;
      if (this._needReplacePx(live.px, tgt.px)) {
        await this._cancel(side, i, 'reprice');
        await this._place(side, tgt.px, tgt.sz);
      }
    }

    // place missing
    for (let i = this.live[side].length; i < 2; i++) {
      const tgt = targets[i];
      if (!tgt) break;
      await this._place(side, tgt.px, tgt.sz);
    }
  }

  async _tick(){
    // targets from current mid (always defined)
    const t = this._targets(this.mid);
    await this._ensureSide('BUY',  t.BUY);
    await this._ensureSide('SELL', t.SELL);
  }
}

module.exports = FourQuoteMM;
