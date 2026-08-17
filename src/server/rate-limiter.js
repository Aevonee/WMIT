'use strict';

// Windowed public-channel rate limiting for the hosted WMIT server.
//
// This is the Node port of the Apps Script public-intake limiter
// (apps-script/WmitPublicServices.gs): a per-key cooldown plus a global
// windowed cap. Failed validations never consume quota; only the caller
// decides that a submission succeeded and calls consume(). The limiter is
// in-process by design — the hosted server is a single Node process.

class RateLimiter {
  constructor(options) {
    const opts = options || {};
    this.clock = opts.clock || (() => new Date());
    this.cooldownMs = Number(opts.cooldownMs === undefined ? 60 * 1000 : opts.cooldownMs);
    this.globalLimit = Number(opts.globalLimit === undefined ? 30 : opts.globalLimit);
    this.globalWindowMs = Number(opts.globalWindowMs === undefined ? 10 * 60 * 1000 : opts.globalWindowMs);
    this.hitAt = new Map();     // key -> last consume timestamp (cooldown)
    this.windowHits = [];       // timestamps of consumes inside the global window
  }

  now() { return this.clock().getTime(); }

  check(key) {
    const now = this.now();
    const normalizedKey = String(key || '').toLowerCase();
    if (normalizedKey && this.hitAt.has(normalizedKey) && now - this.hitAt.get(normalizedKey) < this.cooldownMs) return false;
    this.pruneWindow(now);
    if (this.windowHits.length >= this.globalLimit) return false;
    return true;
  }

  consume(key) {
    const now = this.now();
    const normalizedKey = String(key || '').toLowerCase();
    if (normalizedKey) this.hitAt.set(normalizedKey, now);
    this.windowHits.push(now);
  }

  pruneWindow(now) {
    if (this.windowHits.length && now - this.windowHits[0] >= this.globalWindowMs) {
      this.windowHits = this.windowHits.filter((at) => now - at < this.globalWindowMs);
    }
  }

  prune() {
    const now = this.now();
    for (const [key, at] of this.hitAt.entries()) {
      if (now - at >= this.cooldownMs) this.hitAt.delete(key);
    }
    this.pruneWindow(now);
  }
}

module.exports = { RateLimiter };
