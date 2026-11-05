# Recruit Profile Overhaul

Status: design approved in conversation, 2026-11-04 ("yes do it, popup too"). One pull request, held for the player's preview. Built after recruit variety part 3 (Twists and Commit Style) lands, on top of it.

## Why

The recruit pane's profile reads as a pile of chips and lines: ratings as chip pairs that wrap, traits in a loose line, an evaluation that repeats its own labels ("Upside: Big upside"), a comp shown beside "our comp once his report is complete", and a header that says EDGE while the evaluation says DT. The player supplied a mockup (a hero header, three cards, a progress strip) and wants the pane and the Prospect Profile popup rebuilt to it.

## Scope

- The board's pane (beside the list) and the Prospect Profile popup (class rankings, Scouting's All Reports) render one shared profile view.
- No engine rule changes. API additions only where the view needs a value the page cannot derive (below).
- Not in scope: the board list, the Scouting tab, the scene window, the mock's photo and mountain background.

## Layout

### Header

| Left | Right |
|---|---|
| Avatar, name, ☆ watch star; stars and "5-Star Prospect"; Position · Height · Weight · Hometown | Nat. Rank, Pos. Rank (with the position under it), Class; a Potential badge (the scouted word and the range's top, e.g. "Elite" over "All-American"; "Not Known Yet" before any look); the Recruit ▾ button (pane only) |

- Position is `ea_position` mapped to its display (EDGE, DT, …) everywhere on the profile, the evaluation and the comp included. Fixes the EDGE/DT mismatch.
- Height as feet and inches (6'5"), weight in lbs.
- Pos. Rank: his rank among the class at his `ea_position`, by the same order as Nat. Rank.

### Tabs

Overview · Scouting · Recruitment · History.
- **Overview** is new (the cards below).
- **Recruitment** holds today's Overview content (his list, offers, NIL, visits, actions) unchanged.
- Scouting and History unchanged.
- The pane opens on Overview; deep links that name the old `overview` sub-tab open Recruitment, `profile` opens Overview.
- The popup shows the same tabs except Recruitment's actions (it has no Recruit menu), as it does today.

### Overview cards

1. **Scouting Report**: the potential headline ("Elite – All-American"); a 2–3 sentence verdict built from his reads and his real position (one opening line, one strength sentence, one concern sentence); **Strengths** (+, his best two or three reads) and **Areas to Develop** (–, his weakest one to three, only those below Solid; "None Stand Out" otherwise). No line repeats its label.
2. **Attributes**: Athleticism, Football IQ, Technique, Size / Strength, Coachability. Each a bar at the read's midpoint with the word at the right. An uncertain read (its range spans two words) shows the range as a lighter band on the bar and "Solid – Strong". Colors: Strong and up green, Solid and Fair yellow, Weak and below red, from theme tokens.
3. **Recruitment**: Your Standing (his list rank, or "Not on His List"), His Ask ("He Wants About 30–50"), Interest chip, Need chip; Who Decides, Cares About (the decider's topic); Personality, His Story, Commit Style. An unknown trait shows "Not Known Yet" and, as a muted sentence, how it is revealed (first call, complete report, official visit).

Before any look: the Scouting Report shows "Send a scout to read him." and the Attributes card shows the bars empty with "Not Scouted".

### Bottom strip

Scouting Progress: "2 of 3 Looks" and a bar; the one-line evaluation; once the report is complete, "Comp: Name, School (Pos, OVR)". The comp appears once, never beside a "once complete" line.

### Width

CSS grid: three cards across when the pane is wide enough (each at least 300 px), then two, then one; the header's right block wraps under the left on a narrow pane; at 400 px everything stacks. No sideways scroll.

## Data

- `prospects.profile` gains (if missing): `pos_rank`, `height`, `weight`, `display_pos`, a `verdict` (sentences) and `strengths`/`develop` lists built server-side from reads, and the traits' reveal hints. Reads stay viewer-scoped (no truth leaks: built from `our_grades`, never `truth`).
- Recruit variety's discovery, story and commit style values are read as they are.

## House Rules

Title Case labels, tags and kickers; sentences for the verdict and hints; American spelling; no "null", "undefined" or numbers out of 100 for moods; patch in place (a sub-tab switch or an action redraws only what changed); controls 44 px tall on a phone; light and dark themes.

## Testing

- `tests/test_profile_overhaul.py` (browser, 1280 and 400, light and dark): header fields, the position matches across header, verdict and comp; three cards then stacked; Overview bars and words; an unscouted recruit; a complete report shows the comp once; the popup renders the same view; no sideways scroll; Title Case on every label.
- Unit: `pos_rank`, height and weight formatting, verdict/strengths built from reads only.
- Existing gates pass: `test_ux_sweep`, `test_spacing`, `test_smoothness`, `test_deep_links`, `test_profile_compact` (updated for the new layout), `test_persona_ui`, `test_story_ui`, the part 3 UI test, and `python3 tests/run_all.py`. Golden digests untouched.
- Screenshots at 1280 and 400, both themes, for the preview message.

## Addendum (2026-11-04): the whole board, and the Scouting Center

The player sent a full Recruiting board redesign (board-overview.webp, board-scouting-history.webp, then board.html and scouting.html as the rendered reference). It supersedes the Overview/Recruitment split above; everything else above still holds (the EDGE/DT fix, reads from the viewer only, Title Case, patch in place, 44 px controls, golden digests untouched).

### Board page

- **Header:** "Recruiting Board", then five budget meters (a value and a thin bar each): Recruiting Hours, NIL Points, Offers (used of max), Commits (of spots), Scouting Points. On the right, Auto-Recruit as the segmented Off / This Week / All Season control, unchanged in behavior.
- **List card (left):** the stage chips with counts (All, Cold, In Touch, Top 8, Visited, Committed), the search and the sort, Needs ▾; each row an avatar, name, stars, Pos · State and his real standing word as a chip. The selected row is outlined; sort, the ladder and the keyboard are as before. The list card and the pane line up at the top.
- **Pane header:** the hero: his status chip, avatar, name, stars, Pos | Height | Weight, Hometown · #rank; Nat. Rank, Pos. Rank, Class; a **Your Chance** badge in words with a bar (the Potential badge moves to the Scouting tab). Recruit ▾ and the ☆ watch star sit on the tab row's right.
- **Tabs: Overview · Scouting · Profile · History.** Deep links keep their keys: overview, scouting, profile, history.
  - Overview: Recruiting Battle (his list as ranked rows: team pill, name, bar, standing word; yours highlighted "(Your School)") and Recruit Snapshot (Your Offer, His List, Scouted; Priorities, a bar only for the ones you know, "Not Known Yet" otherwise; His Ask; the standing sentence and odds; the tags) side by side; the Scout's Summary across the full width (verdict, Strengths, Areas to Develop in three columns).
  - Scouting: the Scouting Report (looks pips, Potential headline, verdict, lists, the comp once complete, Send a Scout) and Attributes (Scouted Range) side by side; Looks & Uncertainty across under them (per attribute pips and Low / Medium / High from the read's width, the looks line, flags and staff likes, the link to the Scouting tab).
  - Profile: the traits card (Who Decides, Cares About, Personality, His Story, Commit Style and any trait the server adds, each "Not Known Yet" with its reveal hint) and a Background card (high school, archetype, rankings, composite, status, the comp once complete).
  - History: Recruiting Timeline (an icon per kind, Week N, the line, a kind chip), Recruiting Notes (sentences from what you know only) and Recent Interest Changes (his list with each school's word and ↑ ↓ —).
- **Popup:** the Prospect Profile shows the same hero and four tabs from the profile's board row, without the Recruit menu; the star adds or removes him from the board.

### Scouting Center

- Header: "Class of 2027", SCOUTING CENTER; meters Scouting Points, Trips This Week, Board Scouted, Full Reports; All Reports.
- Prospect Database: its chips, Position, Sort, search, paging and route state as before; a row is the board star, avatar, name, stars with Pos · State, the potential read tag (or a flag tag) over the confidence pips.
- The selected prospect: the shared hero with Nat. Rank, Pos. Rank, Team Need and a Potential badge with its certainty word; tabs Report · Looks · Profile with Send Scout · N Pts, View Full Profile and Add to / Remove from Board on the tab row. Route keys qboard, spid, ssub, sops stay; old ssub values ratings and overview open Report, scouting opens Looks.
- Scouting Operations: one card a staff member (area, eval word, contract, this week's yield), and an open recruiter spot as a card.

### Layout rules

- The header, cards, bars, report and traits card are one set of components (web/profileview.js, web/profile.css) used by the board, the popup and the Scouting Center.
- Cards sit in a two-column grid that drops to one on a narrow pane; a card alone on its row spans it. Cards sharing a row stretch to the same height; full-width cards line up with the row's outer edges; one gap token (--pv-gap) between cards across and down.
- At 400 px: the list, then the pane (the phone sheet, as today); meters wrap; no sideways scroll.
