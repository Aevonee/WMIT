'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhase1Runtime, ACTIONS } = require('../../src/phase1/runtime');
const { makeQuotationApprovable } = require('../helpers/quotation-contract');

const AUTH = {
  staff: [ACTIONS.SELECT_OPTION, ACTIONS.RESERVE_SUPPLIER, ACTIONS.ALLOCATE_PAYMENT, ACTIONS.EDIT_DRAFT_PRICING, ACTIONS.ACCEPT_QUOTATION],
  manager: [ACTIONS.VERIFY_PAYMENT, ACTIONS.APPROVE_QUOTATION, ACTIONS.APPROVE_PAYABLE, ACTIONS.SUPPLIER_PAYMENT, ACTIONS.REFUND, ACTIONS.CONFIRM_COMMITMENT, ACTIONS.PRICE_OVERRIDE]
};
const ctx = (actor) => ({ actor: actor || 'staff', correlationId: 'PHASE1-TEST' });

function setup() {
  const runtime = createPhase1Runtime({
    clock: () => new Date('2026-08-13T10:00:00+08:00'),
    config: { trustedActors: AUTH, expo: { id: 'EXPO-2026', startAt: '2026-08-13T09:00:00+08:00', endAt: '2026-08-13T17:00:00+08:00', discountPercent: 10 } }
  });
  const client = runtime.createClient({ display_name: 'Synthetic Client', legal_name: 'Synthetic Client' }, ctx());
  const supplier = runtime.createSupplier({ display_name: 'Bangkok Travel Services', legal_name: 'Bangkok Travel Services', capabilities: ['DMC', 'Tariff Supplier'] }, ctx());
  const person = runtime.createPerson({ display_name: 'Coordinator', roles: ['COORDINATOR', 'PAYER'] }, ctx());
  runtime.defaultLeadPaxPersonId = person.data.person_id;
  const inquiry = runtime.createInquiry({ client_id: client.data.client_id, received_at: '2026-08-13T08:00:00+08:00', source: 'EXPO', event_context_id: 'EXPO-2026', requirements: { destination: 'Bangkok', travel_start: '2026-11-01', travel_end: '2026-11-05', nights: 4, pax_count: 2, hotel: 'Bangkok Riverside', room_type: 'Twin' } }, ctx());
  runtime.createBookingParticipant = runtime.createBookingParticipant.bind(runtime);
  return { runtime, client: client.data, supplier: supplier.data, person: person.data, inquiry: inquiry.data };
}

function tariffData() {
  return {
    file_name: 'BTS-Bangkok-2026-Tariff.pdf', file_ref: 'synthetic://bangkok-travel-services/tariff.pdf',
    original_source: { file_name: 'BTS-Bangkok-2026-Tariff.pdf', checksum: 'synthetic-bts-001' },
    extraction_facts: [
      { field_name: 'destination', normalized_value: 'Bangkok', confidence: 1 },
      { field_name: 'hotel', normalized_value: 'Bangkok Riverside', confidence: 1 },
      { field_name: 'rate_unit', normalized_value: 'PER_PERSON', confidence: 1 }
    ],
    rate_components: [
      { service_type: 'ACCOMMODATION_PACKAGE', amount: '10000.00', currency: 'PHP', rate_unit: 'PER_PERSON', quantity_driver: 'pax_count', conditions: { destination: 'Bangkok', hotel: 'Bangkok Riverside', nights: 4, pax_min: 2, room_type: 'Twin' }, inclusions: ['hotel', 'city tour'], exclusions: ['airfare'] },
      { service_type: 'ACCOMMODATION_PACKAGE', amount: '12000.00', currency: 'PHP', rate_unit: 'PER_PERSON', quantity_driver: 'pax_count', conditions: { destination: 'Bangkok', hotel: 'Bangkok Riverside', nights: 5, pax_min: 2, room_type: 'Twin' }, inclusions: ['hotel'], exclusions: [] }
    ],
    itinerary_components: [{ day: 1, city: 'Bangkok', activity: 'Arrival transfer' }, { day: 2, city: 'Bangkok', activity: 'City tour', included: true }]
  };
}

test('Phase 1 vertical slice preserves requirements-first tariff review and human selection', () => {
  const { runtime, supplier, inquiry, client } = setup();
  const uploaded = runtime.uploadTariff(Object.assign({ supplier_id: supplier.supplier_id }, tariffData()), ctx());
  assert.equal(uploaded.ok, true);
  assert.equal(uploaded.data.trusted, false);
  const beforeReview = runtime.matchOptions({ inquiry_id: inquiry.inquiry_id }, ctx());
  assert.equal(beforeReview.data.candidates.length, 0);
  const reviewed = runtime.reviewTariff({ tariff_source_id: uploaded.data.tariff_source_id, approve: true }, ctx('staff'));
  assert.equal(reviewed.ok, true);
  const matched = runtime.matchOptions({ inquiry_id: inquiry.inquiry_id }, ctx());
  assert.equal(matched.ok, true);
  assert.equal(matched.data.candidates.length, 1);
  assert.equal(matched.data.candidates[0].selected, false);
  assert.equal(runtime.selectOption({ commercial_option_id: matched.data.candidates[0].commercial_option_id }, ctx('staff')).ok, true);
  const quote = runtime.createQuotation({ commercial_option_id: matched.data.candidates[0].commercial_option_id, client_id: 'CLIENT-000001', pricing_context_type: 'EXPO', discount: '2000.00' }, ctx());
  assert.equal(makeQuotationApprovable(runtime, quote.data, ctx('staff')).ok, true);
  assert.equal(quote.ok, true);
  assert.equal(quote.data.supplier_cost_total, '20000.00');
  assert.equal(quote.data.discount_state, 'PENDING_PAYMENT_ELIGIBILITY');
  assert.equal(runtime.approveQuotation({ quotation_id: quote.data.quotation_id }, ctx('manager')).ok, true);
  assert.equal(runtime.acceptQuotation({ quotation_id: quote.data.quotation_id, accepted_by: client.client_id }, ctx()).ok, true);
});

test('Phase 1 requires a specific travel date or an approximate travel month/year for an Inquiry', () => {
  const runtime = createPhase1Runtime({ trustedActors: AUTH });
  const client = runtime.createClient({ display_name: 'Date Validation Client', legal_name: 'Date Validation Client' }, ctx()).data;
  const missing = runtime.createInquiry({ client_id: client.client_id, requirements: { destination: 'Bangkok', pax_count: 2 } }, ctx());
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'TRAVEL_DATE_REQUIRED');

  const monthMissingDuration = runtime.createInquiry({ client_id: client.client_id, requirements: { destination: 'Bangkok', travel_month: '2026-10', pax_count: 2 } }, ctx());
  assert.equal(monthMissingDuration.ok, false);
  assert.equal(monthMissingDuration.error.code, 'TRIP_DURATION_REQUIRED');

  const month = runtime.createInquiry({ client_id: client.client_id, requirements: { destination: 'Bangkok', travel_month: '2026-10', duration_days: 5, pax_count: 2 } }, ctx());
  assert.equal(month.ok, true);

  const year = runtime.createInquiry({ client_id: client.client_id, requirements: { destination: 'Bangkok', travel_year: '2027', duration_days: 5, pax_count: 2 } }, ctx());
  assert.equal(year.ok, true);
});

test('Phase 1 explains tariff condition mismatches and supports task completion', () => {
  const { runtime, supplier, inquiry } = setup();
  const uploaded = runtime.uploadTariff(Object.assign({ supplier_id: supplier.supplier_id }, tariffData()), ctx());
  runtime.reviewTariff({ tariff_source_id: uploaded.data.tariff_source_id, approve: true }, ctx());
  const mismatchedInquiry = runtime.createInquiry({ client_id: inquiry.client_id, requirements: { destination: 'Bangkok', travel_start: '2026-12-01', travel_end: '2026-12-04', nights: 3, pax_count: 2 } }, ctx()).data;
  const matched = runtime.matchOptions({ inquiry_id: mismatchedInquiry.inquiry_id }, ctx());
  assert.equal(matched.ok, true);
  assert.equal(matched.data.candidates.length, 0);
  assert.equal(matched.data.excluded_candidates[0].reason, 'REQUIREMENTS_NOT_MATCHED');
  assert.equal(matched.data.excluded_candidates[0].mismatches[0].field, 'nights');

  const task = runtime.createTask({ inquiry_id: inquiry.inquiry_id, description: 'Review supplier response' }, ctx()).data;
  const completed = runtime.updateTask({ task_id: task.task_id, state: 'COMPLETED', completion_note: 'Reviewed' }, ctx('staff'));
  assert.equal(completed.ok, true);
  assert.equal(completed.data.state, 'COMPLETED');
});

test('Phase 1 allows staff to edit draft quotation markup and preserves pricing history', () => {
  const { runtime, supplier, inquiry, client } = setup();
  const uploaded = runtime.uploadTariff(Object.assign({ supplier_id: supplier.supplier_id }, tariffData()), ctx());
  runtime.reviewTariff({ tariff_source_id: uploaded.data.tariff_source_id, approve: true }, ctx());
  const option = runtime.matchOptions({ inquiry_id: inquiry.inquiry_id }, ctx()).data.candidates[0];
  runtime.selectOption({ commercial_option_id: option.commercial_option_id }, ctx('staff'));
  const quote = runtime.createQuotation({ commercial_option_id: option.commercial_option_id, client_id: client.client_id }, ctx()).data;
  assert.equal(makeQuotationApprovable(runtime, quote, ctx('staff')).ok, true);

  const edited = runtime.updateQuotationPricing({
    quotation_id: quote.quotation_id,
    markup_percent: '35',
    fixed_fees: '500.00',
    reason: 'Staff pricing review'
  }, ctx('staff'));

  assert.equal(edited.ok, true);
  assert.equal(edited.data.status, 'DRAFT');
  assert.equal(edited.data.supplier_cost_total, '20000.00');
  assert.equal(edited.data.markup_total, '7000.00');
  assert.equal(edited.data.fees_total, '500.00');
  assert.equal(edited.data.client_total, '27500.00');
  assert.equal(edited.data.pricing_rule_snapshot.markup_percent, '35');
  assert.equal(edited.data.pricing_edit_history.length, 1);
  assert.equal(edited.data.pricing_edit_history[0].before.client_total, '26000.00');
  assert.equal(edited.data.pricing_edit_history[0].after.client_total, '27500.00');

  assert.equal(runtime.approveQuotation({ quotation_id: quote.quotation_id }, ctx('manager')).ok, true);
  assert.equal(runtime.acceptQuotation({ quotation_id: quote.quotation_id, accepted_by: client.client_id }, ctx()).ok, true);
  const locked = runtime.updateQuotationPricing({ quotation_id: quote.quotation_id, markup_percent: '40' }, ctx('staff'));
  assert.equal(locked.ok, false);
  assert.equal(locked.error.code, 'QUOTATION_NOT_DRAFT');
});

test('Phase 1 allows only one active Commercial Option selection per Inquiry', () => {
  const { runtime, inquiry, supplier } = setup();
  const first = runtime.createRecord('CommercialOption', {
    inquiry_id: inquiry.inquiry_id,
    supplier_id: supplier.supplier_id,
    state: 'MATCHED',
    selected: false,
    requirements_snapshot: inquiry.current_requirements,
    match_explanation: ['First candidate']
  }, ctx('staff'));
  const second = runtime.createRecord('CommercialOption', {
    inquiry_id: inquiry.inquiry_id,
    supplier_id: supplier.supplier_id,
    state: 'MATCHED',
    selected: false,
    requirements_snapshot: inquiry.current_requirements,
    match_explanation: ['Second candidate']
  }, ctx('staff'));
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);

  assert.equal(runtime.selectOption({ commercial_option_id: first.data.commercial_option_id }, ctx('staff')).ok, true);
  assert.equal(runtime.selectOption({ commercial_option_id: second.data.commercial_option_id }, ctx('staff')).ok, true);

  assert.equal(runtime.must('CommercialOption', first.data.commercial_option_id).selected, false);
  assert.equal(runtime.must('CommercialOption', first.data.commercial_option_id).state, 'MATCHED');
  assert.equal(runtime.must('CommercialOption', second.data.commercial_option_id).selected, true);
  assert.equal(runtime.must('CommercialOption', second.data.commercial_option_id).state, 'SELECTED');
  assert.equal(runtime.list('CommercialOption', (option) => option.inquiry_id === inquiry.inquiry_id && option.selected === true).length, 1);
});

test('Phase 1 keeps Expo sent time separate from verification and enforces supplier payment gate', () => {
  const { runtime, supplier, inquiry, client } = setup();
  const uploaded = runtime.uploadTariff(Object.assign({ supplier_id: supplier.supplier_id }, tariffData()), ctx());
  runtime.reviewTariff({ tariff_source_id: uploaded.data.tariff_source_id, approve: true }, ctx());
  const option = runtime.matchOptions({ inquiry_id: inquiry.inquiry_id }, ctx()).data.candidates[0];
  runtime.selectOption({ commercial_option_id: option.commercial_option_id }, ctx('staff'));
  const quote = runtime.createQuotation({ commercial_option_id: option.commercial_option_id, client_id: client.client_id, supplier_cost_total: '20000.00', pricing_context_type: 'EXPO', discount: '2000.00' }, ctx('manager')).data;
  assert.equal(makeQuotationApprovable(runtime, quote, ctx('staff')).ok, true);
  runtime.approveQuotation({ quotation_id: quote.quotation_id }, ctx('manager'));
  runtime.acceptQuotation({ quotation_id: quote.quotation_id, accepted_by: client.client_id }, ctx());
  const booking = runtime.createBooking({ quotation_id: quote.quotation_id, client_id: client.client_id, lead_pax_person_id: runtime.defaultLeadPaxPersonId, travel_start: '2026-11-01', travel_end: '2026-11-05' }, ctx()).data;
  runtime.createBookingItem({ booking_id: booking.booking_id, service_type: 'PACKAGE', description: 'Bangkok package', supplier_id: supplier.supplier_id, selling_price: '22000.00', supplier_cost: '20000.00', currency: 'PHP' }, ctx());
  const supplierBooking = runtime.createSupplierBooking({ booking_id: booking.booking_id, supplier_id: supplier.supplier_id, booking_item_ids: runtime.list('BookingItem').map((x) => x.booking_item_id) }, ctx('staff'));
  assert.equal(supplierBooking.ok, true);
  const payable = runtime.createSupplierPayable({ supplier_booking_id: supplierBooking.data.supplier_booking_id, booking_id: booking.booking_id, amount: '50000.00', currency: 'PHP' }, ctx()).data;
  runtime.approveSupplierPayable({ supplier_payable_id: payable.supplier_payable_id }, ctx('manager'));
  const payment = runtime.recordClientPayment({ booking_id: booking.booking_id, client_id: client.client_id, amount: '30000.00', currency: 'PHP', actual_sent_at: '2026-08-13T16:00:00+08:00', proof_reference: 'proof-1', payment_method: 'BANK' }, ctx());
  assert.equal(payment.ok, true);
  assert.equal(runtime.verifyClientPayment({ client_payment_id: payment.data.payment.client_payment_id }, ctx('manager')).ok, true);
  runtime.allocatePayment({ client_payment_id: payment.data.payment.client_payment_id, allocations: [{ booking_id: booking.booking_id, amount: '30000.00' }] }, ctx('staff'));
  const blocked = runtime.executeSupplierPayment({ supplier_payable_id: payable.supplier_payable_id, amount: '50000.00' }, ctx('manager'));
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'INSUFFICIENT_VERIFIED_CLIENT_FUNDS');
  const second = runtime.recordClientPayment({ booking_id: booking.booking_id, client_id: client.client_id, amount: '20000.00', currency: 'PHP', actual_sent_at: '2026-08-14T10:00:00+08:00', proof_reference: 'proof-2', payment_method: 'BANK' }, ctx());
  runtime.verifyClientPayment({ client_payment_id: second.data.payment.client_payment_id }, ctx('manager'));
  runtime.allocatePayment({ client_payment_id: second.data.payment.client_payment_id, allocations: [{ booking_id: booking.booking_id, amount: '20000.00' }] }, ctx('staff'));
  const paid = runtime.executeSupplierPayment({ supplier_payable_id: payable.supplier_payable_id, amount: '50000.00', idempotency_key: 'supplier-payment-retry-1' }, ctx('manager'));
  assert.equal(paid.ok, true);
  const paidRetry = runtime.executeSupplierPayment({ supplier_payable_id: payable.supplier_payable_id, amount: '50000.00', idempotency_key: 'supplier-payment-retry-1' }, ctx('manager'));
  assert.equal(paidRetry.ok, true);
  assert.equal(paidRetry.meta.idempotent, true);
  assert.equal(runtime.list('SupplierPayment').length, 1);
  assert.equal(runtime.must('ClientPayment', payment.data.payment.client_payment_id).actual_sent_at, '2026-08-13T16:00:00+08:00');
});

test('Phase 1 fails closed for blocked authorization and never auto-refunds or auto-allocates', () => {
  const { runtime, client, inquiry } = setup();
  const quote = runtime.createQuotation({ client_id: client.client_id, supplier_cost_total: '100.00', currency: 'PHP' }, ctx());
  assert.equal(makeQuotationApprovable(runtime, quote.data, ctx('staff')).ok, true);
  runtime.approveQuotation({ quotation_id: quote.data.quotation_id }, ctx('manager'));
  runtime.acceptQuotation({ quotation_id: quote.data.quotation_id, accepted_by: 'CLIENT-000001' }, ctx());
  const booking = runtime.createBooking({ quotation_id: quote.data.quotation_id, lead_pax_person_id: runtime.defaultLeadPaxPersonId }, ctx()).data;
  const payment = runtime.recordClientPayment({ booking_id: booking.booking_id, client_id: client.client_id, amount: '1.00', currency: 'PHP', proof_reference: 'proof' }, ctx());
  assert.equal(payment.ok, true);
  assert.equal(runtime.verifyClientPayment({ client_payment_id: payment.data.payment.client_payment_id }, ctx('staff')).error.code, 'AUTHORIZATION_REQUIRED');
  const refund = runtime.requestRefund({ booking_id: 'BOOKING-MISSING', amount: '1.00', currency: 'PHP', reason: 'Synthetic request' }, ctx());
  assert.equal(refund.ok, true);
  assert.equal(runtime.executeRefund({ refund_adjustment_id: refund.data.refund_adjustment_id }, ctx('staff')).error.code, 'AUTHORIZATION_REQUIRED');
  assert.equal(runtime.list('PaymentAllocation').length, 0);
  assert.ok(inquiry.inquiry_id);
});

test('Phase 1 retries are idempotent for tariff upload, client payment, and Supplier Payment', () => {
  const { runtime, supplier, inquiry, client } = setup();
  const first = runtime.uploadTariff(Object.assign({ supplier_id: supplier.supplier_id, idempotency_key: 'tariff-retry-1' }, tariffData()), ctx());
  const second = runtime.uploadTariff(Object.assign({ supplier_id: supplier.supplier_id, idempotency_key: 'tariff-retry-1' }, tariffData()), ctx());
  assert.equal(second.meta.idempotent, true);
  assert.equal(runtime.list('TariffSource').length, 1);
  const quote = runtime.createQuotation({ client_id: client.client_id, supplier_cost_total: '100.00', currency: 'PHP' }, ctx());
  assert.equal(makeQuotationApprovable(runtime, quote.data, ctx('staff')).ok, true);
  runtime.approveQuotation({ quotation_id: quote.data.quotation_id }, ctx('manager'));
  runtime.acceptQuotation({ quotation_id: quote.data.quotation_id, accepted_by: 'CLIENT-000001' }, ctx());
  const booking = runtime.createBooking({ quotation_id: quote.data.quotation_id, lead_pax_person_id: runtime.defaultLeadPaxPersonId }, ctx()).data;
  const paymentInput = { booking_id: booking.booking_id, client_id: client.client_id, amount: '100.00', currency: 'PHP', proof_reference: 'proof-idempotent', idempotency_key: 'payment-retry-1' };
  const payment1 = runtime.recordClientPayment(paymentInput, ctx());
  const payment2 = runtime.recordClientPayment(paymentInput, ctx());
  assert.equal(payment2.meta.idempotent, true);
  assert.equal(runtime.list('ClientPayment').length, 1);
  assert.equal(runtime.list('PaymentEvidence').length, 1);
  assert.equal(first.ok, true);
  assert.ok(inquiry.inquiry_id);
});
