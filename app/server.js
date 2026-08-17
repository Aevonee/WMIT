'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { seedDemoRuntime } = require('../src/application/demo-data');
const { createPhase1Application } = require('../src/application/phase1');

const publicRoot = path.join(__dirname, 'public');

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) reject(new Error('Request is too large.'));
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch (error) { reject(new Error('Request body must be valid JSON.')); }
    });
    req.on('error', reject);
  });
}

function safePath(urlPath) {
  const requested = urlPath === '/' ? '/operations.html' : urlPath;
  const filePath = path.resolve(publicRoot, '.' + requested);
  return filePath.startsWith(path.resolve(publicRoot)) ? filePath : null;
}

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2'
};
const compressible = new Set(['.html', '.css', '.js', '.json', '.svg']);
const gzipCache = new Map();

function gzipBuffer(filePath, mtimeMs, size) {
  const key = filePath + '|' + mtimeMs + '|' + size;
  let entry = gzipCache.get(key);
  if (!entry) {
    entry = zlib.gzipSync(fs.readFileSync(filePath), { level: 6 });
    if (gzipCache.size >= 32) gzipCache.delete(gzipCache.keys().next().value);
    gzipCache.set(key, entry);
  }
  return entry;
}

function serveStatic(req, res, filePath) {
  const stats = fs.statSync(filePath);
  const etag = '"' + stats.mtimeMs.toFixed(0) + '-' + stats.size + '"';
  const headers = {
    'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream',
    'Cache-Control': 'no-cache, must-revalidate',
    ETag: etag
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  const acceptsGzip = String(req.headers['accept-encoding'] || '').includes('gzip');
  if (acceptsGzip && compressible.has(path.extname(filePath))) {
    headers['Content-Encoding'] = 'gzip';
    headers['Vary'] = 'Accept-Encoding';
    headers['Content-Length'] = gzipBuffer(filePath, stats.mtimeMs, stats.size).length;
    res.writeHead(200, headers);
    res.end(gzipBuffer(filePath, stats.mtimeMs, stats.size));
    return;
  }
  if (acceptsGzip) headers['Vary'] = 'Accept-Encoding';
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

function createMvpServer(options) {
  const app = (options && options.app) || seedDemoRuntime(options);
  const phase1 = (options && options.phase1App) || createPhase1Application(options);
  const auth = (options && options.auth) || null;
  const enforceSessions = Boolean(options && options.enforceSessions && auth);
  const health = (options && options.health) || null;
  const expo = (options && options.expo) || null;
  // Optional shared-secret guard for mutating endpoints. When unset (the local
  // default), the server keeps its loopback-only behaviour.
  const actorToken = (options && options.actorToken) || process.env.WMIT_MVP_ACTOR_TOKEN || null;
  const actorTokenValid = (req) => !actorToken || req.headers['x-wmit-actor-token'] === actorToken;

  const bearerToken = (req) => {
    const header = req.headers.authorization || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : null;
  };

  const server = http.createServer(async (req, res) => {
    try {
      const parsed = new URL(req.url, 'http://127.0.0.1');
      if (parsed.pathname.startsWith('/api/')) {
        // --- Authentication endpoints (open for login, session-protected after) ---
        if (parsed.pathname === '/api/auth/login' && req.method === 'POST') {
          if (!auth) return json(res, 501, { ok: false, error: { code: 'AUTH_UNAVAILABLE', message: 'This server runs without an account store.' } });
          const body = await readBody(req);
          try {
            const session = auth.login(body);
            return json(res, 200, { ok: true, data: session, meta: { action: 'LOGIN' } });
          } catch (error) {
            return json(res, 401, { ok: false, error: { code: error.code || 'LOGIN_INVALID', message: error.message } });
          }
        }
        // --- Expo public channel: kiosk lead capture and quotation links.
        // No session is required; the expo service applies its own rate
        // limiting and validation, mirroring the Apps Script public design.
        if (parsed.pathname.startsWith('/api/public/expo/')) {
          if (!expo) return json(res, 501, { ok: false, error: { code: 'EXPO_UNAVAILABLE', message: 'This server runs without the expo tooling.' } });
          const statusFor = (result) => !result.ok && result.error && result.error.code === 'RATE_LIMITED' ? 429
            : !result.ok && ['QUOTATION_NOT_FOUND', 'TOKEN_INVALID'].includes(result.error.code) ? 404
            : result.ok ? 200 : 400;
          if (req.method === 'GET' && parsed.pathname === '/api/public/expo/config') {
            const config = expo.getPublicConfig({ expo: parsed.searchParams.get('expo') });
            return json(res, config.ok ? 200 : 404, config);
          }
          if (req.method === 'POST' && parsed.pathname === '/api/public/expo/lead') {
            const result = await Promise.resolve(expo.captureLead(await readBody(req)));
            return json(res, result.ok ? 200 : statusFor(result), result);
          }
          if (req.method === 'GET' && parsed.pathname === '/api/public/expo/quote') {
            return json(res, statusFor(expo.getPublicQuote(parsed.searchParams.get('token'))), expo.getPublicQuote(parsed.searchParams.get('token')));
          }
          if (req.method === 'POST' && parsed.pathname === '/api/public/expo/quote/accept') {
            const body = await readBody(req);
            const result = await Promise.resolve(expo.acceptQuote(body && body.token, body));
            return json(res, result.ok ? 200 : statusFor(result), result);
          }
          if (req.method === 'POST' && parsed.pathname === '/api/public/expo/quote/decline') {
            const body = await readBody(req);
            const result = await Promise.resolve(expo.declineQuote(body && body.token, body));
            return json(res, result.ok ? 200 : statusFor(result), result);
          }
          return json(res, 404, { ok: false, error: { message: 'Unknown public expo endpoint.' } });
        }
        if (enforceSessions && parsed.pathname !== '/api/health') {
          const session = auth.sessionFor(bearerToken(req));
          if (!session) return json(res, 401, { ok: false, error: { code: 'UNAUTHORIZED', message: 'Sign in to WMIT to use this API.' } });
          if (req.method !== 'GET' && session.role === 'INTERN') {
            return json(res, 403, { ok: false, error: { code: 'INTERN_WRITE_FORBIDDEN', message: 'Intern accounts are read-only.' } });
          }
          req.wmitSession = session;
          req.wmitActor = 'USER:' + session.username;
        } else if (auth && parsed.pathname !== '/api/health') {
          // Sessions optional: a caller that still presents a valid session
          // is identified as that user, so authority-gated actions (e.g.
          // tariff deletion) follow the signed-in account rather than the
          // client-supplied actor string.
          const session = auth.sessionFor(bearerToken(req));
          if (session) req.wmitActor = 'USER:' + session.username;
        }
        if (parsed.pathname === '/api/auth/me' && req.method === 'GET') {
          if (!auth) return json(res, 200, { ok: true, data: { enforced: false, anonymous: true, auth_available: false } });
          const session = enforceSessions ? req.wmitSession : auth.sessionFor(bearerToken(req));
          if (!session) return json(res, enforceSessions ? 401 : 200, enforceSessions
            ? { ok: false, error: { code: 'UNAUTHORIZED', message: 'Sign in to WMIT to use this API.' } }
            : { ok: true, data: { enforced: false, anonymous: true, auth_available: true } });
          return json(res, 200, { ok: true, data: { enforced: true, username: session.username, role: session.role, expires_at: session.expires_at, auth_available: true } });
        }
        if (parsed.pathname === '/api/auth/logout' && req.method === 'POST') {
          if (auth) auth.logout(bearerToken(req));
          return json(res, 200, { ok: true, meta: { action: 'LOGOUT' } });
        }
        if (parsed.pathname === '/api/health' && req.method === 'GET') {
          const result = health ? health() : { env: 'local', scheduler: { running: false, jobs: [] }, heartbeat: null };
          return json(res, 200, { ok: true, data: result });
        }
        // --- Expo staff endpoints (session-guarded like the rest of the API) ---
        if (parsed.pathname.startsWith('/api/expo/')) {
          if (!expo) return json(res, 501, { ok: false, error: { code: 'EXPO_UNAVAILABLE', message: 'This server runs without the expo tooling.' } });
          const actor = req.wmitActor || 'LOCAL_STAFF';
          const expoStatus = (result) => result.ok ? 200 : (result.error && result.error.code === 'RATE_LIMITED' ? 429 : 400);
          if (req.method === 'GET' && parsed.pathname === '/api/expo/leads') {
            return json(res, 200, { ok: true, data: expo.listLeads(Object.fromEntries(parsed.searchParams.entries())) });
          }
          if (req.method === 'GET' && parsed.pathname === '/api/expo/lead' ) {
            return json(res, 200, expo.getLead(parsed.searchParams.get('expo_lead_id')));
          }
          if (req.method === 'GET' && parsed.pathname === '/api/expo/followups') {
            return json(res, 200, expo.getFollowUpQueue(Object.fromEntries(parsed.searchParams.entries())));
          }
          if (req.method === 'GET' && parsed.pathname === '/api/expo/templates') {
            return json(res, 200, { ok: true, data: expo.listTemplates(Object.fromEntries(parsed.searchParams.entries())) });
          }
          if (req.method === 'GET' && parsed.pathname === '/api/expo/quotes') {
            return json(res, 200, { ok: true, data: expo.listQuotes(Object.fromEntries(parsed.searchParams.entries())) });
          }
          if (req.method === 'GET' && parsed.pathname === '/api/expo/expos') {
            return json(res, 200, { ok: true, data: expo.listExpos() });
          }
          if (req.method === 'GET' && parsed.pathname === '/api/expo/dashboard') {
            return json(res, 200, expo.dashboard(Object.fromEntries(parsed.searchParams.entries())));
          }
          if (req.method === 'POST') {
            const body = await readBody(req);
            const routes = {
              '/api/expo/expos/create': () => expo.createExpo(body, actor),
              '/api/expo/expos/status': () => expo.setExpoStatus(body, actor),
              '/api/expo/leads/import': () => expo.importLeads(body, actor),
              '/api/expo/leads/update': () => expo.updateLeadStatus(body, actor),
              '/api/expo/leads/contact': () => expo.updateLead(body, actor),
              '/api/expo/followups/complete': () => expo.completeFollowUp(body, actor),
              '/api/expo/templates/create': () => expo.createTemplate(body, actor),
              '/api/expo/templates/update': () => expo.updateTemplate(body, actor),
              '/api/expo/quotes/create': () => expo.createQuote(body, actor),
              '/api/expo/quotes/send': () => expo.sendQuoteEmailAsync(body, actor),
              '/api/expo/quotes/link': () => expo.getQuoteLink(body, actor),
              '/api/expo/quotes/booked': () => expo.markBooked(body, actor)
            };
            if (!routes[parsed.pathname]) return json(res, 404, { ok: false, error: { message: 'Unknown expo endpoint.' } });
            const result = await Promise.resolve(routes[parsed.pathname]());
            return json(res, expoStatus(result), result);
          }
          return json(res, 405, { ok: false, error: { message: 'This expo operation only supports GET or POST.' } });
        }
        if (req.method === 'GET' && parsed.pathname === '/api/phase1/state') return json(res, 200, await Promise.resolve(phase1.snapshot()));
        if (req.method === 'POST' && parsed.pathname === '/api/phase1/action') {
          if (!actorTokenValid(req)) return json(res, 401, { ok: false, error: { code: 'ACTOR_TOKEN_INVALID', message: 'A valid x-wmit-actor-token header is required for this server.' } });
          const body = await readBody(req);
          if (req.wmitActor) body.actor = req.wmitActor;
          const result = await Promise.resolve(phase1.action(body));
          return json(res, result.ok ? 200 : 400, result);
        }
        if (req.method === 'GET' && parsed.pathname === '/api/state') return json(res, 200, await Promise.resolve(app.snapshot()));
        if (req.method === 'GET' && parsed.pathname === '/api/attendance/dashboard') return json(res, 200, await Promise.resolve(app.getAttendanceDashboard(Object.fromEntries(parsed.searchParams.entries()))));
        if (req.method === 'GET' && parsed.pathname === '/api/attendance/history') return json(res, 200, await Promise.resolve(app.getAttendanceHistory(Object.fromEntries(parsed.searchParams.entries()))));
        if (req.method === 'GET' && parsed.pathname === '/api/attendance/exceptions') return json(res, 200, await Promise.resolve(app.getAttendanceExceptions(Object.fromEntries(parsed.searchParams.entries()))));
        if (req.method === 'GET' && parsed.pathname.startsWith('/api/leads/')) return json(res, 200, app.getLead(parsed.pathname.split('/').pop()));
        if (req.method === 'GET' && parsed.pathname.startsWith('/api/bookings/')) return json(res, 200, app.getBookingView(parsed.pathname.split('/').pop()));
        if (req.method === 'GET' && parsed.pathname.startsWith('/api/quotations/') && parsed.pathname.endsWith('/preview')) return json(res, 200, app.getClientQuotationPreview(parsed.pathname.split('/')[3]));
        if (req.method === 'GET' && parsed.pathname.startsWith('/api/quotations/')) return json(res, 200, app.getQuotationEditor(parsed.pathname.split('/').pop()));
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: { message: 'This operation only supports POST.' } });
        if (!actorTokenValid(req)) return json(res, 401, { ok: false, error: { code: 'ACTOR_TOKEN_INVALID', message: 'A valid x-wmit-actor-token header is required for this server.' } });
        const body = await readBody(req);
        const routes = {
          '/api/leads': () => app.createLead(body),
          '/api/leads/update': () => app.updateLead(body.lead_id, body.changes || body),
          '/api/quotations/from-lead': () => app.createQuotationFromLead(body),
          '/api/quotations/update': () => app.updateQuotation(body),
          '/api/quotation-items': () => app.addQuotationItem(body),
          '/api/quotation-items/update': () => app.updateQuotationItem(body),
          '/api/quotation-items/remove': () => app.removeQuotationItem(body),
          '/api/quotation-items/reorder': () => app.reorderQuotationItems(body),
          '/api/bookings/from-quotation': () => app.createBookingFromQuotation(body),
          '/api/booking-travelers': () => app.addBookingTraveler(body),
          '/api/supplier-bookings/from-item': () => app.createSupplierBookingFromBookingItem(body),
          '/api/invoices/from-booking': () => app.createInvoiceFromBooking(body),
          '/api/payments/from-invoice': () => app.recordPaymentFromInvoice(body),
          '/api/payments/to-supplier': () => app.recordSupplierPayment(body)
        };
        if (!routes[parsed.pathname]) return json(res, 404, { ok: false, error: { message: 'Unknown operations action.' } });
        const result = await Promise.resolve(routes[parsed.pathname]());
        return json(res, result.ok ? 200 : 400, result);
      }
      // Public quotation links: /q/<token> renders the branded quote page,
      // which reads the token from the path and fetches its own data.
      if (parsed.pathname.startsWith('/q/') && req.method === 'GET') {
        const filePath = path.join(publicRoot, 'quote.html');
        if (!fs.existsSync(filePath)) return json(res, 404, { ok: false, error: { message: 'Page not found.' } });
        serveStatic(req, res, filePath);
        return;
      }
      // Clean aliases: people type /login or /events without the .html —
      // redirect them instead of answering with JSON 404s.
      const pageAliases = {
        '/login': '/login.html',
        '/operations': '/operations.html',
        '/workspace': '/operations.html',
        '/events': '/expo-console.html',
        '/expo': '/expo.html',
        '/expo-console': '/expo-console.html',
        '/kiosk': '/expo.html',
        '/signup': '/expo.html',
        '/quote': '/quote.html',
        '/phase1': '/phase1.html'
      };
      if (req.method === 'GET' && pageAliases[parsed.pathname]) {
        res.writeHead(302, { Location: pageAliases[parsed.pathname], 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      const filePath = safePath(parsed.pathname);
      if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return json(res, 404, { ok: false, error: { message: 'Page not found.' } });
      serveStatic(req, res, filePath);
    } catch (error) {
      json(res, 500, { ok: false, error: { message: error.message || 'The local MVP could not complete the request.' } });
    }
  });
  return { app, phase1, server, auth, enforceSessions, expo };
}

if (require.main === module) {
  const port = Number(process.env.WMIT_MVP_PORT || 3000);
  const { server } = createMvpServer();
  server.listen(port, '127.0.0.1', () => console.log('WMIT Operations running at http://127.0.0.1:' + port));
}

module.exports = { createMvpServer };
