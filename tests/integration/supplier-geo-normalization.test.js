'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhase1Runtime } = require('../../src/phase1/runtime');
const { buildGeoPlan, applyGeoFixes, CANONICAL_COUNTRIES } = require('../../src/imports/supplier-geo');

test('buildGeoPlan canonicalizes city and variant locations, leaves clean and multi-country values alone', () => {
  const suppliers = [
    { supplier_id: 'S1', display_name: 'Dubai Co', country: 'Dubai', industry: 'Tour Operator' },
    { supplier_id: 'S2', display_name: 'Istanbul Co', country: 'Istanbul', industry: 'Airline' },
    { supplier_id: 'S3', display_name: 'Taipei Co', country: 'Taipei, Taiwan', industry: 'Airlines' },
    { supplier_id: 'S4', display_name: 'Clean Co', country: 'Philippines', industry: 'Tourism / Hospitality' },
    { supplier_id: 'S5', display_name: 'Multi Co', country: 'Philippines / South Korea', industry: 'Others' },
    { supplier_id: 'S6', display_name: 'No Geo', country: '', industry: '' },
    { supplier_id: 'S7', display_name: 'Case Co', country: 'dubai, uae', industry: 'airline' }
  ];
  const plan = buildGeoPlan(suppliers);
  const byId = new Map(plan.map((entry) => [entry.supplier_id, entry]));

  assert.deepEqual([...byId.keys()].sort(), ['S1', 'S2', 'S3', 'S7']);
  assert.equal(byId.get('S1').changes.country, 'UAE');
  assert.equal(byId.get('S2').changes.country, 'Turkey');
  assert.equal(byId.get('S3').changes.country, 'Taiwan');
  assert.equal(byId.get('S7').changes.country, 'UAE');
  assert.equal(byId.get('S7').changes.industry, 'Airlines');
  assert.equal(byId.get('S2').changes.industry, 'Airlines');
  assert.equal(byId.get('S3').changes.industry, undefined);
  assert.equal(byId.get('S4'), undefined);
  assert.equal(byId.get('S5'), undefined);
});

test('applyGeoFixes writes audited updates and is idempotent', () => {
  const runtime = createPhase1Runtime({ clock: () => new Date('2026-08-18T12:00:00+08:00') });
  runtime.createSupplier({ display_name: 'Dubai Test Co', country: 'Dubai' }, { actor: 'staff' });
  runtime.createSupplier({ display_name: 'Sydney Test Co', country: 'Sydney Australia' }, { actor: 'staff' });

  const plan = buildGeoPlan(runtime.list('Supplier'));
  assert.equal(plan.length, 2);
  const report = applyGeoFixes(runtime, plan);
  assert.equal(report.updated, 2);
  assert.equal(report.failures.length, 0);

  const dubai = runtime.list('Supplier', (s) => s.display_name === 'Dubai Test Co')[0];
  const sydney = runtime.list('Supplier', (s) => s.display_name === 'Sydney Test Co')[0];
  assert.equal(dubai.country, 'UAE');
  assert.equal(sydney.country, 'Australia');

  const audits = runtime.auditLog.list().filter((event) => event.action === 'UPDATE' && event.entity_type === 'Supplier');
  assert.equal(audits.length, 2);
  assert.ok(audits.every((event) => event.details && event.details.old_values && event.details.new_values));

  const second = applyGeoFixes(runtime, buildGeoPlan(runtime.list('Supplier')));
  assert.equal(second.updated, 0);
});

test('canonical country list has no duplicates and covers the fix targets', () => {
  assert.equal(new Set(CANONICAL_COUNTRIES).size, CANONICAL_COUNTRIES.length);
  ['UAE', 'Turkey', 'Vietnam', 'Indonesia', 'India', 'Philippines', 'Australia', 'Taiwan', 'Japan'].forEach((country) => {
    assert.ok(CANONICAL_COUNTRIES.includes(country), country + ' missing from canonical list');
  });
});
