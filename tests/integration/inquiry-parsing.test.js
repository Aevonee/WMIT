'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhase1Runtime } = require('../../src/phase1/runtime');
const { createPhase1Application } = require('../../src/application/phase1');
const { createMvpServer } = require('../../app/server');
const { createInquiryParsingAdapter, sanitizeParsedRequirements } = require('../../src/adapters/inquiry-parsing-adapter');

const CLOCK = () => new Date('2026-08-21T09:00:00Z');
const CLIENT_MESSAGE = 'Hi! We are 2 adults and 1 child (age 7) planning to visit Osaka around 2026-11-10 to 2026-11-16. Prefer hotels near the station. Budget is mid-range.';

const staff = () => ({ actor: 'staff', correlationId: 'INQUIRY-PARSE-TEST' });

function makeRuntime(adapter) {
  return createPhase1Runtime({
    clock: CLOCK,
    config: { trustedActors: { staff: ['EDIT_DRAFT_PRICING'] } },
    inquiryAdapter: adapter === undefined ? null : adapter
  });
}

function stubAdapter(fields, notes) {
  return {
    provider: 'openai',
    model: 'stub-text',
    available: true,
    extract: async () => ({ ok: true, provider: 'openai', model: 'stub-text', fields: fields || {}, notes: notes || [] })
  };
}

function openAiResponse(content) {
  return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content } }] }) };
}

function geminiResponse(text) {
  return { ok: true, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }) };
}

const PARSED_FIELDS = {
  destination: 'Osaka',
  travel_start: '2026-11-10',
  travel_end: '2026-11-16',
  duration_days: 6,
  adults: 2,
  children: 1,
  notes: 'Prefer hotels near the station. Budget is mid-range.'
};

test('adapter reports PARSE_UNAVAILABLE when unconfigured and never throws on garbage', async () => {
  const disabled = createInquiryParsingAdapter({ provider: 'none' });
  assert.equal(disabled.available, false);
  const disabledResult = await disabled.extract({ text: CLIENT_MESSAGE });
  assert.equal(disabledResult.ok, false);
  assert.equal(disabledResult.code, 'PARSE_UNAVAILABLE');

  const noKey = createInquiryParsingAdapter({ provider: 'openai' });
  assert.equal(noKey.available, false);
  assert.equal((await noKey.extract({ text: CLIENT_MESSAGE })).code, 'PARSE_UNAVAILABLE');

  const configured = createInquiryParsingAdapter({ provider: 'openai', apiKey: 'test-key', model: 'test-model' });
  assert.equal(configured.available, true);
  assert.equal(configured.provider, 'openai');
  assert.equal(configured.model, 'test-model');
  const empty = await configured.extract({ text: '   ' });
  assert.equal(empty.ok, false, 'empty text is refused');

  const rejected = createInquiryParsingAdapter({ provider: 'openai', apiKey: 'k', fetchImpl: async () => ({ ok: false, status: 429, text: async () => 'rate limited' }) });
  assert.equal((await rejected.extract({ text: CLIENT_MESSAGE })).code, 'PARSE_UNAVAILABLE');
  const unreachable = createInquiryParsingAdapter({ provider: 'gemini', apiKey: 'k', fetchImpl: async () => { throw new Error('network down'); } });
  assert.equal((await unreachable.extract({ text: CLIENT_MESSAGE })).code, 'PARSE_UNAVAILABLE');

  const openrouterDefault = createInquiryParsingAdapter({ provider: 'openrouter', apiKey: 'or-key' });
  assert.equal(openrouterDefault.available, true);
  assert.equal(openrouterDefault.model, 'stealth/ox-alpha', 'owner-picked default');
});

test('adapter sends text-only requests per provider and parses sanitized fields', async () => {
  let captured;
  const openai = createInquiryParsingAdapter({
    provider: 'openai', apiKey: 'test-key', model: 'test-model',
    fetchImpl: async (url, options) => {
      captured = { url, options: JSON.parse(options.body), auth: options.headers.Authorization };
      return openAiResponse(JSON.stringify(PARSED_FIELDS));
    }
  });
  const openaiResult = await openai.extract({ text: CLIENT_MESSAGE });
  assert.equal(openaiResult.ok, true);
  assert.equal(openaiResult.provider, 'openai');
  assert.equal(openaiResult.model, 'test-model');
  assert.equal(openaiResult.fields.destination, 'Osaka');
  assert.equal(openaiResult.fields.travel_start, '2026-11-10');
  assert.equal(captured.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(captured.auth, 'Bearer test-key');
  assert.equal(captured.options.model, 'test-model');
  assert.ok(captured.options.messages.some((message) => typeof message.content === 'string' && message.content.includes('Osaka')), 'client text reaches the model');
  assert.ok(!JSON.stringify(captured.options).includes('image_url'), 'text-only request — no image parts');

  const gemini = createInquiryParsingAdapter({
    provider: 'gemini', apiKey: 'gem-key', model: 'gem-test',
    fetchImpl: async (url, options) => {
      captured = { url, key: options.headers['x-goog-api-key'], body: JSON.parse(options.body) };
      return geminiResponse('```json\n' + JSON.stringify(PARSED_FIELDS) + '\n```');
    }
  });
  const geminiResult = await gemini.extract({ text: CLIENT_MESSAGE });
  assert.equal(geminiResult.ok, true);
  assert.equal(geminiResult.fields.destination, 'Osaka');
  assert.ok(captured.url.indexOf('gem-test:generateContent') !== -1);
  assert.equal(captured.key, 'gem-key');
  assert.ok(captured.body.contents[0].parts.some((part) => part.text.includes('Osaka')), 'client text reaches the model');
  assert.equal(captured.body.generationConfig.response_mime_type, 'application/json');

  const openrouter = createInquiryParsingAdapter({
    provider: 'openrouter', apiKey: 'or-key', model: 'stealth/ox-alpha',
    fetchImpl: async (url, options) => {
      captured = { url, auth: options.headers.Authorization, title: options.headers['X-Title'], body: JSON.parse(options.body) };
      return openAiResponse(JSON.stringify(PARSED_FIELDS));
    }
  });
  const openrouterResult = await openrouter.extract({ text: CLIENT_MESSAGE });
  assert.equal(openrouterResult.ok, true);
  assert.equal(openrouterResult.provider, 'openrouter');
  assert.equal(captured.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(captured.auth, 'Bearer or-key');
  assert.equal(captured.title, 'WMIT inquiry intake');
  assert.ok(captured.body.messages.some((message) => typeof message.content === 'string' && message.content.includes('Osaka')));

  const garbage = createInquiryParsingAdapter({ provider: 'openai', apiKey: 'k', fetchImpl: async () => openAiResponse('total garbage, not json') });
  const garbageResult = await garbage.extract({ text: CLIENT_MESSAGE });
  assert.equal(garbageResult.ok, true, 'garbage never throws');
  assert.deepEqual(garbageResult.fields, {});
  assert.ok(garbageResult.notes.length, 'a note explains the empty parse');
});

test('sanitizeParsedRequirements coerces untrusted model output defensively', () => {
  const sanitized = sanitizeParsedRequirements({
    destination: 'x'.repeat(300),
    travel_start: 'not-a-date',
    travel_end: '2026-11-16',
    travel_month: '13/2026',
    travel_year: 'twenty twenty-seven',
    duration_days: 4.5,
    adults: -2,
    children: 'three',
    infants: 1,
    notes: 42,
    mystery: 'drop me'
  });
  assert.equal(sanitized.fields.destination.length, 120, 'destination clamped');
  assert.equal(sanitized.fields.travel_start, undefined, 'bad date dropped');
  assert.equal(sanitized.fields.travel_end, '2026-11-16');
  assert.equal(sanitized.fields.travel_month, undefined, 'non-YYYY-MM month dropped');
  assert.equal(sanitized.fields.travel_year, undefined, 'non-numeric year dropped');
  assert.equal(sanitized.fields.duration_days, undefined, 'non-integer duration dropped');
  assert.equal(sanitized.fields.adults, undefined, 'negative adults dropped');
  assert.equal(sanitized.fields.children, undefined, 'non-numeric children dropped');
  assert.equal(sanitized.fields.infants, 1);
  assert.equal(sanitized.fields.notes, '42', 'numbers coerced to text');
  assert.ok(sanitized.notes.some((note) => note.indexOf('mystery') !== -1), 'unexpected fields noted');
  assert.equal(sanitizeParsedRequirements({ travel_month: '2026-11', travel_year: 2027 }).fields.travel_month, '2026-11');
  assert.deepEqual(sanitizeParsedRequirements('not-an-object').fields, {});
  assert.deepEqual(sanitizeParsedRequirements(null).fields, {});
});

test('parseInquiryMessage without an adapter returns PARSE_UNAVAILABLE cleanly and writes nothing', async () => {
  const runtime = makeRuntime();
  const result = await runtime.parseInquiryMessage({ text: CLIENT_MESSAGE }, staff());
  assert.equal(result.ok, true, 'unavailability is a clean result, not a crash');
  assert.equal(result.data.parse_available, false);
  assert.equal(result.data.reason_code, 'PARSE_UNAVAILABLE');
  assert.equal(result.data.provider, 'none');
  assert.deepEqual(result.data.fields, {});
  assert.ok(result.data.message, 'a human-oriented message is present');
  assert.equal(runtime.list('Inquiry').length, 0, 'no inquiry is ever auto-created');
  assert.equal(runtime.auditLog.list().filter((entry) => entry.action === 'PARSE_INQUIRY_MESSAGE').length, 0, 'pure read — no audit entries');

  const missing = await runtime.parseInquiryMessage({}, staff());
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'REQUIRED_FIELD');

  const tooLong = await runtime.parseInquiryMessage({ text: 'x'.repeat(8001) }, staff());
  assert.equal(tooLong.ok, false);
  assert.equal(tooLong.error.code, 'TEXT_TOO_LONG');
  assert.equal(runtime.auditLog.list().filter((entry) => entry.action === 'PARSE_INQUIRY_MESSAGE').length, 0, 'failures are not audited either');
});

test('parseInquiryMessage returns sanitized fields from the adapter and never writes', async () => {
  const runtime = makeRuntime(stubAdapter(PARSED_FIELDS, ['Pax confidence: high']));
  const result = await runtime.parseInquiryMessage({ text: CLIENT_MESSAGE }, staff());
  assert.equal(result.ok, true);
  assert.equal(result.data.parse_available, true);
  assert.equal(result.data.reason_code, null);
  assert.equal(result.data.provider, 'openai');
  assert.equal(result.data.model, 'stub-text');
  assert.equal(result.data.fields.destination, 'Osaka');
  assert.equal(result.data.fields.adults, 2);
  assert.deepEqual(result.data.notes, ['Pax confidence: high']);
  assert.equal(runtime.list('Inquiry').length, 0, 'the human still submits the inquiry form');
  assert.equal(runtime.auditLog.list().filter((entry) => entry.action === 'PARSE_INQUIRY_MESSAGE').length, 0);

  // An adapter that throws degrades to the manual path instead of failing.
  const throwing = makeRuntime({ extract: async () => { throw new Error('provider exploded'); } });
  const degraded = await throwing.parseInquiryMessage({ text: CLIENT_MESSAGE }, staff());
  assert.equal(degraded.ok, true);
  assert.equal(degraded.data.parse_available, false);
  assert.equal(degraded.data.reason_code, 'PARSE_UNAVAILABLE');
  assert.ok(degraded.data.message.indexOf('exploded') !== -1);

  // An adapter returning ok:false surfaces its message.
  const unavailable = makeRuntime({ extract: async () => ({ ok: false, code: 'PARSE_UNAVAILABLE', message: 'No key configured.' }) });
  const unavailableResult = await unavailable.parseInquiryMessage({ text: CLIENT_MESSAGE }, staff());
  assert.equal(unavailableResult.ok, true);
  assert.equal(unavailableResult.data.reason_code, 'PARSE_UNAVAILABLE');
  assert.ok(unavailableResult.data.message.indexOf('No key configured') !== -1);
});

test('the inquiry parse works over HTTP through the whitelisted dispatcher', async () => {
  const runtime = makeRuntime(stubAdapter(PARSED_FIELDS));
  const phase1App = createPhase1Application({ runtime, seedSynthetic: false });
  const { server } = createMvpServer({ phase1App });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = async (body) => {
    const response = await fetch(base + '/api/phase1/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const parsed = await post({ action: 'parseInquiryMessage', input: { text: CLIENT_MESSAGE }, actor: 'staff' });
    assert.equal(parsed.status, 200);
    assert.equal(parsed.body.ok, true);
    assert.equal(parsed.body.data.parse_available, true);
    assert.equal(parsed.body.data.fields.destination, 'Osaka');
    assert.equal(runtime.list('Inquiry').length, 0, 'nothing auto-created over HTTP either');

    const tooLong = await post({ action: 'parseInquiryMessage', input: { text: 'x'.repeat(8001) }, actor: 'staff' });
    assert.equal(tooLong.status, 400);
    assert.equal(tooLong.body.error.code, 'TEXT_TOO_LONG');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
