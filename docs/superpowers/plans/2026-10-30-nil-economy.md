# NIL Economy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The transfer portal runs on this season's leftover NIL plus a performance reward (with a floor), retention spends from the same pool, and a tier-capped share carries into next year; nothing draws on next year's budget.

**Architecture:** One engine task (`coach_career/recruiting.py` budgets, `coach_career/offseason.py` reward/pool/carry, `coach_career/prospects.py` or `sim/season.py` view lines) with a native test and a realism check; one small page task for the three lines. The engine task runs alone first (it owns the budget functions); the page task follows.

**Tech Stack:** Python stdlib, vanilla JS, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-30-nil-economy-design.md`

## Global Constraints

- Exact numbers: reward shares 10/20/10/10/15/10, cap 50%; floor 30% of B; carry caps by tier 15/20/25/30/30 %; all rounded to fives with `_five`.
- `python tests/test_sim_golden.py` passes (the in-season class week does not change); `tools/check_recruiting.py` output for the class is identical; a 10-season `tools/long_run.py` keeps portal signings and AI portal NIL spend within 15% of today's (quote both runs).
- Old saves without `nil_pool`/`nil_carry` load and play through the offseason.
- `PORTAL_NIL_POOL` and `nil_retained` are removed with every reference (grep).
- Commits carry the session's two attribution trailer lines; no model identifiers.

## Review Focus

1. **A school that spent everything and lost** enters the portal with exactly the floor. Task 1 test.
2. **Retention asks larger than the pool** are refused or capped the way the class refuses an offer past the budget (409 "not enough NIL"), never negative. Task 1 test.
3. **Carry never exceeds the cap even when the pool was huge** (national champion with nothing spent). Task 1 test.
4. **The carry is consumed once**: a save reloaded mid-offseason does not double it. Task 1 test.
5. **Your own view**: the meter in the portal shows the pool, and the review's line matches the stored numbers. Task 2 sweep.

---

### Task 1: Engine (worktree `nil-engine`)

**Files:** `coach_career/recruiting.py` (`nil_budget`, `_nil`, `nil_left`, remove `PORTAL_NIL_POOL`), `coach_career/offseason.py` (`start`: seed `nil_pool`; retention spend; the carry at the end of `portal_w4`; `next_season`: apply/clear the carry; remove `nil_retained`), `coach_career/prospects.py`/`sim/season.py` (the review's `nil` block, the recruiting view's `nil` meter fields `budget`/`left`/`pool`), `tests/test_nil_economy.py`, `tools/long_run.py` (record portal NIL spend and signings if it does not already).

**Interfaces:** `recruiting.reward(B, season_facts) -> int`; `recruiting.portal_pool(state, slug) -> dict` (`left`, `reward`, `floor`, `pool`); `state["nil_pool"][slug]`, `state["nil_carry"][slug]`; the recruiting view's `nil` gains `pool` (portal) and `carry` (class); the review view gains `nil_portal: {left, reward, reward_why: [...], floor, pool}`.

- [ ] Tests first (spec section 4), RED. - [ ] Implement. - [ ] `python3 tests/test_nil_economy.py`, `python3 tests/test_retention.py`, `python3 tests/test_offseason.py`, `python3 tests/test_recruiting_api.py`, `python3 tests/test_sim_golden.py`, `python3 tools/check_recruiting.py`, a 10-season `python3 tools/long_run.py --seasons 10 --seed 1` before and after (the "before" from main). - [ ] Commit on `nil-engine`.

### Task 2: The three lines (worktree `nil-page`, after Task 1 merges)

**Files:** `web/recruiting.js` (header meter in the portal: `held / pool`; the portal board title with the pool), `web/season.js` (review line; the first-Office "NIL carried over" note), `tests/test_ux_sweep.py`, `docs/HOW_IT_WORKS.md`.

- [ ] Sweep assertions first. - [ ] Implement with the smoothness rules. - [ ] `python3 tests/test_ux_sweep.py`, `python3 tests/test_offseason_e2e.py`. - [ ] Commit; integrate; push.
