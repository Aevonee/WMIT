# WMIT Operational Data Model

Version: **1.4.0 quotation, itinerary, and payment-conversion model**  
Status: **preliminary local model — pending validation against actual WMIT Google Workspace data**

## Purpose

This model connects the existing foundation and document-intelligence prototype to the commercial path WMIT appears to operate:

```text
Lead → Quotation → optional Booking → Supplier Booking(s)
     → travel/departure → reviewed Documents → Invoice/Payment → completion
```

The arrows describe possible information flow, not automatic actions. No records are created from PDFs automatically, and no supplier/client communication is performed.

## Core distinctions

- Client is the customer/account relationship.
- Contact is a communication person or channel belonging to a Client or Supplier.
- Traveler is the person who travels and can appear in many Bookings.
- Booking is WMIT's client-side operational record.
- Booking Item is a client service within a Booking.
- Supplier Booking is WMIT's supplier-side transaction and confirmation record.
- Invoice and Payment are operational finance records, not an accounting ledger.
- Document is file metadata; extraction results are review objects and do not replace authoritative records.

## Normalization decisions

The model uses join tables instead of embedded arrays for relationships that may be many-to-many:

- Booking Travelers
- Supplier Booking Items
- Invoice Bookings
- Document Links

This keeps the model usable in Google Sheets and avoids copying traveler names, supplier names, or invoice data into repeated text fields.

## Preliminary versus verified

The eight reference PDFs verify that WMIT and suppliers/operators use different document styles, that quotations/invoices contain client-facing commercial information, and that supplier-side material includes references, rates, deposits, deadlines, vouchers, and group operational details. They do **not** verify WMIT's complete database rules, payment allocation, amendment process, refund process, or current spreadsheet layout.

Those business rules remain explicitly unverified until real WMIT workflow and Google Workspace discovery are available.

## Safety boundary

Only local repositories and synthetic records are used. The service layer validates IDs/references, logs actions, enforces immutable IDs and preliminary lifecycle transitions, and rejects inconsistent supplier-booking relationships. The matching layer returns suggestions only. There is no production Google connection.
