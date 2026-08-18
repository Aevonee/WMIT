# WMIT Troubleshooting

## General rule

Do not retry a write repeatedly until the result is known. First check the audit log, target sheet, and Drive folder to determine whether the action partially succeeded.

## Common situations

### Staff member forgot their password

An admin resets it from the workspace: Settings → WMIT accounts →
reset-password. If no admin can sign in (or the admin password itself is
lost), reset from the server with:

```text
npm run admin:reset -- <username>
```

Stop the server first, run the command, note the printed one-time password
(never stored anywhere), restart the server, and have the staff member change
it on first sign-in.

### WMIT folder already exists

The initializer should reuse an exact unique match. If multiple matches are found, stop and ask the owner to select the correct folder. Do not create another root.

### A sheet or column is missing

Do not silently create a replacement with a different name. Compare the approved schema, report the mismatch, and require an explicit schema update or migration decision.

### Duplicate ID or invoice number

Stop the operation, inspect the counter and audit log, and do not overwrite either record. Central numbering must be repaired before retrying.

### Connector permission error

Confirm the connected account, requested scope, and file sharing. Use the manual fallback and do not ask the owner to grant broad access without explaining the data exposure.

### PDF extraction is uncertain

Keep the source file, store the extracted result as draft data, record confidence, and create a human-review task. Never silently attach it to a booking.

### Financial totals disagree

Do not edit the payment or invoice history to make totals match. Compare invoice items, discounts, fees, taxes, payments, and audit records, then request authorized approval for a correction.

### Apps Script execution fails

Capture the function name, record ID, correlation ID, error message, and last successful step. Check quotas, permissions, configuration, and recent schema changes. Retry only after determining whether the first attempt committed data.

## Escalation information

When reporting a problem, include the phase, function, record ID, time, exact error, expected result, actual result, and whether the operation was retried. Do not paste secrets or unnecessary personal data.
