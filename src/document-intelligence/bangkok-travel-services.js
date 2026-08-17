'use strict';

// Supplier-specific pilot adapter. This intentionally does not attempt to define
// a universal tariff language. It preserves the Bangkok Travel Services matrix
// and emits the existing reviewable Phase 1 structures.

const fs = require('node:fs');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

function xmlUnescape(value) {
  return String(value || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)));
}

function normalizeText(value) {
  let text = xmlUnescape(String(value || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  text = text.replace(/\b(?:[A-Za-z]\s+){3,}[A-Za-z]\b/g, (match) => match.replace(/\s+/g, ''));
  return text.replace(/\s+([,.)])/g, '$1').replace(/([(])\s+/g, '$1');
}

function zipEntry(buffer, name) {
  const eocd = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const eocdOffset = buffer.lastIndexOf(eocd);
  if (eocdOffset < 0) throw new Error('DOCX ZIP end-of-directory record was not found.');
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = buffer.readUInt16LE(eocdOffset + 10);
  let offset = centralOffset;
  for (let index = 0; index < entries; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid DOCX central directory entry.');
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const entryName = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (entryName === name) {
      if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Invalid DOCX local entry.');
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.subarray(start, start + compressedSize);
      if (method === 0) return compressed;
      if (method === 8) return zlib.inflateRawSync(compressed);
      throw new Error('Unsupported DOCX compression method: ' + method);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error('DOCX entry was not found: ' + name);
}

function attr(fragment, name) {
  const expression = new RegExp('w:' + name + '="([^"]+)"');
  const match = String(fragment || '').match(expression);
  return match ? xmlUnescape(match[1]) : null;
}

function elementText(fragment) {
  return normalizeText((String(fragment || '').match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) || [])
    .map((part) => part.replace(/^<w:t(?:\s[^>]*)?>|<\/w:t>$/g, ''))
    .join(' '));
}

function rowsFromTable(tableXml) {
  return (tableXml.match(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g) || []).map((rowXml, rowIndex) => ({
    rowIndex: rowIndex + 1,
    cells: (rowXml.match(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g) || []).map((cellXml, cellIndex) => ({
      cellIndex: cellIndex + 1,
      text: elementText(cellXml),
      gridSpan: Number(attr(cellXml.match(/<w:tcPr[\s\S]*?<\/w:tcPr>/), 'gridSpan') || 1),
      raw_xml: cellXml
    }))
  }));
}

function parseAmount(value) {
  const compact = String(value || '').replace(/\s+/g, '');
  const values = compact.split('/').map((part) => part.replace(/[^0-9.\-]/g, '')).filter(Boolean);
  if (!values.length || values.some((part) => !/^\d+(?:\.\d+)?$/.test(part))) return null;
  return values.map((part) => Number(part).toFixed(2));
}

function durationForColumn(columnIndex) {
  if (columnIndex <= 1) return { code: '3D2N', nights: 2 };
  if (columnIndex <= 3) return { code: '4D3N', nights: 3 };
  return { code: 'EXTRA_1_NIGHT', nights: 1 };
}

function occupancyForColumn(columnIndex, values) {
  if (columnIndex === 0 || columnIndex === 2 || columnIndex === 4) return [{ code: 'SGL', amount: values[0], ambiguous: false }];
  if (values.length === 2) return [
    { code: 'TWN', amount: values[0], ambiguous: false },
    { code: 'TRP', amount: values[1], ambiguous: false }
  ];
  return [{ code: 'TWN_TRP_COMBINED', amount: values[0], ambiguous: true }];
}

function isRegionHeading(text) {
  return ['SUKHUMVIT AREA', 'SATHORN AREA', 'SILOM AREA', 'KHAOSAN AREA', 'CHIANG MAI', 'PATTAYA', 'PHUKET', 'KRABI', 'SAMUI'].includes(text.toUpperCase());
}

function sourceLocation(tableIndex, rowIndex, cellIndex) {
  return { table: tableIndex, row: rowIndex, cell: cellIndex, page: null, page_status: 'LAYOUT_DERIVED' };
}

function extractBangkokTravelServicesDocx(filePath) {
  const bytes = fs.readFileSync(filePath);
  const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
  const documentXml = zipEntry(bytes, 'word/document.xml').toString('utf8');
  const paragraphs = (documentXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || []).map(elementText).filter(Boolean);
  const tables = (documentXml.match(/<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/g) || []).map(rowsFromTable);
  const warnings = [];
  const facts = [
    { field_name: 'supplier_name', normalized_value: 'Bangkok Travel Services', confidence: 1, source_provenance: { paragraph: 1 } },
    { field_name: 'validity', normalized_value: '2025-04-01/2025-10-31', confidence: 1, source_wording: paragraphs.find((p) => /VALIDITY/i.test(p)) || null },
    { field_name: 'rate_currency', normalized_value: null, confidence: 0, ambiguous: true, review_status: 'NEEDS_REVIEW', warning: 'The table does not state a clear currency.' },
    { field_name: 'rate_unit', normalized_value: null, confidence: 0, ambiguous: true, review_status: 'NEEDS_REVIEW', warning: 'The table does not state a clear rate unit.' }
  ];
  warnings.push('Table rate currency is not explicit; staff confirmation is required.');
  warnings.push('Table rate unit is not explicit; staff confirmation is required.');

  const rateComponents = [];
  let region = 'BANGKOK';
  tables.forEach((rows, tableIndex) => {
    rows.forEach((row) => {
      const cells = row.cells;
      if (!cells.length) return;
      const rowText = cells.map((cell) => cell.text).filter(Boolean).join(' | ');
      if (isRegionHeading(rowText) && cells.length === 1) { region = rowText.replace(/\s+AREA$/i, '').trim(); return; }
      if (cells.length < 8 || /PACKAGES|ROOM TYPE/i.test(rowText)) return;
      if (/HALF-DAY CITY TOUR/i.test(rowText)) return;
      const hotel = cells[0].text;
      const roomType = cells[1].text;
      if (!hotel || !roomType) return;
      for (let columnIndex = 0; columnIndex < 6; columnIndex += 1) {
        const sourceCell = cells[columnIndex + 2];
        const amounts = parseAmount(sourceCell.text);
        if (!amounts) continue;
        const duration = durationForColumn(columnIndex);
        occupancyForColumn(columnIndex, amounts).forEach((occupancy) => {
          const warningsForRate = [];
          if (occupancy.ambiguous) warningsForRate.push('Single value appears under combined TWN/TRP column; staff must confirm applicability.');
          if (/NO TRP/i.test(roomType) && occupancy.code === 'TWN_TRP_COMBINED') warningsForRate.push('Source notes NO TRP; this rate is retained for review and is not automatically usable for triple occupancy.');
          rateComponents.push({
            service_type: 'ACCOMMODATION_PACKAGE',
            amount: occupancy.amount,
            currency: null,
            currency_status: 'MISSING',
            rate_unit: null,
            rate_unit_status: 'MISSING',
            quantity_driver: 'pax_count',
            conditions: {
              destination: 'Bangkok', region, hotel, room_type: roomType,
              room_arrangement: occupancy.code, duration: duration.code, nights: duration.nights,
              travel_date_start: '2025-04-01', travel_date_end: '2025-10-31'
            },
            source_wording: sourceCell.text,
            source_provenance: sourceLocation(tableIndex + 1, row.rowIndex, sourceCell.cellIndex),
            warnings: warningsForRate,
            requires_explicit_review: occupancy.ambiguous || warningsForRate.length > 0,
            review_status: 'NEEDS_REVIEW',
            inclusions: ['hotel accommodation', 'round-trip airport transfer (SIC/joined)', 'half-day city tour'],
            exclusions: []
          });
        });
      }
    });
  });

  const policyParagraphs = paragraphs.filter((paragraph) => /transfer|tour|child|cancellation|no show|payment|insurance|group policy|validity/i.test(paragraph));
  const itineraryComponents = policyParagraphs.map((text, index) => ({
    content_type: /transfer/i.test(text) ? 'TRANSFER' : /tour/i.test(text) ? 'TOUR' : 'SUPPLIER_CONDITION',
    text, included: /included|inclusions|round-trip|half day/i.test(text),
    source_provenance: { paragraph: index + 1, page: null, page_status: 'LAYOUT_DERIVED' },
    review_status: 'NEEDS_REVIEW'
  }));

  return {
    supplier_name: 'Bangkok Travel Services',
    source: { file_name: filePath.split(/[\\/]/).pop(), file_ref: filePath, checksum, source_format: 'DOCX', immutable: true },
    extraction_summary: { method: 'NATIVE_DOCX_OOXML', tables: tables.length, rate_components: rateComponents.length, paragraphs: paragraphs.length, warnings },
    extraction_facts: facts,
    rate_components: rateComponents,
    itinerary_components: itineraryComponents,
    raw_tables: tables.map((rows, tableIndex) => ({ table: tableIndex + 1, rows: rows.map((row) => ({ row: row.rowIndex, cells: row.cells.map(({ raw_xml, ...cell }) => cell) })) })),
    warnings
  };
}

module.exports = { extractBangkokTravelServicesDocx };
