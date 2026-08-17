# WMIT Architecture

## 1. Purpose

WMIT will coordinate leads, clients, quotations, bookings, supplier procurement, payments, documents, travel outputs, departures, staff work, and management reporting for Worldmaster International Travel.

## 2. Target architecture

    Owner and staff
            |
            v
    Manager / specialist agents
            |
            v
    Controlled WMIT Apps Script API
            |
       +----+-------------------+
       |                        |
       v                        v
    Google Sheets          Google Drive
    structured records     files and outputs
       |                        |
       +------------+-----------+
                    v
            Audit log and reports

Gmail, Calendar, document processing, and travel-source integrations sit behind explicit adapters. Agents may recommend or draft actions, but Apps Script validates and commits changes.

## 3. Source-of-truth rules

Google Sheets is the source of truth for structured business records. Google Drive stores PDFs, source documents, generated Docs, generated PDFs, tickets, vouchers, and supporting files. Drive metadata and file names link files back to record IDs, but a file is never the authoritative record for a client, booking, invoice, or payment.

## 4. Application layers

### Configuration

Stores the WMIT root folder ID, child-folder IDs, operational spreadsheet ID, environment, numbering settings, approval settings, allowed values, and template IDs. Secrets are not stored here.

### Data access

Provides safe read and write functions for Sheets. It validates sheet names, columns, IDs, row versions where needed, and controlled updates.

### Domain services

Provides functions such as createLead, createQuotation, createBooking, createInvoice, and recordPayment. Domain services enforce relationships, duplicate prevention, status transitions, and audit entries.

### File services

Searches or creates Drive folders idempotently, stores files with metadata, applies safe names, and records file IDs against structured records.

### Agent orchestration

The Manager delegates to specialists. Agents use domain services and report source records, confidence, conflicts, and required approvals. An agent is not a second database and cannot bypass validation.

### Adapters

Adapters normalize Gmail attachments, uploaded files, PDFs, authorized travel sources, and future MCP tools into WMIT structures. An adapter must identify its source, timestamp, confidence, and limitations.

## 5. Core information flow

    Lead -> Client -> Quotation -> Booking -> Supplier procurement
                                      |
                                      +-> Invoice -> Payments -> Receivables
                                      |
                                      +-> Travelers -> Tickets / hotels / land
                                      |
                                      +-> Itinerary -> Vouchers -> Departure readiness

Records should be created once and referenced by immutable IDs. The system should generate later outputs from existing records instead of requiring staff to re-enter the same information.

## 6. Risk boundaries

Draft generation, organization, extraction, reporting, and missing-data detection are low-risk capabilities. Sending invoices or messages, modifying bookings, and updating suppliers are medium-risk. Refunds, financial adjustments, purchases, external bookings, deletion, and sensitive external communication are high-risk and require explicit confirmation.

## 7. Reliability requirements

- Setup is idempotent and safe to retry.
- Writes validate before mutation.
- Duplicate prevention uses stable business keys and IDs.
- Important writes are audited.
- Failures return actionable errors and do not partially commit where practical.
- Extraction stores confidence and never silently commits uncertain matches.
- Financial changes use approval checks and preserve an audit trail.

## 8. Local Phase 1 implementation

The local implementation uses pure JavaScript services with dependency-injected repositories. InMemoryRepository and InMemoryAuditLog make the foundation testable without Google Workspace. The Apps Script layer now contains a fresh-Workspace bootstrap and controlled Sheets persistence boundary, but it has no account IDs or credentials in the repository and is not connected until deployed by the owner. The bootstrap fails closed on schema mismatch and never deletes or overwrites existing content.

## 9. Deliberate non-goals for Phase 1

Phase 1 does not implement live travel search, web scraping, PDF intelligence, all specialist agents, automatic external booking, or migration of existing business data. Those features depend on verified requirements, permissions, source access, and reliable core data.

## 10. Open design decisions

- Whether to use one operational spreadsheet or separate operational and reporting spreadsheets.
- Exact staff roles and Workspace sharing model.
- Existing invoice and quotation template compatibility.
- Approval thresholds for financial actions.
- Whether Apps Script is sufficient for document extraction or an optional external processor is justified.
