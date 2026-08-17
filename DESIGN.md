---
name: WMIT Operations Workspace
description: Calm, ledger-disciplined operations console for Worldmaster International Travel
colors:
  harbor-navy: "#14334f"
  chart-paper: "#f5f7fb"
  ledger-ink: "#172334"
  manifest-green: "#177245"
  manifest-green-hover: "#14603c"
  ledger-slate: "#34526f"
  stamp-amber: "#966308"
  ensign-red: "#9b3434"
  passage-blue: "#3679b6"
  registry-blue: "#245c89"
  sea-fog: "#607085"
  mist: "#dbe8f4"
  navy-hover: "#315877"
  label-ink: "#56677a"
  surface: "#fff"
  seal-ink: "#14334f"
  paper: "#fff"
  paper-tint: "#fbfcfe"
  paper-well: "#f7fafc"
  passage-tint: "#f5f9fd"
  rule: "#d9e2ec"
  rule-soft: "#e0e7ee"
  rule-hair: "#e6ebf0"
  rule-input: "#c8d2df"
  rule-dashed: "#cbd6e2"
  rule-tint: "#f1f5f9"
  status-good-bg: "#dcf3e3"
  status-good-text: "#176237"
  status-warn-bg: "#fff1c6"
  status-warn-text: "#70530b"
  status-bad-bg: "#f9dddd"
  status-bad-text: "#8d2c2c"
  status-info-bg: "#dcecfb"
  status-neutral-bg: "#edf2f7"
  status-neutral-text: "#4e6175"
  msg-ok-bg: "#e8f7ed"
  msg-ok-rule: "#a9d8b4"
  msg-err-bg: "#fff0f0"
  msg-err-text: "#922c2c"
  msg-err-rule: "#e4a7a7"
  msg-warn-bg: "#fff8df"
  msg-warn-text: "#6c5010"
  msg-warn-rule: "#e3c777"
  amber-rule: "#e5c875"
  amber-wash: "#fffaf0"
  amber-ink: "#8a5b0b"
  good-rule: "#add9b7"
  good-wash: "#eef9f1"
  bad-rule: "#e3aaaa"
  bad-wash: "#fff3f3"
  required-rule: "#c62828"
  required-text: "#a61b1b"
  required-wash: "#fff5f5"
  blocked-wash: "#fffafa"
  step-done-bg: "#ebf8ef"
  step-done-rule: "#abd9b5"
  why-ink: "#43566c"
  timeline-rail: "#dce4ec"
  booking-rule: "#cfdbe7"
  summary-rule: "#e1e8ef"
  ready-wash: "#f5fbf6"
  command-bar-bg: "#eef5fb"
  command-bar-rule: "#c8dceb"
  client-preview-rule: "#cfd9e4"
  monitoring-wash: "#f7fcf8"
  required-ring: "rgba(198,40,40,0.15)"
typography:
  headline:
    fontFamily: "IBM Plex Sans, Inter, system-ui, sans-serif"
    fontSize: "23px"
    fontWeight: 700
  title:
    fontFamily: "IBM Plex Sans, Inter, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 700
  subheading:
    fontFamily: "IBM Plex Sans, Inter, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 700
  body:
    fontFamily: "IBM Plex Sans, Inter, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  table:
    fontFamily: "IBM Plex Sans, Inter, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
  label:
    fontFamily: "IBM Plex Sans, Inter, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 800
  emphasis:
    fontFamily: "IBM Plex Sans, Inter, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
  money:
    fontFamily: "IBM Plex Sans, Inter, system-ui, sans-serif"
    fontSize: "1.3125rem"
    fontWeight: 800
  quote-brand:
    fontFamily: "IBM Plex Sans, Inter, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 700
  public-hero:
    fontFamily: "IBM Plex Sans, Inter, system-ui, sans-serif"
    fontSize: "clamp(26px, 4.5vw, 40px)"
    fontWeight: 700
  public-heading:
    fontFamily: "IBM Plex Sans, Inter, system-ui, sans-serif"
    fontSize: "34px"
    fontWeight: 700
  public-title:
    fontFamily: "IBM Plex Sans, Inter, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 700
  public-cta:
    fontFamily: "IBM Plex Sans, Inter, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 700
  public-input:
    fontFamily: "IBM Plex Sans, Inter, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 400
  public-body:
    fontFamily: "IBM Plex Sans, Inter, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
  public-label:
    fontFamily: "IBM Plex Sans, Inter, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 700
  public-note:
    fontFamily: "IBM Plex Sans, Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
rounded:
  sm: "6px"
  form: "7px"
  md: "8px"
  lg: "10px"
  panel: "11px"
  pill: "16px"
spacing:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
components:
  button-primary:
    backgroundColor: "{colors.manifest-green}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "9px 12px"
  button-secondary:
    backgroundColor: "{colors.ledger-slate}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "9px 12px"
  button-warning:
    backgroundColor: "{colors.stamp-amber}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "9px 12px"
  button-danger:
    backgroundColor: "{colors.ensign-red}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "9px 12px"
  button-compact:
    backgroundColor: "{colors.ledger-slate}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "6px 9px"
  panel:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ledger-ink}"
    rounded: "{rounded.panel}"
    padding: "18px"
  card:
    backgroundColor: "{colors.paper-tint}"
    rounded: "{rounded.md}"
    padding: "12px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ledger-ink}"
    rounded: "{rounded.sm}"
    padding: "9px"
  status-badge:
    backgroundColor: "{colors.status-neutral-bg}"
    textColor: "{colors.status-neutral-text}"
    rounded: "{rounded.pill}"
    padding: "3px 8px"
  nav-tab:
    textColor: "{colors.status-info-text}"
    rounded: "{rounded.sm}"
    padding: "8px 10px"
---

# Design System: WMIT Operations Workspace

## Overview

**Creative North Star: "The Operations Ledger"**

The Operations Workspace is a working ledger, not a dashboard showcase. One ink-navy authority band (the header) sits above an expanse of chart paper; beneath it, every panel is a page of the ledger — white surfaces, fine rule-line borders, small stamped badges recording the state of every entry. The system exists to make a small Philippine travel agency's money, commitments, and follow-ups legible and auditable; its visual character is the same discipline an old shipping ledger demanded: nothing decorative, everything accounted for.

Density is high and intentional. This is an all-day staff tool: 12px tables, 13px prose, 11px labels, tight 12px grid gaps. Calm and procedural is the component philosophy — controls feel deliberate and predictable; a green button is the single sanctioned action, slate is everything reversible, amber and red are escalation, and state is always a stamped pill with words in it, never a bare color. The interface speaks in complete, specific sentences ("Not executed", "Verified", "Booking not ready") because ambiguity in a ledger is a defect.

The client-facing exception proves the rule: when a quotation is previewed for printing, it gets the only soft shadow in the system and the brand's letterhead, because that page leaves the building. Everything else stays flat, ruled, and quiet.

**Key Characteristics:**
- Ink-navy authority band over chart-paper workspace; white panels with 1px rule-line borders
- High density: 12–13px working text, 11px uppercase tracked eyebrows and labels
- State is a stamped pill badge carrying words, never color alone
- Flat at rest; the only shadows are the printable quotation preview and one hover lift
- One green action per view; slate/amber/red encode reversibility and escalation

## Colors

A cold maritime-ledger palette: one navy authority hue, one green action hue, three escalation hues, and a family of paper, ink, and fog neutrals. Everything is desaturated enough to read as ink on paper rather than screen-glow.

### Primary
- **Harbor Navy** (#14334f): the header band and the single authority mark on a surface (quote-header rule, grand-total rule). Appears once per screen.
- **Manifest Green** (#177245): primary actions only — the one sanctioned next step in view.

### Secondary
- **Passage Blue** (#3679b6): progress and flow accents — current-step borders, timeline dots and rails, event marks.
- **Registry Blue** (#245c89): informational state text, form summary links, disclosure summaries, quotation labels.

### Tertiary
- **Stamp Amber** (#966308): warning buttons and caution copy ("Fill test fields", blockers, deadlines context).
- **Ensign Red** (#9b3434): destructive or irreversible actions (reset, danger zones).

### Neutral
- **Chart Paper** (#f5f7fb): the page background behind all panels.
- **Ledger Ink** (#172334): body and heading text.
- **Sea Fog** (#607085): secondary/muted prose (WCAG AA on Chart Paper at 4.7:1).
- **Paper** (#ffffff) / **Paper Tint** (#fbfcfe): panels and nested cards.
- **Rule Line** (#d9e2ec): 1px borders and dividers; **Rule Tint** (#f1f5f9): table-header fills and quiet wells.
- Status badge pairs: good (#176237 on #dcf3e3), warn (#70530b on #fff1c6), bad (#8d2c2c on #f9dddd), info (#245c89 on #dcecfb), neutral (#4e6175 on #edf2f7).

### Named Rules
**The Ink Rule.** Harbor Navy appears exactly once per screen as an authority band or rule. It is never a button, a badge, or a fill.
**The One Action Rule.** Manifest Green marks the single primary action in view. If two controls compete for green, one of them is a secondary action and takes slate.
**The Stamped State Rule.** Every state renders as a pill badge with words. Color alone never carries meaning.

## Typography

**Display Font:** IBM Plex Sans, self-hosted (with Inter, system-ui fallback)
**Body Font:** IBM Plex Sans, self-hosted (with Inter, system-ui fallback)

**Character:** One engineered-institutional grotesque does everything — the face a calibrated operations ledger earns, with true tabular figures for money columns and small-size clarity at the 11–13px working scale. Self-hosted woff2 (400/500/600/700, OFL) from `app/public/assets/fonts/`, so every device renders the same brand; Inter remains only as an installed-first fallback.

### Hierarchy
- **Headline** (700, 23px): the workspace title only.
- **Title** (700, 19px): one per panel — the workspace name.
- **Subheading** (700, 15px): card titles, case headers.
- **Body** (400, 13px): prose, meta lines, muted explanation (Sea Fog for secondary).
- **Table** (400, 12px): all record tables; sticky Rule-Tint headers, 8px cell padding.
- **Label** (800, 11px / .6875rem, uppercase tracked .08em eyebrows; sentence-case form labels): field labels and section eyebrows.
- **Emphasis** (700, 1.125rem): next-action ticket titles and quotation labels — the console's largest in-flow text.
- **Money** (800, 1.3125rem): standalone financial figures.
- **Quote-brand** (700, 1.375rem): the QUOTATION wordmark on the printable preview.

All sizes are rem-based: the working scale renders at the same pixels by default but scales with the user's browser font-size setting (WCAG 1.4.4).

**The Public Register.** Client-facing surfaces (expo kiosk sign-up, public quotation page) run a larger register on the same family: 13–17px supporting text and body, 20px kiosk inputs (prevents mobile zoom-on-focus), 22px CTA, up to 34px success headings, clamp()-scaled 26–40px hero. The Ledger Scale Rule governs the staff console only; public pages earn presence through size, never through extra ornament.

### Named Rules
**The Ledger Scale Rule.** Working text stays at 12–13px; only the panel title hierarchy may exceed it. Display sizes belong to the printable quotation, not the console.

## Layout

A sticky Harbor Navy header (18px vertical padding, max 1420px aligned content) carries the eyebrow, workspace title, auth state, and a horizontally scrollable 14-tab nav (13px links, 9×11px hit areas) grouped by lifecycle with 1px separators: Dashboard · case flow (Inquiries, Quotations, Bookings, Finance, Monitoring, Departures) · records (Clients, Suppliers, Sub-agents, Tariff Library) · system (Follow-ups, Settings, Events). Button labels are final at render time — no post-render copy rewriting. Below it, `main` centers a 1420px column with 20px padding; each tab renders one full-width white panel (18px padding) — never a dashboard of tiles. Inside panels: grid2/grid3 with 12px gaps for forms, `.table-wrap` scroll containers capped at 430px for record tables, and `<details>` disclosures for secondary/editing forms. Breakpoints at 1100/1000px drop grids to two columns; 800/700px stack everything to one column and unwrap the header row. A print stylesheet strips all chrome so a quotation preview prints alone.

## Elevation & Depth

Flat by conviction. Depth is tonal: Chart Paper page → white panel → Paper-Tint card → Rule-Tint well, each separated by 1px rule lines. Exactly two shadows exist — the client-facing quotation preview card (`0 2px 8px rgba(23,35,52,.07)`, because that page is destined for paper) and the shortcut-card hover lift (`0 2px 9px rgba(23,35,52,.09)`).

### Shadow Vocabulary
- **Quotation preview** (`box-shadow: 0 2px 8px #17233412`): the printable artifact only.
- **Hover lift** (`box-shadow: 0 2px 9px #17233418`): interactive shortcut cards at hover.

### Named Rules
**The Flat Ledger Rule.** No shadows at rest. A shadow means "this page leaves the building" or "you are hovering."

## Shapes

Rounded but restrained: 6px on controls and buttons, 8px on cards and messages, 10–11px on panels and the case header, and a 16px pill reserved exclusively for status badges. Borders are the primary form language — every surface declares itself with a 1px Rule Line; state changes adjust border (2px Passage Blue current step, red required-attention ring) rather than adding depth. Signature silhouettes: the pill badge, the timeline rail (2px line, 9px dot), and the next-action ticket (amber-tinted card with tracked "NEXT ACTION" label).

## Components

### Buttons
- **Shape:** softly rounded (6px), bold 13px labels, 9×12px padding (compact: 6×9px, 12px text)
- **Primary:** Manifest Green with white text — one per view
- **Secondary:** Ledger Slate with white text — reversible and navigational actions
- **Warning:** Stamp Amber with white text — testing tools and cautionary actions
- **Danger:** Ensign Red with white text — resets and destructive actions
- **Hover/Focus:** no rest shadow or gradient; focus is a 2px Passage Blue outline (2px offset) via `:focus-visible`, Mist-colored on the navy header; text selection is Status-Info-Blue on Ledger Ink

### Chips
- **Status badge:** pill (16px radius, 3×8px padding, 800 weight 11px text) in the five state pairs; always carries a readable word (Verified, Pending, Booking not ready)

### Cards / Containers
- **Panel:** white, 1px Rule Line, 10–11px radius, 18px padding — one per workspace tab
- **Card:** Paper Tint, 1px lighter border, 8px radius, 12px padding; tinted variants for warn (amber wash), good (green wash), blocked (red wash)
- **Case header:** white, 11px radius, flexes meta left / next-action ticket right

### Inputs / Fields
- **Style:** white, 1px #c8d2df border, 6px radius, 9px padding, full width; labels 800 11px above (Sea-Fog-blue-gray #56677a)
- **Focus/Error:** focus shows the global 2px Passage Blue ring; required-attention wraps the field in a 2px red border, red label, and a "Required" annotation — never color alone
- **Certainty pairs:** optional requirements pair a value control with a status select (labeled "… status")

### Navigation
- **Tabs:** 13px links on the navy band, Sea-Fog-white text (#dbe8f4), 6px-radius hover/active fill (#315877 → white text), horizontally scrollable when narrow; hash-routed, keyboard-operable

### Quotation Preview (signature component)
The one client-facing surface: brand letterhead image, quote header with Passage Blue label, 4-column meta grid, day-by-day itinerary with Passage Blue left rules, totals block with Harbor Navy grand-total rule, terms, and footer — printed via a dedicated stylesheet that hides the entire console.

## Do's and Don'ts

### Do:
- **Do** render state as a stamped pill badge with words in it, in one of the five state pairs.
- **Do** keep the working scale at 12–13px with 1px Rule Line borders; encode hierarchy through the panel-title steps, not bigger body text.
- **Do** put exactly one Manifest Green action in view; make everything else slate, amber, or red by reversibility.
- **Do** use `<details>` disclosures and `.table-wrap` scroll wells to keep density without hiding the ledger.
- **Do** keep error and status messages as complete sentences in the live region ("Not executed", "Verified"), paired with focus moves to the offending field.

### Don't:
- **Don't** add shadows to console surfaces; shadows belong to the printable quotation and one hover lift only.
- **Don't** introduce hues outside the ledger palette (no purples, oranges, or teals).
- **Don't** fill large areas with Harbor Navy or any state color; large fields of color are Chart Paper, white, or Paper Tint.
- **Don't** use color alone to carry meaning (WCAG AA is a product commitment).
- **Don't** use 3–4px side-tab accent borders on cards or callouts (removed from `.event` and `.preview-day`; they are the best-known generic-AI tell — full 1px rule borders carry the same structure).
