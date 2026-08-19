# WMIT Final Architecture Review

> **FINAL PRE-IMPLEMENTATION AUDIT RESULT:** The documents are implementation-ready only as a classified contract. Read [BASELINE-HANDOFF.md](BASELINE-HANDOFF.md) first. This review authorizes no implementation.

## Final business-rule invention audit

The audit outcome is **PASS WITH CLASSIFICATION CONTROLS**. Owner-confirmed rules are represented; stale stronger wording is superseded by the handoff contract; and no proposal may be implemented as policy.

| Rule or design statement | Owner evidence | Classification | Required behavior |
|---|---|---|---|
| Expo discount eligibility | Payment sent during specified Expo dates qualifies, even if verified later | CONFIRMED | Preserve actual sent timestamp/date separately from verification timestamp; show applied context/rule |
| Seasonal/early-bird/group/supplier promotions | Future extensibility only | PROPOSED / DEFERRED | Do not implement as Phase 1 policy |
| Bangkok Travel Services pilot | Explicit first real tariff pilot decision | CONFIRMED | Use synthetic data first, then validate the adapter/review/matching flow against Bangkok files |
| Payment verification | Staff records proof; authorized verification required | CONFIRMED | Unverified funds cannot satisfy financial gates |
| Supplier Payment gate | Verified client funds must cover the Supplier Payment amount; no WMIT advance | CONFIRMED | Permit reservation before payment; reject Supplier Payment on shortfall |
| Client allocation | Client directs allocation | CONFIRMED | Record exact instruction; no instruction remains unallocated |
| Role/approval thresholds | Exact authorities not yet selected | BLOCKED / CONFIGURABLE | Deny high-impact actions until trusted actor and policy are configured |
| Amendment/new-Booking threshold | Material changes normally amend; future split rule possible | CONFIGURABLE | Amend with immutable history by default; do not auto-split |
| Broader promotion/search/automation capabilities | Architectural possibilities only | PROPOSED / DEFERRED | No silent best-supplier selection, universal tariff language, or autonomous quotation |

Every blocked decision has a safe temporary behavior: preserve evidence, show uncertainty, create follow-up, and deny the high-impact transition. This is a document audit, not an implementation authorization.

Status: **FINAL ARCHITECTURE REVIEW — OWNER REVIEW REQUIRED — NO IMPLEMENTATION AUTHORIZED**  
Date: 2026-08-13  
Authority: owner clarification in the review request, reconciled with [baseline-v1.1.md](baseline-v1.1.md).  
Implementation plan: [implementation-plan-v1.2.md](implementation-plan-v1.2.md)

This review is read-only with respect to the application. Only this document, the v1.2 implementation plan, and the baseline handoff are architecture documents updated by this task.

## 1. Evidence reviewed

Reviewed:

- `baseline-v1.1.md`, `BASELINE-HANDOFF.md`, `prototype-redesign-plan.md`;
- the other documents under `docs/archive/business-architecture/`, including the tariff, financial, state, permissions, validation, gap, and implementation documents;
- `src/models/schema.js`, repositories, services, lifecycle and validation;
- application workflows, quotation calculations, payment conversion, document intelligence, configuration, Apps Script boundaries, HTTP routes, UI, and tests;
- the repository test suite: **68 passing, 0 failing** on 2026-08-13.

The passing tests demonstrate current technical behavior only. They do not prove that the current business model is correct.

## 2. Executive verdict

The business architecture is coherent enough to plan a controlled redesign, but the prototype is not ready to be extended directly. The correct path is a domain-level redesign that reuses technical foundations where they fit. The implementation plan is now conditionally acceptable only after the targeted contract corrections in this review are treated as binding planning requirements.

The baseline is substantially confirmed by the new clarification. It needs three important corrections in the implementation plan:

1. Expo/event context must become a first-class cross-cutting context, not merely an `Expo` source value.
2. Tariff ingestion must include an explicit staff review/confirmation workspace and a reliable rate-unit/quantity-basis model; the existing `SupplierTariff` row is far too narrow.
3. The financial design must make Payment Evidence, Payment Verification, Payment Allocation, Supplier Payable components, and Supplier Payment gating explicit records or controlled event boundaries.

The prototype should be treated as a local technical laboratory, not as the schema to be incrementally patched into the target system.

## 3. Confirmed decisions

The following are **CONFIRMED** by the clarification and consistent with Baseline v1.1:

- The business workflow is `Inquiry → Commercial Options/Availability → WMIT Quotation → Booking → Supplier Fulfillment → Financial Operations → Documents/Tasks/Departure`, with branching and independent states.
- Lead is not the authoritative business root. Inquiry preserves the original request and its changes.
- People are separate from roles. Coordinator, payer, traveler, communicator, and emergency contact may be different people or overlapping roles.
- Supplier is one umbrella master concept with capabilities/types, contacts, terms, portals, references, tariffs, quotations, confirmations, vouchers, and related files.
- Supplier Package, Supplier Tariff, Commercial Option, WMIT Quotation, Booking, Supplier Booking, Departure, Client Payment, Payment Allocation, Supplier Payable, Supplier Payment, Document, Task, and Communication Activity remain distinct concepts.
- One Inquiry may produce many options, quotations, and independent Bookings. One Booking may contain many Booking Items and Suppliers. One Supplier Booking may cover multiple Booking Items.
- Shared Departures are operational groupings; their financial records remain independent. Booking Item is the primary association where required.
- A supplier request/reservation may occur before client payment. Supplier payment must remain blocked until the required client money condition is satisfied.
- Client commitment, client payment, supplier reservation, supplier confirmation, supplier payable, and supplier payment are independent states.
- Payment can precede an invoice. Payment evidence, entry, verification, allocation, reversal, refund, and payable settlement must not be collapsed.
- Material Booking changes normally amend the existing Booking while preserving immutable history. The design must leave room for a later split/new-Booking rule.
- Partial traveler cancellation, replacement traveler scenarios, penalties, non-refundable amounts, supplier credits/refunds, client refunds/credits, and approvals require separate history.
- Operational margin is not accounting profit. Expected and Updated Operational Margin must retain their inputs and approved adjustments.
- Tariff automation is decision support. It must not silently select a supplier/product/rate, claim availability, or generate/send a client quotation without staff review.
- Tariff matching starts with staff requirements and returns multiple options, warnings, caveats, and match explanations.
- Tariffs can be matrix/conditional and supplier-specific. A small common envelope plus supplier-specific parsing/mapping is the right boundary; a universal tariff language is not.
- Explicit supplier wording overrides unit defaults. Accommodation/package defaults to per person and transfer defaults to per person per way only when the source does not state otherwise; ambiguity must be visible and reviewed.
- Itinerary information, inclusions, exclusions, meals, tours, transfers, conditions, and source provenance must survive tariff extraction and option/quotation creation.
- Expo/event context is part of the operating model. Event source, products, prices, discounts, validity, payment rules, and origin tracking must be explicit. Expo discounts must check both event validity and payment date.
- Communication tracking is lightweight manual activity logging initially; full channel ingestion is deferred.
- Authentication/authorization must eventually be a real service/security boundary. Caller-supplied role strings are not sufficient.
- Google Workspace remains unavailable during this phase and must not be configured.
- Supplier reservation before client payment is allowed, but Supplier Payment is blocked until verified client funds available for that Supplier Payment are sufficient to cover its amount; WMIT must not bridge a shortfall. Payment evidence, verification, client-directed allocation, and approval remain separate gates.
- Booking record creation is not client confirmation. WMIT may create a Booking operational record after client selection while its commitment state remains pending.

## 4. Corrections to the current baseline/plan

### 4.1 Expo is missing as a complete architecture concept

The baseline mentions Expo as an inquiry source but does not fully specify an event context. **Correction:** model an `EventContext`/`ExpoContext` that may attach to an Inquiry, Commercial Option, Quotation, Booking, payment terms, and discount rule. It should include event ID, event dates, eligible products, price/discount rule version, payment window, and evidence of origin. This is not a disconnected Expo System.

The event discount rule must be evaluated using the payment received/verified date as defined by the approved policy, not quotation date or staff memory. The exact definition of “pay within the event dates” is a remaining policy decision if the business has not chosen whether reported, verified, or cleared date controls eligibility.

### 4.2 Tariff representation must be more explicit than a single SupplierTariff record

The existing plan correctly rejects a universal tariff language, but implementation must not stop at a generic `SupplierTariff` header plus free-text fields. The target needs a versioned tariff source, extracted facts, conditional rate components, unit basis, quantity driver, provenance, confidence/review status, itinerary components, and supplier-specific extensions.

**Proposed boundary:** a common searchable envelope containing only validated fields, with a supplier-specific raw/structured payload and parser/mapping strategy retained beside it. The envelope must be able to represent rates per person, room, night, vehicle, group, way, service, and supplier-specific units without pretending they are interchangeable.

### 4.3 Financial separation must be implemented as behavior, not labels

The baseline names Payment Allocation and Supplier Payable, but the future plan must treat them as controlled ledgers/events rather than optional fields. A Payment row with `Pending Verification` cannot update a final client balance. A Supplier Booking `balance` cannot serve as the complete payable model. Supplier Payment must target an approved payable component and pass the client-money gate.

### 4.4 Booking confirmation policy is narrower than the current unresolved wording

The domain decision is confirmed: commitment, payment, reservation, confirmation, and payment are separate. What remains unresolved is only the authorization policy: which roles may mark a commitment as client-confirmed and which may request/reserve before payment, including exception approvals. The implementation must not reopen the domain model because of this policy question.

### 4.5 Current plan should not call itself implementation-ready in code terms

The repository’s older `IMPLEMENTATION-PLAN.md` and some earlier supporting documents contain stale blocker lists or earlier status language. They remain evidence, not authority. This v1.2 plan is the planning authority after owner approval; no document grants implementation authorization.

### 4.6 Phase 1 must be a vertical slice

The first implementation must be one complete deterministic workflow, not a foundation-only phase. It must allow a staff member to move a real/synthetic Inquiry through tariff/package research, reviewed option, quotation, client selection, Booking record, commitment state, Supplier reservation, payment proof/verification/allocation, Supplier Payable, Supplier Payment gate, documents/tasks, Departure visibility, and applicable promotion context. Later phases may increase sophistication without creating disconnected domains.

### 4.7 Tariff conditionality must be tested, not merely described

If a tariff contains different rates for combinations such as hotel × nights × pax × room type, the system must preserve those conditions and calculate against the correct combination. Flattening the source into generic rate rows is not acceptable. The first pilot should use 2–3 representative suppliers and 5–10 actual documents covering simple, medium, and highly conditional structures.

### 4.8 Supplier workspace is an MVP knowledge hub

Supplier is not a contact list. The MVP Supplier workspace must provide searchable supplier files and related tariffs, versions, packages, quotations, communications, Booking history, confirmations, vouchers, terms, procedures, deadlines, notes, and purposeful contacts.

## 5. Clarifications still required

The following historical questions are not current blockers where the owner has now decided the rule. Current classifications are: role authority is BLOCKED; margin, traveler staging, deadline, retention, cancellation/refund, and amendment split details are CONFIGURABLE or DEFERRED. Use the safe temporary behavior in the handoff and v1.2 plan.

Expo payment eligibility, the verified-funds Supplier Payment gate, client-directed allocation, pre-invoice payment recording, and the Bangkok Travel Services pilot are CONFIRMED. The older questions below are retained as historical evidence only and are not executable requirements.

1. Which date controls an expo discount payment-window test: payment reported, evidence received, payment verified, or cleared date?
2. Which roles may mark client commitment confirmed, request/reserve before payment, verify client payment, approve supplier payment, approve refunds, and approve pricing overrides?
3. What exact client-money condition unlocks a given Supplier Payable: any verified money, allocated money for that Booking, deposit threshold, full client obligation, or a Supplier/product-specific rule?
4. What fee, tax, pass-through, FX, refund, penalty, and supplier-credit components are included in Updated Operational Margin?
5. How should a payment received before a formal invoice be targeted initially, and who may change an allocation later?
6. What exact traveler data is required at Inquiry, Quotation, Booking, Supplier Reservation, ticketing, visa, and departure-readiness stages?
7. When does a material amendment require client re-acceptance, supplier re-confirmation, a new quotation, or a new Booking instead of an amendment?
8. What supplier-specific deadline, deposit, cancellation, and approval templates are needed first?
9. What audit and sensitive-document retention periods apply?
10. What is the approved first event/expo record and product catalog, if the upcoming event will be used in Phase 1?

## 6. Important missing or under-specified concepts

The target plan must explicitly include:

- `EventContext` plus versioned eligibility/discount/payment-window rules;
- `SupplierContact` or an equivalent contact-purpose relationship, so booking, payment, emergency, and operations contacts are not flattened into one email/phone field;
- `PaymentEvidence`/proof link and verification decision, even if implemented through controlled Document links initially;
- `PaymentAllocation` with allocation/reallocation history;
- `SupplierPayable` and payable components/schedules;
- `Amendment` and cancellation/adjustment history with before/after snapshots;
- traveler-level cancellation/replacement relationships;
- tariff `RateUnit`, quantity driver, rate basis, and explicit/derived/ambiguous interpretation status;
- tariff extraction review decisions and staff corrections/confirmations;
- availability evidence with source, checked time, scope, expiry/hold terms, and reviewer;
- price/discount rule snapshots, including event rule version and payment-window result;
- idempotency/correlation keys for extraction, payments, reminders, and generated documents.

These do not all require separate physical tables on day one, but their histories and security boundaries must be represented explicitly.

## 7. Prototype assessment

### 7.1 Genuinely reusable

**KEEP, with contract changes:**

- `src/core/money.js` and the minor-unit quotation/payment arithmetic;
- immutable ID generation direction and record-version mechanics;
- strict validation, reference checking, immutable fields, and atomic failure behavior;
- repository interfaces and in-memory repositories for synthetic tests;
- audit-log hooks and correlation-ID direction, subject to trusted actor context and durable production storage;
- quotation editor calculations and client-safe projection boundary;
- payment conversion helper as arithmetic/provenance support, not as a complete payment workflow;
- document classification, extraction result shape, confidence, warnings, provenance, and review-first behavior;
- Supplier Booking Item join behavior for multiple Booking Items;
- local test harness, fixtures, and Apps Script portability boundaries;
- safe disabled Google adapters and no-direct-SpreadsheetApp/DriveApp design.

### 7.2 Replace rather than adapt in place

**REPLACE as primary business behavior:**

- `Lead` as the mandatory workflow root;
- `Quotation.lead_id` as the required commercial parent;
- Lead-centric routes, dashboard counts, and UI navigation;
- `createQuotationFromLead` and `createBookingFromQuotation` as the central workflow;
- one-status Booking, Payment, Invoice, and Supplier Booking lifecycle semantics;
- `recordPaymentFromInvoice`, because it updates invoice paid/balance from all payment rows before verification/allocation;
- `recordSupplierPayment`, because it reduces Supplier Booking balance without a payable or client-money gate;
- the current single-row `SupplierTariff` shape as the tariff calculation model;
- broad unauthenticated `/api/state` and caller-supplied actor context for any future production use;
- attendance as part of the travel-operations domain.

### 7.3 Modify, not discard

- Client, Supplier, Booking, Booking Item, Supplier Booking, Document, Task, and Quotation concepts remain useful, but their contracts and relationships must be redesigned.
- The generic CRUD service may remain a low-level local mechanism, but domain services must own invariants and approvals.
- The current UI can donate visual patterns, not information architecture.

## 8. Tariff architecture assessment

### G. Complex tariff handling

**Assessment: PROPOSED architecture is sound if the following constraints are enforced.** It handles complexity without creating an unmaintainable universal language by separating:

1. immutable original file and extraction runs;
2. versioned supplier tariff source;
3. reviewable extracted facts with confidence/provenance;
4. validated common matching envelope;
5. supplier-specific structures and calculation adapters;
6. candidate option and draft calculation records;
7. staff selection and quotation review.

The architecture fails if it turns every supplier into the same normalized table or stores only destination and price. Phase 1 should support the tariff patterns actually found in the first approved supplier documents and expand through adapters, not universal abstraction.

### H. Workflow controls

**Assessment: CONFIRMED and correctly specified, with implementation gates required.** The sequence must be:

`staff requirements → available tariff search (optionally supplier-scoped in Phase 1) → multiple candidates → warnings/why matched → staff option selection → explicit-unit calculation → WMIT pricing → staff price review/override → quotation approval/presentation`.

Extraction review occurs before a tariff version becomes trusted for matching. No candidate may be silently labeled “recommended.” If there is no suitable match, the system must return no match, preserve the search, and offer manual research or supplier-quote follow-up.

Required UI evidence includes raw/normalized value, confidence, source location, ambiguity, missing fields, assumptions, rate unit, validity, hotel/duration/pax combinations, itinerary, and staff correction history.

## 9. Expo/event assessment

**Assessment: corrected design is adequate.** The MVP implements the confirmed Expo Commercial/Pricing Context only. Future seasonal, early-bird, group, supplier-specific, and other promotions are PROPOSED/DEFERRED extension points, not MVP policy. The context must preserve the actual client payment sent timestamp/date and the applied rule/reason.

Event eligibility must be explicit and evaluated at the relevant event/payment boundary. A quotation issued during an expo does not by itself preserve the discount. The system must show eligible dates, payment-window dates, rule version, actual payment-date evidence, and the resulting eligibility decision. Staff override requires an explicit reason and approval according to policy.

## 10. Supplier database assessment

**Assessment: concept is correct but current prototype is inadequate.** Supplier is correctly the umbrella entity, but the current schema has only one `supplier_type`, a few primary fields, payment terms, and notes. The target Supplier workspace must provide:

- capabilities/types as multi-valued or related records;
- multiple contacts with purpose, channel, language/time zone, active dates, and escalation priority;
- booking, payment, emergency, operations, and management contacts;
- terms, currencies, portals, references, notes, performance/usage history;
- related tariff versions, source files, supplier quotations, confirmations, vouchers, payables, and communication activities;
- restricted visibility for confidential terms and supplier costs.

This is one Supplier master with related records, not separate DMC/wholesaler/hotel databases. Searchable files from the Supplier record are an MVP requirement.

## 11. Financial and payment assessment

**Assessment: current code is materially unsafe for the target model.** The future flow must be:

`payment reported → evidence attached → verification decision → allocation/reallocation → client obligation projection`.

Separately:

`Supplier Booking/terms → payable components → client-money gate → approval → Supplier Payment evidence → payable projection`.

Unverified, rejected, reversed, unallocated, refunded, and credited amounts must remain distinguishable. Supplier confirmation is never proof that supplier payment is allowed. Cash received, client balance, Supplier Payable, Supplier Payment, cost, and operational margin remain separate.

The client directs allocation. The system must not automatically allocate to the oldest invoice, largest balance, or another invented target. If no instruction is supplied, the payment remains unallocated and creates staff follow-up.

## 12. Booking amendments and cancellation assessment

**Assessment: sufficient direction, but implementation requires a formal history boundary.** An amendment must preserve before/after dates, product, supplier, cost, selling value, traveler set, reason, actor, approval, client acceptance, supplier action, and resulting documents/tasks. A cancellation must preserve traveler-level outcomes, supplier terms, penalties, credits, refunds, replacement traveler evidence, and approvals. Original facts are append-only; current Booking projections may change.

The design should support a future `Booking Split/Replacement` relationship without requiring it now.

## 13. Permissions and security assessment

**Assessment: business sensitivity categories are sufficient for planning; enforcement is not present in the prototype.** At minimum:

- Admin/Owner: full authorized visibility and approval;
- Manager: operational and configured approval authority;
- Staff: operational work within policy, with sensitive fields limited by need;
- Intern: assigned low-risk work, drafts, and non-sensitive operational fields only.

Supplier cost, margin, payment proof, passport/identity documents, confidential supplier terms, refunds, adjustments, and sensitive communications require field- and action-level restrictions. Security must be server/service-side with trusted authentication, not UI hiding or a request field such as `role: 'Manager'`.

## 14. What to remove or defer

Remove from the v1 implementation plan:

- autonomous supplier recommendation, best-option ranking, or automatic quotation generation/sending;
- a universal tariff language;
- live global travel search and automatic live availability claims;
- full Messenger/WhatsApp/email ingestion;
- full accounting, revenue recognition, payroll, and attendance expansion;
- separate supplier systems by supplier type;
- automatic external booking, purchasing, payment, refund, or client messaging;
- a separate Trip, Travel Party, or Voucher core aggregate;
- production Google Workspace setup during the current phase;
- broad CRUD or unrestricted state edits as the production API.

## 15. Dependencies and build-twice risks

Respect this order inside one Phase 1 vertical slice:

1. Configure the trusted actor and approval policy for high-impact actions. Expo payment timing, the verified-funds Supplier Payment gate, client-directed allocation, amendment-by-default history, and the Bangkok Travel Services pilot are already CONFIRMED.
2. Define identity, Person roles, Inquiry, Commercial/Pricing Context, communication activity, and audit/security contracts.
3. Define Supplier master/contact/searchable-file behavior, tariff source/version/review, conditional/matrix rate components, Commercial Option, and Availability Evidence.
4. Define Quotation pricing snapshots, promotion eligibility, and review/approval projection.
5. Define Booking record versus commitment, Booking Item, amendment/repricing/re-acceptance, cancellation/replacement, Supplier Booking, payable components, and Departure membership.
6. Define Client Payment/evidence/verification/client-directed allocation and Supplier Payment gating before building the finance projection.
7. Build the staff workspaces and dashboards from these domain projections and walk all six cases end to end.
8. Add persistence/adapters only after local synthetic behavior is accepted and Workspace discovery is separately authorized.

Building tariff parsing before the rate-unit/provenance boundary, or building finance UI before payment allocation/payable gates, creates the highest risk of rework.

## 16. Final readiness conclusion

**READY FOR TARGETED PLAN CORRECTION AND SYNTHETIC DESIGN WALKTHROUGHS. NOT READY FOR IMPLEMENTATION AUTHORIZATION UNTIL THE CORRECTIONS ARE ACCEPTED.**

The architecture is directionally correct and technically reusable. The implementation contract must explicitly preserve conditional/matrix tariffs, a searchable Supplier knowledge hub, client-directed allocation, the confirmed reservation-before-payment/payment-gate distinction, Booking record versus commitment, amendment reprice/re-acceptance, traveler replacement/cancellation outcomes, and a complete Phase 1 vertical slice. No code, schema, UI, configuration, integration, migration, authentication, or AI automation should be changed until the owner accepts these corrections.

## 17. Sign-off blockers versus safe deferrals

### Must decide before the affected workflow is implemented

1. Trusted role authority and approval thresholds for payment verification, Supplier Payment, refunds/adjustments, pricing exceptions, client commitment, and reservation-before-payment. The affected action is BLOCKED and must fail closed until configured.
2. Detailed margin, traveler staging, supplier deadline, retention, cancellation/refund, and amendment split policies. These are CONFIGURABLE/DEFERRED and do not block synthetic walkthroughs when safe temporary behavior is used.

### Safe to configure or defer

- exact approval thresholds;
- default tariff units, if configurable and review-gated;
- detailed supplier deadline templates;
- retention periods;
- uncommon margin components, provided incomplete projections are clearly marked;
- exact amendment-versus-new-Booking threshold, if history and future split capability are preserved;
- advanced tariff adapters, global search, full communication ingestion, advanced refund automation, Google persistence, external availability, accounting, and AI assistance.

## 18. Final sign-off audit disposition

The remaining stale language is document drift, not an unresolved architecture choice. The handoff and v1.2 plan now establish one implementation contract with explicit classifications, precedence, safe blocked behavior, Bangkok Travel Services as the first real tariff pilot, actual Expo payment-sent timestamp eligibility, authorized verification before financial gates, and the sufficient-verified-funds Supplier Payment gate. The dangerous-behavior tests in v1.2 are mandatory acceptance criteria. No implementation authorization is granted by this review.
