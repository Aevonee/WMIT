'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadConfig } = require('../../src/server/config');

function captureWarnings(fn) {
  const original = console.warn;
  const lines = [];
  console.warn = (line) => lines.push(String(line));
  try { return { result: fn(), lines }; } finally { console.warn = original; }
}

test('production warns when WMIT_BASE_URL is loopback', () => {
  const { lines } = captureWarnings(() => loadConfig({ WMIT_ENV: 'production', WMIT_BASE_URL: 'http://127.0.0.1:3000' }));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /WMIT_BASE_URL/);
});

test('production accepts a public base URL without warning', () => {
  const { lines } = captureWarnings(() => loadConfig({ WMIT_ENV: 'production', WMIT_BASE_URL: 'https://app.example.ph' }));
  assert.equal(lines.length, 0);
});

test('development loopback base URL stays silent', () => {
  const { lines } = captureWarnings(() => loadConfig({ WMIT_ENV: 'development' }));
  assert.equal(lines.length, 0);
});

test('localhost and IPv6 loopback variants are caught', () => {
  const local = captureWarnings(() => loadConfig({ WMIT_ENV: 'production', WMIT_BASE_URL: 'http://localhost:3000/' }));
  assert.equal(local.lines.length, 1);
  const v6 = captureWarnings(() => loadConfig({ WMIT_ENV: 'production', WMIT_BASE_URL: 'http://[::1]:3000' }));
  assert.equal(v6.lines.length, 1);
});

test('domains that merely start with localhost do not trigger the warning', () => {
  const { lines } = captureWarnings(() => loadConfig({ WMIT_ENV: 'production', WMIT_BASE_URL: 'https://localhost.evil.example' }));
  assert.equal(lines.length, 0);
});
