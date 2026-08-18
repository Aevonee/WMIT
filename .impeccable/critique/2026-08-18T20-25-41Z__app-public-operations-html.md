---
target: app/public/operations.html
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
timestamp: 2026-08-18T20-25-41Z
slug: app-public-operations-html
---
# Design Critique — WMIT Operations Workspace (2026-08-18)

Method: dual-agent A (ses_fe9943fd) · B degraded→parent (agent stalled; CLI + overlay rerun in parent, disclosed)

## Scores: 1:2 2:2 3:3 4:3 5:3 6:2 7:3 8:3 9:1 10:3 = 25/40 (Acceptable)

## Design specificity: authored (money-funds ladder, ledger pills, rooming occupancy; under-authored only where enums leak)

## Detector: CLI 2 findings (both false positives: timeline rail, quote day rule); overlay: kicker-above-heading + line-length ~164 (real)

## Priority issues
- P0 silent action failure (approve -> 400 -> no visible feedback; empty aria-live)
- P1 machine identifiers in prose (ISO timestamps, PERSON-ids, enum chains)
- P1 mobile header 59.5% of 390px viewport (nav wraps 5 rows)
- P2 one-green rule broken on Finance (4 greens incl 3 money actions)
- P2 200-option native supplier selects

## Personas: Alex (5 saves, 200-select, money scanning); Sam (live region silent on failure, native confirms, mojibake); Maria (enums hostile, ISO deadlines, PERSON-id)

## Minor: mojibake em-dash, kicker eyebrow, 164-char lines, tabular-nums unset, slate-on-navy 1.6:1, nav white vs mist, mixed dates, favicon 404
