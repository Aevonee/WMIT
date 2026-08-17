# WMIT Implementation Plan v1.2

> **CURRENT IMPLEMENTATION CONTRACT:** Read [BASELINE-HANDOFF.md](BASELINE-HANDOFF.md) first. The plan supplies dependency order and technical detail only; it cannot create business policy. This document authorizes no implementation.

## 0. Mandatory classifications

- **CONFIRMED:** explicitly owner-decided; implement it.
- **PROPOSED:** useful architecture or future direction not approved as policy; do not implement it as policy.
- **CONFIGURABLE:** confirmed concept whose exact value, threshold, role, or policy can be configured.
- **DEFERRED:** intentionally outside Phase 1; do not build it now.
- **BLOCKED:** the affected action must stop until a decision or authority is configured; use safe temporary behavior.
- **TECHNICAL IMPLEMENTATION CHOICE:** Codex may choose the mechanism if business behavior and security meaning do not change.

No `DEFAULT`, `DERIVED`, `PROVISIONAL`, or legacy `UNRESOLVED` statement may silently become a rule. If a policy is unresolved, preserve the uncertainty, create a task/approval boundary, and deny the high-impact action.
`SUPERSEDED / NON-EXECUTABLE` is a document status, not a seventh business-rule classification.

## 0A. Final owner decisions that override stale wording below

- **CONFIRMED:** Phase 1 is a complete vertical slice with synthetic data first; Bangkok Travel Services is the first real tariff pilot.
- **CONFIRMED:** Expo eligibility uses the actual client payment sent timestamp/date, not verification time. Preserve both timestamps and show the applied context/rule.
- **PROPOSED / DEFERRED:** only the confirmed Expo context is MVP. Seasonal, early-bird, group, supplier-specific, and other promotions are not MVP policy.
- **CONFIRMED:** staff records payment and proof; authorized verification is required before funds affect financial gates.
- **CONFIRMED:** supplier request/reservation may precede payment, but Supplier Payment requires verified client funds sufficient to cover that payment. WMIT must not bridge a shortfall.
- **CONFIRMED:** payment allocation follows the client's instruction; absent instruction means unallocated, never automatic allocation.

## 0B. Safe temporary behavior for blocked decisions

For any action whose role, approval, threshold, retention, traveler-data, deadline, cancellation, refund, or amendment policy is not configured: preserve the record and evidence, expose a visible task/blocker, and deny the high-impact transition. Amendments preserve history by default; missing data never becomes invented data; missing policy never becomes an automatic refund, deadline, split, price, or payment authorization.

Status: **FINAL IMPLEMENTATION CONTRACT — NO IMPLEMENTATION AUTHORIZED**  
Authority: [BASELINE-HANDOFF.md](BASELINE-HANDOFF.md), which incorporates the owner clarification and signed architecture review  
Supersedes for planning purposes: [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md)  
Repository phase: **Phase 2A — local operational data model; Google Workspace unavailable**  
Product implementation Phase 1: **complete deterministic vertical slice**

This is a dependency-ordered plan, not permission to build. Do not modify application code, schemas, tests, UI, configuration, integrations, migrations, or production data until the owner separately approves implementation.

## 1. Design labels

- **CONFIRMED:** explicitly owner-decided; implement it.
- **PROPOSED:** useful architecture or future direction not approved as policy; do not implement it as policy.
- **CONFIGURABLE:** confirmed concept whose exact value, threshold, role, or policy can be configured.
- **DEFERRED:** intentionally outside Phase 1; do not build it now.
- **BLOCKED:** the affected action must stop until a decision or authority is configured; use safe temporary behavior.
- **TECHNICAL IMPLEMENTATION CHOICE:** Codex may choose the mechanism if business behavior and security meaning do not change.

## 2. Target domain model

### 2.1 Relationships

```text
Client ──< Inquiry ──< Commercial Option ──< Availability Evidence
   │          │              │
   │          ├─ Commercial/Pricing Context
   │          ├─ People/roles and Communication Activities
   │          └─ WMIT Quotation ──< Quotation Item
   │                                      │
   └──────────────< Booking ──< Booking Item ──< Supplier Booking Item >── Supplier Booking >── Supplier
                                      │                         │
                                      └── Departure Membership ──> Departure

Supplier ──< Contacts / Capabilities / Tariff Versions / Documents / Activities
Tariff Version ──< Rate Components / Itinerary Components / Extraction Facts / Review Decisions

Booking ──< Client Obligations/Invoices ──< Payment Allocations >── Client Payment ──< Payment Evidence
Supplier Booking ──< Supplier Payable Components ──< Supplier Payments
All material records ──< Documents / Tasks / Audit Events / Amendments
```

### 2.2 Core entities and important fields

| Entity | Important fields | Status |
|---|---|---|
| Client | immutable ID, legal/display name, type, contact links, status, notes | CONFIRMED |
| Person | immutable ID, identity/contact data, sensitivity classification, document links | CONFIRMED |
| Inquiry | original request snapshot, received/source channel, current request version, client/people links, owner, event context, state | CONFIRMED |
| Inquiry/Booking Participant | person ID, role(s), effective dates, payer/communication authority, traveler requirements | CONFIRMED |
| Communication Activity | channel, timestamp, actor, participants, source/thread reference, summary, decision/follow-up, attachments | CONFIRMED |
| Commercial/Pricing Context | Expo/event ID, origin/source, eligible product scope, Expo dates, client payment sent window, pricing/discount rule version, validity, evidence | CONFIRMED for Expo MVP; future promotion types PROPOSED/DEFERRED |
| Supplier | umbrella supplier identity, capabilities/types, terms, payment terms, portals, references, notes, status | CONFIRMED |
| Supplier Contact | supplier, purpose, name, email/phone/WhatsApp, office/contact details, booking/payment/emergency role, priority, active dates | CONFIRMED |
| Supplier Package | supplier product/departure reference, dates, destination, inclusions/exclusions, price/currency, capacity, validity, cancellation terms, source | CONFIRMED |
| Tariff Source/Version | supplier, source Document, revision, scope, effective/validity dates, supersession, review/authority, checksum | CONFIRMED |
| Tariff Extraction Fact | raw/normalized value, confidence, page/row/section provenance, assumption, warning, review decision, corrected value | CONFIRMED |
| Tariff Rate Component | component/service, conditions, amount/currency, rate unit, quantity driver, pax/room/night/season/date rules, inclusions/exclusions, supplier payload | CONFIRMED concept; physical representation TECHNICAL IMPLEMENTATION CHOICE |
| Tariff Itinerary Component | day/date, city, activity/tour/transfer, meals, overnight, inclusion status, provenance | CONFIRMED |
| Commercial Option | Inquiry, option type/source, selected tariff/package/quote references, requirements snapshot, candidate components, warnings, match explanation, state, rejection/supersession lineage | CONFIRMED |
| Availability Evidence | option/booking item, source, checked time, requested dates/quantity, result, supplier reference, expiry/hold, evidence Document, reviewer | CONFIRMED |
| WMIT Quotation | Inquiry/Option, event context, validity, price-rule snapshots, calculated/actual cost/price, fees, discounts, FX, review/approval/send state, client projection | CONFIRMED |
| Quotation Item | source option/rate, service, quantity, unit, supplier cost, selling value, fees/discounts, currency, itinerary/inclusions/exclusions, override history | PROPOSED |
| Booking | Inquiry/Option/Quotation lineage, client, commitment state, dates/destination, amendment/cancellation references, current commercial snapshot | CONFIRMED |
| Booking Participant | Booking, person, coordinator/payer/traveler/communicator role, traveler status/requirements | CONFIRMED |
| Booking Item | Booking, service, supplier, source, dates/quantity, expected/confirmed cost, selling value, fulfillment state, cancellation terms, departure links | CONFIRMED |
| Supplier Booking | supplier, request/reservation/confirmation state, item links, supplier reference, evidence, terms, deadlines, risk/approval, amendment lineage | CONFIRMED |
| Departure Membership | Departure, Booking Item, membership status/source, dates/reference | CONFIRMED |
| Client Obligation/Invoice | client, booking/items, due schedule, amount/currency, terms, document, derived balance | CONFIRMED; pre-invoice payments are supported without fabricating an invoice |
| Client Payment | payer/client, actual sent timestamp/date, amount/currency/method/reference, reported/verification state, conversion snapshot, proof links, client-directed allocation instruction, verification timestamp | CONFIRMED |
| Payment Evidence | proof Document, evidence received date, verification outcome, verifier, rejection reason | CONFIRMED concept; may initially be Document-backed |
| Payment Allocation | payment, target obligation/Booking/approved target, amount/currency, actor/time, state, reallocation/reversal history | CONFIRMED |
| Supplier Payable | supplier booking/item, payable component (deposit/final/penalty/etc.), amount/currency, due date, client-money gate, state | CONFIRMED |
| Supplier Payment | payable component, amount/currency/date/method, proof, approval, verification, actor | CONFIRMED |
| Refund/Credit/Adjustment | side, source payment/payable/booking, amount, reason, evidence, approval, state | CONFIRMED concept |
| Document | source/file reference, type, related IDs, sensitivity, classification/extraction/review/supersession, checksum | CONFIRMED |
| Task | type, owner, related IDs, due/source deadline, priority, state, reminder/idempotency history | CONFIRMED |
| Amendment/Cancellation | before/after snapshots, reason, actor, approval, client acceptance, supplier actions, traveler-level outcome | CONFIRMED concept |
| Audit Event | trusted actor, action, record, timestamp, old/new values, reason, approval, result/error, correlation/idempotency key | CONFIRMED |

Do not add Trip, Travel Party, or a separate Voucher aggregate in v1 unless later evidence proves the relationships insufficient. Voucher is a Document/output workflow.

## 3. State dimensions and transitions

### 3.1 Independent dimensions — CONFIRMED

Implement separate dimensions for Inquiry, Commercial Option, Availability, Client Decision, Quotation, Booking Record, Booking Commitment, Client Payment Receipt, Payment Verification, Client Obligation, Supplier Fulfillment, Supplier Payable, Supplier Payment, Document, Task, and Departure/Pre-departure Readiness.

Minimum meaningful transitions:

- Inquiry: New → Contacted/Clarifying → Researching → Options Ready → Awaiting Client → Converted/Closed/Cancelled.
- Option: Researched → Ready to Present → Presented → Accepted/Rejected/Superseded/Unavailable/Expired.
- Availability: Not Checked → Checking → Available/Unavailable/Unknown/Held/Expired.
- Quotation: Draft → Internally Reviewed → Sent/Awaiting Client → Accepted/Rejected/Expired/Superseded/Withdrawn.
- Booking record: Created from a selected option/approved operational need; it may exist while commitment is pending.
- Booking commitment: Pending → Client Selected → Client Confirmed under policy → Changed/Cancelled/Completed.
- Client payment: Reported → Evidence Pending → Pending Verification → Verified/Rejected/Reversed/Refunded.
- Obligation: Unpaid → Partially Paid/Deposit Sufficient → Fully Paid/Credited/Refunded/Needs Attention, derived from verified allocations and approved adjustments.
- Supplier fulfillment: Not Requested → Request Prepared → Requested → Reservation/Hold Placed → Awaiting Confirmation → Partially Confirmed/Confirmed/Failed/Amended/Cancelled/Completed.
- Supplier payable: Expected → Deposit Due → Partially Payable/Paid → Final Balance Due → Paid/Disputed/Cancelled/Refund/Credit Pending/Closed.
- Supplier payment: Prepared → Approved → Paid/Verified → Reversed/Refunded.
- Document: Expected → Requested/Received → Classified → Needs Review → Accepted for Use → Sent/Superseded/Missing.
- Task: Pending → Due Soon/Due → Awaiting Client/Supplier/Internal → Requires Attention → Completed/Cancelled.

No transition may imply another dimension. A Booking status must never imply payment, supplier confirmation, supplier payment, readiness, or profit.

### 3.2 Policy guards — CLASSIFIED

Role authority and approval thresholds are BLOCKED for affected high-impact actions and must fail closed. Margin detail, staged traveler requirements, supplier deadlines, retention, uncommon cancellation/refund rules, and amendment split thresholds are CONFIGURABLE or DEFERRED; preserve uncertainty, create a task/blocker, and do not invent policy. Expo payment timing, pre-invoice payment recording, client-directed allocation, and the verified-funds Supplier Payment gate are CONFIRMED.

## 4. Business rules

- IDs are immutable, human-readable, timezone-aware, centrally generated, and collision-safe.
- Relationships use IDs, not names alone. Material changes append history and preserve source snapshots.
- Original Inquiry facts are never silently overwritten.
- A Supplier Package requires availability evidence before presentation. A custom tariff quotation may precede availability, but quotation is not availability proof.
- Supplier failure produces alternatives for staff/client choice; no Supplier is auto-selected.
- **CONFIRMED:** supplier reservation before payment is allowed. Supplier Payment is blocked until verified client funds available for that Supplier Payment are sufficient to cover its amount. WMIT must not bridge a shortfall. Evidence, allocation, and authorization remain separate gates.
- A Booking record may be created for operational work after client selection while client commitment remains pending. Booking record existence never means client confirmation, payment, supplier confirmation, or supplier payment.
- No low-confidence extraction becomes trusted pricing data without staff confirmation.
- Explicit supplier unit wording overrides any configured default; every calculation shows unit, quantity driver, source, validity, and assumptions. Default units are configurable implementation policy, not hard-coded business truth.
- Discounts, markups, conversion fees, visa fees, card/PayPal fees, taxes, penalties, refunds, credits, and overrides are explicit and auditable.
- Custom tariff pricing defaults: 30% markup, BDO Forex Selling Rate + 1.0 conversion rule, 5% credit card/PayPal fee, variable visa assistance fee. Rule versions are snapshotted.
- Staff remains final authority for extraction confirmation, option selection, availability qualification, pricing edit/approval, booking commitment, supplier payment, refund, and sensitive communication.
- Preserve business history through cancellation, reversal, supersession, or adjustment records. Any destructive deletion remains a separately authorized high-risk action.

## 5. Tariff workflow

1. Staff uploads/records source file and supplier context.
2. System retains original file metadata/checksum and classifies it.
3. Parser extracts raw/normalized facts with confidence and page/row/section provenance.
4. Staff reviews a dedicated extraction workspace showing successful fields, missing values, ambiguities, assumptions, inferred units, validity, hotel/duration/pax combinations, and itinerary.
5. Staff corrects or confirms facts. Low-confidence or conflicting facts remain blocked from trusted matching until reviewed.
6. System moves the source through `Uploaded → Extracted → Needs Review → Reviewed/Approved → Active/Superseded`; unreviewed tariff data cannot produce a client-facing quotation.
7. System creates a reviewed tariff version using the common envelope plus supplier-specific payload and calculation adapter.
8. Staff enters requirements first: destination, travel dates, nights, pax/age bands, rooms, hotel/category, meal plan, transfers, tours, and constraints.
9. Phase 1 may use supplier/tariff-scoped matching as an implementation boundary, but requirements-first matching must not depend on staff already knowing the correct supplier. The architecture remains extensible to broader search.
10. Matcher returns multiple candidates, relevant rate combinations, inclusions/exclusions, validity/availability caveats, warnings, and “why matched” explanations.
11. `Find More Options` excludes or distinguishes rejected, unavailable, superseded, duplicate, and already-shown candidates, and explains exclusions.
12. If no suitable tariff is found, return no match; allow manual research or supplier quote request.
13. Staff selects an option. Calculator applies explicit units, quantity drivers, conditions, supplements, compulsory charges, and itinerary components.
14. WMIT pricing rules create a draft quotation with calculated values, actual overrides, warnings, and source provenance.
15. Staff reviews/edits pricing and approves before client-facing generation or sending.

### Conditional/matrix pricing acceptance requirement

If a source contains different prices based on combinations such as hotel × nights × pax × room type, the system must preserve those conditions and calculate against the correct combination. It must never flatten the source into one generic rate row. The same rule applies to season, travel dates, adult/child bands, meal plan, transfers, supplements, compulsory charges, duration, and itinerary-linked components.

### First tariff pilot — CONFIRMED pilot / TECHNICAL experiment

Use synthetic data first, then validate the design against Bangkok Travel Services source files covering the actual structures encountered. This is a reversible architecture experiment, not a universal tariff-engine commitment or a requirement to generalize before the vertical slice works.

This is decision support, not autonomous recommendation or quotation generation.

## 6. Supplier database/workspace behavior

The Supplier workspace is an MVP operational knowledge hub, not a contact list. It must show supplier name, types/capabilities, office/contact details, purposeful contacts and channels, booking/payment/emergency procedures, terms, cancellation policies, portals, notes, deadlines/process notes, associated tariff files and searchable revisions, packages, quotations, communications, Booking history, confirmations, vouchers, payables, and relevant documents. It must support restricted internal views for cost, terms, payment details, and sensitive documents.

Supplier files must be searchable from the Supplier record. The workspace is one Supplier master with related records. Do not create disconnected DMC, wholesaler, hotel, airline, or tour-operator databases.

## 7. Quotation workflow

Create quotation from a selected Commercial Option or approved manual research, not necessarily from a Lead. Preserve source tariff/package/supplier quote/availability provenance. Apply the applicable price rule snapshot, show item-level costs/units/fees/discounts, retain calculated and actual values, attach event eligibility where relevant, and require internal staff review before presentation. Client-safe projections must exclude supplier cost, margin, restricted terms, payment evidence, and internal notes.

Pricing rules are structured, versioned rules rather than opaque arithmetic:

- fixed rules: custom tariff markup = 30%;
- rate-based rules: BDO Forex Selling Rate + 1.0;
- percentage fees: card/PayPal = 5%;
- variable/manual fees: visa assistance and other approved service fees;
- discounts: explicit amount/percentage, reason, authority, applicable period/context, and rule snapshot.

**CONFIRMED MVP:** Commercial/Pricing Context supports the Expo context. The client must actually send payment within the specified Expo dates. Preserve actual sent timestamp/date separately from proof receipt and verification timestamps, and show the applied context/rule and reason. **PROPOSED/DEFERRED:** seasonal, early-bird, group, supplier-specific, and other future promotions are extension points only.

## 8. Booking workflow

Create a Booking operational record when a client selects an option or an approved operational path requires one; this does not by itself confirm client commitment. Keep Booking record lifecycle, client commitment, client payment, Supplier fulfillment, and Supplier Payment independent. Support direct approved paths where no formal quotation exists. Capture participant roles, Booking Items, current commercial snapshots, payment terms, amendment history, cancellation/replacement outcomes, and links to Inquiry/Option/Quotation. Multiple independent Bookings may come from one Inquiry.

When a material amendment changes dates, hotel, room, pax, itinerary, Supplier, or service, recalculate cost and client price. Preserve before/after values, supplier actions, and the reason. If the revised price or commercial terms change, staff must inform the client and record revised client acceptance before treating the new price as accepted.

## 9. Supplier fulfillment workflow

For each Booking Item, prepare/request/reserve/confirm with the selected Supplier. A Supplier Booking may cover multiple items; successive Supplier Bookings may exist after amendment, replacement, or split fulfillment. Retain request/hold/confirmation/failure evidence, supplier contacts, deadlines, cost snapshots, payable components, and tasks. Reservation may precede client payment, subject to policy. Never mark all items confirmed merely because one supplier response exists without item-level evidence.

## 10. Financial workflow

### Client money

`client reports payment → staff records payment → proof attached → authorized verification → staff records the client's intended allocation → allocation → obligation balance projection`.

The system must not invent an allocation. If the client specifies “PHP 50,000 for Booking A and PHP 30,000 for Booking B,” staff records those allocations. If the client gives no allocation instruction, the payment remains unallocated and creates a task for staff action. Payments may be split/reallocated only through an audited authorized action. Unverified money is not final paid balance. Payment-before-invoice behavior remains a configurable policy boundary and must not be hard-coded as an invoice placeholder without approval.

### Supplier obligations

`supplier reservation request → supplier terms/confirmation → payable components → client has paid → proof/verification and configured gate → approval → supplier payment proof → payable projection`.

Supplier reservation/request is allowed before client payment. Supplier Payment is not allowed until verified client funds available for that payable amount are sufficient; WMIT must not bridge a shortfall. Evidence, verification, allocation, and authorization remain separate. Supplier Payable components must support deposits, final balances, non-refundable penalties, credits, refunds, and varying deadlines. Supplier Booking balance is a derived view, not the source of truth.

### Margin

Expected Operational Margin = expected client selling value − expected direct cost.  
Updated Operational Margin = current client selling value − current/confirmed direct cost − approved direct adjustments.

All adjustments and rule versions are visible. Exact scope of uncommon taxes, pass-through fees, FX, refunds, penalties, and credits is CONFIGURABLE; preserve each component separately and label incomplete projections rather than inventing accounting treatment.

## 11. Document workflow

Retain original files and metadata, classify/extract with review status, link documents to multiple records, enforce sensitivity, preserve superseded versions, and use documents as evidence for tariffs, availability, payments, supplier confirmations, identity, cancellations, and vouchers. Voucher generation is a reviewed Document/output workflow from current Booking data.

## 12. Task/follow-up workflow

Create idempotent tasks for client follow-up, supplier response, tariff review, availability, quotation review, payment proof/verification/allocation, supplier deadlines, confirmations, documents, vouchers, pre-departure readiness, cancellation, refund, and expo payment-window expiry. Tasks need owner, due/source deadline, related record, priority, state, reminder history, and escalation.

## 12A. Traveler cancellation and replacement

Individual traveler cancellation must record the cancellation request, supplier terms, refundable/non-refundable determination, replacement possibility and deadline, name-change/reissue cost where applicable, resulting client adjustment, and audit history. Cancellation must not automatically create a refund. The system first records the applicable supplier/client terms and the authorized outcome.

## 13. Expo/event workflow

1. Record Inquiry origin and attach the applicable Commercial/Pricing Context.
2. Apply event-specific products, pricing, discounts, validity, and payment rules through versioned rule snapshots.
3. Show event eligibility and expiry in Option/Quotation/Booking views.
4. At payment receipt/verification, evaluate the approved payment-date rule against event dates.
5. Preserve the eligibility decision, evidence, rule version, and any approved override.
6. Do not apply the discount outside the valid period, and do not rely on staff memory.

The event workflow remains within the same Inquiry, Quotation, Booking, Payment, and Task domains.

## 14. Permissions and security

| Role | Default access boundary |
|---|---|
| Admin/Owner | Full authorized operational and sensitive visibility; high-impact approval. |
| Manager | Broad operations, cost/margin and configured approvals; sensitive access by policy. |
| Staff | Routine Inquiry, options, quotations, bookings, supplier coordination, tasks, documents, and payment entry within policy. |
| Intern | Assigned low-risk work and drafts; no default cost/margin, payment evidence, passports, refunds, supplier purchases, or sensitive communications. |

Authorization must be enforced by trusted identity at service boundaries, with field-level projections and action approvals. UI hiding and caller-supplied role strings are insufficient. Audit every meaningful action, failure, approval, state change, override, allocation, payment, refund, and sensitive-document access.

## 15. UI/workspace structure — PROPOSED

- Action/exception dashboard: follow-ups, deadlines, unverified/unallocated money, payable gates, pending confirmations, tariff reviews, missing documents, expo expiries, approvals, and Departure readiness.
- Inquiry workspace: original request, changed-request history, people/roles, communication activity, event context, options, decisions, and tasks.
- Options/availability workspace: candidate comparison, source/provenance, warnings, availability evidence, rejected/superseded history, Find More Options.
- Tariff workspace: upload/source, extraction review, corrections, version approval, supplier-specific mapping, requirements-first matching, calculation review.
- Quotation workspace: internal calculation, rule snapshots, override history, review/approval, client-safe preview.
- Booking workspace: participants, items, independent state panels, amendments/cancellations, documents, tasks, obligations, payables, readiness.
- Supplier workspace: master profile and related operational knowledge hub.
- Finance workspace: obligations, proof, verification, allocations, payables, supplier payments, refunds/credits, and margin projections.
- Documents/Tasks/Departures workspaces: cross-record operational views with restricted projections.

Attendance remains isolated/deferred.

## 16. Fresh Workspace deployment strategy — no legacy migration

The owner has confirmed that the linked Google Drive will be a new, empty WMIT Workspace. There is no existing WMIT record migration in scope.

1. Initialize one WMIT root folder and one operational spreadsheet idempotently.
2. Create controlled entity tabs, configuration, and audit log without deleting or overwriting content.
3. Upload tariff, package, and supporting source files through the web application into typed Drive folders.
4. Create a structured Document record in Sheets containing the Drive file ID, checksum, source type, version, provenance, and review state.
5. Extract and save structured tariff/package facts as review data; do not activate matching or quotation use until staff confirms interpretation.
6. Run the complete synthetic workflow in the fresh Workspace and reconcile record counts, links, document references, and audit events.
7. Only after synthetic verification, enable authorized real operational use.

The local prototype remains available as a reference and synthetic test harness. No legacy files, records, or folders are imported.

## 17. Dependency-ordered implementation phases

### Phase 0 — decisions and safety gate

Resolve blocking decisions, approve synthetic six-case fixtures, define trusted actor/authorization contract, and keep Google Workspace/external actions disabled.

### Phase 1 — complete deterministic vertical slice

Phase 1 is **one complete usable workflow**, not merely a foundation and not every feature at maximum sophistication. A staff member must be able to take one real/synthetic Inquiry through:

`requirements → tariff/package research → staff-reviewed option → quotation → client selection → Booking record → client commitment state → Supplier reservation → payment proof → verification → client-directed allocation → Supplier Payable → Supplier Payment gate → documents/tasks → Departure visibility → expo/promotion context where applicable`.

Dependency-ordered work inside this vertical slice:

1. Person/roles, Client, Inquiry, Communication Activity, Commercial/Pricing Context, immutable IDs, validation, audit, and restricted projections.
2. Supplier master/contact workspace, searchable Supplier files, Supplier Package, tariff source/version, extraction facts, trusted-version gate, rate components/units, itinerary preservation, and supplier-specific mapping/calculation adapter boundary.
3. Requirements-first Commercial Options, Availability Evidence, multiple candidates, Find More Options, WMIT Quotation/Items, structured pricing rules, event eligibility, staff pricing review, and client-safe projection.
4. Booking record versus commitment state, Booking Items, Supplier Booking/Items, reservation-before-payment behavior, evidence, deadlines, amendment/reprice/re-acceptance history, and minimum traveler cancellation/replacement records.
5. Client payment proof/verification, client-directed allocation, Supplier Payable components, client-paid Supplier Payment gate, approvals, refunds/credits/penalties, and minimum margin projections.
6. Documents, reviewed voucher output, idempotent tasks, action/exception dashboard, Departure Membership/readiness, and the six-case regression walk-through.

Phase 1 may use a small number of supplier-specific adapters and supplier/tariff-scoped matching as a **PROPOSED implementation boundary**, but it must not require staff to know the correct Supplier before entering requirements or prevent future broader search.

### Phase 2 — expand sophistication after the vertical slice works

Add broader cross-Supplier search, more supplier-specific tariff adapters, richer conditional/matrix calculations, deeper document intelligence, more complete cancellation/refund automation, and stronger operational projections. These expand capability; they must not replace the Phase 1 workflow with disconnected domain builds.

### Later phases — only after evidence

Consider broader supplier/tariff search, deeper communication integration, external availability adapters, and carefully bounded AI assistance after fresh-Workspace synthetic verification. None may select suppliers, invent availability/rates, or bypass human review.

## 18. Testing strategy

Every domain operation requires tests for valid input, missing input, invalid IDs, duplicate/retry behavior, conflicting data, illegal transitions, partial failure/rollback, permissions, audit records, sensitive-field redaction, and recovery. Use synthetic data only until real-data authorization exists.

Tariff tests must include matrix/conditional rates, per-person/per-room/per-night/per-vehicle/per-way units, explicit wording overrides, ambiguous units, missing validity, overlapping revisions, hotel/duration/pax combinations, supplements, itinerary extraction, supplier-specific adapters, no-match, Find More Options exclusions, and staff correction gates.

Required tariff acceptance tests include:

- a hotel × nights × pax × room-type matrix preserves its conditions and calculates the correct combination;
- an unreviewed or superseded tariff cannot produce a client-facing quotation;
- a candidate exposes its source, unit, quantity driver, validity, assumptions, itinerary, and exclusion/match explanation;
- `Find More Options` does not repeat rejected, unavailable, superseded, duplicate, or unchanged presented options;
- itinerary components are preserved as itinerary content and are never silently treated as priced services;
- no source upload directly creates a quotation.

Financial tests must include pre-invoice payment, missing/rejected/unverified proof, split/unallocated/reallocated payment, installment payments, supplier reservation before payment, blocked supplier payment, payable deposit/final components, refunds/credits/penalties, and margin snapshots.

The payment acceptance test must prove that a client-directed allocation is recorded exactly as instructed, that an unspecified allocation remains unallocated, and that Supplier reservation is permitted before client payment while Supplier Payment is rejected until the client-paid gate is satisfied.

Amendment acceptance tests must prove that a date/hotel/pax/service change creates a revised cost and price, preserves the previous commercial snapshot, records supplier actions, and requires revised client acceptance when the price changes. Traveler cancellation must not automatically refund; supplier terms and replacement/name-change outcomes must be recorded first.

Security tests must verify server-side role enforcement, field redaction, intern restrictions, approval guards, audit completeness, and trusted actor identity.

## 19. Six real-case regression strategy

The six cases are end-to-end synthetic regressions, not just unit fixtures:

1. Messenger August request changes to October wholesaler package: preserve Inquiry history, check availability before presentation, show alternative, track origin and tasks.
2. Custom DMC tariff plus airfare: review tariff extraction, match multiple options, preserve itinerary, calculate custom pricing, quote before later availability, then handle failure.
3. Group roles: coordinator, payer, travelers, and communicating contacts are distinct and permissions are correct.
4. Mixed Booking: airfare, hotel, transfer, tour/insurance items with multiple Suppliers, Supplier Bookings, payables, and item-level readiness.
5. Reservation before payment plus installments: commitment, evidence, verification, allocation, client balance, payable gate, and supplier payment remain separate.
6. Supplier failure/cancellation: alternative choice, amendment history, partial traveler cancellation/replacement, penalties, credits/refunds, approvals, documents, and updated margin.

Each case must assert source provenance, state dimensions, audit records, permission outcomes, idempotent retries, and the absence of automatic supplier selection.

## 20. Explicit non-goals

- Autonomous AI decisions or best-supplier selection.
- Automatic client quotation from an upload.
- Universal tariff language.
- Live global inventory/availability search.
- Automatic external booking, purchase, supplier payment, refund, or sensitive communication.
- Full email/Messenger/WhatsApp ingestion.
- Full accounting or statutory revenue recognition.
- Payroll, HR, or attendance expansion.
- Separate supplier databases by category.
- Google Workspace setup in Phase 2A.
- Production authentication implementation in this review task.

## 21. Blocking decisions

These must be resolved before implementing the affected enforcement path:

1. Which trusted roles may verify client payments, approve Supplier Payments, approve refunds/adjustments, approve pricing exceptions, confirm client commitment, and authorize reservation-before-payment. **BLOCKED for the affected action:** fail closed until configured.
2. Detailed margin, traveler staging, supplier deadline, retention, cancellation/refund, and amendment split policies. **CONFIGURABLE/DEFERRED:** use the safe temporary behavior in Section 0B.
Any older numbered line remaining in this historical section is non-blocking and superseded by the classified contract and Section 24 acceptance tests.
4. Payment-before-invoice behavior and the rule that allocation follows the client’s instruction rather than automatic system allocation.

These block the affected workflow’s safe implementation, not all architecture work.

## 22. Safe to configure or defer

The following do not need to block the first local vertical slice if explicit defaults and audit boundaries exist:

- exact amount/product approval thresholds after role categories are accepted;
- default tariff units, provided they are configurable, source wording overrides them, and ambiguity requires review;
- detailed supplier-specific deadline templates;
- audit/document retention periods;
- detailed Updated Operational Margin treatment for uncommon taxes, pass-throughs, FX, penalties, credits, and refunds, provided incomplete values are not presented as authoritative;
- exact amendment-versus-new-Booking threshold, provided amendment history and future split/replacement capability are preserved;
- advanced tariff adapters and global cross-Supplier search;
- full cancellation/refund automation after minimum history and adjustment records exist;
- full communication ingestion;
- Google Sheets/Drive persistence and Apps Script deployment;
- external availability integrations;
- advanced accounting, revenue recognition, tax, payroll, and attendance;
- AI-assisted search beyond deterministic/reviewable suggestions.

## 23. Stop condition

After this plan is reviewed, stop. Do not implement, migrate, configure Google Workspace, add authentication, build the matcher/UI, modify the prototype, or connect external systems until the owner gives a separate implementation authorization.

## 24. Final owner corrections and dangerous-behavior acceptance tests

This section supersedes any earlier wording in this plan that leaves the following items unresolved or stronger than approved.

### Confirmed contract corrections

- **CONFIRMED:** The first real tariff pilot is Bangkok Travel Services. The first implementation uses synthetic data, then validates the same reviewed extraction/matching/calculation workflow against Bangkok Travel Services source files. The pilot is not a universal tariff-engine commitment.
- **CONFIRMED:** Expo eligibility uses the actual date/time the client sends payment. Store `client_payment_sent_at` and `verification_at` as different facts. A later verification time must never rewrite the sent time or change an otherwise eligible Expo payment.
- **CONFIRMED:** Staff may record a payment and attach proof, but only an authorized verification action makes funds eligible for financial gates.
- **CONFIRMED:** Supplier reservation/request may occur before client payment. Supplier Payment is blocked unless verified client funds available for that Supplier Payment are at least equal to its amount. WMIT must not bridge a shortfall. Any separate authorization requirement is enforced as an additional gate.
- **CONFIRMED:** Phase 1 is one end-to-end vertical slice, not a collection of foundations. Tariff, quotation, Booking, Supplier Booking, payment proof/verification/allocation, payable gating, documents/tasks, Departure visibility, and the confirmed Expo context must be executable together using synthetic data.

### Dangerous-behavior acceptance tests

1. **Expo timestamp:** payment sent inside the Expo window and verified later remains eligible; payment sent outside the window and verified inside remains ineligible; missing sent timestamp is not guessed and creates a review blocker.
2. **Verification gate:** reported payment with proof but no authorized verification cannot increase verified available funds, satisfy a client balance, or unlock Supplier Payment.
3. **Supplier shortfall:** Supplier amount PHP 50,000 with PHP 30,000 verified available rejects Supplier Payment; after another PHP 20,000 is separately verified and available, the gate may pass subject to configured authorization. No WMIT-funded bridge is permitted.
4. **Allocation:** a client instruction split across bookings is recorded exactly; no instruction remains unallocated; the system never applies money to the oldest invoice or largest balance.
5. **Pre-invoice payment:** payment can be recorded before an invoice exists without fabricating an invoice or treating entry as verification.
6. **Booking separation:** creating a Booking after client selection does not set client commitment to confirmed, payment to received, Supplier fulfillment to confirmed, or Supplier Payment to allowed.
7. **Tariff review:** upload never directly creates a client quotation; unreviewed extraction cannot be trusted; Bangkok pilot matrix combinations preserve hotel, nights, pax, room type, units, supplements, validity, and itinerary conditions.
8. **Tariff choice:** requirements are entered before matching, multiple candidates are returned, no candidate is silently labeled best, and staff selection is required.
9. **Expo scope:** no seasonal, early-bird, group, supplier-specific, or other future promotion is applied in Phase 1.
10. **Permissions:** Staff may record proof but cannot verify funds, execute Supplier Payment, approve refunds, or approve price overrides without an explicitly configured trusted authority. Intern access is denied for sensitive fields and actions by default.
11. **Amendment:** a changed date, product, supplier cost, or client price creates a revised calculation, preserves the old snapshot, records supplier/client actions, and requires revised client acceptance when required by the configured policy; it never silently overwrites history.
12. **Cancellation:** traveler cancellation does not automatically refund; supplier terms, replacement possibility/deadline, penalty, credit/refund result, and approval remain explicit.

### Current blockers versus safe implementation

Only trusted role/approval authority is **BLOCKED** for the affected high-impact actions. The safe behavior is deny-by-default with an explicit pending-approval task. Margin detail, traveler staging, supplier deadline templates, retention, uncommon cancellation/refund rules, and amendment split thresholds are **CONFIGURABLE or DEFERRED** and must use visible incomplete/manual states. They must not block synthetic domain walkthroughs and must not be silently invented.
