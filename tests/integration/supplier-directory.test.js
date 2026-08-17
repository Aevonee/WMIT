'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhase1Runtime } = require('../../src/phase1/runtime');

const ctx = (actor) => ({ actor: actor || 'staff', correlationId: 'SUPPLIER-DIRECTORY-TEST' });

function setup() {
  return createPhase1Runtime({ clock: () => new Date('2026-08-17T10:00:00+08:00'), config: { trustedActors: { staff: ['EDIT_DRAFT_PRICING', 'ACCEPT_QUOTATION'] } } });
}

test('createSupplier requires a name, normalizes legal_name, and blocks duplicate names', () => {
  const runtime = setup();

  const missing = runtime.createSupplier({ country: 'Thailand' }, ctx());
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'REQUIRED_FIELD');

  const created = runtime.createSupplier({ display_name: '  Bangkok Travel Services  ', capabilities: ['DMC', 'Tariff Supplier'], country: 'Thailand', primary_email: 'ops@example.test' }, ctx());
  assert.equal(created.ok, true);
  assert.equal(created.data.display_name, 'Bangkok Travel Services');
  assert.equal(created.data.legal_name, 'Bangkok Travel Services');
  assert.equal(created.data.status, 'ACTIVE');
  assert.deepEqual(created.data.capabilities, ['DMC', 'Tariff Supplier']);
  assert.match(created.data.supplier_id, /^SUPPLIER-/);
  assert.equal(created.meta.action, 'CREATE');

  const legalFallback = runtime.createSupplier({ legal_name: 'Seoul Partners Co., Ltd.' }, ctx());
  assert.equal(legalFallback.ok, true);
  assert.equal(legalFallback.data.display_name, 'Seoul Partners Co., Ltd.');
  assert.equal(legalFallback.data.legal_name, 'Seoul Partners Co., Ltd.');

  const duplicate = runtime.createSupplier({ display_name: 'bangkok travel services' }, ctx());
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error.code, 'SUPPLIER_DUPLICATE');
  assert.equal(runtime.list('Supplier').length, 2);
});

test('createSupplierContact links to a real supplier and rejects unknown or missing ids', () => {
  const runtime = setup();
  const supplier = runtime.createSupplier({ display_name: 'Demo DMC' }, ctx()).data;

  const contact = runtime.createSupplierContact({ supplier_id: supplier.supplier_id, name: 'Grace Reyes', contact_type: 'Reservations', email: 'grace@demo.test', phone: '+63 917 000 0000' }, ctx());
  assert.equal(contact.ok, true);
  assert.equal(contact.data.supplier_id, supplier.supplier_id);
  assert.equal(runtime.list('SupplierContact', (item) => item.supplier_id === supplier.supplier_id).length, 1);

  const unknown = runtime.createSupplierContact({ supplier_id: 'SUPPLIER-2099-999999', name: 'Ghost' }, ctx());
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, 'NOT_FOUND');

  const missing = runtime.createSupplierContact({ name: 'No Supplier' }, ctx());
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'REQUIRED_FIELD');
});

test('updateSettings stores validated message templates and reports them via the change hook', () => {
  const runtime = createPhase1Runtime({
    clock: () => new Date('2026-08-17T10:00:00+08:00'),
    config: { trustedActors: { manager: ['CONFIGURE_SETTINGS'] } }
  });
  const manager = { actor: 'manager', correlationId: 'TEMPLATE-SETTINGS-TEST' };

  const denied = runtime.updateSettings({ messageTemplates: [{ key: 'X', label: 'X', body: 'x' }] }, { actor: 'staff', correlationId: 'T' });
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'AUTHORIZATION_REQUIRED');

  const invalid = runtime.updateSettings({ messageTemplates: [{ key: 'bad key!', label: 'Bad', body: 'x' }] }, manager);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'INVALID_SETTING');

  const duplicate = runtime.updateSettings({ messageTemplates: [
    { key: 'HELLO', label: 'Hello', body: 'Hi {{first_name}}' },
    { key: 'HELLO', label: 'Hello again', body: 'Hi again' }
  ] }, manager);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error.code, 'INVALID_SETTING');

  let hookPayload = null;
  runtime.onSettingsChanged = (settings) => { hookPayload = settings; };
  const saved = runtime.updateSettings({ messageTemplates: [{ key: 'HELLO', label: 'Hello', body: 'Hi {{first_name}}, your {{destination}} trip awaits!' }] }, manager);
  assert.equal(saved.ok, true);
  assert.deepEqual(saved.data.messageTemplates, [{ key: 'HELLO', label: 'Hello', body: 'Hi {{first_name}}, your {{destination}} trip awaits!' }]);
  assert.ok(hookPayload && Array.isArray(hookPayload.messageTemplates) && hookPayload.messageTemplates.length === 1);
  assert.deepEqual(hookPayload.quotationDefaults, saved.data.quotationDefaults);
});
