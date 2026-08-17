'use strict';

// Restore a backup into place. The current database is kept as a dated safety
// copy; nothing is deleted. Stop the server before restoring.
// Usage: npm run restore -- data/backups/wmit-2026-08-20T01-15-00.sqlite3

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../src/server/config');
const { openDatabase } = require('../src/server/sqlite-store');
const { rehearseBackup, entityCounts } = require('../src/server/jobs');

const config = loadConfig({});
const backupPath = process.argv[2];
if (!backupPath || !fs.existsSync(backupPath)) {
  console.error('Usage: npm run restore -- <path-to-backup-file>');
  process.exit(1);
}

// Verify the backup before touching anything.
let verification;
try {
  const source = openDatabase(backupPath);
  verification = rehearseBackup(backupPath, {});
  source.close();
} catch (error) {
  console.error('Backup verification FAILED: ' + error.message);
  console.error('Nothing was changed. The backup file is not restorable.');
  process.exit(1);
}

if (!fs.existsSync(config.dbPath)) {
  console.error('No current database at ' + config.dbPath + ' — copy the verified backup there manually.');
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const safetyCopy = config.dbPath + '.before-restore-' + stamp + '.sqlite3';
fs.copyFileSync(config.dbPath, safetyCopy);
fs.copyFileSync(backupPath, config.dbPath);
for (const suffix of ['-wal', '-shm']) {
  try { fs.rmSync(config.dbPath + suffix); } catch (_) { /* not present */ }
}
const restored = openDatabase(config.dbPath);
const counts = entityCounts(restored);
restored.close();
console.log('Restore complete.');
console.log('  Restored from : ' + backupPath);
console.log('  Safety copy   : ' + safetyCopy);
console.log('  Entity counts : ' + JSON.stringify(counts));
console.log('Restart the server and spot-check recent records before resuming work.');
