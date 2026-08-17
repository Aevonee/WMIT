# WMIT MCP and Connector Plan

## Discovery result

The execution environment exposes capabilities for Google Drive, Google Sheets, Gmail, and Google Calendar. General web and document capabilities are also exposed. A capability being present does not confirm that the intended WMIT Google account is connected. No external account data was accessed during Phase 0.

## Planned integrations

| Integration | Purpose | Data accessed | Write permissions | Fallback |
|---|---|---|---|---|
| Google Drive | Search, create, organize, and export WMIT files | Folder/file metadata and approved contents | Create/update files and folders after approval | Manual Drive organization |
| Google Sheets | Read and write controlled operational tables | WMIT spreadsheet only | Controlled row and header updates | Manual spreadsheet operations |
| Gmail | Ingest approved attachments and draft messages | Approved mailbox searches and attachments | Draft first; send only with confirmation | Manual upload or copy |
| Google Calendar | Deadlines, appointments, departures, and reminders | Approved WMIT-related events | Create/update events after confirmation | Tasks and Sheets deadlines |
| Document/PDF tools | Extract and normalize documents | Files explicitly submitted for processing | No business-record commit without review | Manual data entry |
| Web/travel sources | Research options and source citations | Public or authorized source results | No automatic booking | Supplier documents and manual research |

## Least privilege

Use only the connector and scopes required for the current phase. Phase 1 should need Drive and Sheets setup access, not Gmail, Calendar, or travel-search access. Add write access only when a workflow has been tested and approved.

## Integration rules

- Record source, retrieval time, and limitations for external results.
- Treat search results as research, not bookings.
- Never claim live availability or pricing without a verified current response.
- Use idempotency keys or stable source references for retries.
- Log connector failures without exposing sensitive payloads.
- Provide a manual fallback for every important integration.

## Approval gate

Before enabling each integration, document the account, scopes, data accessed, write actions, retention, failure behavior, and owner approval.
