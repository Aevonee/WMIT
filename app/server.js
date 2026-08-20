'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { seedDemoRuntime } = require('../src/application/demo-data');
const { createPhase1Application } = require('../src/application/phase1');
const { buildInvoicePdf, buildItineraryPdf, buildReceiptPdf, buildVoucherPdf, buildQuotationPdf } = require('../src/documents/client-documents-pdf');

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

function invoiceEmailText(data) {
  const invoice = data.invoice || {};
  const totals = data.totals || {};
  const lines = [];
  lines.push('Dear ' + (invoice.client_name || 'Client') + ',');
  lines.push('');
  lines.push('Please find below your statement of account for booking ' + invoice.booking_id + (invoice.destination ? ' (' + invoice.destination + ')' : '') + '.');
  lines.push('');
  (data.obligations || []).forEach((obligation) => {
    lines.push('- ' + String(obligation.purpose || 'INSTALLMENT').replace(/_/g, ' ').toLowerCase()
      + ': ' + obligation.amount + ' ' + (obligation.currency || '')
      + (obligation.outstanding && obligation.outstanding !== '0.00' ? ' (outstanding: ' + obligation.outstanding + ')' : ' (paid)')
      + (obligation.dueAt ? ' — due ' + String(obligation.dueAt).slice(0, 10) : ''));
  });
  lines.push('');
  lines.push('Total: ' + (totals.obligationTotal || '0.00') + ' ' + (totals.currency || ''));
  lines.push('Verified payments received: ' + (totals.verifiedReceived || '0.00') + ' ' + (totals.currency || ''));
  lines.push('Outstanding balance: ' + (totals.outstanding || '0.00') + ' ' + (totals.currency || ''));
  if (data.bankDetails) {
    lines.push('');
    lines.push('Bank details:');
    String(data.bankDetails).split('\n').forEach((line) => { if (line.trim()) lines.push('  ' + line.trim()); });
  }
  lines.push('');
  lines.push('Thank you for choosing World Master International Travel.');
  return lines.join('\r\n');
}

function itineraryEmailText(data) {
  const itinerary = data.itinerary || {};
  const lines = [];
  lines.push('Dear ' + ((data.client && data.client.name) || 'Client') + ',');
  lines.push('');
  lines.push('Your travel itinerary for ' + (itinerary.destination || 'your trip') + (itinerary.travel_start ? ' (' + itinerary.travel_start + (itinerary.travel_end ? ' to ' + itinerary.travel_end : '') + ')' : '') + ' is ready.');
  const days = itinerary.itinerary_days || [];
  if (days.length) {
    lines.push('');
    days.forEach((day) => {
      lines.push('Day ' + day.day + (day.date ? ' (' + day.date + ')' : '') + ' — ' + (day.title || day.city || 'Travel day'));
      if (day.activities) lines.push('  ' + String(day.activities).replace(/\s+/g, ' ').trim());
      if (day.meals) lines.push('  Meals: ' + day.meals);
      if (day.overnight) lines.push('  Overnight: ' + day.overnight);
    });
  }
  if (data.flights && data.flights.length) {
    lines.push('');
    lines.push('Flights:');
    data.flights.forEach((flight) => {
      lines.push('  ' + [flight.route, flight.airline, flight.flight_number, flight.times, flight.service_date].filter(Boolean).join(' · '));
    });
  }
  if (data.vouchers && data.vouchers.length) {
    lines.push('');
    lines.push('Vouchers issued:');
    data.vouchers.forEach((voucher) => {
      lines.push('  ' + voucher.voucher_number + (voucher.description ? ' — ' + voucher.description : ''));
    });
  }
  lines.push('');
  lines.push('We wish you a wonderful trip.');
  lines.push('— World Master International Travel');
  return lines.join('\r\n');
}

function quotationEmailText(data) {
  const q = data.quotation || {};
  const lines = [];
  lines.push('Dear ' + ((data.client && data.client.name) || 'Client') + ',');
  lines.push('');
  lines.push('Your quotation for ' + (q.destination || 'your trip') + (q.travel_start ? ' (' + q.travel_start + (q.travel_end ? ' to ' + q.travel_end : '') + ')' : '') + ' is ready.');
  lines.push('Total: ' + (q.client_total || '0.00') + ' ' + (q.currency || 'PHP') + (q.valid_until ? ' — valid until ' + q.valid_until : ''));
  const items = data.items || [];
  if (items.length) {
    lines.push('');
    lines.push('Travel services:');
    items.forEach((item) => {
      lines.push('  ' + [item.service_type, item.description, item.quantity !== undefined ? 'x' + item.quantity : '', item.amount + ' ' + (item.currency || q.currency || '')].filter(Boolean).join(' · '));
    });
  }
  if (q.inclusions) {
    lines.push('');
    lines.push('Inclusions: ' + String(q.inclusions).replace(/\s+/g, ' ').trim());
  }
  if (q.payment_terms) {
    lines.push('');
    lines.push('Payment terms: ' + String(q.payment_terms).replace(/\s+/g, ' ').trim());
  }
  lines.push('');
  lines.push('Thank you for considering World Master International Travel.');
  lines.push('— World Master International Travel');
  return lines.join('\r\n');
}

function receiptEmailText(data) {
  const receipt = data.receipt || {};
  const lines = [];
  lines.push('Dear ' + ((data.client && data.client.name) || 'Client') + ',');
  lines.push('');
  lines.push('We confirm receipt of your payment. Thank you.');
  lines.push('');
  lines.push('Amount received: ' + receipt.amount + ' ' + (receipt.currency || ''));
  lines.push('Received on: ' + String(receipt.received_at || '').slice(0, 10));
  if (receipt.booking_id) lines.push('Booking: ' + receipt.booking_id);
  if (receipt.proof_reference) lines.push('Reference: ' + receipt.proof_reference);
  if (receipt.received_by) lines.push('Received by: ' + String(receipt.received_by).replace(/^USER:/, ''));
  lines.push('Receipt status: ' + (receipt.status === 'ISSUED' ? 'Official receipt ' + (receipt.receipt_id || '') : 'Acknowledgement (official receipt not yet issued)'));
  lines.push('');
  lines.push('Thank you for choosing World Master International Travel.');
  return lines.join('\r\n');
}

function voucherEmailText(data) {
  const booking = data.booking || {};
  const lines = [];
  lines.push('Dear ' + (booking.client_name || 'Client') + ',');
  lines.push('');
  lines.push('Your confirmed tour voucher' + (booking.destination ? ' for ' + booking.destination : '') + ' is ready.');
  if (booking.travel_start) lines.push('Travel: ' + booking.travel_start + (booking.travel_end ? ' to ' + booking.travel_end : ''));
  lines.push('');
  const vouchers = data.vouchers || [];
  if (vouchers.length) {
    lines.push('Vouchers issued:');
    vouchers.forEach((voucher) => {
      lines.push('  ' + voucher.voucher_number + ' — ' + (voucher.service_description || 'Booked service') + (voucher.supplier_name ? ' (' + voucher.supplier_name + ')' : ''));
    });
  } else {
    lines.push('No vouchers have been issued for this booking yet.');
  }
  lines.push('');
  lines.push('Please present the voucher to each supplier on arrival.');
  lines.push('— World Master International Travel');
  return lines.join('\r\n');
}

function createMvpServer(options) {
  const app = (options && options.app) || seedDemoRuntime(options);
  const phase1 = (options && options.phase1App) || createPhase1Application(options);
  const auth = (options && options.auth) || null;
  const enforceSessions = Boolean(options && options.enforceSessions && auth);
  const health = (options && options.health) || null;
  const expo = (options && options.expo) || null;
  const documents = (options && options.documents) || null;
  const mailer = (options && options.mailer) || null;
  const documentAuditLog = (options && options.auditLog) || null;
  const auditLogReader = documentAuditLog;
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
        // Public booking-status data: the /status/<token> page reads here.
        // Session-free like the expo quote channel; unknown, expired, and
        // replaced tokens all answer with the same 404 (no enumeration).
        if (parsed.pathname === '/api/public/booking-status' && req.method === 'GET') {
          if (!phase1 || !phase1.runtime) return json(res, 501, { ok: false, error: { code: 'STATUS_UNAVAILABLE', message: 'This server runs without the booking runtime.' } });
          const result = phase1.runtime.getPublicBookingStatus(parsed.searchParams.get('token'));
          const statusFor = (outcome) => !outcome.ok && outcome.error && ['BOOKING_STATUS_NOT_FOUND', 'TOKEN_INVALID'].includes(outcome.error.code) ? 404 : outcome.ok ? 200 : 400;
          return json(res, statusFor(result), result);
        }
        if (enforceSessions && parsed.pathname !== '/api/health') {
          const session = auth.sessionFor(bearerToken(req));
          if (!session) return json(res, 401, { ok: false, error: { code: 'UNAUTHORIZED', message: 'Sign in to WMIT to use this API.' } });
          if (req.method !== 'GET' && session.role === 'INTERN') {
            // Interns are read-only with one exception: submitting their own
            // intern tasks. The body is parsed here and stashed so the action
            // handler does not try to re-read the consumed stream; the runtime
            // still enforces task ownership against USER:<username>.
            let allowed = false;
            if (req.method === 'POST' && parsed.pathname === '/api/phase1/action') {
              const body = await readBody(req);
              req.wmitBody = body;
              allowed = body && body.action === 'submitInternTask';
            }
            if (!allowed) return json(res, 403, { ok: false, error: { code: 'INTERN_WRITE_FORBIDDEN', message: 'Intern accounts are read-only.' } });
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
        if (parsed.pathname === '/api/settings' && req.method === 'GET') {
          if (!phase1 || typeof phase1.settings !== 'function') return json(res, 200, { ok: true, data: { messageTemplates: [], quotationDefaults: {} } });
          return json(res, 200, { ok: true, data: phase1.settings() });
        }
        // Client document email: render-only delivery of invoice/itinerary
        // previews through the mailer (SMTP when configured, otherwise a
        // reviewable .eml draft). Send requires an explicit client-facing
        // confirmation in the UI before this endpoint is called.
        if (parsed.pathname === '/api/documents/email' && req.method === 'POST') {
          if (!mailer) return json(res, 501, { ok: false, error: { code: 'MAIL_UNAVAILABLE', message: 'This server runs without a mailer.' } });
          const body = await readBody(req);
          const kind = String(body.kind || '');
          const email = String(body.email || '').trim();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { ok: false, error: { code: 'EMAIL_INVALID', message: 'A valid recipient email address is required.' } });
          let rendered = null;
          let entityId = '';
          if (kind === 'invoice') {
            entityId = String(body.booking_id || '');
            rendered = phase1 && typeof phase1.action === 'function' ? await Promise.resolve(phase1.action({ action: 'getClientInvoicePreview', input: { booking_id: entityId }, actor: req.wmitActor })) : null;
          } else if (kind === 'itinerary') {
            entityId = String(body.quotation_id || '');
            rendered = phase1 && typeof phase1.action === 'function' ? await Promise.resolve(phase1.action({ action: 'getClientItineraryPreview', input: { quotation_id: entityId }, actor: req.wmitActor })) : null;
          } else if (kind === 'receipt') {
            entityId = String(body.receipt_id || body.client_payment_id || '');
            rendered = phase1 && typeof phase1.action === 'function' ? await Promise.resolve(phase1.action({ action: 'getPaymentReceiptPreview', input: { receipt_id: body.receipt_id, client_payment_id: body.client_payment_id }, actor: req.wmitActor })) : null;
          } else if (kind === 'voucher') {
            entityId = String(body.booking_id || '');
            rendered = phase1 && typeof phase1.action === 'function' ? await Promise.resolve(phase1.action({ action: 'getClientVoucherPreview', input: { booking_id: entityId }, actor: req.wmitActor })) : null;
          } else if (kind === 'quotation') {
            entityId = String(body.quotation_id || '');
            rendered = phase1 && typeof phase1.action === 'function' ? await Promise.resolve(phase1.action({ action: 'getClientQuotationPreview', input: { quotation_id: entityId }, actor: req.wmitActor })) : null;
          } else {
            return json(res, 400, { ok: false, error: { code: 'DOCUMENT_KIND_INVALID', message: 'kind must be invoice, itinerary, receipt, voucher, or quotation.' } });
          }
          if (!rendered || !rendered.ok) return json(res, 400, rendered || { ok: false, error: { code: 'DOCUMENT_UNAVAILABLE', message: 'The document could not be generated.' } });
          const subjects = {
            invoice: 'World Master International Travel — Statement of Account (' + (rendered.data.invoice && rendered.data.invoice.booking_id || entityId) + ')',
            itinerary: 'World Master International Travel — Travel Itinerary (' + (rendered.data.itinerary && rendered.data.itinerary.destination || entityId) + ')',
            receipt: 'World Master International Travel — Payment Receipt (' + (rendered.data.receipt && rendered.data.receipt.booking_id || entityId) + ')',
            voucher: 'World Master International Travel — Confirmed Tour Voucher (' + (rendered.data.booking && rendered.data.booking.booking_id || entityId) + ')',
            quotation: 'World Master International Travel — Quotation (' + (rendered.data.quotation && rendered.data.quotation.destination || entityId) + ')'
          };
          const textFor = { invoice: invoiceEmailText, itinerary: itineraryEmailText, receipt: receiptEmailText, voucher: voucherEmailText, quotation: quotationEmailText };
          const delivery = await mailer.send({ to: email, subject: subjects[kind], text: textFor[kind](rendered.data) });
          if (documentAuditLog) {
            try {
              documentAuditLog.record({ actor: req.wmitActor || 'LOCAL_STAFF', action: 'EMAIL_DOCUMENT', entity_type: 'Document', entity_id: kind.toUpperCase() + ':' + entityId, result: delivery && delivery.sent ? 'SUCCESS' : 'DRAFT', details: { to: email, kind, mode: delivery && delivery.mode } });
            } catch (_) { /* audit is best effort; delivery already succeeded */ }
          }
           return json(res, 200, { ok: true, data: { delivery }, meta: { action: 'EMAIL_DOCUMENT' } });
        }
        // Client document PDF download: renders the same preview data the
        // email path uses into a downloadable PDF (zero dependencies).
        if (parsed.pathname === '/api/documents/pdf' && req.method === 'POST') {
          const body = await readBody(req);
          const kind = String(body.kind || '');
          let rendered = null;
          let entityId = '';
          if (kind === 'invoice') {
            entityId = String(body.booking_id || '');
            rendered = phase1 && typeof phase1.action === 'function' ? await Promise.resolve(phase1.action({ action: 'getClientInvoicePreview', input: { booking_id: entityId }, actor: req.wmitActor })) : null;
          } else if (kind === 'itinerary') {
            entityId = String(body.quotation_id || '');
            rendered = phase1 && typeof phase1.action === 'function' ? await Promise.resolve(phase1.action({ action: 'getClientItineraryPreview', input: { quotation_id: entityId }, actor: req.wmitActor })) : null;
          } else if (kind === 'receipt') {
            entityId = String(body.receipt_id || body.client_payment_id || '');
            rendered = phase1 && typeof phase1.action === 'function' ? await Promise.resolve(phase1.action({ action: 'getPaymentReceiptPreview', input: { receipt_id: body.receipt_id, client_payment_id: body.client_payment_id }, actor: req.wmitActor })) : null;
          } else if (kind === 'voucher') {
            entityId = String(body.booking_id || '');
            rendered = phase1 && typeof phase1.action === 'function' ? await Promise.resolve(phase1.action({ action: 'getClientVoucherPreview', input: { booking_id: entityId }, actor: req.wmitActor })) : null;
          } else if (kind === 'quotation') {
            entityId = String(body.quotation_id || '');
            rendered = phase1 && typeof phase1.action === 'function' ? await Promise.resolve(phase1.action({ action: 'getClientQuotationPreview', input: { quotation_id: entityId }, actor: req.wmitActor })) : null;
            if (rendered && rendered.ok && rendered.data && rendered.data.quotation && !rendered.data.quotation.quotation_id) rendered.data.quotation.quotation_id = entityId;
          } else {
            return json(res, 400, { ok: false, error: { code: 'DOCUMENT_KIND_INVALID', message: 'kind must be invoice, itinerary, receipt, voucher, or quotation.' } });
          }
          if (!rendered || !rendered.ok) return json(res, 400, rendered || { ok: false, error: { code: 'DOCUMENT_UNAVAILABLE', message: 'The document could not be generated.' } });
          const pdfFor = { invoice: buildInvoicePdf, itinerary: buildItineraryPdf, receipt: buildReceiptPdf, voucher: buildVoucherPdf, quotation: buildQuotationPdf };
          const pdfResult = pdfFor[kind](rendered.data);
          if (!pdfResult.ok) return json(res, 400, { ok: false, error: { code: 'PDF_RENDER_FAILED', message: pdfResult.error.message } });
          if (documentAuditLog) {
            try {
              documentAuditLog.record({ actor: req.wmitActor || 'LOCAL_STAFF', action: 'PDF_DOCUMENT', entity_type: 'Document', entity_id: kind.toUpperCase() + ':' + entityId, result: 'SUCCESS', details: { kind, filename: pdfResult.filename } });
            } catch (_) { /* audit is best effort */ }
          }
          res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="' + pdfResult.filename + '"', 'Cache-Control': 'no-store' });
          res.end(pdfResult.pdf);
          return;
        }
        // --- Document ingestion (register / classify / extract / review) ----
        if (parsed.pathname.startsWith('/api/documents/ingest/')) {
          if (!documents) return json(res, 501, { ok: false, error: { code: 'DOCUMENTS_UNAVAILABLE', message: 'This server runs without the document ingestion service.' } });
          const sub = parsed.pathname.slice('/api/documents/ingest/'.length);
          const statusFor = (result) => result.ok ? 200 : (result.error && result.error.code === 'NOT_FOUND' ? 404 : 400);
          if (req.method === 'POST' && sub === 'register') {
            const body = await readBody(req);
            const result = await Promise.resolve(documents.registerDocument(Object.assign({}, body, { uploaded_by: body.uploaded_by || req.wmitActor }), req.wmitActor));
            return json(res, statusFor(result), result);
          }
          if (req.method === 'POST' && sub === 'classify') {
            const body = await readBody(req);
            const result = await Promise.resolve(documents.classifyDocument(body.document_id, req.wmitActor));
            return json(res, statusFor(result), result);
          }
          if (req.method === 'POST' && sub === 'extract') {
            const body = await readBody(req);
            const result = await Promise.resolve(documents.extractDocument(body.document_id, req.wmitActor));
            return json(res, statusFor(result), result);
          }
          if (req.method === 'GET' && sub === 'queue') {
            return json(res, 200, documents.queue(Object.fromEntries(parsed.searchParams.entries())));
          }
          if (req.method === 'GET' && sub === 'match') {
            const result = await Promise.resolve(documents.matchSuggestions(parsed.searchParams.get('document_id')));
            return json(res, statusFor(result), result);
          }
          if (req.method === 'POST' && sub === 'review') {
            const body = await readBody(req);
            const result = await Promise.resolve(documents.reviewDocument(Object.assign({}, body, { reviewer: body.reviewer || req.wmitActor }), req.wmitActor));
            return json(res, statusFor(result), result);
          }
          return json(res, 404, { ok: false, error: { message: 'Unknown document ingestion endpoint.' } });
        }
        // --- Account self-service and administration -------------------------
        if (parsed.pathname === '/api/auth/password' && req.method === 'POST') {
          if (!auth) return json(res, 501, { ok: false, error: { code: 'AUTH_UNAVAILABLE', message: 'This server runs without an account store.' } });
          const session = req.wmitSession || auth.sessionFor(bearerToken(req));
          if (!session) return json(res, 401, { ok: false, error: { code: 'UNAUTHORIZED', message: 'Sign in to WMIT to use this API.' } });
          const body = await readBody(req);
          try {
            const result = auth.changeOwnPassword(session.username, body.current_password, body.new_password, session.token);
            return json(res, 200, { ok: true, data: result, meta: { action: 'CHANGE_OWN_PASSWORD' } });
          } catch (error) {
            return json(res, 400, { ok: false, error: { code: error.code || 'ACCOUNT_PASSWORD_INVALID', message: error.message } });
          }
        }
        if (parsed.pathname === '/api/admin/system-health' && req.method === 'GET') {
          if (!auth) return json(res, 501, { ok: false, error: { code: 'AUTH_UNAVAILABLE', message: 'This server runs without an account store.' } });
          const session = req.wmitSession || auth.sessionFor(bearerToken(req));
          if (!session) return json(res, 401, { ok: false, error: { code: 'UNAUTHORIZED', message: 'Sign in to WMIT to use this API.' } });
          if (session.role !== 'ADMIN') return json(res, 403, { ok: false, error: { code: 'ADMIN_REQUIRED', message: 'Only Admin accounts can read system health.' } });
          const db = auditLogReader && auditLogReader.db;
          if (!db) return json(res, 200, { ok: true, data: { available: false } });
          const { lastSuccessfulRun, auditChainValid, latestHeartbeat } = require('../src/server/jobs');
          let lastBackup = null;
          let chain = null;
          let heartbeat = null;
          try { lastBackup = lastSuccessfulRun(db, 'backup'); } catch (_) { lastBackup = null; }
          try { chain = auditChainValid(db); } catch (_) { chain = null; }
          try { heartbeat = latestHeartbeat(db); } catch (_) { heartbeat = null; }
          return json(res, 200, { ok: true, data: { available: true, lastBackup, auditChain: chain, heartbeat } });
        }
        if (parsed.pathname === '/api/admin/audit' && req.method === 'GET') {
          if (!auth) return json(res, 501, { ok: false, error: { code: 'AUTH_UNAVAILABLE', message: 'This server runs without an account store.' } });
          const session = req.wmitSession || auth.sessionFor(bearerToken(req));
          if (!session) return json(res, 401, { ok: false, error: { code: 'UNAUTHORIZED', message: 'Sign in to WMIT to use this API.' } });
          if (session.role !== 'ADMIN') return json(res, 403, { ok: false, error: { code: 'ADMIN_REQUIRED', message: 'Only Admin accounts can read the audit log.' } });
          if (!auditLogReader) return json(res, 501, { ok: false, error: { code: 'AUDIT_UNAVAILABLE', message: 'This server runs without an audit log.' } });
          const limitParam = Number(parsed.searchParams.get('limit') || 50);
          const limit = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 500 ? limitParam : 50;
          let chainVerified = null;
          try { chainVerified = auditLogReader.verifyChain ? auditLogReader.verifyChain() : null; } catch (_) { chainVerified = null; }
          return json(res, 200, { ok: true, data: { events: auditLogReader.list(limit), chain_verified: chainVerified }, meta: { action: 'ADMIN_AUDIT' } });
        }
        if (parsed.pathname.startsWith('/api/admin/accounts')) {          if (!auth) return json(res, 501, { ok: false, error: { code: 'AUTH_UNAVAILABLE', message: 'This server runs without an account store.' } });
          const session = req.wmitSession || auth.sessionFor(bearerToken(req));
          if (!session) return json(res, 401, { ok: false, error: { code: 'UNAUTHORIZED', message: 'Sign in to WMIT to use this API.' } });
          if (session.role !== 'ADMIN') return json(res, 403, { ok: false, error: { code: 'ADMIN_REQUIRED', message: 'Only Admin accounts manage WMIT accounts.' } });
          const actor = 'USER:' + session.username;
          if (req.method === 'GET' && parsed.pathname === '/api/admin/accounts') {
            return json(res, 200, { ok: true, data: auth.listAccounts() });
          }
          if (req.method === 'POST') {
            const body = await readBody(req);
            const routes = {
              '/api/admin/accounts/create': () => auth.createAccount(body, actor),
              '/api/admin/accounts/status': () => auth.setAccountStatus(body.username, body.status, actor, session.username),
              '/api/admin/accounts/role': () => auth.updateAccountRole(body.username, body.role, actor, session.username),
              '/api/admin/accounts/reset-password': () => auth.resetPassword(body.username, body.new_password, actor)
            };
            if (!routes[parsed.pathname]) return json(res, 404, { ok: false, error: { message: 'Unknown account endpoint.' } });
            try {
              return json(res, 200, { ok: true, data: routes[parsed.pathname](), meta: { action: 'ADMIN_ACCOUNTS' } });
            } catch (error) {
              const status = error.code === 'ACCOUNT_NOT_FOUND' ? 404 : 400;
              return json(res, status, { ok: false, error: { code: error.code || 'ACCOUNT_INVALID', message: error.message } });
            }
          }
          return json(res, 405, { ok: false, error: { message: 'This account operation only supports GET or POST.' } });
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
          if (req.method === 'GET' && parsed.pathname === '/api/expo/analytics') {
            return json(res, 200, expo.getExpoAnalytics(Object.fromEntries(parsed.searchParams.entries()), actor));
          }
          if (req.method === 'POST') {
            const body = await readBody(req);
            const routes = {
              '/api/expo/expos/create': () => expo.createExpo(body, actor),
              '/api/expo/expos/status': () => expo.setExpoStatus(body, actor),
              '/api/expo/leads/import': () => expo.importLeads(body, actor),
              '/api/expo/leads/update': () => expo.updateLeadStatus(body, actor),
              '/api/expo/leads/convert': () => expo.convertLead(body, actor),
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
        // Accountant CSV download: renders one of the three period export
        // documents (cashbook / receivables / payables) through the audited
        // read-only runtime action. BOM + CRLF so Excel opens it cleanly.
        if (parsed.pathname === '/api/accounting/export.csv' && req.method === 'GET') {
          const type = String(parsed.searchParams.get('type') || 'cashbook');
          if (!['cashbook', 'receivables', 'payables'].includes(type)) {
            return json(res, 400, { ok: false, error: { code: 'EXPORT_TYPE_INVALID', message: 'type must be cashbook, receivables, or payables.' } });
          }
          const from = parsed.searchParams.get('from');
          const to = parsed.searchParams.get('to');
          const result = await Promise.resolve(phase1.action({ action: 'getAccountantExport', input: { from, to }, actor: req.wmitActor }));
          if (!result.ok) return json(res, 400, result);
          const document = result.data[type];
          const filename = 'wmit-' + type + '-' + result.data.from + '-to-' + result.data.to + '.csv';
          res.writeHead(200, {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="' + filename + '"',
            'Cache-Control': 'no-store'
          });
          res.end(document.bom);
          return;
        }
        if (req.method === 'GET' && parsed.pathname === '/api/phase1/state') return json(res, 200, await Promise.resolve(phase1.snapshot()));
        if (req.method === 'POST' && parsed.pathname === '/api/phase1/action') {
          if (!actorTokenValid(req)) return json(res, 401, { ok: false, error: { code: 'ACTOR_TOKEN_INVALID', message: 'A valid x-wmit-actor-token header is required for this server.' } });
          const body = req.wmitBody || await readBody(req);
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
      // Public booking-status links: /status/<token> renders the client
      // status page the same way — the page parses the token from the path
      // and fetches its own data from the public booking-status endpoint.
      if (parsed.pathname.startsWith('/status/') && req.method === 'GET') {
        const filePath = path.join(publicRoot, 'status.html');
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
        '/quote': '/quote.html'
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
