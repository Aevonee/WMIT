'use strict';

// Composition root for the hosted WMIT server: SQLite persistence, runtime,
// authentication, scheduler with background jobs, and the HTTP server bound
// together. scripts/run-server.js is the thin entry point.

const { loadConfig } = require('./config');
const { openDatabase, ensureEntityTables, SqliteRepository, SqliteAuditLog, SqliteIdGenerator } = require('./sqlite-store');
const { AuthStore } = require('./auth');
const { Scheduler } = require('./scheduler');
const { Mailer } = require('./mailer');
const { ensureSystemTables, recordJobRun, registerJobs, runHeartbeat } = require('./jobs');
const { ExpoService } = require('../expo/expo-service');
const { createPdfTariffUploadAdapter } = require('../adapters/pdf-tariff-upload-adapter');
const { createPasteTariffUploadAdapter } = require('../adapters/paste-tariff-upload-adapter');
const { createPhase1Runtime, ENTITY_DEFS } = require('../phase1/runtime');
const { createPhase1Application } = require('../application/phase1');
const { createMvpServer } = require('../../app/server');
const fs = require('node:fs');
const path = require('node:path');

function createHostedServer(options) {
  const opts = options || {};
  const config = opts.config || loadConfig(opts);
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.backupDir, { recursive: true });

  const db = openDatabase(config.dbPath);
  ensureEntityTables(db, ENTITY_DEFS);
  ensureSystemTables(db);

  // Runtime settings (quotation defaults, message templates) survive restarts:
  // restored into config at boot, rewritten by updateSettings' change hook.
  db.exec('CREATE TABLE IF NOT EXISTS app_configuration (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)');
  const selectConfiguration = db.prepare('SELECT value FROM app_configuration WHERE key = ?');
  const upsertConfiguration = db.prepare('INSERT INTO app_configuration (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at');
  const persistedSettings = (() => {
    try {
      const row = selectConfiguration.get('runtime_settings');
      const parsed = row ? JSON.parse(row.value) : null;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) { return {}; }
  })();

  const auditLog = new SqliteAuditLog(db);
  const idGenerator = new SqliteIdGenerator(db);
  const repositoryFactory = (type, repoOptions) => new SqliteRepository(db, type, repoOptions.idField);

  const runtime = createPhase1Runtime({
    clock: opts.clock,
    idGenerator,
    auditLog,
    repositoryFactory,
    config: Object.assign({ trustedActors: {} }, persistedSettings),
    onSettingsChanged: (settings) => {
      upsertConfiguration.run('runtime_settings', JSON.stringify({ quotationDefaults: settings.quotationDefaults, messageTemplates: settings.messageTemplates }), new Date().toISOString());
    }
  });

  const auth = new AuthStore(db, {
    clock: opts.clock,
    onAccountsChanged: (trustedActors) => { runtime.config.trustedActors = trustedActors; }
  });
  runtime.config.trustedActors = auth.trustedActors();

  // First boot: create the initial administrator. A generated temporary
  // password is written once to an owner-only file; an operator-supplied
  // password (WMIT_ADMIN_INITIAL_PASSWORD) is never copied to disk.
  const bootstrapped = auth.bootstrapAdmin({ password: config.initialAdminPassword });
  if (bootstrapped.bootstrapped) {
    if (config.initialAdminPassword) {
      console.log('WMIT: initial administrator "' + bootstrapped.username + '" created from WMIT_ADMIN_INITIAL_PASSWORD. No password file was written.');
    } else {
      const passwordFile = path.join(config.dataDir, 'initial-admin-password.txt');
      fs.writeFileSync(passwordFile, [
        'WMIT initial administrator',
        'Username: ' + bootstrapped.username,
        'Temporary password: ' + bootstrapped.temporary_password,
        '',
        'Sign in and change this password immediately, then delete this file.',
        'Generated: ' + new Date().toISOString()
      ].join('\n'), { encoding: 'utf8', mode: 0o600 });
      console.log('WMIT: initial administrator "' + bootstrapped.username + '" created. Temporary password written to ' + passwordFile);
    }
  }

  const phase1App = createPhase1Application({
    runtime,
    // Source adapters for supplier-document upload. The generic PDF tariff
    // adapter feeds the existing extraction → review pipeline; trust stays
    // human-gated through reviewTariff.
    sourceAdapters: { GENERIC_PDF_TARIFF: createPdfTariffUploadAdapter(), PASTE_TARIFF_TEXT: createPasteTariffUploadAdapter() },
    // Development and staging seed the synthetic workspace; production stays empty.
    seedSynthetic: config.env !== 'production'
  });

  const mailer = new Mailer({ smtp: config.smtp, outboxDir: config.outboxDir });
  const scheduler = new Scheduler({
    timezone: config.timezone,
    clock: opts.clock,
    onRun: (name, run) => recordJobRun(db, name, run)
  });
  registerJobs(scheduler, { db, config, mailer });

  // Expo tooling (September 4-6 expo): lead capture, follow-ups, package
  // templates, quote delivery, and the conversion funnel — on the same
  // SQLite-backed runtime, mailer, and scheduler as everything else.
  const expo = new ExpoService({ runtime, mailer, config, clock: opts.clock });
  try { expo.ensureDefaultExpo(); } catch (_) { /* registry seeding is best effort; the service falls back to the EXPO-2026 tag */ }
  try { expo.seedPlaceholderTemplates(); } catch (_) { /* seeding is best effort; the console reports template state */ }
  scheduler.register('expo-followups', { intervalMs: 15 * 60 * 1000 }, () => expo.ensureFollowUpTasks());

  if (config.schedulerEnabled && opts.schedulerEnabled !== false) scheduler.start();
  // Record an initial heartbeat so /api/health has data immediately.
  try { runHeartbeat(db); } catch (_) { /* heartbeat failures surface through the endpoint */ }

  const composed = createMvpServer({
    phase1App,
    auth,
    enforceSessions: config.enforceSessions,
    expo,
    health: () => ({
      env: config.env,
      scheduler: { running: scheduler.running, jobs: scheduler.jobNames() },
      heartbeat: require('./jobs').latestHeartbeat(db)
    }),
    app: opts.app
  });

  return { server: composed.server, app: composed.app, db, auth, scheduler, mailer, expo, config, phase1App, runtime, auditLog };
}

module.exports = { createHostedServer, loadConfig };
