'use strict';

const { createLocalRuntime } = require('../services');
const { WmitError, errorResult } = require('../core/errors');
const { calculateInvoiceTotals, decimalStringToNumber, toMinorUnits, fromMinorUnits } = require('../core/money');
const quotationEditor = require('./quotation-editor');
const paymentConversion = require('./payment-conversion');
const { AttendanceService } = require('../attendance/attendance-service');
const { HrPayrollOfficer } = require('../agents/hr-payroll-officer');

const ACTOR_CONTEXT = { actor: 'MVP_USER', agent: 'OPERATIONS_MVP' };

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ok(data, meta) {
  return { ok: true, data, meta: meta || {} };
}

function okMaybe(data, meta) {
  return data && typeof data.then === 'function' ? data.then((resolved) => ok(resolved, meta)) : ok(data, meta);
}

function fail(error) {
  return errorResult(error);
}

function asResult(result) {
  if (!result || !result.ok) throw new WmitError(result && result.error && result.error.code || 'OPERATION_FAILED', result && result.error && result.error.message || 'The operation could not be completed.', result && result.error && result.error.details);
  return result.data;
}

function serviceError(result) {
  if (result && !result.ok) return new WmitError(result.error.code, result.error.message, result.error.details);
  return null;
}

function serviceCall(service, method) {
  const args = Array.prototype.slice.call(arguments, 2);
  const context = args.pop() || ACTOR_CONTEXT;
  const result = service[method].apply(service, args.concat(context));
  const error = serviceError(result);
  if (error) throw error;
  return result.data;
}

function serviceGet(service, id) {
  return serviceCall(service, 'get', id, ACTOR_CONTEXT);
}

function amount(value) {
  return decimalStringToNumber(fromMinorUnits(toMinorUnits(value || 0)));
}

function calculateLineTotals(items, adjustments) {
  return calculateInvoiceTotals((items || []).map((item) => ({
    quantity: item.quantity,
    unit_price: item.selling_price !== undefined ? item.selling_price : item.unit_selling_price,
    amount: item.amount
  })), adjustments || {});
}

function assertQuotationCurrency(quotation, items) {
  const mismatched = (items || []).find((item) => item.currency !== quotation.currency);
  if (mismatched) {
    throw new WmitError('CURRENCY_MISMATCH', 'Every quotation item must use the quotation currency. Automatic currency conversion is not enabled.', {
      quotation_id: quotation.quotation_id,
      quotation_currency: quotation.currency,
      quotation_item_id: mismatched.quotation_item_id,
      item_currency: mismatched.currency
    });
  }
}

function calculateQuotationProposal(quotation, items) {
  assertQuotationCurrency(quotation, items);
  return quotationEditor.calculateTotals(items, quotation);
}

function createOperationsMvp(options) {
  const opts = options || {};
  const runtime = opts.runtime || createLocalRuntime(opts.runtimeOptions);
  const services = runtime.services;
  const repositories = runtime.repositories;
  const context = Object.assign({}, ACTOR_CONTEXT, opts.context || {});
  const attendanceService = opts.attendanceService || new AttendanceService({
    config: runtime.config,
    provider: opts.attendanceProvider,
    identityMap: opts.attendanceIdentityMap,
    people: opts.attendancePeople,
    clock: runtime.clock || opts.clock
  });
  const hrPayrollOfficer = opts.hrPayrollOfficer || new HrPayrollOfficer({ attendanceService });

  function list(entityType) {
    return repositories[entityType].list();
  }

  function createLead(input) {
    try {
      const value = input || {};
      return ok(serviceCall(services.Lead, 'create', Object.assign({}, value, {
        received_at: value.received_at || new Date().toISOString(),
        lead_type: value.lead_type || 'B2C',
        currency: value.currency || runtime.config.defaultCurrency
      }), context));
    } catch (error) { return fail(error); }
  }

  function updateLead(id, changes) {
    try { return ok(serviceCall(services.Lead, 'update', id, changes, context)); } catch (error) { return fail(error); }
  }

  function getLead(id) {
    try { return ok(serviceGet(services.Lead, id)); } catch (error) { return fail(error); }
  }

  function createQuotationFromLead(input) {
    try {
      const value = input || {};
      const lead = serviceGet(services.Lead, value.lead_id);
      const quotationCurrency = value.currency || lead.currency || runtime.config.defaultCurrency;
      const quotation = serviceCall(services.Quotation, 'create', {
        quotation_id: value.quotation_id,
        lead_id: lead.lead_id,
        client_id: value.client_id || lead.client_id,
        contact_id: value.contact_id || lead.contact_id,
        quotation_date: value.quotation_date || String(lead.received_at).slice(0, 10),
        valid_until: value.valid_until,
        destination: value.destination || lead.destination,
        travel_start: value.travel_start || lead.travel_start,
        travel_end: value.travel_end || lead.travel_end,
        pax_count: value.pax_count === undefined ? lead.pax_count : value.pax_count,
        currency: quotationCurrency,
        supplier_cost_total: 0,
        markup_total: 0,
        fees_total: amount(value.fees_total),
        tax_total: amount(value.tax_total),
        discount_total: amount(value.discount_total),
        client_total: 0,
        inclusions: value.inclusions,
        exclusions: value.exclusions,
        payment_terms: value.payment_terms,
        payment_currency_policy: value.payment_currency_policy || (quotationCurrency === 'USD'
          ? 'USD is the quotation currency. The client may pay in USD or PHP using the BDO Forex Selling Rate + 1.0 on the payment date. Installment payments are accepted.'
          : 'Payment is due in the quotation currency. Installments are subject to the agreed payment terms.'),
        itinerary: value.itinerary,
        assigned_to: value.assigned_to,
        status: value.status || 'Draft',
        notes: value.notes
      }, context);
      return ok(quotation, { action: 'CREATE_QUOTATION_FROM_LEAD', lead_id: lead.lead_id });
    } catch (error) { return fail(error); }
  }

  function quotationTotals(quotationId) {
    const quotation = serviceGet(services.Quotation, quotationId);
    const items = list('QuotationItem').filter((row) => row.quotation_id === quotationId);
    const totals = calculateQuotationProposal(quotation, items);
    return { quotation, items, totals };
  }

  function quotationTotalChanges(totals) {
    return {
      supplier_cost_total: totals.supplier_cost_total,
      markup_total: totals.markup_total,
      fees_total: totals.fees_total,
      tax_total: totals.tax_total,
      discount_total: totals.discount_total,
      client_total: totals.client_total
    };
  }

  function getQuotationEditor(quotationId) {
    try {
      const result = quotationTotals(quotationId);
      const client = result.quotation.client_id ? repositories.Client.get(result.quotation.client_id) : null;
      const contact = result.quotation.contact_id ? repositories.Contact.get(result.quotation.contact_id) : null;
      return ok({ quotation: result.quotation, items: result.items, client, contact, totals: result.totals });
    } catch (error) { return fail(error); }
  }

  function getClientQuotationPreview(quotationId) {
    try {
      const result = quotationTotals(quotationId);
      const client = result.quotation.client_id ? repositories.Client.get(result.quotation.client_id) : null;
      const contact = result.quotation.contact_id ? repositories.Contact.get(result.quotation.contact_id) : null;
      return ok(quotationEditor.buildClientPreview(result.quotation, result.items, client, contact));
    } catch (error) { return fail(error); }
  }

  function updateQuotation(input) {
    try {
      const value = input || {};
      const current = serviceGet(services.Quotation, value.quotation_id);
      const allowed = ['client_id', 'contact_id', 'quotation_date', 'valid_until', 'destination', 'travel_start', 'travel_end', 'pax_count', 'currency', 'discount_total', 'fees_total', 'tax_total', 'inclusions', 'exclusions', 'payment_terms', 'payment_currency_policy', 'itinerary', 'assigned_to', 'status', 'notes'];
      const changes = {};
      allowed.forEach((field) => { if (value[field] !== undefined) changes[field] = value[field]; });
      const nextClientId = changes.client_id === undefined ? current.client_id : changes.client_id;
      const nextDestination = changes.destination === undefined ? current.destination : changes.destination;
      if (!nextClientId) throw new WmitError('VALIDATION_ERROR', 'A client is required for a quotation.', { errors: [{ field: 'client_id', message: 'Choose a client before saving the quotation.' }] });
      if (!nextDestination) throw new WmitError('VALIDATION_ERROR', 'A destination is required for a quotation.', { errors: [{ field: 'destination', message: 'Enter a destination before saving the quotation.' }] });
      const proposed = Object.assign({}, current, changes);
      const items = list('QuotationItem').filter((row) => row.quotation_id === current.quotation_id);
      const recalculated = calculateQuotationProposal(proposed, items);
      const updated = serviceCall(services.Quotation, 'update', current.quotation_id, Object.assign({}, changes, quotationTotalChanges(recalculated)), context);
      return ok(updated, { action: 'UPDATE_QUOTATION' });
    } catch (error) { return fail(error); }
  }

  function updateQuotationItem(input) {
    try {
      const value = input || {};
      const current = serviceGet(services.QuotationItem, value.quotation_item_id);
      const allowed = ['service_type', 'description', 'supplier_id', 'quantity', 'unit_cost', 'unit_selling_price', 'currency', 'line_order', 'service_start', 'service_end', 'airline', 'flight_number', 'departure_airport', 'arrival_airport', 'departure_time', 'arrival_time', 'notes'];
      const changes = {};
      allowed.forEach((field) => { if (value[field] !== undefined) changes[field] = value[field]; });
      const quotation = serviceGet(services.Quotation, current.quotation_id);
      const proposedItem = Object.assign({}, current, changes);
      const proposedItems = list('QuotationItem').map((row) => row.quotation_item_id === current.quotation_item_id ? proposedItem : row);
      const totals = calculateQuotationProposal(quotation, proposedItems);
      const item = serviceCall(services.QuotationItem, 'update', current.quotation_item_id, changes, context);
      const updatedQuotation = serviceCall(services.Quotation, 'update', item.quotation_id, quotationTotalChanges(totals), context);
      return ok({ item, quotation: updatedQuotation }, { action: 'UPDATE_QUOTATION_ITEM' });
    } catch (error) { return fail(error); }
  }

  function removeQuotationItem(input) {
    try {
      const value = input || {};
      const current = serviceGet(services.QuotationItem, value.quotation_item_id);
      if (list('BookingItem').some((row) => row.quotation_item_id === current.quotation_item_id)) {
        throw new WmitError('REFERENCED_RECORD', 'This quotation item is already used by a booking and cannot be removed.');
      }
      const quotation = serviceGet(services.Quotation, current.quotation_id);
      const proposedItems = list('QuotationItem').filter((row) => row.quotation_item_id !== current.quotation_item_id);
      const totals = calculateQuotationProposal(quotation, proposedItems);
      const removed = serviceCall(services.QuotationItem, 'remove', current.quotation_item_id, context);
      const updatedQuotation = serviceCall(services.Quotation, 'update', current.quotation_id, quotationTotalChanges(totals), context);
      return ok({ removed, quotation: updatedQuotation }, { action: 'REMOVE_QUOTATION_ITEM' });
    } catch (error) { return fail(error); }
  }

  function reorderQuotationItems(input) {
    try {
      const value = input || {};
      const quotation = serviceGet(services.Quotation, value.quotation_id);
      const ids = Array.isArray(value.quotation_item_ids) ? value.quotation_item_ids : [];
      const items = list('QuotationItem').filter((row) => row.quotation_id === quotation.quotation_id);
      if (ids.length !== items.length || ids.some((id) => !items.some((row) => row.quotation_item_id === id))) {
        throw new WmitError('INVALID_REFERENCE', 'The quotation item order must contain each item exactly once.');
      }
      const updated = ids.map((id, index) => serviceCall(services.QuotationItem, 'update', id, { line_order: index + 1 }, context));
      return ok({ quotation, items: updated }, { action: 'REORDER_QUOTATION_ITEMS' });
    } catch (error) { return fail(error); }
  }

  function addQuotationItem(input) {
    try {
      const value = input || {};
      const quotation = serviceGet(services.Quotation, value.quotation_id);
      const existingItems = list('QuotationItem').filter((row) => row.quotation_id === quotation.quotation_id);
      const itemCurrency = value.currency || quotation.currency;
      if (itemCurrency !== quotation.currency) {
        throw new WmitError('CURRENCY_MISMATCH', 'Every quotation item must use the quotation currency. Automatic currency conversion is not enabled.', {
          quotation_id: quotation.quotation_id,
          quotation_currency: quotation.currency,
          item_currency: itemCurrency
        });
      }
      const proposedItem = Object.assign({}, value, { currency: itemCurrency });
      const proposedItems = existingItems.concat([proposedItem]);
      const totals = calculateQuotationProposal(quotation, proposedItems);
      const item = serviceCall(services.QuotationItem, 'create', Object.assign({}, value, {
        currency: itemCurrency,
        line_order: value.line_order || existingItems.length + 1
      }), context);
      const updated = serviceCall(services.Quotation, 'update', quotation.quotation_id, quotationTotalChanges(totals), context);
      return ok({ item, quotation: updated }, { action: 'ADD_QUOTATION_ITEM' });
    } catch (error) { return fail(error); }
  }

  function createBookingFromQuotation(input) {
    try {
      const value = input || {};
      const quotation = serviceGet(services.Quotation, value.quotation_id);
      const existingBooking = list('Booking').find((booking) => booking.quotation_id === quotation.quotation_id);
      if (existingBooking) {
        return ok({ booking: existingBooking, booking_items: list('BookingItem').filter((item) => item.booking_id === existingBooking.booking_id) }, { action: 'IDEMPOTENT_REPLAY', idempotent: true, existing: true, message: 'Booking already exists for this quotation.' });
      }
      const quotationItems = list('QuotationItem').filter((item) => item.quotation_id === quotation.quotation_id);
      const selectedIds = value.quotation_item_ids || quotationItems.map((item) => item.quotation_item_id);
      const selectedItems = selectedIds.map((id) => quotationItems.find((item) => item.quotation_item_id === id));
      if (selectedItems.some((item) => !item)) throw new WmitError('INVALID_REFERENCE', 'Every selected quotation item must belong to the quotation.');
      if (!selectedItems.length) throw new WmitError('MISSING_ITEMS', 'Add at least one quotation item before creating a booking.');
      const booking = serviceCall(services.Booking, 'create', {
        booking_id: value.booking_id,
        quotation_id: quotation.quotation_id,
        client_id: value.client_id || quotation.client_id,
        contact_id: value.contact_id || quotation.contact_id,
        booking_date: value.booking_date || new Date().toISOString().slice(0, 10),
        travel_start: quotation.travel_start,
        travel_end: quotation.travel_end,
        destination: quotation.destination,
        pax_count: quotation.pax_count,
        currency: quotation.currency,
        client_total: quotation.client_total,
        supplier_cost_total: quotation.supplier_cost_total,
        assigned_to: value.assigned_to,
        status: value.status || 'Draft',
        notes: value.notes
      }, context);
      const bookingItems = selectedItems.map((item) => serviceCall(services.BookingItem, 'create', {
        booking_id: booking.booking_id,
        quotation_item_id: item.quotation_item_id,
        service_type: item.service_type,
        supplier_id: item.supplier_id,
        description: item.description,
        service_start: item.service_start,
        service_end: item.service_end,
        quantity: item.quantity,
        supplier_cost: item.unit_cost,
        selling_price: item.unit_selling_price,
        currency: item.currency,
        status: 'Draft',
        notes: item.notes
      }, context));
      return ok({ booking, booking_items: bookingItems }, { action: 'CREATE_BOOKING_FROM_QUOTATION' });
    } catch (error) { return fail(error); }
  }

  function addBookingTraveler(input) {
    try { return ok(serviceCall(services.BookingTraveler, 'create', input, context)); } catch (error) { return fail(error); }
  }

  function createSupplierBookingFromBookingItem(input) {
    try {
      const value = input || {};
      const item = serviceGet(services.BookingItem, value.booking_item_id);
      if (!item.booking_id) throw new WmitError('INVALID_REFERENCE', 'The booking item is not attached to a booking.');
      const supplierBooking = serviceCall(services.SupplierBooking, 'create', {
        supplier_booking_id: value.supplier_booking_id,
        supplier_id: value.supplier_id || item.supplier_id,
        booking_id: item.booking_id,
        supplier_reference: value.supplier_reference,
        service_description: value.service_description || item.description,
        supplier_cost: value.supplier_cost === undefined ? item.supplier_cost : value.supplier_cost,
        currency: value.currency || item.currency,
        deposit: value.deposit,
        balance: value.balance,
        deposit_due_date: value.deposit_due_date,
        final_payment_due_date: value.final_payment_due_date,
        confirmation_date: value.confirmation_date,
        status: value.status || 'Draft',
        notes: value.notes
      }, context);
      const link = serviceCall(services.SupplierBookingItem, 'create', {
        supplier_booking_id: supplierBooking.supplier_booking_id,
        booking_item_id: item.booking_item_id,
        allocated_supplier_cost: value.supplier_cost === undefined ? item.supplier_cost : value.supplier_cost,
        currency: value.currency || item.currency,
        notes: value.notes
      }, context);
      return ok({ supplier_booking: supplierBooking, supplier_booking_item: link }, { action: 'CREATE_SUPPLIER_BOOKING_FROM_ITEM' });
    } catch (error) { return fail(error); }
  }

  function createInvoiceFromBooking(input) {
    try {
      const value = input || {};
      const booking = serviceGet(services.Booking, value.booking_id);
      const items = list('BookingItem').filter((item) => item.booking_id === booking.booking_id);
      if (!items.length) throw new WmitError('MISSING_ITEMS', 'Add at least one booking item before creating an invoice.');
      const totals = calculateLineTotals(items, { discount: value.discount_total, fees: value.fees_total, tax: value.tax_total });
      const invoiceNumber = value.invoice_number || 'INV-MVP-' + String(list('Invoice').length + 1).padStart(6, '0');
      const invoice = serviceCall(services.Invoice, 'create', {
        invoice_id: value.invoice_id,
        invoice_number: invoiceNumber,
        booking_id: booking.booking_id,
        client_id: booking.client_id,
        contact_id: booking.contact_id,
        invoice_date: value.invoice_date || new Date().toISOString().slice(0, 10),
        due_date: value.due_date,
        currency: value.currency || booking.currency,
        subtotal: decimalStringToNumber(totals.subtotal),
        discount_total: decimalStringToNumber(totals.discount),
        fees_total: decimalStringToNumber(totals.fees),
        tax_total: decimalStringToNumber(totals.tax),
        total: decimalStringToNumber(totals.total),
        amount_paid: 0,
        balance_due: decimalStringToNumber(totals.total),
        status: value.status || 'Draft',
        notes: value.notes
      }, context);
      const invoiceBooking = serviceCall(services.InvoiceBooking, 'create', {
        invoice_id: invoice.invoice_id,
        booking_id: booking.booking_id,
        relationship_type: 'Primary booking'
      }, context);
      const invoiceItems = items.map((item) => serviceCall(services.InvoiceItem, 'create', {
        invoice_id: invoice.invoice_id,
        booking_item_id: item.booking_item_id,
        booking_id: booking.booking_id,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.selling_price,
        amount: decimalStringToNumber(fromMinorUnits(toMinorUnits(item.selling_price || 0) * toMinorUnits(item.quantity || 0) / 100n)),
        currency: invoice.currency,
        notes: item.notes
      }, context));
      return ok({ invoice, invoice_booking: invoiceBooking, invoice_items: invoiceItems }, { action: 'CREATE_INVOICE_FROM_BOOKING' });
    } catch (error) { return fail(error); }
  }

  function recordPaymentFromInvoice(input) {
    try {
      const value = input || {};
      const invoice = serviceGet(services.Invoice, value.invoice_id);
      const paymentDate = value.payment_date || new Date().toISOString().slice(0, 10);
      const paymentCurrency = value.currency || value.payment_currency || invoice.currency;
      let prepared;
      try {
        prepared = paymentConversion.preparePayment({
          amount: value.amount,
          payment_currency: paymentCurrency,
          invoice_currency: invoice.currency,
          exchange_rate: value.exchange_rate,
          exchange_rate_source: value.exchange_rate_source,
          exchange_rate_date: value.exchange_rate_date || paymentDate,
          payment_date: paymentDate
        });
      } catch (error) {
        throw new WmitError('PAYMENT_CONVERSION_ERROR', error.message, { invoice_currency: invoice.currency, payment_currency: paymentCurrency });
      }
      const paymentMinor = toMinorUnits(value.amount);
      const invoicePaymentMinor = BigInt(prepared.invoice_amount_minor);
      if (paymentMinor <= 0n || invoicePaymentMinor <= 0n) throw new WmitError('INVALID_MONEY', 'Payment amount must be greater than zero.');
      const existingPayments = list('Payment').filter((row) => row.payment_direction === 'FROM_CLIENT' && row.invoice_id === invoice.invoice_id);
      const existingPaidMinor = existingPayments.reduce((sum, row) => sum + toMinorUnits(row.invoice_amount === undefined ? row.amount : row.invoice_amount), 0n);
      const totalMinor = toMinorUnits(invoice.total);
      const currentBalanceMinor = totalMinor - existingPaidMinor;
      if (currentBalanceMinor < 0n || invoicePaymentMinor > currentBalanceMinor) {
        throw new WmitError('OVERPAYMENT', 'This payment is greater than the invoice balance.', {
          invoice_id: invoice.invoice_id,
          invoice_total: decimalStringToNumber(fromMinorUnits(totalMinor)),
          recorded_client_payments: decimalStringToNumber(fromMinorUnits(existingPaidMinor)),
          current_balance: decimalStringToNumber(fromMinorUnits(currentBalanceMinor < 0n ? 0n : currentBalanceMinor)),
          attempted_payment: decimalStringToNumber(fromMinorUnits(paymentMinor)),
          attempted_invoice_amount: decimalStringToNumber(fromMinorUnits(invoicePaymentMinor)),
          payment_currency: paymentCurrency,
          exchange_rate: prepared.exchange_rate,
          exchange_rate_date: prepared.exchange_rate_date
        });
      }
      const payment = serviceCall(services.Payment, 'create', {
        payment_id: value.payment_id,
        payment_direction: 'FROM_CLIENT',
        invoice_id: invoice.invoice_id,
        booking_id: value.booking_id || invoice.booking_id,
        client_id: invoice.client_id,
        payment_date: paymentDate,
        amount: decimalStringToNumber(fromMinorUnits(paymentMinor)),
        currency: paymentCurrency,
        invoice_currency: invoice.currency,
        invoice_amount: decimalStringToNumber(fromMinorUnits(invoicePaymentMinor)),
        exchange_rate: prepared.exchange_rate,
        exchange_rate_source: prepared.exchange_rate_source,
        exchange_rate_date: prepared.exchange_rate_date,
        method: value.method,
        reference: value.reference,
        status: value.status || 'Pending Verification',
        notes: value.notes
      }, context);
      const payments = list('Payment').filter((row) => row.payment_direction === 'FROM_CLIENT' && row.invoice_id === invoice.invoice_id);
      const paidMinor = payments.reduce((sum, row) => sum + toMinorUnits(row.invoice_amount === undefined ? row.amount : row.invoice_amount), 0n);
      const balanceMinor = totalMinor - paidMinor;
      const changes = {
        amount_paid: decimalStringToNumber(fromMinorUnits(paidMinor)),
        balance_due: decimalStringToNumber(fromMinorUnits(balanceMinor))
      };
      if (invoice.status === 'Sent' || invoice.status === 'Partially Paid' || invoice.status === 'Overdue') {
        changes.status = balanceMinor === 0n ? 'Paid' : 'Partially Paid';
      }
      const updatedInvoice = serviceCall(services.Invoice, 'update', invoice.invoice_id, changes, context);
      return ok({ payment, invoice: updatedInvoice }, { action: 'RECORD_PAYMENT_FROM_INVOICE' });
    } catch (error) { return fail(error); }
  }

  function recordSupplierPayment(input) {
    try {
      const value = input || {};
      const supplierBooking = serviceGet(services.SupplierBooking, value.supplier_booking_id);
      const paymentMinor = toMinorUnits(value.amount);
      const paymentCurrency = value.currency || supplierBooking.currency;
      if (!paymentCurrency || paymentCurrency !== supplierBooking.currency) {
        throw new WmitError('CURRENCY_MISMATCH', 'Supplier payment currency must match the Supplier Booking currency.', { supplier: supplierBooking.currency, payment: paymentCurrency });
      }
      const existingPayments = list('Payment').filter((row) => row.payment_direction === 'TO_SUPPLIER' && row.supplier_booking_id === supplierBooking.supplier_booking_id);
      const alreadyPaidMinor = existingPayments.reduce((sum, row) => sum + toMinorUnits(row.amount), 0n);
      const balanceMinor = supplierBooking.balance === undefined ? null : toMinorUnits(supplierBooking.balance);
      if (paymentMinor <= 0n) throw new WmitError('INVALID_MONEY', 'Supplier payment amount must be greater than zero.');
      if (balanceMinor !== null && paymentMinor > balanceMinor) {
        throw new WmitError('OVERPAYMENT', 'This supplier payment is greater than the supplier booking balance.', {
          supplier_booking_id: supplierBooking.supplier_booking_id,
          recorded_supplier_payments: decimalStringToNumber(fromMinorUnits(alreadyPaidMinor)),
          current_balance: decimalStringToNumber(fromMinorUnits(balanceMinor)),
          attempted_payment: decimalStringToNumber(fromMinorUnits(paymentMinor))
        });
      }
      const payment = serviceCall(services.Payment, 'create', {
        payment_id: value.payment_id,
        payment_direction: 'TO_SUPPLIER',
        supplier_id: value.supplier_id || supplierBooking.supplier_id,
        supplier_booking_id: supplierBooking.supplier_booking_id,
        booking_id: supplierBooking.booking_id,
        payment_date: value.payment_date || new Date().toISOString().slice(0, 10),
        amount: decimalStringToNumber(fromMinorUnits(paymentMinor)),
        currency: paymentCurrency,
        method: value.method,
        reference: value.reference,
        status: value.status || 'Pending Verification',
        notes: value.notes
      }, context);
      const updatedBalance = balanceMinor === null ? undefined : decimalStringToNumber(fromMinorUnits(balanceMinor - paymentMinor));
      const updatedSupplierBooking = updatedBalance === undefined
        ? supplierBooking
        : serviceCall(services.SupplierBooking, 'update', supplierBooking.supplier_booking_id, { balance: updatedBalance }, context);
      return ok({ payment, supplier_booking: updatedSupplierBooking }, { action: 'RECORD_SUPPLIER_PAYMENT' });
    } catch (error) { return fail(error); }
  }

  function getBookingView(bookingId) {
    try {
      const booking = serviceGet(services.Booking, bookingId);
      const client = booking.client_id ? repositories.Client.get(booking.client_id) : null;
      const travelers = list('BookingTraveler').filter((row) => row.booking_id === bookingId).map((row) => Object.assign({}, row, { traveler: repositories.Traveler.get(row.traveler_id) }));
      const items = list('BookingItem').filter((row) => row.booking_id === bookingId);
      const supplierBookings = list('SupplierBooking').filter((row) => row.booking_id === bookingId);
      const invoices = list('Invoice').filter((row) => row.booking_id === bookingId || list('InvoiceBooking').some((link) => link.booking_id === bookingId && link.invoice_id === row.invoice_id));
      const payments = list('Payment').filter((row) => row.booking_id === bookingId || invoices.some((invoice) => invoice.invoice_id === row.invoice_id));
      return ok({ booking, client, travelers, items, supplier_bookings: supplierBookings, invoices, payments, client_payments: payments.filter((row) => row.payment_direction === 'FROM_CLIENT'), supplier_payments: payments.filter((row) => row.payment_direction === 'TO_SUPPLIER') });
    } catch (error) { return fail(error); }
  }

  function dashboard() {
    const today = new Date().toISOString().slice(0, 10);
    const leads = list('Lead');
    const quotations = list('Quotation');
    const bookings = list('Booking');
    const invoices = list('Invoice');
    const supplierBookings = list('SupplierBooking');
    return ok({
      counts: {
        open_leads: leads.filter((row) => !['Won', 'Lost', 'Closed'].includes(row.status)).length,
        quotations_requiring_action: quotations.filter((row) => ['Draft', 'Approved', 'Sent'].includes(row.status)).length,
        active_bookings: bookings.filter((row) => !['Cancelled', 'Completed'].includes(row.status)).length,
        client_invoice_balances: invoices.filter((row) => row.balance_due > 0).length
      },
      lists: {
        open_leads: leads.filter((row) => !['Won', 'Lost', 'Closed'].includes(row.status)),
        quotations: quotations.filter((row) => ['Draft', 'Approved', 'Sent'].includes(row.status)),
        supplier_due: supplierBookings.filter((row) => (row.final_payment_due_date || row.deposit_due_date || '9999-12-31') >= today && (row.balance || 0) > 0),
        invoice_balances: invoices.filter((row) => row.balance_due > 0),
        upcoming_travel: bookings.filter((row) => row.travel_start && row.travel_start >= today)
      }
    });
  }

  function getAttendanceDashboard(filters) {
    try { return okMaybe(attendanceService.dashboard(filters)); } catch (error) { return fail(error); }
  }

  function getAttendanceHistory(filters) {
    try { return okMaybe(attendanceService.history(filters)); } catch (error) { return fail(error); }
  }

  function getAttendanceExceptions(filters) {
    try { return okMaybe(attendanceService.exceptions(filters)); } catch (error) { return fail(error); }
  }

  function snapshot() {
    const attendance = getAttendanceDashboard({});
    const build = (attendanceResult) => ok({ dashboard: dashboard().data, attendance: attendanceResult.data, leads: list('Lead'), quotations: list('Quotation'), quotation_items: list('QuotationItem'), bookings: list('Booking'), booking_items: list('BookingItem'), booking_travelers: list('BookingTraveler'), clients: list('Client'), contacts: list('Contact'), suppliers: list('Supplier'), travelers: list('Traveler'), supplier_bookings: list('SupplierBooking'), supplier_booking_items: list('SupplierBookingItem'), invoices: list('Invoice'), payments: list('Payment'), audit: runtime.auditLog.list() });
    return attendance && typeof attendance.then === 'function' ? attendance.then(build) : build(attendance);
  }

  return {
    runtime,
    list,
    createLead,
    updateLead,
    getLead,
    createQuotationFromLead,
    getQuotationEditor,
    getClientQuotationPreview,
    updateQuotation,
    updateQuotationItem,
    removeQuotationItem,
    reorderQuotationItems,
    addQuotationItem,
    createBookingFromQuotation,
    addBookingTraveler,
    createSupplierBookingFromBookingItem,
    createInvoiceFromBooking,
    recordPaymentFromInvoice,
    recordSupplierPayment,
    getBookingView,
    dashboard,
    attendanceService,
    hrPayrollOfficer,
    getAttendanceDashboard,
    getAttendanceHistory,
    getAttendanceExceptions,
    snapshot
  };
}

module.exports = { createOperationsMvp, ACTOR_CONTEXT };
