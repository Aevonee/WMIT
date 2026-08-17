'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhase1Runtime, ACTIONS } = require('../../src/phase1/runtime');

function context(actor) {
  return { actor, correlationId: 'FLIGHT-PAYMENT-UPDATES' };
}

test('confirming one item in a grouped supplier request does not confirm another item', () => {
  const runtime = createPhase1Runtime({ config: { trustedActors: { staff: [ACTIONS.RESERVE_SUPPLIER], manager: [ACTIONS.CONFIGURE_SETTINGS] } } });
  const client = runtime.createClient({ display_name: 'Synthetic Client', legal_name: 'Synthetic Client' }).data;
  const supplier = runtime.createSupplier({ display_name: 'Synthetic Air and Land Supplier', legal_name: 'Synthetic Air and Land Supplier' }).data;
  const booking = runtime.createRecord('Booking', { client_id: client.client_id, booking_date: '2026-08-15', travel_start: '2026-10-30', travel_end: '2026-11-05', currency: 'PHP', client_total: '100000.00', status: 'Draft' }, context('staff')).data;
  const flight = runtime.createBookingItem({ booking_id: booking.booking_id, service_type: 'Flight', description: 'Flight', supplier_id: supplier.supplier_id, currency: 'PHP', selling_price: '50000.00', supplier_cost: '40000.00' }, context('staff')).data;
  const land = runtime.createBookingItem({ booking_id: booking.booking_id, service_type: 'Land Arrangement', description: 'Land arrangement', supplier_id: supplier.supplier_id, currency: 'PHP', selling_price: '50000.00', supplier_cost: '40000.00' }, context('staff')).data;
  const request = runtime.createSupplierBooking({ booking_id: booking.booking_id, supplier_id: supplier.supplier_id, booking_item_ids: [flight.booking_item_id, land.booking_item_id] }, context('staff')).data;
  const confirmed = runtime.confirmSupplierBookingItem({ supplier_booking_id: request.supplier_booking_id, booking_item_id: flight.booking_item_id, supplier_reference: 'FLIGHT-CONFIRMED' }, context('staff'));
  assert.equal(confirmed.ok, true);
  assert.equal(runtime.get('BookingItem', flight.booking_item_id).fulfillment_state, 'CONFIRMED');
  assert.equal(runtime.get('BookingItem', land.booking_item_id).fulfillment_state, 'NOT_REQUESTED');
});

test('payment schedule defaults use reservation and business-day departure rules', () => {
  const runtime = createPhase1Runtime({ config: { trustedActors: { manager: [ACTIONS.CONFIGURE_SETTINGS] } } });
  const client = runtime.createClient({ display_name: 'Synthetic Client', legal_name: 'Synthetic Client' }).data;
  const booking = runtime.createRecord('Booking', { client_id: client.client_id, booking_date: '2026-08-15', travel_start: '2026-10-30', travel_end: '2026-11-05', currency: 'PHP', client_total: '100000.00', status: 'Draft' }, context('manager')).data;
  assert.equal(runtime.updateSettings({ quotation_defaults: { downPaymentDaysAfterReservation: 3, finalBalanceBusinessDaysBeforeDeparture: 30 } }, context('manager')).ok, true);
  const result = runtime.createBookingPaymentObligations({ booking_id: booking.booking_id, obligations: [{ sequence: 1, purpose: 'DOWN_PAYMENT', amount: '50000.00' }, { sequence: 2, purpose: 'FINAL_BALANCE', amount: '50000.00' }] }, context('manager'));
  assert.equal(result.ok, true);
  assert.equal(result.data.obligations[0].due_at.slice(0, 10), '2026-08-18');
  const expected = new Date('2026-10-30T00:00:00.000Z');
  let remaining = 30;
  while (remaining > 0) {
    expected.setUTCDate(expected.getUTCDate() - 1);
    if (![0, 6].includes(expected.getUTCDay())) remaining -= 1;
  }
  assert.equal(result.data.obligations[1].due_at.slice(0, 10), expected.toISOString().slice(0, 10));
});
