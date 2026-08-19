'use strict';

// WMIT travel-search boundary (roadmap Phase 13): one registry, many
// providers, one honest contract. The service aggregates search results
// across registered providers and normalizes every result through the same
// contract: source, provider label, title/description, integer-minor-unit
// price with currency, validity window, entered_by/entered_at, verified
// flag, and ref.
//
// Results are untrusted by default (verified: false) and the boundary makes
// live: false the honest default - a provider result only carries
// meta.live = true when the provider itself was registered with live: true
// AND a provenance record naming the authorized source and when that access
// was verified. No such provider exists today; the manual quote provider is
// the only registered source and it is never live. See docs/travel-search.md.

const { WmitError, errorResult } = require('../core/errors');
const {
  createManualQuoteProvider,
  createInMemoryManualQuoteStore,
  MANUAL_QUOTE_SOURCE_ID
} = require('./manual-quote-provider');

const PROVIDER_ID_PATTERN = /^[A-Z][A-Z0-9_]{1,39}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TRAVELERS = 50;
const MAX_SAFE_MINOR = 9007199254740991n; // Number.MAX_SAFE_INTEGER as BigInt

function ok(data, meta) { return { ok: true, data, meta: meta || {} }; }
function fail(error) { return errorResult(error); }

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function isRealDateOnly(text) {
  if (!DATE_PATTERN.test(text)) return false;
  return new Date(text + 'T00:00:00Z').toISOString().slice(0, 10) === text;
}

function contextOf(context, fallbackActor) {
  const input = context || {};
  return {
    actor: input.actor || fallbackActor,
    agent: input.agent || null,
    correlationId: input.correlationId || input.correlation_id || null
  };
}

function createTravelSearchService(options) {
  const opts = options || {};
  const runtime = opts.runtime;
  if (!runtime) throw new WmitError('RUNTIME_REQUIRED', 'createTravelSearchService needs the runtime; providers audit and generate IDs through it.');
  const defaultActor = opts.actor || 'TRAVEL_SEARCH';
  const providers = new Map();

  // Registration is the single gate for the never-fake-live rule. A provider
  // descriptor is { id, label, search(query, context), live?, provenance? }.
  // Claiming live: true without a provenance record (authorized_source +
  // verified_at) is rejected outright.
  function registerProvider(provider) {
    const candidate = provider || {};
    const id = String(candidate.id === undefined || candidate.id === null ? '' : candidate.id).trim();
    if (!PROVIDER_ID_PATTERN.test(id)) {
      throw new WmitError('PROVIDER_INVALID', 'A provider id is required (uppercase letters, numbers, underscores; 2-40 characters).', { id });
    }
    if (!String(candidate.label || '').trim()) {
      throw new WmitError('PROVIDER_INVALID', 'A provider label is required so every result can name its source.', { id });
    }
    if (typeof candidate.search !== 'function') {
      throw new WmitError('PROVIDER_INVALID', 'A provider must implement search(query, context).', { id });
    }
    if (candidate.live === true) {
      const provenance = candidate.provenance || {};
      const authorizedSource = String(provenance.authorized_source || '').trim();
      const verifiedAt = String(provenance.verified_at || '').trim();
      if (!authorizedSource || !verifiedAt) {
        throw new WmitError('PROVIDER_LIVE_UNPROVEN', 'A provider may only claim live data with a provenance record naming the authorized source and when that access was verified. Simulated or unverified sources must stay live: false.', { id });
      }
    }
    if (providers.has(id)) throw new WmitError('PROVIDER_DUPLICATE', 'A provider with that id is already registered.', { id });
    providers.set(id, candidate);
    return id;
  }

  (Array.isArray(opts.providers) ? opts.providers : []).forEach(registerProvider);

  function listProviders() {
    return Array.from(providers.values()).map((provider) => ({
      id: provider.id,
      label: provider.label,
      live: provider.live === true,
      provenance: provider.provenance || null
    }));
  }

  function validateQuery(query) {
    const value = query || {};
    const destination = String(value.destination === undefined || value.destination === null ? '' : value.destination).trim();
    if (!destination) throw new WmitError('REQUIRED_FIELD', 'destination is required - WMIT sourcing is destination-first.', { field: 'destination' });
    ['depart_date', 'return_date'].forEach((field) => {
      if (value[field] === undefined || value[field] === null || value[field] === '') return;
      if (!isRealDateOnly(String(value[field]))) {
        throw new WmitError('TRAVEL_DATE_INVALID', field + ' must be a real calendar date in YYYY-MM-DD form.', { field, value: String(value[field]).slice(0, 20) });
      }
    });
    if (value.depart_date && value.return_date && String(value.return_date) < String(value.depart_date)) {
      throw new WmitError('TRAVEL_DATE_RANGE_INVALID', 'return_date cannot be before depart_date.', { depart_date: value.depart_date, return_date: value.return_date });
    }
    const currency = String(value.currency === undefined || value.currency === null ? '' : value.currency).trim().toUpperCase();
    if (currency && !CURRENCY_PATTERN.test(currency)) {
      throw new WmitError('SEARCH_CURRENCY_INVALID', 'currency must be a three-letter code such as PHP or USD.', { currency: currency.slice(0, 10) });
    }
    let travelers = null;
    if (value.travelers !== undefined && value.travelers !== null && value.travelers !== '') {
      const count = Number(value.travelers);
      if (!Number.isInteger(count) || count < 1 || count > MAX_TRAVELERS) {
        throw new WmitError('TRAVELERS_INVALID', 'travelers must be a whole number between 1 and ' + MAX_TRAVELERS + '.', { travelers: value.travelers });
      }
      travelers = count;
    }
    return {
      destination: destination.slice(0, 120),
      origin: value.origin ? String(value.origin).trim().slice(0, 120) : null,
      depart_date: value.depart_date ? String(value.depart_date) : null,
      return_date: value.return_date ? String(value.return_date) : null,
      travelers,
      currency: currency || null
    };
  }

  // Forces the contract onto every provider result: source/provider label
  // come from the registered descriptor (never from the result itself), the
  // price must be positive integer minor units with a three-letter currency,
  // validity dates must be real and ordered, and meta.live is set solely by
  // the provider's provenance-backed live flag.
  function normalizeResult(provider, raw, index) {
    const item = raw || {};
    const where = 'Result ' + (index + 1) + ' from provider ' + provider.id;
    const title = String(item.title === undefined || item.title === null ? '' : item.title).trim();
    if (!title) throw new WmitError('PROVIDER_RESULT_INVALID', where + ' is missing a title.', { source: provider.id, index });
    const price = item.price || {};
    let minor = null;
    try {
      minor = typeof price.amountMinor === 'bigint' ? price.amountMinor : BigInt(String(price.amountMinor === undefined || price.amountMinor === null ? '' : price.amountMinor).trim());
    } catch (_) { minor = null; }
    if (minor === null || minor <= 0n || minor > MAX_SAFE_MINOR) {
      throw new WmitError('PROVIDER_RESULT_INVALID', where + ' needs price.amountMinor as a positive integer amount of minor units.', { source: provider.id, index });
    }
    const currency = String(price.currency === undefined || price.currency === null ? '' : price.currency).trim().toUpperCase();
    if (!CURRENCY_PATTERN.test(currency)) {
      throw new WmitError('PROVIDER_RESULT_INVALID', where + ' needs price.currency as a three-letter code.', { source: provider.id, index });
    }
    const validFrom = String(item.valid_from === undefined || item.valid_from === null ? '' : item.valid_from);
    const validUntil = String(item.valid_until === undefined || item.valid_until === null ? '' : item.valid_until);
    if (!isRealDateOnly(validFrom) || !isRealDateOnly(validUntil) || validUntil < validFrom) {
      throw new WmitError('PROVIDER_RESULT_INVALID', where + ' needs a real validity window (valid_from <= valid_until, YYYY-MM-DD).', { source: provider.id, index });
    }
    const enteredBy = String(item.entered_by === undefined || item.entered_by === null ? '' : item.entered_by).trim();
    if (!enteredBy) throw new WmitError('PROVIDER_RESULT_INVALID', where + ' needs entered_by so the entry is attributable.', { source: provider.id, index });
    const enteredAt = String(item.entered_at === undefined || item.entered_at === null ? '' : item.entered_at).trim();
    if (!enteredAt) throw new WmitError('PROVIDER_RESULT_INVALID', where + ' needs entered_at.', { source: provider.id, index });
    const ref = String(item.ref === undefined || item.ref === null ? '' : item.ref).trim();
    if (!ref) throw new WmitError('PROVIDER_RESULT_INVALID', where + ' needs a ref.', { source: provider.id, index });
    return Object.assign(clone(item), {
      source: provider.id,
      provider: provider.label,
      title,
      price: { amountMinor: Number(minor), currency },
      valid_from: validFrom,
      valid_until: validUntil,
      entered_by: enteredBy,
      entered_at: enteredAt,
      verified: Boolean(item.verified),
      ref,
      meta: { live: provider.live === true }
    });
  }

  // Aggregates across every registered provider. A failing or malformed
  // provider is isolated into provider_errors; it never corrupts or blocks
  // the others. Reads are not audited (matching the expo service read
  // conventions); adds and verifications are.
  async function search(query, context) {
    try {
      if (!providers.size) {
        throw new WmitError('SEARCH_UNAVAILABLE', 'No travel-search providers are registered, so nothing can honestly be searched. Register the manual quote provider (or an authorized live provider) first.', { providers: [] });
      }
      const normalizedQuery = validateQuery(query);
      const ctx = contextOf(context, defaultActor);
      const results = [];
      const providerErrors = [];
      for (const provider of Array.from(providers.values())) {
        try {
          const returned = await provider.search(normalizedQuery, ctx);
          const items = Array.isArray(returned) ? returned : (returned === undefined || returned === null ? [] : null);
          if (items === null) throw new WmitError('PROVIDER_RESULT_INVALID', 'Provider ' + provider.id + ' returned something other than a result list.');
          items.forEach((item, index) => {
            try {
              results.push(normalizeResult(provider, item, index));
            } catch (error) {
              providerErrors.push({ source: provider.id, code: error.code || 'PROVIDER_RESULT_INVALID', message: String(error.message || 'The result was rejected.').slice(0, 300) });
            }
          });
        } catch (error) {
          providerErrors.push({ source: provider.id, code: error.code || 'PROVIDER_ERROR', message: String(error.message || 'The provider failed.').slice(0, 300) });
        }
      }
      results.sort((a, b) => a.price.currency.localeCompare(b.price.currency) || a.price.amountMinor - b.price.amountMinor || a.title.localeCompare(b.title));
      const liveSources = Array.from(providers.values()).filter((provider) => provider.live === true).map((provider) => provider.id);
      return ok({
        query: normalizedQuery,
        results,
        count: results.length,
        sources_searched: Array.from(providers.keys()),
        provider_errors: providerErrors,
        verified_count: results.filter((result) => result.verified).length,
        unverified_count: results.filter((result) => !result.verified).length
      }, {
        action: 'TRAVEL_SEARCH',
        read_only: true,
        // Honest at the result level: only a provenance-backed live provider
        // contributing at least one result can make this true. Today it is
        // always false because only manual quotes exist.
        live: results.some((result) => result.meta.live === true),
        live_sources: liveSources,
        manual_sources: Array.from(providers.keys()).filter((id) => !liveSources.includes(id))
      });
    } catch (error) {
      return fail(error);
    }
  }

  return { registerProvider, listProviders, search };
}

module.exports = {
  createTravelSearchService,
  createManualQuoteProvider,
  createInMemoryManualQuoteStore,
  MANUAL_QUOTE_SOURCE_ID
};
