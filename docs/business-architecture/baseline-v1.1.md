# WMIT Business Architecture Baseline v1.1

> **NON-EXECUTABLE SUPPORTING BASELINE:** [BASELINE-HANDOFF.md](BASELINE-HANDOFF.md) is the current implementation contract and supersedes conflicting status, default, phase-order, or unresolved wording in this historical baseline.

Status: **DEFINITIVE BUSINESS ARCHITECTURE BASELINE v1.1 — SUPERSEDES BASELINE v1**  
Date: 2026-08-13  
Scope: architecture/discovery only. No implementation, schema change, migration, integration, configuration, UI change, or real-data action is authorized by this document.

This revision incorporates the latest explicit owner clarifications and the six-case validation evidence. It must be treated as the current business authority. [baseline-v1.md](baseline-v1.md) is retained as historical baseline evidence and is superseded by this document.

Classification labels:

- **CONFIRMED** — explicitly answered by the owner or demonstrated by validated WMIT cases.
- **DERIVED** — necessary consequence of confirmed rules.
- **PROVISIONAL** — deliberately staged implementation boundary, not a new business rule.
- **UNRESOLVED** — genuinely not decided; implementation must not guess.

## 1. Executive summary

WMIT Operations is a human-controlled operational system for turning fragmented travel inquiries into accurately priced, properly tracked, supplier-fulfilled arrangements. It must preserve the difference between:

```text
original client request
→ researched options
→ availability evidence
→ WMIT commercial proposal
→ client decision
→ actual Booking
→ Supplier Booking(s)
→ client money and supplier obligations
→ documents, vouchers, deadlines, and closeout
```

This is not a Lead → Quotation → Booking pipeline. It is a branching workflow. An Inquiry may change direction, produce many options, and produce multiple independent Bookings. A custom tariff quotation may precede availability checking. A ready-made Supplier Package must have availability checked before presentation. One Booking may contain services from multiple Suppliers. A shared Departure groups independent Bookings operationally and never merges their finances.

The tariff system is not `upload tariff → AI understands it → automatic quotation`. Its correct role is to create reviewable structured supplier-rate information, match staff-entered requirements against a selected Supplier’s tariff library, show potential options and warnings, produce a draft calculation, and support a human-selected, human-reviewed WMIT Quotation.

## 2. Business goals — CONFIRMED

The system should reduce tariff-search time, missed follow-ups/deadlines, payment-tracking errors, voucher-production time, and markup/fee-calculation errors. Success means faster quoting, better payment and supplier-obligation visibility, reliable operational margin visibility, easier document production, and fewer missed actions.

## 3. Mandatory terminology and distinctions

| Term | Meaning | Status |
|---|---|---|
| Inquiry | What the client originally asked for, preserved even when destination, dates, package, supplier, pax, or arrangement changes. | CONFIRMED |
| Client | Ongoing customer relationship; may have many inquiries/bookings and may not be the communicator, payer, or traveler. | CONFIRMED |
| Person | Human identity that may communicate, coordinate, pay, travel, or participate. | DERIVED |
| Traveler | Person in a particular Booking as a traveler role. | CONFIRMED |
| Coordinator | Person communicating/organizing; may or may not travel or pay. | CONFIRMED |
| Payer/financier | Person or party funding an obligation; may or may not travel or communicate. | CONFIRMED |
| Supplier | Umbrella term for wholesalers, DMCs, airlines, hotels, transfers, tour operators, insurance, visa/document providers, airfare sources, and others. | CONFIRMED |
| Supplier Package | Existing supplier-originated ready-made product/package, commonly wholesaler/group departure. | CONFIRMED |
| Supplier Tariff | Supplier rate information used to construct a custom arrangement. Never itself a WMIT Quotation. | CONFIRMED |
| Commercial Option | Researched WMIT option that may be presented: package, tariff-derived arrangement, supplier quote, airfare source, or mixed arrangement. | CONFIRMED |
| Availability Evidence | Evidence of an availability check for specified dates, quantity, service, source, time, and expiry/hold terms. | DERIVED |
| WMIT Quotation | WMIT’s client-facing commercial proposal, with separate internal pricing provenance. | CONFIRMED |
| Booking | Actual selected or committed travel arrangement. | CONFIRMED |
| Booking Item | One service/charge in a Booking, retaining its own supplier, cost, client amount, and fulfillment state. | CONFIRMED |
| Supplier Booking | WMIT’s reservation/request/confirmation relationship with a Supplier for one or more Booking Items. | CONFIRMED |
| Departure | Shared supplier/group-departure operational grouping. | CONFIRMED |
| Client Payment | Money received/reported from a client, separate from proof, verification, allocation, and refund. | CONFIRMED |
| Payment Allocation | Application of part/all of a client payment to one or more obligations/bookings. | CONFIRMED |
| Supplier Payable | WMIT’s operational obligation to a Supplier. | CONFIRMED |
| Supplier Payment | Money paid by WMIT to a Supplier against a payable/obligation. | CONFIRMED |
| Expected Operational Margin | Expected client selling value minus expected direct supplier/service cost. | CONFIRMED |
| Updated Operational Margin | Current client selling value minus current/confirmed direct cost and approved direct adjustments. | CONFIRMED |
| Voucher | Received or WMIT-generated travel Document/output, not a separate core entity. | CONFIRMED |
| Task | Required action with owner, due date, related record, and operational state. | CONFIRMED |
| Communication Activity | Lightweight interaction/source-thread record, not full channel ingestion. | CONFIRMED |

Non-negotiable distinctions: Supplier Tariff ≠ WMIT Quotation; Supplier Package ≠ WMIT Quotation; Booking ≠ Quotation; Supplier Booking ≠ Booking; Departure ≠ Booking; cash received ≠ revenue ≠ profit.

## 4. Domain boundaries and principles — CONFIRMED / DERIVED

Core domains are Customer/People, Inquiry/Commercial Research, Supplier Products/Tariffs, Commercial Options/Quotations, Booking/Fulfillment, Financial Operations, Documents/Vouchers, Tasks/Communications, Departures, and Audit/Approval controls.

Sheets is the future structured source of truth; Drive is the file repository. The current phase remains local-only. Suppliers remain one umbrella model. IDs are immutable and relationships use IDs. Source provenance and material amendment history are preserved. Automation drafts, matches, calculates, organizes, and alerts; human staff make commercial, financial, availability, sensitive-document, and exception decisions.

Out of scope are full accounting, statutory tax/revenue recognition, payroll/HR/attendance, live global travel search, autonomous external booking/purchasing/payment/refunds/messages, full channel ingestion, and production Google Workspace setup during this phase.

## 5. Core entities, relationships, and aggregates

```text
Client ──< Inquiry >── Person role relationships
Inquiry ──< Commercial Option >── Supplier Package / Supplier Tariff / supplier quote / custom research
Commercial Option ──< Availability Evidence
Inquiry ──< WMIT Quotation ──< Quotation Item
Inquiry ──< Booking ──< Booking Item
Booking Item ──< Supplier Booking Item >── Supplier Booking >── Supplier
Booking Item ──< Departure Membership >── Departure
Booking ──< Client Obligation/Invoice
Client Payment ──< Payment Allocation >── Client Obligation/Booking/approved target
Supplier Booking ──< Supplier Payable ──< Supplier Payment
Records ──< Document / Task / Communication Activity / Audit Event
```

Confirmed cardinalities:

- one Client may have many Inquiries and Bookings;
- one Inquiry may produce many options, quotations, and multiple independent Bookings;
- one Booking has many Booking Items and may have multiple Supplier Bookings;
- one Booking may contain multiple Suppliers;
- one Supplier Booking may cover multiple Booking Items;
- a Booking Item may have successive Supplier Bookings after amendment/replacement/split fulfillment;
- one Departure groups many independent Booking/Booking Item memberships;
- one Client Payment may be unallocated or split across obligations;
- one Supplier Booking may have multiple payable components and Supplier Payments.

Aggregate boundaries are derived: Inquiry, Quotation, Booking, Supplier Fulfillment, Client Money/Obligations, Supplier Payables, Departure, and Documents have separate histories and controlled operations. No separate Trip or Travel Party entity is required unless later evidence proves that relationships are insufficient.

## 6. Workflow model — CONFIRMED

```text
Inquiry
→ clarify and preserve original facts
→ research one or more Commercial Options
→ check availability where required
→ prepare/present Supplier Package or WMIT Quotation
→ record client decision
→ create/update Booking when selected/committed
→ reserve/request through Supplier Booking(s)
→ manage client money and Supplier Payables
→ manage Documents, Vouchers, Tasks, and readiness
→ travel, amend, cancel/refund/credit, or close
```

### Supplier Package path — CONFIRMED

`Inquiry → Supplier Package → availability check FIRST → availability evidence → applicable selling price → presentation → client decision → Booking → Supplier Booking → supplier confirmation/voucher.`

An unavailable package is not presented as available.

### Custom tariff path — CONFIRMED

`Inquiry → selected Supplier/Tariff scope → staff enters requirements → tariff matching → draft cost calculation → WMIT pricing rules → draft WMIT Quotation → staff review → client-facing quotation → availability later or in parallel → client decision → Booking → Supplier Booking(s).`

A custom quotation may precede availability. A quotation never proves availability.

The tariff matcher returns multiple potential options and warnings; staff chooses the option before WMIT pricing rules are applied. The system must not silently rank or select the best option.

### Find More Options — CONFIRMED

The system supports a staff-initiated Find More Options action. New searches must exclude or clearly distinguish previously rejected, unavailable, or superseded options so staff do not simply receive the same option again. The system may assist search and matching but must not choose which Supplier/product WMIT presents.

### Amendments and supplier failure — CONFIRMED

Material changes normally amend/update the existing Booking, with history of old/new dates, products, suppliers, prices, costs, reason, actor, timestamp, client communication, and re-acceptance where required. Supplier failure triggers alternative research and client choice; no replacement Supplier is chosen automatically. Cancellation/refund/credit follows applicable terms and approval.

## 7. Independent state model — CONFIRMED / DERIVED

The system must not use one status to represent everything.

| Dimension | Minimum meaning |
|---|---|
| Inquiry | New, Contacted, Clarifying, Researching, Options ready, Awaiting client, Converted whole/part, Closed, Cancelled. |
| Option | Researched, Draft, Ready to present, Presented, Accepted, Rejected, Superseded, Unavailable, Expired. |
| Availability | Not Checked, Checking, Available, Unavailable, Held/Reserved, Pending supplier response, Unknown, Expired/Stale. |
| Client decision | No decision, Interested, Clarification requested, Verbally selected, Accepted for proceeding, Declined, Changed request, Withdrawn. |
| Quotation | Draft, Internally reviewed, Sent, Awaiting client, Accepted for proceeding, Rejected, Expired, Superseded, Withdrawn. |
| Booking commitment | Draft, Client-selected, Awaiting payment, Client-confirmed, Confirmed under WMIT policy, Changed, Cancelled, Completed. “Provisional Booking” is not a separate core entity. |
| Client payment receipt | Entered/Reported, Evidence pending, Pending verification, Verified, Rejected, Reversed, Refunded. |
| Client obligation | Unallocated, Unpaid, Partially paid, Deposit sufficient, Fully paid, Credited/refunded, Needs attention. Derived from verified allocations and approved credits. |
| Supplier fulfillment | Not requested, Request prepared, Requested, Reservation/hold placed, Awaiting confirmation, Partially confirmed, Confirmed, Failed/unavailable, Amended, Cancelled, Completed. |
| Supplier payable | Expected, Deposit due, Partially payable/paid, Final balance due, Paid, Disputed, Cancelled, Refund/credit pending, Closed. |
| Document/Voucher | Expected, Requested, Received, Classified, Needs review, Accepted for use, Sent to client, Superseded, Missing/attention. |
| Task | Pending, Due soon, Due, Awaiting client, Awaiting supplier, Awaiting internal action, Requires attention, Completed, Cancelled. |

## 8. Supplier reservation, payment, and financial boundaries

### Supplier reservation before client payment — CONFIRMED

WMIT may reserve/request with a Supplier before client money is received. Supplier reservation and confirmation are visible independently from client commitment and client payment. Trusted/repeat/VIP cases may be reserved before payment, subject to the configured approval policy.

### Supplier payment — CONFIRMED

WMIT only pays Suppliers after client money has been received. Supplier Payment is separate from Supplier Booking, Supplier Payable, client payment, and client balance. Payment requires evidence and controlled authorization.

### Client payment proof and verification — CONFIRMED

Every client payment requires proof/evidence for verification. Entry, evidence receipt, verification, allocation, reversal, and refund are separate events. Unverified money must not silently become a final paid balance.

### Payment allocation — CONFIRMED

The client may specify how a payment is allocated. A payment can be initially unallocated or split across Booking A and Booking B. Payment Allocation preserves payment ID, target obligation, amount/currency, exchange-rate basis where applicable, actor, timestamp, and reallocation history.

The exact data-entry behavior when a payment arrives before a formal invoice is **PROVISIONAL**; the future design must support an approved operational obligation target without forcing every payment to one invoice.

### Client and supplier financial separation — CONFIRMED

Track separately client selling value, payments, verified payments, client outstanding balance, supplier cost, Supplier Payables, Supplier Payments, fees, discounts, refunds, cancellation penalties, supplier credits/adjustments, and operational margin. Shared Departures never consolidate these values.

## 9. Pricing rules — CONFIRMED

- Ready-made Supplier Packages with supplier-provided selling prices usually use the supplier-provided selling price.
- The applicable custom tariff quotation case uses a 30% fixed markup.
- Conversion fee uses BDO Forex Selling Rate + 1.0.
- Credit card/PayPal fee is 5%.
- Visa assistance fee is variable/configurable by case.
- Other WMIT fees may include service, visa assistance, ticketing, insurance, bank, and conversion fees.
- Discounts are explicit, not hidden inside cost or markup.
- Calculated cost/markup/price and actual quoted price are both retained.
- Staff overrides retain calculated value, actual value, actor, timestamp, and reason where appropriate.

Operational margin remains:

`Expected Operational Margin = expected client selling value − expected direct supplier/service cost.`

`Updated Operational Margin = current client selling value − current/confirmed direct cost − approved direct adjustments.`

This is not statutory/accounting profit. Exact inclusion of each fee, tax, pass-through, FX effect, refund, penalty, and supplier credit in the updated margin remains **UNRESOLVED**.

## 10. Supplier Package and Departure model — CONFIRMED / DERIVED

Supplier Package is a reusable supplier-originated product with supplier, product/departure reference, destination, dates, inclusions/exclusions, source document, supplier price, validity, capacity/terms, and cancellation conditions. Availability is separate evidence.

Departure is an operational grouping. Association is primarily at Booking Item level where needed; a Booking-level summary may be derived where applicable. Departure views show bookings, travelers, confirmations, missing documents, deadlines, and readiness, but not merged invoices, payments, payables, refunds, or profit.

## 11. People and roles — CONFIRMED

Person identity is separate from Client and from Inquiry/Booking roles. Explicit roles include coordinator, payer/financier, traveler, communication participant, emergency contact, and other approved roles. Do not infer communicating person = client = payer = traveler. No separate Travel Party entity is required now.

## 12. Documents and voucher workflow — CONFIRMED / DERIVED

Documents may come from email, Messenger, WhatsApp, Viber, Drive, supplier portals, client uploads, and other sources. They retain source, type, related records, owner, received/generated date, storage reference, sensitivity, review status, and current/superseded state. Payment evidence, passports/identity documents, supplier cost, margins, internal notes, and sensitive financial data are restricted by role.

Voucher workflow is:

`confirmed Booking data → draft/update WMIT voucher Document → staff review → send to client → update/supersede after changes.`

Voucher is not a separate core entity.

## 13. Tasks and communications — CONFIRMED

Tasks cover client/supplier follow-ups, availability, quotation, reservations, deposits, final payments, installments, confirmations, vouchers, document review, pre-departure, PDOS, reminders, and cancellation/refund review. Alerts are idempotent and occur two days before, one day before, or same day when urgent. “Overdue” may be a derived timing signal, not a replacement for the business task state.

Communication Activity is lightweight and records channel, time, participants, actor, source/thread reference, summary, related records, and attachments. Full message ingestion is deferred. B2B is not an inquiry source classification.

## 14. Permissions, approvals, and audit

Production must enforce trusted authentication and service-boundary authorization; caller-supplied actor identity is insufficient. Admin/Owner and Manager have elevated visibility of supplier costs, margins, sensitive financial data, refunds, adjustments, approvals, and sensitive documents. Staff has operational access according to policy. Interns do not default to supplier costs, markup/margin, payment evidence, refunds, supplier purchases, or sensitive identity documents.

High-impact actions require human approval: final commercial choice, ambiguous tariff interpretation, final client-facing price, uncertain availability, payment verification, supplier payment, refund, external booking/purchase, sensitive communication, and low-confidence extraction. Exact authorization thresholds and role thresholds remain **UNRESOLVED**.

Every meaningful action records trusted actor, action, record, timestamp, old/new values where applicable, result, reason/evidence, approval reference, and error where applicable. Logs avoid secrets and unnecessary personal data.

## 15. Tariff architecture — CONFIRMED human-controlled model

### 15.1 Correct chain

```text
Supplier tariff file
  ↓
Classify document
  ↓
Extract structured tariff information
  ↓
Human/reviewable tariff record
  ↓
Staff enters client requirements
  ↓
Matcher searches selected Supplier’s tariff library
  ↓
Potential options and warnings
  ↓
Draft calculation using actual tariff rules
  ↓
Staff chooses option
  ↓
WMIT pricing rules
  ↓
Draft WMIT Quotation
  ↓
Staff reviews
  ↓
Final client-facing quotation
```

The tariff file, extraction result, structured tariff record, matching result, calculation, pricing result, and final quotation remain separate records with provenance.

### 15.2 Ingestion and review — CONFIRMED

The original file is retained with source channel, supplier candidate, received time, file reference/checksum where available, sensitivity, and related record context. Classification records type/source, confidence, competing classifications, evidence, and warnings. Extraction records raw value, normalized value, confidence, page/section/row provenance, warnings, review status, and extraction version.

Extraction never directly creates a client quotation, Booking, Supplier Booking, payment, or external commitment. A human/reviewable tariff record is required before matching.

### 15.3 Structured tariff model — CONFIRMED boundary / PROVISIONAL implementation shape

The system must support structured/matrix/conditional rates, not only `service → price`. The smallest reusable common envelope contains:

- Supplier and tariff document/version;
- destination/service scope;
- travel-date validity and effective period;
- season/supplement period;
- hotel/property/category and room type;
- duration/nights;
- pax bands and adult/child/infant rules;
- meal plan;
- transfer/tour/service components;
- supplements and compulsory charges;
- cancellation/other conditions;
- amount, currency, unit basis, quantity driver, and source provenance;
- itinerary days, activities, meals, overnight, city, and notes.

The implementation must not create a giant universal travel tariff language. Each Supplier may retain supplier-specific structures and rules. A common envelope is used only for validated search/display/calculation needs. The first implementation must be driven by validated real supplier documents and start with the smallest structured fields that those documents require.

### 15.4 Staff requirements-first matching — CONFIRMED

Before matching, staff enters the client requirements, for example:

```text
Barcelona
5 nights
4 adults
2 rooms
Hotel Category 4★
October 12–17
Breakfast
Airport transfer
City tour
```

Staff selects the Supplier and tariff scope in Phase 1. The matcher then searches only that selected library and may return multiple candidates:

```text
Option A — Hotel X, 4★, 5 nights, 2 rooms, applicable rate,
            supplements, city tour, airport transfer, conditions
Option B — Hotel Y, 4★, 5 nights, 2 rooms, different rate/conditions
Option C — Hotel Z, ...
```

The system must show all material matching options. It must not choose the cheapest, highest-margin, or “best” Supplier/product. Staff chooses the Commercial Option.

### 15.5 Draft calculation and warnings — CONFIRMED

The matcher/calculator uses the tariff’s actual rules and quantities. It must show components, units, conditions, source version, validity, assumptions, and warnings. Examples:

- `Transfer USD 50` has unclear per-person/per-vehicle or one-way/round-trip basis;
- requested date is outside tariff validity;
- rate applies to 4–6 pax but request is 3 pax;
- room type, child rule, season, supplement, or meal basis is missing;
- overlapping tariff versions conflict.

The WMIT defaults are **CONFIRMED configured interpretations**:

- tariff rate defaults to per person unless explicitly stated otherwise;
- transfer defaults to per person per way unless explicitly stated otherwise;
- explicit Supplier wording overrides the defaults;
- ambiguity requires human review and cannot silently become a client price.

If requested dates do not exactly match tariff validity, the system shows the potentially relevant rate, flags the validity issue, and requires staff confirmation/manual Supplier verification. It is a review condition, not an automatic rejection.

### 15.6 Revisions and provenance — CONFIRMED

Multiple tariff documents may coexist for one Supplier: general tariffs, revised tariffs, hotel rates, FIT tariffs, transfer/tour tariffs, seasonal supplements, special rates, and revisions. Each has source document, version/revision, validity/effective period, scope, supersession status, and authority/review status. Overlap/conflict is flagged; old versions are not blindly replaced. The selected source/version is retained in every calculation and quotation.

### 15.7 Pricing and quotation boundary — CONFIRMED

After staff chooses a candidate, configurable WMIT pricing rules apply. The custom tariff quotation case uses 30% markup; conversion fee uses BDO Forex Selling Rate + 1.0; card/PayPal is 5%; visa assistance is variable/configurable; discounts are explicit. The output is a draft WMIT Quotation retaining calculated values, actual overrides, rule versions, staff actor/time, source tariff/version, and warnings. Staff reviews it before the final client-facing quotation is produced or sent.

## 16. Automation and AI boundaries — CONFIRMED

Automate classification assistance, structured extraction, supplier-scoped lookup, matching suggestions, arithmetic, warnings, reminders, document organization, and draft outputs. Keep human approval for final commercial choice, ambiguous interpretation, final price, uncertain availability, payment verification, supplier payments, refunds, sensitive communications, external commitments, and low-confidence extraction.

AI must never invent rates, assume availability, select the best Supplier, silently change prices, verify payments, pay Suppliers, issue refunds, commit low-confidence extraction, or send a client-facing quotation without staff review.

## 17. Six-case validation — CONFIRMED evidence

1. Messenger August request changing to October wholesaler package validates Inquiry preservation, alternative options, availability-first package handling, and changed Booking lineage.
2. Custom DMC tariff plus airfare validates quotation-before-availability and separation of tariff, matching, calculation, pricing, and quotation.
3. Group coordinator/payer/travelers validates Person and role separation.
4. Mixed airfare/hotel/transfer/insurance Booking validates item-level Supplier relationships and multiple Supplier Bookings.
5. Reservation before payment plus installments validates commitment/payment/verification/allocation/Supplier Payable separation and the rule that Supplier Payment waits for received client money.
6. Supplier failure/cancellation validates alternative options, non-refundable traveler cancellation, replacement process, penalties, credits/refunds, amendments, approval, and history.

## 18. Remaining genuinely unresolved decisions

1. exact authentication/authorization thresholds and which roles may approve each high-impact action;
2. exact refund/adjustment approval thresholds;
3. audit and sensitive-document retention periods;
4. role-based authorization/policy for which staff roles may mark a Booking client-confirmed and/or request a Supplier reservation before client payment; this does not change the domain separation already confirmed;
5. exact treatment of fees, taxes, pass-through amounts, FX effects, refunds, penalties, and Supplier credits in Updated Operational Margin;
6. exact operational target behavior for payments received before a formal invoice exists;
7. exact staged traveler-data requirements by service/destination;
8. exact client-price amendment policy after confirmation;
9. Supplier-specific deadline/approval templates.

These are policy decisions still requiring explicit approval. They must not be filled by implementation convenience.

## 19. Explicit future-build constraints

Future implementation must start from this baseline, not from the existing schema tables. It must preserve immutable IDs, source provenance, amendment/payment history, human review gates, role-based projections, audit events, idempotent reminders, exact money calculations, and synthetic testing against the six cases. Google Workspace remains unavailable and must not be configured during this architecture revision.
