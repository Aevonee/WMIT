'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhase1Application } = require('../../src/application/phase1');

function buildApp() {
  return createPhase1Application({ seedSynthetic: false });
}

function supplier(app) {
  app.createSupplier({ display_name: 'Manual Entry Supplier', legal_name: 'Manual Entry Supplier' }, { actor: 'LOCAL_STAFF' });
  return app.runtime.list('Supplier')[0].supplier_id;
}

test('manual entry template: blank tariff, confirmed currency/unit up front, rates added as confirmed rows, one-click trust', () => {
  const app = buildApp();
  const supplierId = supplier(app);
  const runtime = app.runtime;

  const blank = app.action({ action: 'createManualTariff', input: { supplier_id: supplierId, currency: 'USD', rate_unit: 'PER_PERSON', validity_start: '2026-04-01', validity_end: '2026-10-31' }, actor: 'LOCAL_STAFF' });
  assert.equal(blank.ok, true, JSON.stringify(blank.error));
  const tariffId = blank.data.tariff_source_id;
  const tariff = runtime.get('TariffSource', tariffId);
  assert.equal(tariff.trusted, false);
  assert.equal(tariff.status, 'NEEDS_REVIEW');
  assert.equal(tariff.extraction_summary.method, 'MANUAL_ENTRY');
  assert.equal(tariff.supplier_name, 'Manual Entry Supplier');

  const facts = runtime.list('TariffExtractionFact', (fact) => fact.tariff_source_id === tariffId);
  assert.equal(facts.find((fact) => fact.field_name === 'rate_currency').review_status, 'CONFIRMED');
  assert.equal(facts.find((fact) => fact.field_name === 'rate_currency').normalized_value, 'USD');
  assert.equal(facts.find((fact) => fact.field_name === 'rate_unit').review_status, 'CONFIRMED');
  assert.equal(facts.find((fact) => fact.field_name === 'validity_start').normalized_value, '2026-04-01');

  const rate = app.action({ action: 'addTariffRate', input: { tariff_source_id: tariffId, hotel: 'ARCK HOTEL 4*', room_type: 'DLX', room_arrangement: 'SGL', duration_days: 3, nights: 2, amount: '150', region: 'SUKHUMVIT AREA', destination: 'Bangkok' }, actor: 'LOCAL_STAFF' });
  assert.equal(rate.ok, true, JSON.stringify(rate.error));
  const row = rate.data;
  assert.equal(row.amount, '150.00');
  assert.equal(row.currency, 'USD', 'currency inherited from the confirmed fact');
  assert.equal(row.currency_status, 'CONFIRMED');
  assert.equal(row.rate_unit, 'PER_PERSON');
  assert.equal(row.requires_explicit_review, false, 'manual rows do not need re-confirmation');
  assert.equal(row.conditions.duration, '3D2N');
  assert.equal(row.conditions.room_arrangement, 'SGL');
  assert.equal(row.conditions.destination, 'Bangkok');

  // Nights default to days - 1.
  const rate2 = app.action({ action: 'addTariffRate', input: { tariff_source_id: tariffId, hotel: 'ARCK HOTEL 4*', room_arrangement: 'TWN/TRP', duration_days: 4, amount: '106' }, actor: 'LOCAL_STAFF' });
  assert.equal(rate2.ok, true);
  assert.equal(rate2.data.conditions.nights, 3);

  // One-click trust: no unresolved facts or rates for manually entered data.
  const approved = app.action({ action: 'reviewTariff', input: { tariff_source_id: tariffId, approve: true }, actor: 'LOCAL_MANAGER' });
  assert.equal(approved.ok, true, JSON.stringify(approved.error));
  assert.equal(approved.data.trusted, true);
  const stamped = runtime.list('TariffRateComponent', (record) => record.tariff_source_id === tariffId);
  assert.equal(stamped.every((record) => record.currency === 'USD' && record.rate_unit === 'PER_PERSON'), true);

  // Trusted tariffs are immutable.
  const lateAdd = app.action({ action: 'addTariffRate', input: { tariff_source_id: tariffId, hotel: 'X', room_arrangement: 'SGL', duration_days: 3, amount: '100' }, actor: 'LOCAL_STAFF' });
  assert.equal(lateAdd.ok, false);
  assert.equal(lateAdd.error.code, 'TARIFF_TRUSTED_IMMUTABLE');
});

test('manual rate rows can be removed while the tariff is untrusted, with audit', () => {
  const app = buildApp();
  const supplierId = supplier(app);
  const runtime = app.runtime;
  const blank = app.action({ action: 'createManualTariff', input: { supplier_id: supplierId, currency: 'PHP', rate_unit: 'PER_PERSON' }, actor: 'LOCAL_STAFF' });
  const tariffId = blank.data.tariff_source_id;
  const rate = app.action({ action: 'addTariffRate', input: { tariff_source_id: tariffId, hotel: 'SEA VIEW', room_arrangement: 'TWN', duration_days: 3, amount: '7200' }, actor: 'LOCAL_STAFF' });
  assert.equal(rate.ok, true);

  const removed = app.action({ action: 'removeTariffRate', input: { tariff_rate_component_id: rate.data.tariff_rate_component_id }, actor: 'LOCAL_STAFF' });
  assert.equal(removed.ok, true, JSON.stringify(removed.error));
  assert.equal(runtime.list('TariffRateComponent', (record) => record.tariff_source_id === tariffId).length, 0);
  const audit = runtime.auditLog.list();
  assert.ok(audit.find((event) => event.action === 'DELETE' && event.entity_type === 'TariffRateComponent' && event.entity_id === rate.data.tariff_rate_component_id), 'rate removal is audited');

  const missing = app.action({ action: 'removeTariffRate', input: { tariff_rate_component_id: 'TARIFF_RATE-2099-999999' }, actor: 'LOCAL_STAFF' });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'NOT_FOUND');
});

test('manual tariff and rate validation rejects junk before anything is written', () => {
  const app = buildApp();
  const supplierId = supplier(app);
  const runtime = app.runtime;

  assert.equal(app.action({ action: 'createManualTariff', input: { supplier_id: supplierId, currency: 'DOLLAR' }, actor: 'LOCAL_STAFF' }).error.code, 'INVALID_CURRENCY');
  assert.equal(app.action({ action: 'createManualTariff', input: { supplier_id: supplierId, rate_unit: 'PER_SMILE' }, actor: 'LOCAL_STAFF' }).error.code, 'TARIFF_RATE_UNIT_INVALID');
  assert.equal(app.action({ action: 'createManualTariff', input: { supplier_id: 'SUPPLIER-2099-999999' }, actor: 'LOCAL_STAFF' }).error.code, 'NOT_FOUND');
  assert.equal(app.action({ action: 'createManualTariff', input: { supplier_id: supplierId, validity_start: '2026-10-31', validity_end: '2026-04-01' }, actor: 'LOCAL_STAFF' }).error.code, 'TARIFF_DATE_RANGE_INVALID');
  assert.equal(runtime.list('TariffSource').length, 0, 'failed creations write nothing');

  const blank = app.action({ action: 'createManualTariff', input: { supplier_id: supplierId, currency: 'PHP', rate_unit: 'PER_PERSON' }, actor: 'LOCAL_STAFF' });
  const tariffId = blank.data.tariff_source_id;
  const cases = [
    [{ tariff_source_id: tariffId, room_arrangement: 'SGL', duration_days: 3, amount: '100' }, 'REQUIRED_FIELD'],
    [{ tariff_source_id: tariffId, hotel: 'X', room_arrangement: 'SGL', duration_days: 3, amount: '0' }, 'INVALID_MONEY'],
    [{ tariff_source_id: tariffId, hotel: 'X', room_arrangement: 'QUINT', duration_days: 3, amount: '100' }, 'ROOM_ARRANGEMENT_INVALID'],
    [{ tariff_source_id: tariffId, hotel: 'X', room_arrangement: 'SGL', duration_days: 61, amount: '100' }, 'DURATION_INVALID'],
    [{ tariff_source_id: tariffId, hotel: 'X', room_arrangement: 'SGL', duration_days: 3, nights: 9, amount: '100' }, 'NIGHTS_INVALID'],
    [{ tariff_source_id: 'TARIFF-2099-999999', hotel: 'X', room_arrangement: 'SGL', duration_days: 3, amount: '100' }, 'NOT_FOUND']
  ];
  cases.forEach(([input, code]) => {
    const result = app.action({ action: 'addTariffRate', input, actor: 'LOCAL_STAFF' });
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.equal(result.error.code, code, JSON.stringify(input));
  });
  assert.equal(runtime.list('TariffRateComponent', (record) => record.tariff_source_id === tariffId).length, 0, 'rejected rates write nothing');
});

test('manual entry is reachable over HTTP through the whitelisted dispatcher', async () => {
  const { createMvpServer } = require('../../app/server');
  const app = buildApp();
  const supplierId = supplier(app);
  const { server } = createMvpServer({ phase1App: app });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = (body) => fetch(base + '/api/phase1/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  try {
    const blank = await call({ action: 'createManualTariff', input: { supplier_id: supplierId, currency: 'USD', rate_unit: 'PER_PERSON' }, actor: 'LOCAL_STAFF' });
    assert.equal(blank.ok, true, JSON.stringify(blank.error));
    const rate = await call({ action: 'addTariffRate', input: { tariff_source_id: blank.data.tariff_source_id, hotel: 'TEST HOTEL', room_arrangement: 'TWN', duration_days: 3, amount: '75' }, actor: 'LOCAL_STAFF' });
    assert.equal(rate.ok, true, JSON.stringify(rate.error));
    assert.equal(rate.data.amount, '75.00');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
