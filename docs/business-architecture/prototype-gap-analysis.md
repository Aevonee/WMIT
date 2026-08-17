# WMIT Business Architecture Validation — Prototype Gap Analysis

> **SUPERSEDED by [prototype-redesign-plan.md](prototype-redesign-plan.md).** Retained as an earlier gap review; the redesign plan is the current prototype mapping.

> **NON-EXECUTABLE:** Use [final-architecture-review.md](final-architecture-review.md) and [implementation-plan-v1.2.md](implementation-plan-v1.2.md) for current replacement/reuse decisions.

Status: read-only comparison; no implementation changes made

## Classification

- **KEEP:** Concept is directionally correct and reusable.
- **REFACTOR:** Useful foundation, but business boundary or behavior must change.
- **REPLACE:** Current concept is materially wrong as the primary model.
- **DEFER:** Keep outside the first validated Operations scope.
- **REMOVE:** No longer justified as a first-class concept.
- **UNDECIDED:** Requires a business decision before classification can be final.

## Concept comparison

| Prototype concept | Classification | Findings |
|---|---|---|
| Lead | REFACTOR | Current entry point for the UI and `createQuotationFromLead`. It should become or be mapped to Inquiry semantics. The current Lead pipeline is too narrow for changing, multi-channel inquiries. |
| Client | KEEP / REFACTOR | Ongoing client relationship is correct. `source_lead_id` and direct assumptions about contact/traveler relationships are too narrow. |
| Contact | REFACTOR | Current Contact belongs to Client or Supplier and does not represent group participants or communication events. Refactor toward Person plus role/channel relationships. |
| Traveler | KEEP / REFACTOR | Separate Traveler and BookingTraveler relationships are useful. Person, coordinator, payer, and traveler roles need clearer separation. |
| Quotation | REFACTOR | Client-facing WMIT quotation is a valid concept. It must be separated from Supplier Package, availability, and source-option provenance. |
| Quotation Item | KEEP / REFACTOR | Multiple services and suppliers are supported. Need clearer treatment of fees, supplier-provided selling prices, currency conversion, and source values. |
| Booking | REFACTOR | Core Booking concept is correct, but `createBookingFromQuotation` over-centers conversion. Booking needs independent commitment and supplier-fulfillment dimensions. |
| Booking Item | KEEP / REFACTOR | Correctly supports multiple services and suppliers. Needs stronger link to actual selected option, fulfillment, costs, amendments, and departure association. |
| Departure | REFACTOR | Correctly exists as a concept, but current relationship is only an optional Booking field and readiness is a manual percentage. Need shared-departure grouping and derived counts. |
| Supplier | KEEP / REFACTOR | Umbrella terminology is correct. Singular free-text `supplier_type` is too limited; capabilities and supplier products need separation. |
| Supplier Package | REPLACE/ADD CONCEPT | No executable Supplier Package concept exists. It must be distinct from Quotation and linked to availability/departure where applicable. |
| Supplier Tariff | KEEP / REFACTOR | Useful source/rate concept exists. It must remain distinct from live availability and confirmed supplier fulfillment. |
| Supplier Booking | KEEP / REFACTOR | Correctly separated from client Booking and supports multiple items. Needs reserve-before-payment risk, confirmation evidence, deadlines, payable semantics, and supplier failure. |
| Invoice | REFACTOR | Separate client billing record is correct. Current model and application flow do not fully support multiple obligations, allocations, refunds, or unallocated money. |
| Payment | REFACTOR | Directional client/supplier payment distinction is useful. Need separate Client Payment/Supplier Payment concepts or stronger constraints, allocation, verification, evidence, refund, and payable behavior. |
| Supplier Payable | ADD CONCEPT | No first-class Supplier Payable exists. Current Supplier Booking balance is not enough as the long-term financial-operational model. |
| Profit | REPLACE IMPLICIT MODEL | Current markup/cost fields are not a complete profit model. Add explicit expected/updated operational margin projections after definitions are approved. |
| Document | KEEP / REFACTOR | Metadata, review-first extraction, and links are directionally sound. Need payment proof, client documents, source channels, sensitivity, supersession, and voucher workflow. |
| Voucher | REFACTOR | Exists mainly as a document type. Needs an operational creation/update/readiness workflow, but not necessarily a separate table initially. |
| Task | REFACTOR | Schema exists but no operational task UI, generation, or alerts. Needs typed deadlines, ownership, reminders, and neutral states. |
| Communication | ADD CONCEPT | Absent from the prototype. A lightweight communication/activity record or source/thread reference is needed for fragmented channels. |
| Attendance | DEFER / ISOLATE | Read-only local attendance monitoring and HR specialist work were added, but attendance is outside the current travel-operations architecture reset. |
| Google adapters | DEFER | Correctly disabled, but not production-ready. No access or integration should be added during validation. |
| Apps Script facade | KEEP AS BOUNDARY / REFACTOR SECURITY LATER | Controlled entry-point idea is useful. It is not authentication, authorization, or a production service layer yet. |
| Generic entity services | KEEP AS SCAFFOLDING / REFACTOR | Useful for local testing, but generic CRUD does not enforce WMIT business invariants. |
| In-memory repositories | KEEP FOR SYNTHETIC TESTING | Appropriate for prototype validation; not a production persistence solution. |
| Current UI navigation | REPLACE | Navigation reinforces “Lead → quotation” and lacks Inquiry, Options, Tasks, Documents, Departures, and operational exceptions. |
| Current tests | KEEP / EXTEND LATER | Good technical regression coverage, but no canonical business scenarios for package availability, changes, groups, refunds, or money allocation. |

## Major conflicts with the business model

1. The UI and main application action are explicitly Lead → Quotation → Booking.
2. Supplier Packages and availability are absent as first-class concepts.
3. Quotation Sent does not carry an explicit availability distinction.
4. Client confirmation and payment are not modeled as separate business dimensions.
5. Supplier reservation before client payment has no explicit risk/approval state.
6. Supplier Payable and Payment Allocation are absent.
7. Departure grouping is not operationally implemented.
8. Communication history is absent.
9. Amendment, cancellation, and refund workflows are absent.
10. Profit is represented indirectly through quotation markup/cost fields rather than a defined management projection.

## Documentation consistency issue

Some older documents describe earlier foundation states or earlier assumptions. For example, older audit/testing language may not exactly match the current schema and tests. The current executable code is evidence of prototype behavior, not proof of business correctness. The validation pack should become the business-architecture reference after owner approval.
