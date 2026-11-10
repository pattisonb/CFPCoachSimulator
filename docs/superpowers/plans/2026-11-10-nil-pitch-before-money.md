# NIL Pitch Before Money — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Until NIL is on an offer, the NIL pitch reads what you could pay him; pitching NIL with nothing attached gets his exact number and makes a money promise you must back within two weeks.

**Architecture:** `recruiting.strengths` reads unattached NIL as `min(1, room / ask)` (room = NIL left plus anything held on him) and gains a `known` flag so the page's grade uses the ask as you know it. The scene's pitch handling (`recruiting._act`, `action == "pitch"`) opens a `"money"` promise in the contact's existing `promises` list; `recruiting._promises` judges it at the week step beside the Package Deal promise. Copy lives in `coach_career/scenes.py`.

**Tech Stack:** Python 3, vanilla JS (no front-end change beyond what the strength words already show), plain-script tests.

**Spec:** `docs/superpowers/specs/2026-11-10-nil-pitch-before-money-design.md`

## Global Constraints

- Branch `claude/jolly-clarke-jivd5o`. Tests are plain scripts: `python3 tests/<file>.py`; full suite `python3 tests/run_all.py`.
- New constants module-level in `coach_career/recruiting.py`, marked `*tune*`: `NIL_PROMISE_SHARE = 0.8` (share of his ask the offer must hold to keep a money promise) and `NIL_PROMISE_WEEKS = 2` (weeks to put it there).
- Copy, verbatim from the spec: History when broken "You talked money and never put it on the table."; his line when NIL is not his topic "The money isn't what this is about for me."; his number when he names it on a call: "He told you he's looking for {n} in NIL." (a History line, numerals, the game's NIL word).
- AI schools read rule 1 (could-pay strength) and make no money promises.
- `python3 tests/test_sim_golden.py`: the games and stat lines stay identical. This change moves AI recruiting, so the golden's recruiting hash will likely change. **Stop and ask the player before regenerating it** (CLAUDE.md); show him the `tools/check_recruiting.py` numbers before and after.
- Commits end with the two trailer lines from the session's attribution reminder; no model identifiers in code or commits.

## Review Focus

1. A school with no NIL left at all (budget spent): unattached strength 0, Weak, honestly; no divide-by-zero. Pinned in Task 1.
2. A prospect whose ask is 0 (a low-tier recruit): strength 1.0 as today, no money promise opened (nothing to back). Pinned in Task 1 and Task 2.
3. A money promise when the offer is pulled, or he commits elsewhere or signs, before the deadline: the promise is closed, not broken (no false History line). Pinned in Task 2.
4. Putting NIL on the offer at exactly `NIL_PROMISE_SHARE` of his ask keeps it; one NIL step under breaks it. Pinned in Task 2.
5. The page's grade never leaks the hidden ask: before a call, two prospects with the same range but different real asks show the same word. Pinned in Task 1.

---

### Task 1: Unattached NIL reads what you could pay; the page reads what you know

**Files:**
- Modify: `coach_career/recruiting.py` (`strengths`, about line 915; `ask_view` 512 for the known ask)
- Modify: `coach_career/prospects.py` (the two `strength=recruiting.strengths(...)` reads, about 705 and 813: pass `known=True`)
- Test: `tests/test_nil_pitch.py` (new)

**Interfaces:**
- Produces: `strengths(state, slug, pid, known: bool = False) -> dict[str, float]`. NIL: `held` on him > 0 → `min(1, held / ask)` as today. Nothing held (offered or not) → `min(1, (nil_left + held) / ask)`, `1.0` when the ask is 0. `known=True` uses the ask as the player knows it (`ask_view`: `exact`, else the range's midpoint rounded with `_five`) in place of the real ask. Scoring (`_contact_points`, `best_pitch`, `_firm_up`) keeps `known=False`.

- [ ] **Step 1: Write the failing tests** (career built as in `tests/test_persona_scenes.py`: `season.new_season(ME, "full", seed=5, career=True)`, `current_week = 1`, hours 1000):
  - `test_offer_without_nil_reads_room`: offer with `pitch="winning"`, `nil=0`; `strengths(...)["nil"] == round(min(1, nil_left / ask), 3)`, not 0 (measured today: 0.0 at Iowa for an ask of 40).
  - `test_before_offer_reads_room_not_tier`: a Group of 5 school (e.g. "tulane") with room ≥ a top recruit's ask reads 1.0 for him; the same school with its budget held elsewhere reads < 0.25.
  - `test_attached_reads_the_deal`: offer with `nil = ask // 2` → `0.5` (± rounding).
  - `test_spent_budget_is_weak`: nil_left 0, nothing held → 0.0, no exception.
  - `test_known_hides_the_ask`: two prospects with the same `ask_view` range but different real asks → equal `strengths(..., known=True)["nil"]`.
- [ ] **Step 2: Run** `python3 tests/test_nil_pitch.py`. Expected: the first two fail.
- [ ] **Step 3: Implement** in `strengths` and pass `known=True` in `prospects.py`. Keep the `_PULLS` cache for the static pulls only; NIL is computed per call, after it.
- [ ] **Step 4: Run** `python3 tests/test_nil_pitch.py` (passes), `python3 tests/test_scenes.py`, `python3 tests/test_recruiting.py` (if present) and `python3 tests/test_sim_golden.py`. If only the golden's recruiting hash differs, note it for Task 3; do not regenerate.
- [ ] **Step 5: Commit** "NIL strength reads what you could pay until money is attached; the page reads the ask you know".

### Task 2: Talking money is a promise

**Files:**
- Modify: `coach_career/recruiting.py` (`_act`, the `action == "pitch"` branch about line 1792; `_promises` about 2277; new constants)
- Modify: `coach_career/scenes.py` (the copy above; the pitch reaction for a non-NIL prospect)
- Test: `tests/test_nil_pitch.py`

**Interfaces:**
- Consumes: Task 1's `strengths`.
- Produces: a promise record in `contacts[pid][slug]["promises"]`: `{"kind": "money", "about": {"ask": n}, "week": week, "broken": None, "kept": None}`, opened when your scene's pitch is `"nil"`, NIL is one of his priorities or his decider's topic (`persona.counts_as_priority(state, pid, "nil")`), his ask > 0 and nothing is held on him. Opening it also sets the contact's `asked = True` (his exact number) and logs the "He told you he's looking for {n} in NIL." History line on a call.
- Produces: `_promises` handles `kind == "money"`: kept the week step `held >= NIL_PROMISE_SHARE * ask` within `NIL_PROMISE_WEEKS` (lands `PACKAGE_KEPT` like a Package Deal promise and logs `promise_kept`); broken after that many weeks without it (cools him `COOL_WEEKS`, `persona.set_cooled_why(..., "promise")`, `promise_broken` with `why="money"`, History "You talked money and never put it on the table."); closed with neither when he commits elsewhere, signs, or your offer is pulled.

- [ ] **Step 1: Write the failing tests:**
  - `test_nil_pitch_opens_money_promise`: a NIL-priority prospect, an open call scene, pitch `"nil"` with nothing held → one `"money"` promise, `ask_view(...)` has `exact`, and the pitch's points are positive (no backfire).
  - `test_money_promise_kept`: then offer with `nil = ceil(0.8 * ask)` to the nearest five at or above; run the week step; `kept` set, a `promise_kept` event.
  - `test_money_promise_broken`: no NIL for `NIL_PROMISE_WEEKS` week steps → `broken` set, `cooled_until` set, a `promise_broken` event with `why == "money"`.
  - `test_money_promise_closed_on_commit_elsewhere`: he commits to another school first → neither kept nor broken, no event.
  - `test_non_nil_prospect_says_so`: NIL not his topic → no promise; his reaction line is "The money isn't what this is about for me."
  - `test_zero_ask_no_promise`: ask 0 → no promise.
- [ ] **Step 2: Run** `python3 tests/test_nil_pitch.py`. Expected: the new tests fail.
- [ ] **Step 3: Implement** the promise opening, `_promises` handling and copy.
- [ ] **Step 4: Run** `python3 tests/test_nil_pitch.py`, `python3 tests/test_scenes.py`, `python3 tests/test_persona_scenes.py`, `python3 tests/test_scene_truth.py`, `python3 tests/test_ux_sweep.py` (the scene flow). All pass.
- [ ] **Step 5: Commit** "Talking money is a promise: back it within two weeks or he cools".

### Task 3: Balance check, docs, and the golden (with the player's OK)

**Files:**
- Modify: `docs/HOW_IT_WORKS.md` (the recruiting pitch and promises paragraphs)
- Possibly: `tests/golden/sim_seed11_two_weeks.json` (only the recruiting hash, only after the player agrees)

- [ ] **Step 1: Run** `python3 tools/check_recruiting.py` on `main` (`git stash` or a worktree) and on the branch; record how often a NIL pitch lands and commits by tier.
- [ ] **Step 2: Update `docs/HOW_IT_WORKS.md`** with the could-pay rule, the known-ask grade and the money promise.
- [ ] **Step 3: Run** `python3 tests/run_all.py`. Everything passes except possibly the golden's recruiting hash.
- [ ] **Step 4: If the recruiting hash changed, stop and show the player** the before and after numbers from Step 1. Only on his yes: `python3 tests/test_sim_golden.py --record`, and check `git diff tests/golden/` touches only `recruiting_sha256`.
- [ ] **Step 5: Commit** "NIL pitch: docs and balance check" (plus "golden: recruiting hash after the NIL pitch change" if approved).
