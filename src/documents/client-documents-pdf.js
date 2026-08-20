'use strict';

// Client-document PDF renderers: invoice (statement of account), travel
// itinerary, payment receipt, and confirmed tour voucher. Each renderer
// takes the same data object the corresponding preview action returns and
// mirrors the email-text builders section by section. Client-facing
// safety: only client-visible fields are read - supplier costs, margins,
// and internal notes never appear.

const fs = require('fs');
const path = require('path');
const { createPdfDocument, pdfImageFromPng } = require('./pdf-writer');

const BRAND = 'WORLD MASTER INTERNATIONAL TRAVEL';
const BRAND_ASSET_PATH = path.resolve(__dirname, '../../app/public/assets/header.png');
const LABEL_BLUE = [0.07, 0.39, 0.64];
const HEADER_RULE_NAVY = [0.063, 0.165, 0.263];

let brandImage = null;
let brandImageUnavailable = false;

// Decoding and re-compressing the 1920x366 banner is real work (about
// 2.8 MB of pixel unfiltering), so the pdfImage is built once and cached
// for the process lifetime. If the asset is missing or unsupported the
// documents still render with the text brand line instead of failing.
function loadBrandImage() {
  if (brandImage || brandImageUnavailable) return brandImage;
  try {
    brandImage = pdfImageFromPng(fs.readFileSync(BRAND_ASSET_PATH));
  } catch (error) {
    brandImageUnavailable = true;
    console.warn('[client-documents-pdf] brand header image unavailable, using text brand instead: ' + String(error && error.message));
  }
  return brandImage;
}

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
  const image = loadBrandImage();
  if (image) doc.image(image, { spaceAfter: 10 });
  else doc.heading(BRAND, { size: 15, spaceBefore: 0 });
  doc.paragraph(String(title).toUpperCase(), { bold: true, size: 16.5, align: 'right', color: LABEL_BLUE, letterSpacing: 0.99, spaceAfter: 0 });
  doc.rule({ color: HEADER_RULE_NAVY, width: 2.25, spaceBefore: 9, spaceAfter: 15 });
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
    const currency = totals.currency || '';
    const doc = startDoc('Statement of Account', options);
    doc.metaGrid([
      { label: 'Prepared for', value: invoice.client_name || (d.client && d.client.name) || 'Client' },
      { label: 'Booking', value: (invoice.booking_id || '-') + (invoice.quotation_id ? '\nQuote ' + invoice.quotation_id : '') },
      { label: 'Trip', value: (invoice.destination || '-') + (invoice.travel_start ? '\n' + dateRange(invoice.travel_start, invoice.travel_end) : '') + (invoice.pax_count ? '\n' + invoice.pax_count + ' passenger(s)' : '') },
      { label: 'Issued', value: datePart(invoice.issued_at) || '-' }
    ]);
    doc.sectionTitle('Payment schedule');
    const rows = (d.obligations || []).map((obligation) => ([
      { text: prettyPurpose(obligation.purpose) },
      { text: money(obligation.amount, obligation.currency || currency) },
      { text: money(obligation.allocated, obligation.currency || currency) },
      { text: money(obligation.outstanding, obligation.currency || currency), bold: true },
      { text: obligation.dueAt ? datePart(obligation.dueAt) : '-' },
      { text: obligation.state === 'SATISFIED' ? 'Paid' : obligation.state === 'PARTIALLY_SATISFIED' ? 'Partially paid' : 'Due' }
    ]));
    doc.table({
      columns: [{ header: 'Purpose', width: 0.185 }, { header: 'Amount', width: 0.185 }, { header: 'Paid', width: 0.133 }, { header: 'Outstanding', width: 0.17 }, { header: 'Due', width: 0.16 }, { header: 'State', width: 0.166 }],
      rows: rows.length ? rows : [[{ text: 'No payment obligations recorded.', muted: true }]]
    });
    doc.totalsBlock([
      { label: 'Total', value: money(totals.obligationTotal, currency) },
      { label: 'Verified payments received', value: money(totals.verifiedReceived, currency) },
      { label: 'Outstanding balance', value: money(totals.outstanding, currency), grand: true }
    ]);
    if (d.paymentTerms) {
      doc.sectionTitle('Payment terms');
      doc.paragraph(d.paymentTerms);
    }
    if (d.bankDetails) {
      doc.sectionTitle('Bank details');
      String(d.bankDetails).split('\n').forEach((line) => {
        if (line.trim()) doc.paragraph(line.trim(), { size: 9.5, spaceAfter: 1 });
      });
    }
    doc.footerBlock(['Thank you for choosing World Master International Travel.']);
    return { ok: true, pdf: doc.build().pdf, filename: 'wmit-invoice-' + safeId(invoice.booking_id) + '.pdf' };
  } catch (error) {
    return renderFailed(error);
  }
}

function itineraryDayBlocks(doc, days) {
  days.forEach((day) => {
    doc.paragraph('Day ' + day.day + (day.date ? ' - ' + datePart(day.date) : '') + ' - ' + (day.title || day.city || 'Travel day'), { bold: true, size: 10, spaceBefore: 7, spaceAfter: 2 });
    if (day.city) doc.paragraph(day.city, { size: 9.5, spaceAfter: 2 });
    if (day.activities) doc.paragraph(String(day.activities).replace(/\s+/g, ' ').trim(), { indent: 14, size: 9.5, spaceAfter: 2 });
    if (day.meals) doc.paragraph('Meals: ' + day.meals, { indent: 14, size: 9.5, spaceAfter: 1 });
    if (day.overnight) doc.paragraph('Overnight: ' + day.overnight, { indent: 14, size: 9.5, spaceAfter: 1 });
    if (day.notes) doc.paragraph(String(day.notes).replace(/\s+/g, ' ').trim(), { indent: 14, size: 9.5, color: [0.388, 0.44, 0.514], spaceAfter: 1 });
  });
}

function minutesOf(value) {
  const parts = String(value || '').split(':').map(Number);
  return parts.length >= 2 && parts.every(Number.isFinite) ? parts[0] * 60 + parts[1] : null;
}

function durationLabel(departureTime, arrivalTime) {
  const departure = minutesOf(departureTime);
  const arrival = minutesOf(arrivalTime);
  if (departure === null || arrival === null) return 'Not recorded';
  let minutes = arrival - departure;
  if (minutes < 0) minutes += 24 * 60;
  return Math.floor(minutes / 60) + 'h' + (minutes % 60 ? ' ' + (minutes % 60) + 'm' : '');
}

// Mirrors flightDetailsSectionMarkup in app/public/operations.js: layover
// segments, baggage allowances, and computed durations, row for row.
function quotationFlightRows(flights) {
  return flights.map((item) => {
    const layover = String(item.segment_type || 'FLIGHT').toUpperCase() === 'LAYOVER';
    const baggage = layover ? '-' : [
      item.checkin_baggage_kg ? 'Checked ' + item.checkin_baggage_kg + ' kg' : '',
      item.hand_carry_baggage_kg ? 'Hand carry ' + item.hand_carry_baggage_kg + ' kg' : ''
    ].filter(Boolean).join(' / ') || 'Not recorded';
    const route = layover ? (item.layover_airport || 'Not recorded') : (item.departure_airport || '-') + ' - ' + (item.arrival_airport || '-');
    const schedule = item.departure_time || item.arrival_time
      ? (item.departure_time || '-') + ' - ' + (item.arrival_time || '-') + (minutesOf(item.arrival_time) !== null && minutesOf(item.departure_time) !== null && minutesOf(item.arrival_time) < minutesOf(item.departure_time) ? ' (+1)' : '')
      : '-';
    const duration = layover
      ? (item.layover_duration_hours ? item.layover_duration_hours + 'h' : 'Not recorded')
      : durationLabel(item.departure_time, item.arrival_time);
    return [
      { text: layover ? 'Layover' : (item.airline || 'Not recorded') },
      { text: layover ? '-' : (item.flight_number || 'Not recorded') },
      { text: route },
      { text: schedule },
      { text: duration },
      { text: baggage }
    ];
  });
}

function flightRows(flights) {
  return flights.map((flight) => {
    const route = flight.route || ((flight.departure_airport || '-') + ' - ' + (flight.arrival_airport || '-'));
    const times = flight.times || (flight.departure_time && flight.arrival_time ? flight.departure_time + '-' + flight.arrival_time : flight.departure_time || '');
    return [{ text: route }, { text: [flight.airline, flight.flight_number].filter(Boolean).join(' ') || '-' }, { text: times }, { text: flight.service_date || '' }];
  });
}

function buildItineraryPdf(data, options) {
  try {
    const d = data || {};
    const itinerary = d.itinerary || {};
    const client = d.client || {};
    const days = itinerary.itinerary_days || [];
    const doc = startDoc('Travel Itinerary', options);
    doc.metaGrid([
      { label: 'Prepared for', value: client.name || 'Client' },
      { label: 'Destination', value: itinerary.destination || '-' },
      { label: 'Travel dates', value: (datePart(itinerary.travel_start) || '-') + (itinerary.travel_end ? ' to ' + datePart(itinerary.travel_end) : '') + (itinerary.pax_count ? '\n' + itinerary.pax_count + ' passenger(s)' : '') },
      { label: 'Booking', value: (d.booking && d.booking.booking_id) || '-' }
    ]);
    doc.sectionTitle('Flight details');
    const flightDetails = itinerary.flight_details && itinerary.flight_details.length ? itinerary.flight_details : null;
    if (flightDetails) {
      doc.table({
        columns: [{ header: 'Airline / stop', width: 0.17 }, { header: 'Number', width: 0.11 }, { header: 'Route', width: 0.2 }, { header: 'Schedule', width: 0.17 }, { header: 'Duration', width: 0.13 }, { header: 'Baggage', width: 0.22 }],
        rows: quotationFlightRows(flightDetails)
      });
    } else if ((d.flights || []).length) {
      doc.table({
        columns: [{ header: 'Route', width: 0.3 }, { header: 'Airline / flight', width: 0.32 }, { header: 'Times', width: 0.22 }, { header: 'Date', width: 0.16 }],
        rows: flightRows(d.flights)
      });
    } else {
      doc.paragraph('No flights recorded.', { size: 9.5, italic: true });
    }
    const hotels = d.hotels || [];
    if (hotels.length) {
      doc.sectionTitle('Hotels');
      doc.table({
        columns: [{ header: 'Hotel', width: 0.5 }, { header: 'Qty', width: 0.1 }, { header: 'Notes', width: 0.4 }],
        rows: hotels.map((hotel) => ([
          { text: hotel.description || 'Accommodation' },
          { text: hotel.quantity !== undefined && hotel.quantity !== null ? String(hotel.quantity) : '-' },
          { text: hotel.notes || '' }
        ]))
      });
    }
    doc.sectionTitle('Itinerary');
    if (days.length) itineraryDayBlocks(doc, days);
    else doc.paragraph('No itinerary days recorded yet - add them in the quotation editor.', { size: 9.5, italic: true });
    const vouchers = d.vouchers || [];
    if (vouchers.length) {
      doc.sectionTitle('Vouchers');
      vouchers.forEach((voucher) => {
        doc.paragraph(voucher.voucher_number + (voucher.description ? ' - ' + voucher.description : ''), { size: 9.5, spaceAfter: 2 });
      });
    }
    doc.footerBlock(['We wish you a wonderful trip.', 'World Master International Travel']);
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
    const issued = receipt.status === 'ISSUED';
    const receivedBy = receipt.received_by ? String(receipt.received_by).replace(/^USER:/, '') : '';
    const doc = startDoc(issued ? 'Official Receipt' : 'Payment Acknowledgement', options);
    doc.metaGrid([
      { label: 'Received from', value: (d.client && d.client.name) || 'Client' },
      { label: 'Booking', value: receipt.booking_id || '-' },
      { label: 'Received on', value: datePart(receipt.received_at) || '-' },
      { label: issued ? 'Receipt number' : 'Receipt status', value: issued ? (receipt.receipt_id || '-') : 'Not yet issued' }
    ]);
    doc.totalsBlock([
      { label: 'Amount received', value: money(receipt.amount, receipt.currency), grand: true },
      receipt.purpose ? { label: 'Purpose', value: prettyPurpose(receipt.purpose) } : null,
      receipt.proof_reference ? { label: 'Reference', value: receipt.proof_reference } : null,
      receipt.verified_at ? { label: 'Verified', value: datePart(receipt.verified_at) } : null,
      receivedBy ? { label: 'Received by', value: receivedBy } : null,
      d.booking && d.booking.destination ? { label: 'Trip', value: d.booking.destination } : null
    ]);
    doc.signaturePair(receivedBy ? 'Received by: ' + receivedBy : null, 'Authorized representative', 'Client acknowledgment');
    doc.footerBlock(['This document records payment received by World Master International Travel. ' + (issued ? 'Receipt number: ' + (receipt.receipt_id || '') : 'An official receipt can be issued once the payment is verified.')]);
    return { ok: true, pdf: doc.build().pdf, filename: 'wmit-receipt-' + safeId(receipt.receipt_id || receipt.client_payment_id) + '.pdf' };
  } catch (error) {
    return renderFailed(error);
  }
}

function buildVoucherPdf(data, options) {
  try {
    const d = data || {};
    const booking = d.booking || {};
    const vouchers = d.vouchers || [];
    const doc = startDoc('Confirmed Tour Voucher', options);
    doc.metaGrid([
      { label: 'Guest', value: booking.client_name || 'Client' },
      { label: 'Booking', value: (booking.booking_id || '-') + (booking.commitment_state === 'CONFIRMED' ? '\nConfirmed' : '') },
      { label: 'Trip', value: (booking.destination || '-') + (booking.travel_start ? '\n' + dateRange(booking.travel_start, booking.travel_end) : '') },
      { label: 'Vouchers', value: vouchers.length + ' issued' }
    ]);
    doc.sectionTitle('Service vouchers');
    if (vouchers.length) {
      vouchers.forEach((voucher) => {
        doc.paragraph(voucher.voucher_number + ' - ' + (voucher.service_description || 'Booked service'), { bold: true, size: 10, spaceAfter: 1 });
        const supplier = voucher.supplier_name ? 'Supplier: ' + voucher.supplier_name + (voucher.supplier_contact ? ' - ' + voucher.supplier_contact : '') : '';
        if (supplier) doc.paragraph(supplier, { indent: 14, size: 9.5, spaceAfter: 1 });
        if (voucher.issued_at) doc.paragraph('Issued: ' + datePart(voucher.issued_at), { indent: 14, size: 9.5, spaceAfter: 3 });
      });
    } else {
      doc.paragraph('Please present your booking reference to each supplier. Individual service vouchers have not been issued for this booking yet.', { size: 9.5, italic: true });
    }
    if (booking.client_total) {
      doc.totalsBlock([{ label: 'Package total', value: money(booking.client_total, booking.currency), grand: true }]);
    }
    doc.footerBlock(['Please present this voucher to each supplier on arrival.', 'World Master International Travel']);
    return { ok: true, pdf: doc.build().pdf, filename: 'wmit-voucher-' + safeId(booking.booking_id) + '.pdf' };
  } catch (error) {
    return renderFailed(error);
  }
}

function buildQuotationPdf(data, options) {
  try {
    const d = data || {};
    const q = d.quotation || {};
    const client = d.client || {};
    const doc = startDoc('Quotation', options);
    doc.metaGrid([
      { label: 'Prepared for', value: client.name || 'Client' },
      { label: 'Destination', value: q.destination || '-' },
      { label: 'Travel dates', value: (datePart(q.travel_start) || '-') + ' to ' + (datePart(q.travel_end) || '-') + '\n' + (q.pax_count || '-') + ' passenger(s)' },
      { label: 'Quotation date', value: (datePart(q.quotation_date) || '-') + '\nValid until ' + (datePart(q.valid_until) || '-') }
    ]);
    const flights = (q.flight_details && q.flight_details.length ? q.flight_details : (d.items || []).filter((item) => item.service_type === 'Flight'));
    if (flights.length) {
      doc.sectionTitle('Flight details');
      doc.table({
        columns: [{ header: 'Airline / stop', width: 0.17 }, { header: 'Number', width: 0.11 }, { header: 'Route', width: 0.2 }, { header: 'Schedule', width: 0.17 }, { header: 'Duration', width: 0.13 }, { header: 'Baggage', width: 0.22 }],
        rows: quotationFlightRows(flights)
      });
    }
    const days = q.itinerary_days || [];
    if (days.length) {
      doc.sectionTitle('Itinerary');
      itineraryDayBlocks(doc, days);
    }
    const items = d.items || [];
    doc.sectionTitle('Travel services');
    const dates = q.travel_start ? datePart(q.travel_start) + (q.travel_end ? ' - ' + datePart(q.travel_end) : '') : '';
    doc.table({
      columns: [{ header: 'Service', width: 0.18 }, { header: 'Description', width: 0.42 }, { header: 'Dates', width: 0.16 }, { header: 'Qty', width: 0.08 }, { header: 'Amount', width: 0.16, align: 'right' }],
      rows: items.length ? items.map((item) => {
        const flight = item.service_type === 'Flight'
          ? [item.airline, item.flight_number, item.departure_airport && item.arrival_airport ? item.departure_airport + ' - ' + item.arrival_airport : item.departure_airport || item.arrival_airport, item.departure_time && item.arrival_time ? item.departure_time + '-' + item.arrival_time : item.departure_time || item.arrival_time].filter(Boolean).join(' - ')
          : '';
        return [
          { text: item.service_type || 'Service' },
          flight ? { lines: [{ text: item.description || '' }, { text: flight, muted: true }] } : { text: item.description || '' },
          { text: dates },
          { text: item.quantity !== undefined ? String(item.quantity) : '' },
          { text: money(item.amount, item.currency || q.currency) }
        ];
      }) : [[{ text: 'No services recorded.', muted: true }]]
    });
    doc.totalsBlock([
      Number(q.discount_total || 0) > 0 ? { label: 'Discount', value: '-' + money(q.discount_total, q.currency) } : null,
      Number(q.fees_total || 0) + Number(q.tax_total || 0) > 0 ? { label: 'Fees and taxes', value: money(String(Number(q.fees_total || 0) + Number(q.tax_total || 0)), q.currency) } : null,
      { label: 'Total', value: money(q.client_total, q.currency), grand: true }
    ]);
    doc.sectionTitle('Inclusions');
    doc.paragraph(String(q.inclusions || 'As listed above.').replace(/\s+/g, ' ').trim(), { size: 9.5 });
    doc.sectionTitle('Exclusions');
    doc.paragraph(String(q.exclusions || 'Not specified.').replace(/\s+/g, ' ').trim(), { size: 9.5 });
    doc.sectionTitle('Payment terms and notes');
    doc.paragraph(String(q.payment_terms || 'Payment terms to be confirmed.').replace(/\s+/g, ' ').trim(), { size: 9.5 });
    if (q.client_notes) doc.paragraph(String(q.client_notes).replace(/\s+/g, ' ').trim(), { size: 9.5 });
    doc.footerBlock(['World Master International Travel', 'Philippines | Please contact WMIT for questions about this quotation.']);
    return { ok: true, pdf: doc.build().pdf, filename: 'wmit-quotation-' + safeId(q.quotation_id) + '.pdf' };
  } catch (error) {
    return renderFailed(error);
  }
}

module.exports = { buildInvoicePdf, buildItineraryPdf, buildReceiptPdf, buildVoucherPdf, buildQuotationPdf };
