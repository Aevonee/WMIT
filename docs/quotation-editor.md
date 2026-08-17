# WMIT Manual Quotation Editor

Status: local Phase 3B prototype; not production-ready.

Phase 3B.1 hardening adds pre-write quotation validation. A quotation update now builds and calculates the proposed complete state before persistence. If validation or calculation fails, the existing quotation remains unchanged.

The visible product name remains **WMIT Operations**. The prototype supports:

```text
Select/create quotation → edit details → add/edit/reorder/remove items
→ save → client-facing preview → browser print
```

## Internal editor

The internal editor shows client, travel details, validity, status, currency, service lines, suppliers, quantity, internal cost, selling price, dates, discounts, fees, tax, inclusions, exclusions, payment terms, payment currency policy, itinerary, internal notes, cost subtotal, margin, and client total.

Quotation item order is stored in optional `line_order`. New item IDs remain centrally generated and immutable.

## Quotation versus invoice

The quotation is a pre-confirmation sales document. It presents the proposed travel package, day-by-day itinerary, inclusions, exclusions, terms and conditions/payment terms, validity, and selling price. It is not the confirmation invoice.

The invoice is a separate post-confirmation operational-finance document created from a Booking. Invoice creation, invoice items, payments, balances, and supplier payments remain in the Finance section and are not rendered as part of the quotation preview.

## Client-facing preview

`getClientQuotationPreview()` returns a deliberately limited object containing WMIT identity, client information, travel details, services, selling amounts, totals, inclusions, exclusions, payment terms, and validity.

It does not contain supplier IDs/names, supplier cost, internal margin, internal notes, or WMIT database IDs. This is enforced before HTML rendering; CSS is not the security boundary.

Non-flight quotation items are grouped into one `Tour Package` line in the client-facing preview. Staff retain the detailed service, supplier, cost, and margin records internally. The separate air itinerary shows route, schedule, calculated duration, and baggage allowances. Air itinerary entries support `FLIGHT` and `LAYOVER` segments.

The preview header uses the supplied official `tests/fixtures/reference-documents/header.png`, copied to `app/public/assets/header.png`. It contains the World Master International Travel identity, contact details, and affiliations. Supplier logos are not used. The hierarchy was informed by the two WMIT-owned references: client, destination/travel details, itinerary, services, totals, inclusions/exclusions, terms, validity, and contact/footer.

## Day-by-day itinerary editor

The quotation editor supports an **Add day** action. Each day has separate fields for day number, date, city/area, title, activities/services, meals, overnight accommodation, and optional notes. The current local model stores these day cards as a JSON string in the existing `Quotation.itinerary` field so older free-text itineraries remain readable. The client preview renders the cards as separate day sections and does not expose internal cost or supplier fields.

This is intentionally a small WMIT-specific version of the useful itinerary-builder pattern: clear day-by-day structure, accommodation visibility, meals, and readable client presentation. Travefy's broader strengths include polished client presentation, supplier/content libraries, and mobile access, while travel-agent feedback also emphasizes clarity on mobile and easy reuse/editing. Those larger capabilities are deliberately deferred until WMIT's workflow is validated.

## Payment currency and installments

Workspace Settings control the default terms and payment deadlines: down payment three days after reservation and final balance 30 business days before departure. Staff can edit the due date on each client payment schedule item before saving.

The quotation currency is the billing currency. For a USD quotation, the client may pay USD or PHP. A PHP payment requires the user to record the BDO Forex Selling Rate plus 1.0 used on that payment date. Each installment stores its own payment currency, actual amount received, invoice-currency amount applied, rate, rate date, and rate source. There is no live BDO lookup in this local prototype.

## Print behavior

The preview uses browser printing. The stylesheet targets A4, removes navigation and controls, repeats table headers where supported, and avoids splitting totals and major sections where possible. Longer quotations keep inclusions, exclusions, payment terms, and the footer together as a deliberate terms section rather than forcing those details into an awkward split. No PDF is generated or stored.

The client service table hides the Dates column when none of the quotation items has a service date. If any item has a service date, the column remains visible and undated rows use a dash.

The quotation header uses a responsive two-column layout that allows the logo to shrink without pushing the quotation title outside the printable area. On narrow screens it stacks the title below the logo. Blank or zero discounts are omitted from the client-facing financial summary; the underlying operational value remains available for calculations.

## Currency and money controls

All quotation items must use the quotation currency. Mixed quotation currencies are intentionally unsupported until an explicit FX conversion model is implemented. The system does not silently convert item prices.

The portable quotation calculation module uses safe integer minor units represented as JavaScript Numbers and rejects values above the exact safe range. Invoice/payment calculations use the existing BigInt minor-unit module. This keeps normal travel quotations exact while remaining easy to port to Apps Script; oversized quotation lines are rejected rather than rounded silently.

After a Lead is created, its immutable ID is retained as the selected lead for the next quotation action. The initial quotation form accepts currency, destination, travel dates, and pax; the editor remains available for itinerary, inclusions, exclusions, payment terms, and notes.

## Apps Script portability

`src/application/quotation-editor.js` is a dependency-free UMD module. Node can load it with `require()`; Apps Script can load it as global `WmitQuotationEditor`. `apps-script/WmitQuotationEditor.gs` exposes controlled entry points that depend on injected services rather than direct `SpreadsheetApp` calls.

The local browser still uses the Node HTTP adapter in this phase. The preview contract identifies the logo as `wmit-logo.png`; an eventual Apps Script HTML deployment should serve or embed that asset separately. Google Sheets persistence, authentication, Drive storage, and Apps Script deployment remain intentionally unimplemented.

## Assumptions and limitations

- A quotation is currently created from a Lead because the preliminary schema still requires `lead_id`; this does not require a supplier document.
- The included logo asset is a reference-derived WMIT header image. Official approval of the exact production logo/contact/payment details remains outstanding.
- One quotation currency is assumed for totals; mixed currencies remain unverified.
- Browser print is the first output; PDF generation and email are not implemented.
- Existing preliminary quotation statuses are used without approval automation.
- Removing an item is blocked after it has been used by a Booking.
