# WMIT Vertical Slice V1 — Codex Status Report

Date: 2026-08-15  
Status: **Increments 1-6 local implementation complete; Apps Script parity and human acceptance remain**  
Scope: Repository inspection against the owner-approved WMIT Vertical Slice V1 workflow/state contract

## Executive status

Codex inspected the current repository and produced the acceptance specification for:

```text
Inquiry
  → Commercial Options
  → Quotation
  → Client Decision
  → Booking
  → Supplier Fulfillment
  → Payment Obligations / Payments
  → Documents
  → Tasks
  → Profit
  → Completion
```

The repository contains a substantial local synthetic foundation, but the Vertical Slice V1 is **not yet accepted** as a complete staff workflow. Owner authorization has now covered four controlled increments: Bangkok pilot isolation, the generic derived Case Projection/Orchestration contract, commercial decision/Booking snapshot integrity, and the narrow obligations/payment/readiness/profit layer.

The current implementation proves many domain rules in isolation. It does not yet prove that a non-developer staff member can complete the entire case through the Operations Workspace while the system continuously explains the situation, next action, blockers, deadlines, responsible actor, and retry behavior.

The real product target is a **generic WMIT travel case**. Bangkok is a required test fixture for the current supplier/tariff pilot, not a product requirement. Generic workflow, UI, domain, and orchestration logic must not depend on Bangkok, Bangkok Travel Services, one tariff layout, or one package composition.

## Deliverables produced

1. [WMIT Vertical Slice V1 — Bangkok End-to-End Acceptance Specification](vertical-slice-v1-acceptance-specification.md)
2. This status report
3. [WMIT Vertical Slice V1 — Generic Workflow Implementation Plan](vertical-slice-v1-implementation-plan.md)

The acceptance specification is the testable product contract. This report is the current repository assessment against that contract.

The implementation plan remains preservation-first. Increments 1-6 have been executed under controlled authorization in the local workspace; Apps Script adoption and human acceptance remain unexecuted.

## Verification performed

- Inspected the local runtime, application facades, Apps Script services, browser Operations Workspace, public quotation view, schema, documentation, and integration/unit tests.
- Ran focused pilot-isolation tests.
- Result: **2 passed, 0 failed**.
- Ran `npm.cmd test` after the change.
- Result: **149 passed, 0 failed** after the Increment 5 local adoption changes.
- Increment 5 audit and parity boundary: [Cross-Surface Audit](increment-5-cross-surface-audit.md).
- Increment 6 workflow usability details: [Workflow Usability Pass](increment-6-workflow-usability.md).
- No Google Workspace, external supplier, production account, or real business data was accessed.
- No production or Google Workspace configuration was changed.

Passing automated tests are evidence of service-level behavior only. They are not evidence that the human workflow acceptance gate has passed.

## What already exists

- Local synthetic runtime with controlled operations, validation, immutable IDs, money helpers, and audit logging.
- Requirements-first Bangkok tariff review and multiple candidate Commercial Options.
- Explicit staff option selection with no automatic “best” candidate selection.
- Draft quotation calculation/editor, pricing history, exact-money validation, and client-safe preview.
- Quotation approval and client-acceptance gates.
- Booking creation from accepted quotation, lead-passenger requirement, commitment separation, and retry handling.
- Client payment evidence, authorized verification, client-directed allocation, Supplier Payable, Supplier Payment gate, refund authorization, and financial retry tests.
- Supplier Booking relationships, Booking Items, fulfillment controls, amendments, and readiness issues.
- Local case header, inquiry queue, next-action chain, task view, document view, finance view, supplier view, and departure view.
- Tokenized Apps Script public quotation preview and acceptance path.

## Product-boundary decision

The implementation target is the reusable workflow, not a Bangkok-specific system. The same backbone must support Bangkok, Tokyo, visa-only, hotel-only, airline, group, MICE, customized, supplier-package, and future inbound cases by supplying different records or approved supplier-specific adapter behavior.

Bangkok-specific logic is permitted only inside the existing controlled supplier pilot adapter and its test fixture. A generic command, projection, state transition, or UI view that names or requires Bangkok is a defect.

## Current assessment

### Present or strong foundation

- Inquiry validation and requirements history
- Commercial Option matching and provenance
- Human selection and tariff trust gates
- Quotation calculation and safe client projection
- Payment verification/allocation separation
- Supplier-payment funding gate
- Audit primitives and idempotency in important service operations
- Synthetic regression coverage

### Increment 1 completed

- Bangkok tariff extraction is now an explicitly registered supplier/source adapter in `src/adapters/bangkok-tariff-upload-adapter.js`.
- The generic application exposes a generic `uploadSourceDocument` boundary and no longer imports or exposes a Bangkok-specific upload action.
- The generic Operations Workspace no longer contains Bangkok-specific upload controls or synthetic Bangkok values.
- The Bangkok pilot remains covered through explicit adapter injection in its integration test.
- The generic-surface isolation test verifies that the application and Operations Workspace do not contain Bangkok-specific pilot paths.

### Increment 2 completed

- Added a pure generic `projectCase` contract with derived identity, current stage, next action, blockers, deadlines, responsible actor, exceptions, commercial state, client commitment, supplier fulfillment, finance, documents, tasks, profitability, readiness, allowed actions, and blocked actions.
- The projection reads existing runtime records and does not create or maintain a master case-status field.
- Added read-only application operations for one case or all cases.
- Added fixture-independent progression tests from empty Inquiry through completion and exception states.
- Ran the same projection contract against Tokyo custom, visa-only, hotel-only, MICE, group, and supplier-package fixtures.
- Verified projection reads are deterministic and do not mutate records.

### Increment 3 completed

- Added explicit `commercial_version` semantics to the existing Quotation record; the audit `record_version` remains separate.
- Expanded the existing `QuotationAcceptance.quote_snapshot` into a complete accepted-commercial snapshot covering quotation identity/version, option/provenance, supplier, services, requirements/travelers, itinerary, pricing, terms, and acceptance evidence.
- Booking creation now uses the accepted snapshot and stores `accepted_commercial_snapshot` with acceptance lineage/version.
- Added controlled quotation revision creation using the existing Quotation entity and copied Quotation Items, without introducing a parallel commercial-decision entity.
- Prevented accepted quotations from being edited in place; revised quotations require a new acceptance.
- Extended amendment re-acceptance to create a new accepted Booking snapshot while preserving the original snapshot and amendment history.
- Added regression coverage for snapshot completeness, immutability, revised acceptance, duplicate Booking retries, and amendment/re-acceptance.

### Increment 4 completed — local authoritative money and profit projections

- Added duplicate-safe Booking obligation creation using the existing `ClientObligation` and `PaymentScheduleItem` records; repeated creation returns the existing records.
- Kept payment events, evidence, verification, and allocation separate. Unverified payments cannot be allocated, and verified but unallocated or over-target funds remain visible rather than satisfying an obligation implicitly.
- Blocked allocations to another Booking or another Booking's obligation; allocation retries are idempotent.
- Strengthened Supplier Payment to require an approved payable, valid supplier prerequisites, sufficient verified allocated client funds, and no payment above the remaining payable. Supplier Payment cannot create client funds.
- Extended the derived finance projection with per-obligation amount, allocated amount, outstanding amount, and `OUTSTANDING`/`PARTIALLY_SATISFIED`/`SATISFIED` states.
- Extended reconciliation/profit projections so projected profit remains separate from actual profit; actual profit requires fully allocated client obligations and realized Supplier Payments.
- Added focused regression coverage for timing changes, partial allocation, overpayment, wrong targets, duplicate retries, supplier gates, projected-profit changes, and actual-profit finalization.

### Partial

- **Workflow orchestration:** the local Operations Workspace now consumes projection-derived stage/action and finance/readiness data; Apps Script remains on its older duplicate path pending a separately authorized parity/migration increment.
- **Command Center:** basic counts, queue, selected case, and next-action behavior exist; blockers, deadlines, exceptions, and responsible actors are not fully derived.
- **Quotation lifecycle:** local commercial versions and revision-safe acceptance now exist; Sent/Viewed/Change Requested/Declined/Expired lifecycle states and public browser handling remain incomplete.
- **Booking integrity:** accepted Option, quotation, service, pricing, requirements, and Booking snapshots now exist locally; cross-surface and broader amendment policy evidence remain incomplete.
- **Payment obligations:** local authoritative post-Booking creation, per-obligation allocation, duplicate protection, and timing-change behavior are implemented; visible staff workflow remains future work.
- **Supplier fulfillment:** service controls exist; deadline derivation and case-level supplier exceptions need completion.
- **Documents/readiness:** document records and manual readiness issues exist; generated checklist and derived readiness are incomplete.
- **Tasks:** idempotent stage follow-up exists; event/deadline/owner/reminder orchestration is incomplete.
- **Profit:** local projected and actual profit components now remain separate and require realized settlement evidence; broader accounting/reporting remains out of scope.
- **Completion:** some Booking/Departure completion values exist; case-level closeout, waivers, final settlement, and post-trip follow-up are incomplete.
- **Human acceptance:** no verified browser walkthrough yet proves the workflow without developer controls or hidden API shortcuts.

### Missing for acceptance

1. Formal transition contract for every workflow step:

   `Precondition → Staff action → State change → Derived next action → Allowed/blocked → Audit → Retry`

2. Cross-surface adoption of the shared orchestration projection by the Operations Workspace and Apps Script.
3. Public quotation lifecycle and version-specific decision paths for accept, request changes, and decline.
4. Cross-surface verification of immutable accepted Option and Booking commercial snapshots.
5. Cross-surface proof of the authoritative payment-obligation flow and case-level readiness.
6. Generated trip-document checklist and case-level readiness projection.
7. Browser-visible projected/actual profit workflow and completion policy.
8. Case-level Completion command, closeout checklist, waiver handling, and reopen behavior.
9. End-to-end browser acceptance test using only the intended staff/client/supplier interfaces.
10. Portability evidence proving that Bangkok fixture values can be replaced without changing generic workflow or orchestration code.

## Acceptance decision

**Not accepted yet.** Increments 1-6 pass their local implementation/test gates, but the complete workflow still fails the V1 acceptance gate until the intended browser walkthrough succeeds and Apps Script parity is either demonstrated or explicitly excluded from the selected V1 surface.

The current test suite passing is necessary but insufficient. The slice passes only when the human walkthrough succeeds and every transition satisfies the acceptance specification.

## Authorization state

Increments 1-6 were authorized and are complete in the local runtime. Apps Script parity and the human browser acceptance remain **not authorized** as implementation increments.

The next authorized decision point is owner review of:

- the acceptance specification;
- this status report;
- the classification of present, partial, and missing behavior; and
- the proposed hard pass/fail browser walkthrough.

The next decision point is owner review of the Increment 4 financial/readiness/profit evidence before authorizing any staff-facing UI or cross-surface changes.
