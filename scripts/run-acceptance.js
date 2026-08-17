'use strict';

const assert = require('node:assert/strict');

const port = Number(process.env.WMIT_MVP_PORT || 3000);
const baseUrl = 'http://127.0.0.1:' + port;

async function request(path, options) {
  const response = await fetch(baseUrl + path, Object.assign({
    headers: { 'Content-Type': 'application/json' }
  }, options || {}));
  let body;
  try {
    body = await response.json();
  } catch (_) {
    throw new Error(response.status + ' ' + path + ' did not return JSON.');
  }
  if (!response.ok || body.ok === false) {
    const detail = body.error && (body.error.code ? body.error.code + ': ' : '') + body.error.message;
    throw new Error((response.status || 500) + ' ' + path + ' failed' + (detail ? ' — ' + detail : '.'));
  }
  return body;
}

async function action(actionName, input, actor) {
  const result = await request('/api/phase1/action', {
    method: 'POST',
    body: JSON.stringify({ action: actionName, input: input || {}, actor: actor || 'LOCAL_STAFF' })
  });
  return result.data;
}

function count(records, type, predicate) {
  return (records[type] || []).filter(predicate || (() => true)).length;
}

async function main() {
  for (const path of ['/', '/operations.html', '/operations.js', '/phase1.html']) {
    const response = await fetch(baseUrl + path, { cache: 'no-store' });
    assert.equal(response.status, 200, path + ' should be available.');
  }

  await action('resetSyntheticTestCase', {}, 'LOCAL_STAFF');

  const before = (await request('/api/phase1/state')).data.entities;
  const client = before.Client.find((record) => record.client_id === 'CLIENT-SYNTH-000001');
  const supplier = before.Supplier.find((record) => record.supplier_id === 'SUPPLIER-SYNTH-000001');
  assert.ok(client, 'seed client should exist');
  assert.ok(supplier, 'seed supplier should exist');

  const inquiry = await action('createInquiry', {
    client_id: client.client_id,
    requirements: {
      destination: 'Bangkok',
      travel_start: '2026-11-10',
      travel_end: '2026-11-14',
      adults: 2,
      children: 0,
      infants: 0
    }
  });

  const tariff = await action('uploadTariff', {
    supplier_id: supplier.supplier_id,
    file_name: 'acceptance-synthetic-tariff',
    file_ref: 'local://acceptance-synthetic-tariff',
    original_source: { source_type: 'LOCAL_SYNTHETIC' },
    extraction_facts: [
      { field_name: 'currency', normalized_value: 'PHP', confidence: 1 },
      { field_name: 'rate_unit', normalized_value: 'PER_PERSON', confidence: 1 }
    ],
    rate_components: [{
      amount: '10000.00',
      currency: 'PHP',
      rate_unit: 'PER_PERSON',
      quantity_driver: 'pax_count',
      conditions: { destination: 'Bangkok', duration_days: 5 }
    }],
    itinerary_components: [{ day: 1, city: 'Bangkok', activity: 'Synthetic city tour', included: true }]
  });
  await action('reviewTariff', { tariff_source_id: tariff.tariff_source_id, approve: true });

  const match = await action('matchOptions', { inquiry_id: inquiry.inquiry_id });
  assert.equal(match.candidates.length, 1, 'the synthetic tariff should produce one candidate');
  const option = match.candidates[0];
  await action('matchOptions', { inquiry_id: inquiry.inquiry_id });
  await action('selectOption', { commercial_option_id: option.commercial_option_id });

  const quotation = await action('createQuotation', {
    commercial_option_id: option.commercial_option_id,
    client_id: client.client_id
  });
  await action('createQuotationItem', {
    quotation_id: quotation.quotation_id,
    service_type: 'PACKAGE',
    description: 'Synthetic Bangkok package per person',
    quantity: 2,
    unit_cost: '5000.00',
    unit_selling_price: '6500.00',
    currency: 'PHP'
  });
  await action('updateQuotation', {
    quotation_id: quotation.quotation_id,
    destination: 'Bangkok',
    inclusions: 'Synthetic package inclusions',
    exclusions: 'Personal expenses'
  });
  await action('approveQuotation', { quotation_id: quotation.quotation_id }, 'LOCAL_MANAGER');
  await action('acceptQuotation', {
    quotation_id: quotation.quotation_id,
    accepted_by: 'Synthetic acceptance client',
    acceptance_reference: 'LOCAL-ACCEPTANCE-1'
  });

  const leadPax = await action('createPerson', { display_name: 'Synthetic Lead Pax' });
  const booking = await action('createBooking', {
    quotation_id: quotation.quotation_id,
    lead_pax_person_id: leadPax.person_id
  });
  const item = await action('createBookingItem', {
    booking_id: booking.booking_id,
    supplier_id: supplier.supplier_id,
    service_type: 'PACKAGE',
    description: 'Synthetic Bangkok package',
    supplier_cost: '10000.00',
    selling_price: '16000.00',
    currency: 'PHP'
  });

  const hold = await action('createAvailabilityHold', {
    booking_item_id: item.booking_item_id,
    supplier_id: supplier.supplier_id,
    expires_at: '2026-11-01T10:00:00.000Z',
    supplier_reference: 'LOCAL-HOLD-1'
  });
  await action('updateAvailabilityHold', {
    availability_hold_id: hold.availability_hold_id,
    state: 'CONFIRMED',
    supplier_reference: 'LOCAL-CONFIRM-1'
  });
  await action('recordTicketing', {
    booking_item_id: item.booking_item_id,
    status: 'TICKETED',
    pnr: 'LOCAL-PNR-1',
    ticket_number: 'LOCAL-TICKET-1',
    idempotency_key: 'local-acceptance-ticket-1'
  });
  await action('issueVoucher', {
    booking_item_id: item.booking_item_id,
    voucher_number: 'LOCAL-VOUCHER-1'
  });
  await action('createPaymentScheduleItem', {
    booking_id: booking.booking_id,
    sequence: 1,
    purpose: 'DOWN_PAYMENT',
    amount: '8000.00',
    currency: 'PHP',
    due_at: '2026-09-01T10:00:00.000Z'
  });
  await action('createRoomingListEntry', {
    booking_id: booking.booking_id,
    person_id: leadPax.person_id,
    room_label: 'Room 1',
    occupancy: 'Twin'
  });
  await action('reconcileBooking', {
    booking_id: booking.booking_id,
    confirm: false,
    idempotency_key: 'local-acceptance-reconcile-1'
  }, 'LOCAL_MANAGER');

  const after = (await request('/api/phase1/state')).data.entities;
  assert.equal(count(after, 'Inquiry', (record) => record.inquiry_id === inquiry.inquiry_id), 1);
  assert.equal(count(after, 'CommercialOption', (record) => record.inquiry_id === inquiry.inquiry_id), 1, 'repeated matching must remain idempotent');
  assert.equal(count(after, 'QuotationAcceptance', (record) => record.quotation_id === quotation.quotation_id), 1);
  assert.equal(count(after, 'Booking', (record) => record.booking_id === booking.booking_id), 1);
  assert.equal(count(after, 'BookingParticipant', (record) => record.booking_id === booking.booking_id && record.role === 'LEAD_PAX'), 1);
  assert.equal(count(after, 'AvailabilityHold', (record) => record.booking_item_id === item.booking_item_id), 1);
  assert.equal(count(after, 'TicketingRecord', (record) => record.booking_item_id === item.booking_item_id), 1);
  assert.equal(count(after, 'Voucher', (record) => record.booking_item_id === item.booking_item_id), 1);
  assert.equal(count(after, 'PaymentScheduleItem', (record) => record.booking_id === booking.booking_id), 1);
  assert.equal(count(after, 'RoomingListEntry', (record) => record.booking_id === booking.booking_id), 1);
  assert.equal(count(after, 'Reconciliation', (record) => record.booking_id === booking.booking_id), 1);

  console.log('Acceptance passed: HTTP assets, inquiry, tariff review, matching retry, quotation acceptance, Booking lead pax, hold, ticketing, voucher, schedule, rooming, and reconciliation.');
  console.log('Booking: ' + booking.booking_id + ' · Commercial options: ' + count(after, 'CommercialOption', (record) => record.inquiry_id === inquiry.inquiry_id));
}

main().catch((error) => {
  console.error('Acceptance failed: ' + (error.stack || error.message));
  process.exitCode = 1;
});
