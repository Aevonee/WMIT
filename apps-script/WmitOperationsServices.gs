/**
 * Operations-first domain actions for the fresh WMIT Workspace.
 *
 * The UI calls these functions through WmitWebApp.gs. This layer validates
 * relationships and business rules before using the controlled Sheets service.
 * Tariff extraction and automated quotation are intentionally outside this
 * service for now.
 */
var WmitOperationsServices = (function () {
  var PAYMENT_PURPOSES = ['DOWN_PAYMENT', 'PARTIAL_PAYMENT', 'FULL_PAYMENT', 'BALANCE_PAYMENT', 'OTHER'];
  var TASK_STATES = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'BLOCKED'];
  var SUB_AGENT_ROLES = ['REFERRAL_PARTNER', 'RESELLER', 'B2B_AGENCY', 'COORDINATOR', 'OTHER'];
  var CASH_TRANSACTION_TYPES = ['OPENING_BALANCE', 'OTHER_INCOME', 'EXPENSE', 'REFUND'];
  var SALES_PATHS = ['CUSTOM_QUOTE', 'WHOLESALER_PACKAGE', 'DMC_LAND_ARRANGEMENT'];

  function actor_(context) { return context && context.actor || 'WORKSPACE_STAFF'; }
  function fail_(code, message, details) { return { ok: false, error: { code: code, message: message, details: details || {} } }; }
  function required_(value, field) {
    if (value === undefined || value === null || String(value).trim() === '') throw new Error(field + ' is required.');
    return value;
  }
  function list_(type) {
    var method = 'list' + type;
    return WmitSheetServices[method]().data || [];
  }
  function get_(type, id) {
    required_(id, type + ' ID');
    var result = WmitSheetServices['get' + type](id);
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  }
  function clone_(value) { return JSON.parse(JSON.stringify(value || {})); }
  function unique_(values) {
    var result = [];
    (values || []).forEach(function (value) { if (value && result.indexOf(value) < 0) result.push(value); });
    return result;
  }
  function dateOnly_(value, field) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) || isNaN(Date.parse(value))) throw new Error(field + ' must be a valid date.');
    return String(value);
  }
  function money_(value, field) {
    var number = Number(value);
    if (!isFinite(number) || number <= 0) throw new Error(field + ' must be greater than zero.');
    return number.toFixed(2);
  }
  function currency_(value) {
    var currency = String(value || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Currency must be a three-letter code.');
    return currency;
  }
  function normalizeComposition_(requirements) {
    var hasComposition = ['adults', 'seniors', 'children', 'infants'].some(function (field) { return requirements[field] !== undefined && requirements[field] !== ''; });
    var adults = Number(hasComposition ? (requirements.adults === undefined ? 0 : requirements.adults) : (requirements.pax_count || 0));
    var seniors = Number(hasComposition ? (requirements.seniors === undefined ? 0 : requirements.seniors) : 0);
    var children = Number(hasComposition ? (requirements.children === undefined ? 0 : requirements.children) : 0);
    var infants = Number(hasComposition ? (requirements.infants === undefined ? 0 : requirements.infants) : 0);
    if ([adults, seniors, children, infants].some(function (value) { return !isFinite(value) || Math.floor(value) !== value || value < 0; }) || adults + seniors + children + infants < 1) throw new Error('Adults, seniors, children, and infants must contain at least one traveler and only non-negative whole numbers.');
    var ages = Array.isArray(requirements.child_ages) ? requirements.child_ages.map(Number) : [];
    if (ages.some(function (age) { return !isFinite(age) || Math.floor(age) !== age || age < 0 || age > 17; })) throw new Error('Child ages must be whole numbers from 0 through 17.');
    if (ages.length && ages.length !== children) throw new Error('Provide one age for each child, or leave ages blank until required by the selected tariff.');
    return { adults: adults, seniors: seniors, children: children, infants: infants, pax_count: adults + seniors + children + infants, child_ages: ages.length ? ages : undefined };
  }
  function normalizeRequirements_(input) {
    var requirements = clone_(input || {});
    required_(requirements.destination, 'Destination');
    var hasExact = Boolean(requirements.travel_start || requirements.travel_end);
    var hasMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(requirements.travel_month || ''));
    var hasYear = /^(19|20)\d{2}$/.test(String(requirements.travel_year || ''));
    if (!hasExact && !hasMonth && !hasYear) throw new Error('Provide exact travel dates or an approximate travel month/year.');
    if (hasExact && (hasMonth || hasYear)) throw new Error('Use either exact dates or approximate month/year, not both.');
    if (requirements.travel_end && !requirements.travel_start) throw new Error('Travel start date is required when an end date is provided.');
    if (requirements.travel_start) dateOnly_(requirements.travel_start, 'Travel start');
    if (requirements.travel_end) dateOnly_(requirements.travel_end, 'Travel end');
    if (requirements.travel_start && requirements.travel_end) {
      var days = Math.round((new Date(requirements.travel_end) - new Date(requirements.travel_start)) / 86400000) + 1;
      if (days < 1) throw new Error('Travel end cannot be before travel start.');
      requirements.duration_days = days;
      requirements.nights = days - 1;
    } else {
      var duration = Number(requirements.duration_days);
      if (!isFinite(duration) || Math.floor(duration) !== duration || duration < 1) throw new Error('Approximate month/year requires trip duration in days.');
      requirements.duration_days = duration;
      requirements.nights = duration - 1;
    }
    var composition = normalizeComposition_(requirements);
    Object.keys(composition).forEach(function (key) { if (composition[key] !== undefined) requirements[key] = composition[key]; });
    requirements.requirement_statuses = clone_(input.requirement_statuses || requirements.requirement_statuses || {});
    return requirements;
  }
  function context_(context) { return { actor: actor_(context) }; }
  function update_(type, id, changes, context) { return WmitSheetServices['update' + type](id, changes, context_(context)); }
  function create_(type, input, context) { return WmitSheetServices['create' + type](input, context_(context)); }
  function idempotent_(type, key) { return key ? list_(type).filter(function (row) { return row.idempotency_key === key; })[0] : null; }

  function createClient(input, context) {
    try {
      var value = input || {}; var name = String(value.display_name || value.legal_name || '').trim(); required_(name, 'Client name');
      var duplicate = list_('Client').filter(function (client) { return String(client.display_name || '').toLowerCase() === name.toLowerCase() && String(client.primary_email || '').toLowerCase() === String(value.primary_email || '').toLowerCase(); })[0];
      if (duplicate) return { ok: true, data: duplicate, meta: { action: 'CREATE_CLIENT', idempotent: true } };
      return create_('Client', Object.assign({}, value, { display_name: name, legal_name: String(value.legal_name || name).trim(), status: value.status || 'ACTIVE' }), context);
    } catch (error) { return fail_('CLIENT_INVALID', error.message); }
  }
  function updateClient(input, context) {
    try {
      var current = get_('Client', input && input.client_id); var changes = input.changes || input || {};
      var name = String(changes.display_name || current.display_name || changes.legal_name || current.legal_name || '').trim(); required_(name, 'Client name');
      return update_('Client', current.client_id, Object.assign({}, changes, { display_name: name, legal_name: String(changes.legal_name || current.legal_name || name).trim() }), context);
    } catch (error) { return fail_('CLIENT_UPDATE_INVALID', error.message); }
  }
  function createSubAgent(input, context) {
    try {
      var value = input || {}; var name = String(value.display_name || value.legal_name || '').trim(); required_(name, 'Sub-agent name');
      var roles = unique_((value.roles || []).map(function (role) { return String(role).toUpperCase(); }));
      if (!roles.length || roles.some(function (role) { return SUB_AGENT_ROLES.indexOf(role) < 0; })) throw new Error('Select at least one supported sub-agent role.');
      var duplicate = list_('SubAgent').filter(function (agent) { return String(agent.display_name || '').toLowerCase() === name.toLowerCase(); })[0];
      if (duplicate) return { ok: true, data: duplicate, meta: { action: 'CREATE_SUB_AGENT', idempotent: true } };
      return create_('SubAgent', Object.assign({}, value, { display_name: name, legal_name: String(value.legal_name || name).trim(), roles: roles, status: value.status || 'ACTIVE' }), context);
    } catch (error) { return fail_('SUB_AGENT_INVALID', error.message); }
  }
  function createInquiry(input, context) {
    try {
      var value = input || {}; var client = get_('Client', value.client_id); var requirements = normalizeRequirements_(value.requirements || {});
      var salesPath = String(value.sales_path || 'CUSTOM_QUOTE').toUpperCase();
      if (SALES_PATHS.indexOf(salesPath) < 0) throw new Error('Inquiry sales path is not supported.');
      var original = clone_(value.original_request_raw || value.original_request || requirements); var history = [{ at: wmitNow_(), type: 'ORIGINAL', value: clone_(original) }];
      return create_('Inquiry', Object.assign({}, value, { client_id: client.client_id, original_request: original, current_requirements: clone_(requirements), history: history, sales_path: salesPath, next_action: salesPath === 'WHOLESALER_PACKAGE' ? 'PACKAGE_BOOKING_PREP' : 'QUOTATION_REQUIRED', state: value.state || 'NEW' }), context);
    } catch (error) { return fail_('INQUIRY_INVALID', error.message); }
  }
  function updateInquiry(input, context) {
    try {
      var current = get_('Inquiry', input && input.inquiry_id); var requirements = normalizeRequirements_(input.requirements || input.current_requirements || current.current_requirements || {});
      var salesPath = String(input.sales_path || current.sales_path || 'CUSTOM_QUOTE').toUpperCase();
      if (SALES_PATHS.indexOf(salesPath) < 0) throw new Error('Inquiry sales path is not supported.');
      var history = (current.history || []).concat([{ at: wmitNow_(), type: 'REQUIREMENTS_CHANGED', value: clone_(requirements), actor: actor_(context) }]);
      var updated = update_('Inquiry', current.inquiry_id, { current_requirements: requirements, history: history, sales_path: salesPath, next_action: salesPath === 'WHOLESALER_PACKAGE' ? 'PACKAGE_BOOKING_PREP' : 'QUOTATION_REQUIRED' }, context);
      if (!updated.ok) return updated;
      list_('Quotation').filter(function (quote) { return quote.inquiry_id === current.inquiry_id; }).forEach(function (quote) { update_('Quotation', quote.quotation_id, { revision_required: true, revision_reason: 'Inquiry requirements changed' }, context); });
      list_('Booking').filter(function (booking) { return booking.inquiry_id === current.inquiry_id; }).forEach(function (booking) { update_('Booking', booking.booking_id, { commitment_state: 'REACCEPTANCE_REQUIRED', client_decision_state: 'CHANGED_REQUIREMENTS_REQUIRES_REACCEPTANCE' }, context); });
      return updated;
    } catch (error) { return fail_('INQUIRY_UPDATE_INVALID', error.message); }
  }
  function createQuotationFromInquiry(input, context) {
    try {
      var value = input || {}; var inquiry = get_('Inquiry', value.inquiry_id); var path = String(inquiry.sales_path || 'CUSTOM_QUOTE').toUpperCase();
      if (path === 'WHOLESALER_PACKAGE') throw new Error('Wholesaler packages use the Booking preparation queue, not the custom quotation path.');
      var existing = list_('Quotation').filter(function (quote) { return quote.inquiry_id === inquiry.inquiry_id && ['DRAFT', 'APPROVED'].indexOf(String(quote.status || '').toUpperCase()) >= 0; }).slice(-1)[0];
      if (existing) return { ok: true, data: existing, meta: { action: 'CREATE_QUOTATION_FROM_INQUIRY', idempotent: true, reused: true } };
      var requirements = clone_(inquiry.current_requirements || {}); var currency = currency_(value.currency || 'PHP');
      var composition = { adults: Number(requirements.adults || 0), seniors: Number(requirements.seniors || 0), children: Number(requirements.children || 0), infants: Number(requirements.infants || 0), pax_count: Number(requirements.pax_count || 0) };
      return create_('Quotation', Object.assign({}, value, {
        client_id: inquiry.client_id,
        inquiry_id: inquiry.inquiry_id,
        destination: requirements.destination,
        travel_start: requirements.travel_start || null,
        travel_end: requirements.travel_end || null,
        travel_month: requirements.travel_month || requirements.travel_year || null,
        pax_count: requirements.pax_count,
        traveler_composition: composition,
        requirements_snapshot: requirements,
        package_reference: requirements.package_reference || null,
        source_path: path,
        currency: currency,
        quotation_date: value.quotation_date || wmitNow_().slice(0, 10),
        valid_until: value.valid_until || null,
        supplier_cost_total: '0.00', markup_total: '0.00', fees_total: '0.00', tax_total: '0.00', discount_total: '0.00', client_total: '0.00',
        status: 'DRAFT', staff_review_required: true
      }), context);
    } catch (error) { return fail_('QUOTATION_FROM_INQUIRY_INVALID', error.message); }
  }
  function createTask(input, context) {
    try {
      var value = input || {};
      if (value.client_id) get_('Client', value.client_id);
      if (value.inquiry_id) get_('Inquiry', value.inquiry_id);
      if (value.booking_id) get_('Booking', value.booking_id);
      required_(value.description || value.title, 'Task description');
      if (value.due_at && isNaN(Date.parse(value.due_at))) throw new Error('Task due date/time is invalid.');
      return create_('Task', Object.assign({}, value, { title: value.title || value.description, description: value.description || value.title, state: value.state || 'OPEN', priority: value.priority || 'NORMAL' }), context);
    } catch (error) { return fail_('TASK_INVALID', error.message); }
  }
  function updateTask(input, context) {
    try {
      var task = get_('Task', input && input.task_id); var state = input.state;
      if (TASK_STATES.indexOf(state) < 0) throw new Error('Task state is not supported.');
      return update_('Task', task.task_id, { state: state, completion_note: input.completion_note || task.completion_note || null, completed_at: state === 'COMPLETED' ? wmitNow_() : task.completed_at || null }, context);
    } catch (error) { return fail_('TASK_UPDATE_INVALID', error.message); }
  }
  function createCommunication(input, context) {
    try { var value = input || {}; get_('Client', value.client_id); required_(value.outcome || value.notes, 'Communication outcome or notes'); return create_('CommunicationActivity', Object.assign({}, value, { occurred_at: value.occurred_at || wmitNow_() }), context); }
    catch (error) { return fail_('COMMUNICATION_INVALID', error.message); }
  }
  function createPaymentScheduleItem(input, context) {
    try {
      var value = input || {}; get_('Booking', value.booking_id); var amount = money_(value.amount, 'Payment schedule amount'); var currency = currency_(value.currency); var due = value.due_at || value.due_date; required_(due, 'Payment due date');
      if (isNaN(Date.parse(due))) throw new Error('Payment due date is invalid.');
      var purpose = value.purpose || 'INSTALLMENT'; if (['DOWN_PAYMENT', 'INSTALLMENT', 'FINAL_BALANCE', 'FULL_PAYMENT', 'OTHER'].indexOf(purpose) < 0) throw new Error('Payment schedule purpose is not supported.');
      var sequence = Number(value.sequence || 1); if (!isFinite(sequence) || Math.floor(sequence) !== sequence || sequence < 1) throw new Error('Payment schedule sequence must be a positive integer.');
      var existing = list_('PaymentScheduleItem').filter(function (item) { return item.booking_id === value.booking_id && Number(item.sequence) === sequence; })[0];
      if (existing) return { ok: true, data: existing, meta: { action: 'CREATE_PAYMENT_SCHEDULE', idempotent: true } };
      return create_('PaymentScheduleItem', Object.assign({}, value, { amount: amount, currency: currency, due_at: due, purpose: purpose, sequence: sequence, state: value.state || 'DUE' }), context);
    } catch (error) { return fail_('PAYMENT_SCHEDULE_INVALID', error.message); }
  }
  function allocatedForPayment_(paymentId) { return list_('PaymentAllocation').filter(function (allocation) { return allocation.client_payment_id === paymentId && allocation.state !== 'VOID'; }).reduce(function (sum, allocation) { return sum + number_(allocation.amount); }, 0); }
  function allocatedForSchedule_(scheduleId) { return list_('PaymentAllocation').filter(function (allocation) { return allocation.payment_schedule_item_id === scheduleId && allocation.state !== 'VOID'; }).reduce(function (sum, allocation) { return sum + number_(allocation.amount); }, 0); }
  function createPaymentAllocation(input, context) {
    try {
      var value = input || {}; var payment = get_('ClientPayment', value.client_payment_id); if (payment.payment_state !== 'VERIFIED') throw new Error('Only verified client payments can be allocated.');
      var schedule = get_('PaymentScheduleItem', value.payment_schedule_item_id); if (schedule.booking_id !== payment.booking_id) throw new Error('Payment and schedule item must belong to the same Booking.');
      if (String(schedule.currency || '').toUpperCase() !== String(payment.currency || '').toUpperCase()) throw new Error('Payment and schedule currency must match.');
      var amount = Number(value.amount); if (!isFinite(amount) || amount <= 0) throw new Error('Allocation amount must be greater than zero.');
      if (amount > number_(payment.amount) - allocatedForPayment_(payment.client_payment_id) + 0.000001) throw new Error('Allocation exceeds the unallocated payment amount.');
      if (amount > number_(schedule.amount) - allocatedForSchedule_(schedule.payment_schedule_item_id) + 0.000001) throw new Error('Allocation exceeds the outstanding schedule item.');
      var prior = idempotent_('PaymentAllocation', value.idempotency_key); if (prior) return { ok: true, data: prior, meta: { action: 'ALLOCATE_CLIENT_PAYMENT', idempotent: true } };
      var allocation = create_('PaymentAllocation', Object.assign({}, value, { booking_id: payment.booking_id, client_id: payment.client_id, amount: amount.toFixed(2), currency: String(payment.currency).toUpperCase(), state: 'ALLOCATED', allocated_at: value.allocated_at || wmitNow_() }), context);
      if (!allocation.ok) return allocation;
      var allocated = allocatedForSchedule_(schedule.payment_schedule_item_id); update_('PaymentScheduleItem', schedule.payment_schedule_item_id, { state: allocated >= number_(schedule.amount) ? 'PAID' : 'PARTIALLY_PAID', allocated_amount: allocated.toFixed(2) }, context);
      return allocation;
    } catch (error) { return fail_('PAYMENT_ALLOCATION_INVALID', error.message); }
  }
  function createSupplierPayable(input, context) {
    try {
      var value = input || {}; var booking = get_('Booking', value.booking_id); var supplier = get_('Supplier', value.supplier_id); var amount = money_(value.amount, 'Supplier payable amount'); var currency = currency_(value.currency || booking.currency || 'PHP');
      if (value.due_date && isNaN(Date.parse(value.due_date))) throw new Error('Supplier payable due date is invalid.');
      required_(value.description || value.service_description, 'Supplier payable description');
      var prior = idempotent_('SupplierPayable', value.idempotency_key); if (prior) return { ok: true, data: prior, meta: { action: 'CREATE_SUPPLIER_PAYABLE', idempotent: true } };
      return create_('SupplierPayable', Object.assign({}, value, { booking_id: booking.booking_id, supplier_id: supplier.supplier_id, amount: amount, currency: currency, description: value.description || value.service_description, state: 'DRAFT', client_money_gate: 'VERIFIED_ALLOCATED_FUNDS' }), context);
    } catch (error) { return fail_('SUPPLIER_PAYABLE_INVALID', error.message); }
  }
  function approveSupplierPayable(input, context) {
    try { var payable = get_('SupplierPayable', input && input.supplier_payable_id); if (payable.state === 'APPROVED' || payable.state === 'PARTIALLY_PAID') return { ok: true, data: payable, meta: { action: 'APPROVE_SUPPLIER_PAYABLE', idempotent: true } }; if (payable.state !== 'DRAFT') throw new Error('Only draft supplier payables can be approved.'); return update_('SupplierPayable', payable.supplier_payable_id, { state: 'APPROVED', approved_at: wmitNow_(), approved_by: actor_(context) }, context); }
    catch (error) { return fail_('SUPPLIER_PAYABLE_APPROVAL_INVALID', error.message); }
  }
  function supplierPaid_(payableId) { return list_('SupplierPayment').filter(function (payment) { return payment.supplier_payable_id === payableId && ['CANCELLED', 'REJECTED', 'VOID'].indexOf(String(payment.state || '').toUpperCase()) < 0; }).reduce(function (sum, payment) { return sum + number_(payment.amount); }, 0); }
  function verifiedAllocatedFunds_(bookingId, currency) {
    var payments = list_('ClientPayment'); var paymentMap = {}; payments.forEach(function (payment) { paymentMap[payment.client_payment_id] = payment; });
    return list_('PaymentAllocation').filter(function (allocation) { var payment = paymentMap[allocation.client_payment_id]; return allocation.state !== 'VOID' && payment && payment.payment_state === 'VERIFIED' && payment.booking_id === bookingId && String(payment.currency || '').toUpperCase() === String(currency || '').toUpperCase(); }).reduce(function (sum, allocation) { return sum + number_(allocation.amount); }, 0);
  }
  function recordSupplierPayment(input, context) {
    try {
      var value = input || {}; var payable = get_('SupplierPayable', value.supplier_payable_id); if (['APPROVED', 'PARTIALLY_PAID'].indexOf(payable.state) < 0) throw new Error('Supplier payable must be approved before payment.');
      var amount = money_(value.amount, 'Supplier payment amount'); if (String(value.currency || payable.currency).toUpperCase() !== String(payable.currency || '').toUpperCase()) throw new Error('Supplier payment currency must match the payable currency.');
      if (number_(amount) > number_(payable.amount) - supplierPaid_(payable.supplier_payable_id) + 0.000001) throw new Error('Supplier payment exceeds the outstanding payable.');
      var priorBookingPayments = list_('SupplierPayment').filter(function (payment) { return payment.booking_id === payable.booking_id && ['CANCELLED', 'REJECTED', 'VOID'].indexOf(String(payment.state || '').toUpperCase()) < 0; }).reduce(function (sum, payment) { return sum + number_(payment.amount); }, 0);
      if (verifiedAllocatedFunds_(payable.booking_id, payable.currency) - priorBookingPayments + 0.000001 < number_(amount)) throw new Error('Supplier payment is blocked because verified client funds allocated to this Booking are insufficient.');
      required_(value.payment_reference || value.proof_reference, 'Supplier payment reference'); var paymentDate = value.payment_date || wmitNow_().slice(0, 10); dateOnly_(paymentDate, 'Supplier payment date');
      var prior = idempotent_('SupplierPayment', value.idempotency_key); if (prior) return { ok: true, data: prior, meta: { action: 'RECORD_SUPPLIER_PAYMENT', idempotent: true } };
      var payment = create_('SupplierPayment', Object.assign({}, value, { booking_id: payable.booking_id, supplier_id: payable.supplier_id, amount: amount, currency: String(payable.currency).toUpperCase(), payment_date: paymentDate, payment_reference: value.payment_reference || value.proof_reference, state: 'EXECUTED' }), context);
      if (!payment.ok) return payment;
      var paid = supplierPaid_(payable.supplier_payable_id); update_('SupplierPayable', payable.supplier_payable_id, { state: paid >= number_(payable.amount) ? 'PAID' : 'PARTIALLY_PAID', paid_amount: paid.toFixed(2) }, context);
      return payment;
    } catch (error) { return fail_('SUPPLIER_PAYMENT_INVALID', error.message); }
  }
  function recordClientPayment(input, context) {
    try {
      var value = input || {}; var booking = get_('Booking', value.booking_id); if (value.client_id && value.client_id !== booking.client_id) throw new Error('Payment client does not match the Booking client.');
      required_(value.proof_reference || value.proof_document_id, 'Payment proof/reference'); var purpose = value.payment_purpose || 'OTHER'; if (PAYMENT_PURPOSES.indexOf(purpose) < 0) throw new Error('Payment purpose is not supported.');
      var prior = idempotent_('ClientPayment', value.idempotency_key); if (prior) return { ok: true, data: { payment: prior }, meta: { action: 'RECORD_CLIENT_PAYMENT', idempotent: true } };
      var payment = create_('ClientPayment', Object.assign({}, value, { client_id: booking.client_id, booking_id: booking.booking_id, amount: money_(value.amount, 'Payment amount'), currency: currency_(value.currency || 'PHP'), payment_state: 'PENDING_VERIFICATION', payment_purpose: purpose, actual_sent_at: value.actual_sent_at || value.payment_sent_at || null }), context);
      if (!payment.ok) return payment;
      var evidence = create_('PaymentEvidence', { client_payment_id: payment.data.client_payment_id, proof_document_id: value.proof_document_id || null, proof_reference: value.proof_reference || null, verification_state: 'PENDING', received_at: wmitNow_() }, context);
      if (!evidence.ok) {
        // Roll back the payment so a payment record never exists without its evidence.
        try { WmitSheetServices.compensateCreate('ClientPayment', payment.data.client_payment_id); } catch (_) { /* surface the original evidence failure */ }
        return evidence;
      }
      return { ok: true, data: { payment: payment.data, evidence: evidence.data }, meta: { action: 'RECORD_CLIENT_PAYMENT' } };
    } catch (error) { return fail_('CLIENT_PAYMENT_INVALID', error.message); }
  }
  function verifyClientPayment(input, context) {
    try { var payment = get_('ClientPayment', input && input.client_payment_id); if (payment.payment_state !== 'PENDING_VERIFICATION') return payment.payment_state === 'VERIFIED' ? { ok: true, data: payment, meta: { action: 'VERIFY_CLIENT_PAYMENT', idempotent: true } } : fail_('PAYMENT_FINALIZED', 'A finalized payment cannot be silently changed.'); var state = input.verified === false ? 'REJECTED' : 'VERIFIED'; var changes = { payment_state: state, verification_at: wmitNow_(), verified_by: actor_(context), verification_reason: input.reason || null }; var result = update_('ClientPayment', payment.client_payment_id, changes, context); list_('PaymentEvidence').filter(function (evidence) { return evidence.client_payment_id === payment.client_payment_id; }).forEach(function (evidence) { update_('PaymentEvidence', evidence.payment_evidence_id, { verification_state: state }, context); }); return result; }
    catch (error) { return fail_('PAYMENT_VERIFY_INVALID', error.message); }
  }
  function createCashTransaction(input, context) {
    try {
      var value = input || {}; var type = String(value.transaction_type || '').toUpperCase(); if (CASH_TRANSACTION_TYPES.indexOf(type) < 0) throw new Error('Cash transaction type is not supported.');
      var currency = currency_(value.currency || 'PHP');
      var description = String(value.description || '').trim(); required_(description, 'Cash transaction description');
      var transactionDate = value.transaction_date || value.transaction_at || wmitNow_().slice(0, 10); dateOnly_(transactionDate, 'Transaction date');
      if (value.client_id) get_('Client', value.client_id); if (value.booking_id) get_('Booking', value.booking_id); if (value.supplier_id) get_('Supplier', value.supplier_id);
      var prior = idempotent_('CashTransaction', value.idempotency_key); if (prior) return { ok: true, data: prior, meta: { action: 'RECORD_CASH_TRANSACTION', idempotent: true } };
      return create_('CashTransaction', Object.assign({}, value, { transaction_type: type, currency: currency, amount: money_(value.amount, 'Cash transaction amount'), description: description, transaction_date: transactionDate, state: 'RECORDED' }), context);
    } catch (error) { return fail_('CASH_TRANSACTION_INVALID', error.message); }
  }
  function voidCashTransaction(input, context) {
    try { var transaction = get_('CashTransaction', input && input.cash_transaction_id); required_(input && input.reason, 'Void reason'); if (transaction.state === 'VOID') return { ok: true, data: transaction, meta: { action: 'VOID_CASH_TRANSACTION', idempotent: true } }; if (transaction.state !== 'RECORDED') throw new Error('Only recorded cash transactions can be voided.'); return update_('CashTransaction', transaction.cash_transaction_id, { state: 'VOID', void_reason: String(input.reason).trim(), voided_at: wmitNow_(), voided_by: actor_(context) }, context); }
    catch (error) { return fail_('CASH_TRANSACTION_VOID_INVALID', error.message); }
  }
  function number_(value) {
    var amount = Number(value);
    return isFinite(amount) ? amount : 0;
  }
  function currencyTotal_(totals, currency) {
    var code = String(currency || 'UNKNOWN').trim().toUpperCase() || 'UNKNOWN';
    if (!totals[code]) totals[code] = {
      client_reported: 0,
      client_verified: 0,
      client_unallocated_funds: 0,
      opening_balance: 0,
      other_income: 0,
      expenses: 0,
      refunds: 0,
      booked_revenue: 0,
      supplier_cost: 0,
      gross_profit: 0,
      net_profit_estimate: 0,
      client_receivables: 0,
      client_credit: 0,
      supplier_payables: 0,
      supplier_payments: 0,
      supplier_payables_outstanding: 0,
      estimated_cash_position: 0
    };
    return totals[code];
  }
  function firstAmount_(record, fields) {
    for (var i = 0; i < fields.length; i += 1) {
      if (record && record[fields[i]] !== undefined && record[fields[i]] !== null && record[fields[i]] !== '') return number_(record[fields[i]]);
    }
    return 0;
  }
  function bookingCommercials_(booking, quotations, bookingItems) {
    var quote = quotations.filter(function (item) { return item.quotation_id === booking.quotation_id; })[0] || {};
    var items = bookingItems.filter(function (item) { return item.booking_id === booking.booking_id; });
    var revenue = firstAmount_(booking, ['current_price', 'client_total', 'selling_price_total']);
    var cost = firstAmount_(booking, ['current_supplier_cost', 'supplier_cost_total']);
    if (!revenue) revenue = firstAmount_(quote, ['client_total', 'selling_price_total']);
    if (!cost) cost = firstAmount_(quote, ['supplier_cost_total', 'supplier_cost']);
    if (!revenue && items.length) revenue = items.reduce(function (sum, item) { return sum + number_(item.selling_price || item.client_price || item.unit_selling_price) * number_(item.quantity || 1); }, 0);
    if (!cost && items.length) cost = items.reduce(function (sum, item) { return sum + number_(item.supplier_cost || item.unit_cost) * number_(item.quantity || 1); }, 0);
    var currency = booking.currency || quote.currency || (items[0] && items[0].currency) || 'UNKNOWN';
    return { currency: String(currency).toUpperCase(), revenue: revenue, cost: cost };
  }
  function financeSummary_(state) {
    function records_(type) { return state && state.entities && state.entities[type] ? state.entities[type] : list_(type); }
    var payments = records_('ClientPayment'); var allocations = records_('PaymentAllocation'); var schedules = records_('PaymentScheduleItem'); var tasks = records_('Task');
    var bookings = records_('Booking'); var quotations = records_('Quotation'); var bookingItems = records_('BookingItem');
    var payables = records_('SupplierPayable'); var supplierPayments = records_('SupplierPayment');
    var cashTransactions = records_('CashTransaction');
    var totals = {};
    var verifiedByBooking = {};
    var allocatedByPayment = {};
    allocations.forEach(function (allocation) { if (allocation.state === 'VOID') return; allocatedByPayment[allocation.client_payment_id] = (allocatedByPayment[allocation.client_payment_id] || 0) + number_(allocation.amount); });
    payments.forEach(function (payment) {
      var summary = currencyTotal_(totals, payment.currency);
      summary.client_reported += number_(payment.amount);
      if (payment.payment_state === 'VERIFIED') {
        summary.client_verified += number_(payment.amount);
        if (payment.booking_id) verifiedByBooking[payment.booking_id] = (verifiedByBooking[payment.booking_id] || 0) + number_(payment.amount);
      }
    });
    bookings.forEach(function (booking) {
      var commercial = bookingCommercials_(booking, quotations, bookingItems);
      var summary = currencyTotal_(totals, commercial.currency);
      summary.booked_revenue += commercial.revenue;
      summary.supplier_cost += commercial.cost;
      summary.gross_profit += commercial.revenue - commercial.cost;
    });
    payables.forEach(function (payable) {
      if (['CANCELLED', 'REJECTED'].indexOf(String(payable.state || '').toUpperCase()) >= 0) return;
      currencyTotal_(totals, payable.currency).supplier_payables += number_(payable.amount);
    });
    supplierPayments.forEach(function (payment) {
      if (['CANCELLED', 'REJECTED', 'VOID'].indexOf(String(payment.state || '').toUpperCase()) >= 0) return;
      currencyTotal_(totals, payment.currency).supplier_payments += number_(payment.amount);
    });
    cashTransactions.forEach(function (transaction) {
      if (String(transaction.state || '').toUpperCase() === 'VOID') return;
      var summary = currencyTotal_(totals, transaction.currency);
      var amount = number_(transaction.amount); var type = String(transaction.transaction_type || '').toUpperCase();
      if (type === 'OPENING_BALANCE') summary.opening_balance += amount;
      if (type === 'OTHER_INCOME') summary.other_income += amount;
      if (type === 'EXPENSE') summary.expenses += amount;
      if (type === 'REFUND') summary.refunds += amount;
    });
    payments.forEach(function (payment) { if (payment.payment_state === 'VERIFIED') currencyTotal_(totals, payment.currency).client_unallocated_funds += Math.max(0, number_(payment.amount) - (allocatedByPayment[payment.client_payment_id] || 0)); });
    var scheduledOutstanding = {};
    schedules.forEach(function (schedule) { var outstanding = Math.max(0, number_(schedule.amount) - allocations.filter(function (allocation) { return allocation.payment_schedule_item_id === schedule.payment_schedule_item_id && allocation.state !== 'VOID'; }).reduce(function (sum, allocation) { return sum + number_(allocation.amount); }, 0)); var currency = String(schedule.currency || 'UNKNOWN').toUpperCase(); scheduledOutstanding[currency] = (scheduledOutstanding[currency] || 0) + outstanding; });
    Object.keys(totals).forEach(function (currency) {
      var summary = totals[currency];
      summary.client_receivables = Math.max(0, summary.booked_revenue - summary.client_verified);
      summary.client_credit = Math.max(0, summary.client_verified - summary.booked_revenue);
      summary.supplier_payables_outstanding = Math.max(0, summary.supplier_payables - summary.supplier_payments);
      summary.estimated_cash_position = summary.opening_balance + summary.client_verified + summary.other_income - summary.supplier_payments - summary.expenses - summary.refunds;
      summary.net_profit_estimate = summary.gross_profit + summary.other_income - summary.expenses - summary.refunds;
    });
    var bookingsWithBalance = bookings.filter(function (booking) {
      var commercial = bookingCommercials_(booking, quotations, bookingItems);
      return commercial.revenue > (verifiedByBooking[booking.booking_id] || 0);
    }).length;
    var paymentTotals = {};
    Object.keys(totals).forEach(function (currency) { paymentTotals[currency] = { reported: totals[currency].client_reported, verified: totals[currency].client_verified }; });
    return {
      payment_totals_by_currency: paymentTotals,
      financial_totals_by_currency: totals,
      scheduled_client_outstanding_by_currency: scheduledOutstanding,
      cash_transaction_count: cashTransactions.filter(function (transaction) { return String(transaction.state || '').toUpperCase() !== 'VOID'; }).length,
      bookings_with_balance: bookingsWithBalance,
      open_payment_schedules: schedules.filter(function (item) { return !['PAID', 'COMPLETED', 'CANCELLED'].includes(item.state); }),
      open_tasks: tasks.filter(function (item) { return !['COMPLETED', 'CANCELLED'].includes(item.state); }),
      finance_basis: 'Verified client payments, recorded supplier payments, and recorded ledger transactions are included. Opening balance is recorded as an OPENING_BALANCE transaction. No FX conversion is applied.'
    };
  }
  function getOperationsState() {
    initializeWmitWorkspace_();
    var state = WmitSheetServices.getState(); state.data.finance = financeSummary_(state.data); return state;
  }
  return { createClient: createClient, updateClient: updateClient, createSubAgent: createSubAgent, createInquiry: createInquiry, updateInquiry: updateInquiry, createQuotationFromInquiry: createQuotationFromInquiry, createTask: createTask, updateTask: updateTask, createCommunication: createCommunication, createPaymentScheduleItem: createPaymentScheduleItem, createPaymentAllocation: createPaymentAllocation, recordClientPayment: recordClientPayment, verifyClientPayment: verifyClientPayment, createCashTransaction: createCashTransaction, voidCashTransaction: voidCashTransaction, createSupplierPayable: createSupplierPayable, approveSupplierPayable: approveSupplierPayable, recordSupplierPayment: recordSupplierPayment, getOperationsState: getOperationsState };
}());
