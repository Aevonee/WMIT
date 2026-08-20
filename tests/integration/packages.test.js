'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhase1Runtime, ACTIONS } = require('../../src/phase1/runtime');
const { createPhase1Application } = require('../../src/application/phase1');
const { createMvpServer } = require('../../app/server');

const CLOCK = () => new Date('2026-08-21T09:00:00Z');

const AUTH = {
  staff: [ACTIONS.EDIT_DRAFT_PRICING, ACTIONS.ACCEPT_QUOTATION, ACTIONS.SELECT_OPTION],
  manager: [ACTIONS.APPROVE_QUOTATION]
};
const staff = () => ({ actor: 'staff', correlationId: 'PKG-TEST' });
const manager = () => ({ actor: 'manager', correlationId: 'PKG-TEST' });

function makeRuntime() {
  return createPhase1Runtime({ clock: CLOCK, config: { trustedActors: AUTH } });
}

function seedSupplier(runtime) {
  return runtime.createSupplier({ display_name: 'Package Wholesaler', legal_name: 'Package Wholesaler Inc' }, staff()).data;
}

function packageInput(overrides) {
  return Object.assign({
    supplier_id: 'SUPPLIER-000001',
    name: 'Da Nang Escape 4D3N',
    destination: 'Da Nang',
    price_amount: '21750.00',
    currency: 'PHP',
    pax_basis: 'PER_PERSON',
    duration_days: 4,
    inclusions: ['Round-trip airfare', '3 nights hotel with breakfast'],
    exclusions: ['Travel tax', 'Visa fee'],
    itinerary_days: [
      { day: 1, title: 'Arrival', activities: 'Airport transfer and welcome dinner', meals: 'Dinner', overnight: 'Da Nang Hotel' },
      { day: 2, title: 'Ba Na Hills', activities: 'Cable car and Golden Bridge', meals: 'Breakfast, Lunch' }
    ],
    notes: 'Flyer rate valid Sep-Nov 2026.'
  }, overrides || {});
}

function makeClientAndInquiry(runtime, options) {
  const opts = options || {};
  const client = runtime.createClient({ display_name: opts.clientName || 'Package Client', primary_email: 'pkg@example.test' }, staff()).data;
  const inquiry = runtime.createInquiry({ client_id: client.client_id, requirements: { destination: 'Da Nang', travel_start: '2026-09-10', travel_end: '2026-09-13', pax_count: 2 } }, staff()).data;
  return { client, inquiry };
}

test('createPackage validates, defaults, and audits the reusable package record', () => {
  const runtime = makeRuntime();
  seedSupplier(runtime);
  const created = runtime.createPackage(packageInput(), staff());
  assert.equal(created.ok, true);
  assert.equal(created.meta.action, 'CREATE_PACKAGE');
  assert.match(created.data.supplier_package_id, /^SUPPLIER_PACKAGE-2026-\d{6}$/);
  assert.equal(created.data.status, 'DRAFT');
  assert.equal(created.data.source, 'MANUAL');
  assert.equal(created.data.source_document_id, null);
  assert.equal(created.data.availability_state, 'NOT_CHECKED', 'legacy matching field retained');
  assert.equal(created.data.price_amount, '21750.00');
  assert.equal(created.data.currency, 'PHP');
  assert.equal(created.data.pax_basis, 'PER_PERSON');
  assert.equal(created.data.duration_days, 4);
  assert.equal(created.data.itinerary_days.length, 2);
  assert.equal(created.data.itinerary_days[0].title, 'Arrival');
  assert.equal(created.data.created_by, 'staff');
  assert.ok(runtime.auditLog.list().some((entry) => entry.action === 'CREATE_PACKAGE' && entry.result === 'SUCCESS' && entry.entity_id === created.data.supplier_package_id));

  runtime.createSupplier({ supplier_id: 'SUPPLIER-000002', display_name: 'Second Wholesaler', legal_name: 'SW' }, staff());
  const cases = [
    [{ name: 'No supplier' }, 'REQUIRED_FIELD'],
    [packageInput({ supplier_id: 'SUPPLIER-9999' }), 'NOT_FOUND'],
    [packageInput({ name: '' }), 'REQUIRED_FIELD'],
    [packageInput({ destination: '' }), 'REQUIRED_FIELD'],
    [packageInput({ price_amount: '0.00' }), 'INVALID_MONEY'],
    [packageInput({ price_amount: 'abc' }), 'INVALID_MONEY'],
    [packageInput({ currency: 'PESOS' }), 'INVALID_CURRENCY'],
    [packageInput({ pax_basis: 'PER_ELEPHANT' }), 'PACKAGE_PAX_BASIS_INVALID'],
    [packageInput({ travel_start: '2026-09-10', travel_end: '2026-09-05' }), 'PACKAGE_DATE_RANGE_INVALID'],
    [packageInput({ travel_start: 'Sept 10' }), 'PACKAGE_DATE_INVALID'],
    [packageInput({ duration_days: 0 }), 'PACKAGE_DURATION_INVALID'],
    [packageInput({ duration_days: 90 }), 'PACKAGE_DURATION_INVALID'],
    [packageInput({ itinerary_days: 'not-json[' }), 'PACKAGE_ITINERARY_INVALID'],
    [packageInput({ inclusions: Array.from({ length: 41 }, (_, index) => 'Item ' + index) }), 'PACKAGE_LIST_TOO_LONG'],
    [packageInput({ source: 'TELEPATHY' }), 'PACKAGE_SOURCE_INVALID'],
    [packageInput({ status: 'CONFIRMED' }), 'PACKAGE_STATUS_INVALID'],
    [packageInput({ source: 'FLYER_IMPORT' }), 'FLYER_SOURCE_REQUIRED'],
    [packageInput({ source_document_id: 'DOCUMENT-2026-000001' }), 'PACKAGE_SOURCE_INVALID']
  ];
  cases.forEach(([input, code]) => {
    const result = runtime.createPackage(input, staff());
    assert.equal(result.ok, false, JSON.stringify(input.name || input));
    assert.equal(result.error.code, code, JSON.stringify(input.name || input));
  });
  const failures = runtime.auditLog.list().filter((entry) => entry.action === 'CREATE_PACKAGE' && entry.result === 'FAILURE');
  assert.equal(failures.length, cases.length, 'every rejected create audited a failure row');

  const durationDerived = runtime.createPackage(packageInput({ travel_start: '2026-09-10', travel_end: '2026-09-13', duration_days: undefined }), staff());
  assert.equal(durationDerived.ok, true);
  assert.equal(durationDerived.data.duration_days, 4, 'duration derived from date range');
});

test('updatePackage locks confirmed and archived packages while drafts stay fully editable', () => {
  const runtime = makeRuntime();
  seedSupplier(runtime);
  runtime.createSupplier({ supplier_id: 'SUPPLIER-000002', display_name: 'Second Wholesaler', legal_name: 'SW' }, staff());
  const pkg = runtime.createPackage(packageInput(), staff()).data;

  const renamed = runtime.updatePackage({ supplier_package_id: pkg.supplier_package_id, name: 'Da Nang Escape 4D3N (2026)', price_amount: '22900.50', supplier_id: 'SUPPLIER-000002' }, staff());
  assert.equal(renamed.ok, true);
  assert.equal(renamed.data.name, 'Da Nang Escape 4D3N (2026)');
  assert.equal(renamed.data.price_amount, '22900.50');
  assert.equal(renamed.data.supplier_id, 'SUPPLIER-000002');
  assert.ok(runtime.auditLog.list().some((entry) => entry.action === 'UPDATE_PACKAGE' && entry.result === 'SUCCESS'));

  const invalid = runtime.updatePackage({ supplier_package_id: pkg.supplier_package_id, price_amount: '0.00' }, staff());
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'INVALID_MONEY');
  const noChanges = runtime.updatePackage({ supplier_package_id: pkg.supplier_package_id }, staff());
  assert.equal(noChanges.ok, false);
  assert.equal(noChanges.error.code, 'NO_CHANGES');
  const missing = runtime.updatePackage({ supplier_package_id: 'SUPPLIER_PACKAGE-2026-999999', name: 'X' }, staff());
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'NOT_FOUND');
  assert.ok(runtime.auditLog.list().some((entry) => entry.action === 'UPDATE_PACKAGE' && entry.result === 'FAILURE'));

  assert.equal(runtime.confirmPackage({ supplier_package_id: pkg.supplier_package_id }, staff()).ok, true);
  const locked = runtime.updatePackage({ supplier_package_id: pkg.supplier_package_id, price_amount: '99999.00' }, staff());
  assert.equal(locked.ok, false);
  assert.equal(locked.error.code, 'PACKAGE_LOCKED');
  assert.deepEqual(locked.error.details.fields, ['price_amount']);
  const notesOk = runtime.updatePackage({ supplier_package_id: pkg.supplier_package_id, notes: 'Owner approved this rate.' }, staff());
  assert.equal(notesOk.ok, true);
  assert.equal(notesOk.data.notes, 'Owner approved this rate.');

  assert.equal(runtime.archivePackage({ supplier_package_id: pkg.supplier_package_id, reason: 'Supplier pulled the rate' }, staff()).ok, true);
  const archivedLock = runtime.updatePackage({ supplier_package_id: pkg.supplier_package_id, notes: 'try again' }, staff());
  assert.equal(archivedLock.ok, false);
  assert.equal(archivedLock.error.code, 'PACKAGE_LOCKED');
});

test('confirmPackage and archivePackage enforce the lifecycle and audit transitions', () => {
  const runtime = makeRuntime();
  seedSupplier(runtime);
  const pkg = runtime.createPackage(packageInput(), staff()).data;

  assert.equal(runtime.confirmPackage({ supplier_package_id: 'SUPPLIER_PACKAGE-2026-999999' }, staff()).ok, false);
  const confirmed = runtime.confirmPackage({ supplier_package_id: pkg.supplier_package_id }, staff());
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.data.status, 'CONFIRMED');
  assert.equal(confirmed.data.confirmed_by, 'staff');
  const idempotent = runtime.confirmPackage({ supplier_package_id: pkg.supplier_package_id }, staff());
  assert.equal(idempotent.ok, true);
  assert.equal(idempotent.meta.idempotent, true);

  const archived = runtime.archivePackage({ supplier_package_id: pkg.supplier_package_id, reason: 'Rate expired' }, staff());
  assert.equal(archived.ok, true);
  assert.equal(archived.data.status, 'ARCHIVED');
  assert.equal(runtime.archivePackage({ supplier_package_id: pkg.supplier_package_id }, staff()).meta.idempotent, true);
  const confirmArchived = runtime.confirmPackage({ supplier_package_id: pkg.supplier_package_id }, staff());
  assert.equal(confirmArchived.ok, false);
  assert.equal(confirmArchived.error.code, 'PACKAGE_STATE_INVALID');
  assert.equal(runtime.archivePackage({ supplier_package_id: 'SUPPLIER_PACKAGE-2026-999999' }, staff()).ok, false);
  ['CONFIRM_PACKAGE', 'ARCHIVE_PACKAGE'].forEach((action) => {
    assert.ok(runtime.auditLog.list().some((entry) => entry.action === action && entry.result === 'SUCCESS'), action + ' audited');
    assert.ok(runtime.auditLog.list().some((entry) => entry.action === action && entry.result === 'FAILURE'), action + ' failures audited');
  });
});

test('listPackages filters by supplier, destination, and status', () => {
  const runtime = makeRuntime();
  seedSupplier(runtime);
  runtime.createSupplier({ supplier_id: 'SUPPLIER-000002', display_name: 'Beach Wholesaler', legal_name: 'BW' }, staff());
  const daNang = runtime.createPackage(packageInput(), staff()).data;
  const confirmed = runtime.createPackage(packageInput({ name: 'Confirmed Package', destination: 'Bangkok', supplier_id: 'SUPPLIER-000002' }), staff()).data;
  runtime.confirmPackage({ supplier_package_id: confirmed.supplier_package_id }, staff());
  runtime.createPackage(packageInput({ name: 'Archived Package' }), staff()).data
    && runtime.archivePackage({ supplier_package_id: runtime.list('SupplierPackage').find((pkg) => pkg.name === 'Archived Package').supplier_package_id }, staff());

  const all = runtime.listPackages({}, staff());
  assert.equal(all.ok, true);
  assert.equal(all.meta.read_only, true);
  assert.equal(all.data.counts.total, 3);
  assert.equal(all.data.counts.DRAFT, 1);
  assert.equal(all.data.counts.CONFIRMED, 1);
  assert.equal(all.data.counts.ARCHIVED, 1);

  assert.equal(runtime.listPackages({ supplier_id: 'SUPPLIER-000001' }, staff()).data.counts.total, 2);
  assert.equal(runtime.listPackages({ destination: 'bang' }, staff()).data.counts.total, 1);
  assert.equal(runtime.listPackages({ status: 'CONFIRMED' }, staff()).data.packages[0].supplier_package_id, confirmed.supplier_package_id);
  assert.equal(runtime.listPackages({ status: 'WEIRD' }, staff()).error.code, 'PACKAGE_STATUS_INVALID');
  assert.equal(runtime.listPackages({ supplier_id: 'SUPPLIER-9999' }, staff()).error.code, 'NOT_FOUND');
  assert.ok(runtime.auditLog.list().some((entry) => entry.action === 'LIST_PACKAGES' && entry.result === 'SUCCESS' && entry.details.count === 3));
  assert.equal(daNang.supplier_package_id.startsWith('SUPPLIER_PACKAGE-'), true);
});

test('createQuotationFromPackage produces a draft quotation with itinerary, terms, and one package item', () => {
  const runtime = makeRuntime();
  seedSupplier(runtime);
  const { client, inquiry } = makeClientAndInquiry(runtime);
  const pkg = runtime.createPackage(packageInput({ travel_start: '2026-09-10', travel_end: '2026-09-13', duration_days: undefined }), staff()).data;

  const tooEarly = runtime.createQuotationFromPackage({ package_id: pkg.supplier_package_id, client_id: client.client_id }, staff());
  assert.equal(tooEarly.ok, false);
  assert.equal(tooEarly.error.code, 'PACKAGE_NOT_CONFIRMED', 'drafts never quote — human confirmation required');
  assert.equal(runtime.list('Quotation').length, 0);
  runtime.confirmPackage({ supplier_package_id: pkg.supplier_package_id }, staff());

  const created = runtime.createQuotationFromPackage({ package_id: pkg.supplier_package_id, inquiry_id: inquiry.inquiry_id, client_id: client.client_id }, staff());
  assert.equal(created.ok, true, JSON.stringify(created.error));
  assert.equal(created.meta.action, 'CREATE_QUOTATION_FROM_PACKAGE');
  const quote = created.data.quotation;
  assert.equal(quote.status, 'DRAFT');
  assert.equal(quote.inquiry_id, inquiry.inquiry_id);
  assert.equal(quote.supplier_package_id, pkg.supplier_package_id);
  assert.equal(quote.destination, 'Da Nang');
  assert.equal(quote.travel_start, '2026-09-10');
  assert.equal(quote.travel_end, '2026-09-13');
  assert.equal(quote.pax_count, 2, 'pax falls back to the inquiry requirements');
  assert.equal(quote.currency, 'PHP');
  assert.equal(quote.inclusions, 'Round-trip airfare\n3 nights hotel with breakfast');
  assert.equal(quote.exclusions, 'Travel tax\nVisa fee');
  const days = JSON.parse(quote.itinerary);
  assert.equal(days.length, 2);
  assert.equal(days[1].title, 'Ba Na Hills');

  const item = created.data.item;
  assert.equal(item.service_type, 'Tour Package');
  assert.equal(item.description, 'Da Nang Escape 4D3N');
  assert.equal(item.supplier_id, 'SUPPLIER-000001');
  assert.equal(item.quantity, 2, 'PER_PERSON price multiplies by pax');
  assert.equal(item.unit_cost, '21750.00');
  assert.equal(item.unit_selling_price, '21750.00');
  assert.equal(item.currency, 'PHP');
  assert.equal(quote.client_total, '43500.00');
  assert.equal(quote.supplier_cost_total, '43500.00');
  assert.ok(runtime.auditLog.list().some((entry) => entry.action === 'CREATE_QUOTATION_FROM_PACKAGE' && entry.result === 'SUCCESS' && entry.entity_id === quote.quotation_id));

  const groupPkg = runtime.createPackage(packageInput({ name: 'Group Buyout', pax_basis: 'PER_GROUP', price_amount: '150000.00' }), staff()).data;
  runtime.confirmPackage({ supplier_package_id: groupPkg.supplier_package_id }, staff());
  const group = runtime.createQuotationFromPackage({ package_id: groupPkg.supplier_package_id, client_id: client.client_id, pax_count: 12 }, staff());
  assert.equal(group.ok, true);
  assert.equal(group.data.item.quantity, 1, 'PER_GROUP price is a single line');
  assert.equal(group.data.quotation.client_total, '150000.00');
  assert.equal(group.data.quotation.pax_count, 12, 'explicit pax override recorded on the quotation');

  const priced = runtime.createQuotationFromPackage({ package_id: pkg.supplier_package_id, client_id: client.client_id, unit_selling_price: '25000.00' }, staff());
  assert.equal(priced.ok, true);
  assert.equal(priced.data.item.unit_selling_price, '25000.00', 'selling price override is honoured');

  const mismatch = runtime.createQuotationFromPackage({ package_id: pkg.supplier_package_id, client_id: client.client_id, inquiry_id: 'INQUIRY-2026-999999' }, staff());
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.error.code, 'NOT_FOUND');
  const badPax = runtime.createQuotationFromPackage({ package_id: pkg.supplier_package_id, client_id: client.client_id, pax_count: 0 }, staff());
  assert.equal(badPax.ok, false);
  assert.equal(badPax.error.code, 'INVALID_PAX_COUNT');
  assert.ok(runtime.auditLog.list().some((entry) => entry.action === 'CREATE_QUOTATION_FROM_PACKAGE' && entry.result === 'FAILURE'));

  runtime.archivePackage({ supplier_package_id: pkg.supplier_package_id }, staff());
  const archived = runtime.createQuotationFromPackage({ package_id: pkg.supplier_package_id, client_id: client.client_id }, staff());
  assert.equal(archived.ok, false);
  assert.equal(archived.error.code, 'PACKAGE_ARCHIVED');
});

test('a failed package quotation line item rolls back the whole quotation (fail closed)', () => {
  const runtime = makeRuntime();
  seedSupplier(runtime);
  const { client } = makeClientAndInquiry(runtime);
  const pkg = runtime.createPackage(packageInput(), staff()).data;
  runtime.confirmPackage({ supplier_package_id: pkg.supplier_package_id }, staff());
  // Selling below the package cost is rejected by quotation item rules; the
  // quotation created moments before must not survive.
  const failed = runtime.createQuotationFromPackage({ package_id: pkg.supplier_package_id, client_id: client.client_id, unit_selling_price: '1.00' }, staff());
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, 'SELLING_BELOW_COST');
  assert.equal(runtime.list('Quotation').length, 0, 'no orphan quotation remains');
  assert.equal(runtime.list('QuotationItem').length, 0);
  const rollback = runtime.auditLog.list().filter((entry) => entry.action === 'DELETE' && entry.entity_type === 'Quotation');
  assert.equal(rollback.length, 1, 'the rollback delete is audited');
  assert.equal(runtime.auditLog.list().filter((entry) => entry.action === 'CREATE_QUOTATION_FROM_PACKAGE' && entry.result === 'FAILURE').length, 1);
});

test('package CRUD and quotation-from-package work over HTTP through the whitelisted dispatcher', async () => {
  const runtime = makeRuntime();
  seedSupplier(runtime);
  const phase1App = createPhase1Application({ runtime, seedSynthetic: false });
  const { server } = createMvpServer({ phase1App });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = async (body) => {
    const response = await fetch(base + '/api/phase1/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const created = await post({ action: 'createPackage', input: packageInput({ travel_start: '2026-09-10', travel_end: '2026-09-13', duration_days: undefined }), actor: 'staff' });
    assert.equal(created.status, 200);
    const packageId = created.body.data.supplier_package_id;
    assert.match(packageId, /^SUPPLIER_PACKAGE-2026-\d{6}$/);

    const listed = await post({ action: 'listPackages', input: { status: 'DRAFT' }, actor: 'staff' });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.data.counts.DRAFT, 1);

    const confirmed = await post({ action: 'confirmPackage', input: { supplier_package_id: packageId }, actor: 'staff' });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.data.status, 'CONFIRMED');

    const client = runtime.createClient({ display_name: 'HTTP Package Client', primary_email: 'http-pkg@example.test' }, staff()).data;
    const inquiry = runtime.createInquiry({ client_id: client.client_id, requirements: { destination: 'Da Nang', travel_start: '2026-09-10', travel_end: '2026-09-13', pax_count: 3 } }, staff()).data;
    const quoted = await post({ action: 'createQuotationFromPackage', input: { package_id: packageId, client_id: client.client_id, inquiry_id: inquiry.inquiry_id }, actor: 'staff' });
    assert.equal(quoted.status, 200);
    assert.equal(quoted.body.data.quotation.status, 'DRAFT');
    assert.equal(quoted.body.data.item.service_type, 'Tour Package');
    assert.equal(quoted.body.data.item.quantity, 3);
    assert.equal(quoted.body.data.quotation.client_total, '65250.00');

    const archived = await post({ action: 'archivePackage', input: { supplier_package_id: packageId }, actor: 'staff' });
    assert.equal(archived.status, 200);
    assert.equal(archived.body.data.status, 'ARCHIVED');

    const unknown = await post({ action: 'createPackage', input: { supplier_id: 'SUPPLIER-9999', name: 'X', destination: 'Y', price_amount: '1.00' }, actor: 'staff' });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.error.code, 'NOT_FOUND');

    const internal = await post({ action: 'packageValidatedFields', input: {}, actor: 'staff' });
    assert.equal(internal.status, 400);
    assert.equal(internal.body.error.code, 'UNKNOWN_ACTION', 'internal helpers stay off the dispatcher whitelist');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
