# WMIT — Start Here

## What exists now

Phase 0 and Phase 1 are complete. The local Phase 2A operational model and Phase 2B document-intelligence/commercial prototype are now implemented. The repository contains:

- a discovery report
- the proposed architecture
- the proposed Google Sheets schema
- the proposed Google Drive structure
- the implementation roadmap
- project-specific operating rules
- local services, repositories, adapters, and automated tests
- a Version 1 operational data model and relationship map
- a local document classification, extraction-result, and normalization prototype
- preliminary Supplier Tariff and Supplier Booking models

Nothing has been written to Google Drive, Google Sheets, Gmail, Calendar, or a deployed Google Apps Script project.

## Read in this order

1. docs/DISCOVERY-REPORT.md
2. docs/phase-1-foundation.md
3. docs/operational-data-model.md
4. docs/data-relationships.md
5. docs/business-rules-unverified.md
6. docs/development-guide.md
7. docs/architecture.md
8. docs/database-schema.md
9. docs/drive-structure.md
10. docs/roadmap.md
11. docs/document-intelligence.md
12. docs/supplier-commercial-model.md
13. docs/supplier-bookings.md
14. AGENTS.md

## Important decisions to review

Please confirm or change:

1. The proposed Sheets schema and field names.
2. Whether a new WMIT operational spreadsheet should be created for testing.
3. Which Google account or Workspace domain owns the system.
4. Which staff roles need access, especially interns and finance users.
5. Whether the current invoice format and existing spreadsheets should be inspected before Phase 1.
6. Who may approve financial and external actions.

## How to authorize the next phase

To run the local foundation, use node scripts/run-tests.js.

The next project step is not production implementation. The six reference PDFs are not available as local files in this workspace, so their contents have not been extracted. When the main Google account and reference files become accessible, request read-only discovery first. Do not add production IDs or migrate data before that inspection.

After reviewing the documents, tell Codex:

    Proceed with read-only Google Workspace discovery when the main WMIT account is connected. Do not create or modify files.

If you want changes first, describe them instead. Phase 1 should not start from a simple request to “build everything”; it should start from an approved foundation scope.

## What Phase 1 did

Phase 1 implemented the minimum local foundation:

- Apps Script project structure
- configuration storage
- versioned local schema definition
- central ID generation
- validation and controlled service operations
- audit logging
- error handling
- setup and test instructions

It will not yet implement the full sales, invoicing, finance, PDF, itinerary, supplier, or agent systems.
