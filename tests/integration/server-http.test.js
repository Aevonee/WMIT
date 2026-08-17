'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createMvpServer } = require('../../app/server');

async function withServer(options, run) {
  const { server } = createMvpServer(options);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = 'http://127.0.0.1:' + server.address().port;
  try {
    return await run(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function request(baseUrl, path, options) {
  const response = await fetch(baseUrl + path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, options || {}));
  let body = null;
  try { body = await response.json(); } catch (_) { body = null; }
  return { status: response.status, body };
}

test('the local server serves static assets and the phase 1 state snapshot', async () => {
  await withServer({}, async (baseUrl) => {
    const page = await fetch(baseUrl + '/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    const state = await request(baseUrl, '/api/phase1/state');
    assert.equal(state.status, 200);
    assert.equal(state.body.ok, true);
    assert.ok(Array.isArray(state.body.data.entities.Client));
  });
});

function rawGet(baseUrl, requestPath, headers) {
  return new Promise((resolve, reject) => {
    http.get(baseUrl + requestPath, { headers: headers || {} }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

test('static assets are gzip-compressed when accepted and unchanged without', async () => {
  await withServer({}, async (baseUrl) => {
    const plain = await rawGet(baseUrl, '/operations.js');
    assert.equal(plain.status, 200);
    assert.equal(plain.headers['content-encoding'], undefined);
    const gzipped = await rawGet(baseUrl, '/operations.js', { 'Accept-Encoding': 'gzip' });
    assert.equal(gzipped.status, 200);
    assert.equal(gzipped.headers['content-encoding'], 'gzip');
    assert.equal(gzipped.headers['vary'], 'Accept-Encoding');
    assert.ok(gzipped.body.length < plain.body.length, 'gzip response should be smaller');
    assert.ok(gzipped.body.length < plain.body.length * 0.5, 'operations.js should compress to under half size');
  });
});

test('static assets revalidate with ETag and answer 304 for unchanged files', async () => {
  await withServer({}, async (baseUrl) => {
    const first = await rawGet(baseUrl, '/operations.html', { 'Accept-Encoding': 'gzip' });
    assert.equal(first.status, 200);
    assert.ok(first.headers.etag, 'ETag header present');
    assert.match(first.headers['cache-control'], /no-cache/);
    const cached = await rawGet(baseUrl, '/operations.html', { 'Accept-Encoding': 'gzip', 'If-None-Match': first.headers.etag });
    assert.equal(cached.status, 304);
    assert.equal(cached.headers.etag, first.headers.etag);
    assert.equal(cached.body.length, 0);
    const changed = await rawGet(baseUrl, '/operations.html', { 'Accept-Encoding': 'gzip', 'If-None-Match': '"stale-etag"' });
    assert.equal(changed.status, 200);
  });
});

test('the action endpoint rejects unknown actions and runtime internals over HTTP', async () => {
  await withServer({}, async (baseUrl) => {
    const unknown = await request(baseUrl, '/api/phase1/action', { method: 'POST', body: JSON.stringify({ action: 'notARealAction', input: {}, actor: 'LOCAL_STAFF' }) });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.error.code, 'UNKNOWN_ACTION');
    const internal = await request(baseUrl, '/api/phase1/action', { method: 'POST', body: JSON.stringify({ action: 'updateRecord', input: { type: 'Client', id: 'CLIENT-SYNTH-000001', changes: { status: 'HACKED' } }, actor: 'LOCAL_MANAGER' }) });
    assert.equal(internal.status, 400);
    assert.equal(internal.body.error.code, 'UNKNOWN_ACTION');
    const legitimate = await request(baseUrl, '/api/phase1/action', { method: 'POST', body: JSON.stringify({ action: 'createPerson', input: { display_name: 'HTTP Probe Person' }, actor: 'LOCAL_STAFF' }) });
    assert.equal(legitimate.status, 200);
    assert.equal(legitimate.body.ok, true);
  });
});

test('the server answers 404 for unknown API operations and 405 for wrong methods', async () => {
  await withServer({}, async (baseUrl) => {
    const missing = await request(baseUrl, '/api/not-an-endpoint', { method: 'POST', body: '{}' });
    assert.equal(missing.status, 404);
    const wrongMethod = await request(baseUrl, '/api/leads', { method: 'GET' });
    assert.equal(wrongMethod.status, 405);
    const missingPage = await fetch(baseUrl + '/no-such-page.html');
    assert.equal(missingPage.status, 404);
  });
});

test('clean page aliases redirect to their real pages', async () => {
  await withServer({}, async (baseUrl) => {
    for (const [alias, target] of [['/login', '/login.html'], ['/events', '/expo-console.html'], ['/kiosk', '/expo.html'], ['/operations', '/operations.html']]) {
      const response = await fetch(baseUrl + alias, { redirect: 'manual' });
      assert.equal(response.status, 302, alias + ' should redirect');
      assert.equal(response.headers.get('location'), target);
      const followed = await fetch(baseUrl + alias);
      assert.equal(followed.status, 200, alias + ' should land on ' + target);
    }
    const missing = await fetch(baseUrl + '/no-such-alias');
    assert.equal(missing.status, 404);
  });
});

test('path traversal outside the public root is refused', async () => {
  await withServer({}, async (baseUrl) => {
    for (const attempt of ['/%2e%2e/server.js', '/../server.js', '/..%5cserver.js', '/%2e%2e%5c..%5cpackage.json']) {
      const response = await fetch(baseUrl + attempt);
      assert.equal(response.status, 404, attempt + ' must not resolve to a file');
      const text = await response.text();
      assert.doesNotMatch(text, /createMvpServer/);
    }
  });
});

test('oversized request bodies are refused', async () => {
  await withServer({}, async (baseUrl) => {
    const large = 'x'.repeat(1024 * 1024 + 100);
    const response = await fetch(baseUrl + '/api/phase1/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: large });
    assert.equal(response.status >= 400, true);
  });
});

test('a configured actor token is required for mutations and absent reads stay open', async () => {
  await withServer({ actorToken: 'test-shared-secret' }, async (baseUrl) => {
    const readable = await request(baseUrl, '/api/phase1/state');
    assert.equal(readable.status, 200);
    const blocked = await request(baseUrl, '/api/phase1/action', { method: 'POST', body: JSON.stringify({ action: 'createPerson', input: { display_name: 'Token Probe' }, actor: 'LOCAL_STAFF' }) });
    assert.equal(blocked.status, 401);
    assert.equal(blocked.body.error.code, 'ACTOR_TOKEN_INVALID');
    const legacyBlocked = await request(baseUrl, '/api/leads', { method: 'POST', body: JSON.stringify({ name: 'Lead' }) });
    assert.equal(legacyBlocked.status, 401);
    const allowed = await request(baseUrl, '/api/phase1/action', { method: 'POST', headers: { 'x-wmit-actor-token': 'test-shared-secret' }, body: JSON.stringify({ action: 'createPerson', input: { display_name: 'Token Probe Person' }, actor: 'LOCAL_STAFF' }) });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.ok, true);
    const wrongToken = await request(baseUrl, '/api/phase1/action', { method: 'POST', headers: { 'x-wmit-actor-token': 'wrong' }, body: JSON.stringify({ action: 'createPerson', input: { display_name: 'Nope' }, actor: 'LOCAL_STAFF' }) });
    assert.equal(wrongToken.status, 401);
  });
});
