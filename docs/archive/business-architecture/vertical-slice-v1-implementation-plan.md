# WMIT Vertical Slice V1 — Generic Workflow Implementation Plan

Status: **Increments 1-5 local implementation complete; Apps Script parity and human acceptance remain**  
Date: 2026-08-15  
Purpose: smallest preservation-first change set required for the generic WMIT travel-case workflow to pass the V1 acceptance test

Related documents:

- [Vertical Slice V1 Acceptance Specification](vertical-slice-v1-acceptance-specification.md)
- [Vertical Slice V1 Status Report](vertical-slice-v1-status-report.md)
- [Stabilization and acceptance gate](../stabilization-acceptance.md)

## 1. Product target

The implementation target is a generic WMIT travel case:

```text
Generic WMIT Case
│
├── Client
├── Inquiry
├── Requirements
├── Commercial Options
├── Quotation
├── Client Decision
├── Booking
├── Supplier Fulfillment
├── Payment Obligations
├── Payments
├── Documents
├── Tasks
├── Profit
└── Completion
```

Specialized sources plug into `CommercialOption` rather than changing the workflow:

```text
Supplier-specific tariff adapter ─┐
Supplier-specific package       ──┼─→ Commercial Option
Custom itinerary                ──┤
Visa service                     ──┘
```

Bangkok is the required acceptance fixture and current supplier pilot. It is not a generic field, state, command, UI path, or orchestration rule.

## 2. Re-audit conclusion

The repository already contains enough domain primitives to avoid a rewrite. The smallest viable change set is a workflow-integration layer plus targeted integrity and projection improvements.

The main architectural defect was not that Bangkok-specific code existed. A pilot adapter is appropriate. The defect was that some pilot behavior was mandatory at generic application/UI boundaries:

- `src/application/phase1.js` imported the Bangkok extractor directly;
- the application exposed `uploadBangkokTariffDocument` as a first-class action;
- `app/public/operations.js` contained Bangkok-specific upload controls and synthetic tariff values;
- `app/public/phase1.html` is explicitly labelled and populated as a Bangkok tariff workflow;
- several integration fixtures use Bangkok directly rather than through a generic fixture boundary.

The generic `src/phase1/runtime.js` is substantially more portable: it contains generic `Inquiry`, `CommercialOption`, `SupplierPackage`, `Quotation`, `Booking`, payment, Supplier Booking, document, task, Departure, and reconciliation entities/actions. The generic runtime does not need to know the Bangkok extractor to represent an ordinary case.

### Removal test result

**Current result: passes for the generic application and Operations Workspace.**

The first controlled increment moved the extractor behind an explicit adapter boundary. Removing the Bangkok adapter from generic application configuration no longer breaks generic application construction, and the generic Operations Workspace no longer contains the Bangkok upload path or Bangkok synthetic values. The Bangkok pilot remains available only when its adapter is explicitly injected by pilot/test configuration.

The isolation gate is:

> With the Bangkok adapter, Bangkok source documents, and Bangkok-specific pilot UI removed, the generic WMIT application surface still loads and accepts generic source records. Cross-surface projection parity and the human workflow remain future acceptance gates.

## 3. Portability audit

This is a representation audit, not a claim that all six cases must pass the complete V1 browser walkthrough immediately.

| Fixture | Generic representation | Current result | Smallest required action |
|---|---|---|---|
| Bangkok package | Supplier + Supplier Package/Tariff adapter → Commercial Option → Quotation/Booking | **Acceptance fixture works; pilot leakage remains** | Isolate adapter and keep Bangkok only in fixture/pilot tests |
| Tokyo custom trip | Inquiry requirements → one or more generic Commercial Options → manual/custom Quotation → Booking Items | **Representable; workflow partial** | Add generic option-source contract and test without Bangkok fields |
| Visa-only service | Inquiry → service Commercial Option → Quotation/Booking Item → Supplier Fulfillment/Document/Payment | **Data-level possible; UI taxonomy incomplete** | Add generic service/product taxonomy support; do not add visa-specific workflow state |
| Hotel-only booking | Inquiry → hotel Commercial Option or manual option → Quotation → one Booking Item | **Mostly representable** | Verify quotation/Booking UI has no bundled-package assumption |
| MICE/corporate trip | Company/Agency Client + Person/participant roles + multiple options/items + tasks/payments | **Model foundation exists; workflow partial** | Add fixture and validate organization/participant fields through generic case projection |
| Group travel | Group participants + multiple Booking Items + optional Departure/Membership grouping | **Model foundation exists; projection partial** | Add fixture and verify group data does not require Bangkok/package fields |

Portability pass criteria:

1. Each fixture can be created with generic Client, Inquiry, Requirements, Supplier/Option, Quotation, Booking, payment, document, task, profit, and completion records where applicable.
2. No fixture requires a new generic state dimension.
3. No fixture requires a Bangkok-specific field or command.
4. No fixture requires a different Command Center or case-workspace route.
5. Specialized interpretation remains behind an adapter or source-specific record, not inside generic orchestration.

## 4. Smallest implementation change set

### Change set A — Isolate pilot adapters and genericize fixtures

**Status: Increment 1 complete for adapter/application/UI isolation; generic fixture builders remain future work.**

**Goal:** make the generic system independent of Bangkok while preserving the current pilot.

1. Define a narrow supplier/source adapter boundary for tariff/package interpretation.
2. Make Bangkok extraction an optional registered adapter, not a mandatory import of the generic application facade.
3. Move Bangkok upload controls under an explicitly labelled pilot/test surface or replace them with a generic source-upload boundary.
4. Remove Bangkok values from generic seed/default UI controls.
5. Add generic fixture builders for the six portability cases.
6. Keep Bangkok extractor and source files as isolated pilot tests.

**Do not:** generalize the Bangkok parser into a universal tariff engine or add destination-specific fields to the core model.

**Exit evidence:** the removal test passes and all six fixture builders instantiate the generic case model without Bangkok-specific code paths.

### Change set B — Add one shared case projection and transition contract

**Status: Increment 2 complete for the pure local projection contract and application read path; UI and Apps Script adoption remain future work.**

**Goal:** make runtime, UI, and Apps Script answer the same operational questions.

Add a pure, generic case projection with these outputs:

- current stage;
- five independent state dimensions;
- next action and reason;
- blockers;
- deadlines;
- exceptions;
- responsible actor/role;
- allowed actions;
- blocked actions and reasons;
- linked source records;
- projection version/timestamp.

The projection should consume existing records. It should not introduce a second status field or duplicate the database.

The existing UI `nextAction()` chain and application follow-up helper should become consumers or compatibility wrappers around this contract, not remain independent workflow logic. Increment 2 establishes the contract and local read path; it does not yet retrofit those consumers.

**Smallest design:** a deterministic projection function plus transition definitions and an idempotent task-reconciliation function. A full event-bus infrastructure is not required for V1.

**Increment 2 exit evidence:** the local projection is deterministic, read-only, covers the requested workflow states, and represents the non-Bangkok fixture matrix without destination-specific code. Cross-surface parity remains a later acceptance gate.

### Change set C — Complete commercial decision integrity

**Status: Increment 3 complete for local quotation versioning, accepted snapshots, revision safety, and amendment re-acceptance. Public lifecycle and UI adoption remain future work.**

**Goal:** preserve what the client actually accepted.

1. Add explicit quotation version identity and lifecycle evidence.
2. Add public/client decision paths for Accept, Request Changes, and Decline.
3. Record the exact accepted quotation version.
4. Snapshot the selected Commercial Option at acceptance.
5. Snapshot the accepted commercial values when creating Booking.
6. Preserve old snapshots when requirements, options, prices, or suppliers later change.

Reuse existing `Quotation`, `QuotationAcceptance`, `CommercialOption`, `OptionReplacement`, `Amendment`, and revision fields where possible. Do not replace them with a new parallel quotation system.

**Exit evidence:** `Booking created from Quote vN / Option vN` is visible and later edits cannot alter the accepted historical snapshot.

### Change set D — Complete authoritative money and operational projections

**Status:** Narrow Increment 4 scope complete locally: duplicate-safe obligations, obligation-level payment allocation, supplier-payment gates, derived finance/readiness inputs, and projected/actual profit separation. Document-generation automation, event-driven deadline tasks, and Completion/closeout remain future work.

**Goal:** make the post-Booking workflow operationally coherent without building accounting.

1. Create the authoritative client obligation/payment schedule from Booking with duplicate protection.
2. Keep obligation, payment event, evidence, verification, and allocation visibly separate.
3. Derive supplier confirmation deadlines and Supplier Payable tasks from configured evidence/terms.
4. Add a generic required-document checklist and derived readiness projection.
5. Add projected and actual profit components: selling price, supplier cost, fees, commissions, adjustments, and completeness state.
6. Add a controlled Completion/closeout record or command with unresolved-exception and waiver behavior.

Reuse existing payment, Supplier Payable, document, task, readiness, and reconciliation records. Do not introduce full accounting or automatic external settlement.

**Exit evidence:** the case cannot be marked complete while mandatory money, supplier, document, or profit blockers remain unresolved unless an authorized waiver is recorded.

### Change set E — Make the Operations Workspace pass the human test

**Goal:** prove workflow behavior rather than feature existence.

1. Make the Command Center show cases, current situation, next action, reason, blockers, deadlines, exceptions, and responsible actor.
2. Keep a selected generic case context across focused editors.
3. Make each transition visible as the next permitted action.
4. Show why blocked actions are unavailable.
5. Remove developer-only reset/upload shortcuts from the staff acceptance path.
6. Provide a simulated client decision and supplier response path through visible interfaces.
7. Record the exact browser walkthrough and expected/actual evidence.

**Exit evidence:** a non-developer can complete the Bangkok fixture without Sheets, console, hidden APIs, or undocumented engineering assistance.

### Change set F — Add acceptance and portability tests

**Goal:** make the contract enforceable and prevent Bangkok regression into generic code.

Add tests for:

- every transition’s precondition, action, state change, projection, allowed/blocked actions, audit event, and retry;
- the six portability fixtures;
- removal of the Bangkok adapter/files from generic runtime loading;
- generic UI rendering with Tokyo, visa-only, hotel-only, MICE, and group fixtures;
- no Bangkok-specific string/command dependency in generic projection/orchestration modules;
- duplicate clicks, partial failure, stale quotation, amendments, missing evidence, and incomplete closeout.

The current 147 passing tests remain regression evidence. They should be extended and reorganized around this contract rather than discarded.

## 5. Controlled implementation order

This is dependency order. The first four increments below have been authorized and executed in the local runtime.

Current controlled sequence:

1. **Pilot isolation - complete**: make Bangkok optional and prove the removal test.
2. **Shared case projection - complete**: establish the generic derived projection and local read path.
3. **Commercial snapshots and quotation decisions - complete**: version, acceptance, revision, amendment, Option/Booking snapshots.
4. **Obligations, readiness, and profit - local scope complete**: authoritative obligations, payment/allocation safety, supplier-payment gates, and projected/actual profit separation.
5. **Operations Workspace integration - local scope complete**: expose projection-derived state and route local controls through guarded actions; Apps Script parity remains separately deferred.
6. **Human browser acceptance - final gate**: run Bangkok end-to-end and portability checks.

The historical dependency breakdown below is retained for implementation detail; the sequence above controls authorization.

1. **Contract and fixture harness** — define transition/projection schemas and six generic fixture builders.
2. **Pilot isolation** — make Bangkok optional and prove the removal test.
3. **Shared case projection** — replace duplicated next-action logic with one generic projection.
4. **Commercial snapshots and quotation decisions** — version, accept/change/decline, Option/Booking snapshots.
5. **Obligations, readiness, profit, and Completion** — finish the derived operational chain.
6. **Operations Workspace integration** — expose the projections and allowed/blocked actions.
7. **Human browser acceptance** — run Bangkok end-to-end and portability checks.

Do not begin OCR, reporting, portal, integrations, or accounting before this sequence passes.

## 6. Explicit preservation rules

- Keep the existing generic runtime entities and controlled actions unless the acceptance contract proves a specific invariant is impossible.
- Keep Bangkok extraction as a supplier-specific pilot adapter and preserve its tests.
- Keep existing financial gates, authorization behavior, audit log, exact-money helpers, and idempotency behavior.
- Keep Google Workspace disabled during local implementation.
- Do not migrate or rewrite existing business data.
- Do not add destination-specific states to generic workflow records.
- Do not make a supplier adapter responsible for client commitment, payments, documents, tasks, profit, or completion.
- Do not make the Command Center a second source of truth.

## 7. Implementation gate

This plan is a controlled work breakdown. Completion of an increment does not authorize later increments.

Implementation may begin only after owner review confirms:

1. the generic boundary and Bangkok adapter isolation rule;
2. the six-fixture portability contract;
3. the smallest change-set sequencing;
4. the preservation rules; and
5. the hard pass/fail human acceptance test.

Increment 5 was explicitly authorized and is complete within its narrow local Operations Workspace scope. The repository remains in controlled incremental implementation/review mode; no Apps Script parity, accounting expansion, or Completion/closeout implementation is implied by this increment. See [Increment 5 Cross-Surface Audit](increment-5-cross-surface-audit.md).
