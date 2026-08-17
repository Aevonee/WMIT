'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase, ensureEntityTables, SqliteRepository, SqliteAuditLog, SqliteIdGenerator } = require('../../src/server/sqlite-store');
const { AuthStore } = require('../../src/server/auth');
const { createPhase1Runtime, ENTITY_DEFS, ACTIONS } = require('../../src/phase1/runtime');
const { createPhase1Application } = require('../../src/application/phase1');
const { createMvpServer } = require('../../app/server');

const AUTH = {
  staff: [ACTIONS.EDIT_DRAFT_PRICING, ACTIONS.ACCEPT_QUOTATION],
  manager: [ACTIONS.APPROVE_QUOTATION, ACTIONS.VERIFY_PAYMENT, ACTIONS.ALLOCATE_PAYMENT, ACTIONS.ISSUE_VOUCHER]
};
const staff = () => ({ actor: 'staff', correlationId: 'CLIENT-DOCS-TEST' });
const manager = () => ({ actor: 'manager', correlationId: 'CLIENT-DOCS-TEST' });

function buildChain(runtime) {
  const client = runtime.createClient({ display_name: 'Document Test Client', legal_name: 'Document Test Client', primary_phone: '09179990001' }, staff()).data;
  const inquiry = runtime.createInquiry({ client_id: client.client_id, requirements: { destination: 'Seoul', travel_start: '2026-12-10', travel_end: '2026-12-16', nights: 6, adults: 2 } }, staff()).data;
  const quotation = runtime.createQuotation({ inquiry_id: inquiry.inquiry_id, client_id: client.client_id, quotation_date: '2026-08-17', valid_until: '2026-08-31', destination: 'Seoul', travel_start: '2026-12-10', travel_end: '2026-12-16', pax_count: 2, currency: 'PHP', supplier_cost_total: '60000.00', client_total: '78000.00', inclusions: 'Hotel, transfers', payment_terms: '50% deposit on confirmation' }, staff()).data;
  const supplier = runtime.createSupplier({ display_name: 'Document Test Supplier' }, staff()).data;
  runtime.createQuotationItem({ quotation_id: quotation.quotation_id, service_type: 'Hotel', description: 'Seoul hotel 5 nights', supplier_id: supplier.supplier_id, quantity: 2, unit_cost: '30000.00', unit_selling_price: '39000.00', currency: 'PHP', service_start: '2026-12-10', service_end: '2026-12-15' }, staff());
  runtime.updateQuotation({ quotation_id: quotation.quotation_id, exclusions: 'Airfare, personal expenses', itinerary: JSON.stringify([
    { day: 1, date: '2026-12-10', city: 'Seoul', title: 'Arrival and transfer', activities: 'Airport pickup, hotel check-in.', meals: '- / - / Dinner', overnight: 'Seoul' },
    { day: 2, date: '2026-12-11', city: 'Seoul', title: 'City tour', activities: 'Palace visit and market walk.', meals: 'Breakfast / Lunch / Dinner', overnight: 'Seoul' }
  ]), flight_details: JSON.stringify([
    { segment_type: 'ONWARD', airline: 'Philippine Airlines', flight_number: 'PR 466', departure_airport: 'MNL', arrival_airport: 'ICN', departure_time: '09:20', arrival_time: '14:55', date: '2026-12-10' },
    { segment_type: 'RETURN', airline: 'Philippine Airlines', flight_number: 'PR 467', departure_airport: 'ICN', arrival_airport: 'MNL', departure_time: '16:10', arrival_time: '19:35', date: '2026-12-16' }
  ]) }, staff());
  runtime.approveQuotation({ quotation_id: quotation.quotation_id }, manager());
  runtime.acceptQuotation({ quotation_id: quotation.quotation_id, accepted_by: 'Document Test Client' }, staff());
  const person = runtime.createPerson({ full_name: 'Document Test Client', role_notes: ['lead pax'] }, staff()).data;
  const booking = runtime.createBooking({ quotation_id: quotation.quotation_id, lead_pax_person_id: person.person_id }, staff()).data;
  runtime.createBookingPaymentObligations({ booking_id: booking.booking_id, obligations: [
    { purpose: 'DOWN_PAYMENT', amount: '39000.00', currency: 'PHP', sequence: 1, due_at: '2026-08-24T09:00:00.000Z' },
    { purpose: 'FINAL_BALANCE', amount: '39000.00', currency: 'PHP', sequence: 2, due_at: '2026-11-02T09:00:00.000Z' }
  ] }, staff());
  const items = runtime.createBookingItemsFromAcceptedSnapshot({ booking_id: booking.booking_id }, staff());
  return { client, inquiry, quotation, supplier, booking, bookingItems: items.ok ? items.data.items : [] };
}

test('invoice preview renders obligations, payments, terms, and bank details from real records', () => {
  const runtime = createPhase1Runtime({ clock: () => new Date('2026-08-18T09:00:00Z'), config: { trustedActors: AUTH } });
  const chain = buildChain(runtime);

  const missing = runtime.getClientInvoicePreview({});
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'BOOKING_REQUIRED');
  const unknown = runtime.getClientInvoicePreview('BOOKING-2099-999999');
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, 'NOT_FOUND');

  const before = runtime.getClientInvoicePreview(chain.booking.booking_id);
  assert.equal(before.ok, true);
  assert.equal(before.data.invoice.booking_id, chain.booking.booking_id);
  assert.equal(before.data.invoice.client_name, 'Document Test Client');
  assert.equal(before.data.invoice.destination, 'Seoul');
  assert.equal(before.data.totals.obligationTotal, '78000.00');
  assert.equal(before.data.totals.verifiedReceived, '0.00');
  assert.equal(before.data.totals.outstanding, '78000.00');
  assert.equal(before.data.obligations.length, 2);
  assert.ok(before.data.obligations.every((obligation) => obligation.state === 'OUTSTANDING'));
  assert.ok(String(before.data.bankDetails).includes('Peso Account'));
  assert.ok(before.data.paymentTerms.includes('deposit'));

  const payment = runtime.recordClientPayment({ booking_id: chain.booking.booking_id, amount: '19500.00', currency: 'PHP', proof_reference: 'TEST-PROOF-1', actual_sent_at: '2026-08-18T08:00:00Z' }, staff()).data;
  runtime.verifyClientPayment({ client_payment_id: payment.payment.client_payment_id }, manager());
  const obligations = runtime.list('ClientObligation', (record) => record.booking_id === chain.booking.booking_id);
  const downPayment = obligations.find((obligation) => obligation.purpose === 'DOWN_PAYMENT');
  runtime.allocatePayment({ client_payment_id: payment.payment.client_payment_id, allocations: [{ booking_id: chain.booking.booking_id, client_obligation_id: downPayment.client_obligation_id, amount: '19500.00' }] }, manager());

  const after = runtime.getClientInvoicePreview(chain.booking.booking_id);
  assert.equal(after.ok, true);
  assert.equal(after.data.totals.verifiedReceived, '19500.00');
  assert.equal(after.data.totals.outstanding, '58500.00');
  const updatedDownPayment = after.data.obligations.find((obligation) => obligation.purpose === 'DOWN_PAYMENT');
  assert.equal(updatedDownPayment.state, 'PARTIALLY_SATISFIED');
  assert.equal(updatedDownPayment.outstanding, '19500.00');
});

test('itinerary preview renders days, flights, and issued vouchers', () => {
  const runtime = createPhase1Runtime({ clock: () => new Date('2026-08-18T09:00:00Z'), config: { trustedActors: AUTH } });
  const chain = buildChain(runtime);

  const missing = runtime.getClientItineraryPreview({});
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'QUOTATION_REQUIRED');

  assert.ok(chain.bookingItems.length >= 1, 'booking items were created from the accepted snapshot');
  runtime.issueVoucher({ booking_item_id: chain.bookingItems[0].booking_item_id, voucher_number: 'VCH-TEST-0001' }, manager());

  const preview = runtime.getClientItineraryPreview(chain.quotation.quotation_id);
  assert.equal(preview.ok, true);
  assert.equal(preview.data.itinerary.destination, 'Seoul');
  const days = preview.data.itinerary.itinerary_days || [];
  assert.equal(days.length, 2);
  assert.equal(days[0].title, 'Arrival and transfer');
  assert.equal(days[0].meals, '- / - / Dinner');
  assert.equal(preview.data.flights.length, 2);
  assert.equal(preview.data.flights[0].route, 'MNL – ICN');
  assert.equal(preview.data.flights[0].flight_number, 'PR 466');
  assert.equal(preview.data.vouchers.length, 1);
  assert.equal(preview.data.vouchers[0].voucher_number, 'VCH-TEST-0001');
  assert.ok(preview.data.vouchers[0].description.includes('Seoul hotel'));
  assert.equal(preview.data.booking.booking_id, chain.booking.booking_id);
});

test('document email route validates input and delivers through the mailer with an audit row', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmit-docemail-'));
  const db = openDatabase(path.join(dir, 'doc-email.sqlite3'));
  ensureEntityTables(db, ENTITY_DEFS);
  const auditLog = new SqliteAuditLog(db);
  const runtime = createPhase1Runtime({ clock: () => new Date('2026-08-18T09:00:00Z'), idGenerator: new SqliteIdGenerator(db), auditLog, repositoryFactory: (type, repoOptions) => new SqliteRepository(db, type, repoOptions.idField), config: { trustedActors: AUTH } });
  const phase1App = createPhase1Application({ runtime, seedSynthetic: false });
  const sends = [];
  const mailer = { configured: false, send: async (message) => { sends.push(message); return { sent: false, mode: 'eml_file', path: 'draft.eml' }; } };
  const auth = new AuthStore(db, { clock: () => new Date('2026-08-18T09:00:00Z') });
  auth.bootstrapAdmin({ password: 'admin-password-123' });
  const { server } = createMvpServer({ phase1App, auth, enforceSessions: true, mailer, auditLog });
  const chain = buildChain(runtime);

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const login = await (await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin-password-123' }) })).json();
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.data.session_token };

    const badEmail = await fetch(base + '/api/documents/email', { method: 'POST', headers, body: JSON.stringify({ kind: 'invoice', booking_id: chain.booking.booking_id, email: 'not-an-email' }) });
    assert.equal(badEmail.status, 400);
    assert.equal((await badEmail.json()).error.code, 'EMAIL_INVALID');

    const badKind = await fetch(base + '/api/documents/email', { method: 'POST', headers, body: JSON.stringify({ kind: 'mystery', booking_id: chain.booking.booking_id, email: 'client@example.test' }) });
    assert.equal(badKind.status, 400);
    assert.equal((await badKind.json()).error.code, 'DOCUMENT_KIND_INVALID');

    const invoiceMail = await (await fetch(base + '/api/documents/email', { method: 'POST', headers, body: JSON.stringify({ kind: 'invoice', booking_id: chain.booking.booking_id, email: 'client@example.test' }) })).json();
    assert.equal(invoiceMail.ok, true);
    assert.equal(invoiceMail.data.delivery.mode, 'eml_file');
    assert.equal(sends.length, 1);
    assert.ok(sends[0].subject.includes('Statement of Account'));
    assert.ok(sends[0].text.includes('78000.00'));
    assert.ok(sends[0].text.includes('Peso Account'));

    const itineraryMail = await (await fetch(base + '/api/documents/email', { method: 'POST', headers, body: JSON.stringify({ kind: 'itinerary', quotation_id: chain.quotation.quotation_id, email: 'client@example.test' }) })).json();
    assert.equal(itineraryMail.ok, true);
    assert.ok(sends[1].subject.includes('Itinerary'));
    assert.ok(sends[1].text.includes('Arrival and transfer'));

    const audited = auditLog.list(20).find((entry) => entry.action === 'EMAIL_DOCUMENT');
    assert.ok(audited, 'email delivery wrote an audit row');
    assert.equal(audited.actor, 'USER:admin');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
