# Office Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Coach Career Office as the approved two-column dashboard (mock: `scratchpad/mock/office.html`) with only real game data, losing nothing today's Office shows.

**Architecture:** The Office moves out of `web/recruiting.js` into its own `web/office.js` (+ `web/office.css`), routed from `web/season.js`. It reads the season summary, `/recruiting`, `/preview` (Win Chance) and one new read-only endpoint, `GET /api/season/{id}/office` (`coach_career/office.py`: program news across weeks, your conference's latest results and your standing). `recruiting.js` only loses the Office code and exports `avatar`, `reportCard` and `eventWord` on `window.CFP.recruiting`.

**Tech Stack:** Vanilla JS (`window.CFP.el`, `window.CFP.ui`), CSS theme tokens in `web/styles.css`, Python stdlib API, Playwright tests as plain scripts.

**Spec:** the player's brief (Office redesign) and the mock in the session scratchpad.

## Global Constraints

- Title Case for labels, kickers, chips, buttons, stat labels; sentences (capital, period) for prose.
- American spelling; never "null", "undefined" or "NaN" on the page.
- Every control at least 44 px tall on a phone; every URL relative.
- Tunable constants module-level with a `*tune*` comment; no new randomness; golden digests byte-identical.
- Below about 900 px one column; at 400 px no sideways scroll.
- Stay out of `web/recruiting.js` and `coach_career/recruiting.py` except the move-out and the export line.

## Review Focus

- A bye week: hero names the next game without a Win Chance, the plan shows Recruit → Advance only.
- No game left this season but the season not done (weeks 15–20 without a bowl): hero says so and still holds the sim controls.
- The season done / offseason: Season Complete hero with On to the Offseason, no plan card, every other card still real.
- An independent: Around card and standing line make sense without a conference place.
- Auto-recruit on: Recruit step reads as done, not as hours unspent.

---

### Task 1: The Office read (`coach_career/office.py`, `GET /api/season/{id}/office`)

**Files:** Create `coach_career/office.py`; modify `app/api.py`; test `tests/test_office_redesign.py` (API part).

**Interfaces — Produces:** `office_view(state) -> {"news": [...], "conference": {"name", "week", "games": [...], "standing": {...} | None}}`.
- news item: `{week, kind, pid?, name?, position?, stars?, rank?, school?, school_name?}` for recruiting events (the recap filter, any week), and `{week, kind: "game", won, points_for, points_against, opponent, opponent_name, venue}` for your results; newest week first, at most `NEWS_ITEMS` (*tune*, 6).
- conference games: the latest week with played games involving a conference team, conference games first, at most `CONF_GAMES` (*tune*, 4): `{event_id, week, home, away, home_name, away_name, home_score, away_score, overtime, mine, conference_game}`.

- [ ] Test: a fresh career has `news == []`, `conference.games == []`, a standing row; after one advance the news has your game and the conference has played results; golden digest unchanged.
- [ ] Implement, run, commit.

### Task 2: `web/office.js` + `web/office.css`, routed from `season.js`

Hero (Next Game / No Game / Season Complete, `.go-play` with Game Day first), Last Game (score, Pass Yds, Rush Yds, TFL, Sacks, quarters, leaders, Full Box Score), This Week's Plan (derived steps), What Changed (kept), Program News, Around the Conference, Program Pulse (record, `.go-standing-line`, last game, AD goal + mood), Recruiting Pulse (commitments of spots, hours, NIL, scouting points, spots filled, class rank), Top Targets (avatar, stars, position, rank, standing chip, Board →). Win Chance from `/preview` `prediction.win_prob`, shown clamped to 1–99%.

- [ ] Browser tests in `tests/test_office_redesign.py` at 1280 and 400, light and dark: cards, no null/NaN, Game Day plays the game, plan step after recruiting and after the game, Win Chance 1–99, no sideways scroll, Title Case kickers.
- [ ] Implement, run, commit.

### Task 3: Existing tests follow the moved selectors

`test_office_game`, `test_ux_sweep`, `test_spacing`, `test_smoothness`, `test_deep_links`, `test_offseason_e2e`, `test_slim_header` — same assertions on the new structure. Full suite green, screenshots, push.
