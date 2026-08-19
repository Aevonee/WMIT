'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPdfDocument, encodeWinAnsi } = require('../../src/documents/pdf-writer');
const { buildInvoicePdf, buildItineraryPdf, buildReceiptPdf, buildVoucherPdf } = require('../../src/documents/client-documents-pdf');

const GENERATED_AT = new Date('2026-08-19T09:00:00.000Z');

function parseStartxref(buffer) {
  const tail = buffer.slice(-40).toString('latin1');
  const match = tail.match(/startxref\n(\d+)\n%%EOF\n$/);
  assert.ok(match, 'file must end with startxref + %%EOF + newline');
  return Number(match[1]);
}

function parseXref(buffer) {
  const xrefOffset = parseStartxref(buffer);
  assert.equal(buffer.slice(xrefOffset, xrefOffset + 4).toString('latin1'), 'xref', 'startxref must point at the xref table');
  const headerMatch = buffer.slice(xrefOffset, xrefOffset + 40).toString('latin1').match(/^xref\n0 (\d+)\n/);
  assert.ok(headerMatch, 'xref header must declare its size');
  const size = Number(headerMatch[1]);
  const firstEntryAt = xrefOffset + headerMatch[0].length;
  const entries = [];
  for (let i = 0; i < size; i += 1) {
    const entry = buffer.slice(firstEntryAt + i * 20, firstEntryAt + i * 20 + 20).toString('latin1');
    assert.equal(entry.length, 20, 'every xref entry must be exactly 20 bytes');
    entries.push(entry);
  }
  entries.forEach((entry, i) => {
    if (i === 0) {
      assert.match(entry, /^0000000000 65535 f \n$/, 'entry 0 must be the free head');
      return;
    }
    assert.match(entry, /^\d{10} 00000 n \n$/, 'entry ' + i + ' must be in-use and well-formed');
    const offset = Number(entry.slice(0, 10));
    const expected = i + ' 0 obj';
    assert.equal(buffer.slice(offset, offset + expected.length).toString('latin1'), expected, 'xref entry ' + i + ' must point at its object');
  });
  return { size, offsetsCount: entries.length };
}

function extractStreams(buffer) {
  const text = buffer.toString('latin1');
  const streams = [];
  let at = text.indexOf('stream\n');
  while (at !== -1) {
    const end = text.indexOf('\nendstream', at);
    if (end === -1) break;
    streams.push(text.slice(at + 7, end));
    at = text.indexOf('stream\n', end);
  }
  return streams;
}

function allText(buffer) {
  return extractStreams(buffer).join('\n');
}

function assertStructurallyValid(buffer, minPages) {
  assert.ok(buffer.slice(0, 8).toString('latin1') === '%PDF-1.4', 'PDF 1.4 header');
  assert.ok(buffer.slice(-7).toString('latin1') === '%%EOF\n'.slice(0, 7) || buffer.toString('latin1').endsWith('%%EOF\n'), 'EOF marker with trailing newline');
  const { size } = parseXref(buffer);
  const text = buffer.toString('latin1');
  const pageObjects = (text.match(/\/Type \/Page(?!s)/g) || []).length;
  assert.ok(pageObjects >= (minPages || 1), 'expected at least ' + (minPages || 1) + ' page objects, found ' + pageObjects);
  const countMatch = text.match(/\/Type \/Pages \/Count (\d+)/);
  assert.ok(countMatch, 'Pages object must declare /Count');
  assert.equal(Number(countMatch[1]), pageObjects, '/Count must match the page object total');
  const referenced = new Set();
  const refPattern = /(\d+) 0 R/g;
  let ref;
  while ((ref = refPattern.exec(text))) referenced.add(Number(ref[1]));
  referenced.forEach((number) => assert.ok(number < size, 'reference ' + number + ' must resolve inside the xref'));
  const winAnsiFonts = (text.match(/\/Encoding \/WinAnsiEncoding/g) || []).length;
  assert.equal(winAnsiFonts, 4, 'all four base-14 fonts use WinAnsiEncoding');
  const streams = extractStreams(buffer);
  assert.equal(streams.length, pageObjects, 'every page has exactly one content stream');
  streams.forEach((stream, index) => assert.ok(stream.length > 0, 'content stream ' + index + ' must not be empty'));
  return { pageObjects, streams };
}

const CLIENT_NAME = 'Jos\xE9 \\(Pepe\\) O\\\\Brien-\xD1a\xF1ez';

const invoiceData = {
  invoice: { booking_id: 'BOOKING-2026-000123', quotation_id: 'QUOTATION-2026-000045', client_name: 'José (Pepe) O\\Brien-Ñañez', destination: 'Seoul', travel_start: '2026-12-10', travel_end: '2026-12-16', pax_count: 2, currency: 'PHP', issued_at: '2026-08-19T09:00:00.000Z' },
  client: { name: 'José (Pepe) O\\Brien-Ñañez', email: 'pepe@example.test' },
  obligations: [
    { purpose: 'DOWN_PAYMENT', amount: '39000.00', currency: 'PHP', outstanding: '19500.00', dueAt: '2026-08-24T09:00:00.000Z', state: 'PARTIALLY_SATISFIED' },
    { purpose: 'FINAL_BALANCE', amount: '39000.00', currency: 'PHP', outstanding: '0.00', dueAt: '2026-11-02T09:00:00.000Z', state: 'SATISFIED' }
  ],
  totals: { obligationTotal: '78000.00', verifiedReceived: '58500.00', outstanding: '19500.00', currency: 'PHP' },
  paymentTerms: '50% down payment upon confirmation; balance 30 days before departure.',
  bankDetails: 'Banco De Oro (BDO)\nPeso Account: 123-4567-89\nSwift: BNORPHMM',
  supplier_cost_total: '51000.00'
};

const itineraryData = (dayCount) => ({
  itinerary: {
    destination: 'Seoul', travel_start: '2026-12-10', travel_end: '2026-12-16', pax_count: 2, currency: 'PHP', client_total: '78000.00', prepared_by: 'WMIT Staff', quotation_date: '2026-08-17',
    itinerary_days: Array.from({ length: dayCount }, (_, index) => ({
      day: index + 1, date: '2026-12-' + String(10 + index).padStart(2, '0'), title: 'Day ' + (index + 1) + ' activities and exploration', city: 'Seoul',
      activities: 'Morning city tour covering the palaces, afternoon at the market, evening Han River cruise with dinner.',
      meals: 'Breakfast, lunch', overnight: 'Grand Seoul Hotel'
    }))
  },
  flights: [{ route: 'MNL \u2013 ICN', airline: 'Philippine Airlines', flight_number: 'PR 466', times: '09:20 \u2013 14:55', service_date: '2026-12-10' }],
  vouchers: [{ voucher_number: 'VCH-2026-0001', service_type: 'Hotel', description: 'Seoul hotel 5 nights' }],
  booking: { booking_id: 'BOOKING-2026-000123' },
  client: { name: 'José (Pepe) O\\Brien-Ñañez', email: 'pepe@example.test', phone: '+63 917 000 0000' }
});

const receiptData = {
  receipt: { receipt_id: 'RECEIPT-2026-000001', booking_id: 'BOOKING-2026-000123', client_payment_id: 'CLIENT_PAYMENT-2026-000009', amount: '19500.00', currency: 'PHP', received_at: '2026-08-18T08:00:00.000Z', purpose: 'DOWN_PAYMENT', proof_reference: 'BDO-REF (001) A', verified_at: '2026-08-18T09:00:00.000Z', received_by: 'USER:manager', issued_at: '2026-08-18T09:05:00.000Z', status: 'ISSUED' },
  client: { name: 'José (Pepe) O\\Brien-Ñañez', email: 'pepe@example.test' },
  booking: { destination: 'Seoul', travel_start: '2026-12-10', travel_end: '2026-12-16' },
  company: { name: 'World Master International Travel', bank_details: 'BDO' }
};

const voucherData = {
  booking: { booking_id: 'BOOKING-2026-000123', commitment_state: 'CONFIRMED', client_name: 'José (Pepe) O\\Brien-Ñañez', destination: 'Seoul', travel_start: '2026-12-10', travel_end: '2026-12-16', currency: 'PHP', client_total: '78000.00' },
  vouchers: [{ voucher_number: 'VCH-2026-0001', issued_at: '2026-08-18T10:00:00.000Z', service_description: 'Seoul hotel 5 nights with breakfast', supplier_name: 'Hanok Resorts Seoul', supplier_contact: 'reservations@hanok.test' }],
  vouchers_issued: 1,
  generated_at: '2026-08-19T09:00:00.000Z'
};

test('the WinAnsi encoder maps specials, Latin-1, and fallbacks byte-exactly', () => {
  assert.deepEqual(encodeWinAnsi('\u2013'), Buffer.from([0x96]));
  assert.deepEqual(encodeWinAnsi('\u2014'), Buffer.from([0x97]));
  assert.deepEqual(encodeWinAnsi('\u20ac'), Buffer.from([0x80]));
  assert.deepEqual(encodeWinAnsi('é'), Buffer.from([0xe9]));
  assert.deepEqual(encodeWinAnsi('ñ'), Buffer.from([0xf1]));
  assert.deepEqual(encodeWinAnsi('\u4e2d'), Buffer.from([0x3f]));
});

test('a document carries escaped, WinAnsi-encoded client names in its content stream', () => {
  const result = buildInvoicePdf(invoiceData, { generatedAt: GENERATED_AT });
  assert.equal(result.ok, true);
  assert.match(result.filename, /^wmit-invoice-BOOKING-2026-000123\.pdf$/);
  assertStructurallyValid(result.pdf, 1);
  const text = allText(result.pdf);
  assert.ok(text.includes(CLIENT_NAME), 'escaped accented name with parens and backslash must round-trip');
  assert.ok(text.includes('Jos\xE9'), 'Latin-1 accented character appears as its WinAnsi byte');
});

test('the invoice PDF shows obligations and totals but never supplier cost data', () => {
  const result = buildInvoicePdf(invoiceData, { generatedAt: GENERATED_AT });
  const text = allText(result.pdf);
  assert.ok(text.includes('78000.00 PHP'));
  assert.ok(text.includes('19500.00 PHP'));
  assert.ok(text.includes('BNORPHMM'));
  assert.ok(text.includes('down payment'));
  assert.ok(!text.includes('51000.00'), 'supplier cost total must not leak into the client PDF');
  assert.ok(text.includes('Page 1 of '));
});

test('a 40-day itinerary paginates with per-page footers and valid page objects', () => {
  const result = buildItineraryPdf(itineraryData(40), { generatedAt: GENERATED_AT });
  assert.equal(result.ok, true);
  assert.match(result.filename, /^wmit-itinerary-BOOKING-2026-000123\.pdf$/);
  const { pageObjects, streams } = assertStructurallyValid(result.pdf, 2);
  assert.ok(pageObjects >= 2, '40 days must span multiple pages');
  const pageTwo = streams[1];
  assert.match(pageTwo, /Page 2 of \d+/, 'page two carries its own footer');
  const all = streams.join('\n');
  assert.ok(all.includes('MNL \u2013 ICN'.replace('\u2013', '\x96')) || all.includes('MNL \u2013 ICN'), 'flight route renders');
});

test('the receipt PDF shows amount, reference, status, and an ISSUED official receipt number', () => {
  const result = buildReceiptPdf(receiptData, { generatedAt: GENERATED_AT });
  assert.equal(result.ok, true);
  assert.match(result.filename, /^wmit-receipt-RECEIPT-2026-000001\.pdf$/);
  assertStructurallyValid(result.pdf, 1);
  const text = allText(result.pdf);
  assert.ok(text.includes('19500.00 PHP'));
  assert.ok(text.includes('BDO-REF \\(001\\) A'));
  assert.ok(text.includes('Official receipt RECEIPT-2026-000001'));
  assert.ok(text.includes('manager'), 'received_by strips the USER: prefix');
});

test('the voucher PDF lists issued vouchers with supplier names and the present-on-arrival note', () => {
  const result = buildVoucherPdf(voucherData, { generatedAt: GENERATED_AT });
  assert.equal(result.ok, true);
  assert.match(result.filename, /^wmit-voucher-BOOKING-2026-000123\.pdf$/);
  assertStructurallyValid(result.pdf, 1);
  const text = allText(result.pdf);
  assert.ok(text.includes('VCH-2026-0001'));
  assert.ok(text.includes('Hanok Resorts Seoul'));
  assert.ok(text.includes('present the voucher to each supplier on arrival'));
});

test('empty voucher lists render the no-vouchers-yet line without breaking structure', () => {
  const data = Object.assign({}, voucherData, { vouchers: [], vouchers_issued: 0 });
  const result = buildVoucherPdf(data, { generatedAt: GENERATED_AT });
  assert.equal(result.ok, true);
  assertStructurallyValid(result.pdf, 1);
  assert.ok(allText(result.pdf).includes('No vouchers have been issued'));
});

test('the raw writer produces a structurally valid multi-page document directly', () => {
  const doc = createPdfDocument({ generatedAt: GENERATED_AT });
  doc.heading('Test document');
  for (let i = 0; i < 80; i += 1) doc.paragraph('Line ' + i + ' of filler body text designed to push the cursor far enough to force a second page.');
  doc.row('Total', '1.00 PHP', { bold: true });
  const built = doc.build();
  assert.ok(built.pageCount >= 2);
  assertStructurallyValid(built.pdf, 2);
});
