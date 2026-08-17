# WMIT Document Intelligence — Local Prototype

Status: local prototype only  
Model status: preliminary; pending validation against real WMIT data  
Production Google Workspace access: unavailable and intentionally unused

## Purpose

This phase establishes a safe contract for turning a document into reviewable structured information. It does not create or update a Client, Booking, Invoice, Supplier Tariff, or any other authoritative business record.

The flow is:

    Document metadata
        -> deterministic classification
        -> text extraction adapter
        -> extraction result
        -> human review
        -> future controlled service operation

The extraction result is deliberately separate from the permanent schema. A parser may be wrong, incomplete, or ambiguous. It must not silently overwrite business data.

## Preliminary taxonomy

Document source and document type are separate.

| Source | Meaning |
|---|---|
| WMIT | Produced or issued by Worldmaster |
| SUPPLIER | Wholesaler, DMC, or other supplier |
| TOUR_OPERATOR | Tour-operator material |
| AIRLINE | Airline-issued material |
| HOTEL | Hotel-issued material |
| CLIENT | Supplied by a client |
| UNKNOWN | Source has not been verified |

Supported types are WMIT_QUOTATION, WMIT_INVOICE, WMIT_VOUCHER, SUPPLIER_QUOTATION, SUPPLIER_TARIFF, TOUR_OPERATOR_VOUCHER, TOUR_OPERATOR_MEMO, AIRLINE_TICKET, HOTEL_VOUCHER, and UNKNOWN.

Classification is deterministic and uses source/brand evidence separately from document-purpose evidence. The classifier scores structural signals, returns evidence and competing classifications, and does not use filenames. A source hint may be supplied as weak supporting context, but strong document content takes precedence.

Important rules:

- WMIT branding, contact details, and signatures support WMIT source.
- Supplier names/domains and supplier commercial structures support SUPPLIER.
- Service vouchers, passenger manifests, guide/emergency contacts, and group-tour memos support TOUR_OPERATOR.
- Flight details alone do not support AIRLINE or AIRLINE_TICKET.
- An airline ticket requires stronger ticket-specific evidence such as an e-ticket/boarding-pass structure with ticket, PNR, or booking-reference context.

The eight local fixture ground truths are recorded in src/document-intelligence/reference-manifest.js.

## Document record

The Documents sheet model stores metadata only:

- document_id
- document_type
- source_type
- source_name
- file_name
- external_file_id
- optional file_url
- controlled related entity type and ID
- extraction status and confidence
- review-oriented status
- received and processed timestamps
- notes

PDF or image bytes are not stored in the operational database.

## Extraction result

src/document-intelligence/extraction-result.js creates an in-memory result with:

- document and classification metadata
- one entry per extracted field
- raw_value
- normalized_value
- confidence
- optional source page
- warnings
- field review status
- overall review_outcome
- classification confidence
- classification evidence
- competing classifications when close

The current outcomes are:

- AUTO_ACCEPTABLE: no warnings and all extracted fields meet the prototype threshold.
- NEEDS_REVIEW: a field is uncertain, missing, or warning-producing.
- FAILED: no usable input was available or the text adapter failed.

Confidence never authorizes a financial or operational change. Any future write must go through a controlled service and explicit business validation.

## Normalization

The normalizer preserves raw text and adds a normalized value. It currently supports:

- flight numbers such as 5J-188 -> 5J188
- flight extraction requiring airline-code or explicit flight context
- common currency aliases to three-letter codes
- amounts with commas or three-digit spaces, such as PHP 84 991, to numbers
- passenger, room, and quantity counts
- ISO and common written dates to YYYY-MM-DD

Numeric dates are interpreted in day-month-year order by this prototype and must be reviewed if a source document uses another convention. This is intentionally conservative. It does not infer missing dates, currencies, people, prices, or relationships.

Rooming vocabulary includes room type/share type, rooming text, occupants, room number, and occupancy count. These remain extraction fields only; they are not copied into Traveler master data.

## Deterministic text adapter

src/document-intelligence/pdf-text.js is the replaceable parser boundary:

    processFile()
        -> extractTextFromFile()
        -> pdftotext, when available
        -> Python pdfplumber fallback, when available
        -> processText()

The parser adapter is the only layer aware of PDF tooling. No PDF dependency is used by classification or business services. If neither parser is available, processFile() returns FAILED with a clear dependency warning and no business record is written. The adapter does not upload files or access Google Workspace.

The eight reference PDFs are now present locally and readable. The fixture tests run them through processFile() using the available Python pdfplumber fallback. The parser remains optional for other environments.

## Review policy

Missing fields are represented as null and receive a warning such as Not found. Ambiguous pattern matches retain their candidate value but are marked for review. The prototype should fail closed when an input file cannot be read.

The current extraction rules are intentionally conservative around financial amounts, dates, references, and flight numbers. OCR artifacts and complex tables may still produce incomplete or low-confidence values. Extracted values remain review data and are not authoritative financial or operational facts.

## Intentionally unbuilt

- OCR
- LLM extraction
- Google Drive or Gmail ingestion
- automatic entity matching
- automatic business-record writes
- financial posting
- booking creation
- client or supplier communication

## Commercial workflow handoff

Phase 2C adds a review-only deterministic matching layer in `src/document-intelligence/matcher.js`:

```text
Document → classification → Extraction Result → match suggestions
         → human approval → controlled relationship/business-record write
```

The matcher compares extracted references, names, suppliers, dates, destinations, and passenger counts against local repository records. It returns `MATCH`, `POSSIBLE_MATCH`, or `NO_MATCH` with evidence. It never writes a Document Link or modifies a Client, Booking, Supplier Booking, Invoice, or Payment. Even an exact reference match remains a suggestion until a future controlled workflow obtains human approval.
