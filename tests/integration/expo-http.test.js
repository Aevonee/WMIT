'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase, ensureEntityTables, SqliteRepository, SqliteAuditLog, SqliteIdGenerator } = require('../../src/server/sqlite-store');
const { AuthStore } = require('../../src/server/auth');
const { createPhase1Runtime, ENTITY_DEFS } = require('../../src/phase1/runtime');
const { createPhase1Application } = require('../../src/application/phase1');
const { ExpoService } = require('../../src/expo/expo-service');
const { Mailer } = require('../../src/server/mailer');
const { createMvpServer } = require('../../app/server');

function buildExpoServerFixture(options) {
  const opts = options || {};
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmit-expo-http-'));
  const db = openDatabase(path.join(dir, 'wmit.sqlite3'));
  ensureEntityTables(db, ENTITY_DEFS);
  const clock = opts.clock || (() => new Date('2026-08-20T08:00:00Z'));
  const runtime = createPhase1Runtime({
    clock,
    idGenerator: new SqliteIdGenerator(db),
    auditLog: new SqliteAuditLog(db),
    repositoryFactory: (type, repoOptions) => new SqliteRepository(db, type, repoOptions.idField),
    config: { trustedActors: {} }
  });
  const auth = new AuthStore(db, { clock, onAccountsChanged: (map) => { runtime.config.trustedActors = map; } });
  runtime.config.trustedActors = auth.trustedActors();
  auth.createAccount({ username: 'staffer', password: 'staff-password-1', role: 'STAFF', display_name: 'Expo Staffer' }, 'TEST');
  const phase1App = createPhase1Application({ runtime, seedSynthetic: false });
  const outboxDir = path.join(dir, 'outbox');
  const mailer = new Mailer({ smtp: {}, outboxDir });
  const expo = new ExpoService({ runtime, mailer, config: { baseUrl: 'http://expo.test' }, clock });
  const enforceSessions = opts.enforceSessions === undefined ? true : opts.enforceSessions;
  const { server } = createMvpServer({ phase1App, auth, enforceSessions, expo });
  return { dir, db, auth, runtime, expo, server, outboxDir };
}

async function withListening(server, run) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try { return await run(base); } finally { await new Promise((resolve) => server.close(resolve)); }
}

async function call(base, apiPath, options) {
  const response = await fetch(base + apiPath, Object.assign({ headers: { 'Content-Type': 'application/json' } }, options || {}));
  let body = null;
  try { body = await response.json(); } catch (_) { body = null; }
  return { status: response.status, body };
}

test('the public expo config endpoint serves the current expo and honors ?expo= while active', async () => {
  const fixture = buildExpoServerFixture();
  await withListening(fixture.server, async (base) => {
    const login = await call(base, '/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'staffer', password: 'staff-password-1' }) });
    const auth = { Authorization: 'Bearer ' + login.body.data.session_token, 'Content-Type': 'application/json' };

    const created = await call(base, '/api/expo/expos/create', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'PTA Travel Fair 2027', start_date: '2027-03-05', end_date: '2027-03-07' }) });
    assert.equal(created.status, 200);

    const defaultConfig = await call(base, '/api/public/expo/config');
    assert.equal(defaultConfig.status, 200);
    assert.equal(defaultConfig.body.data.expo_tag, 'EXPO-2026', 'soonest upcoming expo remains the kiosk default');

    const pinned = await call(base, '/api/public/expo/config?expo=' + encodeURIComponent(created.body.data.expo_tag));
    assert.equal(pinned.status, 200);
    assert.equal(pinned.body.data.name, 'PTA Travel Fair 2027');

    const missing = await call(base, '/api/public/expo/config?expo=NOPE-2099');
    assert.equal(missing.status, 404);

    const listed = await call(base, '/api/expo/expos', { headers: { Authorization: 'Bearer ' + login.body.data.session_token } });
    assert.equal(listed.status, 200);
    // This fixture builds the service directly (no boot seeding), so the
    // registry holds only the expo we just created; EXPO-2026 stays the
    // implicit default served to the kiosk.
    assert.equal(listed.body.data.length, 1);

    const ended = await call(base, '/api/expo/expos/status', { method: 'POST', headers: auth, body: JSON.stringify({ expo_tag: created.body.data.expo_tag, status: 'ENDED' }) });
    assert.equal(ended.status, 200);
    const closed = await call(base, '/api/public/expo/config?expo=' + encodeURIComponent(created.body.data.expo_tag));
    assert.equal(closed.status, 404);
    const endedCapture = await call(base, '/api/public/expo/lead', { method: 'POST', body: JSON.stringify({ name: 'A B', mobile: '09181119999', destination: 'Bali', travel_month: '2027-04', expo_tag: created.body.data.expo_tag }) });
    assert.equal(endedCapture.status, 400);
    assert.equal(endedCapture.body.error.code, 'EXPO_NOT_ACTIVE');
  });
});

test('the expo public channel works without a session while staff endpoints still require one', async () => {
  const fixture = buildExpoServerFixture();
  await withListening(fixture.server, async (base) => {
    const capture = await call(base, '/api/public/expo/lead', { method: 'POST', body: JSON.stringify({ name: 'Maria Santos', mobile: '09171234567', destination: 'Seoul', travel_month: '2026-10', idempotency_key: 'HTTP-KIOSK-1' }) });
    assert.equal(capture.status, 200);
    assert.equal(capture.body.ok, true);
    assert.match(capture.body.data.expo_lead_id, /^EXPO_LEAD-\d{4}-\d{6}$/);

    const blockedStaff = await call(base, '/api/expo/leads');
    assert.equal(blockedStaff.status, 401);
    assert.equal(blockedStaff.body.error.code, 'UNAUTHORIZED');

    const login = await call(base, '/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'staffer', password: 'staff-password-1' }) });
    assert.equal(login.status, 200);
    const token = login.body.data.session_token;
    const leads = await call(base, '/api/expo/leads', { headers: { Authorization: 'Bearer ' + token } });
    assert.equal(leads.status, 200);
    assert.equal(leads.body.data.length, 1);
    assert.equal(leads.body.data[0].name, 'Maria Santos');

    // The phase1 surface stays session-guarded too (adjacent regression).
    const phase1Blocked = await call(base, '/api/phase1/state');
    assert.equal(phase1Blocked.status, 401);
  });
});

test('the full expo HTTP workflow: import, quote, send to outbox, public page data, accept, dashboard', async () => {
  const fixture = buildExpoServerFixture();
  await withListening(fixture.server, async (base) => {
    const login = await call(base, '/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'staffer', password: 'staff-password-1' }) });
    const auth = { Authorization: 'Bearer ' + login.body.data.session_token, 'Content-Type': 'application/json' };

    const seed = await call(base, '/api/expo/templates/create', { method: 'POST', headers: auth, body: JSON.stringify({ destination: 'Bangkok', name: 'HTTP Bangkok 4D3N', duration_days: 4, price_per_person: '18500', inclusions: ['Airfare', 'Hotel'] }) });
    assert.equal(seed.status, 200);

    const imported = await call(base, '/api/expo/leads/import', { method: 'POST', headers: auth, body: JSON.stringify({ text: 'Juan Dela Cruz,09181112222,Bangkok,2026-11,juan@example.test', default_destination: '', default_travel_month: '' }) });
    assert.equal(imported.status, 200);
    assert.equal(imported.body.data.created_count, 1);
    const leadId = imported.body.data.created[0].expo_lead_id;

    const queue = await call(base, '/api/expo/followups', { headers: auth });
    assert.equal(queue.status, 200);
    assert.equal(queue.body.data.open_count, 3);
    assert.match(queue.body.data.queue[0].whatsapp_url, /^https:\/\/wa\.me\/639181112222\?text=/);

    const quote = await call(base, '/api/expo/quotes/create', { method: 'POST', headers: auth, body: JSON.stringify({ expo_lead_id: leadId, options: [{ template_id: seed.body.data.expo_package_template_id }] }) });
    assert.equal(quote.status, 200);
    const quoteId = quote.body.data.expo_quote_id;

    const sent = await call(base, '/api/expo/quotes/send', { method: 'POST', headers: auth, body: JSON.stringify({ expo_quote_id: quoteId }) });
    assert.equal(sent.status, 200);
    assert.equal(sent.body.data.delivery.mode, 'eml_file');
    assert.ok(fs.existsSync(sent.body.data.delivery.path), 'the .eml draft exists in the outbox');
    const token = sent.body.data.url.split('/q/')[1];

    const publicQuote = await call(base, '/api/public/expo/quote?token=' + token);
    assert.equal(publicQuote.status, 200);
    assert.equal(publicQuote.body.data.options.length, 1);
    const wrongToken = await call(base, '/api/public/expo/quote?token=' + 'f'.repeat(48));
    assert.equal(wrongToken.status, 404);

    const accepted = await call(base, '/api/public/expo/quote/accept', { method: 'POST', body: JSON.stringify({ token, accepted_by: 'Juan Dela Cruz', option_id: 'OPT-1' }) });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.data.status, 'ACCEPTED');

    const board = await call(base, '/api/expo/dashboard', { headers: auth });
    assert.equal(board.status, 200);
    assert.equal(board.body.data.funnel.leads, 1);
    assert.equal(board.body.data.funnel.quotes_sent, 1);
    assert.equal(board.body.data.funnel.accepted, 1);

    const staffLead = await call(base, '/api/expo/lead?expo_lead_id=' + leadId, { headers: auth });
    assert.equal(staffLead.body.data.lead.status, 'ACCEPTED');
  });
});

test('kiosk rate limiting surfaces as HTTP 429 and invalid payloads as 400', async () => {
  const fixture = buildExpoServerFixture();
  await withListening(fixture.server, async (base) => {
    const first = await call(base, '/api/public/expo/lead', { method: 'POST', body: JSON.stringify({ name: 'A', mobile: '09171234567', destination: 'Seoul', travel_month: '2026-10' }) });
    assert.equal(first.status, 200);
    const second = await call(base, '/api/public/expo/lead', { method: 'POST', body: JSON.stringify({ name: 'A', mobile: '09171234567', destination: 'Seoul', travel_month: '2026-10' }) });
    assert.equal(second.status, 429);
    assert.equal(second.body.error.code, 'RATE_LIMITED');
    const invalid = await call(base, '/api/public/expo/lead', { method: 'POST', body: JSON.stringify({ name: '', mobile: '09171234567' }) });
    assert.equal(invalid.status, 400);
  });
});

test('expo pages are served and unknown public tokens render 404 JSON', async () => {
  const fixture = buildExpoServerFixture();
  await withListening(fixture.server, async (base) => {
    const kiosk = await fetch(base + '/expo.html');
    assert.equal(kiosk.status, 200);
    assert.match(kiosk.headers.get('content-type'), /text\/html/);
    const consolePage = await fetch(base + '/expo-console.html');
    assert.equal(consolePage.status, 200);
    const quotePage = await fetch(base + '/quote.html');
    assert.equal(quotePage.status, 200);
    const missing = await call(base, '/api/public/expo/nothing-here', { method: 'POST', body: '{}' });
    assert.equal(missing.status, 404);
  });
});

test('servers without the expo service answer 501 EXPO_UNAVAILABLE instead of crashing', async () => {
  const { createMvpServer: build } = require('../../app/server');
  const { server } = build({});
  await withListening(server, async (base) => {
    const capture = await call(base, '/api/public/expo/lead', { method: 'POST', body: JSON.stringify({ name: 'X', mobile: '09171234567', destination: 'Seoul', travel_month: '2026-10' }) });
    assert.equal(capture.status, 501);
    assert.equal(capture.body.error.code, 'EXPO_UNAVAILABLE');
    const legacyStillWorks = await call(base, '/api/phase1/state');
    assert.equal(legacyStillWorks.status, 200);
  });
});
