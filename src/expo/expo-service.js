'use strict';

// WMIT expo increment: lead capture, follow-up queue, package templates,
// multi-option quote delivery over public token links, and the conversion
// dashboard â€” all on top of the Phase 1 runtime (immutable IDs, audit,
// idempotency) and the hosted-server mailer.
//
// Public-facing entry points (kiosk capture, quote view/accept) carry their
// own rate limiting, mirroring the Apps Script public-channel design: a
// per-mobile cooldown plus a global windowed cap, and failed validations
// never consume quota.

const crypto = require('node:crypto');
const { WmitError, errorResult } = require('../core/errors');
const { toMinorUnits, fromMinorUnits } = require('../core/money');
const { RateLimiter } = require('../server/rate-limiter');

const EXPO_TAG = 'EXPO-2026';
const EXPO_NAME = 'Worldmaster International Travel â€” Expo 2026';
const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUOTED', 'ACCEPTED', 'BOOKED', 'LOST', 'UNREACHABLE'];
const TERMINAL_LEAD_STATUSES = ['BOOKED', 'LOST', 'UNREACHABLE'];
const QUOTE_STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'BOOKED'];
const FOLLOW_UP_DAYS = [1, 3, 7];
const TRAVEL_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MEAL_PLAN_VALUES = ['ROOM_ONLY', 'BREAKFAST', 'HALF_BOARD', 'FULL_BOARD', 'ANY'];

function ok(data, meta) { return { ok: true, data, meta: meta || {} }; }
function fail(error) { return errorResult(error); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function requireValue(value, field) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new WmitError('REQUIRED_FIELD', field + ' is required.', { field });
  }
  return String(value).trim();
}

function normalizeMoney(value, field) {
  try {
    const normalized = fromMinorUnits(toMinorUnits(value));
    if (toMinorUnits(normalized) < 0n) throw new Error('negative');
    return normalized;
  } catch (error) {
    throw new WmitError('INVALID_MONEY', field + ' must be a valid non-negative amount.', { field });
  }
}

// Philippine mobile normalization: 09xxxxxxxxx, +639xxxxxxxxx, 639xxxxxxxxx,
// or 9xxxxxxxxx all normalize to the MSISDN form +639xxxxxxxxx.
function normalizeMobile(input) {
  const raw = requireValue(input, 'mobile');
  const digits = String(raw).replace(/[^\d+]/g, '');
  let msisdn = null;
  if (/^\+63\d{10}$/.test(digits)) msisdn = digits;
  else if (/^63\d{10}$/.test(digits)) msisdn = '+' + digits;
  else if (/^0\d{10}$/.test(digits)) msisdn = '+63' + digits.slice(1);
  else if (/^9\d{9}$/.test(digits)) msisdn = '+639' + digits.slice(1);
  if (!msisdn) throw new WmitError('MOBILE_INVALID', 'Enter a valid Philippine mobile number (e.g. 0917 123 4567).', { mobile: raw.slice(0, 40) });
  return msisdn;
}

function waLink(msisdn, message) {
  const base = 'https://wa.me/' + msisdn.replace(/^\+/, '');
  return message ? base + '?text=' + encodeURIComponent(message) : base;
}

function viberLink(msisdn) {
  return 'viber://chat?number=' + encodeURIComponent(msisdn);
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function dateOnlyPlusDays(isoTimestamp, days) {
  const date = new Date(isoTimestamp);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function firstName(fullName) {
  return String(fullName || '').trim().split(/\s+/)[0] || '';
}

class ExpoService {
  constructor(options) {
    const opts = options || {};
    this.runtime = opts.runtime;
    this.mailer = opts.mailer || null;
    this.config = opts.config || {};
    this.clock = opts.clock || (() => new Date());
    this.actor = opts.actor || 'EXPO_SYSTEM';
    this.limiter = opts.limiter || new RateLimiter({
      clock: this.clock,
      cooldownMs: 60 * 1000,          // one kiosk submission per mobile per minute
      globalLimit: 30,                // and at most 30 submissions per windowâ€¦
      globalWindowMs: 10 * 60 * 1000  // â€¦across all mobiles (port of the Apps Script caps)
    });
    this.publicActionLimiter = opts.publicActionLimiter || new RateLimiter({
      clock: this.clock,
      cooldownMs: 30 * 1000,
      globalLimit: 60,
      globalWindowMs: 10 * 60 * 1000
    });
  }

  now() { return this.clock().toISOString(); }
  baseUrl() { return String(this.config.baseUrl || 'http://127.0.0.1:3000').replace(/\/+$/, ''); }
  ctx(actor) { return { actor: actor || this.actor }; }

  optionalInteger(value, min, max, code, message) {
    if (value === undefined || value === null || value === '') return null;
    const number = Number(value);
    if (!Number.isInteger(number) || number < min || number > max) throw new WmitError(code, message, { value });
    return number;
  }

  // ------------------------------------------------------- expo registry
  //
  // Each expo is an ExpoEvent record; every lead, quote, and package
  // template carries its tag. EXPO-2026 (the September event) is the
  // seeded default so pre-registry data keeps working. "History" is simply
  // selecting an ENDED expo anywhere in the console — all views are
  // expo-scoped.

  listExpos() {
    return this.runtime.list('ExpoEvent').sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')));
  }

  expoByTag(tag) {
    return this.runtime.list('ExpoEvent', (event) => event.expo_tag === tag)[0] || null;
  }

  // The expo the kiosk uses when no ?expo= is given: the soonest upcoming
  // ACTIVE event (so pre-creating next year's fair never steals the kiosk),
  // falling back to the most recently started one. Legacy fallback keeps
  // EXPO-2026 working before the boot seeding has run (e.g. direct service
  // use in tests).
  currentExpo() {
    const active = this.listExpos().filter((event) => event.status === 'ACTIVE');
    // Until the boot seeding registers it, the legacy September tag acts as a
    // virtual ACTIVE event with its real dates so ordering stays correct.
    if (!this.expoByTag(EXPO_TAG)) active.push({ expo_tag: EXPO_TAG, name: EXPO_NAME, status: 'ACTIVE', start_date: '2026-09-04', end_date: '2026-09-06' });
    if (!active.length) return { expo_tag: EXPO_TAG, name: EXPO_NAME, status: 'ACTIVE', start_date: null, end_date: null };
    const today = this.now().slice(0, 10);
    const dated = active.filter((event) => event.start_date);
    const upcoming = dated.filter((event) => event.start_date >= today).sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));
    if (upcoming.length) return upcoming[0];
    if (dated.length) return dated.sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)))[0];
    return active[0];
  }

  resolveExpoTag(supplied) {
    if (supplied === undefined || supplied === null || String(supplied).trim() === '') return this.currentExpo().expo_tag;
    const tag = String(supplied).trim().toUpperCase();
    const event = this.expoByTag(tag);
    if (!event) {
      // The legacy September tag is implicitly valid until the boot seeding
      // registers it, so direct service use and mid-boot calls keep working.
      if (tag === EXPO_TAG) return tag;
      throw new WmitError('EXPO_NOT_FOUND', 'That expo does not exist.', { expo_tag: tag });
    }
    if (event.status !== 'ACTIVE') throw new WmitError('EXPO_NOT_ACTIVE', 'That expo has ended and no longer accepts new leads.', { expo_tag: tag, status: event.status });
    return tag;
  }

  createExpo(input, actor) {
    try {
      const value = input || {};
      const name = requireValue(value.name, 'name');
      if (name.length > 120) throw new WmitError('NAME_TOO_LONG', 'Expo name must be 120 characters or fewer.', { length: name.length });
      const tag = String(value.expo_tag || this.suggestExpoTag(name)).trim().toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(tag)) throw new WmitError('EXPO_TAG_INVALID', 'Expo tag must be 3-40 characters (letters, numbers, dash, underscore).', { expo_tag: tag });
      if (this.expoByTag(tag)) throw new WmitError('EXPO_DUPLICATE', 'An expo with that tag already exists.', { expo_tag: tag });
      const startDate = value.start_date ? String(value.start_date) : null;
      const endDate = value.end_date ? String(value.end_date) : null;
      const datePattern = /^\d{4}-\d{2}-\d{2}$/;
      if (startDate && !datePattern.test(startDate)) throw new WmitError('EXPO_DATE_INVALID', 'Start date must look like 2026-09-04.', { start_date: startDate });
      if (endDate && !datePattern.test(endDate)) throw new WmitError('EXPO_DATE_INVALID', 'End date must look like 2026-09-06.', { end_date: endDate });
      if (startDate && endDate && endDate < startDate) throw new WmitError('EXPO_DATE_RANGE_INVALID', 'End date cannot be before the start date.', { start_date: startDate, end_date: endDate });
      const status = value.status === undefined ? 'ACTIVE' : String(value.status).toUpperCase();
      if (!['ACTIVE', 'ENDED'].includes(status)) throw new WmitError('EXPO_STATUS_INVALID', 'Expo status must be ACTIVE or ENDED.', { status });
      const created = this.runtime.createRecord('ExpoEvent', {
        name, expo_tag: tag, start_date: startDate, end_date: endDate, status,
        idempotency_key: value.idempotency_key || null
      }, this.ctx(actor || this.actor));
      if (created.ok) this.seedPlaceholderTemplates(tag, actor);
      return created;
    } catch (error) {
      return fail(error);
    }
  }

  setExpoStatus(input, actor) {
    try {
      const value = input || {};
      const event = this.expoByTag(requireValue(value.expo_tag, 'expo_tag'));
      if (!event) throw new WmitError('EXPO_NOT_FOUND', 'That expo does not exist.', { expo_tag: value.expo_tag });
      const next = requireValue(value.status, 'status').toUpperCase();
      if (!['ACTIVE', 'ENDED'].includes(next)) throw new WmitError('EXPO_STATUS_INVALID', 'Expo status must be ACTIVE or ENDED.', { status: next });
      if (event.status === next) return ok(event, { action: 'EXPO_SET_STATUS', idempotent: true });
      return this.runtime.updateRecord('ExpoEvent', event.expo_event_id, { status: next }, this.ctx(actor || this.actor));
    } catch (error) {
      return fail(error);
    }
  }

  // Boot-time idempotent seeding: guarantees the September event exists as a
  // registry record so pre-registry EXPO-2026 data links up.
  ensureDefaultExpo() {
    if (this.expoByTag(EXPO_TAG)) return { ensured: false };
    const created = this.createExpo({ name: EXPO_NAME, expo_tag: EXPO_TAG, start_date: '2026-09-04', end_date: '2026-09-06', status: 'ACTIVE' }, 'SYSTEM_EXPO_SEED');
    return created.ok ? { ensured: true } : { ensured: false, error: created.error };
  }

  suggestExpoTag(name) {
    const year = String(new Date(this.now()).getUTCFullYear());
    const slug = String(name).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
    return 'EXPO-' + year + '-' + (slug || 'EVENT');
  }

  // Public read for the kiosk: which expo this form serves. An explicit ?expo=
  // is honored only while ACTIVE; otherwise the current default is returned.
  getPublicConfig(input) {
    try {
      const requested = input && input.expo ? String(input.expo).trim().toUpperCase() : '';
      if (requested) {
        const event = this.expoByTag(requested);
        if (!event) throw new WmitError('EXPO_NOT_FOUND', 'That expo does not exist.');
        if (event.status !== 'ACTIVE') throw new WmitError('EXPO_NOT_ACTIVE', 'That expo has ended.');
        return ok({ expo_tag: event.expo_tag, name: event.name, start_date: event.start_date, end_date: event.end_date });
      }
      const current = this.currentExpo();
      return ok({ expo_tag: current.expo_tag, name: current.name, start_date: current.start_date || null, end_date: current.end_date || null });
    } catch (error) {
      return fail(error);
    }
  }

  // ---------------------------------------------------------------- leads

  captureLead(input) {
    try {
      const value = input || {};
      const name = requireValue(value.name, 'name');
      if (name.length > 80) throw new WmitError('NAME_TOO_LONG', 'Name must be 80 characters or fewer.', { length: name.length });
      const msisdn = normalizeMobile(value.mobile);
      const destination = requireValue(value.destination, 'destination');
      if (destination.length > 80) throw new WmitError('DESTINATION_TOO_LONG', 'Destination must be 80 characters or fewer.', { length: destination.length });
      const travelMonth = requireValue(value.travel_month, 'travel_month');
      if (!TRAVEL_MONTH_PATTERN.test(travelMonth)) throw new WmitError('TRAVEL_MONTH_INVALID', 'Choose a travel month (YYYY-MM).', { travel_month: travelMonth.slice(0, 10) });
      const email = value.email ? String(value.email).trim().toLowerCase() : '';
      if (email && !EMAIL_PATTERN.test(email)) throw new WmitError('EMAIL_INVALID', 'Enter a valid email address or leave it blank.', { email: email.slice(0, 80) });
      const paxCount = value.pax_count === undefined || value.pax_count === null || value.pax_count === '' ? null : Number(value.pax_count);
      if (paxCount !== null && (!Number.isInteger(paxCount) || paxCount < 1 || paxCount > 50)) {
        throw new WmitError('PAX_COUNT_INVALID', 'Number of travellers must be between 1 and 50.', { pax_count: value.pax_count });
      }
      // Quotation brief: who is travelling, for how long, and at what hotel
      // standard — enough for staff to quote on the floor without a call.
      const adults = this.optionalInteger(value.adults, 1, 20, 'ADULTS_INVALID', 'Adults must be between 1 and 20.');
      const children = this.optionalInteger(value.children, 0, 20, 'CHILDREN_INVALID', 'Children must be between 0 and 20.');
      const durationDays = this.optionalInteger(value.duration_days, 1, 60, 'DURATION_INVALID', 'Trip length must be between 1 and 60 days.');
      const hotelStars = this.optionalInteger(value.hotel_stars, 1, 5, 'HOTEL_STARS_INVALID', 'Hotel rating must be 1 to 5 stars.');
      const mealPlan = value.meal_plan === undefined || value.meal_plan === null || String(value.meal_plan).trim() === '' ? null : String(value.meal_plan).trim().toUpperCase();
      if (mealPlan && !MEAL_PLAN_VALUES.includes(mealPlan)) {
        throw new WmitError('MEAL_PLAN_INVALID', 'Meal plan is not supported.', { meal_plan: mealPlan, allowed: MEAL_PLAN_VALUES });
      }
      const derivedPax = adults !== null || children !== null ? (adults === null ? 1 : adults) + (children === null ? 0 : children) : paxCount;
      const notes = value.notes ? String(value.notes).trim().slice(0, 500) : '';
      const expoTag = this.resolveExpoTag(value.expo_tag);

      // Idempotent retries stay free: a kiosk double-tap with the same key
      // replays the original result before any rate-limit accounting, exactly
      // like the Apps Script public channel (idempotency first, limits second).
      if (value.idempotency_key) {
        const prior = this.runtime.list('ExpoLead', (lead) => lead.idempotency_key === value.idempotency_key);
        if (prior.length) return ok({ expo_lead_id: prior[0].expo_lead_id, status: 'RECEIVED', follow_up_task_ids: [] }, { action: 'IDEMPOTENT_REPLAY', idempotent: true });
      }
      // Rate limiting happens after validation: a rejected form never
      // consumes the caller's cooldown (Apps Script public-channel port).
      if (!this.limiter.check(msisdn)) {
        throw new WmitError('RATE_LIMITED', 'Please wait a minute before submitting again.');
      }
      const created = this.runtime.createRecord('ExpoLead', {
        name,
        mobile: msisdn,
        email: email || null,
        destination,
        travel_month: travelMonth,
        pax_count: derivedPax,
        adults,
        children,
        duration_days: durationDays,
        hotel_stars: hotelStars,
        meal_plan: mealPlan,
        notes: notes || null,
        status: 'NEW',
        source: value.source === 'IMPORT' ? 'IMPORT' : 'KIOSK',
        expo_tag: expoTag,
        idempotency_key: value.idempotency_key || null
      }, this.ctx('PUBLIC_EXPO_KIOSK'));
      if (!created.ok) return created;
      this.limiter.consume(msisdn);
      const tasks = this.ensureFollowUpTasksForLead(created.data);
      return ok({ expo_lead_id: created.data.expo_lead_id, status: 'RECEIVED', follow_up_task_ids: tasks.map((task) => task.task_id) }, { action: 'EXPO_CAPTURE_LEAD' });
    } catch (error) {
      return fail(error);
    }
  }

  // Bulk importer for badges scanned at the expo. Accepts CSV rows
  // (name,mobile,destination,travel_month[,email]) or one name per line with
  // default destination/month supplied by the operator. Every row reports
  // success or a precise error; nothing is silently skipped.
  importLeads(input, actor) {
    try {
      const value = input || {};
      const text = String(value.text || '');
      const defaultDestination = value.default_destination ? String(value.default_destination).trim() : '';
      const defaultTravelMonth = value.default_travel_month ? String(value.default_travel_month).trim() : '';
      if (!text.trim()) throw new WmitError('REQUIRED_FIELD', 'Paste at least one line to import.');
      const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (lines.length > 500) throw new WmitError('IMPORT_TOO_LARGE', 'Import at most 500 lines at a time.', { lines: lines.length });
      const importExpoTag = this.resolveExpoTag(value.expo_tag);
      const existingMobiles = new Set(this.listLeads().map((lead) => lead.mobile));
      const created = [];
      const failed = [];
      lines.forEach((line, index) => {
        try {
          const cells = line.split(',').map((cell) => cell.trim());
          const name = requireValue(cells[0], 'line ' + (index + 1) + ' name');
          // Badge scans often carry only a name: a single-cell row imports
          // without a mobile and staff attach it on first contact. In a
          // structured CSV row (2+ cells) the mobile column is required.
          const mobileRaw = cells[1] || '';
          if (cells.length > 1 && !mobileRaw) throw new WmitError('REQUIRED_FIELD', 'Line ' + (index + 1) + ': mobile is required (name,mobile,destination,travel_month).');
          const msisdn = mobileRaw ? normalizeMobile(mobileRaw) : null;
          if (msisdn && existingMobiles.has(msisdn)) throw new WmitError('LEAD_DUPLICATE', 'Line ' + (index + 1) + ': a lead with this mobile already exists.');
          const destination = cells[2] || defaultDestination;
          if (!destination) throw new WmitError('REQUIRED_FIELD', 'Line ' + (index + 1) + ': destination is required.');
          const travelMonth = cells[3] || defaultTravelMonth;
          if (!travelMonth) throw new WmitError('REQUIRED_FIELD', 'Line ' + (index + 1) + ': travel month is required.');
          if (!TRAVEL_MONTH_PATTERN.test(travelMonth)) throw new WmitError('TRAVEL_MONTH_INVALID', 'Line ' + (index + 1) + ': travel month must look like 2026-10.');
          const email = cells[4] ? cells[4].toLowerCase() : '';
          if (email && !EMAIL_PATTERN.test(email)) throw new WmitError('EMAIL_INVALID', 'Line ' + (index + 1) + ': invalid email.');
          const result = this.runtime.createRecord('ExpoLead', {
            name,
            mobile: msisdn,
            needs_mobile: msisdn === null,
            email: email || null,
            destination,
            travel_month: travelMonth,
            pax_count: null,
            notes: value.note ? String(value.note).slice(0, 500) : null,
            status: 'NEW',
            source: 'IMPORT',
            expo_tag: importExpoTag,
            imported_from: importExpoTag + ' BADGE IMPORT'
          }, this.ctx(actor || this.actor));
          if (!result.ok) throw new WmitError(result.error.code, 'Line ' + (index + 1) + ': ' + result.error.message, result.error.details);
          if (msisdn) existingMobiles.add(msisdn);
          created.push(result.data);
        } catch (rowError) {
          failed.push({ line: index + 1, error: rowError.code || 'IMPORT_ROW_INVALID', message: rowError.message });
        }
      });
      const taskCounts = created.map((lead) => this.ensureFollowUpTasksForLead(lead).length);
      return ok({
        created_count: created.length,
        failed_count: failed.length,
        created: created.map((lead) => ({ expo_lead_id: lead.expo_lead_id, name: lead.name, mobile: lead.mobile, destination: lead.destination, travel_month: lead.travel_month })),
        failed,
        follow_up_tasks_created: taskCounts.reduce((sum, count) => sum + count, 0)
      }, { action: 'EXPO_IMPORT_LEADS' });
    } catch (error) {
      return fail(error);
    }
  }

  listLeads(filters) {
    const value = filters || {};
    const scopeTag = value.expo_tag ? String(value.expo_tag).toUpperCase() : null;
    let leads = this.runtime.list('ExpoLead', (lead) => (scopeTag ? lead.expo_tag === scopeTag : this.expoByTag(lead.expo_tag) || lead.expo_tag === EXPO_TAG));
    if (value.status) leads = leads.filter((lead) => lead.status === value.status);
    if (value.q) {
      const needle = String(value.q).toLowerCase();
      leads = leads.filter((lead) => [lead.name, lead.mobile, lead.destination, lead.email].some((field) => field && String(field).toLowerCase().includes(needle)));
    }
    return leads.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }

  getLead(expoLeadId) {
    try {
      const lead = this.runtime.get('ExpoLead', requireValue(expoLeadId, 'expo_lead_id'));
      const tasks = this.runtime.list('Task', (task) => task.expo_lead_id === lead.expo_lead_id).sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || '')));
      const quotes = this.runtime.list('ExpoQuote', (quote) => quote.expo_lead_id === lead.expo_lead_id);
      return ok({
        lead, tasks, quotes,
        whatsapp_url: lead.mobile ? waLink(lead.mobile) : null,
        viber_url: lead.mobile ? viberLink(lead.mobile) : null
      });
    } catch (error) {
      return fail(error);
    }
  }

  // Staff enrich imported badge leads: attach the mobile captured on first
  // contact, fix a typo, or fill email/pax details. Status changes use
  // updateLeadStatus so follow-up cancellation stays consistent.
  updateLead(input, actor) {
    try {
      const value = input || {};
      const lead = this.runtime.get('ExpoLead', requireValue(value.expo_lead_id, 'expo_lead_id'));
      const changes = {};
      if (value.mobile !== undefined) {
        const msisdn = value.mobile === null || String(value.mobile).trim() === '' ? null : normalizeMobile(value.mobile);
        changes.mobile = msisdn;
        changes.needs_mobile = msisdn === null;
      }
      if (value.email !== undefined) {
        const email = value.email ? String(value.email).trim().toLowerCase() : '';
        if (email && !EMAIL_PATTERN.test(email)) throw new WmitError('EMAIL_INVALID', 'Enter a valid email address or leave it blank.', { email: email.slice(0, 80) });
        changes.email = email || null;
      }
      if (value.name !== undefined) changes.name = requireValue(value.name, 'name');
      if (value.destination !== undefined) changes.destination = requireValue(value.destination, 'destination');
      if (value.travel_month !== undefined) {
        const travelMonth = requireValue(value.travel_month, 'travel_month');
        if (!TRAVEL_MONTH_PATTERN.test(travelMonth)) throw new WmitError('TRAVEL_MONTH_INVALID', 'Travel month must look like 2026-10.', { travel_month: travelMonth.slice(0, 10) });
        changes.travel_month = travelMonth;
      }
      if (value.pax_count !== undefined) {
        const paxCount = value.pax_count === null || value.pax_count === '' ? null : Number(value.pax_count);
        if (paxCount !== null && (!Number.isInteger(paxCount) || paxCount < 1 || paxCount > 50)) throw new WmitError('PAX_COUNT_INVALID', 'Number of travellers must be between 1 and 50.', { pax_count: value.pax_count });
        changes.pax_count = paxCount;
      }
      if (value.notes !== undefined) changes.notes = value.notes ? String(value.notes).slice(0, 500) : null;
      if (!Object.keys(changes).length) throw new WmitError('NO_CHANGES', 'Nothing to update.');
      return this.runtime.updateRecord('ExpoLead', lead.expo_lead_id, changes, this.ctx(actor || this.actor));
    } catch (error) {
      return fail(error);
    }
  }

  updateLeadStatus(input, actor) {
    try {
      const value = input || {};
      const lead = this.runtime.get('ExpoLead', requireValue(value.expo_lead_id, 'expo_lead_id'));
      const next = requireValue(value.status, 'status').toUpperCase();
      if (!LEAD_STATUSES.includes(next)) throw new WmitError('LEAD_STATUS_INVALID', 'Lead status is not supported.', { status: next, allowed: LEAD_STATUSES });
      if (TERMINAL_LEAD_STATUSES.includes(lead.status)) {
        throw new WmitError('LEAD_STATUS_FINAL', 'This lead already reached a final status (' + lead.status + ') and cannot be changed.', { current: lead.status });
      }
      if (TERMINAL_LEAD_STATUSES.includes(next)) this.cancelOpenFollowUps(lead.expo_lead_id, actor, 'Lead marked ' + next + '.');
      const updated = this.runtime.updateRecord('ExpoLead', lead.expo_lead_id, { status: next }, this.ctx(actor || this.actor));
      if (!updated.ok) return updated;
      return ok(updated.data, { action: 'EXPO_UPDATE_LEAD_STATUS' });
    } catch (error) {
      return fail(error);
    }
  }

  // ---------------------------------------------------------- follow-ups

  ensureFollowUpTasksForLead(lead, actor) {
    const created = [];
    if (TERMINAL_LEAD_STATUSES.includes(lead.status)) return created;
    const capturedAt = lead.created_at || this.now();
    FOLLOW_UP_DAYS.forEach((days) => {
      const key = 'EXPO:' + lead.expo_lead_id + ':DAY' + days;
      const existing = this.runtime.list('Task', (task) => task.automation_key === key);
      if (existing.length) return; // day-N reminders are created exactly once per lead
      const description = 'Day-' + days + ' follow-up for ' + lead.name + ' (' + lead.destination + ', travel month ' + lead.travel_month + '). Quote, answer questions, or mark the lead.';
      const result = this.runtime.createTask({
        automation_key: key,
        task_type: 'EXPO_FOLLOW_UP',
        related_type: 'ExpoLead',
        related_id: lead.expo_lead_id,
        expo_lead_id: lead.expo_lead_id,
        title: 'Day ' + days + ' follow-up â€” ' + lead.name,
        description,
        due_date: dateOnlyPlusDays(capturedAt, days),
        state: 'OPEN',
        priority: days === 1 ? 'HIGH' : 'NORMAL',
        source: 'EXPO_FOLLOW_UP',
        expo_tag: lead.expo_tag
      }, this.ctx(actor || 'SCHEDULER_EXPO'));
      if (result.ok) created.push({ task_id: result.data.task_id, due_date: result.data.due_date });
    });
    return created;
  }

  // Scheduler entry point: keeps follow-up tasks in sync for every active
  // lead, so captures that predate a deploy still get their reminders.
  ensureFollowUpTasks() {
    let created = 0;
    this.listLeads().forEach((lead) => {
      created += this.ensureFollowUpTasksForLead(lead).length;
    });
    return { leads_scanned: this.listLeads().length, tasks_created: created, checked_at: this.now() };
  }

  cancelOpenFollowUps(expoLeadId, actor, note) {
    this.runtime.list('Task', (task) => task.expo_lead_id === expoLeadId && ['OPEN', 'IN_PROGRESS', 'BLOCKED'].includes(task.state)).forEach((task) => {
      this.runtime.updateTask({ task_id: task.task_id, state: 'CANCELLED', completion_note: note || 'Expo follow-up cancelled.' }, this.ctx(actor || this.actor));
    });
  }

  getFollowUpQueue(filters) {
    const scopeTag = filters && filters.expo_tag ? String(filters.expo_tag).toUpperCase() : null;
    const leadsById = new Map(this.listLeads(scopeTag ? { expo_tag: scopeTag } : {}).map((lead) => [lead.expo_lead_id, lead]));
    const tasks = this.runtime.list('Task', (task) => task.source === 'EXPO_FOLLOW_UP' && (!scopeTag || task.expo_tag === scopeTag) && ['OPEN', 'IN_PROGRESS', 'BLOCKED'].includes(task.state))
      .sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')) || String(a.created_at).localeCompare(String(b.created_at)));
    const today = this.now().slice(0, 10);
    const queue = tasks.map((task) => {
      const lead = leadsById.get(task.expo_lead_id) || null;
      return {
        task_id: task.task_id,
        due_date: task.due_date,
        overdue: Boolean(task.due_date && task.due_date < today),
        day_step: String(task.automation_key || '').endsWith(':DAY1') ? 1 : String(task.automation_key || '').endsWith(':DAY3') ? 3 : String(task.automation_key || '').endsWith(':DAY7') ? 7 : null,
        state: task.state,
        lead: lead ? {
          expo_lead_id: lead.expo_lead_id,
          name: lead.name,
          mobile: lead.mobile,
          destination: lead.destination,
          travel_month: lead.travel_month,
          status: lead.status,
          email: lead.email,
          adults: lead.adults !== undefined ? lead.adults : null,
          children: lead.children !== undefined ? lead.children : null,
          duration_days: lead.duration_days !== undefined ? lead.duration_days : null,
          hotel_stars: lead.hotel_stars !== undefined ? lead.hotel_stars : null,
          meal_plan: lead.meal_plan || null
        } : null,
        whatsapp_url: lead && lead.mobile ? waLink(lead.mobile, this.followUpMessage(lead)) : null,
        viber_url: lead && lead.mobile ? viberLink(lead.mobile) : null
      };
    });
    return ok({
      open_count: queue.length,
      overdue_count: queue.filter((item) => item.overdue).length,
      today: today,
      queue
    }, { action: 'EXPO_FOLLOW_UP_QUEUE', read_only: true });
  }

  followUpMessage(lead) {
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const parts = String(lead.travel_month || '').split('-');
    const monthLabel = parts.length === 2 ? monthNames[Number(parts[1]) - 1] + ' ' + parts[0] : 'your travel month';
    return 'Hi ' + firstName(lead.name) + '! This is Worldmaster International Travel. We met at the expo â€” thank you for asking about ' + lead.destination + ' for ' + monthLabel + '. Here is your quotation link: {QUOTE_LINK}';
  }

  completeFollowUp(input, actor) {
    try {
      const value = input || {};
      const task = this.runtime.get('Task', requireValue(value.task_id, 'task_id'));
      if (task.source !== 'EXPO_FOLLOW_UP') throw new WmitError('NOT_EXPO_TASK', 'This task is not an expo follow-up.');
      if (['COMPLETED', 'CANCELLED'].includes(task.state)) throw new WmitError('TASK_ALREADY_CLOSED', 'This follow-up is already ' + task.state.toLowerCase() + '.');
      const updated = this.runtime.updateTask({ task_id: task.task_id, state: 'COMPLETED', completion_note: value.note ? String(value.note).slice(0, 500) : 'Follow-up completed.' }, this.ctx(actor || this.actor));
      if (!updated.ok) return updated;
      // First contact moves a NEW lead to CONTACTED automatically.
      if (task.expo_lead_id) {
        const lead = this.runtime.repos.ExpoLead.get(task.expo_lead_id);
        if (lead && lead.status === 'NEW') this.runtime.updateRecord('ExpoLead', lead.expo_lead_id, { status: 'CONTACTED' }, this.ctx(actor || this.actor));
      }
      return ok(updated.data, { action: 'EXPO_COMPLETE_FOLLOW_UP' });
    } catch (error) {
      return fail(error);
    }
  }

  // ---------------------------------------------------------- templates

  listTemplates(filters) {
    const value = filters || {};
    const includeArchived = Boolean(value.include_archived);
    const scopeTag = value.expo_tag ? String(value.expo_tag).toUpperCase() : EXPO_TAG;
    return this.runtime.list('ExpoPackageTemplate', (template) => template.expo_tag === scopeTag && (includeArchived || template.status !== 'ARCHIVED'))
      .sort((a, b) => String(a.destination).localeCompare(String(b.destination)) || String(a.name).localeCompare(String(b.name)));
  }

  createTemplate(input, actor) {
    try {
      const value = input || {};
      const templateExpoTag = this.resolveExpoTag(value.expo_tag);
      const destination = requireValue(value.destination, 'destination');
      const name = requireValue(value.name, 'name');
      const price = normalizeMoney(requireValue(value.price_per_person, 'price_per_person'), 'price_per_person');
      if (toMinorUnits(price) <= 0n) throw new WmitError('INVALID_MONEY', 'Price per person must be greater than zero.', { field: 'price_per_person' });
      const currency = String(value.currency || 'PHP').trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new WmitError('INVALID_CURRENCY', 'Currency must be a three-letter code.', { currency });
      const durationDays = Number(value.duration_days);
      if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 60) throw new WmitError('DURATION_INVALID', 'Duration must be 1-60 days.', { duration_days: value.duration_days });
      const inclusions = this.toStringList(value.inclusions, 'inclusions');
      const exclusions = this.toStringList(value.exclusions, 'exclusions');
      if (!inclusions.length) throw new WmitError('INCLUSIONS_REQUIRED', 'Add at least one inclusion so staff can quote on the floor.');
      const created = this.runtime.createRecord('ExpoPackageTemplate', {
        destination,
        name,
        description: value.description ? String(value.description).slice(0, 500) : null,
        duration_days: durationDays,
        price_per_person: price,
        currency,
        inclusions,
        exclusions,
        status: 'ACTIVE',
        expo_tag: templateExpoTag,
        idempotency_key: value.idempotency_key || null
      }, this.ctx(actor || this.actor));
      return created;
    } catch (error) {
      return fail(error);
    }
  }

  updateTemplate(input, actor) {
    try {
      const value = input || {};
      const template = this.runtime.get('ExpoPackageTemplate', requireValue(value.expo_package_template_id, 'expo_package_template_id'));
      const changes = {};
      if (value.destination !== undefined) changes.destination = requireValue(value.destination, 'destination');
      if (value.name !== undefined) changes.name = requireValue(value.name, 'name');
      if (value.description !== undefined) changes.description = value.description ? String(value.description).slice(0, 500) : null;
      if (value.price_per_person !== undefined) {
        const price = normalizeMoney(value.price_per_person, 'price_per_person');
        if (toMinorUnits(price) <= 0n) throw new WmitError('INVALID_MONEY', 'Price per person must be greater than zero.', { field: 'price_per_person' });
        changes.price_per_person = price;
      }
      if (value.currency !== undefined) {
        const currency = String(value.currency).trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(currency)) throw new WmitError('INVALID_CURRENCY', 'Currency must be a three-letter code.', { currency });
        changes.currency = currency;
      }
      if (value.duration_days !== undefined) {
        const durationDays = Number(value.duration_days);
        if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 60) throw new WmitError('DURATION_INVALID', 'Duration must be 1-60 days.', { duration_days: value.duration_days });
        changes.duration_days = durationDays;
      }
      if (value.inclusions !== undefined) changes.inclusions = this.toStringList(value.inclusions, 'inclusions');
      if (value.exclusions !== undefined) changes.exclusions = this.toStringList(value.exclusions, 'exclusions');
      if (value.status !== undefined) {
        const status = String(value.status).toUpperCase();
        if (!['ACTIVE', 'ARCHIVED'].includes(status)) throw new WmitError('TEMPLATE_STATUS_INVALID', 'Template status must be ACTIVE or ARCHIVED.', { status });
        changes.status = status;
      }
      if (!Object.keys(changes).length) throw new WmitError('NO_CHANGES', 'Nothing to update.');
      return this.runtime.updateRecord('ExpoPackageTemplate', template.expo_package_template_id, changes, this.ctx(actor || this.actor));
    } catch (error) {
      return fail(error);
    }
  }

  toStringList(value, field) {
    if (value === undefined || value === null) return [];
    const items = Array.isArray(value) ? value : String(value).split(/\r?\n|;/);
    const cleaned = items.map((item) => String(item).trim()).filter(Boolean).map((item) => item.slice(0, 200));
    if (cleaned.length > 40) throw new WmitError('LIST_TOO_LONG', field + ' has too many entries (max 40).', { field });
    return cleaned;
  }

  // Placeholder packages so staff can quote from day one; the owner
  // replaces prices and inclusions from the console. Runs only when the
  // expo has no template yet, so edits are never overwritten. New expos
  // get the same three starting points.
  seedPlaceholderTemplates(expoTagOrActor, maybeActor) {
    // Backward-compatible signature: seedPlaceholderTemplates(actor).
    const tag = typeof expoTagOrActor === 'string' ? expoTagOrActor.toUpperCase() : EXPO_TAG;
    const actor = typeof expoTagOrActor === 'string' ? maybeActor : expoTagOrActor;
    if (this.listTemplates({ include_archived: true, expo_tag: tag }).length) return { seeded: false };
    const placeholders = [
      {
        destination: 'Bangkok', name: 'Bangkok City Break 4D3N', duration_days: 4, price_per_person: '18500.00',
        description: 'Round-trip airfare, 3-night hotel with breakfast, airport transfers, half-day city tour. Placeholder pricing â€” confirm before quoting.',
        inclusions: ['Round-trip economy airfare', '3 nights hotel with breakfast', 'Airport transfers', 'Half-day city tour'],
        exclusions: ['Travel tax and terminal fees', 'Visa fees (if applicable)', 'Personal expenses', 'Tips']
      },
      {
        destination: 'Seoul', name: 'Seoul Discovery 5D4N', duration_days: 5, price_per_person: '32900.00',
        description: 'Round-trip airfare, 4-night hotel with breakfast, airport transfers, palace and Nami Island day tour. Placeholder pricing â€” confirm before quoting.',
        inclusions: ['Round-trip economy airfare', '4 nights hotel with breakfast', 'Airport transfers', 'Palace tour', 'Nami Island day tour'],
        exclusions: ['Korea visa fee', 'Travel tax and terminal fees', 'Personal expenses', 'Travel insurance']
      },
      {
        destination: 'Ho Chi Minh City', name: 'Vietnam Essentials 4D3N', duration_days: 4, price_per_person: '21750.00',
        description: 'Round-trip airfare, 3-night hotel with breakfast, airport transfers, Mekong Delta day tour. Placeholder pricing â€” confirm before quoting.',
        inclusions: ['Round-trip economy airfare', '3 nights hotel with breakfast', 'Airport transfers', 'Mekong Delta day tour'],
        exclusions: ['Travel tax and terminal fees', 'Personal expenses', 'Tips', 'Travel insurance']
      }
    ];
    let seeded = 0;
    placeholders.forEach((template) => {
      const result = this.createTemplate(Object.assign({ expo_tag: tag }, template), actor || 'SYSTEM_EXPO_SEED');
      if (result.ok) seeded += 1;
    });
    return { seeded: true, seeded_count: seeded, expo_tag: tag };
  }

  // ---------------------------------------------------------- quotes

  createQuote(input, actor) {
    try {
      const value = input || {};
      const lead = this.runtime.get('ExpoLead', requireValue(value.expo_lead_id, 'expo_lead_id'));
      if (TERMINAL_LEAD_STATUSES.includes(lead.status)) {
        throw new WmitError('LEAD_STATUS_FINAL', 'This lead already reached a final status (' + lead.status + ') and cannot be quoted.', { current: lead.status });
      }
      const optionsInput = Array.isArray(value.options) ? value.options : [];
      if (optionsInput.length < 1 || optionsInput.length > 5) throw new WmitError('QUOTE_OPTIONS_INVALID', 'Pick 1-5 package options for the quotation.', { options: optionsInput.length });
      // Templates from the lead's own expo only — cross-expo quoting would
      // leak old prices into a new event.
      const templates = new Map(this.listTemplates({ include_archived: true, expo_tag: lead.expo_tag }).map((template) => [template.expo_package_template_id, template]));
      const options = optionsInput.map((optionInput, index) => {
        const option = optionInput || {};
        let base = null;
        if (option.template_id) {
          base = templates.get(String(option.template_id));
          if (!base) throw new WmitError('TEMPLATE_NOT_FOUND', 'Option ' + (index + 1) + ': package template was not found.', { template_id: option.template_id });
          if (base.status === 'ARCHIVED') throw new WmitError('TEMPLATE_ARCHIVED', 'Option ' + (index + 1) + ': that package template is archived.', { template_id: option.template_id });
        }
        const name = requireValue(option.name || (base && base.name), 'options[' + index + '].name');
        const destination = requireValue(option.destination || (base && base.destination), 'options[' + index + '].destination');
        const currency = String(option.currency || (base && base.currency) || 'PHP').toUpperCase();
        const price = normalizeMoney(requireValue(option.price_per_person !== undefined ? option.price_per_person : (base && base.price_per_person), 'options[' + index + '].price_per_person'), 'options[' + index + '].price_per_person');
        if (toMinorUnits(price) <= 0n) throw new WmitError('INVALID_MONEY', 'Option ' + (index + 1) + ': price must be greater than zero.');
        const durationDays = Number(option.duration_days !== undefined ? option.duration_days : (base && base.duration_days));
        if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 60) throw new WmitError('DURATION_INVALID', 'Option ' + (index + 1) + ': duration must be 1-60 days.');
        return {
          option_id: 'OPT-' + (index + 1),
          template_id: base ? base.expo_package_template_id : null,
          name,
          destination,
          duration_days: durationDays,
          price_per_person: price,
          currency,
          inclusions: option.inclusions !== undefined ? this.toStringList(option.inclusions, 'inclusions') : clone((base && base.inclusions) || []),
          exclusions: option.exclusions !== undefined ? this.toStringList(option.exclusions, 'exclusions') : clone((base && base.exclusions) || []),
          notes: option.notes ? String(option.notes).slice(0, 300) : null
        };
      });
      const quotationDate = this.now().slice(0, 10);
      const validUntil = value.valid_until || dateOnlyPlusDays(this.now(), 14);
      if (String(validUntil) < quotationDate) throw new WmitError('VALID_UNTIL_INVALID', 'Valid-until date cannot be in the past.', { valid_until: validUntil, quotation_date: quotationDate });
      const created = this.runtime.createRecord('ExpoQuote', {
        expo_lead_id: lead.expo_lead_id,
        lead_snapshot: { name: lead.name, mobile: lead.mobile, email: lead.email || null, destination: lead.destination, travel_month: lead.travel_month, pax_count: lead.pax_count, adults: lead.adults !== undefined ? lead.adults : null, children: lead.children !== undefined ? lead.children : null, duration_days: lead.duration_days !== undefined ? lead.duration_days : null, hotel_stars: lead.hotel_stars !== undefined ? lead.hotel_stars : null, meal_plan: lead.meal_plan || null },
        options,
        quotation_date: quotationDate,
        valid_until: validUntil,
        status: 'DRAFT',
        public_token_hash: null,
        sent_at: null,
        sent_to_email: null,
        delivery: null,
        accepted_at: null,
        accepted_by: null,
        accepted_option_id: null,
        declined_at: null,
        declined_reason: null,
        booking_id: null,
        expo_tag: lead.expo_tag,
        idempotency_key: value.idempotency_key || null
      }, this.ctx(actor || this.actor));
      return created;
    } catch (error) {
      return fail(error);
    }
  }

  listQuotes(filters) {
    const value = filters || {};
    const scopeTag = value.expo_tag ? String(value.expo_tag).toUpperCase() : null;
    let quotes = this.runtime.list('ExpoQuote', (quote) => scopeTag ? quote.expo_tag === scopeTag : quote.expo_tag === EXPO_TAG);
    if (value.expo_lead_id) quotes = quotes.filter((quote) => quote.expo_lead_id === value.expo_lead_id);
    if (value.status) quotes = quotes.filter((quote) => quote.status === value.status);
    return quotes.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }

  quoteUrl(token) { return this.baseUrl() + '/q/' + encodeURIComponent(token); }

  // Issues (or re-issues) the public link token for a quote. The raw token
  // is returned exactly once; only its SHA-256 hash is stored.
  issueQuoteToken(expoQuote, actor) {
    const token = crypto.randomBytes(24).toString('hex');
    const updated = this.runtime.updateRecord('ExpoQuote', expoQuote.expo_quote_id, {
      public_token_hash: tokenHash(token),
      public_token_issued_at: this.now()
    }, this.ctx(actor || this.actor));
    if (!updated.ok) return updated;
    return ok({ token, url: this.quoteUrl(token) });
  }


  async sendQuoteEmailAsync(input, actor) {
    const prepared = this.prepareQuoteEmail(input, actor);
    if (!prepared.ok) return prepared;
    const { quote, email, text, html } = prepared.data;
    let deliveryRecord;
    try {
      const delivery = await this.mailer.send({ to: email, subject: 'Your Worldmaster travel quotation', text, html });
      deliveryRecord = { mode: delivery.mode, sent: delivery.sent, path: delivery.path || null, sent_at: this.now() };
    } catch (error) {
      return fail(new WmitError('MAIL_SEND_FAILED', 'The quotation email could not be sent: ' + error.message, { expo_quote_id: quote.expo_quote_id }));
    }
    const updated = this.runtime.updateRecord('ExpoQuote', quote.expo_quote_id, {
      status: 'SENT',
      sent_at: this.now(),
      sent_to_email: email,
      delivery: deliveryRecord,
      resend_count: Number(quote.resend_count || 0) + (quote.status === 'SENT' ? 1 : 0)
    }, this.ctx(actor || this.actor));
    if (!updated.ok) return updated;
    this.markLeadProgress(quote.expo_lead_id, 'QUOTED', actor);
    return ok({
      expo_quote_id: quote.expo_quote_id,
      url: prepared.data.url,
      whatsapp_url: quote.lead_snapshot && quote.lead_snapshot.mobile ? waLink(quote.lead_snapshot.mobile, this.quoteMessage(quote, prepared.data.url)) : null,
      email,
      delivery: deliveryRecord
    }, { action: 'EXPO_SEND_QUOTE_EMAIL' });
  }

  prepareQuoteEmail(input, actor) {
    try {
      const value = input || {};
      if (!this.mailer) throw new WmitError('MAILER_UNAVAILABLE', 'The mailer is not configured on this server.');
      const quote = this.runtime.get('ExpoQuote', requireValue(value.expo_quote_id, 'expo_quote_id'));
      if (['ACCEPTED', 'DECLINED', 'BOOKED'].includes(quote.status)) {
        throw new WmitError('QUOTE_STATUS_FINAL', 'This quotation was already ' + quote.status.toLowerCase() + ' and cannot be re-sent.');
      }
      const email = String(value.email || quote.lead_snapshot && quote.lead_snapshot.email || '').trim().toLowerCase();
      if (!EMAIL_PATTERN.test(email)) throw new WmitError('EMAIL_REQUIRED', 'A valid email address is required to send the quotation.', { email: email.slice(0, 80) });
      const issued = this.issueQuoteToken(quote, actor);
      if (!issued.ok) return issued;
      const leadName = (quote.lead_snapshot && quote.lead_snapshot.name) || 'Traveller';
      const url = issued.data.url;
      const optionLines = quote.options.map((option, index) => (index + 1) + '. ' + option.name + ' â€” ' + option.duration_days + ' days, ' + option.price_per_person + ' ' + option.currency + ' per person').join('\n');
      const text = [
        'Hi ' + firstName(leadName) + ',',
        '',
        'Thank you for visiting Worldmaster International Travel at the expo. Here is your quotation:',
        '',
        optionLines,
        '',
        'Open your full quotation here: ' + url,
        'The quotation is valid until ' + quote.valid_until + '. You can reply to this email or message us on WhatsApp/Viber with questions.',
        '',
        'Worldmaster International Travel'
      ].join('\r\n');
      const optionRows = quote.options.map((option) => '<tr><td style="padding:8px 12px;border-bottom:1px solid #dce3ea;"><b>' + escapeHtml(option.name) + '</b><br><span style="color:#637083;font-size:12px;">' + escapeHtml(option.destination) + ' Â· ' + escapeHtml(String(option.duration_days)) + ' days</span></td><td style="padding:8px 12px;border-bottom:1px solid #dce3ea;text-align:right;white-space:nowrap;"><b>' + escapeHtml(option.price_per_person) + ' ' + escapeHtml(option.currency) + '</b><br><span style="color:#637083;font-size:12px;">per person</span></td></tr>').join('');
      const html = [
        '<div style="font-family:system-ui,Segoe UI,sans-serif;max-width:560px;margin:0 auto;color:#17212b;">',
        '<div style="background:#102a43;color:#fff;padding:18px 22px;border-radius:10px 10px 0 0;"><div style="font-size:19px;font-weight:800;letter-spacing:.08em;">WORLDMASTER</div><div style="font-size:11px;letter-spacing:.12em;color:#a9c4dd;">INTERNATIONAL TRAVEL</div></div>',
        '<div style="border:1px solid #dce3ea;border-top:0;border-radius:0 0 10px 10px;padding:22px;">',
        '<p>Hi ' + escapeHtml(firstName(leadName)) + ',</p>',
        '<p>Thank you for visiting us at the expo. Here is a summary of your travel options:</p>',
        '<table style="width:100%;border-collapse:collapse;font-size:14px;">' + optionRows + '</table>',
        '<p style="margin:22px 0;"><a href="' + escapeHtml(url) + '" style="background:#1264a3;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:6px;display:inline-block;">Open your quotation</a></p>',
        '<p style="color:#637083;font-size:13px;">Valid until ' + escapeHtml(quote.valid_until) + '. Reply to this email or message us on WhatsApp or Viber with any question.</p>',
        '<p style="margin-bottom:0;">Worldmaster International Travel</p>',
        '</div></div>'
      ].join('');
      return ok({ quote, email, url, text, html });
    } catch (error) {
      return fail(error);
    }
  }

  quoteMessage(quote, url) {
    const leadName = (quote.lead_snapshot && quote.lead_snapshot.name) || 'there';
    return 'Hi ' + firstName(leadName) + '! Here is your Worldmaster travel quotation: ' + url;
  }

  markLeadProgress(expoLeadId, status, actor) {
    const lead = this.runtime.repos.ExpoLead.get(expoLeadId);
    if (!lead) return;
    if (TERMINAL_LEAD_STATUSES.includes(lead.status)) return;
    if (LEAD_STATUSES.indexOf(lead.status) >= LEAD_STATUSES.indexOf(status)) return; // never move a lead backwards
    this.runtime.updateRecord('ExpoLead', expoLeadId, { status }, this.ctx(actor || this.actor));
  }

  getQuoteLink(input, actor) {
    try {
      const quote = this.runtime.get('ExpoQuote', requireValue(input && input.expo_quote_id, 'expo_quote_id'));
      if (['ACCEPTED', 'DECLINED', 'BOOKED'].includes(quote.status)) {
        throw new WmitError('QUOTE_STATUS_FINAL', 'This quotation was already ' + quote.status.toLowerCase() + '; issue a new quotation instead.');
      }
      const issued = this.issueQuoteToken(quote, actor);
      if (!issued.ok) return issued;
      return ok({
        expo_quote_id: quote.expo_quote_id,
        url: issued.data.url,
        whatsapp_url: quote.lead_snapshot && quote.lead_snapshot.mobile ? waLink(quote.lead_snapshot.mobile, this.quoteMessage(quote, issued.data.url)) : null,
        viber_url: viberLink((quote.lead_snapshot && quote.lead_snapshot.mobile) || '')
      }, { action: 'EXPO_GET_QUOTE_LINK' });
    } catch (error) {
      return fail(error);
    }
  }

  findQuoteByToken(token) {
    const hash = tokenHash(String(token || ''));
    return this.runtime.list('ExpoQuote', (quote) => quote.public_token_hash === hash)[0] || null;
  }

  getPublicQuote(token) {
    try {
      const value = String(requireValue(token, 'token'));
      if (!/^[a-f0-9]{48}$/.test(value)) throw new WmitError('TOKEN_INVALID', 'This quotation link is invalid.');
      const quote = this.findQuoteByToken(value);
      if (!quote) throw new WmitError('QUOTATION_NOT_FOUND', 'This quotation link is invalid or has expired.');
      const today = this.now().slice(0, 10);
      return ok({
        expo: EXPO_NAME,
        quotation_id: quote.expo_quote_id,
        quotation_date: quote.quotation_date,
        valid_until: quote.valid_until,
        expired: Boolean(quote.status === 'EXPIRED' || (quote.status === 'SENT' && String(quote.valid_until) < today)),
        status: quote.status,
        traveller_first_name: firstName(quote.lead_snapshot && quote.lead_snapshot.name),
        pax_count: (quote.lead_snapshot && quote.lead_snapshot.pax_count) || null,
        options: quote.options.map((option) => ({
          option_id: option.option_id,
          name: option.name,
          destination: option.destination,
          duration_days: option.duration_days,
          price_per_person: option.price_per_person,
          currency: option.currency,
          inclusions: option.inclusions,
          exclusions: option.exclusions,
          notes: option.notes
        })),
        accepted_option_id: quote.accepted_option_id || null
      });
    } catch (error) {
      return fail(error);
    }
  }

  acceptQuote(token, input) {
    try {
      const value = input || {};
      const raw = String(requireValue(token, 'token'));
      if (!/^[a-f0-9]{48}$/.test(raw)) throw new WmitError('TOKEN_INVALID', 'This quotation link is invalid.');
      const quote = this.findQuoteByToken(raw);
      if (!quote) throw new WmitError('QUOTATION_NOT_FOUND', 'This quotation link is invalid or has expired.');
      // Idempotent replays stay free: resolve the quote first and only rate
      // limit the state-changing path (Apps Script public-channel rule).
      if (quote.status === 'ACCEPTED' || quote.status === 'BOOKED') return ok({ quotation_id: quote.expo_quote_id, status: quote.status }, { action: 'EXPO_ACCEPT_QUOTE', idempotent: true });
      if (!this.publicActionLimiter.check('ACCEPT:' + String(token || '').slice(-12))) {
        throw new WmitError('RATE_LIMITED', 'Too many attempts. Please wait half a minute and try again.');
      }
      if (quote.status !== 'SENT') throw new WmitError('QUOTATION_NOT_ACCEPTABLE', 'This quotation cannot be accepted in its current state (' + quote.status + ').');
      const acceptedBy = requireValue(value.accepted_by, 'accepted_by');
      if (acceptedBy.length > 80) throw new WmitError('NAME_TOO_LONG', 'Name must be 80 characters or fewer.');
      const optionId = value.option_id !== undefined && value.option_id !== null && value.option_id !== '' ? String(value.option_id) : quote.options[0].option_id;
      const option = quote.options.find((candidate) => candidate.option_id === optionId);
      if (!option) throw new WmitError('OPTION_NOT_FOUND', 'The selected package option was not found on this quotation.', { option_id: optionId });
      const today = this.now().slice(0, 10);
      if (String(quote.valid_until) < today) throw new WmitError('QUOTATION_EXPIRED', 'This quotation expired on ' + quote.valid_until + '. Contact us and we will send a fresh one.');
      const updated = this.runtime.updateRecord('ExpoQuote', quote.expo_quote_id, {
        status: 'ACCEPTED',
        accepted_at: this.now(),
        accepted_by: acceptedBy,
        accepted_option_id: option.option_id
      }, this.ctx('PUBLIC_EXPO_CLIENT'));
      if (!updated.ok) return updated;
      this.markLeadProgress(quote.expo_lead_id, 'ACCEPTED', 'PUBLIC_EXPO_CLIENT');
      this.publicActionLimiter.consume('ACCEPT:' + raw.slice(-12));
      return ok({ quotation_id: quote.expo_quote_id, status: 'ACCEPTED', accepted_option: option.name }, { action: 'EXPO_ACCEPT_QUOTE' });
    } catch (error) {
      return fail(error);
    }
  }

  declineQuote(token, input) {
    try {
      const value = input || {};
      const raw = String(requireValue(token, 'token'));
      if (!/^[a-f0-9]{48}$/.test(raw)) throw new WmitError('TOKEN_INVALID', 'This quotation link is invalid.');
      const quote = this.findQuoteByToken(raw);
      if (!quote) throw new WmitError('QUOTATION_NOT_FOUND', 'This quotation link is invalid or has expired.');
      // Idempotent replays stay free (see acceptQuote).
      if (quote.status === 'DECLINED') return ok({ quotation_id: quote.expo_quote_id, status: 'DECLINED' }, { action: 'EXPO_DECLINE_QUOTE', idempotent: true });
      if (!this.publicActionLimiter.check('DECLINE:' + String(token || '').slice(-12))) {
        throw new WmitError('RATE_LIMITED', 'Too many attempts. Please wait half a minute and try again.');
      }
      if (quote.status !== 'SENT') throw new WmitError('QUOTATION_NOT_DECLINABLE', 'This quotation cannot be declined in its current state (' + quote.status + ').');
      const updated = this.runtime.updateRecord('ExpoQuote', quote.expo_quote_id, {
        status: 'DECLINED',
        declined_at: this.now(),
        declined_reason: value.reason ? String(value.reason).slice(0, 300) : null
      }, this.ctx('PUBLIC_EXPO_CLIENT'));
      if (!updated.ok) return updated;
      this.publicActionLimiter.consume('DECLINE:' + raw.slice(-12));
      return ok({ quotation_id: quote.expo_quote_id, status: 'DECLINED' }, { action: 'EXPO_DECLINE_QUOTE' });
    } catch (error) {
      return fail(error);
    }
  }

  markBooked(input, actor) {
    try {
      const value = input || {};
      const quote = this.runtime.get('ExpoQuote', requireValue(value.expo_quote_id, 'expo_quote_id'));
      if (quote.status === 'BOOKED') return ok(quote, { action: 'EXPO_MARK_BOOKED', idempotent: true });
      if (quote.status !== 'ACCEPTED') throw new WmitError('ACCEPTANCE_REQUIRED', 'Only an accepted quotation can be marked as booked. Record the client acceptance first.', { current: quote.status });
      const bookingId = requireValue(value.booking_id, 'booking_id');
      this.runtime.get('Booking', bookingId); // validates the linked booking exists
      const updated = this.runtime.updateRecord('ExpoQuote', quote.expo_quote_id, { status: 'BOOKED', booking_id: bookingId, booked_at: this.now() }, this.ctx(actor || this.actor));
      if (!updated.ok) return updated;
      this.runtime.updateRecord('ExpoLead', quote.expo_lead_id, { status: 'BOOKED', booking_id: bookingId }, this.ctx(actor || this.actor));
      this.cancelOpenFollowUps(quote.expo_lead_id, actor, 'Lead booked. Congratulations!');
      return ok(updated.data, { action: 'EXPO_MARK_BOOKED' });
    } catch (error) {
      return fail(error);
    }
  }

  // ---------------------------------------------------------- dashboard

  dashboard(filters) {
    const value = filters || {};
    // No explicit scope = the current expo only (the kiosk default).
    const scopeTag = value.expo_tag ? String(value.expo_tag).toUpperCase() : this.currentExpo().expo_tag;
    const leads = this.listLeads({ expo_tag: scopeTag });
    const quotes = this.listQuotes({ expo_tag: scopeTag });
    const event = this.expoByTag(scopeTag);
    const today = this.now().slice(0, 10);
    const sentQuotes = quotes.filter((quote) => quote.sent_at);
    const acceptedQuotes = quotes.filter((quote) => ['ACCEPTED', 'BOOKED'].includes(quote.status));
    const bookedQuotes = quotes.filter((quote) => quote.status === 'BOOKED');
    const bookingsById = new Map(this.runtime.list('Booking').map((booking) => [booking.booking_id, booking]));
    let revenueMinor = 0n;
    const revenueByCurrency = {};
    bookedQuotes.forEach((quote) => {
      const booking = quote.booking_id ? bookingsById.get(quote.booking_id) : null;
      if (!booking) return;
      const currency = booking.currency || 'PHP';
      revenueByCurrency[currency] = (revenueByCurrency[currency] || 0n) + toMinorUnits(booking.client_total || 0);
      if (currency === 'PHP') revenueMinor += toMinorUnits(booking.client_total || 0);
    });

    const byDay = {};
    leads.forEach((lead) => {
      const day = String(lead.created_at).slice(0, 10);
      byDay[day] = byDay[day] || { leads: 0, quotes_sent: 0, accepted: 0, booked: 0 };
      byDay[day].leads += 1;
    });
    sentQuotes.forEach((quote) => {
      const day = String(quote.sent_at).slice(0, 10);
      byDay[day] = byDay[day] || { leads: 0, quotes_sent: 0, accepted: 0, booked: 0 };
      byDay[day].quotes_sent += 1;
    });
    acceptedQuotes.forEach((quote) => {
      const day = String(quote.accepted_at || quote.sent_at || quote.created_at).slice(0, 10);
      byDay[day] = byDay[day] || { leads: 0, quotes_sent: 0, accepted: 0, booked: 0 };
      byDay[day].accepted += 1;
    });
    bookedQuotes.forEach((quote) => {
      const day = String(quote.booked_at || quote.accepted_at || quote.sent_at || quote.created_at).slice(0, 10);
      byDay[day] = byDay[day] || { leads: 0, quotes_sent: 0, accepted: 0, booked: 0 };
      byDay[day].booked += 1;
    });

    const byPackage = {};
    quotes.forEach((quote) => {
      const sent = Boolean(quote.sent_at);
      const accepted = ['ACCEPTED', 'BOOKED'].includes(quote.status);
      const chosen = accepted ? quote.accepted_option_id : null;
      quote.options.forEach((option) => {
        const key = option.name + ' Â· ' + option.destination;
        byPackage[key] = byPackage[key] || { offered: 0, sent: 0, accepted: 0 };
        byPackage[key].offered += 1;
        if (sent) byPackage[key].sent += 1;
        if (chosen && chosen === option.option_id) byPackage[key].accepted += 1;
      });
    });

    const percent = (part, whole) => whole ? Math.round((part / whole) * 1000) / 10 : 0;
    return ok({
      expo_tag: scopeTag,
      expo_name: event ? event.name : null,
      expo_dates: event ? { start: event.start_date || null, end: event.end_date || null, status: event.status } : null,
      generated_at: this.now(),
      funnel: {
        leads: leads.length,
        contacted: leads.filter((lead) => ['CONTACTED', 'QUOTED', 'ACCEPTED', 'BOOKED'].includes(lead.status)).length,
        quotes_sent: sentQuotes.length,
        accepted: acceptedQuotes.length,
        booked: bookedQuotes.length,
        lost: leads.filter((lead) => ['LOST', 'UNREACHABLE'].includes(lead.status)).length
      },
      conversion: {
        lead_to_quote_percent: percent(sentQuotes.length, leads.length),
        quote_to_accept_percent: percent(acceptedQuotes.length, sentQuotes.length),
        accept_to_book_percent: percent(bookedQuotes.length, acceptedQuotes.length),
        lead_to_book_percent: percent(bookedQuotes.length, leads.length)
      },
      revenue: {
        php_total: fromMinorUnits(revenueMinor),
        by_currency: Object.keys(revenueByCurrency).reduce((carry, currency) => Object.assign(carry, { [currency]: fromMinorUnits(revenueByCurrency[currency]) }), {})
      },
      by_day: Object.keys(byDay).sort().map((day) => Object.assign({ day }, byDay[day])),
      by_package: Object.keys(byPackage).sort().map((name) => Object.assign({ package: name }, byPackage[name])),
      follow_ups: { open: this.runtime.list('Task', (task) => task.source === 'EXPO_FOLLOW_UP' && (!scopeTag || task.expo_tag === scopeTag) && ['OPEN', 'IN_PROGRESS', 'BLOCKED'].includes(task.state)).length },
      today: today
    }, { action: 'EXPO_DASHBOARD', read_only: true });
  }
}

function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

module.exports = { ExpoService, EXPO_TAG, EXPO_NAME, LEAD_STATUSES, QUOTE_STATUSES, normalizeMobile, waLink, viberLink, escapeHtml };
