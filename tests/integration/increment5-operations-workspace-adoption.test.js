'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPhase1Application, LOCAL_AUTH } = require('../../src/application/phase1');

test('local application snapshots expose the authoritative generic case projections', () => {
  const app = createPhase1Application({ seedSynthetic: false, config: { trustedActors: LOCAL_AUTH } });
  const client = app.createClient({ display_name: 'Workspace Test Client', legal_name: 'Workspace Test Client' }, 'LOCAL_STAFF');
  assert.equal(client.ok, true);
  const inquiry = app.createInquiry({ client_id: client.data.client_id, requirements: { destination: 'Tokyo', travel_month: '2026-11', duration_days: 5, pax_count: 2 } }, 'LOCAL_STAFF');
  assert.equal(inquiry.ok, true);
  const snapshot = app.snapshot();
  assert.equal(snapshot.ok, true);
  assert.equal(Array.isArray(snapshot.data.caseProjections), true);
  assert.equal(snapshot.data.caseProjections.length, 1);
  assert.equal(snapshot.data.caseProjections[0].identity.inquiryId, inquiry.data.inquiry_id);
  assert.equal(snapshot.data.caseProjections[0].currentStage, 'OPTIONS');
  assert.equal(snapshot.data.caseProjections[0].nextAction.code, 'PREPARE_OPTIONS');
});

test('Operations Workspace adopts projection and controlled financial/snapshot actions', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'public', 'operations.js'), 'utf8');
  assert.match(source, /state\.caseProjections/);
  assert.match(source, /projection\.nextAction/);
  assert.match(source, /projection\.finance/);
  assert.match(source, /client_obligation_id: obligationId/);
  assert.match(source, /createBookingItemsFromAcceptedSnapshot/);
  assert.match(source, /createBookingPaymentObligations/);
  assert.doesNotMatch(source, /service_type: 'PACKAGE', description: 'Selected commercial option'/);
  assert.doesNotMatch(source, /skipAutomaticTasks\) void syncAutomaticTasks/);
});
