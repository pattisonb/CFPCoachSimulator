# Headquarters: a recruiting and scouting dashboard the player builds from widgets

Branch `headquarters`. A new career tab beside Recruiting. Nothing is retired: the Recruiting tab stays
as it is, and whether Headquarters replaces it is decided later, once it has proved itself.

## Why

Recruiting and scouting are spread over five tabs (Recruiting, Prospects, Scouting, Classes, Programs),
each a full screen. The player wants one screen they arrange themselves: a blank canvas where they browse
a catalog of recruiting and scouting widgets and add the ones they care about, so each player's
Headquarters fits how they recruit. The player's mockups (red-headed cards in a four-column grid, each
with an optional "View All") set the look.

## Decisions (agreed in brainstorming)

| Question | Decision |
|---|---|
| Where it lives | A new career tab, "Headquarters", right after Recruiting. Recruiting stays. |
| First version | The canvas plus the widgets that need only data the game already has. Widgets that need new systems are registered as Coming Soon and built in later branches. |
| Layout | An ordered grid; each widget Small, Medium or Large; drag to reorder; move buttons on a phone. |
| First open | A blank canvas with a prompt and the catalog drawer open. |
| Catalog | A side drawer (a bottom sheet on a phone), grouped by category, with previews drawn from static sample data. A placed widget shows real career data. |
| Inside a widget | Read and jump, plus light one-tap actions: Add to Board and Send Scout. |
| Build approach | Widgets read the existing endpoints, fetched once per source; one new route pair for the layout and the data no view has yet. It must scale to many more widgets. |

## What

### 1. Files

| File | Holds |
|---|---|
| `web/hq.js` | The canvas, edit mode, the catalog drawer, the source cache, saving the layout. `window.HQ` with `render(season, box, helpers)` and `register(widget)`. |
| `web/hq-widgets/recruiting.js`, `scouting.js`, `program.js`, `planned.js` | One file per widget group; each calls `HQ.register` for its widgets. `planned.js` holds the Coming Soon widgets. |
| `web/hq.css` | The Headquarters styles. |
| `coach_career/headquarters.py` | The layout's shape check and the gap data (commits by week, movers). |
| `app/api.py` | The two routes below. |

`web/season.html` loads the new scripts after `recruiting.js` and adds the tab button; `web/season.js`
adds `"headquarters"` to `CAREER_TABS` after `"recruiting"` and calls `HQ.render` when the tab opens.
The tab follows the career tabs' rules (hidden without a career; shown in the portal and the offseason
like Recruiting).

### 2. The widget contract

Each widget registers one plain object:

```js
HQ.register({
  id: "top-targets",              // stable; saved in layouts; never renamed
  title: "Top Targets",           // Title Case
  category: "recruiting",         // recruiting | scouting | program
  icon: "star",                   // a name from web/icons
  blurb: "Your board's best chances, with where you stand with each.",   // one sentence, for the drawer
  sizes: ["M", "L"], size: "M",   // allowed sizes, default size
  sources: ["board"],             // data sources it reads (section 4)
  sample: { ... },                // static data shaped like its sources, for the drawer preview
  draw(data, ctx) { ... },        // returns the card body element; ctx: size, season, helpers, act
  viewAll: "recruiting",          // optional: the tab (or route token) "View All" opens
  patch(node, data, ctx) { ... }, // optional: update in place after an action; else the card redraws alone
  status: "ready",                // ready | soon
});
```

- **Adding a widget** is one registration in one file. The canvas, drawer, edit mode and saving never change.
- `draw` gets the sources it named, already fetched, keyed by source name. It never fetches.
- **A widget that throws** while drawing shows "Couldn't Load This Widget" in its own card body; the
  rest of the canvas draws. The error goes to the console.
- **A Coming Soon widget** needs only identity, sizes, `sample` and `draw`; building it later flips
  `status`, names its real `sources` and makes `draw` read them.

### 3. The canvas and edit mode

**The grid.** CSS grid: four columns from 1200 px, two from 700 px, one below. Small spans one column,
Medium two, Large the full row; on two columns Medium and Large fill the row; on one column everything
does. Cards flow in saved order (no dense packing: what you arranged is what you see). Cards in a row
share a height; lists show a set number of rows by size (Small 5, Medium 8, Large 12) and "View All"
covers the rest.

**The header.** "Headquarters" as the page title, and two buttons: Add Widget and Edit Layout.

**Edit mode** (Edit Layout on, the button reading Done). Each card gains a drag handle, size chips for
its allowed sizes, Move Earlier and Move Later buttons and a Remove button, each at least 44 px tall.
Dragging uses pointer events with a placeholder where the card will land. On a phone (coarse pointer or
one column) the drag handle hides and the move buttons do the work; the move buttons also serve
keyboard users everywhere. Out of edit mode none of this shows.

**Changes.** Add, remove, resize and move each patch the canvas in place (`ui.fadeIn`, `ui.fadeOut`,
`ui.morph`); only opening the tab draws it whole (the house rule). Remove shows a toast, "Removed Top
Targets." with an Undo button that puts it back where it was. Every change saves automatically, 600 ms
after the last one (`HQ_SAVE_DELAY`); a failed save toasts "Couldn't save your layout." and keeps the
page as it is.

**One of each, for now.** Each widget can be placed once. Every card in the layout still carries its own
instance id, so copies or per-card settings can come later without changing the save format.

**The empty canvas.** One line, "Build your Headquarters. Add widgets for recruiting and scouting.",
and an Add Widget button. The drawer opens by itself the first time the tab opens on an empty layout.

### 4. Data sources

The canvas collects the sources the placed widgets name, fetches each once, and hands each widget its
own. A source no placed widget names is never fetched. Fetched sources are kept for the visit and
dropped on a full redraw (tab open, week advance, career change).

| Source | Endpoint |
|---|---|
| `board` | `GET /api/season/{id}/recruiting` |
| `scouting` | `GET /api/season/{id}/scouting` |
| `programs` | `GET /api/season/{id}/programs` |
| `classes` | `GET /api/season/{id}/classes` |
| `prospects` | `GET /api/season/{id}/prospects` (the Recruit Search widget's own query) |
| `hq` | `GET /api/season/{id}/headquarters` (section 6) |

After an inline action the canvas refetches only the sources that action changes (Add to Board:
`board`, `scouting`, `prospects`; Send Scout: `scouting`, `board`) and patches the widgets that read them.

### 5. The catalog drawer

Add Widget opens it, in or out of edit mode. It slides in from the right on a wide screen and rises as a
bottom sheet on a phone; the canvas stays visible beside it.

- **Header:** "Add Widgets" and a Close button.
- **Category tabs:** All, Recruiting, Scouting, Program. A search box filters by title and blurb.
- **Each entry:** the title, the blurb, a preview card drawn by the widget's own `draw` from its
  `sample`, size chips (the size to add it at) and an Add button.
- **After Add:** the card appears at the end of the canvas, scrolls into view and pulses once
  (`ui.pulse`); the drawer stays open; the entry's button reads "On Your Headquarters", disabled.
  Removing the card turns it back to Add.
- **Coming Soon** entries list after the ready ones in each category, the preview grayed, a "Coming
  Soon" tag, no Add button.
- **Cost:** previews draw from sample data, so the drawer makes no server calls; each preview draws
  when its entry first scrolls into view (`IntersectionObserver`).

### 6. Saving and the Headquarters routes

**Where the layout lives.** `state["career"]["headquarters"] = {"cards": [{"id": "c1", "widget":
"top-targets", "size": "M"}, ...], "next": 2}`. A save without it reads as an empty layout. It is
outside the season sim; the golden test stays byte-identical.

**`GET /api/season/{id}/headquarters`** returns `{"layout": {...}, "commits": [...], "movers": [...]}`.
The gap data is computed only when asked for (`?want=commits,movers`, the canvas passing what its
placed widgets need):

- **`commits`:** your commits by week, from the recruiting log (`state["recruiting"]["log"]`, events
  `commit`, `flip` and `decommit` naming your school): `[{"week": 3, "gained": 2, "lost": 0, "total": 9}]`,
  a row per week played. In the portal, by portal week.
- **`movers`:** from the latest weekly report's rows (your place on his list, `rank`, against
  `prev_rank`): up to 5 risers and 5 fallers by places moved, each shown with the board's standing
  words for where you stand now (`standingCore` on the page: "Clear Favorite", "Close Race", ...) and an
  up or down mark. Never his list position or any other number the player could not know.

**`POST /api/season/{id}/headquarters`** with `{"cards": [...]}` stores the layout and returns it. The
server checks shape, not the widget list:

- `cards` a list of at most 40 (`HQ_MAX_CARDS`, *tune*); each with `id` and `widget` strings of 1-40
  characters from `[a-z0-9-]`, and `size` one of S, M, L; card ids unique.
- An unknown widget id is kept (a newer page and an older save never fight); the page skips widgets it
  does not know.
- A bad layout is a 400 with a plain message; nothing is stored.

Both routes are in `app/api.py`, so the dev server and the in-browser runtime serve them alike.

### 7. The first widgets (ready)

| Widget | Category | Sizes | Sources | Inline actions | View All |
|---|---|---|---|---|---|
| Class at a Glance | Recruiting | S, M | board | | Recruiting |
| Week's Resources | Recruiting | S | board | | Recruiting |
| Top Targets | Recruiting | M, L | board | | Recruiting |
| Class Needs | Recruiting | S, M | board | | Recruiting |
| Visit Schedule | Recruiting | S, M | board | | Recruiting |
| Recent Commits | Recruiting | S, M | board | | Classes (yours) |
| Recruiting Activity | Recruiting | M | board | | Recruiting |
| Commitment Tracker | Recruiting | M | hq | | Recruiting |
| Hot and Cold Movers | Recruiting | M | hq | | Recruiting |
| Class Breakdown | Recruiting | S, M | board | | Classes (yours) |
| Recruiting Rankings | Recruiting | M | classes | | Classes |
| Recruit Search | Recruiting | M, L | prospects | Add to Board, Send Scout | Prospects |
| Scouting Queue | Scouting | M | scouting | Send Scout, Add to Board | Scouting |
| Flags | Scouting | S, M | scouting | Add to Board | Scouting (Flags) |
| Area Scouts | Scouting | M | scouting | | Scouting |
| Program Comparison | Program | M, L | programs | | Programs |

- **Class at a Glance:** commits, open spots, class rank, offers out of the cap.
- **Week's Resources:** hours, NIL and scouting points left this week, as meters.
- **Top Targets:** the board's `targets`, with stars, position and your standing as words over a bar.
- **Class Needs:** `needs_detail`, needed against committed by position.
- **Visit Schedule:** official visits booked with you, by week, "Wk 6 · vs USC".
- **Recent Commits:** your newest commits, with stars and position.
- **Recruiting Activity:** the week's recap and report events as sentences.
- **Commitment Tracker:** commits by week as a small line chart, with the week's change.
- **Hot and Cold Movers:** two short lists, standing words before and now.
- **Class Breakdown:** your commits by stars as a donut, with counts.
- **Recruiting Rankings:** the national top five classes and your row.
- **Recruit Search:** a search box and quick searches (Top 100, In State, Needs at a position);
  results with stars, position and the two actions.
- **Scouting Queue:** the Prospect Database's first page short of a complete report, on your board or not, with Send Scout and Add to Board.
- **Flags:** your staff's flags, with Add to Board for those not on it.
- **Area Scouts:** each area scout's area and this week's looks.
- **Program Comparison:** your program against schools you pick (default: the class rankings' top
  four), by tier, prestige, winning, NIL and Pro Pipeline words.

**Inline actions.** Add to Board calls `POST /board`; Send Scout calls `POST /recruit` with
`action: "scout"`. Each disables its button while busy (`ui.busy`), toasts what happened, and patches
in place. A refusal (no hours, a complete report) toasts the server's message in sentence case.
**Offer stays a link:** an offer needs a pitch and an NIL amount, so "Offer" opens his profile's Recruit
menu. Every recruit name opens his profile (`Recruiting.openProfile`).

### 8. Planned widgets (Coming Soon now, built later)

Registered with sample data so the catalog shows where Headquarters is going. Each needs its own design.

| Widget | Needs |
|---|---|
| Recruiting Tasks | A to-do model: tasks the player adds, and ones the game suggests. |
| Recruiting Goals | Goals for the class (commits, top-100 recruits, a class rank) and their progress. |
| Alerts and Needs Attention | Rules over the board: a target not contacted in weeks, a commit wavering, an unanswered offer. |
| Staff Assignments | Assigning targets to assistants (the career's staff and areas exist already). |
| Scholarship Budget | A scholarship count model beside NIL. |
| Recruiting Calendar | Visits, contact and dead periods by day or week. |
| What-If | A projection of the class rank and needs if a given recruit commits. |
| Senior Impact and Retention | In-season departure risk for your seniors (the offseason knows departures, not risk). |
| Roster Loss Projections | Graduation, transfer, draft and injury losses for next season, as words. |
| Position Battle Board | Starter and top challenger by position, from the depth chart. |
| Offer Efficiency | Offers to visits to commits as a funnel, in counts and words. |
| Board Health | Board prospects by state (active, stale, at risk, unscouted), as words and bars. |

Moods and chances on these stay words, never percentages (house rules).

## Copy

Titles, tags, chips, buttons and column headers are Title Case ("Add Widget", "Edit Layout", "Coming
Soon", "On Your Headquarters", "View All"). Help lines and toasts are sentences. No "null", "undefined"
or "NaN" on the page: an empty widget says why in a sentence ("No official visits booked yet.").

## Testing

- `tests/test_headquarters.py`: save and reload a layout; an old save reads empty; bad layouts refused
  (size, id characters, too many cards, duplicate ids) with nothing stored; unknown widget ids kept;
  `commits` and `movers` on a short career (a few weeks advanced), the commits total matching the board's
  `committed`.
- `tests/test_headquarters_browser.py` (Playwright, the pre-installed browser): open the tab on a new
  career, see the empty canvas and the drawer; add three widgets; resize one; reorder by drag and by the
  move buttons; remove one and Undo; reload and find the same layout. At 1280 px and 400 px wide.
- A widget sweep in the same browser script: every widget drawn from its sample and (ready widgets) from
  live data at every allowed size; the page text never holds "null", "undefined" or "NaN"; every title
  is Title Case.
- `tests/test_spacing.py` and `tests/test_ux_sweep.py` gain the Headquarters tab, its drawer and edit
  mode (the 44 px rule on every control).
- `python3 tests/test_sim_golden.py` byte-identical; `python3 tests/run_all.py` green before each push.
- `docs/HOW_IT_WORKS.md` gains a "Headquarters" section: the contract, the sources, the routes, adding a
  widget.

## Not in this version

Copies of a widget, per-card settings, widgets outside recruiting and scouting, retiring the Recruiting
tab, and every planned widget's own system.
