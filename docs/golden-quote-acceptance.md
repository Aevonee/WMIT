# Golden-quote acceptance test

Purpose: prove WMIT's pricing math reproduces what the agency **actually
charged** before real money flows through the system. Unit tests verify code
against itself; this verifies the business rules were understood correctly.

**Who:** owner supplies the numbers, any staff member enters them.
**Time:** ~15 minutes per quote. **Do this before September 4.**

## Picking the golden quotes (owner, ~5 min)

Choose 2–3 real quotes issued before WMIT, ideally different shapes:

1. One standard package quote where a markup percentage was applied.
2. One with explicit fees and/or a discount (visa fee, card surcharge, promo).
3. One expo-priced or special-context quote, if any exist.

Each needs: supplier cost, final client price actually charged, currency, and
roughly what went into the price (markup %, fees, discount, FX treatment).

## Running the test (staff, ~10 min per quote)

1. Sign in, Inquiries → create the inquiry (destination, dates, pax from the
   real quote).
2. Quotations → **Create Manual Quotation** (set the currency and quote date)
   — this opens a draft priced at zero; the prices come from the next step.
3. In the draft's service table, add the real quote's services as line items:
   service type, description, quantity, **unit cost** (what the supplier
   charged), **unit selling price** (what was quoted per unit). Add every
   line the original quote had.
4. The quotation card's **Client price** and the *Pricing explanation* table
   now show the computed totals. Compare the **Total client price** against
   the price actually charged. (If the original quote was priced by markup
   rule instead of explicit per-service prices, use *Review or edit draft
   pricing* — Markup %, fixed fees, discount — rather than entering item
   prices.)
5. Record the result below.

## Recording results

Keep real client names **off this sheet** — amounts, dates, and destinations
only. The repository must stay free of business data.

| # | Quote date | Destination | Supplier cost | WMIT total | Actually charged | Match? | Notes |
|---|-----------|-------------|---------------|------------|------------------|--------|-------|
| 1 |           |             |               |            |                  |        |       |
| 2 |           |             |               |            |                  |        |       |
| 3 |           |             |               |            |                  |        |       |

## Verdict rules

- **Match** — totals identical: pass.
- **Explained delta** — difference is fully explained by an explicit rule
  choice (different markup % was entered, a fee was left out): adjust the
  entry and re-run; still pass if the rules behaved as configured.
- **Unexplained delta** — the math produced a different number for the same
  inputs: **this is a bug report.** Keep the numbers and report the row
  above; do not ship real quotations until resolved.

## Sign-off

Tested by: ______________ Date: ________ Result: ☐ pass ☐ pass with notes ☐ bug found
