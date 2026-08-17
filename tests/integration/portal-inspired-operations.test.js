'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Booking workspace exposes the existing projection as a multi-service operational summary', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'public', 'operations.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'public', 'operations.html'), 'utf8');
  assert.match(source, /bookingOperationalSummaryMarkup/);
  assert.match(source, /bookingServiceCardsMarkup/);
  assert.match(source, /selectBookingItem/);
  assert.match(source, /projection\.finance/);
  assert.match(source, /projection\.profitability/);
  assert.match(source, /projection\.deadlines/);
  assert.match(source, /bookingDocumentRecords/);
  assert.match(source, /selectedWorkspaceId\('booking-item'\)/);
  assert.match(html, /booking-service-grid/);
  assert.match(html, /booking-ops-summary/);
});
