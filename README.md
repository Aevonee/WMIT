# WMIT — Worldmaster International Travel

WMIT is the AI-assisted operating system for Worldmaster International Travel, a Philippine travel agency serving inbound, outbound, group, wholesaler, land-arrangement, custom-travel, document-processing, intern, and expo workflows.

## Current status

The deployment target is the **hosted WMIT server**: Node.js + SQLite with session authentication, a hash-chained audit log, scheduled verified backups, and an SMTP mailer. It runs on the owner's netcup VPS behind Caddy (see [docs/deployment-netcup.md](docs/deployment-netcup.md)); development and tests run anywhere Node 22+ is installed, including your local machine.

The repository also contains the local synthetic WMIT vertical slice (Phase 1–2 operational model, document-intelligence prototypes, six-case regression) and the retained Google Apps Script artifact under `apps-script/`. No business data exists in the repository; `data/` (databases, backups, outbox) is gitignored.

Reusable client-document templates are under [docs/templates](docs/templates): Master Booking Terms, Package-Specific Tour Voucher, and the internal voucher confirmation checklist. Templates are text-first drafts for counsel/owner review and later Docs conversion.

## Design principles

- The hosted server's SQLite database is the structured source of truth; the Apps Script/Sheets layer is a retained working artifact, not the target.
- Business functions run through one whitelisted action dispatcher; agents never edit records directly.
- Every important record has a centrally generated immutable ID (registry: [docs/id-registry.md](docs/id-registry.md)).
- Audit entries record actor, action, old/new values, failures, and are hash-chained on the hosted server.
- Financial commitments, external bookings, sensitive messages, refunds, and deletion require human approval; refunds additionally require explicit confirmation and verified client funds.
- Drafts and recommendations are allowed; the system never silently modifies money, invoices, refunds, or payment statuses.

## Run it

### Hosted server (deployment target)

```text
npm start
```

Environment variables or a `.env` file control everything — `WMIT_ENV` (development/staging/production), database location, SMTP credentials, digest recipient. Production enforces session sign-in; development stays on loopback without sessions. First boot creates the `admin` account and (when the password was generated) writes it once to `data/initial-admin-password.txt`. Full setup: [docs/deployment-netcup.md](docs/deployment-netcup.md).

### Local development MVP

```text
npm run start:local
```

Then open `http://127.0.0.1:3000`. See [docs/operations-mvp.md](docs/operations-mvp.md) for the workflow and limitations.

### Tests and acceptance

```text
npm test              # full unit + integration suite
npm run acceptance    # end-to-end HTTP workflow against the local server
```

### Events & expo tooling

Event registry (create the next expo, browse ended ones as history),
per-event lead-capture sign-up form, badge import, day-1/3/7 follow-up
queue, package templates, multi-option quote delivery, and the conversion
dashboard run inside the hosted server. Staff console: `/expo-console.html`
(Events); sign-up form: `/expo.html` (per event via `?expo=TAG`); public
quotation links: `/q/<token>`. Details: [docs/events.md](docs/events.md).

### Backups

```text
npm run backup
npm run restore -- data/backups/<file>.sqlite3
```

Nightly backups (01:15 Manila) with automatic restore rehearsal run inside the hosted server; see the deployment guide.
