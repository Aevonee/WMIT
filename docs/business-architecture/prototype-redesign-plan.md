# WMIT Prototype Redesign Plan to Baseline v1

> **NON-EXECUTABLE SUPPORTING CODE MAP:** [BASELINE-HANDOFF.md](BASELINE-HANDOFF.md) and [implementation-plan-v1.2.md](implementation-plan-v1.2.md) control. This document identifies reusable technical foundations only; its old phase order, defaults, and supplier-scope wording cannot be executed.

> **Updated authority:** use [baseline-v1.1.md](baseline-v1.1.md). Baseline v1.1 supersedes earlier v1 classifications where the owner has now explicitly answered a rule.

Status: **EXACT FUTURE REDESIGN PLAN — NO IMPLEMENTATION AUTHORIZED**  
Target: current local WMIT Operations prototype → [Business Architecture Baseline v1](baseline-v1.md)

This document is a mapping and sequencing plan. It intentionally contains no code, schema edits, migration scripts, UI edits, or implementation commands.

## 1. Current prototype assessed

The prototype is a local in-memory Node.js application with a generic entity-service layer, strict record validation, lifecycle transitions, ID generation, audit events, document intelligence, quotation arithmetic/editor, a local HTTP API, and a single-page UI. It is a synthetic vertical slice, not a production system.

Observed workflow:

```text
Lead → Quotation → Quotation Item → Booking → Booking Item
     → Supplier Booking → Invoice → Payment
```

The prototype has no first-class Inquiry, Commercial Option, Supplier Package, Availability Evidence, Person, Payment Allocation, Supplier Payable, Refund, Amendment, Cancellation, Communication Activity, or operational Departure membership model.

The current contract is staff-requirements-first: uploaded Supplier documents become classified, extracted, human/reviewable tariff records; staff then enters client requirements; an optional supplier/tariff scope may narrow the search but is not required; the matcher returns multiple potential options and warnings; staff chooses; WMIT pricing produces a draft quotation; staff reviews the final client-facing quotation. No tariff extraction may directly create a quotation.

## 2. Classification rules

- **KEEP** — retain the concept and technical foundation with no semantic replacement.
- **MODIFY** — retain identity/direction but change fields, relationships, behavior, or state model.
- **REPLACE** — current primary meaning conflicts with Baseline v1; future concept takes over.
- **REMOVE/DEFER** — not part of the future travel-operations core or not justified now.
- **MERGE** — combine overlapping current concepts into one baseline concept.
- **SPLIT** — separate one overloaded current concept into independent baseline concepts.
- **UNKNOWN / NEEDS VALIDATION** — repository evidence is insufficient for a safe classification.

## 3. Current entity → Baseline v1 mapping

| Current prototype entity | Classification | Baseline target | Required change |
|---|---|---|---|
| Client | KEEP / MODIFY | Client | Keep ongoing relationship and recurring/VIP support. Remove reliance on `source_lead_id` as the primary history link; link Client to many Inquiries/Bookings. |
| Contact | REPLACE / SPLIT | Person + participant/contact relationship + Communication Activity | Current Contact is only Client/Supplier contact data. Split human identity from role, channel, and interaction. Preserve reusable contact data only after mapping. |
| Traveler | MODIFY | Person plus Booking participant/traveler role | Do not make Traveler the identity owner. Staged sensitive fields; Booking role identifies actual traveler. |
| Lead | REPLACE / MAP | Inquiry | Preserve incoming source/request semantics but remove Lead pipeline as the business root. B2B is not an inquiry source. Keep a compatibility mapping only during future transition. |
| Quotation | MODIFY | WMIT Quotation | Remove required Lead parent assumption; link to Inquiry/Commercial Option and retain source/provenance, availability qualification, calculated/actual pricing, overrides, and client-safe projection. |
| QuotationItem | MODIFY | Quotation Item | Keep multi-service detail. Add source option/tariff/package references, fees/charges, pricing snapshots, and clearer distinction from Booking Item. |
| Booking | MODIFY | Booking | Keep core record. Split single `status` into client decision/commitment, client payment projection, supplier fulfillment, document/readiness, cancellation/amendment, and approval evidence. Support direct/alternative creation and multiple Bookings per Inquiry. |
| BookingTraveler | SPLIT / MODIFY | Inquiry/Booking participant relationships | Keep relationship-table technique, but allow coordinator, payer, traveler, and other roles; remove assumption that every participant is a Traveler identity. |
| BookingItem | KEEP / MODIFY | Booking Item | Strong foundation. Add independent cost/selling snapshots, source option, departure membership, amendment lineage, fulfillment state, and service-specific cancellation terms. |
| Departure | MODIFY | Departure + Departure Membership | Keep concept but remove manual single Booking ownership as the semantic model. Use item-first memberships and derived group summaries; no financial consolidation. |
| Supplier | MODIFY | Supplier | Keep umbrella concept. Replace free-text singular `supplier_type` with capabilities/roles and supplier-specific terms/contacts/products. Do not create separate wholesaler/DMC systems. |
| SupplierTariff | MODIFY | Supplier Tariff version/library | Keep source direction. Replace flat fields with versioned structured conditional rate components, validity/effective periods, review/authority/supersession, itinerary data, and ambiguity/provenance. |
| SupplierBooking | MODIFY | Supplier Booking | Keep separate supplier-side record. Add reservation-before-payment risk/policy, evidence, fulfillment dimensions, amendments/failures, and payable relationships. |
| SupplierBookingItem | KEEP / MODIFY | Supplier Booking Item | Strong join foundation. Support split/successive fulfillment and cost allocation history; preserve booking-consistency validation. |
| Invoice | MODIFY | Client Invoice / Client Obligation | Keep client billing direction. Separate obligation/balance projections from raw payment receipts; support multiple obligations/invoices and multiple Bookings without assuming one invoice per Booking. |
| InvoiceItem | MODIFY | Client Obligation Item | Preserve item detail and amount arithmetic; support Booking/Booking Item targets and credits/refunds/amendments. |
| InvoiceBooking | KEEP / MODIFY | Obligation/Booking relationship | Retain normalized many-to-many link, but stop treating `booking_id` on Invoice as the only relationship. |
| Payment | SPLIT / MODIFY | Client Payment + Supplier Payment + Payment Verification + Payment Allocation | Current direction field is useful but overloaded. Separate receipt/payment history, proof, verification, target allocation, refund/reversal, and supplier payable application. |
| Document | MODIFY | Document | Keep metadata/review-first direction. Add source channel, sensitivity, owner, supersession/current state, many-to-many links to all relevant records, payment evidence, tariff provenance, and voucher workflow. |
| DocumentLink | KEEP / MODIFY | Document relationships | Keep controlled link idea; expand allowed related record types and enforce sensitivity/authorization. |
| Task | MODIFY | Task/Follow-up | Keep entity. Add typed task category, neutral status, reminder idempotency, deadline source, ownership, escalation, and related record validation. |
| Supplier Payable | ADD | Supplier Payable | New first-class operational obligation, preferably with components/schedules. Must not be derived only from `SupplierBooking.balance` long-term. |
| Commercial Option | ADD | Commercial Option | New persistent material research/presentation record with alternative/rejection/unavailable lineage. |
| Supplier Package | ADD | Supplier Package | New supplier-originated product record, separate from Quotation and Booking. |
| Availability Evidence | ADD | Availability Evidence | New evidence record with source, check time, dates, quantity, result, expiry/hold terms, and confidence/unknown state. |
| Payment Allocation | ADD | Payment Allocation | New explicit allocation ledger supporting unallocated, split, reallocation, and verification dependencies. |
| Refund/Credit | ADD | Refund/Credit/Adjustment | New approved transaction/history; preserve original payments and supplier credits separately. |
| Amendment/Cancellation | ADD | Amendment and cancellation history | New history records/relationships, not silent field overwrites. |
| Communication Activity | ADD | Communication Activity | New lightweight interaction log; no full channel ingestion in MVP. |
| Profit projection | REPLACE | Expected/Updated Operational Margin | Replace implicit markup-only reporting with labeled projections and component snapshots. |
| Voucher | REMOVE as entity / MODIFY workflow | Document subtype/output | Retain voucher document records and readiness/send workflow; do not create separate core Voucher aggregate. |
| Travel Party / Trip | REMOVE/DEFER | Participant relationships only | Do not introduce unless future evidence proves an independent reusable grouping is needed. |
| Attendance | REMOVE/DEFER / ISOLATE | Outside travel-operations baseline | Preserve existing attendance code/tests as out of scope; do not redesign or include in the travel domain. |

## 4. Current services and application functions

| Current module/function | Classification | Future target | Redesign requirement |
|---|---|---|---|
| `src/services/entity-service.js` | KEEP AS SCAFFOLDING / MODIFY | Controlled domain services | Generic CRUD remains useful for local synthetic tests but cannot enforce all cross-record business invariants. Add domain-specific application services later. |
| `src/services/index.js` | MODIFY | Service registry/API boundary | Register new domain services and explicit capabilities; do not expose arbitrary write access. |
| `src/application/operations-mvp.js` | REPLACE / SPLIT | Inquiry, commercial, booking, fulfillment, financial, documents, tasks services | Break the Lead-centric orchestration into controlled use cases. Preserve exact arithmetic and result/error conventions where safe. |
| `createLead` / `updateLead` / `getLead` | REPLACE / MAP | Inquiry capture/update/activity | Retain a compatibility adapter only if needed; new use case records original inquiry, people/roles, source, and follow-up. |
| `createQuotationFromLead` | REPLACE | Create WMIT Quotation from Inquiry/Option | Must support package and custom paths, including quotation before availability and no mandatory Lead. |
| quotation editor/totals | KEEP CALCULATION / MODIFY DOMAIN | Pricing calculation + Quotation review | Keep exact money arithmetic and client-preview separation. Add configurable rules, price override history, source/availability warnings, and cost/price snapshots. |
| `createBookingFromQuotation` | MODIFY / REPLACE | Select Option/Quotation → create/update Booking | Must record actual selected arrangement, client decision, participants, amendment lineage, and independent commitment/payment/supplier states. |
| `addBookingTraveler` | MODIFY | Add participant role | Support coordinator/payer/traveler/other roles on Inquiry and Booking. |
| `createSupplierBookingFromBookingItem` | MODIFY | Request/reserve Supplier Booking | Support one Supplier Booking for many items, successive replacements, evidence, deadlines, reserve-before-payment flag/approval, and payable creation. |
| `createInvoiceFromBooking` | MODIFY | Create client obligation/invoice | Support multiple Booking/Item relationships, deposits/installments, source pricing, credits, and non-payment of an invoice as distinct from payment receipt. |
| `recordPaymentFromInvoice` | REPLACE | Record Client Payment → verify → allocate | Must not update final invoice balance from unverified/unallocated rows. Support payments before or across obligations according to approved policy. Require evidence for verification. |
| `recordSupplierPayment` | REPLACE | Record/verify Supplier Payment against Supplier Payable | Must enforce client-money/approval policy and not reduce a raw SupplierBooking balance as a side effect of entry. |
| `getBookingView` | MODIFY | Booking operational workspace | Add inquiry/options, participant roles, item-level suppliers/departures, independent state panels, documents, tasks, obligations/payments, payables, amendments, and risk exceptions. |
| `dashboard` | REPLACE | Exception/action dashboard | Replace lead/quotation counts with due tasks, unverified/unallocated payments, supplier deadlines, pending confirmations, missing documents, departure readiness, cancellation/refund attention, and client follow-ups. |
| `snapshot` | MODIFY | Controlled diagnostic projection | Keep local synthetic snapshot but include new records and exclude sensitive fields for unauthorized contexts. Attendance remains separate. |
| `payment-conversion.js` | KEEP / MODIFY | Conversion evidence/rule service | Keep recorded BDO Forex Selling Rate + 1.0 snapshot behavior; make source/date/rule explicit and never implicit. |
| `src/core/money.js` | KEEP | Exact operational money arithmetic | Preserve and extend only after baseline price/fee/margin rules are approved. |
| `src/core/lifecycle.js` | REPLACE | Independent state policy | Remove reliance on one status transition map for Booking/Payment/Invoice meaning; define per-dimension transitions and approval guards. |
| `src/validation/validator.js` | KEEP / MODIFY | Layered validation | Keep strict types/IDs/references. Add cross-aggregate invariants, allocation totals, evidence requirements, status-dimension rules, duplicate risk, and retry/idempotency checks. |
| `src/logging/audit-log.js` | KEEP / MODIFY | Durable trusted audit boundary | Keep event shape and failure logging concept; production must use durable append-only storage and authenticated actor context. |
| `src/document-intelligence/*` | KEEP / MODIFY | Tariff/document intake pipeline | Keep deterministic classification, normalization, extraction, provenance, and review-first output. Extend structured tariff matrix/itinerary/ambiguity handling; never write business records automatically. |
| `src/attendance/*`, HR specialist | REMOVE/DEFER / ISOLATE | Separate attendance scope | Do not mix with travel redesign. Existing read-only tests remain outside this plan. |
| Google/Drive/Sheets adapters | DEFER | Future controlled adapters | No Workspace configuration in current phase. Later adapters must preserve controlled service access and read-only discovery first. |

## 5. HTTP routes/API surface

| Current route group | Classification | Future API direction |
|---|---|---|
| `/api/leads*` | REPLACE / COMPATIBILITY ONLY | `/api/inquiries`, inquiry participants, inquiry activities, inquiry options, and follow-ups. Do not expose arbitrary table writes. |
| `/api/quotations*` | MODIFY | Quotation draft/review/send/preview routes with Inquiry/Option/source/availability context and approval checks. |
| `/api/quotation-items*` | MODIFY | Preserve item editing/reorder but enforce pricing rule/provenance/override history and Booking conversion rules. |
| `/api/bookings*` | MODIFY | Booking creation from selected option/quotation or approved direct path; independent state views; amendments/cancellations; participant roles; item/departure membership. |
| `/api/supplier-bookings*` | MODIFY | Supplier reservation/request/confirmation/amendment/failure with evidence, deadline, approval, and payable linkage. |
| `/api/invoices*` | MODIFY | Client obligation/invoice generation and revisions without assuming one Booking. |
| `/api/payments*` | REPLACE / SPLIT | Client payment receipt, evidence, verification, allocation, refund, Supplier Payable, and supplier payment use separate controlled actions. |
| `/api/state` | MODIFY | Return role-filtered operational projections, not an unrestricted database dump. |
| `/api/attendance/*` | REMOVE/DEFER from travel UI | Keep separate if needed; not part of baseline redesign. |

## 6. UI redesign

### Current UI classification

`app/public/index.html` and `app/public/app.js` are **REPLACE at navigation/workspace level; KEEP as visual/reference material**. The current UI explicitly labels Sales “Lead → quotation”, makes quotation-to-booking central, omits Inquiry/Options/Tasks/Documents/Departures, and exposes attendance in the same application shell.

### Future navigation/workspaces — PROVISIONAL implementation structure

1. **Action dashboard:** due soon/due/attention tasks, unverified/unallocated money, supplier deadlines, pending confirmations, missing documents, departure readiness.
2. **Inquiry workspace:** original request, people/roles, source channel, communications, changes, options, decisions, follow-ups.
3. **Option research workspace:** Supplier Package/Tariff scope, availability evidence, Find More Options, alternatives, rejected/unavailable history, staff selection.
4. **Quotation workspace:** internal calculation, rule explanation, override history, availability qualification, client-safe preview, approval/send controls.
5. **Booking workspace:** commitment/payment/supplier/document/readiness panels; participants; items; amendments; cancellation/refund history.
6. **Supplier fulfillment workspace:** Supplier Bookings, evidence, deadlines, payables, supplier failure/alternative workflow.
7. **Finance operations workspace:** client obligations, payment evidence/verification/allocation, supplier payables/payments, refund approval, margin projections.
8. **Documents workspace:** intake, classification, review, links, sensitivity, supersession, voucher readiness.
9. **Departure workspace:** shared departure memberships, counts, confirmation/document/deadline/readiness exceptions, no financial consolidation.
10. **People/Suppliers/Tasks:** reusable master data and work queues.

Attendance should be a separate scope/navigation boundary if retained. Intern/finance views must be role-filtered rather than hidden only in client JavaScript.

## 7. Important prototype behaviors to retain

- exact minor-unit money arithmetic;
- strict validation and reference checks;
- immutable ID direction and collision tests;
- repository/service separation for local synthetic tests;
- multiple Booking Items and Supplier Bookings;
- Supplier Booking Item consistency validation;
- client-facing quotation projection excluding internal costs/notes;
- review-first deterministic document classification/extraction;
- audit event hooks on successes and failures;
- local synthetic runtime and disabled Workspace adapters;
- atomic quotation recalculation behavior where still applicable.

These are reusable technical assets, not evidence that the current business model is correct.

## 8. Behaviors to remove or stop relying on

- Lead as mandatory workflow root;
- `Quotation.lead_id` as the authoritative commercial relationship;
- one Booking status for commitment and fulfillment;
- one Payment row with invoice linkage as the balance source;
- automatic invoice/supplier balance reduction on payment entry before verification/allocation;
- SupplierBooking `balance` as the complete payable model;
- Booking-level single Departure as the only grouping relationship;
- one Contact record as the group/person model;
- manual `readiness_percent` as the authoritative Departure readiness;
- UI/route assumptions that a quotation must precede every Booking;
- attendance as part of travel-operations dashboard scope;
- arbitrary actor strings as production authorization.

## 9. Migration implications for a future build

No migration is to be created now. When implementation is authorized:

1. freeze the current prototype as synthetic/reference;
2. create a translation map from Lead → Inquiry, Contact/Traveler → Person and role relationships, Quotation → WMIT Quotation, and current payment rows → historical payment receipts with verification/ allocation unknown where evidence is absent;
3. do not infer unavailable concepts from absent fields;
4. mark migrated records as legacy/provisional where semantics cannot be proven;
5. preserve all existing IDs and audit history when they correspond to real records;
6. require owner approval before any existing business spreadsheet or file is touched.

The current in-memory demo data is synthetic and should not be treated as migration input.

## 10. Security implications

The current local HTTP server, static UI, generic services, and actor context are not production authentication/authorization. Future implementation must enforce role checks at the controlled service boundary, redact sensitive fields in projections, protect payment evidence/passports/supplier costs, require trusted actor identity, log protected reads and approvals, and avoid relying on client-side hiding.

## 11. Financial implications

The most consequential redesign is financial: Client Payment must be separated from verification and allocation; Supplier Payable must be independent of Supplier Booking; supplier payments require evidence and client-money/approval policy; refunds/credits must be additive history; margin must be labeled operational and component-based. Existing quotation arithmetic is reusable, but current payment side effects are not baseline-compliant.

## 12. Test redesign implications

Existing tests remain regression tests for reusable technical behavior. Future tests must be reorganized around the six real cases and add valid, missing, invalid-ID, duplicate, conflict, retry/idempotency, partial-failure, permissions, audit, and recovery cases for each new domain. Specific gaps are listed in [validation-matrix-v1.md](validation-matrix-v1.md).

## 13. Repository evidence trace

This section records the actual prototype path inspected. It is not inferred from the architecture documents.

### 13.1 Schema: `src/models/schema.js` — MODIFY / SPLIT / ADD

Observed facts:

- Schema version is `1.4.0-quotation-payments-itinerary`.
- The executable model contains Client, Contact, Traveler, Lead, Quotation, QuotationItem, Booking, BookingTraveler, BookingItem, Departure, Supplier, Invoice, InvoiceItem, Payment, Document, SupplierTariff, SupplierBooking, SupplierBookingItem, InvoiceBooking, DocumentLink, and Task.
- Client has optional `source_lead_id`; Quotation requires `lead_id`; Booking has optional Quotation/Contact/Departure; Payment has one optional Invoice/Booking link plus a direction flag; SupplierBooking has a mutable summary `balance`; Departure is linked directly by optional `Booking.departure_id`.
- Generic polymorphic links exist for Contact owner, Document related record, DocumentLink, and Task.
- Schema-level status fields and references are useful technical scaffolding, but status meanings are preliminary and not independent enough for Baseline v1.1.

Target classification:

| Schema area | Classification | Exact redesign implication |
|---|---|---|
| Client/Supplier IDs and audit fields | KEEP / MODIFY | Preserve immutable IDs and audit columns; expand relationship model. |
| Contact/Traveler/BookingTraveler | SPLIT / MODIFY | Introduce Person identity and Inquiry/Booking participant-role relationships; do not infer roles. |
| Lead and `source_lead_id` | REPLACE / MAP | Inquiry becomes the business root; preserve legacy mapping only if later migration is approved. |
| Quotation/QuotationItem | MODIFY | Remove mandatory Lead parent; add Option/source/availability/pricing-rule/override provenance. |
| Booking/BookingItem | MODIFY | Keep records and multi-item structure; add independent state dimensions, amendment/cancellation history, and item-level Departure membership. |
| Departure | MODIFY | Replace direct Booking ownership as the core relationship with Departure Membership, primarily item-level, plus derived summaries. |
| Supplier/SupplierTariff | MODIFY | Supplier remains umbrella; SupplierTariff becomes versioned/conditional/reviewable and must not be a flat rate table. |
| SupplierBooking/SupplierBookingItem | MODIFY / KEEP JOIN | Preserve many-to-many join and booking consistency; add evidence, risk/approval, payable, amendment, and failure relationships. |
| Invoice/InvoiceItem/InvoiceBooking | MODIFY | Treat Invoice as client obligation/document; support multiple obligations, Booking/Item targets, credits, and allocations. |
| Payment | SPLIT | Separate Client Payment, Supplier Payment, Payment Verification, Payment Allocation, and Refund/Credit history. |
| Document/DocumentLink | MODIFY | Preserve review-first links; add source channel, sensitivity, owner, supersession, payment-proof, tariff provenance, and voucher workflow. |
| Task | MODIFY | Add typed work/deadline source, neutral states, ownership, idempotent alerts, and controlled related-record validation. |
| New entities | ADD | Inquiry, Person/role links, Commercial Option, Supplier Package, Availability Evidence, Payment Allocation, Supplier Payable, Refund/Credit, Amendment, Cancellation, Communication Activity, and Departure Membership. |

### 13.2 Service and repository layer — KEEP SCAFFOLDING / MODIFY

#### `src/services/index.js`

The runtime loops over every executable schema entity, creates an `InMemoryRepository`, and builds a generic `makeEntityService`. `createApi` exposes only a small Client/Supplier/Lead CRUD facade.

Classification: **KEEP AS LOCAL SCAFFOLDING; MODIFY FUTURE API BOUNDARY.**

Future dependencies:

1. Define the v1.1 domain record set and repositories.
2. Keep generic CRUD only for low-risk master/detail operations.
3. Add domain-specific application services for Inquiry, Option, Quotation, Booking, Supplier Fulfillment, Payments/Allocations, Payables, Documents, Tasks, and approvals.
4. Do not expose arbitrary record writes to agents or UI.

#### `src/services/entity-service.js`

Current behavior adds IDs, timestamps, record versions, default statuses, schema validation, reference validation, uniqueness checks, lifecycle validation, repository writes, and audit events. It accepts caller context with a default actor and implements generic delete.

Classification: **KEEP VALIDATION/AUDIT IDEAS; MODIFY HEAVILY.**

Required future changes:

- trusted authenticated actor context rather than caller-supplied identity;
- no unrestricted delete for business records;
- domain invariants beyond field/reference validation;
- separate state-dimension transitions and approval guards;
- idempotency/correlation keys for retries;
- optimistic concurrency/durable audit at production persistence boundary;
- sensitive-field redaction in reads and audit details.

#### `src/repositories/*`

`Repository` is an abstract interface. `InMemoryRepository` provides Map-backed insert/get/update/delete/list/clear with cloning. `InMemoryDriveRepository` stores synthetic file metadata only.

Classification: **KEEP FOR SYNTHETIC TESTS; MODIFY PRODUCTION ADAPTER CONTRACT.**

The future persistence contract must support Sheets row reads/writes only through controlled services, stable IDs, record versions/concurrency, safe retries, audit durability, and file metadata separate from structured records. Google Sheets/Drive adapters are intentionally deferred and must remain deferred until read-only Workspace discovery is approved.

### 13.3 Application workflows: `src/application/operations-mvp.js`

| Current function | Evidence-based current behavior | Classification / target |
|---|---|---|
| `createLead`, `updateLead`, `getLead` | Creates/updates the Lead record and applies defaults. | REPLACE with Inquiry capture/update, participants, source, communications, and follow-up. |
| `createQuotationFromLead` | Requires Lead, copies Lead fields into Quotation, initializes zero totals. | REPLACE with create WMIT Quotation from Inquiry/Commercial Option; custom path may precede availability. |
| `quotationTotals` and `calculateQuotationProposal` | Recalculates item cost/markup/fees/tax/discount/client total with exact money rules and one quotation currency. | KEEP CALCULATION FOUNDATION; MODIFY for configurable v1.1 rules, tariff sources, price snapshots, overrides, and warnings. |
| `getQuotationEditor`, `getClientQuotationPreview` | Provides internal editor projection and client-safe preview. | KEEP BOUNDARY; MODIFY for Option/source/availability and role-based redaction. |
| `updateQuotation`, `updateQuotationItem`, `addQuotationItem`, `removeQuotationItem`, `reorderQuotationItems` | Maintains quotation items and recalculated totals; blocks removal after BookingItem reference. | MODIFY for immutable commercial snapshots, price override history, source provenance, review/approval, and amended quotation history. |
| `createBookingFromQuotation` | Copies selected Quotation Items into Booking/BookingItems, always through quotation-centric flow. | REPLACE with select Option/Quotation → create/update Booking; support direct approved path, multiple Bookings per Inquiry, participants, and amendments. |
| `addBookingTraveler` | Adds only Traveler-to-Booking relation with optional free-text traveler role. | MODIFY into explicit participant role service for coordinator, payer, traveler, and other roles. |
| `createSupplierBookingFromBookingItem` | Creates one SupplierBooking from one BookingItem, then one join row; supports supplier cost, deposit, balance, deadlines. | MODIFY to support many-item Supplier Bookings, successive replacements, reservation-before-payment policy, evidence, Payable creation, and failure/amendment history. |
| `createInvoiceFromBooking` | Builds one invoice from all Booking Items and one primary Booking relation. | MODIFY into client-obligation/invoice workflow supporting multiple obligations, deposits/installments, credits, and item/Booking allocations. |
| `recordPaymentFromInvoice` | Requires Invoice; creates `FROM_CLIENT` Payment with default Pending Verification, then immediately recalculates Invoice paid/balance from all payment rows, regardless of verified/allocation state. | REPLACE with Client Payment receipt → evidence → verification → Payment Allocation; preserve unallocated/split payments and do not use raw rows as final balance. |
| `recordSupplierPayment` | Creates `TO_SUPPLIER` Payment and immediately reduces SupplierBooking `balance`; no client-money gate or payable entity. | REPLACE with Supplier Payable/Supplier Payment workflow; require evidence, verified client money, approval, and payable component application. |
| `getBookingView` | Joins Booking, Client, BookingTraveler/Traveler, BookingItems, SupplierBookings, Invoices, and Payments. | MODIFY into full operational workspace with independent state panels, roles, documents, tasks, payables, allocations, amendments, cancellations, and Departure memberships. |
| `dashboard` | Counts open Leads, actionable Quotations, active Bookings, and Invoice balances; lists SupplierBooking/Invoice dates and upcoming travel. | REPLACE with exception/action dashboard: Inquiry follow-ups, deadlines, unverified/unallocated money, Supplier Payables, pending confirmations, missing Documents, Departure readiness, and approvals. |
| `snapshot` | Returns broad local state including Leads, Contacts, Travelers, Suppliers, payments, audit, and Attendance. | MODIFY into role-filtered diagnostic projection; keep Attendance separate/deferred and avoid unrestricted production dump. |
| Attendance methods | Exposes read-only AttendanceService dashboards/history/exceptions through the same application object. | REMOVE/DEFER from travel architecture; retain separate attendance capability/tests. |

Important current financial conflict: the code treats payment creation as sufficient to update invoice or SupplierBooking balances even when status defaults to `Pending Verification`. This is a confirmed redesign target, not a reason to change the domain separation principle.

### 13.4 Lifecycle and validation — REPLACE POLICY, KEEP MECHANICS

`src/core/lifecycle.js` contains single-status transitions for Lead, Quotation, Booking, Invoice, SupplierBooking, and Payment. `src/validation/validator.js` validates required fields, unknown fields, types, enums, dates, references, polymorphic links, SupplierBookingItem booking consistency, and generic status transitions.

Classification:

- Keep strict validation, reference checking, immutable-ID enforcement, and atomic failure behavior.
- Replace single-status Booking/Payment semantics with independent state dimensions.
- Add cross-record rules for verification/allocation, payable components, evidence, amendments, role permissions, validity warnings, availability evidence, duplicate/retry protection, and approval requirements.
- Do not redesign the domain around the unresolved Booking-confirmation question. The domain already supports separate client-confirmation and Supplier-reservation/payment dimensions. The unresolved item is only which staff roles/policies may perform each action.

### 13.5 Server/routes: `app/server.js`

Current routes are:

| Route group | Current behavior | Classification |
|---|---|---|
| `/api/state` | Returns broad local snapshot. | MODIFY to role-filtered operational projections. |
| `/api/leads*` | Lead create/update/read. | REPLACE with `/api/inquiries*`; retain compatibility only if a future migration requires it. |
| `/api/quotations/*` | Quotation editor/preview/update and item mutations. | MODIFY for Inquiry/Option/source/availability/pricing review. |
| `/api/bookings/from-quotation` | Creates Booking from Quotation. | REPLACE with selected-option/quotation/direct approved Booking use cases. |
| `/api/booking-travelers` | Adds BookingTraveler. | MODIFY to participant-role endpoint. |
| `/api/supplier-bookings/from-item` | Creates SupplierBooking from one item. | MODIFY for reserve/request/confirm/fail/amend/payable workflows. |
| `/api/invoices/from-booking` | Creates Invoice from one Booking. | MODIFY for client obligations and multi-target relationships. |
| `/api/payments/from-invoice` | Records client payment and immediately updates invoice projection. | REPLACE with receipt/evidence/verify/allocate actions. |
| `/api/payments/to-supplier` | Records Supplier Payment and reduces SupplierBooking balance. | REPLACE with payable-gated Supplier Payment action. |
| `/api/attendance/*` | Read-only Attendance projections. | DEFER/ISOLATE from travel operations. |
| Static file serving | Serves `app/public` with path containment check. | KEEP as local prototype serving only; production security/auth is absent. |

The server has no authentication, authorization, CSRF protection, durable persistence, or production approval enforcement. It is a local demonstration boundary only.

### 13.6 UI: `app/public/index.html`, `app/public/app.js`, `app/public/styles.css`

| Current screen/component | Classification | Required future change |
|---|---|---|
| Top navigation: Sales, Bookings, Operations, Finance, Attendance | REPLACE navigation | Add Inquiry, Options, Quotations, Bookings, Supplier Fulfillment, Finance, Documents, Tasks, Departures, People/Suppliers; isolate Attendance. |
| Sales: Create Lead / Create Quotation from Lead | REPLACE | Inquiry capture, people/roles, communication activity, original request, follow-up, options. |
| Lead table/detail/status form | REPLACE | Inquiry timeline, changed requests, options, decisions, tasks, and source/channel evidence. |
| Quotation item form/editor | MODIFY / KEEP visual foundation | Add Commercial Option source, tariff/Package provenance, availability qualification, rule calculation, override history, review state, client-safe preview. |
| Booking creation from Quotation | REPLACE | Staff-selected Option/Quotation/direct path, participant roles, independent commitment/payment/fulfillment/readiness. |
| Supplier Booking form/table | MODIFY | Multiple-item selection, reservation risk/approval, evidence, Supplier Payable/deadlines, confirmation/failure/amendment. |
| Finance invoice/payment forms/tables | REPLACE | Obligations, payment proof, verification, allocation, Supplier Payables, Supplier Payments, refunds/credits, margin. |
| Dashboard metrics | REPLACE | Action/exception metrics, not Lead-centric counts. |
| Booking detail | MODIFY | Full operational view with state dimensions, item suppliers, Departure, documents, tasks, money, payables, amendments/cancellations. |
| Attendance panel | REMOVE/DEFER from travel redesign | Preserve separate read-only attendance boundary. |
| Client quotation preview/print | KEEP projection principle / MODIFY | Preserve exclusion of internal fields; add reviewed tariff/option output and availability qualifications. |

The UI currently hides no sensitive data through a production authorization boundary; future security must be enforced server-side/service-side, not only through rendering.

### 13.7 Tests — KEEP REGRESSION / REWRITE AND ADD

The current suite has 68 passing tests. It proves technical behavior, not Baseline v1.1 business coverage.

| Test area | Current evidence | Future treatment |
|---|---|---|
| `operational-model.test.js` | Asserts exact preliminary entity list and current relationships. | Rewrite around v1.1 entity boundaries and independent relationships. |
| `services.test.js`, `validation.test.js`, `ids.test.js` | Validates IDs, references, duplicates, status transitions, strict schema, and audit. | Keep useful cases; add domain invariants, permissions, concurrency/idempotency, approval, and recovery. |
| `operations-mvp.test.js` | Validates current Lead→Quotation→Booking→SupplierBooking→Invoice→Payment demo and current balance side effects. | Rewrite around six real cases; specifically change payment verification/allocation and Supplier Payable expectations. |
| `quotation-editor.test.js` | Validates exact calculations, atomic edits, item order/removal, currency, itinerary, client-safe preview, Apps Script portability. | Keep arithmetic/projection tests; add configurable rules, custom tariff source, overrides, validity/availability warnings, and review gates. |
| `commercial-workflow.test.js`, `fixture.test.js` | Validates SupplierBookingItem joins, InvoiceBooking, DocumentLinks, preliminary states, document matching, synthetic relationships. | Keep join/relationship regression; add amendments, Departure memberships, payables, allocations, refunds, and multiple options. |
| `document-intelligence.test.js` | Validates eight reference PDFs, classification, normalization, confidence, review outcomes, and safe failure. | Keep foundation; add Supplier Tariff structured extraction, matrix/conditional rates, itinerary, unit ambiguity, revisions, validity, provenance, and no-auto-quotation gates. |
| `config-adapters.test.js` | Validates safe local defaults and disabled Google adapters. | Keep; add v1.1 configurable pricing/approval/status policies without enabling Workspace. |
| Attendance tests | Validates read-only attendance isolation and sensitive projection controls. | Keep outside travel redesign; do not expand scope. |

Required future synthetic cases include the six real cases plus unverified payment, split allocation, duplicate retry, overlapping tariff versions, ambiguous transfer basis, outside-validity rate, supplier failure, traveler cancellation/replacement, and role visibility tests.

### 13.8 Document intelligence — KEEP FOUNDATION / MODIFY INTO TARIFF SUBSYSTEM

Current implementation:

- `taxonomy.js` classifies document/source types using deterministic content scoring;
- `extractor.js` extracts common dates, pax, client, supplier, currency, amount, references, flight, hotel, destination, package, duration, inclusions, exclusions, terms, meals, optional services, and a limited activity/itinerary field;
- `extraction-result.js` preserves raw/normalized values, confidence, warnings, source page, and review status;
- `pipeline.js` processes text/PDF and returns reviewable results;
- `matcher.js` only suggests matches against existing entity records; it is not a tariff-rate matcher or cost calculator;
- tests prove review-first extraction and no automatic business-record writes.

Classification: **KEEP FOUNDATION; MODIFY / ADD TARIFF-SPECIFIC SUBSYSTEM.**

Phase 1 tariff subsystem must do only:

1. classify Supplier tariff documents;
2. extract structured, provenance-backed tariff data;
3. create human/reviewable tariff records;
4. accept staff-entered client requirements;
5. search only the selected Supplier/tariff scope;
6. return multiple potential options and warnings;
7. calculate draft costs using explicit tariff units/conditions;
8. let staff choose the option;
9. apply WMIT pricing rules to a draft quotation;
10. require staff review before final client-facing output.

It must not implement a giant universal tariff language, autonomous supplier selection, live availability claims, or automatic quotation sending.

### 13.9 Configuration — MODIFY / DEFER PRODUCTION

Current configuration in `src/config/config.js` and `config/*` includes:

- schema version and timezone (`Asia/Manila`);
- default currency PHP;
- ID prefix/year rules;
- preliminary allowed statuses;
- coarse low/medium/high approval-risk action lists;
- empty Google IDs and disabled Workspace/external-action flags;
- attendance flags and policy settings.

Classification:

- Keep timezone, exact-money currency context, ID generation settings, safe local defaults, and disabled integrations.
- Replace Lead/Booking/Payment status lists with v1.1 independent state policy configuration.
- Add versioned pricing rules: custom tariff 30% markup, BDO Forex Selling Rate + 1.0 conversion rule, 5% card/PayPal fee, variable visa assistance, explicit discount policy.
- Add tariff interpretation defaults: per-person tariff, per-person-per-way transfer, explicit-wording override, ambiguity-review requirement, validity-review requirement.
- Add role/action authorization policy for who may mark client-confirmed and/or request Supplier reservation before client payment. This is a policy boundary, not a new domain aggregate.
- Keep Google Workspace disabled until read-only discovery and approval.

### 13.10 Apps Script and external adapters — KEEP BOUNDARY / DEFER IMPLEMENTATION

`apps-script/WmitServiceLayer.gs`, `WmitRuntime.gs`, `WmitQuotationEditor.gs`, and `WmitPaymentConversion.gs` expose controlled entry points and deliberately avoid direct SpreadsheetApp/DriveApp writes. `GoogleSheetsAdapter` and `GoogleDriveAdapter` fail safely when unconfigured and are intentionally deferred.

Classification: **KEEP AS BOUNDARY; MODIFY CONTRACTS LATER; DEFER PRODUCTION IMPLEMENTATION.**

Future services must be injected behind trusted authentication/authorization and must expose v1.1 controlled functions, not arbitrary cell edits. Apps Script quotation/payment helpers are reusable only after their contracts are updated for v1.1 pricing, review, allocation, and approval semantics.

## 14. Exact dependency order

The redesign is larger than an entity rename. The safest dependency sequence is:

1. **Freeze and approve v1.1 policy:** confirm authorization roles/thresholds; preserve the confirmed domain separation of client confirmation, Supplier reservation, Supplier confirmation, and Supplier Payment.
2. **Core identity and Inquiry:** Person, Client relationships, Inquiry, participant roles, Communication Activity, original-request history, and follow-up tasks.
3. **Commercial research:** Supplier capabilities, Supplier Package, Supplier Tariff source/version, Commercial Option, Availability Evidence, Find More Options, and scoped source provenance.
4. **Quotation:** WMIT Quotation/Items, configurable pricing rules, calculated/actual prices, discounts, overrides, review, and client-safe output.
5. **Booking and fulfillment:** Booking, Booking Items, participant roles, Supplier Booking(s), item-first Departure membership, independent states, amendments, cancellation groundwork, and deadlines.
6. **Client money and supplier obligations:** Client obligations/Invoices, Payment receipt/evidence/verification/allocation, Supplier Payables/components, Supplier Payments, approval gate, refunds/credits, and margin projections.
7. **Documents and readiness:** document sensitivity/provenance/supersession, payment proof, tariff review, voucher workflow, pre-departure readiness, and task alerts.
8. **Tariff automation Phase 1:** requirements-first matching within selected Supplier/tariff scope, multiple candidates, warnings, draft calculation, staff selection, WMIT pricing, draft quotation, staff review.
9. **Departure operations:** group summaries/readiness after Booking Items, Supplier Bookings, Documents, Tasks, and financial projections are available.
10. **Global search and AI assistance:** only after scoped tariff matching and human-review gates are reliable.

## 15. Redesign size assessment

The redesign is **structurally significant but technically reusable**:

- low-to-medium change: money, ID, validation, audit, local repositories, document-classification foundation, client-safe preview;
- medium change: Supplier, SupplierTariff, SupplierBooking, BookingItem, Document, Task, quotation editor, Apps Script contracts;
- high change: Inquiry/Option/availability domain, Person roles, Booking state model, payment verification/allocation, Supplier Payables, refunds/amendments, security boundary, dashboard/UI navigation, and tariff matching/calculation;
- deliberate deferral: Google persistence, live availability, global search, autonomous actions, accounting, attendance integration.

The current prototype should not be incrementally “fixed” in place until the future record boundaries and service contracts are approved. A controlled redesign can reuse substantial technical foundations, but the business workflow and financial semantics require a new application layer and revised UI rather than a few field additions.
