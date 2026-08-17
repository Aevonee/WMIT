# WMIT Supplier Commercial Model

Status: preliminary local model, Version 1  
Validation: pending real supplier-document and Google Workspace discovery

## Purpose

Supplier documents show that a rate is not always one package and one price. The preliminary model preserves commercial attributes without implementing a quotation or pricing engine.

## Supplier Tariffs

The Supplier Tariffs sheet uses supplier_tariff_id as its immutable primary key. It can represent:

- supplier and source document
- destination and package name
- duration, hotel, and room type
- validity dates
- minimum and maximum pax
- adult and child rates
- single supplement
- peak-season period and surcharge
- child policy
- meal inclusion
- optional-tour surcharge
- land-only rate
- currency
- inclusions, exclusions, cancellation terms
- review status and lifecycle status

Amounts remain separate from currency. Descriptive commercial terms remain text until real documents justify more normalization.

## Review state

New tariff information is expected to begin as review_status = Needs Review and status = Draft. Approved is a business decision, not an extraction result. Expired and archived states are operational controls and are not automatically calculated by this prototype.

## Supplier Booking

The Supplier Bookings sheet is a separate operational record. It supports:

- supplier
- optional WMIT booking
- supplier reference
- service description
- supplier cost and currency
- deposit and balance
- deposit and final-payment deadlines
- confirmation date
- status
- optional confirmation-document reference
- notes

Supplier Booking Items provide the normalized link from one Supplier Booking to one or more Booking Items, including an optional allocated supplier cost. This is intentionally separate from the Booking Item's expected supplier.

One WMIT booking may have multiple supplier bookings, and a supplier booking may remain unlinked while it is being researched. This relationship is a preliminary design and must be checked against actual WMIT practice.

## Deliberately not implemented

- rate selection
- validity matching
- peak-season calculation
- child pricing calculation
- markup rules
- supplier purchasing
- payable accounting
- automatic quotation generation

The model stores source facts first. Pricing behavior should be designed only after real supplier tariffs and current quotation practices are inspected.
