// ws-transport.js (drop-in replace)
const WS = require('isomorphic-ws');
const { EventEmitter } = require('events');

const OUTBOUND_BLOCKLIST = new Set([
  'connect','connected','disconnect','reconnect',
  'orderbook-data','many-orders',
  'order:saved','order:error',
  'ping','pong','error'
]);

function _emitLocal(self, event, payload) {
  EventEmitter.prototype.emit.call(self, event, payload);
}

class WsTransport extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.ws = null;
    this.connected = false;
    this.id = null;
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
        let wire = msg.data;
        //try { console.log('[WS][inbound-raw]', typeof wire === 'string' ? wire : JSON.stringify(wire)); } catch {}
        try { wire = JSON.parse(wire); } catch { /* non-JSON -> pass through */ }

        if (wire && typeof wire === 'object' && typeof wire.event === 'string') {
          const ev = wire.event;

          // Inbound swap channel: "<id>::swap"
          if (ev.endsWith('::swap')) {
            const { event, ...rest } = wire; // rest might be { data: { eventName, socketId, data } } or already flat
            let norm = rest;

            // Flatten the extra top-level "data" wrapper if present
            if (
              norm && typeof norm === 'object' &&
              'data' in norm && norm.data && typeof norm.data === 'object' &&
              norm.eventName === undefined && norm.socketId === undefined
            ) {
              const inner = norm.data;             // { eventName, socketId, data, ... }
              norm = { ...norm, ...inner };
            }

            //try { console.log('[WS][inbound-swap]', ev, norm); } catch {}
            // Re-emit on the RAW channel so buyer/seller listeners remain unchanged
            _emitLocal(this, ev, norm);
            return;
          }

          // Standard flat inbound: { event, ...payload }
          const { event, ...payload } = wire;
          //try { console.log('[WS][inbound]', event, payload); } catch {}
          if (event === 'connected' && payload && payload.id) this.id = payload.id;
          if (event === 'ping') { _emitLocal(this, 'ping', payload); return; }

          _emitLocal(this, event, Object.keys(payload).length ? payload : undefined);
          return;
        }

        _emitLocal(this, 'message', msg.data);
      };
    });
  }

  emit(event, payload = {}) {
    if (OUTBOUND_BLOCKLIST.has(event)) { _emitLocal(this, event, payload); return this; }
    if (!this.ws || this.ws.readyState !== WS.OPEN) return this;

    // Helper: emit('swap', { to, ... }) → wire: { event:"<to>::swap", ... }
    if (event === 'swap' && payload && payload.to) {
      const { to, ...rest } = payload;
      const frame = Object.assign({ event: `${to}::swap` }, rest);
      try { console.log('[WS][outbound-swap]', frame); } catch {}
      try { this.ws.send(JSON.stringify(frame)); } catch (e) { _emitLocal(this, 'error', e); }
      return this;
    }

    // Pass-through if app already uses the raw channel: emit('<to>::swap', {...})
    const frame = Object.assign({ event }, payload || {});
    //try { console.log('[WS][outbound]', frame); } catch {}
    try { this.ws.send(JSON.stringify(frame)); } catch (e) { _emitLocal(this, 'error', e); }
    return this;
  }

  send(event, payload = {}) {
    if (!this.ws || this.ws.readyState !== WS.OPEN) return this;
    const frame = Object.assign({ event }, payload || {});
    try { this.ws.send(JSON.stringify(frame)); } catch (e) { _emitLocal(this, 'error', e); }
    return this;
  }

  // before:
// off(event, listener) { this.removeListener(event, listener); return this; }

// after (drop-in):
off(event, listener) {
  // If only the event name is provided, remove all listeners for that event
  if (arguments.length === 1 || listener == null) {
    // event may be undefined; Node treats removeAllListeners(undefined) as "remove all events"
    this.removeAllListeners(event);
    return this;
  }
  // If a specific listener was provided, only remove that one (but guard the type)
  if (typeof listener === 'function') {
    this.removeListener(event, listener);
  } else {
    // Silently ignore non-function (matches socket.io's tolerant behavior)
  }
  return this;
}

  disconnect() { try { this.ws && this.ws.close(1000, 'client-close'); } catch {} }
  close() { this.disconnect(); }
}

function createTransport(opts = {}) {
  return new WsTransport(opts.url || opts);
}

module.exports = { WsTransport, createTransport };
