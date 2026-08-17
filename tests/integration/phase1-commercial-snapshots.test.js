'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhase1Runtime, ACTIONS } = require('../../src/phase1/runtime');

const AUTH = {
  staff: [ACTIONS.SELECT_OPTION, ACTIONS.EDIT_DRAFT_PRICING, ACTIONS.REVISE_QUOTATION, ACTIONS.ACCEPT_QUOTATION, ACTIONS.CLIENT_ACCEPT_AMENDMENT],
  manager: [ACTIONS.APPROVE_QUOTATION, ACTIONS.PRICE_OVERRIDE, ACTIONS.CONFIRM_COMMITMENT, ACTIONS.CLIENT_ACCEPT_AMENDMENT]
};

function ctx(actor) { return { actor: actor || 'staff', correlationId: 'INCREMENT-3-TEST' }; }

function setup() {
  const runtime = createPhase1Runtime({ clock: () => new Date('2026-08-15T10:00:00+08:00'), config: { trustedActors: AUTH } });
  const client = runtime.createClient({ display_name: 'Tokyo Client', legal_name: 'Tokyo Client' }, ctx()).data;
  const supplier = runtime.createSupplier({ display_name: 'Tokyo Supplier', legal_name: 'Tokyo Supplier', capabilities: ['DMC'] }, ctx()).data;
  const person = runtime.createPerson({ display_name: 'Lead Traveler', roles: ['TRAVELER'] }, ctx()).data;
  const inquiry = runtime.createInquiry({ client_id: client.client_id, requirements: { destination: 'Tokyo', travel_start: '2026-11-10', travel_end: '2026-11-14', nights: 4, pax_count: 3, adults: 2, children: 1, child_ages: [9], hotel: 'Tokyo Hotel' } }, ctx()).data;
  const option = runtime.createRecord('CommercialOption', { inquiry_id: inquiry.inquiry_id, supplier_id: supplier.supplier_id, state: 'SELECTED', selected: true, source_type: 'CUSTOM_ITINERARY', source_provenance: { source: 'staff-prepared', reference: 'TOKYO-CUSTOM-1' }, requirements_snapshot: inquiry.current_requirements }, ctx()).data;
  return { runtime, client, supplier, person, inquiry, option };
}

function createQuote(fixture, actor) {
  const { runtime, client, inquiry, option } = fixture;
  const quote = runtime.createQuotation({
    client_id: client.client_id,
    inquiry_id: inquiry.inquiry_id,
    commercial_option_id: option.commercial_option_id,
    destination: 'Tokyo',
    travel_start: '2026-11-10',
    travel_end: '2026-11-14',
    pax_count: 3,
    supplier_cost_total: '80000.00',
    currency: 'PHP',
    itinerary: [{ day: 1, city: 'Tokyo', activity: 'Arrival transfer' }],
    inclusions: ['Hotel', 'Transfer'],
    exclusions: ['Airfare'],
    payment_terms: '30% deposit, balance before departure',
    pricing_context_type: 'STANDARD'
  }, ctx(actor || 'manager'));
  assert.equal(quote.ok, true);
  const item = runtime.createQuotationItem({ quotation_id: quote.data.quotation_id, service_type: 'Hotel', description: 'Tokyo Hotel', supplier_id: fixture.supplier.supplier_id, quantity: 1, unit_cost: '80000.00', unit_selling_price: '100000.00', currency: 'PHP' }, ctx('staff'));
  assert.equal(item.ok, true);
  return quote.data;
}

function approveAndAccept(runtime, quotationId, acceptedBy) {
  assert.equal(runtime.approveQuotation({ quotation_id: quotationId }, ctx('manager')).ok, true);
  const acceptance = runtime.acceptQuotation({ quotation_id: quotationId, accepted_by: acceptedBy, acceptance_reference: 'CLIENT-EMAIL-1' }, ctx('staff'));
  assert.equal(acceptance.ok, true);
  return acceptance.data;
}

test('normal acceptance creates a complete immutable accepted-commercial and Booking snapshot', () => {
  const fixture = setup();
  const quote = createQuote(fixture);
  const acceptance = approveAndAccept(fixture.runtime, quote.quotation_id, fixture.client.client_id);
  const snapshot = acceptance.quote_snapshot;

  assert.equal(quote.commercial_version, 1);
  assert.equal(snapshot.quotation_id, quote.quotation_id);
  assert.equal(snapshot.commercial_version, 2);
  assert.equal(snapshot.commercial_option.commercial_option_id, fixture.option.commercial_option_id);
  assert.equal(snapshot.option_provenance.reference, 'TOKYO-CUSTOM-1');
  assert.equal(snapshot.supplier.supplier_id, fixture.supplier.supplier_id);
  assert.equal(snapshot.services[0].description, 'Tokyo Hotel');
  assert.equal(snapshot.destination, 'Tokyo');
  assert.equal(snapshot.travel_start, '2026-11-10');
  assert.equal(snapshot.travel_end, '2026-11-14');
  assert.deepEqual(snapshot.traveler_composition.child_ages, [9]);
  assert.equal(snapshot.itinerary[0].activity, 'Arrival transfer');
  const acceptedQuote = fixture.runtime.must('Quotation', quote.quotation_id);
  assert.equal(snapshot.pricing.client_price, acceptedQuote.client_total);
  assert.equal(snapshot.pricing.supplier_cost, acceptedQuote.supplier_cost_total);
  assert.equal(snapshot.pricing.markup, acceptedQuote.markup_total);
  assert.equal(snapshot.pricing.currency, 'PHP');
  assert.equal(snapshot.terms.payment_terms, '30% deposit, balance before departure');
  assert.equal(snapshot.requirements_snapshot.destination, 'Tokyo');
  assert.equal(snapshot.acceptance.accepted_by, fixture.client.client_id);

  const booking = fixture.runtime.createBooking({ quotation_id: quote.quotation_id, client_id: fixture.client.client_id, lead_pax_person_id: fixture.person.person_id }, ctx('staff'));
  assert.equal(booking.ok, true);
  assert.equal(booking.data.accepted_quotation_acceptance_id, acceptance.quotation_acceptance_id);
  assert.equal(booking.data.accepted_commercial_version, 2);
  assert.deepEqual(booking.data.accepted_commercial_snapshot, snapshot);
  assert.equal(booking.data.current_price, snapshot.pricing.client_price);
});

test('editing a draft produces a new commercial version and the accepted version is the one booked', () => {
  const fixture = setup();
  const quote = createQuote(fixture);
  const edited = fixture.runtime.updateQuotationPricing({ quotation_id: quote.quotation_id, markup_percent: '40', reason: 'Client requested upgraded room' }, ctx('staff'));
  assert.equal(edited.ok, true);
  assert.equal(edited.data.commercial_version, 3);
  const acceptance = approveAndAccept(fixture.runtime, quote.quotation_id, fixture.client.client_id);
  assert.equal(acceptance.accepted_version, 3);
  assert.equal(acceptance.quote_snapshot.commercial_version, 3);
  const booking = fixture.runtime.createBooking({ quotation_id: quote.quotation_id, lead_pax_person_id: fixture.person.person_id }, ctx('staff'));
  assert.equal(booking.data.accepted_commercial_version, 3);
  assert.equal(booking.data.accepted_commercial_snapshot.pricing.client_price, edited.data.client_total);
});

test('accepted snapshots remain unchanged and revised quotation acceptance is a separate decision', () => {
  const fixture = setup();
  const originalQuote = createQuote(fixture);
  const originalAcceptance = approveAndAccept(fixture.runtime, originalQuote.quotation_id, fixture.client.client_id);
  const originalSnapshot = JSON.parse(JSON.stringify(originalAcceptance.quote_snapshot));
  const originalBooking = fixture.runtime.createBooking({ quotation_id: originalQuote.quotation_id, lead_pax_person_id: fixture.person.person_id }, ctx('staff')).data;

  const revision = fixture.runtime.createQuotationRevision({ quotation_id: originalQuote.quotation_id, reason: 'Client changed travel requirements' }, ctx('staff'));
  assert.equal(revision.ok, true);
  assert.equal(revision.data.quotation.commercial_version, 3);
  assert.equal(revision.data.quotation.revision_of_quotation_id, originalQuote.quotation_id);
  assert.equal(revision.data.items.length, 1);
  const revisedQuote = fixture.runtime.updateQuotationPricing({ quotation_id: revision.data.quotation.quotation_id, markup_percent: '35', reason: 'Reprice revised itinerary' }, ctx('staff')).data;
  approveAndAccept(fixture.runtime, revisedQuote.quotation_id, fixture.client.client_id);
  const revisedBooking = fixture.runtime.createBooking({ quotation_id: revisedQuote.quotation_id, lead_pax_person_id: fixture.person.person_id }, ctx('staff'));
  assert.equal(revisedBooking.ok, true);
  assert.notEqual(revisedBooking.data.booking_id, originalBooking.booking_id);
  assert.equal(revisedBooking.data.accepted_quotation_id, revisedQuote.quotation_id);
  assert.equal(fixture.runtime.must('QuotationAcceptance', originalAcceptance.quotation_acceptance_id).quote_snapshot.commercial_version, originalSnapshot.commercial_version);
  assert.deepEqual(fixture.runtime.must('Booking', originalBooking.booking_id).accepted_commercial_snapshot, originalSnapshot);

  const duplicate = fixture.runtime.createBooking({ quotation_id: revisedQuote.quotation_id, lead_pax_person_id: fixture.person.person_id }, ctx('staff'));
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.meta.idempotent, true);
  assert.equal(fixture.runtime.list('Booking').length, 2);
});

test('requirements change cannot reuse old acceptance and requires a new quotation revision', () => {
  const fixture = setup();
  const quote = createQuote(fixture);
  const acceptance = approveAndAccept(fixture.runtime, quote.quotation_id, fixture.client.client_id);
  const oldBooking = fixture.runtime.createBooking({ quotation_id: quote.quotation_id, lead_pax_person_id: fixture.person.person_id }, ctx('staff')).data;
  assert.ok(oldBooking.booking_id);

  assert.equal(fixture.runtime.updateInquiry(fixture.inquiry.inquiry_id, { requirements: { destination: 'Kyoto', travel_start: '2026-12-01', travel_end: '2026-12-05', pax_count: 3, adults: 2, children: 1, child_ages: [9] } }, ctx('staff')).ok, true);
  const editOld = fixture.runtime.updateQuotationPricing({ quotation_id: quote.quotation_id, markup_percent: '50' }, ctx('staff'));
  assert.equal(editOld.ok, false);
  assert.equal(editOld.error.code, 'QUOTATION_REVISION_REQUIRED');
  const blockedOld = fixture.runtime.createBooking({ quotation_id: quote.quotation_id, lead_pax_person_id: fixture.person.person_id }, ctx('staff'));
  assert.equal(blockedOld.ok, false);
  assert.equal(blockedOld.error.code, 'QUOTATION_NOT_APPROVED');
  const revision = fixture.runtime.createQuotationRevision({ quotation_id: quote.quotation_id, reason: 'Requirements changed to Kyoto' }, ctx('staff'));
  assert.equal(revision.ok, true);
  assert.equal(revision.data.quotation.destination, 'Kyoto');
  assert.equal(revision.data.quotation.commercial_version, 3);
  const newAcceptance = approveAndAccept(fixture.runtime, revision.data.quotation.quotation_id, fixture.client.client_id);
  assert.notEqual(newAcceptance.quotation_acceptance_id, acceptance.quotation_acceptance_id);
  assert.equal(newAcceptance.accepted_version, 3);
});

test('amendment preserves the original accepted snapshot until reacceptance, then records a new accepted snapshot', () => {
  const fixture = setup();
  const quote = createQuote(fixture);
  approveAndAccept(fixture.runtime, quote.quotation_id, fixture.client.client_id);
  const booking = fixture.runtime.createBooking({ quotation_id: quote.quotation_id, lead_pax_person_id: fixture.person.person_id }, ctx('staff')).data;
  const originalSnapshot = JSON.parse(JSON.stringify(booking.accepted_commercial_snapshot));
  const amendment = fixture.runtime.amendBooking({ booking_id: booking.booking_id, changes: { current_price: '125000.00', travel_start: '2026-11-11' }, reason: 'Client requested date and price change' }, ctx('staff'));
  assert.equal(amendment.ok, true);
  assert.equal(amendment.data.amendment.state, 'REACCEPTANCE_REQUIRED');
  assert.deepEqual(fixture.runtime.must('Booking', booking.booking_id).accepted_commercial_snapshot, originalSnapshot);
  assert.deepEqual(amendment.data.amendment.accepted_snapshot_before, originalSnapshot);
  const accepted = fixture.runtime.acceptAmendment({ amendment_id: amendment.data.amendment.amendment_id, accepted_by: fixture.client.client_id }, ctx('manager'));
  assert.equal(accepted.ok, true);
  const updatedBooking = fixture.runtime.must('Booking', booking.booking_id);
  assert.notDeepEqual(updatedBooking.accepted_commercial_snapshot, originalSnapshot);
  assert.equal(updatedBooking.accepted_commercial_snapshot.pricing.client_price, '125000.00');
  assert.equal(updatedBooking.accepted_commercial_snapshot.travel_start, '2026-11-11');
  assert.equal(updatedBooking.accepted_amendment_id, amendment.data.amendment.amendment_id);
});
