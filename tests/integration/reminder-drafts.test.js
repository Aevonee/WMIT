'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createPhase1Runtime, ACTIONS } = require('../../src/phase1/runtime');
const { createPhase1Application } = require('../../src/application/phase1');
const { createMvpServer } = require('../../app/server');
const { makeQuotationApprovable } = require('../helpers/quotation-contract');

const CLOCK = () => new Date('2026-08-20T09:00:00Z');
const TODAY = '2026-08-20';

const AUTH = {
  staff: [ACTIONS.SELECT_OPTION, ACTIONS.ALLOCATE_PAYMENT, ACTIONS.ACCEPT_QUOTATION, ACTIONS.EDIT_DRAFT_PRICING, ACTIONS.CONFIGURE_SETTINGS],
  manager: [ACTIONS.APPROVE_QUOTATION, ACTIONS.VERIFY_PAYMENT]
};
const staff = () => ({ actor: 'staff', correlationId: 'REMINDER-DRAFT-TEST' });
const manager = () => ({ actor: 'manager', correlationId: 'REMINDER-DRAFT-TEST' });

function makeRuntime() {
  return createPhase1Runtime({ clock: CLOCK, config: { trustedActors: AUTH } });
}

function bookingChain(runtime, overrides) {
  const options = overrides || {};
  const client = runtime.createClient({ display_name: options.clientName || 'Reminder Client', primary_email: options.email === undefined ? 'reminder@example.test' : options.email }, staff()).data;
  const person = runtime.createPerson({ display_name: 'Lead Pax ' + client.display_name }, staff()).data;
  const quotation = runtime.createQuotation({ client_id: client.client_id, destination: options.destination || 'Cebu', supplier_cost_total: '41500.00', client_total: '50000.00', currency: 'PHP' }, staff()).data;
  assert.equal(makeQuotationApprovable(runtime, quotation, staff()).ok, true);
  assert.equal(runtime.approveQuotation({ quotation_id: quotation.quotation_id }, manager()).ok, true);
  assert.equal(runtime.acceptQuotation({ quotation_id: quotation.quotation_id, accepted_by: client.client_id }, staff()).ok, true);
  const booking = runtime.createBooking({ quotation_id: quotation.quotation_id, lead_pax_person_id: person.person_id }, staff()).data;
  return { client, person, quotation, booking };
}

function addObligation(runtime, bookingId, purpose, amount, dueAt, sequence) {
  const result = runtime.createBookingPaymentObligations({ booking_id: bookingId, obligations: [
    { purpose, amount, currency: 'PHP', sequence, due_at: dueAt }
  ] }, staff());
  assert.equal(result.ok, true);
  return result.data.obligations[0];
}

function openDraftTasks(runtime) {
  return runtime.list('Task', (task) => task.task_type === 'REMINDER_DRAFT' && ['OPEN', 'IN_PROGRESS', 'BLOCKED'].includes(String(task.state || 'OPEN').toUpperCase()));
}

test('BALANCE_DUE drafts are generated for outstanding obligations in the ±7 day window or overdue', () => {
  const runtime = makeRuntime();
  const chain = bookingChain(runtime, {});
  const inWindow = addObligation(runtime, chain.booking.booking_id, 'FINAL_BALANCE', '20000.00', '2026-08-21T09:00:00.000Z', 1);
  addObligation(runtime, chain.booking.booking_id, 'INSTALLMENT', '5000.00', '2026-12-01T09:00:00.000Z', 2);
  const settled = addObligation(runtime, chain.booking.booking_id, 'INSTALLMENT', '1000.00', '2026-08-26T09:00:00.000Z', 3);
  const payment = runtime.recordClientPayment({ booking_id: chain.booking.booking_id, amount: '1000.00', currency: 'PHP', proof_reference: 'PROOF-1' }, staff()).data;
  assert.equal(runtime.verifyClientPayment({ client_payment_id: payment.payment.client_payment_id }, manager()).ok, true);
  assert.equal(runtime.allocatePayment({ client_payment_id: payment.payment.client_payment_id, allocations: [
    { booking_id: chain.booking.booking_id, client_obligation_id: settled.client_obligation_id, amount: '1000.00' }
  ], idempotency_key: 'REM-ALLOC-1' }, staff()).ok, true);

  const result = runtime.generateReminderDrafts({ category: 'BALANCE_DUE' }, staff());
  assert.equal(result.ok, true);
  assert.equal(result.meta.action, 'GENERATE_REMINDER_DRAFTS');
  assert.equal(result.data.targets_found, 1, 'only the unpaid obligation inside the window');
  assert.equal(result.data.drafts_created, 1);
  const draft = result.data.drafts[0];
  assert.equal(draft.recipient, 'reminder@example.test');
  assert.equal(draft.recipient_name, 'Reminder Client');
  assert.equal(draft.category, 'BALANCE_DUE');
  assert.ok(draft.subject.indexOf(chain.booking.booking_id) !== -1, 'subject references the booking');
  assert.ok(draft.body.indexOf('20000.00') !== -1, 'body states the outstanding amount');
  assert.ok(draft.body.indexOf('due 2026-08-21') !== -1, 'body states the due date');
  assert.ok(draft.body.indexOf('50% deposit upon confirmation') !== -1, 'body reuses the configured payment terms');
  assert.ok(draft.body.indexOf('Peso Account') !== -1, 'body includes bank details');
  assert.equal(draft.booking_id, chain.booking.booking_id);
  assert.equal(draft.client_obligation_id, inWindow.client_obligation_id);

  const task = runtime.list('Task', (item) => item.task_id === draft.task_id)[0];
  assert.equal(task.task_type, 'REMINDER_DRAFT');
  assert.equal(task.automation_key, 'REMINDER_DRAFT:BALANCE_DUE:BALANCE:' + inWindow.client_obligation_id);
  assert.equal(task.send_state, 'DRAFT');

  const auditRow = runtime.auditLog.list().filter((entry) => entry.action === 'GENERATE_REMINDER_DRAFTS' && entry.result === 'SUCCESS').pop();
  assert.ok(auditRow, 'generation wrote an audit row');
  assert.equal(auditRow.actor, 'staff');
  assert.equal(auditRow.details.drafts_created, 1);
  assert.equal(auditRow.details.targets_found, 1);
});

test('far-overdue obligations still generate a draft with HIGH priority', () => {
  const runtime = makeRuntime();
  const chain = bookingChain(runtime, {});
  addObligation(runtime, chain.booking.booking_id, 'FINAL_BALANCE', '8000.00', '2026-07-01T09:00:00.000Z', 1);
  const result = runtime.generateReminderDrafts({ category: 'BALANCE_DUE' }, staff());
  assert.equal(result.ok, true);
  assert.equal(result.data.drafts_created, 1);
  assert.ok(result.data.drafts[0].body.indexOf('originally due 2026-07-01') !== -1, 'overdue drafts say originally due');
  const task = runtime.list('Task', (item) => item.task_id === result.data.drafts[0].task_id)[0];
  assert.equal(task.priority, 'HIGH');
});

test('re-running the same category is idempotent and discarded drafts regenerate cleanly', () => {
  const runtime = makeRuntime();
  const chain = bookingChain(runtime, {});
  addObligation(runtime, chain.booking.booking_id, 'FINAL_BALANCE', '20000.00', '2026-08-24T09:00:00.000Z', 1);

  const first = runtime.generateReminderDrafts({ category: 'BALANCE_DUE' }, staff());
  assert.equal(first.data.drafts_created, 1);
  const second = runtime.generateReminderDrafts({ category: 'BALANCE_DUE' }, staff());
  assert.equal(second.ok, true);
  assert.equal(second.data.drafts_created, 0, 'no duplicate draft for the same target');
  assert.equal(second.data.skipped_existing, 1);
  assert.equal(openDraftTasks(runtime).length, 1);

  assert.equal(runtime.discardReminderDraft({ task_id: first.data.drafts[0].task_id }, staff()).ok, true);
  const third = runtime.generateReminderDrafts({ category: 'BALANCE_DUE' }, staff());
  assert.equal(third.data.drafts_created, 1, 'a discarded draft can be regenerated');
  assert.equal(third.data.skipped_existing, 0);
  assert.equal(openDraftTasks(runtime).length, 1);
});

test('MISSING_DOCUMENTS drafts list missing required documents per booking', () => {
  const runtime = makeRuntime();
  const chain = bookingChain(runtime, { clientName: 'Docs Client', email: 'docs@example.test' });
  const supplier = runtime.createSupplier({ display_name: 'Docs Supplier' }, staff()).data;
  runtime.createBookingItem({ booking_id: chain.booking.booking_id, supplier_id: supplier.supplier_id, service_type: 'HOTEL', description: 'Cebu hotel', required_documents: ['PASSPORT', 'HOTEL_CONFIRMATION'] }, staff());

  const first = runtime.generateReminderDrafts({ category: 'MISSING_DOCUMENTS' }, staff());
  assert.equal(first.ok, true);
  assert.equal(first.data.drafts_created, 1);
  const draft = first.data.drafts[0];
  assert.equal(draft.recipient, 'docs@example.test');
  assert.ok(draft.body.indexOf('- PASSPORT') !== -1);
  assert.ok(draft.body.indexOf('- HOTEL_CONFIRMATION') !== -1);

  runtime.createDocument({ file_name: 'passport.pdf', booking_id: chain.booking.booking_id, document_type: 'PASSPORT', review_status: 'ACCEPTED', status: 'ACCEPTED' }, staff());
  assert.equal(runtime.discardReminderDraft({ task_id: first.data.drafts[0].task_id }, staff()).ok, true, 'discard the stale draft so regeneration renders the remaining gap');
  const partial = runtime.generateReminderDrafts({ category: 'MISSING_DOCUMENTS' }, staff());
  assert.equal(partial.data.targets_found, 1, 'still missing the hotel confirmation');
  assert.equal(partial.data.drafts_created, 1);
  assert.ok(partial.data.drafts[0].body.indexOf('- PASSPORT') === -1, 'accepted passport is no longer listed');
  assert.ok(partial.data.drafts[0].body.indexOf('- HOTEL_CONFIRMATION') !== -1);

  runtime.createDocument({ file_name: 'hotel-conf.pdf', booking_id: chain.booking.booking_id, document_type: 'HOTEL_CONFIRMATION', review_status: 'ACCEPTED', status: 'ACCEPTED' }, staff());
  assert.equal(runtime.discardReminderDraft({ task_id: partial.data.drafts[0].task_id }, staff()).ok, true);
  const complete = runtime.generateReminderDrafts({ category: 'MISSING_DOCUMENTS' }, staff());
  assert.equal(complete.ok, true);
  assert.equal(complete.data.targets_found, 0, 'booking with all required documents is not a target');

  const noRequirements = runtime.generateReminderDrafts({ category: 'MISSING_DOCUMENTS', asOf: TODAY }, staff());
  assert.equal(noRequirements.data.targets_found, 0, 'bookings without document requirements never draft');
});

test('bookings whose client has no email are skipped with a count, not drafted', () => {
  const runtime = makeRuntime();
  const chain = bookingChain(runtime, { email: null });
  addObligation(runtime, chain.booking.booking_id, 'FINAL_BALANCE', '20000.00', '2026-08-21T09:00:00.000Z', 1);
  const result = runtime.generateReminderDrafts({ category: 'BALANCE_DUE' }, staff());
  assert.equal(result.ok, true);
  assert.equal(result.data.targets_found, 1);
  assert.equal(result.data.drafts_created, 0);
  assert.equal(result.data.skipped_no_recipient, 1);
  assert.equal(openDraftTasks(runtime).length, 0);
});

test('DEPARTURE_REMINDER drafts one email per member booking for departures 3-7 days out', () => {
  const runtime = makeRuntime();
  const chain = bookingChain(runtime, { clientName: 'Departure Client', email: 'departure@example.test' });
  const supplier = runtime.createSupplier({ display_name: 'Departure Supplier' }, staff()).data;
  const item = runtime.createBookingItem({ booking_id: chain.booking.booking_id, supplier_id: supplier.supplier_id, service_type: 'PACKAGE' }, staff()).data;

  const inWindow = runtime.createDeparture({ name: 'Cebu Long Weekend', destination: 'Cebu', start_date: '2026-08-25', end_date: '2026-08-27' }, staff()).data;
  runtime.addDepartureMembership({ departure_id: inWindow.departure_id, booking_item_id: item.booking_item_id }, staff());
  const tooSoon = runtime.createDeparture({ name: 'Leaves Tomorrow', start_date: '2026-08-22' }, staff()).data;
  runtime.addDepartureMembership({ departure_id: tooSoon.departure_id, booking_item_id: item.booking_item_id }, staff());
  const tooFar = runtime.createDeparture({ name: 'Next Month Group', start_date: '2026-08-29' }, staff()).data;
  runtime.addDepartureMembership({ departure_id: tooFar.departure_id, booking_item_id: item.booking_item_id }, staff());
  const cancelled = runtime.createDeparture({ name: 'Cancelled Trip', start_date: '2026-08-25', state: 'CANCELLED' }, staff()).data;
  runtime.addDepartureMembership({ departure_id: cancelled.departure_id, booking_item_id: item.booking_item_id }, staff());

  const result = runtime.generateReminderDrafts({ category: 'DEPARTURE_REMINDER' }, staff());
  assert.equal(result.ok, true);
  assert.equal(result.data.targets_found, 1, 'only the 3-7 day departure qualifies');
  const draft = result.data.drafts[0];
  assert.equal(draft.recipient, 'departure@example.test');
  assert.equal(draft.departure_id, inWindow.departure_id);
  assert.equal(draft.booking_id, chain.booking.booking_id);
  assert.ok(draft.subject.indexOf('Cebu Long Weekend') !== -1);
  assert.ok(draft.body.indexOf('2026-08-25') !== -1);
  assert.ok(draft.body.indexOf('(Cebu)') !== -1);
});

test('empty databases generate zero drafts per category without erroring', () => {
  const runtime = makeRuntime();
  ['BALANCE_DUE', 'MISSING_DOCUMENTS', 'DEPARTURE_REMINDER'].forEach((category) => {
    const result = runtime.generateReminderDrafts({ category }, staff());
    assert.equal(result.ok, true, category);
    assert.equal(result.data.targets_found, 0, category);
    assert.equal(result.data.drafts_created, 0, category);
    assert.equal(result.data.skipped_existing, 0, category);
  });
  assert.equal(runtime.list('Task').length, 0);
});

test('invalid category and invalid asOf fail closed, are audited, and change nothing', () => {
  const runtime = makeRuntime();
  const chain = bookingChain(runtime, {});
  addObligation(runtime, chain.booking.booking_id, 'FINAL_BALANCE', '2000.00', '2026-08-21T09:00:00.000Z', 1);
  const taskCountBefore = runtime.list('Task').length;

  const missing = runtime.generateReminderDrafts({}, staff());
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'REMINDER_CATEGORY_INVALID');

  const badCategory = runtime.generateReminderDrafts({ category: 'SPAM_BLAST' }, staff());
  assert.equal(badCategory.ok, false);
  assert.equal(badCategory.error.code, 'REMINDER_CATEGORY_INVALID');
  assert.deepEqual(badCategory.error.details.allowed, ['BALANCE_DUE', 'MISSING_DOCUMENTS', 'DEPARTURE_REMINDER']);

  const badAsOf = runtime.generateReminderDrafts({ category: 'BALANCE_DUE', asOf: 'august' }, staff());
  assert.equal(badAsOf.ok, false);
  assert.equal(badAsOf.error.code, 'ASOF_DATE_INVALID');

  const badListCategory = runtime.listReminderDrafts({ category: 'NOPE' }, staff());
  assert.equal(badListCategory.ok, false);
  assert.equal(badListCategory.error.code, 'REMINDER_CATEGORY_INVALID');

  assert.equal(runtime.list('Task').length, taskCountBefore, 'failed generation created no records');
  const failures = runtime.auditLog.list().filter((entry) => entry.action === 'GENERATE_REMINDER_DRAFTS' && entry.result === 'FAILURE');
  assert.equal(failures.length, 3, 'each rejected call audited a failure row');
});

test('message templates from settings override the default reminder body', () => {
  const runtime = makeRuntime();
  const chain = bookingChain(runtime, { clientName: 'Template Client' });
  addObligation(runtime, chain.booking.booking_id, 'FINAL_BALANCE', '1500.00', '2026-08-22T09:00:00.000Z', 1);
  const settings = runtime.updateSettings({ messageTemplates: [
    { key: 'REMINDER_BALANCE_DUE', label: 'Balance reminder', body: 'Hi {{client_name}}, please settle {{currency}} {{outstanding}} for booking {{booking_reference}}.' }
  ] }, staff());
  assert.equal(settings.ok, true, 'staff holds CONFIGURE_SETTINGS in this fixture');

  const result = runtime.generateReminderDrafts({ category: 'BALANCE_DUE' }, staff());
  assert.equal(result.data.drafts_created, 1);
  assert.equal(result.data.drafts[0].body, 'Hi Template Client, please settle PHP 1500.00 for booking ' + chain.booking.booking_id + '.');
});

test('listReminderDrafts groups by category and discard is audited and idempotent', () => {
  const runtime = makeRuntime();
  const balanceChain = bookingChain(runtime, { clientName: 'Balance Client', email: 'balance@example.test' });
  addObligation(runtime, balanceChain.booking.booking_id, 'FINAL_BALANCE', '2000.00', '2026-08-21T09:00:00.000Z', 1);
  assert.equal(runtime.generateReminderDrafts({ category: 'BALANCE_DUE' }, staff()).data.drafts_created, 1);

  const listed = runtime.listReminderDrafts({}, staff());
  assert.equal(listed.ok, true);
  assert.equal(listed.meta.read_only, true);
  assert.deepEqual(listed.data.categories.map((group) => group.category), ['BALANCE_DUE', 'MISSING_DOCUMENTS', 'DEPARTURE_REMINDER']);
  assert.equal(listed.data.categories[0].count, 1);
  assert.equal(listed.data.counts.open, 1);
  assert.equal(listed.data.counts.discarded, 0);

  const filtered = runtime.listReminderDrafts({ category: 'BALANCE_DUE' }, staff());
  assert.equal(filtered.ok, true);
  assert.equal(filtered.data.category, 'BALANCE_DUE');
  assert.equal(filtered.data.categories.find((group) => group.category === 'BALANCE_DUE').drafts.length, 1);
  assert.equal(filtered.data.categories.find((group) => group.category === 'MISSING_DOCUMENTS').drafts.length, 0);

  const taskId = listed.data.categories[0].drafts[0].task_id;
  const discarded = runtime.discardReminderDraft({ task_id: taskId }, staff());
  assert.equal(discarded.ok, true);
  assert.equal(discarded.data.state, 'CANCELLED');
  assert.equal(discarded.data.send_state, 'DRAFT');

  const afterDiscard = runtime.listReminderDrafts({}, staff());
  assert.equal(afterDiscard.data.counts.open, 0);
  assert.equal(afterDiscard.data.counts.discarded, 1);

  const replay = runtime.discardReminderDraft({ task_id: taskId }, staff());
  assert.equal(replay.ok, true);
  assert.equal(replay.meta.idempotent, true);

  const auditRow = runtime.auditLog.list().filter((entry) => entry.action === 'DISCARD_REMINDER_DRAFT' && entry.result === 'SUCCESS').pop();
  assert.ok(auditRow, 'discard wrote its own audit row');
  assert.equal(auditRow.entity_id, taskId);
  assert.equal(auditRow.details.recipient, 'balance@example.test');

  const notADraft = runtime.createTask({ title: 'Normal task', task_type: 'FOLLOW_UP' }, staff()).data;
  const rejected = runtime.discardReminderDraft({ task_id: notADraft.task_id }, staff());
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'REMINDER_DRAFT_INVALID');
  assert.ok(runtime.auditLog.list().some((entry) => entry.action === 'DISCARD_REMINDER_DRAFT' && entry.result === 'FAILURE'), 'rejected discard audited');
});

test('reminder drafts work over HTTP through the phase 1 action dispatcher', async () => {
  const runtime = makeRuntime();
  const chain = bookingChain(runtime, { clientName: 'HTTP Client', email: 'http@example.test' });
  addObligation(runtime, chain.booking.booking_id, 'FINAL_BALANCE', '3000.00', '2026-08-21T09:00:00.000Z', 1);
  const phase1App = createPhase1Application({ runtime, seedSynthetic: false });
  const { server } = createMvpServer({ phase1App });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = async (body) => {
    const response = await fetch(base + '/api/phase1/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const generated = await post({ action: 'generateReminderDrafts', input: { category: 'BALANCE_DUE' }, actor: 'staff' });
    assert.equal(generated.status, 200);
    assert.equal(generated.body.ok, true);
    assert.equal(generated.body.data.drafts_created, 1);
    const taskId = generated.body.data.drafts[0].task_id;

    const listed = await post({ action: 'listReminderDrafts', input: {}, actor: 'staff' });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.data.counts.open, 1);
    assert.equal(listed.body.data.categories[0].drafts[0].recipient, 'http@example.test');

    const discarded = await post({ action: 'discardReminderDraft', input: { task_id: taskId }, actor: 'staff' });
    assert.equal(discarded.status, 200);
    assert.equal(discarded.body.ok, true);

    const afterDiscard = await post({ action: 'listReminderDrafts', input: {}, actor: 'staff' });
    assert.equal(afterDiscard.body.data.counts.open, 0);

    const invalid = await post({ action: 'generateReminderDrafts', input: { category: 'NOPE' }, actor: 'staff' });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, 'REMINDER_CATEGORY_INVALID');

    const unknown = await post({ action: 'sendReminderDraft', input: {}, actor: 'staff' });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.error.code, 'UNKNOWN_ACTION');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('operations workspace ships the reminder drafts review panel', () => {
  const source = fs.readFileSync('app/public/operations.js', 'utf8');
  assert.match(source, /function reminderDraftsPanel\(/);
  assert.match(source, /function copyReminderDraft\(/);
  assert.match(source, /function regenerateReminderDrafts\(/);
  assert.match(source, /function discardReminderDraftAction\(/);
  assert.match(source, /generateReminderDrafts/);
  assert.match(source, /task_type !== 'REMINDER_DRAFT'/, 'drafts stay out of the generic follow-up list');
});
