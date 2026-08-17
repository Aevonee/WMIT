'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLocalRuntime } = require('../../src/services');
const { records, SYNTHETIC_CONTEXT } = require('../fixtures/synthetic-data');

test('synthetic records demonstrate foundation relationships', () => {
  const runtime = createLocalRuntime({ clock: () => new Date('2026-08-12T10:00:00.000Z') });
  const create = (type, record) => {
    const result = runtime.services[type].create(record, SYNTHETIC_CONTEXT);
    assert.equal(result.ok, true, type + ' fixture should be valid: ' + JSON.stringify(result));
  };

  create('Client', records.client);
  create('Contact', {
    contact_id: 'CONTACT-TEST-000001',
    owner_type: 'Client',
    owner_id: 'CLIENT-TEST-000001',
    contact_type: 'Email',
    contact_value: 'traveler@example.test',
    is_primary: true,
    status: 'Active'
  });
  create('Traveler', records.traveler);
  create('Traveler', records.traveler2);
  create('Lead', Object.assign({}, records.lead, {
    client_id: 'CLIENT-TEST-000001',
    contact_id: 'CONTACT-TEST-000001',
    traveler_id: 'PASSENGER-TEST-000001'
  }));
  create('Supplier', records.supplier);
  create('Supplier', records.supplier2);
  create('Quotation', Object.assign({}, records.quotation, {
    contact_id: 'CONTACT-TEST-000001',
    assigned_to: 'TEST_USER'
  }));
  create('QuotationItem', records.quotationItem1);
  create('QuotationItem', records.quotationItem2);
  create('Departure', records.departure);
  create('Booking', Object.assign({}, records.booking, {
    contact_id: 'CONTACT-TEST-000001',
    departure_id: 'DEPARTURE-TEST-000001'
  }));
  create('BookingTraveler', records.bookingTraveler1);
  create('BookingTraveler', records.bookingTraveler2);
  create('BookingItem', records.bookingItem1);
  create('BookingItem', records.bookingItem2);
  create('BookingItem', records.bookingItem3);
  create('Invoice', records.invoice);
  create('InvoiceItem', records.invoiceItem1);
  create('InvoiceItem', records.invoiceItem2);
  create('InvoiceBooking', records.invoiceBooking);
  create('Payment', records.payment);
  create('Payment', records.payment2);
  create('Document', records.document);
  create('SupplierTariff', records.supplierTariff);
  create('SupplierBooking', records.supplierBooking);
  create('SupplierBooking', records.supplierBooking2);
  create('SupplierBookingItem', records.supplierBookingItem1);
  create('SupplierBookingItem', records.supplierBookingItem2);
  create('SupplierBookingItem', records.supplierBookingItem3);
  create('Document', records.documentSupplierVoucher);
  create('Document', records.documentWmitInvoice);
  create('DocumentLink', records.documentLink1);
  create('DocumentLink', records.documentLink2);
  create('DocumentLink', records.documentLink3);
  create('Task', records.task);

  assert.equal(runtime.repositories.Client.list().length, 1);
  assert.equal(runtime.repositories.Traveler.list().length, 2);
  assert.equal(runtime.repositories.Booking.get('BOOKING-TEST-000001').client_id, 'CLIENT-TEST-000001');
  assert.equal(runtime.repositories.BookingTraveler.list().length, 2);
  assert.equal(runtime.repositories.BookingItem.list().length, 3);
  assert.equal(runtime.repositories.SupplierBooking.list().length, 2);
  assert.equal(runtime.repositories.SupplierBookingItem.list().length, 3);
  assert.equal(runtime.repositories.InvoiceBooking.list().length, 1);
  assert.equal(runtime.repositories.DocumentLink.list().length, 3);
  assert.equal(runtime.repositories.InvoiceItem.list().length, 2);
  const paid = runtime.repositories.Payment.list()
    .filter((payment) => payment.invoice_id === 'INVOICE-TEST-000001')
    .reduce((total, payment) => total + payment.amount, 0);
  assert.equal(records.invoice.total - paid, 3750);
  assert.equal(runtime.repositories.Document.get('DOCUMENT-TEST-000001').status, 'Needs Review');
  assert.equal(runtime.repositories.DocumentLink.get('DOCUMENT_LINK-TEST-000002').related_entity_type, 'BookingItem');
});
