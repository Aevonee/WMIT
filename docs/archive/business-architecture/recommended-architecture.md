# WMIT Business Architecture Validation — Recommended Architecture

> **SUPERSEDED by [baseline-v1.md](baseline-v1.md).** Retained as the prior recommendation; use the baseline for business semantics and the redesign plan for prototype mapping.

> **NON-EXECUTABLE:** [BASELINE-HANDOFF.md](BASELINE-HANDOFF.md) is the current implementation contract and cannot be overridden by this recommendation.

Status: recommendation for owner validation; not an implementation specification

## What is WMIT Operations actually a system for?

WMIT Operations is a controlled operational system for turning fragmented travel inquiries into accurately priced, properly tracked, supplier-fulfilled client travel arrangements while keeping people, documents, deadlines, client money, supplier obligations, and management margin visible.

It is not primarily a sales CRM, a full accounting system, or an autonomous travel-booking agent. It is an operational coordination system centered on the actual selected Booking and its related work.

## Core operating principle

The system should preserve the difference between:

```text
What the client originally asked for
What WMIT researched or presented
What was available
What the client selected
What WMIT booked
What suppliers confirmed
What the client paid
What WMIT paid suppliers
What remains due or at risk
```

These are related facts, not one status field or one record.

## Major domains

### Customer/People

Stores ongoing Client relationships and Person identities. Role relationships identify coordinators, payers, travelers, and other participants.

Core domain.

### Inquiry

Captures incoming requests from all relevant channels, original requirements, people involved, changes, follow-ups, options, and outcomes.

Core domain.

### Commercial Research/Options

Represents Supplier Packages, Supplier Tariffs, supplier quotes, airfare research, alternatives, availability checks, and source evidence.

Core domain, but it should remain practical. Not every casual search needs a complex record.

### Quotation

Represents the WMIT-created commercial proposal. It contains internal cost/pricing information and a separate client-facing projection.

Core domain.

### Booking

Represents the actual selected or committed travel arrangement. It contains participants and Booking Items and links back to the Inquiry, selected option, and quotation where applicable.

Core domain and operational center.

### Supplier Fulfillment

Represents Supplier Bookings, supplier references, reservations, confirmations, vouchers, supplier deadlines, supplier costs, and supplier failure/alternative handling.

Core domain.

### Financial Operations

Represents Client Invoices, Client Payments, Payment Allocations, Unallocated Client Money, Supplier Payables, Supplier Payments, refunds, and expected/updated operational profit.

Core domain, but deliberately not full accounting.

### Departure

Represents optional shared group/departure organization across independent Bookings. It provides management aggregation without financial merging.

Core operational supporting domain.

### Documents

Represents received and generated files, source metadata, links, sensitivity, review, supersession, and client-facing outputs such as vouchers.

Core supporting domain.

### Tasks/Follow-ups

Represents work that must happen by a date, with an owner and related record. This is one of the highest-value operational domains because missed follow-ups and supplier deadlines are major pain points.

Core supporting domain.

### Communications

Represents lightweight communication history and source/thread references across Messenger, WhatsApp, Viber, email, phone, SMS, walk-in, and other channels.

Supporting domain. Start simple; do not require full channel integration.

### Audit

Records important actions and changes across all domains.

Cross-cutting core control.

## Recommended business flow

```text
Inquiry
  → research one or more Commercial Options
  → check Availability where required
  → prepare WMIT Quotation or present Supplier Package
  → record Client Decision
  → collect/verify Client Payment as required
  → create/update actual Booking
  → fulfill through one or more Supplier Bookings
  → track Client Invoice/Payments and Supplier Payables/Payments
  → organize Documents and Vouchers
  → complete Tasks and pre-departure preparation
  → group with Departure where applicable
  → complete, amend, cancel, or refund with evidence
```

This is a branching lifecycle. A custom quotation may precede availability. A supplier reservation may precede client payment. An Inquiry may change direction. A Booking may exist without a formal quotation if WMIT validates that operational path.

## Architectural boundaries

### Core records

- Client;
- Person/Traveler relationships;
- Inquiry;
- WMIT Quotation;
- Booking;
- Booking Item;
- Supplier;
- Supplier Booking;
- Departure;
- Client Invoice;
- Client Payment;
- Supplier Payable;
- Supplier Payment;
- Document;
- Task;
- Audit Event.

### Supporting records/views

- Commercial Option;
- Availability Evidence;
- Payment Allocation;
- Communication;
- Voucher readiness;
- profit projections;
- departure readiness;
- dashboard exception views.

Some supporting concepts may become persistent records after actual WMIT practice is validated.

## What should be preserved from the prototype

- local-only testing;
- explicit adapters;
- structured validation;
- immutable IDs as a design goal;
- separate supplier-side records;
- multiple Booking Items and Supplier Bookings;
- exact money calculations;
- document review before business-record writes;
- client-facing quotation filtering;
- audit logging as a cross-cutting requirement.

## What must be redesigned before implementation

- Inquiry rather than a simplistic Lead-first pipeline;
- Supplier Package versus WMIT Quotation;
- availability evidence;
- client/person/traveler/coordinator/payer roles;
- independent state dimensions;
- client money and payment allocation;
- supplier payable and supplier payment behavior;
- profit definition;
- departure grouping;
- communication/activity history;
- voucher and deadline workflows;
- cancellation/amendment/refund representation.

## Practical recommendation

Do not rebuild the entire codebase blindly. Freeze the current prototype as reference material, validate the glossary/scenarios/state/financial/permissions decisions, then design a small synthetic operational slice around:

```text
Inquiry
→ Option/availability
→ WMIT Quotation
→ actual Booking
→ Supplier Booking/deadline
→ Client Payment/Supplier Payable
→ task/document visibility
```

Only after that slice is accepted should the project decide which existing services and UI components can be safely extended.
