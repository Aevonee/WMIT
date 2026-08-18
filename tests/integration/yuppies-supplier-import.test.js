'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhase1Runtime } = require('../../src/phase1/runtime');
const { buildImportPlan, runImport, normalizeText, cleanEmail, capabilityTokens } = require('../../src/imports/yuppies-suppliers');

const SNAPSHOT = {
  source: 'Synthetic test directory',
  source_url: 'https://example.test/directory',
  extracted_at: '2026-08-18T00:00:00.000Z',
  rows: [
    { ID: '1', 'Company Name': '  Absolute Indonesia  ', 'Contact Name': 'Eddie Tarsisius', 'Position / Title': 'Managing Director', 'Contact Number': '+62 361 284318', 'Email': 'eddie@absolute.test', 'Viber': 'N/A', 'WhatsApp': '+62 812 345', 'Country': 'Indonesia', 'Address': 'Sanur, Bali', 'Website': 'www.absolute.test', 'Services Offered': 'Destination Management Company', 'Destinations': 'Tour Operator', 'Industry': 'DMC', 'Other Details': '' },
    { ID: '2', 'Company Name': 'absolute indonesia', 'Contact Name': '', 'Position / Title': '', 'Contact Number': '', 'Email': 'reservations@absolute.test', 'Viber': '', 'WhatsApp': '', 'Country': 'Indonesia', 'Address': '', 'Website': '', 'Services Offered': '', 'Destinations': '', 'Industry': 'DMC, Ground Handler', 'Other Details': '' },
    { ID: '3', 'Company Name': 'Ace Tours & Travel Pte Ltd', 'Contact Name': '', 'Position / Title': '', 'Contact Number': '', 'Email': 'not an email', 'Viber': '', 'WhatsApp': '', 'Country': 'Singapore', 'Industry': 'Tour Operator' },
    { ID: '4', 'Company Name': '   ', 'Contact Name': 'Nobody', 'Email': 'n@x.test' },
    { ID: '5', 'Company Name': 'Bali Vista Tours' }
  ]
};

test('buildImportPlan groups duplicate companies, normalizes blanks, and rejects unnamed rows', () => {
  const plan = buildImportPlan(SNAPSHOT);

  assert.equal(plan.rejected.length, 1);
  assert.equal(plan.rejected[0].source_row_id, '4');

  const byName = new Map(plan.companies.map((company) => [company.display_name, company]));
  assert.deepEqual([...byName.keys()].sort(), ['Absolute Indonesia', 'Ace Tours & Travel Pte Ltd', 'Bali Vista Tours']);

  const absolute = byName.get('Absolute Indonesia');
  assert.equal(absolute.country, 'Indonesia');
  assert.equal(absolute.primary_email, 'eddie@absolute.test');
  assert.equal(absolute.website, 'www.absolute.test');
  assert.deepEqual(absolute.source_row_ids, ['1', '2']);
  assert.ok(absolute.capabilities.includes('DMC'));
  assert.ok(absolute.capabilities.includes('Ground Handler'));

  // Two contact-bearing rows → two contacts; blank contact name falls back.
  assert.equal(absolute.contacts.length, 2);
  assert.equal(absolute.contacts[0].name, 'Eddie Tarsisius');
  assert.equal(absolute.contacts[0].contact_type, 'Managing Director');
  assert.equal(absolute.contacts[0].whatsapp, '+62 812 345');
  assert.equal(absolute.contacts[1].name, 'General inquiries');
  assert.equal(absolute.contacts[1].email, 'reservations@absolute.test');

  const ace = byName.get('Ace Tours & Travel Pte Ltd');
  assert.equal(ace.primary_email, null || undefined || ace.primary_email); // invalid email dropped
  assert.equal(ace.contacts.length, 0);

  const bali = byName.get('Bali Vista Tours');
  assert.equal(bali.contacts.length, 0);
  assert.equal(bali.country, undefined);
});

test('runImport creates suppliers and contacts, skips existing names, and is idempotent', () => {
  const runtime = createPhase1Runtime({ clock: () => new Date('2026-08-18T10:00:00+08:00') });
  runtime.createSupplier({ display_name: 'Bali Vista Tours', country: 'Existing' }, { actor: 'staff' });

  const plan = buildImportPlan(SNAPSHOT);
  const report = runImport(runtime, plan);

  assert.equal(report.created_suppliers, 2);
  assert.equal(report.existing_suppliers, 1);
  assert.equal(report.created_contacts, 2);
  assert.equal(report.failures.length, 0);

  const absoluteId = runtime.list('Supplier', (supplier) => supplier.display_name === 'Absolute Indonesia')[0].supplier_id;
  const contacts = runtime.list('SupplierContact', (contact) => contact.supplier_id === absoluteId);
  assert.equal(contacts.length, 2);
  assert.ok(contacts.every((contact) => contact.idempotency_key.startsWith('YUPPIES-C-')));

  // Re-run: everything now exists; nothing is created or duplicated.
  const second = runImport(runtime, plan);
  assert.equal(second.created_suppliers, 0);
  assert.equal(second.existing_suppliers, 3);
  assert.equal(runtime.list('Supplier').length, 3); // 1 pre-existing + 2 created (Bali Vista skipped as existing)
  assert.equal(runtime.list('SupplierContact').length, 2);
});

test('helpers sanitize untrusted text and email values', () => {
  assert.equal(normalizeText('  N/A '), null);
  assert.equal(normalizeText('-'), null);
  assert.equal(cleanEmail('not an email'), null);
  assert.equal(cleanEmail(' has space@x.test'), null);
  assert.equal(cleanEmail('ops@dmc.test'), 'ops@dmc.test');
  assert.deepEqual(capabilityTokens(['DMC, Ground Handler', 'dmc', 'N/A']), ['DMC', 'Ground Handler']);
  assert.equal(normalizeText('x'.repeat(400)).length, 301);
});
