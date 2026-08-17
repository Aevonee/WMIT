# Phase 2B inquiry decision support

Phase 2B remains local-only and uses synthetic data. It builds on the Phase 2A requirements-first Inquiry and matching workflow.

## Implemented scope

- Requirement certainty is represented with `REQUIRED`, `PREFERRED`, `UNKNOWN`, and `NOT_APPLICABLE` states. Unknown and not-applicable requirements are not silently treated as confirmed matches.
- Child ages are validated when supplied, but are only required for matching when a tariff condition explicitly requires them.
- Matching options retain structured match details and explain the fields that matched. Excluded candidates retain mismatch reasons, including unknown requirements and missing child ages.
- “Find More Options” records a reason and optional note through a controlled `FindMoreRequest` record. Supported reasons include client rejection, price, hotel, itinerary, supplier preference, more choices, and other.
- Replacing a selected option after a quotation or Booking requires backend confirmation. Confirmed replacement creates an `OptionReplacement` record, marks quotations for revision, and moves existing Bookings to client re-acceptance when applicable.
- Quotation and Booking lineage now retains the Inquiry ID when created from a selected Commercial Option, improving downstream safety and traceability.

## Safety boundaries

The matcher still does not rank Suppliers, choose the best option, assert live availability, send communications, purchase services, refund money, or edit Google Workspace. A confirmed option replacement is a controlled local state change; it is not client re-acceptance or a supplier amendment by itself.

## Verification

Regression coverage includes requirement-state matching, tariff-driven child-age blocking, recorded Find More reasons, quotation replacement confirmation, Booking lineage, and existing Phase 2A tariff/payment/Booking behavior.

