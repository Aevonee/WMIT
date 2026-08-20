# WMIT Data Privacy Policy (DRAFT — for counsel review)

Status: operational draft. This document describes how Worldmaster International
Travel (WMIT) handles personal data inside the WMIT system. It is written for
internal use and for review by the agency's legal counsel. It is not legal
advice and must not be published until counsel has reviewed and approved it.

## 1. Scope

This policy covers personal data stored in the WMIT hosted system (SQLite
database, backups, and generated client documents), including:

- Identity and contact data: client names, email addresses, phone numbers,
  business names (Client, Person, Contact records).
- Travel data: destinations, travel dates, passenger lists, rooming lists,
  itinerary details.
- Sensitive personal information: passport scans and details, visa documents,
  birth dates attached to travel documents (Document records).
- Financial data: payment amounts, payment evidence (deposit slips, transfer
  receipts), billing details (ClientPayment, PaymentEvidence records).
- Marketing data: expo lead sign-ups (name, mobile, email, travel interests).

## 2. Roles and responsibilities

- The agency owner is the personal information controller.
- Staff accounts access data under least-privilege roles (staff / finance /
  manager / intern) enforced by the system's session and authorization layer.
- Interns are restricted to intern tasks and cannot access client records
  beyond what their supervised tasks require.
- Every read and write of consequence is recorded in the hash-chained audit
  log with actor, action, record, and timestamp.

## 3. Consent and purpose limitation

- Expo lead sign-ups record consent at capture: the sign-up form states the
  purpose (travel quotations and follow-up) and the lead record carries the
  consent timestamp and purpose text. Leads captured before this existed
  show as "legacy", not consent-denied; badge imports carry no explicit
  consent and also show as legacy until staff obtain one.
- Client records are created for the purpose of preparing quotations,
  bookings, travel documents, and servicing the client's bookings.
- Passport/visa documents are collected only when required to deliver a booked
  service (ticketing, visa processing, supplier requirements).
- Data is not used for any new purpose without a new consent or a lawful
  basis. [Counsel: confirm acceptable bases for business-record retention.]

## 4. Access and security measures

- Passwords are stored stretched and salted; sessions expire after six hours
  of inactivity; failed sign-ins are rate limited.
- Sensitive documents and finance operations are restricted by role.
- All backups are encrypted at rest by the hosting environment and rehearsed
  by automated restore checks.
- The audit chain is hash-chained; tampering is detectable.
- Uploaded files are validated and stored outside the public web root.

## 5. Retention schedule (DRAFT)

| Data | Retention | Notes |
|---|---|---|
| Expo lead records (non-converted) | 2 years after last contact | marketing relevance |
| Client identity/contact records | Life of relationship + 2 years | |
| Quotations | 2 years after issue | reference |
| Bookings and financial records | 10 years | [Counsel: confirm period under Philippine tax law for books and accounting records] |
| Passport/visa document scans | Deleted after departure + 30 days, unless a legal hold (disputes, chargebacks) applies | deletion via gated erasure action; the scheduled `privacy-retention` job raises a daily review task listing eligible documents — a human decides, nothing is erased automatically |
| Payment evidence | Same as financial records | |
| Audit log | 10 years | integrity of financial history |
| Backups | Rolling window per backup policy | restores must respect this schedule |

## 6. Data subject rights

- Access / correction: a client may request a copy of their data or a
  correction. Staff perform corrections through normal record updates; the
  audit log records the change. The `getPrivacyOverview` action reports what
  data exists per client (records by type, consent status, retention status
  per document), and `recordClientDataConsent` appends an audited consent
  history entry on the Client record.
- Erasure: a client may request deletion. WMIT honors erasure where no legal
  or financial retention duty applies. Erasure of client-attached documents
  is performed through the gated erasure action (`eraseClientDocuments`),
  which requires manager authority plus the typed confirmation string
  ERASE, and leaves an audit entry (what was deleted, by whom, when) —
  the audit entry records the fact of deletion, not the deleted content.
  Only passport/visa/identity documents are erasable; booking and financial
  records are never touched. Erasure keeps a metadata stub (document id,
  type, status ERASED) and nulls the payload, file name, classification,
  and extraction fields.
- Portability: client data can be exported on request by the owner.

## 7. Breach response

1. Any suspected breach is reported to the owner immediately.
2. The owner assesses scope using the audit log and system heartbeat records.
3. If sensitive personal information is reasonably believed compromised,
   notify the National Privacy Commission within 72 hours and affected data
   subjects per Commission guidance. [Counsel: confirm current thresholds
   and notification forms.]
4. Contain (revoke sessions, rotate credentials), document the incident and
   remediation, and review this policy.

## 8. Review

This policy is reviewed at least annually and after any material system
change. System-side enforcement of this policy lives in:

- consent capture: expo sign-up form and lead records; client consent
  history via `recordClientDataConsent`
- retention: gated erasure action (`eraseClientDocuments`) + scheduled
  `privacy-retention` review job (raises tasks only)
- access: role-based session enforcement; per-client inventory via
  `getPrivacyOverview`
- evidence: hash-chained audit log

See docs/implementation-status.md ("Data privacy" section) for the
enforcement features and their status.
