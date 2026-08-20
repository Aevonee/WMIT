'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhase1Runtime, ACTIONS } = require('../../src/phase1/runtime');
const { createPhase1Application } = require('../../src/application/phase1');
const { createMvpServer } = require('../../app/server');
const { makeQuotationApprovable } = require('../helpers/quotation-contract');

const CLOCK = () => new Date('2026-08-20T09:00:00Z');

const AUTH = {
  staff: [ACTIONS.SELECT_OPTION, ACTIONS.ALLOCATE_PAYMENT, ACTIONS.ACCEPT_QUOTATION, ACTIONS.EDIT_DRAFT_PRICING],
  manager: [ACTIONS.APPROVE_QUOTATION, ACTIONS.VERIFY_PAYMENT, ACTIONS.COMMISSION_APPROVE, ACTIONS.COMMISSION_PAY, ACTIONS.COMMISSION_RULES, ACTIONS.CONFIGURE_SETTINGS]
};
const staff = () => ({ actor: 'staff', correlationId: 'RULE-TEST' });
const manager = () => ({ actor: 'manager', correlationId: 'RULE-TEST' });

function makeRuntime(options) {
  return createPhase1Runtime(Object.assign({ clock: CLOCK, config: { trustedActors: AUTH } }, options || {}));
}

function bookingChain(runtime, overrides) {
  const options = overrides || {};
  const client = runtime.createClient({ display_name: options.clientName || 'Rule Client', primary_email: 'rules@example.test' }, staff()).data;
  const person = runtime.createPerson({ display_name: 'Lead Pax ' + client.display_name }, staff()).data;
  const quotation = runtime.createQuotation({ client_id: client.client_id, destination: 'Cebu', supplier_cost_total: options.supplierCost || '40000.00', currency: 'PHP' }, staff()).data;
  assert.equal(makeQuotationApprovable(runtime, quotation, staff()).ok, true);
  assert.equal(runtime.approveQuotation({ quotation_id: quotation.quotation_id }, manager()).ok, true);
  assert.equal(runtime.acceptQuotation({ quotation_id: quotation.quotation_id, accepted_by: client.client_id }, staff()).ok, true);
  const booking = runtime.createBooking({ quotation_id: quotation.quotation_id, lead_pax_person_id: person.person_id }, staff()).data;
  return { client, person, quotation, booking };
}

// Booking chain whose Inquiry is a converted expo lead, so the booking is
// expo-traceable the same way expo-analytics lineage resolves it.
function expoBookingChain(runtime, overrides) {
  const options = overrides || {};
  const client = runtime.createClient({ display_name: options.clientName || 'Expo Rule Client', primary_email: 'exporules@example.test' }, staff()).data;
  const inquiry = runtime.createInquiry({ client_id: client.client_id, requirements: { destination: 'Cebu', travel_start: '2026-09-10', travel_end: '2026-09-14', pax_count: 2 } }, staff()).data;
  const person = runtime.createPerson({ display_name: 'Lead Pax Expo' }, staff()).data;
  const quotation = runtime.createQuotation({ client_id: client.client_id, inquiry_id: inquiry.inquiry_id, destination: 'Cebu', supplier_cost_total: options.supplierCost || '40000.00', currency: 'PHP' }, staff()).data;
  assert.equal(makeQuotationApprovable(runtime, quotation, staff()).ok, true);
  assert.equal(runtime.approveQuotation({ quotation_id: quotation.quotation_id }, manager()).ok, true);
  assert.equal(runtime.acceptQuotation({ quotation_id: quotation.quotation_id, accepted_by: client.client_id }, staff()).ok, true);
  assert.equal(runtime.createRecord('ExpoLead', { expo_lead_id: 'EXPO_LEAD-2026-000042', name: 'Expo Lead', converted_inquiry_id: inquiry.inquiry_id }, staff()).ok, true);
  const booking = runtime.createBooking({ quotation_id: quotation.quotation_id, lead_pax_person_id: person.person_id }, staff()).data;
  return { client, person, inquiry, quotation, booking };
}

function payBooking(runtime, chain, amount, sequence) {
  const payment = runtime.recordClientPayment({ booking_id: chain.booking.booking_id, amount, proof_reference: 'PROOF-' + sequence, currency: 'PHP', payment_purpose: sequence === 1 ? 'PARTIAL_PAYMENT' : 'BALANCE_PAYMENT' }, staff()).data.payment;
  assert.equal(runtime.verifyClientPayment({ client_payment_id: payment.client_payment_id }, manager()).ok, true);
  const obligation = runtime.list('ClientObligation', (record) => record.booking_id === chain.booking.booking_id)[0];
  const allocated = runtime.allocatePayment({ client_payment_id: payment.client_payment_id, allocations: [{ booking_id: chain.booking.booking_id, client_obligation_id: obligation.client_obligation_id, amount }] }, staff());
  return { payment, allocated };
}

test('commission rule CRUD is manager-gated, validated, immutable in its terms, and audited', () => {
  const runtime = makeRuntime();
  const denied = runtime.addCommissionRule({ name: 'Referral', beneficiary_name: 'Maria', basis: 'FLAT', amount: '100.00', trigger: 'BOOKING_CREATED' }, staff());
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'AUTHORIZATION_REQUIRED', 'staff cannot add rules');
  assert.ok(runtime.auditLog.list().some((entry) => entry.action === 'ADD_COMMISSION_RULE' && entry.result === 'FAILURE' && entry.details.error_code === 'AUTHORIZATION_REQUIRED'));

  const added = runtime.addCommissionRule({ name: 'Maria referral', beneficiary_name: 'Maria Referrer', basis: 'FLAT', amount: '1250.50', trigger: 'BOOKING_CREATED' }, manager());
  assert.equal(added.ok, true);
  assert.equal(added.meta.action, 'ADD_COMMISSION_RULE');
  assert.match(added.data.rule_id, /^COMMISSION_RULE-2026-\d{6}$/);
  assert.equal(added.data.beneficiary_name, 'Maria Referrer');
  assert.equal(added.data.basis, 'FLAT');
  assert.equal(added.data.amount, '1250.50');
  assert.equal(added.data.percent, null);
  assert.equal(added.data.currency, 'PHP');
  assert.equal(added.data.trigger, 'BOOKING_CREATED');
  assert.equal(added.data.source_filter, null);
  assert.equal(added.data.active, true);

  const cases = [
    [{ beneficiary_name: 'Maria', basis: 'FLAT', amount: '1.00', trigger: 'BOOKING_CREATED' }, 'REQUIRED_FIELD'],
    [{ name: 'X', basis: 'FLAT', amount: '1.00', trigger: 'BOOKING_CREATED' }, 'REQUIRED_FIELD'],
    [{ name: 'X', beneficiary_name: 'Maria', basis: 'MYSTERY', amount: '1.00', trigger: 'BOOKING_CREATED' }, 'COMMISSION_BASIS_INVALID'],
    [{ name: 'X', beneficiary_name: 'Maria', basis: 'FLAT', amount: '0.00', trigger: 'BOOKING_CREATED' }, 'COMMISSION_AMOUNT_INVALID'],
    [{ name: 'X', beneficiary_name: 'Maria', basis: 'FLAT', trigger: 'BOOKING_CREATED' }, 'REQUIRED_FIELD'],
    [{ name: 'X', beneficiary_name: 'Maria', basis: 'FLAT', amount: '1.005', trigger: 'BOOKING_CREATED' }, 'INVALID_MONEY'],
    [{ name: 'X', beneficiary_name: 'Maria', basis: 'PERCENT', percent: 0, trigger: 'BOOKING_CREATED' }, 'COMMISSION_PERCENT_INVALID'],
    [{ name: 'X', beneficiary_name: 'Maria', basis: 'PERCENT', percent: 101, trigger: 'BOOKING_CREATED' }, 'COMMISSION_PERCENT_INVALID'],
    [{ name: 'X', beneficiary_name: 'Maria', basis: 'PERCENT', percent: 5, trigger: 'WHENEVER' }, 'COMMISSION_RULE_TRIGGER_INVALID'],
    [{ name: 'X', beneficiary_name: 'Maria', basis: 'FLAT', amount: '1.00', trigger: 'BOOKING_CREATED', source_filter: 'FACEBOOK' }, 'COMMISSION_RULE_SOURCE_FILTER_INVALID'],
    [{ name: 'X', beneficiary_name: 'Maria', basis: 'FLAT', amount: '1.00', trigger: 'BOOKING_CREATED', currency: 'PESOS' }, 'INVALID_CURRENCY']
  ];
  cases.forEach(([input, code]) => {
    const result = runtime.addCommissionRule(input, manager());
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.equal(result.error.code, code, JSON.stringify(input));
  });
  const failures = runtime.auditLog.list().filter((entry) => entry.action === 'ADD_COMMISSION_RULE' && entry.result === 'FAILURE');
  assert.equal(failures.length, cases.length + 1, 'each rejected add audited a failure row (plus the staff denial)');

  const listed = runtime.listCommissionRules({}, staff());
  assert.equal(listed.ok, true);
  assert.equal(listed.meta.read_only, true);
  assert.equal(listed.data.counts.total, 1);
  assert.equal(listed.data.counts.active, 1);
  assert.ok(runtime.auditLog.list().some((entry) => entry.action === 'LIST_COMMISSION_RULES' && entry.result === 'SUCCESS'));

  const staffUpdate = runtime.updateCommissionRule({ rule_id: added.data.rule_id, active: false }, staff());
  assert.equal(staffUpdate.ok, false);
  assert.equal(staffUpdate.error.code, 'AUTHORIZATION_REQUIRED', 'staff cannot update rules');

  const renamed = runtime.updateCommissionRule({ rule_id: added.data.rule_id, name: 'Maria referral (2026)' }, manager());
  assert.equal(renamed.ok, true);
  assert.equal(renamed.data.name, 'Maria referral (2026)');
  assert.equal(renamed.data.active, true, 'rename alone leaves the rule active');

  const deactivated = runtime.updateCommissionRule({ rule_id: added.data.rule_id, active: false }, manager());
  assert.equal(deactivated.ok, true);
  assert.equal(deactivated.data.active, false);

  const immutable = [
    [{ amount: '99.00' }, 'amount'],
    [{ percent: 10 }, 'percent'],
    [{ basis: 'PERCENT' }, 'basis'],
    [{ beneficiary_name: 'Someone Else' }, 'beneficiary_name'],
    [{ trigger: 'BOOKING_FULLY_PAID' }, 'trigger'],
    [{ source_filter: 'EXPO' }, 'source_filter']
  ];
  immutable.forEach(([change, field]) => {
    const result = runtime.updateCommissionRule(Object.assign({ rule_id: added.data.rule_id }, change), manager());
    assert.equal(result.ok, false, JSON.stringify(change));
    assert.equal(result.error.code, 'COMMISSION_RULE_IMMUTABLE', field + ' is immutable');
    assert.deepEqual(result.error.details.fields, [field]);
  });

  const noChanges = runtime.updateCommissionRule({ rule_id: added.data.rule_id }, manager());
  assert.equal(noChanges.ok, false);
  assert.equal(noChanges.error.code, 'NO_CHANGES');

  const missing = runtime.updateCommissionRule({ rule_id: 'COMMISSION_RULE-2026-999999', active: false }, manager());
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'NOT_FOUND');

  const relisted = runtime.listCommissionRules({}, staff());
  assert.equal(relisted.data.counts.inactive, 1);
  ['UPDATE_COMMISSION_RULE'].forEach((action) => {
    assert.ok(runtime.auditLog.list().some((entry) => entry.action === action && entry.result === 'SUCCESS'), action + ' audited');
    assert.ok(runtime.auditLog.list().some((entry) => entry.action === action && entry.result === 'FAILURE'), action + ' failures audited');
  });
});

test('a BOOKING_CREATED rule auto-drafts a DRAFT commission when the booking is created', () => {
  const runtime = makeRuntime();
  const rule = runtime.addCommissionRule({ name: 'Maria referral', beneficiary_name: 'Maria Referrer', basis: 'FLAT', amount: '1250.50', trigger: 'BOOKING_CREATED' }, manager()).data;
  const chain = bookingChain(runtime, {});
  const commissions = runtime.list('Commission');
  assert.equal(commissions.length, 1, 'exactly one auto-drafted commission');
  const draft = commissions[0];
  assert.equal(draft.status, 'DRAFT');
  assert.equal(draft.booking_id, chain.booking.booking_id);
  assert.equal(draft.source, 'AUTO_RULE');
  assert.equal(draft.rule_id, rule.rule_id);
  assert.equal(draft.automation_key, 'AUTO_COMMISSION:' + rule.rule_id + ':' + chain.booking.booking_id);
  assert.equal(draft.beneficiary_name, 'Maria Referrer');
  assert.equal(draft.basis, 'FLAT');
  assert.equal(draft.computed_amount, '1250.50');
  assert.equal(draft.currency, 'PHP');
  assert.equal(draft.recorded_by, 'staff', 'draft is attributed to the actor who created the booking');
  assert.ok(draft.notes.indexOf('Maria referral') !== -1);

  const manual = runtime.recordCommission({ booking_id: chain.booking.booking_id, beneficiary_name: 'Manual Partner', basis: 'FLAT', amount: '300.00' }, staff());
  assert.equal(manual.ok, true, 'manual recordCommission still works unchanged alongside automation');
  assert.equal(runtime.list('Commission').length, 2);
  assert.equal(manual.data.automation_key, null);
  assert.equal(manual.data.rule_id, null);

  const auditRow = runtime.auditLog.list().filter((entry) => entry.action === 'APPLY_COMMISSION_RULES' && entry.result === 'SUCCESS' && !entry.details.skipped).pop();
  assert.equal(auditRow.entity_id, draft.commission_id);
  assert.equal(auditRow.details.rule_id, rule.rule_id);
  assert.equal(auditRow.details.trigger, 'BOOKING_CREATED');
  assert.equal(auditRow.details.computed_amount, '1250.50');
});

test('a BOOKING_FULLY_PAID rule drafts exactly once, only at the transition to fully paid', () => {
  const runtime = makeRuntime();
  const rule = runtime.addCommissionRule({ name: 'Paid-out partner', beneficiary_name: 'Partner B', basis: 'PERCENT', percent: 5, trigger: 'BOOKING_FULLY_PAID' }, manager()).data;
  const chain = bookingChain(runtime, {});
  assert.equal(chain.booking.client_total, '52000.00');
  assert.equal(runtime.list('Commission').length, 0, 'booking creation alone fires nothing for a fully-paid rule');

  assert.equal(runtime.createBookingPaymentObligations({ booking_id: chain.booking.booking_id, obligations: [{ sequence: 1, purpose: 'FULL_PAYMENT', amount: '52000.00', currency: 'PHP', due_at: '2026-08-30T09:00:00.000Z' }] }, staff()).ok, true);
  const partial = payBooking(runtime, chain, '30000.00', 1);
  assert.equal(partial.allocated.ok, true);
  assert.equal(runtime.list('Commission').length, 0, 'partial payment does not trigger the fully-paid rule');

  const full = payBooking(runtime, chain, '22000.00', 2);
  assert.equal(full.allocated.ok, true);
  const commissions = runtime.list('Commission');
  assert.equal(commissions.length, 1, 'the exact transition drafts one commission');
  assert.equal(commissions[0].computed_amount, '2600.00', '5% of 52000.00 via the shared minor-units math');
  assert.equal(commissions[0].automation_key, 'AUTO_COMMISSION:' + rule.rule_id + ':' + chain.booking.booking_id);

  const again = runtime.applyCommissionRules({ booking_id: chain.booking.booking_id, trigger: 'BOOKING_FULLY_PAID' }, staff());
  assert.equal(again.ok, true);
  assert.equal(again.data.skipped.length, 1, 'an explicit re-trigger finds the existing record and skips');
  assert.equal(again.data.skipped[0].reason, 'ALREADY_APPLIED');
  assert.equal(runtime.list('Commission').length, 1);

  assert.equal(runtime.approveCommission({ commission_id: commissions[0].commission_id }, manager()).ok, true);
  const afterApproval = runtime.applyCommissionRules({ booking_id: chain.booking.booking_id, trigger: 'BOOKING_FULLY_PAID' }, staff());
  assert.equal(afterApproval.data.skipped.length, 1);
  assert.equal(afterApproval.data.skipped[0].existing_status, 'APPROVED', 'a commission approved after drafting still blocks duplication');
  assert.equal(runtime.list('Commission').length, 1, 'no duplicate even after approval');

  const skipAudit = runtime.auditLog.list().filter((entry) => entry.action === 'APPLY_COMMISSION_RULES' && entry.result === 'SUCCESS' && entry.details.skipped);
  assert.equal(skipAudit.length, 2, 'every skip is audited');
});

test('rule application failures never fail the booking and are audited without drafting', () => {
  const runtime = makeRuntime();
  assert.equal(runtime.addCommissionRule({ name: 'Percent partner', beneficiary_name: 'Partner C', basis: 'PERCENT', percent: 10, trigger: 'BOOKING_CREATED' }, manager()).ok, true);
  // Anomalous booking without a client total: the quotation's total is
  // nulled between approval and acceptance, so the accepted snapshot (and
  // the booking built from it) carries no price a percent could read.
  const client = runtime.createClient({ display_name: 'Unpriced Client', primary_email: 'unpriced@example.test' }, staff()).data;
  const person = runtime.createPerson({ display_name: 'Lead Pax Unpriced' }, staff()).data;
  const quotation = runtime.createQuotation({ client_id: client.client_id, destination: 'Cebu', supplier_cost_total: '40000.00', currency: 'PHP' }, staff()).data;
  assert.equal(makeQuotationApprovable(runtime, quotation, staff()).ok, true);
  assert.equal(runtime.approveQuotation({ quotation_id: quotation.quotation_id }, manager()).ok, true);
  assert.equal(runtime.updateRecord('Quotation', quotation.quotation_id, { client_total: null }, staff()).ok, true);
  assert.equal(runtime.acceptQuotation({ quotation_id: quotation.quotation_id, accepted_by: client.client_id }, staff()).ok, true);
  const booking = runtime.createBooking({ quotation_id: quotation.quotation_id, lead_pax_person_id: person.person_id }, staff());
  assert.equal(booking.ok, true, 'booking creation succeeds even though the rule cannot compute');
  assert.equal(booking.data.client_total, null);
  assert.equal(runtime.list('Commission').length, 0, 'no commission was drafted');
  const failure = runtime.auditLog.list().filter((entry) => entry.action === 'APPLY_COMMISSION_RULES' && entry.result === 'FAILURE').pop();
  assert.equal(failure.details.error_code, 'COMMISSION_BASIS_AMOUNT_MISSING', 'a percent rule with no client total fails closed');

  const badTrigger = runtime.applyCommissionRules({ booking_id: booking.data.booking_id, trigger: 'WHENEVER' }, staff());
  assert.equal(badTrigger.ok, false);
  assert.equal(badTrigger.error.code, 'COMMISSION_RULE_TRIGGER_INVALID');
  const missingBooking = runtime.applyCommissionRules({ booking_id: 'BOOKING-9999-000001', trigger: 'BOOKING_CREATED' }, staff());
  assert.equal(missingBooking.ok, false);
  assert.equal(missingBooking.error.code, 'NOT_FOUND');
});

test('the EXPO source filter drafts only for expo-traceable bookings', () => {
  const runtime = makeRuntime();
  const rule = runtime.addCommissionRule({ name: 'Expo partner', beneficiary_name: 'Expo Partner', basis: 'FLAT', amount: '500.00', trigger: 'BOOKING_CREATED', source_filter: 'EXPO' }, manager()).data;
  const plain = bookingChain(runtime, { clientName: 'Plain Client' });
  assert.equal(runtime.list('Commission').length, 0, 'a booking with no expo lineage gets no commission');

  const expo = expoBookingChain(runtime, {});
  const commissions = runtime.list('Commission');
  assert.equal(commissions.length, 1, 'the converted-lead inquiry lineage matches');
  assert.equal(commissions[0].booking_id, expo.booking.booking_id);
  assert.equal(commissions[0].rule_id, rule.rule_id);
  assert.equal(commissions[0].automation_key, 'AUTO_COMMISSION:' + rule.rule_id + ':' + expo.booking.booking_id);

  assert.equal(runtime.updateCommissionRule({ rule_id: rule.rule_id, active: false }, manager()).ok, true);
  const anotherPlain = bookingChain(runtime, { clientName: 'After Deactivate Client' });
  assert.equal(anotherPlain.booking.booking_id !== plain.booking.booking_id, true);
  assert.equal(runtime.list('Commission').length, 1, 'deactivated rules never fire');
});

test('rules persist through the settings mechanism and updateSettings can replace them', () => {
  const seen = [];
  const runtime = makeRuntime({ config: { trustedActors: AUTH, defaultCurrency: 'PHP' }, onSettingsChanged: (settings) => seen.push(settings) });
  const added = runtime.addCommissionRule({ name: 'Persisted rule', beneficiary_name: 'Maria Referrer', basis: 'PERCENT', percent: 7.5, trigger: 'BOOKING_FULLY_PAID' }, manager()).data;
  assert.equal(seen.length, 1, 'rule mutations notify the persistence hook');
  assert.equal(seen[0].commissionRules.length, 1);
  assert.equal(seen[0].commissionRules[0].rule_id, added.rule_id);
  assert.ok(seen[0].quotationDefaults, 'the hook still carries the other persisted sections');

  const replaced = runtime.updateSettings({ commission_rules: [
    { rule_id: 'COMMISSION_RULE-2026-000001', name: 'Bulk rule', beneficiary_name: 'Bulk Partner', basis: 'FLAT', amount: '75.00', currency: 'PHP', trigger: 'BOOKING_CREATED', source_filter: null, active: true }
  ] }, manager());
  assert.equal(replaced.ok, true);
  assert.equal(replaced.data.commissionRules.length, 1);
  assert.equal(replaced.data.commissionRules[0].name, 'Bulk rule');
  assert.equal(runtime.listCommissionRules({}, staff()).data.counts.total, 1);

  const invalid = runtime.updateSettings({ commission_rules: [{ name: 'No id', beneficiary_name: 'X', basis: 'FLAT', amount: '1.00', trigger: 'BOOKING_CREATED' }] }, manager());
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'COMMISSION_RULE_ID_INVALID', 'bulk replacement entries must carry registry-style rule ids');
  assert.equal(runtime.listCommissionRules({}, staff()).data.counts.total, 1, 'a rejected replacement leaves the stored rules untouched');
});

test('commission rules and auto-drafts work over HTTP with manager gating', async () => {
  const runtime = makeRuntime();
  const phase1App = createPhase1Application({ runtime, seedSynthetic: false });
  const { server } = createMvpServer({ phase1App });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = async (body) => {
    const response = await fetch(base + '/api/phase1/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const staffAdd = await post({ action: 'addCommissionRule', input: { name: 'HTTP rule', beneficiary_name: 'HTTP Referrer', basis: 'PERCENT', percent: 10, trigger: 'BOOKING_CREATED' }, actor: 'staff' });
    assert.equal(staffAdd.status, 400);
    assert.equal(staffAdd.body.error.code, 'AUTHORIZATION_REQUIRED');

    const managerAdd = await post({ action: 'addCommissionRule', input: { name: 'HTTP rule', beneficiary_name: 'HTTP Referrer', basis: 'PERCENT', percent: 10, trigger: 'BOOKING_CREATED' }, actor: 'manager' });
    assert.equal(managerAdd.status, 200);
    assert.match(managerAdd.body.data.rule_id, /^COMMISSION_RULE-2026-\d{6}$/);

    const chain = bookingChain(runtime, { clientName: 'HTTP Auto Client' });
    assert.equal(chain.booking.client_total, '52000.00');
    const listed = await post({ action: 'listCommissions', input: { booking_id: chain.booking.booking_id }, actor: 'staff' });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.data.commissions.length, 1);
    const draft = listed.body.data.commissions[0];
    assert.equal(draft.source, 'AUTO_RULE');
    assert.equal(draft.rule_id, managerAdd.body.data.rule_id);
    assert.equal(draft.computed_amount, '5200.00');
    assert.equal(draft.status, 'DRAFT');

    const staffUpdate = await post({ action: 'updateCommissionRule', input: { rule_id: managerAdd.body.data.rule_id, active: false }, actor: 'staff' });
    assert.equal(staffUpdate.status, 400);
    assert.equal(staffUpdate.body.error.code, 'AUTHORIZATION_REQUIRED');

    const managerUpdate = await post({ action: 'updateCommissionRule', input: { rule_id: managerAdd.body.data.rule_id, active: false }, actor: 'manager' });
    assert.equal(managerUpdate.status, 200);
    assert.equal(managerUpdate.body.data.active, false);

    const rules = await post({ action: 'listCommissionRules', input: {}, actor: 'staff' });
    assert.equal(rules.status, 200);
    assert.equal(rules.body.data.counts.inactive, 1);

    const internal = await post({ action: 'applyCommissionRules', input: { booking_id: chain.booking.booking_id, trigger: 'BOOKING_CREATED' }, actor: 'manager' });
    assert.equal(internal.status, 400);
    assert.equal(internal.body.error.code, 'UNKNOWN_ACTION', 'applyCommissionRules stays internal to the runtime hooks');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
