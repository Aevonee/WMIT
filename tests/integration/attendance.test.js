'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { AppsScriptAttendanceApiClient, canonicalRequest } = require('../../src/adapters/apps-script-attendance-api-client');
const { getDefaultConfig, loadConfig } = require('../../src/config/config');
const { GoogleSheetsAttendanceAdapter } = require('../../src/adapters/google-sheets-attendance-adapter');
const { MockAttendanceSourceAdapter } = require('../../src/attendance/mock-source-adapter');
const { AttendanceIdentityMap } = require('../../src/attendance/identity-map');
const { AttendanceService } = require('../../src/attendance/attendance-service');
const { HrPayrollOfficer } = require('../../src/agents/hr-payroll-officer');
const { DEMO_ATTENDANCE_PEOPLE, DEMO_ATTENDANCE_ROSTER, DEMO_ATTENDANCE_EVENTS } = require('../../src/attendance/demo-fixture');
const { seedDemoRuntime } = require('../../src/application/demo-data');

function demoSource() {
  return new MockAttendanceSourceAdapter({ events: DEMO_ATTENDANCE_EVENTS, roster: DEMO_ATTENDANCE_ROSTER, metadata: { source_name: 'Synthetic Attendance Log', read_only: true } });
}

function attendanceConfig(overrides) {
  return loadConfig(Object.assign({
    environment: 'test',
    featureFlags: { attendanceMonitoringEnabled: true },
    attendance: { absencePolicy: { enabled: false }, latePolicy: { enabled: false } }
  }, overrides || {}));
}

function googleConfig(overrides) {
  return loadConfig(Object.assign({
    environment: 'test',
    timezone: 'UTC',
    attendance: { apiUrl: 'https://attendance.example.test/exec', apiKeyId: 'synthetic-key' },
    featureFlags: { attendanceMonitoringEnabled: true, attendanceGoogleSourceEnabled: true }
  }, overrides || {}));
}

class FakeAttendanceApiClient {
  constructor(events, roster, metadata) { this.events = events || []; this.roster = roster || []; this.metadata = metadata || { timezone: 'Asia/Manila' }; this.calls = []; }
  getAttendanceEvents(range) { this.calls.push(['events', range]); return Object.assign({ ok: true, events: this.events }, this.metadata); }
  getRoster() { this.calls.push(['roster']); return Object.assign({ ok: true, roster: this.roster }, this.metadata); }
}

test('attendance source boundary is read-only and unconfigured Google reads fail safely', () => {
  const mock = demoSource();
  assert.equal(mock.readOnly, true);
  assert.equal(typeof mock.appendRow, 'undefined');
  assert.equal(typeof mock.updateRow, 'undefined');
  const google = new GoogleSheetsAttendanceAdapter(getDefaultConfig());
  assert.equal(google.readOnly, true);
  assert.equal(typeof google.appendRow, 'undefined');
  assert.equal(typeof google.updateRow, 'undefined');
  assert.throws(() => google.readAttendanceLog(), /not configured|deferred/i);
  const sourceDisabled = new GoogleSheetsAttendanceAdapter(loadConfig({ attendance: { apiUrl: 'https://attendance.example.test/exec' }, featureFlags: { attendanceMonitoringEnabled: false, attendanceGoogleSourceEnabled: true } }));
  assert.throws(() => sourceDisabled.readAttendanceLog(), /not configured|disabled/i);
});

test('Apps Script attendance API adapter preserves normalized fields and optional columns', () => {
  const client = new FakeAttendanceApiClient([
    { timestamp: '2026-08-12T00:00:00.000Z', employee_name: 'Bagtasos, Jhon', role: 'Operations Staff', branch: 'North Branch', action: 'Time In', source_row_reference: 2 },
    { timestamp: '2026-08-12T09:00:00.000Z', employee_name: '', role: 'Operations Staff', branch: 'North Branch', action: 'Time Out', source_row_reference: 3, source_row_errors: ['employee_name is blank'] }
  ], [{ source_row_reference: 2, employee_name: 'Jhon Bagtasos', role: '', branch: '', active: true }]);
  const adapter = new GoogleSheetsAttendanceAdapter(googleConfig(), client);
  const events = adapter.readAttendanceLog({ from: '2026-08-12', to: '2026-08-12' });
  const roster = adapter.readActiveRoster();
  assert.equal(events[0].employee_name, 'Bagtasos, Jhon');
  assert.equal(events[0].action, 'Time In');
  assert.equal(events[0].branch, 'North Branch');
  assert.equal(events[0].selfie_link, undefined);
  assert.deepEqual(roster[0], { source_row_reference: 2, employee_name: 'Jhon Bagtasos', role: '', branch: '', active: true });
  assert.deepEqual(adapter.getMetadata(), { source_name: 'Attendance Apps Script API', source_label: 'Google Apps Script', source_type: 'GOOGLE_APPS_SCRIPT_ATTENDANCE_API', source_status: 'AVAILABLE', read_only: true, timezone: 'Asia/Manila', warning: undefined });
  assert.deepEqual(client.calls.map((call) => call[0]), ['events', 'roster']);
  assert.deepEqual(events[1].source_row_errors, ['employee_name is blank']);
});

test('Apps Script API client signs server requests without placing the secret in the request body', async () => {
  let captured;
  const client = new AppsScriptAttendanceApiClient({
    url: 'https://attendance.example.test/exec', keyId: 'test-key', secret: 'test-secret',
    clock: () => new Date('2026-08-12T10:00:00.000Z'), requestId: () => 'request-1', nonce: () => 'nonce-1',
    fetchImpl: async (url, options) => { captured = { url, options, body: JSON.parse(options.body) }; return { ok: true, text: async () => JSON.stringify({ ok: true, events: [], timezone: 'Asia/Manila' }) }; }
  });
  await client.getAttendanceEvents({ from: '2026-08-12', to: '2026-08-12' });
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.body.key_id, 'test-key');
  assert.equal(captured.body.signature, require('crypto').createHmac('sha256', 'test-secret').update(canonicalRequest(captured.body)).digest('base64'));
  assert.equal(JSON.stringify(captured.body).includes('test-secret'), false);
});

test('Apps Script API client rejects oversized ranges and invalid API responses', async () => {
  const client = new AppsScriptAttendanceApiClient({ url: 'https://attendance.example.test/exec', keyId: 'test-key', secret: 'test-secret', fetchImpl: async () => ({ ok: true, text: async () => 'not-json' }) });
  assert.throws(() => client.getAttendanceEvents({ from: '2026-08-01', to: '2026-09-02' }), /cannot exceed 32 days/i);
  await assert.rejects(() => client.getAttendanceEvents({ from: '2026-08-12', to: '2026-08-12' }), /invalid JSON/i);
  const deploymentIdOnly = new AppsScriptAttendanceApiClient({ url: 'AKfycb-example', keyId: 'test-key', secret: 'test-secret', fetchImpl: async () => ({ ok: true, text: async () => '{}' }) });
  assert.throws(() => deploymentIdOnly.getAttendanceEvents({ from: '2026-08-12', to: '2026-08-12' }), /full deployed Apps Script web-app URL/i);
});

test('Google source failures produce an explicit unavailable result and configured fallback is labelled', () => {
  const failingClient = { getAttendanceEvents() { throw new Error('Synthetic authentication denied.'); }, getRoster() { throw new Error('Synthetic authentication denied.'); } };
  const unavailable = new AttendanceService({ config: googleConfig(), provider: new GoogleSheetsAttendanceAdapter(googleConfig(), failingClient), identityMap: new AttendanceIdentityMap([]), clock: () => new Date('2026-08-12T10:00:00Z') });
  const result = unavailable.dashboard({ date: '2026-08-12' });
  assert.equal(result.source_status, 'UNAVAILABLE');
  assert.match(result.warning, /authentication denied/i);
  assert.equal(result.rows.length, 0);

  const fallbackApp = seedDemoRuntime({ config: { featureFlags: { attendanceGoogleSourceEnabled: true }, attendance: { apiUrl: 'https://attendance.example.test/exec', googleFallbackToMock: true } } });
  const fallback = fallbackApp.getAttendanceDashboard({ date: '2026-08-12' });
  assert.equal(fallback.ok, true);
  assert.equal(fallback.data.source_status, 'FALLBACK');
  assert.equal(fallback.data.source.source_label, 'Demo Data');
  assert.match(fallback.data.warning, /Google Sheets attendance was unavailable/i);
});

test('API-backed attendance source uses an overnight lookback and remains service-layer controlled', async () => {
  const calls = [];
  const client = {
    async getAttendanceEvents(range) { calls.push(['events', range]); return { ok: true, timezone: 'Asia/Manila', events: DEMO_ATTENDANCE_EVENTS }; },
    async getRoster() { calls.push(['roster']); return { ok: true, timezone: 'Asia/Manila', roster: DEMO_ATTENDANCE_ROSTER }; }
  };
  const app = seedDemoRuntime({ config: { featureFlags: { attendanceGoogleSourceEnabled: true } }, attendanceApiClient: client });
  const result = await app.getAttendanceDashboard({ date: '2026-08-12' });
  assert.equal(result.ok, true);
  assert.equal(result.data.source.source_type, 'GOOGLE_APPS_SCRIPT_ATTENDANCE_API');
  assert.deepEqual(calls[0], ['events', { from: '2026-08-11', to: '2026-08-12' }]);
  assert.deepEqual(calls.map((call) => call[0]), ['events', 'roster']);
  assert.equal(JSON.stringify(result.data).toLowerCase().includes('selfie'), false);
});

test('attendance identity map resolves reordered names without rewriting source names', () => {
  const map = new AttendanceIdentityMap([{ person_id: 'PERSON-001', display_name: 'Jhon Bagtasos', attendance_name: 'Jhon Bagtasos', name_aliases: ['Bagtasos, Jhon'], person_type: 'STAFF' }]);
  const result = map.resolve('Bagtasos, Jhon');
  assert.equal(result.status, 'MATCHED');
  assert.equal(result.person_id, 'PERSON-001');
  assert.equal(result.match_type, 'ALIAS');
  assert.equal(result.canonical_name, 'Jhon Bagtasos');
});

test('attendance projection detects exceptions, calculates reliable hours, and hides selfie links', () => {
  const app = seedDemoRuntime();
  const dashboard = app.getAttendanceDashboard({ date: '2026-08-12' });
  assert.equal(dashboard.ok, true);
  assert.equal(dashboard.data.counts.present, 6);
  assert.equal(dashboard.data.counts.currently_working, 1);
  assert.equal(dashboard.data.counts.timed_out, 5);
  assert.equal(dashboard.data.counts.absent, null);
  assert.equal(dashboard.data.counts.late, null);
  assert.equal(dashboard.data.hours_worked, 16.48);
  const types = new Set(dashboard.data.exceptions.map((row) => row.exception_type));
  ['DUPLICATE_TIME_IN', 'TIME_OUT_WITHOUT_TIME_IN', 'TIME_IN_WITHOUT_TIME_OUT', 'MULTIPLE_TIME_OUTS', 'OVERNIGHT_ATTENDANCE', 'UNKNOWN_PERSON', 'NAME_MISMATCH'].forEach((type) => assert.equal(types.has(type), true, type));
  const history = app.getAttendanceHistory({ from: '2026-08-12', to: '2026-08-12' });
  assert.equal(history.ok, true);
  assert.equal(history.data.events.length, 13);
  assert.equal(JSON.stringify(history.data).includes('selfie'), false);
  assert.equal(history.data.events.some((event) => event.employee_name_raw === 'Bagtasos, Jhon'), true);
});

test('attendance dashboard supports date, branch, role, employee, and status filters', () => {
  const app = seedDemoRuntime();
  const branch = app.getAttendanceHistory({ from: '2026-08-12', to: '2026-08-12', branch: 'Makati' });
  assert.equal(branch.ok, true);
  assert.deepEqual(branch.data.rows.map((row) => row.employee_name), ['Ana Cruz']);
  const intern = app.getAttendanceHistory({ from: '2026-08-12', to: '2026-08-12', role: 'Intern' });
  assert.deepEqual(intern.data.rows.map((row) => row.employee_name), ['Sample Companion']);
  const incomplete = app.getAttendanceHistory({ from: '2026-08-12', to: '2026-08-12', status: 'INCOMPLETE' });
  assert.equal(incomplete.data.rows.some((row) => row.employee_name === 'Sample Companion'), true);
});

test('absence is only calculated when an explicit policy input enables it', () => {
  const people = [
    { person_id: 'PERSON-EXPECTED', display_name: 'Expected Person', attendance_name: 'Expected Person', person_type: 'STAFF', active: true },
    { person_id: 'PERSON-ABSENT', display_name: 'Absent Person', attendance_name: 'Absent Person', person_type: 'INTERN', active: true }
  ];
  const provider = new MockAttendanceSourceAdapter({
    roster: [{ employee_name: 'Expected Person' }, { employee_name: 'Absent Person' }],
    events: [{ source_row_reference: 2, timestamp: '2026-08-12T08:00:00+08:00', employee_name: 'Expected Person', role: 'Staff', branch: 'Main', action: 'Time In' }]
  });
  const service = new AttendanceService({
    config: attendanceConfig({ attendance: { absencePolicy: { enabled: true } } }),
    provider,
    identityMap: new AttendanceIdentityMap(people),
    clock: () => new Date('2026-08-12T10:00:00+08:00')
  });
  const result = service.dashboard({ date: '2026-08-12' });
  assert.equal(result.absence_determinable, true);
  assert.equal(result.counts.absent, 1);
  assert.equal(result.rows.find((row) => row.employee_name === 'Absent Person').attendance_state, 'ABSENT');
});

test('restricted selfie details require explicit authorization while general projections remain safe', () => {
  const app = seedDemoRuntime();
  const history = app.getAttendanceHistory({ from: '2026-08-12', to: '2026-08-12' });
  const eventId = history.data.events[0].attendance_event_id;
  assert.throws(() => app.attendanceService.restrictedEventDetail(eventId, {}), /explicit authorization/i);
  const detail = app.attendanceService.restrictedEventDetail(eventId, { allowRestrictedAttendance: true });
  assert.match(detail.selfie_link_ref, /private\.example\.test/);
});

test('attendance UI and application layer contain no direct SpreadsheetApp access', () => {
  const ui = fs.readFileSync('app/public/app.js', 'utf8');
  const application = fs.readFileSync('src/application/operations-mvp.js', 'utf8');
  assert.equal(ui.includes('SpreadsheetApp'), false);
  assert.equal(application.includes('SpreadsheetApp'), false);
});

test('drop-in Apps Script API is read-only, dynamic-header based, and excludes selfies', () => {
  const api = fs.readFileSync('attendance-reference/AttendanceApi.gs', 'utf8');
  assert.match(api, /function doPost\s*\(/);
  assert.match(api, /attendanceApiMapHeaders_/);
  assert.match(api, /attendance\.events/);
  assert.match(api, /attendance\.roster/);
  assert.match(api, /PropertiesService\.getScriptProperties/);
  assert.equal(api.includes('Selfie Link'), false);
  assert.equal(/\.\s*(appendRow|setValue|setValues|deleteRow|insertSheet)\s*\(/.test(api), false);
});

test('attendance recorder maps Branch and Action by header instead of positional row order', () => {
  const code = fs.readFileSync('attendance-reference/Code.gs', 'utf8');
  assert.match(code, /function getAttendanceLogColumnMap_\s*\(/);
  assert.match(code, /branch:\s*rosterRecord\.branch/);
  assert.match(code, /action:\s*action/);
  assert.match(code, /selfie_link:\s*fileUrl/);
  assert.equal(code.includes('logSheet.appendRow([formattedDate, name, role, action, fileUrl])'), false);
});

test('HR and Payroll Officer is a controlled read-only attendance specialist', () => {
  const app = seedDemoRuntime();
  const officer = app.hrPayrollOfficer;
  assert.equal(officer.profile().display_name, 'HR and Payroll Officer');
  assert.equal(officer.profile().read_only, true);
  assert.ok(officer.profile().unavailable_capabilities.includes('payroll_calculation'));
  const result = officer.attendanceHistory({ from: '2026-08-12', to: '2026-08-12' });
  assert.equal(result.read_only, true);
  assert.equal(result.agent.agent_id, 'HR_PAYROLL_OFFICER');
  assert.equal(JSON.stringify(result).includes('selfie_link'), false);
});
