'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhase1Application, LOCAL_AUTH } = require('../../src/application/phase1');

function buildApp() {
  const app = createPhase1Application({ seedSynthetic: false });
  return app;
}

const TARIFF_INPUT = {
  supplier_id: 'SUPPLIER-SYNTH-000001',
  file_name: 'delete-me-tariff.pdf',
  file_ref: 'local://delete-me',
  original_source: { file_name: 'delete-me-tariff.pdf', source_type: 'LOCAL_SYNTHETIC' },
  extraction_summary: { source: 'LOCAL_SYNTHETIC_FIXTURE', review_required: true },
  extraction_facts: [
    { field_name: 'destination', normalized_value: 'Synthetic City', confidence: 1 },
    { field_name: 'rate_unit', normalized_value: 'PER_PERSON', confidence: 1 },
    { field_name: 'currency', normalized_value: 'PHP', confidence: 1 }
  ],
  rate_components: [
    { service_type: 'ACCOMMODATION_PACKAGE', amount: '10000.00', currency: 'PHP', rate_unit: 'PER_PERSON', quantity_driver: 'pax_count', conditions: { destination: 'Synthetic City', nights: 4, pax_min: 2, hotel: 'Synthetic Hotel', room_arrangement: 'TWN' }, inclusions: ['hotel accommodation'], exclusions: ['airfare'] }
  ],
  itinerary_components: [{ day: 1, city: 'Synthetic City', activity: 'Arrival transfer', included: true }]
};

function supplier(app) {
  app.createSupplier({ display_name: 'Synthetic Supplier', legal_name: 'Synthetic Supplier' }, { actor: 'LOCAL_STAFF' });
  return app.runtime.list('Supplier')[0].supplier_id;
}

test('tariff deletion requires explicit confirmation and manager authority', () => {
  const app = buildApp();
  const supplierId = supplier(app);
  const tariff = app.uploadTariff(Object.assign({}, TARIFF_INPUT, { supplier_id: supplierId }), { actor: 'LOCAL_STAFF' }).data;

  const staffAttempt = app.action({ action: 'deleteTariff', input: { tariff_source_id: tariff.tariff_source_id, confirm: true }, actor: 'LOCAL_STAFF' });
  assert.equal(staffAttempt.ok, false);
  assert.equal(staffAttempt.error.code, 'AUTHORIZATION_REQUIRED');

  const noConfirm = app.action({ action: 'deleteTariff', input: { tariff_source_id: tariff.tariff_source_id }, actor: 'LOCAL_MANAGER' });
  assert.equal(noConfirm.ok, false);
  assert.equal(noConfirm.error.code, 'DELETE_CONFIRMATION_REQUIRED');

  const wrongConfirm = app.action({ action: 'deleteTariff', input: { tariff_source_id: tariff.tariff_source_id, confirm: 'yes' }, actor: 'LOCAL_MANAGER' });
  assert.equal(wrongConfirm.ok, false);
  assert.equal(wrongConfirm.error.code, 'DELETE_CONFIRMATION_REQUIRED');

  // Nothing was deleted by the failed attempts.
  assert.ok(app.runtime.get('TariffSource', tariff.tariff_source_id));
});

test('a manager can delete an unreferenced tariff: children removed, evidence document retained, DELETE audited', () => {
  const app = buildApp();
  const supplierId = supplier(app);
  const tariff = app.uploadTariff(Object.assign({}, TARIFF_INPUT, { supplier_id: supplierId }), { actor: 'LOCAL_STAFF' }).data;
  const runtime = app.runtime;
  assert.equal(runtime.list('TariffExtractionFact', (record) => record.tariff_source_id === tariff.tariff_source_id).length, 3);
  assert.equal(runtime.list('TariffRateComponent', (record) => record.tariff_source_id === tariff.tariff_source_id).length, 1);
  assert.equal(runtime.list('TariffItineraryComponent', (record) => record.tariff_source_id === tariff.tariff_source_id).length, 1);

  const deleted = app.action({ action: 'deleteTariff', input: { tariff_source_id: tariff.tariff_source_id, confirm: true }, actor: 'LOCAL_MANAGER' });
  assert.equal(deleted.ok, true, JSON.stringify(deleted.error));
  assert.equal(deleted.data.deleted, true);
  assert.deepEqual(deleted.data.removed_records, { facts: 3, rates: 1, itinerary: 1 });

  assert.equal(runtime.repos.TariffSource.get(tariff.tariff_source_id), null);
  assert.equal(runtime.list('TariffExtractionFact', (record) => record.tariff_source_id === tariff.tariff_source_id).length, 0);
  assert.equal(runtime.list('TariffRateComponent', (record) => record.tariff_source_id === tariff.tariff_source_id).length, 0);
  assert.equal(runtime.list('TariffItineraryComponent', (record) => record.tariff_source_id === tariff.tariff_source_id).length, 0);

  const audit = runtime.auditLog.list();
  const deleteEntry = audit.find((event) => event.action === 'DELETE' && event.entity_type === 'TariffSource' && event.entity_id === tariff.tariff_source_id);
  assert.ok(deleteEntry, 'deletion writes an audit entry');
  assert.equal(deleteEntry.actor, 'LOCAL_MANAGER');
  assert.equal(deleteEntry.details.deleted_children.rates, 1);

  const secondAttempt = app.action({ action: 'deleteTariff', input: { tariff_source_id: tariff.tariff_source_id, confirm: true }, actor: 'LOCAL_MANAGER' });
  assert.equal(secondAttempt.ok, false);
  assert.equal(secondAttempt.error.code, 'NOT_FOUND');
});

test('tariffs referenced by Commercial Options cannot be deleted', () => {
  const app = buildApp();
  const supplierId = supplier(app);
  const runtime = app.runtime;
  const client = app.createClient({ display_name: 'Delete Guard Client', legal_name: 'Delete Guard Client' }, { actor: 'LOCAL_STAFF' }).data;
  const inquiry = app.createInquiry({ client_id: client.client_id, requirements: { destination: 'Synthetic City', travel_start: '2026-11-10', travel_end: '2026-11-14', adults: 2, children: 0, infants: 0 } }, { actor: 'LOCAL_STAFF' }).data;
  const tariff = app.uploadTariff(Object.assign({}, TARIFF_INPUT, { supplier_id: supplierId }), { actor: 'LOCAL_STAFF' }).data;

  const option = runtime.createRecord('CommercialOption', { inquiry_id: inquiry.inquiry_id, supplier_id: supplierId, tariff_source_id: tariff.tariff_source_id, state: 'MATCHED', selected: false }, { actor: 'LOCAL_STAFF' });
  assert.equal(option.ok, true);

  const blocked = app.action({ action: 'deleteTariff', input: { tariff_source_id: tariff.tariff_source_id, confirm: true }, actor: 'LOCAL_MANAGER' });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'TARIFF_IN_USE');
  assert.deepEqual(blocked.error.details.option_ids, [option.data.commercial_option_id]);
  assert.ok(runtime.get('TariffSource', tariff.tariff_source_id), 'the tariff survives the blocked deletion');

  // Once the referencing option is gone, deletion succeeds.
  runtime.repos.CommercialOption.delete(option.data.commercial_option_id);
  const deleted = app.action({ action: 'deleteTariff', input: { tariff_source_id: tariff.tariff_source_id, confirm: true }, actor: 'LOCAL_MANAGER' });
  assert.equal(deleted.ok, true, JSON.stringify(deleted.error));
});

test('deleteTariff is reachable over HTTP through the whitelisted dispatcher', async () => {
  const { createMvpServer } = require('../../app/server');
  const app = buildApp();
  const supplierId = supplier(app);
  const tariff = app.uploadTariff(Object.assign({}, TARIFF_INPUT, { supplier_id: supplierId }), { actor: 'LOCAL_STAFF' }).data;
  const { server } = createMvpServer({ phase1App: app });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const response = await fetch(base + '/api/phase1/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deleteTariff', input: { tariff_source_id: tariff.tariff_source_id, confirm: true }, actor: 'LOCAL_MANAGER' }) });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.deleted, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('on the hosted server a presented session identifies the actor: admin may delete, staff may not', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { openDatabase, ensureEntityTables, SqliteRepository, SqliteAuditLog, SqliteIdGenerator } = require('../../src/server/sqlite-store');
  const { AuthStore } = require('../../src/server/auth');
  const { createPhase1Runtime, ENTITY_DEFS } = require('../../src/phase1/runtime');
  const { createMvpServer } = require('../../app/server');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmit-tariff-del-auth-'));
  const db = openDatabase(path.join(dir, 'wmit.sqlite3'));
  ensureEntityTables(db, ENTITY_DEFS);
  const runtime = createPhase1Runtime({
    clock: () => new Date('2026-08-20T08:00:00Z'),
    idGenerator: new SqliteIdGenerator(db),
    auditLog: new SqliteAuditLog(db),
    repositoryFactory: (type, repoOptions) => new SqliteRepository(db, type, repoOptions.idField),
    config: { trustedActors: {} }
  });
  const auth = new AuthStore(db, { clock: () => new Date('2026-08-20T08:00:00Z'), onAccountsChanged: (map) => { runtime.config.trustedActors = map; } });
  runtime.config.trustedActors = auth.trustedActors();
  auth.createAccount({ username: 'owner', password: 'owner-password-1', role: 'ADMIN', display_name: 'Owner' }, 'TEST');
  auth.createAccount({ username: 'agent', password: 'agent-password-1', role: 'STAFF', display_name: 'Agent' }, 'TEST');
  const app = createPhase1Application({ runtime, seedSynthetic: false });
  runtime.createSupplier({ display_name: 'Session Test Supplier', legal_name: 'Session Test Supplier' }, { actor: 'USER:owner' });
  const tariff = app.uploadTariff(Object.assign({}, TARIFF_INPUT, { supplier_id: runtime.list('Supplier')[0].supplier_id }), 'USER:agent').data;

  // Sessions optional (dev): no Authorization header → body actor stays
  // LOCAL_MANAGER, which the hosted runtime does not trust.
  const { server } = createMvpServer({ phase1App: app, auth, enforceSessions: false });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = (body, token) => fetch(base + '/api/phase1/action', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: JSON.stringify(body) }).then((r) => r.json());
  try {
    // Anonymous /api/auth/me on an account-bearing server must report that
    // accounts exist, so login.html no longer auto-redirects signed-out
    // visitors to the workspace in development mode.
    const me = await fetch(base + '/api/auth/me').then((r) => r.json());
    assert.equal(me.data.anonymous, true);
    assert.equal(me.data.auth_available, true);
    assert.equal(me.data.username, undefined);
    const anonymous = await call({ action: 'deleteTariff', input: { tariff_source_id: tariff.tariff_source_id, confirm: true }, actor: 'LOCAL_MANAGER' });
    assert.equal(anonymous.ok, false);
    assert.equal(anonymous.error.code, 'AUTHORIZATION_REQUIRED');

    const agentLogin = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'agent', password: 'agent-password-1' }) }).then((r) => r.json());
    const asStaff = await call({ action: 'deleteTariff', input: { tariff_source_id: tariff.tariff_source_id, confirm: true }, actor: 'LOCAL_MANAGER' }, agentLogin.data.session_token);
    assert.equal(asStaff.ok, false);
    assert.equal(asStaff.error.code, 'AUTHORIZATION_REQUIRED');

    const ownerLogin = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'owner', password: 'owner-password-1' }) }).then((r) => r.json());
    const asAdmin = await call({ action: 'deleteTariff', input: { tariff_source_id: tariff.tariff_source_id, confirm: true }, actor: 'LOCAL_MANAGER' }, ownerLogin.data.session_token);
    assert.equal(asAdmin.ok, true, JSON.stringify(asAdmin.error));
    assert.equal(asAdmin.data.deleted, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
