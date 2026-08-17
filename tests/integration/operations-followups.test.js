'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhase1Application } = require('../../src/application/phase1');

test('Operations application generates one idempotent follow-up for the current Inquiry stage', () => {
  const app = createPhase1Application();
  const client = app.runtime.list('Client')[0];
  const inquiry = app.createInquiry({
    client_id: client.client_id,
    source: 'LOCAL_SYNTHETIC',
    requirements: { destination: 'Bangkok', travel_start: '2026-10-10', travel_end: '2026-10-14', pax_count: 2 }
  }, 'LOCAL_STAFF');
  assert.equal(inquiry.ok, true);

  const first = app.ensureAutomaticFollowUpTasks({}, 'LOCAL_STAFF');
  const second = app.ensureAutomaticFollowUpTasks({}, 'LOCAL_STAFF');
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.data.created_count, 1);
  assert.equal(second.data.created_count, 0);

  const tasks = app.runtime.list('Task', (task) => task.inquiry_id === inquiry.data.inquiry_id);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].task_type, 'RESEARCH_OPTIONS');
  assert.equal(tasks[0].source, 'AUTOMATIC_WORKFLOW_FOLLOW_UP');
});
