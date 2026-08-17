/**
 * Apps Script web-app entry points.
 *
 * Index.html calls these functions with google.script.run. Deployment should
 * execute as the deploying owner. WMIT authentication is handled by the
 * application session layer below, not by Google account identity.
 */
var WMIT_BUILD_VERSION = '2.12.0-security-hardening-20260816';

// Salted, stretched password hashing. Accounts store {salt, iterations,
// password_hash}; a single fast hash is never used for login verification.
var WMIT_PASSWORD_ITERATIONS = 2500;

function doGet(e) {
  var view = e && e.parameter && e.parameter.view;
  if (view === 'request') return HtmlService.createHtmlOutputFromFile('PublicRequest').setTitle('Request a Custom Quote');
  if (view === 'quotation') return HtmlService.createHtmlOutputFromFile('PublicQuotation').setTitle('WMIT Travel Quotation');
  return HtmlService.createHtmlOutputFromFile('Index').setTitle('WMIT Workspace');
}

function wmitAccounts_() {
  var raw = PropertiesService.getScriptProperties().getProperty('WMIT_LOGIN_ACCOUNTS_JSON');
  if (!raw) return [];
  try { return JSON.parse(raw) || []; } catch (error) { return []; }
}

function wmitSaveAccounts_(accounts) {
  PropertiesService.getScriptProperties().setProperty('WMIT_LOGIN_ACCOUNTS_JSON', JSON.stringify(accounts));
}

function wmitHashPassword_(password, salt, iterations) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(salt) + ':' + String(password), Utilities.Charset.UTF_8);
  var rounds = Number(iterations) > 0 ? Number(iterations) : WMIT_PASSWORD_ITERATIONS;
  for (var i = 1; i < rounds; i += 1) {
    bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  }
  return Utilities.base64Encode(bytes);
}

function wmitPasswordMatches_(password, account) {
  var iterations = Number(account.iterations) > 0 ? Number(account.iterations) : WMIT_PASSWORD_ITERATIONS;
  return wmitHashPassword_(password, account.salt, iterations) === account.password_hash;
}

function wmitCleanInput_(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  var clean = {};
  Object.keys(input).forEach(function (key) { if (key !== '_wmit_session_token' && key !== 'session_token') clean[key] = input[key]; });
  return clean;
}

function wmitSession_(input) {
  var token = input && typeof input === 'object' && (input._wmit_session_token || input.session_token);
  if (!token) throw new Error('Please sign in to WMIT first.');
  var raw = CacheService.getScriptCache().get('WMIT_SESSION_' + token);
  if (!raw) throw new Error('Your WMIT session has expired. Please sign in again.');
  var session; try { session = JSON.parse(raw); } catch (error) { throw new Error('Your WMIT session is invalid. Please sign in again.'); }
  if (!session.username || !session.role) throw new Error('Your WMIT session is invalid. Please sign in again.');
  return { token: token, username: session.username, role: session.role };
}

function wmitWebActor_(input) {
  return 'WMIT:' + wmitSession_(input).username;
}

function wmitRequireRole_(allowed, input) {
  var session = wmitSession_(input);
  if (allowed.indexOf(session.role) < 0) throw new Error('This action is restricted to ' + allowed.join(' or ') + '.');
  return session.role;
}

function wmitInternState_(input) {
  wmitRequireRole_(['INTERN'], input);
  var result = WmitOperationsServices.getOperationsState();
  var tasks = (result.data && result.data.entities && result.data.entities.Task || []).filter(function (task) {
    return ['COMPLETED', 'CANCELLED'].indexOf(String(task.state || '').toUpperCase()) < 0;
  });
  return { ok: true, data: { entities: { Task: tasks }, finance: {}, user: { role: 'INTERN' } }, meta: { restricted: true } };
}

// Private (underscore-suffixed) so it can never be called through
// google.script.run by an anonymous visitor: whoever deployed the script runs
// it once from the Apps Script editor to create the first administrator.
// Without this, an attacker could initialize the login system first and take
// over the workspace.
function initializeWmitLoginSystem_() {
  var accounts = wmitAccounts_();
  if (accounts.length) return { ok: true, data: { initialized: true, account_count: accounts.length }, meta: { action: 'LOGIN_SYSTEM_ALREADY_INITIALIZED' } };
  var temporaryPassword = 'WMIT-' + Utilities.getUuid().replace(/-/g, '').slice(0, 12) + '!';
  var salt = Utilities.getUuid();
  wmitSaveAccounts_([{ username: 'admin', display_name: 'WMIT Administrator', role: 'ADMIN', status: 'ACTIVE', salt: salt, iterations: WMIT_PASSWORD_ITERATIONS, password_hash: wmitHashPassword_(temporaryPassword, salt, WMIT_PASSWORD_ITERATIONS), created_at: wmitNow_() }]);
  // The temporary password is returned exactly once to the initializing owner
  // through the editor execution result and is never written to execution logs.
  return { ok: true, data: { username: 'admin', temporary_password: temporaryPassword }, meta: { action: 'LOGIN_SYSTEM_INITIALIZED' } };
}

function webLogin(input) {
  var value = input || {}, username = String(value.username || '').trim().toLowerCase(), password = String(value.password || '');
  if (!username || !password) throw new Error('Username and password are required.');
  var failureKey = 'WMIT_LOGIN_FAIL_' + username, failures = Number(CacheService.getScriptCache().get(failureKey) || 0);
  if (failures >= 5) throw new Error('Too many failed sign-in attempts. Try again in five minutes.');
  var account = wmitAccounts_().filter(function (item) { return item.username === username; })[0];
  if (!account || account.status !== 'ACTIVE' || !wmitPasswordMatches_(password, account)) { CacheService.getScriptCache().put(failureKey, String(failures + 1), 300); throw new Error('Invalid WMIT username or password.'); }
  CacheService.getScriptCache().remove(failureKey);
  var token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('WMIT_SESSION_' + token, JSON.stringify({ username: account.username, role: account.role }), 21600);
  return { ok: true, data: { session_token: token, username: account.username, display_name: account.display_name, role: account.role }, meta: { action: 'LOGIN' } };
}

function webLogout(input) {
  var session = wmitSession_(input); CacheService.getScriptCache().remove('WMIT_SESSION_' + session.token); return { ok: true, meta: { action: 'LOGOUT' } };
}

function webChangeOwnPassword(input) {
  var session = wmitSession_(input), value = wmitCleanInput_(input) || {}, currentPassword = String(value.current_password || ''), newPassword = String(value.new_password || '');
  if (newPassword.length < 10) throw new Error('New password must be at least 10 characters.');
  var accounts = wmitAccounts_(), index = accounts.findIndex(function (account) { return account.username === session.username; }), account = accounts[index];
  if (!account || !wmitPasswordMatches_(currentPassword, account)) throw new Error('Current password is incorrect.');
  var salt = Utilities.getUuid(); accounts[index].salt = salt; accounts[index].iterations = WMIT_PASSWORD_ITERATIONS; accounts[index].password_hash = wmitHashPassword_(newPassword, salt, WMIT_PASSWORD_ITERATIONS); accounts[index].updated_at = wmitNow_(); wmitSaveAccounts_(accounts);
  return { ok: true, meta: { action: 'CHANGE_OWN_PASSWORD' } };
}

function webAdminResetLoginPassword(input) {
  wmitRequireRole_(['ADMIN'], input);
  var value = wmitCleanInput_(input) || {}, username = String(value.username || '').trim().toLowerCase(), newPassword = String(value.new_password || '');
  if (newPassword.length < 10) throw new Error('New password must be at least 10 characters.');
  var accounts = wmitAccounts_(), index = accounts.findIndex(function (account) { return account.username === username; });
  if (index < 0) throw new Error('WMIT account was not found.');
  var salt = Utilities.getUuid(); accounts[index].salt = salt; accounts[index].iterations = WMIT_PASSWORD_ITERATIONS; accounts[index].password_hash = wmitHashPassword_(newPassword, salt, WMIT_PASSWORD_ITERATIONS); accounts[index].updated_at = wmitNow_(); wmitSaveAccounts_(accounts);
  return { ok: true, data: { username: username }, meta: { action: 'ADMIN_RESET_LOGIN_PASSWORD' } };
}

function webSetLoginAccountStatus(input) {
  var session = wmitSession_(input); wmitRequireRole_(['ADMIN'], input);
  var value = wmitCleanInput_(input) || {}, username = String(value.username || '').trim().toLowerCase(), status = String(value.status || '').trim().toUpperCase();
  if (['ACTIVE', 'DISABLED'].indexOf(status) < 0) throw new Error('Account status must be ACTIVE or DISABLED.');
  if (username === session.username && status !== 'ACTIVE') throw new Error('You cannot disable your own signed-in account.');
  var accounts = wmitAccounts_(), index = accounts.findIndex(function (account) { return account.username === username; });
  if (index < 0) throw new Error('WMIT account was not found.');
  if (status === 'DISABLED' && accounts[index].role === 'ADMIN' && accounts[index].status === 'ACTIVE' && accounts.filter(function (account) { return account.role === 'ADMIN' && account.status === 'ACTIVE'; }).length <= 1) throw new Error('At least one active Admin account must remain.');
  accounts[index].status = status; accounts[index].updated_at = wmitNow_(); wmitSaveAccounts_(accounts);
  return { ok: true, data: { username: username, status: status }, meta: { action: 'SET_LOGIN_ACCOUNT_STATUS' } };
}

function webUpdateLoginAccountRole(input) {
  var session = wmitSession_(input); wmitRequireRole_(['ADMIN'], input);
  var value = wmitCleanInput_(input) || {}, username = String(value.username || '').trim().toLowerCase(), role = String(value.role || '').trim().toUpperCase();
  if (['ADMIN', 'STAFF', 'INTERN'].indexOf(role) < 0) throw new Error('Select Admin, Staff, or Intern.');
  if (username === session.username && role !== 'ADMIN') throw new Error('You cannot remove Admin access from your own signed-in account.');
  var accounts = wmitAccounts_(), index = accounts.findIndex(function (account) { return account.username === username; });
  if (index < 0) throw new Error('WMIT account was not found.');
  if (accounts[index].role === 'ADMIN' && role !== 'ADMIN' && accounts[index].status === 'ACTIVE' && accounts.filter(function (account) { return account.role === 'ADMIN' && account.status === 'ACTIVE'; }).length <= 1) throw new Error('At least one active Admin account must remain.');
  accounts[index].role = role; accounts[index].updated_at = wmitNow_(); wmitSaveAccounts_(accounts);
  return { ok: true, data: { username: username, role: role }, meta: { action: 'UPDATE_LOGIN_ACCOUNT_ROLE' } };
}

function webGetCurrentUser(input) {
  var session = wmitSession_(input);
  return { ok: true, data: { username: session.username, role: session.role, build_version: WMIT_BUILD_VERSION, permissions: { can_view_finance: session.role !== 'INTERN', can_write: session.role !== 'INTERN', can_manage_workspace: session.role === 'ADMIN' } } };
}

function webListLoginAccounts(input) {
  wmitRequireRole_(['ADMIN'], input);
  return { ok: true, data: wmitAccounts_().map(function (account) { return { username: account.username, display_name: account.display_name, role: account.role, status: account.status }; }) };
}

function webCreateLoginAccount(input) {
  wmitRequireRole_(['ADMIN'], input);
  var value = input || {};
  var accounts = wmitAccounts_();
  var username = String(value.username || '').trim().toLowerCase();
  var password = String(value.password || '');
  var role = String(value.role || '').trim().toUpperCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username)) throw new Error('Username must be 3-40 characters and use only letters, numbers, dot, underscore, or hyphen.');
  if (password.length < 10) throw new Error('Password must be at least 10 characters.');
  if (['ADMIN', 'STAFF', 'INTERN'].indexOf(role) < 0) throw new Error('Select Admin, Staff, or Intern.');
  if (accounts.some(function (account) { return account.username === username; })) throw new Error('That username already exists.');
  var salt = Utilities.getUuid();
  accounts.push({ username: username, display_name: String(value.display_name || username).trim(), role: role, status: 'ACTIVE', salt: salt, iterations: WMIT_PASSWORD_ITERATIONS, password_hash: wmitHashPassword_(password, salt, WMIT_PASSWORD_ITERATIONS), created_at: wmitNow_() });
  wmitSaveAccounts_(accounts);
  return { ok: true, data: { username: username, display_name: String(value.display_name || username).trim(), role: role, status: 'ACTIVE' }, meta: { action: 'CREATE_LOGIN_ACCOUNT' } };
}

function webGetUserRoles(input) {
  wmitRequireRole_(['ADMIN'], input);
  return { ok: true, data: wmitAccounts_().map(function (account) { return { username: account.username, display_name: account.display_name, role: account.role, status: account.status }; }) };
}

function webSaveUserRoles(input) {
  wmitRequireRole_(['ADMIN'], input);
  // Deprecated legacy email-role mapping. WMIT login accounts are managed
  // through webCreateLoginAccount / webUpdateLoginAccountRole instead.
  return { ok: false, error: { code: 'LOGIN_SYSTEM_ACTIVE', message: 'Email role mapping is no longer used. Create WMIT login accounts instead.' } };
}

function webInitializeWorkspace(input) {
  wmitRequireRole_(['ADMIN'], input);
  return initializeWmitWorkspace_();
}

function webInitializeSyntheticWorkspace(input) {
  wmitRequireRole_(['ADMIN'], input);
  return initializeWmitSyntheticWorkspace_();
}

function webCreateSupplier(input) {
  wmitRequireRole_(['ADMIN'], input);
  initializeWmitWorkspace_();
  var value = wmitCleanInput_(input) || {};
  var displayName = String(value.display_name || '').trim();
  if (!displayName) throw new Error('Supplier name is required.');
  var roles = Array.isArray(value.roles) ? value.roles.map(function (role) { return String(role || '').trim().toUpperCase(); }).filter(Boolean).filter(function (role, index, list) { return list.indexOf(role) === index; }) : [];
  if (!roles.length) throw new Error('Select at least one supplier role.');
  var existing = WmitSheetServices.listSupplier().data.filter(function (supplier) {
    return String(supplier.display_name || supplier.legal_name || '').trim().toLowerCase() === displayName.toLowerCase();
  })[0];
  if (existing) return { ok: true, data: existing, meta: { action: 'CREATE_SUPPLIER', idempotent: true } };
  return WmitSheetServices.createSupplier({
    display_name: displayName,
    legal_name: String(value.legal_name || displayName).trim(),
    roles: roles,
    status: 'DRAFT'
  }, { actor: wmitWebActor_(input) });
}

function webUploadSourceDocument(input) {
  wmitRequireRole_(['ADMIN'], input);
  return uploadSourceDocument_(wmitCleanInput_(input), { actor: wmitWebActor_(input) });
}

function webGetState(input) {
  var role = wmitSession_(input).role;
  if (role === 'INTERN') return wmitInternState_(input);
  initializeWmitWorkspace_();
  return WmitSheetServices.getState();
}

function webSubmitPublicQuoteRequest(input) {
  return WmitPublicServices.request(input || {});
}
function webGetPublicQuotation(input) {
  return WmitPublicServices.getQuotation(input && input.token);
}
function webAcceptPublicQuotation(input) {
  return WmitPublicServices.acceptQuotation(input && input.token, input || {});
}
function webCreatePublicQuotationLink(input) {
  wmitRequireRole_(['ADMIN', 'STAFF'], input);
  initializeWmitWorkspace_();
  return WmitPublicServices.createQuotationLink(input && input.quotation_id, { actor: wmitWebActor_(input) });
}

function webGetOperationsState(input) {
  var role = wmitSession_(input).role;
  if (role === 'INTERN') return wmitInternState_(input);
  try {
    return WmitOperationsServices.getOperationsState();
  } catch (error) {
    return { ok: false, error: { code: 'WORKSPACE_STATE_LOAD_FAILED', message: 'The workspace data could not load. ' + (error.message || error) + ' Update all Apps Script files together and deploy a new version.' } };
  }
}

function webCreateClient(input) {
  wmitRequireRole_(['ADMIN', 'STAFF'], input);
  initializeWmitWorkspace_();
  return WmitOperationsServices.createClient(wmitCleanInput_(input), { actor: wmitWebActor_(input) });
}

function webUpdateClient(input) {
  wmitRequireRole_(['ADMIN', 'STAFF'], input);
  initializeWmitWorkspace_();
  return WmitOperationsServices.updateClient(wmitCleanInput_(input), { actor: wmitWebActor_(input) });
}

function webCreateSubAgent(input) {
  wmitRequireRole_(['ADMIN', 'STAFF'], input);
  initializeWmitWorkspace_();
  return WmitOperationsServices.createSubAgent(wmitCleanInput_(input), { actor: wmitWebActor_(input) });
}

function webCreateInquiry(input) {
  wmitRequireRole_(['ADMIN', 'STAFF'], input);
  initializeWmitWorkspace_();
  return WmitOperationsServices.createInquiry(wmitCleanInput_(input), { actor: wmitWebActor_(input) });
}

function webUpdateInquiry(input) {
  wmitRequireRole_(['ADMIN', 'STAFF'], input);
  initializeWmitWorkspace_();
  return WmitOperationsServices.updateInquiry(wmitCleanInput_(input), { actor: wmitWebActor_(input) });
}

function webCreateQuotationFromInquiry(input) {
  wmitRequireRole_(['ADMIN', 'STAFF'], input);
  initializeWmitWorkspace_();
  return WmitOperationsServices.createQuotationFromInquiry(wmitCleanInput_(input), { actor: wmitWebActor_(input) });
}

function webCreateTask(input) {
  wmitRequireRole_(['ADMIN', 'STAFF'], input);
  initializeWmitWorkspace_();
  return WmitOperationsServices.createTask(wmitCleanInput_(input), { actor: wmitWebActor_(input) });
}

function webUpdateTask(input) {
  wmitRequireRole_(['ADMIN', 'STAFF'], input);
  initializeWmitWorkspace_();
  return WmitOperationsServices.updateTask(wmitCleanInput_(input), { actor: wmitWebActor_(input) });
}

function webCreateCommunication(input) {
  wmitRequireRole_(['ADMIN', 'STAFF'], input);
  initializeWmitWorkspace_();
  return WmitOperationsServices.createCommunication(wmitCleanInput_(input), { actor: wmitWebActor_(input) });
}

function webCreatePaymentScheduleItem(input) {
  wmitRequireRole_(['ADMIN', 'STAFF'], input);
  initializeWmitWorkspace_();
  return WmitOperationsServices.createPaymentScheduleItem(wmitCleanInput_(input), { actor: wmitWebActor_(input) });
}

function webRecordClientPayment(input) {
  wmitRequireRole_(['ADMIN', 'STAFF'], input);
  initializeWmitWorkspace_();
  return WmitOperationsServices.recordClientPayment(wmitCleanInput_(input), { actor: wmitWebActor_(input) });
}

function webVerifyClientPayment(input) {
  wmitRequireRole_(['ADMIN'], input);
  initializeWmitWorkspace_();
  return WmitOperationsServices.verifyClientPayment(wmitCleanInput_(input), { actor: wmitWebActor_(input) });
}

function webAllocateClientPayment(input) {
  wmitRequireRole_(['ADMIN'], input);
  initializeWmitWorkspace_();
  return WmitOperationsServices.createPaymentAllocation(wmitCleanInput_(input), { actor: wmitWebActor_(input) });
}

function webCreateCashTransaction(input) {
  wmitRequireRole_(['ADMIN'], input);
  initializeWmitWorkspace_();
  return WmitOperationsServices.createCashTransaction(wmitCleanInput_(input), { actor: wmitWebActor_(input) });
}

function webVoidCashTransaction(input) {
  wmitRequireRole_(['ADMIN'], input);
  initializeWmitWorkspace_();
  return WmitOperationsServices.voidCashTransaction(wmitCleanInput_(input), { actor: wmitWebActor_(input) });
}

function webCreateSupplierPayable(input) {
  wmitRequireRole_(['ADMIN'], input);
  initializeWmitWorkspace_();
  return WmitOperationsServices.createSupplierPayable(wmitCleanInput_(input), { actor: wmitWebActor_(input) });
}

function webApproveSupplierPayable(input) {
  wmitRequireRole_(['ADMIN'], input);
  initializeWmitWorkspace_();
  return WmitOperationsServices.approveSupplierPayable(wmitCleanInput_(input), { actor: wmitWebActor_(input) });
}

function webRecordSupplierPayment(input) {
  wmitRequireRole_(['ADMIN'], input);
  initializeWmitWorkspace_();
  return WmitOperationsServices.recordSupplierPayment(wmitCleanInput_(input), { actor: wmitWebActor_(input) });
}

function webGetQuotationEditor(input) { wmitRequireRole_(['ADMIN', 'STAFF'], input); initializeWmitWorkspace_(); return getQuotationEditor_(input && input.value); }
function webGetClientQuotationPreview(input) { wmitRequireRole_(['ADMIN', 'STAFF'], input); initializeWmitWorkspace_(); return getClientQuotationPreview_(input && input.value); }
function webUpdateQuotation(input) { wmitRequireRole_(['ADMIN', 'STAFF'], input); initializeWmitWorkspace_(); return updateQuotation_(wmitCleanInput_(input)); }
function webCreateQuotationItem(input) { wmitRequireRole_(['ADMIN', 'STAFF'], input); initializeWmitWorkspace_(); return createQuotationItem_(wmitCleanInput_(input)); }
function webUpdateQuotationItem(input) { wmitRequireRole_(['ADMIN', 'STAFF'], input); initializeWmitWorkspace_(); return updateQuotationItem_(wmitCleanInput_(input)); }
function webRemoveQuotationItem(input) { wmitRequireRole_(['ADMIN', 'STAFF'], input); initializeWmitWorkspace_(); return removeQuotationItem_(wmitCleanInput_(input)); }
function webReorderQuotationItems(input) { wmitRequireRole_(['ADMIN', 'STAFF'], input); initializeWmitWorkspace_(); return reorderQuotationItems_(wmitCleanInput_(input)); }
function webCreateQuotation(input) {
  wmitRequireRole_(['ADMIN', 'STAFF'], input);
  initializeWmitWorkspace_();
  try {
    var value = wmitCleanInput_(input) || {}; if (!value.client_id) throw new Error('Client is required.'); if (!value.destination) throw new Error('Destination is required.');
    var currency = String(value.currency || 'PHP').trim().toUpperCase(); if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Currency must be a three-letter code.');
    return WmitSheetServices.createQuotation(Object.assign({}, value, { currency: currency, supplier_cost_total: '0.00', markup_total: '0.00', fees_total: '0.00', tax_total: '0.00', discount_total: '0.00', client_total: '0.00', status: 'DRAFT', staff_review_required: true }), { actor: wmitWebActor_(input) });
  } catch (error) { return { ok: false, error: { code: 'QUOTATION_CREATE_INVALID', message: error.message } }; }
}
function webApproveQuotation(input) {
  wmitRequireRole_(['ADMIN'], input);
  initializeWmitWorkspace_();
  try { var value = wmitCleanInput_(input) || {}; var quote = quotationGet_('Quotation', value && value.quotation_id); if (String(quote.status).toUpperCase() === 'APPROVED') return { ok: true, data: quote, meta: { action: 'APPROVE_QUOTATION', idempotent: true } }; if (String(quote.status).toUpperCase() !== 'DRAFT') throw new Error('Only a draft quotation can be approved.'); return WmitSheetServices.updateQuotation(quote.quotation_id, { status: 'APPROVED', approved_at: wmitNow_(), approved_by: wmitWebActor_(input) }, { actor: wmitWebActor_(input) }); } catch (error) { return { ok: false, error: { code: 'QUOTATION_APPROVAL_INVALID', message: error.message } }; }
}

function webGetReviewQueue(input) {
  wmitRequireRole_(['ADMIN'], input);
  return getWmitReviewQueue_();
}

function webReviewSourceDocument(input) {
  wmitRequireRole_(['ADMIN'], input);
  return reviewWmitSourceDocument_(wmitCleanInput_(input), { actor: wmitWebActor_(input) });
}

function webExtractSourceDocument(input) {
  wmitRequireRole_(['ADMIN'], input);
  return extractWmitSourceDocument_(wmitCleanInput_(input), { actor: wmitWebActor_(input) });
}

function webActivateTariff(input) {
  wmitRequireRole_(['ADMIN'], input);
  return activateWmitTariff_(wmitCleanInput_(input), { actor: wmitWebActor_(input) });
}

/* Operational workspace: bookings, supplier fulfilment, departures, and amendments. */
function webCreatePerson(input) {
  wmitRequireRole_(['ADMIN', 'STAFF'], input);
  initializeWmitWorkspace_();
  return WmitBookingServices.createPerson(wmitCleanInput_(input), { actor: wmitWebActor_(input) });
}
function webRecordQuotationAcceptance(input) {
  wmitRequireRole_(['ADMIN', 'STAFF'], input);
  initializeWmitWorkspace_();
  return WmitBookingServices.recordQuotationAcceptance(wmitCleanInput_(input), { actor: wmitWebActor_(input) });
}
function webCreateBooking(input) {
  wmitRequireRole_(['ADMIN', 'STAFF'], input);
  initializeWmitWorkspace_();
  return WmitBookingServices.createBooking(wmitCleanInput_(input), { actor: wmitWebActor_(input) });
}
function webConfirmBookingCommitment(input) {
  wmitRequireRole_(['ADMIN', 'STAFF'], input);
  initializeWmitWorkspace_();
  return WmitBookingServices.confirmCommitment(wmitCleanInput_(input), { actor: wmitWebActor_(input) });
}
function webCreateSupplierBooking(input) {
  wmitRequireRole_(['ADMIN', 'STAFF'], input);
  initializeWmitWorkspace_();
  return WmitBookingServices.createSupplierBooking(wmitCleanInput_(input), { actor: wmitWebActor_(input) });
}
function webCreateDeparture(input) {
  wmitRequireRole_(['ADMIN', 'STAFF'], input);
  initializeWmitWorkspace_();
  return WmitBookingServices.createDeparture(wmitCleanInput_(input), { actor: wmitWebActor_(input) });
}
function webAddDepartureMembership(input) {
  wmitRequireRole_(['ADMIN', 'STAFF'], input);
  initializeWmitWorkspace_();
  return WmitBookingServices.addDepartureMembership(wmitCleanInput_(input), { actor: wmitWebActor_(input) });
}
function webCreateDepartureReadinessIssue(input) {
  wmitRequireRole_(['ADMIN', 'STAFF'], input);
  initializeWmitWorkspace_();
  return WmitBookingServices.createReadinessIssue(wmitCleanInput_(input), { actor: wmitWebActor_(input) });
}
function webUpdateDepartureReadinessIssue(input) {
  wmitRequireRole_(['ADMIN', 'STAFF'], input);
  initializeWmitWorkspace_();
  return WmitBookingServices.updateReadinessIssue(wmitCleanInput_(input), { actor: wmitWebActor_(input) });
}
function webCreateBookingAmendment(input) {
  wmitRequireRole_(['ADMIN', 'STAFF'], input);
  initializeWmitWorkspace_();
  return WmitBookingServices.createAmendment(wmitCleanInput_(input), { actor: wmitWebActor_(input) });
}
function webAcceptBookingAmendment(input) {
  wmitRequireRole_(['ADMIN'], input);
  initializeWmitWorkspace_();
  return WmitBookingServices.acceptAmendment(wmitCleanInput_(input), { actor: wmitWebActor_(input) });
}
