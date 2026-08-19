'use strict';

// HTTP integration tests for the wave-2 wiring: the client-document PDF
// download endpoint, the document-ingestion routes, and the intern
// submit-only carve-out. Everything runs against the real composed server
// with SQLite persistence, sessions enforced, and role-based accounts.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase, ensureEntityTables, SqliteRepository, SqliteAuditLog, SqliteIdGenerator } = require('../../src/server/sqlite-store');
const { AuthStore } = require('../../src/server/auth');
const { createPhase1Runtime, ENTITY_DEFS, ACTIONS } = require('../../src/phase1/runtime');
const { createPhase1Application } = require('../../src/application/phase1');
const { DocumentsIngestionService } = require('../../src/documents/ingestion-service');
const { createMvpServer } = require('../../app/server');

const AUTH = {
  staff: [ACTIONS.EDIT_DRAFT_PRICING, ACTIONS.ACCEPT_QUOTATION],
  manager: [ACTIONS.APPROVE_QUOTATION, ACTIONS.VERIFY_PAYMENT]
};
const staff = () => ({ actor: 'staff', correlationId: 'DOCS-HTTP-TEST' });
const manager = () => ({ actor: 'manager', correlationId: 'DOCS-HTTP-TEST' });
const CLOCK = () => new Date('2026-08-19T09:00:00Z');

function seedBookingChain(runtime) {
  const client = runtime.createClient({ display_name: 'Maria Santos', legal_name: 'Maria Santos', primary_phone: '09179990002' }, staff()).data;
  const inquiry = runtime.createInquiry({ client_id: client.client_id, requirements: { destination: 'Seoul', travel_start: '2026-12-10', travel_end: '2026-12-16', nights: 6, adults: 2 } }, staff()).data;
  const quotation = runtime.createQuotation({ inquiry_id: inquiry.inquiry_id, client_id: client.client_id, quotation_date: '2026-08-17', valid_until: '2026-08-31', destination: 'Seoul', travel_start: '2026-12-10', travel_end: '2026-12-16', pax_count: 2, currency: 'PHP', supplier_cost_total: '60000.00', client_total: '78000.00', inclusions: 'Hotel, transfers', payment_terms: '50% deposit on confirmation' }, staff()).data;
  const supplier = runtime.createSupplier({ display_name: 'HTTP Test Supplier' }, staff()).data;
  runtime.createQuotationItem({ quotation_id: quotation.quotation_id, service_type: 'Hotel', description: 'Seoul hotel 5 nights', supplier_id: supplier.supplier_id, quantity: 2, unit_cost: '30000.00', unit_selling_price: '39000.00', currency: 'PHP', service_start: '2026-12-10', service_end: '2026-12-15' }, staff());
  runtime.updateQuotation({ quotation_id: quotation.quotation_id, exclusions: 'Airfare, personal expenses' }, staff());
  runtime.approveQuotation({ quotation_id: quotation.quotation_id }, manager());
  runtime.acceptQuotation({ quotation_id: quotation.quotation_id, accepted_by: 'Maria Santos' }, staff());
  const person = runtime.createPerson({ full_name: 'Maria Santos', role_notes: ['lead pax'] }, staff()).data;
  const booking = runtime.createBooking({ quotation_id: quotation.quotation_id, lead_pax_person_id: person.person_id }, staff()).data;
  runtime.createBookingPaymentObligations({ booking_id: booking.booking_id, obligations: [
    { purpose: 'DOWN_PAYMENT', amount: '39000.00', currency: 'PHP', sequence: 1, due_at: '2026-08-24T09:00:00.000Z' },
    { purpose: 'FINAL_BALANCE', amount: '39000.00', currency: 'PHP', sequence: 2, due_at: '2026-11-02T09:00:00.000Z' }
  ] }, staff());
  runtime.createBookingItemsFromAcceptedSnapshot({ booking_id: booking.booking_id }, staff());
  return { client, booking, quotation };
}

function buildFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmit-docs-http-'));
  const db = openDatabase(path.join(dir, 'docs-http.sqlite3'));
  ensureEntityTables(db, ENTITY_DEFS);
  const auditLog = new SqliteAuditLog(db);
  const runtime = createPhase1Runtime({
    clock: CLOCK,
    idGenerator: new SqliteIdGenerator(db),
    auditLog,
    repositoryFactory: (type, repoOptions) => new SqliteRepository(db, type, repoOptions.idField),
    config: { trustedActors: AUTH }
  });
  const seeded = seedBookingChain(runtime);
  const auth = new AuthStore(db, { clock: CLOCK, onAccountsChanged: (map) => { runtime.config.trustedActors = map; } });
  runtime.config.trustedActors = auth.trustedActors();
  auth.bootstrapAdmin({ password: 'admin-password-123' });
  auth.createAccount({ username: 'intern1', password: 'intern-password-1', role: 'INTERN', display_name: 'Intern One' }, 'TEST');
  auth.createAccount({ username: 'intern2', password: 'intern-password-2', role: 'INTERN', display_name: 'Intern Two' }, 'TEST');
  const phase1App = createPhase1Application({ runtime, seedSynthetic: false });
  const documents = new DocumentsIngestionService({ runtime, clock: CLOCK });
  const { server } = createMvpServer({ phase1App, auth, enforceSessions: true, documents, auditLog });
  return { dir, db, runtime, auditLog, documents, server, seeded };
}

async function withListening(server, run) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try { return await run(base); } finally { await new Promise((resolve) => server.close(resolve)); }
}

async function login(base, username, password) {
  const response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const body = await response.json();
  assert.equal(body.ok, true, 'login must succeed for ' + username);
  return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + body.data.session_token };
}

async function callJson(base, apiPath, headers, payload) {
  const response = await fetch(base + apiPath, { method: 'POST', headers, body: JSON.stringify(payload || {}) });
  return { status: response.status, body: await response.json() };
}

test('the PDF endpoint serves a real client PDF for a booking and audits the download', async () => {
  const fixture = buildFixture();
  await withListening(fixture.server, async (base) => {
    const admin = await login(base, 'admin', 'admin-password-123');

    const badKind = await callJson(base, '/api/documents/pdf', admin, { kind: 'mystery', booking_id: fixture.seeded.booking.booking_id });
    assert.equal(badKind.status, 400);
    assert.equal(badKind.body.error.code, 'DOCUMENT_KIND_INVALID');

    const unknown = await callJson(base, '/api/documents/pdf', admin, { kind: 'invoice', booking_id: 'BOOKING-2099-999999' });
    assert.equal(unknown.status, 400);

    const response = await fetch(base + '/api/documents/pdf', { method: 'POST', headers: admin, body: JSON.stringify({ kind: 'invoice', booking_id: fixture.seeded.booking.booking_id }) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'application/pdf');
    assert.match(response.headers.get('Content-Disposition') || '', /^attachment; filename="wmit-invoice-BOOKING-/);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.slice(0, 8).toString('latin1'), '%PDF-1.4');
    assert.ok(bytes.length > 1000, 'the rendered invoice PDF has real content');
    assert.ok(bytes.toString('latin1').endsWith('%%EOF\n'));

    const audited = fixture.auditLog.list(30).find((entry) => entry.action === 'PDF_DOCUMENT');
    assert.ok(audited, 'the PDF download wrote an audit row');
    assert.equal(audited.actor, 'USER:admin');
  });
  fixture.db.close();
});

test('the ingestion pipeline works end to end over HTTP with the confidence gate intact', async () => {
  const fixture = buildFixture();
  await withListening(fixture.server, async (base) => {
    const admin = await login(base, 'admin', 'admin-password-123');
    const quotationText = [
      'WORLD MASTER INTERNATIONAL TRAVEL',
      'Quotation',
      '',
      'Dear Maria Santos,',
      '',
      'Thank you for your inquiry. Here is your quotation for Seoul:',
      '',
      'Travel Dates: May 10 to May 14, 2027',
      'No. of Pax: 2',
      'Destination: Seoul',
      '',
      'Tour Fee / Pax / Package: PHP 32,900',
      '',
      'Inclusions:',
      'Round-trip economy airfare',
      '4 nights hotel with breakfast',
      '',
      'Exclusions:',
      'Visa fees',
      '',
      'Valid for 48 hours.',
      '',
      'World Master International Travel'
    ].join('\n');

    const registered = await callJson(base, '/api/documents/ingest/register', admin, { source: 'PASTE_TEXT', text: quotationText, filename: 'quotation-email.txt' });
    assert.equal(registered.status, 200, JSON.stringify(registered.body));
    assert.match(registered.body.data.document_id, /^DOCUMENT-2026-\d{6}$/);
    assert.equal(registered.body.data.status, 'RECEIVED');

    const duplicate = await callJson(base, '/api/documents/ingest/register', admin, { source: 'PASTE_TEXT', text: quotationText });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.data.document_id, registered.body.data.document_id);
    assert.equal(duplicate.body.meta.idempotent, true);

    const documentId = registered.body.data.document_id;
    const classified = await callJson(base, '/api/documents/ingest/classify', admin, { document_id: documentId });
    assert.equal(classified.status, 200);
    assert.equal(classified.body.data.status, 'CLASSIFIED');
    assert.equal(classified.body.data.classification.document_type, 'WMIT_QUOTATION');

    const extracted = await callJson(base, '/api/documents/ingest/extract', admin, { document_id: documentId });
    assert.equal(extracted.status, 200);
    assert.ok(extracted.body.data.extraction, 'extraction result is stored on the record');

    const queue = await (await fetch(base + '/api/documents/ingest/queue', { headers: admin })).json();
    assert.ok(queue.data.total >= 1);
    assert.ok(queue.data.queue.some((item) => item.document_id === documentId));

    const match = await (await fetch(base + '/api/documents/ingest/match?document_id=' + encodeURIComponent(documentId), { headers: admin })).json();
    assert.equal(match.ok, true);
    assert.equal(match.data.match.status, 'POSSIBLE_MATCH');
    assert.equal(match.data.match.suggestions[0].entityType, 'Client');
    assert.equal(match.data.match.suggestions[0].entityId, fixture.seeded.client.client_id);

    const review = await callJson(base, '/api/documents/ingest/review', admin, {
      document_id: documentId, decision: 'APPROVE', note: 'Client record confirmed',
      chosen_matches: [{ entity_type: 'Client', entity_id: fixture.seeded.client.client_id }]
    });
    assert.equal(review.status, 200, JSON.stringify(review.body));
    assert.equal(review.body.data.status, 'MATCHED');
    assert.equal(review.body.data.match_links.length, 1);

    const drained = await (await fetch(base + '/api/documents/ingest/queue', { headers: admin })).json();
    assert.equal(drained.data.total, 0, 'the matched document left the review queue');

    const pdfUpload = await callJson(base, '/api/documents/ingest/register', admin, { source: 'FILE_UPLOAD', filename: 'quote.pdf', mime: 'application/pdf' });
    assert.equal(pdfUpload.status, 400);
    assert.equal(pdfUpload.body.error.code, 'EXTRACTION_UNAVAILABLE');
    assert.ok(/paste/i.test(pdfUpload.body.error.message), 'the error tells staff to paste the text instead');
    assert.equal(fixture.runtime.list('Document', (record) => record.filename === 'quote.pdf').length, 0, 'no record was consumed by the failed upload');
  });
  fixture.db.close();
});

test('interns may submit only their own tasks over HTTP and nothing else', async () => {
  const fixture = buildFixture();
  await withListening(fixture.server, async (base) => {
    const admin = await login(base, 'admin', 'admin-password-123');
    const intern1 = await login(base, 'intern1', 'intern-password-1');
    const intern2 = await login(base, 'intern2', 'intern-password-2');

    const createIntern = async (name, username) => callJson(base, '/api/phase1/action', admin, {
      action: 'createIntern',
      input: { name, school: 'WMIT Test School', email: username + '@example.test', supervisor_username: 'admin', period_start: '2026-08-01', period_end: '2026-12-31', username }
    });
    const first = await createIntern('Intern One', 'intern1');
    assert.equal(first.status, 200, JSON.stringify(first.body));
    await createIntern('Intern Two', 'intern2');

    const assigned = await callJson(base, '/api/phase1/action', admin, {
      action: 'assignInternTask',
      input: { intern_id: first.body.data.intern_id, title: 'Encode expo leads', instructions: 'Enter the badge scan CSV into the console.' }
    });
    assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
    const taskId = assigned.body.data.intern_task_id;

    const forbidden = await callJson(base, '/api/phase1/action', intern1, { action: 'createClient', input: { display_name: 'Should Not Exist' } });
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.error.code, 'INTERN_WRITE_FORBIDDEN');

    const submitted = await callJson(base, '/api/phase1/action', intern1, { action: 'submitInternTask', input: { intern_task_id: taskId, submitted_note: 'Done, 40 leads entered.' } });
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
    assert.equal(submitted.body.data.state, 'SUBMITTED');

    const resubmitted = await callJson(base, '/api/phase1/action', intern1, { action: 'submitInternTask', input: { intern_task_id: taskId } });
    assert.equal(resubmitted.status, 200);
    assert.equal(resubmitted.body.meta.idempotent, true);

    const wrongOwner = await callJson(base, '/api/phase1/action', intern2, { action: 'submitInternTask', input: { intern_task_id: taskId } });
    assert.equal(wrongOwner.status, 400);
    assert.equal(wrongOwner.body.error.code, 'INTERN_TASK_NOT_OWNED');

    const reviewed = await callJson(base, '/api/phase1/action', admin, { action: 'reviewInternTask', input: { intern_task_id: taskId, decision: 'APPROVED', review_feedback: 'Nice work.' } });
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
    assert.equal(reviewed.body.data.state, 'APPROVED');

    const internCannotReview = await callJson(base, '/api/phase1/action', intern1, { action: 'reviewInternTask', input: { intern_task_id: taskId, decision: 'APPROVED' } });
    assert.equal(internCannotReview.status, 403, 'the carve-out admits only submitInternTask for intern sessions');
  });
  fixture.db.close();
});
