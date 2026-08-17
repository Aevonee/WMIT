'use strict';

const { WmitError } = require('./errors');

function toMinorUnits(value) {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new WmitError('INVALID_MONEY', 'Money values must be finite numbers or decimal strings.', { value });
  }
  const text = String(value === undefined || value === null ? '' : value).trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text)) {
    throw new WmitError('INVALID_MONEY', 'Money values must use a non-negative amount with up to two decimal places.', { value });
  }
  const parts = text.split('.');
  return BigInt(parts[0]) * 100n + BigInt((parts[1] || '').padEnd(2, '0') || '0');
}

function fromMinorUnits(value) {
  const amount = typeof value === 'bigint' ? value : BigInt(value);
  if (amount < 0n) throw new WmitError('INVALID_MONEY', 'Money values cannot be negative.', { value });
  const major = amount / 100n;
  const minor = String(amount % 100n).padStart(2, '0');
  return major.toString() + '.' + minor;
}

function decimalStringToNumber(value) {
  const text = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    throw new WmitError('INVALID_MONEY', 'Expected an exact non-negative decimal money value.', { value });
  }
  return Number(text);
}

function sumMoney(values) {
  const total = (values || []).reduce((sum, value) => sum + toMinorUnits(value), 0n);
  return fromMinorUnits(total);
}

function calculateInvoiceTotals(items, adjustments) {
  const lines = items || [];
  const options = adjustments || {};
  const subtotal = lines.reduce((sum, item) => {
    const amount = item.amount !== undefined ? item.amount : toMinorUnits(item.quantity || 0) * toMinorUnits(item.unit_price || 0) / 100n;
    return sum + (typeof amount === 'bigint' ? amount : toMinorUnits(amount));
  }, 0n);
  const discount = toMinorUnits(options.discount || 0);
  const fees = toMinorUnits(options.fees || 0);
  const tax = toMinorUnits(options.tax || 0);
  const total = subtotal - discount + fees + tax;
  if (total < 0n) throw new WmitError('INVALID_MONEY', 'Invoice adjustments cannot make the total negative.');
  return {
    subtotal: fromMinorUnits(subtotal),
    discount: fromMinorUnits(discount),
    fees: fromMinorUnits(fees),
    tax: fromMinorUnits(tax),
    total: fromMinorUnits(total)
  };
}

module.exports = { toMinorUnits, fromMinorUnits, decimalStringToNumber, sumMoney, calculateInvoiceTotals };
