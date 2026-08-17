'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase, ensureEntityTables, SqliteRepository, SqliteAuditLog, SqliteIdGenerator } = require('../../src/server/sqlite-store');
const { createPhase1Runtime, ENTITY_DEFS } = require('../../src/phase1/runtime');
const { createPhase1Application } = require('../../src/application/phase1');
const { createPasteTariffUploadAdapter } = require('../../src/adapters/paste-tariff-upload-adapter');
const { createMvpServer } = require('../../app/server');

// The owner's actual pasted text from their OCR tool (representative slice:
// header + stacked duration line + tricky OCR rows + regions + policy).
const OWNER_PASTE = [
  'VALIDITY: 1 ST APRIL TO 31 st OCTOBER 2025 BANGKOK TRAVEL SERVICES #19 Angela Street, Barangay Maysilo , Malabon City, Philippines 1477',
  '*FREE AND EASY PACKAGES* PACKAGES 3 DAYS & 2 NIGHTS 4 DAYS & 3 NIGHTS EXTRA 1 NIGHT',
  'Includes Round - trip airport transfers and half day city tour ROOM TYPE SGL TWN/TRP SGL TWN/TRP SGL TWN/TRP',
  'ARCK HOTEL 4* (Formerly Hotel Vista Express ) DLX 150 75 212 106 75 75/106',
  'MY HOTEL 2* STD (FIT/GROUP) 112 56 164 82 56 56/82',
  'AMBASSADOR HOTEL 4* STD 196 98 276 13 8 98 98/13 8',
  'PICNIC HOTEL 3* STD (FIT/GROUP) 16 0 80 222 111 80 80/111',
  'AKARA BANGKOK 5* PRAROP (NO TRP) 276 138 396 198 140 140/198',
  'SUKHUMVIT AREA AIRA HOTEL (SUKHUMVIT 11) 4* DLX (NO TRP) 350 175 514 257 175 175/257',
  'SATHORN AREA FURAMAXCLUSIVE SATHORN DLX 206 103 310 155 103 103/155',
  'CHIANG MAI EMPRESS PREMIER CHIANG MAI PREMIER 370 185 540 270 185 185/270',
  'PATTAYA A - ONE NEW WING HOTEL DLX 274 137 362 181 137 137/181',
  '2. Airport Transfer (SIC) Guests who will be staying in one room (TWN/ TRP) must have the same flight arrival and flight Departure; otherwise, the other guest will not have free airport transfers.',
  '3. Children Policy : for Children below 4 yrs. old FREE of charge (CNB), Child 6 - 11 yrs. old below (CNB) - 10$/ABF , Child with EXTRA BED charge 50% of the adult rate.',
  '8. CANCELLATION POLICY - Cancellation should be at least 7 days before the arrival date. Otherwise, 1 night will be charged .',
  '9. HOTEL SURCHARGE - LOY KRATHONG (NOV TBA ), CHRISTMAS & NEW YEAR (24 DEC - 10 JAN), AND OTHER FESTIVAL'
].join('\n');

// A completely different supplier layout: interleaved header, four columns,
// PHP decimals, no regions — proves the parser is not BTS-shaped.
const OTHER_SUPPLIER_PASTE = [
  'SAPPHIRE TRAVEL AND TOURS — SUPPLIER RATES 2026 (ALL PRICES IN PHP PER PERSON)',
  'VALIDITY: JANUARY 15 TO DECEMBER 20, 2026',
  'HOTEL ROOM 2D1N SGL 2D1N TWN 3D2N SGL 3D2N TWN',
  'Crimson Hotel Filinvest Deluxe 1250.00 830.00 1900.00 1260.00',
  'Privato Hotel Quezon City Studio 990.00 660.00 1450.00 970.00',
  'Ace Hotel Primrose Plus Superior 1100.00 740.00 1600.00 1080.00'
].join('\n');

function buildFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmit-paste-'));
  const db = openDatabase(path.join(dir, 'wmit.sqlite3'));
  ensureEntityTables(db, ENTITY_DEFS);
  const runtime = createPhase1Runtime({
    clock: () => new Date('2026-08-20T08:00:00Z'),
    idGenerator: new SqliteIdGenerator(db),
    auditLog: new SqliteAuditLog(db),
    repositoryFactory: (type, repoOptions) => new SqliteRepository(db, type, repoOptions.idField),
    config: { trustedActors: {} }
  });
  const phase1App = createPhase1Application({
    runtime,
    seedSynthetic: false,
    sourceAdapters: { PASTE_TARIFF_TEXT: createPasteTariffUploadAdapter() }
  });
  runtime.createSupplier({ supplier_id: 'SUPPLIER-TEST-000001', display_name: 'Bangkok Travel Services', legal_name: 'Bangkok Travel Services' }, { actor: 'LOCAL_STAFF' });
  runtime.createSupplier({ supplier_id: 'SUPPLIER-TEST-000002', display_name: 'Sapphire Travel and Tours', legal_name: 'Sapphire Travel and Tours' }, { actor: 'LOCAL_STAFF' });
  const { server } = createMvpServer({ phase1App });
  return { dir, runtime, phase1App, server };
}

async function withListening(server, run) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try { return await run(base); } finally { await new Promise((resolve) => server.close(resolve)); }
}

async function paste(base, text, supplierId, key) {
  const response = await fetch(base + '/api/phase1/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'uploadSourceDocument',
      input: { adapter_key: 'PASTE_TARIFF_TEXT', supplier_id: supplierId, file_name: 'pasted-' + key + '.txt', mime_type: 'text/plain', content_base64: Buffer.from(text, 'utf8').toString('base64') },
      actor: 'LOCAL_STAFF'
    })
  });
  return await response.json();
}

test('the owner\'s pasted OCR text becomes a full BTS rate matrix with correctly mapped columns', async () => {
  const fixture = buildFixture();
  await withListening(fixture.server, async (base) => {
    const upload = await paste(base, OWNER_PASTE, 'SUPPLIER-TEST-000001', 'owner');
    assert.equal(upload.ok, true, JSON.stringify(upload.error));
    const tariffId = upload.data.tariff_source_id;
    const runtime = fixture.runtime;

    const tariff = runtime.get('TariffSource', tariffId);
    assert.match(tariff.extraction_summary.method, /PASTED_TEXT_MATRIX/);
    assert.equal(tariff.supplier_name, 'Bangkok Travel Services', 'supplier passed through from the console');
    assert.equal(tariff.trusted, false);

    const facts = runtime.list('TariffExtractionFact', (fact) => fact.tariff_source_id === tariffId);
    const factNames = facts.map((fact) => fact.field_name);
    assert.deepEqual(factNames.filter((name) => !['rate_currency', 'rate_unit'].includes(name)).sort(), ['validity_end', 'validity_start']);
    assert.equal(facts.find((fact) => fact.field_name === 'validity_start').normalized_value, '2025-04-01');
    assert.equal(facts.find((fact) => fact.field_name === 'validity_end').normalized_value, '2025-10-31');
    assert.equal(facts.find((fact) => fact.field_name === 'rate_currency').ambiguous, true, 'no currency marker in the numbers — gated');

    const rates = runtime.list('TariffRateComponent', (rate) => rate.tariff_source_id === tariffId);
    const find = (hotel, duration, arrangement) => rates.find((rate) => rate.conditions.hotel.startsWith(hotel) && rate.conditions.duration === duration && rate.conditions.room_arrangement === arrangement);

    // Straightforward cells.
    assert.equal(find('ARCK HOTEL', '3D2N', 'SGL').amount, '150.00');
    assert.equal(find('ARCK HOTEL', '4D3N', 'SGL').amount, '212.00');
    assert.equal(find('ARCK HOTEL', '4D3N', 'TWN/TRP').amount, '106.00', 'single number in a TWN/TRP column stays combined');
    // Extra-night slash cell splits into TWN and TRP.
    assert.equal(find('ARCK HOTEL', 'EXTRA-1N', 'TWN').amount, '75.00');
    assert.equal(find('ARCK HOTEL', 'EXTRA-1N', 'TRP').amount, '106.00');
    // OCR-split digits repaired: "13 8" → 138, "98/13 8" → 98/138, "16 0" → 160.
    assert.equal(find('AMBASSADOR HOTEL', '4D3N', 'TWN/TRP').amount, '138.00');
    assert.equal(find('AMBASSADOR HOTEL', 'EXTRA-1N', 'TRP').amount, '138.00');
    assert.equal(find('PICNIC HOTEL', '3D2N', 'SGL').amount, '160.00');
    // Regions carried onto conditions.
    assert.equal(find('AIRA HOTEL', '3D2N', 'SGL').conditions.region, 'SUKHUMVIT AREA');
    assert.equal(find('AIRA HOTEL', '3D2N', 'SGL').conditions.destination, 'Bangkok');
    assert.equal(find('EMPRESS PREMIER', '3D2N', 'SGL').conditions.destination, 'Chiang Mai');
    assert.equal(find('A - ONE NEW WING', '3D2N', 'SGL').conditions.destination, 'Pattaya');
    // Validity window stamped onto rates.
    assert.equal(find('ARCK HOTEL', '3D2N', 'SGL').conditions.travel_date_start, '2025-04-01');

    // Policy sentences become supplier conditions, not facts.
    const itinerary = runtime.list('TariffItineraryComponent', (item) => item.tariff_source_id === tariffId);
    assert.ok(itinerary.some((item) => /same flight arrival/i.test(String(item.text).replace(/\s+/g, ' '))), 'transfer TWN/TRP rule kept');
    assert.ok(itinerary.some((item) => /Children Policy|Children below/i.test(String(item.text))), 'child policy kept');
    assert.ok(itinerary.some((item) => /CANCELLATION POLICY|Cancellation should be/i.test(String(item.text))), 'cancellation policy kept');

    // Every rate stays review-gated.
    assert.equal(rates.every((rate) => rate.requires_explicit_review === true), true);
  });
});

test('a different supplier layout (interleaved header, PHP decimals, no regions) parses with the same generic parser', async () => {
  const fixture = buildFixture();
  await withListening(fixture.server, async (base) => {
    const upload = await paste(base, OTHER_SUPPLIER_PASTE, 'SUPPLIER-TEST-000002', 'sapphire');
    assert.equal(upload.ok, true, JSON.stringify(upload.error));
    const rates = fixture.runtime.list('TariffRateComponent', (rate) => rate.tariff_source_id === upload.data.tariff_source_id);
    assert.equal(rates.length, 12, '3 hotels × 4 columns');
    const find = (hotel, duration, arrangement) => rates.find((rate) => rate.conditions.hotel.startsWith(hotel) && rate.conditions.duration === duration && rate.conditions.room_arrangement === arrangement);
    assert.equal(find('Crimson Hotel', '2D1N', 'SGL').amount, '1250.00');
    assert.equal(find('Crimson Hotel', '3D2N', 'TWN').amount, '1260.00');
    assert.equal(find('Privato Hotel', '2D1N', 'TWN').amount, '660.00');
    assert.equal(find('Ace Hotel', '3D2N', 'SGL').amount, '1600.00');
    assert.equal(find('Crimson Hotel', '2D1N', 'SGL').conditions.room_type, 'Deluxe');
  });
});

test('pasted text without a table header falls back to the generic unstructured pipeline', async () => {
  const fixture = buildFixture();
  await withListening(fixture.server, async (base) => {
    const prose = 'Supplier: Random Tours\nValidity: March 1 to September 30, 2026\nDestination: Vigan\nTour Fee: PHP 9,800 per person';
    const upload = await paste(base, prose, 'SUPPLIER-TEST-000002', 'prose');
    assert.equal(upload.ok, true, JSON.stringify(upload.error));
    const tariffId = upload.data.tariff_source_id;
    const facts = fixture.runtime.list('TariffExtractionFact', (fact) => fact.tariff_source_id === tariffId);
    assert.ok(facts.some((fact) => fact.field_name === 'destination' && fact.normalized_value === 'Vigan'));
    assert.ok(facts.some((fact) => fact.field_name === 'rate_currency'));
    const rates = fixture.runtime.list('TariffRateComponent', (rate) => rate.tariff_source_id === tariffId);
    assert.equal(rates.length, 1, 'single labelled amount becomes one candidate rate');
  });
});
