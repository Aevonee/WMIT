/**
 * Google Apps Script quotation workspace service.
 *
 * This is the Sheets-backed port of the local quotation editor contract. It
 * keeps supplier cost and client price separate and exposes only client-safe
 * fields from getClientQuotationPreview().
 */
function quotationList_(type) {
  initializeWmitWorkspace_();
  return WmitSheetServices['list' + type]().data || [];
}

function quotationGet_(type, id) {
  var result = WmitSheetServices['get' + type](id);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function quotationMoney_(value, field, allowZero) {
  var number = Number(value);
  if (!isFinite(number) || number < 0 || (!allowZero && number === 0)) throw new Error(field + ' must be a valid non-negative amount.');
  return number.toFixed(2);
}
function quotationRequired_(value, field) { if (value === undefined || value === null || String(value).trim() === '') throw new Error(field + ' is required.'); return value; }
function quotationDate_(value, field) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) || isNaN(Date.parse(value))) throw new Error(field + ' must be a valid date.'); }

function quotationDraft_(quotationId) {
  var quote = quotationGet_('Quotation', quotationId);
  if (String(quote.status || '').toUpperCase() !== 'DRAFT') throw new Error('Only a draft quotation can be edited before approval.');
  return quote;
}

function quotationItems_(quotationId) {
  return quotationList_('QuotationItem').filter(function (item) {
    return item.quotation_id === quotationId && item.removed !== true;
  }).sort(function (a, b) { return Number(a.line_order || 0) - Number(b.line_order || 0); });
}

function quotationTotals_(quote, items) {
  var cost = 0, selling = 0;
  (items || []).forEach(function (item) {
    var quantity = Number(item.quantity);
    if (!isFinite(quantity) || quantity <= 0) throw new Error('Quotation item quantity must be greater than zero.');
    var unitCost = Number(quotationMoney_(item.unit_cost, 'Unit cost', true));
    var unitSelling = Number(quotationMoney_(item.unit_selling_price, 'Selling price', true));
    if (unitSelling < unitCost) throw new Error('Selling price cannot be lower than supplier cost.');
    cost += unitCost * quantity;
    selling += unitSelling * quantity;
  });
  var fees = Number(quotationMoney_(quote.fees_total || 0, 'Fees', true));
  var tax = Number(quotationMoney_(quote.tax_total || 0, 'Taxes', true));
  var discount = Number(quotationMoney_(quote.discount_total || 0, 'Discount', true));
  var total = selling + fees + tax - discount;
  if (total < 0) throw new Error('Discount cannot make the client total negative.');
  return { supplier_cost_total: cost.toFixed(2), markup_total: (selling - cost).toFixed(2), client_total: total.toFixed(2) };
}

function getQuotationEditor_(quotationId) {
  try {
    var quotation = quotationGet_('Quotation', quotationId);
    var items = quotationItems_(quotationId);
    var client = quotation.client_id ? quotationGet_('Client', quotation.client_id) : null;
    var totals = items.length ? quotationTotals_(quotation, items) : {
      supplier_cost_total: quotation.supplier_cost_total,
      markup_total: quotation.markup_total,
      fees_total: quotation.fees_total,
      tax_total: quotation.tax_total,
      discount_total: quotation.discount_total,
      client_total: quotation.client_total
    };
    return { ok: true, data: { quotation: quotation, items: items, client: client, totals: totals }, meta: { action: 'GET_QUOTATION_EDITOR' } };
  } catch (error) { return { ok: false, error: { code: 'QUOTATION_EDITOR_ERROR', message: error.message } }; }
}

function getClientQuotationPreview_(quotationId) {
  try {
    var quotation = quotationGet_('Quotation', quotationId);
    var items = quotationItems_(quotationId);
    var client = quotation.client_id ? quotationGet_('Client', quotation.client_id) : null;
    var totals = items.length ? quotationTotals_(quotation, items) : { client_total: quotation.client_total, discount_total: quotation.discount_total, fees_total: quotation.fees_total, tax_total: quotation.tax_total };
    var days = [];
    if (quotation.itinerary) {
      try { days = Array.isArray(quotation.itinerary) ? quotation.itinerary : JSON.parse(String(quotation.itinerary)); } catch (_) { days = []; }
      if (!Array.isArray(days)) days = [];
    }
    return { ok: true, data: {
      brand: { name: 'World Master International Travel', short_name: 'WMIT' },
      client: client ? { name: client.display_name, email: client.primary_email, phone: client.primary_phone } : null,
      quotation: { quotation_date: quotation.quotation_date, valid_until: quotation.valid_until, destination: quotation.destination, travel_start: quotation.travel_start, travel_end: quotation.travel_end, pax_count: quotation.pax_count, currency: quotation.currency, inclusions: quotation.inclusions, exclusions: quotation.exclusions, payment_terms: quotation.payment_terms, client_notes: quotation.client_notes, itinerary_days: days, client_total: totals.client_total, discount_total: totals.discount_total, fees_total: totals.fees_total, tax_total: totals.tax_total },
      items: items.map(function (item) { return { service_type: item.service_type, description: item.description, quantity: item.quantity, unit_price: item.unit_selling_price, amount: (Number(item.quantity) * Number(item.unit_selling_price)).toFixed(2), currency: item.currency, service_start: item.service_start, service_end: item.service_end, notes: item.client_notes || null }; })
    }, meta: { action: 'GET_CLIENT_QUOTATION_PREVIEW' } };
  } catch (error) { return { ok: false, error: { code: 'QUOTATION_PREVIEW_ERROR', message: error.message } }; }
}

function updateQuotation_(input) {
  try {
    var value = input || {}; var quote = quotationDraft_(value.quotation_id); var allowed = ['quotation_date', 'valid_until', 'destination', 'travel_start', 'travel_end', 'pax_count', 'inclusions', 'exclusions', 'payment_terms', 'payment_currency_policy', 'itinerary', 'client_notes', 'internal_notes', 'notes']; var changes = {};
    allowed.forEach(function (field) { if (value[field] !== undefined) changes[field] = value[field]; });
    if (!String(changes.destination === undefined ? quote.destination : changes.destination).trim()) throw new Error('Destination is required before saving a quotation.');
    if (changes.quotation_date) quotationDate_(changes.quotation_date, 'Quotation date');
    if (changes.valid_until) quotationDate_(changes.valid_until, 'Valid until');
    return WmitSheetServices.updateQuotation(quote.quotation_id, changes, { actor: wmitWebActor_() });
  } catch (error) { return { ok: false, error: { code: 'QUOTATION_UPDATE_INVALID', message: error.message } }; }
}

function createQuotationItem_(input) {
  try {
    var value = input || {}; var quote = quotationDraft_(value.quotation_id); var currency = String(value.currency || quote.currency || '').toUpperCase();
    if (currency !== String(quote.currency || '').toUpperCase()) throw new Error('Every quotation item must use the quotation currency.');
    if (value.supplier_id) quotationGet_('Supplier', value.supplier_id);
    quotationRequired_(value.service_type, 'Service type'); quotationRequired_(value.description, 'Description');
    var item = Object.assign({}, value, { currency: currency, quantity: Number(value.quantity), unit_cost: quotationMoney_(value.unit_cost, 'Unit cost', true), unit_selling_price: quotationMoney_(value.unit_selling_price, 'Selling price', true), line_order: value.line_order || quotationItems_(quote.quotation_id).length + 1 });
    var totals = quotationTotals_(quote, quotationItems_(quote.quotation_id).concat([item]));
    var created = WmitSheetServices.createQuotationItem(item, { actor: wmitWebActor_() }); if (!created.ok) return created;
    var updated = WmitSheetServices.updateQuotation(quote.quotation_id, totals, { actor: wmitWebActor_() });
    return updated.ok ? { ok: true, data: { item: created.data, quotation: updated.data }, meta: { action: 'CREATE_QUOTATION_ITEM' } } : updated;
  } catch (error) { return { ok: false, error: { code: 'QUOTATION_ITEM_INVALID', message: error.message } }; }
}

function updateQuotationItem_(input) {
  try {
    var value = input || {}; var current = quotationGet_('QuotationItem', value.quotation_item_id); var quote = quotationDraft_(current.quotation_id); var allowed = ['service_type', 'description', 'supplier_id', 'quantity', 'unit_cost', 'unit_selling_price', 'currency', 'line_order', 'service_start', 'service_end', 'notes', 'client_notes']; var changes = {};
    allowed.forEach(function (field) { if (value[field] !== undefined) changes[field] = value[field]; });
    if (changes.supplier_id) quotationGet_('Supplier', changes.supplier_id);
    if (changes.currency && String(changes.currency).toUpperCase() !== String(quote.currency).toUpperCase()) throw new Error('Every quotation item must use the quotation currency.');
    if (changes.quantity !== undefined) changes.quantity = Number(changes.quantity);
    if (changes.unit_cost !== undefined) changes.unit_cost = quotationMoney_(changes.unit_cost, 'Unit cost', true);
    if (changes.unit_selling_price !== undefined) changes.unit_selling_price = quotationMoney_(changes.unit_selling_price, 'Selling price', true);
    var proposed = quotationItems_(quote.quotation_id).map(function (item) { return item.quotation_item_id === current.quotation_item_id ? Object.assign({}, item, changes) : item; }); var totals = quotationTotals_(quote, proposed);
    var updatedItem = WmitSheetServices.updateQuotationItem(current.quotation_item_id, changes, { actor: wmitWebActor_() }); if (!updatedItem.ok) return updatedItem;
    var updatedQuote = WmitSheetServices.updateQuotation(quote.quotation_id, totals, { actor: wmitWebActor_() });
    return updatedQuote.ok ? { ok: true, data: { item: updatedItem.data, quotation: updatedQuote.data }, meta: { action: 'UPDATE_QUOTATION_ITEM' } } : updatedQuote;
  } catch (error) { return { ok: false, error: { code: 'QUOTATION_ITEM_UPDATE_INVALID', message: error.message } }; }
}

function removeQuotationItem_(input) {
  try {
    var current = quotationGet_('QuotationItem', input && input.quotation_item_id); var quote = quotationDraft_(current.quotation_id);
    var updated = WmitSheetServices.updateQuotationItem(current.quotation_item_id, { removed: true, removed_at: wmitNow_(), removed_by: wmitWebActor_() }, { actor: wmitWebActor_() });
    return updated.ok ? { ok: true, data: { removed: updated.data, quotation: quote }, meta: { action: 'REMOVE_QUOTATION_ITEM' } } : updated;
  } catch (error) { return { ok: false, error: { code: 'QUOTATION_ITEM_REMOVE_INVALID', message: error.message } }; }
}

function reorderQuotationItems_(input) {
  try {
    var quote = quotationDraft_(input && input.quotation_id); var items = quotationItems_(quote.quotation_id); var ids = input.quotation_item_ids || [];
    if (ids.length !== items.length || ids.some(function (id) { return !items.some(function (item) { return item.quotation_item_id === id; }); })) throw new Error('The quotation item order must contain each item exactly once.');
    ids.forEach(function (id, index) { WmitSheetServices.updateQuotationItem(id, { line_order: index + 1 }, { actor: wmitWebActor_() }); });
    return getQuotationEditor_(quote.quotation_id);
  } catch (error) { return { ok: false, error: { code: 'QUOTATION_ITEM_ORDER_INVALID', message: error.message } }; }
}

function preparePaymentConversion_(input) { return WmitPaymentConversion.preparePayment(input); }
