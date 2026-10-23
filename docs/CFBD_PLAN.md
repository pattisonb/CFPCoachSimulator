# CollegeFootballData.com (CFBD): what it adds and what to do first

A survey of the CFBD API (v5.33) against what the sim already has. This is a plan, not
an implementation: no engine, roster or tuning code was changed. The numbers come from 35
sampled API calls made on 2026-10-22 (free tier, see "Calls used"). The raw responses
stayed in a scratch folder and are not in the repo. The recruiting endpoints are covered
elsewhere and are left out.

## What the sim already has, and where it is weak

| Area | Current source | Known gap (docs/HOW_IT_WORKS.md) |
|---|---|---|
| Player ratings, rosters, class years | EA College Football via `cfb_sim_data/` and `teamdata/build_teams.py` | 7-8% of real stat lines match no roster player; 13 real players added by hand-tuned rules (`tune_from_real.py`, `MISSING_MIN_SCORE` 100) |
| Results, box scores | NCAA GraphQL (`fetch_results.py`, `fetch_boxscores.py`) | No play-by-play, no down and distance, no pass depth. The GraphQL hash is hard-coded and breaks if NCAA changes it |
| League benchmarks | Typed in by hand from TeamRankings 2025 (`tools/calibrate.py` `BENCHMARKS`) | Drives and tackles are estimates. No success rate or explosive-play targets |
| Situational play | `tools/calibrate.py`, `tools/calibrate_late.py` (ESPN line scores) | Third down 42.9% in the sim vs 39.0% real; fourth-down tries 1.5 vs 2.1; best offenses about 6.7 yards a play vs 7.8 real; too few one-score games |
| Lines | scoresandodds.com scrape (`fetch_lines.py`), forward-test weeks only | No history, so there is no line to compare against for the season replay |
| Polls, line scores | ESPN (`fetch_polls.py`, `fetch_linescores.py`) | Fine as is |

## Endpoint table

"Calls" is the cost to cover what the plan needs. Endpoints that take only `year` return
every FBS team in one call. Coverage marked "checked" was seen in this survey; other
years are CFBD's stated coverage and have not been checked here.

| Endpoint | What it would improve | Value | Effort | Calls | Coverage | Versus current source |
|---|---|---|---|---|---|---|
| `/plays` (year + week) | Third and fourth downs by distance, fourth-down choice by field zone, explosive-play rates, red zone, success rate, all compared against the engine's `play_log` | **High** | M | 1 per week (13.9 MB, 21k plays for week 7) | 2026 checked; CFBD has play-by-play back to about 2001 | Nothing like it today: NCAA box scores have only totals |
| `/passing/plays` (year + week) | Pass depth shares and completion by depth (`DEPTH_COMPLETION`, the depth shares), plus CPOE per QB as a check on accuracy ratings | **High** | S | 1 per week (3.6 MB) | 2026 checked (air yards on 99% of attempts) | Not available anywhere in the repo |
| `/stats/season`, `/stats/season/advanced` | Replace the hand-typed `BENCHMARKS`: drives, success rate, explosiveness, stuff rate, havoc, points per opportunity, passing-down success. Team spread (p10/p90) for the explosiveness gap. `excludeGarbageTime` option | **High** | S | 1 each per season | 2025 and 2026 checked | Replaces TeamRankings numbers typed by hand and two estimates |
| `/roster` (year) | Real jersey numbers, height, weight, hometown, CFBD athlete IDs; source for missing real players | **High** (jerseys, IDs) / none (class year) | S | 1 per season (all 138 FBS teams, 15,804 players) | 2026 and 2025 checked | Jerseys beat EA where the box scores decide 342 to 5. **The class year (`year`) is 1 for all 15,804 players in 2026**, and 91 of Alabama's 127 in 2025: not usable |
| `/lines` (year) | Closing and opening spreads and totals, two books, for every game: season replay vs the market, forward test without scraping | **High** | S | 1 per season (2014-2026: 13) | 2026 checked (116 games in week 7, opening and closing) | `fetch_lines.py` scrapes one week at a time, current season only |
| `/ratings/sp`, `/ratings/fpi`, `/ratings/elo`, `/ratings/core`, `/ratings/srs` | Outside view of team strength to flag rating outliers; pregame baselines to score picks against | Medium | S | 1 each per season | 2026 checked | None today. Correlation with the sim's team overall: FPI 0.89, SP+ 0.85, Elo 0.80, CORE 0.69 |
| `/metrics/wp/pregame` | Pregame win probability and spread for every game: a ready-made baseline for Brier scores | Medium | S | 1 per season | 2026 checked | None |
| `/drives` (year) | Drive outcome mix (punt 34.8%, TD 26.3%, FG 10.5%, downs 7.4%, turnovers about 10%), 11.5 drives per team-game, 2.14 points a drive, starting at the opponent's 71 | Medium | S | 1 per season, or 1 per week (1.5 MB) | 2026 checked | `calibrate.py` "drives" is an estimate (12.0) |
| `/player/usage` (year) | Usage by down and passing downs; a cross-check on missing players | Low-Medium | S | 1 per season | 2026 checked | **Worse than the current depth method for starters**: season-long, so it lags injuries and benchings (below). Shares can add to more than 1 (Washington State QBs 0.78 + 0.66) |
| `/player/portal` (year) | Transfers in and out | Low | S | 1 per season | 2026 checked | EA rosters already follow the portal: 2,762 of 3,018 arrivals at FBS teams are on the right sim roster, and only 16 of the 256 missing have any 2026 usage |
| `/games/players`, `/games/teams` (year + week) | Backup box score source with CFBD IDs if the NCAA GraphQL hash breaks | Low-Medium | S | 1 per week | 2026 checked | Duplicates `fetch_boxscores.py` |
| `/stats/game/advanced` (year + week) | Per-game success rate and explosiveness for `calibrate_players.py`-style replays | Medium | S | 1 per week | 2026 checked | None |
| `/rushing/plays` (year + week) | Run direction, line yards, stuffs: checks the inside/outside split (`RUN_OUTSIDE_SHARE` 40%) | Medium | S | 1 per week | 2026 checked (one team) | None |
| `/punting/teams/season` | Punt return and net averages | Low | S | 1 per season | 2026 checked | Punting is already tuned (gross 43.4, net 39.2) |
| `/stats/player/season`, `/ppa/players/season`, `/stats/player/success` | Player-season totals and efficiency | Low | S | 1 per season or per team | 2026 checked (Alabama) | NCAA box scores already add up to this |
| `/talent` | 247 team talent composite | Low | S | 1 per season | 2026 checked | Sanity check only (0.84 with the sim's overall) |
| `/player/returning` | Returning production | Low | S | 1 per season | 2026 checked | The 2026 rosters are already set; this matters only for a future preseason build |
| `/venues` | Elevation, dome, grass, coordinates, time zone: travel and altitude in home field | Low | M | 1 total (852 venues) | checked | `cfb_sim_data` has capacity and surface only |
| `/coaches` (year) | Head coach records and tenure | Low | S | 1 per season | 2026 checked | `cfb_sim_data/coaches.json` already has researched HC, OC and DC |
| `/games` (year) | Every game with pregame Elo, line scores, attendance | Low | S | 1 per season | 2026 checked | ESPN and NCAA feeds already cover it |
| `/games/weather` | Weather | n/a | | | | **Patreon only** (`/info`: `weather: false`) |
| `/wepa/*` (opponent-adjusted) | Adjusted team metrics | n/a | | | | **401 on the free tier** (`adjustedMetrics: false`) |
| `/games/{id}/preview/adjusted`, `/scoreboard`, `/live/plays` | | n/a | | | | Patreon tiers |

## Top 5 recommendations, in priority order

### 1. Situational play from real play-by-play (`/plays`)

What the week 7 sample (59 FBS-vs-FBS games, 7,736 rushes and passes) already shows:

| Measure | Real 2026 | Sim today |
|---|---|---|
| Third-down conversion (season stats; play-by-play on runs and passes) | 40.9%; 42.3% | 42.9% |
| Third down by distance: 1-2 / 3-6 / 7-10 / 11+ to go | 72% / 46% / 34% / 16% (share of third downs 19 / 36 / 27 / 18%) | not measured |
| Fourth-down tries per team-game | 1.88 (season), conversion 54.4% | 1.5 |
| Fourth down by field zone: go / punt / FG | own 1-40: 12% go; midfield: 31% go; opponent's 21-40: 46% go, 46% FG; red zone: 39% go, 58% FG | not measured |
| 20+ yard plays per team-game | 4.39 (rushes 1.26, passes 3.13); 40+: 1.03. Teams p10/median/p90: 2 / 4 / 7 | not measured |
| Red zone trips / TD rate | 3.43 / 58.5% | 3.85 / (scoring 85%) |

The engine's `play_log` (`engine/drive_functions.py`) already records down, distance,
yard line, yards and pass depth on every snap, so both sides can go through the same
counting code.

- **Files:** new `tools/fetch_cfbd.py` (shared client: reads the key from `CFBD_API_KEY` or
  a git-ignored file, caches raw responses under `data/history/cfbd_cache/`, which is
  git-ignored, and keeps a call log); new `tools/calibrate_pbp.py`, which writes aggregates
  only to `data/history/cfbd_pbp.json`. Later tuning goes in `engine/game_config.py`
  (fourth-down go rates, third-down play) and `engine/situation.py`.
- **Calls:** 2025 regular season about 15, 2026 so far 8. Do one season first.
- **Validate:** `python tools/calibrate.py league 400` (third-down % and fourth-down tries
  move into their bands, nothing else leaves its band), `python tools/calibrate_season.py 30`
  (MAE and slope unchanged or better), `python tools/calibrate_late.py` (one-score games and
  comebacks), `python tools/realism.py --seeds 3` (best offenses' yards a play toward 7.8),
  then a forward-test week.

### 2. Pass depth from real pass charting (`/passing/plays`)

3,599 week 7 attempts with air yards, against the sim's depth model (HOW_IT_WORKS,
"Passing by depth"):

| Depth | Real share | Real completion | Real yards a catch | Sim share / completion / yards |
|---|---|---|---|---|
| Behind the line (<0) | 16.1% | 82.5% | 6.2 | (part of short) |
| Short (0-9) | 46.9% | 67.6% | 8.4 | |
| Short, both together | 63.0% | 71.4% | | 54% / 72% / 8.4 |
| Intermediate (10-19) | 22.6% | 51.0% | 17.5 | **33% / 59%** / 16.2 |
| Deep (20+) | 14.4% | 36.1% | 35.3 | 13.5% / **40%** / 35 |

Short throws match. The sim throws about 10 points too many intermediate passes and
completes 8 points too many of them, and deep completion runs 4 points high. One week is
a small sample, so fetch three or four more before tuning. CPOE per passer (on 98% of
attempts) is a check on the QB accuracy ratings, as an evaluation and not a nudge
(nudging ratings toward production lost out of sample before).

- **Files:** `engine/game_config.py` (`DEPTH_COMPLETION`, the WR and TE depth shares),
  `engine/play_functions.py` if a screen or behind-the-line bucket is added;
  `tools/calibrate_pbp.py` from item 1 reports depth shares from `play_log`.
- **Calls:** 1 per week, 4-5 total.
- **Validate:** `tools/calibrate.py league 400` (completion %, yards an attempt),
  `tools/calibrate_players.py --from-week 6` (QB1 yards error), `tools/realism.py`
  (passing and receiving leaders), forward test.

### 3. Fix jerseys and add the real players who are missing (`/roster`, `/player/usage`)

See the sampled mismatches below. CFBD jerseys beat the EA ones where NCAA box scores
decide (342 to 5), and `sim/realdata.py` matches box-score lines by jersey after name.
Players who play but have no EA card can come in with real jersey, height and weight
instead of a copy of the role's top player. Do **not** take class years (all 1) or
starters (season usage lags injuries) from CFBD.

- **Files:** `tools/tune_from_real.py` (read a cached CFBD roster, write a `"jerseys"`
  section and richer `"added"` entries to `data/real_adjustments.json`, and consider a
  usage-based add rule beside `MISSING_MIN_SCORE`), `teamdata/build_teams.py` (apply jerseys;
  `add_real_player` takes bio fields), `sim/realdata.py` (optional: CFBD athlete ID as the
  cross-source key). The source data in `cfb_sim_data/` stays untouched, as now.
- **Calls:** 2 per refresh (roster, usage).
- **Validate:** the matched share of real player lines reported by `sim/realdata.py` (92.2% at
  week 8; the target is fewer of the 138 notable unmatched lines), `python tests/run_all.py`
  (`tests/test_realdata.py`), `tools/calibrate_players.py --from-week 6` (real starter in
  the sim's QB1/RB1/WR1 slot), and the 40-season check through week 8 (Brier, favourite
  won %) used for every past roster change.

### 4. League benchmarks from CFBD instead of hand-typed numbers (`/stats/season`, `/stats/season/advanced`, `/drives`)

FBS offense means (sd across teams) from the samples:

| Metric | 2025 | 2026 so far |
|---|---|---|
| Success rate | 0.425 (0.041) | 0.435 (0.048) |
| Explosiveness (PPA on successful plays) | 1.240 (0.085) | 1.233 (0.094) |
| Passing-down success / share of plays on passing downs | 0.304 / 0.311 | 0.316 / 0.304 |
| Stuff rate / line yards | 0.187 / 2.95 | 0.176 / 3.07 |
| Points per opportunity (drives inside the 40) | 3.74 | 3.79 |
| Havoc rate | 0.154 | 0.146 |
| Drives per team-game | about 12.0 | 11.5 (week 7) |

- **Files:** `tools/fetch_cfbd.py` writes `data/history/cfbd_benchmarks.json` (team-season
  aggregates for 2023-2026); `tools/calibrate.py` reads its `BENCHMARKS` and bands from it
  (keeping the band logic), and gets success rate and 20+ play rows from item 1's counter;
  `tools/realism.py` uses CFBD team p10/p90 for the explosive-offense check.
- **Calls:** 2-3 per season, about 10 for 2023-2026.
- **Validate:** `tools/calibrate.py league 400` before and after: only the targets move,
  not the engine. A row that changes band is a finding to look into, not a change to make.

### 5. Market and rating baselines (`/lines`, `/metrics/wp/pregame`, `/ratings/*`)

- **Season replay against the market.** `calibrate_season.py` reports MAE 12.7 and
  compares it with "closing spreads: about 12-13" from memory. With `/lines` (1 call a
  season) it can print the closing line's MAE and the Brier of `/metrics/wp/pregame` on the
  same games, and back-test 2014-2025 if earlier seasons' rosters ever exist.
  `forward_test.py` can take the line from CFBD (opening and closing, two books) and keep
  `fetch_lines.py` as a fallback.
- **Rating outliers.** Ranked by z-score, the sim's team overall sits well above SP+ for
  Oklahoma (+1.34 sd), California (+1.25), Texas A&M (+1.09), Sacramento State, Oregon,
  UL Monroe, Akron and Vanderbilt, and well below it for NDSU (-1.36), James Madison
  (-1.35), New Mexico, Louisiana, Utah, Wake Forest, Oregon State and Toledo. These teams
  are the first to check in the season replay's worst misses before touching
  `teamdata/build_teams.py`'s team level. Do not blend outside ratings into the sim. That would make
  the picks copy the market instead of testing the engine.
- **Files:** `tools/calibrate_season.py`, `tools/forward_test.py`, `tools/fetch_lines.py`
  (fallback), `tools/fetch_cfbd.py`.
- **Calls:** about 3 per season (lines, pregame WP, SP+ or FPI).
- **Validate:** `calibrate_season.py 30` prints sim MAE next to closing-line MAE on the same
  games; the forward test's `score` gains "distance from the closing line" from CFBD
  without a scrape.

**Total for all five:** about 45-55 calls for one full season of play-by-play plus 2026
so far, well inside the monthly budget.

## Roster refinement: sampled mismatches against `data/engine_teams.json`

This compares the CFBD 2026 FBS roster (1 call, all 138 teams) and season usage with
`data/engine_teams.json` built today (`python -m teamdata.build_teams`, 11,742 players on the 138 FBS
teams). Players were matched by name, then jersey and last name, then a last name unique on
the team.

**Coverage.** 10,908 of 11,742 sim players (92.9%) are on the CFBD roster: 10,705 exact,
136 by jersey and last name, 67 by unique last name. The other 835 include 37 depth-1
"starters". Many are spelling differences between sources: Coastal Carolina's lead back
Dominic Knicely is "Dominic Lee-Knicely" in the NCAA feed, has 34% of his team's rushes in
CFBD usage, and is not on the CFBD roster at all. So CFBD's roster is not complete either,
and a missing CFBD entry alone never means a player should go.

**Names differ across all three sources**, and CFBD's own roster and usage disagree with
each other: Gio Lopez / Giovanni Lopez (Wake Forest QB), Goose Crowder / Will Crowder (Troy
QB), Lunch Winfield / D'Wayne' Winfield (Louisiana QB), Boogie Woods III / Alan Woods III
(Kennesaw State RB), Hollywood Smothers / Daylan Smothers (Texas RB), Steve / Steven Angeli
(Syracuse QB), Cam Edwards (CFBD roster) / Camryn Edwards (CFBD usage) at Michigan State,
Zeon Chriss (usage) / Zeon Chriss-Gremillion (roster) at Tulane. CFBD athlete IDs tie these
together, which is the strongest reason to store them.

**Jersey numbers.** 804 matched players have a different jersey in CFBD than in the sim.
Where the NCAA box scores show the number, CFBD is right 342 times and the sim 5 times
(196 both or neither, 261 not in a box score). Examples: Akron's Jordan Gant (sim 22,
CFBD and box scores 1) and Cyrus Durham (10 / 1), Air Force's Cade Paterson (25 / 23),
App State's Jaquari Lewis (22 / 5), Darrin Fugitt (80 / 7) and Nate Branch (85 / 1),
and Akron's added S Donelius Johnson (no jersey / 32).

**Real players missing from the sim** (on the CFBD roster with a jersey, with real 2026
work, and not on the sim roster under any spelling). 282 CFBD usage entries match no sim
player: 77 at 5% usage or more, 179 at 2% or more. Some of these are name variants, so
each needs a check. Checked against the NCAA box scores:

| Team | Player | Pos | CFBD jersey | CFBD usage | In NCAA box scores |
|---|---|---|---|---|---|
| Mississippi State | Parker Puckett | QB | 15 | 23.7% | yes, 3 passing lines |
| BYU | Journee Tonga | RB | 20 | 10.2% | yes, 5 games |
| Air Force | Kemper Hodges | QB | 4 | 8.4% | yes, 6 games |
| San Diego State | Draiden Trudeau | QB | 13 | 8.6% | yes, 3 games |
| LSU | Husan Longstreet (from USC, portal) | QB | 8 | 7.6% | yes, 2 games |
| Houston | Zane Smith | RB | 37 | 15.4% | yes |
| West Virginia | Martavious Boswell | RB | 20 | 12.7% | yes |
| Oklahoma | Ben McCreary | RB | 23 | 10.0% | yes |

`tune_from_real.py` adds only 13 players today (a line score of 100 or more). These are
below that bar, so their real lines go unmatched and the sim gives their snaps to someone
else.

**Starters: the sim's depth chart is right and CFBD usage is wrong.** CFBD's season usage
leader differs from the sim's depth-1 player at 25 teams at QB and 35 at RB. Every QB case
checked against the box scores game by game shows a mid-season change that the sim's
last-three-games depth order (`tune_from_real.py`) already follows:

| Team | CFBD usage leader | Sim QB1 | Real starters by week (box scores) |
|---|---|---|---|
| Oregon | Dante Moore (0.37) | Dylan Raiola | Moore weeks 1-3, Raiola 4 and 6, Brock Thomas 7 |
| Washington | Demond Williams Jr. (0.58) | Elijah Brown | Williams 1-5, Brown 6-7 |
| Syracuse | Steven Angeli (0.47) | Malachi Nelson | Angeli 1-3, Odom 5, Nelson 6-7 |
| Pittsburgh | Mason Heintschel (0.50) | Holden Geriner | Heintschel 1-5, Geriner 6, Dailey 7 |
| Tennessee | Faizon Brandon (0.42) | George MacIntyre | Brandon 1-4, MacIntyre 5-7 |
| California | Jaron-Keawe Sagapolutele (0.45) | Jackson Brousseau | Sagapolutele 1-4, Brousseau 5-7 |
| Charlotte | Cole Gonzales (0.51) | Conner Harrell | Gonzales 1-5, Harrell 6-7 |
| Miami (OH) | David McComb (0.51) | Caleb Heavner | McComb 1-4, Heavner 5-7 |
| Washington State | Owen Eshelman (0.78) | Caden Pinnick | Pinnick 1-6, Eshelman 7 (49 attempts): the one case to watch next week |

**Transfers.** The EA rosters already follow the portal. Of 3,018 2026 portal entries
whose destination is an FBS team, 2,762 are on that team's sim roster. 256 are missing, and
only 16 of those have any 2026 usage (the most used are Husan Longstreet at LSU, Thomas
Castellanos at Texas Tech, Luke Dehnicke at Northwestern, Jonah Burton at Duke and Javon
Brown at UConn). 155 sim players entered the portal with no destination listed, and 152 of
them are on a 2026 CFBD roster, so they withdrew. Only two departures still sit on their
old team in the sim: Kentucky WR Hardley Gilmore IV (to Baylor, depth 6) and Georgia
Southern EDGE Amari Wilson (to Southern Miss, depth 3). Two more are name collisions, not
transfers: James Madison's Tyler Brown and Kentucky's Cameron Miller.

**Class years and hometowns.** The CFBD 2026 roster gives `year: 1` to every player, so
it cannot check or fix the EA class years. Hometowns (city, state, coordinates) are present
for 99.5% of players. They would help only a future recruiting or "player origin" feature.

## Calls used

35 calls, all `GET`, out of a 100-call limit for this task. `/info` before the survey
showed 879 of 1,000 left for the month (resets 2026-11-01), so about 845 are left. The
calls were: `/info`; `/roster` 2026 (all FBS) and 2025 (Alabama); `/player/usage`,
`/player/portal`, `/player/returning`, `/talent`, `/ratings/sp|elo|fpi|core`,
`/wepa/team/season` (401), `/stats/season`, `/stats/season/advanced` (2025 and 2026),
`/stats/player/season` and `/stats/player/success` (Alabama), `/punting/teams/season`,
`/venues`, `/coaches` (all 2026 unless noted); for week 8 (not yet played) `/lines`,
`/metrics/wp/pregame`, `/drives`, `/plays` (Alabama, empty) and `/games`; for week 7
`/drives`, `/lines`, `/plays` (Alabama and all games), `/passing/plays` (Alabama and all
games), `/rushing/plays` (Alabama), `/games/players` (Navy), `/games/teams` and
`/stats/game/advanced`.

Key handling for the future client: read it from an environment variable or a
git-ignored file. Never commit it or write it into cached responses or logs.
