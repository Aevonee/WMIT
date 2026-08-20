'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createPhase1Runtime } = require('../../src/phase1/runtime');
const { createPhase1Application } = require('../../src/application/phase1');
const { createMvpServer } = require('../../app/server');

const START = '2026-08-20T09:00:00Z';
const TODAY = '2026-08-20';
const TRAVEL_START = '2026-12-06';
const TRAVEL_END = '2026-12-12';
const staff = () => ({ actor: 'staff', correlationId: 'CLIENT-STATUS-TEST' });

function makeRuntimeWithClock(startIso) {
  let current = new Date(startIso || START);
  const runtime = createPhase1Runtime({ clock: () => current, config: {} });
  return { runtime, advanceDays: (days) => { current = new Date(current.getTime() + days * 86400000); } };
}

// Booking with the full client-facing picture: obligations, one verified
// payment allocated to the first obligation, required documents (one ready,
// one pending), plus supplier and internal data that must never leak.
function statusFixture(runtime) {
  const ctx = staff();
  const client = runtime.createClient({ display_name: 'Status Client', primary_email: 'client@example.test' }, ctx).data;
  const booking = runtime.createRecord('Booking', {
    booking_id: 'BOOKING-2026-000501',
    client_id: client.client_id,
    destination: 'Osaka, Japan',
    travel_start: TRAVEL_START,
    travel_end: TRAVEL_END,
    pax_count: 2,
    currency: 'PHP',
    client_total: '120000.00',
    supplier_cost_total: '55500.00',
    notes: 'Internal: margin is thin, do not disclose.'
  }, ctx).data;
  const deposit = runtime.createRecord('ClientObligation', { booking_id: booking.booking_id, purpose: 'DOWN_PAYMENT', amount: '48000.00', currency: 'PHP', due_at: '2026-09-01' }, ctx).data;
  runtime.createRecord('ClientObligation', { booking_id: booking.booking_id, purpose: 'FINAL_BALANCE', amount: '72000.00', currency: 'PHP', due_at: '2026-11-06' }, ctx);
  const payment = runtime.createRecord('ClientPayment', { client_payment_id: 'CLIENT_PAYMENT-2026-000501', booking_id: booking.booking_id, amount: '48000.00', currency: 'PHP', payment_state: 'VERIFIED' }, ctx).data;
  runtime.createRecord('PaymentAllocation', { booking_id: booking.booking_id, client_payment_id: payment.client_payment_id, client_obligation_id: deposit.client_obligation_id, amount: '48000.00', state: 'ACTIVE' }, ctx);
  runtime.createRecord('Document', { document_type: 'PASSPORT', booking_id: booking.booking_id, file_name: 'maria-passport.pdf', text: 'PASSNO P1234567 SANTOS MARIA', required: true, status: 'ACCEPTED', review_status: 'ACCEPTED' }, ctx);
  runtime.createRecord('Document', { document_type: 'VISA', booking_id: booking.booking_id, file_name: 'maria-visa.pdf', text: 'KOREA VISA 999', required: true, status: 'RECEIVED', review_status: 'NEEDS_REVIEW' }, ctx);
  const supplier = runtime.createSupplier({ supplier_id: 'SUPPLIER-STATUS-000001', display_name: 'Secret DMC Partners', legal_name: 'Secret DMC Partners', capabilities: ['DMC'], country: 'Japan' }, ctx).data;
  runtime.createRecord('BookingItem', { booking_id: booking.booking_id, supplier_id: supplier.supplier_id, service_type: 'TOUR_PACKAGE', description: 'Osaka 6D5N package', supplier_cost: '55500.00', selling_price: '120000.00', currency: 'PHP' }, ctx);
  return { client, booking, deposit, payment, supplier };
}

test('issueBookingStatusLink issues a quote-style token with travel-based expiry and audits it', () => {
  const { runtime } = makeRuntimeWithClock();
  const fixture = statusFixture(runtime);

  const missing = runtime.issueBookingStatusLink({}, staff());
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'REQUIRED_FIELD');
  const unknown = runtime.issueBookingStatusLink({ booking_id: 'BOOKING-2099-999999' }, staff());
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, 'NOT_FOUND');

  const issued = runtime.issueBookingStatusLink({ booking_id: fixture.booking.booking_id }, staff());
  assert.equal(issued.ok, true);
  assert.equal(issued.meta.action, 'ISSUE_BOOKING_STATUS_LINK');
  assert.match(issued.data.token, /^[a-f0-9]{48}$/, 'same entropy and shape as quote-link tokens');
  assert.equal(issued.data.url, 'http://127.0.0.1:3000/status/' + issued.data.token);
  assert.equal(issued.data.issued_at, '2026-08-20T09:00:00.000Z');
  assert.equal(issued.data.expires_at, '2027-01-11', 'travel_end 2026-12-12 + 30 days');
  assert.equal(issued.data.reissued, false);

  const stored = runtime.get('Booking', fixture.booking.booking_id);
  assert.equal(stored.status_token_hash, crypto.createHash('sha256').update(issued.data.token, 'utf8').digest('hex'));
  assert.ok(!JSON.stringify(stored).includes(issued.data.token), 'the raw token is never stored');
  assert.ok(runtime.auditLog.list().some((entry) => entry.action === 'ISSUE_BOOKING_STATUS_LINK' && entry.result === 'SUCCESS' && entry.entity_id === fixture.booking.booking_id));
  assert.ok(runtime.auditLog.list().filter((entry) => entry.action === 'ISSUE_BOOKING_STATUS_LINK' && entry.result === 'FAILURE').length >= 2, 'rejections are audited too');
});

test('bookings without travel dates expire 90 days from issue; re-issue replaces the token', () => {
  const { runtime } = makeRuntimeWithClock();
  const ctx = staff();
  const undated = runtime.createRecord('Booking', { booking_id: 'BOOKING-2026-000502', client_id: runtime.createClient({ display_name: 'Undated Client' }, ctx).data.client_id, currency: 'PHP' }, ctx).data;
  const first = runtime.issueBookingStatusLink({ booking_id: undated.booking_id }, staff());
  assert.equal(first.data.expires_at, '2026-11-18', 'issue 2026-08-20 + 90 days');

  const second = runtime.issueBookingStatusLink({ booking_id: undated.booking_id }, staff());
  assert.equal(second.ok, true);
  assert.equal(second.data.reissued, true);
  assert.notEqual(first.data.token, second.data.token);
  assert.match(second.data.token, /^[a-f0-9]{48}$/);
  assert.equal(runtime.getPublicBookingStatus(first.data.token).error.code, 'BOOKING_STATUS_NOT_FOUND', 'the replaced token is dead');
  assert.equal(runtime.getPublicBookingStatus(second.data.token).ok, true);
});

test('issueBookingStatusLink honors a configured base URL like the expo quote links', () => {
  const runtime = createPhase1Runtime({ clock: () => new Date(START), config: { baseUrl: 'https://wmit.example.ph/' } });
  const fixture = statusFixture(runtime);
  const issued = runtime.issueBookingStatusLink({ booking_id: fixture.booking.booking_id }, staff());
  assert.equal(issued.data.url, 'https://wmit.example.ph/status/' + issued.data.token);
});

test('getPublicBookingStatus serves client-safe status that matches the statement of account', () => {
  const { runtime } = makeRuntimeWithClock();
  const fixture = statusFixture(runtime);
  const issued = runtime.issueBookingStatusLink({ booking_id: fixture.booking.booking_id }, staff());

  const result = runtime.getPublicBookingStatus(issued.data.token);
  assert.equal(result.ok, true);
  const data = result.data;
  assert.equal(data.booking_id, fixture.booking.booking_id);
  assert.equal(data.destination, 'Osaka, Japan');
  assert.equal(data.travel_start, TRAVEL_START);
  assert.equal(data.travel_end, TRAVEL_END);
  assert.equal(data.pax_count, 2);
  assert.deepEqual(data.documents, { required: 2, complete: 1, recorded: 2 });
  assert.deepEqual(data.milestones.next_payment_due, { due_on: '2026-11-06', amount: '72000.00' });
  assert.deepEqual(data.milestones.departure, { date: TRAVEL_START, days_until: 108 });
  assert.equal(data.payments.obligation_total, '120000.00');
  assert.equal(data.payments.verified_received, '48000.00');
  assert.equal(data.payments.outstanding, '72000.00');
  assert.deepEqual(data.payments.obligations.map((obligation) => [obligation.purpose, obligation.amount, obligation.outstanding, obligation.due_on]), [
    ['DOWN_PAYMENT', '48000.00', '0.00', '2026-09-01'],
    ['FINAL_BALANCE', '72000.00', '72000.00', '2026-11-06']
  ]);

  const invoice = runtime.getClientInvoicePreview(fixture.booking.booking_id);
  assert.deepEqual(
    { obligationTotal: invoice.data.totals.obligationTotal, verifiedReceived: invoice.data.totals.verifiedReceived, outstanding: invoice.data.totals.outstanding },
    { obligationTotal: data.payments.obligation_total, verifiedReceived: data.payments.verified_received, outstanding: data.payments.outstanding },
    'public amounts are the statement-of-account amounts'
  );

  const payload = JSON.stringify(data);
  ['Secret DMC Partners', 'SUPPLIER-STATUS', '55500', 'supplier_cost', 'current_supplier_cost', 'P1234567', 'KOREA VISA 999',
    'maria-passport', 'maria-visa', 'client@example.test', 'do not disclose', 'commission', 'created_by', 'updated_by', 'audit', 'internal'].forEach((forbidden) => {
    assert.ok(!payload.includes(forbidden), 'public payload must not carry ' + forbidden);
  });
});

test('unknown, malformed, expired, and cancelled links fail identically without enumeration', () => {
  const { runtime, advanceDays } = makeRuntimeWithClock();
  const fixture = statusFixture(runtime);
  const issued = runtime.issueBookingStatusLink({ booking_id: fixture.booking.booking_id }, staff());

  const unknown = runtime.getPublicBookingStatus('0'.repeat(48));
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, 'BOOKING_STATUS_NOT_FOUND');

  const malformed = runtime.getPublicBookingStatus('not-a-real-token');
  assert.equal(malformed.ok, false);
  assert.equal(malformed.error.code, 'TOKEN_INVALID');

  advanceDays(400); // past expires_at 2027-01-11
  const expired = runtime.getPublicBookingStatus(issued.data.token);
  assert.equal(expired.ok, false);
  assert.deepEqual(expired.error, unknown.error, 'expired and unknown tokens are indistinguishable');

  advanceDays(-400);
  runtime.updateRecord('Booking', fixture.booking.booking_id, { record_state: 'CANCELLED' }, staff());
  const cancelledRead = runtime.getPublicBookingStatus(issued.data.token);
  assert.equal(cancelledRead.ok, false);
  assert.deepEqual(cancelledRead.error, unknown.error, 'a cancelled booking revokes its link with the same answer');
  const cancelledIssue = runtime.issueBookingStatusLink({ booking_id: fixture.booking.booking_id }, staff());
  assert.equal(cancelledIssue.ok, false);
  assert.equal(cancelledIssue.error.code, 'BOOKING_CANCELLED');
  assert.ok(runtime.auditLog.list().some((entry) => entry.action === 'ISSUE_BOOKING_STATUS_LINK' && entry.result === 'FAILURE'));
});

test('client status links work over HTTP: staff issue, public read, page shell, 404s', async () => {
  const { runtime } = makeRuntimeWithClock();
  const fixture = statusFixture(runtime);
  const phase1App = createPhase1Application({ runtime, seedSynthetic: false });
  const { server } = createMvpServer({ phase1App });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = async (body) => {
    const response = await fetch(base + '/api/phase1/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const publicGet = async (path) => {
    const response = await fetch(base + path);
    return { status: response.status, contentType: response.headers.get('content-type') || '', body: await response.text() };
  };
  try {
    const issued = await post({ action: 'issueBookingStatusLink', input: { booking_id: fixture.booking.booking_id }, actor: 'staff' });
    assert.equal(issued.status, 200);
    const token = issued.body.data.token;
    assert.ok(issued.body.data.url.endsWith('/status/' + token));

    const read = await publicGet('/api/public/booking-status?token=' + token);
    assert.equal(read.status, 200);
    const payload = JSON.parse(read.body);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.booking_id, fixture.booking.booking_id);
    assert.ok(!read.body.includes('Secret DMC Partners'), 'the HTTP payload is client-safe too');

    const page = await publicGet('/status/' + token);
    assert.equal(page.status, 200);
    assert.ok(page.contentType.includes('text/html'));
    assert.ok(page.body.includes('Loading your booking status'), 'the standalone page shell renders like the quote page');

    const pageUnknown = await publicGet('/status/' + '0'.repeat(48));
    assert.equal(pageUnknown.status, 200, 'the page shell answers like /q/<unknown> — the page itself shows the error');
    assert.ok(pageUnknown.contentType.includes('text/html'));

    const unknown = await publicGet('/api/public/booking-status?token=' + '0'.repeat(48));
    assert.equal(unknown.status, 404);
    assert.equal(JSON.parse(unknown.body).error.code, 'BOOKING_STATUS_NOT_FOUND');
    const malformed = await publicGet('/api/public/booking-status?token=short');
    assert.equal(malformed.status, 404);
    assert.equal(JSON.parse(malformed.body).error.code, 'TOKEN_INVALID');

    const reissued = await post({ action: 'issueBookingStatusLink', input: { booking_id: fixture.booking.booking_id }, actor: 'staff' });
    assert.equal(reissued.status, 200);
    const replaced = await publicGet('/api/public/booking-status?token=' + token);
    assert.equal(replaced.status, 404);
    assert.deepEqual(JSON.parse(replaced.body).error, JSON.parse(unknown.body).error, 'replaced and unknown are indistinguishable over HTTP');

    const noAuth = await fetch(base + '/api/public/booking-status?token=' + reissued.body.data.token);
    assert.equal(noAuth.status, 200, 'the public read needs no session or token header');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
