/** Public, client-safe entry points. No internal session is required here. */
var WmitPublicServices = (function () {
  // Best-effort intake rate limiting: per-email cooldown plus a global
  // windowed cap. Failed validations never consume the cooldown; only a
  // successfully created request does. CacheService always exists in Apps
  // Script; local tests may omit it, in which case limiting is skipped.
  function rateCache_() {
    return (typeof CacheService !== 'undefined' && CacheService.getScriptCache) ? CacheService.getScriptCache() : null;
  }
  function checkRateLimit_(value) {
    var cache = rateCache_();
    if (!cache) return;
    var email = String((value && (value.email || value.primary_email)) || '').toLowerCase();
    if (email && cache.get('WMIT_PUBLIC_REQ_' + email)) throw new Error('Please wait a minute before submitting another quote request.');
    if (Number(cache.get('WMIT_PUBLIC_REQ_GLOBAL') || 0) >= 30) throw new Error('The request form is busy right now. Please try again shortly.');
  }
  function consumeRateLimit_(value) {
    var cache = rateCache_();
    if (!cache) return;
    var email = String((value && (value.email || value.primary_email)) || '').toLowerCase();
    if (email) cache.put('WMIT_PUBLIC_REQ_' + email, '1', 60);
    cache.put('WMIT_PUBLIC_REQ_GLOBAL', String(Number(cache.get('WMIT_PUBLIC_REQ_GLOBAL') || 0) + 1), 600);
  }
  function list_(type) { return WmitSheetServices['list' + type]().data || []; }
  function create_(type, input, context) { return WmitSheetServices['create' + type](input, context); }
  function update_(type, id, changes, context) { return WmitSheetServices['update' + type](id, changes, context); }
  function required_(value, field) { if (value === undefined || value === null || String(value).trim() === '') throw new Error(field + ' is required.'); return String(value).trim(); }
  function email_(value) { var email = required_(value, 'Email').toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email address.'); return email; }
  function tokenHash_(token) { var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token), Utilities.Charset.UTF_8); return Utilities.base64Encode(bytes); }
  function token_() { return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); }
  function baseUrl_() { try { return ScriptApp.getService().getUrl() || ''; } catch (_) { return ''; } }
  function safeClient_(client) { return client ? { name: client.display_name || null, email: client.primary_email || null, phone: client.primary_phone || null } : null; }
  function request(input) {
    try {
      initializeWmitWorkspace_();
      var value = input || {}, name = required_(value.name || value.display_name, 'Name'), email = email_(value.email || value.primary_email), destination = required_(value.destination, 'Destination');
      var idempotency = String(value.idempotency_key || '').trim();
      if (idempotency) { var prior = list_('Inquiry').filter(function (inquiry) { return inquiry.public_idempotency_key === idempotency; })[0]; if (prior) return { ok: true, data: { inquiry_id: prior.inquiry_id, status: 'RECEIVED' }, meta: { action: 'PUBLIC_QUOTE_REQUEST', idempotent: true } }; }
      checkRateLimit_(value);
      var requirements = {
        destination: destination, travel_start: value.travel_start || null, travel_end: value.travel_end || null, travel_month: value.travel_month || null, travel_year: value.travel_year || null, duration_days: value.duration_days || null,
        adults: value.adults, seniors: value.seniors, children: value.children, infants: value.infants, child_ages: value.child_ages || [], flexible_dates: Boolean(value.flexible_dates), budget_per_person: value.budget_per_person || null, preferred_hotel_category: value.preferred_hotel_category || null, travel_purpose: value.travel_purpose || null, special_requests: value.special_requests || null, notes: value.notes || null
      };
      var clientResult = WmitOperationsServices.createClient({ display_name: name, legal_name: name, primary_email: email, primary_phone: value.phone || null, viber_whatsapp: value.viber_whatsapp || null, status: 'ACTIVE' }, { actor: 'PUBLIC_REQUEST' });
      if (!clientResult.ok) return clientResult;
      var inquiryResult = WmitOperationsServices.createInquiry({ client_id: clientResult.data.client_id, sales_path: 'CUSTOM_QUOTE', requirements: requirements, original_request_raw: { name: name, email: email, destination: destination, travel_start: value.travel_start || null, travel_end: value.travel_end || null, travel_month: value.travel_month || null, travel_year: value.travel_year || null, duration_days: value.duration_days || null, adults: value.adults, seniors: value.seniors, children: value.children, infants: value.infants, child_ages: value.child_ages || [], flexible_dates: Boolean(value.flexible_dates), budget_per_person: value.budget_per_person || null, preferred_hotel_category: value.preferred_hotel_category || null, travel_purpose: value.travel_purpose || null, special_requests: value.special_requests || null, notes: value.notes || null }, public_channel: 'CUSTOM_QUOTE_REQUEST', public_idempotency_key: idempotency || null }, { actor: 'PUBLIC_REQUEST' });
      if (!inquiryResult.ok) return inquiryResult;
      var taskResult = WmitOperationsServices.createTask({ client_id: clientResult.data.client_id, inquiry_id: inquiryResult.data.inquiry_id, title: 'Review custom quote request', description: 'Review and follow up on the new public custom quote request.', priority: 'NORMAL', state: 'OPEN' }, { actor: 'PUBLIC_REQUEST' });
      consumeRateLimit_(value);
      return { ok: true, data: { inquiry_id: inquiryResult.data.inquiry_id, status: 'RECEIVED', task_created: Boolean(taskResult.ok) }, meta: { action: 'PUBLIC_QUOTE_REQUEST' } };
    } catch (error) { return { ok: false, error: { code: 'PUBLIC_REQUEST_INVALID', message: error.message } }; }
  }
  function createQuotationLink(quotationId, context) {
    try {
      initializeWmitWorkspace_();
      var quoteResult = WmitSheetServices.getQuotation(quotationId); if (!quoteResult.ok) throw new Error(quoteResult.error.message); var quote = quoteResult.data;
      if (String(quote.status || '').toUpperCase() !== 'APPROVED') throw new Error('Only an approved quotation can receive a public link.');
      var token = token_(); var updated = update_('Quotation', quote.quotation_id, { public_quote_enabled: true, public_quote_token_hash: tokenHash_(token), public_quote_issued_at: wmitNow_(), public_quote_url_hint: '?view=quotation' }, context); if (!updated.ok) return updated;
      return { ok: true, data: { quotation_id: quote.quotation_id, url: baseUrl_() + '?view=quotation&token=' + encodeURIComponent(token), token: token }, meta: { action: 'CREATE_PUBLIC_QUOTATION_LINK' } };
    } catch (error) { return { ok: false, error: { code: 'PUBLIC_QUOTATION_LINK_INVALID', message: error.message } }; }
  }
  function getQuotation(token) {
    try {
      initializeWmitWorkspace_(); var value = required_(token, 'Public quotation token'), quote = list_('Quotation').filter(function (item) { return item.public_quote_enabled === true && item.public_quote_token_hash === tokenHash_(value) && String(item.status || '').toUpperCase() === 'APPROVED'; })[0]; if (!quote) throw new Error('This quotation link is invalid or has expired.');
      var preview = getClientQuotationPreview_(quote.quotation_id); if (!preview.ok) return preview; return preview;
    } catch (error) { return { ok: false, error: { code: 'PUBLIC_QUOTATION_NOT_FOUND', message: error.message } }; }
  }
  function acceptQuotation(token, input) {
    try {
      var value = required_(token, 'Public quotation token'), quote = list_('Quotation').filter(function (item) { return item.public_quote_enabled === true && item.public_quote_token_hash === tokenHash_(value) && String(item.status || '').toUpperCase() === 'APPROVED'; })[0]; if (!quote) throw new Error('This quotation link is invalid or has expired.');
      return WmitBookingServices.recordQuotationAcceptance({ quotation_id: quote.quotation_id, accepted_by: required_(input && input.accepted_by, 'Name'), acceptance_method: 'PUBLIC_QUOTATION' }, { actor: 'PUBLIC_CLIENT' });
    } catch (error) { return { ok: false, error: { code: 'PUBLIC_QUOTATION_ACCEPTANCE_INVALID', message: error.message } }; }
  }
  return { request: request, createQuotationLink: createQuotationLink, getQuotation: getQuotation, acceptQuotation: acceptQuotation };
}());
