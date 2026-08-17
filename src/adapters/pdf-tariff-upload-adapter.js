'use strict';

// Generic supplier-tariff PDF adapter.
//
// Extracts the PDF's embedded text layer (pdftotext or Python pdfplumber via
// document-intelligence/pdf-text) and feeds it through the generic
// document-intelligence extractor (classification + field extraction).
// The result is a proposal, never a trusted tariff: currency and rate unit
// facts are emitted for explicit staff confirmation, candidate rate rows
// carry requires_explicit_review, and the normal reviewTariff gates apply
// before the tariff can become trusted.
//
// Scanned/image-only PDFs have no text layer; this adapter refuses them with
// a clear message instead of silently producing an empty extraction. True
// OCR remains a future server-side addition.

const crypto = require('node:crypto');
const fs = require('node:fs');
const { toMinorUnits, fromMinorUnits } = require('../core/money');
const { extractTextFromFile } = require('../document-intelligence/pdf-text');
const { extractTablesFromFile } = require('../document-intelligence/pdf-tables');
const { parseTariffTables } = require('../document-intelligence/tariff-tables');
const { extractTextDocument } = require('../document-intelligence/extractor');

function moneyString(value) {
  try { return fromMinorUnits(toMinorUnits(value)); } catch (_) { return String(value); }
}

// Only these extractor fields are meaningful on a supplier tariff sheet.
// Everything else the generic extractor finds (flight numbers, pax counts,
// passengers, clients, room numbers, contact names, deposits…) belongs to
// booking documents, not tariffs.
const TARIFF_FACT_ALLOWLIST = new Set([
  'destination', 'validity_start', 'validity_end', 'duration', 'package',
  'hotel_name', 'inclusions', 'exclusions', 'payment_terms', 'optional_services',
  'meal_plan', 'supplier', 'email', 'phone'
]);

// Hotel names never look like money or policy sentences.
function plausibleHotelName(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 80) return false;
  if (/[$₱]/.test(text) || /\d/.test(text)) return false;
  if (/guest|flight|transfer|pax|must|same|room|night|supplement/i.test(text)) return false;
  return /^[A-Z]/.test(text);
}

// Policy sentences on tariff sheets (transfers, cancellations, child
// policies…) become supplier-condition itinerary components, not facts.
function policyParagraphs(text) {
  return String(text || '').split('\n').map((line) => line.trim())
    .filter((line) => line.length > 25)
    .filter((line) => /(transfer|tour|child|cancellation|no show|payment|insurance|non-?refundab|validity|surcharge|penalt)/i.test(line))
    .filter((line) => !/[0-9]{3,}/.test(line) || /(transfer|tour|child|cancellation|no show|insurance|refund)/i.test(line))
    .slice(0, 15);
}

const RATE_UNIT_HINTS = [
  [/per\s+person|\/\s*pax|per\s+pax/i, 'PER_PERSON'],
  [/per\s+person\s+per\s+night|\/\s*pax\s*\/\s*night/i, 'PER_PERSON_PER_NIGHT'],
  [/per\s+room\s+per\s+night|room\s*\/\s*night/i, 'PER_ROOM_PER_NIGHT'],
  [/per\s+room/i, 'PER_ROOM'],
  [/per\s+night/i, 'PER_NIGHT'],
  [/per\s+group/i, 'PER_GROUP']
];

function parseDurationToken(value) {
  const match = String(value || '').match(/(\d+)\s*D\s*(\d+)\s*N/i);
  if (!match) return null;
  return { duration: Number(match[1]) + 'D' + Number(match[2]) + 'N', duration_days: Number(match[1]), nights: Number(match[2]) };
}

function detectRateUnit(text) {
  for (const [pattern, unit] of RATE_UNIT_HINTS) {
    if (pattern.test(text)) return unit;
  }
  return null;
}

function createPdfTariffUploadAdapter() {
  return {
    key: 'GENERIC_PDF_TARIFF',
    accepts(input) {
      const name = String(input && input.file_name || '');
      const mime = String(input && input.mime_type || '');
      return /\.pdf$/i.test(name) || mime === 'application/pdf';
    },
    extract(filePath, body) {
      const bytes = fs.readFileSync(filePath);
      const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
      const extracted = extractTextFromFile(filePath);
      const warnings = extracted.warnings.slice();
      if (!extracted.ok) {
        throw new Error(extracted.warnings.join(' ') || 'PDF text extraction failed.');
      }
      if (!String(extracted.text || '').trim()) {
        throw new Error('This PDF has no extractable text layer (it looks like a scan or image-only document). Text-layer extraction cannot read it; ask the supplier for a text PDF or type the rates manually.');
      }

      const fileName = filePath.split(/[\\/]/).pop();
      const extraction = extractTextDocument({
        fileName,
        sourceHint: 'SUPPLIER',
        text: extracted.text
      });
      warnings.push(...extraction.warnings);

      const fieldsByName = new Map((extraction.fields || []).map((field) => [field.field_name, field]));

      // Rate-matrix extraction: real tariff sheets are tables (hotels ×
      // room types × durations × occupancies). Parse each money cell into
      // its own candidate rate with cell provenance; all rows stay
      // requires_explicit_review.
      const tableExtraction = extractTablesFromFile(filePath);
      warnings.push(...tableExtraction.warnings);
      const matrix = parseTariffTables(tableExtraction.tables);
      const tableRates = matrix.rateRows.map((row) => ({
        service_type: 'ACCOMMODATION_PACKAGE',
        amount: moneyString(row.amount),
        currency: null,
        currency_status: 'MISSING',
        rate_unit: null,
        rate_unit_status: 'MISSING',
        quantity_driver: 'pax_count',
        conditions: row.conditions,
        source_wording: row.source_wording,
        source_provenance: Object.assign({ method: 'PDF_TABLE_CELL', parser: extracted.parser }, row.provenance),
        warnings: row.ambiguous
          ? ['Cell contains multiple amounts; the first was taken — verify against the document.']
          : ['Generic table extraction: confirm the amount, currency, and rate unit during review.'],
        requires_explicit_review: true,
        review_status: 'NEEDS_REVIEW',
        inclusions: [],
        exclusions: []
      }));
      if (matrix.tables_considered > 0 && matrix.tables_parsed === 0) {
        warnings.push('Tables were detected but no rate rows could be read from them; review the extraction and add rates manually if needed.');
      }

      // A tariff sheet is not a booking memo: only tariff-relevant fields
      // become facts. Flight numbers, pax counts, passengers, clients, room
      // numbers, and contact names are noise from the generic extractor and
      // are dropped here; policy sentences land in itinerary components.
      const facts = [];
      const factsByName = new Map();
      const pushFact = (name, field) => {
        if (factsByName.has(name)) return;
        const fact = {
          field_name: name,
          raw_value: field.raw_value === undefined ? null : field.raw_value,
          normalized_value: field.normalized_value === undefined ? null : field.normalized_value,
          confidence: Number(field.confidence || 0),
          ambiguous: Boolean(field.ambiguous) || Number(field.confidence || 0) < 0.8,
          review_status: field.review_status === 'EXTRACTED' && Number(field.confidence || 0) >= 0.8 ? 'NEEDS_REVIEW' : (field.review_status || 'NEEDS_REVIEW'),
          warning: (field.warnings && field.warnings[0]) || null
        };
        factsByName.set(name, fact);
        facts.push(fact);
      };
      (extraction.fields || []).forEach((field) => {
        if (field.field_name === 'currency') return; // emitted as rate_currency below
        if (!TARIFF_FACT_ALLOWLIST.has(field.field_name)) return;
        if (field.field_name === 'hotel_name' && !plausibleHotelName(field.normalized_value)) {
          warnings.push('Ignored an unlikely hotel name extracted from the text (' + JSON.stringify(String(field.normalized_value || '').slice(0, 40)) + '); table rows carry the hotels.');
          return;
        }
        if (field.field_name === 'optional_services' && /^(are|is|must|will|should|can)\b/i.test(String(field.normalized_value || ''))) return;
        pushFact(field.field_name, field);
      });
      // Travel dates on a tariff sheet are the validity window; keep them
      // only when no explicit validity was captured.
      if (!factsByName.has('validity_start') && fieldsByName.get('travel_start')) pushFact('validity_start', fieldsByName.get('travel_start'));
      if (!factsByName.has('validity_end') && fieldsByName.get('travel_end')) pushFact('validity_end', fieldsByName.get('travel_end'));

      // Currency and unit gate the tariff exactly like the Bangkok pilot:
      // never assumed, always emitted for explicit staff confirmation.
      const currencyField = fieldsByName.get('currency');
      facts.push({
        field_name: 'rate_currency',
        raw_value: currencyField ? currencyField.raw_value : null,
        normalized_value: currencyField ? currencyField.normalized_value : null,
        confidence: currencyField ? Number(currencyField.confidence || 0) : 0,
        ambiguous: !currencyField,
        review_status: 'NEEDS_REVIEW',
        warning: currencyField ? 'Currency read from the document text; staff must confirm before the tariff is trusted.' : 'The document does not state a clear currency.'
      });
      const hintedUnit = detectRateUnit(extracted.text);
      facts.push({
        field_name: 'rate_unit',
        raw_value: hintedUnit,
        normalized_value: hintedUnit,
        confidence: hintedUnit ? 0.7 : 0,
        ambiguous: true,
        review_status: 'NEEDS_REVIEW',
        warning: hintedUnit ? 'Unit inferred from wording like "per person"; confirm the exact rate basis.' : 'The document does not state a clear rate unit.'
      });

      // One candidate rate row from the best labelled amount — only when no
      // table rates were found (single-price brochure pages). When a rate
      // matrix exists, the per-cell rows above are the proposal and a single
      // "amount" fact would misrepresent the document.
      const rateComponents = tableRates.slice();
      const amountField = fieldsByName.get('amount');
      if (!rateComponents.length && amountField && amountField.normalized_value !== null && amountField.normalized_value !== undefined) {
        const conditions = {};
        const destination = fieldsByName.get('destination');
        if (destination && destination.normalized_value) conditions.destination = destination.normalized_value;
        const durationToken = parseDurationToken((fieldsByName.get('duration') || {}).normalized_value);
        if (durationToken) {
          conditions.duration = durationToken.duration;
          conditions.duration_days = durationToken.duration_days;
          conditions.nights = durationToken.nights;
        }
        const validityStart = fieldsByName.get('validity_start');
        const validityEnd = fieldsByName.get('validity_end');
        if (validityStart && validityStart.normalized_value) conditions.travel_date_start = validityStart.normalized_value;
        if (validityEnd && validityEnd.normalized_value) conditions.travel_date_end = validityEnd.normalized_value;
        const hotel = fieldsByName.get('hotel_name');
        if (hotel && hotel.normalized_value) conditions.hotel = hotel.normalized_value;
        rateComponents.push({
          service_type: 'PACKAGE',
          amount: moneyString(amountField.normalized_value),
          currency: null,
          currency_status: 'MISSING',
          rate_unit: null,
          rate_unit_status: 'MISSING',
          quantity_driver: 'pax_count',
          conditions,
          source_wording: amountField.raw_value === undefined ? null : String(amountField.raw_value),
          source_provenance: { method: 'PDF_TEXT_LAYER', parser: extracted.parser, page: null },
          warnings: ['Generic PDF extraction: the amount and its context are best-effort. Confirm the amount, currency, and rate unit during review.'],
          requires_explicit_review: true,
          review_status: 'NEEDS_REVIEW',
          inclusions: (fieldsByName.get('inclusions') && fieldsByName.get('inclusions').normalized_value)
            ? String(fieldsByName.get('inclusions').normalized_value).split(/[,;•]/).map((item) => item.trim()).filter(Boolean).slice(0, 12)
            : [],
          exclusions: (fieldsByName.get('exclusions') && fieldsByName.get('exclusions').normalized_value)
            ? String(fieldsByName.get('exclusions').normalized_value).split(/[,;•]/).map((item) => item.trim()).filter(Boolean).slice(0, 12)
            : []
        });
      } else if (!rateComponents.length) {
        warnings.push('No labelled package amount was found; add rate rows manually after review.');
      }
      if (tableRates.length) {
        // A single "amount" fact would misrepresent a rate matrix — the
        // table rows are the proposal. Drop it from the fact list.
        const amountFactIndex = facts.findIndex((fact) => fact.field_name === 'amount');
        if (amountFactIndex >= 0) facts.splice(amountFactIndex, 1);
      }

      if (extraction.document_type && !/TARIFF/i.test(String(extraction.document_type))) {
        warnings.push('The document classified as ' + extraction.document_type + ', not a supplier tariff. Review before trusting anything from this upload.');
      }

      const itineraryComponents = [];
      const paymentTerms = fieldsByName.get('payment_terms');
      if (paymentTerms && paymentTerms.normalized_value) {
        itineraryComponents.push({
          content_type: 'SUPPLIER_CONDITION',
          text: String(paymentTerms.normalized_value),
          included: false,
          source_provenance: { method: 'PDF_TEXT_LAYER', parser: extracted.parser },
          review_status: 'NEEDS_REVIEW'
        });
      }
      // Policy sentences (transfers, cancellations, child/no-show rules,
      // non-refundable notices) are supplier conditions, not facts.
      policyParagraphs(extracted.text).forEach((line) => {
        if (itineraryComponents.some((component) => component.text === line)) return;
        itineraryComponents.push({
          content_type: /transfer/i.test(line) ? 'TRANSFER' : /tour/i.test(line) ? 'TOUR' : 'SUPPLIER_CONDITION',
          text: line,
          included: false,
          source_provenance: { method: 'PDF_TEXT_LAYER', parser: extracted.parser },
          review_status: 'NEEDS_REVIEW'
        });
      });

      const supplierFromBody = body && body.supplier_name ? String(body.supplier_name).trim() : null;
      const supplierFromText = fieldsByName.get('supplier');

      return {
        supplier_name: supplierFromBody || (supplierFromText && supplierFromText.normalized_value) || null,
        source: { file_name: fileName, file_ref: filePath, checksum, source_format: 'PDF', parser: extracted.parser, pages: extracted.pages || null, immutable: true },
        extraction_summary: {
          method: tableRates.length ? 'PDF_TABLE_CELLS + text (' + (extracted.parser || 'unknown') + ')' : 'PDF_TEXT_LAYER (' + (extracted.parser || 'unknown') + ')',
          document_type: extraction.document_type,
          source_type: extraction.source_type,
          classification_confidence: extraction.classification_confidence,
          fields_extracted: (extraction.fields || []).length,
          rate_components: rateComponents.length,
          hotels: matrix.hotels.length ? matrix.hotels.length : undefined,
          regions: undefined,
          durations: matrix.durations.length ? matrix.durations : undefined,
          occupancy_types: matrix.occupancies.length ? matrix.occupancies : undefined,
          tables_detected: matrix.tables_considered,
          tables_parsed: matrix.tables_parsed,
          pages: extracted.pages || null,
          review_required: true,
          warnings
        },
        extraction_facts: facts,
        rate_components: rateComponents,
        itinerary_components: itineraryComponents,
        warnings
      };
    }
  };
}

module.exports = { createPdfTariffUploadAdapter };
