'use strict';

// WMIT data-privacy enforcement math (implements docs/data-privacy.md
// sections 3, 5, 6): what personal data exists per client, consent status,
// retention status per document, and which sensitive documents are past the
// departure + 30-day retention limit. Pure and read-only, same style as
// departure-readiness.js: the runtime actions that call this own validation,
// authorization, audit, and all writes. This module never mutates.

const PRIVACY_VERSION = 'V1';
// Sensitive personal information under the policy: passport/visa scans and
// identity documents. Everything else is retained per its own schedule.
const SENSITIVE_DOCUMENT_TYPES = Object.freeze(['PASSPORT', 'VISA', 'IDENTITY']);
// Passport/visa document scans: deleted after departure + 30 days
// (docs/data-privacy.md section 5) unless a legal hold applies.
const RETENTION_GRACE_DAYS = 30;

const RETENTION_HINTS = Object.freeze({
  expo_leads: 'Expo lead records (non-converted): 2 years after last contact.',
  client_identity: 'Client identity/contact records: life of relationship + 2 years.',
  quotations: 'Quotations: 2 years after issue.',
  bookings_and_financial: 'Bookings and financial records: 10 years (retention duty — never erased by the privacy actions).',
  sensitive_documents: 'Passport/visa/identity documents: erasure eligible after departure + ' + RETENTION_GRACE_DAYS + ' days, via the manager-gated erasure action.',
  payment_evidence: 'Payment evidence: same retention as financial records.'
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function collectEntities(source) {
  if (source && typeof source.list === 'function') {
    const names = ['Client', 'Inquiry', 'Quotation', 'Booking', 'BookingItem', 'ClientPayment', 'ClientInvoice', 'Document', 'Departure', 'DepartureMembership', 'ExpoLead'];
    return Object.fromEntries(names.map((name) => [name, asArray(source.list(name))]));
  }
  const value = source && source.ok && source.data ? source.data : source;
  return (value && value.entities) || value || {};
}

function records(entities, type) {
  return asArray(entities[type]);
}

function upper(value) {
  return String(value === undefined || value === null ? '' : value).trim().toUpperCase();
}

function dateOnly(value) {
  const raw = String(value === undefined || value === null ? '' : value).trim();
  if (!raw) return null;
  const date = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function dateOnlyPlusDays(value, days) {
  const date = new Date(value + 'T00:00:00Z');
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

// The type used for retention decisions: the explicit document_type field
// or the classified type — never the file name (file names can lie).
function documentTypeOf(document) {
  return upper(document.document_type || (document.classification && document.classification.document_type) || document.type);
}

function sensitiveTypeOf(document) {
  const type = documentTypeOf(document);
  return SENSITIVE_DOCUMENT_TYPES.includes(type) ? type : null;
}

function isSensitiveDocument(document) {
  return sensitiveTypeOf(document) !== null;
}

function isErased(document) {
  return upper(document.status) === 'ERASED' || upper(document.review_status) === 'ERASED';
}

// Client linkage rules: a direct client_id, the generic related-entity
// relation, or a human-approved ingestion match link. All three are
// authoritative links in this system.
function documentClientId(document) {
  if (document.client_id) return document.client_id;
  if (upper(document.related_entity_type) === 'Client' && document.related_entity_id) return document.related_entity_id;
  const link = asArray(document.match_links).find((entry) => upper(entry && entry.entity_type) === 'CLIENT' && entry.entity_id);
  return link ? link.entity_id : null;
}

function clientDocuments(source, clientId) {
  const entities = collectEntities(source);
  return records(entities, 'Document').filter((document) => documentClientId(document) === clientId);
}

function clientBookings(source, clientId) {
  const entities = collectEntities(source);
  return records(entities, 'Booking').filter((booking) => booking.client_id === clientId);
}

// Last travel end for the retention clock: the latest of the client's
// booking travel dates and departure dates reached through membership
// chains. Honest null when nothing is recorded — no date, no eligibility.
function clientLastTravelEnd(source, clientId) {
  const entities = collectEntities(source);
  let latest = null;
  const consider = (date) => {
    const day = dateOnly(date);
    if (day && (!latest || day > latest)) latest = day;
  };
  clientBookings(entities, clientId).forEach((booking) => {
    consider(booking.travel_end || booking.travel_start);
    records(entities, 'BookingItem').filter((item) => item.booking_id === booking.booking_id).forEach((item) => {
      records(entities, 'DepartureMembership').filter((membership) => membership.booking_item_id === item.booking_item_id).forEach((membership) => {
        const departure = records(entities, 'Departure').find((candidate) => candidate.departure_id === membership.departure_id);
        if (departure) consider(departure.end_date || departure.travel_end || departure.start_date || departure.travel_start);
      });
    });
  });
  return latest;
}

function retentionStatusOf(document, lastTravelEnd, asOf) {
  if (isErased(document)) return 'ERASED';
  if (!sensitiveTypeOf(document)) return 'RETAINED';
  if (!lastTravelEnd) return 'RETAINED'; // no departure recorded: the clock never started, fail closed
  const eligibleOn = dateOnlyPlusDays(lastTravelEnd, RETENTION_GRACE_DAYS);
  if (!eligibleOn) return 'RETAINED';
  return asOf >= eligibleOn ? 'ELIGIBLE_FOR_ERASURE' : 'FUTURE';
}

function clientConsentView(client) {
  const history = asArray(client && client.data_consent_history);
  const latest = (client && client.data_consent) || history[history.length - 1] || null;
  return {
    status: latest ? 'recorded' : 'none',
    latest: latest ? { granted_at: latest.granted_at || null, purpose: latest.purpose || null, actor: latest.actor || null } : null,
    history_count: history.length
  };
}

function clientSummary(entities, clientId, asOf) {
  const client = records(entities, 'Client').find((candidate) => candidate.client_id === clientId) || null;
  const bookings = clientBookings(entities, clientId);
  const bookingIds = new Set(bookings.map((booking) => booking.booking_id));
  const lastTravelEnd = clientLastTravelEnd(entities, clientId);
  const documents = clientDocuments(entities, clientId).map((document) => ({
    document_id: document.document_id,
    document_type: documentTypeOf(document) || null,
    sensitive: isSensitiveDocument(document),
    status: upper(document.status) || null,
    retention: retentionStatusOf(document, lastTravelEnd, asOf),
    eligible_on: sensitiveTypeOf(document) && lastTravelEnd && !isErased(document) ? dateOnlyPlusDays(lastTravelEnd, RETENTION_GRACE_DAYS) : null,
    last_travel_end: lastTravelEnd
  }));
  const expoLeads = records(entities, 'ExpoLead').filter((lead) => lead.converted_client_id === clientId);
  return {
    client_id: clientId,
    display_name: (client && (client.display_name || client.legal_name)) || clientId,
    consent: clientConsentView(client),
    data_inventory: {
      inquiries: records(entities, 'Inquiry').filter((inquiry) => inquiry.client_id === clientId).length,
      quotations: records(entities, 'Quotation').filter((quotation) => quotation.client_id === clientId).length,
      bookings: bookings.length,
      client_payments: records(entities, 'ClientPayment').filter((payment) => bookingIds.has(payment.booking_id)).length,
      client_invoices: records(entities, 'ClientInvoice').filter((invoice) => bookingIds.has(invoice.client_booking_id || invoice.booking_id)).length,
      documents: {
        total: documents.length,
        sensitive: documents.filter((document) => document.sensitive).length,
        erased: documents.filter((document) => document.retention === 'ERASED').length
      },
      expo_leads: {
        total: expoLeads.length,
        consent: { granted: expoLeads.filter((lead) => lead.consent_captured_at).length, legacy: expoLeads.filter((lead) => !lead.consent_captured_at).length }
      }
    },
    documents,
    counts: { eligible_documents: documents.filter((document) => document.retention === 'ELIGIBLE_FOR_ERASURE').length },
    retention_hints: RETENTION_HINTS
  };
}

// Per-client (clientId set) or whole-database privacy overview.
function buildPrivacyOverview(source, options) {
  const opts = options || {};
  const entities = collectEntities(source);
  const asOf = dateOnly(opts.asOf) || new Date().toISOString().slice(0, 10);
  if (opts.clientId !== undefined && opts.clientId !== null && String(opts.clientId).trim() !== '') {
    const clientId = String(opts.clientId).trim();
    const client = records(entities, 'Client').find((candidate) => candidate.client_id === clientId);
    if (!client) {
      const { WmitError } = require('../core/errors');
      throw new WmitError('NOT_FOUND', 'Client ' + clientId + ' was not found.', { type: 'Client', id: clientId });
    }
    return Object.assign({ version: PRIVACY_VERSION, asOf, scope: 'CLIENT' }, clientSummary(entities, clientId, asOf));
  }
  const clients = records(entities, 'Client').map((client) => {
    const summary = clientSummary(entities, client.client_id, asOf);
    return {
      client_id: summary.client_id,
      display_name: summary.display_name,
      consent: summary.consent.status,
      documents: summary.data_inventory.documents,
      eligible_documents: summary.counts.eligible_documents
    };
  });
  return {
    version: PRIVACY_VERSION,
    asOf,
    scope: 'ALL_CLIENTS',
    totals: {
      clients: clients.length,
      clients_with_eligible_documents: clients.filter((client) => client.eligible_documents > 0).length,
      eligible_documents: clients.reduce((sum, client) => sum + client.eligible_documents, 0)
    },
    clients,
    retention_hints: RETENTION_HINTS
  };
}

// Retention scan for the scheduler job: every non-erased sensitive document
// past the departure + 30-day limit, grouped flat with its client. Ids and
// types only — never content.
function buildRetentionScan(source, options) {
  const opts = options || {};
  const entities = collectEntities(source);
  const asOf = dateOnly(opts.asOf) || new Date().toISOString().slice(0, 10);
  const documents = [];
  const clientIds = new Set(records(entities, 'Document').map((document) => documentClientId(document)).filter(Boolean));
  clientIds.forEach((clientId) => {
    const lastTravelEnd = clientLastTravelEnd(entities, clientId);
    if (!lastTravelEnd) return;
    clientDocuments(entities, clientId).forEach((document) => {
      if (isErased(document)) return;
      const type = sensitiveTypeOf(document);
      if (!type) return;
      if (retentionStatusOf(document, lastTravelEnd, asOf) !== 'ELIGIBLE_FOR_ERASURE') return;
      documents.push({ client_id: clientId, document_id: document.document_id, document_type: type, last_travel_end: lastTravelEnd });
    });
  });
  documents.sort((a, b) => String(a.document_id).localeCompare(String(b.document_id)));
  return { asOf, eligible_count: documents.length, documents };
}

module.exports = {
  PRIVACY_VERSION,
  SENSITIVE_DOCUMENT_TYPES,
  RETENTION_GRACE_DAYS,
  RETENTION_HINTS,
  buildPrivacyOverview,
  buildRetentionScan,
  clientLastTravelEnd,
  documentClientId,
  documentTypeOf,
  isSensitiveDocument,
  retentionStatusOf
};
