# WMIT Phase 0 Discovery Report

Date: 2026-08-12  
Workspace: D:\codex\wmit  
Status: Discovery complete; implementation not started

## Executive summary

The local WMIT workspace was empty at discovery time. It was not a Git repository and contained no existing code, Apps Script files, spreadsheet exports, templates, configuration, tests, or project notes. Therefore, there is no local business data to migrate and no existing implementation to preserve.

The available execution environment exposes connector capabilities for Google Drive, Google Sheets, Gmail, and Google Calendar, plus general web and document-related capabilities. Availability of a connector is not proof that a particular Google account, file, or Workspace domain is connected. No connected business data was read or changed during discovery.

## What was inspected

| Area | Result |
|---|---|
| Workspace files | None found |
| Workspace directories | None found before this Phase 0 package |
| Git repository | Not present |
| Existing Apps Script | Not provided |
| Existing spreadsheets | Not provided |
| Existing invoice/template files | Not provided |
| Local configuration | Not provided |
| Google Drive data | Not accessed |
| Google Sheets data | Not accessed |
| Gmail data | Not accessed |
| Calendar data | Not accessed |
| Available connectors | Drive, Sheets, Gmail, Calendar capabilities exposed |

## Initial constraints

- Approximately five staff users are expected.
- Google Workspace is preferred.
- Google Sheets is intended to be the operational database.
- Google Drive is intended to store documents.
- Existing business data must not be overwritten or migrated without inspection and approval.
- The owner is not a programmer, so setup and operating instructions must be copy/paste-friendly.
- Financial and externally consequential actions require human control.

## Recommended initial shape

Use one WMIT operational spreadsheet with normalized sheets, one WMIT Drive root, and a small Apps Script service layer. Begin with idempotent setup, central IDs, validation, logging, and a schema test. Add business workflows only after the foundation is verified.

The first production candidate should be invoicing, but only after master data, quotations, bookings, and payment relationships are stable enough to prevent duplicate or orphaned financial records.

## Risks discovered

1. Existing operational data is unknown. A migration design cannot be finalized until current spreadsheets, invoice formats, and Drive folders are inspected.
2. Permissions and approval ownership are unknown. Staff, finance, management, and intern access must be mapped before real-data rollout.
3. Google Workspace connector access is not yet verified for the intended owner account.
4. The schema is broad because WMIT covers multiple business lines. Building every table and agent at once would increase maintenance and data-quality risk.
5. PDF extraction and travel search involve uncertain data and external service limits; they should be staged after the core records are reliable.

## Owner approvals needed

- Approve or revise the proposed architecture and schema.
- Confirm the Workspace account or domain that will own the system.
- Provide existing invoice, quotation, and operational spreadsheet references for inspection.
- Confirm staff roles, finance approvers, and intern restrictions.
- Decide whether Phase 1 should use a new test spreadsheet and Drive root.

## Phase 0 deliverables

- architecture.md
- database-schema.md
- drive-structure.md
- roadmap.md
- AGENTS.md
- START-HERE.md
- repository placeholders for Apps Script, agents, adapters, configuration, templates, and tests

## Boundary of this report

This report records what was discoverable locally and what was intentionally not accessed. It is not a claim that the owner has no existing Google Workspace data. That data must be inspected through an explicitly connected account in a later, read-only discovery step.
