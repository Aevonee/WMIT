'use strict';

let state = null;
let selectedLeadId = '';
let selectedQuotationId = '';
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
const money = (value, currency) => value === undefined || value === null ? '—' : esc((currency || 'PHP') + ' ' + Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

function formData(form) {
  const result = {};
  new FormData(form).forEach((value, key) => { result[key] = value === '' ? undefined : value; });
  ['pax_count','quantity','line_order','unit_cost','unit_selling_price','supplier_cost','fees_total','tax_total','discount_total','amount','exchange_rate'].forEach((key) => { if (result[key] !== undefined) result[key] = Number(result[key]); });
  return result;
}

function readItineraryDays(value) {
  if (!value) return [];
  try {
    const days = JSON.parse(String(value));
    return Array.isArray(days) ? days : [];
  } catch (error) { return []; }
}

function itineraryField(card, field) {
  const control = card.querySelector(`[data-itinerary-field="${field}"]`);
  return control ? control.value.trim() : '';
}

function currentItineraryDays() {
  return Array.from(document.querySelectorAll('[data-day-card]')).map((card, index) => ({
    day: Number(itineraryField(card, 'day')) || index + 1,
    date: itineraryField(card, 'date'),
    title: itineraryField(card, 'title'),
    city: itineraryField(card, 'city'),
    activities: itineraryField(card, 'activities'),
    meals: itineraryField(card, 'meals'),
    overnight: itineraryField(card, 'overnight'),
    notes: itineraryField(card, 'notes')
  }));
}

function syncItineraryInput() {
  const input = $('editor-itinerary');
  if (input) input.value = JSON.stringify(currentItineraryDays());
}

function itineraryDayCard(day, index) {
  const value = day || {};
  return `<article class="itinerary-day" data-day-card><div class="itinerary-day-heading"><h4>Day ${index + 1}</h4><button type="button" class="link itinerary-day-remove">Remove</button></div><div class="form-row"><label>Day number<input type="number" min="1" data-itinerary-field="day" value="${esc(value.day || index + 1)}"></label><label>Date<input type="date" data-itinerary-field="date" value="${esc(value.date || '')}"></label><label>City / area<input data-itinerary-field="city" value="${esc(value.city || '')}" placeholder="e.g. Seoul"></label></div><label>Day title<input data-itinerary-field="title" value="${esc(value.title || '')}" placeholder="e.g. Arrival and city tour"></label><label>Activities / services<textarea data-itinerary-field="activities" placeholder="Describe the day's activities, transfers, and services.">${esc(value.activities || '')}</textarea></label><div class="form-row"><label>Meals<input data-itinerary-field="meals" value="${esc(value.meals || '')}" placeholder="e.g. Breakfast, lunch"></label><label>Overnight<input data-itinerary-field="overnight" value="${esc(value.overnight || '')}" placeholder="e.g. Hotel name / city"></label><label>Notes<input data-itinerary-field="notes" value="${esc(value.notes || '')}" placeholder="Optional travel notes"></label></div></article>`;
}

function renderItineraryEditor(rawValue) {
  const container = $('itinerary-days');
  if (!container) return;
  let days = readItineraryDays(rawValue);
  if (!days.length && rawValue && String(rawValue).trim()) days = [{ day:1, activities:String(rawValue) }];
  container.innerHTML = days.map((day, index) => itineraryDayCard(day, index)).join('');
  const input = $('editor-itinerary');
  if (input) input.value = JSON.stringify(days);
}

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

async function api(path, body) {
  const response = await wmitGuard401(await fetch(path, body ? { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, wmitAuthHeaders()), body: JSON.stringify(body) } : { headers: wmitAuthHeaders() }));
  const result = await response.json();
  if (!result.ok) { const error = new Error((result.error && result.error.message) || 'The operation failed.'); error.result = result; throw error; }
  return result;
}

function notify(message, success) { const box = $('message'); box.textContent = message; box.className = 'message' + (success ? ' success' : ''); clearTimeout(window.wmitMessage); window.wmitMessage = setTimeout(() => { box.className = 'message hidden'; }, 5000); }
function clearFormErrors(form) { form.querySelectorAll('.invalid').forEach((control) => { control.classList.remove('invalid'); control.removeAttribute('aria-invalid'); }); form.querySelectorAll('.field-error').forEach((note) => note.remove()); }
function showFormError(form, error) {
  clearFormErrors(form);
  const details = error && error.result && error.result.error && error.result.error.details;
  const fieldErrors = details && Array.isArray(details.errors) ? details.errors.slice() : [];
  if (!fieldErrors.length && error && error.result && error.result.error) {
    const fallbackFields = { DUPLICATE_RECORD: 'invoice_number', OVERPAYMENT: 'amount', CURRENCY_MISMATCH: 'amount', INVALID_MONEY: 'amount', PAYMENT_CONVERSION_ERROR: 'exchange_rate' };
    const formFallbacks = { 'quotation-item-form': 'quotation_id', 'quotation-editor-item-form': 'description', 'quotation-details-form': 'destination', 'booking-form': 'quotation_id', 'supplier-booking-form': 'booking_item_id', 'invoice-form': 'booking_id', 'payment-form': 'invoice_id', 'supplier-payment-form': 'supplier_booking_id' };
    const fallbackField = fallbackFields[error.result.error.code] || formFallbacks[form.id];
    if (fallbackField && Array.from(form.elements).some((element) => element.name === fallbackField)) fieldErrors.push({ field: fallbackField, message: error.result.error.message });
  }
  let firstControl = null;
  fieldErrors.forEach((item) => { const control = Array.from(form.elements).find((element) => element.name === item.field); if (!control) return; if (!firstControl) firstControl = control; control.classList.add('invalid'); control.setAttribute('aria-invalid', 'true'); const note = document.createElement('div'); note.className = 'field-error'; note.textContent = item.message || 'Please correct this field.'; control.parentElement.appendChild(note); });
  notify(fieldErrors.length ? 'Please correct the highlighted field(s).' : (error.message || 'The operation could not be completed.'), false);
  const focusTarget = firstControl || form.querySelector('input, select, textarea, button');
  if (focusTarget) { focusTarget.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => focusTarget.focus(), 150); }
}
function options(id, rows, valueField, label, emptyLabel) { const control = $(id); const values = rows || []; control.innerHTML = values.length ? values.map((row) => `<option value="${esc(row[valueField])}">${esc(label(row))}</option>`).join('') : `<option value="">${esc(emptyLabel || 'No records available')}</option>`; control.disabled = !values.length; }

function renderDashboard() { const c = state.dashboard.counts; $('dashboard').innerHTML = [['open_leads','Open leads'],['quotations_requiring_action','Quotations needing action'],['active_bookings','Active bookings'],['client_invoice_balances','Invoices with balances']].map(([key,label]) => `<div class="metric"><span class="eyebrow">${label}</span><strong>${c[key]}</strong><small>Local synthetic runtime</small></div>`).join(''); renderAttendanceDashboard(state.attendance); }

function attendanceValue(value) { return value === null || value === undefined ? '—' : esc(value); }
function attendanceDateTime(value) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? esc(value) : esc(date.toLocaleString('en-PH', { dateStyle:'medium', timeStyle:'short' })); }
function renderAttendanceDashboard(data) {
  const disabled = $('attendance-disabled');
  const content = $('attendance-content');
  if (!data || !data.enabled) { disabled.classList.remove('hidden'); disabled.textContent = data && data.message ? data.message : 'Attendance monitoring is not enabled.'; content.classList.add('hidden'); return; }
  disabled.classList.add('hidden'); content.classList.remove('hidden');
  const c = data.counts || {};
  const metrics = [['present','Present'],['currently_working','Currently working'],['timed_out','Timed out'],['absent','Absent'],['late','Late'],['exceptions','Exceptions']];
  $('attendance-metrics').innerHTML = metrics.map(([key,label]) => `<div class="metric"><span class="eyebrow">${label}</span><strong>${attendanceValue(c[key])}</strong><small>${key === 'absent' && !data.absence_determinable ? 'Policy not configured' : key === 'late' && !data.late_determinable ? 'Policy not configured' : 'Read-only projection'}</small></div>`).join('');
  const sourceLabel = (data.source && data.source.source_label) || ((data.source && data.source.source_type === 'MOCK') ? 'Demo Data' : (data.source && data.source.source_name) || 'Attendance source');
  const sourceWarning = data.source_status === 'UNAVAILABLE' || data.source_status === 'FALLBACK' ? ` · WARNING: ${data.warning || (data.source && data.source.warning) || 'source unavailable'}` : '';
  $('attendance-source-note').textContent = `Date: ${data.date || '—'} · Source: ${sourceLabel} · Read-only${sourceWarning}`;
  const breakdown = data.breakdown || {};
  $('attendance-people-breakdown').innerHTML = `<h3>Staff / intern breakdown</h3><table class="attendance-table"><thead><tr><th>Group</th><th>Present</th><th>Working</th><th>Timed out</th><th>Absent</th></tr></thead><tbody>${['STAFF','INTERN','UNKNOWN'].map((type) => { const row = breakdown[type] || {}; return `<tr><td>${type}</td><td>${attendanceValue(row.present)}</td><td>${attendanceValue(row.currently_working)}</td><td>${attendanceValue(row.timed_out)}</td><td>${attendanceValue(row.absent)}</td></tr>`; }).join('')}</tbody></table>`;
  const branches = data.branches || {};
  $('attendance-branch-breakdown').innerHTML = `<h3>Branch breakdown</h3><table class="attendance-table"><thead><tr><th>Branch</th><th>Present</th><th>Working</th><th>Timed out</th><th>Hours</th></tr></thead><tbody>${Object.keys(branches).length ? Object.entries(branches).map(([branch,row]) => `<tr><td>${esc(branch)}</td><td>${attendanceValue(row.present)}</td><td>${attendanceValue(row.currently_working)}</td><td>${attendanceValue(row.timed_out)}</td><td>${attendanceValue(row.hours_worked)}</td></tr>`).join('') : '<tr><td colspan="5" class="attendance-empty">No branch observations.</td></tr>'}</tbody></table>`;
}
function setAttendanceOptions(id, values, emptyLabel, current) { const control = $(id); const unique = Array.from(new Set((values || []).filter(Boolean))).sort(); control.innerHTML = `<option value="">${emptyLabel}</option>` + unique.map((value) => `<option value="${esc(value)}">${esc(value)}</option>`).join(''); if (current && unique.includes(current)) control.value = current; }
function renderAttendanceTables(history, exceptions) {
  if ((history && history.source_status === 'UNAVAILABLE') || (exceptions && exceptions.source_status === 'UNAVAILABLE')) {
    setAttendanceOptions('attendance-employee', [], 'Unavailable', '');
    setAttendanceOptions('attendance-role', [], 'Unavailable', '');
    setAttendanceOptions('attendance-branch', [], 'Unavailable', '');
    const warning = (history && history.warning) || (exceptions && exceptions.warning) || 'Attendance source unavailable.';
    $('attendance-history-table').innerHTML = `<h3>Daily attendance history</h3><div class="attendance-empty">${esc(warning)} No attendance rows are being shown.</div>`;
    $('attendance-event-table').innerHTML = '<h3>Observed source events</h3><div class="attendance-empty">Source unavailable. No event data is being shown.</div>';
    $('attendance-exceptions-table').innerHTML = '<h3>Exceptions requiring attention</h3><div class="attendance-empty">Source unavailable. Exceptions cannot be assessed until the source is available.</div>';
    return;
  }
  const rows = history.rows || [];
  setAttendanceOptions('attendance-employee', rows.map((row) => row.employee_name), 'All employees', $('attendance-employee').value);
  setAttendanceOptions('attendance-role', rows.map((row) => row.role), 'All roles', $('attendance-role').value);
  setAttendanceOptions('attendance-branch', rows.map((row) => row.branch), 'All branches', $('attendance-branch').value);
  $('attendance-history-table').innerHTML = `<h3>Daily attendance history</h3>${rows.length ? `<table class="attendance-table"><thead><tr><th>Date</th><th>Employee</th><th>Type</th><th>Role</th><th>Branch</th><th>First in</th><th>Last out</th><th>Hours</th><th>Status</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${esc(row.attendance_date)}</td><td>${esc(row.employee_name)}</td><td>${esc(row.person_type)}</td><td>${esc(row.role || '—')}</td><td>${esc(row.branch || 'Unknown')}</td><td>${attendanceDateTime(row.first_time_in)}</td><td>${attendanceDateTime(row.last_time_out)}</td><td>${attendanceValue(row.hours_reliable ? row.total_hours : 'Review')}</td><td><span class="status">${esc(row.attendance_state)}</span></td></tr>`).join('')}</tbody></table>` : '<div class="attendance-empty">No daily attendance records match these filters.</div>'}`;
  const events = history.events || [];
  $('attendance-event-table').innerHTML = `<h3>Observed source events</h3>${events.length ? `<table class="attendance-table"><thead><tr><th>Timestamp</th><th>Employee</th><th>Role</th><th>Branch</th><th>Action</th><th>Identity</th></tr></thead><tbody>${events.map((event) => `<tr><td>${attendanceDateTime(event.timestamp_iso || event.timestamp_raw)}</td><td>${esc(event.employee_name_raw)}</td><td>${esc(event.role_raw || '—')}</td><td>${esc(event.branch || 'Unknown')}</td><td>${esc(event.action)}</td><td><span class="status">${esc(event.identity_status)}</span></td></tr>`).join('')}</tbody></table>` : '<div class="attendance-empty">No source events match these filters.</div>'}`;
  const exceptionRows = exceptions.rows || [];
  $('attendance-exceptions-table').innerHTML = `<h3>Exceptions requiring attention</h3>${exceptionRows.length ? `<table class="attendance-table"><thead><tr><th>Date</th><th>Type</th><th>Severity</th><th>Person</th><th>Description</th><th>Status</th></tr></thead><tbody>${exceptionRows.map((row) => `<tr class="attendance-exception"><td>${esc(row.attendance_date || 'Unknown')}</td><td>${esc(row.exception_type)}</td><td>${esc(row.severity)}</td><td>${esc(row.person_id || 'Unresolved')}</td><td>${esc(row.description)}</td><td><span class="status">${esc(row.status)}</span></td></tr>`).join('')}</tbody></table>` : '<div class="attendance-empty">No exceptions match these filters.</div>'}`;
}
async function loadAttendance(filters) {
  if (!state || !state.attendance || !state.attendance.enabled) return;
  const value = Object.assign({}, filters || {});
  const query = new URLSearchParams(Object.entries(value).filter(([,entry]) => entry !== undefined && entry !== null && entry !== '')).toString();
  try {
    const [dashboardResult, historyResult, exceptionResult] = await Promise.all([
      api('/api/attendance/dashboard' + (query ? '?' + query : '')),
      api('/api/attendance/history' + (query ? '?' + query : '')),
      api('/api/attendance/exceptions' + (query ? '?' + query : ''))
    ]);
    state.attendance = dashboardResult.data;
    renderAttendanceDashboard(dashboardResult.data);
    const sourceUnavailable = dashboardResult.data && dashboardResult.data.source_status === 'UNAVAILABLE';
    renderAttendanceTables(sourceUnavailable ? dashboardResult.data : historyResult.data, sourceUnavailable ? dashboardResult.data : exceptionResult.data);
    if (value.from) $('attendance-from').value = value.from;
    if (value.to) $('attendance-to').value = value.to;
  } catch (error) { notify(error.message); }
}
function dateOffset(dateText, days) { const date = new Date(dateText + 'T12:00:00+08:00'); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10); }
function attendancePeriod(period) { const today = (state && state.attendance && state.attendance.date) || new Date().toISOString().slice(0, 10); if (period === 'today') return { from:today, to:today }; if (period === 'month') return { from:today.slice(0, 8) + '01', to:today }; const day = new Date(today + 'T12:00:00+08:00').getDay(); const monday = day === 0 ? -6 : 1 - day; return { from:dateOffset(today, monday), to:today }; }
function renderLeads() { $('leads-table').innerHTML = `<table><thead><tr><th>Lead</th><th>Contact</th><th>Destination</th><th>Travel</th><th>Pax</th><th>Status</th><th></th></tr></thead><tbody>${state.leads.map((r) => `<tr><td>${esc(r.lead_id)}</td><td>${esc(r.contact_name)}</td><td>${esc(r.destination)}</td><td>${esc(r.travel_start)} – ${esc(r.travel_end)}</td><td>${esc(r.pax_count)}</td><td><span class="status">${esc(r.status)}</span></td><td><button type="button" class="link" data-lead="${esc(r.lead_id)}">View</button></td></tr>`).join('')}</tbody></table>`; document.querySelectorAll('[data-lead]').forEach((button) => button.addEventListener('click', () => showLead(button.dataset.lead))); }
function renderCommercial() { $('quotations-table').innerHTML = `<h3>Quotations</h3><table><thead><tr><th>Reference</th><th>Lead</th><th>Destination</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>${state.quotations.map((r) => `<tr><td>${esc(r.quotation_id)}</td><td>${esc(r.lead_id)}</td><td>${esc(r.destination)}</td><td class="money">${money(r.client_total,r.currency)}</td><td><span class="status">${esc(r.status)}</span></td><td><button type="button" class="link" data-quotation="${esc(r.quotation_id)}">Edit / Preview</button></td></tr>`).join('')}</tbody></table>`; $('bookings-table').innerHTML = `<h3>Bookings</h3><table><thead><tr><th>Reference</th><th>Client</th><th>Destination</th><th>Items</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>${state.bookings.map((r) => `<tr><td>${esc(r.booking_id)}</td><td>${esc(r.client_id)}</td><td>${esc(r.destination)}</td><td>${state.booking_items.filter((item) => item.booking_id === r.booking_id).length}</td><td class="money">${money(r.client_total,r.currency)}</td><td><span class="status">${esc(r.status)}</span></td><td><button type="button" class="link" data-booking="${esc(r.booking_id)}">View</button></td></tr>`).join('')}</tbody></table>`; document.querySelectorAll('[data-booking]').forEach((button) => button.addEventListener('click', () => showBooking(button.dataset.booking))); document.querySelectorAll('[data-quotation]').forEach((button) => button.addEventListener('click', () => showQuotation(button.dataset.quotation))); }
function renderFinance() { $('supplier-bookings-table').innerHTML = `<h3>Supplier bookings</h3><table><thead><tr><th>Reference</th><th>Supplier</th><th>Booking</th><th>Cost</th><th>Balance</th><th>Due</th><th>Status</th></tr></thead><tbody>${state.supplier_bookings.map((r) => `<tr><td>${esc(r.supplier_reference || r.supplier_booking_id)}</td><td>${esc(r.supplier_id)}</td><td>${esc(r.booking_id)}</td><td class="money">${money(r.supplier_cost,r.currency)}</td><td class="money">${money(r.balance,r.currency)}</td><td>${esc(r.final_payment_due_date || r.deposit_due_date || '—')}</td><td><span class="status">${esc(r.status)}</span></td></tr>`).join('')}</tbody></table>`; $('finance-table').innerHTML = `<h3>Client invoices and payments</h3><table><thead><tr><th>Invoice</th><th>Booking</th><th>Total</th><th>Paid from clients</th><th>Balance</th><th>Status</th></tr></thead><tbody>${state.invoices.map((r) => `<tr><td>${esc(r.invoice_number)}</td><td>${esc(r.booking_id)}</td><td class="money">${money(r.total,r.currency)}</td><td class="money">${money(r.amount_paid,r.currency)}</td><td class="money">${money(r.balance_due,r.currency)}</td><td><span class="status">${esc(r.status)}</span></td></tr>`).join('')}</tbody></table><h3 style="margin-top:18px">Payment ledger</h3><table><thead><tr><th>Direction</th><th>Reference</th><th>Invoice / Supplier Booking</th><th>Amount</th><th>Method</th><th>Status</th></tr></thead><tbody>${state.payments.map((r) => `<tr><td>${r.payment_direction === 'TO_SUPPLIER' ? 'To supplier' : 'From client'}</td><td>${esc(r.reference || r.payment_id)}</td><td>${esc(r.invoice_id || r.supplier_booking_id || r.booking_id || 'Unallocated')}</td><td class="money">${money(r.amount,r.currency)}</td><td>${esc(r.method)}</td><td><span class="status">${esc(r.status)}</span></td></tr>`).join('')}</tbody></table>`; }

function syncPaymentCurrency() {
  const invoice = state && state.invoices.find((row) => row.invoice_id === $('payment-invoice').value);
  if (invoice && $('payment-currency') && !$('payment-currency').dataset.userChanged) $('payment-currency').value = invoice.currency;
}

function populate() {
  options('quotation-lead', state.leads, 'lead_id', (r) => r.lead_id + ' — ' + r.contact_name);
  options('update-lead', state.leads, 'lead_id', (r) => r.lead_id + ' — ' + r.contact_name);
  options('lead-client', state.clients, 'client_id', (r) => r.display_name);
  options('lead-contact', state.contacts, 'contact_id', (r) => r.contact_id + ' — ' + r.contact_value, 'No contacts available');
  options('quotation-item-quotation', state.quotations, 'quotation_id', (r) => r.quotation_id + ' — ' + r.destination);
  options('booking-quotation', state.quotations, 'quotation_id', (r) => r.quotation_id + ' — ' + r.destination);
  options('quotation-editor-select', state.quotations, 'quotation_id', (r) => r.quotation_id + ' — ' + r.destination);
  options('editor-client', state.clients, 'client_id', (r) => r.display_name, 'No clients available');
  options('quotation-item-supplier', state.suppliers, 'supplier_id', (r) => r.display_name, 'No suppliers available');
  options('editor-item-supplier', state.suppliers, 'supplier_id', (r) => r.display_name, 'No suppliers available');
  options('supplier-booking-supplier', state.suppliers, 'supplier_id', (r) => r.display_name, 'No suppliers available');
  const linkedItemIds = new Set((state.supplier_booking_items || []).map((row) => row.booking_item_id));
  const availableItems = state.booking_items.filter((row) => !linkedItemIds.has(row.booking_item_id));
  options('supplier-booking-item', availableItems, 'booking_item_id', (r) => r.booking_item_id + ' — ' + r.description, 'All booking items already have supplier bookings');
  $('supplier-booking-form').querySelector('button').disabled = !availableItems.length || !state.suppliers.length;
  options('invoice-booking', state.bookings, 'booking_id', (r) => r.booking_id + ' — ' + r.destination);
  options('payment-invoice', state.invoices.filter((r) => Number(r.balance_due) > 0), 'invoice_id', (r) => r.invoice_number + ' — balance ' + r.balance_due, 'No invoices with an outstanding balance');
  options('supplier-payment-booking', state.supplier_bookings.filter((r) => r.balance === undefined || Number(r.balance) > 0), 'supplier_booking_id', (r) => (r.supplier_reference || r.supplier_booking_id) + ' — balance ' + (r.balance === undefined ? 'unknown' : r.balance), 'No supplier balances due');
  if (selectedLeadId && state.leads.some((row) => row.lead_id === selectedLeadId)) {
    $('quotation-lead').value = selectedLeadId;
    $('update-lead').value = selectedLeadId;
  }
  if (selectedQuotationId && state.quotations.some((row) => row.quotation_id === selectedQuotationId)) {
    $('quotation-item-quotation').value = selectedQuotationId;
    $('booking-quotation').value = selectedQuotationId;
    $('quotation-editor-select').value = selectedQuotationId;
  }
}

function renderQuotationEditor(data) {
  const q = data.quotation;
  $('quotation-editor-empty').className = 'hidden';
  $('quotation-details-form').classList.remove('hidden');
  $('quotation-items-editor').classList.remove('hidden');
  $('quotation-editor-item-form').classList.remove('hidden');
  $('quotation-editor-select').value = q.quotation_id;
  $('editor-quotation-id').value = q.quotation_id;
  const itemQuotationId = $('editor-item-quotation-id');
  if (itemQuotationId) itemQuotationId.value = q.quotation_id;
  const fields = { client_id:'editor-client', quotation_date:'editor-quotation-date', valid_until:'editor-valid-until', destination:'editor-destination', travel_start:'editor-travel-start', travel_end:'editor-travel-end', pax_count:'editor-pax', currency:'editor-currency', status:'editor-status', discount_total:'editor-discount', fees_total:'editor-fees', tax_total:'editor-tax', inclusions:'editor-inclusions', exclusions:'editor-exclusions', payment_terms:'editor-payment-terms', payment_currency_policy:'editor-payment-currency-policy', itinerary:'editor-itinerary', notes:'editor-notes' };
  Object.keys(fields).forEach((field) => { $(fields[field]).value = q[field] === undefined || q[field] === null ? '' : q[field]; });
  renderItineraryEditor(q.itinerary);
  $('quotation-items-editor').innerHTML = `<h3>Quotation items <span class="muted">(internal cost is shown only here)</span></h3><table><thead><tr><th>Order</th><th>Service</th><th>Description</th><th>Supplier</th><th>Qty</th><th>Cost</th><th>Selling price</th><th>Actions</th></tr></thead><tbody>${data.items.slice().sort((a,b) => (a.line_order || 0) - (b.line_order || 0)).map((item, index) => `<tr data-item-row="${esc(item.quotation_item_id)}"><td><input class="item-line-order" type="number" min="1" value="${esc(item.line_order || index + 1)}"></td><td><select class="item-service-type"><option ${item.service_type==='Hotel'?'selected':''}>Hotel</option><option ${item.service_type==='Flight'?'selected':''}>Flight</option><option ${item.service_type==='Transfer'?'selected':''}>Transfer</option><option ${item.service_type==='Tour'?'selected':''}>Tour</option><option ${item.service_type==='Land Arrangement'?'selected':''}>Land Arrangement</option><option ${item.service_type==='Ticket'?'selected':''}>Ticket</option><option ${item.service_type==='Other'?'selected':''}>Other</option></select></td><td><input class="item-description" value="${esc(item.description)}"></td><td><select class="item-supplier"><option value="">No supplier</option>${state.suppliers.map((s) => `<option value="${esc(s.supplier_id)}" ${s.supplier_id===item.supplier_id?'selected':''}>${esc(s.display_name)}</option>`).join('')}</select></td><td><input class="item-quantity" type="number" min="1" value="${esc(item.quantity)}"></td><td><input class="item-cost" type="number" min="0" step="0.01" value="${esc(item.unit_cost)}"></td><td><input class="item-selling" type="number" min="0" step="0.01" value="${esc(item.unit_selling_price)}"></td><td class="row-actions"><button type="button" class="secondary quotation-item-save">Save</button><button type="button" class="link quotation-item-up">Up</button><button type="button" class="link quotation-item-down">Down</button><button type="button" class="link quotation-item-remove">Remove</button></td></tr>`).join('')}</tbody></table><div class="summary-box"><strong>Internal cost subtotal: ${money(data.totals.supplier_cost_total,q.currency)}</strong><strong>Internal margin: ${money(data.totals.markup_total,q.currency)}</strong><strong>Client total: ${money(data.totals.client_total,q.currency)}</strong></div>`;
}

function renderQuotationPreviewLegacy(data) {
  const q = data.quotation;
  const logoSrc = data.brand && data.brand.logo_asset ? '/assets/' + encodeURIComponent(data.brand.logo_asset) : '/assets/wmit-logo.png';
  $('quotation-preview').classList.remove('hidden');
  $('quotation-preview').innerHTML = `<div class="preview-actions"><span class="eyebrow">Client-facing preview</span><button type="button" id="preview-edit-button" class="secondary">Edit</button><button type="button" id="preview-print-button">Print</button></div><article class="print-sheet"><header class="quote-header"><div><div class="brand-name">WORLD MASTER</div><div class="brand-subtitle">International Travel</div></div><div class="quote-label">QUOTATION</div></header><div class="quote-meta"><div><strong>Prepared for</strong><br>${esc(data.client && data.client.name || 'Client')}</div><div><strong>Destination</strong><br>${esc(q.destination)}</div><div><strong>Travel dates</strong><br>${esc(q.travel_start || '—')} to ${esc(q.travel_end || '—')}<br>${esc(q.pax_count || '—')} passenger(s)</div><div><strong>Quotation date</strong><br>${esc(q.quotation_date || '—')}<br>Valid until ${esc(q.valid_until || '—')}</div></div><h3>Travel services</h3><table class="preview-table"><thead><tr><th>Service</th><th>Description</th><th>Dates</th><th>Qty</th><th>Amount</th></tr></thead><tbody>${data.items.map((item) => `<tr><td>${esc(item.service_type)}</td><td>${esc(item.description)}</td><td>${esc(item.service_start || '—')} ${item.service_end ? 'to ' + esc(item.service_end) : ''}</td><td>${esc(item.quantity)}</td><td class="money">${money(item.amount,item.currency)}</td></tr>`).join('')}</tbody></table><div class="preview-total"><div>Discount <span>${money(q.discount_total,q.currency)}</span></div><div>Fees and taxes <span>${money(Number(q.fees_total || 0) + Number(q.tax_total || 0),q.currency)}</span></div><div class="grand-total">Total <span>${money(q.client_total,q.currency)}</span></div></div><div class="quote-columns"><div><h3>Inclusions</h3><p>${esc(q.inclusions || 'As listed above.')}</p></div><div><h3>Exclusions</h3><p>${esc(q.exclusions || 'Not specified.')}</p></div></div><section class="quote-terms"><h3>Payment terms and notes</h3><p>${esc(q.payment_terms || 'Payment terms to be confirmed.')}</p></section><footer class="quote-footer">World Master International Travel<br>Philippines | Please contact WMIT for questions about this quotation.</footer></article>`;
  $('preview-edit-button').addEventListener('click', () => { $('quotation-preview').classList.add('hidden'); $('quotation-details-form').scrollIntoView({ behavior:'smooth', block:'start' }); });
  $('preview-print-button').addEventListener('click', () => window.print());
  $('quotation-print-button').disabled = false;
}

// Keep the client preview deliberately separate from the internal editor fields.
// This replacement definition is intentionally local-only and can be moved to an
// Apps Script HTML template without exposing supplier cost or internal notes.
function renderQuotationPreview(data) {
  const q = data.quotation;
  const logoSrc = data.brand && data.brand.logo_asset ? '/assets/' + encodeURIComponent(data.brand.logo_asset) : '/assets/header.png';
  $('quotation-preview').classList.remove('hidden');
  const itineraryDays = Array.isArray(q.itinerary_days) ? q.itinerary_days : [];
  const itinerary = itineraryDays.length ? `<section class="quote-itinerary"><h3>Day-by-day itinerary</h3>${itineraryDays.map((day, index) => `<article class="itinerary-day-preview"><h4>Day ${esc(day.day || index + 1)}${day.title ? ' — ' + esc(day.title) : ''}</h4>${day.date || day.city ? `<div class="itinerary-day-meta">${esc(day.date || '')}${day.date && day.city ? ' · ' : ''}${esc(day.city || '')}</div>` : ''}${day.activities ? `<p><strong>Activities</strong><br>${esc(day.activities)}</p>` : ''}${day.meals ? `<p><strong>Meals</strong><br>${esc(day.meals)}</p>` : ''}${day.overnight ? `<p><strong>Overnight</strong><br>${esc(day.overnight)}</p>` : ''}${day.notes ? `<p><strong>Notes</strong><br>${esc(day.notes)}</p>` : ''}</article>`).join('')}</section>` : (q.itinerary ? `<section class="quote-itinerary"><h3>Itinerary</h3><div class="itinerary-text">${esc(q.itinerary)}</div></section>` : '');
  const paymentPolicy = q.payment_currency_policy ? `<p><strong>Payment currency:</strong><br>${esc(q.payment_currency_policy)}</p>` : '';
  const discountLine = Number(q.discount_total || 0) > 0 ? `<div>Discount <span>${money(q.discount_total,q.currency)}</span></div>` : '';
  const hasServiceDates = data.items.some((item) => item.service_start || item.service_end);
  const datesHeader = hasServiceDates ? '<th>Dates</th>' : '';
  const datesCell = (item) => hasServiceDates ? `<td>${esc(item.service_start || '—')} ${item.service_end ? 'to ' + esc(item.service_end) : ''}</td>` : '';
  const finalPageClass = itineraryDays.length >= 5 || data.items.length >= 5 ? 'quote-final-page long' : 'quote-final-page';
  $('quotation-preview').innerHTML = `<div class="preview-actions"><span class="eyebrow">Client-facing preview</span><button type="button" id="preview-edit-button" class="secondary">Edit</button><button type="button" id="preview-print-button">Print</button></div><article class="print-sheet"><header class="quote-header"><img src="${esc(logoSrc)}" alt="World Master International Travel" class="wmit-logo"><div class="quote-label">QUOTATION</div></header><div class="quote-meta"><div><strong>Prepared for</strong><br>${esc(data.client && data.client.name || 'Client')}</div><div><strong>Destination</strong><br>${esc(q.destination)}</div><div><strong>Travel dates</strong><br>${esc(q.travel_start || '—')} to ${esc(q.travel_end || '—')}<br>${esc(q.pax_count || '—')} passenger(s)</div><div><strong>Quotation date</strong><br>${esc(q.quotation_date || '—')}<br>Valid until ${esc(q.valid_until || '—')}</div></div>${itinerary}<h3>Travel services</h3><table class="preview-table"><thead><tr><th>Service</th><th>Description</th>${datesHeader}<th>Qty</th><th>Amount</th></tr></thead><tbody>${data.items.map((item) => `<tr><td>${esc(item.service_type)}</td><td>${esc(item.description)}</td>${datesCell(item)}<td>${esc(item.quantity)}</td><td class="money">${money(item.amount,item.currency)}</td></tr>`).join('')}</tbody></table><div class="preview-total">${discountLine}<div>Fees and taxes <span>${money(Number(q.fees_total || 0) + Number(q.tax_total || 0),q.currency)}</span></div><div class="grand-total">Total <span>${money(q.client_total,q.currency)}</span></div></div><div class="${finalPageClass}"><h3 class="quote-final-heading">Quotation details and terms</h3><div class="quote-columns"><div><h3>Inclusions</h3><p>${esc(q.inclusions || 'As listed above.')}</p></div><div><h3>Exclusions</h3><p>${esc(q.exclusions || 'Not specified.')}</p></div></div><section class="quote-terms"><h3>Payment terms and notes</h3><p>${esc(q.payment_terms || 'Payment terms to be confirmed.')}</p>${paymentPolicy}</section><footer class="quote-footer">World Master International Travel<br>Philippines | Please contact WMIT for questions about this quotation.</footer></div></article>`;
  $('preview-edit-button').addEventListener('click', () => { $('quotation-preview').classList.add('hidden'); $('quotation-details-form').scrollIntoView({ behavior:'smooth', block:'start' }); });
  $('preview-print-button').addEventListener('click', () => window.print());
  $('quotation-print-button').disabled = false;
}

async function showQuotation(id, scroll) { try { selectedQuotationId = id; const result = await api('/api/quotations/' + encodeURIComponent(id)); renderQuotationEditor(result.data); $('quotation-preview').classList.add('hidden'); if (scroll !== false) { $('quotation-editor').scrollIntoView({ behavior:'smooth', block:'start' }); notify('Quotation editor loaded.', true); } } catch (error) { notify(error.message); } }
async function previewQuotation() { const id = $('quotation-editor-select').value; if (!id) return notify('Select a quotation first.'); try { const result = await api('/api/quotations/' + encodeURIComponent(id) + '/preview'); renderQuotationPreview(result.data); $('quotation-preview').scrollIntoView({ behavior:'smooth', block:'start' }); } catch (error) { notify(error.message); } }
async function refresh() { const result = await api('/api/state'); state = result.data; renderDashboard(); renderLeads(); renderCommercial(); renderFinance(); populate(); syncPaymentCurrency(); if (state.attendance && state.attendance.enabled) { const date = state.attendance.date; $('attendance-from').value = date; $('attendance-to').value = date; await loadAttendance({ from:date, to:date }); } if (state.bookings.length) { const detail = await api('/api/bookings/' + encodeURIComponent(state.bookings[0].booking_id)); renderBookingDetail(detail.data); } if (state.quotations.length) { const quotationId = selectedQuotationId && state.quotations.some((row) => row.quotation_id === selectedQuotationId) ? selectedQuotationId : state.quotations[0].quotation_id; await showQuotation(quotationId, false); } }
function renderBookingDetail(data) { $('booking-detail').className = 'detail-card'; $('booking-detail').innerHTML = `<div class="detail-title">Showing booking ${esc(data.booking.booking_id)}</div><div class="detail-grid"><div><strong>Booking</strong>${esc(data.booking.booking_id)}</div><div><strong>Client</strong>${esc(data.client && data.client.display_name)}</div><div><strong>Travel</strong>${esc(data.booking.travel_start)} – ${esc(data.booking.travel_end)}</div><div><strong>Travelers</strong>${data.travelers.length}</div><div><strong>Supplier bookings</strong>${data.supplier_bookings.length}</div><div><strong>Invoices</strong>${data.invoices.length}</div></div><h3 style="margin-top:18px">Booking items</h3><table><thead><tr><th>Item</th><th>Description</th><th>Supplier</th><th>Price</th></tr></thead><tbody>${data.items.map((item) => `<tr><td>${esc(item.booking_item_id)}</td><td>${esc(item.description)}</td><td>${esc(item.supplier_id)}</td><td class="money">${money(item.selling_price,item.currency)}</td></tr>`).join('')}</tbody></table>`; }
function renderLeadDetail(data) { $('lead-detail').className = 'detail-card'; $('lead-detail').innerHTML = `<div class="detail-title">Showing lead ${esc(data.lead_id)}</div><div class="detail-grid"><div><strong>Lead</strong>${esc(data.lead_id)}</div><div><strong>Contact</strong>${esc(data.contact_name)}<br>${esc(data.contact_email)}</div><div><strong>Destination</strong>${esc(data.destination)}</div><div><strong>Travel dates</strong>${esc(data.travel_start)} – ${esc(data.travel_end)}</div><div><strong>Pax</strong>${esc(data.pax_count)}</div><div><strong>Status</strong><span class="status">${esc(data.status)}</span></div></div>`; }
function focusDetail(id, message) { const detail = $(id); notify(message, true); detail.classList.remove('detail-pulse'); void detail.offsetWidth; detail.classList.add('detail-pulse'); detail.scrollIntoView({ behavior:'smooth', block:'start' }); }
async function showLead(id) { try { const result = await api('/api/leads/' + encodeURIComponent(id)); renderLeadDetail(result.data); $('update-lead').value = id; focusDetail('lead-detail', 'Lead details loaded.'); } catch (error) { notify(error.message); } }
async function showBooking(id) { try { const result = await api('/api/bookings/' + encodeURIComponent(id)); renderBookingDetail(result.data); focusDetail('booking-detail', 'Booking details loaded.'); } catch (error) { notify(error.message); } }
function formDataFromRow(row, itemId) { const quote = state.quotations.find((q) => q.quotation_id === $('editor-quotation-id').value); return { quotation_item_id:itemId, service_type:row.querySelector('.item-service-type').value, description:row.querySelector('.item-description').value, supplier_id:row.querySelector('.item-supplier').value || undefined, quantity:Number(row.querySelector('.item-quantity').value), unit_cost:Number(row.querySelector('.item-cost').value), unit_selling_price:Number(row.querySelector('.item-selling').value), line_order:Number(row.querySelector('.item-line-order').value), currency:quote.currency }; }
function wire(formId, endpoint, after) { $(formId).addEventListener('submit', async (event) => { event.preventDefault(); clearFormErrors(event.target); if (!event.target.reportValidity()) return; try { if (formId === 'quotation-details-form') syncItineraryInput(); const result = await api(endpoint, formData(event.target)); notify('Saved successfully.', true); event.target.reset(); if (after) await after(result); await refresh(); } catch (error) { showFormError(event.target, error); } }); }

wire('lead-form', '/api/leads', (result) => { if (result.data && result.data.lead_id) { selectedLeadId = result.data.lead_id; $('quotation-lead').value = selectedLeadId; $('update-lead').value = selectedLeadId; } });
wire('lead-update-form', '/api/leads/update');
wire('quotation-form', '/api/quotations/from-lead', async (result) => { const id = result.data && result.data.quotation_id; if (result.data && result.data.lead_id) selectedLeadId = result.data.lead_id; if (id) { selectedQuotationId = id; $('quotation-item-quotation').value = id; $('booking-quotation').value = id; await showQuotation(id); } });
wire('quotation-item-form', '/api/quotation-items', async (result) => { const id = result.data && result.data.quotation && result.data.quotation.quotation_id; if (id) { selectedQuotationId = id; $('quotation-item-quotation').value = id; $('booking-quotation').value = id; await showQuotation(id); } });
wire('booking-form', '/api/bookings/from-quotation', (result) => { const id = result.data && result.data.booking && result.data.booking.booking_id; if (id) { $('invoice-booking').value = id; showBooking(id); } });
wire('supplier-booking-form', '/api/supplier-bookings/from-item');
wire('invoice-form', '/api/invoices/from-booking', (result) => { const id = result.data && result.data.invoice && result.data.invoice.invoice_id; if (id) $('payment-invoice').value = id; });
wire('payment-form', '/api/payments/from-invoice');
wire('supplier-payment-form', '/api/payments/to-supplier');
wire('quotation-details-form', '/api/quotations/update', (result) => showQuotation(result.data.quotation_id || $('editor-quotation-id').value, false));
wire('quotation-editor-item-form', '/api/quotation-items', (result) => showQuotation(result.data.quotation.quotation_id, false));

$('quotation-editor-select').addEventListener('change', () => { selectedQuotationId = $('quotation-editor-select').value; showQuotation(selectedQuotationId); });
$('add-itinerary-day').addEventListener('click', () => { const days = currentItineraryDays(); days.push({ day:days.length + 1 }); renderItineraryEditor(JSON.stringify(days)); const last = $('itinerary-days').lastElementChild; if (last) last.scrollIntoView({ behavior:'smooth', block:'center' }); });
$('itinerary-days').addEventListener('click', (event) => { if (!event.target.classList.contains('itinerary-day-remove')) return; const card = event.target.closest('[data-day-card]'); if (card) card.remove(); Array.from(document.querySelectorAll('[data-day-card]')).forEach((day, index) => { const heading = day.querySelector('h4'); if (heading) heading.textContent = 'Day ' + (index + 1); }); syncItineraryInput(); });
$('quotation-lead').addEventListener('change', () => { selectedLeadId = $('quotation-lead').value; });
$('payment-invoice').addEventListener('change', syncPaymentCurrency);
$('payment-currency').addEventListener('change', () => { $('payment-currency').dataset.userChanged = 'true'; });
$('quotation-preview-button').addEventListener('click', previewQuotation);
$('quotation-print-button').addEventListener('click', () => { if (!$('quotation-preview').classList.contains('hidden')) window.print(); else previewQuotation().then(() => window.print()); });
$('quotation-items-editor').addEventListener('click', async (event) => { const row = event.target.closest('[data-item-row]'); if (!row) return; const itemId = row.dataset.itemRow; try { if (event.target.classList.contains('quotation-item-save')) { await api('/api/quotation-items/update', formDataFromRow(row, itemId)); notify('Quotation item saved.', true); await showQuotation($('editor-quotation-id').value, false); } else if (event.target.classList.contains('quotation-item-remove')) { if (!window.confirm('Remove this quotation item?')) return; await api('/api/quotation-items/remove', { quotation_item_id:itemId }); notify('Quotation item removed.', true); await showQuotation($('editor-quotation-id').value, false); } else if (event.target.classList.contains('quotation-item-up') || event.target.classList.contains('quotation-item-down')) { const rows = Array.from($('quotation-items-editor').querySelectorAll('[data-item-row]')); const ids = rows.map((r) => r.dataset.itemRow); const index = ids.indexOf(itemId); const next = index + (event.target.classList.contains('quotation-item-up') ? -1 : 1); if (next < 0 || next >= ids.length) return; [ids[index], ids[next]] = [ids[next], ids[index]]; await api('/api/quotation-items/reorder', { quotation_id:$('editor-quotation-id').value, quotation_item_ids:ids }); await showQuotation($('editor-quotation-id').value, false); notify('Quotation item order saved.', true); } } catch (error) { showFormError($('quotation-details-form'), error); } });
$('attendance-filter-form').addEventListener('submit', async (event) => { event.preventDefault(); const filters = formData(event.target); await loadAttendance(filters); });
document.querySelectorAll('[data-attendance-period]').forEach((button) => button.addEventListener('click', async () => { const period = attendancePeriod(button.dataset.attendancePeriod); $('attendance-from').value = period.from; $('attendance-to').value = period.to; await loadAttendance(period); }));
$('refresh').addEventListener('click', () => refresh().catch((error) => notify(error.message)));
refresh().catch((error) => notify(error.message));
