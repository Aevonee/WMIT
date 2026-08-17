'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Scheduler } = require('../../src/server/scheduler');
const { Mailer } = require('../../src/server/mailer');
const { ensureSystemTables, recordJobRun, runHeartbeat, latestHeartbeat, createBackup, rehearseBackup, buildDigestSummary, entityCounts } = require('../../src/server/jobs');
const { openDatabase, ensureEntityTables, SqliteRepository, SqliteAuditLog } = require('../../src/server/sqlite-store');
const { ENTITY_DEFS } = require('../../src/phase1/runtime');

function buildDb(dir) {
  const db = openDatabase(path.join(dir, 'jobs.sqlite3'));
  ensureEntityTables(db, ENTITY_DEFS);
  ensureSystemTables(db);
  return db;
}

test('scheduler runs interval jobs and records every run', async () => {
  const runs = [];
  const scheduler = new Scheduler({ onRun: (name, run) => runs.push({ name, status: run.status }) });
  let counter = 0;
  scheduler.register('ticker', { intervalMs: 5 }, () => { counter += 1; return { counter }; });
  scheduler.start();
  await new Promise((resolve) => setTimeout(resolve, 80));
  scheduler.stop();
  assert.ok(counter >= 2, 'interval job should have run repeatedly, ran ' + counter + ' times');
  assert.equal(runs.every((run) => run.name === 'ticker' && run.status === 'SUCCESS'), true);
});

test('scheduler computes the next daily run in Asia/Manila and records failures', async () => {
  const runs = [];
  const scheduler = new Scheduler({ timezone: 'Asia/Manila', onRun: (name, run) => runs.push(run) });
  scheduler.register('digest', { daily: { hour: 8, minute: 0 } }, () => { throw new Error('SMTP unreachable'); });
  // 08:00 Manila = 00:00 UTC (UTC+8, no DST), always within the next ~24.5h.
  const computed = scheduler.nextRunAt('digest');
  const date = new Date(computed);
  assert.equal(date.getUTCHours(), 0);
  assert.equal(date.getUTCMinutes(), 0);
  assert.ok(computed - Date.now() > 0);
  assert.ok(computed - Date.now() < 24.5 * 60 * 60 * 1000);
  const result = await scheduler.runOnce('digest');
  assert.equal(result.status, 'FAILURE');
  assert.match(result.detail.error, /SMTP unreachable/);
  assert.equal(runs[0].status, 'FAILURE');
  scheduler.stop();
});

test('heartbeat records integrity, audit-chain status, and entity counts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmit-hb-'));
  const db = buildDb(dir);
  const repo = new SqliteRepository(db, 'Client', 'client_id');
  repo.insert({ client_id: 'CLIENT-000001', display_name: 'Heartbeat Client' });
  const detail = runHeartbeat(db);
  assert.equal(detail.status, 'OK');
  assert.equal(detail.findings.length, 0);
  assert.equal(detail.entity_counts.Client, 1);
  const latest = latestHeartbeat(db);
  assert.equal(latest.status, 'OK');
  assert.equal(latest.detail.entity_counts.Client, 1);

  // Corrupt the audit table to degrade the heartbeat.
  db.prepare("INSERT INTO audit_log (audit_id, timestamp, actor, agent, action, entity_type, entity_id, result, details, correlation_id, prev_hash, row_hash) VALUES ('FAKE','2026-01-01','x',null,'X',null,null,'SUCCESS','{}',null,'0000','0000')").run();
  const degraded = runHeartbeat(db);
  assert.equal(degraded.status, 'DEGRADED');
  assert.ok(degraded.findings.some((finding) => finding.check === 'audit_chain'));
  db.close();
});

test('backups are created, pruned, and rehearsed — and corrupt backups fail closed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmit-backup-'));
  const db = buildDb(dir);
  new SqliteRepository(db, 'Client', 'client_id').insert({ client_id: 'CLIENT-000001', display_name: 'Backup Client' });
  const config = { backupDir: path.join(dir, 'backups'), backupKeep: 2 };
  const first = createBackup(db, config);
  assert.equal(fs.existsSync(first.file), true);
  const rehearsal = rehearseBackup(first.file, entityCounts(db));
  assert.equal(rehearsal.ok, true);

  const corrupt = path.join(config.backupDir, 'corrupt.sqlite3');
  fs.writeFileSync(corrupt, 'this is not a database');
  assert.throws(() => rehearseBackup(corrupt, {}), /integrity|file|Unable|not a database/i);

  createBackup(db, config);
  createBackup(db, config);
  const remaining = fs.readdirSync(config.backupDir).filter((name) => name.endsWith('.sqlite3') && name.startsWith('wmit-'));
  assert.equal(remaining.length <= 2, true, 'pruning must respect backupKeep');
  db.close();
});

test('the digest summary counts open work and the mailer degrades to .eml without SMTP', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmit-digest-'));
  const db = buildDb(dir);
  const tasks = new SqliteRepository(db, 'Task', 'task_id');
  tasks.insert({ task_id: 'TASK-2026-000001', state: 'OPEN', description: 'Follow up' });
  tasks.insert({ task_id: 'TASK-2026-000002', state: 'COMPLETED', description: 'Done' });
  const payments = new SqliteRepository(db, 'ClientPayment', 'client_payment_id');
  payments.insert({ client_payment_id: 'CLIENT_PAYMENT-2026-000001', payment_state: 'PENDING_VERIFICATION' });
  const summary = buildDigestSummary(db);
  assert.equal(summary.open_tasks, 1);
  assert.equal(summary.payments_pending_verification, 1);

  const outbox = path.join(dir, 'outbox');
  const mailer = new Mailer({ smtp: {}, outboxDir: outbox });
  const result = await mailer.send({ to: 'owner@example.test', subject: 'WMIT digest', text: 'hello' });
  assert.equal(result.sent, false);
  assert.equal(result.mode, 'eml_file');
  const eml = fs.readFileSync(result.path, 'utf8');
  assert.match(eml, /Subject: WMIT digest/);
  assert.match(eml, /To: owner@example\.test/);
  db.close();
});

test('job run history supports checkpointing via last successful run', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmit-jobhist-'));
  const db = buildDb(dir);
  recordJobRun(db, 'backup', { status: 'FAILURE', startedAt: '2026-08-18T01:15:00Z', finishedAt: '2026-08-18T01:15:02Z', detail: { error: 'disk full' } });
  recordJobRun(db, 'backup', { status: 'SUCCESS', startedAt: '2026-08-19T01:15:00Z', finishedAt: '2026-08-19T01:15:02Z', detail: { backup: 'x' } });
  recordJobRun(db, 'backup', { status: 'FAILURE', startedAt: '2026-08-20T01:15:00Z', finishedAt: '2026-08-20T01:15:02Z', detail: { error: 'again' } });
  const last = require('../../src/server/jobs').lastSuccessfulRun(db, 'backup');
  assert.equal(last.started_at, '2026-08-19T01:15:00Z');
  db.close();
});
