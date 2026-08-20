'use strict';

// Departure readiness checklist: pure, read-only verification that every
// member of a Departure is paid in full, ticketed where flights apply,
// voucher-covered for ground services, and documented where requirements are
// recorded. Same pure-function style as today-overview.js: the runtime
// methods that call this (getDepartureReadiness, runDepartureReadinessCheck)
// own validation, task raising, and audit. This module never mutates.

const { WmitError } = require('../core/errors');
const { toMinorUnits, fromMinorUnits } = require('../core/money');
const { resolveAsOf } = require('./today-overview');

const DEPARTURE_READINESS_VERSION = 'V1';
const READINESS_CHECKS = Object.freeze(['BOOKING_PAID', 'TICKETING', 'VOUCHERS', 'DOCUMENTS']);
// Mirrors case-projection's accepted document states so "complete" means the
// same thing in the readiness checklist as it does in the case projection.
const READY_DOCUMENT_STATES = new Set(['ACCEPTED', 'APPROVED', 'COMPLETE', 'COMPLETED', 'ISSUED', 'READY', 'RECEIVED', 'VERIFIED']);
const FLIGHT_SERVICE_TYPES = new Set(['FLIGHT', 'FLIGHT_SEGMENT', 'AIR', 'AIRLINE', 'AIR_TICKET']);
const CANCELLED_ITEMS = new Set(['CANCELLED']);

const CHECK_LABELS = Object.freeze({
  BOOKING_PAID: 'payment not complete',
  TICKETING: 'tickets not issued',
  VOUCHERS: 'vouchers not issued',
  DOCUMENTS: 'documents incomplete'
});

function upper(value) {
  return String(value || '').trim().toUpperCase();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function dateOnly(value) {
  const raw = String(value === undefined || value === null ? '' : value).trim();
  if (!raw) return null;
  const date = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function collectEntities(source) {
  if (source && typeof source.list === 'function') {
    const names = [
      'Person', 'Client', 'Booking', 'BookingItem', 'ClientObligation', 'PaymentScheduleItem',
      'ClientPayment', 'PaymentAllocation', 'TicketingRecord', 'Voucher', 'Document',
      'Departure', 'DepartureMembership'
    ];
    return Object.fromEntries(names.map((name) => [name, asArray(source.list(name))]));
  }
  const value = source && source.ok && source.data ? source.data : source;
  return (value && value.entities) || value || {};
}

function records(entities, type) {
  return asArray(entities[type]);
}

function moneyOrZero(value) {
  try { return toMinorUnits(value === undefined || value === null || value === '' ? '0.00' : value); }
  catch (_) { return 0n; }
}

function fromMinor(minor) {
  return fromMinorUnits(minor);
}

function isFlightItem(item) {
  return FLIGHT_SERVICE_TYPES.has(upper(item.service_type || item.type)) || Boolean(item.airline || item.flight_number);
}

function isCancelledItem(item) {
  return CANCELLED_ITEMS.has(upper(item.fulfillment_state || item.state));
}

// (a) Booking paid in full — obligation/verified-payment math mirrors the
// today-overview paymentsDue section and case-projection financeProjection:
// verified client payments allocate through ACTIVE PaymentAllocation rows;
// PaymentScheduleItem is the fallback record set only when no ClientObligation
// exists.
function bookingPaymentCheck(entities, booking) {
  const obligations = records(entities, 'ClientObligation').filter((record) => record.booking_id === booking.booking_id);
  const schedule = records(entities, 'PaymentScheduleItem').filter((record) => record.booking_id === booking.booking_id);
  const authoritative = obligations.length ? obligations : schedule;
  if (!authoritative.length) {
    return { check: 'BOOKING_PAID', status: 'UNKNOWN', detail: 'No payment obligations are recorded for this booking; paid-in-full cannot be verified.' };
  }
  const obligationIds = new Set(authoritative.map((record) => record.client_obligation_id || record.payment_schedule_item_id));
  const verifiedPaymentIds = new Set(records(entities, 'ClientPayment')
    .filter((payment) => upper(payment.payment_state || payment.state) === 'VERIFIED')
    .map((payment) => payment.client_payment_id));
  const allocations = records(entities, 'PaymentAllocation')
    .filter((allocation) => upper(allocation.state || 'ACTIVE') === 'ACTIVE' && verifiedPaymentIds.has(allocation.client_payment_id))
    .filter((allocation) => {
      if (allocation.client_obligation_id) return obligationIds.has(allocation.client_obligation_id);
      return !obligations.length && authoritative.length === 1 && allocation.booking_id === booking.booking_id;
    });
  const currency = authoritative[0].currency || booking.currency || null;
  const totalMinor = authoritative.reduce((sum, record) => sum + moneyOrZero(record.amount || record.total_amount || record.balance_due), 0n);
  const allocatedMinor = allocations.reduce((sum, allocation) => sum + moneyOrZero(allocation.amount), 0n);
  const outstandingMinor = totalMinor - allocatedMinor;
  if (outstandingMinor <= 0n) {
    return { check: 'BOOKING_PAID', status: 'PASS', detail: 'Paid in full' + (currency ? ' (' + currency + ' ' + fromMinor(totalMinor) + ' obligated, ' + fromMinor(allocatedMinor) + ' verified and allocated)' : '') + '.' };
  }
  return {
    check: 'BOOKING_PAID', status: 'FAIL',
    detail: 'Outstanding ' + (currency ? currency + ' ' : '') + fromMinor(outstandingMinor) + ' of ' + fromMinor(totalMinor) + ' remains unpaid (verified allocations: ' + fromMinor(allocatedMinor) + ').'
  };
}

// (b) TicketingRecord issued where ticketing applies — every flight-like
// Booking Item needs a TicketingRecord with status TICKETED.
function ticketingCheck(entities, items) {
  const flightItems = items.filter((item) => !isCancelledItem(item) && isFlightItem(item));
  if (!flightItems.length) {
    return { check: 'TICKETING', status: 'PASS', detail: 'No flight services on this booking; ticketing does not apply.' };
  }
  const ticketedItemIds = new Set(records(entities, 'TicketingRecord')
    .filter((record) => upper(record.status) === 'TICKETED')
    .map((record) => record.booking_item_id));
  const missing = flightItems.filter((item) => !ticketedItemIds.has(item.booking_item_id));
  if (missing.length) {
    return { check: 'TICKETING', status: 'FAIL', detail: missing.length + ' of ' + flightItems.length + ' flight service(s) have no TICKETED TicketingRecord: ' + missing.map((item) => item.description || item.service_type || item.booking_item_id).join('; ') + '.' };
  }
  return { check: 'TICKETING', status: 'PASS', detail: 'All ' + flightItems.length + ' flight service(s) have issued tickets.' };
}

// (c) Vouchers issued for booked services — every non-flight service needs a
// Voucher record with status ISSUED (flights are covered by ticketing).
function voucherCheck(entities, items) {
  const groundItems = items.filter((item) => !isCancelledItem(item) && !isFlightItem(item));
  if (!groundItems.length) {
    return { check: 'VOUCHERS', status: 'PASS', detail: 'No ground services on this booking; vouchers do not apply.' };
  }
  const issuedItemIds = new Set(records(entities, 'Voucher')
    .filter((voucher) => upper(voucher.status || 'ISSUED') === 'ISSUED')
    .map((voucher) => voucher.booking_item_id));
  const missing = groundItems.filter((item) => !issuedItemIds.has(item.booking_item_id));
  if (missing.length) {
    return { check: 'VOUCHERS', status: 'FAIL', detail: missing.length + ' of ' + groundItems.length + ' booked service(s) have no ISSUED voucher: ' + missing.map((item) => item.description || item.service_type || item.booking_item_id).join('; ') + '.' };
  }
  return { check: 'VOUCHERS', status: 'PASS', detail: 'All ' + groundItems.length + ' booked service(s) have issued vouchers.' };
}

function documentReady(document) {
  return READY_DOCUMENT_STATES.has(upper(document.review_status || document.status || document.state));
}

// Documents linked to a booking: direct booking/item links or the generic
// related-entity relation, mirroring case-projection's linkage rules.
function bookingDocuments(entities, booking, items) {
  const itemIds = new Set(items.map((item) => item.booking_item_id).filter(Boolean));
  return records(entities, 'Document').filter((document) =>
    (booking && document.booking_id && document.booking_id === booking.booking_id) ||
    (document.booking_item_id && itemIds.has(document.booking_item_id)) ||
    (booking && document.related_entity_type === 'Booking' && document.related_entity_id === booking.booking_id) ||
    (document.related_entity_type === 'BookingItem' && itemIds.has(document.related_entity_id))
  );
}

// (d) Documents complete where required. Requirements come from Booking Item
// required_documents entries (string or {type/document_id}). When nothing
// declares requirements the honest answer is UNKNOWN, never FAIL.
function documentsCheck(entities, booking, items) {
  const requirements = [];
  items.forEach((item) => {
    asArray(item.required_documents || item.required_document_types).forEach((entry) => {
      requirements.push({
        item,
        type: typeof entry === 'string' ? entry : (entry && entry.type) || null,
        documentId: entry && typeof entry === 'object' ? entry.document_id || null : null
      });
    });
  });
  if (!requirements.length) {
    return { check: 'DOCUMENTS', status: 'UNKNOWN', detail: 'No per-traveler document requirements are recorded for this booking; completeness cannot be verified.' };
  }
  const documents = bookingDocuments(entities, booking, items);
  const missing = requirements.filter((requirement) => !documents.some((document) => {
    if (!documentReady(document)) return false;
    if (requirement.documentId && document.document_id === requirement.documentId) return true;
    return Boolean(requirement.type && upper(requirement.type) === upper(document.document_type || document.type));
  }));
  if (missing.length) {
    return { check: 'DOCUMENTS', status: 'FAIL', detail: missing.length + ' required document(s) missing or not accepted: ' + missing.map((requirement) => requirement.type || requirement.documentId).join(', ') + '.' };
  }
  return { check: 'DOCUMENTS', status: 'PASS', detail: 'All ' + requirements.length + ' required document(s) received and accepted.' };
}

function memberChecklist(entities, membership) {
  const item = records(entities, 'BookingItem').find((candidate) => candidate.booking_item_id === membership.booking_item_id) || null;
  if (!item) {
    return {
      membershipId: membership.departure_membership_id || null,
      bookingItemId: membership.booking_item_id || null,
      bookingId: null, clientId: null, clientName: null, leadPaxName: null,
      checks: READINESS_CHECKS.map((check) => ({ check, status: 'UNKNOWN', detail: 'The linked Booking Item no longer exists; this membership cannot be verified.' }))
    };
  }
  const booking = records(entities, 'Booking').find((candidate) => candidate.booking_id === item.booking_id) || null;
  const bookingItems = booking
    ? records(entities, 'BookingItem').filter((candidate) => candidate.booking_id === booking.booking_id)
    : [item];
  const client = booking && records(entities, 'Client').find((candidate) => candidate.client_id === booking.client_id) || null;
  const leadPax = booking && booking.lead_pax_person_id
    ? records(entities, 'Person').find((candidate) => candidate.person_id === booking.lead_pax_person_id) || null
    : null;
  let checks;
  if (!booking) {
    checks = READINESS_CHECKS.map((check) => ({ check, status: 'UNKNOWN', detail: 'The Booking Item is not linked to a Booking; this membership cannot be verified.' }));
  } else {
    checks = [
      bookingPaymentCheck(entities, booking),
      ticketingCheck(entities, bookingItems),
      voucherCheck(entities, bookingItems),
      documentsCheck(entities, booking, bookingItems)
    ];
  }
  return {
    membershipId: membership.departure_membership_id || null,
    bookingItemId: item.booking_item_id,
    bookingId: booking && booking.booking_id || null,
    clientId: booking && booking.client_id || null,
    clientName: client && (client.display_name || client.legal_name) || null,
    leadPaxName: leadPax && (leadPax.display_name || leadPax.name) || null,
    checks
  };
}

function buildDepartureReadiness(source, departureId, options) {
  if (departureId === undefined || departureId === null || String(departureId).trim() === '') {
    throw new WmitError('REQUIRED_FIELD', 'departure_id is required.', { field: 'departure_id' });
  }
  const entities = collectEntities(source);
  const departure = records(entities, 'Departure').find((candidate) => candidate.departure_id === departureId) || null;
  if (!departure) throw new WmitError('NOT_FOUND', 'Departure ' + departureId + ' was not found.', { type: 'Departure', id: String(departureId) });
  const opts = options || {};
  const asOf = resolveAsOf(opts.asOf, opts.now);
  const startDate = dateOnly(departure.start_date || departure.travel_start);
  const endDate = dateOnly(departure.end_date || departure.travel_end) || startDate;

  // Cancelled services are not part of the departure anymore; every other
  // membership gets a full checklist row.
  const memberships = records(entities, 'DepartureMembership')
    .filter((membership) => membership.departure_id === departure.departure_id)
    .filter((membership) => {
      const item = records(entities, 'BookingItem').find((candidate) => candidate.booking_item_id === membership.booking_item_id);
      return !item || !isCancelledItem(item);
    });
  const members = memberships.map((membership) => memberChecklist(entities, membership));

  let pass = 0; let fail = 0; let unknown = 0;
  members.forEach((member) => member.checks.forEach((check) => {
    if (check.status === 'PASS') pass += 1;
    else if (check.status === 'FAIL') fail += 1;
    else unknown += 1;
  }));
  const decisive = pass + fail;
  return {
    version: DEPARTURE_READINESS_VERSION,
    departureId: departure.departure_id,
    asOf,
    departure: {
      departureId: departure.departure_id,
      name: departure.name || departure.display_name || departure.departure_id,
      destination: departure.destination || null,
      startDate,
      endDate,
      state: departure.state || 'DRAFT',
      daysUntilStart: startDate ? Math.round((Date.parse(startDate + 'T00:00:00Z') - Date.parse(asOf + 'T00:00:00Z')) / 86400000) : null
    },
    members,
    counts: { members: members.length, checks: decisive + unknown, pass, fail, unknown },
    score: decisive ? Math.round((pass * 100) / decisive) : null,
    state: fail > 0 ? 'NOT_READY' : unknown > 0 ? 'ATTENTION' : 'READY'
  };
}

module.exports = {
  DEPARTURE_READINESS_VERSION,
  READINESS_CHECKS,
  CHECK_LABELS,
  buildDepartureReadiness
};
