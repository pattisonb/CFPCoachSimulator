# Recruiting board redesign: a list, one pane, one menu

Status: approved 2026-10-29 (sections 1-8 by the player; section 9 added at the player's request). A front-end change to the Recruiting tab (`web/recruiting.js`, its
rules in `web/styles.css`); no API or game-logic change. Follows the recruiting experience spec
(`2026-10-28-recruiting-experience-design.md`), which this replaces for the board's layout; the
Prospects, Staff and Classes tabs, the scenes, the map and the word grades stay as they are.

## 1. Why

The board shows too much at once. Five columns of cards each carry badges, a standing bar, a
"Heard" tag and sometimes a button; the pane beside them repeats the badges and adds five action
buttons, the whole pitch list with a paragraph of explanation, the NIL offer row with another,
his list, the scout line and a tools row. Most of it is there for an interaction the player is
not having. The player asked for the shape of a recruitment tracker: stages as tabs with counts,
a plain list, and one detail pane where everything about a recruit, and every action on him,
lives; options such as the pitch appear only at the moment they are needed.

A second confusion: the pane ranks you two ways. His list (the race) ranks every school by pull,
and you can be first on it. The standing line ranks only the schools that have offered, so a
player who leads his list without an offer reads "Not offered · Georgia leads" beside a race that
shows them at number one.

## 2. The board

**Header**, one row: the title (RECRUITING BOARD, or TRANSFER PORTAL · WEEK n OF m), the four
meters (Hours, NIL points, Offers, Commits) and the Auto-recruit switch. Unchanged content, one
row.

**Stage row**: tabs with counts, `All (n)` first, then `Cold`, `In touch`, `Top 8`, `Visited`
(`Campus visit` in the portal), `Committed`. A recruit's tab is `columnOf(b)` today: a commitment
or a signature anywhere puts him under Committed; otherwise his stage with you. The tab filters
the list; the choice is kept per career in the view state. To the right of the tabs: a search box
(matches name, position, hometown state, case-insensitive, live) and the sort (your chance,
national rank).

**Needs**: the needs strip becomes a disclosure, `Needs ▾`, closed by default; open, it shows the
same position chips it shows today, and a chip filters the list to that group. Its open state is
kept on the device as the map's is.

**Map**: unchanged, the toggle above the list.

**News**: the ticker leaves the board. The Office already carries the week's recruiting news.

**Two panels** below: the list (left, 320 px on a desktop) and the pane (right, the rest). The
pane is sticky as it is today.

## 3. The list

One row per recruit in the chosen tab, in sort order:

- avatar (small), name; under the name one muted line: `★★★★ WR · TX` (portal: `WR · JR · from
  Baylor`);
- on the right, one word of standing in its tone: `Favorite`, `In it`, `Long shot`, `Yours`,
  `Lost`, `Not offered` (section 5 defines these);
- a small green or red dot before the name when `stage_move` is up or down this week (title:
  "Moved up this week" / "Slipped back this week");
- nothing else: no badges, bars, tags or buttons.

The selected row is highlighted. The row is a button (`aria-pressed`); arrow keys move the
selection within the list; Enter opens the pane on a phone. When the list is empty: the empty
state the board has today (`YOUR BOARD IS EMPTY`, Find prospects). A filtered tab with nobody in
it says "Nobody here yet." and keeps the tabs.

## 4. The pane

The only place anything happens to a recruit.

**Head**: avatar; name (a button that opens the Profile sub-tab); `★★★★ WR · Katy, TX · #212`
(portal: `WR · JR · from Baylor · #31 in the portal`); a status chip: his stage with you (`Cold`,
`In touch`, `Top 8`, `Visited`) or `Verbal commit · Georgia`, `Hard commit · Georgia`, `Signed ·
Georgia`, `Committed to you`, `Signed with you`. Right of the head, the primary button
**Recruit ▾**.

**Recruit menu** (a popover under the button; Escape or a click outside closes it): every action
with its cost or the reason it is unavailable, disabled items grayed with the reason as their
second line:

| Item | Cost line | Unavailable when (reason text) |
|---|---|---|
| Message | 5h | done this week ("Once a week"); not enough hours |
| Call | 15h | done this week; not enough hours |
| HC visit | 30h | within 4 weeks of the last ("Monthly"); not enough hours |
| Scout | 5h, `n/3` | 3 looks ("Scouted") |
| Official visit / Campus visit | 10h | not offered; not in his top group ("Not yet: get into his top group"); already booked or done |
| Offer… | no hours | already offered; hard commit elsewhere; signed |
| Raise NIL… | no hours | not offered |
| Pull offer | | not offered |
| Off the board | | |

While a call or visit of his is open, every item but Finish is disabled with "Finish your call
first"; the head shows one button, `Finish the call` / `Finish the visit`, in the primary
button's place.

**Message** and **Offer…** open a step inline under the head (the menu closes): a pitch dropdown
(`<select>`): his known priorities first, each labeled `Playing time · Priority · Strong`, then
the rest labeled with your program's case (`Prestige · Weak`), with the cue from a scene this
week labeled `Heard`; the default is his first known priority. Offer adds the NIL points field
with his ask (`wants 120` / `wants about 90–150`) and one line: "Under half of what he wants reads
as a lowball." A confirm button (`Send`, `Offer`) and Cancel. Raise NIL… opens the same step
without the pitch. A call or in-home visit plays as a scene in the pane as today, with the pitch
chosen inside the scene (the scene's radios stay: they are the moment the choice matters).

**Stat strip** under the head, four cells: `Your chance` (the odds word from section 5), `His
list` (`#2 of 6` or `Not on it`), `NIL` (`your 120 · wants 150`, `wants about 90–150`, or `—`),
`Scouted` (`2 of 3 looks` or `Not yet`).

**Tags**, only what is known: his priorities you have learned (`★ Playing time`), `Heard:
Prestige` this week, `Visit wk 9` / `Visited`, `Offered · 120 NIL`, `Cooled`, `Need 2` / `Full`,
`Gem` / `Bust risk` / Generational, portal role (`Would start`). No "3 more to learn" filler.

**Sub-tabs** (a tab strip; the choice is remembered in the view state across recruits):

- **Overview**: the standing sentence and odds (section 5), the bar with its range, then his
  list as the race.
- **Scouting**: the word grades with their ranges, looks, the scout line and the comps as the
  Profile shows them today (moved here from the profile's scouting half).
- **Profile**: the full profile drawn inline through `openProfile(s, pid, into)` with `into` the
  tab body; the modal goes.
- **History**: this season's contacts with him (week, action, pitch, his reaction where there was
  one) and his recap events (offers, commitments, flips) newest first.

## 5. One ladder: standing read from his list

The standing shown anywhere (list word, stat strip, Overview sentence) is read from his list
rank, with the offer as the qualifier. The list words are exactly six: Yours, Lost, Favorite,
In it, Long shot, Not offered. `st.place`/`st.of`/`st.leader` (the offer race) are no
longer used for the words; `b.list` (rank, bar, you) and `b.offered` are.

| Situation | List word | Overview sentence | Odds word | Tone |
|---|---|---|---|---|
| committed or signed to you | Yours | Verbal commit to you / Hard commit to you / Signed with you | | good |
| committed or signed elsewhere, cannot flip | Lost | Signed · Georgia / Hard commit · Georgia | Locked in | bad |
| verbal elsewhere, could flip | In it (chance ≥ 0.3) or Long shot | Verbal commit · Georgia | He could still flip to you / A flip is a long shot / A flip looks unlikely (high end under 0.1) | warn |
| you lead his list, offered | Favorite | Leading his list, offered | Clear favorite / Narrow favorite (as today's thresholds) | good |
| you lead his list, not offered | Not offered | He would pick you today: he has no offer from you | Offer him | warn |
| on his list, not first, offered | In it or Long shot | 2nd on his list · Georgia leads | Close race (your bar within 0.1 of the leader's) / Behind, in the picture (bar ≥ 0.15) / Long shot (below) | warn for Close race, else muted |
| on his list, not offered | Not offered | 3rd on his list · not offered | Offer to be in it | muted |
| not on his list | Not offered | Not on his list yet | | muted |

The race marks the offer state so the two agree: a lane whose school has not offered draws its
pill hollow (outline in the school's color, no fill) with "no offer" in its title; yours is
ringed as today. `b.list` rows need an `offered` flag: the view already knows every school's
offers (`rc["offers"]`); `prospects.py` adds `offered: bool` to each list row. This is the one
Python change, additive, in the board view only.

## 6. Phone (≤ 759 px)

The list fills the width. Tapping a row opens the pane full-screen (`role="dialog"`) with a back
button in its head; Escape or Back returns to the list with the row focused. The Recruit menu
becomes a bottom sheet of the same items. The stage row scrolls horizontally.

## 7. What goes away

The five columns, the cards and their badges/bars/Finish buttons, the always-open pitch radio
list and its paragraph, the offer row's paragraph, the tools row, the news ticker on the board,
the profile modal (the profile is a sub-tab). `COLUMNS` stays as the stage definition.

## 8. Tests

- `tests/test_ux_sweep.py`'s recruiting section is rewritten for the new structure: the stage
  tabs and their counts sum to the board; picking a row fills the pane; the Recruit menu lists the
  items and grays the right ones; Message opens the pitch step and sends; Call plays the scene,
  its cue marks a pitch, the reaction shows, the list row keeps nothing but the word; a second
  recruit's open call disables the menu; the phone sheet opens and closes; the state filter from
  the map filters the list.
- `tests/test_career_e2e.py`'s recruiting steps use the new selectors.
- The ladder is one pure helper in `web/recruiting.js`, `standingOf(b, me)`, exposed as
  `window.CFP.recruiting.standingOf` for tests. `tests/test_recruiting_standing.py` opens the
  career page through the dev server with Playwright and evaluates the helper on hand-built rows
  (one per row of the table in section 5), asserting the list word, the sentence and the tone.
- Screenshots of the new board at 1280 and 400 px, light and dark, into the UX sweep's folder.

## 9. Spacing pass: buttons and tags everywhere

Buttons and tags sit too close together on several screens (the player's words: "random buttons
and tags that don't have enough spacing"). One pass over every Coach Career screen fixes the
rules, not individual spots:

- **Rules in `web/styles.css` and `web/offseason.css`**: every container of inline buttons
  (`.go-row`, `.go-actions`, `.go-scene-acts`, `.off-cands`, `.go-filterbar .go-row`, the Office
  cards' action rows, the offseason stage cards' button rows) lays out with `display: flex; flex-
  wrap: wrap; gap: 8px 10px`, never margins on the buttons; every tag container (`.go-tags`,
  `.go-badges`, the depth chart's and profile's tag rows) uses `gap: 6px`; a tag row that follows
  text or precedes a button row has 10 px above and below (`margin-block`); a button or tag never
  touches a card edge (cards keep at least 12 px padding); buttons keep a 36 px minimum height on
  desktop and 44 px on a phone; a segment control's buttons touch each other by design and are the
  one exception.
- **Recorded exceptions**: the depth chart's small ★ ▲ ▼ and Redshirt controls stay 28 px tall,
  since 44 px controls would double the width of the depth cells and wrap them. The week strip and
  inline text links keep their own heights: the strip is navigation, like a segment control, and a
  link inside running text sizes with the text.
- **Audit**: screenshots at 1280 and 400 px, light and dark, of the Office, Recruiting (new
  board, pane, menu open, pitch step, scene), Prospects, Staff, Classes, each offseason stage
  (departures, portal, development, staff, review, carousel, ready), Depth chart, Schedule,
  Summary, the Seasons list and Your coach, saved under the UX sweep's folder; each screen is
  checked against the rules above and any stray margin or missing gap fixed in the stylesheet.
- **Test**: `tests/test_spacing.py` (Playwright, dev server) walks the same screens and, for every
  container holding two or more buttons or two or more tags, asserts the computed gap between
  adjacent children is at least 6 px for tags and 8 px for buttons, and that no button or tag
  overlaps another (bounding boxes). Failures name the screen and the container.

## 10. Out of scope

A light theme; changes to recruiting rules, costs or the API beyond the `offered` flag on list
rows; the Prospects, Staff and Classes tabs; the Office.
