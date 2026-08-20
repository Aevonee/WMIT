'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createPhase1Runtime, ACTIONS } = require('../../src/phase1/runtime');
const { createPhase1Application } = require('../../src/application/phase1');
const { createMvpServer } = require('../../app/server');
const { makeQuotationApprovable } = require('../helpers/quotation-contract');
const { buildAccountantExport, csvEscapeField, toCsv } = require('../../src/phase1/accountant-export');

const CLOCK = () => new Date('2026-08-20T09:00:00Z');

const AUTH = {
  staff: [ACTIONS.SELECT_OPTION, ACTIONS.RESERVE_SUPPLIER, ACTIONS.ALLOCATE_PAYMENT, ACTIONS.ACCEPT_QUOTATION, ACTIONS.EDIT_DRAFT_PRICING],
  manager: [ACTIONS.APPROVE_QUOTATION, ACTIONS.VERIFY_PAYMENT, ACTIONS.APPROVE_PAYABLE, ACTIONS.SUPPLIER_PAYMENT, ACTIONS.REFUND]
};
const staff = () => ({ actor: 'staff', correlationId: 'ACCOUNTANT-EXPORT-TEST' });
const manager = () => ({ actor: 'manager', correlationId: 'ACCOUNTANT-EXPORT-TEST' });

function makeRuntime() {
  return createPhase1Runtime({ clock: CLOCK, config: { trustedActors: AUTH } });
}

function bookingChain(runtime, overrides) {
  const options = overrides || {};
  const client = runtime.createClient({ display_name: options.clientName || 'Export Client', primary_email: 'export@example.test' }, staff()).data;
  const person = runtime.createPerson({ display_name: 'Lead Pax ' + client.display_name }, staff()).data;
  const quotation = runtime.createQuotation({ client_id: client.client_id, destination: options.destination || 'Cebu', supplier_cost_total: '41500.00', client_total: options.clientTotal || '50000.00', currency: 'PHP' }, staff()).data;
  assert.equal(makeQuotationApprovable(runtime, quotation, staff()).ok, true);
  assert.equal(runtime.approveQuotation({ quotation_id: quotation.quotation_id }, manager()).ok, true);
  assert.equal(runtime.acceptQuotation({ quotation_id: quotation.quotation_id, accepted_by: client.client_id }, staff()).ok, true);
  const booking = runtime.createBooking({ quotation_id: quotation.quotation_id, lead_pax_person_id: person.person_id }, staff()).data;
  return { client, person, quotation, booking };
}

function addObligation(runtime, bookingId, purpose, amount, dueAt, sequence) {
  const result = runtime.createBookingPaymentObligations({ booking_id: bookingId, obligations: [
    { purpose, amount, currency: 'PHP', sequence, due_at: dueAt }
  ] }, staff());
  assert.equal(result.ok, true);
  return result.data.obligations[0];
}

// Full finance fixture: obligations, one verified + allocated payment, one
// unverified payment, a supplier payable with a partial payment, and an
// executed refund. Names deliberately contain commas and quotes.
function financeFixture() {
  const runtime = makeRuntime();
  const chain = bookingChain(runtime, { clientName: 'Dela Cruz, Ana "JR" & Co.' });
  const obligation = addObligation(runtime, chain.booking.booking_id, 'FINAL_BALANCE', '20000.00', '2026-08-26T09:00:00.000Z', 1);
  const verified = runtime.recordClientPayment({ booking_id: chain.booking.booking_id, amount: '5000.00', currency: 'PHP', proof_reference: 'PROOF-VERIFIED', actual_sent_at: '2026-08-12T10:00:00.000Z' }, staff()).data;
  assert.equal(runtime.verifyClientPayment({ client_payment_id: verified.payment.client_payment_id }, manager()).ok, true);
  assert.equal(runtime.allocatePayment({ client_payment_id: verified.payment.client_payment_id, allocations: [
    { booking_id: chain.booking.booking_id, client_obligation_id: obligation.client_obligation_id, amount: '5000.00' }
  ], idempotency_key: 'EXPORT-ALLOC-1' }, staff()).ok, true);
  const unverified = runtime.recordClientPayment({ booking_id: chain.booking.booking_id, amount: '1500.00', currency: 'PHP', proof_reference: 'PROOF-UNVERIFIED', actual_sent_at: '2026-08-15T10:00:00.000Z' }, staff()).data;
  const outsidePeriod = runtime.recordClientPayment({ booking_id: chain.booking.booking_id, amount: '900.00', currency: 'PHP', proof_reference: 'PROOF-JULY', actual_sent_at: '2026-07-15T10:00:00.000Z' }, staff()).data;

  const supplier = runtime.createSupplier({ display_name: 'Cebu Sand "Resort", Inc.' }, staff()).data;
  const item = runtime.createBookingItem({ booking_id: chain.booking.booking_id, supplier_id: supplier.supplier_id, service_type: 'HOTEL', description: 'Cebu resort stay' }, staff()).data;
  const supplierBooking = runtime.createSupplierBooking({ supplier_id: supplier.supplier_id, booking_id: chain.booking.booking_id, booking_item_ids: [item.booking_item_id] }, staff()).data;
  const payable = runtime.createSupplierPayable({ supplier_booking_id: supplierBooking.supplier_booking_id, booking_id: chain.booking.booking_id, amount: '8000.00', currency: 'PHP' }, staff()).data;
  assert.equal(runtime.approveSupplierPayable({ supplier_payable_id: payable.supplier_payable_id }, manager()).ok, true);
  const supplierPayment = runtime.executeSupplierPayment({ supplier_payable_id: payable.supplier_payable_id, amount: '3000.00' }, manager()).data;

  const refundDraft = runtime.requestRefund({ booking_id: chain.booking.booking_id, client_id: chain.client.client_id, amount: '100.00', currency: 'PHP', reason: 'Price correction' }, staff()).data;
  const refund = runtime.executeRefund({ refund_adjustment_id: refundDraft.refund_adjustment_id, approval_confirmed: true }, manager()).data;

  return { runtime, chain, obligation, verified, unverified, outsidePeriod, supplier, payable, supplierPayment, refund };
}

test('CSV escaping quotes commas, quotes, and newlines with doubled quotes', () => {
  assert.equal(csvEscapeField('plain'), 'plain');
  assert.equal(csvEscapeField('has,comma'), '"has,comma"');
  assert.equal(csvEscapeField('say "hi"'), '"say ""hi"""');
  assert.equal(csvEscapeField('line1\nline2'), '"line1\nline2"');
  assert.equal(csvEscapeField(''), '');
  assert.equal(toCsv([['a', 'b'], ['x,y', 'z']]), 'a,b\r\n"x,y",z');
});

test('period validation fails closed with clear codes', () => {
  assert.throws(() => buildAccountantExport({ entities: {} }, { to: '2026-08-31' }), (error) => error.code === 'PERIOD_REQUIRED' && error.details.field === 'from');
  assert.throws(() => buildAccountantExport({ entities: {} }, { from: '2026-08-01' }), (error) => error.code === 'PERIOD_REQUIRED' && error.details.field === 'to');
  assert.throws(() => buildAccountantExport({ entities: {} }, { from: 'august', to: '2026-08-31' }), (error) => error.code === 'PERIOD_INVALID');
  assert.throws(() => buildAccountantExport({ entities: {} }, { from: '2026-08-32', to: '2026-08-31' }), (error) => error.code === 'PERIOD_INVALID');
  assert.throws(() => buildAccountantExport({ entities: {} }, { from: '2026-09-01', to: '2026-08-31' }), (error) => error.code === 'PERIOD_ORDER_INVALID');
});

test('cashbook lists verified and unverified client payments, supplier payments, and refunds with signed amounts', () => {
  const fixture = financeFixture();
  const exportResult = buildAccountantExport(fixture.runtime, { from: '2026-08-01', to: '2026-08-31' });
  assert.equal(exportResult.version, 'V1');
  assert.equal(exportResult.cashbook.count, 4, 'verified + unverified client payments, supplier payment, refund');

  const byType = {};
  exportResult.cashbook.rows.forEach((row) => { byType[row[1]] = row; });
  const verifiedRow = exportResult.cashbook.rows.find((row) => row[2] === fixture.verified.payment.client_payment_id);
  assert.equal(verifiedRow[0], '2026-08-12');
  assert.equal(verifiedRow[1], 'CLIENT_PAYMENT');
  assert.equal(verifiedRow[6], '5000.00');
  assert.equal(verifiedRow[7], 'VERIFIED');
  const unverifiedRow = exportResult.cashbook.rows.find((row) => row[2] === fixture.unverified.payment.client_payment_id);
  assert.equal(unverifiedRow[7], 'UNVERIFIED', 'unverified payments are clearly flagged');
  const supplierRow = byType.SUPPLIER_PAYMENT;
  assert.equal(supplierRow[5], 'PHP');
  assert.equal(supplierRow[6], '-3000.00', 'supplier payments are negative');
  assert.equal(supplierRow[4], 'Cebu Sand "Resort", Inc.', 'rows keep raw values; escaping happens in the CSV string');
  assert.ok(exportResult.cashbook.csv.includes('"Cebu Sand ""Resort"", Inc."'), 'escaped supplier name in the CSV');
  assert.ok(supplierRow[2].includes(fixture.supplierPayment.supplier_payment_id));
  const refundRow = byType.REFUND;
  assert.equal(refundRow[6], '-100.00', 'refunds are negative');
  assert.equal(refundRow[7], 'EXECUTED');

  const clientRow = exportResult.cashbook.rows.find((row) => row[2] === fixture.verified.payment.client_payment_id);
  assert.equal(clientRow[4], 'Dela Cruz, Ana "JR" & Co.');
  assert.ok(exportResult.cashbook.csv.includes('"Dela Cruz, Ana ""JR"" & Co."'), 'escaped client name in the CSV');
  assert.ok(exportResult.cashbook.rows.every((row) => row[2] !== fixture.outsidePeriod.payment.client_payment_id), 'July payment is outside the August period');

  const july = buildAccountantExport(fixture.runtime, { from: '2026-07-01', to: '2026-07-31' });
  assert.equal(july.cashbook.count, 1);
  assert.equal(july.cashbook.rows[0][2], fixture.outsidePeriod.payment.client_payment_id);
  assert.equal(july.receivables.count, 0, 'no obligations existed yet in July, so no receivable rows');
});

test('cashbook CSV structure: header, CRLF line endings, BOM prefix', () => {
  const fixture = financeFixture();
  const exportResult = buildAccountantExport(fixture.runtime, { from: '2026-08-01', to: '2026-08-31' });
  const lines = exportResult.cashbook.csv.split('\r\n');
  assert.equal(lines.length, exportResult.cashbook.count + 1);
  assert.equal(lines[0], 'date,type,reference_ids,booking_id,counterparty,currency,amount,status');
  assert.ok(exportResult.cashbook.bom.startsWith('\ufeff'));
  assert.equal(exportResult.cashbook.bom.slice(1), exportResult.cashbook.csv);
  assert.equal(exportResult.cashbook.csv.split('\r\n').join('').indexOf('\n'), -1, 'no bare LF line endings');
});

test('receivables mirror the obligation and verified-allocation math as of period end', () => {
  const fixture = financeFixture();
  const exportResult = buildAccountantExport(fixture.runtime, { from: '2026-08-01', to: '2026-08-31' });
  assert.equal(exportResult.receivables.count, 1);
  const row = exportResult.receivables.rows[0];
  assert.equal(row[0], fixture.chain.booking.booking_id);
  assert.equal(row[4], 'PHP');
  assert.equal(row[5], '20000.00', 'obligations total');
  assert.equal(row[6], '5000.00', 'verified received');
  assert.equal(row[7], '5000.00', 'verified allocated');
  assert.equal(row[8], '15000.00', 'outstanding ignores the unverified payment');
  assert.equal(exportResult.summary.receivables.outstanding_by_currency.PHP, '15000.00');
});

test('receivables fall back to PaymentScheduleItem when no ClientObligation exists', () => {
  const runtime = makeRuntime();
  const chain = bookingChain(runtime, {});
  assert.equal(runtime.createPaymentScheduleItem({ booking_id: chain.booking.booking_id, amount: '7000.00', currency: 'PHP', due_at: '2026-08-25T09:00:00.000Z', purpose: 'FULL_PAYMENT', sequence: 1 }, staff()).ok, true);
  const payment = runtime.recordClientPayment({ booking_id: chain.booking.booking_id, amount: '2500.00', currency: 'PHP', proof_reference: 'PROOF-FALLBACK' }, staff()).data;
  assert.equal(runtime.verifyClientPayment({ client_payment_id: payment.payment.client_payment_id }, manager()).ok, true);
  assert.equal(runtime.allocatePayment({ client_payment_id: payment.payment.client_payment_id, allocations: [
    { booking_id: chain.booking.booking_id, amount: '2500.00' }
  ], idempotency_key: 'EXPORT-FALLBACK-ALLOC' }, staff()).ok, true);
  const exportResult = buildAccountantExport(runtime, { from: '2026-08-01', to: '2026-08-31' });
  const row = exportResult.receivables.rows[0];
  assert.equal(row[5], '7000.00');
  assert.equal(row[7], '2500.00');
  assert.equal(row[8], '4500.00');
});

test('payables show amount, paid, and outstanding per Supplier Payable as of period end', () => {
  const fixture = financeFixture();
  const exportResult = buildAccountantExport(fixture.runtime, { from: '2026-08-01', to: '2026-08-31' });
  assert.equal(exportResult.payables.count, 1);
  const row = exportResult.payables.rows[0];
  assert.equal(row[0], fixture.payable.supplier_payable_id);
  assert.equal(row[1], 'Cebu Sand "Resort", Inc.');
  assert.ok(exportResult.payables.csv.includes('"Cebu Sand ""Resort"", Inc."'), 'escaped supplier name in the payables CSV');
  assert.equal(row[2], fixture.chain.booking.booking_id);
  assert.equal(row[4], '8000.00');
  assert.equal(row[5], '3000.00');
  assert.equal(row[6], '5000.00');
  assert.equal(row[7], 'APPROVED');
  assert.equal(exportResult.summary.payables.outstanding_by_currency.PHP, '5000.00');
  assert.equal(exportResult.summary.cashbook.movements.paid_to_suppliers.PHP, '-3000.00');
  assert.equal(exportResult.summary.cashbook.movements.refunded_to_clients.PHP, '-100.00');
  assert.equal(exportResult.summary.cashbook.movements.verified_received.PHP, '5000.00');
  assert.equal(exportResult.summary.cashbook.movements.unverified_received.PHP, '1500.00');
});

test('empty periods export header-only documents without erroring', () => {
  const runtime = makeRuntime();
  const exportResult = buildAccountantExport(runtime, { from: '2026-01-01', to: '2026-01-31' });
  assert.equal(exportResult.cashbook.count, 0);
  assert.equal(exportResult.receivables.count, 0);
  assert.equal(exportResult.payables.count, 0);
  assert.equal(exportResult.cashbook.csv, 'date,type,reference_ids,booking_id,counterparty,currency,amount,status');
  assert.deepEqual(exportResult.summary.cashbook.by_type, { CLIENT_PAYMENT: 0, SUPPLIER_PAYMENT: 0, REFUND: 0 });
});

test('getAccountantExport is read-only, audited, and fails closed through the runtime', () => {
  const fixture = financeFixture();
  const entitiesBefore = Object.keys(fixture.runtime.repos).reduce((sum, type) => sum + fixture.runtime.repos[type].list().length, 0);
  const result = fixture.runtime.getAccountantExport({ from: '2026-08-01', to: '2026-08-31' }, staff());
  assert.equal(result.ok, true);
  assert.equal(result.meta.read_only, true);
  assert.equal(result.data.from, '2026-08-01');
  assert.equal(result.data.to, '2026-08-31');
  assert.equal(result.data.generatedAt, CLOCK().toISOString());
  assert.equal(result.data.cashbook.count, 4);
  const entitiesAfter = Object.keys(fixture.runtime.repos).reduce((sum, type) => sum + fixture.runtime.repos[type].list().length, 0);
  assert.equal(entitiesAfter, entitiesBefore, 'export creates no records');

  const missing = fixture.runtime.getAccountantExport({ to: '2026-08-31' }, staff());
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'PERIOD_REQUIRED');
  const invalid = fixture.runtime.getAccountantExport({ from: '2026-09-01', to: '2026-08-31' }, staff());
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'PERIOD_ORDER_INVALID');
  const audits = fixture.runtime.auditLog.list().filter((entry) => entry.action === 'GET_ACCOUNTANT_EXPORT');
  assert.equal(audits.filter((entry) => entry.result === 'SUCCESS').length, 1);
  assert.equal(audits.filter((entry) => entry.result === 'FAILURE').length, 2, 'each rejected call audited a failure row');
});

test('accountant export works over HTTP with attachment headers, BOM, and CRLF', async () => {
  const fixture = financeFixture();
  const phase1App = createPhase1Application({ runtime: fixture.runtime, seedSynthetic: false });
  const { server } = createMvpServer({ phase1App });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const response = await fetch(base + '/api/accounting/export.csv?type=cashbook&from=2026-08-01&to=2026-08-31');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/csv; charset=utf-8');
    const disposition = response.headers.get('content-disposition');
    assert.ok(disposition.startsWith('attachment; filename="wmit-cashbook-2026-08-01-to-2026-08-31.csv"'), disposition);
    // fetch().text() strips a leading UTF-8 BOM, so assert the raw bytes.
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(bytes[0], 0xEF);
    assert.equal(bytes[1], 0xBB);
    assert.equal(bytes[2], 0xBF, 'body starts with the UTF-8 BOM');
    const text = new TextDecoder('utf-8').decode(bytes.subarray(3));
    assert.ok(text.includes('\r\n'), 'CRLF line endings');
    assert.ok(text.includes('"Dela Cruz, Ana ""JR"" & Co."'), 'escaped client name survives the round trip');
    assert.ok(text.includes('-3000.00'), 'negative supplier payment survives the round trip');

    const receivables = await fetch(base + '/api/accounting/export.csv?type=receivables&from=2026-08-01&to=2026-08-31');
    assert.equal(receivables.status, 200);
    assert.ok(receivables.headers.get('content-disposition').includes('wmit-receivables-'));
    assert.ok((await receivables.text()).includes('15000.00'));

    const payables = await fetch(base + '/api/accounting/export.csv?type=payables&from=2026-08-01&to=2026-08-31');
    assert.equal(payables.status, 200);
    assert.ok(payables.headers.get('content-disposition').includes('wmit-payables-'));

    const badType = await fetch(base + '/api/accounting/export.csv?type=secret-book&from=2026-08-01&to=2026-08-31');
    assert.equal(badType.status, 400);
    assert.equal((await badType.json()).error.code, 'EXPORT_TYPE_INVALID');

    const badPeriod = await fetch(base + '/api/accounting/export.csv?type=cashbook&from=2026-09-01&to=2026-08-31');
    assert.equal(badPeriod.status, 400);
    assert.equal((await badPeriod.json()).error.code, 'PERIOD_ORDER_INVALID');

    const missingPeriod = await fetch(base + '/api/accounting/export.csv?type=cashbook&to=2026-08-31');
    assert.equal(missingPeriod.status, 400);
    assert.equal((await missingPeriod.json()).error.code, 'PERIOD_REQUIRED');

    const action = await fetch(base + '/api/phase1/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'getAccountantExport', input: { from: '2026-08-01', to: '2026-08-31' }, actor: 'staff' }) });
    const actionBody = await action.json();
    assert.equal(action.status, 200);
    assert.equal(actionBody.ok, true);
    assert.equal(actionBody.data.cashbook.count, 4);
    assert.equal(actionBody.data.receivables.count, 1);
    assert.equal(actionBody.data.payables.count, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('operations workspace ships the accountant export and commission panels', () => {
  const source = fs.readFileSync('app/public/operations.js', 'utf8');
  assert.match(source, /function accountantExportPanel\(/);
  assert.match(source, /function downloadAccountantCsv\(/);
  assert.match(source, /function previewAccountantExport\(/);
  assert.match(source, /\/api\/accounting\/export\.csv\?type=/);
  assert.match(source, /function commissionsPanel\(/);
  assert.match(source, /function recordCommissionAction\(/);
  assert.match(source, /function approveCommissionAction\(/);
  assert.match(source, /function markCommissionPaidAction\(/);
});
