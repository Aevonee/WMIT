'use strict';

const { extractTextFromFile } = require('./pdf-text');
const { extractTextDocument } = require('./extractor');

function processText(input) {
  return extractTextDocument(input);
}

function processFile(input) {
  const value = input || {};
  const extracted = extractTextFromFile(value.filePath);
  const result = extractTextDocument({
    documentId: value.documentId,
    fileName: value.fileName || value.filePath,
    sourceHint: value.sourceHint,
    requiredFields: value.requiredFields,
    text: extracted.text
  });
  result.parser = extracted.parser || null;
  result.warnings.push(...extracted.warnings);
  if (!extracted.ok) result.review_outcome = 'FAILED';
  return result;
}

module.exports = { processText, processFile };
