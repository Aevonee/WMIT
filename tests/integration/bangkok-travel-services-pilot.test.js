'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { extractBangkokTravelServicesDocx } = require('../../src/document-intelligence/bangkok-travel-services');
const { createPhase1Runtime, ACTIONS } = require('../../src/phase1/runtime');

const source = path.join(__dirname, '../../docs/tariff-pilots/bangkok-travel-services/source/2025 FREE AND EASY PACKAGE April to October.docx');
const AUTH = {
  staff: [ACTIONS.SELECT_OPTION, ACTIONS.RESERVE_SUPPLIER, ACTIONS.ALLOCATE_PAYMENT],
  manager: [ACTIONS.VERIFY_PAYMENT, ACTIONS.APPROVE_QUOTATION, ACTIONS.APPROVE_PAYABLE, ACTIONS.SUPPLIER_PAYMENT, ACTIONS.REFUND, ACTIONS.CONFIRM_COMMITMENT]
};
const ctx = (actor) => ({ actor: actor || 'staff', correlationId: 'BANGKOK-TARIFF-PILOT' });

function extracted() { return extractBangkokTravelServicesDocx(source); }

function setup() {
  const runtime = createPhase1Runtime({ clock: () => new Date('2026-08-13T10:00:00+08:00'), config: { trustedActors: AUTH } });
  const client = runtime.createClient({ display_name: 'Bangkok Pilot Client' }, ctx());
  const supplier = runtime.createSupplier({ display_name: 'Bangkok Travel Services', capabilities: ['DMC', 'REAL-TARIFF-PILOT'] }, ctx());
  const inquiry = runtime.createInquiry({
    client_id: client.data.client_id,
    requirements: { destination: 'Bangkok', travel_start: '2025-05-10', travel_end: '2025-05-12', nights: 2, pax_count: 2, hotel: 'AIRA HOTEL (SUKHUMVIT 11) 4*', room_arrangement: 'SGL' }
  }, ctx());
  return { runtime, client: client.data, supplier: supplier.data, inquiry: inquiry.data };
}

function uploadAndApprove(runtime, supplierId) {
  const data = extracted();
  const upload = runtime.uploadTariff(Object.assign({ supplier_id: supplierId }, data), ctx());
  assert.equal(upload.ok, true);
  const failed = runtime.reviewTariff({ tariff_source_id: upload.data.tariff_source_id, approve: true }, ctx('manager'));
  assert.equal(failed.ok, false);
  assert.ok(['TARIFF_REVIEW_REQUIRED', 'TARIFF_CURRENCY_REQUIRED', 'TARIFF_RATE_UNIT_REQUIRED'].includes(failed.error.code));
  const facts = runtime.list('TariffExtractionFact', (fact) => fact.tariff_source_id === upload.data.tariff_source_id);
  const rates = runtime.list('TariffRateComponent', (rate) => rate.tariff_source_id === upload.data.tariff_source_id);
  const corrections = {};
  facts.forEach((fact) => {
    if (fact.field_name === 'rate_currency') corrections[fact.tariff_extraction_fact_id] = { normalized_value: 'USD', confidence: 1 };
    if (fact.field_name === 'rate_unit') corrections[fact.tariff_extraction_fact_id] = { normalized_value: 'PER_PERSON', confidence: 1 };
  });
  const approved = runtime.reviewTariff({
    tariff_source_id: upload.data.tariff_source_id,
    approve: true,
    corrections,
    confirmed_rate_ids: rates.filter((rate) => rate.requires_explicit_review).map((rate) => rate.tariff_rate_component_id)
  }, ctx('manager'));
  assert.equal(approved.ok, true);
  return { data, upload: approved.data };
}

test('Bangkok source is natively extractable and preserves real matrix structure', () => {
  const data = extracted();
  assert.equal(data.source.source_format, 'DOCX');
  assert.equal(data.extraction_summary.method, 'NATIVE_DOCX_OOXML');
  assert.equal(data.extraction_summary.tables, 2);
  assert.ok(data.rate_components.length >= 500);
  assert.ok(data.rate_components.some((rate) => rate.conditions.hotel.includes('AIRA HOTEL')));
  assert.ok(data.rate_components.some((rate) => rate.conditions.room_arrangement === 'SGL' && rate.conditions.duration === '3D2N'));
  assert.ok(data.rate_components.some((rate) => rate.conditions.room_arrangement === 'TRP'));
  assert.ok(data.rate_components.some((rate) => rate.requires_explicit_review));
  assert.equal(data.extraction_facts.find((fact) => fact.field_name === 'rate_currency').ambiguous, true);
  assert.equal(data.extraction_facts.find((fact) => fact.field_name === 'rate_unit').ambiguous, true);
  assert.ok(data.itinerary_components.some((item) => item.content_type === 'TRANSFER'));
  assert.ok(data.itinerary_components.some((item) => item.content_type === 'TOUR'));
  assert.ok(data.rate_components[0].source_provenance.table);
  assert.ok(data.rate_components[0].source_provenance.row);
  assert.ok(data.rate_components[0].source_provenance.cell);
});

test('Bangkok pilot blocks ambiguous trust, then calculates the staff-confirmed matrix cell', () => {
  const { runtime, supplier, inquiry, client } = setup();
  const { data } = uploadAndApprove(runtime, supplier.supplier_id);
  const matched = runtime.matchOptions({ inquiry_id: inquiry.inquiry_id }, ctx());
  assert.equal(matched.ok, true);
  assert.equal(matched.data.candidates.length, 1);
  const option = matched.data.candidates[0];
  assert.equal(option.selected, false);
  assert.ok(option.match_explanation.some((line) => /AIRA HOTEL/i.test(line)));
  assert.ok(option.source_provenance.rate.cell);
  assert.equal(runtime.selectOption({ commercial_option_id: option.commercial_option_id }, ctx()).ok, true);
  const quote = runtime.createQuotation({ commercial_option_id: option.commercial_option_id, client_id: client.client_id, pricing_context_type: 'STANDARD' }, ctx());
  assert.equal(quote.ok, true);
  assert.equal(quote.data.supplier_cost_total, '700.00');
  assert.equal(quote.data.currency, 'USD');
  assert.equal(quote.data.rate_calculation_lines[0].unit, 'PER_PERSON');
  assert.equal(quote.data.rate_calculation_lines[0].quantity, 2);
  assert.ok(Array.isArray(quote.data.itinerary_components));
  assert.ok(quote.data.provenance.rate.cell);
  assert.equal(data.warnings.length, 2);
});

test('Bangkok pilot returns multiple requirements-first options and Find More Options excludes prior choices', () => {
  const { runtime, supplier, inquiry, client } = setup();
  uploadAndApprove(runtime, supplier.supplier_id);
  const broadInquiry = runtime.createInquiry({
    client_id: client.client_id,
    requirements: { destination: 'Bangkok', travel_start: '2025-05-10', travel_end: '2025-05-12', nights: 2, pax_count: 2, region: 'SUKHUMVIT', room_arrangement: 'SGL' }
  }, ctx()).data;
  const broad = runtime.matchOptions({ inquiry_id: broadInquiry.inquiry_id }, ctx());
  assert.equal(broad.ok, true);
  assert.ok(broad.data.candidates.length > 1);
  assert.ok(broad.data.candidates.every((option) => option.selected === false));
  const rejected = broad.data.candidates[0];
  const more = runtime.findMoreOptions({
    inquiry_id: broadInquiry.inquiry_id,
    rejected_option_ids: [rejected.commercial_option_id],
    requirements: { region: 'PATTAYA', room_arrangement: 'SGL' }
  }, ctx());
  assert.equal(more.ok, true);
  assert.ok(more.data.candidates.length >= 1);
  assert.ok(more.data.candidates.every((option) => option.commercial_option_id !== rejected.commercial_option_id));
  assert.ok(more.data.candidates.every((option) => option.selected === false));
});

test('Bangkok pilot does not allow an unreviewed or ambiguous rate to calculate', () => {
  const { runtime, supplier, inquiry } = setup();
  const data = extracted();
  const upload = runtime.uploadTariff(Object.assign({ supplier_id: supplier.supplier_id }, data), ctx());
  assert.equal(upload.ok, true);
  assert.equal(runtime.matchOptions({ inquiry_id: inquiry.inquiry_id }, ctx()).data.candidates.length, 0);
  const firstRate = runtime.list('TariffRateComponent')[0];
  assert.equal(firstRate.currency_status, 'MISSING');
  assert.equal(firstRate.rate_unit_status, 'MISSING');
});
