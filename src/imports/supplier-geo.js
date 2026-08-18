'use strict';

// Canonical geography for supplier records. The YUPPIES import carried
// free-text locations ("Dubai", "Istanbul", "Taipei, Taiwan"); filters need
// canonical country names. Genuinely multi-country values are left untouched
// rather than collapsed into a false single country.

const COUNTRY_FIXES = Object.freeze({
  '52 nai nam dai nang viet nam': 'Vietnam',
  'bali - indonesia': 'Indonesia',
  'dubai': 'UAE',
  'dubai, uae': 'UAE',
  'istanbul': 'Turkey',
  'new delhi': 'India',
  'palawan': 'Philippines',
  'pasay, philippines': 'Philippines',
  'sydney australia': 'Australia',
  'taipei, taiwan': 'Taiwan',
  'tokyo, japan': 'Japan'
});

const INDUSTRY_FIXES = Object.freeze({
  'airline': 'Airlines'
});

const CANONICAL_COUNTRIES = Object.freeze([
  'Philippines', 'South Korea', 'Taiwan', 'Thailand', 'Vietnam', 'UAE', 'Hong Kong', 'India',
  'Singapore', 'Slovenia', 'Albania', 'Bosnia and Herzegovina', 'Canada', 'China', 'Egypt',
  'France', 'Indonesia', 'Israel', 'Japan', 'Jordan', 'Spain', 'Switzerland', 'Australia',
  'Turkey', 'United Kingdom', 'United States', 'Malaysia', 'Cambodia', 'Laos', 'Myanmar',
  'Japan', 'Macau', 'Oman', 'Qatar', 'Saudi Arabia', 'Greece', 'Italy', 'Germany', 'Netherlands'
].filter((value, index, all) => all.indexOf(value) === index));

function canonicalFix(fixes, value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  const fixed = fixes[trimmed.toLowerCase()];
  return fixed && fixed !== trimmed ? fixed : null;
}

function buildGeoPlan(suppliers) {
  const plan = [];
  for (const supplier of suppliers || []) {
    const changes = {};
    const country = canonicalFix(COUNTRY_FIXES, supplier.country);
    if (country) changes.country = country;
    const industry = canonicalFix(INDUSTRY_FIXES, supplier.industry);
    if (industry) changes.industry = industry;
    if (Object.keys(changes).length) {
      plan.push({ supplier_id: supplier.supplier_id, display_name: supplier.display_name || supplier.supplier_id, changes });
    }
  }
  return plan;
}

function applyGeoFixes(runtime, plan, context) {
  const ctx = Object.assign({ actor: 'GEO_NORMALIZATION', correlationId: 'SUPPLIER-GEO-NORMALIZATION' }, context || {});
  const report = { updated: 0, failures: [] };
  for (const entry of plan) {
    const result = runtime.updateRecord('Supplier', entry.supplier_id, entry.changes, ctx);
    if (!result.ok) {
      report.failures.push({ supplier_id: entry.supplier_id, error: result.error });
      continue;
    }
    report.updated += 1;
  }
  return report;
}

module.exports = { COUNTRY_FIXES, INDUSTRY_FIXES, CANONICAL_COUNTRIES, buildGeoPlan, applyGeoFixes };
