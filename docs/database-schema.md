# WMIT Database Schema

## Status

This is the **Version 1.4.0 quotation, itinerary, and payment-conversion model**, implemented locally in `src/models/schema.js`. It is a preliminary Google Sheets-ready contract, not a production database and not a claim about final WMIT policy. It must be validated against real WMIT records when Google Workspace access becomes available.

Google Sheets would use one sheet per table, stable text IDs as primary keys, and one record per row. The common audit columns are `created_at`, `created_by`, `updated_at`, `updated_by`, and `record_version` unless noted otherwise.

## Conventions

- IDs are immutable; row numbers are never identifiers.
- Dates use `YYYY-MM-DD`; date-times use ISO date-time values.
- Amounts are non-negative operational amounts with a separate three-letter currency.
- Names are descriptive; relationships use IDs.
- A blank optional relationship means “not known or not applicable,” not “automatically unrelated.”
- Status lists are preliminary and are not final WMIT operating rules.

## Version 1.4 additions

- `Quotations.payment_currency_policy` stores client-facing payment-currency wording.
- `Quotations.itinerary` stores preliminary client-facing itinerary text.
- `Payments.amount` and `Payments.currency` represent the actual amount and currency received or paid.
- Client payments may additionally store `invoice_currency`, `invoice_amount`, `exchange_rate`, `exchange_rate_source`, and `exchange_rate_date` so USD invoices can accept PHP installments without losing the original payment facts.
- The local model does not look up BDO rates automatically. A staff member must enter and retain the rate snapshot used for each converted payment.

## Entity contract

The following is the executable field contract. Fields marked **required** are required when a record is created. Audit fields are omitted from the tables below for readability but remain required in the executable schema.

### Master data

| Sheet | Primary ID | Required fields | Optional fields / relationships |
|---|---|---|---|
| Clients | `client_id` (`CLIENT-000001`) | `client_type`, `legal_name`, `display_name`, `status` | email, phone, country, `source_lead_id` → Lead, notes |
| Contacts | `contact_id` (`CONTACT-000001`) | `owner_type`, `owner_id`, `contact_type`, `contact_value`, `is_primary`, `status` | notes; owner is Client or Supplier |
| Travelers | `traveler_id` (`PASSENGER-YYYY-000001`) | `first_name`, `last_name`, `status` | `client_id` → Client, date of birth, nationality, notes |
| Suppliers | `supplier_id` (`SUPPLIER-000001`) | `supplier_type`, `legal_name`, `display_name`, `status` | country, email, payment terms, notes. Supplier type remains text so new categories do not require a schema change. |

### Sales

| Sheet | Primary ID | Required fields | Optional fields / relationships |
|---|---|---|---|
| Leads | `lead_id` (`LEAD-YYYY-000001`) | received time, source, lead type, contact name, status | Client, Contact, Traveler references; company/agency; destination; travel dates; pax; requirements; assignment; notes |
| Quotations | `quotation_id` (`QUOTATION-YYYY-000001`) | `lead_id` → Lead, quotation date, currency, cost/markup/fees/tax/discount/client totals, status | Client/Contact; destination; travel dates; pax; inclusions; exclusions; payment terms; assignment; notes |
| Quotation Items | `quotation_item_id` (`QUOTATION_ITEM-YYYY-000001`) | `quotation_id` → Quotation, service type, description, quantity, unit cost, unit selling price, currency | Supplier; markup; line order; service dates; notes |

Quotation items use an extensible preliminary service list: Flight, Hotel, Transfer, Tour, Land Arrangement, Ticket, Other. Service-specific flight/hotel tables are intentionally not included.

### Operations

| Sheet | Primary ID | Required fields | Optional fields / relationships |
|---|---|---|---|
| Bookings | `booking_id` (`BOOKING-YYYY-000001`) | client, booking date, currency, client total, status | quotation, contact, departure; travel dates; destination; pax snapshot; supplier cost total; assignment; notes |
| Booking Travelers | `booking_traveler_id` (`BOOKING_TRAVELER-YYYY-000001`) | booking, traveler, `is_primary` | traveler role, notes. Unique pair: booking + traveler. |
| Booking Items | `booking_item_id` (`BOOKING_ITEM-YYYY-000001`) | booking, service type, description, quantity, currency, status | quotation item, supplier, service dates, supplier cost, selling price, supplier reference, notes |
| Departures | `departure_id` (`DEPARTURE-YYYY-000001`) | name, destination, departure type, start date, readiness percent, status | end date, capacity, assignment, notes. Bookings may optionally reference a departure. |

Booking Travelers and Booking Items are detail/relationship rows. Traveler identity is not copied into a Booking, and supplier identity is referenced by ID where known.

### Supplier-side commercial records

| Sheet | Primary ID | Required fields | Optional fields / relationships |
|---|---|---|---|
| Supplier Tariffs | `supplier_tariff_id` (`SUPPLIER_TARIFF-YYYY-000001`) | supplier, review status, lifecycle status | source Document; destination, package, duration, hotel, room type, validity, pax limits, adult/child rates, supplements, surcharges, meals, land-only rate, inclusions/exclusions, cancellation terms |
| Supplier Bookings | `supplier_booking_id` (`SUPPLIER_BOOKING-YYYY-000001`) | supplier, service description, status | optional WMIT Booking; supplier reference; cost/currency; deposit/balance; deposit and final-payment due dates; confirmation date; confirmation Document; notes |
| Supplier Booking Items | `supplier_booking_item_id` (`SUPPLIER_BOOKING_ITEM-YYYY-000001`) | supplier booking, booking item | allocated supplier cost, currency, notes. Unique pair: supplier booking + booking item. |

`SupplierBooking` is a WMIT-side procurement/confirmation record. It does not contact or purchase from a supplier. One WMIT Booking may have zero or many Supplier Bookings. A Supplier Booking may cover multiple Booking Items through the join table.

### Finance

| Sheet | Primary ID | Required fields | Optional fields / relationships |
|---|---|---|---|
| Invoices | `invoice_id` (`INVOICE-YYYY-000001`) | immutable unique invoice number, client, invoice date, currency, subtotal, discount, fees, tax, total, amount paid, balance due, status | primary `booking_id`, contact, due date, notes |
| Invoice Items | `invoice_item_id` (`INVOICE_ITEM-YYYY-000001`) | invoice, description, quantity, unit price, amount, currency | booking item, booking, notes |
| Invoice Bookings | `invoice_booking_id` (`INVOICE_BOOKING-YYYY-000001`) | invoice, booking | relationship type, notes. Unique pair: invoice + booking. |
| Payments | `payment_id` (`PAYMENT-YYYY-000001`) | payment direction (`FROM_CLIENT` or `TO_SUPPLIER`), payment date, amount, currency, method, status | client/invoice/booking for receipts; supplier/supplier booking/booking for supplier payments; reference, notes |

The Invoice `booking_id` is a convenient primary/reference booking for simple cases. `Invoice Bookings` is the normalized relationship for invoices covering multiple bookings. Payments may be unallocated to an invoice or booking until WMIT confirms the actual allocation process.

This is operational finance tracking, not accounting, tax, receivables, payables, or refund software.

### Documents and work

| Sheet | Primary ID | Required fields | Optional fields / relationships |
|---|---|---|---|
| Documents | `document_id` (`DOCUMENT-YYYY-000001`) | external file ID, filename, source type, document type, extraction status, status | source name, file URL, one primary related entity, confidence, received/processed times, notes |
| Document Links | `document_link_id` (`DOCUMENT_LINK-YYYY-000001`) | document, related entity type, related entity ID | relationship type, notes. Unique triple: document + entity type + entity ID. |
| Tasks | `task_id` (`TASK-YYYY-000001`) | title, priority, status | controlled related entity type/ID, description, assignee, due time |

Document source and document type are separate. A Document stores metadata, not PDF binary content. `Document Links` permits one reviewed document to be related to several controlled records, such as a supplier voucher, Supplier Booking, Booking, and Booking Item.

## Preliminary lifecycle values

- Lead: New, Contacted, Qualified, Quoted, Won, Lost, Closed.
- Quotation: Draft, Approved, Sent, Accepted, Rejected, Expired.
- Booking: Draft, Pending Confirmation, Confirmed, Cancelled, Completed.
- Supplier Booking: Draft, Requested, Pending Confirmation, Confirmed, Cancelled, Completed.
- Invoice: Draft, Approved, Sent, Partially Paid, Paid, Overdue, Cancelled.
- Payment: Pending Verification, Verified, Rejected, Reversed.
- Departure: Draft, Open, Ready, Departed, Completed, Cancelled.
- Task: Open, In Progress, Blocked, Completed, Cancelled.

These are deliberately small preliminary lists. Detailed readiness, refund, amendment, and accounting states require WMIT validation.

## Data ownership

- Client, Contact, Traveler, and Supplier identity are master data.
- Lead, Quotation, Booking, Supplier Booking, Invoice, Payment, Document, and Task are operational records.
- Quotation Items, Booking Travelers, Booking Items, Supplier Booking Items, Invoice Items, Invoice Bookings, and Document Links are transaction/detail relationships.
- Totals remain stored because calculation/reconciliation workflows are not yet implemented; future finance logic must reconcile them against detail rows and payments.
- Extraction results and match suggestions remain review objects, not authoritative business rows.

## What remains unverified

The model does not yet decide whether WMIT permits multiple clients per traveler, multiple bookings per quotation, invoices spanning multiple clients, supplier references spanning bookings, amendments/refunds, or a formal payment allocation process. Those decisions require actual WMIT workflow and Workspace discovery.
