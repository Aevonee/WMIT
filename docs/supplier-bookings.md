# WMIT Supplier Bookings

This file is retained as a quick sheet-level reference. The workflow and relationship rules are in `docs/supplier-booking-workflow.md`.

Status: preliminary local entity only.

| Column | Type | Required | Meaning |
|---|---|---:|---|
| supplier_booking_id | ID | Yes | Immutable primary ID |
| supplier_id | ID | Yes | Supplier master reference |
| booking_id | ID | No | WMIT Booking when known |
| supplier_reference | Text | No | Supplier/operator reference |
| service_description | Text | Yes | Human-readable service |
| supplier_cost | Amount | No | Operational supplier cost |
| currency | Currency | No | Cost currency |
| deposit | Amount | No | Known deposit |
| balance | Amount | No | Known balance |
| deposit_due_date | Date | No | Deposit deadline |
| final_payment_due_date | Date | No | Final-payment deadline |
| confirmation_date | Date | No | Confirmation date if known |
| status | Controlled value | Yes | Draft, Requested, Pending Confirmation, Confirmed, Cancelled, Completed |
| confirmation_document_id | ID | No | Optional Document reference |
| notes | Text | No | Context and exceptions |

The `Supplier Booking Items` sheet connects one Supplier Booking to one or more Booking Items. The `Document Links` sheet supports reviewed links to the supplier, supplier booking, booking, or item.

Creating a local record does not contact a supplier, purchase travel, or confirm availability.
