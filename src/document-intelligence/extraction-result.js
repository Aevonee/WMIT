'use strict';

const { REVIEW_OUTCOMES } = require('./taxonomy');

function createExtractionResult(input) {
  const value = input || {};
  return {
    extraction_result_id: value.extraction_result_id || null,
    document_id: value.document_id || null,
    document_type: value.document_type || 'UNKNOWN',
    source_type: value.source_type || 'UNKNOWN',
    fields: [],
    warnings: [],
    review_outcome: REVIEW_OUTCOMES.includes(value.review_outcome) ? value.review_outcome : 'NEEDS_REVIEW',
    created_at: value.created_at || new Date().toISOString()
  };
}

function addExtractedField(result, field) {
  const entry = Object.assign({
    field_name: null,
    raw_value: null,
    normalized_value: null,
    confidence: 0,
    source_page: null,
    warnings: [],
    review_status: 'NEEDS_REVIEW'
  }, field || {});
  result.fields.push(entry);
  if (entry.warnings.length) result.warnings.push(...entry.warnings);
  return result;
}

function finalizeExtractionResult(result, options) {
  const opts = options || {};
  const requiredFields = opts.requiredFields || [];
  const present = new Set(result.fields
    .filter((field) => field.normalized_value !== null && field.normalized_value !== '')
    .map((field) => field.field_name));
  const missing = requiredFields.filter((field) => !present.has(field));
  if (missing.length) result.warnings.push(...missing.map((field) => field + ': Not found'));
  const hasWarnings = result.warnings.length > 0;
  const minConfidence = result.fields.length
    ? Math.min(...result.fields.map((field) => Number(field.confidence) || 0))
    : 0;
  if (opts.failed) result.review_outcome = 'FAILED';
  else if (hasWarnings || minConfidence < (opts.autoAcceptThreshold || 0.9)) result.review_outcome = 'NEEDS_REVIEW';
  else result.review_outcome = 'AUTO_ACCEPTABLE';
  return result;
}

module.exports = { createExtractionResult, addExtractedField, finalizeExtractionResult };
