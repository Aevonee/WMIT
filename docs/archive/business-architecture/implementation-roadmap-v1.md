# WMIT Future Implementation Roadmap v1

> **SUPERSEDED / NON-EXECUTABLE:** Its historical phase numbering and tariff sequencing are not current. Use [BASELINE-HANDOFF.md](BASELINE-HANDOFF.md) and [implementation-plan-v1.2.md](implementation-plan-v1.2.md). Phase 1 now means one complete vertical slice.

> **Updated authority:** use [baseline-v1.1.md](baseline-v1.1.md). Tariff Phase 6 is staff-requirements-first and must show multiple candidates before staff selection.

Status: **FUTURE PLAN ONLY — NO IMPLEMENTATION AUTHORIZED**  
Authority: [baseline-v1.md](baseline-v1.md)  
This roadmap sequences future implementation by domain dependency and risk. It does not authorize source, schema, test, UI, configuration, migration, or integration changes in the current phase.

## Dependency order

### Binding v1.1 tariff constraint

Historical tariff evidence only: the current contract is classify → extract → staff review → staff-entered requirements → available tariff search (optionally supplier-scoped) → multiple candidates/warnings → staff selection → calculation → staff pricing review → quotation. A giant universal tariff language is out of scope; use a validated common envelope plus supplier-specific rules. This document is not executable.

```text
Baseline approval
  → identity/Inquiry/people/option/quotation foundation
  → Booking and supplier fulfillment
  → client money/allocation and Supplier Payables
  → documents/vouchers/tasks/readiness
  → Departure grouping
  → structured tariff library and scoped matching
  → global search and AI assistance
```

## Phase 0 — Architecture and policy approval

### Purpose

Approve Baseline v1 as the business authority and resolve the policies that cannot safely be inferred.

### Scope

- owner review of baseline terminology and relationships;
- confirm reserve-before-payment approval policy;
- confirm Booking commitment/confirmation policy by product or exception;
- confirm staff cost/markup/payment-verification visibility;
- confirm operational-margin component policy;
- confirm payment target behavior before an invoice exists;
- confirm traveler-data staging and refund/adjustment approvals;
- define audit and sensitive-document retention.

### Dependencies

None beyond discovery evidence and owner decision.

### Acceptance criteria

- Baseline v1 is approved as the single business source of truth.
- Unresolved policies have named owners, allowed values, and effective dates.
- Superseded discovery documents point to the baseline.
- No production setup or migration is started.

### Risks

Implementing before these decisions would create unsafe payment, refund, availability, or access behavior.

### Remains deferred

All code, schema, UI, integrations, and real-data migration.

## Phase 1 — Core identity, Inquiry, people, options, and quotation

### Purpose

Replace Lead-centric semantics with the minimum branching commercial model.

### Scope

- Client and Person identity;
- Inquiry with immutable original facts and source channel;
- Inquiry/Booking participant roles;
- lightweight Communication Activity;
- Commercial Option;
- Supplier, Supplier Package, and initial Supplier Tariff source references;
- Availability Evidence as a separate record/state;
- Find More Options workflow;
- WMIT Quotation and Quotation Items;
- configurable pricing rules and exact price snapshots;
- calculated versus actual quoted price and override history;
- client-safe quotation projection;
- Inquiry/Option/Quotation tasks.

### Dependencies

Phase 0; immutable IDs, validation, audit, exact money arithmetic, document metadata boundary.

### Acceptance criteria

- A Messenger inquiry can retain cheap August request while an October package becomes a separate option.
- A package cannot be presented as available without availability evidence.
- A custom tariff quotation can be created before availability is checked.
- One Inquiry can retain multiple options and potentially multiple quotation paths.
- A group can identify coordinator, payer, and travelers independently.
- Price override preserves calculated price, actual price, actor, time, and reason.
- Client preview excludes supplier costs, markup, internal notes, and sensitive documents.
- Find More Options does not repeat or silently select an option.

### Risks

Over-recording every casual search; accidentally reintroducing a Lead as a required parent; treating tariff values as confirmed availability.

### Remains deferred

Supplier reservations, supplier payments, refunds, full tariff extraction/matching, global search, production auth, Google Workspace.

## Phase 2 — Booking, Supplier Booking, amendments, and task deadlines

### Purpose

Represent the actual selected arrangement and operational fulfillment independently from quotation and payment.

### Scope

- Booking creation from selected Option/Quotation or approved direct path;
- multiple independent Bookings from one Inquiry;
- Booking Items with multiple Suppliers;
- participant roles on Booking;
- Supplier Bookings and Supplier Booking Items;
- availability-to-reservation evidence;
- independent client commitment and supplier fulfillment states;
- reservation-before-client-payment risk/approval flag;
- Supplier deadlines and task states/reminders;
- amendment history and supplier failure/alternative workflow;
- item-level cancellation state groundwork.

### Dependencies

Phase 1; approved Booking policy from Phase 0; audit and task engine.

### Acceptance criteria

- One Booking can contain airfare, hotel, transfer, tour, insurance, and WMIT fee items from multiple Suppliers.
- A Supplier Booking can cover multiple Booking Items and replacements preserve history.
- Reservation before client payment is visible with deadline, approval, and risk state.
- Client commitment does not imply Supplier confirmation.
- Material change updates the Booking while preserving old values and client re-acceptance evidence where required.
- Supplier failure supports alternatives without automatic supplier selection.
- Task alerts are idempotent and use neutral states.

### Risks

Treating Supplier Booking as the Booking; silently overwriting item cost/date; creating duplicate tasks on retry.

### Remains deferred

Supplier Payable settlement, refunds/credits, structured tariff engine, full voucher generation, Departure dashboard.

## Phase 3 — Client money, verification/allocation, Supplier Payables, and margin

### Purpose

Make money received, client obligations, supplier obligations, and operational margin visible without claiming full accounting.

### Scope

- client obligations/invoices;
- Client Payment receipts with evidence;
- verification workflow;
- Payment Allocation ledger;
- unallocated and split payments;
- installments and client balance projections;
- Supplier Payable and payable components/schedules;
- Supplier Payment evidence/verification;
- client-money-before-supplier-payment control;
- refunds/credits/penalties and approval history;
- expected and updated operational margin projections;
- BDO conversion snapshot and card/PayPal fee rules.

### Dependencies

Phase 0 policies; Phase 1 pricing; Phase 2 Bookings/Supplier Bookings; trusted authorization boundary.

### Acceptance criteria

- A payment can be entered, evidenced, verified, allocated, reallocated, reversed, or refunded without rewriting the receipt.
- A PHP 100,000 payment can be split across Booking A and Booking B or remain unallocated.
- Unverified/unallocated money does not silently reduce final balances.
- Supplier reservation can exist before payment, but Supplier Payment cannot be recorded before the approved client-money condition.
- Supplier deposit and final balance are separate payable components with different deadlines.
- Shared Departures do not merge financials.
- Expected and Updated Operational Margin show source components and do not equal cash received.
- Refund/credit outcomes preserve supplier and client sides separately.

### Risks

Accidental payment double counting, treating entry as verification, overloading Invoice as the only obligation, or calling operational margin accounting profit.

### Remains deferred

Statutory accounting/tax, full reconciliation, automatic bank feeds, live supplier payments, global tariff search.

## Phase 4 — Documents, document intelligence, vouchers, and readiness

### Purpose

Reduce document loss and voucher delay while keeping extracted information review-first.

### Scope

- Document intake metadata and source channels;
- classification and extraction results;
- review/accept/reject/supersede workflow;
- sensitive-document visibility;
- links to Inquiry, Option, Quotation, Booking, Item, Supplier Booking, Invoice, Payment, Payable, and Departure;
- payment-proof attachments;
- voucher draft/update from confirmed data;
- staff review and client-send state;
- pre-departure readiness projection.

### Dependencies

Phases 1–3; security boundary; document storage decision; tariff architecture for supplier tariff documents.

### Acceptance criteria

- Source documents remain linked and auditable.
- Low-confidence extraction creates review attention and cannot silently write a price or payment state.
- Passport/identity and payment evidence are restricted by role.
- Voucher generation uses Booking/Supplier Booking facts and updates after amendments.
- Missing tickets, vouchers, confirmations, traveler documents, balances, supplier obligations, PDOS, and final reminders appear as readiness exceptions.

### Risks

Exposing internal documents through client projections; treating an extracted voucher as confirmed without review; duplicate document processing.

### Remains deferred

Full channel ingestion, autonomous sending, legal travel eligibility decisions, OCR beyond validated use cases.

## Phase 5 — Shared Departure grouping and readiness

### Purpose

Give management group-level operational visibility without financial consolidation.

### Scope

- Departure master/source reference;
- item-first Departure Membership;
- derived Booking-level shortcut when appropriate;
- group traveler/booking counts;
- supplier confirmation summary;
- missing documents/deadline/readiness exceptions;
- group-level tasks and source documents.

### Dependencies

Phases 2–4; item-level Booking/Supplier relationships.

### Acceptance criteria

- Three independent Bookings can share one wholesaler Departure.
- Departure shows booking count, WMIT traveler count, confirmation, documents, deadlines, and readiness.
- Each Booking retains independent invoices, payments, payables, refunds, and margin.
- Mixed-supplier items can belong to different or no Departures.

### Risks

Reintroducing a consolidated financial account or assuming every Booking has one Departure.

### Remains deferred

Supplier-wide settlement, capacity purchasing, automatic group manifests beyond approved documents.

## Phase 6 — Supplier Tariff Library, extraction, and scoped matching

### Purpose

Address tariff-search and markup pain through structured, reviewable automation.

### Scope

- raw tariff intake;
- classification and extraction with provenance/confidence;
- structured conditional/matrix rates;
- itinerary data;
- validity/effective periods;
- version/revision/supersession/overlap handling;
- ambiguity/default interpretation controls;
- Supplier/Tariff-scoped search;
- candidate matching and draft cost calculation;
- WMIT pricing rules and staff review/override;
- source-to-quotation traceability.

### Dependencies

Phases 1, 3, and 4; [tariff-automation-architecture.md](tariff-automation-architecture.md); validated supplier documents.

### Acceptance criteria

- Multiple tariff documents for one Supplier coexist with reviewable revisions.
- Complex conditions and itinerary information survive structured extraction.
- Ambiguous transfer/unit values are flagged and cannot silently become client prices.
- Out-of-validity matches are shown as review conditions, not confirmed rates.
- Multiple matching rates are shown; the system does not choose the “best” supplier.
- Draft cost and pricing rule results are reproducible and reviewable.
- Staff can approve/override and the final quotation retains provenance.

### Risks

Over-engineering a universal tariff language before validating real documents; false confidence in extraction; source-version conflicts.

### Remains deferred

Global cross-supplier search, automated external availability, autonomous quoting, autonomous supplier selection.

## Phase 7 — Global cross-supplier search

### Purpose

Expand search after scoped tariff/package workflows are reliable.

### Scope

- search across multiple Suppliers and tariff/package libraries;
- comparable candidate views;
- explicit staff filters and decision recording;
- provenance and availability qualification across sources.

### Dependencies

Phase 6 quality, stable Option model, performance and permissions review.

### Acceptance criteria

- Results show all material matches and their source/validity/ambiguity state.
- No automatic cheapest/highest-margin/best-supplier selection.
- Staff decision is recorded and traceable to the chosen Option.

### Risks

False comparability across different inclusions, currencies, validity, and service bases.

### Remains deferred

Live booking, automatic supplier choice, autonomous client communication.

## Phase 8 — Automation and AI assistance

### Purpose

Automate safe repetitive work after the underlying records and controls are trusted.

### Scope

- draft extraction and classification assistance;
- option-search suggestions within approved scope;
- arithmetic and exception detection;
- idempotent reminders;
- draft quotation/voucher/document generation;
- operational summaries and manager dashboards.

### Dependencies

All core workflows, authorization, audit, synthetic and real-data validation, observability, and rollback procedures.

### Acceptance criteria

- AI outputs cite source records and confidence/warnings.
- Human review is mandatory before client-facing, financial, supplier, refund, or sensitive actions.
- Failed/repeated runs are visible and recoverable.
- No agent can bypass controlled functions or write arbitrary cells.

### Risks

Prompt/output drift, invented rates, silent price change, unsafe external action, or excessive automation complexity.

### Remains deferred

Autonomous booking, payments, refunds, supplier selection, and sensitive communication.

## Cross-phase testing gate

Every phase must add tests for valid input, missing input, invalid IDs, duplicates, conflicting data, retries, partial failure, permissions, audit events, and recovery. The six real WMIT cases are acceptance scenarios, not optional demos. Synthetic data must precede real data. A process completing without an exception is not sufficient evidence of correctness.
