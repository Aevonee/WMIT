# WMIT Business Architecture Validation — Independent State Model

> **SUPERSEDED by [baseline-v1.md](baseline-v1.md).** Its states are historical validation material; the baseline’s independent dimensions and owner-confirmed rules control.

> **NON-EXECUTABLE:** Use the classified independent states in [implementation-plan-v1.2.md](implementation-plan-v1.2.md). Historical labels are not implementation instructions.

Status: architecture validation draft; owner approval required before implementation

The prototype currently has several single status fields. WMIT’s actual workflow needs independent state dimensions because client payment, booking commitment, supplier confirmation, and profitability do not move together.

## 1. Inquiry state

Possible states:

- New
- Contacted
- Clarifying information
- Researching
- Option(s) ready
- Awaiting client
- Converted in whole or part
- Closed — no sale
- Closed — unavailable/no alternative
- Cancelled by client

Transition cause/evidence:

- new source message/call/walk-in creates New;
- staff contact or recorded communication creates Contacted;
- missing information creates Clarifying information;
- research task creates Researching;
- option or quotation is ready creates Option(s) ready;
- client response is pending creates Awaiting client;
- selected option produces Booking creates Converted in whole or part;
- documented outcome closes the Inquiry.

Who may cause it: assigned Staff, Manager, or authorized system-generated task process.

Evidence: communication, research note, linked option/quotation, client decision, or closure reason.

Must not imply: a Quotation exists, a Booking exists, or the client has paid.

## 2. Commercial Option state

Possible states:

- Researched
- Draft
- Ready to present
- Presented
- Accepted
- Rejected
- Superseded
- Unavailable
- Expired

Transition cause/evidence:

- staff records a potential product or arrangement;
- internal pricing/content is complete;
- client-facing content is presented;
- client accepts or rejects;
- a later option replaces it;
- supplier/product is unavailable or validity expires.

Who may cause it: Staff; Manager where approval is required.

Evidence: source document, tariff, supplier reference, availability result, client communication, or quotation artifact.

Must not imply: current availability unless the Availability state says so; Booking confirmation; supplier confirmation; payment.

## 3. Availability state

Possible states:

- Not checked
- Checking
- Available
- Unavailable
- Held/reserved
- Expired/stale
- Pending supplier response
- Unknown

Transition cause/evidence:

- staff initiates a check;
- authorized source or supplier response returns a result;
- hold/reservation reference is received;
- validity window expires.

Who may cause it: Staff or authorized supplier-source process; not an AI guess.

Evidence: source, timestamp, dates, quantity, supplier reference, response, and expiry/hold terms where applicable.

Must not imply:

- `Not checked` does not mean `Unavailable`;
- `Available` does not mean `Supplier confirmed`;
- a custom quotation with `Not checked` is not invalid merely because it was prepared.

## 4. Client decision state

Possible states:

- No decision
- Clarification requested
- Interested
- Verbally selected
- Accepted for proceeding
- Declined
- Changed request
- Withdrawn

Transition cause/evidence: communication or other approved client evidence.

Who may cause it: Staff records it; Manager may review high-impact interpretations.

Must not imply: Client Payment, Booking confirmation, Supplier confirmation, or availability.

## 5. Quotation state

Possible states:

- Draft
- Internally reviewed
- Sent
- Awaiting client
- Accepted for proceeding
- Rejected
- Expired
- Superseded
- Withdrawn

Transition cause/evidence:

- content and pricing are drafted;
- internal review is complete;
- client-facing quotation is sent or saved;
- client responds;
- validity expires or a newer quotation replaces it.

Who may cause it: Staff; Manager approval where policy requires.

Must not imply:

- `Sent` does not mean availability confirmed;
- `Accepted for proceeding` does not automatically mean Booking confirmed;
- quotation acceptance does not equal money received.

## 6. Client payment state

Possible states:

- No payment
- Payment reported
- Evidence pending
- Partially paid
- Deposit sufficient
- Fully paid
- Rejected
- Reversed/refunded
- Unallocated

Transition cause/evidence: payment report, payment proof, verification, allocation, reversal, or refund.

Who may cause it: Staff may enter; authorized Staff/Manager/Finance-designated user verifies; refund requires explicit approval.

Must not imply: Booking confirmed, Supplier confirmed, Supplier paid, or profit earned.

## 7. Booking commitment state

Possible states:

- Draft
- Provisional
- Awaiting client payment
- Client-selected
- Client-confirmed
- Confirmed under WMIT policy
- Changed
- Cancelled
- Completed

Transition cause/evidence:

- actual selected product is identified;
- client confirmation is recorded;
- required deposit/payment condition is met according to approved policy;
- amendment or cancellation is approved.

Who may cause it: Staff within policy; Manager for exceptions or reserve-before-payment cases.

Must not imply: Supplier confirmation, Supplier Payment, or accounting revenue.

## 8. Supplier fulfillment state

Possible states:

- Not requested
- Request prepared
- Requested
- Reservation/hold placed
- Awaiting supplier confirmation
- Partially confirmed
- Supplier confirmed
- Failed/unavailable
- Amended
- Cancelled
- Completed

Transition cause/evidence:

- supplier request or portal action;
- supplier reference or confirmation;
- confirmation/voucher document;
- supplier rejection or no availability;
- approved amendment/cancellation.

Who may cause it: Operations Staff; Manager approval for purchases or exceptions where required.

Must not imply: client payment, Supplier Payment, or complete Booking readiness.

## 9. Supplier payable state

Possible states:

- Not yet determined
- Expected
- Deposit due
- Partially payable/partially paid
- Final balance due
- Paid
- Disputed
- Cancelled
- Refund/credit pending
- Closed

Transition cause/evidence: supplier terms, confirmation, supplier invoice, payment record, credit/refund evidence, or approved cancellation.

Who may cause it: Operations records source facts; authorized finance/manager user confirms payments and adjustments.

Must not imply: Supplier confirmation or client balance status.

## 10. Client invoice state

Possible states:

- Draft
- Reviewed/approved
- Issued/sent
- Partially paid
- Paid
- Due soon
- Due
- Cancelled
- Credited/refunded

Transition cause/evidence: invoice preparation, approval, sending, Payment Allocation, cancellation, or refund.

Who may cause it: Staff may draft; authorized user approves/issues; financial adjustment requires approval.

Must not imply: money received merely because an invoice was issued, or profit merely because it was paid.

## 11. Payment verification state

Possible states:

- Entered
- Evidence pending
- Pending verification
- Verified
- Rejected
- Reversed
- Refunded

Transition cause/evidence: payment record and evidence, verification review, bank/cash/card/e-wallet confirmation, reversal, or refund.

Who may cause it: Staff entry; authorized verifier; Manager for exceptions.

Must not imply: client commitment, supplier confirmation, or profit.

## 12. Document/voucher readiness

Possible states:

- Not required
- Expected
- Requested
- Received
- Needs review
- Accepted for use
- Sent to client
- Superseded
- Missing/needs attention

Transition cause/evidence: source receipt, review, generation, sending, replacement, or missing-document task.

Who may cause it: Operations Staff; Manager for sensitive or disputed documents.

Must not imply: the underlying Booking or Supplier Booking is confirmed unless the document is an accepted confirmation and the relevant state is separately changed.

## 13. Pre-departure readiness

Possible states:

- Not started
- Preparing
- Awaiting documents
- Awaiting payment
- Awaiting supplier confirmation
- PDOS pending
- Ready with exceptions
- Ready
- Departed
- Closed

Transition cause/evidence: checklist conditions, payment state, document state, supplier state, PDOS record, and departure date.

Who may cause it: Operations Staff; Manager reviews exceptions.

Must not imply: profitability, supplier payment, or legal travel eligibility.

## Non-equivalences that must remain explicit

| Statement | Correct interpretation |
|---|---|
| Client Paid ≠ Booking Confirmed | Payment is one input to the confirmation rule, not the whole rule |
| Booking Confirmed ≠ Supplier Confirmed | WMIT may have client commitment while supplier fulfillment is pending |
| Supplier Confirmed ≠ Supplier Paid | Confirmation and payment are separate supplier-side states |
| Invoice Issued ≠ Money Received | An invoice creates/communicates an obligation; it is not a receipt |
| Money Received ≠ Profit | Cash received must be compared with costs, refunds, and approved adjustments |
| Availability Not Checked ≠ Unavailable | No check is different from a negative result |
| Quotation Sent ≠ Availability Confirmed | Especially true for custom tariff quotations |

## Recommended state architecture

Do not use one giant Booking status to represent all of these dimensions. A Booking should have or derive separate client-commitment, payment, supplier-fulfillment, document-readiness, and pre-departure views.
