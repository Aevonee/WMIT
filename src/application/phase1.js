'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPhase1Runtime, ACTIONS } = require('../phase1/runtime');
const { projectCase, projectCases } = require('../phase1/case-projection');

const LOCAL_AUTH = {
  LOCAL_STAFF: [ACTIONS.SELECT_OPTION, ACTIONS.RESERVE_SUPPLIER, ACTIONS.ALLOCATE_PAYMENT, ACTIONS.EDIT_DRAFT_PRICING, ACTIONS.REVISE_QUOTATION, ACTIONS.ACCEPT_QUOTATION, ACTIONS.RECORD_TICKETING, ACTIONS.ISSUE_VOUCHER],
  LOCAL_MANAGER: [ACTIONS.VERIFY_PAYMENT, ACTIONS.APPROVE_QUOTATION, ACTIONS.APPROVE_PAYABLE, ACTIONS.SUPPLIER_PAYMENT, ACTIONS.CONFIRM_COMMITMENT, ACTIONS.REFUND, ACTIONS.PRICE_OVERRIDE, ACTIONS.CLIENT_ACCEPT_AMENDMENT, ACTIONS.RECONCILE_BOOKING, ACTIONS.CONFIGURE_SETTINGS, ACTIONS.DELETE_TARIFF]
};

// Only these runtime methods may be reached through the generic action
// dispatcher. Infrastructure internals (createRecord, updateRecord, list,
// snapshot, calculation helpers) must never be callable by action name.
const RUNTIME_ACTION_WHITELIST = new Set([
  'createClient', 'updateClient', 'createPerson', 'createSupplier', 'createSupplierContact', 'createSubAgent', 'updateSubAgent', 'createInquiry', 'updateInquiry',
  'uploadTariff', 'reviewTariff', 'deleteTariff',
  'createManualTariff', 'addTariffRate', 'removeTariffRate',
  'matchOptions', 'findMoreOptions', 'selectOption', 'calculateOptionCost',
  'createQuotation', 'createQuotationRevision', 'updateQuotationPricing', 'updateQuotation',
  'approveQuotation', 'cancelQuotationApproval', 'acceptQuotation',
  'createQuotationItem', 'updateQuotationItem', 'removeQuotationItem', 'reorderQuotationItems',
  'createBooking', 'createBookingItemsFromAcceptedSnapshot', 'confirmCommitment',
  'createBookingItem', 'updateBookingItem', 'createAvailabilityHold', 'updateAvailabilityHold',
  'recordTicketing', 'issueVoucher', 'createRoomingListEntry', 'createBookingParticipant',
  'createSupplierBooking', 'updateSupplierBooking', 'confirmSupplierBookingItem',
  'createClientObligation', 'createBookingPaymentObligations', 'updateSettings',
  'createClientInvoice', 'createPaymentScheduleItem',
  'recordClientPayment', 'verifyClientPayment', 'allocatePayment',
  'createSupplierPayable', 'approveSupplierPayable', 'executeSupplierPayment',
  'requestRefund', 'executeRefund', 'amendBooking', 'acceptAmendment', 'reconcileBooking',
  'createDocument', 'createTask', 'updateTask', 'createCommunication',
  'createDeparture', 'addDepartureMembership', 'createDepartureReadinessIssue', 'updateDepartureReadinessIssue'
]);

function createPhase1Application(options) {
  const opts = options || {};
  const sourceAdapters = opts.sourceAdapters || {};
  const runtimeOptions = { clock: opts.clock, config: Object.assign({ trustedActors: LOCAL_AUTH }, opts.config || {}) };
  const seededRuntime = () => opts.runtime || createPhase1Runtime(runtimeOptions);
  let runtime = seededRuntime();
  const seedSynthetic = (target) => {
    if (opts.seedSynthetic !== false && target.list('Client').length === 0) {
      target.createClient({ client_id: 'CLIENT-SYNTH-000001', display_name: 'Synthetic Phase 1 Client', legal_name: 'Synthetic Phase 1 Client', primary_email: 'phase1@example.test' }, { actor: 'LOCAL_STAFF' });
      target.createSupplier({ supplier_id: 'SUPPLIER-SYNTH-000001', display_name: 'Synthetic Supplier', legal_name: 'Synthetic Supplier', capabilities: ['DMC', 'Tariff Supplier'], country: 'Synthetic' }, { actor: 'LOCAL_STAFF' });
    }
  };
  seedSynthetic(runtime);
  const uploadSourceDocument = (input, actor) => {
    const body = input || {};
    try {
      const adapterKey = String(body.adapter_key || '').trim();
      const adapter = sourceAdapters[adapterKey];
      if (!adapter || typeof adapter.extract !== 'function') return { ok: false, error: { code: 'SOURCE_ADAPTER_UNAVAILABLE', message: 'The requested source adapter is not configured for this workspace.', details: { adapter_key: adapterKey || null } } };
      if (!body.supplier_id) return { ok: false, error: { code: 'SUPPLIER_REQUIRED', message: 'A Supplier is required for a tariff upload.' } };
      if (typeof adapter.accepts === 'function' && !adapter.accepts(body)) return { ok: false, error: { code: 'SOURCE_FORMAT_UNSUPPORTED', message: 'The configured source adapter does not accept this file.' } };
      if (!body.file_name) return { ok: false, error: { code: 'FILE_NAME_REQUIRED', message: 'A source file name is required.' } };
      if (!body.content_base64) return { ok: false, error: { code: 'FILE_CONTENT_REQUIRED', message: 'The selected source file has no readable content.' } };
      const bytes = Buffer.from(String(body.content_base64), 'base64');
      if (!bytes.length) return { ok: false, error: { code: 'FILE_CONTENT_REQUIRED', message: 'The selected DOCX file has no readable content.' } };
      if (bytes.length > 700 * 1024) return { ok: false, error: { code: 'FILE_TOO_LARGE', message: 'The local Phase 1 DOCX upload limit is 700 KB.' } };
      if (body.idempotency_key) {
        const prior = runtime.list('TariffSource', (record) => record.idempotency_key === body.idempotency_key);
        if (prior.length) return { ok: true, data: prior[0], meta: { action: 'IDEMPOTENT_REPLAY', idempotent: true } };
      }
      runtime.must('Supplier', body.supplier_id);
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wmit-source-upload-'));
      const temporaryFile = path.join(directory, body.file_name.replace(/[^A-Za-z0-9._-]/g, '_'));
      try {
        fs.writeFileSync(temporaryFile, bytes);
        const extracted = adapter.extract(temporaryFile, body);
        if (!extracted || !extracted.source) return { ok: false, error: { code: 'SOURCE_EXTRACTION_INVALID', message: 'The source adapter did not return a valid extraction result.' } };
        const actorContext = { actor: actor || 'LOCAL_STAFF', correlationId: body.correlation_id || null };
        const document = runtime.createDocument({
          external_file_id: 'LOCAL-UPLOAD-' + extracted.source.checksum,
          file_name: body.file_name,
          file_url: 'LOCAL-SYNTHETIC-FILE://' + encodeURIComponent(body.file_name),
          file_ref: 'LOCAL-SYNTHETIC-FILE://' + encodeURIComponent(body.file_name),
          mime_type: body.mime_type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          file_size: bytes.length,
          content_base64: body.content_base64,
          checksum: extracted.source.checksum,
          source_type: 'SUPPLIER',
          source_name: extracted.source.supplier_name || extracted.source.source_name || null,
          document_type: 'SUPPLIER_TARIFF',
          extraction_status: 'EXTRACTED',
          status: 'Needs Review',
          review_status: 'NEEDS_REVIEW',
          received_at: new Date().toISOString(),
          notes: 'Original supplier source retained for local review.'
        }, actorContext);
        if (!document.ok) return document;
        const tariff = runtime.uploadTariff({
          supplier_id: body.supplier_id,
          file_name: body.file_name,
          file_ref: document.data.file_ref,
          source_document_id: document.data.document_id,
          idempotency_key: body.idempotency_key,
          original_source: Object.assign({}, extracted.source, { file_ref: document.data.file_ref, document_id: document.data.document_id }),
          extraction_summary: extracted.extraction_summary,
          extraction_facts: extracted.extraction_facts,
          rate_components: extracted.rate_components,
          itinerary_components: extracted.itinerary_components,
          warnings: extracted.warnings
        }, actorContext);
        if (!tariff.ok) return tariff;
        return { ok: true, data: Object.assign({}, tariff.data, { source_document: document.data }), meta: { action: 'UPLOAD_SOURCE_DOCUMENT', adapter_key: adapterKey, trusted: false } };
      } finally {
        try { fs.rmSync(directory, { recursive: true, force: true }); } catch (_) { /* temporary cleanup is best effort */ }
      }
    } catch (error) {
      return { ok: false, error: { code: 'SOURCE_EXTRACTION_FAILED', message: error.message || 'The supplier source could not be extracted.' } };
    }
  };
  const ensureAutomaticFollowUpTasks = (actor) => {
    const created = [];
    const activeStates = ['OPEN', 'IN_PROGRESS', 'BLOCKED'];
    const add = (key, input) => {
      const existing = runtime.list('Task', (task) => task.automation_key === key && activeStates.includes(task.state));
      if (existing.length) return existing[0];
      const scope = key.split(':').slice(0, 2).join(':');
      runtime.list('Task', (task) => activeStates.includes(task.state) && task.source === 'AUTOMATIC_WORKFLOW_FOLLOW_UP' && String(task.automation_key || '').startsWith(scope + ':') && task.automation_key !== key).forEach((task) => {
        runtime.updateTask({ task_id: task.task_id, state: 'COMPLETED', completion_note: 'Superseded by the next automatic workflow follow-up.' }, { actor: actor || 'LOCAL_STAFF' });
      });
      const result = runtime.createTask(Object.assign({
        automation_key: key,
        state: 'OPEN',
        priority: input.priority || 'NORMAL',
        source: 'AUTOMATIC_WORKFLOW_FOLLOW_UP'
      }, input), { actor: actor || 'LOCAL_STAFF' });
      if (result.ok) created.push(result.data);
      return result.ok ? result.data : null;
    };
    runtime.list('TariffSource', (tariff) => !tariff.trusted).forEach((tariff) => {
      add('TARIFF:' + tariff.tariff_source_id + ':REVIEW', { related_type: 'TariffSource', related_id: tariff.tariff_source_id, tariff_source_id: tariff.tariff_source_id, task_type: 'TARIFF_REVIEW', description: 'Review and confirm the extracted supplier tariff before it can be used for matching.', priority: 'HIGH' });
    });
    runtime.list('Inquiry').forEach((inquiry) => {
      const options = runtime.list('CommercialOption', (option) => option.inquiry_id === inquiry.inquiry_id);
      const selected = options.find((option) => option.selected === true || option.state === 'SELECTED');
      const quotation = runtime.list('Quotation', (quote) => quote.inquiry_id === inquiry.inquiry_id).slice(-1)[0];
      const booking = runtime.list('Booking', (record) => record.inquiry_id === inquiry.inquiry_id).slice(-1)[0];
      const supplierBooking = booking && runtime.list('SupplierBooking', (record) => record.booking_id === booking.booking_id).slice(-1)[0];
      const payments = booking ? runtime.list('ClientPayment', (payment) => payment.booking_id === booking.booking_id) : [];
      const payment = payments.slice(-1)[0];
      const allocations = payment ? runtime.list('PaymentAllocation', (allocation) => allocation.client_payment_id === payment.client_payment_id && allocation.state === 'ACTIVE') : [];
      const payable = supplierBooking ? runtime.list('SupplierPayable', (record) => record.supplier_booking_id === supplierBooking.supplier_booking_id).slice(-1)[0] : null;
      const supplierPayment = payable ? runtime.list('SupplierPayment', (record) => record.supplier_payable_id === payable.supplier_payable_id && ['EXECUTED', 'VERIFIED'].includes(record.state)).slice(-1)[0] : null;
      const base = { inquiry_id: inquiry.inquiry_id, booking_id: booking && booking.booking_id };
      if (booking) {
        runtime.list('BookingItem', (item) => item.booking_id === booking.booking_id).forEach((item) => {
          const requirements = Array.isArray(item.required_tasks) ? item.required_tasks : [];
          requirements.forEach((requirement, index) => {
            const value = typeof requirement === 'string' ? { description: requirement } : (requirement || {});
            const key = 'BOOKING_ITEM:' + item.booking_item_id + ':TASK:' + (value.key || value.task_type || index);
            const completedTask = runtime.list('Task', (task) => task.automation_key === key && task.state === 'COMPLETED')[0];
            if (completedTask) return;
            const description = value.description || value.title || ('Complete service task for ' + (item.description || item.service_type || item.booking_item_id));
            add(key, Object.assign({}, base, {
              booking_item_id: item.booking_item_id,
              supplier_id: item.supplier_id,
              related_type: 'BookingItem',
              related_id: item.booking_item_id,
              task_type: value.task_type || 'SUPPLIER_FULFILLMENT',
              description,
              title: value.title || description,
              due_date: value.due_date,
              due_at: value.due_at,
              priority: value.priority || 'NORMAL',
              blocks_readiness: value.blocks_readiness !== false
            }));
          });
        });
      }
      if (!options.length) add('INQUIRY:' + inquiry.inquiry_id + ':RESEARCH', Object.assign({}, base, { task_type: 'RESEARCH_OPTIONS', description: 'Research matching options for this Inquiry.' }));
      else if (!selected) add('INQUIRY:' + inquiry.inquiry_id + ':SELECT_OPTION', Object.assign({}, base, { task_type: 'SELECT_OPTION', description: 'Review matching options and select one option.' }));
      else if (!quotation) add('INQUIRY:' + inquiry.inquiry_id + ':CREATE_QUOTATION', Object.assign({}, base, { task_type: 'CREATE_QUOTATION', description: 'Prepare a draft WMIT quotation for the selected option.' }));
      else if (quotation.status !== 'APPROVED') add('INQUIRY:' + inquiry.inquiry_id + ':APPROVE_QUOTATION', Object.assign({}, base, { task_type: 'APPROVE_QUOTATION', description: 'Review and approve the draft WMIT quotation.' }));
      else if (!booking) add('INQUIRY:' + inquiry.inquiry_id + ':CREATE_BOOKING', Object.assign({}, base, { task_type: 'CREATE_BOOKING', description: 'Create the operational Booking record from the approved quotation.' }));
      else if (booking.commitment_state === 'PENDING') add('BOOKING:' + booking.booking_id + ':COMMITMENT', Object.assign({}, base, { task_type: 'CLIENT_COMMITMENT', description: 'Record the client commitment decision for this Booking.', priority: 'HIGH' }));
      else if (!supplierBooking) add('BOOKING:' + booking.booking_id + ':SUPPLIER_RESERVATION', Object.assign({}, base, { task_type: 'SUPPLIER_RESERVATION', description: 'Request the Supplier reservation for this Booking.' }));
      else if (!payment) add('BOOKING:' + booking.booking_id + ':CLIENT_PAYMENT', Object.assign({}, base, { task_type: 'CLIENT_PAYMENT', description: 'Follow up for client payment evidence.' }));
      else if (payment.payment_state !== 'VERIFIED') add('PAYMENT:' + payment.client_payment_id + ':VERIFY', Object.assign({}, base, { task_type: 'PAYMENT_VERIFICATION', description: 'Verify the client payment evidence before funds can affect financial gates.', priority: 'HIGH' }));
      else if (!allocations.length) add('PAYMENT:' + payment.client_payment_id + ':ALLOCATION', Object.assign({}, base, { task_type: 'PAYMENT_ALLOCATION', description: 'Record the client-directed allocation for the verified payment.', priority: 'HIGH' }));
      else if (!payable) add('BOOKING:' + booking.booking_id + ':SUPPLIER_PAYABLE', Object.assign({}, base, { task_type: 'SUPPLIER_PAYABLE', description: 'Record the Supplier Payable for the Supplier reservation.' }));
      else if (payable.state !== 'APPROVED') add('PAYABLE:' + payable.supplier_payable_id + ':APPROVAL', Object.assign({}, base, { task_type: 'SUPPLIER_PAYABLE_APPROVAL', description: 'Review and approve the Supplier Payable.' }));
      else if (!supplierPayment) add('PAYABLE:' + payable.supplier_payable_id + ':PAYMENT', Object.assign({}, base, { task_type: 'SUPPLIER_PAYMENT', description: 'Review the Supplier Payment gate and pay only when sufficient verified client funds are available.', priority: 'HIGH' }));
    });
    return { ok: true, data: { created, created_count: created.length }, meta: { action: 'ENSURE_AUTOMATIC_FOLLOW_UP_TASKS' } };
  };
  const getCaseProjection = (input) => {
    try { return { ok: true, data: projectCase(runtime, input || {}, input || {}), meta: { action: 'GET_CASE_PROJECTION', read_only: true } }; }
    catch (error) { return { ok: false, error: { code: 'CASE_PROJECTION_FAILED', message: error.message || 'The case projection could not be derived.' } }; }
  };
  const getCaseProjections = (input) => {
    try { return { ok: true, data: projectCases(runtime, input || {}), meta: { action: 'GET_CASE_PROJECTIONS', read_only: true } }; }
    catch (error) { return { ok: false, error: { code: 'CASE_PROJECTION_FAILED', message: error.message || 'The case projections could not be derived.' } }; }
  };
  const call = (name, body, actor) => {
    if (name === 'resetSyntheticTestCase') {
      if (opts.runtime || opts.seedSynthetic === false) return { ok: false, error: { code: 'RESET_UNAVAILABLE', message: 'Synthetic reset is only available for the local seeded Phase 1 workspace.' } };
      runtime = seededRuntime();
      seedSynthetic(runtime);
      return { ok: true, data: { reset: true, scope: 'LOCAL_SYNTHETIC_PHASE1' }, meta: { action: 'RESET_SYNTHETIC_TEST_CASE' } };
    }
    if (name === 'uploadSourceDocument') return uploadSourceDocument(body, actor);
    if (name === 'ensureAutomaticFollowUpTasks') return ensureAutomaticFollowUpTasks(actor);
    if (name === 'getCaseProjection') return getCaseProjection(body);
    if (name === 'getCaseProjections') return getCaseProjections(body);
    if (name === 'getClientQuotationPreview') return runtime.getClientQuotationPreview(body && body.quotation_id || body, { actor: actor || 'LOCAL_STAFF', correlationId: (body && body.correlation_id) || null });
    if (name === 'updateClient') return runtime.updateClient(body && body.client_id, body && (body.changes || body), { actor: actor || 'LOCAL_STAFF', correlationId: (body && body.correlation_id) || null });
    if (name === 'updateSubAgent') return runtime.updateSubAgent(body && body.sub_agent_id, body && (body.changes || body), { actor: actor || 'LOCAL_STAFF', correlationId: (body && body.correlation_id) || null });
    if (name === 'updateInquiry') return runtime.updateInquiry(body && body.inquiry_id, { requirements: body && (body.requirements || body.current_requirements) }, { actor: actor || 'LOCAL_STAFF', correlationId: (body && body.correlation_id) || null });
    if (!RUNTIME_ACTION_WHITELIST.has(name) || typeof runtime[name] !== 'function') return { ok: false, error: { code: 'UNKNOWN_ACTION', message: 'Unknown Phase 1 action.' } };
    return runtime[name](body || {}, { actor: actor || 'LOCAL_STAFF', correlationId: (body && body.correlation_id) || null });
  };
  return {
    runtime,
    snapshot: () => {
      const result = runtime.snapshot();
      if (result.ok) {
        result.data.caseProjections = projectCases(runtime, {});
        const expo = runtime.config && runtime.config.expo || {};
        result.data.configuration = {
          tariffRateUnits: runtime.config && runtime.config.tariffRateUnits || [],
          quotationDefaults: runtime.config && runtime.config.quotationDefaults || {},
          expo: {
            id: expo.id || null,
            name: expo.name || null,
            startAt: expo.startAt || null,
            endAt: expo.endAt || null,
            configured: Boolean(expo.startAt && expo.endAt)
          }
        };
      }
      return result;
    },
    action: (body) => call(body && body.action, body && body.input, body && body.actor),
    resetSyntheticTestCase: () => call('resetSyntheticTestCase', {}, 'LOCAL_STAFF'),
    createClient: (input, actor) => call('createClient', input, actor),
    updateClient: (input, actor) => call('updateClient', input, actor),
    createPerson: (input, actor) => call('createPerson', input, actor),
    createSupplier: (input, actor) => call('createSupplier', input, actor),
    createSupplierContact: (input, actor) => call('createSupplierContact', input, actor),
    createSubAgent: (input, actor) => call('createSubAgent', input, actor),
    updateSubAgent: (input, actor) => call('updateSubAgent', input, actor),
    createInquiry: (input, actor) => call('createInquiry', input, actor),
    updateInquiry: (input, actor) => call('updateInquiry', input, actor),
    uploadTariff: (input, actor) => call('uploadTariff', input, actor),
    uploadSourceDocument: (input, actor) => call('uploadSourceDocument', input, actor),
    ensureAutomaticFollowUpTasks: (input, actor) => call('ensureAutomaticFollowUpTasks', input, actor),
    getCaseProjection: (input) => getCaseProjection(input),
    getCaseProjections: (input) => getCaseProjections(input),
    reviewTariff: (input, actor) => call('reviewTariff', input, actor),
    matchOptions: (input, actor) => call('matchOptions', input, actor),
    selectOption: (input, actor) => call('selectOption', input, actor),
    createQuotation: (input, actor) => call('createQuotation', input, actor),
    createQuotationRevision: (input, actor) => call('createQuotationRevision', input, actor),
    updateQuotationPricing: (input, actor) => call('updateQuotationPricing', input, actor),
    approveQuotation: (input, actor) => call('approveQuotation', input, actor),
    cancelQuotationApproval: (input, actor) => call('cancelQuotationApproval', input, actor),
    acceptQuotation: (input, actor) => call('acceptQuotation', input, actor),
    createQuotationItem: (input, actor) => call('createQuotationItem', input, actor),
    createBooking: (input, actor) => call('createBooking', input, actor),
    createBookingItemsFromAcceptedSnapshot: (input, actor) => call('createBookingItemsFromAcceptedSnapshot', input, actor),
    confirmCommitment: (input, actor) => call('confirmCommitment', input, actor),
    createBookingItem: (input, actor) => call('createBookingItem', input, actor),
    updateBookingItem: (input, actor) => call('updateBookingItem', input, actor),
    createAvailabilityHold: (input, actor) => call('createAvailabilityHold', input, actor),
    updateAvailabilityHold: (input, actor) => call('updateAvailabilityHold', input, actor),
    recordTicketing: (input, actor) => call('recordTicketing', input, actor),
    issueVoucher: (input, actor) => call('issueVoucher', input, actor),
    createRoomingListEntry: (input, actor) => call('createRoomingListEntry', input, actor),
    createBookingParticipant: (input, actor) => call('createBookingParticipant', input, actor),
    createSupplierBooking: (input, actor) => call('createSupplierBooking', input, actor),
    updateSupplierBooking: (input, actor) => call('updateSupplierBooking', input, actor),
    confirmSupplierBookingItem: (input, actor) => call('confirmSupplierBookingItem', input, actor),
    createClientObligation: (input, actor) => call('createClientObligation', input, actor),
    createBookingPaymentObligations: (input, actor) => call('createBookingPaymentObligations', input, actor),
    updateSettings: (input, actor) => call('updateSettings', input, actor),
    createClientInvoice: (input, actor) => call('createClientInvoice', input, actor),
    createPaymentScheduleItem: (input, actor) => call('createPaymentScheduleItem', input, actor),
    recordClientPayment: (input, actor) => call('recordClientPayment', input, actor),
    verifyClientPayment: (input, actor) => call('verifyClientPayment', input, actor),
    allocatePayment: (input, actor) => call('allocatePayment', input, actor),
    createSupplierPayable: (input, actor) => call('createSupplierPayable', input, actor),
    approveSupplierPayable: (input, actor) => call('approveSupplierPayable', input, actor),
    executeSupplierPayment: (input, actor) => call('executeSupplierPayment', input, actor),
    requestRefund: (input, actor) => call('requestRefund', input, actor),
    executeRefund: (input, actor) => call('executeRefund', input, actor),
    amendBooking: (input, actor) => call('amendBooking', input, actor),
    acceptAmendment: (input, actor) => call('acceptAmendment', input, actor),
    reconcileBooking: (input, actor) => call('reconcileBooking', input, actor),
    createDocument: (input, actor) => call('createDocument', input, actor),
    createTask: (input, actor) => call('createTask', input, actor),
    updateTask: (input, actor) => call('updateTask', input, actor),
    createCommunication: (input, actor) => call('createCommunication', input, actor),
    createDeparture: (input, actor) => call('createDeparture', input, actor),
    addDepartureMembership: (input, actor) => call('addDepartureMembership', input, actor),
    createDepartureReadinessIssue: (input, actor) => call('createDepartureReadinessIssue', input, actor),
    updateDepartureReadinessIssue: (input, actor) => call('updateDepartureReadinessIssue', input, actor)
  };
}

module.exports = { createPhase1Application, LOCAL_AUTH };
