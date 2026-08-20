'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPhase1Runtime, ACTIONS } = require('../../src/phase1/runtime');
const { createPhase1Application } = require('../../src/application/phase1');
const { createMvpServer } = require('../../app/server');
const { createHostedServer } = require('../../src/server/hosted');
const { buildPrivacyOverview, buildRetentionScan, RETENTION_GRACE_DAYS } = require('../../src/privacy/privacy');

const CLOCK = () => new Date('2026-08-20T09:00:00Z');
const TODAY = '2026-08-20';
// Travel ended 2026-07-10 -> eligible 2026-08-09 -> past the grace period.
const PAST_TRAVEL_END = '2026-07-10';

const AUTH = {
  staff: [ACTIONS.SELECT_OPTION],
  manager: [ACTIONS.DATA_ERASE]
};
const staff = () => ({ actor: 'staff', correlationId: 'PRIVACY-TEST' });
const manager = () => ({ actor: 'manager', correlationId: 'PRIVACY-TEST' });

function makeRuntime() {
  return createPhase1Runtime({ clock: CLOCK, config: { trustedActors: AUTH } });
}

// Client with a completed past trip: booking + payment + invoice (financial
// records that must survive erasure) and passport/visa/hotel documents.
function privacyFixture(runtime, overrides) {
  const options = overrides || {};
  const ctx = staff();
  const client = runtime.createClient({ display_name: options.clientName || 'Privacy Client' }, ctx).data;
  const booking = runtime.createRecord('Booking', {
    booking_id: options.bookingId || 'BOOKING-2026-000201',
    client_id: client.client_id,
    currency: 'PHP',
    client_total: options.clientTotal || '50000.00',
    travel_start: '2026-07-06',
    travel_end: options.travelEnd || PAST_TRAVEL_END
  }, ctx).data;
  runtime.createRecord('ClientPayment', { client_payment_id: options.paymentId || 'CLIENT_PAYMENT-2026-000201', booking_id: booking.booking_id, amount: '25000.00', currency: 'PHP', payment_state: 'VERIFIED' }, ctx);
  runtime.createRecord('ClientInvoice', { client_invoice_id: options.invoiceId || 'CLIENT_INVOICE-2026-000201', booking_id: booking.booking_id, amount: '50000.00', currency: 'PHP' }, ctx);
  const passport = runtime.createDocument({
    document_type: 'PASSPORT', client_id: client.client_id,
    text: 'PASSNO P1234567 SANTOS MARIA', file_name: 'maria-passport.pdf', file_url: 'file://maria-passport.pdf',
    status: 'ACCEPTED', review_status: 'ACCEPTED'
  }, ctx).data;
  const visa = runtime.createDocument({ document_type: 'VISA', client_id: client.client_id, text: 'KOREA VISA 999', status: 'ACCEPTED' }, ctx).data;
  const hotel = runtime.createDocument({ document_type: 'HOTEL_CONFIRMATION', client_id: client.client_id, text: 'hotel confirmation letter', status: 'ACCEPTED' }, ctx).data;
  return { client, booking, passport, visa, hotel };
}

test('buildPrivacyOverview inventories data, consent, and retention statuses per client', () => {
  const runtime = makeRuntime();
  const fixture = privacyFixture(runtime, {});
  const future = privacyFixture(runtime, { clientName: 'Future Client', bookingId: 'BOOKING-2026-000202', paymentId: 'CLIENT_PAYMENT-2026-000202', invoiceId: 'CLIENT_INVOICE-2026-000202', travelEnd: '2026-12-01' });
  runtime.recordClientDataConsent({ client_id: fixture.client.client_id, purpose: 'Quotation and booking servicing.' }, staff());

  const overview = buildPrivacyOverview(runtime, { clientId: fixture.client.client_id, asOf: TODAY });
  assert.equal(overview.scope, 'CLIENT');
  assert.equal(overview.asOf, TODAY);
  assert.equal(overview.consent.status, 'recorded');
  assert.equal(overview.consent.history_count, 1);
  assert.deepEqual(overview.data_inventory, {
    inquiries: 0, quotations: 0, bookings: 1, client_payments: 1, client_invoices: 1,
    documents: { total: 3, sensitive: 2, erased: 0 },
    expo_leads: { total: 0, consent: { granted: 0, legacy: 0 } }
  });
  const byType = Object.fromEntries(overview.documents.map((document) => [document.document_type, document.retention]));
  assert.equal(byType.PASSPORT, 'ELIGIBLE_FOR_ERASURE', 'departure 2026-07-10 + ' + RETENTION_GRACE_DAYS + ' days has passed');
  assert.equal(byType.VISA, 'ELIGIBLE_FOR_ERASURE');
  assert.equal(byType.HOTEL_CONFIRMATION, 'RETAINED', 'non-sensitive documents are never retention-eligible');
  assert.equal(overview.counts.eligible_documents, 2);
  assert.ok(overview.retention_hints.sensitive_documents.includes('departure + 30'));
  assert.ok(overview.retention_hints.bookings_and_financial.includes('10 years'));

  const futureOverview = buildPrivacyOverview(runtime, { clientId: future.client.client_id, asOf: TODAY });
  assert.equal(futureOverview.documents.find((document) => document.document_type === 'PASSPORT').retention, 'FUTURE');
  assert.equal(futureOverview.counts.eligible_documents, 0);

  // A client with no travel dates at all: honest RETAINED, never eligible.
  const noTravel = runtime.createClient({ display_name: 'No Travel Client' }, staff()).data;
  runtime.createDocument({ document_type: 'PASSPORT', client_id: noTravel.client_id, text: 'ORPHAN PASSPORT', status: 'ACCEPTED' }, staff());
  const noTravelOverview = buildPrivacyOverview(runtime, { clientId: noTravel.client_id, asOf: TODAY });
  assert.equal(noTravelOverview.documents[0].retention, 'RETAINED', 'no departure recorded: the clock never started');

  const allDb = buildPrivacyOverview(runtime, { asOf: TODAY });
  assert.equal(allDb.scope, 'ALL_CLIENTS');
  assert.equal(allDb.totals.clients, 3);
  assert.equal(allDb.totals.eligible_documents, 2);
  assert.equal(allDb.totals.clients_with_eligible_documents, 1);
});

test('buildRetentionScan lists only elapsed sensitive documents, ids and types only', () => {
  const runtime = makeRuntime();
  const fixture = privacyFixture(runtime, {});
  privacyFixture(runtime, { clientName: 'Future Client', bookingId: 'BOOKING-2026-000202', paymentId: 'CLIENT_PAYMENT-2026-000202', invoiceId: 'CLIENT_INVOICE-2026-000202', travelEnd: '2026-12-01' });
  const scan = buildRetentionScan(runtime, { asOf: TODAY });
  assert.equal(scan.eligible_count, 2);
  assert.deepEqual(scan.documents.map((document) => document.document_id).sort(), [fixture.passport.document_id, fixture.visa.document_id].sort());
  assert.ok(scan.documents.every((document) => document.client_id === fixture.client.client_id));
  assert.ok(scan.documents.every((document) => ['PASSPORT', 'VISA'].includes(document.document_type)));
  assert.ok(!JSON.stringify(scan).includes('P1234567'), 'the scan never carries content');
});

test('recordClientDataConsent appends an audited history entry on the Client', () => {
  const runtime = makeRuntime();
  const client = runtime.createClient({ display_name: 'Consent Client' }, staff()).data;
  const first = runtime.recordClientDataConsent({ client_id: client.client_id, purpose: 'Quotations and follow-up.' }, staff());
  assert.equal(first.ok, true);
  assert.equal(first.meta.action, 'RECORD_CLIENT_DATA_CONSENT');
  assert.equal(first.data.consent.actor, 'staff');
  assert.equal(first.data.history_count, 1);
  const second = runtime.recordClientDataConsent({ client_id: client.client_id, purpose: 'Visa processing for booked travel.' }, manager());
  assert.equal(second.data.history_count, 2, 'history is append-only');
  const stored = runtime.get('Client', client.client_id);
  assert.equal(stored.data_consent.purpose, 'Visa processing for booked travel.', 'latest entry is surfaced');
  assert.equal(stored.data_consent_history.length, 2);

  assert.equal(runtime.recordClientDataConsent({ client_id: 'CLIENT-2099-000001', purpose: 'X' }, staff()).error.code, 'NOT_FOUND');
  assert.equal(runtime.recordClientDataConsent({ client_id: client.client_id }, staff()).error.code, 'REQUIRED_FIELD');
  assert.ok(runtime.auditLog.list().some((entry) => entry.action === 'RECORD_CLIENT_DATA_CONSENT' && entry.result === 'SUCCESS'));
  assert.ok(runtime.auditLog.list().filter((entry) => entry.action === 'RECORD_CLIENT_DATA_CONSENT' && entry.result === 'FAILURE').length >= 2, 'each rejection audited');
});

test('eraseClientDocuments fails closed without manager authority or the exact ERASE confirmation', () => {
  const runtime = makeRuntime();
  const fixture = privacyFixture(runtime, {});

  const staffAttempt = runtime.eraseClientDocuments({ client_id: fixture.client.client_id, confirm: 'ERASE' }, staff());
  assert.equal(staffAttempt.ok, false);
  assert.equal(staffAttempt.error.code, 'AUTHORIZATION_REQUIRED', 'staff actor is rejected');

  const missing = runtime.eraseClientDocuments({ client_id: fixture.client.client_id }, manager());
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'ERASE_CONFIRMATION_REQUIRED');
  const lowercase = runtime.eraseClientDocuments({ client_id: fixture.client.client_id, confirm: 'erase' }, manager());
  assert.equal(lowercase.ok, false);
  assert.equal(lowercase.error.code, 'ERASE_CONFIRMATION_REQUIRED', 'exact match only');
  const boolean = runtime.eraseClientDocuments({ client_id: fixture.client.client_id, confirm: true }, manager());
  assert.equal(boolean.ok, false);
  assert.equal(boolean.error.code, 'ERASE_CONFIRMATION_REQUIRED', 'deleteSupplier-style boolean confirm is not enough here');

  const notFound = runtime.eraseClientDocuments({ client_id: 'CLIENT-2099-000001', confirm: 'ERASE' }, manager());
  assert.equal(notFound.ok, false);
  assert.equal(notFound.error.code, 'NOT_FOUND');

  const emptyList = runtime.eraseClientDocuments({ client_id: fixture.client.client_id, confirm: 'ERASE', document_ids: [] }, manager());
  assert.equal(emptyList.ok, false);
  assert.equal(emptyList.error.code, 'DOCUMENT_LIST_REQUIRED');

  const nonSensitive = runtime.eraseClientDocuments({ client_id: fixture.client.client_id, confirm: 'ERASE', document_ids: [fixture.hotel.document_id] }, manager());
  assert.equal(nonSensitive.ok, false);
  assert.equal(nonSensitive.error.code, 'DOCUMENT_NOT_SENSITIVE');

  const otherClientDoc = runtime.createDocument({ document_type: 'PASSPORT', client_id: runtime.createClient({ display_name: 'Other' }, staff()).data.client_id, text: 'OTHER', status: 'ACCEPTED' }, staff()).data;
  const crossClient = runtime.eraseClientDocuments({ client_id: fixture.client.client_id, confirm: 'ERASE', document_ids: [otherClientDoc.document_id] }, manager());
  assert.equal(crossClient.ok, false);
  assert.equal(crossClient.error.code, 'NOT_FOUND', 'documents of other clients are not this client\'s to erase');

  const future = privacyFixture(runtime, { clientName: 'Future Client', bookingId: 'BOOKING-2026-000202', paymentId: 'CLIENT_PAYMENT-2026-000202', invoiceId: 'CLIENT_INVOICE-2026-000202', travelEnd: '2026-12-01' });
  const notElapsed = runtime.eraseClientDocuments({ client_id: future.client.client_id, confirm: 'ERASE' }, manager());
  assert.equal(notElapsed.ok, false);
  assert.equal(notElapsed.error.code, 'NO_ELIGIBLE_DOCUMENTS', 'departure + 30 days has not passed');

  assert.equal(runtime.get('Document', fixture.passport.document_id).text, 'PASSNO P1234567 SANTOS MARIA', 'every rejected path left the documents untouched');
  const failures = runtime.auditLog.list().filter((entry) => entry.action === 'ERASE_CLIENT_DOCUMENTS' && entry.result === 'FAILURE');
  assert.equal(failures.length, 9, 'each fail-closed rejection audited');
});

test('eraseClientDocuments purges eligible documents, keeps the stub, and never audits content', () => {
  const runtime = makeRuntime();
  const fixture = privacyFixture(runtime, {});

  const result = runtime.eraseClientDocuments({ client_id: fixture.client.client_id, confirm: 'ERASE' }, manager());
  assert.equal(result.ok, true);
  assert.equal(result.meta.action, 'ERASE_CLIENT_DOCUMENTS');
  assert.equal(result.data.erased_count, 2);
  assert.deepEqual(result.data.erased.map((document) => document.document_type).sort(), ['PASSPORT', 'VISA']);

  const passport = runtime.get('Document', fixture.passport.document_id);
  assert.equal(passport.text, null, 'content purged');
  assert.equal(passport.file_name, null, 'file name purged');
  assert.equal(passport.file_url, null);
  assert.equal(passport.content_base64, null);
  assert.equal(passport.status, 'ERASED');
  assert.equal(passport.review_status, 'ERASED');
  assert.equal(passport.document_type, 'PASSPORT', 'type kept on the stub');
  assert.equal(passport.erased_by, 'manager');
  assert.equal(passport.erased_at, CLOCK().toISOString());
  assert.equal(passport.document_id, fixture.passport.document_id, 'document_id kept for the audit trail');

  assert.equal(runtime.get('Document', fixture.hotel.document_id).text, 'hotel confirmation letter', 'non-sensitive documents untouched');
  assert.equal(runtime.get('ClientPayment', 'CLIENT_PAYMENT-2026-000201').amount, '25000.00', 'financial records untouched');
  assert.equal(runtime.get('ClientInvoice', 'CLIENT_INVOICE-2026-000201').amount, '50000.00');
  assert.equal(runtime.get('Booking', fixture.booking.booking_id).client_total, '50000.00');

  const eraseAudits = runtime.auditLog.list().filter((entry) => ['ERASE_DOCUMENT', 'ERASE_CLIENT_DOCUMENTS'].includes(entry.action));
  assert.equal(eraseAudits.length, 3, 'one row per document plus the summary row');
  const summary = eraseAudits.find((entry) => entry.action === 'ERASE_CLIENT_DOCUMENTS');
  assert.deepEqual(summary.details.documents.map((document) => document.document_type).sort(), ['PASSPORT', 'VISA']);
  const auditText = JSON.stringify(runtime.auditLog.list());
  assert.ok(!auditText.includes('P1234567'), 'passport content never reaches the audit log');
  assert.ok(!auditText.includes('KOREA VISA 999'), 'visa content never reaches the audit log');

  const replay = runtime.eraseClientDocuments({ client_id: fixture.client.client_id, confirm: 'ERASE', document_ids: result.data.erased.map((document) => document.document_id) }, manager());
  assert.equal(replay.ok, true);
  assert.equal(replay.meta.idempotent, true);
  assert.equal(replay.data.erased.length, 0);
  assert.deepEqual(replay.data.skipped_already_erased, result.data.erased.map((document) => document.document_id));
});

test('privacy actions work over HTTP through the phase 1 action dispatcher', async () => {
  const runtime = makeRuntime();
  const fixture = privacyFixture(runtime, { clientName: 'HTTP Privacy Client', bookingId: 'BOOKING-2026-000301', paymentId: 'CLIENT_PAYMENT-2026-000301', invoiceId: 'CLIENT_INVOICE-2026-000301' });
  const phase1App = createPhase1Application({ runtime, seedSynthetic: false });
  const { server } = createMvpServer({ phase1App });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = async (body) => {
    const response = await fetch(base + '/api/phase1/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const consent = await post({ action: 'recordClientDataConsent', input: { client_id: fixture.client.client_id, purpose: 'Quotations and follow-up.' }, actor: 'staff' });
    assert.equal(consent.status, 200);
    assert.equal(consent.body.data.consent.actor, 'staff');

    const overview = await post({ action: 'getPrivacyOverview', input: { client_id: fixture.client.client_id }, actor: 'staff' });
    assert.equal(overview.status, 200);
    assert.equal(overview.body.meta.read_only, true);
    assert.equal(overview.body.data.scope, 'CLIENT');
    assert.equal(overview.body.data.counts.eligible_documents, 2);
    assert.equal(overview.body.data.consent.status, 'recorded');

    const wholeDb = await post({ action: 'getPrivacyOverview', input: {}, actor: 'staff' });
    assert.equal(wholeDb.body.data.scope, 'ALL_CLIENTS');
    assert.equal(wholeDb.body.data.totals.eligible_documents, 2);

    const staffErase = await post({ action: 'eraseClientDocuments', input: { client_id: fixture.client.client_id, confirm: 'ERASE' }, actor: 'staff' });
    assert.equal(staffErase.status, 400);
    assert.equal(staffErase.body.error.code, 'AUTHORIZATION_REQUIRED');

    const wrongConfirm = await post({ action: 'eraseClientDocuments', input: { client_id: fixture.client.client_id, confirm: 'DELETE' }, actor: 'manager' });
    assert.equal(wrongConfirm.status, 400);
    assert.equal(wrongConfirm.body.error.code, 'ERASE_CONFIRMATION_REQUIRED');

    const erased = await post({ action: 'eraseClientDocuments', input: { client_id: fixture.client.client_id, confirm: 'ERASE' }, actor: 'manager' });
    assert.equal(erased.status, 200);
    assert.equal(erased.body.data.erased_count, 2);
    assert.equal(runtime.get('Document', fixture.passport.document_id).text, null);
    assert.equal(runtime.get('ClientPayment', 'CLIENT_PAYMENT-2026-000301').amount, '25000.00', 'financial records untouched over HTTP too');

    const notEligible = await post({ action: 'eraseClientDocuments', input: { client_id: fixture.client.client_id, confirm: 'ERASE' }, actor: 'manager' });
    assert.equal(notEligible.status, 400);
    assert.equal(notEligible.body.error.code, 'NO_ELIGIBLE_DOCUMENTS', 'second pass fails closed: nothing eligible remains');

    const badOverview = await post({ action: 'getPrivacyOverview', input: { client_id: 'CLIENT-2099-000001' }, actor: 'staff' });
    assert.equal(badOverview.status, 400);
    assert.equal(badOverview.body.error.code, 'NOT_FOUND');

    const unknown = await post({ action: 'purgeEverything', input: {}, actor: 'manager' });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.error.code, 'UNKNOWN_ACTION', 'no undocumented privacy action exists');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('the hosted server registers privacy-retention; runOnce raises one deduped task and never erases', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmit-privacy-'));
  const hosted = createHostedServer({
    clock: CLOCK,
    WMIT_ENV: 'development',
    WMIT_DATA_DIR: dir,
    WMIT_DB_PATH: path.join(dir, 'wmit-development.sqlite3'),
    WMIT_BACKUP_DIR: path.join(dir, 'backups'),
    WMIT_OUTBOX_DIR: path.join(dir, 'outbox'),
    WMIT_SCHEDULER: 'false'
  });
  try {
    assert.ok(hosted.scheduler.jobNames().includes('privacy-retention'), 'the job registers next to departure-readiness');
    assert.equal(hosted.scheduler.running, false, 'scheduler stays stopped when disabled');

    const runtime = hosted.runtime;
    const ctx = { actor: 'LOCAL_STAFF' };
    const client = runtime.createClient({ display_name: 'Hosted Privacy Client' }, ctx).data;
    runtime.createRecord('Booking', { booking_id: 'BOOKING-2026-000401', client_id: client.client_id, currency: 'PHP', travel_end: PAST_TRAVEL_END }, ctx);
    const passport = runtime.createDocument({ document_type: 'PASSPORT', client_id: client.client_id, text: 'HOSTED PASSPORT DATA', status: 'ACCEPTED' }, ctx).data;
    runtime.createDocument({ document_type: 'VISA', client_id: client.client_id, text: 'HOSTED VISA DATA', status: 'ACCEPTED' }, ctx);

    const run = await hosted.scheduler.runOnce('privacy-retention');
    assert.equal(run.status, 'SUCCESS');
    assert.equal(run.detail.eligible_count, 2);
    assert.equal(run.detail.tasks_created, 1);

    const tasks = runtime.list('Task', (task) => task.task_type === 'PRIVACY_RETENTION');
    assert.equal(tasks.length, 1, 'exactly one task for the batch');
    const task = tasks[0];
    assert.equal(task.source, 'PRIVACY_RETENTION');
    assert.match(task.automation_key, /^PRIVACY_RETENTION:2026-08-20$/, 'dedupe key is per day');
    assert.deepEqual(task.document_ids.sort(), [passport.document_id, runtime.list('Document', (document) => document.document_type === 'VISA')[0].document_id].sort());
    assert.ok(task.description.includes(passport.document_id), 'the task lists the eligible document ids');
    assert.ok(!task.description.includes('HOSTED PASSPORT DATA'), 'never the content');

    const rerun = await hosted.scheduler.runOnce('privacy-retention');
    assert.equal(rerun.status, 'SUCCESS');
    assert.equal(rerun.detail.tasks_created, 0, 'second same-day run raises nothing');
    assert.equal(runtime.list('Task', (taskItem) => taskItem.task_type === 'PRIVACY_RETENTION').length, 1);

    assert.equal(runtime.get('Document', passport.document_id).text, 'HOSTED PASSPORT DATA', 'the job never erases anything itself');
    assert.ok(runtime.auditLog.list().some((entry) => entry.action === 'RUN_PRIVACY_RETENTION_CHECK' && entry.result === 'SUCCESS' && entry.details.tasks_created === 1), 'job run audited');

    const rows = hosted.db.prepare("SELECT status FROM system_job_runs WHERE name = 'privacy-retention'").all();
    assert.equal(rows.length, 2);
    assert.equal(rows.every((row) => row.status === 'SUCCESS'), true, 'both manual triggers recorded like every other job run');
  } finally {
    hosted.db.close();
  }
});

test('the operations workspace ships the privacy panel in the Documents tab', () => {
  const source = fs.readFileSync('app/public/operations.js', 'utf8');
  assert.match(source, /async function loadPrivacyOverview\(/);
  assert.match(source, /async function eraseEligibleClientDocuments\(/);
  assert.match(source, /bindClientPicker\('privacy-client-search', 'privacy-client'\)/);
  assert.match(source, /getPrivacyOverview/);
  assert.match(source, /eraseClientDocuments/);
  assert.match(source, /ELIGIBLE_FOR_ERASURE/);
  assert.match(source, /window\.prompt\('Type ERASE to confirm permanent document erasure:'\)/, 'erasure demands the typed ERASE confirmation');
  const form = fs.readFileSync('app/public/expo.html', 'utf8');
  assert.match(form, /travel quotations and follow up on this request/, 'the sign-up form states the recorded purpose');
});
