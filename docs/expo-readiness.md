# Expo ship readiness — runbook

This runbook takes the WMIT expo tooling from your local machine to the
September 4–6 expo: a staging rehearsal on the VPS, the production cutover,
and the expo-day operations checklist, plus the owner-chosen stopgap of
hosting from the home PC through a Cloudflare Tunnel.

Every VPS step below cites the section of
[deployment-netcup.md](deployment-netcup.md) that owns it (by number and
name) instead of restating it — open that guide alongside this one.

**Placeholder convention:** `<your-domain>` (for example
`yourdomain.ph`) appears wherever your actual domain belongs — in DNS
records, URLs, and the `WMIT_BASE_URL` setting. `<vps-ip>` is your VPS's
IP address. The `<TUNNEL-UUID>` and Windows `<user>` values in the tunnel
section come from the `cloudflared tunnel create` output and your Windows
user profile path. Every other command is complete as written.

## Phase B — staging rehearsal (VPS, port 3001)

Goal: rehearse the entire expo workflow on synthetic data and train staff
before touching production.

1. Deploy a staging instance exactly as described in **deployment-netcup.md
   §7 "Staging on the same server (optional)"** — second instance, own
   database, port 3001, reached through the SSH tunnel
   (`ssh -L 3001:127.0.0.1:3001 wmit@<vps-ip>`), never exposed publicly.
2. In the staging console (`http://127.0.0.1:3001/expo-console.html`),
   create the real event for the fair: tag in the `EXPO-SEP26` style,
   dates September 4–6, 2026, status `ACTIVE` — via **Events → ＋ Add event**
   (see [events.md](events.md) → *Event registry*).
3. Walk the full flow once, end to end:
   - capture a kiosk lead at `http://127.0.0.1:3001/expo.html?expo=<tag>`;
   - watch it appear in the follow-up queue (day-1/3/7 tasks, [events.md](events.md)
     → *Staff workflow* step 4);
   - set real prices on the event's package templates — the seeded Bangkok /
     Seoul / Ho Chi Minh City prices are placeholders (console warning
     **placeholder prices, confirm before quoting**);
   - create a multi-option quote and email it (staging SMTP is usually not
     configured — the email lands as a `.eml` draft in the staging
     `data-staging/outbox/`, which is fine for rehearsal);
   - open the public quote link `/q/<token>` from the draft, accept an
     option;
   - mark the lead booked with a real `BOOKING-…` ID from the Operations
     workspace ([events.md](events.md) → *Staff workflow* step 6).
4. Train staff on the console tabs while on staging: Events, follow-up
   queue, package templates, quotes, dashboard. Staging seeds synthetic
   records, so nothing real is at risk.

**Acceptance:** one lead visible end-to-end (kiosk → follow-up → quote →
accept → booked) and every staff member can sign in and find their tab.
Phase B needs VPS access — it cannot be rehearsed on the home-PC tunnel,
which serves one production-style instance only.

## Phase C — production cutover

Goal: move the production instance to current code with a safety net.

1. **Back up first** — manual verified backup exactly per
   **deployment-netcup.md §6 "Backups (automatic) and restore
   (rehearsed)"**: `sudo -u wmit node /home/wmit/app/scripts/backup.js`.
2. **Update the code** per **deployment-netcup.md §8 "Updating"**: stop the
   service, copy/checkout the new code into `/home/wmit/app` (keep `.env`
   and `data/`), run `npm test`, start the service.
3. **Tick every item** of the unnumbered
   **"Security checklist before real client data"** section at the very end
   of [deployment-netcup.md](deployment-netcup.md) — it is *not* §9 (§9 is
   "Health and troubleshooting"). All six boxes: sessions enforced, admin
   password changed and the initial-password file deleted, strong staff
   passwords, HTTPS via Caddy, `.env` at 600 and untracked, at least one
   backup copied off the VPS.
4. **Verify:** `https://app.<your-domain>/api/health` returns
   `"ok": true` with the scheduler jobs listed (see
   **deployment-netcup.md §9 "Health and troubleshooting"** for how to read
   it).

## Phase D — expo-day operations checklist

Work through this before the doors open on September 4:

- [ ] Real event `ACTIVE` with dates September 4–6 (Events tab — not just
      the seeded fallback).
- [ ] Staff accounts created and signed in once from the booth tablet
      (six-hour sessions — sign in fresh on expo morning).
- [ ] SMTP live: send one test quote email and confirm it arrives — it
      must **not** be sitting in `data/outbox/` as a draft (until SMTP is
      verified, emails queue as drafts; see [events.md](events.md) →
      *Environment*).
- [ ] Real package prices confirmed — every placeholder replaced before
      the first quote goes out.
- [ ] Booth tablet kiosk test on the **venue WiFi**: open the event's form
      link, submit one test lead, see the Salamat screen, delete it from
      the console afterwards.
- [ ] Offline capture understood: if the connection drops, the kiosk saves
      submissions on the device and shows a *"N saved on this device"*
      badge; they send automatically (deduplicated) when the connection
      returns. Staff keep the tab open — nothing else to do.
- [ ] Fallback plan: if venue WiFi fails entirely, the tablet tether to a
      phone hotspot takes over; the queue drains on reconnect.
- [ ] Decide **who ends the event** after September 6 (Events tab → end) —
      closing the form keeps all history readable.
- [ ] Golden-quote acceptance test done — WMIT's pricing reproduced the
      prices actually charged on real past quotes
      ([golden-quote-acceptance.md](golden-quote-acceptance.md), ~15 min).
- [ ] Counsel review of the booking terms and voucher templates scheduled
      (or completed) — documents issued at the expo carry this wording
      ([counsel-review-package.md](counsel-review-package.md)).
- [ ] Email deliverability verified — SPF/DKIM/DMARC set and a test quote
      email scores well on mail-tester
      ([email-deliverability.md](email-deliverability.md)).

## Option — home-PC hosting via Cloudflare Tunnel (stopgap)

Owner-chosen bridge for training and demos while the VPS settles: the home
PC runs the WMIT server; Cloudflare Tunnel exposes it on your domain with
HTTPS. It is **not** the expo-day plan (see decision rule below).

**Prerequisite:** a domain with DNS on Cloudflare (free plan works). The
netcup-registered domain can be delegated by replacing its nameservers with
the two Cloudflare assigns (netcup CCP → Domains → DNS), or delegate only a
subdomain if you prefer.

On the Windows PC (PowerShell):

```powershell
winget install Cloudflare.cloudflared
cloudflared tunnel login                 # opens the browser, pick your domain
cloudflared tunnel create wmit           # prints the TUNNEL-UUID
```

Write `%USERPROFILE%\.cloudflared\config.yml` — complete file, only the
two `<…>` values come from the `tunnel create` output and your domain:

```yaml
tunnel: <TUNNEL-UUID from `cloudflared tunnel create` output>
credentials-file: C:\Users\<user>\.cloudflared\<TUNNEL-UUID>.json
ingress:
  - hostname: app.<your-domain>
    service: http://localhost:3000
  - service: http_status: 404
```

Then route DNS, run it, and install it as a boot service:

```powershell
cloudflared tunnel route dns wmit app.<your-domain>
cloudflared tunnel run wmit
# once it works, as administrator:
cloudflared service install
```

Server side (the PC), production-style settings:

```powershell
$env:WMIT_ENV='production'; $env:WMIT_BASE_URL='https://app.<your-domain>'; $env:WMIT_ENFORCE_SESSIONS='true'; node scripts/run-server.js
```

`WMIT_BASE_URL` must be the public https URL so emailed quote links are
correct ([events.md](events.md) → *Environment*). First production boot
creates the `admin` account and writes its generated password once to
`data/initial-admin-password.txt` — sign in, change it, delete the file.

**Honest limits:** home-PC uptime is agency uptime (disable sleep, expect
Windows Update reboots); there are no nightly off-site backups on this
setup; it is a single machine. Acceptable for training and bridge use —
not for the expo. Quick `trycloudflare.com` disposable URLs are ephemeral
and rejected for staff links.

## Decision rule

**VPS before September 4, regardless of the tunnel.** The expo kiosk must
not depend on a home connection. The tunnel is a bridge, the VPS is the
plan.
