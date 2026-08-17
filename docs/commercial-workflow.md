# WMIT Commercial Workflow

Status: preliminary local model, Version 1.4.0; not production-ready.

## Workflow

```text
Lead
  ↓ optional
Quotation → Quotation Items
  ↓ optional / human decision
Booking → Booking Travelers + Booking Items
  ↓
Supplier Booking(s) → Supplier Booking Items + supplier documents
  ↓
Travel / Departure
  ↓
Reviewed Documents
  ↓
Invoice → Invoice Items → Payment(s)
  ↓
Completion
```

A quotation may expire or be rejected without a Booking. A Booking may be created without a Quotation when the actual WMIT process requires it. These are supported as preliminary possibilities; the exact conversion policy is unverified.

## Client-side and supplier-side records

`Booking` represents WMIT's operational commitment to the client. `BookingItem` represents each service sold to the client, such as a flight, hotel, tour, transfer, visa, insurance, land arrangement, or other service.

`SupplierBooking` represents WMIT's separate transaction with a supplier/operator. It records the supplier reference, cost, deposit, deadlines, confirmation state, and related supplier documents. `SupplierBookingItem` connects it to one or more Booking Items. This avoids assuming one Booking has one supplier or that one supplier confirmation covers one item only.

## Document-to-record control

```text
Document → classification → Extraction Result → review
         → deterministic match suggestions → human approval
         → controlled relationship or business-record write
```

The local extractor may identify candidates, but it cannot create Clients, Bookings, Supplier Bookings, Invoices, Payments, or links. A suggestion is not a booking, confirmation, invoice, or payment.

## Preliminary lifecycle values

Lead: New, Contacted, Qualified, Quoted, Won, Lost, Closed.  
Quotation: Draft, Approved, Sent, Accepted, Rejected, Expired.  
Booking: Draft, Pending Confirmation, Confirmed, Cancelled, Completed.  
Supplier Booking: Draft, Requested, Pending Confirmation, Confirmed, Cancelled, Completed.  
Invoice: Draft, Approved, Sent, Partially Paid, Paid, Overdue, Cancelled.  
Payment: Pending Verification, Verified, Rejected, Reversed.

These lists are intentionally preliminary. Detailed rules for amendments, refunds, deposits, supplier cancellation, and post-travel completion require WMIT validation.

## What the reference documents informed

The fixtures support separate WMIT invoices/quotations from supplier quotations/tariffs and tour-operator vouchers/memos. They also demonstrate that a supplier-side document can contain commercial rates, payment terms, hotel/service details, passengers, flights, rooming, and itinerary data. The fixtures do not define the final WMIT data-entry process.

## Synthetic workflow scenarios

The local tests cover four deliberately fictional paths:

- A: WMIT quotation → Booking → Supplier Booking → supplier voucher metadata → Invoice → Payment.
- B: supplier quotation metadata → WMIT Quotation → Booking → Supplier Booking.
- C: tour-operator memo metadata → Supplier Booking → Booking.
- D: WMIT invoice metadata → Booking → multiple Payments.

These scenarios prove relationship handling only. They do not claim that the real WMIT process creates records in exactly this order.

## Intentionally not automated

No quotation generation, booking creation, supplier procurement, invoice posting, payment posting, external communication, or Google Workspace action is implemented in this phase.
