# Scouting Desk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Scouting tab (replacing Staff) where you run your scouts, send trips from a queue, and read this week's reports.

**Architecture:** Task 1 (engine) adds the look log and the desk view; Task 2 (page) renders the tab and reroutes the Staff tab; the view's shape is fixed below so they run in parallel; Task 3 integrates. Follows the smoothness rules (patch, pulse, toast via `CFP.ui`).

**Tech Stack:** Python stdlib, vanilla JS, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-30-scouting-desk-design.md`

## Global Constraints

- Golden test unchanged: `look()` appends to the log after its existing work; no new or moved random draws; `scout_week` prunes entries older than last week before looking.
- `rc["looks"]` entries exactly `{"week", "pid", "by", "before", "after", "flags"}`; `by` is a staff id or `"trip"`; ranges `{group: [lo_word, hi_word]}` in the existing tiers (`Weak | Fair | Solid | Strong | Elite`, plus the potential-only `All-American` tier if the mapping has it, as `prospects.py` names them); `flags` subset of `gem | bust | generational`.
- `GET /api/season/{id}/scouting` returns `{hours, hours_left, scouts: [{id, name, role, evaluation_word, area, looking_at, yield: {looks, narrowed, flags}}], queue: [{pid, name, position, stars, group, need, national_rank, looks, trips, potential: [lo, hi], can_send: bool, why: str | null}], reports: {this_week: [{scout_id, scout, area, looks, items: [{pid, name, position, stars, change: str, flags: [...]}]}], last_week: [...]}, flags: [{pid, name, position, stars, flag, looks, standing_word}]}`. The `scout` action's response gains `"look": <log entry>`.
- The tab key is `scouting`; `CAREER_TABS` and the tab bar replace `staff` with it; the old `GET .../staff` route and `POST .../staff` stay (the desk's area change posts to it).
- Task 1 owns `coach_career/recruiting.py`, `coach_career/prospects.py`, `app/api.py` (the route), `tests/test_scouting_desk.py`; Task 2 owns `web/recruiting.js` (`renderStaff` → `renderScouting`, `render()`'s tab switch), `web/season.js` (`CAREER_TABS`, the tab button), `web/index.html` (the tab button and `#tab-scouting`), `web/recruiting.css`, `tests/test_ux_sweep.py`. Until merged, Task 2 drives its sweep with `page.route` stubs for `/scouting` and the `scout` response, removed at integration.
- Commits carry the session's two attribution trailer lines; no model identifiers.

## Review Focus

1. **Old saves** without `rc["looks"]` load and the desk renders (empty reports). Task 1 test.
2. **A look that changes nothing** never appears in reports but counts in the scout's yield. Task 1 test.
3. **Sending the last affordable trip** greys every other Send with "Not enough hours" after the patch. Task 2 sweep.
4. **A report name for a recruit not on your board** opens the board's pane on him anyway (reveal path). Task 2 sweep.
5. **The portal** (`is_portal`): the queue lists portal entrants and reports read the same. Task 1 test.

---

### Task 1: Engine and view (worktree `sd-engine`)

- [ ] `tests/test_scouting_desk.py` first (spec section 5 cases, plus Review Focus 1, 2, 5), RED.
- [ ] Implement the log in `look()` and `scout_week`, the view builder in `prospects.py` (one pass over the log), the route in `app/api.py`, the `look` field on the `scout` action response. GREEN: `python3 tests/test_scouting_desk.py`, `python3 tests/test_recruiting.py`, `python3 tests/test_recruiting_api.py`, `python3 tests/test_api_dispatch.py` (route listed), `python3 tests/test_sim_golden.py`. Commit on `sd-engine`.

### Task 2: The tab (worktree `sd-page`)

- [ ] Sweep assertions first (with route stubs): the Scouting tab replaces Staff; four blocks render; the area dropdown posts to `/staff` and toasts; Send spends hours, shows the inline before/after and toasts "Scouted <name> · look n of 3" without rebuilding the queue (smoothness rules); a report name opens the board's pane on him; search filters the queue; Review Focus 3, 4.
- [ ] Implement `renderScouting` and the tab plumbing; the pane's Scouting sub-tab gets the "Reports on the Scouting tab" link. GREEN: `python3 tests/test_ux_sweep.py`, `python3 tests/test_web_urls.py`, `python3 tests/test_spacing.py`. Commit on `sd-page`.

### Task 3: Integrate (main)

- [ ] Merge; drop the route stubs; run the sweep, the desk test, spacing, e2e, golden, `python3 tests/run_all.py`; `docs/HOW_IT_WORKS.md` (the Scouting tab paragraph replaces the Staff tab's); commit; push.
