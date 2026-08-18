'use strict';

// Normalize supplier country/industry values to canonical names.
//
// Dry-run (default): lists every planned change, writes nothing.
// Commit: asks for typed confirmation, then applies audited updates.
// Stop the server before committing, same discipline as restore.js.
//
// Usage:
//   node scripts/normalize-supplier-geo.js             # dry-run
//   node scripts/normalize-supplier-geo.js --commit    # write (asks)

const fs = require('node:fs');
const { loadConfig } = require('../src/server/config');
const { openDatabase, ensureEntityTables, SqliteRepository, SqliteAuditLog, SqliteIdGenerator } = require('../src/server/sqlite-store');
const { createPhase1Runtime, ENTITY_DEFS } = require('../src/phase1/runtime');
const { buildGeoPlan, applyGeoFixes } = require('../src/imports/supplier-geo');

const commit = process.argv.includes('--commit');
const config = loadConfig({});
const db = openDatabase(config.dbPath);
ensureEntityTables(db, ENTITY_DEFS);
const runtime = createPhase1Runtime({
  auditLog: new SqliteAuditLog(db),
  idGenerator: new SqliteIdGenerator(db),
  repositoryFactory: (type, repoOptions) => new SqliteRepository(db, type, repoOptions.idField)
});

const plan = buildGeoPlan(runtime.list('Supplier'));
console.log('Supplier geography normalization — ' + (commit ? 'COMMIT' : 'DRY RUN (nothing is written)'));
console.log('  Target database : ' + config.dbPath);
console.log('  Planned changes : ' + plan.length);
plan.slice(0, 40).forEach((entry) => {
  const parts = Object.keys(entry.changes).map((field) => field + ' → ' + entry.changes[field]);
  console.log('    ' + entry.display_name + ': ' + parts.join(', '));
});
if (plan.length > 40) console.log('    … and ' + (plan.length - 40) + ' more');

if (!commit) {
  db.close();
  console.log('Dry run complete. Re-run with --commit to apply.');
  process.exit(0);
}

if (!process.argv.includes('--yes')) {
  process.stdout.write('This will update ' + plan.length + ' supplier records in ' + config.dbPath + '.\nType NORMALIZE to proceed: ');
  const answer = fs.readFileSync(0, 'utf8').trim();
  if (answer !== 'NORMALIZE') {
    db.close();
    console.log('Aborted. Nothing was written.');
    process.exit(1);
  }
}

const report = applyGeoFixes(runtime, plan);
db.close();
console.log('Normalization finished.');
console.log('  Updated : ' + report.updated);
console.log('  Failures: ' + report.failures.length);
for (const failure of report.failures.slice(0, 10)) {
  console.log('    - ' + failure.supplier_id + ': ' + (failure.error && failure.error.message));
}
if (report.failures.length) process.exit(1);
