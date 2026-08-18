'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhase1Application } = require('../../src/application/phase1');

function buildApp() {
  return createPhase1Application({ seedSynthetic: false });
}

test('updateSupplier changes fields, normalizes names, and keeps audit trail of old and new values', () => {
  const app = buildApp();
  const supplier = app.createSupplier({ display_name: 'Old Name Co', country: 'Dubai' }, { actor: 'LOCAL_STAFF' }).data;

  const updated = app.updateSupplier({ supplier_id: supplier.supplier_id, country: 'UAE', primary_email: 'ops@new.test' }, { actor: 'LOCAL_STAFF' });
  assert.equal(updated.ok, true);
  assert.equal(updated.data.country, 'UAE');
  assert.equal(updated.data.primary_email, 'ops@new.test');
  assert.equal(updated.data.display_name, 'Old Name Co');

  const renamed = app.updateSupplier({ supplier_id: supplier.supplier_id, display_name: '  Renamed Co  ' }, { actor: 'LOCAL_STAFF' });
  assert.equal(renamed.ok, true);
  assert.equal(renamed.data.display_name, 'Renamed Co');
  assert.equal(renamed.data.legal_name, 'Old Name Co');

  const legalRenamed = app.updateSupplier({ supplier_id: supplier.supplier_id, legal_name: 'Old Name Co., Inc.' }, { actor: 'LOCAL_STAFF' });
  assert.equal(legalRenamed.ok, true);
  assert.equal(legalRenamed.data.legal_name, 'Old Name Co., Inc.');
  assert.equal(legalRenamed.data.display_name, 'Renamed Co');

  const audits = app.runtime.auditLog.list().filter((event) => event.action === 'UPDATE' && event.entity_type === 'Supplier' && event.entity_id === supplier.supplier_id);
  assert.equal(audits.length, 3);
  assert.equal(audits[0].details.old_values.country, 'Dubai');
  assert.equal(audits[0].details.new_values.country, 'UAE');
});

test('updateSupplier blocks duplicate names excluding itself, rejects blanks and unknown ids', () => {
  const app = buildApp();
  const a = app.createSupplier({ display_name: 'Alpha Travel' }, { actor: 'LOCAL_STAFF' }).data;
  const b = app.createSupplier({ display_name: 'Beta Travel' }, { actor: 'LOCAL_STAFF' }).data;

  const duplicate = app.updateSupplier({ supplier_id: b.supplier_id, display_name: 'alpha travel' }, { actor: 'LOCAL_STAFF' });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error.code, 'SUPPLIER_DUPLICATE');

  const selfRename = app.updateSupplier({ supplier_id: b.supplier_id, display_name: '  beta travel  ' }, { actor: 'LOCAL_STAFF' });
  assert.equal(selfRename.ok, true);
  assert.equal(selfRename.data.display_name, 'beta travel');

  const blank = app.updateSupplier({ supplier_id: b.supplier_id, display_name: '   ' }, { actor: 'LOCAL_STAFF' });
  assert.equal(blank.ok, false);
  assert.equal(blank.error.code, 'REQUIRED_FIELD');

  const unknown = app.updateSupplier({ supplier_id: 'SUPPLIER-2099-999999', country: 'UAE' }, { actor: 'LOCAL_STAFF' });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, 'NOT_FOUND');
});

test('updateSupplier is reachable over HTTP through the whitelisted dispatcher', async () => {
  const { createMvpServer } = require('../../app/server');
  const app = buildApp();
  const supplier = app.createSupplier({ display_name: 'HTTP Edit Co' }, { actor: 'LOCAL_STAFF' }).data;
  const { server } = createMvpServer({ phase1App: app });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const response = await fetch(base + '/api/phase1/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'updateSupplier', input: { supplier_id: supplier.supplier_id, industry: 'Tour Operator' }, actor: 'LOCAL_STAFF' }) });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.industry, 'Tour Operator');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
