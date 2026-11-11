# Promises Judged All Season — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A starting-role promise is judged week by week, not on one end-of-season snapshot. The score reads late weeks, big games, position and personality, and lands Kept, Bent or Broken. A broken one sends him to the portal (close to certain the older he is) unless you win him back at Keep Them Home. A chip shows where each promise is landing during the season.

**Architecture:** A new `coach_career/promises.py` owns the weekly record, the score, the bands and the chip word. `sim/season.advance` snapshots your promised players before each week's games. `coach_career/offseason.portal_odds` and the Keep Them Home step read the bands. The depth chart, the player page and the Office show the chip and the first "Slipping" line.

**Tech Stack:** Python 3 (no third-party deps), vanilla JS, plain-script tests (`python3 tests/<file>.py`), Playwright (`playwright==1.63.0`).

**Spec:** `docs/superpowers/specs/2026-11-10-promises-expansion-design.md`, sections 2, 3 and 4 plus "Decided". Keeps His Word (section 1) and Unhappy Players (section 5) are Plans B and C.

## Global Constraints

- Branch `claude/jolly-clarke-jivd5o`. Full suite: `python3 tests/run_all.py`.
- `python3 tests/test_sim_golden.py` stays byte-identical. The golden is a first-season career, which has no league and no promises. Tracking never draws from the season's random streams. New draws use their own stream: `random.Random(f"promise-{seed}-...")`.
- Only your school makes promises; AI schools have none (Decided 3). The softer "real role" promise is out of scope (Decided 5).
- A week he is **injured** does not count (Decided 6). A week he is **redshirting** does count: you chose to sit him.
- Tunables are module-level in `coach_career/promises.py`, marked `*tune*`, each with a one-line comment. Starting values:
  - `LATE_WEIGHT = 1.0`: week i of n weighs `1 + LATE_WEIGHT * i / (n - 1)`.
  - `BIG_WEIGHT = 2.0`: a big game weighs this much more.
  - `BENCH_HIT = 0.15`: score lost when he started the week before and sits a big game.
  - `POSITION_HIT = {"QB": 1.5, "OL": 0.6, "K": 0.5, "P": 0.5}` (others 1.0): scales `BENCH_HIT`.
  - `BANDS`: per personality `(kept_at, broken_under)`. Default `(0.70, 0.40)`; cocky `(0.80, 0.55)`; shy `(0.55, 0.30)`; guarded, attention and business use the default.
  - Attention's big games weigh `BIG_WEIGHT * 2`. Cocky's `BENCH_HIT * 1.5`.
  - `LEAVE = {"FR": 0.60, "FRRS": 0.65, "SO": 0.75, "SORS": 0.80, "JR": 0.92, "JRRS": 0.94, "SR": 0.95}`: a broken promise's leave chance by next year's class. `LEAVE_BIG = 0.03` if he was benched in a big game or is a QB. `LEAVE_SHY = -0.10`. Never above 0.97 (Decided 2).
  - `BENT_MULT = 1.5`: a bent promise's portal multiple (the old `PROMISE_BROKEN` was 3.0).
- Copy is Title Case for labels and chips ("On Track", "Slipping", "Broken", "Promise Him Again") and sentences for lines ("Coach, you told me this was my job.").
- Actions patch in place; every chip and line is 44 px on a phone where it is a control.
- Commits end with the two trailer lines from the session's attribution reminder; no model identifiers.

## Review Focus

1. **A save from before tracking:** a promised player with no weekly record. The old rule applies (`use != "starter"` means broken), never a crash. Pinned in Task 3.
2. **Hurt all season:** every week injured, so no week counts. The band is `"none"` and has no effect: kept-neutral, not broken. Pinned in Task 1.
3. **Two promises to one player:** a recruit promised as a signee, then promised again at Keep Them Home. One record per season year, the latest promise. Pinned in Task 2.
4. **A game day in progress:** `advance` resumes a half-played week. The week's snapshot is taken once, never twice. Pinned in Task 2.
5. **Second chance used:** a player re-promised at Keep Them Home whose promise breaks again cannot be promised a third time, and his card says so. Pinned in Task 3.

---

### Task 1: The record, the score and the bands (`coach_career/promises.py`)

**Files:**
- Create: `coach_career/promises.py`
- Test: `tests/test_promises.py` (new)

**Interfaces:**
- Produces: `record(state) -> dict`: `state.setdefault("promises", {})`, keyed `str(year) -> slug -> [{"week": int, "started": bool, "injured": bool, "big": bool}]`.
- Produces: `score(weeks: list[dict], position: str, personality: str) -> Optional[float]`: 0-1, or None when no week counts (all injured or empty).
- Produces: `band(score: Optional[float], personality: str) -> str`: `"kept" | "bent" | "broken" | "none"`.
- Produces: `chip(band: str) -> Optional[str]`: `{"kept": "On Track", "bent": "Slipping", "broken": "Broken"}`, None for `"none"`.
- Produces: `personality_of(state, slug) -> str`: the persona on the league roster entry if it carries one, else `persona.draw(slug, "roster")["personality"]` (stable per player).
- Produces: `benched_big(weeks) -> bool`: he started some week and then sat a later big game while healthy.

- [ ] **Step 1: Write the failing tests** in `tests/test_promises.py`, all on synthetic week lists (no career needed):
  - `test_second_half_mostly_kept`: 12 weeks, sat 1-6 and started 7-12, business: `band == "kept"` (late weeks weigh more: the score is above 0.55 and the default `kept_at` 0.70 is reached by the weights). Assert the exact score `== round(sum(w for started) / sum(w), 3)` with `w = 1 + i / 11`.
  - `test_lost_the_job_reads_worse`: started 1-6 and sat 7-12 scores lower than the mirror above.
  - `test_big_game_bench_hits`: started weeks 1-11, sat week 12 (a big game). The score is lower than the same list with week 12 not big, and `benched_big` is True (False for the not-big list).
  - `test_qb_bench_counts_more`: the same list for QB vs WR. The QB score is lower.
  - `test_injured_weeks_do_not_count`: started 1-4, injured 5-12. Band is `"kept"`. All 12 injured: `score is None` and `band == "none"`.
  - `test_personality_bars`: one score of 0.6 is `"kept"` for shy, `"bent"` for business, `"bent"` for cocky. A score of 0.5 is `"broken"` for cocky.
  - `test_chip_words`: `chip("kept") == "On Track"`, `chip("bent") == "Slipping"`, `chip("broken") == "Broken"`, `chip("none") is None`.
- [ ] **Step 2: Run** `python3 tests/test_promises.py`. Expected: ImportError (no module).
- [ ] **Step 3: Implement** `coach_career/promises.py` with the constants in Global Constraints and the functions above.
- [ ] **Step 4: Run** `python3 tests/test_promises.py`. Expected: passes.
- [ ] **Step 5: Commit** "Promises: the weekly record, the score, the bands".

### Task 2: Snapshot your promised players every week

**Files:**
- Modify: `coach_career/promises.py` (add `snapshot_week`, `promised_now`, `is_big`)
- Modify: `sim/season.py` (`advance`, about line 1648: call after `_setup_week`, before `_run_games`)
- Test: `tests/test_promises.py`

**Interfaces:**
- Consumes: Task 1's `record`.
- Produces: `promised_now(state) -> dict[str, dict]`: slug -> your league roster entry, for every entry with `promised == season.season_year(state)`. Empty when the state has no `league` (a first season).
- Produces: `is_big(state, slug, week) -> bool`: your game that week is `kind` in `("ccg", "bowl", "playoff")`, or `season.rivalry_for(home, away)` is not None, or the opponent is in `season.rank_map(state, week - 1)`. A bye is not big.
- Produces: `snapshot_week(state, week) -> None`: for each promised slug, append `{"week", "started", "injured", "big"}`. `started` is `in_game` in `season._preview_team(state, me)` for his engine row (matched by `slug`). `injured` means his name is in `state["injuries"][me]`, not the redshirting list. Skipped for a bye week, and when that week is already recorded for him (a half-played week resumed).

- [ ] **Step 1: Write the failing tests.** Build a career in its second season the way `tests/test_offseason.py` does: `new_season`, `finished`, `offseason.run_all`, `offseason.next_season`. Then set `promised = season_year` on two of your league roster entries: your starting QB and a bench player.
  - `test_snapshot_records_each_week`: `advance` two weeks. Each of the two has two entries with the right `week`. The starter has `started` True; the bench player False.
  - `test_snapshot_once_per_week`: call `snapshot_week(st, w)` twice for the same week. Still one entry each.
  - `test_injured_is_marked`: put the bench player on `state["injuries"][me]`, then snapshot. `injured` is True. A redshirting player is `injured` False.
  - `test_first_season_records_nothing`: on a fresh first-season career, `advance` one week. `state.get("promises")` is empty or absent.
  - `test_one_record_per_year`: promised twice in one year (two flags, same year). One list.
- [ ] **Step 2: Run** `python3 tests/test_promises.py`. Expected: the new tests fail.
- [ ] **Step 3: Implement** the three functions, plus the call in `advance` guarded by `state.get("career") and state.get("league")`.
- [ ] **Step 4: Run** `python3 tests/test_promises.py` and `python3 tests/test_sim_golden.py`. Both pass; the golden is identical.
- [ ] **Step 5: Commit** "Promises: a snapshot of your promised players before each week's games".

### Task 3: The offseason reads the band; a broken promise all but sends him; second chances at Keep Them Home

**Files:**
- Modify: `coach_career/offseason.py`:
  - `portal_odds`, about line 789: the `broken` test and the `promised` segment.
  - Its caller, about line 855: pass the bands in `ctx["promise"]`.
  - The retention build where `e["ask"]` is computed (`RETAIN_ASK`).
  - `stay_chance`, line 521.
  - The retention advance, about line 595, where `p["promised"] = year` is set.
- Modify: `coach_career/promises.py` (add `bands(state, year) -> dict[str, dict]`)
- Test: `tests/test_promises.py`, `tests/test_offseason.py` (still passes)

**Interfaces:**
- Consumes: Task 1's `score`, `band`, `benched_big`, `personality_of`; Task 2's record.
- Produces: `bands(state, year) -> dict[str, dict]`: slug -> `{"band", "score", "benched_big": bool, "personality"}` for your players promised for `year` who have a record. No record means not in the dict (the old rule applies).
- Produces: `ctx["promise"]` in `portal_odds`: that dict for your team, `{}` for others.
- Produces in `portal_odds`, for a player promised for `year - 1`:
  - **In `ctx["promise"]`:**
    - `kept`: `base *= KEPT_STAY`.
    - `bent`: add `("promised", base * (promises.BENT_MULT - 1))`.
    - `broken`: add `("promised", max(0, leave - sum(parts so far)))`, where `leave = min(0.97, LEAVE[next class] + (LEAVE_BIG if benched_big or a QB) + (LEAVE_SHY if shy))`.
    - `none`: nothing.
  - **Not in `ctx["promise"]`** (an old save): the old rule, `use != "starter"` adds `base * (PROMISE_BROKEN - 1)`.
- Produces at Keep Them Home, for a leaver whose `driver == "promised"` and whose band is `broken`:
  - His NIL ask is `promises.PROMISE_NIL_MULT` (2.5, *tune*) times the usual, times 0.8 for business and 1.3 for cocky.
  - `stay_chance` gives a real starting role re-promised 0.55 (*tune* `PROMISE_AGAIN_STAY`) in place of 0.6, and nothing 0.02.
  - The entry he stays with carries `promised_again = year`.
  - A player whose `promised_again` is the year before, and whose promise broke again, gets `e["no_third"] = True`. His promise offer counts as nothing, and his card says "He won't believe another promise.".

- [ ] **Step 1: Write the failing tests** (unit; `portal_odds` and `stay_chance` called directly with built `p`, `ctx` and `e` dicts):
  - `test_broken_junior_all_but_gone`: band broken, class JR next year, business. Total chance is `0.92 ± 0.001`.
  - `test_broken_freshman_may_wait`: FR, shy. Total `0.60 - 0.10 = 0.50`.
  - `test_bent_adds_half`: band bent. The promised segment is `base * 0.5`.
  - `test_kept_stays_more`: band kept. The total equals the role chance times `KEPT_STAY`.
  - `test_old_save_old_rule`: promised, not in `ctx["promise"]`, use bench. The promised segment is `base * (PROMISE_BROKEN - 1)`.
  - `test_promise_again_and_nil`: a broken-promise leaver. Re-promise with a real starting role gives `stay_chance == 0.55`; nothing gives 0.02. His NIL ask is 2.5 times the usual (business 2.0, cocky 3.25).
  - `test_no_third_chance`: `promised_again` the year before and broken again. `no_third` is True and a promise offer adds nothing.
- [ ] **Step 2: Run** `python3 tests/test_promises.py`. Expected: the new tests fail.
- [ ] **Step 3: Implement.** The Keep Them Home card's reason keeps "Was promised a starting role and did not get it"; a `no_third` card adds "He won't believe another promise.".
- [ ] **Step 4: Run** `python3 tests/test_promises.py`, `python3 tests/test_offseason.py`, `python3 tests/test_sim_golden.py`. All pass.
- [ ] **Step 5: Commit** "Promises: the offseason reads the band; a broken promise all but sends him; one more chance at Keep Them Home".

### Task 4: You can see it coming: the chip and the first "Slipping" line

**Files:**
- Modify: `sim/season.py` (`depth_roster_view`'s `card` and `player_profile`: add `promise`)
- Modify: `coach_career/promises.py` (add `now(state, slug) -> Optional[str]`, `news(state) -> list[dict]`)
- Modify: `coach_career/office.py` (`program_news` merges `promises.news`)
- Modify: `web/depth/depth.js` (a chip on the player's card and panel), `web/season.js` (`renderPlayer` tag), and CSS if needed
- Test: `tests/test_promises.py`; a browser check in `tests/test_ux_sweep.py` (depth chart and player page)

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: `now(state, slug) -> Optional[str]`: the chip word for this season's record so far (`chip(band(score(...)))`), None when not promised or no week counts.
- Produces: the `promise` field (the chip word or None) on depth cards and the player profile.
- Produces: `news(state) -> list[dict]`: one item the first week a promise's band turns `bent` or `broken`, `{"week", "slug", "name", "line": "Coach, you told me this was my job."}`, remembered in the record so it is said once.

- [ ] **Step 1: Write the failing tests:**
  - `test_now_reads_so_far`: the second-season career from Task 2, the bench player promised and two weeks advanced. `now(...) == "Broken"` or `"Slipping"`, and the starter's is `"On Track"`.
  - `test_news_once`: the first slip yields one news item; another week yields no second item for him.
  - `tests/test_ux_sweep.py`: a promised player's depth card and player page show the chip text, and the Office's news shows the line.
- [ ] **Step 2: Run** them. Expected: they fail.
- [ ] **Step 3: Implement.** Chip tones: On Track `good`, Slipping `warn`, Broken `bad` (the existing `go-tag` tones).
- [ ] **Step 4: Run** `python3 tests/test_promises.py`, `python3 tests/test_ux_sweep.py`, `python3 tests/test_spacing.py`, `python3 tests/test_smoothness.py`. All pass.
- [ ] **Step 5: Commit** "Promises: the chip on the depth chart and his page; he says so when it slips".

### Task 5: Docs and the long-run check

**Files:**
- Modify: `docs/HOW_IT_WORKS.md` ("Why players leave" and "Keep them home")

- [ ] **Step 1:** Run `python3 tools/long_run.py 5` on `main` and on the branch. Write down the portal share (spec: about 8%) and your team's promised leavers.
- [ ] **Step 2:** Update `docs/HOW_IT_WORKS.md`: weekly judging, the bands, leave chances, second chances and the chip.
- [ ] **Step 3:** Run `python3 tests/run_all.py`. It passes.
- [ ] **Step 4: Commit** "Promises: docs; the long-run portal share holds".
