'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createPhase1Runtime, ACTIONS } = require('../../src/phase1/runtime');
const { createPhase1Application } = require('../../src/application/phase1');
const { createMvpServer } = require('../../app/server');

const CLOCK = () => new Date('2026-08-20T09:00:00Z');
const TODAY = '2026-08-20';

const AUTH = {
  staff: [ACTIONS.SELECT_OPTION, ACTIONS.ALLOCATE_PAYMENT, ACTIONS.ACCEPT_QUOTATION, ACTIONS.EDIT_DRAFT_PRICING, ACTIONS.CONFIGURE_SETTINGS],
  manager: [ACTIONS.APPROVE_QUOTATION, ACTIONS.VERIFY_PAYMENT]
};
const staff = () => ({ actor: 'staff', correlationId: 'AGENT-PROPOSAL-TEST' });

function makeRuntime() {
  return createPhase1Runtime({ clock: CLOCK, config: { trustedActors: AUTH } });
}

function makeClient(runtime, name) {
  return runtime.createClient({ display_name: name || 'Agent Client', primary_email: 'agent@example.test' }, staff()).data;
}

function makeInquiry(runtime, clientId, options) {
  const settings = options || {};
  return runtime.createInquiry({
    client_id: clientId,
    state: settings.state === undefined ? 'NEW' : settings.state,
    requirements: { destination: settings.destination || 'Cebu', travel_start: '2026-12-10', travel_end: '2026-12-14', adults: 2 }
  }, staff()).data;
}

function makeQuotation(runtime, clientId, quotationDate) {
  return runtime.createQuotation({
    client_id: clientId,
    destination: 'Cebu',
    supplier_cost_total: '41500.00',
    client_total: '50000.00',
    currency: 'PHP',
    quotation_date: quotationDate || TODAY
  }, staff()).data;
}

function openProposals(runtime) {
  return runtime.list('Task', (task) => task.task_type === 'AGENT_PROPOSAL' && ['OPEN', 'IN_PROGRESS', 'BLOCKED'].includes(String(task.state || 'OPEN').toUpperCase()));
}

test('FOLLOW_UP_OVERDUE raises a proposal for a NEW inquiry with no recorded communication', () => {
  const runtime = makeRuntime();
  const client = makeClient(runtime, 'Stale Client');
  const inquiry = makeInquiry(runtime, client.client_id, { destination: 'Cebu' });

  const result = runtime.generateSalesProposals({}, staff());
  assert.equal(result.ok, true);
  assert.equal(result.meta.action, 'AGENT_PROPOSALS_GENERATED');
  assert.equal(result.data.raised, 1);
  assert.equal(result.data.skipped_existing, 0);
  assert.equal(result.data.proposals.length, 1);
  const proposal = result.data.proposals[0];
  assert.equal(proposal.rule, 'FOLLOW_UP_OVERDUE');
  assert.equal(proposal.target_id, inquiry.inquiry_id);
  assert.equal(proposal.suggested_action, 'Follow up with Stale Client about Cebu');
  assert.equal(proposal.confidence, 0.8);

  const task = runtime.list('Task', (item) => item.task_id === proposal.task_id)[0];
  assert.equal(task.task_type, 'AGENT_PROPOSAL');
  assert.equal(task.automation_key, 'AGENT_PROPOSAL:FOLLOW_UP_OVERDUE:' + inquiry.inquiry_id);
  assert.equal(task.title, 'Sales agent: Follow up with Stale Client about Cebu');
  assert.equal(task.state, 'OPEN');
  assert.equal(task.source, 'SALES_AGENT');
  assert.equal(task.confidence, 0.8);
  assert.equal(task.rationale, 'No client contact recorded in the last 7 days');
  assert.ok(task.description.indexOf(task.rationale) !== -1, 'description carries the rationale');
  assert.ok(task.description.indexOf('80%') !== -1, 'description carries the confidence');
  assert.equal(task.inquiry_id, inquiry.inquiry_id);
  assert.equal(task.client_id, client.client_id);

  const auditRow = runtime.auditLog.list().filter((entry) => entry.action === 'AGENT_PROPOSALS_GENERATED' && entry.result === 'SUCCESS').pop();
  assert.ok(auditRow, 'generation wrote its own audit row');
  assert.equal(auditRow.details.raised, 1);
  assert.ok(runtime.auditLog.list().some((entry) => entry.action === 'CREATE' && entry.entity_type === 'Task' && entry.entity_id === task.task_id), 'task creation audited through the normal create path');
});

test('an inquiry whose latest communication is older than 7 days raises; a communication exactly 7 days old does not', () => {
  const runtime = makeRuntime();
  const stale = makeClient(runtime, 'Quiet Client');
  const staleInquiry = makeInquiry(runtime, stale.client_id, { state: 'RESEARCHING' });
  runtime.createCommunication({ client_id: stale.client_id, channel: 'Email', outcome: 'Sent options', occurred_at: '2026-08-10T09:00:00.000Z' }, staff());

  const fresh = makeClient(runtime, 'Recent Client');
  makeInquiry(runtime, fresh.client_id, { state: 'NEW' });
  runtime.createCommunication({ client_id: fresh.client_id, channel: 'Messenger', outcome: 'Discussed dates', occurred_at: '2026-08-13T09:00:00.000Z' }, staff());

  const result = runtime.generateSalesProposals({}, staff());
  assert.equal(result.ok, true);
  assert.equal(result.data.raised, 1);
  assert.equal(result.data.proposals[0].target_id, staleInquiry.inquiry_id);
});

test('healthy records raise nothing: moved-on inquiry states and fresh quotations', () => {
  const runtime = makeRuntime();
  const contacted = makeClient(runtime, 'Contacted Client');
  makeInquiry(runtime, contacted.client_id, { state: 'CONTACTED' });
  runtime.createQuotation({ client_id: contacted.client_id, destination: 'Cebu', supplier_cost_total: '41500.00', client_total: '50000.00', currency: 'PHP', quotation_date: TODAY }, staff());

  const result = runtime.generateSalesProposals({}, staff());
  assert.equal(result.ok, true);
  assert.equal(result.data.raised, 0);
  assert.equal(result.data.skipped_existing, 0);
  assert.equal(openProposals(runtime).length, 0);
});

test('QUOTE_STALLED raises for DRAFT and APPROVED quotations older than 3 days without acceptance', () => {
  const runtime = makeRuntime();
  const client = makeClient(runtime, 'Quote Client');
  const draft = makeQuotation(runtime, client.client_id, '2026-08-10');
  const approved = makeQuotation(runtime, client.client_id, '2026-08-15');
  runtime.updateRecord('Quotation', approved.quotation_id, { status: 'APPROVED' }, staff());

  const result = runtime.generateSalesProposals({}, staff());
  assert.equal(result.ok, true);
  assert.equal(result.data.raised, 2);
  const byTarget = {};
  result.data.proposals.forEach((proposal) => { byTarget[proposal.target_id] = proposal; });
  assert.equal(byTarget[draft.quotation_id].rule, 'QUOTE_STALLED');
  assert.equal(byTarget[draft.quotation_id].confidence, 0.7);
  assert.equal(byTarget[draft.quotation_id].suggested_action, 'Chase quotation ' + draft.quotation_id + ' with Quote Client');
  assert.equal(byTarget[approved.quotation_id].rule, 'QUOTE_STALLED');

  const task = runtime.list('Task', (item) => item.automation_key === 'AGENT_PROPOSAL:QUOTE_STALLED:' + draft.quotation_id)[0];
  assert.ok(task, 'automation key namespaces the quotation');
  assert.equal(task.rationale, 'Quotation has been with the client for over 3 days without acceptance');
});

test('accepted quotations and quotations inside the 3-day window raise nothing', () => {
  const runtime = makeRuntime();
  const client = makeClient(runtime, 'Decided Client');
  const accepted = makeQuotation(runtime, client.client_id, '2026-08-10');
  runtime.updateRecord('Quotation', accepted.quotation_id, { status: 'APPROVED' }, staff());
  runtime.createRecord('QuotationAcceptance', { quotation_id: accepted.quotation_id, state: 'ACCEPTED', accepted_by: client.client_id }, staff());
  makeQuotation(runtime, client.client_id, '2026-08-17');

  const result = runtime.generateSalesProposals({}, staff());
  assert.equal(result.ok, true);
  assert.equal(result.data.raised, 0, 'accepted and boundary-fresh quotations are not stalled');
  assert.equal(openProposals(runtime).length, 0);
});

test('re-running the scan never duplicates open proposals', () => {
  const runtime = makeRuntime();
  const client = makeClient(runtime, 'Dedupe Client');
  makeInquiry(runtime, client.client_id, {});
  makeQuotation(runtime, client.client_id, '2026-08-01');

  const first = runtime.generateSalesProposals({}, staff());
  assert.equal(first.data.raised, 2);
  const second = runtime.generateSalesProposals({}, staff());
  assert.equal(second.ok, true);
  assert.equal(second.data.raised, 0, 'no duplicate proposals for the same targets');
  assert.equal(second.data.skipped_existing, 2);
  assert.equal(openProposals(runtime).length, 2);
});

test('resolve ACCEPTED completes the proposal with an actor note and audits the decision', () => {
  const runtime = makeRuntime();
  const client = makeClient(runtime, 'Accept Client');
  makeInquiry(runtime, client.client_id, {});
  const generated = runtime.generateSalesProposals({}, staff()).data;
  const taskId = generated.proposals[0].task_id;

  const resolved = runtime.resolveAgentProposal({ task_id: taskId, resolution: 'ACCEPTED', note: 'Called the client; visit set for Friday' }, staff());
  assert.equal(resolved.ok, true);
  assert.equal(resolved.meta.action, 'RESOLVE_AGENT_PROPOSAL');
  assert.equal(resolved.data.state, 'COMPLETED');
  assert.equal(resolved.data.rule, 'FOLLOW_UP_OVERDUE');

  const task = runtime.list('Task', (item) => item.task_id === taskId)[0];
  assert.equal(task.state, 'COMPLETED');
  assert.equal(task.completion_note, 'Accepted by staff: Called the client; visit set for Friday');
  assert.equal(openProposals(runtime).length, 0, 'resolved proposals leave the open list');
  assert.equal(runtime.list('Inquiry')[0].state, 'NEW', 'accepting changed nothing except the proposal task');
  assert.equal(runtime.list('CommunicationActivity').length, 0, 'accepting sent or wrote nothing');

  const auditRow = runtime.auditLog.list().filter((entry) => entry.action === 'RESOLVE_AGENT_PROPOSAL' && entry.result === 'SUCCESS').pop();
  assert.ok(auditRow, 'resolution wrote its own audit row');
  assert.equal(auditRow.entity_id, taskId);
  assert.equal(auditRow.details.resolution, 'ACCEPTED');

  const afterAccept = runtime.generateSalesProposals({}, staff());
  assert.equal(afterAccept.data.raised, 0, 'an accepted proposal is not raised again');
  assert.equal(afterAccept.data.skipped_existing, 1);
});

test('resolve DISMISSED cancels the proposal and a later scan can raise it again', () => {
  const runtime = makeRuntime();
  const client = makeClient(runtime, 'Dismiss Client');
  makeInquiry(runtime, client.client_id, {});
  const taskId = runtime.generateSalesProposals({}, staff()).data.proposals[0].task_id;

  const resolved = runtime.resolveAgentProposal({ task_id: taskId, resolution: 'DISMISSED' }, staff());
  assert.equal(resolved.ok, true);
  assert.equal(resolved.data.state, 'CANCELLED');
  const task = runtime.list('Task', (item) => item.task_id === taskId)[0];
  assert.equal(task.state, 'CANCELLED');
  assert.equal(task.completion_note, 'Dismissed by staff');

  const regenerated = runtime.generateSalesProposals({}, staff());
  assert.equal(regenerated.data.raised, 1, 'a dismissed proposal can be raised again');
  assert.equal(regenerated.data.skipped_existing, 0);
});

test('invalid resolves fail cleanly without changing anything', () => {
  const runtime = makeRuntime();
  const client = makeClient(runtime, 'Invalid Client');
  makeInquiry(runtime, client.client_id, {});
  const taskId = runtime.generateSalesProposals({}, staff()).data.proposals[0].task_id;

  const notAnAgent = runtime.createTask({ title: 'Normal task', task_type: 'FOLLOW_UP' }, staff()).data;
  assert.equal(runtime.resolveAgentProposal({ task_id: notAnAgent.task_id, resolution: 'ACCEPTED' }, staff()).error.code, 'AGENT_PROPOSAL_INVALID');

  const badResolution = runtime.resolveAgentProposal({ task_id: taskId, resolution: 'MAYBE' }, staff());
  assert.equal(badResolution.ok, false);
  assert.equal(badResolution.error.code, 'AGENT_PROPOSAL_RESOLUTION_INVALID');

  assert.equal(runtime.resolveAgentProposal({ resolution: 'ACCEPTED' }, staff()).error.code, 'REQUIRED_FIELD');
  assert.equal(runtime.resolveAgentProposal({ task_id: 'TASK-2099-000001', resolution: 'ACCEPTED' }, staff()).error.code, 'NOT_FOUND');

  assert.equal(runtime.resolveAgentProposal({ task_id: taskId, resolution: 'ACCEPTED' }, staff()).ok, true);
  const replay = runtime.resolveAgentProposal({ task_id: taskId, resolution: 'DISMISSED' }, staff());
  assert.equal(replay.ok, false);
  assert.equal(replay.error.code, 'AGENT_PROPOSAL_STATE_INVALID');
  assert.equal(runtime.list('Task', (item) => item.task_id === taskId)[0].state, 'COMPLETED');

  const badAsOf = runtime.generateSalesProposals({ asOf: 'august' }, staff());
  assert.equal(badAsOf.ok, false);
  assert.equal(badAsOf.error.code, 'ASOF_DATE_INVALID');

  assert.ok(runtime.auditLog.list().some((entry) => entry.action === 'RESOLVE_AGENT_PROPOSAL' && entry.result === 'FAILURE'), 'rejected resolutions audited');
});

test('an empty workspace returns zeros, never an error', () => {
  const runtime = makeRuntime();
  const result = runtime.generateSalesProposals({}, staff());
  assert.equal(result.ok, true);
  assert.equal(result.data.raised, 0);
  assert.equal(result.data.skipped_existing, 0);
  assert.deepEqual(result.data.proposals, []);
  assert.equal(runtime.list('Task').length, 0);
});

test('agent proposals work over HTTP through the phase 1 action dispatcher', async () => {
  const runtime = makeRuntime();
  const client = makeClient(runtime, 'HTTP Client');
  makeInquiry(runtime, client.client_id, {});
  const phase1App = createPhase1Application({ runtime, seedSynthetic: false });
  const { server } = createMvpServer({ phase1App });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = async (body) => {
    const response = await fetch(base + '/api/phase1/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const generated = await post({ action: 'generateSalesProposals', input: {}, actor: 'staff' });
    assert.equal(generated.status, 200);
    assert.equal(generated.body.ok, true);
    assert.equal(generated.body.data.raised, 1);
    const taskId = generated.body.data.proposals[0].task_id;

    const regenerated = await post({ action: 'generateSalesProposals', input: {}, actor: 'staff' });
    assert.equal(regenerated.body.data.raised, 0);
    assert.equal(regenerated.body.data.skipped_existing, 1);

    const resolved = await post({ action: 'resolveAgentProposal', input: { task_id: taskId, resolution: 'ACCEPTED', note: 'Handled over HTTP' }, actor: 'staff' });
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.data.state, 'COMPLETED');

    const invalid = await post({ action: 'resolveAgentProposal', input: { task_id: 'TASK-2099-000001', resolution: 'ACCEPTED' }, actor: 'staff' });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, 'NOT_FOUND');

    const internal = await post({ action: 'raiseAgentProposal', input: {}, actor: 'staff' });
    assert.equal(internal.status, 400);
    assert.equal(internal.body.error.code, 'UNKNOWN_ACTION', 'internal helpers stay off the dispatcher whitelist');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('operations workspace ships the sales agent suggestions card', () => {
  const source = fs.readFileSync('app/public/operations.js', 'utf8');
  assert.match(source, /function salesAgentCard\(/);
  assert.match(source, /function scanSalesProposals\(/);
  assert.match(source, /function acceptAgentProposal\(/);
  assert.match(source, /function dismissAgentProposal\(/);
  assert.match(source, /generateSalesProposals/);
  assert.match(source, /resolveAgentProposal/);
  assert.match(source, /task_type === 'AGENT_PROPOSAL'/);
  assert.match(source, /Sales agent suggestions/);
});
