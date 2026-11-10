# Player Links: the Offseason — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every player name in the offseason opens a profile: a portal entrant's Prospect Profile while the portal is open, otherwise his player page with a Next Season block showing where he is now.

**Architecture:** `sim/season.player_profile` learns to find a player by slug on any team; `coach_career/offseason.next_season(state, slug)` reads `state["league"]` for his team, position, class and overall now; `app/api.py` attaches it as `next`. In the front end, `playerAttrs` and the `player:` modal token carry the slug, `renderPlayer` draws Next Season, and `web/offseason.js` puts links on every name through a helper passed in `recruitingHelpers`.

**Tech Stack:** Python 3 (no third-party deps in the engine), vanilla JS, Playwright tests as plain scripts (Python `playwright==1.63.0` matches the preinstalled Chromium).

**Spec:** `docs/superpowers/specs/2026-11-10-player-links-everywhere-design.md` (phase 1, with "The catch" as revised November 10)

## Global Constraints

- Branch `claude/jolly-clarke-jivd5o`. Tests are plain scripts: `python3 tests/<file>.py`; the full suite is `python3 tests/run_all.py`.
- `python3 tests/test_sim_golden.py` stays byte-identical in every task (nothing here touches the sim or recruiting).
- Copy: labels, kickers and chips in Title Case ("Next Season", "Transferred to Iowa"); sentences with a period; American spelling; no "null"/"undefined"/"NaN" on a page.
- Actions patch in place (`window.CFP.ui`); opening a profile is a modal, never a redraw of the stage under it.
- Every link is focusable and, where it sits alone in a row, at least 44 px tall on a phone (`tests/test_spacing.py`); a link is never nested inside a `<button>` (the `[data-player]` handler in `web/season.js` ignores clicks inside buttons).
- Every URL relative. Commits end with the two trailer lines from the session's attribution reminder; no model identifiers in code or commits.

## Review Focus

1. A drafted, graduated or quitting player (on no team in `state["league"]`): his page opens on last season's team with Next Season reading where he went, never a 404. Pinned in Task 1.
2. A transfer you signed: last season's page is under his old school, Next Season says your team. Pinned in Task 1.
3. A player whose position changed this offseason (the three-part token's name+position match would miss): the slug finds him. Pinned in Task 1 and Task 2.
4. A portal entrant's name after the portal closes (Portal Recap, Who Got Away in the recap): opens the player page, not a dead Prospect Profile. Pinned in Task 3.
5. An old bookmarked `player:<team>|<name>|<pos>` token: still opens. Pinned in Task 2.

---

### Task 1: The player page finds anyone by slug and knows next season

**Files:**
- Modify: `sim/season.py` (`player_profile`, about line 4234)
- Modify: `coach_career/offseason.py` (new `next_season`, near `portal_rows`)
- Modify: `app/api.py` (`season_player`, about line 1536)
- Test: `tests/test_player_next_season.py` (new)

**Interfaces:**
- Produces: `season.player_profile(state, team: Optional[str], name=None, position=None, slug=None) -> Optional[dict]`: with `team=None` and a `slug`, it searches every team's roster in the teams file and returns the first match (its `team` key says where).
- Produces: `offseason.next_season(state, slug: str) -> Optional[dict]`: None outside a career offseason; else `{"team": slug_or_None, "team_name": str_or_None, "position": str, "class": str, "class_name": str, "overall": int, "status": "returning" | "transfer_in" | "signee" | "drafted" | "graduated" | "portal" | "quit"}`. On a roster in `state["league"]["teams"]`: `returning` when that team is the one he played for last season, `transfer_in` when another, `signee` when he has no last-season team. On no roster: the status from `state["offseason"]["departures"]` (the departure's reason), `team` None.
- Produces: `GET /api/season/{id}/player?slug=<slug>` works without `team`; the response gains `"next": next_season(...)` (null outside the offseason).

- [ ] **Step 1: Write the failing tests** in `tests/test_player_next_season.py`, building an offseason with `tests/test_offseason.finished` (as `tests/test_offseason.py` does: `season.new_season("iowa", "full", seed=5, career=True)`, `finished(st)`, `offseason.start(st)`):
  - `test_find_by_slug_on_any_team`: `season.player_profile(st, None, slug=<an Iowa starter's slug>)["team"] == "iowa"`.
  - `test_next_season_returning`: for an Iowa player still on `st["league"]["teams"]["iowa"]["roster"]`, `next_season(st, slug)["status"] == "returning"`, `["team"] == "iowa"` and `["overall"] == ` the league entry's `o`.
  - `test_next_season_departed`: for a player in the departures as drafted (or graduated), `status` is that word and `team` is None.
  - `test_next_season_transfer`: move one player's league entry from another team's roster to Iowa's (as a portal signing does), then `status == "transfer_in"` and `team == "iowa"`.
  - `test_next_season_outside_offseason`: on a fresh career (no `offseason`), `next_season(...) is None`.
  - `test_api_player_by_slug`: through `app.api`'s route function with only `slug`, the response has `next` and `team`.
- [ ] **Step 2: Run** `python3 tests/test_player_next_season.py`. Expected: fails (TypeError / AttributeError on `next_season`).
- [ ] **Step 3: Implement** `player_profile`'s `team=None` search, `offseason.next_season` and the API change (`team` optional when `slug` is given; `_check_team` only when a team was passed). Read the departure reasons from where `start` stores them (the Departures stage's rows); find the exact key while implementing and use it, don't add a second copy.
- [ ] **Step 4: Run** `python3 tests/test_player_next_season.py` (passes), `python3 tests/test_offseason.py` and `python3 tests/test_sim_golden.py` (both unchanged).
- [ ] **Step 5: Commit** "Player page finds a player by slug on any team and knows his next season".

### Task 2: The token and the page carry the slug and show Next Season

**Files:**
- Modify: `web/season.js` (`playerAttrs` about 1712, `openPlayer` 1717, `renderPlayer` 1760+, the modal token reader about 1338, the `[data-player]` click handler about 1978)
- Modify: `web/styles.css` (only if the Next Season block needs a rule)
- Test: `tests/test_deep_links.py`, `tests/test_ux_sweep.py` (the player page section)

**Interfaces:**
- Consumes: Task 1's `next` and slug lookup.
- Produces: `playerAttrs(team, name, position, slug)` → `data-player="team|name|pos|slug"`; `openPlayer(team, name, position, { slug })` sends `&slug=`; token `player:<team>|<name>|<pos>|<slug>`; a three-part token still opens.

- [ ] **Step 1: Write the failing tests:** in `tests/test_deep_links.py`, a four-part `player:` token reopens the page and a three-part one still does; in `tests/test_ux_sweep.py`, during an offseason career, a player page opened by slug shows a "Next Season" block with his team's name and his overall, and a departed player's block reads where he went ("Drafted", "Graduated", "Transferred", "Left the Team").
- [ ] **Step 2: Run** them; expected failures on the missing block and token part.
- [ ] **Step 3: Implement.** The Next Season block sits under the page's header: kicker "Next Season", then "Iowa · QB · Junior · 74 Overall" for a player on a roster (a transfer adds "Transferred From <old school>"), or one line for a departed one. Copy per Global Constraints.
- [ ] **Step 4: Run** `python3 tests/test_deep_links.py`, `python3 tests/test_ux_sweep.py`, `python3 tests/test_spacing.py`. All pass.
- [ ] **Step 5: Commit** "Player page: the slug in its token, and a Next Season block in the offseason".

### Task 3: Every offseason name links

**Files:**
- Modify: `web/season.js` (`recruitingHelpers` about 1511: add `playerAttrs` and `openProfile`)
- Modify: `web/offseason.js` at: Departures "Leaving Your Program" (519) and "The First Round" (539); Redshirts (444, a link beside the toggle button, not inside it) and the Development Redshirts table (760); Keep Them Home cards (565) and The Answers (618); the portal week's Your Moves (603), **Your Portal Board** (646), Who Got Away (660) and the old portal table (690); Portal Recap Who You Got / Who You Lost (705, 710); Development Who Improved / Your Transfers (729) and Top Improvements (778)
- Modify: `web/offseason.css` (only if a link in a row misses 44 px on a phone)
- Test: `tests/test_offseason_links.py` (new, Playwright)

**Interfaces:**
- Consumes: Task 2's `playerAttrs(team, name, pos, slug)`; `Recruiting.openProfile(s, pid)` (web/recruiting.js:2303).
- Produces: `H.playerLink(row)` in `web/offseason.js`: one function that decides the profile. While the portal is open (`rc.portal`) and the row is an entrant with a pid, a `button.go-link` that calls `openProfile`; otherwise a `b.plink` with `playerAttrs(team, name, pos, slug)`, where team is his team for the page (yours for your players, `d.team` for the First Round, `r.from` for a transfer and `r.to`/`r.from` per the spec after the portal closes).

- [ ] **Step 1: Write the failing test** `tests/test_offseason_links.py`: walk an offseason career (as `tests/test_offseason_redesign.py` does) and at each stage click the first name in each list above. Assert the Prospect Profile modal opens for a portal board name during the portal, and the player page (with Next Season) for the rest, at 1280 and 400 px; every link's box is ≥ 44 px tall at 400 px; focus returns to the link when the modal closes.
- [ ] **Step 2: Run** it; expected: no link found at the first stage.
- [ ] **Step 3: Implement** `H.playerLink` and use it at every listed spot. The stage under the modal does not redraw (opening is a modal; patches keep `data-key`s).
- [ ] **Step 4: Run** `python3 tests/test_offseason_links.py`, `python3 tests/test_offseason_redesign.py`, `python3 tests/test_smoothness.py`, `python3 tests/test_spacing.py`, `python3 tests/test_ux_sweep.py`. All pass.
- [ ] **Step 5: Update `docs/HOW_IT_WORKS.md`** (the offseason section and the player page paragraph: names link, Next Season), then **commit** "Offseason: every name opens his profile".
