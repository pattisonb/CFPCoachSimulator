# Headquarters Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make eleven Coming Soon widgets ready. **Spec:** `docs/superpowers/specs/2026-11-07-headquarters-design.md` "Round 2".

**Global Constraints:** the house rules in CLAUDE.md; golden test byte-identical; tunables marked `*tune*`.

**Review Focus:** (1) the outlook on a week-0 career and on a later season; (2) What-If for a recruit already
committed to you (rank unchanged); (3) tasks and goals on an old save (empty, defaults); (4) a stale contact
never made (counts as stale once offered); (5) goals met and unmet both read as words with bars.

### Task 1: Server reads and the plan route
Files: `coach_career/headquarters.py`, `app/api.py`, `tests/test_headquarters.py`.
- [ ] Failing tests: `contacts_from_log`, `outlook_words`, `whatif_moves_rank`, `whatif_committed_unchanged`,
  `goals_defaults_and_saved`, `plan_round_trip`, `plan_refused`.
- [ ] Implement `last_contacts`, `outlook`, `what_if`, `goals`, `set_plan`; route wants and `POST .../plan`.
- [ ] Run the test and the golden test; commit.

### Task 2: The eleven widgets
Files: `web/hq.js` (`depth` source, `whatif` ctx call), `web/hq-widgets/planned.js` (Staff Assignments only),
`web/hq-widgets/outlook.js` (new: Alerts, Board Health, Offer Efficiency, Position Battles, Scholarships,
Calendar, What-If, Senior Impact, Roster Loss, Tasks, Goals), `web/index.html`, `tests/test_copy_case.py`.
- [ ] Raise `MIN_WIDGETS` to 27 in the browser test; add `check_tasks_goals` (add a task, check it off, reload;
  edit the commits goal, reload); watch it fail.
- [ ] Implement; the sweep and the new checks pass; commit.

### Task 3: Docs, suite, deploy
- [ ] `docs/HOW_IT_WORKS.md` Headquarters section; full suite; push; Pages with branch `headquarters`.
