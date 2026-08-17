'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

test('Apps Script workspace boundary is present and remains configuration-driven', () => {
  const workspace = fs.readFileSync('apps-script/WmitWorkspace.gs', 'utf8');
  const services = fs.readFileSync('apps-script/WmitSheetServices.gs', 'utf8');
  const drive = fs.readFileSync('apps-script/WmitDriveServices.gs', 'utf8');
  const review = fs.readFileSync('apps-script/WmitReviewServices.gs', 'utf8');
  const extraction = fs.readFileSync('apps-script/WmitExtractionServices.gs', 'utf8');
  const web = fs.readFileSync('apps-script/WmitWebApp.gs', 'utf8');
  const operations = fs.readFileSync('apps-script/WmitOperationsServices.gs', 'utf8');
  const bookingServices = fs.readFileSync('apps-script/WmitBookingServices.gs', 'utf8');
  const publicServices = fs.readFileSync('apps-script/WmitPublicServices.gs', 'utf8');
  const html = fs.readFileSync('apps-script/Index.html', 'utf8');
  const publicRequest = fs.readFileSync('apps-script/PublicRequest.html', 'utf8');
  const publicQuotation = fs.readFileSync('apps-script/PublicQuotation.html', 'utf8');
  const layer = fs.readFileSync('apps-script/WmitServiceLayer.gs', 'utf8');
  assert.match(workspace, /function initializeWmitWorkspace_\(\)/);
  assert.match(workspace, /function configureWmitWorkspaceRuntime_\(\)/);
  assert.match(workspace, /Multiple exact WMIT folders exist/);
  assert.match(workspace, /propertySpreadsheetId/);
  assert.match(workspace, /WMIT_WORKSPACE_READY/);
  assert.match(workspace, /propertyRootFolderId/);
  assert.doesNotMatch(workspace, /sheet\.clearContents\(\)/);
  assert.match(services, /record_json/);
  assert.match(services, /VERSION_CONFLICT/);
  assert.match(services, /LockService\.getScriptLock/);
  assert.match(services, /spreadsheetCache/);
  assert.match(drive, /function uploadSourceDocument\(/);
  assert.match(drive, /UNLINKED_DOCUMENT_RECORD/);
  assert.match(drive, /NEEDS_REVIEW/);
  assert.match(drive, /supplierForUpload_/);
  assert.match(drive, /LAND_ARRANGEMENT/);
  assert.doesNotMatch(drive, /setTrashed\(/);
  assert.match(review, /reviewDocument/);
  assert.match(review, /trusted_for_quoting: false/);
  assert.match(extraction, /Drive\.Files\.insert/);
  assert.match(extraction, /application\/vnd\.google-apps\.document/);
  assert.match(extraction, /DRIVE_DOCUMENT/);
  assert.match(extraction, /DRIVE_SPREADSHEET/);
  assert.match(extraction, /requires_staff_review: true/);
  assert.match(extraction, /function activateTariff/);
  assert.match(extraction, /confirm_extraction/);
  assert.match(web, /function doGet\(/);
  assert.match(web, /function webUploadSourceDocument\(/);
  assert.match(web, /function webReviewSourceDocument\(/);
  assert.match(web, /function webExtractSourceDocument\(/);
  assert.match(web, /function webActivateTariff\(/);
  assert.match(web, /function webCreateSupplier\(/);
  assert.match(web, /function webGetOperationsState\(/);
  assert.match(web, /function webGetCurrentUser\(/);
  assert.match(web, /function webSaveUserRoles\(/);
  assert.match(web, /function wmitRequireRole_\(allowed, input\)/);
  assert.match(web, /function webLogin\(/);
  assert.match(web, /function initializeWmitLoginSystem_\(/);
  assert.match(web, /WMIT_SESSION_/);
  assert.match(web, /function webCreateClient\(/);
  assert.match(web, /function webCreateInquiry\(/);
  assert.match(web, /function webUpdateInquiry\(/);
  assert.match(web, /function webCreateQuotationFromInquiry\(/);
  assert.match(web, /function webRecordClientPayment\(/);
  assert.match(web, /function webAllocateClientPayment\(/);
  assert.match(web, /function webCreateCashTransaction\(/);
  assert.match(web, /function webCreateSupplierPayable\(/);
  assert.match(web, /function webRecordSupplierPayment\(/);
  assert.match(web, /function webCreateBooking\(/);
  assert.match(web, /function webCreateSupplierBooking\(/);
  assert.match(web, /function webCreateDeparture\(/);
  assert.match(web, /function webCreateBookingAmendment\(/);
  assert.match(web, /function webSubmitPublicQuoteRequest\(/);
  assert.match(web, /function webGetPublicQuotation\(/);
  assert.match(web, /view === 'request'/);
  assert.match(web, /WMIT_BUILD_VERSION/);
  assert.match(web, /WORKSPACE_STATE_LOAD_FAILED/);
  assert.match(operations, /function normalizeRequirements_\(/);
  assert.match(operations, /SALES_PATHS/);
  assert.match(operations, /PACKAGE_BOOKING_PREP/);
  assert.match(operations, /function createQuotationFromInquiry\(/);
  assert.match(operations, /payment_state: 'PENDING_VERIFICATION'/);
  assert.match(operations, /function createCashTransaction\(/);
  assert.match(operations, /Approximate month\/year requires trip duration in days/);
  assert.match(operations, /function createSubAgent\(/);
  assert.match(html, /google\.script\.run/);
  assert.match(html, /Upload for Review/);
  assert.match(html, /Upload successful/);
  assert.match(html, /Review tariff/);
  assert.match(html, /Select supplier/);
  assert.match(html, /Save and select supplier/);
  assert.match(html, /Ready-made wholesaler package/);
  assert.match(html, /DMC land arrangement/);
  assert.match(html, /Extraction summary/);
  assert.match(html, /Activate tariff for quoting/);
  assert.match(html, /Daily priorities/);
  assert.match(html, /Add client/);
  assert.match(html, /Create Inquiry/);
  assert.match(html, /Next work path/);
  assert.match(html, /Wholesaler package/);
  assert.match(html, /Package booking queue/);
  assert.match(html, /data-open-package-inquiry/);
  assert.match(html, /data-open-inquiry/);
  assert.match(html, /save-inquiry-edit/);
  assert.match(html, /create-quotation-from-inquiry/);
  assert.match(html, /webCreateQuotationFromInquiry/);
  assert.match(html, /quotationItineraryMarkup/);
  assert.match(html, /\+ Add day/);
  assert.match(html, /Hotel \/ overnight/);
  assert.match(html, /Original client request/);
  assert.match(html, /Follow-up \/ deadline/);
  assert.match(html, /Record client payment/);
  assert.match(html, /Record finance transaction/);
  assert.match(html, /Add sub-agent \/ partner/);
  assert.match(html, /workspace-tabs/);
  assert.match(html, /toast-region/);
  assert.match(html, /function notify\(/);
  assert.match(html, /for="op-inquiry-adults">Adults/);
  assert.match(html, /for="op-inquiry-seniors">Seniors/);
  assert.match(html, /for="op-inquiry-children">Children/);
  assert.match(html, /for="op-inquiry-infants">Infants/);
  assert.match(html, /role-config-card/);
  assert.match(html, /data-workspace-tab/);
  assert.match(html, /Source Documents/);
  assert.match(html, /activateWorkspaceTab/);
  assert.match(html, /Bookings/);
  assert.match(html, /Lead passenger/);
  assert.match(html, /Supplier Booking/);
  assert.match(html, /Create departure/);
  assert.match(html, /Client amendment/);
  assert.match(html, /Booking readiness issue/);
  assert.match(html, /Pipeline/);
  assert.match(html, /Agency action center/);
  assert.match(html, /Create public link/);
  assert.match(html, /build-chip/);
  assert.match(html, /Workspace data could not load/);
  assert.match(publicRequest, /Request a Custom Quote/);
  assert.match(publicRequest, /webSubmitPublicQuoteRequest/);
  assert.match(publicQuotation, /webGetPublicQuotation/);
  assert.doesNotMatch(publicQuotation, /supplier_cost|internal_notes|internal[ _-]+margin/);
  assert.match(html, /reviewed the extraction summary/);
  assert.doesNotMatch(html, /Operational workflow/);
  assert.match(layer, /function createInquiry_\(/);
  assert.match(layer, /function createBooking_\(/);
  assert.match(bookingServices, /function createBooking\(/);
  assert.match(bookingServices, /Only an approved quotation can create a Booking/);
  assert.match(bookingServices, /lead passenger/);
  assert.match(bookingServices, /PENDING_CLIENT_ACCEPTANCE/);
  assert.match(publicServices, /function request\(/);
  assert.match(publicServices, /public_quote_token_hash/);
  assert.doesNotMatch(workspace + services + drive + review + extraction + web + operations + bookingServices + publicServices + html + publicRequest + publicQuotation, /1[a-zA-Z0-9_-]{20,}/);
});

test('Apps Script workspace files evaluate without requiring Google services at load time', () => {
  const context = {};
  vm.createContext(context);
  // Apps Script projects should remain safe if the editor evaluates the
  // service file before the workspace schema file.
  ['apps-script/WmitSheetServices.gs', 'apps-script/WmitWorkspace.gs', 'apps-script/WmitRuntime.gs', 'apps-script/WmitDriveServices.gs', 'apps-script/WmitReviewServices.gs', 'apps-script/WmitExtractionServices.gs', 'apps-script/WmitOperationsServices.gs', 'apps-script/WmitBookingServices.gs', 'apps-script/WmitPublicServices.gs', 'apps-script/WmitWebApp.gs', 'apps-script/WmitServiceLayer.gs']
    .forEach((file) => vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file }));
  assert.equal(typeof context.initializeWmitWorkspace_, 'function');
  assert.equal(typeof context.configureWmitWorkspaceRuntime_, 'function');
  assert.equal(typeof context.initializeWmitSyntheticWorkspace_, 'function');
  assert.equal(typeof context.WmitSheetServices.createClient, 'function');
  assert.equal(typeof context.createInquiry_, 'function');
  assert.equal(typeof context.createBooking_, 'function');
  assert.equal(typeof context.uploadSourceDocument_, 'function');
  assert.equal(typeof context.WmitBookingServices.createBooking, 'function');
});

test('Apps Script operational services require acceptance and a lead passenger, then create supplier-safe booking records', () => {
  const records = {
    Quotation: [{ quotation_id: 'QUOTATION-1', status: 'APPROVED', client_id: 'CLIENT-1', currency: 'PHP', client_total: '12000.00', supplier_cost_total: '9000.00', destination: 'Bangkok', inquiry_id: 'INQUIRY-1' }],
    QuotationAcceptance: [{ quotation_id: 'QUOTATION-1', state: 'ACCEPTED' }],
    Person: [{ person_id: 'PERSON-1', display_name: 'Lead Pax' }],
    Booking: [], BookingParticipant: [], BookingItem: [], QuotationItem: []
  };
  const context = { wmitNow_: () => '2026-08-14T00:00:00.000Z', Utilities: { formatDate: () => '2026-08-14' }, Session: { getScriptTimeZone: () => 'Asia/Manila' }, WmitSheetServices: {} };
  Object.keys(records).forEach((type) => {
    context.WmitSheetServices['list' + type] = () => ({ ok: true, data: records[type] });
    context.WmitSheetServices['create' + type] = (input) => { const idField = { Booking: 'booking_id', BookingParticipant: 'booking_participant_id', BookingItem: 'booking_item_id', QuotationAcceptance: 'quotation_acceptance_id' }[type] || type.toLowerCase() + '_id'; const record = Object.assign({}, input, { [idField]: type.toUpperCase() + '-NEW' }); records[type].push(record); return { ok: true, data: record, meta: {} }; };
    context.WmitSheetServices['update' + type] = (_id, changes) => ({ ok: true, data: changes, meta: {} });
  });
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('apps-script/WmitBookingServices.gs', 'utf8'), context, { filename: 'apps-script/WmitBookingServices.gs' });
  const missingLead = context.WmitBookingServices.createBooking({ quotation_id: 'QUOTATION-1' }, { actor: 'TEST_STAFF' });
  assert.equal(missingLead.ok, false);
  assert.match(missingLead.error.message, /lead_pax_person_id/);
  const created = context.WmitBookingServices.createBooking({ quotation_id: 'QUOTATION-1', lead_pax_person_id: 'PERSON-1' }, { actor: 'TEST_STAFF' });
  assert.equal(created.ok, true);
  assert.equal(records.BookingParticipant[0].role, 'LEAD_PAX');
  assert.equal(records.Booking[0].commitment_state, 'PENDING');
  const duplicate = context.WmitBookingServices.createBooking({ quotation_id: 'QUOTATION-1', lead_pax_person_id: 'PERSON-1' }, { actor: 'TEST_STAFF' });
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.meta.idempotent, true);
});

test('Apps Script public custom quote request preserves raw input while using structured inquiry validation', () => {
  const records = { Client: [], Inquiry: [], Task: [] };
  const context = {
    wmitNow_: () => '2026-08-15T00:00:00.000Z',
    initializeWmitWorkspace_: () => {},
    WmitSheetServices: {}
  };
  Object.keys(records).forEach((type) => {
    const idField = { Client: 'client_id', Inquiry: 'inquiry_id', Task: 'task_id' }[type];
    context.WmitSheetServices['list' + type] = () => ({ ok: true, data: records[type] });
    context.WmitSheetServices['get' + type] = (id) => { const record = records[type].find((row) => row[idField] === id); return record ? { ok: true, data: record } : { ok: false, error: { message: 'Not found' } }; };
    context.WmitSheetServices['create' + type] = (input) => { const record = Object.assign({}, input, { [idField]: type.toUpperCase() + '-' + (records[type].length + 1) }); records[type].push(record); return { ok: true, data: record, meta: {} }; };
  });
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('apps-script/WmitOperationsServices.gs', 'utf8'), context, { filename: 'apps-script/WmitOperationsServices.gs' });
  vm.runInContext(fs.readFileSync('apps-script/WmitPublicServices.gs', 'utf8'), context, { filename: 'apps-script/WmitPublicServices.gs' });
  const missingDuration = context.WmitPublicServices.request({ name: 'A Client', email: 'client@example.com', destination: 'Bangkok', travel_month: '2026-11', adults: 2 });
  assert.equal(missingDuration.ok, false);
  assert.match(missingDuration.error.message, /duration/i);
  const raw = { name: 'A Client', email: 'client@example.com', destination: 'Bangkok', travel_month: '2026-11', duration_days: 5, adults: 1, seniors: 1, children: 1, infants: 0, child_ages: [7], notes: 'Please call after 6 PM' };
  const created = context.WmitPublicServices.request(Object.assign({}, raw, { idempotency_key: 'PUBLIC-REQUEST-1' }));
  assert.equal(created.ok, true);
  assert.equal(records.Inquiry[0].original_request.name, 'A Client');
  assert.equal(records.Inquiry[0].current_requirements.pax_count, 3);
  assert.equal(records.Inquiry[0].current_requirements.seniors, 1);
  assert.equal(records.Inquiry[0].sales_path, 'CUSTOM_QUOTE');
  assert.equal(records.Inquiry[0].next_action, 'QUOTATION_REQUIRED');
  const retry = context.WmitPublicServices.request(Object.assign({}, raw, { idempotency_key: 'PUBLIC-REQUEST-1' }));
  assert.equal(retry.ok, true);
  assert.equal(retry.meta.idempotent, true);
  assert.equal(records.Inquiry.length, 1);
});

test('Apps Script WMIT login bootstrap creates expiring role sessions without Google identities', () => {
  const properties = new Map();
  const cache = new Map();
  const logged = [];
  const context = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => properties.get(key) || null, setProperty: (key, value) => properties.set(key, value) }) },
    CacheService: { getScriptCache: () => ({ get: (key) => cache.get(key) || null, put: (key, value) => cache.set(key, value), remove: (key) => cache.delete(key) }) },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, getUuid: () => 'uuid-' + Math.random().toString(36).slice(2), computeDigest: (_algorithm, value) => { const buffer = Buffer.isBuffer(value) || Array.isArray(value) ? Buffer.from(value) : Buffer.from(String(value), 'utf8'); return Array.from(crypto.createHash('sha256').update(buffer).digest()); }, base64Encode: (value) => Buffer.from(value).toString('base64') },
    Logger: { log: (message) => logged.push(String(message)) },
    wmitNow_: () => '2026-08-14T00:00:00.000Z'
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('apps-script/WmitWebApp.gs', 'utf8'), context, { filename: 'apps-script/WmitWebApp.gs' });
  const initialized = context.initializeWmitLoginSystem_();
  assert.equal(initialized.ok, true);
  const password = initialized.data.temporary_password;
  // The temporary password is returned to the initializing owner but never written to execution logs.
  assert.ok(logged.every((entry) => !entry.includes(password)));
  assert.ok(password.length >= 10);
  const accounts = JSON.parse(properties.get('WMIT_LOGIN_ACCOUNTS_JSON'));
  assert.equal(accounts[0].iterations >= 1000, true);
  const login = context.webLogin({ username: 'admin', password });
  assert.equal(login.ok, true);
  assert.throws(() => context.webLogin({ username: 'admin', password: password + 'x' }), /Invalid WMIT username or password/);
  const user = context.webGetCurrentUser({ _wmit_session_token: login.data.session_token });
  assert.equal(user.data.role, 'ADMIN');
  const staff = context.webCreateLoginAccount({ _wmit_session_token: login.data.session_token, username: 'staff1', password: 'long-test-password', role: 'STAFF' });
  assert.equal(staff.ok, true);
  const staffLogin = context.webLogin({ username: 'staff1', password: 'long-test-password' });
  assert.equal(context.webGetCurrentUser({ _wmit_session_token: staffLogin.data.session_token }).data.role, 'STAFF');
  assert.throws(() => context.webGetCurrentUser({ _wmit_session_token: 'expired' }), /expired|sign in/i);
});

test('Apps Script source review confirms interpretation without making a tariff quotable', () => {
  const calls = [];
  const context = {
    wmitNow_: () => '2026-08-14T00:00:00.000Z',
    WmitSheetServices: {
      getDocument: () => ({ ok: true, data: { document_id: 'DOCUMENT-2026-000001', source_type: 'TARIFF', source_name: 'Synthetic Supplier', supplier_id: 'SUPPLIER-2026-000001' } }),
      getSupplier: () => ({ ok: true, data: { supplier_id: 'SUPPLIER-2026-000001', display_name: 'Synthetic Supplier' } }),
      updateDocument: (id, changes, actor) => { calls.push({ id, changes, actor }); return { ok: true, data: Object.assign({ document_id: id }, changes), meta: {} }; }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('apps-script/WmitReviewServices.gs', 'utf8'), context, { filename: 'apps-script/WmitReviewServices.gs' });
  const result = context.WmitReviewServices.reviewDocument({
    document_id: 'DOCUMENT-2026-000001', supplier_id: 'SUPPLIER-2026-000001', currency: 'USD',
    rate_unit: 'PER_PERSON', interpretation_notes: 'Supplier table heading confirms USD per person.'
  }, { actor: 'TEST_STAFF' });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].changes.review_status, 'CONFIRMED');
  assert.equal(calls[0].changes.interpretation_status, 'CONFIRMED');
  assert.equal(calls[0].changes.extraction_status, 'NOT_STARTED');
  assert.equal(calls[0].changes.trusted_for_quoting, false);
  assert.equal(calls[0].changes.interpretation.rate_unit, 'PER_PERSON');
});

test('Apps Script operations layer enforces duration, composition, and sub-agent roles', () => {
  const created = [];
  const context = {
    wmitNow_: () => '2026-08-14T00:00:00.000Z',
    WmitSheetServices: {
      getClient: () => ({ ok: true, data: { client_id: 'CLIENT-2026-000001', display_name: 'Test Client' } }),
      createInquiry: (input) => { created.push(input); return { ok: true, data: input, meta: {} }; },
      listClient: () => ({ ok: true, data: [] }),
      listSubAgent: () => ({ ok: true, data: [] }),
      createSubAgent: (input) => ({ ok: true, data: input, meta: {} })
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('apps-script/WmitOperationsServices.gs', 'utf8'), context, { filename: 'apps-script/WmitOperationsServices.gs' });
  const missingDuration = context.WmitOperationsServices.createInquiry({ client_id: 'CLIENT-2026-000001', requirements: { destination: 'Bangkok', travel_month: '2026-11', adults: 2 } }, { actor: 'TEST_STAFF' });
  assert.equal(missingDuration.ok, false);
  assert.equal(missingDuration.error.code, 'INQUIRY_INVALID');
  const inquiry = context.WmitOperationsServices.createInquiry({ client_id: 'CLIENT-2026-000001', requirements: { destination: 'Bangkok', travel_start: '2026-11-01', travel_end: '2026-11-05', adults: 2 } }, { actor: 'TEST_STAFF' });
  assert.equal(inquiry.ok, true);
  assert.equal(created[0].current_requirements.nights, 4);
  const packageInquiry = context.WmitOperationsServices.createInquiry({ client_id: 'CLIENT-2026-000001', sales_path: 'WHOLESALER_PACKAGE', requirements: { destination: 'Bangkok', travel_start: '2026-11-01', travel_end: '2026-11-05', package_reference: 'Bangkok 4D3N' , adults: 2 } }, { actor: 'TEST_STAFF' });
  assert.equal(packageInquiry.ok, true);
  assert.equal(created[1].sales_path, 'WHOLESALER_PACKAGE');
  assert.equal(created[1].next_action, 'PACKAGE_BOOKING_PREP');
  const noRole = context.WmitOperationsServices.createSubAgent({ display_name: 'Roleless Partner' }, { actor: 'TEST_STAFF' });
  assert.equal(noRole.ok, false);
  assert.equal(noRole.error.code, 'SUB_AGENT_INVALID');
});

test('Apps Script creates one draft quotation from an Inquiry and carries its context', () => {
  const created = [];
  const quotations = [];
  const context = {
    wmitNow_: () => '2026-08-15T00:00:00.000Z',
    WmitSheetServices: {
      getInquiry: () => ({ ok: true, data: { inquiry_id: 'INQUIRY-1', client_id: 'CLIENT-1', sales_path: 'CUSTOM_QUOTE', current_requirements: { destination: 'Bangkok', travel_start: '2026-11-01', travel_end: '2026-11-05', duration_days: 5, nights: 4, adults: 2, seniors: 1, children: 1, infants: 0, pax_count: 4, package_reference: null } } }),
      listQuotation: () => ({ ok: true, data: quotations }),
      createQuotation: (input) => { const record = Object.assign({}, input, { quotation_id: 'QUOTATION-1' }); quotations.push(record); created.push(record); return { ok: true, data: record, meta: {} }; }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('apps-script/WmitOperationsServices.gs', 'utf8'), context, { filename: 'apps-script/WmitOperationsServices.gs' });
  const result = context.WmitOperationsServices.createQuotationFromInquiry({ inquiry_id: 'INQUIRY-1', currency: 'PHP' }, { actor: 'TEST_STAFF' });
  assert.equal(result.ok, true);
  assert.equal(created[0].client_id, 'CLIENT-1');
  assert.equal(created[0].inquiry_id, 'INQUIRY-1');
  assert.equal(created[0].destination, 'Bangkok');
  assert.equal(created[0].pax_count, 4);
  assert.equal(created[0].traveler_composition.seniors, 1);
  assert.equal(created[0].requirements_snapshot.nights, 4);
  assert.equal(created[0].status, 'DRAFT');
  const retry = context.WmitOperationsServices.createQuotationFromInquiry({ inquiry_id: 'INQUIRY-1', currency: 'PHP' }, { actor: 'TEST_STAFF' });
  assert.equal(retry.ok, true);
  assert.equal(retry.meta.reused, true);
  assert.equal(quotations.length, 1);
});

test('Apps Script finance summary separates currencies and distinguishes cash, receivables, payables, and profit', () => {
  const records = {
    ClientPayment: [
      { client_payment_id: 'PAY-1', booking_id: 'BOOK-1', amount: '400.00', currency: 'PHP', payment_state: 'VERIFIED' },
      { client_payment_id: 'PAY-2', booking_id: 'BOOK-1', amount: '100.00', currency: 'PHP', payment_state: 'PENDING_VERIFICATION' }
    ],
    PaymentAllocation: [],
    PaymentScheduleItem: [],
    Task: [],
    CashTransaction: [],
    Booking: [
      { booking_id: 'BOOK-1', current_price: '1000.00', current_supplier_cost: '600.00', currency: 'PHP' },
      { booking_id: 'BOOK-2', current_price: '500.00', current_supplier_cost: '200.00', currency: 'USD' }
    ],
    Quotation: [],
    BookingItem: [],
    SupplierPayable: [{ supplier_payable_id: 'SP-1', booking_id: 'BOOK-1', amount: '300.00', currency: 'PHP', state: 'APPROVED' }],
    SupplierPayment: [{ supplier_payment_id: 'SUP-PAY-1', booking_id: 'BOOK-1', amount: '100.00', currency: 'PHP', state: 'EXECUTED' }]
  };
  const context = {
    wmitNow_: () => '2026-08-14T00:00:00.000Z',
    initializeWmitWorkspace_: () => {},
    WmitSheetServices: {
      getState: () => ({ ok: true, data: { entities: {} }, meta: {} })
    }
  };
  Object.keys(records).forEach((type) => { context.WmitSheetServices['list' + type] = () => ({ ok: true, data: records[type] }); });
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('apps-script/WmitOperationsServices.gs', 'utf8'), context, { filename: 'apps-script/WmitOperationsServices.gs' });
  const result = context.WmitOperationsServices.getOperationsState();
  const totals = result.data.finance.financial_totals_by_currency;
  assert.equal(totals.PHP.client_verified, 400);
  assert.equal(totals.PHP.booked_revenue, 1000);
  assert.equal(totals.PHP.client_receivables, 600);
  assert.equal(totals.PHP.supplier_payables_outstanding, 200);
  assert.equal(totals.PHP.gross_profit, 400);
  assert.equal(totals.PHP.net_profit_estimate, 400);
  assert.equal(totals.PHP.estimated_cash_position, 300);
  assert.equal(totals.USD.client_receivables, 500);
  assert.equal(totals.USD.gross_profit, 300);
  assert.equal(result.data.finance.bookings_with_balance, 2);
  assert.match(result.data.finance.finance_basis, /Opening balance/);
});

test('Apps Script cash ledger validates currencies and retries without cash accounts', () => {
  const transactions = [];
  const context = {
    wmitNow_: () => '2026-08-14T00:00:00.000Z',
    WmitSheetServices: {
      listCashTransaction: () => ({ ok: true, data: transactions }),
      createCashTransaction: (input) => { transactions.push(input); return { ok: true, data: input, meta: {} }; }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('apps-script/WmitOperationsServices.gs', 'utf8'), context, { filename: 'apps-script/WmitOperationsServices.gs' });
  const invalidCurrency = context.WmitOperationsServices.createCashTransaction({ transaction_type: 'EXPENSE', amount: 100, currency: 'US', transaction_date: '2026-08-14', description: 'Expense', idempotency_key: 'LEDGER-1' }, { actor: 'TEST_STAFF' });
  assert.equal(invalidCurrency.ok, false);
  assert.equal(invalidCurrency.error.code, 'CASH_TRANSACTION_INVALID');
  const recorded = context.WmitOperationsServices.createCashTransaction({ transaction_type: 'EXPENSE', amount: 100, currency: 'PHP', transaction_date: '2026-08-14', description: 'Office supplies', idempotency_key: 'LEDGER-1' }, { actor: 'TEST_STAFF' });
  assert.equal(recorded.ok, true);
  const retry = context.WmitOperationsServices.createCashTransaction({ transaction_type: 'EXPENSE', amount: 100, currency: 'PHP', transaction_date: '2026-08-14', description: 'Office supplies', idempotency_key: 'LEDGER-1' }, { actor: 'TEST_STAFF' });
  assert.equal(retry.ok, true);
  assert.equal(retry.meta.idempotent, true);
  assert.equal(transactions.length, 1);
});

test('Apps Script finance workflow allocates client funds and controls supplier payments', () => {
  const allocations = [];
  const payables = [];
  const supplierPayments = [];
  const context = {
    wmitNow_: () => '2026-08-14T00:00:00.000Z',
    WmitSheetServices: {
      listPaymentAllocation: () => ({ ok: true, data: allocations }),
      listClientPayment: () => ({ ok: true, data: [{ client_payment_id: 'PAY-1', booking_id: 'BOOK-1', client_id: 'CLIENT-1', amount: '100.00', currency: 'PHP', payment_state: 'VERIFIED' }] }),
      listSupplierPayable: () => ({ ok: true, data: payables }),
      listSupplierPayment: () => ({ ok: true, data: supplierPayments }),
      getClientPayment: (id) => id === 'PAY-1' ? ({ ok: true, data: { client_payment_id: id, booking_id: 'BOOK-1', client_id: 'CLIENT-1', amount: '100.00', currency: 'PHP', payment_state: 'VERIFIED' } }) : ({ ok: false, error: { message: 'Payment not found.' } }),
      getPaymentScheduleItem: (id) => id === 'SCHED-1' ? ({ ok: true, data: { payment_schedule_item_id: id, booking_id: 'BOOK-1', amount: '80.00', currency: 'PHP', state: 'DUE' } }) : ({ ok: false, error: { message: 'Schedule not found.' } }),
      createPaymentAllocation: (input) => { allocations.push(input); return { ok: true, data: input, meta: {} }; },
      updatePaymentScheduleItem: (id, changes) => ({ ok: true, data: Object.assign({ payment_schedule_item_id: id }, changes), meta: {} }),
      getBooking: (id) => id === 'BOOK-1' ? ({ ok: true, data: { booking_id: id, currency: 'PHP' } }) : ({ ok: false, error: { message: 'Booking not found.' } }),
      getSupplier: (id) => id === 'SUP-1' ? ({ ok: true, data: { supplier_id: id, display_name: 'Supplier' } }) : ({ ok: false, error: { message: 'Supplier not found.' } }),
      createSupplierPayable: (input) => { payables.push(input); return { ok: true, data: input, meta: {} }; },
      getSupplierPayable: (id) => { const item = payables.find((row) => row.supplier_payable_id === id); return item ? { ok: true, data: item } : { ok: false, error: { message: 'Payable not found.' } }; },
      updateSupplierPayable: (id, changes) => { const item = payables.find((row) => row.supplier_payable_id === id); Object.assign(item, changes); return { ok: true, data: item, meta: {} }; },
      createSupplierPayment: (input) => { supplierPayments.push(input); return { ok: true, data: input, meta: {} }; }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('apps-script/WmitOperationsServices.gs', 'utf8'), context, { filename: 'apps-script/WmitOperationsServices.gs' });
  const allocation = context.WmitOperationsServices.createPaymentAllocation({ client_payment_id: 'PAY-1', payment_schedule_item_id: 'SCHED-1', amount: 50, idempotency_key: 'ALLOC-1' }, { actor: 'TEST_STAFF' });
  assert.equal(allocation.ok, true);
  const overAllocation = context.WmitOperationsServices.createPaymentAllocation({ client_payment_id: 'PAY-1', payment_schedule_item_id: 'SCHED-1', amount: 40, idempotency_key: 'ALLOC-2' }, { actor: 'TEST_STAFF' });
  assert.equal(overAllocation.ok, false);
  const payable = context.WmitOperationsServices.createSupplierPayable({ booking_id: 'BOOK-1', supplier_id: 'SUP-1', amount: 50, currency: 'PHP', description: 'Ground services', idempotency_key: 'PAYABLE-1' }, { actor: 'TEST_STAFF' });
  assert.equal(payable.ok, true);
  const payableId = payable.data.supplier_payable_id || 'SUPPLIER_PAYABLE-1';
  payables[0].supplier_payable_id = payableId;
  const approved = context.WmitOperationsServices.approveSupplierPayable({ supplier_payable_id: payableId }, { actor: 'TEST_STAFF' });
  assert.equal(approved.ok, true);
  const supplierPayment = context.WmitOperationsServices.recordSupplierPayment({ supplier_payable_id: payableId, amount: 50, currency: 'PHP', payment_date: '2026-08-14', payment_reference: 'TRANSFER-1', idempotency_key: 'SUP-PAY-1' }, { actor: 'TEST_STAFF' });
  assert.equal(supplierPayment.ok, true);
  assert.equal(payables[0].state, 'PAID');
});

test('Apps Script exposes only the web boundary to google.script.run', () => {
  // Apps Script hides underscore-suffixed globals from client calls. Every
  // other top-level function in the project must therefore be doGet or an
  // authenticated web* wrapper; anything else is an unauthenticated endpoint.
  const files = fs.readdirSync('apps-script').filter((file) => file.endsWith('.gs'));
  const offenders = [];
  for (const file of files) {
    const source = fs.readFileSync('apps-script/' + file, 'utf8');
    const declarations = [...source.matchAll(/^function\s+([A-Za-z0-9_]+)\s*\(/gm)].map((match) => match[1]);
    for (const name of declarations) {
      if (name.endsWith('_')) continue;
      if (name === 'doGet' || name.startsWith('web')) continue;
      offenders.push(file + ': ' + name);
    }
  }
  assert.deepEqual(offenders, []);
});

test('Apps Script Sheets service records old and new values, failures, and compensating deletes', () => {
  const properties = new Map([['WMIT_SPREADSHEET_ID', 'SPREADSHEET-1']]);
  function fakeSheet(headers, sheetId) {
    const rows = [headers.slice()];
    return {
      rows: rows,
      getSheetId: () => sheetId,
      appendRow: (row) => rows.push(row.slice()),
      getLastRow: () => rows.length,
      getLastColumn: () => headers.length,
      getRange: (row, column, numRows, numColumns) => ({
        getValues: () => rows.slice(row - 1, row - 1 + numRows).map((r) => r.slice(column - 1, numColumns ? column - 1 + numColumns : undefined)),
        setValues: (values) => { values.forEach((value, offset) => { rows[row - 1 + offset] = value.concat(rows[row - 1 + offset] ? rows[row - 1 + offset].slice(value.length) : []); }); }
      }),
      deleteRow: (row) => rows.splice(row - 1, 1)
    };
  }
  const recordHeaders = ['record_id', 'status', 'record_version', 'created_at', 'created_by', 'updated_at', 'updated_by', 'client_id', 'supplier_id', 'inquiry_id', 'quotation_id', 'booking_id', 'currency', 'amount', 'destination', 'record_json'];
  const auditSheet = fakeSheet(['audit_id', 'timestamp', 'actor', 'action', 'entity_type', 'entity_id', 'result', 'details'], 9001);
  const clientSheet = fakeSheet(recordHeaders, 9002);
  const spreadsheet = { getSheetByName: (name) => (name === 'Audit Log' ? auditSheet : name === 'Clients' ? clientSheet : fakeSheet(recordHeaders, 9003 + name.length)) };
  const context = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => properties.get(key) || null, setProperty: (key, value) => properties.set(key, value) }) },
    SpreadsheetApp: { openById: () => spreadsheet },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    Session: { getScriptTimeZone: () => 'Asia/Manila' },
    Utilities: { getUuid: () => 'uuid-' + Math.random().toString(36).slice(2), formatDate: () => '2026' },
    wmitNow_: () => '2026-08-16T00:00:00.000Z'
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('apps-script/WmitWorkspace.gs', 'utf8'), context, { filename: 'apps-script/WmitWorkspace.gs' });
  vm.runInContext(fs.readFileSync('apps-script/WmitSheetServices.gs', 'utf8'), context, { filename: 'apps-script/WmitSheetServices.gs' });
  const created = context.WmitSheetServices.createClient({ display_name: 'Audit Test Client' }, { actor: 'AUDIT_TESTER' });
  assert.equal(created.ok, true);
  const clientId = created.data.client_id;
  const updated = context.WmitSheetServices.updateClient(clientId, { display_name: 'Renamed Client' }, { actor: 'AUDIT_TESTER' });
  assert.equal(updated.ok, true);
  const conflict = context.WmitSheetServices.updateClient(clientId, { display_name: 'Stale Edit', expected_version: 1 }, { actor: 'AUDIT_TESTER' });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error.code, 'VERSION_CONFLICT');
  const compensated = context.WmitSheetServices.compensateCreate('Client', clientId);
  assert.equal(compensated.ok, true);
  const auditRows = auditSheet.rows.slice(1);
  const updateAudit = auditRows.find((row) => row[3] === 'UPDATE');
  assert.equal(updateAudit[6], 'SUCCESS');
  const details = JSON.parse(updateAudit[7]);
  assert.deepEqual(details.changed_fields, ['display_name']);
  assert.equal(details.old_values.display_name, 'Audit Test Client');
  assert.equal(details.new_values.display_name, 'Renamed Client');
  const failureAudits = auditRows.filter((row) => row[6] === 'FAILURE');
  assert.equal(failureAudits.length >= 1, true);
  assert.match(failureAudits[0][7], /VERSION_CONFLICT/);
  const rollbackAudit = auditRows.find((row) => row[3] === 'ROLLBACK_CREATE');
  assert.equal(rollbackAudit[5], clientId);
  const remaining = context.WmitSheetServices.listClient().data;
  assert.equal(remaining.length, 0);
});

test('Apps Script public intake is rate limited but idempotent retries stay free', () => {
  const records = { Client: [], Inquiry: [], Task: [] };
  const cache = new Map();
  const context = {
    wmitNow_: () => '2026-08-16T00:00:00.000Z',
    initializeWmitWorkspace_: () => {},
    CacheService: { getScriptCache: () => ({ get: (key) => cache.get(key) || null, put: (key, value) => cache.set(key, value), remove: (key) => cache.delete(key) }) },
    WmitSheetServices: {},
    WmitOperationsServices: {
      createClient: (input) => { const record = Object.assign({}, input, { client_id: 'CLIENT-' + (records.Client.length + 1) }); records.Client.push(record); return { ok: true, data: record, meta: {} }; },
      createInquiry: (input) => { const record = Object.assign({}, input, { inquiry_id: 'INQUIRY-' + (records.Inquiry.length + 1) }); records.Inquiry.push(record); return { ok: true, data: record, meta: {} }; },
      createTask: () => ({ ok: true, data: { task_id: 'TASK-1' }, meta: {} })
    }
  };
  Object.keys(records).forEach((type) => {
    const idField = { Client: 'client_id', Inquiry: 'inquiry_id', Task: 'task_id' }[type];
    context.WmitSheetServices['list' + type] = () => ({ ok: true, data: records[type] });
    context.WmitSheetServices['create' + type] = (input) => ({ ok: true, data: input, meta: {} });
  });
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('apps-script/WmitPublicServices.gs', 'utf8'), context, { filename: 'apps-script/WmitPublicServices.gs' });
  const payload = { name: 'Rate Limit Client', email: 'rate@example.com', destination: 'Bangkok', travel_month: '2026-11', duration_days: 5, adults: 2 };
  const first = context.WmitPublicServices.request(payload);
  assert.equal(first.ok, true);
  const retry = context.WmitPublicServices.request(Object.assign({}, payload, { idempotency_key: 'none' }));
  assert.equal(retry.ok, false);
  assert.match(retry.error.message, /wait a minute/i);
  cache.delete('WMIT_PUBLIC_REQ_rate@example.com');
  cache.set('WMIT_PUBLIC_REQ_GLOBAL', '30');
  const busy = context.WmitPublicServices.request(Object.assign({}, payload, { email: 'other@example.com' }));
  assert.equal(busy.ok, false);
  assert.match(busy.error.message, /busy/i);
});

test('Apps Script booking creation rolls back partial writes when a later record fails', () => {
  const records = { Quotation: [{ quotation_id: 'QUOTATION-1', status: 'APPROVED', client_id: 'CLIENT-1', currency: 'PHP', destination: 'Bangkok' }], QuotationAcceptance: [{ quotation_id: 'QUOTATION-1', state: 'ACCEPTED' }], Person: [{ person_id: 'PERSON-1', display_name: 'Lead Pax' }], Booking: [], BookingParticipant: [], BookingItem: [], QuotationItem: [] };
  const compensated = [];
  const context = {
    wmitNow_: () => '2026-08-16T00:00:00.000Z',
    Utilities: { formatDate: () => '2026-08-16' },
    Session: { getScriptTimeZone: () => 'Asia/Manila' },
    WmitSheetServices: {
      compensateCreate: (type, id) => {
        compensated.push([type, id]);
        const idField = { Booking: 'booking_id', BookingParticipant: 'booking_participant_id', BookingItem: 'booking_item_id' }[type];
        records[type] = records[type].filter((record) => record[idField] !== id);
        return { ok: true, data: { compensated: true }, meta: {} };
      }
    }
  };
  Object.keys(records).forEach((type) => {
    const idField = { Quotation: 'quotation_id', QuotationAcceptance: 'quotation_acceptance_id', Person: 'person_id', Booking: 'booking_id', BookingParticipant: 'booking_participant_id', BookingItem: 'booking_item_id', QuotationItem: 'quotation_item_id' }[type];
    context.WmitSheetServices['list' + type] = () => ({ ok: true, data: records[type] });
    context.WmitSheetServices['create' + type] = (input) => {
      if (type === 'BookingParticipant') return { ok: false, error: { code: 'SHEET_FAILURE', message: 'Simulated participant failure.' } };
      const record = Object.assign({}, input, { [idField]: type.toUpperCase() + '-NEW' });
      records[type].push(record);
      return { ok: true, data: record, meta: {} };
    };
    context.WmitSheetServices['update' + type] = (_id, changes) => ({ ok: true, data: changes, meta: {} });
  });
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('apps-script/WmitBookingServices.gs', 'utf8'), context, { filename: 'apps-script/WmitBookingServices.gs' });
  const failed = context.WmitBookingServices.createBooking({ quotation_id: 'QUOTATION-1', lead_pax_person_id: 'PERSON-1' }, { actor: 'TEST_STAFF' });
  assert.equal(failed.ok, false);
  assert.equal(compensated.length, 1);
  assert.equal(compensated[0][0], 'Booking');
  assert.equal(records.BookingParticipant.length, 0);
  assert.equal(records.Booking.filter((booking) => booking.booking_id === 'BOOKING-NEW').length, 0);
});
