'use strict';

// Wholesaler-flyer AI extraction adapter.
//
// Optional accelerator for package intake: sends a flyer IMAGE to a
// configured vision model (OpenAI or Gemini) with a fixed extraction prompt
// and returns a defensive draft-fields object. The draft is only ever a
// proposal — a human verifies it against the flyer image side-by-side and
// confirms the package record; nothing is auto-created from extraction.
//
// Configuration is environment-gated and the adapter is swappable:
//   FLYER_AI_PROVIDER = openai | gemini | none   (default none)
//   FLYER_AI_API_KEY  = provider API key
//   FLYER_AI_MODEL    = model id (defaults: gpt-4o-mini / gemini-2.0-flash)
// With provider 'none' or a missing key the adapter reports
// EXTRACTION_UNAVAILABLE and the manual quick-entry path continues.
//
// HARD RULE: only wholesaler flyer documents reach this adapter. The runtime
// action (extractFlyerDraft) validates Document.source_type ===
// 'WHOLESALER_FLYER' before calling extract; client personal documents never
// leave the system. Outbound HTTPS uses the platform fetch (Node 22 built-in)
// or an injected fetchImpl for tests — zero npm dependencies.

const FLYER_EXTRACTION_PROMPT = [
  'You are reading a travel wholesaler promotional flyer image.',
  'Extract the package details as JSON. Return ONLY a JSON object, no prose, no markdown fences.',
  'Every field is optional: omit any value you cannot read confidently from the flyer.',
  'Schema (all fields optional):',
  '{',
  '  "name": "package or tour name as printed",',
  '  "destination": "city or country",',
  '  "travel_start": "YYYY-MM-DD or null",',
  '  "travel_end": "YYYY-MM-DD or null",',
  '  "duration_days": 4,',
  '  "pax_basis": "PER_PERSON or PER_GROUP",',
  '  "price_amount": "18500.00",',
  '  "currency": "three-letter code like PHP or USD",',
  '  "itinerary_days": [ { "day": 1, "date": null, "title": "Arrival", "city": "", "activities": "", "meals": "", "overnight": "", "notes": "" } ],',
  '  "inclusions": ["what the price includes"],',
  '  "exclusions": ["what the price excludes"]',
  '}',
  'Dates must be YYYY-MM-DD when printed on the flyer; use null when only a month or nothing is shown.',
  'price_amount is a plain decimal string in the flyer currency, no symbols or separators.'
].join('\n');

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const DEFAULT_MODELS = { openai: 'gpt-4o-mini', gemini: 'gemini-2.0-flash' };

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
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text || /^null$/i.test(text)) return null;
  return text.slice(0, maxLength);
}

function sanitizeStringList(value, maxItems, maxLength) {
  const source = Array.isArray(value) ? value : [value];
  const items = [];
  source.forEach((entry) => {
    if (entry === undefined || entry === null) return;
    if (typeof entry === 'object') return;
    const text = String(entry).trim();
    if (text) items.push(text.slice(0, maxLength));
  });
  return items.slice(0, maxItems);
}

function sanitizeMoneyString(value) {
  if (value === undefined || value === null || typeof value === 'object') return null;
  const text = String(value).replace(/[^0-9.]/g, '');
  if (!text) return null;
  const number = Number(text);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number.toFixed(2);
}

function sanitizeIsoDate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(text + 'T00:00:00.000Z');
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? null : text;
}

function sanitizeItineraryDay(entry, index, notes) {
  if (entry === null || entry === undefined) return null;
  if (typeof entry !== 'object') {
    const text = sanitizeText(entry, 400);
    return text ? { day: index + 1, date: null, title: text, city: null, activities: null, meals: null, overnight: null, notes: null } : null;
  }
  const dayNumber = Number(entry.day);
  const day = Number.isInteger(dayNumber) && dayNumber >= 1 && dayNumber <= 60 ? dayNumber : index + 1;
  const dayRecord = {
    day,
    date: sanitizeIsoDate(entry.date),
    title: sanitizeText(entry.title, 200),
    city: sanitizeText(entry.city || entry.area, 120),
    activities: sanitizeText(entry.activities, 1200),
    meals: sanitizeText(entry.meals, 300),
    overnight: sanitizeText(entry.overnight, 200),
    notes: sanitizeText(entry.notes, 600)
  };
  const hasContent = ['date', 'title', 'city', 'activities', 'meals', 'overnight', 'notes'].some((key) => dayRecord[key]);
  if (!hasContent) return null;
  if (day !== index + 1) notes.push('Itinerary day renumbered to ' + day + '.');
  return dayRecord;
}

// Model output is untrusted: every field is coerced defensively, nothing
// throws, and unreadable values are dropped with a note instead of failing.
function sanitizeExtractedFields(raw) {
  const notes = [];
  const source = raw && typeof raw === 'object' ? raw : {};
  const fields = {};
  const name = sanitizeText(source.name, 160);
  if (name) fields.name = name;
  const destination = sanitizeText(source.destination, 120);
  if (destination) fields.destination = destination;
  const travelStart = sanitizeIsoDate(source.travel_start);
  if (travelStart) fields.travel_start = travelStart;
  const travelEnd = sanitizeIsoDate(source.travel_end);
  if (travelEnd) fields.travel_end = travelEnd;
  const duration = Number(source.duration_days);
  if (Number.isInteger(duration) && duration >= 1 && duration <= 60) fields.duration_days = duration;
  const paxBasis = String(source.pax_basis || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (paxBasis === 'PER_PERSON' || paxBasis === 'PER_GROUP') fields.pax_basis = paxBasis;
  const price = sanitizeMoneyString(source.price_amount);
  if (price) fields.price_amount = price;
  const currency = String(source.currency || '').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(currency)) fields.currency = currency;
  const inclusions = sanitizeStringList(source.inclusions, 40, 300);
  if (inclusions.length) fields.inclusions = inclusions;
  const exclusions = sanitizeStringList(source.exclusions, 40, 300);
  if (exclusions.length) fields.exclusions = exclusions;
  if (Array.isArray(source.itinerary_days)) {
    const days = [];
    source.itinerary_days.slice(0, 60).forEach((entry) => {
      const day = sanitizeItineraryDay(entry, days.length, notes);
      if (day) days.push(day);
    });
    if (days.length) {
      fields.itinerary_days = days;
      if (days.length < source.itinerary_days.length) notes.push(source.itinerary_days.length - days.length + ' itinerary day(s) could not be read.');
    }
  }
  const dropped = Object.keys(source).filter((key) => !(key in fields) && !['name', 'destination', 'travel_start', 'travel_end', 'duration_days', 'pax_basis', 'price_amount', 'currency', 'inclusions', 'exclusions', 'itinerary_days'].includes(key));
  if (dropped.length) notes.push('Ignored unexpected field(s): ' + dropped.slice(0, 5).join(', ') + '.');
  return { fields, notes };
}

function openAiRequestBody(model, dataUrl) {
  return {
    model,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You extract structured travel-package data from wholesaler flyer images and answer with JSON only.' },
      { role: 'user', content: [
        { type: 'text', text: FLYER_EXTRACTION_PROMPT },
        { type: 'image_url', image_url: { url: dataUrl } }
      ] }
    ]
  };
}

function geminiRequestBody(model, base64, mimeType) {
  return {
    model,
    contents: [{
      role: 'user',
      parts: [
        { text: FLYER_EXTRACTION_PROMPT },
        { inline_data: { mime_type: mimeType, data: base64 } }
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

function createFlyerExtractionAdapter(options) {
  const opts = options || {};
  const readOption = (name, envName) => (opts[name] !== undefined && opts[name] !== null ? String(opts[name]) : (process.env[envName] || ''));
  const provider = readOption('provider', 'FLYER_AI_PROVIDER').trim().toLowerCase();
  const apiKey = readOption('apiKey', 'FLYER_AI_API_KEY').trim();
  const model = readOption('model', 'FLYER_AI_MODEL').trim() || DEFAULT_MODELS[provider] || '';
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const supported = provider === 'openai' || provider === 'gemini';
  const configured = Boolean(supported && apiKey && typeof fetchImpl === 'function');
  const unavailabilityMessage = !supported
    ? 'Flyer AI extraction is disabled (FLYER_AI_PROVIDER is not openai or gemini). Package intake works manually.'
    : !apiKey
      ? 'Flyer AI extraction is not configured: FLYER_AI_API_KEY is missing. Package intake works manually.'
      : 'Flyer AI extraction is unavailable on this server. Package intake works manually.';

  return {
    provider: configured ? provider : 'none',
    model: configured ? model : null,
    available: configured,
    accepts(mimeType) { return IMAGE_MIME_TYPES.has(String(mimeType || '').toLowerCase()); },
    async extract(request) {
      if (!configured) {
        return { ok: false, code: 'EXTRACTION_UNAVAILABLE', message: unavailabilityMessage };
      }
      const imageBase64 = String(request && request.image_base64 || '');
      const mimeType = String(request && request.mime_type || '').toLowerCase();
      if (!imageBase64 || !this.accepts(mimeType)) {
        return { ok: false, code: 'EXTRACTION_UNAVAILABLE', message: 'The flyer AI adapter only reads PNG, JPEG, and WebP images. PDF flyers are retained for manual entry.' };
      }
      let requestSpec;
      if (provider === 'openai') {
        requestSpec = {
          url: 'https://api.openai.com/v1/chat/completions',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
          body: openAiRequestBody(model, 'data:' + mimeType + ';base64,' + imageBase64)
        };
      } else {
        requestSpec = {
          url: 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: geminiRequestBody(model, imageBase64, mimeType)
        };
      }
      let responseText = '';
      try {
        const response = await fetchImpl(requestSpec.url, { method: 'POST', headers: requestSpec.headers, body: JSON.stringify(requestSpec.body) });
        responseText = await response.text();
        if (!response.ok) {
          return { ok: false, code: 'EXTRACTION_UNAVAILABLE', message: 'The flyer AI provider rejected the request (HTTP ' + response.status + '). No fields were extracted.' };
        }
      } catch (_) {
        return { ok: false, code: 'EXTRACTION_UNAVAILABLE', message: 'The flyer AI provider could not be reached. No fields were extracted.' };
      }
      const raw = provider === 'openai' ? parseOpenAiContent(responseText) : parseGeminiContent(responseText);
      if (!raw) {
        return { ok: true, provider, model, fields: {}, notes: ['The model response could not be read as JSON — nothing was extracted. Verify the fields manually against the flyer.'] };
      }
      const { fields, notes } = sanitizeExtractedFields(raw);
      return { ok: true, provider, model, fields, notes };
    }
  };
}

module.exports = { createFlyerExtractionAdapter, sanitizeExtractedFields, FLYER_EXTRACTION_PROMPT };
