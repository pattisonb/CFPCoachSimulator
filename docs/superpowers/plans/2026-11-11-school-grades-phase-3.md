# School Grades, Phase 3: The Grades Move — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four of the six grades move with program success and failure each offseason, each with a floor. Game Day and Exposure rise with winning and fall with losing, Stability drops at a coaching change and rebuilds with tenure, and Academics drifts a little with roster churn. Location and Facilities stay fixed. Recruits and the Programs tab read the live grades.

**Architecture:**
- Each program in the career's league carries `grades_live`, the live part of each moving grade on top of its researched base: `{"game_day", "exposure", "stability", "academics"}`.
- `programs.update` moves those parts once a year (it already moves Market's live part and the coach rating).
- `programs.grades_now(state, slug)` is the base plus the live part, held to its floor.
- Recruiting's grade pulls and `programs.rows` read `grades_now`. The fixed `grades(slug)` stays the base.

**Tech Stack:** Python 3, vanilla JS, plain-script tests, Playwright (`playwright==1.63.0`).

**Spec:** `docs/superpowers/specs/2026-11-10-school-grades-expansion-design.md` ("Decided" 6: the floors table). Builds on Phases 1 and 2.

## Global Constraints

- The branch is `school-grades-3`, from `main` after Promise Him the Job. The full suite is `python3 tests/run_all.py --retry 1`.
- `python3 tests/test_sim_golden.py` stays identical (its two weeks never reach an offseason). The rating, tiers, AD goals and Market are unchanged. No grade feeds `mix`.
- No randomness: every move is a deterministic step from results.
- The floors (spec "Decided" 6):
  - Game Day ≥ 70% of its researched value.
  - Exposure ≥ 75%.
  - Stability ≥ 10.
  - Academics within ±10 of its researched value.
  - All grades are capped at 100.
- Tunables are module-level `*tune*` in `coach_career/programs.py`:
  - `GAME_DAY_LIVE = 0.4`: the live target is this much of (winning − winning_base).
  - `GAME_DAY_STEP = 4`: at most this much a year.
  - `EXPOSURE_LIVE = 0.35`, `EXPOSURE_STEP = 4`.
  - `EXPOSURE_RANKED = {10: 4, 25: 2}`: a final rank in the top 10 or top 25 adds this to the target that year.
  - `STABILITY_CHANGE = 15`: a new head coach this year costs this.
  - `STABILITY_REBUILD = 5`: each year he stays rebuilds this, up to the researched value.
  - `ACADEMICS_STEP = 1`: churn above or below `CHURN_MEAN` moves it a point a year.
  - `CHURN_MEAN = 6`: the portal entrants a program loses in a typical offseason.
- Copy: the Programs tab shows a small ▲ or ▼ beside a grade that moved this year, titled as a sentence ("Up 4 since last season.").

## Review Focus

1. **An old save:** no `grades_live`, so the grades read the base, and the first update creates it. There's no migration and no crash.
2. **A program with no grades** (NDSU): `grades_now` is None, and `update` skips its live part.
3. **A floor reached:** a decade of losing leaves Game Day at exactly 70% of its base, not below. A decade of winning caps at 100.
4. **The caches** (Phase 2's final review): `programs._GRADES`/`_TAGS` hold the base only and stay. `recruiting._PULLS` and `_STATIC` hold the pulls for a class key. A grade that moved in the offseason must show in the next class's pulls: the key changes with the class, and `programs.update` clears both caches too. Pinned in Task 1 (`test_pulls_read_live`).
5. **Your own coaching change** (you took a new job, or you were fired): your new program's Stability takes the change, and so does the program you left.

---

### Task 1: The live grades (server)

**Files:**
- Modify: `coach_career/programs.py`:
  - Add `grades_now`, `_move_grades` and the constants.
  - `update` calls `_move_grades` per team.
  - `rows` reads `grades_now` and adds `grades_moved` (this year's change per grade).
- Modify: `coach_career/recruiting.py` (`_grade_pulls(state, slug, p)` reads `programs.grades_now(state, slug)`; `academic` gains an optional `state`).
- Test: `tests/test_grades_move.py` (new)

**Interfaces:**
- Produces: `grades_now(state, slug) -> Optional[dict]`: the base (`grades(slug)`) plus `program["grades_live"]`, held to the floors. Without a league, it is the base.
- Produces: `_move_grades(p, slug, year, rank, coach_since, churn) -> None`. It moves `p["grades_live"]` per the constants and stores `p["grades_moved"]` (the change this year, rounded to 0.1).
- `churn` is the count of `kind == "portal"` departures from that team in `state["offseason"]["departures"]` (0 when absent).

- [ ] **Step 1: Write the failing tests:**
  - `test_old_save_reads_base`: a career league program with no `grades_live` gives `grades_now == grades`.
  - `test_winning_raises_game_day_and_exposure`: `_move_grades` with winning 30 points over base for 3 years. Game Day rises by at most `GAME_DAY_STEP` a year, and Exposure rises.
  - `test_floors`: 20 losing years leave Game Day at 70% of base (±0.1) and Exposure at 75%. Winning years cap at 100.
  - `test_stability`: a coaching change costs 15. Three years of tenure rebuild 15, never above the base, never under 10.
  - `test_academics_band`: heavy churn for 20 years ends at base − 10, never lower.
  - `test_rating_untouched`: after `update`, every program's `rating` equals what `mix(p)` gives without the grades (unchanged from main for the same results).
  - `test_pulls_read_live`: with Game Day's live part at −20 on a program, `recruiting.pull(...)["game_day"]` equals `grades_now / 100` once the class key changes.
- [ ] **Step 2: Run** `python3 tests/test_grades_move.py`. Expected: fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `python3 tests/test_grades_move.py`, `python3 tests/test_school_grades.py`, `python3 tests/test_recruit_grades.py`, `python3 tools/check_programs.py`, `python3 tests/test_sim_golden.py`. All pass, and check_programs is unchanged.
- [ ] **Step 5: Commit** "School Grades Phase 3: Game Day, Exposure, Stability and Academics move each offseason, each with its floor".

### Task 2: The page and the docs

**Files:**
- Modify: `web/recruiting.js` (the Programs tab's bars and Every Program cells): a ▲ or ▼ (`.go-moved`) beside a grade whose `grades_moved` is 0.5 or more in size, titled "Up 4 since last season." or "Down 2 since last season.".
- Modify: `docs/HOW_IT_WORKS.md` (School Grades: Phase 3).
- Test: `tests/test_pro_page.py` (a second-season career with a moved grade shows the arrow and its title).

- [ ] **Step 1: Write the failing test.**
- [ ] **Step 2: Run** it. Expected: fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `python3 tests/test_pro_page.py`, `python3 tests/test_spacing.py`, `python3 tests/test_ux_sweep.py`. All pass.
- [ ] **Step 5: Commit** "School Grades Phase 3: the Programs tab shows what moved; docs".
