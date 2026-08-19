# WMIT Baseline v1 Validation Matrix

> **Updated authority:** use [baseline-v1.1.md](baseline-v1.1.md). The latest owner-confirmed tariff and payment rules supersede earlier provisional classifications.

> **NON-EXECUTABLE:** [BASELINE-HANDOFF.md](BASELINE-HANDOFF.md) controls current classifications; this matrix cannot authorize implementation or override safe blocked behavior.

Status: **SIX REAL-CASE VALIDATION MATRIX**  
Parent authority: [baseline-v1.md](baseline-v1.md)  
This matrix records what the six real WMIT patterns validate and what future implementation must prove. It is not executable test code.

## 1. Summary

| Case | Core pattern | Baseline result |
|---|---|---|
| 1 | Messenger request changes from cheap August local trip to October wholesaler package | Representable without overwriting original Inquiry; availability-first package path required. |
| 2 | Custom private trip from DMC tariff plus airfare | Quotation may precede availability; tariff, calculation, and quotation remain separate. |
| 3 | Group with coordinator, payer, and several travelers | People and roles are separate; no role inference. |
| 4 | One Booking with airfare, hotel, transfers, and insurance from multiple sources | Booking Item owns component supplier/cost/selling/fulfillment; one Booking may have multiple Supplier Bookings. |
| 5 | Supplier reservation before client payment followed by installments | Commitment, payment receipt, verification, allocation, supplier payable, and supplier payment are independent. |
| 6 | Supplier failure/cancellation with alternatives and costs/refunds | Alternatives, amendment/cancellation, supplier penalties/credits, client refunds, and approvals preserve history. |

## 2. Case 1 — Messenger changed request

### Facts validated

The client first asks for a cheap local holiday in August. Nothing suitable or available is found. WMIT researches an October wholesaler package. The client accepts and pays.

### Entities involved

Client; Person(s); Inquiry; Communication Activity; Commercial Options; Supplier; Supplier Package; Availability Evidence; WMIT Quotation/client-facing presentation; Booking; Booking Items; Supplier Booking; Client Payment; Payment Evidence; Tasks; Voucher Document.

### States exercised

- Inquiry: New → Clarifying/Researching → Options ready → Awaiting client → Converted in whole/part.
- Option: Researched/Unavailable or Superseded for August direction; Ready to present/Presented/Accepted for October package.
- Availability: August unavailable/unknown with evidence; October Available with check evidence before presentation.
- Client decision: Changed request → Accepted for proceeding.
- Booking commitment/payment/supplier fulfillment: independent.

### Rules exercised

- Original Inquiry facts remain understandable.
- Changed destination/dates/product do not silently overwrite the Inquiry.
- Supplier Package ≠ WMIT Quotation.
- Package availability is checked before presentation.
- Find More Options can search without repeating prior options.
- Staff selects the commercial option; system does not choose automatically.

### Financial rules exercised

- Supplier-provided package selling price is a source value.
- Any WMIT fees/discounts/override remain explicit.
- Payment receipt, evidence, verification, allocation, client balance, supplier payable, and margin remain separate.

### Documents

Messenger/source reference; supplier package document; availability evidence; quotation/presentation; payment proof; supplier confirmation/voucher; WMIT voucher.

### Expected outcome

The final Booking points to the October option and original Inquiry, while the August request and failed research remain visible. No unavailable package is represented as available. Tasks for follow-up, supplier deadline, payment, and voucher are created/updated idempotently.

### Failure conditions

- original August facts overwritten;
- October package presented without availability evidence;
- Lead is the only historical record;
- system repeats the rejected/unavailable option as a new “more options” result;
- client payment is treated as supplier confirmation;
- voucher is generated/sent without staff review.

## 3. Case 2 — Custom private trip: DMC tariff plus airfare

### Facts validated

WMIT uses a DMC Supplier Tariff for land arrangements and obtains airfare separately. It calculates internal cost, applies WMIT rules, and creates a quotation before availability is checked.

### Entities involved

Inquiry; Supplier; Supplier Tariff Document/Version; structured Tariff Data; Commercial Option; airfare/source Option; Availability Evidence (possibly absent at quotation time); WMIT Quotation; Quotation Items; pricing rule snapshot; later Booking and Supplier Bookings.

### States exercised

- Tariff Document: Received/Classified/Extracted/Needs review or Approved.
- Tariff Version: valid, outside-validity, overlapping, or authority pending.
- Availability: Not Checked/Pending/Unknown at quotation time; later Available/Unavailable/Needs manual verification.
- Quotation: Draft → Reviewed → Sent, without implying availability.

### Rules exercised

- Supplier Tariff ≠ WMIT Quotation.
- Tariff extraction is review-first.
- Complex conditions, unit basis, validity, supplements, and itinerary are retained.
- Out-of-validity rate is a review condition, not silent confirmation.
- Multiple matching options are shown; no automatic “best” choice.
- Human review/override precedes client-facing price.

### Financial rules exercised

- Custom quotations usually use 30% markup.
- BDO Forex Selling Rate + 1.0 applies where conversion fee/rule is relevant.
- Fees and discounts are explicit.
- Calculated and actual quoted price are both retained.

### Documents

DMC tariff source; airfare source/quote; extraction result; review notes; quotation; later confirmations/tickets/vouchers.

### Expected outcome

WMIT can send a qualified quotation while availability is not confirmed. The result shows source/provenance, conditions, warnings, and price components. Later availability checking can update the Option/Booking path without rewriting the original quotation history.

### Failure conditions

- tariff becomes a quotation automatically;
- quotation is treated as availability confirmation;
- ambiguous `Transfer USD 50` is calculated without unit/way warning;
- outside-validity rate is silently used as confirmed;
- extraction writes a final client price without staff review;
- system automatically selects cheapest/highest-margin Supplier.

## 4. Case 3 — Group with coordinator, payer, and travelers

### Facts validated

One person communicates/co-ordinates. Several people travel. The coordinator may or may not travel and may or may not pay. Another Person may be the financier. Group communication may include participants.

### Entities involved

Client; Person; Inquiry Participant Role; Communication Activity; Booking Participant Role; Traveler data; Client Obligation; Client Payment/Payer reference; Documents; Tasks.

### States exercised

- Inquiry/Booking participant roles are explicit and independently editable.
- Traveler document readiness applies only to actual travelers.
- Payment/obligation is associated with payer or approved paying party without inferring travel role.

### Rules exercised

- Person ≠ Client ≠ Payer ≠ Traveler.
- Coordinator does not automatically become a traveler.
- A group can have several travelers under one Booking or related independent Bookings.
- Sensitive identity data is staged and restricted.

### Financial rules exercised

- Payer may fund client obligations without traveling.
- One payment may be allocated across multiple Booking/obligation targets.
- Client balances remain separate from traveler count.

### Documents

Client/traveler identity documents; payment proof; group quotation; supplier manifest/confirmation; restricted internal notes.

### Expected outcome

The system shows who communicates, who pays, and who travels, with no inferred role. Only authorized roles see sensitive identity/payment data. Tasks can be assigned to the coordinator or staff independently of traveler readiness.

### Failure conditions

- one Contact row forced to represent all roles;
- coordinator automatically becomes primary traveler;
- payer is required to be a traveler;
- intern sees passports/payment evidence by default;
- group-level financial record merges independent client obligations.

## 5. Case 4 — One Booking with multiple Suppliers

### Facts validated

One Booking contains airfare from one source, hotel from another, transfers from another, tours from another, insurance from another, and WMIT fees/services.

### Entities involved

Booking; Booking Items; Suppliers; Supplier Booking(s); Supplier Booking Items; Supplier Payables; Client Obligation/Invoice Items; Documents; Tasks; Margin projection.

### States exercised

- each Booking Item has its own fulfillment state;
- Supplier Bookings may be Requested, Reserved, Partially Confirmed, Confirmed, Failed, or Amended independently;
- each Supplier Payable has its own due/payment state;
- Booking readiness is a projection across items, documents, tasks, balances, and supplier states.

### Rules exercised

- One Booking ≠ one Supplier.
- Each item retains supplier, cost, client amount, service/component, dates/quantity, fulfillment, and supplier-side relationship.
- One Supplier Booking may cover multiple items.
- Supplier failure can affect one item without rewriting the entire Booking.

### Financial rules exercised

- Supplier costs and client amounts remain item-level and separate.
- Supplier payables/payments are per Supplier Booking/Booking Item obligation.
- Client invoice/payment and operational margin remain Booking/client-side views.

### Documents

Air ticket; hotel confirmation; transfer voucher; tour confirmation; insurance document; WMIT quotation/invoice/voucher; payment evidence.

### Expected outcome

Operations can see fulfillment and financial obligations by component and Supplier. Client-facing views exclude supplier costs and restricted documents. A single Supplier confirmation can cover multiple Booking Items without collapsing the Booking.

### Failure conditions

- Booking stores one supplier only;
- supplier cost is stored only at Booking total;
- one Supplier Booking is forced for all items;
- one supplier confirmation marks every item confirmed without evidence;
- one supplier payment reduces client balance or Booking margin as cash logic.

## 6. Case 5 — Supplier reservation before client payment plus installments

### Facts validated

WMIT may reserve/request with a Supplier before client payment. WMIT only pays Suppliers after client money is received. Client payments may be deposits/installments, require proof, and may be verified/allocated later.

### Entities involved

Booking; client commitment; Supplier Booking; reservation evidence; Supplier Payable/components; Client Obligation/Invoice; Client Payment; Payment Evidence; Payment Verification; Payment Allocation; Supplier Payment; Tasks; Audit Event; approval record.

### States exercised

- Booking commitment can be client-selected/confirmed under policy while payment is Awaiting/Partially paid.
- Supplier Booking can be Reserved/Awaiting confirmation.
- Client Payment can be Entered/Evidence pending/Pending verification/Verified.
- Allocation can be Unallocated, split, or applied to a deposit/installment.
- Supplier Payable can be Deposit due/Final balance due.
- Supplier Payment is separate and gated.

### Rules exercised

- Client commitment ≠ client payment.
- Supplier reservation ≠ supplier confirmation.
- Supplier confirmation ≠ supplier payment.
- Supplier payment must wait for received client money and approved policy.
- Payment evidence is required.
- Installments and split/unallocated allocation are supported.
- Deadlines vary by Supplier/product; no universal three-day rule.

### Financial rules exercised

- Client outstanding balance is based on verified allocated money.
- Supplier outstanding is based on payable components and verified supplier payments.
- Cash received is not profit.
- Expected margin does not change merely because an installment was received.

### Documents

Supplier reservation/confirmation; supplier invoice; client payment proof; bank/card/PayPal evidence; client invoice; audit/approval record.

### Expected outcome

The system exposes reservation risk and deadlines, preserves the payment receipt and proof, allows later verification/allocation, and blocks supplier payment until the configured client-money condition is met. Installments update the appropriate client obligation without changing supplier confirmation state automatically.

### Failure conditions

- recording a supplier payment merely because a reservation exists;
- marking an invoice paid from unverified payment;
- forcing one payment to one invoice/Booking;
- deleting/reusing payment rows after refund;
- hard-coding one supplier deadline or one deposit rule;
- hiding reserve-before-payment exposure.

## 7. Case 6 — Supplier failure, alternatives, cancellation, and refunds

### Facts validated

Supplier/product becomes unavailable or fails. WMIT searches alternatives and presents them. If accepted, the Booking is amended appropriately. If not, cancellation/refund follows applicable terms. Individual travelers often have non-refundable outcomes, although replacement may sometimes be possible.

### Entities involved

Booking; Booking Items; Supplier Booking; Supplier; Commercial Options; Availability Evidence; Amendment; Cancellation; Traveler cancellation; Supplier terms; Supplier Payable; Supplier Payment; Supplier penalty/credit/refund; Client Payment; Client Refund/Credit; approvals; Documents; Tasks; Audit Event; updated margin.

### States exercised

- Supplier fulfillment: Failed/unavailable → alternative research → Amended/Confirmed or Cancelled.
- Option: unavailable/rejected/alternative/presented/accepted.
- Traveler: active/cancelled/replacement pending/replaced where applicable.
- Payable: expected/penalty/refund-credit pending/closed.
- Client obligation: credited/refunded/needs attention.

### Rules exercised

- No automatic replacement Supplier selection.
- Material changes preserve amendment history and client re-acceptance.
- Individual traveler cancellation is often non-refundable.
- Replacement traveler process may exist when time permits.
- Supplier terms/evidence determine penalty/refund/credit outcome.
- Original payment and supplier facts remain intact.
- Refunds/financial adjustments require explicit approval.

### Financial rules exercised

- Supplier penalty, supplier credit/refund, client refund/credit, and retained amount are separate.
- Updated Operational Margin records current client value, current/confirmed direct cost, and approved adjustments.
- Refund is not a negative rewrite of the original receipt.

### Documents

Supplier failure/cancellation notice; tariff/package cancellation terms; alternative quotation; traveler cancellation request; replacement evidence; supplier credit/refund; client refund proof; approval record.

### Expected outcome

WMIT can explain what failed, what alternatives were offered, what the client accepted/declined, what each traveler/Booking Item cost, what the Supplier refunded/retained, what WMIT returned/retained, and how margin changed. History remains auditable.

### Failure conditions

- silently swapping suppliers or dates;
- deleting the original Booking/payment;
- assuming universal refundability;
- merging traveler-level cancellation into an all-or-nothing Booking status;
- issuing refund without approval/evidence;
- treating supplier credit as client cash or profit automatically.

## 8. Synthetic edge cases for future implementation

Future implementation must additionally test:

1. one Inquiry with three options and two independent Bookings;
2. a custom quotation with no availability check followed by failed supplier verification;
3. a package with stale availability evidence that expires before client acceptance;
4. two overlapping tariff revisions with conflicting rates;
5. ambiguous per-person/per-vehicle transfer and explicit wording override;
6. tariff date outside validity but manually approved after supplier confirmation;
7. one payment split across two Bookings, then partially reallocated;
8. payment proof missing, rejected, reversed, and refunded;
9. Supplier Booking deposit and final balance with different due dates;
10. supplier reservation before client payment followed by client non-payment and cancellation;
11. one Booking Item moved to a new Supplier while other items remain confirmed;
12. traveler cancellation with replacement traveler and non-refundable penalty;
13. Departure shared by three bookings with one item-level exception;
14. duplicate retry of payment, reminder, extraction, voucher generation, and refund request;
15. intern, staff, manager, and owner projections of the same sensitive records;
16. audit event on failed and successful price override, allocation, supplier payment, and refund;
17. document supersession where old voucher remains historically linked;
18. partial extraction where itinerary is present but rate unit is missing.
