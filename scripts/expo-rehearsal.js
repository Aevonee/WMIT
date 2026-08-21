'use strict';

// Expo dry-run rehearsal: boots the real hosted-server stack (SQLite + auth +
// expo service + mailer outbox) on a local port and seeds a live expo event
// with imported leads, package templates, and a sent quotation. Lets staff
// practice the full September-fair workflow (kiosk, console, public quote
// page) against synthetic data before the real event.
//
//   node scripts/expo-rehearsal.js          # http://127.0.0.1:3211
//   WMIT_EXPO_REHEARSAL_PORT=4000 node scripts/expo-rehearsal.js
//
// Credentials are printed at boot; the mail outbox lands in a temp dir, so
// nothing touches business data. Ctrl+C to stop.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase, ensureEntityTables, SqliteRepository, SqliteAuditLog, SqliteIdGenerator } = require('../src/server/sqlite-store');
const { AuthStore } = require('../src/server/auth');
const { createPhase1Runtime, ENTITY_DEFS } = require('../src/phase1/runtime');
const { createPhase1Application } = require('../src/application/phase1');
const { ExpoService } = require('../src/expo/expo-service');
const { Mailer } = require('../src/server/mailer');
const { createMvpServer } = require('../app/server');

const PORT = Number(process.env.WMIT_EXPO_REHEARSAL_PORT || 3211);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmit-expo-rehearsal-'));
const db = openDatabase(path.join(dir, 'wmit.sqlite3'));
ensureEntityTables(db, ENTITY_DEFS);
const clock = () => new Date();
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
const expo = new ExpoService({ runtime, mailer, config: { baseUrl: 'http://127.0.0.1:' + PORT }, clock });
const { server } = createMvpServer({ phase1App, auth, enforceSessions: true, expo });

function call(apiPath, options) {
  return fetch('http://127.0.0.1:' + PORT + apiPath, Object.assign({ headers: { 'Content-Type': 'application/json' } }, options || {}))
    .then((response) => response.json().catch(() => null));
}

async function main() {
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + PORT;

  const login = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'staffer', password: 'staff-password-1' }) });
  if (!login || !login.ok) throw new Error('login failed: ' + JSON.stringify(login).slice(0, 200));
  const authHeaders = { Authorization: 'Bearer ' + login.data.session_token, 'Content-Type': 'application/json' };

  const today = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
  const created = await call('/api/expo/expos/create', { method: 'POST', headers: authHeaders, body: JSON.stringify({ name: 'Dry Run Rehearsal', start_date: today, end_date: end }) });
  if (!created.ok) throw new Error('expo create failed: ' + JSON.stringify(created).slice(0, 300));
  const expoTag = created.data.expo_tag;

  const seedBangkok = await call('/api/expo/templates/create', { method: 'POST', headers: authHeaders, body: JSON.stringify({ destination: 'Bangkok', name: 'Bangkok 4D3N Rehearsal', duration_days: 4, price_per_person: '18500', inclusions: ['Airfare', 'Hotel', 'Transfers'] }) });
  if (!seedBangkok.ok) throw new Error('template failed: ' + JSON.stringify(seedBangkok).slice(0, 300));
  const seedSeoul = await call('/api/expo/templates/create', { method: 'POST', headers: authHeaders, body: JSON.stringify({ destination: 'Seoul', name: 'Seoul 5D4N Rehearsal', duration_days: 5, price_per_person: '32000', inclusions: ['Airfare', 'Hotel', 'Half-day tour'] }) });
  if (!seedSeoul.ok) throw new Error('template failed: ' + JSON.stringify(seedSeoul).slice(0, 300));

  const imported = await call('/api/expo/leads/import', { method: 'POST', headers: authHeaders, body: JSON.stringify({ text: 'Juan Dela Cruz,09181112222,Bangkok,2026-11,juan@example.test\nMaria Santos,09171234567,Seoul,2026-12,maria@example.test\nPedro Reyes,09991234567,Bangkok,2026-11,pedro@example.test', default_destination: '', default_travel_month: '' }) });
  if (!imported.ok) throw new Error('import failed: ' + JSON.stringify(imported).slice(0, 300));
  const leadId = imported.data.created[0].expo_lead_id;

  const quote = await call('/api/expo/quotes/create', { method: 'POST', headers: authHeaders, body: JSON.stringify({ expo_lead_id: leadId, options: [{ template_id: seedBangkok.data.expo_package_template_id }, { template_id: seedSeoul.data.expo_package_template_id }] }) });
  if (!quote.ok) throw new Error('quote failed: ' + JSON.stringify(quote).slice(0, 300));
  const sent = await call('/api/expo/quotes/send', { method: 'POST', headers: authHeaders, body: JSON.stringify({ expo_quote_id: quote.data.expo_quote_id }) });
  if (!sent.ok) throw new Error('send failed: ' + JSON.stringify(sent).slice(0, 300));

  console.log('READY - rehearsal environment seeded (Ctrl+C to stop)');
  console.log('Kiosk form:      ' + base + '/expo.html?expo=' + encodeURIComponent(expoTag));
  console.log('Staff console:   ' + base + '/expo-console.html  (sign in: staffer / staff-password-1)');
  console.log('Sample quote:    ' + sent.data.url);
  console.log('Mail outbox:     ' + outboxDir);
  console.log('Database (throwaway): ' + path.join(dir, 'wmit.sqlite3'));
}

main().catch((error) => { console.error('BOOT FAILED:', error.message); process.exit(1); });
