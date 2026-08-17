# WMIT Business Architecture Validation — Role and Visibility Matrix

> **SUPERSEDED by [baseline-v1.md](baseline-v1.md).** Retained as access-discovery evidence; baseline security boundaries and unresolved visibility decisions control.

> **NON-EXECUTABLE:** Unknown access must fail closed. [BASELINE-HANDOFF.md](BASELINE-HANDOFF.md) and the classified permissions section of [implementation-plan-v1.2.md](implementation-plan-v1.2.md) control.

Status: conceptual access model; no permissions are implemented

## Legend

- **Full:** may view and normally perform approved actions.
- **Operational:** may view/use for ordinary work, subject to workflow approval.
- **Restricted:** may view only when needed and authorized.
- **No default:** not available unless explicitly approved.
- **Draft only:** may prepare but not approve, commit, refund, or purchase.

## Role matrix

| Domain/data | Admin/Owner | Manager | Staff | Intern |
|---|---|---|---|---|
| Clients | Full | Full | Operational | Assigned/limited |
| Travelers | Full | Full | Operational | Limited, no sensitive fields by default |
| Inquiries | Full | Full | Operational | Assigned only |
| WMIT Quotations | Full | Full/approve | Create/edit within policy | Draft/support only |
| Supplier Packages | Full | Full | Operational | Search/read approved data |
| Supplier Tariffs | Full | Full | Operational | Read approved, no restricted costs unless approved |
| Supplier costs | Full | Full | Operational where needed | No default |
| Markup | Full | Full | Operational where needed | No default |
| Profit | Full | Full | Restricted/summary only | No default |
| Bookings | Full | Full | Operational | Assigned/support only |
| Supplier Bookings | Full | Full | Operational | Limited assigned work |
| Supplier deadlines | Full | Full | Operational | Assigned tasks only |
| Client invoices | Full | Approve/review | Draft/prepare/use as authorized | No default or draft-only |
| Client payments | Full | Verify/review | Enter and view necessary records | No default |
| Supplier payments | Full | Approve/review | Prepare/request or record only if authorized | No default |
| Refunds | Approve/execute | Approve/review | Request/prepare only | No default |
| Payment evidence | Full | Restricted/full as needed | Restricted operational access | No default |
| Passports/identity documents | Full | Restricted/full as needed | Restricted operational access | No default |
| Supplier documents | Full | Full | Operational | Limited approved documents |
| Internal notes | Full | Full | Operational where relevant | Assigned notes only |
| Client-facing documents | Full | Full | Create/send according to policy | Draft/support only |
| Tasks/follow-ups | Full | Full | Create/update assigned work | Assigned tasks only |
| Audit history | Full | Full | Relevant history only | Own/assigned history only if approved |

## Role interpretation

### Admin/Owner

Should have complete operational and management visibility, including sensitive financial information, supplier costs, profit, refunds, payment evidence, and audit history.

This does not imply unrestricted deletion. Destructive actions should remain separately controlled.

### Manager

Should have broad operational visibility and the ability to review or approve:

- pricing exceptions;
- supplier purchases;
- reserve-before-client-payment cases;
- refunds;
- financial adjustments;
- sensitive document access;
- high-impact booking changes.

### Staff

Staff should be able to perform ordinary sales and operational work:

- capture inquiries;
- prepare quotations;
- manage bookings;
- coordinate suppliers;
- follow up clients;
- prepare vouchers;
- enter payment information;
- manage operational documents.

Supplier costs and margin visibility may be necessary for quotation work, but the exact boundary is **UNKNOWN / NEEDS WMIT VALIDATION.**

### Intern

Intern access should be restricted by default to assigned work and approved non-sensitive records.

Interns should not automatically see:

- supplier costs;
- markup/margin;
- profit;
- payment evidence;
- refunds;
- supplier purchase commitments;
- passports or identity documents;
- sensitive internal notes;
- unrestricted audit history.

## Approval-sensitive actions

These should require explicit policy and likely Manager/Admin confirmation:

- refund;
- financial adjustment;
- supplier purchase or payment;
- reserve-before-client-payment;
- major discount or pricing exception;
- external booking;
- sending sensitive documents;
- changing confirmed travel arrangements;
- exposing restricted documents.

## Decisions requiring owner approval

1. Whether ordinary Staff may see supplier cost and markup for all bookings or only assigned quotations.
2. Whether Staff may verify payments or only enter evidence for Manager/Finance review.
3. Whether a separate Finance role is needed.
4. Whether Managers and Admin/Owner have identical access.
5. Whether Interns may see client contact data beyond assigned tasks.
6. Who may approve reserve-before-payment, refunds, discounts, and supplier purchases.
7. How long audit history and sensitive documents should remain visible.
