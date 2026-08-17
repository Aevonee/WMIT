'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('generic application and Operations Workspace do not contain Bangkok-specific pilot paths', () => {
  const application = fs.readFileSync('src/application/phase1.js', 'utf8');
  const operations = fs.readFileSync('app/public/operations.js', 'utf8');
  const operationsHtml = fs.readFileSync('app/public/operations.html', 'utf8');
  const adapter = fs.readFileSync('src/adapters/bangkok-tariff-upload-adapter.js', 'utf8');

  assert.doesNotMatch(application, /Bangkok|uploadBangkokTariffDocument/i);
  assert.doesNotMatch(operations, /Bangkok|uploadBangkokTariffDocument|chooseBangkokTariffFile/i);
  assert.doesNotMatch(operationsHtml, /Bangkok|Bangkok Travel Services/i);
  assert.match(adapter, /BANGKOK_TRAVEL_SERVICES_DOCX/);
});
