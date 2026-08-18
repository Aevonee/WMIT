'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhase1Application } = require('../../src/application/phase1');

function buildApp() {
  return createPhase1Application({ seedSynthetic: false });
}

function makeSupplier(app, name) {
  const result = app.createSupplier({ display_name: name }, { actor: 'LOCAL_STAFF' });
  assert.equal(result.ok, true);
  return result.data;
}

test('supplier deletion requires manager authority, explicit confirmation, and cascades contacts', () => {
  const app = buildApp();
  const supplier = makeSupplier(app, 'Delete Me DMC');
  app.createSupplierContact({ supplier_id: supplier.supplier_id, name: 'Grace Reyes', email: 'grace@demo.test' }, { actor: 'LOCAL_STAFF' });
  app.createSupplierContact({ supplier_id: supplier.supplier_id, name: 'Branch office' }, { actor: 'LOCAL_STAFF' });

  const staffAttempt = app.action({ action: 'deleteSupplier', input: { supplier_id: supplier.supplier_id, confirm: true }, actor: 'LOCAL_STAFF' });
  assert.equal(staffAttempt.ok, false);
  assert.equal(staffAttempt.error.code, 'AUTHORIZATION_REQUIRED');

  const noConfirm = app.action({ action: 'deleteSupplier', input: { supplier_id: supplier.supplier_id }, actor: 'LOCAL_MANAGER' });
  assert.equal(noConfirm.ok, false);
  assert.equal(noConfirm.error.code, 'DELETE_CONFIRMATION_REQUIRED');

  const deleted = app.action({ action: 'deleteSupplier', input: { supplier_id: supplier.supplier_id, confirm: true }, actor: 'LOCAL_MANAGER' });
  assert.equal(deleted.ok, true);
  assert.equal(deleted.data.deleted, true);
  assert.equal(deleted.data.removed_contacts, 2);

  assert.equal(app.runtime.list('Supplier', (item) => item.supplier_id === supplier.supplier_id).length, 0);
  assert.equal(app.runtime.list('SupplierContact', (item) => item.supplier_id === supplier.supplier_id).length, 0);

  const supplierAudits = app.runtime.auditLog.list().filter((event) => event.action === 'DELETE' && event.entity_type === 'Supplier' && event.entity_id === supplier.supplier_id);
  assert.equal(supplierAudits.length, 1);
  assert.equal(supplierAudits[0].result, 'SUCCESS');
  assert.equal(supplierAudits[0].details.deleted_contacts, 2);
  const contactAudits = app.runtime.auditLog.list().filter((event) => event.action === 'DELETE' && event.entity_type === 'SupplierContact');
  assert.equal(contactAudits.length, 2);

  const secondAttempt = app.action({ action: 'deleteSupplier', input: { supplier_id: supplier.supplier_id, confirm: true }, actor: 'LOCAL_MANAGER' });
  assert.equal(secondAttempt.ok, false);
  assert.equal(secondAttempt.error.code, 'NOT_FOUND');
});

test('supplier deletion is blocked while operational records reference the supplier', () => {
  const app = buildApp();
  const supplier = makeSupplier(app, 'Referenced DMC');
  const tariff = app.uploadTariff({
    supplier_id: supplier.supplier_id,
    file_name: 'referenced-tariff.pdf',
    file_ref: 'local://referenced',
    original_source: { file_name: 'referenced-tariff.pdf', source_type: 'LOCAL_SYNTHETIC' },
    extraction_summary: { source: 'LOCAL_SYNTHETIC_FIXTURE', review_required: true },
    extraction_facts: [{ field_name: 'destination', normalized_value: 'Synthetic City', confidence: 1 }],
    rate_components: [
      { service_type: 'ACCOMMODATION_PACKAGE', amount: '10000.00', currency: 'PHP', rate_unit: 'PER_PERSON', quantity_driver: 'pax_count', conditions: { destination: 'Synthetic City', nights: 4 } }
    ],
    itinerary_components: []
  }, { actor: 'LOCAL_STAFF' }).data;

  const blocked = app.action({ action: 'deleteSupplier', input: { supplier_id: supplier.supplier_id, confirm: true }, actor: 'LOCAL_MANAGER' });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'SUPPLIER_IN_USE');
  assert.equal(blocked.error.details.blocking_records.tariff_sources, 1);
  assert.equal(app.runtime.list('Supplier', (item) => item.supplier_id === supplier.supplier_id).length, 1);

  app.action({ action: 'deleteTariff', input: { tariff_source_id: tariff.tariff_source_id, confirm: true }, actor: 'LOCAL_MANAGER' });
  const nowDeletable = app.action({ action: 'deleteSupplier', input: { supplier_id: supplier.supplier_id, confirm: true }, actor: 'LOCAL_MANAGER' });
  assert.equal(nowDeletable.ok, true);
});

test('supplier deletion rejects missing and unknown ids', () => {
  const app = buildApp();
  const missing = app.action({ action: 'deleteSupplier', input: { confirm: true }, actor: 'LOCAL_MANAGER' });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'REQUIRED_FIELD');

  const unknown = app.action({ action: 'deleteSupplier', input: { supplier_id: 'SUPPLIER-2099-999999', confirm: true }, actor: 'LOCAL_MANAGER' });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, 'NOT_FOUND');
});

test('deleteSupplier is reachable over HTTP through the whitelisted dispatcher', async () => {
  const { createMvpServer } = require('../../app/server');
  const app = buildApp();
  const supplier = makeSupplier(app, 'HTTP Delete DMC');
  const { server } = createMvpServer({ phase1App: app });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const response = await fetch(base + '/api/phase1/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deleteSupplier', input: { supplier_id: supplier.supplier_id, confirm: true }, actor: 'LOCAL_MANAGER' }) });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.deleted, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
