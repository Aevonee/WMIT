'use strict';

const { ConfigurationError } = require('../core/errors');

class GoogleSheetsAdapter {
  constructor(config) {
    this.config = config;
    this.enabled = Boolean(config && config.featureFlags && config.featureFlags.googleWorkspaceEnabled && config.google && config.google.spreadsheetId);
  }

  requireEnabled() {
    if (!this.enabled) {
      throw new ConfigurationError('Google Sheets is not configured. Use the in-memory repository for local tests.');
    }
  }

  readRows() { this.requireEnabled(); throw new Error('Google Sheets adapter implementation is intentionally deferred until Workspace access is approved.'); }
  appendRow() { this.requireEnabled(); throw new Error('Google Sheets adapter implementation is intentionally deferred until Workspace access is approved.'); }
  updateRow() { this.requireEnabled(); throw new Error('Google Sheets adapter implementation is intentionally deferred until Workspace access is approved.'); }
  findById() { this.requireEnabled(); throw new Error('Google Sheets adapter implementation is intentionally deferred until Workspace access is approved.'); }
  existsById() { this.requireEnabled(); throw new Error('Google Sheets adapter implementation is intentionally deferred until Workspace access is approved.'); }
}

module.exports = { GoogleSheetsAdapter };
