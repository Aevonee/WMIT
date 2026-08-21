'use strict';

// Sales overview: read-only business metrics over existing Phase 1 records,
// in the same pure-function style as today-overview.js. Currencies are kept
// separate and never converted; profit is only computed for bookings whose
// supplier costs are actually recorded, everything else is flagged as
// costNotRecorded instead of being faked as zero-cost profit.

const { toMinorUnits, fromMinorUnits } = require('../core/money');
const { resolveAsOf } = require('./today-overview');

const SALES_OVERVIEW_VERSION = 'V1';
const MONTHS_WINDOW = 12;
const PACKAGES_TOP = 10;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function collectEntities(source) {
  if (source && typeof source.list === 'function') {
    const names = [
      'Client', 'Quotation', 'Booking', 'BookingItem', 'ClientPayment',
      'SupplierPayment', 'Commission', 'RefundAdjustment', 'SupplierPackage'
    ];
    return Object.fromEntries(names.map((name) => [name, asArray(source.list(name))]));
  }
  const value = source && source.ok && source.data ? source.data : source;
  return (value && value.entities) || value || {};
}

function records(entities, type) {
  return asArray(entities[type]);
}

function upper(value) {
  return String(value || '').trim().toUpperCase();
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

function formatMinor(minor) {
  const amount = typeof minor === 'bigint' ? minor : BigInt(minor || 0);
  return amount < 0n ? '-' + fromMinorUnits(-amount) : fromMinorUnits(amount);
}

function monthKeyOf(value) {
  const date = dateOnly(value);
  return date ? date.slice(0, 7) : null;
}

function monthKeysEndingOn(asOf) {
  const year = Number(asOf.slice(0, 4));
  const month = Number(asOf.slice(5, 7));
  const keys = [];
  for (let offset = MONTHS_WINDOW - 1; offset >= 0; offset -= 1) {
    const total = year * 12 + (month - 1) - offset;
    keys.push(String(Math.floor(total / 12)) + '-' + String((total % 12) + 1).padStart(2, '0'));
  }
  return keys;
}

function monthLabelOf(monthKey) {
  const parts = String(monthKey).split('-').map(Number);
  return MONTH_NAMES[parts[1] - 1] + ' ' + parts[0];
}

function monthBounds(monthKey) {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: monthKey + '-01', end: monthKey + '-' + String(lastDay).padStart(2, '0') };
}

function bookingCurrency(booking, quotationsById) {
  if (booking.currency) return String(booking.currency).trim().toUpperCase();
  const quote = quotationsById.get(booking.quotation_id);
  return String(quote && quote.currency || 'PHP').trim().toUpperCase();
}

function bookingBookedMinor(booking) {
  const value = booking.client_total !== undefined && booking.client_total !== null && String(booking.client_total).trim() !== ''
    ? booking.client_total
    : booking.current_price;
  return moneyOrZero(value);
}

function supplierCostMinorForBooking(booking, itemsByBooking) {
  const items = itemsByBooking.get(booking.booking_id) || [];
  let total = 0n;
  let anyCostRecorded = false;
  items.forEach((item) => {
    const unitCost = item.unit_cost !== undefined && item.unit_cost !== null && String(item.unit_cost).trim() !== ''
      ? item.unit_cost
      : item.supplier_cost;
    if (unitCost === undefined || unitCost === null || String(unitCost).trim() === '') return;
    const unitMinor = moneyOrZero(unitCost);
    const quantity = Number(item.quantity === undefined || item.quantity === null || item.quantity === '' ? 1 : item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) return;
    total += unitMinor * BigInt(Math.round(quantity * 100)) / 100n;
    if (unitMinor > 0n) anyCostRecorded = true;
  });
  return { total, recorded: anyCostRecorded && total > 0n };
}

function bookingChargeMinor(booking, rows, currency) {
  let total = 0n;
  rows.forEach((row) => {
    if (row.booking_id !== booking.booking_id) return;
    const rowCurrency = upper(row.currency) || currency;
    if (rowCurrency !== currency) return;
    total += moneyOrZero(row.computed_amount !== undefined && row.computed_amount !== null && String(row.computed_amount).trim() !== '' ? row.computed_amount : row.amount);
  });
  return total;
}

function buildMonthlySales(entities, asOf) {
  const quotationsById = new Map(records(entities, 'Quotation').map((quote) => [quote.quotation_id, quote]));
  const itemsByBooking = new Map();
  records(entities, 'BookingItem').forEach((item) => {
    const list = itemsByBooking.get(item.booking_id) || [];
    list.push(item);
    itemsByBooking.set(item.booking_id, list);
  });
  const paidCommissions = records(entities, 'Commission').filter((commission) => upper(commission.status) === 'PAID');
  const executedRefunds = records(entities, 'RefundAdjustment').filter((refund) => upper(refund.state) === 'EXECUTED');
  const confirmedBookingIds = new Set(records(entities, 'SupplierPayment')
    .filter((payment) => upper(payment.state) === 'EXECUTED' && payment.booking_id)
    .map((payment) => payment.booking_id));

  const monthKeys = monthKeysEndingOn(asOf);
  const months = monthKeys.map((month) => ({ month, currencies: {} }));
  const monthByKey = new Map(months.map((entry) => [entry.month, entry]));

  records(entities, 'Booking').forEach((booking) => {
    const month = monthKeyOf(booking.created_at);
    const entry = month && monthByKey.get(month);
    if (!entry) return;
    const currency = bookingCurrency(booking, quotationsById);
    const bookedMinor = bookingBookedMinor(booking);
    const bucket = entry.currencies[currency] || (entry.currencies[currency] = { bookings: 0, booked: 0n, profit: null, profitBookings: 0, costNotRecorded: 0, confirmed: 0n });
    bucket.bookings += 1;
    bucket.booked += bookedMinor;
    if (confirmedBookingIds.has(booking.booking_id)) bucket.confirmed += bookedMinor;
    const cost = supplierCostMinorForBooking(booking, itemsByBooking);
    if (!cost.recorded) { bucket.costNotRecorded += 1; return; }
    const commissionsMinor = bookingChargeMinor(booking, paidCommissions, currency);
    const refundsMinor = bookingChargeMinor(booking, executedRefunds, currency);
    const profitMinor = bookedMinor - cost.total - commissionsMinor - refundsMinor;
    bucket.profit = (bucket.profit === null ? 0n : bucket.profit) + profitMinor;
    bucket.profitBookings += 1;
  });

  months.forEach((entry) => {
    Object.keys(entry.currencies).forEach((currency) => {
      const bucket = entry.currencies[currency];
      bucket.booked = formatMinor(bucket.booked);
      bucket.confirmed = formatMinor(bucket.confirmed);
      bucket.profit = bucket.profit === null ? null : formatMinor(bucket.profit);
    });
  });
  return { monthsWindow: MONTHS_WINDOW, months };
}

function buildPackagesBooked(entities) {
  const quotations = records(entities, 'Quotation');
  const quotationsById = new Map(quotations.map((quote) => [quote.quotation_id, quote]));
  const packagesById = new Map(records(entities, 'SupplierPackage').map((pkg) => [pkg.supplier_package_id, pkg]));
  const confirmedBookingIds = new Set(records(entities, 'SupplierPayment')
    .filter((payment) => upper(payment.state) === 'EXECUTED' && payment.booking_id)
    .map((payment) => payment.booking_id));

  const statsById = new Map();
  const statsFor = (packageId) => {
    if (!statsById.has(packageId)) {
      statsById.set(packageId, {
        packageId,
        name: null,
        destination: null,
        quotes: 0,
        bookings: 0,
        supplierPaidBookings: 0,
        confirmedRevenueMinor: new Map()
      });
    }
    return statsById.get(packageId);
  };

  quotations.forEach((quote) => {
    const packageId = quote.supplier_package_id;
    if (!packageId) return;
    const stats = statsFor(packageId);
    stats.quotes += 1;
    const pkg = packagesById.get(packageId);
    if (pkg) {
      stats.name = pkg.name || stats.name;
      stats.destination = pkg.destination || stats.destination;
    }
  });

  records(entities, 'Booking').forEach((booking) => {
    const quote = quotationsById.get(booking.quotation_id);
    const packageId = quote && quote.supplier_package_id;
    if (!packageId) return;
    const stats = statsFor(packageId);
    stats.bookings += 1;
    if (confirmedBookingIds.has(booking.booking_id)) {
      stats.supplierPaidBookings += 1;
      const currency = bookingCurrency(booking, quotationsById);
      const revenue = stats.confirmedRevenueMinor.get(currency) || 0n;
      stats.confirmedRevenueMinor.set(currency, revenue + bookingBookedMinor(booking));
    }
  });

  const packages = Array.from(statsById.values()).map((stats) => ({
    packageId: stats.packageId,
    name: stats.name || stats.packageId,
    destination: stats.destination,
    quotes: stats.quotes,
    bookings: stats.bookings,
    supplierPaidBookings: stats.supplierPaidBookings,
    revenue: Object.fromEntries(Array.from(stats.confirmedRevenueMinor.entries()).map(([currency, minor]) => [currency, formatMinor(minor)]))
  }));
  const confirmedWeight = new Map(Array.from(statsById.values()).map((stats) => [stats.packageId, Array.from(stats.confirmedRevenueMinor.values()).reduce((sum, minor) => sum + minor, 0n)]));
  packages.sort((a, b) => {
    const difference = confirmedWeight.get(b.packageId) - confirmedWeight.get(a.packageId);
    if (difference !== 0n) return difference < 0n ? -1 : 1;
    return b.bookings - a.bookings || String(a.packageId).localeCompare(String(b.packageId));
  });
  return { count: packages.length, packages: packages.slice(0, PACKAGES_TOP) };
}

function buildTravelersThisMonth(entities, asOf) {
  const month = asOf.slice(0, 7);
  const bounds = monthBounds(month);
  let travelers = 0;
  let bookings = 0;
  records(entities, 'Booking').forEach((booking) => {
    const start = dateOnly(booking.travel_start);
    const end = dateOnly(booking.travel_end) || start;
    if (!start || !end) return;
    if (start > bounds.end || end < bounds.start) return;
    travelers += Number(booking.pax_count || 0) || 0;
    bookings += 1;
  });
  return { month, monthLabel: monthLabelOf(month), travelers, bookings };
}

function buildCashCollected(entities, monthlySales, asOf) {
  const bookedByMonth = new Map(monthlySales.months.map((entry) => [entry.month, entry.currencies]));
  const months = monthKeysEndingOn(asOf).map((month) => ({ month, currencies: {} }));
  const monthByKey = new Map(months.map((entry) => [entry.month, entry]));
  records(entities, 'ClientPayment')
    .filter((payment) => upper(payment.payment_state || payment.state) === 'VERIFIED')
    .forEach((payment) => {
      const month = monthKeyOf(payment.actual_sent_at || payment.created_at);
      const entry = month && monthByKey.get(month);
      if (!entry) return;
      const currency = upper(payment.currency) || 'PHP';
      const bucket = entry.currencies[currency] || (entry.currencies[currency] = { collected: 0n, booked: 0n });
      bucket.collected += moneyOrZero(payment.amount);
    });
  months.forEach((entry) => {
    const bookedCurrencies = bookedByMonth.get(entry.month) || {};
    Object.keys(bookedCurrencies).forEach((currency) => {
      const bucket = entry.currencies[currency] || (entry.currencies[currency] = { collected: 0n, booked: 0n });
      bucket.booked = moneyOrZero(bookedCurrencies[currency].booked);
    });
    Object.keys(entry.currencies).forEach((currency) => {
      const bucket = entry.currencies[currency];
      bucket.collected = formatMinor(bucket.collected);
      bucket.booked = formatMinor(bucket.booked);
    });
  });
  return { monthsWindow: MONTHS_WINDOW, months };
}

function buildSalesOverview(source, options) {
  const opts = options || {};
  const asOf = resolveAsOf(opts.asOf, opts.now);
  const entities = collectEntities(source);
  const monthlySales = buildMonthlySales(entities, asOf);
  return {
    version: SALES_OVERVIEW_VERSION,
    asOf,
    monthlySales,
    packagesBooked: buildPackagesBooked(entities),
    travelersThisMonth: buildTravelersThisMonth(entities, asOf),
    cashCollected: buildCashCollected(entities, monthlySales, asOf)
  };
}

module.exports = {
  SALES_OVERVIEW_VERSION,
  MONTHS_WINDOW,
  PACKAGES_TOP,
  buildSalesOverview
};
