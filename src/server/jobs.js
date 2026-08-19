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

function readRecords(db, entityType) {
  try {
    return db.prepare('SELECT json FROM ' + entityType).all().map((row) => {
      try { return JSON.parse(row.json); } catch (_) { return null; }
    }).filter(Boolean);
  } catch (_) { return []; }
}

function toMinorUnits(value) {
  if (typeof value === 'number') return Math.round(value * 100);
  const match = String(value || '0').match(/^-?\d+(?:\.\d{1,2})?$/);
  if (!match) return 0;
  const [whole, fraction] = String(value).split('.');
  const padded = (fraction || '').padEnd(2, '0');
  return Number(whole) * 100 + Number(padded || '0') * (whole.startsWith('-') ? -1 : 1);
}

function fromMinorUnits(minor) {
  return (Number(minor) / 100).toFixed(2);
}

function daysBetween(fromIso, toIso) {
  const from = new Date(fromIso); const to = new Date(toIso);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return Math.floor((to - from) / (24 * 60 * 60 * 1000));
}

// Receivables: per obligation, outstanding = obligation amount minus ACTIVE
// allocations (mirrors the runtime's allocation math). Overdue adds a past
// due_at. Client names resolved through the Booking → Client link.
function receivablesSnapshot(db, nowIso) {
  const obligations = readRecords(db, 'e_ClientObligation');
  const allocations = readRecords(db, 'e_PaymentAllocation');
  const bookings = new Map(readRecords(db, 'e_Booking').map((booking) => [booking.booking_id, booking]));
  const clients = new Map(readRecords(db, 'e_Client').map((client) => [client.client_id, client]));
  const totals = {};
  let overdueCount = 0;
  const overdue = [];
  for (const obligation of obligations) {
    const amountMinor = toMinorUnits(obligation.amount || obligation.total_amount || obligation.balance_due);
    const allocatedMinor = allocations
      .filter((allocation) => allocation.client_obligation_id === obligation.client_obligation_id && allocation.state === 'ACTIVE')
      .reduce((sum, allocation) => sum + toMinorUnits(allocation.amount), 0);
    const outstandingMinor = amountMinor - allocatedMinor;
    if (outstandingMinor <= 0) continue;
    const currency = obligation.currency || 'PHP';
    totals[currency] = (totals[currency] || 0) + outstandingMinor;
    if (obligation.due_at && String(obligation.due_at) < nowIso) {
      overdueCount += 1;
      const booking = bookings.get(obligation.booking_id);
      const client = booking ? clients.get(booking.client_id) : null;
      overdue.push({
        client_obligation_id: obligation.client_obligation_id,
        booking_id: obligation.booking_id,
        client_name: client ? (client.display_name || client.name || '') : '',
        amount_outstanding: fromMinorUnits(outstandingMinor),
        currency,
        days_overdue: daysBetween(obligation.due_at, nowIso)
      });
    }
  }
  overdue.sort((a, b) => (b.days_overdue || 0) - (a.days_overdue || 0));
  return { outstanding_total_by_currency: totals, overdue_count: overdueCount, top_overdue: overdue.slice(0, 3) };
}

function pendingVerificationSnapshot(db) {
  return readRecords(db, 'e_ClientPayment')
    .filter((payment) => payment.payment_state === 'PENDING_VERIFICATION')
    .slice(0, 5)
    .map((payment) => ({ client_payment_id: payment.client_payment_id, booking_id: payment.booking_id || null, amount: payment.amount, currency: payment.currency || null }));
}

function upcomingTripsSnapshot(db, nowIso, withinDays) {
  const horizon = new Date(new Date(nowIso).getTime() + withinDays * 24 * 60 * 60 * 1000).toISOString();
  const clients = new Map(readRecords(db, 'e_Client').map((client) => [client.client_id, client]));
  return readRecords(db, 'e_Booking')
    .filter((booking) => booking.travel_start && String(booking.travel_start) >= nowIso.slice(0, 10) && String(booking.travel_start) <= horizon.slice(0, 10))
    .sort((a, b) => String(a.travel_start).localeCompare(String(b.travel_start)))
    .slice(0, 10)
    .map((booking) => {
      const client = clients.get(booking.client_id);
      return { booking_id: booking.booking_id, client_name: client ? (client.display_name || client.name || '') : '', destination: booking.destination || null, travel_start: booking.travel_start, status: booking.status || booking.state || null };
    });
}

function expoFunnelSnapshot(db, nowIso) {
  const since = new Date(new Date(nowIso).getTime() - 24 * 60 * 60 * 1000).toISOString();
  const leads = readRecords(db, 'e_ExpoLead');
  const quotes = readRecords(db, 'e_ExpoQuote');
  return {
    leads_last_24h: leads.filter((lead) => String(lead.created_at) >= since).length,
    quotations_awaiting_acceptance: quotes.filter((quote) => quote.status === 'SENT' && !quote.accepted_at && !quote.declined_at).length,
    acceptances_last_24h: quotes.filter((quote) => quote.accepted_at && String(quote.accepted_at) >= since).length
  };
}

function buildDigestSummary(db, options) {
  const opts = options || {};
  const nowIso = opts.now || new Date().toISOString();
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
    payments_pending_verification_detail: pendingVerificationSnapshot(db),
    draft_quotations: draftQuotations,
    receivables: receivablesSnapshot(db, nowIso),
    upcoming_trips_14d: upcomingTripsSnapshot(db, nowIso, 14),
    expo_funnel: expoFunnelSnapshot(db, nowIso),
    heartbeat: latestHeartbeat(db)
  };
}

function renderDigestEmail(summary, baseUrl) {
  const lines = [];
  lines.push('WMIT daily digest — ' + new Date().toISOString().slice(0, 10));
  lines.push('');
  lines.push('== Needs your action ==');
  const pending = summary.payments_pending_verification_detail || [];
  if (summary.payments_pending_verification) {
    lines.push('Payments awaiting verification: ' + summary.payments_pending_verification);
    pending.forEach((payment) => lines.push('  - ' + payment.client_payment_id + (payment.booking_id ? ' (' + payment.booking_id + ')' : '') + ': ' + payment.amount + ' ' + (payment.currency || '')));
  } else {
    lines.push('Payments awaiting verification: none');
  }
  if (summary.receivables.overdue_count) {
    lines.push('Overdue receivables: ' + summary.receivables.overdue_count);
    summary.receivables.top_overdue.forEach((item) => lines.push('  - ' + (item.client_name || item.booking_id) + ' ' + item.booking_id + ': ' + item.amount_outstanding + ' ' + item.currency + ' — ' + (item.days_overdue === null ? '?' : item.days_overdue) + ' days overdue'));
  } else {
    lines.push('Overdue receivables: none');
  }
  lines.push('Open tasks: ' + summary.open_tasks);
  lines.push('');
  lines.push('== Money watch ==');
  const totals = Object.entries(summary.receivables.outstanding_total_by_currency || {});
  if (totals.length) totals.forEach(([currency, minor]) => lines.push('Outstanding receivables ' + currency + ': ' + fromMinorUnits(minor)));
  else lines.push('Outstanding receivables: none');
  lines.push('Draft quotations: ' + summary.draft_quotations);
  lines.push('');
  lines.push('== Trips in the next 14 days ==');
  const trips = summary.upcoming_trips_14d || [];
  if (trips.length) trips.forEach((trip) => lines.push('  - ' + trip.travel_start + ' ' + (trip.client_name || trip.booking_id) + (trip.destination ? ' → ' + trip.destination : '') + ' (' + trip.booking_id + ')'));
  else lines.push('none');
  lines.push('');
  lines.push('== Expo funnel (24h) ==');
  lines.push('Leads captured: ' + summary.expo_funnel.leads_last_24h);
  lines.push('Quotes awaiting acceptance: ' + summary.expo_funnel.quotations_awaiting_acceptance);
  lines.push('Acceptances: ' + summary.expo_funnel.acceptances_last_24h);
  lines.push('');
  lines.push('Heartbeat: ' + (summary.heartbeat ? summary.heartbeat.status + ' at ' + summary.heartbeat.checked_at : 'not yet run'));
  lines.push('');
  lines.push('Sign in to the WMIT workspace' + (baseUrl ? ': ' + baseUrl : '.') + ' to act on these items.');
  return lines.join('\r\n');
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
    const sent = await mailer.send({ to: config.digestTo, subject: 'WMIT daily digest', text: renderDigestEmail(summary, config.baseUrl) });
    return { sent: sent.sent, mode: sent.mode || null, summary };
  });
}

module.exports = { ensureSystemTables, recordJobRun, lastSuccessfulRun, runHeartbeat, latestHeartbeat, createBackup, pruneBackups, rehearseBackup, buildDigestSummary, renderDigestEmail, registerJobs, entityCounts, auditChainValid, integrityCheck };
