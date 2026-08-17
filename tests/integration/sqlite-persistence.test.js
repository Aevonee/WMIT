'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase, ensureEntityTables, SqliteRepository, SqliteAuditLog, SqliteIdGenerator, backupDatabase } = require('../../src/server/sqlite-store');
const { createPhase1Runtime, ENTITY_DEFS } = require('../../src/phase1/runtime');
const { DuplicateError, NotFoundError } = require('../../src/core/errors');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wmit-sqlite-test-'));
}

function buildRuntime(db) {
  ensureEntityTables(db, ENTITY_DEFS);
  const auditLog = new SqliteAuditLog(db);
  const idGenerator = new SqliteIdGenerator(db);
  const repositoryFactory = (type, repoOptions) => new SqliteRepository(db, type, repoOptions.idField);
  return { runtime: createPhase1Runtime({ clock: () => new Date('2026-08-18T08:00:00Z'), idGenerator, auditLog, repositoryFactory, config: { trustedActors: {} } }), auditLog, idGenerator };
}

test('SQLite repositories round-trip records with the same semantics as memory', () => {
  const dir = tempDir();
  const db = openDatabase(path.join(dir, 'test.sqlite3'));
  const repo = (() => { ensureEntityTables(db, { Client: ['CLIENT', false] }); return new SqliteRepository(db, 'Client', 'client_id'); })();
  const inserted = repo.insert({ client_id: 'CLIENT-000001', display_name: 'Test Client', legal_name: 'Test Client' });
  assert.equal(inserted.display_name, 'Test Client');
  assert.equal(repo.exists('CLIENT-000001'), true);
  assert.deepEqual(repo.get('CLIENT-000001').display_name, 'Test Client');
  const updated = repo.update('CLIENT-000001', { display_name: 'Renamed' });
  assert.equal(updated.display_name, 'Renamed');
  assert.equal(repo.get('CLIENT-000001').display_name, 'Renamed');
  assert.throws(() => repo.insert({ client_id: 'CLIENT-000001', display_name: 'Duplicate' }), DuplicateError);
  assert.throws(() => repo.require('CLIENT-999999'), NotFoundError);
  assert.throws(() => repo.update('CLIENT-000001', { client_id: 'CLIENT-000002' }), (error) => error.code === 'IMMUTABLE_ID');
  const removed = repo.delete('CLIENT-000001');
  assert.equal(removed.display_name, 'Renamed');
  assert.equal(repo.exists('CLIENT-000001'), false);
  db.close();
});

test('the Phase 1 runtime works unchanged on SQLite and survives restarts', () => {
  const dir = tempDir();
  const dbPath = path.join(dir, 'runtime.sqlite3');

  const first = buildRuntime(openDatabase(dbPath));
  const client = first.runtime.createClient({ display_name: 'Persistent Client' }, { actor: 'staff' });
  assert.equal(client.ok, true);
  const supplier = first.runtime.createSupplier({ supplier_id: 'SUPPLIER-SQL-000001', display_name: 'Persistent Supplier' }, { actor: 'staff' });
  assert.equal(supplier.ok, true);
  first.runtime.updateClient(client.data.client_id, { display_name: 'Persistent Client Renamed' }, { actor: 'staff' });
  const auditBefore = first.auditLog.list(1000);
  assert.ok(auditBefore.length >= 3);

  // Simulate a restart: fresh connections over the same file.
  const second = buildRuntime(openDatabase(dbPath));
  const reloaded = second.runtime.list('Client')[0];
  assert.equal(reloaded.display_name, 'Persistent Client Renamed');
  assert.equal(second.runtime.list('Supplier')[0].supplier_id, 'SUPPLIER-SQL-000001');
  const chain = second.auditLog.verifyChain();
  assert.equal(chain.valid, true);

  // IDs never reissue after restart: the next client ID must not collide.
  const next = second.runtime.createClient({ display_name: 'After Restart' }, { actor: 'staff' });
  assert.equal(next.ok, true);
  assert.notEqual(next.data.client_id, client.data.client_id);
});

test('the audit hash chain detects tampering', () => {
  const dir = tempDir();
  const dbPath = path.join(dir, 'audit.sqlite3');
  const db = openDatabase(dbPath);
  const auditLog = new SqliteAuditLog(db);
  auditLog.record({ actor: 'staff', action: 'CREATE', entity_type: 'Client', entity_id: 'CLIENT-000001' });
  auditLog.record({ actor: 'staff', action: 'UPDATE', entity_type: 'Client', entity_id: 'CLIENT-000001', details: { changedFields: ['display_name'] } });
  auditLog.record({ actor: 'manager', action: 'VERIFY', entity_type: 'ClientPayment', entity_id: 'CLIENT_PAYMENT-2026-000001' });
  assert.equal(auditLog.verifyChain().valid, true);

  // Tamper with the middle row's content behind the log's back.
  db.prepare("UPDATE audit_log SET details = ? WHERE action = 'UPDATE'").run(JSON.stringify({ changedFields: ['amount'] }));
  const tampered = auditLog.verifyChain();
  assert.equal(tampered.valid, false);
  assert.equal(tampered.reason, 'ROW_HASH_MISMATCH');
  db.close();
});

test('database backups verify and restore-read cleanly', () => {
  const dir = tempDir();
  const dbPath = path.join(dir, 'backup.sqlite3');
  const db = openDatabase(dbPath);
  const { runtime } = buildRuntime(db);
  runtime.createClient({ display_name: 'Backup Client' }, { actor: 'staff' });
  const target = path.join(dir, 'snapshot.sqlite3');
  backupDatabase(db, target);
  assert.equal(fs.existsSync(target), true);

  const restored = openDatabase(target);
  const repo = new SqliteRepository(restored, 'Client', 'client_id');
  assert.equal(repo.list().length, 1);
  assert.equal(repo.list()[0].display_name, 'Backup Client');
  restored.close();
  db.close();
});
