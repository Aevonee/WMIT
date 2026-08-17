'use strict';

const { ConfigurationError } = require('../core/errors');

const DEFAULT_CONFIG = Object.freeze({
  systemName: 'WMIT',
  environment: 'development',
  schemaVersion: '1.4.0-quotation-payments-itinerary',
  timezone: 'Asia/Manila',
  dateFormat: 'YYYY-MM-DD',
  dateTimeFormat: "YYYY-MM-DD'T'HH:mm:ssXXX",
  defaultCurrency: 'PHP',
  ids: Object.freeze({
    yearBased: Object.freeze([
      'LEAD', 'QUOTATION', 'BOOKING', 'PASSENGER', 'DEPARTURE',
      'QUOTATION_ITEM', 'BOOKING_TRAVELER', 'BOOKING_ITEM',
      'INVOICE', 'INVOICE_ITEM', 'PAYMENT', 'DOCUMENT',
      'SUPPLIER_TARIFF', 'SUPPLIER_BOOKING', 'SUPPLIER_BOOKING_ITEM',
      'INVOICE_BOOKING', 'DOCUMENT_LINK', 'TASK'
    ]),
    nonYearBased: Object.freeze(['CLIENT', 'CONTACT', 'SUPPLIER'])
  }),
  allowedStatuses: Object.freeze({
    Client: Object.freeze(['Active', 'Inactive']),
    Contact: Object.freeze(['Active', 'Inactive']),
    Traveler: Object.freeze(['Active', 'Inactive']),
    Lead: Object.freeze(['New', 'Contacted', 'Qualified', 'Quoted', 'Won', 'Lost', 'Closed']),
    Quotation: Object.freeze(['Draft', 'Approved', 'Sent', 'Accepted', 'Rejected', 'Expired']),
    Booking: Object.freeze(['Draft', 'Pending Confirmation', 'Confirmed', 'Cancelled', 'Completed']),
    Departure: Object.freeze(['Draft', 'Open', 'Ready', 'Departed', 'Completed', 'Cancelled']),
    Supplier: Object.freeze(['Active', 'Inactive', 'On Hold']),
    Invoice: Object.freeze(['Draft', 'Approved', 'Sent', 'Partially Paid', 'Paid', 'Overdue', 'Cancelled']),
    Payment: Object.freeze(['Pending Verification', 'Verified', 'Rejected', 'Reversed']),
    Document: Object.freeze(['Received', 'Classified', 'Needs Review', 'Matched', 'Archived']),
    SupplierTariff: Object.freeze(['Draft', 'Needs Review', 'Approved', 'Expired', 'Archived']),
    SupplierBooking: Object.freeze(['Draft', 'Requested', 'Pending Confirmation', 'Confirmed', 'Cancelled', 'Completed']),
    Task: Object.freeze(['Open', 'In Progress', 'Blocked', 'Completed', 'Cancelled'])
  }),
  approvalRisk: Object.freeze({
    low: Object.freeze(['READ', 'VALIDATE', 'DRAFT', 'CLASSIFY', 'REPORT']),
    medium: Object.freeze(['CREATE_INVOICE', 'SEND_COMMUNICATION', 'PAYMENT_REMINDER', 'MODIFY_BOOKING', 'SUPPLIER_COMMUNICATION']),
    high: Object.freeze(['REFUND', 'FINANCIAL_ADJUSTMENT', 'DELETE', 'EXTERNAL_BOOKING', 'SUPPLIER_PURCHASE', 'SENSITIVE_DOCUMENT_TRANSMISSION', 'MAJOR_FINANCIAL_COMMITMENT'])
  }),
  google: Object.freeze({
    spreadsheetId: '',
    driveRootFolderId: '',
    driveFolderIds: Object.freeze({})
  }),
  attendance: Object.freeze({
    apiUrl: '',
    apiKeyId: '',
    googleFallbackToMock: false,
    absencePolicy: Object.freeze({ enabled: false }),
    latePolicy: Object.freeze({ enabled: false })
  }),
  featureFlags: Object.freeze({
    googleWorkspaceEnabled: false,
    externalActionsEnabled: false,
    attendanceMonitoringEnabled: false,
    attendanceGoogleSourceEnabled: false,
    ATTENDANCE_MONITORING_ENABLED: false,
    ATTENDANCE_GOOGLE_SOURCE_ENABLED: false
  })
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadConfig(overrides) {
  const config = Object.assign(clone(DEFAULT_CONFIG), overrides || {});
  config.ids = Object.assign(clone(DEFAULT_CONFIG.ids), (overrides && overrides.ids) || {});
  config.google = Object.assign(clone(DEFAULT_CONFIG.google), (overrides && overrides.google) || {});
  config.attendance = Object.assign(clone(DEFAULT_CONFIG.attendance), (overrides && overrides.attendance) || {});
  config.attendance.absencePolicy = Object.assign(clone(DEFAULT_CONFIG.attendance.absencePolicy), (overrides && overrides.attendance && overrides.attendance.absencePolicy) || {});
  config.attendance.latePolicy = Object.assign(clone(DEFAULT_CONFIG.attendance.latePolicy), (overrides && overrides.attendance && overrides.attendance.latePolicy) || {});
  config.featureFlags = Object.assign(clone(DEFAULT_CONFIG.featureFlags), (overrides && overrides.featureFlags) || {});
  config.allowedStatuses = Object.assign(clone(DEFAULT_CONFIG.allowedStatuses), (overrides && overrides.allowedStatuses) || {});
  config.approvalRisk = Object.assign(clone(DEFAULT_CONFIG.approvalRisk), (overrides && overrides.approvalRisk) || {});

  const environments = ['development', 'test', 'production'];
  if (!environments.includes(config.environment)) {
    throw new ConfigurationError('Environment must be development, test, or production.', { environment: config.environment });
  }

  if (config.environment === 'production' && config.featureFlags.googleWorkspaceEnabled
      && (!config.google.spreadsheetId || !config.google.driveRootFolderId)) {
    throw new ConfigurationError('Production Google Workspace is enabled but the spreadsheet ID and Drive root folder ID are both required.');
  }

  return config;
}

function getDefaultConfig() {
  return loadConfig();
}

module.exports = { DEFAULT_CONFIG, loadConfig, getDefaultConfig };
