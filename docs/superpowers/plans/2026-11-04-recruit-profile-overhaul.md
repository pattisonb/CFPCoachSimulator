# Recruit Profile Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One shared recruit profile view (hero header, Overview cards, progress strip) in the board pane and the Prospect Profile popup.

**Architecture:** The server adds display fields and viewer-scoped write-ups to `prospects.row` and `prospects.profile`. `web/recruiting.js` gains module-level builders (`heroView`, `overviewView`, `scoutingTab`) used by both the pane (`pane()` in `drawBoard`) and `openProfile`. The pane's sub-tabs become Overview · Scouting · Recruitment · History; the stat strip, tags, standing and race move into Recruitment unchanged.

**Tech Stack:** Python 3 (stdlib), vanilla JS, CSS grid, Playwright tests as plain scripts.

**Spec:** `docs/superpowers/specs/2026-11-04-recruit-profile-overhaul-design.md`

## Global Constraints

- Title Case labels, tags, kickers, chips, buttons; sentences for verdicts and hints; American spelling; no null/undefined/NaN on the page.
- Patch in place (`window.CFP.ui`); full redraw only on tab open, recruit switch, career change, week advance, stage change.
- Controls at least 44 px tall on a phone; every URL relative; no sideways scroll; light and dark.
- `python3 tests/test_sim_golden.py` byte-identical. No truth leaks: write-ups built from `our_grades` reads only.

## Review Focus

- A portal entrant (no stars, height already a string, `cls` instead of a class year): the hero must not show "NaN" or "undefined".
- A recruit with no look: Overview shows "Send a scout to read him." and empty bars with "Not Scouted"; no comp, no verdict.
- A complete report with no comp close enough: no "once complete" line beside a comp; one line only.
- A signed recruit (no Recruit ▾): header right block still lays out; Recruitment tab keeps Off the Board.
- Part 3 trait fields (`commit_style`, a twist) arriving in `traits`: rows appear with Title Case labels and no new code.

---

### Task 1: Server fields

**Files:** Modify `coach_career/prospects.py`; Test `tests/test_profile_fields.py`

**Produces:** `display_pos(ea_position) -> str` (LEDG/REDG→EDGE, LT/RT→OT, LG/RG/C→IOL, HB/FB→RB, SAM/MIKE/WILL→LB, FS/SS→S, else itself); `row()` gains `display_pos`, `pos_rank` (rank at his `ea_position` by national order), `height_display` ("6'5\""), `weight_display` ("250 lbs"), `class_of`; `profile()` gains the same in `public`, plus `report` = `{"headline", "verdict", "strengths", "develop", "attributes": [{group, label, words, lo, hi, tone}]}` or None before a look, `trait_hints` {trait: sentence} for unknown traits, `need`, `history`. `_evaluation` uses `display_pos` and drops the doubled label ("Upside: Big upside").

- [ ] Write failing tests: display_pos mapping; pos_rank counts by ea_position; height/weight strings incl. portal string height; report built only from reads (changing `truth` after the read leaves `report` unchanged); strengths ≤ 3, develop only words below Solid else empty; no strength text starts with its own label; hints for unknown traits only.
- [ ] Implement; run `python3 tests/test_profile_fields.py`; golden unchanged; commit.

### Task 2: Shared view in the front end

**Files:** Modify `web/recruiting.js`, `web/recruiting.css`

- [ ] Hero, tabs (`overview`, `scouting`, `recruitment`, `history`; route aliases `profile`→`overview` and old `overview`→`recruitment` via a `pane2` param-less mapping in `applyRoute`), Overview cards grid `repeat(auto-fit, minmax(300px, 1fr))`, bottom strip, popup using the same builders.
- [ ] Overview patches with `ui().morph` when the board row changes; sub-tab switch swaps the body only.
- [ ] Commit.

### Task 3: Tests

**Files:** Create `tests/test_profile_overhaul.py`; update `test_profile_compact`, `test_persona_ui`, `test_story_ui`, `test_ux_sweep`, `test_smoothness`, `test_spacing`, `test_deep_links`, `test_scene_window` for moved selectors (no loosened thresholds).

- [ ] Browser test at 1280 and 400, light and dark: header fields, position match across header/verdict/comp, cards across then stacked, bars and words, unscouted recruit, comp once, popup same view, no sideways scroll, Title Case labels.
- [ ] Run each updated test, then `python3 tests/run_all.py`; commit; screenshots to the scratchpad.
