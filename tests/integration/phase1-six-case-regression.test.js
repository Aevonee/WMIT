'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhase1Runtime, ACTIONS } = require('../../src/phase1/runtime');
const { makeQuotationApprovable } = require('../helpers/quotation-contract');

const authority = { staff: [ACTIONS.SELECT_OPTION, ACTIONS.RESERVE_SUPPLIER, ACTIONS.ALLOCATE_PAYMENT, ACTIONS.ACCEPT_QUOTATION, ACTIONS.EDIT_DRAFT_PRICING], manager: [ACTIONS.APPROVE_QUOTATION, ACTIONS.VERIFY_PAYMENT, ACTIONS.APPROVE_PAYABLE, ACTIONS.SUPPLIER_PAYMENT, ACTIONS.REFUND] };
function runtime() { return createPhase1Runtime({ clock: () => new Date('2026-08-13T10:00:00+08:00'), config: { trustedActors: authority } }); }
function base(r, suffix) {
  const client = r.createClient({ display_name: 'Case ' + suffix, legal_name: 'Case ' + suffix }).data;
  const supplier = r.createSupplier({ display_name: 'Supplier ' + suffix, legal_name: 'Supplier ' + suffix, capabilities: ['DMC'] }).data;
  r.defaultLeadPaxPersonId = r.createPerson({ display_name: 'Lead Pax ' + suffix }).data.person_id;
  const inquiry = r.createInquiry({ client_id: client.client_id, source: 'TEST', requirements: { destination: 'Bangkok', travel_start: '2026-10-01', travel_end: '2026-10-05', nights: 4, pax_count: 2 } }).data;
  return { client, supplier, inquiry };
}
function approvedQuote(r, client, cost) {
  const quote = r.createQuotation({ client_id: client.client_id, supplier_cost_total: cost || '10000.00' }, { actor: 'staff' }).data;
  makeQuotationApprovable(r, quote, { actor: 'staff' });
  r.approveQuotation({ quotation_id: quote.quotation_id }, { actor: 'manager' });
  r.acceptQuotation({ quotation_id: quote.quotation_id, accepted_by: client.client_id }, { actor: 'staff' });
  return quote;
}

test('six-case regression: changed date to wholesaler package', () => {
  const r = runtime(); const { client, inquiry, supplier } = base(r, '1');
  r.createSupplierPackage({ supplier_id: supplier.supplier_id, destination: 'Bangkok', availability_state: 'AVAILABLE', product_name: 'Wholesaler package', source_provenance: { source: 'synthetic' } });
  const match = r.matchOptions({ inquiry_id: inquiry.inquiry_id }, { actor: 'staff' });
  assert.equal(match.data.candidates.length, 1);
  const changed = r.updateInquiry(inquiry.inquiry_id, { requirements: { destination: 'Bangkok', travel_start: '2026-10-01', nights: 4, pax_count: 2 } }, { actor: 'staff' });
  assert.equal(changed.ok, true); assert.equal(changed.data.original_request.destination, 'Bangkok'); assert.ok(changed.data.history.length > 1); assert.ok(client.client_id);
});

test('six-case regression: private DMC tariff plus airfare has multiple source options', () => {
  const r = runtime(); const { supplier, inquiry } = base(r, '2');
  const supplier2 = r.createSupplier({ display_name: 'Air Source 2', legal_name: 'Air Source 2', capabilities: ['AIRFARE'] }).data;
  for (const [owner, amount] of [[supplier, '10000.00'], [supplier2, '12000.00']]) {
    const upload = r.uploadTariff({ supplier_id: owner.supplier_id, file_name: owner.display_name + '.pdf', extraction_facts: [{ field_name: 'destination', normalized_value: 'Bangkok', confidence: 1 }], rate_components: [{ amount, currency: 'PHP', rate_unit: 'PER_PERSON', quantity_driver: 'pax_count', conditions: { destination: 'Bangkok', pax_min: 2 } }] }, { actor: 'staff' });
    r.reviewTariff({ tariff_source_id: upload.data.tariff_source_id, approve: true }, { actor: 'staff' });
  }
  const result = r.matchOptions({ inquiry_id: inquiry.inquiry_id }, { actor: 'staff' });
  assert.equal(result.data.candidates.length, 2); assert.ok(result.data.candidates.every((x) => x.source_provenance === null || x.source_provenance));
});

test('six-case regression: coordinator, payer, and travelers remain separate roles', () => {
  const r = runtime(); const { client } = base(r, '3');
  const coordinator = r.createPerson({ display_name: 'Coordinator' }).data; const payer = r.createPerson({ display_name: 'Payer' }).data; const traveler = r.createPerson({ display_name: 'Traveler' }).data;
  const quote = approvedQuote(r, client, '5000.00'); const booking = r.createBooking({ quotation_id: quote.quotation_id, client_id: client.client_id, lead_pax_person_id: r.defaultLeadPaxPersonId }, { actor: 'staff' }).data;
  r.createBookingParticipant({ booking_id: booking.booking_id, person_id: coordinator.person_id, roles: ['COORDINATOR'] }); r.createBookingParticipant({ booking_id: booking.booking_id, person_id: payer.person_id, roles: ['PAYER'] }); r.createBookingParticipant({ booking_id: booking.booking_id, person_id: traveler.person_id, roles: ['TRAVELER'] });
  assert.equal(r.list('BookingParticipant').length, 4);
});

test('six-case regression: multi-supplier Booking keeps item fulfillment separate', () => {
  const r = runtime(); const { client, supplier } = base(r, '4'); const supplier2 = r.createSupplier({ display_name: 'Supplier 4B', legal_name: 'Supplier 4B' }).data;
  const quote = approvedQuote(r, client, '10000.00'); const booking = r.createBooking({ quotation_id: quote.quotation_id, client_id: client.client_id, lead_pax_person_id: r.defaultLeadPaxPersonId }, { actor: 'staff' }).data;
  const item1 = r.createBookingItem({ booking_id: booking.booking_id, supplier_id: supplier.supplier_id, service_type: 'HOTEL', description: 'Hotel', supplier_cost: '5000.00', selling_price: '6500.00', currency: 'PHP' }).data;
  const item2 = r.createBookingItem({ booking_id: booking.booking_id, supplier_id: supplier2.supplier_id, service_type: 'TRANSFER', description: 'Transfer', supplier_cost: '1000.00', selling_price: '1300.00', currency: 'PHP' }).data;
  r.createSupplierBooking({ booking_id: booking.booking_id, supplier_id: supplier.supplier_id, booking_item_ids: [item1.booking_item_id] }, { actor: 'staff' }); r.createSupplierBooking({ booking_id: booking.booking_id, supplier_id: supplier2.supplier_id, booking_item_ids: [item2.booking_item_id] }, { actor: 'staff' });
  assert.equal(r.list('SupplierBooking').length, 2); assert.equal(r.list('BookingItem').length, 2);
});

test('six-case regression: reservation before payment plus installments', () => {
  const r = runtime(); const { client, supplier } = base(r, '5'); const quote = approvedQuote(r, client, '10000.00'); const booking = r.createBooking({ quotation_id: quote.quotation_id, client_id: client.client_id, lead_pax_person_id: r.defaultLeadPaxPersonId }, { actor: 'staff' }).data;
  const sb = r.createSupplierBooking({ booking_id: booking.booking_id, supplier_id: supplier.supplier_id }, { actor: 'staff' }).data; const payable = r.createSupplierPayable({ supplier_booking_id: sb.supplier_booking_id, booking_id: booking.booking_id, amount: '10000.00', currency: 'PHP' }).data; r.approveSupplierPayable({ supplier_payable_id: payable.supplier_payable_id }, { actor: 'manager' });
  const payment = r.recordClientPayment({ booking_id: booking.booking_id, client_id: client.client_id, amount: '5000.00', currency: 'PHP', proof_reference: 'installment-1' }); r.verifyClientPayment({ client_payment_id: payment.data.payment.client_payment_id }, { actor: 'manager' }); r.allocatePayment({ client_payment_id: payment.data.payment.client_payment_id, allocations: [{ booking_id: booking.booking_id, amount: '5000.00' }] }, { actor: 'staff' });
  assert.equal(r.executeSupplierPayment({ supplier_payable_id: payable.supplier_payable_id, amount: '10000.00' }, { actor: 'manager' }).error.code, 'INSUFFICIENT_VERIFIED_CLIENT_FUNDS');
});

test('six-case regression: supplier failure/cancellation creates history and refund draft only', () => {
  const r = runtime(); const { client } = base(r, '6'); const quote = approvedQuote(r, client, '10000.00'); const booking = r.createBooking({ quotation_id: quote.quotation_id, client_id: client.client_id, lead_pax_person_id: r.defaultLeadPaxPersonId, current_price: '13000.00', current_supplier_cost: '10000.00' }, { actor: 'staff' }).data;
  const amendment = r.amendBooking({ booking_id: booking.booking_id, changes: { current_price: '14000.00', current_supplier_cost: '11000.00', travel_start: '2026-12-01' }, reason: 'Supplier failed; alternative required' }, { actor: 'staff' });
  assert.equal(amendment.data.amendment.state, 'REACCEPTANCE_REQUIRED');
  const refund = r.requestRefund({ booking_id: booking.booking_id, amount: '100.00', currency: 'PHP', reason: 'Supplier penalty review' }, { actor: 'staff' });
  assert.equal(refund.data.state, 'DRAFT'); assert.equal(r.executeRefund({ refund_adjustment_id: refund.data.refund_adjustment_id }, { actor: 'staff' }).error.code, 'AUTHORIZATION_REQUIRED');
});
