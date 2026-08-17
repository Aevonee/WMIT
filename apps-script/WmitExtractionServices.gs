/**
 * Review-gated source extraction.
 *
 * PDF/office conversion uses the optional Google Drive advanced service and
 * creates a retained OCR working document under WMIT/Extraction Working Files.
 * The parser produces candidates and facts only. It never marks a tariff
 * trusted without explicit staff confirmation.
 */
var WmitExtractionServices = (function () {
  var SUPPORTED_SOURCE_TYPES = { TARIFF: true, PACKAGE: true, LAND_ARRANGEMENT: true };
  var CURRENCY_CODES = ['USD', 'EUR', 'PHP', 'GBP', 'JPY', 'THB', 'SGD', 'HKD', 'AUD', 'CAD', 'CNY', 'KRW', 'AED', 'CHF', 'INR', 'IDR', 'MYR', 'VND'];
  var RATE_UNIT_RULES = [
    [/\bper\s*(person|pax)\s*per\s*night\b|\bper\s*pax\s*\/\s*night\b/i, 'PER_PERSON_PER_NIGHT'],
    [/\bper\s*(person|pax)\s*per\s*way\b|\bper\s*pax\s*\/\s*way\b/i, 'PER_PERSON_PER_WAY'],
    [/\bper\s*(person|pax)\b(?!\s*per\s*(night|way)\b)|\bp\.p\.\b/i, 'PER_PERSON'],
    [/\bper\s*room\s*per\s*night\b/i, 'PER_ROOM_PER_NIGHT'],
    [/\bper\s*room\b/i, 'PER_ROOM'],
    [/\bper\s*night\b/i, 'PER_NIGHT'],
    [/\bper\s*vehicle\s*per\s*way\b/i, 'PER_VEHICLE_PER_WAY'],
    [/\bper\s*vehicle\b/i, 'PER_VEHICLE'],
    [/\bper\s*group\s*per\s*day\b/i, 'PER_GROUP_PER_DAY'],
    [/\bper\s*group\b/i, 'PER_GROUP'],
    [/\bper\s*service\b/i, 'PER_SERVICE']
  ];

  function actor_(context) { return context && context.actor || 'WORKSPACE_STAFF'; }
  function document_(id) {
    var result = WmitSheetServices.getDocument(String(id));
    if (!result || result.ok === false || !result.data) throw new Error('Document ' + id + ' was not found.');
    return result.data;
  }
  function source_(id) {
    var result = WmitSheetServices.getTariffSource(String(id));
    if (!result || result.ok === false || !result.data) throw new Error('Tariff source ' + id + ' was not found.');
    return result.data;
  }
  function workingFolder_() {
    var rootId = PropertiesService.getScriptProperties().getProperty(WMIT_WORKSPACE.propertyRootFolderId);
    if (!rootId) throw new Error('WMIT Workspace is not initialized.');
    var root = DriveApp.getFolderById(rootId); var folders = root.getFoldersByName('Extraction Working Files');
    return folders.hasNext() ? folders.next() : root.createFolder('Extraction Working Files');
  }
  function exportGoogleText_(fileId) {
    if (typeof Drive === 'undefined' || !Drive.Files || !Drive.Files.export) throw new Error('The Advanced Drive service is required to export Google Docs text.');
    var exported = Drive.Files.export(fileId, 'text/plain', { alt: 'media' });
    if (exported && typeof exported.getDataAsString === 'function') return exported.getDataAsString();
    if (typeof exported === 'string') return exported;
    return String(exported || '');
  }
  function unique_(values) { return values.filter(function (value, index, list) { return value && list.indexOf(value) === index; }); }
  function currencies_(text) {
    var found = [];
    CURRENCY_CODES.forEach(function (code) { if (new RegExp('\\b' + code + '\\b', 'i').test(text)) found.push(code); });
    return found;
  }
  function units_(text) {
    return unique_(RATE_UNIT_RULES.filter(function (rule) { return rule[0].test(text); }).map(function (rule) { return rule[1]; }));
  }
  function amount_(value) {
    var clean = String(value || '').replace(/,/g, ''); var number = Number(clean);
    return isFinite(number) && number > 0 ? number : null;
  }
  function rateCandidates_(lines) {
    var candidates = [];
    lines.forEach(function (line, index) {
      var currencyMatches = line.match(new RegExp('\\b(?:' + CURRENCY_CODES.join('|') + ')\\b', 'ig')) || [];
      var amountMatches = line.match(/\b\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\b|\b\d+(?:\.\d{1,2})?\b/g) || [];
      var relevant = currencyMatches.length || /\b(?:rate|price|cost|package|pax|person|room|night|vehicle)\b/i.test(line);
      if (!relevant || !amountMatches.length) return;
      var parsed = amount_(amountMatches[amountMatches.length - 1]); if (parsed === null) return;
      candidates.push({
        raw_source_line: line,
        source_location: 'OCR text line ' + (index + 1),
        amount: parsed,
        currency: currencyMatches.length === 1 ? String(currencyMatches[0]).toUpperCase() : null,
        rate_unit: units_(line).length === 1 ? units_(line)[0] : null,
        requires_explicit_review: true,
        review_status: 'NEEDS_REVIEW'
      });
    });
    return candidates.slice(0, 500);
  }
  function parse_(text, method) {
    var value = String(text || ''); var lines = value.split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean);
    var currencies = currencies_(value); var units = units_(value); var candidates = rateCandidates_(lines); var warnings = [];
    if (!value.trim()) warnings.push('No text was extracted from the source.');
    if (!currencies.length) warnings.push('No supported currency code was found.');
    if (currencies.length > 1) warnings.push('Multiple currencies were found; staff must confirm the tariff currency.');
    if (!units.length) warnings.push('No supported rate unit wording was found.');
    if (units.length > 1) warnings.push('Multiple rate units were found; staff must confirm the tariff rate basis.');
    if (!candidates.length) warnings.push('No reviewable rate candidates were found.');
    if (candidates.length >= 500) warnings.push('Rate candidates were capped at 500; source requires structured review.');
    return {
      extraction_method: method,
      extracted_at: wmitNow_(),
      text_length: value.length,
      line_count: lines.length,
      currency_candidates: currencies,
      rate_unit_candidates: units,
      rate_candidate_count: candidates.length,
      itinerary_component_count: 0,
      warnings: warnings,
      requires_staff_review: true,
      raw_preview: value.slice(0, 4000),
      rate_candidates: candidates
    };
  }
  function readSourceText_(document) {
    var file = DriveApp.getFileById(document.file_id); var blob = file.getBlob();
    var fileMime = file.getMimeType() || document.mime_type || blob.getContentType() || '';
    if (fileMime === 'application/vnd.google-apps.document') {
      return { text: exportGoogleText_(document.file_id), method: 'DRIVE_DOCUMENT' };
    }
    if (fileMime === 'application/vnd.google-apps.spreadsheet') {
      if (typeof SpreadsheetApp === 'undefined') throw new Error('Reading Google Sheets requires the Google Sheets service scope.');
      var spreadsheet = SpreadsheetApp.openById(document.file_id);
      var rows = [];
      spreadsheet.getSheets().forEach(function (sheet) {
        var values = sheet.getDataRange().getDisplayValues();
        rows.push('SHEET: ' + sheet.getName());
        values.forEach(function (row) { rows.push(row.join('\t')); });
      });
      return { text: rows.join('\n'), method: 'DRIVE_SPREADSHEET' };
    }
    if (/^(text\/plain|text\/csv|text\/tab-separated-values)$/i.test(document.mime_type || blob.getContentType() || '') || /\.(txt|csv|tsv)$/i.test(document.file_name || '')) {
      return { text: blob.getDataAsString(), method: 'DRIVE_TEXT' };
    }
    if (typeof Drive === 'undefined' || !Drive.Files || !Drive.Files.insert) {
      throw new Error('PDF/office extraction requires the Google Drive advanced service. Enable Drive API under Services, save, and retry.');
    }
    // Do not declare the upload as a Google Doc. Drive's OCR flag applies to
    // image/PDF uploads; declaring a Google Docs MIME type makes Drive reject
    // the request with an "OCR is not supported for Google Docs" error.
    // `convert:true` converts the source into a Docs document.
    var canOcr = fileMime === 'application/pdf' || /^image\/(png|jpe?g|gif|tiff?|bmp)$/i.test(fileMime);
    var conversionOptions = { convert: true, ocr: canOcr };
    if (canOcr) conversionOptions.ocrLanguage = 'en';
    var ocrFile = Drive.Files.insert({ title: 'WMIT OCR - ' + document.file_name, parents: [{ id: workingFolder_().getId() }], description: 'WMIT retained OCR working copy for ' + document.document_id }, blob, conversionOptions);
    var text = exportGoogleText_(ocrFile.id);
    return { text: text, method: 'DRIVE_OCR', extraction_file_id: ocrFile.id, extraction_file_url: DriveApp.getFileById(ocrFile.id).getUrl() };
  }
  function fact_(sourceId, documentId, field, raw, normalized, candidates, summary) {
    return {
      tariff_source_id: sourceId, document_id: documentId, field_name: field,
      raw_value: raw || null, normalized_value: normalized || null, candidates: candidates || [],
      confidence: normalized && candidates && candidates.length === 1 ? 0.65 : 0,
      ambiguous: !normalized || (candidates && candidates.length !== 1), review_status: 'NEEDS_REVIEW',
      source_location: 'OCR/text extraction summary', extraction_method: summary.extraction_method
    };
  }
  function extractDocument(input, context) {
    var value = input || {}; var documentId = String(value.document_id || ''); if (!documentId) throw new Error('document_id is required.');
    var document = document_(documentId);
    if (!SUPPORTED_SOURCE_TYPES[document.source_type]) throw new Error('Only supplier tariff, package, and DMC land-arrangement sources can be extracted.');
    if (document.extraction_status === 'EXTRACTED' && document.tariff_source_id) return { ok: true, data: document, meta: { action: 'EXTRACT_SOURCE_DOCUMENT', idempotent: true } };
    var parsed;
    try {
      var sourceText = readSourceText_(document); parsed = parse_(sourceText.text, sourceText.method); parsed.extraction_file_id = sourceText.extraction_file_id || null; parsed.extraction_file_url = sourceText.extraction_file_url || null;
      var extractionKey = 'EXTRACT-' + document.document_id;
      var priorSource = WmitSheetServices.listTariffSource().data.filter(function (item) { return item.idempotency_key === extractionKey; })[0];
      if (priorSource) throw new Error('A previous extraction created staged tariff records for this document. Review the existing staged records before retrying.');
      var source = WmitSheetServices.createTariffSource({
        document_id: document.document_id, supplier_id: document.supplier_id, source_type: document.source_type,
        source_name: document.source_name, status: 'NEEDS_REVIEW', trusted: false, extraction_summary: parsed,
        original_source: { file_name: document.file_name, file_id: document.file_id, file_url: document.file_url },
        idempotency_key: extractionKey
      }, { actor: actor_(context) }).data;
      var currency = parsed.currency_candidates.length === 1 ? parsed.currency_candidates[0] : null;
      var unit = parsed.rate_unit_candidates.length === 1 ? parsed.rate_unit_candidates[0] : null;
      var facts = [fact_(source.tariff_source_id, document.document_id, 'currency', currency, currency, parsed.currency_candidates, parsed), fact_(source.tariff_source_id, document.document_id, 'rate_unit', unit, unit, parsed.rate_unit_candidates, parsed)];
      facts.forEach(function (fact) { WmitSheetServices.createTariffExtractionFact(fact, { actor: actor_(context) }); });
      parsed.rate_candidates.forEach(function (candidate) {
        WmitSheetServices.createTariffRateComponent(Object.assign({}, candidate, { tariff_source_id: source.tariff_source_id, document_id: document.document_id, currency_status: candidate.currency ? 'NEEDS_REVIEW' : 'MISSING', rate_unit_status: candidate.rate_unit ? 'NEEDS_REVIEW' : 'MISSING' }), { actor: actor_(context) });
      });
      var updated = WmitSheetServices.updateDocument(document.document_id, { tariff_source_id: source.tariff_source_id, extraction_summary: parsed, extraction_status: 'EXTRACTED', extraction_method: parsed.extraction_method, extraction_file_id: parsed.extraction_file_id, extraction_file_url: parsed.extraction_file_url, extraction_error: null, interpretation_status: document.interpretation_status || 'PENDING', status: 'NEEDS_REVIEW', trusted_for_quoting: false }, { actor: actor_(context) });
      return { ok: true, data: { document: updated.data, tariff_source: source, extraction_summary: parsed, facts: facts, rate_candidate_count: parsed.rate_candidate_count }, meta: { action: 'EXTRACT_SOURCE_DOCUMENT', review_required: true } };
    } catch (error) {
      WmitSheetServices.updateDocument(document.document_id, { extraction_status: 'FAILED', extraction_error: error.message || String(error), status: 'NEEDS_REVIEW', trusted_for_quoting: false }, { actor: actor_(context) });
      throw error;
    }
  }
  function activateTariff(input, context) {
    var value = input || {}; var document = document_(value.document_id); if (document.extraction_status !== 'EXTRACTED') throw new Error('Extract the source before activation.');
    if (document.interpretation_status !== 'CONFIRMED' || !document.interpretation) throw new Error('Confirm the source interpretation before activation.');
    if (value.confirm_extraction !== true) throw new Error('Confirm that you reviewed the extraction summary before activation.');
    if (String(value.activation_notes || '').trim() === '') throw new Error('Activation notes are required.');
    var tariff = source_(document.tariff_source_id); var rates = WmitSheetServices.listTariffRateComponent().data.filter(function (rate) { return rate.tariff_source_id === tariff.tariff_source_id; });
    if (!rates.length) throw new Error('No extracted rate candidates are available for activation.');
    var currency = document.interpretation.currency; var unit = document.interpretation.rate_unit;
    if (!currency || !unit) throw new Error('Currency and rate basis must be confirmed before activation.');
    rates.forEach(function (rate) {
      if (!(Number(rate.amount) > 0)) throw new Error('An extracted rate amount is invalid; activation is blocked.');
      WmitSheetServices.updateTariffRateComponent(rate.tariff_rate_component_id, { currency: currency, currency_status: 'CONFIRMED', rate_unit: unit, rate_unit_status: 'CONFIRMED', requires_explicit_review: false, review_status: 'CONFIRMED', activation_notes: String(value.activation_notes).trim() }, { actor: actor_(context) });
    });
    var updatedSource = WmitSheetServices.updateTariffSource(tariff.tariff_source_id, { status: 'ACTIVE', trusted: true, trusted_for_quoting: true, reviewed_at: wmitNow_(), reviewed_by: actor_(context), activation_notes: String(value.activation_notes).trim() }, { actor: actor_(context) });
    var updatedDocument = WmitSheetServices.updateDocument(document.document_id, { status: 'ACTIVE', trusted_for_quoting: true, activation_status: 'ACTIVE' }, { actor: actor_(context) });
    return { ok: true, data: { document: updatedDocument.data, tariff_source: updatedSource.data, rate_count: rates.length }, meta: { action: 'ACTIVATE_TARIFF', trusted: true } };
  }
  return { extractDocument: extractDocument, activateTariff: activateTariff };
}());

function extractWmitSourceDocument_(input, context) { initializeWmitWorkspace_(); return WmitExtractionServices.extractDocument(input, context); }
function activateWmitTariff_(input, context) { initializeWmitWorkspace_(); return WmitExtractionServices.activateTariff(input, context); }
