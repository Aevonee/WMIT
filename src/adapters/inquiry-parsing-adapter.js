'use strict';

// Client-message AI parsing adapter.
//
// Optional accelerator for inquiry intake: staff paste a client's email or
// Viber text, a configured text model proposes structured trip requirements,
// and a human confirms by submitting the normal inquiry form. The parse is
// only ever a pre-fill draft — nothing is auto-created from it and the form
// is only saved when staff submit it.
//
// Configuration is environment-gated and the adapter is swappable:
//   INQUIRY_AI_PROVIDER = openai | gemini | openrouter | none   (default none)
//   INQUIRY_AI_API_KEY  = provider API key
//   INQUIRY_AI_MODEL    = model id (defaults: gpt-4o-mini / gemini-2.0-flash /
//                        stealth/ox-alpha on openrouter)
// With provider 'none' or a missing key the adapter reports
// PARSE_UNAVAILABLE and manual entry continues.
//
// Text-only chat request (no images), following the flyer adapter's auth
// headers, URLs, and response-parsing conventions. Outbound HTTPS uses the
// platform fetch (Node 22 built-in) or an injected fetchImpl for tests —
// zero npm dependencies.

const INQUIRY_PARSING_PROMPT = [
  'You are reading a client travel inquiry message (email or chat text).',
  'Extract the trip requirements as JSON. Return ONLY a JSON object, no prose, no markdown fences.',
  'Every field is optional: include a key only when the client states it, and never invent values.',
  'Schema (all fields optional):',
  '{',
  '  "destination": "city or country the client wants to visit",',
  '  "travel_start": "YYYY-MM-DD or null",',
  '  "travel_end": "YYYY-MM-DD or null",',
  '  "travel_month": "YYYY-MM or null",',
  '  "travel_year": 2027,',
  '  "duration_days": 5,',
  '  "adults": 2,',
  '  "children": 1,',
  '  "infants": 0,',
  '  "notes": "other stated requirements or preferences"',
  '}',
  'Dates must be ISO YYYY-MM-DD; an approximate month is YYYY-MM.',
  'Use exact dates when the client gives them, month/year when only approximate timing is stated — never both.'
].join('\n');

const PARSE_KEYS = ['destination', 'travel_start', 'travel_end', 'travel_month', 'travel_year', 'duration_days', 'adults', 'children', 'infants', 'notes'];

const DEFAULT_MODELS = { openai: 'gpt-4o-mini', gemini: 'gemini-2.0-flash', openrouter: 'stealth/ox-alpha' };

const MAX_TEXT_LENGTH = 8000;

function stripJsonFences(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced ? fenced[1] : raw).trim();
}

function parseJsonLoose(text) {
  const cleaned = stripJsonFences(text);
  try {
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    // Some models wrap the object in prose; grab the outermost braces.
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) { return null; }
  }
}

function sanitizeText(value, maxLength) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object') return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text || /^null$/i.test(text)) return null;
  return text.slice(0, maxLength);
}

function sanitizeIsoDate(value) {
  if (value === undefined || value === null || typeof value === 'object') return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(text + 'T00:00:00.000Z');
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? null : text;
}

function sanitizeMonth(value) {
  if (value === undefined || value === null || typeof value === 'object') return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}$/.test(text)) return null;
  const month = Number(text.slice(5, 7));
  return month >= 1 && month <= 12 ? text : null;
}

function sanitizeCount(value, min, max) {
  if (value === undefined || value === null || typeof value === 'object') return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}

// Model output is untrusted: every field is coerced defensively, nothing
// throws, and unreadable values are dropped with a note instead of failing.
function sanitizeParsedRequirements(raw) {
  const notes = [];
  const source = raw && typeof raw === 'object' ? raw : {};
  const fields = {};
  const destination = sanitizeText(source.destination, 120);
  if (destination) fields.destination = destination;
  const travelStart = sanitizeIsoDate(source.travel_start);
  if (travelStart) fields.travel_start = travelStart;
  const travelEnd = sanitizeIsoDate(source.travel_end);
  if (travelEnd) fields.travel_end = travelEnd;
  const travelMonth = sanitizeMonth(source.travel_month);
  if (travelMonth) fields.travel_month = travelMonth;
  const travelYear = sanitizeCount(source.travel_year, 2000, 2100);
  if (travelYear !== null) fields.travel_year = travelYear;
  const durationDays = sanitizeCount(source.duration_days, 0, 99);
  if (durationDays !== null) fields.duration_days = durationDays;
  const adults = sanitizeCount(source.adults, 0, 99);
  if (adults !== null) fields.adults = adults;
  const children = sanitizeCount(source.children, 0, 99);
  if (children !== null) fields.children = children;
  const infants = sanitizeCount(source.infants, 0, 99);
  if (infants !== null) fields.infants = infants;
  const requirementNotes = sanitizeText(source.notes, 500);
  if (requirementNotes) fields.notes = requirementNotes;
  const dropped = Object.keys(source).filter((key) => !PARSE_KEYS.includes(key));
  if (dropped.length) notes.push('Ignored unexpected field(s): ' + dropped.slice(0, 5).join(', ') + '.');
  return { fields, notes };
}

function openAiRequestBody(model, clientText) {
  return {
    model,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You extract structured travel requirements from client inquiry messages and answer with JSON only.' },
      { role: 'user', content: clientText }
    ]
  };
}

function geminiRequestBody(model, clientText) {
  return {
    model,
    contents: [{
      role: 'user',
      parts: [
        { text: INQUIRY_PARSING_PROMPT },
        { text: clientText }
      ]
    }],
    generationConfig: { response_mime_type: 'application/json' }
  };
}

function parseOpenAiContent(bodyText) {
  const parsed = parseJsonLoose(bodyText);
  if (!parsed) return null;
  const message = parsed.choices && parsed.choices[0] && parsed.choices[0].message;
  const content = message && message.content;
  if (typeof content === 'string') return parseJsonLoose(content);
  if (content && typeof content === 'object') return content;
  return null;
}

function parseGeminiContent(bodyText) {
  const parsed = parseJsonLoose(bodyText);
  if (!parsed) return null;
  const parts = parsed.candidates && parsed.candidates[0] && parsed.candidates[0].content && parsed.candidates[0].content.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts.map((part) => part && typeof part.text === 'string' ? part.text : '').join('');
  return parseJsonLoose(text);
}

function createInquiryParsingAdapter(options) {
  const opts = options || {};
  const readOption = (name, envName) => (opts[name] !== undefined && opts[name] !== null ? String(opts[name]) : (process.env[envName] || ''));
  const provider = readOption('provider', 'INQUIRY_AI_PROVIDER').trim().toLowerCase();
  const apiKey = readOption('apiKey', 'INQUIRY_AI_API_KEY').trim();
  const model = readOption('model', 'INQUIRY_AI_MODEL').trim() || DEFAULT_MODELS[provider] || '';
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const supported = provider === 'openai' || provider === 'gemini' || provider === 'openrouter';
  const configured = Boolean(supported && apiKey && typeof fetchImpl === 'function');
  const unavailabilityMessage = !supported
    ? 'AI inquiry parsing is disabled (INQUIRY_AI_PROVIDER is not openai, gemini, or openrouter). Fill the form manually from the client message.'
    : !apiKey
      ? 'AI inquiry parsing is not configured: INQUIRY_AI_API_KEY is missing. Fill the form manually from the client message.'
      : 'AI inquiry parsing is unavailable on this server. Fill the form manually from the client message.';

  return {
    provider: configured ? provider : 'none',
    model: configured ? model : null,
    available: configured,
    async extract(request) {
      if (!configured) {
        return { ok: false, code: 'PARSE_UNAVAILABLE', message: unavailabilityMessage };
      }
      const text = String(request && request.text || '').trim();
      if (!text) {
        return { ok: false, code: 'PARSE_UNAVAILABLE', message: 'Paste the client message text before parsing.' };
      }
      let requestSpec;
      if (provider === 'openai' || provider === 'openrouter') {
        // OpenRouter is OpenAI-compatible: same body shape and bearer auth.
        // X-Title attributes the traffic to WMIT in OpenRouter's dashboard.
        requestSpec = {
          url: provider === 'openrouter'
            ? 'https://openrouter.ai/api/v1/chat/completions'
            : 'https://api.openai.com/v1/chat/completions',
          headers: provider === 'openrouter'
            ? { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey, 'X-Title': 'WMIT inquiry intake' }
            : { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
          body: openAiRequestBody(model, text.slice(0, MAX_TEXT_LENGTH))
        };
      } else {
        requestSpec = {
          url: 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: geminiRequestBody(model, text.slice(0, MAX_TEXT_LENGTH))
        };
      }
      let responseText = '';
      try {
        const response = await fetchImpl(requestSpec.url, { method: 'POST', headers: requestSpec.headers, body: JSON.stringify(requestSpec.body) });
        responseText = await response.text();
        if (!response.ok) {
          return { ok: false, code: 'PARSE_UNAVAILABLE', message: 'The inquiry AI provider rejected the request (HTTP ' + response.status + '). No fields were parsed.' };
        }
      } catch (_) {
        return { ok: false, code: 'PARSE_UNAVAILABLE', message: 'The inquiry AI provider could not be reached. No fields were parsed.' };
      }
      const raw = provider === 'gemini' ? parseGeminiContent(responseText) : parseOpenAiContent(responseText);
      if (!raw) {
        return { ok: true, provider, model, fields: {}, notes: ['The model response could not be read as JSON — nothing was parsed. Fill the form manually from the client message.'] };
      }
      const { fields, notes } = sanitizeParsedRequirements(raw);
      return { ok: true, provider, model, fields, notes };
    }
  };
}

module.exports = { createInquiryParsingAdapter, sanitizeParsedRequirements, INQUIRY_PARSING_PROMPT };
