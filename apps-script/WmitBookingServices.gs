/**
 * Controlled operational workflow for bookings, supplier fulfilment,
 * departures, readiness, client commitment, and amendments.
 *
 * This deliberately uses the existing Sheets entities. It is not a second
 * booking database and it does not alter tariff/source records.
 */
var WmitBookingServices = (function () {
  var BOOKING_STATES = ['DRAFT', 'PENDING_CONFIRMATION', 'CONFIRMED', 'CANCELLED', 'COMPLETED'];
  var COMMITMENT_STATES = ['PENDING', 'CONFIRMED', 'DECLINED', 'REACCEPTANCE_REQUIRED'];
  var SUPPLIER_STATES = ['DRAFT', 'REQUESTED', 'PENDING_CONFIRMATION', 'CONFIRMED', 'CANCELLED', 'COMPLETED'];
  var DEPARTURE_STATES = ['DRAFT', 'OPEN', 'READY', 'DEPARTED', 'COMPLETED', 'CANCELLED'];
  var ISSUE_STATES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'WAIVED'];
  var ISSUE_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'BLOCKER'];

  function value_(input, field, required) {
    var value = input && input[field];
    if (required && (value === undefined || value === null || String(value).trim() === '')) throw new Error(field + ' is required.');
    return value === undefined || value === null ? '' : String(value).trim();
  }
  function service_(action, type) { var method = action + type; if (!WmitSheetServices || typeof WmitSheetServices[method] !== 'function') throw new Error('WMIT Apps Script files are out of sync. Deploy the updated WmitWorkspace.gs and WmitSheetServices.gs together. Missing service method: ' + method); return WmitSheetServices[method]; }
  function list_(type) { return service_('list', type)().data || []; }
  function field_(type) { return type === 'Person' ? 'person_id' : type === 'Client' ? 'client_id' : type === 'Supplier' ? 'supplier_id' : type === 'Quotation' ? 'quotation_id' : type === 'Booking' ? 'booking_id' : type === 'BookingItem' ? 'booking_item_id' : type === 'SupplierBooking' ? 'supplier_booking_id' : type === 'Departure' ? 'departure_id' : type === 'Amendment' ? 'amendment_id' : type === 'DepartureReadinessIssue' ? 'departure_readiness_issue_id' : type === 'BookingParticipant' ? 'booking_participant_id' : type === 'SupplierBookingItem' ? 'supplier_booking_item_id' : (type.toLowerCase() + '_id'); }
  function find_(type, id) { var field = field_(type); return list_(type).filter(function (record) { return String(record[field]) === String(id); })[0] || null; }
  function must_(type, id) { var record = find_(type, id); if (!record) throw new Error(type + ' ' + id + ' was not found.'); return record; }
  function actor_(context) { return context && context.actor || 'WORKSPACE_STAFF'; }
  function today_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Manila', 'yyyy-MM-dd'); }
  function money_(value, field) { var number = Number(value); if (!isFinite(number) || number < 0) throw new Error((field || 'Amount') + ' must be zero or greater.'); return number.toFixed(2); }
  function currency_(value) { var currency = String(value || '').trim().toUpperCase(); if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Currency must be a three-letter code.'); return currency; }
  function date_(value, field) { if (!value || isNaN(Date.parse(value))) throw new Error((field || 'Date') + ' must be a valid date.'); return value; }
  function ok_(data, meta) { return { ok: true, data: data, meta: meta || {} }; }
  function fail_(error) { return { ok: false, error: { code: 'OPERATIONAL_VALIDATION_FAILED', message: error.message || String(error) } }; }
  function create_(type, input, context) { return service_('create', type)(input, context); }
  function update_(type, id, changes, context) { return service_('update', type)(id, changes, context); }

  // Runs a multi-record unit of work under the script lock when available and
  // rolls back any records created before a failure, so a partial Booking can
  // never persist. Local tests omit LockService and run directly.
  function transactional_(context, work) {
    var created = [];
    var track = function (type, id) { created.push([type, id]); };
    var lock = null;
    if (typeof LockService !== 'undefined' && LockService.getScriptLock) {
      lock = LockService.getScriptLock();
      lock.waitLock(30000);
    }
    try {
      var result = work(track);
      if (!result || result.ok === false) rollback_(created);
      return result;
    } catch (error) {
      rollback_(created);
      throw error;
    } finally {
      if (lock) lock.releaseLock();
    }
  }
  function rollback_(created) {
    created.slice().reverse().forEach(function (entry) {
      try { WmitSheetServices.compensateCreate(entry[0], entry[1]); } catch (_) { /* keep rolling back the rest */ }
    });
  }

  function createPerson(input, context) {
    try {
      var name = value_(input, 'display_name', true);
      var phone = value_(input, 'primary_phone', false);
      var existing = list_('Person').filter(function (person) { return String(person.display_name || '').toLowerCase() === name.toLowerCase() && (!phone || String(person.primary_phone || '') === phone); })[0];
      if (existing) return ok_(existing, { action: 'CREATE_PERSON', idempotent: true });
      return create_('Person', { display_name: name, legal_name: value_(input, 'legal_name', false) || name, primary_phone: phone || null, primary_email: value_(input, 'primary_email', false) || null, person_type: 'TRAVELER', status: 'ACTIVE' }, context);
    } catch (error) { return fail_(error); }
  }

  function recordQuotationAcceptance(input, context) {
    try {
      var quotation = must_('Quotation', value_(input, 'quotation_id', true));
      if (String(quotation.status || '').toUpperCase() !== 'APPROVED') throw new Error('Only an approved quotation can be accepted.');
      var existing = list_('QuotationAcceptance').filter(function (record) { return record.quotation_id === quotation.quotation_id && String(record.state || '').toUpperCase() === 'ACCEPTED'; })[0];
      if (existing) return ok_(existing, { action: 'RECORD_QUOTATION_ACCEPTANCE', idempotent: true });
      return create_('QuotationAcceptance', { quotation_id: quotation.quotation_id, client_id: quotation.client_id, state: 'ACCEPTED', accepted_by: value_(input, 'accepted_by', true), accepted_at: input.accepted_at || wmitNow_(), acceptance_method: input.acceptance_method || 'STAFF_RECORDED', notes: input.notes || null }, context);
    } catch (error) { return fail_(error); }
  }

  function createBooking(input, context) {
    try {
      return transactional_(context, function (track) {
        var quotationId = value_(input, 'quotation_id', true), quote = must_('Quotation', quotationId);
        if (String(quote.status || '').toUpperCase() !== 'APPROVED') throw new Error('Only an approved quotation can create a Booking.');
        if (quote.revision_required) throw new Error('This quotation requires revision before Booking creation.');
        var accepted = list_('QuotationAcceptance').filter(function (record) { return record.quotation_id === quotationId && String(record.state || '').toUpperCase() === 'ACCEPTED'; });
        if (!accepted.length) throw new Error('Record client acceptance of the quotation before creating a Booking.');
        var leadPaxId = value_(input, 'lead_pax_person_id', true); must_('Person', leadPaxId);
        var existing = list_('Booking').filter(function (booking) { return booking.quotation_id === quotationId; })[0];
        if (existing) {
          var existingLead = list_('BookingParticipant').filter(function (participant) { return participant.booking_id === existing.booking_id && (participant.role === 'LEAD_PAX' || participant.is_lead_pax === true); })[0];
          if (existingLead && existingLead.person_id !== leadPaxId) throw new Error('This quotation already has a Booking with a different lead passenger.');
          if (!existingLead) { create_('BookingParticipant', { booking_id: existing.booking_id, person_id: leadPaxId, role: 'LEAD_PAX', is_lead_pax: true }, context); update_('Booking', existing.booking_id, { lead_pax_person_id: leadPaxId }, context); }
          return ok_(existing, { action: 'CREATE_BOOKING', idempotent: true, existing: true });
        }
        var bookingDate = value_(input, 'booking_date', false) || today_(); date_(bookingDate, 'Booking date');
        var booking = create_('Booking', {
          quotation_id: quotationId, client_id: quote.client_id, inquiry_id: quote.inquiry_id || null,
          booking_date: bookingDate, travel_start: input.travel_start || quote.travel_start || null, travel_end: input.travel_end || quote.travel_end || null,
          destination: input.destination || quote.destination || null, pax_count: Number(input.pax_count || quote.pax_count || 0),
          currency: currency_(input.currency || quote.currency || 'PHP'), client_total: money_(input.client_total === undefined ? (quote.client_total || 0) : input.client_total, 'Client total'),
          supplier_cost_total: money_(input.supplier_cost_total === undefined ? (quote.supplier_cost_total || 0) : input.supplier_cost_total, 'Supplier cost total'),
          lead_pax_person_id: leadPaxId, status: input.status && BOOKING_STATES.indexOf(String(input.status).toUpperCase()) >= 0 ? String(input.status).toUpperCase() : 'PENDING_CONFIRMATION',
          record_state: 'CREATED', commitment_state: 'PENDING', client_decision_state: 'SELECTED', notes: input.notes || null
        }, context);
        if (!booking.ok) return booking;
        track('Booking', booking.data.booking_id);
        var bookingId = booking.data.booking_id;
        var participant = create_('BookingParticipant', { booking_id: bookingId, person_id: leadPaxId, role: 'LEAD_PAX', is_lead_pax: true, traveler_role: 'LEAD_PAX' }, context);
        if (!participant.ok) return participant;
        track('BookingParticipant', participant.data.booking_participant_id);
        list_('QuotationItem').filter(function (item) { return item.quotation_id === quotationId; }).forEach(function (item) {
          var itemResult = create_('BookingItem', { booking_id: bookingId, quotation_item_id: item.quotation_item_id, service_type: item.service_type || 'Other', description: item.description || item.service_type || 'Travel service', supplier_id: item.supplier_id || null, service_start: item.service_start || null, service_end: item.service_end || null, quantity: Number(item.quantity || 1), supplier_cost: money_(item.supplier_cost || 0, 'Supplier cost'), selling_price: money_(item.selling_price || item.amount || 0, 'Selling price'), currency: currency_(item.currency || quote.currency || 'PHP'), fulfillment_state: 'NOT_REQUESTED', status: 'Draft' }, context);
          if (!itemResult.ok) throw new Error(itemResult.error.message);
          track('BookingItem', itemResult.data.booking_item_id);
        });
        return booking;
      });
    } catch (error) { return fail_(error); }
  }

  function confirmCommitment(input, context) {
    try {
      var booking = must_('Booking', value_(input, 'booking_id', true));
      var decision = String(input.decision || input.commitment_state || 'CONFIRMED').toUpperCase();
      if (['CONFIRMED', 'DECLINED'].indexOf(decision) < 0) throw new Error('Commitment decision must be Confirmed or Declined.');
      if (decision === 'CONFIRMED' && booking.commitment_state === 'REACCEPTANCE_REQUIRED') throw new Error('Client re-acceptance is required before confirming this Booking.');
      if (booking.commitment_state === decision) return ok_(booking, { action: 'CONFIRM_COMMITMENT', idempotent: true });
      return update_('Booking', booking.booking_id, { commitment_state: decision, client_decision_state: decision === 'CONFIRMED' ? 'ACCEPTED' : 'DECLINED', commitment_confirmed_at: decision === 'CONFIRMED' ? wmitNow_() : null }, context);
    } catch (error) { return fail_(error); }
  }

  function createSupplierBooking(input, context) {
    try {
      var booking = must_('Booking', value_(input, 'booking_id', true)), supplier = must_('Supplier', value_(input, 'supplier_id', true));
      var itemIds = Array.isArray(input.booking_item_ids) ? input.booking_item_ids : [];
      itemIds.forEach(function (itemId) { var item = must_('BookingItem', itemId); if (item.booking_id !== booking.booking_id) throw new Error('Every selected Booking Item must belong to the target Booking.'); if (item.supplier_id && item.supplier_id !== supplier.supplier_id) throw new Error('Selected Booking Item belongs to a different Supplier.'); });
      var signature = itemIds.slice().sort().join('|');
      var existing = list_('SupplierBooking').filter(function (record) { return record.booking_id === booking.booking_id && record.supplier_id === supplier.supplier_id && String(record.booking_item_signature || '') === signature; })[0];
      if (existing) return ok_(existing, { action: 'CREATE_SUPPLIER_BOOKING', idempotent: true });
      var created = create_('SupplierBooking', { booking_id: booking.booking_id, supplier_id: supplier.supplier_id, supplier_reference: input.supplier_reference || null, service_description: value_(input, 'service_description', true), supplier_cost: money_(input.supplier_cost || 0, 'Supplier cost'), currency: currency_(input.currency || booking.currency), deposit: money_(input.deposit || 0, 'Deposit'), balance: money_(input.balance || input.supplier_cost || 0, 'Balance'), deposit_due_date: input.deposit_due_date || null, final_payment_due_date: input.final_payment_due_date || null, status: SUPPLIER_STATES.indexOf(String(input.status || 'REQUESTED').toUpperCase()) >= 0 ? String(input.status || 'REQUESTED').toUpperCase() : 'REQUESTED', fulfillment_state: 'REQUESTED', reservation_state: 'REQUESTED', booking_item_ids: itemIds, booking_item_signature: signature, notes: input.notes || null }, context);
      if (!created.ok) return created;
      itemIds.forEach(function (itemId) { create_('SupplierBookingItem', { supplier_booking_id: created.data.supplier_booking_id, booking_item_id: itemId, allocated_supplier_cost: null, currency: created.data.currency }, context); });
      return created;
    } catch (error) { return fail_(error); }
  }

  function createDeparture(input, context) {
    try {
      var name = value_(input, 'name', true), destination = value_(input, 'destination', true), start = date_(value_(input, 'start_date', true), 'Start date');
      var end = value_(input, 'end_date', false); if (end) date_(end, 'End date'); if (end && Date.parse(end) < Date.parse(start)) throw new Error('End date cannot be before start date.');
      var capacity = input.capacity === undefined || input.capacity === '' ? null : Number(input.capacity); if (capacity !== null && (!isFinite(capacity) || capacity < 1)) throw new Error('Capacity must be a positive number.');
      return create_('Departure', { name: name, destination: destination, departure_type: input.departure_type || 'GROUP', start_date: start, end_date: end || null, capacity: capacity, readiness_percent: 0, status: DEPARTURE_STATES.indexOf(String(input.status || 'DRAFT').toUpperCase()) >= 0 ? String(input.status || 'DRAFT').toUpperCase() : 'DRAFT', assigned_to: input.assigned_to || null, notes: input.notes || null }, context);
    } catch (error) { return fail_(error); }
  }

  function addDepartureMembership(input, context) {
    try {
      var departure = must_('Departure', value_(input, 'departure_id', true)), booking = must_('Booking', value_(input, 'booking_id', true));
      var existing = list_('DepartureMembership').filter(function (record) { return record.departure_id === departure.departure_id && record.booking_id === booking.booking_id; })[0];
      if (existing) return ok_(existing, { action: 'ADD_DEPARTURE_MEMBERSHIP', idempotent: true });
      var members = list_('DepartureMembership').filter(function (record) { return record.departure_id === departure.departure_id; });
      if (departure.capacity && members.length >= Number(departure.capacity)) throw new Error('Departure capacity has been reached.');
      var created = create_('DepartureMembership', { departure_id: departure.departure_id, booking_id: booking.booking_id, client_id: booking.client_id, lead_pax_person_id: booking.lead_pax_person_id, lead_pax_name: input.lead_pax_name || null, status: 'ACTIVE', notes: input.notes || null }, context);
      if (created.ok) update_('Departure', departure.departure_id, { readiness_percent: Math.min(100, Math.round(((members.length + 1) / (Number(departure.capacity) || (members.length + 1))) * 100)) }, context);
      return created;
    } catch (error) { return fail_(error); }
  }

  function createReadinessIssue(input, context) {
    try {
      if (!input.departure_id && !input.booking_id && !input.booking_item_id) throw new Error('A readiness issue must reference a departure, booking, or booking item.');
      if (input.departure_id) must_('Departure', input.departure_id); if (input.booking_id) must_('Booking', input.booking_id); if (input.booking_item_id) must_('BookingItem', input.booking_item_id);
      var description = value_(input, 'description', true), severity = String(input.severity || 'MEDIUM').toUpperCase(); if (ISSUE_SEVERITIES.indexOf(severity) < 0) throw new Error('Readiness issue severity is not supported.');
      if (input.due_date) date_(input.due_date, 'Due date');
      return create_('DepartureReadinessIssue', { departure_id: input.departure_id || null, booking_id: input.booking_id || null, booking_item_id: input.booking_item_id || null, description: description, severity: severity, state: 'OPEN', due_date: input.due_date || null, owner: input.owner || null, resolution: null }, context);
    } catch (error) { return fail_(error); }
  }

  function updateReadinessIssue(input, context) {
    try { var issue = must_('DepartureReadinessIssue', value_(input, 'departure_readiness_issue_id', true)), state = String(input.state || issue.state || 'OPEN').toUpperCase(); if (ISSUE_STATES.indexOf(state) < 0) throw new Error('Readiness issue state is not supported.'); return update_('DepartureReadinessIssue', issue.departure_readiness_issue_id, { state: state, resolution: input.resolution || issue.resolution || null }, context); } catch (error) { return fail_(error); }
  }

  function createAmendment(input, context) {
    try {
      var booking = must_('Booking', value_(input, 'booking_id', true)), changes = input.changes || {}; if (!Object.keys(changes).length) throw new Error('Provide at least one proposed Booking change.'); var reason = value_(input, 'reason', true);
      var before = { destination: booking.destination || null, travel_start: booking.travel_start || null, travel_end: booking.travel_end || null, pax_count: booking.pax_count || 0, current_price: booking.current_price || booking.client_total || '0.00', current_supplier_cost: booking.current_supplier_cost || booking.supplier_cost_total || '0.00', currency: booking.currency || null };
      var after = Object.assign({}, before, changes), priceChanged = String(before.current_price) !== String(after.current_price) || String(before.current_supplier_cost) !== String(after.current_supplier_cost) || String(before.currency) !== String(after.currency);
      var amendment = create_('Amendment', { booking_id: booking.booking_id, before_snapshot: before, after_snapshot: after, reason: reason, state: 'PENDING_CLIENT_ACCEPTANCE', client_acceptance_required: true, price_changed: priceChanged, actor: actor_(context), created_for: input.created_for || 'CLIENT' }, context);
      if (amendment.ok) update_('Booking', booking.booking_id, { commitment_state: 'REACCEPTANCE_REQUIRED', amendment_pending: true, amendment_id: amendment.data.amendment_id }, context);
      return amendment;
    } catch (error) { return fail_(error); }
  }

  function acceptAmendment(input, context) {
    try {
      var amendment = must_('Amendment', value_(input, 'amendment_id', true)); if (String(amendment.state).toUpperCase() === 'ACCEPTED') return ok_(amendment, { action: 'ACCEPT_AMENDMENT', idempotent: true }); var acceptedBy = value_(input, 'accepted_by', true), booking = must_('Booking', amendment.booking_id), after = amendment.after_snapshot || {};
      var updatedAmendment = update_('Amendment', amendment.amendment_id, { state: 'ACCEPTED', client_acceptance_required: false, accepted_by: acceptedBy, accepted_at: wmitNow_(), acceptance_reference: input.acceptance_reference || null }, context); if (!updatedAmendment.ok) return updatedAmendment;
      var safe = {}; ['destination', 'travel_start', 'travel_end', 'pax_count', 'currency'].forEach(function (field) { if (after[field] !== undefined) safe[field] = after[field]; }); if (after.current_price !== undefined) safe.client_total = money_(after.current_price, 'Client total'); if (after.current_supplier_cost !== undefined) safe.supplier_cost_total = money_(after.current_supplier_cost, 'Supplier cost total'); safe.commitment_state = 'CONFIRMED'; safe.client_decision_state = 'AMENDMENT_ACCEPTED'; safe.amendment_pending = false; safe.commitment_confirmed_at = wmitNow_(); update_('Booking', booking.booking_id, safe, context); return updatedAmendment;
    } catch (error) { return fail_(error); }
  }

  return { createPerson: createPerson, recordQuotationAcceptance: recordQuotationAcceptance, createBooking: createBooking, confirmCommitment: confirmCommitment, createSupplierBooking: createSupplierBooking, createDeparture: createDeparture, addDepartureMembership: addDepartureMembership, createReadinessIssue: createReadinessIssue, updateReadinessIssue: updateReadinessIssue, createAmendment: createAmendment, acceptAmendment: acceptAmendment };
}());
