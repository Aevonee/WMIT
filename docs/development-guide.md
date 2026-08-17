# WMIT Development Guide

## For the owner

This project is currently a local foundation. You do not need to open Google Drive or create Google Sheets to run its tests.

### Run the tests

1. Open PowerShell.
2. Go to the project folder:

       cd D:\codex\wmit

3. Run:

       node scripts/run-tests.js

4. Expected result: 11 tests pass and 0 fail.

If PowerShell blocks npm, use the direct node command above. It does not need internet access or package installation.

## Folder guide

- src/config/: environment-safe configuration defaults.
- src/models/: versioned entity schema.
- src/ids/: central ID generation.
- src/validation/: reusable validation and relationship checks.
- src/core/: errors and lifecycle rules.
- src/logging/: audit logging.
- src/repositories/: storage contracts and in-memory test storage.
- src/services/: controlled business service functions.
- src/adapters/: future Google Sheets and Drive boundaries.
- tests/: unit, integration, and synthetic fixture tests.
- apps-script/: controlled Apps Script entry points and fresh-Workspace Sheets bootstrap; not connected until the owner deploys it.
- config/: environment examples; production IDs are intentionally blank or placeholders.
- docs/: project decisions and operating instructions.

## Safe change process

1. Read the relevant schema and architecture document.
2. Make the smallest local change.
3. Add or update a test that demonstrates the behavior.
4. Run node scripts/run-tests.js.
5. Review for new hard-coded IDs, bypassed services, missing audit events, and accidental sensitive data.
6. Update documentation if the schema or architecture changed.

Never manually edit synthetic fixture IDs to represent real clients or passengers. Real data must be introduced only after Workspace discovery, migration design, backup, and explicit approval.

## What must not be changed manually

- Do not add production spreadsheet IDs or Drive folder IDs to development/test configuration.
- Do not enable external actions in local configuration.
- Do not bypass service functions by writing directly to a future Google Sheet.
- Do not remove audit logging to make a test pass.
- Do not put API keys, passwords, OAuth tokens, passport numbers, or payment details in source or fixtures.

## Future production setup

After the owner has access to the main Google account, a separate read-only discovery step must inspect current files and permissions. Only then should production IDs be placed in an approved secret/configuration mechanism and Workspace adapters be implemented.
