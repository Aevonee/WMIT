# WMIT Tariff Automation Architecture v1

> **NON-EXECUTABLE SUPPORTING TARIFF DETAIL:** [BASELINE-HANDOFF.md](BASELINE-HANDOFF.md) and [implementation-plan-v1.2.md](implementation-plan-v1.2.md) control. This file cannot require supplier-first search, a universal tariff table, or unreviewed pricing.

> **Superseded detail:** [baseline-v1.1.md](baseline-v1.1.md) is the current authority. This document remains supporting detail only.

Status: **DEFINITIVE DESIGN FOR FUTURE IMPLEMENTATION**  
Parent authority: [baseline-v1.md](baseline-v1.md)  
This document describes the future tariff workflow only. It does not implement extraction, matching, pricing, integrations, or schema changes.

## 1. Purpose and boundaries

The system must not become `upload tariff -> AI understands it -> automatically produces a quotation`. The required staff-requirements-first sequence is: supplier file -> classify -> extract -> human/reviewable tariff record -> staff enters client requirements -> matcher searches the selected Supplier's tariff library -> multiple potential options and warnings -> draft calculation -> staff chooses an option -> WMIT pricing rules -> draft WMIT Quotation -> staff review -> final client-facing quotation.

Tariff automation exists to reduce tariff-search time and arithmetic errors while keeping staff in control of commercial decisions. A tariff is source/rate information; it is never itself a WMIT Quotation.

The intended chain is:

```text
Supplier document
  → document metadata and classification
  → extraction result with raw values, normalized values, provenance, confidence
  → reviewed structured tariff/rate data
  → supplier-scoped tariff search
  → applicable-rate candidates and warnings
  → draft cost calculation
  → configurable WMIT pricing rules
  → staff review/override
  → WMIT Quotation and client-safe output
```

Phase 1 is deliberately supplier/tariff scoped. Global search across multiple Suppliers is a later phase and is not an MVP dependency.

**Binding v1.1 correction:** the structured tariff result is not matched until staff has entered the client requirements and selected the Supplier/tariff scope. The matcher returns multiple potential options; staff selects the option before WMIT pricing rules are applied. No extracted tariff or matcher result automatically becomes a quotation.

## 2. Raw tariff intake

### Inputs — CONFIRMED

Tariff files may arrive from email, Messenger, WhatsApp, Viber, Google Drive, supplier portals, client/staff uploads, or other approved sources. The future intake boundary records the file reference without assuming that the file name is authoritative.

Minimum intake metadata:

- source channel and source actor/account where appropriate;
- supplier candidate, if known;
- received timestamp and timezone;
- file storage reference, file name, file type, size, and checksum where available;
- sensitivity classification;
- related Inquiry/Commercial Option if already known;
- ingestion actor and correlation ID.

The original file is retained. It is never overwritten by a normalized tariff row.

## 3. Classification

The document classifier distinguishes at least Supplier Tariff, Supplier Quotation, Supplier Package/source product, WMIT Quotation, WMIT Invoice, Supplier Confirmation/Voucher, and other travel documents. Classification may use content, supplier hint, and source context, but file names alone are insufficient evidence.

Classification output retains:

- chosen type and source;
- confidence and competing classifications;
- evidence/reasons;
- warnings;
- review status;
- source Document ID.

Low confidence, tied classifications, or conflicting supplier/source hints produce `Needs Review`. Classification does not create a trusted tariff or change a Booking.

## 4. Extraction result

Extraction is a reviewable intermediate result, not a direct write to the tariff library. Every extracted field retains:

- field name;
- raw source text/value;
- normalized value;
- confidence;
- source document/page/section/row/cell provenance when available;
- warnings;
- field-level review status;
- extraction run/version and actor/agent.

The extraction result can include:

- supplier, tariff name, destination, validity/effective dates;
- travel-date applicability;
- package/product reference;
- duration and nights;
- hotel, category, room type, occupancy;
- adult/child/infant rates and rules;
- meal plan;
- transfer terms;
- tour/service rates;
- supplements, compulsory charges, minimum pax/stay;
- cancellation terms;
- currency and unit basis;
- itinerary days, activities, meals, overnight, city, and notes.

Extraction warnings are first-class data. Examples: missing currency, unclear unit basis, conflicting dates, rate found in an unclear section, or an itinerary line with no rate association.

## 5. Structured tariff representation

The architecture must not model a tariff as only `service → price`. A future structured tariff library should conceptually have these layers:

### Tariff document/version

Supplier, source Document, version/revision, received date, effective date, validity window, destination/service scope, status, authority/review state, supersedes/superseded-by relationships, and overlap/conflict flags.

### Applicability conditions

Conditions that determine when a rate applies:

- destination/region;
- service type;
- travel date or date range;
- tariff validity/effective period;
- season or named supplement period;
- hotel/property/category;
- room type/occupancy;
- duration/nights;
- pax band/minimum/maximum;
- traveler type and adult/child/infant rules;
- meal plan;
- transfer direction/way and vehicle/passenger basis;
- minimum stay, compulsory services, or other supplier conditions.

### Rate component

Each component retains amount, currency, unit basis, quantity driver, service/component identity, conditions, inclusion/exclusion, source provenance, and ambiguity/review flags. Unit basis must support at least per person, per night, per room, per vehicle, per way, round trip, per group, per package, fixed amount, percentage, and “not specified/needs review.”

### Supplement/charge

Peak-season, Christmas/New Year, single-room, compulsory gala, extra-night, child, weekend, transfer, tax-like, and other charges are separate components with their own conditions and provenance.

### Itinerary

An itinerary is structured separately from rates but linked to the relevant tariff/package/version. Each day can contain day number, date or relative day, city, service/activity, meals, overnight, inclusions, and notes. Itinerary text must not be mistaken for a rate.

This is a conceptual model. The future implementation should begin with the smallest set of structured fields needed by validated supplier documents, not a universal travel-pricing language.

## 6. Validity, revisions, and overlap

Tariff validity and rate applicability are separate from extraction date and from current availability.

- A rate within validity may still have no live availability evidence.
- A requested travel date outside validity is not an automatic rejection; it is a review condition.
- The system shows the potentially relevant rate, marks it outside/uncertain validity, and requires staff confirmation or manual supplier verification.
- Revised, overlapping, or conflicting documents remain in the library.
- The system flags possible overlap using Supplier, destination/service scope, effective period, validity, and revision metadata.
- Staff chooses the authoritative source/version; the system does not silently replace or choose one.
- Superseded means no longer preferred for new matching, not deleted or invalidated historically.

## 7. Ambiguity and default interpretation

WMIT’s current defaults are:

- tariff rates are generally per person unless explicitly stated otherwise;
- transfers are generally per person per way unless explicitly stated otherwise.

These are configured assumptions, not unconditional truths. Explicit supplier wording overrides the default. If wording is ambiguous, the matched rate is flagged and the draft calculation cannot become a client-facing price without human review.

Example: `Transfer USD 50` without a clear per-person/per-vehicle or one-way/round-trip basis produces a candidate with an ambiguity warning. It does not silently calculate a total.

Other ambiguity examples:

- a rate applies to “package” but package scope is unclear;
- dates conflict between a header and a rate row;
- adult/child policy is absent;
- a supplement may be compulsory but the document wording is unclear;
- a hotel category or room occupancy is missing;
- currency is inferred only from a symbol that could mean multiple currencies.

## 8. Supplier-scoped matching

### Phase 1 — CONFIRMED MVP boundary

Historical detail only: the current contract requires staff requirements first. Supplier/tariff-scoped matching may be an optional Phase 1 technical boundary, but staff must not be required to know the correct supplier beforehand. Search returns multiple candidates and never silently selects a supplier/rate.

The result shows:

- matching and non-matching conditions;
- source tariff/version/document;
- validity status;
- rate components and unit basis;
- ambiguity/conflict warnings;
- likely availability status, if separately evidenced;
- missing inputs needed for a safe calculation.

### Phase 2 — DEFERRED

Global cross-supplier search may compare multiple Suppliers and Supplier Packages/Tariffs. It must still show alternatives rather than automatically choose cheapest, highest margin, or “best.” It is not required for MVP.

## 9. Draft cost calculation

The matcher produces one or more draft calculation candidates. Each candidate contains:

- selected tariff/version/rate components;
- conditions satisfied and conditions unresolved;
- quantities and drivers used;
- itinerary/services included;
- supplier cost by component;
- currency and conversion snapshot if conversion is required;
- missing/ambiguous/expired/outside-validity warnings;
- calculation version and timestamp.

The calculation is reproducible from source IDs, inputs, assumptions, and rule versions. It does not mutate the source tariff. It does not assert live availability.

If multiple rates match, all material matching candidates are shown. Ranking may be by explicit search relevance for staff navigation, but no ranking is a commercial recommendation or automatic selection.

## 10. WMIT pricing rules

After a staff-approved or reviewable draft cost, configurable pricing rules are applied:

- Supplier Package with supplier-provided selling price: usually use source selling price;
- specific/custom quotation: usually 30% fixed markup;
- conversion fee: BDO forex selling rate + 1.0;
- card/PayPal fee: 5%;
- variable visa-assistance fee;
- other configured service/ticketing/insurance/bank/conversion charges.

The pricing result retains rule IDs/version/effective date, supplier cost, calculated markup, fees, discounts, calculated selling price, actual quoted price, override flag, actor, timestamp, and reason. Prices are exact-money calculations; currency conversion is never silently inferred without an exchange-rate snapshot.

## 11. Staff review and override

Staff reviews:

- source/version authority;
- extracted fields and provenance;
- validity and date fit;
- unit basis and quantities;
- itinerary mapping;
- ambiguity/conflict warnings;
- supplier cost and selected candidate;
- pricing rules and fees;
- availability evidence or explicit Not Checked/Unknown state;
- client-safe wording.

Staff may override calculated price or discount. The system retains both calculated and actual values, actor, time, and reason. A review action can approve structured tariff data for library use without approving a client quotation.

Manager/Admin approval is required for configured exceptions such as material pricing override, uncertain availability claim, reserve-before-payment, or sensitive client-facing output.

## 12. Quotation production

Only after review does the system produce a WMIT Quotation. The quotation retains links to the Commercial Option, source Supplier Package/Tariff/version, extraction result, availability evidence, calculation candidate, pricing rule version, and staff decisions.

The client-facing projection contains approved services, itinerary, inclusions/exclusions, price, fees when appropriate, terms, validity, and explicit availability qualifications where needed. It excludes supplier cost, markup, internal notes, raw extraction warnings, restricted supplier information, and sensitive documents.

Sending a quotation is still a human-controlled action. The quotation does not create a Booking or Supplier Booking automatically.

## 13. Provenance and safety gates

The following chain must remain auditable:

```text
source Document
  → classification result
  → extraction run/result
  → structured tariff/version
  → match candidate
  → draft cost calculation
  → pricing result
  → reviewed WMIT Quotation
```

Safety gates:

1. no source file, no trusted structured tariff;
2. no review of ambiguous/low-confidence fields, no committed rate;
3. no date-validity review, no confirmed applicability;
4. no availability evidence, no available claim;
5. no staff review, no client-facing quotation;
6. no human selection, no commercial option commitment;
7. no explicit approval, no external booking/purchase/payment/refund.

## 14. Failure and recovery behavior

- Parser/classifier failure: retain source document, mark extraction failed, create review task.
- Low confidence: retain candidate with warnings; never silently commit.
- Conflicting revisions: show both, flag overlap, require authority choice.
- Missing input: return an incomplete draft and a task, not a guessed value.
- Outside validity: show candidate as review-only and require supplier verification.
- Repeated processing: use document/version/run identity to avoid duplicate tariff records and duplicate alerts.
- Partial extraction: preserve extracted fields and missing-field warnings; do not discard the source.
- Source replacement: create a new revision/supersession relationship, never overwrite historical provenance.

## 15. Future acceptance criteria

Before tariff automation is considered useful, future implementation must demonstrate:

- supplier-scoped search returns all relevant candidates;
- explicit unit basis and ambiguity flags prevent unsafe totals;
- validity outside the requested date is a review condition;
- revised documents remain distinguishable and conflicts are visible;
- itinerary data survives extraction as structured day information;
- calculations are reproducible and exact;
- pricing rules are configurable and versioned;
- staff can override while preserving calculated values;
- no extraction result automatically sends or commits a client quotation;
- the six real WMIT patterns can be traced from source evidence through a reviewed quotation where tariff data is involved.
