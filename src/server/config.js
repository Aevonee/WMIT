'use strict';

// WMIT hosted-server configuration.
//
// Values come from environment variables, optionally pre-loaded from a .env
// file at the repository root (or WMIT_ENV_FILE). Environment variables always
// win over file entries. Secrets never live in source control: the .env file
// is gitignored and documented in docs/deployment-netcup.md.

const fs = require('node:fs');
const path = require('node:path');

function parseEnvFile(contents) {
  const values = {};
  String(contents || '').split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const equals = trimmed.indexOf('=');
    if (equals < 1) return;
    const key = trimmed.slice(0, equals).trim();
    let value = trimmed.slice(equals + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[key] = value;
  });
  return values;
}

function loadConfig(overrides) {
  const opts = overrides || {};
  const fileValues = {};
  const envFile = opts.envFile || process.env.WMIT_ENV_FILE || path.join(process.cwd(), '.env');
  try { Object.assign(fileValues, parseEnvFile(fs.readFileSync(envFile, 'utf8'))); } catch (_) { /* no .env file is normal */ }

  const read = (name, fallback) => {
    if (opts[name] !== undefined) return opts[name];
    if (process.env[name] !== undefined && process.env[name] !== '') return process.env[name];
    if (fileValues[name] !== undefined && fileValues[name] !== '') return fileValues[name];
    return fallback;
  };

  const env = String(read('WMIT_ENV', 'development')).toLowerCase();
  if (!['development', 'staging', 'production'].includes(env)) throw new Error('WMIT_ENV must be development, staging, or production.');
  const dataDir = path.resolve(read('WMIT_DATA_DIR', path.join(process.cwd(), 'data')));
  const port = Number(read('WMIT_PORT', 3000));
  const enforceSessions = String(read('WMIT_ENFORCE_SESSIONS', env === 'development' ? 'false' : 'true')).toLowerCase() === 'true';

  return {
    env,
    isProduction: env === 'production',
    isStaging: env === 'staging',
    port,
    host: read('WMIT_HOST', env === 'production' || env === 'staging' ? '0.0.0.0' : '127.0.0.1'),
    baseUrl: read('WMIT_BASE_URL', 'http://127.0.0.1:' + port),
    timezone: read('WMIT_TIMEZONE', 'Asia/Manila'),
    dataDir,
    dbPath: path.resolve(read('WMIT_DB_PATH', path.join(dataDir, 'wmit-' + env + '.sqlite3'))),
    enforceSessions,
    backupDir: path.resolve(read('WMIT_BACKUP_DIR', path.join(dataDir, 'backups'))),
    backupKeep: Number(read('WMIT_BACKUP_KEEP', 30)),
    outboxDir: path.resolve(read('WMIT_OUTBOX_DIR', path.join(dataDir, 'outbox'))),
    initialAdminPassword: read('WMIT_ADMIN_INITIAL_PASSWORD', ''),
    digestTo: read('WMIT_DIGEST_TO', ''),
    schedulerEnabled: String(read('WMIT_SCHEDULER', 'true')).toLowerCase() === 'true',
    smtp: {
      host: read('WMIT_SMTP_HOST', ''),
      port: Number(read('WMIT_SMTP_PORT', 587)),
      mode: String(read('WMIT_SMTP_MODE', 'starttls')).toLowerCase(), // starttls | tls | plain
      username: read('WMIT_SMTP_USER', ''),
      password: read('WMIT_SMTP_PASSWORD', ''),
      fromEmail: read('WMIT_SMTP_FROM', ''),
      fromName: read('WMIT_SMTP_FROM_NAME', 'WMIT Operations')
    },
    smtpConfigured() {
      const smtp = this.smtp;
      return Boolean(smtp.host && smtp.username && smtp.password && smtp.fromEmail);
    }
  };
}

module.exports = { loadConfig, parseEnvFile };
