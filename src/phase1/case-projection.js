'use strict';

const { toMinorUnits, fromMinorUnits } = require('../core/money');

const CASE_PROJECTION_VERSION = 'V1';
const CASE_STAGES = Object.freeze([
  'INQUIRY',
  'OPTIONS',
  'QUOTATION',
  'CLIENT_DECISION',
  'BOOKING',
  'SUPPLIER_FULFILLMENT',
  'PAYMENT',
  'DOCUMENTS',
  'TASKS',
  'COMPLETION'
]);

const OPEN_TASK_STATES = new Set(['OPEN', 'IN_PROGRESS', 'BLOCKED']);
const READY_DOCUMENT_STATES = new Set(['ACCEPTED', 'APPROVED', 'COMPLETE', 'COMPLETED', 'ISSUED', 'READY', 'RECEIVED', 'VERIFIED']);
const SUPPLIER_CONFIRMED_STATES = new Set(['CONFIRMED', 'TICKETED', 'VOUCHERED', 'COMPLETED']);
const SUPPLIER_RESERVED_STATES = new Set(['REQUESTED', 'HELD', 'RESERVED', 'PENDING', 'PARTIALLY_CONFIRMED']);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function upper(value) {
  return String(value || '').trim().toUpperCase();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function getEntities(source) {
  if (source && typeof source.list === 'function') {
    const names = [
      'Person', 'Client', 'Supplier', 'Inquiry', 'CommercialOption', 'Quotation', 'QuotationAcceptance',
      'Booking', 'BookingItem', 'SupplierBooking', 'SupplierBookingItem', 'ClientObligation',
      'PaymentScheduleItem', 'ClientPayment', 'PaymentEvidence', 'PaymentAllocation',
      'SupplierPayable', 'SupplierPayment', 'Document', 'Task', 'DepartureReadinessIssue',
      'Amendment', 'Reconciliation'
    ];
    return Object.fromEntries(names.map((name) => [name, source.list(name)]));
  }
  const value = source && source.ok && source.data ? source.data : source;
  const data = value && value.data && value.data.entities ? value.data : value;
  return (data && data.entities) || data || {};
}

function records(entities, type) {
  return asArray(entities[type]);
}

function byId(recordsList, idField, id) {
  return recordsList.find((record) => id && record && record[idField] === id) || null;
}

function latest(recordsList) {
  return recordsList.slice().sort((a, b) => {
    const aTime = Date.parse(a.updated_at || a.created_at || '') || 0;
    const bTime = Date.parse(b.updated_at || b.created_at || '') || 0;
    return aTime - bTime;
  }).pop() || null;
}

function moneyOrZero(value) {
  try { return toMinorUnits(value === undefined || value === null || value === '' ? '0.00' : value); }
  catch (_) { return 0n; }
}

function sumMoney(values) {
  return fromMinorUnits(values.reduce((sum, value) => sum + moneyOrZero(value), 0n));
}

function subtractMoney(a, b) {
  const result = moneyOrZero(a) - moneyOrZero(b);
  return fromMinorUnits(result < 0n ? 0n : result);
}

function signedMoney(value) {
  const amount = typeof value === 'bigint' ? value : BigInt(value);
  return amount < 0n ? '-' + fromMinorUnits(-amount) : fromMinorUnits(amount);
}

function relationMatches(record, inquiry, bookingIds, inquiryId) {
  if (!record) return false;
  if (record.inquiry_id && record.inquiry_id === inquiryId) return true;
  if (record.booking_id && bookingIds.has(record.booking_id)) return true;
  if (record.related_entity_type === 'Inquiry' && record.related_entity_id === inquiryId) return true;
  if (record.related_entity_type === 'Booking' && bookingIds.has(record.related_entity_id)) return true;
  return Boolean(inquiry && record.client_id && record.client_id === inquiry.client_id && !record.booking_id && !record.inquiry_id);
}

function findCase(entities, caseRef) {
  const inquiries = records(entities, 'Inquiry');
  const quotations = records(entities, 'Quotation');
  const bookings = records(entities, 'Booking');
  const ref = caseRef || {};
  let inquiry = byId(inquiries, 'inquiry_id', ref.inquiry_id);
  let quotation = byId(quotations, 'quotation_id', ref.quotation_id);
  let booking = byId(bookings, 'booking_id', ref.booking_id);

  if (!inquiry && booking) {
    quotation = quotation || byId(quotations, 'quotation_id', booking.quotation_id);
    inquiry = byId(inquiries, 'inquiry_id', booking.inquiry_id || (quotation && quotation.inquiry_id));
  }
  if (!inquiry && quotation) inquiry = byId(inquiries, 'inquiry_id', quotation.inquiry_id);
  if (!inquiry && !ref.inquiry_id && !ref.quotation_id && !ref.booking_id && inquiries.length === 1) inquiry = inquiries[0];
  if (!inquiry) throw new Error('A valid inquiry_id, quotation_id, booking_id, or single Inquiry is required to project a case.');

  const inquiryId = inquiry.inquiry_id;
  const inquiryQuotations = quotations.filter((item) => item.inquiry_id === inquiryId);
  quotation = quotation || latest(inquiryQuotations);
  const inquiryBookings = bookings.filter((item) => item.inquiry_id === inquiryId || (quotation && item.quotation_id === quotation.quotation_id));
  booking = booking || latest(inquiryBookings);
  return { inquiry, quotation, booking, inquiryId };
}

function requirementsSummary(inquiry) {
  const requirements = Object.assign({}, inquiry && (inquiry.current_requirements || inquiry.requirements) || {});
  const serviceOnly = Boolean(requirements.service_type || requirements.service_category || requirements.service_code || inquiry.case_type === 'SERVICE');
  const missing = [];
  if (!requirements.destination && !serviceOnly) missing.push('destination');
  if (!serviceOnly && !(requirements.travel_start || requirements.travel_month || requirements.travel_year)) missing.push('travel_period');
  if (!serviceOnly && !(requirements.travel_end || requirements.duration_days || requirements.nights)) missing.push('duration');
  if (!serviceOnly && !(requirements.pax_count || requirements.adults || requirements.children || requirements.travelers)) missing.push('traveler_count');
  if (serviceOnly && !requirements.service_type && !requirements.service_category && !requirements.service_code) missing.push('service_type');
  return { requirements, missing, complete: missing.length === 0 };
}

function optionState(options, selectedOption) {
  if (!options.length) return 'NONE';
  if (selectedOption) return 'SELECTED';
  return 'AVAILABLE';
}

function quotationState(quotation, acceptance) {
  if (!quotation) return 'NONE';
  if (acceptance) return 'ACCEPTED';
  return upper(quotation.status || 'DRAFT');
}

function supplierProjection(booking, bookingItems, supplierBookings, supplierBookingItems) {
  if (!booking) return { state: 'NOT_APPLICABLE', supplierBookingCount: 0, confirmedCount: 0, reservedCount: 0, outstandingCount: 0 };
  if (!supplierBookings.length && !bookingItems.length) return { state: 'NOT_REQUESTED', supplierBookingCount: 0, confirmedCount: 0, reservedCount: 0, outstandingCount: 0 };
  const joins = asArray(supplierBookingItems);
  const serviceStates = bookingItems.map((item) => {
    const linked = supplierBookings.filter((supplierBooking) => {
      const ids = asArray(supplierBooking.booking_item_ids);
      const linkedIds = joins.filter((join) => join.supplier_booking_id === supplierBooking.supplier_booking_id).map((join) => join.booking_item_id);
      return ids.includes(item.booking_item_id) || linkedIds.includes(item.booking_item_id);
    });
    const supplierState = linked.length ? upper(linked[linked.length - 1].reservation_state || linked[linked.length - 1].fulfillment_state || linked[linked.length - 1].state) : '';
    return supplierState || upper(item.fulfillment_state || item.status || 'NOT_REQUESTED');
  });
  const hasServiceLinks = supplierBookings.some((supplierBooking) => asArray(supplierBooking.booking_item_ids).length || joins.some((join) => join.supplier_booking_id === supplierBooking.supplier_booking_id));
  const states = bookingItems.length && hasServiceLinks ? serviceStates : supplierBookings.map((item) => upper(item.reservation_state || item.fulfillment_state || item.state));
  const confirmedCount = states.filter((state) => SUPPLIER_CONFIRMED_STATES.has(state)).length;
  const reservedCount = states.filter((state) => SUPPLIER_RESERVED_STATES.has(state)).length;
  const outstandingCount = Math.max(states.length - confirmedCount, 0);
  let state = 'NOT_REQUESTED';
  if (confirmedCount && confirmedCount === states.length) state = 'CONFIRMED';
  else if (confirmedCount) state = 'PARTIALLY_FULFILLED';
  else if (reservedCount || states.some((value) => value && value !== 'NOT_REQUESTED')) state = 'RESERVED';
  return { state, supplierBookingCount: supplierBookings.length, serviceCount: bookingItems.length, confirmedCount, reservedCount, outstandingCount };
}

function financeProjection(entities, booking, bookingIds) {
  if (!booking) {
    return { state: 'NOT_STARTED', currency: null, obligationTotal: '0.00', obligations: [], verifiedReceived: '0.00', verifiedAllocated: '0.00', outstanding: '0.00', pendingVerification: '0.00', unallocatedVerified: '0.00', supplierPaymentGate: 'NOT_APPLICABLE', supplierPaymentBlockers: [], supplierPayableState: 'NOT_APPLICABLE', supplierPayableTotal: '0.00', supplierPaid: '0.00' };
  }
  const schedule = records(entities, 'PaymentScheduleItem').filter((item) => item.booking_id === booking.booking_id);
  const obligations = records(entities, 'ClientObligation').filter((item) => item.booking_id === booking.booking_id);
  const obligationRecords = obligations.length ? obligations : schedule;
  const obligationTotal = sumMoney(obligationRecords.map((item) => item.amount || item.total_amount || item.balance_due || '0.00'));
  const currency = (obligationRecords[0] && obligationRecords[0].currency) || booking.currency || null;
  const payments = records(entities, 'ClientPayment').filter((item) => item.booking_id === booking.booking_id);
  const verifiedPayments = payments.filter((item) => upper(item.payment_state || item.state) === 'VERIFIED');
  const pendingPayments = payments.filter((item) => upper(item.payment_state || item.state) === 'PENDING_VERIFICATION');
  const verifiedReceived = sumMoney(verifiedPayments.map((item) => item.amount));
  const pendingVerification = sumMoney(pendingPayments.map((item) => item.amount));
  const allocations = records(entities, 'PaymentAllocation').filter((item) => bookingIds.has(item.booking_id || booking.booking_id) && upper(item.state || 'ACTIVE') === 'ACTIVE');
  const verifiedPaymentIds = new Set(verifiedPayments.map((item) => item.client_payment_id));
  const verifiedAllocated = sumMoney(allocations.filter((item) => verifiedPaymentIds.has(item.client_payment_id)).map((item) => item.amount));
  const allAllocated = sumMoney(allocations.map((item) => item.amount));
  const unallocatedVerified = subtractMoney(verifiedReceived, verifiedAllocated);
  const obligationViews = obligationRecords.map((obligation) => {
    const obligationId = obligation.client_obligation_id || obligation.payment_schedule_item_id;
    const targeted = allocations.filter((allocation) => {
      if (!verifiedPaymentIds.has(allocation.client_payment_id)) return false;
      if (allocation.client_obligation_id) return allocation.client_obligation_id === obligationId;
      return !obligations.length && obligationRecords.length === 1 && allocation.booking_id === booking.booking_id;
    });
    const allocated = sumMoney(targeted.map((allocation) => allocation.amount));
    const amount = String(obligation.amount || obligation.total_amount || obligation.balance_due || '0.00');
    const outstanding = subtractMoney(amount, allocated);
    const state = outstanding === '0.00' ? 'SATISFIED' : allocated === '0.00' ? 'OUTSTANDING' : 'PARTIALLY_SATISFIED';
    return {
      id: obligationId,
      obligationId: obligation.client_obligation_id || null,
      scheduleItemId: obligation.payment_schedule_item_id || null,
      purpose: obligation.purpose || 'INSTALLMENT',
      sequence: obligation.sequence || null,
      dueAt: obligation.due_at || null,
      amount,
      currency: obligation.currency || currency,
      allocated,
      outstanding,
      state
    };
  });
  const outstanding = sumMoney(obligationViews.map((obligation) => obligation.outstanding));

  const payables = records(entities, 'SupplierPayable').filter((item) => bookingIds.has(item.booking_id));
  const supplierPayments = records(entities, 'SupplierPayment').filter((item) => bookingIds.has(item.booking_id) && ['EXECUTED', 'VERIFIED'].includes(upper(item.state)));
  const supplierPayableTotal = sumMoney(payables.map((item) => item.amount));
  const supplierPaid = sumMoney(supplierPayments.map((item) => item.amount));
  const unpaidPayables = payables.filter((payable) => moneyOrZero(payable.amount) > supplierPayments.filter((payment) => payment.supplier_payable_id === payable.supplier_payable_id).reduce((sum, payment) => sum + moneyOrZero(payment.amount), 0n));
  const unpaidPayable = unpaidPayables[0];
  let supplierPayableState = 'NOT_CREATED';
  let supplierPaymentGate = 'NOT_APPLICABLE';
  const supplierPaymentBlockers = [];
  if (unpaidPayable) {
    supplierPayableState = upper(unpaidPayable.state || 'DRAFT');
    if (unpaidPayables.some((payable) => upper(payable.state || 'DRAFT') !== 'APPROVED')) supplierPaymentBlockers.push('SUPPLIER_PAYABLE_NOT_APPROVED');
    const supplierBookingIds = new Set(payables.map((payable) => payable.supplier_booking_id).filter(Boolean));
    const supplierBookings = records(entities, 'SupplierBooking').filter((item) => supplierBookingIds.has(item.supplier_booking_id));
    if (supplierBookings.some((supplierBooking) => !supplierBooking.supplier_id)) supplierPaymentBlockers.push('SUPPLIER_INFORMATION_MISSING');
    const supplierIds = new Set(supplierBookings.map((supplierBooking) => supplierBooking.supplier_id).filter(Boolean));
    const suppliers = records(entities, 'Supplier').filter((supplier) => supplierIds.has(supplier.supplier_id));
    if (supplierIds.size && suppliers.some((supplier) => !String(supplier.display_name || supplier.legal_name || '').trim())) supplierPaymentBlockers.push('SUPPLIER_INFORMATION_MISSING');
    const unpaidTotal = sumMoney(unpaidPayables.map((payable) => payable.amount));
    if (moneyOrZero(verifiedAllocated) < moneyOrZero(unpaidTotal)) supplierPaymentBlockers.push('VERIFIED_ALLOCATED_FUNDS_INSUFFICIENT');
    supplierPaymentGate = supplierPaymentBlockers.length ? 'BLOCKED' : 'PERMITTED';
  } else if (payables.length) {
    supplierPayableState = 'PAID';
    supplierPaymentGate = 'PAID';
  }

  let state = 'NOT_CONFIGURED';
  if (moneyOrZero(obligationTotal) > 0n) state = moneyOrZero(outstanding) === 0n ? 'FULLY_FUNDED' : moneyOrZero(verifiedAllocated) > 0n ? 'PARTIALLY_FUNDED' : 'PAYMENT_DUE';
  return { state, currency, obligationTotal, obligations: obligationViews, verifiedReceived, verifiedAllocated, outstanding, pendingVerification, unallocatedVerified, allAllocated, supplierPaymentGate, supplierPaymentBlockers, supplierPayableState, supplierPayableTotal, supplierPaid };
}

function documentsProjection(entities, booking, inquiryId, requiredDocuments) {
  const allDocuments = records(entities, 'Document').filter((document) => relationMatches(document, null, new Set(booking ? [booking.booking_id] : []), inquiryId));
  const required = asArray(requiredDocuments).length ? asArray(requiredDocuments).map((item) => typeof item === 'string' ? { type: item } : item) : allDocuments.filter((document) => document.required === true || document.required_for_readiness === true).map((document) => ({ type: document.document_type || document.type, document_id: document.document_id }));
  const missing = required.filter((requirement) => {
    return !allDocuments.some((document) => {
      const sameId = requirement.document_id && requirement.document_id === document.document_id;
      const sameType = requirement.type && upper(requirement.type) === upper(document.document_type || document.type);
      const ready = READY_DOCUMENT_STATES.has(upper(document.review_status || document.status || document.state));
      return ready && (sameId || sameType);
    });
  });
  const state = !required.length ? (allDocuments.length ? 'RECORDED' : 'NOT_CONFIGURED') : missing.length ? 'PENDING' : 'READY';
  return { state, requiredCount: required.length, completeCount: required.length - missing.length, missing, documentCount: allDocuments.length };
}

function tasksProjection(entities, booking, inquiryId, bookingItemIds) {
  const bookingId = booking && booking.booking_id;
  const itemIds = bookingItemIds || new Set();
  const linked = records(entities, 'Task').filter((task) => task.inquiry_id === inquiryId || task.booking_id === bookingId || itemIds.has(task.booking_item_id) || (task.related_type === 'Inquiry' && task.related_id === inquiryId) || (task.related_type === 'Booking' && task.related_id === bookingId) || (task.related_type === 'BookingItem' && itemIds.has(task.related_id)));
  const open = linked.filter((task) => OPEN_TASK_STATES.has(upper(task.state)));
  const blocked = open.filter((task) => upper(task.state) === 'BLOCKED');
  return { state: open.length ? 'OUTSTANDING' : linked.length ? 'CLEAR' : 'NOT_CONFIGURED', totalCount: linked.length, openCount: open.length, blockedCount: blocked.length, openTasks: clone(open) };
}

function requirementList(value) {
  return asArray(value).map((item) => typeof item === 'string' ? { type: item, key: item } : (item || {}));
}

function serviceLinkedDocuments(entities, item) {
  return records(entities, 'Document').filter((document) => document.booking_item_id === item.booking_item_id || (document.related_entity_type === 'BookingItem' && document.related_entity_id === item.booking_item_id));
}

function serviceDocumentsProjection(entities, item) {
  const documents = serviceLinkedDocuments(entities, item);
  const explicit = requirementList(item.required_documents || item.required_document_types);
  const inferred = documents.filter((document) => document.required === true || document.required_for_readiness === true).map((document) => ({ type: document.document_type || document.type, document_id: document.document_id, key: document.document_id }));
  const required = explicit.length ? explicit : inferred;
  const missing = required.filter((requirement) => !documents.some((document) => {
    const sameId = requirement.document_id && requirement.document_id === document.document_id;
    const sameType = requirement.type && upper(requirement.type) === upper(document.document_type || document.type);
    return READY_DOCUMENT_STATES.has(upper(document.review_status || document.status || document.state)) && (sameId || sameType);
  }));
  const state = !required.length ? (documents.length ? 'RECORDED' : 'NOT_CONFIGURED') : missing.length ? 'PENDING' : 'READY';
  return { state, requiredCount: required.length, completeCount: required.length - missing.length, missing, documentCount: documents.length, documents: clone(documents) };
}

function serviceLinkedTasks(entities, item) {
  return records(entities, 'Task').filter((task) => task.booking_item_id === item.booking_item_id || (task.related_type === 'BookingItem' && task.related_id === item.booking_item_id));
}

function serviceTasksProjection(entities, item) {
  const tasks = serviceLinkedTasks(entities, item);
  const explicit = requirementList(item.required_tasks || item.required_task_requirements);
  const missing = explicit.filter((requirement) => !tasks.some((task) => {
    if (requirement.automation_key && task.automation_key === requirement.automation_key) return true;
    if (requirement.task_id && task.task_id === requirement.task_id) return true;
    if (requirement.task_type && upper(task.task_type) === upper(requirement.task_type)) return true;
    return requirement.key && (task.task_key === requirement.key || task.title === requirement.key || task.description === requirement.key);
  }));
  const open = tasks.filter((task) => OPEN_TASK_STATES.has(upper(task.state)) && task.blocks_readiness !== false && task.blocking !== false);
  const state = missing.length || open.length ? 'OUTSTANDING' : (explicit.length || tasks.length ? 'CLEAR' : 'NOT_CONFIGURED');
  return { state, totalCount: tasks.length, openCount: open.length, blockedCount: open.filter((task) => upper(task.state) === 'BLOCKED').length, missing, openTasks: clone(open), tasks: clone(tasks) };
}

function serviceFulfillmentState(item, supplierBookings, supplierBookingItems) {
  const links = supplierBookings.filter((supplierBooking) => {
    const direct = asArray(supplierBooking.booking_item_ids);
    const joined = supplierBookingItems.filter((join) => join.supplier_booking_id === supplierBooking.supplier_booking_id).map((join) => join.booking_item_id);
    return direct.includes(item.booking_item_id) || joined.includes(item.booking_item_id);
  });
  const supplierBooking = latest(links);
  const supplierState = supplierBooking && upper(supplierBooking.reservation_state || supplierBooking.fulfillment_state || supplierBooking.state);
  const state = supplierState || upper(item.fulfillment_state || item.status || 'NOT_REQUESTED');
  return { state: state || 'NOT_REQUESTED', supplierBooking, supplierReference: item.supplier_reference || item.confirmation_reference || item.confirmation_number || supplierBooking && (supplierBooking.supplier_reference || supplierBooking.confirmation_reference || supplierBooking.confirmation_number) || null };
}

function serviceOperationalProjection(entities, bookingItems, supplierBookings) {
  const supplierBookingItems = records(entities, 'SupplierBookingItem');
  return bookingItems.map((item) => {
    const fulfillment = serviceFulfillmentState(item, supplierBookings, supplierBookingItems);
    const documents = serviceDocumentsProjection(entities, item);
    const tasks = serviceTasksProjection(entities, item);
    const blockers = [];
    if (!SUPPLIER_CONFIRMED_STATES.has(fulfillment.state)) blockers.push({ code: 'SERVICE_FULFILLMENT_PENDING', message: (item.description || item.service_type || 'Service') + ' supplier fulfillment is ' + (fulfillment.state || 'NOT_REQUESTED') + '.', recordType: 'BookingItem', recordId: item.booking_item_id });
    documents.missing.forEach((requirement) => blockers.push({ code: 'SERVICE_DOCUMENT_MISSING', message: (item.description || item.service_type || 'Service') + ' is missing required document: ' + (requirement.type || requirement.document_id || 'document') + '.', recordType: 'BookingItem', recordId: item.booking_item_id }));
    tasks.missing.forEach((requirement) => blockers.push({ code: 'SERVICE_TASK_MISSING', message: (item.description || item.service_type || 'Service') + ' is missing required task: ' + (requirement.description || requirement.title || requirement.task_type || requirement.key || 'task') + '.', recordType: 'BookingItem', recordId: item.booking_item_id }));
    tasks.openTasks.forEach((task) => blockers.push({ code: 'SERVICE_TASK_OUTSTANDING', message: task.description || 'Service task remains open.', recordType: 'Task', recordId: task.task_id }));
    const readinessState = blockers.length ? 'BLOCKED' : 'READY';
    return { bookingItemId: item.booking_item_id, serviceType: item.service_type || item.type || 'OTHER', description: item.description || item.name || item.service_type || 'Travel service', supplierId: item.supplier_id || fulfillment.supplierBooking && fulfillment.supplierBooking.supplier_id || null, travelStart: item.travel_start || null, travelEnd: item.travel_end || null, fulfillment: { state: fulfillment.state, supplierBookingId: fulfillment.supplierBooking && fulfillment.supplierBooking.supplier_booking_id || null, supplierReference: fulfillment.supplierReference }, documents, tasks, blockers, readiness: { state: readinessState, fulfillment: SUPPLIER_CONFIRMED_STATES.has(fulfillment.state), documents: documents.state === 'READY' || documents.state === 'NOT_CONFIGURED', tasks: tasks.state !== 'OUTSTANDING' } };
  });
}

function profitabilityProjection(entities, quotation, booking, bookingItems) {
  const itemsSelling = sumMoney(bookingItems.map((item) => item.selling_price || item.client_price || '0.00'));
  const itemsCost = sumMoney(bookingItems.map((item) => item.supplier_cost || item.cost || '0.00'));
  const bookingSelling = booking && (booking.current_price || booking.client_total);
  const bookingCost = booking && booking.current_supplier_cost;
  const selling = bookingSelling || (itemsSelling !== '0.00' ? itemsSelling : quotation && quotation.client_total);
  const supplierCost = bookingCost || (itemsCost !== '0.00' ? itemsCost : quotation && quotation.supplier_cost_total);
  if (selling === undefined || selling === null || supplierCost === undefined || supplierCost === null) return { state: 'NOT_AVAILABLE', currency: (booking && booking.currency) || (quotation && quotation.currency) || null, projected: null, actual: null };
  const fees = (booking && booking.fees_total) || (quotation && quotation.fees_total) || '0.00';
  const commissions = (booking && (booking.commission_total || booking.commissions_total)) || (quotation && (quotation.commission_total || quotation.commissions_total)) || '0.00';
  const projectedProfit = signedMoney(moneyOrZero(selling) - moneyOrZero(supplierCost) - moneyOrZero(fees) - moneyOrZero(commissions));
  const reconciled = latest(records(entities, 'Reconciliation').filter((item) => item.booking_id === (booking && booking.booking_id) && upper(item.state) === 'RECONCILED'));
  const actual = reconciled && reconciled.snapshot && reconciled.snapshot.actual_profit !== undefined ? {
    sellingPrice: String(reconciled.snapshot.actual_selling_price),
    supplierCost: String(reconciled.snapshot.actual_supplier_cost),
    fees: String(reconciled.snapshot.actual_fees || '0.00'),
    commissions: String(reconciled.snapshot.actual_commissions || '0.00'),
    adjustments: String(reconciled.snapshot.actual_adjustments || '0.00'),
    profit: String(reconciled.snapshot.actual_profit)
  } : null;
  return { state: actual ? 'ACTUAL' : 'PROJECTED', currency: (booking && booking.currency) || (quotation && quotation.currency) || 'PHP', projected: { sellingPrice: String(selling), supplierCost: String(supplierCost), fees: String(fees), commissions: String(commissions), profit: projectedProfit }, actual };
}

function exceptionsProjection(entities, booking, inquiryId, quotation, asOf, bookingItemIds) {
  const bookingId = booking && booking.booking_id;
  const exceptions = [];
  records(entities, 'DepartureReadinessIssue').filter((issue) => (issue.booking_id === bookingId || issue.inquiry_id === inquiryId || (issue.booking_item_id && bookingItemIds.has(issue.booking_item_id))) && !['RESOLVED', 'WAIVED', 'CLOSED'].includes(upper(issue.state))).forEach((issue) => exceptions.push({ code: 'READINESS_ISSUE', severity: upper(issue.severity || 'MEDIUM'), message: issue.description || 'Open readiness issue.', recordType: 'DepartureReadinessIssue', recordId: issue.departure_readiness_issue_id }));
  records(entities, 'Amendment').filter((amendment) => amendment.booking_id === bookingId && ['REACCEPTANCE_REQUIRED', 'PENDING_CLIENT_ACCEPTANCE'].includes(upper(amendment.state))).forEach((amendment) => exceptions.push({ code: 'AMENDMENT_REACCEPTANCE_REQUIRED', severity: 'HIGH', message: 'A Booking amendment requires client re-acceptance.', recordType: 'Amendment', recordId: amendment.amendment_id }));
  records(entities, 'ClientPayment').filter((payment) => payment.booking_id === bookingId && upper(payment.payment_state || payment.state) === 'REJECTED').forEach((payment) => exceptions.push({ code: 'PAYMENT_REJECTED', severity: 'HIGH', message: 'A client payment was rejected and does not fund the case.', recordType: 'ClientPayment', recordId: payment.client_payment_id }));
  if (quotation && quotation.valid_until && Date.parse(quotation.valid_until) < Date.parse(asOf) && !['ACCEPTED', 'BOOKED'].includes(upper(quotation.status))) exceptions.push({ code: 'QUOTATION_EXPIRED', severity: 'HIGH', message: 'The quotation validity date has passed.', recordType: 'Quotation', recordId: quotation.quotation_id });
  return exceptions;
}

function deadlineProjection(entities, booking, inquiryId, quotation, asOf) {
  const bookingId = booking && booking.booking_id;
  const deadlines = [];
  const add = (kind, record, field, label, recordType) => { if (record && record[field]) deadlines.push({ kind, at: record[field], label, recordType: recordType || null, recordId: record.booking_id || record.quotation_id || record.task_id || record.payment_schedule_item_id || record.supplier_payable_id || record.supplier_booking_id || null, overdue: Date.parse(record[field]) < Date.parse(asOf) }); };
  asArray(entities.PaymentScheduleItem).filter((item) => item.booking_id === bookingId).forEach((item) => add('PAYMENT_DUE', item, 'due_at', item.purpose || 'Payment due', 'PaymentScheduleItem'));
  asArray(entities.Task).filter((task) => task.inquiry_id === inquiryId || task.booking_id === bookingId).forEach((task) => add('TASK_DUE', task, task.due_date ? 'due_date' : 'deadline', task.description || 'Task due', 'Task'));
  asArray(entities.SupplierPayable).filter((payable) => payable.booking_id === bookingId).forEach((payable) => add('SUPPLIER_PAYMENT_DUE', payable, payable.due_at ? 'due_at' : 'due_date', 'Supplier payment due', 'SupplierPayable'));
  asArray(entities.SupplierBooking).filter((item) => item.booking_id === bookingId).forEach((item) => add('SUPPLIER_DEADLINE', item, 'final_payment_due_date', 'Supplier final payment due', 'SupplierBooking'));
  if (quotation) add('QUOTATION_EXPIRY', quotation, 'valid_until', 'Quotation validity ends', 'Quotation');
  if (booking) { add('DEPARTURE', booking, 'travel_start', 'Travel departure', 'Booking'); add('TRIP_END', booking, 'travel_end', 'Travel end', 'Booking'); }
  return deadlines.sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0));
}

function nextAction(code, label, reason, role) {
  return { code, label, reason, responsibleRole: role };
}

function deriveStage(input) {
  const { requirements, options, selectedOption, quotation, acceptance, booking, supplier, finance, documents, tasks, exceptions, readiness, completed, serviceProjections } = input;
  if (completed) return { stage: 'COMPLETION', action: nextAction('CASE_COMPLETE', 'Case complete', 'All required operational conditions and closeout evidence are complete.', 'OPERATIONS') };
  if (!requirements.complete) return { stage: 'INQUIRY', action: nextAction('COMPLETE_REQUIREMENTS', 'Complete travel requirements', 'The Inquiry is missing required travel or service requirements.', 'SALES') };
  if (!options.length && !quotation) return { stage: 'OPTIONS', action: nextAction('PREPARE_OPTIONS', 'Prepare commercial options', 'No Commercial Options are linked to this Inquiry yet.', 'SALES') };
  if (!selectedOption && !quotation) return { stage: 'OPTIONS', action: nextAction('SELECT_OPTION', 'Select a Commercial Option', 'Options exist, but staff has not selected the client-facing commercial basis.', 'SALES') };
  if (!quotation || ['DRAFT', 'REJECTED'].includes(upper(quotation.status))) return { stage: 'QUOTATION', action: nextAction('PREPARE_QUOTATION', 'Prepare the quotation', 'The selected commercial decision does not yet have an approved quotation.', 'SALES') };
  if (!acceptance) return { stage: 'CLIENT_DECISION', action: nextAction('REQUEST_CLIENT_DECISION', 'Request client decision', 'The approved quotation is awaiting client acceptance, change request, or decline.', 'CLIENT') };
  if (!booking) return { stage: 'BOOKING', action: nextAction('CREATE_BOOKING', 'Create the Booking', 'The client accepted the quotation, but no operational Booking exists yet.', 'OPERATIONS') };
  if (upper(booking.commitment_state || 'PENDING') === 'REACCEPTANCE_REQUIRED') return { stage: 'CLIENT_DECISION', action: nextAction('REACCEPT_BOOKING', 'Obtain client re-acceptance', 'A Booking change requires the client to accept the amended commercial decision.', 'CLIENT') };
  if (upper(booking.commitment_state || 'PENDING') !== 'CONFIRMED') return { stage: 'BOOKING', action: nextAction('CONFIRM_CLIENT_COMMITMENT', 'Confirm client commitment', 'The Booking exists, but its client commitment is not confirmed.', 'SALES') };
  const blockedService = asArray(serviceProjections).find((service) => service.blockers && service.blockers.length);
  if (supplier.state === 'NOT_REQUESTED' || supplier.state === 'RESERVED' || supplier.state === 'PARTIALLY_FULFILLED') return { stage: 'SUPPLIER_FULFILLMENT', action: nextAction('REQUEST_SUPPLIER_RESERVATION', 'Request or confirm Supplier fulfillment', blockedService ? blockedService.blockers[0].message : 'One or more services are missing supplier fulfillment.', 'OPERATIONS') };
  if (finance.pendingVerification !== '0.00') return { stage: 'PAYMENT', action: nextAction('VERIFY_PAYMENT', 'Verify client payment evidence', 'Client payment evidence exists but has not been verified.', 'FINANCE') };
  if (finance.unallocatedVerified !== '0.00') {
    const outstandingObligations = asArray(finance.obligations).filter((obligation) => moneyOrZero(obligation.outstanding) > 0n);
    if (!outstandingObligations.length) return { stage: 'PAYMENT', action: nextAction('REVIEW_EXCESS_FUNDS', 'Review excess verified funds', 'Verified funds remain outside the configured client obligations. Review duplicate payment records, overpayment, or a new client instruction.', 'FINANCE') };
    return { stage: 'PAYMENT', action: nextAction('ALLOCATE_PAYMENT', 'Allocate verified client funds', 'Verified client funds are not yet allocated to a Booking obligation.', 'FINANCE') };
  }
  if (finance.state === 'NOT_CONFIGURED') return { stage: 'PAYMENT', action: nextAction('CREATE_PAYMENT_OBLIGATIONS', 'Create payment obligations', 'The Booking has no authoritative client payment obligations yet.', 'FINANCE') };
  if (finance.outstanding !== '0.00') return { stage: 'PAYMENT', action: nextAction('COLLECT_CLIENT_BALANCE', 'Collect remaining client balance', finance.outstanding + ' ' + (finance.currency || '') + ' remains outstanding.', 'SALES') };
  if (finance.supplierPayableState === 'DRAFT') return { stage: 'PAYMENT', action: nextAction('APPROVE_SUPPLIER_PAYABLE', 'Approve Supplier Payable', 'The Supplier Payable is recorded but not approved for payment.', 'FINANCE') };
  if (finance.supplierPaymentGate === 'BLOCKED' && finance.supplierPayableState === 'APPROVED') return { stage: 'PAYMENT', action: nextAction('FUND_SUPPLIER_PAYMENT', 'Fund Supplier Payment', 'Supplier payment is blocked until sufficient verified allocated client funds are available.', 'FINANCE') };
  if (finance.supplierPaymentGate === 'PERMITTED') return { stage: 'SUPPLIER_FULFILLMENT', action: nextAction('EXECUTE_SUPPLIER_PAYMENT', 'Execute Supplier Payment', 'The approved Supplier Payable has sufficient verified allocated client funds.', 'FINANCE') };
  if (documents.state === 'PENDING') return { stage: 'DOCUMENTS', action: nextAction('COMPLETE_DOCUMENTS', 'Complete required documents', 'Required Booking documents are missing or not accepted.', 'DOCUMENTS') };
  if (tasks.state === 'OUTSTANDING') return { stage: 'TASKS', action: nextAction('COMPLETE_TASKS', 'Complete outstanding tasks', 'Operational tasks remain open for this case.', 'OPERATIONS') };
  if (exceptions.length) return { stage: 'TASKS', action: nextAction('RESOLVE_EXCEPTION', 'Resolve case exception', 'An exception must be resolved or explicitly waived before completion.', 'OPERATIONS') };
  if (readiness.state !== 'READY') return { stage: 'COMPLETION', action: nextAction('PREPARE_FOR_DEPARTURE', 'Prepare case for departure', 'The case is commercially complete but one or more readiness conditions remain unresolved.', 'OPERATIONS') };
  return { stage: 'COMPLETION', action: nextAction('MONITOR_DEPARTURE', 'Monitor the trip through completion', 'All current readiness conditions are satisfied.', 'OPERATIONS') };
}

function projectCase(source, caseRef, options) {
  const entities = getEntities(source);
  const reference = caseRef || {};
  const asOf = (options && options.asOf) || reference.asOf || new Date().toISOString();
  const selected = findCase(entities, reference);
  const { inquiry, quotation, booking, inquiryId } = selected;
  const bookingIds = new Set(booking ? [booking.booking_id] : []);
  const optionsForCase = records(entities, 'CommercialOption').filter((option) => option.inquiry_id === inquiryId);
  const selectedOption = optionsForCase.find((option) => option.selected === true || upper(option.state) === 'SELECTED') || (quotation && byId(optionsForCase, 'commercial_option_id', quotation.commercial_option_id));
  const acceptance = quotation && records(entities, 'QuotationAcceptance').find((record) => record.quotation_id === quotation.quotation_id && upper(record.state) === 'ACCEPTED');
  const bookingItems = records(entities, 'BookingItem').filter((item) => item.booking_id === (booking && booking.booking_id));
  const supplierBookings = records(entities, 'SupplierBooking').filter((item) => item.booking_id === (booking && booking.booking_id));
  const supplierBookingItems = records(entities, 'SupplierBookingItem');
  const supplier = supplierProjection(booking, bookingItems, supplierBookings, supplierBookingItems);
  const serviceProjections = serviceOperationalProjection(entities, bookingItems, supplierBookings);
  if (bookingItems.length) supplier.services = serviceProjections.map((service) => Object.assign({}, service.fulfillment, { bookingItemId: service.bookingItemId, serviceType: service.serviceType, description: service.description, supplierId: service.supplierId }));
  const finance = financeProjection(entities, booking, bookingIds);
  const documents = documentsProjection(entities, booking, inquiryId, options && options.requiredDocuments);
  const tasks = tasksProjection(entities, booking, inquiryId, new Set(bookingItems.map((item) => item.booking_item_id)));
  if (serviceProjections.length) {
    documents.services = serviceProjections.map((service) => Object.assign({ bookingItemId: service.bookingItemId, description: service.description }, service.documents));
    tasks.services = serviceProjections.map((service) => Object.assign({ bookingItemId: service.bookingItemId, description: service.description }, service.tasks));
    const requiredServiceDocuments = serviceProjections.reduce((sum, service) => sum + service.documents.requiredCount, 0);
    const missingServiceDocuments = serviceProjections.reduce((all, service) => all.concat(service.documents.missing.map((item) => Object.assign({}, item, { booking_item_id: service.bookingItemId }))), []);
    if (requiredServiceDocuments) {
      documents.requiredCount += requiredServiceDocuments;
      documents.completeCount += requiredServiceDocuments - missingServiceDocuments.length;
      documents.missing = documents.missing.concat(missingServiceDocuments);
      documents.state = missingServiceDocuments.length ? 'PENDING' : 'READY';
    }
  }
  const profitability = profitabilityProjection(entities, quotation, booking, bookingItems);
  const exceptions = exceptionsProjection(entities, booking, inquiryId, quotation, asOf, new Set(bookingItems.map((item) => item.booking_item_id)));
  const deadlines = deadlineProjection(entities, booking, inquiryId, quotation, asOf);
  const completedEvidence = booking && (booking.completed_at || ['COMPLETED', 'COMPLETE'].includes(upper(booking.record_state || booking.status)) || records(entities, 'Reconciliation').some((item) => item.booking_id === booking.booking_id && upper(item.state) === 'RECONCILED'));
  const readinessConditions = {
    commercial: Boolean(quotation && acceptance && booking),
    clientCommitment: Boolean(booking && upper(booking.commitment_state) === 'CONFIRMED'),
    supplierFulfillment: supplier.state === 'CONFIRMED',
    finance: finance.state === 'FULLY_FUNDED',
    documents: documents.state === 'READY' || documents.state === 'NOT_CONFIGURED',
    tasks: tasks.state !== 'OUTSTANDING',
    exceptions: exceptions.length === 0
  };
  const serviceReadiness = serviceProjections.length ? serviceProjections.every((service) => service.readiness.state === 'READY') : true;
  readinessConditions.supplierFulfillment = readinessConditions.supplierFulfillment && serviceReadiness;
  const readiness = { state: Object.values(readinessConditions).every(Boolean) ? 'READY' : 'NOT_READY', conditions: readinessConditions, services: serviceProjections.map((service) => ({ bookingItemId: service.bookingItemId, state: service.readiness.state, blockers: service.blockers })) };
  const completed = Boolean(completedEvidence && readiness.state === 'READY');
  const operationalCompletion = {
    state: serviceReadiness && serviceProjections.length ? 'READY' : serviceProjections.length ? 'INCOMPLETE' : (booking ? 'READY' : 'NOT_APPLICABLE'),
    serviceCount: serviceProjections.length,
    readyServiceCount: serviceProjections.filter((service) => service.readiness.state === 'READY').length,
    blockers: serviceProjections.reduce((all, service) => all.concat(service.blockers), []),
    stage: completed ? 'OPERATIONALLY_COMPLETED' : readiness.state === 'READY' ? 'TRAVEL_READY' : supplier.state === 'CONFIRMED' ? 'FULFILLMENT_READY' : 'IN_PROGRESS'
  };
  const derived = deriveStage({ requirements: requirementsSummary(inquiry), options: optionsForCase, selectedOption, quotation, acceptance, booking, supplier, finance, documents, tasks, exceptions, readiness, completed, serviceProjections });
  const client = byId(records(entities, 'Client'), 'client_id', inquiry.client_id);
  const identity = {
    inquiryId,
    clientId: inquiry.client_id || null,
    clientName: client && (client.display_name || client.legal_name) || null,
    quotationId: quotation && quotation.quotation_id || null,
    bookingId: booking && booking.booking_id || null,
    destination: (inquiry.current_requirements || inquiry.requirements || {}).destination || (quotation && quotation.destination) || (booking && booking.destination) || null,
    travelStart: (inquiry.current_requirements || inquiry.requirements || {}).travel_start || (booking && booking.travel_start) || (quotation && quotation.travel_start) || null,
    travelEnd: (inquiry.current_requirements || inquiry.requirements || {}).travel_end || (booking && booking.travel_end) || (quotation && quotation.travel_end) || null
  };
  const blockers = [];
  const addBlocker = (code, message, severity, recordType, recordId) => blockers.push({ code, message, severity: severity || 'MEDIUM', recordType: recordType || null, recordId: recordId || null });
  const requirements = requirementsSummary(inquiry);
  requirements.missing.forEach((field) => addBlocker('REQUIREMENT_MISSING', 'Required Inquiry field is missing: ' + field + '.', 'HIGH', 'Inquiry', inquiryId));
  if (derived.stage === 'OPTIONS' && !optionsForCase.length) addBlocker('OPTIONS_MISSING', 'No Commercial Options are available for this Inquiry.', 'HIGH', 'Inquiry', inquiryId);
  if (derived.stage === 'OPTIONS' && optionsForCase.length && !selectedOption) addBlocker('OPTION_SELECTION_REQUIRED', 'A Commercial Option must be selected before preparing the quotation.', 'HIGH', 'Inquiry', inquiryId);
  if (derived.stage === 'CLIENT_DECISION' && !acceptance) addBlocker('CLIENT_DECISION_REQUIRED', 'The approved quotation is awaiting the client decision.', 'HIGH', 'Quotation', quotation && quotation.quotation_id);
  if (derived.stage === 'BOOKING' && !booking) addBlocker('BOOKING_REQUIRED', 'The accepted quotation has not been converted into a Booking.', 'HIGH', 'Quotation', quotation && quotation.quotation_id);
  if (booking && upper(booking.commitment_state || 'PENDING') !== 'CONFIRMED') addBlocker('CLIENT_COMMITMENT_PENDING', 'Client commitment is not confirmed for this Booking.', 'HIGH', 'Booking', booking.booking_id);
  if (supplier.state === 'NOT_REQUESTED' || supplier.state === 'RESERVED' || supplier.state === 'PARTIALLY_FULFILLED') addBlocker('SUPPLIER_FULFILLMENT_PENDING', 'Supplier reservation or confirmation is still outstanding for one or more Booking Items.', 'HIGH', 'Booking', booking && booking.booking_id);
  if (finance.state === 'NOT_CONFIGURED' && booking) addBlocker('PAYMENT_OBLIGATIONS_MISSING', 'Authoritative client payment obligations have not been configured.', 'HIGH', 'Booking', booking.booking_id);
  if (finance.pendingVerification !== '0.00') addBlocker('PAYMENT_VERIFICATION_PENDING', finance.pendingVerification + ' ' + (finance.currency || '') + ' awaits payment verification.', 'HIGH', 'Booking', booking && booking.booking_id);
  if (finance.unallocatedVerified !== '0.00') addBlocker('PAYMENT_ALLOCATION_PENDING', finance.unallocatedVerified + ' ' + (finance.currency || '') + ' in verified funds is unallocated.', 'HIGH', 'Booking', booking && booking.booking_id);
  if (finance.outstanding !== '0.00') addBlocker('CLIENT_BALANCE_OUTSTANDING', finance.outstanding + ' ' + (finance.currency || '') + ' client balance remains outstanding.', 'HIGH', 'Booking', booking && booking.booking_id);
  if (finance.supplierPayableState === 'DRAFT') addBlocker('SUPPLIER_PAYABLE_NOT_APPROVED', 'Supplier Payable approval is required before Supplier Payment.', 'HIGH', 'Booking', booking && booking.booking_id);
  if (finance.supplierPaymentGate === 'BLOCKED' && finance.supplierPayableState === 'APPROVED') addBlocker('SUPPLIER_PAYMENT_FUNDS_INSUFFICIENT', 'Supplier Payment is blocked by the verified allocated funds gate.', 'HIGH', 'Booking', booking && booking.booking_id);
  documents.missing.forEach((item) => addBlocker('DOCUMENT_MISSING', 'Required document is missing or not accepted: ' + (item.type || item.document_id) + '.', 'HIGH', 'Booking', booking && booking.booking_id));
  serviceProjections.forEach((service) => service.blockers.forEach((blocker) => addBlocker(blocker.code, blocker.message, 'HIGH', blocker.recordType, blocker.recordId)));
  tasks.openTasks.forEach((task) => addBlocker('TASK_OUTSTANDING', task.description || 'Operational task remains open.', upper(task.state) === 'BLOCKED' ? 'HIGH' : 'MEDIUM', 'Task', task.task_id));
  exceptions.forEach((exception) => addBlocker(exception.code, exception.message, exception.severity, exception.recordType, exception.recordId));
  const responsibleRole = derived.action.responsibleRole;
  const responsibleTask = tasks.openTasks.find((task) => task.assigned_to || task.owner_id);
  const responsibleActor = { role: responsibleRole, actorId: responsibleTask && (responsibleTask.assigned_to || responsibleTask.owner_id) || null, source: responsibleTask ? 'TASK' : 'DERIVED_STAGE' };
  const allowedActions = [derived.action.code];
  const blockedActions = ['CREATE_BOOKING', 'REQUEST_SUPPLIER_RESERVATION', 'VERIFY_PAYMENT', 'ALLOCATE_PAYMENT', 'EXECUTE_SUPPLIER_PAYMENT', 'COMPLETE_DOCUMENTS', 'COMPLETE_TASKS', 'CASE_COMPLETE'].filter((action) => action !== derived.action.code).map((action) => ({ action, reason: 'The case is currently in ' + derived.stage + ' and this action is not the derived next action.' }));
  return {
    projectionVersion: CASE_PROJECTION_VERSION,
    asOf,
    identity,
    currentStage: derived.stage,
    nextAction: derived.action,
    blockers,
    deadlines,
    responsibleActor,
    exceptions,
    commercial: { optionState: optionState(optionsForCase, selectedOption), selectedOptionId: selectedOption && selectedOption.commercial_option_id || null, quotationState: quotationState(quotation, acceptance), quotationId: quotation && quotation.quotation_id || null },
    clientCommitment: { state: acceptance ? (booking && upper(booking.commitment_state) === 'REACCEPTANCE_REQUIRED' ? 'REACCEPTANCE_REQUIRED' : 'ACCEPTED') : 'PENDING', acceptanceId: acceptance && acceptance.quotation_acceptance_id || null, bookingState: booking && upper(booking.commitment_state || 'PENDING') || null },
    supplierFulfillment: supplier,
    finance,
    documents,
    tasks,
    profitability,
    readiness,
    services: serviceProjections,
    operationalCompletion,
    allowedActions,
    blockedActions
  };
}

function projectCases(source, options) {
  const entities = getEntities(source);
  return records(entities, 'Inquiry').map((inquiry) => projectCase(entities, { inquiry_id: inquiry.inquiry_id }, options));
}

module.exports = { CASE_PROJECTION_VERSION, CASE_STAGES, projectCase, projectCases, financeProjection, getEntities };
