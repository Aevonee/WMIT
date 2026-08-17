'use strict';

// Generic supplier tariff rate-matrix parser.
//
// Turns extracted PDF tables into one candidate rate component per money
// cell: row labels become hotel / room type conditions, column headers
// become duration (3D2N) and/or occupancy (SGL/TWN/…) conditions. Handles
// transposed tables (durations listed vertically). Every emitted rate keeps
// its cell provenance and requires explicit staff review — nothing here is
// trusted automatically.

const DURATION_PATTERN = /^(?:(\d{1,2})\s*(?:D|days?)\s*[/ ]?\s*(?:(\d{1,2})\s*(?:N|nights?))?|(\d{1,2})\s*(?:N|nights?))$/i;
const OCCUPANCY_MAP = { SGL: 'SGL', SINGLE: 'SGL', TWIN: 'TWN', TWN: 'TWN', DOUBLE: 'DBL', DBL: 'DBL', TRIPLE: 'TRP', TRP: 'TRP', QUAD: 'QUAD', QUADRUPLE: 'QUAD' };
const OCCUPANCY_PATTERN = /^(sgl|single|twn|twin|dbl|double|trp|triple|quad|quadruple)$/i;
const MONEY_TOKEN = /(?:PHP|USD|EUR|JPY|KRW|SGD|₱|\$)?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?|[0-9]{3,6}(?:\.[0-9]{1,2})?)/;
const LABEL_STOP = /^(hotel|room|rate|price|pax|period|validity|package|tour)\b/i;

function parseDurationHeader(text) {
  const raw = String(text || '').trim();
  const match = raw.match(DURATION_PATTERN);
  if (!match) return null;
  if (match[1]) {
    const days = Number(match[1]);
    const nights = match[2] ? Number(match[2]) : days - 1;
    if (days < 1 || days > 30 || nights < 0 || nights > 30) return null;
    return { duration: days + 'D' + nights + 'N', duration_days: days, nights };
  }
  const nightsOnly = Number(match[3]);
  if (nightsOnly < 1 || nightsOnly > 30) return null;
  return { duration: (nightsOnly + 1) + 'D' + nightsOnly + 'N', duration_days: nightsOnly + 1, nights: nightsOnly };
}

function parseOccupancyHeader(text) {
  const raw = String(text || '').trim();
  const match = raw.match(OCCUPANCY_PATTERN);
  return match ? OCCUPANCY_MAP[match[1].toUpperCase()] : null;
}

// Combined headers like "TWN/TRP" (one price covering two arrangements).
// Returns the canonical codes, e.g. ['TWN','TRP'], or null.
function parseOccupancyListHeader(text) {
  const parts = String(text || '').trim().split('/').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const codes = parts.map((part) => OCCUPANCY_MAP[part.toUpperCase()] || null);
  if (codes.some((code) => !code)) return null;
  return codes;
}

function parseMoneyCell(text) {
  const raw = String(text || '');
  const matches = [...raw.matchAll(new RegExp(MONEY_TOKEN.source, 'g'))]
    .map((match) => match[1])
    .filter((value) => {
      const digits = value.replace(/[,.]/g, '');
      // Reject things that look like years or durations, not amounts.
      return !(Number(digits) >= 1900 && Number(digits) <= 2099 && digits.length === 4);
    });
  if (!matches.length) return null;
  return { amount: matches[0].replace(/,/g, ''), multiple: matches.length > 1, raw: raw.trim() };
}

function isHeaderishRow(cells) {
  // A header row carries labels (durations, occupancies, column titles) and
  // never money amounts.
  if (cells.some((cell) => parseMoneyCell(cell))) return false;
  const durations = cells.filter((cell) => parseDurationHeader(cell)).length;
  const occupancies = cells.filter((cell) => parseOccupancyHeader(cell) || parseOccupancyListHeader(cell)).length;
  const hasMetaLabel = cells.some((cell) => LABEL_STOP.test(String(cell || '').trim()));
  return durations >= 2 || occupancies >= 2 || (durations >= 1 && occupancies >= 1) || (durations >= 1 && hasMetaLabel);
}

function columnDescriptors(headerCells) {
  return headerCells.map((cell) => {
    const duration = parseDurationHeader(cell);
    const occupancy = parseOccupancyHeader(cell);
    const occupancies = !occupancy ? parseOccupancyListHeader(cell) : null;
    return {
      duration,
      occupancy,
      occupancies,
      raw: String(cell || '').trim(),
      isMeta: Boolean(duration || occupancy || occupancies) || LABEL_STOP.test(String(cell || '').trim())
    };
  });
}

function transpose(rows) {
  const width = Math.max(...rows.map((row) => row.length));
  const out = [];
  for (let column = 0; column < width; column += 1) {
    out.push(rows.map((row) => row[column] !== undefined ? row[column] : null));
  }
  return out;
}

// Parses one table into { rateRows, meta } where rateRows are plain objects
// ready for the adapter to shape into tariff rate components.
function parseTable(table) {
  const rows = (table.rows || []).map((row) => (row || []).map((cell) => (cell === null || cell === undefined ? '' : String(cell))));
  let grid = rows.filter((row) => row.some((cell) => cell !== ''));
  if (grid.length < 2) return { rateRows: [], meta: { reason: 'TOO_FEW_ROWS' } };

  // Detect transposed layouts: durations/occupancies stacked in column 0.
  const firstColumn = grid.map((row) => row[0]);
  const verticalHeaderScore = firstColumn.filter((cell) => parseDurationHeader(cell) || parseOccupancyHeader(cell)).length;
  const horizontalHeaderIndex = grid.findIndex((row) => isHeaderishRow(row));
  if (verticalHeaderScore >= 2 && horizontalHeaderIndex < 1) {
    grid = transpose(grid);
  }

  const headerIndex = grid.findIndex((row) => isHeaderishRow(row));
  if (headerIndex < 0) return { rateRows: [], meta: { reason: 'NO_HEADER' } };

  // Column layout: leading label columns (up to 2) + rate columns whose
  // headers are durations/occupancies/plain labels.
  const headerCells = grid[headerIndex].map((cell) => String(cell || ''));
  const columns = columnDescriptors(headerCells);
  const firstRateColumn = columns.findIndex((column, index) => column.duration || column.occupancy);
  if (firstRateColumn < 0) {
    // No duration/occupancy headers: treat all columns after the first as
    // rate columns keyed by their raw header text.
    return parseLabeledGrid(grid, headerIndex, columns);
  }
  const labelSpan = Math.max(1, firstRateColumn);

  const rateRows = [];
  const hotels = new Set();
  const roomTypes = new Set();
  const durations = new Set();
  const occupancies = new Set();
  let lastHotel = null;
  for (let rowIndex = headerIndex + 1; rowIndex < grid.length; rowIndex += 1) {
    const row = grid[rowIndex];
    const labelParts = [];
    let rowArrangement = null;
    for (let column = 0; column < labelSpan && column < row.length; column += 1) {
      const cell = String(row[column] || '').trim();
      if (!cell || parseMoneyCell(cell)) continue;
      // An occupancy label (SGL/TWN/TRP/…) in the label columns means the
      // row prices that arrangement — common when hotels list one row per
      // occupancy instead of one column. Combined labels like "TWN/TRP"
      // price two arrangements with one number and stay flagged for review.
      const occupancyCode = parseOccupancyHeader(cell);
      const occupancyList = occupancyCode ? null : parseOccupancyListHeader(cell);
      if (occupancyCode && cell.split(/\s+/).length <= 2) {
        rowArrangement = occupancyCode;
        occupancies.add(occupancyCode);
        continue;
      }
      if (occupancyList) {
        rowArrangement = occupancyList.join('/');
        occupancyList.forEach((code) => occupancies.add(code));
        continue;
      }
      labelParts.push(cell);
    }
    if (!labelParts.length && !rowArrangement) continue; // continuation/total rows are skipped
    const hotel = labelParts[0] || lastHotel; // occupancy-only rows inherit the hotel above
    if (!hotel) continue;
    if (LABEL_STOP.test(hotel) && labelParts.length <= 1) continue; // repeated header noise
    lastHotel = hotel;
    const roomType = labelParts.slice(1).join(' · ') || null;
    hotels.add(hotel);
    if (roomType) roomTypes.add(roomType);
    for (let column = labelSpan; column < row.length && column < columns.length; column += 1) {
      const money = parseMoneyCell(row[column]);
      if (!money) continue;
      const descriptor = columns[column];
      const conditions = { hotel };
      if (roomType) conditions.room_type = roomType;
      if (descriptor.duration) {
        conditions.duration = descriptor.duration.duration;
        conditions.duration_days = descriptor.duration.duration_days;
        conditions.nights = descriptor.duration.nights;
        durations.add(descriptor.duration.duration);
      } else if (descriptor.raw && !descriptor.isMeta) {
        conditions.column = descriptor.raw;
      }
      if (descriptor.occupancy) {
        conditions.room_arrangement = descriptor.occupancy;
        occupancies.add(descriptor.occupancy);
      } else if (descriptor.occupancies) {
        // Combined column (e.g. TWN/TRP): one price, two arrangements —
        // keep the raw combination and flag it for staff to resolve.
        conditions.room_arrangement = descriptor.occupancies.join('/');
        descriptor.occupancies.forEach((code) => occupancies.add(code));
      }
      if (rowArrangement) {
        if (conditions.room_arrangement && conditions.room_arrangement !== rowArrangement) {
          conditions.column_arrangement = conditions.room_arrangement;
        }
        conditions.room_arrangement = rowArrangement;
      }
      rateRows.push({
        amount: money.amount,
        conditions,
        source_wording: money.raw,
        ambiguous: money.multiple || Boolean(descriptor.occupancies) || undefined,
        provenance: { page: table.page, table: table.table, row: rowIndex + 1, cell: column + 1, page_status: 'TABLE_CELL' }
      });
    }
  }
  return {
    rateRows,
    meta: {
      hotels: [...hotels],
      room_types: [...roomTypes],
      durations: [...durations],
      occupancies: [...occupancies]
    }
  };
}

// Fallback for tables whose headers carry no duration/occupancy tokens:
// rate columns are keyed by whatever the header says (e.g. months, seasons).
function parseLabeledGrid(grid, headerIndex, columns) {
  const rateRows = [];
  const hotels = new Set();
  for (let rowIndex = headerIndex + 1; rowIndex < grid.length; rowIndex += 1) {
    const row = grid[rowIndex];
    const label = String(row[0] || '').trim();
    if (!label || parseMoneyCell(label)) continue;
    if (LABEL_STOP.test(label)) continue;
    hotels.add(label);
    for (let column = 1; column < row.length && column < columns.length; column += 1) {
      const money = parseMoneyCell(row[column]);
      if (!money) continue;
      rateRows.push({
        amount: money.amount,
        conditions: Object.assign({ hotel: label }, columns[column].raw ? { column: columns[column].raw } : {}),
        source_wording: money.raw,
        ambiguous: money.multiple,
        provenance: { page: null, table: null, row: rowIndex + 1, cell: column + 1, page_status: 'TABLE_CELL' }
      });
    }
  }
  return { rateRows, meta: { hotels: [...hotels], room_types: [], durations: [], occupancies: [] } };
}

function parseTariffTables(tables) {
  const all = { rateRows: [], hotels: new Set(), room_types: new Set(), durations: new Set(), occupancies: new Set(), tablesConsidered: 0, tablesParsed: 0 };
  (tables || []).forEach((table) => {
    const width = Math.max(...((table.rows || []).map((row) => (row || []).length)));
    if ((table.rows || []).length < 2 || width < 2) return; // not a grid
    all.tablesConsidered += 1;
    const parsed = parseTable(table);
    if (!parsed.rateRows.length) return;
    all.tablesParsed += 1;
    all.rateRows.push(...parsed.rateRows);
    (parsed.meta.hotels || []).forEach((value) => all.hotels.add(value));
    (parsed.meta.room_types || []).forEach((value) => all.room_types.add(value));
    (parsed.meta.durations || []).forEach((value) => all.durations.add(value));
    (parsed.meta.occupancies || []).forEach((value) => all.occupancies.add(value));
  });
  return {
    rateRows: all.rateRows,
    hotels: [...all.hotels],
    room_types: [...all.room_types],
    durations: [...all.durations],
    occupancies: [...all.occupancies],
    tables_considered: all.tablesConsidered,
    tables_parsed: all.tablesParsed
  };
}

module.exports = { parseTariffTables, parseMoneyCell, parseDurationHeader, parseOccupancyHeader, parseOccupancyListHeader };
