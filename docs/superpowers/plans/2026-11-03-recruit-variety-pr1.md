# Recruit Variety PR 1 (Budgets, Personality, Who Decides, Discovery) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every recruit gets a personality and a decider that change what works on him, revealed by scouting and talking; recruiting hours rise to about 150 a week and scouting gets its own points budget.

**Architecture:** A new module `coach_career/persona.py` owns the trait tables, the seeded draw and small rule functions (`pitch_mult`, `lowball_share`, `pester_free`, ...). `recruiting.py` calls them at its existing hook points (`_contact_points`, `is_lowball`, `_contact_land`, `_act`, `weekly_step`); `scenes.py` reads the trait lines; `prospects.profile` and the recruiting API report what the viewer knows. Rules are table rows, so PR 2 (story) and PR 3 (twists, commit style) add rows and hooks, not new paths.

**Tech Stack:** Python 3 engine (runs in Pyodide), vanilla JS front end (`web/`), plain-script tests (`python3 tests/<file>.py`), Playwright for UI tests.

**Spec:** `docs/superpowers/specs/2026-11-03-recruit-variety-design.md` (Section 1 is this PR).

## Global Constraints

- `CLAUDE.md` rules: Title Case on every tag, chip, label and button ("Not Known Yet", "Loves the Attention", "High School Coach", "Points Left"); sentences for help and scene lines; American spelling; no "null"/"undefined"/"NaN" on the page; no numbers out of 100 for moods.
- New randomness only in its own seeded stream: `random.Random(f"persona-{seed}-{pid}")` for the draw; nothing added to existing streams.
- Tunable constants are module-level, marked `*tune*`, one-line comment.
- `python3 tests/test_sim_golden.py` stays byte-identical.
- Front end: patch in place (`window.CFP.ui`), no full redraws; controls ≥ 44 px on a phone; `tests/test_spacing.py`, `tests/test_ux_sweep.py`, `tests/test_smoothness.py` pass.
- Commits end with the two attribution trailer lines (Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com> / Claude-Session: https://claude.ai/code/session_01HFbivHLRXCS9LsHMpURgp2); no model identifiers.
- Values pinned by the spec: hours `140 + (rating − 50) × 0.4` in fives (140–160); scouting points `40 + (best evaluator − 50) × 0.4` in fives (40–60); look cost 10 in a staffed area, 15 elsewhere, 5 for a portal transfer; personalities 20% each; deciders Himself 30, Mom 20, Dad 15, Grandmother 10, High School Coach 15, Trainer 10.

## Review Focus

1. **A career saved before this PR** loads mid-season: every prospect (and portal entrant) gets a persona on first read, deterministically, and nothing crashes. Test in Task 1.
2. **Viewer isolation**: what an AI school "knows" never shows as revealed to the player, and the player's reveals are per school. Test in Task 4.
3. **Not enough scouting points** for a look: a 409 with "Not enough scouting points left this week." and the Send button disabled with that reason; points refill at the week step. Tests in Task 2 and Task 6.
4. **A prospect whose ask is 0** (or under `LOWBALL_MIN`) with the Cocky or Trainer rule: no lowball on a 0 offer when the ask is 0. Test in Task 3.
5. **The portal** (transfers): personas and points work there too; a portal look costs 5. Test in Task 2.

---

### Task 1: The persona module and the draw

**Files:**
- Create: `coach_career/persona.py`
- Modify: `coach_career/recruiting.py` (`start` ~line 275; portal entrant creation, grep `def _portal` / where entrants get `priorities`)
- Test: `tests/test_persona.py`

**Interfaces:**
- Produces:
  - `PERSONALITIES = ("cocky", "shy", "guarded", "attention", "business")`, `PERSONALITY_LABEL = {"cocky": "Cocky", "shy": "Shy", "guarded": "Guarded", "attention": "Loves the Attention", "business": "All Business"}`
  - `DECIDERS = {"self": 0.30, "mom": 0.20, "dad": 0.15, "grandma": 0.10, "hs_coach": 0.15, "trainer": 0.10}`, `DECIDER_LABEL = {"self": "Himself", "mom": "Mom", "dad": "Dad", "grandma": "Grandmother", "hs_coach": "High School Coach", "trainer": "Trainer"}`, `DECIDER_TOPICS = {"self": (), "mom": ("proximity", "academics"), "dad": ("nil", "playing_time"), "grandma": ("proximity", "coach"), "hs_coach": ("coach", "playing_time", "winning"), "trainer": ("nil",)}`
  - `draw(pid: str, seed) -> dict` returning `{"personality": str, "decider": str, "decider_topic": str | None}` (stream `random.Random(f"persona-{seed}-{pid}")`)
  - `of(state: dict, pid: str) -> dict`: the prospect's persona, drawing and storing it on `p["persona"]` if missing (old saves, portal entrants).

- [ ] **Step 1: Write the failing tests** in `tests/test_persona.py`:
  - `test_draw_is_deterministic`: `draw("p1", 7) == draw("p1", 7)`; `draw("p1", 7) != draw("p2", 7)` for at least one of 20 pids.
  - `test_shares`: over 5000 pids, each personality within 0.17–0.23; deciders within ±0.03 of `DECIDERS`; `decider_topic is None` iff decider is `"self"`; a topic is always in `DECIDER_TOPICS[decider]`.
  - `test_class_gets_personas`: a fresh career (use the helper the other recruiting tests use to start one, e.g. `tests/test_recruiting.py`) has `"persona"` on every prospect.
  - `test_old_save_lazily_drawn`: delete `persona` from a prospect, call `persona.of(state, pid)`, get the same dict as `draw(pid, rc["seed"])` and it is now stored.
- [ ] **Step 2: Run** `python3 tests/test_persona.py`. Expected: ImportError / fail.
- [ ] **Step 3: Implement** the tables and `draw`/`of` in `coach_career/persona.py`; in `recruiting.start` set `p["persona"] = persona.draw(p["id"], state.get("rng_state", 0))` after `nil_ask`; portal entrants get theirs from `of` on first use (no extra draw in the portal path).
- [ ] **Step 4: Run** `python3 tests/test_persona.py` and `python3 tests/test_sim_golden.py`. Expected: PASS, golden identical.
- [ ] **Step 5: Commit** "Recruits get a personality and a decider (persona.py)".

### Task 2: Budgets: 150 hours and scouting points

**Files:**
- Modify: `coach_career/recruiting.py` (`weekly_hours` ~987, `HOURS` ~65, `_act` scout branch ~1474/1485/1580, `weekly_step` ~2236 where `rc["hours"] = {}`), `app/api.py` (where `hours_left` is returned for the board and the scouting desk), `coach_career/prospects.py` `scouting_view` (report points)
- Test: `tests/test_scout_points.py`; update any test asserting the old hours (grep tests for `weekly_hours`, `hours_left`, `"scout"` costs)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `WEEKLY_HOURS_BASE = 140`, `WEEKLY_HOURS_PER = 0.4` (*tune*); `weekly_hours(state, slug) -> int` = `5 * round((140 + max(0, rating − 50) × 0.4) / 5)`.
  - `SCOUT_POINTS_BASE = 40`, `SCOUT_POINTS_PER = 0.4` (*tune*); `LOOK_COST = {"area": 10, "away": 15, "portal": 5}` (*tune*).
  - `scout_points(state, slug) -> int`: the week's budget from the best evaluator (the same max the scout branch computes today; factor it into `best_evaluator(state) -> int`).
  - `scout_points_left(state, slug) -> int`: `rc["scout_points"].setdefault(slug, scout_points(...))`; reset with hours at the week step.
  - `look_cost(state, slug, pid) -> int`: "portal" when `is_portal(state)`, "area" when his state is in an area a staff scout covers (the same test `scout_week` uses), else "away".
  - `HOURS["scout"]` removed; a Send spends `look_cost` points; 409 "Not enough scouting points left this week." when short.
  - API: the scouting desk reports `points_left`, `points_week`, and each row's `cost`.

- [ ] **Step 1: Write the failing tests**: `test_hours_range` (a coach with recruiting 50 → 140, 100 → 160); `test_points_range` (best evaluator 50 → 40, 100 → 60); `test_look_costs` (a prospect in a staffed area costs 10, elsewhere 15, a portal entrant 5); `test_send_spends_points_not_hours` (hours unchanged, points down by the cost); `test_short_points_409` (message text exact); `test_points_refill_next_week`.
- [ ] **Step 2: Run** `python3 tests/test_scout_points.py`. Expected: FAIL.
- [ ] **Step 3: Implement** the constants and functions above; move the scout gate in `_act` from hours to points.
- [ ] **Step 4: Run** `python3 tests/test_scout_points.py`, `python3 tests/test_recruiting.py` (and any recruiting test touching hours), fix tests that assumed 50–60 hours or a 5-hour Send. Expected: PASS.
- [ ] **Step 5: Commit** "About 150 recruiting hours a week; scouting has its own points".

### Task 3: Personality and decider rules in the engine

**Files:**
- Modify: `coach_career/persona.py` (rule functions), `coach_career/recruiting.py` (`_contact_points` ~1119, `is_lowball` ~466 and its caller ~1517, `nil_value` ~461, `_contact_land` ~1620, `would_pester` ~496, `_act` call/visit reveal ~1600, the decommit chance ~1969, `weekly_step` for attention cooling)
- Test: `tests/test_persona_rules.py`

**Interfaces:**
- Consumes: `persona.of(state, pid)` (Task 1).
- Produces (all in `persona.py`, each reading `of(state, pid)`; `slug` where the rule depends on the school):
  - `pitch_mult(state, pid, action, pitch) -> float`: Cocky ×1.3 on `playing_time`/`prestige`; Shy: `hc_visit` ×1.5, his first `call` from a school ×0.5; Business: `message` ×0.3; the decider's topic ×1.2 on an `hc_visit` (else 1.0).
  - `counts_as_priority(state, pid, pitch) -> bool`: `pitch in p["priorities"] or pitch == decider_topic`.
  - `lowball_share(state, pid) -> float`: Cocky 0.7, Trainer decider 0.8, else `recruiting.LOWBALL` (0.5). `is_lowball(nil, ask, share=LOWBALL)` gains the parameter; a 0 offer with ask 0 is never a lowball.
  - `nil_over(state, pid) -> tuple[float, float]`: Trainer `(1.0, 1.2)` (full value up to 1.2 × ask), else `(NIL_OVER, inf)`. Business: offer and NIL value ×1.3 (`offer_mult`).
  - `hollow_mult(state, pid) -> float`: Cocky 2.0 (applies to `ANSWER_HOLLOW`).
  - `pester_free(state, pid) -> int`: Attention 5, else `PESTER_FREE` (3).
  - `call_reveals(state, slug, pid) -> bool`: Guarded never; Shy not on the first call; else today's `CALL_REVEAL` roll (keep its stream).
  - `decommit_mult(state, pid) -> float`: Guarded 0.5.
  - `ATTENTION_GAP = 2` (*tune*): in `weekly_step`, an Attention recruit with no contact from a school in 2 weeks gets that school's `cooled_until = week + 1`.

- [ ] **Step 1: Write the failing tests**, each forcing the persona on one prospect (`p["persona"] = {...}`) in a fresh career and comparing to the same prospect with `{"personality": "business"...}` or a neutral baseline: `test_cocky_pitch` (×1.3 on playing time, not on academics), `test_cocky_lowball_at_70` (offer at 0.6 × ask is a lowball for Cocky, not for Shy), `test_zero_ask_never_lowball`, `test_shy_first_call_half_and_no_reveal`, `test_shy_visit_1_5`, `test_guarded_call_never_reveals_visit_does`, `test_guarded_decommit_half`, `test_attention_pester_free_5`, `test_attention_cools_after_two_quiet_weeks`, `test_business_message_0_3`, `test_decider_topic_counts_as_priority` (a pitch on Mom's topic scores like a priority), `test_trainer_lowball_at_80_and_nil_to_1_2x`.
- [ ] **Step 2: Run** `python3 tests/test_persona_rules.py`. Expected: FAIL.
- [ ] **Step 3: Implement** the functions and call them at the hook points; scenes' pitch path (`_contact_land` via the scene) gets the same multipliers.
- [ ] **Step 4: Run** `python3 tests/test_persona_rules.py`, `python3 tests/test_recruiting.py`, `python3 tests/test_sim_golden.py`. Expected: PASS, golden identical.
- [ ] **Step 5: Commit** "Personality and the decider change what works on a recruit".

### Task 4: Discovery

**Files:**
- Modify: `coach_career/persona.py`, `coach_career/recruiting.py` (`look` ~2429 after a look lands; `_act` first call / visit; official visit), `coach_career/prospects.py` `profile` ~472 and the board rows the pane reads
- Test: `tests/test_persona_discovery.py`

**Interfaces:**
- Consumes: Task 1, Task 3's `call_reveals` gate for the personality on a call (Guarded: visit).
- Produces:
  - `rc["traits_known"][slug][pid] = {"personality": bool, "decider": bool}` (PR 2 adds "story", PR 3 "commit_style").
  - `persona.learn(state, slug, pid, trait: str) -> bool` (True when newly learned; logs `_event(state, "learned", pid, slug, trait=trait)` for the player).
  - Reveal rules: decider at 2 looks of his report (the player's reads); personality at the school's first call (Guarded: first in-home visit); for AI schools the same rules run so their behavior can use it later, but only `state["team"]`'s map is ever reported.
  - `persona.view(state, viewer, pid) -> dict`: `{"personality": label | None, "decider": label | None, "decider_topic": topic | None}`; `None` means "Not Known Yet". `profile()` and the board row include it as `"traits"`.

- [ ] **Step 1: Write the failing tests**: `test_unknown_at_start` (all None), `test_decider_after_two_looks`, `test_personality_after_first_call`, `test_guarded_needs_visit`, `test_reveals_are_per_school` (an AI school's contacts never set the player's map), `test_history_logs_learned` (one line, sentence case, e.g. "Your staff learned his mom has the final say.").
- [ ] **Step 2: Run** `python3 tests/test_persona_discovery.py`. Expected: FAIL.
- [ ] **Step 3: Implement** `learn`, `view` and the hooks; add `traits` to `profile` and to each board row.
- [ ] **Step 4: Run** `python3 tests/test_persona_discovery.py` and `python3 tests/test_recruiting_api.py` (or the API test the repo uses; grep `profile(`). Expected: PASS.
- [ ] **Step 5: Commit** "Traits are learned by scouting and talking".

### Task 5: Scene words for each personality and decider

**Files:**
- Modify: `coach_career/scenes.py` (`OPEN`, `CONTEXT`, `cue`, `reaction`, `TABLES`), `coach_career/persona.py` (line tables)
- Test: `tests/test_persona_scenes.py`; the existing scene tests (grep tests for `scenes.`) must still pass

**Interfaces:**
- Consumes: `persona.of` (Task 1), `call_reveals` (Task 3).
- Produces: `persona.LINES[personality]` with keys `open`, `small_talk`, `hit`, `quiet` (3+ lines each, his voice, present tense, no numbers, the `scenes.FIELDS` placeholders only); `persona.DECIDER_LINES[decider]` (3+ lines, the decider speaking at an in-home visit; Himself has none). Scenes use the personality's `open`/`hit`/`quiet` lines in place of the generic ones half the time (seeded by the scene's existing rng); Business scenes skip the small-talk turn; a Shy first call or a Guarded call gives a cue with no topic (a line such as "I don't know, Coach. I'm still figuring it out."); an in-home visit adds one turn from the decider as a new turn kind `who: "family"` with `label` (the decider's label), which the page renders like `him` under that label.

- [ ] **Step 1: Write the failing tests**: `test_every_line_fills` (every line in the new tables formats with `scenes._fields` output, no `{`/`}` left, no "null"); `test_cocky_scene_uses_cocky_lines` (over 20 seeded scenes at least one line from `LINES["cocky"]`); `test_business_skips_small_talk`; `test_guarded_call_cue_has_no_topic`; `test_visit_has_decider_turn` (a Mom-decided recruit's visit has a `family` turn).
- [ ] **Step 2: Run** `python3 tests/test_persona_scenes.py`. Expected: FAIL.
- [ ] **Step 3: Implement** the tables (write the lines: American spelling, sentence case, a high schooler's voice) and the scene hooks.
- [ ] **Step 4: Run** `python3 tests/test_persona_scenes.py` plus the existing scene tests. Expected: PASS.
- [ ] **Step 5: Commit** "Each personality and decider has its own voice in calls and visits".

### Task 6: The page: traits on the profile and pane, points in the Scouting Center

**Files:**
- Modify: `web/recruiting.js` (profile sub-tab, pane tags; the scene renders the `family` turn), `web/scouting.js` (Points Left, each Send's cost, disabled reason), `web/recruiting.css` / `web/scouting.css` as needed, `docs/HOW_IT_WORKS.md` (recruiting: traits, discovery, budgets)
- Test: `tests/test_persona_ui.py`; update `tests/test_ux_sweep.py` / `tests/test_scouting_layout.py` where they assert hours on a Send

**Interfaces:**
- Consumes: `traits` on profile and board rows (Task 4); `points_left`, `points_week`, row `cost` (Task 2); `family` scene turns (Task 5).
- Produces: on the Profile sub-tab a "Personality" and "Who Decides" row, each "Not Known Yet" (muted) or the label (Who Decides adds "Cares About: <Topic>" when known); the pane's tag strip adds the known traits as chips; the Scouting Center header reads "Points Left: 35 of 50" next to Hours; a Send shows "10 Points" / "15 Points" / "5 Points"; short of points it is disabled with the title "Not enough scouting points left this week."; a learned trait patches the profile in place (no redraw, no flash on recruit switch).

- [ ] **Step 1: Write the failing test** `tests/test_persona_ui.py` (Playwright, the launch helpers in `tests/test_career_e2e.py`): profile shows "Not Known Yet" twice before contact; after a call the Personality row shows a label from `PERSONALITY_LABEL`; after two Sends the Who Decides row shows a label; Scouting header text matches `Points Left: \d+ of \d+`; a Send button reads `\d+ Points`; drain points then the Send is disabled with the exact title; at 400 px every new control is ≥ 44 px; no "null"; switching recruits adds no `go-changed` (reuse `QUIET_WATCH` from `tests/test_smoothness.py`).
- [ ] **Step 2: Run** `python3 tests/test_persona_ui.py`. Expected: FAIL.
- [ ] **Step 3: Implement** the page changes; update HOW_IT_WORKS.
- [ ] **Step 4: Run** `python3 tests/test_persona_ui.py`, `python3 tests/test_ux_sweep.py`, `python3 tests/test_spacing.py`, `python3 tests/test_smoothness.py`. Expected: PASS.
- [ ] **Step 5: Commit** "Traits on his profile and the pane; scouting points in the Scouting Center".

### Task 7: Retune for realism and the full suite

**Files:**
- Modify: `coach_career/recruiting.py` constants (`BASE_POINTS`, `DIMINISH`, the AI contact plan in `_ai_week` / the code around line 1890–1940 that spends AI hours), `tools/check_recruiting.py` (add a row: the share of the player's-school-like actions per week if useful; no tolerance loosened)
- Test: `tests/test_recruiting_realism.py`, `python3 tests/run_all.py`

**Interfaces:**
- Consumes: everything above.
- Produces: tuned constants, each still `*tune*` with its comment updated.

- [ ] **Step 1: Run** `python3 tools/check_recruiting.py 3` on the branch before tuning and save the table to the scratchpad; note every metric outside `TOLERANCES`.
- [ ] **Step 2: Tune** the AI's hours use and the action values until `python3 tools/check_recruiting.py 3` is inside every tolerance (commit timing `committed_by_12`, class sizes, decommits are the likely movers). Do not change `TOLERANCES`.
- [ ] **Step 3: Run** `python3 tests/test_recruiting_realism.py` and `python3 tests/test_sim_golden.py`. Expected: PASS, golden identical.
- [ ] **Step 4: Run** `python3 tests/run_all.py`. Expected: all pass (known flakes, re-run once: the US-map wheel, the season-list click).
- [ ] **Step 5: Commit** "Retune recruiting for the bigger budgets and the traits".
