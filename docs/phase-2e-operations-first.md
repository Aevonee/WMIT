# Phase 2E — Operations-first workspace

## Decision

WMIT will prioritize the daily operating layer before PDF extraction, tariff activation, or automated quotation generation.

Tariff and package files may still be retained as review-only source documents. They are not required for the core client, inquiry, follow-up, payment, supplier, or partner workflows.

## Implemented local slice

- Client master records can be created, edited, and opened separately from Inquiry history.
- Inquiries remain linked to a Client and retain original/current requirements separately.
- Follow-ups and deadlines can be created globally or against a case.
- Client communication activity can be logged against a Client.
- Client payments remain evidence-first, verification-gated, and separate from payment purpose.
- Finance overview shows reported payments, verified payments, outstanding balances, payment schedules, and supplier payables.
- Suppliers remain separate operational records.
- Sub-agents/partner agencies have their own directory and may have multiple roles.

## Deliberate boundary

This slice does not make an unreviewed tariff quotable and does not select a supplier automatically. Automated quotation remains a later expansion after the operational workflow is accepted.

## Acceptance checks

1. Create and edit a client.
2. Create an Inquiry for that client.
3. Create a dated follow-up without selecting an Inquiry.
4. Log a client communication.
5. Record, verify, and allocate an installment payment.
6. Review the global finance view and payment deadlines.
7. Create a sub-agent with multiple roles.
8. Confirm all actions appear in the audit log and invalid records are rejected.
