'use strict';

const MATCH_STATUSES = Object.freeze(['MATCH', 'POSSIBLE_MATCH', 'NO_MATCH']);

function text(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function fieldsOf(result) {
  const output = {};
  (result && result.fields || []).forEach((field) => {
    if (field && field.field_name && field.normalized_value !== null && field.normalized_value !== '') {
      output[field.field_name] = field.normalized_value;
    }
  });
  return output;
}

function valuesFor(record, names) {
  return names.map((name) => record[name]).filter((value) => value !== undefined && value !== null && value !== '');
}

function scoreCandidate(entityType, record, fields) {
  let score = 0;
  const evidence = [];
  const add = (points, reason) => { score += points; evidence.push(reason); };
  const id = record[entityType === 'Invoice' ? 'invoice_id' : entityType === 'SupplierBooking' ? 'supplier_booking_id' : entityType === 'Booking' ? 'booking_id' : entityType === 'Quotation' ? 'quotation_id' : entityType === 'Supplier' ? 'supplier_id' : 'client_id'];

  const invoiceRef = fields.invoice_number && text(fields.invoice_number);
  if (entityType === 'Invoice' && invoiceRef && text(record.invoice_number) === invoiceRef) add(1, 'invoice number matches exactly');
  const supplierRef = fields.supplier_reference && text(fields.supplier_reference);
  if ((entityType === 'SupplierBooking' || entityType === 'BookingItem') && supplierRef) {
    if (text(record.supplier_reference) === supplierRef) add(1, 'supplier reference matches exactly');
  }
  const quotationRef = fields.quotation_reference && text(fields.quotation_reference);
  if (entityType === 'Quotation' && quotationRef && text(record.quotation_id) === quotationRef) add(1, 'quotation reference matches exactly');

  const person = text(fields.client || fields.passenger || fields.traveler);
  if (person) {
    const names = valuesFor(record, ['display_name', 'legal_name', 'full_name', 'contact_name', 'description']).map(text);
    if (names.includes(person)) add(0.7, 'client or passenger name matches');
    else if (names.some((name) => name && (name.includes(person) || person.includes(name)))) add(0.45, 'client or passenger name is a partial match');
  }

  const supplier = text(fields.supplier);
  if (supplier && entityType === 'Supplier') {
    const names = valuesFor(record, ['display_name', 'legal_name']).map(text);
    if (names.includes(supplier)) add(0.7, 'supplier name matches');
    else if (names.some((name) => name && (name.includes(supplier) || supplier.includes(name)))) add(0.45, 'supplier name is a partial match');
  }
  if (fields.destination && entityType === 'Booking' && text(record.destination) === text(fields.destination)) add(0.2, 'destination matches');
  if (fields.travel_start && entityType === 'Booking' && record.travel_start === fields.travel_start) add(0.2, 'travel start date matches');
  if (fields.travel_end && entityType === 'Booking' && record.travel_end === fields.travel_end) add(0.2, 'travel end date matches');
  if (fields.pax_count !== undefined && entityType === 'Booking' && Number(record.pax_count) === Number(fields.pax_count)) add(0.1, 'passenger count matches');
  if (fields.supplier && (entityType === 'SupplierBooking' || entityType === 'BookingItem')) {
    if (text(record.supplier_name) === supplier) add(0.35, 'supplier label matches');
  }

  return { entityType, entityId: id, score: Math.min(score, 1), evidence };
}

function suggestDocumentMatches(result, repositories) {
  const fields = fieldsOf(result);
  const candidates = [];
  const entityTypes = ['Client', 'Supplier', 'Quotation', 'Booking', 'SupplierBooking', 'Invoice'];
  entityTypes.forEach((entityType) => {
    const repository = repositories && repositories[entityType];
    if (!repository || typeof repository.list !== 'function') return;
    repository.list().forEach((record) => {
      const scored = scoreCandidate(entityType, record, fields);
      if (scored.score > 0) candidates.push(scored);
    });
  });
  candidates.sort((a, b) => b.score - a.score || String(a.entityId).localeCompare(String(b.entityId)));
  const suggestions = candidates.slice(0, 10);
  const best = suggestions[0];
  let status = 'NO_MATCH';
  if (best && best.score >= 1) status = 'MATCH';
  else if (best && best.score >= 0.6) status = 'POSSIBLE_MATCH';
  return {
    status,
    suggestions,
    warnings: status === 'POSSIBLE_MATCH'
      ? ['A likely match was found, but human approval is required before linking.']
      : status === 'NO_MATCH' ? ['No reliable deterministic match was found.'] : []
  };
}

module.exports = { MATCH_STATUSES, fieldsOf, suggestDocumentMatches };
