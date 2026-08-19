'use strict';

// WMIT travel-search adapter boundary (roadmap Phase 13): the manual quote
// provider. In the real agency workflow, package quotes arrive from
// wholesalers, DMCs, and consolidators by email, chat, or portal export,
// and staff transcribe them here. This provider is deliberately NOT live:
// every result is labeled meta.live = false and starts verified = false
// until a staff member confirms the quote against the supplier source.
//
// Persistence is an injected store (in-memory Map by default) so the later
// wiring wave can attach SQLite without touching this file; the store
// contract is documented in docs/travel-search.md. Money is stored as
// integer minor units (centavos) with a three-letter currency code, mirroring
// src/core/money. IDs come from the runtime's central ID generator and every
// meaningful action (add, duplicate, verify, failure) is audited through the
// runtime audit log.

const { WmitError, errorResult } = require('../core/errors');

const MANUAL_QUOTE_SOURCE_ID = 'MANUAL_QUOTE';
const MANUAL_QUOTE_SOURCE_LABEL = 'Manual supplier quotes (staff-entered)';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const MAX_SAFE_MINOR = 9007199254740991n; // Number.MAX_SAFE_INTEGER as BigInt

function ok(data, meta) { return { ok: true, data, meta: meta || {} }; }
function fail(error) { return errorResult(error); }

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function requireValue(value, field) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new WmitError('REQUIRED_FIELD', field + ' is required.', { field });
  }
  return String(value).trim();
}

function sameText(a, b) {
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

function isRealDateOnly(text) {
  if (!DATE_PATTERN.test(text)) return false;
  return new Date(text + 'T00:00:00Z').toISOString().slice(0, 10) === text;
}

function normalizeDateOnly(value, field, code) {
  const text = requireValue(value, field);
  if (!isRealDateOnly(text)) {
    throw new WmitError(code, field + ' must be a real calendar date in YYYY-MM-DD form.', { field, value: text.slice(0, 20) });
  }
  return text;
}

function normalizeMinorUnits(value, field) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new WmitError('PRICE_INVALID', field + ' is required as an integer amount of minor units (for example 1850000 for PHP 18,500.00).', { field });
  }
  let minor;
  try {
    minor = typeof value === 'bigint' ? value : BigInt(String(value).trim());
  } catch (_) {
    throw new WmitError('PRICE_INVALID', field + ' must be an integer amount of minor units; decimals and text are rejected.', { field, value: String(value).slice(0, 40) });
  }
  if (minor <= 0n) throw new WmitError('PRICE_INVALID', field + ' must be greater than zero.', { field, value: String(value).slice(0, 40) });
  if (minor > MAX_SAFE_MINOR) throw new WmitError('PRICE_INVALID', field + ' is too large.', { field });
  return Number(minor);
}

function normalizeCurrency(value) {
  const currency = String(value === undefined || value === null ? '' : value).trim().toUpperCase();
  if (!CURRENCY_PATTERN.test(currency)) {
    throw new WmitError('CURRENCY_INVALID', 'Currency must be a three-letter code such as PHP or USD.', { currency: String(value === undefined || value === null ? '' : value).slice(0, 10) });
  }
  return currency;
}

function contextOf(context, fallbackActor) {
  const input = context || {};
  return {
    actor: input.actor || fallbackActor,
    agent: input.agent || null,
    correlationId: input.correlationId || input.correlation_id || null
  };
}

function destinationMatches(recordDestination, wanted) {
  const have = String(recordDestination || '').trim().toLowerCase();
  const needle = String(wanted || '').trim().toLowerCase();
  return have === needle || have.includes(needle) || needle.includes(have);
}

function overlapsWindow(record, from, until) {
  return record.valid_from <= until && record.valid_until >= from;
}

// Pluggable persistence interface for the later wiring wave. A custom store
// must implement insert(record), get(id) -> record|null, update(id, changes)
// -> record|null, and list() -> [records], all with plain JSON-safe records
// keyed by manual_quote_id. The default keeps everything in a Map.
function createInMemoryManualQuoteStore() {
  const records = new Map();
  return {
    insert(record) {
      records.set(record.manual_quote_id, clone(record));
      return clone(record);
    },
    get(id) {
      const record = records.get(id);
      return record ? clone(record) : null;
    },
    update(id, changes) {
      const record = records.get(id);
      if (!record) return null;
      const next = Object.assign({}, record, changes);
      records.set(id, next);
      return clone(next);
    },
    list() { return Array.from(records.values()).map(clone); }
  };
}

function createManualQuoteProvider(options) {
  const opts = options || {};
  const runtime = opts.runtime;
  if (!runtime) throw new WmitError('RUNTIME_REQUIRED', 'The manual quote provider needs the runtime for centrally generated IDs and the audit log.');
  const store = opts.store || createInMemoryManualQuoteStore();
  const clock = opts.clock || (() => runtime.clock());
  const defaultActor = opts.actor || 'TRAVEL_SEARCH';

  const now = () => clock().toISOString();
  const today = () => now().slice(0, 10);

  function audit(action, record, ctx, result, details) {
    runtime.auditLog.record({
      actor: ctx.actor,
      agent: ctx.agent,
      action,
      entity_type: 'ManualQuote',
      entity_id: record ? record.manual_quote_id : null,
      result: result || 'SUCCESS',
      details: details || {},
      correlation_id: ctx.correlationId
    });
  }

  // Failure audit is best effort and must never mask the original error,
  // mirroring the runtime's auditFailure behavior.
  function auditFailure(action, error, ctx) {
    try {
      audit(action, null, ctx, 'FAILURE', {
        operation: action,
        error_code: error && error.code ? error.code : 'UNEXPECTED_ERROR',
        error_message: error && error.message ? String(error.message).slice(0, 300) : null
      });
    } catch (_) { /* ignored by design */ }
  }

  function toResult(record) {
    return {
      source: MANUAL_QUOTE_SOURCE_ID,
      provider: MANUAL_QUOTE_SOURCE_LABEL,
      supplier: record.supplier_name,
      title: record.title,
      description: record.description || null,
      price: { amountMinor: record.price_minor, currency: record.currency },
      valid_from: record.valid_from,
      valid_until: record.valid_until,
      entered_by: record.entered_by,
      entered_at: record.entered_at,
      verified: Boolean(record.verified),
      verified_at: record.verified_at || null,
      verified_by: record.verified_by || null,
      ref: record.supplier_ref || record.manual_quote_id,
      manual_quote_id: record.manual_quote_id,
      meta: { live: false }
    };
  }

  function isDuplicate(existing, candidate) {
    return sameText(existing.supplier_name, candidate.supplierName)
      && sameText(existing.destination, candidate.destination)
      && existing.price_minor === candidate.priceMinor
      && existing.currency === candidate.currency
      && overlapsWindow(existing, candidate.validFrom, candidate.validUntil);
  }

  // Staff transcribe a quote that arrived from a wholesaler, DMC, or other
  // supplier. Everything is validated before any write; a re-entry of the
  // same quote (same supplier + destination + price + overlapping validity
  // window) replays the original record instead of creating a duplicate.
  function addManualQuote(input, context) {
    let ctx = null;
    try {
      const value = input || {};
      ctx = contextOf(context, defaultActor);
      const supplierName = requireValue(value.supplier_name, 'supplier_name').slice(0, 120);
      const destination = requireValue(value.destination, 'destination').slice(0, 120);
      const origin = value.origin ? String(value.origin).trim().slice(0, 120) : null;
      const title = value.title ? String(value.title).trim().slice(0, 200) : (supplierName + ' - ' + destination);
      const description = value.description ? String(value.description).trim().slice(0, 500) : null;
      const notes = value.notes ? String(value.notes).trim().slice(0, 500) : null;
      const supplierRef = value.supplier_ref ? String(value.supplier_ref).trim().slice(0, 80) : null;
      const priceMinor = normalizeMinorUnits(value.price_minor, 'price_minor');
      const currency = normalizeCurrency(value.currency);
      const validFrom = normalizeDateOnly(value.valid_from, 'valid_from', 'VALIDITY_DATE_INVALID');
      const validUntil = normalizeDateOnly(value.valid_until, 'valid_until', 'VALIDITY_DATE_INVALID');
      if (validUntil < validFrom) {
        throw new WmitError('VALIDITY_RANGE_INVALID', 'valid_until cannot be before valid_from.', { valid_from: validFrom, valid_until: validUntil });
      }

      const duplicate = store.list().find((existing) => isDuplicate(existing, { supplierName, destination, priceMinor, currency, validFrom, validUntil }));
      if (duplicate) {
        audit('MANUAL_QUOTE_DUPLICATE', duplicate, ctx, 'SUCCESS', {
          duplicate_of: duplicate.manual_quote_id,
          supplier_name: supplierName,
          destination,
          price_minor: priceMinor,
          currency
        });
        return ok(clone(duplicate), { action: 'MANUAL_QUOTE_DUPLICATE', idempotent: true, duplicate_of: duplicate.manual_quote_id });
      }

      const timestamp = now();
      const record = {
        manual_quote_id: runtime.idGenerator.next(MANUAL_QUOTE_SOURCE_ID, { yearBased: true }),
        supplier_name: supplierName,
        destination,
        origin,
        title,
        description,
        notes,
        supplier_ref: supplierRef,
        price_minor: priceMinor,
        currency,
        valid_from: validFrom,
        valid_until: validUntil,
        entered_by: ctx.actor,
        entered_at: timestamp,
        verified: false,
        verified_at: null,
        verified_by: null,
        created_at: timestamp,
        created_by: ctx.actor,
        updated_at: timestamp,
        updated_by: ctx.actor
      };
      const saved = store.insert(record);
      audit('MANUAL_QUOTE_ADD', saved, ctx, 'SUCCESS', {
        supplier_name: supplierName,
        destination,
        origin,
        price_minor: priceMinor,
        currency,
        valid_from: validFrom,
        valid_until: validUntil,
        verified: false
      });
      return ok(clone(saved), { action: 'MANUAL_QUOTE_ADD' });
    } catch (error) {
      if (ctx) auditFailure('MANUAL_QUOTE_ADD', error, ctx);
      return fail(error);
    }
  }

  function listQuotes(filters) {
    const value = filters || {};
    const supplier = value.supplier_name ? String(value.supplier_name).trim() : null;
    const destination = value.destination ? String(value.destination).trim() : null;
    const currentDay = today();
    return store.list()
      .filter((record) => (!supplier || sameText(record.supplier_name, supplier)) && (!destination || destinationMatches(record.destination, destination)))
      .map((record) => Object.assign(clone(record), { expired: record.valid_until < currentDay }))
      .sort((a, b) => String(b.entered_at).localeCompare(String(a.entered_at)));
  }

  function getQuote(manualQuoteId) {
    return store.get(requireValue(manualQuoteId, 'manual_quote_id'));
  }

  // Provider side of the shared search contract. Returns an array of result
  // objects; the registry service re-validates and labels them. With travel
  // dates the quote's validity window must overlap the stay; without dates
  // only quotes whose window has already fully expired are dropped, so a
  // date-less search surfaces current and upcoming prices but never a stale
  // one. An explicit historical date is still a legitimate lookup into a
  // closed window.
  function search(query) {
    const value = query || {};
    const destination = requireValue(value.destination, 'destination');
    if (value.depart_date !== undefined && value.depart_date !== null && value.depart_date !== '' && !isRealDateOnly(String(value.depart_date))) {
      throw new WmitError('TRAVEL_DATE_INVALID', 'depart_date must be a real calendar date in YYYY-MM-DD form.', { field: 'depart_date' });
    }
    if (value.return_date !== undefined && value.return_date !== null && value.return_date !== '' && !isRealDateOnly(String(value.return_date))) {
      throw new WmitError('TRAVEL_DATE_INVALID', 'return_date must be a real calendar date in YYYY-MM-DD form.', { field: 'return_date' });
    }
    if (value.depart_date && value.return_date && String(value.return_date) < String(value.depart_date)) {
      throw new WmitError('TRAVEL_DATE_RANGE_INVALID', 'return_date cannot be before depart_date.', { depart_date: value.depart_date, return_date: value.return_date });
    }
    const currency = value.currency ? normalizeCurrency(value.currency) : null;
    const departStart = value.depart_date ? String(value.depart_date) : null;
    const returnEnd = value.return_date ? String(value.return_date) : departStart;
    const currentDay = today();
    return store.list()
      .filter((record) => {
        if (!destinationMatches(record.destination, destination)) return false;
        if (currency && record.currency !== currency) return false;
        if (value.origin && record.origin && !sameText(record.origin, value.origin)) return false;
        if (departStart) return overlapsWindow(record, departStart, returnEnd);
        return record.valid_until >= currentDay;
      })
      .sort((a, b) => a.currency.localeCompare(b.currency) || a.price_minor - b.price_minor || a.title.localeCompare(b.title))
      .map(toResult);
  }

  // A manual quote ref is the manual_quote_id, or a supplier reference when
  // it resolves to exactly one quote. Anything ambiguous fails closed.
  function resolveRef(ref) {
    const wanted = requireValue(ref, 'ref');
    const byId = store.get(wanted);
    if (byId) return byId;
    const bySupplierRef = store.list().filter((record) => record.supplier_ref && sameText(record.supplier_ref, wanted));
    if (bySupplierRef.length === 1) return bySupplierRef[0];
    if (bySupplierRef.length > 1) {
      throw new WmitError('MANUAL_QUOTE_AMBIGUOUS', 'That reference matches several manual quotes; verify using the manual_quote_id.', { ref: wanted.slice(0, 80), manual_quote_ids: bySupplierRef.map((record) => record.manual_quote_id) });
    }
    throw new WmitError('MANUAL_QUOTE_NOT_FOUND', 'No manual quote matches that reference.', { ref: wanted.slice(0, 80) });
  }

  // Staff verification: flips verified to true after checking the quote
  // against the supplier source. The flip is audited with old/new values.
  function verifyManualQuote(ref, context) {
    let ctx = null;
    try {
      ctx = contextOf(context, defaultActor);
      const record = resolveRef(ref);
      if (record.verified) return ok(clone(record), { action: 'MANUAL_QUOTE_VERIFY', idempotent: true });
      const timestamp = now();
      const updated = store.update(record.manual_quote_id, {
        verified: true,
        verified_at: timestamp,
        verified_by: ctx.actor,
        updated_at: timestamp,
        updated_by: ctx.actor
      });
      audit('MANUAL_QUOTE_VERIFY', updated, ctx, 'SUCCESS', {
        changedFields: ['verified', 'verified_at', 'verified_by'],
        old_values: { verified: record.verified, verified_at: record.verified_at, verified_by: record.verified_by },
        new_values: { verified: true, verified_at: timestamp, verified_by: ctx.actor }
      });
      return ok(clone(updated), { action: 'MANUAL_QUOTE_VERIFY' });
    } catch (error) {
      if (ctx) auditFailure('MANUAL_QUOTE_VERIFY', error, ctx);
      return fail(error);
    }
  }

  return {
    id: MANUAL_QUOTE_SOURCE_ID,
    label: MANUAL_QUOTE_SOURCE_LABEL,
    live: false,
    search,
    addManualQuote,
    listQuotes,
    getQuote,
    verifyManualQuote
  };
}

module.exports = {
  createManualQuoteProvider,
  createInMemoryManualQuoteStore,
  MANUAL_QUOTE_SOURCE_ID,
  MANUAL_QUOTE_SOURCE_LABEL
};
