# WMIT Phase 3C Attendance Integration Architecture

**Status:** Local read-only implementation complete; Apps Script attendance API adapter implemented and production deployment remains unverified

**Scope:** Read-only attendance monitoring for WMIT Operations using the existing attendance web app and its Google Spreadsheet.

This document describes the integration boundary. It does not authorize changes to the attendance app, Google Sheets, Google Drive, or WMIT production data.

The local implementation includes a mock source provider, a strictly read-only Apps Script API adapter boundary, identity map, rebuildable projection, exception detection, service endpoints, and an Attendance section in WMIT Operations. The adapter has been tested with a controlled fake API client. No real Google resource has been read or written from this project.

The WMIT configuration does not contain the Attendance spreadsheet ID. That identifier remains inside the existing attendance Apps Script, which is the only component that opens the source spreadsheet. Both WMIT attendance feature flags remain disabled by default.

## Executive recommendation

Keep the existing attendance app and `Attendance Log` as the attendance capture system and source of truth. WMIT Operations should consume attendance data through a read-only adapter and build a clearly labelled monitoring projection for dashboards.

The recommended path is a **hybrid architecture**:

1. Begin with a read-only pull through a purpose-built endpoint in the existing attendance Apps Script. This requires no change to the attendance capture workflow and avoids direct Sheets API access from WMIT Operations.
2. Normalize and process the pulled events inside a separate WMIT reporting/projection layer. This is not a second capture system and must always retain the source row reference.
3. Consider an optional push or incremental event endpoint only if later evidence shows that polling latency, spreadsheet quotas, or scale is a real problem. That change would require a separately approved modification to the attendance app.

The first release should be read-only, feature-flagged, and reversible.

## Local adapter contract

`src/adapters/google-sheets-attendance-adapter.js` is the only application-facing implementation of the Google attendance source. It accepts an injected server-side Apps Script API client with these methods:

- `getAttendanceEvents({ from, to })`
- `getRoster()`

The Apps Script endpoint reads the header row dynamically. WMIT Operations does not receive direct SpreadsheetApp or Sheets API access, does not expose a spreadsheet ID in metadata, and does not provide append, update, delete, or formatting methods. `MockAttendanceSourceAdapter` remains available for local demo data. A configured `FallbackAttendanceSourceAdapter` can show clearly labelled Demo Data when the API fails; fallback is not enabled by default.

## 1. Attendance source of truth

The existing attendance system remains authoritative because it is the system staff already use to record attendance, it owns the capture interaction and selfie link, and changing it during WMIT Operations development would create two competing workflows.

The existing `Attendance Log` currently contains:

| Column | Treatment |
|---|---|
| Timestamp | Preserve raw value; normalize a copy to the WMIT business timezone |
| Employee Name | Preserve raw value; resolve to a stable WMIT Person ID through a mapping |
| Role | Preserve as observed; do not assume it is the authoritative HR role |
| Branch | Preserve as observed and use for historical filtering |
| Action | Preserve the current `Time In` / `Time Out` value |
| Selfie Link | Treat as restricted sensitive metadata; never expose in a general dashboard |

WMIT Operations must not:

- create a second Time In or Time Out button;
- edit, delete, or silently correct source attendance rows;
- treat a processed daily summary as a replacement for the raw log;
- claim that a missing event was present merely because a daily calculation filled a gap.

An attendance dashboard is a derived view. Every derived event or summary should retain the source spreadsheet identity and source row reference where available.

## 2. Integration options

### A. WMIT Operations reads the Google Sheet directly

This was the earlier design and is no longer selected. WMIT does not receive direct Sheets API access for attendance.

Advantages:

- leaves the existing attendance app unchanged;
- preserves a single capture system and source of truth;
- simple to pilot and disable;
- easy to rebuild derived summaries from the source log.

Risks:

- requires cross-spreadsheet permission and careful handling of spreadsheet IDs;
- polling can be affected by Apps Script quotas and spreadsheet size;
- WMIT is coupled to the current sheet names and column layout unless the adapter has configurable mappings;
- dashboard freshness is limited by the read schedule.

### B. The attendance Apps Script pushes normalized events to WMIT Operations

The attendance app sends an event to a WMIT endpoint or queue after a successful capture.

Advantages:

- near-real-time updates;
- less repeated reading of a growing spreadsheet;
- the attendance app can provide a stable source event ID.

Risks:

- requires changing and deploying the existing attendance app;
- introduces retries, authentication, duplicate delivery, and outage handling;
- a failed push must never make the attendance capture fail or cause staff to repeat a punch;
- creates more production integration surface before the source workflow has been inspected;
- WMIT still needs periodic reconciliation against the Attendance Log.

### C. Hybrid approach

WMIT first reads the source sheet and builds a local projection. A future push mechanism may reduce latency, but the source sheet remains authoritative and is periodically reconciled.

This provides a safe migration path, but it is more architecture than is needed for the first pilot if the push portion is implemented immediately.

### Recommendation

Adopt a gateway variation of **C**, implemented initially as a read-only Apps Script API:

- Phase 3C design and pilot: read-only Apps Script API pull, normalization, projection, dashboards, and reconciliation diagnostics;
- later, only if justified: optional push for freshness, with idempotency and reconciliation against the source log;
- never allow push delivery to overwrite raw source history.

This preserves reversibility and avoids changing a working attendance capture system before its permissions, quotas, and business rules are understood.

## 3. Minimum attendance data model

These are preliminary projection entities, not a request to create production sheets now.

### Person / staff / intern

Proposed sheet or directory: `People` or an extension of the future WMIT employee/intern master data.

| Field | Purpose |
|---|---|
| `person_id` | Stable immutable WMIT ID, not a name |
| `display_name` | Preferred display name |
| `attendance_name` | Exact name currently emitted by the attendance app |
| `name_aliases` | Optional controlled aliases for historical spelling differences |
| `person_type` | Preliminary values: `STAFF`, `INTERN`, `UNKNOWN` |
| `role` | Reference role; may be historical or source-provided |
| `default_branch` | Reference branch only; historical events retain their own branch |
| `active` | Whether the person should appear in current roster views |
| `source_roster_name` | Name as received from Active Roster |
| `notes` | Restricted administrative notes where justified |

The current Active Roster appears to contain names only. It should be treated as a roster input, not as proof of a stable identity, role, or branch.

### Raw attendance event

Proposed projection: `Attendance Events`. It is an immutable local copy/reference of source observations, not a replacement for the source Attendance Log.

| Field | Purpose |
|---|---|
| `attendance_event_id` | WMIT-local immutable ID |
| `source_spreadsheet_id` | Configured source reference; never hard-code in business logic |
| `source_sheet_name` | Expected source tab, currently `Attendance Log` |
| `source_row_reference` | Source row number or source event key where available |
| `source_fingerprint` | Stable hash/key used for idempotent imports |
| `timestamp_raw` | Original source timestamp representation |
| `timestamp_local` | Normalized timestamp in the approved WMIT timezone |
| `employee_name_raw` | Original source name |
| `person_id` | Resolved stable identity, nullable when unresolved |
| `role_raw` | Role observed in the source row |
| `branch` | Branch observed in the source row |
| `action` | `Time In`, `Time Out`, or an explicitly unsupported value |
| `selfie_link_ref` | Restricted reference; not returned to ordinary dashboard clients |
| `ingested_at` | When WMIT read the row |
| `processing_status` | For example: `UNPROCESSED`, `PROCESSED`, `NEEDS_REVIEW`, `DUPLICATE` |
| `manual_review_ref` | Optional exception reference |

Raw values must remain available for audit and reprocessing. Normalization must not destroy the source text.

### Processed daily attendance

Proposed projection: `Daily Attendance`. This is derived, rebuildable, and never authoritative over the raw event log.

| Field | Purpose |
|---|---|
| `daily_attendance_id` | Stable projection ID, normally based on `person_id + local_date` |
| `person_id` | Resolved person |
| `attendance_date` | Local business date used for the summary |
| `branch` | Branch selected from applicable source events; conflicts are flagged |
| `observed_event_count` | Number of source events considered |
| `session_count` | Number of paired sessions |
| `first_time_in` | Earliest accepted Time In, if any |
| `last_time_out` | Latest accepted Time Out, if any |
| `total_hours` | Derived from paired sessions only |
| `open_session` | Whether an unmatched Time In remains |
| `attendance_state` | For example: `OBSERVED`, `PAIRED`, `INCOMPLETE`, `ABSENCE_UNVERIFIED`, `NEEDS_REVIEW` |
| `late_state` | `NOT_CALCULATED`, `ON_TIME`, `LATE`, `NEEDS_REVIEW` only after policy exists |
| `exception_count` | Number of linked exceptions |
| `calculation_version` | Version of the processing rules used |
| `processed_at` | Processing timestamp |

No separate session table is proposed for the first design. Paired sessions may be stored as a compact derived structure or summary detail linked from the daily record, while raw events remain the evidence. A dedicated session entity should wait until actual reporting needs justify it.

### Attendance exception / review

Proposed projection: `Attendance Exceptions`.

| Field | Purpose |
|---|---|
| `exception_id` | Stable immutable ID |
| `person_id` | Person if resolvable |
| `attendance_date` | Local date involved |
| `exception_type` | Controlled preliminary type, such as `DUPLICATE_IN`, `DUPLICATE_OUT`, `MISSING_IN`, `MISSING_OUT`, `CROSS_MIDNIGHT`, `IMPOSSIBLE_SEQUENCE`, `UNRESOLVED_PERSON`, `BRANCH_CONFLICT`, `MANUAL_CORRECTION` |
| `severity` | `INFO`, `WARNING`, or `REVIEW_REQUIRED` |
| `source_event_ids` | Related raw event IDs |
| `status` | `OPEN`, `REVIEWED`, `RESOLVED`, `DISMISSED` |
| `description` | Human-readable explanation |
| `resolution` | What the authorized reviewer decided |
| `reviewed_by` | Reviewer identity |
| `reviewed_at` | Review timestamp |
| `created_at` | Exception creation timestamp |

An exception resolution may affect a derived summary, but it must not overwrite the raw source event.

## 4. Identity transition: name to Person ID

Names are currently the practical source identifier, but names are not safe long-term identifiers because they can change, collide, vary in spelling, or be shared by different people.

Use a controlled identity map:

```text
Attendance Name + optional alias
              ↓
        Person Identity Map
              ↓
          WMIT person_id
```

Recommended transition:

1. Import the current Active Roster read-only.
2. Create a provisional mapping record for each name; do not assume two similar names are the same person.
3. Have an authorized manager resolve duplicates, spelling differences, staff/intern type, and branch.
4. Assign immutable `person_id` values in WMIT's people directory.
5. Keep `attendance_name` as the compatibility value used to match new source rows.
6. Preserve the original name on every raw event and retain mapping history when a name changes.
7. Treat an unknown or ambiguous name as `UNRESOLVED_PERSON`, not as a new person created automatically.

The existing attendance app can continue emitting names during this transition. A future approved enhancement could add a Person ID to the roster or event output, but that is not required for the first read-only integration and must not break older rows.

## 5. Event processing rules

The processing layer should be deterministic, explainable, and rerunnable.

### Common processing sequence

1. Read source rows without modifying them.
2. Preserve raw values and calculate a source fingerprint.
3. Normalize timestamps to the approved WMIT timezone while retaining the raw timestamp.
4. Resolve the attendance name through the identity map.
5. Validate action and branch values.
6. Sort events by normalized timestamp and source position.
7. Pair events into derived sessions using a versioned rule set.
8. Create or update a daily projection and exceptions atomically in the projection store.
9. Record the source row references and processing version.

### Duplicate Time In

Do not silently delete a duplicate source row. Retain both raw events, mark the later or exact duplicate according to the fingerprint/window rule, and create an exception when the duplicate could change the workday interpretation. The pairing algorithm should not count the same punch twice.

### Duplicate Time Out

Retain both events and create `DUPLICATE_OUT` when both could be valid or the correct one cannot be determined. Do not silently choose a value without recording the rule and evidence.

### Missing Time In

An unmatched Time Out becomes an incomplete or review-required session. It must not be converted automatically into a Time In. A reviewer may later resolve it using the approved correction process.

### Missing Time Out

An unmatched Time In produces an open session. The dashboard may show “possibly still clocked in” or “missing Time Out,” but must not claim total hours until a policy-approved pairing or correction exists.

### Multiple sessions in one day

Pair sequential valid `Time In` → `Time Out` events. Preserve all source events and count sessions. If there are more events than can be paired unambiguously, create an exception instead of collapsing them into first-in/last-out only.

### Overnight / cross-midnight events

Use the local timestamp for initial grouping, but identify a Time Out shortly after a prior-day Time In as a `CROSS_MIDNIGHT` candidate. Do not hard-code the allowed overnight duration or automatically move the event to another workday until WMIT confirms its attendance policy.

### Impossible sequences

Examples include Time Out before any Time In, consecutive Time Outs, timestamps that reverse after normalization, or an event with an invalid action. Preserve the rows, mark the sequence invalid, and create `IMPOSSIBLE_SEQUENCE` or a more specific exception.

### Manually corrected records

Corrections should be represented as a separate review decision or correction record containing the reviewer, reason, timestamp, affected source events, and resulting derived interpretation. The original Attendance Log row remains unchanged. Corrections must be permission-controlled and audited.

## 6. Branch handling

Branch is a real field in the Attendance Log and must be included in raw events, daily summaries, filters, and exceptions.

Rules:

- Use the branch recorded on the event for historical attendance reporting.
- Use `default_branch` on the Person directory only as reference data for unresolved or missing source values.
- If a person has events from multiple branches on one day, show the branch conflict rather than silently assigning one branch.
- A branch filter must filter the event or daily projection branch, not merely the person's current default branch.
- Unknown or blank branch values should appear in an explicit `Unknown / Needs review` group.

Branch names, branch IDs, transfer rules, and whether staff may work across branches are unverified.

## 7. Dashboard requirements

The first dashboard should be monitoring-only and should label derived or unverified results clearly.

### Today

- people expected from the approved roster input;
- observed Time In / Time Out state;
- currently open sessions;
- missing-pair and duplicate exceptions;
- branch filter;
- staff/intern filter;
- last source refresh time and source-read errors.

### This week

- daily attendance state per person;
- first in, last out, session count, and paired hours;
- exceptions by type and status;
- branch comparison without exposing selfie links.

### This month

- observed attendance days;
- unresolved exceptions;
- provisional attendance and late summaries only where policy inputs exist;
- source freshness and people that could not be resolved.

### Staff and interns

Separate views or filters for `STAFF` and `INTERN`. Intern access should be more restricted than manager/authorized HR access. The current Role field should not automatically determine permissions until roles are verified.

### Branch

Show branch totals, unresolved branch values, and cross-branch conflicts. Do not infer absence or lateness from branch membership alone.

### Individual history

An authorized viewer may see the person's derived history, source timestamps, exceptions, and review outcomes. Selfie URLs remain hidden by default and require a separate, narrowly authorized action if WMIT later approves such access.

## 8. Attendance calculations

The calculations below are candidate definitions, not finalized WMIT policy.

| Measure | Preliminary meaning | Missing policy/input |
|---|---|---|
| Present | At least one observed valid attendance event, or a confirmed paired session depending on the approved policy | What counts as presence when only one punch exists |
| Absent | No qualifying event on an expected workday | Work calendar, leave, rest days, holidays, and roster effective dates |
| Late | First qualifying Time In is after the person's scheduled start/grace rule | Schedule, grace period, branch/timezone rules |
| Currently clocked in | An unresolved valid Time In without a paired Time Out | Overnight and maximum-session rules |
| Total hours | Sum of paired Time In → Time Out durations only | Rounding, breaks, overnight handling, manual corrections |
| Attendance rate | Qualifying present days divided by expected workdays | Expected workday calendar and leave rules |
| Late count | Number of days classified late | Same lateness policy and correction treatment |

Until policy is verified, dashboards should use labels such as `Observed`, `Paired`, `Incomplete`, and `Needs review`, and should avoid presenting an inferred absence or lateness as a final HR decision.

## 9. Security and privacy

Attendance data contains personal employment information and selfie links. The future integration should use least privilege:

- attendance source access is read-only for WMIT's integration identity;
- source spreadsheet IDs and configuration are kept out of client-side code;
- ordinary staff dashboards show attendance status and timestamps only as authorized;
- manager/HR views may see exceptions and review history;
- intern users must not see unrestricted staff attendance data;
- selfie links are never returned in a general dashboard API, exported report, URL parameter, or browser payload;
- any future selfie inspection must be a separate authorized action with Drive permission checks and audit logging;
- logs should store source references and error details without copying selfie URLs or unnecessary personal data;
- reports should minimize names and personal information when aggregate results are sufficient.

The existing attendance app's sharing settings and the storage location of selfies must be verified before integration.

## 10. Google Workspace roles

| Component | Future role |
|---|---|
| Existing attendance Google Sheet | Authoritative source for captured attendance observations; unchanged by WMIT monitoring |
| Active Roster | Current roster input; initially names only and not a complete identity master |
| Existing attendance Apps Script | Captures Time In/Time Out and selfie metadata; remains operational owner |
| Google Sheets | May store WMIT identity mappings, raw imported references, derived daily projections, and exceptions after approved design and access review |
| Google Drive | Stores restricted selfie files and future supporting documents; not a structured attendance database |
| WMIT Operations | Read-only adapter, normalization, review flags, dashboard, reporting, and audit of WMIT-side processing |
| Apps Script integration layer | Controlled read adapter, scheduled refresh, optional future push/reconciliation adapter, and permission boundary |

WMIT Operations should not write attendance corrections back into the source sheet. If WMIT eventually needs a correction workflow, the approved decision should live in a separate controlled correction/review store and be clearly distinguished from source capture.

## 11. Migration and rollback

Integration should be introduced in stages:

1. Read-only discovery of sheet tabs, headers, sharing permissions, timezone, and data volume.
2. Synthetic/local parser tests using exported copies or approved fixtures.
3. Read-only production pilot that displays source refresh time and does not write anywhere.
4. Compare a sample of WMIT dashboard results with the source Attendance Log and manager review.
5. Enable derived projections and exceptions only after the comparison is accepted.
6. Add optional incremental sync or push only if the read-only pilot demonstrates a need.

Rollback is a feature flag or adapter disablement. Turning off the integration must leave the attendance app and source spreadsheet untouched. Derived WMIT projections may be ignored or rebuilt from the source; they must not be treated as the original record. Before any production projection is created, define an export/backup procedure for WMIT-side mappings, exceptions, and configuration.

## 12. Production-readiness gate

Before any live integration, verify and document:

- authorized Workspace account and cross-spreadsheet permissions;
- exact spreadsheet ID, tab names, header names, timezone, and source refresh expectations;
- staff roles and who may see individual attendance, exceptions, or selfie files;
- stable identity mapping and duplicate-name resolution;
- branch list, branch IDs/names, transfers, and historical branch treatment;
- attendance policy for shifts, lateness, grace periods, breaks, holidays, leave, overnight work, and corrections;
- retention, privacy, employee notice, and access-review requirements for attendance and selfie data;
- integration credentials, deployment identity, secret storage, and least-privilege scopes;
- retry, idempotency, source outage, quota, and reconciliation behavior;
- backup strategy for source and WMIT projection data;
- audit-log retention and review responsibility;
- a tested rollback and disablement procedure.

None of these production checks have been completed in this local design phase.

For a future Google Sheets API client, the minimum requested OAuth scope is `https://www.googleapis.com/auth/spreadsheets.readonly`. Google documents that this scope grants read-only access to Sheets; the scope applies at the spreadsheet-file level, so the integration identity must also have Viewer access to the specific spreadsheet. If the adapter is implemented inside Apps Script with `SpreadsheetApp.openById()`, the executing account must be authorized to view that spreadsheet and the script manifest should request the narrowest read-only scope supported by the chosen service. No write scope is required for this adapter. These permissions have not yet been granted or tested in this project.

## Assumptions and explicit unknowns

### Assumptions used for this design

- The existing Attendance Log remains writable by the attendance app and readable by an approved future integration identity.
- Timestamps can be normalized to the WMIT business timezone after the source timezone is verified.
- Source rows or a stable fingerprint can be used for idempotent rereads.
- WMIT can maintain an identity mapping without changing historical source rows.

### Requires real WMIT validation

- Whether one attendance row is allowed to be manually edited in practice.
- Whether duplicate punches are accidental, intentional, or common across branches.
- The official work calendar, shifts, grace periods, breaks, holidays, and leave process.
- Whether staff/intern classifications and branches are managed anywhere besides the current sheets.
- Whether selfie files are stored in Drive and what their current sharing permissions are.
- Required attendance retention period and who is legally/operationally authorized to review selfies.
- Whether WMIT needs near-real-time monitoring or a scheduled daily report is sufficient.

## Design conclusion

WMIT Operations should be an attendance monitoring and review layer, not an attendance capture replacement. The safest first implementation is a read-only source adapter with rebuildable projections, stable identity mapping, explicit exceptions, branch-aware reporting, and no public selfie exposure. Attendance policy and Workspace permissions must be verified before any production calculation is labelled final.
