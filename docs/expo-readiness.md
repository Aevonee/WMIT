# Expo ship readiness — runbook

This runbook takes the WMIT expo tooling from your local machine to the
September 4–6 expo: a staging rehearsal on your PC, the production cutover on
the hosted server, and the expo-day operations checklist.

The deployment home (owner decision, August 19 2026) is **netcup Webhosting
4000 via Plesk Node.js** — every production step below belongs to
[deployment-webhosting.md](deployment-webhosting.md), which you should open
alongside this guide. The VPS guide
([deployment-netcup.md](deployment-netcup.md)) remains the alternative for a
future move; nothing in this runbook needs it.

**Timing:** today is August 19. The expo opens September 4. Phases B and C
should both be finished by **August 29** — that leaves a full spare week for
surprises.

## Phase B — staging rehearsal (your PC, this week)

Goal: rehearse the entire expo workflow on synthetic data and train staff
before touching production. Staging runs on your own machine.

1. From the repository root (PowerShell):

   ```powershell
   $env:WMIT_ENV='staging'; node scripts/run-server.js
   ```

   Expected result: the startup banner prints `staging`, sessions are
   enforced, and synthetic records are seeded automatically. The console
   shows the scheduler jobs. Leave this window open; Ctrl+C stops it.

2. Open `http://127.0.0.1:3000/expo-console.html` in your browser and sign in
   with the staging admin account. First boot only: the temporary password is
   in `data/initial-admin-password.txt` — sign in, change it in Settings,
   then delete that file.

3. Create the real event for the fair: tag in the `EXPO-SEP26` style, dates
   September 4–6 2026, status `ACTIVE` — via **Events → ＋ Add event**
   (see [events.md](events.md) → *Event registry*).

4. Walk the full flow once, end to end:

   - capture a kiosk lead at `http://127.0.0.1:3000/expo.html?expo=<tag>`;
   - watch it appear in the follow-up queue (day-1/3/7 tasks, [events.md](events.md)
     → *Staff workflow* step 4);
   - set real prices on the event's package templates — the seeded Bangkok /
     Seoul / Ho Chi Minh City prices are placeholders (console warning
     **placeholder prices, confirm before quoting**);
   - create a multi-option quote and email it — without SMTP the email lands
     as a `.eml` draft in `data/outbox/`, which is fine for rehearsal;
   - open the public quote link `/q/<token>` (the link inside the draft),
     accept an option;
   - mark the lead booked with a real `BOOKING-…` ID from the Operations
     workspace ([events.md](events.md) → *Staff workflow* step 6).

**Acceptance:** one lead visible end-to-end (kiosk → follow-up → quote →
accept → booked) and every staff member can sign in and find their tab.

**Alternative — shared staging subdomain:** if staff must rehearse from their
own machines, create a second subdomain (e.g. `staging.yourdomain.ph`) as a
separate Plesk Node.js app with its own `private/wmit-data` directory, using
the same steps as [deployment-webhosting.md](deployment-webhosting.md) with
`WMIT_ENV=staging`. More setup work; only worth it when staff cannot gather
around one PC.

## Phase C — production cutover (webhosting, by August 29)

Goal: get the real system live with a safety net.

1. **Deploy the app** by following
   [deployment-webhosting.md](deployment-webhosting.md) from the start
   (subdomain, package upload, Node.js enable, environment variables) or —
   if it is already deployed — its *Updating the app* section (upload the new
   tar, extract, move contents, **Restart App**, open the URL once for the
   lazy restart).
2. **Pre-cutover backup:** if real data already exists on the server, open
   Plesk **File Manager → private/wmit-data/backups/** and download the
   newest `wmit-….sqlite3` to your PC before updating code.
3. **Security checklist** (webhosting edition — all six):

   - [ ] `WMIT_ENV=production` and `WMIT_ENFORCE_SESSIONS=true` are set in
         the Plesk Node.js panel.
   - [ ] Admin password changed and `private/wmit-data/initial-admin-password.txt`
         deleted after first sign-in.
   - [ ] Staff accounts created with strong unique passwords (Settings →
         accounts); intern accounts stay read-only by design.
   - [ ] HTTPS works: the Let's Encrypt certificate is issued and *Redirect
         to HTTPS* is on.
   - [ ] `WMIT_BASE_URL` is the public https URL (e.g.
         `https://app.yourdomain.ph`) — emailed quote links are built from
         it. The server now warns at startup if this is left at a loopback
         address in production; heed the warning.
   - [ ] Uptime monitor live: an uptimerobot.com HTTP monitor on
         `https://app.yourdomain.ph/api/health` every 5 minutes.
4. **Verify:** open `https://app.yourdomain.ph/api/health` — expected result:
   `"ok": true` with the scheduler jobs listed
   (`heartbeat`, `backup`, `digest`, `expo-followups`).
5. **Create the real production event** exactly as in Phase B step 3, and set
   the real package prices. Production does **not** seed synthetic records —
   what you create is what exists.

## Phase D — expo-day operations checklist

Work through this before the doors open on September 4:

- [ ] Real event `ACTIVE` with dates September 4–6 (Events tab — not just
      the seeded fallback).
- [ ] Staff accounts created and signed in once from the booth tablet
      (six-hour sessions — sign in fresh on expo morning).
- [ ] SMTP live: send one test quote email and confirm it arrives — it
      must **not** be sitting in `private/wmit-data/outbox/` as a draft
      (until SMTP is verified, emails queue as drafts; see
      [events.md](events.md) → *Environment*).
- [ ] Real package prices confirmed — every placeholder replaced before the
      first quote goes out.
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

## Emergency fallback (not the plan)

If the hosted server is unreachable on expo day and cannot be revived
quickly, the home-PC bridge (run `WMIT_ENV=production node scripts/run-server.js`
locally behind a Cloudflare Tunnel) can serve the kiosk temporarily. It has
no nightly off-site backups and depends on one home connection — use it only
to keep capturing leads, and reconcile into production afterwards. The full
tunnel setup lives in this file's git history (August 2026 revision).

## Decision rule

**Production on the hosted server before September 4.** Rehearse on the PC
this week; cut over by August 29; keep the last week clear for staff
training on the live system and the Phase D checklist.
