/**
 * Controlled Sheets persistence for the fresh WMIT Workspace.
 *
 * Complex fields remain in record_json while common relationship and display
 * fields are indexed in columns. Domain entry points must call this service;
 * staff and agents must not edit the tabs directly.
 */
// Keep this list local so the service can be loaded before WmitWorkspace.gs.
// The full schema remains authoritative in WmitWorkspace.gs; these names only
// allow the public wrapper methods to be created without relying on file order.
var WMIT_SERVICE_ENTITY_TYPES = [
  'Person', 'Client', 'SubAgent', 'CommunicationActivity', 'Lead', 'Supplier', 'SupplierPackage', 'Document', 'Inquiry',
    'CommercialOption', 'TariffSource', 'TariffExtractionFact', 'TariffRateComponent', 'TariffItineraryComponent', 'Quotation', 'QuotationItem',
  'QuotationAcceptance', 'Booking', 'BookingParticipant', 'BookingItem',
  'SupplierBooking', 'SupplierBookingItem',
  'AvailabilityHold', 'TicketingRecord', 'Voucher', 'RoomingListEntry',
  'ClientPayment', 'PaymentEvidence', 'PaymentAllocation', 'CashTransaction', 'SupplierPayable', 'SupplierPayment',
  'PaymentScheduleItem', 'Amendment', 'Reconciliation', 'Departure',
  'DepartureMembership', 'DepartureReadinessIssue', 'Task'
];

var WmitSheetServices = (function () {
  var spreadsheetCache = null;
  var headerCache = {};
  var PREFIXES = {
    Person: 'PERSON', Client: 'CLIENT', SubAgent: 'SUB_AGENT', CommunicationActivity: 'COMMUNICATION', Lead: 'LEAD', Supplier: 'SUPPLIER', SupplierPackage: 'SUPPLIER_PACKAGE', Document: 'DOCUMENT', Inquiry: 'INQUIRY',
    CommercialOption: 'OPTION', TariffSource: 'TARIFF', TariffExtractionFact: 'TARIFF_FACT', TariffRateComponent: 'TARIFF_RATE', TariffItineraryComponent: 'TARIFF_ITINERARY',
    Quotation: 'QUOTATION', QuotationItem: 'QUOTATION_ITEM', QuotationAcceptance: 'QUOTATION_ACCEPTANCE', Booking: 'BOOKING',
    BookingParticipant: 'BOOKING_PARTICIPANT', BookingItem: 'BOOKING_ITEM', AvailabilityHold: 'HOLD',
    SupplierBooking: 'SUPPLIER_BOOKING', SupplierBookingItem: 'SUPPLIER_BOOKING_ITEM',
    TicketingRecord: 'TICKETING', Voucher: 'VOUCHER', RoomingListEntry: 'ROOMING_ENTRY',
    ClientPayment: 'CLIENT_PAYMENT', PaymentEvidence: 'PAYMENT_EVIDENCE', PaymentAllocation: 'PAYMENT_ALLOCATION', CashTransaction: 'CASH_TRANSACTION', SupplierPayable: 'SUPPLIER_PAYABLE',
    SupplierPayment: 'SUPPLIER_PAYMENT', PaymentScheduleItem: 'PAYMENT_SCHEDULE', Amendment: 'AMENDMENT',
    Reconciliation: 'RECONCILIATION', Departure: 'DEPARTURE', DepartureMembership: 'DEPARTURE_MEMBERSHIP',
    DepartureReadinessIssue: 'DEPARTURE_ISSUE', Task: 'TASK'
  };

  function properties_() { return PropertiesService.getScriptProperties(); }
  function spreadsheet_() {
    if (spreadsheetCache) return spreadsheetCache;
    var id = properties_().getProperty(WMIT_WORKSPACE.propertySpreadsheetId);
    if (!id) throw new Error('WMIT Workspace is not initialized. Sign in and run the workspace setup first.');
    spreadsheetCache = SpreadsheetApp.openById(id);
    return spreadsheetCache;
  }
  function sheet_(entityType) { return spreadsheet_().getSheetByName(wmitDefinition_(entityType)[1]); }
  function idField_(entityType) { return wmitDefinition_(entityType)[2]; }
  function actor_(context) { return context && context.actor || 'WORKSPACE_STAFF'; }
  function pad_(value, length) { return String(value).padStart(length, '0'); }

  function nextId_(entityType) {
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var year = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Manila', 'yyyy');
      var key = 'WMIT_COUNTER_' + entityType + '_' + year;
      var props = properties_();
      var next = Number(props.getProperty(key) || 0) + 1;
      props.setProperty(key, String(next));
      return (PREFIXES[entityType] || String(entityType).toUpperCase()) + '-' + year + '-' + pad_(next, 6);
    } finally { lock.releaseLock(); }
  }

  function headerIndex_(sheet) {
    var cacheKey = sheet.getSheetId();
    if (headerCache[cacheKey]) return headerCache[cacheKey];
    var headers = sheet.getRange(1, 1, 1, WMIT_RECORD_HEADERS.length).getValues()[0];
    var index = {};
    headers.forEach(function (header, position) { index[header] = position; });
    headerCache[cacheKey] = index;
    return index;
  }

  function indexed_(record, key) {
    return record[key] === undefined || record[key] === null ? '' : record[key];
  }

  function rowFor_(record, context) {
    var idField = idField_(context.entityType);
    return [
      record[idField], record.status || '', record.record_version || 1, record.created_at || '', record.created_by || '',
      record.updated_at || '', record.updated_by || '', indexed_(record, 'client_id'), indexed_(record, 'supplier_id'),
      indexed_(record, 'inquiry_id'), indexed_(record, 'quotation_id'), indexed_(record, 'booking_id'),
      indexed_(record, 'currency'), indexed_(record, 'amount'), indexed_(record, 'destination'), JSON.stringify(record)
    ];
  }

  function parseRow_(entityType, row, index) {
    if (!row[index.record_id]) return null;
    try { return JSON.parse(row[index.record_json] || '{}'); }
    catch (_) { throw new Error('Invalid record_json for ' + entityType + ' ' + row[index.record_id]); }
  }

  function findRow_(entityType, id) {
    var sheet = sheet_(entityType); var index = headerIndex_(sheet); var lastRow = sheet.getLastRow();
    if (lastRow < 2) return null;
    var rows = sheet.getRange(2, 1, lastRow - 1, WMIT_RECORD_HEADERS.length).getValues();
    for (var i = 0; i < rows.length; i += 1) if (String(rows[i][index.record_id]) === String(id)) return { sheet: sheet, index: index, row: rows[i], rowNumber: i + 2 };
    return null;
  }

  function audit_(actor, action, entityType, entityId, result, details) {
    var audit = spreadsheet_().getSheetByName('Audit Log');
    audit.appendRow(['AUDIT-' + Utilities.getUuid(), wmitNow_(), actor, action, entityType || '', entityId || '', result || 'SUCCESS', details || '']);
  }

  function auditFailure_(actor, action, entityType, entityId, error) {
    try {
      audit_(actor, action, entityType, entityId, 'FAILURE', JSON.stringify({ error_message: String((error && error.message) || error || '').slice(0, 300) }));
    } catch (_) { /* failure audit is best effort */ }
  }

  function auditValue_(value) {
    if (value === undefined) return null;
    var text;
    try { text = JSON.stringify(value); } catch (_) { return '[unserializable]'; }
    if (text === undefined) return null;
    return text.length > 500 ? text.slice(0, 500) + '...[truncated]' : JSON.parse(text);
  }

  function createRecord(entityType, input, context) {
    var definition = wmitDefinition_(entityType); var record = Object.assign({}, input || {}); var idField = definition[2];
    var actor = actor_(context);
    try {
      if (!record[idField]) record[idField] = nextId_(entityType);
      if (findRow_(entityType, record[idField])) throw new Error(entityType + ' ' + record[idField] + ' already exists.');
      var now = wmitNow_(); record.created_at = record.created_at || now; record.created_by = record.created_by || actor; record.updated_at = now; record.updated_by = actor; record.record_version = 1;
      sheet_(entityType).appendRow(rowFor_(record, { entityType: entityType })); audit_(actor, 'CREATE', entityType, record[idField], 'SUCCESS', '');
      return { ok: true, data: record, meta: { action: 'CREATE' } };
    } catch (error) {
      auditFailure_(actor, 'CREATE', entityType, record[idField] || (input || {})[idField] || '', error);
      throw error;
    }
  }

  function getRecord(entityType, id) { var found = findRow_(entityType, id); return found ? { ok: true, data: parseRow_(entityType, found.row, found.index), meta: {} } : { ok: false, error: { code: 'NOT_FOUND', message: entityType + ' ' + id + ' was not found.' } }; }

  function listRecords(entityType) {
    var sheet = sheet_(entityType); var index = headerIndex_(sheet); var lastRow = sheet.getLastRow(); if (lastRow < 2) return { ok: true, data: [], meta: {} };
    return { ok: true, data: sheet.getRange(2, 1, lastRow - 1, WMIT_RECORD_HEADERS.length).getValues().map(function (row) { return parseRow_(entityType, row, index); }).filter(Boolean), meta: {} };
  }

  function updateRecord(entityType, id, changes, context) {
    var actor = actor_(context);
    var found = findRow_(entityType, id);
    if (!found) { auditFailure_(actor, 'UPDATE', entityType, id, new Error('NOT_FOUND: ' + entityType + ' ' + id + ' was not found.')); return { ok: false, error: { code: 'NOT_FOUND', message: entityType + ' ' + id + ' was not found.' } }; }
    var current = parseRow_(entityType, found.row, found.index); var expected = changes && changes.expected_version;
    if (expected !== undefined && Number(expected) !== Number(current.record_version)) { auditFailure_(actor, 'UPDATE', entityType, id, new Error('VERSION_CONFLICT: expected ' + expected + ', current ' + current.record_version + '.')); return { ok: false, error: { code: 'VERSION_CONFLICT', message: 'The record changed before this update was saved.' } }; }
    var applied = Object.assign({}, changes || {}); delete applied.expected_version;
    var changedKeys = Object.keys(applied).filter(function (key) { try { return JSON.stringify(current[key]) !== JSON.stringify(applied[key]); } catch (_) { return true; } });
    var next = Object.assign({}, current, applied); next[idField_(entityType)] = id; next.record_version = Number(current.record_version || 1) + 1; next.updated_at = wmitNow_(); next.updated_by = actor;
    found.sheet.getRange(found.rowNumber, 1, 1, WMIT_RECORD_HEADERS.length).setValues([rowFor_(next, { entityType: entityType })]);
    var details = { changed_fields: changedKeys, old_values: {}, new_values: {} };
    changedKeys.forEach(function (key) { details.old_values[key] = auditValue_(current[key]); details.new_values[key] = auditValue_(next[key]); });
    audit_(actor, 'UPDATE', entityType, id, 'SUCCESS', JSON.stringify(details));
    return { ok: true, data: next, meta: { action: 'UPDATE' } };
  }

  // Compensating delete for multi-record rollback after a partial failure.
  // Never exposed as a staff operation; domain services call it only to undo
  // records created within the same failed transaction.
  function compensateCreate(entityType, id) {
    var found = findRow_(entityType, id);
    if (!found) return { ok: true, data: { compensated: false }, meta: {} };
    found.sheet.deleteRow(found.rowNumber);
    audit_(actor_(null), 'ROLLBACK_CREATE', entityType, id, 'SUCCESS', JSON.stringify({ reason: 'Multi-record transaction failed; the newly created record was removed to avoid a partial write.' }));
    return { ok: true, data: { compensated: true }, meta: { action: 'ROLLBACK_CREATE' } };
  }

  function makeEntityApi(entityType) {
    var api = {};
    api['create' + entityType] = function (input, context) { return createRecord(entityType, input, context); };
    api['get' + entityType] = function (id) { return getRecord(entityType, id); };
    api['list' + entityType] = function () { return listRecords(entityType); };
    api['update' + entityType] = function (id, changes, context) { return updateRecord(entityType, id, changes, context); };
    return api;
  }

  // Do not build this at script-load time. Apps Script can evaluate .gs files
  // in an order that leaves WMIT_ENTITY_DEFINITIONS uninitialized temporarily.
  var service = null;

  function buildService_() {
    if (typeof WMIT_ENTITY_DEFINITIONS === 'undefined' || !Array.isArray(WMIT_ENTITY_DEFINITIONS)) {
      throw new Error('WMIT workspace schema is unavailable. Add the complete WmitWorkspace.gs file, save all files, then run the workspace setup.');
    }
    var built = {
      initialize: initializeWmitWorkspace_,
      compensateCreate: compensateCreate,
      getState: function () {
        var entities = {};
        WMIT_ENTITY_DEFINITIONS.forEach(function (definition) {
          entities[definition[0]] = listRecords(definition[0]).data;
        });
        return { ok: true, data: { entities: entities }, meta: {} };
      }
    };
    WMIT_ENTITY_DEFINITIONS.forEach(function (definition) {
      built = Object.assign(built, makeEntityApi(definition[0]));
    });
    return built;
  }

  function getService_() {
    if (!service) service = buildService_();
    return service;
  }

  var api = {
    initialize: function () { return getService_().initialize.apply(null, arguments); },
    getState: function () { return getService_().getState.apply(null, arguments); }
  };

  WMIT_SERVICE_ENTITY_TYPES.forEach(function (entityType) {
    ['create', 'get', 'list', 'update'].forEach(function (action) {
      var method = action + entityType;
      api[method] = function () {
        var serviceMethod = getService_()[method];
        if (typeof serviceMethod !== 'function') throw new Error('WMIT Apps Script files are out of sync. Update WmitWorkspace.gs and WmitSheetServices.gs together, then deploy a new version. Missing service method: ' + method);
        return serviceMethod.apply(null, arguments);
      };
    });
  });

  api.compensateCreate = function () {
    var serviceMethod = getService_().compensateCreate;
    return serviceMethod.apply(null, arguments);
  };

  return api;
}());

// Private (underscore-suffixed): only the ADMIN-gated webInitializeSyntheticWorkspace
// wrapper or the editor may run this. google.script.run cannot call it directly.
function initializeWmitSyntheticWorkspace_() {
  configureWmitWorkspaceRuntime_();
  var client = WmitSheetServices.listClient().data.filter(function (item) { return item.client_id === 'CLIENT-SYNTH-000001'; })[0];
  if (!client) client = WmitSheetServices.createClient({ client_id: 'CLIENT-SYNTH-000001', display_name: 'Synthetic Workspace Client', legal_name: 'Synthetic Workspace Client' }, { actor: 'WORKSPACE_SETUP' }).data;
  var supplier = WmitSheetServices.listSupplier().data.filter(function (item) { return item.supplier_id === 'SUPPLIER-SYNTH-000001'; })[0];
  if (!supplier) supplier = WmitSheetServices.createSupplier({ supplier_id: 'SUPPLIER-SYNTH-000001', display_name: 'Synthetic Workspace Supplier', legal_name: 'Synthetic Workspace Supplier' }, { actor: 'WORKSPACE_SETUP' }).data;
  return { ok: true, data: { client_id: client.client_id, supplier_id: supplier.supplier_id }, meta: { action: 'INITIALIZE_SYNTHETIC_WORKSPACE' } };
}
