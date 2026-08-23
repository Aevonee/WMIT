'use strict';

// Strict RFC 4180 CSV parser for controlled WMIT imports. Pure module —
// no I/O, no dependencies. Records keep their physical row number so
// import reports can point staff at the exact source line, even when a
// quoted field spans multiple lines. Malformed quoting throws
// IMPORT_CSV_PARSE_ERROR; callers translate that into their own
// validation result shape.

const { WmitError } = require('../core/errors');

function parseError(message, line, column) {
  return new WmitError('IMPORT_CSV_PARSE_ERROR', message, { line, column });
}

function parseCsv(text) {
  const source = String(text === undefined || text === null ? '' : text);
  // A UTF-8 BOM survives string decoding as U+FEFF; it is not header data.
  const input = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const records = [];
  let cells = [];
  let cell = '';
  let quoted = false;   // cursor is inside a quoted field
  let cellOpen = false; // current cell has at least one character or quote
  let cellClosed = false; // a quoted field was closed; only , EOL or EOF may follow
  let line = 1;         // physical row the cursor sits on
  let recordLine = 1;   // physical row the current record started on
  let i = 0;
  const pushCell = () => { cells.push(cell); cell = ''; cellOpen = false; cellClosed = false; };
  const pushRecord = () => {
    pushCell();
    // Entirely blank lines carry no data and must not inflate row counts.
    if (cells.length === 1 && cells[0].trim() === '') { cells = []; return; }
    records.push({ cells, row_number: recordLine });
    cells = [];
  };
  while (i < input.length) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') { cell += '"'; i += 2; continue; }
        quoted = false; cellClosed = true; i += 1; continue;
      }
      if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && input[i + 1] === '\n') i += 1;
        cell += '\n'; line += 1; i += 1; continue;
      }
      cell += ch; i += 1; continue;
    }
    if (ch === '"') {
      if (cell === '' && !cellOpen && !cellClosed) { quoted = true; cellOpen = true; i += 1; continue; }
      throw parseError('Unexpected double quote on line ' + line + '. Wrap the field in quotes and double any inner quotes.', line, i + 1);
    }
    if (cellClosed && ch !== ',' && ch !== '\n' && ch !== '\r') {
      throw parseError('Unexpected text after a closing quote on line ' + line + '. Only a comma, line break, or end of file may follow a quoted field.', line, i + 1);
    }
    if (ch === ',') { pushCell(); i += 1; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i += 1;
      pushRecord(); line += 1; recordLine = line; i += 1; continue;
    }
    cell += ch; cellOpen = true; i += 1;
  }
  if (quoted) throw parseError('A quoted field that starts on line ' + recordLine + ' is never closed.', recordLine, 1);
  if (cell !== '' || cellOpen || cells.length) pushRecord();
  return { records };
}

module.exports = { parseCsv };
