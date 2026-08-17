'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhase1Runtime, ACTIONS } = require('../../src/phase1/runtime');
const { makeQuotationApprovable } = require('../helpers/quotation-contract');

const AUTH = {
  staff: [ACTIONS.SELECT_OPTION, ACTIONS.EDIT_DRAFT_PRICING, ACTIONS.ALLOCATE_PAYMENT, ACTIONS.ACCEPT_QUOTATION],
  manager: [ACTIONS.APPROVE_QUOTATION, ACTIONS.VERIFY_PAYMENT, ACTIONS.PRICE_OVERRIDE]
};
const ctx = (actor) => ({ actor: actor || 'staff', correlationId: 'PHASE2A-TEST' });

function setup() {
  const runtime = createPhase1Runtime({ config: { trustedActors: AUTH }, clock: () => new Date('2026-08-14T10:00:00+08:00') });
  const client = runtime.createClient({ display_name: 'Phase 2A Client', legal_name: 'Phase 2A Client' }, ctx()).data;
  const supplier = runtime.createSupplier({ display_name: 'Phase 2A Supplier', legal_name: 'Phase 2A Supplier' }, ctx()).data;
  runtime.defaultLeadPaxPersonId = runtime.createPerson({ display_name: 'Phase 2A Lead Pax' }, ctx()).data.person_id;
  return { runtime, client, supplier };
}

test('Inquiry validation requires destination, approximate duration, and stores traveler composition', () => {
  const { runtime, client } = setup();
  const noDestination = runtime.createInquiry({ client_id: client.client_id, requirements: { travel_start: '2026-11-01', travel_end: '2026-11-05', adults: 2 } }, ctx());
  assert.equal(noDestination.ok, false);
  assert.equal(noDestination.error.code, 'REQUIRED_FIELD');

  const monthOnly = runtime.createInquiry({ client_id: client.client_id, requirements: { destination: 'Bangkok', travel_month: '2026-11', adults: 2 } }, ctx());
  assert.equal(monthOnly.ok, false);
  assert.equal(monthOnly.error.code, 'TRIP_DURATION_REQUIRED');

  const approximate = runtime.createInquiry({ client_id: client.client_id, requirements: { destination: 'Bangkok', travel_month: '2026-11', duration_days: 5, adults: 2 } }, ctx());
  assert.equal(approximate.ok, true);
  assert.equal(approximate.data.current_requirements.duration_days, 5);
  assert.equal(approximate.data.current_requirements.nights, 4);

  const exact = runtime.createInquiry({ client_id: client.client_id, requirements: { destination: 'Bangkok', travel_start: '2026-11-01', travel_end: '2026-11-05', adults: 2, children: 1, infants: 0 } }, ctx());
  assert.equal(exact.ok, true);
  assert.deepEqual({ adults: exact.data.current_requirements.adults, children: exact.data.current_requirements.children, infants: exact.data.current_requirements.infants, pax_count: exact.data.current_requirements.pax_count, duration_days: exact.data.current_requirements.duration_days, nights: exact.data.current_requirements.nights }, { adults: 2, children: 1, infants: 0, pax_count: 3, duration_days: 5, nights: 4 });
});

test('Inquiry edits update current requirements, derive nights, and preserve the original request', () => {
  const { runtime, client } = setup();
  const inquiry = runtime.createInquiry({ client_id: client.client_id, requirements: { destination: 'Bangkok', travel_month: '2026-11', duration_days: 5, adults: 2, children: 0, infants: 0 } }, ctx()).data;
  const updated = runtime.updateInquiry(inquiry.inquiry_id, { requirements: { destination: 'Phuket', travel_month: '2026-12', duration_days: 7, adults: 2, children: 1, infants: 0, child_ages: [8] } }, ctx());
  assert.equal(updated.ok, true);
  assert.equal(updated.data.current_requirements.destination, 'Phuket');
  assert.equal(updated.data.current_requirements.duration_days, 7);
  assert.equal(updated.data.current_requirements.nights, 6);
  assert.equal(updated.data.original_request.destination, 'Bangkok');
  assert.equal(updated.data.original_request.duration_days, 5);
  assert.equal(updated.data.history.filter((entry) => entry.type === 'REQUIREMENTS_CHANGED').length, 1);
});

test('matching returns a price preview derived from the matched tariff and composition', () => {
  const { runtime, client, supplier } = setup();
  const inquiry = runtime.createInquiry({ client_id: client.client_id, requirements: { destination: 'Bangkok', travel_start: '2026-11-01', travel_end: '2026-11-05', adults: 2, children: 1, infants: 0 } }, ctx()).data;
  const uploaded = runtime.uploadTariff({ supplier_id: supplier.supplier_id, extraction_facts: [{ field_name: 'rate_unit', normalized_value: 'PER_PERSON', confidence: 1 }], rate_components: [{ amount: '100.00', currency: 'PHP', rate_unit: 'PER_PERSON', quantity_driver: 'pax_count', conditions: { destination: 'Bangkok', duration_days: 5 } }] }, ctx());
  assert.equal(uploaded.ok, true);
  assert.equal(runtime.reviewTariff({ tariff_source_id: uploaded.data.tariff_source_id, approve: true }, ctx()).ok, true);
  const matched = runtime.matchOptions({ inquiry_id: inquiry.inquiry_id }, ctx());
  assert.equal(matched.ok, true);
  assert.equal(matched.data.candidates.length, 1);
  assert.deepEqual(matched.data.candidates[0].pricing_preview, { supplier_cost_total: '300.00', markup_total: '90.00', fees_total: '0.00', client_total: '390.00', currency: 'PHP' });
});

test('TWN and DBL_TWN are equivalent room-arrangement values', () => {
  const { runtime } = setup();
  assert.equal(runtime.conditionMatches({ room_arrangement: 'TWN' }, { room_arrangement: 'DBL_TWN' }), true);
  assert.equal(runtime.conditionMatches({ room_arrangement: 'DBL_TWN' }, { room_arrangement: 'TWN' }), true);
});

test('one Booking is enforced per approved quotation and retries return the existing record', () => {
  const { runtime, client } = setup();
  const quote = runtime.createQuotation({ client_id: client.client_id, supplier_cost_total: '100.00', currency: 'PHP' }, ctx()).data;
  assert.equal(makeQuotationApprovable(runtime, quote, ctx('staff')).ok, true);
  assert.equal(runtime.approveQuotation({ quotation_id: quote.quotation_id }, ctx('manager')).ok, true);
  assert.equal(runtime.acceptQuotation({ quotation_id: quote.quotation_id, accepted_by: client.client_id }, ctx()).ok, true);
  const first = runtime.createBooking({ quotation_id: quote.quotation_id, lead_pax_person_id: runtime.defaultLeadPaxPersonId }, ctx());
  const second = runtime.createBooking({ quotation_id: quote.quotation_id, lead_pax_person_id: runtime.defaultLeadPaxPersonId }, ctx());
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.meta.idempotent, true);
  assert.equal(second.data.booking_id, first.data.booking_id);
  assert.equal(runtime.list('Booking').length, 1);
});

test('payment purpose is recorded as intent and invalid purposes are rejected', () => {
  const { runtime, client } = setup();
  const quote = runtime.createQuotation({ client_id: client.client_id, supplier_cost_total: '100.00', currency: 'PHP' }, ctx()).data;
  assert.equal(makeQuotationApprovable(runtime, quote, ctx('staff')).ok, true);
  runtime.approveQuotation({ quotation_id: quote.quotation_id }, ctx('manager'));
  runtime.acceptQuotation({ quotation_id: quote.quotation_id, accepted_by: client.client_id }, ctx());
  const booking = runtime.createBooking({ quotation_id: quote.quotation_id, lead_pax_person_id: runtime.defaultLeadPaxPersonId }, ctx()).data;
  const payment = runtime.recordClientPayment({ booking_id: booking.booking_id, client_id: client.client_id, amount: '50.00', currency: 'PHP', proof_reference: 'proof-1', payment_purpose: 'FULL_PAYMENT' }, ctx());
  assert.equal(payment.ok, true);
  assert.equal(payment.data.payment.payment_purpose, 'FULL_PAYMENT');
  const invalid = runtime.recordClientPayment({ booking_id: booking.booking_id, client_id: client.client_id, amount: '50.00', currency: 'PHP', proof_reference: 'proof-2', payment_purpose: 'PAID_IN_FULL' }, ctx());
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'INVALID_PAYMENT_PURPOSE');
});

test('required tariff requirements do not become implicit wildcards', () => {
  const { runtime, client, supplier } = setup();
  const inquiry = runtime.createInquiry({ client_id: client.client_id, requirement_statuses: { hotel_category: 'REQUIRED' }, requirements: { destination: 'Bangkok', travel_start: '2026-11-01', travel_end: '2026-11-05', adults: 2, children: 0, infants: 0 } }, ctx()).data;
  const uploaded = runtime.uploadTariff({ supplier_id: supplier.supplier_id, extraction_facts: [{ field_name: 'rate_unit', normalized_value: 'PER_PERSON', confidence: 1 }], rate_components: [{ amount: '100.00', currency: 'PHP', rate_unit: 'PER_PERSON', quantity_driver: 'pax_count', conditions: { destination: 'Bangkok', duration_days: 5, hotel_category: '4-star' } }] }, ctx()).data;
  runtime.reviewTariff({ tariff_source_id: uploaded.tariff_source_id, approve: true }, ctx());
  const result = runtime.matchOptions({ inquiry_id: inquiry.inquiry_id }, ctx());
  assert.equal(result.ok, true);
  assert.equal(result.data.candidates.length, 0);
  assert.equal(result.data.excluded_candidates[0].mismatches[0].reason, 'REQUIREMENT_REQUIRED');
});

test('payment allocation is cumulative and allocation retries are idempotent', () => {
  const { runtime, client } = setup();
  const quote = runtime.createQuotation({ client_id: client.client_id, supplier_cost_total: '100.00', currency: 'PHP' }, ctx()).data;
  assert.equal(makeQuotationApprovable(runtime, quote, ctx('staff')).ok, true);
  runtime.approveQuotation({ quotation_id: quote.quotation_id }, ctx('manager'));
  runtime.acceptQuotation({ quotation_id: quote.quotation_id, accepted_by: client.client_id }, ctx());
  const booking = runtime.createBooking({ quotation_id: quote.quotation_id, lead_pax_person_id: runtime.defaultLeadPaxPersonId }, ctx()).data;
  const payment = runtime.recordClientPayment({ booking_id: booking.booking_id, client_id: client.client_id, amount: '100.00', currency: 'PHP', proof_reference: 'proof-allocation' }, ctx()).data.payment;
  runtime.verifyClientPayment({ client_payment_id: payment.client_payment_id }, ctx('manager'));
  const first = runtime.allocatePayment({ client_payment_id: payment.client_payment_id, idempotency_key: 'allocation-retry-1', allocations: [{ booking_id: booking.booking_id, amount: '60.00' }] }, ctx('staff'));
  assert.equal(first.ok, true);
  const retry = runtime.allocatePayment({ client_payment_id: payment.client_payment_id, idempotency_key: 'allocation-retry-1', allocations: [{ booking_id: booking.booking_id, amount: '60.00' }] }, ctx('staff'));
  assert.equal(retry.ok, true);
  assert.equal(retry.meta.idempotent, true);
  assert.equal(runtime.list('PaymentAllocation').length, 1);
  const excess = runtime.allocatePayment({ client_payment_id: payment.client_payment_id, allocations: [{ booking_id: booking.booking_id, amount: '50.00' }] }, ctx('staff'));
  assert.equal(excess.ok, false);
  assert.equal(excess.error.code, 'ALLOCATION_EXCEEDS_PAYMENT');
});

test('payment verification cannot silently change a finalized payment state', () => {
  const { runtime, client } = setup();
  const quote = runtime.createQuotation({ client_id: client.client_id, supplier_cost_total: '100.00', currency: 'PHP' }, ctx()).data;
  assert.equal(makeQuotationApprovable(runtime, quote, ctx('staff')).ok, true);
  runtime.approveQuotation({ quotation_id: quote.quotation_id }, ctx('manager'));
  runtime.acceptQuotation({ quotation_id: quote.quotation_id, accepted_by: client.client_id }, ctx());
  const booking = runtime.createBooking({ quotation_id: quote.quotation_id, lead_pax_person_id: runtime.defaultLeadPaxPersonId }, ctx()).data;
  const payment = runtime.recordClientPayment({ booking_id: booking.booking_id, client_id: client.client_id, amount: '50.00', currency: 'PHP', proof_reference: 'proof-final' }, ctx()).data.payment;
  assert.equal(runtime.verifyClientPayment({ client_payment_id: payment.client_payment_id }, ctx('manager')).ok, true);
  const changed = runtime.verifyClientPayment({ client_payment_id: payment.client_payment_id, verified: false, reason: 'Changed opinion' }, ctx('manager'));
  assert.equal(changed.ok, false);
  assert.equal(changed.error.code, 'PAYMENT_ALREADY_FINALIZED');
});

test('tariff-driven child ages block matching only when the tariff needs them', () => {
  const { runtime, client, supplier } = setup();
  const inquiry = runtime.createInquiry({ client_id: client.client_id, requirements: { destination: 'Bangkok', travel_start: '2026-11-01', travel_end: '2026-11-05', adults: 2, children: 1, infants: 0 } }, ctx()).data;
  const uploaded = runtime.uploadTariff({ supplier_id: supplier.supplier_id, extraction_facts: [{ field_name: 'rate_unit', normalized_value: 'PER_PERSON', confidence: 1 }], rate_components: [{ amount: '100.00', currency: 'PHP', rate_unit: 'PER_PERSON', quantity_driver: 'pax_count', conditions: { destination: 'Bangkok', duration_days: 5, child_age_required: true } }] }, ctx()).data;
  runtime.reviewTariff({ tariff_source_id: uploaded.tariff_source_id, approve: true }, ctx());
  const blocked = runtime.matchOptions({ inquiry_id: inquiry.inquiry_id }, ctx());
  assert.equal(blocked.data.candidates.length, 0);
  assert.equal(blocked.data.excluded_candidates[0].mismatches[0].reason, 'CHILD_AGES_REQUIRED');
  const updated = runtime.updateInquiry(inquiry.inquiry_id, { requirements: { destination: 'Bangkok', travel_start: '2026-11-01', travel_end: '2026-11-05', adults: 2, children: 1, infants: 0, child_ages: [6] } }, ctx());
  assert.equal(updated.ok, true);
  assert.equal(runtime.matchOptions({ inquiry_id: inquiry.inquiry_id }, ctx()).data.candidates.length, 1);
});

test('unknown requirements are not treated as confirmed matches and Find More Options records its reason', () => {
  const { runtime, client } = setup();
  const inquiry = runtime.createInquiry({ client_id: client.client_id, requirement_statuses: { hotel_category: 'UNKNOWN' }, requirements: { destination: 'Bangkok', travel_start: '2026-11-01', travel_end: '2026-11-05', adults: 2, children: 0, infants: 0, hotel_category: undefined } }, ctx()).data;
  const more = runtime.findMoreOptions({ inquiry_id: inquiry.inquiry_id, reason: 'PRICE_TOO_HIGH', note: 'Client needs a lower price' }, ctx());
  assert.equal(more.ok, true);
  assert.equal(more.data.search_request.reason, 'PRICE_TOO_HIGH');
  assert.equal(runtime.list('FindMoreRequest').length, 1);
});

test('replacing an option after quotation requires confirmation and records downstream impact', () => {
  const { runtime, client, inquiry } = (() => {
    const base = setup();
    const inquiry = base.runtime.createInquiry({ client_id: base.client.client_id, requirements: { destination: 'Bangkok', travel_start: '2026-11-01', travel_end: '2026-11-05', adults: 2, children: 0, infants: 0 } }, ctx()).data;
    return { ...base, inquiry };
  })();
  const first = runtime.createRecord('CommercialOption', { inquiry_id: inquiry.inquiry_id, state: 'MATCHED', selected: false, match_explanation: ['First'] }, ctx()).data;
  const second = runtime.createRecord('CommercialOption', { inquiry_id: inquiry.inquiry_id, state: 'MATCHED', selected: false, match_explanation: ['Second'] }, ctx()).data;
  runtime.selectOption({ commercial_option_id: first.commercial_option_id }, ctx('staff'));
  const quote = runtime.createQuotation({ commercial_option_id: first.commercial_option_id, client_id: client.client_id, supplier_cost_total: '100.00', currency: 'PHP' }, ctx('manager')).data;
  makeQuotationApprovable(runtime, quote, ctx('staff'));
  const blocked = runtime.selectOption({ commercial_option_id: second.commercial_option_id }, ctx('staff'));
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'OPTION_REPLACEMENT_REQUIRES_CONFIRMATION');
  const replaced = runtime.selectOption({ commercial_option_id: second.commercial_option_id, confirm_replacement: true, replacement_reason: 'Client requested another hotel' }, ctx('staff'));
  assert.equal(replaced.ok, true);
  assert.equal(runtime.must('Quotation', quote.quotation_id).revision_required, true);
  assert.equal(runtime.list('OptionReplacement').length, 1);
});
