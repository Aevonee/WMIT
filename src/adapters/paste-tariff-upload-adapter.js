'use strict';

// Paste-intake adapter: staff paste text extracted anywhere (PDF tool,
// OCR site, e-mail) instead of uploading the file. The generic pasted-text
// parser derives the rate-matrix structure from the document's own header
// (any durations × occupancies); text without a table header falls through
// to the generic document pipeline. Everything is review-gated exactly
// like PDF uploads — currency and rate unit are never assumed.

const fs = require('node:fs');
const crypto = require('node:crypto');
const { parsePastedTariffText, looksLikeTariffMatrixText } = require('../document-intelligence/tariff-text');
const { createPdfTariffUploadAdapter } = require('./pdf-tariff-upload-adapter');

function createPasteTariffUploadAdapter() {
  const pdfAdapter = createPdfTariffUploadAdapter();
  return {
    key: 'PASTE_TARIFF_TEXT',
    accepts(input) {
      return Boolean(input && input.file_name && /\.txt$/i.test(String(input.file_name)));
    },
    extract(filePath, body) {
      const text = fs.readFileSync(filePath, 'utf8');
      if (!looksLikeTariffMatrixText(text)) {
        // No rate-table header: run the generic text pipeline with its
        // tariff fact allowlist and review gates.
        return pdfAdapter.extract(filePath, body);
      }
      const parsed = parsePastedTariffText(text, { supplierName: body && body.supplier_name });
      const warnings = parsed.warnings.slice();
      const rateComponents = parsed.rateRows.map((row) => ({
        service_type: 'ACCOMMODATION_PACKAGE',
        amount: row.amount,
        currency: null,
        currency_status: 'MISSING',
        rate_unit: null,
        rate_unit_status: 'MISSING',
        quantity_driver: 'pax_count',
        conditions: row.conditions,
        source_wording: row.source_wording,
        source_provenance: row.provenance,
        warnings: row.warnings.length ? row.warnings : ['Pasted-text extraction: confirm the amount, currency, and rate unit during review.'],
        requires_explicit_review: true,
        review_status: 'NEEDS_REVIEW',
        inclusions: [],
        exclusions: []
      }));
      const facts = [];
      if (parsed.supplier_name) {
        facts.push({ field_name: 'supplier', raw_value: null, normalized_value: parsed.supplier_name, confidence: 1, ambiguous: false, review_status: 'NEEDS_REVIEW', warning: null });
      }
      if (parsed.validity) {
        facts.push({ field_name: 'validity_start', raw_value: null, normalized_value: parsed.validity.start, confidence: 1, ambiguous: false, review_status: 'NEEDS_REVIEW', warning: null });
        facts.push({ field_name: 'validity_end', raw_value: null, normalized_value: parsed.validity.end, confidence: 1, ambiguous: false, review_status: 'NEEDS_REVIEW', warning: null });
      }
      facts.push({
        field_name: 'rate_currency',
        raw_value: null,
        normalized_value: null,
        confidence: 0,
        ambiguous: true,
        review_status: 'NEEDS_REVIEW',
        warning: 'The pasted matrix numbers carry no currency marker — confirm the currency before trusting the tariff.'
      });
      facts.push({
        field_name: 'rate_unit',
        raw_value: 'PER_PERSON',
        normalized_value: 'PER_PERSON',
        confidence: 0.7,
        ambiguous: true,
        review_status: 'NEEDS_REVIEW',
        warning: 'Unit assumed per person for package rates; confirm the exact rate basis.'
      });

      // Policy paragraphs from the pasted text become reviewable conditions.
      const itineraryComponents = text.split('\n').map((line) => line.replace(/\s+/g, ' ').trim())
        .filter((line) => line.length > 25)
        .filter((line) => /(transfer|child|cancellation|no show|payment|insurance|non-?refundab|surcharge|penalt|group policy|waiting time|passport|itinerary|policy)/i.test(line))
        .filter((line) => !/^[\d\s./]+$/.test(line))
        .slice(0, 15)
        .map((line) => ({
          content_type: /transfer/i.test(line) ? 'TRANSFER' : /tour/i.test(line) ? 'TOUR' : 'SUPPLIER_CONDITION',
          text: line,
          included: false,
          source_provenance: { method: 'PASTED_TEXT_LINE' },
          review_status: 'NEEDS_REVIEW'
        }));

      const checksum = crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
      return {
        supplier_name: parsed.supplier_name,
        source: { file_name: filePath.split(/[\\/]/).pop(), file_ref: filePath, checksum, source_format: 'TXT', parser: 'pasted-text', pages: null, immutable: true },
        extraction_summary: {
          method: 'PASTED_TEXT_MATRIX',
          columns: (parsed.columns || []).map((column) => (column.duration ? column.duration + ' ' : '') + column.occupancy).join(' | '),
          rate_components: rateComponents.length,
          hotels: parsed.hotels.length,
          regions: parsed.regions.length ? parsed.regions : undefined,
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

module.exports = { createPasteTariffUploadAdapter };
