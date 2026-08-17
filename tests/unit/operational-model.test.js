'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SCHEMA, SCHEMA_VERSION } = require('../../src/models/schema');

const EXPECTED_ENTITIES = [
  'Client', 'Contact', 'Traveler', 'Supplier',
  'Lead', 'Quotation', 'QuotationItem',
  'Booking', 'BookingTraveler', 'BookingItem', 'Departure',
  'Invoice', 'InvoiceItem', 'Payment',
  'Document', 'SupplierTariff', 'SupplierBooking', 'SupplierBookingItem',
  'InvoiceBooking', 'DocumentLink', 'Task'
];

test('Version 1 operational model contains exactly the preliminary core entities', () => {
  assert.equal(SCHEMA_VERSION, '1.4.0-quotation-payments-itinerary');
  assert.deepEqual(Object.keys(SCHEMA).sort(), EXPECTED_ENTITIES.slice().sort());
  EXPECTED_ENTITIES.forEach((entityType) => {
    const definition = SCHEMA[entityType];
    assert.ok(definition.tableName);
    assert.ok(definition.idField);
    assert.ok(definition.prefix);
    assert.ok(definition.fields[definition.idField]);
    assert.equal(definition.fields[definition.idField].required, true);
  });
});

test('Version 1 operational model declares the important relationship constraints', () => {
  assert.deepEqual(SCHEMA.BookingTraveler.uniqueFields, [['booking_id', 'traveler_id']]);
  assert.equal(SCHEMA.QuotationItem.fields.quotation_id.references, 'Quotation');
  assert.equal(SCHEMA.BookingItem.fields.booking_id.references, 'Booking');
  assert.equal(SCHEMA.InvoiceItem.fields.invoice_id.references, 'Invoice');
  assert.equal(SCHEMA.Payment.fields.invoice_id.required, false);
  assert.deepEqual(SCHEMA.Payment.fields.payment_direction.allowed, ['FROM_CLIENT', 'TO_SUPPLIER']);
  assert.equal(SCHEMA.Payment.fields.client_id.required, false);
  assert.equal(SCHEMA.Payment.fields.supplier_booking_id.references, 'SupplierBooking');
  assert.equal(SCHEMA.Booking.fields.departure_id.references, 'Departure');
  assert.deepEqual(SCHEMA.SupplierBookingItem.uniqueFields, [['supplier_booking_id', 'booking_item_id']]);
  assert.deepEqual(SCHEMA.InvoiceBooking.uniqueFields, [['invoice_id', 'booking_id']]);
  assert.deepEqual(SCHEMA.DocumentLink.uniqueFields, [['document_id', 'related_entity_type', 'related_entity_id']]);
  assert.equal(SCHEMA.Quotation.fields.destination.required, false);
  assert.equal(SCHEMA.Booking.fields.pax_count.required, false);
  assert.ok(SCHEMA.Document.polymorphicReferences);
  assert.ok(SCHEMA.Document.polymorphicReferences[0].allowedTypes.includes('BookingItem'));
  assert.ok(SCHEMA.Task.polymorphicReferences);
});
