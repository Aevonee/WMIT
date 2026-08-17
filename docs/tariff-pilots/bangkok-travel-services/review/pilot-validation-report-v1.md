# Bangkok Travel Services Pilot Validation Report v1

Date: 2026-08-13

## Result

**PASS WITH TARGETED CHANGES**.

The real Bangkok Travel Services DOCX does not require a business-architecture redesign. The pilot required and now has a supplier-specific native DOCX extraction adapter, matrix-cell representation, explicit ambiguity gates, candidate-level matching, `Find More Options` exclusions, and real-document regression tests.

The source file under `source/` was not modified.

## Implemented pilot changes

- Added `src/document-intelligence/bangkok-travel-services.js`.
  - Reads native DOCX OOXML without OCR.
  - Preserves source checksum, tables, rows, cells, merged-cell metadata, and raw table review data.
  - Extracts 560 pilot rate components from the supplied file.
  - Preserves hotel, region, room/category, duration, occupancy, source wording, inclusions, and supplier-condition content.
  - Splits explicit slash-separated TWN/TRP cells into distinct twin/triple components.
  - Flags combined single-value TWN/TRP cells for review.
  - Flags missing table currency and rate unit instead of guessing.

- Updated `src/phase1/runtime.js`.
  - Requires explicit review of ambiguous currency/unit facts before trusted activation.
  - Carries confirmed currency/unit into extracted rate components.
  - Matches candidate options at rate-cell granularity rather than summing every matching rate in a tariff.
  - Preserves rate-cell provenance in the Commercial Option and quotation.
  - Supports `findMoreOptions` and excludes previously presented or explicitly rejected/unavailable/superseded options.
  - Keeps missing optional client requirements from eliminating every candidate while preserving supplied conditions when the requirement is known.
  - Refuses calculation when a selected rate remains untrusted or unresolved.

- Added `tests/integration/bangkok-travel-services-pilot.test.js` with real-source tests for extraction, trust blocking, matrix calculation, requirements-first multiple candidates, Find More Options, provenance, itinerary content, and no-match/unreviewed safety.

## Acceptance results

| Pilot criterion | Result after targeted changes | Notes |
|---|---|---|
| Real supplier document ingestion | PASS | Native OOXML extraction works for the supplied DOCX. |
| Reliable extraction or clear limitation | PASS WITH LIMITATION | Tables and text are extracted; page coordinates remain layout-derived because DOCX pagination is not directly encoded in OOXML. |
| Human correction/review | PASS THROUGH CONTROLLED REVIEW API | Corrections and confirmed rate IDs are retained and required for activation. The existing browser form remains synthetic/local and is not a production document-review UI. |
| Trusted tariff lifecycle | PASS | Unreviewed source cannot match; ambiguous currency/unit and marked rate cells block trust. |
| Conditional/matrix representation | PASS FOR BANGKOK PILOT | Hotel, region, duration, room/category, occupancy, validity, notes, and rate-cell provenance are preserved. |
| Explicit units | PASS | Source ambiguity blocks trust; pilot test confirms an explicit staff correction is required. |
| Requirements-first matching | PASS | Requirements are supplied first; supplier scope remains optional. |
| Multiple candidates | PASS | Candidate options are generated without automatic selection. |
| Exclusion explanations | PASS FOR PILOT | Candidate-level source signatures and exclusion reasons are returned for Find More Options. |
| Staff selection | PASS | Selection is explicit and remains required before quotation calculation. |
| Pilot-specific calculation | PASS AFTER STAFF CONFIRMATION | The test confirms the AIRA 3D2N SGL cell at USD 350 per person calculates to USD 700 for two pax after staff confirms USD and PER_PERSON. This is a pilot confirmation fixture, not an inferred source fact. |
| Itinerary preservation | PASS | Transfer, tour, inclusion, and supplier-condition text remain attached to the extraction/option. |
| Quotation provenance | PASS FOR PILOT | Source checksum, table/row/cell provenance, selected rate, and calculation lines are retained. |
| No automatic quotation | PASS | Upload/extraction never creates a client-facing quotation. |
| No invented supplier rules | PASS | Missing currency/unit and ambiguous combined occupancy values fail closed. |

## OCR decision

OCR was not used. The supplied file contains native selectable Word text and structured Word tables. PaddleOCR was not introduced. Any later scanned supplier source should use a replaceable provider boundary and be evaluated separately.

## Remaining limitations and safe behavior

1. The real source does not explicitly identify the currency or rate-unit basis for the table. The pilot tests use a staff correction (`USD`, `PER_PERSON`) only to prove the downstream behavior. WMIT must confirm those facts with the supplier/staff before using this version commercially.
2. DOCX page assignment is layout-derived. Table/row/cell provenance is retained; exact rendered page coordinates require a document renderer if WMIT later needs them.
3. The local Phase 1 browser form is still a synthetic-data workspace. The real-document review was validated through the controlled extraction/review structures and automated tests, not through a production-ready upload UI.
4. The parser is intentionally Bangkok-specific. It is not a universal tariff language and must not be generalized to other suppliers without a separate pilot.
5. The source contains supplier cancellation, child, group, transfer, tour, and payment conditions. The pilot preserves them as reviewable supplier content; it does not invent automated policy calculations where the source wording is insufficient.

## Tests

### Before pilot changes

- 78 tests passed.
- 0 failures.

### After pilot changes

- 82 tests passed.
- 0 failures.
- 4 new Bangkok pilot tests added.
- Existing synthetic Phase 1 tests passed.
- Six-case regression tests passed.
- Dangerous financial/tariff/Expo/authorization/amendment/refund/idempotency tests passed as part of the full suite.

No existing test was deleted or weakened.

## Items deliberately not changed

- No source document modification.
- No production migration or production data access.
- No Google Workspace or external availability/booking integration.
- No OCR dependency.
- No universal tariff model.
- No automatic supplier selection, quotation generation, pricing decision, payment allocation, refund, or supplier payment.
- No new promotion type.
- No unrelated application or legacy-schema redesign.

## Final stop condition

Stop after this pilot validation. Do not proceed to broader supplier/tariff implementation until WMIT reviews the unresolved source facts—especially table currency and rate unit—and separately authorizes any next supplier pilot or real operational UI work.
