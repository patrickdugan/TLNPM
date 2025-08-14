const WS = require('isomorphic-ws');
const { EventEmitter } = require('events');

// Events we never want to send over the wire; treat them as local-only
const OUTBOUND_BLOCKLIST = new Set([
  'connect', 'connected', 'disconnect', 'reconnect',
  'orderbook-data', 'many-orders',
  'order:saved', 'order:error',
  'ping', 'pong', 'error'
]);

function _emitLocal(self, event, payload) {
  EventEmitter.prototype.emit.call(self, event, payload);
}

class WsTransport extends EventEmitter {
  constructor(url, opts = {}) {
    super();
    this.url = url;
    this.ws = null;
    this.connected = false;
    this.id = null; // parity with socket.io
    this._opts = { envelope: 'flat', ...opts }; // only 'flat' supported here
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WS(this.url);

      this.ws.onopen = () => {
        this.connected = true;
        this.id = this.id || ('ws_' + Date.now().toString(36) + Math.random().toString(36).slice(2));
        _emitLocal(this, 'connect');
        resolve();
      };

      this.ws.onerror = (e) => {
        _emitLocal(this, 'error', e);
        if (!this.connected) reject(e);
      };

      this.ws.onclose = (e) => {
        this.connected = false;
        _emitLocal(this, 'disconnect', e?.reason || 'close');
      };

      this.ws.onmessage = (msg) => {
        let data = msg.data;
        try { data = JSON.parse(data); } catch { /* leave raw */ }

        if (data && typeof data === 'object' && typeof data.event === 'string') {
          const ev = data.event;

          // Channel-style SWAP inbound: "<myId>::swap"
          if (ev.endsWith('::swap')) {
            const { event, ...payload } = data; // strip event key
            // Normalize to a single local 'swap' event
            // payload typically has: { eventName, socketId, data, marketName?, network? }
            _emitLocal(this, 'swap', { channel: ev, ...payload });
            return;
          }

          // Standard flat inbound: { event, ...payload }
          const { event, ...payload } = data;
          if (event === 'connected' && payload && payload.id) this.id = payload.id;
          if (event === 'ping') { _emitLocal(this, 'ping', payload); return; }

          _emitLocal(this, event, Object.keys(payload).length ? payload : undefined);
          return;
        }

        // Fallback raw
        _emitLocal(this, 'message', msg.data);
      };
    });
  }

  // Socket.IO-style API: emit(event, payload) performs a NETWORK send by default
  emit(event, payload = {}) {
    // Local-only events should never go over the wire
    if (OUTBOUND_BLOCKLIST.has(event)) {
      _emitLocal(this, event, payload);
      return;
    }

    if (!this.ws || this.ws.readyState !== WS.OPEN) return;

    // Canonicalize swap: emit('swap', { to, ... }) -> { event:"<to>::swap", ... }
    if (event === 'swap' && payload && payload.to) {
      const { to, ...rest } = payload;
      const frame = Object.assign({ event: `${to}::swap` }, rest);
      try { this.ws.send(JSON.stringify(frame)); } catch (e) { _emitLocal(this, 'error', e); }
      return;
    }

    // Flat envelope: { event, ...payload }
    const frame = Object.assign({ event }, payload || {});
    try { this.ws.send(JSON.stringify(frame)); } catch (e) { _emitLocal(this, 'error', e); }
  }

  // Explicit network send (bypasses blocklist; use sparingly)
  send(event, payload = {}) {
    if (!this.ws || this.ws.readyState !== WS.OPEN) return;
    const frame = Object.assign({ event }, payload || {});
    try { this.ws.send(JSON.stringify(frame)); } catch (e) { _emitLocal(this, 'error', e); }
  }

  off(event, listener) { this.removeListener(event, listener); return this; }
  disconnect() { try { this.ws && this.ws.close(1000, 'client-close'); } catch {} }
  close() { this.disconnect(); }
}

function createTransport(opts = {}) {
  return new WsTransport(opts.url, { envelope: 'flat' });
}

module.exports = { WsTransport, createTransport };
