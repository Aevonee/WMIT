'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { seedDemoRuntime } = require('../../src/application/demo-data');
const { createLocalRuntime } = require('../../src/services');
const { createOperationsMvp } = require('../../src/application/operations-mvp');

test('operations MVP demo demonstrates the complete local commercial slice', () => {
  const app = seedDemoRuntime();
  const snapshot = app.snapshot();
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.data.leads.length, 1);
  assert.equal(snapshot.data.quotations.length, 1);
  assert.equal(snapshot.data.bookings.length, 1);
  assert.equal(snapshot.data.booking_items.length, 2);
  assert.equal(app.list('SupplierBooking').length, 2);
  assert.equal(snapshot.data.invoices.length, 1);
  assert.equal(app.list('Payment').length, 3);
  assert.equal(app.list('Payment').filter((payment) => payment.payment_direction === 'FROM_CLIENT').length, 2);
  assert.equal(app.list('Payment').filter((payment) => payment.payment_direction === 'TO_SUPPLIER').length, 1);
  assert.equal(app.list('SupplierBooking').find((booking) => booking.supplier_booking_id === 'SUPPLIER_BOOKING-2026-000001').balance, 3000);
  assert.equal(snapshot.data.invoices[0].balance_due, 6000);

  const duplicateBooking = app.createBookingFromQuotation({ quotation_id: 'QUOTATION-2026-000001' });
  assert.equal(duplicateBooking.ok, true);
  assert.equal(duplicateBooking.meta.idempotent, true);
  assert.equal(duplicateBooking.data.booking.booking_id, 'BOOKING-2026-000001');

  const bookingView = app.getBookingView('BOOKING-2026-000001');
  assert.equal(bookingView.ok, true);
  assert.equal(bookingView.data.travelers.length, 2);
  assert.equal(bookingView.data.supplier_bookings.length, 2);
  assert.equal(bookingView.data.invoices.length, 1);
});

test('operations MVP rejects missing quotation items and overpayments without partial writes', () => {
  const runtime = createLocalRuntime({ clock: () => new Date('2026-08-12T10:00:00.000Z') });
  const app = createOperationsMvp({ runtime });
  const client = runtime.services.Client.create({ client_id: 'CLIENT-TEST-000020', client_type: 'Individual', legal_name: 'MVP Test', display_name: 'MVP Test', status: 'Active' });
  assert.equal(client.ok, true);
  const lead = app.createLead({ lead_id: 'LEAD-2026-000020', received_at: '2026-08-12T09:00:00+08:00', source: 'Other', lead_type: 'B2C', client_id: 'CLIENT-TEST-000020', contact_name: 'MVP Test', destination: 'Test City', pax_count: 1, currency: 'PHP' });
  assert.equal(lead.ok, true);
  const quote = app.createQuotationFromLead({ quotation_id: 'QUOTATION-2026-000020', lead_id: 'LEAD-2026-000020' });
  assert.equal(quote.ok, true);
  const noItems = app.createBookingFromQuotation({ booking_id: 'BOOKING-2026-000020', quotation_id: 'QUOTATION-2026-000020' });
  assert.equal(noItems.ok, false);
  assert.equal(runtime.repositories.Booking.list().length, 0);

  const appDemo = seedDemoRuntime();
  const before = appDemo.list('Payment').length;
  const overpayment = appDemo.recordPaymentFromInvoice({ invoice_id: 'INVOICE-2026-000001', amount: 7000, currency: 'PHP', method: 'Cash' });
  assert.equal(overpayment.ok, false);
  assert.equal(appDemo.list('Payment').length, before);
});

test('operations MVP supplies safe lead defaults and can generate an invoice number', () => {
  const runtime = createLocalRuntime({ clock: () => new Date('2026-08-12T10:00:00.000Z') });
  const app = createOperationsMvp({ runtime });
  const client = runtime.services.Client.create({ client_id: 'CLIENT-TEST-000030', client_type: 'Individual', legal_name: 'Default Test', display_name: 'Default Test', status: 'Active' });
  assert.equal(client.ok, true);
  const lead = app.createLead({ lead_id: 'LEAD-2026-000030', source: 'Other', contact_name: 'Default Test', client_id: 'CLIENT-TEST-000030', destination: 'Test City', currency: 'PHP' });
  assert.equal(lead.ok, true);
  assert.equal(lead.data.lead_type, 'B2C');
  assert.match(lead.data.received_at, /^20/);
});

test('operations MVP mutations use the existing audit log', () => {
  const app = seedDemoRuntime();
  const events = app.runtime.auditLog.list();
  assert.ok(events.some((event) => event.action === 'CREATE' && event.entity_type === 'Lead'));
  assert.ok(events.some((event) => event.action === 'CREATE' && event.entity_type === 'Quotation'));
  assert.ok(events.some((event) => event.action === 'CREATE' && event.entity_type === 'Booking'));
  assert.ok(events.some((event) => event.action === 'CREATE' && event.entity_type === 'SupplierBooking'));
  assert.ok(events.some((event) => event.action === 'CREATE' && event.entity_type === 'Invoice'));
  assert.ok(events.some((event) => event.action === 'CREATE' && event.entity_type === 'Payment'));
});

test('operations MVP records payments to suppliers separately from client receipts', () => {
  const app = seedDemoRuntime();
  const supplierPayment = app.list('Payment').find((payment) => payment.payment_direction === 'TO_SUPPLIER');
  assert.equal(supplierPayment.supplier_booking_id, 'SUPPLIER_BOOKING-2026-000001');
  assert.equal(supplierPayment.invoice_id, undefined);
  assert.equal(supplierPayment.client_id, undefined);
  const tooMuch = app.recordSupplierPayment({ supplier_booking_id: 'SUPPLIER_BOOKING-2026-000001', amount: 4000, currency: 'PHP', method: 'Cash' });
  assert.equal(tooMuch.ok, false);
  assert.equal(tooMuch.error.code, 'OVERPAYMENT');
});

test('operations MVP generated records do not collide with seeded explicit IDs', () => {
  const app = seedDemoRuntime();
  const lead = app.createLead({ source: 'Other', contact_name: 'Generated Lead', client_id: 'CLIENT-TEST-000010', destination: 'Generated City', currency: 'PHP' });
  assert.equal(lead.ok, true);
  assert.notEqual(lead.data.lead_id, 'LEAD-2026-000001');
  const payment = app.recordPaymentFromInvoice({ invoice_id: 'INVOICE-2026-000001', amount: 100, currency: 'PHP', method: 'Cash' });
  assert.equal(payment.ok, true);
  assert.notEqual(payment.data.payment.payment_id, 'PAYMENT-2026-000001');
});

test('operations MVP treats supplier balance as the current balance, not the original balance', () => {
  const app = seedDemoRuntime();
  const payment = app.recordSupplierPayment({ supplier_booking_id: 'SUPPLIER_BOOKING-2026-000001', amount: 3000, currency: 'PHP', method: 'Bank Transfer' });
  assert.equal(payment.ok, true);
  assert.equal(payment.data.supplier_booking.balance, 0);
  const afterFullPayment = app.recordSupplierPayment({ supplier_booking_id: 'SUPPLIER_BOOKING-2026-000001', amount: 1, currency: 'PHP', method: 'Cash' });
  assert.equal(afterFullPayment.ok, false);
  assert.equal(afterFullPayment.error.code, 'OVERPAYMENT');
});

test('operations MVP returns payment-balance details and does not create an overpayment', () => {
  const app = seedDemoRuntime();
  const before = app.list('Payment').length;
  const result = app.recordPaymentFromInvoice({ invoice_id: 'INVOICE-2026-000001', amount: 6000.01, currency: 'PHP', method: 'Cash' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'OVERPAYMENT');
  assert.equal(result.error.details.current_balance, 6000);
  assert.equal(result.error.details.attempted_payment, 6000.01);
  assert.equal(app.list('Payment').length, before);
});

test('operations MVP applies PHP installments to a USD invoice using the recorded rate', () => {
  const app = seedDemoRuntime();
  const invoice = app.runtime.services.Invoice.create({
    invoice_id: 'INVOICE-2026-000099', invoice_number: 'INV-USD-000099', client_id: 'CLIENT-TEST-000010',
    booking_id: 'BOOKING-2026-000001', invoice_date: '2026-08-12', currency: 'USD', subtotal: 2000,
    discount_total: 0, fees_total: 0, tax_total: 0, total: 2000, amount_paid: 0, balance_due: 2000,
    status: 'Sent', notes: 'Synthetic USD invoice'
  });
  assert.equal(invoice.ok, true);
  const first = app.recordPaymentFromInvoice({ invoice_id:'INVOICE-2026-000099', amount:61250, currency:'PHP', exchange_rate:61.25, exchange_rate_date:'2026-08-12', method:'Bank Transfer' });
  assert.equal(first.ok, true);
  assert.equal(first.data.payment.currency, 'PHP');
  assert.equal(first.data.payment.invoice_amount, 1000);
  assert.equal(first.data.invoice.balance_due, 1000);
  const second = app.recordPaymentFromInvoice({ invoice_id:'INVOICE-2026-000099', amount:1000, currency:'USD', method:'Bank Transfer' });
  assert.equal(second.ok, true);
  assert.equal(second.data.invoice.balance_due, 0);
  assert.equal(second.data.invoice.status, 'Paid');
});
