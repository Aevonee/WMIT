'use strict';

// Transform a YUPPIES Supplier and Partner List snapshot (data/imports/*.json,
// produced by the read-only browser extraction) into a WMIT supplier import
// plan: one Supplier per unique company, one SupplierContact per source row
// that carries contact information. Pure module — no I/O, no runtime — so the
// mapping is fully testable on synthetic data before touching a database.

const BLANK_TOKENS = new Set(['', 'n/a', 'na', 'none', '-', '—', 'tbd']);

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text || BLANK_TOKENS.has(text.toLowerCase())) return null;
  // Untrusted external input: cap length so a corrupt source row cannot stuff
  // arbitrarily large blobs into WMIT records.
  return text.length > 300 ? text.slice(0, 300) + '…' : text;
}

function companyKey(name) {
  return String(name).toLowerCase().replace(/\s+/g, ' ').trim();
}

function cleanEmail(value) {
  const text = normalizeText(value);
  if (!text || !text.includes('@') || /\s/.test(text)) return null;
  return text.length > 120 ? null : text;
}

function capabilityTokens(values) {
  const tokens = [];
  for (const value of values) {
    const text = normalizeText(value);
    if (!text) continue;
    for (const raw of text.split(/[,;/·|]+/)) {
      const token = raw.replace(/\s+/g, ' ').trim();
      if (!token || BLANK_TOKENS.has(token.toLowerCase())) continue;
      if (!tokens.some((existing) => existing.toLowerCase() === token.toLowerCase())) tokens.push(token);
    }
  }
  return tokens.slice(0, 6);
}

function contactFromRow(row) {
  const name = normalizeText(row['Contact Name']);
  const email = cleanEmail(row['Email']);
  const phone = normalizeText(row['Contact Number']);
  const viber = normalizeText(row['Viber']);
  const whatsapp = normalizeText(row['WhatsApp']);
  const position = normalizeText(row['Position / Title']);
  if (!name && !email && !phone && !viber && !whatsapp) return null;
  return {
    name: name || 'General inquiries',
    contact_type: position || 'Directory contact',
    email: email || undefined,
    phone: phone || undefined,
    viber: viber || undefined,
    whatsapp: whatsapp || undefined,
    source_row_id: row.ID
  };
}

function buildImportPlan(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.rows)) {
    throw new Error('Snapshot is missing a rows array.');
  }
  const rejected = [];
  const groups = new Map();
  for (const row of snapshot.rows) {
    const displayName = normalizeText(row && row['Company Name']);
    if (!displayName) {
      rejected.push({ source_row_id: row ? row.ID : null, reason: 'Missing Company Name' });
      continue;
    }
    const key = companyKey(displayName);
    if (!groups.has(key)) groups.set(key, { display_name: displayName, rows: [] });
    groups.get(key).rows.push(row);
  }

  const companies = [];
  for (const group of groups.values()) {
    const rows = group.rows;
    const first = (field) => {
      for (const row of rows) {
        const value = normalizeText(row[field]);
        if (value) return value;
      }
      return null;
    };
    const firstEmail = () => {
      for (const row of rows) {
        const email = cleanEmail(row['Email']);
        if (email) return email;
      }
      return null;
    };
    const contacts = rows.map(contactFromRow).filter(Boolean);
    companies.push({
      display_name: group.display_name,
      legal_name: group.display_name,
      country: first('Country') || undefined,
      website: first('Website') || undefined,
      address: first('Address') || undefined,
      industry: first('Industry') || undefined,
      services: first('Services Offered') || undefined,
      destinations: first('Destinations') || undefined,
      other_details: first('Other Details') || undefined,
      primary_email: firstEmail() || undefined,
      capabilities: capabilityTokens(rows.flatMap((row) => [row['Industry'], row['Services Offered']])),
      source_row_ids: rows.map((row) => row.ID),
      contacts
    });
  }

  return {
    source: snapshot.source || null,
    source_url: snapshot.source_url || null,
    extracted_at: snapshot.extracted_at || null,
    rejected,
    companies
  };
}

// Execute a plan against a runtime through the ordinary business functions.
// Companies whose normalized name already exists are skipped, never modified.
// Idempotency keys make a re-run after partial failure safe.
function runImport(runtime, plan, context) {
  const report = { created_suppliers: 0, created_contacts: 0, existing_suppliers: 0, failures: [] };
  const ctx = Object.assign({ actor: 'YUPPIES_IMPORT', correlationId: 'YUPPIES-SUPPLIER-IMPORT' }, context || {});
  for (const company of plan.companies) {
    const existing = runtime.list('Supplier', (supplier) => String(supplier.display_name || '').trim().toLowerCase() === company.display_name.toLowerCase());
    if (existing.length) {
      report.existing_suppliers += 1;
      continue;
    }
    const created = runtime.createSupplier(Object.assign({}, company, {
      contacts: undefined,
      source_row_ids: undefined,
      idempotency_key: 'YUPPIES-S-' + company.source_row_ids[0]
    }), ctx);
    if (!created.ok) {
      report.failures.push({ company: company.display_name, stage: 'supplier', error: created.error });
      continue;
    }
    report.created_suppliers += 1;
    for (const contact of company.contacts) {
      const contactResult = runtime.createSupplierContact({
        supplier_id: created.data.supplier_id,
        name: contact.name,
        contact_type: contact.contact_type,
        email: contact.email,
        phone: contact.phone,
        viber: contact.viber,
        whatsapp: contact.whatsapp,
        idempotency_key: 'YUPPIES-C-' + contact.source_row_id
      }, ctx);
      if (!contactResult.ok) {
        report.failures.push({ company: company.display_name, stage: 'contact:' + contact.name, error: contactResult.error });
        continue;
      }
      report.created_contacts += 1;
    }
  }
  return report;
}

module.exports = { buildImportPlan, runImport, normalizeText, cleanEmail, capabilityTokens };
