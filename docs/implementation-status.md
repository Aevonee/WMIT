# Implementation Status

Last updated: Aug 23 2026 (design overhaul + manual quotation builder).

This page tracks what is actually built and running on the hosted server,
feature by feature, with where to find it. Test suite reference:
417 tests, all passing.

## Design (Aug 22–23 2026)

| Feature | Where | Status |
|---|---|---|
| Workspace design overhaul | `app/public/operations.html` + `operations.js` + `tokens.css` / `styles.css`; approved mockups in `docs/mockups/` | Built. Design tokens, system fonts, component restyle across all workspace views (Today cockpit, case command center, quotations, bookings/payments, departures, documents/privacy, remaining tabs) and the Events console (`expo-console.css`). Browser-verified at desktop and 375px. |
| Manual quotation builder | Quotations tab ("Build quotation" from a selected Inquiry) and Inquiries queue ("Build quote"); `#quote-builder` view | Built, additive - the classic quotation editor is untouched and stays the default for editing. Item-by-item builder with internal unit cost, optional supplier, flights and itinerary days, live totals (subtotal, service fee, grand total, internal margin) and a live client preview sheet. Cost, supplier and margin never render on the client sheet. Guards: below-cost items and missing destination block the save; drafts save through the existing audited actions (`createQuotation` / `createQuotationItem` / `updateQuotation`), which require signed-in staff authority (`EDIT_DRAFT_PRICING`); partial failures keep the saved lines and open the draft with a warning. |

## Daily operations

| Feature | Where | Status |
|---|---|---|
| Today overview (owner's cockpit) | Operations workspace, first tab; `getTodayOverview` action | Built. Payments due (+7d), departures (+30d), unconfirmed supplier bookings, overdue follow-ups, documents pending review. |
| Global search | Topbar search box; `globalSearch` action | Built. Client / Inquiry / Quotation / Booking / ExpoLead, top 8 per group. |
| Mobile workspace | Responsive CSS in operations.html | Built. Tabs, Today cards, tables usable at 375px. |
| Client CSV import | Clients tab, "Import clients (CSV)" card; `previewClientImport` / `commitClientImport` | Built. Dry-run first: preview validates and reports (row-level OK/WARNING/ERROR, duplicates by email/phone/name in file and vs existing clients) without writing; commit re-validates from scratch and creates Client records through the audited path only - duplicates are never merged. Strict RFC 4180 parser (BOM, CRLF, quoted fields). Limits: 2000 rows, 512 KB. |
| AI inquiry pre-fill | Inquiries tab, "Paste client message (AI pre-fill)" card; `parseInquiryMessage` | Built. Staff paste a client email/chat text; an optional adapter (`INQUIRY_AI_PROVIDER` openai/gemini/openrouter, `INQUIRY_AI_API_KEY`, `INQUIRY_AI_MODEL` - same env-gating as the flyer adapter) returns sanitized trip requirements that fill only empty form fields. Pure read - no records, no audit entries; unconfigured or failed adapters degrade to a clean notice. The inquiry is created only when staff save the form. |
| Owner morning digest | Scheduler job `digest`, daily 08:00 Manila; `WMIT_DIGEST_TO` + `WMIT_SMTP_*` env | Built. Text email: reminder drafts awaiting review lead the action section, then documents pending review (worst-first, mirroring the ingestion queue), departure readiness alerts, privacy retention queue, payments awaiting verification, overdue receivables, trips in 14 days, expo funnel (24h). Empty sections are omitted. Unconfigured SMTP lands as .eml in the outbox and the run is recorded as skipped. |

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

## Agent layer

| Feature | Where | Status |
|---|---|---|
| Sales proposal agent v1 | Today tab, "Sales agent suggestions" card; `generateSalesProposals` / `resolveAgentProposal` actions; `tests/integration/agent-proposals.test.js` | Built, draft-only. Two deterministic rules (no LLM, no adapter — that is v2): FOLLOW_UP_OVERDUE (NEW/RESEARCHING inquiry with no client Communication in 7 days, confidence 0.8) and QUOTE_STALLED (DRAFT/APPROVED quotation with no QuotationAcceptance and quotation_date over 3 days old, confidence 0.7). Proposals are Task records (`task_type AGENT_PROPOSAL`, `source SALES_AGENT`), deduped by `automation_key` so re-scanning never duplicates an open suggestion. Staff Accept or Dismiss; Accept = audited COMPLETED (stays suppressed on later scans), Dismiss = audited CANCELLED (can re-raise). **Automation stops at the suggestion** - accepting executes nothing (no emails, no bookings, no status changes); acting on a suggestion happens through the normal workspace screens. |

## Development and verification

| Feature | Where | Status |
|---|---|---|
| Unit + integration suite | `npm test` | 452 tests, all passing. |
| Playwright e2e smoke suite | `npm run test:e2e` (separate from `npm test`) | Built. Own port (3999) and temp database - never touches the dev instance or repo data/. Six scenarios: login surface, real UI admin login, signed-in workspace with zero console errors, quote-builder regression with server-state assertions, expo console load, 375px no-overflow. Uses installed Edge/Chrome channels (no browser download); skips cleanly when no browser is present. |

## Deliberately not built

- **Payment gateway** - blocked on merchant onboarding paperwork, not code. Revisit when the owner has PSP documents ready.
- **Client portal** - deferred until client volume justifies it. The public status page covers the immediate need.
- **Inbound email robot / Gmail integration** - deferred with the Google Workspace access decision.
