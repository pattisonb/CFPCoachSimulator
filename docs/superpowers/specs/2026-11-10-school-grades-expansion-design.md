# School Grades expansion: more reasons to pick a school

**Status:** draft (November 10). It rebuilds a talk whose notes were lost; the player has not approved it yet.
The "Open Calls" section lists the decisions still to make.

## Why

A recruit picks a school for prestige, winning, NIL, the coach, the pros, playing time or home.
Real kids also pick for the campus: the building, the degree, the town, a coach who will still be there,
the Saturday crowd and the TV games. Today two of those exist only half-way, and the rest not at all:

- **Academics** is a yes/no list (`recruiting.ACADEMIC`, 18 schools). It matters mostly in a Grades Scare.
- **Facilities** have no grade. They are folded into development (`offseason.PROGRAM_DEV`, read off the recruiting baseline).
- **Market** is one number, 60% home crowd and 40% TV (`data/program_market.json`). It holds the crowd and the
  exposure in a single grade.

More grades give recruits more ways to want a school, give mid-tier programs a real pitch
("we're not Alabama, but we're Stanford" or "we're in San Diego"), and give the player more to build.

## What: six new grades, one split

| Grade | What it is | Researched from | Moves |
|---|---|---|---|
| **Academics** | Degree value and how football players do in class | U.S. News national rank, NCAA football Graduation Success Rate (GSR), NCAA football APR | Barely. APR drifts a point or two with the roster; a low APR year can dock it |
| **Facilities** | Stadium, weight room, football building, indoor practice | Football building opening or renovation year, indoor facility, stadium renovation year, athletic capital spending (Knight Commission / USA Today finances for public schools; estimated for private schools and marked as estimates) | Fixed from the research (see "Later: AD Meetings") |
| **Location** | The town and the life around it | Metro population (Census), climate normals (NOAA: January temperature, sunny days), college-town or big-city setting, cost of living | Fixed |
| **Stability** | Will the coach and staff still be here | `data/recruiting/coaches.json` head coach tenures since 1995, then the career's own carousel | Live: every coaching change docks it, every year of tenure adds back |
| **Game Day** | The crowd and the noise | CFBD home attendance (already in `program_market.json`), stadium capacity, so percent full | Live: the crowd half of today's market live part |
| **Exposure** | The brand: TV, national windows, social reach | Nielsen TV averages (already in), national-window games, football account follower counts | Live: the TV half of today's market live part, plus winning |

**Game Day and Exposure are Market split in two.** Market stays as a headline reading in the hero row
(and as the NIL floor's input) but becomes derived: 0.6 × Game Day + 0.4 × Exposure, the same weights as today,
so every program starts on the same Market number it has now.

**Location also carries tags** beside its grade, because location is taste as much as quality:
setting (Big City, College Town, Small Town), climate (Warm, Mild, Cold) and region. A recruit who wants a warm
big city likes USC for that reason, while a small-town kid from Iowa may not.

### The page

School Grades grows from 7 to 12 bars, so it splits into two groups in the same card:

- **Football:** Prestige, Winning, Coach, Stability, Conference, Pro Pipeline
- **Campus:** Academics, Facilities, Location, Game Day, Exposure, NIL

The Every Program table gets the same columns in the same two groups. Words stay the same
(`programs.WORD_FLOORS`: Elite, Excellent, Strong…).

## Recruits

Each new grade is something a recruit can want, the way he wants proximity or NIL today:

- New pitches beside `recruiting.PITCHES`: `facilities`, `location`, `stability`, `game_day`, `exposure`.
  `academics` already exists; it starts reading the grade instead of the yes/no list.
- The pitch lands harder the higher your grade (the same shape as the prestige and NIL pitches).
- Deciders pick them up (`persona.DECIDER_TOPICS`): mom adds stability, dad adds exposure,
  the player himself is the one most likely to want facilities, game day and location.
- Location reads the tags: a match on setting or climate counts, a clash costs a little.
- The Grades Scare keeps its behavior but reads the Academics grade (Strong or better) instead of the list.
- The Prospect Profile shows his top wants next to your grade on each.

## Who Cares About What (proposed)

**Today** (`recruiting.PRIORITY_ODDS`, `PRIORITY_WEIGHTS`, `persona.DECIDER_TOPICS`): each prospect draws three
priorities from eight topics, weighted 35% / 25% / 15%; the other five share 25% (5% each). His decider adds a topic
they care about. Transfers draw from their own tables: playing time first, and four-star-or-better transfers chase
NIL and a contender.

**Proposed:** thirteen topics (the five new grades join; Academics reads the grade). The top three keep 35 / 25 / 15;
the other ten share 25% (2.5% each), so a priority still dominates. The odds a topic is one of his priorities:

| Topic | High school | Transfer | Top transfer (4★+) | Today (HS / transfer / top) |
|---|---|---|---|---|
| Proximity | 13% | 8% | 5% | 18 / 10 / 6 |
| Playing Time | 13% | 34% | 16% | 17 / 40 / 18 |
| Prestige | 10% | 6% | 10% | 14 / 7 / 12 |
| Winning | 10% | 13% | 20% | 13 / 15 / 22 |
| NIL | 10% | 18% | 25% | 13 / 20 / 30 |
| Pro Pipeline | 8% | 5% | 8% | 10 / 5 / 8 |
| Coach | 7% | 3% | 3% | 10 / 3 / 4 |
| Academics | 6% | 1% | 1% | 5 / 0 / 0 |
| Facilities | 6% | 2% | 2% | new |
| Location | 5% | 2% | 1% | new |
| Stability | 4% | 4% | 2% | new |
| Game Day | 4% | 1% | 1% | new |
| Exposure | 4% | 3% | 6% | new |

**Tilts** multiply those odds before the draw (each ×1.5 unless noted), so the same table makes different kids:

- **Who decides:** Mom adds Stability to her Proximity and Academics; Dad adds Exposure to NIL, Playing Time and Pro;
  Grandmother keeps Proximity and Coach and adds Academics; the High School Coach adds Stability; the Trainer adds
  Facilities and Exposure; a kid who decides himself leans Facilities, Game Day and Location.
- **Personality:** Loves the Attention leans Exposure and Game Day; Cocky Playing Time and Exposure; Shy Proximity and
  Stability; Guarded Stability and Coach; All Business NIL and Pro Pipeline.
- **Stars:** a five-star leans NIL, Exposure and Pro Pipeline; a two- or three-star leans Playing Time and Proximity.
- **Position:** a quarterback leans Coach and Exposure; an offensive lineman Stability and Coach; a skill player
  Exposure and Game Day.

Saves keep the priorities their prospects already drew; the new tables apply to new classes and portal years.
`tools/check_recruiting.py` checks the spread over a run (no topic ending up nobody's or everybody's).

## Phases

1. **Research and data.** `tools/build_program_profile.py` builds `data/program_profile.json` for all 136
   programs, with a source column per number and estimates marked. The new grades show on the Programs tab.
   No recruit reads them yet. A `research_notes/` write-up keeps the sources.
2. **Recruits want them.** New pitches, deciders, Location tags, the profile. Scenes and History lines.
3. **The grades move.** Stability and Game Day / Exposure live; Academics drifts with APR.
   Facilities stays fixed.

## Later: AD Meetings (tabled, not in this work)

Anything that costs real-world money stays fixed until there is a system for asking for it. The plan for that
system: **meetings with your AD** where you request new facilities, equipment, staff budget, NIL money or a new
stadium. The AD answers with a goal to earn it, and a bigger ask brings a loftier goal (a new stadium might
require making the playoff). Bigger programs' ADs may set higher bars. Until then Facilities is the researched
number and does not move.

## Rules this keeps

- `python3 tests/test_sim_golden.py` stays byte-identical. Grades live in the career, not the season sim.
- New randomness gets its own seeded stream. Tunable weights are module-level and marked `*tune*`.
- Every label is Title Case ("Game Day", "College Town", "Big City").

## Decided (November 10)

1. **Market splits into Game Day and Exposure.** Market stays as a headline reading, 0.6 × Game Day + 0.4 × Exposure,
   so every program starts on the Market it has now.
2. **The new grades stay out of the overall rating at first.** They are recruiting grades. Two notes from the player:
   - **Coaches should care more about player success and personnel** when they weigh a job: the program's player
     development and Pro Pipeline, its staff and the talent on the roster, not only its rating.
   - **Tiers, maybe.** Whether Facilities and Stability (or the new grades generally) move a program's tier is
     decided after a long-run check (`tools/long_run.py`), not in phases 1-2.
3. ~~Can the player build facilities?~~ No, not yet: Facilities is fixed from the research; building waits for AD
   Meetings.
4. **Research all 136 programs in the first pass.**
