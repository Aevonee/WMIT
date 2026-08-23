'use strict';

// WMIT end-to-end browser smoke suite.
//
// Spawns the hosted server (scripts/run-server.js) on its own port with a
// throwaway database, drives the real UI headlessly through Playwright's
// library API (no @playwright/test), and always tears the server down —
// even when a scenario fails. Completely independent from `npm test`.
//
// Browser policy: playwright is installed with --ignore-scripts, so no
// browsers are downloaded. We launch Edge, then Chrome, then a bundled
// Chromium if one exists; when none is available the suite SKIPs (exit 0).

const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const PORT = 3999;
const BASE = 'http://127.0.0.1:' + PORT;
const READY_TIMEOUT_MS = 30000;
const STEP_TIMEOUT_MS = 20000;

let playwrightLib = null;
try {
  playwrightLib = require('playwright');
} catch (_) {
  playwrightLib = null;
}

const results = [];

async function runScenario(name, fn) {
  process.stdout.write('  · ' + name + ' …\n');
  try {
    await fn();
    results.push({ name, ok: true });
    console.log('PASS ' + name);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log('FAIL ' + name);
    console.log('     ' + (error && error.stack || error).toString().split('\n').slice(0, 6).join('\n     '));
  }
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

function startServer(dataDir) {
  const env = Object.assign({}, process.env, {
    WMIT_ENV: 'development',
    WMIT_HOST: '127.0.0.1',
    WMIT_PORT: String(PORT),
    WMIT_DATA_DIR: dataDir,
    WMIT_DB_PATH: path.join(dataDir, 'wmit-e2e.sqlite3'),
    // Keep the throwaway server quiet: no scheduler jobs, no session walls.
    WMIT_SCHEDULER: 'false',
    WMIT_ENFORCE_SESSIONS: 'false',
    // Never let a developer .env leak into the smoke server; explicit env
    // vars above win anyway, but a blank env file removes all doubt.
    WMIT_ENV_FILE: path.join(dataDir, 'absent.env')
  });

  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'scripts', 'run-server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = [];
  const record = (stream, prefix) => {
    stream.setEncoding('utf8');
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      lines.forEach((line) => { if (line) { output.push(prefix + line); console.log('  [server] ' + line); } });
    });
  };
  record(child.stdout, '');
  record(child.stderr, 'stderr: ');
  child.on('exit', (code, signal) => { output.push('server exited: code=' + code + ' signal=' + signal); });
  return { child, output };
}

async function waitForServer(server, readyMs) {
  const deadline = Date.now() + readyMs;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) {
      throw new Error('The e2e server exited during startup (code ' + server.child.exitCode + '). Output:\n  ' + server.output.join('\n  '));
    }
    try {
      const response = await fetch(BASE + '/api/health');
      // Strict check: the real server answers JSON ok:true — anything else
      // on this port (or a proxy) must not count as readiness.
      if (response.ok) {
        const body = await response.json();
        if (body && body.ok === true) return;
      }
    } catch (_) { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('The e2e server did not become ready on ' + BASE + ' within ' + readyMs + 'ms.');
}

async function assertPortFree() {
  try {
    await fetch(BASE + '/api/health', { signal: AbortSignal.timeout(1500) });
    throw new Error('Something is already answering on ' + BASE + ' — free port ' + PORT + ' before running the e2e suite.');
  } catch (error) {
    // undici wraps "connection refused" as error.cause; both shapes mean nothing is listening.
    if (error.name === 'TimeoutError' || error.cause || error.code === 'ECONNREFUSED') return;
    throw error;
  }
}

async function stopServer(server) {
  if (!server || server.child.exitCode !== null) return;
  const exited = new Promise((resolve) => server.child.once('exit', resolve));
  server.child.kill();
  const graceful = await Promise.race([exited.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 4000))]);
  if (!graceful && server.child.exitCode === null) {
    // Windows fallback: force the whole tree down.
    spawn('taskkill', ['/pid', String(server.child.pid), '/T', '/F'], { stdio: 'ignore' });
    await exited.catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Fresh-DB admin bootstrap
// ---------------------------------------------------------------------------

async function readBootstrapAdmin(dataDir) {
  const passwordFile = path.join(dataDir, 'initial-admin-password.txt');
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (fs.existsSync(passwordFile)) {
      const text = fs.readFileSync(passwordFile, 'utf8');
      const username = /Username:\s*(.+)/.exec(text);
      const password = /Temporary password:\s*(.+)/.exec(text);
      if (username && password) {
        return { username: username[1].trim(), password: password[1].trim() };
      }
      throw new Error('initial-admin-password.txt exists but has no Username/Temporary password lines: ' + JSON.stringify(text));
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('The server did not write ' + passwordFile + ' within 15s (first-boot admin bootstrap).');
}

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------

async function launchBrowser(chromium) {
  const attempts = [
    { label: 'Microsoft Edge (channel msedge)', options: { channel: 'msedge' } },
    { label: 'Google Chrome (channel chrome)', options: { channel: 'chrome' } },
    { label: 'bundled Chromium', options: {} }
  ];
  const failures = [];
  for (const attempt of attempts) {
    try {
      const browser = await chromium.launch(Object.assign({ headless: true }, attempt.options));
      console.log('Browser: ' + attempt.label);
      return browser;
    } catch (error) {
      failures.push(attempt.label + ': ' + error.message.split('\n')[0]);
    }
  }
  console.log('No browser available:');
  failures.forEach((line) => console.log('  - ' + line));
  return null;
}

// ---------------------------------------------------------------------------
// Console-error collection (favicon 404 is known noise)
// ---------------------------------------------------------------------------

function isFaviconNoise(msg) {
  const location = msg.location() || {};
  const url = location.url || '';
  return url.includes('favicon') || msg.text().includes('favicon');
}

function collectConsoleErrors(page) {
  const errors = [];
  const onConsole = (msg) => {
    if (msg.type() === 'error' && !isFaviconNoise(msg)) errors.push(msg.text() + (msg.location() && msg.location().url ? ' @ ' + msg.location().url : ''));
  };
  const onPageError = (error) => errors.push('pageerror: ' + error.message);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  return {
    errors,
    assertClean(label) {
      assert.deepStrictEqual(errors, [], label + ' produced console errors:\n      ' + errors.join('\n      '));
    }
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

async function main() {
  if (!playwrightLib) {
    console.log('SKIP: the playwright devDependency is not installed (run: npm install).');
    return 0;
  }

  await assertPortFree();
  fs.mkdirSync(path.join(__dirname, '.tmp'), { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(__dirname, '.tmp', 'e2e-'));
  console.log('E2E temp data dir: ' + dataDir);
  console.log('Starting hosted server for ' + BASE + ' …');

  const server = startServer(dataDir);
  let browser = null;
  try {
    await waitForServer(server, READY_TIMEOUT_MS);
    const admin = await readBootstrapAdmin(dataDir);
    console.log('Bootstrap admin "' + admin.username + '" read from temp initial-admin-password.txt.');

    browser = await launchBrowser(playwrightLib.chromium);
    if (!browser) {
      console.log('SKIP: no Chromium-based browser available. Install Microsoft Edge or Google Chrome, or run: npx playwright install chromium');
      return 0;
    }

    const context = await browser.newContext();
    // One tab for the whole suite: sessionStorage (wmit_session) survives
    // same-origin navigations inside a single tab, which is exactly how a
    // signed-in staff member moves between operations and expo consoles.
    const page = await context.newPage();
    page.setDefaultTimeout(STEP_TIMEOUT_MS);
    const session = { token: null };

    await runScenario('1. Login surface (GET /login.html + wrong-credential POST)', async () => {
      const pageResponse = await fetch(BASE + '/login.html');
      assert.strictEqual(pageResponse.status, 200, 'GET /login.html should answer 200');
      const loginResponse = await fetch(BASE + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: admin.username, password: 'definitely-not-the-password' })
      });
      const body = await loginResponse.json();
      assert.strictEqual(body.ok, false, 'wrong-credential login should return ok:false, got ' + JSON.stringify(body));
    });

    await runScenario('2. Admin login through the UI form', async () => {
      await page.goto(BASE + '/login.html?force=1');
      await page.fill('#login-username', admin.username);
      await page.fill('#login-password', admin.password);
      await page.evaluate(() => {
        document.getElementById('login-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      await page.waitForURL('**/operations.html**', { timeout: STEP_TIMEOUT_MS });
      session.token = await page.evaluate(() => sessionStorage.getItem('wmit_session'));
      assert.ok(session.token, 'sessionStorage.wmit_session should be present after login');
    });

    await runScenario('3. Operations workspace loads signed-in with zero console errors', async () => {
      const console_ = collectConsoleErrors(page);
      await page.goto(BASE + '/operations.html');
      await page.waitForSelector('.tabs a[data-tab="inquiry"]', { state: 'visible' });
      // The workspace has booted once a view renders dynamic content.
      await page.waitForSelector('#dashboard-content *', { state: 'attached' });
      await page.waitForSelector('#inquiry-content', { state: 'attached' });
      console_.assertClean('operations.html');
    });

    await runScenario('4. Quote builder regression (item + fee + save draft)', async () => {
      // Fresh DB: create the Inquiry the builder prices, through the same
      // whitelisted action dispatcher the UI uses (shape copied from
      // createInquiry() in app/public/operations.js).
      const seededClient = await (await fetch(BASE + '/api/phase1/state')).json();
      const clientId = (seededClient.data.entities.Client || [])[0].client_id;
      const inquiryResponse = await fetch(BASE + '/api/phase1/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.token },
        body: JSON.stringify({
          action: 'createInquiry',
          actor: 'LOCAL_STAFF',
          input: {
            client_id: clientId,
            received_at: new Date().toISOString(),
            source: 'LOCAL_SYNTHETIC',
            requirements: { destination: 'Tokyo', travel_month: '2026-11', duration_days: 5, adults: 2, children: 0, infants: 0 }
          }
        })
      });
      const inquiry = await inquiryResponse.json();
      assert.strictEqual(inquiry.ok, true, 'createInquiry failed: ' + JSON.stringify(inquiry));
      const inquiryId = inquiry.data.inquiry_id;
      assert.ok(inquiryId, 'createInquiry returned no inquiry_id');

      // Same-document hash navigations do not reload the page, and the page
      // state predates the inquiry we just created via the API — force a
      // reload so refreshState() picks it up before we look for the button.
      await page.goto(BASE + '/operations.html#inquiry');
      await page.reload();
      const buildQuote = page.getByRole('button', { name: 'Build quote' }).first();
      await buildQuote.waitFor({ state: 'visible' });
      await buildQuote.click();
      await page.waitForSelector('#qb-desc', { state: 'visible' });

      await page.selectOption('#qb-svc', 'Hotel');
      await page.fill('#qb-desc', 'E2E smoke hotel night');
      await page.fill('#qb-qty', '1');
      await page.fill('#qb-cost', '1000');
      await page.fill('#qb-sell', '1500');
      await page.click('#qb-item-form button[type="submit"]'); // "Add item"
      await page.waitForSelector('#qb-items-body tr', { state: 'attached' });
      await page.waitForSelector('#qb-fee', { state: 'attached' });

      await page.fill('#qb-fee', '100');
      const grandRow = page.locator('.soa-row.total', { hasText: 'Grand total' });
      assert.strictEqual(await grandRow.locator('#qb-grand').textContent(), 'PHP 1,600', 'Grand total should be PHP 1,600');

      await page.click('#qb-save');
      await page.waitForFunction(() => window.location.hash === '#quotation', null, { timeout: STEP_TIMEOUT_MS });
      await page.waitForFunction(() => /QUOTATION-\d+/.test(document.body.textContent), null, { timeout: STEP_TIMEOUT_MS });

      // Server-side truth: the draft landed in SQLite with exact money values.
      const stateResponse = await fetch(BASE + '/api/phase1/state', { headers: { Authorization: 'Bearer ' + session.token } });
      const state = await stateResponse.json();
      const entities = state.data.entities;
      const quotation = (entities.Quotation || []).filter((quote) => quote.inquiry_id === inquiryId).pop();
      assert.ok(quotation && quotation.quotation_id, 'no Quotation saved for ' + inquiryId);
      assert.strictEqual(quotation.client_total, '1600.00', 'quotation client_total');
      const items = (entities.QuotationItem || []).filter((item) => item.quotation_id === quotation.quotation_id);
      assert.strictEqual(items.length, 1, 'exactly one QuotationItem expected');
      assert.strictEqual(items[0].unit_selling_price, '1500.00', 'item unit_selling_price');
    });

    await runScenario('5. Expo console loads with zero console errors', async () => {
      const console_ = collectConsoleErrors(page);
      await page.goto(BASE + '/expo-console.html');
      await page.waitForSelector('#expo-select option', { state: 'attached' });
      // Give the async dashboard/lead/quote/package priming fetches a beat.
      await page.waitForTimeout(1500);
      console_.assertClean('expo-console.html');
    });

    await runScenario('6. Mobile 375px viewport has no horizontal overflow', async () => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(BASE + '/operations.html');
      await page.waitForSelector('#dashboard-content *', { state: 'attached' });
      const metrics = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      assert.ok(metrics.scrollWidth <= metrics.clientWidth, 'horizontal overflow on 375px: scrollWidth=' + metrics.scrollWidth + ' clientWidth=' + metrics.clientWidth);
    });

    const failed = results.filter((entry) => !entry.ok);
    console.log('');
    console.log('E2E summary: ' + (results.length - failed.length) + '/' + results.length + ' scenarios passed.');
    return failed.length ? 1 : 0;
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopServer(server);
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
    console.log('E2E server stopped and temp data dir removed.');
  }
}

main().then((code) => {
  process.exit(code || 0);
}, (error) => {
  console.error('E2E runner crashed: ' + (error && error.stack || error));
  process.exit(1);
});
