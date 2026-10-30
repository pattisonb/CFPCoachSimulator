# Smoothness: no blank screens, no jumps, a word when something happens

Status: approved in conversation 2026-10-30 (the player: "when you offer a player and then
immediately the screen is blank… it's jumpy, maybe we add animations or smoothing and a little
notification or toast… we need to scan for all that stuff and just smooth things out").
Front-end only: `web/recruiting.js`, `web/season.js`, `web/offseason.js`, `web/coach.js`, the
stylesheets, and a measuring test.

## 1. Why

Every action on the board calls the board's full redraw: `renderRecruiting` empties the tab
(`box.innerHTML = ""`), shows "Loading your board…", refetches and rebuilds everything. The pane
disappears for a moment, the list rebuilds, the scroll position moves, and nothing says what
happened. The same pattern is in the Office, the offseason stages and the depth chart: 55
container-clearing redraws across the three page scripts. The fix is a rule, measured by a test,
not a set of patches.

## 2. The rules

1. **An action patches, it does not rebuild.** After any action the player takes on a screen
   (a menu item, a step's Send/Offer, a pitch, a redshirt toggle, an offseason choice, a depth
   chart move, a settings change), the screen refetches its data and updates in place: the
   element the player was looking at stays in the DOM; its text, tags, strip cells, menu items
   and bars change; the list's rows are reconciled by id (rows move, appear or go; the others are
   reused); the page's and the pane's scroll positions are unchanged. A container the player is
   looking at is never emptied as part of an action. Full rebuilds are allowed only on: opening a
   tab, switching the recruit (the pane swaps), a career change, a week advancing, and the
   offseason moving to its next stage.
2. **Changes are shown, not implied.** A value that changed because of the action gets a brief
   highlight (a 600 ms background pulse, `.go-changed`): the standing word, a strip cell, a tag
   that appeared, the hours and NIL meters. New rows or tags fade in (150 ms); removed ones fade
   out before leaving. Switching the recruit cross-fades the pane (120 ms). Switching sub-tabs
   fades the body. All of it honours `prefers-reduced-motion: reduce` (no motion, instant
   changes).
3. **Every action gets a toast.** One short sentence, present tense, with the recruit's name and
   the cost or the result: "Message sent to Wesley Adams · 5 hours", "Offer sent to Wesley Adams
   · 120 NIL", "Called Wesley Adams · 15 hours", "Scouted Wesley Adams · look 2 of 3", "Offer
   raised to 150 NIL", "Offer to Wesley Adams pulled", "Wesley Adams is off your board", "Auto-
   recruit for this week", "Redshirt: Marcus Hale", "Pitch: Playing time · He lit up". Errors
   keep their current toasts. Toasts stack (at most three visible, newest on top), never overlap
   the Recruit menu, and are announced to screen readers (`role="status"`, `aria-live="polite"`).
4. **Loading is a state of the thing, not an empty screen.** While an action's refetch is in
   flight the acting control shows a busy state (disabled, a subtle spinner in the button); the
   rest of the screen stays as it was. "Loading…" placeholders appear only on first open of a tab.
5. **Focus stays where the player was.** After an action, focus returns to the control that
   triggered it (or the Recruit button when the menu closed), never to the page body.

## 3. Where it applies

Every Coach Career screen: the Recruiting board (pane actions, step, scene, Off the board), the
Prospects tab (add to board), the Scouting/Staff tab (area changes), the Office (its quick
actions), the depth chart (moves, redshirt, position changes), the offseason stages (every
decision button: retention offers, portal offers, redshirt and position choices, the review, the
job choice, hires), Settings, and Your coach's save. The week advance keeps its progress overlay.

## 4. How the board does it

`renderRecruiting(s, box)` splits into `loadBoard` (fetch) and `drawBoard` (first draw) as today,
plus `patchBoard(v)`: it diffs the new view against the drawn one by recruit id, updates the
header meters, the stage counts, the rows in place (`.go-row-recruit[data-pid]`: word, dot,
subtitle), re-sorts by moving nodes, and rebuilds only the pane's inner parts that changed (head
chip, strip cells, tags, the menu's items, the Overview body) without replacing the pane element.
Actions call `act()` then `refresh()` = `loadBoard` + `patchBoard`; `renderRecruiting` is called
only from the full-rebuild cases in rule 1. Other screens follow the same split where they act:
`renderOffice`, `renderDepth`, the offseason stage renderers get a patch path for their action
results, or their action handlers update the specific nodes they changed.

## 5. The test

`tests/test_smoothness.py` (Playwright over the dev server), one check per action across the
screens in section 3, driven through the real page: before the action it records the identity of
the container being looked at (an element handle for the pane, the list, the offseason card, the
depth table), the page and pane scroll positions, and `document.activeElement`; after the
action and its refetch it asserts the same element is still connected (`handle.evaluate(e =>
e.isConnected)`), that no node under it had `innerHTML` cleared (a `MutationObserver` installed
before the action counts `childList` removals whose removed node contained the element the player
was looking at: zero allowed), that scroll positions are within 2 px, that a toast with the
expected sentence appeared, and that focus is on a control, not `BODY`. A reduced-motion run
(`page.emulate_media(reduced_motion="reduce")`) asserts no transitions run (computed
`transition-duration` is `0s` on `.go-changed` elements). The sweep keeps its assertions.

## 6. Out of scope

Rewriting screens into a framework; animating the sim overlay; changing any API.
