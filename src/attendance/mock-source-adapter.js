'use strict';

const { AttendanceSourceAdapter } = require('./source-adapter');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class MockAttendanceSourceAdapter extends AttendanceSourceAdapter {
  constructor(options) {
    const opts = options || {};
    super(Object.assign({ source_name: 'Synthetic Attendance Log', source_type: 'MOCK' }, opts.metadata || {}));
    this.events = clone(opts.events || []);
    this.roster = clone(opts.roster || []);
  }

  readAttendanceLog() {
    return clone(this.events);
  }

  readActiveRoster() {
    return clone(this.roster);
  }
}

module.exports = { MockAttendanceSourceAdapter };
