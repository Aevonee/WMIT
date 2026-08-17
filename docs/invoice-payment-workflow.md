# WMIT Invoice and Payment Workflow

Status: preliminary operational finance model; not accounting software and not production-ready.

## Structure

```text
Invoice
  ├─ Invoice Items
  ├─ Invoice Bookings (0..N)
  └─ Payments FROM_CLIENT (0..N)

Supplier Booking
  └─ Payments TO_SUPPLIER (0..N)
```

An Invoice has a convenient optional primary `booking_id` for simple cases. `Invoice Bookings` is the normalized relationship when one invoice covers multiple Bookings. Invoice Items may optionally reference a Booking or Booking Item.

Payments are independent records with an explicit `payment_direction`: `FROM_CLIENT` or `TO_SUPPLIER`. Client receipts may reference an Invoice and Booking. Supplier payments reference a Supplier Booking, Supplier, and Booking where known. Multiple payments can apply to one Invoice or Supplier Booking. The two directions must not be mixed when calculating client balances or supplier balances.

## Operational controls

- Invoice numbers are unique and immutable.
- Amounts use separate currency codes.
- Invoice totals are stored for the current operational model and should later be reconciled against Invoice Items.
- Payment records are not silently converted into verified payments; the preliminary status begins as Pending Verification.
- Supplier payment records reduce the recorded Supplier Booking balance only after the payment row is successfully created.
- Money helper functions use integer minor units and return exact decimal strings for calculations.
- Financial changes remain subject to future approval rules. This phase does not send invoices, post payments, issue refunds, or calculate tax/accounting obligations.

## Preliminary statuses

Invoice: Draft → Approved → Sent → Partially Paid/Paid/Overdue, with cancellation paths subject to business approval.  
Payment: Pending Verification → Verified, Rejected, or Reversed.

These transitions are a technical guardrail, not a confirmed WMIT finance policy.

## Reference-document implications

The WMIT invoice fixtures show invoice identifiers, client billing identity, travel/package context, totals, deposits, balances, and payment terms/history. They justify separate Invoice, Invoice Item, and Payment records but do not establish WMIT's final invoice numbering, tax, refund, allocation, or approval requirements.
