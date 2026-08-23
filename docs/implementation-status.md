# Implementation Status

Last updated: Aug 21 2026 (after the 8-feature platform build).

This page tracks what is actually built and running on the hosted server,
feature by feature, with where to find it. Test suite reference:
412 tests, 405 passing, 7 pre-existing failures isolated to
`tests/integration/quotation-editor.test.js` (unrelated to the features below).

## Daily operations

| Feature | Where | Status |
|---|---|---|
| Today overview (owner's cockpit) | Operations workspace, first tab; `getTodayOverview` action | Built. Payments due (+7d), departures (+30d), unconfirmed supplier bookings, overdue follow-ups, documents pending review. |
| Global search | Topbar search box; `globalSearch` action | Built. Client / Inquiry / Quotation / Booking / ExpoLead, top 8 per group. |
| Mobile workspace | Responsive CSS in operations.html | Built. Tabs, Today cards, tables usable at 375px. |

## Client chasing (drafts, never auto-send)

| Feature | Where | Status |
|---|---|---|
| Reminder drafts | Follow-ups tab, "Reminder drafts" card; `generateReminderDrafts` / `listReminderDrafts` / `discardReminderDraft` | Built. Categories: BALANCE_DUE (incl. overdue), MISSING_DOCUMENTS, DEPARTURE_REMINDER (3-7 days out). Stored as Task records (`task_type REMINDER_DRAFT`), one open draft per target, discard = audited CANCELLED. **No send action exists anywhere** - staff copy and send manually. |
| Departure readiness | Departures tab detail; `getDepartureReadiness` / `runDepartureReadinessCheck` | Built. Per-member checks: BOOKING_PAID / TICKETING / VOUCHERS / DOCUMENTS with PASS/FAIL/UNKNOWN, score + state. FAIL rows raise idempotent tasks (one open task per departure+member+check). Scheduler job `departure-readiness` runs daily 06:30 Manila for departures within 14 days. |

## Finance

| Feature | Where | Status |
|---|---|---|
| Accountant export | Finance tab, "Accountant export" card; `getAccountantExport` action; `GET /api/accounting/export.csv?type=cashbook\|receivables\|payables` | Built. Excel-friendly CSV (BOM, CRLF, escaped), signed amounts (client payments positive; supplier payments and EXECUTED refunds negative; rejected evidence and draft refunds excluded), as-of-period receivables/payables. |
| Commission tracking | Finance tab, "Commissions" card; `recordCommission` / `approveCommission` / `markCommissionPaid` / `listCommissions` / `getCommissionSummary` | Built. Commission entity (`COMMISSION-YYYY-NNNNNN`), lifecycle strictly DRAFT -> APPROVED -> PAID, approve/pay manager-gated (`COMMISSION_APPROVE` / `COMMISSION_PAY`), amounts immutable after record time, pay requires evidence reference or explicit paid_at. |
| Auto-commission drafts | Finance tab, "Automatic draft rules" sub-section; `addCommissionRule` / `updateCommissionRule` / `listCommissionRules` | Built. Rules (FLAT/PERCENT, trigger BOOKING_CREATED or BOOKING_FULLY_PAID, optional EXPO source filter) auto-create DRAFT commissions via `applyCommissionRules` - idempotent (`AUTO_COMMISSION:<rule>:<booking>` key), rule failures never fail the host action. Automation stops at draft; humans approve and pay. |

## Marketing / expo

| Feature | Where | Status |
|---|---|---|
| Expo campaign analytics | Events console, Analytics tab; `GET /api/expo/analytics` | Built. Per-event funnel (definitions shared with the expo dashboard), day-1/3/7 follow-up effectiveness, source comparison (expo lineage only - booked quote link, lead booking link, or converted-inquiry lineage; otherwise recorded source), monthly trend, consent counts. |

## Data privacy (Philippine DPA groundwork)

| Feature | Where | Status |
|---|---|---|
| Consent capture | Expo sign-up form; `consent_captured_at` + `consent_text` on ExpoLead | Built. Kiosk sign-ups record consent; badge imports honestly report as `legacy`. Policy: [data-privacy.md](data-privacy.md) (draft for counsel). |
| Privacy overview | Documents tab, "Privacy" card; `recordClientDataConsent`, `getPrivacyOverview` | Built. Per-client data inventory (records by type, sensitive document counts), consent history, retention statuses (ELIGIBLE_FOR_ERASURE / RETAINED / FUTURE / ERASED) per the policy schedule. |
| Gated erasure | `eraseClientDocuments` | Built. HIGH-RISK: manager authority (`DATA_ERASE`) + typed `ERASE` confirmation; sensitive types only (PASSPORT / VISA / IDENTITY); purges content fields, keeps id/type stub; audit rows record ids/types, never content. Financial records never touched. |
| Retention job | Scheduler job `privacy-retention` | Built. Daily 07:15 Manila; raises one deduped task per day listing eligible document ids. Never auto-erases. |

## Client-facing

| Feature | Where | Status |
|---|---|---|
| Public booking status page | Booking tab, "Client status link" button; `issueBookingStatusLink`; public `GET /status/<token>` + `GET /api/public/booking-status` | Built. 48-hex token (24 random bytes), only SHA-256 hash stored, one active token per booking (re-issue invalidates old), expiry = travel_end + 30d (or issue + 90d), cancelled bookings denied. Public payload strictly client-safe: booking basics, payment progress (statement-of-account math), document counts, milestones. No supplier names, costs, or internal data (test-enforced). |

## Wholesaler packages

| Feature | Where | Status |
|---|---|---|
| Package library | Packages tab; `createPackage` / `updatePackage` / `confirmPackage` / `archivePackage` / `listPackages` | Built. SupplierPackage records carry itinerary days, inclusions/exclusions, price + pax basis, DRAFT -> CONFIRMED -> ARCHIVED lifecycle (CONFIRMED locks core fields). |
| Quotation from package | `createQuotationFromPackage` | Built. CONFIRMED packages only; creates a DRAFT quotation with package itinerary/inclusions/exclusions + one Tour Package line (qty = pax or 1 by basis; selling-price override honoured); rolls back cleanly if the item fails. |
| Flyer upload + AI intake | Packages tab upload; `uploadFlyer` / `extractFlyerDraft`; `src/adapters/flyer-extraction-adapter.js` | Built. Flyer documents (`source_type WHOLESALER_FLYER`, 700KB, PNG/JPEG/WebP/PDF). AI adapter is optional and config-gated (`FLYER_AI_PROVIDER` openai/gemini/openrouter, `FLYER_AI_API_KEY`, `FLYER_AI_MODEL`; openrouter defaults to `stealth/ox-alpha` — free preview, multimodal; OpenRouter stealth models are run by an anonymous provider that retains prompts, acceptable for wholesaler promo flyers only); unconfigured = clean EXTRACTION_UNAVAILABLE and the manual form. Extraction validates flyer source BEFORE the adapter is called - client sensitive documents can never reach an external API. Extraction drafts store on the document; humans always confirm the package. |

## Deliberately not built

- **Payment gateway** - blocked on merchant onboarding paperwork, not code. Revisit when the owner has PSP documents ready.
- **Client portal** - deferred until client volume justifies it. The public status page covers the immediate need.
- **Inbound email robot / Gmail integration** - deferred with the Google Workspace access decision.
