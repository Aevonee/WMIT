# Stabilization and acceptance gate

Status: **local synthetic acceptance in progress**  
Date: 2026-08-14  
Scope: Inquiry → requirements-first matching → reviewed quotation → Booking → payment evidence → verification → allocation

This is the current work package after the local Phase 2B decision-support implementation. It is a quality gate, not a new production phase. Google Workspace, real business data, external availability, and external supplier actions remain disabled.

## Acceptance checklist

The repeatable server-level smoke path can be run with `npm run acceptance` while the local MVP is running. It resets only synthetic data and verifies HTTP assets, tariff review, matching retry safety, quotation acceptance, lead-pax Booking creation, availability, ticketing, voucher, payment schedule, rooming, and reconciliation.

### Inquiry and requirements

- [x] Destination is required before an Inquiry is saved.
- [x] Exact dates derive duration and nights.
- [x] Month/year-only timing requires trip duration; matching never guesses it.
- [x] Adults, children, and infants are stored separately with a derived total.
- [x] Child ages are validated and become required only when the tariff condition requires them.
- [x] Required, preferred, unknown, and not-applicable requirement states are distinct.
- [x] A required but missing requirement blocks the candidate instead of becoming an implicit wildcard.

### Tariff and matching

- [x] Untrusted or ambiguous tariffs cannot produce client-facing quotations.
- [x] Rate units are configuration-backed and unsupported units block trusted pricing.
- [x] Matching returns multiple candidates with price previews and match/exclusion explanations.
- [x] Find More Options records a reason and does not repeat previously presented candidates.
- [x] Repeated normal matching reuses previously presented candidates instead of creating duplicates.
- [x] Excluded or previously presented matching candidates are not saved as orphan Commercial Options.
- [x] Supplier identity is stored as data and is not baked into general Tariff Library presentation.
- [x] Failed tariff review validation leaves extracted facts, rates, and trust state unchanged.
- [x] Duration and nights matrix ranges enforce minimum/maximum conditions with explicit exclusion reasons.
- [x] Child age bands match each child against an approved tariff range and block out-of-band ages.
- [x] Supported rate units calculate quantities from pax, nights, rooms, vehicles, ways, days, or service basis without guessing.

### Quotation and Booking

- [x] Supplier cost, markup, fees, discount, and client price remain separate and visible.
- [x] One approved quotation can create only one Booking.
- [x] Repeated Booking creation returns the existing Booking safely.
- [x] Option replacement is blocked or requires explicit confirmation after downstream records exist.
- [x] Confirmed replacement marks quotations for revision and Bookings for client re-acceptance.
- [x] Editing Inquiry requirements marks downstream quotations for revision and Bookings for client re-acceptance.
- [x] Manual selected-option cost overrides require configured price-override authority.
- [x] Booking Items validate related Suppliers, currencies, and recorded money values.
- [x] Supplier Bookings validate Booking Item ownership and Supplier relationships before saving.
- [x] Supplier Payables validate Booking lineage, currency, and positive money values.
- [x] Every Booking requires a selected lead passenger and records the `LEAD_PAX` participant atomically.
- [x] A Booking cannot have more than one lead passenger.
- [x] Approved quotations require recorded client acceptance before a new Booking can be created.
- [x] Accepted quotation terms are snapshotted for later audit.
- [x] Same-tab quotation, Booking, departure, supplier, and inquiry actions refresh the selected view.
- [x] Quotation creation validates Client and Inquiry lineage before saving.
- [x] Stale quotations cannot be approved after an Inquiry change until they are revised.
- [x] Confirming a Booking is idempotent and requires client re-acceptance after a commercial change.
- [x] Retrying the same Supplier Booking request returns the existing record instead of duplicating it.
- [x] Booking Items support controlled fulfillment states, availability holds, ticketing/PNR records, and vouchers.
- [x] Availability holds reject past expiry times and preserve supplier references.
- [x] Air ticketing requires a PNR for held/ticketed states and a ticket number when ticketed.

### Payments

- [x] Payment purpose is recorded as intent, not proof that the client has fully paid.
- [x] Payment evidence must belong to an existing Booking and matching client.
- [x] Verification requires an authorized actor.
- [x] Finalized verification state cannot be silently changed.
- [x] Only verified payments can be allocated.
- [x] Allocations must target a Booking for the same client.
- [x] Cumulative active allocations cannot exceed the verified payment amount.
- [x] Allocation retries with the same idempotency key return the existing allocation batch.
- [x] Supplier-payment retries from the UI carry a deterministic retry key; separate client installment payments remain separate records.
- [x] Payment purpose is captured inside Record Client Payment: down payment, installment/partial payment, full payment, final balance payment, or other.
- [x] Payment-purpose wording distinguishes client intent from the calculated verified allocated balance.
- [x] Booking-level payment schedules store installment purpose, amount, currency, sequence, and due date.
- [x] Booking reconciliation snapshots client price, verified allocated funds, Supplier Payables, Supplier Payments, and operational margin.

### Client changes and departure operations

- [x] Commercial amendments can be explicitly accepted by the client before commitment returns to confirmed.
- [x] Rooming list entries require a person already attached to the Booking.
- [x] Departure readiness issues support severity, ownership notes, resolution, and waiver states.

### Departures

- [x] Departure list replaces the redundant Departure/group column with the lead passenger name.
- [x] Lead passenger is derived from the Booking's selected `LEAD_PAX` participant.

## Verification evidence

- Automated suite: **116 passed, 0 failed**.
- Server smoke check: `GET /` returns HTTP 200 from the local MVP server.
- Live smoke check: Inquiry creation, tariff review, repeated matching, and state inspection returned one Commercial Option.
- Matrix regression coverage includes duration ranges, child age bands, calculated quantities, and explicit mismatch reasons.
- Synthetic regression coverage includes missing data, duplicate Booking creation, lead-pax validation, client acceptance, past-dated hold rejection, fulfillment states, ticketing, vouchers, payment schedules, rooming, amendments, departure readiness, reconciliation, matching retries, atomic tariff review failures, invalid relationships and money, payment gates, price-override authority, option replacement, same-tab navigation actions, Supplier Booking retries, payment-purpose presentation, Departure lead-pax presentation, and 20 complete synthetic vertical-slice workflows.

## Remaining manual owner checks

Run the local server and walk one synthetic case through the browser. Confirm that:

1. The original client request is visible before requirement history.
2. Matching cards show price, supplier cost, conditions, and why the option matches.
3. An ambiguous tariff shows a review block instead of allowing quotation creation.
4. Repeating “Create Booking” shows the existing Booking rather than creating another one.
5. Payment purpose, sent time, proof, verification, and allocation are visibly separate.
6. Replacing an option after quotation or Booking shows the appropriate revision/re-acceptance warning.

Owner acceptance of these checks is required before broader supplier search, additional tariff adapters, or production persistence work.
