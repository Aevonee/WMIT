'use strict';

const { createMvpServer } = require('../app/server');
const { AppsScriptAttendanceApiClient } = require('../src/adapters/apps-script-attendance-api-client');
const port = Number(process.env.WMIT_MVP_PORT || 3000);
const apiUrl = process.env.WMIT_ATTENDANCE_API_URL || '';
const apiKeyId = process.env.WMIT_ATTENDANCE_API_KEY_ID || '';
const apiSecret = process.env.WMIT_ATTENDANCE_API_SECRET || '';
const apiConfigured = Boolean(apiUrl || apiKeyId || apiSecret);
const expoStartAt = process.env.WMIT_PHASE1_EXPO_START_AT || '';
const expoEndAt = process.env.WMIT_PHASE1_EXPO_END_AT || '';
const expoConfigured = Boolean(expoStartAt && expoEndAt);
const phase1Config = {
  expo: {
    id: process.env.WMIT_PHASE1_EXPO_ID || 'EXPO-LOCAL',
    name: process.env.WMIT_PHASE1_EXPO_NAME || 'Local WMIT Expo Test',
    startAt: expoStartAt || null,
    endAt: expoEndAt || null,
    discountPercent: Number(process.env.WMIT_PHASE1_EXPO_DISCOUNT_PERCENT || 0)
  }
};
const options = {
  config: Object.assign({}, phase1Config, apiConfigured ? {
    attendance: { apiUrl, apiKeyId },
    featureFlags: { attendanceGoogleSourceEnabled: true }
  } : {}),
  ...(apiConfigured ? { attendanceApiClient: new AppsScriptAttendanceApiClient({ url: apiUrl, keyId: apiKeyId, secret: apiSecret }) } : {})
};
if (!expoConfigured) console.log('WMIT Expo pricing is pending local configuration. Set WMIT_PHASE1_EXPO_START_AT and WMIT_PHASE1_EXPO_END_AT to test eligibility.');
const { server } = createMvpServer(options);
server.listen(port, '127.0.0.1', () => console.log('WMIT Operations running at http://127.0.0.1:' + port));
