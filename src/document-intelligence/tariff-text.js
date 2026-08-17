'use strict';

// Generic pasted-text tariff parser.
//
// Input: plain text extracted anywhere (PDF tool, OCR site, e-mail body).
// The parser derives the column model FROM THE DOCUMENT'S OWN HEADER —
// any number of duration bands (3D2N, "3 DAYS & 2 NIGHTS", EXTRA 1 NIGHT)
// crossed with any occupancy columns (SGL/TWN/TRP/DBL/…, including
// combined "TWN/TRP"). No supplier-specific layout is assumed. Hotel rows
// are recognized by their trailing numeric run; OCR-split digits are
// repaired by merging until the count matches the header's column count.
// Every emitted rate is review-gated; lines that do not resolve are
// reported as warnings for manual entry.

const { toMinorUnits, fromMinorUnits } = require('../core/money');

const OCCUPANCY_MAP = { SGL: 'SGL', SINGLE: 'SGL', TWN: 'TWN', TWIN: 'TWN', DBL: 'DBL', DOUBLE: 'DBL', TRP: 'TRP', TRIPLE: 'TRP', QUAD: 'QUAD', QUADRUPLE: 'QUAD' };
const REGION_LIST = ['SUKHUMVIT AREA', 'SATHORN AREA', 'SILOM AREA', 'KHAOSAN AREA', 'PRATUNAM AREA', 'CHIANG MAI', 'PATTAYA', 'PHUKET', 'KRABI', 'SAMUI'];
const REGION_DESTINATIONS = { 'SUKHUMVIT AREA': 'Bangkok', 'SATHORN AREA': 'Bangkok', 'SILOM AREA': 'Bangkok', 'KHAOSAN AREA': 'Bangkok', 'PRATUNAM AREA': 'Bangkok', 'CHIANG MAI': 'Chiang Mai', PATTAYA: 'Pattaya', PHUKET: 'Phuket', KRABI: 'Krabi', SAMUI: 'Samui' };
const ROOM_TYPE_KEYWORDS = ['PRIME PREMIER', 'AQUA SEAVIEW', 'JUNIOR SUITE', 'JUNIORSUITE', 'DLX CLASSIC', 'DLX ONLY', 'MOOD S', 'BEACH DLX', 'FIRSTROOM', 'PREMIER', 'CLASSIC', 'PRAROP', 'MOOD', 'DELUXE', 'SUPERIOR', 'STUDIO', 'STANDARD', 'EXECUTIVE', 'FAMILY', 'SUITE', 'DLX', 'SUP', 'STD', 'PLUS'];
const MONTHS = { JAN: 1, JANUARY: 1, FEB: 2, FEBRUARY: 2, MAR: 3, MARCH: 3, APR: 4, APRIL: 4, MAY: 5, JUN: 6, JUNE: 6, JUL: 7, JULY: 7, AUG: 8, AUGUST: 8, SEP: 9, SEPT: 9, SEPTEMBER: 9, OCT: 10, OCTOBER: 10, NOV: 11, NOVEMBER: 11, DEC: 12, DECEMBER: 12 };
const MONTH_WORD = Object.keys(MONTHS).join('|');

function moneyString(value) {
  try { return fromMinorUnits(toMinorUnits(value)); } catch (_) { return String(value); }
}

function parseOccupancyToken(token) {
  const raw = String(token || '').trim().toUpperCase().replace(/[.,;:]$/, '');
  const single = OCCUPANCY_MAP[raw];
  if (single) return { codes: [single] };
  const parts = raw.split('/').map((part) => part.trim());
  if (parts.length >= 2 && parts.every((part) => OCCUPANCY_MAP[part])) {
    return { codes: parts.map((part) => OCCUPANCY_MAP[part]) };
  }
  return null;
}

function parseDurationPhrase(text, position) {
  // "3D2N" / "3 DAYS & 2 NIGHTS" / "2 NIGHTS" / "EXTRA 1 NIGHT"
  const compact = /^\b(\d{1,2})D(\d{1,2})N\b/i.exec(text.slice(position));
  if (compact) return { length: compact[0].length, duration: compact[1] + 'D' + compact[2] + 'N', duration_days: Number(compact[1]), nights: Number(compact[2]), extra: false };
  const extra = /^EXTRA\s+1\s+NIGHT/i.exec(text.slice(position));
  if (extra) return { length: extra[0].length, duration: 'EXTRA-1N', duration_days: 1, nights: 1, extra: true };
  const spelled = /^(\d{1,2})\s*DAYS?\s*(?:&|AND|-|TO)?\s*(\d{1,2})\s*NIGHTS?/i.exec(text.slice(position));
  if (spelled) return { length: spelled[0].length, duration: spelled[1] + 'D' + spelled[2] + 'N', duration_days: Number(spelled[1]), nights: Number(spelled[2]), extra: false };
  const nightsOnly = /^(\d{1,2})\s*NIGHTS?/i.exec(text.slice(position));
  if (nightsOnly) {
    const nights = Number(nightsOnly[1]);
    return { length: nightsOnly[0].length, duration: (nights + 1) + 'D' + nights + 'N', duration_days: nights + 1, nights, extra: false };
  }
  return null;
}

// Scans a header line into the ordered run of duration phrases and
// occupancy tokens, remembering whether they interleave.
function scanHeader(line) {
  const text = line.replace(/\s+/g, ' ').trim();
  const events = [];
  let index = 0;
  while (index < text.length) {
    const rest = text.slice(index);
    const duration = parseDurationPhrase(text, index);
    if (duration) {
      events.push({ type: 'duration', value: duration });
      index += duration.length;
      continue;
    }
    const word = /^\S+/.exec(rest);
    if (word) {
      const occupancy = parseOccupancyToken(word[0]);
      if (occupancy) events.push({ type: 'occupancy', value: occupancy });
      index += word[0].length;
      continue;
    }
    index += 1;
  }
  const durations = events.filter((event) => event.type === 'duration').map((event) => event.value);
  const occupancies = events.filter((event) => event.type === 'occupancy').map((event) => event.value);
  let interleaved = false;
  let seenOccupancy = false;
  for (const event of events) {
    if (event.type === 'occupancy') seenOccupancy = true;
    if (event.type === 'duration' && seenOccupancy) { interleaved = true; break; }
  }
  return { durations, occupancies, interleaved, events };
}

// Builds the column model. Sequential mode when durations interleave with
// occupancy tokens; grouped/cyclic mode when all durations come first
// (e.g. "3D2N 4D3N EXTRA 1 NIGHT ... SGL TWN/TRP SGL TWN/TRP SGL TWN/TRP")
// and the occupancy pattern repeats once per duration band.
function buildColumns(durations, occupancies, interleaved, events) {
  const columns = [];
  if (interleaved) {
    // Durations and occupancies alternate: each duration applies to the
    // occupancy tokens that follow it until the next duration.
    let current = null;
    (events || []).forEach((event) => {
      if (event.type === 'duration') current = event.value;
      if (event.type === 'occupancy') columns.push({ occupancy: event.value.codes, duration: current });
    });
    return columns.length >= 2 ? { columns, mode: 'sequential' } : { columns: null, mode: 'unmatched' };
  }
  const groupSize = occupancies.length;
  const bands = durations.length;
  if (!bands) {
    occupancies.forEach((occupancy) => columns.push({ occupancy: occupancy.codes }));
    return { columns, mode: 'occupancies-only' };
  }
  if (groupSize === 0 || groupSize % bands !== 0) {
    return { columns: null, mode: 'unmatched' };
  }
  const perBand = groupSize / bands;
  const repeats = occupancies.every((occupancy, index) => occupancy.codes.join('/') === occupancies[index % perBand].codes.join('/'));
  if (!repeats) return { columns: null, mode: 'unmatched' };
  for (let band = 0; band < bands; band += 1) {
    for (let slot = 0; slot < perBand; slot += 1) {
      columns.push({ occupancy: occupancies[band * perBand + slot].codes, duration: durations[band] });
    }
  }
  return { columns, mode: 'cyclic' };
}

function isNumericToken(token) {
  return /^\d+([.,]\d+)?(\/\d+([.,]\d+)?)?$/.test(token);
}

// Trailing numeric run with OCR repair toward the expected column count.
function extractValues(line, expected) {
  const tokens = line.split(' ');
  let start = tokens.length;
  while (start > 0 && isNumericToken(tokens[start - 1])) start -= 1;
  if (start === tokens.length) return null;
  let values = tokens.slice(start).map((token) => token.replace(/,/g, ''));
  const label = tokens.slice(0, start).join(' ').trim();
  let repaired = false;

  // Slash fragments: "98/13" followed by a short pure digit "8" → "98/138".
  const joined = [];
  for (let i = 0; i < values.length; i += 1) {
    if (i + 1 < values.length && /^\d+\/\d+$/.test(values[i]) && /^\d{1,2}$/.test(values[i + 1])) {
      joined.push(values[i] + values[i + 1]);
      repaired = true;
      i += 1;
    } else {
      joined.push(values[i]);
    }
  }
  values = joined;

  // Merge adjacent digit tokens while above the expected count.
  let guard = 0;
  while (values.length > expected && guard < 40) {
    guard += 1;
    let merged = false;
    for (let i = 0; i < values.length - 1; i += 1) {
      if (/^\d+$/.test(values[i]) && /^\d+$/.test(values[i + 1]) && (values[i] + values[i + 1]).length <= 4) {
        values[i] = values[i] + values[i + 1];
        values.splice(i + 1, 1);
        repaired = true;
        merged = true;
        break;
      }
    }
    if (!merged) break;
  }
  if (values.length !== expected || values.some((value) => !/^\d+(\.\d+)?(\/\d+(\.\d+)?)?$/.test(value))) {
    return { label, values: null, repaired };
  }
  return { label, values, repaired };
}

function splitLabel(label) {
  const padded = ' ' + label.trim() + ' ';
  const upper = padded.toUpperCase();
  let bestIndex = -1;
  let bestLength = 0;
  ROOM_TYPE_KEYWORDS.forEach((keyword) => {
    const pattern = new RegExp('\\s(' + keyword.replace(/\s+/g, '\\s+') + ')\\s', 'i');
    const match = upper.match(pattern);
    if (match) {
      // Prefer the LAST occurrence: hotel names may contain a room word
      // ("EMPRESS PREMIER CHIANG MAI ... PREMIER") and the room type is
      // the trailing token run.
      const index = upper.lastIndexOf(match[1]);
      if (keyword.length >= bestLength) {
        bestIndex = index;
        bestLength = keyword.length;
      }
    }
  });
  if (bestIndex < 0) return { hotel: label.trim(), roomType: null };
  return { hotel: padded.slice(1, bestIndex).trim(), roomType: padded.slice(bestIndex, -1).trim() };
}

function stripRegion(line) {
  const upper = line.toUpperCase();
  for (const region of REGION_LIST) {
    if (upper.startsWith(region + ' ')) {
      return { region, rest: line.slice(region.length).trim() };
    }
  }
  return { region: null, rest: line };
}

function parseValidity(text) {
  const match = String(text || '').toUpperCase().match(new RegExp('(\\d{1,2})\\s*(?:ST|ND|RD|TH)?\\s+(' + MONTH_WORD + ')\\s+.{0,8}?TO\\s+(\\d{1,2})\\s*(?:ST|ND|RD|TH)?\\s+(' + MONTH_WORD + ')\\s+(\\d{4})'));
  if (!match) return null;
  const startMonth = MONTHS[match[2]];
  const endMonth = MONTHS[match[4]];
  if (!startMonth || !endMonth) return null;
  return {
    start: match[5] + '-' + String(startMonth).padStart(2, '0') + '-' + match[1].padStart(2, '0'),
    end: match[5] + '-' + String(endMonth).padStart(2, '0') + '-' + match[3].padStart(2, '0')
  };
}

function looksLikeTariffMatrixText(text) {
  const headerish = String(text || '').split('\n').some((line) => {
    const { durations, occupancies } = scanHeader(line);
    return occupancies.length >= 2 || (durations.length >= 1 && occupancies.length >= 1);
  });
  return headerish;
}

function parsePastedTariffText(rawText, options) {
  const opts = options || {};
  const text = String(rawText || '').replace(/\r/g, '');
  const lines = text.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const warnings = [];
  const rateRows = [];
  const hotels = new Set();
  const regions = new Set();
  const validity = parseValidity(text);

  // 1) Locate the header line and build the column model. A durations-only
  // line directly above an occupancy-only line is a stacked header — merge.
  let columns = null;
  let headerIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const scan = scanHeader(lines[i]);
    let durations = scan.durations;
    let headerLineIndex = i;
    if (scan.occupancies.length >= 2 && durations.length === 0 && i > 0) {
      for (let back = i - 1; back >= Math.max(0, i - 3); back -= 1) {
        const above = scanHeader(lines[back]);
        if (above.durations.length >= 1 && above.occupancies.length === 0) {
          durations = above.durations;
          headerLineIndex = back;
          break;
        }
      }
    }
    if (scan.occupancies.length >= 2 || (scan.occupancies.length >= 1 && durations.length >= 1)) {
      const model = buildColumns(durations, scan.occupancies, scan.interleaved, scan.events);
      if (model.columns && model.columns.length >= 2) {
        columns = model.columns;
        headerIndex = headerLineIndex;
        break;
      }
    }
  }
  if (!columns) {
    warnings.push('No rate-table header (occupancy/duration columns) was found in the pasted text; falling back to unstructured extraction.');
    return { rateRows, hotels: [], regions: [], validity, warnings, columns: null };
  }

  // 2) Walk the lines after the header. A recognized region prefix is
  // remembered and stripped; it applies until the next one appears.
  let currentRegion = null;
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const stripped = stripRegion(lines[i]);
    if (stripped.region) {
      currentRegion = stripped.region;
      regions.add(stripped.region);
    }
    const working = (stripped.region ? stripped.rest : lines[i]).trim();
    if (!working) continue; // pure region heading
    const extracted = extractValues(working, columns.length);
    if (!extracted || !extracted.values) {
      if (extracted && extracted.label && extracted.label.split(' ').length >= 2) {
        // Numeric tail existed but did not resolve — keep for manual entry.
        if (/^\d/.test(working.split(' ').pop())) warnings.push('Unresolved numeric line kept for manual entry: "' + working.slice(0, 90) + '"');
      }
      continue;
    }
    const { hotel, roomType } = splitLabel(extracted.label);
    if (!hotel || hotel.length < 3) continue;
    const noTrp = /NO\s+TRP/i.test((roomType || '') + ' ' + hotel);
    hotels.add(hotel);
    const destination = currentRegion ? REGION_DESTINATIONS[currentRegion] || null : null;

    extracted.values.forEach((value, index) => {
      const column = columns[index];
      const baseConditions = {
        hotel,
        room_type: roomType || undefined,
        duration: column.duration ? column.duration.duration : undefined,
        duration_days: column.duration ? column.duration.duration_days : undefined,
        nights: column.duration ? column.duration.nights : undefined
      };
      if (destination) baseConditions.destination = destination;
      if (currentRegion) baseConditions.region = currentRegion;
      if (validity) {
        baseConditions.travel_date_start = validity.start;
        baseConditions.travel_date_end = validity.end;
      }
      const rowWarnings = [];
      if (extracted.repaired) rowWarnings.push('OCR-split digits were joined automatically — verify this amount against the document.');
      const codes = column.occupancy;
      const isCombinedColumn = codes.length > 1;
      const push = (amount, arrangement, ambiguous) => {
        rateRows.push({
          amount: moneyString(amount),
          conditions: Object.assign({}, baseConditions, { room_arrangement: arrangement }),
          source_wording: value,
          warnings: rowWarnings.slice(),
          ambiguous: Boolean(ambiguous),
          provenance: { method: 'PASTED_TEXT_ROW', row: rateRows.length + 1 }
        });
      };
      if (!isCombinedColumn) {
        push(value, codes[0], false);
      } else if (value.includes('/')) {
        const parts = value.split('/');
        codes.forEach((code, codeIndex) => {
          const amount = parts[codeIndex] || parts[parts.length - 1];
          const warn = codeIndex === 2 && noTrp;
          push(amount, code, Boolean(warn));
          if (warn) rateRows[rateRows.length - 1].warnings.push('Room notes say NO TRP; this triple rate is retained for review only.');
        });
      } else {
        push(value, codes.join('/'), true);
        rateRows[rateRows.length - 1].warnings.push('One price covers ' + codes.join('/') + '; confirm whether it applies to both arrangements.');
      }
    });
  }

  if (!rateRows.length) warnings.push('A table header was found but no hotel rows resolved; add rates manually during review.');
  return {
    supplier_name: opts.supplierName || null,
    validity,
    rateRows,
    hotels: [...hotels],
    regions: [...regions],
    warnings,
    columns: columns.map((column) => ({
      occupancy: column.occupancy.join('/'),
      duration: column.duration ? column.duration.duration : null
    }))
  };
}

module.exports = { parsePastedTariffText, looksLikeTariffMatrixText, extractValues, scanHeader, buildColumns };
