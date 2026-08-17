'use strict';

let state = null;
let sessionEvents = [];
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const list = (type) => (state && state.entities && state.entities[type]) || [];
const latest = (type, predicate) => list(type).filter(predicate || (() => true)).slice(-1)[0] || null;
const json = (value) => JSON.stringify(value, null, 2);

function setBanner(text, kind) { const el = $('message'); el.textContent = text; el.className = 'banner ' + (kind || 'ok'); }
function pill(value, kind) { return '<span class="pill ' + (kind || '') + '">' + esc(value || 'PENDING') + '</span>'; }
function idOf(record) { if (!record) return '—'; return Object.keys(record).find((key) => key.endsWith('_id')) ? record[Object.keys(record).find((key) => key.endsWith('_id'))] : '—'; }
function fmt(value) { return value === undefined || value === null || value === '' ? '—' : String(value); }
function recordBlock(label, record, fields) {
  if (!record) return '<div class="state-card"><strong>' + esc(label) + '</strong>' + pill('PENDING', 'info') + '</div>';
  const lines = (fields || []).filter((field) => record[field] !== undefined && record[field] !== null && record[field] !== '').map((field) => '<div class="small"><b>' + esc(field) + ':</b> ' + esc(typeof record[field] === 'object' ? json(record[field]) : record[field]) + '</div>').join('');
  return '<div class="state-card"><strong>' + esc(label) + ' ' + pill(record.status || record.state || record.record_state || record.payment_state || record.commitment_state || 'EXISTS', 'good') + '</strong><div class="small"><b>ID:</b> ' + esc(idOf(record)) + '</div>' + lines + '</div>';
}

function currentRecords() {
  const inquiry = latest('Inquiry');
  const option = latest('CommercialOption', (x) => x.selected || x.state === 'SELECTED') || latest('CommercialOption');
  const tariff = option ? latest('TariffSource', (x) => x.tariff_source_id === option.tariff_source_id) : latest('TariffSource');
  const quotation = latest('Quotation');
  const booking = latest('Booking');
  const supplierBooking = latest('SupplierBooking');
  const payment = latest('ClientPayment');
  const payable = latest('SupplierPayable');
  const supplierPayment = latest('SupplierPayment');
  return { inquiry, option, tariff, quotation, booking, supplierBooking, payment, payable, supplierPayment };
}

function stageData() {
  const r = currentRecords();
  const tariffReview = r.tariff && !r.tariff.trusted;
  const funds = r.booking && r.payable && r.payment && r.payment.payment_state === 'VERIFIED' ? 'REVIEW' : '';
  return [
    ['Inquiry', !!r.inquiry, r.inquiry ? 'Captured' : 'Not started', 'done'],
    ['Tariff / research', !!r.tariff && !tariffReview, tariffReview ? 'Requires review' : (r.tariff ? 'Trusted' : 'Pending'), tariffReview ? 'review' : ''],
    ['Reviewed options', !!r.option, r.option ? (r.option.selected ? 'Selected' : 'Candidates found') : 'Pending', r.option && r.option.selected ? 'done' : ''],
    ['Quotation', !!r.quotation && r.quotation.status === 'APPROVED', r.quotation ? r.quotation.status : 'Pending', r.quotation && r.quotation.status === 'DRAFT' ? 'review' : ''],
    ['Booking record', !!r.booking, r.booking ? 'Record exists' : 'Pending', ''],
    ['Client commitment', !!r.booking && r.booking.commitment_state === 'CONFIRMED', r.booking ? r.booking.commitment_state : 'Pending', r.booking && r.booking.commitment_state === 'REACCEPTANCE_REQUIRED' ? 'review' : ''],
    ['Supplier reservation', !!r.supplierBooking, r.supplierBooking ? r.supplierBooking.reservation_state : 'Pending', ''],
    ['Client payment', !!r.payment, r.payment ? r.payment.payment_state : 'Pending', r.payment && r.payment.payment_state !== 'VERIFIED' ? 'review' : ''],
    ['Verification / allocation', !!r.payment && r.payment.payment_state === 'VERIFIED' && list('PaymentAllocation').length > 0, r.payment ? (r.payment.payment_state === 'VERIFIED' ? (list('PaymentAllocation').length ? 'Allocated' : 'Unallocated') : 'Awaiting verification') : 'Pending', r.payment && r.payment.payment_state === 'VERIFIED' && !list('PaymentAllocation').length ? 'review' : ''],
    ['Supplier Payable', !!r.payable && r.payable.state === 'APPROVED', r.payable ? r.payable.state : 'Pending', ''],
    ['Supplier Payment', !!r.supplierPayment, r.supplierPayment ? r.supplierPayment.state : 'Blocked / pending gate', r.supplierPayment ? 'done' : 'blocked'],
    ['Documents / tasks', Boolean(list('Document').length || list('Task').length), (list('Document').length || list('Task').length) ? (list('Task').length + ' task(s), ' + list('Document').length + ' document(s)') : 'Pending', ''],
    ['Departure', list('Departure').length > 0, list('Departure').length ? 'Visible' : 'Pending', '']
  ];
}

function renderWorkflow() {
  const stages = stageData();
  let currentFound = false;
  $('workflow').innerHTML = stages.map(([name, done, status, kind]) => {
    const isDone = done === true;
    const isBlocked = kind === 'blocked';
    const isReview = kind === 'review';
    const current = !isDone && !currentFound;
    if (current) currentFound = true;
    return '<div class="stage ' + (isDone ? 'done ' : '') + (isBlocked ? 'blocked ' : '') + (isReview ? 'review ' : '') + (current ? 'current' : '') + '"><div class="stage-name">' + esc(name) + '</div><div class="stage-status">' + esc(status) + '</div></div>';
  }).join('');
}

function renderSummary() {
  const r = currentRecords();
  const payment = r.payment;
  const allocation = payment && list('PaymentAllocation').filter((x) => x.client_payment_id === payment.client_payment_id);
  $('summary').innerHTML = [
    recordBlock('Inquiry', r.inquiry, ['current_requirements', 'original_request']),
    recordBlock('Selected option', r.option, ['supplier_id', 'tariff_source_id', 'requirements_snapshot', 'match_explanation']),
    recordBlock('Tariff/version', r.tariff, ['supplier_name', 'status', 'trusted', 'extraction_summary', 'reviewed_by']),
    recordBlock('Quotation', r.quotation, ['status', 'supplier_cost_total', 'client_total', 'discount_state', 'pricing_rule_snapshot']),
    recordBlock('Booking record', r.booking, ['record_state', 'commitment_state', 'current_price', 'current_supplier_cost']),
    recordBlock('Supplier reservation', r.supplierBooking, ['supplier_id', 'reservation_state', 'fulfillment_state']),
    recordBlock('Client payment', payment, ['amount', 'currency', 'actual_sent_at', 'payment_state', 'verified_by']),
    '<div class="state-card"><strong>Payment allocation</strong>' + (allocation.length ? allocation.map((x) => '<div class="small">' + esc(x.amount + ' ' + x.currency + ' → ' + x.booking_id) + '</div>').join('') : pill('Unallocated — no client allocation instruction recorded.', 'warn')) + '</div>',
    recordBlock('Supplier Payable', r.payable, ['booking_id', 'amount', 'currency', 'state', 'client_money_gate']),
    recordBlock('Supplier Payment', r.supplierPayment, ['amount', 'currency', 'state', 'executed_by']),
    '<div class="state-card"><strong>Documents / tasks / Departure</strong><div class="small">Documents: ' + list('Document').length + ' · Tasks: ' + list('Task').length + ' · Departures: ' + list('Departure').length + '</div></div>'
  ].join('');
}

function renderTariff() {
  const tariff = latest('TariffSource');
  const facts = tariff ? list('TariffExtractionFact').filter((x) => x.tariff_source_id === tariff.tariff_source_id) : [];
  const rates = tariff ? list('TariffRateComponent').filter((x) => x.tariff_source_id === tariff.tariff_source_id) : [];
  const itinerary = tariff ? list('TariffItineraryComponent').filter((x) => x.tariff_source_id === tariff.tariff_source_id) : [];
  if (!tariff) { $('tariff-inspector').innerHTML = '<div class="muted">No tariff uploaded yet.</div>'; return; }
  const unresolved = facts.filter((x) => x.ambiguous || x.review_status !== 'CONFIRMED' || Number(x.confidence || 0) < .8);
  const hotels = [...new Set(rates.map((x) => x.conditions && x.conditions.hotel).filter(Boolean))];
  const regions = [...new Set(rates.map((x) => x.conditions && x.conditions.region).filter(Boolean))];
  const durations = [...new Set(rates.map((x) => x.conditions && (x.conditions.duration || x.conditions.nights)).filter(Boolean))];
  const occupancy = [...new Set(rates.map((x) => x.conditions && (x.conditions.room_arrangement || x.conditions.room_type)).filter(Boolean))];
  $('tariff-inspector').innerHTML = '<div class="state-card"><strong>' + esc(tariff.supplier_name || tariff.supplier_id) + ' · ' + esc(tariff.original_source && tariff.original_source.file_name || tariff.file_name || 'Tariff') + '</strong><div>Status: ' + pill(tariff.trusted ? 'TRUSTED / ACTIVE' : 'NEEDS REVIEW', tariff.trusted ? 'good' : 'warn') + '</div><div class="small">Version: ' + esc(tariff.tariff_source_id) + ' · Components: ' + rates.length + '</div></div>' + (unresolved.length ? '<div class="event warn">⚠ Tariff requires review before trust. Unresolved: ' + esc(unresolved.map((x) => x.field_name).join(', ')) + '. Currency and unit are not assumed.</div>' : '<div class="event">✓ Extraction review facts are confirmed.</div>') + '<div class="row"><div><b>Hotels</b><div class="small">' + esc(hotels.slice(0, 18).join(' · ') || '—') + '</div></div><div><b>Regions</b><div class="small">' + esc(regions.join(' · ') || '—') + '</div></div><div><b>Durations</b><div class="small">' + esc(durations.join(' · ') || '—') + '</div></div><div><b>Occupancy</b><div class="small">' + esc(occupancy.join(' · ') || '—') + '</div></div></div><h3>Extraction facts</h3><pre>' + esc(json(facts)) + '</pre><h3>Conditional rate components</h3><div class="scroll"><table><thead><tr><th>Hotel / region</th><th>Duration</th><th>Occupancy</th><th>Amount</th><th>Currency</th><th>Unit</th><th>Provenance</th><th>Warnings</th></tr></thead><tbody>' + rates.slice(0, 120).map((rate) => '<tr><td>' + esc((rate.conditions && rate.conditions.hotel) + ' / ' + (rate.conditions && rate.conditions.region || '')) + '</td><td>' + esc(rate.conditions && rate.conditions.duration || rate.conditions && rate.conditions.nights) + '</td><td>' + esc(rate.conditions && (rate.conditions.room_arrangement || rate.conditions.room_type)) + '</td><td>' + esc(rate.amount) + '</td><td>' + esc(rate.currency || 'UNCONFIRMED') + '</td><td>' + esc(rate.rate_unit || 'UNCONFIRMED') + '</td><td>' + esc(json(rate.source_provenance)) + '</td><td>' + esc((rate.warnings || []).join('; ')) + '</td></tr>').join('') + '</tbody></table></div><h3>Itinerary / notes</h3><pre>' + esc(json(itinerary)) + '</pre>';
}

function renderOptions() {
  const options = list('CommercialOption');
  $('options').innerHTML = options.length ? '<div class="scroll"><table><thead><tr><th>ID</th><th>Supplier</th><th>State</th><th>Conditions / explanation</th><th>Warnings</th><th>Provenance</th></tr></thead><tbody>' + options.map((x) => '<tr><td>' + esc(x.commercial_option_id) + (x.selected ? ' ✓' : '') + '</td><td>' + esc(x.supplier_id) + '</td><td>' + pill(x.state || 'MATCHED', x.selected ? 'good' : 'info') + '</td><td>' + esc((x.match_explanation || []).join(' · ')) + '</td><td>' + esc((x.warnings || []).join('; ') || '—') + '</td><td>' + esc(json(x.source_provenance)) + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="muted">No candidates yet. Find options after a trusted tariff and Inquiry exist.</div>';
}

function renderDetails() { renderWorkflow(); renderSummary(); renderTariff(); renderOptions(); const r = currentRecords(); $('quote-detail').innerHTML = r.quotation ? '<pre>' + esc(json(r.quotation)) + '</pre>' : ''; $('booking-detail').innerHTML = r.booking || r.supplierBooking || r.payable || r.supplierPayment ? '<pre>' + esc(json({ booking:r.booking, supplier_booking:r.supplierBooking, payable:r.payable, supplier_payment:r.supplierPayment })) + '</pre>' : ''; $('payment-detail').innerHTML = r.payment ? '<pre>' + esc(json({ payment:r.payment, evidence:list('PaymentEvidence').filter((x) => x.client_payment_id === r.payment.client_payment_id), allocations:list('PaymentAllocation').filter((x) => x.client_payment_id === r.payment.client_payment_id) })) + '</pre>' : ''; $('adjustment-detail').innerHTML = list('Amendment').length || list('RefundAdjustment').length ? '<pre>' + esc(json({ amendments:list('Amendment'), refunds:list('RefundAdjustment') })) + '</pre>' : ''; $('operations-detail').innerHTML = '<pre>' + esc(json({ tasks:list('Task'), documents:list('Document'), departures:list('Departure') })) + '</pre>'; }

function renderEvents() { $('events').innerHTML = sessionEvents.length ? sessionEvents.map((x) => '<div class="event ' + esc(x.kind) + '"><b>' + esc(x.title) + '</b><br>' + esc(x.detail) + '</div>').join('') : '<div class="muted">No actions recorded in this browser session.</div>'; }
function announce(title, detail, kind) { sessionEvents.unshift({ title, detail, kind:kind || 'ok' }); sessionEvents = sessionEvents.slice(0, 25); renderEvents(); setBanner(title + '\n' + detail, kind === 'error' ? 'error' : kind === 'warn' ? 'warn' : 'ok'); }
function actionLabel(action) { return ({ createInquiry:'Inquiry created', uploadTariff:'Tariff uploaded for review', reviewTariff:'Tariff review result', matchOptions:'Matching options result', findMoreOptions:'Additional options result', selectOption:'Option selected', createQuotation:'Draft quotation created', approveQuotation:'Quotation approval result', createBooking:'Booking record created', confirmCommitment:'Client commitment result', createSupplierBooking:'Supplier reservation result', createSupplierPayable:'Supplier Payable created', approveSupplierPayable:'Supplier Payable approval result', executeSupplierPayment:'Supplier Payment result', recordClientPayment:'Payment recorded', verifyClientPayment:'Payment verification result', allocatePayment:'Payment allocation result', amendBooking:'Booking amendment result', requestRefund:'Refund draft created', executeRefund:'Refund execution result', createTask:'Task created', createDeparture:'Departure created', resetSyntheticTestCase:'Synthetic case reset' }[action] || action); }
function resultDetail(action, data) { if (action === 'executeSupplierPayment' && data && data.supplier_payment_id) return '✓ EXECUTED · Payment ID ' + data.supplier_payment_id + ' · amount ' + data.amount; if (action === 'executeSupplierPayment') return 'NOT EXECUTED · see blocking reason'; if (action === 'recordClientPayment') return 'Payment ID ' + (data.payment && data.payment.client_payment_id) + ' · ' + data.payment.amount + ' ' + data.payment.currency + ' · awaiting verification · proof ' + ((data.evidence && (data.evidence.proof_reference || data.evidence.proof_document_id)) || 'attached'); if (action === 'allocatePayment') return 'Allocated exactly as instructed: ' + json(data); if (action === 'verifyClientPayment') return 'Payment ' + data.client_payment_id + ' · VERIFIED by ' + data.verified_by; if (action === 'matchOptions' || action === 'findMoreOptions') return (data.candidates || []).length + ' candidate(s) returned; automatic selection: ' + data.automatic_selection; if (action === 'resetSyntheticTestCase') return 'Only local synthetic Phase 1 state was reset.'; return 'Record/state: ' + json(data); }
function wmitAuthHeaders() { const token = sessionStorage.getItem('wmit_session'); return token ? { Authorization: 'Bearer ' + token } : {}; }
async function wmitGuard401(response) { if (response.status === 401) { sessionStorage.removeItem('wmit_session'); sessionStorage.removeItem('wmit_user'); window.location.href = 'login.html'; throw new Error('Sign-in required.'); } return response; }
async function loadState() { const response = await wmitGuard401(await fetch('/api/phase1/state', { headers: wmitAuthHeaders() })); const result = await response.json(); if (!result.ok) throw new Error(result.error && result.error.message || 'Could not load Phase 1 state.'); state = result.data; renderDetails(); $('state').textContent = json(state); }
async function action(actionName, input, actor) { const response = await wmitGuard401(await fetch('/api/phase1/action', { method:'POST', headers:Object.assign({'Content-Type':'application/json'}, wmitAuthHeaders()), body:JSON.stringify({ action:actionName, input:input || {}, actor:actor || 'LOCAL_STAFF' }) })); const result = await response.json(); if (!result.ok) { const error = new Error((result.error && result.error.message) || 'Operation blocked.'); error.code = result.error && result.error.code; error.details = result.error && result.error.details; announce('✕ ' + actionLabel(actionName) + ' — NOT EXECUTED', error.code + ': ' + error.message + (error.details ? '\n' + json(error.details) : ''), 'error'); await loadState(); throw error; } announce('✓ ' + actionLabel(actionName), resultDetail(actionName, result.data), 'ok'); await loadState(); return result.data; }
function handle(error) { if (error && error.code) return; announce('✕ Action failed', error.message || String(error), 'error'); }
async function createInquiry() { try { const data=await action('createInquiry',{client_id:$('inquiry-client').value,received_at:new Date().toISOString(),source:'LOCAL_SYNTHETIC',requirements:{destination:$('inquiry-destination').value,travel_start:$('inquiry-start').value,travel_end:$('inquiry-end').value,nights:Number($('inquiry-nights').value),pax_count:Number($('inquiry-pax').value)}}); $('match-inquiry').value=data.inquiry_id; } catch(e){handle(e);} }
async function uploadTariff() { try { const data=await action('uploadTariff',{supplier_id:$('tariff-supplier').value,file_name:$('tariff-file').value,file_ref:'local://'+$('tariff-file').value,extraction_summary:{source:'LOCAL_SYNTHETIC_FIXTURE',review_required:true},original_source:{file_name:$('tariff-file').value,file_ref:'local://'+$('tariff-file').value,source_type:'LOCAL_SYNTHETIC'},extraction_facts:[{field_name:'destination',normalized_value:'Bangkok',confidence:1}],rate_components:JSON.parse($('tariff-rates').value),itinerary_components:[]}); $('tariff-id').value=data.tariff_source_id; } catch(e){handle(e);} }
async function reviewTariff() { try { const tariff=latest('TariffSource'); if(!tariff) throw new Error('Upload a tariff first.'); const facts=list('TariffExtractionFact').filter((x)=>x.tariff_source_id===tariff.tariff_source_id); const corrections={}; facts.forEach((fact)=>{ if(fact.ambiguous) corrections[fact.tariff_extraction_fact_id]={normalized_value:fact.normalized_value,confidence:1}; }); await action('reviewTariff',{tariff_source_id:tariff.tariff_source_id,approve:true,corrections},'LOCAL_MANAGER'); } catch(e){handle(e);} }
async function matchOptions() { try { const data=await action('matchOptions',{inquiry_id:$('match-inquiry').value}); if(data.candidates&&data.candidates[0]) $('option-id').value=data.candidates[0].commercial_option_id; } catch(e){handle(e);} }
async function findMoreOptions() { try { await action('findMoreOptions',{inquiry_id:$('match-inquiry').value,rejected_option_ids:list('CommercialOption').filter((x)=>x.state==='REJECTED').map((x)=>x.commercial_option_id)}); } catch(e){handle(e);} }
async function selectOption() { try { await action('selectOption',{commercial_option_id:$('option-id').value}); } catch(e){handle(e);} }
async function createQuote() { try { const input={commercial_option_id:$('option-id').value,client_id:$('inquiry-client').value,pricing_context_type:$('quote-context').value,discount:'0.00'}; if($('quote-cost').value) input.supplier_cost_total=$('quote-cost').value; const data=await action('createQuotation',input); $('quote-id').value=data.quotation_id; } catch(e){handle(e);} }
async function approveQuote() { try { const quote=latest('Quotation'); if(!quote) throw new Error('Create a quotation first.'); await action('approveQuotation',{quotation_id:quote.quotation_id},'LOCAL_MANAGER'); } catch(e){handle(e);} }
async function createBooking() { try { const quote=latest('Quotation'); if(!quote||quote.status!=='APPROVED') throw new Error('Approve the quotation first. Current quotation state is ' + (quote&&quote.status || 'missing') + '.'); const data=await action('createBooking',{quotation_id:quote.quotation_id,client_id:quote.client_id,travel_start:$('inquiry-start').value,travel_end:$('inquiry-end').value},'LOCAL_STAFF'); $('booking-id').value=data.booking_id; $('payment-booking').value=data.booking_id; await action('createBookingItem',{booking_id:data.booking_id,service_type:'PACKAGE',description:'Selected tariff/package option',supplier_id:$('tariff-supplier').value,selling_price:quote.client_total,supplier_cost:quote.supplier_cost_total,currency:quote.currency},'LOCAL_STAFF'); } catch(e){handle(e);} }
async function confirmCommitment() { try { const booking=latest('Booking'); if(!booking) throw new Error('Create a Booking record first.'); await action('confirmCommitment',{booking_id:booking.booking_id},'LOCAL_MANAGER'); } catch(e){handle(e);} }
async function requestSupplier() { try { const booking=latest('Booking'); if(!booking) throw new Error('Create a Booking record first.'); const items=list('BookingItem').filter((x)=>x.booking_id===booking.booking_id); const data=await action('createSupplierBooking',{booking_id:booking.booking_id,supplier_id:$('tariff-supplier').value,booking_item_ids:items.map((x)=>x.booking_item_id)},'LOCAL_STAFF'); $('supplier-booking-id').value=data.supplier_booking_id; } catch(e){handle(e);} }
async function createPayable() { try { const sb=latest('SupplierBooking'); if(!sb) throw new Error('Request a Supplier reservation first.'); const data=await action('createSupplierPayable',{supplier_booking_id:sb.supplier_booking_id,booking_id:latest('Booking').booking_id,amount:$('payable-amount').value,currency:'PHP'},'LOCAL_STAFF'); $('payable-id').value=data.supplier_payable_id; await action('approveSupplierPayable',{supplier_payable_id:data.supplier_payable_id},'LOCAL_MANAGER'); } catch(e){handle(e);} }
async function executeSupplierPayment() { try { const payable=latest('SupplierPayable'); if(!payable) throw new Error('Create and approve a Supplier Payable first.'); await action('executeSupplierPayment',{supplier_payable_id:payable.supplier_payable_id,amount:$('payable-amount').value},'LOCAL_MANAGER'); } catch(e){handle(e);} }
async function recordPayment() { try { const booking=$('payment-booking').value||latest('Booking')&&latest('Booking').booking_id; const data=await action('recordClientPayment',{booking_id:booking,amount:$('payment-amount').value,currency:'PHP',actual_sent_at:$('payment-sent').value,proof_reference:$('payment-proof').value}); $('payment-id').value=data.payment.client_payment_id; } catch(e){handle(e);} }
async function verifyPayment() { try { await action('verifyClientPayment',{client_payment_id:$('payment-id').value||latest('ClientPayment').client_payment_id},'LOCAL_MANAGER'); } catch(e){handle(e);} }
async function allocatePayment() { try { const payment=latest('ClientPayment'); await action('allocatePayment',{client_payment_id:$('payment-id').value||payment.client_payment_id,allocations:[{booking_id:$('payment-booking').value||latest('Booking').booking_id,amount:$('payment-amount').value}]},'LOCAL_STAFF'); } catch(e){handle(e);} }
async function amendBooking() { try { const booking=latest('Booking'); const changes={}; if($('amend-price').value) changes.current_price=$('amend-price').value; if($('amend-cost').value) changes.current_supplier_cost=$('amend-cost').value; if(!Object.keys(changes).length) changes.travel_start=$('inquiry-start').value; await action('amendBooking',{booking_id:booking.booking_id,changes,reason:$('amend-reason').value},'LOCAL_STAFF'); } catch(e){handle(e);} }
async function requestRefund() { try { const booking=latest('Booking'); await action('requestRefund',{booking_id:booking&&booking.booking_id,amount:$('refund-amount').value,currency:'PHP',reason:'Synthetic refund request'},'LOCAL_STAFF'); } catch(e){handle(e);} }
async function executeRefund() { try { const refund=latest('RefundAdjustment'); if(!refund) throw new Error('Create a refund draft first.'); await action('executeRefund',{refund_adjustment_id:refund.refund_adjustment_id},'LOCAL_STAFF'); } catch(e){handle(e);} }
async function createTask() { try { await action('createTask',{booking_id:latest('Booking')&&latest('Booking').booking_id,description:$('task-description').value,assigned_to:'LOCAL_STAFF'},'LOCAL_STAFF'); } catch(e){handle(e);} }
async function createDeparture() { try { await action('createDeparture',{name:$('departure-name').value,state:'DRAFT'},'LOCAL_STAFF'); } catch(e){handle(e);} }
async function resetSynthetic() { if(!window.confirm('Reset only the local synthetic Phase 1 test case?')) return; try { await action('resetSyntheticTestCase',{},'LOCAL_STAFF'); sessionEvents=[]; renderEvents(); setBanner('✓ Local synthetic test case reset. Production data and migrations were not touched.','ok'); } catch(e){handle(e);} }
loadState().catch(handle);
