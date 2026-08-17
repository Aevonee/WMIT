# Synthetic Operational Scenarios

Version: **1.0**  
Status: **validation test pack; synthetic data only**  
Phase: **2A — local operational data model**

These scenarios are deliberately written as tests of the model, not as feature specifications. They ask whether WMIT can preserve history, represent independent state changes, calculate operational impact, and fail visibly when a workflow is not yet supported.

They must be run against synthetic records before any equivalent workflow is attempted with real WMIT data.

## Shared synthetic baseline

| Record | Synthetic value |
|---|---|
| Client | `SYN-CLIENT-MABINI` — Mabini Family |
| Inquiry | `SYN-INQUIRY-001` |
| Original request | 2 adults; Seoul; **2026-11-12 through 2026-11-17** |
| Accepted quotation | `SYN-QUOTE-001-V1`; PHP 100,000 client price; PHP 68,000 expected direct cost |
| Booking | `SYN-BOOKING-001` |
| Hotel | PHP 60,000 selling / PHP 45,000 expected supplier cost; 5 nights |
| Transfer | PHP 12,000 selling / PHP 8,000 expected supplier cost |
| Tour | PHP 28,000 selling / PHP 15,000 expected supplier cost |
| Client obligations | PHP 30,000 deposit due 2026-09-01; PHP 70,000 balance due 2026-10-12 |
| Expected operational margin | PHP 32,000 before fees, penalties, refunds, or FX adjustments |

The values are intentionally simple. They are not WMIT rates, policies, or current prices.

## Test conventions

Every event must retain:

- immutable IDs and the original record;
- before/after values;
- actor, timestamp, reason, evidence, and correlation/idempotency key;
- related Booking Item, Supplier Booking, obligation, payment, document, and task IDs;
- a visible exception when the model cannot represent the outcome safely.

`PASS` means the current model has an explicit, testable representation. `PARTIAL` means the information can be stored or inferred, but the workflow is not safely connected end to end. `GAP` means the model does not yet provide a reliable controlled representation.

## Scenario 1 — Date change

### Event

The client changes the trip from **2026-11-12 through 2026-11-17** to **2026-11-14 through 2026-11-19**. Assume the client still wants hotel, transfer, and tour, and no price change has yet been quoted.

### Required test sequence

1. Preserve the original Inquiry requirements and original accepted quotation/snapshot.
2. Record the changed request as a new Inquiry requirement version or change event.
3. Create a quotation revision for the new dates; do not edit the accepted quotation into the new commercial truth.
4. Require a new client acceptance if the revised dates change the accepted commercial commitment.
5. Create a Booking amendment with before/after dates.
6. Propagate or explicitly review the date change for each Booking Item:
   - hotel stay: 2026-11-14 through 2026-11-19;
   - arrival/departure transfer dates;
   - tour date and any date-dependent availability.
7. Recheck or re-request each affected Supplier Booking. Old supplier responses remain history.
8. Recalculate payment obligations only through an explicit policy-approved change. If amounts do not change, the old obligation IDs and allocations remain valid; if due dates or amounts change, create an adjustment/version rather than silently editing history.
9. Recalculate projected margin from the current service-level costs. Keep the previous PHP 32,000 projection for comparison.
10. Mark affected quotation, supplier, itinerary, voucher, and client-facing documents as superseded or needing regeneration. Create human-review tasks; do not send automatically.

### Expected oracle

| Area | Expected result |
|---|---|
| Quotation | `SYN-QUOTE-001-V1` remains immutable/history; a revision represents the new dates. |
| Accepted snapshot | Original snapshot remains readable; new snapshot exists only after the required client acceptance. |
| Booking | Same Booking may be amended with a linked amendment, or a new Booking is created if policy requires; no unexplained overwrite. |
| Hotel / transfer / tour | Each affected service has its own before/after date review and supplier revalidation. |
| Payment obligations | No automatic assumption that a date change satisfies or cancels an obligation. Existing allocations remain traceable. |
| Profit | Old and current projections are both visible; no “actual profit” claim from a date amendment alone. |
| Documents | Old outputs remain history; replacement drafts are linked to the new accepted/current version. |

### Current model verdict

**PARTIAL — not ready as an end-to-end date-change workflow.** Quotation revisions, accepted snapshots, Booking amendments, and payment-obligation preservation exist locally. The amendment implementation only makes price changes require re-acceptance; a date-only change can be recorded without the same commercial re-acceptance gate. It also does not automatically update Booking Items, Supplier Bookings, payment schedules, or generated documents. Profit is currently Booking-level or aggregated from item costs, so date-specific supplier repricing must be recorded explicitly before the result is trustworthy.

## Scenario 2 — Supplier failure

### Event

The hotel supplier for `SYN-BOOKING-ITEM-HOTEL` says: **“We cannot confirm.”** A replacement hotel is available from another supplier at PHP 52,000 cost for the same dates.

### Required test sequence

1. Record the original hotel Supplier Booking as failed/unavailable with the supplier evidence and response timestamp.
2. Keep the original supplier, reference, quoted cost, deadlines, and documents readable.
3. Create a replacement supplier option/request for the same Booking Item or an explicitly linked successor item.
4. Require revalidation of dates, room type, passenger count, inclusions, cancellation terms, and confirmation evidence.
5. Calculate the cost delta: **PHP 52,000 − PHP 45,000 = PHP 7,000 increase**.
6. Show the projected margin impact: **PHP 32,000 → PHP 25,000** if the client price remains PHP 100,000.
7. Require client acceptance if the replacement changes price, material terms, or the accepted service.
8. Draft a client notification for human approval. Do not send automatically.
9. Supersede or regenerate affected hotel confirmation, itinerary, voucher, invoice/quotation, and task outputs only after the replacement is accepted and confirmed.

### Expected oracle

| Area | Expected result |
|---|---|
| Problem visibility | Hotel service is visibly blocked; the case does not appear fully supplier-confirmed. |
| Replacement | New supplier transaction has a new immutable ID and explicit replacement lineage. |
| History | Failed original Supplier Booking and evidence remain unchanged. |
| Financial impact | Old cost, replacement cost, delta, client-price effect, and margin effect are visible separately. |
| Client notice | Draft exists with reason, alternative, price/terms, and approval state. |
| Documents | Existing documents remain history; new documents are generated from the accepted replacement, not overwritten in place. |

### Current model verdict

**PARTIAL — the records can be assembled, but replacement is not controlled end to end.** Service-level blockers can expose an unconfirmed item, and multiple Supplier Bookings can conceptually cover successive fulfillment. There is no explicit replacement/lineage action that safely closes the failed booking, reassigns the item, recalculates itemized financials, creates the client communication draft, and regenerates documents. A raw failure value may also collapse into a generic non-confirmed rollup instead of a distinct failure state.

## Scenario 3 — Partial cancellation

### Event

The client removes only the tour. Hotel and transfer remain required and confirmed.

### Required test sequence

1. Preserve the original accepted Booking snapshot containing all three services.
2. Record a partial-cancellation amendment identifying only the tour Booking Item.
3. Cancel or release the tour Supplier Booking/hold while leaving hotel and transfer active.
4. Calculate the client-side reduction: **PHP 28,000** before approved fees, penalties, or credits.
5. Calculate the supplier-side outcome: expected tour cost PHP 15,000, less any supplier cancellation cost or plus any supplier credit/refund.
6. Update the current client obligation through an explicit credit/adjustment. Do not delete the original obligation or payment allocations.
7. Keep hotel and transfer readiness, payables, documents, and deadlines unchanged unless separately affected.
8. Recalculate current projected margin. With no cancellation penalty or supplier credit, the retained arrangement is PHP 72,000 selling value less PHP 53,000 direct cost = **PHP 19,000**.
9. Generate revised client-facing documents and a cancellation/refund task for approval.

### Expected oracle

| Area | Expected result |
|---|---|
| Booking | Booking remains active for hotel and transfer; tour is cancelled at item level. |
| History | Original tour item, accepted price, supplier terms, and prior documents remain readable. |
| Client obligation | Current obligation reflects the approved reduction/credit without rewriting payment history. |
| Supplier obligations | Tour payable and any cancellation charge/credit are separate from hotel/transfer payables. |
| Profit | Current margin includes the retained services and explicit cancellation adjustment. |
| Readiness | Hotel and transfer remain ready; cancelled tour is not treated as a blocker or as confirmed. |

### Current model verdict

**GAP for safe financial cancellation.** Booking Items and supplier links are granular enough to identify the tour, but there is no defined partial-cancellation transaction that connects the item, client credit/refund, supplier cancellation cost/credit, obligations, documents, and profit projection. A generic RefundAdjustment can be created, but the current projection does not consume it.

## Scenario 4 — Partial refund

### Event

The client has paid **PHP 100,000**. WMIT approves a **PHP 30,000** refund. Assume no supplier credit is received and the original direct cost remains PHP 68,000.

### Required test sequence

1. Preserve the original verified Client Payment at PHP 100,000.
2. Preserve its evidence, verification, and Payment Allocation records.
3. Create an approved Refund/Credit record for PHP 30,000 linked to the Booking, client obligation, reason, approver, and source payment where applicable.
4. Execute the refund as a separate transaction; never change the original payment to PHP 70,000 and never delete it.
5. Show the four separate measures:
   - payment received: PHP 100,000;
   - approved/allocated obligation after the refund outcome: PHP 70,000, subject to WMIT policy;
   - refund executed: PHP 30,000;
   - net client money retained: PHP 70,000.
6. Keep profit separate from cash and obligation status. The updated operational retained-value view is PHP 70,000 less PHP 68,000 = **PHP 2,000**; actual profit remains unconfirmed until the approved closeout/reconciliation evidence exists.
7. Ensure a retry cannot execute a second PHP 30,000 refund.

### Expected oracle

| Measure | Expected value | Must not be confused with |
|---|---:|---|
| Client payment received | PHP 100,000 | Profit or current obligation |
| Verified allocated payment | PHP 100,000 before the refund allocation treatment | Refund executed |
| Current client obligation | PHP 70,000 if the approved outcome reduces the obligation | Cash received |
| Refund executed | PHP 30,000 | Reversal/deletion of the original payment |
| Net money retained | PHP 70,000 | Actual realized profit |
| Updated operational margin view | PHP 2,000 before other adjustments | Statutory profit |

### Current model verdict

**PARTIAL record capture; GAP for projection and settlement semantics.** The runtime has a human-authorized refund draft/execution path and preserves the original payment record. The current finance projection does not subtract executed refunds or credits from obligations, balances, or profitability, and the refund entity has no enforced relationship contract in the preliminary schema. The model therefore cannot yet prove the four distinctions above in one authoritative view.

## Scenario 5 — Currency and later supplier invoice

### Event

The supplier cost is **USD 500**. The client price is **PHP 35,000**. The quotation records a manual rate of **USD 1 = PHP 58.00** on 2026-08-15, making the expected PHP equivalent **PHP 29,000** and expected operational margin **PHP 6,000**.

The later supplier invoice is still USD 500, but settlement uses **USD 1 = PHP 60.00**, making the actual PHP equivalent **PHP 30,000**.

### Required test sequence

1. Store supplier amount/currency as USD 500.
2. Store client selling amount/currency as PHP 35,000.
3. Store the quoted FX rate, rate direction, source, date, actor, and whether it is a planning/display rate or a settlement rate.
4. Show the quoted PHP equivalent and expected margin without overwriting the original USD amount.
5. Record the later supplier invoice as a separate source fact: USD 500, invoice date, document, and supplier reference.
6. Record the actual settlement amount/currency/rate separately: PHP 30,000 equivalent at 60.00.
7. Show the PHP 1,000 FX variance and updated margin of PHP 5,000.
8. Distinguish supplier invoice currency, supplier payment currency, client payment currency, management display currency, and any approved accounting treatment.
9. Block or route mixed-currency payment execution for explicit review when the system cannot safely convert the available client funds to the payable currency.

### Expected oracle

| Measure | Expected value |
|---|---:|
| Supplier quoted cost | USD 500 |
| Quoted FX snapshot | 58.00 PHP/USD on 2026-08-15; source and direction recorded |
| Expected PHP cost | PHP 29,000 |
| Client price | PHP 35,000 |
| Expected operational margin | PHP 6,000 |
| Later supplier invoice | USD 500; original amount preserved |
| Actual settlement equivalent | PHP 30,000 at 60.00 PHP/USD |
| FX variance | PHP 1,000 adverse change |
| Updated operational margin | PHP 5,000 before other fees/adjustments |

### Current model verdict

**PARTIAL for client-payment conversion; GAP for supplier-cost FX and margin reconciliation.** The local payment-conversion helper preserves a payment currency, invoice currency, conversion rate, source, and date. That is useful for a client payment-to-invoice conversion. It does not establish the quoted-versus-settlement FX snapshots required for supplier cost, and the operational profit projection performs same-currency arithmetic rather than converting mixed-currency costs. The supplier-payment funding gate also compares currencies directly, so a PHP client payment cannot safely fund a USD payable without an explicit conversion/approval path.

## Cross-scenario readiness matrix

| Capability tested | Scenario 1 | Scenario 2 | Scenario 3 | Scenario 4 | Scenario 5 |
|---|---:|---:|---:|---:|---:|
| Preserve original accepted/commercial history | Partial | Partial | Partial | Pass | Partial |
| Service-level change/cancellation lineage | Gap | Partial | Gap | N/A | Partial |
| Independent supplier fulfillment state | Partial | Partial | Partial | N/A | Partial |
| Client obligation/payment/refund separation | Partial | Partial | Gap | Partial | Partial |
| Supplier payable/credit/settlement history | Partial | Partial | Gap | Partial | Gap |
| Profit impact with prior/current comparison | Partial | Partial | Gap | Gap | Gap |
| Document supersession/regeneration | Gap | Gap | Gap | N/A | N/A |
| Safe human approval and idempotent retry | Partial | Partial | Gap | Partial | Partial |

## Overall conclusion

The model is a useful **Phase 2A discovery foundation**, but it is not yet ready to support these changes as live travel-operations workflows. The strongest existing areas are immutable IDs, accepted commercial snapshots, Booking amendments, evidence-first payments, payment allocations, supplier payables, audit records, and projected-versus-actual profit concepts.

The tests expose four material readiness gaps to resolve before production setup:

1. service-level amendment/replacement/cancellation lineage;
2. a defined refund/credit and cancellation-cost transaction model consumed by projections;
3. document supersession and regeneration linked to the accepted/current version;
4. currency-aware supplier-cost, payable, settlement, and margin reconciliation.

These are validation findings, not automatic implementation authorization. The next step should be to validate the business rules and approval policy with read-only WMIT discovery, then turn only the confirmed scenarios into executable synthetic tests.
