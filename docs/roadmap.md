# WMIT Implementation Roadmap

The repository contains several historical phase labels from earlier planning passes. The current executable status is defined by [stabilization-acceptance.md](stabilization-acceptance.md): a local synthetic vertical slice undergoing stabilization and owner acceptance.

The sequence below is intentionally staged. Each phase ends with tests, documentation, and an owner review before the next phase.

Phase 2A/2B and the historical Phase 3A/3B prototypes are implemented locally. Phase 3C attendance work is also local and read-only by design. Everything remains preliminary; no Google Workspace resource has been modified. Do not begin the next expansion until the stabilization and acceptance gate is complete.

| Phase | Scope | Exit evidence |
|---|---|---|
| 0 | Discovery and design | Approved architecture, schema, Drive plan, and roadmap |
| 1 | Foundation | Idempotent setup, configuration, IDs, validation, logging, Drive/Sheets utilities, tests |
| 2 | Master data | Clients, contacts, travelers, suppliers, products, packages, settings with sample data |
| 3 | Leads and sales | Lead sources, client conversion, quotations, follow-ups, B2B accounts |
| 4 | Invoicing | Draft-to-approved invoice workflow, numbering, PDF/Drive output, invoice links |
| 5 | Payments and finance | Payments, balances, receivables, payables, approvals, reports |
| 6 | PDF intelligence | Ingestion, classification, extraction, confidence, matching, human review |
| 7 | Itineraries | Template-based Google Docs and PDF generation |
| 8 | Operations | Bookings, departures, readiness control tower, audits, confirmations, passengers |
| 9 | Vouchers | Generated and normalized hotel, transfer, tour, and package vouchers |
| 10 | Tariffs | Structured supplier tariffs, validity, comparisons, quotation integration |
| 11 | Marketing and expos | Campaigns, expo preparation, lead capture, follow-up, reporting |
| 12 | Interns | Restricted intern profiles, tasks, training, review, reporting |
| 13 | Travel search | Evaluate and implement appropriate authorized sources or adapters |

## Phase 3C attendance integration

Planned component only — not implemented:

1. Preserve the existing attendance web app and Attendance Log as the capture system and source of truth.
2. Perform read-only Workspace discovery when access is available.
3. Use a configurable read-only Apps Script API adapter for Attendance Log and Active Roster; the gateway maps by header name rather than fixed column positions.
4. Map attendance names to stable WMIT Person IDs without changing historical source rows.
5. Build rebuildable raw-event references, daily summaries, and review exceptions.
6. Provide role- and branch-aware monitoring views without exposing selfie links through general dashboards.
7. Define attendance-policy inputs before presenting absence, lateness, or attendance-rate calculations as final.
8. Keep a feature flag, reconciliation check, backup, and rollback path before any production enablement.

This component does not rebuild attendance capture, add Time In/Time Out controls to WMIT Operations, or authorize changes to the existing attendance spreadsheet.

The local monitoring layer and adapter contract are implemented. Real Google access remains a separate enablement gate:

- `ATTENDANCE_MONITORING_ENABLED` and `ATTENDANCE_GOOGLE_SOURCE_ENABLED` are false by default.
- The Attendance spreadsheet ID remains inside the existing attendance Apps Script; WMIT stores only the API URL and key ID, with the HMAC secret supplied through the server environment.
- Attendance reads require an injected server-side API client implementing `getAttendanceEvents()` and `getRoster()`.
- A configured fallback can show clearly labelled Demo Data after a Google read failure; silent fallback is disabled by default.
- No Google credentials, OAuth tokens, or browser-side spreadsheet IDs are stored or exposed.

## Phase 2B / 2C local prototype

Implemented locally:

1. Preliminary document taxonomy and source classification.
2. Extraction-result objects separate from permanent records.
3. Conservative normalization for common travel values.
4. Optional local text/PDF adapter with failure-safe behavior.
5. Supplier Tariffs, Supplier Bookings, Supplier Booking Items, Invoice Bookings, and Document Links in the executable schema.
6. Commercial lifecycle guards, deterministic relationship validation, exact money helpers, and review-only match suggestions.
7. Synthetic workflow scenarios covering WMIT quotation → booking → supplier-side records → invoice → payments and document links.

Still blocked:

- validating the preliminary model against WMIT's actual spreadsheets, invoice format, quotation format, and operating practice;
- deciding how WMIT stores rooming, supplier references, deposits, amendments, refunds, and confirmations;
- connecting to Drive, Gmail, Sheets, or production data.

## Phase 3A local Operations MVP

Implemented locally:

1. Application-layer actions for Lead → Quotation → Booking → Supplier Booking → Invoice → Payment.
2. Minimal browser UI and local JSON server in `app/`.
3. Synthetic deterministic demo data reset on each server start.
4. Dashboard counts and connected booking/finance views.
5. User-friendly error responses, audit logging, lifecycle enforcement, and exact-money payment handling.

The MVP is a proof of usability and service boundaries, not a deployment or production application.

## HR and Payroll Officer specialist

Phase 3C now includes a read-only HR and Payroll Officer capability for attendance monitoring. It uses the existing AttendanceService and cannot write attendance, access selfies, change the roster, or calculate payroll. Payroll and HR automation remain blocked pending verified WMIT policy, permissions, and data requirements.

## Phase 3B manual quotation editor

Implemented locally:

1. Internal quotation editing with service lines, supplier/cost data, selling prices, discounts, fees, tax, terms, and notes.
2. Add, edit, reorder, and remove quotation items with deterministic recalculation.
3. Deliberately filtered client-facing preview using text-based WMIT branding.
4. A4 browser print stylesheet; no PDF generation or email.
5. Dependency-free quotation calculation/preview module and controlled Apps Script facade.

The approved WMIT quotation PDFs were used as content and hierarchy references. No supplier document or logo was used as the WMIT template.

Recommended next step remains read-only Google Workspace discovery when access is available. Before any production workflow, compare the MVP fields, quotation preview, invoice/quotation behavior, permissions, and persistence requirements against real WMIT practice.

## Phase 1 implementation plan

The local foundation has now been implemented. Google Workspace setup and migration remain intentionally outside this phase because the owner's account is not available.

1. Define and version the local schema.
2. Build local configuration, IDs, validation, repositories, services, adapters, and audit logging.
3. Add synthetic fixtures and automated tests.
4. Document the future Workspace discovery and integration gate.
5. After Workspace access is available, separately inspect the account and choose a test spreadsheet/folder.

## Definition of done for every phase

- Requirements and data relationships are documented.
- Valid, invalid, duplicate, and retry cases are tested.
- Sensitive and financial actions have approval checks.
- Meaningful actions are logged.
- Failures are observable and recoverable.
- Beginner-friendly setup and operating instructions exist.
- The owner reviews the result before the next phase.

## Recommended priority

Recommended next step: complete [stabilization-acceptance.md](stabilization-acceptance.md), including the owner browser walkthrough. When the main Google account is available, perform read-only Workspace discovery and compare it against real sheets/templates before implementing production repositories or workflows.

Phase 3B.1 remains focused on quotation hardening: atomic proposed-state validation, one-currency quotations, reliable Lead selection, responsive print layout, exact money limits, the official WMIT header, and a small structured day-by-day itinerary editor. Quotations remain separate from confirmation invoices. PDF generation and Google Workspace persistence remain later phases.
