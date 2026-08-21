'use strict';

// "Today" overview and global search: read-only projections over existing
// Phase 1 records, in the same pure-function style as case-projection.js.
// No new entities, no writes — the runtime methods that call these
// (getTodayOverview, globalSearch) own validation, audit, and result shaping.

const { WmitError } = require('../core/errors');
const { toMinorUnits, fromMinorUnits } = require('../core/money');

const TODAY_OVERVIEW_VERSION = 'V1';
const GLOBAL_SEARCH_VERSION = 'V1';

const PAYMENTS_DUE_WINDOW_DAYS = 7;
const DEPARTURES_WINDOW_DAYS = 30;
const QUOTE_EXPIRY_WINDOW_DAYS = 7;
const GLOBAL_SEARCH_MIN_LENGTH = 2;
const GLOBAL_SEARCH_MAX_RESULTS = 8;

const OPEN_TASK_STATES = new Set(['OPEN', 'IN_PROGRESS', 'BLOCKED']);
const OPEN_READINESS_ISSUE_STATES = new Set(['OPEN', 'IN_PROGRESS']);
const SUPPLIER_PRELIMINARY_STATES = new Set(['REQUESTED', 'HELD', 'RESERVED', 'PARTIALLY_CONFIRMED', 'PENDING']);
// Mirrors the document-intelligence review queue (DocumentsIngestionService):
// anything still awaiting classification, extraction, or human review.
const DOCUMENT_REVIEW_STATUSES = new Set(['RECEIVED', 'CLASSIFIED', 'NEEDS_REVIEW']);

const SEARCH_GROUPS = Object.freeze(['Client', 'Inquiry', 'Quotation', 'Booking', 'ExpoLead']);

function upper(value) {
  return String(value || '').trim().toUpperCase();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function collectEntities(source) {
  if (source && typeof source.list === 'function') {
    const names = [
      'Client', 'Inquiry', 'Quotation', 'QuotationAcceptance', 'Booking', 'Supplier', 'SupplierBooking',
      'ClientObligation', 'PaymentScheduleItem', 'ClientPayment', 'PaymentAllocation',
      'Task', 'Document', 'Departure', 'DepartureMembership', 'DepartureReadinessIssue', 'ExpoLead'
    ];
    return Object.fromEntries(names.map((name) => [name, asArray(source.list(name))]));
  }
  const value = source && source.ok && source.data ? source.data : source;
  return (value && value.entities) || value || {};
}

function records(entities, type) {
  return asArray(entities[type]);
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

function moneyOrZero(value) {
  try { return toMinorUnits(value === undefined || value === null || value === '' ? '0.00' : value); }
  catch (_) { return 0n; }
}

function sumMoney(values) {
  return fromMinorUnits(values.reduce((sum, value) => sum + moneyOrZero(value), 0n));
}

function subtractMoney(a, b) {
  const result = moneyOrZero(a) - moneyOrZero(b);
  return fromMinorUnits(result < 0n ? 0n : result);
}

function resolveAsOf(value, fallbackIso) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return dateOnly(fallbackIso) || new Date().toISOString().slice(0, 10);
  }
  const raw = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) {
    throw new WmitError('ASOF_DATE_INVALID', 'The as-of date must look like 2026-08-20.', { asOf: raw.slice(0, 20) });
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Section 1 — client payments due today..+7 days, not fully satisfied.
// Outstanding math mirrors case-projection.financeProjection: verified client
// payments allocate through ACTIVE PaymentAllocation rows; PaymentScheduleItem
// is the fallback record set only when no ClientObligation exists.
// ---------------------------------------------------------------------------

function paymentsDueSection(entities, today, horizon) {
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
    if (!dueDate || dueDate < today || dueDate > horizon) return;
    const targeted = allocations.filter((allocation) => {
      if (allocation.client_obligation_id) return allocation.client_obligation_id === obligationId;
      return !obligations.length && obligationRecords.length === 1 && allocation.booking_id === obligation.booking_id;
    });
    const allocated = sumMoney(targeted.map((allocation) => allocation.amount));
    const amount = String(obligation.amount || obligation.total_amount || obligation.balance_due || '0.00');
    const outstanding = subtractMoney(amount, allocated);
    if (outstanding === '0.00') return; // fully satisfied
    const booking = bookingsById.get(obligation.booking_id) || null;
    const client = booking && clientsById.get(booking.client_id) || null;
    items.push({
      id: obligationId,
      kind: obligation.client_obligation_id ? 'CLIENT_OBLIGATION' : 'PAYMENT_SCHEDULE',
      bookingId: obligation.booking_id || null,
      clientId: booking && booking.client_id || obligation.client_id || null,
      clientName: client && (client.display_name || client.legal_name) || (booking && booking.client_id) || null,
      purpose: obligation.purpose || 'INSTALLMENT',
      amount,
      allocated,
      outstanding,
      currency: obligation.currency || booking && booking.currency || null,
      dueDate,
      state: allocated === '0.00' ? 'OUTSTANDING' : 'PARTIALLY_SATISFIED'
    });
  });
  items.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || String(a.id).localeCompare(String(b.id)));
  return { count: items.length, items };
}

// ---------------------------------------------------------------------------
// Section 2 — departures whose travel period overlaps today..+30 days.
// A trip already in progress (started before today, ends inside the window)
// still needs readiness oversight, so the window is an overlap test.
// ---------------------------------------------------------------------------

function departuresSection(entities, today, horizon) {
  const memberships = records(entities, 'DepartureMembership');
  const issues = records(entities, 'DepartureReadinessIssue');
  const items = records(entities, 'Departure')
    .filter((departure) => upper(departure.state) !== 'CANCELLED')
    .map((departure) => {
      const startDate = dateOnly(departure.start_date || departure.travel_start);
      const endDate = dateOnly(departure.end_date || departure.travel_end) || startDate;
      const departureMembers = memberships.filter((membership) => membership.departure_id === departure.departure_id);
      const memberItemIds = new Set(departureMembers.map((membership) => membership.booking_item_id).filter(Boolean));
      const openIssues = issues.filter((issue) => (issue.departure_id === departure.departure_id || (issue.booking_item_id && memberItemIds.has(issue.booking_item_id))) && OPEN_READINESS_ISSUE_STATES.has(upper(issue.state || 'OPEN')));
      return {
        departureId: departure.departure_id,
        name: departure.name || departure.display_name || departure.departure_id,
        destination: departure.destination || null,
        startDate,
        endDate,
        state: departure.state || 'DRAFT',
        memberCount: departureMembers.length,
        openIssueCount: openIssues.length,
        blockerCount: openIssues.filter((issue) => ['HIGH', 'BLOCKER'].includes(upper(issue.severity))).length
      };
    })
    .filter((item) => item.startDate && item.endDate >= today && item.startDate <= horizon);
  items.sort((a, b) => a.startDate.localeCompare(b.startDate) || String(a.departureId).localeCompare(String(b.departureId)));
  return { count: items.length, items };
}

// ---------------------------------------------------------------------------
// Section 3 — supplier bookings still in a preliminary/unconfirmed state.
// ---------------------------------------------------------------------------

function supplierConfirmationsSection(entities) {
  const suppliersById = new Map(records(entities, 'Supplier').map((supplier) => [supplier.supplier_id, supplier]));
  const items = records(entities, 'SupplierBooking')
    .map((supplierBooking) => ({
      supplierBookingId: supplierBooking.supplier_booking_id,
      bookingId: supplierBooking.booking_id || null,
      supplierId: supplierBooking.supplier_id || null,
      supplierName: supplierBooking.supplier_id && suppliersById.get(supplierBooking.supplier_id) && (suppliersById.get(supplierBooking.supplier_id).display_name || suppliersById.get(supplierBooking.supplier_id).legal_name) || null,
      reservationState: upper(supplierBooking.reservation_state || supplierBooking.fulfillment_state || supplierBooking.state || 'REQUESTED'),
      fulfillmentState: upper(supplierBooking.fulfillment_state || supplierBooking.reservation_state || supplierBooking.state || 'REQUESTED'),
      requestedAt: supplierBooking.created_at || null
    }))
    .filter((item) => SUPPLIER_PRELIMINARY_STATES.has(item.reservationState));
  items.sort((a, b) => String(a.requestedAt || '').localeCompare(String(b.requestedAt || '')) || String(a.supplierBookingId).localeCompare(String(b.supplierBookingId)));
  return { count: items.length, items };
}

// ---------------------------------------------------------------------------
// Section 4 — open follow-up tasks due today or overdue (incl. expo tasks).
// ---------------------------------------------------------------------------

function followUpsDueSection(entities, today) {
  const items = records(entities, 'Task')
    .filter((task) => OPEN_TASK_STATES.has(upper(task.state || 'OPEN')))
    .map((task) => ({
      taskId: task.task_id,
      title: task.title || task.description || task.task_type || 'Follow-up',
      description: task.description || null,
      taskType: task.task_type || null,
      source: task.source || null,
      priority: task.priority || 'NORMAL',
      state: upper(task.state || 'OPEN'),
      dueDate: dateOnly(task.due_date || task.due_at),
      inquiryId: task.inquiry_id || (task.related_type === 'Inquiry' ? task.related_id : null) || null,
      bookingId: task.booking_id || (task.related_type === 'Booking' ? task.related_id : null) || null,
      expoLeadId: task.expo_lead_id || (task.related_type === 'ExpoLead' ? task.related_id : null) || null
    }))
    .filter((item) => item.dueDate && item.dueDate <= today)
    .map((item) => Object.assign(item, { overdue: item.dueDate < today }));
  items.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || String(a.taskId).localeCompare(String(b.taskId)));
  return { count: items.length, items };
}

// ---------------------------------------------------------------------------
// Section 5 — documents pending classification/extraction/review.
// ---------------------------------------------------------------------------

function documentPendingStatus(document) {
  const status = upper(document.status).replace(/\s+/g, '_');
  if (status) return DOCUMENT_REVIEW_STATUSES.has(status) ? status : null;
  // Records without an explicit status default to the review queue unless a
  // review decision already moved them on.
  return upper(document.review_status) === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : null;
}

function documentsPendingReviewSection(entities) {
  const items = records(entities, 'Document')
    .map((document) => ({ document, pendingStatus: documentPendingStatus(document) }))
    .filter((entry) => entry.pendingStatus)
    .map((entry) => {
      const document = entry.document;
      return {
        documentId: document.document_id,
        fileName: document.file_name || document.filename || document.document_name || document.document_type || 'Document',
        documentType: document.document_type || null,
        status: entry.pendingStatus,
        reviewStatus: document.review_status || null,
        sourceType: document.source_type || null,
        receivedAt: document.received_at || document.created_at || null,
        inquiryId: document.inquiry_id || null,
        bookingId: document.booking_id || null,
        supplierId: document.supplier_id || null
      };
    });
  items.sort((a, b) => String(a.receivedAt || '').localeCompare(String(b.receivedAt || '')) || String(a.documentId).localeCompare(String(b.documentId)));
  return { count: items.length, items };
}

// ---------------------------------------------------------------------------
// Section 6 — draft quotations with a priced client total, awaiting the
// owner's approval decision. Mirrors the selection the old Dashboard queue
// performed client-side; the logic now lives server-side.
// ---------------------------------------------------------------------------

function quotesAwaitingApprovalSection(entities) {
  const clientsById = new Map(records(entities, 'Client').map((client) => [client.client_id, client]));
  const items = records(entities, 'Quotation')
    .filter((quote) => upper(quote.status) === 'DRAFT' && moneyOrZero(quote.client_total) > 0n)
    .map((quote) => {
      const client = clientsById.get(quote.client_id) || null;
      return {
        quotationId: quote.quotation_id,
        clientId: quote.client_id || null,
        clientName: client && (client.display_name || client.legal_name) || quote.client_id || null,
        destination: quote.destination || null,
        clientTotal: String(quote.client_total),
        currency: quote.currency || null,
        inquiryId: quote.inquiry_id || null
      };
    });
  items.sort((a, b) => String(a.quotationId).localeCompare(String(b.quotationId)));
  return { count: items.length, items };
}

// ---------------------------------------------------------------------------
// Section 7 — approved quotations the client has not accepted whose validity
// window ends within 7 days (or has already lapsed: "expired").
// ---------------------------------------------------------------------------

function quotesExpiringSoonSection(entities, today, horizon) {
  const clientsById = new Map(records(entities, 'Client').map((client) => [client.client_id, client]));
  const acceptedQuoteIds = new Set(records(entities, 'QuotationAcceptance')
    .filter((acceptance) => upper(acceptance.state || 'ACCEPTED') === 'ACCEPTED')
    .map((acceptance) => acceptance.quotation_id));
  const items = records(entities, 'Quotation')
    .filter((quote) => upper(quote.status) === 'APPROVED' && !acceptedQuoteIds.has(quote.quotation_id))
    .map((quote) => ({ quote, validUntil: dateOnly(quote.valid_until) }))
    .filter((entry) => entry.validUntil && entry.validUntil <= horizon)
    .map((entry) => {
      const quote = entry.quote;
      const client = clientsById.get(quote.client_id) || null;
      return {
        quotationId: quote.quotation_id,
        clientId: quote.client_id || null,
        clientName: client && (client.display_name || client.legal_name) || quote.client_id || null,
        destination: quote.destination || null,
        validUntil: entry.validUntil,
        expired: entry.validUntil < today,
        currency: quote.currency || null,
        clientTotal: String(quote.client_total || ''),
        inquiryId: quote.inquiry_id || null
      };
    });
  items.sort((a, b) => a.validUntil.localeCompare(b.validUntil) || String(a.quotationId).localeCompare(String(b.quotationId)));
  return { count: items.length, items };
}

function buildTodayOverview(source, options) {
  const opts = options || {};
  const today = resolveAsOf(opts.asOf, opts.now);
  const horizonPayments = dateOnlyPlusDays(today, PAYMENTS_DUE_WINDOW_DAYS);
  const horizonDepartures = dateOnlyPlusDays(today, DEPARTURES_WINDOW_DAYS);
  const horizonQuotes = dateOnlyPlusDays(today, QUOTE_EXPIRY_WINDOW_DAYS);
  const entities = collectEntities(source);
  const paymentsDue = paymentsDueSection(entities, today, horizonPayments);
  const departures = departuresSection(entities, today, horizonDepartures);
  const supplierConfirmations = supplierConfirmationsSection(entities);
  const followUpsDue = followUpsDueSection(entities, today);
  const documentsPendingReview = documentsPendingReviewSection(entities);
  const quotesAwaitingApproval = quotesAwaitingApprovalSection(entities);
  const quotesExpiringSoon = quotesExpiringSoonSection(entities, today, horizonQuotes);
  return {
    version: TODAY_OVERVIEW_VERSION,
    today,
    windows: { paymentsDueDays: PAYMENTS_DUE_WINDOW_DAYS, departuresDays: DEPARTURES_WINDOW_DAYS, quoteExpiryDays: QUOTE_EXPIRY_WINDOW_DAYS },
    paymentsDue,
    departures,
    supplierConfirmations,
    followUpsDue,
    documentsPendingReview,
    quotesAwaitingApproval,
    quotesExpiringSoon,
    counts: {
      paymentsDue: paymentsDue.count,
      departures: departures.count,
      supplierConfirmations: supplierConfirmations.count,
      followUpsDue: followUpsDue.count,
      documentsPendingReview: documentsPendingReview.count,
      quotesAwaitingApproval: quotesAwaitingApproval.count,
      quotesExpiringSoon: quotesExpiringSoon.count
    }
  };
}

// ---------------------------------------------------------------------------
// Global search — case-insensitive substring matches across the five record
// families the owner looks up most, top N per group.
// ---------------------------------------------------------------------------

function parseSearchQuery(input) {
  const value = typeof input === 'string' ? input : input && input.query;
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new WmitError('REQUIRED_FIELD', 'query is required.', { field: 'query' });
  }
  const query = String(value).trim();
  if (query.length < GLOBAL_SEARCH_MIN_LENGTH) {
    throw new WmitError('QUERY_TOO_SHORT', 'Enter at least ' + GLOBAL_SEARCH_MIN_LENGTH + ' characters to search.', { query: query.slice(0, 40) });
  }
  return query;
}

function searchClientGroup(entities, matches) {
  const results = records(entities, 'Client')
    .filter((client) => matches(client.display_name, client.legal_name, client.primary_email, client.primary_phone, client.client_id, client.country))
    .map((client) => ({
      id: client.client_id,
      type: 'Client',
      label: client.display_name || client.legal_name || client.client_id,
      subtitle: [client.primary_phone, client.primary_email, client.client_id].filter(Boolean).join(' · ')
    }));
  return { type: 'Client', results };
}

function searchInquiryGroup(entities, matches) {
  const clientsById = new Map(records(entities, 'Client').map((client) => [client.client_id, client]));
  const results = records(entities, 'Inquiry')
    .map((inquiry) => {
      const requirements = inquiry.current_requirements || inquiry.original_request || {};
      const client = clientsById.get(inquiry.client_id) || null;
      const clientName = client && (client.display_name || client.legal_name) || null;
      return {
        inquiry,
        requirements,
        clientName,
        hit: matches(inquiry.inquiry_id, requirements.destination, requirements.travel_start, requirements.travel_month, clientName)
      };
    })
    .filter((entry) => entry.hit)
    .map((entry) => ({
      id: entry.inquiry.inquiry_id,
      type: 'Inquiry',
      label: (entry.clientName || 'Client') + ' · ' + (entry.requirements.destination || 'Destination pending'),
      subtitle: entry.inquiry.inquiry_id + (dateOnly(entry.requirements.travel_start) ? ' · from ' + dateOnly(entry.requirements.travel_start) : '')
    }));
  return { type: 'Inquiry', results };
}

function searchQuotationGroup(entities, matches) {
  const clientsById = new Map(records(entities, 'Client').map((client) => [client.client_id, client]));
  const results = records(entities, 'Quotation')
    .map((quotation) => {
      const client = clientsById.get(quotation.client_id) || null;
      const clientName = client && (client.display_name || client.legal_name) || null;
      return { quotation, clientName, hit: matches(quotation.quotation_id, quotation.destination, clientName, quotation.status) };
    })
    .filter((entry) => entry.hit)
    .map((entry) => ({
      id: entry.quotation.quotation_id,
      type: 'Quotation',
      label: (entry.clientName || 'Client') + ' · ' + (entry.quotation.destination || 'Quotation'),
      subtitle: entry.quotation.quotation_id + (entry.quotation.status ? ' · ' + upper(entry.quotation.status) : '')
    }));
  return { type: 'Quotation', results };
}

function searchBookingGroup(entities, matches) {
  const clientsById = new Map(records(entities, 'Client').map((client) => [client.client_id, client]));
  const results = records(entities, 'Booking')
    .map((booking) => {
      const client = clientsById.get(booking.client_id) || null;
      const clientName = client && (client.display_name || client.legal_name) || null;
      return { booking, clientName, hit: matches(booking.booking_id, clientName, booking.commitment_state, booking.travel_start) };
    })
    .filter((entry) => entry.hit)
    .map((entry) => ({
      id: entry.booking.booking_id,
      type: 'Booking',
      label: entry.booking.booking_id,
      subtitle: [entry.clientName, upper(entry.booking.commitment_state), dateOnly(entry.booking.travel_start)].filter(Boolean).join(' · ')
    }));
  return { type: 'Booking', results };
}

function searchExpoLeadGroup(entities, matches) {
  const results = records(entities, 'ExpoLead')
    .filter((lead) => matches(lead.name, lead.mobile, lead.email, lead.destination, lead.travel_month, lead.expo_lead_id, lead.expo_tag))
    .map((lead) => ({
      id: lead.expo_lead_id,
      type: 'ExpoLead',
      label: lead.name || lead.expo_lead_id,
      subtitle: [lead.destination, lead.mobile, upper(lead.status)].filter(Boolean).join(' · ')
    }));
  return { type: 'ExpoLead', results };
}

function globalSearch(source, input) {
  const query = parseSearchQuery(input);
  const needle = query.toLowerCase();
  const matches = (...values) => values.some((value) => value !== undefined && value !== null && String(value).toLowerCase().includes(needle));
  const entities = collectEntities(source);
  const groups = SEARCH_GROUPS.map((type) => {
    const builder = {
      Client: searchClientGroup,
      Inquiry: searchInquiryGroup,
      Quotation: searchQuotationGroup,
      Booking: searchBookingGroup,
      ExpoLead: searchExpoLeadGroup
    }[type];
    const group = builder(entities, matches);
    return {
      type,
      count: Math.min(group.results.length, GLOBAL_SEARCH_MAX_RESULTS),
      totalMatches: group.results.length,
      results: group.results.slice(0, GLOBAL_SEARCH_MAX_RESULTS)
    };
  });
  return {
    version: GLOBAL_SEARCH_VERSION,
    query,
    groups,
    totalMatches: groups.reduce((sum, group) => sum + group.totalMatches, 0)
  };
}

module.exports = {
  TODAY_OVERVIEW_VERSION,
  GLOBAL_SEARCH_VERSION,
  PAYMENTS_DUE_WINDOW_DAYS,
  DEPARTURES_WINDOW_DAYS,
  QUOTE_EXPIRY_WINDOW_DAYS,
  GLOBAL_SEARCH_MIN_LENGTH,
  GLOBAL_SEARCH_MAX_RESULTS,
  buildTodayOverview,
  globalSearch,
  resolveAsOf
};
