# WMIT Business Architecture Validation — Approved Business Glossary

> **SUPERSEDED by [baseline-v1.md](baseline-v1.md).** Retained as discovery evidence; do not use its provisional/unknown classifications as current business authority.

> **NON-EXECUTABLE:** [BASELINE-HANDOFF.md](BASELINE-HANDOFF.md) controls current terms and classifications where this glossary differs.

Status: architecture validation draft; owner approval required before implementation

## How to read this glossary

This glossary distinguishes:

- **Confirmed business behavior** — supplied by the owner or demonstrated by a real scenario.
- **Existing prototype behavior** — what the current local code models.
- **Architectural recommendation** — a proposed boundary for validation.
- **UNKNOWN / NEEDS WMIT VALIDATION** — not yet established and must not become an automatic rule.

“Persistent domain entity” means a record that likely needs its own durable identity. “Initially derived” means a view or calculation may be produced from other records until actual workflow evidence justifies storing it separately.

## Customer and people

### Client

1. **Meaning in WMIT:** The ongoing customer relationship or customer account. A Client may be new, recurring, or VIP/important and may have multiple separate bookings.
2. **Does not mean:** One trip, one inquiry, one traveler, or necessarily the person who communicates with WMIT.
3. **Classification:** Master data.
4. **Persistence:** Probably a persistent domain entity.

**UNKNOWN / NEEDS WMIT VALIDATION:** Whether a Client represents only an individual or may also represent a family, household, or organization in this workflow.

### Person

1. **Meaning in WMIT:** An identifiable human who may communicate, travel, coordinate, pay, or participate in a group chat.
2. **Does not mean:** Automatically a Client, Traveler, payer, or primary contact.
3. **Classification:** Master/supporting data.
4. **Persistence:** Probably persistent, especially if people recur across bookings.

**Architectural recommendation:** Separate the person identity from role-specific relationships.

### Traveler

1. **Meaning in WMIT:** A person who is traveling on a particular Booking.
2. **Does not mean:** The person who made the inquiry or paid the invoice.
3. **Classification:** Supporting master/booking-participant record.
4. **Persistence:** Person identity should persist; the Traveler role on a Booking is a persistent relationship.

### Travel Party

1. **Meaning in WMIT:** The people associated with one inquiry or booking, including travelers and any coordinator or payer.
2. **Does not mean:** A legally separate customer, a supplier departure, or a merged financial booking.
3. **Classification:** Conceptual grouping/supporting record.
4. **Persistence:** Initially may be represented through inquiry and booking participant relationships. A separate persistent entity is **UNKNOWN / NEEDS WMIT VALIDATION**.

### User/Staff

1. **Meaning in WMIT:** A person authorized to perform work in WMIT Operations, such as sales, operations, finance-related tasks, management, or restricted intern work.
2. **Does not mean:** A Client, Traveler, or generic contact record.
3. **Classification:** Access/master data.
4. **Persistence:** Eventually persistent, but production authentication and identity management are out of scope for this phase.

## Inquiry and commercial research

### Inquiry

1. **Meaning in WMIT:** An incoming request or travel opportunity received through Messenger, comments, personal chats, WhatsApp, Viber, email, phone, SMS, walk-in, referral, existing client, website, travel fair/event, or another source.
2. **Does not mean:** A Client, Quotation, Booking, or guaranteed sale.
3. **Classification:** Workflow/transaction.
4. **Persistence:** Yes, probably a persistent domain entity because the original request and follow-up history matter.

An Inquiry should preserve the original request even if destination, date, budget, party size, or product changes.

### Commercial Option

1. **Meaning in WMIT:** A package, custom arrangement, alternative supplier/product/date, or researched solution that staff considers or presents in response to an Inquiry.
2. **Does not mean:** Automatically a quotation, availability confirmation, or booking.
3. **Classification:** Supporting workflow record.
4. **Persistence:** Initially may be a persistent record if WMIT needs to compare alternatives; otherwise it may begin as linked research evidence. **UNKNOWN / NEEDS WMIT VALIDATION.**

### Supplier

1. **Meaning in WMIT:** The umbrella term for wholesalers, DMCs, land suppliers, airlines, hotels, insurance providers, and other service providers used by WMIT.
2. **Does not mean:** Only a wholesaler or only a party that confirms a full booking.
3. **Classification:** Master data.
4. **Persistence:** Yes, persistent domain entity.

### Supplier Package

1. **Meaning in WMIT:** A supplier-originated ready-made product, such as a wholesaler package or group departure.
2. **Does not mean:** A WMIT Quotation, a Booking, or proof that availability exists.
3. **Classification:** Commercial master/source record.
4. **Persistence:** Probably persistent when packages are reused or need availability/product history; exact scope is **UNKNOWN / NEEDS WMIT VALIDATION.**

### Supplier Tariff

1. **Meaning in WMIT:** Supplier rate information used by staff to construct a custom arrangement or quotation.
2. **Does not mean:** A live availability result, supplier confirmation, or WMIT selling price.
3. **Classification:** Supporting commercial/source record.
4. **Persistence:** Probably persistent or indexed through source-document metadata, because tariff search is a major pain point.

### Availability

1. **Meaning in WMIT:** The result of checking whether a Supplier Package or service can be supplied for specified dates, quantity, and conditions.
2. **Does not mean:** A price, quotation, client acceptance, supplier confirmation, or supplier payment.
3. **Classification:** Workflow/evidence record or derived state.
4. **Persistence:** Availability evidence should probably persist when it affects client presentation or a commitment. The exact record shape is **UNKNOWN / NEEDS WMIT VALIDATION.**

## WMIT commercial records

### WMIT Quotation

1. **Meaning in WMIT:** A WMIT-created client-facing commercial proposal containing services, pricing, terms, inclusions, exclusions, validity, and applicable fees.
2. **Does not mean:** A Supplier Package, confirmed availability, Supplier Booking, Invoice, or confirmed Booking.
3. **Classification:** Workflow/transaction.
4. **Persistence:** Yes, persistent domain entity.

A quotation may be created before availability is checked in the custom-quotation path.

### Quotation Item

1. **Meaning in WMIT:** One service, fee, charge, or other priced component within a WMIT Quotation.
2. **Does not mean:** A Booking Item or Supplier Booking, even if it later becomes one.
3. **Classification:** Supporting transaction/detail record.
4. **Persistence:** Yes, probably persistent with the quotation.

### Booking

1. **Meaning in WMIT:** The operational record of the actual selected or committed travel arrangement for a client or travel party.
2. **Does not mean:** The original Inquiry, a Quotation acceptance, an Invoice, or a Supplier Booking.
3. **Classification:** Core workflow/transaction.
4. **Persistence:** Yes, persistent domain entity.

A Booking may be created from a Quotation, Supplier Package, changed alternative, or direct operational action, depending on the workflow.

### Booking Item

1. **Meaning in WMIT:** One service or charge within a Booking, such as airfare, hotel, transfer, tour, insurance, visa assistance, or service fee.
2. **Does not mean:** The entire Booking or the supplier-side reservation itself.
3. **Classification:** Supporting transaction/detail record.
4. **Persistence:** Yes, probably persistent.

### Supplier Booking

1. **Meaning in WMIT:** WMIT’s supplier-side request, reservation, purchase, reference, or confirmation connected to one or more Booking Items.
2. **Does not mean:** The client Booking, client Invoice, supplier payment, or proof that the client has paid.
3. **Classification:** Core workflow/transaction.
4. **Persistence:** Yes, persistent domain entity.

### Departure

1. **Meaning in WMIT:** An optional shared operational grouping, particularly a wholesaler group departure, to which several independent WMIT Bookings may belong.
2. **Does not mean:** A merged booking, merged invoice, merged client, or merged financial account.
3. **Classification:** Core operational grouping.
4. **Persistence:** Probably persistent when the supplier departure has its own reference, dates, capacity, documents, or deadlines.

## Financial operations

### Client Invoice

1. **Meaning in WMIT:** A client-facing billing document or operational client obligation related to one or more bookings/items.
2. **Does not mean:** Money received, supplier payable, WMIT revenue recognition, or profit.
3. **Classification:** Workflow/financial-operational record.
4. **Persistence:** Yes, persistent domain entity.

### Client Payment

1. **Meaning in WMIT:** Money received or reported from a client through bank transfer, cash, card, GCash, PayPal, or another method.
2. **Does not mean:** Automatically verified money, a fully paid booking, supplier payment, or WMIT profit.
3. **Classification:** Financial-operational transaction.
4. **Persistence:** Yes, persistent and historically retained.

### Payment Allocation

1. **Meaning in WMIT:** The application of all or part of a Client Payment to a specific Invoice, Booking obligation, deposit, installment, or other client balance.
2. **Does not mean:** The original receipt itself or a supplier payment.
3. **Classification:** Supporting financial transaction.
4. **Persistence:** Probably persistent if payments can be unallocated, split, reallocated, refunded, or applied across obligations.

**UNKNOWN / NEEDS WMIT VALIDATION:** Whether WMIT applies payments only to invoices or also directly to bookings/deposits before an invoice exists.

### Unallocated Client Money

1. **Meaning in WMIT:** Client money received but not yet applied to a specific client obligation.
2. **Does not mean:** Missing money, profit, or automatically available supplier funds.
3. **Classification:** Derived financial state, supported by payment/allocation records.
4. **Persistence:** Initially may be derived; an explicit allocation history should persist.

### Supplier Payable

1. **Meaning in WMIT:** The operational amount WMIT expects or is required to pay to a supplier for a Supplier Booking or Booking Item.
2. **Does not mean:** A Client Payment, supplier confirmation, or full accounting accounts-payable ledger.
3. **Classification:** Financial-operational workflow record.
4. **Persistence:** Probably persistent, although a first MVP might derive it from confirmed Supplier Bookings.

### Supplier Payment

1. **Meaning in WMIT:** Money paid by WMIT to a Supplier against a Supplier Payable or supplier-side obligation.
2. **Does not mean:** Client payment, client balance reduction, supplier confirmation, or profit.
3. **Classification:** Financial-operational transaction.
4. **Persistence:** Yes, persistent and historically retained.

### Refund

1. **Meaning in WMIT:** Money returned to a client or a financial credit/adjustment resulting from cancellation, supplier failure, or another approved outcome.
2. **Does not mean:** A generic Booking status change or deletion of the original payment.
3. **Classification:** Workflow/financial transaction.
4. **Persistence:** Yes, if refunds are implemented; exact representation is **UNKNOWN / NEEDS WMIT VALIDATION.**

### Expected Profit

1. **Meaning in WMIT:** An operational estimate based on current client selling value and expected direct costs.
2. **Does not mean:** Accounting profit, cash received, or legally recognized revenue.
3. **Classification:** Derived/projection.
4. **Persistence:** Initially derived, with source cost/price snapshots retained for audit.

### Updated Profit

1. **Meaning in WMIT:** An operational margin view updated using confirmed supplier costs, approved changes, refunds, or direct trip-cost adjustments.
2. **Does not mean:** Final accounting profit unless separately defined and approved.
3. **Classification:** Derived/projection.
4. **Persistence:** Initially derived; material adjustments and source values should persist.

## Documents and work

### Document

1. **Meaning in WMIT:** A received or generated file/evidence item, including supplier quotations, tariffs, confirmations, vouchers, invoices, payment records, client quotations, and travel documents.
2. **Does not mean:** The authoritative structured Booking, Payment, or Supplier Booking record.
3. **Classification:** Supporting record.
4. **Persistence:** Yes, persistent metadata and file reference.

### Voucher

1. **Meaning in WMIT:** A travel fulfillment document issued by a supplier or generated/updated by WMIT for client use.
2. **Does not mean:** A Booking, supplier confirmation, or payment record.
3. **Classification:** Document/output subtype and workflow artifact.
4. **Persistence:** The document and its metadata should persist; checklist/readiness state may initially be derived.

### Task

1. **Meaning in WMIT:** A required action with an owner and due date, such as follow-up, supplier deadline, payment reminder, voucher preparation, or PDOS preparation.
2. **Does not mean:** A status value alone or proof that the action was completed.
3. **Classification:** Workflow/supporting record.
4. **Persistence:** Yes, persistent while open and historically retained when completed.

### Communication

1. **Meaning in WMIT:** A message, call, email, SMS, chat, walk-in interaction, or other contact event relevant to an Inquiry, Client, Booking, Supplier, or task.
2. **Does not mean:** The Inquiry itself, a quotation, or a client confirmation unless its content is explicitly accepted as evidence of that event.
3. **Classification:** Supporting workflow/activity record.
4. **Persistence:** Initially a lightweight persistent activity/reference is recommended; full message ingestion is **UNKNOWN / NEEDS WMIT VALIDATION.**

### Audit Event

1. **Meaning in WMIT:** A record of who performed an important action, what changed, when it happened, the related record, result, and relevant evidence.
2. **Does not mean:** The current state of the business record.
3. **Classification:** Cross-cutting supporting record.
4. **Persistence:** Yes, append-only durable history before production use.

## Boundary conclusion

The core persistent business records are likely Client, Person, Inquiry, Quotation, Booking, Booking Item, Supplier, Supplier Booking, Departure, Invoice, Payment, Supplier Payable, Document, Task, and Audit Event. Commercial Options, Availability, Payment Allocations, Communications, and Travel Party may begin as supporting records or relationships, but their final persistence needs owner validation.

No separate Trip entity is required by the current scenarios. A Trip should remain a conceptual label unless WMIT later needs one inquiry or customer occasion to contain multiple separate bookings that must be managed together independently of a Departure.
