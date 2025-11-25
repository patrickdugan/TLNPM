// perTradeQueue.js
'use strict';

/**
 * Run async functions sequentially *per key*.
 * Calls for different keys can run in parallel.
 */
const pending = new Map();

/**
 * @param {string} key         e.g. `${buyerUuid}-${sellerUuid}`
 * @param {() => Promise<any>} fn  async work to run
 */
function runForKey(key, fn) {
  if (!key) {
    // no key → just run without queuing
    return Promise.resolve().then(fn);
  }

  const prev = pending.get(key) || Promise.resolve();

  const next = prev
    .catch(() => {}) // swallow errors from previous tasks
    .then(() => fn())
    .finally(() => {
      // clear if this is still the tail
      if (pending.get(key) === next) pending.delete(key);
    });

  pending.set(key, next);
  return next;
}

module.exports = {
  runForKey,
};
