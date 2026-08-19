# Travel search: the adapter boundary (roadmap Phase 13)

Status: boundary shipped, manual provider only, zero live-data claims.

WMIT has no authorized live travel-data source today. No GDS account, no
wholesaler API key, nothing. Under the project rule "Never claim live
availability, current pricing, or confirmed travel arrangements unless an
authorized source actually returned and verified them," the only honest
thing this phase can ship is the **boundary** plus the provider that matches
how the agency actually sources quotes: staff transcribing what wholesalers,
DMCs, and consolidators send them.

Files:

- `src/travel-search/index.js` - the registry/aggregator service
- `src/travel-search/manual-quote-provider.js` - the ManualQuoteProvider
- `tests/integration/travel-search.test.js` - the contract tests

Run them with:

```text
node --test tests/integration/travel-search.test.js
```

## The contract

`createTravelSearchService({ runtime, providers })` returns
`{ registerProvider, listProviders, search }`. Providers are optional and
pluggable; `providers` is an array of descriptors registered at construction,
and `registerProvider` adds more later.

A provider descriptor is:

```js
{
  id: 'MANUAL_QUOTE',            // uppercase, unique, appears as result.source
  label: 'Manual supplier quotes (staff-entered)',  // appears as result.provider
  search: async (query, context) => [results],      // sync or async
  live: false,                   // only true with provenance (see below)
  provenance: null               // required when live === true
}
```

`service.search(query, { actor })` where
`query = { origin, destination, depart_date, return_date, travelers, currency }`:

- `destination` is required - WMIT sourcing is destination-first.
- Dates are real `YYYY-MM-DD` calendar dates; `return_date >= depart_date`.
- `currency` is a three-letter code; `travelers` a whole number 1-50.

The service validates the query, calls every registered provider, isolates
provider failures into `provider_errors` (one broken provider never blocks
the others), normalizes every result through the contract, and returns:

```js
{
  ok: true,
  data: {
    query,                       // normalized echo of what was searched
    results,                     // sorted by currency, then price, then title
    count,
    sources_searched: ['MANUAL_QUOTE'],
    provider_errors: [],
    verified_count, unverified_count
  },
  meta: { action: 'TRAVEL_SEARCH', read_only: true, live: false, live_sources: [], manual_sources: ['MANUAL_QUOTE'] }
}
```

Each result carries, enforced by the service (not trusted from the provider):

| Field | Meaning |
| --- | --- |
| `source` | provider id, forced from the registered descriptor |
| `provider` | provider label, forced from the registered descriptor |
| `title`, `description` | human-readable package description |
| `price` | `{ amountMinor, currency }` - integer minor units only |
| `valid_from`, `valid_until` | real dates, ordered |
| `entered_by`, `entered_at` | who captured the quote and when |
| `verified`, `verified_at`, `verified_by` | staff verification state |
| `ref` | supplier reference or the quote's own ID |
| `meta` | `{ live: ... }` - forced, see the rules below |

Money is integer minor units (centavos) everywhere in this boundary - the
same convention as `src/core/money.js`. Convert display values with
`toMinorUnits('18500.00') === 1850000n`. Decimal or textual prices are
rejected at write time (`PRICE_INVALID`), never rounded.

## The ManualQuoteProvider

`createManualQuoteProvider({ runtime, store?, clock? })`. Behind it:

- `addManualQuote(input, { actor })` - staff enter a quote that arrived from
  a supplier. Required: `supplier_name`, `destination`, `price_minor`
  (positive integer), `currency`, `valid_from`/`valid_until`. Optional:
  `origin`, `title`, `description`, `notes`, `supplier_ref`.
- Duplicate re-entry is idempotent: the same supplier + destination + price
  (minor units + currency) with an **overlapping validity window** replays
  the original record with `meta.idempotent = true` and audits a
  `MANUAL_QUOTE_DUPLICATE` event instead of creating a second quote.
- `verifyManualQuote(ref, { actor })` - flips `verified` to true after staff
  check the quote against the supplier source. `ref` is the
  `manual_quote_id`, or a `supplier_ref` that resolves to exactly one quote;
  an ambiguous reference fails closed (`MANUAL_QUOTE_AMBIGUOUS`). The flip is
  audited with old/new values; an idempotent re-verify writes nothing.
- `search(query, context)` - filters by destination (case-insensitive,
  containment in both directions), currency, origin when both sides have
  one, and validity-window overlap with the requested stay. Without dates it
  returns current and upcoming quotes and drops only fully expired windows;
  an explicit historical date may still look up a closed window.
- `listQuotes({ supplier_name?, destination? })` - staff listing with an
  `expired` flag; `getQuote(id)` for single lookups.

IDs are `MANUAL_QUOTE-<year>-<sequence>` from the runtime's central ID
generator. Every meaningful action writes the runtime audit log with
`entity_type: 'ManualQuote'`: `MANUAL_QUOTE_ADD`,
`MANUAL_QUOTE_DUPLICATE`, `MANUAL_QUOTE_VERIFY`, plus FAILURE entries for
rejected writes. Searches are reads and are not audited, matching the expo
service conventions.

### Persistence

The provider is backed by an injected store. The default
(`createInMemoryManualQuoteStore()`) is a Map, which means quotes reset on
restart - fine for evaluation, not for production. The later wiring wave
should supply a SQLite-backed store implementing:

```js
{ insert(record), get(id), update(id, changes), list() }
```

with plain JSON-safe records keyed by `manual_quote_id`. Notes for that wave:

- The runtime's `SqliteIdGenerator` scans entity tables for its max ID; a
  SQLite store for manual quotes must reserve `MANUAL_QUOTE` IDs itself
  (mirroring `scanMax`) or restarts could reissue IDs.
- No entity definitions in `src/models/schema.js` or `src/phase1/runtime.js`
  are needed - the store contract above is enough.

## Why manual-first

This is not a stopgap; it is the actual workflow. Worldmaster's quotes come
from wholesalers and DMCs over email, chat, and portals. A "search" that did
not talk to those people would be fiction. The manual provider makes the
transcription step first-class: validated, deduplicated, attributable
(`entered_by`), timestamped, audited, and - critically - **unverified until
a human says otherwise**. Search results are always candidate inputs to a
human quotation workflow, never bookable facts.

## How a future live provider plugs in

When the agency gains authorized access to, say, a GDS or a wholesaler API,
that integration goes behind this same boundary:

1. Write an adapter module (e.g. `src/travel-search/gds-provider.js`) that
   maps the upstream response into the result contract above. It must keep
   upstream money in integer minor units and upstream validity windows in
   `YYYY-MM-DD`; anything it cannot map honestly is dropped, not guessed.
2. Register it with `live: true` **and** a provenance record:

   ```js
   service.registerProvider({
     id: 'GDS_AMADEUS',
     label: 'Amadeus GDS (office account)',
     live: true,
     provenance: { authorized_source: 'Amadeus GDS - WMIT office contract', verified_at: '2027-01-15' },
     search: gdsSearch
   });
   ```

   Registration without provenance throws `PROVIDER_LIVE_UNPROVEN`. This is
   the enforcement point: nobody can flip a provider live by editing a
   result payload, because `meta.live` is stamped from the registered
   descriptor, never from provider output.
3. Credentials come from environment configuration only (the hosted server
   already loads `.env`): enable with something like
   `WMIT_TRAVELSEARCH_GDS_AMADEUS_ENABLED=1`, endpoint URL, and a secret
   name - never hard-coded values, never values in Git. The adapter stays
   optional: WMIT must never depend on one travel website or provider
   (AGENTS.md architecture rule), which is why the registry accepts any
   number of providers and the app boots fine with zero.
4. Failures stay isolated: a live provider throwing or returning malformed
   results lands in `provider_errors` and the manual quotes still answer.

## The never-fake-live rules

1. `meta.live` defaults to `false` and is forced by the registry from the
   provider descriptor; only a provider registered with `live: true` plus
   provenance can produce `meta.live: true` results.
2. The aggregate search `meta.live` is true only when at least one returned
   result actually came from such a provider - capability alone is not a
   claim.
3. Manual results are always `verified: false` on entry; verification is an
   audited human action, and unverified results are distinguishable in the
   payload (`verified`, `verified_at`, `verified_by`, plus
   `verified_count`/`unverified_count`).
4. An empty registry answers `SEARCH_UNAVAILABLE` - the system never
   pretends to search when it cannot.
5. Prices carry supplier validity windows and are never refreshed,
   re-fetched, or cached as if current. A price is a fact about a window a
   supplier stated, entered by a person, on a timestamp.
