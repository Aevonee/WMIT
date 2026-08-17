'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhase1Runtime } = require('../../src/phase1/runtime');

const AUTH = { staff: ['SELECT_OPTION'] };
const ctx = () => ({ actor: 'staff' });

function setup() {
  const runtime = createPhase1Runtime({ config: { trustedActors: AUTH }, clock: () => new Date('2026-08-14T10:00:00+08:00') });
  const client = runtime.createClient({ display_name: 'Matrix Client' }, ctx()).data;
  const supplier = runtime.createSupplier({ display_name: 'Matrix Supplier' }, ctx()).data;
  return { runtime, client, supplier };
}

function addTrustedTariff(runtime, supplier, rateComponents) {
  const upload = runtime.uploadTariff({
    supplier_id: supplier.supplier_id,
    extraction_facts: [{ field_name: 'currency', normalized_value: 'PHP', confidence: 1 }, { field_name: 'rate_unit', normalized_value: 'PER_PERSON', confidence: 1 }],
    rate_components: rateComponents
  }, ctx());
  assert.equal(upload.ok, true);
  assert.equal(runtime.reviewTariff({ tariff_source_id: upload.data.tariff_source_id, approve: true }, ctx()).ok, true);
}

test('matrix matching supports duration ranges and preserves the calculated quantity', () => {
  const { runtime, client, supplier } = setup();
  const inquiry = runtime.createInquiry({ client_id: client.client_id, requirements: { destination: 'Bangkok', travel_start: '2026-11-10', travel_end: '2026-11-14', adults: 2, children: 0, infants: 0 } }, ctx()).data;
  addTrustedTariff(runtime, supplier, [
    { amount: '90.00', currency: 'PHP', rate_unit: 'PER_PERSON', quantity_driver: 'pax_count', conditions: { destination: 'Bangkok', duration_days_min: 4, duration_days_max: 6 } },
    { amount: '10.00', currency: 'PHP', rate_unit: 'PER_PERSON', quantity_driver: 'pax_count', conditions: { destination: 'Bangkok', duration_days: 7 } }
  ]);
  const result = runtime.matchOptions({ inquiry_id: inquiry.inquiry_id }, ctx());
  assert.equal(result.ok, true);
  assert.equal(result.data.candidates.length, 1);
  assert.equal(result.data.candidates[0].pricing_preview.supplier_cost_total, '180.00');
  assert.equal(result.data.candidates[0].match_details.matches.find((item) => item.field === 'duration_days_min').tariff, 4);
  assert.equal(result.data.excluded_candidates.find((item) => item.mismatches.some((mismatch) => mismatch.field === 'duration_days')).reason, 'REQUIREMENTS_NOT_MATCHED');
});

test('matrix matching enforces child age bands and explains exclusion', () => {
  const { runtime, client, supplier } = setup();
  const inquiry = runtime.createInquiry({ client_id: client.client_id, requirements: { destination: 'Bangkok', travel_start: '2026-11-10', travel_end: '2026-11-14', adults: 2, children: 1, infants: 0, child_ages: [12] } }, ctx()).data;
  addTrustedTariff(runtime, supplier, [{ amount: '100.00', currency: 'PHP', rate_unit: 'PER_PERSON', quantity_driver: 'pax_count', conditions: { destination: 'Bangkok', duration_days: 5, child_age_ranges: [{ min: 0, max: 5 }, { min: 6, max: 11 }] } }]);
  const blocked = runtime.matchOptions({ inquiry_id: inquiry.inquiry_id }, ctx());
  assert.equal(blocked.ok, true);
  assert.equal(blocked.data.candidates.length, 0);
  const mismatch = blocked.data.excluded_candidates[0].mismatches.find((item) => item.field === 'child_age_ranges');
  assert.equal(mismatch.reason, 'CHILD_AGE_OUT_OF_RANGE');

  assert.equal(runtime.updateInquiry(inquiry.inquiry_id, { requirements: { destination: 'Bangkok', travel_start: '2026-11-10', travel_end: '2026-11-14', adults: 2, children: 1, infants: 0, child_ages: [8] } }, ctx()).ok, true);
  const matched = runtime.matchOptions({ inquiry_id: inquiry.inquiry_id }, ctx());
  assert.equal(matched.data.candidates.length, 1);
});
