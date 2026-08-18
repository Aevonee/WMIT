'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhase1Runtime } = require('../../src/phase1/runtime');
const { ExpoService } = require('../../src/expo/expo-service');

const AUTH = { staff: ['EDIT_DRAFT_PRICING', 'ACCEPT_QUOTATION'], manager: ['APPROVE_QUOTATION', 'VERIFY_PAYMENT', 'ISSUE_VOUCHER', 'RESERVE_SUPPLIER'] };
const staff = () => ({ actor: 'staff', correlationId: 'POLISH-TEST' });
const manager = () => ({ actor: 'manager', correlationId: 'POLISH-TEST' });
const mailerStub = { send: async () => ({ sent: false, mode: 'stub' }) };

function bookingWithItem(runtime) {
  const client = runtime.createClient({ display_name: 'Polish Test Client' }, staff()).data;
  const inquiry = runtime.createInquiry({ client_id: client.client_id, requirements: { destination: 'Seoul', travel_start: '2026-12-10', travel_end: '2026-12-16', nights: 6, adults: 2 } }, staff()).data;
  const quotation = runtime.createQuotation({ inquiry_id: inquiry.inquiry_id, client_id: client.client_id, quotation_date: '2026-08-18', valid_until: '2026-08-31', destination: 'Seoul', travel_start: '2026-12-10', travel_end: '2026-12-16', pax_count: 2, currency: 'PHP', supplier_cost_total: '60000.00', client_total: '78000.00', inclusions: 'Hotel, transfers', exclusions: 'Airfare, personal expenses' }, staff()).data;
  runtime.createQuotationItem({ quotation_id: quotation.quotation_id, service_type: 'Hotel', description: 'Seoul hotel 5 nights', quantity: 2, unit_cost: '30000.00', unit_selling_price: '39000.00', currency: 'PHP' }, staff());
  runtime.createQuotationItem({ quotation_id: quotation.quotation_id, service_type: 'Transfer', description: 'Airport transfers', quantity: 2, unit_cost: '1500.00', unit_selling_price: '2500.00', currency: 'PHP' }, staff());
  const approved = runtime.approveQuotation({ quotation_id: quotation.quotation_id }, manager());
  assert.equal(approved.ok, true, JSON.stringify(approved.error));
  runtime.acceptQuotation({ quotation_id: quotation.quotation_id, accepted_by: 'Polish Test Client' }, staff());
  const person = runtime.createPerson({ full_name: 'Polish Test Client', role_notes: ['lead pax'] }, staff()).data;
  const booking = runtime.createBooking({ quotation_id: quotation.quotation_id, lead_pax_person_id: person.person_id }, staff()).data;
  const items = runtime.createBookingItemsFromAcceptedSnapshot({ booking_id: booking.booking_id }, staff());
  return { booking, items: items.ok ? items.data.items : [] };
}

test('vouchers auto-number from the VOUCHER year-based sequence when no number is supplied', () => {
  const runtime = createPhase1Runtime({ clock: () => new Date('2026-08-18T09:00:00Z'), config: { trustedActors: AUTH } });
  const chain = bookingWithItem(runtime);

  const auto = runtime.issueVoucher({ booking_item_id: chain.items[0].booking_item_id }, manager());
  assert.equal(auto.ok, true);
  assert.match(auto.data.voucher_number, /^VOUCHER-2026-\d{6}$/);
  assert.equal(auto.data.voucher_number, auto.data.voucher_id);
  assert.equal(chain.items[0] ? runtime.get('BookingItem', chain.items[0].booking_item_id).fulfillment_state : null, 'VOUCHERED');

  const manual = runtime.issueVoucher({ booking_item_id: chain.items[1] ? chain.items[1].booking_item_id : chain.items[0].booking_item_id, voucher_number: 'SUPPLIER-REF-99' }, manager());
  assert.equal(manual.ok, true);
  assert.equal(manual.data.voucher_number, 'SUPPLIER-REF-99');
});

test('createClient blocks duplicate names and reports the existing record', () => {
  const runtime = createPhase1Runtime({ clock: () => new Date('2026-08-18T09:00:00Z'), config: { trustedActors: AUTH } });
  const first = runtime.createClient({ display_name: 'Maria Santos' }, staff());
  assert.equal(first.ok, true);

  const duplicate = runtime.createClient({ display_name: '  maria santos ' }, staff());
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error.code, 'CLIENT_DUPLICATE');
  assert.equal(duplicate.error.details.existing_client_id, first.data.client_id);

  const other = runtime.createClient({ display_name: 'Maria Santos-Reyes' }, staff());
  assert.equal(other.ok, true);
});

function expoFixture(clockDate) {
  const runtime = createPhase1Runtime({ clock: () => new Date(clockDate), config: { trustedActors: {} } });
  const expo = new ExpoService({ runtime, mailer: mailerStub, config: { baseUrl: 'http://expo.test' }, clock: () => new Date(clockDate) });
  return { runtime, expo };
}

function captureReadyLead(expo) {
  const created = expo.createExpo({ name: 'Polish Test Expo', start_date: '2026-09-04', end_date: '2026-09-06' }, 'staff');
  assert.equal(created.ok, true, JSON.stringify(created.error));
  const lead = expo.captureLead({ name: 'Ana Villa', mobile: '09171234567', destination: 'Seoul', travel_month: '2026-12', adults: 2, children: 1, duration_days: 5, notes: 'Prefers 4-star hotels' });
  assert.equal(lead.ok, true, JSON.stringify(lead.error));
  return lead.data;
}

test('convertLead creates a linked Client + Inquiry from the lead brief and is idempotent', () => {
  const { runtime, expo } = expoFixture('2026-08-20T08:00:00Z');
  const lead = captureReadyLead(expo);

  const converted = expo.convertLead({ expo_lead_id: lead.expo_lead_id }, 'staff');
  assert.equal(converted.ok, true, JSON.stringify(converted.error));
  assert.equal(converted.data.already_converted, false);

  const client = runtime.get('Client', converted.data.client_id);
  assert.equal(client.display_name, 'Ana Villa');
  assert.equal(client.primary_phone, '+639171234567');
  assert.ok(String(client.notes).includes('expo'));

  const inquiry = runtime.get('Inquiry', converted.data.inquiry_id);
  assert.equal(inquiry.client_id, client.client_id);
  assert.equal(inquiry.current_requirements.destination, 'Seoul');
  assert.equal(inquiry.current_requirements.travel_month, '2026-12');
  assert.equal(inquiry.current_requirements.adults, 2);

  const stamped = runtime.get('ExpoLead', lead.expo_lead_id);
  assert.equal(stamped.converted_client_id, client.client_id);
  assert.equal(stamped.converted_inquiry_id, inquiry.inquiry_id);

  const replay = expo.convertLead({ expo_lead_id: lead.expo_lead_id }, 'staff');
  assert.equal(replay.ok, true);
  assert.equal(replay.data.already_converted, true);
  assert.equal(runtime.list('Client', (record) => record.display_name === 'Ana Villa').length, 1);
});

test('public quote links expire with the quotation validity and acceptance is refused after it', async () => {
  const { runtime, expo } = expoFixture('2026-08-20T08:00:00Z');
  const lead = captureReadyLead(expo);
  const quote = expo.createQuote({ expo_lead_id: lead.expo_lead_id, options: [{ name: 'Seoul Discovery 5D4N', destination: 'Seoul', duration_days: 5, price_per_person: '32900.00', currency: 'PHP' }], valid_until: '2026-08-25' }, 'staff');
  assert.equal(quote.ok, true, JSON.stringify(quote.error));

  const sent = await expo.sendQuoteEmailAsync({ expo_quote_id: quote.data.expo_quote_id, email: 'ana@example.test' }, 'staff');
  assert.equal(sent.ok, true, JSON.stringify(sent.error));
  const link = expo.getQuoteLink({ expo_quote_id: quote.data.expo_quote_id }, 'staff');
  assert.equal(link.ok, true, JSON.stringify(link.error));
  const token = String(link.data.url).split('/q/')[1];

  const fresh = expo.getPublicQuote(token);
  assert.equal(fresh.ok, true);
  assert.equal(fresh.data.expired, false);

  const laterExpo = new ExpoService({ runtime, mailer: mailerStub, config: { baseUrl: 'http://expo.test' }, clock: () => new Date('2026-08-27T08:00:00Z') });
  const stale = laterExpo.getPublicQuote(token);
  assert.equal(stale.ok, true);
  assert.equal(stale.data.expired, true);

  const refused = laterExpo.acceptQuote(token, { accepted_by: 'Ana Villa' });
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, 'QUOTATION_EXPIRED');
});
