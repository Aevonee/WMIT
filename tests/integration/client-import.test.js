'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhase1Runtime, ACTIONS } = require('../../src/phase1/runtime');
const { createPhase1Application } = require('../../src/application/phase1');

const authority = {
  staff: [ACTIONS.ACCEPT_QUOTATION, ACTIONS.EDIT_DRAFT_PRICING],
  manager: [ACTIONS.APPROVE_QUOTATION]
};
const staff = () => ({ actor: 'staff', correlationId: 'CLIENT-IMPORT-TEST' });

function runtime() {
  return createPhase1Runtime({ clock: () => new Date('2026-08-23T10:00:00+08:00'), config: { trustedActors: authority } });
}

function clientAudit(runtimeInstance, clientId) {
  return runtimeInstance.auditLog.list().filter((event) => event.action === 'CREATE' && event.entity_type === 'Client' && event.entity_id === clientId);
}

test('previewClientImport reports valid multi-row CSV without writing anything', () => {
  const r = runtime();
  const before = r.auditLog.list().length;
  const result = r.previewClientImport({
    csv_text: 'display_name,email,mobile,landline,notes\nRow One,one@example.test,+63 917 111 1111,(02) 8111 1111,Expo lead\nRow Two,two@example.test,,,\n'
  }, staff());
  assert.equal(result.ok, true);
  assert.equal(result.meta.read_only, true);
  assert.deepEqual(result.data.summary, { total: 2, valid: 2, warnings: 0, errors: 0, duplicates_in_file: 0, duplicates_existing: 0 });
  assert.equal(result.data.rows[0].status, 'OK');
  assert.equal(result.data.rows[0].suggested_client.primary_email, 'one@example.test');
  assert.equal(result.data.rows[0].suggested_client.primary_phone, '+63 917 111 1111');
  assert.equal(result.data.rows[0].suggested_client.landline, '(02) 8111 1111');
  assert.equal(result.data.rows[1].suggested_client.primary_email, 'two@example.test');
  assert.equal(result.data.rows[1].suggested_client.primary_phone, undefined);
  assert.equal(r.list('Client').length, 0);
  assert.equal(r.auditLog.list().length, before);
});

test('client import accepts UTF-8 BOM, CRLF line endings, quoted commas, and escaped quotes', () => {
  const r = runtime();
  const csvText = '\ufeffdisplay_name,email,notes\r\n"Dela Cruz, Maria ""MJ""",maria@example.test,"said ""walk-in"" at expo"\r\n';
  const preview = r.previewClientImport({ csv_text: csvText }, staff());
  assert.equal(preview.ok, true);
  assert.equal(preview.data.summary.valid, 1);
  const suggested = preview.data.rows[0].suggested_client;
  assert.equal(suggested.display_name, 'Dela Cruz, Maria "MJ"');
  assert.equal(suggested.notes, 'said "walk-in" at expo');
  const commit = r.commitClientImport({ csv_text: csvText }, staff());
  assert.equal(commit.ok, true);
  assert.equal(commit.data.summary.created, 1);
  const created = r.list('Client')[0];
  assert.equal(created.display_name, 'Dela Cruz, Maria "MJ"');
});

test('client import rejects CSV without a usable header row', () => {
  const r = runtime();
  const result = r.previewClientImport({ csv_text: 'Juan Dela Cruz,juan@example.test\n' }, staff());
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'IMPORT_CSV_HEADER_INVALID');
});

test('rows missing display_name are reported as errors', () => {
  const r = runtime();
  const result = r.previewClientImport({ csv_text: 'display_name,email\n,noname@example.test\nNamed Person,ok@example.test\n' }, staff());
  assert.equal(result.ok, true);
  assert.equal(result.data.summary.total, 2);
  assert.equal(result.data.summary.errors, 1);
  assert.equal(result.data.rows[0].status, 'ERROR');
  assert.match(result.data.rows[0].reasons[0], /display_name is required/);
  assert.equal(result.data.rows[1].status, 'OK');
});

test('invalid emails and phone numbers are row errors', () => {
  const r = runtime();
  const result = r.previewClientImport({ csv_text: 'display_name,email,mobile\nBad Email Person,not-an-email,\nBad Mobile Person,,12345\nGood Person,good@example.test,+63 917 222 2222\n' }, staff());
  assert.equal(result.data.summary.errors, 2);
  assert.equal(result.data.summary.valid, 1);
  assert.match(result.data.rows[0].reasons[0], /not a valid email/);
  assert.match(result.data.rows[1].reasons[0], /not a valid phone number/);
});

test('duplicate emails and mobiles inside one file flag the later rows', () => {
  const r = runtime();
  const result = r.previewClientImport({ csv_text: 'display_name,email,mobile\nFirst Person,same@example.test,09171234567\nSecond Person,same@example.test,\nThird Person,,09171234567\nFourth Person,other@example.test,\n' }, staff());
  assert.equal(result.data.summary.duplicates_in_file, 2);
  assert.equal(result.data.summary.errors, 2);
  assert.equal(result.data.summary.valid, 2);
  assert.equal(result.data.rows[1].status, 'ERROR');
  assert.match(result.data.rows[1].reasons[0], /Duplicate email in file \(first seen on row 2\)/);
  assert.match(result.data.rows[2].reasons[0], /Duplicate mobile in file/);
  assert.equal(result.data.rows[3].status, 'OK');
});

test('rows matching an existing client by email, mobile, or name are flagged and never merged', () => {
  const r = runtime();
  r.createClient({ display_name: 'Existing Client', primary_email: 'existing@example.test' }, staff());
  r.createClient({ display_name: 'Phone Holder', primary_phone: '+63 917 333 3333' }, staff());
  const result = r.previewClientImport({ csv_text: 'display_name,email,mobile\nEmail Match,existing@example.test,\nMobile Match,,+63 917 333 3333\nExisting Client,,\nFresh Person,fresh@example.test,\n' }, staff());
  assert.equal(result.data.summary.duplicates_existing, 3);
  assert.equal(result.data.summary.valid, 1);
  assert.match(result.data.rows[0].reasons[0], /Email already belongs to client CLIENT-/);
  assert.match(result.data.rows[1].reasons[0], /Mobile already belongs to client CLIENT-/);
  assert.match(result.data.rows[2].reasons[0], /A client with this display_name already exists/);
  const commit = r.commitClientImport({ csv_text: 'display_name,email\nEmail Match,existing@example.test\nFresh Person,fresh@example.test\n' }, staff());
  assert.equal(commit.ok, true);
  assert.equal(commit.data.summary.created, 1);
  assert.equal(commit.data.summary.skipped, 1);
  assert.equal(commit.data.rows[0].status, 'SKIPPED');
  assert.equal(commit.data.rows[1].status, 'CREATED');
  assert.equal(r.list('Client').length, 3);
});

test('unknown columns produce warnings but stay importable', () => {
  const r = runtime();
  const result = r.previewClientImport({ csv_text: 'display_name,birthday,shoe_size\nWarned Person,1990-04-01,42\n' }, staff());
  assert.equal(result.ok, true);
  assert.equal(result.data.rows[0].status, 'WARNING');
  assert.equal(result.data.rows[0].reasons.length, 2);
  assert.match(result.data.rows[0].reasons.join(' '), /Unknown column "birthday" is ignored/);
  const commit = r.commitClientImport({ csv_text: 'display_name,birthday\nWarned Person,1990-04-01\n' }, staff());
  assert.equal(commit.data.summary.created, 1);
});

test('imports above the row and size limits are refused with named limits', () => {
  const r = runtime();
  let manyRows = 'display_name\n';
  for (let index = 0; index < 2001; index += 1) manyRows += 'Overflow Person ' + index + '\n';
  const rows = r.previewClientImport({ csv_text: manyRows }, staff());
  assert.equal(rows.ok, false);
  assert.equal(rows.error.code, 'IMPORT_CSV_TOO_MANY_ROWS');
  assert.equal(rows.error.details.limit_rows, 2000);
  const exact = r.previewClientImport({ csv_text: 'display_name\n' + Array.from({ length: 2000 }, (unused, index) => 'Boundary Person ' + index).join('\n') + '\n' }, staff());
  assert.equal(exact.ok, true);
  assert.equal(exact.data.summary.total, 2000);
  const tooLarge = r.previewClientImport({ csv_text: 'display_name\n' + 'A'.repeat(600 * 1024) }, staff());
  assert.equal(tooLarge.ok, false);
  assert.equal(tooLarge.code || tooLarge.error.code, 'IMPORT_CSV_TOO_LARGE');
  assert.equal(tooLarge.error.details.limit_bytes, 512 * 1024);
});

test('empty and header-only inputs answer with clean validation errors or an empty report', () => {
  const r = runtime();
  assert.equal(r.previewClientImport({}, staff()).error.code, 'REQUIRED_FIELD');
  assert.equal(r.previewClientImport({ csv_text: '' }, staff()).error.code, 'REQUIRED_FIELD');
  assert.equal(r.previewClientImport({ csv_text: '   \n\n' }, staff()).error.code, 'IMPORT_CSV_EMPTY');
  assert.equal(r.previewClientImport({ csv_text: '\ufeff' }, staff()).error.code, 'IMPORT_CSV_EMPTY');
  const headerOnly = r.previewClientImport({ csv_text: 'display_name,email,mobile,landline,notes\n' }, staff());
  assert.equal(headerOnly.ok, true);
  assert.deepEqual(headerOnly.data, { rows: [], summary: { total: 0, valid: 0, warnings: 0, errors: 0, duplicates_in_file: 0, duplicates_existing: 0 } });
  const headerOnlyCommit = r.commitClientImport({ csv_text: 'display_name\n' }, staff());
  assert.equal(headerOnlyCommit.ok, true);
  assert.equal(headerOnlyCommit.data.summary.created, 0);
});

test('malformed CSV quoting is a file-level parse error', () => {
  const r = runtime();
  const stray = r.previewClientImport({ csv_text: 'display_name\nbad " quoting here\n' }, staff());
  assert.equal(stray.ok, false);
  assert.equal(stray.error.code, 'IMPORT_CSV_PARSE_ERROR');
  const unterminated = r.commitClientImport({ csv_text: 'display_name,email\n"Open Quote,person@example.test\n' }, staff());
  assert.equal(unterminated.ok, false);
  assert.equal(unterminated.error.code, 'IMPORT_CSV_PARSE_ERROR');
  assert.equal(r.list('Client').length, 0);
});

test('commitClientImport creates clients with audit entries even without a prior preview', () => {
  const r = runtime();
  const csvText = 'display_name,email,mobile,landline,notes\nUnicode Ünïcode 台北人,u@example.test,+63 917 444 4444,(02) 8444 4444,üñïçøde notes\nPlain Person,p@example.test,,,\nBroken Person,,not-a-phone,\n';
  const result = r.commitClientImport({ csv_text: csvText }, staff());
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.summary, { created: 2, skipped: 1, reasons: { 'Mobile "not-a-phone" is not a valid phone number (only digits, +, spaces, dashes, and parentheses are allowed).': 1 } });
  const clients = r.list('Client');
  assert.equal(clients.length, 2);
  const unicode = clients.find((client) => client.primary_email === 'u@example.test');
  assert.equal(unicode.display_name, 'Unicode Ünïcode 台北人');
  assert.equal(unicode.legal_name, 'Unicode Ünïcode 台北人');
  assert.equal(unicode.primary_phone, '+63 917 444 4444');
  assert.equal(unicode.landline, '(02) 8444 4444');
  assert.equal(unicode.notes, 'üñïçøde notes');
  assert.equal(clientAudit(r, unicode.client_id).length, 1);
  assert.equal(clientAudit(r, unicode.client_id)[0].actor, 'staff');
  assert.equal(clientAudit(r, clients[0].client_id)[0].result, 'SUCCESS');
  const skipped = result.data.rows.find((row) => row.status === 'SKIPPED');
  assert.equal(skipped.row_number, 4);
});

test('preview then commit stays consistent: every previewed valid row is created exactly once', () => {
  const r = runtime();
  const csvText = 'display_name,email\nConsistent One,c1@example.test\nConsistent Two,c2@example.test\n';
  const preview = r.previewClientImport({ csv_text: csvText }, staff());
  assert.equal(preview.data.summary.valid, 2);
  const commit = r.commitClientImport({ csv_text: csvText }, staff());
  assert.equal(commit.data.summary.created, 2);
  const secondCommit = r.commitClientImport({ csv_text: csvText }, staff());
  assert.equal(secondCommit.data.summary.created, 0);
  assert.equal(secondCommit.data.summary.skipped, 2);
  assert.equal(r.list('Client').length, 2);
});

test('both import actions run through the whitelisted application dispatcher only', () => {
  const r = runtime();
  const app = createPhase1Application({ runtime: r, seedSynthetic: false });
  const preview = app.action({ action: 'previewClientImport', input: { csv_text: 'display_name,email\nDispatcher Person,d@example.test\n' }, actor: 'staff' });
  assert.equal(preview.ok, true);
  assert.equal(preview.data.summary.valid, 1);
  const commit = app.action({ action: 'commitClientImport', input: { csv_text: 'display_name,email\nDispatcher Person,d@example.test\n' }, actor: 'staff' });
  assert.equal(commit.ok, true);
  assert.equal(commit.data.summary.created, 1);
  const blocked = app.action({ action: 'analyzeClientImport', input: { csv_text: 'display_name\nNope\n' }, actor: 'staff' });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'UNKNOWN_ACTION');
});
