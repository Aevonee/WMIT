'use strict';

// Import a YUPPIES supplier snapshot into WMIT supplier records.
//
// Dry-run (default): reads the target database to classify new vs existing
// suppliers, writes nothing, and saves a full review file next to the snapshot.
// Commit: stops for a typed confirmation, then creates suppliers and contacts
// through the ordinary runtime business functions (audited, idempotent).
// Existing suppliers are never modified.
//
// Usage:
//   node scripts/import-suppliers.js <snapshot.json>            # dry-run
//   node scripts/import-suppliers.js <snapshot.json> --commit   # write (asks)
//   node scripts/import-suppliers.js <snapshot.json> --commit --yes
//
// Run --commit with the server stopped, same discipline as restore.js.

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../src/server/config');
const { openDatabase, ensureEntityTables, SqliteRepository, SqliteAuditLog, SqliteIdGenerator } = require('../src/server/sqlite-store');
const { createPhase1Runtime, ENTITY_DEFS } = require('../src/phase1/runtime');
const { buildImportPlan, runImport } = require('../src/imports/yuppies-suppliers');

const args = process.argv.slice(2);
const commit = args.includes('--commit');
const assumeYes = args.includes('--yes');
const snapshotPath = args.find((arg) => !arg.startsWith('--'));
if (!snapshotPath || !fs.existsSync(snapshotPath)) {
  console.error('Usage: node scripts/import-suppliers.js <snapshot.json> [--commit] [--yes]');
  process.exit(1);
}

const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
const plan = buildImportPlan(snapshot);

const config = loadConfig({});
const db = openDatabase(config.dbPath);
ensureEntityTables(db, ENTITY_DEFS);
const runtime = createPhase1Runtime({
  auditLog: new SqliteAuditLog(db),
  idGenerator: new SqliteIdGenerator(db),
  repositoryFactory: (type, repoOptions) => new SqliteRepository(db, type, repoOptions.idField)
});

const existingNames = new Set(runtime.list('Supplier').map((supplier) => String(supplier.display_name || '').trim().toLowerCase()));
const newCompanies = plan.companies.filter((company) => !existingNames.has(company.display_name.toLowerCase()));
const existingCompanies = plan.companies.filter((company) => existingNames.has(company.display_name.toLowerCase()));
const contactTotal = plan.companies.reduce((sum, company) => sum + company.contacts.length, 0);

const reviewFile = snapshotPath.replace(/\.json$/i, '') + '.review.json';
fs.writeFileSync(reviewFile, JSON.stringify({
  snapshot: snapshotPath, source: plan.source, source_url: plan.source_url, extracted_at: plan.extracted_at,
  dry_run_at: new Date().toISOString(), target_db: config.dbPath,
  summary: { source_rows: snapshot.rows.length, unique_companies: plan.companies.length, new_companies: newCompanies.length, already_in_wmit: existingCompanies.length, rejected_rows: plan.rejected.length, contacts_to_create: contactTotal },
  rejected_rows: plan.rejected,
  already_in_wmit: existingCompanies.map((company) => company.display_name),
  new_companies: newCompanies
}, null, 2), 'utf8');

console.log('YUPPIES supplier import — ' + (commit ? 'COMMIT' : 'DRY RUN (nothing is written)'));
console.log('  Snapshot        : ' + snapshotPath + ' (' + snapshot.rows.length + ' rows, extracted ' + (plan.extracted_at || 'unknown') + ')');
console.log('  Target database : ' + config.dbPath + ' (env ' + config.env + ')');
console.log('  Unique companies: ' + plan.companies.length + ' → ' + newCompanies.length + ' new, ' + existingCompanies.length + ' already in WMIT');
console.log('  Contacts        : ' + contactTotal + ' would be created');
console.log('  Rejected rows   : ' + plan.rejected.length + (plan.rejected.length ? ' (missing company name)' : ''));
console.log('  Full review     : ' + reviewFile);
console.log('  First new       : ' + newCompanies.slice(0, 5).map((company) => company.display_name).join(' | '));

if (!commit) {
  db.close();
  console.log('Dry run complete. Re-run with --commit to import.');
  process.exit(0);
}

if (!assumeYes) {
  process.stdout.write('This will create ' + newCompanies.length + ' suppliers and ' + contactTotal + ' contacts in ' + config.dbPath + '.\nType IMPORT to proceed: ');
  const answer = fs.readFileSync(0, 'utf8').trim();
  if (answer !== 'IMPORT') {
    db.close();
    console.log('Aborted. Nothing was written.');
    process.exit(1);
  }
}

const report = runImport(runtime, plan);
db.close();

console.log('Import finished.');
console.log('  Suppliers created: ' + report.created_suppliers);
console.log('  Contacts created  : ' + report.created_contacts);
console.log('  Already in WMIT   : ' + report.existing_suppliers);
console.log('  Failures          : ' + report.failures.length);
for (const failure of report.failures.slice(0, 10)) {
  console.log('    - [' + failure.stage + '] ' + failure.company + ': ' + (failure.error && failure.error.message));
}
if (report.failures.length) process.exit(1);
console.log('Restart the server and spot-check the Suppliers tab before resuming work.');
