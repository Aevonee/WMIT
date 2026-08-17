# WMIT Phase 1 Foundation Code Audit

Date: 2026-08-12  
Scope: Existing local Phase 1 implementation only  
Change policy: Audit only; no implementation features or production integrations added

## 1. Executive verdict

### Rating: YELLOW — usable as a local prototype, but requires fixes before proceeding

The implementation is small enough to salvage and the basic service/repository separation is directionally sound. The tests pass, the code is locally runnable, and no Google Workspace data was touched.

It is not yet safe to treat as a production-ready foundation. The most important gaps are:

1. ID counters are process-local and are not persistent or concurrency-safe.
2. Environment JSON files are not loaded by the runtime, and placeholder production IDs are accepted when Google Workspace is enabled.
3. Audit logging does not retain old and new values and is only in memory.
4. Approval-risk configuration exists but is not enforced anywhere.
5. The Apps Script facade trusts caller-supplied services and actor/context values.
6. Lifecycle enforcement covers only Lead, Quotation, Booking, and Invoice.
7. Unknown fields are accepted and stored.
8. Several polymorphic and operational relationships are not validated.
9. The schema is a useful foundation sketch, but it contains unresolved travel-agency assumptions and does not yet represent passengers, services, suppliers, or invoice line items.

This does not require discarding the architecture. It does require a hardening pass before Google Sheets or real business workflows are connected.

## 2. Requirements audit

| Requirement | Implemented? | Evidence | Problems | Severity |
|---|---|---|---|---|
| Project architecture | Partial | docs/architecture.md; src/services; src/repositories; src/adapters | The local layers are understandable, but the Apps Script layer is not connected to the local services and the adapter contracts are not exercised against a substitute repository. | Medium |
| Configuration system | Partial | src/config/config.js; config/development/config.json; config/test/config.json | Runtime loadConfig accepts overrides but never loads the JSON environment files. Configuration files can drift from executable defaults. | High |
| Central ID generation | Partial | src/ids/id-generator.js | Counters exist only in memory, reset on restart, use UTC year rather than configured Asia/Manila year, and are not concurrency-safe. | Critical |
| Data validation | Partial | src/validation/validator.js | Required fields and basic types are checked, but unknown fields, several polymorphic references, cross-field rules, and many enum values are not checked. | High |
| Error handling | Yes, locally | src/core/errors.js; service errorResult handling | Known WMIT errors are normalized. Unexpected errors are intentionally sanitized, but audit failure itself is not isolated. | Medium |
| Logging/audit framework | Partial | src/logging/audit-log.js; entity-service audit calls | Events include core metadata, but old/new values are not recorded, there is no durable backend, and action/risk policy is not enforced. | High |
| Versioned schema definition | Yes, locally | src/models/schema.js; config/schema-v1.json | The executable schema is versioned, but config/schema-v1.json only lists entities and duplicates the version without the field definitions. | Medium |
| Schema validation tests | Partial | tests/integration/fixture.test.js; tests/unit/validation.test.js | Fixtures exercise all entities, but there is no systematic schema-contract test for every field, relationship, status, uniqueness rule, and unknown-field policy. | Medium |
| Repositories | Partial | src/repositories/repository.js; src/repositories/memory-repository.js | The abstract repository is not used as a common interface, and the Google adapter classes are not repositories and are unimplemented. | Medium |
| Representative services | Partial | src/services/entity-service.js; src/services/index.js | Services validate, persist, and audit, but they are generic CRUD wrappers rather than domain services. That is acceptable at this stage, but the claim must be described accurately. | Medium |
| Google Sheets adapter boundary | Partial | src/adapters/google-sheets-adapter.js | It fails safely when disabled, but has no working implementation, no documented row/patch contract, no concurrency semantics, and is not used by a service test. | High |
| Google Drive adapter boundary | Partial | src/adapters/google-drive-adapter.js; InMemoryDriveRepository | It fails safely when disabled, but the file repository is separate from the adapter contract and file metadata linkage is not tested through a service. | Medium |
| Apps Script facade | Partial | apps-script/WmitRuntime.gs; apps-script/WmitServiceLayer.gs | It is a thin call boundary only. It does not validate input, authenticate callers, enforce approvals, or normalize errors. | High |
| Synthetic data | Yes | tests/fixtures/synthetic-data.js | Data is clearly fictional and uses example.test addresses. | No problem |
| Automated tests | Partial | 13 tests pass | Tests prove the happy path and several failures, but not persistence, concurrency, environment loading, audit old/new values, repository substitution, unknown fields, or all lifecycle gaps. | High |
| Documentation | Yes, with inconsistencies | docs/; README.md; START-HERE.md; AGENTS.md | The local implementation is documented, but earlier documents still describe proposed future behavior and the audit found claims stronger than the code. | Medium |
| Environment separation | Partial | config/development, config/test, config/production; config.js | Separate files exist, but the runtime ignores them. Production placeholders are non-empty strings and can pass the current enablement check. | Critical |
| Safety controls | Partial | config approvalRisk; docs/security.md; disabled adapters | Risk categories are documented/configured but no service or facade checks risk, approval, authorization, or caller identity. | Critical |
| No production changes | Yes | No SpreadsheetApp/DriveApp calls; adapters disabled | This is verified for the current codebase. | No problem |

## 3. Schema audit

The executable schema is in src/models/schema.js. Status values come from src/config/config.js. Lifecycle transitions come from src/core/lifecycle.js. The following audit describes what exists without redesigning it.

### Client

- Fields: client_id, client_type, legal_name, display_name, primary_email, primary_phone, country, source_lead_id, status, notes, common audit fields.
- ID: CLIENT-000001; non-year-based.
- Relationship: source_lead_id references Lead.
- Status: Active, Inactive.
- Concern: the only declared uniqueness rule is the pair display_name plus primary_email. A repeated email with a changed name is accepted, and a missing email disables the uniqueness check. Multiple leads can point to one client, but only one source_lead_id is retained.
- Classification: HIGH for future duplicate management; MEDIUM for the foundation.

### Contact

- Fields: contact_id, owner_type, owner_id, contact_type, contact_value, is_primary, status, notes, common audit fields.
- ID: CONTACT-000001; non-year-based.
- Relationship: owner_id is intended to be polymorphic, but there is no references declaration and no runtime validation.
- Status: Active, Inactive.
- Concern: Employee is an allowed owner type but Employee is not one of the foundation schemas. A contact can therefore point to a nonexistent client, supplier, or employee.
- Classification: HIGH.

### Traveler / Passenger

- Fields: traveler_id, client_id, first_name, middle_name, last_name, date_of_birth, nationality, status, notes, common audit fields.
- ID: PASSENGER-YYYY-000001; year-based.
- Relationship: optional client_id references Client.
- Status: Active, Inactive.
- Concern: passport and travel-document fields are absent. That may be intentionally deferred for privacy, but the later operations model cannot assume this record is departure-ready. The client relationship is optional, so an orphan traveler is valid by design.
- Classification: MEDIUM now; HIGH before operational use.

### Lead

- Fields: lead_id, received_at, source, lead_type, client_id, contact_name, contact_email, contact_phone, destination, travel_start, travel_end, pax_count, estimated_value, currency, owner_user, status, next_follow_up_at, notes, common audit fields.
- ID: LEAD-YYYY-000001; year-based.
- Relationships: optional client_id references Client.
- Status: New, Contacted, Qualified, Quoted, Won, Lost, Closed.
- Concern: the original requirement called for B2B company, agency, contact person, account type, account manager, and notes. Only some of that is present. Lead activities are not represented in the local executable schema. The unique tuple of email, phone, and destination is a strong assumption and only applies when all three values exist.
- Classification: HIGH before Sales work.

### Quotation

- Fields: quotation_id, lead_id, client_id, quotation_date, valid_until, currency, supplier_cost_total, markup_total, fees_total, discount_total, client_total, status, notes, common audit fields.
- ID: QUOTATION-YYYY-000001; year-based.
- Relationships: required lead_id references Lead; optional client_id references Client.
- Status: Draft, Approved, Sent, Accepted, Rejected, Expired.
- Concern: there are no quotation items in the executable foundation schema. Totals have no arithmetic validation, no supplier-item linkage, and no pricing-rule reference. This is acceptable as a relationship sketch but not as a quotation basis.
- Classification: HIGH before quotation automation.

### Booking

- Fields: booking_id, quotation_id, client_id, booking_date, travel_start, travel_end, destination, currency, client_total, supplier_cost_total, status, notes, common audit fields.
- ID: BOOKING-YYYY-000001; year-based.
- Relationships: optional quotation_id references Quotation; required client_id references Client.
- Status: Draft, Pending Confirmation, Confirmed, Cancelled, Completed.
- Concern: no travelers, departure, services, supplier bookings, or operational owner are linked. The shape implies one booking has one client and optionally one quotation, but does not represent the many-to-many passenger and service relationships required by the stated business context.
- Classification: HIGH before operations work.

### Departure

- Fields: departure_id, name, destination, start_date, end_date, capacity, readiness_percent, status, notes, common audit fields.
- ID: DEPARTURE-YYYY-000001; year-based.
- Relationships: none in the executable schema.
- Status: Draft, Open, Ready, Departed, Completed, Cancelled.
- Concern: no departure travelers, booking links, flights, hotels, vouchers, or readiness issue rows exist. readiness_percent is typed as amount rather than percentage, and a test with 101 is accepted.
- Classification: HIGH.

### Supplier

- Fields: supplier_id, supplier_type, legal_name, display_name, country, primary_email, payment_terms, status, notes, common audit fields.
- ID: SUPPLIER-000001; non-year-based.
- Relationships: none in the executable schema.
- Status: Active, Inactive, On Hold.
- Concern: supplier_type is singular. A real supplier may have multiple roles or services, but that is not known yet. Contacts, tariffs, supplier bookings, cancellation rules, and performance are deferred.
- Classification: MEDIUM now; HIGH before procurement.

### Invoice

- Fields: invoice_id, invoice_number, booking_id, client_id, invoice_date, due_date, currency, subtotal, discount_total, fees_total, tax_total, total, amount_paid, balance_due, status, notes, common audit fields.
- ID: INVOICE-YYYY-000001; year-based.
- Relationships: required booking_id references Booking; required client_id references Client.
- Status: Draft, Approved, Sent, Partially Paid, Paid, Overdue, Cancelled.
- Concern: invoice_number is marked immutable but has no uniqueness constraint. There are no invoice items, no calculation validation, and no rule that total equals subtotal minus discount plus fees plus tax. The model assumes one invoice belongs to one booking.
- Classification: CRITICAL before finance work.

### Payment

- Fields: payment_id, invoice_id, booking_id, client_id, payment_date, amount, currency, method, status, notes, common audit fields.
- ID: PAYMENT-YYYY-000001; year-based.
- Relationships: required invoice_id, booking_id, and client_id references.
- Status: Pending Verification, Verified, Rejected, Reversed.
- Concern: the three foreign keys can disagree with each other; no consistency check verifies that invoice.booking_id and invoice.client_id match the payment. There is no external reference, evidence file, verification actor, or reversal linkage.
- Classification: CRITICAL before finance work.

### Document

- Fields: document_id, file_id, document_type, source, client_id, booking_id, supplier_id, extraction_confidence, review_status, notes, common audit fields.
- ID: DOCUMENT-YYYY-000001; year-based.
- Relationships: optional client, booking, and supplier references.
- Status: Received, Classified, Needs Review, Matched, Archived, using review_status.
- Concern: lead, departure, invoice, voucher, and document-to-document links are absent. The file_id is only a string; no Drive metadata contract is enforced. extraction_confidence is bounded at 100 but not tied to review status.
- Classification: HIGH before document ingestion.

### Task

- Fields: task_id, related_type, related_id, title, description, priority, assigned_to, due_at, status, common audit fields.
- ID: TASK-YYYY-000001; year-based.
- Relationships: related_type/related_id is polymorphic but not declared or validated.
- Status: Open, In Progress, Blocked, Completed, Cancelled.
- Concern: arbitrary related IDs are accepted. There is no allowed priority list, no employee reference, and no due-date/state rule.
- Classification: HIGH for operational reporting; MEDIUM for local foundation.

## 4. ID generator audit

Implementation: src/ids/id-generator.js.

Behavior:

- Maintains a JavaScript object of counters.
- Uses PREFIX-000001 for non-year-based IDs.
- Uses PREFIX-YYYY-000001 for year-based IDs.
- Uses UTC year from clock().getUTCFullYear() unless an explicit year is passed.
- Separates counters by prefix and year for year-based IDs.
- Allows arbitrary valid uppercase prefixes rather than restricting them to configured schema prefixes.
- Resets all counters when the process or Apps Script execution context is recreated.
- Does not persist a counter or coordinate concurrent callers.

The local generator is suitable for deterministic tests and a single-process demonstration. It is not suitable for production. Two concurrent executions can read the same counter and issue the same ID. A restart can reuse IDs. A failed validation after allocation consumes a number, which is acceptable if gaps are allowed but must be documented. An explicitly supplied year is not validated against the configured timezone or calendar.

Recommended future design:

- Use one stable counter key per prefix and per business year where required.
- Determine the year in Asia/Manila, not UTC, because WMIT is a Philippine business.
- Acquire a script-wide LockService lock before reading and incrementing the counter.
- Persist the counter in PropertiesService or a controlled system-settings store.
- Treat gaps as acceptable; never reuse an issued ID.
- Add an idempotency key for retryable create operations so a retry does not create a second business record.
- If more than one Apps Script project or external worker can issue IDs, LockService alone is insufficient; use one authoritative issuer or a datastore with atomic transactions.

PropertiesService plus LockService is appropriate for the expected small team and one Apps Script project, but only with these constraints and a clear failure/retry policy.

## 5. Validation audit

The validation code is centralized and reusable, but incomplete.

Verified behavior:

- null, undefined, and blank strings fail required fields.
- zero is accepted as an amount.
- negative, NaN, and non-finite amounts fail.
- malformed and impossible dates fail.
- basic email and three-letter uppercase currency checks exist.
- invalid configured status values fail.
- declared foreign keys are checked against repositories.
- invalid IDs fail at both generic and entity-service levels.

Important gaps:

- Unknown fields are accepted and stored. A client with an unexpected field was accepted and the field remained in the stored record. This is a direct schema-integrity problem.
- Fields typed as string are not type-checked; numbers or objects can be stored in string fields.
- Many enum fields have no allowed values. Payment method, document type, document source, task priority, and task related_type are examples.
- Contact owner_id and Task related_id are not validated because their polymorphic relationship is not represented in schema references.
- No cross-field date checks exist. Travel end can precede travel start; due date can precede invoice date; quotation validity can precede quotation date.
- No cross-field financial checks exist. Invoice totals and balance_due can be inconsistent.
- readiness_percent uses amount validation and therefore accepts values above 100.
- validateId is generic and accepts a broad prefix pattern. Entity services add a second prefix check, creating two validation rules.
- The email rule is intentionally simple and may reject or accept edge cases; that is acceptable for a foundation only if later normalized.
- There is no circular-reference policy. Existing records can be linked in cycles where the business model should forbid them.

These are not reasons to add arbitrary complexity. They are reasons to define an explicit unknown-field policy, relationship contract, and cross-field rules before real Sheets writes.

## 6. Lifecycle audit

Lifecycle transitions are centralized in src/core/lifecycle.js, but only four entity types have transition maps:

- Lead
- Quotation
- Booking
- Invoice

For entities without a transition map, validateStateTransition returns true for any status change as long as the target status is an allowed enum. Therefore Client, Contact, Traveler, Departure, Supplier, Payment, Document, and Task have no illegal-transition protection.

The existing transitions are also unverified business assumptions. Examples:

- Quotation Accepted can move only to Expired.
- Invoice can be cancelled after Sent or after payment-related states.
- Booking can be cancelled after Confirmed.
- No approval actor or approval timestamp is required by the lifecycle validator.
- Payment status transitions are not controlled at all.

The current code reliably blocks some illegal transitions, but not all entities and not all business conditions. Lifecycle rules should remain provisional until actual WMIT workflows are discovered.

Classification: HIGH.

## 7. Repository audit

The service layer calls repository methods rather than manipulating Maps directly. InMemoryRepository provides insert, get, require, update, exists, list, and clear. It clones records at boundaries, which prevents simple caller mutation.

However:

- Repository does not extend the Repository base class; the base class is unused documentation-by-code.
- The interface does not define list, require, clear, error semantics, or update merge/patch semantics.
- Entity services pass a fully merged record into update. A future Sheets repository must know that this means merge-or-replace, despite no interface contract stating it.
- The Google Sheets adapter is not a Repository implementation.
- The Google Drive adapter is not a file repository implementation.
- No contract test proves that another repository with the same methods can replace InMemoryRepository.
- There is no transaction or optimistic-concurrency mechanism.
- InMemoryDriveRepository is not used by a document service.

The abstraction is directionally correct but not yet proven. The main leaky abstraction is the implicit assumption that all repositories implement the same update semantics as the in-memory Map.

Classification: MEDIUM locally; HIGH before Sheets connection.

## 8. Service audit

createLocalRuntime creates a generic service for every schema entity. Each service:

1. assigns or validates an ID;
2. supplies default status and audit fields;
3. validates fields and declared references;
4. checks declared uniqueness;
5. inserts or updates through a repository;
6. writes a success or failure audit event;
7. returns a predictable result object.

This is useful infrastructure, but it is primarily a generic CRUD factory, not a set of domain services. It does not yet implement business invariants such as quotation arithmetic, invoice reconciliation, payment application, booking passenger membership, supplier procurement, or departure readiness.

The distinction matters: the code supports future domain services, but the presence of a service object for every entity does not mean the corresponding business capability exists.

Additional issues:

- createApi exposes only Client, Supplier, and Lead methods; the other generated services are available through runtime.services but are not exposed through the representative API.
- actor and agent are caller-supplied context values. There is no trusted identity source.
- approvalRisk is not consulted by create, update, or any other service.
- The service does not enforce allowed fields, so unknown input is persisted.
- The service does not verify that related IDs are semantically consistent across multiple foreign keys.
- Audit update details list changed field names but not old or new values.
- An audit failure can turn an otherwise completed operation into an exception after persistence, or at least prevent a successful result, depending on the audit backend.

Classification: MEDIUM for local foundation; HIGH before any real data.

## 9. Apps Script facade audit

apps-script/WmitServiceLayer.gs contains thin global wrappers for Client, Supplier, and Lead operations. WmitRuntime.gs accepts an arbitrary object through configure and returns it to the wrappers.

Positive properties:

- No direct SpreadsheetApp or DriveApp calls.
- No hard-coded production IDs.
- No production deployment was attempted.
- The facade makes the intended controlled-entry-point idea visible.

Limitations:

- The facade does not validate inputs itself.
- The facade does not normalize errors or return safe error objects.
- There is no authentication or authorization check.
- The caller can supply actor and agent values through context.
- WmitRuntime.configure trusts any injected object with matching method names.
- There is no approval or risk check.
- There is no explicit deployment surface policy, doGet policy, or trigger policy.
- The facade is therefore a boundary shape, not a security boundary.

Classification: HIGH if mistaken for a safe production API; MEDIUM as a local placeholder.

## 10. Configuration and security audit

Positive findings:

- Development and test JSON files contain blank Google IDs.
- External actions and Workspace access default to false.
- No credentials, API keys, or real production IDs were found.
- Disabled adapters fail instead of silently writing.

Problems:

- config/development/config.json and config/test/config.json are not loaded by config.js. getDefaultConfig always returns hard-coded development defaults.
- config/production/config.example.json uses non-empty placeholder strings. If those placeholders are supplied with googleWorkspaceEnabled true, the current validation accepts them.
- The adapter enablement check treats any non-empty spreadsheet or folder string as configured.
- externalActionsEnabled is never enforced by services or the Apps Script facade.
- approvalRisk is data only; it does not create approval gates.
- There is no trusted actor/authentication source.
- There is no separation between configuration selection and environment process state.

Classification: CRITICAL for future production use; no current production impact because no integration is implemented.

## 11. Test-quality audit

Required commands were run:

- node scripts/run-tests.js: 13 passed, 0 failed.
- npm.cmd test: 13 passed, 0 failed.

JavaScript syntax checks passed for 20 JavaScript files. The two Apps Script files also passed syntax parsing through the Function constructor method used for .gs files.

What the tests genuinely prove:

- Basic service creation, retrieval, update, duplicate ID rejection, and relationship failure behavior.
- Synthetic records for all 12 foundation entities can be inserted in a particular order.
- Basic ID, date, email, amount, enum, lifecycle, configuration, and disabled-adapter behavior.
- Failure results do not expose the tested passport word in audit JSON.

What they do not prove:

- Environment JSON loading, because no test loads the JSON files.
- Counter persistence, restart behavior, concurrency, or year-boundary behavior.
- Entity-specific ID generation through a service.
- Unknown-field rejection; the opposite behavior is currently accepted.
- All status transitions through the service layer.
- Payment/invoice consistency or financial arithmetic.
- Date relationship rules.
- Contact and Task polymorphic references.
- Duplicate business-key behavior separate from duplicate ID behavior.
- Old/new audit values.
- Repository substitutability or Google adapter contract compatibility.
- Authorization, approval, or actor trust.
- Durable audit storage.

The tests are independent enough for the local runtime and do not require network access. They are not false positives, but they cover a much smaller claim than production-foundation completeness.

## 12. Simplicity and overengineering audit

The architecture is not excessively over-engineered overall. A schema, validator, repository, service, and audit boundary are reasonable for this phase.

Potential simplifications or cleanup later:

- Remove or formalize the unused Repository base class.
- Avoid maintaining field definitions in executable schema, a partial JSON schema file, and long-form Markdown without a drift check.
- Consolidate repeated clone utilities.
- Keep approvalRisk and feature flags only if their enforcement plan is documented; otherwise they create a false sense of safety.
- Keep the Apps Script facade small, but do not present it as a security mechanism.
- InMemoryDriveRepository can wait until a document service exists.

The main issue is not excess abstraction. It is incomplete contracts hidden behind clean-looking abstractions.

## 13. Hidden business assumptions

These assumptions must be validated against real WMIT data before workflow implementation:

- One client has one stored source lead, even though multiple leads may belong to one client.
- A contact belongs to one polymorphic owner and the owner can be an Employee even though Employee is not modeled.
- A quotation has one lead and optional client, with no item rows.
- A booking has one client and optional quotation, with no passenger, service, departure, or supplier-booking links.
- A departure has no executable relationship to bookings or travelers.
- One invoice belongs to one booking and one client.
- One payment belongs simultaneously to one invoice, booking, and client.
- A supplier has one supplier_type.
- A task's related record can be any entity without validation.
- A document needs only client, booking, or supplier linkage.
- Lead uniqueness is determined by the combination of email, phone, and destination.
- Quotation, invoice, and payment status transitions reflect actual WMIT approval and collection practice.

These are not being redesigned in this audit. They are flagged for discovery.

## 14. AI safety audit

The intended direction is correct: future agents should call controlled services. The current implementation does not technically enforce that direction.

Potential bypasses:

- An agent running in the same Apps Script project could call SpreadsheetApp or DriveApp directly if those services are later added to the project.
- WmitRuntime.configure accepts arbitrary services and has no allowlist or contract validation.
- createLocalRuntime exposes all repositories and services to any code that receives the runtime object.
- Actor and agent identity are caller-supplied.
- Approval-risk configuration is not enforced.
- No service-level authorization or approval token exists.

Therefore the current system supports a convention of controlled operations but does not yet provide a hardened AI safety boundary.

Classification: CRITICAL before AI agents or external actions.

## 15. Recommended fixes

These are recommendations only. They were not implemented during this audit.

### Critical

1. Replace in-memory production ID counters with a single authoritative, locked, persistent allocator using Asia/Manila year handling and idempotency keys.
2. Make environment configuration operational: load exactly one selected environment file, reject placeholder IDs, and keep production disabled until explicitly enabled.
3. Enforce authorization, approval risk, and trusted actor identity outside caller-supplied context.
4. Add durable append-only audit storage with old_value and new_value fields for updates and explicit correlation IDs.
5. Add invoice number uniqueness and financial consistency validation before any finance workflow.

### High

1. Reject unknown fields or explicitly allow only a documented extension field.
2. Define and enforce polymorphic relationship resolution for Contact and Task.
3. Complete or explicitly defer lifecycle maps for Payment, Document, Departure, and other status-bearing entities.
4. Formalize repository contracts, especially update semantics, and add contract tests.
5. Add the missing structural relationships for passengers, booking services, supplier bookings, departure membership, and documents before operations work.
6. Add B2B lead fields required by the original business requirement.
7. Make the executable schema the single source or generate the JSON/Markdown representations from it.

### Medium

1. Add cross-field date and amount validation where the business rules are approved.
2. Add allowed-value lists for currently unconstrained enum fields.
3. Use configured timezone consistently for business-year IDs and timestamps.
4. Clarify whether READ events belong in the audit log or a separate access log.
5. Add tests for all identified gaps before connecting Sheets.

## 16. What should remain unchanged

- Keep the local-only/no-production-access boundary.
- Keep the general service-to-repository separation.
- Keep immutable IDs rather than row-number IDs.
- Keep synthetic test data only.
- Keep structured, user-readable errors.
- Keep the small generic CRUD layer as scaffolding, but do not mistake it for completed domain workflows.
- Keep Google Sheets and Drive behind adapters rather than embedding IDs in business logic.

## 17. What should wait until Google Workspace discovery

Do not decide yet:

- the final schema fields based only on generic travel-industry assumptions;
- migration or deduplication rules;
- actual invoice numbering compatibility;
- staff roles, permissions, and approval ownership;
- Drive metadata and folder behavior;
- whether existing Sheets should be preserved, copied, or replaced;
- whether Apps Script Properties, Sheets, or another store should hold counters;
- real Gmail, Drive, Sheets, or Calendar scopes;
- production document retention and access rules.

## Final issue summary

### Critical issues

- Non-persistent, non-concurrent ID generation.
- Environment files ignored and placeholder production IDs accepted.
- Approval and authorization controls are not enforced.
- Audit log lacks durable storage and old/new values.
- Invoice numbers and financial consistency are not protected.
- AI/service boundary is convention-only, not a security control.

### High-priority issues

- Unknown fields are stored.
- Lifecycle validation is incomplete.
- Polymorphic relationships are unchecked.
- Repository contracts are not proven against a replaceable adapter.
- Core travel relationships are missing from the executable foundation schema.
- B2B lead fields are incomplete.

### Medium issues

- Schema definitions can drift across JavaScript, JSON, and Markdown.
- Cross-field validation is absent.
- Several enum fields have no allowed values.
- Business timezone is not used by ID year generation.
- Generic services are presented more broadly than their domain behavior warrants.

### Low issues

- Unused Repository base class.
- Unused InMemoryDriveRepository.
- Repeated clone helpers.
- READ events may be noisy in the same audit stream as mutations.

### No issues

- No production Google Workspace resources were touched.
- No secrets or real client data were found.
- Synthetic fixtures are clearly fictional.
- Local tests run without network or Google Workspace access.
- Basic service error results are predictable and readable.

## Recommended next action

Do not build Phase 2 yet. First perform the critical hardening fixes listed above, beginning with configuration loading, ID allocation design, authorization/approval enforcement, and durable audit semantics. Only after those are reviewed should the owner proceed to read-only Google Workspace discovery and schema comparison against real WMIT files.
