'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhase1Runtime, ACTIONS } = require('../../src/phase1/runtime');
const { createPhase1Application } = require('../../src/application/phase1');
const { makeQuotationApprovable } = require('../helpers/quotation-contract');

const AUTH = {
  staff: [ACTIONS.ALLOCATE_PAYMENT, ACTIONS.ACCEPT_QUOTATION, ACTIONS.RESERVE_SUPPLIER, ACTIONS.EDIT_DRAFT_PRICING],
  manager: [ACTIONS.APPROVE_QUOTATION, ACTIONS.VERIFY_PAYMENT, ACTIONS.APPROVE_PAYABLE, ACTIONS.SUPPLIER_PAYMENT, ACTIONS.REFUND, ACTIONS.RECONCILE_BOOKING, ACTIONS.CLIENT_ACCEPT_AMENDMENT]
};

const ctx = (actor) => ({ actor: actor || 'staff', correlationId: 'SAFETY-HARDENING-TEST' });

function setup() {
  const runtime = createPhase1Runtime({ clock: () => new Date('2026-08-16T10:00:00+08:00'), config: { trustedActors: AUTH } });
  const client = runtime.createClient({ display_name: 'Hardening Test Client' }, ctx()).data;
  const supplier = runtime.createSupplier({ display_name: 'Hardening Test Supplier' }, ctx()).data;
  const person = runtime.createPerson({ display_name: 'Lead Traveler', roles: ['TRAVELER'] }, ctx()).data;
  const inquiry = runtime.createInquiry({ client_id: client.client_id, requirements: { destination: 'Tokyo', travel_start: '2026-11-10', travel_end: '2026-11-14', pax_count: 1 } }, ctx()).data;
  const quote = runtime.createQuotation({ inquiry_id: inquiry.inquiry_id, client_id: client.client_id, client_total: '130.00', supplier_cost_total: '100.00', currency: 'PHP', status: 'DRAFT' }, ctx()).data;
  assert.equal(makeQuotationApprovable(runtime, quote, ctx('staff')).ok, true);
  assert.equal(runtime.approveQuotation({ quotation_id: quote.quotation_id }, ctx('manager')).ok, true);
  assert.equal(runtime.acceptQuotation({ quotation_id: quote.quotation_id, accepted_by: client.client_id }, ctx('staff')).ok, true);
  const booking = runtime.createBooking({ quotation_id: quote.quotation_id, lead_pax_person_id: person.person_id }, ctx('staff')).data;
  const supplierBooking = runtime.createSupplierBooking({ booking_id: booking.booking_id, supplier_id: supplier.supplier_id }, ctx('staff')).data;
  const obligations = runtime.createBookingPaymentObligations({ booking_id: booking.booking_id, obligations: [{ sequence: 1, purpose: 'DOWN_PAYMENT', amount: '130.00', currency: 'PHP', due_at: '2026-09-01' }] }, ctx('staff')).data;
  return { runtime, client, supplier, person, quote, booking, supplierBooking, obligations };
}

function recordVerifyAllocate(fixture, amount, proof) {
  const { runtime, booking, obligations } = fixture;
  const recorded = runtime.recordClientPayment({ booking_id: booking.booking_id, amount, currency: 'PHP', proof_reference: proof }, ctx('staff'));
  assert.equal(recorded.ok, true);
  assert.equal(runtime.verifyClientPayment({ client_payment_id: recorded.data.payment.client_payment_id }, ctx('manager')).ok, true);
  const allocation = runtime.allocatePayment({ client_payment_id: recorded.data.payment.client_payment_id, allocations: [{ booking_id: booking.booking_id, client_obligation_id: obligations.obligations[0].client_obligation_id, amount }] }, ctx('staff'));
  assert.equal(allocation.ok, true);
  return recorded.data.payment;
}

function requestRefundDraft(fixture, amount, reason) {
  const refund = fixture.runtime.requestRefund({ booking_id: fixture.booking.booking_id, amount, currency: 'PHP', reason }, ctx('staff'));
  assert.equal(refund.ok, true);
  return refund.data;
}

test('the action dispatcher rejects runtime internals and unknown actions by name', () => {
  const app = createPhase1Application();
  for (const name of ['updateRecord', 'createRecord', 'list', 'get', 'must', 'snapshot', 'deleteRecord', 'repos', 'config', 'audit', 'id', 'verifiedAllocatedFunds', 'buildQuotationSnapshot', 'quotationItems', 'constructor', '__proto__']) {
    const result = app.action({ action: name, input: { type: 'Client', id: 'CLIENT-SYNTH-000001', changes: { status: 'HACKED' } }, actor: 'LOCAL_MANAGER' });
    assert.equal(result.ok, false, name + ' must not be dispatchable');
    assert.equal(result.error.code, 'UNKNOWN_ACTION', name + ' must be rejected as unknown');
  }
  const legitimate = app.action({ action: 'createPerson', input: { display_name: 'Whitelist Probe Person' }, actor: 'LOCAL_STAFF' });
  assert.equal(legitimate.ok, true);
});

test('executeRefund requires explicit confirmation, a valid draft, and replays idempotently', () => {
  const fixture = setup();
  recordVerifyAllocate(fixture, '50.00', 'proof-1');
  const draft = requestRefundDraft(fixture, '20.00', 'Partial refund after cancellation');

  const unconfirmed = fixture.runtime.executeRefund({ refund_adjustment_id: draft.refund_adjustment_id }, ctx('manager'));
  assert.equal(unconfirmed.ok, false);
  assert.equal(unconfirmed.error.code, 'REFUND_APPROVAL_REQUIRED');

  const executed = fixture.runtime.executeRefund({ refund_adjustment_id: draft.refund_adjustment_id, approval_confirmed: true }, ctx('manager'));
  assert.equal(executed.ok, true);
  assert.equal(executed.data.state, 'EXECUTED');

  const replay = fixture.runtime.executeRefund({ refund_adjustment_id: draft.refund_adjustment_id, approval_confirmed: true }, ctx('manager'));
  assert.equal(replay.ok, true);
  assert.equal(replay.meta.idempotent, true);
});

test('executeRefund is blocked when verified funds are insufficient after supplier payments and prior refunds', () => {
  const fixture = setup();
  recordVerifyAllocate(fixture, '50.00', 'proof-1');

  const payable = fixture.runtime.createSupplierPayable({ booking_id: fixture.booking.booking_id, supplier_booking_id: fixture.supplierBooking.supplier_booking_id, amount: '20.00', currency: 'PHP' }, ctx('staff'));
  assert.equal(payable.ok, true, JSON.stringify(payable.error));
  assert.equal(fixture.runtime.approveSupplierPayable({ supplier_payable_id: payable.data.supplier_payable_id }, ctx('manager')).ok, true);
  assert.equal(fixture.runtime.executeSupplierPayment({ supplier_payable_id: payable.data.supplier_payable_id, amount: '20.00' }, ctx('manager')).ok, true);

  // Verified 50.00 - supplier 20.00 = 30.00 available. A 40.00 refund must fail closed.
  const excessive = requestRefundDraft(fixture, '40.00', 'Exceeds available funds');
  const blocked = fixture.runtime.executeRefund({ refund_adjustment_id: excessive.refund_adjustment_id, approval_confirmed: true }, ctx('manager'));
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'REFUND_EXCEEDS_AVAILABLE_FUNDS');

  // An exact 30.00 refund is allowed, and a later 10.00 refund finds nothing left.
  const exact = requestRefundDraft(fixture, '30.00', 'Uses remaining funds exactly');
  assert.equal(fixture.runtime.executeRefund({ refund_adjustment_id: exact.refund_adjustment_id, approval_confirmed: true }, ctx('manager')).ok, true);
  const afterSpend = requestRefundDraft(fixture, '10.00', 'Nothing remains');
  const drained = fixture.runtime.executeRefund({ refund_adjustment_id: afterSpend.refund_adjustment_id, approval_confirmed: true }, ctx('manager'));
  assert.equal(drained.ok, false);
  assert.equal(drained.error.code, 'REFUND_EXCEEDS_AVAILABLE_FUNDS');
});

test('executeRefund rejects drafts with invalid booking, currency, or amount', () => {
  const runtime = createPhase1Runtime({ clock: () => new Date('2026-08-16T10:00:00+08:00'), config: { trustedActors: AUTH } });
  const missingBooking = runtime.requestRefund({ booking_id: 'BOOKING-DOES-NOT-EXIST', amount: '1.00', currency: 'PHP', reason: 'Missing booking' }, ctx('staff')).data;
  assert.equal(runtime.executeRefund({ refund_adjustment_id: missingBooking.refund_adjustment_id, approval_confirmed: true }, ctx('manager')).error.code, 'NOT_FOUND');

  const noCurrency = runtime.requestRefund({ booking_id: 'BOOKING-1', amount: '1.00', reason: 'No currency' }, ctx('staff')).data;
  assert.equal(runtime.executeRefund({ refund_adjustment_id: noCurrency.refund_adjustment_id, approval_confirmed: true }, ctx('manager')).error.code, 'INVALID_CURRENCY');

  const zero = runtime.requestRefund({ booking_id: 'BOOKING-1', amount: '0.00', currency: 'PHP', reason: 'Zero refund' }, ctx('staff')).data;
  assert.equal(runtime.executeRefund({ refund_adjustment_id: zero.refund_adjustment_id, approval_confirmed: true }, ctx('manager')).error.code, 'REFUND_AMOUNT_INVALID');
});

test('audit log captures old and new values and records failed operations', () => {
  const runtime = createPhase1Runtime({ clock: () => new Date('2026-08-16T00:00:00Z') });
  runtime.createClient({ client_id: 'CLIENT-AUDIT-000001', display_name: 'Original Name', legal_name: 'Original Name' }, ctx());
  runtime.updateClient('CLIENT-AUDIT-000001', { display_name: 'Renamed Name' }, ctx());
  const events = runtime.auditLog.list();
  const update = events.filter((event) => event.action === 'UPDATE').pop();
  assert.equal(update.result, 'SUCCESS');
  assert.deepEqual(update.details.changedFields, ['display_name']);
  assert.equal(update.details.old_values.display_name, 'Original Name');
  assert.equal(update.details.new_values.display_name, 'Renamed Name');

  const failedCreate = runtime.createClient({ display_name: '' }, ctx());
  assert.equal(failedCreate.ok, false);
  const duplicateCreate = runtime.createClient({ client_id: 'CLIENT-AUDIT-000001', display_name: 'Duplicate ID', legal_name: 'Duplicate ID' }, ctx());
  assert.equal(duplicateCreate.ok, false);
  assert.equal(duplicateCreate.error.code, 'DUPLICATE_ID');
  const failure = runtime.auditLog.list().filter((event) => event.result === 'FAILURE').pop();
  assert.equal(failure.entity_type, 'Client');
  assert.equal(failure.details.error_code, duplicateCreate.error.code);

  runtime.updateClient('CLIENT-AUDIT-000001', { display_name: 'Versioned Name' }, ctx());
  const stale = runtime.updateClient('CLIENT-AUDIT-000001', { display_name: 'Conflicting Name', expected_record_version: 1 }, ctx());
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, 'VERSION_CONFLICT');
  const conflictAudit = runtime.auditLog.list().filter((event) => event.result === 'FAILURE').pop();
  assert.equal(conflictAudit.details.error_code, 'VERSION_CONFLICT');
});

test('updateRecord enforces optional optimistic concurrency on record_version', () => {
  const runtime = createPhase1Runtime();
  runtime.createClient({ client_id: 'CLIENT-CONC-000001', display_name: 'Concurrency Client', legal_name: 'Concurrency Client' }, ctx());
  const first = runtime.updateRecord('Client', 'CLIENT-CONC-000001', { display_name: 'Edit One', expected_record_version: 1 }, ctx());
  assert.equal(first.ok, true);
  assert.equal(first.data.record_version, 2);
  const stale = runtime.updateRecord('Client', 'CLIENT-CONC-000001', { display_name: 'Edit Two', expected_record_version: 1 }, ctx());
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, 'VERSION_CONFLICT');
  const current = runtime.updateRecord('Client', 'CLIENT-CONC-000001', { display_name: 'Edit Three', expected_record_version: 2 }, ctx());
  assert.equal(current.ok, true);
  assert.equal(current.data.display_name, 'Edit Three');
  assert.equal('expected_record_version' in current.data, false);
});

test('approveSupplierPayable replays approvals idempotently but rejects non-draft payables', () => {
  const fixture = setup();
  recordVerifyAllocate(fixture, '50.00', 'proof-1');
  const payable = fixture.runtime.createSupplierPayable({ booking_id: fixture.booking.booking_id, supplier_booking_id: fixture.supplierBooking.supplier_booking_id, amount: '20.00', currency: 'PHP' }, ctx('staff'));
  assert.equal(payable.ok, true);
  assert.equal(fixture.runtime.approveSupplierPayable({ supplier_payable_id: payable.data.supplier_payable_id }, ctx('manager')).ok, true);
  const replay = fixture.runtime.approveSupplierPayable({ supplier_payable_id: payable.data.supplier_payable_id }, ctx('manager'));
  assert.equal(replay.ok, true);
  assert.equal(replay.meta.idempotent, true);
  // A payable already in a terminal state can never be (re-)approved.
  const settled = fixture.runtime.createSupplierPayable({ booking_id: fixture.booking.booking_id, supplier_booking_id: fixture.supplierBooking.supplier_booking_id, amount: '5.00', currency: 'PHP', state: 'PAID' }, ctx('staff'));
  assert.equal(settled.ok, true);
  const rejected = fixture.runtime.approveSupplierPayable({ supplier_payable_id: settled.data.supplier_payable_id }, ctx('manager'));
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'PAYABLE_STATE_INVALID');
});
