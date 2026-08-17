'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase, ensureEntityTables, SqliteRepository, SqliteAuditLog, SqliteIdGenerator } = require('../../src/server/sqlite-store');
const { AuthStore, passwordMatches } = require('../../src/server/auth');
const { createPhase1Runtime, ENTITY_DEFS } = require('../../src/phase1/runtime');
const { createPhase1Application, LOCAL_AUTH } = require('../../src/application/phase1');
const { createMvpServer } = require('../../app/server');

function buildHostedFixture(options) {
  const opts = options || {};
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmit-auth-test-'));
  const db = openDatabase(path.join(dir, 'auth.sqlite3'));
  ensureEntityTables(db, ENTITY_DEFS);
  const clock = opts.clock || (() => new Date('2026-08-18T08:00:00Z'));
  const auditLog = new SqliteAuditLog(db);
  const idGenerator = new SqliteIdGenerator(db);
  const runtime = createPhase1Runtime({
    clock,
    idGenerator,
    auditLog,
    repositoryFactory: (type, repoOptions) => new SqliteRepository(db, type, repoOptions.idField),
    config: { trustedActors: {} }
  });
  const auth = new AuthStore(db, { clock, sessionTtlMs: opts.sessionTtlMs || 6 * 60 * 60 * 1000, onAccountsChanged: (map) => { runtime.config.trustedActors = map; } });
  runtime.config.trustedActors = auth.trustedActors();
  const phase1App = createPhase1Application({ runtime, seedSynthetic: false });
  const { server } = createMvpServer({ phase1App, auth, enforceSessions: true, app: opts.app });
  return { dir, db, auth, runtime, phase1App, server, auditLog };
}

async function withListening(server, run) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try { return await run(base); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test('auth store bootstraps one admin, hashes passwords with stretching, and never stores plaintext', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmit-authstore-'));
  const db = openDatabase(path.join(dir, 'auth.sqlite3'));
  const auth = new AuthStore(db, { clock: () => new Date('2026-08-18T08:00:00Z') });
  const boot = auth.bootstrapAdmin({ password: 'initial-password-123' });
  assert.equal(boot.bootstrapped, true);
  assert.equal(boot.temporary_password, 'initial-password-123');
  const again = auth.bootstrapAdmin({ password: 'another-password-456' });
  assert.equal(again.bootstrapped, false);

  const stored = db.prepare('SELECT * FROM auth_accounts WHERE username = ?').get('admin');
  assert.equal(stored.password_hash.includes('initial-password-123'), false);
  assert.equal(stored.iterations >= 1000, true);
  assert.equal(passwordMatches('initial-password-123', stored), true);
  assert.equal(passwordMatches('wrong-password', stored), false);

  const session = auth.login({ username: 'admin', password: 'initial-password-123' });
  assert.ok(session.session_token.length > 40);
  const found = auth.sessionFor(session.session_token);
  assert.equal(found.username, 'admin');
  assert.equal(found.role, 'ADMIN');
  auth.logout(session.session_token);
  assert.equal(auth.sessionFor(session.session_token), null);
  db.close();
});

test('login failures are rate limited and sessions expire', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmit-authlimit-'));
  const db = openDatabase(path.join(dir, 'auth.sqlite3'));
  let nowMs = Date.parse('2026-08-18T08:00:00Z');
  const clock = () => new Date(nowMs);
  const auth = new AuthStore(db, { clock, sessionTtlMs: 1000 });
  auth.bootstrapAdmin({ password: 'initial-password-123' });

  for (let i = 0; i < 5; i += 1) assert.throws(() => auth.login({ username: 'admin', password: 'nope' + i }));
  assert.throws(() => auth.login({ username: 'admin', password: 'initial-password-123' }), /Too many failed/);
  nowMs += 6 * 60 * 1000;
  const session = auth.login({ username: 'admin', password: 'initial-password-123' });
  assert.ok(session.session_token);

  nowMs += 2000; // beyond the short TTL
  assert.equal(auth.sessionFor(session.session_token), null);
  db.close();
});

test('account management enforces the last-admin and self-protection rules', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmit-authmgmt-'));
  const db = openDatabase(path.join(dir, 'auth.sqlite3'));
  const auth = new AuthStore(db, { clock: () => new Date('2026-08-18T08:00:00Z') });
  auth.bootstrapAdmin({ password: 'initial-password-123' });
  // Acting as another admin, disabling the only active admin is blocked.
  assert.throws(() => auth.setAccountStatus('admin', 'DISABLED', 'USER:other-admin'), /At least one active Admin/);
  // An admin cannot demote or disable their own signed-in account.
  assert.throws(() => auth.setAccountStatus('admin', 'DISABLED', 'USER:admin', 'admin'), /own signed-in account/);
  assert.throws(() => auth.updateAccountRole('admin', 'STAFF', 'USER:admin', 'admin'), /own signed-in account/);
  auth.createAccount({ username: 'staff1', password: 'staff-password-1', role: 'STAFF' }, 'USER:admin');
  assert.throws(() => auth.createAccount({ username: 'staff1', password: 'staff-password-1', role: 'STAFF' }), /already exists/);
  assert.throws(() => auth.createAccount({ username: 'bad name!', password: 'long-enough-password', role: 'STAFF' }), /Username/);
  const authority = auth.trustedActors();
  assert.deepEqual(authority['USER:admin'], LOCAL_AUTH.LOCAL_MANAGER.concat(LOCAL_AUTH.LOCAL_STAFF));
  assert.deepEqual(authority['USER:staff1'], LOCAL_AUTH.LOCAL_STAFF);
  db.close();
});

test('the hosted server requires sessions, binds actors to users, and blocks intern writes', async () => {
  const fixture = buildHostedFixture({});
  const adminBoot = fixture.auth.bootstrapAdmin({ password: 'admin-password-123' });
  fixture.auth.createAccount({ username: 'staff1', password: 'staff-password-1', role: 'STAFF' }, 'USER:admin');
  fixture.auth.createAccount({ username: 'intern1', password: 'intern-password-1', role: 'INTERN' }, 'USER:admin');

  await withListening(fixture.server, async (base) => {
    const unauthenticated = await fetch(base + '/api/phase1/state');
    assert.equal(unauthenticated.status, 401);
    const badLogin = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'wrong' }) });
    assert.equal(badLogin.status, 401);
    const health = await fetch(base + '/api/health');
    assert.equal(health.status, 200);

    const login = await (await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin-password-123' }) })).json();
    assert.equal(login.ok, true);
    const token = login.data.session_token;
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };

    const state = await fetch(base + '/api/phase1/state', { headers });
    assert.equal(state.status, 200);

    // The body actor is ignored: the audit must show USER:admin, not the spoofed name.
    const created = await (await fetch(base + '/api/phase1/action', { method: 'POST', headers, body: JSON.stringify({ action: 'createClient', input: { display_name: 'Session Client' }, actor: 'LOCAL_MANAGER' }) })).json();
    assert.equal(created.ok, true);
    const audited = fixture.auditLog.list(10).find((entry) => entry.action === 'CREATE' && entry.entity_type === 'Client');
    assert.equal(audited.actor, 'USER:admin');

    // Manager-only action succeeds for ADMIN but not STAFF.
    const staffLogin = await (await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'staff1', password: 'staff-password-1' }) })).json();
    const staffHeaders = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + staffLogin.data.session_token };
    const staffApprove = await (await fetch(base + '/api/phase1/action', { method: 'POST', headers: staffHeaders, body: JSON.stringify({ action: 'updateSettings', input: { standardMarkup: 40 } }) })).json();
    assert.equal(staffApprove.ok, false);
    assert.equal(staffApprove.error.code, 'AUTHORIZATION_REQUIRED');

    // Interns are read-only at the HTTP boundary.
    const internLogin = await (await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'intern1', password: 'intern-password-1' }) })).json();
    const internHeaders = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + internLogin.data.session_token };
    const internRead = await fetch(base + '/api/phase1/state', { headers: internHeaders });
    assert.equal(internRead.status, 200);
    const internWrite = await fetch(base + '/api/phase1/action', { method: 'POST', headers: internHeaders, body: JSON.stringify({ action: 'createClient', input: { display_name: 'Nope' } }) });
    assert.equal(internWrite.status, 403);

    // Logout invalidates the session server-side.
    await fetch(base + '/api/auth/logout', { method: 'POST', headers });
    const afterLogout = await fetch(base + '/api/phase1/state', { headers });
    assert.equal(afterLogout.status, 401);
  });
  fixture.db.close();
});
