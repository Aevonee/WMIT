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
  manager: [ACTIONS.APPROVE_QUOTATION, ACTIONS.VERIFY_PAYMENT, ACTIONS.COMMISSION_APPROVE, ACTIONS.COMMISSION_PAY]
};
const staff = () => ({ actor: 'staff', correlationId: 'COMMISSION-TEST' });
const manager = () => ({ actor: 'manager', correlationId: 'COMMISSION-TEST' });

function makeRuntime() {
  return createPhase1Runtime({ clock: CLOCK, config: { trustedActors: AUTH } });
}

function bookingChain(runtime, overrides) {
  const options = overrides || {};
  const client = runtime.createClient({ display_name: options.clientName || 'Commission Client', primary_email: 'commission@example.test' }, staff()).data;
  const person = runtime.createPerson({ display_name: 'Lead Pax ' + client.display_name }, staff()).data;
  const quotation = runtime.createQuotation({ client_id: client.client_id, destination: 'Cebu', supplier_cost_total: options.supplierCost || '41500.00', client_total: options.clientTotal || '50000.00', currency: 'PHP' }, staff()).data;
  assert.equal(makeQuotationApprovable(runtime, quotation, staff()).ok, true);
  assert.equal(runtime.approveQuotation({ quotation_id: quotation.quotation_id }, manager()).ok, true);
  assert.equal(runtime.acceptQuotation({ quotation_id: quotation.quotation_id, accepted_by: client.client_id }, staff()).ok, true);
  const booking = runtime.createBooking({ quotation_id: quotation.quotation_id, lead_pax_person_id: person.person_id }, staff()).data;
  return { client, person, quotation, booking };
}

test('recordCommission stores a DRAFT flat commission with a generated year-based id', () => {
  const runtime = makeRuntime();
  const chain = bookingChain(runtime, {});
  const result = runtime.recordCommission({ booking_id: chain.booking.booking_id, beneficiary_name: 'Maria Referrer', basis: 'FLAT', amount: '1250.50', source: 'EXPO_LEAD-2026-000042', notes: 'Expo referral' }, staff());
  assert.equal(result.ok, true);
  assert.equal(result.meta.action, 'RECORD_COMMISSION');
  assert.match(result.data.commission_id, /^COMMISSION-2026-\d{6}$/);
  assert.equal(result.data.booking_id, chain.booking.booking_id);
  assert.equal(result.data.source, 'EXPO_LEAD-2026-000042');
  assert.equal(result.data.beneficiary_name, 'Maria Referrer');
  assert.equal(result.data.basis, 'FLAT');
  assert.equal(result.data.amount, '1250.50');
  assert.equal(result.data.percent, null);
  assert.equal(result.data.computed_amount, '1250.50');
  assert.equal(result.data.currency, 'PHP');
  assert.equal(result.data.status, 'DRAFT');
  assert.equal(result.data.recorded_by, 'staff');
  const auditRow = runtime.auditLog.list().filter((entry) => entry.action === 'RECORD_COMMISSION' && entry.result === 'SUCCESS').pop();
  assert.equal(auditRow.entity_id, result.data.commission_id);
  assert.equal(auditRow.details.computed_amount, '1250.50');
});

test('PERCENT commissions compute exactly from the booking client total via minor units', () => {
  const runtime = makeRuntime();
  // createQuotation applies the 30% standard markup to the supplier cost, so
  // the booking client_total is cost * 1.3; each fixture pins that base first.
  const clean = bookingChain(runtime, { supplierCost: '40000.00' });
  assert.equal(clean.booking.client_total, '52000.00');
  const sevenHalf = runtime.recordCommission({ booking_id: clean.booking.booking_id, beneficiary_name: 'Maria Referrer', basis: 'PERCENT', percent: 7.5 }, staff());
  assert.equal(sevenHalf.ok, true);
  assert.equal(sevenHalf.data.computed_amount, '3900.00', '7.5% of 52000.00 is exact');
  assert.equal(sevenHalf.data.percent, '7.5');
  assert.equal(sevenHalf.data.amount, null);

  const awkward = bookingChain(runtime, { supplierCost: '33333.33', clientName: 'Rounding Client' });
  assert.equal(awkward.booking.client_total, '43333.32');
  const odd = runtime.recordCommission({ booking_id: awkward.booking.booking_id, beneficiary_name: 'Partner B', basis: 'PERCENT', percent: '7.5' }, staff());
  assert.equal(odd.ok, true);
  assert.equal(odd.data.computed_amount, '3250.00', '7.5% of 43333.32 (324999.9 cents) rounds half up to 3250.00');

  const tiny = bookingChain(runtime, { supplierCost: '0.10', clientName: 'Tiny Client' });
  assert.equal(tiny.booking.client_total, '0.13');
  const cent = runtime.recordCommission({ booking_id: tiny.booking.booking_id, beneficiary_name: 'Partner C', basis: 'PERCENT', percent: 50 }, staff());
  assert.equal(cent.data.computed_amount, '0.07', '50% of 0.13 (6.5 cents) rounds half up to 0.07');
});

test('recordCommission fails closed on invalid input and audits each failure', () => {
  const runtime = makeRuntime();
  const chain = bookingChain(runtime, {});
  const cases = [
    [{ beneficiary_name: 'X', basis: 'FLAT', amount: '1.00' }, 'REQUIRED_FIELD'],
    [{ booking_id: 'BOOKING-9999-000001', beneficiary_name: 'X', basis: 'FLAT', amount: '1.00' }, 'NOT_FOUND'],
    [{ booking_id: chain.booking.booking_id, basis: 'FLAT', amount: '1.00' }, 'REQUIRED_FIELD'],
    [{ booking_id: chain.booking.booking_id, beneficiary_name: 'X', basis: 'MYSTERY', amount: '1.00' }, 'COMMISSION_BASIS_INVALID'],
    [{ booking_id: chain.booking.booking_id, beneficiary_name: 'X', basis: 'FLAT', amount: '0.00' }, 'COMMISSION_AMOUNT_INVALID'],
    [{ booking_id: chain.booking.booking_id, beneficiary_name: 'X', basis: 'FLAT' }, 'INVALID_MONEY'],
    [{ booking_id: chain.booking.booking_id, beneficiary_name: 'X', basis: 'PERCENT' }, 'REQUIRED_FIELD'],
    [{ booking_id: chain.booking.booking_id, beneficiary_name: 'X', basis: 'PERCENT', percent: 0 }, 'COMMISSION_PERCENT_INVALID'],
    [{ booking_id: chain.booking.booking_id, beneficiary_name: 'X', basis: 'PERCENT', percent: 101 }, 'COMMISSION_PERCENT_INVALID'],
    [{ booking_id: chain.booking.booking_id, beneficiary_name: 'X', basis: 'PERCENT', percent: 10, currency: 'PESOS' }, 'INVALID_CURRENCY'],
    [{ booking_id: chain.booking.booking_id, beneficiary_name: 'X', basis: 'FLAT', amount: '1.00', status: 'APPROVED' }, 'COMMISSION_STATUS_INVALID']
  ];
  cases.forEach(([input, code]) => {
    const result = runtime.recordCommission(input, staff());
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.equal(result.error.code, code, JSON.stringify(input));
  });
  assert.equal(runtime.list('Commission').length, 0, 'no commission records were created');
  const failures = runtime.auditLog.list().filter((entry) => entry.action === 'RECORD_COMMISSION' && entry.result === 'FAILURE');
  assert.equal(failures.length, cases.length, 'each rejected call audited a failure row');
});

test('commission lifecycle is DRAFT -> APPROVED -> PAID with manager gates and immutable amounts', () => {
  const runtime = makeRuntime();
  const chain = bookingChain(runtime, {});
  const commission = runtime.recordCommission({ booking_id: chain.booking.booking_id, beneficiary_name: 'Maria Referrer', basis: 'FLAT', amount: '800.00' }, staff()).data;

  const staffApproval = runtime.approveCommission({ commission_id: commission.commission_id }, staff());
  assert.equal(staffApproval.ok, false);
  assert.equal(staffApproval.error.code, 'AUTHORIZATION_REQUIRED', 'staff cannot approve commissions');

  const approved = runtime.approveCommission({ commission_id: commission.commission_id }, manager());
  assert.equal(approved.ok, true);
  assert.equal(approved.data.status, 'APPROVED');
  assert.equal(approved.data.approved_by, 'manager');
  assert.ok(approved.data.approved_at);
  assert.equal(approved.data.computed_amount, '800.00', 'approval never changes the amount');

  const amountEdit = runtime.approveCommission({ commission_id: commission.commission_id, amount: '1.00' }, manager());
  assert.equal(amountEdit.ok, false);
  assert.equal(amountEdit.error.code, 'COMMISSION_AMOUNT_IMMUTABLE');

  const skipToPaid = runtime.markCommissionPaid({ commission_id: commission.commission_id }, manager());
  assert.equal(skipToPaid.ok, false);
  assert.equal(skipToPaid.error.code, 'COMMISSION_EVIDENCE_REQUIRED', 'no evidence supplied yet');
  const paidNoEvidence = runtime.markCommissionPaid({ commission_id: commission.commission_id, payment_reference: '' }, manager());
  assert.equal(paidNoEvidence.ok, false);
  assert.equal(paidNoEvidence.error.code, 'COMMISSION_EVIDENCE_REQUIRED');

  const paid = runtime.markCommissionPaid({ commission_id: commission.commission_id, payment_reference: 'PAYOUT-2026-0091' }, manager());
  assert.equal(paid.ok, true);
  assert.equal(paid.data.status, 'PAID');
  assert.equal(paid.data.paid_at, CLOCK().toISOString());
  assert.equal(paid.data.payment_reference, 'PAYOUT-2026-0091');
  assert.equal(paid.data.computed_amount, '800.00', 'payment never changes the amount');
  assert.equal(runtime.list('Commission')[0].computed_amount, '800.00');

  const replay = runtime.markCommissionPaid({ commission_id: commission.commission_id }, manager());
  assert.equal(replay.ok, true);
  assert.equal(replay.meta.idempotent, true);

  const reApprove = runtime.approveCommission({ commission_id: commission.commission_id }, manager());
  assert.equal(reApprove.ok, false);
  assert.equal(reApprove.error.code, 'COMMISSION_STATE_INVALID', 'PAID cannot move backwards');

  const paidAmountEdit = runtime.markCommissionPaid({ commission_id: commission.commission_id, computed_amount: '5.00' }, manager());
  assert.equal(paidAmountEdit.ok, false);
  assert.equal(paidAmountEdit.error.code, 'COMMISSION_AMOUNT_IMMUTABLE');

  const staffPay = runtime.markCommissionPaid({ commission_id: commission.commission_id, payment_reference: 'X' }, staff());
  assert.equal(staffPay.ok, false);
  assert.equal(staffPay.error.code, 'AUTHORIZATION_REQUIRED', 'staff cannot mark commissions paid');

  const successActions = ['RECORD_COMMISSION', 'APPROVE_COMMISSION', 'MARK_COMMISSION_PAID'];
  successActions.forEach((action) => {
    assert.ok(runtime.auditLog.list().some((entry) => entry.action === action && entry.result === 'SUCCESS'), action + ' audited');
  });
  ['APPROVE_COMMISSION', 'MARK_COMMISSION_PAID'].forEach((action) => {
    assert.ok(runtime.auditLog.list().some((entry) => entry.action === action && entry.result === 'FAILURE'), action + ' failures audited');
  });
});

test('markCommissionPaid accepts an explicit paid_at date as evidence and validates it', () => {
  const runtime = makeRuntime();
  const chain = bookingChain(runtime, {});
  const commission = runtime.recordCommission({ booking_id: chain.booking.booking_id, beneficiary_name: 'Late Payout', basis: 'FLAT', amount: '100.00' }, staff()).data;
  assert.equal(runtime.approveCommission({ commission_id: commission.commission_id }, manager()).ok, true);
  const paid = runtime.markCommissionPaid({ commission_id: commission.commission_id, paid_at: '2026-08-25T08:00:00.000Z' }, manager());
  assert.equal(paid.ok, true);
  assert.equal(paid.data.status, 'PAID');
  assert.equal(paid.data.paid_at, '2026-08-25T08:00:00.000Z');
  assert.equal(paid.data.payment_reference, null);

  const second = runtime.recordCommission({ booking_id: chain.booking.booking_id, beneficiary_name: 'Bad Date', basis: 'FLAT', amount: '50.00' }, staff()).data;
  assert.equal(runtime.approveCommission({ commission_id: second.commission_id }, manager()).ok, true);
  const invalid = runtime.markCommissionPaid({ commission_id: second.commission_id, paid_at: 'whenever' }, manager());
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'COMMISSION_PAID_AT_INVALID');
  assert.equal(runtime.list('Commission').find((entry) => entry.commission_id === second.commission_id).status, 'APPROVED');
});

test('listCommissions filters by booking, status, and beneficiary', () => {
  const runtime = makeRuntime();
  const first = bookingChain(runtime, {});
  const second = bookingChain(runtime, { clientName: 'Second Client' });
  const a = runtime.recordCommission({ booking_id: first.booking.booking_id, beneficiary_name: 'Maria Referrer', basis: 'FLAT', amount: '100.00' }, staff()).data;
  const b = runtime.recordCommission({ booking_id: second.booking.booking_id, beneficiary_name: 'maria referrer', basis: 'PERCENT', percent: 5 }, staff()).data;
  const c = runtime.recordCommission({ booking_id: second.booking.booking_id, beneficiary_name: 'Partner B', basis: 'FLAT', amount: '75.00' }, staff()).data;
  assert.equal(runtime.approveCommission({ commission_id: b.commission_id }, manager()).ok, true);

  const all = runtime.listCommissions({}, staff());
  assert.equal(all.ok, true);
  assert.equal(all.meta.read_only, true);
  assert.equal(all.data.counts.total, 3);
  assert.equal(all.data.counts.DRAFT, 2);
  assert.equal(all.data.counts.APPROVED, 1);
  assert.equal(all.data.counts.PAID, 0);
  assert.deepEqual(all.data.commissions.map((commission) => commission.commission_id), [a.commission_id, b.commission_id, c.commission_id]);

  const byBooking = runtime.listCommissions({ booking_id: second.booking.booking_id }, staff());
  assert.deepEqual(byBooking.data.commissions.map((commission) => commission.commission_id), [b.commission_id, c.commission_id]);

  const byStatus = runtime.listCommissions({ status: 'APPROVED' }, staff());
  assert.deepEqual(byStatus.data.commissions.map((commission) => commission.commission_id), [b.commission_id]);

  const byBeneficiary = runtime.listCommissions({ beneficiary: 'Maria' }, staff());
  assert.equal(byBeneficiary.data.counts.total, 2, 'beneficiary match is case-insensitive');
  const badStatus = runtime.listCommissions({ status: 'HOLD' }, staff());
  assert.equal(badStatus.ok, false);
  assert.equal(badStatus.error.code, 'COMMISSION_STATUS_INVALID');
  assert.ok(runtime.auditLog.list().some((entry) => entry.action === 'LIST_COMMISSIONS' && entry.result === 'SUCCESS'));
});

test('getCommissionSummary totals by status and beneficiary with optional period bounds', () => {
  const runtime = makeRuntime();
  const chain = bookingChain(runtime, { supplierCost: '40000.00' });
  assert.equal(chain.booking.client_total, '52000.00');
  const a = runtime.recordCommission({ booking_id: chain.booking.booking_id, beneficiary_name: 'Maria Referrer', basis: 'FLAT', amount: '1250.50', currency: 'USD' }, staff()).data;
  const b = runtime.recordCommission({ booking_id: chain.booking.booking_id, beneficiary_name: 'Partner B', basis: 'PERCENT', percent: 7.5 }, staff()).data;
  assert.equal(b.computed_amount, '3900.00');
  assert.equal(runtime.approveCommission({ commission_id: b.commission_id }, manager()).ok, true);
  assert.equal(runtime.markCommissionPaid({ commission_id: b.commission_id, payment_reference: 'PAYOUT-1' }, manager()).ok, true);

  const all = runtime.getCommissionSummary({}, staff());
  assert.equal(all.ok, true);
  assert.equal(all.data.counts.total, 2);
  assert.equal(all.data.by_status.DRAFT.count, 1);
  assert.equal(all.data.by_status.DRAFT.amounts.USD, '1250.50');
  assert.equal(all.data.by_status.APPROVED.count, 0);
  assert.equal(all.data.by_status.PAID.count, 1);
  assert.equal(all.data.by_status.PAID.amounts.PHP, '3900.00');
  assert.equal(all.data.by_beneficiary['Maria Referrer'].amounts.USD, '1250.50');
  assert.equal(all.data.by_beneficiary['Partner B'].amounts.PHP, '3900.00');

  const august = runtime.getCommissionSummary({ from: '2026-08-01', to: '2026-08-31' }, staff());
  assert.equal(august.data.counts.total, 2);
  const september = runtime.getCommissionSummary({ from: '2026-09-01', to: '2026-09-30' }, staff());
  assert.equal(september.data.counts.total, 0, 'no commissions exist in September');

  const invalid = runtime.getCommissionSummary({ from: '2026-09-01' }, staff());
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'PERIOD_REQUIRED', 'a half-open period is rejected');

  const empty = makeRuntime().getCommissionSummary({}, staff());
  assert.equal(empty.ok, true);
  assert.equal(empty.data.counts.total, 0);
  assert.equal(empty.data.by_status.DRAFT.count, 0);
  assert.ok(runtime.auditLog.list().some((entry) => entry.action === 'GET_COMMISSION_SUMMARY' && entry.result === 'SUCCESS'));
});

test('commission lifecycle works over HTTP through the phase 1 action dispatcher', async () => {
  const runtime = makeRuntime();
  const chain = bookingChain(runtime, { clientName: 'HTTP Commission Client', supplierCost: '40000.00' });
  assert.equal(chain.booking.client_total, '52000.00');
  const phase1App = createPhase1Application({ runtime, seedSynthetic: false });
  const { server } = createMvpServer({ phase1App });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = async (body) => {
    const response = await fetch(base + '/api/phase1/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const recorded = await post({ action: 'recordCommission', input: { booking_id: chain.booking.booking_id, beneficiary_name: 'HTTP Referrer', basis: 'PERCENT', percent: 10 }, actor: 'staff' });
    assert.equal(recorded.status, 200);
    const commissionId = recorded.body.data.commission_id;
    assert.equal(recorded.body.data.status, 'DRAFT');
    assert.equal(recorded.body.data.computed_amount, '5200.00', '10% of 52000.00');

    const staffApprove = await post({ action: 'approveCommission', input: { commission_id: commissionId }, actor: 'staff' });
    assert.equal(staffApprove.status, 400);
    assert.equal(staffApprove.body.error.code, 'AUTHORIZATION_REQUIRED');

    const amountEdit = await post({ action: 'approveCommission', input: { commission_id: commissionId, amount: '1.00' }, actor: 'manager' });
    assert.equal(amountEdit.status, 400);
    assert.equal(amountEdit.body.error.code, 'COMMISSION_AMOUNT_IMMUTABLE');

    const approved = await post({ action: 'approveCommission', input: { commission_id: commissionId }, actor: 'manager' });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.data.status, 'APPROVED');

    const paid = await post({ action: 'markCommissionPaid', input: { commission_id: commissionId, payment_reference: 'PAYOUT-HTTP-1' }, actor: 'manager' });
    assert.equal(paid.status, 200);
    assert.equal(paid.body.data.status, 'PAID');
    assert.equal(paid.body.data.paid_at, CLOCK().toISOString());

    const listed = await post({ action: 'listCommissions', input: { status: 'PAID' }, actor: 'staff' });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.data.commissions[0].commission_id, commissionId);

    const summary = await post({ action: 'getCommissionSummary', input: {}, actor: 'staff' });
    assert.equal(summary.status, 200);
    assert.equal(summary.body.data.by_status.PAID.amounts.PHP, '5200.00');

    const unknown = await post({ action: 'deleteCommission', input: {}, actor: 'manager' });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.error.code, 'UNKNOWN_ACTION', 'no undocumented commission action exists');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
