/**
 * Controlled Apps Script entry points.
 *
 * Agents and UI code call these functions, never arbitrary SpreadsheetApp
 * edits. The fresh-Workspace adapter is injected by
 * configureWmitWorkspaceRuntime_().
 */
function createClient_(input, context) {
  return WmitRuntime.requireServices().createClient(input, context);
}

function getClient_(id, context) {
  return WmitRuntime.requireServices().getClient(id, context);
}

function updateClient_(id, changes, context) {
  return WmitRuntime.requireServices().updateClient(id, changes, context);
}

function createSupplier_(input, context) {
  return WmitRuntime.requireServices().createSupplier(input, context);
}

function getSupplier_(id, context) {
  return WmitRuntime.requireServices().getSupplier(id, context);
}

function createLead_(input, context) {
  return WmitRuntime.requireServices().createLead(input, context);
}

function getLead_(id, context) {
  return WmitRuntime.requireServices().getLead(id, context);
}

function createPerson_(input, context) {
  return WmitRuntime.requireServices().createPerson(input, context);
}

function getPerson_(id, context) {
  return WmitRuntime.requireServices().getPerson(id, context);
}

function createInquiry_(input, context) {
  return WmitRuntime.requireServices().createInquiry(input, context);
}

function getInquiry_(id, context) {
  return WmitRuntime.requireServices().getInquiry(id, context);
}

function updateInquiry_(id, changes, context) {
  return WmitRuntime.requireServices().updateInquiry(id, changes, context);
}

function createQuotation_(input, context) {
  return WmitRuntime.requireServices().createQuotation(input, context);
}

function getQuotation_(id, context) {
  return WmitRuntime.requireServices().getQuotation(id, context);
}

function createBooking_(input, context) {
  return WmitRuntime.requireServices().createBooking(input, context);
}

function getBooking_(id, context) {
  return WmitRuntime.requireServices().getBooking(id, context);
}

function getWmitState_() {
  return WmitRuntime.requireServices().getState();
}

function uploadWmitSourceDocument_(input, context) {
  return WmitDriveServices.uploadSourceDocument(input, context);
}
