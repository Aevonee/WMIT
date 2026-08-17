/**
 * Review-gated source-document services.
 *
 * This records staff interpretation of a source document. It does not create
 * trusted tariff rates or make a document quotable. A separate extraction and
 * tariff-import step must still create validated TariffSource and
 * TariffRateComponent records.
 */
var WmitReviewServices = (function () {
  var RATE_UNITS = [
    'PER_PERSON', 'PER_PERSON_PER_NIGHT', 'PER_PERSON_PER_WAY',
    'PER_ROOM', 'PER_ROOM_PER_NIGHT', 'PER_NIGHT',
    'PER_VEHICLE', 'PER_VEHICLE_PER_WAY',
    'PER_GROUP', 'PER_GROUP_PER_DAY', 'PER_SERVICE',
    'OTHER_SUPPLIER_SPECIFIED'
  ];

  function actor_(context) { return context && context.actor || 'WORKSPACE_STAFF'; }
  function require_(value, name) {
    if (value === undefined || value === null || String(value).trim() === '') throw new Error(name + ' is required.');
    return value;
  }
  function document_(id) {
    var result = WmitSheetServices.getDocument(String(id));
    if (!result || result.ok === false || !result.data) throw new Error('Document ' + id + ' was not found.');
    return result.data;
  }
  function supplier_(id) {
    var result = WmitSheetServices.getSupplier(String(id));
    if (!result || result.ok === false || !result.data) throw new Error('The selected supplier does not exist.');
    return result.data;
  }
  function allowedUnit_(value) {
    var unit = String(value || '').toUpperCase();
    if (RATE_UNITS.indexOf(unit) < 0) throw new Error('The selected rate unit is not in the approved WMIT unit model.');
    return unit;
  }

  function getReviewQueue() {
    return WmitSheetServices.listDocument().data.filter(function (item) {
      return item.review_status !== 'CONFIRMED' || item.extraction_status !== 'REVIEWED';
    }).sort(function (left, right) { return String(right.created_at || '').localeCompare(String(left.created_at || '')); });
  }

  function reviewDocument(input, context) {
    var value = input || {};
    var documentId = require_(value.document_id, 'document_id');
    var current = document_(documentId);
    if (current.source_type !== 'TARIFF' && current.source_type !== 'PACKAGE' && current.source_type !== 'LAND_ARRANGEMENT') {
      throw new Error('Only tariff and package source documents can receive tariff interpretation review.');
    }
    var supplierId = value.supplier_id || current.supplier_id;
    var supplier = supplierId ? supplier_(supplierId) : null;
    var currency = String(value.currency || '').trim().toUpperCase();
    var rateUnit = allowedUnit_(value.rate_unit);
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Currency must be a three-letter ISO-style code, for example USD.');

    var interpretation = {
      supplier_id: supplier ? supplier.supplier_id : null,
      supplier_name: supplier ? (supplier.display_name || supplier.legal_name || supplier.supplier_id) : null,
      currency: currency,
      rate_unit: rateUnit,
      validity_start: value.validity_start || null,
      validity_end: value.validity_end || null,
      interpretation_notes: String(value.interpretation_notes || '').trim(),
      confirmed_at: wmitNow_(),
      confirmed_by: actor_(context)
    };
    if (!interpretation.interpretation_notes) throw new Error('Interpretation notes are required before confirmation.');
    if (interpretation.validity_start && interpretation.validity_end && interpretation.validity_start > interpretation.validity_end) throw new Error('Validity start cannot be after validity end.');

    return WmitSheetServices.updateDocument(documentId, {
      supplier_id: supplier ? supplier.supplier_id : null,
      source_name: supplier ? (supplier.display_name || supplier.legal_name || supplier.supplier_id) : current.source_name,
      interpretation: interpretation,
      review_status: 'CONFIRMED',
      interpretation_status: 'CONFIRMED',
      extraction_status: 'NOT_STARTED',
      status: 'NEEDS_EXTRACTION',
      trusted_for_quoting: false,
      review_note: 'Interpretation confirmed. Tariff extraction/import is still required before quoting.'
    }, { actor: actor_(context) });
  }

  return {
    getReviewQueue: getReviewQueue,
    reviewDocument: reviewDocument,
    getRateUnits: function () { return RATE_UNITS.slice(); }
  };
}());

function getWmitReviewQueue_() {
  initializeWmitWorkspace_();
  return { ok: true, data: WmitReviewServices.getReviewQueue(), meta: { action: 'GET_REVIEW_QUEUE' } };
}

function reviewWmitSourceDocument_(input, context) {
  initializeWmitWorkspace_();
  return WmitReviewServices.reviewDocument(input, context);
}
