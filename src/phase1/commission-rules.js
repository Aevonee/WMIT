'use strict';

// Pure helpers for automatic commission DRAFT rules. The runtime owns the
// audited actions (addCommissionRule / updateCommissionRule /
// listCommissionRules / applyCommissionRules); this module holds the shared,
// side-effect-free pieces so rule validation, expo lineage, and idempotency
// keys behave identically everywhere they are used.
//
// Owner rule: financial automation may draft, humans approve and pay. These
// helpers never touch money movement — they only decide whether a DRAFT
// commission should exist.

const { WmitError } = require('../core/errors');
const { toMinorUnits, fromMinorUnits } = require('../core/money');

const COMMISSION_RULE_TRIGGERS = Object.freeze(['BOOKING_CREATED', 'BOOKING_FULLY_PAID']);
const COMMISSION_RULE_SOURCE_FILTERS = Object.freeze(['EXPO']);
const COMMISSION_RULE_BASIS_VALUES = Object.freeze(['FLAT', 'PERCENT']);
const COMMISSION_RULE_LIMIT = 100;
const COMMISSION_RULE_ID_PATTERN = /^COMMISSION_RULE-\d{4}-\d{6}$/;

// Natural idempotency key for an auto-drafted commission. One rule can ever
// produce at most one commission per booking, in any lifecycle state: if a
// commission with this key already exists (DRAFT, APPROVED, or PAID) the rule
// is skipped. Commissions have no discard action, so a re-trigger after
// approval still finds the record and never duplicates.
function autoCommissionKey(ruleId, bookingId) {
  return 'AUTO_COMMISSION:' + ruleId + ':' + bookingId;
}

// Which bookings are traceable to an expo lead. Mirrors expoLineage in
// src/expo/expo-analytics.js exactly: a booked ExpoQuote link, a lead's
// booking link, or a booking built from a converted lead's Inquiry. A
// recorded source string alone never makes a booking expo-sourced.
function bookingExpoTraceable(list, booking) {
  if (!booking) return false;
  if (booking.booking_id && list('ExpoQuote').some((quote) => quote.booking_id === booking.booking_id)) return true;
  const leads = list('ExpoLead');
  if (booking.booking_id && leads.some((lead) => lead.booking_id === booking.booking_id)) return true;
  return Boolean(booking.inquiry_id && leads.some((lead) => lead.converted_inquiry_id === booking.inquiry_id));
}

// Rules that fire for a trigger: active, trigger match, and source filter
// satisfied (null/empty filter = all bookings; 'EXPO' = expo-traceable only).
function rulesMatchingTrigger(rules, trigger, expoTraceable) {
  return (Array.isArray(rules) ? rules : [])
    .filter((rule) => rule && rule.active !== false && String(rule.trigger || '').toUpperCase() === trigger)
    .filter((rule) => !rule.source_filter || (rule.source_filter === 'EXPO' && expoTraceable));
}

// Rule amount validation mirrors recordCommission's FLAT/PERCENT gates
// (positive money / 0-100 percent, minor units) so a rule can never be stored
// that would compute an invalid commission later.
function validateCommissionRuleAmount(basis, amountValue, percentValue) {
  if (basis === 'FLAT') {
    const text = String(amountValue === undefined || amountValue === null ? '' : amountValue).trim();
    if (!text) throw new WmitError('REQUIRED_FIELD', 'amount is required.', { field: 'amount' });
    let flatAmount;
    try { flatAmount = fromMinorUnits(toMinorUnits(text)); }
    catch (_) { throw new WmitError('INVALID_MONEY', 'amount must be a valid non-negative amount.', { field: 'amount' }); }
    if (toMinorUnits(flatAmount) <= 0n) throw new WmitError('COMMISSION_AMOUNT_INVALID', 'Commission amount must be greater than zero.', {});
    return { amount: flatAmount, percent: null };
  }
  const rawPercent = percentValue === undefined || percentValue === null || String(percentValue).trim() === '' ? null : percentValue;
  if (rawPercent === null) throw new WmitError('REQUIRED_FIELD', 'percent is required.', { field: 'percent' });
  const percentNumber = Number(rawPercent);
  if (!Number.isFinite(percentNumber) || percentNumber <= 0 || percentNumber > 100) {
    throw new WmitError('COMMISSION_PERCENT_INVALID', 'Commission percent must be greater than 0 and at most 100.', { percent: String(rawPercent).slice(0, 20) });
  }
  return { amount: null, percent: String(rawPercent).trim() };
}

// Validates and normalizes one rule entry. When requireRuleId is true the
// entry must already carry a well-formed, registry-style rule_id (used by the
// settings bulk-replace path); addCommissionRule generates the id itself.
function validateCommissionRuleEntry(entry, options) {
  const opts = options || {};
  const value = entry || {};
  const name = String(value.name === undefined || value.name === null ? '' : value.name).trim();
  if (!name) throw new WmitError('REQUIRED_FIELD', 'name is required.', { field: 'name' });
  if (name.length > 120) throw new WmitError('INVALID_SETTING', 'Rule name must be at most 120 characters.', { field: 'name' });
  const beneficiaryRaw = value.beneficiary_name === undefined || value.beneficiary_name === null ? '' : value.beneficiary_name;
  const beneficiaryName = String(beneficiaryRaw).trim();
  if (!beneficiaryName) throw new WmitError('REQUIRED_FIELD', 'beneficiary_name is required.', { field: 'beneficiary_name' });
  if (beneficiaryName.length > 160) throw new WmitError('INVALID_SETTING', 'Beneficiary name must be at most 160 characters.', { field: 'beneficiary_name' });
  const basis = String(value.basis === undefined || value.basis === null ? '' : value.basis).trim().toUpperCase();
  if (!COMMISSION_RULE_BASIS_VALUES.includes(basis)) {
    throw new WmitError('COMMISSION_BASIS_INVALID', 'Commission basis must be FLAT or PERCENT.', { field: 'basis', basis: basis || null, allowed: COMMISSION_RULE_BASIS_VALUES.slice() });
  }
  const trigger = String(value.trigger === undefined || value.trigger === null ? '' : value.trigger).trim().toUpperCase();
  if (!COMMISSION_RULE_TRIGGERS.includes(trigger)) {
    throw new WmitError('COMMISSION_RULE_TRIGGER_INVALID', 'Commission rule trigger must be one of: ' + COMMISSION_RULE_TRIGGERS.join(', ') + '.', { field: 'trigger', trigger: trigger || null, allowed: COMMISSION_RULE_TRIGGERS.slice() });
  }
  let sourceFilter = value.source_filter === undefined || value.source_filter === null ? null : String(value.source_filter).trim().toUpperCase();
  if (sourceFilter === '') sourceFilter = null;
  if (sourceFilter !== null && !COMMISSION_RULE_SOURCE_FILTERS.includes(sourceFilter)) {
    throw new WmitError('COMMISSION_RULE_SOURCE_FILTER_INVALID', 'Commission rule source filter must be EXPO or empty.', { field: 'source_filter', source_filter: sourceFilter, allowed: COMMISSION_RULE_SOURCE_FILTERS.slice() });
  }
  const currency = String(value.currency || opts.defaultCurrency || 'PHP').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new WmitError('INVALID_CURRENCY', 'Commission currency must be a three-letter currency code.', { currency });
  const amounts = validateCommissionRuleAmount(basis, value.amount, value.percent);
  let active = value.active === undefined ? true : value.active;
  if (typeof active !== 'boolean') {
    if (active === 'true') active = true;
    else if (active === 'false') active = false;
    else throw new WmitError('INVALID_SETTING', 'Rule active flag must be true or false.', { field: 'active', active: value.active });
  }
  const rule = {
    rule_id: value.rule_id || null,
    name,
    beneficiary_name: beneficiaryName,
    basis,
    amount: amounts.amount,
    percent: amounts.percent,
    currency,
    trigger,
    source_filter: sourceFilter,
    active
  };
  if (opts.requireRuleId) {
    if (!rule.rule_id || !COMMISSION_RULE_ID_PATTERN.test(rule.rule_id)) {
      throw new WmitError('COMMISSION_RULE_ID_INVALID', 'Each commission rule needs a rule id like COMMISSION_RULE-2026-000001.', { field: 'rule_id', rule_id: rule.rule_id });
    }
  }
  return rule;
}

// Settings bulk-replace validator, same shape as the runtime's
// validatedMessageTemplates: whole-array replacement, unique ids, capped.
function validatedCommissionRules(rules, options) {
  if (!Array.isArray(rules)) throw new WmitError('INVALID_SETTING', 'commission_rules must be a list.');
  if (rules.length > COMMISSION_RULE_LIMIT) throw new WmitError('INVALID_SETTING', 'At most ' + COMMISSION_RULE_LIMIT + ' commission rules are allowed.');
  const seen = new Set();
  return rules.map((entry) => {
    const rule = validateCommissionRuleEntry(entry, Object.assign({ requireRuleId: true }, options));
    if (seen.has(rule.rule_id)) throw new WmitError('INVALID_SETTING', 'Duplicate commission rule id: ' + rule.rule_id);
    seen.add(rule.rule_id);
    return rule;
  });
}

function commissionRuleView(rule) {
  return {
    rule_id: rule.rule_id,
    name: rule.name,
    beneficiary_name: rule.beneficiary_name,
    basis: rule.basis,
    amount: rule.amount,
    percent: rule.percent,
    currency: rule.currency,
    trigger: rule.trigger,
    source_filter: rule.source_filter,
    active: rule.active !== false,
    created_at: rule.created_at || null,
    updated_at: rule.updated_at || null
  };
}

module.exports = {
  COMMISSION_RULE_TRIGGERS,
  COMMISSION_RULE_SOURCE_FILTERS,
  COMMISSION_RULE_LIMIT,
  autoCommissionKey,
  bookingExpoTraceable,
  rulesMatchingTrigger,
  validateCommissionRuleEntry,
  validatedCommissionRules,
  commissionRuleView
};
