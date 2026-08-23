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

test('the digest morning brief reports receivables, pending payments, trips, and the expo funnel', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmit-digest-'));
  const db = buildDb(dir);
  const now = '2026-08-19T00:00:00.000Z';
  const tasks = new SqliteRepository(db, 'Task', 'task_id');
  tasks.insert({ task_id: 'TASK-2026-000001', state: 'OPEN', description: 'Follow up' });
  tasks.insert({ task_id: 'TASK-2026-000002', state: 'COMPLETED', description: 'Done' });
  new SqliteRepository(db, 'Client', 'client_id').insert({ client_id: 'CLIENT-000001', display_name: 'Del Cruz Juan' });
  new SqliteRepository(db, 'Booking', 'booking_id').insert({ booking_id: 'BOOKING-2026-000001', client_id: 'CLIENT-000001', destination: 'Bangkok', travel_start: '2026-08-29', status: 'Confirmed' });
  const obligations = new SqliteRepository(db, 'ClientObligation', 'client_obligation_id');
  obligations.insert({ client_obligation_id: 'CO-2026-000001', booking_id: 'BOOKING-2026-000001', currency: 'PHP', amount: '10000.00', due_at: '2026-08-10T09:00:00.000Z' });
  obligations.insert({ client_obligation_id: 'CO-2026-000002', booking_id: 'BOOKING-2026-000001', currency: 'PHP', amount: '5000.00', due_at: '2026-09-01T09:00:00.000Z' });
  new SqliteRepository(db, 'PaymentAllocation', 'payment_allocation_id').insert({ payment_allocation_id: 'PA-2026-000001', client_obligation_id: 'CO-2026-000001', state: 'ACTIVE', amount: '4000.00' });
  new SqliteRepository(db, 'ClientPayment', 'client_payment_id').insert({ client_payment_id: 'CLIENT_PAYMENT-2026-000001', booking_id: 'BOOKING-2026-000001', payment_state: 'PENDING_VERIFICATION', amount: '6000.00', currency: 'PHP' });
  new SqliteRepository(db, 'ExpoLead', 'expo_lead_id').insert({ expo_lead_id: 'EXPO_LEAD-2026-000001', status: 'NEW', created_at: '2026-08-18T12:00:00.000Z' });
  const quotes = new SqliteRepository(db, 'ExpoQuote', 'expo_quote_id');
  quotes.insert({ expo_quote_id: 'EXPO_QUOTE-2026-000001', expo_tag: 'EXPO-2026', status: 'SENT', accepted_at: null, declined_at: null, created_at: '2026-08-18T10:00:00.000Z' });
  quotes.insert({ expo_quote_id: 'EXPO_QUOTE-2026-000002', expo_tag: 'EXPO-2026', status: 'ACCEPTED', accepted_at: '2026-08-18T20:00:00.000Z', declined_at: null, created_at: '2026-08-18T10:00:00.000Z' });

  const summary = buildDigestSummary(db, { now });
  assert.equal(summary.open_tasks, 1);
  assert.equal(summary.payments_pending_verification, 1);
  assert.equal(summary.payments_pending_verification_detail[0].client_payment_id, 'CLIENT_PAYMENT-2026-000001');
  // CO-1: 10000 - 4000 allocated = 6000 outstanding; 2026-08-10T09:00Z → 2026-08-19T00:00Z = 8.625 → 8 days overdue. CO-2: 5000 outstanding, not yet due.
  assert.equal(summary.receivables.outstanding_total_by_currency.PHP, 1100000);
  assert.equal(summary.receivables.overdue_count, 1);
  assert.equal(summary.receivables.top_overdue[0].client_name, 'Del Cruz Juan');
  assert.equal(summary.receivables.top_overdue[0].amount_outstanding, '6000.00');
  assert.equal(summary.receivables.top_overdue[0].days_overdue, 8);
  assert.equal(summary.upcoming_trips_14d.length, 1);
  assert.equal(summary.upcoming_trips_14d[0].booking_id, 'BOOKING-2026-000001');
  assert.equal(summary.upcoming_trips_14d[0].travel_start, '2026-08-29');
  assert.equal(summary.expo_funnel.leads_last_24h, 1);
  assert.equal(summary.expo_funnel.quotations_awaiting_acceptance, 1);
  assert.equal(summary.expo_funnel.acceptances_last_24h, 1);

  const email = require('../../src/server/jobs').renderDigestEmail(summary, 'https://app.example.ph');
  assert.match(email, /Del Cruz Juan BOOKING-2026-000001: 6000\.00 PHP — 8 days overdue/);
  assert.match(email, /Outstanding receivables PHP: 11000\.00/);
  assert.match(email, /CLIENT_PAYMENT-2026-000001/);
  assert.match(email, /2026-08-29 Del Cruz Juan → Bangkok/);
  assert.match(email, /Leads captured: 1/);
  assert.match(email, /Sign in to the WMIT workspace: https:\/\/app\.example\.ph/);
  db.close();
});

test('the digest renders empty sections as none and the mailer degrades to .eml without SMTP', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmit-digest-empty-'));
  const db = buildDb(dir);
  const summary = buildDigestSummary(db);
  assert.equal(summary.open_tasks, 0);
  assert.equal(summary.receivables.overdue_count, 0);
  assert.equal(summary.upcoming_trips_14d.length, 0);
  assert.equal(summary.expo_funnel.leads_last_24h, 0);
  const email = require('../../src/server/jobs').renderDigestEmail(summary, null);
  assert.match(email, /Payments awaiting verification: none/);
  assert.match(email, /Overdue receivables: none/);
  assert.match(email, /Outstanding receivables: none/);

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

test('the digest leads the action section with reminder drafts, then documents, departure alerts, and the privacy queue', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmit-digest-queues-'));
  const db = buildDb(dir);
  const now = '2026-08-19T00:00:00.000Z';
  const tasks = new SqliteRepository(db, 'Task', 'task_id');
  tasks.insert({ task_id: 'TASK-2026-000001', task_type: 'REMINDER_DRAFT', state: 'OPEN', send_state: 'DRAFT', category: 'PAYMENT_FOLLOW_UP', subject: 'Balance reminder — Del Cruz Juan', created_at: '2026-08-18T09:00:00.000Z' });
  tasks.insert({ task_id: 'TASK-2026-000002', task_type: 'REMINDER_DRAFT', state: 'CANCELLED', send_state: 'DRAFT', category: 'PAYMENT_FOLLOW_UP', subject: 'Discarded draft', created_at: '2026-08-18T09:05:00.000Z' });
  tasks.insert({ task_id: 'TASK-2026-000003', task_type: 'DEPARTURE_READINESS', state: 'OPEN', title: 'Departure readiness: Passport copy — Bangkok October', created_at: '2026-08-18T06:00:00.000Z' });
  tasks.insert({ task_id: 'TASK-2026-000004', task_type: 'PRIVACY_RETENTION', state: 'OPEN', title: 'Privacy retention: 12 document(s) eligible for erasure', created_at: '2026-08-18T05:00:00.000Z' });
  const documents = new SqliteRepository(db, 'Document', 'document_id');
  documents.insert({ document_id: 'DOC-2026-000001', status: 'NEEDS_REVIEW', classification: { document_type: 'passport' }, created_at: '2026-08-18T08:00:00.000Z' });
  documents.insert({ document_id: 'DOC-2026-000002', status: 'MATCHED', created_at: '2026-08-18T08:30:00.000Z' });
  new SqliteRepository(db, 'ClientPayment', 'client_payment_id').insert({ client_payment_id: 'CLIENT_PAYMENT-2026-000001', payment_state: 'PENDING_VERIFICATION', amount: '6000.00', currency: 'PHP' });

  const summary = buildDigestSummary(db, { now });
  assert.equal(summary.reminder_drafts_pending, 1);
  assert.equal(summary.reminder_drafts_pending_detail[0].subject, 'Balance reminder — Del Cruz Juan');
  assert.equal(summary.documents_pending_review, 1);
  assert.equal(summary.documents_pending_review_detail[0].document_id, 'DOC-2026-000001');
  assert.equal(summary.documents_pending_review_detail[0].type_hint, 'passport');
  assert.equal(summary.departure_readiness_alerts, 1);
  assert.equal(summary.departure_readiness_alerts_detail[0].title, 'Departure readiness: Passport copy — Bangkok October');
  assert.equal(summary.privacy_retention_queue, 1);
  assert.equal(summary.privacy_retention_detail[0].title, 'Privacy retention: 12 document(s) eligible for erasure');

  const email = require('../../src/server/jobs').renderDigestEmail(summary, null);
  assert.match(email, /Reminder drafts awaiting review: 1/);
  assert.match(email, /  - Balance reminder — Del Cruz Juan \(PAYMENT_FOLLOW_UP\)/);
  assert.match(email, /Documents pending review: 1/);
  assert.match(email, /  - DOC-2026-000001 \(passport\)/);
  assert.match(email, /Departure readiness alerts: 1/);
  assert.match(email, /  - Departure readiness: Passport copy — Bangkok October/);
  assert.match(email, /Privacy retention queue: 1/);
  assert.match(email, /  - Privacy retention: 12 document\(s\) eligible for erasure/);
  assert.ok(!email.includes('Discarded draft'), 'cancelled drafts must not appear');
  assert.ok(!email.includes('DOC-2026-000002'), 'reviewed/matched documents must not appear');

  const reminderAt = email.indexOf('Reminder drafts awaiting review');
  const documentsAt = email.indexOf('Documents pending review');
  const departureAt = email.indexOf('Departure readiness alerts');
  const privacyAt = email.indexOf('Privacy retention queue');
  const paymentsAt = email.indexOf('Payments awaiting verification');
  assert.ok(reminderAt > -1 && documentsAt > reminderAt && departureAt > documentsAt && privacyAt > departureAt && paymentsAt > privacyAt, 'reminder drafts must lead the action section');
  db.close();
});

test('the digest omits the new queue sections entirely on an empty workspace', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmit-digest-queues-empty-'));
  const db = buildDb(dir);
  const summary = buildDigestSummary(db);
  assert.equal(summary.reminder_drafts_pending, 0);
  assert.deepEqual(summary.reminder_drafts_pending_detail, []);
  assert.equal(summary.documents_pending_review, 0);
  assert.deepEqual(summary.documents_pending_review_detail, []);
  assert.equal(summary.departure_readiness_alerts, 0);
  assert.equal(summary.privacy_retention_queue, 0);
  const email = require('../../src/server/jobs').renderDigestEmail(summary, null);
  assert.match(email, /== Needs your action ==/);
  assert.ok(!email.includes('Reminder drafts awaiting review'));
  assert.ok(!email.includes('Documents pending review'));
  assert.ok(!email.includes('Departure readiness alerts'));
  assert.ok(!email.includes('Privacy retention queue'));
  db.close();
});

test('digest queues cap their detail lists, exclude cleared items, and rank documents worst-first', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmit-digest-queues-caps-'));
  const db = buildDb(dir);
  const tasks = new SqliteRepository(db, 'Task', 'task_id');
  for (let index = 1; index <= 6; index += 1) {
    tasks.insert({ task_id: 'TASK-2026-00000' + index, task_type: 'REMINDER_DRAFT', state: 'OPEN', send_state: 'DRAFT', category: 'PAYMENT_FOLLOW_UP', subject: 'Draft ' + index, created_at: '2026-08-18T09:0' + index + ':00.000Z' });
  }
  tasks.insert({ task_id: 'TASK-2026-000010', task_type: 'REMINDER_DRAFT', state: 'OPEN', send_state: 'SENT', category: 'PAYMENT_FOLLOW_UP', subject: 'Already sent', created_at: '2026-08-18T10:00:00.000Z' });
  tasks.insert({ task_id: 'TASK-2026-000011', task_type: 'REMINDER_DRAFT', state: 'COMPLETED', send_state: 'DRAFT', category: 'PAYMENT_FOLLOW_UP', subject: 'Completed draft', created_at: '2026-08-18T10:00:00.000Z' });
  const documents = new SqliteRepository(db, 'Document', 'document_id');
  documents.insert({ document_id: 'DOC-2026-000003', status: 'RECEIVED', filename: 'voucher.pdf', created_at: '2026-08-18T09:00:00.000Z' });
  documents.insert({ document_id: 'DOC-2026-000004', status: 'NEEDS_REVIEW', filename: 'passport-scan.pdf', created_at: '2026-08-18T08:00:00.000Z' });
  documents.insert({ document_id: 'DOC-2026-000005', status: 'ARCHIVED', created_at: '2026-08-18T08:00:00.000Z' });

  const summary = buildDigestSummary(db);
  assert.equal(summary.reminder_drafts_pending, 6);
  assert.equal(summary.reminder_drafts_pending_detail.length, 5);
  assert.equal(summary.reminder_drafts_pending_detail[0].subject, 'Draft 1');
  assert.ok(!summary.reminder_drafts_pending_detail.some((draft) => draft.subject === 'Already sent' || draft.subject === 'Completed draft'));
  assert.equal(summary.documents_pending_review, 2);
  assert.equal(summary.documents_pending_review_detail[0].document_id, 'DOC-2026-000004', 'NEEDS_REVIEW must rank above RECEIVED');
  assert.ok(!summary.documents_pending_review_detail.some((document) => document.document_id === 'DOC-2026-000005'));

  const email = require('../../src/server/jobs').renderDigestEmail(summary, null);
  assert.match(email, /Reminder drafts awaiting review: 6/);
  assert.ok(email.includes('Draft 5'));
  assert.ok(!email.includes('Draft 6'), 'only the top five drafts are listed');
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
