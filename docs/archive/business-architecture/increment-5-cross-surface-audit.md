# Increment 5 — Cross-Surface Audit and Local Operations Workspace Adoption

Date: 2026-08-15

## Scope

Increment 5 is limited to making the local Operations Workspace consume the existing generic domain, Case Projection, commercial snapshot, and financial controls. It is not a cosmetic redesign and it does not expand the finance model.

Google Workspace remains unavailable in Phase 2A. No Apps Script deployment, spreadsheet, Drive, Gmail, or production data was accessed.

## Audit findings before implementation

The local Operations Workspace had duplicate interpretations of the workflow: raw-record stage reconstruction, hardcoded Booking Item creation, allocation without an authoritative obligation target, legacy schedule creation, and implicit automatic-task mutation on refresh.

The Apps Script workspace has a separate older implementation with duplicate stage, finance, quotation, and Booking paths. It has no shared Case Projection endpoint, and its Booking path does not yet use the local accepted-commercial snapshot contract.

## Implemented local changes

- Application snapshots now include read-only `caseProjections`, derived from generic runtime records.
- Operations Workspace header and inquiry queue next-action behavior use projection-derived data.
- Booking services are copied through a controlled `createBookingItemsFromAcceptedSnapshot` action. The browser no longer invents a `PACKAGE` item or copies mutable quotation totals.
- Payment-schedule entry uses `createBookingPaymentObligations`.
- Allocation requires a selected `client_obligation_id` and sends that target to the guarded backend action.
- Finance workspace displays per-obligation allocation/outstanding state and projection-derived finance/readiness information.
- Automatic follow-up mutation is no longer run implicitly on every workspace refresh.

## Deliberate parity boundary

Apps Script adoption is not part of this local increment. Porting the projection a second time into the older Apps Script stack would create another orchestration implementation while Google Workspace is explicitly unavailable. The next Apps Script increment must first define a migration/parity plan, then route web actions through the same generic contract or a documented equivalent.

## Verification

- Full local suite: 149 passing, 0 failing.
- Added regression coverage for application projection snapshots and Operations Workspace adoption markers.
- Automated tests do not replace the required non-developer browser walkthrough. The V1 human acceptance gate remains open.
