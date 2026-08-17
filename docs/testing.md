# WMIT Testing Strategy

## Status

No application code exists yet. This document defines the test expectations for future phases.

## Test environments

Use a synthetic-data test spreadsheet and test Drive root before touching real business data. Production migration is a separate approved activity.

## Foundation tests

- Running setup twice does not create duplicate WMIT roots, child folders, sheets, or settings.
- Ambiguous root-folder search stops safely.
- Folder IDs are stored in configuration and reused.
- IDs are unique, correctly formatted, immutable, and logged.
- Missing required fields return useful errors.
- Invalid relationship IDs are rejected.
- Duplicate business keys are rejected or flagged.
- Audit records are written for successful and failed meaningful actions.
- A failed operation does not leave a partial financial record.

## Business tests

- Leads retain their source and follow-up history.
- Quotations keep supplier cost, markup, fees, client price, and margin separate.
- Invoice totals and balances are correct for deposits, discounts, fees, taxes, and multiple payments.
- Payment retries do not duplicate payments.
- Documents with low-confidence extraction remain in human review.
- Uncertain document matches are not auto-attached.
- Departure readiness identifies each missing item.
- Operational audits identify orphaned and incomplete records.

## Security and permission tests

- Intern users cannot access restricted finance or identity-document data.
- Unauthorized users cannot perform high-risk actions.
- Sensitive values are absent from logs and file names.
- Connector scopes are no broader than needed.

## Acceptance evidence

Every phase should provide test data, test steps, expected results, actual results, known limitations, and a manual verification checklist. “The script ran” is not an acceptance criterion.
