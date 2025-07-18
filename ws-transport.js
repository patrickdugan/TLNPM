// transport/ws-transport.js
const WS = require('isomorphic-ws');
const { EventEmitter } = require('events');

// Minimal Socket.IO Transport stub for completeness
class SocketIoTransport extends EventEmitter {
  constructor(io) {
    super();
    this.io = io;
  }
  connect() {
    // Assume already connected by caller
    return Promise.resolve();
  }
  emitEvent(event, payload) {
    this.io.emit(event, payload);
  }
  close() {
    this.io.disconnect();
  }
}

// WebSocket event-bus transport (for plain WS)
class WsTransport extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.ws = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WS(this.url);
      this.ws.onopen = () => {
        this.emit('connected');
        resolve();
      };
      this.ws.onerror = reject;
      this.ws.onclose = () => this.emit('disconnect');
      this.ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          this.emit(data.event, data); // Forward entire message as payload
        } catch (err) {
          // Optionally: emit error or ignore non-JSON frames
        }
      };
    });
  }

  emitEvent(event, payload) {
    const msg = Object.assign({ event }, payload);
    this.ws.send(JSON.stringify(msg));
  }

  close() {
    if (this.ws) this.ws.close(1000, 'client-close');
  }
}

// Factory for easy switching
function createTransport(opts) {
  if (opts.type === 'socket.io') {
    return new SocketIoTransport(opts.io);
  }
  return new WsTransport(opts.url);
}

// Exports
module.exports = {
  WsTransport,
  SocketIoTransport,
  createTransport
};
