# WMIT Operations — Architecture Validation & Contradiction Review

> **HISTORICAL / SUPERSEDED by [baseline-v1.md](baseline-v1.md).** This report records pre-baseline contradictions and remains evidence for why the owner-confirmed rules changed the architecture.

> **NON-EXECUTABLE:** [BASELINE-HANDOFF.md](BASELINE-HANDOFF.md) and [implementation-plan-v1.2.md](implementation-plan-v1.2.md) control current rules and sequencing.

Status: validation report only. No implementation, schema, test, configuration, UI, integration, or existing-document changes were made.

## Scope and review basis

This review compares the ten documents under `docs/business-architecture/` with one another and with the current local prototype documentation and relevant source code.

The business-architecture documents are treated as proposals requiring validation. The prototype is treated as implementation evidence only.

Severity meanings:

- **BLOCKER** — the architecture cannot safely support that area until the issue is resolved.
- **IMPORTANT** — resolve before implementing the affected area; a temporary synthetic assumption is possible.
- **MINOR** — can be clarified during implementation without changing the main domain direction.
- **NO ISSUE** — the documents are apparently consistent on this point.

## 1. Executive finding

The validation pack has a sound central idea: WMIT Operations should preserve the difference between an inquiry, researched options, availability evidence, a WMIT quotation, a client booking, supplier fulfillment, client money, supplier obligations, documents, and operational tasks.

It is not yet internally precise enough for production implementation. The most important contradictions are concentrated in five areas:

1. The recommended flow places verified client payment before Booking creation, while the scenarios and open decisions allow supplier reservation and possibly a Booking commitment before client payment.
2. Payment verification, payment allocation, client balance, and invoice status are named separately but their record-level and booking-level responsibilities are not fully defined.
3. The architecture permits multiple Bookings from one Inquiry in principle, but the cardinality and grouping rule remain an open decision and are not expressed consistently in the domain map.
4. Refunds and cancellation costs are described, but there is no explicit relationship map or minimum transaction boundary for them.
5. Expected/updated margin is included in the MVP even though the treatment of fees, taxes, refunds, cancellation costs, supplier credits, and foreign exchange remains open.

Conclusion: the pack is suitable for a controlled synthetic scenario walkthrough, but not for implementation of financial, booking-commitment, cancellation, or departure-grouping behavior.

## 2. Documents reviewed

Reviewed all ten business-architecture documents:

- `glossary.md`
- `canonical-scenarios.md`
- `state-model.md`
- `financial-model.md`
- `permissions-matrix.md`
- `domain-map.md`
- `prototype-gap-analysis.md`
- `mvp-boundary.md`
- `open-decisions.md`
- `recommended-architecture.md`

Prototype evidence reviewed included `docs/architecture.md`, `docs/operational-data-model.md`, `docs/operations-mvp.md`, `docs/commercial-workflow.md`, `docs/database-schema.md`, `docs/invoice-payment-workflow.md`, `docs/supplier-booking-workflow.md`, `docs/phase-1-audit.md`, `src/models/schema.js`, `src/core/lifecycle.js`, `src/application/operations-mvp.js`, `app/server.js`, and `app/public/index.html`.

## 3. Consistency summary

| Area tested | Result | Classification | Finding |
|---|---|---|---|
| Supplier Package versus WMIT Quotation | Consistent | **NO ISSUE** | The glossary, scenarios, domain map, and recommendation keep them separate. |
| Supplier umbrella terminology | Consistent | **NO ISSUE** | Wholesalers, DMCs, airfare sources, hotels, insurance providers, and other providers remain Supplier records with capabilities/types. |
| Inquiry versus Client | Consistent | **NO ISSUE** | An Inquiry is an opportunity/request; a Client is an ongoing relationship. |
| Client versus Traveler/coordinator/payer | Consistent | **NO ISSUE** | The group scenario explicitly prevents role assumptions. |
| Custom quotation before availability | Consistent | **NO ISSUE** | The documents explicitly state that a tariff-based quotation does not prove availability. |
| Multiple options per Inquiry | Consistent | **NO ISSUE** | The domain map and scenarios support alternatives and rejected options. Persistence remains open. |
| Multiple Bookings per Inquiry | Partially consistent | **BLOCKER** | The recommended default says yes, but the relationship/cardinality and grouping behavior are not finalized. |
| Independent state dimensions | Directionally consistent | **BLOCKER** | State dimensions exist, but granularity and transition evidence are not sufficiently defined for financial/booking implementation. |
| Client payment versus verification | Incomplete | **BLOCKER** | Payment-level verification and booking/invoice-level paid state are not cleanly separated. |
| Client payment versus allocation | Incomplete | **BLOCKER** | Unallocated money is supported conceptually, but allocation timing and granularity remain open. |
| Supplier payable deposits/final payments | Partially consistent | **IMPORTANT** | The concept exists, but payable components and payment application need a minimum operational rule. |
| Refunds/cancellation costs | Incomplete | **BLOCKER** | The financial model describes outcomes but the domain map lacks a concrete refund/cancellation transaction relationship. |
| Expected/updated profit | Partially consistent | **IMPORTANT** | The formulas are clear at a high level, but component inclusion remains unresolved while MVP margin is proposed. |
| Multiple suppliers per Booking | Consistent conceptually | **NO ISSUE** | Booking Items and Supplier Bookings support the required direction. Amendment/split rules remain open. |
| Shared Departure grouping | Partially consistent | **IMPORTANT** | Independent grouping is clear, but Booking-level versus Booking Item-level ownership is open. |
| Permissions versus sensitive finance/documents | Mostly consistent | **IMPORTANT** | Visibility boundaries are directionally right, but payment verification and cost/markup access are unresolved. |
| MVP versus explicit deferrals | Mostly consistent | **IMPORTANT** | The MVP includes margin, availability, and voucher behavior that depend on unresolved definitions. |
| Attendance scope | Consistent | **NO ISSUE** | The validation pack defers attendance, matching the reset instruction. |

## 4. Terminology review

### 4.1 Inquiry, Client, Person, Traveler, and Travel Party

**Classification: IMPORTANT.**

The glossary and scenarios use Person as the identity and attach coordinator, payer, traveler, and communication roles to that identity. The prototype gap analysis correctly says that the existing Contact concept should be refactored toward Person and role relationships.

The remaining ambiguity is whether Travel Party is only a conceptual grouping or a persistent relationship object. The recommended architecture lists `Person/Traveler relationships` as a core record but does not explicitly say how Inquiry participants and Booking participants are represented. This does not invalidate the business model, but it will cause inconsistent implementation if different developers treat Contact, Person, Traveler, and Travel Party as interchangeable.

Required validation: approve the minimum participant-role relationship used on both Inquiry and Booking. Do not introduce a separate Travel Party entity unless the walkthroughs show that a reusable group identity is needed.

### 4.2 Commercial Option and Availability

**Classification: IMPORTANT.**

The terminology is consistent, but persistence is not. `Commercial Option` is called a supporting workflow record, a core commercial research domain, and a record that should persist when presented or materially rejected. `Availability` is described both as evidence and as a state.

This is a valid staged approach, but the implementation boundary must be explicit: at minimum, a presented option and the availability evidence supporting a client-facing claim need durable identities. Casual searches may remain notes or documents. Without that boundary, the MVP could either lose important alternatives or create excessive data-entry work.

### 4.3 Quotation, Booking, Supplier Booking, Invoice, Payment, and Departure

**Classification: NO ISSUE, subject to the blockers below.**

The glossary, scenarios, state model, and domain map consistently say these concepts are related but not interchangeable. The prototype does not follow this model fully, but that is correctly identified as a gap rather than silently accepted as business truth.

### 4.4 Communication and Document

**Classification: NO ISSUE.**

The documents correctly treat Communication as a lightweight activity/reference and Document as evidence or output rather than the authoritative structured record. The decision to defer full channel ingestion is consistent with the MVP boundary.

## 5. Canonical scenario representability

| Scenario | Can the proposed model represent it? | Classification | Contradiction or limitation |
|---|---|---|---|
| A — wholesaler package | Yes conceptually | **IMPORTANT** | The written sequence says client confirms, pays, then Booking; the wider architecture also allows reservation/commitment before payment. The ordering must be policy-dependent rather than canonical. |
| B — custom quotation | Yes | **NO ISSUE** | Tariff source, separate airfare research, WMIT pricing, and later availability are represented. |
| C — changed request | Yes | **NO ISSUE** | Original Inquiry, alternative Option, availability evidence, decision, and actual Booking are connected without overwriting the original request. |
| D — group inquiry | Yes | **NO ISSUE** | Coordinator, payer, travelers, and other participants are explicitly separate roles. |
| E — multiple suppliers | Yes conceptually | **IMPORTANT** | The many-to-many/over-time relationship is proposed, but amendments and split fulfillment do not yet have a minimum record rule. |
| F — shared departure | Yes conceptually | **IMPORTANT** | The grouping works, but the open Booking-versus-Booking Item relationship affects what a shared departure means for mixed arrangements. |
| G — supplier reservation before client payment | Partially | **BLOCKER** | Scenario G supports it, but the recommended flow and Booking state wording make payment appear to precede Booking creation or confirmation. |
| H — installments | Yes conceptually | **BLOCKER** | The scenario assumes allocation to invoice/booking obligations, while the open decision leaves payment-before-invoice and split allocation unresolved. |
| I — supplier unavailable | Yes | **IMPORTANT** | Alternative options are supported, but the required persistence boundary for unavailable/rejected options is still open. |
| J — cancellation/refund | Partially | **BLOCKER** | The required facts are listed, but Refund and cancellation-cost relationships are not defined in the domain map or minimum financial model. |

## 6. State-model contradiction review

### 6.1 What is working

The state model correctly rejects a giant Booking status and explicitly tests these non-equivalences:

- Client Paid ≠ Booking Confirmed.
- Booking Confirmed ≠ Supplier Confirmed.
- Supplier Confirmed ≠ Supplier Paid.
- Invoice Issued ≠ Money Received.
- Money Received ≠ Profit.
- Availability Not Checked ≠ Unavailable.
- Quotation Sent ≠ Availability Confirmed.

These are **NO ISSUE** findings and are the strongest part of the validation pack.

### 6.2 Payment state granularity

**Classification: BLOCKER.**

`Client payment state` contains record-level concepts such as Evidence pending, Rejected, and Reversed, and aggregate concepts such as Partially paid, Fully paid, and Unallocated. `Payment verification state` separately contains Entered, Pending verification, Verified, Rejected, Reversed, and Refunded.

These are not the same level of state:

- a single payment has a verification state;
- an invoice or booking obligation has an allocation/balance state;
- a booking may have a policy state influenced by payment but not determined by it.

The documents need to state this explicitly. Otherwise an unverified payment may incorrectly make an invoice partially paid, or an allocated payment may be treated as verified merely because it has an allocation.

### 6.3 Booking commitment and payment order

**Classification: BLOCKER.**

The state model says `Confirmed under WMIT policy` depends on client commitment plus the required payment/deposit condition, while the open decision allows different policies and exceptions. The recommended flow says:

```text
record Client Decision
→ collect/verify Client Payment as required
→ create/update actual Booking
```

Scenario G explicitly permits a supplier reservation before client payment. The model therefore needs to distinguish at least:

- client-selected/committed arrangement;
- WMIT Booking record created;
- WMIT policy-confirmed client commitment;
- supplier reservation/hold;
- supplier confirmation.

Until this is resolved, “Booking” can mean either an operational record created early or a confirmed client commitment created later.

### 6.4 Invoice status and payment verification

**Classification: IMPORTANT.**

`Due soon` and `Due` are useful operational alert states, but they are not necessarily invoice lifecycle states. They may be projections based on due date and current balance. Similarly, invoice `Partially paid` and `Paid` should be derived from verified allocated amounts rather than raw payment-entry rows unless WMIT deliberately chooses a provisional view.

The state model should identify which values are stored workflow states and which are dashboard projections.

### 6.5 Supplier payable state

**Classification: IMPORTANT.**

The state model includes Deposit due, Final balance due, Partially payable/partially paid, and Paid. This is directionally correct, but a single state is insufficient to show multiple supplier obligations with different dates or a deposit that is non-refundable while a final balance remains payable.

The architecture does not need a full accounts-payable system, but it does need a minimum operational rule: whether each Supplier Booking has one payable summary with deposit/final components, or whether separate payable components are persistent from the first MVP.

## 7. Financial-model contradiction review

### 7.1 Deposit and installment support

**Classification: NO ISSUE at conceptual level.**

The PHP 100,000 example correctly shows a PHP 30,000 deposit, PHP 70,000 outstanding, separate supplier payable, and expected profit independent of cash received. The installment scenario also correctly preserves the original payment records and does not equate full client payment with supplier confirmation or supplier payment.

### 7.2 Unallocated money versus client money held

**Classification: IMPORTANT.**

The financial model distinguishes:

- Unallocated Client Money: money not applied to a specific client obligation.
- Client Money Held: money received for an active trip or supplier obligation that has not yet been resolved operationally.

That distinction is useful, but the relationship is not explicit. Unallocated money can also be money held, while allocated money can remain held before supplier payment. The model should state whether Client Money Held is a derived operational view of verified receipts net of refunds and supplier payments, or a manually maintained stewardship field. It should not be treated as a second balance that staff can edit independently.

### 7.3 Supplier deposits and final payments

**Classification: IMPORTANT.**

Supplier obligations mention deposits, final balances, due dates, and non-refundable terms, but the examples do not walk through a supplier deposit followed by a final payment. The architecture needs to show:

- expected supplier cost;
- deposit amount and due date;
- deposit paid and verification state;
- remaining supplier balance;
- final payment amount and due date;
- supplier refund/credit or cancellation cost.

This can remain a small operational payable schedule; it does not require full accounting.

### 7.4 Refunds and cancellation costs

**Classification: BLOCKER for cancellation/refund implementation.**

The financial model correctly says not to delete the original payment and acknowledges supplier penalties, credits, refunds, and approvals. However:

- `Refund` has no explicit relationship in the domain map;
- cancellation costs are mentioned as direct adjustments but not as a defined transaction or cost component;
- supplier refund/credit and client refund are not clearly separate records;
- the PHP 10,000 example calls the result an operational retained-value view but does not define how the client obligation, supplier payable, and profit projection are updated together.

The architecture can defer exact accounting treatment, but it cannot safely implement cancellation/refund workflows until the operational records and links are defined.

### 7.5 Expected and updated profit

**Classification: IMPORTANT.**

The formulas are intentionally operational and avoid accounting claims. That is appropriate. The unresolved treatment of WMIT fees, pass-through charges, taxes, discounts, FX conversion, card/bank charges, supplier rebates, cancellation costs, and refunds nevertheless affects whether two staff members will calculate the same “expected” or “updated” margin.

The MVP should either:

- limit the first margin view to clearly labeled selling value less direct supplier cost; or
- defer the margin view until the owner approves the component policy.

Calling the MVP result “basic expected margin” while the documents call the definition open is acceptable only if the MVP explicitly labels it provisional.

### 7.6 Currency and exchange-rate evidence

**Classification: MINOR.**

The prototype supports a payment conversion snapshot, while the business documents state that WMIT uses manual BDO rates and does not want automatic lookup. The validation pack should distinguish quoted currency, payment currency, conversion source/date/rate, and management display currency. This is not a new accounting system requirement, but it is needed before mixed-currency examples are implemented.

## 8. Relationship and cardinality review

### 8.1 Inquiry to options, quotations, and bookings

**Classification: BLOCKER.**

The domain map explicitly supports zero-to-many Commercial Options and zero-to-many WMIT Quotations. The open decisions recommend that one Inquiry may produce multiple independent Bookings, but the domain map does not state that cardinality as explicitly as it does for options and quotations.

This matters for:

- a family splitting into separate bookings;
- an inquiry that produces an accepted October package and a separately booked airfare-only service;
- alternatives that are both accepted at different times;
- reporting conversion without overwriting the original Inquiry.

The owner must approve whether multiple Bookings are allowed, and if so whether they are simply siblings under Inquiry or require a later grouping concept.

### 8.2 Booking Items and Supplier Bookings

**Classification: IMPORTANT.**

The many-to-many relationship is a good fit for multiple suppliers and a supplier confirmation covering several items. The phrase “one or more Supplier Bookings over time” also anticipates amendments and alternatives.

What is missing is lineage: when an item moves from Supplier A to Supplier B, does the original Supplier Booking remain cancelled and linked, or is the item replaced, split, or amended? This can be handled later, but the synthetic scenarios must choose one representation before implementation.

### 8.3 Booking and Departure

**Classification: IMPORTANT.**

The domain map and open decisions correctly identify Booking-level versus Booking Item-level association as unresolved. The proposed default—item-level association with a derived Booking view—is safer for mixed-supplier arrangements, but it should not be treated as settled until Scenario F and a mixed-departure case are walked through.

### 8.4 Refund relationship missing from domain map

**Classification: BLOCKER for the affected area.**

Refund appears in the glossary, financial model, state model, permissions matrix, and recommended architecture, but the domain map does not show Refund linked to Client Payment, Payment Allocation, Client Invoice, Booking, Supplier Payable, or Supplier Payment/credit evidence. The map should not imply that a refund is merely a status on one of those records.

### 8.5 Document and Task links

**Classification: MINOR.**

The proposed domain map is broad enough to relate Documents and Tasks to relevant records, and it correctly avoids making every file authoritative. The precise allowed link types can be finalized during implementation if the required minimum links are preserved for payment evidence, supplier confirmations, vouchers, quotations, invoices, and sensitive traveler documents.

## 9. Permissions consistency review

### 9.1 Payment entry versus verification

**Classification: IMPORTANT.**

The matrix says Staff may enter and view necessary client-payment records, while Managers verify/review. The open decisions explicitly leave open whether Staff may verify payments. This is correctly recognized as unresolved, but the matrix’s “Client payments” row combines entry, visibility, and verification in one domain row.

The implementation cannot safely use a single permission named “payments.” It needs at least separate conceptual capabilities for recording evidence, verifying a receipt, allocating money, approving a refund, and viewing sensitive evidence.

### 9.2 Supplier cost, markup, and profit visibility

**Classification: IMPORTANT.**

The matrix gives Staff supplier-cost and markup access “where needed” and profit restricted/summary only, while the quotation model requires staff to calculate and edit pricing. The boundary is operationally plausible but not precise enough for access control or client-output filtering.

Owner decision needed: whether all ordinary Staff may see costs and markup for quotations/bookings they work on, and whether they may see booking-level expected margin.

### 9.3 Manager versus Admin/Owner

**Classification: MINOR.**

The matrix distinguishes Full from Full/approve, but the open decisions still ask whether Managers and Admin/Owner have identical access and who may approve high-impact actions. This does not undermine the domain model, but implementation must not treat the matrix as a final approval policy.

### 9.4 Sensitive documents and audit history

**Classification: NO ISSUE.**

The permissions matrix is consistent with the document model in restricting passports, payment evidence, internal notes, refunds, and unrestricted audit history for Interns. It also correctly avoids treating “Full” as unrestricted deletion.

## 10. MVP-boundary review

### 10.1 Follow-ups, deadlines, and payment visibility

**Classification: NO ISSUE.**

The first two MVP slices target the stated pain points and do not require Google integrations or automatic communications. Neutral reminder states are consistent with the owner’s preference.

### 10.2 MVP expected margin

**Classification: IMPORTANT.**

The MVP includes “basic expected margin” before the owner has decided which fees, taxes, refunds, supplier credits, and cancellation costs belong in that measure. This is not necessarily wrong, but the boundary must call it a provisional operational estimate and must not present it as final profit.

### 10.3 Voucher generation

**Classification: IMPORTANT.**

The MVP proposes a generated voucher draft from “confirmed Booking data.” The state model correctly says Booking confirmation does not imply Supplier confirmation. A voucher may be a client-facing output that depends on confirmed service details, supplier confirmation, or both. The trigger and readiness evidence must be defined before voucher generation is implemented.

### 10.4 Availability and tariff/package search

**Classification: MINOR.**

The MVP correctly excludes automatic live availability claims and live multi-site search. It still lists tariff/package search as a priority, but the actual smallest slice should mean recording/searching approved source data and availability evidence, not guaranteeing live availability.

### 10.5 Deferred features

**Classification: NO ISSUE.**

Full accounting, payroll, HR, AI agents, OCR everywhere, automatic supplier booking, automated communication, Google Workspace, production authentication, and attendance are consistently deferred.

## 11. Concepts that appear necessary but are missing or under-specified

These are not requests to implement them now; they are gaps that should be resolved in the architecture walkthrough.

| Concept or boundary | Classification | Why it matters |
|---|---|---|
| Explicit participant-role relationship | **IMPORTANT** | Both Inquiry and Booking need coordinator, payer, traveler, and other participant roles without inferring them. |
| Booking/Inquiry cardinality rule | **BLOCKER** | Determines whether one Inquiry can create multiple independent Bookings and how reporting works. |
| Payment allocation granularity | **BLOCKER** | Determines whether a payment applies to an invoice, Booking, deposit, installment, or several obligations. |
| Payable component/schedule | **IMPORTANT** | Needed to show supplier deposit, final payment, due dates, non-refundable terms, and remaining balance. |
| Refund/cancellation transaction boundary | **BLOCKER** | Needed to preserve original payments and separately record client refunds, supplier credits, penalties, and approvals. |
| Amendment/alternative lineage | **IMPORTANT** | Needed when a preferred supplier fails or a confirmed service changes. |
| Availability evidence minimum | **IMPORTANT** | Needed to prove what was checked, when, for what quantity/date, and with what expiry. |
| Approval/commitment evidence | **IMPORTANT** | Needed for reserve-before-payment exceptions, pricing exceptions, supplier purchases, and refunds. |
| Currency conversion snapshot boundary | **MINOR** | Needed for reproducible prices and payment balances where currencies differ. |

## 12. Concepts that can remain simpler or be deferred

The pack is generally practical, but the following should not become first-release mandatory entities or automations:

- a separate Trip entity;
- a separate Travel Party entity unless reusable group behavior is proven;
- full message ingestion from every channel;
- durable records for every casual supplier search;
- a separate Voucher aggregate if Document plus readiness/task behavior is sufficient;
- advanced profit recognition or accounting ledger behavior;
- automatic live availability retrieval;
- separate systems for wholesalers, DMCs, airlines, hotels, and other supplier types;
- automatic supplier/client communication;
- AI-based availability, pricing, or financial decisions.

Classification: **NO ISSUE**. The documents already mostly defer these items; this is a guard against scope expansion during implementation.

## 13. Open decisions being treated as partly settled

Several documents correctly label decisions as open, but other documents use a recommended default as if it were already a rule.

| Decision | Where it is treated as settled | Why this is a problem | Classification |
|---|---|---|---|
| What makes a Booking confirmed | Scenario A/H and recommended flow use a particular sequence | The owner has not selected one universal confirmation policy. | **BLOCKER** |
| Reserve before client payment | Scenario G permits it; state/recommended flow imply payment-first in places | The exception needs explicit risk and approval handling. | **BLOCKER** |
| One Inquiry to multiple Bookings | Domain/recommended architecture support it; open-decisions says it is still for approval | Cardinality affects the central relationship model. | **BLOCKER** |
| Invoice/payment relationship | Scenario H assumes allocation; glossary and open decisions retain alternatives | Payment-before-invoice and split allocation affect balances and refunds. | **BLOCKER** |
| Profit scope | MVP includes expected margin; financial model leaves components open | Staff could implement inconsistent “profit” calculations. | **IMPORTANT** |
| Departure association | Scenario F permits Booking or Item; recommended default favors Item | The default is sensible but not owner-approved. | **IMPORTANT** |
| Commercial Option persistence | Scenarios preserve alternatives; glossary says persistence is unknown | Rejected/unavailable option history may be lost or over-recorded. | **IMPORTANT** |
| Staff payment verification and cost visibility | Permissions give operational access but list both as owner decisions | Sensitive financial permissions cannot be inferred from “Operational.” | **IMPORTANT** |

## 14. Prototype evidence and its significance

The prototype confirms that the current implementation is a useful local vertical slice, but it does not validate the proposed business architecture.

### Current concepts that exist

The schema and services contain Client, Contact, Traveler, Lead, Quotation, Quotation Item, Booking, Booking Traveler, Booking Item, Departure, Supplier, Supplier Tariff, Supplier Booking, Supplier Booking Item, Invoice, Invoice Item, Invoice Booking, Payment, Document, Document Link, and Task.

The prototype also has useful foundations:

- separate Booking Items and Supplier Booking Items;
- multiple Supplier Bookings across Booking Items;
- separate client and supplier payment directions;
- quotation client-facing filtering;
- document-intelligence review before authoritative writes;
- service-level validation and audit hooks;
- local in-memory testing and disabled external adapters.

### Current concepts that are absent

The executable schema has no first-class Inquiry, Commercial Option, Supplier Package, Availability Evidence, Person, Payment Allocation, Supplier Payable, Refund, Communication, Amendment, or cancellation-cost record.

### Current workflow conflicts

- `app/server.js` exposes explicit Lead → Quotation → Booking → Supplier Booking → Invoice → Payment actions.
- `app/public/index.html` presents Sales as a Lead/quotation flow and has no Inquiry, Option, Task, Document, or Departure operational views.
- `Quotation.lead_id` is required, reinforcing Lead as the parent entry point.
- `createBookingFromQuotation` copies Quotation data into a Booking; it does not model selection from multiple Commercial Options or an alternative product lineage.
- `Departure` is an optional single `Booking.departure_id`, not a validated shared-departure aggregation model.
- the current lifecycle uses one status per Lead, Quotation, Booking, Invoice, Supplier Booking, and Payment rather than independent business dimensions.

### Current payment behavior that conflicts with the validation pack

`recordPaymentFromInvoice` creates a payment with a default of Pending Verification but recalculates invoice paid totals and balance from all matching payment rows. `recordSupplierPayment` similarly reduces the recorded Supplier Booking balance when the payment row is created. This does not match the proposed rule that verification and allocation should control final management balances.

This is evidence of a prototype gap, not a requested fix. No code was changed.

### Attendance

Attendance monitoring and the related HR/payroll boundary are present in the prototype documentation and source, but the validation pack correctly classifies them as deferred/isolated. They should not influence the travel-operations architecture.

## 15. Overall classification of the architecture

### BLOCKER findings

1. Booking commitment and payment order are not consistently defined.
2. Payment verification, allocation, and aggregate paid states are not separated by record level.
3. Payment-before-invoice and split/direct allocation policy is unresolved.
4. Inquiry-to-multiple-Booking cardinality is not finalized.
5. Refund/cancellation-cost records and relationships are missing.

These blockers are bounded. They do not require discarding the whole architecture, but they prevent safe implementation of the affected domains.

### IMPORTANT findings

1. Commercial Option and Availability persistence boundaries are open.
2. Supplier payable deposit/final-payment structure is under-specified.
3. Booking Item/Supplier Booking amendment lineage is under-specified.
4. Departure association level is open.
5. Expected margin scope is unresolved while included in the MVP.
6. Voucher readiness trigger is not defined.
7. Staff payment-verification and supplier-cost visibility are not final.
8. Participant-role relationships need one agreed representation.

### MINOR findings

1. Invoice due states should be distinguished from time-based alert projections.
2. Currency conversion snapshot fields need an explicit minimum boundary.
3. Manager/Admin distinction and audit-retention policy can be finalized after core approval.
4. Exact allowed Document/Task link types can be finalized during implementation.

### NO ISSUE findings

1. Supplier Package is not collapsed into WMIT Quotation.
2. Supplier remains the umbrella business term.
3. Custom tariff quotation does not imply availability.
4. Coordinator, payer, and traveler roles are not assumed to be identical.
5. Multiple suppliers in one Booking are supported conceptually.
6. Shared departures do not merge financial records.
7. Invoice, payment, supplier payment, and profit are explicitly distinguished.
8. No Trip entity is being forced prematurely.
9. Attendance, Google integration, accounting, payroll, HR, and AI agents are deferred.

## 16. Architecture readiness

**READY FOR SYNTHETIC PROTOTYPE**

The pack is sufficiently coherent to manually walk through synthetic data and test the intended distinctions. It is **not ready for implementation** of the core financial, cancellation/refund, booking-commitment, or departure-grouping behavior until the blocker decisions are resolved.

## 17. Five decisions that matter most

1. **What creates a confirmed Booking, and when may WMIT reserve before client payment?** Decide the normal rule and the approved exception path.
2. **How do invoices, Client Payments, verification, allocations, and unallocated money relate?** Decide whether payments may precede invoices, apply directly to Bookings, or split across obligations.
3. **What is the operational margin definition?** Decide the treatment of fees, pass-through charges, taxes, discounts, FX, supplier credits, refunds, and cancellation costs.
4. **Can one Inquiry produce multiple independent Bookings?** Decide whether sibling Bookings are sufficient or whether a later grouping concept is required.
5. **Where does Departure association live?** Decide Booking-level, Booking Item-level, or both with a derived summary.

## 18. Proposed validation scenarios before coding

Walk through these manually using synthetic records and record the expected state, evidence, financial balances, permissions, and dashboard result after each step:

1. An available wholesaler package is checked first, presented, accepted, paid, reserved, confirmed, and voucher-ready.
2. A wholesaler package is sold out before presentation; an alternative date is found and accepted.
3. A custom DMC tariff quotation is sent before availability is checked, then availability is checked later and fails.
4. One Inquiry produces three researched options: a package, a custom arrangement, and an airfare-only option; only one is selected.
5. One Inquiry produces two independent Bookings for different services or travel parties, without creating a Trip entity.
6. One coordinator communicates for four travelers, while a different person pays and the coordinator does not travel.
7. One Booking contains airfare, hotel, transfers, tours, insurance, and WMIT fees fulfilled by several Suppliers.
8. One Supplier Booking covers several Booking Items, then one item is amended to a different Supplier while the original evidence remains.
9. Three independent Bookings share one wholesaler Departure; verify counts, traveler totals, deadlines, and separate balances.
10. WMIT places a supplier reservation before client payment under an approved exception; verify risk, deadline, payable, and audit visibility.
11. A client pays an unverified PHP 30,000 deposit, then verification and allocation occur separately; compare provisional and final balances.
12. A client pays PHP 30,000 and PHP 70,000 installments against an invoice, including a payment that initially remains unallocated.
13. A supplier requires a deposit and later a final payment; record supplier confirmation, supplier payable components, and supplier payment evidence independently.
14. A supplier fails after client commitment; WMIT offers an alternative supplier/date and the client accepts or declines.
15. A cancellation creates a supplier penalty, supplier credit, and client refund; verify that original payments remain, refund approval is recorded, and updated margin is explainable.

## 19. Minimal next step

Run one facilitated, paper-or-spreadsheet synthetic walkthrough of the 15 scenarios above, focusing first on the five decisions in Section 17. Record only:

- the agreed record identities;
- state transitions and evidence;
- payment allocation and payable calculations;
- who may perform or approve each action;
- the minimum dashboard result.

Do not build the whole MVP yet. The smallest useful next artifact is an owner-approved decision sheet and scenario matrix that resolves the blockers and marks the remaining assumptions as provisional. Only after that should implementation planning resume.
