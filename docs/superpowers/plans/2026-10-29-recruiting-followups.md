# Recruiting Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four small follow-ups to the recruiting board: sort by the ladder, filters kept per career, a hollow star instead of the "Heard" tag, and a real per-contact History sub-tab.

**Architecture:** Task 1 is front-end only (`web/recruiting.js`, `web/recruiting.css`, `tests/test_ux_sweep.py`). Task 2 is Python only (`coach_career/recruiting.py` logs every action you take; `coach_career/prospects.py` exposes `history` on each board row; `tests/test_recruiting_api.py`). They touch disjoint files and run in parallel in separate worktrees; Task 3 integrates and pushes.

**Tech Stack:** vanilla JS, Python stdlib, Playwright tests over `tools/dev_server.py`.

**Spec:** the player's request (2026-10-29): "do all three" (sort by ladder, filters per career, per-contact History) and: "Replace the 'Heard' tag on the Recruiting board with a hollow star. ★ Playing time stays the tag for a confirmed priority; ☆ Prestige means he brought it up on this week's call or visit (title: 'He brought this up on the call this week'). Apply it on the pane's tag row and on the pitch options in the step and the scene, drop the word 'Heard' everywhere, update the sweep assertions that look for 'Heard'." Board spec for context: `docs/superpowers/specs/2026-10-29-recruiting-board-redesign.md`.

## Global Constraints

- `python tests/test_sim_golden.py` passes at every commit (the log entries added in Task 2 must not change any random draw: no new `rng` calls, no reordering).
- Every `/api/...` path keeps its method, path, body and existing response keys; Task 2 only adds `history` to board rows.
- The word "Heard" appears nowhere in `web/` or `tests/` after Task 1 (`grep -rn "Heard" web/ tests/` prints nothing).
- Star glyphs: `★` (U+2605) for a confirmed priority, `☆` (U+2606) for a topic he brought up this week; the ☆ tag's `title` is exactly "He brought this up on the call this week" (on an in-home visit: "He brought this up on the visit this week").
- Commits carry the session's two attribution trailer lines; no model identifiers.

## Review Focus

1. **A topic that is both confirmed and brought up this week** must show once, as ★ (confirmed wins). Pinned in Task 1's sweep assertion.
2. **History for a recruit you have never contacted** shows the empty line, not an error; a recruit with a scene pitched this week shows the pitch with his reaction. Pinned in Task 2's test and Task 1's sweep.
3. **Sorting by the ladder** puts a recruit you lead without an offer above a recruit you trail with one; committed-to-you first, lost last. Pinned in Task 1's sweep.
4. **Switching careers** must not carry a position or state filter over. Pinned in Task 1's sweep (open career A with a group filter, open career B, no filter).
5. **Log growth**: a long career logs thousands of contacts; the board row's `history` is capped at the last 40 entries for him and the log itself is not re-walked per row more than once per view. Pinned in Task 2's test (cap) and its implementation (one pass building a per-pid index).

---

### Task 1: Board follow-ups (worktree `rf-board`)

**Files:**
- Modify: `web/recruiting.js` (sort key at ~656; `view.group`/`view.state` keying ~617-662; the tag row ~918; `heardTopics` ~953; the step's dropdown labels ~957-966; `pitchPicker` ~1072-1084; the History sub-tab body ~983-992), `web/recruiting.css` (a `.go-tag.cue`/`.go-pitch.cue` look replacing `.heard`), `tests/test_ux_sweep.py` (lines 340, 349, 356, 361, 381 and the History/sort/filter assertions)

**Interfaces:**
- Consumes `b.history` (Task 2): a list, newest first, of `{week, kind, action, pitch, nil, reaction, school}` where `kind` is one of `contact` (with `action` in message/call/hc_visit/official_visit/scout), `pitch` (with `pitch` topic and `reaction` in hit/polite/quiet), `offer`, `raise_nil`, `pull_offer` (with `nil` and `school`), `hung_up`, `asked_more`, `not_buying`, `commit`, `hard`, `flip`, `decommit`, `signed`, `leaning_fcs` (with `school`). Until Task 2 lands, `b.history` is undefined: render the existing "Contacts this week" fallback then.
- Produces: `sortKey(b)` for "your chance": `standingOf(b, me)` tone/word order: Yours first, then Favourite, In it, Not offered-but-leading (fill), Long shot, Lost; ties by `fill` descending then national rank.

- [ ] **Step 1: Sweep assertions first** (they fail now): the ☆ tag after a call (`.go-pane .go-tags .go-tag.cue` whose text starts with "☆" and whose `title` is the exact sentence), the step dropdown option text containing "☆" for the cue topic and "★" for a known priority, the scene's `.go-pitch.cue .go-tag` showing "☆"; a topic both known and cued shows one ★ tag; "Heard" absent from the page text; sort order (seed a recruit you lead without an offer vs one you trail with one, via the API as the sweep seeds today); a group filter set in career A is absent after opening career B; the History sub-tab lists the message you sent (`Week n · Message · <pitch>`), the call with its pitch and reaction, and the empty line for an untouched recruit.
- [ ] **Step 2: Implement** the four changes. `heardTopics` keeps its logic (this week's cue), the UI renders `☆ Playing time` with the title, and ★ for `priorities_known` (a cued topic that is also known renders as ★ only). History rows read: `Week 3 · Message · Playing time`, `Week 4 · Call · Prestige · He lit up`, `Week 5 · Offer · 120 NIL`, `Week 6 · Committed to Georgia`; newest first.
- [ ] **Step 3: Verify**: `python3 tests/test_ux_sweep.py`, `python3 tests/test_recruiting_standing.py`, `python3 tests/test_web_urls.py`, `grep -rn "Heard" web/ tests/` empty, `python3 tests/test_sim_golden.py`.
- [ ] **Step 4: Commit** on `rf-board`.

### Task 2: The contact log (worktree `rf-log`)

**Files:**
- Modify: `coach_career/recruiting.py` (`_act` ~1070-1215: one `_event` per action you take, with `pitch`, `nil`, `reaction` as applicable; `_event` at 1241 unchanged), `coach_career/prospects.py` (board rows ~436: `history`), `tests/test_recruiting_api.py`

**Interfaces:**
- Produces `history` on every board row as the Task 1 contract describes, newest first, capped at 40, built from `rc["log"]` in one pass per view (`{pid: [events]}` index), including every existing kind in `REPORT_KINDS` plus the new `contact`, `pitch`, `raise_nil`, `pull_offer` entries, and only events where `school` is you or the kind is one of his own (`commit`, `hard`, `flip`, `decommit`, `signed`, `leaning_fcs`, and `offer` from any school).
- Golden-safe: `_event` appends to a list; no RNG.

- [ ] **Step 1: Test first** in `tests/test_recruiting_api.py`: after a message with a pitch, a call, its pitch (through the scene), an offer at 120 and a raise to 150, the board row's `history` has those entries in reverse order with the right fields; an untouched recruit has `history == []`; after 50 messages across weeks (advance the week through the dispatcher's step or set `current_week`), `len(history) == 40`.
- [ ] **Step 2: Implement**; `python3 tests/test_recruiting_api.py`, `python3 tests/test_recruiting.py`, `python3 tests/test_sim_golden.py`, `python3 tests/test_api_dispatch.py`.
- [ ] **Step 3: Commit** on `rf-log`.

### Task 3: Integrate (main)

- [ ] Merge `rf-board` and `rf-log`; run `python3 tests/test_ux_sweep.py` (History now real), `python3 tests/test_recruiting_api.py`, `python3 tests/test_spacing.py`, `python3 tests/test_career_e2e.py`, `python3 tests/test_sim_golden.py`; update `docs/HOW_IT_WORKS.md` (the ☆/★ tags, History); commit; push.
