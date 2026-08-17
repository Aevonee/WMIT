# WMIT Supplier Booking Workflow

Status: preliminary local workflow; no supplier communication or purchasing is performed.

## Purpose

A Supplier Booking is a first-class operational record for WMIT's side of a supplier transaction. It is separate from a client-facing Booking.

```text
Booking Item(s)
       ↓ research/request
Supplier Booking
       ↓ supplier reference / confirmation / reviewed document
Supplier Booking Item(s)
```

One WMIT Booking may have zero or many Supplier Bookings. One Supplier Booking may cover one or many Booking Items through `Supplier Booking Items`. Different Booking Items in the same WMIT Booking may use different Suppliers.

The Operations Workspace creates one Supplier Booking per assigned service so confirmation remains service-specific. Confirming a Flight Booking Item does not confirm a Land Arrangement or another service. Older grouped reservations use a split-confirmation path that creates or reuses a single-item confirmation record.

## Fields

The local model supports:

- supplier booking ID
- supplier ID
- optional WMIT booking ID
- supplier reference
- service description
- supplier cost and currency
- deposit and balance
- deposit due date and final payment due date
- confirmation date
- status
- optional confirmation document reference
- notes and audit fields

The join table supports allocated supplier cost and currency for each linked Booking Item where allocation is known.

## Statuses

Preliminary statuses are Draft, Requested, Pending Confirmation, Confirmed, Cancelled, and Completed. Current legal transitions are deliberately limited. The actual meanings of “Requested,” “Confirmed,” deposit paid, amendment, cancellation, and completion must be checked with WMIT.

## Documents

Supplier quotations, tariffs, tour-operator vouchers, memos, confirmations, invoices, and receipts remain Documents until reviewed. A reviewed document can have controlled `Document Links` to Supplier, Supplier Booking, Booking, and Booking Item. It is not automatically converted into a Supplier Booking.

## Open WMIT questions

- Is a Supplier Booking created when a request is sent, only after confirmation, or both?
- Can one supplier reference span multiple WMIT Bookings?
- Are deposit/balance values supplier payable amounts, client collection amounts, or both?
- How are changes, cancellations, refunds, and credits represented?
- Which document is authoritative when a quotation, memo, voucher, and invoice conflict?
