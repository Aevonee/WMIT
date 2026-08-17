'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhase1Application } = require('../../src/application/phase1');

test('Phase 1 application exposes the case projection as a read-only generic operation', () => {
  const app = createPhase1Application({ seedSynthetic: false });
  const client = app.createClient({ display_name: 'Tokyo Custom Client', legal_name: 'Tokyo Custom Client' }, 'LOCAL_STAFF').data;
  const inquiry = app.createInquiry({ client_id: client.client_id, requirements: { destination: 'Tokyo', travel_start: '2026-11-10', travel_end: '2026-11-14', nights: 4, pax_count: 2 } }, 'LOCAL_STAFF').data;
  const before = JSON.stringify(app.snapshot().data.entities);

  const direct = app.getCaseProjection({ inquiry_id: inquiry.inquiry_id, asOf: '2026-08-15T00:00:00.000Z' });
  const routed = app.action({ action: 'getCaseProjection', input: { inquiry_id: inquiry.inquiry_id, asOf: '2026-08-15T00:00:00.000Z' } });

  assert.equal(direct.ok, true);
  assert.equal(routed.ok, true);
  assert.equal(direct.data.currentStage, 'OPTIONS');
  assert.deepEqual(routed.data, direct.data);
  assert.equal(direct.meta.read_only, true);
  assert.equal(JSON.stringify(app.snapshot().data.entities), before);
});
