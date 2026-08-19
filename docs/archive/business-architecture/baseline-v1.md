# WMIT Business Architecture Baseline v1

> **NON-EXECUTABLE HISTORICAL BASELINE:** [BASELINE-HANDOFF.md](BASELINE-HANDOFF.md) is the current implementation contract. Do not use this file to derive implementation policy.

> **SUPERSEDED by [baseline-v1.1.md](baseline-v1.1.md).** This file is retained as historical Baseline v1 evidence. The latest owner clarifications and classifications are authoritative in Baseline v1.1.

Status: **DEFINITIVE BUSINESS ARCHITECTURE BASELINE v1**  
Date: 2026-08-13  
Scope: local architecture/discovery only. No implementation, migration, Google Workspace setup, production configuration, or real-data change is authorized by this document.

This document supersedes the earlier proposal and validation drafts in this directory. Those files remain useful as discovery evidence, but this baseline is the business authority for the future redesign. Classification labels are used throughout:

- **CONFIRMED** — explicitly confirmed by the owner or demonstrated by the six validated WMIT cases.
- **DERIVED** — a necessary architectural consequence of confirmed rules; not an additional business preference.
- **PROVISIONAL** — a safe implementation boundary proposed for future validation or staged delivery.
- **UNRESOLVED** — the business rule is not yet specific enough to implement without an explicit decision.

## 1. Executive summary

WMIT Operations is a controlled operational system for turning fragmented travel inquiries into accurately priced, properly tracked, supplier-fulfilled travel arrangements. It must preserve the difference between the client’s original request, researched alternatives, availability evidence, WMIT’s commercial proposal, the selected Booking, supplier-side fulfillment, client money, supplier obligations, documents, and follow-up work.

The business is not a simple Lead → Quotation → Booking pipeline. It is a branching workflow. Requests change, several options may be researched, a custom quotation may precede availability checking, and one Inquiry may produce multiple independent Bookings. A Booking may contain services from multiple Suppliers. Shared Departures group bookings operationally but never merge their client or supplier finances.

The future system is not a full accounting system, live travel marketplace, autonomous booking agent, or full communication-ingestion platform. It is a human-controlled operational system with structured records, evidence, calculations, reminders, document outputs, and explicit approval boundaries.

## 2. Business goals and success measures

### Goals — CONFIRMED

WMIT wants to reduce:

1. time spent searching and interpreting tariffs;
2. missed client and supplier follow-ups;
3. payment-tracking errors;
4. time spent producing and updating vouchers;
5. markup and fee-calculation errors;
6. confusion about supplier deadlines, obligations, and readiness.

### Success measures — CONFIRMED / DERIVED

Staff should be able to:

- preserve the original inquiry while handling changes and alternatives;
- find relevant supplier packages and tariff information within the selected scope;
- create a client-safe quotation without exposing internal cost or notes;
- see which availability claims are evidenced, stale, uncertain, or not checked;
- see client payments, proof, verification, allocation, and outstanding balance separately;
- see each supplier obligation, deadline, payment, and remaining balance separately;
- produce a reviewed voucher from confirmed booking data;
- see follow-ups and deadlines before they become missed work;
- explain expected and updated operational margin without calling it statutory profit.

## 3. Architecture principles

1. **Business semantics outrank prototype tables.** Existing code is evidence, not authority.
2. **Sheets is the future structured source of truth; Drive is the file repository.** This phase remains local-only because Google Workspace is unavailable.
3. **Supplier is one umbrella concept.** Wholesalers, DMCs, airlines, hotels, transfers, tour operators, insurance providers, visa/document providers, airfare portals, and other providers are Supplier records with capabilities/types, not unrelated systems.
4. **Preserve provenance and history.** Do not overwrite original inquiries, source documents, old prices, old dates, supplier changes, payments, or material amendments.
5. **Separate independent state dimensions.** No single Booking status may imply client commitment, payment, supplier confirmation, supplier payment, or readiness.
6. **Use immutable, centrally generated IDs.** Relationships use IDs, never names alone.
7. **Human approval remains the commercial and financial authority.** Automation drafts, matches, calculates, organizes, and alerts; it does not silently commit or send.
8. **Fail visibly.** Ambiguity, stale validity, missing evidence, conflicts, low confidence, and approval requirements are states requiring attention.
9. **Keep the first implementation operational, not accounting-complete.** Margin, balances, refunds, credits, fees, and FX remain identifiable without claiming statutory accounting treatment.
10. **Prefer simple relationships over new aggregates.** No separate Trip or Travel Party entity is required unless later evidence proves that relationships are insufficient.

## 4. Terminology and mandatory distinctions

| Term | Baseline meaning | Status |
|---|---|---|
| Inquiry | What the client originally asked for, including original destination, dates, budget, party size, services, and source context. | CONFIRMED |
| Client | An ongoing customer relationship that may have many inquiries, trips, or bookings; it is not necessarily a traveler, payer, or communicator. | CONFIRMED |
| Person | An identifiable human who may communicate, coordinate, pay, travel, or participate. | DERIVED |
| Traveler | A Person participating in a particular Booking; traveler status is a relationship role, not an identity assumption. | CONFIRMED |
| Coordinator | A Person communicating or organizing for an Inquiry or Booking; may or may not travel or pay. | CONFIRMED |
| Payer/financier | The Person or party funding a client obligation; may or may not travel or communicate. | CONFIRMED |
| Supplier | Umbrella provider record for all supplier types used by WMIT. | CONFIRMED |
| Supplier Package | An existing supplier-originated ready-made product or package, commonly a wholesaler/group-departure product. | CONFIRMED |
| Supplier Tariff | Supplier rate information used to construct a custom arrangement. It is not a quotation or availability result. | CONFIRMED |
| Commercial Option | A researched WMIT option that may be presented to a client: package, tariff-derived arrangement, supplier quote, airfare source, or mixed arrangement. | CONFIRMED |
| Availability Evidence | Evidence of a check for specified dates, quantity, service, source, time, and expiry/hold terms. | DERIVED |
| WMIT Quotation | WMIT’s client-facing commercial proposal, with internal pricing provenance and a client-safe projection. | CONFIRMED |
| Booking | The actual selected or committed travel arrangement. It may be created from a quotation, package, alternative, or direct operational path. | CONFIRMED |
| Booking Item | One service or charge within a Booking, retaining its own supplier, cost, selling amount, and fulfillment state. | CONFIRMED |
| Supplier Booking | WMIT’s reservation/request/confirmation relationship with a Supplier for one or more Booking Items. | CONFIRMED |
| Departure | Shared supplier/group-departure grouping for multiple independent WMIT Bookings. | CONFIRMED |
| Client Invoice | A client-facing or operational client obligation document. It is not a receipt or profit. | DERIVED |
| Client Payment | Money received or reported from a client, preserved independently from allocation and verification. | CONFIRMED |
| Payment Allocation | Application of all or part of a client payment to one or more client obligations. | CONFIRMED |
| Supplier Payable | WMIT’s operational obligation to pay a Supplier for a Supplier Booking or Booking Item. | CONFIRMED |
| Supplier Payment | Money paid by WMIT to a Supplier against a payable/obligation. | CONFIRMED |
| Refund/Credit | Approved amount returned to a client or credited by a Supplier; never a rewrite or deletion of the original payment. | CONFIRMED |
| Expected Operational Margin | Expected client selling value less expected direct supplier/service cost. | CONFIRMED |
| Updated Operational Margin | Current client selling value less current/confirmed direct cost and approved direct adjustments. | CONFIRMED |
| Voucher | A received or WMIT-generated travel document/output. It is a Document subtype/workflow, not a separate core entity. | CONFIRMED |
| Task | A required action with owner, due date, related record, and operational state. | CONFIRMED |
| Communication Activity | Lightweight record of a relevant interaction or source/thread reference; not full channel ingestion. | CONFIRMED |

The following distinctions are non-negotiable: Supplier Tariff ≠ WMIT Quotation; Supplier Package ≠ WMIT Quotation; Booking ≠ Quotation; Supplier Booking ≠ Booking; Departure ≠ Booking; cash received ≠ revenue ≠ profit.

## 5. Domain boundaries

### Core operational domains — CONFIRMED / DERIVED

- Customer and people: Client, Person, relationships and participant roles.
- Inquiry and commercial research: Inquiry, Commercial Option, Supplier Package, Supplier Tariff, availability evidence, source documents.
- Commercial output: WMIT Quotation and quotation items.
- Fulfillment: Booking, Booking Item, Supplier Booking, Supplier Booking Item, Departure.
- Financial operations: Client Invoice/obligation, Client Payment, Payment Allocation, Supplier Payable, Supplier Payment, refund/credit, operational margin projections.
- Documents and work: Document, Voucher workflow, Task, Communication Activity.
- Controls: approval decisions, audit/action log, visibility policy.

### Explicit boundaries — CONFIRMED / PROVISIONAL

Out of the baseline’s core are full accounting, statutory tax treatment, revenue recognition, payroll/HR/attendance, live global travel search, automatic supplier purchasing, autonomous external communication, and full Messenger/WhatsApp/Viber/email ingestion. Interfaces may be added later behind controlled adapters.

## 6. Core entities and relationships

```text
Client ──< Inquiry >── Person roles (coordinator, payer, traveler, participant)
Inquiry ──< Commercial Option >── Supplier Package / Supplier Tariff / supplier quote / custom research
Commercial Option ──< Availability Evidence
Inquiry ──< WMIT Quotation ──< Quotation Item
Inquiry ──< Booking ──< Booking Item
Booking Item ──< Supplier Booking Item >── Supplier Booking >── Supplier
Booking Item ──< Departure Membership >── Departure
Booking ──< Client Obligation/Invoice
Client Payment ──< Payment Allocation >── Client Obligation/Booking/approved target
Supplier Booking ──< Supplier Payable ──< Supplier Payment
Booking/Item/Departure ──< Document / Voucher
All important records ──< Task / Communication Activity / Audit Event
```

### Cardinalities — CONFIRMED unless marked otherwise

- One Client may have many Inquiries and Bookings.
- One Inquiry may have many Commercial Options, quotations, and **multiple independent Bookings**.
- One Booking contains many Booking Items and may have multiple Supplier Bookings.
- One Booking may contain multiple Suppliers.
- One Supplier Booking may cover multiple Booking Items; a Booking Item may have successive Supplier Bookings when amended, replaced, or split.
- One Departure contains many independent Booking/Booking Item memberships.
- One client payment may be unallocated or split across multiple obligations; one obligation may receive many payments.
- One Supplier Booking may have multiple payable components and supplier payments. A single summarized payable view is acceptable only as a derived presentation, not as a semantic collapse.

### Aggregate boundaries — DERIVED / PROVISIONAL

- **Inquiry aggregate:** original request, participant roles, options, client decisions, inquiry communications, and inquiry tasks. Amendments to the original request are appended as change events or new request versions; original facts remain readable.
- **Quotation aggregate:** WMIT quotation, its items, pricing calculation snapshots, client-facing projection, source option references, and quotation documents. It may be drafted before availability for custom work.
- **Booking aggregate:** actual selected arrangement, participant roles, Booking Items, booking amendments, client commitment state, and readiness projections. It must not contain supplier payment state as one collapsed status.
- **Supplier fulfillment aggregate:** Supplier Booking, supplier evidence, reservation/confirmation state, linked Booking Items, terms, deadlines, and failure/amendment history.
- **Client money/obligation aggregate:** client obligation/invoice, payment receipts, verification, allocation, credits/refunds, and balance projections. Payment receipt is immutable history.
- **Supplier payable aggregate:** expected/confirmed supplier obligation, components, terms/deadlines, payments, credits, and remaining balance.
- **Departure aggregate:** shared supplier/departure identity, memberships, group-level readiness and tasks. It does not own or merge client invoices, payments, payables, refunds, or margins.
- **Document aggregate:** file metadata, provenance, classification/extraction/review state, sensitivity, supersession, and links. Structured business records remain authoritative.

No separate Trip or Travel Party aggregate is required now. If later evidence shows a reusable grouping independent of an Inquiry and Departure, that becomes a new decision rather than an implicit implementation.

## 7. Workflow and lifecycle model

The canonical workflow is branching:

```text
Inquiry
  → clarify and record original facts
  → research one or more options
  → check availability where the path requires it
  → prepare/present a Supplier Package or WMIT Quotation
  → record client decision
  → create/update Booking when selected/committed
  → reserve/request through one or more Supplier Bookings
  → track client obligations/payments and supplier payables/payments
  → receive/review/generate documents and vouchers
  → complete tasks and pre-departure readiness
  → travel, amend, cancel, refund/credit, or close out
```

### Wholesale package path — CONFIRMED

`Inquiry → Supplier Package → availability check first → evidence → applicable supplier selling price → presentation → client decision → Booking → Supplier Booking → supplier confirmation/voucher.`

An unavailable result must never be presented as available. A package can be recorded as a researched option with an unavailable state and evidence.

### Custom tariff path — CONFIRMED

`Inquiry → scoped Supplier Tariff search → rate matching → separate airfare/source research where needed → draft cost → WMIT pricing rules → WMIT Quotation → client presentation → availability later or in parallel → client decision → Booking → Supplier Booking(s).`

A tariff-derived quotation may exist while availability is Not Checked, Pending, Unknown, or otherwise qualified. Quotation sent never proves availability.

### Find More Options — CONFIRMED

Staff may request/search more relevant packages or tariff-derived options. Previously researched, presented, rejected, unavailable, or superseded options remain visible so the system does not repeat the same option. The system may assist retrieval and matching but never autonomously chooses the supplier/product WMIT presents.

### Amendments — CONFIRMED

Material changes normally amend/update the existing Booking rather than automatically creating a new Booking. Every material amendment preserves old dates, product, supplier, price, cost, reason, timestamp, staff actor, changed fields, and required client re-acceptance. A new Booking is allowed when the business intentionally creates a separate independent arrangement, not as an automatic side effect of every change.

### Supplier failure — CONFIRMED

WMIT searches alternatives, records the failed supplier/product and evidence, presents alternatives, and updates/amends the Booking if the client accepts. No replacement Supplier is automatically selected. If no acceptable alternative is selected, cancellation/refund/credit follows applicable terms and approval.

## 8. Independent state model

State is represented as separate dimensions and evidence, not one giant status.

| Dimension | Minimum states/meaning |
|---|---|
| Inquiry | New; Contacted; Clarifying; Researching; Options ready; Awaiting client; Converted in whole/part; Closed/no sale; Closed/unavailable; Cancelled by client. |
| Option | Researched; Draft; Ready to present; Presented; Accepted; Rejected; Superseded; Unavailable; Expired. |
| Availability | Not Checked; Checking; Available; Unavailable; Held/Reserved; Pending supplier response; Unknown; Expired/Stale. |
| Client decision | No decision; Interested; Clarification requested; Verbally selected; Accepted for proceeding; Declined; Changed request; Withdrawn. |
| Quotation | Draft; Internally reviewed; Sent; Awaiting client; Accepted for proceeding; Rejected; Expired; Superseded; Withdrawn. |
| Booking commitment | Draft; Client-selected; Awaiting payment; Client-confirmed; Confirmed under WMIT policy; Changed; Cancelled; Completed. “Provisional Booking” is not a separate core entity. |
| Client payment receipt | Reported/entered; Evidence pending; Pending verification; Verified; Rejected; Reversed; Refunded. |
| Client obligation balance | Unallocated; Unpaid; Partially paid; Deposit sufficient; Fully paid; Credited/refunded; Disputed/needs attention. This is derived from verified allocations and approved credits. |
| Supplier fulfillment | Not requested; Request prepared; Requested; Reservation/hold placed; Awaiting confirmation; Partially confirmed; Confirmed; Failed/unavailable; Amended; Cancelled; Completed. |
| Supplier payable | Not determined; Expected; Deposit due; Partially payable; Final balance due; Paid; Disputed; Cancelled; Refund/credit pending; Closed. |
| Document/voucher | Expected; Requested; Received; Classified; Needs review; Accepted for use; Sent to client; Superseded; Missing/needs attention. |
| Readiness | Not started; Preparing; Awaiting documents; Awaiting payment; Awaiting supplier confirmation; PDOS pending; Ready with exceptions; Ready; Departed; Closed. |
| Task | Pending; Due soon; Due; Awaiting client; Awaiting supplier; Awaiting internal action; Requires attention; Completed; Cancelled. |

The following non-equivalences must be tested and visible: client payment ≠ client commitment; client commitment ≠ supplier confirmation; supplier confirmation ≠ supplier payment; invoice issued ≠ money received; money received ≠ profit; Not Checked ≠ Unavailable; quotation sent ≠ availability confirmed.

### Reserve-before-payment rule — CONFIRMED

WMIT may place a supplier reservation/request before client money is received. WMIT only pays suppliers after client money has been received. Therefore the system must show the reservation/confirmation, client-payment state, payable deadline, and financial exposure independently. Trusted/repeat/VIP exceptions may be confirmed/reserved before payment, but the applicable policy/approval must be recorded. The exact approval threshold or role policy is **UNRESOLVED**.

## 9. Supplier model — CONFIRMED

Supplier is one master record with capabilities such as wholesaler, DMC, airline, hotel, transfer, tour operator, insurance, visa/document provider, airfare source, or other. A supplier may have multiple capabilities. Supplier-specific contacts, terms, currencies, documents, tariffs, packages, reservations, performance notes, and payment rules are related records.

The architecture must not create separate unrelated wholesaler and DMC systems. Supplier Package and Supplier Tariff are different product/source concepts under the same Supplier umbrella.

## 10. Supplier Package model — CONFIRMED / DERIVED persistence details

A Supplier Package is a supplier-originated ready-made product. It should retain supplier identity, package/product reference, destination, dates or departure, inclusions/exclusions, passenger rules, supplier-provided selling price when available, source documents, validity, capacity/availability context, cancellation terms, and revision/provenance.

Package availability is a separate evidence record. A package record may exist without current availability. The package’s supplier-provided selling price is a source value; WMIT may apply approved fees/discounts or exceptions, but the resulting WMIT Quotation is separate and retains its own calculated and actual price.

## 11. Supplier Tariff model — CONFIRMED / DERIVED structure

A Supplier Tariff is a versioned, reviewable source/rate set. It must support conditional and matrix values for destination, travel dates, tariff validity, effective period, season, hotel/category, room type, duration/nights, pax bands, adult/child/infant rules, meal plan, service type, transfers, tours, supplements, compulsory charges, minimum pax/stay, and other terms.

It may contain itinerary information, including day number, date/city, service/activity, meals, overnight, and notes. A tariff is not a WMIT Quotation and never becomes client-facing automatically.

The library must retain source document, supplier, revision/version, validity/effective periods, scope, review/authority status, superseded status, overlap/conflict warnings, extracted data, and provenance. Revised/overlapping documents are not blindly replaced.

## 12. Commercial Option model — CONFIRMED / DERIVED persistence boundary

A Commercial Option is the WMIT research/presentation unit that connects an Inquiry to a possible solution. It records option kind, source Supplier/Package/Tariff/quote, requested or alternative dates/destination/pax, services, cost and price snapshots where known, availability state/evidence, source documents, staff notes, presentation state, client response, rejection/unavailability reason, and lineage to an earlier option.

**Persistence rule — CONFIRMED / DERIVED:** persist options that are presented, accepted, rejected, unavailable, materially researched as an alternative, or used to support a quotation/Booking. Casual searches may remain a note or search activity until they become material. This preserves useful history without requiring a record for every abandoned lookup.

## 13. WMIT Quotation model — CONFIRMED

A WMIT Quotation is a WMIT-controlled commercial proposal. It includes Inquiry and selected-option references where applicable, client-safe content, validity, services/items, currency, supplier cost snapshots, calculated markup, fees, discounts, taxes if identified, calculated selling price, actual quoted price, override flag/reason/actor/time, payment terms, availability qualification, source provenance, and review/send state.

Quotation item sources may include Supplier Package, Supplier Tariff match, supplier quote, airfare source, another Supplier, WMIT fee, or mixed research. Quotation Items are not automatically Booking Items; conversion must preserve the selected actual arrangement and source lineage.

Client-facing projections must exclude supplier cost, markup, internal notes, restricted documents, extraction details, and other sensitive information.

## 14. Booking model — CONFIRMED

A Booking is the actual selected or committed arrangement. It links to the Inquiry, selected Commercial Option, and WMIT Quotation when those exist, but may be created through a direct approved operational path. It retains actual dates, destination, participants/roles, client commercial amounts, Booking Items, commitment evidence/state, amendments, cancellation state, documents, tasks, and readiness projections.

One Booking may contain airfare, hotel, transfer, tour, insurance, visa assistance, WMIT fees, and other items from multiple Suppliers. Each Booking Item independently retains service/component, supplier (or WMIT), expected and confirmed cost, client amount, currency, dates/quantity, fulfillment state, departure membership where applicable, and supplier-side relationships.

Client confirmation, payment, supplier fulfillment, supplier payment, and readiness remain independent. A Booking record may exist before final payment when the operational workflow requires it.

## 15. Supplier Booking model — CONFIRMED

A Supplier Booking records WMIT’s side of a request, hold, reservation, purchase, or supplier confirmation. It links to one Supplier and one or more Booking Items, retains supplier reference, requested/held/confirmed dates, terms, evidence documents, cost snapshots, deposit/final deadlines, cancellation terms, failure/amendment history, and fulfillment state.

Supplier Booking is not the Booking and not a Supplier Payable. Supplier reservation may occur before client payment, but supplier payment is blocked until the client-money policy is satisfied and the payment is explicitly authorized/recorded.

## 16. Departure model — CONFIRMED / DERIVED item-first association

A Departure represents a shared supplier/group departure such as a wholesaler departure. It may retain supplier departure reference, supplier, destination, dates, capacity, source documents, group-level deadlines, confirmation summary, and readiness exceptions.

Separate WMIT Bookings remain separate. The primary membership is at Booking Item level where only some items participate; a Booking-level summary/shortcut may be derived when all relevant items share the same Departure. This item-first rule is **DERIVED from the mixed-supplier and shared-departure cases**. Each Booking keeps its own invoice, payments, supplier payables/payments, margin, cancellation, and refund state.

Management views may show Departure X with bookings, travelers, confirmation status, missing documents, deadlines, and readiness, but must not calculate a consolidated client or supplier financial account.

## 17. People and role model — CONFIRMED / DERIVED identity boundary

Person identity is separate from Client relationship and from trip roles. Inquiry and Booking participant relationships explicitly identify one or more roles: coordinator, payer/financier, traveler, communication participant, emergency contact, or other approved role. A person may have several roles in one record and roles can differ across records.

Do not infer coordinator = client, payer = traveler, or communicating person = traveler. Do not introduce a separate Travel Party entity for MVP; relationship records are sufficient unless future discovery proves otherwise. Sensitive traveler details are staged by service/destination and are not universally required at Inquiry stage.

## 18. Payment, verification, allocation, and obligations — CONFIRMED / PROVISIONAL implementation detail

### Client payments — CONFIRMED

Client payments may be deposits, installments, full payments, or other partial payments. Each receipt preserves amount received/reported, currency, method, date, reference, evidence document, verification state, exchange-rate snapshot where relevant, actor, and history. Payment proof/evidence is required for verification.

### Verification — CONFIRMED / DERIVED

Payment entry, evidence received, verification, allocation, reversal, and refund are separate events. An unverified payment must not silently make the final management balance paid. A provisional operational view may show it separately as reported/pending verification.

### Allocation — CONFIRMED

Payments may initially be unallocated. A client may specify allocation, including one receipt split across Booking A and Booking B. The allocation record identifies payment, target client obligation/Booking/approved installment target, allocated amount and currency, exchange-rate basis, actor, timestamp, and reversal/reallocation history. Exact rules for allocation before an invoice exists are **PROVISIONAL** and must be implemented through an approved operational obligation target rather than by overloading Payment with one invoice ID.

### Client balance — DERIVED

`Client outstanding balance = client amount due − verified allocated client payments − approved credits/refunds.`

Reported, unverified, or unallocated money remains visible but does not automatically reduce every obligation.

### Supplier payables — CONFIRMED

Each Booking has independent supplier-side obligations. A Supplier Payable is linked to Supplier Booking and/or Booking Item and retains supplier, expected/confirmed cost, deposit component, final component, other deadline components, terms, non-refundable indicators, payment evidence, credits/refunds, and remaining operational balance. Shared Departures do not consolidate payables.

### Supplier payments — CONFIRMED

Supplier payments are separate transactions linked to a Supplier Payable/Supplier Booking, with proof/evidence and verification state. They never reduce client balances. Supplier payment cannot occur merely because a supplier reservation exists; client money receipt and the configured approval policy must be satisfied.

## 19. Pricing and operational margin — CONFIRMED rules / UNRESOLVED component policy

### Pricing rules — CONFIRMED

Pricing rules are configurable, effective-dated, and source-visible:

1. ready-made Supplier Packages with supplier-provided selling prices usually use that selling price;
2. specific/custom quotations usually use a fixed 30% markup;
3. conversion fee uses BDO forex selling rate + 1.0;
4. credit card/PayPal fee is 5%;
5. visa assistance fee varies by case;
6. other fees may include service, visa assistance, ticketing, insurance, bank, and conversion fees.

### Price preservation — CONFIRMED

The system preserves supplier cost, calculated markup, calculated selling price, actual quoted price, discount, override flag, actor, timestamp, and reason where appropriate. A staff override never silently replaces the calculated value.

### Margin — CONFIRMED / PROVISIONAL boundary

`Expected Operational Margin = expected client selling value − expected direct supplier/service cost.`

`Updated Operational Margin = current client selling value − current/confirmed direct cost − approved direct adjustments.`

Fees, taxes, discounts, refunds, cancellation penalties, supplier credits, and FX effects remain separate identifiable components. The result is an operational margin projection, not statutory/accounting profit. Exact inclusion of each fee or tax in the margin projection is **UNRESOLVED** and must not be silently standardized by implementation.

## 20. Amendments, cancellations, refunds, and credits — CONFIRMED boundary / UNRESOLVED exact policy

Material amendments normally update the existing Booking while appending an amendment record/history. The history includes reason, actor, time, old/new values, affected Booking Items/Supplier Bookings, cost/price impact, client communication, client re-acceptance where required, and approval.

Traveler-level cancellation is supported. The record may include cancellation reason, requested by, supplier terms/evidence, non-refundable amount, replacement-traveler process, refund/credit/penalty result, and linked payments/payables.

Supplier failure or client cancellation must not delete or rewrite original payments or old supplier facts. Separate records are needed for supplier penalty, supplier refund/credit, client refund/credit, approval, amount retained/returned, and margin impact. Refunds and financial adjustments require explicit human approval. Universal refund percentages, deadlines, or accounting treatment are not assumed.

## 21. Documents and voucher workflow — CONFIRMED / DERIVED

Documents may arrive from email, Messenger, WhatsApp, Viber, Drive, supplier portals, client uploads, and other sources. The Document record retains source/channel, type, related records, owner, received/generated date, storage reference, sensitivity, classification/extraction status, review status, current/superseded state, and provenance.

Sensitive classes include supplier cost, payment evidence, passports/identity documents, internal notes, client financial information, and restricted supplier documents. Links may be many-to-many; the file is not the authoritative structured Booking, Payment, or Supplier Booking.

Voucher workflow:

`confirmed/approved Booking data → draft/update WMIT voucher Document → staff review → client send → supersede/update after amendments.`

No separate core Voucher entity is required. A voucher may be received from a Supplier or generated by WMIT, but its readiness and send state are tracked separately from Booking confirmation.

## 22. Tasks, follow-ups, and communications — CONFIRMED / PROVISIONAL lightweight implementation boundary

Tasks cover inquiry follow-up, client follow-up, supplier follow-up, availability check, quotation follow-up, supplier reservation/deposit/final payment deadlines, client installments/final payment, voucher/confirmation/document review, pre-departure, PDOS, final reminders, and cancellation/refund review.

Task states are `pending`, `due soon`, `due`, `awaiting client`, `awaiting supplier`, `awaiting internal action`, `requires attention`, `completed`, and `cancelled`. “Overdue” is a derived timing signal only if used; it must not replace the business state. Alerts are generated idempotently at two days before, one day before, and same-day urgent timing where appropriate.

Communication Activity is lightweight: channel, date/time, direction, participants, staff actor, source/thread reference, summary, related records, and attachments/documents. Supported source labels include Facebook Page Messenger, Facebook comments, personal Messenger/chat, WhatsApp, Viber, email, phone, SMS, walk-in, referral, existing client, website, travel fair/event, and other. B2B is not an inquiry source classification.

Full channel ingestion is deferred.

## 23. Permissions and visibility — CONFIRMED boundary / UNRESOLVED policy details

Production must have separate authentication and authorization boundaries. Caller-supplied actor identity is not a security mechanism. The local prototype is not production-secure.

| Data/action | Admin/Owner | Manager | Staff | Intern |
|---|---|---|---|---|
| Clients, inquiries, ordinary bookings | Full | Full | Operational | Assigned/limited |
| Supplier packages/tariffs | Full | Full | Operational | Approved/read-only as assigned |
| Supplier cost, markup, margin | Full | Full | Operational only as policy permits | No default |
| Client payment entry/evidence | Full | Review/verify | Enter and view only as policy permits | No default |
| Supplier payables/payments | Full | Review/approve | Prepare/record only as authorized | No default |
| Refunds, adjustments, supplier purchase, reserve-before-payment | Approve/execute | Approve/review | Request/prepare | No default |
| Passports/identity/sensitive client documents | Full | Restricted/full as needed | Restricted operational need | No default |
| Client-facing quotations/vouchers | Full | Approve/review | Draft/send under policy | Draft/support only |
| Audit history | Full | Full | Relevant history | Assigned/approved subset |

Staff may need supplier cost and markup for ordinary quotation work; exact staff visibility policy is **UNRESOLVED**. Production also needs least privilege, approval enforcement, sensitive-file access control, audit retention, and protected service entry points.

## 24. Audit/action logging — CONFIRMED requirement / DERIVED production controls

Every meaningful action records timestamp, actor identity from a trusted authenticated context, agent/source, action, record type/ID, old value where applicable, new value where applicable, result, reason/evidence, approval reference where applicable, and error details where applicable. Logs must avoid unnecessary personal data and secrets and must be append-only/durable in production.

Audited actions include creation, edits, status changes, price overrides, discounts, availability claims, payment entry/verification/allocation, supplier reservation/purchase/payment, document classification/linking/supersession, voucher generation/sending, amendments, cancellations, refunds, approvals, permission-sensitive reads, and failed attempts.

## 25. Automation and AI boundaries — CONFIRMED

### Safe automation — CONFIRMED

Automate tedious lookup within a selected supplier/tariff scope, arithmetic, structured extraction, matching suggestions, reminder generation, document organization, and draft document/quotation generation.

### Human authority — CONFIRMED

Human approval is required for final commercial choice, ambiguous tariff interpretation, final client-facing price, uncertain availability confirmation, payment verification, supplier payments, refunds, sensitive communications, external bookings/purchases, and low-confidence extraction. AI must never invent rates, assume availability, change prices, verify payments, pay suppliers, issue refunds, choose the “best” supplier without staff approval, or silently commit extracted data.

## 26. Canonical six-case validation evidence — CONFIRMED validation basis

The six real patterns validate the baseline:

1. **Messenger changed request:** original cheap August local inquiry remains; October wholesaler package is a new option with availability evidence and selected Booking. Confirms Inquiry history, alternatives, package availability, and amendment/lineage.
2. **Custom private trip:** DMC tariff plus airfare produces a quotation before availability. Confirms tariff ≠ quotation and quotation ≠ availability.
3. **Group trip:** coordinator, payer, and travelers are separate roles. Confirms Person/role separation.
4. **Mixed suppliers:** one Booking contains airfare, hotel, transfers, tours, insurance, and WMIT fees from multiple sources. Confirms item-level supplier/cost/fulfillment relationships.
5. **Supplier reservation before client payment plus installments:** reservation and payable can exist before verified client money; installments, proof, verification, allocation, supplier payment, and client commitment remain independent.
6. **Supplier failure/cancellation:** alternative supplier/product, cancellation terms, traveler cancellation, non-refundable amounts, refunds/credits, and approvals are separate from the original Booking/payment history.

## 27. Remaining unresolved decisions

These are genuinely not answered by the owner prompt and must be resolved before production implementation of the affected policy:

1. exact approval threshold/role policy for reserve-before-client-payment;
2. exact universal versus product/supplier-specific rule for “Confirmed under WMIT policy”;
3. exact treatment of fees, taxes, FX, refunds, penalties, supplier credits, and pass-through charges in updated margin;
4. whether ordinary Staff may see all supplier costs/markup or only assigned work;
5. whether Staff may verify payments or only enter evidence;
6. exact duration/retention policy for audit history and sensitive documents;
7. exact staged traveler-data requirements by service/destination;
8. exact refund/credit approval thresholds and client-price amendment policy after confirmation;
9. exact operational target rule for payments received before a client invoice exists;
10. supplier-specific approval and deadline policy templates.

Unresolved items must remain configuration/policy decisions, not hard-coded assumptions.

## 28. Explicit out-of-scope items

- Google Workspace access, setup, migration, or production IDs during Phase 2A.
- Attendance, payroll, HR, intern attendance, or the attendance reference implementation.
- Full accounting, tax compliance, revenue recognition, statutory financial statements, and payroll.
- Live availability or price retrieval without an authorized verified source.
- Automatic external booking, supplier purchase, supplier payment, refund, or sensitive message sending.
- Full channel ingestion for Messenger, WhatsApp, Viber, email, phone, or SMS.
- Global cross-supplier tariff search in MVP; Phase 1 search is supplier/tariff scoped.
- A separate Trip, Travel Party, or Voucher aggregate unless future discovery proves necessity.
- Production authentication/authorization implementation in this architecture-only task, although the security boundary is specified.
- Data migration, schema migration, source-code changes, test changes, UI changes, or configuration changes.

## 29. Future implementation constraints

Any later build must start from this baseline, preserve immutable IDs and audit history, use controlled service functions rather than arbitrary cell writes, keep source evidence linked, validate relationships and state dimensions, support dry-run/draft mode for high-impact operations, require human review before client-facing or financial commitment, use synthetic data before real data, and keep each module’s acceptance tests tied to the six cases plus edge cases.
