'use strict';

const { ConfigurationError } = require('../core/errors');

class GoogleDriveAdapter {
  constructor(config) {
    this.config = config;
    this.enabled = Boolean(config && config.featureFlags && config.featureFlags.googleWorkspaceEnabled && config.google && config.google.driveRootFolderId);
  }

  requireEnabled() {
    if (!this.enabled) {
      throw new ConfigurationError('Google Drive is not configured. Use the in-memory file repository for local tests.');
    }
  }

  findFile() { this.requireEnabled(); throw new Error('Google Drive adapter implementation is intentionally deferred until Workspace access is approved.'); }
  createFile() { this.requireEnabled(); throw new Error('Google Drive adapter implementation is intentionally deferred until Workspace access is approved.'); }
  updateMetadata() { this.requireEnabled(); throw new Error('Google Drive adapter implementation is intentionally deferred until Workspace access is approved.'); }
  getMetadata() { this.requireEnabled(); throw new Error('Google Drive adapter implementation is intentionally deferred until Workspace access is approved.'); }
}

module.exports = { GoogleDriveAdapter };
