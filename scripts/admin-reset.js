'use strict';

// Reset a WMIT account password. Prints a generated one-time password to the
// console and nothing else — the password is never written to disk or logs.
//
// Usage: npm run admin:reset -- <username>
// Stop the server first if it is running (the running process keeps its own
// authority snapshot; restart after any account change).

const crypto = require('node:crypto');
const { loadConfig } = require('../src/server/config');
const { openDatabase } = require('../src/server/sqlite-store');
const { AuthStore } = require('../src/server/auth');

const username = process.argv[2];
if (!username) {
  console.error('Usage: npm run admin:reset -- <username>');
  process.exit(1);
}

const config = loadConfig({});
const db = openDatabase(config.dbPath);
const auth = new AuthStore(db);
const password = 'WMIT-' + crypto.randomBytes(8).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 14) + '!';

try {
  auth.resetPassword(String(username).trim().toLowerCase(), password, 'ADMIN_RESET_SCRIPT');
} catch (error) {
  console.error('Reset failed: ' + error.message);
  db.close();
  process.exit(1);
}
db.close();
console.log('Password reset for "' + username + '" on ' + config.dbPath);
console.log('New password: ' + password);
console.log('Give it to the staff member out-of-band, then have them change it on first sign-in.');
