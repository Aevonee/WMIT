# WMIT Security and Privacy

## Status

This is the proposed control baseline. It must be reviewed against the actual Google Workspace domain and staff roles before production use.

## Data sensitivity

Travel records may contain names, contact details, passport information, identity documents, payment evidence, travel plans, and supplier contracts. Treat passport data, identity documents, payment evidence, and sensitive communications as restricted.

## Access model

- Management: reporting and approved operational oversight.
- Operations: bookings, travelers, suppliers, departures, tickets, hotels, land, itineraries, and vouchers.
- Sales: leads, clients, quotations, and follow-ups.
- Finance: invoices, payments, receivables, payables, and margins.
- Interns: only assigned tasks and explicitly approved non-sensitive material.
- Agents: least-privilege access to the controlled functions needed for their role.

Google Drive sharing and spreadsheet protections should be configured by role. A future implementation must document the exact account groups and protected ranges.

## Rules

- Do not store API keys, OAuth tokens, passwords, or service credentials in source code, Git, or Sheets.
- Use Apps Script Properties or an approved secret mechanism for secrets.
- Do not log full passport numbers, payment credentials, or unnecessary document contents.
- Sanitize file names and user-provided text.
- Validate uploaded MIME types, size, and extraction output.
- Require approval before sending sensitive documents or changing financial records.
- Keep immutable audit records for meaningful actions.
- Use test data until permissions and recovery procedures are verified.

## Implemented local controls (Phase 2 hardening)

- The local action dispatcher (`/api/phase1/action`) only accepts an explicit whitelist of runtime business actions; infrastructure internals such as `updateRecord`, `createRecord`, `list`, and `snapshot` are never callable by action name.
- Refund execution (`executeRefund`) is manager-gated, requires `approval_confirmed: true`, only accepts a valid DRAFT refund, and is blocked unless verified client funds for the Booking cover the refund after supplier payments and prior refunds.
- Audit entries record old and new values for changed fields and record failure entries (with error codes) for rejected creates and updates.
- Updates accept an optional `expected_record_version` for optimistic-concurrency protection (`VERSION_CONFLICT` on stale writes).
- The local server can require a shared secret for mutating endpoints by setting `WMIT_MVP_ACTOR_TOKEN`; callers then send it in the `x-wmit-actor-token` header. Without the variable, the server remains loopback-only.

## Implemented Apps Script controls (Phase 2 hardening)

- Privileged server functions are underscore-suffixed, which hides them from `google.script.run`. Only `doGet` and the authenticated `web*` wrappers are callable from the deployed page. A regression test enforces this boundary.
- `initializeWmitLoginSystem_` is run once from the Apps Script editor by the deploying owner; an anonymous visitor can no longer initialize the login system first and take over the workspace.
- Passwords are stored with per-user salts and iterated SHA-256 stretching; the temporary administrator password is returned once from the editor execution result and never written to execution logs.
- The Audit Log sheet records old/new values for changed fields, failure entries, and compensating `ROLLBACK_CREATE` entries for rolled-back multi-record transactions.
- Booking creation and client payment recording run under the script lock and roll back partially created records when any later record fails.
- The public quote-request channel is rate limited per submitter and globally; idempotent retries are never blocked by the limiter.

## Implemented hosted-server controls (Phase 3)

- Sessions, not self-asserted actors: every API call (except sign-in and the public health endpoint) requires a Bearer session token. The runtime actor is `USER:<username>`, so audit entries name the human behind each change. `ADMIN` maps to manager+staff authority, `STAFF` to staff authority, `INTERN` is read-only at the HTTP boundary.
- Passwords use per-user salts with 2500-iteration SHA-256 stretching; failed sign-ins are rate limited (5 per 5 minutes per username); sessions expire after six hours of inactivity and are revoked server-side on logout.
- The audit log is hash-chained (`prev_hash`/`row_hash` per row). The hourly heartbeat re-verifies the chain and database integrity and records the result; any manual edit of history surfaces as `DEGRADED` in `/api/health`.
- Backups run nightly (01:15 Manila) via `VACUUM INTO`, are pruned to the last 30, and every backup is automatically rehearsed (opened read-only, integrity + record counts + audit chain verified) before it is trusted.
- Restores always keep a dated safety copy of the current database and refuse to run when the backup fails verification.
- The generated administrator password is written once to `data/initial-admin-password.txt` (mode 600) and never logged; when the operator supplies the password via `WMIT_ADMIN_INITIAL_PASSWORD`, no copy is written to disk.
- Without SMTP credentials, outgoing email degrades to reviewable `.eml` drafts in the outbox directory — nothing is silently dropped.
- Deployment (Caddy/TLS, systemd, staging separation) is documented in [deployment-netcup.md](deployment-netcup.md).

## Recovery

Before real-data rollout, define backup frequency, restore testing, retention, and who may restore data. Deletion should be avoided; archive status and the 99_ARCHIVE folder should be preferred where legally and operationally appropriate.
