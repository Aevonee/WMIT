# WMIT Google Drive Structure

## Status

This is a design document only. No Drive folders have been created.

## Root and child folders

The system must search for an existing folder named WMIT before creating one. If multiple candidates exist, setup must stop and ask the owner to choose; it must not guess.

    WMIT/
    ├── 00_SYSTEM/
    │   ├── Configuration/
    │   ├── Logs/
    │   ├── Templates/
    │   ├── Backups/
    │   └── Documentation/
    ├── 01_CLIENTS/
    ├── 02_LEADS/
    ├── 03_QUOTATIONS/
    ├── 04_BOOKINGS/
    ├── 05_DEPARTURES/
    ├── 06_TICKETS/
    ├── 07_HOTELS/
    ├── 08_LAND_ARRANGEMENTS/
    ├── 09_VOUCHERS/
    ├── 10_ITINERARIES/
    ├── 11_INVOICES/
    ├── 12_PAYMENTS/
    ├── 13_DOCUMENT_PROCESSING/
    ├── 14_SUPPLIERS/
    │   ├── Wholesalers/
    │   ├── Tour_Operators/
    │   ├── Airlines/
    │   ├── Hotels/
    │   └── Other_Suppliers/
    ├── 15_MARKETING/
    ├── 16_EXPOS/
    ├── 17_INTERNS/
    ├── 18_REPORTS/
    └── 99_ARCHIVE/

## Configuration

The root folder ID, child-folder IDs, operational spreadsheet ID, and template IDs belong in a controlled configuration sheet or Script Properties. Folder IDs must not be hard-coded in individual modules.

## Idempotent initialization

The future initializeWmitDrive routine must:

1. Search for an exact root-folder candidate.
2. Stop if the result is ambiguous.
3. Reuse an existing root and children where names match.
4. Create only missing folders.
5. Record every created or reused ID.
6. Write an audit entry.
7. Return a setup report.

It must not delete, move, rename, or overwrite existing business files during initialization.

## File metadata

Important files should include structured metadata where supported and a corresponding row in Documents. Metadata should include:

- file ID and URL
- file type
- source
- client ID
- lead ID
- booking ID
- departure ID
- invoice ID
- voucher ID
- document ID
- supplier ID
- confidence and review status where extracted
- created and updated timestamps

Only applicable IDs should be populated.

## File naming

Use safe names such as:

    INVOICE-2026-000123-Juan-Dela-Cruz.pdf
    ITINERARY-2026-000123-Juan-Dela-Cruz.pdf
    VOUCHER-2026-000123-Hotel-ABC.pdf

Names must be sanitized, avoid unnecessary sensitive data, and never be treated as unique keys. The Drive file ID remains the stable file identifier.

## Access model to confirm

Management and authorized operations staff need broad operational access. Finance access should include financial records and outputs. Intern access should be restricted to assigned tasks and explicitly approved non-sensitive materials. Sensitive identity documents and payment evidence require narrower access.
