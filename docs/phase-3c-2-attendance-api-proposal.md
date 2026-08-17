# Phase 3C.2 Attendance API Proposal

**Status:** Local implementation complete; production deployment and Google Workspace changes remain unauthorized and untested.

## Executive recommendation

Use the existing attendance Apps Script as a narrow, read-only gateway:

```text
WMIT Operations
  -> AttendanceSourceAdapter
  -> server-side Apps Script API client
  -> existing attendance Apps Script web endpoint
  -> SpreadsheetApp read operations
  -> Attendance Log / Active Roster
```

The Attendance Log remains the source of truth. WMIT Operations receives a filtered projection of source observations and never receives write access to the spreadsheet.

The smallest safe design is an authenticated `doPost` endpoint using an HMAC request signature. The endpoint should not use an API key in a URL, should not accept unauthenticated data requests, and should not expose `Selfie Link` in general responses.

## What was inspected

The local WMIT project and supplied attendance reference copies contain:

- `AttendanceSourceAdapter` and `MockAttendanceSourceAdapter`;
- `GoogleSheetsAttendanceAdapter`, currently designed around an injected read-only client;
- attendance normalization, identity mapping, projection, exceptions, filters, and dashboard services;
- WMIT Apps Script stubs under `apps-script/`.

The supplied attendance reference copy contains `doGet()`, `getRosterNames()`, `processAttendance()`, Telegram notification functions, and the existing selfie flow. It does not contain `doPost()`, so the isolated `attendance-reference/AttendanceApi.gs` addition does not conflict with an existing `doPost()`. Deployment settings, script ownership, and production Script Properties remain unverified.

## Proposed API contract

### Transport

- Method: `POST`
- Endpoint: the existing attendance Apps Script web-app `/exec` URL
- Content type: `application/json`
- Data requests: `doPost(e)` only
- Unauthenticated `doGet`: no attendance data; return a generic non-sensitive status or `405`
- No credentials or data in query-string parameters

Using POST keeps the date range and signature material out of URLs, browser history, and common proxy logs. The endpoint remains read-only even though the transport method is POST.

### Common request envelope

```json
{
  "api_version": "1",
  "operation": "attendance.events",
  "request_id": "server-generated-request-id",
  "issued_at": "2026-08-12T12:00:00.000Z",
  "nonce": "server-generated-unique-value",
  "from": "2026-08-01",
  "to": "2026-08-12",
  "key_id": "wmit-operations-01",
  "signature": "base64-hmac-signature"
}
```

The HMAC covers a canonical representation of the method, operation, request ID, issued time, nonce, date range, and API version. The secret itself is never sent.

### Attendance events operation

`operation: "attendance.events"`

Required request fields:

- `from`: inclusive local calendar date;
- `to`: inclusive local calendar date;
- `request_id`, `issued_at`, `nonce`, `key_id`, and `signature`.

The endpoint should enforce a bounded range, initially no more than 31 calendar days. WMIT can make multiple requests for longer history. A future page token may be added only if actual row volume requires it.

Example response:

```json
{
  "ok": true,
  "api_version": "1",
  "operation": "attendance.events",
  "from": "2026-08-01",
  "to": "2026-08-12",
  "timezone": "Asia/Manila",
  "read_only": true,
  "events": [
    {
      "timestamp": "2026-08-12T00:00:00.000Z",
      "employee_name": "Jhon Bagtasos",
      "role": "Operations Staff",
      "branch": "Main Branch",
      "action": "Time In",
      "source_row_reference": 42
    }
  ],
  "warnings": []
}
```

The event payload deliberately excludes `Selfie Link`. `source_row_reference` is optional and is a restricted server-to-server diagnostic value; it must not be returned by WMIT’s general browser dashboard. It is a source location, not an immutable business ID.

### Active roster operation

`operation: "attendance.roster"`

Example response:

```json
{
  "ok": true,
  "api_version": "1",
  "operation": "attendance.roster",
  "read_only": true,
  "roster": [
    {
      "employee_name": "Jhon Bagtasos",
      "role": "Operations Staff",
      "branch": "Main Branch",
      "active": true
    }
  ],
  "warnings": []
}
```

No selfie, credential, spreadsheet ID, or unrestricted sheet row should be returned.

### Role source for the attendance UI

The attendance form no longer asks the user to select Staff or Intern. The existing attendance `Code.gs` reference copy now reads Role from `Active Roster` by header name and applies that value server-side before writing the existing Attendance Log row. This prevents a user from selecting a role different from the roster.

The expected Active Roster layout is:

| Name | Role | Branch (optional) |
|---|---|---|
| Jhon Bagtasos | Staff | Main Branch |
| Sample Intern | Intern | Main Branch |

The one-time `setupActiveRosterRoleColumn()` helper adds the `Role` header if it is missing. It must be run manually in the attendance Apps Script project, then the owner must fill the Role values. It is not called by the attendance UI, API, or WMIT Operations automatically.

### Error response

```json
{
  "ok": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Attendance API authentication failed.",
    "request_id": "server-generated-request-id"
  }
}
```

Errors must not contain the shared secret, spreadsheet ID, stack trace, sheet contents, or Selfie Link. Suggested codes are `UNAUTHORIZED`, `REPLAYED_REQUEST`, `INVALID_RANGE`, `RANGE_TOO_LARGE`, `MISSING_HEADERS`, `SOURCE_UNAVAILABLE`, and `DATA_QUALITY_WARNING`.

## Authentication recommendation

### Recommended: HMAC signing with Script Properties

Store a randomly generated secret in two server-side locations:

1. Apps Script `PropertiesService.getScriptProperties()`;
2. WMIT Operations server environment/secret store.

The secret must not be committed to the repository, placed in a JSON config file, included in browser JavaScript, or placed in the endpoint URL.

Each WMIT server request includes a timestamp, unique nonce, key ID, and HMAC signature. Apps Script verifies:

1. the key ID is active;
2. the timestamp is within a small clock-skew window;
3. the nonce has not already been used;
4. the signature matches using a constant-time comparison where practical.

`CacheService` may hold recently used nonce hashes for the replay window. This is not a write to the Attendance Log and does not alter attendance data. Secret rotation should support an active and previous key temporarily, with a planned expiry for the previous key.

### Alternatives considered

| Approach | Decision | Reason |
|---|---|---|
| API key in query string | Reject | URL history, proxy logs, and accidental leakage make it unsuitable for attendance data. |
| Static API key in POST body | Not preferred | Simple, but replayable and weaker than signing unless combined with timestamps and nonce tracking. |
| HMAC request signing | Recommended | Server-to-server, no secret transmission, replay protection, no Google OAuth dependency for WMIT Operations. |
| Google OAuth/service account | Defer | Strong identity model but adds more infrastructure and direct Google authorization complexity than this read-only gateway needs now. |
| IP allowlist | Supplement only | Not sufficient as the primary authentication control for a web endpoint. |

The endpoint should still use HTTPS, even though Apps Script web-app URLs are HTTPS.

## Apps Script read behavior

The eventual endpoint implementation should:

1. authenticate before opening or reading the spreadsheet;
2. open the existing spreadsheet using the attendance app’s approved server-side configuration;
3. read the first row of `Attendance Log` and map columns by normalized header names;
4. require Timestamp, Employee Name, and Action;
5. treat Role, Branch, and Selfie Link according to the verified current sheet;
6. read `Active Roster` only for the separate roster operation;
7. filter timestamps using the spreadsheet/script timezone, not the Apps Script server’s assumed local timezone;
8. return only the normalized fields in this contract;
9. preserve malformed rows as warnings or explicitly report their source row so WMIT does not mistake omission for clean data;
10. never call `appendRow`, `setValue`, `setValues`, `deleteRow`, formatting methods, or roster mutation methods.

Header aliases and the exact treatment of malformed timestamps must be confirmed against the real attendance script and sheet before coding. The existing WMIT adapter already has the appropriate header-normalization concept and should be adapted to this response contract rather than coupled to `SpreadsheetApp`.

## WMIT implementation boundary

The current `GoogleSheetsAttendanceAdapter` is now an API adapter, not a SpreadsheetApp adapter:

```text
AppsScriptAttendanceApiClient
  -> HTTP POST with server-side HMAC signing
  -> response validation
  -> GoogleSheetsAttendanceAdapter
  -> AttendanceService
  -> projection / identity map / exceptions
```

The adapter now:

- validates the response envelope and fields;
- preserve the existing `AttendanceSourceAdapter` interface;
- makes one bounded events request per date range, including one preceding calendar day for overnight pairing;
- makes a separate roster request;
- map `source_row_reference` if supplied;
- returns an explicit unavailable result on timeout, HTTP error, invalid JSON, authentication error, or contract mismatch;
- never exposes the API secret or endpoint credentials to the browser.

The mock adapter remains the default for local development and tests. A feature flag should control the API source independently from attendance monitoring, with an explicit Demo Data fallback only when configured.

## Security boundaries

- The attendance endpoint is server-to-server only.
- Browser requests call WMIT Operations, never the Apps Script URL directly.
- WMIT browser responses contain no API URL, HMAC secret, key material, or Selfie Link.
- General dashboard/history responses contain no Selfie Link.
- Restricted investigation remains a separate authorized path and must not be implemented through the general events endpoint.
- Source rows remain authoritative and immutable from WMIT’s perspective.

## Failure and rollback

If the endpoint is unavailable, WMIT Operations should:

- show `Google Attendance API unavailable` clearly;
- avoid presenting stale data as current;
- use Demo Data only if an explicit development/test fallback is enabled;
- preserve the last successful refresh metadata if retained, clearly labelled as stale;
- record a server-side diagnostic without recording secrets or selfie URLs.

Rollback is disabling the API-source feature flag and returning to the mock source. This does not touch the attendance app or source spreadsheet.

## Required verification before implementation

The owner must provide or authorize inspection of the actual attendance Apps Script source and deployment settings so these can be verified:

- current `doGet`/`doPost` behavior and whether a new route can be added without changing capture behavior;
- spreadsheet access identity and script timezone;
- exact spreadsheet ID configuration location;
- current header names and any header variations;
- whether the web app is domain-restricted or externally callable;
- Apps Script runtime and available services (`PropertiesService`, `CacheService`, `Utilities`);
- acceptable date-range maximum and expected row volume;
- secret storage and rotation responsibility;
- server-side WMIT deployment location for the HMAC secret;
- monitoring, rate limiting, and audit expectations.

Until these are verified, do not deploy the endpoint or enable the API source flags in a production runtime. The local implementation remains safe to test with a fake API client.

## Decision record

**Decision proposed:** retain the existing attendance Apps Script as the gateway and source of truth, use a purpose-built authenticated read-only POST API, and keep WMIT Operations behind `AttendanceSourceAdapter`.

**Reason:** this avoids direct Sheets API access, preserves the existing attendance workflow, limits returned data, and keeps WMIT reversible.

**Main tradeoff:** the Apps Script endpoint becomes an additional maintained interface and must be monitored for quotas, outages, and secret rotation.

**Reconsider if:** the endpoint cannot meet required availability/volume, the Apps Script deployment cannot safely support server-to-server authentication, or real WMIT data requires a more capable integration layer.
