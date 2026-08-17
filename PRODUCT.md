# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The system is used daily by a small Philippine travel-agency team:

- **Owner** — runs the agency; holds manager/finance authority and final approval over money, refunds, and commitments.
- **2 admins** — elevated authority for operational and financial actions.
- **3 staff** — day-to-day sales and operations: inquiries, quotations, bookings, supplier coordination, follow-ups, documents.
- **Interns** — restricted task/training access with supervisor review (limited surface, no financial or sensitive-document operations).

Usage scenes (all confirmed): office desktop PCs as the primary data-entry environment; laptops on remote/hybrid days; phones for owner/manager checks of dashboards, approvals, and follow-ups on the go; tablets at expo booths for lead capture and quotation delivery.

## Product Purpose

WMIT is the AI-assisted operating system for Worldmaster International Travel. It replaces spreadsheet re-entry and manual coordination with one structured store plus controlled business functions covering inbound/outbound travel, Worldmaster-owned departures, wholesaler products, land arrangements, custom travel, document processing, intern tasks, and B2B/B2C expos.

Success means: staff enter information once, the system carries it across the workflow (lead → inquiry → quotation → booking → payments → departure), and humans keep control over every customer, financial, supplier, booking, and sensitive-document decision.

## Positioning

A single structured source of truth behind one whitelisted action dispatcher, with centrally generated immutable IDs, a hash-chained audit log, and risk-tiered human approval gates on money, refunds, deletions, external bookings, and supplier purchases. A generic CRM or booking tool could copy features but not this approval-gated, fully-audited, travel-operations record model (requirement tracking, departures, document cases, expo lead-capture → quote → follow-up pipeline) wired to the agency's actual approval discipline.

## Operating Context

- Philippine travel agency; business timezone Asia/Manila; year-based IDs use the business timezone.
- Hosted on the owner's netcup VPS: Node.js + SQLite server, Caddy for HTTPS, SMTP through the owner's domain mailbox. Nightly verified backups with restore rehearsal run inside the server.
- Staff-facing console: Operations Workspace (`/operations.html`, 14 workspaces). Public-facing surfaces: per-event expo sign-up form (`/expo.html`), public quotation links (`/q/<token>`). Staff expo console: `/expo-console.html`.
- Session authentication with staff/finance/management/intern access separation; production enforces sign-in.
- Near-term business driver: the September 4–6 expo — expo lead capture, quote delivery, and follow-up tooling take priority over further architecture work until it ships.
- The original Google Workspace design (Sheets + Apps Script) is a retained working artifact under `apps-script/`, not a deployment target.
- Development and testing run locally against synthetic data only; no business data lives in the repository.

## Capabilities and Constraints

- SQLite database is the structured source of truth; all changes flow through one whitelisted action dispatcher (agents and UIs never edit records directly).
- Immutable, centrally generated, human-readable IDs for important records; structured data links by ID, never by name alone.
- Financial values keep supplier cost, client price, fees, payments, receivables, payables, commissions, and margin as separate concepts; the system never silently modifies money, invoices, refunds, or payment statuses.
- Risk-tiered approvals: low-risk actions proceed; medium-risk require confirmation per policy; high-risk (refunds, financial adjustments, deletion, external bookings, supplier purchases, sensitive documents/communication) always require explicit human confirmation.
- Every meaningful action records actor, action, record ID, old/new values, result, and error — hash-chained on the hosted server.
- External integrations are optional and behind adapters; WMIT must not depend on one travel website or mail provider.
- The system must never claim live availability, current pricing, or confirmed arrangements unless an authorized source returned and verified them; low-confidence extraction is flagged, not silently committed.
- Confirmed product decision: **WCAG AA is the accessibility baseline for staff surfaces** (see Accessibility & Inclusion).

## Brand Commitments

- Name: **Worldmaster International Travel** (WMIT).
- Existing brand assets in active use: `app/public/assets/wmit-logo.png` and `app/public/assets/header.png` (the header image appears on client-facing quotation previews).

## Evidence on Hand

- Client-document templates (text-first drafts pending counsel/owner review): `docs/templates/` — Master Booking Terms, Package-Specific Tour Voucher, internal voucher confirmation checklist.
- Brand assets: `app/public/assets/wmit-logo.png`, `app/public/assets/header.png`.
- Documentation: `README.md`, `AGENTS.md`, `docs/deployment-netcup.md`, `docs/operations-mvp.md`, `docs/events.md`, `docs/id-registry.md`.
- **Absences future work must respect**: no real client data, testimonials, customer names, real pricing, or performance claims exist in the repository — nothing may be fabricated for demos or marketing surfaces. The expo lead-capture and quotation flows are demonstrated on synthetic data until real expo events run.

## Product Principles

1. **Humans decide; the system prepares.** Drafts, recommendations, and automation are allowed; money, refunds, commitments, and sensitive actions always stop for explicit human approval.
2. **One structured truth.** A single SQLite store behind one controlled action dispatcher — no parallel stores, no direct record edits, no re-entry between workflow stages.
3. **Everything auditable.** Immutable IDs, hash-chained logs, old/new values, and actors on every meaningful action; failures are recorded, never swallowed.
4. **Fail visibly.** State when information is unavailable, conflicting, or uncertain; flag low-confidence output instead of silently committing it.
5. **Ship what the business deadline needs.** Expo lead capture, quote delivery, and follow-up tooling outrank further architecture work until the expo ships.

## Accessibility & Inclusion

- **WCAG AA is the confirmed baseline** for staff surfaces (Operations Workspace, expo console, login).
- Staff use the Operations Workspace all day, every day — readable default text sizes and sustainable contrast on dense tables are product requirements, not polish.
- Usage spans desktop monitors down to expo tablets and phones; core flows must remain operable at every confirmed device class.
