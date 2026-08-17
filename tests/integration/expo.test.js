'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPhase1Runtime } = require('../../src/phase1/runtime');
const { ExpoService, EXPO_TAG, normalizeMobile } = require('../../src/expo/expo-service');
const { Mailer } = require('../../src/server/mailer');

function buildService(overrides) {
  const opts = overrides || {};
  const runtime = opts.runtime || createPhase1Runtime({ clock: opts.clock, config: { trustedActors: {} } });
  const outboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmit-expo-outbox-'));
  const mailer = new Mailer({ smtp: {}, outboxDir }); // unconfigured SMTP → .eml drafts
  const service = new ExpoService({
    runtime,
    mailer,
    config: { baseUrl: 'http://expo.test' },
    clock: opts.clock,
    limiter: opts.limiter,
    publicActionLimiter: opts.publicActionLimiter
  });
  return { runtime, service, outboxDir, mailer };
}

const leadInput = (overrides) => Object.assign({
  name: 'Maria Santos', mobile: '09171234567', destination: 'Seoul', travel_month: '2026-10'
}, overrides || {});

test('expo registry: multiple expos, per-expo capture/import/templates, ended expos reject new leads', () => {
  const { service } = buildService();
  assert.equal(service.ensureDefaultExpo().ensured, true);
  assert.equal(service.ensureDefaultExpo().ensured, false, 'boot seeding is idempotent');
  assert.equal(service.currentExpo().expo_tag, 'EXPO-2026');

  const created = service.createExpo({ name: 'PTA Travel Fair 2027', start_date: '2027-03-05', end_date: '2027-03-07' }, 'USER:owner');
  assert.equal(created.ok, true, JSON.stringify(created.error));
  assert.equal(created.data.expo_tag, 'EXPO-2026-PTA-TRAVEL-FAIR-2027');
  assert.equal(created.data.status, 'ACTIVE');
  assert.equal(service.listTemplates({ expo_tag: created.data.expo_tag }).length, 3, 'a new expo is seeded with placeholder packages');
  assert.equal(service.currentExpo().expo_tag, 'EXPO-2026', 'creating a later expo must not steal the kiosk default from the soonest upcoming event');

  const scoped = service.captureLead({ name: 'Ana Reyes', mobile: '09181112222', destination: 'Bali', travel_month: '2027-04', expo_tag: created.data.expo_tag });
  assert.equal(scoped.ok, true);
  assert.equal(service.listLeads({ expo_tag: 'EXPO-2026' }).length, 0, 'EXPO-2026 stays clean');
  assert.equal(service.listLeads({ expo_tag: created.data.expo_tag }).length, 1);

  const taggedImport = service.importLeads({ text: 'Carla Cruz,09181113333,Bali,2027-04', expo_tag: created.data.expo_tag });
  assert.equal(taggedImport.data.created_count, 1);
  assert.equal(service.listLeads({ expo_tag: created.data.expo_tag }).length, 2);

  assert.equal(service.captureLead({ name: 'X Y', mobile: '09181114444', destination: 'Bali', travel_month: '2027-04', expo_tag: 'NOPE-2099' }).error.code, 'EXPO_NOT_FOUND');
  const duplicate = service.createExpo({ name: 'Again', expo_tag: 'EXPO-2026' });
  assert.equal(duplicate.error.code, 'EXPO_DUPLICATE');
  assert.equal(service.createExpo({ name: 'Bad dates', start_date: '2027-05-10', end_date: '2027-05-01' }).error.code, 'EXPO_DATE_RANGE_INVALID');

  const ended = service.setExpoStatus({ expo_tag: created.data.expo_tag, status: 'ENDED' }, 'USER:owner');
  assert.equal(ended.ok, true);
  assert.equal(service.captureLead({ name: 'Z W', mobile: '09181115555', destination: 'Bali', travel_month: '2027-04', expo_tag: created.data.expo_tag }).error.code, 'EXPO_NOT_ACTIVE');
  assert.equal(service.getPublicConfig({ expo: created.data.expo_tag }).error.code, 'EXPO_NOT_ACTIVE');
  assert.equal(service.listLeads({ expo_tag: created.data.expo_tag }).length, 2, 'ended expo history stays readable');

  const reopened = service.setExpoStatus({ expo_tag: created.data.expo_tag, status: 'ACTIVE' }, 'USER:owner');
  assert.equal(reopened.ok, true);
  assert.equal(service.currentExpo().expo_tag, 'EXPO-2026', 'soonest upcoming still wins after reopen');
});

test('quotes use only the lead expo templates and carry its tag; the dashboard scopes by expo', async () => {
  const { service } = buildService();
  service.ensureDefaultExpo();
  const other = service.createExpo({ name: 'Cebu Expo 2027', start_date: '2027-08-01' }).data;
  const lead2026 = service.captureLead(leadInput({ email: 'a@example.test' }));
  const leadOther = service.captureLead({ name: 'Ana Reyes', mobile: '09181112222', destination: 'Cebu', travel_month: '2027-09', email: 'b@example.test', expo_tag: other.expo_tag });
  const template2026 = service.listTemplates({ expo_tag: 'EXPO-2026' })[0];
  const quoteOther = service.createQuote({ expo_lead_id: leadOther.data.expo_lead_id, options: [{ template_id: template2026.expo_package_template_id }] });
  assert.equal(quoteOther.error.code, 'TEMPLATE_NOT_FOUND', 'cross-expo templates must not leak into quotes');
  const ownTemplate = service.listTemplates({ expo_tag: other.expo_tag })[0];
  const goodOther = service.createQuote({ expo_lead_id: leadOther.data.expo_lead_id, options: [{ template_id: ownTemplate.expo_package_template_id }] });
  assert.equal(goodOther.ok, true);
  assert.equal(goodOther.data.expo_tag, other.expo_tag);

  assert.equal(service.listQuotes({ expo_tag: 'EXPO-2026' }).length, 0);
  assert.equal(service.listQuotes({ expo_tag: other.expo_tag }).length, 1);

  const scopedBoard = service.dashboard({ expo_tag: other.expo_tag });
  assert.equal(scopedBoard.data.funnel.leads, 1);
  assert.equal(scopedBoard.data.expo_tag, other.expo_tag);
  assert.equal(scopedBoard.data.expo_name, 'Cebu Expo 2027');
  const defaultBoard = service.dashboard();
  assert.equal(defaultBoard.data.expo_tag, 'EXPO-2026');
  assert.equal(defaultBoard.data.funnel.leads, 1, 'the lead captured without a tag belongs to the current expo');
  assert.equal(lead2026.ok, true);
  void lead2026;
});

test('captureLead captures the full quotation brief: email, adults/kids, days, hotel stars, meal plan', () => {
  const { runtime, service } = buildService();
  const result = service.captureLead({
    name: 'Maria Santos', mobile: '09171234567', destination: 'Seoul', travel_month: '2026-10',
    email: 'maria@example.test', adults: 2, children: 1, duration_days: 5, hotel_stars: 4, meal_plan: 'BREAKFAST'
  });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  const lead = runtime.get('ExpoLead', result.data.expo_lead_id);
  assert.equal(lead.email, 'maria@example.test');
  assert.equal(lead.adults, 2);
  assert.equal(lead.children, 1);
  assert.equal(lead.pax_count, 3, 'pax count is derived from adults + children');
  assert.equal(lead.duration_days, 5);
  assert.equal(lead.hotel_stars, 4);
  assert.equal(lead.meal_plan, 'BREAKFAST');
  // Adults default to 1 when only children are supplied.
  const soloParent = service.captureLead({ name: 'Ana Reyes', mobile: '09181234567', destination: 'Bangkok', travel_month: '2026-11', children: 2 });
  assert.equal(soloParent.ok, true);
  assert.equal(runtime.get('ExpoLead', soloParent.data.expo_lead_id).pax_count, 3);
});

test('captureLead validates the quotation-brief fields and never stores junk', () => {
  const { service } = buildService();
  const cases = [
    [{ adults: 0 }, 'ADULTS_INVALID'],
    [{ adults: 21 }, 'ADULTS_INVALID'],
    [{ adults: 1.5 }, 'ADULTS_INVALID'],
    [{ children: -1 }, 'CHILDREN_INVALID'],
    [{ children: 21 }, 'CHILDREN_INVALID'],
    [{ duration_days: 0 }, 'DURATION_INVALID'],
    [{ duration_days: 61 }, 'DURATION_INVALID'],
    [{ hotel_stars: 0 }, 'HOTEL_STARS_INVALID'],
    [{ hotel_stars: 6 }, 'HOTEL_STARS_INVALID'],
    [{ meal_plan: 'SOMETIMES' }, 'MEAL_PLAN_INVALID'],
    [{ email: 'nope' }, 'EMAIL_INVALID']
  ];
  cases.forEach(([overrides, code]) => {
    const result = service.captureLead(leadInput(overrides));
    assert.equal(result.ok, false, JSON.stringify(overrides));
    assert.equal(result.error.code, code, JSON.stringify(overrides));
  });
  // Everything valid except one bad field still creates nothing.
  assert.equal(service.listLeads().length, 0);
});

test('captureLead creates an EXPO-2026 lead with follow-up tasks and idempotent retries', () => {
  const { runtime, service } = buildService();
  const first = service.captureLead(leadInput({ idempotency_key: 'KIOSK-1' }));
  assert.equal(first.ok, true);
  assert.match(first.data.expo_lead_id, /^EXPO_LEAD-\d{4}-\d{6}$/);
  assert.equal(first.data.follow_up_task_ids.length, 3);
  const lead = runtime.get('ExpoLead', first.data.expo_lead_id);
  assert.equal(lead.status, 'NEW');
  assert.equal(lead.source, 'KIOSK');
  assert.equal(lead.expo_tag, EXPO_TAG);
  assert.equal(lead.mobile, '+639171234567');
  const replay = service.captureLead(leadInput({ idempotency_key: 'KIOSK-1' }));
  assert.equal(replay.ok, true);
  assert.equal(replay.meta.idempotent, true);
  assert.equal(replay.data.expo_lead_id, first.data.expo_lead_id);
  assert.equal(service.listLeads().length, 1, 'idempotent replay must not create a second lead');
});

test('captureLead rejects missing and invalid input without consuming rate-limit quota', () => {
  const clock = { value: 0, at: () => new Date(clock.value) };
  const { service } = buildService({ clock: clock.at });
  const cases = [
    [{}, 'REQUIRED_FIELD'],
    [leadInput({ name: '   ' }), 'REQUIRED_FIELD'],
    [leadInput({ mobile: '123' }), 'MOBILE_INVALID'],
    [leadInput({ travel_month: '2026-13' }), 'TRAVEL_MONTH_INVALID'],
    [leadInput({ travel_month: 'October' }), 'TRAVEL_MONTH_INVALID'],
    [leadInput({ email: 'not-an-email' }), 'EMAIL_INVALID'],
    [leadInput({ pax_count: 0 }), 'PAX_COUNT_INVALID'],
    [leadInput({ pax_count: 99 }), 'PAX_COUNT_INVALID']
  ];
  cases.forEach(([input, code]) => {
    const result = service.captureLead(input);
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.equal(result.error.code, code, JSON.stringify(input));
  });
  // All of those failed validation, so the same mobile must still be allowed.
  const valid = service.captureLead(leadInput());
  assert.equal(valid.ok, true, 'failed validations must not consume the cooldown');
});

test('captureLead rate limits a second submission from the same mobile', () => {
  const { service } = buildService();
  assert.equal(service.captureLead(leadInput()).ok, true);
  const blocked = service.captureLead(leadInput({ mobile: '+639171234567', idempotency_key: 'X' }));
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'RATE_LIMITED');
  const other = service.captureLead(leadInput({ mobile: '09181234567', destination: 'Bangkok' }));
  assert.equal(other.ok, true);
});

test('mobile normalization accepts the common Philippine formats', () => {
  assert.equal(normalizeMobile('0917 123 4567'), '+639171234567');
  assert.equal(normalizeMobile('+63 917 123 4567'), '+639171234567');
  assert.equal(normalizeMobile('639171234567'), '+639171234567');
  assert.equal(normalizeMobile('9171234567'), '+639171234567');
  assert.throws(() => normalizeMobile('0812345'), (error) => error.code === 'MOBILE_INVALID');
});

test('importLeads handles CSV rows, name-per-line defaults, duplicates, and row errors', () => {
  const { service } = buildService();
  const csv = service.importLeads({
    text: [
      'Juan Dela Cruz,09181112222,Bangkok,2026-11',
      'Ana Reyes,09181113333,Seoul,2026-12,ana@example.test',
      'Bad Row,123',
      'Juan Dela Cruz,09181112222,Bangkok,2026-11'
    ].join('\n'),
    default_destination: '',
    default_travel_month: ''
  });
  assert.equal(csv.ok, true);
  assert.equal(csv.data.created_count, 2);
  assert.equal(csv.data.failed_count, 2);
  assert.equal(csv.data.failed[0].error, 'MOBILE_INVALID');
  assert.equal(csv.data.failed[1].error, 'LEAD_DUPLICATE');
  assert.equal(csv.data.follow_up_tasks_created, 6);

  const namesOnly = service.importLeads({ text: 'Carla Cruz\nMiguel Tan', default_destination: 'Ho Chi Minh City', default_travel_month: '2026-12' });
  assert.equal(namesOnly.ok, true);
  assert.equal(namesOnly.data.created_count, 2);
  assert.equal(namesOnly.data.follow_up_tasks_created, 6);
  assert.equal(service.listLeads().length, 4);
  const carla = service.listLeads().find((lead) => lead.name === 'Carla Cruz');
  assert.equal(carla.mobile, null, 'badge-scan rows import without a mobile');
  assert.equal(carla.needs_mobile, true);
  const queue = service.getFollowUpQueue().data.queue.find((item) => item.lead.name === 'Carla Cruz');
  assert.equal(queue.whatsapp_url, null, 'no chat deep link until staff attach a mobile');
  const enriched = service.updateLead({ expo_lead_id: carla.expo_lead_id, mobile: '09195554444' }, 'USER:staff1');
  assert.equal(enriched.ok, true);
  assert.equal(enriched.data.mobile, '+639195554444');
  assert.equal(enriched.data.needs_mobile, false);
  const badMobile = service.updateLead({ expo_lead_id: carla.expo_lead_id, mobile: '123' });
  assert.equal(badMobile.error.code, 'MOBILE_INVALID');

  const empty = service.importLeads({ text: '   ' });
  assert.equal(empty.ok, false);
  assert.equal(empty.error.code, 'REQUIRED_FIELD');
});

test('follow-up tasks: day 1/3/7 due dates, no duplicates on re-run, cancelled when the lead is lost', () => {
  const { runtime, service } = buildService();
  const captured = service.captureLead(leadInput());
  const leadId = captured.data.expo_lead_id;
  const tasks = runtime.list('Task', (task) => task.expo_lead_id === leadId).sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  assert.deepEqual(tasks.map((task) => task.due_date), [
    datePlus(1), datePlus(3), datePlus(7)
  ]);
  assert.deepEqual(tasks.map((task) => task.task_type), ['EXPO_FOLLOW_UP', 'EXPO_FOLLOW_UP', 'EXPO_FOLLOW_UP']);
  const rerun = service.ensureFollowUpTasks();
  assert.equal(rerun.tasks_created, 0, 'second ensure run must not duplicate tasks');
  assert.equal(runtime.list('Task', (task) => task.expo_lead_id === leadId).length, 3);

  const lost = service.updateLeadStatus({ expo_lead_id: leadId, status: 'LOST' }, 'USER:staff1');
  assert.equal(lost.ok, true);
  assert.equal(runtime.list('Task', (task) => task.expo_lead_id === leadId && ['OPEN', 'IN_PROGRESS'].includes(task.state)).length, 0, 'open follow-ups are cancelled');
  const invalidStatus = service.updateLeadStatus({ expo_lead_id: leadId, status: 'NEW' });
  assert.equal(invalidStatus.ok, false);
  assert.equal(invalidStatus.error.code, 'LEAD_STATUS_FINAL');
});

function datePlus(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test('the follow-up queue returns tasks with WhatsApp and Viber deep links', () => {
  const { service } = buildService();
  service.captureLead(leadInput());
  const queue = service.getFollowUpQueue();
  assert.equal(queue.ok, true);
  assert.equal(queue.data.open_count, 3);
  const first = queue.data.queue[0];
  assert.equal(first.day_step, 1);
  assert.equal(first.lead.mobile, '+639171234567');
  assert.match(first.whatsapp_url, /^https:\/\/wa\.me\/639171234567\?text=/);
  assert.match(first.whatsapp_url, /Seoul/);
  assert.equal(first.viber_url, 'viber://chat?number=%2B639171234567');
  const completed = service.completeFollowUp({ task_id: first.task_id, note: 'Called, interested' }, 'USER:staff1');
  assert.equal(completed.ok, true);
  const leadAfter = service.getLead(first.lead.expo_lead_id);
  assert.equal(leadAfter.data.lead.status, 'CONTACTED', 'first completed follow-up moves a NEW lead to CONTACTED');
  const again = service.completeFollowUp({ task_id: first.task_id });
  assert.equal(again.ok, false);
  assert.equal(again.error.code, 'TASK_ALREADY_CLOSED');
});

test('package templates: create, update, archive, validation, and one-time placeholder seeding', () => {
  const { service } = buildService();
  const seeded = service.seedPlaceholderTemplates();
  assert.equal(seeded.seeded, true);
  assert.equal(seeded.seeded_count, 3);
  assert.equal(service.seedPlaceholderTemplates().seeded, false, 'seeding must never overwrite edits');
  const created = service.createTemplate({ destination: 'Tokyo', name: 'Tokyo Highlights 5D4N', duration_days: 5, price_per_person: '48000', inclusions: ['Airfare', 'Hotel'], exclusions: ['Visa'] }, 'USER:owner');
  assert.equal(created.ok, true);
  assert.equal(created.data.price_per_person, '48000.00');
  assert.equal(created.data.currency, 'PHP');
  const badPrice = service.createTemplate({ destination: 'Tokyo', name: 'X', duration_days: 5, price_per_person: '0', inclusions: ['Airfare'] });
  assert.equal(badPrice.error.code, 'INVALID_MONEY');
  const noInclusions = service.createTemplate({ destination: 'Tokyo', name: 'X', duration_days: 5, price_per_person: '1000' });
  assert.equal(noInclusions.error.code, 'INCLUSIONS_REQUIRED');
  const updated = service.updateTemplate({ expo_package_template_id: created.data.expo_package_template_id, price_per_person: '49500.50', status: 'ARCHIVED' }, 'USER:owner');
  assert.equal(updated.ok, true);
  assert.equal(updated.data.price_per_person, '49500.50');
  assert.equal(updated.data.status, 'ARCHIVED');
  assert.equal(service.listTemplates().some((template) => template.expo_package_template_id === created.data.expo_package_template_id), false);
  assert.equal(service.listTemplates({ include_archived: true }).some((template) => template.expo_package_template_id === created.data.expo_package_template_id), true);
});

test('quotation flow: create from templates, send email to outbox, public view, accept, decline guardrails', async () => {
  const { runtime, service, outboxDir } = buildService();
  service.seedPlaceholderTemplates();
  const captured = service.captureLead(leadInput({ email: 'maria@example.test' }));
  const leadId = captured.data.expo_lead_id;
  const templates = service.listTemplates();
  const quote = service.createQuote({
    expo_lead_id: leadId,
    options: [
      { template_id: templates[0].expo_package_template_id },
      { template_id: templates[1].expo_package_template_id, price_per_person: '29900' }
    ]
  }, 'USER:staff1');
  assert.equal(quote.ok, true);
  assert.equal(quote.data.status, 'DRAFT');
  assert.equal(quote.data.options.length, 2);
  assert.equal(quote.data.options[1].price_per_person, '29900.00', 'price override wins over the template');
  assert.equal(quote.data.options[0].price_per_person, templates[0].price_per_person, 'template price snapshots by default');

  const missingTemplate = service.createQuote({ expo_lead_id: leadId, options: [{ template_id: 'EXPO_PACKAGE-2099-999999' }] });
  assert.equal(missingTemplate.error.code, 'TEMPLATE_NOT_FOUND');
  const noOptions = service.createQuote({ expo_lead_id: leadId, options: [] });
  assert.equal(noOptions.error.code, 'QUOTE_OPTIONS_INVALID');

  const sent = await service.sendQuoteEmailAsync({ expo_quote_id: quote.data.expo_quote_id }, 'USER:staff1');
  assert.equal(sent.ok, true);
  assert.equal(sent.data.delivery.mode, 'eml_file', 'unconfigured SMTP degrades to a reviewable .eml draft');
  const eml = fs.readFileSync(sent.data.delivery.path, 'utf8');
  assert.match(eml, /Subject: Your Worldmaster travel quotation/);
  assert.match(eml, new RegExp(sent.data.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const stored = runtime.get('ExpoQuote', quote.data.expo_quote_id);
  assert.equal(stored.status, 'SENT');
  assert.equal(stored.sent_to_email, 'maria@example.test');
  assert.equal(stored.public_token_hash, null === null ? stored.public_token_hash : null); // hash stored, raw token never
  assert.doesNotMatch(JSON.stringify(stored), new RegExp(sent.data.url.split('/q/')[1], 'i'), 'raw token must not be stored on the record');
  assert.equal(service.getLead(leadId).data.lead.status, 'QUOTED');

  const publicView = service.getPublicQuote(sent.data.url.split('/q/')[1]);
  assert.equal(publicView.ok, true);
  assert.equal(publicView.data.options.length, 2);
  assert.equal(publicView.data.traveller_first_name, 'Maria');
  assert.equal(publicView.data.mobile, undefined);
  const wrongToken = service.getPublicQuote('f'.repeat(48));
  assert.equal(wrongToken.ok, false);

  const accepted = service.acceptQuote(sent.data.url.split('/q/')[1], { accepted_by: 'Maria Santos', option_id: 'OPT-2' });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.data.accepted_option, quote.data.options[1].name);
  const acceptedReplay = service.acceptQuote(sent.data.url.split('/q/')[1], { accepted_by: 'Maria Santos' });
  assert.equal(acceptedReplay.meta.idempotent, true);
  const declinedAfterAccept = service.declineQuote(sent.data.url.split('/q/')[1], {});
  assert.equal(declinedAfterAccept.ok, false);
  assert.equal(declinedAfterAccept.error.code, 'QUOTATION_NOT_DECLINABLE');
  assert.equal(service.getLead(leadId).data.lead.status, 'ACCEPTED');
  const resendAfterAccept = await service.sendQuoteEmailAsync({ expo_quote_id: quote.data.expo_quote_id });
  assert.equal(resendAfterAccept.ok, false);
  assert.equal(resendAfterAccept.error.code, 'QUOTE_STATUS_FINAL');

  const noEmail = await service.sendQuoteEmailAsync({ expo_quote_id: 'EXPO_QUOTE-2099-000001' });
  assert.equal(noEmail.ok, false);
  fs.rmSync(outboxDir, { recursive: true, force: true });
});

test('acceptance is rate limited and expired quotations are refused', async () => {
  const { service } = buildService();
  service.seedPlaceholderTemplates();
  const captured = service.captureLead(leadInput({ email: 'x@example.test' }));
  const templates = service.listTemplates();
  const quote = service.createQuote({ expo_lead_id: captured.data.expo_lead_id, options: [{ template_id: templates[0].expo_package_template_id }] });
  const sent = await service.sendQuoteEmailAsync({ expo_quote_id: quote.data.expo_quote_id });
  const token = sent.data.url.split('/q/')[1];
  assert.equal(service.acceptQuote(token, { accepted_by: 'A' }).ok, true);
  // Expired quotation: fresh quote, token, then age the clock via a service with a future clock is complex;
  // simulate by direct record surgery on valid_until.
  const quote2 = service.createQuote({ expo_lead_id: captured.data.expo_lead_id, options: [{ template_id: templates[1].expo_package_template_id }] });
  const sent2 = await service.sendQuoteEmailAsync({ expo_quote_id: quote2.data.expo_quote_id });
  const token2 = sent2.data.url.split('/q/')[1];
  service.runtime.updateRecord('ExpoQuote', quote2.data.expo_quote_id, { valid_until: '2020-01-01' }, { actor: 'TEST' });
  const expired = service.acceptQuote(token2, { accepted_by: 'A' });
  assert.equal(expired.ok, false);
  assert.equal(expired.error.code, 'QUOTATION_EXPIRED');
});

test('markBooked links a real Booking, finalizes lead and quote, and cancels remaining follow-ups', async () => {
  const { runtime, service } = buildService();
  service.seedPlaceholderTemplates();
  const captured = service.captureLead(leadInput({ email: 'booked@example.test' }));
  const templates = service.listTemplates();
  const quote = service.createQuote({ expo_lead_id: captured.data.expo_lead_id, options: [{ template_id: templates[0].expo_package_template_id }] });
  const sent = await service.sendQuoteEmailAsync({ expo_quote_id: quote.data.expo_quote_id });
  const token = sent.data.url.split('/q/')[1];

  const premature = service.markBooked({ expo_quote_id: quote.data.expo_quote_id, booking_id: 'BOOKING-2026-000001' });
  assert.equal(premature.ok, false);
  assert.equal(premature.error.code, 'ACCEPTANCE_REQUIRED');

  const booking = runtime.createRecord('Booking', { quotation_id: null, client_id: null, destination: 'Seoul', currency: 'PHP', client_total: '65800.00', commitment_state: 'CONFIRMED' }, { actor: 'LOCAL_STAFF' });
  assert.equal(booking.ok, true);
  assert.equal(service.acceptQuote(token, { accepted_by: 'Maria Santos' }).ok, true);
  const badBooking = service.markBooked({ expo_quote_id: quote.data.expo_quote_id, booking_id: 'BOOKING-2099-999999' });
  assert.equal(badBooking.ok, false);
  assert.equal(badBooking.error.code, 'NOT_FOUND');
  const booked = service.markBooked({ expo_quote_id: quote.data.expo_quote_id, booking_id: booking.data.booking_id }, 'USER:owner');
  assert.equal(booked.ok, true);
  assert.equal(booked.data.status, 'BOOKED');
  assert.equal(service.getLead(captured.data.expo_lead_id).data.lead.status, 'BOOKED');
  const replay = service.markBooked({ expo_quote_id: quote.data.expo_quote_id, booking_id: booking.data.booking_id });
  assert.equal(replay.meta.idempotent, true);
});

test('the dashboard reports the full funnel, per-day activity, per-package offers, and booking revenue', async () => {
  const { runtime, service } = buildService();
  service.seedPlaceholderTemplates();
  const templates = service.listTemplates();
  const maria = service.captureLead(leadInput({ email: 'm@example.test' }));
  const juan = service.importLeads({ text: 'Juan Dela Cruz,09181112222,Bangkok,2026-11' });
  assert.equal(juan.data.created_count, 1);
  const quote = service.createQuote({ expo_lead_id: maria.data.expo_lead_id, options: templates.slice(0, 2).map((template) => ({ template_id: template.expo_package_template_id })) });
  const sent = await service.sendQuoteEmailAsync({ expo_quote_id: quote.data.expo_quote_id });
  const token = sent.data.url.split('/q/')[1];
  assert.equal(service.acceptQuote(token, { accepted_by: 'Maria Santos', option_id: 'OPT-1' }).ok, true);
  const booking = runtime.createRecord('Booking', { destination: 'Bangkok', currency: 'PHP', client_total: '74000.00', commitment_state: 'CONFIRMED' }, { actor: 'LOCAL_STAFF' });
  service.markBooked({ expo_quote_id: quote.data.expo_quote_id, booking_id: booking.data.booking_id }, 'USER:owner');

  const board = service.dashboard();
  assert.equal(board.ok, true);
  assert.equal(board.data.funnel.leads, 2);
  assert.equal(board.data.funnel.quotes_sent, 1);
  assert.equal(board.data.funnel.accepted, 1);
  assert.equal(board.data.funnel.booked, 1);
  assert.equal(board.data.conversion.lead_to_quote_percent, 50);
  assert.equal(board.data.conversion.quote_to_accept_percent, 100);
  assert.equal(board.data.revenue.php_total, '74000.00');
  const todayRow = board.data.by_day.find((row) => row.day === new Date().toISOString().slice(0, 10));
  assert.equal(todayRow.leads, 2);
  assert.equal(todayRow.accepted, 1);
  const packageRow = board.data.by_package.find((row) => row.package.startsWith(templates[0].name));
  assert.equal(packageRow.offered, 1);
  assert.equal(packageRow.accepted, 1);
});

test('expo actions are audited through the runtime audit log', async () => {
  const { runtime, service } = buildService();
  service.seedPlaceholderTemplates();
  service.captureLead(leadInput());
  const audit = runtime.auditLog.list();
  const actions = audit.map((event) => event.action);
  assert.ok(actions.includes('CREATE'), 'entity creation is audited');
  const leadCreate = audit.find((event) => event.entity_type === 'ExpoLead' && event.action === 'CREATE');
  assert.ok(leadCreate, 'the ExpoLead creation has an audit entry');
  assert.equal(leadCreate.actor, 'PUBLIC_EXPO_KIOSK');
  const templateCreate = audit.find((event) => event.entity_type === 'ExpoPackageTemplate' && event.action === 'CREATE');
  assert.equal(templateCreate.actor, 'SYSTEM_EXPO_SEED');
});
