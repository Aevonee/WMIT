'use strict';

// Client-document PDF renderers: invoice (statement of account), travel
// itinerary, payment receipt, and confirmed tour voucher. Each renderer
// takes the same data object the corresponding preview action returns and
// mirrors the email-text builders section by section. Client-facing
// safety: only client-visible fields are read - supplier costs, margins,
// and internal notes never appear.

const { createPdfDocument } = require('./pdf-writer');

const BRAND = 'WORLD MASTER INTERNATIONAL TRAVEL';

function safeId(value) {
  const cleaned = String(value || '').replace(/[^A-Za-z0-9._-]/g, '_');
  return cleaned || 'document';
}

function datePart(value) {
  return value ? String(value).slice(0, 10) : '';
}

function dateRange(start, end) {
  if (!start && !end) return '';
  return datePart(start) + (end && datePart(end) !== datePart(start) ? ' to ' + datePart(end) : '');
}

function prettyPurpose(purpose) {
  return String(purpose || 'INSTALLMENT').replace(/_/g, ' ').toLowerCase();
}

function money(amount, currency) {
  return String(amount || '0.00') + (currency ? ' ' + currency : '');
}

function startDoc(title, options) {
  const doc = createPdfDocument({ generatedAt: options && options.generatedAt });
  doc.heading(BRAND, { size: 15, spaceBefore: 0 });
  doc.paragraph(title, { bold: true, size: 12.5, spaceAfter: 4 });
  doc.rule();
  return doc;
}

function renderFailed(error) {
  return { ok: false, error: { code: 'PDF_RENDER_FAILED', message: String(error && error.message || error) } };
}

function buildInvoicePdf(data, options) {
  try {
    const d = data || {};
    const invoice = d.invoice || {};
    const totals = d.totals || {};
    const doc = startDoc('Statement of Account', options);
    doc.paragraph('Dear ' + (invoice.client_name || (d.client && d.client.name) || 'Client') + ',');
    doc.paragraph('Please find below your statement of account for booking ' + (invoice.booking_id || '') + (invoice.destination ? ' (' + invoice.destination + ')' : '') + '.');
    doc.spacer(4);
    if (invoice.booking_id) doc.row('Booking', invoice.booking_id);
    if (invoice.destination) doc.row('Destination', invoice.destination);
    const travel = dateRange(invoice.travel_start, invoice.travel_end);
    if (travel) doc.row('Travel', travel);
    if (invoice.pax_count) doc.row('Travellers', invoice.pax_count);
    doc.rule();
    doc.heading('Statement of account', { size: 11, spaceBefore: 0 });
    (d.obligations || []).forEach((obligation) => {
      const label = prettyPurpose(obligation.purpose) + (obligation.dueAt ? ' - due ' + datePart(obligation.dueAt) : '');
      doc.row(label, money(obligation.amount, obligation.currency));
      const paid = obligation.outstanding !== undefined && String(obligation.outstanding) === '0.00';
      doc.paragraph(paid ? 'Paid' : 'Outstanding: ' + money(obligation.outstanding, obligation.currency), { indent: 16, size: 9, italic: true, spaceAfter: 2 });
    });
    doc.rule();
    doc.row('Total', money(totals.obligationTotal, totals.currency), { bold: true });
    doc.row('Verified payments received', money(totals.verifiedReceived, totals.currency));
    doc.row('Outstanding balance', money(totals.outstanding, totals.currency), { bold: true });
    if (d.paymentTerms) {
      doc.heading('Payment terms', { size: 11 });
      doc.paragraph(d.paymentTerms);
    }
    if (d.bankDetails) {
      doc.heading('Bank details', { size: 11 });
      String(d.bankDetails).split('\n').forEach((line) => {
        if (line.trim()) doc.paragraph(line.trim(), { size: 9.5 });
      });
    }
    doc.spacer(8);
    doc.paragraph('Thank you for choosing World Master International Travel.');
    return { ok: true, pdf: doc.build().pdf, filename: 'wmit-invoice-' + safeId(invoice.booking_id) + '.pdf' };
  } catch (error) {
    return renderFailed(error);
  }
}

function buildItineraryPdf(data, options) {
  try {
    const d = data || {};
    const itinerary = d.itinerary || {};
    const client = d.client || {};
    const doc = startDoc('Travel Itinerary', options);
    if (client.name) doc.paragraph('Prepared for ' + client.name, { bold: true, spaceAfter: 6 });
    if (itinerary.destination) doc.row('Destination', itinerary.destination);
    const travel = dateRange(itinerary.travel_start, itinerary.travel_end);
    if (travel) doc.row('Travel', travel);
    if (itinerary.pax_count) doc.row('Travellers', itinerary.pax_count);
    if (d.booking && d.booking.booking_id) doc.row('Booking', d.booking.booking_id);
    const days = itinerary.itinerary_days || [];
    if (days.length) {
      doc.heading('Day by day', { size: 11 });
      days.forEach((day) => {
        doc.heading('Day ' + day.day + (day.date ? ' (' + datePart(day.date) + ')' : '') + ' - ' + (day.title || day.city || 'Travel day'), { size: 10, spaceBefore: 5, spaceAfter: 1 });
        if (day.activities) doc.paragraph(String(day.activities).replace(/\s+/g, ' ').trim(), { indent: 14, size: 9.5, spaceAfter: 1 });
        if (day.meals) doc.paragraph('Meals: ' + day.meals, { indent: 14, size: 9, spaceAfter: 1 });
        if (day.overnight) doc.paragraph('Overnight: ' + day.overnight, { indent: 14, size: 9, spaceAfter: 1 });
      });
    }
    const flights = d.flights || [];
    if (flights.length) {
      doc.heading('Flights', { size: 11 });
      flights.forEach((flight) => {
        const parts = [flight.route, flight.airline, flight.flight_number, flight.times, flight.service_date].filter(Boolean).join(' - ');
        doc.paragraph(parts, { indent: 14, size: 9.5, spaceAfter: 1 });
      });
    }
    const vouchers = d.vouchers || [];
    if (vouchers.length) {
      doc.heading('Vouchers issued', { size: 11 });
      vouchers.forEach((voucher) => {
        doc.paragraph(voucher.voucher_number + (voucher.description ? ' - ' + voucher.description : ''), { indent: 14, size: 9.5, spaceAfter: 1 });
      });
    }
    doc.spacer(8);
    doc.paragraph('We wish you a wonderful trip.');
    doc.paragraph('World Master International Travel');
    const id = (d.booking && d.booking.booking_id) || itinerary.quotation_id;
    return { ok: true, pdf: doc.build().pdf, filename: 'wmit-itinerary-' + safeId(id) + '.pdf' };
  } catch (error) {
    return renderFailed(error);
  }
}

function buildReceiptPdf(data, options) {
  try {
    const d = data || {};
    const receipt = d.receipt || {};
    const doc = startDoc(receipt.status === 'ISSUED' ? 'Official Receipt' : 'Payment Acknowledgement', options);
    doc.paragraph('Dear ' + ((d.client && d.client.name) || 'Client') + ',');
    doc.paragraph('We confirm receipt of your payment. Thank you.');
    doc.spacer(4);
    doc.row('Amount received', money(receipt.amount, receipt.currency), { bold: true });
    if (receipt.received_at) doc.row('Received on', datePart(receipt.received_at));
    if (receipt.booking_id) doc.row('Booking', receipt.booking_id);
    if (d.booking && d.booking.destination) doc.row('Destination', d.booking.destination);
    if (receipt.proof_reference) doc.row('Reference', receipt.proof_reference);
    if (receipt.received_by) doc.row('Received by', String(receipt.received_by).replace(/^USER:/, ''));
    doc.row('Receipt status', receipt.status === 'ISSUED' ? 'Official receipt ' + (receipt.receipt_id || '') : 'Acknowledgement (official receipt not yet issued)');
    doc.spacer(8);
    doc.paragraph('Thank you for choosing World Master International Travel.');
    return { ok: true, pdf: doc.build().pdf, filename: 'wmit-receipt-' + safeId(receipt.receipt_id || receipt.client_payment_id) + '.pdf' };
  } catch (error) {
    return renderFailed(error);
  }
}

function buildVoucherPdf(data, options) {
  try {
    const d = data || {};
    const booking = d.booking || {};
    const doc = startDoc('Confirmed Tour Voucher', options);
    doc.paragraph('Dear ' + (booking.client_name || 'Client') + ',');
    doc.paragraph('Your confirmed tour voucher' + (booking.destination ? ' for ' + booking.destination : '') + ' is ready.');
    doc.spacer(4);
    if (booking.booking_id) doc.row('Booking', booking.booking_id);
    const travel = dateRange(booking.travel_start, booking.travel_end);
    if (travel) doc.row('Travel', travel);
    if (booking.client_total) doc.row('Package total', money(booking.client_total, booking.currency));
    doc.heading('Vouchers issued', { size: 11 });
    const vouchers = d.vouchers || [];
    if (vouchers.length) {
      vouchers.forEach((voucher) => {
        doc.paragraph(voucher.voucher_number + ' - ' + (voucher.service_description || 'Booked service') + (voucher.supplier_name ? ' (' + voucher.supplier_name + ')' : ''), { indent: 14, size: 9.5, spaceAfter: 2 });
      });
    } else {
      doc.paragraph('No vouchers have been issued for this booking yet.', { indent: 14, size: 9.5 });
    }
    doc.spacer(8);
    doc.paragraph('Please present the voucher to each supplier on arrival.');
    doc.paragraph('World Master International Travel');
    return { ok: true, pdf: doc.build().pdf, filename: 'wmit-voucher-' + safeId(booking.booking_id) + '.pdf' };
  } catch (error) {
    return renderFailed(error);
  }
}

module.exports = { buildInvoicePdf, buildItineraryPdf, buildReceiptPdf, buildVoucherPdf };
