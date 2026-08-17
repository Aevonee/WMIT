'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhase1Application } = require('../../src/application/phase1');

function ctx(actor = 'LOCAL_STAFF') { return actor; }

test('operations core supports client creation, editing, and inquiry linkage', () => {
  const app = createPhase1Application({ seedSynthetic: false });
  const created = app.createClient({ display_name: 'Maria Santos', primary_email: 'maria@example.test' }, ctx());
  assert.equal(created.ok, true);
  assert.equal(created.data.legal_name, 'Maria Santos');

  const edited = app.updateClient({ client_id: created.data.client_id, changes: { primary_phone: '+639001112222' } }, ctx());
  assert.equal(edited.ok, true);
  assert.equal(edited.data.primary_phone, '+639001112222');

  const inquiry = app.createInquiry({
    client_id: created.data.client_id,
    source: 'Website',
    requirements: { destination: 'Bangkok', travel_month: '2026-11', duration_days: 5, adults: 2 }
  }, ctx());
  assert.equal(inquiry.ok, true);
  assert.equal(inquiry.data.client_id, created.data.client_id);
  assert.equal(inquiry.data.current_requirements.nights, 4);
});

test('sub-agent directory supports multiple roles and rejects roleless records', () => {
  const app = createPhase1Application({ seedSynthetic: false });
  const invalid = app.createSubAgent({ display_name: 'No Role Partner' }, ctx());
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'SUB_AGENT_ROLE_REQUIRED');

  const created = app.createSubAgent({ display_name: 'Island Partner Travel', roles: ['REFERRAL_PARTNER', 'RESELLER'] }, ctx());
  assert.equal(created.ok, true);
  assert.deepEqual(created.data.roles, ['REFERRAL_PARTNER', 'RESELLER']);

  const edited = app.updateSubAgent({ sub_agent_id: created.data.sub_agent_id, changes: { roles: ['B2B_AGENCY'] } }, ctx());
  assert.equal(edited.ok, true);
  assert.deepEqual(edited.data.roles, ['B2B_AGENCY']);
});

test('global follow-ups, deadlines, and communications can exist without a selected inquiry', () => {
  const app = createPhase1Application({ seedSynthetic: false });
  const client = app.createClient({ display_name: 'Deadline Test Client' }, ctx()).data;
  const task = app.createTask({ title: 'Collect passport scans', description: 'Collect passport scans', task_type: 'DOCUMENT_FOLLOW_UP', priority: 'HIGH', due_date: '2026-09-01', client_id: client.client_id }, ctx());
  assert.equal(task.ok, true);
  const communication = app.createCommunication({ client_id: client.client_id, channel: 'WhatsApp', outcome: 'Client will send documents tomorrow' }, ctx());
  assert.equal(communication.ok, true);
  assert.equal(app.runtime.list('Task').length, 1);
  assert.equal(app.runtime.list('CommunicationActivity').length, 1);
});

