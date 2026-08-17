'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase, ensureEntityTables, SqliteRepository, SqliteAuditLog, SqliteIdGenerator } = require('../../src/server/sqlite-store');
const { createPhase1Runtime, ENTITY_DEFS } = require('../../src/phase1/runtime');
const { createPhase1Application } = require('../../src/application/phase1');
const { createPdfTariffUploadAdapter } = require('../../src/adapters/pdf-tariff-upload-adapter');
const { createMvpServer } = require('../../app/server');

// Minimal single-page PDF with a real text layer (standard Helvetica), the
// same construction used for live QA fixtures.
function buildPdf(lines) {
  const encoder = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const content = 'BT /F1 11 Tf 14 TL 50 750 Td ' + lines.map((l) => '(' + encoder(l) + ') Tj T*').join(' ') + ' ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, i) => { offsets.push(pdf.length); pdf += (i + 1) + ' 0 obj\n' + body + '\nendobj\n'; });
  const xrefStart = pdf.length;
  pdf += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i += 1) pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  pdf += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF';
  return Buffer.from(pdf, 'latin1');
}

const TARIFF_PDF_LINES = [
  'HORIZON TRAVEL CORP SUPPLIER TARIFF 2026',
  'Supplier: Horizon Travel Corp',
  'Validity: April 1 - October 31, 2026',
  'Tour Name: Seoul Discovery 5D4N',
  'Destination: Seoul',
  'Duration: 5D4N',
  'Tour Fee: PHP 32,900 per person',
  'Inclusions:',
  'Roundtrip airfare',
  '4 nights hotel with breakfast',
  'Exclusions:',
  'Visa fee'
];

function buildFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmit-tariff-pdf-'));
  const db = openDatabase(path.join(dir, 'wmit.sqlite3'));
  ensureEntityTables(db, ENTITY_DEFS);
  const runtime = createPhase1Runtime({
    clock: () => new Date('2026-08-20T08:00:00Z'),
    idGenerator: new SqliteIdGenerator(db),
    auditLog: new SqliteAuditLog(db),
    repositoryFactory: (type, repoOptions) => new SqliteRepository(db, type, repoOptions.idField),
    config: { trustedActors: { LOCAL_STAFF: ['EDIT_DRAFT_PRICING', 'SELECT_OPTION', 'RESERVE_SUPPLIER', 'ALLOCATE_PAYMENT', 'REVISE_QUOTATION', 'ACCEPT_QUOTATION', 'RECORD_TICKETING', 'ISSUE_VOUCHER'], LOCAL_MANAGER: ['VERIFY_PAYMENT', 'APPROVE_QUOTATION', 'APPROVE_PAYABLE', 'SUPPLIER_PAYMENT', 'CONFIRM_COMMITMENT', 'REFUND', 'PRICE_OVERRIDE', 'CLIENT_ACCEPT_AMENDMENT', 'RECONCILE_BOOKING', 'CONFIGURE_SETTINGS'] } }
  });
  const phase1App = createPhase1Application({
    runtime,
    seedSynthetic: false,
    sourceAdapters: { GENERIC_PDF_TARIFF: createPdfTariffUploadAdapter() }
  });
  runtime.createSupplier({ supplier_id: 'SUPPLIER-TEST-000001', display_name: 'Horizon Travel Corp', legal_name: 'Horizon Travel Corp' }, { actor: 'LOCAL_STAFF' });
  const { server } = createMvpServer({ phase1App });
  return { dir, db, runtime, phase1App, server };
}

async function withListening(server, run) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try { return await run(base); } finally { await new Promise((resolve) => server.close(resolve)); }
}

async function action(base, body) {
  const response = await fetch(base + '/api/phase1/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return await response.json();
}

test('a supplier tariff PDF lands in the review queue with currency and unit gated for confirmation', async () => {
  const fixture = buildFixture();
  await withListening(fixture.server, async (base) => {
    const pdf = buildPdf(TARIFF_PDF_LINES);
    const upload = await action(base, {
      action: 'uploadSourceDocument',
      input: {
        adapter_key: 'GENERIC_PDF_TARIFF',
        supplier_id: 'SUPPLIER-TEST-000001',
        file_name: 'horizon-tariff-2026.pdf',
        mime_type: 'application/pdf',
        content_base64: pdf.toString('base64'),
        idempotency_key: 'TARIFF-PDF-TEST-1'
      },
      actor: 'LOCAL_STAFF'
    });
    assert.equal(upload.ok, true, JSON.stringify(upload.error));
    const tariffId = upload.data.tariff_source_id;
    assert.match(tariffId, /^TARIFF-\d{4}-\d{6}$/);

    const tariff = fixture.runtime.get('TariffSource', tariffId);
    assert.equal(tariff.trusted, false, 'an uploaded tariff is never trusted immediately');
    assert.equal(tariff.status, 'NEEDS_REVIEW');
    assert.equal(tariff.supplier_name, 'Horizon Travel Corp');
    assert.match(tariff.extraction_summary.method, /PDF_TEXT_LAYER/);

    const facts = fixture.runtime.list('TariffExtractionFact', (fact) => fact.tariff_source_id === tariffId);
    const currencyFact = facts.find((fact) => fact.field_name === 'rate_currency');
    assert.equal(currencyFact.normalized_value, 'PHP');
    assert.equal(currencyFact.review_status, 'NEEDS_REVIEW', 'currency requires explicit confirmation');
    const unitFact = facts.find((fact) => fact.field_name === 'rate_unit');
    assert.equal(unitFact.normalized_value, 'PER_PERSON', 'unit inferred from "per person" wording');
    assert.equal(unitFact.review_status, 'NEEDS_REVIEW');

    const rates = fixture.runtime.list('TariffRateComponent', (rate) => rate.tariff_source_id === tariffId);
    assert.equal(rates.length, 1);
    assert.equal(rates[0].amount, '32900.00');
    assert.equal(rates[0].currency_status, 'MISSING', 'currency is not assumed on the rate row');
    assert.equal(rates[0].requires_explicit_review, true);
    assert.equal(rates[0].conditions.destination, 'Seoul');
    assert.equal(rates[0].conditions.duration_days, 5);

    // The source document is retained as evidence and linked by checksum.
    const documents = fixture.runtime.list('Document', (document) => document.document_type === 'SUPPLIER_TARIFF');
    assert.equal(documents.length, 1);
    assert.equal(documents[0].checksum, upload.data.original_source.checksum);

    // Idempotent replay: same key returns the same tariff without re-extracting.
    const replay = await action(base, {
      action: 'uploadSourceDocument',
      input: {
        adapter_key: 'GENERIC_PDF_TARIFF',
        supplier_id: 'SUPPLIER-TEST-000001',
        file_name: 'horizon-tariff-2026.pdf',
        content_base64: pdf.toString('base64'),
        idempotency_key: 'TARIFF-PDF-TEST-1'
      },
      actor: 'LOCAL_STAFF'
    });
    assert.equal(replay.ok, true);
    assert.equal(replay.data.tariff_source_id, tariffId);
    assert.equal(replay.meta.idempotent, true);

    // Trust is impossible while currency/unit/rate remain unconfirmed.
    const premature = await action(base, { action: 'reviewTariff', input: { tariff_source_id: tariffId, approve: true }, actor: 'LOCAL_MANAGER' });
    assert.equal(premature.ok, false);
    assert.equal(premature.error.code, 'TARIFF_REVIEW_REQUIRED');

    // Confirm every low-confidence or ambiguous fact (currency, unit, and
    // the generic extractor's <0.8 fields) and the candidate rate — exactly
    // what the review UI walks a staff member through — then approve.
    const corrections = {};
    facts.forEach((fact) => {
      if (Number(fact.confidence || 0) < 0.8 || fact.ambiguous) {
        corrections[fact.tariff_extraction_fact_id] = { normalized_value: fact.normalized_value, confidence: 1 };
      }
    });
    const approved = await action(base, {
      action: 'reviewTariff',
      input: { tariff_source_id: tariffId, approve: true, corrections, confirmed_rate_ids: [rates[0].tariff_rate_component_id] },
      actor: 'LOCAL_MANAGER'
    });
    assert.equal(approved.ok, true, JSON.stringify(approved.error));
    assert.equal(approved.data.trusted, true);

    const stampedRate = fixture.runtime.list('TariffRateComponent', (rate) => rate.tariff_source_id === tariffId)[0];
    assert.equal(stampedRate.currency, 'PHP', 'approved currency is stamped onto the rate rows');
    assert.equal(stampedRate.rate_unit, 'PER_PERSON');
    assert.equal(stampedRate.requires_explicit_review, false);
  });
});

// Ruled rate-matrix PDF: 2 hotels × 2 room types × 3 durations = 12 cells.
function buildMatrixPdf() {
  const cols = [50, 180, 300, 420, 540, 640];
  const rows = [740, 714, 688, 662, 636, 610];
  const data = [
    ['HOTEL', 'ROOM TYPE', '3D2N', '4D3N', '5D4N'],
    ['Grand Palace Hotel', 'Deluxe', '8,500', '9,200', '10,400'],
    ['Grand Palace Hotel', 'Premier', '9,800', '10,500', '11,900'],
    ['Riverside Inn', 'Standard', '6,200', '6,900', '7,700'],
    ['Riverside Inn', 'Family', '8,800', '9,600', '10,800']
  ];
  const NL = '\n';
  let grid = '0.7 w' + NL;
  for (const y of rows) grid += '50 ' + y + ' m 640 ' + y + ' l S' + NL;
  for (const x of cols) grid += x + ' 610 m ' + x + ' 740 l S' + NL;
  let text = '';
  data.forEach((row, r) => {
    row.forEach((cell, c) => {
      text += 'BT /F1 9 Tf ' + (cols[c] + 5) + ' ' + (rows[r] - 15) + ' Td (' + cell.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)') + ') Tj ET' + NL;
    });
  });
  const headerText = 'BT /F1 11 Tf 50 770 Td (HORIZON TRAVEL CORP TARIFF 2026) Tj ET' + NL + 'BT /F1 9 Tf 50 752 Td (Rates per person. All amounts in PHP.) Tj ET';
  const content = headerText + NL + grid + text;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 700 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    '<< /Length ' + content.length + ' >>' + NL + 'stream' + NL + content + NL + 'endstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let pdf = '%PDF-1.4' + NL;
  const offsets = [0];
  objects.forEach((body, i) => { offsets.push(pdf.length); pdf += (i + 1) + ' 0 obj' + NL + body + NL + 'endobj' + NL; });
  const xref = pdf.length;
  pdf += 'xref' + NL + '0 ' + (objects.length + 1) + NL + '0000000000 65535 f ' + NL;
  for (let i = 1; i <= objects.length; i += 1) pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n ' + NL;
  pdf += 'trailer' + NL + '<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>' + NL + 'startxref' + NL + xref + NL + '%%EOF';
  return Buffer.from(pdf, 'latin1');
}

test('a complex rate-matrix PDF extracts one candidate rate per money cell with hotel/room/duration conditions', async () => {
  const fixture = buildFixture();
  await withListening(fixture.server, async (base) => {
    const upload = await action(base, {
      action: 'uploadSourceDocument',
      input: { adapter_key: 'GENERIC_PDF_TARIFF', supplier_id: 'SUPPLIER-TEST-000001', file_name: 'horizon-matrix-2026.pdf', content_base64: buildMatrixPdf().toString('base64'), idempotency_key: 'TARIFF-MATRIX-1' },
      actor: 'LOCAL_STAFF'
    });
    assert.equal(upload.ok, true, JSON.stringify(upload.error));
    const tariffId = upload.data.tariff_source_id;

    const tariff = fixture.runtime.get('TariffSource', tariffId);
    assert.match(tariff.extraction_summary.method, /PDF_TABLE_CELLS/, 'matrix documents report table extraction');
    assert.equal(tariff.extraction_summary.hotels, 2);

    const rates = fixture.runtime.list('TariffRateComponent', (rate) => rate.tariff_source_id === tariffId);
    assert.equal(rates.length, 12, 'every money cell becomes a candidate rate');
    const find = (hotel, room, duration) => rates.find((rate) => rate.conditions.hotel === hotel && rate.conditions.room_type === room && rate.conditions.duration === duration);
    assert.equal(find('Grand Palace Hotel', 'Deluxe', '3D2N').amount, '8500.00');
    assert.equal(find('Grand Palace Hotel', 'Premier', '5D4N').amount, '11900.00');
    assert.equal(find('Riverside Inn', 'Standard', '4D3N').amount, '6900.00');
    assert.equal(find('Riverside Inn', 'Family', '5D4N').amount, '10800.00');
    const sample = find('Riverside Inn', 'Family', '5D4N');
    assert.equal(sample.conditions.duration_days, 5);
    assert.equal(sample.conditions.nights, 4);
    assert.equal(sample.requires_explicit_review, true, 'table rates stay review-gated');
    assert.equal(sample.source_provenance.method, 'PDF_TABLE_CELL');

    // No misleading single "amount" fact for matrix documents.
    const facts = fixture.runtime.list('TariffExtractionFact', (fact) => fact.tariff_source_id === tariffId);
    assert.equal(facts.some((fact) => fact.field_name === 'amount'), false);
    const currencyFact = facts.find((fact) => fact.field_name === 'rate_currency');
    assert.equal(currencyFact.normalized_value, 'PHP');

    // Trust still requires confirming every gate; with all facts + all 12
    // rate cells confirmed, approval stamps currency/unit on every row.
    const corrections = {};
    facts.forEach((fact) => {
      if (Number(fact.confidence || 0) < 0.8 || fact.ambiguous) corrections[fact.tariff_extraction_fact_id] = { normalized_value: fact.normalized_value, confidence: 1 };
    });
    const approved = await action(base, {
      action: 'reviewTariff',
      input: { tariff_source_id: tariffId, approve: true, corrections, confirmed_rate_ids: rates.map((rate) => rate.tariff_rate_component_id) },
      actor: 'LOCAL_MANAGER'
    });
    assert.equal(approved.ok, true, JSON.stringify(approved.error));
    const stamped = fixture.runtime.list('TariffRateComponent', (rate) => rate.tariff_source_id === tariffId);
    assert.equal(stamped.every((rate) => rate.currency === 'PHP' && rate.rate_unit && rate.requires_explicit_review === false), true, 'all 12 rows stamped on trust');
  });
});

// Occupancy-matrix PDF: hotels × SGL/TWN/TRP columns.
function buildOccupancyPdf() {
  const cols = [50, 220, 340, 460, 560];
  const rows = [740, 714, 688, 662, 636];
  const data = [
    ['HOTEL', 'SGL', 'TWN', 'TRP'],
    ['Grand Palace Hotel', '9,500', '7,200', '6,800'],
    ['Riverside Inn', '7,000', '5,400', '5,100']
  ];
  const NL = '\n';
  let grid = '0.7 w' + NL;
  for (const y of rows.slice(0, data.length + 1)) grid += '50 ' + y + ' m 560 ' + y + ' l S' + NL;
  for (const x of cols) grid += x + ' 636 m ' + x + ' 740 l S' + NL;
  let text = '';
  data.forEach((row, r) => {
    row.forEach((cell, c) => {
      text += 'BT /F1 9 Tf ' + (cols[c] + 5) + ' ' + (rows[r] - 15) + ' Td (' + cell + ') Tj ET' + NL;
    });
  });
  const content = text + NL + grid;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 620 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    '<< /Length ' + content.length + ' >>' + NL + 'stream' + NL + content + NL + 'endstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let pdf = '%PDF-1.4' + NL;
  const offsets = [0];
  objects.forEach((body, i) => { offsets.push(pdf.length); pdf += (i + 1) + ' 0 obj' + NL + body + NL + 'endobj' + NL; });
  const xref = pdf.length;
  pdf += 'xref' + NL + '0 ' + (objects.length + 1) + NL + '0000000000 65535 f ' + NL;
  for (let i = 1; i <= objects.length; i += 1) pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n ' + NL;
  pdf += 'trailer' + NL + '<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>' + NL + 'startxref' + NL + xref + NL + '%%EOF';
  return Buffer.from(pdf, 'latin1');
}

// Occupancy row labels (one row per arrangement) + combined TWN/TRP column.
function buildOccupancyRowsPdf() {
  const cols = [50, 200, 330, 460, 560];
  const rows = [750, 724, 698, 672, 646, 620, 594];
  const data = [
    ['HOTEL', 'OCCUPANCY', '3D2N'],
    ['Grand Palace Hotel', 'SGL', '9,500'],
    ['', 'TWN', '7,200'],
    ['Sea View Resort', 'TWN/TRP', '6,900']
  ];
  const NL = '\n';
  let grid = '0.7 w' + NL;
  for (const y of rows.slice(0, 5)) grid += '50 ' + y + ' m 560 ' + y + ' l S' + NL;
  for (const x of cols) grid += x + ' 594 m ' + x + ' 750 l S' + NL;
  let text = '';
  data.forEach((row, r) => {
    row.forEach((cell, c) => {
      text += 'BT /F1 9 Tf ' + (cols[c] + 5) + ' ' + (rows[r] - 15) + ' Td (' + cell + ') Tj ET' + NL;
    });
  });
  const content = text + NL + grid;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 620 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    '<< /Length ' + content.length + ' >>' + NL + 'stream' + NL + content + NL + 'endstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let pdf = '%PDF-1.4' + NL;
  const offsets = [0];
  objects.forEach((body, i) => { offsets.push(pdf.length); pdf += (i + 1) + ' 0 obj' + NL + body + NL + 'endobj' + NL; });
  const xref = pdf.length;
  pdf += 'xref' + NL + '0 ' + (objects.length + 1) + NL + '0000000000 65535 f ' + NL;
  for (let i = 1; i <= objects.length; i += 1) pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n ' + NL;
  pdf += 'trailer' + NL + '<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>' + NL + 'startxref' + NL + xref + NL + '%%EOF';
  return Buffer.from(pdf, 'latin1');
}

test('tariff sheets produce only tariff facts: booking-memo noise is dropped and policy text becomes supplier conditions', async () => {
  const fixture = buildFixture();
  await withListening(fixture.server, async (base) => {
    const noisy = buildPdf([
      'HORIZON TRAVEL CORP SUPPLIER TARIFF 2026',
      'Supplier: Horizon Travel Corp',
      'Validity: April 1 - October 31, 2026',
      'Destination: Seoul',
      'Tour Fee: PHP 32,900 per person',
      'Optional services are non-refundable and need staff confirmation and contact name',
      'Airport Transfer (SIC) Guests staying in one room (TWN/TRP) must have the same flight arrival and flight',
      'Flight number 5J929 departure terminal 3',
      'Hotel name supplement $50/PAX weekend surcharge',
      'No. of pax: 20 minimum'
    ]);
    const upload = await action(base, {
      action: 'uploadSourceDocument',
      input: { adapter_key: 'GENERIC_PDF_TARIFF', supplier_id: 'SUPPLIER-TEST-000001', file_name: 'noisy-tariff.pdf', content_base64: noisy.toString('base64'), idempotency_key: 'TARIFF-NOISY-1' },
      actor: 'LOCAL_STAFF'
    });
    assert.equal(upload.ok, true, JSON.stringify(upload.error));
    const facts = fixture.runtime.list('TariffExtractionFact', (fact) => fact.tariff_source_id === upload.data.tariff_source_id);
    const names = facts.map((fact) => fact.field_name);

    // Booking-memo noise never becomes a tariff fact.
    for (const banned of ['flight_number', 'pax_count', 'passenger', 'contact_name', 'client', 'room_number', 'occupancy_count', 'activity', 'travel_start', 'travel_end', 'amount']) {
      assert.equal(names.includes(banned), false, banned + ' must not appear on a tariff');
    }
    // Policy sentences are not facts either.
    assert.equal(facts.some((fact) => /non-refundable/i.test(String(fact.normalized_value || ''))), false);
    assert.equal(facts.some((fact) => /5J929/i.test(String(fact.normalized_value || '') + String(fact.raw_value || ''))), false);
    assert.equal(facts.some((fact) => /50\/PAX/i.test(String(fact.normalized_value || '') + String(fact.raw_value || ''))), false);
    // What survives is tariff-relevant.
    assert.ok(names.includes('destination'));
    assert.ok(names.includes('rate_currency'));
    assert.ok(names.includes('validity_start'));

    // Policy text is preserved as reviewable supplier conditions.
    const itinerary = fixture.runtime.list('TariffItineraryComponent', (item) => item.tariff_source_id === upload.data.tariff_source_id);
    assert.ok(itinerary.some((item) => /non-refundable/i.test(String(item.text || ''))), 'non-refundable policy kept as a condition');
    assert.ok(itinerary.some((item) => /TWN\/TRP.*flight arrival/i.test(String(item.text || '').replace(/\s+/g, ' '))), 'transfer policy kept as a condition');
  });
});

test('occupancy-based rate tables: SGL/TWN/TRP columns, occupancy row labels, and combined TWN/TRP headers', async () => {
  const fixture = buildFixture();
  await withListening(fixture.server, async (base) => {
    // Matrix: 2 hotels × 3 occupancy columns.
    const matrixUpload = await action(base, {
      action: 'uploadSourceDocument',
      input: { adapter_key: 'GENERIC_PDF_TARIFF', supplier_id: 'SUPPLIER-TEST-000001', file_name: 'occupancy-matrix.pdf', content_base64: buildOccupancyPdf().toString('base64'), idempotency_key: 'TARIFF-OCC-1' },
      actor: 'LOCAL_STAFF'
    });
    assert.equal(matrixUpload.ok, true, JSON.stringify(matrixUpload.error));
    const matrixRates = fixture.runtime.list('TariffRateComponent', (rate) => rate.tariff_source_id === matrixUpload.data.tariff_source_id);
    assert.equal(matrixRates.length, 6);
    const find = (hotel, arrangement) => matrixRates.find((rate) => rate.conditions.hotel === hotel && rate.conditions.room_arrangement === arrangement);
    assert.equal(find('Grand Palace Hotel', 'SGL').amount, '9500.00');
    assert.equal(find('Grand Palace Hotel', 'TWN').amount, '7200.00');
    assert.equal(find('Riverside Inn', 'TRP').amount, '5100.00');

    // Rows keyed by occupancy (hotel carry-forward) + combined TWN/TRP column.
    const rowsUpload = await action(base, {
      action: 'uploadSourceDocument',
      input: { adapter_key: 'GENERIC_PDF_TARIFF', supplier_id: 'SUPPLIER-TEST-000001', file_name: 'occupancy-rows.pdf', content_base64: buildOccupancyRowsPdf().toString('base64'), idempotency_key: 'TARIFF-OCC-2' },
      actor: 'LOCAL_STAFF'
    });
    assert.equal(rowsUpload.ok, true, JSON.stringify(rowsUpload.error));
    const rowsRates = fixture.runtime.list('TariffRateComponent', (rate) => rate.tariff_source_id === rowsUpload.data.tariff_source_id);
    const grandSgl = rowsRates.find((rate) => rate.conditions.hotel === 'Grand Palace Hotel' && rate.conditions.room_arrangement === 'SGL');
    const grandTwn = rowsRates.find((rate) => rate.conditions.hotel === 'Grand Palace Hotel' && rate.conditions.room_arrangement === 'TWN');
    assert.ok(grandSgl, 'SGL row parsed with its arrangement');
    assert.equal(grandSgl.amount, '9500.00');
    assert.ok(grandTwn, 'occupancy-only row inherits the hotel above');
    assert.equal(grandTwn.amount, '7200.00');
    const combined = rowsRates.find((rate) => rate.conditions.hotel === 'Sea View Resort');
    assert.ok(combined, 'combined-occupancy row parsed');
    assert.equal(combined.conditions.room_arrangement, 'TWN/TRP', 'combined arrangement kept for staff to resolve');
    assert.equal(combined.conditions.duration, '3D2N');
    assert.equal(combined.amount, '6900.00');
  });
});

test('scanned PDFs without a text layer fail with a clear message and no tariff is created', async () => {
  const fixture = buildFixture();
  await withListening(fixture.server, async (base) => {
    const scanned = buildPdf([]); // valid PDF structure, no text operators
    const upload = await action(base, {
      action: 'uploadSourceDocument',
      input: { adapter_key: 'GENERIC_PDF_TARIFF', supplier_id: 'SUPPLIER-TEST-000001', file_name: 'scan.pdf', content_base64: scanned.toString('base64') },
      actor: 'LOCAL_STAFF'
    });
    assert.equal(upload.ok, false);
    assert.equal(upload.error.code, 'SOURCE_EXTRACTION_FAILED');
    assert.match(upload.error.message, /no extractable text layer|text PDF/i);
    assert.equal(fixture.runtime.list('TariffSource').length, 0);
  });
});

test('unknown adapters and non-PDF files are rejected before any record is written', async () => {
  const fixture = buildFixture();
  await withListening(fixture.server, async (base) => {
    const unknownAdapter = await action(base, { action: 'uploadSourceDocument', input: { adapter_key: 'NOPE', supplier_id: 'SUPPLIER-TEST-000001', file_name: 'x.pdf', content_base64: 'eA==' }, actor: 'LOCAL_STAFF' });
    assert.equal(unknownAdapter.ok, false);
    assert.equal(unknownAdapter.error.code, 'SOURCE_ADAPTER_UNAVAILABLE');
    const wrongType = await action(base, { action: 'uploadSourceDocument', input: { adapter_key: 'GENERIC_PDF_TARIFF', supplier_id: 'SUPPLIER-TEST-000001', file_name: 'rates.docx', content_base64: 'eA==' }, actor: 'LOCAL_STAFF' });
    assert.equal(wrongType.ok, false);
    assert.equal(wrongType.error.code, 'SOURCE_FORMAT_UNSUPPORTED');
    assert.equal(fixture.runtime.list('TariffSource').length, 0);
    assert.equal(fixture.runtime.list('Document').length, 0);
  });
});
