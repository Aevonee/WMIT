'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPhase1Application } = require('../../src/application/phase1');
const { createBangkokTariffUploadAdapter } = require('../../src/adapters/bangkok-tariff-upload-adapter');

const source = path.join(__dirname, '../../docs/tariff-pilots/bangkok-travel-services/source/2025 FREE AND EASY PACKAGE April to October.docx');

test('The generic application accepts the Bangkok pilot only through an explicitly configured adapter', () => {
  const genericApp = createPhase1Application();
  assert.equal(typeof genericApp.uploadBangkokTariffDocument, 'undefined');
  const unavailable = genericApp.action({
    action: 'uploadSourceDocument',
    actor: 'LOCAL_STAFF',
    input: { adapter_key: 'BANGKOK_TRAVEL_SERVICES_DOCX', supplier_id: 'SUPPLIER-SYNTH-000001', file_name: 'pilot.docx', content_base64: 'UEs=' }
  });
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.error.code, 'SOURCE_ADAPTER_UNAVAILABLE');

  const app = createPhase1Application({ sourceAdapters: { BANGKOK_TRAVEL_SERVICES_DOCX: createBangkokTariffUploadAdapter() } });
  const bytes = fs.readFileSync(source);
  const result = app.action({
    action: 'uploadSourceDocument',
    actor: 'LOCAL_STAFF',
    input: {
      adapter_key: 'BANGKOK_TRAVEL_SERVICES_DOCX',
      supplier_id: 'SUPPLIER-SYNTH-000001',
      file_name: path.basename(source),
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      content_base64: bytes.toString('base64'),
      idempotency_key: 'TEST-BANGKOK-DOCX-UPLOAD'
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.meta.action, 'UPLOAD_SOURCE_DOCUMENT');
  assert.equal(result.meta.adapter_key, 'BANGKOK_TRAVEL_SERVICES_DOCX');
  assert.equal(result.data.trusted, false);
  assert.equal(result.data.extraction_summary.method, 'NATIVE_DOCX_OOXML');
  assert.equal(result.data.rate_components.length, 560);
  assert.equal(result.data.source_document.document_type, 'SUPPLIER_TARIFF');
  assert.equal(result.data.source_document.review_status, 'NEEDS_REVIEW');

  const snapshot = app.snapshot().data.entities;
  assert.equal(snapshot.Document.length, 1);
  assert.equal(snapshot.TariffSource.length, 1);
  assert.equal(snapshot.TariffSource[0].trusted, false);

  const review = app.action({
    action: 'reviewTariff',
    actor: 'LOCAL_MANAGER',
    input: { tariff_source_id: result.data.tariff_source_id, approve: true }
  });
  assert.equal(review.ok, false);
  assert.ok(['TARIFF_REVIEW_REQUIRED', 'TARIFF_CURRENCY_REQUIRED', 'TARIFF_RATE_UNIT_REQUIRED', 'TARIFF_RATE_REVIEW_REQUIRED'].includes(review.error.code));
});
