'use strict';

// Travel-search adapter boundary (roadmap Phase 13). These tests pin the
// honesty rules of the boundary: an empty registry answers
// SEARCH_UNAVAILABLE instead of pretending to search, manual quotes are
// untrusted by default, every result is labeled meta.live = false, money is
// integer minor units, validation fails closed before any write, duplicate
// re-entry is idempotent, and staff verification is an audited flip.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhase1Runtime } = require('../../src/phase1/runtime');
const {
  createTravelSearchService,
  createManualQuoteProvider
} = require('../../src/travel-search');

const CLOCK = () => new Date('2026-08-19T08:00:00.000Z');

function build(overrides) {
  const opts = overrides || {};
  const runtime = opts.runtime || createPhase1Runtime({ clock: opts.clock || CLOCK, config: { trustedActors: {} } });
  const manual = opts.manual || createManualQuoteProvider({ runtime });
  const providers = opts.providers === undefined ? [manual] : opts.providers;
  const service = createTravelSearchService({ runtime, providers });
  return { runtime, manual, service };
}

const quoteInput = (overrides) => Object.assign({
  supplier_name: 'Siam Wholesaler Co.',
  destination: 'Bangkok',
  price_minor: 1850000,
  currency: 'PHP',
  valid_from: '2026-09-01',
  valid_until: '2026-09-30',
  description: '4D3N Bangkok package, twin sharing, breakfast included'
}, overrides || {});

test('an empty registry answers SEARCH_UNAVAILABLE instead of crashing or pretending', async () => {
  const { service } = build({ providers: [] });
  assert.deepEqual(service.listProviders(), []);
  const result = await service.search({ destination: 'Bangkok' }, { actor: 'USER:staff' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'SEARCH_UNAVAILABLE');
  assert.deepEqual(result.error.details.providers, []);
});

test('manual quote add and search round-trip through the shared contract', async () => {
  const { manual, service } = build();
  const added = manual.addManualQuote(quoteInput(), { actor: 'USER:ops' });
  assert.equal(added.ok, true, JSON.stringify(added.error));
  assert.match(added.data.manual_quote_id, /^MANUAL_QUOTE-\d{4}-\d{6}$/);
  assert.equal(added.data.verified, false, 'new quotes start unverified');
  assert.equal(added.data.entered_by, 'USER:ops');

  const found = await service.search(
    { destination: 'bangkok', depart_date: '2026-09-10', return_date: '2026-09-14', currency: 'PHP', travelers: 2 },
    { actor: 'USER:ops' }
  );
  assert.equal(found.ok, true, JSON.stringify(found.error));
  assert.equal(found.data.count, 1);
  assert.deepEqual(found.data.sources_searched, ['MANUAL_QUOTE']);
  assert.equal(found.data.unverified_count, 1);
  assert.equal(found.data.verified_count, 0);

  const result = found.data.results[0];
  assert.equal(result.source, 'MANUAL_QUOTE');
  assert.equal(result.provider, 'Manual supplier quotes (staff-entered)');
  assert.equal(result.supplier, 'Siam Wholesaler Co.');
  assert.equal(result.price.amountMinor, 1850000, 'money stays in integer minor units');
  assert.equal(result.price.currency, 'PHP');
  assert.equal(result.valid_from, '2026-09-01');
  assert.equal(result.valid_until, '2026-09-30');
  assert.equal(result.entered_by, 'USER:ops');
  assert.equal(result.entered_at, CLOCK().toISOString());
  assert.equal(result.verified, false);
  assert.equal(result.verified_at, null);
  assert.equal(result.ref, added.data.manual_quote_id);
  assert.deepEqual(result.meta, { live: false }, 'manual results are never live');
  assert.equal(found.meta.live, false, 'the aggregate search payload is never live either');
  assert.deepEqual(found.meta.manual_sources, ['MANUAL_QUOTE']);
  assert.deepEqual(found.meta.live_sources, []);
  assert.deepEqual(found.data.query, {
    destination: 'bangkok', origin: null, depart_date: '2026-09-10',
    return_date: '2026-09-14', travelers: 2, currency: 'PHP'
  }, 'the query echo preserves what the caller typed');
});

test('addManualQuote rejects invalid input before any write and audits the failures', () => {
  const { manual, runtime } = build();
  const explicit = [
    [quoteInput({ price_minor: -100 }), 'PRICE_INVALID'],
    [quoteInput({ price_minor: 0 }), 'PRICE_INVALID'],
    [quoteInput({ price_minor: 18500.5 }), 'PRICE_INVALID'],
    [quoteInput({ price_minor: '18,500' }), 'PRICE_INVALID'],
    [quoteInput({ destination: '   ' }), 'REQUIRED_FIELD'],
    [quoteInput({ supplier_name: '' }), 'REQUIRED_FIELD'],
    [quoteInput({ valid_from: '2026-09-30', valid_until: '2026-09-01' }), 'VALIDITY_RANGE_INVALID'],
    [quoteInput({ valid_from: 'September 1' }), 'VALIDITY_DATE_INVALID'],
    [quoteInput({ valid_until: '2026-02-31' }), 'VALIDITY_DATE_INVALID'],
    [quoteInput({ currency: 'pesos!' }), 'CURRENCY_INVALID'],
    [quoteInput({ currency: 'PH' }), 'CURRENCY_INVALID'],
    [{}, 'REQUIRED_FIELD']
  ];
  explicit.forEach(([input, code]) => {
    const result = manual.addManualQuote(input, { actor: 'USER:ops' });
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.equal(result.error.code, code, JSON.stringify(input));
  });
  assert.equal(manual.listQuotes().length, 0, 'rejected quotes are never written');
  const failures = runtime.auditLog.list().filter((event) => event.action === 'MANUAL_QUOTE_ADD' && event.result === 'FAILURE');
  assert.equal(failures.length, explicit.length, 'every rejection leaves a failure audit entry');
});

test('duplicate adds (same supplier, destination, price, overlapping window) are idempotent', () => {
  const { manual, runtime } = build();
  const first = manual.addManualQuote(quoteInput(), { actor: 'USER:ops' });
  assert.equal(first.ok, true);

  const again = manual.addManualQuote(quoteInput(), { actor: 'USER:ops2' });
  assert.equal(again.ok, true);
  assert.equal(again.data.manual_quote_id, first.data.manual_quote_id);
  assert.equal(again.meta.idempotent, true);
  assert.equal(again.meta.duplicate_of, first.data.manual_quote_id);
  assert.equal(again.data.entered_by, 'USER:ops', 'the original entry wins');

  const overlappingWindow = manual.addManualQuote(quoteInput({ valid_from: '2026-09-15', valid_until: '2026-10-15' }));
  assert.equal(overlappingWindow.meta.idempotent, true, 'overlapping validity windows still count as duplicates');

  const repriced = manual.addManualQuote(quoteInput({ price_minor: 1900000 }));
  assert.equal(repriced.ok, true);
  assert.notEqual(repriced.data.manual_quote_id, first.data.manual_quote_id, 'a new price is a new quote');

  const disjointWindow = manual.addManualQuote(quoteInput({ valid_from: '2026-10-01', valid_until: '2026-10-31' }));
  assert.equal(disjointWindow.ok, true);
  assert.notEqual(disjointWindow.data.manual_quote_id, first.data.manual_quote_id, 'a disjoint window is a new quote');

  const otherSupplier = manual.addManualQuote(quoteInput({ supplier_name: 'Mekong DMC' }));
  assert.equal(otherSupplier.ok, true);
  assert.notEqual(otherSupplier.data.manual_quote_id, first.data.manual_quote_id);

  assert.equal(manual.listQuotes().length, 4);
  const audits = runtime.auditLog.list();
  assert.equal(audits.filter((event) => event.action === 'MANUAL_QUOTE_ADD' && event.result === 'SUCCESS').length, 4);
  const duplicates = audits.filter((event) => event.action === 'MANUAL_QUOTE_DUPLICATE');
  assert.equal(duplicates.length, 2);
  assert.equal(duplicates[0].entity_id, first.data.manual_quote_id);
  assert.equal(duplicates[0].details.duplicate_of, first.data.manual_quote_id);
});

test('verifyManualQuote flips verified with an audit entry and shows in search', async () => {
  const { manual, runtime, service } = build();
  const added = manual.addManualQuote(quoteInput({ supplier_ref: 'SW-2026-118' }), { actor: 'USER:ops' });
  assert.equal(added.ok, true);

  const before = await service.search({ destination: 'Bangkok', depart_date: '2026-09-10' }, { actor: 'USER:ops' });
  assert.equal(before.data.results[0].verified, false);
  assert.equal(before.data.results[0].verified_at, null);
  assert.equal(before.data.results[0].verified_by, null);
  assert.equal(before.data.unverified_count, 1);

  const verified = manual.verifyManualQuote('SW-2026-118', { actor: 'USER:sup' });
  assert.equal(verified.ok, true, JSON.stringify(verified.error));
  assert.equal(verified.data.verified, true);
  assert.equal(verified.data.verified_by, 'USER:sup');
  assert.equal(verified.data.verified_at, CLOCK().toISOString());

  const after = await service.search({ destination: 'Bangkok', depart_date: '2026-09-10' }, { actor: 'USER:ops' });
  assert.equal(after.data.results[0].verified, true, 'unverified and verified results are distinguishable in the payload');
  assert.equal(after.data.results[0].verified_by, 'USER:sup');
  assert.equal(after.data.verified_count, 1);
  assert.equal(after.data.unverified_count, 0);
  assert.equal(after.data.results[0].meta.live, false, 'verification never turns a manual quote live');

  const replay = manual.verifyManualQuote(added.data.manual_quote_id, { actor: 'USER:sup' });
  assert.equal(replay.ok, true);
  assert.equal(replay.meta.idempotent, true);

  const audits = runtime.auditLog.list().filter((event) => event.action === 'MANUAL_QUOTE_VERIFY');
  assert.equal(audits.length, 1, 'the idempotent replay does not audit a second flip');
  assert.equal(audits[0].entity_id, added.data.manual_quote_id);
  assert.equal(audits[0].details.old_values.verified, false);
  assert.equal(audits[0].details.new_values.verified, true);

  assert.equal(manual.verifyManualQuote('MANUAL_QUOTE-2099-999999').error.code, 'MANUAL_QUOTE_NOT_FOUND');
});

test('search filters by destination match, currency, and validity-window overlap', async () => {
  const { manual, service } = build();
  manual.addManualQuote(quoteInput()); // Bangkok, PHP, 2026-09-01..30
  manual.addManualQuote(quoteInput({ destination: 'Bangkok', currency: 'USD', price_minor: 32000 }));
  manual.addManualQuote(quoteInput({ destination: 'Seoul, Korea' }));
  manual.addManualQuote(quoteInput({ destination: 'Bangkok', valid_from: '2026-07-01', valid_until: '2026-07-31' })); // already expired

  const byCurrency = await service.search({ destination: 'bangkok', currency: 'PHP' });
  assert.equal(byCurrency.data.count, 1);
  assert.equal(byCurrency.data.results[0].price.currency, 'PHP');

  const anyCurrency = await service.search({ destination: 'BANGKOK' });
  assert.equal(anyCurrency.data.count, 2, 'a date-less search returns current and upcoming quotes - only expired windows drop off');
  assert.deepEqual(anyCurrency.data.results.map((result) => result.price.currency), ['PHP', 'USD']);

  const inWindow = await service.search({ destination: 'Bangkok', depart_date: '2026-09-05', return_date: '2026-09-12' });
  assert.equal(inWindow.data.count, 2, 'both live Bangkok quotes overlap the stay (PHP and USD)');

  const outsideWindow = await service.search({ destination: 'Bangkok', depart_date: '2026-10-10' });
  assert.equal(outsideWindow.data.count, 0, 'quotes whose validity does not cover the stay are excluded');

  const historical = await service.search({ destination: 'Bangkok', depart_date: '2026-07-05' });
  assert.equal(historical.data.count, 1, 'an explicit historical date still finds the expired quote for reference');

  const seoul = await service.search({ destination: 'seoul' });
  assert.equal(seoul.data.count, 1, 'destination matching is case-insensitive and tolerates suffixes');

  const sorted = inWindow.data.results.map((result) => result.price.currency);
  assert.deepEqual(sorted, ['PHP', 'USD'], 'results sort by currency then price');
});

test('the registry validates providers and a live claim requires provenance', () => {
  const { service } = build();
  assert.throws(() => service.registerProvider({ id: 'MANUAL_QUOTE', label: 'Duplicate', search() { return []; } }), (error) => error.code === 'PROVIDER_DUPLICATE');
  assert.throws(() => service.registerProvider({ id: 'nope', label: 'Bad id', search() { return []; } }), (error) => error.code === 'PROVIDER_INVALID');
  assert.throws(() => service.registerProvider({ id: 'LIVE_GDS', label: 'No function' }), (error) => error.code === 'PROVIDER_INVALID');
  assert.throws(() => service.registerProvider({
    id: 'LIVE_GDS', label: 'Unproven live source', live: true, search() { return []; }
  }), (error) => error.code === 'PROVIDER_LIVE_UNPROVEN');
  service.registerProvider({
    id: 'LIVE_GDS', label: 'Proven live source', live: true,
    provenance: { authorized_source: 'Office GDS account', verified_at: '2026-08-01' },
    search() { return []; }
  });
  const listed = service.listProviders();
  assert.equal(listed.length, 2);
  assert.deepEqual(listed[1], {
    id: 'LIVE_GDS', label: 'Proven live source', live: true,
    provenance: { authorized_source: 'Office GDS account', verified_at: '2026-08-01' }
  });
});

test('provider failures are isolated and a provider cannot force meta.live on its results', async () => {
  const { manual, service } = build();
  manual.addManualQuote(quoteInput());
  service.registerProvider({
    id: 'BROKEN', label: 'Broken provider', live: false,
    search() { throw new Error('boom'); }
  });
  service.registerProvider({
    id: 'STUB_ASYNC', label: 'Async stub provider', live: false,
    async search() {
      return [{
        source: 'STUB_ASYNC', provider: 'Impersonated label', title: 'Stub result',
        price: { amountMinor: 100000, currency: 'PHP' },
        valid_from: '2026-09-01', valid_until: '2026-09-30',
        entered_by: 'WIRING', entered_at: '2026-08-01T00:00:00.000Z',
        verified: true, ref: 'STUB-1', meta: { live: true }
      }, {
        title: '', price: { amountMinor: 1, currency: 'PHP' }
      }];
    }
  });

  const found = await service.search({ destination: 'Bangkok', depart_date: '2026-09-10' });
  assert.equal(found.ok, true);
  assert.equal(found.data.count, 2, 'manual + stub results survive the broken provider');
  assert.deepEqual(found.data.sources_searched, ['MANUAL_QUOTE', 'BROKEN', 'STUB_ASYNC']);
  const broken = found.data.provider_errors.filter((entry) => entry.source === 'BROKEN');
  assert.equal(broken.length, 1);
  assert.equal(broken[0].code, 'PROVIDER_ERROR');
  const malformed = found.data.provider_errors.filter((entry) => entry.source === 'STUB_ASYNC');
  assert.equal(malformed.length, 1);
  assert.equal(malformed[0].code, 'PROVIDER_RESULT_INVALID', 'a title-less result is dropped, not guessed');

  const stub = found.data.results.find((result) => result.ref === 'STUB-1');
  assert.equal(stub.source, 'STUB_ASYNC', 'source comes from the registered descriptor');
  assert.equal(stub.provider, 'Async stub provider', 'the label comes from the descriptor too');
  assert.deepEqual(stub.meta, { live: false }, 'a provider cannot claim live through its own payload');
  assert.equal(found.meta.live, false);
});

test('search validates the query itself and fails closed', async () => {
  const { service } = build();
  const cases = [
    [{}, 'REQUIRED_FIELD'],
    [{ destination: 'Bangkok', depart_date: 'nope' }, 'TRAVEL_DATE_INVALID'],
    [{ destination: 'Bangkok', depart_date: '2026-09-10', return_date: '2026-09-01' }, 'TRAVEL_DATE_RANGE_INVALID'],
    [{ destination: 'Bangkok', depart_date: '2026-02-31' }, 'TRAVEL_DATE_INVALID'],
    [{ destination: 'Bangkok', currency: 'XX' }, 'SEARCH_CURRENCY_INVALID'],
    [{ destination: 'Bangkok', travelers: 0 }, 'TRAVELERS_INVALID'],
    [{ destination: 'Bangkok', travelers: 1.5 }, 'TRAVELERS_INVALID'],
    [{ destination: 'Bangkok', travelers: 51 }, 'TRAVELERS_INVALID']
  ];
  for (const [query, code] of cases) {
    const result = await service.search(query, { actor: 'USER:ops' });
    assert.equal(result.ok, false, JSON.stringify(query));
    assert.equal(result.error.code, code, JSON.stringify(query));
  }
});

test('a shared supplier reference that matches several quotes fails closed on verify', () => {
  const { manual } = build();
  manual.addManualQuote(quoteInput({ supplier_ref: 'SW-2026-900' }));
  manual.addManualQuote(quoteInput({ destination: 'Pattaya', supplier_ref: 'SW-2026-900', valid_from: '2026-10-01', valid_until: '2026-10-31' }));
  const ambiguous = manual.verifyManualQuote('SW-2026-900', { actor: 'USER:sup' });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.error.code, 'MANUAL_QUOTE_AMBIGUOUS');
  assert.equal(ambiguous.error.details.manual_quote_ids.length, 2);
  assert.equal(manual.listQuotes().every((quote) => quote.verified === false), true);
});

test('the boundary refuses to construct without the runtime', () => {
  assert.throws(() => createTravelSearchService({}), (error) => error.code === 'RUNTIME_REQUIRED');
  assert.throws(() => createManualQuoteProvider({}), (error) => error.code === 'RUNTIME_REQUIRED');
});
