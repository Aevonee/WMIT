# WMIT Business Rules Requiring Real WMIT Validation

Status: Open questions; do not convert these into code assumptions yet.

## Customer and people

- Can one client have multiple contacts, and can more than one be primary?
- Can one traveler belong to multiple clients, or must a traveler have one owning client?
- Can the client, contact, and traveler be the same person?
- What traveler information is required before a booking can be confirmed?
- Which identity and passport fields are required, and who may access them?

## Sales

- What is the actual distinction between B2B and B2C?
- What source values are used in current records?
- Can one lead represent multiple travel parties or requests?
- Are quotations converted into bookings or recreated manually?
- Can one quotation create multiple bookings?
- What fields are actually used on current quotations?
- Are quotation totals manually approved, calculated, or both?

## Operations

- Can one booking contain multiple travelers and multiple suppliers? The model supports this; actual use is unverified.
- Are Booking Items sufficient for flights, hotels, transfers, tours, tickets, and land arrangements?
- What information is required for a Booking Item to be considered confirmed?
- How are group departures represented today?
- Can one booking belong to more than one departure or trip grouping?
- What is the operational meaning of FIT versus group departure?

## Finance

- Can one invoice cover multiple bookings?
- Can one booking produce multiple invoices?
- How are deposits represented?
- Are payments recorded before invoice creation?
- How are refunds and reversals represented?
- What fields are actually used on current invoices?
- What are the approved payment methods and verification steps?
- Are invoice totals derived from line items or manually maintained?
- What accounting or tax requirements apply? This model does not assume Philippine accounting or tax treatment.

## Documents and tasks

- Which entity should a received file be related to before human review?
- What document types and sources are actually used?
- Do tasks relate to any record type, or only selected operational types?
- Which staff identifiers should assigned_to use?

## Governance

- Which fields are master data, and which are snapshots required for historical accuracy?
- Which status changes require approval?
- Who owns corrections to client, traveler, supplier, quotation, booking, invoice, and payment data?
- What existing Sheets and invoice/quotation templates must be preserved?

These questions should be answered from read-only WMIT Workspace discovery and staff review, not generic travel-industry assumptions.
