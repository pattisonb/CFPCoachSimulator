# Recruiting experience: word grades, generational prospects, a pipeline board with a map, and calls as scenes

Status: design, for review. Builds on the Coach Career recruiting in `coach_career/recruiting.py`
and `coach_career/prospects.py` (specs 2026-10-22-coach-career-design.md and
2026-10-23-recruiting-overhaul-design.md) and the Board in `web/recruiting.js`. Numbers marked
*tune* are starting points for the checks in section 9.

## 1. Why

The mechanics are deep (hours, NIL asks, pitches with strengths, stages, his ranked list,
firmness, scouting trips, needs by position) and the presentation undersells them:

- The board is a wall of identical white cards packed with tags and letter grades. Fifty cards
  look the same; nothing shows where a recruitment stands at a glance or what moved this week.
- Grades read as American school letters (A+ to F). Players read them as EA's rating letters,
  where a C is bad; here a C+ is an average Power 4 starter.
- Every action is a button and a toast. A 30-hour in-home visit feels like a 5-hour message.
  Nothing lets you read a prospect and act on what you read.
- There is no equivalent of EA's gem and bust, although the data has it: true potential is only
  loosely tied to stars (in one class a tenth of the three-stars project above 90 and many
  two-stars beat four-stars), and your staff's reads already narrow onto that truth.
- On a phone the pitch panel sits below every card; on a long desktop board it scrolls away
  (docs/ux_sweep_2026-10-27.md F5, F21).

**Rule for everything below: the CPU keeps recruiting on the same rules.** AI schools and
Auto-recruit act through the one action path (`_act`), read the same shared state, and are
not asked to use anything built for the player's screen. Where the player's odds change, the
section says what the CPU gets.

## 2. Grades in words

The six scouting groups (athleticism, size and strength, technique, football IQ, potential,
coachability) keep their points on the game's 1 to 99 scale. The 13 letters become six words,
the same vocabulary the Office uses for program metrics:

| Word | From | Meaning on the game's scale |
|---|---|---|
| All-American | 90 | An All-American at his position |
| Elite | 80 | Two steps above a Power 4 starter |
| Strong | 65 | One step above |
| Solid | 50 | An average Power 4 starter |
| Fair | 40 | A Power 4 backup or a Group of 5 starter |
| Weak | below 40 | Depth at best |

`recruiting.LETTERS` and `LETTER_FLOORS` become `WORDS` and `WORD_FLOORS`; `letter()` becomes
`word()`; `grade_range` returns words. `LETTER_SLACK` (half a letter of slack on a read's
interval) becomes `WORD_SLACK` and is retuned so the share of four-look ranges that hold the
truth stays in today's band (68% at evaluator 40, 81% at 60, 92% at 95: docs/HOW_IT_WORKS.md
"Scouting"). A range reads "Solid to Strong"; a settled read is one word. The top tier is All-American, not
Generational: "Generational" is the public tag in section 3, and a grade must never read as the
tag. A three-star gem whose potential reads All-American is not a generational prospect. Potential
is his ceiling, so a recruit who grows to 90+ on your roster had an All-American potential all
along; the tag caps nobody.

Every place a letter appears reads the word: the card's SCOUTED strip, the profile's grade
cells and their tooltips (the "C+ starts at 50, B at 60, A at 78" legend becomes the table
above), the Prospects list's potential column, the Staff screen's examples, and
`prospects._evaluation`, whose strength and weakness cuts are points already
(`STRENGTH_FROM`, `WEAKNESS_BELOW`) and only change their docstring. Grades are never stored
as letters, so saves need no migration. The CPU never read letters.

## 3. Generational prospects, gems and busts

**Generational** is drawn once, at `recruiting.start`, after the class is generated, and stored
at `rc["generational"]` (a list of pids), so the class itself is unchanged. Each four- or
five-star whose true potential is `GENERATIONAL_FROM = 95` *tune* or better draws
independently: `GENERATIONAL_ODDS = {5: 0.4, 4: 0.1}` *tune*. A class therefore has none some
years and a few in most (on the measured class: about eight five-stars and fifteen four-stars
qualify, so the expectation is about four), and a cap of `GENERATIONAL_MAX = 4` *tune* keeps
the tail off: past the cap the highest true potentials keep the tag. The draw is seeded from
the class seed so the golden test can pin it.

Amended after build (owner's note): the tag is not public. It is your staff's find, shown to a school only after `FIND_LOOKS = 3` looks at him (a full scouting set, the same threshold as a gem or a bust risk) or once he signs with you; the draw, the ask and the CPU's recruiting are unchanged. The original text follows.

A generational prospect is **public**: a badge on every list, card, profile and class view, and
in the national news ("the class's generational quarterback"). His NIL ask runs
`GENERATIONAL_ASK = 1.5` *tune* times the usual. Nothing else about him changes: AI boards
already chase five-stars and high four-stars, and the realism check in section 9 confirms the
tagged prospects sign where top prospects sign.

**Gem** and **bust risk** are your staff's finding, computed per viewer from the read, never
from the truth:

- Gem: the read interval's low end on potential is Elite (80) or better, and he is a
  three-star or lower, or ranked outside the top `GEM_RANK = 300` *tune*.
- Bust risk: the read interval's high end on potential is below Solid (50), and he is a
  four-star or better.

Both need at least `FIND_LOOKS = 2` *tune* looks. Because a read can be wrong, a weak
evaluator can hand you a false gem; the badge says "Gem · your staff's find" and the profile
tooltip explains the risk. When he signs with you, his ratings show (today's rule), so the
find is vindicated or not; the Classes view marks your gems that held ("a gem") and those that
did not ("the read was off"). `prospects.board_row` and `row` gain `find: "gem" | "bust" |
None`; `generational: bool` rides on every prospect view.

The CPU is not touched: AI schools board by fit from true grades and stars as today.

## 4. The board as a pipeline

`renderRecruiting` becomes a pipeline of five columns from the existing `stage`:

| Column | Stage | Who |
|---|---|---|
| Cold | `cold` | On your board, no contact yet |
| In touch | `contact` | Messaged, called or offered |
| Top 8 | `top` | Offer in hand and in his top group |
| Visited | `visited` | An official (or campus) visit happened |
| Committed | `committed` and committed or signed elsewhere | Yours in team colour; lost ones greyed with their flip odds |

**Cards** are compact: avatar, name (opens the profile), position and stars, potential in one
word (or "Not scouted"), badges (Generational, Gem, Bust risk, Need, Offered, Cooled,
Verbal/Hard with firmness), your standing bar, and one line of standing text. A card whose
stage rose since the last week step carries a "moved up" glow for the week; one that fell, a
quiet "slipped" mark. The server adds a per-week stage snapshot beside the rank snapshot
(`_snapshot_ranks` also records `stage_now` and `stage_prev` per board prospect for the
viewer only), so the move costs the CPU nothing.

**Selecting a card** opens the detail pane: sticky at the top of the viewport on desktop
(`position: sticky`), a bottom sheet on phone that slides over the columns and closes with a
swipe or a button. The pane holds:

- his list as a **race**: one track, every school a team-colour pill placed by its bar share of
  the leader, you outlined, each pill's move since last week as a small arrow, a tap on a pill
  naming the school and its reason for the week;
- grades in words with the tooltips from the profile;
- the badges and the stage, with the stage's hint ("get into his top group for a visit");
- the pitch picker with your strength per topic and, during a scene, the cue you heard
  (section 6);
- NIL with his ask marked on the input, Offer or Raise;
- the action buttons (Message, Call, HC visit, Visit, Scout, Offer, Pull, Off the board) with
  their costs and reasons, as today.

**Kept:** the header meters, the Auto-recruit segment, the need strip (a position picked
filters every column), the news ticker, "Find prospects" and the empty state. **Gone:** the
lead/close/behind chips (the columns and the standing bar carry that) and the `view.chip`
state. Sort within a column: your chance, then national rank. The portal weeks reuse the
pipeline (the portal has the same stages; the Visited column reads "Campus visit").

**Phone:** the columns are one horizontal scroll-snap row, one column per screen, with a
segmented control above (counts on each segment) that scrolls to a column. The pane is the
bottom sheet. This closes F5 and F21 of the UX sweep.

## 5. The map

A map card above the columns, collapsible (its state kept in `localStorage`):

- a US map from one static asset, `web/us-states.js`: a public-domain simplified outline, one
  SVG path per state plus D.C., about 60 KB, with a `viewBox` and the state code on each path;
- your staff's nine areas (`recruiting.AREAS`) shaded: staffed areas in your team's primary
  colour at low alpha, unstaffed in the panel colour; a legend names the staff member on each;
- every prospect on your board as a dot at his coordinates (`p["home"]`, already carried),
  coloured by standing tone (good, warn, muted, bad) and ringed when committed to you; a
  generational prospect's dot is larger;
- tap a dot to select him (the pane opens); tap a state to filter the columns to that state
  (the need strip and the state filter compose); a selected state is outlined;
- the Prospects tab gets the same map in a smaller size, where a state tap sets its state
  filter.

`GET /api/season/{id}/recruiting` adds `areas: {name: [states]}` and the staffed area per
staff member (already in `staff`), and each board row adds `home: [lat, lon]`. The map is
hidden under 360px wide and has an accessible table alternative (state, prospects, your best
standing) behind a "List the states" button.

## 6. Calls and in-home visits as scenes

A **call** (15 hours) or **in-home visit** (30 hours) becomes a two-step scene. A message stays
one tap: a 5-hour note with the pitch, as today.

**Step one, open.** `POST /api/season/{id}/recruit` with `{pid, action: "call" | "hc_visit"}`
and no pitch. The server runs today's checks (hours, weekly-once, the monthly visit gap,
committed-to-you), spends the hours, marks the weekly-once and `hc_week`, sets `last_contact`,
and stores an open scene at `rc["scenes"][slug][pid] = {id, action, week, cue, lines}`. It
returns `{scene: {id, action, lines, cue, ask}}`:

- `lines`: two or three lines in his voice from a template bank (`coach_career/scenes.py`),
  keyed by topic and filled with his name, hometown, position, high school, your school, your
  depth chart at his position (`strengths` already computes where he projects), your record
  and his family for a visit. One line carries the **cue**, one is colour (his season, his
  team, a joke), and a visit adds his mother or father asking the question a parent asks.
- `cue`: an oblique pointer at one of his true priorities, chosen as the first not yet revealed.
  With probability `CUE_TWO_SIDED = 0.5` *tune* the cue names two topics, one true and one
  drawn from the rest, so reading him takes judgement.
- `ask`: an in-home visit returns his exact number as today (`contact["asked"] = True`); a call
  narrows the range (`"range"`).

**Step two, pitch.** `POST …/recruit` with `{pid, action: "pitch", scene, pitch}`. The server
finds the open scene (409 if none or the id does not match), applies today's points rule for
the scene's action and pitch through `_contact_points` (priority or not, strength, backfire,
cooled, diminishing contacts), clears the scene, and returns `{reaction: {kind, text,
revealed}}`:

| kind | When | What he says | Reveal |
|---|---|---|---|
| hit | the pitch is a priority at strength `>= BACKFIRE` | he lights up | that priority is revealed (`_reveal` on that topic) |
| polite | not a priority | he is polite and moves on | none |
| quiet | a priority at strength `< BACKFIRE` | he goes quiet; the `not_buying` event logs as today | the priority is revealed (you learned it the hard way) |

Points land at the week step as today. The toast and the pane show the reaction with his
avatar; the cue stays on his card as "Heard: …" until the week step.

**An abandoned scene** (the pane closed, the page reloaded, the tab left) keeps the hours spent
and the contact made, adds no points, and reopens from his card ("Finish the call") until the
week step clears it (`_flush` drops open scenes and logs a `hung_up` note on the report).
Turning Auto-recruit on clears open scenes.

**CPU parity.** AI schools and Auto-recruit call `_act` with a pitch, as today: the coin-flip
reveal (`CALL_REVEAL`) and `best_pitch` stand for them. The one-shot form with a pitch stays
valid for the player too (old clients, tests). For the player the reveal becomes a skill: the
right read of the cue reveals a priority on every call, the wrong read on none. With half the
cues two-sided, a careful player reveals on about six calls in ten against the CPU's five;
`tools/check_recruiting.py` prints the player's reveal rate on a scripted season so
`CUE_TWO_SIDED` can be tuned to that band. Interest, firmness, NIL and the commitment rules
are untouched, so the realism checks that measure commitments and class shape hold.

## 7. API

- `GET /api/season/{id}/recruiting`: each board row adds `find`, `generational`, `stage_move`
  (`"up" | "down" | null`), `home`, `scene` (the open scene or null); the view adds `areas`.
- `GET /api/season/{id}/prospects` rows add `generational`, `find`, `home`.
- `GET /api/season/{id}/prospect/{pid}` adds `generational`, `find`; grades come as words.
- `GET /api/season/{id}/classes` rows carry `generational` and, for your signees, `find_held`.
- `POST /api/season/{id}/recruit`: `call` and `hc_visit` without `pitch` open a scene;
  `action: "pitch"` with `scene` and `pitch` finishes one. Both return `hours_left`.
- `POST /api/season/{id}/settings` with `auto_recruit` other than `off` clears open scenes.

## 8. State and saves

`rc["generational"]` (list), `rc["scenes"]` (open scenes per school and prospect),
`rc["ranks"][pid]` gains `stage_now` and `stage_prev` for the viewer. Old saves: a career
without `generational` draws it on load with the same seeded rule (`upgrade_generational`,
alongside `upgrade_asks`); missing `scenes` is empty; a missing stage snapshot shows no move
for one week. A career saved mid-scene reopens the scene.

The sim golden test (`tests/test_sim_golden.py`) pins the recruiting week: the generational
draw is seeded and the asks change for the tagged prospects, so the golden file is
regenerated once with the change and the regeneration is called out in the commit.

## 9. Tests and checks

- `tests/test_scouting.py`: the word cuts (`word(95) == "All-American"`, 85 Elite, 70 Strong,
  55 Solid, 45 Fair, 30 Weak); the four-look coverage band holds with `WORD_SLACK`.
- `tests/test_recruiting.py`: generational is drawn only from four- and five-stars at or above
  the cut, never more than the cap, seeded; a class with no qualifier has none; the ask
  multiplier; gem and bust rules from a forced read (a false gem from a wide, wrong read is
  allowed); a call without a pitch opens a scene, spends hours and marks the week; a pitch on
  a priority reveals it and adds today's points; a polite pitch adds the low multiplier; a
  quiet pitch backfires and reveals; a second open on the same week is refused; an abandoned
  scene adds no points and is cleared at the week step; Auto-recruit clears scenes; the
  one-shot call with a pitch still works; the stage snapshot reports the move.
- `tests/test_recruiting_realism.py`: generational prospects sign with schools whose class
  rank is in the top 25 at least 80% of the time *tune*; every existing bound holds.
- `tests/test_sim_golden.py`: regenerated once, identical afterwards.
- `tests/test_ux_sweep.py`: five columns render with counts; selecting a card shows the pane
  at 1280 (sticky) and 400 (bottom sheet) and the pane is within the viewport; the map draws
  51 paths and one dot per board prospect; a state tap filters; no letter grade appears on
  the Board, Prospects, Staff or profile (`\b[A-D][+-]?\b|\bF\b` inside grade elements); the
  scene opens, a pitch returns a reaction, and the card shows "Heard:".
- `tools/check_recruiting.py`: the player's reveal rate on a scripted season (section 6) and
  the generational count per class over both seeds.

## 10. Out of scope

Commitment announcements, a signing day ceremony and a weekly recap reel (the "moments"
direction, next); any change to interest, firmness or NIL tuning; new sim rules for AI
schools; the Staff screen beyond its grade examples.
