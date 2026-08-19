'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhase1Runtime } = require('../../src/phase1/runtime');
const { DocumentsIngestionService, DOCUMENT_STATUSES } = require('../../src/documents/ingestion-service');

function buildService(overrides) {
  const opts = overrides || {};
  const runtime = opts.runtime || createPhase1Runtime({ clock: opts.clock, config: { trustedActors: {} } });
  const service = new DocumentsIngestionService({
    runtime,
    config: opts.config || {},
    clock: opts.clock,
    pdfTextExtractor: opts.pdfTextExtractor
  });
  return { runtime, service };
}

// A realistic WMIT client quotation: clear World Master branding, quotation
// language, dated travel range, pax, pricing, and inclusions/exclusions.
const QUOTATION_TEXT = [
  'WORLD MASTER INTERNATIONAL TRAVEL',
  'Quotation Q-2027-0142',
  '',
  'Dear Maria Santos,',
  '',
  'Thank you for your inquiry. Here is your quotation for Seoul:',
  '',
  'Travel Dates: May 10 to May 14, 2027',
  'No. of Pax: 2',
  'Package: 5D4N Seoul Discovery Package',
  'Hotel Name: Grand Seoul Hotel',
  'Destination: Seoul',
  '',
  'Tour Fee / Pax / Package: PHP 32,900',
  '',
  'Inclusions:',
  'Round-trip economy airfare',
  '4 nights hotel with breakfast',
  'Airport transfers',
  '',
  'Exclusions:',
  'Visa fees',
  'Travel tax',
  '',
  'Valid for 48 hours. A 50% deposit is required upon confirmation.',
  '',
  'Sincerely,',
  'World Master International Travel'
].join('\n');

// No recognizable structure at all: the classifier can only guess.
const JUNK_TEXT = 'asdf jkl qwerty 12345 67890 lorem ipsum dolor sit';

const register = (service, overrides) => service.registerDocument(Object.assign({ source: 'PASTE_TEXT', text: QUOTATION_TEXT, uploaded_by: 'USER:staff1' }, overrides || {}));

test('paste-text happy path: register, classify, extract, queue, review-approve with a human-chosen match link', () => {
  const { runtime, service } = buildService();
  const client = runtime.createClient({ display_name: 'Maria Santos' }, { actor: 'USER:staff1' }).data;

  const registered = register(service, { filename: 'seoul-quotation.txt' });
  assert.equal(registered.ok, true, JSON.stringify(registered.error));
  assert.match(registered.data.document_id, /^DOCUMENT-\d{4}-\d{6}$/);
  assert.equal(registered.data.status, 'RECEIVED');
  assert.match(registered.data.content_hash, /^[a-f0-9]{64}$/);
  assert.equal(registered.data.uploaded_by, 'USER:staff1');

  const classified = service.classifyDocument(registered.data.document_id, 'USER:staff1');
  assert.equal(classified.ok, true, JSON.stringify(classified.error));
  assert.equal(classified.data.status, 'CLASSIFIED');
  assert.equal(classified.data.classification.document_type, 'WMIT_QUOTATION');
  assert.equal(classified.data.classification.source_type, 'WMIT');
  assert.ok(classified.data.classification.confidence >= 0.8, 'a well-branded quotation classifies confidently');
  assert.equal(classified.data.classification.review_required, false);

  const extracted = service.extractDocument(registered.data.document_id, 'USER:staff1');
  assert.equal(extracted.ok, true, JSON.stringify(extracted.error));
  const extraction = extracted.data.extraction;
  assert.ok(extraction.fields.length >= 8, 'the extractor found the structured fields');
  assert.ok(extraction.fields.every((field) => typeof field.confidence === 'number' && field.confidence > 0), 'every stored field carries its own confidence');
  const field = (name) => extraction.fields.find((entry) => entry.field_name === name);
  assert.equal(field('travel_start').normalized_value, '2027-05-10');
  assert.equal(field('travel_end').normalized_value, '2027-05-14');
  assert.equal(field('client').normalized_value, 'Maria Santos');
  assert.equal(field('amount').normalized_value, 32900);
  // Conservative extraction semantics (fields at 0.68) always gate to review.
  assert.equal(extraction.review_required, true);
  assert.equal(extracted.data.status, 'NEEDS_REVIEW');

  const queued = service.queue();
  assert.equal(queued.ok, true);
  assert.equal(queued.data.total, 1);
  const queueEntry = queued.data.queue[0];
  assert.equal(queueEntry.document_id, registered.data.document_id);
  assert.equal(queueEntry.review_required, true);
  assert.ok(!('text' in queueEntry), 'the review queue never carries document text');

  const suggestions = service.matchSuggestions(registered.data.document_id);
  assert.equal(suggestions.ok, true, JSON.stringify(suggestions.error));
  assert.equal(suggestions.meta.read_only, true);
  assert.equal(suggestions.data.match.status, 'POSSIBLE_MATCH', 'an exact client-name match is a possible, not automatic, match');
  const clientSuggestion = suggestions.data.match.suggestions.find((entry) => entry.entityType === 'Client' && entry.entityId === client.client_id);
  assert.ok(clientSuggestion, 'the known client is suggested');
  // Suggestions write nothing: the record is byte-identical afterwards.
  const beforeSuggestions = JSON.parse(JSON.stringify(runtime.get('Document', registered.data.document_id)));
  assert.equal(JSON.stringify(runtime.get('Document', registered.data.document_id)), JSON.stringify(beforeSuggestions));
  assert.equal(runtime.get('Document', registered.data.document_id).match_links, null, 'nothing is linked without human approval');

  // Review input is validated before any state changes.
  assert.equal(service.reviewDocument({ document_id: registered.data.document_id, decision: 'MAYBE', reviewer: 'USER:owner' }).error.code, 'DECISION_INVALID');
  assert.equal(service.reviewDocument({ document_id: registered.data.document_id, decision: 'APPROVE' }).error.code, 'REQUIRED_FIELD');
  assert.equal(service.reviewDocument({ document_id: registered.data.document_id, decision: 'APPROVE', reviewer: 'USER:owner', chosen_matches: [{ entity_type: 'Voucher', entity_id: 'x' }] }).error.code, 'MATCH_TYPE_INVALID');
  assert.equal(service.reviewDocument({ document_id: registered.data.document_id, decision: 'APPROVE', reviewer: 'USER:owner', chosen_matches: [{ entity_type: 'Client', entity_id: 'CLIENT-9999-999999' }] }).error.code, 'NOT_FOUND');
  assert.equal(runtime.get('Document', registered.data.document_id).status, 'NEEDS_REVIEW', 'failed reviews change nothing');

  const reviewed = service.reviewDocument({
    document_id: registered.data.document_id,
    decision: 'APPROVE',
    reviewer: 'USER:owner',
    note: 'Matches the Santos client file.',
    chosen_matches: [{ entity_type: 'Client', entity_id: client.client_id }]
  });
  assert.equal(reviewed.ok, true, JSON.stringify(reviewed.error));
  assert.equal(reviewed.data.status, 'MATCHED');
  assert.equal(reviewed.data.review_status, 'CONFIRMED');
  assert.deepEqual(reviewed.data.match_links, [{ entity_type: 'Client', entity_id: client.client_id }]);
  assert.equal(reviewed.data.review.reviewer, 'USER:owner');

  // Audit trail: one explicit row per pipeline transition, all metadata-only.
  const documentAudits = runtime.auditLog.list().filter((event) => event.entity_type === 'Document' && event.entity_id === registered.data.document_id);
  ['CREATE', 'DOCUMENT_REGISTER', 'DOCUMENT_CLASSIFIED', 'DOCUMENT_EXTRACTED', 'DOCUMENT_REVIEWED'].forEach((action) => {
    assert.ok(documentAudits.some((event) => event.action === action), 'audit row exists for ' + action);
  });
  const reviewRow = documentAudits.find((event) => event.action === 'DOCUMENT_REVIEWED');
  assert.equal(reviewRow.details.decision, 'APPROVE');
  assert.equal(reviewRow.details.previous_status, 'NEEDS_REVIEW');
  assert.equal(reviewRow.details.new_status, 'MATCHED');
  assert.deepEqual(reviewRow.details.chosen_matches, [{ entity_type: 'Client', entity_id: client.client_id }]);
  const statusUpdates = documentAudits.filter((event) => event.action === 'UPDATE' && event.details.changedFields.includes('status'));
  assert.equal(statusUpdates.length, 3, 'classify, extract, and review each transition the status');
  assert.equal(statusUpdates[2].details.old_values.status, 'NEEDS_REVIEW');
  assert.equal(statusUpdates[2].details.new_values.status, 'MATCHED');
  // Service-level audit rows stay metadata-only: no document text or
  // extracted personal data in the log stream.
  const personal = /Maria Santos|32,900|Round-trip/;
  documentAudits.filter((event) => event.action.startsWith('DOCUMENT_')).forEach((event) => {
    assert.ok(!personal.test(JSON.stringify(event.details)), event.action + ' audit details must stay metadata-only');
  });
});

test('registering identical content is idempotent by content hash', () => {
  const { runtime, service } = buildService();
  const first = register(service, { filename: 'a.txt' });
  assert.equal(first.ok, true);
  // CRLF vs LF normalization means the same pasted content hashes identically.
  const second = register(service, { text: QUOTATION_TEXT.replace(/\n/g, '\r\n') });
  assert.equal(second.ok, true);
  assert.equal(second.data.document_id, first.data.document_id, 'identical content returns the existing record');
  assert.equal(second.meta.idempotent, true);
  assert.equal(runtime.list('Document').length, 1, 'no second record is created');
  const creates = runtime.auditLog.list().filter((event) => event.action === 'CREATE' && event.entity_type === 'Document');
  assert.equal(creates.length, 1);
});

test('low-confidence documents are flagged for review and never auto-matched', () => {
  const { runtime, service } = buildService();
  const registered = register(service, { text: JUNK_TEXT, filename: 'junk.txt' });
  assert.equal(registered.ok, true);

  const classified = service.classifyDocument(registered.data.document_id);
  assert.equal(classified.ok, true);
  assert.equal(classified.data.status, 'NEEDS_REVIEW', 'unrecognizable text lands in review, not in Classified');
  assert.equal(classified.data.classification.document_type, 'UNKNOWN');
  assert.ok(classified.data.classification.confidence < 0.8);
  assert.equal(classified.data.classification.review_required, true);

  const extracted = service.extractDocument(registered.data.document_id);
  assert.equal(extracted.ok, true);
  assert.equal(extracted.data.extraction.review_required, true, 'an extraction with no confident fields is flagged');
  assert.equal(extracted.data.status, 'NEEDS_REVIEW');

  const suggestions = service.matchSuggestions(registered.data.document_id);
  assert.equal(suggestions.ok, true);
  assert.equal(suggestions.data.match.status, 'NO_MATCH');
  assert.deepEqual(suggestions.data.match.suggestions, []);

  const record = runtime.get('Document', registered.data.document_id);
  assert.equal(record.match_links, null, 'nothing is linked without a human decision');
  const queueEntry = service.queue().data.queue.find((entry) => entry.document_id === registered.data.document_id);
  assert.equal(queueEntry.review_required, true, 'the queue surfaces the review flag');
});

test('rejecting a document archives it and locks the record', () => {
  const { runtime, service } = buildService();
  const registered = register(service);
  service.classifyDocument(registered.data.document_id);
  service.extractDocument(registered.data.document_id);

  const rejected = service.reviewDocument({ document_id: registered.data.document_id, decision: 'REJECT', reviewer: 'USER:owner', note: 'Duplicate of another document.' });
  assert.equal(rejected.ok, true, JSON.stringify(rejected.error));
  assert.equal(rejected.data.status, 'ARCHIVED');
  assert.equal(rejected.data.review_status, 'REJECTED');
  assert.deepEqual(rejected.data.match_links, []);
  assert.equal(rejected.data.review.note, 'Duplicate of another document.');

  assert.equal(service.reviewDocument({ document_id: registered.data.document_id, decision: 'APPROVE', reviewer: 'USER:owner' }).error.code, 'DOCUMENT_STATUS_FINAL', 'an archived document cannot be approved later');
  const replay = service.reviewDocument({ document_id: registered.data.document_id, decision: 'REJECT', reviewer: 'USER:owner' });
  assert.equal(replay.ok, true, 'replaying the same rejection is an idempotent retry');
  assert.equal(replay.meta.idempotent, true);

  assert.equal(service.classifyDocument(registered.data.document_id).error.code, 'DOCUMENT_STATUS_FINAL', 'archived documents leave the pipeline');
  assert.ok(!service.queue().data.queue.some((entry) => entry.document_id === registered.data.document_id), 'archived documents leave the default review queue');
  assert.equal(service.queue({ status: 'ARCHIVED' }).data.total, 1, 'the archive is listable by status');
  assert.equal(service.queue({ status: 'ARCHIVED' }).data.queue[0].review.decision, 'REJECT');

  const reviewRow = runtime.auditLog.list().find((event) => event.action === 'DOCUMENT_REVIEWED' && event.entity_id === registered.data.document_id);
  assert.equal(reviewRow.details.previous_status, 'NEEDS_REVIEW');
  assert.equal(reviewRow.details.new_status, 'ARCHIVED');
  assert.equal(reviewRow.details.decision, 'REJECT');
});

test('file uploads: a working extractor registers the text; the webhosting environment degrades to EXTRACTION_UNAVAILABLE', () => {
  // The exact shape src/document-intelligence/pdf-text.js returns when
  // neither pdftotext nor the Python pdfplumber adapter exists.
  const unavailableExtractor = () => ({
    ok: false,
    parser: null,
    text: '',
    warnings: ['PDF text extraction requires pdftotext or the optional Python pdfplumber adapter; neither is available in this environment.']
  });

  const good = buildService({ pdfTextExtractor: () => ({ ok: true, parser: 'pdftotext', text: QUOTATION_TEXT, warnings: [] }) });
  const uploaded = good.service.registerDocument({ source: 'FILE_UPLOAD', filename: 'quote.pdf', mime: 'application/pdf', file_path: '/tmp/quote.pdf', uploaded_by: 'USER:staff1' });
  assert.equal(uploaded.ok, true, JSON.stringify(uploaded.error));
  assert.equal(uploaded.data.status, 'RECEIVED');
  assert.equal(uploaded.data.parser, 'pdftotext');
  // Content-hash idempotency is source-agnostic: pasting the same text later
  // returns the uploaded record rather than creating a duplicate.
  const pasted = good.service.registerDocument({ source: 'PASTE_TEXT', text: QUOTATION_TEXT });
  assert.equal(pasted.data.document_id, uploaded.data.document_id);
  assert.equal(pasted.meta.idempotent, true);

  const bad = buildService({ pdfTextExtractor: unavailableExtractor });
  const withPath = bad.service.registerDocument({ source: 'FILE_UPLOAD', filename: 'voucher.pdf', mime: 'application/pdf', file_path: '/tmp/voucher.pdf' });
  assert.equal(withPath.ok, false);
  assert.equal(withPath.error.code, 'EXTRACTION_UNAVAILABLE');
  assert.ok(/paste the document text/i.test(withPath.error.message), 'the error carries actionable guidance');
  const withoutPath = bad.service.registerDocument({ source: 'FILE_UPLOAD', filename: 'voucher.pdf', mime: 'application/pdf' });
  assert.equal(withoutPath.ok, false);
  assert.equal(withoutPath.error.code, 'EXTRACTION_UNAVAILABLE');

  assert.equal(bad.runtime.list('Document').length, 0, 'unusable uploads consume no state');
  const failures = bad.runtime.auditLog.list().filter((event) => event.action === 'DOCUMENT_REGISTER' && event.result === 'FAILURE');
  assert.equal(failures.length, 2, 'each degradation is audited');
});

test('invalid and junk input is rejected without consuming state', () => {
  const { runtime, service } = buildService({ config: { maxTextBytes: 60 } });
  const cases = [
    [{}, 'REQUIRED_FIELD'],
    [{ source: 'SMS', text: 'hello world' }, 'DOCUMENT_SOURCE_INVALID'],
    [{ source: 'PASTE_TEXT' }, 'TEXT_REQUIRED'],
    [{ source: 'PASTE_TEXT', text: '   \n\t  ' }, 'TEXT_REQUIRED'],
    [{ source: 'PASTE_TEXT', text: 'x'.repeat(100) }, 'TEXT_TOO_LARGE'],
    [{ source: 'FILE_UPLOAD', text: 'hello world' }, 'REQUIRED_FIELD'],
    [{ source: 'FILE_UPLOAD', filename: 'a.pdf', mime: 'pdf', text: 'hello world' }, 'MIME_INVALID'],
    [{ source: 'PASTE_TEXT', text: 'hello world', source_hint: 'ALIEN' }, 'SOURCE_HINT_INVALID']
  ];
  cases.forEach(([input, code]) => {
    const result = service.registerDocument(input);
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.equal(result.error.code, code, JSON.stringify(input));
  });
  assert.equal(runtime.list('Document').length, 0, 'no records were created');
  assert.equal(runtime.auditLog.list().filter((event) => event.action === 'CREATE').length, 0, 'no CREATE audit rows were written');

  // Unknown IDs and statuses fail cleanly.
  const missing = 'DOCUMENT-9999-000001';
  assert.equal(service.classifyDocument(missing).error.code, 'NOT_FOUND');
  assert.equal(service.extractDocument(missing).error.code, 'NOT_FOUND');
  assert.equal(service.matchSuggestions(missing).error.code, 'NOT_FOUND');
  assert.equal(service.reviewDocument({ document_id: missing, decision: 'APPROVE', reviewer: 'x' }).error.code, 'NOT_FOUND');
  assert.equal(service.queue({ status: 'LOST' }).error.code, 'DOCUMENT_STATUS_INVALID');
  assert.deepEqual(DOCUMENT_STATUSES, ['RECEIVED', 'CLASSIFIED', 'NEEDS_REVIEW', 'MATCHED', 'ARCHIVED']);

  // The pipeline order is enforced: extraction requires classification first.
  const registered = service.registerDocument({ source: 'PASTE_TEXT', text: 'nothing recognizable here', filename: 'note.txt' });
  assert.equal(registered.ok, true);
  assert.equal(service.extractDocument(registered.data.document_id).error.code, 'CLASSIFICATION_REQUIRED');

  // File names are sanitized to a safe base name.
  const travis = service.registerDocument({ source: 'FILE_UPLOAD', filename: '..\\..\\windows\\system32\\evil.pdf', text: 'hello world again' });
  assert.equal(travis.ok, true);
  assert.equal(travis.data.filename, 'evil.pdf', 'path components never survive filename sanitization');
});
