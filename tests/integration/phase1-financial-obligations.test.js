'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhase1Runtime, ACTIONS } = require('../../src/phase1/runtime');
const { makeQuotationApprovable } = require('../helpers/quotation-contract');

const AUTH = {
  staff: [ACTIONS.ALLOCATE_PAYMENT, ACTIONS.ACCEPT_QUOTATION, ACTIONS.RESERVE_SUPPLIER, ACTIONS.EDIT_DRAFT_PRICING],
  manager: [ACTIONS.APPROVE_QUOTATION, ACTIONS.VERIFY_PAYMENT, ACTIONS.APPROVE_PAYABLE, ACTIONS.SUPPLIER_PAYMENT, ACTIONS.RECONCILE_BOOKING, ACTIONS.CLIENT_ACCEPT_AMENDMENT]
};

const ctx = (actor) => ({ actor: actor || 'staff', correlationId: 'INCREMENT-4-TEST' });

function setup() {
  const runtime = createPhase1Runtime({ clock: () => new Date('2026-08-15T10:00:00+08:00'), config: { trustedActors: AUTH } });
  const client = runtime.createClient({ display_name: 'Financial Test Client' }, ctx()).data;
  const supplier = runtime.createSupplier({ display_name: 'Financial Test Supplier' }, ctx()).data;
  const person = runtime.createPerson({ display_name: 'Lead Traveler', roles: ['TRAVELER'] }, ctx()).data;
  const inquiry = runtime.createInquiry({ client_id: client.client_id, requirements: { destination: 'Tokyo', travel_start: '2026-11-10', travel_end: '2026-11-14', pax_count: 1 } }, ctx()).data;
  const quote = runtime.createQuotation({ inquiry_id: inquiry.inquiry_id, client_id: client.client_id, client_total: '100.00', supplier_cost_total: '70.00', currency: 'PHP', status: 'DRAFT' }, ctx()).data;
  assert.equal(makeQuotationApprovable(runtime, quote, ctx('staff')).ok, true);
  assert.equal(runtime.approveQuotation({ quotation_id: quote.quotation_id }, ctx('manager')).ok, true);
  assert.equal(runtime.acceptQuotation({ quotation_id: quote.quotation_id, accepted_by: client.client_id }, ctx('staff')).ok, true);
  const booking = runtime.createBooking({ quotation_id: quote.quotation_id, lead_pax_person_id: person.person_id }, ctx('staff')).data;
  const supplierBooking = runtime.createSupplierBooking({ booking_id: booking.booking_id, supplier_id: supplier.supplier_id }, ctx('staff')).data;
  return { runtime, client, supplier, person, quote, booking, supplierBooking };
}

function createObligations(fixture) {
  const { runtime, booking } = fixture;
  const result = runtime.createBookingPaymentObligations({
    booking_id: booking.booking_id,
    obligations: [
      { sequence: 1, purpose: 'DOWN_PAYMENT', amount: '30.00', currency: 'PHP', due_at: '2026-09-01' },
      { sequence: 2, purpose: 'FINAL_BALANCE', amount: '70.00', currency: 'PHP', due_at: '2026-10-20' }
    ]
  }, ctx('staff'));
  assert.equal(result.ok, true);
  return result.data;
}

function recordAndVerify(fixture, amount, proof) {
  const { runtime, booking, client } = fixture;
  const recorded = runtime.recordClientPayment({ booking_id: booking.booking_id, client_id: client.client_id, amount, currency: 'PHP', proof_reference: proof }, ctx('staff'));
  assert.equal(recorded.ok, true);
  assert.equal(runtime.verifyClientPayment({ client_payment_id: recorded.data.payment.client_payment_id }, ctx('manager')).ok, true);
  return recorded.data.payment;
}

test('Booking obligations are authoritative, duplicate-safe, and survive payment timing changes', () => {
  const fixture = setup();
  const first = createObligations(fixture);
  const retry = fixture.runtime.createBookingPaymentObligations({
    booking_id: fixture.booking.booking_id,
    obligations: [
      { sequence: 1, purpose: 'DOWN_PAYMENT', amount: '30.00', currency: 'PHP', due_at: '2026-09-01' },
      { sequence: 2, purpose: 'FINAL_BALANCE', amount: '70.00', currency: 'PHP', due_at: '2026-10-20' }
    ]
  }, ctx('staff'));
  assert.equal(retry.ok, true);
  assert.equal(retry.data.obligations[0].client_obligation_id, first.obligations[0].client_obligation_id);
  assert.equal(fixture.runtime.list('ClientObligation').length, 2);
  assert.equal(fixture.runtime.list('PaymentScheduleItem').length, 2);

  const firstPayment = recordAndVerify(fixture, '20.00', 'proof-1');
  const allocationOne = fixture.runtime.allocatePayment({ client_payment_id: firstPayment.client_payment_id, allocations: [{ booking_id: fixture.booking.booking_id, client_obligation_id: first.obligations[0].client_obligation_id, amount: '20.00' }] }, ctx('staff'));
  assert.equal(allocationOne.ok, true);
  const projection = require('../../src/phase1/case-projection').projectCase(fixture.runtime, { booking_id: fixture.booking.booking_id }, { asOf: '2026-08-15T00:00:00.000Z' });
  assert.deepEqual(projection.finance.obligations.map((item) => [item.purpose, item.allocated, item.outstanding, item.state]), [['DOWN_PAYMENT', '20.00', '10.00', 'PARTIALLY_SATISFIED'], ['FINAL_BALANCE', '0.00', '70.00', 'OUTSTANDING']]);

  const secondPayment = recordAndVerify(fixture, '10.00', 'proof-2');
  assert.equal(fixture.runtime.allocatePayment({ client_payment_id: secondPayment.client_payment_id, allocations: [{ booking_id: fixture.booking.booking_id, client_obligation_id: first.obligations[0].client_obligation_id, amount: '10.00' }] }, ctx('staff')).ok, true);
  const afterDeposit = require('../../src/phase1/case-projection').projectCase(fixture.runtime, { booking_id: fixture.booking.booking_id });
  assert.equal(afterDeposit.finance.obligations[0].state, 'SATISFIED');
  assert.equal(afterDeposit.finance.obligations[1].state, 'OUTSTANDING');
  assert.equal(afterDeposit.finance.outstanding, '70.00');
});

test('Booking payment obligations can be added incrementally up to the client price', () => {
  const fixture = setup();
  const first = fixture.runtime.createBookingPaymentObligations({
    booking_id: fixture.booking.booking_id,
    obligations: [{ sequence: 1, purpose: 'DOWN_PAYMENT', amount: '30.00', currency: 'PHP', due_at: '2026-09-01' }]
  }, ctx('staff'));
  assert.equal(first.ok, true);
  const second = fixture.runtime.createBookingPaymentObligations({
    booking_id: fixture.booking.booking_id,
    obligations: [{ sequence: 2, purpose: 'FINAL_BALANCE', amount: '70.00', currency: 'PHP', due_at: '2026-10-20' }]
  }, ctx('staff'));
  assert.equal(second.ok, true);
  assert.equal(fixture.runtime.list('ClientObligation').length, 2);
});

test('Unverified, unallocated, over-target, and wrong-Booking funds fail closed', () => {
  const fixture = setup();
  const obligations = createObligations(fixture);
  const payment = fixture.runtime.recordClientPayment({ booking_id: fixture.booking.booking_id, client_id: fixture.client.client_id, amount: '40.00', currency: 'PHP', proof_reference: 'proof-unverified' }, ctx('staff')).data.payment;
  const unverifiedAllocation = fixture.runtime.allocatePayment({ client_payment_id: payment.client_payment_id, allocations: [{ booking_id: fixture.booking.booking_id, client_obligation_id: obligations.obligations[0].client_obligation_id, amount: '30.00' }] }, ctx('staff'));
  assert.equal(unverifiedAllocation.error.code, 'PAYMENT_NOT_VERIFIED');
  assert.equal(fixture.runtime.verifyClientPayment({ client_payment_id: payment.client_payment_id }, ctx('manager')).ok, true);
  const unallocatedProjection = require('../../src/phase1/case-projection').projectCase(fixture.runtime, { booking_id: fixture.booking.booking_id });
  assert.equal(unallocatedProjection.finance.verifiedAllocated, '0.00');
  assert.equal(unallocatedProjection.finance.unallocatedVerified, '40.00');

  const overTarget = fixture.runtime.allocatePayment({ client_payment_id: payment.client_payment_id, allocations: [{ booking_id: fixture.booking.booking_id, client_obligation_id: obligations.obligations[0].client_obligation_id, amount: '31.00' }] }, ctx('staff'));
  assert.equal(overTarget.error.code, 'ALLOCATION_EXCEEDS_OBLIGATION');
  assert.equal(fixture.runtime.list('PaymentAllocation').length, 0);

  const otherInquiry = fixture.runtime.createInquiry({ client_id: fixture.client.client_id, requirements: { destination: 'Osaka', travel_start: '2027-01-10', travel_end: '2027-01-11', pax_count: 1 } }, ctx()).data;
  const otherQuote = fixture.runtime.createQuotation({ inquiry_id: otherInquiry.inquiry_id, client_id: fixture.client.client_id, client_total: '20.00', supplier_cost_total: '10.00', currency: 'PHP' }, ctx()).data;
  assert.equal(makeQuotationApprovable(fixture.runtime, otherQuote, ctx('staff')).ok, true);
  fixture.runtime.approveQuotation({ quotation_id: otherQuote.quotation_id }, ctx('manager'));
  fixture.runtime.acceptQuotation({ quotation_id: otherQuote.quotation_id, accepted_by: fixture.client.client_id }, ctx('staff'));
  const otherBooking = fixture.runtime.createBooking({ quotation_id: otherQuote.quotation_id, lead_pax_person_id: fixture.person.person_id }, ctx('staff')).data;
  const wrongBooking = fixture.runtime.allocatePayment({ client_payment_id: payment.client_payment_id, allocations: [{ booking_id: otherBooking.booking_id, amount: '10.00' }] }, ctx('staff'));
  assert.equal(wrongBooking.error.code, 'PAYMENT_BOOKING_MISMATCH');
});

test('Supplier Payment is gated by approved payable, prerequisites, verified allocation, and payable balance', () => {
  const fixture = setup();
  const obligations = createObligations(fixture);
  const payable = fixture.runtime.createSupplierPayable({ supplier_booking_id: fixture.supplierBooking.supplier_booking_id, booking_id: fixture.booking.booking_id, amount: '70.00', currency: 'PHP' }, ctx('staff')).data;
  assert.equal(fixture.runtime.approveSupplierPayable({ supplier_payable_id: payable.supplier_payable_id }, ctx('manager')).ok, true);
  const payment = recordAndVerify(fixture, '50.00', 'proof-supplier');
  assert.equal(fixture.runtime.allocatePayment({ client_payment_id: payment.client_payment_id, allocations: [{ booking_id: fixture.booking.booking_id, client_obligation_id: obligations.obligations[0].client_obligation_id, amount: '30.00' }, { booking_id: fixture.booking.booking_id, client_obligation_id: obligations.obligations[1].client_obligation_id, amount: '20.00' }] }, ctx('staff')).ok, true);
  const blocked = fixture.runtime.executeSupplierPayment({ supplier_payable_id: payable.supplier_payable_id, amount: '70.00' }, ctx('manager'));
  assert.equal(blocked.error.code, 'INSUFFICIENT_VERIFIED_CLIENT_FUNDS');

  const balance = recordAndVerify(fixture, '50.00', 'proof-supplier-2');
  assert.equal(fixture.runtime.allocatePayment({ client_payment_id: balance.client_payment_id, allocations: [{ booking_id: fixture.booking.booking_id, client_obligation_id: obligations.obligations[1].client_obligation_id, amount: '50.00' }] }, ctx('staff')).ok, true);
  const paid = fixture.runtime.executeSupplierPayment({ supplier_payable_id: payable.supplier_payable_id, amount: '70.00', idempotency_key: 'supplier-payment-1' }, ctx('manager'));
  assert.equal(paid.ok, true);
  assert.equal(fixture.runtime.executeSupplierPayment({ supplier_payable_id: payable.supplier_payable_id, amount: '70.00', idempotency_key: 'supplier-payment-1' }, ctx('manager')).meta.idempotent, true);
  assert.equal(fixture.runtime.list('SupplierPayment').length, 1);

  const missingSupplierBooking = fixture.runtime.createRecord('SupplierBooking', { booking_id: fixture.booking.booking_id, reservation_state: 'CONFIRMED' }, ctx()).data;
  const missingPrerequisitePayable = fixture.runtime.createSupplierPayable({ supplier_booking_id: missingSupplierBooking.supplier_booking_id, booking_id: fixture.booking.booking_id, amount: '1.00', currency: 'PHP' }, ctx('staff')).data;
  fixture.runtime.approveSupplierPayable({ supplier_payable_id: missingPrerequisitePayable.supplier_payable_id }, ctx('manager'));
  const missing = fixture.runtime.executeSupplierPayment({ supplier_payable_id: missingPrerequisitePayable.supplier_payable_id, amount: '1.00' }, ctx('manager'));
  assert.equal(missing.error.code, 'SUPPLIER_PAYMENT_PREREQUISITES_MISSING');
});

test('Projected profit changes with Booking economics and actual profit requires realized inputs', () => {
  const fixture = setup();
  const first = require('../../src/phase1/case-projection').projectCase(fixture.runtime, { booking_id: fixture.booking.booking_id });
  assert.equal(first.profitability.projected.supplierCost, '70.00');
  assert.notEqual(first.profitability.projected.profit, '0.00');
  const amendment = fixture.runtime.amendBooking({ booking_id: fixture.booking.booking_id, changes: { current_price: '120.00', current_supplier_cost: '80.00' }, reason: 'Changed services' }, ctx('staff'));
  assert.equal(amendment.ok, true);
  assert.equal(fixture.runtime.acceptAmendment({ amendment_id: amendment.data.amendment.amendment_id, accepted_by: fixture.client.client_id }, ctx('manager')).ok, true);
  const changed = require('../../src/phase1/case-projection').projectCase(fixture.runtime, { booking_id: fixture.booking.booking_id });
  assert.notEqual(changed.profitability.projected.profit, first.profitability.projected.profit);
  const beforeActual = fixture.runtime.reconcileBooking({ booking_id: fixture.booking.booking_id, confirm: true }, ctx('manager'));
  assert.equal(beforeActual.error.code, 'ACTUAL_PROFIT_INPUTS_INCOMPLETE');
  const obligations = createObligations(fixture);
  const clientSettlement = recordAndVerify(fixture, '100.00', 'proof-profit-settlement');
  assert.equal(fixture.runtime.allocatePayment({ client_payment_id: clientSettlement.client_payment_id, allocations: [{ booking_id: fixture.booking.booking_id, client_obligation_id: obligations.obligations[0].client_obligation_id, amount: '30.00' }, { booking_id: fixture.booking.booking_id, client_obligation_id: obligations.obligations[1].client_obligation_id, amount: '70.00' }] }, ctx('staff')).ok, true);
  const payable = fixture.runtime.createSupplierPayable({ supplier_booking_id: fixture.supplierBooking.supplier_booking_id, booking_id: fixture.booking.booking_id, amount: '80.00', currency: 'PHP' }, ctx('staff')).data;
  fixture.runtime.approveSupplierPayable({ supplier_payable_id: payable.supplier_payable_id }, ctx('manager'));
  assert.equal(fixture.runtime.executeSupplierPayment({ supplier_payable_id: payable.supplier_payable_id, amount: '80.00', idempotency_key: 'profit-supplier-payment' }, ctx('manager')).ok, true);
  const actual = fixture.runtime.reconcileBooking({ booking_id: fixture.booking.booking_id, confirm: true, actual_selling_price: '120.00', actual_supplier_cost: '80.00', actual_fees: '5.00', actual_commissions: '3.00' }, ctx('manager'));
  assert.equal(actual.ok, true);
  assert.equal(actual.data.snapshot.actual_profit, '32.00');
  const projection = require('../../src/phase1/case-projection').projectCase(fixture.runtime, { booking_id: fixture.booking.booking_id });
  assert.equal(projection.profitability.actual.profit, '32.00');
});
