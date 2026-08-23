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
  // Passenger (Plesk Node.js) passes its listen endpoint as PORT — a TCP port
  // number or a unix-socket path. WMIT_PORT wins; socket paths ignore host.
  const portValue = String(read('WMIT_PORT', process.env.PORT || 3000)).trim();
  const portNumeric = /^\d+$/.test(portValue) ? Number(portValue) : null;
  const port = portNumeric !== null ? portNumeric : portValue;
  const enforceSessions = String(read('WMIT_ENFORCE_SESSIONS', env === 'development' ? 'false' : 'true')).toLowerCase() === 'true';
  const baseUrl = read('WMIT_BASE_URL', 'http://127.0.0.1:' + (portNumeric !== null ? portNumeric : 3000));
  // A loopback base URL in production means emailed links (expo quotes,
  // client documents) point at the server machine itself — clients cannot
  // open them. Fail loudly at boot instead of silently sending dead links.
  if (env === 'production' && /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/.*)?$/.test(baseUrl)) {
    console.warn('WMIT: WMIT_BASE_URL is a loopback address (' + baseUrl + ') in production — emailed quote and document links will not work for clients. Set WMIT_BASE_URL to the public https URL.');
  }

  return {
    env,
    isProduction: env === 'production',
    isStaging: env === 'staging',
    port,
    host: read('WMIT_HOST', env === 'production' || env === 'staging' ? '0.0.0.0' : '127.0.0.1'),
    baseUrl: read('WMIT_BASE_URL', 'http://127.0.0.1:' + (portNumeric !== null ? portNumeric : 3000)),
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
    // Optional AI adapter for wholesaler-flyer extraction (never required;
    // package intake falls back to manual entry when unset).
    flyerAi: {
      provider: String(read('FLYER_AI_PROVIDER', 'none')).trim().toLowerCase(),
      apiKey: read('FLYER_AI_API_KEY', ''),
      model: read('FLYER_AI_MODEL', '')
    },
    // Optional AI adapter for client-message inquiry parsing (never required;
    // inquiry intake falls back to manual entry when unset).
    inquiryAi: {
      provider: String(read('INQUIRY_AI_PROVIDER', 'none')).trim().toLowerCase(),
      apiKey: read('INQUIRY_AI_API_KEY', ''),
      model: read('INQUIRY_AI_MODEL', '')
    },
    smtpConfigured() {
      const smtp = this.smtp;
      return Boolean(smtp.host && smtp.username && smtp.password && smtp.fromEmail);
    }
  };
}

module.exports = { loadConfig, parseEnvFile };
