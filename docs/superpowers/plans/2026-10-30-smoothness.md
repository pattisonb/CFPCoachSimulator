# Smoothness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No screen blanks or jumps after an action; every action patches in place, pulses what changed, and toasts what happened.

**Architecture:** A shared `web/ui.js` provides the toast stack, the pulse/fade helpers and a `reconcile(list, rows, key, draw, patch)` for keyed lists. The Recruiting board gets `patchBoard(v)`; the other screens' action handlers patch their own nodes. A measuring test drives every action and fails on a cleared container, a scroll jump, a missing toast or lost focus. Task 1 (board) and Task 2 (other screens) touch disjoint files and run in parallel; Task 3 integrates.

**Tech Stack:** vanilla JS, CSS transitions, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-30-smoothness-design.md`

## Global Constraints

- Rule 1 of the spec is absolute for actions: the element the player looks at stays connected; no `innerHTML = ""`/`replaceChildren()` on a container holding it as part of an action; page and pane scroll within 2 px. Full rebuilds only on tab open, recruit switch, career change, week advance, offseason stage change.
- Toast copy exactly as spec section 2.3; toasts stack to three; `role="status" aria-live="polite"`.
- Motion: pulse 600 ms (`.go-changed`), fades 150 ms, pane cross-fade 120 ms; all off under `prefers-reduced-motion: reduce`.
- No API change; no change under `sim/`, `engine/`, `coach_career/`, `teamdata/`, `app/`.
- Task 1 owns `web/recruiting.js`, `web/recruiting.css`, `tests/test_ux_sweep.py`'s recruiting sections; Task 2 owns `web/ui.js` (new), `web/season.js`, `web/offseason.js`, `web/coach.js`, `web/styles.css`, `web/offseason.css`, `web/index.html`/`coach.html` (script tag), `tests/test_smoothness.py`. Task 1 uses `window.CFP.ui` (toast, pulse, fadeIn, fadeOut, reconcile) whose contract is fixed below; until merged it ships a tiny inline fallback with the same names inside recruiting.js, deleted at integration.
- Commits carry the session's two attribution trailer lines; no model identifiers.

## Interfaces (`window.CFP.ui`, Task 2 produces; Task 1 consumes)

- `toast(text, {ms = 3500, kind = "info" | "error"})`: appends to `#toasts` (max three; the oldest leaves), returns the node.
- `pulse(el)`: adds `.go-changed` for 600 ms (no-op under reduced motion).
- `fadeIn(el)` / `fadeOut(el) -> Promise` (resolves after removal).
- `reconcile(container, rows, key, draw, patch)`: keeps `container`'s children keyed by `data-key`; for each row in order, patches an existing node with `patch(node, row)` or draws a new one with `draw(row)`; moves nodes into order; removes nodes whose key is gone (with `fadeOut`). Returns the nodes in order.
- `busy(button, promise)`: disables and marks the button `.go-busy` until the promise settles, then restores and refocuses it.

## Review Focus

1. **Two quick actions in a row** (Message, then Call before the first refetch lands): the second must not patch with stale data; patches apply in request order and a superseded refetch is dropped. Task 1 test.
2. **The recruit leaves the current tab because of the action** (an offer moves him from Cold to In touch while the Cold tab is active): the pane stays on him with a toast, the row leaves the list with a fade, and the stage counts update; the pane does not switch to someone else. Task 1 test.
3. **Toasts during a scene**: a pitch's toast must not cover the scene's reply. Task 1 test (toast container bottom-left, scene unaffected).
4. **Offseason decision buttons** patch the card they sit in; the stage's other cards keep scroll. Task 2 test.
5. **Keyboard**: after an action via keyboard, focus returns to the same control. Both tasks' tests.

---

### Task 1: The board patches (worktree `sm-board`)

**Files:** `web/recruiting.js` (`renderRecruiting`'s split into `loadBoard`/`drawBoard`/`patchBoard`; every action path `run`, `pick`, the step, the scene's pitch, `setBoard`, the auto-recruit segment, the needs/map filters stay full-draw since they are not actions on a recruit... treat filters as redraws of the list only via `reconcile`), `web/recruiting.css` (`.go-changed`, fades, the pane cross-fade, reduced-motion block), `tests/test_ux_sweep.py` (recruiting sections: add the smoothness assertions for board actions as section 5 of the spec describes; the e2e shape stays).

- [ ] Sweep assertions first (fail now): for each of Message, Offer, Raise NIL, Scout, Call+Pitch, Pull offer (confirm accepted via `page.on("dialog", accept)` in that one block), Off the board: pane element identity preserved (except Off the board, which switches recruit with a cross-fade), zero removals of the watched node, scroll within 2 px, the exact toast text, focus on a control; Review Focus 1-3.
- [ ] Implement `patchBoard` and the action paths; the fallback `ui` shim.
- [ ] Verify: `python3 tests/test_ux_sweep.py`, `python3 tests/test_recruiting_standing.py`, `python3 tests/test_web_urls.py`, `python3 tests/test_sim_golden.py`. Commit.

### Task 2: Shared helpers and the other screens (worktree `sm-screens`)

**Files:** `web/ui.js` (new; linked in `index.html` and `coach.html` before the page scripts), `web/styles.css` (`#toasts` stack replacing the single `#toast`, keeping `toast()` in season.js/coach.js as thin wrappers over `CFP.ui.toast`), `web/season.js` (Office quick actions, depth chart moves/redshirt/position, settings), `web/offseason.js` (every decision button patches its card), `web/coach.js` (save), `web/offseason.css`, `tests/test_smoothness.py`.

- [ ] `tests/test_smoothness.py` first: the generic check of spec section 5 as a helper `assert_smooth(page, watched_selector, action_fn, toast_text)`; cases: Office action (the quick action present on the Office card), depth chart move, redshirt toggle, position change, settings change, each offseason stage's first decision button (retention offer, portal offer, redshirt, position, review choice, hire), Your coach save; reduced-motion run.
- [ ] Implement `ui.js` and the screen patches.
- [ ] Verify: `python3 tests/test_smoothness.py`, `python3 tests/test_ux_sweep.py` (non-recruiting sections unchanged), `python3 tests/test_offseason_e2e.py`, `python3 tests/test_spacing.py`, `python3 tests/test_sim_golden.py`. Commit.

### Task 3: Integrate (main)

- [ ] Merge both; delete Task 1's `ui` shim in favor of `CFP.ui`; `tests/test_smoothness.py` gains the board actions (reusing the sweep's seeded careers or its own); run the sweep, smoothness, spacing, e2e, golden, then `python3 tests/run_all.py`; `docs/HOW_IT_WORKS.md` one paragraph; commit; push.
