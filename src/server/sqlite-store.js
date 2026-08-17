'use strict';

// SQLite-backed persistence for the hosted WMIT server.
//
// The repositories, audit log, and ID generator implement the same interfaces
// as the in-memory versions so the Phase 1 runtime works unchanged. One table
// per entity type stores the canonical record as JSON under its primary ID,
// which keeps the schema flexible while IDs, relationships, and audit remain
// strictly controlled by the runtime.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { WmitError, NotFoundError, DuplicateError } = require('../core/errors');

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function openDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA busy_timeout=5000');
  db.exec('PRAGMA foreign_keys=ON');
  return db;
}

function ensureEntityTables(db, entityDefs) {
  Object.keys(entityDefs).forEach((type) => {
    db.exec('CREATE TABLE IF NOT EXISTS "e_' + type + '" (record_id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT)');
  });
}

function entityTableNames(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'e_%'").all().map((row) => row.name);
}

class SqliteRepository {
  constructor(db, entityType, idField) {
    this.db = db;
    this.entityType = entityType;
    this.idField = idField;
    this.table = 'e_' + entityType;
    this.insertStatement = db.prepare('INSERT INTO ' + this.table + ' (record_id, json, updated_at) VALUES (?, ?, ?)');
    this.selectStatement = db.prepare('SELECT json FROM ' + this.table + ' WHERE record_id = ?');
    this.updateStatement = db.prepare('UPDATE ' + this.table + ' SET json = ?, updated_at = ? WHERE record_id = ?');
    this.deleteStatement = db.prepare('DELETE FROM ' + this.table + ' WHERE record_id = ?');
    this.listStatement = db.prepare('SELECT json FROM ' + this.table);
    this.clearStatement = db.prepare('DELETE FROM ' + this.table);
  }

  insert(record) {
    const id = record[this.idField];
    if (!id) throw new WmitError('INVALID_ID', this.entityType + ' requires a primary ID.');
    const now = new Date().toISOString();
    try {
      this.insertStatement.run(String(id), JSON.stringify(record), now);
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint failed')) throw new DuplicateError(this.entityType, id);
      throw error;
    }
    return clone(record);
  }

  get(id) {
    const row = this.selectStatement.get(String(id));
    if (!row) return null;
    try { return JSON.parse(row.json); } catch (_) { throw new WmitError('RECORD_CORRUPT', this.entityType + ' ' + id + ' has unreadable stored data.'); }
  }

  require(id) {
    const record = this.get(id);
    if (!record) throw new NotFoundError(this.entityType, id);
    return record;
  }

  update(id, changes) {
    const current = this.require(id);
    if (changes[this.idField] && String(changes[this.idField]) !== String(id)) {
      throw new WmitError('IMMUTABLE_ID', this.entityType + ' IDs cannot be changed.', { idField: this.idField });
    }
    const updated = Object.assign({}, current, changes, { [this.idField]: id });
    this.updateStatement.run(JSON.stringify(updated), new Date().toISOString(), String(id));
    return clone(updated);
  }

  delete(id) {
    const current = this.require(id);
    this.deleteStatement.run(String(id));
    return current;
  }

  exists(id) { return Boolean(this.selectStatement.get(String(id))); }

  list() {
    return this.listStatement.all().map((row) => {
      try { return JSON.parse(row.json); } catch (_) { return null; }
    }).filter(Boolean);
  }

  clear() { this.clearStatement.run(); }
}

// Audit rows are hash-chained: each row stores the SHA-256 of the previous
// row hash plus its own canonical content, so silent edits or deletions in the
// middle of the log break verification.
class SqliteAuditLog {
  constructor(db, options) {
    const opts = options || {};
    this.db = db;
    this.listLimit = opts.listLimit || 500;
    db.exec('CREATE TABLE IF NOT EXISTS audit_log (audit_id TEXT PRIMARY KEY, timestamp TEXT, actor TEXT, agent TEXT, action TEXT, entity_type TEXT, entity_id TEXT, result TEXT, details TEXT, correlation_id TEXT, prev_hash TEXT, row_hash TEXT)');
    this.lastHashStatement = db.prepare('SELECT row_hash FROM audit_log ORDER BY rowid DESC LIMIT 1');
    this.insertStatement = db.prepare('INSERT INTO audit_log (audit_id, timestamp, actor, agent, action, entity_type, entity_id, result, details, correlation_id, prev_hash, row_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    this.listStatement = db.prepare('SELECT * FROM audit_log ORDER BY rowid DESC LIMIT ?');
    this.orderedStatement = db.prepare('SELECT rowid, * FROM audit_log ORDER BY rowid ASC');
  }

  rowHash(event, prevHash) {
    const canonical = JSON.stringify([
      event.audit_id, event.timestamp, event.actor, event.agent || null, event.action,
      event.entity_type || null, event.entity_id || null, event.result || 'SUCCESS',
      event.details || {}, event.correlation_id || null, prevHash || ''
    ]);
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  record(event) {
    const input = event || {};
    const prior = this.lastHashStatement.get();
    const prevHash = prior ? prior.row_hash : '';
    const auditEvent = {
      audit_id: input.audit_id || ('AUDIT-' + crypto.randomUUID()),
      timestamp: input.timestamp || new Date().toISOString(),
      actor: input.actor || 'SYSTEM',
      agent: input.agent || null,
      action: input.action || 'SYSTEM',
      entity_type: input.entity_type || null,
      entity_id: input.entity_id || null,
      result: input.result || 'SUCCESS',
      details: input.details || {},
      correlation_id: input.correlation_id || null,
      prev_hash: prevHash,
      row_hash: ''
    };
    auditEvent.row_hash = this.rowHash(auditEvent, prevHash);
    this.insertStatement.run(auditEvent.audit_id, auditEvent.timestamp, auditEvent.actor, auditEvent.agent, auditEvent.action, auditEvent.entity_type, auditEvent.entity_id, auditEvent.result, JSON.stringify(auditEvent.details), auditEvent.correlation_id, auditEvent.prev_hash, auditEvent.row_hash);
    return clone(auditEvent);
  }

  list(limit) {
    return this.listStatement.all(Number(limit) || this.listLimit).map((row) => {
      let details = {};
      try { details = JSON.parse(row.details || '{}'); } catch (_) { details = {}; }
      return { audit_id: row.audit_id, timestamp: row.timestamp, actor: row.actor, agent: row.agent, action: row.action, entity_type: row.entity_type, entity_id: row.entity_id, result: row.result, details, correlation_id: row.correlation_id, prev_hash: row.prev_hash, row_hash: row.row_hash };
    });
  }

  verifyChain() {
    const rows = this.orderedStatement.all();
    let prevHash = '';
    for (const row of rows) {
      let details = {};
      try { details = JSON.parse(row.details || '{}'); } catch (_) { details = {}; }
      const event = { audit_id: row.audit_id, timestamp: row.timestamp, actor: row.actor, agent: row.agent, action: row.action, entity_type: row.entity_type, entity_id: row.entity_id, result: row.result, details, correlation_id: row.correlation_id };
      if ((row.prev_hash || '') !== prevHash) return { valid: false, broken_at: row.audit_id, reason: 'PREV_HASH_MISMATCH' };
      if (this.rowHash(event, prevHash) !== row.row_hash) return { valid: false, broken_at: row.audit_id, reason: 'ROW_HASH_MISMATCH' };
      prevHash = row.row_hash;
    }
    return { valid: true, entries: rows.length };
  }
}

// Persistent replacement for the in-memory ID generator: the next sequence
// number is derived from the highest existing ID with that prefix across all
// entity tables, so restarts never reissue an ID.
class SqliteIdGenerator {
  constructor(db) {
    this.db = db;
    this.tables = entityTableNames(db);
    this.counters = {};
  }

  refreshTables() { this.tables = entityTableNames(this.db); }

  scanMax(prefix, yearBased, year) {
    let max = 0;
    const pattern = yearBased
      ? new RegExp('^' + prefix + '-' + (year || '\\d{4}') + '-(\\d{6})$')
      : new RegExp('^' + prefix + '(?:-TEST)?-(\\d{6})$');
    for (const table of this.tables) {
      const rows = this.db.prepare('SELECT record_id FROM ' + table + " WHERE record_id LIKE ?").all(prefix + '-%');
      for (const row of rows) {
        const match = String(row.record_id).match(pattern);
        if (match) max = Math.max(max, Number(match[1]));
      }
    }
    return max;
  }

  counterKey(prefix, options) {
    const yearBased = options && options.yearBased === true;
    return yearBased ? prefix + ':' + (options.year || new Date().getUTCFullYear()) : prefix;
  }

  next(prefix, options) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(prefix)) throw new WmitError('INVALID_ID_PREFIX', 'ID prefix must use uppercase letters, numbers, or underscores.', { prefix });
    const opts = options || {};
    const key = this.counterKey(prefix, opts);
    if (this.counters[key] === undefined) {
      this.refreshTables();
      this.counters[key] = this.scanMax(prefix, opts.yearBased === true, opts.year);
    }
    const nextNumber = this.counters[key] + 1;
    this.counters[key] = nextNumber;
    const sequence = String(nextNumber).padStart(6, '0');
    return opts.yearBased === true ? prefix + '-' + (opts.year || new Date().getUTCFullYear()) + '-' + sequence : prefix + '-' + sequence;
  }

  reserve(prefix, id, options) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(prefix)) throw new WmitError('INVALID_ID_PREFIX', 'ID prefix must use uppercase letters, numbers, or underscores.', { prefix });
    const opts = options || {};
    const pattern = opts.yearBased === true
      ? new RegExp('^' + prefix + '-([0-9]{4})-([0-9]{6})$')
      : new RegExp('^' + prefix + '(?:-TEST)?-([0-9]{6})$');
    const match = String(id || '').match(pattern);
    if (!match) return;
    const key = opts.yearBased === true ? prefix + ':' + match[1] : prefix;
    const number = Number(opts.yearBased === true ? match[2] : match[1]);
    if (this.counters[key] === undefined) {
      this.refreshTables();
      this.counters[key] = this.scanMax(prefix, opts.yearBased === true, match[1]);
    }
    this.counters[key] = Math.max(this.counters[key] || 0, number);
  }

  snapshot() { return Object.assign({}, this.counters); }
}

function backupDatabase(db, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  try { fs.rmSync(targetPath, { force: true }); } catch (_) { /* overwrite attempt */ }
  const escaped = String(targetPath).replace(/'/g, "''");
  db.exec("VACUUM INTO '" + escaped + "'");
  return targetPath;
}

module.exports = { openDatabase, ensureEntityTables, entityTableNames, SqliteRepository, SqliteAuditLog, SqliteIdGenerator, backupDatabase };
