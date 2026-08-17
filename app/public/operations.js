'use strict';

let state = null;
const matchDiagnostics = {};
let automaticTaskSyncing = false;
let quotationPreview = null;
let messageTimer = null;

const $ = (id) => document.getElementById(id);
const list = (type, predicate) => ((state && state.entities && state.entities[type]) || []).filter(predicate || (() => true));
const latest = (type, predicate) => list(type, predicate).slice(-1)[0] || null;
const esc = (value) => String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

// Session auth: attach the bearer token when signed in and redirect to the
// login page when the server requires a session (hosted deployments). On the
// local unenforced server these are harmless no-ops.
function wmitAuthHeaders() {
  const token = sessionStorage.getItem('wmit_session');
  return token ? { Authorization: 'Bearer ' + token } : {};
}
async function wmitGuard401(response) {
  if (response.status === 401) {
    sessionStorage.removeItem('wmit_session');
    sessionStorage.removeItem('wmit_user');
    window.location.href = 'login.html';
    throw new Error('Sign-in required.');
  }
  return response;
}

function bindClientPicker(searchId, selectId) {
  const search = $(searchId);
  const select = $(selectId);
  if (!search || !select) return;
  const createButton = document.createElement('button');
  createButton.type = 'button';
  createButton.className = 'secondary compact';
  createButton.hidden = true;
  createButton.addEventListener('click', () => beginClientCreation(search.value.trim()));
  select.insertAdjacentElement('afterend', createButton);
  const render = () => {
    const query = search.value.trim().toLowerCase();
    const clients = list('Client').filter((client) => {
      if (!query) return true;
      return [client.display_name, client.legal_name, client.primary_email, client.primary_phone, client.client_id].filter(Boolean).some((value) => String(value).toLowerCase().includes(query));
    }).slice(0, 50);
    select.innerHTML = '<option value="">' + (query ? (clients.length ? 'Select matching client' : 'No matching client') : 'Select a client') + '</option>' + clients.map((client) => '<option value="' + esc(client.client_id) + '">' + esc(client.display_name || client.legal_name || client.client_id) + (client.primary_email ? ' · ' + esc(client.primary_email) : '') + '</option>').join('');
    createButton.hidden = !query || clients.length > 0;
    createButton.textContent = query && !clients.length ? 'Create new client “' + search.value.trim() + '”' : '';
  };
  search.addEventListener('input', render);
  render();
}

function beginClientCreation(name) {
  const value = String(name || '').trim();
  if (!value) return failLocal('Enter a client name before creating a new client.');
  sessionStorage.setItem('wmit.pendingClientName', value);
  sessionStorage.setItem('wmit.pendingClientReturnHash', window.location.hash || '#inquiry');
  window.location.hash = 'clients';
}

function readableState(value) {
  const raw = String(value || 'Pending');
  const labels = { BOOKING_NOT_READY: 'Booking not ready', NOT_READY: 'Not ready', CONFIRM_CLIENT_COMMITMENT: 'Confirm client commitment' };
  if (labels[raw]) return labels[raw];
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function status(value, kind) {
  return '<span class="status ' + (kind || '') + '">' + esc(value || 'Pending') + '</span>';
}

function requirementStatusBadge(requirements, fieldName) {
  const requirementStatuses = requirements && requirements.requirement_statuses || {};
  const value = requirementStatuses[fieldName];
  if (!value) return '';
  return ' ' + status(readableState(value), value === 'REQUIRED' ? 'info' : value === 'UNKNOWN' ? 'warn' : '');
}

function field(label, value) {
  let display = value;
  if (display === undefined || display === null || display === '') display = 'Not recorded';
  if (Array.isArray(display)) display = display.length ? display.join(' · ') : 'Not recorded';
  if (typeof display === 'object') display = 'Recorded';
  return '<div class="field"><label>' + esc(label) + '</label><div>' + esc(display) + '</div></div>';
}

function requirementTable(requirements) {
  const values = requirements || {};
  const labels = { destination: 'Destination', travel_start: 'Travel start', travel_end: 'Travel end', travel_month: 'Approximate month', travel_year: 'Approximate year', duration_days: 'Trip duration (days)', nights: 'Trip duration (nights)', adults: 'Adults', children: 'Children', infants: 'Infants', child_ages: 'Child ages', pax_count: 'Total travelers', hotel: 'Hotel', hotel_category: 'Hotel category', room_type: 'Room type', room_arrangement: 'Occupancy', room_arrangements: 'Room arrangement quantities', meal_plan: 'Meal plan', transfer_requirements: 'Transfers', tour_requirements: 'Tours' };
  const entries = Object.keys(values).filter((key) => key !== 'requirement_statuses' && values[key] !== undefined && values[key] !== null && values[key] !== '' && !(key === 'room_arrangement' && values.room_arrangements)).map((key) => '<tr><th>' + esc(labels[key] || key.replace(/_/g, ' ')) + '</th><td>' + esc(requirementValue(key, values[key])) + requirementStatusBadge(values, key) + '</td></tr>').join('');
  return entries ? '<table><tbody>' + entries + '</tbody></table>' : '<p class="muted">No requirement values recorded.</p>';
}

function requirementChangeSummary(inquiry) {
  if (!inquiry) return '';
  const changeEvents = Array.isArray(inquiry.history) ? inquiry.history.filter((entry) => entry.type === 'REQUIREMENTS_CHANGED') : [];
  if (!changeEvents.length) return '';
  const before = inquiry.original_request || {};
  const after = inquiry.current_requirements || {};
  const labels = { destination: 'Destination', travel_start: 'Travel start', travel_end: 'Travel end', travel_month: 'Travel month', travel_year: 'Travel year', duration_days: 'Duration', adults: 'Adults', children: 'Children', infants: 'Infants', pax_count: 'Travelers', hotel_category: 'Hotel category', room_arrangement: 'Room arrangement', room_arrangements: 'Room arrangement quantities', meal_plan: 'Meal plan' };
  const keys = Object.keys(labels);
  const changes = keys.filter((key) => JSON.stringify(before[key] === undefined ? null : before[key]) !== JSON.stringify(after[key] === undefined ? null : after[key])).map((key) => '<li><b>' + esc(labels[key]) + ':</b> ' + esc(before[key] === undefined || before[key] === '' ? 'Not recorded' : requirementValue(key, before[key])) + ' → <b>' + esc(after[key] === undefined || after[key] === '' ? 'Not recorded' : requirementValue(key, after[key])) + '</b></li>');
  return changes.length ? '<div class="card warn"><h3>Requirement changes</h3><ul class="change-list">' + changes.join('') + '</ul><details class="secondary-details"><summary>Original Client Request</summary>' + requirementTable(before) + '</details></div>' : '';
}

function conditionSummary(requirements) {
  const values = requirements || {};
  return [values.destination, values.region, values.hotel, values.nights ? values.nights + ' nights' : '', values.duration, values.room_arrangement || values.room_type, values.pax_count ? values.pax_count + ' travelers' : ''].filter(Boolean).join(' · ') || 'Supplier conditions recorded';
}

function readableSupplierName(id) {
  const supplier = latest('Supplier', (item) => item.supplier_id === id);
  return supplier ? (supplier.display_name || supplier.legal_name || id) : (id || 'Supplier not recorded');
}

function readablePreparedBy(value) {
  const actor = String(value || '').trim();
  if (!actor) return 'WMIT Staff';
  const labels = { LOCAL_STAFF: 'WMIT Staff', LOCAL_MANAGER: 'WMIT Manager' };
  return labels[actor] || actor.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function travelerCompositionLabel(requirements) {
  const values = requirements || {};
  if (values.adults === undefined && values.children === undefined && values.infants === undefined) return values.pax_count ? values.pax_count + ' travelers' : 'Travelers not recorded';
  return [values.adults + ' adults', values.children + ' children', values.infants + ' infants'].join(' · ') + ' (' + values.pax_count + ' total)';
}

function readablePricingContext(value) {
  if (value === 'EXPO') return 'Expo pricing context';
  return value === 'STANDARD' ? 'Standard pricing context' : 'Pricing context not recorded';
}

function expoConfiguration() {
  return state && state.configuration && state.configuration.expo || { configured: false, startAt: null, endAt: null };
}

function quotationDefaults() {
  return state && state.configuration && state.configuration.quotationDefaults || { paymentTerms: '50% deposit upon confirmation; balance due 30 business days before departure.', validityDays: 7, currency: 'PHP', paymentCurrencyPolicy: 'Payment due in quotation currency.', downPaymentDaysAfterReservation: 3, finalBalanceBusinessDaysBeforeDeparture: 30 };
}

function defaultQuotationValidUntil() {
  const date = new Date();
  date.setDate(date.getDate() + Number(quotationDefaults().validityDays || 7));
  return date.toISOString().slice(0, 10);
}

function quotationDefaultsMarkup() {
  const defaults = quotationDefaults();
  return '<div class="card"><h3>Quotation defaults</h3><p class="muted">Applied to new quotations and payment schedules. Existing records do not change.</p>' + field('Default payment terms', defaults.paymentTerms) + field('Default validity', defaults.validityDays + ' days') + field('Default currency', defaults.currency) + field('Payment currency policy', defaults.paymentCurrencyPolicy) + field('Down payment due', defaults.downPaymentDaysAfterReservation + ' days after reservation') + field('Final balance due', defaults.finalBalanceBusinessDaysBeforeDeparture + ' business days before departure') + '<button class="secondary compact" onclick="window.location.hash=\'settings\'">Edit settings</button></div>';
}

function messageTemplatesCard() {
  if (!window.wmitCurrentUser || window.wmitCurrentUser.role !== 'ADMIN') return '';
  const templates = window.wmitMessageTemplates(state && state.configuration && state.configuration.messageTemplates);
  const rows = templates.map((template) =>
    '<div class="field"><label for="tpl-' + esc(template.key) + '">' + esc(template.label) + ' <span class="muted">(' + esc(template.key) + ')</span></label>' +
    '<textarea id="tpl-' + esc(template.key) + '" rows="3" data-tpl-key="' + esc(template.key) + '" data-tpl-label="' + esc(template.label) + '">' + esc(template.body) + '</textarea></div>'
  ).join('');
  return '<div class="card" id="templates-card"><h3>Message templates</h3><p class="muted">The messages staff send from the Message buttons (follow-ups, leads, quotes, cases). Placeholders like {{first_name}} or {{destination}} fill from the record; missing details are simply left out. Changes apply to every workspace immediately.</p>' + rows +
    '<div class="row-actions" style="margin-top:10px"><button onclick="saveMessageTemplates()">Save templates</button> <button class="secondary" onclick="resetMessageTemplates()">Reset to defaults</button></div></div>';
}

async function saveMessageTemplates(templates) {
  const payload = templates || Array.from(document.querySelectorAll('[data-tpl-key]')).map((textarea) => ({
    key: textarea.dataset.tplKey,
    label: textarea.dataset.tplLabel,
    body: textarea.value
  })).filter((template) => template.body.trim());
  const saved = await api('updateSettings', { messageTemplates: payload });
  if (saved) showMessage('✓ Message templates saved', 'Staff will see the new wording immediately.', 'ok');
}

function resetMessageTemplates() {
  if (!window.confirm('Discard all template edits and restore the default wording?')) return;
  saveMessageTemplates([]);
}

function settingsMarkup() {
  const defaults = quotationDefaults();
  return '<div class="card"><h3>Quotation and payment defaults</h3><p class="muted">These are starting values for new quotations and payment schedules. Staff can edit them before saving.</p><div class="field"><label>Default payment terms / T&Cs</label><textarea id="settings-payment-terms" rows="3">' + esc(defaults.paymentTerms || '') + '</textarea></div><div class="field"><label>Payment currency policy</label><textarea id="settings-payment-currency-policy" rows="2">' + esc(defaults.paymentCurrencyPolicy || '') + '</textarea></div><div class="field"><label>Bank details for client documents (one account per line)</label><textarea id="settings-bank-details" rows="5">' + esc(defaults.bankDetails || '') + '</textarea></div><div class="grid3"><div class="field"><label>Default quotation validity (days)</label><input id="settings-validity-days" type="number" min="1" step="1" value="' + esc(defaults.validityDays || 7) + '"></div><div class="field"><label>Down payment due after reservation (days)</label><input id="settings-downpayment-days" type="number" min="0" step="1" value="' + esc(defaults.downPaymentDaysAfterReservation === undefined ? 3 : defaults.downPaymentDaysAfterReservation) + '"></div><div class="field"><label>Final balance due before departure (business days)</label><input id="settings-final-balance-days" type="number" min="0" step="1" value="' + esc(defaults.finalBalanceBusinessDaysBeforeDeparture === undefined ? 30 : defaults.finalBalanceBusinessDaysBeforeDeparture) + '"></div></div><div class="field"><label>Default currency</label><input id="settings-currency" maxlength="3" value="' + esc(defaults.currency || 'PHP') + '"></div><button onclick="saveSettings()">Save settings</button></div>' + (isLocalWorkspace() ? '<div class="card warn"><h3>Temporary test tool</h3><p class="muted">Fill test fields fills only empty required fields in the current workspace. It does not save, approve, verify, allocate, confirm, or pay anything.</p><button class="warning" onclick="fillSyntheticFormFields()">Fill test fields</button></div>' : '');
}

function renderSettings() {
  if (!$('settings-content')) return;
  $('settings-content').innerHTML = settingsMarkup() + messageTemplatesCard() + '<div class="card" id="accounts-panel" style="display:none"><h3>WMIT accounts</h3><div id="accounts-panel-content"><p class="muted">Loading accounts…</p></div></div>';
  renderAccountsPanel();
}

async function renderAccountsPanel() {
  const panel = $('accounts-panel');
  const content = $('accounts-panel-content');
  if (!panel || !content) return;
  if (!window.wmitCurrentUser) { panel.style.display = 'none'; return; }
  try {
    const response = await fetch('/api/admin/accounts', { headers: wmitAuthHeaders() });
    if (response.status === 403 || response.status === 501 || response.status === 401) { panel.style.display = 'none'; return; }
    const body = await response.json();
    if (!body.ok) { panel.style.display = 'none'; return; }
    panel.style.display = '';
    const rows = body.data.map((account) => '<tr><td><strong>' + esc(account.username) + '</strong></td><td>' + esc(account.display_name) + '</td><td>' + esc(account.role) + '</td><td><span class="status ' + (account.status === 'ACTIVE' ? 'good' : '') + '">' + esc(account.status) + '</span></td><td>' +
      '<button class="secondary compact" onclick="resetStaffPassword(\'' + esc(account.username) + '\')">Reset password</button> ' +
      '<button class="secondary compact" onclick="toggleStaffAccount(\'' + esc(account.username) + '\', \'' + (account.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE') + '\')">' + (account.status === 'ACTIVE' ? 'Disable' : 'Enable') + '</button>' +
      '</td></tr>').join('');
    content.innerHTML =
      '<p class="muted">Staff sign-in accounts for this server. Every action is audit-logged.</p>' +
      tableWrapMarkup(rows, '<th>Username</th><th>Name</th><th>Role</th><th>Status</th><th>Actions</th>') +
      '<h3 style="margin-top:14px">Add an account</h3>' +
      '<div class="grid3">' +
      '<div class="field"><label>Username</label><input id="account-username" placeholder="e.g. grace" autocomplete="off"></div>' +
      '<div class="field"><label>Display name</label><input id="account-display-name" placeholder="e.g. Grace Reyes" autocomplete="off"></div>' +
      '<div class="field"><label>Role</label><select id="account-role"><option value="STAFF">Staff</option><option value="ADMIN">Admin</option><option value="INTERN">Intern (read-only)</option></select></div>' +
      '</div>' +
      '<div class="field"><label>Temporary password (min 10 characters)</label><input id="account-password" type="text" autocomplete="off" placeholder="Give this to the staff member to change on first sign-in"></div>' +
      '<button onclick="createStaffAccount()">Create account</button>';
  } catch (_) {
    panel.style.display = 'none';
  }
}

function tableWrapMarkup(rowsHtml, headHtml) {
  if (!rowsHtml) return '<p class="muted">No accounts yet.</p>';
  return '<div class="table-wrap"><table><thead><tr>' + headHtml + '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>';
}

async function adminAccountAction(path, payload, successText) {
  try {
    const response = await fetch(path, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, wmitAuthHeaders()), body: JSON.stringify(payload) });
    const body = await response.json();
    if (!body.ok) return showMessage('✕ Account action failed', body.error && body.error.message || 'The request failed.', 'error');
    showMessage('✓ ' + successText, '', 'ok');
    renderAccountsPanel();
  } catch (error) {
    showMessage('✕ Account action failed', error.message, 'error');
  }
}

function createStaffAccount() {
  const payload = {
    username: $('account-username').value,
    display_name: $('account-display-name').value,
    role: $('account-role').value,
    password: $('account-password').value
  };
  adminAccountAction('/api/admin/accounts/create', payload, 'Account ' + payload.username + ' created');
}

function resetStaffPassword(username) {
  const password = window.prompt('New temporary password for ' + username + ' (min 10 characters):', '');
  if (!password) return;
  adminAccountAction('/api/admin/accounts/reset-password', { username, new_password: password }, 'Password reset for ' + username);
}

function toggleStaffAccount(username, status) {
  if (!window.confirm(status === 'DISABLED' ? 'Disable sign-in for ' + username + '?' : 'Re-enable sign-in for ' + username + '?')) return;
  adminAccountAction('/api/admin/accounts/status', { username, status }, username + ' is now ' + status);
}

function expoEligibilityMessage(quote) {
  if (!quote || quote.pricing_context_type !== 'EXPO') return '';
  const expo = expoConfiguration();
  if (!expo.configured) return 'Pending - Expo dates are not configured for this local workspace.';
  if (quote.discount_state === 'APPLIED') return 'Eligible - the recorded payment-sent timestamp is within the configured Expo period.';
  if (quote.discount_state === 'INELIGIBLE') return 'Ineligible - the recorded payment-sent timestamp is outside the configured Expo period.';
  return 'Pending - the actual client payment-sent timestamp is required before Expo eligibility can be determined.';
}

function fxInputMessage(quote) {
  const rules = quote && quote.pricing_rule_snapshot || {};
  if (!quote || !rules.fx_rule) return '';
  return 'Manual FX input not recorded. The ' + readableRule(rules.fx_rule) + ' rule is preserved; if currency conversion is required, pricing remains pending until the BDO selling rate input is recorded.';
}

function readableRule(value) {
  if (value === 'BDO_FOREX_SELLING_PLUS_1.0') return 'BDO forex selling rate + 1.0';
  return value || 'Not recorded';
}

function readableUnit(value) {
  return String(value || 'Needs staff confirmation').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase());
}

function sourceProvenance(source) {
  if (!source || typeof source !== 'object') return 'Supplier source retained';
  const parts = [];
  if (source.file_name) parts.push(source.file_name);
  if (source.page) parts.push('page ' + source.page);
  if (source.section) parts.push(source.section);
  return parts.length ? parts.join(' · ') : 'Supplier source retained';
}

function selectedInquiryId() {
  const parts = String(window.location.hash || '').slice(1).split('/');
  if ((parts[0] === 'inquiry' || parts[0] === 'case') && parts[1]) {
    const id = decodeURIComponent(parts[1]);
    sessionStorage.setItem('wmit.operations.selectedInquiryId', id);
    return id;
  }
  return sessionStorage.getItem('wmit.operations.selectedInquiryId') || null;
}

function selectedWorkspaceId(key) {
  return sessionStorage.getItem('wmit.operations.selected.' + key) || null;
}

function setWorkspaceId(key, value) {
  if (value) sessionStorage.setItem('wmit.operations.selected.' + key, value);
  else sessionStorage.removeItem('wmit.operations.selected.' + key);
}

function clearWorkspaceId(key) {
  setWorkspaceId(key, null);
}

function inquiryById(id) {
  return id ? latest('Inquiry', (item) => item.inquiry_id === id) : null;
}

function inquiryIdForQuotation(quotation) {
  if (!quotation) return null;
  if (quotation.inquiry_id) return quotation.inquiry_id;
  const option = latest('CommercialOption', (item) => item.commercial_option_id === quotation.commercial_option_id);
  return option && option.inquiry_id || null;
}

function inquiryIdForBooking(booking) {
  if (!booking) return null;
  if (booking.inquiry_id) return booking.inquiry_id;
  const quotation = latest('Quotation', (item) => item.quotation_id === booking.quotation_id);
  return inquiryIdForQuotation(quotation);
}

function recordsForInquiry(inquiry) {
  if (!inquiry) return { inquiry: null, inquiryId: null, client: null, options: [], option: null, tariff: null, quotation: null, quotationAcceptance: null, booking: null, bookingItem: null, bookingItems: [], supplierBooking: null, supplierBookings: [], payment: null, payable: null, supplierPayment: null, amendment: null, refund: null };
  const inquiryId = inquiry.inquiry_id;
  const options = list('CommercialOption', (item) => item.inquiry_id === inquiryId);
  const option = options.find((item) => item.selected === true || item.state === 'SELECTED') || options.slice(-1)[0] || null;
  const optionId = option && option.commercial_option_id;
  const tariff = option && option.tariff_source_id ? latest('TariffSource', (item) => item.tariff_source_id === option.tariff_source_id) : null;
  const quotation = latest('Quotation', (item) => (optionId && item.commercial_option_id === optionId) || item.inquiry_id === inquiryId);
  const quotationId = quotation && quotation.quotation_id;
  const quotationAcceptance = quotationId ? latest('QuotationAcceptance', (item) => item.quotation_id === quotationId && item.state === 'ACCEPTED') : null;
  const booking = latest('Booking', (item) => item.inquiry_id === inquiryId || (quotationId && item.quotation_id === quotationId));
  const bookingId = booking && booking.booking_id;
  const bookingItems = list('BookingItem', (item) => item.booking_id === bookingId);
  const selectedBookingItemId = selectedWorkspaceId('booking-item');
  const bookingItem = selectedBookingItemId ? latest('BookingItem', (item) => item.booking_id === bookingId && item.booking_item_id === selectedBookingItemId) : null;
  const supplierBookings = list('SupplierBooking', (item) => item.booking_id === bookingId);
  const supplierBooking = latest('SupplierBooking', (item) => item.booking_id === bookingId);
  const supplierBookingId = supplierBooking && supplierBooking.supplier_booking_id;
  const payment = latest('ClientPayment', (item) => item.booking_id === bookingId);
  const payable = latest('SupplierPayable', (item) => item.booking_id === bookingId || (supplierBookingId && item.supplier_booking_id === supplierBookingId));
  const payableId = payable && payable.supplier_payable_id;
  const supplierPayment = latest('SupplierPayment', (item) => (bookingId && item.booking_id === bookingId) || (payableId && item.supplier_payable_id === payableId));
  return {
    inquiry,
    inquiryId,
    client: latest('Client', (item) => item.client_id === inquiry.client_id),
    options,
    option,
    tariff,
    quotation,
    quotationAcceptance,
    booking,
    bookingItem,
    bookingItems,
    supplierBooking,
    supplierBookings,
    payment,
    payable,
    supplierPayment,
    amendment: latest('Amendment', (item) => item.booking_id === bookingId),
    refund: latest('RefundAdjustment', (item) => item.booking_id === bookingId)
  };
}

function caseRecords() {
  return recordsForInquiry(inquiryById(selectedInquiryId()));
}

function projectionForInquiry(inquiryId) {
  return ((state && state.caseProjections) || []).find((projection) => projection.identity && projection.identity.inquiryId === inquiryId) || null;
}

function projectionForCase(records) {
  return projectionForInquiry(records && records.inquiryId);
}

function currentTab() {
  const value = String(window.location.hash || '#dashboard').slice(1).split('/')[0];
  return ['dashboard', 'case', 'inquiry', 'clients', 'tariffs', 'quotation', 'booking', 'finance', 'monitoring', 'settings', 'suppliers', 'subagents', 'operations', 'departures'].includes(value) ? value : 'dashboard';
}

function clearCaseWorkspaceSelections() {
  ['quotation', 'booking', 'booking-item', 'departure'].forEach(clearWorkspaceId);
}

function openCase(inquiryId) {
  if (!inquiryId || !latest('Inquiry', (item) => item.inquiry_id === inquiryId)) return failLocal('That Inquiry is no longer available.');
  sessionStorage.setItem('wmit.operations.selectedInquiryId', inquiryId);
  clearCaseWorkspaceSelections();
  window.location.hash = 'case/' + encodeURIComponent(inquiryId);
}

function openCaseAt(tab, inquiryId) {
  if (inquiryId && latest('Inquiry', (item) => item.inquiry_id === inquiryId)) {
    sessionStorage.setItem('wmit.operations.selectedInquiryId', inquiryId);
    clearCaseWorkspaceSelections();
  }
  window.location.hash = tab || 'dashboard';
  render();
}

window.wmitSearchResults = function (query) {
  const q = String(query || '').toLowerCase();
  const matches = (value) => value !== undefined && value !== null && String(value).toLowerCase().includes(q);
  const results = [];
  list('Client').forEach((client) => {
    if (matches(client.display_name) || matches(client.legal_name) || matches(client.primary_phone) || matches(client.primary_email) || matches(client.client_id)) {
      results.push({ title: client.display_name || client.legal_name || client.client_id, subtitle: [client.primary_phone, client.primary_email, client.client_id].filter(Boolean).join(' · '), kind: 'Client', run: () => openClientRecord(client.client_id) });
    }
  });
  list('Inquiry').forEach((inquiry) => {
    const requirements = inquiry.current_requirements || {};
    const client = latest('Client', (item) => item.client_id === inquiry.client_id);
    if (matches(inquiry.inquiry_id) || matches(requirements.destination) || matches(client && client.display_name)) {
      results.push({ title: (client && client.display_name || 'Case') + ' · ' + (requirements.destination || 'Destination pending'), subtitle: inquiry.inquiry_id + (requirements.travel_start ? ' · from ' + requirements.travel_start : ''), kind: 'Case', run: () => openCase(inquiry.inquiry_id) });
    }
  });
  list('Quotation').forEach((quote) => {
    if (!quote.inquiry_id) return;
    const client = latest('Client', (item) => item.client_id === quote.client_id);
    if (matches(quote.quotation_id) || matches(quote.destination) || matches(client && client.display_name)) {
      results.push({ title: (client && client.display_name || 'Client') + ' · ' + (quote.destination || 'Quotation'), subtitle: quote.quotation_id + ' · ' + (quote.status || 'draft'), kind: 'Quotation', run: () => openCaseAt('quotation', quote.inquiry_id) });
    }
  });
  list('Booking').forEach((booking) => {
    const inquiryId = inquiryIdForBooking(booking);
    if (!inquiryId) return;
    if (matches(booking.booking_id) || matches(booking.status)) {
      results.push({ title: booking.booking_id, subtitle: [booking.status, booking.travel_start].filter(Boolean).join(' · '), kind: 'Booking', run: () => openCaseAt('booking', inquiryId) });
    }
  });
  list('Supplier').forEach((supplier) => {
    if (matches(supplier.display_name) || matches(supplier.legal_name) || matches(supplier.country) || matches(supplier.supplier_id)) {
      results.push({ title: supplier.display_name || supplier.legal_name || supplier.supplier_id, subtitle: [supplier.country, supplier.supplier_id].filter(Boolean).join(' · '), kind: 'Supplier', run: () => openSupplierRecord(supplier.supplier_id) });
    }
  });
  return results;
};

function dashboardQueuesMarkup() {
  const todayIso = new Date().toISOString().slice(0, 10);
  const weekAheadIso = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const rows = [];

  list('Quotation', (quote) => quote.status === 'DRAFT' && Number(quote.client_total) > 0).forEach((quote) => {
    const client = latest('Client', (item) => item.client_id === quote.client_id);
    rows.push({
      group: 'Quotes awaiting approval',
      label: ((client && client.display_name) || 'Client') + ' · ' + (quote.destination || 'Destination pending') + ' — ' + quote.client_total + ' ' + (quote.currency || ''),
      action: quote.inquiry_id ? "openCaseAt('quotation', '" + quote.inquiry_id + "')" : '',
      actionLabel: 'Review quote'
    });
  });

  ((state && state.caseProjections) || []).forEach((projection) => {
    const inquiryId = projection.identity && projection.identity.inquiryId;
    const finance = projection.finance || {};
    (finance.obligations || []).forEach((obligation) => {
      if (obligation.state === 'SATISFIED' || !obligation.dueAt) return;
      const due = String(obligation.dueAt).slice(0, 10);
      if (due > weekAheadIso) return;
      rows.push({
        group: due < todayIso ? 'Payments overdue' : 'Payments due within 7 days',
        label: (projection.clientName || 'Client') + ' — ' + obligation.outstanding + ' ' + (obligation.currency || '') + ' due ' + due + (obligation.purpose && obligation.purpose !== 'INSTALLMENT' ? ' (' + obligation.purpose.toLowerCase() + ')' : ''),
        action: inquiryId ? "openCaseAt('finance', '" + inquiryId + "')" : '',
        actionLabel: 'Open payments'
      });
    });
  });

  list('Task', (task) => task.state === 'OPEN' && task.due_at && String(task.due_at).slice(0, 10) < todayIso).forEach((task) => {
    const inquiryId = task.related_type === 'Inquiry' ? task.related_id : null;
    rows.push({
      group: 'Overdue follow-ups',
      label: task.title + ' — due ' + String(task.due_at).slice(0, 10),
      action: inquiryId ? "openCaseAt('operations', '" + inquiryId + "')" : "window.location.hash='operations'",
      actionLabel: 'Open'
    });
  });

  const leadsWithoutMobile = list('ExpoLead', (lead) => !lead.mobile);
  leadsWithoutMobile.slice(0, 5).forEach((lead) => {
    rows.push({
      group: 'Leads needing mobile',
      label: lead.name + (lead.destination ? ' · ' + lead.destination : '') + ' — no mobile number yet',
      action: "window.open('/expo-console.html#leads', '_blank', 'noopener')",
      actionLabel: 'Open Events console'
    });
  });
  if (leadsWithoutMobile.length > 5) {
    rows.push({ group: 'Leads needing mobile', label: '…and ' + (leadsWithoutMobile.length - 5) + ' more', action: "window.open('/expo-console.html#leads', '_blank', 'noopener')", actionLabel: 'Open Events console' });
  }

  if (!rows.length) return '<div class="card good"><h3>All clear</h3><p class="muted">Nothing needs your attention right now. New quotes, due payments, and follow-ups appear here.</p></div>';
  const groupOrder = ['Payments overdue', 'Quotes awaiting approval', 'Payments due within 7 days', 'Overdue follow-ups', 'Leads needing mobile'];
  const groups = groupOrder.map((name) => ({ name: name, rows: rows.filter((row) => row.group === name) })).filter((group) => group.rows.length);
  return '<div class="panel"><div class="panel-head"><div><h3>What needs you now</h3><p class="muted">Every row opens the case it belongs to.</p></div></div>' +
    groups.map((group) => '<div style="margin-bottom:12px"><div class="eyebrow">' + esc(group.name) + ' (' + group.rows.length + ')</div>' +
      group.rows.slice(0, 8).map((row) => '<div class="event" style="display:flex;justify-content:space-between;gap:10px;align-items:center"><span style="min-width:0;word-wrap:break-word">' + esc(row.label) + '</span>' +
        (row.action ? '<button class="secondary compact" style="flex:none" onclick="' + esc(row.action) + '">' + esc(row.actionLabel) + '</button>' : '') + '</div>').join('') +
      (group.rows.length > 8 ? '<p class="muted">…and ' + (group.rows.length - 8) + ' more</p>' : '') + '</div>').join('') +
    '</div>';
}

function openInquiries() {
  sessionStorage.removeItem('wmit.operations.selectedInquiryId');
  clearCaseWorkspaceSelections();
  if (currentTab() === 'inquiry') render();
  else window.location.hash = 'inquiry';
}

function openTariffLibrary() {
  window.location.hash = 'tariffs';
}

function activateWorkspaceTab() {
  const active = currentTab();
  document.querySelectorAll('.workspace-view').forEach((view) => view.classList.toggle('active', view.id === active));
  document.querySelectorAll('[data-tab]').forEach((link) => link.classList.toggle('active', link.dataset.tab === active));
}

function ensureClientsNavigation() {
  const nav = document.querySelector('.nav');
  if (nav && !nav.querySelector('[data-tab="clients"]')) nav.querySelector('[data-tab="inquiry"]') && nav.querySelector('[data-tab="inquiry"]').insertAdjacentHTML('afterend', '<a data-tab="clients" href="#clients">Clients</a>');
}

function actionLabel(action) {
  return ({
    createClient: 'Client created',
    updateClient: 'Client updated',
    createSupplier: 'Supplier created',
    createSupplierContact: 'Supplier contact saved',
    getClientInvoicePreview: 'Client invoice preview',
    getClientItineraryPreview: 'Client itinerary preview',
    createInquiry: 'Inquiry created',
    updateInquiry: 'Inquiry requirements updated',
    uploadTariff: 'Synthetic tariff uploaded',
    uploadSourceDocument: 'Supplier source uploaded',
    reviewTariff: 'Tariff review result',
  deleteTariff: 'Tariff deletion result',
    matchOptions: 'Matching options found',
    findMoreOptions: 'Additional options result',
    selectOption: 'Option selection result',
    createQuotation: 'Draft quotation created',
    updateQuotation: 'Quotation details saved',
    createQuotationItem: 'Quotation service added',
    updateQuotationItem: 'Quotation service updated',
    removeQuotationItem: 'Quotation service removed',
    reorderQuotationItems: 'Quotation service order updated',
    getClientQuotationPreview: 'Client quotation preview',
    updateQuotationPricing: 'Quotation pricing updated',
    approveQuotation: 'Quotation approval result',
    cancelQuotationApproval: 'Quotation approval cancellation result',
    acceptQuotation: 'Client quotation acceptance recorded',
    createAvailabilityHold: 'Availability hold recorded',
    recordTicketing: 'Ticketing state recorded',
    issueVoucher: 'Voucher issued',
    createPaymentScheduleItem: 'Payment schedule item recorded',
    createRoomingListEntry: 'Rooming list entry recorded',
    acceptAmendment: 'Amendment acceptance recorded',
    reconcileBooking: 'Booking reconciliation reviewed',
    createDepartureReadinessIssue: 'Departure readiness issue recorded',
    updateDepartureReadinessIssue: 'Departure readiness issue updated',
    createBooking: 'Booking record created',
    confirmCommitment: 'Client commitment result',
    createSupplierBooking: 'Supplier reservation result',
    confirmSupplierBookingItem: 'Service confirmation result',
    updateSettings: 'Settings saved',
    createSupplierPayable: 'Supplier Payable created',
    approveSupplierPayable: 'Supplier Payable approval result',
    executeSupplierPayment: 'Supplier Payment result',
    recordClientPayment: 'Payment recorded',
    verifyClientPayment: 'Payment verification result',
    allocatePayment: 'Payment allocation result',
    amendBooking: 'Booking amendment result',
    requestRefund: 'Refund draft created',
    executeRefund: 'Refund execution result',
    createDocument: 'Supporting document recorded',
    createTask: 'Task created',
    updateTask: 'Task updated',
    createCommunication: 'Communication logged',
    createSubAgent: 'Sub-agent created',
    updateSubAgent: 'Sub-agent updated',
    addDepartureMembership: 'Departure link result',
    resetSyntheticTestCase: 'Synthetic case reset'
  }[action] || action);
}

function findRecordId(value) {
  if (!value || typeof value !== 'object') return null;
  const keys = Object.keys(value);
  for (const key of keys) if (/_id$/.test(key) && value[key]) return value[key];
  for (const key of keys) {
    const nested = findRecordId(value[key]);
    if (nested) return nested;
  }
  return null;
}

function actionDetail(action, data) {
  const id = findRecordId(data);
  if (action === 'createInquiry') return 'Inquiry ' + (id || 'recorded') + ' captured. No Booking or client commitment was created.';
  if (action === 'uploadSourceDocument') return 'Original supplier source retained for review. Extraction is not trusted until staff review.';
  if (action === 'reviewTariff') return data && data.trusted ? 'Tariff is now trusted and available for requirements-first matching.' : 'Tariff remains in review and cannot be used as trusted pricing.';
  if (action === 'matchOptions' || action === 'findMoreOptions') return ((data && data.candidates) || []).length + ' candidate option(s) returned. No supplier or option was selected automatically.';
  if (action === 'selectOption') return 'One active option is selected. Review downstream quotation or amendment consequences before continuing.';
  if (action === 'createQuotation') return 'Draft quotation created. Pricing review and approval are still required.';
  if (action === 'cancelQuotationApproval') return 'Quotation approval was cancelled. The quotation is back in draft review.';
  if (action === 'acceptQuotation') return 'Client acceptance recorded. The quotation is now eligible to create a Booking.';
  if (action === 'createBooking') return 'Booking record created. Client commitment remains a separate state.';
  if (action === 'createSupplierBooking') return 'Supplier reservation/request recorded. Supplier Payment remains a separate gate.';
  if (action === 'recordClientPayment') return 'Payment evidence recorded. Verification is still pending.';
  if (action === 'verifyClientPayment') return 'Payment verification state was updated by the authorized local actor.';
  if (action === 'allocatePayment') return 'The client-directed allocation was recorded exactly as entered.';
  if (action === 'executeSupplierPayment') return data && data.supplier_payment_id ? 'Supplier Payment executed for ' + data.amount + ' ' + data.currency + '.' : 'Supplier Payment was not executed.';
  if (action === 'requestRefund') return 'Refund/adjustment request is a draft and still requires authorization.';
  if (action === 'executeRefund') return 'Refund/adjustment execution was recorded by the authorized local actor.';
  if (action === 'resetSyntheticTestCase') return 'Only local synthetic Phase 1 state was reset.';
  return (id ? 'Record ' + id + ' was updated.' : 'The operation returned an updated state. Review the affected workspace below.');
}

function showMessage(title, detail, kind) {
  detail = humanizeError({ message: detail }, null);
  if (window.wmitToast) {
    window.wmitToast(kind || 'ok', title || '', detail || '');
    const container = document.getElementById('wmit-toast-container');
    if (container && container.lastChild && typeof container.lastChild.focus === 'function') {
      try { container.lastChild.focus({ preventScroll: true }); } catch (_) { /* focus is best-effort; the toast is announced by aria-live */ }
    }
    return;
  }
  const message = $('message');
  if (message) {
    message.className = 'message show ' + (kind || 'ok');
    message.textContent = title + '\n' + detail;
    if (messageTimer) clearTimeout(messageTimer);
    messageTimer = kind === 'error' ? null : setTimeout(() => { message.className = 'message'; }, 4500);
  }
}

async function refreshState(options) {
  quotationPreview = null;
  const response = await wmitGuard401(await fetch('/api/phase1/state', Object.assign({ cache: 'no-store' }, { headers: wmitAuthHeaders() })));
  const result = await response.json();
  if (!result.ok) throw new Error(result.error && result.error.message || 'The Phase 1 state could not be loaded.');
  state = result.data;
  render();
  return state;
}

async function refreshWorkspace() {
  try {
    await refreshState();
    showMessage('✓ Workspace refreshed', 'Current records were reloaded from the server.', 'ok');
  } catch (error) {
    showMessage('✕ Workspace unavailable', error.message || 'The workspace state could not be loaded.', 'error');
  }
}

function focusMessage() {
  const message = $('message');
  if (message) message.focus();
}

let autoFieldLabelId = 0;

function ensureAccessibleLabels() {
  document.querySelectorAll('.field > label:not([for])').forEach((label) => {
    if (label.querySelector('input, select, textarea')) return;
    const field = label.parentElement;
    if (!field) return;
    const unnamed = Array.from(field.querySelectorAll('input, select, textarea')).filter((control) => !control.closest('label') && !control.getAttribute('aria-label') && !control.getAttribute('aria-labelledby'));
    if (unnamed.length !== 1) return;
    const control = unnamed[0];
    if (!control.id) control.id = 'wmit-auto-field-' + (++autoFieldLabelId);
    label.htmlFor = control.id;
  });
  document.querySelectorAll('thead th:not([scope])').forEach((th) => { th.setAttribute('scope', 'col'); });
  document.querySelectorAll('tbody th:not([scope])').forEach((th) => { th.setAttribute('scope', 'row'); });
  document.querySelectorAll('.table-wrap').forEach((wrap) => { wrap.tabIndex = 0; });
}

async function syncAutomaticTasks() {
  if (automaticTaskSyncing) return;
  automaticTaskSyncing = true;
  try {
    const response = await wmitGuard401(await fetch('/api/phase1/action', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, wmitAuthHeaders()), body: JSON.stringify({ action: 'ensureAutomaticFollowUpTasks', input: {}, actor: 'LOCAL_STAFF' }) }));
    const result = await response.json();
    if (result.ok && result.data && result.data.created_count) await refreshState({ skipAutomaticTasks: true });
  } finally {
    automaticTaskSyncing = false;
  }
}

async function api(action, input, actor) {
  const trigger = document.activeElement && document.activeElement.tagName === 'BUTTON' ? document.activeElement : null;
  if (trigger) trigger.disabled = true;
  try {
    const response = await wmitGuard401(await fetch('/api/phase1/action', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, wmitAuthHeaders()), body: JSON.stringify({ action, input: input || {}, actor: actor || 'LOCAL_STAFF' }) }));
    const result = await response.json();
    if (!result.ok) {
      await refreshState();
      const errorCode = result.error && result.error.code;
      const errorMessage = result.error && result.error.message || 'The operation was blocked.';
      const target = requiredFieldCandidates(errorMessage).find((candidate) => $(candidate));
      if (target) focusRequiredField(target); else focusMessage();
      const friendly = errorCode === 'AUTHORIZATION_REQUIRED'
        ? 'Not executed: this action needs manager authority. Sign in (top right) with a manager/admin account — ' + errorMessage
        : errorMessage;
      showMessage('✕ ' + actionLabel(action) + ' — NOT EXECUTED', friendly, 'error');
      return null;
    }
    await refreshState();
    showMessage('✓ ' + actionLabel(action), actionDetail(action, result.data), 'ok');
    return result.data;
  } catch (error) {
    showMessage('✕ ' + actionLabel(action) + ' — NOT EXECUTED', error.message || 'The local API could not be reached.', 'error');
    return null;
  } finally {
    if (trigger) trigger.disabled = false;
  }
}

function requiredFieldCandidates(message) {
  const text = String(message || '').toLowerCase();
  if (text.includes('destination')) return ['inq-destination', 'edit-inq-destination', 'quote-destination'];
  if (text.includes('travel start') || text.includes('specific travel date') || text.includes('travel timing')) return ['inq-start', 'edit-inq-start', 'quote-travel-start'];
  if (text.includes('travel end')) return ['inq-end', 'edit-inq-end', 'quote-travel-end'];
  if (text.includes('trip days')) return ['inq-duration-days', 'edit-inq-duration-days'];
  if (text.includes('client name') || text.includes('client or organization')) return ['client-name', 'client-edit-name', 'inq-client'];
  if (text.includes('lead passenger')) return ['booking-lead-pax'];
  if (text.includes('obligation amount')) return ['new-obligation-amount'];
  if (text.includes('due date') || text.includes('due_at')) return ['new-obligation-due', 'schedule-due', 'global-task-due'];
  if (text.includes('schedule amount')) return ['schedule-amount'];
  if (text.includes('payment sent')) return ['payment-sent-at'];
  if (text.includes('proof reference') || text.includes('proof file')) return ['payment-proof', 'payment-proof-file'];
  if (text.includes('payment amount') || text.includes('recording another client payment')) return ['payment-amount'];
  if (text.includes('client allocation') || text.includes('instructed amount')) return ['allocation-amount'];
  if (text.includes('select the client obligation')) return ['allocation-obligation'];
  if (text.includes('supplier payable amount')) return ['payable-amount'];
  if (text.includes('hold expiry')) return ['hold-expires'];
  if (text.includes('pnr') || text.includes('locator')) return ['ticketing-pnr'];
  if (text.includes('ticket number')) return ['ticketing-number'];
  if (text.includes('voucher number')) return ['voucher-number'];
  if (text.includes('room/cabin') || text.includes('room allocation') || text.includes('rooming group')) return ['monitoring-rooming-group', 'rooming-group'];
  if (text.includes('amendment reason')) return ['amend-reason'];
  if (text.includes('refund amount')) return ['refund-amount'];
  if (text.includes('terms/reason')) return ['refund-reason'];
  if (text.includes('person name')) return ['participant-name'];
  if (text.includes('follow-up or deadline description')) return ['global-task-description'];
  if (text.includes('communication')) return ['communication-client'];
  if (text.includes('outcome or notes')) return ['communication-outcome', 'communication-notes'];
  if (text.includes('supporting document')) return ['supporting-document-file'];
  if (text.includes('departure readiness')) return ['departure-issue-description'];
  return [];
}

function focusRequiredField(fieldId) {
  let element = typeof fieldId === 'string' ? $(fieldId) : fieldId;
  if (!element && typeof fieldId === 'string' && fieldId === 'service-supplier') element = document.querySelector('[id^="service-supplier-"]');
  if (!element) return false;
  const wrapper = element.closest('.field') || element.closest('.service-supplier-control') || element.parentElement;
  if (wrapper) wrapper.classList.add('required-attention');
  element.classList.add('required-attention');
  element.setAttribute('aria-invalid', 'true');
  const clear = () => {
    if (wrapper) wrapper.classList.remove('required-attention');
    element.classList.remove('required-attention');
    element.removeAttribute('aria-invalid');
  };
  element.addEventListener('input', clear, { once: true });
  element.addEventListener('change', clear, { once: true });
  try { element.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (error) { element.scrollIntoView(); }
  try { element.focus({ preventScroll: true }); } catch (error) { element.focus(); }
  return true;
}

function failLocal(message, fieldId) {
  const target = fieldId || requiredFieldCandidates(message).find((candidate) => $(candidate)) || (String(message || '').toLowerCase().includes('supplier') ? 'service-supplier' : null);
  if (target) focusRequiredField(target);
  showMessage('✕ NOT EXECUTED', message, 'error');
  return null;
}

function nextAction(records) {
  const projection = projectionForCase(records);
  return projection && projection.nextAction ? projection.nextAction.label : records && records.inquiry ? 'Review case projection' : 'Create or select an Inquiry';
}

function humanizeError(error, action) {
  const raw = error && error.message !== undefined ? error.message : error;
  let message = typeof raw === 'string' ? raw : raw && typeof raw === 'object' ? (raw.message || raw.code || JSON.stringify(raw)) : String(raw || 'The operation was blocked.');
  message = message.replace(/\[object Object\]/g, 'the related record');
  if (/not found/i.test(message)) return message + ' No data was changed. Reopen the case and try again.';
  if (action === 'executeSupplierPayment' && /blocked|insufficient|approved|supplier/i.test(message)) return 'Supplier payment was not executed. ' + message + ' No money was moved.';
  return message;
}

function nextActionTarget(code) {
  const targets = { PREPARE_OPTIONS: 'inquiry', SELECT_OPTION: 'inquiry', PREPARE_QUOTATION: 'quotation', REQUEST_CLIENT_DECISION: 'quotation', CREATE_BOOKING: 'booking', CONFIRM_CLIENT_COMMITMENT: 'booking', REQUEST_SUPPLIER_RESERVATION: 'booking', VERIFY_PAYMENT: 'finance', ALLOCATE_PAYMENT: 'finance', REVIEW_EXCESS_FUNDS: 'finance', CREATE_PAYMENT_OBLIGATIONS: 'finance', COLLECT_CLIENT_BALANCE: 'finance', APPROVE_SUPPLIER_PAYABLE: 'finance', FUND_SUPPLIER_PAYMENT: 'finance', EXECUTE_SUPPLIER_PAYMENT: 'finance', COMPLETE_DOCUMENTS: 'operations', COMPLETE_TASKS: 'operations', RESOLVE_EXCEPTION: 'operations', PREPARE_FOR_DEPARTURE: 'operations', MONITOR_DEPARTURE: 'booking', CASE_COMPLETE: 'operations' };
  return targets[code] || 'inquiry';
}

function openNextAction(code) {
  const records = caseRecords();
  const target = nextActionTarget(code);
  if (records.inquiry) sessionStorage.setItem('wmit.operations.selectedInquiryId', records.inquiry.inquiry_id);
  clearWorkspaceId('booking-item');
  if (target === 'quotation' && records.quotation) setWorkspaceId('quotation', records.quotation.quotation_id);
  if ((target === 'booking' || target === 'finance') && records.booking) setWorkspaceId('booking', records.booking.booking_id);
  if (target === 'finance' && records.booking) window.location.hash = 'finance';
  else if (target === 'booking' && records.booking) window.location.hash = 'booking';
  else if (target === 'quotation' && records.quotation) window.location.hash = 'quotation';
  else window.location.hash = target;
}

function caseCommandMarkup(records, projection) {
  if (!records || !records.inquiry || !projection) return '';
  const blockers = projection.blockers || [];
  const next = projection.nextAction || {};
  const deadline = (projection.deadlines || []).find((item) => item.overdue) || (projection.deadlines || [])[0];
  const stateLine = [projection.commercial && projection.commercial.quotationState, projection.supplierFulfillment && projection.supplierFulfillment.state, projection.finance && projection.finance.state, projection.readiness && projection.readiness.state].filter(Boolean).join(' → ');
  const blockerMarkup = blockers.length ? '<ul>' + blockers.slice(0, 4).map((item) => '<li>' + esc(item.message) + '</li>').join('') + '</ul>' : '<p class="muted">No current blockers.</p>';
  const services = Array.isArray(projection.services) ? projection.services : [];
  const serviceSummary = services.length ? '<div class="case-command-services"><b>Services</b><div class="table-wrap"><table><thead><tr><th>Service</th><th>Supplier fulfillment</th><th>Readiness</th></tr></thead><tbody>' + services.map((service) => '<tr><td>' + esc(service.description) + '</td><td>' + esc(readableState(service.fulfillment && service.fulfillment.state)) + '</td><td>' + status(readableState(service.readiness && service.readiness.state), service.readiness && service.readiness.state === 'READY' ? 'good' : 'warn') + '</td></tr>').join('') + '</tbody></table></div></div>' : '';
  return '<div class="case-command"><div class="case-command-main"><div class="eyebrow">Case command center</div><div class="case-command-state">' + esc(stateLine || projection.currentStage) + '</div><div class="case-command-next"><span>NEXT ACTION</span><strong>' + esc(next.label || 'Review case') + '</strong><p>' + esc(next.reason || '') + '</p><button onclick="openNextAction(\'' + esc(next.code || '') + '\')">Open</button></div></div><div class="case-command-side"><div><b>Blockers</b>' + blockerMarkup + '</div>' + (deadline ? '<div class="case-deadline"><b>Next deadline</b><br>' + esc(deadline.label) + '<br>' + esc(deadline.at) + (deadline.overdue ? ' · OVERDUE' : '') + '</div>' : '') + '<div class="muted">Responsible: ' + esc(projection.responsibleActor && (projection.responsibleActor.actorId || projection.responsibleActor.role) || 'Derived from case state') + '</div></div>' + serviceSummary + '</div>';
}

function renderHeader() {
  const globalTabs = ['dashboard', 'clients', 'finance', 'monitoring', 'booking', 'tariffs', 'suppliers', 'subagents', 'operations', 'departures'];
  const records = caseRecords();
  const target = $('case-header');
  if (!target) return;
  if (globalTabs.includes(currentTab())) {
    target.hidden = true;
    target.innerHTML = '';
    return;
  }
  target.hidden = false;
  if (!records.inquiry) {
    target.innerHTML = '<div><div class="eyebrow">No case selected · LOCAL SYNTHETIC TEST DATA</div><h2>Select an Inquiry to begin</h2><div class="case-meta"><span>Dashboard and Inquiries show available cases.</span></div></div><div class="card warn"><b>Next action</b><div>Open Inquiries and create or select a case.</div></div>';
    return;
  }
  const requirements = records.inquiry.current_requirements || {};
  const projection = projectionForCase(records);
  const next = projection && projection.nextAction && projection.nextAction.label || nextAction(records);
  target.innerHTML = '<div><div class="eyebrow">Current case · LOCAL SYNTHETIC TEST DATA</div><h2>' + esc((records.client && records.client.display_name) || 'Client') + ' · ' + esc(requirements.destination || 'Destination pending') + '</h2><div class="case-meta"><span>' + esc(requirements.travel_start || requirements.travel_month || requirements.travel_year || 'Travel timing not recorded') + (requirements.travel_end ? ' – ' + esc(requirements.travel_end) : '') + '</span><span>' + esc(requirements.pax_count || '—') + ' travelers</span><span>Inquiry ' + esc(records.inquiry.inquiry_id) + '</span></div><p class="muted">Current next action: <b>' + esc(next) + '</b></p></div><div class="card warn"><b>Next action</b><div>' + esc(next) + '</div><div class="row-actions"><button class="secondary" onclick="openInquiries()">Switch Inquiry</button>' + (records.client && records.client.primary_phone ? '<button class="secondary" onclick="openClientMessageComposer()">Message client</button>' : '') + '</div></div>';
}

function openClientMessageComposer() {
  const records = caseRecords();
  const client = records.client;
  if (!client || !client.primary_phone) return showMessage('✕ Message client — NOT EXECUTED', 'This client has no phone number recorded.', 'error');
  const requirements = (records.inquiry && records.inquiry.current_requirements) || {};
  const booking = records.booking;
  const quotation = records.quotation;
  const obligations = booking ? list('ClientObligation', (obligation) => obligation.booking_id === booking.booking_id) : [];
  const name = String(client.display_name || '');
  const byDue = obligations.slice().filter((obligation) => obligation.due_at).sort((a, b) => String(a.due_at).localeCompare(String(b.due_at)));
  const depositObligation = obligations.find((obligation) => String(obligation.purpose || '').toUpperCase() === 'DOWN_PAYMENT') || byDue[0] || obligations[0];
  const balanceObligation = obligations.find((obligation) => String(obligation.purpose || '').toUpperCase() === 'FINAL_BALANCE') || byDue[byDue.length - 1] || obligations[obligations.length - 1];
  const nextDue = byDue.find((obligation) => obligation.state !== 'SATISFIED') || byDue[0];
  window.wmitOpenMessageComposer({
    title: 'Message ' + (name.split(/\s+/)[0] || 'client'),
    mobile: client.primary_phone,
    context: {
      name: name,
      first_name: name.split(/\s+/)[0] || name,
      destination: requirements.destination || (quotation && quotation.destination) || '',
      travel_month: requirements.travel_month || '',
      booking_id: booking ? booking.booking_id : '',
      deposit: depositObligation ? depositObligation.amount + ' ' + (depositObligation.currency || 'PHP') : '',
      balance: balanceObligation ? balanceObligation.amount + ' ' + (balanceObligation.currency || 'PHP') : '',
      due_date: nextDue ? String(nextDue.due_at).slice(0, 10) : '',
      valid_until: quotation ? quotation.valid_until : '',
      consultant: 'your Worldmaster consultant'
    },
    templates: window.wmitMessageTemplates(state && state.configuration && state.configuration.messageTemplates)
  });
}

const BLOCKER_ACTIONS = {
  BOOKING_REQUIRED: ['Create the Booking', 'quotation'],
  CLIENT_BALANCE_OUTSTANDING: ['Collect the outstanding client balance', 'finance'],
  CLIENT_COMMITMENT_PENDING: ['Confirm the client\u2019s commitment', 'booking'],
  CLIENT_DECISION_REQUIRED: ['Get the client\u2019s decision on the quotation', 'quotation'],
  DOCUMENT_MISSING: ['Obtain the missing document(s)', 'operations'],
  OPTION_SELECTION_REQUIRED: ['Select one Commercial Option for this trip', 'inquiry'],
  OPTIONS_MISSING: ['Prepare commercial options from supplier tariffs', 'tariffs'],
  PAYMENT_ALLOCATION_PENDING: ['Allocate the received payment to obligations', 'finance'],
  PAYMENT_OBLIGATIONS_MISSING: ['Create the payment schedule (deposit + balance)', 'finance'],
  PAYMENT_VERIFICATION_PENDING: ['Verify the client payment evidence', 'finance'],
  REQUIREMENT_MISSING: ['Complete the missing trip requirements', 'inquiry'],
  SUPPLIER_FULFILLMENT_PENDING: ['Confirm the outstanding supplier reservation(s)', 'booking'],
  SUPPLIER_PAYABLE_NOT_APPROVED: ['Approve the supplier payable', 'finance'],
  SUPPLIER_PAYMENT_FUNDS_INSUFFICIENT: ['Verified client funds do not cover the supplier payment yet', 'finance'],
  TASK_OUTSTANDING: ['Complete the outstanding follow-up task(s)', 'operations']
};

function caseChecklistMarkup(records, projection) {
  const next = projection && projection.nextAction;
  const blockers = (projection && projection.blockers || []);
  const seen = new Set();
  const items = [];
  if (next && next.label) {
    items.push({ text: next.label + (next.reason ? ' — ' + next.reason : ''), tab: null, primary: true });
    if (next.code) seen.add(next.code);
  }
  blockers.forEach((blocker) => {
    const code = typeof blocker === 'string' ? blocker : blocker && blocker.code;
    if (!code || seen.has(code)) return;
    seen.add(code);
    const mapped = BLOCKER_ACTIONS[code];
    const text = mapped ? mapped[0] : code.replace(/_/g, ' ').toLowerCase();
    if (mapped && mapped[1]) items.push({ text: text, tab: mapped[1] });
    else items.push({ text: text, tab: null });
  });
  if (!items.length) return '<div class="card good"><h3>Nothing pending</h3><p class="muted">No next action or blockers were derived for this case.</p></div>';
  return '<div class="card" id="case-checklist"><h3>Next steps</h3>' + items.map((item) =>
    '<div class="event" style="display:flex;justify-content:space-between;gap:10px;align-items:center' + (item.primary ? ';border-left:4px solid var(--manifest-green,#177245)' : '') + '">' +
    '<span style="min-width:0">' + (item.primary ? '<b>Next action: </b>' : '') + esc(item.text) + '</span>' +
    (item.tab ? '<button class="secondary compact" style="flex:none" onclick="window.location.hash=\'' + item.tab + '\'">' + esc(item.tab === 'operations' ? 'Follow-ups' : item.tab.charAt(0).toUpperCase() + item.tab.slice(1)) + '</button>' : '') +
    '</div>').join('') + '</div>';
}

function caseJumpBar(records) {
  const inquiryId = records.inquiryId;
  const buttons = [['inquiry', 'Requirements'], ['quotation', 'Quotation'], ['booking', 'Booking'], ['finance', 'Payments'], ['operations', 'Documents &amp; follow-ups']];
  return '<div class="row-actions" style="flex-wrap:wrap">' + buttons.map(([tab, label]) =>
    '<button class="secondary compact" onclick="openCaseAt(\'' + tab + '\', \'' + esc(inquiryId) + '\')">' + label + '</button>').join('') + '</div>';
}

function renderCaseWorkspace() {
  const target = $('case-workspace-content');
  if (!target) return;
  const records = caseRecords();
  if (!records.inquiry) {
    target.innerHTML = '<div class="empty">No case selected. Open a case from the Dashboard queues, search, or the Inquiries tab.</div>';
    return;
  }
  const requirements = records.inquiry.current_requirements || {};
  const projection = projectionForCase(records);
  const finance = (projection && projection.finance) || {};
  const booking = records.booking;
  const bookingId = booking && booking.booking_id;
  const quotations = list('Quotation', (quote) => quote.inquiry_id === records.inquiryId);
  const participants = bookingId ? list('BookingParticipant', (participant) => participant.booking_id === bookingId) : [];
  const tasks = list('Task', (task) => task.related_type === 'Inquiry' && task.related_id === records.inquiryId);
  const documents = list('Document', (document) => documentRelated(document, records));

  const summaryCard =
    '<div class="card"><div class="panel-head"><div><h3>' + esc((records.client && records.client.display_name) || 'Client') + ' · ' + esc(requirements.destination || 'Destination pending') + '</h3>' +
    '<p class="muted">' + esc(requirements.travel_start || requirements.travel_month || requirements.travel_year || 'Travel timing not recorded') + (requirements.travel_end ? ' – ' + esc(requirements.travel_end) : '') + ' · ' + esc(requirements.pax_count || travelerCompositionLabel(requirements)) + '</p></div>' +
    status(projection && projection.currentStage || 'NOT_PROJECTED', records.booking ? 'good' : 'info') + '</div>' +
    '<div class="case-meta">' +
    '<span>Inquiry ' + esc(records.inquiry.inquiry_id) + '</span>' +
    (records.quotation ? '<span>Quote ' + esc(records.quotation.quotation_id) + ' · ' + esc(records.quotation.status || '') + '</span>' : '<span>No quotation yet</span>') +
    (bookingId ? '<span>Booking ' + esc(bookingId) + '</span>' : '') +
    (records.client && records.client.primary_phone ? '<span>' + esc(records.client.primary_phone) + '</span>' : '') +
    '</div>' +
    '<div style="margin-top:10px">' + caseJumpBar(records) + '</div></div>';

  const quotesCard =
    '<div class="card"><h3>Quotations (' + quotations.length + ')</h3>' +
    (quotations.length ? '<div class="table-wrap"><table><thead><tr><th>Quote</th><th>Status</th><th>Client total</th><th>Valid until</th><th></th></tr></thead><tbody>' +
      quotations.map((quote) => '<tr><td>' + esc(quote.quotation_id) + '</td><td>' + status(quote.status || 'DRAFT', quote.status === 'APPROVED' ? 'good' : '') + '</td><td>' + esc(quote.client_total || '—') + ' ' + esc(quote.currency || '') + '</td><td>' + esc(quote.valid_until || '—') + '</td><td><button class="secondary compact" onclick="openCaseAt(\'quotation\', \'' + esc(records.inquiryId) + '\')">Open</button></td></tr>').join('') +
      '</tbody></table></div>' : '<p class="muted">No quotation yet for this case.</p>') + '</div>';

  const bookingCard =
    '<div class="card"><h3>Booking &amp; travelers</h3>' +
    (booking
      ? field('Booking status', booking.status) + field('Travel dates', [booking.travel_start, booking.travel_end].filter(Boolean).join(' – ') || 'Not recorded') + field('Lead pax', participants.map((participant) => participant.full_name || participant.name).filter(Boolean).join(', ') || booking.lead_pax_person_id || 'Not recorded') +
        (participants.length ? '<details class="secondary-details"><summary>Participants (' + participants.length + ')</summary>' + participants.map((participant) => '<div class="event"><strong>' + esc(participant.full_name || participant.name || 'Participant') + '</strong>' + (participant.participant_type ? ' · ' + esc(participant.participant_type) : '') + '</div>').join('') + '</details>' : '')
      : '<p class="muted">No booking yet — the quotation must be accepted first.</p>') + '</div>';

  const obligations = finance.obligations || [];
  const paymentsCard =
    '<div class="card"><h3>Payments</h3>' +
    (booking
      ? (obligations.length
          ? '<div class="table-wrap"><table><thead><tr><th>Purpose</th><th>Amount</th><th>Outstanding</th><th>Due</th><th>State</th></tr></thead><tbody>' +
            obligations.map((obligation) => '<tr><td>' + esc((obligation.purpose || 'INSTALLMENT').replace(/_/g, ' ').toLowerCase()) + '</td><td>' + esc(obligation.amount) + ' ' + esc(obligation.currency || '') + '</td><td>' + esc(obligation.outstanding) + '</td><td>' + esc(obligation.dueAt ? String(obligation.dueAt).slice(0, 10) : '—') + '</td><td>' + status(readableState(obligation.state), obligation.state === 'SATISFIED' ? 'good' : 'warn') + '</td></tr>').join('') +
            '</tbody></table></div>'
          : '<p class="muted">No payment obligations recorded yet.</p>') +
        '<div class="case-meta" style="margin-top:8px"><span>Obligation total: ' + esc(finance.obligationTotal || '0.00') + '</span><span>Verified received: ' + esc(finance.verifiedReceived || '0.00') + '</span></div>'
      : '<p class="muted">Payments start after the booking exists.</p>') + '</div>';

  const supplierCard =
    '<div class="card"><h3>Supplier fulfillment</h3>' +
    (records.supplierBookings.length
      ? records.supplierBookings.map((supplierBooking) => {
          const supplier = latest('Supplier', (item) => item.supplier_id === supplierBooking.supplier_id);
          return '<div class="event"><strong>' + esc((supplier && (supplier.display_name || supplier.legal_name)) || supplierBooking.supplier_id || 'Supplier') + '</strong> · ' +
            status(readableState(supplierBooking.reservation_state || 'PENDING'), supplierBooking.reservation_state === 'CONFIRMED' ? 'good' : 'warn') +
            (supplierBooking.fulfillment_state ? ' · ' + status(readableState(supplierBooking.fulfillment_state)) : '') + '</div>';
        }).join('')
      : '<p class="muted">No supplier reservations yet for this booking.</p>') + '</div>';

  const docsCard =
    '<div class="card"><h3>Documents &amp; follow-ups</h3>' +
    (documents.length ? documents.map((document) => '<div class="event">' + esc(document.file_name || document.document_type || 'Document') + '</div>').join('') : '<p class="muted">No documents linked to this case.</p>') +
    (tasks.length ? '<div style="margin-top:8px"><b>Tasks</b>' + tasks.map((task) => '<div class="event">' + esc(task.title) + (task.due_at ? ' · due ' + esc(String(task.due_at).slice(0, 10)) : '') + ' · ' + status(readableState(task.state), task.state === 'COMPLETED' ? 'good' : task.state === 'OPEN' ? 'warn' : '') + '</div>').join('') + '</div>' : '') +
    '</div>';

  target.innerHTML =
    summaryCard +
    caseChecklistMarkup(records, projection) +
    '<div class="grid2">' + quotesCard + bookingCard + paymentsCard + supplierCard + '</div>' +
    docsCard;
}

function renderDashboard() {
  const selected = caseRecords();
  const inquiries = list('Inquiry');
  const rows = inquiries.map((inquiry) => {
    const records = recordsForInquiry(inquiry);
    const projection = projectionForInquiry(inquiry.inquiry_id);
    const requirements = inquiry.current_requirements || {};
    const lifecycle = projection && projection.currentStage || 'NOT_PROJECTED';
    return '<tr><td><strong>' + esc(records.client && records.client.display_name || 'Client') + '</strong></td><td>' + esc(requirements.destination || 'Not recorded') + '</td><td>' + esc(requirements.travel_start || requirements.travel_month || requirements.travel_year || 'Not recorded') + '</td><td>' + status(lifecycle, records.booking ? 'good' : 'info') + '</td><td>' + esc(nextAction(records)) + '</td><td><button class="secondary" onclick="openCase(\'' + esc(inquiry.inquiry_id) + '\')">Open case</button></td></tr>';
  }).join('');
  $('dashboard-content').innerHTML = dashboardQueuesMarkup() + '<div class="grid3"><div class="card"><h3>Open inquiries</h3><div class="money">' + inquiries.length + '</div><p class="muted">Select the client case you want to operate.</p></div><div class="card"><h3>Tariffs needing review</h3><div class="money">' + list('TariffSource', (item) => !item.trusted).length + '</div><p class="muted">Untrusted extraction cannot be used for client pricing.</p></div><div class="card"><h3>Follow-ups</h3><div class="money">' + list('Task', (item) => !['COMPLETED', 'CANCELLED'].includes(item.state)).length + '</div><p class="muted">Open tasks and deadlines.</p></div></div><div class="panel"><div class="panel-head"><div><h3>Inquiry work queue</h3><p class="muted">Nothing is silently selected as the current case.</p></div><button onclick="openInquiries()">Create or view Inquiries</button></div>' + (rows ? '<div class="table-wrap"><table><thead><tr><th>Client</th><th>Destination</th><th>Travel start</th><th>Inquiry state</th><th>Next action</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="empty">No Inquiry cases yet. Open Inquiries to create the first case.</div>') + '</div>' + (selected.inquiry ? '<div class="card good"><h3>Selected case</h3><p>' + esc(selected.client && selected.client.display_name || 'Client') + ' · ' + esc(selected.inquiry.current_requirements && selected.inquiry.current_requirements.destination || 'Destination not recorded') + '</p><button class="secondary" onclick="window.location.hash=\'inquiry\'">Open selected Inquiry</button></div>' : '<div class="card warn"><h3>No case selected</h3><p>Select a case before opening case-specific quotation, Booking, or finance workspaces.</p></div>');
}

function inquiryForBooking(booking) {
  const inquiryId = inquiryIdForBooking(booking);
  return latest('Inquiry', (inquiry) => inquiry.inquiry_id === inquiryId);
}

function bookingRequirements(booking) {
  const inquiry = inquiryForBooking(booking);
  return (inquiry && inquiry.current_requirements) || {};
}

function bookingTravelLabel(booking) {
  const requirements = bookingRequirements(booking);
  return inquiryTravelLabel({ travel_start: booking.travel_start || requirements.travel_start || requirements.travel_month || requirements.travel_year, travel_end: booking.travel_end || requirements.travel_end });
}

function bookingDestination(booking) {
  const requirements = bookingRequirements(booking);
  return booking.destination || requirements.destination || 'Not recorded';
}

function clientHistoryMarkup(client) {
  if (!client) return '';
  const inquiries = list('Inquiry', (item) => item.client_id === client.client_id);
  const bookings = list('Booking', (item) => item.client_id === client.client_id);
  const quotations = list('Quotation', (item) => item.client_id === client.client_id);
  const sales = bookings.reduce((sum, booking) => sum + Number(booking.current_price || booking.client_total || 0), 0);
  const outstanding = bookings.reduce((sum, booking) => { const projection = projectionForInquiry(inquiryIdForBooking(booking)); return sum + Number(projection && projection.finance && projection.finance.outstanding || 0); }, 0);
  const trips = bookings.map((booking) => '<li>' + esc(bookingDestination(booking)) + ' · ' + esc(bookingTravelLabel(booking)) + ' · <button class="secondary compact" onclick="openBookingRecord(\'' + esc(booking.booking_id) + '\')">' + esc(booking.booking_id) + '</button></li>').join('');
  return '<div class="card"><h3>Client / trip history</h3><div class="grid3">' + field('Client since', client.created_at || 'Recorded') + field('Inquiries', inquiries.length) + field('Quotes', quotations.length) + field('Bookings', bookings.length) + field('Total sales', sales.toFixed(2)) + field('Outstanding', outstanding.toFixed(2)) + '</div><h4>Trips</h4>' + (trips ? '<ul>' + trips + '</ul>' : '<p class="muted">No trips recorded.</p>') + '<p class="muted">Notes and preferences: ' + esc(client.notes || 'Not recorded') + '</p></div>';
}

function profitabilityMarkup(records) {
  const projection = projectionForCase(records);
  const profitability = projection && projection.profitability;
  if (!records || !records.booking || !profitability || !profitability.projected) return '';
  const projected = profitability.projected;
  const actual = profitability.actual;
  return '<div class="card"><h3>Profitability</h3><div class="grid3">' + field('Projected selling price', projected.sellingPrice + ' ' + profitability.currency) + field('Projected supplier cost', projected.supplierCost + ' ' + profitability.currency) + field('Fees', projected.fees + ' ' + profitability.currency) + field('Commission', projected.commissions + ' ' + profitability.currency) + field('Projected profit', projected.profit + ' ' + profitability.currency) + field('Actual profit', actual ? actual.profit + ' ' + profitability.currency : 'Not realized') + '</div><p class="muted">Actual profit appears after financials are settled.</p></div>';
}

function operationalMoney(value, currency) {
  if (value === undefined || value === null || value === '') return 'Not recorded';
  const amount = Number(value);
  return (Number.isFinite(amount) ? amount.toFixed(2) : String(value)) + ' ' + (currency || 'PHP');
}

function deadlineDisplay(deadline) {
  if (!deadline || !deadline.at) return 'No deadline recorded';
  const timestamp = Date.parse(deadline.at);
  if (Number.isNaN(timestamp)) return String(deadline.at);
  const difference = timestamp - Date.now();
  const days = Math.ceil(Math.abs(difference) / 86400000);
  const relative = difference < 0 ? (days <= 1 ? 'OVERDUE' : days + ' days overdue') : days === 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : 'Due in ' + days + ' days';
  return String(deadline.at) + ' · ' + relative;
}

function bookingDocumentRecords(records) {
  if (!records || !records.booking) return [];
  const itemIds = new Set((records.bookingItems || []).map((item) => item.booking_item_id));
  return list('Document', (document) => document.booking_id === records.booking.booking_id || (document.related_entity_type === 'Booking' && document.related_entity_id === records.booking.booking_id) || itemIds.has(document.booking_item_id) || (document.related_entity_type === 'BookingItem' && itemIds.has(document.related_entity_id)));
}

function bookingOperationalSummaryMarkup(records, projection) {
  if (!records || !records.booking || !projection) return '';
  const finance = projection.finance || {};
  const profitability = projection.profitability || {};
  const projected = profitability.projected || {};
  const actual = profitability.actual;
  const services = Array.isArray(projection.services) ? projection.services : [];
  const readyServices = services.filter((service) => service.readiness && service.readiness.state === 'READY').length;
  const serviceProgress = services.length ? readyServices + '/' + services.length + ' services ready' : 'No services recorded';
  const documents = bookingDocumentRecords(records);
  const missingDocuments = projection.documents && projection.documents.missing || [];
  const deadlines = (projection.deadlines || []).slice(0, 4);
  const blockers = (projection.blockers || []).slice(0, 5);
  const next = projection.nextAction || {};
  const leadPax = bookingLeadPaxName(records.booking);
  const participants = list('BookingParticipant', (item) => item.booking_id === records.booking.booking_id);
  const supplierPayable = operationalMoney(finance.supplierPayableTotal, finance.currency || records.booking.currency);
  const supplierPaid = operationalMoney(finance.supplierPaid, finance.currency || records.booking.currency);
  const supplierGate = finance.supplierPaymentGate || 'NOT_APPLICABLE';
  const reportedReceived = Number(finance.verifiedReceived || 0) + Number(finance.pendingVerification || 0);
  const documentAction = missingDocuments.length ? '<button class="secondary compact" onclick="window.location.hash=\'operations\'">Open missing documents</button>' : '<button class="secondary compact" onclick="window.location.hash=\'operations\'">Open documents</button>';
  const deadlineMarkup = deadlines.length ? '<div class="booking-deadlines">' + deadlines.map((deadline) => '<div class="booking-deadline"><strong>' + esc(deadline.label || deadline.kind) + '</strong><span>' + esc(deadlineDisplay(deadline)) + '</span>' + status(deadline.overdue ? 'Overdue' : 'Scheduled', deadline.overdue ? 'bad' : 'info') + '</div>').join('') + '</div>' : '<p class="muted">No operational deadlines are currently recorded.</p>';
  const blockerMarkup = blockers.length ? '<ul class="booking-blockers">' + blockers.map((blocker) => '<li>' + esc(blocker.message) + '</li>').join('') + '</ul>' : '<p class="muted">No current blockers.</p>';
  return '<section class="booking-ops-summary"><div class="booking-summary-head"><div><div class="eyebrow">Operational booking summary</div><h3>' + esc(bookingDestination(records.booking)) + ' · ' + esc(bookingTravelLabel(records.booking)) + '</h3><p class="muted">' + esc(records.client && records.client.display_name || records.booking.client_id) + ' · ' + esc(records.booking.booking_id) + ' · Lead passenger: ' + esc(leadPax) + '</p></div><div class="booking-summary-actions"><div>' + status(readableState(projection.currentStage), 'info') + ' ' + status(readableState(projection.readiness && projection.readiness.state), projection.readiness && projection.readiness.state === 'READY' ? 'good' : 'warn') + '</div><button onclick="openNextAction(\'' + esc(next.code || '') + '\')">' + esc(next.label || 'Review next action') + ' →</button></div></div><div class="grid3 booking-summary-metrics">' + field('Client commitment', readableState(projection.clientCommitment && projection.clientCommitment.state)) + field('Supplier fulfillment', readableState(projection.supplierFulfillment && projection.supplierFulfillment.state) + ' · ' + serviceProgress) + field('Finance', readableState(finance.state)) + field('Client outstanding', operationalMoney(finance.outstanding, finance.currency || records.booking.currency)) + field('Documents', readableState(projection.documents && projection.documents.state)) + field('Tasks', readableState(projection.tasks && projection.tasks.state)) + '</div><div class="grid2 booking-summary-lower"><div class="card warn"><div class="eyebrow">Next action</div><h3>' + esc(next.label || 'Review case') + '</h3><p class="muted">' + esc(next.reason || '') + '</p>' + (next.code ? '<button class="secondary compact" onclick="openNextAction(\'' + esc(next.code) + '\')">Open</button>' : '') + '</div><div class="card ' + (blockers.length ? 'blocked' : 'good') + '"><div class="eyebrow">Blockers and exceptions</div>' + blockerMarkup + '</div></div><div class="grid3 booking-finance-summary"><div class="card"><h4>Client funds</h4>' + field('Payments reported', operationalMoney(reportedReceived, finance.currency || records.booking.currency)) + field('Verified received', operationalMoney(finance.verifiedReceived || '0.00', finance.currency || records.booking.currency)) + field('Verified allocated', operationalMoney(finance.verifiedAllocated || '0.00', finance.currency || records.booking.currency)) + field('Next payment', finance.obligations && finance.obligations.find((item) => item.state !== 'SATISFIED') ? operationalMoney(finance.obligations.find((item) => item.state !== 'SATISFIED').outstanding, finance.currency || records.booking.currency) : 'None outstanding') + '</div><div class="card"><h4>Supplier side</h4>' + field('Approved/recorded payable', supplierPayable) + field('Paid to suppliers', supplierPaid) + field('Supplier payment gate', readableState(supplierGate)) + '</div><div class="card"><h4>Profitability</h4>' + field('Projected profit', operationalMoney(projected.profit, profitability.currency)) + field('Actual profit', actual ? operationalMoney(actual.profit, profitability.currency) : 'Not realized') + field('Travelers / participants', (records.booking.pax_count || participants.length || 'Not recorded') + ' / ' + participants.length) + '</div></div><div class="card"><div class="panel-head"><div><h4>Documents and deadlines</h4><p class="muted">Only real deadlines and required document requirements are shown.</p></div>' + documentAction + '</div><div class="grid2"><div>' + (missingDocuments.length ? '<strong>Missing or not ready</strong><ul class="booking-blockers">' + missingDocuments.slice(0, 5).map((item) => '<li>' + esc(item.type || item.document_id || 'Required document') + '</li>').join('') + '</ul>' : '<p class="muted">No required documents are currently blocked.</p>') + '<p class="muted">' + documents.length + ' booking document record(s) available.</p></div><div>' + deadlineMarkup + '</div></div></div></section>';
}

function selectBookingItem(bookingItemId) {
  if (!bookingItemId) return;
  setWorkspaceId('booking-item', bookingItemId);
  render();
}

function enhanceBookingServiceCards(projection) {
  const services = projection && Array.isArray(projection.services) ? projection.services : [];
  document.querySelectorAll('#booking-content .booking-service-card').forEach((card, index) => {
    const service = services[index];
    if (!service || card.querySelector('.service-supplier-control')) return;
    const suppliers = list('Supplier');
    const control = document.createElement('div');
    control.className = 'service-supplier-control';
    control.innerHTML = '<label class="muted">Assign supplier</label><select id="service-supplier-' + esc(service.bookingItemId) + '"><option value="">Select supplier</option>' + suppliers.map((supplier) => '<option value="' + esc(supplier.supplier_id) + '"' + (supplier.supplier_id === service.supplierId ? ' selected' : '') + '>' + esc(supplier.display_name || supplier.legal_name || supplier.supplier_id) + '</option>').join('') + '</select><button class="secondary compact" type="button">Save supplier</button>';
    control.querySelector('button').addEventListener('click', () => assignBookingItemSupplier(service.bookingItemId));
    const meta = card.querySelector('.service-card-meta');
    if (meta) meta.insertAdjacentElement('afterend', control);
  });
}

function bookingServiceCardsMarkup(records, projection) {
  const services = projection && Array.isArray(projection.services) ? projection.services : [];
  if (!services.length) return '';
  return '<div class="booking-service-section"><div class="panel-head"><div><h3>Services and supplier fulfillment</h3><p class="muted">Each service has its own supplier request, documents, tasks, blockers, and readiness.</p></div><span class="muted">' + services.filter((service) => service.readiness && service.readiness.state === 'READY').length + ' / ' + services.length + ' ready</span></div><div class="booking-service-grid">' + services.map((service, index) => {
    const ready = service.readiness && service.readiness.state === 'READY';
    const documents = service.documents || {};
    const tasks = service.tasks || {};
    const blockers = service.blockers || [];
    const supplier = service.supplierId ? readableSupplierName(service.supplierId) : 'Supplier not assigned';
     const confirmAction = service.fulfillment && service.fulfillment.supplierBookingId && service.fulfillment.state !== 'CONFIRMED' ? '<button class="secondary compact" onclick="confirmServiceSupplier(\'' + esc(service.fulfillment.supplierBookingId) + '\',\'' + esc(service.bookingItemId) + '\')">Confirm</button>' : '';
     const serviceName = readableState(service.serviceType) + (services.length > 1 ? ' ' + (index + 1) : '');
     return '<article class="booking-service-card ' + (ready ? 'ready' : 'blocked') + '"><div class="panel-head"><div><div class="eyebrow">' + esc(serviceName) + '</div><h4>' + esc(service.description) + '</h4></div>' + status(readableState(service.readiness && service.readiness.state), ready ? 'good' : 'warn') + '</div><div class="service-card-meta">' + field('Supplier', supplier) + field('Dates', (service.travelStart || 'Not recorded') + (service.travelEnd ? ' – ' + service.travelEnd : '')) + field('Supplier reference', service.fulfillment && service.fulfillment.supplierReference || 'Not recorded') + field('Supplier request', readableState(service.fulfillment && service.fulfillment.state)) + '</div><div class="service-card-progress"><span>Documents: ' + esc(readableState(documents.state)) + ' (' + esc(documents.completeCount || 0) + '/' + esc(documents.requiredCount || 0) + ')</span><span>Tasks: ' + esc(readableState(tasks.state)) + '</span></div>' + (blockers.length ? '<ul class="booking-blockers">' + blockers.slice(0, 3).map((blocker) => '<li>' + esc(blocker.message) + '</li>').join('') + '</ul>' : '<p class="muted">No service blockers.</p>') + '<div class="row-actions"><button class="secondary compact" onclick="selectBookingItem(\'' + esc(service.bookingItemId) + '\')">Manage service</button>' + confirmAction + '</div></article>';
  }).join('') + '</div></div>';
}

function renderClients() {
  const clients = list('Client');
  const selectedId = selectedWorkspaceId('client');
  const selected = selectedId && latest('Client', (client) => client.client_id === selectedId);
  const clientForm = '<div class="card"><h3>Add client</h3><p class="muted">Create the client master record first, then create one or more Inquiries against it.</p><div class="grid3"><div class="field"><label>Name *</label><input id="client-name" placeholder="Client or organization name"></div><div class="field"><label>Client type</label><select id="client-type"><option>Individual</option><option>Family</option><option>Company</option><option>Agency</option><option>Organization</option></select></div><div class="field"><label>Country</label><input id="client-country" value="Philippines"></div><div class="field"><label>Legal name</label><input id="client-legal-name"></div><div class="field"><label>Email</label><input id="client-email" type="email"></div><div class="field"><label>Phone</label><input id="client-phone"></div></div><div class="field"><label>Notes</label><textarea id="client-notes" rows="2"></textarea></div><button onclick="createClientRecord()">Save client</button></div>';
  if (selected) {
    const inquiries = list('Inquiry', (inquiry) => inquiry.client_id === selected.client_id);
    const bookings = list('Booking', (booking) => booking.client_id === selected.client_id);
    const clientInquiries = inquiries.map((inquiry) => '<tr><td>' + esc(inquiry.inquiry_id) + '</td><td>' + esc(inquiry.current_requirements && inquiry.current_requirements.destination || 'Not recorded') + '</td><td>' + esc(inquiryTravelLabel(inquiry.current_requirements)) + '</td><td><button class="secondary compact" onclick="openCase(\'' + esc(inquiry.inquiry_id) + '\')">Open Inquiry</button></td></tr>').join('');
    const edit = '<div class="card"><h3>Edit client</h3><div class="grid3"><div class="field"><label>Name *</label><input id="client-edit-name" value="' + esc(selected.display_name || '') + '"></div><div class="field"><label>Client type</label><select id="client-edit-type">' + ['Individual', 'Family', 'Company', 'Agency', 'Organization'].map((type) => '<option' + (selected.client_type === type ? ' selected' : '') + '>' + type + '</option>').join('') + '</select></div><div class="field"><label>Status</label><select id="client-edit-status"><option' + (selected.status === 'ACTIVE' ? ' selected' : '') + '>ACTIVE</option><option' + (selected.status === 'INACTIVE' ? ' selected' : '') + '>INACTIVE</option></select></div><div class="field"><label>Legal name</label><input id="client-edit-legal-name" value="' + esc(selected.legal_name || '') + '"></div><div class="field"><label>Email</label><input id="client-edit-email" value="' + esc(selected.primary_email || '') + '"></div><div class="field"><label>Phone</label><input id="client-edit-phone" value="' + esc(selected.primary_phone || '') + '"></div><div class="field"><label>Country</label><input id="client-edit-country" value="' + esc(selected.country || '') + '"></div></div><div class="field"><label>Notes</label><textarea id="client-edit-notes" rows="2">' + esc(selected.notes || '') + '</textarea></div><button onclick="saveClientRecord(\'' + esc(selected.client_id) + '\')">Save changes</button></div>';
    $('clients-content').innerHTML = '<div class="selection-bar"><button class="secondary" onclick="clearClientRecord()">Back to client list</button><strong>' + esc(selected.display_name || selected.client_id) + '</strong></div>' + edit + '<div class="grid3"><div class="card"><h3>Inquiries</h3><div class="money">' + inquiries.length + '</div></div><div class="card"><h3>Bookings</h3><div class="money">' + bookings.length + '</div></div><div class="card"><h3>Status</h3>' + status(selected.status || 'ACTIVE', selected.status === 'ACTIVE' ? 'good' : 'warn') + '</div></div><div class="card"><h3>Client inquiries</h3>' + (clientInquiries ? '<div class="table-wrap"><table><thead><tr><th>Inquiry</th><th>Destination</th><th>Travel</th><th></th></tr></thead><tbody>' + clientInquiries + '</tbody></table></div>' : '<div class="empty">No inquiries yet. Open Inquiries to create one.</div>') + '</div>';
    return;
  }
  const rows = clients.map((client) => {
    const inquiries = list('Inquiry', (inquiry) => inquiry.client_id === client.client_id);
    const bookings = list('Booking', (booking) => booking.client_id === client.client_id);
    return '<tr><td><button class="secondary compact" onclick="openClientRecord(\'' + esc(client.client_id) + '\')">Open</button> <strong>' + esc(client.display_name || client.legal_name || client.client_id) + '</strong><br><span class="muted">' + esc(client.client_id) + '</span></td><td>' + esc(client.primary_email || 'Not recorded') + '</td><td>' + inquiries.length + '</td><td>' + bookings.length + '</td><td>' + esc(client.status || 'Not recorded') + '</td></tr>';
  }).join('');
  $('clients-content').innerHTML = clientForm + '<div class="card"><h3>Client master directory</h3><p class="muted">An Inquiry is a request/history record. A Client is the linked master record. Client records can be edited without changing Inquiry history.</p>' + (rows ? '<div class="table-wrap"><table><thead><tr><th>Client</th><th>Email</th><th>Inquiries</th><th>Bookings</th><th>Client status</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="empty">No Client records are available.</div>') + '</div>';
  const pendingName = sessionStorage.getItem('wmit.pendingClientName');
  if (pendingName && $('client-name')) {
    $('client-name').value = pendingName;
    $('client-name').focus();
    sessionStorage.removeItem('wmit.pendingClientName');
  }
}

function inquiryTravelLabel(requirements) {
  const values = requirements || {};
  if (values.travel_start) return values.travel_start + (values.travel_end ? ' – ' + values.travel_end : '');
  if (values.travel_month) return values.travel_month + ' (approximate month)';
  if (values.travel_year) return values.travel_year + ' (approximate year)';
  return 'Not recorded';
}

function requirementStatusOptions(selected) {
  return ['PREFERRED', 'REQUIRED', 'UNKNOWN', 'NOT_APPLICABLE'].map((value) => '<option value="' + value + '"' + (selected === value ? ' selected' : '') + '>' + readableState(value) + '</option>').join('');
}

function selectOptions(values, selected, labels) {
  return '<option value="">Not specified</option>' + values.map((value) => '<option value="' + esc(value) + '"' + (selected === value ? ' selected' : '') + '>' + esc(labels && labels[value] || value) + '</option>').join('');
}

function canonicalRoomArrangement(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized === 'TWN' ? 'DBL_TWN' : normalized;
}

function roomArrangementQuantities(values) {
  const result = { SGL: '', DBL_TWN: '', TRP: '' };
  const configured = values && values.room_arrangements;
  if (Array.isArray(configured)) configured.forEach((item) => { const type = item && canonicalRoomArrangement(item.type); if (item && result[type] !== undefined) result[type] = item.quantity; });
  else if (configured && typeof configured === 'object') Object.keys(result).forEach((key) => { if (configured[key] !== undefined) result[key] = configured[key]; });
  else if (values && values.room_arrangement && result[canonicalRoomArrangement(values.room_arrangement)] !== undefined) result[canonicalRoomArrangement(values.room_arrangement)] = 1;
  return result;
}

function roomArrangementFields(prefix, values, status) {
  const quantities = roomArrangementQuantities(values || {});
  return '<div class="field"><label>Room arrangement quantities</label><div class="grid3"><label>SGL <input id="' + prefix + 'room-sgl" type="number" min="0" step="1" value="' + esc(quantities.SGL) + '" placeholder="0"></label><label>DBL/TWN <input id="' + prefix + 'room-dbl-twn" type="number" min="0" step="1" value="' + esc(quantities.DBL_TWN) + '" placeholder="0"></label><label>TRP <input id="' + prefix + 'room-trp" type="number" min="0" step="1" value="' + esc(quantities.TRP) + '" placeholder="0"></label></div><select id="' + prefix + 'room-arrangement-status" aria-label="Room arrangement status">' + requirementStatusOptions(status || 'PREFERRED') + '</select></div>';
}

function upgradeRequirementControls(prefix, values) {
  const requirements = values || {};
  const statuses = requirements.requirement_statuses || {};
  const category = $(prefix + 'hotel-category');
  if (category && category.tagName === 'INPUT') {
    const fieldElement = category.closest('.field');
    fieldElement.innerHTML = '<label>Hotel category</label><select id="' + prefix + 'hotel-category">' + selectOptions(['1-star', '2-star', '3-star', '4-star', '5-star'], requirements.hotel_category, { '1-star': '1★', '2-star': '2★', '3-star': '3★', '4-star': '4★', '5-star': '5★' }) + '</select><select id="' + prefix + 'hotel-category-status" aria-label="Hotel category status">' + requirementStatusOptions(statuses.hotel_category || 'PREFERRED') + '</select>';
  }
  const meal = $(prefix + 'meal-plan');
  if (meal && meal.tagName === 'INPUT') {
    const fieldElement = meal.closest('.field');
    fieldElement.innerHTML = '<label>Meal plan requested</label><select id="' + prefix + 'meal-plan">' + selectOptions(['RO', 'BB', 'HB', 'FB', 'AI'], requirements.meal_plan, { RO: 'RO · Room only', BB: 'BB · Breakfast', HB: 'HB · Half board', FB: 'FB · Full board', AI: 'AI · All inclusive' }) + '</select><select id="' + prefix + 'meal-plan-status" aria-label="Meal plan status">' + requirementStatusOptions(statuses.meal_plan || 'PREFERRED') + '</select>';
  }
  const room = $(prefix + 'room-arrangement');
  if (room) {
    const fieldElement = room.closest('.field');
    if (fieldElement) fieldElement.outerHTML = roomArrangementFields(prefix, requirements, statuses.room_arrangement || 'PREFERRED');
  }
}

function requirementValue(key, value) {
  if (key === 'room_arrangements' && value && typeof value === 'object') {
    const entries = Array.isArray(value) ? value.map((item) => [canonicalRoomArrangement(item.type), item.quantity]) : Object.keys(value).map((item) => [canonicalRoomArrangement(item), value[item]]);
    return entries.filter((item) => item[1] !== undefined && item[1] !== null && item[1] !== '' && Number(item[1]) > 0).map((item) => item[0] + ' × ' + item[1]).join(', ');
  }
  return Array.isArray(value) ? value.join(', ') : value;
}

function inquiryFormValues(prefix) {
  const value = (name) => ($(prefix + name) && $(prefix + name).value || '').trim();
  const number = (name) => Number($(prefix + name).value);
  const childAges = value('child-ages').split(',').map((item) => item.trim()).filter(Boolean).map(Number);
  const roomArrangements = [['SGL', 'room-sgl'], ['DBL_TWN', 'room-dbl-twn'], ['TRP', 'room-trp']].map((item) => ({ type: item[0], quantity: number(item[1]) })).filter((item) => Number.isInteger(item.quantity) && item.quantity > 0);
  const roomArrangement = roomArrangements.length === 1 ? roomArrangements[0].type : roomArrangements.length > 1 ? 'MIXED' : undefined;
  const optionalRequirements = { hotel_category: value('hotel-category') || undefined, room_arrangement: roomArrangement, room_arrangements: roomArrangements.length ? roomArrangements : undefined, meal_plan: value('meal-plan') || undefined };
  const requirementStatuses = { hotel_category: value('hotel-category-status'), room_arrangement: value('room-arrangement-status'), meal_plan: value('meal-plan-status') };
  return {
    requirements: Object.assign({ destination: value('destination'), travel_start: value('start') || undefined, travel_end: value('end') || undefined, travel_month: value('month') || undefined, travel_year: value('year') || undefined, duration_days: value('duration-days') ? number('duration-days') : undefined, adults: number('adults'), children: number('children'), infants: number('infants'), child_ages: childAges.length ? childAges : undefined }, optionalRequirements),
    requirement_statuses: requirementStatuses
  };
}

function inquiryEditForm(inquiry) {
  const values = inquiry.current_requirements || {};
  const statuses = values.requirement_statuses || {};
  const prefix = 'edit-inq-';
  return '<details class="secondary-details"><summary>Edit current requirements</summary><p class="muted">Changes update the current request and add a requirement-history entry. The original client request remains preserved.</p><div class="grid2"><div class="field"><label>Destination *</label><input id="' + prefix + 'destination" value="' + esc(values.destination || '') + '"></div><div class="field"><label>Trip duration (days)</label><input id="' + prefix + 'duration-days" type="number" min="1" step="1" value="' + esc(values.duration_days || '') + '"></div></div><div class="grid2"><div class="field"><label>Exact travel start date</label><input id="' + prefix + 'start" type="date" value="' + esc(values.travel_start || '') + '"></div><div class="field"><label>Exact travel end date</label><input id="' + prefix + 'end" type="date" value="' + esc(values.travel_end || '') + '"></div></div><div class="grid2"><div class="field"><label>Approximate travel month</label><input id="' + prefix + 'month" type="month" value="' + esc(values.travel_month || '') + '"></div><div class="field"><label>Approximate travel year</label><input id="' + prefix + 'year" type="number" min="2026" max="2100" value="' + esc(values.travel_year || '') + '"></div></div><div class="grid3"><div class="field"><label>Adults</label><input id="' + prefix + 'adults" type="number" min="0" step="1" value="' + esc(values.adults === undefined ? 0 : values.adults) + '"></div><div class="field"><label>Children</label><input id="' + prefix + 'children" type="number" min="0" step="1" value="' + esc(values.children === undefined ? 0 : values.children) + '"></div><div class="field"><label>Infants</label><input id="' + prefix + 'infants" type="number" min="0" step="1" value="' + esc(values.infants === undefined ? 0 : values.infants) + '"></div></div><div class="field"><label>Child ages</label><input id="' + prefix + 'child-ages" value="' + esc((values.child_ages || []).join(', ')) + '" placeholder="e.g. 6, 10"></div><div class="grid3"><div class="field"><label>Hotel category</label><input id="' + prefix + 'hotel-category" value="' + esc(values.hotel_category || '') + '"><select id="' + prefix + 'hotel-category-status" aria-label="Hotel category status">' + requirementStatusOptions(statuses.hotel_category || 'PREFERRED') + '</select></div><div class="field"><label>Room arrangement</label><input id="' + prefix + 'room-arrangement" value="' + esc(values.room_arrangement || '') + '"><select id="' + prefix + 'room-arrangement-status" aria-label="Room arrangement status">' + requirementStatusOptions(statuses.room_arrangement || 'PREFERRED') + '</select></div><div class="field"><label>Meal plan</label><input id="' + prefix + 'meal-plan" value="' + esc(values.meal_plan || '') + '"><select id="' + prefix + 'meal-plan-status" aria-label="Meal plan status">' + requirementStatusOptions(statuses.meal_plan || 'PREFERRED') + '</select></div></div><p class="muted">Derived nights: ' + esc(values.nights === undefined ? 'Not recorded' : values.nights) + ' (trip days minus one).</p><button onclick="saveInquiryChanges()">Save requirement changes</button></details>';
}

function renderSelectedInquiry(records, requirements) {
  const inquiry = records.inquiry;
  const history = inquiry.history || [];
  const changes = history.filter((entry) => entry.type && entry.type !== 'ORIGINAL');
  const participants = records.booking ? list('BookingParticipant', (item) => item.booking_id === records.booking.booking_id) : [];
  const people = participants.map((participant) => { const person = latest('Person', (item) => item.person_id === participant.person_id); return '<tr><td>' + esc(person && (person.display_name || person.name) || participant.person_id) + '</td><td>' + esc(participant.role || participant.roles || 'Role not recorded') + '</td></tr>'; }).join('');
  const historyMarkup = requirementChangeSummary(inquiry) + (changes.length ? '<details class="secondary-details"><summary>Requirement History (' + changes.length + ' changes)</summary><div class="timeline">' + changes.map((entry) => '<div class="timeline-item"><strong>' + esc(entry.type || 'Requirement event') + '</strong><div class="muted">' + esc(entry.at || 'Time not recorded') + '</div>' + requirementTable(entry.value || {}) + '</div>').join('') + '</div></details>' : '');
  return '<div class="card good"><div class="panel-head"><div><h3>Current Inquiry ' + status(readableState(inquiry.state), 'info') + '</h3><p class="muted">All case-specific workspaces refer to this Inquiry.</p></div><button class="secondary" onclick="openInquiries()">Back to Inquiry list</button></div>' + field('Client', records.client && records.client.display_name || inquiry.client_id) + field('Current travel request', inquiryTravelLabel(requirements)) + field('Current destination', requirements.destination) + field('Travelers', travelerCompositionLabel(requirements)) + '<h3>Current requirements</h3>' + requirementTable(requirements) + inquiryEditForm(inquiry) + historyMarkup + '<details class="secondary-details"><summary>People and Roles</summary>' + (people ? '<table><thead><tr><th>Person</th><th>Role</th></tr></thead><tbody>' + people + '</tbody></table>' : '<p class="muted">No Booking participant roles have been recorded yet.</p>') + '</details></div>';
}

function renderInquiry() {
  const records = caseRecords();
  const inquiries = list('Inquiry');
  const requirements = records.inquiry && records.inquiry.current_requirements || {};
  const form = '<div class="card"><h3>Create Inquiry</h3><p class="muted">Destination and travel timing are required before tariff research. Exact dates derive the duration; approximate month/year requires a trip duration in days.</p><div class="grid2"><div class="field"><label>Client</label><input id="inq-client" value="CLIENT-SYNTH-000001" required></div><div class="field"><label>Destination *</label><input id="inq-destination" required placeholder="e.g. Tokyo"></div></div><div class="grid2"><div class="field"><label>Exact travel start date</label><input id="inq-start" type="date"></div><div class="field"><label>Exact travel end date</label><input id="inq-end" type="date"></div></div><div class="grid2"><div class="field"><label>Approximate travel month</label><input id="inq-month" type="month"></div><div class="field"><label>Approximate travel year</label><input id="inq-year" type="number" min="2026" max="2100" placeholder="e.g. 2027"></div></div><div class="field"><label>Trip duration (days) <span class="muted">required for approximate timing</span></label><input id="inq-duration-days" type="number" min="1" step="1" placeholder="e.g. 5"></div><h4>Traveler composition</h4><div class="grid3"><div class="field"><label>Adults</label><input id="inq-adults" type="number" min="0" step="1" value="2"></div><div class="field"><label>Children</label><input id="inq-children" type="number" min="0" step="1" value="0"></div><div class="field"><label>Infants</label><input id="inq-infants" type="number" min="0" step="1" value="0"></div></div><div class="field"><label>Child ages (optional until tariff requires them)</label><input id="inq-child-ages" placeholder="e.g. 6, 10"></div><h4>Optional requirements and certainty</h4><div class="grid3"><div class="field"><label>Hotel category</label><input id="inq-hotel-category"><select id="inq-hotel-category-status" aria-label="Hotel category status"><option value="PREFERRED">Preferred</option><option value="REQUIRED">Required</option><option value="UNKNOWN">Unknown</option><option value="NOT_APPLICABLE">Not applicable</option></select></div><div class="field"><label>Room arrangement</label><input id="inq-room-arrangement"><select id="inq-room-arrangement-status" aria-label="Room arrangement status"><option value="PREFERRED">Preferred</option><option value="REQUIRED">Required</option><option value="UNKNOWN">Unknown</option><option value="NOT_APPLICABLE">Not applicable</option></select></div><div class="field"><label>Meal plan</label><input id="inq-meal-plan"><select id="inq-meal-plan-status" aria-label="Meal plan status"><option value="PREFERRED">Preferred</option><option value="REQUIRED">Required</option><option value="UNKNOWN">Unknown</option><option value="NOT_APPLICABLE">Not applicable</option></select></div></div><button onclick="createInquiry()">Create Inquiry</button></div>';
  const selected = records.inquiry ? renderSelectedInquiry(records, requirements) : '<div class="card warn"><h3>No case selected</h3><p>Choose an Inquiry below or create a new one.</p></div>';

  const inquiryRows = inquiries.map((inquiry) => {
    const item = recordsForInquiry(inquiry);
    const values = inquiry.current_requirements || {};
    return '<tr><td><strong>' + esc(item.client && item.client.display_name || 'Client') + '</strong></td><td>' + esc(values.destination || 'Not recorded') + '</td><td>' + esc(inquiryTravelLabel(values)) + '</td><td>' + status(item.booking ? 'Converted to Booking' : readableState(inquiry.state), item.booking ? 'good' : 'info') + '</td><td><button class="secondary" onclick="openCase(\'' + esc(inquiry.inquiry_id) + '\')">Open</button></td></tr>';
  }).join('');
  const research = records.inquiry ? '' : '<div class="card"><h3>Next step</h3><p>Capture the client request, then research matching options without selecting a supplier automatically.</p></div>';
  const inquiryList = inquiryRows ? '<div class="table-wrap"><table><thead><tr><th>Client</th><th>Destination</th><th>Travel timing</th><th>State</th><th></th></tr></thead><tbody>' + inquiryRows + '</tbody></table></div>' : '<div class="empty">No Inquiry records yet.</div>';
  $('inquiry-content').innerHTML = records.inquiry ? selected + research + '<details class="secondary-details"><summary>Other Inquiries (' + Math.max(inquiries.length - 1, 0) + ')</summary>' + inquiryList + '</details>' : form + research + '<h3>Inquiry records</h3>' + inquiryList;
  if (!records.inquiry && $('inq-client')) {
    const clientSelect = document.createElement('select');
    clientSelect.id = 'inq-client';
    clientSelect.required = true;
    clientSelect.innerHTML = '<option value="">Search for a client first</option>';
    $('inq-client').replaceWith(clientSelect);
    clientSelect.insertAdjacentHTML('beforebegin', '<input id="inq-client-search" aria-label="Search clients" placeholder="Search name, email, phone, or client ID" autocomplete="off">');
    bindClientPicker('inq-client-search', 'inq-client');
  }
  upgradeRequirementControls(records.inquiry ? 'edit-inq-' : 'inq-', records.inquiry ? requirements : {});
}

async function createInquiry() {
  const start = $('inq-start').value;
  const end = $('inq-end').value;
  const month = $('inq-month').value;
  const year = $('inq-year').value;
  const durationDays = $('inq-duration-days').value;
  const adults = Number($('inq-adults').value);
  const children = Number($('inq-children').value);
  const infants = Number($('inq-infants').value);
  const childAges = $('inq-child-ages').value.split(',').map((value) => value.trim()).filter(Boolean).map(Number);
  const structuredRequirements = inquiryFormValues('inq-');
  const optionalRequirements = { hotel_category: structuredRequirements.requirements.hotel_category, room_arrangement: structuredRequirements.requirements.room_arrangement, room_arrangements: structuredRequirements.requirements.room_arrangements, meal_plan: structuredRequirements.requirements.meal_plan };
  const requirementStatuses = structuredRequirements.requirement_statuses;
  if (!$('inq-destination').value.trim()) return failLocal('Destination is required before an Inquiry can be saved or researched.', 'inq-destination');
  if (!start && !month && !year) return failLocal('Enter a specific travel date, or an approximate travel month/year.', 'inq-start');
  if (start && (month || year)) return failLocal('Use either specific dates or an approximate month/year, not both.');
  if (end && !start) return failLocal('Enter a travel start date before entering an end date.', 'inq-start');
  if (start && end && end < start) return failLocal('Travel end date cannot be before travel start date.');
  if (!start && !durationDays) return failLocal('Approximate month/year requires the number of trip days.', 'inq-duration-days');
  if ([adults, children, infants].some((value) => !Number.isInteger(value) || value < 0) || adults + children + infants < 1) return failLocal('Enter at least one adult, child, or infant.');
  const result = await api('createInquiry', { client_id: $('inq-client').value, received_at: new Date().toISOString(), source: 'LOCAL_SYNTHETIC', requirement_statuses: requirementStatuses, requirements: Object.assign({ destination: $('inq-destination').value.trim(), travel_start: start, travel_end: end, travel_month: month, travel_year: year, duration_days: durationDays ? Number(durationDays) : undefined, adults, children, infants, child_ages: childAges.length ? childAges : undefined }, optionalRequirements) });
  if (result && result.inquiry_id) openCase(result.inquiry_id);
}

async function saveInquiryChanges() {
  const inquiryId = selectedInquiryId();
  if (!inquiryId) return failLocal('Select an Inquiry before editing it.');
  const values = inquiryFormValues('edit-inq-');
  const requirements = values.requirements;
  if (!requirements.destination) return failLocal('Destination is required before an Inquiry can be saved.', 'edit-inq-destination');
  const hasExactDates = Boolean(requirements.travel_start || requirements.travel_end);
  const hasApproximateTiming = Boolean(requirements.travel_month || requirements.travel_year);
  if (!hasExactDates && !hasApproximateTiming) return failLocal('Enter a specific travel date, or an approximate month/year.', 'edit-inq-start');
  if (hasExactDates && hasApproximateTiming) return failLocal('Use either specific dates or approximate month/year, not both.');
  if (requirements.travel_end && !requirements.travel_start) return failLocal('Enter a travel start date before entering an end date.', 'edit-inq-start');
  if (requirements.travel_start && requirements.travel_end && requirements.travel_end < requirements.travel_start) return failLocal('Travel end date cannot be before travel start date.');
  if (!hasExactDates && !requirements.duration_days) return failLocal('Approximate month/year requires trip duration in days.', 'edit-inq-duration-days');
  if ([requirements.adults, requirements.children, requirements.infants].some((value) => !Number.isInteger(value) || value < 0) || requirements.adults + requirements.children + requirements.infants < 1) return failLocal('Enter at least one adult, child, or infant.');
  requirements.requirement_statuses = values.requirement_statuses;
  await api('updateInquiry', { inquiry_id: inquiryId, requirements }, 'LOCAL_STAFF');
}

function optionPricingDetails(option) {
  const preview = option && option.pricing_preview;
  if (!preview) return '<div class="card warn"><strong>Price preview unavailable</strong><p class="muted">' + esc((option && option.price_warnings || ['Tariff interpretation or required quantity is still unresolved.'])[0]) + '</p></div>';
  return '<div class="card good"><h4>Price comparison</h4><div class="grid3">' + field('Supplier cost', preview.supplier_cost_total + ' ' + preview.currency) + field('WMIT markup + fees', Number(preview.markup_total || 0) + Number(preview.fees_total || 0) + ' ' + preview.currency) + field('Client-facing price', preview.client_total + ' ' + preview.currency) + '</div></div>';
}

function optionMatchDetails(option) {
  const details = option && option.match_details || {};
  const matches = (details.matches || []).map((item) => '<div>✓ ' + esc(item.field.replace(/_/g, ' ') + ': ' + item.value) + '</div>').join('');
  const mismatches = (details.mismatches || []).map((item) => '<div>⚠ ' + esc(item.field.replace(/_/g, ' ') + ': ' + (item.reason || 'not matched')) + '</div>').join('');
  return '<div class="why"><b>Why this option matches</b>' + (matches || '<div>Requirements match recorded</div>') + mismatches + '</div>';
}

function optionRateDetails(option) {
  const rates = list('TariffRateComponent', (rate) => (option.candidate_rate_ids || []).includes(rate.tariff_rate_component_id));
  const packageRecord = option.supplier_package_id && latest('SupplierPackage', (item) => item.supplier_package_id === option.supplier_package_id);
  if (!rates.length && !packageRecord) return '<div class="card warn"><strong>Rate not recorded</strong><p class="muted">This option has no directly linked tariff rate. Staff must research or request a supplier quotation before pricing.</p></div>';
  if (packageRecord) return optionMatchDetails(option) + '<div class="card good"><h4>Supplier package price</h4><div class="grid3">' + field('Package price', (packageRecord.price || packageRecord.amount || 'Not recorded') + (packageRecord.currency ? ' ' + packageRecord.currency : '')) + field('Rate basis', packageRecord.rate_unit ? readableUnit(packageRecord.rate_unit) : 'Supplier package basis') + field('Validity', packageRecord.validity || packageRecord.validity_end || 'Not recorded') + '</div></div>' + optionPricingDetails(option);
  return optionMatchDetails(option) + '<div class="card good"><h4>Supplier rate</h4>' + rates.map((rate) => '<div class="grid3">' + field('Rate amount', (rate.amount || 'Not recorded') + (rate.currency ? ' ' + rate.currency : '')) + field('Rate basis', rate.rate_unit ? readableUnit(rate.rate_unit) : 'Needs staff confirmation') + field('Quantity driver', rate.quantity_driver ? String(rate.quantity_driver).replace(/_/g, ' ') : 'Not recorded') + '</div>').join('') + '</div>' + optionPricingDetails(option);
}

function renderOptions() {
  const records = caseRecords();
  if (!records.inquiry) {
    $('options-content').innerHTML = '<div class="card"><h3>Options appear inside an Inquiry</h3><p class="muted">Select an Inquiry first. Matching options are a child step within that case.</p></div>';
    return;
  }
  if (!records.options.length) {
    const diagnostic = matchDiagnostics[records.inquiry.inquiry_id];
    if (!diagnostic) {
      $('options-content').innerHTML = '<div class="card warn"><h3>Choose how to prepare the quotation</h3><p>Use a manual quotation now, or search trusted tariffs and available supplier packages when structured supplier data is ready.</p><div class="row-actions"><button class="secondary" onclick="createManualDraftQuotation()">Create Manual Quotation</button><button class="secondary" onclick="findOptionsFromCase()">Research matching options</button><button class="secondary" onclick="openTariffLibrary()">Open Tariff Library</button></div></div>';
      return;
    }
    const reasons = diagnostic && diagnostic.excluded_candidates || [];
    const reasonRows = reasons.filter((item) => item.reason === 'REQUIREMENTS_NOT_MATCHED').slice(0, 12).map((item) => '<div class="event">' + esc((item.mismatches || []).map((mismatch) => mismatch.field + ': requested ' + mismatch.requested + ', tariff ' + mismatch.tariff).join(' · ')) + '</div>').join('');
    $('options-content').innerHTML = '<div class="card warn"><h3>No trusted tariff match found</h3><p>You can continue with a manual quotation, research again, or request supplier information. No price or supplier has been invented.</p><div class="row-actions"><button class="secondary" onclick="createManualDraftQuotation()">Create Manual Quotation</button><button class="secondary" onclick="findOptionsFromCase()">Research again</button><button class="secondary" onclick="createResearchFollowUp()">Create manual research follow-up</button><button class="secondary" onclick="openTariffLibrary()">Open Tariff Library</button></div></div>' + (reasonRows ? '<div class="card"><h3>Why candidates were excluded</h3>' + reasonRows + '</div>' : '');
    return;
  }
  const selected = records.options.filter((option) => option.selected === true || option.state === 'SELECTED');
  const warning = selected.length > 0 && (records.quotation || records.booking) ? '<div class="card warn"><strong>Downstream records exist.</strong><p>Changing the selected option may require revised pricing, client re-acceptance, or a Booking amendment. Existing records are not silently deleted.</p></div>' : '';
  const cards = records.options.map((option, index) => {
    const isSelected = option.selected === true || option.state === 'SELECTED';
    const rejected = option.state === 'REJECTED';
    const superseded = option.state === 'SUPERSEDED';
    const action = isSelected ? '<span class="status good">Selected for quotation</span>' : rejected || superseded ? '<span class="muted">Not selectable: ' + esc(readableState(option.state)) + '</span>' : '<button onclick="selectThisOption(\'' + esc(option.commercial_option_id) + '\')">' + (selected.length ? 'Change selection' : 'Select this option') + '</button>';
    return '<div class="card ' + (isSelected ? 'good' : '') + '"><h3>Option ' + (index + 1) + ' · ' + status(isSelected ? 'Selected' : rejected ? 'Rejected' : superseded ? 'Superseded' : 'Available', isSelected ? 'good' : rejected || superseded ? 'warn' : 'info') + '</h3>' + field('Supplier', readableSupplierName(option.supplier_id)) + field('Conditions', conditionSummary(option.requirements_snapshot)) + optionRateDetails(option) + '<div class="why"><b>Why it matches</b>' + ((option.match_explanation || []).map((reason) => '<div>' + esc(reason) + '</div>').join('') || '<div>Requirements match recorded</div>') + '</div>' + ((option.warnings || []).length ? '<div class="warning-list"><b>Warnings</b>' + option.warnings.map((item) => '<div>' + esc(item) + '</div>').join('') + '</div>' : '') + '<div class="field"><label>Source</label><div>' + esc(sourceProvenance(option.source_provenance)) + '</div></div><div class="row-actions">' + action + '</div></div>';
  }).join('');
  $('options-content').innerHTML = warning + '<div class="card"><h3>' + records.options.length + ' candidate option(s) found</h3><p class="muted">No best supplier or best option was selected automatically. Exactly one option can be active for quotation.</p></div><div class="grid2">' + cards + '</div><div class="card"><h3>Need more choices?</h3><p class="muted">Find More Options searches for additional candidates and excludes options already presented where the backend has that evidence.</p><button class="secondary" onclick="findMore()">Find More Options</button></div>';
}

async function findOptionsFromCase() {
  const records = caseRecords();
  if (!records.inquiry) return failLocal('Select an Inquiry first.');
  const result = await api('matchOptions', { inquiry_id: records.inquiry.inquiry_id });
  if (result) matchDiagnostics[records.inquiry.inquiry_id] = result;
}

async function createResearchFollowUp() {
  const records = caseRecords();
  if (!records.inquiry) return failLocal('Select an Inquiry first.');
  await api('createTask', {
    idempotency_key: 'RESEARCH-FOLLOW-UP:' + records.inquiry.inquiry_id,
    inquiry_id: records.inquiry.inquiry_id,
    task_type: 'RESEARCH_OPTIONS',
    description: 'Research additional supplier or tariff options for this Inquiry.',
    priority: 'HIGH',
    source: 'MANUAL_RESEARCH_FOLLOW_UP'
  }, 'LOCAL_STAFF');
}

async function findMore() {
  const records = caseRecords();
  if (!records.inquiry) return failLocal('Select an Inquiry first.');
  const reasons = ['CLIENT_REJECTED', 'PRICE_TOO_HIGH', 'HOTEL_NOT_PREFERRED', 'ITINERARY_NOT_SUITABLE', 'SUPPLIER_PREFERENCE', 'NEED_MORE_CHOICES', 'OTHER'];
  const selectedReason = window.prompt('Why are you looking for more options?\n' + reasons.map((reason, index) => (index + 1) + '. ' + readableState(reason)).join('\n'), '6');
  if (selectedReason === null) return null;
  const selectedIndex = Number(selectedReason) - 1;
  const reason = reasons[selectedIndex] || (reasons.includes(String(selectedReason).toUpperCase()) ? String(selectedReason).toUpperCase() : 'OTHER');
  const note = window.prompt('Optional note about this search:', '') || '';
  const result = await api('findMoreOptions', { inquiry_id: records.inquiry.inquiry_id, reason, note, rejected_option_ids: records.options.filter((item) => item.state === 'REJECTED').map((item) => item.commercial_option_id) });
  if (result) matchDiagnostics[records.inquiry.inquiry_id] = result;
}

async function selectThisOption(optionId) {
  const records = caseRecords();
  if (!records.inquiry) return failLocal('Select an Inquiry first.');
  const selected = records.options.filter((item) => item.selected === true || item.state === 'SELECTED');
  if (selected.length > 1) return failLocal('More than one option is active. Selection is blocked until the state is corrected.');
  if (selected.length === 1 && selected[0].commercial_option_id === optionId) return failLocal('This option is already selected.');
  let replacementConfirmation = false;
  if (selected.length === 1 && records.booking) {
    if (!window.confirm('A Booking already exists. Replacing this option will require Booking amendment and client re-acceptance. Continue?')) return null;
    replacementConfirmation = true;
  } else if (selected.length === 1 && records.quotation) {
    if (!window.confirm('A quotation already exists. Replacing this option will require a revised quotation. Continue?')) return null;
    replacementConfirmation = true;
  }
  await api('selectOption', { commercial_option_id: optionId, confirm_replacement: replacementConfirmation, replacement_reason: replacementConfirmation ? 'Staff confirmed downstream option replacement.' : undefined }, 'LOCAL_STAFF');
}

function tariffFactLabel(name) {
  return ({ supplier_name: 'Supplier', validity: 'Validity', rate_currency: 'Currency', currency: 'Currency', rate_unit: 'Rate basis', hotel: 'Hotel', region: 'Region', duration: 'Duration', room_type: 'Room type', room_arrangement: 'Occupancy' }[name] || String(name || '').replace(/_/g, ' '));
}

function safeId(value) {
  return String(value || '').replace(/[^A-Za-z0-9_-]/g, '_');
}

function tariffRateUnitOptions(selected) {
  const units = state && state.configuration && state.configuration.tariffRateUnits || ['PER_PERSON', 'PER_PERSON_PER_NIGHT', 'PER_PERSON_PER_WAY', 'PER_ROOM', 'PER_ROOM_PER_NIGHT', 'PER_NIGHT', 'PER_VEHICLE', 'PER_VEHICLE_PER_WAY', 'PER_GROUP', 'PER_GROUP_PER_DAY', 'PER_SERVICE', 'OTHER_SUPPLIER_SPECIFIED'];
  const labels = { PER_PERSON: 'Per person', PER_PERSON_PER_NIGHT: 'Per person per night', PER_PERSON_PER_WAY: 'Per person per way', PER_ROOM: 'Per room', PER_ROOM_PER_NIGHT: 'Per room per night', PER_NIGHT: 'Per night', PER_VEHICLE: 'Per vehicle', PER_VEHICLE_PER_WAY: 'Per vehicle per way', PER_GROUP: 'Per group', PER_GROUP_PER_DAY: 'Per group per day', PER_SERVICE: 'Per service', OTHER_SUPPLIER_SPECIFIED: 'Other / supplier-specified' };
  return units.map((unit) => '<option value="' + esc(unit) + '"' + (String(selected || '').toUpperCase() === String(unit).toUpperCase() ? ' selected' : '') + '>' + esc(labels[unit] || readableUnit(unit)) + '</option>').join('');
}

function tariffReviewRows(tariff) {
  const facts = list('TariffExtractionFact', (item) => item.tariff_source_id === tariff.tariff_source_id);
  const rates = list('TariffRateComponent', (item) => item.tariff_source_id === tariff.tariff_source_id);
  const currencyFact = facts.find((fact) => ['currency', 'rate_currency'].includes(fact.field_name));
  const unitFact = facts.find((fact) => ['rate_unit', 'rate_unit_basis'].includes(fact.field_name));
  const regularFacts = facts.filter((fact) => fact !== currencyFact && fact !== unitFact);
  const factRows = regularFacts.map((fact) => '<tr><td>' + esc(tariffFactLabel(fact.field_name)) + '</td><td><input id="fact-' + safeId(fact.tariff_extraction_fact_id) + '" value="' + esc(fact.normalized_value || '') + '" placeholder="Needs staff confirmation"></td><td>' + (fact.ambiguous || fact.review_status !== 'CONFIRMED' ? status('Needs staff confirmation', 'warn') : status('Confirmed', 'good')) + '</td></tr>').join('');
  const fileFacts = (currencyFact ? '<tr><td>Currency for this tariff file</td><td><input id="tariff-file-currency" value="' + esc(currencyFact.normalized_value || '') + '" placeholder="Needs staff confirmation"></td><td>' + (currencyFact.ambiguous || currencyFact.review_status !== 'CONFIRMED' ? status('Needs staff confirmation', 'warn') : status('Confirmed', 'good')) + '</td></tr>' : '') + (unitFact ? '<tr><td>Rate basis for this tariff file</td><td><select id="tariff-file-unit"><option value="">Needs staff confirmation</option>' + tariffRateUnitOptions(unitFact.normalized_value) + '</select></td><td>' + (unitFact.ambiguous || unitFact.review_status !== 'CONFIRMED' ? status('Needs staff confirmation', 'warn') : status('Confirmed', 'good')) + '</td></tr>' : '');
  const reviewRates = rates.filter((rate) => rate.requires_explicit_review);
  const rateRows = reviewRates.map((rate) => '<tr><td>' + esc(conditionSummary(rate.conditions)) + '<br><span class="muted">' + esc(sourceProvenance(rate.source_provenance)) + '</span></td><td><input id="rate-amount-' + safeId(rate.tariff_rate_component_id) + '" value="' + esc(rate.amount || '') + '"></td><td>' + status('Uses file currency and rate basis', 'info') + '</td><td><label><input type="checkbox" id="rate-confirm-' + safeId(rate.tariff_rate_component_id) + '"> Confirm this flagged cell</label></td></tr>').join('');
  const bulkAction = reviewRates.length ? '<div class="row-actions"><button class="secondary" onclick="confirmAllTariffCells(\'' + esc(tariff.tariff_source_id) + '\')">Confirm all flagged cells for review</button></div>' : '';
  return '<div class="card warn"><h3>Staff extraction review</h3><p>Extracted values are proposals. Confirm the file-wide currency and rate basis once, then review any individual flagged conditional cells before this version can become trusted.</p><h4>Extracted facts</h4><div class="table-wrap"><table><thead><tr><th>Field</th><th>Value</th><th>Review state</th></tr></thead><tbody>' + factRows + fileFacts + '</tbody></table></div>' + (rateRows ? '<h4>Conditional rates requiring review</h4><p class="muted">The file-wide currency and rate basis are shown above. Each flagged rate still needs staff acknowledgement because its source conditions are ambiguous.</p><div class="table-wrap"><table><thead><tr><th>Conditions / source</th><th>Amount</th><th>Rate basis</th><th>Confirmation</th></tr></thead><tbody>' + rateRows + '</tbody></table></div>' + bulkAction : '<p class="muted">No individual rate cells are currently flagged for review.</p>') + '</div>';
}

function readTariffReview(tariff) {
  const facts = list('TariffExtractionFact', (item) => item.tariff_source_id === tariff.tariff_source_id);
  const rates = list('TariffRateComponent', (item) => item.tariff_source_id === tariff.tariff_source_id);
  const corrections = {};
  const unresolved = [];
  const currencyFact = facts.find((fact) => ['currency', 'rate_currency'].includes(fact.field_name));
  const unitFact = facts.find((fact) => ['rate_unit', 'rate_unit_basis'].includes(fact.field_name));
  const fileCurrencyInput = $('tariff-file-currency');
  const fileUnitInput = $('tariff-file-unit');
  const fileCurrency = fileCurrencyInput && fileCurrencyInput.value.trim();
  const fileUnit = fileUnitInput && fileUnitInput.value.trim();
  facts.forEach((fact) => {
    const input = fact === currencyFact ? fileCurrencyInput : fact === unitFact ? fileUnitInput : $('fact-' + safeId(fact.tariff_extraction_fact_id));
    const value = input && input.value.trim();
    if (!value) unresolved.push(tariffFactLabel(fact.field_name));
    else corrections[fact.tariff_extraction_fact_id] = { normalized_value: value, confidence: 1 };
  });
  const rateCorrections = {};
  const confirmedRateIds = [];
  rates.filter((rate) => rate.requires_explicit_review).forEach((rate) => {
    const amount = $('rate-amount-' + safeId(rate.tariff_rate_component_id));
    const confirm = $('rate-confirm-' + safeId(rate.tariff_rate_component_id));
    if (confirm && confirm.checked) {
      if (!amount || !amount.value.trim() || !fileCurrency || !fileUnit) unresolved.push('flagged rate condition ' + rate.tariff_rate_component_id);
      else {
        confirmedRateIds.push(rate.tariff_rate_component_id);
        rateCorrections[rate.tariff_rate_component_id] = { amount: amount.value.trim(), currency: fileCurrency, rate_unit: fileUnit, currency_status: 'CONFIRMED', rate_unit_status: 'CONFIRMED', requires_explicit_review: false, conditions: rate.conditions };
      }
    } else if (rate.requires_explicit_review) unresolved.push('flagged rate condition ' + rate.tariff_rate_component_id);
  });
  return { corrections, rateCorrections, confirmedRateIds, unresolved };
}

function confirmAllTariffCells(tariffId) {
  const tariff = latest('TariffSource', (item) => item.tariff_source_id === tariffId);
  if (!tariff) return failLocal('That tariff version is no longer available.');
  const rates = list('TariffRateComponent', (item) => item.tariff_source_id === tariffId && item.requires_explicit_review);
  if (!rates.length) return failLocal('No flagged rate cells require separate confirmation.');
  if (!window.confirm('Mark all currently flagged rate cells as reviewed? This does not trust the tariff yet. Review the file-wide currency, rate basis, and amounts, then click Confirm and trust tariff.')) return;
  rates.forEach((rate) => {
    const checkbox = $('rate-confirm-' + safeId(rate.tariff_rate_component_id));
    if (checkbox) checkbox.checked = true;
  });
  showMessage('Review prepared', rates.length + ' flagged rate cells are marked for confirmation. Check the values, then choose Confirm and trust tariff.', 'warn');
}

async function saveTariffReview(tariffId, approve) {
  const tariff = latest('TariffSource', (item) => item.tariff_source_id === tariffId);
  if (!tariff) return failLocal('That tariff version is no longer available.');
  const review = readTariffReview(tariff);
  if (approve && review.unresolved.length) return failLocal('Trust is blocked. Confirm or correct: ' + review.unresolved.slice(0, 5).join(', ') + (review.unresolved.length > 5 ? ' and other review items.' : '.'));
  await api('reviewTariff', { tariff_source_id: tariffId, approve: Boolean(approve), corrections: review.corrections, rate_corrections: review.rateCorrections, confirmed_rate_ids: review.confirmedRateIds }, approve ? 'LOCAL_MANAGER' : 'LOCAL_STAFF');
}

function trustedTariffDetails(tariff) {
  const facts = list('TariffExtractionFact', (item) => item.tariff_source_id === tariff.tariff_source_id);
  const rates = list('TariffRateComponent', (item) => item.tariff_source_id === tariff.tariff_source_id);
  const itinerary = list('TariffItineraryComponent', (item) => item.tariff_source_id === tariff.tariff_source_id);
  const currencyFact = facts.find((fact) => ['currency', 'rate_currency'].includes(fact.field_name));
  const unitFact = facts.find((fact) => ['rate_unit', 'rate_unit_basis'].includes(fact.field_name));
  const factRows = facts.filter((fact) => fact !== currencyFact && fact !== unitFact).map((fact) => '<tr><td>' + esc(tariffFactLabel(fact.field_name)) + '</td><td>' + esc(fact.normalized_value || 'Not recorded') + '</td><td>' + status('Confirmed by staff', 'good') + '</td></tr>').join('');
  const rateRows = rates.map((rate) => '<tr><td>' + esc(conditionSummary(rate.conditions)) + '</td><td>' + esc(rate.amount || 'Not recorded') + '</td><td>' + esc(sourceProvenance(rate.source_provenance)) + '</td></tr>').join('');
  const itineraryRows = itinerary.map((item) => '<div class="event"><strong>' + esc(item.day ? 'Day ' + item.day : item.content_type || 'Supplier content') + '</strong> · ' + esc(item.activity || item.text || 'Supplier itinerary content') + '</div>').join('');
  return '<div class="grid3">' + field('Conditional rate components', rates.length) + field('Confirmed facts', facts.length) + field('Itinerary components', itinerary.length) + field('File currency', currencyFact && currencyFact.normalized_value || 'Not recorded') + field('File rate basis', unitFact && readableUnit(unitFact.normalized_value) || 'Not recorded') + '</div><h3>Confirmed extracted facts</h3><table><thead><tr><th>Field</th><th>Value</th><th>Status</th></tr></thead><tbody>' + factRows + '</tbody></table><h3>Conditional rates retained</h3><details><summary>Show ' + rates.length + ' conditional components</summary><div class="table-wrap"><table><thead><tr><th>Conditions</th><th>Rate</th><th>Source provenance</th></tr></thead><tbody>' + rateRows + '</tbody></table></div></details><h3>Itinerary and supplier conditions</h3>' + (itineraryRows || '<p class="muted">No itinerary content recorded.</p>') + '<p class="muted">The original source document, extraction, review decisions, and tariff version remain linked.</p>';
}

function tariffUploadPanel() {
  const suppliers = list('Supplier');
  const supplierId = suppliers[0] && suppliers[0].supplier_id || '';
  const supplierOptions = suppliers.map((supplier) => '<option value="' + esc(supplier.supplier_id) + '"' + (supplier.supplier_id === supplierId ? ' selected' : '') + '>' + esc(supplier.display_name || supplier.legal_name || supplier.supplier_id) + '</option>').join('');
  return '<div class="card"><h3>Add tariff to the library</h3><p class="muted">Three ways in: <b>upload</b> the supplier\'s tariff PDF, <b>paste</b> text extracted anywhere (the matrix is parsed from the document\'s own headers), or <b>encode manually</b> with the standard template. Everything is proposed for review; currency and rate unit are never assumed.</p><div class="grid3"><div class="field"><label>Supplier</label><select id="tariff-upload-supplier">' + supplierOptions + '</select></div><div class="field"><label>Tariff PDF</label><input id="tariff-upload-file" type="file" accept="application/pdf,.pdf"></div><div class="field"><label>&nbsp;</label><button onclick="uploadTariffPdf(this)">Upload tariff PDF</button></div></div><div class="field" style="margin-top:10px"><label>Paste extracted tariff text</label><textarea id="tariff-paste-text" rows="7" placeholder="Paste the text layer here — keep the column header line (e.g. ROOM TYPE SGL TWN/TRP ...) and one hotel per line."></textarea></div><div class="row-actions"><button onclick="uploadTariffPaste(this)">Create tariff from pasted text</button><button class="secondary" onclick="uploadSyntheticTariff()">Use generic synthetic source</button></div><details class="compact-form" style="margin-top:12px"><summary>＋ Manual entry template (encode rates by hand)</summary><p class="muted" style="margin:8px 0">Creates a blank tariff with the currency and rate basis you set here, then add rate rows one at a time on the review screen. Manually entered rates are already confirmed — one click trusts the tariff.</p><div class="grid3"><div class="field"><label>Currency</label><input id="blank-currency" value="PHP" maxlength="3"></div><div class="field"><label>Rate basis</label><select id="blank-unit">' + tariffRateUnitOptions('PER_PERSON') + '</select></div><div class="field"><label>&nbsp;</label></div><div class="field"><label>Validity start (optional)</label><input id="blank-valid-start" type="date"></div><div class="field"><label>Validity end (optional)</label><input id="blank-valid-end" type="date"></div><div class="field"><label>&nbsp;</label><button onclick="createBlankTariff(this)">Create blank tariff</button></div></div></details></div>';
}

async function uploadTariffPdf(button) {
  const input = $('tariff-upload-file');
  const file = input && input.files && input.files[0];
  if (!file) return failLocal('Choose a tariff PDF first.');
  if (file.size > 700 * 1024) return failLocal('The tariff PDF limit is 700 KB. Ask the supplier for a smaller, text-based file.');
  const supplier = $('tariff-upload-supplier') && $('tariff-upload-supplier').value || (list('Supplier')[0] && list('Supplier')[0].supplier_id);
  if (!supplier) return failLocal('Create a Supplier first — every tariff belongs to one.');
  if (button && button.disabled !== undefined) button.disabled = true;
  try {
    const content = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '').split(',')[1] || ''); reader.onerror = () => reject(new Error('The selected PDF could not be read.')); reader.readAsDataURL(file); });
    const result = await api('uploadSourceDocument', { adapter_key: 'GENERIC_PDF_TARIFF', supplier_id: supplier, file_name: file.name, mime_type: 'application/pdf', content_base64: content, idempotency_key: 'TARIFF-PDF:' + file.name + ':' + file.size }, 'LOCAL_STAFF');
    if (result) {
      if (input) input.value = '';
      showMessage('Tariff uploaded', 'The PDF was extracted as a review proposal. Open the tariff to confirm facts and rates before trusting it.', 'ok');
    }
  } finally {
    if (button && button.disabled !== undefined) button.disabled = false;
  }
}

function openTariffRecord(tariffId) {
  setWorkspaceId('tariff', tariffId);
  if (currentTab() === 'tariffs') render();
  else window.location.hash = 'tariffs';
}

function clearTariffRecord() {
  clearWorkspaceId('tariff');
  render();
}

function renderTariffLibrary() {
  const tariffs = list('TariffSource');
  const selectedId = selectedWorkspaceId('tariff');
  if (selectedId) {
    const selectedTariff = latest('TariffSource', (item) => item.tariff_source_id === selectedId);
    if (!selectedTariff) {
      clearWorkspaceId('tariff');
      return renderTariffLibrary();
    }
    const facts = list('TariffExtractionFact', (item) => item.tariff_source_id === selectedTariff.tariff_source_id);
    const rates = list('TariffRateComponent', (item) => item.tariff_source_id === selectedTariff.tariff_source_id);
    const itinerary = list('TariffItineraryComponent', (item) => item.tariff_source_id === selectedTariff.tariff_source_id);
    const unresolved = facts.filter((item) => item.ambiguous || item.review_status !== 'CONFIRMED' || Number(item.confidence || 0) < 0.8);
    const extractionSummary = '<div class="card"><h3>Extraction summary</h3><p class="muted">The count is informational. Review the interpretation fields and only the flagged uncertainties.</p><div class="grid3">' + field('Hotels', (selectedTariff.extraction_summary || {}).hotels || 'Not recorded') + field('Regions', (selectedTariff.extraction_summary || {}).regions || 'Not recorded') + field('Durations', (selectedTariff.extraction_summary || {}).durations || 'Not recorded') + field('Occupancy types', (selectedTariff.extraction_summary || {}).occupancy_types || 'Not recorded') + field('Rate components found', rates.length) + field('Itinerary components', itinerary.length) + '</div></div>';
    const review = extractionSummary + (selectedTariff.trusted ? trustedTariffDetails(selectedTariff) : '<p class="muted">Extraction is a proposal. Review and correct facts and conditional cells before activating this version.</p>' + tariffReviewRows(selectedTariff) + manualRateEditor(selectedTariff) + '<div class="row-actions"><button class="secondary" onclick="saveTariffReview(\'' + esc(selectedTariff.tariff_source_id) + '\', false)">Save review state</button><button onclick="saveTariffReview(\'' + esc(selectedTariff.tariff_source_id) + '\', true)">Confirm and trust tariff</button></div>');
    $('tariff-content').innerHTML = '<div class="selection-bar"><button class="secondary" onclick="clearTariffRecord()">Back to Tariff Library</button><strong>' + esc(selectedTariff.supplier_name || readableSupplierName(selectedTariff.supplier_id)) + '</strong><span>' + esc(selectedTariff.original_source && selectedTariff.original_source.file_name || selectedTariff.file_name || 'Tariff source') + '</span></div><article class="card ' + (selectedTariff.trusted ? 'good' : 'warn') + '"><div class="panel-head"><div><h3>Tariff review</h3><p class="muted">Version ' + esc(selectedTariff.tariff_source_id) + '</p></div>' + status(selectedTariff.trusted ? 'Trusted / active' : 'Needs review', selectedTariff.trusted ? 'good' : 'warn') + '</div><div class="grid3">' + field('Extraction', (selectedTariff.extraction_summary || {}).method === 'NATIVE_DOCX_OOXML' ? 'Native DOCX extraction' : (selectedTariff.extraction_summary || {}).method || 'Recorded') + field('Rate components', rates.length) + field('Itinerary components', itinerary.length) + '</div>' + review + (unresolved.length ? '<div class="card warn"><strong>' + unresolved.length + ' item(s) require staff confirmation.</strong><p>Currency and rate basis are never silently assumed.</p></div>' : '') + '<details class="secondary-details"><summary>Technical / Provenance</summary><p class="muted">Source document and extraction records are retained and linked to this tariff version.</p><p class="muted">Source: ' + esc(sourceProvenance(selectedTariff.original_source)) + '</p></details></article>';
    return;
  }
  const rows = tariffs.map((tariff) => {
    const facts = list('TariffExtractionFact', (item) => item.tariff_source_id === tariff.tariff_source_id);
    const rates = list('TariffRateComponent', (item) => item.tariff_source_id === tariff.tariff_source_id);
    const itinerary = list('TariffItineraryComponent', (item) => item.tariff_source_id === tariff.tariff_source_id);
    const summary = tariff.extraction_summary || {};
    const unresolved = facts.filter((item) => item.ambiguous || item.review_status !== 'CONFIRMED' || Number(item.confidence || 0) < 0.8);
    return '<tr><td><strong>' + esc(tariff.supplier_name || readableSupplierName(tariff.supplier_id)) + '</strong></td><td>' + esc(tariff.original_source && tariff.original_source.file_name || tariff.file_name || 'Supplier tariff') + '</td><td>' + esc(tariff.tariff_source_id) + '</td><td>' + esc(summary.method === 'NATIVE_DOCX_OOXML' ? 'Native DOCX' : summary.method || 'Recorded') + '</td><td>' + esc(rates.length + ' rates · ' + itinerary.length + ' itinerary') + '</td><td>' + status(tariff.trusted ? 'Trusted / active' : 'Needs review', tariff.trusted ? 'good' : 'warn') + (unresolved.length ? '<br><span class="muted">' + unresolved.length + ' review item(s)</span>' : '') + '</td><td><button class="secondary" onclick="openTariffRecord(\'' + esc(tariff.tariff_source_id) + '\')">Open tariff</button> <button class="secondary" onclick="deleteTariffVersion(\'' + esc(tariff.tariff_source_id) + '\')">Delete</button></td></tr>';
  }).join('');
  $('tariff-content').innerHTML = tariffUploadPanel() + '<div class="panel"><div class="panel-head"><div><h3>Tariff sources</h3><p class="muted">Select a tariff to review, correct, or inspect its conditional rate matrix.</p></div></div>' + (rows ? '<div class="table-wrap"><table><thead><tr><th>Supplier</th><th>Source document</th><th>Version</th><th>Extraction</th><th>Contents</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="empty">No tariff versions have been uploaded.</div>') + '</div><details class="secondary-details"><summary>How tariff matching works</summary><p class="muted">Tariff upload never creates a quotation. Requirements are captured in an Inquiry first, then trusted tariff information is used to return multiple candidates for staff selection.</p></details>';
  return;
  const cards = tariffs.map((tariff) => {
    const facts = list('TariffExtractionFact', (item) => item.tariff_source_id === tariff.tariff_source_id);
    const rates = list('TariffRateComponent', (item) => item.tariff_source_id === tariff.tariff_source_id);
    const itinerary = list('TariffItineraryComponent', (item) => item.tariff_source_id === tariff.tariff_source_id);
    const unresolved = facts.filter((item) => item.ambiguous || item.review_status !== 'CONFIRMED' || Number(item.confidence || 0) < 0.8);
    const document = latest('Document', (item) => item.document_id === tariff.source_document_id || (item.checksum && tariff.original_source && item.checksum === tariff.original_source.checksum));
    const summary = tariff.extraction_summary || {};
    return '<article class="card ' + (tariff.trusted ? 'good' : 'warn') + '"><div class="panel-head"><div><h3>' + esc(tariff.supplier_name || readableSupplierName(tariff.supplier_id)) + '</h3><p class="muted">' + esc(tariff.original_source && tariff.original_source.file_name || tariff.file_name || 'Supplier tariff') + ' · Version ' + esc(tariff.tariff_source_id) + '</p></div>' + status(tariff.trusted ? 'Trusted / active' : 'Needs review', tariff.trusted ? 'good' : 'warn') + '</div><div class="grid3">' + field('Extraction', summary.method === 'NATIVE_DOCX_OOXML' ? 'Native DOCX extraction' : summary.method || 'Recorded') + field('Rate components', rates.length) + field('Itinerary components', itinerary.length) + field('Source document', document ? 'Retained locally · ' + document.document_id : 'Source reference retained') + '</div>' + (tariff.trusted ? trustedTariffDetails(tariff) : '<p class="muted">Extraction is a proposal. Review and correct facts and conditional cells before activating this version.</p>' + tariffReviewRows(tariff) + '<div class="row-actions"><button class="secondary" onclick="saveTariffReview(\'' + esc(tariff.tariff_source_id) + '\', false)">Save review state</button><button onclick="saveTariffReview(\'' + esc(tariff.tariff_source_id) + '\', true)">Confirm and trust tariff</button></div>') + (unresolved.length ? '<div class="card warn"><strong>' + unresolved.length + ' extraction item(s) still require staff confirmation.</strong><p>Currency and rate basis are never silently assumed.</p></div>' : '') + '</article>';
  }).join('');
  $('tariff-content').innerHTML = tariffUploadPanel() + (cards || '<div class="empty">No tariff versions have been uploaded.</div>') + '<div class="card"><h3>Matching rule</h3><p class="muted">Tariff upload never creates a quotation. Requirements are captured in an Inquiry first, then trusted tariff information is used to return multiple candidates for staff selection.</p></div>';
}

async function createBlankTariff(button) {
  const supplier = $('tariff-upload-supplier') && $('tariff-upload-supplier').value || (list('Supplier')[0] && list('Supplier')[0].supplier_id);
  if (!supplier) return failLocal('Create a Supplier first — every tariff belongs to one.');
  const currency = ($('blank-currency') && $('blank-currency').value || 'PHP').trim().toUpperCase();
  const unit = $('blank-unit') && $('blank-unit').value;
  if (!unit) return failLocal('Choose the rate basis for this tariff.');
  if (button && button.disabled !== undefined) button.disabled = true;
  try {
    const result = await api('createManualTariff', { supplier_id: supplier, currency, rate_unit: unit, validity_start: $('blank-valid-start') && $('blank-valid-start').value || undefined, validity_end: $('blank-valid-end') && $('blank-valid-end').value || undefined }, 'LOCAL_STAFF');
    if (result) {
      showMessage('Blank tariff created', 'Add rate rows on the review screen, then Confirm and trust tariff when the matrix is complete.', 'ok');
      openTariffRecord(result.tariff_source_id);
    }
  } finally {
    if (button && button.disabled !== undefined) button.disabled = false;
  }
}

function manualRateEditor(tariff) {
  if (tariff.trusted) return '';
  const rates = list('TariffRateComponent', (item) => item.tariff_source_id === tariff.tariff_source_id && !item.requires_explicit_review);
  const rows = rates.map((rate) => '<tr><td>' + esc(conditionSummary(rate.conditions)) + '</td><td>' + esc(rate.amount + ' ' + (rate.currency || '')) + '</td><td><span class="muted">' + esc(readableUnit(rate.rate_unit) || '') + '</span></td><td class="row-actions"><button class="secondary" onclick="removeTariffRateRow(\'' + esc(rate.tariff_rate_component_id) + '\')">Remove</button></td></tr>').join('');
  const addForm = '<details class="compact-form" style="margin-top:12px"><summary>＋ Add rate row</summary><div class="grid3" style="margin-top:10px">' +
    '<div class="field"><label>Hotel *</label><input id="mr-hotel" placeholder="e.g. Grand Plaza Hotel 4*"></div>' +
    '<div class="field"><label>Room type</label><input id="mr-room" placeholder="e.g. Deluxe"></div>' +
    '<div class="field"><label>Occupancy *</label><select id="mr-occ"><option value="SGL">SGL</option><option value="TWN">TWN</option><option value="TRP">TRP</option><option value="TWN/TRP">TWN/TRP (one price)</option><option value="DBL">DBL</option><option value="QUAD">QUAD</option></select></div>' +
    '<div class="field"><label>Days *</label><input id="mr-days" type="number" min="1" max="60" value="3"></div>' +
    '<div class="field"><label>Nights</label><input id="mr-nights" type="number" min="0" max="60" placeholder="days − 1"></div>' +
    '<div class="field"><label>Amount *</label><input id="mr-amount" placeholder="e.g. 150"></div>' +
    '<div class="field"><label>Region (optional)</label><input id="mr-region" placeholder="e.g. Downtown"></div>' +
    '<div class="field"><label>Destination (optional)</label><input id="mr-destination" placeholder="e.g. Seoul"></div>' +
    '<div class="field"><label>&nbsp;</label><button onclick="addManualTariffRate(\'' + esc(tariff.tariff_source_id) + '\')">Add rate</button></div>' +
    '</div></details>';
  return '<div class="card"><h3>Manually encoded rates</h3><p class="muted">These rows were entered by staff; they are confirmed on entry. Complete the matrix, then use Confirm and trust tariff above.</p>' +
    (rows ? '<div class="table-wrap"><table><thead><tr><th>Conditions</th><th>Amount</th><th>Rate basis</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<p class="muted">No manual rates yet — add the first row below.</p>') + addForm + '</div>';
}

async function addManualTariffRate(tariffId) {
  const hotel = $('mr-hotel') && $('mr-hotel').value.trim();
  if (!hotel) return failLocal('Enter the hotel name.');
  const amount = $('mr-amount') && $('mr-amount').value.trim();
  if (!amount) return failLocal('Enter the amount.');
  const result = await api('addTariffRate', {
    tariff_source_id: tariffId,
    hotel,
    room_type: $('mr-room') && $('mr-room').value.trim() || undefined,
    room_arrangement: $('mr-occ') && $('mr-occ').value,
    duration_days: $('mr-days') && $('mr-days').value,
    nights: $('mr-nights') && $('mr-nights').value || undefined,
    amount,
    region: $('mr-region') && $('mr-region').value.trim() || undefined,
    destination: $('mr-destination') && $('mr-destination').value.trim() || undefined
  }, 'LOCAL_STAFF');
  if (result) showMessage('Rate added', 'The row was added as confirmed staff entry. Add the next one or trust the tariff when complete.', 'ok');
}

async function removeTariffRateRow(rateId) {
  if (!window.confirm('Remove this rate row from the tariff?')) return;
  const result = await api('removeTariffRate', { tariff_rate_component_id: rateId }, 'LOCAL_STAFF');
  if (result) showMessage('Rate removed', 'The row was deleted from this tariff version.', 'ok');
}

async function uploadTariffPaste(button) {
  const text = $('tariff-paste-text') && $('tariff-paste-text').value.trim();
  if (!text) return failLocal('Paste the extracted tariff text first.');
  const supplier = $('tariff-upload-supplier') && $('tariff-upload-supplier').value || (list('Supplier')[0] && list('Supplier')[0].supplier_id);
  if (!supplier) return failLocal('Create a Supplier first — every tariff belongs to one.');
  const supplierName = (latest('Supplier', (item) => item.supplier_id === supplier) || {}).display_name || undefined;
  if (button && button.disabled !== undefined) button.disabled = true;
  try {
    const content = btoa(unescape(encodeURIComponent(text)));
    const result = await api('uploadSourceDocument', { adapter_key: 'PASTE_TARIFF_TEXT', supplier_id: supplier, supplier_name: supplierName, file_name: 'pasted-tariff-' + Date.now() + '.txt', mime_type: 'text/plain', content_base64: content, idempotency_key: 'TARIFF-PASTE:' + content.length + ':' + content.slice(0, 64) }, 'LOCAL_STAFF');
    if (result) {
      $('tariff-paste-text').value = '';
      showMessage('Tariff created from pasted text', 'Open the tariff to review the parsed rates and confirm currency and rate unit before trusting it.', 'ok');
    }
  } finally {
    if (button && button.disabled !== undefined) button.disabled = false;
  }
}

async function deleteTariffVersion(tariffId) {
  const tariff = latest('TariffSource', (item) => item.tariff_source_id === tariffId);
  if (!tariff) return failLocal('That tariff version is no longer available.');
  const name = tariff.original_source && tariff.original_source.file_name || tariff.file_name || tariff.tariff_source_id;
  if (!window.confirm('Delete tariff ' + tariff.tariff_source_id + ' (' + name + ')?\n\nThis permanently removes the tariff version and its extracted rates and facts. The uploaded source document stays retained as evidence. Tariffs already used for matching options cannot be deleted.\n\nThis action requires manager authority and is fully audited.')) return;
  const result = await api('deleteTariff', { tariff_source_id: tariffId, confirm: true }, 'LOCAL_MANAGER');
  if (!result) return; // api() already displayed the precise blocking reason
  clearWorkspaceId('tariff');
  showMessage('Tariff deleted', tariff.tariff_source_id + ' and its extracted records were removed. The source document remains retained as evidence.', 'ok');
}

async function uploadSyntheticTariff() {  const supplier = $('tariff-upload-supplier') && $('tariff-upload-supplier').value || (list('Supplier')[0] && list('Supplier')[0].supplier_id);
  if (!supplier) return failLocal('Create or seed a Supplier before uploading a tariff.');
  await api('uploadTariff', { supplier_id: supplier, file_name: 'Generic Supplier — local synthetic tariff', file_ref: 'local://generic-synthetic-tariff', original_source: { file_name: 'Generic Supplier — local synthetic tariff', source_type: 'LOCAL_SYNTHETIC' }, extraction_summary: { source: 'LOCAL_SYNTHETIC_FIXTURE', review_required: true }, extraction_facts: [{ field_name: 'destination', normalized_value: 'Synthetic City', confidence: 1 }, { field_name: 'rate_unit', normalized_value: 'PER_PERSON', confidence: 1 }, { field_name: 'currency', normalized_value: 'PHP', confidence: 1 }], rate_components: [{ service_type: 'ACCOMMODATION_PACKAGE', amount: '10000.00', currency: 'PHP', rate_unit: 'PER_PERSON', quantity_driver: 'pax_count', conditions: { destination: 'Synthetic City', nights: 4, pax_min: 2, hotel: 'Synthetic Hotel', room_arrangement: 'TWN' }, inclusions: ['hotel accommodation', 'city tour'], exclusions: ['airfare'] }], itinerary_components: [{ day: 1, city: 'Synthetic City', activity: 'Arrival transfer and half-day city tour', included: true }] }, 'LOCAL_STAFF');
}

function openQuotationRecord(quotationId) {
  const quote = latest('Quotation', (item) => item.quotation_id === quotationId);
  const inquiryId = inquiryIdForQuotation(quote);
  if (!quote || !inquiryId) return failLocal('This quotation cannot be opened because its Inquiry lineage is missing.');
  sessionStorage.setItem('wmit.operations.selectedInquiryId', inquiryId);
  setWorkspaceId('quotation', quotationId);
  if (currentTab() === 'quotation') render();
  else window.location.hash = 'quotation';
}

function clearQuotationRecord() {
  clearWorkspaceId('quotation');
  render();
}

function quotationListMarkup() {
  const quotations = list('Quotation');
  const rows = quotations.map((quote) => {
    const option = latest('CommercialOption', (item) => item.commercial_option_id === quote.commercial_option_id);
    const inquiry = latest('Inquiry', (item) => item.inquiry_id === inquiryIdForQuotation(quote));
    const client = inquiry && latest('Client', (item) => item.client_id === inquiry.client_id);
    return '<tr><td><strong>' + esc(quote.quotation_id) + '</strong></td><td>' + esc(client && client.display_name || inquiry && inquiry.client_id || 'Not recorded') + '</td><td>' + esc(option && readableSupplierName(option.supplier_id) || 'Not recorded') + '</td><td>' + esc(quote.client_total + ' ' + (quote.currency || '')) + '</td><td>' + status(readableState(quote.status), quote.status === 'APPROVED' ? 'good' : 'warn') + '</td><td><button class="secondary" onclick="openQuotationRecord(\'' + esc(quote.quotation_id) + '\')">Open quotation</button></td></tr>';
  }).join('');
  return '<div class="panel"><div class="panel-head"><div><h3>Quotation list</h3><p class="muted">Select a quotation to review pricing, context, provenance, and approval.</p></div></div>' + (rows ? '<div class="table-wrap"><table><thead><tr><th>Quotation</th><th>Client</th><th>Supplier</th><th>Client price</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="empty">No quotations have been created.</div>') + '</div>';
}

function renderQuotation() {
  const records = caseRecords();
  const selectedId = selectedWorkspaceId('quotation');
  if (!selectedId && records.quotation) {
    $('quotation-content').innerHTML = quotationListMarkup() + '<div class="empty">Select a quotation to open its detail.</div>';
    return;
  }
  if (!selectedId && !records.quotation && !(records.option && records.option.selected) && !records.inquiry) {
    $('quotation-content').innerHTML = quotationListMarkup() + '<div class="empty">Select a quotation to open its detail, or select an Inquiry and option first.</div>';
    return;
  }
  if (selectedId && !records.quotation) {
    clearWorkspaceId('quotation');
    $('quotation-content').innerHTML = quotationListMarkup() + '<div class="empty">That quotation is no longer available.</div>';
    return;
  }
  if (!records.quotation) {
    const selectedOptionCard = records.option && records.option.selected ? '<div class="card"><h3>Prepare quotation from selected option</h3><p class="muted">The selected Commercial Option supplies trusted source context and initial pricing. The quotation editor can then refine the client-facing document.</p><div class="field"><label>Pricing context</label><select id="quote-create-context"><option value="STANDARD">Standard pricing context</option><option value="EXPO">Expo pricing context</option></select></div><button onclick="createDraftQuotation()">Create Draft Quotation</button></div>' : '';
    const manualCard = records.inquiry ? '<div class="card"><h3>Manual quotation</h3><p class="muted">Create a normal auditable draft for custom trips, hotel-only, visa-only, supplier quotes, or any request that does not need tariff matching. Add services, supplier costs, and selling prices before approval.</p><div class="grid3"><div class="field"><label>Currency</label><input id="manual-quote-currency" value="' + esc(quotationDefaults().currency || 'PHP') + '" maxlength="3"></div><div class="field"><label>Quotation date</label><input id="manual-quote-date" type="date" value="' + esc(new Date().toISOString().slice(0, 10)) + '"></div><div class="field"><label>Valid until</label><input id="manual-quote-valid-until" type="date" value="' + esc(defaultQuotationValidUntil()) + '"></div></div><button onclick="createManualDraftQuotation()">Create Manual Quotation</button></div>' : '<div class="empty">Select an Inquiry before creating a quotation.</div>';
    $('quotation-content').innerHTML = quotationDefaultsMarkup() + '<div class="grid2">' + selectedOptionCard + manualCard + '</div>';
    return;
  }
  const quote = records.quotation;
  const rules = quote.pricing_rule_snapshot || {};
  const draft = quote.status === 'DRAFT';
  const editing = draft ? '<div class="card"><h3>Review or edit draft pricing</h3><p class="muted">Changes remain internal until approval. Supplier cost remains separate from WMIT selling price.</p><div class="grid3"><div class="field"><label>Pricing context</label><select id="quote-context"><option value="STANDARD"' + (quote.pricing_context_type === 'STANDARD' ? ' selected' : '') + '>Standard pricing context</option><option value="EXPO"' + (quote.pricing_context_type === 'EXPO' ? ' selected' : '') + '>Expo pricing context</option></select></div><div class="field"><label>Markup (%)</label><input id="quote-markup" type="number" min="0" step="0.01" value="' + esc(rules.markup_percent === undefined ? 30 : rules.markup_percent) + '"></div><div class="field"><label>Fixed fees</label><input id="quote-fixed-fees" type="number" min="0" step="0.01" value="' + esc(quote.fixed_fees || '0.00') + '"></div><div class="field"><label>Visa assistance fee</label><input id="quote-visa-fee" type="number" min="0" step="0.01" value="' + esc(quote.visa_assistance_fee || '0.00') + '"></div><div class="field"><label>Payment method</label><select id="quote-payment-method"><option value="STANDARD"' + (quote.payment_method !== 'CARD_PAYPAL' ? ' selected' : '') + '>Standard</option><option value="CARD_PAYPAL"' + (quote.payment_method === 'CARD_PAYPAL' ? ' selected' : '') + '>Credit card / PayPal</option></select></div><div class="field"><label>Explicit discount</label><input id="quote-discount" type="number" min="0" step="0.01" value="' + esc(quote.discount || quote.discount_total || '0.00') + '"></div></div><p class="muted">Expo dates are applied only through the configured pricing context. The client payment sent timestamp is the eligibility fact, not the verification timestamp.</p><button onclick="saveQuotationPricing()">Save pricing changes</button></div>' : '<div class="card"><h3>Pricing locked</h3><p class="muted">This quotation is approved. Draft pricing edits are no longer available.</p></div>';
  const option = records.option;
  const items = list('QuotationItem', (item) => item.quotation_id === quote.quotation_id).sort((a, b) => Number(a.line_order || 0) - Number(b.line_order || 0));
  const approvalAction = draft ? '<button onclick="approveQuotation()">Approve Quotation</button>' : (records.quotationAcceptance ? '<span class="muted">Approval is locked because the client has accepted this quotation. Use a revision/amendment.</span>' : '<button class="secondary" onclick="cancelQuotationApproval()">Cancel approval</button><span class="status good">Approved</span>');
  $('quotation-content').innerHTML = '<div class="grid2"><div class="card ' + (draft ? 'warn' : 'good') + '"><h3>WMIT Quotation ' + status(readableState(quote.status), draft ? 'warn' : 'good') + '</h3>' + field('Quotation record', quote.quotation_id) + field('Selected supplier', option ? readableSupplierName(option.supplier_id) : 'Recorded on option') + field('Selected tariff/version', option && option.tariff_source_id || 'Provenance retained') + field('Supplier cost · internal', quote.supplier_cost_total + ' ' + quote.currency) + field('Client price', quote.client_total + ' ' + quote.currency) + field('Staff review', quote.staff_review_required ? 'Required' : 'Complete') + '<div class="row-actions">' + approvalAction + '</div></div><div class="card"><h3>Pricing explanation</h3><table><tbody><tr><td>Pricing context</td><td>' + esc(readablePricingContext(quote.pricing_context_type)) + '</td></tr><tr><td>Supplier tariff cost</td><td>' + esc(quote.supplier_cost_total) + ' ' + esc(quote.currency) + '</td></tr><tr><td>WMIT markup</td><td>' + esc(quote.markup_total) + ' ' + esc(quote.currency) + '</td></tr><tr><td>Fees</td><td>' + esc(quote.fees_total) + ' ' + esc(quote.currency) + '</td></tr><tr><td>Discount</td><td>-' + esc(quote.discount_total) + ' ' + esc(quote.currency) + ' · ' + esc(quote.discount_state || 'Not recorded') + '</td></tr><tr><th>Total client price</th><th>' + esc(quote.client_total) + ' ' + esc(quote.currency) + '</th></tr></tbody></table><p class="muted">Markup rule: ' + esc(rules.markup_percent === undefined ? 'Not recorded' : rules.markup_percent + '%') + ' · Conversion rule: ' + esc(readableRule(rules.fx_rule)) + ' · Card/PayPal rule: ' + esc(rules.card_paypal_percent === undefined ? 'Not recorded' : rules.card_paypal_percent + '%') + '</p></div></div>' + editing + '<details><summary>Readable quotation provenance</summary><p class="muted">Source: ' + esc(sourceProvenance(quote.provenance)) + '</p><p class="muted">Itinerary components retained: ' + esc((quote.itinerary_components || []).length) + '. Pricing edits recorded: ' + esc((quote.pricing_edit_history || []).length) + '.</p></details>';
  const notices = (quote.pricing_context_type === 'EXPO' ? '<div class="card warn"><strong>Expo eligibility</strong><p>' + esc(expoEligibilityMessage(quote)) + '</p></div>' : '') + '<div class="card warn"><strong>Currency conversion</strong><p>' + esc(fxInputMessage(quote)) + '</p></div>';
  $('quotation-content').insertAdjacentHTML('afterbegin', notices);
  $('quotation-content').insertAdjacentHTML('afterbegin', '<div class="selection-bar"><button class="secondary" onclick="clearQuotationRecord()">Back to Quotation list</button><strong>' + esc(quote.quotation_id) + '</strong><span>' + esc(readableState(quote.status)) + '</span></div>');
  if (quote.status === 'APPROVED') $('quotation-content').insertAdjacentHTML('beforeend', records.quotationAcceptance ? '<div class="card good"><h3>Client acceptance</h3><p>Accepted by ' + esc(records.quotationAcceptance.accepted_by) + ' on ' + esc(records.quotationAcceptance.accepted_at || 'recorded time') + '.</p></div>' : '<div class="card warn"><h3>Client acceptance required</h3><p>Record the client\'s acceptance of this approved quotation before creating a Booking.</p><div class="grid2"><div class="field"><label>Accepted by</label><input id="quote-accepted-by" placeholder="Client name or contact"></div><div class="field"><label>Acceptance reference</label><input id="quote-acceptance-reference" placeholder="Email, message, or signed reference"></div></div><button onclick="acceptQuotation()">Record Client Acceptance</button></div>');
  renderQuotationEditorAddendum(quote, records, items, draft);
}

function quotationItineraryDays(quote) {
  if (!quote || !quote.itinerary) return [];
  if (Array.isArray(quote.itinerary)) return quote.itinerary;
  try { const value = JSON.parse(String(quote.itinerary)); return Array.isArray(value) ? value : []; } catch (error) { return []; }
}

function itineraryDateForDay(quote, index) {
  if (!quote || !quote.travel_start) return '';
  const date = new Date(String(quote.travel_start) + 'T00:00:00Z');
  if (Number.isNaN(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() + Number(index || 0));
  return date.toISOString().slice(0, 10);
}

function quotationSupplierOptions(selected) {
  return '<option value="">No supplier / client-facing service</option>' + list('Supplier').map((supplier) => '<option value="' + esc(supplier.supplier_id) + '"' + (supplier.supplier_id === selected ? ' selected' : '') + '>' + esc(supplier.display_name || supplier.legal_name || supplier.supplier_id) + '</option>').join('');
}

function flightDetailsMarkup(prefix, item, disabled, hidden) {
  const value = (key) => esc(item && item[key] || '');
  return '<div id="' + prefix + 'flight-details" class="flight-details"' + (hidden ? ' hidden' : '') + '><div class="grid3"><div class="field"><label>Airline</label><input id="' + prefix + 'airline" value="' + value('airline') + '" placeholder="e.g. Philippine Airlines"' + disabled + '></div><div class="field"><label>Flight number</label><input id="' + prefix + 'flight-number" value="' + value('flight_number') + '" placeholder="e.g. PR 428"' + disabled + '></div><div class="field"><label>Departure airport</label><input id="' + prefix + 'departure-airport" value="' + value('departure_airport') + '" placeholder="e.g. MNL"' + disabled + '></div><div class="field"><label>Arrival airport</label><input id="' + prefix + 'arrival-airport" value="' + value('arrival_airport') + '" placeholder="e.g. NRT"' + disabled + '></div><div class="field"><label>Departure time</label><input id="' + prefix + 'departure-time" type="time" value="' + value('departure_time') + '"' + disabled + '></div><div class="field"><label>Arrival time</label><input id="' + prefix + 'arrival-time" type="time" value="' + value('arrival_time') + '"' + disabled + '></div><div class="field"><label>Checked baggage (kg)</label><input id="' + prefix + 'checkin-baggage-kg" type="number" min="0" step="0.1" value="' + value('checkin_baggage_kg') + '"' + disabled + '></div><div class="field"><label>Hand carry (kg)</label><input id="' + prefix + 'hand-carry-baggage-kg" type="number" min="0" step="0.1" value="' + value('hand_carry_baggage_kg') + '"' + disabled + '></div></div></div>';
}

function toggleFlightDetails(serviceId, detailsId) {
  const service = $(serviceId);
  const details = $(detailsId);
  if (details) details.hidden = !service || service.value !== 'Flight';
}

function flightInputValues(prefix, serviceType) {
  if (serviceType !== 'Flight') return {};
  const value = (id) => ($(prefix + id) && $(prefix + id).value || '').trim();
  return { airline: value('airline') || undefined, flight_number: value('flight-number') || undefined, departure_airport: value('departure-airport') || undefined, arrival_airport: value('arrival-airport') || undefined, departure_time: value('departure-time') || undefined, arrival_time: value('arrival-time') || undefined, checkin_baggage_kg: value('checkin-baggage-kg') || undefined, hand_carry_baggage_kg: value('hand-carry-baggage-kg') || undefined };
}

function flightDurationLabel(departureTime, arrivalTime) {
  if (!departureTime || !arrivalTime) return 'Not recorded';
  const parse = (value) => { const parts = String(value).split(':').map(Number); return parts.length >= 2 && parts.every(Number.isFinite) ? parts[0] * 60 + parts[1] : null; };
  const departure = parse(departureTime);
  const arrival = parse(arrivalTime);
  if (departure === null || arrival === null) return 'Not recorded';
  let minutes = arrival - departure;
  if (minutes < 0) minutes += 24 * 60;
  return Math.floor(minutes / 60) + 'h' + (minutes % 60 ? ' ' + (minutes % 60) + 'm' : '');
}

function layoverDetailsMarkup(prefix, item, disabled) {
  const value = (key) => esc(item && item[key] || '');
  return '<div class="grid3"><div class="field"><label>Layover airport</label><input id="' + prefix + 'layover-airport" value="' + value('layover_airport') + '" placeholder="e.g. HKG"' + disabled + '></div><div class="field"><label>Layover duration (hours)</label><input id="' + prefix + 'layover-duration-hours" type="number" min="0" step="0.1" value="' + value('layover_duration_hours') + '"' + disabled + '></div><div class="field"><label>Layover notes</label><input id="' + prefix + 'layover-notes" value="' + value('layover_notes') + '" placeholder="Optional"' + disabled + '></div></div>';
}

function quotationFlightDetails(quote) {
  if (!quote || !quote.flight_details) return [];
  if (Array.isArray(quote.flight_details)) return quote.flight_details;
  try {
    const parsed = JSON.parse(String(quote.flight_details));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function quotationFlightDetailsMarkup(quote, draft) {
  const storedFlights = quotationFlightDetails(quote);
  const flights = storedFlights.length ? storedFlights : (draft ? [{}] : []);
  const disabled = draft ? '' : ' disabled';
  const cards = flights.map((flight, index) => {
    const date = flight.flight_date || flight.service_start || (index === 0 ? quote.travel_start : '') || '';
    const actions = draft ? '<div class="row-actions"><button class="secondary compact" onclick="saveQuotationFlights()">Save flight details</button>' + (flights.length > 1 ? '<button class="danger compact" onclick="removeQuotationFlight(' + index + ')">Remove flight</button>' : '') + '</div>' : '';
    const segmentType = String(flight.segment_type || 'FLIGHT').toUpperCase() === 'LAYOVER' ? 'LAYOVER' : 'FLIGHT';
    const detailMarkup = segmentType === 'LAYOVER' ? layoverDetailsMarkup('qflight-' + index + '-', flight, disabled) : flightDetailsMarkup('qflight-' + index + '-', flight, disabled, false);
    return '<div class="card flight-detail-card" data-flight-index="' + index + '" data-segment-type="' + segmentType + '"><div class="panel-head"><div><h4>' + (segmentType === 'LAYOVER' ? 'Layover ' : 'Flight ') + (index + 1) + '</h4><p class="muted">' + (segmentType === 'LAYOVER' ? 'Record a connection between flights.' : 'Flight information appears in the client quotation when recorded.') + '</p></div><span class="muted">' + esc(date || 'Date not recorded') + '</span></div><div class="field"><label>' + (segmentType === 'LAYOVER' ? 'Layover date' : 'Flight date') + '</label><input id="qflight-' + index + '-date" type="date" value="' + esc(date) + '"' + disabled + '></div>' + detailMarkup + actions + '</div>';
  }).join('');
  const add = draft ? '<div class="row-actions"><button class="secondary" onclick="addQuotationFlight()">+ Add flight</button><button class="secondary" onclick="addQuotationLayover()">+ Add layover</button></div>' : '';
  const empty = !cards ? '<p class="muted">No flight details recorded.</p>' : '';
  return '<div id="quotation-flight-details" class="card quotation-flight-section"><div class="panel-head"><div><h4>Air itinerary</h4><p class="muted">Record flights, connections, duration, and baggage. These details are separate from quotation pricing items.</p></div></div>' + cards + empty + add + '</div>';
}

function bulletListMarkup(value, fallback) {
  const lines = String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length ? '<ul class="quote-bullets">' + lines.map((line) => '<li>' + esc(line) + '</li>').join('') + '</ul>' : '<p class="muted">' + esc(fallback) + '</p>';
}

function addClientFlightDetailsSection(preview) {
  if (!preview) return;
  const target = document.querySelector('#quotation-preview .preview-section');
  if (!target) return;
  const quotationFlights = preview.quotation && Array.isArray(preview.quotation.flight_details) ? preview.quotation.flight_details : [];
  const flightItems = quotationFlights.length ? quotationFlights : (preview.items || []).filter((item) => item.service_type === 'Flight');
  if (!flightItems.length) return;
  const flightRows = flightItems.map((item) => '<tr><td>' + esc(item.description || 'Flight') + '</td><td>' + esc(item.airline || 'Not recorded') + '</td><td>' + esc(item.flight_number || 'Not recorded') + '</td><td>' + esc(item.departure_airport || '—') + ' → ' + esc(item.arrival_airport || '—') + '</td><td>' + esc(item.departure_time || '—') + ' → ' + esc(item.arrival_time || '—') + '</td></tr>').join('');
  target.insertAdjacentHTML('beforebegin', '<section class="preview-section client-flight-details"><h3>Flight details</h3><div class="table-wrap"><table><thead><tr><th>Service</th><th>Airline</th><th>Flight</th><th>Route</th><th>Schedule</th></tr></thead><tbody>' + flightRows + '</tbody></table></div></section>');
}

function formatClientFlightDetails(preview) {
  const section = document.querySelector('#quotation-preview .client-flight-details');
  const table = section && section.querySelector('table');
  if (!section || !table) return;
  const quotationFlights = preview.quotation && Array.isArray(preview.quotation.flight_details) ? preview.quotation.flight_details : [];
  const flightItems = quotationFlights.length ? quotationFlights : (preview.items || []).filter((item) => item.service_type === 'Flight');
  section.querySelector('h3').textContent = 'Air itinerary';
  table.querySelector('thead').innerHTML = '<tr><th>Airline / stop</th><th>Number</th><th>Route</th><th>Schedule</th><th>Duration</th><th>Baggage</th></tr>';
  table.querySelector('tbody').innerHTML = flightItems.map((item) => {
    const layover = String(item.segment_type || 'FLIGHT').toUpperCase() === 'LAYOVER';
    const baggage = layover ? '-' : [item.checkin_baggage_kg ? 'Checked ' + item.checkin_baggage_kg + ' kg' : '', item.hand_carry_baggage_kg ? 'Hand carry ' + item.hand_carry_baggage_kg + ' kg' : ''].filter(Boolean).join(' / ') || 'Not recorded';
    const route = layover ? item.layover_airport || 'Not recorded' : (item.departure_airport || '-') + ' → ' + (item.arrival_airport || '-');
    const schedule = item.departure_time || item.arrival_time ? (item.departure_time || '-') + ' → ' + (item.arrival_time || '-') : '-';
    const duration = layover ? (item.layover_duration_hours ? item.layover_duration_hours + 'h' : 'Not recorded') : flightDurationLabel(item.departure_time, item.arrival_time);
    return '<tr><td>' + esc(layover ? 'Layover' : item.airline || 'Not recorded') + '</td><td>' + esc(layover ? '-' : item.flight_number || 'Not recorded') + '</td><td>' + esc(route) + '</td><td>' + esc(schedule) + '</td><td>' + esc(duration) + '</td><td>' + esc(baggage) + '</td></tr>';
  }).join('');
}

function applyClientPreviewFormatting(preview) {
  formatClientFlightDetails(preview);
  const previewRoot = document.querySelector('#quotation-preview');
  const previewMeta = previewRoot && previewRoot.querySelector('.quote-meta');
  if (previewMeta && !previewMeta.querySelector('.prepared-by')) {
    previewMeta.insertAdjacentHTML('afterbegin', '<div class="prepared-by"><strong>Prepared by:</strong><br>' + esc(readablePreparedBy(preview.quotation && preview.quotation.prepared_by)) + '</div>');
  }
  const serviceTable = previewRoot && Array.from(previewRoot.querySelectorAll('.preview-section table')).find((table) => Array.from(table.querySelectorAll('th')).some((header) => header.textContent.trim() === 'Dates'));
  if (serviceTable) {
    const dateIndex = Array.from(serviceTable.querySelectorAll('th')).findIndex((header) => header.textContent.trim() === 'Dates');
    serviceTable.querySelectorAll('tr').forEach((row) => { const cell = row.children[dateIndex]; if (cell) cell.remove(); });
  }
  const discount = Number(preview && preview.quotation && preview.quotation.discount_total || 0);
  if (!(discount > 0)) {
    const discountRow = Array.from(document.querySelectorAll('#quotation-preview .preview-total > div')).find((row) => row.textContent.trim().startsWith('Discount'));
    if (discountRow) discountRow.remove();
  }
  const values = { Inclusions: preview && preview.quotation && preview.quotation.inclusions, Exclusions: preview && preview.quotation && preview.quotation.exclusions };
  Array.from(document.querySelectorAll('#quotation-preview .quote-columns > div')).forEach((column) => {
    const heading = column.querySelector('h3');
    const value = heading && values[heading.textContent.trim()];
    if (heading && value !== undefined) {
      const existing = column.querySelector('p');
      if (existing) existing.outerHTML = bulletListMarkup(value, heading.textContent.trim() === 'Inclusions' ? 'As listed above.' : 'Not specified.');
    }
  });
}

function quotationItemEditorRow(item, draft) {
  const disabled = draft ? '' : ' disabled';
  const actions = draft ? '<button class="secondary compact" onclick="saveQuotationItem(\'' + esc(item.quotation_item_id) + '\')">Save</button><button class="secondary compact" onclick="moveQuotationItem(\'' + esc(item.quotation_item_id) + '\',-1)">↑</button><button class="secondary compact" onclick="moveQuotationItem(\'' + esc(item.quotation_item_id) + '\',1)">↓</button><button class="danger compact" onclick="removeQuotationItemFromEditor(\'' + esc(item.quotation_item_id) + '\')">Remove</button>' : '<span class="muted">Approved</span>';
  const id = esc(item.quotation_item_id);
  return '<tr><td>' + esc(item.line_order || '') + '</td><td><select id="qitem-service-' + id + '" onchange="toggleFlightDetails(\'qitem-service-' + id + '\',\'qitem-flight-details-' + id + '\')"' + disabled + '><option' + (item.service_type === 'Flight' ? ' selected' : '') + '>Flight</option><option' + (item.service_type === 'Hotel' ? ' selected' : '') + '>Hotel</option><option' + (item.service_type === 'Transfer' ? ' selected' : '') + '>Transfer</option><option' + (item.service_type === 'Tour' ? ' selected' : '') + '>Tour</option><option' + (item.service_type === 'Tour Package' ? ' selected' : '') + '>Tour Package</option><option' + (item.service_type === 'Land Arrangement' ? ' selected' : '') + '>Land Arrangement</option><option' + (item.service_type === 'Ticket' ? ' selected' : '') + '>Ticket</option><option' + (item.service_type === 'Other' ? ' selected' : '') + '>Other</option></select></td><td><input id="qitem-description-' + id + '" value="' + esc(item.description) + '"' + disabled + '>' + flightDetailsMarkup('qitem-' + id + '-', item, disabled, item.service_type !== 'Flight') + '</td><td><label class="muted">Internal supplier (staff only)</label><select id="qitem-supplier-' + id + '"' + disabled + '>' + quotationSupplierOptions(item.supplier_id) + '</select></td><td><input id="qitem-quantity-' + id + '" type="number" min="0.01" step="0.01" value="' + esc(item.quantity) + '"' + disabled + '></td><td><input id="qitem-cost-' + id + '" type="number" min="0" step="0.01" value="' + esc(item.unit_cost) + '"' + disabled + '></td><td><input id="qitem-price-' + id + '" type="number" min="0" step="0.01" value="' + esc(item.unit_selling_price) + '"' + disabled + '></td><td>From quotation travel dates</td><td>' + actions + '</td></tr>';
}

function quotationItemEditorRowClean(item, draft) {
  const disabled = draft ? '' : ' disabled';
  const actions = draft ? '<button class="secondary compact" onclick="saveQuotationItem(\'' + esc(item.quotation_item_id) + '\')">Save</button><button class="secondary compact" onclick="moveQuotationItem(\'' + esc(item.quotation_item_id) + '\',-1)">↑</button><button class="secondary compact" onclick="moveQuotationItem(\'' + esc(item.quotation_item_id) + '\',1)">↓</button><button class="danger compact" onclick="removeQuotationItemFromEditor(\'' + esc(item.quotation_item_id) + '\')">Remove</button>' : '<span class="muted">Approved</span>';
  const id = esc(item.quotation_item_id);
  return '<tr><td>' + esc(item.line_order || '') + '</td><td><select id="qitem-service-' + id + '"' + disabled + '><option' + (item.service_type === 'Flight' ? ' selected' : '') + '>Flight</option><option' + (item.service_type === 'Hotel' ? ' selected' : '') + '>Hotel</option><option' + (item.service_type === 'Transfer' ? ' selected' : '') + '>Transfer</option><option' + (item.service_type === 'Tour' ? ' selected' : '') + '>Tour</option><option' + (item.service_type === 'Tour Package' ? ' selected' : '') + '>Tour Package</option><option' + (item.service_type === 'Land Arrangement' ? ' selected' : '') + '>Land Arrangement</option><option' + (item.service_type === 'Ticket' ? ' selected' : '') + '>Ticket</option><option' + (item.service_type === 'Other' ? ' selected' : '') + '>Other</option></select></td><td><input id="qitem-description-' + id + '" value="' + esc(item.description) + '"' + disabled + '></td><td><label class="muted">Internal supplier (staff only)</label><select id="qitem-supplier-' + id + '"' + disabled + '>' + quotationSupplierOptions(item.supplier_id) + '</select></td><td><input id="qitem-quantity-' + id + '" type="number" min="0.01" step="0.01" value="' + esc(item.quantity) + '"' + disabled + '></td><td><input id="qitem-cost-' + id + '" type="number" min="0" step="0.01" value="' + esc(item.unit_cost) + '"' + disabled + '></td><td><input id="qitem-price-' + id + '" type="number" min="0" step="0.01" value="' + esc(item.unit_selling_price) + '"' + disabled + '></td><td>From quotation travel dates</td><td>' + actions + '</td></tr>';
}

function clientQuotationPreviewMarkup(preview) {
  const q = preview.quotation || {};
  const days = q.itinerary_days || [];
  const itinerary = days.length ? '<section class="preview-section"><h3>Itinerary</h3>' + days.map((day) => '<div class="preview-day"><strong>Day ' + esc(day.day) + (day.date ? ' · ' + esc(day.date) : '') + ' — ' + esc(day.title || day.city || 'Travel day') + '</strong>' + (day.city ? '<div>' + esc(day.city) + '</div>' : '') + (day.activities ? '<p>' + esc(day.activities) + '</p>' : '') + (day.meals ? '<div><strong>Meals:</strong> ' + esc(day.meals) + '</div>' : '') + (day.overnight ? '<div><strong>Overnight:</strong> ' + esc(day.overnight) + '</div>' : '') + (day.notes ? '<div class="muted">' + esc(day.notes) + '</div>' : '') + '</div>').join('') + '</section>' : '';
  const rows = (preview.items || []).map((item) => { const flight = item.service_type === 'Flight' ? [item.airline, item.flight_number, item.departure_airport && item.arrival_airport ? item.departure_airport + ' → ' + item.arrival_airport : item.departure_airport || item.arrival_airport, item.departure_time && item.arrival_time ? item.departure_time + '–' + item.arrival_time : item.departure_time || item.arrival_time].filter(Boolean).join(' · ') : ''; const dates = q.travel_start ? q.travel_start + (q.travel_end ? ' – ' + q.travel_end : '') : ''; return '<tr><td>' + esc(item.service_type || 'Service') + '</td><td>' + esc(item.description || '') + (flight ? '<div class="muted">' + esc(flight) + '</div>' : '') + '</td><td>' + esc(dates) + '</td><td>' + esc(item.quantity) + '</td><td class="money">' + esc(item.amount) + ' ' + esc(item.currency || q.currency || '') + '</td></tr>'; }).join('');
  return '<article id="quotation-preview" class="client-preview"><div class="preview-actions"><span class="eyebrow">Client-facing preview</span><button class="secondary" onclick="printQuotation()">Print</button></div><header class="quote-header"><img class="quote-brand-image" src="/assets/header.png" alt="World Master International Travel"><div class="quote-label">QUOTATION</div></header><div class="quote-meta"><div><strong>Prepared for</strong><br>' + esc(preview.client && preview.client.name || 'Client') + '</div><div><strong>Destination</strong><br>' + esc(q.destination || '—') + '</div><div><strong>Travel dates</strong><br>' + esc(q.travel_start || '—') + ' to ' + esc(q.travel_end || '—') + '<br>' + esc(q.pax_count || '—') + ' passenger(s)</div><div><strong>Quotation date</strong><br>' + esc(q.quotation_date || '—') + '<br>Valid until ' + esc(q.valid_until || '—') + '</div></div>' + itinerary + '<section class="preview-section"><h3>Travel services</h3><div class="table-wrap"><table><thead><tr><th>Service</th><th>Description</th><th>Dates</th><th>Qty</th><th>Amount</th></tr></thead><tbody>' + (rows || '<tr><td colspan="5">No services recorded.</td></tr>') + '</tbody></table></div><div class="preview-total"><div>Discount <span>-' + esc(q.discount_total || 0) + ' ' + esc(q.currency || '') + '</span></div><div>Fees and taxes <span>' + esc(Number(q.fees_total || 0) + Number(q.tax_total || 0)) + ' ' + esc(q.currency || '') + '</span></div><div class="grand-total">Total <span>' + esc(q.client_total || 0) + ' ' + esc(q.currency || '') + '</span></div></div></section><div class="quote-columns"><div><h3>Inclusions</h3><p>' + esc(q.inclusions || 'As listed above.') + '</p></div><div><h3>Exclusions</h3><p>' + esc(q.exclusions || 'Not specified.') + '</p></div></div><section class="quote-terms"><h3>Payment terms and notes</h3><p>' + esc(q.payment_terms || 'Payment terms to be confirmed.') + '</p><p>' + esc(q.client_notes || '') + '</p></section><footer class="quote-footer">World Master International Travel<br>Philippines | Please contact WMIT for questions about this quotation.</footer></article>';
}

function quotationEditorMarkup(quote, records, items, draft) {
  const disabled = draft ? '' : ' disabled';
  const days = quotationItineraryDays(quote);
  const dayRows = days.map((day, index) => { const date = day.date || itineraryDateForDay(quote, index); return '<div class="card itinerary-day"><div class="row-actions"><strong>Day ' + esc(day.day || index + 1) + '</strong>' + (draft ? '<button class="danger compact" onclick="removeQuotationDay(' + index + ')">Remove day</button>' : '') + '</div><div class="grid3"><div class="field"><label>Date</label><input id="qday-' + index + '-date" type="date" value="' + esc(date) + '"' + disabled + '></div><div class="field"><label>City / area</label><input id="qday-' + index + '-city" value="' + esc(day.city || '') + '"' + disabled + '></div><div class="field"><label>Day title</label><input id="qday-' + index + '-title" value="' + esc(day.title || '') + '"' + disabled + '></div></div><div class="grid2"><div class="field"><label>Activities / services</label><textarea id="qday-' + index + '-activities" rows="3"' + disabled + '>' + esc(day.activities || '') + '</textarea></div><div class="field"><label>Meals / overnight / notes</label><textarea id="qday-' + index + '-details" rows="3"' + disabled + '>' + esc([day.meals ? 'Meals: ' + day.meals : '', day.overnight ? 'Overnight: ' + day.overnight : '', day.notes || ''].filter(Boolean).join('\n')) + '</textarea></div></div></div>'; }).join('');
  const newItem = draft ? '<div class="card"><h4>Add service to quotation</h4><p class="muted">Service dates automatically use the quotation travel dates.</p><div class="grid3"><div class="field"><label>Service type</label><select id="new-qitem-service" onchange="toggleFlightDetails(\'new-qitem-service\',\'new-qitem-flight-details\')"><option>Flight</option><option>Hotel</option><option>Transfer</option><option>Tour</option><option>Tour Package</option><option>Land Arrangement</option><option>Ticket</option><option>Other</option></select></div><div class="field"><label>Description</label><input id="new-qitem-description" placeholder="Client-facing service description"></div><div class="field"><label>Internal supplier (staff only)</label><select id="new-qitem-supplier">' + quotationSupplierOptions('') + '</select></div><div class="field"><label>Quantity</label><input id="new-qitem-quantity" type="number" min="0.01" step="0.01" value="1"></div><div class="field"><label>Internal cost / unit</label><input id="new-qitem-cost" type="number" min="0" step="0.01"></div><div class="field"><label>Selling price / unit</label><input id="new-qitem-price" type="number" min="0" step="0.01"></div></div>' + flightDetailsMarkup('new-qitem-', {}, '', true) + '<button onclick="addQuotationEditorItem()">Add service</button></div>' : '';
  return '<section class="quote-editor card"><div class="panel-head"><div><h3>Quotation editor</h3><p class="muted">' + (draft ? 'Draft fields are editable. Save each section before approval.' : 'Approved quotations are locked. Create a revision through the existing amendment process if the commercial foundation changes.') + '</p></div>' + status(readableState(quote.status), draft ? 'warn' : 'good') + '</div><div class="card"><h4>Client & trip</h4><div class="grid3">' + field('Client', records.client && records.client.display_name || quote.client_id) + '<div class="field"><label>Destination</label><input id="quote-destination" value="' + esc(quote.destination || '') + '"' + disabled + '></div><div class="field"><label>Travel start</label><input id="quote-travel-start" type="date" value="' + esc(quote.travel_start || '') + '"' + disabled + '></div><div class="field"><label>Travel end</label><input id="quote-travel-end" type="date" value="' + esc(quote.travel_end || '') + '"' + disabled + '></div><div class="field"><label>Passengers</label><input id="quote-pax" type="number" min="1" value="' + esc(quote.pax_count || '') + '"' + disabled + '></div><div class="field"><label>Currency</label><input value="' + esc(quote.currency || '') + '" disabled></div><div class="field"><label>Quotation date</label><input id="quote-date" type="date" value="' + esc(quote.quotation_date || '') + '"' + disabled + '></div><div class="field"><label>Valid until</label><input id="quote-valid-until" type="date" value="' + esc(quote.valid_until || '') + '"' + disabled + '></div></div>' + (draft ? '<button onclick="saveQuotationDocument()">Save client & trip</button>' : '') + '</div><div class="card"><div class="panel-head"><div><h4>Quotation items</h4><p class="muted">Internal cost is staff-only. Selling price is the only amount projected to the client.</p></div></div><div class="table-wrap"><table class="quotation-items"><thead><tr><th>Order</th><th>Service</th><th>Description</th><th>Supplier</th><th>Qty</th><th>Internal cost</th><th>Selling price</th><th>Dates</th><th>Actions</th></tr></thead><tbody>' + (items.length ? items.map((item) => quotationItemEditorRow(item, draft)).join('') : '<tr><td colspan="9"><div class="empty">No quotation services yet. Add one below.</div></td></tr>') + '</tbody></table></div>' + newItem + '</div><div class="card"><div class="panel-head"><div><h4>Day-by-day itinerary</h4><p class="muted">Build the client-facing itinerary without writing JSON.</p></div>' + (draft ? '<button class="secondary" onclick="addQuotationDay()">+ Add day</button>' : '') + '</div>' + (dayRows || '<div class="empty">No itinerary days recorded.</div>') + (draft && days.length ? '<button class="secondary" onclick="saveQuotationItinerary()">Save itinerary</button>' : '') + '</div><div class="grid2"><div class="card"><h4>Inclusions / exclusions</h4><div class="field"><label>Inclusions</label><textarea id="quote-inclusions" rows="4"' + disabled + '>' + esc(quote.inclusions || '') + '</textarea></div><div class="field"><label>Exclusions</label><textarea id="quote-exclusions" rows="4"' + disabled + '>' + esc(quote.exclusions || '') + '</textarea></div></div><div class="card"><h4>Payment terms and notes</h4><div class="field"><label>Client-facing payment terms</label><textarea id="quote-payment-terms" rows="3"' + disabled + '>' + esc(quote.payment_terms || '') + '</textarea></div><div class="field"><label>Client-facing notes</label><textarea id="quote-client-notes" rows="3"' + disabled + '>' + esc(quote.client_notes || '') + '</textarea></div><details><summary>Internal notes</summary><textarea id="quote-internal-notes" rows="3"' + disabled + '>' + esc(quote.internal_notes || quote.notes || '') + '</textarea></details></div></div>' + (draft ? '<button onclick="saveQuotationDocument()">Save quotation details</button>' : '') + '</section>';
}

function renderQuotationEditorAddendum(quote, records, items, draft) {
  const container = $('quotation-content');
  if (!container) return;
  container.insertAdjacentHTML('beforeend', quotationEditorMarkup(quote, records, items, draft));
  const quotationTable = container.querySelector('.quotation-items');
  if (quotationTable) {
    const dateIndex = Array.from(quotationTable.querySelectorAll('th')).findIndex((header) => header.textContent.trim() === 'Dates');
    if (dateIndex >= 0) quotationTable.querySelectorAll('tr').forEach((row) => { const cell = row.children[dateIndex]; if (cell) cell.remove(); });
  }
  container.querySelectorAll('.quotation-items .flight-details, #new-qitem-flight-details').forEach((element) => element.remove());
  container.insertAdjacentHTML('beforeend', quotationFlightDetailsMarkup(quote, draft));
  const termsHeading = Array.from(container.querySelectorAll('h4')).find((heading) => heading.textContent.trim() === 'Payment terms and notes');
  const termsCard = termsHeading && termsHeading.closest('.card');
  if (termsCard) termsCard.id = 'quotation-terms';
  if (draft && termsCard) {
    const editorHeader = container.querySelector('.quote-editor > .panel-head');
    if (editorHeader) {
      const button = document.createElement('button');
      button.className = 'secondary';
      button.type = 'button';
      button.textContent = 'Edit payment terms';
      button.addEventListener('click', () => termsCard.scrollIntoView({ behavior: 'smooth' }));
      editorHeader.appendChild(button);
    }
  }
  if (quotationPreview && quotationPreview.quotation && quotationPreview.quotation.quotation_id === quote.quotation_id) {
    container.insertAdjacentHTML('beforeend', clientQuotationPreviewMarkup(quotationPreview));
    applyClientPreviewFormatting(quotationPreview);
    addClientFlightDetailsSection(quotationPreview);
    formatClientFlightDetails(quotationPreview);
  }
  else container.insertAdjacentHTML('beforeend', '<div id="quotation-preview" class="client-preview-placeholder"><p class="muted">Generate a client-safe preview before sending or printing the quotation.</p><button class="secondary" onclick="previewQuotation()">Preview client quotation</button> <button class="secondary" onclick="previewClientItinerary()">Preview itinerary</button></div>');
  if (draft && !items.length) {
    const currencyField = Array.from(container.querySelectorAll('.field')).find((field) => { const label = field.querySelector('label'); return label && label.textContent.trim() === 'Currency'; });
    if (currencyField) {
      const current = String(quote.currency || '').toUpperCase();
      currencyField.innerHTML = '<label>Currency</label><select id="quote-currency"><option value="PHP">PHP</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="JPY">JPY</option><option value="SGD">SGD</option></select><span class="muted">Choose before adding quotation items.</span>';
      const select = currencyField.querySelector('#quote-currency');
      if (select && Array.from(select.options).some((option) => option.value === current)) select.value = current;
    }
  }
}

async function createManualDraftQuotation() {
  const records = caseRecords();
  if (!records.inquiry) return failLocal('Select an Inquiry before creating a manual quotation.');
  const requirements = records.inquiry.current_requirements || {};
  const defaults = quotationDefaults();
  const quote = await api('createQuotation', { inquiry_id: records.inquiry.inquiry_id, client_id: records.inquiry.client_id, destination: requirements.destination, travel_start: requirements.travel_start, travel_end: requirements.travel_end, pax_count: requirements.pax_count, quotation_date: ($('manual-quote-date') && $('manual-quote-date').value) || new Date().toISOString().slice(0, 10), valid_until: ($('manual-quote-valid-until') && $('manual-quote-valid-until').value) || defaultQuotationValidUntil(), currency: (($('manual-quote-currency') && $('manual-quote-currency').value) || defaults.currency).trim().toUpperCase(), supplier_cost_total: '0.00', notes: 'Manual quotation; no Commercial Option selected.' }, 'LOCAL_STAFF');
  if (quote && quote.quotation_id) {
    setWorkspaceId('quotation', quote.quotation_id);
    if (currentTab() === 'quotation') render();
    else window.location.hash = 'quotation';
  }
}

async function saveQuotationDocument() {
  const records = caseRecords();
  if (!records.quotation || records.quotation.status !== 'DRAFT') return failLocal('Only a draft quotation can be edited.');
  await api('updateQuotation', { quotation_id: records.quotation.quotation_id, quotation_date: $('quote-date').value, valid_until: $('quote-valid-until').value || undefined, destination: $('quote-destination').value.trim(), travel_start: $('quote-travel-start').value || undefined, travel_end: $('quote-travel-end').value || undefined, pax_count: $('quote-pax').value, currency: $('quote-currency') ? $('quote-currency').value : records.quotation.currency, inclusions: $('quote-inclusions').value, exclusions: $('quote-exclusions').value, payment_terms: $('quote-payment-terms').value, client_notes: $('quote-client-notes').value, internal_notes: $('quote-internal-notes').value }, 'LOCAL_STAFF');
}

async function addQuotationEditorItem() {
  const records = caseRecords();
  if (!records.quotation || records.quotation.status !== 'DRAFT') return failLocal('Approved quotations are locked.');
  const serviceType = $('new-qitem-service').value;
  await api('createQuotationItem', Object.assign({ quotation_id: records.quotation.quotation_id, service_type: serviceType, description: $('new-qitem-description').value.trim(), supplier_id: $('new-qitem-supplier').value || undefined, quantity: $('new-qitem-quantity').value, unit_cost: $('new-qitem-cost').value, unit_selling_price: $('new-qitem-price').value, currency: records.quotation.currency }, flightInputValues('new-qitem-', serviceType)), 'LOCAL_STAFF');
}

async function saveQuotationItem(itemId) {
  const serviceType = $('qitem-service-' + itemId).value;
  await api('updateQuotationItem', Object.assign({ quotation_item_id: itemId, service_type: serviceType, description: $('qitem-description-' + itemId).value.trim(), supplier_id: $('qitem-supplier-' + itemId).value || undefined, quantity: $('qitem-quantity-' + itemId).value, unit_cost: $('qitem-cost-' + itemId).value, unit_selling_price: $('qitem-price-' + itemId).value }, flightInputValues('qitem-' + itemId + '-', serviceType)), 'LOCAL_STAFF');
}

async function addQuotationEditorItem(itemOverride) {
  const records = caseRecords();
  if (!records.quotation || records.quotation.status !== 'DRAFT') return failLocal('Approved quotations are locked.');
  const serviceType = $('new-qitem-service').value;
  await api('createQuotationItem', Object.assign({ quotation_id: records.quotation.quotation_id, service_type: serviceType, description: $('new-qitem-description').value.trim(), supplier_id: $('new-qitem-supplier').value || undefined, quantity: $('new-qitem-quantity').value, unit_cost: $('new-qitem-cost').value, unit_selling_price: $('new-qitem-price').value, currency: records.quotation.currency }, flightInputValues('new-qitem-', serviceType)), 'LOCAL_STAFF');
}

async function saveQuotationItem(itemId, itemOverride) {
  const serviceType = $('qitem-service-' + itemId).value;
  await api('updateQuotationItem', Object.assign({ quotation_item_id: itemId, service_type: serviceType, description: $('qitem-description-' + itemId).value.trim(), supplier_id: $('qitem-supplier-' + itemId).value || undefined, quantity: $('qitem-quantity-' + itemId).value, unit_cost: $('qitem-cost-' + itemId).value, unit_selling_price: $('qitem-price-' + itemId).value }, flightInputValues('qitem-' + itemId + '-', serviceType)), 'LOCAL_STAFF');
}

async function removeQuotationItemFromEditor(itemId) { if (!window.confirm('Remove this quotation service?')) return; await api('removeQuotationItem', { quotation_item_id: itemId }, 'LOCAL_STAFF'); }

async function moveQuotationItem(itemId, direction) {
  const records = caseRecords();
  const items = list('QuotationItem', (item) => item.quotation_id === records.quotation.quotation_id).sort((a, b) => Number(a.line_order || 0) - Number(b.line_order || 0));
  const index = items.findIndex((item) => item.quotation_item_id === itemId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= items.length) return;
  const ids = items.map((item) => item.quotation_item_id); [ids[index], ids[target]] = [ids[target], ids[index]];
  await api('reorderQuotationItems', { quotation_id: records.quotation.quotation_id, quotation_item_ids: ids }, 'LOCAL_STAFF');
}

function collectQuotationDays() {
  const records = caseRecords();
  return quotationItineraryDays(records.quotation).map((day, index) => {
    const details = $('qday-' + index + '-details').value.split('\n');
    return { day: index + 1, date: $('qday-' + index + '-date').value, city: $('qday-' + index + '-city').value, title: $('qday-' + index + '-title').value, activities: $('qday-' + index + '-activities').value, meals: (details.find((line) => line.indexOf('Meals: ') === 0) || '').replace('Meals: ', ''), overnight: (details.find((line) => line.indexOf('Overnight: ') === 0) || '').replace('Overnight: ', ''), notes: details.filter((line) => line && line.indexOf('Meals: ') !== 0 && line.indexOf('Overnight: ') !== 0).join('\n') };
  });
}

function collectQuotationFlights() {
  const cards = Array.from(document.querySelectorAll('#quotation-flight-details .flight-detail-card[data-flight-index]'));
  return cards.map((card) => {
    const index = card.getAttribute('data-flight-index');
    const value = (name) => {
      const input = $('qflight-' + index + '-' + name);
      return input && input.value ? input.value.trim() : '';
    };
    return {
      segment_type: card.getAttribute('data-segment-type') || 'FLIGHT',
      flight_date: value('date') || undefined,
      airline: value('airline') || undefined,
      flight_number: value('flight-number') || undefined,
      departure_airport: value('departure-airport') || undefined,
      arrival_airport: value('arrival-airport') || undefined,
      departure_time: value('departure-time') || undefined,
      arrival_time: value('arrival-time') || undefined,
      checkin_baggage_kg: value('checkin-baggage-kg') || undefined,
      hand_carry_baggage_kg: value('hand-carry-baggage-kg') || undefined,
      layover_airport: value('layover-airport') || undefined,
      layover_duration_hours: value('layover-duration-hours') || undefined,
      layover_notes: value('layover-notes') || undefined
    };
  });
}

async function saveQuotationFlights() {
  const records = caseRecords();
  if (!records.quotation || records.quotation.status !== 'DRAFT') return failLocal('Only a draft quotation can be edited.');
  await api('updateQuotation', { quotation_id: records.quotation.quotation_id, flight_details: JSON.stringify(collectQuotationFlights()) }, 'LOCAL_STAFF');
}

async function addQuotationFlight() {
  return addQuotationSegment('FLIGHT');
}

async function addQuotationLayover() {
  return addQuotationSegment('LAYOVER');
}

async function addQuotationSegment(segmentType) {
  const records = caseRecords();
  if (!records.quotation || records.quotation.status !== 'DRAFT') return failLocal('Approved quotations are locked.');
  const flights = collectQuotationFlights();
  flights.push({ segment_type: segmentType || 'FLIGHT' });
  await api('updateQuotation', { quotation_id: records.quotation.quotation_id, flight_details: JSON.stringify(flights) }, 'LOCAL_STAFF');
}

async function removeQuotationFlight(index) {
  const records = caseRecords();
  if (!records.quotation || records.quotation.status !== 'DRAFT') return failLocal('Approved quotations are locked.');
  const flights = collectQuotationFlights();
  flights.splice(Number(index), 1);
  if (!flights.length) flights.push({});
  await api('updateQuotation', { quotation_id: records.quotation.quotation_id, flight_details: JSON.stringify(flights) }, 'LOCAL_STAFF');
}

async function saveQuotationItinerary() { const records = caseRecords(); await api('updateQuotation', { quotation_id: records.quotation.quotation_id, itinerary: JSON.stringify(collectQuotationDays()) }, 'LOCAL_STAFF'); }
async function addQuotationDay() { const records = caseRecords(); const days = $('qday-0-date') ? collectQuotationDays() : quotationItineraryDays(records.quotation); const index = days.length; days.push({ day: index + 1, date: itineraryDateForDay(records.quotation, index), city: '', title: '', activities: '', meals: '', overnight: '', notes: '' }); await api('updateQuotation', { quotation_id: records.quotation.quotation_id, itinerary: JSON.stringify(days) }, 'LOCAL_STAFF'); }
async function removeQuotationDay(index) { const records = caseRecords(); if (!window.confirm('Remove this itinerary day?')) return; const days = $('qday-0-date') ? collectQuotationDays() : quotationItineraryDays(records.quotation); days.splice(index, 1); days.forEach((day, i) => { day.day = i + 1; if (!day.date) day.date = itineraryDateForDay(records.quotation, i); }); await api('updateQuotation', { quotation_id: records.quotation.quotation_id, itinerary: JSON.stringify(days) }, 'LOCAL_STAFF'); }

async function previewQuotation() {
  const records = caseRecords();
  if (!records.quotation) return failLocal('Create a quotation first.');
  try {
    const response = await wmitGuard401(await fetch('/api/phase1/action', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, wmitAuthHeaders()), body: JSON.stringify({ action: 'getClientQuotationPreview', input: { quotation_id: records.quotation.quotation_id }, actor: 'LOCAL_STAFF' }) }));
    const result = await response.json();
    if (!result.ok) return failLocal(result.error && result.error.message || 'The client preview could not be generated.');
    quotationPreview = result.data;
    quotationPreview.quotation.quotation_id = records.quotation.quotation_id;
    render();
  } catch (error) { failLocal(error.message); }
}

async function printQuotation() { if (!quotationPreview) { await previewQuotation(); if (!quotationPreview) return; } document.body.classList.add('print-quotation'); window.setTimeout(() => { window.print(); window.setTimeout(() => document.body.classList.remove('print-quotation'), 300); }, 50); }

let clientDocumentSheet = null;

async function previewClientInvoice() {
  const records = caseRecords();
  if (!records.booking) return failLocal('Create a booking first — the statement of account comes from its payment records.');
  try {
    const response = await wmitGuard401(await fetch('/api/phase1/action', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, wmitAuthHeaders()), body: JSON.stringify({ action: 'getClientInvoicePreview', input: { booking_id: records.booking.booking_id }, actor: 'LOCAL_STAFF' }) }));
    const result = await response.json();
    if (!result.ok) return failLocal(result.error && result.error.message || 'The statement of account could not be generated.');
    openClientDocumentSheet('invoice', result.data);
  } catch (error) { failLocal(error.message); }
}

async function previewClientItinerary() {
  const records = caseRecords();
  if (!records.quotation) return failLocal('Create a quotation first — the itinerary comes from its recorded days.');
  try {
    const response = await wmitGuard401(await fetch('/api/phase1/action', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, wmitAuthHeaders()), body: JSON.stringify({ action: 'getClientItineraryPreview', input: { quotation_id: records.quotation.quotation_id }, actor: 'LOCAL_STAFF' }) }));
    const result = await response.json();
    if (!result.ok) return failLocal(result.error && result.error.message || 'The itinerary could not be generated.');
    openClientDocumentSheet('itinerary', result.data);
  } catch (error) { failLocal(error.message); }
}

function closeClientDocumentSheet() {
  const sheet = document.getElementById('client-doc-sheet');
  if (sheet) sheet.remove();
  clientDocumentSheet = null;
}

function openClientDocumentSheet(kind, data) {
  closeClientDocumentSheet();
  clientDocumentSheet = { kind: kind, data: data };
  const sheet = document.createElement('div');
  sheet.id = 'client-doc-sheet';
  sheet.style.cssText = 'position:fixed;inset:0;background:rgba(23,35,52,.45);z-index:160;overflow:auto;padding:24px 14px;';
  sheet.addEventListener('click', function (event) { if (event.target === sheet) closeClientDocumentSheet(); });
  const paper = document.createElement('div');
  paper.style.cssText = 'background:#fff;color:#172334;max-width:760px;margin:0 auto;border-radius:11px;box-shadow:0 18px 50px rgba(23,35,52,.35);padding:34px 38px;font-family:inherit;';
  paper.innerHTML = kind === 'invoice' ? clientInvoiceMarkup(data) : clientItineraryMarkup(data);
  sheet.appendChild(paper);
  document.body.appendChild(sheet);
}

function printClientDocument() {
  document.body.classList.add('print-client-doc');
  window.setTimeout(function () {
    window.print();
    window.setTimeout(function () { document.body.classList.remove('print-client-doc'); }, 300);
  }, 50);
}

async function emailClientDocument() {
  if (!clientDocumentSheet) return;
  const kind = clientDocumentSheet.kind;
  const data = clientDocumentSheet.data;
  const clientEmail = (data.client && data.client.email) || (caseRecords().client && caseRecords().client.primary_email) || '';
  const email = String(window.prompt('Email the ' + (kind === 'invoice' ? 'statement of account' : 'itinerary') + ' to:', clientEmail) || '').trim();
  if (!email) return;
  if (!window.confirm('Send the ' + (kind === 'invoice' ? 'statement of account' : 'itinerary') + ' to ' + email + '? This emails a client-facing document.')) return;
  try {
    const payload = kind === 'invoice'
      ? { kind: 'invoice', booking_id: data.invoice && data.invoice.booking_id, email: email }
      : { kind: 'itinerary', quotation_id: data.itinerary && data.itinerary.quotation_id, email: email };
    const response = await wmitGuard401(await fetch('/api/documents/email', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, wmitAuthHeaders()), body: JSON.stringify(payload) }));
    const result = await response.json();
    if (!result.ok) return showMessage('✕ Email document — NOT EXECUTED', result.error && result.error.message || 'The document could not be emailed.', 'error');
    const mode = result.data.delivery && result.data.delivery.mode;
    if (mode === 'smtp') showMessage('✓ Document emailed', 'Sent to ' + email + ' via SMTP.', 'ok');
    else showMessage('✓ Draft saved', 'SMTP is not configured — a reviewable .eml draft was written to the outbox.', 'warn');
  } catch (error) {
    showMessage('✕ Email document — NOT EXECUTED', error.message, 'error');
  }
}

function clientDocActionsMarkup() {
  return '<div class="preview-actions" style="display:flex;gap:8px;justify-content:flex-end;margin-bottom:14px"><button class="secondary compact" onclick="closeClientDocumentSheet()">Close</button><button class="secondary compact" onclick="emailClientDocument()">Email</button><button class="secondary compact" onclick="printClientDocument()">Print</button></div>';
}

function clientDocHeader(labelText) {
  return '<header class="quote-header"><img class="quote-brand-image" src="/assets/header.png" alt="World Master International Travel"><div class="quote-label" style="text-align:right;font-weight:800;letter-spacing:.06em">' + esc(labelText) + '</div></header>';
}

function clientInvoiceMarkup(data) {
  const invoice = data.invoice || {};
  const totals = data.totals || {};
  const currency = totals.currency || '';
  const rows = (data.obligations || []).map(function (obligation) {
    return '<tr><td>' + esc(String(obligation.purpose || 'INSTALLMENT').replace(/_/g, ' ').toLowerCase()) + '</td><td>' + esc(obligation.amount) + ' ' + esc(obligation.currency || currency) + '</td><td>' + esc(obligation.allocated) + '</td><td><strong>' + esc(obligation.outstanding) + '</strong></td><td>' + esc(obligation.dueAt ? String(obligation.dueAt).slice(0, 10) : '—') + '</td><td>' + esc(obligation.state === 'SATISFIED' ? 'Paid' : obligation.state === 'PARTIALLY_SATISFIED' ? 'Partially paid' : 'Due') + '</td></tr>';
  }).join('');
  const bankLines = String(data.bankDetails || '').split('\n').filter(Boolean).map(function (line) { return '<div>' + esc(line.trim()) + '</div>'; }).join('');
  return clientDocActionsMarkup() + clientDocHeader('STATEMENT OF ACCOUNT') +
    '<div class="quote-meta"><div><strong>Prepared for</strong><br>' + esc(invoice.client_name || 'Client') + '</div><div><strong>Booking</strong><br>' + esc(invoice.booking_id || '—') + (invoice.quotation_id ? '<br>Quote ' + esc(invoice.quotation_id) : '') + '</div><div><strong>Trip</strong><br>' + esc(invoice.destination || '—') + (invoice.travel_start ? '<br>' + esc(invoice.travel_start) + (invoice.travel_end ? ' to ' + esc(invoice.travel_end) : '') : '') + (invoice.pax_count ? '<br>' + esc(invoice.pax_count) + ' passenger(s)' : '') + '</div><div><strong>Issued</strong><br>' + esc(String(invoice.issued_at || '').slice(0, 10) || '—') + '</div></div>' +
    '<section class="preview-section"><h3>Payment schedule</h3><div class="table-wrap"><table><thead><tr><th>Purpose</th><th>Amount</th><th>Paid</th><th>Outstanding</th><th>Due</th><th>State</th></tr></thead><tbody>' + (rows || '<tr><td colspan="6">No payment obligations recorded.</td></tr>') + '</tbody></table></div>' +
    '<div class="preview-total"><div>Total <span>' + esc(totals.obligationTotal || '0.00') + ' ' + esc(currency) + '</span></div><div>Verified payments received <span>' + esc(totals.verifiedReceived || '0.00') + ' ' + esc(currency) + '</span></div><div class="grand-total">Outstanding balance <span>' + esc(totals.outstanding || '0.00') + ' ' + esc(currency) + '</span></div></div></section>' +
    (data.paymentTerms ? '<section class="quote-terms"><h3>Payment terms</h3><p>' + esc(data.paymentTerms) + '</p></section>' : '') +
    (bankLines ? '<section class="quote-terms"><h3>Bank details</h3>' + bankLines + '</section>' : '') +
    '<footer class="quote-footer"><p>Thank you for choosing World Master International Travel.</p></footer>';
}

function clientItineraryMarkup(data) {
  const itinerary = data.itinerary || {};
  const days = itinerary.itinerary_days || [];
  const dayMarkup = days.map(function (day) {
    return '<div class="preview-day"><strong>Day ' + esc(day.day) + (day.date ? ' · ' + esc(day.date) : '') + ' — ' + esc(day.title || day.city || 'Travel day') + '</strong>' +
      (day.city ? '<div>' + esc(day.city) + '</div>' : '') +
      (day.activities ? '<p>' + esc(day.activities) + '</p>' : '') +
      (day.meals ? '<div><strong>Meals:</strong> ' + esc(day.meals) + '</div>' : '') +
      (day.overnight ? '<div><strong>Overnight:</strong> ' + esc(day.overnight) + '</div>' : '') + '</div>';
  }).join('');
  const flightRows = (data.flights || []).map(function (flight) {
    return '<tr><td>' + esc(flight.route || '—') + '</td><td>' + esc(flight.airline || '') + (flight.flight_number ? ' ' + esc(flight.flight_number) : '') + '</td><td>' + esc(flight.times || '') + '</td><td>' + esc(flight.service_date || '') + '</td></tr>';
  }).join('');
  const voucherRows = (data.vouchers || []).map(function (voucher) {
    return '<div class="event"><strong>' + esc(voucher.voucher_number) + '</strong>' + (voucher.description ? ' — ' + esc(voucher.description) : '') + '</div>';
  }).join('');
  return clientDocActionsMarkup() + clientDocHeader('TRAVEL ITINERARY') +
    '<div class="quote-meta"><div><strong>Prepared for</strong><br>' + esc((data.client && data.client.name) || 'Client') + '</div><div><strong>Destination</strong><br>' + esc(itinerary.destination || '—') + '</div><div><strong>Travel dates</strong><br>' + esc(itinerary.travel_start || '—') + (itinerary.travel_end ? ' to ' + esc(itinerary.travel_end) : '') + (itinerary.pax_count ? '<br>' + esc(itinerary.pax_count) + ' passenger(s)' : '') + '</div>' + (data.booking && data.booking.booking_id ? '<div><strong>Booking</strong><br>' + esc(data.booking.booking_id) + '</div>' : '') + '</div>' +
    (dayMarkup ? '<section class="preview-section"><h3>Itinerary</h3>' + dayMarkup + '</section>' : '<section class="preview-section"><h3>Itinerary</h3><p class="muted">No itinerary days recorded yet — add them in the quotation editor.</p></section>') +
    (flightRows ? '<section class="preview-section"><h3>Flight details</h3><div class="table-wrap"><table><thead><tr><th>Route</th><th>Airline / flight</th><th>Times</th><th>Date</th></tr></thead><tbody>' + flightRows + '</tbody></table></div></section>' : '') +
    (voucherRows ? '<section class="preview-section"><h3>Vouchers</h3>' + voucherRows + '</section>' : '') +
    '<footer class="quote-footer"><p>We wish you a wonderful trip.</p><p>World Master International Travel</p></footer>';
}

async function createDraftQuotation() {
  const records = caseRecords();
  if (!records.inquiry || !records.option || !records.option.selected) return failLocal('Select one option from this Inquiry first.');
  const requirements = records.inquiry.current_requirements || {};
  const quote = await api('createQuotation', { commercial_option_id: records.option.commercial_option_id, inquiry_id: records.inquiry.inquiry_id, client_id: records.inquiry.client_id, destination: requirements.destination, travel_start: requirements.travel_start, travel_end: requirements.travel_end, pax_count: requirements.pax_count, pricing_context_type: $('quote-create-context').value, discount: '0.00' }, 'LOCAL_STAFF');
  if (quote && quote.quotation_id && Number(quote.supplier_cost_total || 0) >= 0) {
    const lineSelling = Math.max(0, Number(quote.client_total || 0) - Number(quote.fees_total || 0) - Number(quote.tax_total || 0) + Number(quote.discount_total || 0));
    await api('createQuotationItem', { quotation_id: quote.quotation_id, service_type: 'Land Arrangement', description: 'Selected commercial option', supplier_id: records.option.supplier_id, quantity: 1, unit_cost: quote.supplier_cost_total || '0.00', unit_selling_price: lineSelling.toFixed(2), currency: quote.currency }, 'LOCAL_STAFF');
  }
}

async function saveSettings() {
  const currency = ($('settings-currency') && $('settings-currency').value || '').trim().toUpperCase();
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return failLocal('Default currency must be a three-letter code.');
  await api('updateSettings', { quotation_defaults: { paymentTerms: $('settings-payment-terms').value.trim(), paymentCurrencyPolicy: $('settings-payment-currency-policy').value.trim(), bankDetails: $('settings-bank-details') ? $('settings-bank-details').value.trim() : undefined, validityDays: $('settings-validity-days').value, downPaymentDaysAfterReservation: $('settings-downpayment-days').value, finalBalanceBusinessDaysBeforeDeparture: $('settings-final-balance-days').value, currency } }, 'LOCAL_MANAGER');
}

async function saveQuotationPricing() {
  const records = caseRecords();
  if (!records.quotation || records.quotation.status !== 'DRAFT') return failLocal('Only a draft quotation can be edited.');
  await api('updateQuotationPricing', { quotation_id: records.quotation.quotation_id, pricing_context_type: $('quote-context').value, markup_percent: $('quote-markup').value, fixed_fees: $('quote-fixed-fees').value, visa_assistance_fee: $('quote-visa-fee').value, payment_method: $('quote-payment-method').value, discount: $('quote-discount').value, client_payment_sent_at: records.payment && records.payment.actual_sent_at || undefined, reason: 'Staff draft quotation pricing review' }, 'LOCAL_STAFF');
}

async function approveQuotation() {
  const records = caseRecords();
  if (!records.quotation) return failLocal('Create a draft quotation first.');
  if (!window.confirm('Approve this quotation for client acceptance?')) return;
  await api('approveQuotation', { quotation_id: records.quotation.quotation_id }, 'LOCAL_MANAGER');
}

async function cancelQuotationApproval() {
  const records = caseRecords();
  if (!records.quotation || records.quotation.status !== 'APPROVED') return failLocal('Only an approved quotation can have its approval cancelled.');
  if (records.quotationAcceptance) return failLocal('Client acceptance is already recorded. Use a quotation revision or amendment instead.');
  const reason = window.prompt('Why are you cancelling this quotation approval?');
  if (!reason || !reason.trim()) return failLocal('Enter a reason so the approval cancellation is auditable.');
  await api('cancelQuotationApproval', { quotation_id: records.quotation.quotation_id, reason: reason.trim() }, 'LOCAL_MANAGER');
}

async function acceptQuotation() {
  const records = caseRecords();
  if (!records.quotation || records.quotation.status !== 'APPROVED') return failLocal('Approve the quotation before recording client acceptance.');
  const acceptedBy = $('quote-accepted-by') && $('quote-accepted-by').value.trim();
  if (!acceptedBy) return failLocal('Enter the client name or contact who accepted the quotation.');
  await api('acceptQuotation', { quotation_id: records.quotation.quotation_id, accepted_by: acceptedBy, acceptance_reference: $('quote-acceptance-reference') && $('quote-acceptance-reference').value.trim() || undefined }, 'LOCAL_STAFF');
}

function openBookingRecord(bookingId) {
  const booking = latest('Booking', (item) => item.booking_id === bookingId);
  const inquiryId = inquiryIdForBooking(booking);
  if (!booking || !inquiryId) return failLocal('This Booking cannot be opened because its Inquiry lineage is missing.');
  setWorkspaceId('booking', bookingId);
  clearWorkspaceId('booking-item');
  sessionStorage.setItem('wmit.operations.selectedInquiryId', inquiryId);
  if (currentTab() === 'booking') render();
  else window.location.hash = 'booking';
}

function clearBookingRecord() {
  clearWorkspaceId('booking');
  clearWorkspaceId('booking-item');
  render();
}

function bookingListMarkup() {
  const bookings = list('Booking');
  const rows = bookings.map((booking) => {
    const quote = latest('Quotation', (quotation) => quotation.quotation_id === booking.quotation_id);
    const currency = quote && quote.currency || 'PHP';
    const cost = booking.current_supplier_cost || quote && quote.supplier_cost_total || 'Not recorded';
    const price = booking.current_price || quote && quote.client_total || 'Not recorded';
    return '<tr><td><button class="secondary" onclick="openBookingRecord(\'' + esc(booking.booking_id) + '\')">' + esc(booking.booking_id) + '</button></td><td>' + esc((latest('Client', (client) => client.client_id === booking.client_id) || {}).display_name || booking.client_id) + '</td><td>' + esc(bookingLeadPaxName(booking)) + '</td><td>' + esc(bookingDestination(booking)) + '</td><td>' + esc(bookingTravelLabel(booking)) + '</td><td>' + esc(cost + ' ' + currency) + '</td><td>' + esc(price + ' ' + currency) + '</td><td>' + status(readableState(booking.commitment_state || booking.record_state), booking.commitment_state === 'CONFIRMED' ? 'good' : 'info') + '</td></tr>';
  }).join('');
  return '<div class="card"><h3>Booking list</h3><p class="muted">Bookings remain linked to their original Inquiry and Client. Every Booking has one selected lead passenger. Confirmed commitment is shown separately from Booking record existence.</p>' + (rows ? '<div class="table-wrap"><table><thead><tr><th>Booking</th><th>Client</th><th>Lead pax</th><th>Destination</th><th>Travel</th><th>Supplier cost</th><th>Client price</th><th>Commitment</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="empty">No Booking records yet. An approved quotation can create an operational Booking record.</div>') + '</div>';
}

function bookingMonitoringMarkup(records, projection) {
  const rooming = list('RoomingListEntry', (entry) => entry.booking_id === records.booking.booking_id);
  const documents = bookingDocumentRecords(records);
  const tasks = list('Task', (task) => (task.booking_id === records.booking.booking_id || task.inquiry_id === records.inquiryId) && !['CANCELLED'].includes(task.state)).sort((a, b) => taskDueLabel(a).localeCompare(taskDueLabel(b)));
  const roomingRows = rooming.length ? rooming.map((entry) => { const person = latest('Person', (item) => item.person_id === entry.person_id); return '<tr><td>' + esc(person && (person.display_name || person.name) || entry.person_id || 'Traveler') + '</td><td>' + esc(entry.room_label || 'Not recorded') + '</td><td>' + esc(entry.occupancy || 'Not recorded') + '</td><td>' + esc(readableState(entry.state || 'DRAFT')) + '</td></tr>'; }).join('') : '<tr><td colspan="4">No rooming entries recorded.</td></tr>';
  const documentRows = documents.length ? documents.slice(0, 8).map((document) => '<tr><td>' + esc(document.file_name || document.document_name || document.document_id || 'Document') + '</td><td>' + esc(readableState(document.document_type || 'UNKNOWN')) + '</td><td>' + status(document.review_status === 'ACCEPTED' ? 'Accepted' : 'Needs review', document.review_status === 'ACCEPTED' ? 'good' : 'warn') + '</td></tr>').join('') : '<tr><td colspan="3">No documents recorded.</td></tr>';
  const taskRows = tasks.length ? tasks.slice(0, 8).map((task) => '<tr><td>' + esc(task.description || task.title || task.task_type || 'Follow-up') + '</td><td>' + esc(taskDueLabel(task)) + '</td><td>' + taskAction(task) + '</td></tr>').join('') : '<tr><td colspan="3">No follow-ups recorded.</td></tr>';
  const finance = projection && projection.finance || {};
  return '<section class="panel booking-monitoring"><div class="panel-head"><div><div class="eyebrow">Monitoring</div><h3>Booking monitoring</h3><p class="muted">Payment is complete. Monitor supplier readiness, rooming, documents, and follow-ups from this screen.</p></div><span>' + status('PAID', 'good') + '</span></div><div class="grid3">' + field('Travel', bookingTravelLabel(records.booking)) + field('Lead pax', bookingLeadPaxName(records.booking)) + field('Client balance', operationalMoney(finance.outstanding || '0.00', finance.currency || records.booking.currency || 'PHP')) + '</div><div class="monitoring-section"><h4>Rooming list</h4><table><thead><tr><th>Traveler</th><th>Room / cabin</th><th>Occupancy</th><th>State</th></tr></thead><tbody>' + roomingRows + '</tbody></table><div class="grid2"><div class="field"><label>Lead pax room</label><input id="monitoring-rooming-room" placeholder="Room / cabin / occupancy label"></div><div class="field"><label>Occupancy</label><input id="monitoring-rooming-occupancy" placeholder="Twin, single, triple"></div></div><button class="secondary" onclick="addLeadPaxRooming(\'monitoring-\')">Add to rooming list</button></div><div class="grid2 monitoring-section"><div><h4>Documents</h4><table><thead><tr><th>Document</th><th>Type</th><th>Review</th></tr></thead><tbody>' + documentRows + '</tbody></table><button class="secondary compact" onclick="window.location.hash=\'operations\'">Open documents</button></div><div><h4>Follow-ups</h4><table><thead><tr><th>Task</th><th>Due</th><th></th></tr></thead><tbody>' + taskRows + '</tbody></table><button class="secondary compact" onclick="window.location.hash=\'operations\'">Open follow-ups</button></div></div></section>';
}

function agencyBookingControls(records) {
  if (!records.booking) return '';
  const item = records.bookingItem;
  const holds = item ? list('AvailabilityHold', (hold) => hold.booking_item_id === item.booking_item_id) : [];
  const ticketing = item ? latest('TicketingRecord', (record) => record.booking_item_id === item.booking_item_id) : null;
  const voucher = item ? latest('Voucher', (record) => record.booking_item_id === item.booking_item_id) : null;
  const schedules = list('PaymentScheduleItem', (schedule) => schedule.booking_id === records.booking.booking_id).sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
  const reconciliation = latest('Reconciliation', (record) => record.booking_id === records.booking.booking_id);
  const amendment = records.amendment && records.amendment.state === 'REACCEPTANCE_REQUIRED' ? '<div class="card warn"><h3>Client re-acceptance required</h3><p>This amendment changed the commercial foundation of the Booking.</p><div class="grid2"><div class="field"><label>Accepted by</label><input id="amend-accepted-by" placeholder="Client name or contact"></div><div class="field"><label>Acceptance reference</label><input id="amend-acceptance-reference" placeholder="Email, message, or signed reference"></div></div><button onclick="acceptAmendment()">Record Amendment Acceptance</button></div>' : '';
  const holdSummary = holds.length ? holds.map((hold) => '<div class="event">' + esc(readableState(hold.state)) + ' · expires ' + esc(hold.expires_at || 'not recorded') + (hold.supplier_reference ? ' · ref ' + esc(hold.supplier_reference) : '') + '</div>').join('') : '<p class="muted">No availability hold recorded.</p>';
  const fulfillment = item ? '<div class="card"><h3>Booking-item fulfillment</h3><p class="muted">Each service can be held, confirmed, ticketed, or vouchered independently.</p>' + field('Service', item.description || item.service_type || item.booking_item_id) + field('Fulfillment state', readableState(item.fulfillment_state || 'NOT_REQUESTED')) + '<h4>Availability hold</h4>' + holdSummary + '<div class="grid2"><div class="field"><label>Hold expires</label><input id="hold-expires" type="datetime-local"></div><div class="field"><label>Supplier reference</label><input id="hold-reference" placeholder="Supplier hold/reference"></div></div><button class="secondary" onclick="createAvailabilityHold()">Record availability hold</button>' + '<h4>Ticketing / PNR</h4>' + (ticketing ? '<div class="event">' + esc(readableState(ticketing.status)) + ' · PNR ' + esc(ticketing.pnr || 'not recorded') + (ticketing.ticket_number ? ' · ticket ' + esc(ticketing.ticket_number) : '') + '</div>' : '<p class="muted">No ticketing record.</p>') + '<div class="grid3"><div class="field"><label>Status</label><select id="ticketing-status"><option value="HELD">Held / PNR created</option><option value="TICKETED">Ticketed</option><option value="VOID">Void</option><option value="REFUNDED">Refunded</option></select></div><div class="field"><label>PNR / locator</label><input id="ticketing-pnr" placeholder="Required for held or ticketed air"></div><div class="field"><label>Ticket number</label><input id="ticketing-number" placeholder="Required when ticketed"></div></div><div class="field"><label>Ticketing deadline</label><input id="ticketing-deadline" type="datetime-local"></div><button class="secondary" onclick="recordTicketing()">Record ticketing state</button>' + '<h4>Voucher</h4>' + (voucher ? '<div class="event">Issued · ' + esc(voucher.voucher_number) + '</div>' : '<div class="grid2"><div class="field"><label>Voucher number</label><input id="voucher-number" placeholder="Supplier voucher number"></div><div class="field"><label>Voucher notes</label><input id="voucher-notes" placeholder="Optional notes"></div></div><button class="secondary" onclick="issueVoucher()">Issue voucher</button>') + '</div>' : '<div class="card warn"><h3>Booking-item fulfillment</h3><p>Create a Booking Item before recording holds, PNRs, tickets, or vouchers.</p></div>';
  const scheduleRows = schedules.length ? schedules.map((schedule) => '<tr><td>' + esc(schedule.sequence) + '</td><td>' + esc(readableState(schedule.purpose)) + '</td><td>' + esc(schedule.amount + ' ' + schedule.currency) + '</td><td>' + esc(schedule.due_at) + '</td><td>' + status(readableState(schedule.state), schedule.state === 'PAID' ? 'good' : 'info') + '</td></tr>').join('') : '<tr><td colspan="5">No payment schedule items recorded.</td></tr>';
  const finance = '<div class="card"><h3>Client payment schedule</h3><p class="muted">Payment purpose is recorded on each payment; this schedule records amounts and due dates the agency expects.</p><table><thead><tr><th>#</th><th>Purpose</th><th>Amount</th><th>Due</th><th>State</th></tr></thead><tbody>' + scheduleRows + '</tbody></table><div class="grid3"><div class="field"><label>Sequence</label><input id="schedule-sequence" type="number" min="1" value="1"></div><div class="field"><label>Purpose</label><select id="schedule-purpose"><option value="DOWN_PAYMENT">Down payment</option><option value="INSTALLMENT">Installment</option><option value="FINAL_BALANCE">Final balance</option><option value="FULL_PAYMENT">Full payment</option></select></div><div class="field"><label>Amount</label><input id="schedule-amount" type="number" min="0" step="0.01"></div></div><div class="grid2"><div class="field"><label>Currency</label><input id="schedule-currency" value="PHP"></div><div class="field"><label>Due date</label><input id="schedule-due" type="datetime-local"></div></div><button class="secondary" onclick="createPaymentScheduleItem()">Add payment schedule item</button></div>';
  const roomingEntries = list('RoomingListEntry', (entry) => entry.booking_id === records.booking.booking_id);
  const roomingRows = roomingEntries.length ? roomingEntries.map((entry) => { const person = latest('Person', (item) => item.person_id === entry.person_id); return '<tr><td>' + esc(person && (person.display_name || person.name) || entry.person_id || 'Traveler') + '</td><td>' + esc(entry.room_label || 'Not recorded') + '</td><td>' + esc(entry.occupancy || 'Not recorded') + '</td></tr>'; }).join('') : '<tr><td colspan="3">No rooming entries recorded.</td></tr>';
  const rooming = '<div class="card"><h3>Rooming list</h3><p class="muted">' + (roomingEntries.length ? 'Current pre-arrival sharing plan.' : 'Add each traveler to a group.') + '</p><table><thead><tr><th>Traveler</th><th>Group</th><th>Occupancy</th></tr></thead><tbody>' + roomingRows + '</tbody></table><div class="grid2"><div class="field"><label>Traveler</label><select id="rooming-person"><option value="">Select traveler</option></select></div><div class="field"><label>Group</label><input id="rooming-group" placeholder="Group A"></div><div class="field"><label>Occupancy</label><input id="rooming-occupancy" placeholder="Twin, single, triple"></div></div><button class="secondary" onclick="addRoomingEntry()">Add traveler to group</button></div>';
  const reconcile = '<div class="card"><h3>Financial reconciliation</h3>' + (reconciliation ? '<p>Latest status: ' + status(readableState(reconciliation.state), reconciliation.state === 'RECONCILED' ? 'good' : 'warn') + '</p><details><summary>Snapshot</summary><pre>' + esc(JSON.stringify(reconciliation.snapshot, null, 2)) + '</pre></details>' : '<p class="muted">Compare client price, costs, funds, and margin.</p>') + '<button class="secondary" onclick="reconcileBooking()">' + (reconciliation ? 'Refresh' : 'Review finances') + '</button></div>';
  return '<div class="panel booking-operations-controls"><div class="panel-head"><div><h3>Operational actions</h3><p class="muted">Use these actions to manage service fulfillment, client payments, rooming, and the internal financial review.</p></div></div>' + amendment + fulfillment + finance + rooming + reconcile + '</div>';
}

function enhanceFinancialReconciliation() {
  const card = Array.from(document.querySelectorAll('#booking-content .card')).find((item) => { const heading = item.querySelector('h3'); return heading && heading.textContent.trim() === 'Financial reconciliation'; });
  if (!card || card.dataset.enhanced === 'true') return;
  card.dataset.enhanced = 'true';
  const heading = card.querySelector('h3');
  if (heading) heading.textContent = 'Financial review';
  const explanation = document.createElement('p');
  explanation.className = 'muted';
  explanation.textContent = 'This is an internal check of the agreed client price, supplier cost, allocated client funds, supplier payables, supplier payments, and projected margin. Review required means the numbers have not been confirmed as final profit.';
  if (heading) heading.insertAdjacentElement('afterend', explanation);
  const details = card.querySelector('details');
  const pre = details && details.querySelector('pre');
  if (!details || !pre) return;
  let snapshot = {};
  try { snapshot = JSON.parse(pre.textContent || '{}'); } catch (error) { snapshot = {}; }
  details.innerHTML = '<summary>Financial figures</summary><div class="grid3">' + field('Client price', operationalMoney(snapshot.client_price, snapshot.currency)) + field('Supplier cost', operationalMoney(snapshot.supplier_cost, snapshot.currency)) + field('Projected profit', operationalMoney(snapshot.projected_profit, snapshot.currency)) + field('Allocated client funds', operationalMoney(snapshot.verified_allocated_client_funds, snapshot.currency)) + field('Supplier payables', operationalMoney(snapshot.supplier_payables, snapshot.currency)) + field('Supplier payments', operationalMoney(snapshot.supplier_payments, snapshot.currency)) + '</div><details class="secondary-details"><summary>Technical snapshot</summary><pre>' + esc(JSON.stringify(snapshot, null, 2)) + '</pre></details>';
}

function bookingLeadPaxName(booking) {
  if (!booking) return 'Not selected';
  const participant = latest('BookingParticipant', (item) => item.booking_id === booking.booking_id && (item.role === 'LEAD_PAX' || Array.isArray(item.roles) && item.roles.includes('LEAD_PAX')));
  const person = participant && latest('Person', (item) => item.person_id === participant.person_id);
  return person && (person.display_name || person.name) || booking.lead_pax_name || booking.lead_pax_person_id || 'Not selected';
}

function renderBooking() {
  const records = caseRecords();
  const selectedBookingId = selectedWorkspaceId('booking');
  if (!selectedBookingId) {
    const next = records.booking ? '<div class="card good"><h3>Booking record exists</h3><p>This quotation already has a Booking with a selected lead passenger.</p><button onclick="openBookingRecord(\'' + esc(records.booking.booking_id) + '\')">Open Booking</button></div>' : records.quotation && records.quotation.status === 'APPROVED' && !records.quotationAcceptance ? '<div class="card warn"><h3>Client acceptance required</h3><p>Record acceptance in the Quotation workspace before creating a Booking.</p><button class="secondary" onclick="openQuotationRecord(\'' + esc(records.quotation.quotation_id) + '\')">Open Quotation</button></div>' : records.quotation && records.quotation.status === 'APPROVED' ? '<div class="card"><h3>Booking record ready</h3><p>The approved quotation can become an operational Booking record. Select the lead passenger before creating it.</p><div class="field"><label>Lead passenger name</label><input id="booking-lead-pax" placeholder="Full name of lead passenger" required></div><button onclick="createBooking()">Create Booking Record</button></div>' : '<div class="empty">Select a Booking to open its detail.</div>';
    $('booking-content').innerHTML = bookingListMarkup() + next;
    return;
  }
  if (!records.booking || records.booking.booking_id !== selectedBookingId) {
    clearWorkspaceId('booking');
    $('booking-content').innerHTML = bookingListMarkup() + '<div class="empty">That Booking is no longer available.</div>';
    return;
  }
  const participants = list('BookingParticipant', (item) => item.booking_id === records.booking.booking_id);
  const participantRows = participants.map((participant) => { const person = latest('Person', (item) => item.person_id === participant.person_id); return '<tr><td>' + esc(person && (person.display_name || person.name) || participant.person_id) + '</td><td>' + esc(participant.role || participant.roles || 'Not recorded') + '</td></tr>'; }).join('');
  const amendment = records.amendment;
  const refund = records.refund;
  const bookingCost = records.booking.current_supplier_cost || records.quotation && records.quotation.supplier_cost_total;
  const bookingPrice = records.booking.current_price || records.quotation && records.quotation.client_total;
  const bookingCurrency = records.quotation && records.quotation.currency || records.booking.currency || 'PHP';
  $('booking-content').innerHTML = bookingListMarkup() + '<div class="grid2"><div class="card"><h3>Booking record ' + status('EXISTS', 'info') + '</h3>' + field('Booking ID', records.booking.booking_id) + field('Client', records.client && records.client.display_name) + field('Destination', bookingDestination(records.booking)) + field('Travel', bookingTravelLabel(records.booking)) + field('Supplier cost · internal', bookingCost ? bookingCost + ' ' + bookingCurrency : 'Not recorded') + field('Client selling price', bookingPrice ? bookingPrice + ' ' + bookingCurrency : 'Not recorded') + field('Booking record state', records.booking.record_state) + field('Client commitment', records.booking.commitment_state) + field('Client decision', records.booking.client_decision_state) + '<div class="row-actions">' + (records.booking.commitment_state === 'PENDING' ? '<button onclick="confirmCommitment()">Confirm commitment</button>' : '') + '</div></div><div class="card"><h3>Supplier fulfillment</h3>' + (!records.supplierBooking ? '<p>Reservation: ' + status('Not requested', 'info') + '</p>' + '<button onclick="requestReservation()">Request supplier</button>' : field('Supplier reservation', readableState(records.supplierBooking.reservation_state)) + field('Supplier', readableSupplierName(records.supplierBooking.supplier_id)) + field('Supplier reference', records.supplierBooking.supplier_reference || 'Not recorded') + field('Supplier confirmation', records.supplierBooking.confirmation_state || 'Not recorded') + field('Client payment', records.payment ? readableState(records.payment.payment_state) : 'Not recorded') + field('Supplier Payment', records.supplierPayment ? 'Executed' : 'Separate gate — not executed')) + '</div></div><div class="card"><h3>People and roles</h3>' + (participantRows ? '<table><thead><tr><th>Person</th><th>Role</th></tr></thead><tbody>' + participantRows + '</tbody></table>' : '<p class="muted">No Booking participants recorded.</p>') + '<div class="grid2"><div class="field"><label>Person name</label><input id="participant-name" placeholder="Existing or new person"></div><div class="field"><label>Role</label><select id="participant-role"><option value="COORDINATOR">Coordinator</option><option value="PAYER">Payer</option><option value="TRAVELER">Traveler</option><option value="COMMUNICATOR">Communicating contact</option></select></div></div><button class="secondary" onclick="addParticipantRole()">Record person and role</button></div><div class="card"><h3>Amend Booking</h3><p class="muted">Amendments preserve before/after history. If price or supplier cost changes, the Booking enters the existing re-acceptance state.</p><div class="grid3"><div class="field"><label>New travel start</label><input id="amend-start" type="date" value="' + esc(records.booking.travel_start || '') + '"></div><div class="field"><label>New travel end</label><input id="amend-end" type="date" value="' + esc(records.booking.travel_end || '') + '"></div><div class="field"><label>New product</label><input id="amend-product" value="' + esc(records.booking.product || '') + '"></div><div class="field"><label>New client price</label><input id="amend-price" type="number" min="0" step="0.01" value=""></div><div class="field"><label>New supplier cost</label><input id="amend-cost" type="number" min="0" step="0.01" value=""></div><div class="field"><label>Reason</label><input id="amend-reason" placeholder="Required reason"></div></div><button class="secondary" onclick="amendBooking()">Record Amendment</button>' + (amendment ? '<h4>Latest amendment</h4><table><thead><tr><th></th><th>Before</th><th>After</th></tr></thead><tbody><tr><th>Price</th><td>' + esc(amendment.before_snapshot && amendment.before_snapshot.current_price) + '</td><td>' + esc(amendment.after_snapshot && amendment.after_snapshot.current_price) + '</td></tr><tr><th>Supplier cost</th><td>' + esc(amendment.before_snapshot && amendment.before_snapshot.current_supplier_cost) + '</td><td>' + esc(amendment.after_snapshot && amendment.after_snapshot.current_supplier_cost) + '</td></tr><tr><th>State</th><td colspan="2">' + esc(readableState(amendment.state)) + '</td></tr></tbody></table>' : '') + '</div><div class="card"><h3>Cancellation / refund adjustment</h3><p class="muted">Cancellation does not automatically refund. Record a draft request with the applicable terms and outcome.</p><div class="grid3"><div class="field"><label>Amount</label><input id="refund-amount" type="number" min="0" step="0.01"></div><div class="field"><label>Currency</label><input id="refund-currency" value="PHP"></div><div class="field"><label>Reason / supplier terms</label><input id="refund-reason" placeholder="Record terms or reason"></div></div><button class="warning" onclick="requestRefund()">Create Refund / Adjustment Draft</button>' + (refund ? '<p>Latest request: ' + status(readableState(refund.state), 'warn') + ' · ' + esc(refund.refund_adjustment_id) + '</p><button class="danger" onclick="executeRefund()">Attempt Authorized Execution</button>' : '') + '</div>';
  const projection = projectionForCase(records);
  const serviceRows = projection && Array.isArray(projection.services) ? projection.services.map((service) => '<tr><td><strong>' + esc(service.description) + '</strong><br><span class="muted">' + esc(service.serviceType) + '</span></td><td>' + esc(readableState(service.fulfillment && service.fulfillment.state)) + '</td><td>' + esc(service.fulfillment && service.fulfillment.supplierReference || 'Not recorded') + '</td><td>' + esc(readableState(service.documents && service.documents.state)) + '</td><td>' + esc(readableState(service.tasks && service.tasks.state)) + '</td><td>' + status(readableState(service.readiness && service.readiness.state), service.readiness && service.readiness.state === 'READY' ? 'good' : 'warn') + (service.fulfillment && service.fulfillment.supplierBookingId && service.fulfillment.state !== 'CONFIRMED' ? ' <button class="secondary" onclick="confirmServiceSupplier(\'' + esc(service.fulfillment.supplierBookingId) + '\',\'' + esc(service.bookingItemId) + '\')">Confirm</button>' : '') + '</td></tr>').join('') : '';
  $('booking-content').insertAdjacentHTML('afterbegin', '<div class="selection-bar"><button class="secondary" onclick="clearBookingRecord()">Back to Booking list</button><strong>' + esc(records.booking.booking_id) + '</strong><span>' + esc(bookingDestination(records.booking)) + '</span><span>Lead pax: ' + esc(bookingLeadPaxName(records.booking)) + '</span></div>');
  const monitoringReady = projection && projection.finance && projection.finance.state === 'FULLY_FUNDED' && Number(projection.finance.outstanding || 0) === 0;
  if (!monitoringReady) $('booking-content').firstElementChild.insertAdjacentHTML('afterend', bookingOperationalSummaryMarkup(records, projection));
  if (serviceRows) {
    $('booking-content').insertAdjacentHTML('beforeend', bookingServiceCardsMarkup(records, projection));
    enhanceBookingServiceCards(projection);
  }
  $('booking-content').insertAdjacentHTML('beforeend', agencyBookingControls(records));
  enhanceFinancialReconciliation();
  if (monitoringReady) {
    $('booking-content').classList.add('booking-monitoring-mode');
    $('booking-content').insertAdjacentHTML('beforeend', bookingMonitoringMarkup(records, projection));
    Array.from($('booking-content').children).forEach((child) => {
      if (!child.matches('.selection-bar, .booking-ops-summary, .booking-service-section, .booking-monitoring')) child.hidden = true;
    });
  } else {
    $('booking-content').classList.remove('booking-monitoring-mode');
  }
  enhanceRoomingControls(records);
}

async function createBooking() {
  const records = caseRecords();
  if (!records.quotation || records.quotation.status !== 'APPROVED') return failLocal('Approve the quotation before creating a Booking record.');
  const leadPaxName = $('booking-lead-pax') && $('booking-lead-pax').value.trim();
  if (!leadPaxName) return failLocal('Select or enter the lead passenger before creating the Booking.', 'booking-lead-pax');
  const leadPax = await api('createPerson', { display_name: leadPaxName, name: leadPaxName, status: 'ACTIVE', idempotency_key: 'LEAD-PAX:' + records.quotation.quotation_id + ':' + encodeURIComponent(leadPaxName) }, 'LOCAL_STAFF');
  if (!leadPax) return;
  const booking = await api('createBooking', { quotation_id: records.quotation.quotation_id, client_id: records.quotation.client_id, inquiry_id: records.inquiry.inquiry_id, lead_pax_person_id: leadPax.person_id, travel_start: records.inquiry.current_requirements.travel_start, travel_end: records.inquiry.current_requirements.travel_end }, 'LOCAL_STAFF');
  if (!booking) return;
  if (booking) await api('createBookingItemsFromAcceptedSnapshot', { booking_id: booking.booking_id }, 'LOCAL_STAFF');
  setWorkspaceId('booking', booking.booking_id);
  if (currentTab() === 'booking') render();
}

async function createAvailabilityHold() {
  const records = caseRecords();
  if (!records.bookingItem) return failLocal('Create a Booking Item first.');
  if (!$('hold-expires').value) return failLocal('Enter the supplier hold expiry.', 'hold-expires');
  await api('createAvailabilityHold', { booking_item_id: records.bookingItem.booking_item_id, supplier_id: records.bookingItem.supplier_id, expires_at: new Date($('hold-expires').value).toISOString(), supplier_reference: $('hold-reference').value.trim() || undefined }, 'LOCAL_STAFF');
}

async function assignBookingItemSupplier(bookingItemId) {
  const item = latest('BookingItem', (record) => record.booking_item_id === bookingItemId);
  const select = $('service-supplier-' + bookingItemId);
  if (!item || !select) return failLocal('Open the Booking service again before assigning a Supplier.');
  if (!select.value) return failLocal('Select a Supplier before saving.', select);
  const linkedJoinIds = list('SupplierBookingItem', (join) => join.booking_item_id === bookingItemId).map((join) => join.supplier_booking_id);
  const linkedBooking = list('SupplierBooking', (booking) => linkedJoinIds.includes(booking.supplier_booking_id) || (booking.booking_id === item.booking_id && Array.isArray(booking.booking_item_ids) && booking.booking_item_ids.includes(bookingItemId))).find((booking) => booking.supplier_id !== select.value);
  if (linkedBooking) return failLocal('Supplier fulfillment is already linked. Use a replacement workflow instead of changing this Supplier.');
  await api('updateBookingItem', { booking_item_id: bookingItemId, fulfillment_state: item.fulfillment_state || 'NOT_REQUESTED', changes: { supplier_id: select.value } }, 'LOCAL_STAFF');
}

async function recordTicketing() {
  const records = caseRecords();
  if (!records.bookingItem) return failLocal('Create a Booking Item first.');
  const statusValue = $('ticketing-status').value;
  if (['HELD', 'TICKETED'].includes(statusValue) && !$('ticketing-pnr').value.trim()) return failLocal('PNR/locator is required for a held or ticketed air service.', 'ticketing-pnr');
  if (statusValue === 'TICKETED' && !$('ticketing-number').value.trim()) return failLocal('Ticket number is required when the service is ticketed.', 'ticketing-number');
  await api('recordTicketing', { booking_item_id: records.bookingItem.booking_item_id, status: statusValue, pnr: $('ticketing-pnr').value.trim() || undefined, ticket_number: $('ticketing-number').value.trim() || undefined, ticketing_deadline: $('ticketing-deadline').value ? new Date($('ticketing-deadline').value).toISOString() : undefined, idempotency_key: 'LOCAL-TICKETING-' + records.bookingItem.booking_item_id + '-' + statusValue + '-' + encodeURIComponent($('ticketing-pnr').value.trim()) }, 'LOCAL_STAFF');
}

async function issueVoucher() {
  const records = caseRecords();
  if (!records.bookingItem) return failLocal('Create a Booking Item first.');
  if (!$('voucher-number').value.trim()) return failLocal('Enter the supplier voucher number.', 'voucher-number');
  await api('issueVoucher', { booking_item_id: records.bookingItem.booking_item_id, voucher_number: $('voucher-number').value.trim(), notes: $('voucher-notes').value.trim() || undefined }, 'LOCAL_STAFF');
}

async function createPaymentScheduleItem() {
  const records = caseRecords();
  if (!records.booking) return failLocal('Create a Booking record first.');
  if (!$('schedule-amount').value) return failLocal('Enter the schedule amount and due date.', 'schedule-amount');
  if (!$('schedule-due').value) return failLocal('Enter the schedule amount and due date.', 'schedule-due');
  await api('createBookingPaymentObligations', { booking_id: records.booking.booking_id, obligations: [{ sequence: Number($('schedule-sequence').value || 1), purpose: $('schedule-purpose').value, amount: $('schedule-amount').value, currency: $('schedule-currency').value || records.booking.currency || 'PHP', due_at: new Date($('schedule-due').value).toISOString() }] }, 'LOCAL_STAFF');
}

function roomingOccupancyOptionsMarkup() {
  return '<option value="">Select occupancy</option><option value="SGL">SGL · 1 traveler</option><option value="TWN">TWN · 2 travelers</option><option value="DBL">DBL · 2 travelers</option><option value="TRP">TRP · 3 travelers</option><option value="QUAD">QUAD · 4 travelers</option>';
}

function enhanceRoomingControls(records) {
  if (!records || !records.booking) return;
  const headings = Array.from(document.querySelectorAll('#booking-content h3, #booking-content h4')).filter((heading) => heading.textContent.trim() === 'Rooming list');
  headings.forEach((heading) => {
    const container = heading.closest('.monitoring-section') || heading.closest('.card');
    if (!container || container.dataset.roomingEnhanced === 'true') return;
    const roomField = container.querySelector('#monitoring-rooming-room, #rooming-room, #monitoring-rooming-group, #rooming-group');
    const occupancyField = container.querySelector('#monitoring-rooming-occupancy, #rooming-occupancy');
    if (!roomField || !occupancyField) return;
    const occupancyId = occupancyField.id;
    if (occupancyField.tagName === 'SELECT') occupancyField.innerHTML = roomingOccupancyOptionsMarkup();
    else {
      const select = document.createElement('select');
      select.id = occupancyId;
      select.innerHTML = roomingOccupancyOptionsMarkup();
      occupancyField.replaceWith(select);
    }
    const occupancyControl = container.querySelector('#' + occupancyId);
    const prefix = roomField.id.indexOf('monitoring-') === 0 ? 'monitoring-' : '';
    const groupId = prefix + 'rooming-group';
    const personId = prefix + 'rooming-person';
    const existingPersonSelect = container.querySelector('#' + personId);
    const personField = existingPersonSelect ? existingPersonSelect.closest('.field') : document.createElement('div');
    if (!existingPersonSelect) {
      personField.className = 'field';
      personField.innerHTML = '<label for="' + personId + '">Traveler</label><select id="' + personId + '"><option value="">Select traveler</option></select>';
    }
    const people = list('BookingParticipant', (participant) => participant.booking_id === records.booking.booking_id).map((participant) => {
      const person = latest('Person', (item) => item.person_id === participant.person_id);
      return { id: participant.person_id, name: person && (person.display_name || person.name) || participant.person_id };
    }).filter((person, index, all) => all.findIndex((item) => item.id === person.id) === index);
    const select = personField.querySelector('select');
    select.innerHTML = '<option value="">Select traveler</option>' + people.map((person) => '<option value="' + esc(person.id) + '">' + esc(person.name) + '</option>').join('');
    const fields = roomField.closest('.grid2') || roomField.parentElement && roomField.parentElement.parentElement;
    if (fields && !existingPersonSelect) fields.insertBefore(personField, roomField.closest('.field'));
    roomField.id = groupId;
    roomField.placeholder = 'Group A';
    roomField.closest('.field').querySelector('label').textContent = 'Group';
    occupancyControl.closest('.field').querySelector('label').textContent = 'Occupancy';
    const table = container.querySelector('table');
    if (table) Array.from(table.querySelectorAll('th')).forEach((cell) => { if (cell.textContent.trim() === 'Room / cabin' || cell.textContent.trim() === 'Rooming group') cell.textContent = 'Group'; });
    const note = container.querySelector('.rooming-group-note') || document.createElement('p');
    note.className = 'muted rooming-group-note';
    note.textContent = 'Use the same label, such as Group A, for travelers who will share. This is not a hotel room number.';
    heading.insertAdjacentElement('afterend', note);
    const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent.toLowerCase().includes('rooming list') || item.textContent.toLowerCase().includes('rooming group'));
    if (button) {
      button.textContent = 'Add traveler to group';
      button.setAttribute('onclick', "addRoomingEntry('" + prefix + "')");
    }
    container.dataset.roomingEnhanced = 'true';
  });
}

async function addRoomingEntry(prefix) {
  const records = caseRecords();
  if (!records.booking || !records.booking.lead_pax_person_id) return failLocal('This Booking has no selected lead pax.');
  const roomField = $(prefix === 'monitoring-' ? 'monitoring-rooming-group' : 'rooming-group');
  const personField = $(prefix === 'monitoring-' ? 'monitoring-rooming-person' : 'rooming-person');
  const occupancyField = $(prefix === 'monitoring-' ? 'monitoring-rooming-occupancy' : 'rooming-occupancy');
  if (!personField || !personField.value) return failLocal('Select the traveler for this group.', prefix === 'monitoring-' ? 'monitoring-rooming-person' : 'rooming-person');
  if (!roomField || !roomField.value.trim()) return failLocal('Enter a group label, such as Group A. Do not enter a hotel room number.', prefix === 'monitoring-' ? 'monitoring-rooming-group' : 'rooming-group');
  await api('createRoomingListEntry', { booking_id: records.booking.booking_id, person_id: personField.value, room_label: roomField.value.trim(), occupancy: occupancyField && occupancyField.value.trim() || undefined }, 'LOCAL_STAFF');
}

async function addLeadPaxRooming(prefix) { return addRoomingEntry(prefix || ''); }

async function acceptAmendment() {
  const records = caseRecords();
  if (!records.amendment) return failLocal('No amendment requires acceptance.');
  const acceptedBy = $('amend-accepted-by').value.trim();
  if (!acceptedBy) return failLocal('Enter the client name or contact who accepted the amendment.', 'amend-accepted-by');
  await api('acceptAmendment', { amendment_id: records.amendment.amendment_id, accepted_by: acceptedBy, acceptance_reference: $('amend-acceptance-reference').value.trim() || undefined }, 'LOCAL_MANAGER');
}

async function reconcileBooking() {
  const records = caseRecords();
  if (!records.booking) return failLocal('Create a Booking record first.');
  await api('reconcileBooking', { booking_id: records.booking.booking_id, idempotency_key: 'LOCAL-RECONCILIATION-' + records.booking.booking_id + '-' + Date.now() }, 'LOCAL_MANAGER');
}

async function confirmCommitment() {
  const records = caseRecords();
  if (!records.booking) return failLocal('Create a Booking record first.');
  if (records.booking.commitment_state === 'CONFIRMED') return failLocal('Client commitment is already confirmed.');
  if (!window.confirm('Confirm the client commitment for this Booking?')) return;
  await api('confirmCommitment', { booking_id: records.booking.booking_id }, 'LOCAL_MANAGER');
}

async function requestReservation() {
  const records = caseRecords();
  if (!records.booking) return failLocal('Create a Booking record first.');
  const items = list('BookingItem', (item) => item.booking_id === records.booking.booking_id);
  const assignedItems = items.filter((item) => item.supplier_id);
  if (!assignedItems.length) return failLocal('Assign a Supplier to each Booking Item before requesting fulfillment.');
  if (!window.confirm('Request supplier fulfillment for the assigned services?')) return;
  for (const item of assignedItems) await api('createSupplierBooking', { booking_id: records.booking.booking_id, supplier_id: item.supplier_id, booking_item_ids: [item.booking_item_id] }, 'LOCAL_STAFF');
}

async function confirmServiceSupplier(supplierBookingId, bookingItemId) {
  const reference = window.prompt('Supplier confirmation/reference (optional):', '');
  if (reference === null) return;
  await api(bookingItemId ? 'confirmSupplierBookingItem' : 'updateSupplierBooking', { supplier_booking_id: supplierBookingId, booking_item_id: bookingItemId || undefined, reservation_state: 'CONFIRMED', supplier_reference: reference.trim() || undefined, confirmation_date: new Date().toISOString() }, 'LOCAL_STAFF');
}

async function addParticipantRole() {
  const records = caseRecords();
  const name = $('participant-name').value.trim();
  if (!records.booking) return failLocal('Create a Booking record first.');
  if (!name) return failLocal('Enter the person name before recording a role.');
  const person = await api('createPerson', { display_name: name, name, status: 'ACTIVE' }, 'LOCAL_STAFF');
  if (person) await api('createBookingParticipant', { booking_id: records.booking.booking_id, person_id: person.person_id, role: $('participant-role').value }, 'LOCAL_STAFF');
}

async function amendBooking() {
  const records = caseRecords();
  const reason = $('amend-reason').value.trim();
  if (!records.booking) return failLocal('Create a Booking record first.');
  if (!reason) return failLocal('An amendment reason is required.', 'amend-reason');
  const changes = {};
  if ($('amend-start').value) changes.travel_start = $('amend-start').value;
  if ($('amend-end').value) changes.travel_end = $('amend-end').value;
  if ($('amend-product').value) changes.product = $('amend-product').value;
  if ($('amend-price').value) changes.current_price = $('amend-price').value;
  if ($('amend-cost').value) changes.current_supplier_cost = $('amend-cost').value;
  if (!Object.keys(changes).length) return failLocal('Enter at least one changed Booking value.');
  if (!window.confirm('Record this Booking change? Commercial changes may require client re-acceptance.')) return;
  await api('amendBooking', { booking_id: records.booking.booking_id, changes, reason }, 'LOCAL_STAFF');
}

async function requestRefund() {
  const records = caseRecords();
  if (!records.booking) return failLocal('Create a Booking record first.');
  if (!$('refund-amount').value) return failLocal('Enter a refund amount and the applicable terms/reason.', 'refund-amount');
  if (!$('refund-reason').value.trim()) return failLocal('Enter a refund amount and the applicable terms/reason.', 'refund-reason');
  await api('requestRefund', { booking_id: records.booking.booking_id, amount: $('refund-amount').value, currency: $('refund-currency').value || 'PHP', reason: $('refund-reason').value.trim() }, 'LOCAL_STAFF');
}

async function executeRefund() {
  const records = caseRecords();
  if (!records.refund) return failLocal('Create a refund/adjustment draft first.');
  if (records.refund.state !== 'DRAFT') return failLocal('Only a refund draft can be executed.');
  if (!window.confirm('Execute this refund or adjustment? This records a financial outflow.')) return;
  await api('executeRefund', { refund_adjustment_id: records.refund.refund_adjustment_id, approval_confirmed: true }, 'LOCAL_MANAGER');
}

function verifiedAllocatedFunds(bookingId, currency) {
  return list('PaymentAllocation', (item) => item.booking_id === bookingId && item.currency === currency && item.state === 'ACTIVE').reduce((sum, allocation) => {
    const payment = latest('ClientPayment', (item) => item.client_payment_id === allocation.client_payment_id);
    return payment && payment.payment_state === 'VERIFIED' ? sum + Number(allocation.amount || 0) : sum;
  }, 0);
}

function paymentAllocations(paymentId) {
  return list('PaymentAllocation', (item) => item.client_payment_id === paymentId && item.state === 'ACTIVE');
}

function paymentBalanceSummary(records, payments) {
  const currency = records.quotation && records.quotation.currency || payments[0] && payments[0].currency || 'PHP';
  const clientPrice = records.quotation && Number(records.quotation.client_total) || records.booking && Number(records.booking.current_price) || null;
  const sameCurrency = payments.filter((payment) => payment.currency === currency);
  const reported = sameCurrency.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const verified = sameCurrency.filter((payment) => payment.payment_state === 'VERIFIED').reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const allocated = sameCurrency.filter((payment) => payment.payment_state === 'VERIFIED').reduce((sum, payment) => sum + paymentAllocations(payment.client_payment_id).reduce((inner, allocation) => inner + Number(allocation.amount || 0), 0), 0);
  const unallocated = Math.max(verified - allocated, 0);
  const balance = clientPrice === null ? null : Math.max(clientPrice - allocated, 0);
  return '<div class="card"><h3>Client balance and funds</h3><div class="grid3">' + field('Client price / obligation', clientPrice === null ? 'Not recorded' : clientPrice.toFixed(2) + ' ' + currency) + field('Payments reported', reported.toFixed(2) + ' ' + currency) + field('Payments verified', verified.toFixed(2) + ' ' + currency) + field('Verified allocated funds', allocated.toFixed(2) + ' ' + currency) + field('Verified but unallocated', unallocated.toFixed(2) + ' ' + currency) + field('Remaining client balance', balance === null ? 'Not calculable' : balance.toFixed(2) + ' ' + currency) + '</div><p class="muted">Only verified, client-directed allocations affect the final client balance and Supplier Payment gate.</p></div>';
}

function dateTimeLocalAtNine(date) {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return '';
  return value.toISOString().slice(0, 10) + 'T09:00';
}

function addBusinessDaysForInput(value, days, direction) {
  const date = new Date(value);
  let remaining = Math.max(0, Number(days || 0));
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + direction);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return dateTimeLocalAtNine(date);
}

function addCalendarDaysForInput(value, days) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return dateTimeLocalAtNine(date);
}

function defaultObligationDueDate(records, purpose) {
  const defaults = quotationDefaults();
  const booking = records && records.booking || {};
  if (purpose === 'DOWN_PAYMENT') return addCalendarDaysForInput(booking.booking_date || booking.created_at || new Date(), defaults.downPaymentDaysAfterReservation === undefined ? 3 : defaults.downPaymentDaysAfterReservation);
  if ((purpose === 'FINAL_BALANCE' || purpose === 'FULL_PAYMENT') && booking.travel_start) return addBusinessDaysForInput(booking.travel_start + 'T09:00:00Z', defaults.finalBalanceBusinessDaysBeforeDeparture === undefined ? 30 : defaults.finalBalanceBusinessDaysBeforeDeparture, -1);
  return booking.travel_start ? booking.travel_start + 'T09:00' : '';
}

function enhancePaymentObligationSetup(records, obligations) {
  if (obligations.length) return;
  const card = Array.from(document.querySelectorAll('#payment-content .card')).find((item) => { const heading = item.querySelector('h3'); return heading && heading.textContent.trim() === 'Client payment obligations'; });
  if (!card) return;
  const heading = card.querySelector('h3');
  const message = card.querySelector('p');
  if (heading) heading.textContent = 'Client payment schedule';
  if (message) message.textContent = 'Record what the client will pay: a down payment, installment, final balance, or full payment.';
  const grid = card.querySelector('.grid3');
  if (grid && !$('new-obligation-purpose')) grid.insertAdjacentHTML('afterbegin', '<div class="field"><label>Payment</label><select id="new-obligation-purpose" onchange="setDefaultObligationDueDate()"><option value="FULL_PAYMENT">Full payment</option><option value="DOWN_PAYMENT">Down payment</option><option value="INSTALLMENT">Installment</option><option value="FINAL_BALANCE">Final balance</option></select></div>');
}

function enhancePaymentLabels() {
  Array.from(document.querySelectorAll('#payment-content h4')).forEach((heading) => {
    if (heading.textContent.trim() === 'Client obligations' || heading.textContent.trim() === 'Client payment obligations') heading.textContent = 'Payment schedule';
  });
  Array.from(document.querySelectorAll('#payment-content h3')).forEach((heading) => {
    if (heading.textContent.trim() === 'Allocation target') heading.textContent = 'Allocate verified payment';
  });
  Array.from(document.querySelectorAll('#payment-content th')).forEach((header) => {
    if (header.textContent.trim() === 'Purpose') header.textContent = 'Payment';
  });
}

function setDefaultObligationDueDate() {
  const records = caseRecords();
  const purpose = $('new-obligation-purpose') && $('new-obligation-purpose').value || 'FULL_PAYMENT';
  const due = $('new-obligation-due');
  if (due) due.value = defaultObligationDueDate(records, purpose);
}

function financeOverviewMarkup() {
  const bookings = list('Booking').filter((booking) => {
    const inquiryId = inquiryIdForBooking(booking);
    const projection = inquiryId && projectionForInquiry(inquiryId);
    return !(projection && projection.finance && projection.finance.state === 'FULLY_FUNDED' && Number(projection.finance.outstanding || 0) === 0);
  });
  const clientPayments = list('ClientPayment');
  const schedules = list('PaymentScheduleItem').filter((item) => !['PAID', 'COMPLETED', 'CANCELLED'].includes(item.state));
  const reportedTotal = clientPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const verifiedTotal = clientPayments.filter((payment) => payment.payment_state === 'VERIFIED').reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const openTaskCount = list('Task', (task) => !['COMPLETED', 'CANCELLED'].includes(task.state)).length;
  const rows = bookings.map((booking) => {
    const quote = latest('Quotation', (item) => item.quotation_id === booking.quotation_id);
    const currency = booking.currency || quote && quote.currency || 'PHP';
    const price = Number(booking.current_price || quote && quote.client_total || 0);
    const allocated = verifiedAllocatedFunds(booking.booking_id, currency);
    const payable = latest('SupplierPayable', (item) => item.booking_id === booking.booking_id);
    const client = latest('Client', (item) => item.client_id === booking.client_id);
    return '<tr><td><button class="secondary" onclick="openBookingRecord(\'' + esc(booking.booking_id) + '\')">' + esc(booking.booking_id) + '</button></td><td>' + esc(client && client.display_name || booking.client_id) + '</td><td>' + esc(price.toFixed(2) + ' ' + currency) + '</td><td>' + esc(allocated.toFixed(2) + ' ' + currency) + '</td><td>' + esc(Math.max(price - allocated, 0).toFixed(2) + ' ' + currency) + '</td><td>' + esc(payable ? payable.amount + ' ' + payable.currency + ' · ' + readableState(payable.state) : 'Not recorded') + '</td></tr>';
  }).join('');
  const scheduleRows = schedules.map((item) => '<tr><td>' + esc(item.booking_id) + '</td><td>' + esc(item.purpose || 'INSTALLMENT') + '</td><td>' + esc(item.amount + ' ' + item.currency) + '</td><td>' + esc(item.due_at || 'Not recorded') + '</td><td>' + status(readableState(item.state || 'DUE'), item.state === 'DUE' ? 'warn' : 'info') + '</td></tr>').join('');
  const paymentRows = clientPayments.slice().reverse().map((payment) => '<tr><td>' + esc(payment.client_payment_id) + '</td><td>' + esc(payment.booking_id || 'Unlinked') + '</td><td>' + esc(payment.amount + ' ' + payment.currency) + '</td><td>' + esc(readableState(payment.payment_purpose || 'OTHER')) + '</td><td>' + status(readableState(payment.payment_state), payment.payment_state === 'VERIFIED' ? 'good' : 'warn') + '</td></tr>').join('');
  return '<div class="grid3"><div class="card"><h3>Client payments reported</h3><div class="money">' + reportedTotal.toFixed(2) + '</div><p class="muted">All recorded currencies shown in source amounts.</p></div><div class="card good"><h3>Verified payments</h3><div class="money">' + verifiedTotal.toFixed(2) + '</div><p class="muted">Verification is separate from entry.</p></div><div class="card warn"><h3>Open deadlines</h3><div class="money">' + (schedules.length + openTaskCount) + '</div><p class="muted">Payment schedules plus staff follow-ups.</p></div></div><div class="card"><h3>Finance overview</h3><p class="muted">Verified, client-directed allocations reduce the balance. Reported or unverified payments do not.</p>' + (rows ? '<div class="table-wrap"><table><thead><tr><th>Booking</th><th>Client</th><th>Client price</th><th>Verified allocated</th><th>Remaining balance</th><th>Supplier Payable</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="empty">No Booking financial records yet.</div>') + '</div>' + '<div class="grid2"><div class="card"><h3>Payment deadlines</h3>' + (scheduleRows ? '<table><thead><tr><th>Booking</th><th>Purpose</th><th>Amount</th><th>Due</th><th>Status</th></tr></thead><tbody>' + scheduleRows + '</tbody></table>' : '<p class="muted">No payment schedules recorded.</p>') + '</div><div class="card"><h3>Recent client payments</h3>' + (paymentRows ? '<table><thead><tr><th>Payment</th><th>Booking</th><th>Amount</th><th>Purpose</th><th>State</th></tr></thead><tbody>' + paymentRows + '</tbody></table>' : '<p class="muted">No client payments recorded.</p>') + '</div></div>';
}

function renderPayment() {
  const records = caseRecords();
  const selectedBookingId = selectedWorkspaceId('booking');
  if (!selectedBookingId || !records.booking || records.booking.booking_id !== selectedBookingId) {
    $('payment-content').innerHTML = financeOverviewMarkup();
    return;
  }
  const payments = list('ClientPayment', (item) => item.booking_id === records.booking.booking_id);
  const projection = projectionForCase(records);
  const fullyPaid = Boolean(projection && projection.finance && projection.finance.state === 'FULLY_FUNDED' && Number(projection.finance.outstanding || 0) === 0);
  const allocations = records.payment ? paymentAllocations(records.payment.client_payment_id) : [];
  const evidence = records.payment ? latest('PaymentEvidence', (item) => item.client_payment_id === records.payment.client_payment_id) : null;
  const obligations = projection && projection.finance && projection.finance.obligations || [];
  const obligationAmountDefault = records.booking.current_price || records.booking.client_total || records.quotation && records.quotation.client_total || '';
  const obligationCurrencyDefault = records.booking.currency || records.quotation && records.quotation.currency || 'PHP';
  const obligationDueDefault = defaultObligationDueDate(records, 'FULL_PAYMENT');
  const scheduledAmount = obligations.reduce((sum, obligation) => sum + Number(obligation.amount || 0), 0);
  const clientPriceForSchedule = obligationAmountDefault === '' ? null : Number(obligationAmountDefault);
  const remainingToSchedule = clientPriceForSchedule === null || Number.isNaN(clientPriceForSchedule) ? null : Math.max(clientPriceForSchedule - scheduledAmount, 0);
  const nextObligationSequence = obligations.reduce((max, obligation) => Math.max(max, Number(obligation.sequence || 0)), 0) + 1;
  const obligationCanBeAdded = remainingToSchedule === null || remainingToSchedule > 0.005;
  const obligationFormAmount = remainingToSchedule === null ? '' : remainingToSchedule.toFixed(2);
  const obligationSetup = obligationCanBeAdded ? '<div class="card warn"><h3>Add client payment obligation</h3><p class="muted">Create down payments, installments, and the final balance separately. The total cannot exceed the client price.</p><div class="grid3"><div class="field"><label>Sequence</label><input id="new-obligation-sequence" type="number" min="1" step="1" value="' + esc(nextObligationSequence) + '"></div><div class="field"><label>Payment</label><select id="new-obligation-purpose" onchange="setDefaultObligationDueDate()"><option value="DOWN_PAYMENT">Down payment</option><option value="INSTALLMENT">Installment</option><option value="FINAL_BALANCE">Final balance</option><option value="FULL_PAYMENT">Full payment</option></select></div><div class="field"><label>Amount</label><input id="new-obligation-amount" type="number" min="0.01" max="' + (remainingToSchedule === null ? '' : esc(remainingToSchedule.toFixed(2))) + '" step="0.01" value="' + esc(obligationFormAmount) + '"></div></div><div class="grid2"><div class="field"><label>Currency</label><input id="new-obligation-currency" value="' + esc(obligationCurrencyDefault) + '"></div><div class="field"><label>Due date</label><input id="new-obligation-due" type="datetime-local" value="' + esc(obligationDueDefault) + '"></div></div>' + (remainingToSchedule === null ? '' : '<p class="muted">Remaining amount to schedule: ' + esc(remainingToSchedule.toFixed(2) + ' ' + obligationCurrencyDefault) + '</p>') + '<button class="secondary" onclick="createClientPaymentObligation()">Add payment obligation</button></div>' : '<div class="card good"><h3>Client payment schedule complete</h3><p class="muted">The configured obligations now cover the full client price. No additional obligation can be added.</p></div>';
  const obligationRows = obligations.length ? obligations.map((obligation) => '<tr><td>' + esc(obligation.purpose) + '</td><td>' + esc(obligation.amount + ' ' + obligation.currency) + '</td><td>' + esc(obligation.allocated + ' ' + obligation.currency) + '</td><td>' + esc(obligation.outstanding + ' ' + obligation.currency) + '</td><td>' + status(readableState(obligation.state), obligation.state === 'SATISFIED' ? 'good' : 'warn') + '</td></tr>').join('') : '<tr><td colspan="5">No authoritative client obligations recorded.</td></tr>';
  const obligationOptions = obligations.filter((obligation) => obligation.obligationId).map((obligation) => '<option value="' + esc(obligation.obligationId) + '">' + esc(obligation.purpose + ' · ' + obligation.outstanding + ' ' + obligation.currency) + '</option>').join('');
  const cleanObligationOptions = obligationOptions.replace(/[^\x20-\x7E]+/g, ' - ');
  const allocationTargetMarkup = '<div class="allocation-target"><h4>Allocate verified payment</h4><p class="muted">Choose the Client Obligation this payment should satisfy.</p><select id="allocation-obligation"><option value="">Select obligation</option>' + cleanObligationOptions + '</select>' + (cleanObligationOptions ? '' : '<p class="muted">No obligation exists yet for this Booking.</p><button class="secondary" onclick="createObligationFromClientInstruction()">Create from instruction</button>') + '</div>';
  const financeContext = '<div class="selection-bar"><strong>' + esc(records.client && records.client.display_name || records.booking.client_id) + '</strong><span>' + esc(bookingDestination(records.booking)) + '</span><span>' + esc(bookingTravelLabel(records.booking)) + '</span><span>Booking ' + esc(records.booking.booking_id) + '</span><span class="spacer"></span><button class="secondary compact" onclick="previewClientInvoice()">Client invoice</button></div>';
  const financeNextAction = '';
  const projectionMarkup = '<div class="card"><h3>Financial summary</h3>' + field('Finance state', projection && projection.finance && projection.finance.state) + field('Readiness', projection && projection.readiness && projection.readiness.state) + (projection && projection.blockers && projection.blockers.length ? '<p class="muted">' + esc(projection.blockers.map((blocker) => blocker.message).join(' · ')) + '</p>' : '<p class="muted">No current financial blockers.</p>') + '<h4>Client payment obligations</h4><table><thead><tr><th>Purpose</th><th>Amount</th><th>Allocated</th><th>Outstanding</th><th>State</th></tr></thead><tbody>' + obligationRows + '</tbody></table></div>';
  const paymentForm = '<div class="card"><h3>Record Client Payment</h3><p class="muted">Add payment evidence. Verification and allocation are separate.</p><div class="grid3"><div class="field"><label>Amount</label><input id="payment-amount" type="number" min="0" step="0.01"></div><div class="field"><label>Currency</label><input id="payment-currency" value="PHP"></div><div class="field"><label>Payment sent timestamp</label><input id="payment-sent-at" type="datetime-local"></div></div><div class="grid3"><div class="field"><label>Proof/reference</label><input id="payment-proof" placeholder="Receipt, transfer reference, or proof ID"></div><div class="field"><label>Payment proof file</label><input id="payment-proof-file" type="file"></div><div class="field"><label>Payment method</label><input id="payment-method" placeholder="Bank transfer, cash, card, etc."></div></div><button onclick="recordPayment()">Add payment</button></div>';
  const paymentHistory = payments.length ? '<div class="card"><h3>Payment history</h3><table><thead><tr><th>Sent at</th><th>Amount</th><th>Verification</th><th>Allocation</th></tr></thead><tbody>' + payments.map((item) => '<tr><td>' + esc(item.actual_sent_at || 'Not recorded') + '</td><td>' + esc(item.amount + ' ' + item.currency) + '</td><td>' + status(readableState(item.payment_state), item.payment_state === 'VERIFIED' ? 'good' : 'warn') + '</td><td>' + esc(paymentAllocations(item.client_payment_id).map((allocation) => allocation.amount + ' ' + allocation.currency).join(', ') || 'Unallocated') + '</td></tr>').join('') + '</tbody></table></div>' : '';
  const payment = records.payment ? '<div class="card"><h3>Client Payment</h3><p class="money">' + esc(records.payment.amount) + ' ' + esc(records.payment.currency) + '</p>' + field('Payment sent at', records.payment.actual_sent_at) + field('Proof/reference', records.payment.proof_reference || evidence && evidence.proof_reference) + field('Verification', readableState(records.payment.payment_state)) + (records.payment.payment_state === 'VERIFIED' ? '<p class="muted">Verified by ' + esc(records.payment.verified_by || 'authorized local actor') + '.</p>' : '<button class="secondary" onclick="verifyPayment()">Verify</button>') + (allocations.length ? '<h4>Client-directed allocation</h4>' + allocations.map((item) => '<div class="event">' + esc(item.amount + ' ' + item.currency) + ' allocated to Booking ' + esc(item.booking_id || 'target') + '</div>').join('') : '<p class="muted">UNALLOCATED / NEEDS ALLOCATION — no client allocation instruction has been recorded.</p>' + (records.payment.payment_state === 'VERIFIED' ? '<div class="grid2"><div class="field"><label>Client-instructed amount for this Booking</label><input id="allocation-amount" type="number" min="0" step="0.01"></div><div class="field"><label>Instruction note</label><input id="allocation-note" placeholder="Client instruction reference"></div></div><button onclick="allocatePayment()">Allocate payment</button>' : '')) + '</div>' : '<div class="card"><h3>Record Client Payment</h3><p class="muted">Add payment evidence. Verification and allocation are separate.</p><div class="grid3"><div class="field"><label>Amount</label><input id="payment-amount" type="number" min="0" step="0.01"></div><div class="field"><label>Currency</label><input id="payment-currency" value="PHP"></div><div class="field"><label>Payment sent timestamp</label><input id="payment-sent-at" type="datetime-local"></div></div><div class="grid2"><div class="field"><label>Proof/reference</label><input id="payment-proof" placeholder="Receipt, transfer reference, or proof ID"></div><div class="field"><label>Payment method</label><input id="payment-method" placeholder="Bank transfer, cash, card, etc."></div></div><button onclick="recordPayment()">Add payment</button></div>';
  const paymentPurposeField = '<div class="field"><label>Payment purpose</label><select id="payment-purpose"><option value="DOWN_PAYMENT">Down payment</option><option value="PARTIAL_PAYMENT">Installment / partial payment</option><option value="FULL_PAYMENT">Full payment</option><option value="BALANCE_PAYMENT">Final balance payment</option><option value="OTHER">Other</option></select><span class="muted">Partial/installment is any payment before the balance is cleared. Final balance is the remaining amount due. Full payment is the client-stated intent to settle the whole obligation.</span></div>';
  const paymentFormWithPurpose = fullyPaid ? '<div class="card good"><h3>Client payment complete</h3><p class="muted">This Booking is fully paid. Additional client payments cannot be recorded here. Review duplicate or excess funds separately.</p></div>' : paymentForm.replace('<h3>Record Client Payment</h3>', '<h3>Record Client Payment</h3><p class="muted">Purpose is intent; allocation determines the balance.</p>' + paymentPurposeField);
  const paymentWithForm = records.payment ? payment + paymentFormWithPurpose : paymentFormWithPurpose;
  const payable = records.payable ? '<div class="card"><h3>Supplier Payable</h3>' + field('Payable ID', records.payable.supplier_payable_id) + field('Amount', records.payable.amount + ' ' + records.payable.currency) + field('State', readableState(records.payable.state)) + field('Verified allocated client funds', verifiedAllocatedFunds(records.booking.booking_id, records.payable.currency).toFixed(2) + ' ' + records.payable.currency) + (records.payable.state === 'DRAFT' ? '<button class="secondary" onclick="approvePayable()">Approve Supplier Payable</button>' : '') + '</div>' : '<div class="card"><h3>Record Supplier Payable</h3><p class="muted">Record the actual supplier obligation. Approval and Supplier Payment remain separate.</p><div class="grid3"><div class="field"><label>Amount</label><input id="payable-amount" type="number" min="0" step="0.01"></div><div class="field"><label>Currency</label><input id="payable-currency" value="PHP"></div><div class="field"><label>Component</label><input id="payable-component" placeholder="Deposit, final balance, penalty, etc."></div></div><button onclick="createPayable()">Create Supplier Payable</button></div>';
  const supplierPayment = records.payable ? '<div class="card ' + (records.supplierPayment ? 'good' : 'blocked') + '"><h3>Supplier Payment</h3>' + field('Status', records.supplierPayment ? 'EXECUTED' : 'NOT EXECUTED') + field('Gate', records.supplierPayment ? 'Verified client funds covered the payable' : 'Blocked until sufficient verified client funds cover the payable') + (records.supplierPayment ? '<p class="muted">Payment ID: ' + esc(records.supplierPayment.supplier_payment_id) + '</p>' : '<button class="warning" onclick="paySupplier()">Pay supplier</button>') + '</div>' : '<div class="card blocked"><h3>Supplier Payment</h3><p>NOT EXECUTED — create and approve a Supplier Payable first.</p></div>';
  const correctedProjectionMarkup = projectionMarkup.replace('Client obligations', 'Client payment obligations');
  $('payment-content').innerHTML = financeContext + financeNextAction + obligationSetup + correctedProjectionMarkup + paymentBalanceSummary(records, payments) + '<div class="grid2">' + paymentWithForm + '<div>' + payable + supplierPayment + '</div></div>' + paymentHistory;
  const clientPaymentCard = Array.from(document.querySelectorAll('#payment-content .card')).find((card) => { const heading = card.querySelector('h3'); return heading && heading.textContent.trim() === 'Client Payment'; });
  if (clientPaymentCard && records.payment && records.payment.payment_state === 'VERIFIED' && !allocations.length) {
    const allocationFields = $('allocation-amount') && $('allocation-amount').closest('.grid2');
    if (allocationFields) allocationFields.insertAdjacentHTML('beforebegin', allocationTargetMarkup);
  }
  enhancePaymentObligationSetup(records, obligations);
  enhancePaymentLabels();
  if (obligations.length === 1 && obligations[0].obligationId) {
    const obligationSelect = $('allocation-obligation');
    if (obligationSelect) obligationSelect.value = obligations[0].obligationId;
    const allocationAmount = $('allocation-amount');
    if (allocationAmount && !allocationAmount.value && records.payment && records.payment.payment_state === 'VERIFIED') allocationAmount.value = records.payment.amount || '';
  }
  const outstandingObligations = obligations.filter((obligation) => Number(obligation.outstanding || 0) > 0 && obligation.obligationId);
  const unallocatedVerified = Number(projection && projection.finance && projection.finance.unallocatedVerified || 0);
  if (!outstandingObligations.length && unallocatedVerified > 0) {
    const obligationSelect = $('allocation-obligation');
    if (obligationSelect) {
      obligationSelect.innerHTML = '<option value="">No outstanding obligation</option>';
      obligationSelect.disabled = true;
      const targetCard = obligationSelect.closest('.allocation-target');
      if (targetCard) {
        const heading = targetCard.querySelector('h4');
        const message = targetCard.querySelector('p');
        if (heading) heading.textContent = 'No allocation target needed';
        if (message) message.textContent = 'The configured client obligation is already satisfied. Review the remaining verified funds for duplicate payment records, overpayment, or a new client instruction.';
      }
    }
    const nextCard = Array.from(document.querySelectorAll('#payment-content .card')).find((card) => { const eyebrow = card.querySelector('.eyebrow'); return eyebrow && eyebrow.textContent.trim() === 'Next finance action'; });
    if (nextCard) {
      const heading = nextCard.querySelector('h3');
      const message = nextCard.querySelector('p');
      if (heading) heading.textContent = 'Review excess verified funds';
      if (message) message.textContent = unallocatedVerified.toFixed(2) + ' ' + (projection && projection.finance && projection.finance.currency || records.booking.currency || 'PHP') + ' remains outside the satisfied client obligation.';
    }
    const nextActionField = Array.from(document.querySelectorAll('#payment-content .field')).find((field) => { const label = field.querySelector('label'); return label && label.textContent.trim() === 'Next action'; });
    if (nextActionField) nextActionField.querySelector('div').textContent = 'Review excess verified funds';
    const paymentCard = Array.from(document.querySelectorAll('#payment-content .card')).find((card) => { const heading = card.querySelector('h3'); return heading && heading.textContent.trim() === 'Client Payment'; });
    if (paymentCard && $('allocation-amount')) {
      const allocationFields = $('allocation-amount').closest('.grid2');
      if (allocationFields) allocationFields.remove();
      const allocationButton = Array.from(paymentCard.querySelectorAll('button')).find((button) => button.textContent.includes('Allocate payment'));
      if (allocationButton) allocationButton.remove();
      paymentCard.insertAdjacentHTML('beforeend', '<p class="muted">No allocation was recorded for this payment because the configured obligation is already satisfied.</p>');
    }
  }
}

async function createClientPaymentObligation() {
  const records = caseRecords();
  if (!records.booking) return failLocal('Create a Booking record first.');
  const amount = $('new-obligation-amount') && $('new-obligation-amount').value;
  const dueAt = $('new-obligation-due') && $('new-obligation-due').value;
  const sequence = Number($('new-obligation-sequence') && $('new-obligation-sequence').value || 1);
  const purpose = $('new-obligation-purpose') && $('new-obligation-purpose').value || 'INSTALLMENT';
  const currency = ($('new-obligation-currency') && $('new-obligation-currency').value || records.booking.currency || 'PHP').trim().toUpperCase();
  if (!amount) return failLocal('Obligation amount and due date are required.', 'new-obligation-amount');
  if (!dueAt) return failLocal('Obligation amount and due date are required.', 'new-obligation-due');
  if (!Number.isInteger(sequence) || sequence < 1) return failLocal('Use a positive payment sequence number.', 'new-obligation-sequence');
  const projection = projectionForCase(records);
  const obligations = projection && projection.finance && projection.finance.obligations || [];
  if (obligations.some((obligation) => Number(obligation.sequence) === sequence)) return failLocal('That payment sequence already exists. Use the next unused sequence number.', 'new-obligation-sequence');
  const clientPrice = Number(records.booking.current_price || records.booking.client_total || records.quotation && records.quotation.client_total || 0);
  const scheduled = obligations.reduce((sum, obligation) => sum + Number(obligation.amount || 0), 0);
  if (clientPrice > 0 && scheduled + Number(amount) > clientPrice + 0.005) return failLocal('This obligation exceeds the remaining client amount of ' + Math.max(clientPrice - scheduled, 0).toFixed(2) + ' ' + currency + '.', 'new-obligation-amount');
  await api('createBookingPaymentObligations', { booking_id: records.booking.booking_id, obligations: [{ sequence, purpose, amount, currency, due_at: new Date(dueAt).toISOString() }] }, 'LOCAL_STAFF');
}

async function createObligationFromClientInstruction() {
  const records = caseRecords();
  if (!records.booking || !records.payment) return failLocal('A Booking and verified client payment are required.');
  if (records.payment.payment_state !== 'VERIFIED') return failLocal('Verify the client payment before creating an obligation from its instruction.');
  const amount = $('allocation-amount') && $('allocation-amount').value;
  if (!amount) return failLocal('Enter the client-instructed amount for this Booking first.');
  const dueAt = records.booking.travel_start ? records.booking.travel_start + 'T00:00:00' : new Date().toISOString();
  const note = $('allocation-note') && $('allocation-note').value.trim();
  await api('createBookingPaymentObligations', { booking_id: records.booking.booking_id, obligations: [{ sequence: 1, purpose: 'FULL_PAYMENT', amount, currency: records.payment.currency, due_at: new Date(dueAt).toISOString(), instruction_note: note || undefined }] }, 'LOCAL_STAFF');
}

async function recordPayment() {
  const records = caseRecords();
  if (!records.booking) return failLocal('Create a Booking record first.');
  const proofReference = $('payment-proof').value.trim();
  const proofFile = $('payment-proof-file') && $('payment-proof-file').files && $('payment-proof-file').files[0];
  if (!$('payment-amount').value || !$('payment-sent-at').value || (!proofReference && !proofFile)) return failLocal('Amount, payment sent timestamp, and a proof reference or proof file are required.');
  let proofDocumentId;
  if (proofFile) {
    if (proofFile.size > 500 * 1024) return failLocal('The local payment-proof limit is 500 KB.');
    const content = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '').split(',')[1] || ''); reader.onerror = () => reject(new Error('The payment proof file could not be read.')); reader.readAsDataURL(proofFile); });
    const document = await api('createDocument', { external_file_id: 'LOCAL-PAYMENT-PROOF-' + Date.now(), file_name: proofFile.name, file_url: 'LOCAL-SYNTHETIC-FILE://' + encodeURIComponent(proofFile.name), file_ref: 'LOCAL-SYNTHETIC-FILE://' + encodeURIComponent(proofFile.name), mime_type: proofFile.type || 'application/octet-stream', file_size: proofFile.size, content_base64: content, source_type: 'CLIENT_PAYMENT', source_name: records.client && records.client.display_name, document_type: 'PAYMENT_PROOF', extraction_status: 'NOT_PROCESSED', status: 'Received', received_at: new Date().toISOString(), booking_id: records.booking.booking_id, inquiry_id: records.inquiry.inquiry_id, notes: 'Payment evidence attached from the local Operations Workspace.' }, 'LOCAL_STAFF');
    if (!document) return;
    proofDocumentId = document.document_id;
  }
  await api('recordClientPayment', { booking_id: records.booking.booking_id, client_id: records.client && records.client.client_id, amount: $('payment-amount').value, currency: $('payment-currency').value || 'PHP', actual_sent_at: new Date($('payment-sent-at').value).toISOString(), proof_document_id: proofDocumentId, proof_reference: proofReference || undefined, payment_method: $('payment-method').value.trim(), payment_purpose: $('payment-purpose').value }, 'LOCAL_STAFF');
}

async function verifyPayment() {
  const records = caseRecords();
  if (!records.payment) return failLocal('Record payment evidence first.');
  if (!window.confirm('Verify this client payment evidence?')) return;
  await api('verifyClientPayment', { client_payment_id: records.payment.client_payment_id }, 'LOCAL_MANAGER');
}

async function allocatePayment() {
  const records = caseRecords();
  if (!records.payment || !records.booking) return failLocal('Record a payment and Booking first.');
  const amount = $('allocation-amount') && $('allocation-amount').value;
  const instructionNote = $('allocation-note') && $('allocation-note').value.trim();
  if (!amount) return failLocal('No client allocation instruction recorded. Leave the payment unallocated until the client provides one.');
  let obligationId = $('allocation-obligation') && $('allocation-obligation').value;
  if (!obligationId) {
    const projection = projectionForCase(records);
    const obligations = projection && projection.finance && projection.finance.obligations || [];
    if (!obligations.length) {
      const dueAt = records.booking.travel_start ? records.booking.travel_start + 'T00:00:00' : new Date().toISOString();
      const created = await api('createBookingPaymentObligations', { booking_id: records.booking.booking_id, obligations: [{ sequence: 1, purpose: 'FULL_PAYMENT', amount, currency: records.payment.currency, due_at: new Date(dueAt).toISOString(), instruction_note: instructionNote || undefined }] }, 'LOCAL_STAFF');
      obligationId = created && created.obligations && created.obligations[0] && created.obligations[0].client_obligation_id;
    }
  }
  if (!obligationId) return failLocal('Select the Client Obligation this verified payment should satisfy.');
  if (!window.confirm('Allocate ' + amount + ' ' + (records.payment.currency || 'PHP') + ' to the selected obligation?')) return;
  const idempotencyKey = 'LOCAL-ALLOCATION-' + [records.payment.client_payment_id, records.booking.booking_id, obligationId, amount].map((value) => encodeURIComponent(String(value))).join('-');
  await api('allocatePayment', { client_payment_id: records.payment.client_payment_id, idempotency_key: idempotencyKey, allocations: [{ booking_id: records.booking.booking_id, client_obligation_id: obligationId, amount, instruction_note: instructionNote || undefined }] }, 'LOCAL_STAFF');
}

async function createPayable() {
  const records = caseRecords();
  if (!records.supplierBooking || !records.booking) return failLocal('Request a Supplier reservation first.');
  if (!$('payable-amount').value) return failLocal('Enter the actual Supplier Payable amount.');
  if (!window.confirm('Record this Supplier Payable?')) return;
  await api('createSupplierPayable', { supplier_booking_id: records.supplierBooking.supplier_booking_id, booking_id: records.booking.booking_id, amount: $('payable-amount').value, currency: $('payable-currency').value || 'PHP', component_type: $('payable-component').value.trim() || undefined }, 'LOCAL_STAFF');
}

async function approvePayable() {
  const records = caseRecords();
  if (!records.payable) return failLocal('Create a Supplier Payable first.');
  if (records.payable.state !== 'DRAFT') return failLocal('Only a draft Supplier Payable can be approved.');
  if (!window.confirm('Approve this Supplier Payable for payment?')) return;
  await api('approveSupplierPayable', { supplier_payable_id: records.payable.supplier_payable_id }, 'LOCAL_MANAGER');
}

async function paySupplier() {
  const records = caseRecords();
  if (!records.payable) return failLocal('Create a Supplier Payable first.');
  if (records.payable.state !== 'APPROVED') return failLocal('Approve the Supplier Payable before paying it.');
  if (!window.confirm('Execute this Supplier Payment? This records money sent to the supplier.')) return;
  const idempotencyKey = 'LOCAL-SUPPLIER-PAYMENT-' + records.payable.supplier_payable_id + '-' + records.payable.amount;
  await api('executeSupplierPayment', { supplier_payable_id: records.payable.supplier_payable_id, amount: records.payable.amount, idempotency_key: idempotencyKey }, 'LOCAL_MANAGER');
}

function openSupplierRecord(supplierId) {
  setWorkspaceId('supplier', supplierId);
  if (currentTab() === 'suppliers') render();
  else window.location.hash = 'suppliers';
}

function openClientRecord(clientId) {
  setWorkspaceId('client', clientId);
  if (currentTab() === 'clients') render();
  else window.location.hash = 'clients';
}

function clearClientRecord() {
  clearWorkspaceId('client');
  render();
}

async function createClientRecord() {
  const name = $('client-name') && $('client-name').value.trim();
  if (!name) return failLocal('Enter the client or organization name.');
  const result = await api('createClient', {
    display_name: name,
    legal_name: $('client-legal-name').value.trim() || name,
    client_type: $('client-type').value,
    primary_email: $('client-email').value.trim() || undefined,
    primary_phone: $('client-phone').value.trim() || undefined,
    country: $('client-country').value.trim() || undefined,
    notes: $('client-notes').value.trim() || undefined
  }, 'LOCAL_STAFF');
  if (result && result.client_id) {
    const returnHash = sessionStorage.getItem('wmit.pendingClientReturnHash');
    sessionStorage.removeItem('wmit.pendingClientReturnHash');
    if (returnHash) window.location.hash = returnHash;
    else openClientRecord(result.client_id);
  }
}

async function saveClientRecord(clientId) {
  const name = $('client-edit-name') && $('client-edit-name').value.trim();
  if (!name) return failLocal('Enter the client or organization name.');
  await api('updateClient', {
    client_id: clientId,
    changes: {
      display_name: name,
      legal_name: $('client-edit-legal-name').value.trim() || name,
      client_type: $('client-edit-type').value,
      primary_email: $('client-edit-email').value.trim() || undefined,
      primary_phone: $('client-edit-phone').value.trim() || undefined,
      country: $('client-edit-country').value.trim() || undefined,
      status: $('client-edit-status').value,
      notes: $('client-edit-notes').value.trim() || undefined
    }
  }, 'LOCAL_STAFF');
}

function clearSupplierRecord() {
  clearWorkspaceId('supplier');
  render();
}

async function createSubAgentRecord() {
  const name = $('subagent-name') && $('subagent-name').value.trim();
  const roles = Array.prototype.map.call(document.querySelectorAll('#subagent-form input[type=checkbox]:checked'), (input) => input.value);
  if (!name) return failLocal('Enter the sub-agent or partner agency name.');
  if (!roles.length) return failLocal('Select at least one sub-agent role.');
  await api('createSubAgent', {
    display_name: name,
    legal_name: $('subagent-legal-name').value.trim() || name,
    roles,
    primary_email: $('subagent-email').value.trim() || undefined,
    primary_phone: $('subagent-phone').value.trim() || undefined,
    commission_terms: $('subagent-commission').value.trim() || undefined,
    notes: $('subagent-notes').value.trim() || undefined
  }, 'LOCAL_STAFF');
}

function renderSubAgents() {
  const agents = list('SubAgent');
  const form = '<div id="subagent-form" class="card"><h3>Add sub-agent / partner</h3><p class="muted">A sub-agent can have multiple roles. Keep it separate from the supplier directory because it may refer clients, resell WMIT products, or coordinate a client relationship.</p><div class="grid3"><div class="field"><label>Name *</label><input id="subagent-name" placeholder="Partner agency or agent"></div><div class="field"><label>Legal name</label><input id="subagent-legal-name"></div><div class="field"><label>Email</label><input id="subagent-email" type="email"></div><div class="field"><label>Phone</label><input id="subagent-phone"></div><div class="field"><label>Commission terms</label><input id="subagent-commission" placeholder="e.g. 10% after client payment"></div></div><div class="field"><label>Roles</label><label><input type="checkbox" value="REFERRAL_PARTNER"> Referral partner</label> <label><input type="checkbox" value="RESELLER"> Reseller</label> <label><input type="checkbox" value="B2B_AGENCY"> B2B agency</label> <label><input type="checkbox" value="COORDINATOR"> Coordinator</label></div><div class="field"><label>Notes</label><textarea id="subagent-notes" rows="2"></textarea></div><button onclick="createSubAgentRecord()">Save sub-agent</button></div>';
  const rows = agents.map((agent) => '<tr><td><strong>' + esc(agent.display_name || agent.legal_name || agent.sub_agent_id) + '</strong><br><span class="muted">' + esc(agent.sub_agent_id) + '</span></td><td>' + esc((agent.roles || []).map(readableState).join(' · ') || 'Not recorded') + '</td><td>' + esc(agent.primary_email || 'Not recorded') + '</td><td>' + esc(agent.primary_phone || 'Not recorded') + '</td><td>' + status(agent.status || 'ACTIVE', agent.status === 'ACTIVE' ? 'good' : 'warn') + '</td></tr>').join('');
  $('subagents-content').innerHTML = form + '<div class="card"><h3>Sub-agent directory</h3>' + (rows ? '<div class="table-wrap"><table><thead><tr><th>Partner</th><th>Roles</th><th>Email</th><th>Phone</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="empty">No sub-agents recorded yet.</div>') + '</div>';
}

const SUPPLIER_CAPABILITY_CHOICES = ['DMC', 'Tariff Supplier', 'Transport Provider', 'Hotel Partner', 'Visa Assistance', 'Insurance'];

function supplierAddFormMarkup(supplierCount) {
  const capabilityChips = SUPPLIER_CAPABILITY_CHOICES.map((capability) =>
    '<label style="display:inline-flex;align-items:center;gap:7px;margin:2px 16px 2px 0;font-size:13px;font-weight:500;cursor:pointer"><input type="checkbox" class="supplier-cap-checkbox" value="' + esc(capability) + '">' + esc(capability) + '</label>'
  ).join('');
  return '<div class="panel">' +
    '<div class="panel-head"><div><h3>Add supplier</h3><p class="muted">' + (supplierCount ? 'Every tariff, supplier reservation, and payable links to a Supplier record.' : 'No suppliers yet — create the first one. Every tariff, supplier reservation, and payable links to a Supplier record.') + '</p></div></div>' +
    '<div class="grid2">' +
    '<div class="field"><label>Supplier name *</label><input id="supplier-new-name" maxlength="120" placeholder="e.g. Sunshine Tours" autocomplete="off"></div>' +
    '<div class="field"><label>Legal name (optional)</label><input id="supplier-new-legal" maxlength="160" placeholder="e.g. Sunshine Tours Co., Ltd." autocomplete="off"></div>' +
    '<div class="field"><label>Country (optional)</label><input id="supplier-new-country" maxlength="60" placeholder="e.g. Thailand" autocomplete="off"></div>' +
    '<div class="field"><label>Primary email (optional)</label><input id="supplier-new-email" type="email" maxlength="120" placeholder="ops@supplier.com" autocomplete="off"></div>' +
    '</div>' +
    '<div class="field"><label>Capabilities</label><div>' + capabilityChips + '</div></div>' +
    '<details class="secondary-details"><summary>Terms and procedures (optional)</summary><div class="field"><label>Payment terms</label><textarea id="supplier-new-payment-terms" rows="2" placeholder="e.g. 50% on confirmation, balance 30 days before departure"></textarea></div><div class="field"><label>Booking procedure</label><textarea id="supplier-new-booking-procedure" rows="2" placeholder="e.g. email reservations@… with the voucher and pax names"></textarea></div><div class="field"><label>Cancellation terms</label><textarea id="supplier-new-cancellation-terms" rows="2"></textarea></div><div class="field"><label>Operational notes</label><textarea id="supplier-new-notes" rows="2"></textarea></div></details>' +
    '<details class="secondary-details"><summary>Primary contact (optional)</summary><div class="grid2"><div class="field"><label>Contact name</label><input id="supplier-new-contact-name" maxlength="120" autocomplete="off"></div><div class="field"><label>Contact role / purpose</label><input id="supplier-new-contact-role" maxlength="120" placeholder="e.g. Reservations" autocomplete="off"></div><div class="field"><label>Contact email</label><input id="supplier-new-contact-email" type="email" maxlength="120" autocomplete="off"></div><div class="field"><label>Contact phone</label><input id="supplier-new-contact-phone" maxlength="40" autocomplete="off"></div><div class="field"><label>WhatsApp (optional)</label><input id="supplier-new-contact-whatsapp" maxlength="40" autocomplete="off"></div></div></details>' +
    '<button onclick="createSupplierFromForm()">Add supplier</button>' +
    '</div>';
}

async function createSupplierFromForm() {
  const displayName = $('supplier-new-name').value.trim();
  if (!displayName) { focusRequiredField('supplier-new-name'); return showMessage('✕ Add supplier — NOT EXECUTED', 'Enter the supplier name.', 'error'); }
  // Collect every field up front: the first api() call re-renders the tab
  // and would otherwise blank the form before the contact section is read.
  const payload = { display_name: displayName };
  const optionalText = [['supplier-new-legal', 'legal_name'], ['supplier-new-country', 'country'], ['supplier-new-email', 'primary_email'], ['supplier-new-payment-terms', 'payment_terms'], ['supplier-new-booking-procedure', 'booking_procedure'], ['supplier-new-cancellation-terms', 'cancellation_terms'], ['supplier-new-notes', 'notes']];
  optionalText.forEach(([id, key]) => { const value = $(id).value.trim(); if (value) payload[key] = value; });
  const capabilities = Array.from(document.querySelectorAll('.supplier-cap-checkbox:checked')).map((checkbox) => checkbox.value);
  if (capabilities.length) payload.capabilities = capabilities;
  const contactName = $('supplier-new-contact-name').value.trim();
  const contactEmail = $('supplier-new-contact-email').value.trim();
  const contactPhone = $('supplier-new-contact-phone').value.trim();
  const contactWhatsapp = $('supplier-new-contact-whatsapp').value.trim();
  const contactRole = $('supplier-new-contact-role').value.trim();
  const supplier = await api('createSupplier', payload);
  if (!supplier) return;
  if (contactName || contactEmail || contactPhone || contactWhatsapp) {
    const contact = { supplier_id: supplier.supplier_id };
    if (contactName) contact.name = contactName;
    if (contactRole) contact.contact_type = contactRole;
    if (contactEmail) contact.email = contactEmail;
    if (contactPhone) contact.phone = contactPhone;
    if (contactWhatsapp) contact.whatsapp = contactWhatsapp;
    const saved = await api('createSupplierContact', contact);
    if (!saved) showMessage('Supplier created', 'The contact could not be saved — reopen the supplier to add it.', 'warn');
  }
  openSupplierRecord(supplier.supplier_id);
}

function renderSuppliers() {
  const suppliers = list('Supplier');
  const selectedId = selectedWorkspaceId('supplier');
  if (selectedId) {
    const supplier = latest('Supplier', (item) => item.supplier_id === selectedId);
    if (!supplier) {
      clearWorkspaceId('supplier');
      return renderSuppliers();
    }
    const contacts = list('SupplierContact', (item) => item.supplier_id === supplier.supplier_id);
    const tariffs = list('TariffSource', (item) => item.supplier_id === supplier.supplier_id);
    const documents = list('Document', (item) => item.supplier_id === supplier.supplier_id || item.source_name === supplier.display_name);
    $('suppliers-content').innerHTML = '<div class="selection-bar"><button class="secondary" onclick="clearSupplierRecord()">Back to Supplier list</button><strong>' + esc(supplier.display_name || supplier.legal_name || supplier.supplier_id) + '</strong></div><article class="card"><h3>' + esc(supplier.display_name || supplier.legal_name || supplier.supplier_id) + '</h3>' + field('Status', supplier.status) + field('Capabilities', supplier.capabilities) + '<details class="secondary-details" open><summary>Contacts</summary>' + (contacts.length ? contacts.map((contact) => '<div class="event"><strong>' + esc(contact.name || contact.contact_name || 'Contact') + '</strong> · ' + esc(contact.contact_type || contact.purpose || 'Operational contact') + '<br>' + esc(contact.email || 'Email not recorded') + ' · ' + esc(contact.phone || contact.whatsapp || 'Phone not recorded') + '</div>').join('') : '<p class="muted">Not recorded</p>') + '</details><details class="secondary-details"><summary>Terms and procedures</summary>' + field('Payment terms', supplier.payment_terms) + field('Booking procedure', supplier.booking_procedure) + field('Cancellation terms', supplier.cancellation_terms) + field('Operational notes', supplier.notes) + '</details><details class="secondary-details"><summary>Tariffs and files (' + tariffs.length + ' tariffs · ' + documents.length + ' files)</summary>' + (tariffs.length ? tariffs.map((tariff) => '<div class="event"><button class="secondary compact" onclick="openTariffRecord(\'' + esc(tariff.tariff_source_id) + '\')">Open tariff</button> ' + esc(tariff.original_source && tariff.original_source.file_name || tariff.file_name || tariff.tariff_source_id) + '</div>').join('') : '<p class="muted">Not recorded</p>') + (documents.length ? documents.map((document) => '<div class="event">' + esc(document.file_name || document.document_type || 'Supplier document') + '</div>').join('') : '') + '</details><details class="secondary-details"><summary>Technical details</summary><p class="muted">Supplier ID: ' + esc(supplier.supplier_id) + '</p></details></article>';
    return;
  }
  const rows = suppliers.map((supplier) => {
    const contacts = list('SupplierContact', (item) => item.supplier_id === supplier.supplier_id);
    const tariffs = list('TariffSource', (item) => item.supplier_id === supplier.supplier_id);
    const bookings = list('SupplierBooking', (item) => item.supplier_id === supplier.supplier_id);
    const contact = contacts[0];
    return '<tr><td><strong>' + esc(supplier.display_name || supplier.legal_name || supplier.supplier_id) + '</strong></td><td>' + esc(supplier.status || 'Not recorded') + '</td><td>' + esc(contact && (contact.email || contact.phone || contact.whatsapp) || 'Not recorded') + '</td><td>' + esc(tariffs.length + ' tariffs · ' + bookings.length + ' bookings') + '</td><td><button class="secondary" onclick="openSupplierRecord(\'' + esc(supplier.supplier_id) + '\')">Open supplier</button></td></tr>';
  }).join('');
  $('suppliers-content').innerHTML = supplierAddFormMarkup(suppliers.length) + '<div class="panel"><div class="panel-head"><div><h3>Supplier directory</h3><p class="muted">Select a supplier to view its operational knowledge hub.</p></div></div>' + (rows ? '<div class="table-wrap"><table><thead><tr><th>Supplier</th><th>Status</th><th>Primary contact</th><th>Operational records</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="empty">No Supplier records are currently available.</div>') + '</div>';
  return;
  const cards = suppliers.map((supplier) => {
    const contacts = list('SupplierContact', (item) => item.supplier_id === supplier.supplier_id);
    const tariffs = list('TariffSource', (item) => item.supplier_id === supplier.supplier_id);
    const packages = list('SupplierPackage', (item) => item.supplier_id === supplier.supplier_id);
    const bookings = list('SupplierBooking', (item) => item.supplier_id === supplier.supplier_id);
    const documents = list('Document', (item) => item.supplier_id === supplier.supplier_id || item.source_name === supplier.display_name);
    return '<article class="card"><h3>' + esc(supplier.display_name || supplier.legal_name || supplier.supplier_id) + '</h3>' + field('Capabilities', supplier.capabilities) + field('Payment terms', supplier.payment_terms) + field('Booking procedure', supplier.booking_procedure) + field('Notes', supplier.notes) + '<h4>Contacts</h4>' + (contacts.length ? contacts.map((contact) => '<div class="event"><strong>' + esc(contact.name || contact.contact_name || 'Contact') + '</strong> · ' + esc(contact.contact_type || contact.purpose || 'Operational contact') + '<br>' + esc(contact.email || 'Email not recorded') + ' · ' + esc(contact.phone || contact.whatsapp || 'Phone not recorded') + '</div>').join('') : '<p class="muted">Not recorded</p>') + '<div class="grid3">' + field('Tariff versions', tariffs.length || 'Not recorded') + field('Packages', packages.length || 'Not recorded') + field('Supplier bookings', bookings.length || 'Not recorded') + '</div><h4>Related files</h4>' + (documents.length ? documents.map((document) => '<div class="event">' + esc(document.file_name || document.document_type || 'Supplier document') + ' · ' + esc(document.document_id) + '</div>').join('') : '<p class="muted">Not recorded</p>') + '<p class="muted">Supplier quotations, confirmations, and operational history are shown when linked records exist.</p></article>';
  }).join('');
  $('suppliers-content').innerHTML = cards || '<div class="empty">No Supplier records are currently available.</div>';
}

function taskAction(task) {
  return ['COMPLETED', 'CANCELLED'].includes(task.state) ? status(readableState(task.state), 'good') : '<button class="secondary" onclick="completeTask(\'' + esc(task.task_id) + '\')">Mark complete</button>';
}

function documentRelated(document, records) {
  if (!records.inquiry) return false;
  const ids = [records.inquiryId, records.booking && records.booking.booking_id, records.client && records.client.client_id, records.supplierBooking && records.supplierBooking.supplier_booking_id, records.tariff && records.tariff.tariff_source_id].filter(Boolean);
  return ids.includes(document.inquiry_id) || ids.includes(document.booking_id) || ids.includes(document.related_entity_id) || ids.includes(document.client_id) || ids.includes(document.supplier_booking_id) || ids.includes(document.tariff_source_id);
}

function taskDueLabel(task) {
  return task.due_date || task.due_at || task.deadline || 'No deadline';
}

function renderGlobalFollowUps() {
  const today = new Date().toISOString().slice(0, 10);
  const tasks = list('Task').filter((task) => !['COMPLETED', 'CANCELLED'].includes(task.state)).sort((a, b) => taskDueLabel(a).localeCompare(taskDueLabel(b)));
  const rows = tasks.map((task) => {
    const due = taskDueLabel(task);
    const kind = due !== 'No deadline' && due.slice(0, 10) < today ? 'bad' : due !== 'No deadline' && due.slice(0, 10) <= today ? 'warn' : 'info';
    return '<tr><td>' + esc(task.priority || 'NORMAL') + '</td><td><strong>' + esc(task.description || task.title || task.task_type || 'Follow-up') + '</strong><br><span class="muted">' + esc(task.task_type || 'FOLLOW_UP') + '</span></td><td>' + status(due, kind) + '</td><td>' + esc(task.inquiry_id || task.booking_id || task.related_id || 'General') + '</td><td><button class="secondary compact" onclick="completeTask(\'' + esc(task.task_id) + '\')">Complete</button></td></tr>';
  }).join('');
  const clientOptions = '<option value="">Select a client after searching</option>';
  const inquiryOptions = list('Inquiry').map((inquiry) => '<option value="' + esc(inquiry.inquiry_id) + '">' + esc(inquiry.inquiry_id + ' · ' + (inquiry.current_requirements && inquiry.current_requirements.destination || 'Inquiry')) + '</option>').join('');
  const form = '<div class="card"><h3>Add follow-up or deadline</h3><div class="grid3"><div class="field"><label>Task</label><input id="global-task-description" placeholder="Call client, request supplier confirmation, collect passport"></div><div class="field"><label>Due date/time</label><input id="global-task-due" type="datetime-local"></div><div class="field"><label>Priority</label><select id="global-task-priority"><option>NORMAL</option><option>HIGH</option><option>URGENT</option></select></div><div class="field"><label>Inquiry (optional)</label><select id="global-task-inquiry"><option value="">General follow-up</option>' + inquiryOptions + '</select></div><div class="field"><label>Client (optional)</label><input id="global-task-client-search" placeholder="Search client"><select id="global-task-client">' + clientOptions + '</select></div></div><button onclick="createGlobalTask()">Save follow-up</button></div>';
  const communication = '<div class="card"><h3>Log client communication</h3><div class="grid3"><div class="field"><label>Client</label><input id="communication-client-search" placeholder="Search client"><select id="communication-client">' + clientOptions + '</select></div><div class="field"><label>Channel</label><select id="communication-channel"><option>Messenger</option><option>WhatsApp</option><option>Viber</option><option>Email</option><option>Phone</option><option>Walk-in</option><option>Other</option></select></div><div class="field"><label>Outcome / next step</label><input id="communication-outcome" placeholder="Client will send passport scans"></div></div><div class="field"><label>Notes</label><textarea id="communication-notes" rows="2"></textarea></div><button class="secondary" onclick="logCommunication()">Save communication</button></div>';
  $('operations-content').innerHTML = form + communication + '<div class="card"><h3>Open follow-ups and deadlines</h3>' + (rows ? '<div class="table-wrap"><table><thead><tr><th>Priority</th><th>Task</th><th>Due</th><th>Linked record</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="empty">No open follow-ups or deadlines.</div>') + '</div>';
  bindClientPicker('global-task-client-search', 'global-task-client');
  bindClientPicker('communication-client-search', 'communication-client');
}

async function createGlobalTask() {
  const description = $('global-task-description').value.trim();
  if (!description) return failLocal('Enter the follow-up or deadline description.');
  await api('createTask', { description, title: description, task_type: 'FOLLOW_UP', priority: $('global-task-priority').value, due_date: $('global-task-due').value || undefined, due_at: $('global-task-due').value ? new Date($('global-task-due').value).toISOString() : undefined, inquiry_id: $('global-task-inquiry').value || undefined, client_id: $('global-task-client').value || undefined }, 'LOCAL_STAFF');
}

async function logCommunication() {
  const clientId = $('communication-client').value;
  const outcome = $('communication-outcome').value.trim();
  if (!clientId) return failLocal('Select the client for this communication.');
  if (!outcome && !$('communication-notes').value.trim()) return failLocal('Enter the outcome or notes.');
  await api('createCommunication', { client_id: clientId, channel: $('communication-channel').value, outcome, notes: $('communication-notes').value.trim() || undefined }, 'LOCAL_STAFF');
}

function renderDocumentsAndTasks() {
  const records = caseRecords();
  if (!records.inquiry) {
    renderGlobalFollowUps();
    return;
  }
  const tasks = list('Task', (item) => item.booking_id === (records.booking && records.booking.booking_id) || item.inquiry_id === records.inquiryId || item.tariff_source_id === (records.tariff && records.tariff.tariff_source_id));
  const documents = list('Document', (item) => documentRelated(item, records));
  const taskRows = tasks.length ? tasks.map((task) => '<details class="card"><summary><strong>' + esc(task.description || task.task_type || 'Operational follow-up') + '</strong> · ' + status(readableState(task.state || 'OPEN'), task.state === 'COMPLETED' ? 'good' : 'warn') + '</summary>' + field('Due date', task.due_date || task.deadline) + field('Related record', task.booking_id || task.inquiry_id) + '<div class="row-actions">' + taskAction(task) + '</div></details>').join('') : '<div class="empty">No tasks for ' + (records.inquiry ? 'the current case' : 'the operation') + '.</div>';
  const documentRows = documents.length ? documents.map((document) => '<details class="card"><summary><strong>' + esc(document.file_name || document.document_name || document.document_type || 'Supporting document') + '</strong> · ' + status(document.status || 'Received', document.review_status === 'ACCEPTED' ? 'good' : 'warn') + '</summary>' + field('Type', document.document_type) + field('Source', (document.source_type || 'Unknown') + (document.source_name ? ' · ' + document.source_name : '')) + field('Review', document.review_status === 'ACCEPTED' ? 'Accepted for use' : 'Needs document review') + field('Related record', document.booking_id || document.inquiry_id || document.related_entity_id) + field('File', document.file_size ? document.file_size + ' bytes retained in local test state' : 'Metadata recorded') + '</details>').join('') : '<div class="empty">No supporting documents for ' + (records.inquiry ? 'the current case' : 'the operation') + '.</div>';
  const taskForm = '<div class="card"><h3>Automatic follow-ups</h3><p class="muted">Follow-ups are created when staff action is needed.</p></div>';
  const serviceOptions = (records.bookingItems || []).map((item) => '<option value="' + esc(item.booking_item_id) + '">' + esc(item.description || item.service_type || item.booking_item_id) + '</option>').join('');
  const upload = '<div class="card"><h3>Upload supporting document</h3><p class="muted">Local storage only. Files remain subject to review.</p><div class="grid3"><div class="field"><label>File</label><input id="supporting-document-file" type="file"></div><div class="field"><label>Service (optional)</label><select id="supporting-document-booking-item"><option value="">Booking-level document</option>' + serviceOptions + '</select></div><div class="field"><label>Type</label><select id="supporting-document-type"><option value="UNKNOWN">Supporting document · not classified</option><option value="SUPPLIER_QUOTATION">Supplier quotation</option><option value="HOTEL_VOUCHER">Hotel voucher</option><option value="TOUR_OPERATOR_MEMO">Tour operator memo</option><option value="AIRLINE_TICKET">Airline ticket</option><option value="WMIT_QUOTATION">WMIT quotation</option></select></div><div class="field"><label>Source</label><input id="supporting-document-source" placeholder="Supplier, client, airline, etc."></div></div><button onclick="uploadSupportingDocument()">Upload supporting document</button></div>';
  $('operations-content').innerHTML = taskForm + upload + '<div class="grid2"><div><h3>Tasks</h3>' + taskRows + '</div><div><h3>Documents</h3>' + documentRows + '</div></div>';
}

async function createTask() {
  const records = caseRecords();
  if (!$('task-description').value.trim()) return failLocal('Enter a task description.');
  await api('createTask', { description: $('task-description').value.trim(), task_type: $('task-type').value.trim() || 'FOLLOW_UP', due_date: $('task-due-date').value || undefined, inquiry_id: records.inquiry && records.inquiry.inquiry_id, booking_id: records.booking && records.booking.booking_id }, 'LOCAL_STAFF');
}

async function completeTask(taskId) {
  await api('updateTask', { task_id: taskId, state: 'COMPLETED', completion_note: 'Completed in local Operations Workspace' }, 'LOCAL_STAFF');
}

async function uploadSupportingDocument() {
  const input = $('supporting-document-file');
  const file = input && input.files && input.files[0];
  if (!file) return failLocal('Choose a supporting document first.');
  if (file.size > 500 * 1024) return failLocal('The local supporting-document limit is 500 KB.');
  const content = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '').split(',')[1] || ''); reader.onerror = () => reject(new Error('The selected document could not be read.')); reader.readAsDataURL(file); });
  const records = caseRecords();
  if (!records.inquiry) return failLocal('Select an Inquiry before uploading a case document.');
  await api('createDocument', { external_file_id: 'LOCAL-FILE-' + Date.now(), file_name: file.name, file_url: 'LOCAL-SYNTHETIC-FILE://' + encodeURIComponent(file.name), file_ref: 'LOCAL-SYNTHETIC-FILE://' + encodeURIComponent(file.name), mime_type: file.type || 'application/octet-stream', file_size: file.size, content_base64: content, source_type: 'UNKNOWN', source_name: $('supporting-document-source').value.trim() || undefined, document_type: $('supporting-document-type').value, extraction_status: 'NOT_PROCESSED', status: 'Received', received_at: new Date().toISOString(), inquiry_id: records.inquiry && records.inquiry.inquiry_id, booking_id: records.booking && records.booking.booking_id, booking_item_id: $('supporting-document-booking-item').value || undefined, supplier_id: records.supplierBooking && records.supplierBooking.supplier_id, notes: 'Uploaded from the local Operations Workspace; requires normal document review.' }, 'LOCAL_STAFF');
}

function departurePhase(departure) {
  const today = new Date().toISOString().slice(0, 10);
  const start = departure.start_date || departure.travel_start || '';
  const end = departure.end_date || departure.travel_end || start;
  if (!start) return 'Date not recorded';
  if (end < today) return 'Past';
  if (start > today) return 'Upcoming';
  return 'Present';
}

function departureEntries() {
  const bookings = Object.fromEntries(list('Booking').map((booking) => [booking.booking_id, booking]));
  const inquiries = Object.fromEntries(list('Inquiry').map((inquiry) => [inquiry.inquiry_id, inquiry]));
  const memberships = list('DepartureMembership');
  const linkedItems = new Set(memberships.map((membership) => membership.booking_item_id));
  const shared = list('Departure').map((departure) => {
    const bookingItemIds = memberships.filter((membership) => membership.departure_id === departure.departure_id).map((membership) => membership.booking_item_id);
    const firstItem = latest('BookingItem', (item) => item.booking_item_id === bookingItemIds[0]);
    const booking = firstItem && bookings[firstItem.booking_id] || {};
    const inquiry = inquiries[inquiryIdForBooking(booking)] || {};
    const requirements = inquiry.current_requirements || {};
    const enriched = Object.assign({}, departure);
    if (!enriched.destination) enriched.destination = firstItem && firstItem.destination || booking.destination || requirements.destination;
    if (!enriched.start_date) enriched.start_date = firstItem && firstItem.travel_start || booking.travel_start || requirements.travel_start || requirements.travel_month || requirements.travel_year;
    if (!enriched.end_date) enriched.end_date = firstItem && firstItem.travel_end || booking.travel_end || requirements.travel_end;
    return { kind: 'SHARED_GROUP', departure: enriched, bookingItemIds, leadPaxName: leadPaxNamesForBookingItems(bookingItemIds, bookings) };
  });
  const individual = list('BookingItem', (item) => !linkedItems.has(item.booking_item_id)).map((item) => {
    const booking = bookings[item.booking_id] || {};
    const inquiry = inquiries[inquiryIdForBooking(booking)] || {};
    const requirements = inquiry.current_requirements || {};
    return { kind: 'INDIVIDUAL', bookingItemIds: [item.booking_item_id], leadPaxName: bookingLeadPaxName(booking), departure: { departure_id: 'INDIVIDUAL-' + item.booking_item_id, name: booking.booking_id ? 'Booking ' + booking.booking_id : 'Individual Booking Item', destination: item.destination || booking.destination || requirements.destination || 'Not recorded', start_date: item.travel_start || booking.travel_start || requirements.travel_start || requirements.travel_month || requirements.travel_year, end_date: item.travel_end || booking.travel_end || requirements.travel_end, status: booking.commitment_state || booking.record_state || 'PENDING', readiness_percent: item.readiness_percent } };
  });
  return shared.concat(individual).sort((left, right) => String(left.departure.start_date || '9999-12-31').localeCompare(String(right.departure.start_date || '9999-12-31')));
}

function leadPaxNamesForBookingItems(bookingItemIds, bookings) {
  const names = bookingItemIds.map((itemId) => {
    const item = latest('BookingItem', (candidate) => candidate.booking_item_id === itemId);
    return item && bookingLeadPaxName(bookings[item.booking_id]);
  }).filter((name) => name && name !== 'Not selected');
  return Array.from(new Set(names)).join(', ') || 'Not selected';
}

function openBookingFromDeparture(bookingId) {
  const booking = latest('Booking', (item) => item.booking_id === bookingId);
  const inquiryId = inquiryIdForBooking(booking);
  if (booking && inquiryId) {
    setWorkspaceId('booking', bookingId);
    sessionStorage.setItem('wmit.operations.selectedInquiryId', inquiryId);
    if (currentTab() === 'booking') render();
    else window.location.hash = 'booking';
  } else failLocal('This Booking cannot be opened because its Inquiry lineage is missing.');
}

function openDepartureRecord(departureId) {
  setWorkspaceId('departure', departureId);
  if (currentTab() === 'departures') render();
  else window.location.hash = 'departures';
}

function clearDepartureRecord() {
  clearWorkspaceId('departure');
  render();
}

function departureReadinessControls(entry) {
  const issues = list('DepartureReadinessIssue', (issue) => issue.departure_id === entry.departure.departure_id || entry.bookingItemIds.includes(issue.booking_item_id));
  const rows = issues.length ? issues.map((issue) => '<div class="event"><strong>' + esc(readableState(issue.severity)) + '</strong> · ' + esc(issue.description) + ' · ' + status(readableState(issue.state), issue.state === 'RESOLVED' || issue.state === 'WAIVED' ? 'good' : 'warn') + (issue.state === 'OPEN' ? ' <button class="secondary compact" onclick="resolveDepartureIssue(\'' + esc(issue.departure_readiness_issue_id) + '\')">Resolve</button>' : '') + '</div>').join('') : '<p class="muted">No readiness issues recorded.</p>';
  const scope = entry.kind === 'SHARED_GROUP' ? { departure_id: entry.departure.departure_id } : { booking_item_id: entry.bookingItemIds[0] };
  return '<div class="card"><h3>Departure readiness</h3>' + rows + '<div class="grid3"><div class="field"><label>Severity</label><select id="departure-issue-severity"><option value="LOW">Low</option><option value="MEDIUM" selected>Medium</option><option value="HIGH">High</option><option value="BLOCKER">Blocker</option></select></div><div class="field"><label>Issue</label><input id="departure-issue-description" placeholder="Missing confirmation, document, rooming, deadline..."></div><div class="field"><label>Owner / due note</label><input id="departure-issue-note" placeholder="Optional operational note"></div></div><button class="secondary" onclick="createDepartureIssue(' + esc(JSON.stringify(scope)) + ')">Add readiness issue</button></div>';
}

async function createDepartureIssue(scope) {
  const description = $('departure-issue-description').value.trim();
  if (!description) return failLocal('Enter the departure readiness issue.');
  await api('createDepartureReadinessIssue', Object.assign({}, scope || {}, { severity: $('departure-issue-severity').value, description, owner_note: $('departure-issue-note').value.trim() || undefined }), 'LOCAL_STAFF');
}

async function resolveDepartureIssue(issueId) {
  if (!issueId) return failLocal('The readiness issue could not be identified.');
  await api('updateDepartureReadinessIssue', { departure_readiness_issue_id: issueId, state: 'RESOLVED', resolution: 'Resolved by local operations staff.' }, 'LOCAL_STAFF');
}

function renderMonitoring() {
  const today = new Date().toISOString().slice(0, 10);
  const rows = list('Booking').map((booking) => {
    const inquiryId = inquiryIdForBooking(booking);
    const inquiry = latest('Inquiry', (item) => item.inquiry_id === inquiryId);
    const records = inquiry ? recordsForInquiry(inquiry) : null;
    const projection = inquiry ? projectionForInquiry(inquiryId) : null;
    const finance = projection && projection.finance;
    if (!records || !projection || !finance || finance.state !== 'FULLY_FUNDED' || Number(finance.outstanding || 0) > 0) return null;
    if (booking.travel_start && booking.travel_start < today) return null;
    const client = latest('Client', (item) => item.client_id === booking.client_id);
    const supplierState = projection.supplierFulfillment && projection.supplierFulfillment.state || 'NOT_REQUESTED';
    const docs = projection.documents && projection.documents.state || 'NOT_CONFIGURED';
    const tasks = projection.tasks && projection.tasks.state || 'NOT_CONFIGURED';
    return { booking, client, projection, supplierState, docs, tasks };
  }).filter(Boolean).sort((a, b) => String(a.booking.travel_start || '').localeCompare(String(b.booking.travel_start || '')));
  if (!rows.length) {
    $('monitoring-content').innerHTML = '<div class="empty">No fully funded trips are currently waiting for departure.</div>';
    return;
  }
  const markup = rows.map((item) => '<tr><td><button class="secondary" onclick="openBookingRecord(\'' + esc(item.booking.booking_id) + '\')">Open</button></td><td>' + esc(item.client && item.client.display_name || item.booking.client_id) + '</td><td>' + esc(bookingDestination(item.booking)) + '</td><td>' + esc(bookingTravelLabel(item.booking)) + '</td><td>' + status(readableState(item.supplierState), item.supplierState === 'CONFIRMED' ? 'good' : 'warn') + '</td><td>' + esc(readableState(item.docs)) + '</td><td>' + esc(readableState(item.tasks)) + '</td></tr>').join('');
  $('monitoring-content').innerHTML = '<div class="card"><p class="muted">Finance keeps the payment history. Monitoring is the daily work queue after payment is complete.</p><div class="table-wrap"><table><thead><tr><th></th><th>Client</th><th>Destination</th><th>Travel</th><th>Supplier</th><th>Documents</th><th>Follow-ups</th></tr></thead><tbody>' + markup + '</tbody></table></div></div>';
}

function renderDepartures() {
  const entries = departureEntries();
  const selectedId = selectedWorkspaceId('departure');
  const selectedEntry = selectedId && entries.find((entry) => entry.departure.departure_id === selectedId);
  if (selectedId && selectedEntry) {
    const bookingIds = selectedEntry.bookingItemIds.map((itemId) => { const item = latest('BookingItem', (candidate) => candidate.booking_item_id === itemId); return item && item.booking_id; }).filter(Boolean).filter((id, index, all) => all.indexOf(id) === index);
    $('departures-content').innerHTML = '<div class="selection-bar"><button class="secondary" onclick="clearDepartureRecord()">Back to Departures</button><strong>' + esc(selectedEntry.departure.name || 'Departure') + '</strong><span>' + esc(selectedEntry.departure.start_date || 'Date not recorded') + '</span></div><article class="card"><h3>' + esc(selectedEntry.departure.name || 'Departure') + '</h3>' + field('Lead pax', selectedEntry.leadPaxName) + field('Type', selectedEntry.kind === 'SHARED_GROUP' ? 'Shared operational group' : 'Individual Booking entry') + field('Date', (selectedEntry.departure.start_date || 'Not recorded') + (selectedEntry.departure.end_date ? ' to ' + selectedEntry.departure.end_date : '')) + field('Destination', selectedEntry.departure.destination) + field('Status', readableState(selectedEntry.departure.status || 'PENDING')) + field('Readiness', selectedEntry.departure.readiness_percent === undefined ? 'Not recorded' : selectedEntry.departure.readiness_percent + '%') + '<h4>Linked Bookings</h4>' + (bookingIds.length ? bookingIds.map((id) => '<div class="event"><button class="secondary compact" onclick="openBookingFromDeparture(\'' + esc(id) + '\')">Open Booking</button> ' + esc(id) + '</div>').join('') : '<p class="muted">No linked Booking.</p>') + '<details class="secondary-details"><summary>Technical details</summary><p class="muted">Departure records are operational projections linked through Booking Items. Financial records remain independent.</p></details></article>';
    $('departures-content').insertAdjacentHTML('beforeend', departureReadinessControls(selectedEntry));
    return;
  }
  if (selectedId && !selectedEntry) clearWorkspaceId('departure');
  if (!entries.length) {
    $('departures-content').innerHTML = '<div class="empty"><strong>No departures yet for the current operation.</strong><p>Individual departure entries appear automatically from Booking Items. Shared groups appear when existing Departure records are linked to Booking Items.</p></div>';
    return;
  }
  const rows = entries.map((entry) => {
    const bookingIds = entry.bookingItemIds.map((itemId) => { const item = latest('BookingItem', (candidate) => candidate.booking_item_id === itemId); return item && item.booking_id; }).filter(Boolean).filter((id, index, all) => all.indexOf(id) === index);
    const links = bookingIds.length ? bookingIds.map((id) => '<button class="secondary compact" onclick="openBookingFromDeparture(\'' + esc(id) + '\')">' + esc(id) + '</button>').join(' ') : '<span class="muted">No linked Booking</span>';
    const phase = departurePhase(entry.departure);
    return '<tr><td>' + esc(entry.departure.start_date || 'Not recorded') + (entry.departure.end_date ? '<br><span class="muted">to ' + esc(entry.departure.end_date) + '</span>' : '') + '</td><td>' + esc(phase) + '</td><td>' + esc(entry.leadPaxName || 'Not selected') + '</td><td>' + esc(entry.kind === 'SHARED_GROUP' ? 'Shared operational group' : 'Individual Booking entry') + '</td><td>' + esc(entry.departure.destination || 'Not recorded') + '</td><td>' + links + '</td><td>' + status(readableState(entry.departure.status || 'PENDING'), phase === 'Present' ? 'good' : 'info') + '</td><td>' + esc(entry.departure.readiness_percent === undefined ? 'Not recorded' : entry.departure.readiness_percent + '%') + '</td></tr>';
  }).join('');
  $('departures-content').innerHTML = '<p class="muted">Sorted by travel date. Lead pax is taken from the selected Booking participant. Financial records remain independent.</p><div class="table-wrap"><table><thead><tr><th>Date</th><th>Period</th><th>Lead pax</th><th>Type</th><th>Destination</th><th>Booking(s)</th><th>Status</th><th>Readiness</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
}

function renderCasePlaceholder() {
  const text = '<div class="card warn"><h3>No case selected</h3><p>Choose an Inquiry from Dashboard or Inquiries before working in this case-specific workspace.</p><button onclick="openInquiries()">Select an Inquiry</button></div>';
  ['options-content', 'quotation-content', 'booking-content', 'payment-content'].forEach((id) => { if ($(id)) $(id).innerHTML = text; });
}

const workspaceRenderers = {
  dashboard: renderDashboard,
  case: renderCaseWorkspace,
  inquiry: renderInquiry,
  quotation: renderQuotation,
  booking: renderBooking,
  finance: renderPayment,
  monitoring: renderMonitoring,
  departures: renderDepartures,
  clients: renderClients,
  suppliers: renderSuppliers,
  subagents: renderSubAgents,
  tariffs: renderTariffLibrary,
  operations: renderDocumentsAndTasks,
  settings: renderSettings
};

function render() {
  if (!state) return;
  ensureClientsNavigation();
  renderHeader();
  const commandRecords = caseRecords();
  const commandProjection = projectionForCase(commandRecords);
  const commandTarget = $('case-header');
  if (commandTarget && commandProjection && commandRecords.inquiry) commandTarget.insertAdjacentHTML('beforeend', caseCommandMarkup(commandRecords, commandProjection));
  const renderer = workspaceRenderers[currentTab()] || renderDashboard;
  renderer();
  if (currentTab() === 'inquiry' && typeof renderOptions === 'function') renderOptions();
  if (currentTab() === 'clients') {
    const activeClient = selectedWorkspaceId('client') && latest('Client', (client) => client.client_id === selectedWorkspaceId('client'));
    if (activeClient) $('clients-content').insertAdjacentHTML('afterbegin', clientHistoryMarkup(activeClient));
  }
  activateWorkspaceTab();
  ensureAccessibleLabels();
}



async function resetSynthetic() {
  if (!window.confirm('Reset only local synthetic Phase 1 state?')) return;
  const result = await api('resetSyntheticTestCase', {}, 'LOCAL_STAFF');
  if (result) {
    sessionStorage.removeItem('wmit.operations.selectedInquiryId');
    ['tariff', 'quotation', 'booking', 'booking-item', 'supplier', 'departure'].forEach(clearWorkspaceId);
    window.location.hash = 'dashboard';
  }
}

function fillSyntheticFormFields() {
  const activeWorkspace = document.querySelector('.workspace-view.active') || document.getElementById(currentTab()) || document.body;
  const requiredIds = new Set([
    'client-name', 'client-edit-name', 'subagent-name',
    'inq-client', 'inq-destination', 'inq-start', 'inq-end',
    'quote-destination', 'quote-travel-start', 'quote-travel-end', 'quote-pax', 'quote-date', 'quote-valid-until',
    'new-qitem-description', 'new-qitem-quantity', 'new-qitem-cost', 'new-qitem-price',
    'booking-lead-pax', 'participant-name', 'hold-expires', 'ticketing-pnr', 'ticketing-number', 'voucher-number',
    'amend-reason', 'amend-accepted-by', 'refund-amount', 'refund-reason',
    'new-obligation-amount', 'new-obligation-due', 'allocation-amount',
    'payment-amount', 'payment-sent-at', 'payment-proof', 'payable-amount',
    'global-task-description', 'communication-client', 'communication-outcome', 'task-description', 'departure-issue-description'
  ]);
  const isRequiredByWorkflow = (id) => requiredIds.has(id)
    || /^qitem-(description|quantity|cost|price)-/.test(id)
    || /^qitem-(description|quantity|cost|price)$/.test(id);
  const labelText = (control) => {
    const wrapper = control.closest('.field');
    const label = (wrapper && wrapper.querySelector('label')) || control.closest('label');
    return label ? String(label.textContent || '').trim().toLowerCase() : '';
  };
  const isVisible = (control) => !control.closest('[hidden]') && !control.closest('details:not([open])');
  const dateValue = (id) => {
    if (id.includes('start')) return '2026-11-14';
    if (id.includes('end')) return '2026-11-19';
    if (id.includes('valid')) return '2026-08-22';
    if (id.includes('due')) return '2026-08-18';
    return '2026-08-15';
  };
  let filled = 0;
  const controls = Array.from(activeWorkspace.querySelectorAll('input, textarea, select')).filter((control) => {
    if (control.disabled || control.readOnly || control.type === 'file' || control.type === 'checkbox' || control.type === 'radio' || !isVisible(control)) return false;
    return control.required || control.getAttribute('aria-required') === 'true' || labelText(control).includes('*') || labelText(control).includes('required') || isRequiredByWorkflow(String(control.id || '').toLowerCase());
  });
  controls.forEach((control) => {
    const id = String(control.id || '').toLowerCase();
    if (control.tagName === 'SELECT') {
      if (!control.value) {
        const option = Array.from(control.options).find((item) => item.value !== '');
        if (option) { control.value = option.value; control.dispatchEvent(new Event('change', { bubbles: true })); filled += 1; }
      }
      return;
    }
    if (control.value) return;
    if (control.type === 'date') control.value = dateValue(id);
    else if (control.type === 'time') control.value = id.includes('arrival') ? '13:00' : '08:00';
    else if (control.type === 'email') control.value = 'synthetic@example.test';
    else if (control.type === 'number') {
      if (id.includes('pax') || id.includes('adult')) control.value = '2';
      else if (id.includes('kg')) control.value = '20';
      else if (id.includes('amount') || id.includes('price') || id.includes('cost') || id.includes('fee')) control.value = '1000';
      else control.value = '1';
    } else if (id.includes('currency')) control.value = 'PHP';
    else if (id.includes('destination') || id.includes('city')) control.value = 'Tokyo';
    else if (id.includes('airline')) control.value = 'Example Air';
    else if (id.includes('flight-number')) control.value = 'EA 123';
    else if (id.includes('airport')) control.value = id.includes('departure') ? 'MNL' : 'NRT';
    else if (id.includes('email')) control.value = 'synthetic@example.test';
    else if (id.includes('name') || id.includes('client') || id.includes('contact') || id.includes('person')) control.value = 'Synthetic Test Client';
    else if (id.includes('reference') || id.includes('proof')) control.value = 'SYNTHETIC-TEST-REF';
    else if (id.includes('description')) {
      const serviceTypeControl = id.includes('new-qitem-') ? $('new-qitem-service') : id.startsWith('qitem-description-') ? $('qitem-service-' + id.slice('qitem-description-'.length)) : null;
      const serviceType = serviceTypeControl && serviceTypeControl.value || 'service';
      control.value = 'Synthetic ' + serviceType.toLowerCase();
    } else if (id.includes('notes') || id.includes('reason') || id.includes('terms')) control.value = 'Synthetic test value';
    else control.value = 'Synthetic test value';
    control.dispatchEvent(new Event('input', { bubbles: true }));
    filled += 1;
  });
  showMessage('Test fields filled', filled ? filled + ' empty required field' + (filled === 1 ? '' : 's') + ' filled locally. No record was saved or workflow action executed.' : 'No empty required fields on this screen.', 'warn');
}

window.addEventListener('hashchange', () => {
  if (!state) return;
  render();
  // Navigation switches the workspace view; it should not retain an anchor scroll offset.
  window.scrollTo(0, 0);
});

// Sign-in state indicator: in development the workspace is reachable
// anonymously, so it must be visible WHO is signed in — authority-gated
// actions (e.g. tariff deletion) depend on it.
async function updateAuthIndicator() {
  const target = $('auth-state');
  if (!target) return;
  try {
    const token = sessionStorage.getItem('wmit_session');
    const response = await fetch('/api/auth/me', { headers: token ? { Authorization: 'Bearer ' + token } : {} });
    const body = await response.json();
    if (body.ok && body.data && body.data.username) {
      window.wmitCurrentUser = body.data;
      target.innerHTML = '<span class="status">' + esc(body.data.username) + ' · ' + esc(body.data.role) + '</span><button class="secondary" onclick="wmitOpenChangePassword()">Change password</button><button class="secondary" onclick="signOut()">Sign out</button>';
      renderAccountsPanel();
      if (currentTab() === 'settings') renderSettings();
    } else {
      window.wmitCurrentUser = null;
      target.innerHTML = '<span class="status">Not signed in</span><button class="secondary" onclick="window.location.href=\'login.html\'">Sign in</button>';
    }
  } catch (_) {
    target.innerHTML = '<span class="status">Sign-in state unknown</span>';
  }
}

async function signOut() {
  const token = sessionStorage.getItem('wmit_session');
  try { if (token) await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token } }); } catch (_) { /* best effort */ }
  sessionStorage.removeItem('wmit_session');
  sessionStorage.removeItem('wmit_user');
  showMessage('Signed out', 'Manager-gated actions (like tariff deletion) are unavailable until you sign in again.', 'warn');
  await updateAuthIndicator();
}

function isLocalWorkspace() {
  return typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
}

refreshState().catch((error) => showMessage('✕ Workspace unavailable', error.message, 'error'));
updateAuthIndicator();
if (!isLocalWorkspace()) ['btn-fill-test', 'btn-reset-synthetic'].forEach((id) => { const el = $(id); if (el) el.hidden = true; });
