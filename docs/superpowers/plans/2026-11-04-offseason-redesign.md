# Offseason Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Redraw every Coach Career offseason stage (web/offseason.js) to the player's six mockups, in the game's theme tokens, light and dark, with real data only.

**Architecture:** One header (title, stage chip, pill stepper) and one footer (Back left, Advance right) frame every page. A client-side Overview page (the "hub": hero, numbers, the AD's meeting, the takeaway, history) sits in front of the current stage; the tab opens on it at Departures and Back returns to it from any stage. Stage pages: Departures, Keep Them Home, Transfer Portal weeks (wrapping `window.Recruiting.board` untouched), Development (tabs), Staff (kept, restyled), Ready (the recap). The hub and the Development tabs live in `view` and the address (`opage`); switching the page is a draw from the cached view, a tab or "+ N more" is a patch (`ui.morph`).

**Tech Stack:** Vanilla JS (web/offseason.js), CSS (web/offseason.css), Python view (coach_career/offseason.py), Playwright tests.

**Spec:** The coordinator's brief and the mockups in the session scratchpad (`mock/offseason-screens.webp`, `mock/off-*.html`).

## Global Constraints

- Title Case for labels, chips, kickers, tabs, column headers and buttons; sentences for prose; American spelling.
- No null/undefined/NaN on the page; every number from the API.
- Patch in place (window.CFP.ui); a full draw only on a stage change (and the hub/stage page switch, which draws from the cached view without a fetch).
- Controls 44 px tall on a phone; at 400 px everything stacks, no sideways scroll.
- Cards in a row: equal heights, tops and bottoms within 1 px; a lone card spans the row.
- `python3 tests/test_sim_golden.py` byte-identical; no engine rule change (view fields only).
- Do not edit web/recruiting.js; the board's wrapper is styled from web/offseason.css under `.off-board`.

## Review Focus

- A save with no AD review, no retention step or no portal recap (old saves): the hub and the recap drop those cards and the remaining card spans the row.
- Nobody leaves / nobody wants out / an empty board: each page still renders its empty sentence.
- A fired coach: the fired note shows and the Staff step still lists the openings.
- The legacy two-round portal (portal_1/portal_2): its table still renders inside the new frame.
- Reloading on a page (hub or stage, a Development tab) lands on the same page.

---

### Task 1: The view's numbers for the recap

**Files:** Modify `coach_career/offseason.py` (`_review`: add `nil_now`, `nil_next`; `view`: add `goal_next` at Ready). Test: `tests/test_offseason_redesign.py` reads them through the API.

- [ ] Add the fields, run `python3 tests/test_sim_golden.py` (unchanged), `python3 tests/test_ad_review.py`, commit.

### Task 2: Browser test first

**Files:** Create `tests/test_offseason_redesign.py`: one finished career, walk every stage at 1280 dark, 1280 light and 400 dark. Per page: stage chip text matches the stage index, exactly one `.off-step.now` and the done count equals the index, the stage's cards show API values, no `null|undefined|NaN`, `scrollWidth <= clientWidth`, Title Case on `.go-kicker, .off-chip, .off-step, .off-tab, #tab-offseason button`, cards in each `.off-g2`/`.off-g21` row aligned within 1 px, Back returns to the hub and Advance moves the stage. Screenshots to the scratchpad `offseason/` folder.

- [ ] Write it, run it, see it fail on the missing selectors.

### Task 3: Frame, hub and Departures

**Files:** `web/offseason.js`, `web/offseason.css`, `web/season.js` (`opage` route key).

- [ ] Header, stepper, chip, footer; hub cards; Departures groups with "+ N more", Around the League, The First Round; Your Roster card kept.

### Task 4: Keep Them Home and the portal weeks

- [ ] Summary strip, leaver cards with Now/Next Year, Why, four action buttons with hint lines and the NIL amount; portal overview bullets, The Answers, Your Moves, the board wrapped (meters first via CSS order).

### Task 5: Development, Staff, Ready

- [ ] Development stats, portal recap +/−, tabs (Redshirts, Position Changes, Who Improved, Your Transfers), Top Improvements; Staff restyled; Ready recap (Key Results, history, The Road Ahead, Start button).

### Task 6: Existing tests and the suite

- [ ] Update selectors in test_offseason_e2e, test_smoothness, test_ux_sweep, test_portal_recap_e2e, test_spacing, test_deep_links (click into the stage from the hub where needed); `python3 tests/run_all.py` green; screenshots; push.
