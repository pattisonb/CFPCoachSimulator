# School Grades, Phase 2: Recruits Want Them — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recruits can want the new grades. There are five new topics (Facilities, Location, Stability, Game Day, Exposure), and Academics reads its grade. Each topic is something a recruit draws as a priority, a decider can care about, you can pitch and present in your opening, and his scenes talk about. Location reads its tags against his taste.

**Architecture:**
- `recruiting.pull` gains the five topics from `programs.grades` (Phase 1), plus Academics from its grade.
- The priority draw uses the spec's thirteen-topic tables, tilted by his decider, personality, stars and position.
- `scenes` gets lines for each new topic.
- The page picks the topics up from `PITCH_NAMES`. The opening's pill dropdown already holds any count.
- AI schools' recruiting moves, so the golden recruiting hash is re-recorded once, only if `tools/check_recruiting.py` keeps every metric in range. The player approved this on November 11.

**Tech Stack:** Python 3, vanilla JS, plain-script tests, Playwright (`playwright==1.63.0`).

**Spec:** `docs/superpowers/specs/2026-11-10-school-grades-expansion-design.md` (Recruits, Who Cares About What, Decided). Builds on Phase 1 (`docs/superpowers/plans/2026-11-11-school-grades-phase-1.md`).

## Global Constraints

- Branch `school-grades` (Phase 1 merged first). Full suite: `python3 tests/run_all.py --retry 1`.
- **The rating, tiers, AD goals, market and the season sim do not change.** The games in `tests/test_sim_golden.py` stay identical. Only the recruiting week's hash may move, and only per Task 5.
- **Saves keep the priorities their prospects already drew.** The new tables apply to new classes and portal years.
- New randomness gets its own seeded stream (for example `random.Random(f"place-{pid}")`), appended after the existing draws. An existing draw never moves:
  - The decider's topic keeps the `_TOPICS_BEFORE_PRO` pattern.
  - The class generator's streams are untouched.
- Topic order (`recruiting.PITCHES`): `proximity, playing_time, prestige, winning, nil, coach, pro, academics, facilities, location, stability, game_day, exposure`.
- Page names (`PITCH_NAMES`): "Facilities", "Location", "Stability", "Game Day", "Exposure". Labels are Title Case; lines are sentences; American spelling.
- Tunables are module-level and marked `*tune*`.
- Commits end with the session's two attribution trailer lines.

## Review Focus

1. **A program with no grades** (NDSU, Sacramento State, a fictional league team): every new pull reads a neutral 0.5, and nothing crashes. Pinned in Task 1.
2. **An old save mid-class:** prospects keep their eight-topic priorities and `weights` still sums to 1.0. A pitch on a new topic just isn't a priority for them. Pinned in Task 2.
3. **The portal:** entrants draw from the new portal tables. Their taste and pulls work with `p["stars"]` None. Pinned in Task 2.
4. **A Grades Scare** reads the Academics grade (Strong or better is academic). A school with no profile falls back to the old `ACADEMIC` list. Pinned in Task 1.
5. **Every scene line on a new topic is true** to the game's facts. A claim line ("Your stadium is always full") shows only at `CLAIM_FROM` strength, else the honest one. Pinned in Task 3.

---

### Task 1: The topics and the pulls

**Files:**
- Modify: `coach_career/recruiting.py`:
  - `PITCHES`
  - `pull`
  - add `place_taste`, `academic`, `LOCATION_MATCH`, `LOCATION_CLASH`, `NEUTRAL_PULL`
  - the Grades Scare board filter, which uses `academic(slug)` in place of `slug in ACADEMIC`
- Modify: `coach_career/persona.py` (`twist_pitch`, the Grades Scare read: `recruiting.academic(slug)`)
- Test: `tests/test_recruit_grades.py` (new)

**Interfaces:**
- Consumes: `programs.grades(slug) -> Optional[dict]` and `programs.tags(slug) -> Optional[dict]` (Phase 1).
- Produces: `PITCHES` (13, in the order above).
- Produces: `pull(...)` returns all 13 keys (`winning` only when asked, as today):
  - Each new grade topic is `grade / 100`.
  - `academics` is the Academics grade / 100.
  - With no grades, each is `NEUTRAL_PULL` (0.5). For `academics` with no grades, the old 0.9 / 0.5 by `ACADEMIC`.
- Produces: `place_taste(p: dict) -> dict`, shaped `{"setting": str, "climate": str}`, drawn from `random.Random(f"place-{p['id']}")`. Nothing is stored, so an old save gets one too.
  - Setting weights: Big City 0.30, Mid-Size City 0.20, College Town 0.35, Small Town 0.15.
  - Climate: his home state's climate (Warm for AL AZ CA FL GA HI LA MS SC TX; Cold for IA ID IL IN MA ME MI MN MT ND NE NH NY OH PA SD VT WI WY; else Mild) 70% of the time, otherwise any climate evenly.
- Produces: the Location pull is `location / 100`, plus `LOCATION_MATCH` (0.15) for each tag (setting, climate) that matches his taste, minus `LOCATION_CLASH` (0.05) for each that doesn't, clamped to 0-1.
- Produces: `academic(slug) -> bool`. True when the Academics grade is ≥ 70 (Strong); with no grades, `slug in ACADEMIC`.

- [ ] **Step 1: Write the failing tests** (`tests/test_recruit_grades.py`, on `season.new_season("iowa", "full", seed=5, career=True)`):
  - `test_thirteen_topics`: `len(recruiting.PITCHES) == 13`, and `set(pull(st, "iowa", pid))` equals the 13 topics.
  - `test_pull_reads_grades`: for a prospect, `pull(st, "stanford", pid)["academics"] == programs.grades("stanford")["academics"] / 100`, and the same check for `facilities`, `stability`, `game_day` and `exposure`.
  - `test_location_taste`:
    - With a taste forced to Stanford's tags (monkeypatch `recruiting.place_taste`), the Location pull is `min(1, grade/100 + 0.30)`.
    - With both tags clashing, it is `grade/100 - 0.10`.
  - `test_taste_stable`: `place_taste(p)` is the same twice. A Florida kid's climate is Warm in at least 60 of 100 Florida prospects (or of synthetic `p` dicts with `hometown.state="FL"` and ids `f"t{i}"`).
  - `test_no_grades_neutral`: a pull on `"ndsu"` (no profile row) reads 0.5 for the five new topics.
  - `test_academic_reads_grade`: `academic("stanford")` is True and `academic("akron")` is False. With grades for `"ndsu"` absent, `academic` falls back to the list.
- [ ] **Step 2: Run** `python3 tests/test_recruit_grades.py`. Expected: fails (12 vs 13 or a missing name).
- [ ] **Step 3: Implement.** `strengths` needs no change: it copies `pull`'s keys.
- [ ] **Step 4: Run** `python3 tests/test_recruit_grades.py` and `python3 tests/test_persona_twists.py` (if present), plus `grep -l "len(recruiting.PITCHES)\|PITCHES)" tests/*.py`, and fix any test that hard-codes 8 topics to read `len(recruiting.PITCHES)`.
- [ ] **Step 5: Commit** "School Grades Phase 2: five new topics; recruits' pulls read the grades and Location's tags".

### Task 2: Who cares about what

**Files:**
- Modify: `coach_career/recruiting.py`:
  - `PRIORITY_ODDS`, `PORTAL_PRIORITY_ODDS` and `PORTAL_TOP_PRIORITY_ODDS`, set to the spec's table (High School, Transfer, Top Transfer columns, as shares).
  - `_priorities(pid, table, tilt=None)`, with the class and portal calls passing his tilt.
  - Add `TILT = 1.5` (`*tune*`) and `tilt_for(p, persona_draw) -> dict[str, float]`.
- Modify: `coach_career/persona.py` (`DECIDER_TOPICS`: mom adds stability, dad adds exposure, grandma adds academics, hs_coach adds stability, trainer adds facilities and exposure). Each new topic replaces the old topic pick with a probability of 1/len(topics), in its own stream `random.Random(f"persona-grades-{seed}-{pid}")`, the way `"pro"` was added.
- Test: `tests/test_recruit_grades.py`

**Interfaces:**
- Produces: `tilt_for(p, d)` returns the multipliers from the spec's Tilts section. Each is `TILT`; tilts on the same topic multiply.
  - **Decider** (`d["decider"]`):
    - mom: proximity, academics, stability
    - dad: nil, playing_time, pro, exposure
    - grandma: proximity, coach, academics
    - hs_coach: stability
    - trainer: facilities, exposure
    - self: facilities, game_day, location
  - **Personality** (`d["personality"]`):
    - attention: exposure, game_day
    - cocky: playing_time, exposure
    - shy: proximity, stability
    - guarded: stability, coach
    - business: nil, pro
  - **Stars:**
    - 5: nil, exposure, pro
    - 2 or 3: playing_time, proximity
  - **Position** (his roster group):
    - QB: coach, exposure
    - OL: stability, coach
    - RB, WR, TE: exposure, game_day
- Produces: `_priorities` multiplies the table by the tilt before the draw. The draw's stream (`f"priorities-{pid}"`) is unchanged.
- Produces: old saves keep `p["priorities"]`, because nothing redraws them. `weights(p)` gives each topic outside his three `OTHER_WEIGHT / 10`.

- [ ] **Step 1: Write the failing tests:**
  - `test_odds_tables`: the three tables sum to 1.0 within 1e-9 and match the spec. For example, High School `proximity` 0.13, `exposure` 0.04; Transfer `playing_time` 0.34; Top Transfer `nil` 0.25.
  - `test_spread`: over 4,000 synthetic prospects (ids `f"s{i}"`, no tilt), every topic is someone's first priority. Each topic's share of first priorities is within ±0.03 of its table odds.
  - `test_tilts`: the Mom tilt raises `stability`'s share of priorities over 3,000 draws against no tilt. A QB tilt raises `coach`.
  - `test_old_priorities_kept`: a prospect with eight-topic priorities set by hand keeps them through `recruiting.new_week` (or the weekly step the career uses), and `sum(weights(p).values()) == 1.0` within 1e-9.
  - `test_portal_tables`: a portal entrant's priorities come from the new portal table, with `p["stars"]` None (no crash in `tilt_for`).
  - `test_decider_draw_kept`: for 200 pids, a decider whose old topics did not change (`"self"`) draws the same topic as before. A Mom's topic is one of `("proximity", "academics", "stability")`.
- [ ] **Step 2: Run** `python3 tests/test_recruit_grades.py`. Expected: the new tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `python3 tests/test_recruit_grades.py`, `python3 tests/test_persona.py`, `python3 tests/test_recruiting.py`. All pass (a test pinned to an eight-topic draw is updated to the new tables, each with a ledger ruling).
- [ ] **Step 5: Commit** "School Grades Phase 2: thirteen topics in the priority tables, tilted by who decides, personality, stars and position".

### Task 3: The scenes talk about them

**Files:**
- Modify: `coach_career/scenes.py`. Add the five topics to every per-topic table:
  - `PHRASES`
  - `LINES` (cue, hit, polite, quiet; three lines each)
  - `LEAD_LINES`
  - `LEAD_HONEST`
  - `HONEST_HIT`
  - `SAID_HONEST`
  - `NEEDS` (each claim line names its topic)
  - the reaction-to-topic map near line 384
  - `truth()`, whose claimable topics gain the five
- Test: `tests/test_recruit_grades.py`, plus the existing `tests/test_scene_truth.py` and `tests/test_scenes.py`.

**Interfaces:**
- Consumes: `strengths` with the 13 topics (Task 1).
- Produces: every table in the list above has a key for every topic in `PITCHES`, except `winning` where the table already special-cases it.
- Produces: the copy follows the house voice:
  - A recruit speaks plainly, like the existing lines.
  - A claim ("That stadium is packed every Saturday.") is in `NEEDS` with its topic, so it shows only when `truth()[topic]` holds.
  - The honest lines never claim the grade.
  - Location's lines name the town's setting from `programs.tags` where a format field fits (`{setting}` added to `_fields` as the lower-case setting word, "a college town").

- [ ] **Step 1: Write the failing tests:**
  - `test_every_topic_has_lines`: for each topic in `PITCHES`, check `scenes.PHRASES`, `scenes.LINES[t]` (all four kinds, three lines each), `LEAD_LINES`, `LEAD_HONEST` and `SAID_HONEST` (`winning` excepted where already special).
  - `test_new_claims_need_truth`: with `forced_strength(st, slug, pid, "game_day", 0.2)`, a `reaction(...)` hit on `game_day` never returns a line listed in `NEEDS` for `game_day`. At 0.9 it can.
  - `test_no_braces_left`: every new line formats with `_fields(...)` and leaves no `{` or `}`.
- [ ] **Step 2: Run.** Expected: fails (KeyError on a new topic).
- [ ] **Step 3: Write the copy and implement.**
- [ ] **Step 4: Run** `python3 tests/test_recruit_grades.py`, `python3 tests/test_scenes.py`, `python3 tests/test_scene_truth.py`, `python3 tests/test_persona_scenes.py`. All pass.
- [ ] **Step 5: Commit** "School Grades Phase 2: scenes talk about facilities, location, stability, game day and exposure".

### Task 4: The page

**Files:**
- Modify: `web/recruiting.js`:
  - `PITCH_NAMES` gains the five.
  - The prospect profile's priorities show your grade on each. Where his known priorities show (the revealed list), each gets your program's word on that topic beside it, from `strengths(..., known=True)` already on the payload (check the profile payload; add `strength` per revealed topic in `app/api.py` or `coach_career/recruiting.py`'s profile view if it is missing).
- Modify: `tests/test_ux_sweep.py`, where the opening's chip count is `len(PITCHES)` (13) instead of 8, and any other 8-topic count.
- Test: `tests/test_ux_sweep.py`, `tests/test_scene_window.py`, `tests/test_spacing.py`, `tests/test_smoothness.py`

**Interfaces:**
- Consumes: Task 1's 13 topics, and Task 3's lines (the opening's reactions).
- Produces: the opening's pill menu lists 13 chips, each with your case word. Pitch pickers elsewhere (the lead-with) list all 13.

- [ ] **Step 1: Update the sweep to the new count, and add one check:**
  - On a prospect with a revealed priority, the profile shows that topic's name with a word from `WORD_FLOORS`.
  - The opening menu fits in the call's window (the Phase 1 menu check still holds with 13 chips; the menu scrolls inside if taller).
- [ ] **Step 2: Run** `python3 tests/test_ux_sweep.py`. Expected: fails on the count.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `python3 tests/test_ux_sweep.py`, `python3 tests/test_scene_window.py`, `python3 tests/test_spacing.py`, `python3 tests/test_smoothness.py`. All pass.
- [ ] **Step 5: Commit** "School Grades Phase 2: the page pitches and shows the thirteen topics".

### Task 5: Balance and the golden recruiting week

**Files:**
- Modify: `tests/golden/*` (the golden recruiting hash), only if the gate below passes.
- Modify: `docs/HOW_IT_WORKS.md` (recruiting priorities and pitches)

- [ ] **Step 1:** On `main` (before), run `python3 tools/check_recruiting.py 2` and save the output to the plan workspace as `before.txt`.
- [ ] **Step 2:** On the branch (after), run the same command and save the output as `after.txt`.
- [ ] **Step 3: The gate.** Every metric in `TOLERANCES` must be inside its range in `after.txt`.
  - If one is out, try one tuning pass on the new pulls' weight. The lever is `NEUTRAL_PULL` and the grade scaling, not the old tables. Rerun.
  - If a metric is still out, stop. Leave the golden alone, ledger the numbers, and report to the player.
- [ ] **Step 4:** With the gate passed, re-record the golden recruiting hash the way `tests/test_sim_golden.py` documents it. The games must stay identical, and only `recruiting_sha256` may change. Note the before and after hashes and the metric table in the PR.
- [ ] **Step 5:** Update `docs/HOW_IT_WORKS.md`. Run `python3 tests/run_all.py --retry 1`; it passes, except failures that also fail on `main`.
- [ ] **Step 6: Commit** "School Grades Phase 2: balance checked (check_recruiting before and after); golden recruiting week re-recorded".
