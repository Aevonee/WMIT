# WMIT Business Architecture Validation — Open Decisions

> **SUPERSEDED by [baseline-v1.md](baseline-v1.md).** Owner-confirmed decisions in the baseline replace earlier open recommendations; only the baseline’s remaining unresolved decisions are current.

> **NON-EXECUTABLE:** Earlier recommendations and defaults here must not be implemented unless reclassified in [BASELINE-HANDOFF.md](BASELINE-HANDOFF.md).

Status: owner decisions required before implementation

Only architecture-changing decisions are listed here.

## 1. What exactly makes a Booking confirmed?

**Why it matters:** This controls lifecycle states, supplier risk, payment rules, dashboards, and client communication.

**Options:** verbal confirmation only; confirmation plus any payment; confirmation plus minimum deposit; confirmation plus verified payment and supplier action; or different rules by product/supplier.

**Recommended default:** Use separate states and treat “confirmed” as a policy result requiring recorded client commitment plus the required payment/deposit condition. Allow explicit exceptions.

**What changes:** Booking transitions, approval gates, dashboard logic, and supplier-reservation controls.

## 2. When may WMIT reserve before client payment?

**Why it matters:** This creates WMIT financial exposure and affects Supplier Booking, approval, deadlines, and money-held reporting.

**Options:** never; only for approved suppliers/products; only with Manager approval; or within a monetary/time threshold.

**Recommended default:** Permit only as an explicitly flagged exception with owner, deadline, supplier terms, and approval evidence.

**What changes:** Supplier Booking state, approval model, risk dashboard, and payable handling.

## 3. Can one Inquiry produce multiple Bookings?

**Why it matters:** This determines whether a separate Trip or Travel Party entity is necessary and how alternatives/conversions are represented.

**Options:** one Inquiry produces at most one Booking; one Inquiry may produce multiple independent Bookings; or one primary Booking plus supplemental/amended Bookings.

**Recommended default:** Allow one Inquiry to link to multiple options and potentially multiple Bookings without introducing a Trip entity yet.

**What changes:** Inquiry-to-Booking cardinality, reporting, customer history, and whether a Trip grouping becomes necessary.

## 4. How should invoices and payments relate?

**Why it matters:** This determines whether Payment Allocation and Unallocated Client Money are required in the first financial model.

**Options:** every payment references one Invoice; payments may precede invoices; payments may apply directly to Bookings/deposits; or one payment may be split across obligations.

**Recommended default:** Preserve the original receipt separately and support unallocated money plus explicit allocations. Begin with simple one-booking/one-invoice allocation but do not prohibit future split allocation.

**What changes:** Invoice, Payment, balance, refund, and reconciliation architecture.

## 5. What is the operational profit definition?

**Why it matters:** Management reporting will be misleading if fees, taxes, discounts, FX, refunds, and supplier changes are treated inconsistently.

**Options:** selling price less supplier cost; selling price plus WMIT fees less direct cost; exclusion of pass-through fees/taxes; inclusion of approved cancellation/refund effects; or separate expected and updated margin.

**Recommended default:** Show expected and updated operational gross margin with components separately labeled. Do not call it accounting profit.

**What changes:** Quotation totals, Booking financial views, dashboards, and reports.

## 6. Where does the Departure relationship live?

**Why it matters:** A Booking may contain services linked to different products or departures.

**Options:** Booking-level only; Booking Item-level only; or both, with Booking-level as a shortcut/derived value.

**Recommended default:** Use Booking Item-level association where needed, with a derived Booking-level grouping when all relevant items share a Departure.

**What changes:** Departure grouping, readiness, and relational cardinality.

## 7. Is a Commercial Option a required persistent record?

**Why it matters:** This determines whether rejected alternatives and availability evidence can be compared later.

**Options:** store only final Quotation/Booking; store options only when presented; store every researched option; or store a lightweight option plus source evidence.

**Recommended default:** Persist presented options and material rejected/unavailable alternatives; do not require detailed records for every casual search.

**What changes:** Inquiry model, availability history, reporting, and data-entry effort.

## 8. What level of communication history is needed?

**Why it matters:** Fragmented channels are a stated pain point, but full message ingestion adds complexity and privacy risk.

**Options:** source channel/thread reference only; manual communication activity log; attachment/document capture; or full mailbox/chat ingestion later.

**Recommended default:** Start with manual/lightweight communication activities and source/thread references. Defer full ingestion.

**What changes:** Inquiry, Client, Document, privacy, and integration scope.

## 9. What traveler information is required at each stage?

**Why it matters:** This controls Booking confirmation, supplier reservation, document readiness, and sensitive-data access.

**Options:** names only until booking; names and birth dates before reservation; passport details before ticketing/visa work; or destination/service-specific requirements.

**Recommended default:** Use staged requirements by service and destination; do not require sensitive fields universally.

**What changes:** Traveler model, permissions, document workflow, and readiness rules.

## 10. Who may approve refunds, supplier purchases, and pricing exceptions?

**Why it matters:** These are high-impact actions and cannot safely be inferred from Staff access.

**Options:** Admin/Owner only; Manager and Admin/Owner; thresholds by amount/product; or approval by assigned role.

**Recommended default:** Manager/Admin approval, with thresholds and exceptions defined before production.

**What changes:** Role model, audit requirements, and action workflows.
