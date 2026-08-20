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
const { makeQuotationApprovable } = require('../helpers/quotation-contract');

const CLOCK = () => new Date('2026-08-20T09:00:00Z');
const TODAY = '2026-08-20';

const AUTH = {
  staff: [ACTIONS.SELECT_OPTION, ACTIONS.ALLOCATE_PAYMENT, ACTIONS.ACCEPT_QUOTATION, ACTIONS.EDIT_DRAFT_PRICING, ACTIONS.RECORD_TICKETING, ACTIONS.ISSUE_VOUCHER],
  manager: [ACTIONS.APPROVE_QUOTATION, ACTIONS.VERIFY_PAYMENT]
};
const staff = () => ({ actor: 'staff', correlationId: 'READINESS-TEST' });
const manager = () => ({ actor: 'manager', correlationId: 'READINESS-TEST' });

function makeRuntime() {
  return createPhase1Runtime({ clock: CLOCK, config: { trustedActors: AUTH } });
}

function bookingChain(runtime, overrides) {
  const options = overrides || {};
  const client = runtime.createClient({ display_name: options.clientName || 'Readiness Client', primary_email: options.email || 'readiness@example.test' }, staff()).data;
  const person = runtime.createPerson({ display_name: 'Lead Pax ' + client.display_name }, staff()).data;
  const quotation = runtime.createQuotation({ client_id: client.client_id, destination: options.destination || 'Cebu', supplier_cost_total: '41500.00', client_total: '50000.00', currency: 'PHP' }, staff()).data;
  assert.equal(makeQuotationApprovable(runtime, quotation, staff()).ok, true);
  assert.equal(runtime.approveQuotation({ quotation_id: quotation.quotation_id }, manager()).ok, true);
  assert.equal(runtime.acceptQuotation({ quotation_id: quotation.quotation_id, accepted_by: client.client_id }, staff()).ok, true);
  const booking = runtime.createBooking({ quotation_id: quotation.quotation_id, lead_pax_person_id: person.person_id }, staff()).data;
  return { client, person, quotation, booking };
}

function payInFull(runtime, bookingId, amount) {
  const obligations = runtime.createBookingPaymentObligations({ booking_id: bookingId, obligations: [
    { purpose: 'FULL_PAYMENT', amount, currency: 'PHP', sequence: 1, due_at: '2026-08-15T09:00:00.000Z' }
  ] }, staff());
  assert.equal(obligations.ok, true);
  const obligation = obligations.data.obligations[0];
  const payment = runtime.recordClientPayment({ booking_id: bookingId, amount, currency: 'PHP', proof_reference: 'PROOF-' + bookingId }, staff()).data;
  assert.equal(runtime.verifyClientPayment({ client_payment_id: payment.payment.client_payment_id }, manager()).ok, true);
  assert.equal(runtime.allocatePayment({ client_payment_id: payment.payment.client_payment_id, allocations: [
    { booking_id: bookingId, client_obligation_id: obligation.client_obligation_id, amount }
  ], idempotency_key: 'READY-ALLOC-' + bookingId }, staff()).ok, true);
  return obligation;
}

function departureFixture(runtime, overrides) {
  const options = overrides || {};
  const chain = bookingChain(runtime, { clientName: options.clientName, email: options.email });
  const supplier = runtime.createSupplier({ display_name: 'Readiness Supplier ' + Math.random().toString(36).slice(2, 6) }, staff()).data;
  const flight = runtime.createBookingItem({ booking_id: chain.booking.booking_id, supplier_id: supplier.supplier_id, service_type: 'FLIGHT', description: 'MNL-CEB air', airline: 'PR', flight_number: 'PR 123' }, staff()).data;
  const hotel = runtime.createBookingItem({ booking_id: chain.booking.booking_id, supplier_id: supplier.supplier_id, service_type: 'HOTEL', description: 'Cebu hotel', required_documents: options.hotelDocuments === undefined ? ['HOTEL_CONFIRMATION'] : options.hotelDocuments }, staff()).data;
  const departure = runtime.createDeparture({ name: options.departureName || 'Cebu Group', destination: 'Cebu', start_date: options.startDate || '2026-08-24', end_date: options.endDate || '2026-08-27' }, staff()).data;
  assert.equal(runtime.addDepartureMembership({ departure_id: departure.departure_id, booking_item_id: hotel.booking_item_id }, staff()).ok, true);
  return Object.assign({}, chain, { supplier, flight, hotel, departure });
}

test('readiness reports PASS/FAIL/UNKNOWN per member check with an overall score', () => {
  const runtime = makeRuntime();

  const ready = departureFixture(runtime, { clientName: 'Ready Client', departureName: 'Ready Group' });
  payInFull(runtime, ready.booking.booking_id, '50000.00');
  assert.equal(runtime.recordTicketing({ booking_item_id: ready.flight.booking_item_id, status: 'TICKETED', pnr: 'ABC123', ticket_number: 'ETKT-1' }, staff()).ok, true);
  assert.equal(runtime.issueVoucher({ booking_item_id: ready.hotel.booking_item_id, voucher_number: 'V-READY-1' }, staff()).ok, true);
  runtime.createDocument({ file_name: 'hotel-conf.pdf', booking_id: ready.booking.booking_id, booking_item_id: ready.hotel.booking_item_id, document_type: 'HOTEL_CONFIRMATION', review_status: 'ACCEPTED', status: 'ACCEPTED' }, staff());

  const broken = departureFixture(runtime, { clientName: 'Broken Client', departureName: 'Broken Group' });
  runtime.createBookingPaymentObligations({ booking_id: broken.booking.booking_id, obligations: [
    { purpose: 'FULL_PAYMENT', amount: '50000.00', currency: 'PHP', sequence: 1, due_at: '2026-08-15T09:00:00.000Z' }
  ] }, staff());

  const unverified = departureFixture(runtime, { clientName: 'Unknown Client', departureName: 'Unknown Group', hotelDocuments: [] });
  runtime.recordTicketing({ booking_item_id: unverified.flight.booking_item_id, status: 'TICKETED', pnr: 'XYZ789', ticket_number: 'ETKT-2' }, staff());
  runtime.issueVoucher({ booking_item_id: unverified.hotel.booking_item_id, voucher_number: 'V-UN-1' }, staff());

  const readyResult = runtime.getDepartureReadiness({ departure_id: ready.departure.departure_id }, staff());
  assert.equal(readyResult.ok, true);
  assert.equal(readyResult.meta.read_only, true);
  const readyStatus = Object.fromEntries(readyResult.data.members[0].checks.map((check) => [check.check, check.status]));
  assert.deepEqual(readyStatus, { BOOKING_PAID: 'PASS', TICKETING: 'PASS', VOUCHERS: 'PASS', DOCUMENTS: 'PASS' });
  assert.equal(readyResult.data.score, 100);
  assert.equal(readyResult.data.state, 'READY');
  assert.equal(readyResult.data.counts.members, 1);
  assert.equal(readyResult.data.members[0].clientName, 'Ready Client');

  const brokenResult = runtime.getDepartureReadiness({ departure_id: broken.departure.departure_id }, staff());
  const brokenStatus = Object.fromEntries(brokenResult.data.members[0].checks.map((check) => [check.check, check.status]));
  assert.deepEqual(brokenStatus, { BOOKING_PAID: 'FAIL', TICKETING: 'FAIL', VOUCHERS: 'FAIL', DOCUMENTS: 'FAIL' });
  assert.equal(brokenResult.data.score, 0);
  assert.equal(brokenResult.data.state, 'NOT_READY');
  const paidCheck = brokenResult.data.members[0].checks.find((check) => check.check === 'BOOKING_PAID');
  assert.match(paidCheck.detail, /50000\.00/);

  const unknownResult = runtime.getDepartureReadiness({ departure_id: unverified.departure.departure_id }, staff());
  const unknownStatus = Object.fromEntries(unknownResult.data.members[0].checks.map((check) => [check.check, check.status]));
  assert.deepEqual(unknownStatus, { BOOKING_PAID: 'UNKNOWN', TICKETING: 'PASS', VOUCHERS: 'PASS', DOCUMENTS: 'UNKNOWN' });
  assert.equal(unknownResult.data.state, 'ATTENTION', 'honest UNKNOWNs surface as NEEDS REVIEW, not READY');
  assert.equal(unknownResult.data.score, 100, 'score counts decisive checks only');

  assert.ok(runtime.auditLog.list().some((entry) => entry.action === 'GET_DEPARTURE_READINESS' && entry.result === 'SUCCESS' && entry.details.departure_id === ready.departure.departure_id), 'read is audited');
});

test('verified payments with ACTIVE allocations satisfy the paid-in-full check; pending ones do not', () => {
  const runtime = makeRuntime();
  const fixture = departureFixture(runtime, { clientName: 'Partial Client' });
  runtime.createBookingPaymentObligations({ booking_id: fixture.booking.booking_id, obligations: [
    { purpose: 'FULL_PAYMENT', amount: '10000.00', currency: 'PHP', sequence: 1, due_at: '2026-08-15T09:00:00.000Z' }
  ] }, staff());
  const pending = runtime.recordClientPayment({ booking_id: fixture.booking.booking_id, amount: '10000.00', currency: 'PHP', proof_reference: 'PENDING-PROOF' }, staff()).data;
  assert.equal(pending.payment.payment_state, 'PENDING_VERIFICATION');

  const result = runtime.getDepartureReadiness({ departure_id: fixture.departure.departure_id }, staff());
  const paid = result.data.members[0].checks.find((check) => check.check === 'BOOKING_PAID');
  assert.equal(paid.status, 'FAIL', 'unverified payments never reduce the outstanding balance');
  assert.match(paid.detail, /10000\.00/);
});

test('cancelled booking items drop out of the member checklist', () => {
  const runtime = makeRuntime();
  const fixture = departureFixture(runtime, { clientName: 'Cancel Client' });
  runtime.updateBookingItem({ booking_item_id: fixture.hotel.booking_item_id, fulfillment_state: 'CANCELLED' }, staff());
  const result = runtime.getDepartureReadiness({ departure_id: fixture.departure.departure_id }, staff());
  assert.equal(result.data.counts.members, 0, 'the only membership is a cancelled service');
  assert.equal(result.data.members.length, 0);
});

test('runDepartureReadinessCheck raises idempotent tasks for FAIL rows only', () => {
  const runtime = makeRuntime();
  const fixture = departureFixture(runtime, { clientName: 'Fix Me Client', departureName: 'Fix Group', startDate: '2026-08-23' });
  runtime.createBookingPaymentObligations({ booking_id: fixture.booking.booking_id, obligations: [
    { purpose: 'FULL_PAYMENT', amount: '50000.00', currency: 'PHP', sequence: 1, due_at: '2026-08-15T09:00:00.000Z' }
  ] }, staff());

  const first = runtime.runDepartureReadinessCheck({ departure_id: fixture.departure.departure_id }, staff());
  assert.equal(first.ok, true);
  assert.equal(first.data.departures_checked, 1);
  assert.equal(first.data.failures_found, 4);
  assert.equal(first.data.tasks_created, 4, 'one task per FAIL check');
  const raised = runtime.list('Task', (task) => task.task_type === 'DEPARTURE_READINESS');
  assert.equal(raised.length, 4);
  const sample = raised[0];
  assert.equal(sample.source, 'DEPARTURE_READINESS');
  assert.equal(sample.related_type, 'Departure');
  assert.equal(sample.related_id, fixture.departure.departure_id);
  assert.equal(sample.departure_id, fixture.departure.departure_id);
  assert.equal(sample.booking_id, fixture.booking.booking_id);
  assert.equal(sample.booking_item_id, fixture.hotel.booking_item_id);
  assert.equal(sample.due_date, '2026-08-23', 'due on departure day');
  assert.equal(sample.priority, 'HIGH', 'departure within 3 days is HIGH priority');
  assert.match(sample.automation_key, /^DEPARTURE_READINESS:/);

  const second = runtime.runDepartureReadinessCheck({ departure_id: fixture.departure.departure_id }, staff());
  assert.equal(second.data.tasks_created, 0, 'second run raises nothing while tasks stay open');
  assert.equal(runtime.list('Task', (task) => task.task_type === 'DEPARTURE_READINESS').length, 4);

  assert.equal(runtime.updateTask({ task_id: raised[0].task_id, state: 'CANCELLED', completion_note: 'Handled at the bank.' }, staff()).ok, true);
  const third = runtime.runDepartureReadinessCheck({ departure_id: fixture.departure.departure_id }, staff());
  assert.equal(third.data.tasks_created, 1, 'a resolved task no longer suppresses a still-failing check');

  assert.ok(runtime.auditLog.list().some((entry) => entry.action === 'RUN_DEPARTURE_READINESS_CHECK' && entry.result === 'SUCCESS' && entry.details.tasks_created === 4), 'run audited with counts');
});

test('the scheduler default run covers departures overlapping the next 14 days only', () => {
  const runtime = makeRuntime();
  const inWindow = departureFixture(runtime, { clientName: 'Soon Client', departureName: 'Soon Group', startDate: '2026-08-25' });
  const outOfWindow = departureFixture(runtime, { clientName: 'Far Client', departureName: 'Far Group', startDate: '2026-09-15' });

  const result = runtime.runDepartureReadinessCheck({}, staff());
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.results.map((item) => item.departure_id).sort(), [inWindow.departure.departure_id].sort());
  assert.equal(result.data.departures_checked, 1);
  assert.ok(result.data.results.every((item) => item.name !== 'Far Group'), 'departure beyond 14 days is not checked');

  const empty = makeRuntime().runDepartureReadinessCheck({}, staff());
  assert.equal(empty.ok, true);
  assert.equal(empty.data.departures_checked, 0);
  assert.equal(empty.data.tasks_created, 0);
});

test('invalid readiness inputs fail closed and are audited', () => {
  const runtime = makeRuntime();
  const fixture = departureFixture(runtime, { clientName: 'Guard Client' });
  const taskCountBefore = runtime.list('Task').length;

  const missingId = runtime.getDepartureReadiness({}, staff());
  assert.equal(missingId.ok, false);
  assert.equal(missingId.error.code, 'REQUIRED_FIELD');

  const badId = runtime.getDepartureReadiness({ departure_id: 'DEPARTURE-2099-000001' }, staff());
  assert.equal(badId.ok, false);
  assert.equal(badId.error.code, 'NOT_FOUND');

  const badAsOf = runtime.getDepartureReadiness({ departure_id: fixture.departure.departure_id, asOf: '20-08-2026' }, staff());
  assert.equal(badAsOf.ok, false);
  assert.equal(badAsOf.error.code, 'ASOF_DATE_INVALID');

  const badRun = runtime.runDepartureReadinessCheck({ departure_id: 'DEPARTURE-2099-000001' }, staff());
  assert.equal(badRun.ok, false);
  assert.equal(badRun.error.code, 'NOT_FOUND');

  assert.equal(runtime.list('Task').length, taskCountBefore, 'failed runs created no tasks');
  assert.ok(runtime.auditLog.list().filter((entry) => ['GET_DEPARTURE_READINESS', 'RUN_DEPARTURE_READINESS_CHECK'].includes(entry.action) && entry.result === 'FAILURE').length >= 4, 'each rejection audited');
});

test('departure readiness works over HTTP through the phase 1 action dispatcher', async () => {
  const runtime = makeRuntime();
  const fixture = departureFixture(runtime, { clientName: 'HTTP Client' });
  const phase1App = createPhase1Application({ runtime, seedSynthetic: false });
  const { server } = createMvpServer({ phase1App });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = async (body) => {
    const response = await fetch(base + '/api/phase1/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const readiness = await post({ action: 'getDepartureReadiness', input: { departure_id: fixture.departure.departure_id }, actor: 'staff' });
    assert.equal(readiness.status, 200);
    assert.equal(readiness.body.ok, true);
    assert.equal(readiness.body.data.members.length, 1);
    assert.equal(readiness.body.data.state, 'NOT_READY');

    const obligations = await post({ action: 'createBookingPaymentObligations', input: { booking_id: fixture.booking.booking_id, obligations: [{ purpose: 'FULL_PAYMENT', amount: '50000.00', currency: 'PHP', sequence: 1, due_at: '2026-08-15T09:00:00.000Z' }] }, actor: 'staff' });
    assert.equal(obligations.body.ok, true);

    const run = await post({ action: 'runDepartureReadinessCheck', input: { departure_id: fixture.departure.departure_id }, actor: 'staff' });
    assert.equal(run.status, 200);
    assert.equal(run.body.data.tasks_created, 4);

    const rerun = await post({ action: 'runDepartureReadinessCheck', input: { departure_id: fixture.departure.departure_id }, actor: 'staff' });
    assert.equal(rerun.body.data.tasks_created, 0, 'HTTP re-run does not duplicate open tasks');

    const bad = await post({ action: 'getDepartureReadiness', input: { departure_id: 'DEPARTURE-2099-000009' }, actor: 'staff' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'NOT_FOUND');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('the hosted server registers the departure-readiness job and it raises tasks on manual trigger', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmit-readiness-'));
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
    assert.ok(hosted.scheduler.jobNames().includes('departure-readiness'), 'job is registered alongside heartbeat/backup/digest/expo-followups');
    assert.equal(hosted.scheduler.running, false, 'scheduler stays stopped when disabled');

    const runtime = hosted.runtime;
    const ctx = { actor: 'LOCAL_STAFF' };
    runtime.createRecord('Booking', { booking_id: 'BOOKING-2026-000901', client_id: 'CLIENT-SYNTH-000001', currency: 'PHP' }, ctx);
    runtime.createRecord('BookingItem', { booking_item_id: 'BOOKING_ITEM-2026-000901', booking_id: 'BOOKING-2026-000901', service_type: 'HOTEL', description: 'Unpaid hotel' }, ctx);
    runtime.createRecord('ClientObligation', { client_obligation_id: 'CLIENT_OBLIGATION-2026-000901', booking_id: 'BOOKING-2026-000901', amount: '1000.00', currency: 'PHP', due_at: '2026-08-21T09:00:00.000Z' }, ctx);
    const departure = runtime.createDeparture({ name: 'Hosted Readiness Group', start_date: '2026-08-25', end_date: '2026-08-28' }, ctx).data;
    runtime.addDepartureMembership({ departure_id: departure.departure_id, booking_item_id: 'BOOKING_ITEM-2026-000901' }, ctx);

    const run = await hosted.scheduler.runOnce('departure-readiness');
    assert.equal(run.status, 'SUCCESS');
    assert.equal(run.detail.departures_checked, 1);
    assert.equal(run.detail.tasks_created, 2, 'BOOKING_PAID and VOUCHERS failures each raised a task');
    assert.equal(runtime.list('Task', (task) => task.task_type === 'DEPARTURE_READINESS' && task.departure_id === departure.departure_id).length, 2);

    const rows = hosted.db.prepare("SELECT status FROM system_job_runs WHERE name = 'departure-readiness'").all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'SUCCESS', 'the manual trigger was recorded like every other job run');
  } finally {
    hosted.db.close();
  }
});

test('operations workspace ships the departure readiness panel', () => {
  const source = fs.readFileSync('app/public/operations.js', 'utf8');
  assert.match(source, /function departureReadinessPanelShell\(/);
  assert.match(source, /function renderDepartureReadinessPanel\(/);
  assert.match(source, /async function loadDepartureReadiness\(/);
  assert.match(source, /async function runDepartureReadinessFromPanel\(/);
  assert.match(source, /'DEPARTURE_READINESS'/);
  assert.match(source, /UNKNOWN/);
});
