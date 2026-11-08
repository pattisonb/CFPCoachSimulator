# Headquarters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new career tab, Headquarters, where the player builds a recruiting and scouting dashboard from a catalog of widgets.

**Architecture:** A widget registry in the page (`window.HQ`), a canvas that fetches each data source the placed widgets name once, and two routes in `app/api.py` backed by `coach_career/headquarters.py` for the layout and the gap data. The layout lives in the career save, outside the season sim.

**Tech Stack:** Plain browser JavaScript (no build step, `window.CFP.el` and `window.CFP.ui`), CSS, Python standard library, Playwright tests run as scripts.

**Spec:** `docs/superpowers/specs/2026-11-07-headquarters-design.md`

## Global Constraints

- Titles, tags, chips, buttons, column headers and stat labels are Title Case; help lines and toasts are sentences; American spelling (CLAUDE.md).
- No "null", "undefined" or "NaN" on the page; moods and chances as words, never numbers out of 100.
- Every URL relative; every control at least 44 px tall on a phone.
- Actions patch in place (`window.CFP.ui`); a full redraw only on tab open, week advance or career change.
- `python3 tests/test_sim_golden.py` byte-identical; the layout never enters the sim.
- Constants the player may tune are module-level and marked `*tune*`: `HQ_MAX_CARDS = 40`, `HQ_SAVE_DELAY = 600` ms, `MOVERS_SHOWN = 5`.
- Commits end with the session's two attribution trailer lines; no model identifiers.

## Review Focus

1. **An old save without a layout** opens on the empty canvas, never an error (Task 1 test `old_save_reads_empty`).
2. **A layout naming a widget the page does not know** draws the rest and skips it quietly (Task 2 browser check `unknown_widget_skipped`).
3. **A widget whose draw throws** shows "Couldn't Load This Widget" in its own card while the others draw (Task 2 browser check `broken_widget_contained`).
4. **The portal and the offseason** (no class board yet, `targets` empty): every ready widget draws an empty sentence, not a blank card or "undefined" (Task 5 sweep on a career with nothing on the board).
5. **A failed layout save** (server refuses) toasts "Couldn't save your layout." and keeps the page as it is (Task 2 browser check `save_refused_keeps_page`).

---

### Task 1: Layout and gap data on the server

**Files:**
- Create: `coach_career/headquarters.py`
- Modify: `app/api.py` (two routes beside the recruiting routes)
- Test: `tests/test_headquarters.py`

**Interfaces:**
- Produces: `headquarters.layout(state) -> dict` (`{"cards": [...]}`, empty list for an old save); `headquarters.set_layout(state, cards) -> dict` (raises `headquarters.LayoutError(message)` on a bad shape, stores nothing); `headquarters.commits_by_week(state) -> list[dict]` rows `{"week", "gained", "lost", "total"}`; `headquarters.movers(state) -> {"up": [...], "down": [...]}` rows `{"pid", "name", "position", "stars", "places"}`.
- Routes: `GET /api/season/{id}/headquarters?want=commits,movers` returns `{"layout", "commits"?, "movers"?}`; `POST /api/season/{id}/headquarters` with `{"cards": [...]}` returns `{"layout"}`, a 400 `ApiError` on a bad layout.

- [ ] **Step 1: Write the failing tests** as checks run by `__main__` in a temporary seasons folder, a career for `ohio-state` seed 11:
  - `old_save_reads_empty`: a new career's GET returns `{"layout": {"cards": []}}`.
  - `round_trip`: POST three cards `{"id": "c1", "widget": "top-targets", "size": "M"}` ...; GET returns them in order; the saved state's `career.headquarters.cards` equals them.
  - `unknown_kept`: a card with widget `"future-thing"` is stored and returned.
  - `refused`: each of size `"XL"`, id `"Bad Id"`, a 41-card list, duplicate ids, a non-list `cards` is a 400 and the stored layout is unchanged.
  - `gap_data`: after `advance` to week 4, `commits[-1]["total"]` equals the recruiting view's `committed`; every row's `week` is an int and rows are ascending; `movers` has at most 5 up and 5 down, each `places > 0`.
  - `sim_untouched`: the season summary before and after a POST is identical apart from nothing (compare `GET /api/season/{id}` JSON).

- [ ] **Step 2: Run** `python3 tests/test_headquarters.py`; expect an ApiError 404 on the unknown route.

- [ ] **Step 3: Implement** `coach_career/headquarters.py` and the two routes. Card ids and widget ids match `^[a-z0-9-]{1,40}$`; sizes `S`, `M`, `L`. `commits_by_week` walks `state["recruiting"]["log"]` for kinds `commit` and `flip` (gained when `school` is yours; a flip away and `decommit` of yours are lost) keyed by `portal_week` when the recruiting block is the portal, else `week`; it fills every week from the first to the current with running totals and ends with the current count from the recruiting view so the total is exact. `movers` reads `recruiting.latest_report(state)` rows with `rank` and `prev_rank` both set: up when `rank < prev_rank`, sorted by places moved, `MOVERS_SHOWN` each.

- [ ] **Step 4: Run** `python3 tests/test_headquarters.py` and `python3 tests/test_sim_golden.py`; both pass.

- [ ] **Step 5: Commit** "Headquarters: layout and gap data routes".

### Task 2: The canvas, edit mode and the drawer

**Files:**
- Create: `web/hq.js`, `web/hq.css`, `web/hq-widgets/planned.js`
- Modify: `web/index.html` (tab button after Recruiting, `#tab-headquarters` panel, stylesheet and scripts after `recruiting.js`), `web/season.js` (`CAREER_TABS` gains `"headquarters"` after `"recruiting"`; `renderTab` calls `window.HQ.render(state.season, $("#tab-headquarters"), recruitingHelpers)` for it)
- Test: `tests/test_headquarters_browser.py`

**Interfaces:**
- Consumes: Task 1 routes; `helpers.api`, `helpers.postJSON`; `CFP.el`, `CFP.ui`.
- Produces: `window.HQ = { register(widget), render(season, box, helpers), widgets() }`. Widget object as spec section 2. `draw(data, ctx)` with `ctx = { size, season, helpers, act, sample }`; `act(kind, pid, button)` for kinds `board` and `scout` refetches the sources the spec names and redraws the widgets that read them. Card DOM: `.hq-card[data-key=<instance id>][data-widget=<widget id>][data-size=S|M|L]` with `.card-bar` header and `.hq-body`.

- [ ] **Step 1: Write the failing browser checks** (dev server, a new `texas` career, 1280 px): open `?tab=headquarters`; the empty line "Build your Headquarters. Add widgets for recruiting and scouting." shows and the drawer is open; Coming Soon entries carry the tag and no Add button; `unknown_widget_skipped` (POST a layout with `future-thing` and one ready widget, reload, one card); `broken_widget_contained` (register a widget whose draw throws via `page.evaluate`, add it, its card says "Couldn't Load This Widget"); `save_refused_keeps_page` (route the POST to a 400 with `page.route`, add a widget, the toast text, the card still there).

- [ ] **Step 2: Run** `python3 tests/test_headquarters_browser.py`; expect a timeout waiting for `#tab-headquarters`.

- [ ] **Step 3: Implement** the canvas per spec sections 3 to 5: the header (title, Add Widget, Edit Layout/Done), the grid (`.hq-grid`, 4/2/1 columns at 1200 and 700 px, spans by size), edit controls (drag handle with pointer events and a placeholder, size chips, Move Earlier, Move Later, Remove with an Undo button on the toast), autosave after `HQ_SAVE_DELAY`, the drawer (`.hq-drawer`, categories All/Recruiting/Scouting/Program, search, previews drawn from `sample` when the entry first intersects, size chips, Add, "On Your Headquarters" disabled when placed, Coming Soon last), the empty canvas, the source cache (section 4) and `planned.js` with the twelve Coming Soon widgets of spec section 8, each a small sample drawn as a list or meter.

- [ ] **Step 4: Run** the browser checks; pass. Run `python3 tests/test_copy_case.py` after adding `hq.js` and `hq-widgets/*.js` to its `PAGES`.

- [ ] **Step 5: Commit** "Headquarters: canvas, edit mode and the widget drawer".

### Task 3: Recruiting widgets

**Files:**
- Create: `web/hq-widgets/recruiting.js`
- Test: `tests/test_headquarters_browser.py` (widget sweep)

**Interfaces:**
- Consumes: `HQ.register`; sources `board`, `classes`, `prospects`, `hq`; `Recruiting.openProfile(season, pid)` for names; `helpers.onChange(tab)` for View All.
- Produces: the twelve recruiting widgets of spec section 7 with ids `class-glance`, `resources`, `top-targets`, `class-needs`, `visit-schedule`, `recent-commits`, `activity`, `commit-tracker`, `movers`, `class-breakdown`, `rankings`, `recruit-search`.

- [ ] **Step 1: Write the failing sweep**: for every registered ready widget and every allowed size, add it, wait for its body, assert no `null|undefined|NaN`, Title Case on `.card-bar` and `th` and buttons, no sideways scroll at 400 px; the drawer preview of every widget the same.
- [ ] **Step 2: Run**; fails on the missing widgets.
- [ ] **Step 3: Implement** each widget from its source fields: `board.committed`, `open_spots`, `class_rank`, `offers`, `offers_left`, `hours_left`, `hours`, `nil.left`, `points_left`, `targets`, `needs_detail`, `board[].visits`, `recap`, `report`; `classes` top five and your row; `hq.commits`, `hq.movers` (standing words from the board entry); Recruit Search over `/prospects` with Add to Board and Send Scout through `ctx.act`. Each empty case is one sentence.
- [ ] **Step 4: Run** the sweep; pass.
- [ ] **Step 5: Commit** "Headquarters: recruiting widgets".

### Task 4: Scouting and program widgets

**Files:**
- Create: `web/hq-widgets/scouting.js`, `web/hq-widgets/program.js`

**Interfaces:**
- Produces: `scout-queue`, `flags`, `area-scouts` (source `scouting`), `program-compare` (source `programs`).

- [ ] **Step 1: Extend the sweep** to include them, plus an action check: Send Scout on the first Scouting Queue row toasts and the row's looks change in place; Add to Board on a Flags row turns its button into "On Your Board".
- [ ] **Step 2: Run**; fails.
- [ ] **Step 3: Implement** from `scouting_view` fields (database rows, `flags`, scouts) and `programs` rows (tier, prestige, winning, NIL and Pro Pipeline words).
- [ ] **Step 4: Run**; pass.
- [ ] **Step 5: Commit** "Headquarters: scouting and program widgets".

### Task 5: Phone, gates and docs

**Files:**
- Modify: `tests/test_headquarters_browser.py`, `tests/test_spacing.py`, `docs/HOW_IT_WORKS.md`

- [ ] **Step 1:** At 400 px: one column, drag handles hidden, Move buttons reorder, every control at least 44 px tall, no sideways scroll, the drawer a bottom sheet; the full flow (add three, resize, reorder by drag at 1280 and by buttons at 400, remove and Undo, reload, same layout); the sweep on a fresh career with an empty board (Review Focus 4).
- [ ] **Step 2:** `tests/test_spacing.py` gains the Headquarters tab with two widgets placed.
- [ ] **Step 3:** `docs/HOW_IT_WORKS.md` gains "Headquarters": the contract, the sources, the routes, how to add a widget.
- [ ] **Step 4:** `python3 tests/run_all.py` green; `python3 tests/test_sim_golden.py` byte-identical.
- [ ] **Step 5: Commit** "Headquarters: phone layout, gates and docs"; push the branch; run the Pages workflow with branch `headquarters`.
