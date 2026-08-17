# WMIT Operations — Phase 3A/3B local prototype

Status: local vertical slice only; not production-ready.

## What this is

This phase provides a small browser application proving the core commercial path with synthetic data:

```text
Lead
  → Quotation
  → Booking
  → Supplier Booking(s)
  → Invoice
  → Payment(s)
```

The application runs entirely in memory. Restarting the local server resets the demo data. No Google Workspace, Drive, Sheets, Gmail, Calendar, external supplier, or real business data is used.

## How to run

From the project folder:

```text
node scripts/run-mvp.js
```

The equivalent npm command is `npm.cmd run start:mvp` on Windows.

Open `http://127.0.0.1:3000` in a browser. The port can be changed with `WMIT_MVP_PORT`.

The page begins with a clearly synthetic workflow containing one Lead, Quotation, Booking, two Booking Items, two Supplier Bookings, one Invoice, two client receipts, and one supplier payment. The demo invoice has a synthetic outstanding balance of PHP 6,000, and the first Supplier Booking has a remaining balance of PHP 3,000.

## Views and actions

- Dashboard: counts of open leads, quotations requiring action, active bookings, and invoice balances.
- Lead view: list leads and create a basic lead.
- Quotation view: explicitly create a quotation from a selected Lead and add quotation items.
- Booking view: explicitly create a Booking and Booking Items from a selected Quotation; inspect travelers and related records.
- Supplier Booking view: explicitly create a Supplier Booking from an unassigned Booking Item. Already-linked items are removed from the selector so duplicate relationship errors are avoided. Multiple supplier bookings are allowed across booking items.
- Invoice view: explicitly create an Invoice from a Booking using InvoiceBooking and Invoice Items.
- Payment view: explicitly record multiple Payments against an Invoice and display the updated balance.
- Supplier payment view: explicitly record Payments TO_SUPPLIER against a Supplier Booking and reduce its recorded supplier balance. The supplier bookings table is displayed directly below the supplier-booking form in Operations; the payment forms and payment ledger are grouped under Finance.

The UI displays structured service errors as plain-language messages. Invalid controls receive a red outline and an inline explanation; the page scrolls to and focuses the first invalid control automatically. View buttons load a visible detail card and scroll to it. It does not expose stack traces.

## Service boundary

The browser calls the local HTTP application boundary in `app/server.js`. The server calls `src/application/operations-mvp.js`. That application layer calls the existing controlled entity services. The UI does not import or manipulate repositories.

```text
Browser UI
  ↓ HTTP JSON actions
Local application layer
  ↓ controlled entity services
Validation + lifecycle + audit
  ↓ repository interface
In-memory repositories
```

The eventual Google Sheets adapter remains below the repository boundary and is not involved in this phase.

## Read-only attendance monitoring

WMIT Operations also includes an Attendance section backed by a read-only adapter boundary. The local MVP uses synthetic attendance fixtures so the dashboard, history filters, identity mapping, and exception detection can be tested without Google Workspace. The existing attendance app and Attendance Log remain outside this application and remain authoritative.

The monitoring projection surfaces duplicate punches, incomplete pairs, overnight records, unknown people, name variations, and conflicting sequences. It does not repair source rows, expose selfie links in general dashboard responses, calculate payroll, or apply unverified lateness/absence policy. The Google Sheets attendance adapter remains disabled until read-only Workspace validation is approved.

## Explicit actions

### Create quotation from Lead

Copies the Lead relationship and appropriate inquiry fields: client/contact references when known, destination, travel dates, pax, currency, and the quotation date. It creates a new immutable Quotation ID and does not close or delete the Lead.

### Create Booking from Quotation

Copies the quotation reference, client/contact, travel dates, destination, pax, currency, client total, and supplier-cost total. It explicitly creates new Booking Items from the selected Quotation Items. Quotation Item IDs are retained as source references; new Booking Item IDs are generated.

### Create Supplier Booking from Booking Item

Creates a separate Supplier Booking and a SupplierBookingItem relationship. It copies the service description, supplier, cost, and currency as defaults, while allowing the user to provide supplier reference, deposit, balance, and deadlines.

### Create Invoice from Booking

Creates Invoice, InvoiceBooking, and Invoice Items explicitly. Invoice totals are calculated from Booking Items plus entered fees, discount, and tax. Invoice status remains an explicit input; creating a draft does not imply that it was sent.

### Record Payment from Invoice

Creates a Payment, recalculates the invoice balance using exact minor-unit arithmetic, and updates the payment totals. Payments cannot overpay an invoice or use a different currency. Draft invoices retain Draft status; Sent/Partially Paid/Overdue invoices can move to Partially Paid or Paid.

### Record Payment to Supplier

Creates a separate Payment with direction `TO_SUPPLIER`, linked to a Supplier Booking and Supplier. It does not affect client invoice balances. The recorded Supplier Booking balance is treated as the current balance and is reduced only after the payment is successfully saved; prior supplier payments are not subtracted a second time. Overpayment is rejected with balance details.

### Generated IDs after demo data

The local service reserves explicitly supplied fixture/demo IDs before generating new IDs. This prevents the first user-created record after startup from colliding with a seeded ID. This remains process-local and is not a production allocator; persistence and concurrency controls are still required before real use.

## Status handling

Existing preliminary lifecycle transitions remain enforced by the service layer. The MVP does not invent a new state machine, auto-approve quotations, send invoices, or communicate externally.

## Audit

All entity mutations go through the existing service layer and are recorded in the in-memory audit log. The UI does not provide a production audit-log viewer. Restarting the server clears the local audit log.

## Attendance monitoring integration

The Attendance section is read-only. The existing attendance Apps Script and its `Attendance Log` remain authoritative. WMIT Operations now contains a replaceable `GoogleSheetsAttendanceAdapter` contract that calls a purpose-built authenticated Apps Script API for date-ranged events and roster data, then feeds the existing identity-map and rebuildable projection layer. The local server still uses Demo Data by default. Real Google access has not been tested because the Apps Script endpoint has not been deployed and no API secret is configured in this runtime.

Enablement requires the Apps Script API URL, server-side HMAC credentials, `ATTENDANCE_MONITORING_ENABLED`, and `ATTENDANCE_GOOGLE_SOURCE_ENABLED`. WMIT does not need or store the Attendance spreadsheet ID. Both flags are false by default. The optional demo fallback must also be explicitly enabled; otherwise a failed API read is shown as unavailable rather than silently substituted.

For the local launcher, the Apps Script API client is selected only when one of these server environment variables is present: `WMIT_ATTENDANCE_API_URL`, `WMIT_ATTENDANCE_API_KEY_ID`, or `WMIT_ATTENDANCE_API_SECRET`. The secret is never placed in configuration files or browser code. If the variables are incomplete, the source reports Unavailable rather than silently switching to Demo Data.

`WMIT_ATTENDANCE_API_URL` must be the complete deployed web-app URL, for example `https://script.google.com/macros/s/DEPLOYMENT_ID/exec`; the deployment ID by itself is not a URL. If WMIT reports invalid JSON and the response was an HTML page, update the Apps Script web-app deployment to the version containing `AttendanceApi.gs`, use the `/exec` URL, set the web app to execute as the owner, and grant the web-app access level needed for the server request. The HMAC key ID and secret remain server-side only.

No source rows are written, and selfie links are excluded from general dashboard/history responses. Payroll, overtime, leave, lateness policy, and absence policy remain outside this MVP.

## Intentionally not implemented

- Google Sheets/Drive persistence
- authentication and multi-user permissions
- client/traveler/supplier master-data screens
- document upload or PDF processing UI
- itinerary, voucher, departure, or readiness management

## Phase 3B.1 hardening

- Quotation updates validate the proposed full quotation and recalculated totals before writing. Invalid discounts do not partially modify a quotation.
- Quotation items must use the parent quotation currency. Mixed currencies are rejected without automatic conversion.
- The newly created Lead ID remains selected for immediate quotation creation; selection does not depend on list order.
- The initial quotation form captures currency, destination, travel dates, and pax.
- The client-facing quotation summary omits a blank or zero discount line.
- The quotation header is responsive and print-safe so the WMIT logo and quotation title remain within the A4 layout.
- The quotation uses the supplied official WMIT `header.png` asset. It remains a quotation/proposal artifact; invoice creation and payment tracking remain separate Finance operations.
- The quotation editor supports structured day cards with separate activities, meals, overnight, city/date, and notes fields. The local prototype keeps backward compatibility with older free-text itineraries.
- email, Calendar, payment reminders, supplier communication
- accounting, refunds, reconciliation, tax calculations
- AI agents or chat
- persistent database, backups, or deployment hardening

## Known UX limitations

The page is intentionally a functional prototype. It has a single-page layout, limited filtering, no pagination, no edit forms for every entity, minimal confirmation dialogs, and no browser authentication. A production UI must add access control, persistence, concurrency handling, and stronger review/approval flows before real data is used.

## Business-rule limitations

The application preserves the preliminary flexibility of the data model. It does not decide whether a quotation must become a booking, whether invoices span multiple clients, how deposits/refunds/amendments are represented, or how WMIT approves financial changes. Those remain open until real WMIT workflow discovery.
