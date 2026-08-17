'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { classifyDocument } = require('../../src/document-intelligence/taxonomy');
const { normalizeFlightNumber, normalizeDate, normalizeCurrency, normalizeAmount } = require('../../src/document-intelligence/normalizer');
const { extractTextDocument } = require('../../src/document-intelligence/extractor');
const { processFile } = require('../../src/document-intelligence/pipeline');
const { REFERENCE_DOCUMENTS } = require('../../src/document-intelligence/reference-manifest');

const FIXTURE_DIR = path.join('tests', 'fixtures', 'reference-documents');

function fieldMap(result) {
  return Object.fromEntries(result.fields.map((field) => [field.field_name, field]));
}

function valueMap(result) {
  return Object.fromEntries(result.fields.map((field) => [field.field_name, field.normalized_value]));
}

function assertFixtureValue(values, key, expected) {
  if (key.endsWith('Includes')) {
    const actualKey = key === 'hotelIncludes' ? 'hotel_name' : key.replace(/Includes$/, '');
    assert.ok(String(values[actualKey] || '').toUpperCase().includes(String(expected).toUpperCase()));
  } else {
    assert.equal(values[key], expected);
  }
}

test('classifies all eight real reference PDFs from content, not filenames', () => {
  for (const fixture of REFERENCE_DOCUMENTS) {
    const result = processFile({
      filePath: path.join(FIXTURE_DIR, fixture.fileName),
      fileName: fixture.fileName
    });
    assert.equal(result.source_type, fixture.expectedSource, fixture.fileName);
    assert.equal(result.document_type, fixture.expectedType, fixture.fileName);
    assert.ok(result.classification_confidence >= fixture.confidenceThreshold, fixture.fileName);
    assert.ok(['pdftotext', 'python-pdfplumber'].includes(result.parser), fixture.fileName);
    for (const field of fixture.expectedFields) {
      assert.ok(Object.prototype.hasOwnProperty.call(valueMap(result), field), fixture.fileName + ': missing ' + field);
    }
    for (const [key, expected] of Object.entries(fixture.expectedValues)) {
      assertFixtureValue(valueMap(result), key, expected);
    }
  }
});

test('changing a filename does not change classification when document text is unchanged', () => {
  const original = processFile({
    filePath: path.join(FIXTURE_DIR, 'Quotation_Robert.pdf'),
    fileName: 'Quotation_Robert.pdf'
  });
  const textResult = extractTextDocument({
    fileName: 'completely-unrelated-name.pdf',
    text: original.parser ? require('../../src/document-intelligence/pdf-text').extractTextFromFile(path.join(FIXTURE_DIR, 'Quotation_Robert.pdf')).text : ''
  });
  assert.equal(textResult.source_type, 'WMIT');
  assert.equal(textResult.document_type, 'WMIT_QUOTATION');
});

test('normalizes dates, currencies, spaced amounts, and valid flight numbers', () => {
  assert.equal(normalizeFlightNumber('5J-188'), '5J188');
  assert.equal(normalizeFlightNumber('5J 188'), '5J188');
  assert.equal(normalizeFlightNumber('PHP 13'), null);
  assert.equal(normalizeDate('06 May 2026'), '2026-05-06');
  assert.equal(normalizeDate('31 February 2026'), null);
  assert.equal(normalizeCurrency(String.fromCharCode(0x20b1)), 'PHP');
  assert.equal(normalizeAmount('PHP 84 991'), 84991);
  assert.equal(normalizeAmount('USD 1,250.50'), 1250.5);
});

test('extracts a reviewable deterministic result without writing business records', () => {
  const result = extractTextDocument({
    documentId: 'DOCUMENT-TEST-EXTRACTION-000001',
    fileName: 'synthetic-tour-quotation.txt',
    sourceHint: 'SUPPLIER',
    text: [
      'SUPPLIER QUOTATION',
      'Supplier: Synthetic Supplier',
      'Destination: Synthetic City',
      'Travel dates: 01 Dec 2026 to 05 Dec 2026',
      'Pax: 2',
      'Package: Synthetic 5D4N Package',
      'Flight: 5J-188',
      'Hotel: Synthetic Hotel',
      'Rooming: Twin share',
      'Occupancy: 2',
      'Currency: PHP',
      'Total: PHP 12,500',
      'Deposit: PHP 3,000',
      'Balance: PHP 9,500',
      'Meal Plan: Breakfast',
      'Inclusions: Hotel and transfer',
      'Exclusions: Personal expenses',
      'Payment Terms: balance due before departure'
    ].join('\n')
  });
  const fields = fieldMap(result);
  assert.equal(result.document_type, 'SUPPLIER_QUOTATION');
  assert.equal(fields.pax_count.normalized_value, 2);
  assert.equal(fields.flight_number.normalized_value, '5J188');
  assert.equal(fields.amount.normalized_value, 12500);
  assert.equal(fields.supplier.normalized_value, 'Synthetic Supplier');
  assert.equal(fields.rooming.normalized_value, 'Twin share');
  assert.equal(result.review_outcome, 'NEEDS_REVIEW');
});

test('regression: invoice, quotation, voucher, money, and date false positives are blocked', () => {
  const invoice = processFile({
    filePath: path.join(FIXTURE_DIR, 'ICN_0506.0510_Agasang - Invoice.pdf'),
    fileName: 'ICN_0506.0510_Agasang - Invoice.pdf'
  });
  assert.equal(invoice.document_type, 'WMIT_INVOICE');
  assert.equal(invoice.source_type, 'WMIT');
  assert.equal(valueMap(invoice).amount, 86791);
  assert.equal(valueMap(invoice).flight_number, '5J186');

  const quotation = processFile({
    filePath: path.join(FIXTURE_DIR, 'Quotation_Robert.pdf'),
    fileName: 'Quotation_Robert.pdf'
  });
  assert.equal(quotation.document_type, 'WMIT_QUOTATION');
  assert.notEqual(quotation.document_type, 'SUPPLIER_TARIFF');

  const voucher = processFile({
    filePath: path.join(FIXTURE_DIR, 'SV-KOR- APR 01-APR 06 5J.pdf'),
    fileName: 'SV-KOR- APR 01-APR 06 5J.pdf'
  });
  assert.equal(voucher.document_type, 'TOUR_OPERATOR_VOUCHER');
  assert.notEqual(voucher.document_type, 'AIRLINE_TICKET');

  const synthetic = extractTextDocument({
    text: 'Reference: 2026-020701\nTotal Amount Due: PHP 84 991\nPHP 13'
  });
  const values = valueMap(synthetic);
  assert.equal(values.amount, 84991);
  assert.equal(values.flight_number, undefined);
  assert.equal(values.travel_start, undefined);
});

test('missing file or unavailable parser fails safely', () => {
  const result = processFile({
    filePath: path.join(FIXTURE_DIR, 'does-not-exist.pdf'),
    documentId: 'DOCUMENT-TEST-MISSING-000001'
  });
  assert.equal(result.review_outcome, 'FAILED');
  assert.ok(result.warnings.some((warning) => /not found|parser/i.test(warning)));
});
