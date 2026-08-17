'use strict';

const DOCUMENT_TYPES = Object.freeze([
  'WMIT_QUOTATION', 'WMIT_INVOICE', 'WMIT_VOUCHER',
  'SUPPLIER_QUOTATION', 'SUPPLIER_TARIFF',
  'TOUR_OPERATOR_VOUCHER', 'TOUR_OPERATOR_MEMO',
  'AIRLINE_TICKET', 'HOTEL_VOUCHER', 'UNKNOWN'
]);

const SOURCE_TYPES = Object.freeze([
  'WMIT', 'SUPPLIER', 'TOUR_OPERATOR', 'AIRLINE', 'HOTEL', 'CLIENT', 'UNKNOWN'
]);

const REVIEW_OUTCOMES = Object.freeze(['AUTO_ACCEPTABLE', 'NEEDS_REVIEW', 'FAILED']);

function textOf(value) {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function has(text, pattern) {
  return pattern.test(text);
}

function scoreSource(text, sourceHint) {
  const scores = Object.fromEntries(SOURCE_TYPES.map((source) => [source, 0]));
  const evidence = Object.fromEntries(SOURCE_TYPES.map((source) => [source, []]));

  if (SOURCE_TYPES.includes(sourceHint)) {
    scores[sourceHint] += 2;
    evidence[sourceHint].push('caller supplied source hint');
  }

  if (has(text, /world\s*master(?:\s+international)?(?:\s+travel)?|worldmasteritravel|worldmaster international travel/)) {
    scores.WMIT += 8;
    evidence.WMIT.push('World Master branding or organization name');
  }
  if (has(text, /worldmasteritravel@|www\.worldmaster|facebook\.com\/worldmaster|world master international travel reserves/)) {
    scores.WMIT += 3;
    evidence.WMIT.push('World Master contact or signature details');
  }

  if (has(text, /uos travel corp|nexplorer\.asia|nexplorer\b/)) {
    scores.SUPPLIER += 8;
    evidence.SUPPLIER.push('supplier organization or supplier-domain evidence');
  }
  if (has(text, /supplier\s+quotation|supplier\s+tariff|tour fee\s*\/\s*pax\s*\/\s*package|peak season surcharge/)) {
    scores.SUPPLIER += 3;
    evidence.SUPPLIER.push('supplier commercial document structure');
  }

  if (has(text, /service voucher|tour operator|tour notice|memo for .*tour|travel partners/)) {
    scores.TOUR_OPERATOR += 6;
    evidence.TOUR_OPERATOR.push('operator voucher, memo, or tour-management language');
  }
  if (has(text, /passenger\s+manifest|emergency contact|english-speaking guide|guide info|welcome board/)) {
    scores.TOUR_OPERATOR += 2;
    evidence.TOUR_OPERATOR.push('group-tour operational details');
  }

  if (has(text, /(?:e-ticket|electronic ticket|boarding pass|passenger itinerary receipt|airline-issued).*(?:ticket number|pnr|booking reference)|(?:ticket number|pnr|booking reference).*(?:e-ticket|electronic ticket|boarding pass)/)) {
    scores.AIRLINE += 7;
    evidence.AIRLINE.push('airline-issued ticket terminology');
  }
  if (has(text, /hotel voucher|hotel confirmation/)) {
    scores.HOTEL += 7;
    evidence.HOTEL.push('hotel-issued voucher or confirmation terminology');
  }

  return { scores, evidence };
}

function scoreDocumentTypes(text, sourceType) {
  const scores = Object.fromEntries(DOCUMENT_TYPES.map((type) => [type, 0]));
  const evidence = Object.fromEntries(DOCUMENT_TYPES.map((type) => [type, []]));

  const add = (type, points, reason) => {
    scores[type] += points;
    evidence[type].push(reason);
  };

  if (sourceType === 'WMIT') {
    add('WMIT_QUOTATION', 4, 'document is issued by WMIT');
    add('WMIT_INVOICE', 4, 'document is issued by WMIT');
  }
  if (sourceType === 'SUPPLIER') {
    add('SUPPLIER_QUOTATION', 4, 'document source is a supplier');
    add('SUPPLIER_TARIFF', 4, 'document source is a supplier');
  }
  if (sourceType === 'TOUR_OPERATOR') {
    add('TOUR_OPERATOR_VOUCHER', 3, 'document source is a tour operator');
    add('TOUR_OPERATOR_MEMO', 3, 'document source is a tour operator');
  }

  if (has(text, /invoice details|invoice number/)) {
    add('WMIT_INVOICE', 7, 'explicit invoice identifier or invoice-details section');
  } else if (has(text, /\binvoice\b|billed to/)) {
    add('WMIT_INVOICE', 4, 'invoice terminology or billing section');
  }
  if (sourceType === 'WMIT' && has(text, /total amount due|amount due/)) {
    add('WMIT_INVOICE', 3, 'invoice amount due structure');
  }
  if (sourceType === 'WMIT' && has(text, /payment history|deposit required|first payment|final payment/)) {
    add('WMIT_INVOICE', 4, 'invoice payment schedule or history');
  }

  if (has(text, /\bquotation\b|\bquote\b|\bproposal\b|thank you for your inquiry/)) {
    add('WMIT_QUOTATION', sourceType === 'WMIT' ? 5 : 1, 'quotation or client proposal language');
    add('SUPPLIER_QUOTATION', sourceType === 'SUPPLIER' ? 5 : 1, 'quotation language');
  }
  if (has(text, /dear\s+[^.]{2,}|sincerely,/)) {
    add('WMIT_QUOTATION', sourceType === 'WMIT' ? 3 : 1, 'client-facing addressee or signature structure');
  }
  if (has(text, /valid for \d+ hours|50% deposit|remaining balance must be paid|inclusions:|exclusions:/)) {
    add('WMIT_QUOTATION', sourceType === 'WMIT' ? 2 : 1, 'client quotation terms and inclusions/exclusions');
  }

  if (has(text, /validity\s*:|tour fee\s*\/\s*pax\s*\/\s*package|package extension|single room|single supplement|peak season surcharge|minimum\s+\d+\s+pax/)) {
    add('SUPPLIER_TARIFF', 7, 'rate-library, validity, pax-band, or supplement structure');
  }
  if (has(text, /booking terms|final payment.*before|adult\s+\$|agent commission/)) {
    add('SUPPLIER_QUOTATION', 3, 'supplier commercial pricing and payment terms');
  }

  if (has(text, /service voucher/)) {
    add('TOUR_OPERATOR_VOUCHER', 8, 'service voucher heading');
  }
  if (has(text, /passenger\s+\*|hotel name|inclusive date|emergency contact|itinerary|meal:/)) {
    add('TOUR_OPERATOR_VOUCHER', 3, 'passenger, hotel, itinerary, and meal structure');
  }

  if ((sourceType === 'TOUR_OPERATOR' || sourceType === 'UNKNOWN') && has(text, /memo for .*tour|^memo for|tour notice|no\.?\s*of pax|flight details:.*\b(?:vj|5j|pr|ca)\s*\d{2,4}/)) {
    add('TOUR_OPERATOR_MEMO', 8, 'group memo and tour-operational structure');
  }
  if (has(text, /hotels?:|guide info|welcome board|day0?1|meal&hotel/)) {
    add('TOUR_OPERATOR_MEMO', 2, 'group hotel, guide, itinerary, or meal structure');
  }

  if (has(text, /(?:e-ticket|electronic ticket|boarding pass|passenger itinerary receipt|airline-issued).*(?:ticket number|pnr|booking reference)|(?:ticket number|pnr|booking reference).*(?:e-ticket|electronic ticket|boarding pass)/)) {
    add('AIRLINE_TICKET', 8, 'explicit airline-issued ticket evidence');
  }
  if (has(text, /hotel voucher|hotel confirmation/)) {
    add('HOTEL_VOUCHER', 8, 'explicit hotel voucher or confirmation evidence');
  }

  return { scores, evidence };
}

function choose(scores, evidence, kind) {
  const ranked = Object.entries(scores)
    .filter(([name]) => name !== 'UNKNOWN')
    .sort((a, b) => b[1] - a[1]);
  const winner = ranked[0] && ranked[0][1] > 0 ? ranked[0] : ['UNKNOWN', 0];
  const runnerUp = ranked[1] || ['UNKNOWN', 0];
  const gap = winner[1] - runnerUp[1];
  let confidence = 0.35;
  if (winner[0] !== 'UNKNOWN') {
    if (winner[1] >= 12 && gap >= 4) confidence = 0.97;
    else if (winner[1] >= 8 && gap >= 3) confidence = 0.92;
    else if (winner[1] >= 6 && gap >= 2) confidence = 0.84;
    else confidence = 0.68;
  }
  const competing = ranked.slice(0, 3)
    .filter(([name]) => name !== winner[0])
    .map(([name, score]) => ({ classification: name, score }));
  return {
    value: winner[0],
    confidence,
    evidence: evidence[winner[0]] || [],
    competing,
    kind
  };
}

function classifyDocument(input) {
  const value = input || {};
  const text = textOf(value.text);
  const warnings = [];
  const sourceScores = scoreSource(text, value.sourceHint);
  const source = choose(sourceScores.scores, sourceScores.evidence, 'source');
  const typeScores = scoreDocumentTypes(text, source.value);
  const document = choose(typeScores.scores, typeScores.evidence, 'document');

  if (!text) warnings.push('Document text was not available; classification is source-hint based only.');
  if (source.value === 'UNKNOWN') warnings.push('Source could not be determined confidently.');
  if (document.value === 'UNKNOWN') warnings.push('Document type could not be determined confidently.');
  if (document.competing.length && document.competing[0].score === typeScores.scores[document.value]) {
    warnings.push('Competing document classifications are tied; human review is required.');
  }

  return {
    documentType: document.value,
    sourceType: source.value,
    confidence: Math.min(source.confidence, document.confidence),
    sourceConfidence: source.confidence,
    documentTypeConfidence: document.confidence,
    evidence: [...source.evidence, ...document.evidence],
    competingClassifications: document.competing,
    warnings
  };
}

module.exports = { DOCUMENT_TYPES, SOURCE_TYPES, REVIEW_OUTCOMES, classifyDocument };
