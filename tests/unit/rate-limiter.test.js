'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RateLimiter } = require('../../src/server/rate-limiter');

test('a rate limiter blocks per-key cooldown hits but allows other keys', () => {
  let now = 1000;
  const limiter = new RateLimiter({ clock: () => new Date(now), cooldownMs: 60 * 1000, globalLimit: 30, globalWindowMs: 10 * 60 * 1000 });
  assert.equal(limiter.check('09171234567'), true);
  limiter.consume('09171234567');
  assert.equal(limiter.check('09171234567'), false, 'same key within cooldown is blocked');
  assert.equal(limiter.check('09179999999'), true, 'a different key is unaffected');
  now += 61 * 1000;
  assert.equal(limiter.check('09171234567'), true, 'cooldown expires');
});

test('a rate limiter enforces the global windowed cap across keys', () => {
  let now = 5000;
  const limiter = new RateLimiter({ clock: () => new Date(now), cooldownMs: 1000, globalLimit: 3, globalWindowMs: 10 * 60 * 1000 });
  ['a', 'b', 'c'].forEach((key) => { assert.equal(limiter.check(key), true); limiter.consume(key); });
  assert.equal(limiter.check('d'), false, 'global cap reached');
  now += 10 * 60 * 1000 + 1;
  assert.equal(limiter.check('d'), true, 'global window resets');
});

test('failed checks never consume quota and buckets prune stale entries', () => {
  let now = 0;
  const limiter = new RateLimiter({ clock: () => new Date(now), cooldownMs: 1000, globalLimit: 2, globalWindowMs: 5000 });
  assert.equal(limiter.check('x'), true);
  assert.equal(limiter.check('x'), true, 'unconsumed check stays allowed');
  limiter.consume('x');
  assert.equal(limiter.check('x'), false);
  now += 6000;
  limiter.prune();
  assert.equal(Object.keys(limiter.hitAt).length, 0, 'pruned cooldown map');
});
