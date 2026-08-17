# WMIT Vertical Slice V1 — Bangkok End-to-End Acceptance Specification

Status: **baseline acceptance contract — specification and gap report only**  
Implementation authorization: **not granted by this document**  
Scope: one synthetic Bangkok trip through the local Operations Workspace and simulated client/supplier interactions  
Authority: owner-approved product baseline; read with [stabilization-acceptance.md](../stabilization-acceptance.md), [implementation-plan-v1.2.md](implementation-plan-v1.2.md), and the repository instructions in `AGENTS.md`.

## Product boundary: generic travel case

The product target is a generic WMIT travel case. Bangkok is the required synthetic acceptance fixture for the current supplier/tariff pilot, not the product model, workflow vocabulary, UI structure, or orchestration boundary.

The same workflow must support Bangkok packages, Japan FIT, Korea tours, European groups, visa-only services, hotel-only bookings, airline tickets, MICE/corporate trips, customized itineraries, supplier packages, and future inbound travel.

Bangkok-specific interpretation, extraction, or calculation is permitted only inside the existing supplier-specific pilot adapter and its controlled fixture. No generic entity, command, projection, state rule, or UI component may require Bangkok, Bangkok Travel Services, a particular tariff format, or one package shape.

## 1. Purpose

This specification evaluates whether WMIT behaves as one travel-agency operating system. It does not pass a phase because individual modules or API functions exist. It passes only when a staff member can move one case through the workflow and the system continuously explains:

- the current situation;
- the next action;
- why that action is next;
- what is blocking other actions;
- who needs to act;
- what deadlines or exceptions matter; and
- what will happen if the action is retried.

Every transition is evaluated using this contract:

```text
Precondition
  → Staff action
  → System state change
  → Derived next action
  → Allowed / blocked actions
  → Audit event
  → Retry behavior
```

The system may use multiple focused editors behind one case context. It must not require staff to mentally reconstruct the case by navigating disconnected modules.

## 2. Scope and explicit non-goals

### In scope

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

The Command Center and case workspace are derived projections over these records. They are not a replacement for the records and must not become a second source of truth.

### Frozen for this acceptance gate

- OCR, PaddleOCR, and AI supplier-document ingestion;
- supplier API integrations and real-time availability;
- automated external supplier booking or purchasing;
- Google Workspace setup, persistence, or production data;
- broad management reporting;
- full accounting, tax, or statutory revenue recognition;
- an elaborate client portal;
- autonomous supplier selection, pricing, payment, refund, or communication.

The Bangkok tariff/document may remain controlled pilot evidence. Extraction quality is supporting evidence, not the primary success criterion.

## 3. Case setup

The acceptance harness creates only synthetic records. It must not use production IDs, real customer information, real payment proofs, or live supplier actions.

The values below are test inputs, not application constants. The application must receive them through normal Client, Inquiry, Supplier, Option, Quotation, Booking, payment, fulfillment, document, task, and profit operations.

| Field | Required synthetic value |
|---|---|
| Client | Synthetic Bangkok Client |
| Coordinator / payer | Synthetic adult coordinator |
| Travelers | 2 adults and 1 child |
| Destination | Bangkok, Thailand |
| Travel dates | 10–14 November 2026 |
| Duration | 5 days / 4 nights |
| Requirements | Hotel, airport transfers, and tours |
| Supplier pilot | Bangkok Travel Services |
| Currency | PHP |
| Quotation total | PHP 120,000 for the acceptance scenario |
| Supplier cost | PHP 85,000 for the acceptance scenario |
| Fees | PHP 3,500 for the acceptance scenario |
| Commission | PHP 5,000 for the acceptance scenario |
| Payment schedule | PHP 30,000 deposit; PHP 90,000 balance due 20 October 2026 |

The specific commercial values may be represented by synthetic reviewed tariff data, but they must be entered or selected through the staff workflow. They must not be silently hardcoded into a test-only shortcut that bypasses the user experience.

### Fixture portability check

The acceptance harness must include portability evidence showing that Bangkok values can be replaced without changing generic workflow or orchestration logic. The generic path must not assume a Bangkok destination, one tariff layout, one supplier category, a package as the only option, a particular traveler composition, one currency, one payment pattern, or a hotel-plus-transfer-plus-tour bundle.

## 4. State contract

WMIT must keep these dimensions separate. No single `CONFIRMED` or equivalent field may stand in for all of them.

| Dimension | Meaning | Acceptance examples | Authoritative evidence |
|---|---|---|---|
| Commercial | What WMIT is currently offering or has sold | Option selected; quotation approved; quotation sent; quotation accepted; change requested; declined; expired | `CommercialOption`, `Quotation`, quotation decision/version records |
| Client commitment | Whether the client has committed to the Booking | Pending; accepted; cancelled; re-acceptance required | `Booking.commitment_state`, client decision/amendment evidence |
| Supplier fulfillment | What has been requested or confirmed with suppliers | Not requested; requested; reserved; confirmed; cancelled; completed | `SupplierBooking`, `SupplierBookingItem`, confirmation evidence |
| Finance | What the client owes, what has been received, and what may be paid out | Deposit due; payment reported; verified; allocated; fully funded; payable blocked/paid | Client obligations, schedule items, payments, evidence, allocations, payables, supplier payments |
| Operational readiness | Whether the trip can proceed with required documents and actions complete | Documents pending; supplier confirmation pending; ready; departed; completed | Document checklist/readiness projection, tasks, Departure/readiness records |

These states are derived into a human-readable case summary. The summary must identify its source records and timestamp where a value is not current or is incomplete.

## 5. End-to-end transition contract

The following transitions are mandatory. The status in the final column describes the current repository evidence before implementation of the missing work.

### T0 — Initialize the synthetic case

| Contract element | Acceptance requirement |
|---|---|
| Precondition | Local synthetic workspace is reset; no Bangkok case records exist; no Google or external connection is active. |
| Staff action | Staff opens Operations Workspace and creates/selects the synthetic Client and Inquiry through visible UI controls. |
| State change | Client and Inquiry exist with immutable IDs, original request, current requirements, people/roles, and audit events. |
| Derived next action | `Create/complete Inquiry requirements` or `Find/prepare commercial options`, with the reason shown. |
| Allowed / blocked | Creating an Inquiry is allowed; option matching is blocked until required destination, timing, and traveler composition exist. |
| Audit | Client creation and Inquiry creation, actor, timestamp, IDs, result, and correlation/reference. |
| Retry | Repeating the same deliberate create action must not silently create duplicate business records. |
| Current evidence | **Partial.** Local UI and validation exist; the current reset is explicitly synthetic/developer-oriented and must not be the staff acceptance path. |

### T1 — Inquiry to Commercial Options

| Contract element | Acceptance requirement |
|---|---|
| Precondition | Inquiry has Bangkok, 10–14 November 2026, 2 adults, 1 child, and hotel/transfers/tours requirements. |
| Staff action | Staff selects `Find/prepare commercial options`. The system searches reviewed pilot data and presents candidates. |
| State change | One or more `CommercialOption` records contain selected requirements snapshot, supplier, price preview, conditions, provenance, warnings, and candidate history. |
| Derived next action | `Review candidates and select one option`, or a clearly explained blocker such as `Review tariff` / `No matching option`. |
| Allowed / blocked | Staff may compare and select; the system must not choose the cheapest, highest-margin, or “best” candidate automatically. Unreviewed/ambiguous tariff data cannot become quotable. |
| Audit | Matching attempt, candidate presentation, exclusions/warnings, and staff selection or rejection decision. |
| Retry | Normal matching reuses prior candidates; Find More Options records its reason and does not duplicate or silently repeat excluded candidates. |
| Current evidence | **Partial-to-present.** Requirements-first matching, multiple candidates, provenance, review gates, selection, Find More Options, and retry tests exist in `src/phase1/runtime.js` and the Phase 1 tests. Selection/rejection history and the visible end-to-end staff path are not yet proven as one acceptance transition. |

### T2 — Commercial Option to Quotation

| Contract element | Acceptance requirement |
|---|---|
| Precondition | Staff has explicitly selected one Commercial Option. |
| Staff action | Staff clicks `Create quotation`, edits itinerary, inclusions, exclusions, price, payment terms, validity, and notes, then saves the draft. |
| State change | Draft Quotation references the Inquiry and selected Option, retains commercial source/provenance, calculates exact money, and records pricing edits without destroying prior values. |
| Derived next action | `Review and approve quotation` or a specific missing-data/pricing blocker. |
| Allowed / blocked | Draft editing is allowed; client-facing send/acceptance and Booking creation are blocked until required review and approval. Supplier cost and internal fields must not appear in the client projection. |
| Audit | Draft creation, each material pricing/content update, calculated result, actor, reason, and failure if rejected. |
| Retry | Repeating create from the same selected Option must not create an unintended duplicate active draft; invalid edits must leave the prior draft unchanged. |
| Current evidence | **Partial-to-present.** Draft editor, exact money, pricing history, manual fallback, client-safe preview, and atomic validation exist. Public lifecycle, version identity, and complete payment-term structure are incomplete. |

### T3 — Quotation approval and send

| Contract element | Acceptance requirement |
|---|---|
| Precondition | Draft quotation is complete and pricing review is authorized. |
| Staff action | Authorized staff approves the quotation, then sends/shares the client-safe version through the supported simulated/public channel. |
| State change | Quotation becomes an immutable identifiable version with sent timestamp, validity, public-link state, and client-safe projection. Viewing is recorded if supported. |
| Derived next action | `Await client decision`, with expiry deadline and assigned owner. |
| Allowed / blocked | Staff may revise by creating a new version; editing the sent/accepted version in place is blocked. Booking is blocked until an accepted version exists. |
| Audit | Approval, version creation, send/share, link issuance, and any view event. Internal cost/margin must never be included in client-facing output or public logs. |
| Retry | Re-sending the same version is idempotent or creates an explicit resend event; it must not mutate the accepted snapshot. |
| Current evidence | **Missing/partial.** Approval and safe preview exist. Apps Script can issue a tokenized public link, but the local staff acceptance path does not prove send/view lifecycle, immutable quotation version records, resend behavior, or a full public-link security contract. |

### T4 — Client decision

| Contract element | Acceptance requirement |
|---|---|
| Precondition | Client has an approved, non-expired public quotation version. |
| Staff/client action | Simulated client opens the public quotation and chooses `Accept`, `Request changes`, or `Decline`. |
| State change | The decision records quotation version, actor/name or authenticated token context, timestamp, method, and decision-specific evidence. Acceptance locks the commercial snapshot. Request changes creates a revision path; decline closes the commercial path without creating a Booking. |
| Derived next action | Accept → `Create Booking`; request changes → `Revise quotation`; decline → `Close as declined`; expired → `Prepare new quotation`. |
| Allowed / blocked | Only the accepted version may create a Booking. A stale, changed, invalid, or expired version cannot be accepted silently. |
| Audit | Decision event with quotation/version ID, old/new commercial state, actor, timestamp, and correlation/reference. |
| Retry | Repeating the same decision returns the existing decision; conflicting decisions require an explicit amendment/revision rule. |
| Current evidence | **Partial.** Internal and Apps Script public acceptance exist and are tested. `Request changes`, `Decline`, explicit quote lifecycle states, version selection, and public browser acceptance are not complete. |

### T5 — Client decision to Booking

| Contract element | Acceptance requirement |
|---|---|
| Precondition | One specific quotation version is accepted; required lead passenger and participants are available. |
| Staff action | Staff clicks `Create Booking` from the accepted case. |
| State change | Booking records Inquiry, accepted Quotation version, selected Option snapshot, client price, supplier cost snapshot, participants, and independent commitment state `PENDING`. |
| Derived next action | `Confirm client commitment` if still pending, or `Request supplier reservation` after configured commitment policy allows it. |
| Allowed / blocked | Booking creation is allowed once acceptance requirements pass; Supplier fulfillment and client commitment remain separate. Duplicate Booking creation is blocked/idempotent. |
| Audit | Booking creation includes the accepted quotation/version, commercial snapshot, actor, and lineage. |
| Retry | Repeating the same create command returns the existing Booking without duplicating participants, obligations, or downstream records. |
| Current evidence | **Partial.** Booking creation is acceptance-gated, lead-pax atomic, idempotent, and separates commitment. The accepted commercial Option/version snapshot is not complete enough to prove historical integrity. |

### T6 — Booking to Payment Obligations

| Contract element | Acceptance requirement |
|---|---|
| Precondition | Booking exists from an accepted quotation; client price and currency are fixed for the current Booking snapshot. |
| Staff action | Staff creates the authoritative client obligation and payment schedule: PHP 30,000 deposit and PHP 90,000 balance due 20 October 2026. |
| State change | Obligation and schedule items exist independently of the quote’s proposed payment terms, with amount, currency, purpose, sequence, due date, and Booking lineage. |
| Derived next action | `Collect deposit` with due date; later `Collect balance` with due date. |
| Allowed / blocked | Payment events may be recorded against a valid Booking/obligation; schedule creation must not duplicate; balance status cannot be marked paid from an unverified event. |
| Audit | Obligation/schedule creation, changes, approvals, and failed duplicate attempts. |
| Retry | Repeating the same obligation or schedule command returns the prior record or produces a controlled conflict; it must not create duplicate receivables. |
| Current evidence | **Present locally; partial cross-surface.** The local runtime creates duplicate-safe Booking obligations and linked schedule rows, preserves obligation timing, and exposes per-obligation balances. Apps Script/UI adoption and the human transition walkthrough remain incomplete. |

### T7 — Payment event, verification, and allocation

| Contract element | Acceptance requirement |
|---|---|
| Precondition | Deposit obligation exists; staff has payment evidence for PHP 30,000. |
| Staff action | Staff records payment proof, an authorized actor verifies it, and staff allocates the verified amount to the deposit obligation. |
| State change | Separate records show reported payment, evidence, verification state, allocation, and remaining obligation balance. |
| Derived next action | Before verification: `Verify payment`; after verification and before allocation: `Allocate verified payment`; after allocation: `Collect balance` or any other active blocker. |
| Allowed / blocked | Recording evidence is allowed for staff; verification is authorized-only; allocation is blocked until verified; automatic oldest-balance allocation is forbidden. |
| Audit | Record, evidence attach, verification/rejection, allocation, actor, amounts, old/new states, and failures. |
| Retry | Same idempotency key returns the same payment/evidence/allocation; duplicate clicks without a key must be detected or require explicit confirmation; no duplicate money event may be created. |
| Current evidence | **Present locally; partial in workflow proof.** Verification, allocation, exact money, evidence, authorization, obligation-level balances, wrong-target blocking, over-target protection, and retry tests exist. The staff acceptance path must prove these distinctions visually and transition-by-transition. |

### T8 — Booking to Supplier Fulfillment

| Contract element | Acceptance requirement |
|---|---|
| Precondition | Booking contains supplier-linked items and the current commercial/commitment policy permits a supplier request. |
| Staff action | Staff requests a supplier reservation and records the simulated supplier response. |
| State change | Supplier Booking and item relationships exist; supplier state progresses independently from client commitment; confirmation evidence and deadline are retained. |
| Derived next action | Pending → `Follow up supplier`; confirmed → `Create/approve Supplier Payable`; failed → `Review alternatives`; overdue → exception. |
| Allowed / blocked | Request is allowed under configured authority; automatic supplier selection or automatic confirmation is blocked; supplier payment remains separately gated. |
| Audit | Reservation request, response, confirmation/failure, supplier reference, deadlines, actor, and evidence. |
| Retry | Same supplier request returns the existing Supplier Booking; a changed supplier response creates an amendment/history event rather than overwriting confirmation facts. |
| Current evidence | **Partial-to-present.** Supplier Booking relationships, status controls, confirmation concepts, retry behavior, and supplier-payment gate exist. Deadline derivation, response simulation, and the case-level next-action projection are incomplete. |

### T9 — Supplier Payable and Supplier Payment

| Contract element | Acceptance requirement |
|---|---|
| Precondition | Supplier confirmation and payable amount are recorded; sufficient verified client funds are allocated. |
| Staff action | Staff creates/approves the Supplier Payable, then attempts Supplier Payment. |
| State change | Payable is approved and payment is executed only when the configured verified-funds gate passes. |
| Derived next action | Insufficient funds → `Collect/verify/allocate client funds`; approved and funded → `Execute Supplier Payment`; paid → next fulfillment/readiness action. |
| Allowed / blocked | Staff may record evidence; unauthorized approval/payment is blocked; shortfalls never become WMIT-funded bridges. |
| Audit | Payable creation/approval, gate result, payment execution, amount, actor, and failure reason. |
| Retry | Same Supplier Payment idempotency key returns the existing payment; failed insufficient-funds attempts create no payment. |
| Current evidence | **Present locally; partial in end-to-end UI.** The runtime now checks approved payable state, supplier prerequisites, remaining payable balance, verified allocated funds, authorization, and retry safety. Full staff-only browser proof remains absent. |

### T10 — Booking to Documents and Readiness

| Contract element | Acceptance requirement |
|---|---|
| Precondition | Booking and relevant supplier/client records exist. |
| Staff action | Staff opens the case and generates or records required documents: confirmation, itinerary, voucher, payment receipt/evidence, and other configured documents. |
| State change | Each document has type, status, source/evidence, record links, sensitivity, and review/send state. A readiness projection identifies missing or stale documents. |
| Derived next action | `Generate/obtain [specific missing document]`, with owner and deadline. |
| Allowed / blocked | Client-facing documents must use approved projections; unreviewed extraction cannot become a confirmed document; sensitive files remain restricted. |
| Audit | Document creation/upload, classification/review, generation, supersession, send, and access where required. |
| Retry | Repeating generation is idempotent or creates a clearly versioned document; duplicate uploads are detected by checksum or explicit review. |
| Current evidence | **Partial.** Document records, review-first extraction, links, voucher/fulfillment controls, and readiness issues exist. A generated booking checklist, document-generation commands, required-document policy, and readiness derived from the whole case are not complete. |

### T11 — Event-driven Tasks and Deadlines

| Contract element | Acceptance requirement |
|---|---|
| Precondition | A workflow event changes the case or a policy deadline becomes applicable. |
| Staff action | Staff completes the displayed task or records the required response; staff does not manually reconstruct every follow-up. |
| State change | Idempotent task is created/updated with type, owner, due date, source event/record, priority, state, reminder history, and completion evidence. |
| Derived next action | The next unresolved task or exception is shown with its reason and responsible actor. |
| Allowed / blocked | Completing a task does not falsely mark the underlying business action complete; blocked tasks remain visible and neutral. |
| Audit | Task creation, supersession, assignment, reminder, completion, waiver, and failure. |
| Retry | Re-running orchestration creates no duplicate active task for the same event/key; stale tasks are superseded explicitly. |
| Current evidence | **Partial.** `ensureAutomaticFollowUpTasks` is idempotent and creates stage-based tasks. It is a recompute helper rather than a complete event orchestration layer and does not cover all required deadlines, owners, reminders, exceptions, or document readiness events. |

### T12 — Profit projection and finalization

| Contract element | Acceptance requirement |
|---|---|
| Precondition | Booking commercial snapshot exists; known costs, fees, and commission inputs are recorded. |
| Staff action | Staff reviews projected profit before departure and finalizes actual profit after supplier/client settlement inputs are complete. |
| State change | Projection and actual result remain separate, with source components: selling price, supplier cost, fees, commission, adjustments, and completeness state. |
| Derived next action | Missing component → `Record/review [component]`; complete pre-departure → `Projected profit ready`; settled → `Finalize actual profit`. |
| Allowed / blocked | Incomplete values cannot be presented as authoritative actual profit; accounting profit must not be claimed. |
| Audit | Calculation snapshot, source changes, overrides, finalization, and incomplete/blocked result. |
| Retry | Repeating calculation is deterministic; finalization is idempotent and cannot silently rewrite a historical settlement snapshot. |
| Current evidence | **Present locally; partial in workflow proof.** Projected profit includes selling price, supplier cost, fees, commissions, and adjustments; actual profit is separate and requires fully allocated client obligations and realized Supplier Payments. Browser finalization and broader accounting remain out of scope. |

### T13 — Operational completion

| Contract element | Acceptance requirement |
|---|---|
| Precondition | Travel has completed or the synthetic case has reached its configured closeout date; required supplier, client, document, payment, and profit records are either complete or explicitly waived/exceptioned. |
| Staff action | Staff reviews the completion checklist and closes the operational case. |
| State change | Booking/readiness becomes `COMPLETED` or an explicitly named exception state; final documents, settlement, client follow-up, and actual-profit snapshot are linked. No underlying history is deleted or rewritten. |
| Derived next action | Complete → `No further operational action`; incomplete → the specific closeout task, unresolved exception, or approval required. |
| Allowed / blocked | Closeout is blocked by unresolved mandatory documents, unverified money, open supplier obligations, unapproved adjustments, or incomplete required profit inputs unless an authorized waiver is recorded. Reopening requires an explicit controlled action. |
| Audit | Completion review, checklist result, unresolved exceptions/waivers, actual-profit state, actor, timestamp, and any reopen event. |
| Retry | Repeating closeout returns the existing completion result; it must not create duplicate follow-up, settlement, or completion records. |
| Current evidence | **Partial.** Booking/Departure `COMPLETED` values and reconciliation records exist, but a case-level completion checklist, closeout command, waiver policy, and post-trip client follow-up are not yet implemented as one workflow. |

## 6. Command Center projection contract

The Command Center must be derived from the case records and transition rules. It should not rely on a manually maintained stage field.

For each active case, it must show:

| Projection | Required behavior |
|---|---|
| Current stage | Human-readable stage derived from the highest-priority unresolved transition, with source facts. |
| Next action | One primary action plus secondary actions where necessary; wording must be operational, not merely a status label. |
| Blockers | Specific missing, unauthorized, stale, conflicting, or failed prerequisite. |
| Deadlines | Quotation expiry, payment due, supplier response, document, departure, and other configured deadlines with source and owner. |
| Exceptions | Overdue supplier confirmation, missing evidence, insufficient verified funds, stale quotation, failed document, unresolved readiness issue, or incomplete profit inputs. |
| Responsible actor | Assigned staff/role or explicit `unassigned`; never silently inferred from the person who last clicked. |
| Case context | Client, destination, dates, traveler composition, Inquiry, selected Option, current Quotation version, Booking, and key money/readiness totals. |

### Current projection evidence

**Partial.** `app/public/operations.js` has a case header, `nextAction()` chain, inquiry queue, task count, and selected-case context. It does not yet derive all five state dimensions, blockers, deadlines, exceptions, responsible actor, or command-center counts from a formal orchestration contract. Navigation still exposes many module tabs, so the browser acceptance must prove that staff can operate through the case workspace without losing context.

## 7. Financial safety contract

These are hard pass/fail rules:

1. A payment obligation is not a payment event.
2. A payment event is not verified merely because it was entered or has proof attached.
3. Verification is not allocation.
4. Unverified or unallocated funds do not reduce an authoritative balance or unlock Supplier Payment.
5. Supplier Payment is blocked when verified allocated client funds are insufficient.
6. The system never bridges a Supplier Payment shortfall silently.
7. Duplicate payment events, obligations, allocations, and Supplier Payments are rejected or idempotently replayed.
8. A refund or adjustment is a separate approved record and is never inferred from cancellation alone.
9. Projected profit is not actual profit and neither is presented as statutory accounting.

The repository already has strong service-level coverage for most of these rules. The missing evidence is the visible case-level workflow and the no-hidden-API human test.

## 8. Snapshot and integrity rules

The following historical facts must remain immutable or versioned:

- original Inquiry request;
- changed Inquiry requirements and change history;
- selected Commercial Option and its source/provenance;
- each quotation version and its client-facing content;
- the exact quotation version accepted by the client;
- the accepted commercial Option snapshot;
- Booking creation snapshot, including client price and supplier cost at that time;
- payment obligation amounts and due dates;
- payment event, evidence, verification, and allocation facts;
- supplier confirmation and payable history;
- amendment and re-acceptance history;
- projected and actual profit snapshots.

Later price, date, supplier, or requirement changes must create a revision/amendment path. They must not silently rewrite what the client accepted or what a previous calculation showed.

### Current integrity gap

**Partial-to-present.** The local runtime now records explicit commercial versions, expands `QuotationAcceptance.quote_snapshot` into a complete accepted-commercial snapshot, and stores that snapshot on Booking creation. Public quotation lifecycle, cross-surface adoption, and the full browser acceptance path remain incomplete.

### Increment 3 snapshot contract

The accepted snapshot must be sufficient to reconstruct the client decision without reading the mutable Quotation. It includes, when applicable:

- quotation identity, commercial version, and quotation record version;
- selected Commercial Option, source/provenance, and Supplier;
- Quotation services/items;
- destination, travel dates, itinerary, and traveler composition;
- requirements snapshot;
- client price, supplier cost, markup, fees, tax, discount, currency, and pricing context/rules;
- inclusions, exclusions, payment terms, and relevant client-facing notes; and
- acceptance timestamp, actor, and evidence/reference.

The Booking stores the accepted snapshot and acceptance lineage. A later quotation revision or amendment must not mutate the original acceptance snapshot. A revised quotation has a new commercial version and requires a new acceptance; repeated acceptance or Booking creation for the same version is idempotent.

## 9. Audit and failure contract

Every meaningful transition and failed attempt must record:

- timestamp;
- actor and trusted role context;
- action/transition name;
- entity and record IDs;
- correlation/idempotency reference;
- precondition/result;
- old and new state where applicable;
- relevant amount or version reference;
- error/block reason where applicable.

Mandatory failure scenarios:

- unauthorized approval, verification, payment, refund, or override;
- insufficient verified funds;
- missing or invalid payment evidence;
- missing supplier confirmation;
- duplicate click and retry after partial failure;
- stale or expired quotation;
- changed quotation after client acceptance;
- amendment requiring client re-acceptance;
- duplicate obligation or payment;
- missing required document;
- incomplete profit inputs.

### Current audit evidence

**Partial.** The local audit log records actor, action, entity, result, details, and correlation ID, and the runtime records failed operations. The acceptance contract requires more consistent transition-level details and an auditable derived-next-action result. This must be verified rather than assumed from generic CRUD audit events.

## 10. Human acceptance test

### Operator

A non-developer staff member who has not read source code or undocumented test instructions.

### Permitted interfaces

- local Operations Workspace;
- visible public quotation view;
- simulated client decision flow;
- simulated supplier response flow;
- visible approved test fixtures/data-entry controls.

### Prohibited shortcuts

- Google Sheets or direct repository mutation;
- developer console;
- hidden API calls or direct HTTP calls outside the visible application;
- hardcoded synthetic values that bypass staff input/selection;
- test-only controls that would not exist in the intended operating workflow;
- relying on an engineer to interpret the next action.

### Operator questions

At every transition the operator must be able to answer, from the UI:

1. What is the current situation?
2. What do I need to do next?
3. Why is that the next action?
4. What is blocking other actions?
5. Who needs to act?
6. What happens if I click this twice?

If the UI cannot answer these clearly, the vertical slice fails even if the underlying API and unit/integration tests pass.

## 11. Current repository gap report

### Present foundations

- Local synthetic runtime, controlled services, immutable IDs, validation, money helpers, and audit logging.
- Requirements-first Bangkok tariff review and multiple candidate matching.
- Explicit staff selection; no automatic candidate selection.
- Draft quotation calculation/editor, internal cost separation, client-safe preview, print support, and pricing history.
- Quotation approval and client-acceptance gates.
- Booking creation from accepted quotation, lead-passenger requirement, commitment separation, and retry handling.
- Client payment evidence, verification authorization, allocation controls, Supplier Payable, Supplier Payment gate, refund draft controls, and several financial retry tests.
- Supplier Booking relationships, Booking Items, availability/fulfillment controls, amendments, and readiness issue records.
- Case selection, case header, inquiry queue, task view, document view, finance view, supplier view, and departure view in the local Operations Workspace.
- 147 automated tests currently pass (`npm.cmd test` on 2026-08-15).

### Partial areas

- Unified case orchestration: current `nextAction()` and `ensureAutomaticFollowUpTasks()` are useful projections/helpers but are not a formal transition engine or event-driven orchestration contract.
- Command Center: basic queue/count/next-action behavior exists, but not the complete stage/blocker/deadline/exception/owner projection.
- Quotation-to-Booking integrity: local versioned quotations, complete accepted-commercial snapshots, revision safety, duplicate protection, and amendment re-acceptance are implemented; public lifecycle and cross-surface evidence remain incomplete.
- Client-ready quotation: local preview exists; public Apps Script preview/acceptance exists; the full lifecycle and browser acceptance path are incomplete.
- Payment obligations: local authoritative post-Booking creation, duplicate protection, explicit allocation, and per-obligation balances are implemented; cross-surface and human workflow proof remain incomplete.
- Supplier fulfillment: service controls exist; supplier response deadlines and visible case-level exceptions need completion.
- Documents/readiness: records and manual readiness issues exist; generated checklist and derived document readiness are incomplete.
- Tasks: idempotent stage follow-up exists; event/deadline/owner/reminder orchestration is incomplete.
- Profit and completion: local projected/actual profit separation now exists with settlement gates; case-level closeout, waivers, and post-trip follow-up remain incomplete.
- Audit: generic event coverage exists; transition contract fields and derived projection audit evidence need standardization.

### Missing for the acceptance gate

- A formal transition contract and orchestration projection shared by runtime, Apps Script, and the Operations Workspace.
- Explicit quotation versions and version-specific lifecycle: Draft → Approved → Sent → Viewed → Change Requested → Revised → Accepted / Declined / Expired.
- Public quotation `Request changes` and `Decline` paths with safe token/version handling.
- Public/cross-surface proof that complete accepted Commercial Option and Booking snapshots preserve historical truth after later edits.
- Booking-triggered authoritative client obligations with duplicate prevention.
- Derived Command Center data for blockers, deadlines, exceptions, and responsible actor.
- Generated trip-document checklist and readiness projection from required records.
- Complete projected/actual profit model including fees and commissions with visible completeness state.
- A staff-only browser acceptance runner that does not depend on developer reset controls or hidden APIs.
- End-to-end transition tests asserting precondition, action, state change, derived next action, allowed/blocked actions, audit event, and retry behavior.

## 12. Acceptance decision rule

The vertical slice is **not accepted** when only module tests pass.

It is accepted only when:

1. every mandatory transition in Section 5 passes its full transition contract, including operational Completion;
2. the Command Center and case workspace answer the operator questions in Section 10;
3. all financial safety and snapshot rules pass;
4. failure and retry behavior is observable and safe;
5. the staff browser walkthrough succeeds without prohibited shortcuts; and
6. the result is reproducible from synthetic data without Google Workspace or live supplier access.

Until these conditions pass, no implementation expansion beyond this specification is authorized.

## 13. Evidence index

Current implementation evidence includes:

- `src/phase1/runtime.js` — local controlled workflow operations and invariants;
- `src/application/phase1.js` — application facade and current automatic follow-up helper;
- `app/public/operations.js` — local case header, queue, next-action chain, and focused workspaces;
- `app/public/operations.html` — current Operations Workspace navigation and views;
- `apps-script/WmitOperationsServices.gs` — Apps Script operations/finance facade;
- `apps-script/WmitBookingServices.gs` — acceptance, Booking, Supplier Booking, amendment, and readiness services;
- `apps-script/WmitPublicServices.gs` and `apps-script/PublicQuotation.html` — tokenized public quotation preview and acceptance;
- `tests/integration/phase1-vertical-slice.test.js` — current local vertical-slice safety tests;
- `tests/integration/phase1-targeted-safety.test.js` — state separation and UI context tests;
- `tests/integration/phase1-six-case-regression.test.js` — broader synthetic business regressions;
- `tests/integration/apps-script-workspace.test.js` — Apps Script boundary and public/finance service tests;
- `docs/stabilization-acceptance.md` — current local stabilization gate.
