'use strict';

const { ConfigurationError } = require('../core/errors');
const { AttendanceSourceAdapter } = require('../attendance/source-adapter');

function flagEnabled(flags, camelCase, constantName) {
  return Boolean(flags && (flags[camelCase] || flags[constantName]));
}

class GoogleSheetsAttendanceAdapter extends AttendanceSourceAdapter {
  constructor(config, client) {
    super({ source_name: 'Attendance Apps Script API', source_label: 'Google Apps Script', source_type: 'GOOGLE_APPS_SCRIPT_ATTENDANCE_API', source_status: 'CONFIGURED', read_only: true });
    this.config = config || {};
    this.client = client || null;
    const flags = this.config.featureFlags || {};
    const monitoringEnabled = flagEnabled(flags, 'attendanceMonitoringEnabled', 'ATTENDANCE_MONITORING_ENABLED');
    const apiEnabled = flagEnabled(flags, 'attendanceGoogleSourceEnabled', 'ATTENDANCE_GOOGLE_SOURCE_ENABLED');
    this.enabled = Boolean(monitoringEnabled && apiEnabled);
    this.timezone = this.config.timezone || 'Asia/Manila';
    this.lastError = null;
    this.lastResponse = null;
    this.apiWarnings = [];
  }

  requireConfigured() {
    if (!this.enabled) throw new ConfigurationError('The attendance Apps Script API is not configured or is disabled. Enable both attendance monitoring flags only after the API is deployed and tested.');
    if (!this.client || typeof this.client.getAttendanceEvents !== 'function' || typeof this.client.getRoster !== 'function') {
      throw new ConfigurationError('The attendance Apps Script API client is not available in this runtime.');
    }
  }

  readAttendanceLog(range) {
    this.requireConfigured();
    try {
      const response = this.client.getAttendanceEvents({
        from: range && (range.from || range.date_from || range.date),
        to: range && (range.to || range.date_to || range.from || range.date)
      });
      const process = (resolvedResponse) => {
        if (!resolvedResponse || resolvedResponse.ok !== true || !Array.isArray(resolvedResponse.events)) throw new Error('The attendance API returned an invalid events response.');
        this.lastResponse = resolvedResponse;
        this.apiWarnings = Array.isArray(resolvedResponse.warnings) ? resolvedResponse.warnings.slice() : [];
        this.timezone = resolvedResponse.timezone || this.timezone;
        this.lastError = null;
        return resolvedResponse.events.map((event) => Object.assign({}, event, { source_row_reference: event.source_row_reference }));
      };
      return response && typeof response.then === 'function' ? response.then(process).catch((error) => { this.lastError = error; throw error; }) : process(response);
    } catch (error) {
      this.lastError = error;
      throw error;
    }
  }

  readActiveRoster() {
    this.requireConfigured();
    try {
      const response = this.client.getRoster();
      const process = (resolvedResponse) => {
        if (!resolvedResponse || resolvedResponse.ok !== true || !Array.isArray(resolvedResponse.roster)) throw new Error('The attendance API returned an invalid roster response.');
        this.lastResponse = resolvedResponse;
        this.apiWarnings = Array.isArray(resolvedResponse.warnings) ? resolvedResponse.warnings.slice() : [];
        this.timezone = resolvedResponse.timezone || this.timezone;
        this.lastError = null;
        return resolvedResponse.roster.map((person) => Object.assign({}, person));
      };
      return response && typeof response.then === 'function' ? response.then(process).catch((error) => { this.lastError = error; throw error; }) : process(response);
    } catch (error) {
      this.lastError = error;
      throw error;
    }
  }

  getTimezone() { return this.timezone; }

  getMetadata() {
    return Object.assign({}, this.metadata, {
      source_status: this.lastError ? 'UNAVAILABLE' : this.lastResponse ? 'AVAILABLE' : 'CONFIGURED',
      timezone: this.timezone,
      warning: this.lastError ? this.lastError.message : this.apiWarnings.length ? ('Attendance API returned ' + this.apiWarnings.length + ' data-quality warning(s).') : undefined,
      read_only: true
    });
  }
}

module.exports = { GoogleSheetsAttendanceAdapter, flagEnabled };
