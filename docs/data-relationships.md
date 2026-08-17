# WMIT Data Relationships

Status: Version 1.4.0 quotation, itinerary, and payment-conversion model; preliminary and pending real WMIT validation.

## Main flow

```text
Lead
  └─ 0..N Quotations
       └─ 0..N Quotation Items
            └─ optional source for Booking Items

Client ── 0..N Contacts
       └─ 0..N Travelers
       └─ 0..N Leads / Quotations / Bookings / Invoices / Payments

Booking
  ├─ 0..N Booking Travelers ── Traveler
  ├─ 0..N Booking Items ── optional Supplier
  ├─ 0..N Supplier Bookings
  │    └─ 1..N Supplier Booking Items ── Booking Item
  ├─ optional Departure
  └─ 0..N Invoice Bookings ── Invoice

Invoice
  ├─ 0..N Invoice Items
  ├─ 0..N Payments
  └─ 0..N Invoice Bookings ── Booking

Document
  └─ 0..N Document Links ── controlled WMIT or supplier record
```

## Relationship table

| From | Relationship | To | Implementation |
|---|---|---|---|
| Client | one-to-many, preliminary | Contact | Contact owner type/id |
| Client | one-to-many, optional client ownership | Traveler | Traveler.client_id |
| Lead | one-to-many | Quotation | Quotation.lead_id |
| Quotation | one-to-many | Quotation Item | QuotationItem.quotation_id |
| Quotation | optional source | Booking | Booking.quotation_id; conversion behavior is unverified |
| Booking | many-to-many | Traveler | BookingTraveler, unique pair |
| Booking | one-to-many | Booking Item | BookingItem.booking_id |
| Booking Item | optional many-to-one | Supplier | BookingItem.supplier_id |
| Booking | one-to-many, optional | Supplier Booking | SupplierBooking.booking_id |
| Supplier Booking | many-to-many with Booking Items | Booking Item | SupplierBookingItem, unique pair |
| Booking | many-to-many with Invoice | Invoice | InvoiceBooking, unique pair |
| Invoice | one-to-many | Invoice Item | InvoiceItem.invoice_id |
| Invoice | one-to-many, optional allocation | Payment | Payment.invoice_id |
| Payment | optional reference | Booking | Payment.booking_id |
| Supplier | one-to-many | Supplier Booking | SupplierBooking.supplier_id |
| Document | many-to-many, controlled | supported entities | DocumentLink polymorphic validation |
| Task | optional controlled relationship | supported entities | Task.related_type/related_id |

## Why the supplier-side relationship is separate

`BookingItem.supplier_id` identifies the expected or known supplier for a client service. `SupplierBooking` records WMIT's separate supplier-side transaction, including supplier reference, cost, deposit, deadlines, confirmation, and documents. A single WMIT Booking can therefore contain hotel, transport, and tour services purchased through different suppliers, while one supplier confirmation can cover multiple Booking Items.

## Document review boundary

```text
Document
  → classification
  → Extraction Result
  → human review
  → match suggestions
  → explicit approval
  → controlled business-record write
```

Extraction results and suggestions do not create links. `DocumentLink` is only written by a controlled service after the target IDs and relationship have been reviewed.

## Unverified relationship questions

- Can one Traveler be associated with multiple Clients?
- Can one Quotation produce multiple Bookings or revisions?
- Can one Invoice cover bookings for more than one Client?
- Can one Supplier reference cover several WMIT Bookings?
- Can one Supplier Booking cover multiple Booking Items in current WMIT practice?
- Are all payments eventually allocated to invoices, or can some remain booking/client deposits?
- Does a Departure contain Bookings, Travelers, or both as the operational source of truth?
