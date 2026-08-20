'use strict';

// Client reminder draft queue: pure target selection and rendering for the
// three review-before-send reminder categories. Drafts are email bodies a
// human reviews and sends manually — this module and the runtime action that
// calls it NEVER send anything. Same pure-function style as today-overview.js:
// the runtime method (generateReminderDrafts) owns validation, dedupe,
// persistence, and audit.

const { resolveAsOf } = require('./today-overview');
const { toMinorUnits, fromMinorUnits } = require('../core/money');

const REMINDER_DRAFTS_VERSION = 'V1';
const REMINDER_CATEGORIES = Object.freeze(['BALANCE_DUE', 'MISSING_DOCUMENTS', 'DEPARTURE_REMINDER']);
const REMINDER_TEMPLATE_KEYS = Object.freeze({
  BALANCE_DUE: 'REMINDER_BALANCE_DUE',
  MISSING_DOCUMENTS: 'REMINDER_MISSING_DOCUMENTS',
  DEPARTURE_REMINDER: 'REMINDER_DEPARTURE'
});
const REMINDER_WINDOW_DAYS = 7;
const REMINDER_DEPARTURE_MIN_DAYS = 3;
const REMINDER_DEPARTURE_MAX_DAYS = 7;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const REMINDER_SUBJECTS = Object.freeze({
  BALANCE_DUE: 'Payment reminder — booking {{booking_reference}}',
  MISSING_DOCUMENTS: 'Travel documents needed — booking {{booking_reference}}',
  DEPARTURE_REMINDER: 'Your trip {{departure_name}} is coming up'
});

const REMINDER_BODIES = Object.freeze({
  BALANCE_DUE: [
    'Dear {{client_name}},',
    '',
    'Our records show an outstanding balance of {{currency}} {{outstanding}} on your booking {{booking_reference}}, which was {{due_label}} {{due_date}}.',
    '',
    '{{payment_terms}}',
    '',
    'Bank details:',
    '{{bank_details}}',
    '',
    'If you have already sent your payment, please send us the proof of payment so we can verify and record it.',
    '',
    'Thank you,',
    'Worldmaster International Travel'
  ].join('\n'),
  MISSING_DOCUMENTS: [
    'Dear {{client_name}},',
    '',
    'To finalize your booking {{booking_reference}} we still need the following document(s):',
    '',
    '{{missing_documents}}',
    '',
    'Please send them at your earliest convenience so we can complete your travel arrangements.',
    '',
    'Thank you,',
    'Worldmaster International Travel'
  ].join('\n'),
  DEPARTURE_REMINDER: [
    'Dear {{client_name}},',
    '',
    'This is a friendly reminder that your trip {{departure_name}}{{destination_clause}} begins on {{start_date}}.',
    '',
    'Please make sure your travel documents are ready and arrive at your departure point on time. If anything has changed, reply to this message or contact our office.',
    '',
    'Safe travels,',
    'Worldmaster International Travel'
  ].join('\n')
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

function dateOnlyPlusDays(value, days) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function collectEntities(source) {
  if (source && typeof source.list === 'function') {
    const names = [
      'Client', 'Booking', 'BookingItem', 'ClientObligation', 'PaymentScheduleItem',
      'ClientPayment', 'PaymentAllocation', 'Document', 'Departure', 'DepartureMembership'
    ];
    return Object.fromEntries(names.map((name) => [name, asArray(source.list(name))]));
  }
  const value = source && source.ok && source.data ? source.data : source;
  return (value && value.entities) || value || {};
}

function records(entities, type) {
  return asArray(entities[type]);
}

function renderTemplate(text, vars) {
  return String(text === undefined || text === null ? '' : text).replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, key) => (
    vars[key] === undefined || vars[key] === null ? '' : String(vars[key])
  ));
}

function clientEmail(client) {
  const email = client && String(client.primary_email || client.email || '').trim();
  return email && EMAIL_PATTERN.test(email) ? email : null;
}

function moneyOrZero(value) {
  try { return toMinorUnits(value === undefined || value === null || value === '' ? '0.00' : value); }
  catch (_) { return 0n; }
}

// Outstanding obligation math mirrors today-overview paymentsDueSection: the
// fallback PaymentScheduleItem set is only authoritative when no
// ClientObligation exists; verified payments allocate through ACTIVE rows.
function outstandingObligations(entities) {
  const clientsById = new Map(records(entities, 'Client').map((client) => [client.client_id, client]));
  const bookingsById = new Map(records(entities, 'Booking').map((booking) => [booking.booking_id, booking]));
  const obligations = records(entities, 'ClientObligation');
  const schedule = records(entities, 'PaymentScheduleItem');
  const obligationRecords = obligations.length ? obligations : schedule;
  const verifiedPaymentIds = new Set(records(entities, 'ClientPayment')
    .filter((payment) => upper(payment.payment_state || payment.state) === 'VERIFIED')
    .map((payment) => payment.client_payment_id));
  const allocations = records(entities, 'PaymentAllocation')
    .filter((allocation) => upper(allocation.state || 'ACTIVE') === 'ACTIVE' && verifiedPaymentIds.has(allocation.client_payment_id));

  const items = [];
  obligationRecords.forEach((obligation) => {
    const obligationId = obligation.client_obligation_id || obligation.payment_schedule_item_id;
    const dueDate = dateOnly(obligation.due_at || obligation.due_date);
    if (!dueDate) return;
    const targeted = allocations.filter((allocation) => {
      if (allocation.client_obligation_id) return allocation.client_obligation_id === obligationId;
      return !obligations.length && obligationRecords.length === 1 && allocation.booking_id === obligation.booking_id;
    });
    const amount = String(obligation.amount || obligation.total_amount || obligation.balance_due || '0.00');
    const outstandingMinor = moneyOrZero(amount) - targeted.reduce((sum, allocation) => sum + moneyOrZero(allocation.amount), 0n);
    if (outstandingMinor <= 0n) return; // fully satisfied
    const booking = bookingsById.get(obligation.booking_id) || null;
    const client = booking && clientsById.get(booking.client_id) || null;
    items.push({
      obligationId,
      booking,
      client,
      amount,
      outstanding: fromMinorUnits(outstandingMinor),
      currency: obligation.currency || booking && booking.currency || null,
      dueDate,
      purpose: obligation.purpose || 'INSTALLMENT'
    });
  });
  return items;
}

function balanceDueTargets(entities, asOf, options) {
  const horizon = dateOnlyPlusDays(asOf, REMINDER_WINDOW_DAYS);
  return outstandingObligations(entities)
    // due within ±7 days of today, or overdue (any age) — the human decides
    .filter((item) => item.dueDate && item.dueDate <= horizon)
    .map((item) => {
      const clientName = item.client && (item.client.display_name || item.client.legal_name) || item.booking && item.booking.client_id || 'Client';
      const overdue = item.dueDate < asOf;
      const vars = {
        client_name: clientName,
        booking_reference: item.booking && item.booking.booking_id || item.obligationId,
        outstanding: item.outstanding,
        currency: item.currency || '',
        due_date: item.dueDate,
        due_label: overdue ? 'originally due' : 'due',
        payment_terms: options.quotationDefaults.paymentTerms || '',
        bank_details: options.quotationDefaults.bankDetails || ''
      };
      return {
        key: 'BALANCE:' + item.obligationId,
        category: 'BALANCE_DUE',
        recipientEmail: clientEmail(item.client),
        recipientName: clientName,
        subject: renderTemplate(REMINDER_SUBJECTS.BALANCE_DUE, vars),
        body: renderTemplate(options.templates.BALANCE_DUE, vars),
        clientId: item.client && item.client.client_id || null,
        bookingId: item.booking && item.booking.booking_id || null,
        departureId: null,
        obligationId: item.obligationId,
        priority: overdue ? 'HIGH' : 'NORMAL',
        contextDate: item.dueDate
      };
    });
}

// Missing traveler documents: per booking, every Booking Item that declares
// required_documents is checked against linked, accepted Document records
// (same linkage and acceptance semantics as the departure readiness check).
function missingDocumentTargets(entities, asOf) {
  const bookingsById = new Map(records(entities, 'Booking').map((booking) => [booking.booking_id, booking]));
  const clientsById = new Map(records(entities, 'Client').map((client) => [client.client_id, client]));
  const memberships = records(entities, 'DepartureMembership');
  const targets = [];

  const byBooking = new Map();
  records(entities, 'BookingItem').forEach((item) => {
    if (!item.booking_id || !bookingsById.has(item.booking_id)) return;
    const requirements = asArray(item.required_documents || item.required_document_types);
    if (!requirements.length) return;
    if (!byBooking.has(item.booking_id)) byBooking.set(item.booking_id, []);
    byBooking.get(item.booking_id).push({ item, requirements });
  });

  byBooking.forEach((entries, bookingId) => {
    const booking = bookingsById.get(bookingId);
    // Reminding about a trip that already ended is noise, not a reminder.
    const items = records(entities, 'BookingItem').filter((candidate) => candidate.booking_id === bookingId);
    const ends = items.map((item) => dateOnly(item.travel_end)).concat(dateOnly(booking.travel_end)).filter(Boolean).sort();
    if (ends.length && ends[ends.length - 1] < asOf) return;
    const documents = records(entities, 'Document').filter((document) =>
      (document.booking_id && document.booking_id === bookingId) ||
      items.some((item) => document.booking_item_id && document.booking_item_id === item.booking_item_id) ||
      (document.related_entity_type === 'Booking' && document.related_entity_id === bookingId)
    );
    const missingLines = [];
    entries.forEach((entry) => {
      entry.requirements.forEach((requirement) => {
        const type = typeof requirement === 'string' ? requirement : requirement && requirement.type || null;
        const documentId = requirement && typeof requirement === 'object' ? requirement.document_id || null : null;
        const satisfied = documents.some((document) => {
          const accepted = ['ACCEPTED', 'APPROVED', 'COMPLETE', 'COMPLETED', 'ISSUED', 'READY', 'RECEIVED', 'VERIFIED'].includes(upper(document.review_status || document.status || document.state));
          if (!accepted) return false;
          if (documentId && document.document_id === documentId) return true;
          return Boolean(type && upper(type) === upper(document.document_type || document.type));
        });
        if (!satisfied) {
          missingLines.push('- ' + (type || documentId || 'document') + ' (' + (entry.item.description || entry.item.service_type || entry.item.booking_item_id) + ')');
        }
      });
    });
    if (!missingLines.length) return;
    const client = clientsById.get(booking.client_id) || null;
    const clientName = client && (client.display_name || client.legal_name) || booking.client_id || 'Client';
    const departure = memberships
      .map((membership) => membership.booking_item_id && records(entities, 'Departure').find((candidate) => candidate.departure_id === membership.departure_id))
      .find(Boolean) || null;
    const vars = {
      client_name: clientName,
      booking_reference: bookingId,
      missing_documents: missingLines.join('\n')
    };
    const urgencyDate = dateOnly(departure && departure.start_date) || dateOnly(booking.travel_start);
    targets.push({
      key: 'DOCS:' + bookingId,
      category: 'MISSING_DOCUMENTS',
      recipientEmail: clientEmail(client),
      recipientName: clientName,
      subject: renderTemplate(REMINDER_SUBJECTS.MISSING_DOCUMENTS, vars),
      body: renderTemplate(REMINDER_BODIES.MISSING_DOCUMENTS, vars),
      clientId: client && client.client_id || null,
      bookingId,
      departureId: departure && departure.departure_id || null,
      obligationId: null,
      priority: urgencyDate && urgencyDate <= dateOnlyPlusDays(asOf, 14) ? 'HIGH' : 'NORMAL',
      contextDate: urgencyDate
    });
  });
  return targets;
}

// Departures 3-7 days out: one draft per departure member booking so each
// client receives their own reminder.
function departureReminderTargets(entities, asOf) {
  const from = dateOnlyPlusDays(asOf, REMINDER_DEPARTURE_MIN_DAYS);
  const to = dateOnlyPlusDays(asOf, REMINDER_DEPARTURE_MAX_DAYS);
  const itemsById = new Map(records(entities, 'BookingItem').map((item) => [item.booking_item_id, item]));
  const bookingsById = new Map(records(entities, 'Booking').map((booking) => [booking.booking_id, booking]));
  const clientsById = new Map(records(entities, 'Client').map((client) => [client.client_id, client]));
  const targets = [];
  records(entities, 'Departure')
    .filter((departure) => upper(departure.state) !== 'CANCELLED')
    .forEach((departure) => {
      const startDate = dateOnly(departure.start_date || departure.travel_start);
      if (!startDate || startDate < from || startDate > to) return;
      const memberBookingIds = Array.from(new Set(records(entities, 'DepartureMembership')
        .filter((membership) => membership.departure_id === departure.departure_id)
        .map((membership) => {
          const item = itemsById.get(membership.booking_item_id);
          return item && item.booking_id;
        })
        .filter(Boolean)));
      memberBookingIds.forEach((bookingId) => {
        const booking = bookingsById.get(bookingId) || null;
        const client = booking && clientsById.get(booking.client_id) || null;
        const clientName = client && (client.display_name || client.legal_name) || booking && booking.client_id || 'Client';
        const vars = {
          client_name: clientName,
          departure_name: departure.name || departure.display_name || departure.departure_id,
          destination: departure.destination || '',
          destination_clause: departure.destination ? ' (' + departure.destination + ')' : '',
          start_date: startDate
        };
        targets.push({
          key: 'DEPART:' + departure.departure_id + ':' + bookingId,
          category: 'DEPARTURE_REMINDER',
          recipientEmail: clientEmail(client),
          recipientName: clientName,
          subject: renderTemplate(REMINDER_SUBJECTS.DEPARTURE_REMINDER, vars),
          body: renderTemplate(REMINDER_BODIES.DEPARTURE_REMINDER, vars),
          clientId: client && client.client_id || null,
          bookingId,
          departureId: departure.departure_id,
          obligationId: null,
          priority: 'NORMAL',
          contextDate: startDate
        });
      });
    });
  return targets;
}

// options: { category, asOf, messageTemplates, quotationDefaults }
// Returns { targets } — the runtime action owns recipient skipping and dedupe.
function collectReminderTargets(source, options) {
  const opts = options || {};
  const entities = collectEntities(source);
  const templates = {
    BALANCE_DUE: REMINDER_BODIES.BALANCE_DUE,
    MISSING_DOCUMENTS: REMINDER_BODIES.MISSING_DOCUMENTS,
    DEPARTURE_REMINDER: REMINDER_BODIES.DEPARTURE_REMINDER
  };
  const configured = new Map((opts.messageTemplates || []).map((template) => [template.key, template.body]));
  const templateKey = REMINDER_TEMPLATE_KEYS[opts.category];
  if (templateKey && configured.has(templateKey)) templates[opts.category] = configured.get(templateKey);
  const renderOptions = {
    templates,
    quotationDefaults: opts.quotationDefaults || {}
  };
  const asOf = resolveAsOf(opts.asOf);
  let targets = [];
  if (opts.category === 'BALANCE_DUE') targets = balanceDueTargets(entities, asOf, renderOptions);
  else if (opts.category === 'MISSING_DOCUMENTS') targets = missingDocumentTargets(entities, asOf);
  else if (opts.category === 'DEPARTURE_REMINDER') targets = departureReminderTargets(entities, asOf);
  return { asOf, targets };
}

module.exports = {
  REMINDER_DRAFTS_VERSION,
  REMINDER_CATEGORIES,
  REMINDER_TEMPLATE_KEYS,
  REMINDER_WINDOW_DAYS,
  REMINDER_DEPARTURE_MIN_DAYS,
  REMINDER_DEPARTURE_MAX_DAYS,
  collectReminderTargets
};
