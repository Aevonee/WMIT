'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createPhase1Runtime, ACTIONS } = require('../../src/phase1/runtime');
const { createPhase1Application } = require('../../src/application/phase1');
const { makeQuotationApprovable } = require('../helpers/quotation-contract');

const AUTH = {
  staff: [ACTIONS.EDIT_DRAFT_PRICING, ACTIONS.ACCEPT_QUOTATION],
  manager: [ACTIONS.APPROVE_QUOTATION]
};
const ctx = (actor) => ({ actor: actor || 'staff', correlationId: 'QUOTATION-WORKSPACE-TEST' });

function setup() {
  const runtime = createPhase1Runtime({ clock: () => new Date('2026-08-14T10:00:00+08:00'), config: { trustedActors: AUTH } });
  const client = runtime.createClient({ display_name: 'Quotation Workspace Client', legal_name: 'Quotation Workspace Client' }, ctx()).data;
  const supplier = runtime.createSupplier({ display_name: 'Quotation Workspace Supplier', legal_name: 'Quotation Workspace Supplier' }, ctx()).data;
  const inquiry = runtime.createInquiry({ client_id: client.client_id, requirements: { destination: 'Bangkok', travel_start: '2026-11-01', travel_end: '2026-11-05', nights: 4, adults: 2 } }, ctx()).data;
  const quotation = runtime.createQuotation({ quotation_id: 'QUOTATION-2026-009001', inquiry_id: inquiry.inquiry_id, client_id: client.client_id, quotation_date: '2026-08-14', valid_until: '2026-08-21', destination: 'Bangkok', travel_start: '2026-11-01', travel_end: '2026-11-05', pax_count: 2, currency: 'PHP', supplier_cost_total: '100.00', inclusions: 'Hotel and transfer', exclusions: 'Personal expenses', payment_terms: 'Balance before departure' }, ctx()).data;
  return { runtime, client, supplier, inquiry, quotation };
}

test('Phase 1 quotation workspace supports manual draft editing and safe client preview', () => {
  const { runtime, client, supplier, quotation } = setup();
  const added = runtime.createQuotationItem({ quotation_id: quotation.quotation_id, service_type: 'Hotel', description: 'Client-facing hotel stay', supplier_id: supplier.supplier_id, quantity: 2, unit_cost: '4000.00', unit_selling_price: '5000.00', currency: 'PHP', service_start: '2026-11-01', service_end: '2026-11-05' }, ctx());
  assert.equal(added.ok, true);
  assert.equal(added.data.quotation.supplier_cost_total, '8000.00');
  assert.equal(added.data.quotation.client_total, '10000.00');

  const saved = runtime.updateQuotation({ quotation_id: quotation.quotation_id, client_notes: 'Please bring a valid passport.', internal_notes: 'Internal supplier discussion only.', itinerary: JSON.stringify([{ day: 1, date: '2026-11-01', city: 'Bangkok', title: 'Arrival', activities: 'Airport transfer', meals: 'Dinner', overnight: 'Bangkok hotel', notes: '' }]) }, ctx());
  assert.equal(saved.ok, true);
  const preview = runtime.getClientQuotationPreview(quotation.quotation_id);
  assert.equal(preview.ok, true);
  assert.equal(preview.data.items[0].service_type, 'Tour Package');
  assert.equal(preview.data.items[0].amount, 10000);
  assert.equal(preview.data.quotation.itinerary_days[0].city, 'Bangkok');
  assert.equal(preview.data.quotation.client_notes, 'Please bring a valid passport.');
  const text = JSON.stringify(preview.data);
  assert.doesNotMatch(text, /4000/);
  assert.doesNotMatch(text, /Internal supplier discussion/);
  assert.doesNotMatch(text, /Quotation Workspace Supplier/);
  assert.equal(Object.prototype.hasOwnProperty.call(preview.data.items[0], 'supplier_id'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(preview.data.items[0], 'unit_cost'), false);
});

test('quotation flight details are stored and exposed in the client-safe preview without supplier data', () => {
  const { runtime, client, supplier } = setup();
  const quotation = runtime.createQuotation({ client_id: client.client_id, quotation_date: '2026-08-14', valid_until: '2026-08-21', destination: 'Tokyo', travel_start: '2026-11-01', travel_end: '2026-11-05', pax_count: 2, currency: 'PHP', supplier_cost_total: '0.00' }, ctx()).data;
  const item = runtime.createQuotationItem({ quotation_id: quotation.quotation_id, service_type: 'Flight', description: 'Manila to Tokyo', supplier_id: supplier.supplier_id, quantity: 1, unit_cost: '20000.00', unit_selling_price: '25000.00', currency: 'PHP', service_start: '2026-11-01', airline: 'Example Air', flight_number: 'EA 123', departure_airport: 'MNL', arrival_airport: 'NRT', departure_time: '08:00', arrival_time: '13:00' }, ctx());
  assert.equal(item.ok, true);
  const preview = runtime.getClientQuotationPreview(quotation.quotation_id);
  assert.equal(preview.ok, true);
  assert.equal(preview.data.items[0].flight_number, 'EA 123');
  assert.equal(preview.data.items[0].departure_airport, 'MNL');
  assert.equal(preview.data.items[0].arrival_airport, 'NRT');
  assert.equal(preview.data.items[0].supplier_id, undefined);
});

test('quotation-level flight details support multiple flights independently of pricing items', () => {
  const { runtime, client } = setup();
  const quotation = runtime.createQuotation({ client_id: client.client_id, quotation_date: '2026-08-14', valid_until: '2026-08-21', destination: 'Tokyo', travel_start: '2026-11-01', travel_end: '2026-11-05', pax_count: 2, currency: 'PHP', supplier_cost_total: '0.00', flight_details: JSON.stringify([
    { flight_date: '2026-11-01', airline: 'Example Air', flight_number: 'EA 123', departure_airport: 'MNL', arrival_airport: 'NRT', departure_time: '08:00', arrival_time: '13:00' },
    { flight_date: '2026-11-05', airline: 'Example Air', flight_number: 'EA 124', departure_airport: 'NRT', arrival_airport: 'MNL', departure_time: '14:00', arrival_time: '18:00' }
  ]) }, ctx()).data;
  const preview = runtime.getClientQuotationPreview(quotation.quotation_id);
  assert.equal(preview.ok, true);
  assert.equal(preview.data.quotation.flight_details.length, 2);
  assert.equal(preview.data.quotation.flight_details[1].flight_number, 'EA 124');
});

test('quotation flight details are edited in a separate quotation area and rendered as a client section', () => {
  const source = fs.readFileSync('app/public/operations.js', 'utf8');
  assert.match(source, /quotationFlightDetailsMarkup/);
  assert.match(source, /addClientFlightDetailsSection/);
  assert.match(source, /qflight-/);
  assert.match(source, /addQuotationFlight/);
  assert.match(source, /removeQuotationFlight/);
  assert.match(source, /flight_details/);
  assert.match(source, /client-flight-details/);
  assert.match(source, /container\.querySelectorAll\('\.quotation-items \.flight-details, #new-qitem-flight-details'\)/);
});

test('client quotation preview action accepts the UI input shape and approval can be cancelled before acceptance', () => {
  const { runtime, quotation } = setup();
  const app = createPhase1Application({ runtime });
  const actionPreview = app.action({ action: 'getClientQuotationPreview', input: { quotation_id: quotation.quotation_id }, actor: 'LOCAL_STAFF' });
  assert.equal(actionPreview.ok, true);
  assert.equal(makeQuotationApprovable(runtime, quotation, ctx('staff')).ok, true);

  assert.equal(runtime.approveQuotation({ quotation_id: quotation.quotation_id }, ctx('manager')).ok, true);
  const cancelled = runtime.cancelQuotationApproval({ quotation_id: quotation.quotation_id, reason: 'Pricing needs another manager review.' }, ctx('manager'));
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.data.status, 'DRAFT');
  assert.equal(cancelled.data.staff_review_required, true);
  assert.equal(cancelled.data.approval_cancellation_reason, 'Pricing needs another manager review.');

  assert.equal(runtime.approveQuotation({ quotation_id: quotation.quotation_id }, ctx('manager')).ok, true);
  assert.equal(runtime.acceptQuotation({ quotation_id: quotation.quotation_id, accepted_by: 'Client', acceptance_reference: 'EMAIL-1' }, ctx('staff')).ok, true);
  const blocked = runtime.cancelQuotationApproval({ quotation_id: quotation.quotation_id, reason: 'Too late.' }, ctx('manager'));
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'QUOTATION_ACCEPTANCE_EXISTS');
});

test('Phase 1 quotation workspace reorders/removes draft items and locks approved quotations', () => {
  const { runtime, supplier, quotation } = setup();
  const first = runtime.createQuotationItem({ quotation_id: quotation.quotation_id, service_type: 'Tour', description: 'City tour', supplier_id: supplier.supplier_id, quantity: 1, unit_cost: '100.00', unit_selling_price: '150.00', currency: 'PHP', line_order: 1 }, ctx()).data.item;
  const second = runtime.createQuotationItem({ quotation_id: quotation.quotation_id, service_type: 'Transfer', description: 'Airport transfer', supplier_id: supplier.supplier_id, quantity: 1, unit_cost: '50.00', unit_selling_price: '80.00', currency: 'PHP', line_order: 2 }, ctx()).data.item;
  assert.equal(runtime.updateQuotationItem({ quotation_item_id: first.quotation_item_id, description: 'Updated city tour', quantity: 2, unit_cost: '100.00', unit_selling_price: '160.00', currency: 'PHP' }, ctx()).ok, true);
  assert.equal(runtime.reorderQuotationItems({ quotation_id: quotation.quotation_id, quotation_item_ids: [second.quotation_item_id, first.quotation_item_id] }, ctx()).ok, true);
  assert.equal(runtime.quotationItems(quotation.quotation_id)[0].quotation_item_id, second.quotation_item_id);
  assert.equal(runtime.removeQuotationItem({ quotation_item_id: second.quotation_item_id }, ctx()).ok, true);
  assert.equal(runtime.quotationItems(quotation.quotation_id).length, 1);
  assert.equal(runtime.approveQuotation({ quotation_id: quotation.quotation_id }, ctx('manager')).ok, true);
  assert.equal(runtime.updateQuotation({ quotation_id: quotation.quotation_id, destination: 'Phuket' }, ctx()).error.code, 'QUOTATION_NOT_DRAFT');
  assert.equal(runtime.updateQuotationItem({ quotation_item_id: first.quotation_item_id, description: 'Unsafe edit', currency: 'PHP' }, ctx()).error.code, 'QUOTATION_NOT_DRAFT');
  assert.equal(runtime.removeQuotationItem({ quotation_item_id: first.quotation_item_id }, ctx()).error.code, 'QUOTATION_NOT_DRAFT');
});

test('Operations quotation UI exposes editor, preview, print, and lifecycle controls without internal fields in preview markup', () => {
  const source = fs.readFileSync('app/public/operations.js', 'utf8');
  const html = fs.readFileSync('app/public/operations.html', 'utf8');
  assert.match(source, /function quotationEditorMarkup\(/);
  assert.match(source, /function previewQuotation\(/);
  assert.match(source, /function printQuotation\(/);
  assert.match(source, /createQuotationItem/);
  assert.match(source, /updateQuotationItem/);
  assert.match(source, /reorderQuotationItems/);
  assert.match(source, /cancelQuotationApproval/);
  assert.match(source, /client_notes/);
  assert.match(source, /Internal cost/);
  assert.match(source, /Selling price/);
  assert.match(source, /supplier_cost_total/);
  const previewFunction = source.slice(source.indexOf('function clientQuotationPreviewMarkup'), source.indexOf('function quotationEditorMarkup'));
  assert.doesNotMatch(previewFunction, /supplier_cost_total|unit_cost|supplier_id|internal_notes/);
  assert.match(html, /@media print/);
});
