'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLocalRuntime } = require('../../src/services');
const { suggestDocumentMatches } = require('../../src/document-intelligence/matcher');
const { calculateInvoiceTotals, toMinorUnits } = require('../../src/core/money');
const { records, SYNTHETIC_CONTEXT } = require('../fixtures/synthetic-data');

function seededRuntime() {
  const runtime = createLocalRuntime({ clock: () => new Date('2026-08-12T10:00:00.000Z') });
  const create = (type, record) => {
    const result = runtime.services[type].create(record, SYNTHETIC_CONTEXT);
    assert.equal(result.ok, true, type + ' should be valid: ' + JSON.stringify(result));
  };
  create('Client', records.client);
  create('Supplier', records.supplier);
  create('Lead', records.lead);
  create('Quotation', records.quotation);
  create('QuotationItem', records.quotationItem1);
  create('Booking', records.booking);
  create('BookingItem', records.bookingItem1);
  create('BookingItem', records.bookingItem3);
  create('Booking', {
    booking_id: 'BOOKING-TEST-000002',
    client_id: records.client.client_id,
    booking_date: '2026-08-12',
    currency: 'PHP',
    client_total: 100,
    status: 'Draft'
  });
  create('BookingItem', {
    booking_item_id: 'BOOKING_ITEM-TEST-000004',
    booking_id: 'BOOKING-TEST-000002',
    service_type: 'Other',
    description: 'Unrelated synthetic booking item',
    quantity: 1,
    currency: 'PHP',
    status: 'Draft'
  });
  create('Invoice', records.invoice);
  return runtime;
}

test('supplier booking joins support multiple items and enforce booking consistency', () => {
  const runtime = seededRuntime();
  const create = (type, record) => runtime.services[type].create(record, SYNTHETIC_CONTEXT);
  assert.equal(create('SupplierBooking', records.supplierBooking).ok, true);
  assert.equal(create('SupplierBookingItem', records.supplierBookingItem1).ok, true);
  assert.equal(create('SupplierBookingItem', records.supplierBookingItem2).ok, true);
  const duplicate = create('SupplierBookingItem', Object.assign({}, records.supplierBookingItem2, {
    supplier_booking_item_id: 'SUPPLIER_BOOKING_ITEM-TEST-000004'
  }));
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error.code, 'DUPLICATE_RECORD');
  const mismatch = create('SupplierBookingItem', {
    supplier_booking_item_id: 'SUPPLIER_BOOKING_ITEM-TEST-000005',
    supplier_booking_id: 'SUPPLIER_BOOKING-TEST-000001',
    booking_item_id: 'BOOKING_ITEM-TEST-000004',
    currency: 'PHP'
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.error.code, 'VALIDATION_ERROR');
});

test('invoice booking joins support a booking reference without making it the only relationship', () => {
  const runtime = seededRuntime();
  const result = runtime.services.InvoiceBooking.create(records.invoiceBooking, SYNTHETIC_CONTEXT);
  assert.equal(result.ok, true);
  const duplicate = runtime.services.InvoiceBooking.create(Object.assign({}, records.invoiceBooking, {
    invoice_booking_id: 'INVOICE_BOOKING-TEST-000002'
  }), SYNTHETIC_CONTEXT);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error.code, 'DUPLICATE_RECORD');
});

test('document links support multiple controlled related records', () => {
  const runtime = seededRuntime();
  const create = (type, record) => runtime.services[type].create(record, SYNTHETIC_CONTEXT);
  create('SupplierBooking', records.supplierBooking);
  create('Document', records.documentSupplierVoucher);
  assert.equal(create('DocumentLink', records.documentLink1).ok, true);
  assert.equal(create('DocumentLink', records.documentLink2).ok, true);
  const invalid = create('DocumentLink', Object.assign({}, records.documentLink3, {
    document_link_id: 'DOCUMENT_LINK-TEST-000004',
    related_entity_type: 'NotAnEntity'
  }));
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'VALIDATION_ERROR');
});

test('preliminary supplier booking and payment transitions reject illegal changes', () => {
  const runtime = seededRuntime();
  const supplierBooking = runtime.services.SupplierBooking.create(records.supplierBooking, SYNTHETIC_CONTEXT);
  assert.equal(supplierBooking.ok, true);
  assert.equal(runtime.services.SupplierBooking.update(supplierBooking.data.supplier_booking_id, { status: 'Confirmed' }, SYNTHETIC_CONTEXT).ok, false);
  assert.equal(runtime.services.SupplierBooking.update(supplierBooking.data.supplier_booking_id, { status: 'Requested' }, SYNTHETIC_CONTEXT).ok, true);
  const payment = runtime.services.Payment.create(Object.assign({}, records.payment, { status: 'Pending Verification' }), SYNTHETIC_CONTEXT);
  assert.equal(payment.ok, true);
  assert.equal(runtime.services.Payment.update(payment.data.payment_id, { status: 'Paid' }, SYNTHETIC_CONTEXT).ok, false);
});

test('money totals use deterministic minor-unit arithmetic', () => {
  const totals = calculateInvoiceTotals([
    { quantity: 2, unit_price: '10.10' },
    { amount: '1.25' }
  ], { discount: '0.15', fees: '1.00', tax: '0.50' });
  assert.deepEqual(totals, {
    subtotal: '21.45',
    discount: '0.15',
    fees: '1.00',
    tax: '0.50',
    total: '22.80'
  });
  assert.throws(() => toMinorUnits('-1.00'), (error) => error.code === 'INVALID_MONEY');
});

test('date fields reject reversed operational ranges', () => {
  const runtime = seededRuntime();
  const result = runtime.services.Booking.create({
    booking_id: 'BOOKING-TEST-000010',
    client_id: records.client.client_id,
    booking_date: '2026-08-12',
    travel_start: '2026-12-05',
    travel_end: '2026-12-01',
    currency: 'PHP',
    client_total: 100,
    status: 'Draft'
  }, SYNTHETIC_CONTEXT);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'VALIDATION_ERROR');
});

test('document matching suggests records without writing or linking them', () => {
  const runtime = seededRuntime();
  const exact = suggestDocumentMatches({ fields: [{ field_name: 'invoice_number', normalized_value: records.invoice.invoice_number }] }, runtime.repositories);
  assert.equal(exact.status, 'MATCH');
  assert.equal(exact.suggestions[0].entityType, 'Invoice');
  assert.equal(runtime.repositories.DocumentLink.list().length, 0);

  const possible = suggestDocumentMatches({ fields: [{ field_name: 'client', normalized_value: 'Fictional Traveler' }] }, runtime.repositories);
  assert.equal(possible.status, 'POSSIBLE_MATCH');
  const none = suggestDocumentMatches({ fields: [{ field_name: 'invoice_number', normalized_value: 'UNKNOWN-999' }] }, runtime.repositories);
  assert.equal(none.status, 'NO_MATCH');
});

test('synthetic scenarios A-D preserve document-to-commercial workflow without automation', () => {
  const runtime = seededRuntime();
  const create = (type, record) => {
    const result = runtime.services[type].create(record, SYNTHETIC_CONTEXT);
    assert.equal(result.ok, true, type + ' scenario record should be valid: ' + JSON.stringify(result));
  };

  // A: WMIT quotation -> booking -> supplier booking -> supplier voucher -> invoice -> payment.
  create('SupplierBooking', records.supplierBooking);
  create('SupplierBookingItem', records.supplierBookingItem1);
  create('Document', {
    document_id: 'DOCUMENT-TEST-000010', external_file_id: 'scenario-a-voucher', file_name: 'scenario-a-voucher.pdf',
    source_type: 'SUPPLIER', source_name: 'Synthetic Tours', related_entity_type: 'SupplierBooking',
    related_entity_id: records.supplierBooking.supplier_booking_id, document_type: 'TOUR_OPERATOR_VOUCHER',
    extraction_status: 'EXTRACTED', status: 'Needs Review'
  });
  create('InvoiceBooking', records.invoiceBooking);
  create('Payment', records.payment);

  // B: supplier quotation -> WMIT quotation -> booking -> supplier booking.
  create('Document', {
    document_id: 'DOCUMENT-TEST-000011', external_file_id: 'scenario-b-supplier-quote', file_name: 'scenario-b-supplier-quote.pdf',
    source_type: 'SUPPLIER', source_name: 'Synthetic Tours', document_type: 'SUPPLIER_QUOTATION',
    extraction_status: 'EXTRACTED', status: 'Needs Review'
  });
  create('DocumentLink', {
    document_link_id: 'DOCUMENT_LINK-TEST-000010', document_id: 'DOCUMENT-TEST-000011',
    related_entity_type: 'Quotation', related_entity_id: records.quotation.quotation_id, relationship_type: 'Commercial source'
  });
  create('Document', {
    document_id: 'DOCUMENT-TEST-000013', external_file_id: 'scenario-b-wmit-quote', file_name: 'scenario-b-wmit-quote.pdf',
    source_type: 'WMIT', source_name: 'WMIT', related_entity_type: 'Quotation',
    related_entity_id: records.quotation.quotation_id, document_type: 'WMIT_QUOTATION',
    extraction_status: 'EXTRACTED', status: 'Classified'
  });

  // C: tour-operator memo -> supplier booking -> booking.
  create('Document', {
    document_id: 'DOCUMENT-TEST-000012', external_file_id: 'scenario-c-operator-memo', file_name: 'scenario-c-operator-memo.pdf',
    source_type: 'TOUR_OPERATOR', source_name: 'Synthetic Tours', document_type: 'TOUR_OPERATOR_MEMO',
    extraction_status: 'EXTRACTED', status: 'Needs Review'
  });
  create('DocumentLink', {
    document_link_id: 'DOCUMENT_LINK-TEST-000011', document_id: 'DOCUMENT-TEST-000012',
    related_entity_type: 'Booking', related_entity_id: records.booking.booking_id, relationship_type: 'Operational source'
  });

  // D: WMIT invoice -> booking -> multiple payments.
  create('DocumentLink', {
    document_link_id: 'DOCUMENT_LINK-TEST-000012', document_id: 'DOCUMENT-TEST-000010',
    related_entity_type: 'Booking', related_entity_id: records.booking.booking_id, relationship_type: 'Supplier voucher context'
  });
  create('Payment', records.payment2);
  const paymentTotal = runtime.repositories.Payment.list()
    .filter((payment) => payment.invoice_id === records.invoice.invoice_id)
    .reduce((sum, payment) => sum + payment.amount, 0);
  assert.equal(paymentTotal, 8000);
  assert.equal(runtime.repositories.DocumentLink.list().length, 3);
});
