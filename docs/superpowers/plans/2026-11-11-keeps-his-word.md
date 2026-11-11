# Keeps His Word — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Your reputation for keeping promises, **Keeps His Word**, shown in words. Kept promises raise it; broken ones cost more, most at the broken player's position. Recruits read it when you promise, and below a floor they don't believe you.

**Architecture:** A new `coach_career/word.py` owns the reading on `state["career"]["word"]` (the coach's, so it follows you to a new job), its events, its yearly recovery and how recruits read it. The offseason feeds it the promise bands from Plan A; `recruiting._promises` feeds it money, package and roster promises. `recruiting._answer` and Keep Them Home's `stay_chance` read it. The Office shows it.

**Tech Stack:** Python 3, vanilla JS, plain-script tests, Playwright (`playwright==1.63.0`).

**Spec:** `docs/superpowers/specs/2026-11-10-promises-expansion-design.md`, section 1 and "Decided" (1: heavy at the position, light everywhere; 3: only you, no AI). Builds on Plan A (`docs/superpowers/plans/2026-11-11-promises-judged-all-season.md`, merged).

## Global Constraints

- Branch `claude/jolly-clarke-jivd5o`. Full suite: `python3 tests/run_all.py`.
- `python3 tests/test_sim_golden.py` stays byte-identical. The golden has no promises, and the word never draws randomness.
- Only your coach has a word; AI coaches have none (Decided 3).
- Shown in words, never a number: `programs.WORD_FLOORS` (Elite 90, Excellent 80, Strong 70, Good 60, Solid 50, Fair 40, Thin 30, Weak). Labels are Title Case ("Keeps His Word"); lines are sentences.
- Tunables are module-level in `coach_career/word.py`, marked `*tune*`. Starting values:
  - `WORD_START = 70`.
  - `GAIN = {"kept": 3, "money_kept": 2, "package_kept": 2}`.
  - `COST = {"bent": 2, "broken": 8, "money_broken": 5, "package_broken": 5, "recruit_broken": 5}`.
  - `STAR_COST = 1.5`: a broken promise to a starter-level transfer or a four-star-or-better recruit.
  - `GUARDED_COST = 1.5`: a Guarded player's broken promise.
  - `GROUP_EXTRA = 1.0`: the position takes the same delta again.
  - `RECOVER = 0.25`: each offseason the overall moves this share back toward `WORD_START`.
  - `GROUP_DECAY = 0.5`: each offseason a position's extra halves.
  - `FLOOR = 35`: below it a recruit does not believe a promise.
  - `PROMISE_MULT = (0.5, 1.5)`: a believed promise's points run from 0.5× at 0 to 1.5× at 100, linear.
  - `CARES_MORE = 1.5`: a Guarded recruit, or one whose decider's topic is playing time, reads the word's distance from neutral this much more.
- Commits end with the two trailer lines from the session's attribution reminder; no model identifiers.

## Review Focus

1. **A save from before** (no `career["word"]`): the reading is `WORD_START`, nothing crashes, and the first event creates it. Pinned in Task 1.
2. **A forgiven money promise** (Plan A's small-school forgiveness): no cost. Pinned in Task 2.
3. **Changing jobs:** the word is on `career`, so it survives `next_season` with a new team. Pinned in Task 2.
4. **The reading never leaves 0-100** after many breaks or keeps. Pinned in Task 1.
5. **A position with no history** reads the overall alone. Pinned in Task 1.

---

### Task 1: The reading (`coach_career/word.py`)

**Files:**
- Create: `coach_career/word.py`
- Test: `tests/test_word.py` (new)

**Interfaces:**
- Produces: `book(state) -> dict`: `state["career"].setdefault("word", {"overall": WORD_START, "by_group": {}, "log": []})`.
- Produces: `apply(state, kind: str, group: str, name: str, star: bool = False, personality: str = "") -> float`:
  - Kinds in `GAIN` add; kinds in `COST` subtract (times `STAR_COST` if `star`, times `GUARDED_COST` if Guarded).
  - The overall takes the delta, and `by_group[group]` takes `delta * GROUP_EXTRA` on top.
  - Logs `{"year", "kind", "group", "name", "delta"}`, keeping the last 20.
  - Returns the delta.
- Produces: `reading(state, group: Optional[str] = None) -> float`: the overall, plus `by_group[group]` when given, clamped 0-100.
- Produces: `recover(state) -> None`: the overall moves `RECOVER` of the way back to `WORD_START`; each group extra times `GROUP_DECAY`; extras under 0.5 in size are dropped.
- Produces: `word_text(value) -> str`: the `WORD_FLOORS` word.
- Produces: `last_broken(state, group) -> Optional[str]`: the most recent broken promise's player name at that position.

- [ ] **Step 1: Write the failing tests:**
  - `test_fresh_reads_start`: a state with `career` and no `word` reads `WORD_START`; `word_text(70) == "Strong"`.
  - `test_broken_hits_position_harder`: `apply(st, "broken", "QB", "Jalen Moss")`: the overall is 62, `reading(st, "QB") == 54`, `reading(st, "WR") == 62`.
  - `test_kept_gains_less_than_broken_costs`: one kept and one broken nets below the start.
  - `test_star_and_guarded_cost_more`: a star broken costs 12; a Guarded star broken costs 18.
  - `test_recover`: overall 50 recovers to 55; a QB extra of -8 becomes -4.
  - `test_clamped`: 20 broken promises read 0, not negative; 50 kept read 100.
  - `test_last_broken`: after two breaks at QB, the later name.
- [ ] **Step 2: Run** `python3 tests/test_word.py`. Expected: ImportError.
- [ ] **Step 3: Implement** `coach_career/word.py`.
- [ ] **Step 4: Run** `python3 tests/test_word.py`. Expected: passes.
- [ ] **Step 5: Commit** "Keeps His Word: the reading, its position memory, recovery".

### Task 2: Promises feed it

**Files:**
- Modify: `coach_career/offseason.py`:
  - `_departures`, where `my_promises` is computed: apply each judged band once per year.
  - `start`: call `word.recover` once per offseason, before the bands.
- Modify: `coach_career/recruiting.py`:
  - `_money_promise` and `_promises`: money kept, broken (not when forgiven); package kept, broken; roster ("recruit") broken.
- Test: `tests/test_word.py`

**Interfaces:**
- Consumes: Task 1's `apply` and `recover`; Plan A's `promises.bands(state, year)` (`{slug: {band, score, benched_big, personality}}`).
- Produces: `word.apply_bands(state, year) -> None`:
  - `kept` → "kept"; `bent` → "bent"; `broken` → "broken"; `none` → nothing.
  - The group is `offseason.GROUP[pos]`.
  - `star` when his house overall is 70 or more (*tune* `STAR_OVR`) or his stars are 4 or more.
  - Guarded per `bands`.
  - Remembered in `book["applied"]` as `str(year)` so a second call does nothing.

- [ ] **Step 1: Write the failing tests:**
  - `test_bands_feed_once`: a built bands dict for one broken QB and one kept WR. `apply_bands` twice changes the overall once, by `-8 + 3`.
  - `test_money_and_package_feed`: drive `recruiting._promises` with a kept money promise (+2), a broken one (-5) and a forgiven one (0), using the helpers in `tests/test_nil_pitch.py` (`fresh`, `nil_target`, `money_pitch`).
  - `test_word_follows_the_coach`: `book(st)["overall"] = 40`, then `offseason.run_all` and `next_season`. The new state reads 40 moved by one recovery (47.5).
- [ ] **Step 2: Run** `python3 tests/test_word.py`. Expected: the new tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `python3 tests/test_word.py`, `python3 tests/test_promises.py`, `python3 tests/test_nil_pitch.py`, `python3 tests/test_offseason.py`, `python3 tests/test_sim_golden.py`. All pass.
- [ ] **Step 5: Commit** "Keeps His Word: kept and broken promises move it".

### Task 3: Recruits read it

**Files:**
- Modify: `coach_career/recruiting.py` (`_answer`'s `answer == "promise"` branch), `coach_career/word.py` (add `promise_mult`, `believes`), `coach_career/offseason.py` (`stay_chance`'s promise-again branch), `coach_career/scenes.py` (the disbelief line)
- Test: `tests/test_word.py`

**Interfaces:**
- Consumes: Task 1's `reading` and `last_broken`.
- Produces: `word.promise_mult(state, pid, group) -> float`:
  - `lo + (hi - lo) * reading / 100` from `PROMISE_MULT`.
  - For a Guarded recruit or a decider topic of playing time, the distance from 1.0 times `CARES_MORE`.
- Produces: `word.believes(state, group) -> bool`: `reading(state, group) >= FLOOR`.
- Produces in `_answer`:
  - A truthful roster promise earns `ANSWER_PROMISE * promise_mult`.
  - When not `believes`, it earns 0 and his line is `scenes.WORD_DOUBT`: "Coach, I heard what happened with {name}." with the `last_broken` name at his position, else "Coach, I've heard about your promises.".
  - The answer is logged with `doubted: True`.
- Produces in Keep Them Home: `PROMISE_AGAIN_STAY * promise_mult` (capped 0.9), and 0.02 when he does not believe.

- [ ] **Step 1: Write the failing tests:**
  - `test_promise_mult_scale`: reading 70 gives 1.2; reading 30 gives 0.8; a Guarded recruit at 70 gives 1.3.
  - `test_doubted_promise_earns_nothing`: overall 30. A truthful roster promise earns 0, and the scene's reply is the doubt line with the last broken name.
  - `test_strong_word_earns_more`: overall 90. The same promise earns `ANSWER_PROMISE * 1.4`.
  - `test_keep_them_home_reads_word`: overall 90 gives `stay_chance` `min(0.9, 0.55 * 1.4)`; overall 20 gives 0.02.
- [ ] **Step 2: Run** `python3 tests/test_word.py`. Expected: fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `python3 tests/test_word.py`, `python3 tests/test_scenes.py`, `python3 tests/test_persona_scenes.py`, `python3 tests/test_scene_truth.py`, `python3 tests/test_sim_golden.py`. All pass.
- [ ] **Step 5: Commit** "Keeps His Word: recruits read it; below the floor they don't believe you".

### Task 4: You can see it: the Office card, and the docs

**Files:**
- Modify: `coach_career/office.py` (the Office view: add `word`), `web/office.js` (a "Keeps His Word" card), `docs/HOW_IT_WORKS.md`
- Test: `tests/test_word.py`; a browser check in `tests/test_ux_sweep.py` (the Office)

**Interfaces:**
- Produces in the Office payload: `word: {"text": word_text(overall), "weakest": {"group", "text"} or None, "recent": [log lines]}`.
  - Each log line is a sentence: "Kept your word to Jalen Moss (QB)." or "Broke your word to Jalen Moss (QB)."
  - `weakest` is the position with the lowest reading when it is a word below the overall.
- Produces in the Office: the card "Keeps His Word". Its kicker carries the word as a chip; then the weakest position, if any ("Quarterbacks have heard: Fair"); then the three latest lines.

- [ ] **Step 1: Write the failing tests:** the payload shape in `tests/test_word.py`; in `tests/test_ux_sweep.py` the Office shows "Keeps His Word" and a word from `WORD_FLOORS`.
- [ ] **Step 2: Run** them. Expected: fails.
- [ ] **Step 3: Implement**, and update `docs/HOW_IT_WORKS.md`.
- [ ] **Step 4: Run** `python3 tests/run_all.py`. It passes.
- [ ] **Step 5: Commit** "Keeps His Word: the Office card; docs".
