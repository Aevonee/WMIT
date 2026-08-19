'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhase1Application } = require('../../src/application/phase1');

function buildApp() {
  return createPhase1Application({
    seedSynthetic: false,
    clock: () => new Date('2026-08-19T10:00:00Z')
  });
}

const MARIA = {
  name: 'Maria Santos',
  school: 'University of the Philippines',
  email: 'maria.santos@example.test',
  phone: '+63 917 000 0001',
  supervisor_username: 'owner',
  username: 'msantos',
  period_start: '2026-06-01',
  period_end: '2026-12-15',
  notes: 'OJT intake 2026'
};

function createIntern(app, overrides, actor) {
  return app.action({ action: 'createIntern', input: Object.assign({}, MARIA, overrides || {}), actor: actor || 'LOCAL_STAFF' });
}

function assignTask(app, input, actor) {
  return app.action({ action: 'assignInternTask', input, actor: actor || 'LOCAL_STAFF' });
}

test('interns are created, updated, and listed with year-based IDs', () => {
  const app = buildApp();
  const created = createIntern(app);
  assert.equal(created.ok, true, JSON.stringify(created.error));
  assert.match(created.data.intern_id, /^INTERN-2026-\d{6}$/);
  assert.equal(created.data.status, 'Active');
  assert.equal(created.data.username, 'msantos');

  const updated = app.action({ action: 'updateIntern', input: { intern_id: created.data.intern_id, changes: { phone: '+63 917 111 2222', notes: 'Second semester OJT' } }, actor: 'LOCAL_STAFF' });
  assert.equal(updated.ok, true, JSON.stringify(updated.error));
  assert.equal(updated.data.phone, '+63 917 111 2222');
  assert.equal(updated.data.notes, 'Second semester OJT');
  assert.equal(updated.data.name, MARIA.name, 'unchanged fields survive the update');

  const juan = createIntern(app, { name: 'Juan dela Cruz', school: 'Far Eastern University', username: 'jdCruz', email: 'juan.delacruz@example.test' });
  assert.equal(juan.ok, true, JSON.stringify(juan.error));

  const all = app.action({ action: 'listInterns', input: {}, actor: 'LOCAL_STAFF' });
  assert.equal(all.ok, true);
  assert.equal(all.data.length, 2);

  const active = app.action({ action: 'listInterns', input: { status: 'Active' }, actor: 'LOCAL_STAFF' });
  assert.equal(active.data.length, 2);
  const bySupervisor = app.action({ action: 'listInterns', input: { supervisor_username: 'OWNER' }, actor: 'LOCAL_STAFF' });
  assert.equal(bySupervisor.data.length, 2, 'supervisor filter is case-insensitive');
  const none = app.action({ action: 'listInterns', input: { status: 'Inactive' }, actor: 'LOCAL_STAFF' });
  assert.equal(none.data.length, 0);

  const audit = app.runtime.auditLog.list();
  assert.ok(audit.some((event) => event.action === 'CREATE' && event.entity_type === 'Intern' && event.entity_id === created.data.intern_id && event.actor === 'LOCAL_STAFF'));
  assert.ok(audit.some((event) => event.action === 'UPDATE' && event.entity_type === 'Intern' && event.entity_id === created.data.intern_id));
});

test('duplicate name+school interns are blocked with the existing ID', () => {
  const app = buildApp();
  const first = createIntern(app);
  assert.equal(first.ok, true);

  const duplicate = createIntern(app, { name: '  maria SANTOS  ', school: 'UNIVERSITY OF THE PHILIPPINES', username: 'other', email: 'other@example.test' });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error.code, 'INTERN_DUPLICATE');
  assert.equal(duplicate.error.details.existing_intern_id, first.data.intern_id);
  assert.equal(app.runtime.list('Intern').length, 1, 'no second record was written');

  const failureAudit = app.runtime.auditLog.list().find((event) => event.action === 'CREATE_INTERN' && event.result === 'FAILURE');
  assert.ok(failureAudit, 'the blocked duplicate writes a failure audit row');
  assert.equal(failureAudit.details.error_code, 'INTERN_DUPLICATE');

  // A different school with the same name is a distinct intern.
  const otherSchool = createIntern(app, { school: 'Far Eastern University', username: 'msantos2', email: 'maria2@example.test' });
  assert.equal(otherSchool.ok, true, JSON.stringify(otherSchool.error));

  // Updating one intern into another's name+school combination is blocked too.
  const clash = app.action({ action: 'updateIntern', input: { intern_id: otherSchool.data.intern_id, changes: { school: 'University of the Philippines' } }, actor: 'LOCAL_STAFF' });
  assert.equal(clash.ok, false);
  assert.equal(clash.error.code, 'INTERN_DUPLICATE');
});

test('invalid intern email, period, and fields are rejected before any write', () => {
  const app = buildApp();
  const valid = createIntern(app);
  assert.equal(valid.ok, true, JSON.stringify(valid.error));

  const badEmail = createIntern(app, { name: 'A One', school: 'School One', username: 'a1', email: 'not-an-email' });
  assert.equal(badEmail.ok, false);
  assert.equal(badEmail.error.code, 'INTERN_EMAIL_INVALID');

  const reversedPeriod = createIntern(app, { name: 'A Two', school: 'School Two', username: 'a2', email: 'a2@example.test', period_start: '2026-12-15', period_end: '2026-06-01' });
  assert.equal(reversedPeriod.ok, false);
  assert.equal(reversedPeriod.error.code, 'INTERN_PERIOD_INVALID');

  const badDate = createIntern(app, { name: 'A Three', school: 'School Three', username: 'a3', email: 'a3@example.test', period_end: '2026-13-40' });
  assert.equal(badDate.ok, false);
  assert.equal(badDate.error.code, 'INTERN_PERIOD_INVALID');

  const missing = createIntern(app, { name: '', school: 'School Four', username: 'a4', email: 'a4@example.test' });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'REQUIRED_FIELD');

  const badStatus = createIntern(app, { name: 'A Five', school: 'School Five', username: 'a5', email: 'a5@example.test', status: 'Paused' });
  assert.equal(badStatus.ok, false);
  assert.equal(badStatus.error.code, 'INTERN_STATUS_INVALID');

  const badUsername = createIntern(app, { name: 'A Six', school: 'School Six', username: 'msantos', email: 'a6@example.test' });
  assert.equal(badUsername.ok, false, 'a second profile cannot claim the same WMIT username');
  assert.equal(badUsername.error.code, 'INTERN_USERNAME_IN_USE');

  assert.equal(app.runtime.list('Intern').length, 1, 'only the one valid record was written');
  const failures = app.runtime.auditLog.list().filter((event) => event.action === 'CREATE_INTERN' && event.result === 'FAILURE');
  assert.equal(failures.length, 6, 'every rejected creation is audited');
});

test('intern tasks walk the full lifecycle OPEN -> SUBMITTED -> APPROVED with audit rows', () => {
  const app = buildApp();
  const intern = createIntern(app).data;

  const assigned = assignTask(app, { intern_id: intern.intern_id, title: 'Prepare expo lead sheet', instructions: 'Clean and sort the day-1 expo leads by interest area.', due_at: '2026-08-25' });
  assert.equal(assigned.ok, true, JSON.stringify(assigned.error));
  assert.match(assigned.data.intern_task_id, /^INTERN_TASK-2026-\d{6}$/);
  assert.equal(assigned.data.state, 'OPEN');
  assert.equal(assigned.data.assigned_by, 'LOCAL_STAFF');

  const submitted = app.action({ action: 'submitInternTask', input: { intern_task_id: assigned.data.intern_task_id, submitted_note: 'Sheet is ready for review.' }, actor: 'USER:msantos' });
  assert.equal(submitted.ok, true, JSON.stringify(submitted.error));
  assert.equal(submitted.data.state, 'SUBMITTED');
  assert.equal(submitted.data.submitted_by, 'USER:msantos');
  assert.equal(submitted.data.submitted_note, 'Sheet is ready for review.');

  const reviewed = app.action({ action: 'reviewInternTask', input: { intern_task_id: assigned.data.intern_task_id, decision: 'APPROVED', review_feedback: 'Well organized, thank you.' }, actor: 'LOCAL_STAFF' });
  assert.equal(reviewed.ok, true, JSON.stringify(reviewed.error));
  assert.equal(reviewed.data.state, 'APPROVED');
  assert.equal(reviewed.data.review_decision, 'APPROVED');
  assert.equal(reviewed.data.reviewed_by, 'LOCAL_STAFF');

  const audit = app.runtime.auditLog.list();
  const taskId = assigned.data.intern_task_id;
  [['ASSIGN_INTERN_TASK', 'LOCAL_STAFF'], ['SUBMIT_INTERN_TASK', 'USER:msantos'], ['REVIEW_INTERN_TASK', 'LOCAL_STAFF']].forEach((pair) => {
    const entry = audit.find((event) => event.action === pair[0] && event.entity_type === 'InternTask' && event.entity_id === taskId && event.result === 'SUCCESS');
    assert.ok(entry, pair[0] + ' writes a success audit row');
    assert.equal(entry.actor, pair[1]);
  });

  const resubmitAfterApproval = app.action({ action: 'submitInternTask', input: { intern_task_id: taskId }, actor: 'USER:msantos' });
  assert.equal(resubmitAfterApproval.ok, false);
  assert.equal(resubmitAfterApproval.error.code, 'INTERN_TASK_STATE_INVALID');
  const stillApproved = app.runtime.get('InternTask', taskId);
  assert.equal(stillApproved.state, 'APPROVED', 'a failed resubmit leaves the approved task untouched');
});

test('rejection reopens the task as OPEN and requires feedback; the intern can resubmit', () => {
  const app = buildApp();
  const intern = createIntern(app).data;
  const task = assignTask(app, { intern_id: intern.intern_id, title: 'Follow-up call list', instructions: 'Call the queued expo leads.' }).data;
  app.action({ action: 'submitInternTask', input: { intern_task_id: task.intern_task_id }, actor: 'USER:msantos' });

  const noFeedback = app.action({ action: 'reviewInternTask', input: { intern_task_id: task.intern_task_id, decision: 'REJECTED' }, actor: 'LOCAL_STAFF' });
  assert.equal(noFeedback.ok, false);
  assert.equal(noFeedback.error.code, 'INTERN_TASK_FEEDBACK_REQUIRED');
  assert.equal(app.runtime.get('InternTask', task.intern_task_id).state, 'SUBMITTED', 'the task stays submitted when feedback is missing');

  const rejected = app.action({ action: 'reviewInternTask', input: { intern_task_id: task.intern_task_id, decision: 'REJECTED', review_feedback: 'Add the call outcome column before resubmitting.' }, actor: 'LOCAL_STAFF' });
  assert.equal(rejected.ok, true, JSON.stringify(rejected.error));
  assert.equal(rejected.data.state, 'OPEN', 'rejection reopens the task');
  assert.equal(rejected.data.review_decision, 'REJECTED');
  assert.equal(rejected.data.rejection_count, 1);

  const resubmitted = app.action({ action: 'submitInternTask', input: { intern_task_id: task.intern_task_id, submitted_note: 'Outcome column added.' }, actor: 'USER:msantos' });
  assert.equal(resubmitted.ok, true, JSON.stringify(resubmitted.error));
  assert.equal(resubmitted.data.state, 'SUBMITTED');
  const approved = app.action({ action: 'reviewInternTask', input: { intern_task_id: task.intern_task_id, decision: 'APPROVED', review_feedback: 'Good now.' }, actor: 'LOCAL_STAFF' });
  assert.equal(approved.ok, true);
  assert.equal(approved.data.state, 'APPROVED');
});

test('an open task cannot jump straight to APPROVED and unknown tasks fail closed', () => {
  const app = buildApp();
  const intern = createIntern(app).data;
  const task = assignTask(app, { intern_id: intern.intern_id, title: 'Skip review', instructions: 'Try approving without a submission.' }).data;

  const illegal = app.action({ action: 'reviewInternTask', input: { intern_task_id: task.intern_task_id, decision: 'APPROVED' }, actor: 'LOCAL_STAFF' });
  assert.equal(illegal.ok, false);
  assert.equal(illegal.error.code, 'INTERN_TASK_STATE_INVALID');
  assert.equal(app.runtime.get('InternTask', task.intern_task_id).state, 'OPEN');

  const badDecision = app.action({ action: 'reviewInternTask', input: { intern_task_id: task.intern_task_id, decision: 'MAYBE' }, actor: 'LOCAL_STAFF' });
  assert.equal(badDecision.ok, false);
  assert.equal(badDecision.error.code, 'INTERN_TASK_DECISION_INVALID');

  const unknownTask = app.action({ action: 'submitInternTask', input: { intern_task_id: 'INTERN_TASK-2026-999999' }, actor: 'USER:msantos' });
  assert.equal(unknownTask.ok, false);
  assert.equal(unknownTask.error.code, 'NOT_FOUND');

  const unknownIntern = assignTask(app, { intern_id: 'INTERN-2026-999999', title: 'Ghost', instructions: 'No intern.' });
  assert.equal(unknownIntern.ok, false);
  assert.equal(unknownIntern.error.code, 'NOT_FOUND');

  const inactive = createIntern(app, { name: 'Pedro Reyes', school: 'Adamson University', username: 'preyes', email: 'pedro@example.test', status: 'Inactive' }).data;
  assert.equal(inactive.status, 'Inactive');
  const toInactive = assignTask(app, { intern_id: inactive.intern_id, title: ' extra work ', instructions: 'Should be blocked.' });
  assert.equal(toInactive.ok, false);
  assert.equal(toInactive.error.code, 'INTERN_INACTIVE');

  const missingFields = assignTask(app, { intern_id: intern.intern_id, title: '   ', instructions: '' });
  assert.equal(missingFields.ok, false);
  assert.equal(missingFields.error.code, 'REQUIRED_FIELD');
  assert.equal(app.runtime.list('InternTask').length, 1, 'only the one valid task exists');
});

test('an intern can submit only their own tasks; staff actions stay staff-gated', () => {
  const app = buildApp();
  const maria = createIntern(app).data;
  const juan = createIntern(app, { name: 'Juan dela Cruz', school: 'Far Eastern University', username: 'jdCruz', email: 'juan@example.test' }).data;
  const juanTask = assignTask(app, { intern_id: juan.intern_id, title: 'File supplier brochures', instructions: 'Sort the 2026 brochures by region.' }).data;

  const wrongOwner = app.action({ action: 'submitInternTask', input: { intern_task_id: juanTask.intern_task_id }, actor: 'USER:msantos' });
  assert.equal(wrongOwner.ok, false);
  assert.equal(wrongOwner.error.code, 'INTERN_TASK_NOT_OWNED');
  assert.equal(app.runtime.get('InternTask', juanTask.intern_task_id).state, 'OPEN');
  const wrongOwnerAudit = app.runtime.auditLog.list().find((event) => event.action === 'SUBMIT_INTERN_TASK' && event.result === 'FAILURE');
  assert.ok(wrongOwnerAudit, 'the blocked submission writes a failure audit row');
  assert.equal(wrongOwnerAudit.actor, 'USER:msantos');
  assert.equal(wrongOwnerAudit.details.error_code, 'INTERN_TASK_NOT_OWNED');

  const notAnInternAccount = app.action({ action: 'submitInternTask', input: { intern_task_id: juanTask.intern_task_id }, actor: 'LOCAL_STAFF' });
  assert.equal(notAnInternAccount.ok, false);
  assert.equal(notAnInternAccount.error.code, 'INTERN_ACTOR_INVALID');

  const internAssign = assignTask(app, { intern_id: maria.intern_id, title: 'Self-assign', instructions: 'Interns must not assign tasks.' }, 'USER:msantos');
  assert.equal(internAssign.ok, false);
  assert.equal(internAssign.error.code, 'AUTHORIZATION_REQUIRED');
  assert.equal(app.runtime.list('InternTask').length, 1, 'the blocked assignment wrote nothing');

  const internReview = app.action({ action: 'reviewInternTask', input: { intern_task_id: juanTask.intern_task_id, decision: 'APPROVED' }, actor: 'USER:msantos' });
  assert.equal(internReview.ok, false);
  assert.equal(internReview.error.code, 'AUTHORIZATION_REQUIRED');
  const reviewBlockedAudit = app.runtime.auditLog.list().find((event) => event.action === 'REVIEW_INTERN_TASK' && event.result === 'FAILURE');
  assert.ok(reviewBlockedAudit, 'the blocked review writes a failure audit row');
  assert.equal(reviewBlockedAudit.details.error_code, 'AUTHORIZATION_REQUIRED');

  const legitimate = app.action({ action: 'submitInternTask', input: { intern_task_id: juanTask.intern_task_id }, actor: 'USER:jdCruz' });
  assert.equal(legitimate.ok, true, JSON.stringify(legitimate.error));
  assert.equal(legitimate.data.state, 'SUBMITTED');
});

test('submitting twice is idempotent: the retry returns the same task without changing it', () => {
  const app = buildApp();
  const intern = createIntern(app).data;
  const task = assignTask(app, { intern_id: intern.intern_id, title: 'Draft thank-you email', instructions: 'Draft the post-expo thank-you email.' }).data;

  const first = app.action({ action: 'submitInternTask', input: { intern_task_id: task.intern_task_id, submitted_note: 'First version.' }, actor: 'USER:msantos' });
  assert.equal(first.ok, true);
  const second = app.action({ action: 'submitInternTask', input: { intern_task_id: task.intern_task_id, submitted_note: 'Accidental retry.' }, actor: 'USER:msantos' });
  assert.equal(second.ok, true);
  assert.equal(second.meta.idempotent, true);
  assert.equal(second.data.intern_task_id, first.data.intern_task_id);
  assert.equal(second.data.submitted_at, first.data.submitted_at, 'the original submission timestamp is preserved');
  assert.equal(second.data.submitted_note, 'First version.', 'the retry does not overwrite the original note');

  const submitAudits = app.runtime.auditLog.list().filter((event) => event.action === 'SUBMIT_INTERN_TASK' && event.result === 'SUCCESS' && event.entity_id === task.intern_task_id);
  assert.equal(submitAudits.length, 1, 'only one transition was recorded');
});
