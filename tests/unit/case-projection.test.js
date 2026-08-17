'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { projectCase, projectCases, CASE_PROJECTION_VERSION } = require('../../src/phase1/case-projection');

const AS_OF = '2026-08-15T00:00:00.000Z';

function emptyEntities() {
  return {
    Client: [], Supplier: [], Inquiry: [], CommercialOption: [], Quotation: [], QuotationAcceptance: [], Booking: [],
    BookingItem: [], SupplierBooking: [], SupplierBookingItem: [], ClientObligation: [], PaymentScheduleItem: [],
    ClientPayment: [], PaymentEvidence: [], PaymentAllocation: [], SupplierPayable: [], SupplierPayment: [],
    Document: [], Task: [], DepartureReadinessIssue: [], Amendment: [], Reconciliation: []
  };
}

function fixtureEntities(overrides) {
  const entities = emptyEntities();
  entities.Client.push({ client_id: 'CLIENT-1', display_name: 'Synthetic Client' });
  entities.Supplier.push({ supplier_id: 'SUPPLIER-1', display_name: 'Synthetic Supplier' });
  entities.Inquiry.push({
    inquiry_id: 'INQUIRY-1', client_id: 'CLIENT-1',
    current_requirements: { destination: 'Tokyo', travel_start: '2026-11-10', travel_end: '2026-11-14', nights: 4, pax_count: 3 }
  });
  entities.CommercialOption.push({ commercial_option_id: 'OPTION-1', inquiry_id: 'INQUIRY-1', state: 'SELECTED', selected: true, source_type: 'CUSTOM' });
  entities.Quotation.push({ quotation_id: 'QUOTE-1', inquiry_id: 'INQUIRY-1', commercial_option_id: 'OPTION-1', client_id: 'CLIENT-1', status: 'APPROVED', client_total: '120000.00', supplier_cost_total: '85000.00', currency: 'PHP', valid_until: '2026-09-01' });
  entities.QuotationAcceptance.push({ quotation_acceptance_id: 'ACCEPT-1', quotation_id: 'QUOTE-1', state: 'ACCEPTED' });
  entities.Booking.push({ booking_id: 'BOOKING-1', inquiry_id: 'INQUIRY-1', quotation_id: 'QUOTE-1', client_id: 'CLIENT-1', commitment_state: 'CONFIRMED', current_price: '120000.00', current_supplier_cost: '85000.00', currency: 'PHP', travel_start: '2026-11-10', travel_end: '2026-11-14' });
  entities.BookingItem.push({ booking_item_id: 'ITEM-1', booking_id: 'BOOKING-1', fulfillment_state: 'CONFIRMED', supplier_cost: '85000.00', selling_price: '120000.00', currency: 'PHP' });
  entities.SupplierBooking.push({ supplier_booking_id: 'SUP-BOOKING-1', booking_id: 'BOOKING-1', supplier_id: 'SUPPLIER-1', reservation_state: 'CONFIRMED' });
  return applyOverrides(entities, overrides || {});
}

function applyOverrides(entities, overrides) {
  Object.keys(overrides).forEach((type) => { entities[type] = overrides[type]; });
  return { entities };
}

function project(entities, options) {
  return projectCase(entities, { inquiry_id: 'INQUIRY-1' }, Object.assign({ asOf: AS_OF }, options || {}));
}

test('projection contract is derived and fixture-independent across the workflow states', () => {
  const empty = emptyEntities();
  empty.Inquiry.push({ inquiry_id: 'INQUIRY-EMPTY', client_id: 'CLIENT-1', current_requirements: {} });
  assert.equal(projectCase({ entities: empty }, { inquiry_id: 'INQUIRY-EMPTY' }, { asOf: AS_OF }).currentStage, 'INQUIRY');

  const requirements = emptyEntities();
  requirements.Inquiry.push({ inquiry_id: 'INQUIRY-1', client_id: 'CLIENT-1', current_requirements: { destination: 'Tokyo', travel_start: '2026-11-10', travel_end: '2026-11-14', nights: 4, pax_count: 3 } });
  assert.equal(project(requirements).currentStage, 'OPTIONS');
  assert.equal(project(requirements).nextAction.code, 'PREPARE_OPTIONS');

  const options = fixtureEntities({ Quotation: [], QuotationAcceptance: [], Booking: [], BookingItem: [], SupplierBooking: [] });
  assert.equal(project(options).currentStage, 'QUOTATION');
  assert.equal(project(options).nextAction.code, 'PREPARE_QUOTATION');

  const awaitingSelection = fixtureEntities({ CommercialOption: [{ commercial_option_id: 'OPTION-1', inquiry_id: 'INQUIRY-1', state: 'MATCHED', selected: false }], Quotation: [], QuotationAcceptance: [], Booking: [], BookingItem: [], SupplierBooking: [] });
  assert.equal(project(awaitingSelection).currentStage, 'OPTIONS');
  assert.equal(project(awaitingSelection).nextAction.code, 'SELECT_OPTION');

  const draftQuote = fixtureEntities({ Quotation: [{ quotation_id: 'QUOTE-1', inquiry_id: 'INQUIRY-1', commercial_option_id: 'OPTION-1', status: 'DRAFT', client_total: '120000.00', supplier_cost_total: '85000.00', currency: 'PHP' }], QuotationAcceptance: [], Booking: [], BookingItem: [], SupplierBooking: [] });
  assert.equal(project(draftQuote).currentStage, 'QUOTATION');
  assert.equal(project(draftQuote).nextAction.code, 'PREPARE_QUOTATION');

  const awaitingClient = fixtureEntities({ QuotationAcceptance: [], Booking: [], BookingItem: [], SupplierBooking: [] });
  assert.equal(project(awaitingClient).currentStage, 'CLIENT_DECISION');
  assert.equal(project(awaitingClient).nextAction.code, 'REQUEST_CLIENT_DECISION');

  const bookingRequired = fixtureEntities({ Booking: [], BookingItem: [], SupplierBooking: [] });
  assert.equal(project(bookingRequired).currentStage, 'BOOKING');
  assert.equal(project(bookingRequired).nextAction.code, 'CREATE_BOOKING');

  const supplierReserved = fixtureEntities({ SupplierBooking: [{ supplier_booking_id: 'SUP-BOOKING-1', booking_id: 'BOOKING-1', reservation_state: 'REQUESTED' }], PaymentScheduleItem: [{ payment_schedule_item_id: 'SCHEDULE-1', booking_id: 'BOOKING-1', amount: '120000.00', currency: 'PHP', due_at: '2026-10-20', purpose: 'BALANCE' }] });
  const reservedProjection = project(supplierReserved);
  assert.equal(reservedProjection.supplierFulfillment.state, 'RESERVED');
  assert.equal(reservedProjection.currentStage, 'SUPPLIER_FULFILLMENT');

  const partial = fixtureEntities({ PaymentScheduleItem: [{ payment_schedule_item_id: 'SCHEDULE-1', booking_id: 'BOOKING-1', amount: '50000.00', currency: 'PHP', due_at: '2026-10-20', purpose: 'BALANCE' }], ClientPayment: [{ client_payment_id: 'PAYMENT-1', booking_id: 'BOOKING-1', amount: '30000.00', currency: 'PHP', payment_state: 'VERIFIED' }], PaymentAllocation: [{ payment_allocation_id: 'ALLOC-1', client_payment_id: 'PAYMENT-1', booking_id: 'BOOKING-1', amount: '30000.00', currency: 'PHP', state: 'ACTIVE' }] });
  const partialProjection = project(partial);
  assert.equal(partialProjection.currentStage, 'PAYMENT');
  assert.equal(partialProjection.nextAction.code, 'COLLECT_CLIENT_BALANCE');
  assert.equal(partialProjection.finance.state, 'PARTIALLY_FUNDED');
  assert.equal(partialProjection.finance.outstanding, '20000.00');
  assert.ok(partialProjection.blockers.some((blocker) => blocker.code === 'CLIENT_BALANCE_OUTSTANDING'));

  const fullyFunded = fixtureEntities({ PaymentScheduleItem: [{ payment_schedule_item_id: 'SCHEDULE-1', booking_id: 'BOOKING-1', amount: '50000.00', currency: 'PHP', due_at: '2026-10-20', purpose: 'BALANCE' }], ClientPayment: [{ client_payment_id: 'PAYMENT-1', booking_id: 'BOOKING-1', amount: '50000.00', currency: 'PHP', payment_state: 'VERIFIED' }], PaymentAllocation: [{ payment_allocation_id: 'ALLOC-1', client_payment_id: 'PAYMENT-1', booking_id: 'BOOKING-1', amount: '50000.00', currency: 'PHP', state: 'ACTIVE' }] });
  assert.equal(project(fullyFunded).finance.state, 'FULLY_FUNDED');

  const payableBlocked = fixtureEntities(Object.assign({}, fullyFunded.entities, { SupplierPayable: [{ supplier_payable_id: 'PAYABLE-1', booking_id: 'BOOKING-1', supplier_booking_id: 'SUP-BOOKING-1', amount: '50000.00', currency: 'PHP', state: 'DRAFT' }] }));
  assert.equal(project(payableBlocked).nextAction.code, 'APPROVE_SUPPLIER_PAYABLE');
  assert.equal(project(payableBlocked).finance.supplierPaymentGate, 'BLOCKED');

  const payablePermitted = fixtureEntities(Object.assign({}, fullyFunded.entities, { SupplierPayable: [{ supplier_payable_id: 'PAYABLE-1', booking_id: 'BOOKING-1', supplier_booking_id: 'SUP-BOOKING-1', amount: '50000.00', currency: 'PHP', state: 'APPROVED' }] }));
  assert.equal(project(payablePermitted).nextAction.code, 'EXECUTE_SUPPLIER_PAYMENT');
  assert.equal(project(payablePermitted).finance.supplierPaymentGate, 'PERMITTED');

  const docsOutstanding = fixtureEntities(Object.assign({}, fullyFunded.entities, { Document: [], Task: [{ task_id: 'TASK-1', booking_id: 'BOOKING-1', state: 'OPEN', description: 'Prepare final itinerary' }] }));
  const docsProjection = project(docsOutstanding, { requiredDocuments: [{ type: 'FINAL_ITINERARY' }] });
  assert.equal(docsProjection.currentStage, 'DOCUMENTS');
  assert.equal(docsProjection.nextAction.code, 'COMPLETE_DOCUMENTS');

  const ready = fixtureEntities(Object.assign({}, fullyFunded.entities, { Document: [{ document_id: 'DOC-1', booking_id: 'BOOKING-1', document_type: 'FINAL_ITINERARY', required: true, review_status: 'ACCEPTED' }] }));
  const readyProjection = project(ready, { requiredDocuments: [{ type: 'FINAL_ITINERARY' }] });
  assert.equal(readyProjection.readiness.state, 'READY');
  assert.equal(readyProjection.currentStage, 'COMPLETION');
  assert.equal(readyProjection.nextAction.code, 'MONITOR_DEPARTURE');

  const completed = fixtureEntities(Object.assign({}, ready.entities, { Booking: [Object.assign({}, ready.entities.Booking[0], { record_state: 'COMPLETED' })] }));
  const completedProjection = project(completed, { requiredDocuments: [{ type: 'FINAL_ITINERARY' }] });
  assert.equal(completedProjection.currentStage, 'COMPLETION');
  assert.equal(completedProjection.nextAction.code, 'CASE_COMPLETE');

  const exception = fixtureEntities(Object.assign({}, ready.entities, { DepartureReadinessIssue: [{ departure_readiness_issue_id: 'ISSUE-1', booking_id: 'BOOKING-1', state: 'OPEN', severity: 'BLOCKER', description: 'Supplier confirmation missing' }] }));
  const exceptionProjection = project(exception, { requiredDocuments: [{ type: 'FINAL_ITINERARY' }] });
  assert.equal(exceptionProjection.nextAction.code, 'RESOLVE_EXCEPTION');
  assert.equal(exceptionProjection.readiness.state, 'NOT_READY');
  assert.equal(exceptionProjection.exceptions[0].code, 'READINESS_ISSUE');
});

test('the same projection contract represents non-Bangkok case types without special fields or paths', () => {
  const fixtures = [
    { name: 'Tokyo custom trip', destination: 'Tokyo', source_type: 'CUSTOM_ITINERARY' },
    { name: 'Visa-only service', destination: null, service_type: 'VISA_PROCESSING' },
    { name: 'Hotel-only booking', destination: 'Osaka', source_type: 'HOTEL_ONLY' },
    { name: 'MICE corporate trip', destination: 'Singapore', source_type: 'MICE' },
    { name: 'Group travel', destination: 'Seoul', source_type: 'GROUP' },
    { name: 'Supplier package', destination: 'Paris', source_type: 'SUPPLIER_PACKAGE' }
  ];
  fixtures.forEach((fixture, index) => {
    const entities = emptyEntities();
    entities.Client.push({ client_id: 'CLIENT-' + index, display_name: fixture.name });
    const requirements = fixture.destination ? { destination: fixture.destination, travel_start: '2026-11-10', travel_end: '2026-11-14', nights: 4, pax_count: 2 } : { service_type: fixture.service_type, travelers: 1 };
    entities.Inquiry.push({ inquiry_id: 'INQUIRY-' + index, client_id: 'CLIENT-' + index, current_requirements: requirements, case_type: fixture.destination ? 'TRAVEL' : 'SERVICE' });
    entities.CommercialOption.push({ commercial_option_id: 'OPTION-' + index, inquiry_id: 'INQUIRY-' + index, state: 'MATCHED', selected: false, source_type: fixture.source_type || 'SERVICE' });
    const projection = projectCase({ entities }, { inquiry_id: 'INQUIRY-' + index }, { asOf: AS_OF });
    assert.equal(projection.projectionVersion, CASE_PROJECTION_VERSION, fixture.name);
    assert.equal(projection.currentStage, 'OPTIONS', fixture.name);
    assert.equal(projection.nextAction.code, 'SELECT_OPTION', fixture.name);
    assert.doesNotMatch(JSON.stringify(projection), /Bangkok/i, fixture.name);
  });
});

test('projection reads are deterministic and project all generic inquiries without mutation', () => {
  const entities = fixtureEntities();
  const before = JSON.stringify(entities);
  const first = projectCase(entities, { inquiry_id: 'INQUIRY-1' }, { asOf: AS_OF });
  const second = projectCase(entities, { inquiry_id: 'INQUIRY-1' }, { asOf: AS_OF });
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(entities), before);
  assert.equal(projectCases(entities, { asOf: AS_OF }).length, 1);
});
