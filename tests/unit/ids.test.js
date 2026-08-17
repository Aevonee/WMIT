'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { IdGenerator } = require('../../src/ids/id-generator');
const { ID_PATTERN } = require('../../src/validation/validator');

test('generates stable year-based and non-year-based IDs', () => {
  const generator = new IdGenerator({ clock: () => new Date('2026-08-12T00:00:00Z') });
  assert.equal(generator.next('CLIENT'), 'CLIENT-000001');
  assert.equal(generator.next('CLIENT'), 'CLIENT-000002');
  assert.equal(generator.next('BOOKING', { yearBased: true }), 'BOOKING-2026-000001');
  assert.equal(generator.next('BOOKING', { yearBased: true }), 'BOOKING-2026-000002');
});

test('year-based counters separate years and generated IDs match the documented pattern', () => {
  const generator = new IdGenerator({ clock: () => new Date('2026-08-12T00:00:00Z') });
  const first = generator.next('LEAD', { yearBased: true });
  const nextYear = generator.next('LEAD', { yearBased: true, year: 2027 });
  assert.match(first, ID_PATTERN);
  assert.match(nextYear, ID_PATTERN);
  assert.equal(first, 'LEAD-2026-000001');
  assert.equal(nextYear, 'LEAD-2027-000001');
});

test('explicit IDs reserve their sequence so later generated IDs do not collide', () => {
  const generator = new IdGenerator({ clock: () => new Date('2026-08-12T00:00:00Z') });
  generator.reserve('LEAD', 'LEAD-2026-000010', { yearBased: true });
  generator.reserve('SUPPLIER', 'SUPPLIER-TEST-000010', { yearBased: false });
  assert.equal(generator.next('LEAD', { yearBased: true }), 'LEAD-2026-000011');
  assert.equal(generator.next('SUPPLIER'), 'SUPPLIER-000011');
});
