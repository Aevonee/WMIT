# WMIT Business Architecture Validation — Conceptual Domain Relationship Map

> **SUPERSEDED by [baseline-v1.md](baseline-v1.md).** Retained as relationship discovery evidence; baseline cardinalities and aggregate boundaries control.

> **NON-EXECUTABLE:** [BASELINE-HANDOFF.md](BASELINE-HANDOFF.md) controls current business semantics and implementation boundaries.

Status: conceptual map; not a database schema

## Overall map

```text
Client
  └── Person(s)
        ├── coordinator role
        ├── payer role
        ├── traveler role
        └── communication participant role

Client / Person(s)
  └── Inquiry
        ├── source channel / conversation reference
        ├── people involved
        ├── original request
        ├── Commercial Option(s)
        │     ├── Supplier Package
        │     ├── Supplier Tariff basis
        │     ├── supplier-specific quote
        │     ├── airfare/source research
        │     └── custom research
        ├── Availability Evidence, where applicable
        ├── Communication(s)
        ├── WMIT Quotation(s), where applicable
        └── Task(s)/follow-ups

WMIT Quotation
  ├── Quotation Item(s)
  ├── selected Commercial Option, where applicable
  ├── internal cost / markup / fees
  ├── client-facing price/content
  ├── source Documents
  └── Booking, when client proceeds

Booking
  ├── participant/person relationships
  ├── Booking Item(s)
  │     ├── Supplier
  │     ├── Supplier Booking(s)
  │     └── Departure, where applicable
  ├── Client Invoice(s)
  ├── Client Payment(s)
  │     └── Payment Allocation(s)
  ├── Supplier Payable(s)
  │     └── Supplier Payment(s)
  ├── Document(s) / Voucher(s)
  ├── Task(s)
  ├── Communication(s)
  └── pre-departure readiness projection

Departure
  ├── shared Supplier/product/date reference
  ├── many independent Booking(s)
  ├── group-level Documents
  ├── group-level Task(s)/deadlines
  └── derived traveler/booking/readiness views

Every important record
  └── Audit Event(s)
```

## Relationship descriptions

### Client → Person

A Client may be associated with one or more Persons. A Person may have different roles across inquiries and bookings.

The exact rules for whether a Person may belong to several Client relationships are **UNKNOWN / NEEDS WMIT VALIDATION.**

### Client → Inquiry

A recurring Client may have many Inquiries. A new Inquiry may begin without a known Client and later be matched or linked after duplicate review.

An Inquiry should retain the original request and source channel.

### Inquiry → People involved

An Inquiry may involve:

- communicating coordinator;
- potential travelers;
- payer;
- group-chat participants;
- other authorized contacts.

These roles must not be inferred from one another.

### Inquiry → Commercial Options

An Inquiry may have zero, one, or many researched or presented Commercial Options.

Options may be:

- a Supplier Package;
- a Supplier Tariff-based arrangement;
- a specific supplier quote;
- airfare research;
- an alternative date, destination, or supplier;
- a mixed-supplier custom arrangement.

### Commercial Option → Availability Evidence

An Option may have availability evidence. This relationship is essential for Supplier Packages, where availability must precede presentation.

Custom quotations may have no availability evidence yet. Absence of evidence means “not checked” or “unknown,” not “unavailable.”

### Inquiry → WMIT Quotation

An Inquiry may produce zero, one, or many WMIT Quotations. A quotation may be for a changed or alternative request.

The exact rule for whether multiple quotations can be active simultaneously is **UNKNOWN / NEEDS WMIT VALIDATION.**

### WMIT Quotation → Quotation Items

A Quotation contains one or more priced services or charges. Items may refer to different Suppliers.

Quotation Items are not automatically Booking Items. They become source material for a Booking only if the client selects the relevant arrangement.

### WMIT Quotation → selected Commercial Option

A quotation may be based on a Supplier Package, Supplier Tariff, supplier quote, or custom research. The source should remain visible internally so WMIT can distinguish product provenance from WMIT pricing.

### WMIT Quotation → Booking

A Booking may reference the Quotation that informed it, but a quotation is not required for every booking if WMIT’s actual workflow permits direct operational booking.

The Booking must represent the actual selected product, not merely the original inquiry.

### Booking → Participants

A Booking may have multiple participants, including:

- travelers;
- coordinator;
- payer;
- other contacts.

The coordinator and payer may be different from every traveler.

### Booking → Booking Items

A Booking may contain many Booking Items, including airfare, hotel, transfers, tours, insurance, visa/service fees, and other charges.

### Booking Item → Supplier

Each Booking Item may identify the Supplier expected to fulfill it. A WMIT fee may have no external Supplier.

### Booking Item → Supplier Booking

A Booking Item may be linked to one or more Supplier Bookings over time if there are amendments, alternatives, or split fulfillment. One Supplier Booking may cover multiple Booking Items.

This cardinality requires validation against actual supplier practice before implementation.

### Booking / Booking Item → Departure

A Booking or Booking Item may optionally belong to a Departure. The system should allow independent bookings to share a Departure without merging financial records.

Whether the relationship belongs primarily at Booking or Booking Item level is an open decision.

### Booking → Client Invoice

A Booking may have one or more Client Invoices if WMIT uses deposits, supplemental charges, amendments, or separate billing documents. One Invoice may cover multiple Bookings only if WMIT confirms that practice.

### Client Payment → Payment Allocation

A Client Payment may be applied to an Invoice, Booking obligation, deposit, installment, or remain unallocated until reviewed.

The allocation relationship is separate from the receipt.

### Supplier Booking → Supplier Payable

A Supplier Booking may create one or more operational Supplier Payables for deposits, final balances, amendments, or supplier invoices.

The first MVP may derive a single payable from a Supplier Booking, but the architecture should not permanently assume that one supplier booking always has one payable.

### Supplier Payment → Supplier Payable

A Supplier Payment reduces a Supplier Payable only after the payment is recorded and verified according to WMIT policy.

It does not reduce Client Outstanding Balance.

### Document → business record

A Document may be related to any relevant Inquiry, Client, Person, Quotation, Booking, Booking Item, Supplier, Supplier Package, Supplier Tariff, Supplier Booking, Departure, Invoice, Payment, or Task.

The Document is evidence or output. It does not automatically become the authoritative structured record.

### Task → business record

A Task may relate to an Inquiry, Option, Quotation, Booking, Booking Item, Supplier Booking, Payment, Document, Departure, or Client.

Tasks require an owner and due date when operationally meaningful.

### Communication → business record

A Communication may relate to an Inquiry, Client, Person, Quotation, Booking, Supplier, Supplier Booking, or Task. It may also be linked to a source conversation/thread.

Full message ingestion is not required for the initial architecture.

### Audit Event → all important records

Audit Events record important creation, edits, state changes, payment actions, document associations, approvals, refunds, and external commitments.

## Deliberate non-relationships

- Client does not equal Traveler.
- Coordinator does not equal Traveler.
- Payment does not equal Profit.
- Quotation does not equal Availability.
- Booking does not equal Supplier Booking.
- Supplier Confirmation does not equal Supplier Payment.
- Departure does not merge Bookings.
- Document does not replace a structured business record.
- No separate Trip relationship is required yet.
