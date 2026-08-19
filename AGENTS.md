# WMIT Project Instructions

These are the project-specific rules for building the Worldmaster International Travel operating system. They supplement the user's general instructions and are the source of truth for this repository.

## Mission and scope

WMIT is an AI-assisted operating system for a Philippine travel agency handling inbound and outbound travel, Worldmaster-owned departures, wholesaler products, tour-operator land arrangements, custom travel, document processing, interns, and B2B/B2C expos.

The target operating environment is now the **hosted WMIT server**: a Node.js application with a SQLite database running on the owner's VPS (netcup), fronted by Caddy for HTTPS. Email is sent through the owner's domain mailbox via SMTP. The original Google Workspace design (Sheets as the structured store, Apps Script as the automation layer) is retained as a working artifact under `apps-script/` but is no longer the deployment target.

The system should reduce re-entry and manual coordination while preserving human control over customer, financial, supplier, booking, and sensitive-document decisions.

## Architecture rules

- The hosted server's SQLite database is the structured source of truth. Backups are automatic, verified, and rehearsed.
- The runtime exposes controlled business functions through one whitelisted action dispatcher. Agents must not randomly edit records or invent alternate data stores.
- Existing business spreadsheets and files are read-only until inspected and explicitly approved for migration or replacement.
- Keep external integrations optional and behind adapters. Never make WMIT dependent on one travel website or one mail provider.
- Never claim live availability, current pricing, or confirmed travel arrangements unless an authorized source actually returned and verified them.

## Data and ID rules

- Important records receive centrally generated, immutable IDs.
- IDs are unique, human-readable, and logged. Year-based IDs use the business timezone and a transactional counter.
- Record creation and updates must validate required fields, relationships, status transitions, and duplicate risks.
- Structured data must link to related records by immutable IDs, not names alone.
- Files should carry relevant metadata for client, lead, booking, departure, invoice, voucher, document, or supplier IDs.
- Financial values must retain supplier cost, client price, fees, payments, receivables, payables, commissions, and margin as separate concepts.

## Drive rules

- Search for an existing root folder named WMIT before creating one.
- Never create duplicate root folders and never hard-code folder IDs throughout the codebase.
- Store the root ID and child-folder IDs in configuration.
- Initialization must be idempotent: running it twice should not create duplicates.
- Use safe file names and avoid unnecessary personal information in names.
- Do not delete or overwrite files as part of setup.

## Controlled API rules

Business functions should validate inputs, validate IDs, prevent duplicates, write audit logs, handle errors, and return useful structured results. Planned functions include client, lead, quotation, booking, passenger, departure, supplier, invoice, payment, document, itinerary, voucher, task, expo, intern-task, and operational-audit functions.

AI agents should call these controlled functions rather than directly changing Sheets. High-impact operations must support a dry-run or draft mode where practical.

## Agent responsibilities

- Manager: cross-functional prioritization and delegation; never invents facts.
- Sales: leads, clients, quotations, follow-ups, B2B/B2C sales.
- Operations: bookings, passengers, departures, supplier confirmations, tickets, vouchers.
- Finance: invoices, payments, receivables, payables, commissions, margins; financial changes require approval rules.
- Documents: ingestion, classification, extraction, matching, confidence, and human review.
- Itinerary: structured travel information into editable Docs and PDFs.
- Voucher: structured or normalized supplier vouchers.
- Supplier and tariff: supplier records, procurement, rates, validity, and performance.
- Marketing and Expo: campaigns, expos, lead capture, and follow-up.
- Document-processing: requirements, deadlines, cases, and status.
- Intern: restricted tasks, training, attendance, and supervisor review.

Agents must state when information is unavailable, conflicting, or uncertain. Low-confidence extraction must be flagged instead of silently committed.

## Approval and safety rules

- Low risk: organization, drafts, extraction, missing-data checks, internal tasks, and reports.
- Medium risk: invoice generation or sending, client email, reminders, booking changes, and supplier updates require confirmation according to configured policy.
- High risk: refunds, financial adjustments, deletion, external bookings, supplier purchases, major commitments, sensitive documents, and sensitive external communication always require explicit human confirmation.
- Never silently modify payment amounts, invoice totals, refunds, supplier costs, or payment statuses.
- Never perform destructive changes without confirmation.
- Every meaningful automated action records timestamp, user, agent, action, record ID, old value where applicable, new value where applicable, result, and error where applicable.

## Security rules

- Use least privilege and separate staff, finance, management, and intern access.
- Do not put secrets, API keys, credentials, or tokens in source code, Git, or Sheets.
- Avoid unnecessary personal data in logs and file names.
- Restrict sensitive documents and finance operations.
- Validate and sanitize uploaded files and extracted values.
- Treat AI output as untrusted until validated against WMIT data or an approved source.

## Testing rules

Every module requires tests for valid input, missing input, invalid IDs, duplicates, conflicting data, retries, partial failures, permissions, audit logs, and recovery. Test with synthetic data before real business data. A script executing without an exception is not sufficient evidence of correctness.

## Documentation rules

Update the documentation when architecture, schema, permissions, approval rules, or workflows materially change. Keep beginner-friendly setup instructions with exact locations, expected results, and troubleshooting guidance.

## Current phase

Phase 3 — hosted-server foundation complete and expo preparation. The SQLite-backed hosted server (`npm start`, `src/server/`) is the deployment target: session authentication, hash-chained audit, scheduler with nightly verified backups, and staging/production environments. Deployment home (owner decision, Aug 19 2026): **netcup Webhosting 4000 via Plesk Node.js/Passenger** — see `docs/deployment-webhosting.md`; the VPS guide (`docs/deployment-netcup.md`) is retained as the alternative. Google Workspace: the owner now holds the Google account credentials (since Aug 18 2026), but access is deliberately deferred — do not access or configure the account until the owner green-lights it after the VPS migration; when opened, it is for read-only inventory and approved migration only. `apps-script/` remains a retained working artifact, not the target. The immediate business deadline is the September 4–6 expo; expo lead capture, quote delivery, and follow-up tooling take priority over further architecture work until it ships.
