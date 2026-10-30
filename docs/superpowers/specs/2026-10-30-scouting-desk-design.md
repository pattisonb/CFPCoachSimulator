# The scouting desk

Status: approved in conversation 2026-10-30 ("A scouting desk"; "Yes to both"). Replaces the
Staff tab with a Scouting tab; engine support is one log of looks. Builds on the recruiting board
spec and the follow-ups.

## 1. Why

Scouting today is split: areas on the Staff tab, trips as a menu item on each recruit, and the
results only visible one recruit at a time as word ranges. The player wants scouting to be its
own screen: run the scouts, spend trips from a queue, and read what the looks found.

## 2. The tab

`Scouting` replaces `Staff` in the career tabs (`CAREER_TABS`: offseason, office, recruiting,
prospects, scouting, classes). Everything the Staff tab did stays on it (area assignment, staff
cards). Four blocks, top to bottom:

**Your scouts.** A card per staff member: name, role (Offensive coordinator, Defensive
coordinator, Recruiter), evaluation as a word (the existing tiers), the area dropdown (as today;
a change toasts "Marcus Reed now scouts Texas"), "looking at 38 prospects" (prospects in his area
not signed or committed to you), and this week's yield: "14 looks · 3 narrowed · 1 gem" from the
look log. Coordinators without an area read "No area: assign one".

**Send a scout.** Hours left this week at the top (`v.hours_left` of `v.hours`). A list of
recruits worth a look: everyone on your board first, then the class's visible prospects, sorted
by your need at the group then national rank, each row: avatar, name, position and stars, looks
so far `n of 3` as a small bar, the current potential word range, and a `Send (5h)` button (greyed
with the reason when he is committed to you, at three trips, or hours are short). Sending posts
the existing `scout` action; the row then shows the result inline: each grade's range before and
after as `Fair–Strong → Solid–Strong` in the word tiers, flags gained (gem, bust risk,
generational revealed), with the smoothness rules (patch, pulse, toast "Scouted Wesley Adams ·
look 2 of 3"). A search box filters the list by name, position, state.

**This week's reports.** A feed built from the look log for the current week, newest first,
grouped by scout: "Texas · Marcus Reed · 14 looks" then the notable ones: "Wesley Adams (QB,
★★★★★): potential narrowed to Elite–Elite", "Jaylen Brooks: gem", "Tony Bush: bust risk",
"Generational: Deshawn Carter". Only looks that changed a tier or a flag are listed; a scout
whose looks changed nothing reads "nothing new". Each name opens the recruit in the board's pane
(`H.onChange("recruiting")` then select him). Last week's feed is reachable with a "Last week"
toggle.

**Flags.** Your staff's finds so far this class: gems, bust risks, generational prospects, each
with looks and where he stands with you; the same `badges` as the board.

## 3. Engine: the look log

`look(state, pid, evaluation, rng, by=None)` (`recruiting.py` ~1905) appends, after it updates
the read, one entry to `rc["looks"]` (a new list, created lazily for old saves): `{"week",
"pid", "by": staff id or "trip", "before": {group: [lo, hi]}, "after": {group: [lo, hi]},
"flags": [new flags among gem, bust, generational]}`, keeping only the current and previous
week's entries (older ones are dropped at the start of each `scout_week`). The word ranges use
the existing read-to-tier mapping in `prospects.py`. `scout_week` passes each member's id as
`by`; a trip passes `"trip"`. No random draw is added or moved (the golden test's recruiting
week stays identical); the save grows by at most two weeks of looks.

The view `GET /api/season/{id}/staff` (today's Staff tab data, or a new `GET .../scouting` if the
staff route is thin) returns `scouts` (the cards with `area`, `looking_at`, `yield`), `queue`
(the Send-a-scout rows), `reports` (this week and last week, grouped by scout, only changed
looks), `flags`, `hours`, `hours_left`. The `scout` action's response carries the look entry so
the row can show before/after without a refetch of the whole desk.

## 4. The board

The Recruit menu keeps `Scout` (5h, n/3); the pane's Scouting sub-tab gets a line "Reports on
the Scouting tab" linking there. The Prospects tab is unchanged.

## 5. Tests

- `tests/test_scouting_desk.py` (native, through `app.api`): a seeded career; after `scout_week`
  the look log holds one entry per prospect per staffed area with `before`/`after` and flags;
  entries older than last week are dropped; the desk view's `reports` lists only changed looks
  and groups by scout; the queue excludes committed-to-you and three-trip recruits and greys the
  rest with reasons; a `scout` action's response carries the look entry; golden unchanged.
- The sweep: the Scouting tab renders the four blocks, Send spends hours and shows the inline
  result with a toast, a report name opens the board's pane on him, the area dropdown still
  works.

## 6. Out of scope

Hiring or firing scouts (the offseason's staff step owns that); scouting the portal differently
from the class; changing how looks narrow a read.
