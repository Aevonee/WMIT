'use strict';

// Accountant period export: pure, read-only projection of the money
// movements, client receivables, and supplier payables of an accounting
// period, rendered as three Excel-friendly CSV documents (cashbook,
// receivables, payables). Same pure-function style as today-overview.js: the
// runtime method that calls this (getAccountantExport) owns audit and result
// shaping; this module never mutates anything.
//
// Money rules mirror today-overview/departure-readiness/case-projection:
// verified client payments allocate through ACTIVE PaymentAllocation rows;
// ClientObligation is authoritative with PaymentScheduleItem as the fallback
// record set. Unverified client payments appear in the cashbook clearly
// flagged but never reduce receivables. All arithmetic goes through the
// minor-units money helpers — never floats.

const { WmitError } = require('../core/errors');
const { toMinorUnits, fromMinorUnits } = require('../core/money');

const ACCOUNTANT_EXPORT_VERSION = 'V1';
const EXPORT_TYPES = Object.freeze(['cashbook', 'receivables', 'payables']);
const CSV_BOM = '\ufeff';
const SETTLED_SUPPLIER_PAYMENT_STATES = new Set(['EXECUTED', 'VERIFIED']);

const CASHBOOK_HEADER = Object.freeze(['date', 'type', 'reference_ids', 'booking_id', 'counterparty', 'currency', 'amount', 'status']);
const RECEIVABLES_HEADER = Object.freeze(['booking_id', 'client_name', 'travel_start', 'travel_end', 'currency', 'obligations_total', 'verified_received', 'verified_allocated', 'outstanding']);
const PAYABLES_HEADER = Object.freeze(['supplier_payable_id', 'supplier_name', 'booking_id', 'currency', 'amount', 'paid', 'outstanding', 'state']);

function upper(value) {
  return String(value || '').trim().toUpperCase();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function collectEntities(source) {
  if (source && typeof source.list === 'function') {
    const names = [
      'Client', 'Booking', 'Supplier', 'SupplierBooking',
      'ClientObligation', 'PaymentScheduleItem', 'ClientPayment', 'PaymentAllocation',
      'SupplierPayable', 'SupplierPayment', 'RefundAdjustment'
    ];
    return Object.fromEntries(names.map((name) => [name, asArray(source.list(name))]));
  }
  const value = source && source.ok && source.data ? source.data : source;
  return (value && value.entities) || value || {};
}

function records(entities, type) {
  return asArray(entities[type]);
}

function dateOnly(value) {
  const raw = String(value === undefined || value === null ? '' : value).trim();
  if (!raw) return null;
  const date = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function moneyOrZero(value) {
  try { return toMinorUnits(value === undefined || value === null || value === '' ? '0.00' : value); }
  catch (_) { return 0n; }
}

// Signed decimal string for movements; fromMinorUnits rejects negatives, so
// the sign is applied around the absolute minor-unit amount.
function signedMoney(minor) {
  const amount = minor < 0n ? -minor : minor;
  return (minor < 0n ? '-' : '') + fromMinorUnits(amount);
}

function parsePeriodDate(value, field) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new WmitError('PERIOD_REQUIRED', 'Both from and to dates are required for an accountant export.', { field });
  }
  const raw = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) {
    throw new WmitError('PERIOD_INVALID', 'Export period dates must look like 2026-08-20.', { field, value: raw.slice(0, 20) });
  }
  return raw;
}

function resolveExportPeriod(options) {
  const opts = options || {};
  const from = parsePeriodDate(opts.from, 'from');
  const to = parsePeriodDate(opts.to, 'to');
  if (from > to) {
    throw new WmitError('PERIOD_ORDER_INVALID', 'The export start date must be on or before the end date.', { from, to });
  }
  return { from, to };
}

// ---------------------------------------------------------------------------
// CSV rendering — RFC 4180-style escaping: quote any field containing a
// comma, quote, CR, or LF; double embedded quotes; CRLF line endings so
// Excel opens the file cleanly. The BOM-prefixed variant is what gets
// attached over HTTP (accountants double-click these files).
// ---------------------------------------------------------------------------

function csvEscapeField(value) {
  const text = String(value === undefined || value === null ? '' : value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function toCsv(rows) {
  return rows.map((row) => row.map(csvEscapeField).join(',')).join('\r\n');
}

function csvDocument(header, dataRows) {
  const all = [header.slice()].concat(dataRows);
  const csv = toCsv(all);
  return { csv, bom: CSV_BOM + csv, rows: dataRows, count: dataRows.length };
}

// ---------------------------------------------------------------------------
// Cashbook — one row per money movement inside the period. Client payments
// are positive; supplier payments and executed refunds are negative. Both
// verified and unverified client payments appear (accountants reconcile
// against bank statements); the status column flags which is which. Rejected
// payment evidence never moved money and is excluded.
// ---------------------------------------------------------------------------

function clientNameFor(entities, bookingId, clientId) {
  const booking = bookingId ? records(entities, 'Booking').find((candidate) => candidate.booking_id === bookingId) : null;
  const resolvedClientId = (booking && booking.client_id) || clientId || null;
  const client = resolvedClientId ? records(entities, 'Client').find((candidate) => candidate.client_id === resolvedClientId) : null;
  return client && (client.display_name || client.legal_name) || resolvedClientId || null;
}

function supplierNameFor(entities, supplierId, supplierBookingId) {
  const suppliers = records(entities, 'Supplier');
  const direct = supplierId && suppliers.find((candidate) => candidate.supplier_id === supplierId);
  if (direct) return direct.display_name || direct.legal_name || direct.supplier_id;
  const booking = supplierBookingId && records(entities, 'SupplierBooking').find((candidate) => candidate.supplier_booking_id === supplierBookingId);
  const viaBooking = booking && booking.supplier_id && suppliers.find((candidate) => candidate.supplier_id === booking.supplier_id);
  return viaBooking && (viaBooking.display_name || viaBooking.legal_name || viaBooking.supplier_id) || null;
}

function inPeriod(date, from, to) {
  return Boolean(date) && date >= from && date <= to;
}

function onOrBefore(date, to) {
  return Boolean(date) && date <= to;
}

function cashbookRows(entities, from, to) {
  const rows = [];
  records(entities, 'ClientPayment').forEach((payment) => {
    const state = upper(payment.payment_state || payment.state);
    if (state !== 'VERIFIED' && state !== 'PENDING_VERIFICATION') return; // rejected evidence moved no money
    const date = dateOnly(payment.actual_sent_at || payment.created_at);
    if (!inPeriod(date, from, to)) return;
    rows.push({
      date,
      type: 'CLIENT_PAYMENT',
      referenceIds: payment.client_payment_id || null,
      bookingId: payment.booking_id || null,
      counterparty: clientNameFor(entities, payment.booking_id, payment.client_id),
      currency: payment.currency || null,
      amountMinor: moneyOrZero(payment.amount),
      signed: true,
      status: state === 'VERIFIED' ? 'VERIFIED' : 'UNVERIFIED'
    });
  });
  records(entities, 'SupplierPayment').forEach((payment) => {
    if (!SETTLED_SUPPLIER_PAYMENT_STATES.has(upper(payment.state))) return;
    const date = dateOnly(payment.executed_at || payment.created_at);
    if (!inPeriod(date, from, to)) return;
    const payable = payment.supplier_payable_id
      ? records(entities, 'SupplierPayable').find((candidate) => candidate.supplier_payable_id === payment.supplier_payable_id)
      : null;
    rows.push({
      date,
      type: 'SUPPLIER_PAYMENT',
      referenceIds: [payment.supplier_payment_id, payment.supplier_payable_id].filter(Boolean).join('; ') || null,
      bookingId: payment.booking_id || (payable && payable.booking_id) || null,
      counterparty: supplierNameFor(entities, payable && payable.supplier_id, payment.supplier_booking_id || (payable && payable.supplier_booking_id)),
      currency: payment.currency || (payable && payable.currency) || null,
      amountMinor: -moneyOrZero(payment.amount),
      signed: true,
      status: upper(payment.state)
    });
  });
  records(entities, 'RefundAdjustment').forEach((refund) => {
    if (upper(refund.state) !== 'EXECUTED') return; // a draft refund has not moved money
    const date = dateOnly(refund.executed_at || refund.created_at);
    if (!inPeriod(date, from, to)) return;
    rows.push({
      date,
      type: 'REFUND',
      referenceIds: refund.refund_adjustment_id || null,
      bookingId: refund.booking_id || null,
      counterparty: clientNameFor(entities, refund.booking_id, refund.client_id),
      currency: refund.currency || null,
      amountMinor: -moneyOrZero(refund.amount),
      signed: true,
      status: 'EXECUTED'
    });
  });
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type) || String(a.referenceIds).localeCompare(String(b.referenceIds)));
  return rows.map((row) => [row.date, row.type, row.referenceIds, row.bookingId, row.counterparty, row.currency, signedMoney(row.amountMinor), row.status]);
}

// ---------------------------------------------------------------------------
// Receivables — as of the period end. Per booking with recorded obligations:
// obligations total, verified received, verified allocated, and outstanding
// (obligations minus verified allocations, floored at zero per obligation —
// exactly the today-overview/departure-readiness math).
// ---------------------------------------------------------------------------

function receivablesRows(entities, to) {
  const clientsById = new Map(records(entities, 'Client').map((client) => [client.client_id, client]));
  const bookingsById = new Map(records(entities, 'Booking').map((booking) => [booking.booking_id, booking]));
  const payments = records(entities, 'ClientPayment')
    .filter((payment) => onOrBefore(dateOnly(payment.actual_sent_at || payment.created_at), to));
  const verifiedPayments = payments.filter((payment) => upper(payment.payment_state || payment.state) === 'VERIFIED');
  const verifiedPaymentIds = new Set(verifiedPayments.map((payment) => payment.client_payment_id));
  const allocations = records(entities, 'PaymentAllocation')
    .filter((allocation) => upper(allocation.state || 'ACTIVE') === 'ACTIVE' && verifiedPaymentIds.has(allocation.client_payment_id))
    .filter((allocation) => onOrBefore(dateOnly(allocation.created_at), to));
  const obligationsAsOf = records(entities, 'ClientObligation').filter((record) => onOrBefore(dateOnly(record.created_at), to));
  const scheduleAsOf = records(entities, 'PaymentScheduleItem').filter((record) => onOrBefore(dateOnly(record.created_at), to));

  const bookingsWithObligations = new Map();
  obligationsAsOf.forEach((obligation) => {
    if (!bookingsWithObligations.has(obligation.booking_id)) bookingsWithObligations.set(obligation.booking_id, []);
    bookingsWithObligations.get(obligation.booking_id).push(obligation);
  });
  scheduleAsOf.forEach((item) => {
    if (bookingsWithObligations.has(item.booking_id)) return;
    const hasAuthoritative = obligationsAsOf.some((obligation) => obligation.booking_id === item.booking_id);
    if (hasAuthoritative) return; // ClientObligation is authoritative when present
    if (!bookingsWithObligations.has(item.booking_id)) bookingsWithObligations.set(item.booking_id, []);
    bookingsWithObligations.get(item.booking_id).push(item);
  });

  const rows = [];
  Array.from(bookingsWithObligations.keys()).sort().forEach((bookingId) => {
    const authoritative = bookingsWithObligations.get(bookingId);
    const booking = bookingsById.get(bookingId) || null;
    const client = booking && clientsById.get(booking.client_id) || null;
    let totalMinor = 0n;
    let allocatedMinor = 0n;
    authoritative.forEach((obligation) => {
      const obligationId = obligation.client_obligation_id || obligation.payment_schedule_item_id;
      const amountMinor = moneyOrZero(obligation.amount || obligation.total_amount || obligation.balance_due);
      totalMinor += amountMinor;
      const targeted = allocations.filter((allocation) => {
        if (allocation.client_obligation_id) return allocation.client_obligation_id === obligationId;
        return !obligationsAsOf.length && authoritative.length === 1 && allocation.booking_id === bookingId;
      });
      const obligationAllocated = targeted.reduce((sum, allocation) => sum + moneyOrZero(allocation.amount), 0n);
      allocatedMinor += obligationAllocated > amountMinor ? amountMinor : obligationAllocated;
    });
    const verifiedReceivedMinor = verifiedPayments
      .filter((payment) => payment.booking_id === bookingId)
      .reduce((sum, payment) => sum + moneyOrZero(payment.amount), 0n);
    const outstandingMinor = totalMinor - allocatedMinor;
    rows.push([
      bookingId,
      client && (client.display_name || client.legal_name) || (booking && booking.client_id) || null,
      booking && dateOnly(booking.travel_start) || null,
      booking && dateOnly(booking.travel_end) || null,
      authoritative[0].currency || (booking && booking.currency) || null,
      fromMinorUnits(totalMinor),
      fromMinorUnits(verifiedReceivedMinor),
      fromMinorUnits(allocatedMinor),
      signedMoney(outstandingMinor < 0n ? 0n : outstandingMinor)
    ]);
  });
  return rows;
}

// ---------------------------------------------------------------------------
// Payables — as of the period end. One row per Supplier Payable: amount,
// executed supplier payments against it, and the outstanding remainder.
// ---------------------------------------------------------------------------

function payablesRows(entities, to) {
  const payments = records(entities, 'SupplierPayment')
    .filter((payment) => SETTLED_SUPPLIER_PAYMENT_STATES.has(upper(payment.state)))
    .filter((payment) => onOrBefore(dateOnly(payment.executed_at || payment.created_at), to));
  return records(entities, 'SupplierPayable')
    .filter((payable) => onOrBefore(dateOnly(payable.created_at), to))
    .map((payable) => {
      const paidMinor = payments
        .filter((payment) => payment.supplier_payable_id === payable.supplier_payable_id)
        .reduce((sum, payment) => sum + moneyOrZero(payment.amount), 0n);
      const amountMinor = moneyOrZero(payable.amount || payable.total_amount);
      const outstandingMinor = amountMinor - paidMinor;
      return [
        payable.supplier_payable_id,
        supplierNameFor(entities, payable.supplier_id, payable.supplier_booking_id),
        payable.booking_id || null,
        payable.currency || null,
        fromMinorUnits(amountMinor),
        fromMinorUnits(paidMinor),
        signedMoney(outstandingMinor < 0n ? 0n : outstandingMinor),
        upper(payable.state || 'DRAFT')
      ];
    })
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

// ---------------------------------------------------------------------------
// Summary — joined totals across the three documents. Movement totals are
// split by status so unverified client money is never silently blended into
// verified cash.
// ---------------------------------------------------------------------------

function accumulate(map, currency, minor) {
  const key = currency || '???';
  map[key] = (map[key] || 0n) + minor;
}

function formatMoneyMap(map) {
  return Object.fromEntries(Object.keys(map).sort().map((key) => [key, signedMoney(map[key])]));
}

// Exact round-trip of signedMoney ("-123.45") output; never parse money with floats.
function signedToMinor(text) {
  const raw = String(text);
  const minor = toMinorUnits(raw.replace('-', ''));
  return raw.startsWith('-') ? -minor : minor;
}

function buildSummary(cashbookData, receivablesData, payablesData) {
  const byType = { CLIENT_PAYMENT: 0, SUPPLIER_PAYMENT: 0, REFUND: 0 };
  const verifiedReceived = {};
  const unverifiedReceived = {};
  const paidOut = {};
  const refunded = {};
  cashbookData.forEach((row) => {
    const [, type, , , , currency, amount, status] = row;
    byType[type] += 1;
    const minor = signedToMinor(amount);
    if (type === 'CLIENT_PAYMENT') accumulate(status === 'VERIFIED' ? verifiedReceived : unverifiedReceived, currency, minor);
    else if (type === 'SUPPLIER_PAYMENT') accumulate(paidOut, currency, minor);
    else accumulate(refunded, currency, minor);
  });
  const receivablesOutstanding = {};
  receivablesData.forEach((row) => accumulate(receivablesOutstanding, row[4], toMinorUnits(row[8])));
  const payablesOutstanding = {};
  payablesData.forEach((row) => accumulate(payablesOutstanding, row[3], toMinorUnits(row[6])));
  return {
    cashbook: {
      count: cashbookData.length,
      by_type: byType,
      movements: {
        verified_received: formatMoneyMap(verifiedReceived),
        unverified_received: formatMoneyMap(unverifiedReceived),
        paid_to_suppliers: formatMoneyMap(paidOut),
        refunded_to_clients: formatMoneyMap(refunded)
      }
    },
    receivables: { count: receivablesData.length, outstanding_by_currency: formatMoneyMap(receivablesOutstanding) },
    payables: { count: payablesData.length, outstanding_by_currency: formatMoneyMap(payablesOutstanding) }
  };
}

function buildAccountantExport(source, options) {
  const period = resolveExportPeriod(options);
  const entities = collectEntities(source);
  const cashbook = csvDocument(CASHBOOK_HEADER, cashbookRows(entities, period.from, period.to));
  const receivables = csvDocument(RECEIVABLES_HEADER, receivablesRows(entities, period.to));
  const payables = csvDocument(PAYABLES_HEADER, payablesRows(entities, period.to));
  return {
    version: ACCOUNTANT_EXPORT_VERSION,
    from: period.from,
    to: period.to,
    cashbook,
    receivables,
    payables,
    summary: buildSummary(cashbook.rows, receivables.rows, payables.rows)
  };
}

module.exports = {
  ACCOUNTANT_EXPORT_VERSION,
  EXPORT_TYPES,
  CSV_BOM,
  CASHBOOK_HEADER,
  RECEIVABLES_HEADER,
  PAYABLES_HEADER,
  csvEscapeField,
  toCsv,
  resolveExportPeriod,
  buildAccountantExport
};
