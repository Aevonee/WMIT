'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPhase1Runtime } = require('../../src/phase1/runtime');

test('new quotations snapshot workspace payment-term defaults', () => {
  const runtime = createPhase1Runtime({ clock: () => new Date('2026-08-15T10:00:00.000Z') });
  const client = runtime.createClient({ display_name: 'Defaults Client', legal_name: 'Defaults Client' }, { actor: 'LOCAL_STAFF' }).data;
  const inquiry = runtime.createInquiry({ client_id: client.client_id, requirements: { destination: 'Tokyo', travel_month: '2026-11', duration_days: 5, adults: 2, children: 0, infants: 0 } }, { actor: 'LOCAL_STAFF' }).data;
  const quote = runtime.createQuotation({ client_id: client.client_id, inquiry_id: inquiry.inquiry_id, supplier_cost_total: '100.00', currency: 'PHP' }, { actor: 'LOCAL_STAFF' });
  assert.equal(quote.ok, true);
  assert.equal(quote.data.payment_terms, '50% deposit upon confirmation; balance due 30 business days before departure.');
  assert.equal(quote.data.valid_until, '2026-08-22');
  assert.equal(quote.data.quotation_defaults_snapshot.validityDays, 7);
});

test('Operations Workspace contains the case-directed UX contract', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'public', 'operations.js'), 'utf8');
  assert.match(source, /caseCommandMarkup/);
  assert.match(source, /openNextAction/);
  assert.match(source, /humanizeError/);
  assert.match(source, /requirementChangeSummary/);
  assert.match(source, /clientHistoryMarkup/);
  assert.match(source, /profitabilityMarkup/);
  assert.match(source, /financeContext/);
  assert.match(source, /quotationDefaultsMarkup/);
});

test('synthetic test-field helper fills only visible required controls', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'public', 'operations.js'), 'utf8');
  assert.match(source, /document\.querySelector\('\.workspace-view\.active'\)/);
  assert.match(source, /const requiredIds = new Set/);
  assert.match(source, /control\.required/);
  assert.match(source, /details:not\(\[open\]\)/);
  assert.match(source, /No empty required fields on this screen/);
  assert.match(source, /Synthetic ' \+ serviceType\.toLowerCase\(\)/);
  assert.match(source, /Supplier request/);
  assert.match(source, /services\.length > 1 \? ' ' \+ \(index \+ 1\)/);
  assert.doesNotMatch(source, /document\.querySelectorAll\('input, textarea, select'\)\.filter\(\(control\) => !control\.disabled/);
});

test('required-field guidance and paid-booking monitoring are visible in the Operations UI contract', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'public', 'operations.js'), 'utf8');
  assert.match(source, /function focusRequiredField/);
  assert.match(source, /scrollIntoView\(\{ behavior: 'smooth', block: 'center' \}\)/);
  assert.match(source, /required-attention/);
  assert.match(source, /bookingMonitoringMarkup/);
  assert.match(source, /Rooming list/);
  assert.match(source, /Open documents/);
  assert.match(source, /Open follow-ups/);
  assert.match(source, /FULLY_FUNDED/);
  assert.match(source, /new-obligation-sequence/);
  assert.match(source, /monitoring-rooming-group/);
  assert.match(source, /rooming-person/);
  assert.match(source, /hotel room number/);
  assert.match(source, /enhanceRoomingControls/);
  assert.match(source, /addLeadPaxRooming/);
});
