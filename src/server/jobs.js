'use strict';

// Hosted-server background jobs: workspace heartbeat, SQLite backups with an
// automatic restore rehearsal, and the daily digest (email when SMTP is
// configured, otherwise a recorded skip).

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { backupDatabase } = require('./sqlite-store');

function ensureSystemTables(db) {
  db.exec('CREATE TABLE IF NOT EXISTS system_job_runs (name TEXT, started_at TEXT, finished_at TEXT, status TEXT, detail TEXT)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_system_job_runs_name ON system_job_runs(name, started_at)');
  db.exec('CREATE TABLE IF NOT EXISTS system_heartbeat (checked_at TEXT PRIMARY KEY, status TEXT, detail TEXT)');
  // The audit log is owned by SqliteAuditLog; ensure it exists here too so
  // heartbeat verification works on a fresh database before any audit write.
  db.exec('CREATE TABLE IF NOT EXISTS audit_log (audit_id TEXT PRIMARY KEY, timestamp TEXT, actor TEXT, agent TEXT, action TEXT, entity_type TEXT, entity_id TEXT, result TEXT, details TEXT, correlation_id TEXT, prev_hash TEXT, row_hash TEXT)');
}

function recordJobRun(db, name, run) {
  db.prepare('INSERT INTO system_job_runs (name, started_at, finished_at, status, detail) VALUES (?, ?, ?, ?, ?)')
    .run(name, run.startedAt, run.finishedAt, run.status, JSON.stringify(run.detail || null));
}

function lastSuccessfulRun(db, name) {
  const row = db.prepare("SELECT * FROM system_job_runs WHERE name = ? AND status = 'SUCCESS' ORDER BY started_at DESC LIMIT 1").get(name);
  return row || null;
}

function integrityCheck(db) {
  const rows = db.prepare('PRAGMA integrity_check').all();
  return rows.map((row) => Object.values(row)[0]).join('; ');
}

function entityCounts(db) {
  const counts = {};
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'e_%'").all().map((row) => row.name);
  tables.forEach((table) => {
    counts[table.slice(2)] = db.prepare('SELECT COUNT(*) AS c FROM ' + table).get().c;
  });
  return counts;
}

function auditChainValid(db) {
  const rows = db.prepare('SELECT rowid, * FROM audit_log ORDER BY rowid ASC').all();
  const crypto = require('node:crypto');
  let prevHash = '';
  for (const row of rows) {
    if ((row.prev_hash || '') !== prevHash) return { valid: false, entries: rows.length, broken_at: row.audit_id };
    const canonical = JSON.stringify([
      row.audit_id, row.timestamp, row.actor, row.agent, row.action,
      row.entity_type, row.entity_id, row.result,
      JSON.parse(row.details || '{}'), row.correlation_id, prevHash
    ]);
    if (crypto.createHash('sha256').update(canonical).digest('hex') !== row.row_hash) return { valid: false, entries: rows.length, broken_at: row.audit_id };
    prevHash = row.row_hash;
  }
  return { valid: true, entries: rows.length };
}

function runHeartbeat(db) {
  const checkedAt = new Date().toISOString();
  const findings = [];
  let status = 'OK';
  try {
    const integrity = integrityCheck(db);
    if (integrity !== 'ok') { status = 'DEGRADED'; findings.push({ check: 'sqlite_integrity', result: integrity }); }
  } catch (error) {
    status = 'DEGRADED';
    findings.push({ check: 'sqlite_integrity', error: String(error.message || error).slice(0, 200) });
  }
  try {
    const chain = auditChainValid(db);
    if (!chain.valid) { status = 'DEGRADED'; findings.push({ check: 'audit_chain', result: 'BROKEN', broken_at: chain.broken_at }); }
  } catch (error) {
    status = 'DEGRADED';
    findings.push({ check: 'audit_chain', error: String(error.message || error).slice(0, 200) });
  }
  const detail = { status, findings, entity_counts: entityCounts(db) };
  db.prepare('INSERT OR REPLACE INTO system_heartbeat (checked_at, status, detail) VALUES (?, ?, ?)').run(checkedAt, status, JSON.stringify(detail));
  return detail;
}

function latestHeartbeat(db) {
  const row = db.prepare('SELECT * FROM system_heartbeat ORDER BY checked_at DESC LIMIT 1').get();
  if (!row) return null;
  let detail = null;
  try { detail = JSON.parse(row.detail); } catch (_) { detail = null; }
  return { checked_at: row.checked_at, status: row.status, detail };
}

function createBackup(db, config) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const target = path.join(config.backupDir, 'wmit-' + stamp + '.sqlite3');
  backupDatabase(db, target);
  pruneBackups(config.backupDir, config.backupKeep);
  return { file: target, size: fs.statSync(target).size };
}

function pruneBackups(dir, keep) {
  const files = fs.readdirSync(dir).filter((name) => name.startsWith('wmit-') && name.endsWith('.sqlite3')).sort();
  while (files.length > keep) {
    const removed = files.shift();
    try { fs.rmSync(path.join(dir, removed)); } catch (_) { /* best effort */ }
  }
}

// A backup nobody has rehearsed is not a backup: open the dump read-only,
// verify integrity, entity counts, and the audit chain.
function rehearseBackup(backupPath, expectedCounts) {
  const db = new DatabaseSync(backupPath, { readOnly: true });
  try {
    const integrity = integrityCheck(db);
    if (integrity !== 'ok') throw new Error('Backup integrity check failed: ' + integrity);
    const counts = entityCounts(db);
    let chain = { valid: true, entries: 0 };
    try { chain = auditChainValid(db); } catch (_) { /* backup taken before audit table existed */ }
    if (!chain.valid) throw new Error('Backup audit chain verification failed at ' + chain.broken_at);
    const drift = [];
    Object.keys(expectedCounts || {}).forEach((type) => {
      if ((counts[type] || 0) < Number(expectedCounts[type])) drift.push({ entity: type, expected: expectedCounts[type], found: counts[type] || 0 });
    });
    if (drift.length) throw new Error('Backup is missing records: ' + JSON.stringify(drift));
    return { ok: true, integrity, counts };
  } finally {
    db.close();
  }
}

function buildDigestSummary(db) {
  const counts = entityCounts(db);
  const openTasks = (() => {
    try {
      return db.prepare("SELECT json FROM e_Task WHERE json LIKE '%\"state\":\"OPEN\"%' OR json LIKE '%\"state\":\"IN_PROGRESS\"%' OR json LIKE '%\"state\":\"BLOCKED\"%'").all().length;
    } catch (_) { return 0; }
  })();
  const pendingPayments = (() => {
    try { return db.prepare("SELECT COUNT(*) AS c FROM e_ClientPayment WHERE json LIKE '%PENDING_VERIFICATION%'").get().c; } catch (_) { return 0; }
  })();
  const draftQuotations = (() => {
    try { return db.prepare("SELECT COUNT(*) AS c FROM e_Quotation WHERE json LIKE '%DRAFT%'").get().c; } catch (_) { return 0; }
  })();
  return {
    entity_counts: counts,
    open_tasks: openTasks,
    payments_pending_verification: pendingPayments,
    draft_quotations: draftQuotations,
    heartbeat: latestHeartbeat(db)
  };
}

function registerJobs(scheduler, options) {
  const opts = options || {};
  const db = opts.db;
  const config = opts.config;
  const mailer = opts.mailer || null;

  scheduler.register('heartbeat', { intervalMs: 60 * 60 * 1000 }, () => runHeartbeat(db));
  scheduler.register('backup', { daily: { hour: 1, minute: 15 } }, async () => {
    const backup = createBackup(db, config);
    const rehearsal = rehearseBackup(backup.file, entityCounts(db));
    return { backup: backup.file, size_bytes: backup.size, rehearsal };
  });
  scheduler.register('digest', { daily: { hour: 8, minute: 0 } }, async () => {
    const summary = buildDigestSummary(db);
    if (!mailer || !config.digestTo || !config.smtpConfigured()) {
      return { skipped: true, reason: mailer && config.digestTo ? 'SMTP_NOT_CONFIGURED' : 'DIGEST_RECIPIENT_NOT_CONFIGURED', summary };
    }
    const lines = [
      'WMIT daily digest — ' + new Date().toISOString().slice(0, 10),
      '',
      'Open tasks: ' + summary.open_tasks,
      'Payments awaiting verification: ' + summary.payments_pending_verification,
      'Draft quotations: ' + summary.draft_quotations,
      'Heartbeat: ' + (summary.heartbeat ? summary.heartbeat.status + ' at ' + summary.heartbeat.checked_at : 'not yet run'),
      '',
      'Sign in to the WMIT workspace to act on these items.'
    ];
    const sent = await mailer.send({ to: config.digestTo, subject: 'WMIT daily digest', text: lines.join('\r\n') });
    return { sent: sent.sent, mode: sent.mode || null, summary };
  });
}

module.exports = { ensureSystemTables, recordJobRun, lastSuccessfulRun, runHeartbeat, latestHeartbeat, createBackup, pruneBackups, rehearseBackup, buildDigestSummary, registerJobs, entityCounts, auditChainValid, integrityCheck };
