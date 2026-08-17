# WMIT Business Architecture Validation — Recommended MVP Boundary

> **SUPERSEDED by [baseline-v1.md](baseline-v1.md) and [implementation-roadmap-v1.md](implementation-roadmap-v1.md).** Retained as scope discovery evidence.

> **NON-EXECUTABLE:** [implementation-plan-v1.2.md](implementation-plan-v1.2.md) controls the current Phase 1 vertical slice and non-goals.

Status: recommendation only; no implementation authorized

## MVP objective

The first useful WMIT Operations MVP should reduce missed work and financial confusion around active travel opportunities. It should not attempt to automate the entire travel agency.

## Smallest coherent MVP

The smallest coherent system should include:

1. **Inquiry and follow-up register** — source channel, original request, known people/client, owner, next follow-up, changed requests, and outcomes.
2. **Commercial option and quotation workspace** — Supplier Package versus custom arrangement, source supplier/tariff/quote, availability state, cost, markup, fees, discounts, client price, and client-safe output.
3. **Booking and supplier-fulfillment tracker** — actual selected product, multiple participants, Booking Items, Suppliers, Supplier Bookings, confirmations, and deadlines.
4. **Client and supplier money visibility** — client payments, verification, client balance, supplier obligations, supplier payments, supplier balance, and expected margin.
5. **Task/deadline dashboard** — inquiry follow-ups, client payments, supplier deadlines, missing vouchers/confirmations, and pre-departure work.
6. **Document association** — source, related-record links, internal/client-facing/sensitive classification, and review state.

## Priority sequence

### MVP slice 1 — Follow-up and deadline control

- Inquiry register;
- assigned owner;
- next-action date;
- supplier deadline;
- client payment deadline;
- neutral reminder states;
- actionable dashboard.

### MVP slice 2 — Payment and obligation visibility

- client payment entry;
- payment verification state;
- client balance;
- supplier payable/payment view;
- deadline linkage;
- basic expected margin.

### MVP slice 3 — Quotation and Booking alignment

- Supplier Package versus custom arrangement;
- availability state;
- quotation items;
- client-safe output;
- actual selected option;
- Booking Items;
- Supplier Bookings.

### MVP slice 4 — Documents and vouchers

- document metadata;
- source and related-record links;
- confirmation/voucher readiness;
- generated voucher draft from confirmed Booking data;
- human review before sending.

### MVP slice 5 — Departure grouping

- optional shared Departure;
- independent booking list;
- traveler and booking counts;
- group deadlines and exceptions.

## What should not be built simultaneously

Do not make the first MVP include all of the following at once:

- full accounting;
- complex tax handling;
- automatic supplier booking;
- live travel search across multiple sites;
- automated communications;
- full Gmail/Messenger/WhatsApp/Viber ingestion;
- OCR/AI document automation;
- advanced profit recognition;
- complex itinerary platform;
- production authentication;
- attendance, payroll, or HR features.

## Recommended first demonstrable workflow

```text
Messenger Inquiry
  → August request recorded
  → October Supplier Package alternative researched
  → availability checked and recorded
  → WMIT quotation prepared
  → client accepts and pays deposit
  → Booking created for October option
  → Supplier Booking created with deadline
  → client payment balance shown
  → supplier payable shown
  → follow-up/deadline dashboard updated
```

## MVP non-goals

The MVP should not include:

- arbitrary direct cell editing;
- autonomous AI actions;
- automatic refunds;
- automatic live availability claims;
- automatic supplier purchases;
- automatic client/supplier message sending;
- complete document ingestion from every channel;
- tax or accounting compliance claims;
- production data migration;
- Google Workspace integration before read-only discovery and approval.

## MVP success measures

Staff should be able to:

- see which inquiries need action;
- see approaching supplier deadlines;
- see client balances and payment evidence state;
- see supplier obligations and payments separately;
- prepare quotations with fewer calculation errors;
- find relevant documents;
- produce vouchers faster;
- identify bookings sharing a departure;
- explain expected margin without confusing it with cash received.
