'use strict';

const { AttendanceIdentityMap } = require('./identity-map');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localDate(value, timeZone) {
  const date = validDate(value);
  if (!date) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function localTime(value, timeZone) {
  const date = validDate(value);
  if (!date) return null;
  return new Intl.DateTimeFormat('en-GB', { timeZone: timeZone || 'Asia/Manila', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date);
}

function hoursBetween(start, end) {
  const a = validDate(start);
  const b = validDate(end);
  if (!a || !b || b < a) return null;
  return Math.round(((b.getTime() - a.getTime()) / 3600000) * 100) / 100;
}

function dateInRange(date, from, to) {
  return date && (!from || date >= from) && (!to || date <= to);
}

function sourceFingerprint(row, index) {
  return [row.source_row_reference || '', row.timestamp || row.Timestamp || '', row.employee_name || row['Employee Name'] || '', row.branch || row.Branch || '', row.action || row.Action || '', index].join('|');
}

function rawField(row, snake, title) {
  return row[snake] !== undefined ? row[snake] : row[title];
}

function exceptionFactory() {
  let count = 0;
  return function makeException(fields) {
    count += 1;
    return Object.assign({ exception_id: 'ATTENDANCE-EXCEPTION-' + String(count).padStart(6, '0'), status: 'OPEN', created_at: new Date().toISOString() }, fields);
  };
}

function normalizeEvent(row, index, identityMap, timeZone, makeException) {
  const timestampRaw = rawField(row, 'timestamp', 'Timestamp');
  const employeeName = rawField(row, 'employee_name', 'Employee Name') || '';
  const branch = rawField(row, 'branch', 'Branch') || '';
  const role = rawField(row, 'role', 'Role') || '';
  const actionRaw = rawField(row, 'action', 'Action') || '';
  const action = String(actionRaw).trim().toLowerCase() === 'time in' ? 'Time In'
    : String(actionRaw).trim().toLowerCase() === 'time out' ? 'Time Out' : String(actionRaw).trim();
  const parsed = validDate(timestampRaw);
  const identity = identityMap.resolve(employeeName);
  const event = {
    attendance_event_id: 'ATTENDANCE-EVENT-' + String(row.source_row_reference || index + 1).padStart(6, '0'),
    source_row_reference: row.source_row_reference === undefined ? index + 1 : row.source_row_reference,
    source_fingerprint: sourceFingerprint(row, index),
    timestamp_raw: timestampRaw || '',
    timestamp_iso: parsed ? parsed.toISOString() : null,
    timestamp_local: parsed ? localTime(timestampRaw, timeZone) : null,
    local_date: parsed ? localDate(timestampRaw, timeZone) : null,
    employee_name_raw: employeeName,
    role_raw: role,
    branch,
    action,
    person_id: identity.person_id || null,
    canonical_name: identity.canonical_name || null,
    identity_status: identity.status,
    identity_match_type: identity.match_type || null,
    selfie_link_ref: rawField(row, 'selfie_link', 'Selfie Link') || null,
    source_row_errors: clone(row.source_row_errors || []),
    source_row: clone(row)
  };
  if (event.source_row_errors.length) {
    makeException({ exception_type: 'CONFLICTING_RECORDS', severity: 'REVIEW_REQUIRED', attendance_date: event.local_date, source_event_ids: [event.attendance_event_id], person_id: event.person_id, description: 'The source attendance row is malformed: ' + event.source_row_errors.join('; ') });
  }
  if (!parsed) {
    makeException({ exception_type: 'CONFLICTING_RECORDS', severity: 'REVIEW_REQUIRED', attendance_date: null, source_event_ids: [event.attendance_event_id], person_id: event.person_id, description: 'The attendance timestamp could not be read.' });
  }
  if (!['Time In', 'Time Out'].includes(action)) {
    makeException({ exception_type: 'CONFLICTING_RECORDS', severity: 'REVIEW_REQUIRED', attendance_date: event.local_date, source_event_ids: [event.attendance_event_id], person_id: event.person_id, description: 'The attendance action is not Time In or Time Out.' });
  }
  if (identity.status === 'UNKNOWN') {
    makeException({ exception_type: 'UNKNOWN_PERSON', severity: 'REVIEW_REQUIRED', attendance_date: event.local_date, source_event_ids: [event.attendance_event_id], person_id: null, description: 'The employee name does not resolve to the WMIT identity map: ' + employeeName });
  } else if (identity.status === 'AMBIGUOUS') {
    makeException({ exception_type: 'NAME_MISMATCH', severity: 'REVIEW_REQUIRED', attendance_date: event.local_date, source_event_ids: [event.attendance_event_id], person_id: null, description: 'The employee name matches more than one WMIT person: ' + employeeName });
  } else if (identity.match_type === 'ALIAS') {
    makeException({ exception_type: 'NAME_MISMATCH', severity: 'WARNING', attendance_date: event.local_date, source_event_ids: [event.attendance_event_id], person_id: event.person_id, description: 'The source name was resolved through an approved name variation: ' + employeeName + ' → ' + identity.canonical_name });
  }
  return event;
}

function buildAttendanceProjection(options) {
  const opts = options || {};
  const timeZone = opts.timeZone || 'Asia/Manila';
  const identityMap = opts.identityMap instanceof AttendanceIdentityMap ? opts.identityMap : new AttendanceIdentityMap(opts.people || []);
  const makeException = exceptionFactory();
  const exceptions = [];
  const addInitialException = (fields) => exceptions.push(makeException(fields));
  const sourceRows = opts.events || [];
  const events = sourceRows.map((row, index) => normalizeEvent(row, index, identityMap, timeZone, addInitialException));
  const groups = new Map();

  events.filter((event) => event.person_id && event.timestamp_iso && ['Time In', 'Time Out'].includes(event.action)).forEach((event) => {
    const key = event.person_id;
    const list = groups.get(key) || [];
    list.push(event);
    groups.set(key, list);
  });

  const sessionsByKey = new Map();
  const eventsByKey = new Map();
  const personExceptions = new Map();
  const recordException = (fields) => {
    const exception = makeException(fields);
    exceptions.push(exception);
    const key = exception.person_id || 'UNKNOWN';
    const list = personExceptions.get(key) || [];
    list.push(exception);
    personExceptions.set(key, list);
    return exception;
  };

  events.filter((event) => event.person_id && event.local_date).forEach((event) => {
    const key = event.person_id + '|' + event.local_date;
    const list = eventsByKey.get(key) || [];
    list.push(event);
    eventsByKey.set(key, list);
  });

  groups.forEach((personEvents, personId) => {
    personEvents.sort((a, b) => new Date(a.timestamp_iso) - new Date(b.timestamp_iso));
    const branches = Array.from(new Set(personEvents.map((event) => event.branch).filter(Boolean)));
    if (branches.length > 1) {
      recordException({ exception_type: 'CONFLICTING_RECORDS', severity: 'REVIEW_REQUIRED', attendance_date: personEvents[0].local_date, source_event_ids: personEvents.map((event) => event.attendance_event_id), person_id: personId, description: 'The person has attendance events from multiple branches on the reviewed sequence: ' + branches.join(', ') });
    }
    let pendingIn = null;
    let lastOut = null;
    personEvents.forEach((event) => {
      if (event.action === 'Time In') {
        if (pendingIn) {
          recordException({ exception_type: 'DUPLICATE_TIME_IN', severity: 'WARNING', attendance_date: event.local_date, source_event_ids: [pendingIn.attendance_event_id, event.attendance_event_id], person_id: personId, description: 'A second Time In occurred before the previous Time In was paired with a Time Out.' });
        } else {
          pendingIn = event;
        }
        return;
      }
      if (!pendingIn) {
        recordException({ exception_type: lastOut ? 'MULTIPLE_TIME_OUTS' : 'TIME_OUT_WITHOUT_TIME_IN', severity: 'REVIEW_REQUIRED', attendance_date: event.local_date, source_event_ids: [event.attendance_event_id], person_id: personId, description: lastOut ? 'Multiple Time Out events occurred without another Time In.' : 'A Time Out occurred without a preceding Time In.' });
        lastOut = event;
        return;
      }
      const overnight = pendingIn.local_date !== event.local_date;
      const session = {
        session_id: pendingIn.attendance_event_id + '|' + event.attendance_event_id,
        person_id: personId,
        attendance_date: pendingIn.local_date,
        time_in_event_id: pendingIn.attendance_event_id,
        time_out_event_id: event.attendance_event_id,
        time_in: pendingIn.timestamp_iso,
        time_out: event.timestamp_iso,
        duration_hours: hoursBetween(pendingIn.timestamp_iso, event.timestamp_iso),
        hours_reliable: !overnight,
        overnight
      };
      const key = personId + '|' + pendingIn.local_date;
      const sessions = sessionsByKey.get(key) || [];
      sessions.push(session);
      sessionsByKey.set(key, sessions);
      if (overnight) {
        recordException({ exception_type: 'OVERNIGHT_ATTENDANCE', severity: 'WARNING', attendance_date: pendingIn.local_date, source_event_ids: [pendingIn.attendance_event_id, event.attendance_event_id], person_id: personId, description: 'The Time Out occurred on the following local date; overnight policy review is required.' });
      }
      pendingIn = null;
      lastOut = event;
    });
    if (pendingIn) {
      recordException({ exception_type: 'TIME_IN_WITHOUT_TIME_OUT', severity: 'REVIEW_REQUIRED', attendance_date: pendingIn.local_date, source_event_ids: [pendingIn.attendance_event_id], person_id: personId, description: 'A Time In has no following Time Out.' });
    }
    const sequenceExceptions = personExceptions.get(personId) || [];
    if (sequenceExceptions.some((exception) => ['TIME_OUT_WITHOUT_TIME_IN', 'MULTIPLE_TIME_OUTS', 'DUPLICATE_TIME_IN'].includes(exception.exception_type))
      && sequenceExceptions.some((exception) => exception.exception_type === 'OVERNIGHT_ATTENDANCE' || exception.exception_type === 'TIME_IN_WITHOUT_TIME_OUT')) {
      recordException({ exception_type: 'CONFLICTING_RECORDS', severity: 'REVIEW_REQUIRED', attendance_date: personEvents[0].local_date, source_event_ids: personEvents.map((event) => event.attendance_event_id), person_id: personId, description: 'The event sequence contains more than one unresolved interpretation.' });
    }
  });

  const roster = opts.roster || [];
  const dateFrom = opts.from || null;
  const dateTo = opts.to || dateFrom || null;
  const summaryMap = new Map();
  function ensureSummary(person, date) {
    const key = person.person_id + '|' + date;
    if (!summaryMap.has(key)) {
      summaryMap.set(key, {
        daily_attendance_id: 'DAILY-' + person.person_id + '-' + date,
        person_id: person.person_id,
        employee_name: person.display_name,
        person_type: person.person_type || 'UNKNOWN',
        role: person.role || null,
        branch: person.default_branch || null,
        attendance_date: date,
        observed_event_count: 0,
        session_count: 0,
        first_time_in: null,
        last_time_out: null,
        total_hours: null,
        hours_reliable: true,
        open_session: false,
        attendance_state: 'NOT_OBSERVED',
        late_state: 'NOT_CALCULATED',
        exception_count: 0,
        exceptions: []
      });
    }
    return summaryMap.get(key);
  }
  events.filter((event) => event.person_id && event.local_date && dateInRange(event.local_date, dateFrom, dateTo)).forEach((event) => {
    const person = identityMap.resolve(event.employee_name_raw).person;
    if (!person) return;
    const summary = ensureSummary(person, event.local_date);
    summary.observed_event_count += 1;
    if (event.action === 'Time In' && (!summary.first_time_in || event.timestamp_iso < summary.first_time_in)) summary.first_time_in = event.timestamp_iso;
    if (event.action === 'Time Out' && (!summary.last_time_out || event.timestamp_iso > summary.last_time_out)) summary.last_time_out = event.timestamp_iso;
  });
  sessionsByKey.forEach((sessions, key) => {
    const [personId, date] = key.split('|');
    if (!dateInRange(date, dateFrom, dateTo)) return;
    const person = identityMap.resolve((events.find((event) => event.person_id === personId) || {}).employee_name_raw).person;
    if (!person) return;
    const summary = ensureSummary(person, date);
    summary.session_count += sessions.length;
    const reliableHours = sessions.filter((session) => session.hours_reliable).reduce((sum, session) => sum + (session.duration_hours || 0), 0);
    summary.total_hours = Math.round(reliableHours * 100) / 100;
    summary.hours_reliable = sessions.every((session) => session.hours_reliable);
  });
  events.filter((event) => event.person_id && event.action === 'Time In' && event.local_date && dateInRange(event.local_date, dateFrom, dateTo)).forEach((event) => {
    const person = identityMap.resolve(event.employee_name_raw).person;
    if (!person) return;
    const summary = ensureSummary(person, event.local_date);
    const hasUnpairedException = exceptions.some((exception) => exception.exception_type === 'TIME_IN_WITHOUT_TIME_OUT'
      && exception.source_event_ids.includes(event.attendance_event_id));
    if (hasUnpairedException) summary.open_session = true;
  });
  const eventMap = new Map(events.map((event) => [event.attendance_event_id, event]));
  const relevantExceptions = exceptions.concat([]);
  summaryMap.forEach((summary) => {
    summary.exceptions = relevantExceptions.filter((exception) => exception.person_id === summary.person_id
      && (exception.attendance_date === summary.attendance_date
        || exception.source_event_ids.some((eventId) => eventMap.get(eventId) && eventMap.get(eventId).local_date === summary.attendance_date))).map((exception) => exception.exception_id);
    summary.exception_count = summary.exceptions.length;
    if (summary.open_session) summary.attendance_state = 'INCOMPLETE';
    else if (summary.session_count > 0) summary.attendance_state = summary.exception_count ? 'NEEDS_REVIEW' : 'PAIRED';
    else if (summary.observed_event_count > 0) summary.attendance_state = 'NEEDS_REVIEW';
  });

  if (opts.absencePolicy && opts.absencePolicy.enabled && dateFrom) {
    const expectedNames = new Set((opts.absencePolicy.expected_names || roster.map((row) => rawField(row, 'employee_name', 'Employee Name') || row.name || '')).filter(Boolean).map((name) => identityMap.resolve(name).person_id).filter(Boolean));
    expectedNames.forEach((personId) => {
      const person = identityMap.list().find((candidate) => candidate.person_id === personId);
      if (!person) return;
      const summary = ensureSummary(person, dateFrom);
      if (!summary.observed_event_count) summary.attendance_state = 'ABSENT';
    });
  }

  return {
    metadata: clone(opts.metadata || {}),
    people: identityMap.list(),
    roster: clone(roster),
    events,
    daily: Array.from(summaryMap.values()).filter((summary) => dateInRange(summary.attendance_date, dateFrom, dateTo)),
    exceptions,
    sessions: Array.from(sessionsByKey.values()).flat().filter((session) => dateInRange(session.attendance_date, dateFrom, dateTo))
  };
}

module.exports = { buildAttendanceProjection, localDate, localTime, hoursBetween };
