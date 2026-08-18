# WMIT staff cheat sheets

One page per role. Everything here works on the office desktop and on a phone
browser. Sign in at the workspace URL with your WMIT username and password
(sessions last six hours; sign in again if a page asks you to).

## Daily routine (everyone)

1. **Sign in, open Dashboard.** "What needs you now" lists everything that
   needs action today — payments overdue, quotes awaiting approval, overdue
   follow-ups, leads without mobile numbers. Every row has a button that
   takes you straight to the case.
2. **Work the queues top to bottom.** Red-flagged payment rows first.
3. **Search instead of navigating.** The search box in the top-right corner
   finds clients, cases, quotations, bookings, suppliers, leads — by name,
   mobile number, email, or ID. Arrow keys + Enter to jump.
4. Confirmations appear in the **top-right corner**: green ✓ = done, red ✕ =
   something failed (the message says why). If a toast disappears before you
   finished reading, just redo the action.

## The Case workspace (your home base)

One screen shows the whole trip: client, destination, dates, stage,
quotations, booking and travelers, payment obligations, supplier
confirmations, documents, and follow-up tasks.

- **Next steps** at the top tells you what this case needs — in plain
  language, with a button to the right workspace.
- The **jump bar** (Requirements · Quotation · Booking · Payments ·
  Documents & follow-ups) takes you to the working tab for that part.
- Dashboard rows and search results both land here.

## Sending messages (no more copy-paste)

Every lead, follow-up, quote, and case has a **Message** button. Pick a
template (thank-you, quote delivery, deposit reminder, balance reminder,
booking confirmed, documents request…), the system fills in the client's
name, destination, amounts, and dates from the real records, you can edit
the text, then **Copy / Open WhatsApp / Open Viber**.

- Missing details are simply left out — a `{{placeholder}}` never reaches
  a client.
- Quote messages fetch the quote link only when the template uses it.

## Staff — common tasks

| Task | Where |
|---|---|
| New lead came in / badge import | Events console → Leads & import |
| Day 1/3/7 follow-ups | Events console → Follow-ups (overdue first) |
| Send a quote | Events console → Quotes: pick packages → create → Message or Email quote |
| Record a client payment | Operations → Finance (case selected) |
| Issue a payment receipt | Operations → Finance (case selected) → Issue receipt — after the payment is verified; receipt numbers are sequential and permanent |
| Print client documents | Case buttons: Quotation tab → Preview itinerary · Finance tab → Client invoice / Tour voucher · Print (browser print → PDF) |
| Email a client document | Open the document → Email → confirm the address — every send is audit-logged |
| Add a supplier | Operations → Suppliers → Add supplier |
| Convert an expo lead to a real case | Events console → Leads → Convert — creates the Client + Inquiry with the lead's brief; continue in Operations |
| Export data (suppliers, payments, expo leads) | The Export CSV buttons on each list — opens in Excel |
| Change my password | Top-right → Change password |

**Escalate to the admin/manager when:** a quotation needs approval, a
supplier payable needs approval, anything refunds/deletions, or a client
asks for a commitment you're not sure about. When something is not
executed, the red toast names the reason — "needs manager authority"
means exactly that.

## Admin — everything staff can do, plus

| Task | Where |
|---|---|
| Approve quotations | Operations → Quotation (case selected) |
| Create staff accounts, reset passwords | Operations → Settings → WMIT accounts |
| Edit message templates | Operations → Settings → Message templates |
| Quotation/payment defaults | Operations → Settings |
| Review the activity log | Operations → Settings → Activity log — who changed what, with a chain-verified badge |
| Check backups and system health | Operations → Settings → System health — last successful backup, heartbeat, audit chain |
| End an expo event | Events console → Events |

**Rules that protect you:** you cannot disable your own account or remove
the last active admin; changing your password signs out your other
devices; every account and template action is audit-logged.

## If something looks wrong

- **"Sign in to WMIT" on everything** → session expired; sign in again.
- **An action shows ✕ NOT EXECUTED** → read the message; it names the
  missing field or the required authority. Nothing half-happens — the
  system either does the action or refuses it completely.
- **Kiosk offline at the expo** → submissions save on the tablet and send
  automatically when the connection returns; keep the tab open.
- Still stuck → note the red toast text and tell the admin.
