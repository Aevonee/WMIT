# WMIT Implementation Plan

> **SUPERSEDED / NON-EXECUTABLE:** Use [implementation-plan-v1.2.md](implementation-plan-v1.2.md) for all current dependency order and Phase 1 meaning. This file cannot authorize implementation.

Status: **FINAL PRE-IMPLEMENTATION PLAN — OWNER REVIEW REQUIRED**  
Authority: [Baseline v1.1](baseline-v1.1.md)  
Code-grounded redesign: [prototype-redesign-plan.md](prototype-redesign-plan.md)  
Consolidated handoff: [BASELINE-HANDOFF.md](BASELINE-HANDOFF.md)

This document translates the approved business architecture and inspected prototype into an executable future sequence. It is not an authorization to implement. No source code, schema, UI, tests, configuration, integrations, attendance code, or migrations should be changed until this plan is reviewed and explicitly approved.

## 1. Implementation objective

Build a controlled WMIT Operations system that preserves the actual business distinctions:

```text
Inquiry
→ researched Commercial Options and evidence
→ WMIT Quotation
→ client decision
→ Booking
→ Supplier Booking(s)
→ client obligations/payments and Supplier Payables
→ documents, vouchers, tasks, departures, and closeout
```

The system must reduce tariff-search effort, missed follow-ups, payment confusion, voucher delay, and pricing errors without becoming a full accounting system, autonomous booking agent, universal tariff language, or unrestricted AI database editor.

## 2. Readiness gates before implementation

### Required before any production implementation — BLOCKING

1. Owner approval of this plan and Baseline v1.1.
2. Trusted authentication and authorization design for controlled services.
3. A decision on which staff roles may mark a Booking client-confirmed and/or request a Supplier reservation before client payment. This blocks permission enforcement, but does not block designing the Booking/Supplier Booking entities or their separate states.
4. Approval of the first synthetic test data set and six-case regression scenarios.
5. Agreement that Google Workspace remains unavailable until read-only discovery is separately approved.

### Safe to defer without blocking the first slice

- exact approval thresholds by amount/product;
- refund/adjustment approval thresholds;
- audit and sensitive-document retention periods;
- exact fee/tax/FX/refund treatment in Updated Operational Margin;
- exact pre-invoice payment target behavior, provided an extensible obligation target is designed;
- staged traveler-data requirements by service/destination;
- exact client-price amendment policy after confirmation;
- Supplier-specific deadline templates;
- global cross-Supplier search;
- full channel ingestion;
- production Google Sheets/Drive persistence;
- AI automation beyond reviewable drafts.

These decisions must not be silently guessed. They can remain explicit policy configuration or controlled placeholders while the core domain is implemented.

## 3. Target domain model

### 3.1 Identifier rules

Every persisted business record receives a centrally generated, immutable, human-readable ID. IDs are generated using the WMIT business timezone and transactional/collision-safe counters. Relationships use immutable IDs, not names.

The future implementation should preserve the prototype’s ID format direction but must not treat the current prefixes or year rules as final until the domain contract is approved.

### 3.2 Persistence conventions

| Value type | Persisted? | Rule |
|---|---:|---|
| Original Inquiry facts | Yes | Never silently overwrite; use change history/versioning for material changes. |
| Source documents and provenance | Yes | Retain source file metadata, extraction runs, versions, and links. |
| Commercial Option research | Yes when material | Persist presented, accepted, rejected, unavailable, superseded, or quotation/Booking-supporting options. Casual searches may remain activities. |
| Availability checks | Yes when presentation/commitment-relevant | Retain source, time, requested conditions, result, expiry/hold terms, and evidence. |
| Calculated prices and cost snapshots | Yes | Preserve rule version, inputs, calculated values, actual overrides, actor, time, and reason. |
| Client balance | Derived | Calculate from obligations, verified allocations, approved credits/refunds; do not treat editable summary as source of truth. |
| Supplier outstanding | Derived | Calculate from Supplier Payable components, verified Supplier Payments, credits/refunds. |
| Operational margin | Derived plus calculation snapshots | Derive from persisted source values; retain snapshots for quotation/Booking review and audit. |
| Readiness and dashboard counts | Derived | Rebuild from states, tasks, documents, deadlines, and evidence. |
| Audit/action history | Yes, append-only | Persist meaningful actions, approvals, state changes, and failures. |

### 3.3 Core entities

| Entity | Purpose | Key persisted fields | Derived values/views |
|---|---|---|---|
| Client | Ongoing customer relationship. | `client_id`, type, legal/display name, contact references, VIP/repeat indicators, status, audit. | Client history, active bookings, balances, outstanding work. |
| Person | Human identity independent of customer/trip role. | `person_id`, names, contact channels, staged traveler fields, sensitivity, audit. | Client/person matches and role summaries. |
| Inquiry | Original client request and branching opportunity. | `inquiry_id`, received/source channel, original destination/dates/budget/pax/services, client/person links, owner, status, audit. | Current request view, follow-up status, conversion summary. |
| Inquiry Participant | Role relationship for Inquiry. | `inquiry_participant_id`, Inquiry, Person, roles such as coordinator/payer/traveler/communicator, effective dates, notes. | Group/role projections. |
| Communication Activity | Lightweight interaction log. | `activity_id`, channel, timestamp, actor, participants, source/thread reference, summary, related IDs, attachments. | Timeline and last-contact/follow-up views. |
| Supplier | Umbrella provider. | `supplier_id`, legal/display name, capabilities, contacts, terms, currencies, status, audit. | Supplier performance/usage summaries. |
| Supplier Package | Ready-made supplier-originated product. | `supplier_package_id`, Supplier, product/departure reference, destination/dates, inclusions, source price, validity, capacity/terms, cancellation terms, source documents, revision. | Package availability/readiness summaries. |
| Supplier Tariff Document/Version | Versioned source tariff. | `supplier_tariff_id`, Supplier, source Document, revision, scope, validity/effective periods, authority/review/supersession status, conflict flags. | Current approved tariff view. |
| Structured Tariff Rate | Conditional/matrix rate component. | `tariff_rate_id`, tariff version, conditions, amount/currency, unit basis, quantity driver, component type, provenance, ambiguity/review state. | Applicable candidate rates and warnings. |
| Tariff Itinerary | Structured itinerary information from a tariff. | `tariff_itinerary_id`, tariff version, day/date/city, service/activity, meals, overnight, notes, provenance. | Draft itinerary for Option/Quotation. |
| Commercial Option | Researched/presentable solution. | `option_id`, Inquiry, option type, source Package/Tariff/quote, dates/destination/pax/services, availability state, source references, staff notes, response, lineage. | Find More Options results and comparison views. |
| Availability Evidence | Evidence for availability state. | `availability_id`, Option/Booking Item, source, checked time, dates/quantity, result, expiry/hold terms, response/reference, evidence Document, reviewer. | Availability qualification and stale warnings. |
| WMIT Quotation | Client-facing proposal with internal provenance. | `quotation_id`, Inquiry/Option, date/validity, items, currency, calculated cost/markup/fees/discounts, actual quoted value, override data, availability qualification, review/send state, audit. | Client-safe projection, margin preview, quotation status. |
| Quotation Item | Priced service/fee component. | `quotation_item_id`, quotation, source references, service type/description, quantity, dates, cost, selling, fees/discounts, currency, rule snapshot, line order. | Quotation totals and client lines. |
| Booking | Actual selected/committed arrangement. | `booking_id`, Inquiry/Option/Quotation links, client, dates/destination, commitment state, amendment/cancellation links, audit. | Payment, fulfillment, readiness, margin, and exception views. |
| Booking Participant | Role relationship for Booking. | `booking_participant_id`, Booking, Person, roles, traveler requirements/state, notes. | Traveler/Coordinator/Payer summaries. |
| Booking Item | One component of a Booking. | `booking_item_id`, Booking, source Option/Quotation Item, service, Supplier, dates/quantity, expected/confirmed cost, client amount, fulfillment state, Departure membership, cancellation terms. | Booking totals and item readiness. |
| Supplier Booking | Supplier-side request/reservation/confirmation. | `supplier_booking_id`, Supplier, Booking, references, linked items, request/reservation/confirmation state, evidence, terms, cost, deadlines, failure/amendment history. | Supplier fulfillment and risk view. |
| Supplier Booking Item | Join between Supplier Booking and Booking Item. | `supplier_booking_item_id`, Supplier Booking, Booking Item, allocated cost, allocation history, notes. | Cost/fulfillment allocation. |
| Departure | Shared supplier/group departure. | `departure_id`, Supplier/reference, destination/dates, capacity, source documents, status. | Booking/item membership, traveler count, readiness, deadlines. |
| Departure Membership | Item-first grouping relationship. | `departure_membership_id`, Departure, Booking Item, membership state, source/reference, audit. | Departure-level operational summary. |
| Client Obligation/Invoice | Client-facing or operational amount due. | `obligation_id`/`invoice_id`, client, Booking/Items, line items, due schedule, total, credits/refunds, state, document references. | Client balance and due alerts. |
| Client Payment | Receipt/report of client money. | `payment_id`, client, amount/currency/date/method/reference, proof Document, verification state, conversion snapshot, audit. | Verified/unallocated totals. |
| Payment Allocation | Payment application ledger. | `allocation_id`, payment, target obligation/Booking/approved target, amount/currency, actor/time, state, reallocation history. | Client balance by Booking/obligation. |
| Supplier Payable | WMIT obligation to Supplier. | `payable_id`, Supplier/Supplier Booking/Items, expected/confirmed cost, deposit/final components, deadlines, terms, credits/refunds, state. | Supplier outstanding and deadlines. |
| Supplier Payment | WMIT payment to Supplier. | `supplier_payment_id`, payable, Supplier, amount/currency/date/method, proof, verification, approval, audit. | Payable paid/outstanding values. |
| Refund/Credit/Adjustment | Approved financial outcome. | `adjustment_id`, side (client/Supplier), source Booking/Payment/Payable, amount, reason, terms/evidence, approval, date, state. | Net retained/refunded and margin impact. |
| Document | Received/generated file metadata. | `document_id`, source/channel, type, storage reference, owner, dates, sensitivity, classification/extraction/review/supersession state, checksum, audit. | Current document and readiness projections. |
| Document Link | Controlled many-to-many record link. | `document_link_id`, Document, related type/ID, relationship type, audit. | Evidence graph. |
| Task | Operational action/deadline. | `task_id`, type, title, owner, related record, due time, source deadline, state, reminder history, priority, audit. | Due/due-soon/attention queues. |
| Audit Event | Append-only action history. | `audit_id`, trusted actor, action, record, timestamp, old/new values, result, reason, approval, error. | Audit trails and change history. |

## 4. State model and transitions

All transitions require a trusted actor, valid current state, required evidence, audit event, and idempotent/retry-safe behavior.

### 4.1 Transition authority

| Actor | May perform by default |
|---|---|
| Admin/Owner | All approved operational and high-impact actions, subject to audit; exact thresholds remain policy. |
| Manager | Operational changes and configured approvals for pricing exceptions, Supplier reservations, Supplier Payments, refunds, and sensitive access. |
| Staff | Ordinary Inquiry, Option, Quotation, Booking preparation, Supplier coordination, Task, Document, and payment-entry work within policy. |
| Intern | Assigned low-risk operational work and drafts only; no default commitments, payments, refunds, sensitive documents, or cost/margin visibility. |

The exact role allowed to mark client-confirmed or request Supplier reservation before client payment is an unresolved authorization policy. The state dimensions and relationships are not unresolved.

### 4.2 Independent state transitions

| State dimension | Core transitions | Evidence/conditions | Authority |
|---|---|---|---|
| Inquiry | New → Contacted → Clarifying/Researching → Options ready → Awaiting client → Converted/Closed/Cancelled | Source activity, request facts, option/decision/closure reason. | Staff; Manager review for exceptions. |
| Commercial Option | Researched → Ready to present → Presented → Accepted/Rejected/Superseded/Unavailable/Expired | Source, option facts, client response, availability evidence where required. | Staff; Manager for commercial exceptions. |
| Availability | Not Checked → Checking → Available/Unavailable/Unknown/Held/Expired | Authorized source response, timestamp, dates, quantity, expiry/hold terms. No AI inference. | Staff records; authorized source process may supply evidence. |
| Client decision | No decision → Interested/Clarification → Selected/Accepted → Declined/Changed/Withdrawn | Communication or approved client evidence. | Staff records; Manager review for disputed/high-impact interpretation. |
| Quotation | Draft → Internally reviewed → Sent/Awaiting client → Accepted/Rejected/Expired/Superseded/Withdrawn | Complete items, pricing review, client-safe projection, validity, availability qualification. | Staff drafts; Manager approval where policy requires. |
| Booking commitment | Draft → Client-selected → Client-confirmed/Confirmed under WMIT policy → Changed/Cancelled/Completed | Client decision, required policy condition, approval for exception, amendment/cancellation evidence. | Role policy unresolved; Manager/Admin approvals for exceptions. |
| Client payment receipt | Entered/Reported → Evidence pending → Pending verification → Verified/Rejected/Reversed/Refunded | Payment proof/evidence, verifier decision, reversal/refund document. | Staff enters; authorized verifier verifies; Manager/Admin for exceptions/refunds. |
| Client obligation | Unpaid → Partially paid/Deposit sufficient → Fully paid/Credited/Refunded/Needs attention | Verified allocated payments and approved credits/refunds. | Derived; state-changing events require authorized users. |
| Supplier fulfillment | Not requested → Request prepared → Requested → Reservation placed → Awaiting confirmation → Confirmed/Failed/Amended/Cancelled/Completed | Supplier request/reference, reservation/confirmation evidence, failure/cancellation terms. | Staff within policy; Manager/Admin for reserve-before-payment/external commitments. |
| Supplier Payable | Expected → Deposit due → Partially payable/paid → Final balance due → Paid/Disputed/Cancelled/Refund-credit pending/Closed | Supplier terms, invoice, payment proof, credit/refund evidence. | Staff records source facts; authorized finance/Manager verifies payments/adjustments. |
| Supplier Payment | Prepared → Approved → Paid/Verified → Reversed/Refunded | Verified client money, payable target, payment proof, approval. | Manager/Admin or configured finance authority. |
| Document | Expected → Requested/Received → Classified → Needs review → Accepted for use → Sent/Superseded/Missing | File metadata, classification/extraction review, sensitivity authorization, send evidence. | Staff; Manager/Admin for sensitive documents. |
| Task | Pending → Due soon/Due → Awaiting client/supplier/internal → Requires attention → Completed/Cancelled | Due date, owner, outcome/evidence, idempotent reminders. | Assigned staff; Manager escalates/overrides. |
| Readiness | Not started → Preparing → Awaiting docs/payment/confirmation/PDOS → Ready with exceptions → Ready → Departed/Closed | Derived checklist across states, documents, tasks, balances, and approvals. | Staff updates inputs; Manager reviews exceptions. |

## 5. Tariff automation implementation design

### 5.1 Phase 1 tariff automation

Phase 1 is a controlled, supplier-scoped decision-support workflow:

1. Ingest uploaded Supplier tariff file metadata.
2. Classify source/document type.
3. Extract structured fields with raw value, normalized value, confidence, warnings, and provenance.
4. Create a human/reviewable Supplier Tariff version; do not make it authoritative automatically.
5. Preserve supplier-specific structures and map only validated fields into the common searchable envelope.
6. Staff enters client requirements: destination, dates, nights, pax/adult/child/infant, rooms, hotel/category, meal plan, transfers, tours, and other needs.
7. Staff selects Supplier and tariff scope.
8. Matcher searches that selected library only.
9. Return multiple potential Options with rate components, conditions, sources, validity, and warnings.
10. Calculate draft costs using actual units, quantities, seasons, supplements, room/pax rules, transfer basis, and itinerary components.
11. Staff chooses the option.
12. Apply configurable WMIT rules: applicable 30% custom tariff markup, BDO Forex Selling Rate + 1.0 conversion fee, 5% card/PayPal fee, variable visa assistance, explicit discounts, and other approved fees.
13. Produce a draft WMIT Quotation retaining calculated values and provenance.
14. Staff reviews/overrides; only then can a final client-facing quotation be produced or sent.

### 5.2 Required warnings

- unclear unit basis, such as `Transfer USD 50`;
- per-person/per-vehicle or one-way/round-trip ambiguity;
- requested date outside tariff validity;
- pax outside a rate band;
- missing room, child, meal, season, supplement, or compulsory-charge condition;
- conflicting tariff revisions;
- incomplete or low-confidence extraction;
- availability not checked, stale, unknown, or unsupported by evidence.

### 5.3 Phase 2 tariff automation

Phase 2 may add global cross-Supplier search and comparison after Phase 1 is reliable. It must still show multiple options, preserve provenance, flag comparability issues, and require staff choice. It must not choose cheapest/highest-margin/best Supplier automatically.

A giant universal tariff language is explicitly out of scope. The implementation should use the smallest validated common envelope plus Supplier-specific extraction/matching adapters.

## 6. Financial workflow

```text
Client pays/reports payment
→ staff records Client Payment
→ proof/evidence attached
→ authorized verifier verifies/rejects
→ staff/client allocation recorded
→ Client balance derived
→ Supplier Payable tracked
→ Supplier Payment prepared only after client money received
→ Supplier Payment approved, evidenced, verified
→ refund/credit/penalty handled separately if needed
→ Expected/Updated Operational Margin recalculated from source facts
```

Rules:

- Payment receipt is immutable history.
- Proof/evidence is required for verification.
- Unverified/unallocated money remains visible but does not silently reduce final balances.
- One payment may be split across multiple obligations/Bookings.
- Supplier Payable is independent of Supplier Booking and supports deposit/final components and deadlines.
- Supplier Payment is not a client payment and does not reduce client balance.
- Supplier Payment requires received client money and configured authorization.
- Refunds/credits/penalties are additive records with approval and evidence.
- Margin is operational, not accounting profit.

## 7. Permissions and field-level restrictions

### Admin/Owner

Full operational and sensitive visibility; may approve/execute configured high-impact actions. Destructive actions remain separately controlled and audited.

### Manager

Broad operational visibility; reviews/approves pricing exceptions, client-confirmed/reserve-before-payment policy actions, Supplier Payments, refunds, adjustments, sensitive documents, and major Booking changes.

### Staff

Creates and manages Inquiries, Options, Quotations, Bookings, Supplier coordination, Tasks, Documents, and payment entries within policy. Cost/markup visibility and payment verification authority are policy-controlled and must not be assumed from the role name.

### Intern

Assigned, restricted operational work and drafts. No default access to supplier cost, markup/margin, payment proof, refunds, Supplier Purchases/Payments, passports/identity documents, sensitive client financial data, or unrestricted audit history.

### Sensitive field classes

- supplier costs and supplier payment terms;
- calculated markup, margin, and financial adjustments;
- client payment proof and financial data;
- passports, identity documents, and sensitive traveler data;
- internal notes and restricted supplier documents;
- approval/audit details.

Authorization must be enforced at the service/projection boundary, not only by hiding UI fields.

## 8. UI redesign

### Navigation

1. Action Dashboard
2. Inquiries
3. Options and Availability
4. Quotations
5. Bookings
6. Supplier Fulfillment
7. Finance
8. Documents and Vouchers
9. Tasks and Deadlines
10. Departures
11. People and Suppliers

Attendance remains outside the travel-operations navigation.

### Inquiry workspace

When staff opens an Inquiry, show:

- immutable original request;
- current/revised request history;
- people and explicit roles;
- communication timeline;
- Commercial Options, availability evidence, and prior responses;
- Find More Options action;
- quotations and selected Booking(s);
- follow-up tasks, ownership, and next action;
- unresolved/ambiguous fields.

### Booking workspace

When staff opens a Booking, show separate panels for:

- client commitment/decision;
- client payment/verification/allocation/balance;
- Booking Items and each Supplier;
- Supplier Bookings and confirmation evidence;
- Supplier Payables and deadlines;
- documents/vouchers;
- participants and traveler readiness;
- amendments/cancellations/refunds;
- Departure membership;
- expected/updated operational margin;
- tasks and exceptions.

### Supplier Booking workspace

Show Supplier, linked Booking Items, request/reservation/confirmation state, supplier reference, evidence, terms, deadlines, reserve-before-payment risk/approval, Supplier Payable components, Supplier Payments, amendments, failure, and cancellation outcomes.

### Finance workspace

Show client obligations, payment receipts, proof state, verification queue, allocation queue, unallocated money, client balance, Supplier Payables, Supplier Payment approvals, refunds/credits, and operational margin components. Never equate paid cash with profit.

### Tariff/Option workspace

Show selected Supplier/tariff scope, staff requirements, matching candidates, source/version, validity, unit basis, warnings, calculated components, staff selection, pricing rules, draft quotation, and review status.

## 9. Migration strategy

### Synthetic prototype

No migration is necessary. Current demo records are synthetic and should be discarded/reseeded for future tests rather than migrated into a production model.

### Future real-data migration, if authorized

1. Perform read-only source discovery first.
2. Freeze and export source records/files with provenance.
3. Map Lead → Inquiry, Contact/Traveler → Person and role relationships, Quotation → WMIT Quotation, existing Booking/Items → revised Booking model, SupplierBooking → Supplier Booking, Invoice/Payment → historical obligations/receipts.
4. Add new concepts only where evidence exists; do not infer Availability, Payment Allocation, Payables, Refunds, or role assignments from missing fields.
5. Mark uncertain mappings as legacy/provisional and create review tasks.
6. Preserve original IDs and source documents where possible; never overwrite source files.
7. Validate migrated records against the six canonical cases and financial reconciliation checks.

## 10. Implementation sequence

### Phase 0 — Architecture contracts

Scope: approve v1.1, this plan, status contracts, ID/audit contract, role policy boundary, synthetic fixtures, and service/projection security boundary.

Exit criteria: owner approval; no blocking ambiguity about domain relationships; policy placeholders explicitly documented.

### Phase 1 — Core domain and infrastructure

Scope: Person/Client/Supplier, IDs, repositories, audit, validation, record versions, controlled service boundary, Inquiry/participant relationship foundations.

Dependencies: Phase 0.

Exit criteria: create/read/update flows are controlled, audited, role-filtered, retry-safe, and tested with synthetic data.

### Phase 2 — Inquiry, Options, Availability

Scope: Inquiry original facts/history, Communication Activity, Commercial Option, Supplier Package, Supplier Tariff source/version, Availability Evidence, Find More Options, Tasks.

Dependencies: Phase 1.

Exit criteria: Messenger changed-request case works; package availability is checked before presentation; rejected/unavailable/superseded options are not silently repeated.

### Phase 3 — Quotation and tariff matching

Scope: WMIT Quotation/Items, pricing rules, override history, staff requirements, supplier-scoped tariff extraction/review/matching, multiple options, warnings, draft calculation, staff selection, draft/final review flow.

Dependencies: Phase 2; document-intelligence foundation; exact money helpers.

Exit criteria: custom tariff case works without implying availability; ambiguous/out-of-validity rates are flagged; no automatic supplier/product selection or quotation sending.

### Phase 4 — Booking and Supplier Fulfillment

Scope: Booking, Booking Items, participant roles, Supplier Booking(s), Supplier Booking Items, independent state dimensions, amendments, cancellation groundwork, supplier failure alternatives, deadline tasks, Departure Membership.

Dependencies: Phases 1–3; role policy may remain configured but must be enforced before commitments.

Exit criteria: mixed-Supplier Booking, group roles, reservation-before-payment, and supplier-failure cases are representable and audited.

### Phase 5 — Payments and Supplier Payables

Scope: client obligations/invoices, Client Payments, proof, verification, Payment Allocations, unallocated/split/installments, Supplier Payables/components, Supplier Payments, refund/credit/penalty history, operational margin.

Dependencies: Phase 4; trusted authorization; payment policy placeholders.

Exit criteria: reservation-before-payment/installment case works; payment entry no longer silently produces verified balances; Supplier Payment requires received client money and authorization.

### Phase 6 — Documents, Tasks, and Vouchers

Scope: document provenance/sensitivity/supersession, payment proof, review-first extraction, voucher generation/update/review/send, readiness, idempotent alerts, PDOS/pre-departure tasks.

Dependencies: Phases 2–5; storage boundary and permissions.

Exit criteria: supplier failure/cancellation and voucher workflows retain evidence, approvals, and history; sensitive projections are role-filtered.

### Phase 7 — Departure and management views

Scope: Departure grouping, item-first memberships, derived group counts/readiness, management exception dashboards, operational margin summaries.

Dependencies: Phases 4–6.

Exit criteria: shared Departure groups independent Bookings without financial consolidation.

### Phase 8 — AI and broader automation

Scope: safe classification/extraction assistance, matching suggestions, summaries, reminders, draft documents, and manager reporting.

Dependencies: all preceding phases, audit, permissions, observability, rollback, and real-data validation.

Exit criteria: AI outputs cite source records and confidence; no autonomous financial, supplier, refund, availability, pricing, or client-facing actions.

## 11. Testing strategy

Every phase must test valid input, missing input, invalid IDs, duplicates, conflicting data, retries/idempotency, partial failures, permissions, audit events, and recovery.

### Canonical regression scenarios

1. Messenger August request → October wholesaler package.
2. DMC tariff plus airfare custom quotation before availability.
3. Coordinator/payer/travelers group.
4. Mixed-Supplier Booking.
5. Supplier reservation before payment plus installments.
6. Supplier failure, alternatives, cancellation, penalties, refunds, and credits.

### Tariff tests

- supplier-specific structures;
- hotel/category/room/date/pax/season matrices;
- explicit per-person/per-way overrides;
- ambiguous units;
- out-of-validity dates;
- overlapping revisions;
- multiple options;
- staff requirements and option selection;
- exact calculations;
- no automatic quotation/selection/send.

### Financial tests

- proof missing/rejected/verified;
- unallocated/split/reallocated payments;
- installments;
- Supplier Payable deposit/final components;
- Supplier Payment blocked before client money;
- refunds/credits preserve original receipts;
- margin is not cash received.

## 12. Explicit do-not-build-yet list

- full accounting ledger, tax compliance, revenue recognition, payroll, or statutory reporting;
- Google Drive/Sheets production integration or migration;
- live availability or live pricing without authorized verified sources;
- automatic Supplier purchasing, payments, refunds, or client messages;
- universal tariff language;
- global cross-Supplier tariff search before scoped matching is reliable;
- autonomous Supplier/product selection;
- full Messenger/WhatsApp/Viber/email ingestion;
- automatic quotation sending from extraction or matching;
- unrestricted AI agents editing Sheets or business records;
- attendance, HR, intern attendance, or payroll expansion;
- separate Trip, Travel Party, or Voucher aggregates without new evidence;
- implementation immediately after this plan without owner review.

## 13. Final stop condition

This plan is the final pre-implementation artifact. Return it for owner review. Do not begin coding, schema changes, migrations, UI redesign, tests, integrations, or configuration changes until explicit approval is received.
