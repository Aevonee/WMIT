'use strict';

function normalizeFlightNumber(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^(?:PHP|USD|EUR|JPY|KRW|SGD)\d/.test(normalized)) return null;
  return /^[A-Z0-9]{2,3}[0-9]{2,4}$/.test(normalized) ? normalized : null;
}

function normalizeCurrency(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).toUpperCase().trim();
  const aliases = { '$': 'USD', 'US$': 'USD', '\u20b1': 'PHP', 'PESO': 'PHP', 'PH': 'PHP' };
  return aliases[normalized] || (/^[A-Z]{3}$/.test(normalized) ? normalized : null);
}

function normalizeAmount(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const cleaned = String(value).replace(/[,\s]/g, '').replace(/[^0-9.-]/g, '');
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function normalizePaxCount(value) {
  if (value === undefined || value === null) return null;
  const match = String(value).match(/[0-9]+/);
  return match ? Number(match[0]) : null;
}

function normalizeDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const valid = (year, month, day) => {
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return date.getUTCFullYear() === Number(year)
      && date.getUTCMonth() === Number(month) - 1
      && date.getUTCDate() === Number(day);
  };
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(raw)) {
    return valid(raw.slice(0, 4), raw.slice(5, 7), raw.slice(8, 10)) ? raw : null;
  }
  const numeric = raw.match(/^([0-9]{1,2})[\/.-]([0-9]{1,2})[\/.-]([0-9]{4})$/);
  if (numeric && valid(numeric[3], numeric[2], numeric[1])) {
    return numeric[3] + '-' + numeric[2].padStart(2, '0') + '-' + numeric[1].padStart(2, '0');
  }
  const month = raw.match(/^([0-9]{1,2})[ \t]+([A-Za-z]{3,9})[ \t]+([0-9]{4})$/);
  if (month) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const index = months.indexOf(month[2].slice(0, 3).toLowerCase()) + 1;
    if (index > 0 && valid(month[3], index, month[1])) {
      return month[3] + '-' + String(index).padStart(2, '0') + '-' + month[1].padStart(2, '0');
    }
  }
  return null;
}

function normalizeField(fieldName, rawValue) {
  if (rawValue === undefined || rawValue === null) return null;
  if (fieldName === 'flight_number') return normalizeFlightNumber(rawValue);
  if (fieldName === 'currency') return normalizeCurrency(rawValue);
  if (['unit_price', 'amount', 'discount', 'tax', 'commission', 'deposit', 'balance', 'single_supplement', 'land_only_rate'].includes(fieldName)) return normalizeAmount(rawValue);
  if (['pax_count', 'minimum_pax', 'room_count', 'quantity', 'occupancy_count'].includes(fieldName)) return normalizePaxCount(rawValue);
  if (['travel_start', 'travel_end', 'check_in', 'check_out', 'due_date', 'date', 'validity_start', 'validity_end'].includes(fieldName)) return normalizeDate(rawValue);
  return String(rawValue).trim();
}

module.exports = { normalizeFlightNumber, normalizeCurrency, normalizeAmount, normalizePaxCount, normalizeDate, normalizeField };
