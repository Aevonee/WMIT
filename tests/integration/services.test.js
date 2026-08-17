'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLocalRuntime, createApi } = require('../../src/services');
const { records, SYNTHETIC_CONTEXT } = require('../fixtures/synthetic-data');

function runtimeWithFixedClock() {
  return createLocalRuntime({ clock: () => new Date('2026-08-12T10:00:00.000Z') });
}

test('representative service API creates, gets, and updates controlled records', () => {
  const runtime = runtimeWithFixedClock();
  const api = createApi(runtime);
  const lead = api.createLead(records.lead, SYNTHETIC_CONTEXT);
  assert.equal(lead.ok, true);
  const client = api.createClient(Object.assign({}, records.client, { source_lead_id: lead.data.lead_id }), SYNTHETIC_CONTEXT);
  assert.equal(client.ok, true);
  const updatedLead = api.updateLead(lead.data.lead_id, { client_id: client.data.client_id, status: 'Contacted' }, SYNTHETIC_CONTEXT);
  assert.equal(updatedLead.ok, true);
  const found = api.getClient(client.data.client_id, SYNTHETIC_CONTEXT);
  assert.equal(found.data.primary_email, 'traveler@example.test');
  assert.equal(found.data.record_version, 1);
});

test('foreign keys are checked before a record is saved', () => {
  const runtime = runtimeWithFixedClock();
  const result = runtime.services.Booking.create(Object.assign({}, records.booking, { client_id: 'CLIENT-TEST-999999' }), SYNTHETIC_CONTEXT);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'VALIDATION_ERROR');
  assert.match(result.error.details.errors[0].message, /does not exist/);
  assert.equal(runtime.repositories.Booking.list().length, 0);
});

test('duplicate IDs are rejected and invalid data is not silently stored', () => {
  const runtime = runtimeWithFixedClock();
  const first = runtime.services.Supplier.create(records.supplier, SYNTHETIC_CONTEXT);
  const duplicate = runtime.services.Supplier.create(records.supplier, SYNTHETIC_CONTEXT);
  assert.equal(first.ok, true);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error.code, 'DUPLICATE_ID');
  assert.equal(runtime.repositories.Supplier.list().length, 1);
});

test('updates preserve immutable IDs and reject invalid status changes', () => {
  const runtime = runtimeWithFixedClock();
  const created = runtime.services.Client.create(records.client, SYNTHETIC_CONTEXT);
  const changedId = runtime.services.Client.update(created.data.client_id, { client_id: 'CLIENT-TEST-000002' }, SYNTHETIC_CONTEXT);
  assert.equal(changedId.ok, false);
  assert.equal(changedId.error.code, 'IMMUTABLE_ID');
});

test('audit log records success and failure without storing secrets', () => {
  const runtime = runtimeWithFixedClock();
  runtime.services.Client.create(records.client, SYNTHETIC_CONTEXT);
  runtime.services.Client.create({ client_id: 'CLIENT-TEST-000001', client_type: 'Individual' }, SYNTHETIC_CONTEXT);
  const events = runtime.auditLog.list();
  assert.equal(events.length, 2);
  assert.equal(events[0].action, 'CREATE');
  assert.equal(events[1].result, 'ERROR');
  assert.equal(JSON.stringify(events).includes('passport'), false);
});

test('strict schema and polymorphic relationship checks reject unsafe records', () => {
  const runtime = runtimeWithFixedClock();
  const first = runtime.services.Client.create(records.client, SYNTHETIC_CONTEXT);
  assert.equal(first.ok, true);
  const unknownField = runtime.services.Client.create(Object.assign({}, records.client, {
    client_id: 'CLIENT-TEST-000002',
    display_name: 'Another Fictional Client',
    primary_email: 'another@example.test',
    unexpected_field: 'should not be stored'
  }), SYNTHETIC_CONTEXT);
  assert.equal(unknownField.ok, false);
  assert.equal(unknownField.error.code, 'VALIDATION_ERROR');
  const invalidContact = runtime.services.Contact.create({
    contact_id: 'CONTACT-TEST-000001',
    owner_type: 'Client',
    owner_id: 'CLIENT-TEST-999999',
    contact_type: 'Email',
    contact_value: 'unknown@example.test',
    is_primary: true,
    status: 'Active'
  }, SYNTHETIC_CONTEXT);
  assert.equal(invalidContact.ok, false);
  assert.match(invalidContact.error.details.errors[0].message, /does not exist/);
});

test('duplicate booking-traveler relationships are rejected', () => {
  const runtime = runtimeWithFixedClock();
  runtime.services.Client.create(records.client, SYNTHETIC_CONTEXT);
  runtime.services.Traveler.create(records.traveler, SYNTHETIC_CONTEXT);
  const booking = runtime.services.Booking.create(Object.assign({}, records.booking, {
    quotation_id: undefined
  }), SYNTHETIC_CONTEXT);
  assert.equal(booking.ok, true);
  const first = runtime.services.BookingTraveler.create(Object.assign({}, records.bookingTraveler1, {
    booking_id: booking.data.booking_id
  }), SYNTHETIC_CONTEXT);
  const duplicate = runtime.services.BookingTraveler.create(Object.assign({}, records.bookingTraveler1, {
    booking_traveler_id: 'BOOKING_TRAVELER-TEST-000003',
    booking_id: booking.data.booking_id
  }), SYNTHETIC_CONTEXT);
  assert.equal(first.ok, true);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error.code, 'DUPLICATE_RECORD');
});

test('referenced relationship updates cannot point to missing records', () => {
  const runtime = runtimeWithFixedClock();
  runtime.services.Client.create(records.client, SYNTHETIC_CONTEXT);
  runtime.services.Traveler.create(records.traveler, SYNTHETIC_CONTEXT);
  const booking = runtime.services.Booking.create(Object.assign({}, records.booking, {
    quotation_id: undefined
  }), SYNTHETIC_CONTEXT);
  const attached = runtime.services.BookingTraveler.create(Object.assign({}, records.bookingTraveler1, {
    booking_id: booking.data.booking_id
  }), SYNTHETIC_CONTEXT);
  const changed = runtime.services.BookingTraveler.update(attached.data.booking_traveler_id, {
    traveler_id: 'PASSENGER-TEST-999999'
  }, SYNTHETIC_CONTEXT);
  assert.equal(changed.ok, false);
  assert.match(changed.error.details.errors[0].message, /does not exist/);
});
