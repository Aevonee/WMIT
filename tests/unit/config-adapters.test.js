'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getDefaultConfig, loadConfig } = require('../../src/config/config');
const { GoogleSheetsAdapter } = require('../../src/adapters/google-sheets-adapter');
const { GoogleDriveAdapter } = require('../../src/adapters/google-drive-adapter');
const { ConfigurationError } = require('../../src/core/errors');

test('loads safe development defaults without production Google IDs', () => {
  const config = getDefaultConfig();
  assert.equal(config.environment, 'development');
  assert.equal(config.google.spreadsheetId, '');
  assert.equal(config.google.driveRootFolderId, '');
  assert.equal(config.featureFlags.googleWorkspaceEnabled, false);
  assert.equal(loadConfig({ environment: 'test' }).schemaVersion, '1.4.0-quotation-payments-itinerary');
  assert.throws(
    () => loadConfig({ environment: 'production', featureFlags: { googleWorkspaceEnabled: true } }),
    ConfigurationError
  );
});

test('future Google adapters fail safely when unconfigured', () => {
  const config = getDefaultConfig();
  const sheets = new GoogleSheetsAdapter(config);
  const drive = new GoogleDriveAdapter(config);
  assert.throws(() => sheets.readRows('Clients'), ConfigurationError);
  assert.throws(() => drive.findFile('synthetic-file'), ConfigurationError);
});
