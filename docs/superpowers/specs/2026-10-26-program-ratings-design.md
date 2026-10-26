# Program ratings: a living rating for every school

**Status:** approved in conversation (October 26); this is the written spec.

## Why

Today one fixed number stands for a program: its recruiting baseline, the 2005-2026 mean of
its class strength (z-score). It decides the AD's goal, the prestige and NIL pull on recruits
and transfers, which openings a sitting coach will take, and the NIL budget. It never moves, so
a program that wins for ten seasons is the same job and the same pitch it was in 2026, and a
blue blood that collapses keeps its pull.

## What

Every program carries a **living rating** on a few metrics, kept in the career's league and
updated every offseason; everything that asks "how good a program is this?" reads it.

### Metrics (`lgd["teams"][slug]["program"]`, each 0-100)

| metric | what it is | moves |
|---|---|---|
| `prestige` | the program's name: history plus recent results | slowly: at most 3 points a year toward a target |
| `winning` | the last three seasons, the latest weighted 3-2-1, in wins against 12 and AP finishes | every offseason |
| `nil` | the NIL budget tier | by the AD: up to 4 points a year after a year that met the goal, down 2 after a losing year; floor from market size |
| `market` | fans in the stands and on TV: a fixed base from real home crowds (CFBD, 2023-2025) and Nielsen per-team TV averages (estimated from the crowd where Nielsen publishes none), `data/program_market.json`, plus a live part | the live part moves each offseason by a third of the three-year winning change (last season weighted 2:1 over the two before), capped by capacity on the crowd side, open on the TV side; about +15 over a decade of winning, -10 over a decade of losing; a new head coach adds a point or two in his first year. Fitted on 2012-2025 crowds (`docs/attendance_study.html`): +8.5% crowd for three more wins a year held three seasons, Power 4 median fill 95%, Group of 5 60% |
| `conference` | the conference's strength from the league's results (mean SP-like rating of its teams) | every offseason |
| `coach` | the head coach's rating and tenure (ratings overall, +3 a year of tenure up to 5) | every offseason |
| `rating` | the mix: 0.35 prestige + 0.20 winning + 0.15 nil + 0.10 market + 0.10 conference + 0.10 coach | derived |
| `tier` | 1 (blue blood, rating ≥ 76) · 2 (power, ≥ 65) · 3 (solid Power 4 / top Group of 5, ≥ 50) · 4 (Group of 5, ≥ 35) · 5 (bottom) | derived |

### Where the starting values come from (`data/program_history.json`, built by `tools/build_program_history.py`)

From `data/recruiting/coaches.json` (every FBS head coach's seasons since 1995: wins, games,
final AP rank, SP+) and the recruiting model:

- **History score** (0-100, for `prestige`'s anchor): over 1995-2025, win share, AP top-25
  finishes, AP top-10 finishes and top-5 finishes, each season weighted by recency (half-life
  12 years), plus the recruiting baseline (class strength 2005-2026). National titles count
  through top-1 finishes. Scaled so the best program is 100 and the FBS median about 40.
- **Winning** from 2023-2025 results. **Market** from a fixed table by school (attendance /
  TV footprint tiers, hand-set: 100 for Michigan, Ohio State, Texas, Alabama, Penn State,
  Georgia, LSU, Notre Dame, USC, Oklahoma, Tennessee, Florida; 85 for the other blue bloods and big
  markets; 70 solid Power 4; 55 small Power 4 / top Group of 5; 40 Group of 5; 25 the smallest).
  **NIL** from the market tier and the recruiting baseline at the start (the same number the
  current `nil_budget` gives, in tiers). **Conference** from 2025 results.
- `prestige` starts at the history score; its target each offseason is history + 0.3 × (a
  ten-season running mean of the season scores − the program's real 2023-25 winning), so the
  real start is a fixed point: a decade of winning beyond the real level lifts a program and a
  decade of losing sinks one, by about a tier at most. NIL and the market's live part are
  anchored the same way (`winning_base`, `nil_base`, `market_base`).

### Who reads it

- **The AD's goal** comes from `tier` (1: playoff · 2: nine wins / conference title · 3: seven
  wins / a bowl · 4: a bowl · 5: six wins) instead of the baseline, so goals drift as programs
  rise and fall. His patience stays per school.
- **Job attractiveness** for the carousel: `rating` (+ 5 for an impatient AD's absence, i.e.
  patience 4-5). A sitting head coach takes an opening whose attractiveness beats his own by 8
  or more; a coordinator takes a head coaching job at any program within 15 of his own; the
  market's candidates are drawn against the program's tier. Replaces `baseline` in
  `_pick_head_coach` and the queue order.
- **Recruiting and the portal**: the prestige pull from `prestige`, the NIL pull and
  `nil_budget` from `nil`, the winning pitch keeps this season's results; `_baseline` stays
  for the recruiting model's footprint and class-shape lookups only.
- **Development** (`PROGRAM_DEV`): the top-25-by-rating programs, not by baseline.
- **The Office** shows your program's card (the six metrics, the tier, the AD's goal) and a
  **Programs** page lists every school by rating with its tier and metrics, sortable.

### Realism checks

- At the start the top 25 by rating matches a reasonable 2026 top 25 of programs (Ohio State,
  Georgia, Alabama, Texas, Michigan, Oregon, Notre Dame, LSU, Penn State, Clemson, USC, Oklahoma,
  Tennessee, Florida State, Texas A&M, Florida, Miami, Auburn, Ole Miss, Utah, Wisconsin, Iowa,
  Washington, Oklahoma State, Kansas State or close).
- Over 20 seasons (`tools/long_run.py`): the top 25 by rating keeps at least 18 of the starting
  25; prestige moves at most 3 a year; no program crosses more than one tier in five years.
- The carousel's churn bands (`tools/check_carousel.py`) still hold, and sitting coaches move
  to programs rated higher than their own in 95% of moves.
- Recruiting bands (`tools/check_recruiting.py`) hold.

### Out of scope

Facilities upgrades you buy, TV deals, conference realignment, program ratings for FCS
opponents (they stay fictional-strength teams).
