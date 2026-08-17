'use strict';

const { classifyDocument } = require('./taxonomy');
const { normalizeField, normalizeDate } = require('./normalizer');
const { createExtractionResult, addExtractedField, finalizeExtractionResult } = require('./extraction-result');

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10,
  october: 10, nov: 11, november: 11, dec: 12, december: 12
};
const MONTH_NAME = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const CURRENCY = '(?:PHP|USD|EUR|JPY|KRW|SGD|US\\$|\\u20b1|\\$)';
const MONEY = new RegExp(CURRENCY + '\\s*([0-9]+(?:[ ,][0-9]{3})*(?:\\.[0-9]{1,2})?)', 'gi');

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1] || match[0];
  }
  return null;
}

function addField(result, fieldName, rawValue, confidence, warnings) {
  const raw = rawValue === undefined ? null : rawValue;
  const normalized = normalizeField(fieldName, raw);
  return addExtractedField(result, {
    field_name: fieldName,
    raw_value: raw,
    normalized_value: normalized,
    confidence: confidence === undefined ? (normalized === null ? 0 : 0.75) : confidence,
    warnings: warnings || [],
    review_status: (warnings && warnings.length) || normalized === null ? 'NEEDS_REVIEW' : 'EXTRACTED'
  });
}

function monthNumber(value) {
  return MONTHS[String(value || '').replace('.', '').toLowerCase()] || null;
}

function makeDate(day, month, year) {
  const monthNumberValue = typeof month === 'number' ? month : monthNumber(month);
  if (!monthNumberValue || !year) return null;
  return normalizeDate(String(day).padStart(2, '0') + '-' + String(monthNumberValue).padStart(2, '0') + '-' + year);
}

function parseDateRange(text) {
  text = String(text || '').replace(/[–—]/g, '-');
  const patterns = [
    new RegExp('(' + MONTH_NAME + ')\\.?\\s*(\\d{1,2})\\s*(?:to|-)\\s*(\\d{1,2}),?\\s*(\\d{4})', 'i'),
    new RegExp('(\\d{1,2})\\s+(' + MONTH_NAME + ')\\.?\\s+(\\d{4})\\s*(?:to|-)\\s*(\\d{1,2})\\s+(' + MONTH_NAME + ')\\.?\\s+(\\d{4})', 'i'),
    new RegExp('(\\d{1,2})\\s+(' + MONTH_NAME + ')\\.?\\s*(?:to|-)\\s*(\\d{1,2})\\s+(' + MONTH_NAME + ')\\.?\\s*,?\\s*(\\d{4})', 'i'),
    new RegExp('(' + MONTH_NAME + ')\\.?\\s*(\\d{1,2})\\s*(?:to|-)\\s*(' + MONTH_NAME + ')\\.?\\s*(\\d{1,2}),?\\s*(\\d{4})', 'i'),
    new RegExp('(\\d{1,2})\\s*(' + MONTH_NAME + ')\\s*-\\s*(\\d{1,2})\\s*(' + MONTH_NAME + ')\\.?\\s*[,.-]?\\s*(\\d{4})', 'i')
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    if (pattern === patterns[0]) {
      return { start: makeDate(match[2], match[1], match[4]), end: makeDate(match[3], match[1], match[4]) };
    }
    if (pattern === patterns[1]) {
      return { start: makeDate(match[1], match[2], match[3]), end: makeDate(match[4], match[5], match[6]) };
    }
    if (pattern === patterns[2]) {
      return { start: makeDate(match[1], match[2], match[5]), end: makeDate(match[3], match[4], match[5]) };
    }
    if (pattern === patterns[3]) {
      return { start: makeDate(match[2], match[1], match[5]), end: makeDate(match[4], match[3], match[5]) };
    }
    return { start: makeDate(match[1], match[2], match[5]), end: makeDate(match[3], match[4], match[5]) };
  }

  const compact = text.match(new RegExp('(?:travel\\s+date|travel\\s+dates|inclusive\\s+date)\\s*[:\\s]+([A-Z]{3,9})\\.?\\s*(\\d{1,2})\\s*-\\s*([A-Z]{3,9})\\.?\\s*(\\d{1,2})\\.?\\s*,?\\s*(\\d{4})', 'i'));
  if (compact) {
    return { start: makeDate(compact[2], compact[1], compact[5]), end: makeDate(compact[4], compact[3], compact[5]) };
  }
  return null;
}

function extractValidity(text) {
  const match = text.match(new RegExp('validity\\s*:\\s*([\\s\\S]{0,120})', 'i'));
  return match ? parseDateRange(match[1]) : null;
}

function moneyMatches(text) {
  return [...String(text || '').matchAll(MONEY)].filter((match) => {
    const after = String(text || '').slice(match.index + match[0].length);
    return !(/^\s+\d/.test(after) && !/[ ,]\d{3}/.test(match[1]));
  }).map((match) => ({
      raw: match[1],
      full: match[0],
      index: match.index
    }));
}

function firstMoneyOnLines(lines, pattern) {
  const offsets = arguments.length >= 3 && arguments[2] ? [0, -1, -2, 1, 2] : [0, 1, 2];
  const preferLast = arguments.length >= 4 && arguments[3];
  let zeroFallback = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!pattern.test(line)) continue;
    for (const offset of offsets) {
      if (index + offset < 0 || index + offset >= lines.length) continue;
      const matches = moneyMatches(lines[index + offset]);
      const match = (preferLast
        ? [...matches].reverse().find((item) => normalizeField('amount', item.raw) !== 0)
        : matches.find((item) => normalizeField('amount', item.raw) !== 0)) || matches[0];
      if (match && normalizeField('amount', match.raw) !== 0) return match.raw;
      if (match && zeroFallback === null) zeroFallback = match.raw;
    }
  }
  return zeroFallback;
}

function extractAmount(lines, text) {
  const labelled = [
    /\bgrand total\b|\btotal amount due\b|\bamount due\b/i,
    /tour fee|selling price|price\s*\/\s*pax|adult\s+\$/i,
    /total\b/i
  ];
  for (const pattern of labelled) {
    const value = firstMoneyOnLines(lines, pattern);
    if (value) return value;
  }
  const early = moneyMatches(text.slice(0, 2500));
  return early.length ? early[0].raw : null;
}

function extractLabeledAmount(lines, pattern) {
  return firstMoneyOnLines(lines, pattern, true, true);
}

function plausibleReference(value) {
  const normalized = String(value || '').trim();
  return normalized.length >= 4 && /[0-9]/.test(normalized) && !/^(client|name|date|number|details)$/i.test(normalized);
}

function extractReference(text, sourceType, documentType) {
  const invoice = firstMatch(text, [
    /invoice\s+(?:number|no\.?|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{3,})/i,
    /invoice\s*[:#-]\s*([A-Z0-9][A-Z0-9-]{3,})/i
  ]);
  if (invoice && plausibleReference(invoice)) return { field: 'invoice_number', value: invoice };

  const references = [
    firstMatch(text, [/ref(?:erence)?\s+(?:no\.?|number|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{3,})/i]),
    firstMatch(text, [/\b(UOS-[A-Z0-9-]{8,})\b/i])
  ].filter((value) => plausibleReference(value));
  if (references.length) {
    return { field: documentType === 'WMIT_INVOICE' ? 'invoice_number' : 'supplier_reference', value: references[0] };
  }
  if (sourceType === 'SUPPLIER') {
    const booking = firstMatch(text, [/\b(BOOKING\s*:\s*[^\n]+)/i]);
    if (booking && /@/.test(booking)) return { field: 'supplier_reference', value: booking.replace(/^BOOKING\s*:\s*/i, '').trim() };
  }
  return null;
}

function extractPassengerCount(text) {
  const explicit = firstMatch(text, [
    /(?:no\.?\s*of\s*pax|number\s+of\s+pax|pax)\s*(?:no\.?)?\s*[:#-]?\s*(\d{1,3})\b/i,
    /\b(\d{1,3})\s+pax\b/i
  ]);
  if (explicit) return { value: explicit, confidence: 0.9 };
  const section = text.match(/passenger([\s\S]{0,5000}?)(?:roundtrip airfare|inclusions|exclusions|flight details)/i);
  if (section) {
    const numbered = section[1].match(/(?:^|\n)\s*\d+\.\s+[A-Z][A-Z .'-]+/gm) || [];
    if (numbered.length >= 2) return { value: numbered.length, confidence: 0.85 };
  }
  return null;
}

function extractPassenger(text) {
  const match = text.match(/passenger([\s\S]{0,5000}?)(?:roundtrip airfare|inclusions|exclusions|flight details)/i);
  if (!match) return null;
  const first = match[1].match(/(?:^|\n)\s*1\.\s*([A-Z][A-Z .'-]+)/i);
  return first ? first[1].trim() : null;
}

function extractFlight(text) {
  const explicit = [];
  const lines = text.split('\n');
  const flightLines = lines.filter((line) => /flight|outbound|inbound|airline/i.test(line));
  const knownCodes = '(?:5J|PR|VJ|CA|KE|OZ|SQ|TG|QR|EK|CX|BR|JL|NH|CI|TK|MH|Z2)';
  const knownMatches = [...text.matchAll(new RegExp('(?<![A-Z0-9-])(' + knownCodes + '\\s*[- ]?\\s*\\d{2,4})(?![A-Z0-9-])', 'gi'))]
    .map((match) => match[1]);
  const explicitMatches = [...flightLines.join('\n').matchAll(/\b((?:[A-Z]{2}|[A-Z]\d|\d[A-Z])\s*[- ]?\s*\d{2,4})\b/gi)]
    .map((match) => match[1]);
  const matches = [...knownMatches, ...explicitMatches]
    .filter((value) => !/^(?:PHP|USD|EUR|JPY|KRW|SGD)\s*\d/i.test(value));
  for (const value of matches) {
    const normalized = normalizeField('flight_number', value);
    if (normalized && !explicit.includes(normalized)) explicit.push(normalized);
  }
  return explicit[0] || null;
}

function extractFlightDates(text) {
  const dates = [];
  const lines = text.split('\n').filter((line) => /\b(?:5J|PR|VJ|CA|KE|OZ|SQ|TG|QR|EK|CX|BR|JL|NH|CI|TK|MH|Z2)\b/i.test(line));
  const pattern = new RegExp('(\\d{1,2})\\s+(' + MONTH_NAME + ')\\.?\\s+(\\d{4})', 'ig');
  for (const line of lines) {
    for (const match of line.matchAll(pattern)) {
      const date = makeDate(match[1], match[2], match[3]);
      if (date && !dates.includes(date)) dates.push(date);
    }
  }
  return dates;
}

function sectionValue(lines, heading, stopHeadings) {
  const index = lines.findIndex((line) => heading.test(line));
  if (index < 0) return null;
  const first = lines[index].replace(heading, '').replace(/^[:\-\s]+/, '').trim();
  const collected = first ? [first] : [];
  for (let i = index + 1; i < lines.length && collected.length < 8; i += 1) {
    if (stopHeadings.some((stop) => stop.test(lines[i]))) break;
    collected.push(lines[i]);
  }
  return collected.join(' ').trim() || null;
}

function extractTextDocument(input) {
  const value = input || {};
  const text = String(value.text || '').replace(/\r/g, '');
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const joined = lines.join('\n');
  const classification = classifyDocument({
    fileName: value.fileName,
    text,
    sourceHint: value.sourceHint
  });
  const result = createExtractionResult({
    document_id: value.documentId || null,
    document_type: classification.documentType,
    source_type: classification.sourceType
  });
  result.classification_confidence = classification.confidence;
  result.classification_evidence = classification.evidence;
  result.competing_classifications = classification.competingClassifications;
  result.warnings.push(...classification.warnings);

  if (!text.trim()) return finalizeExtractionResult(result, { failed: true });

  let dateRange = parseDateRange(joined);
  if (!dateRange) {
    const flightDates = extractFlightDates(joined);
    if (flightDates.length >= 2) dateRange = { start: flightDates[0], end: flightDates[1] };
  }
  const validity = extractValidity(joined);
  if (dateRange && dateRange.start) addField(result, 'travel_start', dateRange.start, 0.86);
  if (dateRange && dateRange.end) addField(result, 'travel_end', dateRange.end, 0.86);
  if (validity && validity.start) addField(result, 'validity_start', validity.start, 0.9);
  if (validity && validity.end) addField(result, 'validity_end', validity.end, 0.9);

  const pax = extractPassengerCount(joined);
  if (pax) addField(result, 'pax_count', pax.value, pax.confidence);
  const passenger = extractPassenger(joined);
  if (passenger) addField(result, 'passenger', passenger, 0.8);

  const client = firstMatch(joined, [
    /lead\s+pax\s+([A-Z][A-Za-z .'-]{2,}?)(?=\s+ref(?:erence)?\s+no\b|\s+invoice(?:\s+number)?\b|$)/i,
    /(?:lead\s+name|client\s+name)\s*[:\-]?\s*([A-Z][A-Za-z .'-]{2,}?)(?=\s+invoice(?:\s+number)?\b|\s+due\s+date\b|$)/i,
    /dear\s+(?:mr\.?|ms\.?|mrs\.?)?\s*([A-Z][A-Za-z .'-]{2,})(?:,|\n)/i
  ]);
  if (client) addField(result, 'client', client.trim(), 0.82);

  const supplier = classification.sourceType === 'SUPPLIER'
    ? firstMatch(joined, [
      /supplier\s*:\s*([^\n]+)/i,
      /booking\s*:\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+)/i,
      /account\s+name\s*:\s*([^\n]+)/i
    ])
    : null;
  if (supplier) addField(result, 'supplier', supplier.trim(), 0.86);

  const currency = firstMatch(joined, [/\b(PHP|USD|EUR|JPY|KRW|SGD)\b/i, /(\u20b1|\$)/]);
  if (currency) addField(result, 'currency', currency, 0.9);

  const amount = classification.documentType.startsWith('TOUR_OPERATOR')
    && !/\b(?:total amount due|grand total|package rate|tour fee)\b/i.test(joined)
    ? null
    : extractAmount(lines, joined);
  if (amount) addField(result, 'amount', amount, 0.78);
  const deposit = extractLabeledAmount(lines, /deposit required|deposit\b/i);
  if (deposit) addField(result, 'deposit', deposit, 0.78);
  const balance = extractLabeledAmount(lines, /final payment|remaining balance|balance due/i);
  if (balance) addField(result, 'balance', balance, 0.78);

  const reference = extractReference(joined, classification.sourceType, classification.documentType);
  if (reference) addField(result, reference.field, reference.value, 0.86);

  const flight = extractFlight(joined);
  if (flight) addField(result, 'flight_number', flight, 0.8);

  const hotel = firstMatch(joined, [
    /hotel\s+name\s*[:\-]?\s*([^\n]+)/i,
    /(?:hotel|accommodation)s?\s*:\s*([^\n]+)/i,
    /^\s*\d+\s+([A-Z][A-Z0-9 &'.,-]*\bHOTEL\b)/im
  ]);
  if (hotel) addField(result, 'hotel_name', hotel.trim(), 0.78);

  const rooming = firstMatch(joined, [/(?:rooming|room type|share type|occupants?)\s*[:\-]\s*([^\n]+)/i]);
  if (rooming) addField(result, 'rooming', rooming.trim(), 0.68, ['Rooming is service-specific and requires review.']);
  const roomNumber = firstMatch(joined, [/(?:room number|room no\.?)\s*[:\-]\s*([A-Za-z0-9-]+)/i]);
  if (roomNumber) addField(result, 'room_number', roomNumber, 0.75);
  const occupancy = firstMatch(joined, [/(?:occupancy|occupants?)\s*[:\-]?\s*(\d{1,2})/i]);
  if (occupancy) addField(result, 'occupancy_count', occupancy, 0.75);

  const destination = firstMatch(joined, [
    /(?:destination|tour destination|travel to)\s*[:\-]\s*([^\n]+)/i,
    /^\s*\d+\s*days?\s+([A-Z][A-Z ]+?)(?:\s+package|\s*$)/im,
    /\b(?:da nang|south korea|vietnam|zambales|bali|chengdu|jiuzhaigou)\b/i
  ]);
  if (destination) addField(result, 'destination', destination.trim(), 0.76);

  const packageName = firstMatch(joined, [
    /tour\s+name\s*[:\-]?\s*([^\n]+)/i,
    /^([A-Z][^\n]*\b\d+D\d+\s+Package)/im,
    /package\s*:\s*([^\n]+)/i,
    /^\s*\d+\s*days?(?:\s*\/\s*\d+\s*nights?)?\s+([^\n]+)/im,
    /^\s*\d+\s*days?\s+[A-Z][^\n]+/im,
    /^([A-Z][^\n]*\b\d+D\d+\s+Package)\s*$/im
  ]);
  if (packageName) addField(result, 'package', packageName.trim(), 0.78);

  const duration = firstMatch(joined, [
    /(?:duration|length|number of days)\s*[:\-]\s*([^\n]+)/i,
    /\b(\d+\s*D\d+\s*N)\b/i
  ]);
  if (duration) addField(result, 'duration', duration.trim(), 0.78);

  const contact = firstMatch(joined, [/(?:contact person|guide info|guide|emergency contact)\s*[:\-]?\s*([^\n]+)/i]);
  if (contact) addField(result, 'contact_name', contact.trim(), 0.78);
  const email = firstMatch(joined, [/\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i]);
  if (email) addField(result, 'email', email, 0.95);
  const phone = firstMatch(joined, [/(?:phone|tel|mobile|contact number)\s*[:\-]?\s*([+()0-9][+()0-9 .-]{5,})/i]);
  if (phone) addField(result, 'phone', phone, 0.8);

  const inclusions = sectionValue(lines, /^(?:inclusions?|included)\s*:?\s*$/i, [/^exclusions?/i, /^please note/i, /^payment terms?/i]);
  if (inclusions) addField(result, 'inclusions', inclusions, 0.68);
  const exclusions = sectionValue(lines, /^(?:exclusions?|not included)\s*:?\s*$/i, [/^please note/i, /^payment terms?/i, /^sincerely/i]);
  if (exclusions) addField(result, 'exclusions', exclusions, 0.68);
  const paymentTerms = sectionValue(lines, /^(?:payment terms?|deposit|balance|final payment)\s*:?\s*$/i, [/^grand total/i, /^bank details/i, /^sincerely/i]);
  if (paymentTerms) addField(result, 'payment_terms', paymentTerms, 0.7);
  const validityText = firstMatch(joined, [/(validity\s*:\s*[^\n]+)/i, /(valid for\s+\d+\s+hours)/i]);
  if (validityText) addField(result, 'validity', validityText, 0.72);
  const mealPlan = firstMatch(joined, [
    /(?:meal plan|meals?)\s*:\s*([^\n]+)/i,
    /meal&hotel[\s\S]{0,220}?\b([BXLDA](?:\/[BXLDA]){1,2})\b/i
  ]);
  if (mealPlan) addField(result, 'meal_plan', mealPlan.trim(), 0.7);
  const optionalServices = firstMatch(joined, [/(?:optional services?|optional tours?)\s*:?\s*([^\n]+)/i]);
  if (optionalServices) addField(result, 'optional_services', optionalServices.trim(), 0.68);
  const activity = firstMatch(joined, [/^\s*(day\s*\d+\b[^\n]*)/im, /^\s*(day\d+\b[^\n]*)/im, /^\s*(itinerary\s*:?[^\n]*)/im]);
  if (activity) addField(result, 'activity', activity.trim(), 0.65);

  return finalizeExtractionResult(result, {
    requiredFields: value.requiredFields || [],
    autoAcceptThreshold: 0.9
  });
}

module.exports = { extractTextDocument, addField, parseDateRange, extractFlight, extractFlightDates };
