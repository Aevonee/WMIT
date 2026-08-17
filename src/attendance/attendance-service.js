'use strict';

const { WmitError } = require('../core/errors');
const { AttendanceIdentityMap } = require('./identity-map');
const { buildAttendanceProjection, localDate } = require('./projection');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function withoutSensitiveEvent(event) {
  const result = Object.assign({}, event);
  delete result.selfie_link_ref;
  delete result.source_row;
  return result;
}

function withoutSensitiveProjection(projection) {
  return Object.assign({}, projection, {
    events: projection.events.map(withoutSensitiveEvent),
    daily: projection.daily.map((summary) => Object.assign({}, summary, { exceptions: (summary.exceptions || []).slice() }))
  });
}

function normalizeFilters(filters) {
  const value = filters || {};
  return {
    from: value.from || value.date_from || null,
    to: value.to || value.date_to || value.from || value.date || null,
    date: value.date || null,
    person_id: value.person_id || null,
    employee: value.employee || null,
    role: value.role || null,
    branch: value.branch || null,
    status: value.status || null
  };
}

function previousCalendarDate(value) {
  const date = new Date(String(value) + 'T00:00:00.000Z');
  if (Number.isNaN(date.getTime())) return value;
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

class AttendanceService {
  constructor(options) {
    const opts = options || {};
    this.config = opts.config || {};
    this.clock = opts.clock || (() => new Date());
    this.provider = opts.provider || null;
    this.identityMap = opts.identityMap instanceof AttendanceIdentityMap ? opts.identityMap : new AttendanceIdentityMap(opts.people || []);
    const flags = this.config.featureFlags || {};
    this.enabled = Boolean(flags.attendanceMonitoringEnabled || flags.ATTENDANCE_MONITORING_ENABLED);
    this.timeZone = this.config.timezone || 'Asia/Manila';
    this.absencePolicy = (this.config.attendance && this.config.attendance.absencePolicy) || { enabled: false };
  }

  isEnabled() {
    return this.enabled;
  }

  requireAvailable() {
    if (!this.enabled) throw new WmitError('ATTENDANCE_DISABLED', 'Attendance monitoring is disabled by configuration.');
    if (!this.provider || typeof this.provider.readAttendanceLog !== 'function' || typeof this.provider.readActiveRoster !== 'function') {
      throw new WmitError('ATTENDANCE_SOURCE_UNAVAILABLE', 'Attendance monitoring is enabled, but no read-only attendance source is configured.');
    }
  }

  readProjection(filters) {
    this.requireAvailable();
    const value = normalizeFilters(filters);
    const from = value.from || value.date || this.currentDate();
    const to = value.to || from;
    // Include one source day before the requested range so a Time In before
    // midnight can be paired with an overnight Time Out in the requested day.
    const events = this.provider.readAttendanceLog({ from: previousCalendarDate(from), to });
    const roster = this.provider.readActiveRoster();
    const build = (resolvedEvents, resolvedRoster) => buildAttendanceProjection({
      events: resolvedEvents,
      roster: resolvedRoster,
      identityMap: this.identityMap,
      timeZone: this.provider.getTimezone ? this.provider.getTimezone() : this.timeZone,
      from,
      to,
      absencePolicy: this.absencePolicy,
      metadata: this.provider.getMetadata ? this.provider.getMetadata() : { read_only: true }
    });
    if ((events && typeof events.then === 'function') || (roster && typeof roster.then === 'function')) {
      return Promise.all([Promise.resolve(events), Promise.resolve(roster)]).then(([resolvedEvents, resolvedRoster]) => build(resolvedEvents, resolvedRoster));
    }
    return build(events, roster);
  }

  disabledResult() {
    return { enabled: false, read_only: true, message: 'Attendance monitoring is disabled. No attendance source was read.' };
  }

  unavailableResult(filters, error) {
    const source = this.provider && this.provider.getMetadata ? this.provider.getMetadata() : { source_label: 'Unknown', read_only: true };
    return {
      enabled: true,
      read_only: true,
      source_status: 'UNAVAILABLE',
      source: Object.assign({}, source, { source_status: 'UNAVAILABLE', warning: error.message }),
      warning: 'Attendance source unavailable: ' + error.message,
      date: (filters && (filters.date || filters.from)) || this.currentDate(),
      filters: filters || {},
      absence_determinable: false,
      late_determinable: false,
      counts: { present: 0, currently_working: 0, timed_out: 0, absent: null, not_observed: 0, late: null, exceptions: 0, unknown_people: 0 },
      first_time_in: null,
      last_time_out: null,
      hours_worked: null,
      breakdown: {},
      branches: {},
      exceptions: [],
      rows: [],
      events: []
    };
  }

  currentDate() {
    let timeZone = this.timeZone;
    try { if (this.provider && this.provider.getTimezone) timeZone = this.provider.getTimezone() || timeZone; } catch (error) { /* source failure is reported when data is read */ }
    return localDate(this.clock(), timeZone);
  }

  filterDaily(daily, filters) {
    return daily.filter((summary) => {
      if (filters.person_id && summary.person_id !== filters.person_id) return false;
      if (filters.employee && !summary.employee_name.toLowerCase().includes(String(filters.employee).toLowerCase())) return false;
      if (filters.role && summary.role !== filters.role) return false;
      if (filters.branch && summary.branch !== filters.branch) return false;
      if (filters.status && summary.attendance_state !== filters.status) return false;
      return true;
    });
  }

  dashboard(filters) {
    if (!this.enabled) return this.disabledResult();
    const value = normalizeFilters(filters);
    const date = value.date || this.currentDate();
    let projection;
    try { projection = this.readProjection({ from: date, to: date }); } catch (error) { return this.unavailableResult(Object.assign({}, value, { date }), error); }
    const build = (resolvedProjection) => {
    projection = resolvedProjection;
    const daily = this.filterDaily(projection.daily, value);
    const observed = daily.filter((summary) => summary.observed_event_count > 0);
    const present = observed.length;
    const currentlyWorking = daily.filter((summary) => summary.open_session).length;
    const timedOut = daily.filter((summary) => Boolean(summary.last_time_out) && !summary.open_session).length;
    const absenceDetermined = Boolean(this.absencePolicy.enabled);
    const absent = absenceDetermined ? daily.filter((summary) => summary.attendance_state === 'ABSENT').length : null;
    const lateDetermined = Boolean(this.config.attendance && this.config.attendance.latePolicy && this.config.attendance.latePolicy.enabled);
    const late = lateDetermined ? daily.filter((summary) => summary.late_state === 'LATE').length : null;
    const hours = daily.filter((summary) => summary.hours_reliable && summary.total_hours !== null).reduce((sum, summary) => sum + summary.total_hours, 0);
    const breakdown = {};
    ['STAFF', 'INTERN', 'UNKNOWN'].forEach((type) => {
      const rows = daily.filter((summary) => summary.person_type === type);
      breakdown[type] = {
        present: rows.filter((summary) => summary.observed_event_count > 0).length,
        currently_working: rows.filter((summary) => summary.open_session).length,
        timed_out: rows.filter((summary) => summary.last_time_out && !summary.open_session).length,
        absent: absenceDetermined ? rows.filter((summary) => summary.attendance_state === 'ABSENT').length : null,
        late: lateDetermined ? rows.filter((summary) => summary.late_state === 'LATE').length : null
      };
    });
    const branches = {};
    daily.forEach((summary) => {
      const branch = summary.branch || 'Unknown';
      if (!branches[branch]) branches[branch] = { present: 0, currently_working: 0, timed_out: 0, absent: absenceDetermined ? 0 : null, hours_worked: 0 };
      if (summary.observed_event_count > 0) branches[branch].present += 1;
      if (summary.open_session) branches[branch].currently_working += 1;
      if (summary.last_time_out && !summary.open_session) branches[branch].timed_out += 1;
      if (absenceDetermined && summary.attendance_state === 'ABSENT') branches[branch].absent += 1;
      if (summary.hours_reliable && summary.total_hours !== null) branches[branch].hours_worked += summary.total_hours;
    });
    const exceptionRows = projection.exceptions.filter((exception) => exception.attendance_date === date
      || exception.source_event_ids.some((id) => projection.events.some((event) => event.attendance_event_id === id && event.local_date === date)));
    return {
      enabled: true,
      read_only: true,
      source_status: projection.metadata.source_status || 'AVAILABLE',
      warning: projection.metadata.warning,
      date,
      source: projection.metadata,
      source_refresh_at: new Date().toISOString(),
      absence_determinable: absenceDetermined,
      late_determinable: lateDetermined,
      counts: {
        present,
        currently_working: currentlyWorking,
        timed_out: timedOut,
        absent,
        not_observed: daily.filter((summary) => summary.attendance_state === 'NOT_OBSERVED').length,
        late,
        exceptions: exceptionRows.length,
        unknown_people: projection.exceptions.filter((exception) => exception.exception_type === 'UNKNOWN_PERSON').length
      },
      first_time_in: observed.map((summary) => summary.first_time_in).filter(Boolean).sort()[0] || null,
      last_time_out: observed.map((summary) => summary.last_time_out).filter(Boolean).sort().slice(-1)[0] || null,
      hours_worked: Math.round(hours * 100) / 100,
      breakdown,
      branches,
      exceptions: exceptionRows.map((exception) => Object.assign({}, exception, { source_event_ids: exception.source_event_ids.slice() })),
      rows: daily.map((summary) => clone(summary))
    };
    };
    if (projection && typeof projection.then === 'function') return projection.then(build).catch((error) => this.unavailableResult(Object.assign({}, value, { date }), error));
    return build(projection);
  }

  history(filters) {
    if (!this.enabled) return this.disabledResult();
    const value = normalizeFilters(filters);
    let projection;
    try { projection = this.readProjection(value); } catch (error) { return this.unavailableResult(value, error); }
    const build = (resolvedProjection) => {
      projection = resolvedProjection;
      return {
      enabled: true,
      read_only: true,
      source: projection.metadata,
      filters: value,
      rows: this.filterDaily(projection.daily, value).map((summary) => clone(summary)),
      events: projection.events.filter((event) => (!value.person_id || event.person_id === value.person_id)
        && (!value.employee || String(event.employee_name_raw).toLowerCase().includes(String(value.employee).toLowerCase()))
        && (!value.role || event.role_raw === value.role)
        && (!value.branch || event.branch === value.branch)
        && (!value.from || event.local_date >= value.from)
        && (!value.to || event.local_date <= value.to)).map(withoutSensitiveEvent)
      };
    };
    if (projection && typeof projection.then === 'function') return projection.then(build).catch((error) => this.unavailableResult(value, error));
    return build(projection);
  }

  exceptions(filters) {
    if (!this.enabled) return this.disabledResult();
    const value = normalizeFilters(filters);
    let projection;
    try { projection = this.readProjection(value); } catch (error) { return Object.assign(this.unavailableResult(value, error), { rows: [] }); }
    const build = (resolvedProjection) => {
    projection = resolvedProjection;
    const eventMap = new Map(projection.events.map((event) => [event.attendance_event_id, event]));
    const rows = projection.exceptions.filter((exception) => {
      if (value.person_id && exception.person_id !== value.person_id) return false;
      const exceptionDates = [exception.attendance_date].concat(exception.source_event_ids.map((id) => eventMap.get(id) && eventMap.get(id).local_date)).filter(Boolean);
      if (value.from && !exceptionDates.some((date) => date >= value.from && (!value.to || date <= value.to))) return false;
      if (!value.from && value.to && !exceptionDates.some((date) => date <= value.to)) return false;
      if (value.status && exception.status !== value.status) return false;
      if (value.branch) {
        const branches = exception.source_event_ids.map((id) => eventMap.get(id)).filter(Boolean).map((event) => event.branch);
        if (!branches.includes(value.branch)) return false;
      }
      return true;
    }).map((exception) => Object.assign({}, exception, { source_event_ids: exception.source_event_ids.slice() }));
    return { enabled: true, read_only: true, source: projection.metadata, rows };
    };
    if (projection && typeof projection.then === 'function') return projection.then(build).catch((error) => Object.assign(this.unavailableResult(value, error), { rows: [] }));
    return build(projection);
  }

  restrictedEventDetail(eventId, context) {
    if (!context || context.allowRestrictedAttendance !== true) throw new WmitError('FORBIDDEN', 'Restricted attendance details require explicit authorization.');
    const projection = this.readProjection({});
    const build = (resolvedProjection) => {
      const event = resolvedProjection.events.find((candidate) => candidate.attendance_event_id === eventId);
      if (!event) throw new WmitError('NOT_FOUND', 'Attendance event was not found.');
      return clone(event);
    };
    return projection && typeof projection.then === 'function' ? projection.then(build) : build(projection);
  }
}

module.exports = { AttendanceService };
