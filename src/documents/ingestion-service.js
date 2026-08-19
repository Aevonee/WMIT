'use strict';

// WMIT document ingestion service (roadmap Phase 6):
// register -> classify -> extract -> confidence-gate -> human review -> match.
// A standalone service over the Phase 1 runtime, following the ExpoService
// composition pattern ({ runtime, config, clock } with { ok, data } results).
//
// The service only ORCHESTRATES the existing document-intelligence modules
// (taxonomy classifier, extractor/normalizer, matcher); it never reimplements
// them and never commits extracted values into business records. Extracted
// data stays on the Document record until a human approves the match links:
// low-confidence extraction is flagged for review, never silently committed.
//
// Deployment note: on the shared webhosting server there is no pdftotext and
// no Python, so PDF text extraction is unavailable BY DESIGN. The service
// degrades cleanly with EXTRACTION_UNAVAILABLE and actionable guidance to
// paste the text instead; it never fakes an extraction.

const crypto = require('node:crypto');
const { WmitError, errorResult } = require('../core/errors');
const { SOURCE_TYPES, classifyDocument } = require('../document-intelligence/taxonomy');
const { extractTextDocument } = require('../document-intelligence/extractor');
const { suggestDocumentMatches } = require('../document-intelligence/matcher');
const { extractTextFromFile } = require('../document-intelligence/pdf-text');

const DOCUMENT_STATUSES = Object.freeze(['RECEIVED', 'CLASSIFIED', 'NEEDS_REVIEW', 'MATCHED', 'ARCHIVED']);
const TERMINAL_DOCUMENT_STATUSES = Object.freeze(['MATCHED', 'ARCHIVED']);
const REVIEW_QUEUE_STATUSES = Object.freeze(['RECEIVED', 'CLASSIFIED', 'NEEDS_REVIEW']);
const DOCUMENT_SOURCES = Object.freeze(['PASTE_TEXT', 'FILE_UPLOAD']);
const REVIEW_DECISIONS = Object.freeze(['APPROVE', 'REJECT']);
// Entity types a human may link a document to. 'Invoice' is accepted as the
// matcher's name for the runtime's ClientInvoice entity.
const MATCHABLE_ENTITY_TYPES = Object.freeze({
  Client: 'client_id',
  Supplier: 'supplier_id',
  Quotation: 'quotation_id',
  Booking: 'booking_id',
  SupplierBooking: 'supplier_booking_id',
  ClientInvoice: 'client_invoice_id',
  Invoice: 'client_invoice_id'
});

const DEFAULT_MAX_TEXT_BYTES = 1024 * 1024;
// The classifier's own confidence semantics: 0.97/0.92/0.84 are decisive
// bands, 0.68 is weak, 0.35 is a guess. The runtime's tariff review gate uses
// 0.8 as its confidence floor, so 0.8 is the line between CLASSIFIED and
// NEEDS_REVIEW here too.
const DEFAULT_CLASSIFY_CONFIDENCE_THRESHOLD = 0.8;
const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

function ok(data, meta) { return { ok: true, data, meta: meta || {} }; }
function fail(error) { return errorResult(error); }

function requireValue(value, field) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new WmitError('REQUIRED_FIELD', field + ' is required.', { field });
  }
  return String(value).trim();
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// Stored-text boundary sanitation: normalize newlines, strip control
// characters (tab and newline survive), and trim the edges so the same pasted
// content always produces the same content hash.
function sanitizeText(raw) {
  return String(raw === undefined || raw === null ? '' : raw)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .trim();
}

// File names never need path components or exotic characters: keep the base
// name, replace anything unsafe, cap the length.
function sanitizeFilename(raw) {
  return String(raw === undefined || raw === null ? '' : raw)
    .replace(/^.*[\\/]/, '')
    .replace(/[^\w .,'()&+-]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

class DocumentsIngestionService {
  constructor(options) {
    const opts = options || {};
    this.runtime = opts.runtime;
    this.config = opts.config || {};
    this.clock = opts.clock || (() => new Date());
    this.actor = opts.actor || 'DOCUMENTS_SYSTEM';
    // Injectable so tests (and future hosts) can simulate the webhosting
    // environment where no PDF text extractor exists.
    this.pdfTextExtractor = opts.pdfTextExtractor || extractTextFromFile;
    this.maxTextBytes = Number(this.config.maxTextBytes || DEFAULT_MAX_TEXT_BYTES);
    this.classifyConfidenceThreshold = Number(this.config.classifyConfidenceThreshold || DEFAULT_CLASSIFY_CONFIDENCE_THRESHOLD);
  }

  now() { return this.clock().toISOString(); }
  ctx(actor) { return { actor: actor || this.actor }; }

  // ------------------------------------------------------------ register

  registerDocument(input, actor) {
    let context = null;
    try {
      const value = input || {};
      const source = requireValue(value.source, 'source').toUpperCase();
      if (!DOCUMENT_SOURCES.includes(source)) {
        throw new WmitError('DOCUMENT_SOURCE_INVALID', 'Document source must be PASTE_TEXT or FILE_UPLOAD.', { source, allowed: DOCUMENT_SOURCES });
      }
      const filename = value.filename !== undefined && value.filename !== null && String(value.filename).trim() !== ''
        ? sanitizeFilename(value.filename)
        : null;
      if (source === 'FILE_UPLOAD' && !filename) {
        throw new WmitError('REQUIRED_FIELD', 'filename is required for file uploads.');
      }
      let mime = value.mime === undefined || value.mime === null || String(value.mime).trim() === '' ? null : String(value.mime).trim().toLowerCase();
      if (mime) {
        if (mime.length > 100 || !MIME_PATTERN.test(mime)) throw new WmitError('MIME_INVALID', 'mime must look like type/subtype (e.g. application/pdf).', { mime: mime.slice(0, 100) });
        mime = mime.slice(0, 100);
      }
      const uploadedBy = value.uploaded_by ? String(value.uploaded_by).trim().slice(0, 80) : null;
      let sourceHint = value.source_hint ? String(value.source_hint).trim().toUpperCase().slice(0, 40) : null;
      if (sourceHint && !SOURCE_TYPES.includes(sourceHint)) {
        throw new WmitError('SOURCE_HINT_INVALID', 'source_hint must be one of: ' + SOURCE_TYPES.join(', ') + '.', { source_hint: sourceHint, allowed: SOURCE_TYPES });
      }
      context = this.ctx(uploadedBy || actor);

      let text = sanitizeText(value.text);
      let parser = null;
      if (!text && source === 'FILE_UPLOAD') {
        // A file upload must produce text somehow. With text already read by
        // the caller we take it as-is; otherwise try the pdf-text module
        // against a caller-provided file. On the hosted webhosting server
        // neither pdftotext nor Python exists, so this degrades cleanly.
        if (value.file_path) {
          const extracted = this.pdfTextExtractor(String(value.file_path));
          if (extracted && extracted.ok) {
            text = sanitizeText(extracted.text);
            parser = extracted.parser || null;
          }
        }
        if (!text) {
          const error = new WmitError('EXTRACTION_UNAVAILABLE',
            'Text could not be extracted from this upload on the hosted server (no pdftotext or Python PDF adapter). Paste the document text instead of uploading the file.',
            { filename, mime, remedy: 'PASTE_TEXT' });
          this.runtime.auditFailure('DOCUMENT_REGISTER', 'Document', { source, filename, mime }, context, error);
          return fail(error);
        }
      }
      if (!text) throw new WmitError('TEXT_REQUIRED', 'Paste the document text to register it.');

      const textBytes = Buffer.byteLength(text, 'utf8');
      if (textBytes > this.maxTextBytes) {
        throw new WmitError('TEXT_TOO_LARGE', 'Document text exceeds the size limit. Split the document or register a shorter excerpt.', { bytes: textBytes, limit: this.maxTextBytes });
      }
      const contentHash = sha256Hex(text);
      // Idempotent by content hash: registering identical content again
      // returns the existing record instead of creating a duplicate.
      const existing = this.runtime.list('Document', (record) => record.content_hash === contentHash)[0];
      if (existing) {
        return ok(existing, { action: 'DOCUMENT_REGISTER', idempotent: true });
      }
      const created = this.runtime.createDocument({
        source,
        filename,
        mime,
        text,
        text_length: text.length,
        text_bytes: textBytes,
        content_hash: contentHash,
        uploaded_by: uploadedBy,
        source_hint: sourceHint,
        status: 'RECEIVED',
        review_status: 'NEEDS_REVIEW',
        parser,
        classification: null,
        extraction: null,
        match_links: null,
        review: null,
        registered_at: this.now()
      }, context);
      if (!created.ok) return created;
      // Audit details stay metadata-only: no document text, no extracted values.
      this.runtime.audit('DOCUMENT_REGISTER', 'Document', created.data, context, {
        source, filename, mime, content_hash: contentHash, text_bytes: textBytes, parser
      });
      return ok(created.data, { action: 'DOCUMENT_REGISTER' });
    } catch (error) {
      if (context) this.runtime.auditFailure('DOCUMENT_REGISTER', 'Document', null, context, error);
      return fail(error);
    }
  }

  // ------------------------------------------------------------ classify

  classifyDocument(documentId, actor) {
    try {
      const record = this.runtime.get('Document', requireValue(documentId, 'document_id'));
      if (TERMINAL_DOCUMENT_STATUSES.includes(record.status)) {
        throw new WmitError('DOCUMENT_STATUS_FINAL', 'This document already reached a final status (' + record.status + ') and cannot be reclassified.', { document_id: record.document_id, current: record.status });
      }
      const classification = classifyDocument({
        fileName: record.filename || undefined,
        text: record.text,
        sourceHint: record.source_hint || undefined
      });
      // Confidence gate from the classifier's own semantics, plus its
      // warnings (tied competitors, undetermined source) which always
      // require a human.
      const reviewRequired = classification.confidence < this.classifyConfidenceThreshold || classification.warnings.length > 0;
      const nextStatus = reviewRequired ? 'NEEDS_REVIEW' : 'CLASSIFIED';
      const previousStatus = record.status;
      const updated = this.runtime.updateRecord('Document', record.document_id, {
        status: nextStatus,
        classification: {
          document_type: classification.documentType,
          source_type: classification.sourceType,
          confidence: classification.confidence,
          source_confidence: classification.sourceConfidence,
          document_type_confidence: classification.documentTypeConfidence,
          evidence: classification.evidence,
          competing_classifications: classification.competingClassifications,
          warnings: classification.warnings,
          review_required: reviewRequired,
          classified_at: this.now()
        }
      }, this.ctx(actor));
      if (!updated.ok) return updated;
      this.runtime.audit('DOCUMENT_CLASSIFIED', 'Document', updated.data, this.ctx(actor), {
        previous_status: previousStatus,
        new_status: nextStatus,
        document_type: classification.documentType,
        source_type: classification.sourceType,
        confidence: classification.confidence,
        review_required: reviewRequired
      });
      return ok(updated.data, { action: 'DOCUMENT_CLASSIFIED', review_required: reviewRequired });
    } catch (error) {
      return fail(error);
    }
  }

  // ------------------------------------------------------------- extract

  extractDocument(documentId, actor) {
    try {
      const record = this.runtime.get('Document', requireValue(documentId, 'document_id'));
      if (TERMINAL_DOCUMENT_STATUSES.includes(record.status)) {
        throw new WmitError('DOCUMENT_STATUS_FINAL', 'This document already reached a final status (' + record.status + ') and cannot be re-extracted.', { document_id: record.document_id, current: record.status });
      }
      if (record.status === 'RECEIVED' || !record.classification) {
        throw new WmitError('CLASSIFICATION_REQUIRED', 'Classify the document before extracting it.', { document_id: record.document_id, status: record.status });
      }
      const result = extractTextDocument({
        documentId: record.document_id,
        fileName: record.filename || undefined,
        sourceHint: record.source_hint || undefined,
        text: record.text
      });
      // The extractor's own gate: review_outcome is AUTO_ACCEPTABLE only
      // when every field cleared its 0.9 auto-accept threshold with no
      // warnings. Everything else is flagged for a human.
      const reviewRequired = result.review_outcome !== 'AUTO_ACCEPTABLE';
      const extraction = {
        document_type: result.document_type,
        source_type: result.source_type,
        classification_confidence: result.classification_confidence,
        fields: result.fields,
        field_count: result.fields.length,
        warnings: result.warnings,
        review_outcome: result.review_outcome,
        review_required: reviewRequired,
        extracted_at: this.now()
      };
      const previousStatus = record.status;
      // Extraction never un-flags a document that classification or a
      // previous extraction sent to review.
      const nextStatus = reviewRequired || previousStatus === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : 'CLASSIFIED';
      const updated = this.runtime.updateRecord('Document', record.document_id, {
        status: nextStatus,
        extraction
      }, this.ctx(actor));
      if (!updated.ok) return updated;
      this.runtime.audit('DOCUMENT_EXTRACTED', 'Document', updated.data, this.ctx(actor), {
        previous_status: previousStatus,
        new_status: nextStatus,
        document_type: result.document_type,
        review_outcome: result.review_outcome,
        field_count: extraction.field_count,
        review_required: reviewRequired
      });
      return ok(updated.data, { action: 'DOCUMENT_EXTRACTED', review_required: reviewRequired });
    } catch (error) {
      return fail(error);
    }
  }

  // -------------------------------------------------------- match suggest

  // Suggestions only: proposes related records (clients, bookings, invoices,
  // suppliers) from the stored extraction. Writes nothing; a human chooses
  // the links in reviewDocument.
  matchSuggestions(documentId) {
    try {
      const record = this.runtime.get('Document', requireValue(documentId, 'document_id'));
      if (!record.extraction) {
        throw new WmitError('EXTRACTION_REQUIRED', 'Run extraction before requesting match suggestions.', { document_id: record.document_id, status: record.status });
      }
      const match = suggestDocumentMatches(record.extraction, this.runtime.repos);
      return ok({
        document_id: record.document_id,
        status: record.status,
        match,
        note: 'Suggestions are advisory. Nothing is linked until a reviewer approves chosen matches.'
      }, { action: 'DOCUMENT_MATCH_SUGGESTIONS', read_only: true });
    } catch (error) {
      return fail(error);
    }
  }

  // -------------------------------------------------------------- review

  reviewDocument(input, actor) {
    try {
      const value = input || {};
      const record = this.runtime.get('Document', requireValue(value.document_id, 'document_id'));
      const decision = requireValue(value.decision, 'decision').toUpperCase();
      if (!REVIEW_DECISIONS.includes(decision)) {
        throw new WmitError('DECISION_INVALID', 'Review decision must be APPROVE or REJECT.', { decision, allowed: REVIEW_DECISIONS });
      }
      const reviewer = requireValue(value.reviewer, 'reviewer').slice(0, 80);
      const note = value.note ? String(value.note).trim().slice(0, 500) : null;
      const previousStatus = record.status;
      if (TERMINAL_DOCUMENT_STATUSES.includes(previousStatus)) {
        // Re-playing the same decision is a harmless retry; flipping it is not.
        if ((decision === 'APPROVE' && previousStatus === 'MATCHED') || (decision === 'REJECT' && previousStatus === 'ARCHIVED')) {
          return ok(record, { action: 'DOCUMENT_REVIEW', idempotent: true });
        }
        throw new WmitError('DOCUMENT_STATUS_FINAL', 'This document already reached a final status (' + previousStatus + ') and cannot be reviewed again.', { document_id: record.document_id, current: previousStatus });
      }
      let chosenMatches = [];
      if (decision === 'APPROVE') {
        const supplied = Array.isArray(value.chosen_matches) ? value.chosen_matches : [];
        if (supplied.length > 20) throw new WmitError('MATCHES_TOO_MANY', 'Choose at most 20 record links per document.', { count: supplied.length });
        chosenMatches = supplied.map((entry, index) => {
          const entityType = String((entry && entry.entity_type) || '').trim();
          const runtimeType = entityType === 'Invoice' ? 'ClientInvoice' : entityType;
          if (!MATCHABLE_ENTITY_TYPES[runtimeType]) {
            throw new WmitError('MATCH_TYPE_INVALID', 'chosen_matches[' + index + ']: entity_type must be one of ' + Object.keys(MATCHABLE_ENTITY_TYPES).join(', ') + '.', { entity_type: entityType });
          }
          const entityId = requireValue(entry && entry.entity_id, 'chosen_matches[' + index + '].entity_id');
          this.runtime.get(runtimeType, entityId); // validates the linked record exists
          return { entity_type: runtimeType, entity_id: entityId };
        });
      }
      const nextStatus = decision === 'APPROVE' ? 'MATCHED' : 'ARCHIVED';
      // The updateRecord audit carries old/new status; the explicit row below
      // names the human decision and the links they approved.
      const updated = this.runtime.updateRecord('Document', record.document_id, {
        status: nextStatus,
        review_status: decision === 'APPROVE' ? 'CONFIRMED' : 'REJECTED',
        match_links: decision === 'APPROVE' ? chosenMatches : [],
        review: { decision, reviewer, note, chosen_matches: chosenMatches, reviewed_at: this.now() }
      }, this.ctx(reviewer));
      if (!updated.ok) return updated;
      this.runtime.audit('DOCUMENT_REVIEWED', 'Document', updated.data, this.ctx(reviewer), {
        decision,
        reviewer,
        previous_status: previousStatus,
        new_status: nextStatus,
        chosen_matches: chosenMatches
      });
      return ok(updated.data, { action: 'DOCUMENT_REVIEW', decision });
    } catch (error) {
      return fail(error);
    }
  }

  // --------------------------------------------------------------- queue

  // Review queue listing. Default: every document still awaiting human
  // review (RECEIVED, CLASSIFIED, NEEDS_REVIEW), worst-first. An explicit
  // status filter (including MATCHED/ARCHIVED) lists that status exactly.
  queue(filters) {
    try {
      const value = filters || {};
      let status = null;
      if (value.status !== undefined && value.status !== null && String(value.status).trim() !== '') {
        status = String(value.status).trim().toUpperCase();
        if (!DOCUMENT_STATUSES.includes(status)) {
          throw new WmitError('DOCUMENT_STATUS_INVALID', 'Unknown document status.', { status, allowed: DOCUMENT_STATUSES });
        }
      }
      const documents = this.runtime.list('Document', (record) => (status ? record.status === status : REVIEW_QUEUE_STATUSES.includes(record.status)));
      const rank = { NEEDS_REVIEW: 0, RECEIVED: 1, CLASSIFIED: 2 };
      const queue = documents
        .sort((a, b) => (rank[a.status] - rank[b.status]) || String(b.created_at).localeCompare(String(a.created_at)))
        .map((record) => ({
          document_id: record.document_id,
          status: record.status,
          review_status: record.review_status || null,
          source: record.source || null,
          filename: record.filename || null,
          mime: record.mime || null,
          uploaded_by: record.uploaded_by || null,
          created_at: record.created_at,
          updated_at: record.updated_at,
          classification: record.classification ? {
            document_type: record.classification.document_type,
            source_type: record.classification.source_type,
            confidence: record.classification.confidence,
            review_required: record.classification.review_required
          } : null,
          extraction: record.extraction ? {
            review_outcome: record.extraction.review_outcome,
            review_required: record.extraction.review_required,
            field_count: record.extraction.field_count,
            warnings_count: (record.extraction.warnings || []).length
          } : null,
          review_required: Boolean(
            (record.classification && record.classification.review_required)
            || (record.extraction && record.extraction.review_required)
          ),
          review: record.review ? { decision: record.review.decision, reviewer: record.review.reviewer, reviewed_at: record.review.reviewed_at } : null
        }));
      return ok({
        total: queue.length,
        statuses: status ? [status] : REVIEW_QUEUE_STATUSES.slice(),
        queue
      }, { action: 'DOCUMENT_REVIEW_QUEUE', read_only: true });
    } catch (error) {
      return fail(error);
    }
  }
}

module.exports = {
  DocumentsIngestionService,
  DOCUMENT_STATUSES,
  TERMINAL_DOCUMENT_STATUSES,
  REVIEW_QUEUE_STATUSES,
  DOCUMENT_SOURCES,
  REVIEW_DECISIONS,
  MATCHABLE_ENTITY_TYPES
};
