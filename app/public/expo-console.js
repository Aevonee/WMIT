'use strict';

// WMIT Events console (expo lead capture, follow-ups, quotations, results).
// Styled to match the Operations workspace; talks only to the whitelisted
// /api/expo endpoints with sessions enforced in staging/production.

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pill = (status) => '<span class="status pill-' + esc(status) + '">' + esc(status) + '</span>';
const money = (value, currency) => esc(value) + ' ' + esc(currency || 'PHP');
const MEAL_LABELS = { ROOM_ONLY: 'Room only', BREAKFAST: 'Breakfast', HALF_BOARD: 'B+D', FULL_BOARD: 'All meals', ANY: 'Any' };

let leadsCache = [];
let templatesCache = [];
let exposCache = [];
let quotesCache = [];
let currentExpoTag = null; // null = default (current) event

const leadBrief = (lead) => {
  if (!lead) return '—';
  const parts = [];
  const travellers = [lead.adults, lead.children].some((n) => n !== undefined && n !== null)
    ? (lead.adults || 1) + 'A' + (lead.children ? ' · ' + lead.children + 'K' : '')
    : (lead.pax_count ? lead.pax_count + ' pax' : '');
  if (travellers) parts.push(travellers);
  if (lead.duration_days) parts.push(lead.duration_days + 'D');
  if (lead.hotel_stars) parts.push(lead.hotel_stars + '★');
  if (lead.meal_plan && MEAL_LABELS[lead.meal_plan]) parts.push(MEAL_LABELS[lead.meal_plan]);
  return parts.join(' · ') || '—';
};

function kioskUrl(tag) {
  return window.location.origin + '/expo.html' + (tag ? '?expo=' + encodeURIComponent(tag) : '');
}
function kioskUrlForSelected() { return kioskUrl(currentExpoTag); }
window.kioskUrlForSelected = kioskUrlForSelected; // header "Open sign-up form" button

function scopeQuery(base) {
  const params = new URLSearchParams(base || '');
  if (currentExpoTag) params.set('expo_tag', currentExpoTag);
  const query = params.toString();
  return query ? '?' + query : '';
}

function token() { return sessionStorage.getItem('wmit_session'); }
function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const value = token();
  if (value) headers.Authorization = 'Bearer ' + value;
  return headers;
}

async function api(path, options) {
  const response = await fetch(path, Object.assign({ headers: authHeaders() }, options || {}));
  if (response.status === 401) { sessionStorage.removeItem('wmit_session'); window.location.href = 'login.html?next=expo-console.html'; throw new Error('Sign-in required.'); }
  const body = await response.json();
  if (!body.ok) throw new Error(body.error && body.error.message || 'The request failed.');
  return body.data;
}

function notify(text, kind) {
  if (window.wmitToast) { window.wmitToast(kind === 'error' ? 'error' : 'ok', kind === 'error' ? 'Action failed' : 'Done', text); return; }
  const el = $('message');
  el.textContent = text;
  el.className = 'message show ' + (kind === 'error' ? 'error' : 'ok');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => { el.className = 'message'; }, 6000);
}

function guard(run) { return async () => { try { await run(); } catch (error) { notify(error.message || String(error), 'error'); } }; }

function tableWrap(rowsHtml, headHtml, emptyText, columns) {
  if (!rowsHtml) return '<p class="muted">' + esc(emptyText) + '</p>';
  return '<div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>' + headHtml + '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>';
}

// ------------------------------------------------------------------ tabs

const TAB_LOADERS = {
  dashboard: () => loadDashboard(),
  followups: () => loadFollowUps(),
  leads: () => loadLeads(),
  packages: () => loadPackages(),
  quotes: () => loadQuotes().then(loadQuoteForm),
  expos: () => loadExpos()
};

document.querySelectorAll('.nav a[data-tab]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    document.querySelectorAll('.nav a[data-tab]').forEach((other) => other.classList.toggle('active', other === link));
    ['dashboard', 'followups', 'leads', 'packages', 'quotes', 'expos'].forEach((name) => {
      $('tab-' + name).style.display = name === link.dataset.tab ? 'block' : 'none';
    });
    guard(TAB_LOADERS[link.dataset.tab])();
  });
});
$('tab-dashboard').style.display = 'block';

$('nav-logout').addEventListener('click', async () => {
  try { await fetch('/api/auth/logout', { method: 'POST', headers: authHeaders() }); } catch (_) { /* best effort */ }
  sessionStorage.removeItem('wmit_session');
  window.location.href = 'login.html';
});

// ------------------------------------------------------------- dashboard

async function loadDashboard() {
  const data = await api('/api/expo/dashboard' + scopeQuery());
  const metrics = [
    ['Leads', data.funnel.leads], ['Contacted', data.funnel.contacted], ['Quotes sent', data.funnel.quotes_sent],
    ['Accepted', data.funnel.accepted], ['Booked', data.funnel.booked], ['Revenue (PHP)', data.revenue.php_total]
  ];
  $('funnel-metrics').innerHTML = metrics.map(([label, value]) => '<div class="metric"><small>' + esc(label) + '</small><strong>' + esc(value) + '</strong></div>').join('') +
    '<div class="metric" style="grid-column:1/-1"><small>Conversion</small><strong style="font-size:15px">lead→quote ' + esc(data.conversion.lead_to_quote_percent) + '% · quote→accept ' + esc(data.conversion.quote_to_accept_percent) + '% · accept→book ' + esc(data.conversion.accept_to_book_percent) + '% · lead→book ' + esc(data.conversion.lead_to_book_percent) + '%</strong><small>Open follow-ups: ' + esc(data.follow_ups.open) + ' · Lost/Unreachable: ' + esc(data.funnel.lost) + '</small></div>';
  const dayRows = (data.by_day || []).map((row) => '<tr><td>' + esc(row.day) + '</td><td>' + esc(row.leads) + '</td><td>' + esc(row.quotes_sent) + '</td><td>' + esc(row.accepted) + '</td><td>' + esc(row.booked) + '</td></tr>').join('');
  const pkgRows = (data.by_package || []).map((row) => '<tr><td>' + esc(row.package) + '</td><td>' + esc(row.offered) + '</td><td>' + esc(row.sent) + '</td><td>' + esc(row.accepted) + '</td></tr>').join('');
  $('by-day-wrap').innerHTML = tableWrap(dayRows, '<th>Day</th><th>Leads</th><th>Quotes</th><th>Accepted</th><th>Booked</th>', 'No activity yet.');
  $('by-package-wrap').innerHTML = tableWrap(pkgRows, '<th>Package</th><th>Offered</th><th>Sent</th><th>Accepted</th>', 'No packages quoted yet.');
}
$('refresh-dashboard').addEventListener('click', guard(loadDashboard));

// ------------------------------------------------------------- follow-ups

let followupsCache = [];

async function loadFollowUps() {
  const data = await api('/api/expo/followups' + scopeQuery());
  $('followup-summary').textContent = data.open_count + ' open · ' + data.overdue_count + ' overdue (of ' + data.today + ')';
  followupsCache = data.queue;
  const rows = data.queue.map((item) => '<tr class="' + (item.overdue ? 'overdue' : '') + '"><td>' + esc(item.due_date) + (item.overdue ? ' <b class="needs-mobile">OVERDUE</b>' : '') + '</td><td>Day ' + esc(item.day_step) + '</td><td><b>' + esc(item.lead ? item.lead.name : '?') + '</b><br><span class="muted">' + esc(item.lead ? item.lead.destination + ' · ' + item.lead.travel_month : '') + '</span><br><span class="muted">' + leadBrief(item.lead) + '</span></td><td>' + pill(item.lead ? item.lead.status : 'NEW') + '</td>' +
    '<td class="chat-actions">' + (item.whatsapp_url ? '<a class="chat-whatsapp" href="' + esc(item.whatsapp_url) + '" target="_blank" rel="noopener">WhatsApp</a>' : '<span class="needs-mobile">no mobile yet</span>') + (item.viber_url ? ' <a class="chat-viber" href="' + esc(item.viber_url) + '" target="_blank" rel="noopener">Viber</a>' : '') + '</td>' +
    '<td class="row-actions"><button class="secondary compact" data-msg-followup="' + esc(item.task_id) + '">Message</button> <button class="secondary compact" data-complete="' + esc(item.task_id) + '">Done</button></td></tr>').join('');
  $('followup-content').innerHTML = tableWrap(rows, '<th>Due</th><th>Step</th><th>Lead</th><th>Status</th><th>Chat</th><th></th>', 'Queue is clear. Great work!');
  $('followup-content').querySelectorAll('[data-complete]').forEach((button) => {
    button.addEventListener('click', guard(async () => {
      const note = window.prompt('Outcome note (optional):') || '';
      await api('/api/expo/followups/complete', { method: 'POST', body: JSON.stringify({ task_id: button.dataset.complete, note }) });
      notify('Follow-up completed.');
      await loadFollowUps();
    }));
  });
  $('followup-content').querySelectorAll('[data-msg-followup]').forEach((button) => {
    button.addEventListener('click', async () => {
      const item = followupsCache.find((entry) => entry.task_id === button.dataset.msgFollowup);
      if (!item || !item.lead) return;
      if (!item.lead.mobile) return notify('This lead has no mobile number yet — use Add mobile on the Leads tab.', 'error');
      window.wmitOpenMessageComposer({
        title: 'Message ' + (item.lead.name || 'lead'),
        mobile: item.lead.mobile,
        context: leadComposerContext(item.lead),
        templates: await messageTemplates()
      });
    });
  });
}
$('refresh-followups').addEventListener('click', guard(loadFollowUps));

// ------------------------------------------------------------------ leads

$('import-run').addEventListener('click', guard(async () => {
  const text = $('import-text').value;
  if (!text.trim()) return notify('Paste at least one line to import.', 'error');
  const data = await api('/api/expo/leads/import', { method: 'POST', body: JSON.stringify({ text, default_destination: $('import-destination').value, default_travel_month: $('import-month').value, expo_tag: currentExpoTag || undefined }) });
  $('import-result').innerHTML = 'Imported <b>' + esc(data.created_count) + '</b> lead(s); ' + esc(data.failed_count) + ' line(s) skipped.' +
    (data.failed.length ? '<br>' + data.failed.map((failure) => 'Line ' + esc(failure.line) + ': ' + esc(failure.message)).join('<br>') : '');
  $('import-text').value = '';
  notify('Import finished: ' + data.created_count + ' created, ' + data.follow_up_tasks_created + ' follow-up tasks scheduled.');
  await loadLeads();
}));

async function loadLeads() {
  const query = $('lead-search') ? $('lead-search').value.trim() : '';
  leadsCache = await api('/api/expo/leads' + scopeQuery(query ? 'q=' + encodeURIComponent(query) : ''));
  const rows = leadsCache.map((lead) => '<tr><td class="muted">' + esc(lead.expo_lead_id.slice(-8)) + '</td><td><b>' + esc(lead.name) + '</b>' + (lead.needs_mobile ? ' <span class="needs-mobile">NEEDS MOBILE</span>' : '') + (lead.email ? '<br><span class="muted">' + esc(lead.email) + '</span>' : '') + '</td><td>' + esc(lead.mobile || '—') + '</td><td>' + esc(lead.destination) + '</td><td>' + esc(lead.travel_month) + '</td><td>' + esc(leadBrief(lead)) + '</td><td>' + pill(lead.status) + '</td><td class="muted">' + esc(lead.source) + '</td>' +
    '<td class="row-actions"><select data-status="' + esc(lead.expo_lead_id) + '">' + ['NEW', 'CONTACTED', 'QUOTED', 'ACCEPTED', 'BOOKED', 'LOST', 'UNREACHABLE'].map((status) => '<option ' + (status === lead.status ? 'selected' : '') + '>' + status + '</option>').join('') + '</select> ' +
    '<button class="secondary compact" data-msg-lead="' + esc(lead.expo_lead_id) + '"' + (lead.mobile ? '' : ' title="No mobile number yet"') + '>Message</button>' +
    (lead.needs_mobile ? ' <button class="secondary compact" data-attach="' + esc(lead.expo_lead_id) + '">Add mobile</button>' : '') + '</td></tr>').join('');
  $('lead-content').innerHTML = tableWrap(rows, '<th>ID</th><th>Name</th><th>Mobile</th><th>Destination</th><th>Month</th><th>Trip brief</th><th>Status</th><th>Source</th><th>Set status</th>', 'No leads yet — share the sign-up form or import badges.');
  $('lead-content').querySelectorAll('[data-status]').forEach((select) => {
    select.addEventListener('change', guard(async () => {
      await api('/api/expo/leads/update', { method: 'POST', body: JSON.stringify({ expo_lead_id: select.dataset.status, status: select.value }) });
      notify('Lead marked ' + select.value + '.');
      await loadLeads();
    }));
  });
  $('lead-content').querySelectorAll('[data-attach]').forEach((button) => {
    button.addEventListener('click', guard(async () => {
      const mobile = window.prompt('Mobile number (09xx xxx xxxx):');
      if (!mobile) return;
      await api('/api/expo/leads/contact', { method: 'POST', body: JSON.stringify({ expo_lead_id: button.dataset.attach, mobile }) });
      notify('Mobile attached — chat links are live.');
      await loadLeads();
    }));
  });
  $('lead-content').querySelectorAll('[data-msg-lead]').forEach((button) => {
    button.addEventListener('click', () => openLeadComposer(button.dataset.msgLead));
  });
}

let composerTemplates = null;
async function messageTemplates() {
  if (composerTemplates) return composerTemplates;
  try {
    const data = await api('/api/settings');
    composerTemplates = window.wmitMessageTemplates(data.messageTemplates);
  } catch (_) {
    composerTemplates = window.wmitMessageTemplates([]);
  }
  return composerTemplates;
}

function leadComposerContext(lead) {
  const name = String(lead.name || '');
  return {
    name: name,
    first_name: name.split(/\s+/)[0] || name,
    destination: lead.destination,
    travel_month: lead.travel_month ? ' (' + lead.travel_month + ')' : '',
    consultant: 'your Worldmaster consultant'
  };
}

async function openLeadComposer(leadId) {
  const lead = leadsCache.find((item) => item.expo_lead_id === leadId);
  if (!lead) return;
  if (!lead.mobile) return notify('Add a mobile number first — the Message button needs one.', 'error');
  window.wmitOpenMessageComposer({
    title: 'Message ' + (lead.name || 'lead'),
    mobile: lead.mobile,
    context: leadComposerContext(lead),
    templates: await messageTemplates()
  });
}
let leadSearchTimer = null;
if ($('lead-search')) $('lead-search').addEventListener('input', () => {
  clearTimeout(leadSearchTimer);
  leadSearchTimer = setTimeout(() => guard(loadLeads)(), 200);
});
$('refresh-leads').addEventListener('click', guard(loadLeads));

// --------------------------------------------------------------- packages

async function loadPackages() {
  templatesCache = await api('/api/expo/templates' + scopeQuery());
  const rows = templatesCache.map((template) => '<tr><td>' + esc(template.destination) + '</td><td><b>' + esc(template.name) + '</b></td><td>' + esc(template.duration_days) + '</td><td>' + money(template.price_per_person, template.currency) + '</td><td class="muted">' + esc((template.inclusions || []).slice(0, 3).join(', ')) + (template.inclusions && template.inclusions.length > 3 ? '…' : '') + '</td><td>' + pill(template.status) + '</td>' +
    '<td class="row-actions"><button class="secondary compact" data-price="' + esc(template.expo_package_template_id) + '">Update price</button> <button class="secondary compact" data-archive="' + esc(template.expo_package_template_id) + '">' + (template.status === 'ACTIVE' ? 'Archive' : 'Restore') + '</button></td></tr>').join('');
  $('package-content').innerHTML = tableWrap(rows, '<th>Destination</th><th>Package</th><th>Days</th><th>Price/pax</th><th>Inclusions</th><th>Status</th><th></th>', 'No packages yet — add your first.');
  $('package-content').querySelectorAll('[data-price]').forEach((button) => {
    button.addEventListener('click', guard(async () => {
      const price = window.prompt('New price per person (PHP):');
      if (!price) return;
      await api('/api/expo/templates/update', { method: 'POST', body: JSON.stringify({ expo_package_template_id: button.dataset.price, price_per_person: price }) });
      notify('Price updated.');
      await loadPackages();
    }));
  });
  $('package-content').querySelectorAll('[data-archive]').forEach((button) => {
    button.addEventListener('click', guard(async () => {
      const template = templatesCache.find((candidate) => candidate.expo_package_template_id === button.dataset.archive);
      const next = template.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE';
      await api('/api/expo/templates/update', { method: 'POST', body: JSON.stringify({ expo_package_template_id: button.dataset.archive, status: next }) });
      notify('Package ' + next.toLowerCase() + '.');
      await loadPackages();
    }));
  });
}
$('package-create').addEventListener('click', guard(async () => {
  await api('/api/expo/templates/create', { method: 'POST', body: JSON.stringify({
    destination: $('pkg-destination').value,
    name: $('pkg-name').value,
    duration_days: Number($('pkg-days').value),
    price_per_person: $('pkg-price').value,
    inclusions: $('pkg-inclusions').value,
    exclusions: $('pkg-exclusions').value,
    expo_tag: currentExpoTag || undefined
  }) });
  notify('Package saved.');
  ['pkg-destination', 'pkg-name', 'pkg-price', 'pkg-inclusions', 'pkg-exclusions'].forEach((id) => $(id).value = '');
  await loadPackages();
}));
$('refresh-packages').addEventListener('click', guard(loadPackages));

// ----------------------------------------------------------------- quotes

async function loadQuoteForm() {
  await Promise.all([loadLeads(), loadPackages()]);
  $('quote-lead').innerHTML = leadsCache.filter((lead) => !['BOOKED', 'LOST', 'UNREACHABLE'].includes(lead.status)).map((lead) => '<option value="' + esc(lead.expo_lead_id) + '">' + esc(lead.name) + ' — ' + esc(lead.destination) + ' (' + esc(lead.mobile || 'no mobile') + ')</option>').join('');
  $('quote-option-picks').innerHTML = templatesCache.length ? templatesCache.map((template) => '<div class="option-pick"><input type="checkbox" id="pick-' + esc(template.expo_package_template_id) + '" data-template="' + esc(template.expo_package_template_id) + '"><label for="pick-' + esc(template.expo_package_template_id) + '" style="flex:1;margin:0"><b>' + esc(template.name) + '</b> · ' + esc(template.destination) + ' · ' + esc(template.duration_days) + 'D · ' + money(template.price_per_person, template.currency) + '/pax</label><input class="mini-input" type="text" data-override="' + esc(template.expo_package_template_id) + '" placeholder="override price"></div>').join('') : '<p class="muted">Create packages first.</p>';
  if (!$('quote-valid').value) {
    const date = new Date();
    date.setDate(date.getDate() + 14);
    $('quote-valid').value = date.toISOString().slice(0, 10);
  }
}

$('quote-create').addEventListener('click', guard(async () => {
  const options = [];
  document.querySelectorAll('#quote-option-picks input[type="checkbox"]:checked').forEach((checkbox) => {
    const templateId = checkbox.dataset.template;
    const override = document.querySelector('[data-override="' + templateId + '"]').value.trim();
    const option = { template_id: templateId };
    if (override) option.price_per_person = override;
    options.push(option);
  });
  if (!options.length) return notify('Tick at least one package for the quote.', 'error');
  if (!$('quote-lead').value) return notify('No quotable lead available.', 'error');
  const data = await api('/api/expo/quotes/create', { method: 'POST', body: JSON.stringify({ expo_lead_id: $('quote-lead').value, options, valid_until: $('quote-valid').value }) });
  notify('Draft quote ' + data.expo_quote_id + ' created.');
  await loadQuotes();
}));

async function loadQuotes() {
  const quotes = await api('/api/expo/quotes' + scopeQuery());
  quotesCache = quotes;
  const leadNames = new Map(leadsCache.map((lead) => [lead.expo_lead_id, lead.name]));
  const rows = quotes.map((quote) => '<tr><td class="muted">' + esc(quote.expo_quote_id) + '</td><td>' + esc(leadNames.get(quote.expo_lead_id) || quote.lead_snapshot.name) + '</td><td class="muted">' + quote.options.map((option) => esc(option.name)).join('<br>') + '</td><td>' + pill(quote.status) + '</td><td>' + esc(quote.sent_to_email || '—') + '</td>' +
    '<td class="row-actions">' +
    '<button class="secondary compact" data-msg-quote="' + esc(quote.expo_quote_id) + '">Message</button> ' +
    (['DRAFT', 'SENT'].includes(quote.status) ? '<button class="secondary compact" data-send="' + esc(quote.expo_quote_id) + '" data-email="' + esc(quote.lead_snapshot.email || '') + '">Email quote</button>' : '') +
    (['DRAFT', 'SENT'].includes(quote.status) ? '<button class="secondary compact" data-link="' + esc(quote.expo_quote_id) + '">Get link</button>' : '') +
    (quote.status === 'ACCEPTED' ? '<button class="compact" data-book="' + esc(quote.expo_quote_id) + '">Mark booked</button>' : '') +
    '</td></tr>').join('');
  $('quote-content').innerHTML = tableWrap(rows, '<th>Quote</th><th>Lead</th><th>Options</th><th>Status</th><th>Sent</th><th>Actions</th>', 'No quotes yet.');

  $('quote-content').querySelectorAll('[data-send]').forEach((button) => {
    button.addEventListener('click', guard(async () => {
      const email = window.prompt('Send quotation to email:', button.dataset.email || '');
      if (!email) return;
      const data = await api('/api/expo/quotes/send', { method: 'POST', body: JSON.stringify({ expo_quote_id: button.dataset.send, email }) });
      const delivery = data.delivery && data.delivery.mode === 'eml_file' ? 'saved as .eml draft (SMTP not configured)' : 'sent via SMTP';
      notify('Quote ' + (data.delivery && data.delivery.sent ? 'emailed' : 'prepared') + ' — ' + delivery + '.');
      await loadQuotes();
    }));
  });
  $('quote-content').querySelectorAll('[data-msg-quote]').forEach((button) => {
    button.addEventListener('click', async () => {
      const quote = quotesCache.find((entry) => entry.expo_quote_id === button.dataset.msgQuote);
      if (!quote) return;
      const snapshot = quote.lead_snapshot || {};
      const name = String(snapshot.name || '');
      const canIssueLink = ['DRAFT', 'SENT'].includes(quote.status);
      window.wmitOpenMessageComposer({
        title: 'Message ' + (name || 'client'),
        mobile: snapshot.mobile,
        context: Object.assign(leadComposerContext({ name: name, destination: snapshot.destination, travel_month: null }), {
          valid_until: quote.valid_until
        }),
        templates: await messageTemplates(),
        fetchContext: canIssueLink ? function (pending) {
          if (!pending.includes('quote_link')) return Promise.resolve({});
          return api('/api/expo/quotes/link', { method: 'POST', body: JSON.stringify({ expo_quote_id: quote.expo_quote_id }) }).then(function (data) {
            return { quote_link: data.url };
          });
        } : null
      });
    });
  });
  $('quote-content').querySelectorAll('[data-link]').forEach((button) => {
    button.addEventListener('click', guard(async () => {
      const data = await api('/api/expo/quotes/link', { method: 'POST', body: JSON.stringify({ expo_quote_id: button.dataset.link }) });
      const detail = $('quote-detail');
      detail.classList.remove('hidden');
      detail.innerHTML = '<h3>Quote link</h3><p><a href="' + esc(data.url) + '" target="_blank" rel="noopener">' + esc(data.url) + '</a></p>' +
        (data.whatsapp_url ? '<p><a class="chat-whatsapp" style="padding:8px 12px;border-radius:6px;text-decoration:none;font-weight:700" href="' + esc(data.whatsapp_url) + '" target="_blank" rel="noopener">Open WhatsApp with quote link</a></p>' : '') +
        '<p class="muted" style="font-size:12px">A fresh token was issued; older links for this quote stop working.</p>';
      notify('Quote link issued.');
    }));
  });
  $('quote-content').querySelectorAll('[data-book]').forEach((button) => {
    button.addEventListener('click', guard(async () => {
      const bookingId = window.prompt('Booking ID from the Operations workspace (e.g. BOOKING-2026-000001):');
      if (!bookingId) return;
      await api('/api/expo/quotes/booked', { method: 'POST', body: JSON.stringify({ expo_quote_id: button.dataset.book, booking_id: bookingId.trim() }) });
      notify('Marked booked — funnel and revenue updated.');
      await loadQuotes();
    }));
  });
}
$('refresh-quotes').addEventListener('click', guard(async () => { await loadQuotes(); await loadQuoteForm(); }));

// ----------------------------------------------------------------- events

async function loadExpos() {
  exposCache = await api('/api/expo/expos');
  const rows = exposCache.map((event) => '<tr><td><b>' + esc(event.name) + '</b></td><td class="muted">' + esc(event.expo_tag) + '</td><td>' + esc(event.start_date || '—') + ' → ' + esc(event.end_date || '—') + '</td><td>' + pill(event.status) + '</td>' +
    '<td>' + (event.status === 'ACTIVE' ? '<a href="' + esc(kioskUrl(event.expo_tag)) + '" target="_blank" rel="noopener">Open</a>' : '<span class="ended-note">closed</span>') + '</td>' +
    '<td class="row-actions"><button class="secondary compact" data-status="' + esc(event.expo_tag) + '" data-next="' + (event.status === 'ACTIVE' ? 'ENDED' : 'ACTIVE') + '">' + (event.status === 'ACTIVE' ? 'Mark ended' : 'Reopen') + '</button></td></tr>').join('');
  $('expo-content').innerHTML = tableWrap(rows, '<th>Event</th><th>Tag</th><th>Dates</th><th>Status</th><th>Sign-up form</th><th></th>', 'No events registered yet. Add one above.');
  $('expo-content').querySelectorAll('[data-status]').forEach((button) => {
    button.addEventListener('click', guard(async () => {
      if (button.dataset.next === 'ENDED' && !window.confirm('End ' + button.dataset.status + '? Its sign-up form stops accepting leads; history stays viewable.')) return;
      await api('/api/expo/expos/status', { method: 'POST', body: JSON.stringify({ expo_tag: button.dataset.status, status: button.dataset.next }) });
      notify('Event ' + button.dataset.status + ' is now ' + button.dataset.next + '.');
      await loadExpos();
      await loadExpoBar();
    }));
  });
}

$('expo-create').addEventListener('click', guard(async () => {
  const name = $('expo-name').value.trim();
  if (!name) return notify('Give the event a name.', 'error');
  const data = await api('/api/expo/expos/create', { method: 'POST', body: JSON.stringify({ name, start_date: $('expo-start').value || undefined, end_date: $('expo-end').value || undefined }) });
  $('expo-create-result').textContent = 'Created ' + data.expo_tag + ' — placeholder packages seeded; update their prices in the Packages tab.';
  ['expo-name', 'expo-start', 'expo-end'].forEach((id) => $(id).value = '');
  notify('Event ' + data.expo_tag + ' created (ACTIVE). The sign-up form still serves the soonest upcoming event until this one is next.');
  await loadExpos();
  await loadExpoBar();
}));
$('refresh-expos').addEventListener('click', guard(loadExpos));

// -------------------------------------------------------------- event bar

async function loadExpoBar() {
  exposCache = await api('/api/expo/expos');
  if (!exposCache.length) {
    $('expo-select').innerHTML = '<option value="">EXPO-2026 (default)</option>';
    currentExpoTag = null;
    renderKioskLink();
    return;
  }
  const saved = sessionStorage.getItem('wmit_expo_tag');
  const current = exposCache.find((event) => event.status === 'ACTIVE');
  const initial = saved && exposCache.some((event) => event.expo_tag === saved) ? saved : (current ? current.expo_tag : exposCache[0].expo_tag);
  currentExpoTag = initial;
  $('expo-select').innerHTML = exposCache.map((event) => {
    const label = event.name + (event.status === 'ENDED' ? ' — ended' : '') + (event.start_date ? ' · ' + event.start_date : '');
    return '<option value="' + esc(event.expo_tag) + '" ' + (event.expo_tag === initial ? 'selected' : '') + '>' + esc(label) + '</option>';
  }).join('');
  renderKioskLink();
}

function renderKioskLink() {
  const event = exposCache.find((candidate) => candidate.expo_tag === currentExpoTag);
  const active = !event || event.status === 'ACTIVE';
  const url = kioskUrl(currentExpoTag);
  $('expo-kiosk-url').innerHTML = active
    ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(url) + '</a>'
    : '<span class="ended-note">' + esc(event.name) + ' has ended — its sign-up form is closed. Browsing history.</span>';
  $('expo-kiosk-copy').disabled = !active;
}

$('expo-select').addEventListener('change', async () => {
  currentExpoTag = $('expo-select').value || null;
  sessionStorage.setItem('wmit_expo_tag', currentExpoTag || '');
  renderKioskLink();
  const activeTab = document.querySelector('.nav a[data-tab].active').dataset.tab;
  await guard(TAB_LOADERS[activeTab])();
  notify('Now viewing ' + (currentExpoTag || 'the current event') + '.');
});

$('expo-kiosk-copy').addEventListener('click', async () => {
  const url = kioskUrl(currentExpoTag);
  try {
    await navigator.clipboard.writeText(url);
    notify('Sign-up form link copied: ' + url);
  } catch (_) {
    window.prompt('Copy the sign-up form link:', url);
  }
});

window.wmitSearchResults = function (query) {
  const q = String(query || '').toLowerCase();
  const matches = (value) => value !== undefined && value !== null && String(value).toLowerCase().includes(q);
  const results = [];
  const openTab = (tab) => document.querySelector('.nav a[data-tab="' + tab + '"]').click();
  leadsCache.forEach((lead) => {
    if (matches(lead.name) || matches(lead.mobile) || matches(lead.email) || matches(lead.destination) || matches(lead.expo_lead_id)) {
      results.push({ title: lead.name || lead.expo_lead_id, subtitle: [lead.mobile, lead.destination, lead.expo_lead_id].filter(Boolean).join(' · '), kind: 'Lead', run: () => { openTab('leads'); const search = $('lead-search'); if (search) { search.value = lead.name || ''; search.dispatchEvent(new Event('input')); } } });
    }
  });
  quotesCache.forEach((quote) => {
    const name = quote.lead_snapshot && quote.lead_snapshot.name;
    if (matches(quote.expo_quote_id) || matches(name)) {
      results.push({ title: name || quote.expo_quote_id, subtitle: quote.expo_quote_id + ' · ' + quote.status, kind: 'Quote', run: () => openTab('quotes') });
    }
  });
  templatesCache.forEach((template) => {
    if (matches(template.name) || matches(template.destination)) {
      results.push({ title: template.name, subtitle: [template.destination, template.price_per_person + ' ' + template.currency].filter(Boolean).join(' · '), kind: 'Package', run: () => openTab('packages') });
    }
  });
  exposCache.forEach((expo) => {
    if (matches(expo.expo_tag) || matches(expo.name)) {
      results.push({ title: expo.name || expo.expo_tag, subtitle: expo.expo_tag + ' · ' + expo.status, kind: 'Event', run: () => openTab('expos') });
    }
  });
  return results;
};

// ------------------------------------------------------------------- boot

(async function boot() {
  try {
    await api('/api/auth/me');
  } catch (_) { /* login.html redirect already handled */ }
  await loadExpoBar();
  await guard(loadDashboard)();
  // Prime the tab caches so global search finds leads, quotes, and packages
  // without someone having opened those tabs first.
  loadLeads().catch(() => {});
  loadQuotes().catch(() => {});
  loadPackages().catch(() => {});
})();
