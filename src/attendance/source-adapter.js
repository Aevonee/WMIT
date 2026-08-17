'use strict';

class AttendanceSourceAdapter {
  constructor(metadata) {
    this.metadata = Object.assign({ source_name: 'Attendance source', read_only: true }, metadata || {});
    this.readOnly = true;
  }

  readAttendanceLog() {
    throw new Error('Attendance source adapter must implement readAttendanceLog().');
  }

  readActiveRoster() {
    throw new Error('Attendance source adapter must implement readActiveRoster().');
  }

  getMetadata() {
    return Object.assign({}, this.metadata);
  }
}

class FallbackAttendanceSourceAdapter extends AttendanceSourceAdapter {
  constructor(primary, fallback) {
    super(Object.assign({}, primary && primary.getMetadata ? primary.getMetadata() : {}, { read_only: true }));
    this.primary = primary;
    this.fallback = fallback;
    this.fallbackError = null;
  }

  readAttendanceLog(range) {
    try {
      this.fallbackError = null;
      const result = this.primary.readAttendanceLog(range);
      return result && typeof result.then === 'function' ? result.catch((error) => { this.fallbackError = error; return this.fallback.readAttendanceLog(range); }) : result;
    }
    catch (error) { this.fallbackError = error; return this.fallback.readAttendanceLog(range); }
  }

  readActiveRoster() {
    try {
      const result = this.primary.readActiveRoster();
      return result && typeof result.then === 'function' ? result.catch((error) => { this.fallbackError = error; return this.fallback.readActiveRoster(); }) : result;
    }
    catch (error) { this.fallbackError = error; return this.fallback.readActiveRoster(); }
  }

  getMetadata() {
    const primaryMetadata = this.primary && this.primary.getMetadata ? this.primary.getMetadata() : {};
    if (!this.fallbackError) return Object.assign({}, primaryMetadata, { read_only: true });
    const fallbackMetadata = this.fallback && this.fallback.getMetadata ? this.fallback.getMetadata() : {};
    return Object.assign({}, fallbackMetadata, {
      source_status: 'FALLBACK',
      warning: 'Google Sheets attendance was unavailable. Demo Data is being shown as the configured fallback.',
      primary_source: primaryMetadata.source_label || primaryMetadata.source_name,
      primary_error: this.fallbackError.message,
      read_only: true
    });
  }

  getTimezone() {
    return this.fallbackError && this.fallback.getTimezone ? this.fallback.getTimezone() : (this.primary.getTimezone ? this.primary.getTimezone() : undefined);
  }
}

module.exports = { AttendanceSourceAdapter, FallbackAttendanceSourceAdapter };
