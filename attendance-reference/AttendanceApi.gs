/**
 * WMIT read-only attendance API.
 *
 * Drop this file into the existing attendance Apps Script project. It does
 * not replace doGet(), processAttendance(), getRosterNames(), or the existing
 * notification/selfie code. It adds only doPost() for server-to-server reads.
 *
 * Required Script Properties (never hard-code these values):
 * - WMIT_ATTENDANCE_API_SECRET
 * - WMIT_ATTENDANCE_API_KEY_ID
 *
 * Optional Script Properties:
 * - WMIT_ATTENDANCE_API_ENABLED       (default: true when a secret exists)
 * - WMIT_ATTENDANCE_API_MAX_DAYS      (default: 32, including one overnight lookback day)
 * - WMIT_ATTENDANCE_API_CLOCK_SKEW    (default: 300 seconds)
 */

function doPost(e) {
  var requestId = 'unassigned';
  try {
    var request = parseAttendanceApiRequest_(e);
    requestId = request.request_id || requestId;
    authenticateAttendanceApiRequest_(request);

    if (request.operation === 'attendance.events') {
      return attendanceApiJson_(readAttendanceApiEvents_(request, requestId));
    }
    if (request.operation === 'attendance.roster') {
      return attendanceApiJson_(readAttendanceApiRoster_(requestId));
    }
    return attendanceApiError_('UNKNOWN_OPERATION', 'The requested attendance operation is not supported.', requestId);
  } catch (error) {
    return attendanceApiError_(error.code || 'ATTENDANCE_API_ERROR', safeAttendanceApiMessage_(error), requestId);
  }
}

function parseAttendanceApiRequest_(event) {
  if (!event || !event.postData || !event.postData.contents) {
    throw attendanceApiException_('INVALID_REQUEST', 'A JSON request body is required.');
  }
  var request;
  try {
    request = JSON.parse(event.postData.contents);
  } catch (error) {
    throw attendanceApiException_('INVALID_REQUEST', 'The request body must contain valid JSON.');
  }
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw attendanceApiException_('INVALID_REQUEST', 'The request body must be a JSON object.');
  }
  return request;
}

function authenticateAttendanceApiRequest_(request) {
  var properties = PropertiesService.getScriptProperties();
  var secret = properties.getProperty('WMIT_ATTENDANCE_API_SECRET');
  var configuredKeyId = properties.getProperty('WMIT_ATTENDANCE_API_KEY_ID');
  var enabled = properties.getProperty('WMIT_ATTENDANCE_API_ENABLED');
  if (enabled && enabled.toLowerCase() === 'false') {
    throw attendanceApiException_('API_DISABLED', 'The attendance API is disabled.');
  }
  if (!secret || !configuredKeyId) {
    throw attendanceApiException_('API_NOT_CONFIGURED', 'The attendance API is not configured.');
  }
  if (request.key_id !== configuredKeyId) {
    throw attendanceApiException_('UNAUTHORIZED', 'Attendance API authentication failed.');
  }
  if (!request.request_id || !request.nonce || !request.issued_at || !request.signature) {
    throw attendanceApiException_('UNAUTHORIZED', 'Attendance API authentication failed.');
  }

  var issuedAt = new Date(request.issued_at);
  if (isNaN(issuedAt.getTime())) {
    throw attendanceApiException_('UNAUTHORIZED', 'Attendance API authentication failed.');
  }
  var skewSeconds = Number(properties.getProperty('WMIT_ATTENDANCE_API_CLOCK_SKEW') || 300);
  if (Math.abs(new Date().getTime() - issuedAt.getTime()) > skewSeconds * 1000) {
    throw attendanceApiException_('UNAUTHORIZED', 'Attendance API authentication failed.');
  }

  var nonceKey = 'wmit-attendance-api-nonce:' + String(request.nonce);
  var cache = CacheService.getScriptCache();
  if (cache.get(nonceKey)) {
    throw attendanceApiException_('REPLAYED_REQUEST', 'The attendance API request has already been used.');
  }
  var canonical = attendanceApiCanonical_(request);
  var expected = Utilities.base64Encode(Utilities.computeHmacSha256Signature(canonical, secret));
  if (!attendanceApiConstantTimeEquals_(String(request.signature), expected)) {
    throw attendanceApiException_('UNAUTHORIZED', 'Attendance API authentication failed.');
  }
  cache.put(nonceKey, '1', Math.min(Math.max(skewSeconds * 2, 60), 21600));
}

function attendanceApiCanonical_(request) {
  return [
    'v1',
    String(request.api_version || '1'),
    String(request.operation || ''),
    String(request.request_id || ''),
    String(request.issued_at || ''),
    String(request.nonce || ''),
    String(request.from || ''),
    String(request.to || '')
  ].join('\n');
}

function attendanceApiConstantTimeEquals_(left, right) {
  if (left.length !== right.length) return false;
  var difference = 0;
  for (var i = 0; i < left.length; i += 1) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}

function readAttendanceApiEvents_(request, requestId) {
  var range = validateAttendanceApiRange_(request);
  var spreadsheet = attendanceApiSpreadsheet_();
  var sheet = spreadsheet.getSheetByName('Attendance Log');
  if (!sheet) throw attendanceApiException_('SOURCE_UNAVAILABLE', 'The Attendance Log sheet was not found.');

  var values = sheet.getDataRange().getValues();
  var headers = attendanceApiMapHeaders_(values[0] || [], ['timestamp', 'employee_name', 'action'], 'Attendance Log');
  var timezone = spreadsheet.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'Asia/Manila';
  var events = [];
  var warnings = [];

  values.slice(1).forEach(function(row, index) {
    if (!attendanceApiNonBlankRow_(row)) return;
    var rowNumber = index + 2;
    var timestampValue = attendanceApiCell_(row, headers.timestamp);
    var timestamp = attendanceApiTimestamp_(timestampValue);
    var localDate = timestamp.date ? Utilities.formatDate(timestamp.date, timezone, 'yyyy-MM-dd') : null;
    if (!localDate || localDate < range.from || localDate > range.to) {
      if (!localDate) warnings.push({ source_row_reference: rowNumber, code: 'MALFORMED_TIMESTAMP' });
      return;
    }
    var sourceRowErrors = [];
    ['timestamp', 'employee_name', 'action'].forEach(function(field) {
      if (String(attendanceApiCell_(row, headers[field])).trim() === '') sourceRowErrors.push(field + ' is blank');
    });
    var event = {
      timestamp: timestamp.output,
      employee_name: String(attendanceApiCell_(row, headers.employee_name)).trim(),
      role: String(attendanceApiCell_(row, headers.role)).trim(),
      branch: String(attendanceApiCell_(row, headers.branch)).trim(),
      action: String(attendanceApiCell_(row, headers.action)).trim(),
      source_row_reference: rowNumber
    };
    if (sourceRowErrors.length) {
      event.source_row_errors = sourceRowErrors;
      warnings.push({ source_row_reference: rowNumber, code: 'MALFORMED_ROW', fields: sourceRowErrors });
    }
    events.push(event);
  });

  return {
    ok: true,
    api_version: '1',
    operation: 'attendance.events',
    request_id: requestId,
    from: range.from,
    to: range.to,
    timezone: timezone,
    read_only: true,
    events: events,
    warnings: warnings
  };
}

function readAttendanceApiRoster_(requestId) {
  var spreadsheet = attendanceApiSpreadsheet_();
  var sheet = spreadsheet.getSheetByName('Active Roster');
  if (!sheet) throw attendanceApiException_('SOURCE_UNAVAILABLE', 'The Active Roster sheet was not found.');
  var values = sheet.getDataRange().getValues();
  var headers = attendanceApiMapHeaders_(values[0] || [], ['employee_name'], 'Active Roster');
  var roster = [];
  values.slice(1).forEach(function(row, index) {
    if (!attendanceApiNonBlankRow_(row)) return;
    roster.push({
      employee_name: String(attendanceApiCell_(row, headers.employee_name)).trim(),
      role: String(attendanceApiCell_(row, headers.role)).trim(),
      branch: String(attendanceApiCell_(row, headers.branch)).trim(),
      active: headers.active === undefined ? true : String(attendanceApiCell_(row, headers.active)).toLowerCase() !== 'false',
      source_row_reference: index + 2
    });
  });
  return {
    ok: true,
    api_version: '1',
    operation: 'attendance.roster',
    request_id: requestId,
    timezone: spreadsheet.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'Asia/Manila',
    read_only: true,
    roster: roster,
    warnings: []
  };
}

function attendanceApiSpreadsheet_() {
  var spreadsheetId = '';
  try { spreadsheetId = typeof SPREADSHEET_ID !== 'undefined' ? SPREADSHEET_ID : ''; } catch (error) { spreadsheetId = ''; }
  spreadsheetId = spreadsheetId || PropertiesService.getScriptProperties().getProperty('WMIT_ATTENDANCE_SPREADSHEET_ID');
  if (!spreadsheetId) throw attendanceApiException_('API_NOT_CONFIGURED', 'The attendance spreadsheet is not configured.');
  return SpreadsheetApp.openById(spreadsheetId);
}

function validateAttendanceApiRange_(request) {
  var from = String(request.from || '');
  var to = String(request.to || '');
  var datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(from) || !datePattern.test(to)) throw attendanceApiException_('INVALID_RANGE', 'from and to must use YYYY-MM-DD.');
  var fromMs = Date.parse(from + 'T00:00:00Z');
  var toMs = Date.parse(to + 'T00:00:00Z');
  if (!isFinite(fromMs) || !isFinite(toMs)
      || Utilities.formatDate(new Date(fromMs), 'GMT', 'yyyy-MM-dd') !== from
      || Utilities.formatDate(new Date(toMs), 'GMT', 'yyyy-MM-dd') !== to
      || toMs < fromMs) throw attendanceApiException_('INVALID_RANGE', 'The attendance date range is invalid.');
  var maxDays = Number(PropertiesService.getScriptProperties().getProperty('WMIT_ATTENDANCE_API_MAX_DAYS') || 32);
  if (((toMs - fromMs) / 86400000) + 1 > maxDays) throw attendanceApiException_('RANGE_TOO_LARGE', 'The requested attendance date range is too large.');
  return { from: from, to: to };
}

function attendanceApiMapHeaders_(row, required, sheetName) {
  var aliases = {
    timestamp: ['timestamp', 'time stamp', 'date time', 'datetime'],
    employee_name: ['employee name', 'employee', 'name', 'staff name'],
    role: ['role', 'position', 'job role'],
    branch: ['branch', 'location', 'office'],
    action: ['action', 'attendance action', 'event'],
    active: ['active', 'is active', 'status']
  };
  var normalized = {};
  (row || []).forEach(function(value, index) { var key = attendanceApiNormalizeHeader_(value); if (key) normalized[key] = index; });
  var result = {};
  Object.keys(aliases).forEach(function(field) { aliases[field].some(function(alias) { if (normalized[alias] === undefined) return false; result[field] = normalized[alias]; return true; }); });
  var missing = required.filter(function(field) { return result[field] === undefined; });
  if (missing.length) throw attendanceApiException_('MISSING_HEADERS', 'The ' + sheetName + ' sheet is missing required headers: ' + missing.join(', ') + '.');
  return result;
}

function attendanceApiNormalizeHeader_(value) {
  return String(value === undefined || value === null ? '' : value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function attendanceApiCell_(row, index) { return index === undefined || row[index] === undefined || row[index] === null ? '' : row[index]; }
function attendanceApiNonBlankRow_(row) { return row && row.some(function(value) { return String(value === undefined || value === null ? '' : value).trim() !== ''; }); }

function attendanceApiTimestamp_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return { date: value, output: value.toISOString() };
  var raw = String(value === undefined || value === null ? '' : value).trim();
  var parsed = raw ? new Date(raw) : null;
  return parsed && !isNaN(parsed.getTime()) ? { date: parsed, output: parsed.toISOString() } : { date: null, output: raw };
}

function attendanceApiJson_(body) { return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON); }
function attendanceApiError_(code, message, requestId) { return attendanceApiJson_({ ok: false, error: { code: code, message: message, request_id: requestId || 'unassigned' } }); }
function attendanceApiException_(code, message) { var error = new Error(message); error.code = code; return error; }
function safeAttendanceApiMessage_(error) { return error && error.code ? error.message : 'The attendance API could not complete the request.'; }
