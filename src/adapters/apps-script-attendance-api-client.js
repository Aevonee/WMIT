'use strict';

const crypto = require('crypto');
const { WmitError } = require('../core/errors');

function dateOnly(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new WmitError('ATTENDANCE_API_RANGE', 'Attendance dates must use YYYY-MM-DD.');
  const date = new Date(text + 'T00:00:00.000Z');
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) throw new WmitError('ATTENDANCE_API_RANGE', 'Attendance date is invalid.');
  return text;
}

function validateRange(from, to) {
  const start = dateOnly(from);
  const end = dateOnly(to);
  const days = (Date.parse(end + 'T00:00:00.000Z') - Date.parse(start + 'T00:00:00.000Z')) / 86400000 + 1;
  if (days < 1) throw new WmitError('ATTENDANCE_API_RANGE', 'Attendance date range is invalid.');
  if (days > 32) throw new WmitError('ATTENDANCE_API_RANGE', 'Attendance date range cannot exceed 32 days including the overnight lookback day.');
  return { from: start, to: end };
}

function canonicalRequest(request) {
  return [
    'v1', request.api_version || '1', request.operation || '', request.request_id || '',
    request.issued_at || '', request.nonce || '', request.from || '', request.to || ''
  ].join('\n');
}

function randomHex(bytes) { return crypto.randomBytes(bytes).toString('hex'); }

class AppsScriptAttendanceApiClient {
  constructor(options) {
    const opts = options || {};
    this.url = opts.url || '';
    this.keyId = opts.keyId || '';
    this.secret = opts.secret || '';
    this.fetchImpl = opts.fetchImpl || globalThis.fetch;
    this.clock = opts.clock || (() => new Date());
    this.requestId = opts.requestId || (() => 'WMIT-' + randomHex(12));
    this.nonce = opts.nonce || (() => randomHex(16));
  }

  request(operation, range) {
    if (!this.url || !this.keyId || !this.secret) throw new WmitError('ATTENDANCE_API_NOT_CONFIGURED', 'The attendance Apps Script API is not configured on the server.');
    if (!/^https?:\/\//i.test(this.url)) throw new WmitError('ATTENDANCE_API_NOT_CONFIGURED', 'WMIT_ATTENDANCE_API_URL must be the full deployed Apps Script web-app URL ending in /exec, not only the deployment ID.');
    if (typeof this.fetchImpl !== 'function') throw new WmitError('ATTENDANCE_API_UNAVAILABLE', 'The server does not provide an HTTP client for the attendance API.');
    const dates = operation === 'attendance.events' ? validateRange(range && range.from, range && range.to) : {};
    const issuedAt = this.clock().toISOString();
    const body = {
      api_version: '1', operation, request_id: this.requestId(), issued_at: issuedAt,
      nonce: this.nonce(), key_id: this.keyId, from: dates.from, to: dates.to
    };
    body.signature = crypto.createHmac('sha256', this.secret).update(canonicalRequest(body), 'utf8').digest('base64');
    return Promise.resolve().then(() => this.fetchImpl(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    })).then(async (response) => {
      const text = await response.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch (error) {
        const contentType = response.headers && typeof response.headers.get === 'function'
          ? response.headers.get('content-type') || ''
          : '';
        const looksLikeHtml = /^\s*</.test(text) || /html/i.test(contentType);
        const responseHint = looksLikeHtml
          ? ' It returned an HTML page, usually caused by an incorrect /exec URL, an unpublished deployment, or web-app access requiring a Google login.'
          : ' Check the deployed Apps Script version and endpoint response.';
        throw new WmitError('ATTENDANCE_API_UNAVAILABLE', 'The attendance API returned invalid JSON.' + responseHint);
      }
      if (!response.ok || !payload.ok) {
        const apiError = payload.error || {};
        throw new WmitError('ATTENDANCE_API_' + (apiError.code || 'ERROR'), apiError.message || 'The attendance API rejected the request.');
      }
      return payload;
    }).catch((error) => {
      if (error instanceof WmitError) throw error;
      throw new WmitError('ATTENDANCE_API_UNAVAILABLE', 'The attendance API could not be reached.');
    });
  }

  getAttendanceEvents(range) { return this.request('attendance.events', range); }
  getRoster() { return this.request('attendance.roster', {}); }
}

module.exports = { AppsScriptAttendanceApiClient, canonicalRequest, validateRange };
