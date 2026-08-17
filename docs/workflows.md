# WMIT Workflows

## Status

These are target workflows, not implemented automation. They describe the intended handoffs and approval points.

## Lead to booking

1. Receive inquiry from Facebook, B2B, WhatsApp, Viber, email, walk-in, referral, expo, repeat client, website, or other source.
2. Create or update a Lead with source, contact, destination, dates, pax, owner, and next follow-up.
3. Match an existing Client or create a new Client after duplicate checks.
4. Research land arrangements, flights, hotels, transfers, and tours from an identified source.
5. Create a draft Quotation with supplier cost, markup, fees, client price, and estimated margin separated.
6. Human reviews and approves the quotation.
7. Send or export the approved quotation only after confirmation.
8. Convert an accepted quotation into a Booking without re-entering core details.

## Booking to travel

1. Create Booking Travelers from existing Traveler records.
2. Create Supplier Bookings for required procurement.
3. Record supplier confirmations, flights, hotels, land arrangements, tickets, and vouchers.
4. Create invoice and payment records under approval rules.
5. Track Document Requirements and missing information.
6. Generate itinerary and vouchers from structured records.
7. Calculate departure readiness and show the exact unresolved issues.

## Document ingestion

1. Receive a file from an approved source.
2. Store it in the appropriate Drive folder and create a Documents row.
3. Classify the document.
4. Extract structured data with confidence and source reference.
5. Search for candidate record matches.
6. Present uncertain matches for human confirmation.
7. Commit only confirmed relationships and create follow-up tasks for missing data.

## Invoice and payment

1. Select or create Client and Booking.
2. Add Invoice Items.
3. Calculate totals from controlled inputs.
4. Create a draft invoice with a unique number.
5. Human approves before sending.
6. Save the generated PDF and link it to the invoice.
7. Record each payment separately with evidence and verification status.
8. Recalculate balance and update receivables without deleting payment history.

## Manager daily review

The Manager should gather current records from Sales, Operations, Finance, Documents, Suppliers, Departures, Marketing, Expos, and Interns. It should return a prioritized list with record IDs, reasons, due dates, confidence, and the next recommended action. It must report “not available” when a source is not connected or a record is missing.
