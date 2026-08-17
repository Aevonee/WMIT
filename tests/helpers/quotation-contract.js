'use strict';

// Existing workflow fixtures now satisfy the same commercial completeness gate
// that production quotations use before approval.
function makeQuotationApprovable(runtime, quotation, context) {
  const actorContext = context || { actor: 'staff' };
  const item = runtime.createQuotationItem({ quotation_id: quotation.quotation_id, service_type: 'Hotel', description: 'Synthetic hotel service', quantity: 1, unit_cost: quotation.supplier_cost_total || '70.00', unit_selling_price: quotation.client_total || '100.00', currency: quotation.currency || 'PHP' }, actorContext);
  if (!item.ok) return item;
  return runtime.updateQuotation({ quotation_id: quotation.quotation_id, destination: quotation.destination || 'Synthetic destination', inclusions: quotation.inclusions || 'Synthetic service', exclusions: quotation.exclusions || 'Personal expenses' }, actorContext);
}

module.exports = { makeQuotationApprovable };
