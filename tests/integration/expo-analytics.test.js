'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhase1Runtime } = require('../../src/phase1/runtime');
const { createPhase1Application } = require('../../src/application/phase1');
const { ExpoService, CONSENT_TEXT } = require('../../src/expo/expo-service');
const { buildExpoAnalytics } = require('../../src/expo/expo-analytics');
const { createMvpServer } = require('../../app/server');

let clockDate = new Date('2026-07-10T10:00:00Z');
const CLOCK = () => clockDate;
const advanceClock = (iso) => { clockDate = new Date(iso); };
const staff = () => ({ actor: 'staff' });

function makeRuntime() {
  return createPhase1Runtime({ clock: CLOCK, config: { trustedActors: {} } });
}

function makeExpo(runtime) {
  return new ExpoService({ runtime, clock: CLOCK, config: { baseUrl: 'http://expo.test' } });
}

// Two expos with different outcomes plus a referral booking that is NOT
// traceable to any expo lead — the source-honesty counterexample.
function seedMultiEventData(runtime, expo) {
  const ctx = staff();
  expo.createExpo({ name: 'July Travel Fair', expo_tag: 'EXPO-JULY', start_date: '2026-07-03', end_date: '2026-07-05' }, 'staff');
  expo.createExpo({ name: 'August Expo', expo_tag: 'EXPO-AUG', start_date: '2026-08-07', end_date: '2026-08-09' }, 'staff');

  // July: two kiosk leads with consent, one books.
  advanceClock('2026-07-03T10:00:00Z');
  const julyBooker = expo.captureLead({ name: 'July Booker', mobile: '09170000001', destination: 'Seoul', travel_month: '2026-10', email: 'booker@example.test', expo_tag: 'EXPO-JULY' }).data;
  const julyQuiet = expo.captureLead({ name: 'July Quiet', mobile: '09170000002', destination: 'Bangkok', travel_month: '2026-11', email: 'quiet@example.test', expo_tag: 'EXPO-JULY' }).data;
  // August: a badge import (no explicit consent -> legacy) plus a kiosk lead that quotes but declines.
  advanceClock('2026-08-07T10:00:00Z');
  const imported = expo.importLeads({ text: 'August Badge,09170000003,Bangkok,2026-11', expo_tag: 'EXPO-AUG' }, 'staff').data;
  const augustQuoted = expo.captureLead({ name: 'August Quoted', mobile: '09170000004', destination: 'Seoul', travel_month: '2026-12', email: 'quoted@example.test', expo_tag: 'EXPO-AUG' }).data;

  // Complete the day-1 and day-3 follow-ups for the July booker.
  const julyTasks = runtime.list('Task', (task) => task.expo_lead_id === julyBooker.expo_lead_id && task.source === 'EXPO_FOLLOW_UP');
  const day1 = julyTasks.find((task) => task.automation_key.endsWith(':DAY1'));
  const day3 = julyTasks.find((task) => task.automation_key.endsWith(':DAY3'));
  advanceClock('2026-07-04T10:00:00Z');
  assert.equal(expo.completeFollowUp({ task_id: day1.task_id }, 'staff').ok, true);
  advanceClock('2026-07-06T10:00:00Z');
  assert.equal(expo.completeFollowUp({ task_id: day3.task_id }, 'staff').ok, true);

  // Quote -> send -> accept -> book the July booker.
  advanceClock('2026-07-05T10:00:00Z');
  const quote = expo.createQuote({ expo_lead_id: julyBooker.expo_lead_id, options: [{ name: 'Seoul Discovery', destination: 'Seoul', duration_days: 5, price_per_person: '32900.00' }] }, 'staff').data;
  const issued = expo.issueQuoteToken(quote, 'staff').data;
  runtime.updateRecord('ExpoQuote', quote.expo_quote_id, { status: 'SENT', sent_at: runtime.now() }, ctx);
  assert.equal(expo.acceptQuote(issued.token, { accepted_by: 'July Booker' }).ok, true);
  advanceClock('2026-07-08T10:00:00Z');
  const booking = runtime.createRecord('Booking', {
    booking_id: 'BOOKING-2026-000101', client_id: 'CLIENT-000001', currency: 'PHP', client_total: '32900.00'
  }, ctx).data;
  assert.equal(expo.markBooked({ expo_quote_id: quote.expo_quote_id, booking_id: booking.booking_id }, 'staff').ok, true);

  // August lead gets a quote that is sent but declined.
  advanceClock('2026-08-08T10:00:00Z');
  const augustQuote = expo.createQuote({ expo_lead_id: augustQuoted.expo_lead_id, options: [{ name: 'Bangkok City Break', destination: 'Bangkok', duration_days: 4, price_per_person: '18500.00' }] }, 'staff').data;
  const augustIssued = expo.issueQuoteToken(augustQuote, 'staff').data;
  runtime.updateRecord('ExpoQuote', augustQuote.expo_quote_id, { status: 'SENT', sent_at: runtime.now() }, ctx);
  assert.equal(expo.declineQuote(augustIssued.token, {}).ok, true);

  // Non-expo bookings: a referral with a recorded source, a walk-in with a
  // recorded source on the client, and one with nothing recorded.
  const referralClient = runtime.createClient({ display_name: 'Referral Client', source: 'REFERRAL' }, ctx).data;
  runtime.createRecord('Booking', { booking_id: 'BOOKING-2026-000102', client_id: referralClient.client_id, currency: 'PHP', client_total: '12000.00' }, ctx);
  const walkInClient = runtime.createClient({ display_name: 'Walk-In Client', source: 'WALK_IN' }, ctx).data;
  runtime.createRecord('Booking', { booking_id: 'BOOKING-2026-000103', client_id: walkInClient.client_id, currency: 'PHP', client_total: '8000.50' }, ctx);
  const plainClient = runtime.createClient({ display_name: 'Plain Client' }, ctx).data;
  runtime.createRecord('Booking', { booking_id: 'BOOKING-2026-000104', client_id: plainClient.client_id, currency: 'PHP', client_total: '5000.00' }, ctx);

  return {
    julyBooker, julyQuiet, augustQuoted,
    importedLeadId: imported.created[0].expo_lead_id,
    bookedQuoteId: quote.expo_quote_id,
    bookingIds: { expo: booking.booking_id, referral: 'BOOKING-2026-000102', walkIn: 'BOOKING-2026-000103', other: 'BOOKING-2026-000104' }
  };
}

test('buildExpoAnalytics computes per-event funnels, consent, and totals across all expos', () => {
  const runtime = makeRuntime();
  const expo = makeExpo(runtime);
  const seed = seedMultiEventData(runtime, expo);
  const analytics = buildExpoAnalytics(runtime, { now: runtime.now() });

  assert.equal(analytics.scope, 'ALL_EVENTS');
  assert.deepEqual(analytics.events.map((event) => event.expo_tag), ['EXPO-JULY', 'EXPO-AUG'], 'events chronological by start date');
  const july = analytics.events[0];
  const august = analytics.events[1];

  assert.deepEqual(july.funnel, { leads: 2, contacted: 1, quotes_sent: 1, accepted: 1, booked: 1, lost: 0 }, 'the quiet lead never left NEW');
  assert.equal(july.revenue.php_total, '32900.00');
  assert.equal(july.consent.granted, 2);
  assert.equal(july.consent.legacy, 0);

  assert.deepEqual(august.funnel, { leads: 2, contacted: 0, quotes_sent: 1, accepted: 0, booked: 0, lost: 0 }, 'the quote was sent without the email pipeline, so no lead status progressed');
  assert.equal(august.consent.granted, 1, 'kiosk lead consented');
  assert.equal(august.consent.legacy, 1, 'badge import has no consent record');

  assert.deepEqual(analytics.totals.funnel, { leads: 4, contacted: 1, quotes_sent: 2, accepted: 1, booked: 1, lost: 0 });
  assert.equal(analytics.totals.revenue.php_total, '32900.00');
  assert.equal(analytics.totals.consent.granted, 3);
  assert.equal(analytics.totals.consent.legacy, 1);
  assert.equal(seed.importedLeadId.length > 0, true);
});

test('source comparison counts only expo-traceable bookings as expo-sourced', () => {
  const runtime = makeRuntime();
  const expo = makeExpo(runtime);
  const seed = seedMultiEventData(runtime, expo);
  const analytics = buildExpoAnalytics(runtime, {});
  const bySource = Object.fromEntries(analytics.source_comparison.map((row) => [row.source, row]));

  assert.equal(bySource.expo.bookings, 1, 'only the booked expo quote counts as expo-sourced');
  assert.equal(bySource.expo.revenue.php_total, '32900.00');
  assert.equal(bySource.referral.bookings, 1, 'the referral booking is not silently claimed as expo');
  assert.equal(bySource.referral.revenue.php_total, '12000.00');
  assert.equal(bySource['walk-in'].bookings, 1);
  assert.equal(bySource['walk-in'].revenue.php_total, '8000.50');
  assert.equal(bySource.other.bookings, 1, 'unrecorded source falls under other');
  assert.equal(bySource.other.revenue.php_total, '5000.00');
  assert.match(analytics.notes.source_honesty, /traceable to an expo lead/);
  assert.equal(seed.bookingIds.expo, 'BOOKING-2026-000101');
});

test('follow-up effectiveness ties completed day-1/3/7 tasks to lead outcomes', () => {
  const runtime = makeRuntime();
  const expo = makeExpo(runtime);
  seedMultiEventData(runtime, expo);
  const analytics = buildExpoAnalytics(runtime, {});
  const byDay = Object.fromEntries(analytics.follow_up_effectiveness.map((row) => [row.day, row]));

  assert.deepEqual(Object.keys(byDay).map(Number).sort(), [1, 3, 7]);
  // 4 leads x day steps = 4 tasks per step; the booker completed day 1 and 3.
  assert.equal(byDay[1].tasks, 4);
  assert.equal(byDay[1].completed, 1);
  assert.equal(byDay[1].open, 3);
  assert.equal(byDay[1].cancelled, 0);
  assert.equal(byDay[1].leads_completed, 1);
  assert.equal(byDay[1].leads_booked, 1);
  assert.equal(byDay[1].booked_percent, 100);
  assert.equal(byDay[3].completed, 1);
  assert.equal(byDay[3].leads_booked, 1);
  assert.equal(byDay[7].completed, 0);
  assert.equal(byDay[7].cancelled, 1, 'booking cancelled the remaining day-7 follow-up');
  assert.equal(byDay[7].leads_completed, 0);
  assert.equal(byDay[7].booked_percent, 0, 'no division by zero when nothing completed');
});

test('monthly trend buckets leads and conversions per month across expos', () => {
  const runtime = makeRuntime();
  const expo = makeExpo(runtime);
  seedMultiEventData(runtime, expo);
  const analytics = buildExpoAnalytics(runtime, {});
  assert.deepEqual(analytics.monthly_trend, [
    { month: '2026-07', leads: 2, conversions: 1 },
    { month: '2026-08', leads: 2, conversions: 0 }
  ], 'July captured 2 leads and converted 1; August captured 2 and converted 0');
});

test('captureLead records consent at capture and rejects withheld consent; legacy leads stay legacy', () => {
  const runtime = makeRuntime();
  const expo = makeExpo(runtime);
  const captured = expo.captureLead({ name: 'Consenting Lead', mobile: '09170000010', destination: 'Tokyo', travel_month: '2026-10' }).data;
  const lead = runtime.get('ExpoLead', captured.expo_lead_id);
  assert.ok(lead.consent_captured_at, 'consent timestamp recorded');
  assert.equal(lead.consent_text, CONSENT_TEXT);
  assert.match(lead.consent_text, /quotation/i);
  assert.match(lead.consent_text, /follow up/i);

  const withheld = expo.captureLead({ name: 'No Consent', mobile: '09170000011', destination: 'Tokyo', travel_month: '2026-10', consent: false });
  assert.equal(withheld.ok, false);
  assert.equal(withheld.error.code, 'CONSENT_REQUIRED');

  const imported = expo.importLeads({ text: 'Legacy Badge,09170000012,Tokyo,2026-10' }, 'staff').data;
  const legacyLead = runtime.get('ExpoLead', imported.created[0].expo_lead_id);
  assert.ok(!legacyLead.consent_captured_at, 'badge imports carry no consent timestamp');
  assert.ok(!legacyLead.consent_text);

  const legacyView = expo.getLead(legacyLead.expo_lead_id);
  assert.equal(legacyView.data.consent.status, 'legacy', 'missing consent reports legacy, not denied');
  const grantedView = expo.getLead(captured.expo_lead_id);
  assert.equal(grantedView.data.consent.status, 'granted');
});

test('getExpoAnalytics serves the full report over HTTP, scoped or all events, audited', async () => {
  const runtime = makeRuntime();
  const expo = makeExpo(runtime);
  seedMultiEventData(runtime, expo);
  const phase1App = createPhase1Application({ runtime, seedSynthetic: false });
  const { server } = createMvpServer({ phase1App, expo });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const get = async (path) => {
    const response = await fetch(base + path);
    return { status: response.status, body: await response.json() };
  };
  try {
    const all = await get('/api/expo/analytics');
    assert.equal(all.status, 200);
    assert.equal(all.body.ok, true);
    assert.equal(all.body.meta.action, 'EXPO_ANALYTICS');
    assert.equal(all.body.meta.read_only, true);
    assert.equal(all.body.data.scope, 'ALL_EVENTS');
    assert.equal(all.body.data.events.length, 2);
    assert.deepEqual(all.body.data.events[0].funnel, { leads: 2, contacted: 1, quotes_sent: 1, accepted: 1, booked: 1, lost: 0 });
    assert.equal(all.body.data.follow_up_effectiveness.length, 3);
    assert.equal(all.body.data.source_comparison.find((row) => row.source === 'expo').bookings, 1);
    assert.equal(all.body.data.source_comparison.find((row) => row.source === 'referral').bookings, 1);
    assert.equal(all.body.data.monthly_trend.length, 2);
    assert.equal(all.body.data.totals.consent.legacy, 1);

    const scoped = await get('/api/expo/analytics?expo_tag=EXPO-JULY');
    assert.equal(scoped.status, 200);
    assert.equal(scoped.body.data.scope, 'EXPO-JULY');
    assert.equal(scoped.body.data.events.length, 1);
    assert.equal(scoped.body.data.totals.funnel.leads, 2);
    assert.equal(scoped.body.data.totals.consent.legacy, 0, 'the August badge import is out of scope');
    assert.deepEqual(scoped.body.data.monthly_trend, [{ month: '2026-07', leads: 2, conversions: 1 }]);

    const missing = await get('/api/expo/analytics?expo_tag=NOPE-2099');
    assert.equal(missing.status, 200);
    assert.equal(missing.body.ok, false);
    assert.equal(missing.body.error.code, 'EXPO_NOT_FOUND');

    assert.ok(runtime.auditLog.list().some((entry) => entry.action === 'GET_EXPO_ANALYTICS' && entry.result === 'SUCCESS' && entry.details.expo_tag === null), 'all-events read audited');
    assert.ok(runtime.auditLog.list().some((entry) => entry.action === 'GET_EXPO_ANALYTICS' && entry.result === 'FAILURE' && entry.details.error_code === 'EXPO_NOT_FOUND'), 'failed read audited');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('the events console ships the analytics workspace', () => {
  const fs = require('node:fs');
  const html = fs.readFileSync('app/public/expo-console.html', 'utf8');
  assert.match(html, /data-tab="analytics"/);
  assert.match(html, /id="analytics-funnel-wrap"/);
  assert.match(html, /id="analytics-source-wrap"/);
  assert.match(html, /id="analytics-month-wrap"/);
  const script = fs.readFileSync('app/public/expo-console.js', 'utf8');
  assert.match(script, /async function loadAnalytics/);
  assert.match(script, /\/api\/expo\/analytics/);
});
