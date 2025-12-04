// fundingManager.js
'use strict';

/**
 * Very simple wallet-level funding manager.
 * Tracks LTC "credits" and optional contract-size reservations.
 *
 * You can later swap this to UTXO-level tracking.
 */

class FundingManager {
  constructor() {
    this._seq = 0;
    this._locks = new Map(); // lockId -> { ltc, contracts: { [id]: size } }

    this._confirmedLtc = 0;   // from wallet scan
    this._reservedLtc  = 0;

    // optional per-contract notional/margin caps
    this._confirmedContracts = new Map(); // id -> available size
    this._reservedContracts  = new Map();
  }

  /* ——— sync from wallet listener ——— */

  setConfirmedLtc(amount) {
    this._confirmedLtc = Number(amount) || 0;
  }

  setContractCapacity(contractId, size) {
    this._confirmedContracts.set(contractId, Number(size) || 0);
  }

  /* ——— derived "available" ——— */

  get availableLtc() {
    return this._confirmedLtc - this._reservedLtc;
  }

  getAvailableContract(contractId) {
    const have = this._confirmedContracts.get(contractId) || 0;
    const res  = this._reservedContracts.get(contractId) || 0;
    return have - res;
  }

  /* ——— core operations ——— */

  canAfford({ ltc = 0, contracts = {} }) {
    if (this.availableLtc < ltc) return false;

    for (const [idStr, size] of Object.entries(contracts || {})) {
      const id = Number(idStr);
      if (this.getAvailableContract(id) < size) return false;
    }
    return true;
  }

  reserve({ ltc = 0, contracts = {} }) {
    if (!this.canAfford({ ltc, contracts })) return null;

    this._seq += 1;
    const lockId = `lock-${this._seq}`;

    this._reservedLtc += ltc;

    for (const [idStr, size] of Object.entries(contracts || {})) {
      const id = Number(idStr);
      const prev = this._reservedContracts.get(id) || 0;
      this._reservedContracts.set(id, prev + Number(size || 0));
    }

    this._locks.set(lockId, { ltc, contracts });
    return lockId;
  }

  _applyDelta(lockId, fn) {
    const lock = this._locks.get(lockId);
    if (!lock) return;

    fn(lock);

    // clean up if effectively zero
    this._locks.delete(lockId);
  }

  release(lockId) {
    this._applyDelta(lockId, ({ ltc, contracts }) => {
      this._reservedLtc -= ltc;
      for (const [idStr, size] of Object.entries(contracts || {})) {
        const id = Number(idStr);
        const prev = this._reservedContracts.get(id) || 0;
        const next = prev - Number(size || 0);
        if (next <= 0) this._reservedContracts.delete(id);
        else this._reservedContracts.set(id, next);
      }
    });
  }

  // called when walletListener tells us the funding tx has "consumed" funds
  commit(lockId, { extraFeeLtc = 0 } = {}) {
    this._applyDelta(lockId, ({ ltc, contracts }) => {
      // shift reserved -> confirmed spent
      this._reservedLtc -= ltc;
      this._confirmedLtc -= (ltc + extraFeeLtc);

      for (const [idStr, size] of Object.entries(contracts || {})) {
        const id = Number(idStr);
        const prevConf = this._confirmedContracts.get(id) || 0;
        this._confirmedContracts.set(id, prevConf - Number(size || 0));

        const prevRes = this._reservedContracts.get(id) || 0;
        const nextRes = prevRes - Number(size || 0);
        if (nextRes <= 0) this._reservedContracts.delete(id);
        else this._reservedContracts.set(id, nextRes);
      }
    });
  }

  /**
   * Helper: reserve + run, then release/commit based on callback.
   * fn gets the lockId and should return { commit: boolean, extraFeeLtc? }.
   */
  async withReservation(request, fn) {
    const lockId = this.reserve(request);
    if (!lockId) throw new Error('Insufficient local capacity');

    try {
      const result = await fn(lockId);
      if (result && result.commit) {
        this.commit(lockId, { extraFeeLtc: result.extraFeeLtc || 0 });
      } else {
        this.release(lockId);
      }
      return result;
    } catch (e) {
      this.release(lockId);
      throw e;
    }
  }
}

module.exports = {
  FundingManager,
};
