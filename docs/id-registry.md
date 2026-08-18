# WMIT ID Registry

Every important record receives a centrally generated, immutable,
human-readable ID. IDs are never reused, never edited, and (on the hosted
server) survive restarts because the next sequence number is derived from the
database itself.

## Format

- Year-based: `PREFIX-YYYY-NNNNNN` — e.g. `BOOKING-2026-000042`
- Non-year-based: `PREFIX-NNNNNN` — e.g. `CLIENT-000017`
- Years use the business timezone (Asia/Manila).
- Sequence numbers are six digits and zero-padded.

## Entity ID prefixes

| Entity | Prefix | Year-based |
|---|---|---|
| Person | `PERSON` | no |
| Client | `CLIENT` | no |
| Inquiry | `INQUIRY` | yes |
| CommercialOption | `OPTION` | yes |
| AvailabilityEvidence | `AVAILABILITY` | yes |
| Supplier | `SUPPLIER` | no |
| SupplierContact | `SUPPLIER_CONTACT` | yes |
| SubAgent | `SUB_AGENT` | no |
| SupplierPackage | `SUPPLIER_PACKAGE` | yes |
| Document | `DOCUMENT` | yes |
| TariffSource | `TARIFF` | yes |
| TariffExtractionFact | `TARIFF_FACT` | yes |
| TariffRateComponent | `TARIFF_RATE` | yes |
| TariffItineraryComponent | `TARIFF_ITINERARY` | yes |
| CommercialPricingContext | `PRICE_CONTEXT` | yes |
| Quotation | `QUOTATION` | yes |
| QuotationAcceptance | `QUOTATION_ACCEPTANCE` | yes |
| QuotationItem | `QUOTATION_ITEM` | yes |
| Booking | `BOOKING` | yes |
| OptionReplacement | `OPTION_REPLACEMENT` | yes |
| FindMoreRequest | `FIND_MORE` | yes |
| BookingParticipant | `BOOKING_PARTICIPANT` | yes |
| BookingItem | `BOOKING_ITEM` | yes |
| AvailabilityHold | `AVAILABILITY_HOLD` | yes |
| TicketingRecord | `TICKETING` | yes |
| Voucher | `VOUCHER` | yes |
| RoomingListEntry | `ROOMING_ENTRY` | yes |
| SupplierBooking | `SUPPLIER_BOOKING` | yes |
| SupplierBookingItem | `SUPPLIER_BOOKING_ITEM` | yes |
| ClientObligation | `CLIENT_OBLIGATION` | yes |
| ClientInvoice | `CLIENT_INVOICE` | yes |
| PaymentScheduleItem | `PAYMENT_SCHEDULE` | yes |
| ClientPayment | `CLIENT_PAYMENT` | yes |
| PaymentEvidence | `PAYMENT_EVIDENCE` | yes |
| PaymentAllocation | `PAYMENT_ALLOCATION` | yes |
| SupplierPayable | `SUPPLIER_PAYABLE` | yes |
| SupplierPayment | `SUPPLIER_PAYMENT` | yes |
| RefundAdjustment | `REFUND_ADJUSTMENT` | yes |
| Amendment | `AMENDMENT` | yes |
| Reconciliation | `RECONCILIATION` | yes |
| Task | `TASK` | yes |
| CommunicationActivity | `COMMUNICATION` | yes |
| Departure | `DEPARTURE` | yes |
| DepartureMembership | `DEPARTURE_MEMBERSHIP` | yes |
| DepartureReadinessIssue | `DEPARTURE_ISSUE` | yes |
| ExpoLead | `EXPO_LEAD` | yes |
| ExpoPackageTemplate | `EXPO_PACKAGE` | yes |
| ExpoQuote | `EXPO_QUOTE` | yes |
| ExpoEvent | `EXPO_EVENT` | yes |
| Receipt | `RECEIPT` | yes |
| AuditEvent | `AUDIT_EVENT` | yes |

## Other identifiers

| Kind | Format | Source |
|---|---|---|
| Audit entries (hosted) | `AUDIT-<uuid>` | hash-chained `audit_log` table |
| Audit entries (in-memory dev) | `AUDIT-YYYY-NNNNNN` | `IdGenerator` |
| Auth events (hosted) | `AUTH-<uuid>` | `auth_audit` table |
| Session tokens (hosted) | 72-char random hex | never logged in full |
| Voucher QR links (planned) | `/v/VOUCHER-YYYY-NNNNNN?sig=…` | signature derived from the record |

The authoritative source of these prefixes is `ENTITY_DEFS` in
`src/phase1/runtime.js`. The Apps Script artifact retains its Phase 1–2
entity subset in `apps-script/WmitSheetServices.gs` (`PREFIXES`); entities
added to the hosted runtime after the Apps Script freeze (expo tooling,
Receipt, and later additions) are hosted-only and are not ported there.
