# Recruiting Board Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Recruiting tab becomes stage tabs with counts over a plain list and one pane where every action lives behind a Recruit menu, with one standing ladder; and a spacing pass fixes button and tag gaps on every Coach Career screen.

**Architecture:** Front-end only. The board half of `web/recruiting.js` (`renderRecruiting` and its helpers) is rewritten around three pieces: a pure `standingOf(b, me)` ladder, a list, and a pane with a Recruit menu and sub-tabs; its styles move to a new `web/recruiting.css`. The spacing pass changes layout rules in `web/styles.css` and `web/offseason.css` only, so the two tasks touch disjoint files and run in parallel in separate worktrees. The API and game logic do not change (`b.list` rows already carry `offered`).

**Tech Stack:** vanilla JS (`window.CFP.el`), CSS, Playwright tests over `tools/dev_server.py` (Chromium at `/opt/pw-browsers/chromium`).

**Spec:** `docs/superpowers/specs/2026-10-29-recruiting-board-redesign.md`

## Global Constraints

- No change under `sim/`, `engine/`, `coach_career/`, `teamdata/`, `app/`; `python tests/test_sim_golden.py` passes at every commit.
- Every `/api/...` call the board makes today keeps its path and body (`/recruiting`, `/recruit` with `{pid, action, pitch, nil, scene}`, `/board`, `/prospect/{pid}`, `/settings`).
- Six list words exactly: `Yours`, `Lost`, `Favorite`, `In it`, `Long shot`, `Not offered` (spec section 5 table, with its thresholds: Close race when your bar is within 0.1 of the leader's; Behind, in the picture when bar ≥ 0.15; a flip "could still" when chance ≥ 0.3, "looks unlikely" when the high end < 0.1).
- Recruit menu items and reasons exactly as the spec's table in section 4; Message and Offer open the inline pitch step; calls and visits play as scenes with the pitch inside the scene.
- Spacing rules (spec section 9): button containers `display: flex; flex-wrap: wrap; gap: 8px 10px` with no margins on buttons; tag containers `gap: 6px`; a tag row has `margin-block: 10px` when it follows text or precedes buttons; cards keep ≥ 12 px padding; buttons ≥ 36 px tall on desktop, ≥ 44 px on a phone (≤ 759 px); segment controls are the one exception.
- Every URL in `web/` stays relative (`tests/test_web_urls.py`); the dark look stays; no new dependencies.
- Parallel work: Task 1 owns `web/recruiting.js`, `web/recruiting.css` (new), the stylesheet link in `web/index.html`, `tests/test_ux_sweep.py`'s recruiting sections and `tests/test_recruiting_standing.py`. Task 2 owns `web/styles.css`, `web/offseason.css` and `tests/test_spacing.py`. Neither touches the other's files; Task 2 does not style `.go-board`, `.go-list`, `.go-pane` or anything the new board introduces (those live in `recruiting.css`).
- Commits carry the session's two attribution trailer lines; no model identifiers in code or commits.

## Review Focus

1. **A recruit with an open call whose week has passed** (the scene is stale): the menu must not lock forever; "Finish the call" must re-fetch and, on a 409, drop the scene. Pinned in Task 1 (`test_stale_scene_unlocks` in the sweep's recruiting section).
2. **Keyboard use**: arrow keys move the list selection and the Recruit menu is operable by keyboard (Enter opens, arrows move, Escape closes). Pinned in Task 1 (sweep assertions).
3. **A phone user mid-scene rotating or resizing**: the pane sheet must survive a `matchMedia` change without losing the scene. Pinned in Task 1 (sweep: resize while a scene is open, the scene is still there).
4. **Long names and ten-school lists**: the list row and the stat strip must not overflow at 400 px. Pinned in Task 2's spacing test (no overlapping bounding boxes) and Task 1's screenshots.
5. **Tags that wrap to two lines** on narrow cards: the 6 px gap must hold between rows too (`gap` sets both axes). Pinned in Task 2 (`test_spacing.py` checks vertical gaps on wrapped tag rows).

---

### Task 1: The board: ladder, list, pane with the Recruit menu

**Files:**
- Modify: `web/recruiting.js` (`standing()` at ~97, `race()` at ~412, the whole board from the `COLUMNS` comment at ~385 through the end of `renderRecruiting` at ~828; `openProfile` keeps its `(s, pid, into)` signature)
- Create: `web/recruiting.css` (every rule for the new board; the old `.go-board`/`.go-pipeline`/`.go-col`/`.go-pcard`/`.go-pane` rules in `web/styles.css:1095-1142` are left in place for Task 3 to delete, so this task does not touch `styles.css`)
- Modify: `web/index.html` (add `<link rel="stylesheet" href="./recruiting.css" />` after `offseason.css`)
- Modify: `tests/test_ux_sweep.py` (the "Recruiting board" section, ~lines 131-234, and the "finished career's board" section that follows; every selector naming `.go-col`, `.go-pcard`, `.go-pane .go-act`, `.go-pitch`, `.go-col-head`)
- Create: `tests/test_recruiting_standing.py`

**Interfaces:**
- Produces `standingOf(b, me) -> {word, text, odds, tone, fill, lo, hi}` in `web/recruiting.js`, exposed as `window.CFP.recruiting = { standingOf }`. Inputs used: `b.signed`, `b.committed`, `b.hard`, `b.offered`, `b.list` (rows `{school, name, offered, bar, rank, pct}`; your row has `school === me`), `b.standing.pct/lo/hi/certainty` (for `fill`, the range and flip odds). `word` is one of the six; `tone` one of `good | warn | muted | bad`.
- DOM contract (the sweep and spacing tests rely on it): stage tabs `.go-stages button[data-stage]` with the count in `b`; search `#rc-search`; list `.go-list` with rows `.go-row-recruit[data-pid]` (`aria-pressed`), each holding `.go-standing-word`; pane `.go-pane` (`.sheet` on a phone, `role=dialog`) with `.go-pane-head`, the status chip `.go-chip`, the primary button `#rc-recruit` opening `.go-menu[role=menu]` with `.go-menu-item[data-action]` (`disabled` + `.go-menu-why` text when unavailable), the inline step `.go-step` with `select#rc-pitch`, `input#rc-nil`, `button.go-step-go`, `button.go-step-cancel`; the stat strip `.go-strip` with four `.go-stat`; tags `.go-tags`; sub-tabs `.go-subtabs button[data-sub]` for `overview | scouting | profile | history` and the body `.go-sub-body`; the scene keeps `.go-scene`, `.go-scene-line.cue`, `.go-pitch`, `button:has-text('Pitch')`, `.go-reaction[data-kind]`, `Hang up`; the open-call head button `#rc-finish`.
- Consumes: `H.api`, `H.postJSON`, `H.toast`, `H.errText`, `H.onChange`, `act()`, `setBoard()`, `openProfile(s, pid, into)`, `mapCard()`, `needsStrip()`, `meter()`, `avatar()`, `badges()`, `scoutLine()`, `pitchPicker()` (scenes only), `sceneView()`, `reactionView()`.

- [ ] **Step 1: Write the failing ladder test**

```python
# tests/test_recruiting_standing.py: dev server + Playwright; open index.html; evaluate window.CFP.recruiting.standingOf on rows.
ME = "smu"
def row(school, bar, offered, rank): return {"school": school, "name": school, "offered": offered, "bar": bar, "rank": rank, "pct": None}
CASES = [  # (b, expected word, text contains, tone)
    ({"committed": ME, "hard": False, "list": []}, "Yours", "Verbal commit to you", "good"),
    ({"signed": "georgia", "list": []}, "Lost", "Signed · Georgia", "bad"),
    ({"committed": "georgia", "hard": True, "list": []}, "Lost", "Hard commit · Georgia", "bad"),
    ({"committed": "georgia", "standing": {"pct": 0.35, "lo": 0.2, "hi": 0.5}, "list": []}, "In it", "Verbal commit · Georgia", "warn"),
    ({"committed": "georgia", "standing": {"pct": 0.1, "lo": 0.0, "hi": 0.2}, "list": []}, "Long shot", "Verbal commit · Georgia", "warn"),
    ({"offered": True, "standing": {"pct": 0.6}, "list": [row(ME, 1.0, True, 1), row("georgia", 0.5, True, 2)]}, "Favorite", "Leading his list", "good"),
    ({"offered": False, "list": [row(ME, 1.0, False, 1), row("georgia", 0.7, True, 2)]}, "Not offered", "He would pick you today", "warn"),
    ({"offered": True, "standing": {"pct": 0.3}, "list": [row("georgia", 1.0, True, 1), row(ME, 0.95, True, 2)]}, "In it", "2nd on his list · Georgia leads", "warn"),
    ({"offered": True, "standing": {"pct": 0.2}, "list": [row("georgia", 1.0, True, 1), row(ME, 0.3, True, 2)]}, "In it", "2nd on his list", "muted"),
    ({"offered": True, "standing": {"pct": 0.05}, "list": [row("georgia", 1.0, True, 1), row(ME, 0.1, True, 2)]}, "Long shot", "2nd on his list", "muted"),
    ({"offered": False, "list": [row("georgia", 1.0, True, 1), row(ME, 0.4, False, 3)]}, "Not offered", "3rd on his list · not offered", "muted"),
    ({"offered": False, "list": [row("georgia", 1.0, True, 1)]}, "Not offered", "Not on his list yet", "muted"),
]
# the odds words: Favorite → "Clear favorite"/"Narrow favorite"; you lead unoffered → "Offer him"; unoffered on list → "Offer to be in it"
```

Team names come from `window.CFP.teamsBySlug` (the page loads them); use real slugs (`georgia`, `smu`).

- [ ] **Step 2: Run it to verify it fails**

Run: `python3 tests/test_recruiting_standing.py`
Expected: `window.CFP.recruiting` is undefined.

- [ ] **Step 3: Implement `standingOf` and switch `standing()`'s callers to it; make `race()` draw hollow pills for lanes with `offered === false` (`.go-race-pill.unoffered`, title "no offer")**

- [ ] **Step 4: Run the ladder test to verify it passes**

Run: `python3 tests/test_recruiting_standing.py`
Expected: `ok`.

- [ ] **Step 5: Rewrite the sweep's recruiting sections to the new DOM contract (they fail now)**

Assertions the rewritten section makes: tab counts sum to `v.board.length`; clicking a tab filters the list; `#rc-search` narrows the list live; clicking a row fills `.go-pane` and the chip reads his stage; `#rc-recruit` opens `.go-menu` with nine items, the disabled ones carrying `.go-menu-why`; Message opens `.go-step` with `select#rc-pitch` whose first option is his known priority, `Send` posts and the step closes; Call plays `.go-scene` with a `.cue` line, the cue marks a `.go-pitch` tag `Heard`, `Pitch` shows `.go-reaction`; while another recruit's call is open the menu items are disabled with "Finish your call first" and `#rc-finish` shows; `Hang up` closes the scene and `#rc-finish` stays; arrow keys move `aria-pressed` down the list; a stale scene (advance the week through the API, then `#rc-finish`) drops the scene and re-enables the menu (`test_stale_scene_unlocks`); the phone sheet opens from a row and closes on its back button, and a resize from 400 to 1280 px while a scene is open keeps `.go-scene`; the map's state tap filters the list rows; the finished career's Committed tab holds yours (menu absent) and the ones you lost (menu absent, chip says Signed · X). Screenshots at 1280/400, light/dark, of the board, the pane, the menu open, the pitch step and a scene into a temp folder, looked at by the implementer and described in the report (not committed).

- [ ] **Step 6: Implement the board per spec sections 2, 3, 4, 6 and 7 in `web/recruiting.js` + `web/recruiting.css`; link the stylesheet**

Keep `COLUMNS` as the stage definition; `columnOf(b)` decides the tab. The view state gains `stage`, `search`, `sub`, `needsOpen`. The Recruit menu is a popover positioned under `#rc-recruit` (bottom sheet on a phone), closed on Escape, outside click, or an item. The inline step replaces the old offer/raise rows and the always-open pitch list. The History sub-tab shows this season's recap events for him (`v.recap` filtered to his id, newest first) and "Contacts this week: …" from `b.done_this_week`; the view carries no per-action contact log and the API does not change.

- [ ] **Step 7: Run the sweep, the ladder test, the career e2e and the URL test**

Run: `python3 tests/test_ux_sweep.py && python3 tests/test_recruiting_standing.py && python3 tests/test_career_e2e.py && python3 tests/test_web_urls.py && python3 tests/test_sim_golden.py`
Expected: all exit 0.

- [ ] **Step 8: Commit**

```bash
git add web/recruiting.js web/recruiting.css web/index.html tests/test_ux_sweep.py tests/test_recruiting_standing.py
git commit -m "Recruiting board: stage tabs, a list, one pane with the Recruit menu, one standing ladder"
```

---

### Task 2: The spacing pass over every screen

**Files:**
- Modify: `web/styles.css`, `web/offseason.css` (layout rules only; no change to the old board rules at `styles.css:1095-1142`, which Task 3 deletes)
- Create: `tests/test_spacing.py`

**Interfaces:**
- Produces the rules of spec section 9 as shared classes: `.go-row`, `.go-actions`, `.go-scene-acts`, `.off-cands`, and every other container of two or more `.go-btn`/`.go-act`/`button.accent|ghost` get `display: flex; flex-wrap: wrap; gap: 8px 10px; align-items: center`; `.go-tags`, `.go-badges` and the depth chart's and profile's tag rows get `display: flex; flex-wrap: wrap; gap: 6px` and `margin-block: 10px` where they follow text or precede buttons; buttons lose per-element margins; `min-height: 36px` on `.go-btn, .go-act, button.accent, button.ghost` and `44px` under `@media (max-width: 759px)`; `.go-seg` is excluded.
- Consumes nothing from Task 1; runs against the current board too.

- [ ] **Step 1: Write the failing spacing test**

```python
# tests/test_spacing.py: dev server + Playwright, two careers (a mid-season one on its Office and a finished one in its offseason, as the sweep builds them), viewports 1280 and 400.
SCREENS = [("office", ".go-office"), ("recruiting", ".go-pane, .go-pipeline"), ("prospects", "#tab-prospects table, #tab-prospects .go-card"), ("staff", "#tab-staff"), ("classes", "#tab-classes"),
           ("depth", "#tab-depth"), ("schedule", "#tab-schedule"), ("summary", "#tab-summary"), ("offseason", "#tab-offseason")]   # plus each offseason stage reached through /offseason/advance, and index.html's Seasons list and coach.html
JS = """() => { const bad = [];
  const groups = [...document.querySelectorAll('*')].filter(e => { const kids = [...e.children].filter(c => c.matches('button, .go-tag, .go-badge, .go-word, .go-chip')); return kids.length >= 2 && !e.closest('.go-seg, .go-stages, .go-subtabs, nav.tabs'); });
  for (const g of groups) { const kids = [...g.children].filter(c => c.matches('button, .go-tag, .go-badge, .go-word, .go-chip') && c.offsetParent);
    const isTag = kids.every(k => !k.matches('button')); const need = isTag ? 6 : 8;
    const rects = kids.map(k => k.getBoundingClientRect());
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) { const a = rects[i], b = rects[j];
      const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const sameRow = Math.abs(a.top - b.top) < Math.min(a.height, b.height) / 2;
      const gap = sameRow ? Math.max(b.left - a.right, a.left - b.right) : Math.max(b.top - a.bottom, a.top - b.bottom);
      if (overlap || gap < need - 0.5) bad.push({screen: SCREEN, el: g.className || g.tagName, gap: Math.round(gap), overlap}); } }
  return bad; }"""
def test_no_cramped_buttons_or_tags(): ... assert not bad, bad[:20]
def test_touch_targets_on_phone(): ...  # every visible button on the 400 px screens has height >= 44 (segments excepted)
```

- [ ] **Step 2: Run it to verify it fails (it lists the current offenders by screen and container)**

Run: `python3 tests/test_spacing.py`
Expected: FAIL with a list of containers and gaps.

- [ ] **Step 3: Fix the rules in `web/styles.css` and `web/offseason.css` (shared classes first; a container the shared classes miss gets the class rather than a one-off rule), take the screenshots listed in spec section 9 into a temp folder, and look at each one (describe what was wrong and what changed in the report; the files are not committed)**

- [ ] **Step 4: Run the spacing test, the sweep (unchanged screens must still pass), the offseason e2e and the golden test**

Run: `python3 tests/test_spacing.py && python3 tests/test_ux_sweep.py && python3 tests/test_offseason_e2e.py && python3 tests/test_sim_golden.py`
Expected: all exit 0 (the sweep's recruiting section is still the old one in this worktree; it passes against the old board).

- [ ] **Step 5: Commit**

```bash
git add web/styles.css web/offseason.css tests/test_spacing.py
git commit -m "Spacing pass: consistent gaps for buttons and tags on every Coach Career screen"
```

---

### Task 3: Integrate, remove the old board rules, docs, full suite

**Files:**
- Modify: `web/styles.css` (delete the old board rules: `.go-board`, `.go-pipe`, `.go-col-seg`, `.go-pipeline`, `.go-col*`, `.go-pcard*`, `.go-add`, the old `.go-pane*` rules now superseded by `recruiting.css`; keep anything the pane still uses that `recruiting.css` does not redefine), `docs/HOW_IT_WORKS.md` (the Recruiting tab paragraph at ~1085: the board is stage tabs, a list and a pane; the Recruit menu; the standing ladder; the spacing rules in one line), `tests/test_spacing.py` (add the new board's screens: the pane, the menu open, the pitch step)
- Depends on: Tasks 1 and 2 merged into one tree.

- [ ] **Step 1: Merge both task branches; resolve nothing by hand except `web/index.html` if both touched it (they should not)**

- [ ] **Step 2: Run the spacing test on the merged tree; it now walks the new board too**

Run: `python3 tests/test_spacing.py`
Expected: passes, or lists the new board's offenders, which are fixed in `web/recruiting.css`.

- [ ] **Step 3: Delete the superseded rules from `web/styles.css`; grep `web/` for `go-pcard|go-pipeline|go-col\b` to confirm nothing references them**

- [ ] **Step 4: Update `docs/HOW_IT_WORKS.md`**

- [ ] **Step 5: Run the whole suite**

Run: `python3 tests/run_all.py`
Expected: every test PASS.

- [ ] **Step 6: Commit**

```bash
git add web/styles.css web/recruiting.css tests/test_spacing.py docs/HOW_IT_WORKS.md
git commit -m "Recruiting board: drop the old column rules; docs"
```
