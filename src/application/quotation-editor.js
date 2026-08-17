(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WmitQuotationEditor = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_SAFE_MINOR_UNITS = Number.MAX_SAFE_INTEGER;

  // This module intentionally has no Node.js or Google-specific dependencies.
  // It can be loaded by the local Node adapter or pasted/imported as a .gs file.
  function minor(value) {
    var text = String(value === undefined || value === null ? '' : value).trim();
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text)) throw new Error('Money values must use a non-negative amount with up to two decimal places.');
    var parts = text.split('.');
    var cents = Number(parts[0]) * 100 + Number((parts[1] || '').padEnd(2, '0') || '0');
    if (!Number.isSafeInteger(cents)) throw new Error('Money value is too large for exact local calculation. The supported maximum is based on safe integer minor units.');
    return cents;
  }

  function decimal(value) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Money values cannot be negative or unsafe.');
    return value / 100;
  }

  function lineMinor(item, field) {
    var unit = minor(item[field] || 0);
    var quantity = minor(item.quantity || 0);
    // Quantity is stored as a decimal minor value (100 = one item). Avoid
    // multiplying the two scaled values directly: that can overflow even
    // when the final monetary line is still within the exact safe range.
    var wholeQuantity = Math.floor(quantity / 100);
    var fractionalQuantity = quantity % 100;
    var wholeProduct = unit * wholeQuantity;
    if (!Number.isSafeInteger(wholeProduct)) throw new Error('Quotation line is too large for exact local calculation. Reduce the amount or quantity.');
    var fractionalProduct = unit * fractionalQuantity;
    if (!Number.isSafeInteger(fractionalProduct)) throw new Error('Quotation line is too large for exact local calculation. Reduce the amount or quantity.');
    var line = wholeProduct + Math.round(fractionalProduct / 100);
    if (!Number.isSafeInteger(line)) throw new Error('Quotation line is too large for exact local calculation. Reduce the amount or quantity.');
    return line;
  }

  function addSafe(sum, value) {
    var next = sum + value;
    if (!Number.isSafeInteger(next)) throw new Error('Quotation total is too large for exact local calculation. Reduce the amount or quantity.');
    return next;
  }

  function parseItinerary(value) {
    if (!value) return [];
    try {
      var parsed = JSON.parse(String(value));
      if (!Array.isArray(parsed)) return [];
      return parsed.map(function (day, index) {
        return {
          day: day.day || index + 1,
          date: day.date || '',
          title: day.title || '',
          city: day.city || '',
          activities: day.activities || '',
          meals: day.meals || '',
          overnight: day.overnight || '',
          notes: day.notes || ''
        };
      });
    } catch (error) {
      return [];
    }
  }

  function parseFlightDetails(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    try {
      var parsed = JSON.parse(String(value));
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function calculateTotals(items, adjustments) {
    var options = adjustments || {};
    var subtotal = (items || []).reduce(function (sum, item) {
      return addSafe(sum, lineMinor({ quantity: item.quantity, unit_selling_price: item.unit_selling_price || item.unit_price || 0 }, 'unit_selling_price'));
    }, 0);
    var costSubtotal = (items || []).reduce(function (sum, item) {
      return addSafe(sum, lineMinor({ quantity: item.quantity, unit_cost: item.unit_cost || 0 }, 'unit_cost'));
    }, 0);
    var discount = minor(options.discount_total || 0);
    var fees = minor(options.fees_total || 0);
    var tax = minor(options.tax_total || 0);
    var total = subtotal - discount + fees + tax;
    if (!Number.isSafeInteger(total)) throw new Error('Quotation total is too large for exact local calculation. Reduce the amount or quantity.');
    if (total < 0) throw new Error('Quotation adjustments cannot make the total negative.');
    return {
      supplier_cost_total: decimal(costSubtotal),
      markup_total: decimal(subtotal - costSubtotal),
      subtotal: decimal(subtotal),
      discount_total: decimal(discount),
      fees_total: decimal(fees),
      tax_total: decimal(tax),
      client_total: decimal(total)
    };
  }

  function buildClientPreview(quotation, items, client, contact) {
    var totals = calculateTotals(items, quotation);
    var itineraryDays = parseItinerary(quotation.itinerary);
    var flightDetails = parseFlightDetails(quotation.flight_details).filter(function (flight) {
      return ['segment_type', 'airline', 'flight_number', 'departure_airport', 'arrival_airport', 'departure_time', 'arrival_time', 'layover_airport', 'layover_duration_hours', 'checkin_baggage_kg', 'hand_carry_baggage_kg'].some(function (field) { return flight && flight[field]; });
    });
    if (!flightDetails.length) {
      flightDetails = (items || []).filter(function (item) { return item.service_type === 'Flight'; }).map(function (item) {
        return {
          description: item.description,
          segment_type: 'FLIGHT',
          service_start: quotation.travel_start,
          service_end: quotation.travel_end,
          airline: item.airline,
          flight_number: item.flight_number,
          departure_airport: item.departure_airport,
          arrival_airport: item.arrival_airport,
          departure_time: item.departure_time,
          arrival_time: item.arrival_time,
          checkin_baggage_kg: item.checkin_baggage_kg,
          hand_carry_baggage_kg: item.hand_carry_baggage_kg
        };
      });
    }
    var orderedItems = (items || []).slice().sort(function (a, b) { return (a.line_order || 0) - (b.line_order || 0); });
    var clientItems = [];
    var packageIndex = -1;
    var packageAmountMinor = 0;
    var publicItem = function (item) {
      return {
        service_type: item.service_type,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_selling_price,
        amount: decimal(lineMinor({ quantity: item.quantity, unit_selling_price: item.unit_selling_price || 0 }, 'unit_selling_price')),
        currency: item.currency,
        airline: item.airline,
        flight_number: item.flight_number,
        departure_airport: item.departure_airport,
        arrival_airport: item.arrival_airport,
        departure_time: item.departure_time,
        arrival_time: item.arrival_time,
        checkin_baggage_kg: item.checkin_baggage_kg,
        hand_carry_baggage_kg: item.hand_carry_baggage_kg,
        notes: item.client_notes || undefined
      };
    };
    orderedItems.forEach(function (item) {
      if (item.service_type === 'Flight') {
        clientItems.push(publicItem(item));
        return;
      }
      if (packageIndex < 0) {
        packageIndex = clientItems.length;
        clientItems.push(null);
      }
      packageAmountMinor = addSafe(packageAmountMinor, lineMinor({ quantity: item.quantity, unit_selling_price: item.unit_selling_price || 0 }, 'unit_selling_price'));
    });
    if (packageIndex >= 0) {
      clientItems[packageIndex] = {
        service_type: 'Tour Package',
        description: 'Tour Package',
        quantity: 1,
        unit_price: decimal(packageAmountMinor),
        amount: decimal(packageAmountMinor),
        currency: quotation.currency
      };
    }
    return {
      brand: { name: 'World Master International Travel', short_name: 'WMIT', logo_asset: 'header.png' },
      contact: contact ? { name: contact.contact_value, type: contact.contact_type } : null,
      client: client ? { name: client.display_name, email: client.primary_email, phone: client.primary_phone } : null,
      quotation: {
        quotation_date: quotation.quotation_date,
        prepared_by: quotation.prepared_by || quotation.created_by || 'WMIT Staff',
        valid_until: quotation.valid_until,
        destination: quotation.destination,
        travel_start: quotation.travel_start,
        travel_end: quotation.travel_end,
        pax_count: quotation.pax_count,
        currency: quotation.currency,
        inclusions: quotation.inclusions,
        exclusions: quotation.exclusions,
        payment_terms: quotation.payment_terms,
        payment_currency_policy: quotation.payment_currency_policy,
        client_notes: quotation.client_notes,
        itinerary: quotation.itinerary,
        itinerary_days: itineraryDays,
        flight_details: flightDetails,
        client_total: totals.client_total,
        discount_total: totals.discount_total,
        fees_total: totals.fees_total,
        tax_total: totals.tax_total
      },
      items: clientItems
    };
  }

  return { calculateTotals: calculateTotals, buildClientPreview: buildClientPreview, MAX_SAFE_MINOR_UNITS: MAX_SAFE_MINOR_UNITS };
}));
