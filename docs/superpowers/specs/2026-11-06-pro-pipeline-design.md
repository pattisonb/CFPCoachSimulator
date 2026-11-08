# Pro Pipeline: a program's NFL draft record as a living grade and a recruiting pitch

Branch `pro-pipeline`. Builds on the program ratings (`docs/superpowers/specs/2026-10-26-program-ratings-design.md`).

## Why

A recruit picks a school partly for where it sends players: Alabama's defensive backs and Ohio State's
receivers go in the first round, and a kid who wants the league knows it. The game has no such grade and
no such pitch. The player asked for "position by position pro potential" as a school grade and a pitch,
ranked from every program's last ten years of drafted players and separated into tiers, moving with what
happens in the career like every other program grade.

## What

### 1. The data: `data/nfl_drafts.json` (built by `tools/fetch_drafts.py`, done)

Every pick of the 2016-2025 NFL drafts from Wikipedia's player-selection tables: year, round, pick,
player, position, college, mapped to our team slugs (team names, the recruiting file's alternate names,
and an alias table: "Miami (FL)", "Southern California", "South Florida", ...). 2,565 picks; 134 of the
138 FBS programs have at least one (Arkansas State, Army, Kent State and Texas State none); picks from
FCS, Division II and Canadian schools stay under `other`. Positions fold into the draft groups
`offseason.DRAFT_GROUP` uses: QB, RB (FB with it), WR, TE, OT (T, OL), IOL (G, C), EDGE (DE, OLB),
DL (DT, NT), LB (ILB, MLB), CB (DB), S (FS, SS), K, P; long snappers out; a two-way player by his
first listed position. The fetched pages cache under the git-ignored `data/cache/drafts/`.

### 2. The metric: `pro` on every program (0-100), with a grade per position group

**A draft's value to a program.** Each pick is worth points by round: `PRO_ROUND_POINTS = {1: 4, 2: 3,
3: 2}`, any later round 1 (`*tune*`). A program's draft line for a year is its points in that draft,
in all and by group: `[year, points, {group: points}]`.

**The score.** The last ten draft lines, the newest five counted double (`PRO_RECENT_YEARS = 5`,
`PRO_RECENT_WEIGHT = 2.0`, `*tune*`): `score = sum(points × (2 if year in the newest five else 1))`.
The group score the same on the group's points.

**The scale.** Like history: the score is put on 0-100 by `programs.scaled` with a fixed scale
`scales.pro` in `data/program_history.json` (lo 0, hi the best program's starting score, the exponent
`k` set so the median program is `MEDIAN_TARGET`, as `build_program_history.scale` does). A program
that keeps drafting as it did in the real decade keeps its number; the scale never moves. Each group has
its own fixed scale `scales.pro_group[group]`, fitted the same way over the programs (so the best WR
pipeline is 100 and the median about 39, whatever the group's league-wide count). A group with no picks
is 0.

**Where it lives.** `program["pro"]` (0-100), `program["pro_groups"]` ({group: 0-100}),
`program["drafts"]` (the ten lines, oldest first). `data/program_history.json` gains `pro`,
`pro_groups` and `drafts` per team (rebuilt by `tools/build_program_history.py`, which now reads
`data/nfl_drafts.json`; a program with no picks gets 0, an empty `pro_groups` and ten empty lines), and
`scales.pro` and `scales.pro_group`. `BASE_DEFAULT` (a new FBS program) gets `pro: 0`.

**Living.** `programs.update` (the Staff step, after the draft has run at Departures) takes the
offseason's draft: every departure event with `kind == "draft"` is a pick for the team it left
(`ev["team"]`, its `round`, its position's group), scored as above into this year's line, which joins
`drafts` as the eleventh line pushes the oldest out; `pro` and `pro_groups` are recomputed. A season
already in `drafts` (the program's `year` guard) is not added twice. The offseason's draft has
`DRAFT_PICKS × DRAFT_FROM_FBS` FBS picks a year, close to the real count, so the league's total points a
draft stays near the real decade's and the fixed scale holds (`tools/check_programs.py` prints the
league's draft points a year beside the real mean).

**In the rating.** `WEIGHTS` becomes prestige 0.30, winning 0.15, nil 0.15, market 0.10, conference
0.10, coach 0.10, pro 0.10. The tier floors stay. The starting top 25 by rating must still hold at
least 20 of `check_programs.EXPECTED_TOP` (the check runs in the build); if it falls short the weights
are tuned there, not the data.

### 3. The pitch: Path to the League (`"pro"`)

`PITCHES` gains `"pro"`, last before academics in the page's order. The page names it "Path to the
League" (`PITCH_NAMES`); his phrase is "getting to the league" (`scenes.PHRASES`).

**Strength.** `recruiting.pull` adds `"pro"`: the school's grade at the prospect's position group,
`programs.get(state, slug)["pro_groups"].get(group, 0)`, as a pull `_logistic(PRO_PULL_K × (grade - 50)
/ 25)` with `PRO_PULL_K = 1.2` (`*tune*`; 50 is a pull of 0.5, 100 about 0.92, 0 about 0.08). An
athlete (ATH) and a kicker or punter read the program's overall `pro`. The group is the draft group of
his position (`DRAFT_GROUP` through the roster group: a WR's "WR", an OL's "OT" and "IOL" averaged, a DL's
"EDGE" and "DL" averaged, a LB's "LB", a DB's "CB" or "S" by position).

**Priority.** `PRIORITY_ODDS` becomes proximity 0.18, playing_time 0.17, prestige 0.14, winning 0.13,
nil 0.13, coach 0.10, pro 0.10, academics 0.05 (sums to 1.00). The portal: `PORTAL_PRIORITY_ODDS`
pro 0.05 taken from playing_time (0.40), `PORTAL_TOP_PRIORITY_ODDS` pro 0.08 taken from nil (0.30) and
winning (0.22). The draw stays `_priorities` (its own stream per prospect); the class's priorities
change, which is why the golden recruiting digest is regenerated once (section 6).

**Who cares.** `persona.DECIDER_TOPICS`: dad gains "pro", trainer gains "pro", hs_coach gains "pro".

**Copy** (`scenes.py`, every pool a new topic needs, in the voice of the existing ones):
- `LINES["pro"]`: cue ("Honestly, Coach? I'm trying to play on Sundays. Who gets {position}s there?";
  "My trainer keeps a list of who puts guys in the league. I look at it."; "I want to get drafted. That's
  the whole plan."), hit ("You put {position}s in the league. That's what I'm chasing."; "Sundays. That's
  the dream, Coach, and you've got the receipts."; "First-rounders at my spot? Say less."), polite ("Cool.
  The league's a long way off, though."; "Yeah, I know who you've sent. Not my biggest thing."; "That's
  nice. I just want to play ball first."), quiet ("...Who was the last {position} you got drafted,
  Coach?"; "My trainer says nobody gets drafted from there. I don't know."; "I'll have to look that up.").
- `LEAD_LINES["pro"]`: "We put {position}s in the league, {first}. Scouts know the way here."
- `LEAD_HONEST["pro"]`: "I won't tell you we've sent a lot of guys to Sundays. Come be the first one
  everybody remembers."
- `HONEST_HIT["pro"]`: "Be the first? Okay. I like that, Coach."; "Nobody's done it from there yet. Maybe
  that's me."
- `SAID_HONEST["pro"]`: "a path to Sundays".
- `NEEDS`: the hit lines that claim a pipeline need `"pro"` true (`CLAIM_FROM` on the strength, as the
  other topics).
- The `two`-sided cue, the decoy draw and the in-home visit already work from `PITCHES` and `LINES`.

**History and the page.** The contact log's pitch words come from `PITCH_NAMES`; the recruit menu lists
the pitch from `/recruiting`'s `pitches`; the prospect profile's strengths list it. The Office's
weekly report and the board's "He wants" lines read `PHRASES`. No new rows.

### 4. Eight words for every metric

`METRIC_WORDS` (web/recruiting.js) and `programs.WORD_FLOORS` (new, the one place the floors live; the
page reads them from `/programs`'s `words`): Elite 90, Excellent 80, Strong 70, Good 60, Solid 50,
Fair 40, Thin 30, Weak below. The table's cells carry the word's lowercase class; `.go-programs td.elite,
td.excellent, td.strong` read in the text color and weight, `td.thin, td.weak` muted, as today's two
ends. The Your Program bars are unchanged (bars, with the word beside). The card's tip and the docs
name the eight.

### 5. Where it shows

- **Programs tab, Your Program card:** a seventh bar "Pro Pipeline" ("The last ten drafts, by
  position"), and under the bars a position line: every group with a grade, best first, "WR Elite · CB
  Excellent · OT Strong · QB Fair · K Weak", as `go-program-groups` chips (a group with no picks reads
  Weak). At 400 the chips wrap.
- **Every Program table:** a "Pro Pipeline" column after Coach, the word.
- **The API:** `/programs` rows carry `pro` and `pro_groups`; `you` carries both; `words` the floors.
- **Prospect profile:** nothing new to build; the strengths list draws every topic.

### 6. The golden digest

`tests/test_sim_golden.py` hashes the recruiting week. The new priority changes every prospect's
priorities, so the AI schools' week moves. The player agreed (2026-11-06) to regenerate the golden
file once with this change: the games and every stat line stay byte-identical (the season sim does not
read recruiting), and the test's output must say so (the digest's `games` and stat parts equal before and
after; only `recruiting_sha256` changes).

## Who reads it

| reader | reads |
|---|---|
| recruiting pull "pro" | the group grade (section 3) |
| the rating and tier | `pro` at 0.10 |
| the AD's goal, job attractiveness, coach level | through the rating, as today |
| the Programs page | `pro`, `pro_groups`, the words |
| `tools/check_programs.py` | the top 25 at the start; over a run, the league's draft points a year |

## Realism checks

- At the start: Alabama 100, Ohio State and Georgia 85+, the median program about 39; the five
  "factory" programs (Alabama, Ohio State, Georgia, LSU, Michigan) read Elite or Excellent; the 36
  programs with two picks or fewer read Weak.
- The starting top 25 by rating keeps at least 20 of the expected 25.
- Over a 10-season run (`tools/long_run.py`), the league's mean `pro` stays within 5 of its start
  (the fixed scale holds because the career drafts about as many FBS players as the real decade), and
  no program moves more than two words in five years.
- Recruiting: a 5-star receiver with "pro" first chooses among the factories more often than before,
  and the class share with "pro" as a priority is 25-35% (three draws at 0.10 odds).

## Tests

- `tests/test_program_history.py`: the base values above and the scales.
- `tests/test_programs_update.py`: a career draft adds a line and moves `pro`; ten empty drafts take a
  factory to 0; a line is never added twice; `pro_groups` follows the drafted positions.
- `tests/test_recruiting_api.py`: "pro" among the pitches; the strength at a receiver's position differs
  between Ohio State and San José State.
- `tests/test_pro_pitch.py` (new): the pull by group, the priority odds sum to 1, a scene with "pro" as
  his cue, the honest lead when the program cannot claim it.
- `tests/test_copy_case.py`, `tests/test_spacing.py`, `tests/test_ux_sweep.py` (the Programs tab at 1280
  and 400), `tests/test_scene_window.py`.
- `tests/test_sim_golden.py` regenerated once (section 6).

## Out of scope

- Undrafted free agents, All-Pro counts, and the pros' careers after the draft.
- A pitch that names a specific drafted player ("You saw what we did with Marvin Harrison").
- Pro Pipeline in the league file import/export (a custom league's teams take the base values by slug,
  a new team 0).
