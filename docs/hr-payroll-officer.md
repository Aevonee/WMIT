# HR and Payroll Officer

## Current status

WMIT now has a controlled, read-only specialist capability named **HR and Payroll Officer**. It is an application-layer wrapper around the existing `AttendanceService`; it is not yet a conversational AI agent, autonomous worker, payroll engine, or HR system.

## What it can read

- attendance dashboard summaries;
- attendance history with date, employee, role, branch, and status filters;
- attendance exceptions;
- read-only source availability information.

All results come through the existing attendance adapter and normalized projection. The existing attendance Apps Script and `Attendance Log` remain authoritative.

## What it cannot do

- write or correct Attendance Log records;
- change the Active Roster;
- access or display selfie links through normal responses;
- calculate salary, overtime, undertime, deductions, or payroll;
- decide lateness, absence, leave, or disciplinary outcomes;
- manage employees or interns;
- send messages or make external changes.

The name includes “Payroll” because this is the intended future specialist area. Payroll functionality is deliberately disabled until WMIT supplies verified pay rules, employee classifications, approval rules, tax/accounting requirements, and a secure payroll data source.

## Architecture

```text
HR and Payroll Officer
        ↓
AttendanceService
        ↓
AttendanceSourceAdapter
        ↓
Read-only Attendance Apps Script API
        ↓
Existing Attendance Log / Active Roster
```

The specialist does not receive repository access and does not call `SpreadsheetApp`. It returns structured read-only results suitable for a future manager interface or chat command layer.

## Reconsideration point

Do not add payroll calculations merely because hours are visible. First verify the WMIT attendance policy, pay periods, salary/rate source, overtime rules, approvals, privacy permissions, and accounting/legal requirements.
