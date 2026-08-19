# WMIT Business Architecture Validation — Canonical Scenarios

> **SUPERSEDED by [baseline-v1.md](baseline-v1.md) and [validation-matrix-v1.md](validation-matrix-v1.md).** Retained as scenario evidence.

> **NON-EXECUTABLE:** Scenarios cannot create business policy; use the classified current contract in [BASELINE-HANDOFF.md](BASELINE-HANDOFF.md).

Status: architecture validation draft; owner approval required before implementation

These scenarios are business acceptance examples. They are not implementation workflows and do not authorize schema or code changes.

## Scenario A — Wholesaler package

### Business flow

```text
Inquiry
  → find Supplier Package
  → check Availability FIRST
  → calculate/use appropriate selling price
  → present package
  → client confirms
  → client pays
  → create/update Booking
  → reserve with Supplier
  → receive Supplier confirmation/voucher
  → prepare/send vouchers
```

### Concepts involved

- Inquiry records what the client originally asked for.
- Supplier represents the wholesaler.
- Supplier Package represents the ready-made product.
- Availability records the checked result and evidence.
- WMIT Quotation or client-facing commercial output represents WMIT’s presentation and price.
- Booking represents the selected product after client commitment.
- Supplier Booking represents the reservation/confirmation with the wholesaler.
- Voucher is a document/output, not the Booking.

### Required distinctions

- A Supplier Package is not a WMIT Quotation.
- Availability must be checked before the package is presented as available.
- Client payment does not by itself prove supplier confirmation.
- Supplier confirmation does not by itself prove Supplier Payment.

## Scenario B — Custom quotation

### Business flow

```text
Inquiry
  → search Supplier Tariff and/or request supplier quote
  → obtain airfare separately if needed
  → assemble services and costs
  → calculate WMIT price, markup, and fees
  → create WMIT Quotation
  → send quotation
  → check availability later or in parallel
  → client confirms
  → client pays
  → create/update Booking
  → create Supplier Booking(s)
  → receive confirmation/voucher
```

### Required distinction

A quotation based on a Supplier Tariff does **not** mean that availability is confirmed. The quotation must be able to show internally that availability is not checked, pending, available, unavailable, or otherwise qualified.

### Possible item sources

- DMC tariff for land arrangements;
- supplier-specific quotation;
- airfare portal/source;
- hotel or transfer supplier;
- WMIT service, visa, ticketing, insurance, bank, or conversion fee.

The client sees the approved selling presentation, not supplier cost, markup, internal notes, or restricted supplier information.

## Scenario C — Client changes request

### Facts

```text
Original Inquiry:
  cheap local holiday
  August

Research outcome:
  nothing suitable within budget or available

Alternative:
  October wholesaler package

Client decision:
  accepts October option
```

### Recommended representation

1. Keep the original Inquiry facts unchanged.
2. Record the research outcome and why the original direction did not proceed.
3. Create a Commercial Option for the October wholesaler package.
4. Check and record availability for the October package.
5. Present the October option or quotation to the client.
6. Link the client decision to the October option.
7. Create the Booking using October dates, product, travelers, and price.

The Booking should link to the selected option and original Inquiry where useful, but it must not simply copy the original August request.

## Scenario D — Group inquiry

### Facts

One coordinator communicates with WMIT. Several people travel. The coordinator may or may not travel and may or may not be the payer. Other participants may communicate directly or join a group chat.

### Recommended representation

```text
Inquiry
  ├─ Coordinator: Person A
  ├─ Other communicating participants: Persons B/C
  ├─ Payer: Person A or another approved person
  └─ Proposed travelers: Persons A/B/C/D

Booking
  ├─ Participant role: Coordinator
  ├─ Participant role: Payer
  └─ Participant role: Traveler for each actual traveler
```

The system must not infer that the coordinator is a traveler or payer. Those are separate roles.

## Scenario E — Multiple suppliers

### Example Booking

```text
Booking
  ├─ Booking Item: airfare      → Supplier/airfare source A
  ├─ Booking Item: hotel        → Supplier B
  ├─ Booking Item: transfers    → DMC C
  ├─ Booking Item: tours        → Supplier D
  ├─ Booking Item: insurance    → Supplier E
  └─ Booking Item: visa/service fee → WMIT or relevant source
```

Each Booking Item should retain its own:

- service description;
- supplier;
- selling amount;
- expected/confirmed cost;
- fulfillment state;
- date/quantity;
- related Supplier Booking when procurement occurs.

A Supplier Booking may cover one or more Booking Items if the supplier confirms them together. A single Booking may therefore have multiple Supplier Bookings.

## Scenario F — Shared wholesaler departure

### Facts

```text
Supplier Departure: Wholesaler ABC — Korea — October 15

Booking A — 2 travelers
Booking B — 4 travelers
Booking C — 3 travelers
```

### Recommended representation

- Keep A, B, and C as separate Bookings.
- Link each applicable Booking or Booking Item to the same Departure.
- Derive total WMIT travelers: 9.
- Derive number of WMIT bookings: 3.
- Show supplier confirmation, document, deadline, and readiness summaries at Departure level.
- Keep each client’s Invoice, Payment, Supplier Payable, Supplier Payment, and profit independent.

The Departure is an operational grouping, not a financial consolidation.

## Scenario G — Supplier reservation before client payment

### Facts

WMIT may reserve with a Supplier before receiving Client Payment, but intends to pay Suppliers using client money.

### Required distinctions

```text
Client commitment
  = client has agreed to proceed, according to WMIT’s confirmation policy

Supplier reservation
  = WMIT requested or placed a hold/reservation

Supplier confirmation
  = supplier accepted/confirmed the reservation

Supplier payable
  = amount WMIT expects or must pay to supplier

Supplier payment
  = WMIT actually paid supplier

Client payment
  = money received/reported from client
```

A reservation before client payment should create an explicit operational risk/deadline state. It must not be hidden by marking the whole Booking confirmed.

## Scenario H — Installment payments

### Example

```text
Client selling price: PHP 100,000
Deposit: PHP 30,000
Second installment: PHP 30,000
Final installment: PHP 40,000
```

After the deposit:

- Client Payment records PHP 30,000.
- Payment Allocation applies it to the relevant invoice/booking obligation.
- Client outstanding balance is PHP 70,000.
- Supplier Payable remains based on supplier terms and confirmed cost.
- Supplier Payment is unchanged unless WMIT pays the supplier.
- Client commitment and supplier fulfillment remain separate states.

After all installments:

- total allocated client payment is PHP 100,000;
- client outstanding balance is zero;
- the Booking is not automatically supplier-confirmed;
- Supplier Payable remains until paid, cancelled, refunded, or otherwise resolved;
- expected profit remains a price-versus-cost calculation, not a cash calculation.

The normal WMIT rule is full payment at least one month before departure, but supplier-specific schedules may control earlier deadlines.

## Scenario I — Supplier unavailable

### Business flow

```text
Preferred supplier/product unavailable
  → search another supplier/product
  → create alternative Commercial Option
  → possibly check alternative availability
  → present alternative
  → client accepts
      → selected option becomes basis of Booking
  → client declines
      → Inquiry may close, remain open, or enter refund/cancellation handling
```

The system should preserve:

- the original preferred option;
- its unavailable result and evidence;
- alternatives researched;
- client decision;
- the final selected product, if any.

## Scenario J — Cancellation/refund

Cancellation rules vary by Supplier and product.

The architecture should be able to represent:

- who requested cancellation;
- which Booking, Booking Item, Supplier Booking, or Departure is affected;
- supplier terms and evidence;
- whether a reservation was refundable or non-refundable;
- supplier refund/credit received, if any;
- client refund or credit approved, if any;
- amount returned, retained, or still under review;
- related Client Payment and Supplier Payment records;
- operational profit impact;
- approval and audit history.

It must not assume a universal refund percentage, deadline, accounting treatment, or automatic outcome.
