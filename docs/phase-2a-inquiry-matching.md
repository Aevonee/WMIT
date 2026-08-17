# Phase 2A inquiry and matching decisions

Phase 2A remains local-only and uses synthetic data. Google Workspace is not accessed or configured.

## Implemented decisions

- An Inquiry cannot be saved without a destination.
- Exact travel dates derive `duration_days` and `nights`.
- Approximate month/year timing requires `duration_days`; matching does not guess it.
- Traveler composition is stored as adults, children, infants, and a derived total. Legacy `pax_count` input is normalized as adults for compatibility with existing synthetic fixtures.
- The original client request is the primary visible Inquiry context; requirement history is secondary detail.
- Tariff sources retain their Supplier relationship as data. The Tariff Library presentation is supplier-neutral.
- Tariff review presents extraction counts as informational and focuses confirmation on interpretation fields and flagged uncertainty.
- Rate units are configuration-backed. Unrecognized or unsupported units cannot silently become trusted pricing.
- Matching persists a price preview with supplier cost, WMIT markup, fees, client-facing selling price, currency, and warnings when calculation is blocked.
- An approved quotation can produce at most one Booking. Repeated creation requests return the existing Booking idempotently.
- Client payment records capture payment purpose as intent. Verification and allocated funds still determine the actual balance.
- Untrusted tariffs are blocked from matching and quotation calculation.

Phase 2B extends this foundation with requirement certainty states, tariff-driven child-age matching, Find More Options reasons, richer match explanations, and protected downstream option replacement. See [phase-2b-inquiry-decision-support.md](phase-2b-inquiry-decision-support.md).

Automatic supplier ranking, autonomous purchasing/refunds/communications, OCR for its own sake, FX sourcing, and production integrations remain outside this phase.
