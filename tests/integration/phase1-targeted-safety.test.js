'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createPhase1Application } = require('../../src/application/phase1');
const { createPhase1Runtime } = require('../../src/phase1/runtime');

test('Phase 1 Expo configuration distinguishes eligible, ineligible, pending, and unconfigured states', () => {
  const configured = { id: 'EXPO-LOCAL-TEST', name: 'Local Expo Test', startAt: '2026-08-14T09:00:00+08:00', endAt: '2026-08-14T17:00:00+08:00', discountPercent: 10 };
  const runtime = createPhase1Runtime({ config: { expo: configured } });
  const eligible = runtime.calculatePricing({ supplier_cost_total: '1000.00', pricing_context_type: 'EXPO', discount: '100.00', client_payment_sent_at: '2026-08-14T10:00:00+08:00' });
  const ineligible = runtime.calculatePricing({ supplier_cost_total: '1000.00', pricing_context_type: 'EXPO', discount: '100.00', client_payment_sent_at: '2026-08-14T18:00:00+08:00' });
  const missingSentAt = runtime.calculatePricing({ supplier_cost_total: '1000.00', pricing_context_type: 'EXPO', discount: '100.00' });
  const unconfigured = createPhase1Runtime().calculatePricing({ supplier_cost_total: '1000.00', pricing_context_type: 'EXPO', discount: '100.00', client_payment_sent_at: '2026-08-14T10:00:00+08:00' });

  assert.equal(eligible.discount_state, 'APPLIED');
  assert.equal(eligible.discount_total, '100.00');
  assert.equal(ineligible.discount_state, 'INELIGIBLE');
  assert.equal(ineligible.discount_total, '0.00');
  assert.equal(missingSentAt.discount_state, 'PENDING_PAYMENT_ELIGIBILITY');
  assert.equal(missingSentAt.discount_total, '0.00');
  assert.equal(unconfigured.discount_state, 'PENDING_CONFIGURATION');
  assert.equal(unconfigured.discount_total, '0.00');

  const app = createPhase1Application({ config: { expo: configured } });
  assert.deepEqual(app.snapshot().data.configuration.expo, { id: configured.id, name: configured.name, startAt: configured.startAt, endAt: configured.endAt, configured: true });
});

test('BDO FX rule remains explicit without inventing a numeric exchange rate', () => {
  const runtime = createPhase1Runtime();
  const pricing = runtime.calculatePricing({ supplier_cost_total: '1000.00', pricing_context_type: 'STANDARD', fx_rule: 'BDO_FOREX_SELLING_PLUS_1.0', currency: 'USD' });
  assert.equal(pricing.pricing_rule_snapshot.fx_rule, 'BDO_FOREX_SELLING_PLUS_1.0');
  assert.equal(pricing.client_total, '1300.00');
  assert.equal(pricing.fx_rate, undefined);
});

test('Operations Workspace resolves Booking context through quotation and Commercial Option lineage', async () => {
  const entityNames = ['Person', 'Client', 'Inquiry', 'CommercialOption', 'AvailabilityEvidence', 'Supplier', 'SupplierContact', 'SupplierPackage', 'Document', 'TariffSource', 'TariffExtractionFact', 'TariffRateComponent', 'TariffItineraryComponent', 'CommercialPricingContext', 'Quotation', 'QuotationItem', 'Booking', 'BookingParticipant', 'BookingItem', 'SupplierBooking', 'SupplierBookingItem', 'ClientObligation', 'ClientInvoice', 'ClientPayment', 'PaymentEvidence', 'PaymentAllocation', 'SupplierPayable', 'SupplierPayment', 'RefundAdjustment', 'Amendment', 'Task', 'CommunicationActivity', 'Departure', 'DepartureMembership', 'AuditEvent'];
  const entities = Object.fromEntries(entityNames.map((name) => [name, []]));
  entities.Inquiry.push({ inquiry_id: 'INQUIRY-1', client_id: 'CLIENT-1', current_requirements: { destination: 'Bangkok' }, original_request: {} });
  entities.CommercialOption.push({ commercial_option_id: 'OPTION-1', inquiry_id: 'INQUIRY-1', selected: true, state: 'SELECTED' });
  entities.Quotation.push({ quotation_id: 'QUOTATION-1', commercial_option_id: 'OPTION-1', status: 'APPROVED', client_id: 'CLIENT-1', client_total: '100.00', supplier_cost_total: '80.00', currency: 'USD' });
  entities.Booking.push({ booking_id: 'BOOKING-1', quotation_id: 'QUOTATION-1', client_id: 'CLIENT-1', record_state: 'CREATED', commitment_state: 'PENDING' });
  const state = { entities, audit: [] };
  const storage = new Map();
  const sessionStorage = { getItem: (key) => storage.has(key) ? storage.get(key) : null, setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) };
  const element = () => ({ innerHTML: '', hidden: false, className: '', value: '', files: [], querySelector: () => null });
  const context = vm.createContext({
    console,
    sessionStorage,
    fetch: async () => ({ json: async () => ({ ok: true, data: state }), text: async () => JSON.stringify({ ok: true, data: state }) }),
    window: { location: { hash: '#dashboard' }, sessionStorage, addEventListener: () => {}, scrollTo: () => {}, confirm: () => true },
    document: { getElementById: element, querySelector: () => null, querySelectorAll: () => [] },
    setTimeout,
    clearTimeout
  });
  const source = fs.readFileSync(path.join(__dirname, '../../app/public/operations.js'), 'utf8') + '\nthis.__wmitTest = { inquiryIdForBooking, openBookingRecord, openBookingFromDeparture, renderSelectedInquiry };';
  vm.runInContext(source, context, { filename: 'operations.js' });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(context.__wmitTest.inquiryIdForBooking(entities.Booking[0]), 'INQUIRY-1');
  context.__wmitTest.openBookingRecord('BOOKING-1');
  assert.equal(storage.get('wmit.operations.selectedInquiryId'), 'INQUIRY-1');
  assert.equal(context.window.location.hash, 'booking');

  storage.clear();
  context.window.location.hash = '#departures';
  context.__wmitTest.openBookingFromDeparture('BOOKING-1');
  assert.equal(storage.get('wmit.operations.selectedInquiryId'), 'INQUIRY-1');
  assert.equal(context.window.location.hash, 'booking');

  storage.clear();
  context.window.location.hash = '#dashboard';
  context.__wmitTest.openBookingRecord('BOOKING-MISSING');
  assert.equal(storage.has('wmit.operations.selectedInquiryId'), false);
  assert.equal(context.window.location.hash, '#dashboard');

  const freshMarkup = context.__wmitTest.renderSelectedInquiry({ inquiry: { inquiry_id: 'INQUIRY-2', client_id: 'CLIENT-1', state: 'NEW', current_requirements: { destination: 'Bangkok', duration_days: 5, nights: 4, adults: 2, children: 0, infants: 0, pax_count: 2, requirement_statuses: {} }, original_request: { destination: 'Bangkok' }, history: [{ type: 'ORIGINAL', value: { destination: 'Bangkok' } }] }, client: { display_name: 'Client' }, booking: null }, { destination: 'Bangkok', duration_days: 5, nights: 4, adults: 2, children: 0, infants: 0, pax_count: 2, requirement_statuses: {} });
  assert.equal(freshMarkup.includes('Original Client Request'), false);
  const changedMarkup = context.__wmitTest.renderSelectedInquiry({ inquiry: { inquiry_id: 'INQUIRY-2', client_id: 'CLIENT-1', state: 'NEW', current_requirements: { destination: 'Phuket', duration_days: 7, nights: 6, adults: 2, children: 1, infants: 0, pax_count: 3, requirement_statuses: {} }, original_request: { destination: 'Bangkok' }, history: [{ type: 'ORIGINAL', value: { destination: 'Bangkok' } }, { type: 'REQUIREMENTS_CHANGED', value: { destination: 'Phuket' }, at: '2026-08-14T10:00:00Z' }] }, client: { display_name: 'Client' }, booking: null }, { destination: 'Phuket', duration_days: 7, nights: 6, adults: 2, children: 1, infants: 0, pax_count: 3, requirement_statuses: {} });
  assert.equal(changedMarkup.includes('Original Client Request'), true);
  assert.equal(changedMarkup.includes('Requirement History (1 changes)'), true);
});

test('Phase 1 application routes Inquiry edits by Inquiry ID', () => {
  const app = createPhase1Application();
  const client = app.snapshot().data.entities.Client[0];
  const created = app.action({ action: 'createInquiry', actor: 'LOCAL_STAFF', input: { client_id: client.client_id, requirements: { destination: 'Bangkok', travel_month: '2026-11', duration_days: 5, adults: 2, children: 0, infants: 0 } } });
  assert.equal(created.ok, true);
  const updated = app.action({ action: 'updateInquiry', actor: 'LOCAL_STAFF', input: { inquiry_id: created.data.inquiry_id, requirements: { destination: 'Phuket', travel_month: '2026-12', duration_days: 7, adults: 2, children: 1, infants: 0, child_ages: [8] } } });
  assert.equal(updated.ok, true);
  assert.equal(updated.data.current_requirements.destination, 'Phuket');
  assert.equal(updated.data.current_requirements.nights, 6);
  assert.equal(updated.data.original_request.destination, 'Bangkok');
});
