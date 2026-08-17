# Bangkok Travel Services Real-Tariff Pilot Assessment v1

Date: 2026-08-13

Status: Pre-change assessment. No application code has been changed for this pilot.

Recommendation: **PASS WITH TARGETED CHANGES**.

The approved tariff architecture survives the real document. The current implementation does not yet ingest this DOCX or expose enough structured review detail to prove the pilot. The required work is a supplier-pilot extraction/review adapter and focused tariff tests; it is not a redesign into a universal tariff language.

## Evidence and baseline

- Pre-change test suite: **78 passed, 0 failed**.
- Source directory contains one immutable source file: `2025 FREE AND EASY PACKAGE April to October.docx`.
- The DOCX reports 3 pages, contains 2 Word tables, and contains 1 embedded media asset.
- OOXML inspection found selectable text and table structure; it is not scan-only.
- The document contains 36 rows in the first table and 58 rows in the second, with up to 8 cells per row and merged header cells.
- Direct body text includes supplier details, validity, inclusions, transfer conditions, child policy, itinerary/tour descriptions, group policy, cancellation policy, payment condition, and exceptions.
- The source states validity as `1st April to 31st October 2025`.
- The rate tables have package-duration columns for 3D2N, 4D3N, and an extra night, and room/occupancy columns for SGL and TWN/TRP.
- The source contains dollar-denominated incidental values in policy/tour text, but the table rate cells do not state a clear currency basis. The table rate unit is also not explicit in the extracted wording. These must remain review-required, not inferred.

The existing `src/document-intelligence/pipeline.js` returns a failed extraction for the DOCX with the warning that only PDF and text fixture files are supported. This is the current implementation boundary, not evidence that OCR is required.

## A. Document inventory

| File | Type/pages | Text/tables | Real tariff structures found |
|---|---|---|---|
| `2025 FREE AND EASY PACKAGE April to October.docx` | DOCX, 3 pages | Selectable OOXML text; 2 tables; 1 embedded media asset; no scan-only page evidence | Bangkok free-and-easy packages across multiple hotel/region sections; 3D2N, 4D3N, extra-night rates; SGL and TWN/TRP values; room/category notes; included round-trip airport transfer and half-day city tour; validity; minimum-pax tour exception; child, group, cancellation, payment, and non-refundable conditions |

The tables include hotel-dependent rates and room/occupancy-dependent values. Duration is represented by columns rather than by one explicit row field. Some cells contain two slash-separated values for TWN/TRP and therefore must not be stored as one amount.

## B. Existing extraction method

The reusable foundation is the existing extraction-result and review model in `src/document-intelligence/`. It already supports raw/normalized values, confidence, source page, warnings, and human review outcomes.

The current file pipeline is PDF/text-oriented. Its DOCX result is a safe failed extraction rather than a false trusted result. The Phase 1 runtime currently accepts already-structured `extraction_facts`, `rate_components`, and `itinerary_components`; it does not parse DOCX tables itself.

## C. OCR necessity

OCR is **not required for this supplied document**. Native DOCX OOXML extraction is the preferred first method because it can preserve Word table rows, cells, merged headers, and paragraph text without introducing OCR character uncertainty.

Visual rendering was not available in the local environment because the document-rendering dependencies are absent. That limits visual confirmation of layout, but the OOXML evidence is sufficient to establish that the source is machine-readable and structurally tabular. The pilot must still retain the original file and require staff review of extracted table semantics.

## D. PaddleOCR assessment

PaddleOCR is not added for this pilot. Adding OCR to a machine-readable DOCX would add uncertainty without solving the current problem. If a later supplier source is scanned or mixed, OCR may be evaluated behind the existing replaceable extraction-provider boundary. The tariff model must not depend on PaddleOCR.

## E. Tariff complexity inventory

The real file contains the following pilot-relevant dimensions and rules:

- hotel and regional hotel section;
- hotel room/category labels such as 4-star/5-star and STD/SUP/DLX-style labels;
- occupancy/room arrangement: SGL and TWN/TRP;
- package duration: 3 days/2 nights, 4 days/3 nights, and extra 1 night;
- slash-separated TWN/TRP values that require separate twin and triple interpretations;
- explicit exceptions such as NO TRP, NO ABF, SET ABF, FIT/GROUP, and similar hotel-specific notes;
- included round-trip airport transfer, with SIC/joined-transfer wording;
- half-day city tour content, including Packages A, B, and C;
- minimum-pax condition for some city-tour hotel areas;
- flight-arrival matching condition for shared-room complimentary transfers;
- child/free-of-charge/child-with-extra-bed conditions;
- package validity;
- group free-place policy;
- cancellation/no-show/non-refundable conditions;
- local travel insurance and passport-submission timing;
- optional-tour and tour-surcharge content;
- payment-condition text.

The file does not provide an explicit table-wide currency label or an unambiguous table-rate unit in the extracted wording. Those are review-blocking facts for trusted pricing.

## F. Representation gaps

The current conditional `conditions` object can represent several dimensions, but the pilot needs a structured representation that keeps each supplier condition intact. At minimum, each extracted rate must be represented as a separate component or explicitly nested matrix cell with:

- source document/page/table/row/cell provenance;
- region and hotel;
- room/category label;
- occupancy/arrangement (`SGL`, `TWN`, `TRP`) where separable;
- duration (`3D2N`, `4D3N`, `EXTRA_1_NIGHT`);
- amount as an exact money value only after currency is confirmed;
- unit status and quantity driver;
- source wording and notes;
- inclusions/exclusions and applicability conditions;
- review status and ambiguity warnings.

The `TWN/TRP` slash cell cannot be flattened into one generic amount. The current calculator also does not understand room arrangement as a matching/quantity dimension unless the pilot adapter turns it into explicit conditional rate components.

This is a targeted pilot representation, not a universal tariff language.

## G. Matching gaps

The current matcher is requirements-first and does not auto-select, which is correct. It can evaluate basic exact conditions and pax/date/night bounds.

For this pilot it must additionally:

- match hotel/region, duration, room arrangement, and relevant package conditions;
- create candidates at a useful option granularity rather than one option containing every matching rate from the entire tariff;
- carry inclusion/exclusion and source explanations;
- identify unresolved unit/currency/condition warnings;
- support exclusion of rejected, unavailable, superseded, and duplicate options for `Find More Options`.

The existing runtime has no dedicated `Find More Options` exclusion contract. This is a focused implementation gap.

## H. Calculation gaps

The existing money arithmetic and common units are reusable. The current calculation path is not yet safe for this source because:

- the table currency is not explicit;
- the table unit is not explicit;
- slash-separated twin/triple values need separate components;
- room arrangement and package duration need to select the correct matrix cell;
- a package's included transfer/tour must not accidentally become a second priced line;
- child, extra-bed, group, and minimum-pax rules require reviewable conditions rather than guessed quantities.

The pilot must refuse trusted calculation until ambiguous currency/unit facts are confirmed by staff. It must not use the incidental `$` policy values as evidence that all table rates are USD.

## I. Human-review gaps

The trust lifecycle exists and is valuable: uploaded tariffs begin untrusted, and unresolved low-confidence/ambiguous facts block trust. However, the current review implementation is fact-oriented and the local UI does not yet provide a table-aware inspection view for hotel, duration, room, occupancy, source wording, and cell-level corrections.

The pilot needs a review projection that lets staff inspect the extracted table/matrix, see ambiguity flags, correct or confirm the affected facts/rates, and then activate the trusted version. Raw extraction must remain retained alongside corrections.

The current review path must also treat unresolved rate-unit and currency facts as trust blockers, not merely as ordinary warnings.

## J. Provenance gaps

The current quotation can retain a source reference and rate calculation lines. For real-document validation, provenance must be more precise: source filename, source hash or immutable reference, page, table, row, cell/column, source wording, extracted value, correction history, and selected condition set.

Without this, staff cannot reproduce why a particular hotel/duration/occupancy amount was used.

## K. Itinerary gaps

The source contains useful included content and tour descriptions, including airport transfer, half-day city tour, Packages A/B/C, regional tour descriptions, and conditions. The implementation must preserve these as itinerary/inclusion content associated with the tariff and selected option.

The source does not appear to be a full day-by-day priced itinerary. Included itinerary text must remain distinguishable from rate components and optional tour surcharges. It must not be discarded or silently treated as a priced service.

## L. Exact implementation changes required

Only the following targeted changes are required for this pilot:

1. Add a native DOCX tariff extraction adapter that reads OOXML text and tables, preserves merged headers and source locations, and emits the existing reviewable extraction structures.
2. Add a Bangkok pilot mapping layer for duration columns, hotel/region rows, room/category labels, SGL/TWN/TRP values, notes, inclusions, and conditional policies. Keep it supplier-specific and behind an adapter boundary.
3. Add explicit unresolved fact handling for table currency and rate unit. Neither may be defaulted into trusted pricing from this document.
4. Extend pilot matching to select the correct hotel/region, duration, occupancy, and room conditions and to return multiple option candidates with explanations.
5. Add `Find More Options` exclusion inputs/behavior for rejected, unavailable, superseded, duplicate, and previously presented options.
6. Add table-aware review data/UI or an equivalent controlled review artifact so staff can inspect and correct the matrix before activation.
7. Preserve cell-level provenance and correction history through the selected option and quotation calculation lines.
8. Add Bangkok pilot fixtures and tests without modifying the immutable source file or weakening existing tests.

## M. Exact architecture changes required

**None identified.** The approved architecture already requires supplier-source preservation, conditional/matrix pricing, review before trust, requirements-first matching, multiple candidates, human selection, explicit units, itinerary preservation, and provenance.

The current implementation needs targeted capability additions to demonstrate those decisions against DOCX material. No universal tariff schema, new business rule, or broader supplier architecture is justified by this one pilot.

## N. Items that must not be changed

- Do not add OCR for this DOCX merely because it is a document.
- Do not infer currency or rate unit.
- Do not flatten the matrix into one hotel/duration-independent rate table.
- Do not implement a universal tariff language.
- Do not add global supplier search or best-supplier ranking.
- Do not generate a quotation on upload.
- Do not add new promotion types.
- Do not modify legacy data/schema or migrate production data.
- Do not add Google Workspace, external availability/booking, production authentication, or autonomous AI.
- Do not turn included itinerary text into an invented price.
- Do not alter unrelated application areas.

## O. Pilot test cases

The pilot-specific tests must include:

1. DOCX inventory and native extraction: tables, paragraphs, merged headers, page/section provenance.
2. Extraction retention: original source, raw extracted cells, normalized pilot representation, and review corrections all remain available.
3. Trust gate: ambiguous table unit/currency prevents activation and client-facing quotation until staff confirms them.
4. Matrix selection: a representative hotel with 3D2N SGL, 3D2N TWN, 3D2N TRP, 4D3N, and extra-night conditions selects only the requested matrix cell.
5. Hotel exception: NO TRP/NO ABF/FIT/GROUP-style notes remain visible and affect matching or review state as applicable; no rule is invented where wording is unclear.
6. Included services: round-trip SIC transfer and half-day tour remain attached to the option without becoming an unpriced or duplicate rate line.
7. Tour condition: minimum-pax and flight-arrival conditions are shown as warnings/conditions and are not silently ignored.
8. Requirements-first matching: realistic Bangkok requirements return multiple candidates; no supplier or option is auto-selected.
9. Find More Options: rejected/unavailable/superseded/duplicate options are excluded or labelled and new alternatives are returned when available.
10. No-match behavior: no trusted match produces a clear no-match result with manual-research/supplier-quote follow-up available.
11. Reproducible calculation: source location, condition set, unit, quantity, supplier cost, and calculation lines are retained for a confirmed pilot rate.
12. WMIT pricing: approved markup/fee/Expo context is preserved and explained; no future promotion type is introduced.
13. Quotation provenance: selected option, tariff version, source cell, corrections, and pricing rule snapshot remain linked.
14. Unreviewed tariff: cannot be used for client-facing quotation.
15. Idempotent extraction/upload/review retries do not duplicate trusted tariff versions or rate components.

## P. Acceptance criteria result

| Criterion | Result before targeted pilot changes | Evidence/interpretation |
|---|---|---|
| Real supplier document ingestion | FAIL | Existing file adapter supports PDF/text only and fails DOCX safely. |
| Reliable extraction or clear limitation | PARTIAL | OOXML proves the source is extractable, but no current DOCX table adapter exists. |
| Human correction/review | PARTIAL | Generic fact review exists; table/matrix review and rate ambiguity gates need pilot support. |
| Trusted tariff lifecycle | PARTIAL | Lifecycle exists, but current review does not sufficiently gate unresolved rate unit/currency/matrix semantics. |
| Conditional/matrix representation | PARTIAL | Basic conditions exist; hotel × duration × occupancy cell selection and slash-cell separation need support. |
| Explicit units | FAIL FOR THIS SOURCE | Source wording is not explicit; current path can accept a unit supplied by the caller rather than force confirmation. |
| Requirements-first matching | PASS IN PRINCIPLE / PARTIAL FOR PILOT | Architecture and basic matcher are correct; pilot dimensions and candidate granularity need support. |
| Multiple candidates | PASS IN PRINCIPLE / PARTIAL FOR PILOT | No auto-selection exists; real candidate construction is not yet implemented. |
| Exclusion explanations | PARTIAL | Warnings exist, but full candidate exclusion and Find More Options behavior is missing. |
| Staff selection | PASS IN PRINCIPLE | Explicit selection exists and quotation requires a selected option. |
| Pilot-specific calculation | FAIL BEFORE REVIEW | Currency/unit and matrix-cell interpretation are unresolved; no safe calculation can be claimed yet. |
| Itinerary preservation | PARTIAL | Runtime supports itinerary components, but DOCX inclusion/tour extraction is absent. |
| Quotation provenance | PARTIAL | Source references exist; cell-level/table-level provenance is required. |
| No automatic quotation | PASS | Upload does not create a client quotation. |
| No invented supplier rules | PASS AS A SAFETY REQUIREMENT / GAP TO ENFORCE | The pilot must block ambiguous unit/currency and unsupported policy interpretation. |

## Q. Recommendation and stop condition

**PASS WITH TARGETED CHANGES.**

The architecture is suitable for the Bangkok pilot. The implementation is not yet sufficient to claim that it handles the real file. Complete only the exact pilot changes in section L, run the existing suite plus Bangkok-specific and dangerous-behavior tests, and report the result. Do not proceed to broader tariff or supplier implementation after this pilot.

If staff cannot confirm the table currency, table rate unit, or a matrix condition from the source, leave the affected tariff version in `NEEDS_REVIEW`/`BLOCKED` and report the unresolved business decision. Do not guess.

