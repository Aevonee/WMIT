# WMIT Phase 1 Foundation

## Scope completed

Phase 1 is a local-only foundation. It does not connect to Google Workspace, create a spreadsheet, create Drive folders, migrate data, send messages, or perform financial or booking actions.

Implemented:

- versioned schema definition: 1.0.0-foundation
- development and test configuration with blank Google IDs
- production configuration example that is intentionally disabled
- central year-based and non-year-based ID generator
- reusable required-field, ID, date, email, amount, enum, reference, and lifecycle validation
- understandable structured errors for service callers
- in-memory repositories for local testing
- in-memory audit log
- representative controlled services for Client, Supplier, and Lead
- schema-backed services for the remaining foundation entities
- future Google Sheets and Google Drive adapter boundaries
- Apps Script entry-point facade with explicit dependency injection
- synthetic relationship fixtures
- automated tests

## Entity scope classification

| Entity | Phase 1 treatment | Reason |
|---|---|---|
| Client | Required for foundation | Core customer relationship |
| Contact | Required for foundation | Separates contact points from records |
| Traveler/Passenger | Required for foundation | Needed for future booking and departure links |
| Lead | Required for foundation | Source and sales lineage |
| Quotation | Required for foundation | Future booking lineage and pricing separation |
| Booking | Required for foundation | Central operational relationship |
| Departure | Required for foundation | Group-travel readiness later |
| Supplier | Required for foundation | Procurement and supplier references |
| Invoice | Required for foundation | Financial relationship shape only |
| Payment | Required for foundation | Financial relationship shape only |
| Document | Required for foundation | File metadata and review relationship |
| Task | Required for foundation | Follow-up and operational work |
| Products, packages, flights, hotels, land arrangements | Later | Defined in Phase 0 schema, not part of the representative service API |
| Supplier tariffs, payables, receivables, commissions | Later | Need validated financial and supplier workflows |
| Marketing, expos, interns, document requirements, notes | Later | Separate workflows and permissions |
| Gmail, Calendar, PDF extraction, travel search | Unknown until access/source review | External permissions, cost, reliability, and legal constraints are unresolved |

## ID decision

The foundation uses:

- non-year-based: PREFIX-000001 for stable master-data records such as Client and Supplier
- year-based: PREFIX-YYYY-000001 for transactions and time-bound records
- synthetic tests may use PREFIX-TEST-000001 to make fake data obvious

IDs are generated centrally, validated against the entity prefix, and immutable after creation. Row numbers are never used as IDs.

## Adapter decision

The business services depend on repository capabilities rather than Google APIs. The current implementation uses in-memory repositories. Google Sheets and Google Drive classes expose future contracts but fail safely when unconfigured. This keeps local tests independent of Workspace access and avoids pretending production integration exists.

## Deliberately unbuilt

- no real Google Apps Script deployment
- no production spreadsheet or Drive folder
- no migration
- no complete quotation, invoice, payment, booking, document, itinerary, voucher, tariff, or travel-search workflow
- no AI agents
- no external communication or booking actions

## Blocked until Workspace access

- inspect existing spreadsheets and templates
- inspect current invoice and quotation formats
- inspect Drive organization
- verify account permissions and staff roles
- identify approved real spreadsheet and folder IDs
- validate the proposed schema against real records
- design migration, backup, and rollback procedures

## Acceptance

Run node scripts/run-tests.js. The expected result is 13 passing tests and 0 failures. The tests use only synthetic data and local in-memory repositories.
