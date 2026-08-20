'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createPhase1Runtime, ACTIONS } = require('../../src/phase1/runtime');
const { makeQuotationApprovable } = require('../helpers/quotation-contract');

const AUTH = {
  staff: [ACTIONS.SELECT_OPTION, ACTIONS.RESERVE_SUPPLIER, ACTIONS.ALLOCATE_PAYMENT, ACTIONS.ACCEPT_QUOTATION, ACTIONS.RECORD_TICKETING, ACTIONS.ISSUE_VOUCHER, ACTIONS.EDIT_DRAFT_PRICING],
  manager: [ACTIONS.APPROVE_QUOTATION, ACTIONS.PRICE_OVERRIDE, ACTIONS.CLIENT_ACCEPT_AMENDMENT, ACTIONS.RECONCILE_BOOKING]
};
const ctx = (actor) => ({ actor: actor || 'staff' });

function setup() {
  const runtime = createPhase1Runtime({ config: { trustedActors: AUTH }, clock: () => new Date('2026-08-14T10:00:00+08:00') });
  const client = runtime.createClient({ display_name: 'Phase 2C Client' }, ctx()).data;
  const supplier = runtime.createSupplier({ display_name: 'Phase 2C Supplier' }, ctx()).data;
  runtime.defaultLeadPaxPersonId = runtime.createPerson({ display_name: 'Phase 2C Lead Pax' }, ctx()).data.person_id;
  return { runtime, client, supplier };
}

function approvedTariff(runtime, supplier, extra) {
  const upload = runtime.uploadTariff(Object.assign({
    supplier_id: supplier.supplier_id,
    extraction_facts: [
      { field_name: 'currency', normalized_value: 'PHP', confidence: 1 },
      { field_name: 'rate_unit', normalized_value: 'PER_PERSON', confidence: 1 }
    ],
    rate_components: [{ amount: '100.00', currency: 'PHP', rate_unit: 'PER_PERSON', quantity_driver: 'pax_count', conditions: { destination: 'Bangkok', duration_days: 5 } }]
  }, extra || {}), ctx());
  assert.equal(upload.ok, true);
  assert.equal(runtime.reviewTariff({ tariff_source_id: upload.data.tariff_source_id, approve: true }, ctx()).ok, true);
  return upload.data;
}

test('normal matching is idempotent and Find More does not create orphan options', () => {
  const { runtime, client, supplier } = setup();
  const inquiry = runtime.createInquiry({ client_id: client.client_id, requirements: { destination: 'Bangkok', travel_start: '2026-11-01', travel_end: '2026-11-05', adults: 2 } }, ctx()).data;
  approvedTariff(runtime, supplier);

  const first = runtime.matchOptions({ inquiry_id: inquiry.inquiry_id }, ctx());
  const second = runtime.matchOptions({ inquiry_id: inquiry.inquiry_id }, ctx());
  assert.equal(first.data.candidates.length, 1);
  assert.equal(second.data.candidates.length, 1);
  assert.equal(second.data.candidates[0].commercial_option_id, first.data.candidates[0].commercial_option_id);
  assert.equal(runtime.list('CommercialOption').length, 1);

  const more = runtime.findMoreOptions({ inquiry_id: inquiry.inquiry_id, reason: 'NEED_MORE_CHOICES' }, ctx());
  assert.equal(more.ok, true);
  assert.equal(runtime.list('CommercialOption').length, 1);

  assert.equal(runtime.updateInquiry(inquiry.inquiry_id, { requirements: { destination: 'Bangkok', travel_start: '2026-11-01', travel_end: '2026-11-05', adults: 2, hotel_category: '4-star' } }, ctx()).ok, true);
  const changedRequirements = runtime.matchOptions({ inquiry_id: inquiry.inquiry_id }, ctx());
  assert.equal(changedRequirements.data.candidates.length, 1);
  assert.equal(runtime.list('CommercialOption').length, 2);
  assert.equal(changedRequirements.data.candidates[0].requirements_snapshot.hotel_category, '4-star');
});

test('failed tariff review leaves facts and rates unchanged', () => {
  const { runtime, supplier } = setup();
  const upload = runtime.uploadTariff({
    supplier_id: supplier.supplier_id,
    extraction_facts: [{ field_name: 'currency', normalized_value: 'USD', confidence: 0.4, ambiguous: true }],
    rate_components: [{ amount: '100.00', currency: 'USD', rate_unit: 'PER_PERSON', requires_explicit_review: true }]
  }, ctx()).data;
  const factBefore = runtime.list('TariffExtractionFact')[0];
  const rateBefore = runtime.list('TariffRateComponent')[0];

  const failed = runtime.reviewTariff({
    tariff_source_id: upload.tariff_source_id,
    approve: true,
    corrections: { [factBefore.tariff_extraction_fact_id]: { normalized_value: 'PHP', confidence: 1 } }
  }, ctx());

  assert.equal(failed.ok, false);
  assert.equal(runtime.must('TariffExtractionFact', factBefore.tariff_extraction_fact_id).normalized_value, factBefore.normalized_value);
  assert.equal(runtime.must('TariffExtractionFact', factBefore.tariff_extraction_fact_id).review_status, factBefore.review_status);
  assert.equal(runtime.must('TariffRateComponent', rateBefore.tariff_rate_component_id).requires_explicit_review, true);
  assert.equal(runtime.must('TariffSource', upload.tariff_source_id).trusted, false);
});

test('Inquiry changes invalidate quotation approval and Booking commitment', () => {
  const { runtime, client } = setup();
  const inquiry = runtime.createInquiry({ client_id: client.client_id, requirements: { destination: 'Bangkok', travel_start: '2026-11-01', travel_end: '2026-11-05', adults: 2 } }, ctx()).data;
  const quote = runtime.createQuotation({ inquiry_id: inquiry.inquiry_id, client_id: client.client_id, supplier_cost_total: '100.00', currency: 'PHP' }, ctx()).data;
  assert.equal(makeQuotationApprovable(runtime, quote, ctx('staff')).ok, true);
  assert.equal(runtime.approveQuotation({ quotation_id: quote.quotation_id }, ctx('manager')).ok, true);
  assert.equal(runtime.acceptQuotation({ quotation_id: quote.quotation_id, accepted_by: client.client_id }, ctx()).ok, true);
  const booking = runtime.createBooking({ quotation_id: quote.quotation_id, lead_pax_person_id: runtime.defaultLeadPaxPersonId }, ctx()).data;

  assert.equal(runtime.updateInquiry(inquiry.inquiry_id, { requirements: { destination: 'Phuket', travel_start: '2026-12-01', travel_end: '2026-12-08', adults: 2 } }, ctx()).ok, true);
  const updatedQuote = runtime.must('Quotation', quote.quotation_id);
  const updatedBooking = runtime.must('Booking', booking.booking_id);
  assert.equal(updatedQuote.status, 'DRAFT');
  assert.equal(updatedQuote.revision_required, true);
  assert.equal(updatedBooking.commitment_state, 'REACCEPTANCE_REQUIRED');
  assert.equal(updatedBooking.client_decision_state, 'CHANGED_REQUIREMENTS_REQUIRES_REACCEPTANCE');
  const reapproval = runtime.approveQuotation({ quotation_id: quote.quotation_id }, ctx('manager'));
  assert.equal(reapproval.ok, false);
  assert.equal(reapproval.error.code, 'QUOTATION_REVISION_REQUIRED');
});

test('Bookings require exactly one selected lead passenger', () => {
  const { runtime, client } = setup();
  const quote = runtime.createQuotation({ client_id: client.client_id, supplier_cost_total: '100.00', currency: 'PHP' }, ctx()).data;
  assert.equal(makeQuotationApprovable(runtime, quote, ctx('staff')).ok, true);
  runtime.approveQuotation({ quotation_id: quote.quotation_id }, ctx('manager'));
  runtime.acceptQuotation({ quotation_id: quote.quotation_id, accepted_by: client.client_id }, ctx());
  const missing = runtime.createBooking({ quotation_id: quote.quotation_id }, ctx());
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'REQUIRED_FIELD');
  const invalid = runtime.createBooking({ quotation_id: quote.quotation_id, lead_pax_person_id: 'PERSON-MISSING' }, ctx());
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'NOT_FOUND');
  const booking = runtime.createBooking({ quotation_id: quote.quotation_id, lead_pax_person_id: runtime.defaultLeadPaxPersonId }, ctx()).data;
  const participants = runtime.list('BookingParticipant', (item) => item.booking_id === booking.booking_id);
  assert.equal(participants.length, 1);
  assert.equal(participants[0].role, 'LEAD_PAX');
  const retryWithoutLeadPax = runtime.createBooking({ quotation_id: quote.quotation_id }, ctx());
  assert.equal(retryWithoutLeadPax.ok, true);
  assert.equal(retryWithoutLeadPax.meta.idempotent, true);
  const otherPerson = runtime.createPerson({ display_name: 'Second Pax' }, ctx()).data;
  const secondLead = runtime.createBookingParticipant({ booking_id: booking.booking_id, person_id: otherPerson.person_id, role: 'LEAD_PAX' }, ctx());
  assert.equal(secondLead.ok, false);
  assert.equal(secondLead.error.code, 'LEAD_PAX_ALREADY_ASSIGNED');
});

test('agency workflow controls cover acceptance, holds, fulfillment, schedules, amendments, readiness, and reconciliation', () => {
  const { runtime, client, supplier } = setup();
  const quote = runtime.createQuotation({ client_id: client.client_id, supplier_cost_total: '100.00', currency: 'PHP' }, ctx()).data;
  assert.equal(makeQuotationApprovable(runtime, quote, ctx('staff')).ok, true);
  assert.equal(runtime.approveQuotation({ quotation_id: quote.quotation_id }, ctx('manager')).ok, true);
  assert.equal(runtime.acceptQuotation({ quotation_id: quote.quotation_id, accepted_by: client.client_id }, ctx()).ok, true);
  const booking = runtime.createBooking({ quotation_id: quote.quotation_id, lead_pax_person_id: runtime.defaultLeadPaxPersonId }, ctx()).data;
  const item = runtime.createBookingItem({ booking_id: booking.booking_id, supplier_id: supplier.supplier_id, service_type: 'AIR', description: 'Flight sector', supplier_cost: '50.00', selling_price: '100.00', currency: 'PHP' }, ctx()).data;

  const expiredHold = runtime.createAvailabilityHold({ booking_item_id: item.booking_item_id, supplier_id: supplier.supplier_id, expires_at: '2026-08-13T10:00:00.000Z' }, ctx());
  assert.equal(expiredHold.ok, false);
  assert.equal(expiredHold.error.code, 'HOLD_EXPIRY_PAST');
  const hold = runtime.createAvailabilityHold({ booking_item_id: item.booking_item_id, supplier_id: supplier.supplier_id, expires_at: '2026-08-15T10:00:00.000Z', supplier_reference: 'HOLD-1' }, ctx());
  assert.equal(hold.ok, true);
  assert.equal(runtime.updateAvailabilityHold({ availability_hold_id: hold.data.availability_hold_id, state: 'CONFIRMED', supplier_reference: 'CONF-1' }, ctx()).ok, true);
  assert.equal(runtime.must('BookingItem', item.booking_item_id).fulfillment_state, 'CONFIRMED');

  const held = runtime.recordTicketing({ booking_item_id: item.booking_item_id, status: 'HELD', pnr: 'PNR1', ticketing_deadline: '2026-08-15T12:00:00.000Z', idempotency_key: 'ticket-1' }, ctx());
  assert.equal(held.ok, true);
  const ticketed = runtime.recordTicketing({ booking_item_id: item.booking_item_id, status: 'TICKETED', pnr: 'PNR1', ticket_number: '1234567890', idempotency_key: 'ticket-2' }, ctx());
  assert.equal(ticketed.ok, true);
  assert.equal(runtime.must('BookingItem', item.booking_item_id).fulfillment_state, 'TICKETED');
  assert.equal(runtime.issueVoucher({ booking_item_id: item.booking_item_id, voucher_number: 'VCH-1' }, ctx()).ok, true);

  const schedule = runtime.createPaymentScheduleItem({ booking_id: booking.booking_id, sequence: 1, purpose: 'DOWN_PAYMENT', amount: '50.00', currency: 'PHP', due_at: '2026-08-20T10:00:00.000Z' }, ctx());
  assert.equal(schedule.ok, true);
  assert.equal(runtime.createPaymentScheduleItem({ booking_id: booking.booking_id, sequence: 1, purpose: 'DOWN_PAYMENT', amount: '50.00', currency: 'PHP', due_at: '2026-08-20T10:00:00.000Z' }, ctx()).meta.idempotent, true);
  assert.equal(runtime.createRoomingListEntry({ booking_id: booking.booking_id, person_id: runtime.defaultLeadPaxPersonId, room_label: 'Room 101', occupancy: 'Twin' }, ctx()).ok, true);

  const amendment = runtime.amendBooking({ booking_id: booking.booking_id, changes: { current_price: '120.00' }, reason: 'Client selected a revised flight.' }, ctx());
  assert.equal(amendment.ok, true);
  assert.equal(runtime.acceptAmendment({ amendment_id: amendment.data.amendment.amendment_id, accepted_by: client.client_id }, ctx('manager')).ok, true);

  const departure = runtime.createDeparture({ name: 'Bangkok November Group', destination: 'Bangkok', start_date: '2026-11-01', end_date: '2026-11-05' }, ctx()).data;
  assert.equal(runtime.addDepartureMembership({ departure_id: departure.departure_id, booking_item_id: item.booking_item_id }, ctx()).ok, true);
  const issue = runtime.createDepartureReadinessIssue({ departure_id: departure.departure_id, severity: 'HIGH', description: 'Supplier confirmation pending.' }, ctx());
  assert.equal(issue.ok, true);
  assert.equal(runtime.updateDepartureReadinessIssue({ departure_readiness_issue_id: issue.data.departure_readiness_issue_id, state: 'RESOLVED', resolution: 'Confirmation received.' }, ctx()).ok, true);

  const reconciliation = runtime.reconcileBooking({ booking_id: booking.booking_id, idempotency_key: 'reconcile-1' }, ctx('manager'));
  assert.equal(reconciliation.ok, true);
  assert.equal(reconciliation.data.state, 'REVIEW_REQUIRED');
  assert.equal(reconciliation.data.snapshot.client_price, '120.00');
});

test('rooming groups enforce SGL, TWN, DBL, TRP, and QUAD capacities', () => {
  const { runtime, client } = setup();
  const inquiry = runtime.createInquiry({ client_id: client.client_id, requirements: { destination: 'Tokyo', travel_start: '2026-11-01', travel_end: '2026-11-05', adults: 1 } }, ctx()).data;
  const quote = runtime.createQuotation({ client_id: client.client_id, inquiry_id: inquiry.inquiry_id, destination: 'Tokyo', supplier_cost_total: '100.00', currency: 'PHP' }, ctx()).data;
  assert.equal(makeQuotationApprovable(runtime, quote, ctx()).ok, true);
  assert.equal(runtime.approveQuotation({ quotation_id: quote.quotation_id }, ctx('manager')).ok, true);
  assert.equal(runtime.acceptQuotation({ quotation_id: quote.quotation_id, accepted_by: client.client_id }, ctx()).ok, true);
  const lead = runtime.createPerson({ display_name: 'Rooming lead' }, ctx()).data;
  const booking = runtime.createBooking({ quotation_id: quote.quotation_id, client_id: client.client_id, lead_pax_person_id: lead.person_id }, ctx()).data;
  const people = [lead];
  for (let index = 1; index < 22; index += 1) {
    const person = runtime.createPerson({ display_name: 'Rooming traveler ' + index }, ctx()).data;
    assert.equal(runtime.createBookingParticipant({ booking_id: booking.booking_id, person_id: person.person_id, roles: ['TRAVELER'] }, ctx()).ok, true);
    people.push(person);
  }
  let cursor = 0;
  const addGroup = (occupancy, capacity) => {
    for (let index = 0; index < capacity; index += 1) {
      assert.equal(runtime.createRoomingListEntry({ booking_id: booking.booking_id, person_id: people[cursor++].person_id, room_label: occupancy + ' group', occupancy }, ctx()).ok, true);
    }
    const rejected = runtime.createRoomingListEntry({ booking_id: booking.booking_id, person_id: people[cursor++].person_id, room_label: occupancy + ' group', occupancy }, ctx());
    assert.equal(rejected.error.code, 'ROOMING_CAPACITY_EXCEEDED');
  };
  addGroup('SGL', 1);
  addGroup('TWN', 2);
  addGroup('DBL', 2);
  addGroup('TRP', 3);
  addGroup('QUAD', 4);
  const mixed = runtime.createRoomingListEntry({ booking_id: booking.booking_id, person_id: people[0].person_id, room_label: 'Mixed group', occupancy: 'TWN' }, ctx());
  assert.equal(mixed.ok, true);
  const mismatch = runtime.createRoomingListEntry({ booking_id: booking.booking_id, person_id: people[1].person_id, room_label: 'Mixed group', occupancy: 'TRP' }, ctx());
  assert.equal(mismatch.error.code, 'ROOMING_GROUP_OCCUPANCY_MISMATCH');
});

test('rooming list entries can be edited, confirmed, and re-grouped under the same rules', () => {
  const { runtime, client } = setup();
  const inquiry = runtime.createInquiry({ client_id: client.client_id, requirements: { destination: 'Tokyo', travel_start: '2026-11-01', travel_end: '2026-11-05', adults: 1 } }, ctx()).data;
  const quote = runtime.createQuotation({ client_id: client.client_id, inquiry_id: inquiry.inquiry_id, destination: 'Tokyo', supplier_cost_total: '100.00', currency: 'PHP' }, ctx()).data;
  assert.equal(makeQuotationApprovable(runtime, quote, ctx()).ok, true);
  assert.equal(runtime.approveQuotation({ quotation_id: quote.quotation_id }, ctx('manager')).ok, true);
  assert.equal(runtime.acceptQuotation({ quotation_id: quote.quotation_id, accepted_by: client.client_id }, ctx()).ok, true);
  const lead = runtime.createPerson({ display_name: 'Edit lead' }, ctx()).data;
  const booking = runtime.createBooking({ quotation_id: quote.quotation_id, client_id: client.client_id, lead_pax_person_id: lead.person_id }, ctx()).data;
  const second = runtime.createPerson({ display_name: 'Edit second' }, ctx()).data;
  const third = runtime.createPerson({ display_name: 'Edit third' }, ctx()).data;
  [second, third].forEach((person) => assert.equal(runtime.createBookingParticipant({ booking_id: booking.booking_id, person_id: person.person_id, roles: ['TRAVELER'] }, ctx()).ok, true));
  const entryA = runtime.createRoomingListEntry({ booking_id: booking.booking_id, person_id: lead.person_id, room_label: 'A', occupancy: 'TWN' }, ctx()).data;
  const entryB = runtime.createRoomingListEntry({ booking_id: booking.booking_id, person_id: second.person_id, room_label: 'A', occupancy: 'TWN' }, ctx()).data;
  const mismatchOnEdit = runtime.updateRoomingListEntry({ rooming_list_entry_id: entryB.rooming_list_entry_id, occupancy: 'TRP' }, ctx());
  assert.equal(mismatchOnEdit.error.code, 'ROOMING_GROUP_OCCUPANCY_MISMATCH');
  const confirmed = runtime.updateRoomingListEntry({ rooming_list_entry_id: entryA.rooming_list_entry_id, state: 'CONFIRMED' }, ctx());
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.data.state, 'CONFIRMED');
  const renamed = runtime.updateRoomingListEntry({ rooming_list_entry_id: entryA.rooming_list_entry_id, room_label: 'B' }, ctx());
  assert.equal(renamed.ok, true);
  assert.equal(renamed.data.room_label, 'B');
  const invalidState = runtime.updateRoomingListEntry({ rooming_list_entry_id: entryA.rooming_list_entry_id, state: 'PAID' }, ctx());
  assert.equal(invalidState.error.code, 'INVALID_ROOMING_STATE');
  const entryC = runtime.createRoomingListEntry({ booking_id: booking.booking_id, person_id: third.person_id, room_label: 'B', occupancy: 'TWN' }, ctx());
  assert.equal(entryC.ok, true);
  const capacityOnEdit = runtime.updateRoomingListEntry({ rooming_list_entry_id: entryB.rooming_list_entry_id, room_label: 'B' }, ctx());
  assert.equal(capacityOnEdit.error.code, 'ROOMING_CAPACITY_EXCEEDED');
  const cancelled = runtime.updateRoomingListEntry({ rooming_list_entry_id: entryC.data.rooming_list_entry_id, state: 'CANCELLED' }, ctx());
  assert.equal(cancelled.ok, true);
  const afterCancel = runtime.updateRoomingListEntry({ rooming_list_entry_id: entryB.rooming_list_entry_id, room_label: 'B' }, ctx());
  assert.equal(afterCancel.ok, true);
});

test('Booking Items, Supplier Bookings, and Supplier Payables validate relationships and money', () => {
  const { runtime, client, supplier } = setup();
  const otherSupplier = runtime.createSupplier({ display_name: 'Other Supplier' }, ctx()).data;
  const quote = runtime.createQuotation({ client_id: client.client_id, supplier_cost_total: '100.00', currency: 'PHP' }, ctx()).data;
  assert.equal(makeQuotationApprovable(runtime, quote, ctx('staff')).ok, true);
  runtime.approveQuotation({ quotation_id: quote.quotation_id }, ctx('manager'));
  runtime.acceptQuotation({ quotation_id: quote.quotation_id, accepted_by: client.client_id }, ctx());
  const booking = runtime.createBooking({ quotation_id: quote.quotation_id, lead_pax_person_id: runtime.defaultLeadPaxPersonId }, ctx()).data;

  const invalidItem = runtime.createBookingItem({ booking_id: booking.booking_id, supplier_id: 'SUPPLIER-MISSING', supplier_cost: 'not-money', selling_price: '-1.00', currency: 'BAD' }, ctx());
  assert.equal(invalidItem.ok, false);
  assert.equal(runtime.list('BookingItem').length, 0);

  const item = runtime.createBookingItem({ booking_id: booking.booking_id, supplier_id: supplier.supplier_id, service_type: 'PACKAGE', supplier_cost: '50.00', selling_price: '100.00', currency: 'PHP' }, ctx()).data;
  const invalidSupplierBooking = runtime.createSupplierBooking({ booking_id: booking.booking_id, supplier_id: supplier.supplier_id, booking_item_ids: ['BOOKING_ITEM-MISSING'] }, ctx());
  assert.equal(invalidSupplierBooking.ok, false);
  assert.equal(runtime.list('SupplierBooking').length, 0);

  const supplierBooking = runtime.createSupplierBooking({ booking_id: booking.booking_id, supplier_id: supplier.supplier_id, booking_item_ids: [item.booking_item_id] }, ctx()).data;
  const supplierBookingRetry = runtime.createSupplierBooking({ booking_id: booking.booking_id, supplier_id: supplier.supplier_id, booking_item_ids: [item.booking_item_id] }, ctx());
  assert.equal(supplierBookingRetry.ok, true);
  assert.equal(supplierBookingRetry.meta.idempotent, true);
  assert.equal(runtime.list('SupplierBooking').length, 1);
  const mismatchedPayable = runtime.createSupplierPayable({ supplier_booking_id: supplierBooking.supplier_booking_id, booking_id: 'BOOKING-MISSING', amount: 'not-money', currency: 'BAD' }, ctx());
  assert.equal(mismatchedPayable.ok, false);
  assert.equal(runtime.list('SupplierPayable').length, 0);

  const wrongSupplierItem = runtime.createBookingItem({ booking_id: booking.booking_id, supplier_id: otherSupplier.supplier_id, service_type: 'TRANSFER', supplier_cost: '10.00', selling_price: '20.00', currency: 'PHP' }).data;
  const mismatchedSupplier = runtime.createSupplierBooking({ booking_id: booking.booking_id, supplier_id: supplier.supplier_id, booking_item_ids: [wrongSupplierItem.booking_item_id] }, ctx());
  assert.equal(mismatchedSupplier.ok, false);
  assert.equal(runtime.list('SupplierBooking').length, 1);
});

test('manual selected-option cost overrides require explicit authorization', () => {
  const { runtime, client } = setup();
  const inquiry = runtime.createInquiry({ client_id: client.client_id, requirements: { destination: 'Bangkok', travel_start: '2026-11-01', travel_end: '2026-11-05', adults: 2 } }, ctx()).data;
  const option = runtime.createRecord('CommercialOption', { inquiry_id: inquiry.inquiry_id, state: 'MATCHED', selected: false }, ctx()).data;
  assert.equal(runtime.selectOption({ commercial_option_id: option.commercial_option_id }, ctx()).ok, true);
  const blocked = runtime.createQuotation({ commercial_option_id: option.commercial_option_id, client_id: client.client_id, supplier_cost_total: '100.00', currency: 'PHP' }, ctx());
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'AUTHORIZATION_REQUIRED');
  const allowed = runtime.createQuotation({ commercial_option_id: option.commercial_option_id, client_id: client.client_id, supplier_cost_total: '100.00', currency: 'PHP' }, ctx('manager'));
  assert.equal(allowed.ok, true);
});

test('Operations UI sends an idempotency key for allocation retries', () => {
  const source = fs.readFileSync('app/public/operations.js', 'utf8');
  assert.match(source, /api\('allocatePayment', \{ client_payment_id: payment\.client_payment_id, idempotency_key:/);
});

test('Operations UI sends an idempotency key for Supplier Payment retries', () => {
  const source = fs.readFileSync('app/public/operations.js', 'utf8');
  assert.match(source, /api\('executeSupplierPayment', \{ supplier_payable_id: records\.payable\.supplier_payable_id, amount: records\.payable\.amount, idempotency_key:/);
});

test('Operations detail actions render when already on the same workspace tab', () => {
  const source = fs.readFileSync('app/public/operations.js', 'utf8');
  assert.match(source, /function openSupplierRecord[\s\S]*?currentTab\(\) === 'suppliers'\) render\(\)/);
  assert.match(source, /function openInquiries\([\s\S]*?currentTab\(\) === 'inquiry'\) render\(\)/);
  assert.match(source, /function openQuotationRecord[\s\S]*?currentTab\(\) === 'quotation'\) render\(\)/);
  assert.match(source, /function openBookingRecord[\s\S]*?currentTab\(\) === 'booking'\) render\(\)/);
  assert.match(source, /function openDepartureRecord[\s\S]*?currentTab\(\) === 'departures'\) render\(\)/);
  assert.match(source, /function createResearchFollowUp\([\s\S]*?idempotency_key/);
  assert.match(source, /Final balance payment/);
  assert.match(source, /function bookingLeadPaxName\(/);
  assert.match(source, /<th>Lead pax<\/th>/);
  assert.doesNotMatch(source, /<th>Departure \/ group<\/th>/);
  assert.doesNotMatch(source, /<h3>Payment intent<\/h3>/);
});

test('repeated synthetic vertical slices preserve workflow counts and retry safety', () => {
  const auth = {
    staff: [ACTIONS.SELECT_OPTION, ACTIONS.RESERVE_SUPPLIER, ACTIONS.ALLOCATE_PAYMENT, ACTIONS.ACCEPT_QUOTATION, ACTIONS.EDIT_DRAFT_PRICING],
    manager: [ACTIONS.APPROVE_QUOTATION, ACTIONS.VERIFY_PAYMENT, ACTIONS.APPROVE_PAYABLE, ACTIONS.SUPPLIER_PAYMENT]
  };
  const runtime = createPhase1Runtime({ config: { trustedActors: auth }, clock: () => new Date('2026-08-14T10:00:00+08:00') });
  const totalCases = 20;
  for (let index = 0; index < totalCases; index += 1) {
    const client = runtime.createClient({ display_name: 'Stress Client ' + index }, ctx()).data;
    const supplier = runtime.createSupplier({ display_name: 'Stress Supplier ' + index }, ctx()).data;
    const leadPaxPersonId = runtime.createPerson({ display_name: 'Stress Lead Pax ' + index }, ctx()).data.person_id;
    const destination = 'Stress City ' + index;
    const inquiry = runtime.createInquiry({ client_id: client.client_id, requirements: { destination, travel_start: '2026-11-01', travel_end: '2026-11-05', adults: 2 } }, ctx()).data;
    const tariff = runtime.uploadTariff({ supplier_id: supplier.supplier_id, extraction_facts: [{ field_name: 'currency', normalized_value: 'PHP', confidence: 1 }, { field_name: 'rate_unit', normalized_value: 'PER_PERSON', confidence: 1 }], rate_components: [{ amount: '100.00', currency: 'PHP', rate_unit: 'PER_PERSON', quantity_driver: 'pax_count', conditions: { destination, duration_days: 5 } }] }, ctx()).data;
    assert.equal(runtime.reviewTariff({ tariff_source_id: tariff.tariff_source_id, approve: true }, ctx()).ok, true);
    const match = runtime.matchOptions({ inquiry_id: inquiry.inquiry_id }, ctx());
    const retryMatch = runtime.matchOptions({ inquiry_id: inquiry.inquiry_id }, ctx());
    assert.equal(match.data.candidates.length, 1);
    assert.equal(retryMatch.data.candidates[0].commercial_option_id, match.data.candidates[0].commercial_option_id);
    const option = match.data.candidates[0];
    assert.equal(runtime.selectOption({ commercial_option_id: option.commercial_option_id }, ctx()).ok, true);
    const quote = runtime.createQuotation({ commercial_option_id: option.commercial_option_id, client_id: client.client_id }, ctx()).data;
    assert.equal(makeQuotationApprovable(runtime, quote, ctx('staff')).ok, true);
    assert.equal(runtime.approveQuotation({ quotation_id: quote.quotation_id }, ctx('manager')).ok, true);
    assert.equal(runtime.acceptQuotation({ quotation_id: quote.quotation_id, accepted_by: client.client_id }, ctx()).ok, true);
    const booking = runtime.createBooking({ quotation_id: quote.quotation_id, lead_pax_person_id: leadPaxPersonId }, ctx()).data;
    const item = runtime.createBookingItem({ booking_id: booking.booking_id, supplier_id: supplier.supplier_id, service_type: 'PACKAGE', supplier_cost: '100.00', selling_price: '260.00', currency: 'PHP' }, ctx()).data;
    const supplierBooking = runtime.createSupplierBooking({ booking_id: booking.booking_id, supplier_id: supplier.supplier_id, booking_item_ids: [item.booking_item_id] }, ctx()).data;
    const supplierBookingRetry = runtime.createSupplierBooking({ booking_id: booking.booking_id, supplier_id: supplier.supplier_id, booking_item_ids: [item.booking_item_id] }, ctx());
    assert.equal(supplierBookingRetry.data.supplier_booking_id, supplierBooking.supplier_booking_id);
    const payable = runtime.createSupplierPayable({ supplier_booking_id: supplierBooking.supplier_booking_id, booking_id: booking.booking_id, amount: '100.00', currency: 'PHP' }, ctx()).data;
    assert.equal(runtime.approveSupplierPayable({ supplier_payable_id: payable.supplier_payable_id }, ctx('manager')).ok, true);
    const paymentOne = runtime.recordClientPayment({ booking_id: booking.booking_id, client_id: client.client_id, amount: '50.00', currency: 'PHP', proof_reference: 'stress-' + index + '-one', payment_purpose: 'PARTIAL_PAYMENT' }, ctx()).data.payment;
    const paymentTwo = runtime.recordClientPayment({ booking_id: booking.booking_id, client_id: client.client_id, amount: '50.00', currency: 'PHP', proof_reference: 'stress-' + index + '-two', payment_purpose: 'PARTIAL_PAYMENT' }, ctx()).data.payment;
    [paymentOne, paymentTwo].forEach((payment, paymentIndex) => {
      assert.equal(runtime.verifyClientPayment({ client_payment_id: payment.client_payment_id }, ctx('manager')).ok, true);
      assert.equal(runtime.allocatePayment({ client_payment_id: payment.client_payment_id, idempotency_key: 'stress-allocation-' + index + '-' + paymentIndex, allocations: [{ booking_id: booking.booking_id, amount: '50.00' }] }, ctx()).ok, true);
    });
    const supplierPayment = runtime.executeSupplierPayment({ supplier_payable_id: payable.supplier_payable_id, amount: '100.00', idempotency_key: 'stress-supplier-payment-' + index }, ctx('manager'));
    assert.equal(supplierPayment.ok, true);
    assert.equal(runtime.executeSupplierPayment({ supplier_payable_id: payable.supplier_payable_id, amount: '100.00', idempotency_key: 'stress-supplier-payment-' + index }, ctx('manager')).meta.idempotent, true);
  }
  assert.equal(runtime.list('Inquiry').length, totalCases);
  assert.equal(runtime.list('CommercialOption').length, totalCases);
  assert.equal(runtime.list('Quotation').length, totalCases);
  assert.equal(runtime.list('Booking').length, totalCases);
  assert.equal(runtime.list('SupplierBooking').length, totalCases);
  assert.equal(runtime.list('ClientPayment').length, totalCases * 2);
  assert.equal(runtime.list('SupplierPayment').length, totalCases);
});
