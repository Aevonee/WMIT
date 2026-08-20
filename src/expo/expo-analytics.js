'use strict';

// Expo source analytics over time: funnel per event, day-1/3/7 follow-up
// effectiveness, source comparison, and monthly trend across ALL expo
// events (including ended ones). Pure and read-only, same style as
// departure-readiness.js: the ExpoService method that calls this
// (getExpoAnalytics) owns validation, audit, and the generated_at stamp.
//
// Funnel definitions are reused from the expo dashboard (ExpoService
// .dashboard) exactly — quotes_sent counts quotes with sent_at, accepted
// counts ACCEPTED-or-BOOKED quotes, booked counts BOOKED quotes — so the
// two views can never disagree.

const FOLLOW_UP_DAYS = [1, 3, 7];
const EXPO_ANALYTICS_VERSION = 'V1';

const CONTACTED_STATUSES = ['CONTACTED', 'QUOTED', 'ACCEPTED', 'BOOKED'];
const LOST_STATUSES = ['LOST', 'UNREACHABLE'];
const ACCEPTED_QUOTE_STATUSES = ['ACCEPTED', 'BOOKED'];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function collectEntities(source) {
  if (source && typeof source.list === 'function') {
    const names = ['ExpoEvent', 'ExpoLead', 'ExpoQuote', 'Task', 'Booking', 'Client'];
    return Object.fromEntries(names.map((name) => [name, asArray(source.list(name))]));
  }
  const value = source && source.ok && source.data ? source.data : source;
  return (value && value.entities) || value || {};
}

function records(entities, type) {
  return asArray(entities[type]);
}

function percent(part, whole) {
  return whole ? Math.round((part / whole) * 1000) / 10 : 0;
}

function dateOnly(value) {
  const raw = String(value === undefined || value === null ? '' : value).trim();
  if (!raw) return null;
  const date = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function monthOf(value) {
  const day = dateOnly(value);
  return day ? day.slice(0, 7) : null;
}

function toMinor(value) {
  // Local mirror of core/money semantics without importing money types:
  // analytics only ever sums amounts the runtime already validated.
  const match = /^-?(\d+)(?:\.(\d+))?$/.exec(String(value === undefined || value === null ? '0' : value).trim());
  if (!match) return 0n;
  const cents = match[2] ? match[2].padEnd(2, '0').slice(0, 2) : '00';
  const minor = BigInt(match[1] + cents);
  return String(value).trim().startsWith('-') ? -minor : minor;
}

function fromMinor(minor) {
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const whole = absolute / 100n;
  const cents = absolute % 100n;
  return (negative ? '-' : '') + whole.toString() + '.' + cents.toString().padStart(2, '0');
}

// Follow-up tasks carry the automation key 'EXPO:<expo_lead_id>:DAY<n>'.
function followUpDay(task) {
  const key = String(task.automation_key || '');
  if (task.source !== 'EXPO_FOLLOW_UP') return null;
  const match = /:DAY(\d+)$/.exec(key);
  return match ? Number(match[1]) : null;
}

function funnelFor(leads, quotes, bookingsById) {
  const sentQuotes = quotes.filter((quote) => quote.sent_at);
  const acceptedQuotes = quotes.filter((quote) => ACCEPTED_QUOTE_STATUSES.includes(quote.status));
  const bookedQuotes = quotes.filter((quote) => quote.status === 'BOOKED');
  const revenueByCurrency = {};
  let phpMinor = 0n;
  bookedQuotes.forEach((quote) => {
    const booking = quote.booking_id ? bookingsById.get(quote.booking_id) : null;
    if (!booking) return;
    const currency = booking.currency || 'PHP';
    revenueByCurrency[currency] = (revenueByCurrency[currency] || 0n) + toMinor(booking.client_total || 0);
    if (currency === 'PHP') phpMinor += toMinor(booking.client_total || 0);
  });
  return {
    funnel: {
      leads: leads.length,
      contacted: leads.filter((lead) => CONTACTED_STATUSES.includes(lead.status)).length,
      quotes_sent: sentQuotes.length,
      accepted: acceptedQuotes.length,
      booked: bookedQuotes.length,
      lost: leads.filter((lead) => LOST_STATUSES.includes(lead.status)).length
    },
    conversion: {
      lead_to_quote_percent: percent(sentQuotes.length, leads.length),
      quote_to_accept_percent: percent(acceptedQuotes.length, sentQuotes.length),
      accept_to_book_percent: percent(bookedQuotes.length, acceptedQuotes.length),
      lead_to_book_percent: percent(bookedQuotes.length, leads.length)
    },
    revenue: {
      php_total: fromMinor(phpMinor),
      by_currency: Object.keys(revenueByCurrency).sort().reduce((carry, currency) => Object.assign(carry, { [currency]: fromMinor(revenueByCurrency[currency]) }), {})
    }
  };
}

function consentFor(leads) {
  const granted = leads.filter((lead) => lead.consent_captured_at).length;
  return { granted, legacy: leads.length - granted };
}

// Which bookings are traceable to an expo lead: a booked ExpoQuote link, a
// lead's booking link, or a booking built from a converted lead's Inquiry.
// A recorded source string alone never makes a booking expo-sourced.
function expoLineage(entities) {
  const bookingIds = new Set();
  const inquiryIds = new Set();
  records(entities, 'ExpoQuote').forEach((quote) => { if (quote.booking_id) bookingIds.add(quote.booking_id); });
  records(entities, 'ExpoLead').forEach((lead) => {
    if (lead.booking_id) bookingIds.add(lead.booking_id);
    if (lead.converted_inquiry_id) inquiryIds.add(lead.converted_inquiry_id);
  });
  return { bookingIds, inquiryIds };
}

function recordedSourceCategory(raw) {
  const value = String(raw || '').toUpperCase().replace(/[\s-]+/g, '_');
  if (value.includes('REFERRAL')) return 'referral';
  if (value.includes('WALK_IN') || value.includes('WALKIN')) return 'walk-in';
  return null;
}

function sourceComparison(entities) {
  const lineage = expoLineage(entities);
  const clientsById = new Map(records(entities, 'Client').map((client) => [client.client_id, client]));
  const rows = { expo: { bookings: 0, php_minor: 0n, by_currency: {} }, referral: { bookings: 0, php_minor: 0n, by_currency: {} }, 'walk-in': { bookings: 0, php_minor: 0n, by_currency: {} }, other: { bookings: 0, php_minor: 0n, by_currency: {} } };
  records(entities, 'Booking').forEach((booking) => {
    let source = null;
    if (lineage.bookingIds.has(booking.booking_id) || (booking.inquiry_id && lineage.inquiryIds.has(booking.inquiry_id))) source = 'expo';
    if (!source) {
      const client = booking.client_id ? clientsById.get(booking.client_id) : null;
      source = recordedSourceCategory(booking.source) || recordedSourceCategory(client && client.source) || 'other';
    }
    const row = rows[source];
    row.bookings += 1;
    const currency = booking.currency || 'PHP';
    row.by_currency[currency] = (row.by_currency[currency] || 0n) + toMinor(booking.client_total || 0);
    if (currency === 'PHP') row.php_minor += toMinor(booking.client_total || 0);
  });
  return ['expo', 'referral', 'walk-in', 'other'].map((source) => ({
    source,
    bookings: rows[source].bookings,
    revenue: {
      php_total: fromMinor(rows[source].php_minor),
      by_currency: Object.keys(rows[source].by_currency).sort().reduce((carry, currency) => Object.assign(carry, { [currency]: fromMinor(rows[source].by_currency[currency]) }), {})
    }
  }));
}

function followUpEffectiveness(entities) {
  const leadsById = new Map(records(entities, 'ExpoLead').map((lead) => [lead.expo_lead_id, lead]));
  const byDay = {};
  FOLLOW_UP_DAYS.forEach((day) => {
    byDay[day] = { tasks: 0, completed: 0, open: 0, cancelled: 0, leads_completed: 0, leads_booked: 0, leads_accepted: 0 };
  });
  const leadsWithCompletedDay = {};
  records(entities, 'Task').forEach((task) => {
    const day = followUpDay(task);
    if (day === null || !byDay[day]) return;
    const bucket = byDay[day];
    bucket.tasks += 1;
    const state = String(task.state || 'OPEN').toUpperCase();
    if (state === 'COMPLETED') bucket.completed += 1;
    else if (state === 'CANCELLED') bucket.cancelled += 1;
    else bucket.open += 1;
    if (state === 'COMPLETED' && task.expo_lead_id) {
      leadsWithCompletedDay[day + ':' + task.expo_lead_id] = true;
    }
  });
  Object.keys(leadsWithCompletedDay).forEach((key) => {
    const parts = key.split(':');
    const day = Number(parts[0]);
    const lead = leadsById.get(parts.slice(1).join(':'));
    if (!lead) return;
    byDay[day].leads_completed += 1;
    if (ACCEPTED_QUOTE_STATUSES.includes(lead.status)) byDay[day].leads_accepted += 1;
    if (lead.status === 'BOOKED') byDay[day].leads_booked += 1;
  });
  return FOLLOW_UP_DAYS.map((day) => {
    const bucket = byDay[day];
    return {
      day,
      tasks: bucket.tasks,
      completed: bucket.completed,
      open: bucket.open,
      cancelled: bucket.cancelled,
      leads_completed: bucket.leads_completed,
      leads_accepted: bucket.leads_accepted,
      leads_booked: bucket.leads_booked,
      booked_percent: percent(bucket.leads_booked, bucket.leads_completed)
    };
  });
}

function monthlyTrend(entities) {
  const months = {};
  const touch = (month) => {
    if (!month) return null;
    months[month] = months[month] || { month, leads: 0, conversions: 0 };
    return months[month];
  };
  records(entities, 'ExpoLead').forEach((lead) => { const row = touch(monthOf(lead.created_at)); if (row) row.leads += 1; });
  records(entities, 'ExpoQuote').forEach((quote) => {
    if (quote.status !== 'BOOKED') return;
    const row = touch(monthOf(quote.booked_at || quote.accepted_at || quote.sent_at || quote.created_at));
    if (row) row.conversions += 1;
  });
  return Object.keys(months).sort().map((month) => months[month]);
}

function buildExpoAnalytics(source, options) {
  const opts = options || {};
  const entities = collectEntities(source);
  const scopeTag = opts.expoTag ? String(opts.expoTag).trim().toUpperCase() : null;

  // Event universe: registry records plus any tag actually present on leads
  // or quotes (legacy data predating the registry, e.g. EXPO-2026).
  const eventsByTag = new Map();
  records(entities, 'ExpoEvent').forEach((event) => eventsByTag.set(event.expo_tag, event));
  asArray(entities.ExpoLead).concat(asArray(entities.ExpoQuote)).forEach((record) => {
    const tag = record.expo_tag;
    if (tag && !eventsByTag.has(tag)) eventsByTag.set(tag, { expo_tag: tag, name: null, status: null, start_date: null, end_date: null });
  });

  let tags = Array.from(eventsByTag.keys());
  if (scopeTag) tags = tags.filter((tag) => tag === scopeTag);
  tags.sort((a, b) => String(eventsByTag.get(a).start_date || '9999').localeCompare(String(eventsByTag.get(b).start_date || '9999')) || a.localeCompare(b));

  const bookingsById = new Map(records(entities, 'Booking').map((booking) => [booking.booking_id, booking]));

  const scoped = {};
  const eventRows = tags.map((tag) => {
    const event = eventsByTag.get(tag);
    const leads = records(entities, 'ExpoLead').filter((lead) => lead.expo_tag === tag);
    const quotes = records(entities, 'ExpoQuote').filter((quote) => quote.expo_tag === tag);
    const scopedFunnel = funnelFor(leads, quotes, bookingsById);
    scoped[tag] = Object.assign({ leads, quotes }, scopedFunnel);
    return {
      expo_tag: tag,
      name: event.name || tag,
      status: event.status || null,
      start_date: event.start_date || null,
      end_date: event.end_date || null,
      funnel: scopedFunnel.funnel,
      conversion: scopedFunnel.conversion,
      revenue: scopedFunnel.revenue,
      consent: consentFor(leads)
    };
  });

  // Totals across the selected events (funnel fields sum; revenue and
  // conversion recompute over the union, matching dashboard math).
  const allLeads = tags.flatMap((tag) => scoped[tag].leads);
  const allQuotes = tags.flatMap((tag) => scoped[tag].quotes);
  const totalsFunnel = funnelFor(allLeads, allQuotes, bookingsById);

  const scopedEntities = scopeTag ? {
    ExpoEvent: records(entities, 'ExpoEvent'),
    ExpoLead: allLeads,
    ExpoQuote: allQuotes,
    Task: records(entities, 'Task').filter((task) => !task.expo_tag || tags.includes(task.expo_tag)),
    Booking: records(entities, 'Booking'),
    Client: records(entities, 'Client')
  } : entities;

  return {
    version: EXPO_ANALYTICS_VERSION,
    scope: scopeTag || 'ALL_EVENTS',
    generated_at: opts.now || null,
    events: eventRows,
    totals: {
      events: eventRows.length,
      funnel: totalsFunnel.funnel,
      conversion: totalsFunnel.conversion,
      revenue: totalsFunnel.revenue,
      consent: consentFor(allLeads)
    },
    follow_up_effectiveness: followUpEffectiveness(scopedEntities),
    source_comparison: sourceComparison(scopedEntities),
    monthly_trend: monthlyTrend(scopedEntities),
    notes: {
      source_honesty: 'Bookings count as expo-sourced only when traceable to an expo lead (booked quote link, lead booking link, or a converted lead inquiry). Others fall back to their recorded source field; unrecorded sources count under other.'
    }
  };
}

module.exports = {
  EXPO_ANALYTICS_VERSION,
  FOLLOW_UP_DAYS,
  buildExpoAnalytics
};
