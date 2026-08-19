'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhase1Runtime, ACTIONS } = require('../../src/phase1/runtime');
const { makeQuotationApprovable } = require('../helpers/quotation-contract');

const authority = { staff: [ACTIONS.ACCEPT_QUOTATION, ACTIONS.EDIT_DRAFT_PRICING], manager: [ACTIONS.APPROVE_QUOTATION] };
function runtime() { return createPhase1Runtime({ clock: () => new Date('2026-08-19T10:00:00+08:00'), config: { trustedActors: authority } }); }

function bookingWithLead(r, suffix) {
  const client = r.createClient({ display_name: 'Participants Client ' + suffix, legal_name: 'Participants Client ' + suffix }).data;
  const lead = r.createPerson({ display_name: 'Original Lead ' + suffix }).data;
  const quote = r.createQuotation({ client_id: client.client_id, supplier_cost_total: '10000.00' }, { actor: 'staff' }).data;
  makeQuotationApprovable(r, quote, { actor: 'staff' });
  r.approveQuotation({ quotation_id: quote.quotation_id }, { actor: 'manager' });
  r.acceptQuotation({ quotation_id: quote.quotation_id, accepted_by: client.client_id }, { actor: 'staff' });
  const booking = r.createBooking({ quotation_id: quote.quotation_id, client_id: client.client_id, lead_pax_person_id: lead.person_id }, { actor: 'staff' }).data;
  return { client, lead, booking };
}

test('booking participant roles can be edited after creation', () => {
  const r = runtime();
  const { booking } = bookingWithLead(r, '1');
  const traveler = r.createPerson({ display_name: 'Editable Traveler' }).data;
  const participant = r.createBookingParticipant({ booking_id: booking.booking_id, person_id: traveler.person_id, role: 'TRAVELER' }, { actor: 'staff' }).data;
  const updated = r.updateBookingParticipant({ booking_participant_id: participant.booking_participant_id, role: 'COORDINATOR' }, { actor: 'staff' });
  assert.equal(updated.ok, true);
  assert.equal(updated.data.role, 'COORDINATOR');
  const empty = r.updateBookingParticipant({ booking_participant_id: participant.booking_participant_id }, { actor: 'staff' });
  assert.equal(empty.ok, false);
  assert.equal(empty.error.code, 'PARTICIPANT_CHANGE_REQUIRED');
});

test('lead pax moves only after the current lead is demoted', () => {
  const r = runtime();
  const { booking } = bookingWithLead(r, '2');
  const newLead = r.createPerson({ display_name: 'Replacement Lead' }).data;
  const participant = r.createBookingParticipant({ booking_id: booking.booking_id, person_id: newLead.person_id, role: 'TRAVELER' }, { actor: 'staff' }).data;
  const conflict = r.updateBookingParticipant({ booking_participant_id: participant.booking_participant_id, role: 'LEAD_PAX' }, { actor: 'staff' });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error.code, 'LEAD_PAX_ALREADY_ASSIGNED');
  const currentLead = r.list('BookingParticipant', (record) => record.booking_id === booking.booking_id && record.role === 'LEAD_PAX')[0];
  const demoted = r.updateBookingParticipant({ booking_participant_id: currentLead.booking_participant_id, role: 'TRAVELER' }, { actor: 'staff' });
  assert.equal(demoted.ok, true);
  const promoted = r.updateBookingParticipant({ booking_participant_id: participant.booking_participant_id, role: 'LEAD_PAX' }, { actor: 'staff' });
  assert.equal(promoted.ok, true);
  assert.equal(promoted.data.role, 'LEAD_PAX');
});

test('non-lead participants are removed with CANCELLED state and excluded from lead checks', () => {
  const r = runtime();
  const { booking } = bookingWithLead(r, '3');
  const traveler = r.createPerson({ display_name: 'Removable Traveler' }).data;
  const participant = r.createBookingParticipant({ booking_id: booking.booking_id, person_id: traveler.person_id, role: 'TRAVELER' }, { actor: 'staff' }).data;
  const removed = r.removeBookingParticipant({ booking_participant_id: participant.booking_participant_id }, { actor: 'staff' });
  assert.equal(removed.ok, true);
  assert.equal(removed.data.state, 'CANCELLED');
  const active = r.list('BookingParticipant', (record) => record.booking_id === booking.booking_id && record.state !== 'CANCELLED');
  assert.equal(active.length, 1);
  assert.equal(active[0].role, 'LEAD_PAX');
  const leadBlocked = r.removeBookingParticipant({ booking_participant_id: active[0].booking_participant_id }, { actor: 'staff' });
  assert.equal(leadBlocked.ok, false);
  assert.equal(leadBlocked.error.code, 'LEAD_PAX_REQUIRED');
});

test('participant actions reject unknown participants', () => {
  const r = runtime();
  const missing = r.updateBookingParticipant({ booking_participant_id: 'BOOKING_PARTICIPANT-DOES-NOT-EXIST', role: 'TRAVELER' }, { actor: 'staff' });
  assert.equal(missing.ok, false);
  const removeMissing = r.removeBookingParticipant({ booking_participant_id: 'BOOKING_PARTICIPANT-DOES-NOT-EXIST' }, { actor: 'staff' });
  assert.equal(removeMissing.ok, false);
});
