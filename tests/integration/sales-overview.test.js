'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhase1Runtime, ACTIONS } = require('../../src/phase1/runtime');
const { createPhase1Application } = require('../../src/application/phase1');
const { createMvpServer } = require('../../app/server');
const { makeQuotationApprovable } = require('../helpers/quotation-contract');

const CLOCK = () => new Date('2026-08-20T09:00:00Z');
const TODAY = '2026-08-20';

const AUTH = {
  staff: [ACTIONS.ACCEPT_QUOTATION, ACTIONS.ALLOCATE_PAYMENT, ACTIONS.EDIT_DRAFT_PRICING, ACTIONS.RESERVE_SUPPLIER],
  manager: [ACTIONS.APPROVE_QUOTATION, ACTIONS.VERIFY_PAYMENT, ACTIONS.APPROVE_PAYABLE, ACTIONS.SUPPLIER_PAYMENT, ACTIONS.COMMISSION_APPROVE, ACTIONS.COMMISSION_PAY, ACTIONS.REFUND]
};
const staff = () => ({ actor: 'staff', correlationId: 'SALES-OVERVIEW-TEST' });
const manager = () => ({ actor: 'manager', correlationId: 'SALES-OVERVIEW-TEST' });

function makeRuntime() {
  return createPhase1Runtime({ clock: CLOCK, config: { trustedActors: AUTH } });
}

function quotedBooking(runtime, options) {
  const opts = options || {};
  const client = runtime.createClient({ display_name: opts.clientName || 'Sales Client', primary_email: opts.email || 'sales@example.test' }, staff()).data;
  const person = runtime.createPerson({ display_name: 'Lead Pax ' + client.display_name }, staff()).data;
  const quotationInput = Object.assign({
    client_id: client.client_id,
    destination: opts.destination || 'Cebu',
    supplier_cost_total: opts.supplierCost || '40000.00',
    currency: opts.currency || 'PHP',
    travel_start: opts.travelStart,
    travel_end: opts.travelEnd,
    pax_count: opts.paxCount
  }, opts.quotationOverrides || {});
  const quotation = runtime.createQuotation(quotationInput, staff()).data;
  assert.equal(makeQuotationApprovable(runtime, quotation, staff()).ok, true);
  assert.equal(runtime.approveQuotation({ quotation_id: quotation.quotation_id }, manager()).ok, true);
  assert.equal(runtime.acceptQuotation({ quotation_id: quotation.quotation_id, accepted_by: client.client_id }, staff()).ok, true);
  const bookingInput = { quotation_id: quotation.quotation_id, lead_pax_person_id: person.person_id };
  if (opts.createdAt) bookingInput.created_at = opts.createdAt;
  const booking = runtime.createBooking(bookingInput, staff()).data;
  return { client, person, quotation, booking };
}

function verifyAndAllocate(runtime, booking, amount, currency, sentAt) {
  const paymentInput = { booking_id: booking.booking_id, amount, currency, proof_reference: 'SALES-PROOF-' + booking.booking_id };
  if (sentAt) paymentInput.actual_sent_at = sentAt;
  const payment = runtime.recordClientPayment(paymentInput, staff()).data;
  assert.equal(runtime.verifyClientPayment({ client_payment_id: payment.payment.client_payment_id }, manager()).ok, true);
  assert.equal(runtime.allocatePayment({ client_payment_id: payment.payment.client_payment_id, allocations: [{ booking_id: booking.booking_id, amount }] }, staff()).ok, true);
  return payment.payment;
}

function paySupplier(runtime, booking, supplier, amount, currency) {
  const supplierBooking = runtime.createSupplierBooking({ booking_id: booking.booking_id, supplier_id: supplier.supplier_id }, staff()).data;
  const payable = runtime.createSupplierPayable({ supplier_booking_id: supplierBooking.supplier_booking_id, booking_id: booking.booking_id, amount, currency }, staff()).data;
  assert.equal(runtime.approveSupplierPayable({ supplier_payable_id: payable.supplier_payable_id }, manager()).ok, true);
  const executed = runtime.executeSupplierPayment({ supplier_payable_id: payable.supplier_payable_id }, manager()).data;
  assert.equal(executed.state, 'EXECUTED');
  assert.equal(executed.booking_id, booking.booking_id);
  return executed;
}

function buildSalesChain(runtime) {
  const supplier = runtime.createSupplier({ display_name: 'Sales Overview Supplier' }, staff()).data;

  // July PHP booking: full lineage — costs, paid commission, executed refund,
  // and an executed supplier payment behind verified allocated funds.
  const july = quotedBooking(runtime, { clientName: 'July PHP Client', email: 'july@example.test', supplierCost: '40000.00', currency: 'PHP', travelStart: '2026-08-25', travelEnd: '2026-08-30', paxCount: 4, createdAt: '2026-07-10T09:00:00.000Z' });
  runtime.createBookingItem({ booking_id: july.booking.booking_id, supplier_id: supplier.supplier_id, service_type: 'PACKAGE', supplier_cost: '25000.00', selling_price: '52000.00', quantity: 1, currency: 'PHP' }, staff());
  verifyAndAllocate(runtime, july.booking, '52000.00', 'PHP', '2026-07-15T09:00:00.000Z');
  paySupplier(runtime, july.booking, supplier, '20000.00', 'PHP');
  const commission = runtime.recordCommission({ booking_id: july.booking.booking_id, beneficiary_name: 'Referrer', basis: 'FLAT', amount: '1000.00' }, staff()).data;
  assert.equal(runtime.approveCommission({ commission_id: commission.commission_id }, manager()).ok, true);
  assert.equal(runtime.markCommissionPaid({ commission_id: commission.commission_id, payment_reference: 'COMM-JULY' }, manager()).ok, true);
  const refund = runtime.requestRefund({ booking_id: july.booking.booking_id, amount: '500.00', currency: 'PHP', reason: 'Price correction' }, staff()).data;
  assert.equal(runtime.executeRefund({ refund_adjustment_id: refund.refund_adjustment_id, approval_confirmed: true }, manager()).ok, true);

  // August USD booking without any supplier cost data — must never fake profit.
  const augustUsd = quotedBooking(runtime, { clientName: 'August USD Client', email: 'usd@example.test', supplierCost: '1000.00', currency: 'USD', travelStart: '2026-08-28', travelEnd: '2026-09-02', paxCount: 2 });
  const usdPayment = runtime.recordClientPayment({ booking_id: augustUsd.booking.booking_id, amount: '650.00', currency: 'USD', proof_reference: 'SALES-PROOF-USD' }, staff()).data;
  assert.equal(runtime.verifyClientPayment({ client_payment_id: usdPayment.payment.client_payment_id }, manager()).ok, true);

  // Package quotation chain: quoted, booked, supplier-paid — plus a second
  // package that is quoted but never booked.
  const bookedPackage = runtime.createPackage({ supplier_id: supplier.supplier_id, name: 'Boracay 3N Package', destination: 'Boracay', price_amount: '1500.00', currency: 'PHP', pax_basis: 'PER_GROUP', travel_start: '2026-09-10', travel_end: '2026-09-13' }, staff()).data;
  assert.equal(runtime.confirmPackage({ supplier_package_id: bookedPackage.supplier_package_id }, manager()).ok, true);
  const packageClient = runtime.createClient({ display_name: 'Package Client', primary_email: 'package@example.test' }, staff()).data;
  const packagePerson = runtime.createPerson({ display_name: 'Lead Pax Package Client' }, staff()).data;
  const packageQuote = runtime.createQuotationFromPackage({ package_id: bookedPackage.supplier_package_id, client_id: packageClient.client_id, pax_count: 3, unit_selling_price: '1950.00' }, staff()).data;
  assert.equal(packageQuote.quotation.supplier_package_id, bookedPackage.supplier_package_id);
  assert.equal(runtime.approveQuotation({ quotation_id: packageQuote.quotation.quotation_id }, manager()).ok, true);
  assert.equal(runtime.acceptQuotation({ quotation_id: packageQuote.quotation.quotation_id, accepted_by: packageClient.client_id }, staff()).ok, true);
  const packageBooking = runtime.createBooking({ quotation_id: packageQuote.quotation.quotation_id, lead_pax_person_id: packagePerson.person_id }, staff()).data;
  runtime.createBookingItem({ booking_id: packageBooking.booking_id, supplier_id: supplier.supplier_id, service_type: 'PACKAGE', supplier_cost: '1200.00', selling_price: '1950.00', quantity: 1, currency: 'PHP' }, staff());
  verifyAndAllocate(runtime, packageBooking, '1950.00', 'PHP', '2026-08-19T09:00:00.000Z');
  paySupplier(runtime, packageBooking, supplier, '500.00', 'PHP');

  const quotedOnlyPackage = runtime.createPackage({ supplier_id: supplier.supplier_id, name: 'Quoted Only Package', destination: 'Palawan', price_amount: '900.00', currency: 'PHP', pax_basis: 'PER_PERSON' }, staff()).data;
  assert.equal(runtime.confirmPackage({ supplier_package_id: quotedOnlyPackage.supplier_package_id }, manager()).ok, true);
  runtime.createQuotationFromPackage({ package_id: quotedOnlyPackage.supplier_package_id, client_id: packageClient.client_id, pax_count: 2 }, staff());

  return { supplier, july, augustUsd, bookedPackage, quotedOnlyPackage, packageBooking, packageQuote };
}

test('getSalesOverview computes multi-currency monthly sales, profit exclusions, packages, travelers, and cash', () => {
  const runtime = makeRuntime();
  const chain = buildSalesChain(runtime);

  const result = runtime.getSalesOverview({}, staff());
  assert.equal(result.ok, true);
  assert.equal(result.meta.action, 'GET_SALES_OVERVIEW');
  assert.equal(result.meta.read_only, true);
  assert.equal(result.data.asOf, TODAY);
  assert.equal(result.data.version, 'V1');

  const months = result.data.monthlySales.months;
  assert.equal(months.length, 12);
  assert.equal(months[0].month, '2025-09');
  assert.equal(months[11].month, '2026-08');

  const july = months.find((month) => month.month === '2026-07');
  assert.deepEqual(july.currencies, {
    PHP: { bookings: 1, booked: '52000.00', profit: '25500.00', profitBookings: 1, costNotRecorded: 0, confirmed: '52000.00' }
  });

  const august = months.find((month) => month.month === '2026-08');
  assert.deepEqual(august.currencies.PHP, {
    bookings: 1, booked: '1950.00', profit: '750.00', profitBookings: 1, costNotRecorded: 0, confirmed: '1950.00'
  });
  assert.deepEqual(august.currencies.USD, {
    bookings: 1, booked: '1300.00', profit: null, profitBookings: 0, costNotRecorded: 1, confirmed: '0.00'
  });
  assert.ok(!months.some((month) => month.month === '2026-09' && Object.keys(month.currencies).length), 'months outside the 12-month window are not present');

  const packages = result.data.packagesBooked;
  assert.equal(packages.count, 2);
  assert.deepEqual(packages.packages[0], {
    packageId: chain.bookedPackage.supplier_package_id,
    name: 'Boracay 3N Package',
    destination: 'Boracay',
    quotes: 1,
    bookings: 1,
    supplierPaidBookings: 1,
    revenue: { PHP: '1950.00' }
  });
  assert.deepEqual(packages.packages[1], {
    packageId: chain.quotedOnlyPackage.supplier_package_id,
    name: 'Quoted Only Package',
    destination: 'Palawan',
    quotes: 1,
    bookings: 0,
    supplierPaidBookings: 0,
    revenue: {}
  }, 'quoted-only packages sort below supplier-paid packages');

  assert.deepEqual(result.data.travelersThisMonth, { month: '2026-08', monthLabel: 'August 2026', travelers: 6, bookings: 2 });

  const cashMonths = result.data.cashCollected.months;
  assert.equal(cashMonths.length, 12);
  const julyCash = cashMonths.find((month) => month.month === '2026-07');
  assert.deepEqual(julyCash.currencies, { PHP: { collected: '52000.00', booked: '52000.00' } });
  const augustCash = cashMonths.find((month) => month.month === '2026-08');
  assert.deepEqual(augustCash.currencies.PHP, { collected: '1950.00', booked: '1950.00' });
  assert.deepEqual(augustCash.currencies.USD, { collected: '650.00', booked: '1300.00' });

  const auditRow = runtime.auditLog.list().filter((entry) => entry.action === 'GET_SALES_OVERVIEW' && entry.result === 'SUCCESS').pop();
  assert.ok(auditRow, 'successful overview read wrote an audit row');
  assert.equal(auditRow.details.asOf, TODAY);
  assert.equal(auditRow.details.travelers_this_month, 6);
});

test('getSalesOverview returns honest empty sections on an empty database', () => {
  const runtime = makeRuntime();
  const result = runtime.getSalesOverview({}, staff());
  assert.equal(result.ok, true);
  const data = result.data;
  assert.equal(data.monthlySales.months.length, 12);
  assert.ok(data.monthlySales.months.every((month) => Object.keys(month.currencies).length === 0));
  assert.deepEqual(data.packagesBooked, { count: 0, packages: [] });
  assert.deepEqual(data.travelersThisMonth, { month: '2026-08', monthLabel: 'August 2026', travelers: 0, bookings: 0 });
  assert.equal(data.cashCollected.months.length, 12);
  assert.ok(data.cashCollected.months.every((month) => Object.keys(month.currencies).length === 0));
});

test('getSalesOverview rejects an invalid asOf date, audits the failure, and changes no records', () => {
  const runtime = makeRuntime();
  buildSalesChain(runtime);
  const snapshot = runtime.snapshot().data.entities;
  const countsBefore = Object.fromEntries(Object.keys(snapshot).map((type) => [type, snapshot[type].length]));

  const badAsOf = runtime.getSalesOverview({ asOf: 'not-a-date' }, staff());
  assert.equal(badAsOf.ok, false);
  assert.equal(badAsOf.error.code, 'ASOF_DATE_INVALID');

  const customAsOf = runtime.getSalesOverview({ asOf: '2026-01-15' }, staff());
  assert.equal(customAsOf.ok, true);
  assert.equal(customAsOf.data.asOf, '2026-01-15');
  assert.equal(customAsOf.data.monthlySales.months[0].month, '2025-02');
  assert.deepEqual(customAsOf.data.travelersThisMonth, { month: '2026-01', monthLabel: 'January 2026', travelers: 0, bookings: 0 });

  const snapshotAfter = runtime.snapshot().data.entities;
  const countsAfter = Object.fromEntries(Object.keys(snapshotAfter).map((type) => [type, snapshotAfter[type].length]));
  assert.deepEqual(countsAfter, countsBefore, 'the read changed no records');

  const failures = runtime.auditLog.list().filter((entry) => entry.action === 'GET_SALES_OVERVIEW' && entry.result === 'FAILURE');
  assert.equal(failures.length, 1);
  assert.equal(failures[0].actor, 'staff');
});

test('getSalesOverview works over HTTP through the phase 1 action dispatcher', async () => {
  const runtime = makeRuntime();
  const chain = buildSalesChain(runtime);
  const phase1App = createPhase1Application({ runtime, seedSynthetic: false });
  const { server } = createMvpServer({ phase1App });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = async (body) => {
    const response = await fetch(base + '/api/phase1/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const overview = await post({ action: 'getSalesOverview', input: {}, actor: 'staff' });
    assert.equal(overview.status, 200);
    assert.equal(overview.body.ok, true);
    assert.equal(overview.body.meta.action, 'GET_SALES_OVERVIEW');
    const july = overview.body.data.monthlySales.months.find((month) => month.month === '2026-07');
    assert.equal(july.currencies.PHP.profit, '25500.00');
    assert.equal(overview.body.data.travelersThisMonth.travelers, 6);
    assert.equal(overview.body.data.packagesBooked.packages[0].packageId, chain.bookedPackage.supplier_package_id);
    assert.equal(overview.body.data.packagesBooked.packages[0].revenue.PHP, '1950.00');

    const rejected = await post({ action: 'getSalesOverview', input: { asOf: '2026-13-99' }, actor: 'staff' });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.ok, false);
    assert.equal(rejected.body.error.code, 'ASOF_DATE_INVALID');

    const unknown = await post({ action: 'getSalesOverviewz', input: {}, actor: 'staff' });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.error.code, 'UNKNOWN_ACTION');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
