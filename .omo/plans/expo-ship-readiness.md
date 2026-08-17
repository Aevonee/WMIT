# expo-ship-readiness - Work Plan

## TL;DR (For humans)

**What you'll get:** an expo kiosk that keeps capturing leads when the venue WiFi drops (saves on the tablet, sends automatically when the connection returns, never duplicates or silently loses a lead), your whole project under git for the first time, and a step-by-step ship runbook covering VPS staging, production cutover, expo-day operations, and your chosen Cloudflare Tunnel option for hosting from your home PC meanwhile.

**Why this approach:** the server already guarantees exactly-once lead delivery (idempotency keys) and rate limiting — so offline capture is purely a browser-side queue, ~150 lines in one file, no server risk 18 days before the expo. Phases B–D stay in your hands because they need your VPS, DNS, and mailbox; the runbook makes them question-free.

**What it will NOT do:** no server or business-logic changes, no Apps Script deployment (repo policy forbids it), no new dependencies, and the worker never touches the VPS.

**Effort:** one worker session, roughly half a day — 4 todos: git baseline → offline capture + browser QA → ship runbook → docs note.

**Risk:** low. The online fast path is untouched and regression-gated by the 244-test suite; the queue's failure modes (invalid lead, rate-limited flush, tab closed mid-send) are each specified and tested.

**Decisions:** Cloudflare Tunnel for home-PC access (yours); queue drops permanently-invalid leads but retries rate-limited ones; placeholder git identity until you set your real one.

## Scope

**IN:**
1. Offline lead capture for the expo kiosk (`app/public/expo.html` only): localStorage queue, auto-flush, pending badge, offline saved-state.
2. Git baseline for the repo: artifact hygiene, `.gitignore` additions, `git init -b main`, initial commit.
3. `docs/expo-readiness.md`: deployment runbook — Phase B (VPS staging walk), Phase C (production cutover), Phase D (expo-day ops), plus the owner-chosen **Cloudflare Tunnel home-hosting** section.
4. `docs/events.md`: offline-capture note in the booth workflow section.

**OUT / Must-NOT-Have:**
- NO server code changes (`app/server.js`, `src/**` untouched) — offline capture is purely client-side; the API contract is already sufficient (idempotency at `src/expo/expo-service.js:276–279`, `RATE_LIMITED` at `:282–284`).
- NO Apps Script changes or deployment (AGENTS.md forbids; superseded artifact).
- NO new npm dependencies, no build step, no service worker, no background sync API — localStorage + timers only.
- NO secrets, tokens, or personal data in commits; screenshots moved out of the repo root are NOT committed.
- NO VPS operations from the worker session — Phases B–D are owner-executed from the runbook.

**Key facts the executor relies on (verified):**
- Server replays identical `idempotency_key` submissions for free, BEFORE rate limits (`expo-service.js:276–279` → `IDEMPOTENT_REPLAY`). The kiosk already generates `'KIOSK:' + uuid` per fill (`expo.html:240–243`).
- Rate limits: 1 lead/mobile/minute AND 30 leads/10 min globally (`expo-service.js:94–98`). A burst flush of >30 queued leads WILL receive `RATE_LIMITED` — the flush loop must treat it as retry-later, never drop.
- Terminal 4xx rejections that can never succeed on retry: validation errors (`REQUIRED_FIELD`, `EMAIL_INVALID`, `TRAVEL_MONTH_INVALID`, `NAME_TOO_LONG`, …), `EXPO_NOT_FOUND`, `EXPO_NOT_ACTIVE` — drop these from the queue (with console log), per `events.md` "Public channel rules".
- Local dev server accepts real leads now: virtual `EXPO-2026` fallback is ACTIVE 2026-09-04→06 (`expo-service.js:140–152`) — end-to-end QA needs no mocks, but QA MUST use distinct mobile numbers per submission (per-mobile cooldown).
- Server is currently running locally via `scripts/run-mvp.js` on `127.0.0.1:3000` (PID file at `%TEMP%\opencode\wmit-server.pid`); restart it if dead: `node scripts/run-mvp.js` from `D:\Codex\WMIT`.
- `D:\Codex\WMIT` is NOT a git repo yet (verified this session); `.gitignore` already covers `.env`, `data/`, `node_modules/`, impeccable-live runtime.
- Working directory contains 12 `wmit-*.png` evidence screenshots in the root and an untracked `.playwright-mcp/` directory.

## Verification strategy

- **Browser QA (primary, for todo 2):** Playwright MCP against `http://127.0.0.1:3000/expo.html` — offline submit (aborted route) → badge shows → reconnect → queue drains → exactly ONE `ExpoLead` server-side per submission. State check via `GET /api/phase1/state` (verify at execution start that it exists and needs no session in local dev; if not, restart server via PID file note below). Mobile numbers in QA MUST be exactly 11 digits starting `09` (server pattern `^0\d{10}$`): generate as `'0917' + String(Date.now()).slice(-7)` — a raw `0917+timestamp` is 17 digits and fails `MOBILE_INVALID`. The rate limiter is in-memory: if QA re-runs trip the global 30/10-min cap, restart `scripts/run-mvp.js` to reset it.
- **Regression gate:** `npm test` (244 tests) green after every todo that touches code.
- **Agent-executed, zero human QA.** Evidence: screenshots under `.playwright-mcp/` (already gitignored per todo 1) and console transcripts.
- **Structural self-check** (this plan): all task rows column-zero, grammar `- [ ] N. …` / `- [ ] F<n>. …`.

## Execution strategy

Single worker session, sequential waves (each todo commits before the next starts). No worktrees needed (first commit establishes the repo). If the design hook or comment hook fires on edits, follow its triage; disclose suppressions in the commit message.

## Todos

- [x] 1. Git baseline: hygiene + init + initial commit
  **References:** `D:\Codex\WMIT\.gitignore` (exists, 54 lines); root artifacts `wmit-*.png` (12 files, evidence screenshots); `.playwright-mcp/` (untracked logs/screenshots); `.omo/drafts/` (plan runtime); `.omo/plans/` (this plan — COMMIT it).
  **Steps:**
  1. Move all `D:\Codex\WMIT\wmit-*.png` into `D:\Codex\WMIT\.playwright-mcp\` (they are browser-QA evidence, not product assets).
  2. Append to `.gitignore`:
     ```
     # Planning runtime (plans are committed; drafts/local state are not)
     .omo/drafts/
     .omo/*.json
     # Browser automation evidence
     .playwright-mcp/
     ```
  3. `git init -b main` in `D:\Codex\WMIT`.
  4. Set identity: if `git config user.email` is empty globally, set repo-local `git config user.name "WMIT Owner"` and `git config user.email "owner@wmit.local"` (disclose in commit body: placeholder identity, amend later with `git commit --amend --reset-author` once real identity is set).
  5. `git add -A && git commit -m "WMIT baseline: hosted server, operations workspace, expo tooling, design system"` — verify `git status` clean and `data/`, `node_modules/`, `.env` NOT in the commit (`git ls-files | findstr /I "data/ .env node_modules"` must return nothing).
  **Acceptance:** `git log --oneline` shows one commit; `git ls-files` includes `app/`, `src/`, `docs/`, `tests/`, `PRODUCT.md`, `DESIGN.md`, `.omo/plans/expo-ship-readiness.md`, `apps-script/`; excludes ignored paths; no `.png` in root tracked.
  **QA happy:** after commit, `git status` empty. **QA failure:** add a stray `test.txt`, confirm it appears in `git status` (proves tracking works), delete it.
  **Commit:** this todo IS the initial commit.

- [x] 2. Offline lead capture in `app/public/expo.html` + browser QA
  **References:** `app/public/expo.html` submit handler (the IIFE at lines 158–274); submit flow at 218–266; `currentKey` generation at 243–246 (`payload.idempotency_key = 'KIOSK:' + currentKey`); the network `.catch` at 262–266 (this is what the offline path replaces); error display `show()` at 205–208; done screen `#kiosk-done` at 145–153; `.kiosk-note` at 155; "Next traveller" reset at 269–275 (already nulls `currentKey` — keep as-is). Server contract: `src/expo/expo-service.js` `captureLead` 243–310 (idempotent replay 276–279; RATE_LIMITED 282–284; validation throws before rate accounting; mobile pattern `^0\d{10}$` via normalizeMobile). Design tokens via `/tokens.css`. WCAG AA floor per PRODUCT.md.
  **Implementation spec (zero judgment):**
  1. Queue primitives inside the existing IIFE:
     - `var QUEUE_KEY = 'wmit.expo.offlineQueue.v1';`
     - `readQueue()` / `writeQueue(items)`: JSON array of `{ savedAt: <ISO>, payload: <lead payload incl. idempotency_key and expo_tag> }`; wrap `localStorage.getItem/setItem` in try/catch (private mode / quota) — on failure, degrade to direct-send-only behavior (never crash the kiosk).
     - Cap: 200 entries; on overflow drop the OLDEST entry and keep the newest (booth reality: newest lead matters most).
  2. `flushQueue()` — sequential (one in-flight at a time, `flushing` boolean guard; reset the guard in a `finally` so an unexpected exception cannot wedge the queue):
     - Shift first entry IN MEMORY only; `POST /api/public/expo/lead`. **Persist the queue only AFTER the response resolves** (drop or re-insert). An entry in flight when the tab closes stays in storage and is safely replayed on next load via idempotency — persisting the removal before the POST would silently lose the lead.
     - Response `body.ok === true` (including `meta.idempotent === true` replays) → drop entry, persist, continue with next.
     - Network error OR HTTP 5xx OR body error code `RATE_LIMITED` → re-insert entry at queue FRONT, persist, stop this round (retry on next trigger).
     - Any other 4xx/validation error (`REQUIRED_FIELD`, `EMAIL_INVALID`, `MOBILE_INVALID`, `TRAVEL_MONTH_INVALID`, `EXPO_NOT_FOUND`, `EXPO_NOT_ACTIVE`, …) → drop entry permanently, persist, `console.warn('wmit-offline-dropped', code, payload.idempotency_key)` (audit trail in kiosk console), continue with next.
     - After the round: update badge; if queue emptied, hide badge.
  3. Flush triggers: page load; `window.addEventListener('online', flushQueue)`; `setInterval(flushQueue, 30000)`; after every successful DIRECT submit (the online fast path stays exactly as-is — direct first, queue only on failure).
  4. Submit handler change (replace ONLY the network `.catch` at 262–266; the happy path and `.then` error handling are untouched): on network failure of a direct submit → attempt `writeQueue(readQueue().concat([{ savedAt: new Date().toISOString(), payload: payload }]))`. **If writeQueue fails (localStorage unavailable/quota), fall back to today's exact behavior** — `submit.disabled = false; currentKey = null; show('No connection — please try again or ask our staff for help.')` — the saved-on-device copy must never display without a real queue write. On successful enqueue: `submit.disabled = false; form.style.display = 'none';` show done screen with offline wording (heading stays `Salamat, <first>!`; line: `'Saved on this device — it will send automatically when the connection returns.'`) and show badge. Do NOT regenerate `currentKey` on the enqueue path (the queued payload owns it; harmless since the form is hidden until "Next traveller", which nulls it as today).
  5. Badge: `<div id="k-queue" class="kiosk-queue" role="status" aria-live="polite" hidden></div>` immediately ABOVE `.kiosk-note`; text `N saved on this device — sending when online`; CSS `.kiosk-queue{margin-top:16px;padding:12px 14px;border-radius:8px;background:var(--msg-warn-bg);border:1px solid var(--msg-warn-rule);color:var(--msg-warn-text);font-size:14px;text-align:center}`; visible only when queue length > 0; updates after every enqueue/dequeue/flush round. This is a state change announcement — words + color, never color alone.
  6. Persistence edge: on load, if queue non-empty and `navigator.onLine`, flush immediately (covers the "staff closed the tab mid-outage" case).
  **Must-NOT-Have:** no changes to `show()`, validation order, field IDs, `?expo=` config fetch, or the online fast path; no service worker; no dependencies; English copy only (matches the form's existing copy language). Multi-tab concurrent flush on one device is accepted as benign (server idempotency dedupes; terminal-drop converges) — do NOT build a cross-tab lock.
  **Acceptance (code):** `node --check` not applicable (inline HTML script) — instead, page loads with zero console errors at `http://127.0.0.1:3000/expo.html?expo=EXPO-2026`; direct online submit still lands in `<2s` and shows the normal Salamat screen.
  **QA happy (evidence `.playwright-mcp/offline-happy.png`):** Playwright route-abort `**/api/public/expo/lead` → fill form (mobile = `'0917' + String(Date.now()).slice(-7)` — exactly 11 digits, server enforces `^0\d{10}$`) → submit → done screen shows offline wording → badge shows `1 saved` → `localStorage.getItem('wmit.expo.offlineQueue.v1')` has 1 entry → un-route → `window.dispatchEvent(new Event('online'))` → within 5s badge hidden → `GET /api/phase1/state` shows the new ExpoLead with that mobile → localStorage queue empty.
  **QA failure paths (evidence `.playwright-mcp/offline-failure.png`):** (a) idempotency replay — while offline, submit once, then duplicate the entry in localStorage directly (`var q = JSON.parse(localStorage.getItem(KEY)); q.push(q[0]); localStorage.setItem(KEY, JSON.stringify(q));`) → reconnect → flush POSTs twice with the same idempotency key → server state shows exactly ONE lead for that mobile and the queue is empty (exercises `IDEMPOTENT_REPLAY`, expo-service.js:276–279; two mere `online` events cannot do this — the guard serializes and the drained queue sends nothing). (b) terminal-drop: enqueue a payload with invalid email (e.g. `not-an-email`, passes client presence check, fails server pattern) offline, reconnect → entry dropped (console.warn recorded), badge clears, no server lead. (c) RATE_LIMITED: enqueue 3 payloads via 3 fill→submit→Next-traveller cycles, stub ALL `/api/public/expo/lead` responses via Playwright route-fulfill with `{ok:false,error:{code:'RATE_LIMITED',message:'Please wait a minute before submitting again.'}}` → trigger flush → all 3 remain queued, badge persists. (d) `npm test` 244/244 green.
  **Commit:** `git add app/public/expo.html && git commit -m "expo kiosk: offline lead capture with auto-flush queue"`.

- [x] 3. `docs/expo-readiness.md` runbook (Phases B–D + Cloudflare Tunnel home hosting)
  **References:** `docs/deployment-netcup.md` (VPS setup §1–5, staging §7, update §8, security checklist §9 — cite, do not duplicate); `docs/events.md` staff workflow; `WMIT_BASE_URL` note (events.md §Environment); AGENTS.md phase-3 status (Sept 4–6 deadline).
  **Content spec (sections in order, decision-complete):**
  1. **Phase B — staging rehearsal (VPS, port 3001):** deploy per deployment-netcup.md §7; create the real `EXPO-SEP26`-style event with Sept 4–6 dates in the console; walk the full flow once: kiosk lead → follow-up queue → package prices → quote link `/q/<token>` → accept → mark booked; train staff on the console tabs; acceptance = one lead visible end-to-end + staff sign-ins work.
  2. **Phase C — production cutover:** manual backup per §6 (`sudo -u wmit node /home/wmit/app/scripts/backup.js`), then update per §8 (stop → sync code → `npm test` → start); tick every item of the unnumbered **"Security checklist before real client data"** section at the end of the doc (NOT §9, which is Health/troubleshooting); verify `/api/health`.
  3. **Phase D — expo-day operations checklist:** real event ACTIVE with dates; staff accounts created; SMTP live (send one test quote email, confirm not stuck in outbox); real package prices confirmed (placeholders replaced); booth tablet kiosk test on venue WiFi; offline-capture behavior note (badge = saved on device; queue drains automatically); phone-hotspot fallback plan; who ends the event after Sept 6.
  4. **Option — home-PC hosting via Cloudflare Tunnel (owner-chosen stopgap):** prerequisite: a domain with DNS on Cloudflare (free plan; netcup domain can be delegated by adding Cloudflare nameservers in the netcup CCP, or delegate just one subdomain). Steps (Windows): install `winget install Cloudflare.cloudflared`; `cloudflared tunnel login`; `cloudflared tunnel create wmit`; write `%USERPROFILE%\.cloudflared\config.yml` as complete YAML:
     ```yaml
     tunnel: <TUNNEL-UUID from `cloudflared tunnel create` output>
     credentials-file: C:\Users\<user>\.cloudflared\<TUNNEL-UUID>.json
     ingress:
       - hostname: app.<domain>
         service: http://localhost:3000
       - service: http_status: 404
     ```
     then `cloudflared tunnel route dns wmit app.<domain>`; `cloudflared tunnel run wmit`; install as a boot service `cloudflared service install`. Server side: `WMIT_ENV=production WMIT_BASE_URL=https://app.<domain> WMIT_ENFORCE_SESSIONS=true node scripts/run-server.js`. Honest limits stated: home PC uptime = agency uptime (disable sleep, expect Windows updates), no nightly off-site backups, single machine — acceptable for training/bridge use, NOT the expo-day plan; quick `trycloudflare.com` URLs are ephemeral and rejected for staff links.
  5. **Decision rule:** VPS before Sept 4 regardless of tunnel (expo kiosk must not depend on a home connection).
  **Acceptance:** file exists with all 5 sections; every VPS step cites its deployment-netcup.md section by number AND name instead of restating it; tunnel section carries the complete config.yml YAML (tunnel id, credentials-file, ingress with 404 fallback); no undefined `<placeholder>` except the domain, which one intro line explains.
  **QA happy:** doc renders on GitHub/IDE preview with no broken relative links (all referenced docs exist). **QA failure:** grep the doc for `yourdomain.ph` placeholders — each must be explained as a placeholder in one intro line (not silently inconsistent).
  **Commit:** `git add docs/expo-readiness.md && git commit -m "docs: expo ship-readiness runbook (staging, cutover, expo-day, cloudflare tunnel option)"`.

- [ ] 4. `docs/events.md` offline note
  **References:** `docs/events.md` "Staff workflow" step 2 "At the booth" (lines 68–70); "Public channel rules" (48–59) for consistency.
  **Steps:** append one short paragraph to step 2: the kiosk saves submissions on the device when the connection drops (badge shows how many), sends automatically when online returns, deduplicates by idempotency key, and drops only permanently-invalid entries; booth staff need do nothing beyond keeping the tab open.
  **Acceptance:** paragraph present; no other section altered; wording consistent with public-channel rules (idempotent retries free).
  **QA happy:** doc lint = read-through. **QA failure:** confirm the paragraph does NOT promise queued leads appear instantly server-side (they appear only after reconnect).
  **Commit:** `git add docs/events.md && git commit -m "docs: note kiosk offline capture in booth workflow"`.

## Final verification wave

- [ ] F1. Plan compliance audit — every todo executed as specified, all FOUR commits present (baseline + todos 2–4 = 4 total; `git log --oneline` shows exactly 4), no scope additions. Evidence: `git log` + `git diff main~3..main --stat` reviewed against this plan.
- [ ] F2. Code quality review — offline-capture diff (`git diff main~3..main~2 -- app/public/expo.html`) read line-by-line: no dead code, no console noise beyond the specified warn, AA contrast on badge tokens, copy matches spec verbatim.
- [ ] F3. Real manual QA — re-run todo 2's happy-path Playwright script once more on the committed tree; screenshot `.playwright-mcp/final-qa.png`; `npm test` green.
- [ ] F4. Scope fidelity — `git status` clean; no files outside `app/public/expo.html`, `docs/`, `.gitignore` changed vs. baseline commit; Apps Script untouched.

## Commit strategy

Baseline commit (todo 1), then one commit per todo (2–4), messages as specified. Placeholder git identity disclosed in the baseline body if used. No force-push, no rewriting after the final wave.

## Success criteria

1. Repo under git with a clean baseline; evidence screenshots out of the tree.
2. Kiosk submits work online exactly as before (fast path untouched — regression-proven by suite + QA).
3. Offline: submissions save on-device with visible badge and honest copy; auto-drain on reconnect; exactly-once delivery via idempotency; invalid entries dropped with console audit; RATE_LIMITED retried, never dropped.
4. `docs/expo-readiness.md` is structurally complete for owner execution: every step has exact commands, correct section citations (by number and name), and the only placeholder is the domain (explained); residual "can a human follow it" judgment belongs to the owner during Phase B–D execution, not to this plan's QA.
5. 244/244 tests green throughout.
