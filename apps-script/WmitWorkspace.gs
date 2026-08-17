/**
 * WMIT fresh-Workspace bootstrap.
 *
 * This file is safe to run repeatedly. It creates or reuses one exact WMIT
 * root folder, one operational spreadsheet, the controlled record tabs, and
 * the audit/configuration tabs. It never deletes or overwrites files.
 */
var WMIT_WORKSPACE = Object.freeze({
  rootFolderName: 'WMIT',
  spreadsheetName: 'WMIT Operations',
  schemaVersion: '2.6.0-operational-workspace',
  propertySpreadsheetId: 'WMIT_SPREADSHEET_ID',
  propertyRootFolderId: 'WMIT_ROOT_FOLDER_ID'
});

var WMIT_ENTITY_DEFINITIONS = Object.freeze([
  ['Person', 'Persons', 'person_id'],
  ['Client', 'Clients', 'client_id'],
  ['SubAgent', 'Sub-agents', 'sub_agent_id'],
  ['CommunicationActivity', 'Communications', 'communication_activity_id'],
  ['Lead', 'Leads', 'lead_id'],
  ['Supplier', 'Suppliers', 'supplier_id'],
  ['SupplierPackage', 'Supplier Packages', 'supplier_package_id'],
  ['Document', 'Documents', 'document_id'],
  ['Inquiry', 'Inquiries', 'inquiry_id'],
  ['CommercialOption', 'Commercial Options', 'commercial_option_id'],
  ['TariffSource', 'Tariff Sources', 'tariff_source_id'],
  ['TariffExtractionFact', 'Tariff Extraction Facts', 'tariff_extraction_fact_id'],
  ['TariffRateComponent', 'Tariff Rates', 'tariff_rate_component_id'],
  ['TariffItineraryComponent', 'Tariff Itinerary', 'tariff_itinerary_component_id'],
  ['Quotation', 'Quotations', 'quotation_id'],
  ['QuotationItem', 'Quotation Items', 'quotation_item_id'],
  ['QuotationAcceptance', 'Quotation Acceptances', 'quotation_acceptance_id'],
  ['Booking', 'Bookings', 'booking_id'],
  ['BookingParticipant', 'Booking Participants', 'booking_participant_id'],
  ['BookingItem', 'Booking Items', 'booking_item_id'],
  ['SupplierBooking', 'Supplier Bookings', 'supplier_booking_id'],
  ['SupplierBookingItem', 'Supplier Booking Items', 'supplier_booking_item_id'],
  ['AvailabilityHold', 'Availability Holds', 'availability_hold_id'],
  ['TicketingRecord', 'Ticketing Records', 'ticketing_record_id'],
  ['Voucher', 'Vouchers', 'voucher_id'],
  ['RoomingListEntry', 'Rooming List', 'rooming_list_entry_id'],
  ['ClientPayment', 'Client Payments', 'client_payment_id'],
  ['PaymentEvidence', 'Payment Evidence', 'payment_evidence_id'],
  ['PaymentAllocation', 'Payment Allocations', 'payment_allocation_id'],
  ['CashTransaction', 'Cash Transactions', 'cash_transaction_id'],
  ['SupplierPayable', 'Supplier Payables', 'supplier_payable_id'],
  ['SupplierPayment', 'Supplier Payments', 'supplier_payment_id'],
  ['PaymentScheduleItem', 'Payment Schedule', 'payment_schedule_item_id'],
  ['Amendment', 'Amendments', 'amendment_id'],
  ['Reconciliation', 'Reconciliations', 'reconciliation_id'],
  ['Departure', 'Departures', 'departure_id'],
  ['DepartureMembership', 'Departure Memberships', 'departure_membership_id'],
  ['DepartureReadinessIssue', 'Departure Readiness', 'departure_readiness_issue_id'],
  ['Task', 'Tasks', 'task_id']
]);

var WMIT_RECORD_HEADERS = Object.freeze([
  'record_id', 'status', 'record_version', 'created_at', 'created_by',
  'updated_at', 'updated_by', 'client_id', 'supplier_id', 'inquiry_id',
  'quotation_id', 'booking_id', 'currency', 'amount', 'destination',
  'record_json'
]);

function wmitNow_() { return new Date().toISOString(); }

function wmitDefinition_(entityType) {
  for (var i = 0; i < WMIT_ENTITY_DEFINITIONS.length; i += 1) {
    if (WMIT_ENTITY_DEFINITIONS[i][0] === entityType) return WMIT_ENTITY_DEFINITIONS[i];
  }
  throw new Error('Unknown WMIT entity type: ' + entityType);
}

function wmitExactFolder_(name) {
  var folders = DriveApp.getFoldersByName(name);
  var matches = [];
  while (folders.hasNext()) matches.push(folders.next());
  if (matches.length > 1) throw new Error('Multiple exact WMIT folders exist. Select one and remove the duplicate before setup.');
  return matches.length ? matches[0] : DriveApp.createFolder(name);
}

function wmitEnsureSheet_(spreadsheet, name, headers) {
  var sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  if (sheet.getMaxRows() < 2) sheet.insertRowsAfter(sheet.getMaxRows(), 2 - sheet.getMaxRows());
  var existing = sheet.getLastColumn() ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] : [];
  if (!existing.length) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  } else if (existing.join('|') !== headers.join('|')) {
    throw new Error('Schema mismatch in sheet "' + name + '". No content was changed.');
  }
  return sheet;
}

// Private (underscore-suffixed) so google.script.run can never call it
// directly from the deployed page. Staff initialize through the signed-in
// webInitializeWorkspace wrapper; owners can also run it from the editor.
function initializeWmitWorkspace_() {
  var properties = PropertiesService.getScriptProperties();
  var ready = properties.getProperty('WMIT_WORKSPACE_READY');
  if (ready === WMIT_WORKSPACE.schemaVersion && properties.getProperty(WMIT_WORKSPACE.propertyRootFolderId) && properties.getProperty(WMIT_WORKSPACE.propertySpreadsheetId)) {
    return { ok: true, data: { root_folder_id: properties.getProperty(WMIT_WORKSPACE.propertyRootFolderId), spreadsheet_id: properties.getProperty(WMIT_WORKSPACE.propertySpreadsheetId), schema_version: WMIT_WORKSPACE.schemaVersion, entity_tabs: WMIT_ENTITY_DEFINITIONS.length }, meta: { action: 'INITIALIZE_WMIT_WORKSPACE', idempotent: true, fast_path: true } };
  }
  var rootId = properties.getProperty(WMIT_WORKSPACE.propertyRootFolderId);
  var root = rootId ? DriveApp.getFolderById(rootId) : wmitExactFolder_(WMIT_WORKSPACE.rootFolderName);
  if (!rootId) properties.setProperty(WMIT_WORKSPACE.propertyRootFolderId, root.getId());

  var spreadsheetId = properties.getProperty(WMIT_WORKSPACE.propertySpreadsheetId);
  var spreadsheet;
  if (spreadsheetId) {
    spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  } else {
    spreadsheet = SpreadsheetApp.create(WMIT_WORKSPACE.spreadsheetName);
    DriveApp.getFileById(spreadsheet.getId()).moveTo(root);
    properties.setProperty(WMIT_WORKSPACE.propertySpreadsheetId, spreadsheet.getId());
  }

  wmitEnsureSheet_(spreadsheet, 'Configuration', ['key', 'value', 'updated_at']);
  wmitEnsureSheet_(spreadsheet, 'Audit Log', ['audit_id', 'timestamp', 'actor', 'action', 'entity_type', 'entity_id', 'result', 'details']);
  WMIT_ENTITY_DEFINITIONS.forEach(function (definition) { wmitEnsureSheet_(spreadsheet, definition[1], WMIT_RECORD_HEADERS); });

  var config = spreadsheet.getSheetByName('Configuration');
  var rows = [
    ['schema_version', WMIT_WORKSPACE.schemaVersion, wmitNow_()],
    ['root_folder_id', root.getId(), wmitNow_()],
    ['spreadsheet_id', spreadsheet.getId(), wmitNow_()],
    ['environment', 'SYNTHETIC_WORKSPACE', wmitNow_()]
  ];
  var configRows = config.getLastRow() > 1 ? config.getRange(2, 1, config.getLastRow() - 1, 3).getValues() : [];
  rows.forEach(function (entry) {
    var rowIndex = -1;
    for (var i = 0; i < configRows.length; i += 1) if (String(configRows[i][0]) === entry[0]) { rowIndex = i + 2; break; }
    if (rowIndex > 0) config.getRange(rowIndex, 1, 1, 3).setValues([entry]);
    else config.appendRow(entry);
  });
  properties.setProperty('WMIT_WORKSPACE_READY', WMIT_WORKSPACE.schemaVersion);
  return { ok: true, data: { root_folder_id: root.getId(), spreadsheet_id: spreadsheet.getId(), schema_version: WMIT_WORKSPACE.schemaVersion, entity_tabs: WMIT_ENTITY_DEFINITIONS.length }, meta: { action: 'INITIALIZE_WMIT_WORKSPACE', idempotent: true } };
}

function configureWmitWorkspaceRuntime_() {
  initializeWmitWorkspace_();
  WmitRuntime.configure(WmitSheetServices);
  return { ok: true, data: { configured: true }, meta: { action: 'CONFIGURE_WMIT_WORKSPACE_RUNTIME' } };
}
