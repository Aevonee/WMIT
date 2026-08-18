'use strict';

const { IdGenerator } = require('../ids/id-generator');
const { InMemoryRepository } = require('../repositories/memory-repository');
const { InMemoryAuditLog } = require('../logging/audit-log');
const { WmitError, errorResult } = require('../core/errors');
const { toMinorUnits, fromMinorUnits } = require('../core/money');
const quotationEditor = require('../application/quotation-editor');
const caseProjection = require('./case-projection');

const DEFAULT_BANK_DETAILS = [
  'Peso Account: 0126-9800-0261 — World Master International Travel (Swift: BNORPHMM · Branch: Fairview Terraces)',
  'Peso Account: 0661-9000-1008 — World Master International Travel',
  'Peso Account: 0045-1000-2291 — World Master International Travel',
  'Dollar Account: 1126-9000-1264 — World Master International Travel',
  'Dollar Account: 0660-1000-9272 — Leilani Agana (Swift: AUBKPHMM)'
].join('\n');

const ENTITY_DEFS = {
  Person: ['PERSON', false], Client: ['CLIENT', false], Inquiry: ['INQUIRY', true],
  CommercialOption: ['OPTION', true], AvailabilityEvidence: ['AVAILABILITY', true],
  Supplier: ['SUPPLIER', false], SupplierContact: ['SUPPLIER_CONTACT', true],
  SubAgent: ['SUB_AGENT', false],
  SupplierPackage: ['SUPPLIER_PACKAGE', true], Document: ['DOCUMENT', true],
  TariffSource: ['TARIFF', true], TariffExtractionFact: ['TARIFF_FACT', true],
  TariffRateComponent: ['TARIFF_RATE', true], TariffItineraryComponent: ['TARIFF_ITINERARY', true],
  CommercialPricingContext: ['PRICE_CONTEXT', true], Quotation: ['QUOTATION', true],
  QuotationAcceptance: ['QUOTATION_ACCEPTANCE', true],
  QuotationItem: ['QUOTATION_ITEM', true], Booking: ['BOOKING', true],
  OptionReplacement: ['OPTION_REPLACEMENT', true], FindMoreRequest: ['FIND_MORE', true],
  BookingParticipant: ['BOOKING_PARTICIPANT', true], BookingItem: ['BOOKING_ITEM', true],
  AvailabilityHold: ['AVAILABILITY_HOLD', true], TicketingRecord: ['TICKETING', true], Voucher: ['VOUCHER', true],
  RoomingListEntry: ['ROOMING_ENTRY', true],
  SupplierBooking: ['SUPPLIER_BOOKING', true], SupplierBookingItem: ['SUPPLIER_BOOKING_ITEM', true],
  ClientObligation: ['CLIENT_OBLIGATION', true], ClientInvoice: ['CLIENT_INVOICE', true], PaymentScheduleItem: ['PAYMENT_SCHEDULE', true], ClientPayment: ['CLIENT_PAYMENT', true],
  PaymentEvidence: ['PAYMENT_EVIDENCE', true], PaymentAllocation: ['PAYMENT_ALLOCATION', true],
  SupplierPayable: ['SUPPLIER_PAYABLE', true], SupplierPayment: ['SUPPLIER_PAYMENT', true],
  RefundAdjustment: ['REFUND_ADJUSTMENT', true], Amendment: ['AMENDMENT', true], Reconciliation: ['RECONCILIATION', true],
  Task: ['TASK', true], CommunicationActivity: ['COMMUNICATION', true],
  Departure: ['DEPARTURE', true], DepartureMembership: ['DEPARTURE_MEMBERSHIP', true], DepartureReadinessIssue: ['DEPARTURE_ISSUE', true],
  ExpoLead: ['EXPO_LEAD', true], ExpoPackageTemplate: ['EXPO_PACKAGE', true], ExpoQuote: ['EXPO_QUOTE', true],
  ExpoEvent: ['EXPO_EVENT', true], Receipt: ['RECEIPT', true],
  AuditEvent: ['AUDIT_EVENT', true]
};

const ACTIONS = Object.freeze({
  VERIFY_PAYMENT: 'VERIFY_PAYMENT', ALLOCATE_PAYMENT: 'ALLOCATE_PAYMENT', EDIT_DRAFT_PRICING: 'EDIT_DRAFT_PRICING',
  SELECT_OPTION: 'SELECT_OPTION', APPROVE_QUOTATION: 'APPROVE_QUOTATION', REVISE_QUOTATION: 'REVISE_QUOTATION',
  RESERVE_SUPPLIER: 'RESERVE_SUPPLIER', APPROVE_PAYABLE: 'APPROVE_PAYABLE',
  SUPPLIER_PAYMENT: 'SUPPLIER_PAYMENT', PRICE_OVERRIDE: 'PRICE_OVERRIDE',
  CONFIRM_COMMITMENT: 'CONFIRM_COMMITMENT', REFUND: 'REFUND',
  DELETE_TARIFF: 'DELETE_TARIFF', DELETE_SUPPLIER: 'DELETE_SUPPLIER',
  CLIENT_ACCEPT_AMENDMENT: 'CLIENT_ACCEPT_AMENDMENT', ACCEPT_QUOTATION: 'ACCEPT_QUOTATION',
  RECORD_TICKETING: 'RECORD_TICKETING', ISSUE_VOUCHER: 'ISSUE_VOUCHER', RECONCILE_BOOKING: 'RECONCILE_BOOKING', CONFIGURE_SETTINGS: 'CONFIGURE_SETTINGS'
});

const clone = (value) => JSON.parse(JSON.stringify(value));

// This is intentionally configuration-backed. The UI may present these values,
// but the runtime remains the authority for what can be classified and priced.
const DEFAULT_TARIFF_RATE_UNITS = Object.freeze([
  'PER_PERSON', 'PER_PERSON_PER_NIGHT', 'PER_PERSON_PER_WAY',
  'PER_ROOM', 'PER_ROOM_PER_NIGHT', 'PER_NIGHT',
  'PER_VEHICLE', 'PER_VEHICLE_PER_WAY',
  'PER_GROUP', 'PER_GROUP_PER_DAY', 'PER_SERVICE',
  'OTHER_SUPPLIER_SPECIFIED'
]);
const REQUIREMENT_STATUS_VALUES = Object.freeze(['REQUIRED', 'PREFERRED', 'UNKNOWN', 'NOT_APPLICABLE']);
const FIND_MORE_REASON_VALUES = Object.freeze(['CLIENT_REJECTED', 'PRICE_TOO_HIGH', 'HOTEL_NOT_PREFERRED', 'ITINERARY_NOT_SUITABLE', 'SUPPLIER_PREFERENCE', 'NEED_MORE_CHOICES', 'OTHER']);
const ROOMING_CAPACITY = Object.freeze({ SGL: 1, TWN: 2, DBL: 2, TRP: 3, QUAD: 4 });

function ok(data, meta) { return { ok: true, data, meta: meta || {} }; }
function fail(error) { return errorResult(error); }
function requireValue(value, name) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new WmitError('REQUIRED_FIELD', name + ' is required.', { field: name });
  }
  return value;
}
function money(value, field) {
  try { return fromMinorUnits(toMinorUnits(requireValue(value, field || 'amount'))); }
  catch (error) { throw new WmitError('INVALID_MONEY', (field || 'amount') + ' must be a valid non-negative amount.', { field: field || 'amount' }); }
}
function addMoney(a, b) { return fromMinorUnits(toMinorUnits(a || 0) + toMinorUnits(b || 0)); }
function subtractMoney(a, b) {
  const result = toMinorUnits(a || 0) - toMinorUnits(b || 0);
  if (result < 0n) return '0.00';
  return fromMinorUnits(result);
}
function normalizeRoomingOccupancy(value) {
  const raw = String(requireValue(value, 'occupancy')).trim().toUpperCase().replace(/[\s_-]+/g, '');
  const aliases = { SINGLE: 'SGL', TWIN: 'TWN', DOUBLE: 'DBL', TRIPLE: 'TRP', QUADRUPLE: 'QUAD' };
  return aliases[raw] || raw;
}
function multiplyMoney(amount, quantity) {
  const result = toMinorUnits(amount || 0) * BigInt(Math.max(0, Math.round(Number(quantity || 0))));
  return fromMinorUnits(result);
}
function canonicalRoomArrangement(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized === 'TWN' ? 'DBL_TWN' : normalized;
}
function percentage(amount, rate) {
  const cents = toMinorUnits(amount || 0);
  return fromMinorUnits((cents * BigInt(Math.round(Number(rate) * 100))) / 10000n);
}
function dateOnlyPlusDays(value, days) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}
function dateOnlyMinusBusinessDays(value, days) {
  const date = new Date(value);
  let remaining = Math.max(0, Number(days || 0));
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() - 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return date.toISOString().slice(0, 10);
}
function defaultPaymentDueDate(booking, purpose, defaults) {
  const values = defaults || {};
  if (purpose === 'DOWN_PAYMENT') return dateOnlyPlusDays(booking.booking_date || booking.created_at || new Date().toISOString(), values.downPaymentDaysAfterReservation === undefined ? 3 : values.downPaymentDaysAfterReservation);
  if (purpose === 'FINAL_BALANCE' && booking.travel_start) return dateOnlyMinusBusinessDays(booking.travel_start, values.finalBalanceBusinessDaysBeforeDeparture === undefined ? 30 : values.finalBalanceBusinessDaysBeforeDeparture);
  return null;
}

class Phase1Runtime {
  constructor(options) {
    const opts = options || {};
    this.clock = opts.clock || (() => new Date());
    this.idGenerator = opts.idGenerator || new IdGenerator({ clock: this.clock });
    this.auditLog = opts.auditLog || new InMemoryAuditLog({ clock: this.clock, idGenerator: new IdGenerator({ clock: this.clock }) });
    this.config = Object.assign({
      timezone: 'Asia/Manila', defaultCurrency: 'PHP', standardMarkup: 30,
      cardPaypalFee: 5, tariffDefaultUnits: { accommodation: 'PER_PERSON', transfer: 'PER_PERSON_PER_WAY' },
      tariffRateUnits: DEFAULT_TARIFF_RATE_UNITS.slice(),
      quotationDefaults: { paymentTerms: '50% deposit upon confirmation; balance due 30 business days before departure.', validityDays: 7, currency: 'PHP', paymentCurrencyPolicy: 'Payment due in quotation currency.', downPaymentDaysAfterReservation: 3, finalBalanceBusinessDaysBeforeDeparture: 30, bankDetails: DEFAULT_BANK_DETAILS },
      messageTemplates: [],
      trustedActors: {}, expo: { id: 'EXPO-MVP', name: 'WMIT Expo', startAt: null, endAt: null, discountPercent: 0 }
    }, opts.config || {});
    this.onSettingsChanged = typeof opts.onSettingsChanged === 'function' ? opts.onSettingsChanged : null;
    this.repos = {};
    // Hosted deployments inject SQLite-backed repositories; local and test
    // runs keep the in-memory default. The interface is identical.
    const makeRepository = opts.repositoryFactory || ((type, repoOptions) => new InMemoryRepository(type, repoOptions));
    Object.keys(ENTITY_DEFS).forEach((type) => {
      this.repos[type] = makeRepository(type, { idField: this.idField(type) });
    });
  }

  idField(type) { return type.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase() + '_id'; }
  now() { return this.clock().toISOString(); }
  context(context) { return Object.assign({ actor: 'LOCAL_STAFF' }, context || {}); }
  actorCan(action, context) {
    const ctx = this.context(context);
    const allowed = this.config.trustedActors && this.config.trustedActors[ctx.actor];
    return Array.isArray(allowed) && allowed.includes(action);
  }
  requireAuthorization(action, context) {
    if (!this.actorCan(action, context)) {
      throw new WmitError('AUTHORIZATION_REQUIRED', 'This action is blocked until a trusted actor with the configured authority is available.', { action });
    }
  }
  id(type, supplied) {
    const def = ENTITY_DEFS[type];
    if (!def) throw new WmitError('UNKNOWN_ENTITY', 'Unknown Phase 1 entity ' + type + '.');
    const prefix = def[0];
    if (supplied) {
      if (!String(supplied).startsWith(prefix + '-')) throw new WmitError('INVALID_ID', type + ' IDs must start with ' + prefix + '-.');
      this.idGenerator.reserve(prefix, supplied, { yearBased: def[1] });
      return supplied;
    }
    return this.idGenerator.next(prefix, { yearBased: def[1] });
  }
  audit(action, type, record, context, details, result) {
    this.auditLog.record({ actor: this.context(context).actor, action, entity_type: type, entity_id: record && record[this.idField(type)], result: result || 'SUCCESS', details: details || {}, correlation_id: this.context(context).correlationId });
  }
  auditFailure(action, type, input, context, error) {
    try {
      this.auditLog.record({
        actor: this.context(context).actor, action, entity_type: type,
        entity_id: input && this.idField(type) ? input[this.idField(type)] || null : null,
        result: 'FAILURE',
        details: { error_code: error && error.code ? error.code : 'UNEXPECTED_ERROR', error_message: error && error.message ? String(error.message).slice(0, 300) : null },
        correlation_id: this.context(context).correlationId
      });
    } catch (_) { /* failure audit is best effort and must never mask the original error */ }
  }
  createRecord(type, input, context) {
    const ctx = this.context(context);
    try {
      const source = Object.assign({}, input || {});
      if (source.idempotency_key) {
        const prior = this.list(type, (record) => record.idempotency_key === source.idempotency_key);
        if (prior.length) return ok(prior[0], { action: 'IDEMPOTENT_REPLAY', idempotent: true });
      }
      const idField = this.idField(type);
      const id = this.id(type, source[idField]);
      const timestamp = this.now();
      const record = Object.assign({}, source, { [idField]: id, created_at: source.created_at || timestamp, created_by: source.created_by || ctx.actor, updated_at: timestamp, updated_by: ctx.actor, record_version: 1 });
      const saved = this.repos[type].insert(record);
      this.audit('CREATE', type, saved, ctx);
      return ok(saved, { action: 'CREATE' });
    } catch (error) {
      this.auditFailure('CREATE', type, input, ctx, error);
      return fail(error);
    }
  }
  get(type, id) { const record = this.repos[type].get(id); if (!record) throw new WmitError('NOT_FOUND', type + ' ' + id + ' was not found.', { type, id }); return record; }
  list(type, predicate) { return this.repos[type].list().filter(predicate || (() => true)); }
  auditValue_(value) {
    if (value === undefined) return null;
    const text = JSON.stringify(value);
    if (text === undefined) return null;
    return text.length > 1000 ? text.slice(0, 1000) + '…[truncated]' : JSON.parse(text);
  }
  updateRecord(type, id, changes, context) {
    const ctx = this.context(context);
    try {
      const current = this.get(type, id);
      const applied = Object.assign({}, changes || {});
      const expectedVersion = applied.expected_record_version;
      delete applied.expected_record_version;
      if (expectedVersion !== undefined && expectedVersion !== null && Number(expectedVersion) !== Number(current.record_version)) {
        throw new WmitError('VERSION_CONFLICT', 'The record changed before this update was saved. Reload the record and retry.', { expected_record_version: Number(expectedVersion), current_record_version: current.record_version });
      }
      const changedKeys = Object.keys(applied).filter((key) => JSON.stringify(current[key]) !== JSON.stringify(applied[key]));
      const updated = this.repos[type].update(id, Object.assign({}, applied, { updated_at: this.now(), updated_by: ctx.actor, record_version: current.record_version + 1 }));
      this.audit('UPDATE', type, updated, ctx, {
        changedFields: changedKeys,
        old_values: changedKeys.reduce((carry, key) => Object.assign(carry, { [key]: this.auditValue_(current[key]) }), {}),
        new_values: changedKeys.reduce((carry, key) => Object.assign(carry, { [key]: this.auditValue_(updated[key]) }), {})
      });
      return ok(updated, { action: 'UPDATE' });
    } catch (error) {
      this.auditFailure('UPDATE', type, { [this.idField(type)]: id }, ctx, error);
      return fail(error);
    }
  }
  must(type, id) { return this.get(type, id); }
  createPerson(input, context) { return this.createRecord('Person', Object.assign({ role_notes: [] }, input, { status: input.status || 'ACTIVE' }), context); }
  createClient(input, context) {
    try {
      const value = Object.assign({}, input || {});
      const displayName = String(value.display_name || value.legal_name || '').trim();
      requireValue(displayName, 'display_name');
      const normalized = displayName.toLowerCase();
      const duplicate = this.list('Client', (client) => String(client.display_name || '').trim().toLowerCase() === normalized);
      if (duplicate.length) {
        throw new WmitError('CLIENT_DUPLICATE', 'A client with that name already exists (' + duplicate[0].client_id + '). Open the existing record instead of creating a second one.', { display_name: displayName, existing_client_id: duplicate[0].client_id });
      }
      return this.createRecord('Client', Object.assign({ status: 'ACTIVE' }, value, {
        display_name: displayName,
        legal_name: String(value.legal_name || displayName).trim()
      }), context);
    } catch (error) { return fail(error); }
  }
  updateClient(clientId, changes, context) {
    try {
      const current = this.must('Client', clientId);
      const next = Object.assign({}, current, changes || {});
      const displayName = String(next.display_name || next.legal_name || '').trim();
      requireValue(displayName, 'display_name');
      return this.updateRecord('Client', clientId, Object.assign({}, changes || {}, {
        display_name: displayName,
        legal_name: String(next.legal_name || displayName).trim()
      }), context);
    } catch (error) { return fail(error); }
  }
  createSupplier(input, context) {
    try {
      const value = Object.assign({}, input || {});
      const displayName = String(value.display_name || value.legal_name || '').trim();
      requireValue(displayName, 'display_name');
      const normalized = displayName.toLowerCase();
      if (this.list('Supplier', (supplier) => String(supplier.display_name || '').trim().toLowerCase() === normalized).length) {
        throw new WmitError('SUPPLIER_DUPLICATE', 'A supplier with that name already exists.', { display_name: displayName });
      }
      return this.createRecord('Supplier', Object.assign({ status: 'ACTIVE', capabilities: [] }, value, {
        display_name: displayName,
        legal_name: String(value.legal_name || displayName).trim()
      }), context);
    } catch (error) { return fail(error); }
  }
  createSupplierContact(input, context) {
    try {
      const value = Object.assign({}, input || {});
      requireValue(value.supplier_id, 'supplier_id');
      this.must('Supplier', value.supplier_id);
      return this.createRecord('SupplierContact', value, context);
    } catch (error) { return fail(error); }
  }
  updateSupplier(supplierId, changes, context) {
    try {
      const current = this.must('Supplier', supplierId);
      const next = Object.assign({}, current, changes || {});
      const displayName = String(next.display_name || next.legal_name || '').trim();
      requireValue(displayName, 'display_name');
      const normalized = displayName.toLowerCase();
      const clash = this.list('Supplier', (supplier) => String(supplier.display_name || '').trim().toLowerCase() === normalized && supplier.supplier_id !== supplierId);
      if (clash.length) {
        throw new WmitError('SUPPLIER_DUPLICATE', 'Another supplier with that name already exists.', { display_name: displayName, supplier_id: clash[0].supplier_id });
      }
      return this.updateRecord('Supplier', supplierId, Object.assign({}, changes || {}, {
        display_name: displayName,
        legal_name: String(next.legal_name || displayName).trim()
      }), context);
    } catch (error) { return fail(error); }
  }
  deleteSupplier(input, context) {
    try {
      this.requireAuthorization(ACTIONS.DELETE_SUPPLIER, context);
      const value = input || {};
      if (value.confirm !== true) {
        throw new WmitError('DELETE_CONFIRMATION_REQUIRED', 'Supplier deletion requires an explicit confirmation.', { supplier_id: value.supplier_id || null });
      }
      const supplier = this.must('Supplier', requireValue(value.supplier_id, 'supplier_id'));
      const blocking = {};
      [['TariffSource', 'tariff_sources'], ['SupplierPackage', 'packages'], ['SupplierBooking', 'supplier_bookings'], ['SupplierPayable', 'supplier_payables'], ['BookingItem', 'booking_items'], ['Document', 'documents']].forEach((pair) => {
        const count = this.list(pair[0], (record) => record.supplier_id === supplier.supplier_id).length;
        if (count) blocking[pair[1]] = count;
      });
      if (Object.keys(blocking).length) {
        throw new WmitError('SUPPLIER_IN_USE', 'This supplier is referenced by operational or financial records and cannot be deleted.', { supplier_id: supplier.supplier_id, blocking_records: blocking });
      }
      const contacts = this.list('SupplierContact', (record) => record.supplier_id === supplier.supplier_id);
      contacts.forEach((contact) => {
        this.repos.SupplierContact.delete(contact.supplier_contact_id);
        this.audit('DELETE', 'SupplierContact', contact, context);
      });
      this.repos.Supplier.delete(supplier.supplier_id);
      this.audit('DELETE', 'Supplier', supplier, context, {
        deleted_contacts: contacts.length,
        display_name: supplier.display_name || null,
        country: supplier.country || null
      });
      return ok({ deleted: true, supplier_id: supplier.supplier_id, removed_contacts: contacts.length }, { action: 'DELETE_SUPPLIER' });
    } catch (error) {
      this.auditFailure('DELETE_SUPPLIER', 'Supplier', input, this.context(context), error);
      return fail(error);
    }
  }
  createSubAgent(input, context) {
    try {
      const value = Object.assign({}, input || {});
      const name = String(value.display_name || value.legal_name || value.name || '').trim();
      requireValue(name, 'display_name');
      const roles = Array.isArray(value.roles) ? value.roles.filter(Boolean) : [];
      if (!roles.length) throw new WmitError('SUB_AGENT_ROLE_REQUIRED', 'Select at least one sub-agent role.');
      return this.createRecord('SubAgent', Object.assign({ status: 'ACTIVE' }, value, { display_name: name, roles }), context);
    } catch (error) { return fail(error); }
  }
  updateSubAgent(subAgentId, changes, context) {
    try {
      const current = this.must('SubAgent', subAgentId);
      const next = Object.assign({}, current, changes || {});
      const name = String(next.display_name || next.legal_name || next.name || '').trim();
      requireValue(name, 'display_name');
      const roles = Array.isArray(next.roles) ? next.roles.filter(Boolean) : [];
      if (!roles.length) throw new WmitError('SUB_AGENT_ROLE_REQUIRED', 'Select at least one sub-agent role.');
      return this.updateRecord('SubAgent', subAgentId, Object.assign({}, changes || {}, { display_name: name, roles }), context);
    } catch (error) { return fail(error); }
  }
  createInquiry(input, context) {
    try {
      requireValue(input && input.client_id, 'client_id'); this.must('Client', input.client_id);
      const original = clone(input.requirements || input.original_request || {});
      requireValue(original.destination, 'requirements.destination');
      this.normalizeTripTiming(original);
      const composition = this.normalizeTravelerComposition(original);
      Object.assign(original, composition);
      original.requirement_statuses = this.normalizeRequirementStatuses(original, input.requirement_statuses);
      const currentRequirements = clone(input.requirements || original);
      Object.assign(currentRequirements, {
        duration_days: original.duration_days,
        nights: original.nights,
        ...composition
      });
      currentRequirements.requirement_statuses = clone(original.requirement_statuses);
      Object.keys(currentRequirements).forEach((key) => { if (currentRequirements[key] === undefined) delete currentRequirements[key]; });
      return this.createRecord('Inquiry', Object.assign({}, input, { original_request: original, current_requirements: currentRequirements, state: input.state || 'NEW', history: [{ at: this.now(), type: 'ORIGINAL', value: original }] }), context);
    } catch (error) { return fail(error); }
  }
  normalizeTravelerComposition(requirements) {
    const r = requirements || {};
    const hasComposition = ['adults', 'children', 'infants'].some((field) => r[field] !== undefined && r[field] !== null && r[field] !== '');
    const nonNegativeInteger = (value, field) => {
      const number = Number(value);
      if (!Number.isInteger(number) || number < 0) throw new WmitError('TRAVELER_COMPOSITION_INVALID', field + ' must be a non-negative whole number.', { field });
      return number;
    };
    const adults = hasComposition ? nonNegativeInteger(r.adults === undefined ? 0 : r.adults, 'requirements.adults') : nonNegativeInteger(r.pax_count || 0, 'requirements.pax_count');
    const children = hasComposition ? nonNegativeInteger(r.children === undefined ? 0 : r.children, 'requirements.children') : 0;
    const infants = hasComposition ? nonNegativeInteger(r.infants === undefined ? 0 : r.infants, 'requirements.infants') : 0;
    const paxCount = adults + children + infants;
    if (paxCount <= 0) throw new WmitError('TRAVELER_COMPOSITION_REQUIRED', 'At least one adult, child, or infant is required.');
    const childAges = Array.isArray(r.child_ages) ? r.child_ages.map((age) => Number(age)) : [];
    if (childAges.some((age) => !Number.isInteger(age) || age < 0 || age > 17)) throw new WmitError('CHILD_AGES_INVALID', 'Child ages must be whole numbers from 0 through 17.', { field: 'requirements.child_ages' });
    if (childAges.length && childAges.length !== children) throw new WmitError('CHILD_AGES_COUNT_MISMATCH', 'Provide one age for each child, or leave child ages blank until the selected tariff requires them.', { children, child_ages: childAges.length });
    return { adults, children, infants, pax_count: paxCount, child_ages: childAges.length ? childAges : undefined };
  }
  normalizeRequirementStatuses(requirements, supplied) {
    const values = Object.assign({}, supplied || requirements && requirements.requirement_statuses || {});
    Object.keys(values).forEach((field) => {
      if (!REQUIREMENT_STATUS_VALUES.includes(values[field])) throw new WmitError('INVALID_REQUIREMENT_STATUS', 'Requirement status is not supported.', { field, status: values[field], allowed: REQUIREMENT_STATUS_VALUES });
    });
    ['destination', 'travel_start', 'travel_end', 'travel_month', 'travel_year', 'duration_days', 'adults', 'children', 'infants'].forEach((field) => {
      if (values[field] === undefined && requirements && requirements[field] !== undefined && requirements[field] !== null && requirements[field] !== '') values[field] = 'REQUIRED';
    });
    return values;
  }
  normalizeTripTiming(requirements) {
    const original = requirements || {};
    const hasSpecificDate = Boolean(original.travel_start || original.travel_end);
    const hasTravelMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(original.travel_month || ''));
    const hasTravelYear = /^(19|20)\d{2}$/.test(String(original.travel_year || ''));
    if (!hasSpecificDate && !hasTravelMonth && !hasTravelYear) throw new WmitError('TRAVEL_DATE_REQUIRED', 'A travel date is required. Provide a specific travel date, or a travel month and year.');
    if (hasSpecificDate && (hasTravelMonth || hasTravelYear)) throw new WmitError('TRAVEL_DATE_AMBIGUOUS', 'Provide either a specific travel date or an approximate travel month/year, not both.');
    if (original.travel_end && !original.travel_start) throw new WmitError('TRAVEL_DATE_RANGE_INVALID', 'Travel start date is required when a travel end date is provided.');
    if (original.travel_start && original.travel_end && String(original.travel_end) < String(original.travel_start)) throw new WmitError('TRAVEL_DATE_RANGE_INVALID', 'Travel end date cannot be before travel start date.');
    if (!hasSpecificDate && (hasTravelMonth || hasTravelYear)) {
      const durationDays = Number(original.duration_days);
      if (!Number.isInteger(durationDays) || durationDays <= 0) throw new WmitError('TRIP_DURATION_REQUIRED', 'A trip duration in days is required when only an approximate month or year is known.', { field: 'requirements.duration_days' });
      original.duration_days = durationDays;
      original.nights = durationDays - 1;
    }
    if (hasSpecificDate && original.travel_start && original.travel_end) {
      const days = Math.round((new Date(original.travel_end) - new Date(original.travel_start)) / 86400000) + 1;
      if (days <= 0) throw new WmitError('TRAVEL_DATE_RANGE_INVALID', 'Travel dates must form a positive trip duration.');
      original.duration_days = days;
      original.nights = days - 1;
    }
    return original;
  }
  updateInquiry(inquiryId, changes, context) {
    try {
      const current = this.must('Inquiry', inquiryId);
      const changedRequirements = changes && (changes.requirements || changes.current_requirements);
      const history = current.history || [];
      if (changedRequirements) {
        const nextRequirements = clone(changedRequirements);
        requireValue(nextRequirements.destination, 'requirements.destination');
        this.normalizeTripTiming(nextRequirements);
        Object.assign(nextRequirements, this.normalizeTravelerComposition(nextRequirements));
        nextRequirements.requirement_statuses = this.normalizeRequirementStatuses(nextRequirements, nextRequirements.requirement_statuses || current.current_requirements && current.current_requirements.requirement_statuses);
          history.push({ at: this.now(), type: 'REQUIREMENTS_CHANGED', value: clone(nextRequirements), actor: this.context(context).actor });
          const updated = this.updateRecord('Inquiry', inquiryId, Object.assign({}, changes, { current_requirements: nextRequirements, history }), context);
          if (!updated.ok) return updated;
          this.list('Quotation', (quote) => quote.inquiry_id === inquiryId).forEach((quote) => {
            this.updateRecord('Quotation', quote.quotation_id, {
              revision_required: true,
              revision_reason: 'Inquiry requirements changed',
              status: quote.status === 'APPROVED' ? 'DRAFT' : quote.status
            }, context);
          });
          this.list('Booking', (booking) => booking.inquiry_id === inquiryId).forEach((booking) => {
            this.updateRecord('Booking', booking.booking_id, {
              commitment_state: 'REACCEPTANCE_REQUIRED',
              client_decision_state: 'CHANGED_REQUIREMENTS_REQUIRES_REACCEPTANCE'
            }, context);
          });
          return updated;
        }
      return this.updateRecord('Inquiry', inquiryId, changes, context);
    } catch (error) { return fail(error); }
  }
  createCommunication(input, context) { return this.createRecord('CommunicationActivity', Object.assign({ occurred_at: this.now() }, input), context); }
  createDocument(input, context) { return this.createRecord('Document', Object.assign({ review_status: 'NEEDS_REVIEW', status: 'RECEIVED' }, input), context); }

  uploadTariff(input, context) {
    try {
      if (input && input.idempotency_key) {
        const prior = this.list('TariffSource', (record) => record.idempotency_key === input.idempotency_key);
        if (prior.length) return ok(prior[0], { action: 'IDEMPOTENT_REPLAY', idempotent: true });
      }
      this.must('Supplier', input.supplier_id);
      const source = this.createRecord('TariffSource', Object.assign({ status: 'NEEDS_REVIEW', trusted: false, supplier_name: this.must('Supplier', input.supplier_id).display_name, original_source: clone(input.original_source || { file_name: input.file_name, file_ref: input.file_ref }), extraction_summary: clone(input.extraction_summary || {}) }, input), context);
      if (!source.ok) return source;
      const tariffId = source.data.tariff_source_id;
      const facts = (input.extraction_facts || []).map((fact) => this.createRecord('TariffExtractionFact', Object.assign({}, fact, { tariff_source_id: tariffId, review_status: fact.review_status || 'NEEDS_REVIEW' }), context).data);
      const rates = (input.rate_components || []).map((rate) => this.createRecord('TariffRateComponent', Object.assign({}, rate, { tariff_source_id: tariffId, review_status: rate.review_status || 'NEEDS_REVIEW' }), context).data);
      const itinerary = (input.itinerary_components || []).map((item) => this.createRecord('TariffItineraryComponent', Object.assign({}, item, { tariff_source_id: tariffId, review_status: item.review_status || 'NEEDS_REVIEW' }), context).data);
      return ok(Object.assign({}, source.data, { extraction_facts: facts, rate_components: rates, itinerary_components: itinerary }), { action: 'UPLOAD_TARIFF', trusted: false });
    } catch (error) { return fail(error); }
  }
  reviewTariff(input, context) {
    try {
      const tariff = this.must('TariffSource', input.tariff_source_id);
      const rates = this.list('TariffRateComponent', (r) => r.tariff_source_id === tariff.tariff_source_id);
      const facts = this.list('TariffExtractionFact', (r) => r.tariff_source_id === tariff.tariff_source_id);
      const factIds = new Set(facts.map((fact) => fact.tariff_extraction_fact_id));
      const rateIds = new Set(rates.map((rate) => rate.tariff_rate_component_id));
      Object.keys(input.corrections || {}).forEach((id) => { if (!factIds.has(id)) throw new WmitError('TARIFF_FACT_MISMATCH', 'The tariff correction does not belong to this tariff source.', { tariff_source_id: tariff.tariff_source_id, tariff_fact_id: id }); });
      Object.keys(input.rate_corrections || {}).forEach((id) => { if (!rateIds.has(id)) throw new WmitError('TARIFF_RATE_MISMATCH', 'The tariff rate correction does not belong to this tariff source.', { tariff_source_id: tariff.tariff_source_id, tariff_rate_id: id }); });
      const confirmedFactIds = new Set(input.confirmed_fact_ids || []);
      const confirmedRateIds = new Set(input.confirmed_rate_ids || []);
      const proposedFacts = facts.map((fact) => Object.assign({}, fact, input.corrections && input.corrections[fact.tariff_extraction_fact_id] || {}, input.corrections && input.corrections[fact.tariff_extraction_fact_id] ? { review_status: 'CONFIRMED', ambiguous: false } : {}, confirmedFactIds.has(fact.tariff_extraction_fact_id) ? { review_status: 'CONFIRMED' } : {}));
      const proposedRates = rates.map((rate) => Object.assign({}, rate, input.rate_corrections && input.rate_corrections[rate.tariff_rate_component_id] || {}, input.rate_corrections && input.rate_corrections[rate.tariff_rate_component_id] ? { review_status: 'CONFIRMED', requires_explicit_review: false } : {}, confirmedRateIds.has(rate.tariff_rate_component_id) ? { review_status: 'CONFIRMED', requires_explicit_review: false } : {}));
      const unresolved = proposedFacts.filter((f) => (Number(f.confidence || 0) < 0.8 || f.ambiguous) && f.review_status !== 'CONFIRMED');
      if (unresolved.length) return fail(new WmitError('TARIFF_REVIEW_REQUIRED', 'Tariff cannot become trusted while ambiguous or low-confidence facts remain unresolved.', { fact_ids: unresolved.map((f) => f.tariff_extraction_fact_id) }));
      const currencyFact = proposedFacts.find((f) => ['currency', 'rate_currency'].includes(f.field_name));
      const unitFact = proposedFacts.find((f) => ['rate_unit', 'rate_unit_basis'].includes(f.field_name));
      const factIsConfirmed = (fact) => fact && fact.normalized_value && (fact.review_status === 'CONFIRMED' || (Number(fact.confidence || 0) >= 0.8 && !fact.ambiguous));
      if (input.approve === true && currencyFact && !factIsConfirmed(currencyFact)) return fail(new WmitError('TARIFF_CURRENCY_REQUIRED', 'A tariff rate currency must be explicitly confirmed before the tariff becomes trusted.'));
      if (input.approve === true && unitFact && !factIsConfirmed(unitFact)) return fail(new WmitError('TARIFF_RATE_UNIT_REQUIRED', 'A tariff rate unit must be explicitly confirmed before the tariff becomes trusted.'));
      if (input.approve === true && unitFact && !this.config.tariffRateUnits.includes(String(unitFact.normalized_value).toUpperCase())) return fail(new WmitError('TARIFF_RATE_UNIT_INVALID', 'The selected tariff rate unit is not in the configured WMIT unit model.', { rate_unit: unitFact.normalized_value, allowed: this.config.tariffRateUnits }));
      const unresolvedRates = proposedRates.filter((rate) => rate.requires_explicit_review && rate.review_status !== 'CONFIRMED');
      if (unresolvedRates.length) return fail(new WmitError('TARIFF_RATE_REVIEW_REQUIRED', 'Tariff cannot become trusted while conditional rate cells remain unresolved.', { rate_ids: unresolvedRates.map((rate) => rate.tariff_rate_component_id) }));
      if (input.approve === true && currencyFact && unitFact) {
        proposedRates.forEach((rate) => {
          Object.assign(rate, {
          currency: currencyFact.normalized_value, currency_status: 'CONFIRMED',
          rate_unit: unitFact.normalized_value, rate_unit_status: 'CONFIRMED',
          requires_explicit_review: false
          });
        });
      }
      proposedFacts.filter((fact) => factIsConfirmed(fact) && fact.review_status !== 'CONFIRMED').forEach((fact) => { fact.review_status = 'CONFIRMED'; });
      const status = input.approve === true ? 'ACTIVE' : 'REVIEWED';
      proposedFacts.forEach((fact) => {
        const changes = {};
        ['normalized_value', 'confidence', 'ambiguous', 'review_status'].forEach((field) => { if (fact[field] !== facts.find((currentFact) => currentFact.tariff_extraction_fact_id === fact.tariff_extraction_fact_id)[field]) changes[field] = fact[field]; });
        if (Object.keys(changes).length) this.updateRecord('TariffExtractionFact', fact.tariff_extraction_fact_id, changes, context);
      });
      proposedRates.forEach((rate) => {
        const original = rates.find((currentRate) => currentRate.tariff_rate_component_id === rate.tariff_rate_component_id);
        const changes = {};
        ['amount', 'currency', 'currency_status', 'rate_unit', 'rate_unit_status', 'requires_explicit_review', 'review_status', 'conditions'].forEach((field) => { if (rate[field] !== original[field]) changes[field] = rate[field]; });
        if (Object.keys(changes).length) this.updateRecord('TariffRateComponent', rate.tariff_rate_component_id, changes, context);
      });
      const updated = this.updateRecord('TariffSource', tariff.tariff_source_id, { status, trusted: input.approve === true, reviewed_at: this.now(), reviewed_by: this.context(context).actor }, context);
      if (!updated.ok) return updated;
      return ok(this.must('TariffSource', tariff.tariff_source_id), { action: 'REVIEW_TARIFF', trusted: input.approve === true });
    } catch (error) { return fail(error); }
  }
  // --------------------------------------------------- manual tariff entry
  //
  // The standard template path: staff encode rates by hand instead of
  // relying on extraction. Currency and rate unit are captured up front
  // (confirmed facts), manually added rates are confirmed rows, so the
  // tariff can be trusted with one review click.

  createManualTariff(input, context) {
    try {
      const value = input || {};
      const supplier = this.must('Supplier', requireValue(value.supplier_id, 'supplier_id'));
      const currency = String(requireValue(value.currency || 'PHP', 'currency')).trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new WmitError('INVALID_CURRENCY', 'Currency must be a three-letter code.', { currency });
      const rateUnit = String(value.rate_unit || 'PER_PERSON').trim().toUpperCase();
      if (!this.config.tariffRateUnits.includes(rateUnit)) throw new WmitError('TARIFF_RATE_UNIT_INVALID', 'The rate unit is not in the configured WMIT unit model.', { rate_unit: rateUnit, allowed: this.config.tariffRateUnits });
      const datePattern = /^\d{4}-\d{2}-\d{2}$/;
      const validityStart = value.validity_start ? String(value.validity_start) : null;
      const validityEnd = value.validity_end ? String(value.validity_end) : null;
      if (validityStart && !datePattern.test(validityStart)) throw new WmitError('TARIFF_DATE_INVALID', 'Validity start must look like 2026-04-01.', { validity_start: validityStart });
      if (validityEnd && !datePattern.test(validityEnd)) throw new WmitError('TARIFF_DATE_INVALID', 'Validity end must look like 2026-10-31.', { validity_end: validityEnd });
      if (validityStart && validityEnd && validityEnd < validityStart) throw new WmitError('TARIFF_DATE_RANGE_INVALID', 'Validity end cannot be before the start.', { validity_start: validityStart, validity_end: validityEnd });
      const created = this.createRecord('TariffSource', {
        supplier_id: supplier.supplier_id,
        supplier_name: supplier.display_name,
        file_name: 'Manual tariff — ' + supplier.display_name,
        file_ref: 'manual://' + supplier.supplier_id + '/' + this.now(),
        original_source: { file_name: 'Manual entry', source_type: 'MANUAL_ENTRY', entered_by: this.context(context).actor },
        status: 'NEEDS_REVIEW',
        trusted: false,
        extraction_summary: { method: 'MANUAL_ENTRY', rate_components: 0, review_required: true, warnings: [] },
        idempotency_key: value.idempotency_key || null
      }, context);
      if (!created.ok) return created;
      const tariffId = created.data.tariff_source_id;
      const fact = (fieldName, normalizedValue) => this.createRecord('TariffExtractionFact', {
        tariff_source_id: tariffId, field_name: fieldName, raw_value: null,
        normalized_value: normalizedValue, confidence: 1, ambiguous: false, review_status: 'CONFIRMED'
      }, context);
      fact('rate_currency', currency);
      fact('rate_unit', rateUnit);
      if (validityStart) fact('validity_start', validityStart);
      if (validityEnd) fact('validity_end', validityEnd);
      return ok(this.must('TariffSource', tariffId), { action: 'CREATE_MANUAL_TARIFF' });
    } catch (error) {
      this.auditFailure('CREATE_MANUAL_TARIFF', 'TariffSource', input, this.context(context), error);
      return fail(error);
    }
  }

  addTariffRate(input, context) {
    try {
      const value = input || {};
      const tariff = this.must('TariffSource', requireValue(value.tariff_source_id, 'tariff_source_id'));
      if (tariff.trusted) throw new WmitError('TARIFF_TRUSTED_IMMUTABLE', 'This tariff version is trusted and can no longer be edited. Create a new version for additional rates.', { tariff_source_id: tariff.tariff_source_id });
      const hotel = requireValue(value.hotel, 'hotel');
      if (hotel.length > 120) throw new WmitError('HOTEL_NAME_TOO_LONG', 'Hotel name must be 120 characters or fewer.', { length: hotel.length });
      const amount = money(requireValue(value.amount, 'amount'), 'amount');
      if (toMinorUnits(amount) <= 0n) throw new WmitError('INVALID_MONEY', 'Amount must be greater than zero.', { amount });
      const durationDays = Number(requireValue(value.duration_days, 'duration_days'));
      if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 60) throw new WmitError('DURATION_INVALID', 'Duration must be 1-60 days.', { duration_days: value.duration_days });
      const nights = Number(value.nights === undefined || value.nights === null || value.nights === '' ? durationDays - 1 : value.nights);
      if (!Number.isInteger(nights) || nights < 0 || nights >= durationDays + 1) throw new WmitError('NIGHTS_INVALID', 'Nights must be a whole number not exceeding the duration.', { nights: value.nights });
      const arrangement = String(requireValue(value.room_arrangement, 'room_arrangement')).trim().toUpperCase();
      if (!['SGL', 'TWN', 'TRP', 'DBL', 'QUAD', 'TWN/TRP'].includes(arrangement)) {
        throw new WmitError('ROOM_ARRANGEMENT_INVALID', 'Occupancy must be SGL, TWN, TRP, DBL, QUAD, or TWN/TRP.', { room_arrangement: arrangement });
      }
      const currencyFact = this.list('TariffExtractionFact', (factRecord) => factRecord.tariff_source_id === tariff.tariff_source_id && factRecord.field_name === 'rate_currency')[0];
      const unitFact = this.list('TariffExtractionFact', (factRecord) => factRecord.tariff_source_id === tariff.tariff_source_id && factRecord.field_name === 'rate_unit')[0];
      const currency = currencyFact && currencyFact.normalized_value ? String(currencyFact.normalized_value).toUpperCase() : null;
      const rateUnit = unitFact && unitFact.normalized_value ? String(unitFact.normalized_value).toUpperCase() : null;
      const roomType = value.room_type ? String(value.room_type).trim().slice(0, 80) : null;
      const conditions = { hotel, duration: durationDays + 'D' + nights + 'N', duration_days: durationDays, nights, room_arrangement: arrangement };
      if (roomType) conditions.room_type = roomType;
      if (value.region) conditions.region = String(value.region).trim().slice(0, 60);
      if (value.destination) conditions.destination = String(value.destination).trim().slice(0, 80);
      if (value.travel_date_start) conditions.travel_date_start = String(value.travel_date_start);
      if (value.travel_date_end) conditions.travel_date_end = String(value.travel_date_end);
      return this.createRecord('TariffRateComponent', {
        tariff_source_id: tariff.tariff_source_id,
        service_type: 'ACCOMMODATION_PACKAGE',
        amount,
        currency,
        currency_status: currency ? 'CONFIRMED' : 'MISSING',
        rate_unit: rateUnit,
        rate_unit_status: rateUnit ? 'CONFIRMED' : 'MISSING',
        quantity_driver: 'pax_count',
        conditions,
        source_wording: 'Manually entered by ' + this.context(context).actor,
        source_provenance: { method: 'MANUAL_ENTRY' },
        warnings: [],
        requires_explicit_review: false,
        review_status: 'CONFIRMED',
        inclusions: value.inclusions || [],
        exclusions: []
      }, context);
    } catch (error) {
      this.auditFailure('ADD_TARIFF_RATE', 'TariffRateComponent', input, this.context(context), error);
      return fail(error);
    }
  }

  removeTariffRate(input, context) {
    try {
      const value = input || {};
      const rate = this.must('TariffRateComponent', requireValue(value.tariff_rate_component_id, 'tariff_rate_component_id'));
      const tariff = this.must('TariffSource', rate.tariff_source_id);
      if (tariff.trusted) throw new WmitError('TARIFF_TRUSTED_IMMUTABLE', 'This tariff version is trusted and its rates can no longer be removed. Create a new version instead.', { tariff_source_id: tariff.tariff_source_id });
      this.repos.TariffRateComponent.delete(rate.tariff_rate_component_id);
      this.audit('DELETE', 'TariffRateComponent', { tariff_rate_component_id: rate.tariff_rate_component_id }, context, { tariff_source_id: tariff.tariff_source_id, amount: rate.amount, conditions: rate.conditions });
      return ok({ deleted: true, tariff_rate_component_id: rate.tariff_rate_component_id }, { action: 'REMOVE_TARIFF_RATE' });
    } catch (error) {
      this.auditFailure('REMOVE_TARIFF_RATE', 'TariffRateComponent', input, this.context(context), error);
      return fail(error);
    }
  }

  createSupplierPackage(input, context) { this.must('Supplier', input.supplier_id); return this.createRecord('SupplierPackage', Object.assign({ availability_state: 'NOT_CHECKED' }, input), context); }
  // Tariff deletion is high-risk: manager authority, an explicit
  // confirmation flag, and a hard block while any Commercial Option still
  // references the tariff. Child extraction records are removed with it;
  // the uploaded source Document is retained as evidence.
  deleteTariff(input, context) {
    try {
      this.requireAuthorization(ACTIONS.DELETE_TARIFF, context);
      const value = input || {};
      if (value.confirm !== true) {
        throw new WmitError('DELETE_CONFIRMATION_REQUIRED', 'Tariff deletion requires an explicit confirmation.', { tariff_source_id: value.tariff_source_id || null });
      }
      const tariff = this.must('TariffSource', requireValue(value.tariff_source_id, 'tariff_source_id'));
      const referencingOptions = this.list('CommercialOption', (option) => option.tariff_source_id === tariff.tariff_source_id);
      if (referencingOptions.length) {
        throw new WmitError('TARIFF_IN_USE', 'This tariff is referenced by matching options and cannot be deleted. Supersede it with a new tariff version instead.', { tariff_source_id: tariff.tariff_source_id, option_ids: referencingOptions.map((option) => option.commercial_option_id) });
      }
      const deleted = { facts: 0, rates: 0, itinerary: 0 };
      this.list('TariffExtractionFact', (record) => record.tariff_source_id === tariff.tariff_source_id).forEach((record) => { this.repos.TariffExtractionFact.delete(record.tariff_extraction_fact_id); deleted.facts += 1; });
      this.list('TariffRateComponent', (record) => record.tariff_source_id === tariff.tariff_source_id).forEach((record) => { this.repos.TariffRateComponent.delete(record.tariff_rate_component_id); deleted.rates += 1; });
      this.list('TariffItineraryComponent', (record) => record.tariff_source_id === tariff.tariff_source_id).forEach((record) => { this.repos.TariffItineraryComponent.delete(record.tariff_itinerary_component_id); deleted.itinerary += 1; });
      this.repos.TariffSource.delete(tariff.tariff_source_id);
      this.audit('DELETE', 'TariffSource', { tariff_source_id: tariff.tariff_source_id }, context, {
        deleted_children: deleted,
        trusted: Boolean(tariff.trusted),
        supplier_id: tariff.supplier_id || null,
        file_name: tariff.file_name || tariff.original_source && tariff.original_source.file_name || null
      });
      return ok({ deleted: true, tariff_source_id: tariff.tariff_source_id, removed_records: deleted, source_document_retained: Boolean(tariff.source_document_id) }, { action: 'DELETE_TARIFF' });
    } catch (error) {
      this.auditFailure('DELETE_TARIFF', 'TariffSource', input, this.context(context), error);
      return fail(error);
    }
  }
  createAvailability(input, context) { return this.createRecord('AvailabilityEvidence', Object.assign({ state: 'NOT_CHECKED', checked_at: this.now() }, input), context); }
  conditionMatches(condition, requirements) {
    return this.conditionMismatches(condition, requirements).length === 0;
  }
  requirementStatus(requirements, field) {
    return requirements && requirements.requirement_statuses && requirements.requirement_statuses[field] || null;
  }
  conditionMismatches(condition, requirements) {
    const c = condition || {}; const r = requirements || {}; const mismatches = [];
    Object.keys(c).forEach((key) => {
      if (c[key] === undefined || c[key] === null || c[key] === '') return;
      const requirementStatus = this.requirementStatus(r, key);
      if (['requires_child_ages', 'child_age_required', 'child_age_min', 'child_age_max', 'child_age_ranges'].includes(key)) {
        if (key === 'requires_child_ages' && !c[key]) return;
        if (Number(r.children || 0) <= 0) return;
        const ages = Array.isArray(r.child_ages) ? r.child_ages.map(Number) : [];
        if (!ages.length || ages.length !== Number(r.children || 0)) {
          mismatches.push({ field: 'child_ages', requested: ages.length ? ages : null, tariff: 'Required for this tariff condition', reason: 'CHILD_AGES_REQUIRED' });
          return;
        }
        if (key === 'child_age_min' && ages.some((age) => age < Number(c[key]))) mismatches.push({ field: key, requested: ages, tariff: c[key], reason: 'CHILD_AGE_OUT_OF_RANGE' });
        if (key === 'child_age_max' && ages.some((age) => age > Number(c[key]))) mismatches.push({ field: key, requested: ages, tariff: c[key], reason: 'CHILD_AGE_OUT_OF_RANGE' });
        if (key === 'child_age_ranges') {
          const ranges = Array.isArray(c[key]) ? c[key] : [];
          const validRanges = ranges.every((range) => range && Number.isFinite(Number(range.min)) && Number.isFinite(Number(range.max)) && Number(range.min) <= Number(range.max));
          if (!validRanges || !ranges.length || ages.some((age) => !ranges.some((range) => age >= Number(range.min) && age <= Number(range.max)))) {
            mismatches.push({ field: key, requested: ages, tariff: c[key], reason: validRanges && ranges.length ? 'CHILD_AGE_OUT_OF_RANGE' : 'TARIFF_CHILD_AGE_RULE_INVALID' });
          }
        }
        return;
      }
      if (key === 'duration' && (r.duration_days !== undefined || r.nights !== undefined)) {
        const parsed = String(c[key]).match(/^(\d+)D(\d+)N$/i);
        const matches = parsed ? Number(r.duration_days || 0) === Number(parsed[1]) && Number(r.nights || 0) === Number(parsed[2]) : String(r.duration || '').toLowerCase() === String(c[key]).toLowerCase();
        if (!matches) mismatches.push({ field: key, requested: r.duration_days + ' days / ' + r.nights + ' nights', tariff: c[key] });
        return;
      }
      if (requirementStatus === 'NOT_APPLICABLE') {
        mismatches.push({ field: key, requested: null, tariff: c[key], reason: 'REQUIREMENT_NOT_APPLICABLE' });
        return;
      }
      if (r[key] === undefined || r[key] === null || r[key] === '') {
        if (['nights', 'duration', 'duration_days'].includes(key)) mismatches.push({ field: key, requested: null, tariff: c[key], reason: 'REQUIREMENT_MISSING' });
        else if (requirementStatus === 'REQUIRED') mismatches.push({ field: key, requested: null, tariff: c[key], reason: 'REQUIREMENT_REQUIRED' });
        else if (requirementStatus === 'UNKNOWN') mismatches.push({ field: key, requested: null, tariff: c[key], reason: 'REQUIREMENT_UNKNOWN' });
        return;
      }
      let matches = true;
      if (key === 'pax_min') matches = Number(r.pax_count || 0) >= Number(c[key]);
      else if (key === 'pax_max') matches = Number(r.pax_count || 0) <= Number(c[key]);
      else if (key === 'nights') matches = Number(r.nights || 0) === Number(c[key]);
      else if (key === 'duration_days') matches = Number(r.duration_days || 0) === Number(c[key]);
      else if (key === 'nights_min') matches = Number(r.nights || 0) >= Number(c[key]);
      else if (key === 'nights_max') matches = Number(r.nights || 0) <= Number(c[key]);
      else if (key === 'duration_days_min') matches = Number(r.duration_days || 0) >= Number(c[key]);
      else if (key === 'duration_days_max') matches = Number(r.duration_days || 0) <= Number(c[key]);
      else if (key === 'pax_count_min') matches = Number(r.pax_count || 0) >= Number(c[key]);
      else if (key === 'pax_count_max') matches = Number(r.pax_count || 0) <= Number(c[key]);
      else if (key === 'travel_date_start') matches = !r.travel_start || String(r.travel_start) >= String(c[key]);
      else if (key === 'travel_date_end') matches = !r.travel_end || String(r.travel_end) <= String(c[key]);
      else if (key === 'room_arrangement') matches = canonicalRoomArrangement(r[key]) === canonicalRoomArrangement(c[key]);
      else matches = String(r[key] || '').toLowerCase() === String(c[key]).toLowerCase();
      if (!matches) {
        const reason = ['duration_days_min', 'nights_min', 'pax_count_min', 'pax_min'].includes(key) ? 'BELOW_TARIFF_MINIMUM' : ['duration_days_max', 'nights_max', 'pax_count_max', 'pax_max'].includes(key) ? 'ABOVE_TARIFF_MAXIMUM' : undefined;
        mismatches.push({ field: key, requested: r[key] === undefined ? (key.startsWith('duration_days') ? r.duration_days : key.startsWith('nights') ? r.nights : r.pax_count) : r[key], tariff: c[key], ...(reason ? { reason } : {}) });
      }
    });
    return mismatches;
  }
  conditionMatchExplanation(condition, requirements) {
    const c = condition || {}; const r = requirements || {};
    const mismatches = this.conditionMismatches(c, r);
    const mismatchFields = new Set(mismatches.map((item) => item.field));
    const matches = Object.keys(c).filter((key) => !mismatchFields.has(key) && !['pax_min', 'pax_max', 'child_age_min', 'child_age_max', 'child_age_ranges', 'requires_child_ages', 'child_age_required'].includes(key)).map((key) => ({ field: key, value: r[key] !== undefined ? r[key] : c[key], tariff: c[key] }));
    return { matches, mismatches };
  }
  matchOptions(input, context) {
    try {
      const inquiry = this.must('Inquiry', input.inquiry_id);
      const requirements = Object.assign({}, inquiry.current_requirements || {}, input.requirements || {});
      requireValue(requirements.destination, 'requirements.destination');
      const supplierScope = input.supplier_id;
      const tariffs = this.list('TariffSource', (t) => t.trusted && (!supplierScope || t.supplier_id === supplierScope));
      const candidates = [];
      const excludedIds = new Set([].concat(input.exclude_option_ids || [], input.rejected_option_ids || [], input.unavailable_option_ids || [], input.superseded_option_ids || []));
      const priorOptions = this.list('CommercialOption', (option) => option.inquiry_id === inquiry.inquiry_id);
      const priorBySignature = new Map(priorOptions.filter((option) => option.source_signature).map((option) => [option.source_signature, option]));
      const createdSignatures = new Set();
      const requirementSignature = JSON.stringify(requirements);
      const excludedCandidates = [];
      const existingCandidate = (signature) => {
        const prior = priorBySignature.get(signature);
        if (!prior) return false;
        if (excludedIds.has(prior.commercial_option_id) || input.find_more) {
          excludedCandidates.push({ source_signature: signature, reason: excludedIds.has(prior.commercial_option_id) ? 'EXPLICITLY_EXCLUDED' : 'ALREADY_PRESENTED' });
        } else {
          candidates.push(prior);
        }
        return true;
      };
      const addCandidate = (candidate, signature) => {
        if (excludedIds.has(candidate.commercial_option_id)) {
          excludedCandidates.push({ source_signature: signature, reason: 'EXPLICITLY_EXCLUDED' });
          return;
        }
        candidates.push(candidate);
      };
      tariffs.forEach((tariff) => {
        const tariffRates = this.list('TariffRateComponent', (r) => r.tariff_source_id === tariff.tariff_source_id);
        const rates = tariffRates.filter((rate) => this.conditionMatches(rate.conditions, requirements));
        tariffRates.filter((rate) => !this.conditionMatches(rate.conditions, requirements)).forEach((rate) => {
          excludedCandidates.push({ source_signature: ['TARIFF', tariff.tariff_source_id, 'RATE', rate.tariff_rate_component_id].join(':'), reason: 'REQUIREMENTS_NOT_MATCHED', supplier_id: tariff.supplier_id, tariff_source_id: tariff.tariff_source_id, rate_id: rate.tariff_rate_component_id, mismatches: this.conditionMismatches(rate.conditions, requirements) });
        });
        if (!rates.length) return;
        const supplier = this.must('Supplier', tariff.supplier_id);
        const itinerary = this.list('TariffItineraryComponent', (i) => i.tariff_source_id === tariff.tariff_source_id);
        rates.forEach((rate) => {
          const signature = ['TARIFF', tariff.tariff_source_id, 'RATE', rate.tariff_rate_component_id, 'REQUIREMENTS', requirementSignature].join(':');
          if (existingCandidate(signature) || createdSignatures.has(signature)) return;
          createdSignatures.add(signature);
          const matchDetails = this.conditionMatchExplanation(rate.conditions, requirements);
          const option = this.createRecord('CommercialOption', { inquiry_id: inquiry.inquiry_id, supplier_id: supplier.supplier_id, tariff_source_id: tariff.tariff_source_id, requirements_snapshot: clone(requirements), candidate_rate_ids: [rate.tariff_rate_component_id], itinerary_ids: itinerary.map((i) => i.tariff_itinerary_component_id), state: 'MATCHED', selected: false, source_signature: signature, match_details: matchDetails, state_reason: 'REQUIREMENTS_MATCHED', source_signature_version: 2, match_explanation: ['Destination matched', 'Trip duration and traveler composition matched', 'Tariff conditions preserved and evaluated', 'Matched ' + (rate.conditions.hotel || rate.conditions.duration || 'supplier option')].concat(matchDetails.matches.map((item) => item.field + ' matched')), warnings: rate.warnings || [], source_provenance: Object.assign({}, tariff.original_source, { rate: rate.source_provenance || null }) }, context);
          if (option.ok) {
            const priced = this.addOptionPricing(option.data);
            this.updateRecord('CommercialOption', option.data.commercial_option_id, { pricing_preview: priced.pricing_preview, price_warnings: priced.price_warnings || [], match_explanation: priced.match_explanation }, context);
            addCandidate(this.must('CommercialOption', option.data.commercial_option_id), signature);
          }
        });
      });
      this.list('SupplierPackage', (pkg) => pkg.availability_state === 'AVAILABLE' && (!supplierScope || pkg.supplier_id === supplierScope) && String(pkg.destination || '').toLowerCase() === String(requirements.destination).toLowerCase()).forEach((pkg) => {
        const signature = ['PACKAGE', pkg.supplier_package_id, 'REQUIREMENTS', requirementSignature].join(':');
        if (existingCandidate(signature) || createdSignatures.has(signature)) return;
        createdSignatures.add(signature);
        const option = this.createRecord('CommercialOption', { inquiry_id: inquiry.inquiry_id, supplier_id: pkg.supplier_id, supplier_package_id: pkg.supplier_package_id, requirements_snapshot: clone(requirements), state: 'MATCHED', selected: false, source_signature: signature, match_explanation: ['Destination matched', 'Available Supplier Package matched the request'], warnings: pkg.warnings || [], source_provenance: pkg.source_provenance || null }, context);
        if (option.ok) {
          const priced = this.addOptionPricing(option.data, pkg);
          this.updateRecord('CommercialOption', option.data.commercial_option_id, { pricing_preview: priced.pricing_preview, price_warnings: priced.price_warnings || [], match_explanation: priced.match_explanation }, context);
          addCandidate(this.must('CommercialOption', option.data.commercial_option_id), signature);
        }
      });
      return ok({ requirements, candidates, excluded_candidates: excludedCandidates }, { action: input.find_more ? 'FIND_MORE_OPTIONS' : 'MATCH_OPTIONS', automatic_selection: false });
    } catch (error) { return fail(error); }
  }
  findMoreOptions(input, context) {
    try {
      const inquiry = this.must('Inquiry', input.inquiry_id);
      const reason = input.reason || 'NEED_MORE_CHOICES';
      if (!FIND_MORE_REASON_VALUES.includes(reason)) throw new WmitError('INVALID_FIND_MORE_REASON', 'Find More Options reason is not supported.', { reason, allowed: FIND_MORE_REASON_VALUES });
      const request = this.createRecord('FindMoreRequest', { inquiry_id: inquiry.inquiry_id, reason, note: input.note || null, rejected_option_ids: [].concat(input.rejected_option_ids || []), idempotency_key: input.idempotency_key }, context);
      if (!request.ok) return request;
      const result = this.matchOptions(Object.assign({}, input, { find_more: true }), context);
      if (result.ok) result.data.search_request = request.data;
      return result;
    } catch (error) { return fail(error); }
  }
  addOptionPricing(option, packageRecord) {
    try {
      let cost;
      let currency;
      if (packageRecord && (packageRecord.price !== undefined || packageRecord.amount !== undefined)) {
        cost = money(packageRecord.price !== undefined ? packageRecord.price : packageRecord.amount, 'package.price');
        currency = packageRecord.currency || this.config.defaultCurrency;
      } else {
        const calculated = this.calculateOptionCost(option);
        cost = calculated.total;
        currency = calculated.currency;
      }
      const pricing = this.calculatePricing({ supplier_cost_total: cost });
      const preview = { supplier_cost_total: cost, markup_total: pricing.markup_total, fees_total: pricing.fees_total, client_total: pricing.client_total, currency };
      option.pricing_preview = preview;
      option.match_explanation = (option.match_explanation || []).concat(['Price preview calculated from the matched tariff conditions']);
      return option;
    } catch (error) {
      option.pricing_preview = null;
      option.price_warnings = [error.message || 'Price preview is not available until tariff interpretation is complete.'];
      return option;
    }
  }
  selectOption(input, context) {
    try {
      this.requireAuthorization(ACTIONS.SELECT_OPTION, context);
      const option = this.must('CommercialOption', input.commercial_option_id);
      const actor = this.context(context).actor;
      const activeOptions = this.list('CommercialOption', (candidate) => candidate.inquiry_id === option.inquiry_id && (candidate.selected === true || candidate.state === 'SELECTED'));
      const currentOption = activeOptions[0];
      const quotations = this.list('Quotation', (quote) => (quote.inquiry_id === option.inquiry_id || (currentOption && quote.commercial_option_id === currentOption.commercial_option_id)));
      const bookings = this.list('Booking', (booking) => booking.inquiry_id === option.inquiry_id);
      if (currentOption && currentOption.commercial_option_id !== option.commercial_option_id && (quotations.length || bookings.length) && input.confirm_replacement !== true) {
        const stage = bookings.length ? 'BOOKING' : 'QUOTATION';
        throw new WmitError('OPTION_REPLACEMENT_REQUIRES_CONFIRMATION', 'Changing the selected option requires explicit confirmation because downstream commercial records exist.', { stage, quotation_ids: quotations.map((quote) => quote.quotation_id), booking_ids: bookings.map((booking) => booking.booking_id) });
      }
      if (currentOption && currentOption.commercial_option_id !== option.commercial_option_id && (quotations.length || bookings.length)) {
        const replacement = this.createRecord('OptionReplacement', { inquiry_id: option.inquiry_id, previous_option_id: currentOption.commercial_option_id, new_option_id: option.commercial_option_id, quotation_ids: quotations.map((quote) => quote.quotation_id), booking_ids: bookings.map((booking) => booking.booking_id), impact: bookings.length ? 'BOOKING_REACCEPTANCE_REQUIRED' : 'QUOTATION_REVISION_REQUIRED', confirmed_by: actor, confirmed_at: this.now(), reason: input.replacement_reason || null }, context);
        if (!replacement.ok) return replacement;
        quotations.forEach((quote) => this.updateRecord('Quotation', quote.quotation_id, { revision_required: true, revision_reason: 'Selected option replaced', status: quote.status === 'APPROVED' ? 'DRAFT' : quote.status }, context));
        bookings.forEach((booking) => this.updateRecord('Booking', booking.booking_id, { commitment_state: 'REACCEPTANCE_REQUIRED', client_decision_state: 'CHANGED_OPTION_REQUIRES_REACCEPTANCE' }, context));
      }
      this.list('CommercialOption', (candidate) => candidate.inquiry_id === option.inquiry_id && candidate.commercial_option_id !== option.commercial_option_id && (candidate.selected === true || candidate.state === 'SELECTED')).forEach((candidate) => {
        this.updateRecord('CommercialOption', candidate.commercial_option_id, { selected: false, state: 'MATCHED', selection_status: 'REPLACED_BY_NEW_SELECTION', deselected_at: this.now(), deselected_by: actor }, context);
      });
      const updated = this.updateRecord('CommercialOption', option.commercial_option_id, { selected: true, state: 'SELECTED', selection_status: 'ACTIVE', selected_at: this.now(), selected_by: actor }, context);
      return updated;
    } catch (error) { return fail(error); }
  }
  calculateOptionCost(option) {
    const requirements = option.requirements_snapshot || {};
    if (option.tariff_source_id) {
      const tariff = this.must('TariffSource', option.tariff_source_id);
      if (!tariff.trusted) throw new WmitError('TARIFF_NOT_TRUSTED', 'The selected tariff is not trusted and cannot be used for pricing.');
    }
    const components = this.list('TariffRateComponent', (r) => (option.candidate_rate_ids || []).includes(r.tariff_rate_component_id));
    if (!components.length) throw new WmitError('NO_TRUSTED_RATE_COMPONENT', 'The selected option has no trusted rate components.');
    const lines = components.map((component) => {
      if (component.currency_status && component.currency_status !== 'CONFIRMED') throw new WmitError('TARIFF_CURRENCY_REQUIRED', 'The selected tariff rate currency is not confirmed.', { rate_id: component.tariff_rate_component_id });
      if (component.rate_unit_status && component.rate_unit_status !== 'CONFIRMED') throw new WmitError('TARIFF_RATE_UNIT_REQUIRED', 'The selected tariff rate unit is not confirmed.', { rate_id: component.tariff_rate_component_id });
      if (component.requires_explicit_review) throw new WmitError('TARIFF_RATE_REVIEW_REQUIRED', 'The selected tariff rate still requires staff review.', { rate_id: component.tariff_rate_component_id });
      const unit = String(component.rate_unit || '').toUpperCase();
      const driver = component.quantity_driver || '';
      let quantity = component.quantity || 1;
      if (driver === 'pax_count' || unit === 'PER_PERSON' || unit === 'PER_PERSON_PER_WAY') quantity = Number(requirements.pax_count || 0);
      if (unit === 'PER_PERSON_PER_WAY') quantity *= Number(component.ways || requirements.transfer_ways || 1);
      if (unit === 'PER_PERSON_PER_NIGHT') quantity = Number(requirements.pax_count || 0) * Number(requirements.nights || 0);
      if (driver === 'nights' || unit === 'PER_NIGHT') quantity = Number(requirements.nights || 0);
      if (unit === 'PER_ROOM') quantity = Number(requirements.rooms || 1);
      if (unit === 'PER_ROOM_PER_NIGHT') quantity = Number(requirements.rooms || 1) * Number(requirements.nights || 0);
      if (unit === 'PER_VEHICLE') quantity = Number(requirements.vehicles || 1);
      if (unit === 'PER_VEHICLE_PER_WAY') quantity = Number(requirements.vehicles || 1) * Number(component.ways || requirements.transfer_ways || 1);
      if (unit === 'PER_GROUP' || unit === 'PER_SERVICE') quantity = 1;
      if (unit === 'PER_GROUP_PER_DAY') quantity = Number(requirements.duration_days || 0);
      if (unit === 'OTHER_SUPPLIER_SPECIFIED') throw new WmitError('TARIFF_RATE_UNIT_UNSUPPORTED', 'This supplier-specified rate unit must be mapped to a supported WMIT unit before pricing.');
      if (quantity <= 0) throw new WmitError('MISSING_RATE_QUANTITY', 'The selected tariff option is missing a quantity for its rate unit.', { rate_id: component.tariff_rate_component_id, rate_unit: component.rate_unit, quantity_driver: component.quantity_driver });
      return { component, quantity, amount: multiplyMoney(component.amount, quantity) };
    });
    return { total: lines.reduce((sum, line) => addMoney(sum, line.amount), '0.00'), currency: lines[0].component.currency || this.config.defaultCurrency, lines };
  }
  calculatePricing(input) {
    const cost = money(input.supplier_cost_total || 0, 'supplier_cost_total');
    const markup = input.markup_percent === undefined ? percentage(cost, this.config.standardMarkup) : percentage(cost, input.markup_percent);
    const fixedFees = money(input.fixed_fees || 0, 'fixed_fees');
    const visaFee = money(input.visa_assistance_fee || 0, 'visa_assistance_fee');
    const cardFee = input.payment_method === 'CARD_PAYPAL' ? percentage(addMoney(cost, markup), this.config.cardPaypalFee) : '0.00';
    let discount = money(input.discount || 0, 'discount');
    let discountState = 'APPLIED';
    if (input.pricing_context_type === 'EXPO') {
      const sent = input.client_payment_sent_at;
      const expo = this.config.expo || {};
      const configured = Boolean(expo.startAt && expo.endAt);
      const eligible = configured && sent && new Date(sent) >= new Date(expo.startAt) && new Date(sent) <= new Date(expo.endAt);
      if (!configured) { discount = '0.00'; discountState = 'PENDING_CONFIGURATION'; }
      else if (!eligible) { discount = '0.00'; discountState = sent ? 'INELIGIBLE' : 'PENDING_PAYMENT_ELIGIBILITY'; }
    }
    const total = addMoney(addMoney(addMoney(addMoney(cost, markup), fixedFees), visaFee), cardFee);
    return { supplier_cost_total: cost, markup_total: markup, fees_total: addMoney(addMoney(fixedFees, visaFee), cardFee), discount_total: discount, client_total: subtractMoney(total, discount), discount_state: discountState, pricing_rule_snapshot: { markup_percent: input.markup_percent === undefined ? this.config.standardMarkup : input.markup_percent, fx_rule: input.fx_rule || 'BDO_FOREX_SELLING_PLUS_1.0', card_paypal_percent: this.config.cardPaypalFee } };
  }
  createQuotation(input, context) {
    try {
      requireValue(input && input.client_id, 'client_id');
      const client = this.must('Client', input.client_id);
      const option = input.commercial_option_id ? this.must('CommercialOption', input.commercial_option_id) : null;
      if (option && option.state !== 'SELECTED') throw new WmitError('OPTION_SELECTION_REQUIRED', 'A staff-selected Commercial Option is required before quotation calculation.');
      if (option && input.inquiry_id && input.inquiry_id !== option.inquiry_id) throw new WmitError('INQUIRY_OPTION_MISMATCH', 'The quotation Inquiry must match the selected Commercial Option Inquiry.', { inquiry_id: input.inquiry_id, option_inquiry_id: option.inquiry_id });
      if (option && option.inquiry_id) {
        const optionInquiry = this.must('Inquiry', option.inquiry_id);
        if (optionInquiry.client_id !== client.client_id) throw new WmitError('CLIENT_OPTION_MISMATCH', 'The quotation client must match the selected option Inquiry client.', { client_id: client.client_id, inquiry_client_id: optionInquiry.client_id });
      }
      if (!option && input.inquiry_id) {
        const inquiry = this.must('Inquiry', input.inquiry_id);
        if (inquiry.client_id !== client.client_id) throw new WmitError('CLIENT_INQUIRY_MISMATCH', 'The quotation client must match the Inquiry client.', { client_id: client.client_id, inquiry_client_id: inquiry.client_id });
      }
      if (option && input.supplier_cost_total !== undefined) this.requireAuthorization(ACTIONS.PRICE_OVERRIDE, context);
      if (option && option.tariff_source_id && !this.must('TariffSource', option.tariff_source_id).trusted) throw new WmitError('TARIFF_NOT_TRUSTED', 'Quotation creation is blocked because the selected tariff is not trusted.');
      const calculated = option && input.supplier_cost_total === undefined ? this.calculateOptionCost(option) : { total: input.supplier_cost_total, currency: input.currency || this.config.defaultCurrency, lines: [] };
      const pricing = this.calculatePricing(Object.assign({}, input, { supplier_cost_total: calculated.total }));
      const itinerary = option ? this.list('TariffItineraryComponent', (i) => (option.itinerary_ids || []).includes(i.tariff_itinerary_component_id)) : [];
       const defaults = this.config.quotationDefaults || {};
       const quotationDate = input.quotation_date || this.now().slice(0, 10);
       const quote = this.createRecord('Quotation', Object.assign({}, input, pricing, { inquiry_id: input.inquiry_id || option && option.inquiry_id, quotation_date: quotationDate, valid_until: input.valid_until || dateOnlyPlusDays(quotationDate, defaults.validityDays === undefined ? 7 : defaults.validityDays), payment_terms: input.payment_terms === undefined ? defaults.paymentTerms : input.payment_terms, payment_currency_policy: input.payment_currency_policy === undefined ? defaults.paymentCurrencyPolicy : input.payment_currency_policy, currency: input.currency || calculated.currency || defaults.currency || this.config.defaultCurrency, supplier_cost_total: calculated.total, tax_total: input.tax_total === undefined ? '0.00' : input.tax_total, rate_calculation_lines: calculated.lines.map((line) => ({ rate_id: line.component.tariff_rate_component_id, amount: line.component.amount, unit: line.component.rate_unit, quantity: line.quantity, calculated_amount: line.amount })), itinerary_components: itinerary, commercial_option_id: option && option.commercial_option_id, commercial_version: 1, status: 'DRAFT', staff_review_required: true, provenance: input.provenance || (option && option.source_provenance), quotation_defaults_snapshot: clone(defaults) }), context);
       return quote;
     } catch (error) { return fail(error); }
   }
  quotationItemsSnapshot(quotationId) {
    return this.quotationItems(quotationId).map((item) => clone(item));
  }
  buildQuotationSnapshot(quote, acceptance) {
    const option = quote.commercial_option_id ? this.must('CommercialOption', quote.commercial_option_id) : null;
    const supplier = option && option.supplier_id ? this.must('Supplier', option.supplier_id) : null;
    const inquiry = quote.inquiry_id ? this.must('Inquiry', quote.inquiry_id) : null;
    const requirements = inquiry && clone(inquiry.current_requirements || inquiry.requirements || {});
    const items = this.quotationItemsSnapshot(quote.quotation_id);
    const acceptedAt = acceptance.accepted_at;
    const acceptedBy = acceptance.accepted_by;
    return {
      snapshot_schema_version: 1,
      quotation_id: quote.quotation_id,
      commercial_version: Number(quote.commercial_version || 1),
      quotation_record_version: quote.record_version,
      quotation: clone(quote),
      commercial_option: option ? clone(option) : null,
      option_provenance: option ? clone(option.source_provenance || option.provenance || null) : null,
      supplier: supplier ? clone(supplier) : null,
      services: items,
      requirements_snapshot: requirements,
      traveler_composition: requirements ? {
        pax_count: requirements.pax_count,
        adults: requirements.adults,
        children: requirements.children,
        infants: requirements.infants,
        child_ages: clone(requirements.child_ages || [])
      } : null,
      destination: quote.destination || requirements && requirements.destination || null,
      travel_start: quote.travel_start || requirements && requirements.travel_start || null,
      travel_end: quote.travel_end || requirements && requirements.travel_end || null,
      itinerary: clone(quote.itinerary || []),
      itinerary_components: clone(quote.itinerary_components || []),
      pricing: {
        client_price: quote.client_total,
        supplier_cost: quote.supplier_cost_total,
        markup: quote.markup_total,
        fees: quote.fees_total,
        tax: quote.tax_total,
        discount: quote.discount_total,
        currency: quote.currency,
        pricing_context_type: quote.pricing_context_type || null,
        pricing_rule_snapshot: clone(quote.pricing_rule_snapshot || null),
        payment_method: quote.payment_method || null,
        fx_rule: quote.fx_rule || null
      },
      terms: {
        inclusions: clone(quote.inclusions || null),
        exclusions: clone(quote.exclusions || null),
        payment_terms: clone(quote.payment_terms || null),
        payment_currency_policy: clone(quote.payment_currency_policy || null),
        client_notes: clone(quote.client_notes || null)
      },
      acceptance: { accepted_at: acceptedAt, accepted_by: acceptedBy, acceptance_reference: acceptance.acceptance_reference || null }
    };
  }
  createQuotationRevision(input, context) {
    try {
      this.requireAuthorization(ACTIONS.REVISE_QUOTATION, context);
      const value = input || {};
      const prior = this.must('Quotation', value.quotation_id);
      const priorAcceptance = this.list('QuotationAcceptance', (record) => record.quotation_id === prior.quotation_id && record.state === 'ACCEPTED');
      if (!priorAcceptance.length && !prior.revision_required && prior.status !== 'DRAFT') throw new WmitError('QUOTATION_REVISION_NOT_REQUIRED', 'A quotation revision requires an accepted or revision-required quotation.');
      const inquiry = prior.inquiry_id ? this.must('Inquiry', prior.inquiry_id) : null;
      const requirements = inquiry && clone(inquiry.current_requirements || inquiry.requirements || {});
      const revision = Object.assign({}, prior, {
        commercial_version: Number(prior.commercial_version || 1) + 1,
        parent_quotation_id: prior.parent_quotation_id || prior.quotation_id,
        revision_of_quotation_id: prior.quotation_id,
        revision_reason: value.reason || prior.revision_reason || null,
        revision_required: false,
        status: 'DRAFT',
        staff_review_required: true,
        approved_at: null,
        approved_by: null,
        superseded_by_quotation_id: null
      });
      if (requirements) {
        ['destination', 'travel_start', 'travel_end', 'pax_count'].forEach((field) => { if (requirements[field] !== undefined) revision[field] = requirements[field]; });
      }
      ['quotation_id', 'created_at', 'created_by', 'updated_at', 'updated_by', 'record_version'].forEach((field) => { delete revision[field]; });
      const created = this.createRecord('Quotation', revision, context);
      if (!created.ok) return created;
      const copiedItems = [];
      try {
        this.quotationItemsSnapshot(prior.quotation_id).forEach((item) => {
          const copy = Object.assign({}, item, { quotation_id: created.data.quotation_id });
          delete copy.quotation_item_id;
          delete copy.created_at; delete copy.created_by; delete copy.updated_at; delete copy.updated_by; delete copy.record_version;
          const saved = this.createRecord('QuotationItem', copy, context);
          if (!saved.ok) throw new WmitError(saved.error.code, saved.error.message, saved.error.details);
          copiedItems.push(saved.data);
        });
      } catch (error) {
        this.repos.QuotationItem && copiedItems.forEach((item) => this.repos.QuotationItem.delete(item.quotation_item_id));
        this.repos.Quotation.delete(created.data.quotation_id);
        throw error;
      }
      this.updateRecord('Quotation', prior.quotation_id, { superseded_by_quotation_id: created.data.quotation_id, revision_state: 'SUPERSEDED' }, context);
      return ok({ quotation: created.data, items: copiedItems, supersedes: prior.quotation_id }, { action: 'CREATE_QUOTATION_REVISION' });
    } catch (error) { return fail(error); }
  }
  updateQuotationPricing(input, context) {
    try {
      this.requireAuthorization(ACTIONS.EDIT_DRAFT_PRICING, context);
       const quote = this.must('Quotation', input.quotation_id);
       if (quote.status !== 'DRAFT') throw new WmitError('QUOTATION_NOT_DRAFT', 'Only a draft quotation can be edited before approval.');
       if (this.list('QuotationAcceptance', (record) => record.quotation_id === quote.quotation_id && record.state === 'ACCEPTED').length) throw new WmitError('QUOTATION_REVISION_REQUIRED', 'An accepted quotation cannot be edited in place. Create a new quotation revision instead.');
      const allowed = ['markup_percent', 'fixed_fees', 'visa_assistance_fee', 'payment_method', 'discount', 'pricing_context_type', 'client_payment_sent_at', 'fx_rule'];
      const changes = {};
      allowed.forEach((field) => { if (input[field] !== undefined) changes[field] = input[field]; });
      const pricing = this.calculatePricing(Object.assign({}, quote, changes, { supplier_cost_total: quote.supplier_cost_total }));
      const prior = {
        markup_percent: quote.pricing_rule_snapshot && quote.pricing_rule_snapshot.markup_percent,
        fixed_fees: quote.fixed_fees || '0.00',
        visa_assistance_fee: quote.visa_assistance_fee || '0.00',
        payment_method: quote.payment_method || 'STANDARD',
        discount: quote.discount || quote.discount_total || '0.00',
        client_total: quote.client_total
      };
      const next = {
        markup_percent: pricing.pricing_rule_snapshot.markup_percent,
        fixed_fees: changes.fixed_fees === undefined ? quote.fixed_fees || '0.00' : changes.fixed_fees,
        visa_assistance_fee: changes.visa_assistance_fee === undefined ? quote.visa_assistance_fee || '0.00' : changes.visa_assistance_fee,
        payment_method: changes.payment_method === undefined ? quote.payment_method || 'STANDARD' : changes.payment_method,
        discount: changes.discount === undefined ? quote.discount || quote.discount_total || '0.00' : changes.discount,
        client_total: pricing.client_total
      };
      const history = Array.isArray(quote.pricing_edit_history) ? quote.pricing_edit_history.slice() : [];
      history.push({ at: this.now(), actor: this.context(context).actor, reason: input.reason || 'Draft pricing review', before: prior, after: next });
       return this.updateRecord('Quotation', quote.quotation_id, Object.assign({}, changes, pricing, { commercial_version: Number(quote.commercial_version || 1) + 1, supplier_cost_total: quote.supplier_cost_total, pricing_edit_history: history, staff_review_required: true, status: 'DRAFT' }), context);
    } catch (error) { return fail(error); }
  }
  approveQuotation(input, context) {
    try {
      this.requireAuthorization(ACTIONS.APPROVE_QUOTATION, context);
      const quote = this.must('Quotation', input.quotation_id);
      if (quote.status === 'APPROVED') return ok(quote, { action: 'IDEMPOTENT_REPLAY', idempotent: true });
      if (quote.status !== 'DRAFT') throw new WmitError('QUOTATION_NOT_DRAFT', 'Only a draft quotation can be approved.');
      if (quote.revision_required) throw new WmitError('QUOTATION_REVISION_REQUIRED', 'This quotation must be recalculated and reviewed after a downstream requirement or option change.', { quotation_id: quote.quotation_id, revision_reason: quote.revision_reason || null });
      const missing = [];
      const requiredPricing = ['supplier_cost_total', 'markup_total', 'fees_total', 'tax_total', 'discount_total', 'client_total'];
      requiredPricing.forEach((field) => {
        if (quote[field] === undefined || quote[field] === null || String(quote[field]).trim() === '') missing.push(field);
        else {
          try { money(quote[field], field); } catch (error) { missing.push(field); }
        }
      });
      if (missing.length) throw new WmitError('QUOTATION_PRICING_REQUIRED', 'Complete all quotation pricing fields before approval.', { fields: missing });
      if (toMinorUnits(quote.supplier_cost_total) <= 0n || toMinorUnits(quote.client_total) <= 0n) throw new WmitError('QUOTATION_PRICING_REQUIRED', 'Supplier cost and client price must be greater than zero before approval.', { fields: ['supplier_cost_total', 'client_total'] });
      const items = this.quotationItems(quote.quotation_id);
      if (!items.length) throw new WmitError('QUOTATION_ITEMS_REQUIRED', 'Add at least one quotation item before approval.', { quotation_id: quote.quotation_id });
      if (!String(quote.inclusions || '').trim()) throw new WmitError('QUOTATION_INCLUSIONS_REQUIRED', 'Add at least one inclusion before approval.', { quotation_id: quote.quotation_id });
      if (!String(quote.exclusions || '').trim()) throw new WmitError('QUOTATION_EXCLUSIONS_REQUIRED', 'Add at least one exclusion before approval.', { quotation_id: quote.quotation_id });
      return this.updateRecord('Quotation', input.quotation_id, { status: 'APPROVED', approved_at: this.now(), approved_by: this.context(context).actor }, context);
    }
    catch (error) { return fail(error); }
  }
  cancelQuotationApproval(input, context) {
    try {
      this.requireAuthorization(ACTIONS.APPROVE_QUOTATION, context);
      const quote = this.must('Quotation', input.quotation_id);
      if (quote.status !== 'APPROVED') throw new WmitError('QUOTATION_NOT_APPROVED', 'Only an approved quotation can have its approval cancelled.');
      if (this.list('QuotationAcceptance', (record) => record.quotation_id === quote.quotation_id && record.state === 'ACCEPTED').length) throw new WmitError('QUOTATION_ACCEPTANCE_EXISTS', 'Approval cannot be cancelled after client acceptance. Create a quotation revision or amendment instead.');
      if (this.list('Booking', (record) => record.quotation_id === quote.quotation_id).length) throw new WmitError('QUOTATION_BOOKING_EXISTS', 'Approval cannot be cancelled after a Booking exists. Use the existing amendment/reacceptance workflow instead.');
      const reason = requireValue(input.reason, 'reason');
      return this.updateRecord('Quotation', quote.quotation_id, { status: 'DRAFT', staff_review_required: true, approval_cancelled_at: this.now(), approval_cancelled_by: this.context(context).actor, approval_cancellation_reason: reason }, context);
    } catch (error) { return fail(error); }
  }
  acceptQuotation(input, context) {
    try {
      this.requireAuthorization(ACTIONS.ACCEPT_QUOTATION, context);
      const quote = this.must('Quotation', input.quotation_id);
      if (quote.status !== 'APPROVED') throw new WmitError('QUOTATION_NOT_APPROVED', 'Client acceptance can only be recorded for an approved quotation.');
      const acceptedBy = requireValue(input.accepted_by || input.client_contact, 'accepted_by');
      const existing = this.list('QuotationAcceptance', (record) => record.quotation_id === quote.quotation_id && record.state === 'ACCEPTED');
      if (existing.length) return ok(existing[0], { action: 'IDEMPOTENT_REPLAY', idempotent: true });
      const acceptedAt = input.accepted_at || this.now();
      const acceptance = { quotation_id: quote.quotation_id, state: 'ACCEPTED', accepted_by: acceptedBy, acceptance_reference: input.acceptance_reference || null, accepted_at: acceptedAt, accepted_version: Number(quote.commercial_version || 1) };
      acceptance.quote_snapshot = this.buildQuotationSnapshot(quote, acceptance);
      return this.createRecord('QuotationAcceptance', acceptance, context);
    } catch (error) { return fail(error); }
  }
  quotationItems(quotationId) { return this.list('QuotationItem', (item) => item.quotation_id === quotationId).sort((a, b) => Number(a.line_order || 0) - Number(b.line_order || 0)); }
  assertDraftQuotation(quotationId, context) {
    this.requireAuthorization(ACTIONS.EDIT_DRAFT_PRICING, context);
    const quote = this.must('Quotation', quotationId);
    if (quote.status !== 'DRAFT') throw new WmitError('QUOTATION_NOT_DRAFT', 'Only a draft quotation can be edited before approval.');
    return quote;
  }
  quotationItemTotals(quote, items) {
    const rows = items || [];
    let supplier = 0n;
    let selling = 0n;
    rows.forEach((item) => {
      const quantity = Number(item.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new WmitError('INVALID_QUANTITY', 'Quotation item quantity must be greater than zero.');
      const roundedQuantity = BigInt(Math.round(quantity));
      const cost = toMinorUnits(money(item.unit_cost, 'unit_cost')) * roundedQuantity;
      const price = toMinorUnits(money(item.unit_selling_price, 'unit_selling_price')) * roundedQuantity;
      if (price < cost) throw new WmitError('SELLING_BELOW_COST', 'Selling price cannot be lower than supplier cost without an approved pricing override.', { quotation_item_id: item.quotation_item_id || null });
      supplier += cost;
      selling += price;
    });
    const fees = toMinorUnits(money(quote.fees_total || '0.00', 'fees_total'));
    const tax = toMinorUnits(money(quote.tax_total || '0.00', 'tax_total'));
    const discount = toMinorUnits(money(quote.discount_total || '0.00', 'discount_total'));
    const total = selling + fees + tax - discount;
    if (total < 0n) throw new WmitError('INVALID_DISCOUNT', 'Discount cannot make the client total negative.');
    return {
      supplier_cost_total: fromMinorUnits(supplier),
      markup_total: fromMinorUnits(selling - supplier),
      client_total: fromMinorUnits(total)
    };
  }
  updateQuotation(input, context) {
    try {
      const value = input || {};
      const quote = this.assertDraftQuotation(value.quotation_id, context);
      if (this.list('QuotationAcceptance', (record) => record.quotation_id === quote.quotation_id && record.state === 'ACCEPTED').length) throw new WmitError('QUOTATION_REVISION_REQUIRED', 'An accepted quotation cannot be edited in place. Create a new quotation revision instead.');
      const allowed = ['quotation_date', 'valid_until', 'destination', 'travel_start', 'travel_end', 'pax_count', 'currency', 'inclusions', 'exclusions', 'payment_terms', 'payment_currency_policy', 'itinerary', 'flight_details', 'client_notes', 'internal_notes', 'notes'];
      const changes = {};
      allowed.forEach((field) => { if (value[field] !== undefined) changes[field] = value[field]; });
      const destination = changes.destination === undefined ? quote.destination : changes.destination;
      if (!destination || !String(destination).trim()) throw new WmitError('DESTINATION_REQUIRED', 'Destination is required before saving a quotation.');
      if (changes.currency !== undefined && !/^[A-Z]{3}$/i.test(String(changes.currency).trim())) throw new WmitError('INVALID_CURRENCY', 'Quotation currency must be a three-letter currency code.');
      if (changes.currency !== undefined && changes.currency.toUpperCase() !== quote.currency.toUpperCase() && this.quotationItems(quote.quotation_id).length) throw new WmitError('CURRENCY_CHANGE_WITH_ITEMS', 'Quotation currency cannot be changed after quotation items exist.');
      if (changes.currency !== undefined) changes.currency = String(changes.currency).trim().toUpperCase();
      if (Object.keys(changes).length) changes.commercial_version = Number(quote.commercial_version || 1) + 1;
      return this.updateRecord('Quotation', quote.quotation_id, changes, context);
    } catch (error) { return fail(error); }
  }
  createQuotationItem(input, context) {
    try {
      const value = input || {};
      const quote = this.assertDraftQuotation(value.quotation_id, context);
      const supplierId = value.supplier_id || null;
      if (supplierId) this.must('Supplier', supplierId);
      const currency = String(value.currency || quote.currency || '').trim().toUpperCase();
      if (currency !== String(quote.currency).toUpperCase()) throw new WmitError('CURRENCY_MISMATCH', 'Every quotation item must use the quotation currency.');
      const item = Object.assign({}, value, { currency, line_order: value.line_order || this.quotationItems(quote.quotation_id).length + 1 });
      const proposed = this.quotationItems(quote.quotation_id).concat([item]);
      const totals = this.quotationItemTotals(quote, proposed);
      const created = this.createRecord('QuotationItem', item, context);
      if (!created.ok) return created;
       const updated = this.updateRecord('Quotation', quote.quotation_id, Object.assign({}, totals, { commercial_version: Number(quote.commercial_version || 1) + 1 }), context);
      if (!updated.ok) { this.repos.QuotationItem.delete(created.data.quotation_item_id); return updated; }
      return ok({ item: created.data, quotation: updated.data }, { action: 'CREATE_QUOTATION_ITEM' });
    } catch (error) { return fail(error); }
  }
  updateQuotationItem(input, context) {
    try {
      const value = input || {};
      const current = this.must('QuotationItem', value.quotation_item_id);
      const quote = this.assertDraftQuotation(current.quotation_id, context);
      const allowed = ['service_type', 'description', 'supplier_id', 'quantity', 'unit_cost', 'unit_selling_price', 'currency', 'line_order', 'service_start', 'service_end', 'airline', 'flight_number', 'departure_airport', 'arrival_airport', 'departure_time', 'arrival_time', 'checkin_baggage_kg', 'hand_carry_baggage_kg', 'notes'];
      const changes = {};
      allowed.forEach((field) => { if (value[field] !== undefined) changes[field] = value[field]; });
      if (changes.supplier_id) this.must('Supplier', changes.supplier_id);
      if (changes.currency && String(changes.currency).toUpperCase() !== String(quote.currency).toUpperCase()) throw new WmitError('CURRENCY_MISMATCH', 'Every quotation item must use the quotation currency.');
      if (changes.currency) changes.currency = String(changes.currency).trim().toUpperCase();
      const proposed = this.quotationItems(quote.quotation_id).map((item) => item.quotation_item_id === current.quotation_item_id ? Object.assign({}, item, changes) : item);
      const totals = this.quotationItemTotals(quote, proposed);
      const updatedItem = this.updateRecord('QuotationItem', current.quotation_item_id, changes, context);
      if (!updatedItem.ok) return updatedItem;
       const updatedQuote = this.updateRecord('Quotation', quote.quotation_id, Object.assign({}, totals, { commercial_version: Number(quote.commercial_version || 1) + 1 }), context);
      return updatedQuote.ok ? ok({ item: updatedItem.data, quotation: updatedQuote.data }, { action: 'UPDATE_QUOTATION_ITEM' }) : updatedQuote;
    } catch (error) { return fail(error); }
  }
  removeQuotationItem(input, context) {
    try {
      const value = input || {};
      const current = this.must('QuotationItem', value.quotation_item_id);
      const quote = this.assertDraftQuotation(current.quotation_id, context);
      if (this.list('BookingItem', (item) => item.quotation_item_id === current.quotation_item_id).length) throw new WmitError('REFERENCED_RECORD', 'This quotation item is already used by a Booking and cannot be removed.');
      const proposed = this.quotationItems(quote.quotation_id).filter((item) => item.quotation_item_id !== current.quotation_item_id);
      const totals = proposed.length ? this.quotationItemTotals(quote, proposed) : { supplier_cost_total: quote.supplier_cost_total, markup_total: quote.markup_total, client_total: quote.client_total };
      const removed = this.repos.QuotationItem.delete(current.quotation_item_id);
      if (!removed) throw new WmitError('NOT_FOUND', 'Quotation item was not found.');
      this.audit('DELETE', 'QuotationItem', current, context);
       const updated = this.updateRecord('Quotation', quote.quotation_id, Object.assign({}, totals, { commercial_version: Number(quote.commercial_version || 1) + 1 }), context);
      return updated.ok ? ok({ removed: current, quotation: updated.data }, { action: 'REMOVE_QUOTATION_ITEM' }) : updated;
    } catch (error) { return fail(error); }
  }
  reorderQuotationItems(input, context) {
    try {
      const value = input || {};
      const quote = this.assertDraftQuotation(value.quotation_id, context);
      const items = this.quotationItems(quote.quotation_id);
      const ids = Array.isArray(value.quotation_item_ids) ? value.quotation_item_ids : [];
      if (ids.length !== items.length || ids.some((id) => !items.some((item) => item.quotation_item_id === id))) throw new WmitError('INVALID_REFERENCE', 'The quotation item order must contain each item exactly once.');
      const updated = ids.map((id, index) => this.updateRecord('QuotationItem', id, { line_order: index + 1 }, context));
      if (updated.some((result) => !result.ok)) return updated.find((result) => !result.ok);
       const updatedQuotation = this.updateRecord('Quotation', quote.quotation_id, { commercial_version: Number(quote.commercial_version || 1) + 1 }, context);
       return updatedQuotation.ok ? ok({ quotation: updatedQuotation.data, items: updated.map((result) => result.data) }, { action: 'REORDER_QUOTATION_ITEMS' }) : updatedQuotation;
    } catch (error) { return fail(error); }
  }
  getQuotationEditor(quotationId) {
    try {
      const quotation = this.must('Quotation', quotationId);
      const items = this.quotationItems(quotationId);
      const client = quotation.client_id ? this.must('Client', quotation.client_id) : null;
      const contact = quotation.contact_id && this.repos.Person && this.repos.Person.exists(quotation.contact_id) ? this.must('Person', quotation.contact_id) : null;
      const totals = items.length ? this.quotationItemTotals(quotation, items) : {
        supplier_cost_total: quotation.supplier_cost_total,
        markup_total: quotation.markup_total,
        fees_total: quotation.fees_total,
        tax_total: quotation.tax_total,
        discount_total: quotation.discount_total,
        client_total: quotation.client_total
      };
      return ok({ quotation, items, client, contact, totals });
    } catch (error) { return fail(error); }
  }
  getClientQuotationPreview(quotationId) {
    try {
      const id = quotationId && typeof quotationId === 'object' ? quotationId.quotation_id : quotationId;
      if (!id) throw new WmitError('QUOTATION_REQUIRED', 'A quotation ID is required to generate the client preview.');
      const quotation = this.must('Quotation', id);
      const items = this.quotationItems(id);
      const client = quotation.client_id ? this.must('Client', quotation.client_id) : null;
      const contact = quotation.contact_id && this.repos.Person && this.repos.Person.exists(quotation.contact_id) ? this.must('Person', quotation.contact_id) : null;
      const preview = quotationEditor.buildClientPreview(quotation, items, client, contact);
      if (!items.length) preview.quotation.client_total = quotation.client_total;
      return ok(preview);
    } catch (error) { return fail(error); }
  }
  getClientInvoicePreview(bookingId) {
    try {
      const id = bookingId && typeof bookingId === 'object' ? bookingId.booking_id : bookingId;
      if (!id) throw new WmitError('BOOKING_REQUIRED', 'A booking ID is required to generate the client invoice.');
      const booking = this.must('Booking', id);
      const quotation = booking.quotation_id ? this.must('Quotation', booking.quotation_id) : null;
      const client = booking.client_id ? this.must('Client', booking.client_id) : null;
      const finance = caseProjection.financeProjection(caseProjection.getEntities(this), booking, new Set([booking.booking_id]));
      return ok({
        invoice: {
          booking_id: booking.booking_id,
          quotation_id: booking.quotation_id || null,
          client_name: (client && (client.display_name || client.legal_name)) || booking.client_id,
          destination: quotation ? quotation.destination : null,
          travel_start: quotation ? quotation.travel_start : booking.travel_start || null,
          travel_end: quotation ? quotation.travel_end : booking.travel_end || null,
          pax_count: quotation ? quotation.pax_count : null,
          currency: finance.currency || (quotation && quotation.currency) || this.config.defaultCurrency,
          issued_at: this.now()
        },
        client: client ? { name: client.display_name || client.legal_name, email: client.primary_email || null } : null,
        obligations: finance.obligations || [],
        totals: {
          obligationTotal: finance.obligationTotal || '0.00',
          verifiedReceived: finance.verifiedReceived || '0.00',
          outstanding: finance.outstanding || '0.00',
          currency: finance.currency || (quotation && quotation.currency) || this.config.defaultCurrency
        },
        paymentTerms: (this.config.quotationDefaults && this.config.quotationDefaults.paymentTerms) || '',
        bankDetails: (this.config.quotationDefaults && this.config.quotationDefaults.bankDetails) || DEFAULT_BANK_DETAILS
      });
    } catch (error) { return fail(error); }
  }
  getClientItineraryPreview(quotationId) {
    try {
      const id = quotationId && typeof quotationId === 'object' ? quotationId.quotation_id : quotationId;
      if (!id) throw new WmitError('QUOTATION_REQUIRED', 'A quotation ID is required to generate the client itinerary.');
      const quotation = this.must('Quotation', id);
      const items = this.quotationItems(id);
      const client = quotation.client_id ? this.must('Client', quotation.client_id) : null;
      const contact = quotation.contact_id && this.repos.Person && this.repos.Person.exists(quotation.contact_id) ? this.must('Person', quotation.contact_id) : null;
      const preview = quotationEditor.buildClientPreview(quotation, items, client, contact);
      const flights = (preview.quotation && preview.quotation.flight_details || []).map((flight) => ({
        airline: flight.airline || null,
        flight_number: flight.flight_number || null,
        route: flight.departure_airport && flight.arrival_airport ? flight.departure_airport + ' – ' + flight.arrival_airport : flight.departure_airport || flight.arrival_airport || null,
        times: flight.departure_time && flight.arrival_time ? flight.departure_time + ' – ' + flight.arrival_time : flight.departure_time || flight.arrival_time || null,
        service_date: flight.date || flight.service_date || null
      }));
      const booking = this.list('Booking', (record) => record.quotation_id === quotation.quotation_id)[0] || null;
      let vouchers = [];
      if (booking) {
        const bookingItems = this.list('BookingItem', (record) => record.booking_id === booking.booking_id);
        const itemIds = new Set(bookingItems.map((record) => record.booking_item_id));
        const itemById = new Map(bookingItems.map((record) => [record.booking_item_id, record]));
        vouchers = this.list('Voucher', (voucher) => itemIds.has(voucher.booking_item_id) && String(voucher.status || 'ISSUED') === 'ISSUED').map((voucher) => {
          const item = itemById.get(voucher.booking_item_id);
          return {
            voucher_number: voucher.voucher_number,
            service_type: item ? item.service_type || null : null,
            description: item ? item.description || null : null
          };
        });
      }
      return ok({
        itinerary: preview.quotation,
        flights,
        vouchers,
        booking: booking ? { booking_id: booking.booking_id } : null,
        client: preview.client || null
      });
    } catch (error) { return fail(error); }
  }
  createBooking(input, context) {
    try {
      const quote = this.must('Quotation', input.quotation_id);
      if (quote.status !== 'APPROVED') throw new WmitError('QUOTATION_NOT_APPROVED', 'Only an approved quotation can create an operational Booking.');
      if (quote.revision_required) throw new WmitError('QUOTATION_REVISION_REQUIRED', 'This quotation must be recalculated before it can create a Booking.', { quotation_id: quote.quotation_id, revision_reason: quote.revision_reason || null });
      if (input.client_id && input.client_id !== quote.client_id) throw new WmitError('CLIENT_QUOTATION_MISMATCH', 'The Booking client must match the quotation client.', { client_id: input.client_id, quotation_client_id: quote.client_id });
      if (input.inquiry_id && input.inquiry_id !== quote.inquiry_id) throw new WmitError('INQUIRY_QUOTATION_MISMATCH', 'The Booking Inquiry must match the quotation Inquiry.', { inquiry_id: input.inquiry_id, quotation_inquiry_id: quote.inquiry_id });
      const existing = this.list('Booking', (booking) => booking.quotation_id === quote.quotation_id);
      if (existing.length) {
        const booking = existing[0];
        const existingLead = this.list('BookingParticipant', (participant) => participant.booking_id === booking.booking_id && (participant.role === 'LEAD_PAX' || (Array.isArray(participant.roles) && participant.roles.includes('LEAD_PAX'))));
        if (existingLead.length && !input.lead_pax_person_id) return ok(booking, { action: 'IDEMPOTENT_REPLAY', idempotent: true, existing: true, message: 'Booking already exists for this quotation.' });
        const leadPaxPersonId = requireValue(input.lead_pax_person_id, 'lead_pax_person_id');
        this.must('Person', leadPaxPersonId);
        if (booking.lead_pax_person_id && booking.lead_pax_person_id !== leadPaxPersonId) throw new WmitError('LEAD_PAX_MISMATCH', 'The existing Booking already has a different lead passenger.', { booking_id: booking.booking_id, lead_pax_person_id: booking.lead_pax_person_id });
        if (existingLead.length && existingLead[0].person_id !== leadPaxPersonId) throw new WmitError('LEAD_PAX_MISMATCH', 'The existing Booking already has a different lead passenger.', { booking_id: booking.booking_id, lead_pax_person_id: existingLead[0].person_id });
        if (!existingLead.length) {
          const updated = this.updateRecord('Booking', booking.booking_id, { lead_pax_person_id: leadPaxPersonId }, context);
          if (!updated.ok) return updated;
          const participant = this.createBookingParticipant({ booking_id: booking.booking_id, person_id: leadPaxPersonId, role: 'LEAD_PAX' }, context);
          if (!participant.ok) return participant;
          return ok(updated.data, { action: 'IDEMPOTENT_REPLAY', idempotent: true, existing: true, repaired: true, message: 'Booking already existed; the selected lead passenger was recorded.' });
        }
        return ok(booking, { action: 'IDEMPOTENT_REPLAY', idempotent: true, existing: true, message: 'Booking already exists for this quotation.' });
      }
      const acceptance = this.list('QuotationAcceptance', (record) => record.quotation_id === quote.quotation_id && record.state === 'ACCEPTED');
      if (!acceptance.length) throw new WmitError('QUOTATION_ACCEPTANCE_REQUIRED', 'Record client acceptance before creating the operational Booking.', { quotation_id: quote.quotation_id });
      const acceptedDecision = acceptance[0];
      if (acceptedDecision.accepted_version !== undefined && Number(acceptedDecision.accepted_version) !== Number(quote.commercial_version || 1)) throw new WmitError('QUOTATION_REVISION_REQUIRED', 'The quotation changed after client acceptance. Create and accept a new quotation revision before creating a Booking.', { quotation_id: quote.quotation_id, accepted_version: acceptedDecision.accepted_version, current_version: quote.commercial_version || 1 });
      const acceptedSnapshot = clone(acceptedDecision.quote_snapshot || this.buildQuotationSnapshot(quote, acceptedDecision));
      const acceptedPricing = acceptedSnapshot.pricing || {};
      const acceptedRequirements = acceptedSnapshot.requirements_snapshot || {};
      const acceptedTravelStart = acceptedSnapshot.travel_start || quote.travel_start || input.travel_start;
      const acceptedTravelEnd = acceptedSnapshot.travel_end || quote.travel_end || input.travel_end;
      const leadPaxPersonId = requireValue(input.lead_pax_person_id, 'lead_pax_person_id');
      this.must('Person', leadPaxPersonId);
      const booking = this.createRecord('Booking', Object.assign({}, input, {
        lead_pax_person_id: leadPaxPersonId,
        client_id: quote.client_id,
        inquiry_id: input.inquiry_id || quote.inquiry_id,
        quotation_id: quote.quotation_id,
        destination: acceptedSnapshot.destination || quote.destination || input.destination,
        travel_start: acceptedTravelStart,
        travel_end: acceptedTravelEnd,
        pax_count: acceptedSnapshot.traveler_composition && acceptedSnapshot.traveler_composition.pax_count || quote.pax_count || input.pax_count,
        currency: acceptedPricing.currency || quote.currency || input.currency,
        client_total: acceptedPricing.client_price || quote.client_total,
        supplier_cost_total: acceptedPricing.supplier_cost || quote.supplier_cost_total,
        record_state: 'CREATED',
        commitment_state: 'PENDING',
        client_decision_state: 'SELECTED',
        current_price: acceptedPricing.client_price || quote.client_total,
        current_supplier_cost: acceptedPricing.supplier_cost || quote.supplier_cost_total,
        accepted_quotation_acceptance_id: acceptedDecision.quotation_acceptance_id,
        accepted_quotation_id: quote.quotation_id,
        accepted_commercial_version: acceptedDecision.accepted_version || quote.commercial_version || 1,
        accepted_commercial_snapshot: acceptedSnapshot
      }), context);
      if (!booking.ok) return booking;
      const participant = this.createBookingParticipant({ booking_id: booking.data.booking_id, person_id: leadPaxPersonId, role: 'LEAD_PAX' }, context);
      if (!participant.ok) {
        this.repos.Booking.delete(booking.data.booking_id);
        return participant;
      }
      return booking;
    } catch (error) { return fail(error); }
  }
  confirmCommitment(input, context) {
    try {
      this.requireAuthorization(ACTIONS.CONFIRM_COMMITMENT, context);
      const booking = this.must('Booking', input.booking_id);
      if (booking.commitment_state === 'CONFIRMED') return ok(booking, { action: 'IDEMPOTENT_REPLAY', idempotent: true });
      if (booking.commitment_state === 'REACCEPTANCE_REQUIRED') throw new WmitError('BOOKING_REACCEPTANCE_REQUIRED', 'Client re-acceptance is required before this Booking commitment can be confirmed.');
      return this.updateRecord('Booking', input.booking_id, { commitment_state: 'CONFIRMED', commitment_confirmed_at: this.now() }, context);
    } catch (error) { return fail(error); }
  }
  createBookingItem(input, context) {
    try {
      this.must('Booking', input.booking_id);
      if (input.supplier_id !== undefined && input.supplier_id !== null && String(input.supplier_id).trim() !== '') this.must('Supplier', input.supplier_id);
      const changes = Object.assign({}, input);
      if (input.required_documents !== undefined) changes.required_documents = clone(Array.isArray(input.required_documents) ? input.required_documents : [input.required_documents]);
      if (input.required_tasks !== undefined) changes.required_tasks = clone(Array.isArray(input.required_tasks) ? input.required_tasks : [input.required_tasks]);
      ['supplier_cost', 'selling_price'].forEach((field) => { if (input[field] !== undefined && input[field] !== null) changes[field] = money(input[field], field); });
      if (input.currency !== undefined && !/^[A-Z]{3}$/i.test(String(input.currency).trim())) throw new WmitError('INVALID_CURRENCY', 'Booking Item currency must be a three-letter currency code.');
      if ((input.supplier_cost !== undefined || input.selling_price !== undefined) && !input.currency) throw new WmitError('CURRENCY_REQUIRED', 'Booking Item currency is required when a cost or selling price is recorded.');
      if (input.currency !== undefined) changes.currency = String(input.currency).trim().toUpperCase();
      return this.createRecord('BookingItem', Object.assign({ fulfillment_state: 'NOT_REQUESTED' }, changes), context);
    } catch (error) { return fail(error); }
  }
  createBookingItemsFromAcceptedSnapshot(input, context) {
    try {
      const booking = this.must('Booking', input.booking_id);
      const snapshot = booking.accepted_commercial_snapshot || {};
      const services = Array.isArray(snapshot.services) ? snapshot.services : [];
      const items = [];
      services.forEach((service, index) => {
        const serviceId = service.quotation_item_id || service.quotation_service_id || service.service_id || String(index + 1);
        const result = this.createBookingItem({
          booking_id: booking.booking_id,
          quotation_item_id: service.quotation_item_id || undefined,
          service_id: service.service_id || undefined,
          service_type: service.service_type || service.type || 'OTHER',
          description: service.description || service.name || service.service_type || 'Travel service',
          supplier_id: service.supplier_id || snapshot.commercial_option && snapshot.commercial_option.supplier_id || undefined,
          quantity: service.quantity === undefined ? 1 : service.quantity,
          destination: service.destination || snapshot.destination || undefined,
          travel_start: service.travel_start || snapshot.travel_start || undefined,
          travel_end: service.travel_end || snapshot.travel_end || undefined,
          selling_price: service.selling_price || service.client_price || service.total_price || undefined,
          supplier_cost: service.supplier_cost || service.cost || undefined,
          required_documents: service.required_documents || service.required_document_types || undefined,
          required_tasks: service.required_tasks || service.required_task_requirements || undefined,
          currency: service.currency || snapshot.pricing && snapshot.pricing.currency || booking.currency || undefined,
          airline: service.airline || undefined,
          flight_number: service.flight_number || undefined,
          departure_airport: service.departure_airport || undefined,
          arrival_airport: service.arrival_airport || undefined,
          departure_time: service.departure_time || undefined,
          arrival_time: service.arrival_time || undefined,
          checkin_baggage_kg: service.checkin_baggage_kg || undefined,
          hand_carry_baggage_kg: service.hand_carry_baggage_kg || undefined,
          idempotency_key: input.idempotency_key ? input.idempotency_key + ':' + serviceId : 'BOOKING-SNAPSHOT-ITEM:' + booking.booking_id + ':' + serviceId
        }, context);
        if (!result.ok) throw new WmitError(result.error.code, result.error.message, result.error.details);
        items.push(result.data);
      });
      return ok({ booking_id: booking.booking_id, items }, { action: 'CREATE_BOOKING_ITEMS_FROM_ACCEPTED_SNAPSHOT', idempotent: true, source: 'accepted_commercial_snapshot' });
    } catch (error) { return fail(error); }
  }
  updateBookingItem(input, context) {
    try {
      const item = this.must('BookingItem', input.booking_item_id);
      const nextState = input.fulfillment_state;
      const allowed = ['NOT_REQUESTED', 'REQUESTED', 'HELD', 'CONFIRMED', 'TICKETED', 'VOUCHERED', 'COMPLETED', 'CANCELLED'];
      if (!allowed.includes(nextState)) throw new WmitError('INVALID_FULFILLMENT_STATE', 'Booking Item fulfillment state is not supported.', { allowed });
      const changes = Object.assign({}, input.changes || {});
      if (changes.supplier_id !== undefined) {
        if (changes.supplier_id) this.must('Supplier', changes.supplier_id);
        const linkedJoins = this.list('SupplierBookingItem', (join) => join.booking_item_id === item.booking_item_id);
        const linkedBookings = this.list('SupplierBooking', (booking) => linkedJoins.some((join) => join.supplier_booking_id === booking.supplier_booking_id) || (booking.booking_id === item.booking_id && Array.isArray(booking.booking_item_ids) && booking.booking_item_ids.includes(item.booking_item_id)));
        if (linkedBookings.length && linkedBookings.some((booking) => booking.supplier_id !== changes.supplier_id)) throw new WmitError('SUPPLIER_CHANGE_BLOCKED', 'Supplier cannot be changed after supplier fulfillment has been linked to this Booking Item. Create a replacement workflow instead.');
      }
      return this.updateRecord('BookingItem', item.booking_item_id, Object.assign({}, changes, { fulfillment_state: nextState }), context);
    } catch (error) { return fail(error); }
  }
  createAvailabilityHold(input, context) {
    try {
      this.requireAuthorization(ACTIONS.RESERVE_SUPPLIER, context);
      const item = this.must('BookingItem', input.booking_item_id);
      const supplierId = input.supplier_id || item.supplier_id;
      this.must('Supplier', supplierId);
      if (item.supplier_id && item.supplier_id !== supplierId) throw new WmitError('SUPPLIER_ITEM_MISMATCH', 'The availability hold Supplier must match the Booking Item Supplier.');
      requireValue(input.expires_at, 'expires_at');
      if (Number.isNaN(Date.parse(input.expires_at))) throw new WmitError('INVALID_EXPIRY', 'Availability hold expiry must be a valid date/time.');
      if (Date.parse(input.expires_at) <= Date.parse(this.now())) throw new WmitError('HOLD_EXPIRY_PAST', 'Availability hold expiry must be in the future.');
      const existing = this.list('AvailabilityHold', (hold) => hold.booking_item_id === item.booking_item_id && ['ACTIVE', 'CONFIRMED'].includes(hold.state) && hold.supplier_id === supplierId);
      if (existing.length) return ok(existing[0], { action: 'IDEMPOTENT_REPLAY', idempotent: true, existing: true });
      const hold = this.createRecord('AvailabilityHold', Object.assign({ state: 'ACTIVE', hold_type: input.hold_type || 'SUPPLIER_AVAILABILITY' }, input, { booking_id: item.booking_id, supplier_id: supplierId, booking_item_id: item.booking_item_id }), context);
      if (hold.ok) this.updateBookingItem({ booking_item_id: item.booking_item_id, fulfillment_state: 'HELD', changes: { availability_hold_id: hold.data.availability_hold_id } }, context);
      return hold;
    } catch (error) { return fail(error); }
  }
  updateAvailabilityHold(input, context) {
    try {
      const hold = this.must('AvailabilityHold', input.availability_hold_id);
      const allowed = ['ACTIVE', 'CONFIRMED', 'EXPIRED', 'CANCELLED'];
      if (!allowed.includes(input.state)) throw new WmitError('INVALID_HOLD_STATE', 'Availability hold state is not supported.', { allowed });
      const result = this.updateRecord('AvailabilityHold', hold.availability_hold_id, { state: input.state, supplier_reference: input.supplier_reference || hold.supplier_reference || null, updated_reason: input.reason || null }, context);
      if (result.ok && ['CONFIRMED', 'EXPIRED', 'CANCELLED'].includes(input.state)) this.updateBookingItem({ booking_item_id: hold.booking_item_id, fulfillment_state: input.state === 'CONFIRMED' ? 'CONFIRMED' : input.state === 'CANCELLED' ? 'CANCELLED' : 'REQUESTED' }, context);
      return result;
    } catch (error) { return fail(error); }
  }
  recordTicketing(input, context) {
    try {
      this.requireAuthorization(ACTIONS.RECORD_TICKETING, context);
      const item = this.must('BookingItem', input.booking_item_id);
      const status = input.status || 'HELD';
      const allowed = ['PENDING', 'HELD', 'TICKETED', 'VOID', 'REFUNDED'];
      if (!allowed.includes(status)) throw new WmitError('INVALID_TICKETING_STATE', 'Ticketing state is not supported.', { allowed });
      if (['HELD', 'TICKETED'].includes(status)) requireValue(input.pnr, 'pnr');
      if (status === 'TICKETED') requireValue(input.ticket_number, 'ticket_number');
      if (input.ticketing_deadline && Number.isNaN(Date.parse(input.ticketing_deadline))) throw new WmitError('INVALID_TICKETING_DEADLINE', 'Ticketing deadline must be a valid date/time.');
      if (input.idempotency_key) {
        const prior = this.list('TicketingRecord', (record) => record.idempotency_key === input.idempotency_key);
        if (prior.length) return ok(prior[0], { action: 'IDEMPOTENT_REPLAY', idempotent: true });
      }
      const record = this.createRecord('TicketingRecord', Object.assign({}, input, { booking_id: item.booking_id, booking_item_id: item.booking_item_id, status, recorded_at: this.now(), recorded_by: this.context(context).actor }), context);
      if (record.ok) this.updateBookingItem({ booking_item_id: item.booking_item_id, fulfillment_state: status === 'TICKETED' ? 'TICKETED' : status === 'HELD' ? 'HELD' : item.fulfillment_state }, context);
      return record;
    } catch (error) { return fail(error); }
  }
  issueVoucher(input, context) {
    try {
      this.requireAuthorization(ACTIONS.ISSUE_VOUCHER, context);
      const item = this.must('BookingItem', input.booking_item_id);
      const existing = this.list('Voucher', (voucher) => voucher.booking_item_id === item.booking_item_id && voucher.status === 'ISSUED');
      if (existing.length) return ok(existing[0], { action: 'IDEMPOTENT_REPLAY', idempotent: true });
      const suppliedNumber = String(input.voucher_number || '').trim();
      const voucher = this.createRecord('Voucher', Object.assign({}, input, { booking_id: item.booking_id, booking_item_id: item.booking_item_id, voucher_number: suppliedNumber || undefined, status: 'ISSUED', issued_at: this.now(), issued_by: this.context(context).actor }), context);
      if (!voucher.ok) return voucher;
      if (!suppliedNumber) {
        const stamped = this.updateRecord('Voucher', voucher.data.voucher_id, { voucher_number: voucher.data.voucher_id }, context);
        if (stamped.ok) this.updateBookingItem({ booking_item_id: item.booking_item_id, fulfillment_state: 'VOUCHERED' }, context);
        return stamped;
      }
      if (voucher.ok) this.updateBookingItem({ booking_item_id: item.booking_item_id, fulfillment_state: 'VOUCHERED' }, context);
      return voucher;
    } catch (error) { return fail(error); }
  }
  issueReceipt(input, context) {
    try {
      this.requireAuthorization(ACTIONS.ISSUE_VOUCHER, context);
      const payment = this.must('ClientPayment', requireValue(input.client_payment_id, 'client_payment_id'));
      if (payment.payment_state !== 'VERIFIED') {
        throw new WmitError('RECEIPT_PAYMENT_NOT_VERIFIED', 'Receipts can only be issued for verified payments. Verify the payment first.', { client_payment_id: payment.client_payment_id, payment_state: payment.payment_state });
      }
      const existing = this.list('Receipt', (receipt) => receipt.client_payment_id === payment.client_payment_id && receipt.status === 'ISSUED');
      if (existing.length) return ok(existing[0], { action: 'IDEMPOTENT_REPLAY', idempotent: true });
      return this.createRecord('Receipt', Object.assign({}, input, {
        client_payment_id: payment.client_payment_id,
        booking_id: payment.booking_id,
        client_id: payment.client_id || null,
        amount: payment.amount,
        currency: payment.currency,
        status: 'ISSUED',
        issued_at: this.now(),
        issued_by: this.context(context).actor
      }), context);
    } catch (error) { return fail(error); }
  }
  getPaymentReceiptPreview(receiptId) {
    try {
      const id = receiptId && typeof receiptId === 'object' ? receiptId.receipt_id || receiptId.client_payment_id : receiptId;
      if (!id) throw new WmitError('RECEIPT_REQUIRED', 'A receipt ID is required to generate the receipt preview.');
      let receipt = this.repos.Receipt.exists(id) ? this.must('Receipt', id) : null;
      let payment = null;
      if (receipt) {
        payment = this.must('ClientPayment', receipt.client_payment_id);
      } else {
        payment = this.must('ClientPayment', id);
        receipt = this.list('Receipt', (record) => record.client_payment_id === payment.client_payment_id && record.status === 'ISSUED')[0] || null;
      }
      const booking = payment.booking_id ? this.must('Booking', payment.booking_id) : null;
      const client = payment.client_id ? this.must('Client', payment.client_id) : (booking && booking.client_id ? this.must('Client', booking.client_id) : null);
      const quotation = booking && booking.quotation_id ? this.must('Quotation', booking.quotation_id) : null;
      return ok({
        receipt: {
          receipt_id: receipt ? receipt.receipt_id : null,
          booking_id: payment.booking_id,
          client_payment_id: payment.client_payment_id,
          amount: payment.amount,
          currency: payment.currency,
          received_at: payment.actual_sent_at || payment.created_at,
          purpose: payment.purpose || null,
          proof_reference: payment.proof_reference || null,
          verified_at: payment.verified_at || null,
          received_by: (receipt && receipt.issued_by) || payment.verified_by || null,
          issued_at: receipt ? receipt.issued_at : this.now(),
          status: receipt ? 'ISSUED' : 'NOT_ISSUED'
        },
        client: client ? { name: client.display_name || client.legal_name, email: client.primary_email || null } : null,
        booking: booking ? { destination: quotation ? quotation.destination : booking.travel_start, travel_start: quotation ? quotation.travel_start : booking.travel_start, travel_end: quotation ? quotation.travel_end : booking.travel_end } : null,
        company: {
          name: 'World Master International Travel',
          bank_details: (this.config.quotationDefaults && this.config.quotationDefaults.bankDetails) || DEFAULT_BANK_DETAILS
        }
      });
    } catch (error) { return fail(error); }
  }
  getClientVoucherPreview(bookingId) {
    try {
      const id = bookingId && typeof bookingId === 'object' ? bookingId.booking_id : bookingId;
      if (!id) throw new WmitError('BOOKING_REQUIRED', 'A booking ID is required to generate the voucher preview.');
      const booking = this.must('Booking', id);
      const quotation = booking.quotation_id ? this.must('Quotation', booking.quotation_id) : null;
      const client = booking.client_id ? this.must('Client', booking.client_id) : null;
      const bookingItems = this.list('BookingItem', (record) => record.booking_id === booking.booking_id);
      const itemIds = new Set(bookingItems.map((record) => record.booking_item_id));
      const vouchers = this.list('Voucher', (voucher) => itemIds.has(voucher.booking_item_id) && String(voucher.status || 'ISSUED') === 'ISSUED');
      return ok({
        booking: {
          booking_id: booking.booking_id,
          commitment_state: booking.commitment_state || null,
          client_name: (client && (client.display_name || client.legal_name)) || booking.client_id,
          destination: quotation ? quotation.destination : null,
          travel_start: quotation ? quotation.travel_start : booking.travel_start || null,
          travel_end: quotation ? quotation.travel_end : booking.travel_end || null,
          currency: quotation ? quotation.currency : this.config.defaultCurrency,
          client_total: quotation ? quotation.client_total : null
        },
        vouchers: vouchers.map((voucher) => {
          const item = bookingItems.find((record) => record.booking_item_id === voucher.booking_item_id);
          const supplier = item && item.supplier_id ? (this.repos.Supplier.exists(item.supplier_id) ? this.must('Supplier', item.supplier_id) : null) : null;
          return {
            voucher_number: voucher.voucher_number,
            issued_at: voucher.issued_at,
            service_description: (item && (item.description || item.service_type)) || 'Booked service',
            supplier_name: supplier ? supplier.display_name : null,
            supplier_contact: supplier ? supplier.primary_email : null
          };
        }),
        vouchers_issued: vouchers.length,
        generated_at: this.now()
      });
    } catch (error) { return fail(error); }
  }
  createRoomingListEntry(input, context) {
    try {
      const booking = this.must('Booking', input.booking_id);
      const person = this.must('Person', input.person_id);
      const participant = this.list('BookingParticipant', (record) => record.booking_id === booking.booking_id && record.person_id === person.person_id);
      if (!participant.length) throw new WmitError('PERSON_NOT_IN_BOOKING', 'Rooming list entries must use a person already attached to the Booking.');
      requireValue(input.room_label, 'room_label');
      const occupancy = normalizeRoomingOccupancy(input.occupancy);
      const capacity = ROOMING_CAPACITY[occupancy];
      if (!capacity) throw new WmitError('INVALID_ROOMING_OCCUPANCY', 'Occupancy must be SGL, TWN, DBL, TRP, or QUAD.', { allowed: Object.keys(ROOMING_CAPACITY) });
      const group = String(input.room_label).trim().toUpperCase();
      const groupEntries = this.list('RoomingListEntry', (record) => record.booking_id === booking.booking_id && String(record.room_label || '').trim().toUpperCase() === group && record.state !== 'CANCELLED');
      const existingOccupancies = groupEntries.map((record) => normalizeRoomingOccupancy(record.occupancy));
      if (existingOccupancies.length && existingOccupancies.some((value) => value !== occupancy)) throw new WmitError('ROOMING_GROUP_OCCUPANCY_MISMATCH', 'All travelers in the same group must use the same occupancy type.', { room_label: input.room_label, existing_occupancy: existingOccupancies[0], requested_occupancy: occupancy });
      if (groupEntries.length >= capacity) throw new WmitError('ROOMING_CAPACITY_EXCEEDED', occupancy + ' allows up to ' + capacity + ' traveler' + (capacity === 1 ? '' : 's') + ' in this group.', { room_label: input.room_label, occupancy, capacity, current_count: groupEntries.length });
      return this.createRecord('RoomingListEntry', Object.assign({ state: 'DRAFT' }, input, { booking_id: booking.booking_id, person_id: person.person_id, occupancy }), context);
    } catch (error) { return fail(error); }
  }
  createBookingParticipant(input, context) {
    try {
      this.must('Booking', input.booking_id); this.must('Person', input.person_id);
      const roles = Array.isArray(input.roles) ? input.roles : (input.role ? [input.role] : []);
      if (roles.includes('LEAD_PAX')) {
        const existingLead = this.list('BookingParticipant', (participant) => participant.booking_id === input.booking_id && (participant.role === 'LEAD_PAX' || (Array.isArray(participant.roles) && participant.roles.includes('LEAD_PAX'))));
        if (existingLead.length) {
          if (existingLead[0].person_id === input.person_id) return ok(existingLead[0], { action: 'IDEMPOTENT_REPLAY', idempotent: true });
          throw new WmitError('LEAD_PAX_ALREADY_ASSIGNED', 'A Booking can have only one lead passenger.', { booking_id: input.booking_id, existing_person_id: existingLead[0].person_id });
        }
      }
      return this.createRecord('BookingParticipant', input, context);
    } catch (error) { return fail(error); }
  }
  createSupplierBooking(input, context) {
    try {
      this.requireAuthorization(ACTIONS.RESERVE_SUPPLIER, context);
      this.must('Supplier', input.supplier_id); const bookingRecord = this.must('Booking', input.booking_id);
      const bookingItemIds = [].concat(input.booking_item_ids || []);
      const bookingItems = bookingItemIds.map((bookingItemId) => this.must('BookingItem', bookingItemId));
      bookingItems.forEach((item) => {
        if (item.booking_id !== bookingRecord.booking_id) throw new WmitError('BOOKING_ITEM_MISMATCH', 'Every Supplier Booking Item must belong to the target Booking.', { booking_id: bookingRecord.booking_id, booking_item_id: item.booking_item_id });
        if (item.supplier_id && item.supplier_id !== input.supplier_id) throw new WmitError('SUPPLIER_ITEM_MISMATCH', 'Every Supplier Booking Item must belong to the selected Supplier.', { supplier_id: input.supplier_id, booking_item_id: item.booking_item_id, item_supplier_id: item.supplier_id });
      });
      const itemSignature = Array.from(new Set(bookingItemIds)).sort().join('|');
      const existing = this.list('SupplierBooking', (record) => record.booking_id === bookingRecord.booking_id && record.supplier_id === input.supplier_id && Array.from(new Set(record.booking_item_ids || [])).sort().join('|') === itemSignature);
      if (existing.length) return ok(existing[0], { action: 'IDEMPOTENT_REPLAY', idempotent: true, existing: true, message: 'Supplier Booking already exists for this Booking, Supplier, and item set.' });
      const booking = this.createRecord('SupplierBooking', Object.assign({ fulfillment_state: 'REQUESTED', reservation_state: 'REQUESTED' }, input), context);
      if (!booking.ok) return booking;
      const savedItems = [];
      try {
        bookingItemIds.forEach((bookingItemId) => {
          const join = this.createRecord('SupplierBookingItem', { supplier_booking_id: booking.data.supplier_booking_id, booking_item_id: bookingItemId }, context);
          if (!join.ok) throw new WmitError(join.error.code, join.error.message, join.error.details);
          savedItems.push(join.data);
        });
      } catch (error) {
        savedItems.forEach((item) => this.repos.SupplierBookingItem.delete(item.supplier_booking_item_id));
        this.repos.SupplierBooking.delete(booking.data.supplier_booking_id);
        throw error;
      }
      return booking;
    } catch (error) { return fail(error); }
  }
  updateSupplierBooking(input, context) {
    try {
      this.requireAuthorization(ACTIONS.RESERVE_SUPPLIER, context);
      const current = this.must('SupplierBooking', input.supplier_booking_id);
      const allowed = ['REQUESTED', 'HELD', 'RESERVED', 'PARTIALLY_CONFIRMED', 'CONFIRMED', 'REJECTED', 'CANCELLED'];
      const nextReservationState = input.reservation_state || input.state || current.reservation_state || current.state || 'REQUESTED';
      const nextFulfillmentState = input.fulfillment_state || (nextReservationState === 'CONFIRMED' ? 'CONFIRMED' : current.fulfillment_state || nextReservationState);
      if (!allowed.includes(String(nextReservationState).toUpperCase())) throw new WmitError('INVALID_SUPPLIER_BOOKING_STATE', 'Supplier Booking state is not supported.', { allowed });
      if (!allowed.includes(String(nextFulfillmentState).toUpperCase())) throw new WmitError('INVALID_SUPPLIER_FULFILLMENT_STATE', 'Supplier fulfillment state is not supported.', { allowed });
      const changes = Object.assign({}, input.changes || {}, {
        reservation_state: String(nextReservationState).toUpperCase(),
        fulfillment_state: String(nextFulfillmentState).toUpperCase()
      });
      ['supplier_reference', 'confirmation_reference', 'confirmation_number', 'confirmation_date', 'confirmation_state', 'confirmation_document_id', 'notes'].forEach((field) => {
        if (input[field] !== undefined) changes[field] = input[field];
      });
      const result = this.updateRecord('SupplierBooking', current.supplier_booking_id, changes, context);
      if (!result.ok) return result;
      const joins = this.list('SupplierBookingItem', (join) => join.supplier_booking_id === current.supplier_booking_id);
      const linkedItemIds = Array.from(new Set(joins.map((join) => join.booking_item_id).concat(current.booking_item_ids || []).filter(Boolean)));
      linkedItemIds.forEach((bookingItemId) => {
        const item = this.get('BookingItem', bookingItemId);
        const itemChanges = {};
        if (input.supplier_reference !== undefined) itemChanges.supplier_reference = input.supplier_reference;
        if (input.confirmation_reference !== undefined) itemChanges.confirmation_reference = input.confirmation_reference;
        if (input.confirmation_number !== undefined) itemChanges.confirmation_number = input.confirmation_number;
        if (input.confirmation_date !== undefined) itemChanges.confirmation_date = input.confirmation_date;
        if (String(nextReservationState).toUpperCase() === 'CONFIRMED') itemChanges.fulfillment_state = 'CONFIRMED';
        else if (String(nextReservationState).toUpperCase() === 'CANCELLED') itemChanges.fulfillment_state = 'CANCELLED';
        else if (!['CONFIRMED', 'TICKETED', 'VOUCHERED', 'COMPLETED'].includes(String(item.fulfillment_state || '').toUpperCase())) itemChanges.fulfillment_state = String(nextReservationState).toUpperCase();
        if (Object.keys(itemChanges).length) this.updateRecord('BookingItem', item.booking_item_id, itemChanges, context);
      });
      return ok(this.get('SupplierBooking', current.supplier_booking_id), { action: 'UPDATE_SUPPLIER_BOOKING', linkedBookingItemIds: linkedItemIds });
    } catch (error) { return fail(error); }
  }
  confirmSupplierBookingItem(input, context) {
    try {
      this.requireAuthorization(ACTIONS.RESERVE_SUPPLIER, context);
      const current = this.must('SupplierBooking', input.supplier_booking_id);
      const targetItemId = requireValue(input.booking_item_id, 'booking_item_id');
      const joins = this.list('SupplierBookingItem', (join) => join.supplier_booking_id === current.supplier_booking_id);
      const linkedItemIds = Array.from(new Set(joins.map((join) => join.booking_item_id).concat(current.booking_item_ids || []).filter(Boolean)));
      if (!linkedItemIds.includes(targetItemId)) throw new WmitError('BOOKING_ITEM_NOT_LINKED', 'The selected service is not part of this supplier reservation.', { supplier_booking_id: current.supplier_booking_id, booking_item_id: targetItemId });
      let targetBooking = current;
      if (linkedItemIds.length > 1) {
        const existing = this.list('SupplierBooking', (record) => {
          if (record.supplier_booking_id === current.supplier_booking_id || record.booking_id !== current.booking_id || record.supplier_id !== current.supplier_id) return false;
          const ids = Array.from(new Set(record.booking_item_ids || [])).sort();
          return ids.length === 1 && ids[0] === targetItemId;
        });
        if (existing.length) targetBooking = existing[existing.length - 1];
        else {
          const created = this.createSupplierBooking({ booking_id: current.booking_id, supplier_id: current.supplier_id, booking_item_ids: [targetItemId], supplier_reference: input.supplier_reference, confirmation_reference: input.confirmation_reference, confirmation_number: input.confirmation_number, confirmation_date: input.confirmation_date, notes: input.notes }, context);
          if (!created.ok) return created;
          targetBooking = created.data;
        }
      }
      return this.updateSupplierBooking(Object.assign({}, input, { supplier_booking_id: targetBooking.supplier_booking_id, reservation_state: 'CONFIRMED' }), context);
    } catch (error) { return fail(error); }
  }
  updateSettings(input, context) {
    try {
      this.requireAuthorization(ACTIONS.CONFIGURE_SETTINGS, context);
      const values = input && (input.quotation_defaults || input.quotationDefaults) || input || {};
      const current = this.config.quotationDefaults || {};
      const next = Object.assign({}, current);
      ['paymentTerms', 'paymentCurrencyPolicy', 'currency', 'bankDetails'].forEach((field) => { if (values[field] !== undefined) next[field] = String(values[field]).trim(); });
      ['validityDays', 'downPaymentDaysAfterReservation', 'finalBalanceBusinessDaysBeforeDeparture'].forEach((field) => {
        if (values[field] !== undefined) {
          const number = Number(values[field]);
          if (!Number.isInteger(number) || number < 0 || (field === 'validityDays' && number < 1)) throw new WmitError('INVALID_SETTING', field + ' must be a valid whole number.');
          next[field] = number;
        }
      });
      if (next.currency && !/^[A-Z]{3}$/i.test(next.currency)) throw new WmitError('INVALID_SETTING', 'currency must be a three-letter currency code.');
      this.config.quotationDefaults = next;
      let templatesChanged = false;
      if (values.messageTemplates !== undefined) {
        this.config.messageTemplates = this.validatedMessageTemplates(values.messageTemplates);
        templatesChanged = true;
      }
      this.auditLog.record({ actor: this.context(context).actor, action: 'UPDATE', entity_type: 'Configuration', entity_id: 'LOCAL_CONFIGURATION', details: { changedFields: Object.keys(values) }, correlation_id: this.context(context).correlationId });
      if (this.onSettingsChanged) {
        try { this.onSettingsChanged({ quotationDefaults: this.config.quotationDefaults, messageTemplates: this.config.messageTemplates }); } catch (_) { /* persistence failure must not roll back the in-memory setting */ }
      }
      return ok({ quotationDefaults: clone(next), messageTemplates: this.config.messageTemplates.slice() }, { action: 'UPDATE_SETTINGS' });
    } catch (error) { return fail(error); }
  }
  validatedMessageTemplates(templates) {
    if (!Array.isArray(templates)) throw new WmitError('INVALID_SETTING', 'messageTemplates must be a list.');
    if (templates.length > 50) throw new WmitError('INVALID_SETTING', 'At most 50 message templates are allowed.');
    const seen = new Set();
    return templates.map((template) => {
      const value = template || {};
      const key = String(value.key || '').trim();
      const label = String(value.label || value.key || '').trim();
      const body = String(value.body || '').trim();
      if (!/^[A-Z0-9_]{2,40}$/.test(key)) throw new WmitError('INVALID_SETTING', 'Template key must use letters, numbers, and underscores (2-40 characters).');
      if (seen.has(key)) throw new WmitError('INVALID_SETTING', 'Duplicate template key: ' + key);
      seen.add(key);
      if (!label) throw new WmitError('INVALID_SETTING', 'Template ' + key + ' needs a label.');
      if (!body || body.length > 2000) throw new WmitError('INVALID_SETTING', 'Template ' + key + ' needs a body of up to 2000 characters.');
      return { key, label, body };
    });
  }
  createClientObligation(input, context) {
    try {
      const value = Object.assign({}, input || {});
      const booking = value.booking_id ? this.must('Booking', value.booking_id) : null;
      const amount = money(value.amount || value.total_amount || value.balance_due, 'amount');
      if (toMinorUnits(amount) <= 0n) throw new WmitError('OBLIGATION_AMOUNT_INVALID', 'Client obligation amount must be greater than zero.');
      const currency = String(value.currency || booking && booking.currency || this.config.defaultCurrency).trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new WmitError('INVALID_CURRENCY', 'Client obligation currency must be a three-letter currency code.');
      if (value.due_at && Number.isNaN(Date.parse(value.due_at))) throw new WmitError('INVALID_DUE_DATE', 'Client obligation due date must be valid.');
      const sequence = value.sequence === undefined ? null : Number(value.sequence);
      if (sequence !== null && (!Number.isInteger(sequence) || sequence < 1)) throw new WmitError('INVALID_OBLIGATION_SEQUENCE', 'Client obligation sequence must be a positive integer.');
      const obligationKey = value.obligation_key || (booking && sequence ? booking.booking_id + ':OBLIGATION:' + sequence : null);
      const existing = this.list('ClientObligation', (record) => {
        if (value.idempotency_key && record.idempotency_key === value.idempotency_key) return true;
        if (obligationKey && record.obligation_key === obligationKey) return true;
        return Boolean(booking && sequence && record.booking_id === booking.booking_id && Number(record.sequence) === sequence);
      });
      if (existing.length) return ok(existing[0], { action: 'IDEMPOTENT_REPLAY', idempotent: true });
      return this.createRecord('ClientObligation', Object.assign({ state: 'DUE', purpose: value.purpose || 'INSTALLMENT' }, value, {
        booking_id: booking && booking.booking_id || value.booking_id,
        amount,
        currency,
        sequence,
        obligation_key: obligationKey,
        balance_due: amount
      }), context);
    } catch (error) { return fail(error); }
  }
  createClientInvoice(input, context) { return this.createRecord('ClientInvoice', Object.assign({ state: 'DRAFT' }, input), context); }
  createPaymentScheduleItem(input, context) {
    try {
      const booking = this.must('Booking', input.booking_id);
      const amount = money(input.amount, 'amount');
      if (toMinorUnits(amount) <= 0n) throw new WmitError('SCHEDULE_AMOUNT_INVALID', 'Payment schedule amount must be greater than zero.');
      const currency = String(input.currency || '').trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new WmitError('INVALID_CURRENCY', 'Payment schedule currency must be a three-letter currency code.');
      requireValue(input.due_at, 'due_at');
      if (Number.isNaN(Date.parse(input.due_at))) throw new WmitError('INVALID_DUE_DATE', 'Payment schedule due date must be valid.');
      const purpose = input.purpose || 'INSTALLMENT';
      if (!['DOWN_PAYMENT', 'INSTALLMENT', 'FINAL_BALANCE', 'FULL_PAYMENT', 'OTHER'].includes(purpose)) throw new WmitError('INVALID_SCHEDULE_PURPOSE', 'Payment schedule purpose is not supported.');
      const sequence = Number(input.sequence || 1);
      if (!Number.isInteger(sequence) || sequence < 1) throw new WmitError('INVALID_SCHEDULE_SEQUENCE', 'Payment schedule sequence must be a positive integer.');
      const obligationKey = input.obligation_key || booking.booking_id + ':OBLIGATION:' + sequence;
      const existing = this.list('PaymentScheduleItem', (item) => item.booking_id === booking.booking_id && (item.sequence === sequence || item.obligation_key === obligationKey));
      if (existing.length) return ok(existing[0], { action: 'IDEMPOTENT_REPLAY', idempotent: true });
      return this.createRecord('PaymentScheduleItem', Object.assign({ state: 'DUE', obligation_state: 'OUTSTANDING' }, input, { booking_id: booking.booking_id, amount, currency, purpose, sequence, obligation_key: obligationKey, balance_due: amount }), context);
    } catch (error) { return fail(error); }
  }
  createBookingPaymentObligations(input, context) {
    try {
      const booking = this.must('Booking', input.booking_id);
      const entries = input.obligations || input.schedule || input.payment_schedule || [];
      if (!Array.isArray(entries) || !entries.length) throw new WmitError('OBLIGATIONS_REQUIRED', 'At least one Booking payment obligation is required.');
      const defaults = this.config.quotationDefaults || {};
      const preparedEntries = entries.map((entry) => {
        const prepared = Object.assign({}, entry);
        if (!prepared.due_at) {
          const dueDate = defaultPaymentDueDate(booking, String(prepared.purpose || '').toUpperCase(), defaults);
          if (dueDate) prepared.due_at = dueDate + 'T09:00:00.000Z';
        }
        return prepared;
      });
      const createdObligations = [];
      const createdSchedule = [];
      let allExisting = true;
      try {
        preparedEntries.forEach((entry, index) => {
          const sequence = entry.sequence === undefined ? index + 1 : entry.sequence;
          const obligationKey = entry.obligation_key || booking.booking_id + ':OBLIGATION:' + sequence;
          const obligation = this.createClientObligation(Object.assign({}, entry, { booking_id: booking.booking_id, sequence, obligation_key: obligationKey, currency: entry.currency || booking.currency }), context);
          if (!obligation.ok) throw new WmitError(obligation.error.code, obligation.error.message, obligation.error.details);
          if (!obligation.meta.idempotent) { createdObligations.push(obligation.data); allExisting = false; }
          const schedule = this.createPaymentScheduleItem(Object.assign({}, entry, { booking_id: booking.booking_id, sequence, obligation_key: obligationKey, client_obligation_id: obligation.data.client_obligation_id, currency: entry.currency || booking.currency }), context);
          if (!schedule.ok) throw new WmitError(schedule.error.code, schedule.error.message, schedule.error.details);
          if (!schedule.meta.idempotent) { createdSchedule.push(schedule.data); allExisting = false; }
        });
      } catch (error) {
        createdSchedule.forEach((record) => this.repos.PaymentScheduleItem.delete(record.payment_schedule_item_id));
        createdObligations.forEach((record) => this.repos.ClientObligation.delete(record.client_obligation_id));
        throw error;
      }
      const savedObligations = this.list('ClientObligation', (record) => record.booking_id === booking.booking_id && preparedEntries.some((entry, index) => record.obligation_key === (entry.obligation_key || booking.booking_id + ':OBLIGATION:' + (entry.sequence === undefined ? index + 1 : entry.sequence))));
      const savedSchedule = this.list('PaymentScheduleItem', (record) => record.booking_id === booking.booking_id && preparedEntries.some((entry, index) => record.obligation_key === (entry.obligation_key || booking.booking_id + ':OBLIGATION:' + (entry.sequence === undefined ? index + 1 : entry.sequence))));
      return ok({ booking_id: booking.booking_id, obligations: savedObligations, schedule: savedSchedule }, { action: 'CREATE_BOOKING_OBLIGATIONS', idempotent: allExisting });
    } catch (error) { return fail(error); }
  }
  recordClientPayment(input, context) {
    try {
      requireValue(input.booking_id, 'booking_id'); requireValue(input.proof_document_id || input.proof_reference, 'proof_document_id or proof_reference');
      const booking = this.must('Booking', input.booking_id);
      if (input.client_id && input.client_id !== booking.client_id) throw new WmitError('CLIENT_BOOKING_MISMATCH', 'The payment client does not match the Booking client.', { booking_id: booking.booking_id, booking_client_id: booking.client_id, client_id: input.client_id });
      const amount = money(input.amount, 'amount');
      if (toMinorUnits(amount) <= 0n) throw new WmitError('PAYMENT_AMOUNT_INVALID', 'Client payment amount must be greater than zero.');
      const currency = String(input.currency || this.config.defaultCurrency).trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new WmitError('INVALID_CURRENCY', 'Client payment currency must be a three-letter currency code.', { currency });
      const obligationRecords = this.list('ClientObligation', (record) => record.booking_id === booking.booking_id);
      const scheduleRecords = this.list('PaymentScheduleItem', (record) => record.booking_id === booking.booking_id);
      const authoritativeObligations = obligationRecords.length ? obligationRecords : scheduleRecords;
      if (authoritativeObligations.length) {
        const obligationTotal = authoritativeObligations.reduce((sum, record) => sum + toMinorUnits(record.amount || record.total_amount || record.balance_due || '0.00'), 0n);
        const allocatedTotal = this.list('PaymentAllocation', (record) => record.booking_id === booking.booking_id && record.state === 'ACTIVE').reduce((sum, record) => sum + toMinorUnits(record.amount || '0.00'), 0n);
        if (obligationTotal > 0n && allocatedTotal >= obligationTotal) throw new WmitError('BOOKING_ALREADY_PAID', 'This Booking is already fully paid. Review any duplicate or excess funds instead of recording another client payment.', { booking_id: booking.booking_id, obligation_total: fromMinorUnits(obligationTotal), allocated_total: fromMinorUnits(allocatedTotal) });
      }
      const paymentPurposes = ['DOWN_PAYMENT', 'PARTIAL_PAYMENT', 'FULL_PAYMENT', 'BALANCE_PAYMENT', 'OTHER'];
      const paymentPurpose = input.payment_purpose || 'OTHER';
      if (!paymentPurposes.includes(paymentPurpose)) throw new WmitError('INVALID_PAYMENT_PURPOSE', 'Payment purpose is not supported.', { allowed: paymentPurposes });
      if (input.idempotency_key) {
        const prior = this.list('ClientPayment', (p) => p.idempotency_key === input.idempotency_key);
        if (prior.length) return ok({ payment: prior[0], evidence: this.list('PaymentEvidence', (e) => e.client_payment_id === prior[0].client_payment_id)[0] }, { action: 'IDEMPOTENT_REPLAY', idempotent: true });
      }
      const payment = this.createRecord('ClientPayment', Object.assign({}, input, { booking_id: booking.booking_id, client_id: booking.client_id, amount, currency, payment_state: 'PENDING_VERIFICATION', verification_at: null, actual_sent_at: input.actual_sent_at || input.payment_sent_at || null, payment_purpose: paymentPurpose }), context);
      if (!payment.ok) return payment;
      const evidence = this.createRecord('PaymentEvidence', { client_payment_id: payment.data.client_payment_id, proof_document_id: input.proof_document_id, proof_reference: input.proof_reference, received_at: this.now(), verification_state: 'PENDING' }, context);
      if (!evidence.ok) {
        this.repos.ClientPayment.delete(payment.data.client_payment_id);
        return evidence;
      }
      return ok({ payment: payment.data, evidence: evidence.data }, { action: 'RECORD_CLIENT_PAYMENT' });
    } catch (error) { return fail(error); }
  }
  verifyClientPayment(input, context) {
    try {
      this.requireAuthorization(ACTIONS.VERIFY_PAYMENT, context);
      const payment = this.must('ClientPayment', input.client_payment_id);
      const state = input.verified === false ? 'REJECTED' : 'VERIFIED';
      if (payment.payment_state !== 'PENDING_VERIFICATION') {
        if (payment.payment_state === state) return ok(payment, { action: 'IDEMPOTENT_REPLAY', idempotent: true });
        throw new WmitError('PAYMENT_ALREADY_FINALIZED', 'A verified or rejected payment cannot be silently changed. Record a new payment or use an approved correction workflow.', { client_payment_id: payment.client_payment_id, current_state: payment.payment_state, requested_state: state });
      }
      const updated = this.updateRecord('ClientPayment', payment.client_payment_id, { payment_state: state, verification_at: this.now(), verified_by: this.context(context).actor, verification_reason: input.reason || null }, context);
      this.list('PaymentEvidence', (e) => e.client_payment_id === payment.client_payment_id).forEach((e) => this.updateRecord('PaymentEvidence', e.payment_evidence_id, { verification_state: state }, context));
      return updated;
    } catch (error) { return fail(error); }
  }
  allocatePayment(input, context) {
    try {
      this.requireAuthorization(ACTIONS.ALLOCATE_PAYMENT, context);
      const payment = this.must('ClientPayment', input.client_payment_id);
      if (payment.payment_state !== 'VERIFIED') throw new WmitError('PAYMENT_NOT_VERIFIED', 'Only verified client funds may be allocated.');
      const allocations = input.allocations || [];
      if (!allocations.length) throw new WmitError('ALLOCATION_REQUIRED', 'Client-directed allocation is required; otherwise leave the payment unallocated.');
      if (input.idempotency_key) {
        const prior = this.list('PaymentAllocation', (allocation) => allocation.allocation_batch_key === input.idempotency_key);
        if (prior.length) return ok(prior, { action: 'IDEMPOTENT_REPLAY', idempotent: true });
      }
      const normalized = allocations.map((a) => {
        const booking = this.must('Booking', a.booking_id);
        if (booking.booking_id !== payment.booking_id) throw new WmitError('PAYMENT_BOOKING_MISMATCH', 'A client payment may only be allocated to its recorded Booking.', { payment_booking_id: payment.booking_id, allocation_booking_id: booking.booking_id });
        if (booking.client_id !== payment.client_id) throw new WmitError('CLIENT_BOOKING_MISMATCH', 'Payment allocation must target a Booking for the same client.', { payment_client_id: payment.client_id, booking_id: booking.booking_id, booking_client_id: booking.client_id });
        if (a.client_obligation_id) {
          const obligation = this.must('ClientObligation', a.client_obligation_id);
          if (obligation.booking_id !== booking.booking_id) throw new WmitError('ALLOCATION_TARGET_MISMATCH', 'The client obligation does not belong to the allocation Booking.', { client_obligation_id: obligation.client_obligation_id, booking_id: booking.booking_id });
          if (obligation.currency && obligation.currency !== payment.currency) throw new WmitError('ALLOCATION_CURRENCY_MISMATCH', 'The client obligation currency must match the payment currency.', { client_obligation_id: obligation.client_obligation_id, obligation_currency: obligation.currency, payment_currency: payment.currency });
          const obligationAllocated = this.list('PaymentAllocation', (allocation) => allocation.client_obligation_id === obligation.client_obligation_id && allocation.state === 'ACTIVE').reduce((sum, allocation) => sum + toMinorUnits(allocation.amount), 0n);
          const requested = money(a.amount, 'allocation.amount');
          if (obligationAllocated + toMinorUnits(requested) > toMinorUnits(obligation.amount || obligation.total_amount || obligation.balance_due)) throw new WmitError('ALLOCATION_EXCEEDS_OBLIGATION', 'The requested allocation exceeds the remaining amount of the client obligation; leave any excess explicitly unallocated.', { client_obligation_id: obligation.client_obligation_id, obligation_amount: obligation.amount, already_allocated: fromMinorUnits(obligationAllocated), requested: requested });
        }
        const amount = money(a.amount, 'allocation.amount');
        if (toMinorUnits(amount) <= 0n) throw new WmitError('ALLOCATION_AMOUNT_INVALID', 'Payment allocation amount must be greater than zero.');
        return { booking_id: booking.booking_id, client_obligation_id: a.client_obligation_id, amount, instruction_note: a.instruction_note || null };
      });
      const total = normalized.reduce((sum, a) => sum + toMinorUnits(a.amount), 0n);
      const existingTotal = this.list('PaymentAllocation', (allocation) => allocation.client_payment_id === payment.client_payment_id && allocation.state === 'ACTIVE').reduce((sum, allocation) => sum + toMinorUnits(allocation.amount), 0n);
      if (existingTotal + total > toMinorUnits(payment.amount)) throw new WmitError('ALLOCATION_EXCEEDS_PAYMENT', 'Active allocations cannot exceed the verified payment amount.', { payment_amount: payment.amount, already_allocated: fromMinorUnits(existingTotal), requested: fromMinorUnits(total) });
      const signature = normalized.map((a) => [a.booking_id, a.client_obligation_id || '', a.amount].join(':')).sort().join('|');
      const priorSignature = this.list('PaymentAllocation', (allocation) => allocation.client_payment_id === payment.client_payment_id && allocation.state === 'ACTIVE' && allocation.allocation_signature === signature);
      if (priorSignature.length) return ok(priorSignature, { action: 'IDEMPOTENT_REPLAY', idempotent: true });
      const saved = [];
      try {
        normalized.forEach((a) => {
          const result = this.createRecord('PaymentAllocation', Object.assign({}, a, { client_payment_id: payment.client_payment_id, currency: payment.currency, instruction_source: 'CLIENT', state: 'ACTIVE', allocation_batch_key: input.idempotency_key || null, allocation_signature: signature }), context);
          if (!result.ok) throw new WmitError(result.error.code, result.error.message, result.error.details);
          saved.push(result.data);
        });
      } catch (error) {
        saved.forEach((allocation) => this.repos.PaymentAllocation.delete(allocation.payment_allocation_id));
        throw error;
      }
      return ok(saved, { action: 'ALLOCATE_PAYMENT' });
    } catch (error) { return fail(error); }
  }
  createSupplierPayable(input, context) {
    try {
      const supplierBooking = this.must('SupplierBooking', input.supplier_booking_id);
      const booking = this.must('Booking', input.booking_id);
      if (supplierBooking.booking_id !== booking.booking_id) throw new WmitError('BOOKING_SUPPLIER_BOOKING_MISMATCH', 'The Supplier Payable Booking must match the Supplier Booking Booking.', { supplier_booking_id: supplierBooking.supplier_booking_id, supplier_booking_booking_id: supplierBooking.booking_id, booking_id: booking.booking_id });
      const amount = money(input.amount, 'amount');
      if (toMinorUnits(amount) <= 0n) throw new WmitError('PAYABLE_AMOUNT_INVALID', 'Supplier Payable amount must be greater than zero.');
      const currency = String(input.currency || '').trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new WmitError('INVALID_CURRENCY', 'Supplier Payable currency must be a three-letter currency code.', { currency });
      return this.createRecord('SupplierPayable', Object.assign({ state: 'DRAFT', client_money_gate: 'VERIFIED_ALLOCATED_FUNDS' }, input, { booking_id: booking.booking_id, amount, currency }), context);
    } catch (error) { return fail(error); }
  }
  approveSupplierPayable(input, context) {
    try {
      this.requireAuthorization(ACTIONS.APPROVE_PAYABLE, context);
      const payable = this.must('SupplierPayable', input.supplier_payable_id);
      if (payable.state === 'APPROVED') return ok(payable, { action: 'IDEMPOTENT_REPLAY', idempotent: true });
      if (payable.state !== 'DRAFT') throw new WmitError('PAYABLE_STATE_INVALID', 'Only a draft Supplier Payable can be approved.', { supplier_payable_id: payable.supplier_payable_id, current_state: payable.state });
      return this.updateRecord('SupplierPayable', payable.supplier_payable_id, { state: 'APPROVED', approved_at: this.now(), approved_by: this.context(context).actor }, context);
    } catch (error) { return fail(error); }
  }
  verifiedAllocatedFunds(bookingId, currency) {
    return this.list('PaymentAllocation', (a) => a.booking_id === bookingId && a.currency === currency && a.state === 'ACTIVE').reduce((sum, allocation) => {
      const payment = this.must('ClientPayment', allocation.client_payment_id);
      return payment.payment_state === 'VERIFIED' ? sum + toMinorUnits(allocation.amount) : sum;
    }, 0n);
  }
  executeSupplierPayment(input, context) {
    try {
      this.requireAuthorization(ACTIONS.SUPPLIER_PAYMENT, context);
      if (input.idempotency_key) {
        const prior = this.list('SupplierPayment', (p) => p.idempotency_key === input.idempotency_key);
        if (prior.length) return ok(prior[0], { action: 'IDEMPOTENT_REPLAY', idempotent: true });
      }
      const payable = this.must('SupplierPayable', input.supplier_payable_id);
      if (payable.state !== 'APPROVED') throw new WmitError('PAYABLE_NOT_APPROVED', 'Supplier Payment requires an approved Supplier Payable target.');
      const booking = this.must('SupplierBooking', payable.supplier_booking_id);
      const supplier = payable.supplier_id ? this.must('Supplier', payable.supplier_id) : (booking.supplier_id ? this.must('Supplier', booking.supplier_id) : null);
      if (!supplier || !String(supplier.display_name || supplier.legal_name || '').trim()) throw new WmitError('SUPPLIER_PAYMENT_PREREQUISITES_MISSING', 'Supplier Payment requires a valid supplier record with a name.');
      const amount = money(input.amount || payable.amount, 'amount');
      const previous = this.list('SupplierPayment', (p) => p.supplier_payable_id === payable.supplier_payable_id && ['EXECUTED', 'VERIFIED'].includes(p.state)).reduce((sum, p) => sum + toMinorUnits(p.amount), 0n);
      const remainingPayable = toMinorUnits(payable.amount) - previous;
      if (remainingPayable <= 0n) throw new WmitError('SUPPLIER_PAYABLE_ALREADY_PAID', 'The Supplier Payable has already been fully paid.');
      if (toMinorUnits(amount) > remainingPayable) throw new WmitError('SUPPLIER_PAYMENT_EXCEEDS_PAYABLE', 'Supplier Payment cannot exceed the remaining Supplier Payable amount.', { remaining: fromMinorUnits(remainingPayable), requested: amount });
      const available = this.verifiedAllocatedFunds(booking.booking_id, payable.currency);
      const alreadyPaidForBooking = this.list('SupplierPayment', (p) => p.booking_id === booking.booking_id && ['EXECUTED', 'VERIFIED'].includes(p.state)).reduce((sum, p) => sum + toMinorUnits(p.amount), 0n);
      if (available - alreadyPaidForBooking < toMinorUnits(amount)) throw new WmitError('INSUFFICIENT_VERIFIED_CLIENT_FUNDS', 'Supplier Payment is blocked because verified client funds allocated to this Booking are insufficient.', { available: fromMinorUnits(available - alreadyPaidForBooking < 0n ? 0n : available - alreadyPaidForBooking), required: amount });
      return this.createRecord('SupplierPayment', Object.assign({}, input, { supplier_payable_id: payable.supplier_payable_id, supplier_booking_id: booking.supplier_booking_id, booking_id: booking.booking_id, amount, currency: payable.currency, state: 'EXECUTED', executed_at: this.now(), executed_by: this.context(context).actor }), context);
    } catch (error) { return fail(error); }
  }
  requestRefund(input, context) { try { return this.createRecord('RefundAdjustment', Object.assign({ state: 'DRAFT', approval_required: true }, input), context); } catch (error) { return fail(error); } }
  executeRefund(input, context) {
    try {
      this.requireAuthorization(ACTIONS.REFUND, context);
      const draft = this.must('RefundAdjustment', input.refund_adjustment_id);
      if (draft.state === 'EXECUTED') return ok(draft, { action: 'IDEMPOTENT_REPLAY', idempotent: true });
      if (draft.state !== 'DRAFT') throw new WmitError('REFUND_STATE_INVALID', 'Only a draft refund can be executed.', { refund_adjustment_id: draft.refund_adjustment_id, current_state: draft.state });
      if (draft.approval_required && input.approval_confirmed !== true) throw new WmitError('REFUND_APPROVAL_REQUIRED', 'Explicit human confirmation is required before this refund is executed. Re-run with approval_confirmed: true.', { refund_adjustment_id: draft.refund_adjustment_id, amount: draft.amount, currency: draft.currency });
      const amount = money(draft.amount, 'amount');
      if (toMinorUnits(amount) <= 0n) throw new WmitError('REFUND_AMOUNT_INVALID', 'Refund amount must be greater than zero.', { refund_adjustment_id: draft.refund_adjustment_id });
      const currency = String(draft.currency || '').trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new WmitError('INVALID_CURRENCY', 'Refund currency must be a three-letter currency code.', { currency: draft.currency });
      requireValue(draft.booking_id, 'booking_id');
      const booking = this.must('Booking', draft.booking_id);
      if (draft.client_id && booking.client_id && draft.client_id !== booking.client_id) throw new WmitError('CLIENT_BOOKING_MISMATCH', 'The refund client does not match the Booking client.', { booking_id: booking.booking_id, booking_client_id: booking.client_id, refund_client_id: draft.client_id });
      const verifiedFunds = this.verifiedAllocatedFunds(booking.booking_id, currency);
      const paidToSuppliers = this.list('SupplierPayment', (p) => p.booking_id === booking.booking_id && p.currency === currency && ['EXECUTED', 'VERIFIED'].includes(p.state)).reduce((sum, p) => sum + toMinorUnits(p.amount), 0n);
      const refundedAlready = this.list('RefundAdjustment', (r) => r.booking_id === booking.booking_id && r.currency === currency && r.state === 'EXECUTED' && r.refund_adjustment_id !== draft.refund_adjustment_id).reduce((sum, r) => sum + toMinorUnits(money(r.amount, 'amount')), 0n);
      if (verifiedFunds - paidToSuppliers - refundedAlready < toMinorUnits(amount)) {
        throw new WmitError('REFUND_EXCEEDS_AVAILABLE_FUNDS', 'Verified client funds for this Booking do not cover this refund after supplier payments and prior refunds.', { booking_id: booking.booking_id, currency, verified_allocated: fromMinorUnits(verifiedFunds), paid_to_suppliers: fromMinorUnits(paidToSuppliers), already_refunded: fromMinorUnits(refundedAlready), requested: amount });
      }
      return this.updateRecord('RefundAdjustment', draft.refund_adjustment_id, { state: 'EXECUTED', executed_at: this.now(), executed_by: this.context(context).actor }, context);
    } catch (error) { return fail(error); }
  }
  amendBooking(input, context) {
    try {
      const booking = this.must('Booking', input.booking_id);
      const before = { current_price: booking.current_price, current_supplier_cost: booking.current_supplier_cost, travel_start: booking.travel_start, travel_end: booking.travel_end, product: booking.product, supplier_id: booking.supplier_id };
      const after = Object.assign({}, before, input.changes || {});
      const priceChanged = before.current_price !== after.current_price || before.current_supplier_cost !== after.current_supplier_cost;
      const amendment = this.createRecord('Amendment', { booking_id: booking.booking_id, before_snapshot: before, after_snapshot: after, accepted_snapshot_before: clone(booking.accepted_commercial_snapshot || null), reason: input.reason, state: priceChanged ? 'REACCEPTANCE_REQUIRED' : 'RECORDED', client_acceptance_required: priceChanged, supplier_actions: [], actor: this.context(context).actor }, context);
      if (!amendment.ok) return amendment;
      const updated = this.updateRecord('Booking', booking.booking_id, Object.assign({}, input.changes, priceChanged ? { commitment_state: 'REACCEPTANCE_REQUIRED' } : {}), context);
      return ok({ booking: updated.data, amendment: amendment.data }, { action: 'AMEND_BOOKING' });
    } catch (error) { return fail(error); }
  }
  acceptAmendment(input, context) {
    try {
      this.requireAuthorization(ACTIONS.CLIENT_ACCEPT_AMENDMENT, context);
      const amendment = this.must('Amendment', input.amendment_id);
      if (amendment.state === 'ACCEPTED') return ok(amendment, { action: 'IDEMPOTENT_REPLAY', idempotent: true });
      const booking = this.must('Booking', amendment.booking_id);
      const acceptedBy = requireValue(input.accepted_by || input.client_contact, 'accepted_by');
      const updated = this.updateRecord('Amendment', amendment.amendment_id, { state: 'ACCEPTED', client_acceptance_required: false, accepted_by: acceptedBy, accepted_at: input.accepted_at || this.now(), acceptance_reference: input.acceptance_reference || null }, context);
      if (!updated.ok) return updated;
      const acceptedSnapshot = clone(booking.accepted_commercial_snapshot || {});
      const revisedSnapshot = Object.assign({}, acceptedSnapshot, {
        snapshot_schema_version: acceptedSnapshot.snapshot_schema_version || 1,
        amendment_id: amendment.amendment_id,
        accepted_at: input.accepted_at || this.now(),
        accepted_by: acceptedBy,
        commercial_version: Number(booking.accepted_commercial_version || acceptedSnapshot.commercial_version || 1) + 1,
        current_amendment: clone(amendment.after_snapshot)
      });
      revisedSnapshot.pricing = Object.assign({}, acceptedSnapshot.pricing || {}, {
        client_price: amendment.after_snapshot.current_price || acceptedSnapshot.pricing && acceptedSnapshot.pricing.client_price,
        supplier_cost: amendment.after_snapshot.current_supplier_cost || acceptedSnapshot.pricing && acceptedSnapshot.pricing.supplier_cost
      });
      ['destination', 'travel_start', 'travel_end', 'product', 'supplier_id'].forEach((field) => { if (amendment.after_snapshot[field] !== undefined) revisedSnapshot[field] = amendment.after_snapshot[field]; });
      this.updateRecord('Booking', booking.booking_id, { commitment_state: 'CONFIRMED', client_decision_state: 'AMENDMENT_ACCEPTED', commitment_confirmed_at: this.now(), accepted_commercial_version: revisedSnapshot.commercial_version, accepted_amendment_id: amendment.amendment_id, accepted_commercial_snapshot: revisedSnapshot }, context);
      return updated;
    } catch (error) { return fail(error); }
  }
  reconcileBooking(input, context) {
    try {
      this.requireAuthorization(ACTIONS.RECONCILE_BOOKING, context);
      const booking = this.must('Booking', input.booking_id);
      const currency = String(input.currency || booking.currency || 'PHP').trim().toUpperCase();
      const quote = booking.quotation_id ? this.list('Quotation', (item) => item.quotation_id === booking.quotation_id)[0] : null;
      const clientPrice = booking.current_price || quote && quote.client_total || '0.00';
      const supplierCost = booking.current_supplier_cost || quote && quote.supplier_cost_total || '0.00';
      const allocated = fromMinorUnits(this.verifiedAllocatedFunds(booking.booking_id, currency));
      const payables = this.list('SupplierPayable', (item) => item.booking_id === booking.booking_id && item.currency === currency).reduce((sum, item) => addMoney(sum, item.amount), '0.00');
      const supplierPayments = this.list('SupplierPayment', (item) => item.booking_id === booking.booking_id && item.currency === currency && ['EXECUTED', 'VERIFIED'].includes(item.state)).reduce((sum, item) => addMoney(sum, item.amount), '0.00');
      const fees = input.fees_total || booking.fees_total || quote && quote.fees_total || '0.00';
      const commissions = input.commissions_total || input.commission_total || booking.commission_total || booking.commissions_total || quote && (quote.commission_total || quote.commissions_total) || '0.00';
      const adjustments = input.adjustments_total || '0.00';
      const projectedProfit = fromMinorUnits(toMinorUnits(clientPrice) - toMinorUnits(supplierCost) - toMinorUnits(fees) - toMinorUnits(commissions) + toMinorUnits(adjustments));
      const actualSellingPrice = input.actual_selling_price || (this.verifiedAllocatedFunds(booking.booking_id, currency) > 0n ? allocated : null);
      const actualSupplierCost = input.actual_supplier_cost || (toMinorUnits(supplierPayments) > 0n ? supplierPayments : null);
      const actualFees = input.actual_fees || '0.00';
      const actualCommissions = input.actual_commissions || '0.00';
      const actualAdjustments = input.actual_adjustments || '0.00';
      const obligationRecords = this.list('ClientObligation', (item) => item.booking_id === booking.booking_id);
      const scheduleRecords = this.list('PaymentScheduleItem', (item) => item.booking_id === booking.booking_id);
      const authoritativeObligations = obligationRecords.length ? obligationRecords : scheduleRecords;
      const obligationTotal = authoritativeObligations.reduce((sum, item) => sum + toMinorUnits(item.amount || item.total_amount || item.balance_due || '0.00'), 0n);
      const realizedClientFunds = this.verifiedAllocatedFunds(booking.booking_id, currency);
      let actualProfit = null;
      if (input.confirm === true) {
        if (actualSellingPrice === null || actualSupplierCost === null || (obligationTotal > 0n && realizedClientFunds < obligationTotal) || toMinorUnits(supplierPayments) <= 0n) throw new WmitError('ACTUAL_PROFIT_INPUTS_INCOMPLETE', 'Actual profit requires fully allocated client obligations and realized Supplier Payments.');
        actualProfit = fromMinorUnits(toMinorUnits(actualSellingPrice) - toMinorUnits(actualSupplierCost) - toMinorUnits(actualFees) - toMinorUnits(actualCommissions) + toMinorUnits(actualAdjustments));
      }
      const margin = subtractMoney(clientPrice, supplierCost);
      const snapshot = {
        client_price: clientPrice,
        supplier_cost: supplierCost,
        fees,
        commissions,
        adjustments,
        projected_profit: projectedProfit,
        verified_allocated_client_funds: allocated,
        supplier_payables: payables,
        supplier_payments: supplierPayments,
        operational_margin: margin,
        currency
      };
      if (actualProfit !== null) Object.assign(snapshot, { actual_selling_price: actualSellingPrice, actual_supplier_cost: actualSupplierCost, actual_fees: actualFees, actual_commissions: actualCommissions, actual_adjustments: actualAdjustments, actual_profit: actualProfit });
      if (input.idempotency_key) {
        const prior = this.list('Reconciliation', (record) => record.idempotency_key === input.idempotency_key);
        if (prior.length) return ok(prior[0], { action: 'IDEMPOTENT_REPLAY', idempotent: true });
      }
      return this.createRecord('Reconciliation', { booking_id: booking.booking_id, state: input.confirm ? 'RECONCILED' : 'REVIEW_REQUIRED', snapshot, reconciled_at: input.confirm ? this.now() : null, reconciled_by: input.confirm ? this.context(context).actor : null, idempotency_key: input.idempotency_key }, context);
    } catch (error) { return fail(error); }
  }
  createTask(input, context) { return this.createRecord('Task', Object.assign({ state: 'OPEN' }, input), context); }
  updateTask(input, context) {
    try {
      const task = this.must('Task', input.task_id);
      const nextState = input.state;
      if (!['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'BLOCKED'].includes(nextState)) throw new WmitError('INVALID_TASK_STATE', 'Task state is not supported.');
      return this.updateRecord('Task', task.task_id, { state: nextState, completed_at: nextState === 'COMPLETED' ? this.now() : task.completed_at || null, completion_note: input.completion_note || task.completion_note || null }, context);
    } catch (error) { return fail(error); }
  }
  createDeparture(input, context) { return this.createRecord('Departure', Object.assign({ state: 'DRAFT' }, input), context); }
  addDepartureMembership(input, context) { return this.createRecord('DepartureMembership', input, context); }
  createDepartureReadinessIssue(input, context) {
    try {
      if (!input.departure_id && !input.booking_item_id) throw new WmitError('READINESS_SCOPE_REQUIRED', 'A readiness issue must reference a Departure or Booking Item.');
      if (input.departure_id) this.must('Departure', input.departure_id);
      if (input.booking_item_id) this.must('BookingItem', input.booking_item_id);
      requireValue(input.description, 'description');
      const severity = input.severity || 'MEDIUM';
      if (!['LOW', 'MEDIUM', 'HIGH', 'BLOCKER'].includes(severity)) throw new WmitError('INVALID_ISSUE_SEVERITY', 'Readiness issue severity is not supported.');
      return this.createRecord('DepartureReadinessIssue', Object.assign({ state: 'OPEN' }, input, { severity }), context);
    } catch (error) { return fail(error); }
  }
  updateDepartureReadinessIssue(input, context) {
    try {
      const issue = this.must('DepartureReadinessIssue', input.departure_readiness_issue_id);
      const state = input.state || issue.state;
      if (!['OPEN', 'IN_PROGRESS', 'RESOLVED', 'WAIVED'].includes(state)) throw new WmitError('INVALID_ISSUE_STATE', 'Readiness issue state is not supported.');
      return this.updateRecord('DepartureReadinessIssue', issue.departure_readiness_issue_id, { state, resolution: input.resolution || issue.resolution || null }, context);
    } catch (error) { return fail(error); }
  }
  snapshot() { const result = {}; Object.keys(this.repos).forEach((type) => { result[type] = this.repos[type].list(); }); return ok({ entities: result, audit: this.auditLog.list(), configuration: { tariffRateUnits: this.config.tariffRateUnits.slice() } }); }
}

function createPhase1Runtime(options) { return new Phase1Runtime(options); }

module.exports = { Phase1Runtime, createPhase1Runtime, ENTITY_DEFS, ACTIONS, DEFAULT_TARIFF_RATE_UNITS };
