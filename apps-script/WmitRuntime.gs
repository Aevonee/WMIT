/**
 * WMIT Apps Script runtime boundary.
 *
 * This file intentionally contains no SpreadsheetApp or DriveApp calls.
 * The production adapter will be injected only after the owner's Workspace
 * account is available and the target files are explicitly approved.
 */
var WmitRuntime = (function () {
  var services = null;

  function configure(nextServices) {
    if (!nextServices) {
      throw new Error('WMIT runtime requires explicitly injected services.');
    }
    services = nextServices;
  }

  function requireServices() {
    if (!services) {
      throw new Error('WMIT Apps Script runtime is not configured. Phase 1 is local-only.');
    }
    return services;
  }

  return {
    configure: configure,
    requireServices: requireServices
  };
}());
