'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { projectCase } = require('../../src/phase1/case-projection');
const { createPhase1Runtime, ACTIONS } = require('../../src/phase1/runtime');
const { createPhase1Application, LOCAL_AUTH } = require('../../src/application/phase1');

const AS_OF = '2026-08-15T00:00:00.000Z';

function threeServiceEntities(completeTour) {
  const entities = {
    Client: [{ client_id: 'CLIENT-1', display_name: 'Generic Client' }],
    Supplier: [{ supplier_id: 'SUPPLIER-A', display_name: 'Hotel Supplier A' }, { supplier_id: 'SUPPLIER-B', display_name: 'Transfer Supplier B' }, { supplier_id: 'SUPPLIER-C', display_name: 'Tour Supplier C' }],
    Inquiry: [{ inquiry_id: 'INQUIRY-1', client_id: 'CLIENT-1', current_requirements: { destination: 'Tokyo', travel_start: '2026-11-10', travel_end: '2026-11-14', pax_count: 2 } }],
    CommercialOption: [{ commercial_option_id: 'OPTION-1', inquiry_id: 'INQUIRY-1', state: 'SELECTED', selected: true }],
    Quotation: [{ quotation_id: 'QUOTE-1', inquiry_id: 'INQUIRY-1', commercial_option_id: 'OPTION-1', client_id: 'CLIENT-1', status: 'APPROVED', client_total: '100000.00', supplier_cost_total: '80000.00', currency: 'PHP' }],
    QuotationAcceptance: [{ quotation_acceptance_id: 'ACCEPT-1', quotation_id: 'QUOTE-1', state: 'ACCEPTED' }],
    Booking: [{ booking_id: 'BOOKING-1', inquiry_id: 'INQUIRY-1', quotation_id: 'QUOTE-1', client_id: 'CLIENT-1', commitment_state: 'CONFIRMED', current_price: '100000.00', current_supplier_cost: '80000.00', currency: 'PHP' }],
    BookingItem: [
      { booking_item_id: 'ITEM-HOTEL', booking_id: 'BOOKING-1', service_type: 'HOTEL', description: 'Tokyo hotel', supplier_id: 'SUPPLIER-A', fulfillment_state: completeTour ? 'CONFIRMED' : 'REQUESTED', required_documents: [{ type: 'HOTEL_CONFIRMATION' }] },
      { booking_item_id: 'ITEM-TRANSFER', booking_id: 'BOOKING-1', service_type: 'TRANSFER', description: 'Airport transfer', supplier_id: 'SUPPLIER-B', fulfillment_state: 'CONFIRMED', required_documents: [{ type: 'TRANSFER_VOUCHER' }] },
      { booking_item_id: 'ITEM-TOUR', booking_id: 'BOOKING-1', service_type: 'TOUR', description: 'City tour', supplier_id: 'SUPPLIER-C', fulfillment_state: completeTour ? 'CONFIRMED' : 'REQUESTED', required_documents: [{ type: 'TOUR_VOUCHER' }], required_tasks: [{ key: 'TOUR-FOLLOW-UP', task_type: 'SUPPLIER_FOLLOW_UP', description: 'Follow up tour supplier' }] }
    ],
    SupplierBooking: [
      { supplier_booking_id: 'SUP-BOOKING-A', booking_id: 'BOOKING-1', supplier_id: 'SUPPLIER-A', booking_item_ids: ['ITEM-HOTEL'], reservation_state: completeTour ? 'CONFIRMED' : 'REQUESTED' },
      { supplier_booking_id: 'SUP-BOOKING-B', booking_id: 'BOOKING-1', supplier_id: 'SUPPLIER-B', booking_item_ids: ['ITEM-TRANSFER'], reservation_state: 'CONFIRMED', supplier_reference: 'TRF-123' },
      { supplier_booking_id: 'SUP-BOOKING-C', booking_id: 'BOOKING-1', supplier_id: 'SUPPLIER-C', booking_item_ids: ['ITEM-TOUR'], reservation_state: completeTour ? 'CONFIRMED' : 'REQUESTED', supplier_reference: completeTour ? 'TOUR-456' : null }
    ],
    SupplierBookingItem: [
      { supplier_booking_item_id: 'JOIN-A', supplier_booking_id: 'SUP-BOOKING-A', booking_item_id: 'ITEM-HOTEL' },
      { supplier_booking_item_id: 'JOIN-B', supplier_booking_id: 'SUP-BOOKING-B', booking_item_id: 'ITEM-TRANSFER' },
      { supplier_booking_item_id: 'JOIN-C', supplier_booking_id: 'SUP-BOOKING-C', booking_item_id: 'ITEM-TOUR' }
    ],
    Document: [
      { document_id: 'DOC-HOTEL', booking_id: 'BOOKING-1', booking_item_id: 'ITEM-HOTEL', document_type: 'HOTEL_CONFIRMATION', status: 'RECEIVED', review_status: 'ACCEPTED' },
      { document_id: 'DOC-TRANSFER', booking_id: 'BOOKING-1', booking_item_id: 'ITEM-TRANSFER', document_type: 'TRANSFER_VOUCHER', status: 'RECEIVED', review_status: 'ACCEPTED' },
      ...(completeTour ? [{ document_id: 'DOC-TOUR', booking_id: 'BOOKING-1', booking_item_id: 'ITEM-TOUR', document_type: 'TOUR_VOUCHER', status: 'RECEIVED', review_status: 'ACCEPTED' }] : [])
    ],
    Task: [{ task_id: 'TASK-TOUR', booking_id: 'BOOKING-1', booking_item_id: 'ITEM-TOUR', task_key: 'TOUR-FOLLOW-UP', task_type: 'SUPPLIER_FOLLOW_UP', description: 'Follow up tour supplier', state: completeTour ? 'COMPLETED' : 'OPEN', blocks_readiness: true }],
    ClientObligation: [], PaymentScheduleItem: [], ClientPayment: [], PaymentEvidence: [], PaymentAllocation: [], SupplierPayable: [], SupplierPayment: [], DepartureReadinessIssue: [], Amendment: [], Reconciliation: []
  };
  return { entities };
}

test('Increment 7 derives independent service fulfillment and aggregate completion', () => {
  const partial = projectCase(threeServiceEntities(false), { booking_id: 'BOOKING-1' }, { asOf: AS_OF });
  assert.equal(partial.services.length, 3);
  assert.deepEqual(partial.services.map((service) => service.fulfillment.state), ['REQUESTED', 'CONFIRMED', 'REQUESTED']);
  assert.equal(partial.supplierFulfillment.state, 'PARTIALLY_FULFILLED');
  assert.equal(partial.services[0].readiness.state, 'BLOCKED');
  assert.equal(partial.services[1].readiness.state, 'READY');
  assert.equal(partial.services[2].readiness.state, 'BLOCKED');
  assert.equal(partial.documents.state, 'PENDING');
  assert.equal(partial.operationalCompletion.state, 'INCOMPLETE');
  assert.ok(partial.blockers.some((blocker) => blocker.code === 'SERVICE_FULFILLMENT_PENDING' && blocker.recordId === 'ITEM-TOUR'));
  assert.ok(partial.blockers.some((blocker) => blocker.code === 'SERVICE_DOCUMENT_MISSING' && blocker.recordId === 'ITEM-TOUR'));
  assert.ok(partial.blockers.some((blocker) => blocker.code === 'SERVICE_TASK_OUTSTANDING' && blocker.recordId === 'TASK-TOUR'));

  const complete = projectCase(threeServiceEntities(true), { booking_id: 'BOOKING-1' }, { asOf: AS_OF });
  complete.entities;
  assert.equal(complete.supplierFulfillment.state, 'CONFIRMED');
  assert.equal(complete.operationalCompletion.state, 'READY');
  assert.equal(complete.operationalCompletion.readyServiceCount, 3);
  assert.equal(complete.operationalCompletion.blockers.length, 0);
  assert.equal(complete.readiness.conditions.supplierFulfillment, true);
});

test('supplier confirmation updates linked Booking Items without affecting other services', () => {
  const authority = { staff: [ACTIONS.RESERVE_SUPPLIER] };
  const runtime = createPhase1Runtime({ clock: () => new Date('2026-08-15T10:00:00+08:00'), config: { trustedActors: authority } });
  const booking = runtime.createRecord('Booking', { client_id: 'CLIENT-1', commitment_state: 'CONFIRMED' }, { actor: 'staff' }).data;
  const supplierA = runtime.createSupplier({ display_name: 'Supplier A', legal_name: 'Supplier A' }).data;
  const supplierB = runtime.createSupplier({ display_name: 'Supplier B', legal_name: 'Supplier B' }).data;
  const hotel = runtime.createBookingItem({ booking_id: booking.booking_id, supplier_id: supplierA.supplier_id, service_type: 'HOTEL', description: 'Hotel' }).data;
  const transfer = runtime.createBookingItem({ booking_id: booking.booking_id, supplier_id: supplierB.supplier_id, service_type: 'TRANSFER', description: 'Transfer' }).data;
  const hotelBooking = runtime.createSupplierBooking({ booking_id: booking.booking_id, supplier_id: supplierA.supplier_id, booking_item_ids: [hotel.booking_item_id] }, { actor: 'staff' }).data;
  const transferBooking = runtime.createSupplierBooking({ booking_id: booking.booking_id, supplier_id: supplierB.supplier_id, booking_item_ids: [transfer.booking_item_id] }, { actor: 'staff' }).data;
  const updated = runtime.updateSupplierBooking({ supplier_booking_id: hotelBooking.supplier_booking_id, reservation_state: 'CONFIRMED', supplier_reference: 'HTL-123' }, { actor: 'staff' });
  assert.equal(updated.ok, true);
  assert.equal(runtime.get('BookingItem', hotel.booking_item_id).fulfillment_state, 'CONFIRMED');
  assert.equal(runtime.get('BookingItem', hotel.booking_item_id).supplier_reference, 'HTL-123');
  assert.equal(runtime.get('BookingItem', transfer.booking_item_id).fulfillment_state, 'NOT_REQUESTED');
  assert.equal(runtime.get('SupplierBooking', transferBooking.supplier_booking_id).reservation_state, 'REQUESTED');
});

test('service task generation is explicit and idempotent', () => {
  const app = createPhase1Application({ seedSynthetic: false, config: { trustedActors: LOCAL_AUTH } });
  app.runtime.createRecord('Inquiry', { inquiry_id: 'INQUIRY-1', client_id: 'CLIENT-1', current_requirements: { destination: 'Tokyo' } }, { actor: 'LOCAL_STAFF' });
  const booking = app.runtime.createRecord('Booking', { inquiry_id: 'INQUIRY-1', client_id: 'CLIENT-1', commitment_state: 'CONFIRMED' }, { actor: 'LOCAL_STAFF' }).data;
  app.runtime.createBookingItem({ booking_id: booking.booking_id, service_type: 'TOUR', description: 'Tour', required_tasks: [{ key: 'TOUR-CONFIRM', task_type: 'SUPPLIER_FOLLOW_UP', description: 'Confirm tour supplier' }] }, { actor: 'LOCAL_STAFF' });
  const first = app.ensureAutomaticFollowUpTasks({}, 'LOCAL_STAFF');
  const second = app.ensureAutomaticFollowUpTasks({}, 'LOCAL_STAFF');
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  const tasks = app.runtime.list('Task', (task) => task.booking_item_id && task.task_type === 'SUPPLIER_FOLLOW_UP');
  assert.equal(tasks.length, 1);
  app.updateTask({ task_id: tasks[0].task_id, state: 'COMPLETED' }, 'LOCAL_STAFF');
  app.ensureAutomaticFollowUpTasks({}, 'LOCAL_STAFF');
  assert.equal(app.runtime.list('Task', (task) => task.booking_item_id && task.task_type === 'SUPPLIER_FOLLOW_UP').length, 1);
});
