# WMIT E2E browser smoke suite (`npm run test:e2e`)

Headless Playwright smoke tests for the hosted WMIT server UI. This suite is
fully independent from `npm test` — it never touches the repo database, the
dev instance on port 3000, or any business data, and it cannot break the
unit/integration suite.

## What it does

1. Creates a throwaway data dir under `tests/e2e/.tmp/` (gitignored).
2. Spawns the hosted server (`scripts/run-server.js`) on **port 3999** with
   `WMIT_DATA_DIR`/`WMIT_DB_PATH` pointing at that temp dir, the scheduler
   off, and sessions in development mode. First boot bootstraps the `admin`
   account and writes the generated password to
   `<temp dir>/initial-admin-password.txt` — the runner reads it from there
   to sign in.
3. Drives the real UI through Playwright's library API (plain Node +
   `node:assert`, no `@playwright/test`):

   | # | Scenario |
   |---|----------|
   | 1 | `GET /login.html` answers 200; wrong-credential `POST /api/auth/login` returns `ok:false` |
   | 2 | Real admin login through `#login-form` lands on `operations.html` with `sessionStorage.wmit_session` set |
   | 3 | Operations workspace renders signed-in with **zero console errors** (the favicon 404 is filtered as known noise) |
   | 4 | Quote builder regression: creates an Inquiry through the `/api/phase1/action` dispatcher, builds a quote (Hotel × 1, cost 1000, sell 1500, fee 100), asserts the live `Grand total` shows `PHP 1,600`, saves the draft, and verifies `client_total "1600.00"` + exactly one `QuotationItem` with `unit_selling_price "1500.00"` via `/api/phase1/state` |
   | 5 | Expo console (`/expo-console.html`) loads with zero console errors |
   | 6 | 375×812 viewport on `/operations.html` has no horizontal overflow |

4. Always kills the server (taskkill fallback on Windows) and removes the
   temp dir — even when scenarios fail.

## Preconditions

- **Node 22+** (same as the rest of the repo).
- **A Chromium-based browser on the machine.** The suite launches, in order:
  Microsoft Edge (`channel: 'msedge'`), Google Chrome (`channel: 'chrome'`),
  then a bundled Playwright Chromium if one was ever downloaded.
  On Windows, Edge is preinstalled almost everywhere, so this normally just
  works. If none is found, the suite prints `SKIP: …` and exits **0** — a
  missing browser is not a failure.
- `playwright` is a devDependency installed with `--ignore-scripts`, so
  **no browser is ever downloaded** during `npm install`. To opt into a
  bundled Chromium instead of Edge/Chrome, run
  `npx playwright install chromium` manually.
- Nothing must listen on port 3999 (the runner fails fast with the server's
  own output if the port is taken).

## Running

```text
npm run test:e2e
```

Each scenario logs `PASS <name>` / `FAIL <name>`; the run exits non-zero when
any scenario fails, and exits 0 with a clear SKIP line when no browser is
available.

## Maintenance notes

- Selector contract (from today's UI): `#login-username`, `#login-password`,
  `#login-form`, session keys `wmit_session`/`wmit_user` in sessionStorage;
  builder ids `qb-svc`, `qb-desc`, `qb-qty`, `qb-cost`, `qb-sell`, `qb-fee`,
  `qb-save`, `#qb-item-form button[type=submit]` ("Add item"), grand total in
  `.soa-row.total` → `#qb-grand`; hash routes `#inquiry` / `#quote-builder` /
  `#quotation`. If the UI changes these, update the runner — that breakage
  is exactly what this suite exists to catch (scenario 4 guards the quote
  builder money math).
- Env vars used to isolate the server come from `src/server/config.js`:
  `WMIT_PORT`, `WMIT_DATA_DIR`, `WMIT_DB_PATH`, `WMIT_SCHEDULER`,
  `WMIT_ENFORCE_SESSIONS`, `WMIT_ENV_FILE`.
- The temp DB starts nearly empty (development boot seeds one synthetic
  Client + Supplier); the inquiry used by the quote-builder scenario is
  created explicitly through the whitelisted `createInquiry` action with the
  same input shape `createInquiry()` in `app/public/operations.js` sends.
