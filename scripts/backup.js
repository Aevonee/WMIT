'use strict';

// On-demand backup: same routine the nightly job uses, runnable manually.
// Usage: npm run backup [-- --out DIR]

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../src/server/config');
const { openDatabase } = require('../src/server/sqlite-store');
const { createBackup, rehearseBackup, entityCounts, ensureSystemTables } = require('../src/server/jobs');

const config = loadConfig({});
const outDir = process.argv.includes('--out') ? path.resolve(process.argv[process.argv.indexOf('--out') + 1]) : config.backupDir;
if (!fs.existsSync(config.dbPath)) {
  console.error('No database found at ' + config.dbPath + '. Start the server once first.');
  process.exit(1);
}
const db = openDatabase(config.dbPath);
ensureSystemTables(db);
const backup = createBackup(db, Object.assign({}, config, { backupDir: outDir }));
const rehearsal = rehearseBackup(backup.file, entityCounts(db));
console.log('Backup written: ' + backup.file + ' (' + backup.size + ' bytes)');
console.log('Rehearsal: ' + (rehearsal.ok ? 'PASSED (' + JSON.stringify(rehearsal.counts) + ')' : 'FAILED'));
process.exit(rehearsal.ok ? 0 : 1);
