# Events & Expo Tooling

The Events module (linked from the Operations workspace as **Events**) runs
lead capture, follow-ups, package templates, multi-option quote delivery,
and the conversion dashboard — for the September 4–6 expo and every future
event. Everything runs inside the hosted server (`npm start`) on the same
SQLite runtime, session authentication, audit log, mailer, and scheduler as
the rest of WMIT.

## Event registry

Every event is an `ExpoEvent` record (`EXPO_EVENT-YYYY-NNNNNN`) with a unique
tag, dates, and status `ACTIVE` or `ENDED`. `EXPO-2026` (September 4–6) is
seeded automatically at first boot. Staff create the next event from the
console before the current one ends; each new event starts with its own
three seeded placeholder packages.

**Each entry belongs to its event.** Leads, package templates, quotes,
follow-up tasks, and the dashboard are all scoped by the event's
`expo_tag` — nothing leaks between events, and ended events remain fully
browsable as history.

- **Current event rule** (what the sign-up form serves when no tag is
  given): the soonest upcoming `ACTIVE` event; if none is dated in the
  future, the most recently started one. Pre-creating next year's fair
  never steals the kiosk.
- **Ending an event** closes its sign-up form (`EXPO_NOT_ACTIVE`) but keeps
  its leads, quotes, and dashboard readable. Events can be reopened.
- **Kiosk pinning:** `/expo.html?expo=TAG` serves that specific event
  (while `ACTIVE`). The Events tab and the console bar both show the
  copyable per-event form link.

## Pieces

| Piece | Where |
|---|---|
| Sign-up form (public, 30-second, per event) | `app/public/expo.html` → `GET /api/public/expo/config`, `POST /api/public/expo/lead` |
| Event registry (create, list, end/reopen) | `GET /api/expo/expos`; `POST /api/expo/expos/create`, `/status` |
| Badge bulk import (CSV or name-per-line) | Events console → `POST /api/expo/leads/import` |
| Follow-up queue (day 1/3/7, WA/Viber links) | `GET /api/expo/followups` + console tab; scheduler job `expo-followups` |
| Package templates (manual pricing, per event) | `GET/POST /api/expo/templates*` + console tab |
| Multi-option quotes + branded public page | `POST /api/expo/quotes/create`, `/send`, `/link`; public page `/q/<token>` |
| Conversion dashboard (per event) | `GET /api/expo/dashboard` + console tab |

All list endpoints accept `?expo_tag=`; the console's event selector
(including ended events) applies it everywhere.

## Public channel rules (ported from the Apps Script design)

- `/api/public/expo/*` needs **no session** and has its own rate limiting:
  one submission per mobile per minute, 30 submissions per 10 minutes
  globally, and accept/decline actions per token per 30 seconds.
- Failed validations never consume quota; idempotent retries (kiosk
  `idempotency_key`, double-accept) are free and replay the original result.
- Public quote links carry a random 48-hex token; only its SHA-256 hash is
  stored. Issuing a new link invalidates older tokens for that quote.
- Public quote data never includes the mobile number or email.
- Leads can only be captured into `ACTIVE` events; unknown tags are
  rejected (`EXPO_NOT_FOUND`).

## Staff workflow

1. **Before an event:** open `/expo-console.html`, select the event in the
   bar, review its seeded placeholder packages (Bangkok / Seoul / Ho Chi
   Minh City — **placeholder prices, confirm before quoting**), and set
   real prices as suppliers confirm. Seeding runs once per event; edits are
   never overwritten. Use **Events → ＋ Add event** for the next fair.
2. **At the booth:** tablets open the event's form link (Copy form link in
   the console bar, or `/expo.html` for the current event). A stable
   idempotency key per submission means double-taps never duplicate a lead.
3. **Scanned badges:** paste one per line in the import box —
   `name,mobile,destination,travel_month,email` CSV or names only with
   defaults. Name-only rows import with `NEEDS MOBILE`; attach the number
   on first contact ("Add mobile") to light up the chat links.
4. **Follow-ups:** the scheduler (and each capture) creates day-1/3/7
   tasks. The queue shows overdue items first with one-click WhatsApp
   (prefilled message) and Viber deep links. Completing a follow-up moves a
   NEW lead to CONTACTED automatically. Marking a lead
   LOST/UNREACHABLE/BOOKED cancels its remaining follow-ups.
5. **Quoting:** pick 2–3 of the event's packages (cross-event templates are
   rejected), optionally override prices, create the quote, then **Email
   quote** (SMTP when configured, otherwise a reviewable `.eml` draft in
   `data/outbox/` — nothing is silently lost) or **Get link** and paste it
   into WhatsApp/Viber yourself.
6. **Closing:** the client accepts on the public page. Once the real
   Booking exists in the Operations workspace, **Mark booked** with its
   `BOOKING-…` ID — this closes the funnel, credits revenue, and cancels
   remaining follow-ups. When the event is over, mark it ended in the
   Events tab; its history stays one selector-click away.

## Dashboard

`GET /api/expo/dashboard` (scoped to the selected event) reports leads →
quotes sent → accepted → booked with conversion percentages, PHP revenue
from linked bookings, per-day activity, and per-package offer/accept
counts — the negotiation baseline for the next event.

## IDs

`EXPO_EVENT-YYYY-NNNNNN`, `EXPO_LEAD-YYYY-NNNNNN`,
`EXPO_PACKAGE-YYYY-NNNNNN`, `EXPO_QUOTE-YYYY-NNNNNN` (see
`docs/id-registry.md`). Every staff/public action writes the normal
hash-chained audit log (`PUBLIC_EXPO_KIOSK`, `PUBLIC_EXPO_CLIENT`,
`USER:<username>`, `SCHEDULER_EXPO`).

## Environment

Nothing new is required. `WMIT_BASE_URL` must be set to the public URL
(Caddy https) so emailed quote links are correct — quote links are built
from it. SMTP is optional until the VPS mailbox is verified; until then all
quote emails land in the outbox as drafts.
