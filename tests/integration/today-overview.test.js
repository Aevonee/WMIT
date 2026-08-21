'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createPhase1Runtime, ACTIONS } = require('../../src/phase1/runtime');
const { createPhase1Application } = require('../../src/application/phase1');
const { createMvpServer } = require('../../app/server');
const { makeQuotationApprovable } = require('../helpers/quotation-contract');

const CLOCK = () => new Date('2026-08-20T09:00:00Z');
const TODAY = '2026-08-20';

const AUTH = {
  staff: [ACTIONS.SELECT_OPTION, ACTIONS.RESERVE_SUPPLIER, ACTIONS.ALLOCATE_PAYMENT, ACTIONS.ACCEPT_QUOTATION, ACTIONS.EDIT_DRAFT_PRICING],
  manager: [ACTIONS.APPROVE_QUOTATION, ACTIONS.VERIFY_PAYMENT, ACTIONS.APPROVE_PAYABLE]
};
const staff = () => ({ actor: 'staff', correlationId: 'TODAY-OVERVIEW-TEST' });
const manager = () => ({ actor: 'manager', correlationId: 'TODAY-OVERVIEW-TEST' });

function makeRuntime() {
  return createPhase1Runtime({ clock: CLOCK, config: { trustedActors: AUTH } });
}

function acceptedQuotationChain(runtime, overrides) {
  const options = overrides || {};
  const client = runtime.createClient({ display_name: options.clientName || 'Today Overview Client', primary_email: options.email || 'today@example.test' }, staff()).data;
  const person = runtime.createPerson({ display_name: 'Lead Pax ' + client.display_name }, staff()).data;
  const quotation = runtime.createQuotation({ client_id: client.client_id, destination: options.destination || 'Cebu', supplier_cost_total: '41500.00', client_total: '50000.00', currency: 'PHP' }, staff()).data;
  assert.equal(makeQuotationApprovable(runtime, quotation, staff()).ok, true);
  assert.equal(runtime.approveQuotation({ quotation_id: quotation.quotation_id }, manager()).ok, true);
  assert.equal(runtime.acceptQuotation({ quotation_id: quotation.quotation_id, accepted_by: client.client_id }, staff()).ok, true);
  const booking = runtime.createBooking({ quotation_id: quotation.quotation_id, lead_pax_person_id: person.person_id }, staff()).data;
  return { client, person, quotation, booking };
}

function quoteQueueChain(runtime) {
  const client = runtime.createClient({ display_name: 'Quote Queue Client', primary_email: 'quotes@example.test' }, staff()).data;
  const inquiry = runtime.createInquiry({ client_id: client.client_id, requirements: { destination: 'El Nido', travel_start: '2026-12-01', travel_end: '2026-12-05', adults: 2 } }, staff()).data;
  const draftQuote = runtime.createQuotation({ client_id: client.client_id, inquiry_id: inquiry.inquiry_id, destination: 'El Nido', supplier_cost_total: '41500.00', currency: 'PHP' }, staff()).data;
  const expiringQuote = runtime.createQuotation({ client_id: client.client_id, destination: 'Coron', supplier_cost_total: '10000.00', currency: 'PHP' }, staff()).data;
  assert.equal(makeQuotationApprovable(runtime, expiringQuote, staff()).ok, true);
  assert.equal(runtime.approveQuotation({ quotation_id: expiringQuote.quotation_id }, manager()).ok, true);
  const expiredQuote = runtime.createQuotation({ client_id: client.client_id, destination: 'Vigan', supplier_cost_total: '8000.00', currency: 'PHP', valid_until: '2026-08-18' }, staff()).data;
  assert.equal(makeQuotationApprovable(runtime, expiredQuote, staff()).ok, true);
  assert.equal(runtime.approveQuotation({ quotation_id: expiredQuote.quotation_id }, manager()).ok, true);
  return { client, inquiry, draftQuote, expiringQuote, expiredQuote };
}

function buildChain(runtime) {
  const chain = acceptedQuotationChain(runtime, {});
  const supplier = runtime.createSupplier({ display_name: 'Today Supplier' }, staff()).data;
  const quotes = quoteQueueChain(runtime);

  const obligations = runtime.createBookingPaymentObligations({ booking_id: chain.booking.booking_id, obligations: [
    { purpose: 'DOWN_PAYMENT', amount: '20000.00', currency: 'PHP', sequence: 1, due_at: '2026-08-24T09:00:00.000Z' },
    { purpose: 'FINAL_BALANCE', amount: '20000.00', currency: 'PHP', sequence: 2, due_at: '2026-11-02T09:00:00.000Z' },
    { purpose: 'INSTALLMENT', amount: '1000.00', currency: 'PHP', sequence: 3, due_at: '2026-08-26T09:00:00.000Z' },
    { purpose: 'OTHER', amount: '500.00', currency: 'PHP', sequence: 4, due_at: '2026-08-18T09:00:00.000Z' },
    { purpose: 'INSTALLMENT', amount: '800.00', currency: 'PHP', sequence: 5, due_at: '2026-08-27T09:00:00.000Z' }
  ] }, staff());
  assert.equal(obligations.ok, true);
  const byPurpose = (purpose) => runtime.list('ClientObligation', (record) => record.booking_id === chain.booking.booking_id && record.purpose === purpose);
  const settled = byPurpose('INSTALLMENT')[0];
  const downPayment = byPurpose('DOWN_PAYMENT')[0];

  const payment = runtime.recordClientPayment({ booking_id: chain.booking.booking_id, amount: '1500.00', currency: 'PHP', proof_reference: 'TODAY-PROOF-1' }, staff()).data;
  assert.equal(runtime.verifyClientPayment({ client_payment_id: payment.payment.client_payment_id }, manager()).ok, true);
  assert.equal(runtime.allocatePayment({ client_payment_id: payment.payment.client_payment_id, allocations: [
    { booking_id: chain.booking.booking_id, client_obligation_id: settled.client_obligation_id, amount: '1000.00' },
    { booking_id: chain.booking.booking_id, client_obligation_id: downPayment.client_obligation_id, amount: '500.00' }
  ], idempotency_key: 'TODAY-ALLOC-1' }, staff()).ok, true);

  const item = runtime.createBookingItem({ booking_id: chain.booking.booking_id, supplier_id: supplier.supplier_id, service_type: 'PACKAGE', supplier_cost: '30000.00', selling_price: '50000.00', currency: 'PHP' }, staff()).data;
  const requestedSupplierBooking = runtime.createSupplierBooking({ booking_id: chain.booking.booking_id, supplier_id: supplier.supplier_id, booking_item_ids: [item.booking_item_id] }, staff()).data;
  assert.equal(requestedSupplierBooking.reservation_state, 'REQUESTED');
  const confirmedSupplierBooking = runtime.createSupplierBooking({ booking_id: chain.booking.booking_id, supplier_id: supplier.supplier_id }, staff()).data;
  assert.equal(runtime.updateSupplierBooking({ supplier_booking_id: confirmedSupplierBooking.supplier_booking_id, reservation_state: 'CONFIRMED' }, staff()).ok, true);

  const departure = runtime.createDeparture({ name: 'Cebu September Group', destination: 'Cebu', start_date: '2026-09-05', end_date: '2026-09-08' }, staff()).data;
  assert.equal(runtime.addDepartureMembership({ departure_id: departure.departure_id, booking_item_id: item.booking_item_id }, staff()).ok, true);
  assert.equal(runtime.createDepartureReadinessIssue({ departure_id: departure.departure_id, severity: 'HIGH', description: 'Final payment missing.' }, staff()).ok, true);
  const resolvedIssue = runtime.createDepartureReadinessIssue({ departure_id: departure.departure_id, severity: 'LOW', description: 'Rooming list pending.' }, staff()).data;
  assert.equal(runtime.updateDepartureReadinessIssue({ departure_readiness_issue_id: resolvedIssue.departure_readiness_issue_id, state: 'RESOLVED', resolution: 'Rooming list received.' }, staff()).ok, true);
  runtime.createDeparture({ name: 'Seoul December Group', destination: 'Seoul', start_date: '2026-12-10', end_date: '2026-12-16' }, staff());
  runtime.createDeparture({ name: 'Cancelled September Trip', start_date: '2026-09-01', state: 'CANCELLED' }, staff());
  runtime.createDeparture({ name: 'Ongoing August Trip', start_date: '2026-08-18', end_date: '2026-08-25' }, staff());

  runtime.createTask({ title: 'Overdue follow-up', description: 'Overdue follow-up', due_date: '2026-08-18', state: 'OPEN' }, staff());
  runtime.createTask({ title: 'Due today follow-up', description: 'Due today follow-up', due_date: TODAY, state: 'OPEN' }, staff());
  runtime.createTask({ title: 'Blocked follow-up', description: 'Blocked follow-up', due_date: '2026-08-19', state: 'BLOCKED' }, staff());
  runtime.createTask({ title: 'Future follow-up', description: 'Future follow-up', due_date: '2026-09-15', state: 'OPEN' }, staff());
  const completedTask = runtime.createTask({ title: 'Completed follow-up', description: 'Completed follow-up', due_date: '2026-08-17', state: 'OPEN' }, staff()).data;
  assert.equal(runtime.updateTask({ task_id: completedTask.task_id, state: 'COMPLETED' }, staff()).ok, true);

  runtime.createDocument({ file_name: 'passport-scan.pdf' }, staff());
  runtime.createDocument({ file_name: 'archived-contract.pdf', status: 'MATCHED' }, staff());
  runtime.createDocument({ file_name: 'mixed-case-review.pdf', status: 'Needs Review' }, staff());

  return Object.assign({}, chain, { supplier, item, departure, payment, quotes });
}

test('getTodayOverview aggregates all overview sections from existing records', () => {
  const runtime = makeRuntime();
  const chain = buildChain(runtime);

  const result = runtime.getTodayOverview({}, staff());
  assert.equal(result.ok, true);
  assert.equal(result.meta.action, 'GET_TODAY_OVERVIEW');
  assert.equal(result.meta.read_only, true);
  const data = result.data;
  assert.equal(data.today, TODAY);

  assert.equal(data.counts.paymentsDue, 2);
  const payment = data.paymentsDue.items[0];
  assert.equal(payment.clientName, 'Today Overview Client');
  assert.equal(payment.bookingId, chain.booking.booking_id);
  assert.equal(payment.dueDate, '2026-08-24');
  assert.equal(payment.outstanding, '19500.00');
  assert.equal(payment.allocated, '500.00');
  assert.equal(payment.state, 'PARTIALLY_SATISFIED');
  assert.equal(data.paymentsDue.items[1].dueDate, '2026-08-27');
  assert.equal(data.paymentsDue.items[1].outstanding, '800.00');

  assert.equal(data.counts.departures, 2);
  const departure = data.departures.items.find((item) => item.departureId === chain.departure.departure_id);
  assert.ok(departure, 'the September departure is in the window');
  assert.equal(departure.name, 'Cebu September Group');
  assert.equal(departure.startDate, '2026-09-05');
  assert.equal(departure.memberCount, 1);
  assert.equal(departure.openIssueCount, 1);
  assert.equal(departure.blockerCount, 1);
  assert.equal(data.departures.items[0].name, 'Ongoing August Trip', 'in-progress trips stay visible and sort by start date');

  assert.equal(data.counts.supplierConfirmations, 1);
  const confirmation = data.supplierConfirmations.items[0];
  assert.equal(confirmation.supplierName, 'Today Supplier');
  assert.equal(confirmation.bookingId, chain.booking.booking_id);
  assert.equal(confirmation.reservationState, 'REQUESTED');

  assert.equal(data.counts.followUpsDue, 3);
  const overdue = data.followUpsDue.items.find((item) => item.title === 'Overdue follow-up');
  assert.equal(overdue.overdue, true);
  const dueToday = data.followUpsDue.items.find((item) => item.title === 'Due today follow-up');
  assert.equal(dueToday.overdue, false);
  assert.ok(data.followUpsDue.items.some((item) => item.title === 'Blocked follow-up'));

  assert.equal(data.counts.documentsPendingReview, 2);
  assert.ok(data.documentsPendingReview.items.some((item) => item.fileName === 'passport-scan.pdf' && item.status === 'RECEIVED'));
  assert.ok(data.documentsPendingReview.items.some((item) => item.fileName === 'mixed-case-review.pdf' && item.status === 'NEEDS_REVIEW'));

  assert.equal(data.counts.quotesAwaitingApproval, 1);
  const awaiting = data.quotesAwaitingApproval.items[0];
  assert.equal(awaiting.quotationId, chain.quotes.draftQuote.quotation_id);
  assert.equal(awaiting.clientName, 'Quote Queue Client');
  assert.equal(awaiting.destination, 'El Nido');
  assert.equal(awaiting.clientTotal, chain.quotes.draftQuote.client_total);
  assert.equal(awaiting.currency, 'PHP');
  assert.equal(awaiting.inquiryId, chain.quotes.inquiry.inquiry_id);

  assert.equal(data.counts.quotesExpiringSoon, 2);
  assert.equal(data.quotesExpiringSoon.items[0].quotationId, chain.quotes.expiredQuote.quotation_id);
  assert.equal(data.quotesExpiringSoon.items[0].validUntil, '2026-08-18');
  assert.equal(data.quotesExpiringSoon.items[0].expired, true);
  assert.equal(data.quotesExpiringSoon.items[1].quotationId, chain.quotes.expiringQuote.quotation_id);
  assert.equal(data.quotesExpiringSoon.items[1].validUntil, '2026-08-27');
  assert.equal(data.quotesExpiringSoon.items[1].expired, false);
  assert.ok(!data.quotesExpiringSoon.items.some((item) => item.quotationId === chain.quotation.quotation_id), 'the accepted, booked quotation is not in the expiry queue');

  const auditRow = runtime.auditLog.list().filter((entry) => entry.action === 'GET_TODAY_OVERVIEW' && entry.result === 'SUCCESS').pop();
  assert.ok(auditRow, 'successful overview read wrote an audit row');
  assert.equal(auditRow.actor, 'staff');
  assert.equal(auditRow.details.counts.paymentsDue, 2);
});

test('getTodayOverview returns empty sections on an empty database without erroring', () => {
  const runtime = makeRuntime();
  const result = runtime.getTodayOverview({}, staff());
  assert.equal(result.ok, true);
  const data = result.data;
  assert.equal(data.today, TODAY);
  ['paymentsDue', 'departures', 'supplierConfirmations', 'followUpsDue', 'documentsPendingReview', 'quotesAwaitingApproval', 'quotesExpiringSoon'].forEach((section) => {
    assert.equal(data[section].count, 0, section + ' should be empty');
    assert.deepEqual(data[section].items, [], section + ' should return an empty array');
  });
  assert.deepEqual(data.counts, { paymentsDue: 0, departures: 0, supplierConfirmations: 0, followUpsDue: 0, documentsPendingReview: 0, quotesAwaitingApproval: 0, quotesExpiringSoon: 0 });
});

test('getTodayOverview and globalSearch are reads that need no configured authority', () => {
  const runtime = createPhase1Runtime({ clock: CLOCK, config: { trustedActors: {} } });
  const reader = { actor: 'unknown-intern' };
  const client = runtime.createClient({ display_name: 'No Authority Client' }, reader).data;
  runtime.createTask({ title: 'Reader task', description: 'Reader task', due_date: TODAY, state: 'OPEN' }, reader);
  runtime.createDocument({ file_name: 'reader-note.pdf' }, reader);
  const overview = runtime.getTodayOverview({}, reader);
  assert.equal(overview.ok, true);
  assert.equal(overview.data.counts.followUpsDue, 1);
  assert.equal(overview.data.counts.documentsPendingReview, 1);
  const search = runtime.globalSearch({ query: 'no authority' }, reader);
  assert.equal(search.ok, true);
  assert.ok(search.data.groups.find((group) => group.type === 'Client').results[0].id === client.client_id);
});

test('globalSearch matches each entity type and caps results per group', () => {
  const runtime = makeRuntime();
  const chain = acceptedQuotationChain(runtime, { clientName: 'Corazon Reyes', email: 'corazon@example.test', destination: 'Sapporo' });
  runtime.createInquiry({ client_id: chain.client.client_id, requirements: { destination: 'Sapporo', travel_start: '2026-11-10', travel_end: '2026-11-15', adults: 2 } }, staff());
  runtime.createRecord('ExpoLead', { name: 'Maria Zamora', mobile: '+639171234567', email: 'maria@example.test', destination: 'Sapporo', travel_month: '2026-11', status: 'NEW', expo_tag: 'EXPO-2026' }, staff());
  for (let index = 1; index <= 10; index += 1) {
    runtime.createClient({ display_name: 'Zamora Client ' + index }, staff());
  }

  const byType = (result, type) => result.data.groups.find((group) => group.type === type);

  const byClientName = runtime.globalSearch({ query: 'corazon' }, staff());
  assert.equal(byClientName.ok, true);
  assert.equal(byClientName.meta.read_only, true);
  assert.ok(byType(byClientName, 'Client').totalMatches >= 1);
  assert.equal(byType(byClientName, 'Client').results[0].id, chain.client.client_id);
  assert.equal(byType(byClientName, 'Client').results[0].type, 'Client');
  assert.ok(String(byType(byClientName, 'Client').results[0].label).includes('Corazon Reyes'));

  const byEmail = runtime.globalSearch({ query: 'CORAZON@EXAMPLE.TEST' }, staff());
  assert.ok(byType(byEmail, 'Client').totalMatches >= 1, 'email matching is case-insensitive');

  const byDestination = runtime.globalSearch({ query: 'sapporo' }, staff());
  assert.ok(byType(byDestination, 'Inquiry').totalMatches >= 1);
  assert.ok(byType(byDestination, 'ExpoLead').totalMatches >= 1);

  const byBookingId = runtime.globalSearch({ query: chain.booking.booking_id.toLowerCase() }, staff());
  assert.equal(byType(byBookingId, 'Booking').totalMatches, 1);
  assert.equal(byType(byBookingId, 'Booking').results[0].id, chain.booking.booking_id);

  const byQuotationId = runtime.globalSearch({ query: chain.quotation.quotation_id.toLowerCase() }, staff());
  assert.equal(byType(byQuotationId, 'Quotation').totalMatches, 1);

  const capped = runtime.globalSearch({ query: 'zamora client' }, staff());
  const clientGroup = byType(capped, 'Client');
  assert.equal(clientGroup.totalMatches, 10);
  assert.equal(clientGroup.results.length, 8);
  assert.ok(capped.data.groups.every((group) => group.results.length <= 8));
  assert.equal(capped.data.totalMatches >= 10, true);

  const auditRow = runtime.auditLog.list().filter((entry) => entry.action === 'GLOBAL_SEARCH' && entry.result === 'SUCCESS').pop();
  assert.ok(auditRow, 'successful search wrote an audit row');
  assert.equal(auditRow.details.query, 'zamora client');
});

test('globalSearch rejects missing and too-short queries, and invalid overview input fails closed without state change', () => {
  const runtime = makeRuntime();
  buildChain(runtime);
  const snapshot = runtime.snapshot().data.entities;
  const countsBefore = Object.fromEntries(Object.keys(snapshot).map((type) => [type, snapshot[type].length]));

  const tooShort = runtime.globalSearch({ query: 'a' }, staff());
  assert.equal(tooShort.ok, false);
  assert.equal(tooShort.error.code, 'QUERY_TOO_SHORT');

  const whitespace = runtime.globalSearch({ query: '   ' }, staff());
  assert.equal(whitespace.ok, false);
  assert.equal(whitespace.error.code, 'REQUIRED_FIELD');

  const missing = runtime.globalSearch({}, staff());
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'REQUIRED_FIELD');

  const badAsOf = runtime.getTodayOverview({ asOf: '2026-13-99' }, staff());
  assert.equal(badAsOf.ok, false);
  assert.equal(badAsOf.error.code, 'ASOF_DATE_INVALID');
  const badAsOfText = runtime.getTodayOverview({ asOf: 'yesterday' }, staff());
  assert.equal(badAsOfText.ok, false);
  assert.equal(badAsOfText.error.code, 'ASOF_DATE_INVALID');

  const snapshotAfter = runtime.snapshot().data.entities;
  const countsAfter = Object.fromEntries(Object.keys(snapshotAfter).map((type) => [type, snapshotAfter[type].length]));
  assert.deepEqual(countsAfter, countsBefore, 'failed reads changed no records');

  const failures = runtime.auditLog.list().filter((entry) => ['GLOBAL_SEARCH', 'GET_TODAY_OVERVIEW'].includes(entry.action) && entry.result === 'FAILURE');
  assert.ok(failures.length >= 5, 'each rejected call audited a failure row');
  assert.ok(failures.every((entry) => entry.actor === 'staff'));
});

test('today overview and global search work over HTTP through the phase 1 action dispatcher', async () => {
  const runtime = makeRuntime();
  const chain = buildChain(runtime);
  runtime.createRecord('ExpoLead', { name: 'Maria Zamora', mobile: '+639171234567', email: 'maria@example.test', destination: 'Sapporo', travel_month: '2026-11', status: 'NEW', expo_tag: 'EXPO-2026' }, staff());
  const phase1App = createPhase1Application({ runtime, seedSynthetic: false });
  const { server } = createMvpServer({ phase1App });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = async (body) => {
    const response = await fetch(base + '/api/phase1/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const overview = await post({ action: 'getTodayOverview', input: {}, actor: 'staff' });
    assert.equal(overview.status, 200);
    assert.equal(overview.body.ok, true);
    assert.equal(overview.body.data.today, TODAY);
    assert.equal(overview.body.data.counts.paymentsDue, 2);
    assert.equal(overview.body.data.counts.departures, 2);
    assert.equal(overview.body.data.counts.supplierConfirmations, 1);
    assert.equal(overview.body.data.counts.followUpsDue, 3);
    assert.equal(overview.body.data.counts.documentsPendingReview, 2);
    assert.equal(overview.body.data.counts.quotesAwaitingApproval, 1);
    assert.equal(overview.body.data.counts.quotesExpiringSoon, 2);
    assert.equal(overview.body.data.paymentsDue.items[0].clientName, 'Today Overview Client');
    assert.equal(overview.body.data.quotesAwaitingApproval.items[0].inquiryId, chain.quotes.inquiry.inquiry_id);

    const search = await post({ action: 'globalSearch', input: { query: 'sapporo' }, actor: 'staff' });
    assert.equal(search.status, 200);
    assert.equal(search.body.ok, true);
    assert.deepEqual(search.body.data.groups.map((group) => group.type), ['Client', 'Inquiry', 'Quotation', 'Booking', 'ExpoLead']);
    assert.ok(search.body.data.groups.find((group) => group.type === 'ExpoLead').totalMatches >= 1);

    const rejected = await post({ action: 'globalSearch', input: { query: 'x' }, actor: 'staff' });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.ok, false);
    assert.equal(rejected.body.error.code, 'QUERY_TOO_SHORT');

    const unknown = await post({ action: 'getTodayOverviewz', input: {}, actor: 'staff' });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.error.code, 'UNKNOWN_ACTION');

    const audited = runtime.auditLog.list().filter((entry) => entry.action === 'GLOBAL_SEARCH' && entry.result === 'FAILURE');
    assert.ok(audited.length >= 1, 'rejected HTTP search audited a failure row');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('operations workspace ships the Today tab and the header search covers expo leads', () => {
  const html = fs.readFileSync('app/public/operations.html', 'utf8');
  assert.match(html, /data-tab="today"/);
  assert.ok(html.indexOf('data-tab="today"') < html.indexOf('data-tab="dashboard"'), 'Today is the first tab');
  assert.match(html, /id="today-content"/);
  assert.match(html, /wmit-global-search/);
  assert.match(html, /@media\(max-width:640px\)/);
  const source = fs.readFileSync('app/public/operations.js', 'utf8');
  assert.match(source, /function renderToday\(/);
  assert.match(source, /today: renderToday/);
  assert.match(source, /function loadTodayOverview\(/);
  assert.match(source, /list\('ExpoLead'\)/);
  assert.match(source, /quotesAwaitingApproval/);
  assert.match(source, /quotesExpiringSoon/);
  assert.match(source, /function renderDashboard\(/);
  assert.match(source, /dashboard: renderDashboard/);
  assert.match(source, /function loadSalesOverview\(/);
  assert.match(source, /getSalesOverview/);
  assert.doesNotMatch(source, /dashboardQueuesMarkup/);
  assert.match(source, /function inquiryWorkQueueMarkup\(/);
});
