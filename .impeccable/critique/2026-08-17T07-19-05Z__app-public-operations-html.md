---
target: the Operations Workspace
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-08-17T07-19-05Z
slug: app-public-operations-html
---
# Design Critique — WMIT Operations Workspace (operations.html + operations.js)

Method: hybrid (A: oracle sub-agent ses_ff172147effelgjYlGG0qgoGkT · B: inline detector — sub-agent spawn failed with ProviderModelNotFoundError; detector ran in parent, judgment isolated in A before B output entered context)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | Stamped pills, state pipeline, NEXT ACTION ticket, aria-live, explicit "NOT EXECUTED" |
| 2 | Match System / Real World | 3 | Deep travel vernacular, but internal terms leak ("Commercial Option", "projection", "payable") |
| 3 | User Control and Freedom | 3 | Back-paths and cancels exist; no undo by design (ledger); confirm() on reset |
| 4 | Consistency and Standards | 2 | Tab triple-named (Follow-ups / Documents & Tasks / operations); normalizeDisplayText divergence; CSS sediment |
| 5 | Error Prevention | 3 | Required-attention ring + focus + certainty pairs; two-green choice points undermine |
| 6 | Recognition Rather Than Recall | 3 | Ambient case header carries context; 14 unordered tabs force recall |
| 7 | Flexibility and Efficiency | 2 | No shortcuts, no bulk, no sortable/filterable work queues |
| 8 | Aesthetic and Minimalist Design | 3 | Disciplined flat ledger; verbose prose patched post-hoc; dense stacked cards |
| 9 | Error Recovery | 4 | Field-focus mapping, humanized errors with recovery guidance, authority how-to |
| 10 | Help and Documentation | 2 | Micro-copy carries all documentation; no onboarding or glossary |
| **Total** | | **29/40** | **Good — address weak dimensions** |

## Design Specificity Verdict

**LLM assessment:** ~85% authored for THIS product. The token ontology (harbor-navy authority band, manifest-green single action, stamped pills, ink rule), the case-command-center interaction model driven by a case projection, and the ledger-speak copy ("Nothing is silently selected as the current case", "No money was moved") are not interchangeable with a neighboring product. The most generic layer is the information architecture: 14 flat, unordered tabs mixing case-scoped stages (Quotations, Bookings) with global records (Clients, Suppliers) and system views (Settings). The normalizeDisplayText patch layer homogenizes labels back toward generic ("Open").

**Deterministic scan (degraded regex mode):** 3 findings on operations.html — timeline rail side-tab (false positive: structural axis, not a card accent), Inter overused font (incumbent identity, retained deliberately), plus 12 advisory font-size findings on expo/quote public surfaces (all sanctioned by the Public Register addition to DESIGN.md — the hook hasn't consumed that prose section yet).

## Priority Issues

1. **[P1] normalizeDisplayText post-render copy rewriting** (operations.js:2813-2835) — copy is authored verbose in ~20 render sites then mechanically rewritten via DOM tree-walk. Authored ≠ shipped; editing template copy silently does nothing. Fix: bake final labels into render sites, delete the walker. (/impeccable clarify)
2. **[P1] Navigation architecture** — 14 flat tabs in non-lifecycle order (Finance 4th, before Quotations 11th/Bookings 12th; Settings mid-stream); one tab has three names (nav "Follow-ups", panel "Documents & Tasks", data-tab "operations"); case-scoped vs global tabs visually undifferentiated. Fix: reorder by lifecycle or group into Work / Records / System zones; align names; mark case-scoped tabs. (/impeccable layout)
3. **[P2] Render-cycle side effects** — every action and hashchange re-renders all 14 sections; focus is stolen to the message region after every success; errors auto-hide at 9s; table-well scroll resets; .table-wrap has no tabindex (keyboard users cannot scroll record tables). Fix: render active tab only, restore focus/scroll, persistent dismissible errors, tabindex on scroll wells. (/impeccable optimize + harden)
4. **[P2] One-green violations** — renderQuotation no-quote state shows TWO green primaries ("Create Draft Quotation" + "Create Manual Quotation", operations.js:1392-1394); dashboard shows two greens (create/view inquiries + open selected). Violates DESIGN.md's own One Action Rule. Fix: demote manual/quotation-secondary paths to slate. (/impeccable polish)
5. **[P2] Ungated test chrome + dead code** — "Fill test fields" (amber) and "Reset synthetic data" (red) permanently in the shell header; .workflow-band force-hidden dead markup; renderInquiry dead block (906-917); events array appears write-only. Fix: env/role-gate test buttons; delete dead code. (/impeccable distill)

## Persona Red Flags

**Alex (power user):** focus bounced to message region after every action; no sortable/filterable work queue for multi-case sprints; no keyboard shortcuts; `latest()`-wins record selection may surface the wrong sibling record when an inquiry has revised quotes (expo reality). Hash URLs (inquiry/<id>) are genuinely power-friendly.

**Sam (accessibility-dependent):** strong substrate (skip link, focus-visible, live region, auto label wiring, rem scale, AA spot-checks pass). Risks: 11px labels/pills need zoom; single live region overwritten by rapid actions; programmatic focus jumps are frequent; keyboard cannot scroll 430px table wells (no tabindex).

**Riley (stress tester):** no visible button-disabling during in-flight api() calls — double-click can fire twice (server idempotency unverified); "Reset synthetic data" one misclick from a confirm() in the header; unknown next-action codes silently route to Inquiries; message auto-hide drops reassurance mid-read.

## Minor Observations

- `.money` class reused for non-money counts (dashboard metrics) — semantic drift
- Inquiry form bakes default `CLIENT-SYNTH-000001` into markup before the picker replaces it
- Seven appended <style> blocks with later overrides (.quote-header flex→block) — CSS sediment worth consolidating
- Honest empty states are a strength ("No fully funded trips are currently waiting for departure.")

## Questions to Consider

1. If the case command center already knows the next action, do 14 co-equal tabs earn their place — or would 3 zones (Now / Records / Knowledge) with the next-action ticket as router serve expo-volume operations better?
2. normalizeDisplayText admits the copy doesn't fit at render time — is the real fix a single labels module rather than a DOM rewriter, before multi-option expo quotes multiply the strings?
3. Single ambient case + latest-wins selection: when September's expo produces three revisions and two quotes per lead, which record does staff actually see — would an explicit per-entity record switcher beat "latest wins"?
