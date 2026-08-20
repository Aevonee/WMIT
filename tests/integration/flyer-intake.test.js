'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhase1Runtime } = require('../../src/phase1/runtime');
const { createPhase1Application } = require('../../src/application/phase1');
const { createMvpServer } = require('../../app/server');
const { createFlyerExtractionAdapter, sanitizeExtractedFields } = require('../../src/adapters/flyer-extraction-adapter');

const CLOCK = () => new Date('2026-08-21T09:00:00Z');
// A real 1x1 PNG file — the smallest honest image upload.
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const staff = () => ({ actor: 'staff', correlationId: 'FLYER-TEST' });

function makeRuntime(adapter) {
  return createPhase1Runtime({
    clock: CLOCK,
    config: { trustedActors: { staff: ['EDIT_DRAFT_PRICING'] } },
    flyerAdapter: adapter === undefined ? null : adapter
  });
}

function stubAdapter(fields, notes) {
  return {
    provider: 'openai',
    available: true,
    accepts: () => true,
    extract: async () => ({ ok: true, provider: 'openai', model: 'stub-vision', fields: fields || {}, notes: notes || [] })
  };
}

function openAiResponse(content) {
  return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content } }] }) };
}

function geminiResponse(text) {
  return { ok: true, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }) };
}

const FLYER_FIELDS = {
  name: 'Bangkok City Break 4D3N',
  destination: 'Bangkok',
  duration_days: 4,
  pax_basis: 'PER_PERSON',
  price_amount: '18500.00',
  currency: 'PHP',
  inclusions: ['Round-trip airfare', '3 nights hotel with breakfast'],
  exclusions: ['Travel tax'],
  itinerary_days: [
    { day: 1, title: 'Arrival', activities: 'Airport transfer', meals: 'Dinner', overnight: 'Bangkok Hotel' },
    { day: 2, title: 'Temples tour', activities: 'Wat Arun, Wat Pho' }
  ]
};

test('adapter reports EXTRACTION_UNAVAILABLE when unconfigured and never throws on garbage', async () => {
  const disabled = createFlyerExtractionAdapter({ provider: 'none' });
  assert.equal(disabled.available, false);
  const disabledResult = await disabled.extract({ image_base64: TINY_PNG_BASE64, mime_type: 'image/png' });
  assert.equal(disabledResult.ok, false);
  assert.equal(disabledResult.code, 'EXTRACTION_UNAVAILABLE');

  const noKey = createFlyerExtractionAdapter({ provider: 'openai' });
  assert.equal(noKey.available, false);
  assert.equal((await noKey.extract({ image_base64: TINY_PNG_BASE64, mime_type: 'image/png' })).code, 'EXTRACTION_UNAVAILABLE');

  const configured = createFlyerExtractionAdapter({ provider: 'openai', apiKey: 'test-key', model: 'test-model' });
  assert.equal(configured.available, true);
  assert.equal(configured.provider, 'openai');
  assert.equal(configured.model, 'test-model');
  const pdf = await configured.extract({ image_base64: 'x', mime_type: 'application/pdf' });
  assert.equal(pdf.ok, false, 'image-only adapter refuses PDFs');

  const badProvider = createFlyerExtractionAdapter({ provider: 'openai', apiKey: 'k', fetchImpl: async () => ({ ok: false, status: 429, text: async () => 'rate limited' }) });
  assert.equal((await badProvider.extract({ image_base64: TINY_PNG_BASE64, mime_type: 'image/png' })).code, 'EXTRACTION_UNAVAILABLE');
  const unreachable = createFlyerExtractionAdapter({ provider: 'gemini', apiKey: 'k', fetchImpl: async () => { throw new Error('network down'); } });
  assert.equal((await unreachable.extract({ image_base64: TINY_PNG_BASE64, mime_type: 'image/png' })).code, 'EXTRACTION_UNAVAILABLE');
});

test('adapter parses openai and gemini responses into sanitized draft fields', async () => {
  let captured;
  const openai = createFlyerExtractionAdapter({
    provider: 'openai', apiKey: 'test-key', model: 'test-model',
    fetchImpl: async (url, options) => {
      captured = { url, options: JSON.parse(options.body), auth: options.headers.Authorization };
      return openAiResponse(JSON.stringify(FLYER_FIELDS));
    }
  });
  const openaiResult = await openai.extract({ image_base64: TINY_PNG_BASE64, mime_type: 'image/png' });
  assert.equal(openaiResult.ok, true);
  assert.equal(openaiResult.provider, 'openai');
  assert.equal(openaiResult.model, 'test-model');
  assert.equal(openaiResult.fields.name, 'Bangkok City Break 4D3N');
  assert.equal(openaiResult.fields.price_amount, '18500.00');
  assert.equal(openaiResult.fields.itinerary_days.length, 2);
  assert.equal(captured.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(captured.auth, 'Bearer test-key');
  assert.equal(captured.options.model, 'test-model');
  assert.ok(captured.options.messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === 'image_url')));

  const gemini = createFlyerExtractionAdapter({
    provider: 'gemini', apiKey: 'gem-key', model: 'gem-test',
    fetchImpl: async (url, options) => {
      captured = { url, key: options.headers['x-goog-api-key'], body: JSON.parse(options.body) };
      return geminiResponse('```json\n' + JSON.stringify(FLYER_FIELDS) + '\n```');
    }
  });
  const geminiResult = await gemini.extract({ image_base64: TINY_PNG_BASE64, mime_type: 'image/png' });
  assert.equal(geminiResult.ok, true);
  assert.equal(geminiResult.fields.destination, 'Bangkok');
  assert.ok(captured.url.indexOf('gem-test:generateContent') !== -1);
  assert.equal(captured.key, 'gem-key');
  assert.equal(captured.body.contents[0].parts[1].inline_data.mime_type, 'image/png');

  const garbage = createFlyerExtractionAdapter({ provider: 'openai', apiKey: 'k', fetchImpl: async () => openAiResponse('total garbage, not json') });
  const garbageResult = await garbage.extract({ image_base64: TINY_PNG_BASE64, mime_type: 'image/png' });
  assert.equal(garbageResult.ok, true, 'garbage never throws');
  assert.deepEqual(garbageResult.fields, {});
  assert.ok(garbageResult.notes.length, 'a note explains the empty draft');

  const partial = await Promise.resolve(createFlyerExtractionAdapter({
    provider: 'openai', apiKey: 'k', fetchImpl: async () => openAiResponse(JSON.stringify({ name: 'Only A Name', price_amount: '12,345.60 PHP', duration_days: 'four', itinerary_days: [{ day: 1, title: 'Day one' }, 'plain string day'], mystery: 'drop me' }))
  }).extract({ image_base64: TINY_PNG_BASE64, mime_type: 'image/png' }));
  assert.equal(partial.fields.name, 'Only A Name');
  assert.equal(partial.fields.price_amount, '12345.60');
  assert.equal(partial.fields.duration_days, undefined, 'non-numeric duration dropped');
  assert.equal(partial.fields.itinerary_days.length, 2);
  assert.equal(partial.fields.itinerary_days[1].title, 'plain string day');
  assert.ok(partial.notes.some((note) => note.indexOf('mystery') !== -1), 'unexpected fields noted');
});

test('sanitizeExtractedFields coerces untrusted model output defensively', () => {
  const sanitized = sanitizeExtractedFields({
    name: 12345,
    destination: null,
    travel_start: '2026-09-04',
    travel_end: 'not-a-date',
    price_amount: { nested: 'object' },
    currency: 'peso',
    pax_basis: 'per person',
    inclusions: [' ok ', '', null, 42],
    exclusions: 'Single string exclusion'
  });
  assert.equal(sanitized.fields.name, '12345');
  assert.equal(sanitized.fields.destination, undefined);
  assert.equal(sanitized.fields.travel_start, '2026-09-04');
  assert.equal(sanitized.fields.travel_end, undefined);
  assert.equal(sanitized.fields.price_amount, undefined);
  assert.equal(sanitized.fields.currency, undefined);
  assert.equal(sanitized.fields.pax_basis, 'PER_PERSON');
  assert.deepEqual(sanitized.fields.inclusions, ['ok', '42']);
  assert.deepEqual(sanitized.fields.exclusions, ['Single string exclusion']);
  assert.deepEqual(sanitizeExtractedFields('not-an-object').fields, {});
  assert.deepEqual(sanitizeExtractedFields(null).fields, {});
});

test('uploadFlyer registers a WHOLESALER_FLYER document and returns an image reference', () => {
  const runtime = makeRuntime();
  runtime.createSupplier({ supplier_id: 'SUPPLIER-000001', display_name: 'Flyer Supplier', legal_name: 'FS' }, staff());
  const uploaded = runtime.uploadFlyer({ file_name: 'bangkok-flyer.png', mime_type: 'image/png', content_base64: TINY_PNG_BASE64, supplier_id: 'SUPPLIER-000001' }, staff());
  assert.equal(uploaded.ok, true);
  assert.equal(uploaded.meta.action, 'UPLOAD_FLYER');
  assert.match(uploaded.data.document_id, /^DOCUMENT-2026-\d{6}$/);
  assert.equal(uploaded.data.mime_type, 'image/png');
  assert.equal(uploaded.data.image_url, 'data:image/png;base64,' + TINY_PNG_BASE64);
  const document = runtime.get('Document', uploaded.data.document_id);
  assert.equal(document.source_type, 'WHOLESALER_FLYER');
  assert.equal(document.document_type, 'WHOLESALER_FLYER');
  assert.equal(document.status, 'RECEIVED');
  assert.equal(document.review_status, 'NEEDS_REVIEW');
  assert.equal(document.supplier_id, 'SUPPLIER-000001');
  assert.equal(document.file_size, Buffer.from(TINY_PNG_BASE64, 'base64').length);
  assert.ok(document.checksum);
  assert.ok(runtime.auditLog.list().some((entry) => entry.action === 'UPLOAD_FLYER' && entry.result === 'SUCCESS'));

  const pdf = runtime.uploadFlyer({ file_name: 'vendor.pdf', mime_type: 'application/pdf', content_base64: Buffer.from('%PDF-1.4 minimal').toString('base64') }, staff());
  assert.equal(pdf.ok, true);
  assert.equal(pdf.data.image_url, null, 'PDFs have no data URL preview');

  const cases = [
    [{ mime_type: 'image/png', content_base64: TINY_PNG_BASE64 }, 'REQUIRED_FIELD'],
    [{ file_name: 'x.png', content_base64: TINY_PNG_BASE64 }, 'FLYER_FORMAT_UNSUPPORTED'],
    [{ file_name: 'x.png', mime_type: 'image/png', content_base64: '' }, 'REQUIRED_FIELD'],
    [{ file_name: 'x.exe', mime_type: 'application/octet-stream', content_base64: TINY_PNG_BASE64 }, 'FLYER_FORMAT_UNSUPPORTED'],
    [{ file_name: 'x.png', mime_type: 'image/png', content_base64: TINY_PNG_BASE64, supplier_id: 'SUPPLIER-9999' }, 'NOT_FOUND']
  ];
  cases.forEach(([input, code]) => {
    const result = runtime.uploadFlyer(input, staff());
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.equal(result.error.code, code);
  });
  const oversize = runtime.uploadFlyer({ file_name: 'big.png', mime_type: 'image/png', content_base64: Buffer.alloc(700 * 1024 + 1, 1).toString('base64') }, staff());
  assert.equal(oversize.ok, false);
  assert.equal(oversize.error.code, 'FILE_TOO_LARGE');
  assert.ok(runtime.auditLog.list().some((entry) => entry.action === 'UPLOAD_FLYER' && entry.result === 'FAILURE'));
});

test('extractFlyerDraft without an adapter returns EXTRACTION_UNAVAILABLE cleanly and creates nothing', async () => {
  const runtime = makeRuntime();
  const uploaded = runtime.uploadFlyer({ file_name: 'f.png', mime_type: 'image/png', content_base64: TINY_PNG_BASE64 }, staff());
  const result = await runtime.extractFlyerDraft({ document_id: uploaded.data.document_id }, staff());
  assert.equal(result.ok, true, 'unavailability is a clean result, not a crash');
  assert.equal(result.data.extraction_available, false);
  assert.equal(result.data.reason_code, 'EXTRACTION_UNAVAILABLE');
  assert.equal(result.data.fields !== undefined, true);
  assert.equal(result.data.image_url, 'data:image/png;base64,' + TINY_PNG_BASE64, 'the image still shows for manual verification');
  assert.equal(runtime.list('SupplierPackage').length, 0, 'no package is ever auto-created');
  const document = runtime.get('Document', uploaded.data.document_id);
  assert.equal(document.extraction_draft, undefined, 'nothing is stored without a real extraction');
  assert.ok(runtime.auditLog.list().some((entry) => entry.action === 'EXTRACT_FLYER_DRAFT' && entry.result === 'SUCCESS' && entry.details.available === false));
});

test('extractFlyerDraft refuses non-flyer documents before the adapter is ever called', async () => {
  let adapterCalls = 0;
  const runtime = makeRuntime({ extract: async () => { adapterCalls += 1; return { ok: true, fields: { name: 'leaked' } }; }, provider: 'stub', available: true });
  const identityDocument = runtime.createDocument({ file_name: 'passport.pdf', mime_type: 'application/pdf', source_type: 'CLIENT_IDENTITY', status: 'RECEIVED' }, staff());
  const refused = await runtime.extractFlyerDraft({ document_id: identityDocument.data.document_id }, staff());
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, 'FLYER_SOURCE_REQUIRED');
  assert.equal(adapterCalls, 0, 'client documents never reach the external API');

  const tariffDocument = runtime.createDocument({ file_name: 'rates.docx', mime_type: 'application/pdf', source_type: 'SUPPLIER' }, staff());
  assert.equal((await runtime.extractFlyerDraft({ document_id: tariffDocument.data.document_id }, staff())).error.code, 'FLYER_SOURCE_REQUIRED');
  assert.equal((await runtime.extractFlyerDraft({ document_id: 'DOCUMENT-2026-999999' }, staff())).error.code, 'NOT_FOUND');
  assert.equal((await runtime.extractFlyerDraft({}, staff())).error.code, 'REQUIRED_FIELD');
  assert.equal(adapterCalls, 0);
  assert.ok(runtime.auditLog.list().some((entry) => entry.action === 'EXTRACT_FLYER_DRAFT' && entry.result === 'FAILURE' && entry.details.error_code === 'FLYER_SOURCE_REQUIRED'));
});

test('extractFlyerDraft stores the adapter draft on the flyer document for side-by-side verification', async () => {
  const runtime = makeRuntime(stubAdapter(FLYER_FIELDS, ['Price confidence: low']));
  const uploaded = runtime.uploadFlyer({ file_name: 'bangkok.png', mime_type: 'image/png', content_base64: TINY_PNG_BASE64 }, staff());
  const result = await runtime.extractFlyerDraft({ document_id: uploaded.data.document_id }, staff());
  assert.equal(result.ok, true);
  assert.equal(result.data.extraction_available, true);
  assert.equal(result.data.provider, 'openai');
  assert.equal(result.data.fields.name, 'Bangkok City Break 4D3N');
  assert.equal(result.data.fields.itinerary_days.length, 2);
  assert.deepEqual(result.data.notes, ['Price confidence: low']);
  assert.equal(result.data.image_url.indexOf('data:image/png;base64,'), 0);
  const document = runtime.get('Document', uploaded.data.document_id);
  assert.equal(document.extraction_status, 'EXTRACTED_DRAFT');
  assert.equal(document.extraction_draft.fields.destination, 'Bangkok');
  assert.equal(document.extraction_draft.provider, 'openai');
  assert.equal(runtime.list('SupplierPackage').length, 0, 'extraction still proposes only — no package record');
  assert.ok(runtime.auditLog.list().some((entry) => entry.action === 'EXTRACT_FLYER_DRAFT' && entry.result === 'SUCCESS' && entry.details.available === true && entry.details.stored === true));

  // An adapter that throws degrades to the manual path instead of failing.
  const throwing = makeRuntime({ extract: async () => { throw new Error('provider exploded'); } });
  const uploaded2 = throwing.uploadFlyer({ file_name: 'f.png', mime_type: 'image/png', content_base64: TINY_PNG_BASE64 }, staff());
  const degraded = await throwing.extractFlyerDraft({ document_id: uploaded2.data.document_id }, staff());
  assert.equal(degraded.ok, true);
  assert.equal(degraded.data.extraction_available, false);
  assert.ok(degraded.data.message.indexOf('exploded') !== -1);
});

test('the flyer intake chain works over HTTP: upload, extract, confirm package, quote it', async () => {
  const runtime = makeRuntime(stubAdapter(FLYER_FIELDS));
  runtime.createSupplier({ supplier_id: 'SUPPLIER-000001', display_name: 'HTTP Flyer Supplier', legal_name: 'HFS' }, staff());
  const phase1App = createPhase1Application({ runtime, seedSynthetic: false });
  const { server } = createMvpServer({ phase1App });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = async (body) => {
    const response = await fetch(base + '/api/phase1/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const uploaded = await post({ action: 'uploadFlyer', input: { file_name: 'expo-flyer.png', mime_type: 'image/png', content_base64: TINY_PNG_BASE64, supplier_id: 'SUPPLIER-000001' }, actor: 'staff' });
    assert.equal(uploaded.status, 200);
    const documentId = uploaded.body.data.document_id;

    const extracted = await post({ action: 'extractFlyerDraft', input: { document_id: documentId }, actor: 'staff' });
    assert.equal(extracted.status, 200);
    assert.equal(extracted.body.data.extraction_available, true);
    assert.equal(extracted.body.data.fields.name, 'Bangkok City Break 4D3N');

    // Human verifies the prefilled form and confirms — the package cites the flyer.
    const created = await post({ action: 'createPackage', input: {
      supplier_id: 'SUPPLIER-000001',
      name: extracted.body.data.fields.name,
      destination: extracted.body.data.fields.destination,
      price_amount: extracted.body.data.fields.price_amount,
      currency: extracted.body.data.fields.currency,
      pax_basis: 'PER_PERSON',
      duration_days: extracted.body.data.fields.duration_days,
      inclusions: extracted.body.data.fields.inclusions,
      exclusions: extracted.body.data.fields.exclusions,
      itinerary_days: extracted.body.data.fields.itinerary_days,
      source: 'FLYER_IMPORT',
      source_document_id: documentId
    }, actor: 'staff' });
    assert.equal(created.status, 200);
    assert.equal(created.body.data.source, 'FLYER_IMPORT');
    assert.equal(created.body.data.source_document_id, documentId);
    assert.equal(created.body.data.status, 'DRAFT');

    const confirmed = await post({ action: 'confirmPackage', input: { supplier_package_id: created.body.data.supplier_package_id }, actor: 'staff' });
    assert.equal(confirmed.status, 200);

    const client = runtime.createClient({ display_name: 'HTTP Flyer Client', primary_email: 'flyer@example.test' }, staff()).data;
    const inquiry = runtime.createInquiry({ client_id: client.client_id, requirements: { destination: 'Bangkok', travel_start: '2026-09-04', travel_end: '2026-09-07', pax_count: 2 } }, staff()).data;
    const quoted = await post({ action: 'createQuotationFromPackage', input: { package_id: created.body.data.supplier_package_id, client_id: client.client_id, inquiry_id: inquiry.inquiry_id }, actor: 'staff' });
    assert.equal(quoted.status, 200);
    assert.equal(quoted.body.data.quotation.destination, 'Bangkok');
    assert.equal(quoted.body.data.item.quantity, 2);
    assert.equal(quoted.body.data.item.unit_selling_price, '18500.00');
    assert.equal(quoted.body.data.quotation.client_total, '37000.00');

    // A FLYER_IMPORT package can never cite a non-flyer document.
    const identity = runtime.createDocument({ file_name: 'id.pdf', mime_type: 'application/pdf', source_type: 'CLIENT_IDENTITY' }, staff());
    const badSource = await post({ action: 'createPackage', input: { supplier_id: 'SUPPLIER-000001', name: 'Bad', destination: 'X', price_amount: '1.00', source: 'FLYER_IMPORT', source_document_id: identity.data.document_id }, actor: 'staff' });
    assert.equal(badSource.status, 400);
    assert.equal(badSource.body.error.code, 'FLYER_SOURCE_REQUIRED');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
