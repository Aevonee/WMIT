# Intern Management

This guide explains how WMIT tracks interns, assigns them restricted work,
and runs the supervisor review loop. It is written for staff using the system
for the first time. Implementation: `src/phase1/runtime.js` (Intern and
InternTask entities); actions are reachable through the whitelisted dispatcher
in `src/application/phase1.js`. Tests: `tests/integration/interns.test.js`.

## What is here

- **Intern profiles** — one record per intern, with IDs like
  `INTERN-2026-000001`.
- **Intern tasks** — restricted, supervised work items with IDs like
  `INTERN_TASK-2026-000001`. Interns never touch bookings, invoices,
  suppliers, or client data through this workflow; they only see and work
  their own tasks.

## The intern profile

A profile stores: `name`, `school` (you may pass `organization`; it is saved
as `school`), `email`, `phone` (optional), `supervisor_username`,
`username` (optional but recommended — the intern's WMIT account name),
`period_start`, `period_end` (both `YYYY-MM-DD`), `status`
(`Active` or `Inactive`), and `notes` (optional).

Rules enforced at create and update:

- `name`, `school`, `email`, `supervisor_username`, `period_start`, and
  `period_end` are required.
- The email must be a valid address (`INTERN_EMAIL_INVALID` otherwise).
- `period_end` cannot be before `period_start` (`INTERN_PERIOD_INVALID`).
- The same name + school combination cannot be registered twice
  (`INTERN_DUPLICATE`, with the existing `INTERN-…` ID in the error details —
  open that record instead of creating a second one).
- `username` must be a valid WMIT username and only one profile may claim a
  given username (`INTERN_USERNAME_IN_USE`). This link is what later lets the
  intern submit their own tasks.
- `supervisor_username` must be a valid WMIT username format. The domain layer
  cannot verify the account exists (accounts live in the hosted auth store),
  so double-check the spelling.

Actions: `createIntern`, `updateIntern` (pass `intern_id` plus `changes`),
`listInterns` (optional filters `status`, `supervisor_username`). Creating and
updating intern profiles is a staff-level action in the hosted role model.

## The intern task lifecycle

```
            assign (staff)          submit (the intern)         review (staff)
   [ nothing ] ───────► OPEN ──────────────► SUBMITTED ─────┬────► APPROVED (done)
                           ▲                                  │
                           └────── REJECTED (with feedback) ──┘
```

1. **Assign** — staff call `assignInternTask` with `intern_id`, `title`,
   `instructions`, and an optional `due_at`. The task starts as `OPEN`.
   Tasks cannot be assigned to an `Inactive` intern (`INTERN_INACTIVE`).
2. **Submit** — the intern calls `submitInternTask` on their own task,
   optionally with a `submitted_note`. The task moves to `SUBMITTED`.
3. **Review** — staff call `reviewInternTask` with a `decision`:
   - `APPROVED` (optional `review_feedback`) → the task is `APPROVED` and
     finished.
   - `REJECTED` (**`review_feedback` required** — the intern needs to know
     what to fix) → the task **reopens as `OPEN`** so the intern can rework
     and resubmit it. Each rejection bumps `rejection_count`.

Illegal jumps are rejected: a task that was never submitted cannot be
approved (`INTERN_TASK_STATE_INVALID`), an approved task cannot be resubmitted,
and only a `SUBMITTED` task can be reviewed. Submitting the same task twice is
safe — the retry returns the already-submitted task unchanged
(`meta.idempotent: true`), so a double-click or network retry never creates a
duplicate submission.

## The authority model (who may do what)

| Action | Who may call it |
|---|---|
| `createIntern`, `updateIntern`, `listInterns` | Staff and Admin |
| `assignInternTask` | Staff and Admin (`ASSIGN_INTERN_TASK`) |
| `reviewInternTask` | Staff and Admin (`REVIEW_INTERN_TASK`) |
| `submitInternTask` | **Only the intern themselves** |

How ownership works:

- A signed-in intern is identified by their actor string `USER:<username>`.
- `submitInternTask` accepts **only** a `USER:<username>` actor
  (`INTERN_ACTOR_INVALID` for anything else — staff cannot submit on an
  intern's behalf).
- The task's intern profile must have `username` equal to the signed-in
  username, or the submit fails with `INTERN_TASK_NOT_OWNED`. An intern can
  never submit another intern's task.
- An `Inactive` intern can neither receive new tasks nor submit existing ones.

On the hosted server the roles map like this: **ADMIN** gets every staff and
manager action, **STAFF** gets the staff list (including both intern-task
actions), and **INTERN** accounts get no staff actions — their single
write-capable domain action is `submitInternTask`, gated by task ownership
rather than by role. Until the HTTP layer opens intern write access (a later,
separate change), intern accounts remain read-only over HTTP; the domain rules
described here are already in force.

## Audit

Everything is audited, success and failure alike. Each audit row records the
actor, action, entity, result, and details:

- Profile and task creation/update produce the usual `CREATE`/`UPDATE` rows.
- Lifecycle transitions additionally write explicit `ASSIGN_INTERN_TASK`,
  `SUBMIT_INTERN_TASK`, and `REVIEW_INTERN_TASK` rows (with `from_state` /
  `to_state` / `decision`).
- Blocked attempts — duplicates, invalid fields, wrong owner, missing
  authority, illegal state jumps — write `FAILURE` rows with the error code
  (for example `details.error_code: 'INTERN_TASK_NOT_OWNED'`), so you can
  always answer "who tried what, and why did it fail".

## Error codes at a glance

| Code | Meaning |
|---|---|
| `INTERN_DUPLICATE` | Name + school already registered (existing ID in details) |
| `INTERN_EMAIL_INVALID` | Malformed email address |
| `INTERN_PERIOD_INVALID` | Bad or reversed period dates |
| `INTERN_STATUS_INVALID` | Status must be `Active` or `Inactive` |
| `INTERN_USERNAME_INVALID` / `INTERN_USERNAME_IN_USE` | Bad or already-linked WMIT username |
| `INTERN_SUPERVISOR_USERNAME_INVALID` | Malformed supervisor username |
| `INTERN_INACTIVE` | Task action involving an inactive intern |
| `INTERN_ACTOR_INVALID` | Submit attempted by a non-`USER:` actor |
| `INTERN_TASK_NOT_OWNED` | The task belongs to a different intern |
| `INTERN_TASK_STATE_INVALID` | Illegal state jump (e.g. `OPEN` → `APPROVED`) |
| `INTERN_TASK_DECISION_INVALID` | Decision must be `APPROVED` or `REJECTED` |
| `INTERN_TASK_FEEDBACK_REQUIRED` | Rejection without feedback |
| `INTERN_TASK_DUE_AT_INVALID` | Malformed due date |
| `AUTHORIZATION_REQUIRED` | Actor lacks staff authority for the action |
