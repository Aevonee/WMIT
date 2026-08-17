'use strict';

const { createLocalRuntime } = require('../services');
const { createOperationsMvp } = require('./operations-mvp');
const { loadConfig, getDefaultConfig } = require('../config/config');
const { MockAttendanceSourceAdapter } = require('../attendance/mock-source-adapter');
const { GoogleSheetsAttendanceAdapter } = require('../adapters/google-sheets-attendance-adapter');
const { FallbackAttendanceSourceAdapter } = require('../attendance/source-adapter');
const { AttendanceIdentityMap } = require('../attendance/identity-map');
const { DEMO_ATTENDANCE_PEOPLE, DEMO_ATTENDANCE_ROSTER, DEMO_ATTENDANCE_EVENTS } = require('../attendance/demo-fixture');

const DEMO_CONTEXT = { actor: 'DEMO_USER', agent: 'OPERATIONS_MVP_DEMO', correlationId: 'DEMO-WORKFLOW-001' };

function must(result) {
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function seedDemoRuntime(options) {
  const input = options || {};
  const inputConfig = input.config || {};
  const config = loadConfig(Object.assign({}, inputConfig, {
    featureFlags: Object.assign({}, getDefaultConfig().featureFlags, inputConfig.featureFlags || {}, { attendanceMonitoringEnabled: true }),
    attendance: Object.assign({}, getDefaultConfig().attendance, inputConfig.attendance || {})
  }));
  const runtime = createLocalRuntime(Object.assign({}, input, { config, clock: () => new Date('2026-08-12T10:00:00.000Z') }));
  const demoProvider = new MockAttendanceSourceAdapter({ events: DEMO_ATTENDANCE_EVENTS, roster: DEMO_ATTENDANCE_ROSTER, metadata: { source_name: 'Synthetic Attendance Log', source_type: 'MOCK', source_label: 'Demo Data', read_only: true } });
  const googleFlags = config.featureFlags && (config.featureFlags.attendanceGoogleSourceEnabled || config.featureFlags.ATTENDANCE_GOOGLE_SOURCE_ENABLED);
  let attendanceProvider = input.attendanceProvider;
  if (!attendanceProvider) {
    if (googleFlags) {
      const googleProvider = new GoogleSheetsAttendanceAdapter(config, input.attendanceApiClient || input.googleAttendanceClient);
      attendanceProvider = config.attendance.googleFallbackToMock ? new FallbackAttendanceSourceAdapter(googleProvider, demoProvider) : googleProvider;
    } else {
      attendanceProvider = demoProvider;
    }
  }
  const attendanceIdentityMap = input.attendanceIdentityMap || new AttendanceIdentityMap(DEMO_ATTENDANCE_PEOPLE);
  const app = createOperationsMvp({ runtime, attendanceProvider, attendanceIdentityMap, context: DEMO_CONTEXT });
  const create = (type, record) => must(runtime.services[type].create(record, DEMO_CONTEXT));

  create('Client', {
    client_id: 'CLIENT-TEST-000010', client_type: 'Individual', legal_name: 'Demo Traveler', display_name: 'Demo Traveler',
    primary_email: 'demo.traveler@example.test', country: 'Philippines', status: 'Active'
  });
  create('Contact', {
    contact_id: 'CONTACT-TEST-000010', owner_type: 'Client', owner_id: 'CLIENT-TEST-000010', contact_type: 'Email',
    contact_value: 'demo.traveler@example.test', is_primary: true, status: 'Active'
  });
  create('Traveler', {
    traveler_id: 'PASSENGER-2026-000001', client_id: 'CLIENT-TEST-000010', first_name: 'Demo', last_name: 'Traveler', nationality: 'Philippine', status: 'Active'
  });
  create('Traveler', {
    traveler_id: 'PASSENGER-2026-000002', client_id: 'CLIENT-TEST-000010', first_name: 'Sample', last_name: 'Companion', nationality: 'Philippine', status: 'Active'
  });
  create('Supplier', {
    supplier_id: 'SUPPLIER-TEST-000010', supplier_type: 'Tour Operator', legal_name: 'Demo Horizons Ltd.', display_name: 'Demo Horizons', country: 'Philippines', status: 'Active'
  });
  create('Supplier', {
    supplier_id: 'SUPPLIER-TEST-000011', supplier_type: 'Transport Provider', legal_name: 'Demo Transfers Ltd.', display_name: 'Demo Transfers', country: 'Philippines', status: 'Active'
  });
  must(app.createLead({
    lead_id: 'LEAD-2026-000001', received_at: '2026-08-12T09:00:00+08:00', source: 'Other', lead_type: 'B2C',
    client_id: 'CLIENT-TEST-000010', contact_id: 'CONTACT-TEST-000010', contact_name: 'Demo Traveler', contact_email: 'demo.traveler@example.test',
    destination: 'Demo City', travel_start: '2026-12-01', travel_end: '2026-12-05', pax_count: 2, currency: 'PHP'
  }));
  must(app.createQuotationFromLead({
    quotation_id: 'QUOTATION-2026-000001', lead_id: 'LEAD-2026-000001', client_id: 'CLIENT-TEST-000010', contact_id: 'CONTACT-TEST-000010',
    valid_until: '2026-08-19', inclusions: 'Hotel and airport transfer', exclusions: 'Personal expenses', payment_terms: '50% deposit; balance before travel'
  }));
  must(app.addQuotationItem({
    quotation_item_id: 'QUOTATION_ITEM-2026-000001', quotation_id: 'QUOTATION-2026-000001', service_type: 'Hotel', description: 'Demo hotel stay',
    supplier_id: 'SUPPLIER-TEST-000010', quantity: 4, unit_cost: 2000, unit_selling_price: 2500, currency: 'PHP', service_start: '2026-12-01', service_end: '2026-12-05'
  }));
  must(app.addQuotationItem({
    quotation_item_id: 'QUOTATION_ITEM-2026-000002', quotation_id: 'QUOTATION-2026-000001', service_type: 'Transfer', description: 'Demo airport transfer',
    supplier_id: 'SUPPLIER-TEST-000011', quantity: 1, unit_cost: 1000, unit_selling_price: 1250, currency: 'PHP', service_start: '2026-12-01'
  }));
  must(app.createBookingFromQuotation({ booking_id: 'BOOKING-2026-000001', quotation_id: 'QUOTATION-2026-000001' }));
  must(app.addBookingTraveler({ booking_traveler_id: 'BOOKING_TRAVELER-2026-000001', booking_id: 'BOOKING-2026-000001', traveler_id: 'PASSENGER-2026-000001', is_primary: true, traveler_role: 'Lead Traveler' }));
  must(app.addBookingTraveler({ booking_traveler_id: 'BOOKING_TRAVELER-2026-000002', booking_id: 'BOOKING-2026-000001', traveler_id: 'PASSENGER-2026-000002', is_primary: false, traveler_role: 'Traveler' }));
  must(app.createSupplierBookingFromBookingItem({
    supplier_booking_id: 'SUPPLIER_BOOKING-2026-000001', booking_item_id: 'BOOKING_ITEM-2026-000001', supplier_id: 'SUPPLIER-TEST-000010',
    supplier_reference: 'DEMO-TOUR-001', supplier_cost: 8000, deposit: 3000, balance: 5000, deposit_due_date: '2026-10-01', final_payment_due_date: '2026-11-01'
  }));
  must(app.createSupplierBookingFromBookingItem({
    supplier_booking_id: 'SUPPLIER_BOOKING-2026-000002', booking_item_id: 'BOOKING_ITEM-2026-000002', supplier_id: 'SUPPLIER-TEST-000011',
    supplier_reference: 'DEMO-TRANSFER-001', supplier_cost: 1000, deposit: 300, balance: 700, final_payment_due_date: '2026-11-15'
  }));
  must(app.recordSupplierPayment({
    payment_id: 'PAYMENT-2026-000003', supplier_booking_id: 'SUPPLIER_BOOKING-2026-000001', amount: 2000,
    currency: 'PHP', method: 'Bank Transfer', reference: 'DEMO-SUPPLIER-PAY-001'
  }));
  must(app.createInvoiceFromBooking({
    invoice_id: 'INVOICE-2026-000001', invoice_number: 'INV-DEMO-000001', booking_id: 'BOOKING-2026-000001', due_date: '2026-09-01', fees_total: 500, status: 'Sent'
  }));
  must(app.recordPaymentFromInvoice({ payment_id: 'PAYMENT-2026-000001', invoice_id: 'INVOICE-2026-000001', amount: 4000, currency: 'PHP', method: 'Bank Transfer', reference: 'DEMO-PAY-001' }));
  must(app.recordPaymentFromInvoice({ payment_id: 'PAYMENT-2026-000002', invoice_id: 'INVOICE-2026-000001', amount: 1750, currency: 'PHP', method: 'Cash', reference: 'DEMO-PAY-002' }));
  return app;
}

module.exports = { seedDemoRuntime, DEMO_CONTEXT };
