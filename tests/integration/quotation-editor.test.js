'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createLocalRuntime } = require('../../src/services');
const { createOperationsMvp } = require('../../src/application/operations-mvp');
const { buildClientPreview, calculateTotals } = require('../../src/application/quotation-editor');
const paymentConversion = require('../../src/application/payment-conversion');

function setup() {
  const runtime = createLocalRuntime({ clock: () => new Date('2026-08-12T10:00:00.000Z') });
  const app = createOperationsMvp({ runtime });
  assert.equal(runtime.services.Client.create({ client_id:'CLIENT-TEST-000040', client_type:'Company', legal_name:'Synthetic Client Co.', display_name:'Synthetic Client Co.', primary_email:'synthetic@example.test', status:'Active' }).ok, true);
  assert.equal(runtime.services.Supplier.create({ supplier_id:'SUPPLIER-TEST-000040', supplier_type:'Tour Operator', legal_name:'Synthetic Supplier', display_name:'Synthetic Supplier', status:'Active' }).ok, true);
  assert.equal(app.createLead({ lead_id:'LEAD-2026-000040', source:'Other', lead_type:'B2C', client_id:'CLIENT-TEST-000040', contact_name:'Synthetic Client Co.', destination:'Synthetic Vietnam', travel_start:'2026-10-07', travel_end:'2026-10-11', pax_count:4, currency:'PHP' }).ok, true);
  assert.equal(app.createQuotationFromLead({ quotation_id:'QUOTATION-2026-000040', lead_id:'LEAD-2026-000040', valid_until:'2026-08-19', inclusions:'Hotel and transfers', exclusions:'Personal expenses', payment_terms:'50% deposit before confirmation', payment_currency_policy:'USD preferred; PHP at BDO Forex Selling Rate + 1.0 on payment date.', itinerary:'Day 1 — Arrival\nDay 2 — City tour' }).ok, true);
  return { runtime, app };
}

test('manual quotation editor calculates multiple items and keeps client preview free of internal cost data', () => {
  const { app } = setup();
  assert.equal(app.addQuotationItem({ quotation_id:'QUOTATION-2026-000040', quotation_item_id:'QUOTATION_ITEM-2026-000040', service_type:'Hotel', description:'Synthetic hotel', supplier_id:'SUPPLIER-TEST-000040', quantity:4, unit_cost:2000, unit_selling_price:2500, currency:'PHP', line_order:1 }).ok, true);
  assert.equal(app.addQuotationItem({ quotation_id:'QUOTATION-2026-000040', quotation_item_id:'QUOTATION_ITEM-2026-000041', service_type:'Transfer', description:'Synthetic transfers', quantity:1, unit_cost:1000, unit_selling_price:1500, currency:'PHP', line_order:2 }).ok, true);
  const editor = app.getQuotationEditor('QUOTATION-2026-000040');
  assert.equal(editor.ok, true);
  assert.equal(editor.data.totals.supplier_cost_total, 9000);
  assert.equal(editor.data.totals.client_total, 11500);
  const preview = app.getClientQuotationPreview('QUOTATION-2026-000040');
  assert.equal(preview.ok, true);
  assert.equal(preview.data.items.length, 1);
  assert.equal(preview.data.items[0].service_type, 'Tour Package');
  assert.equal(preview.data.items[0].amount, 11500);
  assert.equal(preview.data.brand.name, 'World Master International Travel');
  assert.equal(preview.data.brand.logo_asset, 'header.png');
  assert.equal(preview.data.quotation.client_total, 11500);
  assert.equal(preview.data.quotation.itinerary, 'Day 1 — Arrival\nDay 2 — City tour');
  assert.match(preview.data.quotation.payment_currency_policy, /BDO/);
  assert.equal(Object.prototype.hasOwnProperty.call(preview.data, 'supplier_cost_total'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(preview.data.items[0], 'unit_cost'), false);
  assert.equal(JSON.stringify(preview.data).includes('Synthetic Supplier'), false);
});

test('payment conversion preserves actual PHP installments and invoice-currency equivalents', () => {
  const converted = paymentConversion.preparePayment({ amount: 61250, payment_currency:'PHP', invoice_currency:'USD', exchange_rate:61.25, exchange_rate_date:'2026-08-12' });
  assert.equal(converted.payment_amount_minor, 6125000);
  assert.equal(converted.invoice_amount_minor, 100000);
  assert.equal(converted.exchange_rate, 61.25);
  assert.equal(converted.exchange_rate_date, '2026-08-12');
  assert.equal(paymentConversion.preparePayment({ amount:100, payment_currency:'USD', invoice_currency:'USD' }).invoice_amount_minor, 10000);
  assert.throws(() => paymentConversion.preparePayment({ amount:61250, payment_currency:'PHP', invoice_currency:'USD' }), /conversion rate/);
});

test('manual quotation editor updates, reorders, and removes unbooked items', () => {
  const { app } = setup();
  app.addQuotationItem({ quotation_id:'QUOTATION-2026-000040', quotation_item_id:'QUOTATION_ITEM-2026-000040', service_type:'Tour', description:'First item', quantity:1, unit_cost:100, unit_selling_price:200, currency:'PHP', line_order:1 });
  app.addQuotationItem({ quotation_id:'QUOTATION-2026-000040', quotation_item_id:'QUOTATION_ITEM-2026-000041', service_type:'Hotel', description:'Second item', quantity:1, unit_cost:200, unit_selling_price:300, currency:'PHP', line_order:2 });
  const updated = app.updateQuotationItem({ quotation_item_id:'QUOTATION_ITEM-2026-000040', description:'Updated first item', unit_cost:150, unit_selling_price:250, quantity:2, currency:'PHP', line_order:2 });
  assert.equal(updated.ok, true);
  assert.equal(app.reorderQuotationItems({ quotation_id:'QUOTATION-2026-000040', quotation_item_ids:['QUOTATION_ITEM-2026-000041','QUOTATION_ITEM-2026-000040'] }).ok, true);
  assert.equal(app.removeQuotationItem({ quotation_item_id:'QUOTATION_ITEM-2026-000041' }).ok, true);
  const editor = app.getQuotationEditor('QUOTATION-2026-000040');
  assert.equal(editor.data.items.length, 1);
  assert.equal(editor.data.items[0].description, 'Updated first item');
});

test('quotation totals reject invalid negative adjustments and invalid quotation saves', () => {
  assert.throws(() => calculateTotals([{ quantity:1, unit_cost:10, unit_selling_price:10 }], { discount_total:11 }), /cannot make the total negative/);
  const { app } = setup();
  const result = app.updateQuotation({ quotation_id:'QUOTATION-2026-000040', client_id:'', destination:'' });
  assert.equal(result.ok, false);
  assert.equal(result.error.details.errors[0].field, 'client_id');
});

test('quotation updates are atomic when an invalid discount would make the total negative', () => {
  const { app } = setup();
  app.addQuotationItem({ quotation_id:'QUOTATION-2026-000040', quotation_item_id:'QUOTATION_ITEM-2026-000040', service_type:'Hotel', description:'Atomic test item', quantity:1, unit_cost:50, unit_selling_price:100, currency:'PHP' });
  const before = JSON.parse(JSON.stringify(app.getQuotationEditor('QUOTATION-2026-000040').data.quotation));
  const failed = app.updateQuotation({ quotation_id:'QUOTATION-2026-000040', discount_total:101 });
  assert.equal(failed.ok, false);
  const after = app.getQuotationEditor('QUOTATION-2026-000040');
  assert.equal(after.ok, true);
  assert.deepEqual(after.data.quotation, before);
  assert.equal(after.data.totals.client_total, 100);
  const invalidValue = app.updateQuotation({ quotation_id:'QUOTATION-2026-000040', discount_total:'not-money' });
  assert.equal(invalidValue.ok, false);
  assert.equal(app.getQuotationEditor('QUOTATION-2026-000040').data.quotation.discount_total, before.discount_total);
});

test('quotation items must use the quotation currency and rejected writes preserve state', () => {
  const { app } = setup();
  const accepted = app.addQuotationItem({ quotation_id:'QUOTATION-2026-000040', quotation_item_id:'QUOTATION_ITEM-2026-000040', service_type:'Hotel', description:'USD hotel', quantity:1, unit_cost:10, unit_selling_price:20, currency:'PHP' });
  assert.equal(accepted.ok, true);
  const before = app.getQuotationEditor('QUOTATION-2026-000040').data;
  const rejected = app.addQuotationItem({ quotation_id:'QUOTATION-2026-000040', quotation_item_id:'QUOTATION_ITEM-2026-000041', service_type:'Flight', description:'USD flight mismatch', quantity:1, unit_cost:10, unit_selling_price:20, currency:'USD' });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'CURRENCY_MISMATCH');
  const afterAdd = app.getQuotationEditor('QUOTATION-2026-000040').data;
  assert.deepEqual(afterAdd.items, before.items);
  const rejectedUpdate = app.updateQuotationItem({ quotation_item_id:'QUOTATION_ITEM-2026-000040', currency:'USD' });
  assert.equal(rejectedUpdate.ok, false);
  assert.equal(rejectedUpdate.error.code, 'CURRENCY_MISMATCH');
  assert.equal(app.getQuotationEditor('QUOTATION-2026-000040').data.items[0].currency, 'PHP');
});

test('newly created lead can immediately become the quotation lead without relying on array order', () => {
  const { app } = setup();
  const leadB = app.createLead({ lead_id:'LEAD-2026-000041', source:'Other', lead_type:'B2C', client_id:'CLIENT-TEST-000040', contact_name:'Second Synthetic Lead', destination:'Second Destination', currency:'USD' });
  assert.equal(leadB.ok, true);
  const quotation = app.createQuotationFromLead({ quotation_id:'QUOTATION-2026-000041', lead_id:leadB.data.lead_id, currency:'USD' });
  assert.equal(quotation.ok, true);
  assert.equal(quotation.data.lead_id, leadB.data.lead_id);
  assert.equal(app.getLead('LEAD-2026-000040').data.destination, 'Synthetic Vietnam');
});

test('quotation creation form exposes core context and preview hides a blank discount line', () => {
  const html = fs.readFileSync('app/public/index.html', 'utf8');
  const header = fs.statSync('app/public/assets/header.png');
  const appSource = fs.readFileSync('app/public/app.js', 'utf8');
  const css = fs.readFileSync('app/public/styles.css', 'utf8');
  assert.match(html, /id="quotation-lead"/);
  assert.match(html, /name="currency"/);
  assert.match(html, /name="destination"/);
  assert.match(html, /name="travel_start"/);
  assert.match(html, /name="travel_end"/);
  assert.match(html, /name="pax_count"/);
  assert.match(html, /id="add-itinerary-day"/);
  assert.match(appSource, /data-itinerary-field/);
  assert.ok(header.size > 100000);
    assert.match(appSource, /const discountLine = Number\(q\.discount_total \|\| 0\) > 0/);
    assert.match(appSource, /const hasServiceDates = data\.items\.some/);
    assert.match(appSource, /const datesHeader = hasServiceDates \? '<th>Dates<\/th>' : ''/);
    assert.match(appSource, /const datesCell = \(item\) => hasServiceDates/);
    assert.match(appSource, /const finalPageClass = itineraryDays\.length >= 5/);
  assert.match(appSource, /selectedLeadId = result\.data\.lead_id/);
  assert.match(css, /\.quote-header \{ display:block/);
    assert.match(css, /\.wmit-logo \{[^}]*max-width:100%/);
    assert.match(css, /\.quote-final-page\.long \{ break-inside:avoid/);
    assert.match(css, /@media print/);
});

test('structured quotation itinerary preserves separate days, meals, and overnight details', () => {
  const { app } = setup();
  app.updateQuotation({ quotation_id:'QUOTATION-2026-000040', itinerary:JSON.stringify([
    { day:1, date:'2026-10-07', title:'Arrival', city:'Seoul', activities:'Airport transfer and check-in', meals:'Dinner', overnight:'Synthetic Seoul Hotel' },
    { day:2, date:'2026-10-08', title:'City tour', city:'Seoul', activities:'Palace and market visit', meals:'Breakfast, lunch', overnight:'Synthetic Seoul Hotel' }
  ]) });
  const preview = app.getClientQuotationPreview('QUOTATION-2026-000040');
  assert.equal(preview.ok, true);
  assert.equal(preview.data.quotation.itinerary_days.length, 2);
  assert.equal(preview.data.quotation.itinerary_days[0].meals, 'Dinner');
  assert.equal(preview.data.quotation.itinerary_days[1].overnight, 'Synthetic Seoul Hotel');
});

test('quotation money uses safe integer minor units and rejects only unsupported oversized lines', () => {
  const supported = calculateTotals([{ quantity:1, unit_cost:90071992547409.90, unit_selling_price:90071992547409.90 }], {});
  assert.equal(supported.client_total, 90071992547409.9);
  assert.throws(() => calculateTotals([{ quantity:1000000, unit_cost:999999999.99, unit_selling_price:999999999.99 }], {}), /too large for exact local calculation/);
});

test('quotation calculation and preview module is portable to Apps Script', () => {
  const source = fs.readFileSync(require.resolve('../../src/application/quotation-editor'), 'utf8');
  assert.doesNotMatch(source, /require\(|process\.|window\.|fetch\(/);
  assert.match(fs.readFileSync('apps-script/appsscript.json', 'utf8'), /"runtimeVersion"\s*:\s*"V8"/);
});
