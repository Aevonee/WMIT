# WMIT Business Architecture v2

Status: business architecture reset; owner review required before implementation

Date: 2026-08-13

## Reading this document

This document is the new business-architecture reference for WMIT Operations. It is based primarily on the owner's answers supplied for this reset. The existing local WMIT Operations application, schemas, tests, and planning documents are prototype/reference material only.

This document does not authorize code changes, schema changes, Google Workspace access, production-data access, migration, or continuation of Phase 3C.

The following labels are used throughout:

- **Known from WMIT answers** — directly stated or clearly demonstrated by the owner's examples.
- **Working assumption** — a practical design assumption used to make progress; it must be confirmed before implementation if it affects data or workflow behavior.
- **UNKNOWN / NEEDS WMIT VALIDATION** — deliberately unresolved. It must not become an automatic business rule.

## A. Executive summary

WMIT Operations should be designed around an inquiry-to-travel-fulfillment process, not around a presumed Lead → Quotation → Booking conversion funnel.

The actual operating model has two different commercial paths:

1. **Wholesaler package path:** WMIT finds a supplier package or group departure, checks availability first, and only then presents the available option to the client.
2. **Custom quotation path:** WMIT assembles services from supplier tariffs, supplier-specific requests, airfare sources, and WMIT pricing. A quotation may be created and sent before availability is checked.

Those paths may eventually produce the same type of WMIT Booking, but the source product, availability evidence, pricing logic, and supplier-procurement steps are different. A Supplier Package must not be treated as a Custom Quotation, and neither should be treated as a Booking.

The operational center of gravity is the **Booking**. A booking represents the actual confirmed travel product or arrangement, which may be different from the original inquiry. One client may have many independent bookings. One booking may have many travelers, many service items, many suppliers, many supplier-side bookings, many client payments, many supplier payments, and many documents.

The financial model must keep separate:

- what the client was charged;
- what the client has paid and what remains due;
- money received and held for a trip or supplier obligation;
- what WMIT owes suppliers;
- WMIT fees and other revenue components;
- expected and actual gross profit.

An invoice being paid is not, by itself, proof that WMIT has earned all of that money.

The first implementation after this reset should therefore be **architecture validation and read-only WMIT discovery**, followed by a small operational slice that proves the new concepts with synthetic data. Phase 3C and production integrations remain paused.

## B. Actual WMIT end-to-end lifecycle

### B1. Lifecycle overview

```text
Inquiry received
    ↓
Client/contact/travel-party context identified
    ↓
Request researched and one or more options developed
    ├─ Wholesaler package: availability checked before presentation
    └─ Custom arrangement: quotation may precede availability checking
    ↓
Option presented / quotation sent
    ↓
Client chooses, changes, rejects, or asks for alternatives
    ↓
Client confirmation and payment evidence handled
    ↓
Booking created or updated for the actual confirmed product
    ↓
Supplier booking(s) requested, reserved, confirmed, amended, or cancelled
    ↓
Client payments, supplier obligations, and profit visibility maintained
    ↓
Documents collected, classified, reviewed, and associated
    ↓
Pre-departure preparation and reminders
    ↓
Departure / travel delivery
    ↓
Completion, cancellation, refund, or post-trip closeout
```

### B2. Detailed lifecycle

1. **Capture the inquiry.** Record the source channel, received time, communicating person, original request, known party size, desired destination/date/budget, and assigned staff member. Preserve the original request even if it later changes.

2. **Identify people and the travel party.** Determine whether the communicating person is the traveler, a contact for other travelers, a group organizer, or an existing client. Do not assume one inquiry means one traveler.

3. **Research options.** Staff may search wholesalers, supplier packages, DMC tariffs, supplier quotations, airfare portals, or other approved sources. The work may produce no suitable option, one option, or several alternatives.

4. **Apply the correct sales path.** A wholesaler package requires an availability check before presentation. A custom quotation can be prepared from tariff information or a requested supplier quotation before availability is checked. The system must record which path was used and what evidence supported the option.

5. **Present an option or quotation.** The client-facing output must omit supplier cost, markup/margin, internal notes, and restricted supplier information. Supplier-provided selling prices and WMIT adjustments must be distinguishable internally.

6. **Handle client changes.** Destination, dates, budget, travelers, or services may change. The inquiry remains the history of the request; the selected option and eventual booking reflect what was actually agreed. The real August-to-October example is a required design case.

7. **Record client confirmation.** WMIT's usual meaning of confirmed is verbal/client confirmation plus receipt of a deposit or payment. Quotation acceptance alone must not automatically create a confirmed booking. WMIT may reserve a supplier before client payment in some cases, so supplier activity and client confirmation cannot be collapsed into one state.

8. **Create or update the Booking.** The booking should reflect the actual selected and confirmed product, not merely copy the initial inquiry. It must support multiple travelers, services, suppliers, payments, and documents.

9. **Procure from suppliers.** WMIT may send a booking request, reserve through a supplier portal, pay before confirmation, or receive a confirmation/voucher after payment. Supplier deadlines, deposits, non-refundable rules, and book-and-buy requirements are recorded separately from the client's payment state.

10. **Manage money operationally.** Record client receipts, verification, allocation, client balance, supplier obligations, supplier payments, fees, costs, and expected profit. Do not represent the entire client receipt as WMIT revenue.

11. **Prepare travel documents and departure.** Collect and associate confirmations, vouchers, invoices, payment evidence, travel documents, reminders, and PDOS information. The system should show missing or late operational items without inventing completion.

12. **Close out.** Completion, supplier failure, cancellation, amendment, credit, refund, or forfeiture must be represented according to the applicable supplier and client terms. There is no single universal cancellation rule.

### B3. Important lifecycle consequences

- An inquiry can produce several presented alternatives and no booking.
- A client can have several unrelated inquiries and bookings.
- A booking can exist even when no formal quotation was used.
- A quotation can exist without becoming a booking.
- A supplier booking can exist before the client has paid.
- A booking can be financially partially paid while operationally supplier-confirmed, or financially paid while supplier confirmation is still pending.
- A wholesaler departure can group separate WMIT bookings without merging them.

## C. Core concepts/entities

### C1. Known business concepts

| Concept | Business meaning | Must remain distinct from |
|---|---|---|
| Inquiry | An incoming request or opportunity from a source channel | Client, quotation, booking |
| Client | WMIT's ongoing customer relationship/account | Individual traveler or one trip |
| Contact | A person communicating or coordinating with WMIT | All travelers in the party |
| Traveler | A person who may travel on a booking | The communicating contact |
| Travel party | The travelers and coordinating contact for a request/booking | A client account and a supplier departure |
| Supplier | Umbrella term for wholesalers, DMCs, service suppliers, and relevant airfare sources | WMIT, client, booking |
| Supplier Package | A supplier-originated package or group-departure product | Custom quotation |
| Custom Quotation | A WMIT-created commercial proposal | Supplier package, booking, invoice |
| Booking | WMIT's record of the actual selected/confirmed travel arrangement | Supplier booking, invoice, payment |
| Booking item/service | A flight, hotel, tour, transfer, ticket, visa assistance, insurance, land arrangement, fee, or other sold component | The whole booking |
| Supplier Booking | WMIT's supplier-side request, reservation, or confirmation | Client booking |
| Departure | A group/departure grouping, especially a wholesaler departure | Financially merged bookings |
| Invoice | A client-facing or operational billing document/record | Payment, revenue, supplier payable |
| Client payment | Money received or reported from a client | WMIT profit or supplier payment |
| Supplier payable | Operational amount WMIT owes a supplier | Client balance or WMIT revenue |
| Supplier payment | Money WMIT pays to a supplier | Client payment |
| Document | A received or generated file/evidence item | The structured business record itself |
| Task/deadline | Work or a required action with an owner and due time | A status alone |
| Audit/action log | History of important actions and changes | A current record state |

### C2. Working architectural principle

The system should have one authoritative structured record for each business object and explicit links between records. Files are evidence and outputs; they do not replace structured records. Names are searchable labels, not relationship keys. Relationships should use immutable record IDs once implementation begins.

### C3. Assumptions and unresolved design boundaries

**Working assumptions:** the system needs both operational current state and enough history to explain important changes; a booking item is the natural place to attach a service, supplier, cost, selling amount, and departure relationship when a booking contains mixed services.

**UNKNOWN / NEEDS WMIT VALIDATION:** whether WMIT wants a separate Travel Party record or can initially represent party membership through inquiry/booking participant links; whether a Client can represent a person, household, or organization; and whether any one booking may span different trips or departures.

## D. Entity relationship model

The following is a conceptual relationship model, not a database schema.

```text
Client 1 ───────< Inquiry >────── 0..1+ Contact / Travel Party
  │                   │
  │                   └──────< Presented Option / Custom Quotation
  │                                         │
  └──────< Booking >──────< Booking Item >─┼────── 0..1 Departure
             │                 │           │
             │                 │           └──────< Supplier Booking Item >──── Supplier Booking >──── Supplier
             │                 │
             │                 └────── Supplier / Supplier Package / tariff evidence
             │
             ├──────< Booking Traveler >──── Traveler / Contact
             ├──────< Invoice >────< Client Payment Allocation >──── Client Payment
             ├──────< Supplier Payable >────< Supplier Payment
             ├──────< Document Link >──── Document
             └──────< Task / Deadline

Supplier ─────< Supplier Package
Supplier ─────< Tariff / Supplier Quote / source documents
Inquiry ──────< Alternatives and outcomes
All important records ─────< Audit / Action Log
```

### D1. Cardinality principles

- One Client may have zero or many Inquiries and zero or many separate Bookings.
- One Inquiry may involve one or more contacts/travelers and may lead to zero, one, or more options or quotations.
- One Booking has one commercial client/account relationship but may have many travelers and booking items.
- One Booking may have many Suppliers through its booking items and many Supplier Bookings.
- One Supplier Departure may be linked to many independent WMIT bookings.
- One Invoice may relate to one or more booking items or bookings only if WMIT validates that operational need; the model must not assume one invoice per booking.
- One Client Payment may be allocated to one or more client obligations only if WMIT accepts that practice; unallocated or unapplied receipts must be possible during verification.
- One Document may be linked to several related records, but the primary relationship and review status must remain clear.

### D2. Relationship rules

- A name match is not sufficient to link records.
- A supplier document may suggest a match but should not silently create or confirm a business record.
- A departure link groups bookings operationally and never merges financial balances.
- The confirmed Booking must link to the actual selected option/product, with the original Inquiry retained for history.

## E. Inquiry model

### E1. Known

Inquiries arrive through Facebook Messenger/page, Facebook comments, personal Facebook chats, WhatsApp, Viber, email, phone, SMS, walk-ins, referrals, existing clients, website, travel fairs/events, and other sources. B2B is currently outside this workflow.

An inquiry can change destination, dates, budget, party size, or product. Staff may offer alternatives when the first request cannot be fulfilled.

### E2. Proposed conceptual information

An Inquiry should capture:

- immutable Inquiry ID;
- source channel and source detail;
- received date/time and staff owner;
- communicating contact and known client relationship;
- original request text/summary;
- original destination, dates/date flexibility, budget, party estimate, and preferences when known;
- current or latest requested direction, kept separate from the original request;
- alternatives researched or presented;
- chosen option, if any;
- follow-up state and next action date;
- outcome and reason when closed;
- linked documents or message evidence where appropriate.

The inquiry is not required to contain a final destination or final traveler list. Missing information is a normal state, not an invalid record.

### E3. Inquiry states

Recommended operational states are:

`New` → `Contacted` → `Researching` → `Option(s) Presented` → `Awaiting Client` → `Converted to Booking` or `Closed - No Sale`.

`Awaiting Supplier` and `Awaiting Client Information` may be attention states or task reasons rather than separate lifecycle states. The user interface should show the reason without multiplying statuses unnecessarily.

### E4. Assumptions and unknowns

**Working assumptions:** one inquiry can have a history of alternatives; a follow-up must have a due date and owner; the original request should be retained even after the request changes.

**UNKNOWN / NEEDS WMIT VALIDATION:** whether staff currently use one inquiry per message thread or one inquiry per travel opportunity; how duplicate inquiries are identified; whether one inquiry may produce multiple separate bookings; whether personal/social handles should be stored as structured fields or only as source notes; and the required retention/privacy rules for message content.

## F. Client/contact/traveler model

### F1. Known

A client may be new, recurring, or VIP/important. One client may have multiple separate trips/bookings. A booking may contain multiple travelers. One traveler/contact may communicate for the entire group. A group chat may include several participants.

### F2. Recommended separation

- **Client:** the customer relationship used for history, service, and billing context. It should not be equated with one trip.
- **Person/contact:** an identifiable person who communicates with WMIT or has a role in a trip. A person may be the client, coordinator, traveler, payer, emergency contact, or group-chat participant.
- **Traveler:** a role for a person attached to a booking. A traveler may also be the communicating contact, but that is not assumed.
- **Travel party:** a practical grouping of the people associated with one inquiry or booking, including a coordinator when applicable.
- **Booking participant link:** the role-based connection between a Booking and each person, with traveler/contact/coordinator/payer labels as needed.

This avoids creating one fake “client” record for every traveler and avoids losing the group organizer's relationship to the booking.

### F3. Access and data minimization

Identity/passport and sensitive travel-document fields should be collected only when necessary for the relevant service. They should not be broadly exposed on dashboards or in general staff views. Exact required fields and access levels are **UNKNOWN / NEEDS WMIT VALIDATION**.

### F4. Assumptions and unknowns

**Working assumptions:** a person can be both contact and traveler; a client can recur across bookings; booking membership must be many-to-many between bookings and people with roles.

**UNKNOWN / NEEDS WMIT VALIDATION:** whether a traveler can belong to more than one client relationship; whether the payer must be a person on the booking; whether a client may be a household/company; the canonical duplicate-matching fields; and the minimum traveler information required before supplier reservation or confirmation.

## G. Supplier model

### G1. Known

WMIT uses **Supplier** as the umbrella term. Suppliers can include wholesalers with group departures, DMCs providing tariffs or land arrangements, other service suppliers, and airfare sources/portals where appropriate. Supplier Type may be stored, but terminology should remain Supplier.

### G2. Proposed conceptual information

A Supplier record may include:

- Supplier ID and legal/display name;
- Supplier Type, if useful for filtering;
- contact channels and responsible contact;
- destination/service coverage;
- portal or source reference, without storing credentials;
- payment terms and typical deadlines;
- deposit, cancellation, and refund terms as source facts;
- preferred/active status;
- documents and tariff/source relationships;
- internal performance notes and audit history.

Supplier terms should be treated as evidence with an effective date and source document where possible. A generic default rule must not override supplier-specific terms.

### G3. Assumptions and unknowns

**Working assumptions:** supplier type is descriptive metadata, not a separate business object; one booking can use several suppliers; supplier contacts and supplier portal references are operational data.

**UNKNOWN / NEEDS WMIT VALIDATION:** whether airfare portals should be modeled as Suppliers or as source adapters only; whether supplier branches/sub-agents need separate records; and which supplier terms must be structured versus retained as source text.

## H. Supplier package vs custom quotation model

### H1. Supplier Package

A Supplier Package is an existing supplier-originated product, such as a wholesaler package or group departure. It may include destination, dates, itinerary, inclusions, exclusions, supplier-provided selling price, capacity/availability, and a supplier departure reference.

For this path:

1. Staff searches supplier package information.
2. Staff checks availability **before** presenting the package as available.
3. WMIT records the availability result, timestamp, source, and any expiry or hold terms.
4. Staff presents the package and any WMIT-approved adjustment.
5. If selected, the actual package/departure is linked to the Booking.

An unavailable or stale package may be shown as an alternative lead, but it must not be represented as available.

### H2. Custom Quotation

A Custom Quotation is a WMIT-created proposal assembled from one or more sources, such as:

- supplier tariff files;
- a specific supplier/DMC quotation request;
- airfare portal results;
- WMIT service fees and adjustments;
- WMIT-selected itinerary and inclusions.

For this path:

1. Staff researches tariffs or requests supplier quotes.
2. Staff calculates supplier cost, markup, fees, and client selling price.
3. WMIT may create and send the quotation before availability has been checked.
4. Availability or supplier confirmation is handled later or in parallel, according to the actual service.

The quotation must make the availability state visible internally so that a sent quotation is not mistaken for a confirmed arrangement.

### H3. Shared and non-shared concepts

Both paths can lead to a Booking and supplier procurement. They can both have client-facing descriptions, dates, travelers, services, documents, and payment terms.

They must not share one undifferentiated “product/quotation” record because:

- availability timing differs;
- a supplier package may already have a supplier selling price;
- a custom quotation contains WMIT-generated pricing and potentially multiple suppliers;
- the evidence supporting the price and availability is different;
- a package may be a group departure that must be grouped operationally.

**UNKNOWN / NEEDS WMIT VALIDATION:** whether WMIT wants a formal “Presented Option” record for every package presentation and alternative, or whether the first version can store the presented option as an inquiry outcome plus linked source evidence. A lightweight option record is recommended if management needs to compare rejected alternatives later.

## I. Quotation model

### I1. Known

Staff can see supplier cost, markup, and client selling price. Clients cannot see supplier cost, markup/margin, internal notes, or internal supplier information.

Markup is often around 30% for specific quotations but is not universal. A quotation can contain services from multiple suppliers. Staff can edit a quotation after creation. Formal versioning is not currently required, but important changes must be auditable.

### I2. Proposed structure

A Custom Quotation should include:

- quotation ID, inquiry ID, client/contact context, and status;
- quotation date, validity, currency, destination, dates, and party summary;
- internal cost view and client-facing selling view;
- one or more quotation items/services;
- for each item: description, dates, quantity, supplier/source, supplier cost, client selling amount, pricing basis, and notes;
- itinerary, inclusions, exclusions, payment terms, and assumptions;
- taxes/fees, service fees, visa assistance fees, ticketing fees, insurance, bank charges, conversion fees, and discounts as separately labeled amounts or rules;
- availability state and supporting source evidence;
- internal notes and client-safe notes kept separate;
- created/updated/approved/sent metadata and audit/action history;
- linked client-facing output/document, if one was issued.

Supplier cost and markup must never be rendered into the client-facing output. A client-facing quotation should be a deliberate projection, not a filtered dump of internal fields.

### I3. Editing without formal versioning

Formal quotation version numbers are not required by the current answers. However, after a quotation is sent, the system should preserve the sent artifact or a change snapshot so management can determine what the client saw. Every important change should record who changed what, when, old value where appropriate, and new value.

This is a working recommendation, not a claim that WMIT already follows this practice.

### I4. Quotation outcomes

A quotation can be:

`Draft`, `Internally Reviewed`, `Sent`, `Awaiting Client`, `Accepted for Proceeding`, `Rejected`, `Expired`, or `Superseded/Withdrawn`.

`Accepted for Proceeding` does not equal a confirmed Booking. Confirmation depends on the separate client-confirmation and payment rule.

### I5. Assumptions and unknowns

**Working assumptions:** quotation items are the main pricing unit; mixed suppliers are allowed; the system should calculate displayed totals from structured values while preserving manually entered source values when needed; a quotation may be created without a Booking.

**UNKNOWN / NEEDS WMIT VALIDATION:** whether all quotation amounts must share one currency; whether taxes are included or pass-through; whether WMIT uses a standard markup formula or item-specific adjustments; whether supplier-provided selling prices should be copied as a source amount or treated as a final client price; and which fields require manager approval before sending.

## J. Booking model

### J1. Business meaning

A Booking is WMIT's operational record for the actual selected travel arrangement. It is not merely a converted quotation and is not an invoice. It should be linked to the inquiry and selected option where known, but it must remain usable when the actual workflow did not use a formal quotation.

The Booking must represent the October wholesaler package in the real example, even though the original inquiry requested a cheap August local holiday.

### J2. Booking structure

A Booking should support:

- one independent booking ID;
- client/account and coordinating contact;
- one or more booking participants/travelers;
- actual destination/date range and date flexibility where relevant;
- booking items/services;
- selected Supplier Package or Custom Quotation source, if applicable;
- multiple Suppliers through booking items;
- client price/selling amounts and internal cost references;
- client commitment and payment state;
- supplier fulfillment state;
- client invoices/payment allocations;
- supplier obligations/payments;
- documents, tasks, deadlines, and pre-departure checklist;
- departure/grouping links where applicable;
- cancellation/amendment notes and evidence;
- audit/action history.

### J3. Booking confirmation rule

The current business answer says “confirmed” usually means verbal/client confirmation **and** deposit/payment received. The architecture should therefore avoid automatically marking a Booking confirmed when a quotation is accepted.

Recommended separate indicators:

- client decision: not decided, selected verbally, declined, or changed;
- client payment: none, pending verification, partial, sufficient deposit, fully paid;
- client commitment: provisional/awaiting payment, confirmed, cancelled;
- supplier fulfillment: not requested, requested, reserved, confirmed, failed, cancelled.

This allows WMIT to represent a supplier reservation made before client money without falsely declaring the client booking fully confirmed.

### J4. Assumptions and unknowns

**Working assumptions:** a booking may be created in a provisional state before final confirmation; booking items are independently trackable; a booking may be created from a package, custom quotation, or direct operational action.

**UNKNOWN / NEEDS WMIT VALIDATION:** whether WMIT wants one booking per travel party or permits multiple booking records for one party; how amendments are represented; the exact minimum conditions for a confirmed booking; and whether a booking may contain multiple departure dates.

## K. Supplier Booking model

### K1. Business meaning

A Supplier Booking is WMIT's supplier-side transaction. It represents a request, reservation, purchase, confirmation, or supplier reference and is separate from the client-facing Booking.

One WMIT Booking may have many Supplier Bookings, and one Supplier Booking may cover multiple Booking Items when the supplier confirms them together. A Supplier Booking may exist before client payment because WMIT sometimes reserves first.

### K2. Supplier Booking information

Capture, where known:

- Supplier Booking ID and Supplier;
- linked WMIT Booking Item(s);
- supplier reference and channel/portal;
- request/reservation/confirmation timestamps;
- supplier cost, currency, deposit, balance, and payment terms;
- supplier deadline, hold expiry, ticketing deadline, or cancellation deadline;
- confirmation/voucher state;
- supplier cancellation/refund/non-refundable terms;
- responsible WMIT staff member;
- related supplier documents;
- amendment and failure history;
- linked Supplier Payable and Supplier Payment records.

### K3. Supplier-side flows

**Request flow:** client commitment → WMIT sends request → supplier responds → WMIT records confirmation/voucher → WMIT pays supplier as required.

**Portal flow:** client commitment → WMIT reserves through portal → supplier requires payment or issues confirmation → WMIT records the result.

**Reserve-before-client-payment exception:** WMIT may reserve before receiving client money. This requires an explicit risk/approval indicator and a deadline task; it must not be hidden inside a generic booking status.

### K4. Assumptions and unknowns

**Working assumptions:** supplier deadlines are first-class tasks; supplier cost is not the same as the client amount; a supplier confirmation document does not replace the structured Supplier Booking record.

**UNKNOWN / NEEDS WMIT VALIDATION:** whether the first Supplier Booking record is created when a request is sent or only after a reservation; whether a supplier reference can span multiple WMIT bookings; who may approve reserve-before-payment; and how supplier changes, credits, and cancellations should be represented.

## L. Departure/grouping model

### L1. Known

Separate WMIT bookings must remain independent. Management needs to group bookings belonging to the same wholesaler departure and see total WMIT travelers, number of WMIT bookings, shared supplier/departure information, and operational status.

### L2. Proposed model

A Departure is an operational grouping, especially for a wholesaler departure. It may contain:

- Supplier and supplier departure/reference;
- destination and departure date;
- return date or duration when known;
- package/product description;
- capacity or supplier count when available;
- WMIT booking and traveler counts derived from links;
- group-level deadlines, vouchers, documents, and readiness indicators;
- operational exceptions.

Bookings remain separate financial and client records. A departure dashboard aggregates them; it does not merge their invoices, payments, supplier balances, or profit.

The link should be available at Booking Item level if a booking can contain services with different departures. A booking-level shortcut may be derived when all relevant items share the same departure.

### L3. Assumptions and unknowns

**Working assumption:** a Booking Item can carry the departure relationship, with a derived booking-level view.

**UNKNOWN / NEEDS WMIT VALIDATION:** whether one booking can contain more than one departure; whether WMIT needs supplier capacity/remaining seats; and whether a departure can include non-wholesaler custom bookings.

## M. Invoice and client payment model

### M1. Business meaning

Invoice and payment are separate concepts. Installments are allowed. Payment methods include bank transfer, cash, card, GCash, PayPal, and other methods. Payment schedules are often supplier-determined, while WMIT's general operating rule is full trip payment at least one month before departure.

### M2. Invoice model

An Invoice is an operational client-billing record or document. It should support:

- client and related booking/item references;
- invoice number and dates;
- line amounts, fees, discounts, taxes/charges where applicable;
- total due and payment terms;
- deposit/installment expectations;
- client-safe description;
- status and approval/sent metadata;
- payment allocations and balance;
- related document/output;
- audit history.

The invoice must not be treated as the ledger of WMIT revenue, the Supplier Payable, or proof that funds are earned.

### M3. Client payment model

A Client Payment should capture:

- payment ID and client/booking/invoice relationship;
- amount and currency;
- method;
- received date/time and reference;
- evidence/document link;
- verification state;
- allocation to invoice, booking, deposit, or other client obligation;
- amount unallocated or held, if applicable;
- refund/reversal/chargeback state when applicable;
- staff verifier and audit trail.

The model must allow:

- multiple payments per booking;
- partial payment;
- full payment;
- payment before invoice, if WMIT does this;
- payment evidence pending verification;
- a payment that is received but not yet allocated;
- refunds or reversals without rewriting the original receipt.

### M4. Balance terminology

At minimum, the system should distinguish:

- **Client amount due:** the current verified obligation from the client;
- **Client amount received:** verified receipts;
- **Client amount allocated:** receipts applied to a particular obligation;
- **Client balance:** amount due less applicable verified allocations;
- **Client money held/committed:** amount received for the trip or supplier obligation, not automatically WMIT revenue.

The exact allocation and refund rules are **UNKNOWN / NEEDS WMIT VALIDATION**.

### M5. Example

For a PHP 100,000 client charge, PHP 100,000 verified client payment, and PHP 80,000 supplier cost, the operational view should be able to show:

```text
Client amount paid:       PHP 100,000
Client balance:            PHP 0
Supplier payable:          PHP 80,000
Expected WMIT gross margin: PHP 20,000
```

This does not state when accounting revenue is recognized and is not a full accounting treatment.

### M6. Assumptions and unknowns

**Working assumptions:** payment verification is separate from payment entry; original payment records are immutable except for controlled status changes; invoice and booking balances are derived from structured amounts and allocations.

**UNKNOWN / NEEDS WMIT VALIDATION:** whether invoices can cover multiple bookings; whether a booking can have multiple invoices; whether payments can be recorded without an invoice; who verifies cash/card/e-wallet evidence; the formal installment schedule rules; and the treatment of taxes, bank charges, card fees, and foreign exchange.

## N. Supplier payable/payment model

### N1. Business meaning

WMIT needs an operational view of what is payable to suppliers, separate from client receipts and separate from full accounting. A Supplier Payable is the amount WMIT expects or is required to pay for a Supplier Booking or supplier-covered booking items.

### N2. Proposed operational record

Capture:

- Supplier Payable ID;
- Supplier Booking and Booking Item references;
- supplier and supplier reference;
- expected cost, currency, and cost basis;
- deposit, balance, and due dates;
- payment terms and non-refundable status;
- amount paid to supplier;
- remaining payable;
- payment status and exception state;
- linked supplier documents and Supplier Payments.

A Supplier Payment records money WMIT paid to the supplier, including amount, date, method, reference, evidence, verifier, and related payable. It must not reduce the client balance.

### N3. Safe operational controls

- Do not mark a supplier payable paid merely because a client invoice is paid.
- Do not mark a supplier confirmation received merely because WMIT sent a request.
- Do not overwrite a supplier cost after payment without an adjustment/audit action.
- Keep supplier deposit and final balance visible separately when terms require it.
- Generate deadline tasks from supplier terms, with the actual source and due date visible.

### N4. Assumptions and unknowns

**Working assumption:** supplier payable is an operational commitment ledger, not a replacement for accounting accounts payable.

**UNKNOWN / NEEDS WMIT VALIDATION:** whether supplier payable should be one record per Supplier Booking or per supplier invoice/deposit; whether supplier credits/refunds need to be tracked in v1; and which supplier-payment approvals are required.

## O. Profit/margin model

### O1. Objective

Management wants profitability visibility. The system should show expected and actual operational margin without pretending to be a full accounting or tax system.

### O2. Recommended measures

At Booking and Booking Item level, show separately:

- client selling amount;
- discounts;
- client-facing service fees and other WMIT charges;
- supplier cost, with supplier and currency;
- other direct trip costs if WMIT identifies them;
- expected gross profit;
- expected gross margin percentage;
- verified client receipts;
- supplier payable and supplier payments;
- actual/updated cost when confirmed supplier information differs from the quote;
- refund, cancellation, credit, or write-off adjustments when approved.

A simple operational formula may be:

```text
Expected gross profit = expected client selling value - expected direct supplier/service cost
Expected gross margin % = expected gross profit / expected client selling value
```

Fees, taxes, bank charges, airfare, insurance, and pass-through amounts must remain separately labeled so the formula is not misleading.

### O3. What this does not claim

This model does not determine legal revenue recognition, Philippine tax treatment, payroll allocation, cash-basis accounting, accrual accounting, or financial-statement presentation. Those are outside this operational architecture.

### O4. Assumptions and unknowns

**Working assumptions:** profit should be visible at least at booking level and preferably at item level; quoted cost and confirmed supplier cost may differ and both should be retained; management needs expected versus updated/actual operational margin.

**UNKNOWN / NEEDS WMIT VALIDATION:** whether WMIT includes service fees in gross profit; how discounts are allocated across items; how refunds and supplier penalties affect margin; the treatment of FX conversion; and the formal definition of “actual” cost before trip completion.

## P. Document model

### P1. Known

Documents arrive through email, Messenger, WhatsApp, Viber, Google Drive, supplier portals, and other channels. They include supplier quotations, supplier confirmations, vouchers, invoices, client quotations, payment evidence, travel documents, and pre-departure documents. Current Google Drive storage is inconsistent and random.

### P2. Proposed document record

A Document record should store metadata such as:

- Document ID;
- source channel and received date/time;
- file name/type/size and controlled file reference;
- document type and classification confidence;
- supplier/client/booking/inquiry/departure references when known;
- primary related record and additional links;
- review state: received, needs review, accepted, rejected, superseded;
- extracted facts as reviewable suggestions, not automatic business truth;
- sensitivity/access classification;
- owner and audit history.

The future repository should make files findable by stable business IDs and metadata. The exact Drive folder structure and Google Workspace implementation are intentionally deferred.

### P3. Safety rules

- A document may support a record but does not automatically confirm it.
- A supplier quotation is not automatically a Supplier Booking.
- A payment screenshot is not automatically a verified Client Payment.
- Conflicting documents must be flagged for human review.
- Sensitive traveler documents should not appear in general dashboards or broad links.

### P4. Assumptions and unknowns

**Working assumptions:** many-to-many document links are useful, with one primary relationship; source and review metadata are needed; document classification/extraction may be automated later but commit actions require validation.

**UNKNOWN / NEEDS WMIT VALIDATION:** authoritative document when supplier quotation, confirmation, voucher, invoice, or memo conflict; retention periods; naming conventions; who may see passport and payment evidence; and whether WMIT needs document checksum/duplicate detection in v1.

## Q. Follow-up/task/deadline model

### Q1. Known

Management needs visibility into new inquiries, follow-ups, payments due, departures this week, outstanding client balances, supplier deadlines, and operational exceptions. Supplier deadlines are often around three days after request but vary. Reminder timing may include two days before and one day before.

### Q2. Proposed task types

Use one controlled Task/Deadline model with a required type and related record:

- inquiry follow-up;
- waiting for client information;
- quotation follow-up;
- client payment due;
- supplier booking request;
- supplier deposit/payment due;
- supplier hold/ticketing/cancellation deadline;
- missing supplier confirmation/voucher;
- missing traveler document;
- invoice/payment verification;
- pre-departure document preparation;
- PDOS preparation;
- client reminder;
- operational exception review.

Each task should have an owner, related record ID, due date/time, source, priority, status, notes, and completion evidence.

### Q3. Neutral operational language

Use:

- `Due`
- `Due soon`
- `Awaiting action`
- `Pending`
- `Requires attention`
- `Completed`
- `Cancelled`

Do not label every incomplete item “overdue.” A past due date may be shown as a separate fact, but the operational state should distinguish a missed commitment from an item deliberately awaiting a supplier or client.

### Q4. Assumptions and unknowns

**Working assumptions:** tasks are generated from dates and terms but remain reviewable; reminders should be idempotent and not duplicate on every run; a task can be reassigned with an audit entry.

**UNKNOWN / NEEDS WMIT VALIDATION:** escalation rules; business hours and timezone; whether reminders are internal only or may send external messages; standard follow-up intervals; and who can close or override a deadline.

## R. Pre-departure model

### R1. Known

Typical preparation includes final documents, vouchers, travel reminders, PDOS, and client communication. PDOS is usually one to two weeks before departure. Other final preparation generally starts around one week before departure.

### R2. Proposed checklist

A Pre-Departure record or derived checklist should be linked to the Booking/Departure and include:

- traveler/document completeness;
- confirmed supplier bookings;
- final vouchers and tickets;
- client balance status;
- outstanding supplier obligations or confirmations;
- reminder tasks;
- PDOS date/status;
- final client communication;
- readiness exceptions and owner.

The checklist should derive from booking items and traveler requirements where possible rather than requiring staff to retype the same facts.

### R3. Assumptions and unknowns

**Working assumptions:** readiness is a view of several independent conditions, not one manually typed status; deadlines should be calculated from departure date only when the rule is approved; missing data should be visible as an exception.

**UNKNOWN / NEEDS WMIT VALIDATION:** whether PDOS applies to every booking; the exact final-document checklist by destination/product; who conducts PDOS; and whether a departure-level orientation covers multiple bookings.

## S. Status/state models

WMIT should avoid one global status for a complex booking. The following are recommended starting states, subject to validation.

| Record | Suggested states | Important separation |
|---|---|---|
| Inquiry | New, Contacted, Researching, Option Presented, Awaiting Client, Converted, Closed | Waiting reason should be visible |
| Package availability | Not Checked, Available, Unavailable, Held/Reserved, Expired, Superseded | Available requires evidence and timestamp |
| Custom Quotation | Draft, Reviewed, Sent, Awaiting Client, Accepted for Proceeding, Rejected, Expired, Superseded | Accepted is not confirmed booking |
| Booking client commitment | Provisional, Awaiting Payment, Client Confirmed, Confirmed, Cancelled, Completed | Confirmed normally requires verbal confirmation plus payment |
| Booking supplier fulfillment | Not Started, In Progress, Partially Confirmed, Confirmed, Failed, Cancelled | Independent from client payment |
| Supplier Booking | Draft, Requested, Reserved, Confirmation Pending, Confirmed, Cancelled, Completed | Request is not confirmation |
| Invoice | Draft, Approved, Sent, Partially Paid, Paid, Cancelled | Paid is not revenue recognition |
| Client Payment | Entered, Pending Verification, Verified, Rejected, Reversed/Refunded | Entered is not verified |
| Supplier Payable | Expected, Due, Partially Paid, Paid, Disputed, Cancelled | Supplier payment is separate |
| Document | Received, Needs Review, Accepted, Rejected, Superseded | Extraction is not acceptance |
| Task/deadline | Pending, Due Soon, Due, Awaiting Action, Requires Attention, Completed, Cancelled | Avoid casual “overdue” |

### S1. State transition principles

- Transitions must validate the required evidence and relationships.
- High-impact transitions require human confirmation according to policy.
- A failed supplier search or failed supplier booking must remain visible; it must not silently return the record to a generic pending state.
- Cancellation, refund, reversal, and supplier failure require reason, source evidence, and audit history.

### S2. Unknowns

The exact legal statuses, approval thresholds, cancellation states, amendment states, and completion criteria are **UNKNOWN / NEEDS WMIT VALIDATION**. The table is an architecture starting point, not an approved state machine.

## T. Roles and permissions

### T1. Known role boundaries

- Approximately six staff use the system.
- Managers/admin need full operational and financial/profit visibility, including sensitive information.
- Staff need normal sales and operations access to clients, quotations, bookings, supplier coordination, payments, documents, and follow-ups.
- Interns should not automatically receive full staff access and may not see supplier costs, margins, or sensitive financial information.

### T2. Recommended access model

Use role-based access with field-level or view-level restrictions where necessary:

| Role | Expected access |
|---|---|
| Manager/Admin | Full operational visibility, approvals, costs, supplier obligations, payments, profit, sensitive records |
| Staff | Sales and operations records, client-safe and necessary internal data, supplier coordination, payment entry, documents, tasks |
| Intern | Restricted assigned tasks and approved operational views; no default access to supplier cost, margin, sensitive documents, or high-impact financial actions |

A separate Finance role may be introduced only if WMIT needs it; it should not be invented as a requirement merely because finance data exists.

### T3. Client-facing protection

Client-facing quotations, invoices, vouchers, and messages must use explicit projections/templates that exclude supplier cost, markup/margin, internal notes, and restricted supplier details.

### T4. Assumptions and unknowns

**Working assumptions:** least privilege applies; interns require restricted access by default; sensitive documents and financial fields need separate controls; all roles use controlled functions rather than arbitrary record edits.

**UNKNOWN / NEEDS WMIT VALIDATION:** named users and role assignments; who can approve discounts, refunds, supplier purchases, and payment verification; whether staff can see one another's financial details; and whether client data needs branch/team partitioning.

## U. Audit/action log

Every meaningful action should record:

- actor/user or system process;
- timestamp;
- action type;
- record type and immutable record ID;
- old value where applicable;
- new value where applicable;
- reason/source or linked document where relevant;
- result: success, rejected, failed, or pending;
- error/detail when applicable;
- approval/confirmation reference for high-impact actions.

Audit history is especially important for quotation prices, supplier costs, discounts, client payments, supplier payments, refunds, booking changes, status changes, document links, and permissions.

The audit log is not a replacement for current-state data. It explains how the current state was reached.

## V. Dashboard requirements

### V1. Management dashboard

Eventually show:

- new inquiries and inquiry source mix;
- inquiries awaiting follow-up or client information;
- quotations awaiting action;
- client payments due and outstanding client balances;
- supplier deadlines and supplier obligations;
- departures this week and readiness exceptions;
- bookings by operational state;
- unconfirmed or failed supplier bookings;
- client money received/held for active trips;
- supplier payable and payment status;
- expected and updated gross profit;
- document exceptions and late vouchers;
- audit-sensitive changes requiring review.

### V2. Staff dashboard

Prioritize assigned and actionable work:

- new inquiries;
- follow-ups due soon;
- quotations to prepare or follow up;
- bookings awaiting client or supplier action;
- payment evidence awaiting verification;
- supplier deadlines;
- missing documents/vouchers;
- departures and pre-departure tasks.

Do not expose restricted management profit or supplier-cost information by default.

### V3. Dashboard rules

- Every count must link to the underlying records.
- Date filters and “as of” times must be visible.
- “Paid,” “confirmed,” “available,” and “profitable” must be based on their own states and evidence.
- Exceptions should explain why attention is required.
- No dashboard should imply live availability or confirmed travel unless an authorized verified source supports it.

## W. Notifications/alerts

### W1. Recommended alerts

Generate internal reminders for:

- inquiry follow-up due;
- quotation follow-up due;
- client installment or final payment due;
- supplier booking response/deposit/final-payment deadline;
- hold/ticketing/cancellation deadline;
- missing confirmation or voucher;
- departure readiness gap;
- PDOS preparation;
- payment evidence awaiting verification;
- unusual margin or price change requiring review;
- supplier failure or unavailable preferred option.

### W2. Alert behavior

- Support configurable lead times, including two days and one day before.
- Show due date, source, owner, and linked record.
- Avoid duplicate alerts on retries.
- Escalate only according to approved policy.
- Keep external client or supplier messages behind explicit confirmation where required.
- Record notification attempts and failures.

External messaging integrations are deferred. Internal visibility can be designed first.

## X. Automation opportunities

Automation should follow the business pain, not the availability of AI.

### X1. Highest-value, lower-risk opportunities

1. **Follow-up and deadline control:** create tasks from inquiries, quotation sends, supplier requests, payment terms, and departure dates.
2. **Payment tracking:** calculate outstanding balances, distinguish unverified receipts, and alert on client and supplier deadlines.
3. **Quotation calculation:** calculate item totals, fees, discounts, markup, and margin with visible inputs and approval boundaries.
4. **Voucher and document preparation:** generate drafts from confirmed booking data and flag missing fields.
5. **Tariff search/indexing:** make supplier tariff files searchable by destination, date, duration, pax, validity, and source, while retaining the source document.
6. **Departure grouping:** aggregate separate bookings by supplier departure and show traveler/booking counts.
7. **Profitability views:** calculate expected and updated operational margin without re-entering amounts.
8. **Document association:** suggest likely record links from IDs and structured evidence, requiring human review for uncertain matches.

### X2. Where AI may help later

AI may assist with document classification, extraction, summarization, drafting, duplicate detection, and natural-language search. It must not silently confirm availability, create financial commitments, verify payments, change prices, issue refunds, or commit low-confidence extracted data.

### X3. Eliminate and simplify before automating

Before building an automation, WMIT should check whether a standard folder convention, tariff index, quotation template, payment checklist, or deadline policy eliminates the underlying manual work. Some problems may be solved more reliably by a shared standard and a controlled spreadsheet view than by an AI agent.

## Y. Explicit non-goals

This architecture does not propose:

- a full accounting system;
- tax computation or statutory accounting treatment;
- payroll;
- HR, leave, or attendance management;
- an external itinerary platform;
- Google Workspace integration during this reset;
- production authentication or identity management;
- production data migration;
- automatic external booking or live travel availability without an authorized verified source;
- automatic refunds, financial adjustments, or supplier purchases;
- autonomous AI agents that bypass controlled business functions;
- B2B workflow in this current scope;
- a new CRM platform beyond the inquiry/client operational needs;
- a universal cancellation/refund engine before supplier rules are validated.

## Z. Remaining business decisions

The list is intentionally short. These decisions materially affect the architecture and should be resolved before implementation:

1. **Confirmation rule and exceptions:** What exact combination of client confirmation, payment/deposit, and approval makes a Booking “Confirmed”? When is reserve-before-payment allowed, and who approves it?
2. **Invoice/payment allocation:** Can invoices cover multiple bookings? Can payments be recorded before invoices? How are deposits, refunds, reversals, credits, and unallocated receipts represented?
3. **Booking/departure structure:** Can one booking contain multiple departures, or must the departure relationship live on booking items? Can a Supplier Departure include custom bookings as well as wholesaler packages?
4. **Pricing/profit treatment:** How are fees, taxes, discounts, FX, airfare, supplier-provided selling prices, and cancellation costs treated in WMIT's operational gross-profit calculation?
5. **Minimum data and permissions:** What traveler/document fields are required at each stage, and which named roles may view or change sensitive data, costs, margins, payments, refunds, and supplier purchases?

Other questions should be answered during read-only discovery and staff review, but they should not block a small synthetic proof of the core model unless they change one of these decisions.

## AA. Risks and failure modes

| Risk/failure mode | Consequence | Required control |
|---|---|---|
| Original inquiry is mistaken for final product | Booking reflects August request instead of October selection | Preserve original request and link actual selected option |
| Wholesaler package shown without current availability | Client expectation or failed sale | Availability evidence, timestamp, and explicit state before presentation |
| Custom quotation treated as confirmed | WMIT commits before supplier/client confirmation | Separate quotation, client commitment, payment, and supplier fulfillment states |
| Supplier reserve occurs before client payment | WMIT cash exposure or non-refundable loss | Explicit exception flag, deadline, approval, and audit |
| Client payment treated as revenue | Profit and cash reporting become misleading | Separate receipt, held money, payable, revenue components, and margin |
| Supplier payment treated as client balance update | Client debt becomes inaccurate | Separate client and supplier ledgers |
| Multiple bookings in one departure are merged | Financial and client records become corrupted | Departure grouping only; independent booking IDs and balances |
| Payment evidence is duplicated or unverified | False balance or supplier purchase decision | Payment status, evidence, duplicate checks, verification owner |
| Supplier documents conflict | Wrong cost, date, or confirmation status | Source precedence and human review |
| Staff edits sent quotation without trace | Management cannot explain client-facing price | Sent artifact/snapshot and action history |
| Deadline lacks owner or source | Missed supplier/client action | Task owner, due date, source, reminders, escalation |
| Sensitive documents appear in broad views | Privacy and operational risk | Classification, least privilege, safe links, restricted dashboards |
| Duplicate client/inquiry records | Lost history and double follow-up | Duplicate suggestions and controlled merge policy |
| Data migration assumes prototype semantics | Existing records are misclassified | Read-only mapping, source IDs, confidence, owner review |
| Automation runs twice or partially fails | Duplicate payments, alerts, or documents | Idempotency keys, retries, logs, reconciliation, no partial silent commit |
| AI extracts low-confidence facts as truth | Wrong traveler, price, or booking | Review queue and explicit confidence; no silent commit |

## AB. Migration strategy from the current prototype

### AB1. Preserve and freeze

- Keep the current codebase, schemas, tests, and local prototype intact.
- Treat them as a working prototype and evidence of prior thinking, not as the target model.
- Do not delete, rewrite, or migrate production data because no production data is in scope.
- Pause Phase 3C and all further implementation until this architecture is reviewed.

### AB2. Inventory before mapping

Create a read-only inventory of the prototype's entities, relationships, statuses, fields, fixtures, and generated outputs. Record where the prototype's concepts are useful and where their names imply incorrect business rules.

### AB3. Map by business meaning, not by table name

The initial mapping should be conservative:

| Prototype concept | v2 treatment |
|---|---|
| Lead | Candidate source for Inquiry only; do not assume every Lead is a final sales opportunity |
| Client/contact fields | Reconcile into Client, Person/Contact, and booking participant roles |
| Quotation | Classify as Custom Quotation, package presentation evidence, or unknown; do not merge supplier packages into it |
| Quotation items | Candidate source for Custom Quotation Items or selected Booking Items after review |
| Booking | Candidate v2 Booking, but validate its confirmation meaning and actual product |
| Booking travelers | Candidate booking participant/traveler links |
| Supplier Booking | Preserve as supplier-side operational reference, then validate request/reservation semantics |
| Supplier/package/tariff records | Reclassify into Supplier, Supplier Package, tariff/source evidence, or unknown |
| Invoice | Preserve as client-billing evidence/record; validate relationship and status meaning |
| Payments | Separate client receipts from supplier payments and verify direction/status semantics |
| Documents | Preserve source references and add explicit record links during review |
| Departure/grouping | Add only after identifying actual supplier departure references; do not infer from similar dates alone |

No automatic mapping should change a record's business meaning merely because the field names look similar.

### AB4. Recommended migration stages later

1. Read-only discovery of actual WMIT spreadsheets, quotation/invoice examples, tariff files, and folder practices when Workspace access is approved.
2. Produce a field-level mapping and data-quality report with `known`, `assumed`, `unknown`, and `needs review` classifications.
3. Build synthetic fixtures that cover wholesaler package, custom quotation, changed inquiry, multiple travelers, shared departure, installment payments, supplier payment, and supplier failure.
4. Obtain owner/staff sign-off on the mapping and state meanings.
5. Migrate a small approved test set into a separate test environment, preserving source IDs and source files.
6. Reconcile counts, balances, links, documents, and profit calculations with staff.
7. Only then consider production migration with backup, rollback, and explicit approval.

## AC. Recommended implementation sequence

The next phase is not Phase 3C. It is **Architecture Validation and Read-Only Discovery**.

### Phase 0R — Architecture validation

- Review this document with the owner and relevant staff.
- Resolve the five decisions in section Z.
- Confirm actual quotation, invoice, payment, tariff, voucher, and departure examples.
- Confirm role boundaries and sensitive-data expectations.
- Keep Google Workspace and production data untouched during this phase.

### Phase 1R — Synthetic operational model

Using the approved architecture, design a small test-only slice for:

- Inquiry and changing inquiry request;
- Client/contact/traveler/party relationships;
- Supplier and Supplier Package;
- Custom Quotation with internal/client views;
- Booking and Booking Items;
- Supplier Booking and deadlines;
- Client Payment and Supplier Payment separation;
- operational margin view;
- shared Departure grouping;
- audit/action history.

This phase should prove business relationships before building broad screens or integrations.

### Phase 2R — Operational controls

Add controlled task/deadline handling, document metadata and review links, payment verification, pre-departure readiness, and dashboards. Continue using synthetic or explicitly approved test data.

### Phase 3R — Read-only Workspace discovery

When access is available, inspect existing WMIT files and spreadsheets without writing or migrating. Compare the architecture and synthetic model against real practice. Update the architecture only when evidence requires it.

### Phase 4R — Controlled implementation planning

After owner approval, decide whether Sheets plus Apps Script remains sufficient, define the minimal approved schema, permission model, migration plan, and test plan. Only then resume implementation.

No production Google Workspace setup, external supplier integration, authentication rollout, or AI-agent implementation should occur before these gates.

## What the current prototype got right

- It treated the system as local and preliminary rather than connected to Google Workspace or production data.
- It separated WMIT client-side records from supplier-side bookings.
- It allowed multiple booking items and multiple supplier bookings rather than enforcing one supplier per booking.
- It recognized that quotations, bookings, invoices, and payments are different records.
- It included audit logging, validation, exact-money handling, and failure-safe adapter boundaries.
- It recognized that documents should be reviewed and linked rather than blindly converted into business records.
- It recognized that client-facing quotation output should omit internal supplier cost and markup.
- It preserved the principle that financial changes and external commitments need controls.

## What the current prototype got wrong or oversimplified

- It centered the user journey on Lead → Quotation → Booking, which does not represent the two materially different WMIT sales paths.
- It treated “Lead” as the likely entry point instead of modeling the many inquiry channels and changing requests.
- It did not make the availability-before-presentation rule for wholesaler packages distinct from custom quotation behavior.
- It did not sufficiently separate Supplier Package from Custom Quotation.
- It treated the quotation-to-booking path too much like a conversion rather than an operational choice that may involve alternatives, direct bookings, or no formal quotation.
- It did not make the usual confirmation rule—verbal confirmation plus deposit/payment—central enough.
- It did not make reserve-before-client-payment a first-class risk and deadline case.
- It did not fully model the distinction between client money, supplier payable, WMIT revenue, and gross profit.
- It did not make shared wholesaler departures a clear operational grouping of independent bookings.
- It assumed or proposed statuses that could blur client commitment, supplier fulfillment, payment, and document states.
- It was still too close to a technical prototype before the underlying WMIT business architecture had been validated.

## What should be preserved

- The working prototype and its history.
- Controlled service boundaries and validation-first writes.
- Immutable IDs and audit/action history.
- Separate client and supplier operational records.
- Multiple booking items, suppliers, documents, and payments.
- Exact money calculations and no silent financial mutation.
- Reviewable document extraction and explicit source evidence.
- Local synthetic testing and the rule that Google Workspace remains disabled until approved.
- Human confirmation for financial commitments, refunds, external bookings, sensitive documents, and external communication.

## What should be redesigned

- The top-level business lifecycle around Inquiry, actual selected product, and Booking.
- The separate wholesaler-package and custom-quotation paths.
- Person/contact/traveler/party relationships.
- Availability evidence and package presentation handling.
- Client confirmation versus payment versus supplier fulfillment states.
- Client-money, supplier-payable, supplier-payment, revenue-component, and profit views.
- Departure grouping without financial merging.
- Document association, search metadata, and source precedence.
- Follow-up/deadline controls and operational exception language.
- Role and field-level visibility for staff, managers/admin, and interns.

## Decisions I must make before implementation

1. What exactly makes a booking confirmed, and who approves reserve-before-payment exceptions?
2. How must invoices, deposits, installments, unallocated receipts, refunds, and supplier payments relate?
3. How should bookings relate to departures when services or trips differ?
4. What pricing, fee, discount, tax, FX, and cancellation treatment should the operational profit view use?
5. What minimum data and permission boundaries apply at each stage?

## Recommended next implementation phase

**Architecture Validation and Read-Only Discovery.** Review this architecture, resolve the five material decisions, inspect representative WMIT source materials when access is available, and then build a synthetic proof of the new model. Do not continue Phase 3C, modify the current application/schema/tests, connect Google Workspace, or use production data during this reset.
