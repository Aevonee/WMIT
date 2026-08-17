/**
 * Controlled source-document upload boundary.
 *
 * Drive stores the original evidence. The linked Document Sheet record stores
 * the authoritative metadata, provenance, review state, and stable link.
 * Extraction and business matching remain separate review-gated operations.
 */
var WmitDriveServices = (function () {
  var FOLDERS = { TARIFF: 'Tariff Sources', PACKAGE: 'Package Sources', LAND_ARRANGEMENT: 'Land Arrangement Sources', SUPPORTING: 'Supporting Documents' };
  var ALLOWED_TYPES = { TARIFF: true, PACKAGE: true, LAND_ARRANGEMENT: true, SUPPORTING: true };
  var MAX_BYTES = 8 * 1024 * 1024;

  function properties_() { return PropertiesService.getScriptProperties(); }
  function root_() {
    var id = properties_().getProperty(WMIT_WORKSPACE.propertyRootFolderId);
    if (!id) throw new Error('WMIT Workspace is not initialized. Run the workspace setup first.');
    return DriveApp.getFolderById(id);
  }
  function folder_(sourceType) {
    var root = root_(); var name = FOLDERS[sourceType]; var matches = root.getFoldersByName(name); var found = [];
    while (matches.hasNext()) found.push(matches.next());
    if (found.length > 1) throw new Error('Multiple WMIT source folders named "' + name + '" exist.');
    return found.length ? found[0] : root.createFolder(name);
  }
  function safeName_(name) {
    var value = String(name || '').replace(/[^A-Za-z0-9._() -]/g, '_').replace(/\s+/g, ' ').trim();
    if (!value) throw new Error('A source document filename is required.');
    return value.slice(0, 160);
  }
  function checksum_(bytes) {
    return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(function (value) {
      var hex = (value < 0 ? value + 256 : value).toString(16); return hex.length === 1 ? '0' + hex : hex;
    }).join('');
  }
  function actor_(context) { return context && context.actor || 'WORKSPACE_STAFF'; }

  function supplierForUpload_(sourceType, supplierId) {
    if (sourceType !== 'TARIFF' && sourceType !== 'PACKAGE' && sourceType !== 'LAND_ARRANGEMENT') return null;
    if (!supplierId || String(supplierId).trim() === '') {
      throw new Error('A supplier must be selected for tariff and package sources.');
    }
    var result = WmitSheetServices.getSupplier(String(supplierId));
    if (!result || result.ok === false || !result.data) {
      throw new Error('The selected supplier does not exist in the WMIT Workspace.');
    }
    return result.data;
  }

  function uploadSourceDocument(input, context) {
    var value = input || {}; var sourceType = String(value.source_type || '').toUpperCase();
    if (!ALLOWED_TYPES[sourceType]) throw new Error('source_type must be TARIFF, PACKAGE, LAND_ARRANGEMENT, or SUPPORTING.');
    if (!value.file_base64) throw new Error('file_base64 is required.');
    var bytes = Utilities.base64Decode(String(value.file_base64));
    if (!bytes.length) throw new Error('The uploaded file is empty.');
    if (bytes.length > MAX_BYTES) throw new Error('The local Workspace upload limit is 8 MB.');
    var fileName = safeName_(value.file_name);
    var supplier = supplierForUpload_(sourceType, value.supplier_id);
    var checksum = checksum_(bytes);
    var existing = WmitSheetServices.listDocument().data.filter(function (document) {
      return value.idempotency_key && document.idempotency_key === value.idempotency_key;
    })[0];
    if (existing) return { ok: true, data: existing, meta: { action: 'UPLOAD_SOURCE_DOCUMENT', idempotent: true } };

    var folder = folder_(sourceType);
    var blob = Utilities.newBlob(bytes, value.mime_type || 'application/octet-stream', fileName);
    var file = folder.createFile(blob);
    file.setDescription(JSON.stringify({ wmit_source_type: sourceType, checksum: checksum, uploaded_at: new Date().toISOString() }));
    try {
      var record = WmitSheetServices.createDocument({
        document_type: value.document_type || (sourceType === 'TARIFF' ? 'SUPPLIER_TARIFF' : sourceType === 'PACKAGE' ? 'SUPPLIER_PACKAGE' : sourceType === 'LAND_ARRANGEMENT' ? 'DMC_LAND_ARRANGEMENT' : 'SUPPORTING_DOCUMENT'),
        source_type: sourceType,
        supplier_id: supplier ? supplier.supplier_id : null,
        source_name: supplier ? (supplier.display_name || supplier.legal_name || supplier.supplier_id) : (value.source_name || null),
        file_name: fileName,
        original_file_name: value.file_name,
        mime_type: value.mime_type || 'application/octet-stream',
        file_size: bytes.length,
        checksum: checksum,
        file_id: file.getId(),
        file_url: file.getUrl(),
        review_status: 'NEEDS_REVIEW',
        extraction_status: 'NOT_STARTED',
        status: 'NEEDS_REVIEW',
        idempotency_key: value.idempotency_key || null,
        notes: 'Original source retained in Google Drive. Extraction and business-record writes require review.'
      }, { actor: actor_(context) });
      return { ok: true, data: record.data, meta: { action: 'UPLOAD_SOURCE_DOCUMENT', review_required: true } };
    } catch (error) {
      file.setDescription(JSON.stringify({ wmit_source_type: sourceType, checksum: checksum, upload_state: 'UNLINKED_DOCUMENT_RECORD', error: error.message || String(error) }));
      throw new Error('The source file was stored but its Document record could not be created. Preserve the Drive file for recovery and retry after checking the Sheets configuration.');
    }
  }

  return { uploadSourceDocument: uploadSourceDocument };
}());

function uploadSourceDocument_(input, context) {
  initializeWmitWorkspace_();
  return WmitDriveServices.uploadSourceDocument(input, context);
}
