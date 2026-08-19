# WMIT Business Architecture Validation — Financial Operating Model

> **SUPERSEDED by [baseline-v1.md](baseline-v1.md).** Retained as financial discovery evidence; the baseline controls confirmed rules and unresolved policy boundaries.

> **NON-EXECUTABLE:** Do not treat examples, recommendations, or old unknowns here as policy. [BASELINE-HANDOFF.md](BASELINE-HANDOFF.md) controls current financial behavior.

Status: operational model only; not accounting software

## Scope

This model is for operational visibility over client charges, client money, supplier obligations, supplier payments, and margin. It does not define accounting revenue recognition, tax treatment, statutory reporting, payroll, or financial statements.

## Core concepts

### Client Selling Price

The total amount WMIT presents or charges to the client for the selected services and applicable fees, after discounts and other approved adjustments.

It does not mean money received or profit.

### Supplier Cost

The expected or confirmed direct amount payable to suppliers or other direct service sources for a Booking Item or Booking.

Quoted supplier cost and confirmed supplier cost may differ and should not silently overwrite each other.

### Fees

Separately identified WMIT or pass-through charges, such as service fees, visa assistance fees, ticketing fees, insurance, bank charges, or conversion fees.

The treatment of each fee in profit reporting is **UNKNOWN / NEEDS WMIT VALIDATION.**

### Discounts

Approved reductions to the client selling price. A discount should remain visible rather than being hidden by changing the supplier cost or markup.

### Taxes

Amounts identified as taxes or tax-like charges. The operational model may store them separately, but it must not infer Philippine tax treatment.

### Client Payment

Money received or reported from a client through bank transfer, cash, card, GCash, PayPal, or another method.

Each payment should preserve:

- amount received;
- currency;
- method;
- date;
- reference/evidence;
- verification state;
- any exchange-rate snapshot;
- refund/reversal status.

### Payment Allocation

The portion of a Client Payment applied to a specific Invoice, Booking obligation, deposit, installment, or other client balance.

One payment may eventually be allocated across several obligations only if WMIT approves that practice.

### Client Outstanding Balance

The current client obligation less verified and allocated client payments.

```text
Client outstanding balance
= client amount due - verified allocated client payments - approved credits/refunds
```

This is not necessarily the same as cash still expected if money is received but unallocated.

### Unallocated Client Money

Verified or reported client money that has not yet been applied to a specific invoice or booking obligation.

It should remain visible and should not automatically reduce every possible balance.

### Client Money Held

An operational view of client money received for an active trip, supplier obligation, or future service that WMIT has not yet resolved through supplier payment, refund, or approved operational treatment.

This is not a legal accounting classification.

### Supplier Payable

The operational amount WMIT expects or is required to pay a Supplier for a Supplier Booking or Booking Item.

It should retain:

- supplier;
- related Booking/Supplier Booking;
- expected/confirmed cost;
- deposit and balance;
- due dates;
- payment terms;
- non-refundable/credit notes where known;
- payments applied;
- remaining operational balance.

### Supplier Payment

Money WMIT pays to a Supplier against a Supplier Payable or supplier-side obligation.

It must not reduce the Client Outstanding Balance.

### Supplier Outstanding

The operational amount still payable to a Supplier after recognized Supplier Payments and approved credits/refunds.

### Refund

Money returned to the client or an approved credit/adjustment arising from cancellation, supplier failure, amendment, or another outcome.

The original Client Payment should not be deleted or rewritten to represent a refund.

### Expected Profit

An operational estimate based on current client selling value and expected direct costs.

```text
Expected Profit
= expected client selling value - expected direct supplier/service cost
```

### Updated Profit

An operational margin estimate using updated/confirmed costs and approved direct adjustments such as refunds, supplier penalties, or cancellation costs.

It is still not an accounting profit measure unless WMIT separately approves that interpretation.

## Example 1 — Deposit received

### Initial commercial facts

```text
Client selling price: PHP 100,000
Expected supplier cost: PHP 80,000
Client payment received: PHP 30,000 deposit
```

Operational view:

| Measure | Amount | Explanation |
|---|---:|---|
| Client amount due | PHP 100,000 | Current client obligation before credits/refunds |
| Client payment received | PHP 30,000 | Receipt reported/verified according to payment state |
| Client allocated payment | PHP 30,000 | Assuming allocation to this booking/invoice |
| Client outstanding | PHP 70,000 | PHP 100,000 less PHP 30,000 |
| Unallocated client money | PHP 0 | Assuming the deposit was allocated |
| Client money held | PHP 30,000 | Operational amount received for the trip/supplier obligation |
| Supplier payable | PHP 80,000 | Expected/confirmed direct supplier obligation |
| Supplier payment | PHP 0 | No supplier payment yet |
| Supplier outstanding | PHP 80,000 | Payable less supplier payment |
| Expected profit | PHP 20,000 | PHP 100,000 less PHP 80,000 |

The expected profit is PHP 20,000 even though only PHP 30,000 has been received. The receipt is not the profit.

Whether WMIT may pay the supplier at this point depends on supplier terms and the approved reserve-before-payment policy.

## Example 2 — Supplier payment after deposit

Suppose WMIT pays the supplier PHP 50,000 from the client money.

| Measure | Amount |
|---|---:|
| Client payment received | PHP 30,000 |
| Client outstanding | PHP 70,000 |
| Supplier payable | PHP 80,000 |
| Supplier payment | PHP 50,000 |
| Supplier outstanding | PHP 30,000 |
| Expected profit | PHP 20,000 |

The supplier payment does not change the client outstanding balance or expected profit by itself.

## Example 3 — Final PHP 70,000 received

The client pays another PHP 70,000.

| Measure | Amount |
|---|---:|
| Total client payments received | PHP 100,000 |
| Total allocated client payments | PHP 100,000 |
| Client outstanding | PHP 0 |
| Supplier payable | PHP 80,000 |
| Supplier payments | PHP 50,000 |
| Supplier outstanding | PHP 30,000 |
| Expected profit | PHP 20,000 |

The trip being fully paid by the client does not prove that the supplier has been paid or that the trip is ready.

## Example 4 — Supplier cost changes

Suppose the confirmed supplier cost increases from PHP 80,000 to PHP 85,000.

The system should retain:

- original expected supplier cost: PHP 80,000;
- updated/confirmed supplier cost: PHP 85,000;
- reason/source for the change;
- who recorded it and when.

Updated operational profit becomes:

```text
PHP 100,000 client selling price
- PHP 85,000 updated supplier cost
= PHP 15,000 updated profit
```

The client payment history remains PHP 100,000. Supplier outstanding becomes PHP 35,000 if PHP 50,000 has already been paid.

Whether WMIT may change the client selling price after confirmation is **UNKNOWN / NEEDS WMIT VALIDATION.**

## Example 5 — PHP 10,000 refund

Suppose PHP 10,000 is approved for refund to the client.

The system should record:

- original Client Payments: unchanged at PHP 100,000;
- Refund: PHP 10,000;
- net client money retained: PHP 90,000;
- client obligation after refund: according to the approved cancellation/refund outcome;
- supplier credit/refund: separately recorded if applicable;
- reason, evidence, approver, and date.

If the supplier cost remains PHP 85,000 and WMIT receives no supplier credit, an operational retained-value view could be:

```text
Net client amount retained: PHP 90,000
Direct supplier cost:       PHP 85,000
Updated operational margin: PHP 5,000
```

This is an operational illustration only. The exact treatment of refund amounts, cancellation penalties, fees, and tax is not established.

## Payment verification and allocation rules

The architecture should distinguish:

1. Payment entered by staff.
2. Payment evidence received.
3. Payment verified.
4. Payment allocated to an obligation.
5. Payment reversed or refunded.

Only verified payments should normally affect a final management balance. Whether a reported but unverified payment may temporarily support a reservation is an approval decision.

## Accounting decisions explicitly outside this model

The following require separate professional/business decisions:

- when revenue is recognized;
- whether deposits are liabilities or revenue;
- tax treatment and tax invoice requirements;
- foreign exchange gains/losses;
- treatment of card, bank, GCash, and PayPal charges;
- supplier commissions and rebates;
- treatment of non-refundable supplier deposits;
- accounting treatment of refunds, credits, and chargebacks;
- formal accounts receivable/accounts payable reporting.

The operational model must not silently claim to answer these questions.
