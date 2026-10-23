# Recruiting overhaul: need, NIL, pitches, stages, soft commits, weekly feedback, and the portal as recruiting

Status: design, for review. Builds on the Coach Career recruiting in `coach_career/recruiting.py`
(docs/superpowers/specs/2026-10-22-coach-career-design.md) and the offseason portal in
`coach_career/offseason.py` (2026-10-23-career-offseason-design.md). Numbers marked *tune* are
starting points for the realism checks in section 10.

## 1. Why

- Schools recruit position-blind: one Auto season had 25 schools sign 3+ quarterbacks, 34 sign
  none, one sign ten receivers, and the offseason patched the holes with 281 walk-ons.
- An offer is free: 0 NIL, no pitch, no downside, so it is a flag set on everyone you like.
- Every action shows its effect at once, so the week is a slot machine: act, watch the number,
  act again. There is no way to see how he ranks his schools or what moved them.
- The portal is two offer-and-pick rounds with none of recruiting's play.

## 2. Recruiting by need (schools)

**Need per group.** For school `s`, group `g` (QB RB WR TE OL DL LB CB S K P), each week:

    need[g] = TARGET[g] - returning[g] - commits[g]

`TARGET` is the healthy 85-man make-up (offseason.TARGET). `returning[g]` is the roster at `g`
minus seniors (SR, SRRS), with the draft-eligible underclassmen projecting a top-100 pick
(league-wide cut) counted at 0.35 and the usual attrition (10%: the portal, quitting) off the
rest. `commits[g]` counts commits and signees at `g` this class. A class takes a quarterback
whatever the room (`need[QB] >= 1 - commits[QB]`). A prospect's group is
`offseason.GROUP[ea_position]`.

**Boards.** `_fit_all`'s position factor (the school's historical mix) is a 0.9-1.1 tilt; at
board time the fit is multiplied by a need factor: `1.6` when `need[g] >= 2`, `1.2` at 1, `0.6`
at 0, `0.25` below. A five-star at a program whose star share lifts five-stars keeps a floor of
0.6.

**Caps.** A school takes `cap[g] = need[g] + 1` at a group (QB, K, P: `max(1, need)`). It keeps
offers out up to `2 * cap + 1` there (it offers more than it takes), pulls its open offers at a
group once its commits reach the cap, and a prospect cannot commit to (or flip to, or be placed
with on signing day) a school full at his group. Recruiting by hand, you may oversign a group you
offered. From `LATE_MARKET = 12`: every school refreshes its board weekly from the free
prospects, offers 25% more, and takes one flier past a cap (also on signing day).

**Yours.** Auto-recruit uses the same rule. The Board header shows your needs by group
("NEED OL 4 · DL 3 · QB 1 · full: WR, TE") and each prospect card a Need / Full tag.

**Realism** (`tools/check_recruiting.py`, both seeds): the league's signed positions a class
within 0.5 a group of the real mix (0.25-0.31), schools without a quarterback under 10%, at most
3 quarterbacks, nobody more than 2 past his room at a group; the old bounds hold (early
signing 0.80-0.90, class sizes, rank r). Status: built.

## 3. NIL asks and negotiation

**The ask.** Each prospect has `nil_ask`, drawn at class generation from his composite and
position: `ask = A(stars) * pos_mult * lognormal(0, 0.3)` with `A = {5: 60, 4: 30, 3: 8, 2: 0}`
NIL points *tune*, `pos_mult` QB 1.5, EDGE/LT/WR/CB 1.2, OL/DL/LB/S 1.0, RB/TE 0.9, K/P 0.3.
Budgets stay as they are (`nil_budget`: the program's level). So a five-star quarterback asks
about 90, a blue-blood budget covers a few of those, a Group of 5 budget none.

**From your school.** What he wants from `s` is `ask * (1 + 0.15 * max(0, rank_s - 1))` where
`rank_s` is your place on his list (section 6): he wants more to pick a school he likes less.
The card shows "wants about 40-70 NIL" (the ask times 0.7-1.3 on the public read) and the
exact number once a call, in-home visit or official visit has happened.

**Offers carry NIL.** The interest from an offer's NIL: `NIL_VALUE[stars] * min(nil, ask_s)` plus
`NIL_VALUE[stars] * 0.3 * max(0, nil - ask_s)` (meeting the ask counts in full, more counts a
little). A **Raise NIL** action (0 hours) raises an existing offer's NIL; the extra counts the
same way, applied at the week step.

**Lowball.** An offer under half his ask from your school (and any 0-NIL offer when the ask is
20 or more) is a lowball: he is **cooled** on you for 3 weeks: your contacts count half, he
declines an official visit, and the offer's base points (`BASE_POINTS["offer"]`) do not apply.
Raising the offer to at least the ask ends it. A prospect whose ask is 0 takes a 0-NIL offer as
a full offer.

**He asks for more.** At the week step, if a rival's NIL on him beats yours by 50% or more and
you are in his top group, he raises his ask from you by 25% *tune* (once per rival offer) and
the weekly report says so ("Jalen Reed has heard a bigger number").

**AI schools** offer `min(their share of the budget by stars, ask_s * 1.1)`, and raise once when
asked for more if the budget allows.

## 4. Offers with a pitch; pitches tied to your program

**An offer needs a pitch.** The offer action takes `pitch` (a topic) and `nil`. The UI requires
both; the API refuses an offer without a pitch (400).

**Your strength on each topic**, per prospect, 0-1, shown on his card and the pitch picker:

| topic | strength |
|---|---|
| playing_time | where he projects on your depth chart at his position, this class's commits included: starter 1.0, next in line 0.6, depth 0.2 |
| winning | this season's record and poll (the standing the engine already computes), 0-1 |
| prestige | the recruiting baseline, -2..+2 mapped to 0-1 |
| proximity | `exp(-miles / PROXIMITY_MILES)` |
| nil | your offer's NIL against his ask from you: `min(1, nil / ask_s)` (1 when the ask is 0) |
| coach | the head coach's recruiting rating, 50-99 mapped to 0-1 |
| academics | 1.0 on the academic list, 0.4 otherwise |

**The pitch's effect** replaces the fixed PITCH_MATCH (4x) / PITCH_MISS (0.5x):

    mult = (1 + 3 * strength) if topic in priorities else (0.3 + 0.4 * strength)

so pitching a priority where you are strong is 4x as now, a priority where you are weak 1x, and
a weak non-priority 0.3x. A priority pitched at strength under 0.25 **backfires**: the contact
is worth `-0.5 * BASE_POINTS[action]` and the week's report says "he isn't buying the playing
time pitch". Topics he has not revealed can still be pitched (you are guessing).

## 5. Relationship stages

A prospect's relationship with a school moves through `cold → contact → top group → visited →
committed`:

- **contact**: any message, call or visit from the school.
- **top group**: the school is in his top `TOP_GROUP = 8` *tune* by interest, offer in hand.
  An official visit invite needs the top group (409 otherwise: "he is not considering you yet").
- **visited**: an official visit happened.
- **committed**.

An offer while `cold` (no contact first) is a cold offer: its base points count half. The card
shows the stage ("In his top 8", "Visited").

## 6. His list, and feedback once a week

**No instant feedback.** Actions spend hours and are logged at once, but their interest lands at
the week step (`advance`). `act()` returns hours left and what a call revealed, not interest.
The board shows your stage with him and his list, as of the last week step.

**His list** (`/api/season/{id}/recruiting/prospect/{pid}` and the card): his schools ranked by
interest, each with a bar scaled to the leader, your place, each school's move since last week
(▲2, ▼1, new) and a one-line reason for the biggest mover ("HC visit", "offered 60 NIL",
"official visit", "lost 2 in a row"). Exact interest points are not shown; the bar and rank are.

**The weekly report** (on the Office and the Board, `/api/season/{id}/recruiting/report`):
after each week step, for every prospect on your board: his new rank for you, his leader, the
moves, and events (a rival offer, a commitment, a decommit, a flip, "asked for more", "cooled
on you", "isn't buying the pitch"). Kept for the last four weeks.

**Tuning hook.** `tools/check_recruiting.py` gains a table of the mean interest change per
action type per week and the share of weekly rank changes attributable to each action type, so
the weight of each action can be read off a season instead of guessed.

## 7. Commits that have to be kept

A commitment has a **firmness** 0-100, starting at 40 (an official visit first: 60). Each week:
`+10` if the school kept in touch (a message or call that week), `-8` if it did not, `+5` the
week an NIL promise is honored (the offer's NIL is still held), `-15` if the school pulls or
cuts the NIL, `-6` per rival in his top 3 with a better playing-time strength. Firmness caps at
100 and the flip chance scales by `(100 - firmness) / 100`: at 100 he cannot flip; at 40 he
flips as today. Firm commits read "Solid", soft ones "Soft" on the board, with the reason.
Your Auto-recruit and the AI schools keep in touch with their commits (one message a week each,
from the same hours). Signing day ends it.

## 8. The transfer portal as recruiting

**Period.** The offseason's `portal_1` and `portal_2` become `portal_w1 … portal_w4`: four
weeks after national signing day (real: a 30-day window). Each week: recruit, then the week
step (entrants decide). Auto plays all four.

**Entrants** enter as now (offseason section 4). No stars. Each shows: name, position, class
next year, last school, last season's line (games started, the stat line the awards use),
his **portal rank** (1..N by hidden true overall with noise sd 8 ranks *tune*, the public read),
your staff's grade read (the same letter groups as prospects, but with `LOOK_SD` halved: there
is film), the role he would have with you (starter / next in line / depth, from your depth chart
with your commits and signees), and his ask (section 3, from `A(portal) = 25 + 0.6 * (overall
- 50)` scaled by position, exact after a call).

**His priorities** are drawn for the portal: playing_time 0.45, nil 0.2, winning 0.15,
proximity 0.1 (home state), prestige 0.07, coach 0.03 *tune*; three as before.

**Actions** are recruiting's with the same hours (a fresh 50-70 a week) and weekly limits:
message, call (reveals a priority), **campus visit** (10 hours; replaces the official visit at a
home game: it happens that week, reveals everything, counts `BASE_POINTS["official_visit"]`),
HC visit (once in the period), offer with pitch and NIL (from a **portal NIL pool** of 35% of
next year's budget *tune*; AI schools the same), Raise NIL, pull. Need (section 2) uses next
year's roster: returning players plus signees. Your spots are as now (open spots plus up to 8
by release).

**Decisions.** At each week step every entrant with offers commits with probability
`PORTAL_COMMIT = (0.25, 0.4, 0.6, 1.0)` by week *tune*, to the school he likes best (interest
as in recruiting with the portal priorities, playing time from the role he would have), best
players first, spots as now. Committed transfers are signed (no flips). The weekly report covers
the portal the same way.

**Preferred walk-ons.** An entrant unsigned after week 4 may join a school from his top group
that had contact with him, has a roster spot under 85 and where he would at least be depth, as a
walk-on at 0 NIL (`walk_on: true`, the school's AI takes him when it has need at his group or he
beats its worst player there; you get the option on the last portal week's report). He takes it
`PORTAL_WALK_ON = 0.5` *tune* of the time; otherwise he leaves FBS. The same for high school: the
offseason's walk-on fill (`_fill_rosters`) draws first from the class's unsigned prospects who
had that school on their list (preferred walk-ons, named players you saw on the board), then
generates two-stars as now.

**Removed.** `PORTAL_TAKE`, `CHURN` passes, `ai_offers`'s need scoring and `resolve_round`'s
pick: the portal uses recruiting's board, offers, interest and decisions, with the portal
priorities and the four-week clock.

## 9. State, API, UI

**State.** `recruiting.prospects[pid]` gains `nil_ask`; `recruiting.lists[pid][slug]` stays the
interest; new `recruiting.pending[pid][slug]`: this week's points not yet applied; `stage`,
`cooled_until`, `ask_mult` per (pid, slug) in `recruiting.contacts`; `status[pid].firmness`;
`recruiting.report`: the last four weeks' reports; `recruiting.history[pid]`: his list at each
week step (rank per school), for the moves. The offseason's `portal` holds a recruiting-shaped
block (`prospects` = entrants in prospect form with `portal: true`, the same keys) and
`week` 1-4; `offseason.stage` runs `departures, portal_w1..w4, development, staff, ready`.
Old saves: a career in the old two-round portal finishes it the old way (the two functions
stay for that save); a career in season gets `nil_ask` and `firmness` filled on load
(`upgrade_grades`-style).

**API.** `POST …/recruiting/act` takes `pitch` on `offer` (required) and a new action
`raise_nil` (`nil`); returns `{hours_left, revealed}`. `GET …/recruiting/prospect/{pid}` adds
`list` (ranked schools with bars, moves, reasons), `stage`, `ask` (range or exact), `strength`
(per topic), `need` (your need at his group), `cooled`. `GET …/recruiting` adds `needs` and
`report`. `GET …/recruiting/report`. The offseason's `POST …/offseason/portal` becomes the same
`act` on the portal block (`portal: true`), and `…/offseason/advance` steps a portal week.

**UI.** The Board: a needs line in the header; each card gets the stage, his list (top 5 with
bars and moves, the rest on the profile), the ask, a Need/Full tag, the commit firmness, and the
offer form (pitch picker with your strength per topic, NIL slider with the ask marked). The
Office: the weekly report ("What changed") above the steps. The Offseason: the four portal weeks
reuse the Board (portal flag: no stars, the production line, portal rank, role, campus visit).

## 10. Realism checks and tests

- `tests/test_recruiting_realism.py` keeps its bounds (in-state share, distance, class rank
  r ≥ 0.75, FCS share) and adds: signed classes' positions per school against the real
  positions-per-class means (mean absolute error under 0.6 a group), schools signing no QB
  under 10%, none signing 4+ QBs, walk-ons after the offseason under 120 a year.
- `tests/test_recruiting.py`: an offer without a pitch is refused; a lowball cools him and a
  raise to the ask ends it; a cold offer counts half; a visit needs the top group; interest
  does not move until the week step; the weekly report lists the moves; firmness rises with
  contact and falls without; a flip at firmness 100 is impossible.
- `tests/test_offseason.py`: four portal weeks, decisions by week, no stars on entrants,
  placement 60-90%, Group of 5 schools sign 1.5-4 transfers a team.
- `tools/check_recruiting.py`: the action-effect table (section 6) printed for a season.
- `tools/long_run.py`: 3 x 20 seasons after the change; the bounds of the 85-roster check
  (docs/HOW_IT_WORKS.md "Many seasons") must hold, with walk-ons down.
