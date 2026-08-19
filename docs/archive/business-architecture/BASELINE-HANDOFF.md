# WMIT Business Architecture Baseline Handoff

> **CURRENT IMPLEMENTATION CONTRACT (2026-08-13):** This handoff is the single business-rule authority after owner sign-off. The legacy status line and any later paragraph that conflicts with this contract are superseded. This document still authorizes no implementation.

## Current rule classification

Every business rule, policy, default, and implementation boundary must carry exactly one classification:

- **CONFIRMED:** explicitly owner-decided; implement it.
- **PROPOSED:** useful architecture or future direction not approved as policy; do not implement it as policy.
- **CONFIGURABLE:** the concept is confirmed, but the exact value, threshold, role, or policy can be configured.
- **DEFERRED:** intentionally outside the Phase 1 MVP; do not build it now.
- **BLOCKED:** the affected action must stop until a decision or authority is configured; use the safe temporary behavior stated below.
- **TECHNICAL IMPLEMENTATION CHOICE:** Codex may choose the mechanism when business behavior, visibility, approval, and data meaning do not change.

Older labels such as `DERIVED`, `PROVISIONAL`, and legacy `UNRESOLVED` in supporting documents are not executable instructions.
`SUPERSEDED / NON-EXECUTABLE` is a document status, not a seventh business-rule classification.

## Current owner-confirmed corrections

- **CONFIRMED:** Phase 1 is one complete end-to-end vertical slice using synthetic data initially. Bangkok Travel Services is the first real tariff pilot.
- **CONFIRMED:** Expo discount eligibility is based on the actual date/time the client sends payment. Preserve that sent timestamp/date separately from proof receipt and verification timestamps; later verification does not change eligibility. Preserve the pricing context/rule used and show staff why it applied.
- **PROPOSED / DEFERRED:** seasonal, early-bird, group, supplier-specific, and other future promotions are extension points only; do not implement them as MVP policy.
- **CONFIRMED:** Staff records a payment and proof. Authorized verification is required before verified funds affect financial gates.
- **CONFIRMED:** WMIT may request/reserve with a supplier before client payment. Supplier Payment requires verified client payment sufficient to cover the Supplier Payment amount. WMIT must not advance its own funds to bridge a shortfall.
- **CONFIRMED:** Client-directed allocation is recorded exactly as instructed. If no instruction exists, retain the payment as unallocated and create follow-up; never auto-allocate.

## Safe behavior for blocked or configurable decisions

- **BLOCKED authorization:** deny verification, Supplier Payment, refund, price override, client-commitment confirmation, or reservation exception unless a trusted authorized actor and approval policy are configured.
- **CONFIGURABLE margin detail:** preserve every fee, discount, penalty, refund, credit, and FX effect separately; label incomplete projections and never call them accounting profit.
- **CONFIGURABLE amendment threshold:** amend by default with immutable before/after history; do not auto-split or create a second Booking.
- **CONFIGURABLE traveler/deadline policy:** show missing data or missing policy as an explicit task/blocker; do not invent data, deadlines, refunds, or readiness.
- **BLOCKED retention policy:** do not claim production retention compliance until configured; preserve local synthetic records for review.

Status: **FINAL IMPLEMENTATION CONTRACT — NO IMPLEMENTATION AUTHORIZED**  
Canonical authority after sign-off: this handoff, incorporating the owner clarification and accepted [final-architecture-review.md](final-architecture-review.md)  
Planning detail: [implementation-plan-v1.2.md](implementation-plan-v1.2.md), which may not alter business rules  
Repository: WMIT Operations  
Date: 2026-08-13

This handoff is the concise entry point for the next review or implementation agent. It does not authorize code, schema, UI, test, configuration, integration, migration, authentication, AI, or production-data changes.

## 1. Precedence

Use this order:

1. Latest explicit owner decisions and clarifications.
2. This handoff, once the owner accepts the targeted corrections.
3. `final-architecture-review.md` for accepted architecture interpretations.
4. `implementation-plan-v1.2.md` for dependency order and implementation detail only.
5. `baseline-v1.1.md`, six-case validation evidence, and other supporting documents.
6. Existing prototype code/tests as evidence of current behavior only.

If documents conflict, the higher source wins. The implementation plan must stop and request clarification rather than convert a PROPOSED, DEFAULT, or UNRESOLVED item into a business rule.

Older documents such as `baseline-v1.md`, `open-decisions.md`, `IMPLEMENTATION-PLAN.md`, and earlier gap/recommendation documents are historical or supporting evidence where they conflict with the current authority.

Legacy labels in the inherited baseline are evidence only. Use the six classifications in Section 1A.

## 2. Confirmed operating model

```text
Inquiry
  → Commercial Options / Availability Evidence
  → WMIT Quotation
  → Booking
  → Supplier Booking(s) / fulfillment
  → Client money / Supplier Payables
  → Documents / Tasks / Departure readiness
```

This is a branching workflow, not Lead → Quotation → Booking. Preserve the original Inquiry and material changes. One Inquiry may produce multiple options, quotations, and independent Bookings. One Booking may contain multiple Booking Items and Suppliers. Shared Departures group operations and never merge finances.

Keep separate:

`Supplier Tariff ≠ WMIT Quotation ≠ Booking ≠ Supplier Booking`  
`client commitment ≠ client payment ≠ supplier reservation ≠ supplier confirmation ≠ supplier payment`  
`cash received ≠ revenue ≠ operational margin`

## 3. Confirmed supplier/tariff rules

- Supplier is the umbrella master for wholesalers, DMCs, airlines, hotels, transfers, tour operators, insurance, visa providers, airfare sources, and others.
- Supplier Packages require availability checking before presentation.
- Custom tariff quotations may precede availability checking; a quotation is not availability evidence.
- Tariffs are complex conditional/matrix data. Preserve the original source, supplier-specific structure, provenance, validity, units, itinerary, inclusions/exclusions, and warnings.
- Staff enters requirements first, reviews multiple matching options, and chooses the option. Phase 1 may use supplier/tariff-scoped matching as a PROPOSED implementation boundary, but staff must not be required to know the correct supplier beforehand.
- No automatic “best supplier,” silent rate selection, automatic quotation, fabricated match, or unverified availability claim.
- Extraction must be reviewed/corrected/confirmed before the tariff becomes trusted for matching/calculation.
- Explicit source wording overrides any configured default. The unit and quantity driver must be shown. Default units are configurable implementation policy, not hard-coded business truth; ambiguity requires review.
- `Find More Options` excludes or distinguishes rejected, unavailable, superseded, duplicate, and already-shown candidates. No match means manual research or supplier quote follow-up.

The Supplier workspace is an MVP operational knowledge hub, not a contact list. A Supplier record must provide searchable contacts, procedures, terms, deadlines, notes, files, tariff versions, packages, quotations, communications, Booking history, confirmations, vouchers, payables, and related documents.

## 4. Confirmed pricing rules

For applicable custom tariff pricing:

- standard markup: 30%;
- currency conversion: BDO Forex Selling Rate + 1.0;
- card/PayPal fee: 5%;
- visa assistance fee: variable by case/service;
- discounts, fees, taxes, conversion effects, penalties, refunds, credits, and overrides are explicit and visible.

Calculated values, actual quoted values, rule versions, actor, time, reason, and source tariff/option remain traceable. Staff reviews and approves before client presentation.

Pricing rules are structured and versioned: fixed markup, rate-based FX conversion, percentage payment-method fee, variable/manual service fee, and explicit contextual discount with amount/percentage, reason, authority, period, and eligibility conditions.

## 5. Confirmed event/expo rules

**CONFIRMED MVP:** Commercial/Pricing Context attaches an explicit expo/event context to ordinary Inquiry/Option/Quotation/Booking records. The expo discount is valid only for the specified expo dates, and the client must actually send payment within that period. Eligibility uses the actual client payment sent timestamp/date, preserved separately from proof receipt and verification timestamps. Later verification does not change the original sent timestamp/date. The applied context/rule and reason remain visible to staff.

**PROPOSED / DEFERRED:** seasonal, early-bird, group, supplier-specific, and other future promotions are extension points only and are not MVP policy.

## 6. Confirmed people, booking, and cancellation rules

- Coordinator, payer, traveler, communicator, and emergency contact are distinct roles; one person may have several roles.
- A Booking operational record may be created after client selection while client commitment remains pending. Booking record creation is not client confirmation.
- **CONFIRMED:** supplier reservation/request may occur before client payment. Supplier Payment requires verified client payment sufficient to cover the Supplier Payment amount. WMIT must not advance its own funds to bridge a shortfall. Authorization remains a separate configured gate.
- Material changes normally amend a Booking with before/after snapshots, reason, actor, approval, client acceptance, supplier actions, and document/task history.
- Partial traveler cancellation, replacement, supplier penalties, non-refundable amounts, credits, refunds, and approvals are separate outcomes and must not overwrite original facts.

## 7. Confirmed financial rules

Payment may precede an invoice. Record separately:

`client reports payment → staff records payment → proof/evidence → authorized verification → staff records the client's intended allocation → allocation/reallocation → client obligation balance`

Also record separately:

`Supplier Booking/terms → Supplier Payable components → client-money gate → approval → Supplier Payment`

The system must not invent an allocation. If the client does not specify an allocation, the payment remains unallocated and creates staff follow-up. Unverified, rejected, reversed, unallocated, refunded, and credited amounts must remain distinguishable. Supplier Booking balance is not the payable model. Expected and Updated Operational Margin are operational projections, not accounting profit.

## 8. Target security boundary

Minimum roles: Admin/Owner, Manager, Staff, Intern. Supplier cost, markup/margin, payment proof, identity documents, confidential supplier terms, refunds/adjustments, and sensitive communications are restricted. Production requires trusted authentication and server/service-side authorization. Caller-supplied role strings and UI hiding are not security.

## 9. Prototype findings

The prototype has 68 passing tests and useful foundations: exact money arithmetic, immutable IDs, validation, repositories, audit hooks, quotation client projections, multi-item Supplier Booking relationships, document classification/extraction with human review, synthetic tests, and disabled Google adapters.

The prototype does not implement the target architecture. Code-grounded conflicts include:

- `src/models/schema.js` still defines Lead as the entry model and requires `Quotation.lead_id`;
- the HTTP routes and UI are explicitly Lead → quotation → Booking;
- no first-class Inquiry, Commercial Option, Availability Evidence, Commercial/Pricing Context, Person role records, Payment Allocation, Supplier Payable, Amendment, or Communication Activity exists;
- `SupplierTariff` is a single narrow row, not a conditional/matrix tariff subsystem;
- `recordPaymentFromInvoice` updates invoice balances from payment rows even when payments are Pending Verification;
- `recordSupplierPayment` reduces Supplier Booking balance without payable components, verification, or the client-money gate;
- lifecycle validation uses one status per entity instead of independent state dimensions;
- `/api/state` exposes a broad local snapshot and the server has no production authentication/authorization;
- UI navigation has no Inquiry/Options/Tariff review/Supplier workspace/Tasks/Documents/Departures model;
- Apps Script and Google adapters are boundaries only and remain intentionally disabled.

Therefore: reuse technical foundations; replace conflicting business behavior.

## 10. Implementation sequence

Phase 1 is one complete deterministic vertical slice, not a foundation-only phase:

1. Resolve the minimum blocking policies, approve synthetic cases, and define the trusted actor/security contract.
2. Build identity, Person roles, Inquiry, Commercial/Pricing Context, communication, tasks, Supplier master/contact/searchable-file workspace, and audit projections.
3. Build tariff source/version/review, trusted-version gate, conditional/matrix rate components, itinerary, supplier-specific adapter boundary, requirements-first Commercial Options, Availability Evidence, multiple candidates, and Find More Options.
4. Build quotation pricing rules, promotion eligibility, staff review, client-safe output, Booking record versus commitment, Booking Items, Supplier Booking/Items, reservation-before-payment behavior, amendment/repricing/re-acceptance, and minimum cancellation/replacement history.
5. Build client payment proof/verification/client-directed allocation, Supplier Payable components, client-paid Supplier Payment gate, approvals, refunds/credits/penalties, documents, tasks, and Departure visibility.
6. Walk all six real cases end to end.

Phase 2 expands conditional/matrix sophistication, broader cross-Supplier search, additional supplier adapters, deeper cancellation/refund automation, and document intelligence. Defer Google Workspace, live availability, full communications, autonomous AI, accounting, and external actions.

Full details: [implementation-plan-v1.2.md](implementation-plan-v1.2.md). Review findings: [final-architecture-review.md](final-architecture-review.md).

## 11. Blocking decisions before the affected workflow

1. A single signed authority hierarchy for these documents.
2. Role authority for payment verification, Supplier Payment, refunds/adjustments, pricing exceptions, client commitment, and reservation-before-payment.
3. Role/approval configuration for the affected high-impact actions. **BLOCKED action behavior:** deny unless a trusted authorized actor and explicit policy are configured.
4. Detailed margin components, staged traveler requirements, supplier deadline templates, retention, uncommon cancellation/refund policies, and exact amendment-versus-new-Booking threshold. **CONFIGURABLE/DEFERRED:** preserve uncertainty, create tasks/blockers, and do not invent policy.

## 12. Safe to configure or defer

Exact approval thresholds, configurable default tariff units, supplier deadline templates, retention periods, uncommon margin components, exact amendment-versus-new-Booking threshold, advanced tariff adapters, global search, full channel ingestion, advanced cancellation/refund automation, Google persistence/deployment, external availability, full accounting/tax, payroll/attendance, and AI assistance may be deferred if their boundaries remain explicit.

## 13. Stop condition

Stop at architecture review. Do not implement or modify the prototype, schema, tests, UI, configuration, data, integrations, Google Workspace, authentication, or AI automation until separately authorized.

## 14. Final consistency rule

The current owner decisions are the classified rules in the opening contract and the detailed acceptance tests in [implementation-plan-v1.2.md](implementation-plan-v1.2.md). Any older section in this handoff that says the Expo payment date, first tariff pilot, client-money gate, or payment-before-invoice behavior is unresolved is superseded. Any supporting document that says Phase 1 is foundation-only, requires supplier selection before requirements, or enables future promotions as MVP policy is non-executable.
