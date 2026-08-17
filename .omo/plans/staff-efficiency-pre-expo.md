# staff-efficiency-pre-expo — Work Plan

## TL;DR (For humans)

**What you'll get:** staff open the app and the dashboard tells them what to do next (clickable queues, not a dead "Needs attention" panel); one search box finds any client, lead, booking, or supplier; every routine message (quote delivery, deposit reminder, follow-up…) is a template with Copy / WhatsApp / Viber buttons instead of copy-paste retyping; one screen per trip ends the cross-tab hopping; client-facing invoices and itineraries are generated from real records in your house style.

**Why this order:** Waves 1–2 make the staff faster before and during the expo rush (quote + deposit volume peaks right after it). Wave 3 documents depend on owner-provided samples. Wave 4 is the existing runbook.

**Effort:** multiple worker sessions across waves; every todo commits green (tests + browser QA); the expo-critical kiosk path is never touched by in-flight work.

**Decisions locked with owner (2026-08-17):** users are staff + admin, mostly desktop, sometimes mobile → mobile pass is required on dashboard/case/messages, not the whole app. Message templates: English, the full starter set below, owner-confirmed. Bold post-expo work pulled forward because pre-expo tasks need the tooling. Invoice/itinerary design comes from owner samples in `data/samples/` (gitignored). Staff rehearsal time unknown → cheat sheets + in-app guidance must carry training alone if no session happens.

## Scope

**IN:**
1. Wave 1 — message template library (starter set below) with per-context placeholder rendering and Copy/WhatsApp/Viber actions, surfaced in follow-ups, leads, quotes, bookings, and payment contexts; templates editable in Settings (admin).
2. Wave 1 — actionable dashboard: real queues (quotes awaiting approval, deposits/balances due or overdue, overdue follow-ups, leads needing mobile) with every row deep-linking into its case.
3. Wave 1 — global search in the workspace header: name / mobile / email / ID across clients, expo leads, bookings, quotations, suppliers.
4. Wave 2 — case workspace: one screen per trip assembling inquiry, options, quotation, booking, payments/payables, supplier fulfillments, documents, timeline, and a plain-language next-steps checklist derived from existing case-projection blockers.
5. Wave 2 — mobile pass (≤640px, ≥44px touch targets on primary actions) on dashboard, case workspace, search results, and message actions.
6. Wave 3 — invoice document generated from a booking's recorded obligations/payments (render-only; never mutates financial records; send requires confirmation — financial doc = medium risk per AGENTS.md).
7. Wave 3 — itinerary document generated from the quotation's day-by-day itinerary data, including flights and voucher references once recorded.
8. Wave 4 — per-role one-page cheat sheets (Admin, Staff) under `docs/`, and expo readiness per the existing runbook.

**OUT / Must-NOT-Have:**
- NO schema/data-model changes: everything renders from existing entities and configuration. Templates are stored via the existing settings/configuration mechanism, not a new entity table (executor confirms the mechanism by reading `src/phase1/runtime.js` settings handling before implementing).
- NO server-side rendering/PDF library, NO new npm dependencies: documents reuse the existing client-preview pattern (`getClientQuotationPreview` → branded HTML → browser print/PDF, email via existing mailer/outbox).
- NO Apps Script changes; NO changes to the expo kiosk (`app/public/expo.html`) once Wave 1 starts — kiosk is expo-frozen except for showstopper bugs.
- NO silent mutation of money records from documents; invoices display recorded values only.

## Key facts the executor relies on

- Test gate: `npm test` (247 tests as of plan writing) must be green at every commit.
- The follow-up queue already implements WhatsApp/Viber deep links (`app/public/expo-console.js` chat-actions) — reuse that pattern and link-builder for the template actions.
- `case-projection.js` already computes per-case blockers (`SUPPLIER_PAYABLE_NOT_APPROVED`, `SUPPLIER_INFORMATION_MISSING`, …) — the case workspace's next-steps checklist maps these codes to plain-language sentences; no new computation.
- `operations.js` renders client-side from `GET /api/phase1/state` via the `api()` helper; all new screens follow the existing `wmitAuthHeaders()`/`wmitGuard401()` discipline (the missing-header bug class was found once already — do not reintroduce it; every new fetch goes through those helpers).
- The dashboard "Needs attention" panel and `case-header` markup already exist in `operations.js`; Wave 1 replaces their content, not the layout skeleton.
- Documents: the branded client-preview path is `getClientQuotationPreview` + `printQuotation()` in `operations.js` — the invoice and itinerary documents follow it (same `print-quotation` body class pattern, same tokens.css styling).
- Owner samples land in `D:\Codex\WMIT\data\samples\` (gitignored; PII never committed). Wave 3 executor reads them first and mirrors structure (sections, deposit/balance split, TIN/VAT lines if present, tone).
- Mobile: primary surfaces must work at 390px width; verify with Playwright viewport 390×800 and 768×1024.

## Message template starter set (English; placeholders {{first_name}} {{name}} {{destination}} {{travel_month}} {{quote_link}} {{deposit}} {{balance}} {{due_date}} {{booking_id}} {{consultant}})

LEAD_FOLLOWUP_1 (day-1 thank-you), LEAD_FOLLOWUP_NUDGE (day-3/7), NO_REPLY_CLOSING (final attempt before LOST), QUOTE_DELIVERY ({{quote_link}}), QUOTE_FOLLOWUP, DEPOSIT_REMINDER, BALANCE_REMINDER, BOOKING_CONFIRMED, DOCUMENTS_REQUEST (passport etc.), TICKETING_NOTICE, FINAL_ITINERARY_SENT, POSTTRIP_THANKYOU.

## Todos

- [ ] 1. Wave 1 — Message templates: engine + Settings editor + actions
  Read first: `app/public/expo-console.js` (chat-actions/link builders), `src/phase1/runtime.js` (settings mechanism), `docs/events.md` (message tone references).
  Steps: (a) template store via existing settings/configuration (admin-editable, seeded with the 12 starter templates); (b) renderer for placeholder substitution per context (lead / quote / booking / payment); (c) UI: template picker + Copy / Open WhatsApp / Open Viber buttons in Events follow-up queue, lead detail, quote tab, booking finance tab; (d) tests: placeholder rendering, missing-field fallback, settings persistence, admin-only edit.
  Acceptance: staff can pick "Deposit reminder" on a booking and send via WhatsApp with every placeholder filled from real record data; no template can render with a visible unfilled `{{…}}` — missing fields render as sensible text, never the raw token.
  Commit: `staff tools: message templates with copy/WhatsApp/Viber actions`.

- [ ] 2. Wave 1 — Actionable dashboard
  Steps: (a) derive queues from existing state: quotations pending approval, client obligations due/overdue (from payment schedule), overdue follow-ups (tasks), leads with NEEDS MOBILE; (b) render as grouped lists where every row links to its case/tab with the record preselected (reuse workspace-id selection); (c) keep counts honest — queue = actionable records only.
  Acceptance: dashboard answers "what needs me now" with zero dead ends; every row resolves in one click to the record; browser QA creates one of each queue item and follows every row.
  Commit: `workspace: actionable dashboard queues`.

- [ ] 3. Wave 1 — Global search
  Steps: (a) header search box (both operations and expo-console headers), debounced, ≥2 chars; (b) searches clients, expo leads, quotations, bookings, suppliers by display name, mobile, email, and record ID prefix; (c) keyboard: arrow/enter navigation, Esc closes; (d) results deep-link with record preselected.
  Acceptance: typing a mobile number or last name finds the person and lands on their record in ≤2 interactions; QA covers mobile + email + ID lookups.
  Commit: `workspace: global search across clients, leads, bookings, suppliers`.

- [ ] 4. Wave 2 — Case workspace
  Steps: (a) new view (hash `#case` + client/booking selection) assembling the full trip from existing snapshot data; (b) sections: client + trip summary, inquiry → options → quotation history, booking + travelers, payments/payables, supplier fulfillments, documents, audit/timeline; (c) plain-language next-steps checklist mapped from case-projection blocker codes; (d) dashboard rows, search results, and message contexts link here.
  Acceptance: the Maria's-Korea-trip scenario (lead → quote → booking → partial payment) is fully serviceable from this one screen; every blocker sentence names the action ("Record the 50% deposit…"); QA walks the full lifecycle.
  Commit: `workspace: case workspace — one screen per trip`.

- [ ] 5. Wave 2 — Mobile pass
  Steps: responsive audit + fixes at 390px and 768px for dashboard, case workspace, search, message actions (≥44px primary targets, no horizontal overflow, tables → stacked cards where needed).
  Acceptance: Playwright viewport QA (390×800, 768×1024) shows no horizontal scroll on those surfaces and primary actions are tappable-size; screenshots captured.
  Commit: `workspace: mobile pass on dashboard, case, search, messages`.

- [ ] 6. Wave 3 — Invoice document  **(blocked until owner samples exist in data/samples/)**
  Read first: every file in `data/samples/`; mirror its structure exactly (sections, deposit/balance lines, TIN/VAT if present).
  Steps: (a) `getClientInvoicePreview`-style render from a booking's recorded obligations/payments (deposit invoice and balance statement per sample convention); (b) branded print/PDF via the existing preview pattern; (c) email via existing mailer/outbox with medium-risk confirmation; (d) audit-logged issue event; render-only — never writes financial records.
  Acceptance: generated invoice matches the owner sample's structure with values from real records; sending requires explicit confirmation; tests cover amount rendering, missing-payment handling, and the confirmation gate.
  Commit: `documents: client invoice generation from booking records`.

- [ ] 7. Wave 3 — Itinerary document  **(blocked until owner samples exist)**
  Steps: render quotation itinerary days (city, title, activities, meals, overnight) + flights and voucher references when recorded; same branded pattern and QA as todo 6.
  Commit: `documents: client itinerary generation from quotation data`.

- [ ] 8. Wave 4 — Cheat sheets + expo readiness
  Steps: `docs/staff-cheat-sheets.md` — one page per role (Admin, Staff): daily routine (dashboard first), how to send each message type, how to create a quote/booking/invoice, escalation rules. Reference `docs/expo-readiness.md` Phases B–D unchanged.
  Commit: `docs: per-role staff cheat sheets`.

## Final verification wave

- [ ] F1. Plan compliance — commits present per todo, scope only as written.
- [ ] F2. Code review — line-by-line diff review of todos 1, 4, 6 (largest surface areas).
- [ ] F3. Real QA — full browser walk: dashboard → case → message → search on desktop + mobile viewports; `npm test` green.
- [ ] F4. Scope fidelity — no schema changes, no new dependencies, Apps Script and expo kiosk untouched, `git status` clean.

## Success criteria

1. Any staff task (find person → assess trip → act → communicate) completes in ≤3 interactions from anywhere in the app.
2. The dashboard enumerates every actionable item with zero dead ends; nobody needs to "know the system" to know what's next.
3. Routine communication is template-driven with real data; nothing typed from scratch except edge cases.
4. Invoices and itineraries match owner samples and render only recorded values; sending follows the approval rules.
5. Test suite green at every commit; expo-frozen surfaces untouched.

## Owner follow-ups (not worker tasks)

- Drop sample invoices/itineraries into `D:\Codex\WMIT\data\samples\` (any format) — unblocks todos 6–7.
- Disable or repurpose the `grace` test account before staff onboarding.
- Schedule a staging walkthrough when the VPS exists if staff time appears; otherwise cheat sheets carry training.
