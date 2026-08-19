# Deploying WMIT on netcup Webhosting 4000 (Plesk Node.js)

This guide runs the WMIT hosted server on netcup Webhosting 4000 through
Plesk's Node.js support (Phusion Passenger). No root access and no `npm
install` are needed: WMIT has **zero npm dependencies** — SQLite is Node's
built-in `node:sqlite` module, and the SMTP mailer is implemented with
Node's standard libraries.

The VPS guide ([deployment-netcup.md](deployment-netcup.md)) remains the
alternative with full root control and PDF-extraction tooling.

## Check these two things first

1. **Node.js version.** WMIT needs **Node 22.13 or newer** (the built-in
   `node:sqlite` module). In Plesk → your domain → **Node.js**, open the
   *Node.js Version* dropdown. If no 22+ version is listed, stop and contact
   netcup support (or use the VPS guide) — older Node versions cannot run WMIT.
2. **Process uptime.** Passenger keeps Node processes alive, but shared hosting
   may recycle them. After setup, check the scheduler heartbeat (see
   "Keep-alive" below). The design assumption is: the process may restart at
   any time, so an external uptime monitor is part of this deployment.

## How Passenger runs WMIT (why nothing needs to change)

Passenger does not use ports. It intercepts Node's
`http.Server.prototype.listen` and binds the app to a private Unix socket;
the port and host arguments WMIT passes are ignored. WMIT's standard
`server.listen(port, host)` startup therefore works unchanged. Two Passenger
rules matter:

- The app may call `listen()` **once** (WMIT does — one server).
- "Restart App" in Plesk is *lazy*: the old process keeps running until the
  next request. After every restart or update, **open the site URL once**
  yourself to apply the change.

## 1. Prepare the package (on your PC)

From the repository root (PowerShell):

```powershell
cd D:\Codex
tar --exclude=node_modules --exclude=.git --exclude=data --exclude=.env --exclude=tmp --exclude=*.log --exclude=WMIT/.codegraph --exclude=WMIT/.opencode --exclude=WMIT/.codex --exclude=WMIT/.omo --exclude=WMIT/.agent --exclude=WMIT/.agents --exclude=WMIT/.claude --exclude=WMIT/.gemini --exclude=WMIT/.impeccable --exclude=WMIT/.playwright-mcp --exclude=WMIT/tests --exclude=WMIT/apps-script --exclude=WMIT/docs --exclude=WMIT/templates --exclude=WMIT/agents --exclude=WMIT/adapters --exclude=WMIT/config --exclude=WMIT/output --exclude=WMIT/attendance-reference -czf wmit.tar.gz WMIT
```

Two groups of excludes:

- **Dev tooling** (`node_modules`, `.git`, `data`, `.env`, `tmp`, `*.log`, the dotted agent/index folders) never belongs on the server.
- **Non-runtime repo content** is anchored to `WMIT/…` because bare names would also strip same-named folders inside `src/` (e.g. a bare `--exclude=adapters` would delete `src/adapters` and break the server). The server only runs `package.json`, `scripts/`, `src/`, and `app/` — tests, the Apps Script artifact, and docs stay on your PC.

Run `npm test` on your PC **before** packaging: the test suite is not uploaded, so this is where correctness is checked.

Expected result: `wmit.tar.gz` of roughly 1–2 MB containing `package.json`, `scripts/`, `src/`, `app/` (plus the repo's top-level files). If it is 50 MB or more, an exclude is wrong — check what got included before uploading.

## 2. Create the subdomain

In Plesk: **Websites & Domains → Add Subdomain** → `app` (gives
`app.yourdomain.ph`). Then **Websites & Domains → app.yourdomain.ph →
SSL/TLS Certificates → Let's Encrypt** — tick *Secure the domain*, issue the
free certificate, and switch on *Redirect to HTTPS*.

## 3. Upload the code

**Websites & Domains → app.yourdomain.ph → File Manager**:

1. Open the subdomain's `httpdocs` and delete Plesk's default files.
2. Upload `wmit.tar.gz`, click it, choose **Extract** (extracts into a
   `WMIT` folder — open it, select everything, **Move** all contents up into
   `httpdocs` itself, then delete the empty `WMIT` folder and the tarball).
3. Create an empty folder `httpdocs/public` (the Document Root — see next
   step) and an empty folder `private/wmit-data` (the database home, never
   web-served).

Expected result: `httpdocs` contains `package.json`, `scripts/`, `src/`,
`app/`, `public/`, and `private/wmit-data/` exists beside `httpdocs`.

## 4. Enable Node.js

**Websites & Domains → app.yourdomain.ph → Node.js**:

| Setting | Value |
|---|---|
| Node.js Version | **22.x or newer** (the pre-check) |
| Application Root | `httpdocs` (default) |
| Document Root | `httpdocs/public` (the empty folder — anything under the Document Root is web-served, so keeping it empty sends every request to the app and keeps `data/`, `.env`, and source files private) |
| Application Mode | **Production** |
| Application Startup File | `scripts/run-server.js` |

Click **Enable Node.js**. Do **not** click "NPM install" — WMIT has no
dependencies to install.

## 5. Environment variables

Still in the Node.js panel, open **Custom environment variables** (Linux) and
add:

| Name | Value |
|---|---|
| `WMIT_ENV` | `production` |
| `WMIT_ENFORCE_SESSIONS` | `true` |
| `WMIT_DATA_DIR` | `/var/www/vhosts/app.yourdomain.ph/private/wmit-data` (adjust to the absolute path shown in File Manager) |
| `WMIT_BASE_URL` | `https://app.yourdomain.ph` |
| `WMIT_SMTP_HOST` | your netcup outgoing mail server (see CCP → Mail) |
| `WMIT_SMTP_PORT` | `587` |
| `WMIT_SMTP_MODE` | `starttls` |
| `WMIT_SMTP_USER` | `wmit@yourdomain.ph` |
| `WMIT_SMTP_PASSWORD` | the mailbox password |
| `WMIT_SMTP_FROM` | `wmit@yourdomain.ph` |
| `WMIT_DIGEST_TO` | owner's email address |

(SMTP is optional at first: without it, outgoing email is written as `.eml`
drafts under the data directory — nothing breaks.)

## 6. Start and sign in

1. Click **Restart App**.
2. Open `https://app.yourdomain.ph` in your browser — this also triggers the
   lazy restart.
3. Expected result: the WMIT sign-in page.
4. In File Manager, open `private/wmit-data/initial-admin-password.txt`,
   copy the temporary `admin` password, sign in, **change the password in
   Settings**, then delete the file.
5. Create staff accounts (Settings → accounts).

Logs: **Websites & Domains → Logs** (filter "Node.js") show the app's
console output, including the startup banner with scheduler status.

## Keep-alive and the nightly jobs

The scheduler (nightly verified backups 01:15 Manila, daily digest, expo
follow-ups every 15 minutes) runs inside the Node process. Two habits keep it
reliable on shared hosting:

- **Uptime monitor:** sign up at uptimerobot.com (free), add an HTTP monitor
  for `https://app.yourdomain.ph/api/health` every 5 minutes. This both keeps
  Passenger from idling the app and emails you if the site ever goes down.
- **Offsite backups:** backups land in `private/wmit-data/backups/`. Once a
  week, download the latest via File Manager to your PC. (The automatic
  restore rehearsal still runs server-side.)

## Updating the app

1. Upload the new `wmit.tar.gz`, extract, move contents into `httpdocs`
   (overwrite), delete the tarball.
2. Click **Restart App**.
3. Open the URL once (lazy restart).

## Known limits on webhosting

- **PDF tariff extraction is unavailable** (no `pdftotext`/Python on shared
  hosting). The Tariff Library still works via **paste-upload** (copy the
  rate table text into the upload form) and manual tariff entry; PDF uploads
  return a clear warning instead of extracted text.
- Logins are rate-limited per username (not IP), so Passenger's proxying
  does not affect the limiter.
- If the process is ever recycled at exactly 01:15 Manila, that night's
  backup is skipped — the uptime monitor plus weekly offsite download covers
  this.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "502 Bad Gateway" after enabling | Startup file wrong (must be `scripts/run-server.js`) or Node version < 22. Check the Node.js log. |
| App serves old code after update | Lazy restart — open the URL once more, or wait a minute and reload. |
| `initial-admin-password.txt` missing | The data directory was already initialized. On a fresh deploy, the file is written on first boot only. |
| Cannot enable Node.js | The extension/permission must be present on the subscription; contact netcup support with "Node.js Panel fehlt" / "Node.js button missing". |
| Database locked errors | Should not occur (WAL mode with busy timeout); if seen after a crash, Restart App once. |

## Moving away later (VPS or elsewhere)

Nothing is locked in: the entire system is the code plus one SQLite file in
`private/wmit-data/`. Download a backup, follow the VPS guide's restore step,
done.
