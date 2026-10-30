# CFP Coach Simulator: how it works

The technical guide: running the game in the browser and on your own computer, publishing
it, the engine, the data, the calibration and the test tools. File paths are relative to
the project root. The player-facing overview is the [README](../README.md).

The game is Coach Career: take one of the 138 real 2026 FBS programs in `cfb_sim_data/`
(146 teams with the 8 fictional FCS schools) through the 2026 season as its head coach,
recruiting as you go, then the offseason and the seasons after. The engine is calibrated
against FBS season averages and against the real 2026 results played so far.

## Run it

The published site is <https://pattisonb.github.io/CFPCoachSimulator/>. It is static: the
whole game runs in the browser. `web/worker.js` starts Pyodide (CPython on WebAssembly, from
the jsDelivr CDN) in a Web Worker, unpacks `game.zip` (the Python packages and the data a
career reads) into its in-memory filesystem and calls the dispatcher, `app/api.py`, with the
same `/api/...` paths a server would answer; `web/game-client.js` is the page's side of it
(`window.CFP.game.fetch`). The first visit downloads about 20 MB, Pyodide included; the
browser keeps it after that. Sims run one week (or your game) per step in the worker, so the
page stays responsive and shows progress.

**Saves.** The worker's `data/seasons` and `data/coaches` folders are IndexedDB mounts
(IDBFS), written back after every call that changed a file, so a career is in the browser's
storage after every week and every recruiting action. They stay on that device and that
browser; clearing the site's data deletes them. **Download career** saves a career as a
`.ccsave` file and **Load career** opens one, which is how a career moves to another device.
**One tab at a time.** Each worker keeps its own in-memory mirror of the store and a write-back
replaces the whole store with that mirror, so two tabs would roll each other's saves back.
The worker takes the `cfp-game` Web Lock for its life before it mounts the store (a
`BroadcastChannel` ping where a browser has no Web Locks); a second tab's worker does not
start, and its overlay says the game is already open in another tab. When the store cannot be
read at start (IndexedDB blocked by a setting or a private window) the game still loads, plays
from memory and a toast says saves will not be kept in this browser; that session never writes
back to the store (a write-back of its empty mirror would delete the careers kept there).

On your own computer, with Python 3.12 and nothing else installed:

```
python -m teamdata.build_teams
python tools/dev_server.py
```

Then open <http://127.0.0.1:8000>. On Windows, `run.bat` starts the dev server.
`python -m teamdata.build_teams` builds `data/engine_teams.json` and
`data/player_potential.json` from `cfb_sim_data/` (about 20 seconds); run it again whenever
the source data changes. `tools/dev_server.py` serves `web/` and answers `/api/...` from the
same dispatcher in this Python (one lock around the dispatcher, a background thread playing
a running sim a step at a time); its saves live on disk under `data/seasons` and
`data/coaches`.

The tests run natively: `python tests/run_all.py` (each `tests/test_*.py` as its own
process). The browser tests (`test_career_e2e.py`, `test_offseason_e2e.py`, `test_ux_sweep.py`,
`test_browser_runtime.py`) need Playwright (`pip install -r requirements.txt`, then
`playwright install chromium`); `test_browser_runtime.py` also needs network access to the
Pyodide CDN and takes a few minutes.

### On a phone

`python tools/dev_server.py --host 0.0.0.0` lets a phone on the same Wi-Fi open the site at
`http://<this PC's address>:8000` (`ipconfig` shows it as the Wi-Fi IPv4 address). The
page is laid out for phones, and on iPhone "Add to Home Screen" installs it as an app icon.
Two things can block it:

- **Windows Firewall.** Windows blocks Python on networks marked Public. Either mark your
  home Wi-Fi as Private (Settings > Network & internet > Wi-Fi > your network > Private),
  or allow Python through the firewall for Private and Public networks.
- **Address changes.** Home routers can hand the PC a different address after a restart;
  check it again if the phone stops connecting.

## GitHub and publishing

The code lives at <https://github.com/pattisonb/CFPCoachSimulator>. Generated files
(`data/engine_teams.json`, `data/player_potential.json`, `dist/`, `data/base_league.json`,
`data/base_meta.json`) are ignored and rebuilt; the source data, box scores and season
results are committed.

Every push to `main` (or a manual run) starts `.github/workflows/pages.yml` on GitHub
Actions: Python 3.12, `python -m teamdata.build_teams`, then `python tools/build_site.py`,
which writes `dist/` (the `web/` files, `game.zip`, `version.json` and `.nojekyll`; the first
offseason's league is precomputed into `data/base_league.json` and `data/base_meta.json`
first), and `dist/` is published to GitHub Pages. No pip install step: the game and the
build use the standard library only. The one-time setting is in the repository's Settings →
Pages: Source: **GitHub Actions**; the site's URL shows there after the first deploy.

The data refresh tools (`tools/fetch_*.py`, `tools/forward_test.py`, the realism and
calibration tools) stay on the owner's computer; what they write under `data/` is
committed and goes out with the next push.

## House style for team marks

Every team mark on the site is the diagonal square from `teamPill(slug)` in
`web/gameview.js`: primary over secondary on a diagonal with the accent color as the
border. Never draw a flat single-color square (`pill-inline` with an inline background);
the only plain square is the gray "empty" placeholder for a slot with no team yet.

## What is where

| Path | What it is |
|---|---|
| `cfb_sim_data/` | Source data: rosters with EA-derived ratings, coaches, stadiums, colors (see its README) |
| `teamdata/` | Team data: the build step, the player attributes and our rating scale (`python -m teamdata.build_teams`) |
| `teamdata/build_teams.py` | Converts the source into the engine's roster format (rating map and normalization below) |
| `teamdata/ratings.py` | The player card attributes and traits (docs/RATINGS_V2.md) |
| `teamdata/game_scale.py` | Our 1-99 rating scale and overall, frozen in `data/game_scale.json` |
| `data/engine_teams.json` | The converted league the game loads (10 MB, generated) |
| `engine/` | The simulation engine; `engine/game.py` plays a full game and returns a result dict |
| `engine/game_config.py` | Sliders and every calibration constant |
| `app/api.py` | The dispatcher: every `/api/...` route as a plain function, called by the browser worker and the dev server |
| `tools/dev_server.py` | Serves `web/` and the dispatcher on this computer (`python tools/dev_server.py`) |
| `tools/build_site.py` | Builds the static site into `dist/` (`web/`, `game.zip`, `version.json`) |
| `web/worker.js`, `web/game-client.js` | The game in the browser: Pyodide in a Web Worker, saves in IndexedDB; the page's client for it |
| `.github/workflows/pages.yml` | Builds `dist/` and publishes it to GitHub Pages on every push to `main` |
| `sim/` | The season simulation: the season engine, polls, bowls, awards, in-season form, head coaches, the real box score import |
| `web/` | The site: plain HTML, CSS and JavaScript, no build step |
| `tools/fetch_results.py` | Downloads the 2026 FBS results played so far from NCAA.com into `data/season_games.json` |
| `tools/fetch_schedules.py` | Downloads every FBS team's 2026 schedule from ESPN into `data/schedules.json` |
| `sim/season.py` | Week-by-week season engine: polls, title games, bracket, playoff (`python -m sim.season ohio-state full`) |
| `sim/polls.py` | AP poll model, committee model and the 2026 bracket rules |
| `sim/awards.py` | The awards: Heisman vote, national awards, All-America and all-conference teams, coaches |
| `sim/teamnames.py` | Matches real-world team names (NCAA.com, ESPN, poll archives) to the engine's slugs |
| `sim/form.py` | In-season form from the real results and box scores |
| `sim/coaches.py` | Head coaches: ratings, the coach page and how a coach changes his team's play |
| `sim/realdata.py` | The real box score import (`python -m sim.realdata`), for the owner's tuning and research tools |
| `data/rivalries.json` | Rivalry games, trophies and the all-time series entering 2025 |
| `tests/` | The checks, one script each, run as files: `python tests/run_all.py` runs them all and reports pass/fail |
| `tools/` | Data downloads, calibration and research scripts, run from the project root (`python tools/fetch_polls.py`) |
| `sim/bowls.py` | The 2026-27 bowl lineup, selection by conference tie-ins, and which bowls host the playoff rounds |
| `tools/fetch_bowls.py` | Downloads the bowl schedule and every bowl's tie-ins and history from Wikipedia into `data/bowls.json` |
| `tools/fetch_polls.py`, `tools/analyze_polls.py`, `tools/calibrate_polls.py` | 2014-2025 poll archive, the behavior study, and the model fit |
| `tools/calibrate_season.py` | Replays every real 2026 game N times and compares predicted and actual margins |
| `tools/calibrate.py` | Per-team stat benchmarks against FBS 2025 averages (`league` mode uses the real rosters) |
| `tools/fetch_linescores.py`, `tools/calibrate_late.py` | Quarter scores 2014-2025 and the late-game comparison (close games, comebacks, overtime) |
| `tools/fetch_boxscores.py` | Downloads every played game's player box score into `data/boxscores/` |
| `tools/derive_tendencies.py` | Each team's real 2026 pass rate, pace and usage shares, used by `teamdata/build_teams.py` |
| `tools/calibrate_players.py` | Compares sim player lines and usage shares with the real box scores |
| `tools/forward_test.py` | Freezes the sim's picks for the next week of real games, then scores them once played |
| `data/predictions/` | The frozen weekly picks (`weekNN.json`) and their score reports (`weekNN_score.*`) |
| `coach_career/` | Coach Career: the career, recruiting, prospects, a career's league, the offseason, the carousel |
| `coach_career/career.py` | Coach Career: the career block on a season, and its saves (export, import, keep the newer copy) |
| `coach_career/recruiting.py` | Coach Career recruiting: the class, schools' pulls, actions, AI schools, commitments, signing, scouting |
| `coach_career/prospects.py` | Prospect Profiles: evaluations, comps to real starters, list rows and the Recruiting tab's data |
| `coach_career/recruits.py` | Generated recruiting classes, and every player's potential and coachability |
| `coach_career/league.py`, `coach_career/offseason.py` | A career's own league and the offseason between seasons |
| `coach_career/carousel.py` | The coaching carousel: AD goals, firings, hires, the coaching market |
| `coach_career/programs.py` | Program ratings: every program's living rating (prestige, winning, NIL, market, conference, coach), its tier and the AD's goal |
| `tools/build_program_history.py`, `tools/build_program_market.py`, `tools/check_programs.py` | The starting values (thirty seasons of results; real crowds and TV) in `data/program_history.json` and `data/program_market.json`; the drift check |
| `tools/check_carousel.py` | Plays quick offseasons and counts the carousel's churn against real years |
| `web/recruiting.js`, `web/scouting.js`, `web/careersave.js` | The Recruiting, Prospects and Scouting tabs; Download career and Load career (`.ccsave` files) |
| `tools/check_recruiting.py` | Plays career seasons and holds their recruiting to the real classes |
| `tools/clean_data.py` | Clears the generated data that piles up under `data/` (orphan league files, box scores without a season, long-run output) and the site build (`dist/`, `data/base_*.json`); dry run by default |
| `tools/export_ratings.py` | Every real player's ratings and potential on the game's scale as one JSON file (`data/player_ratings.json`, generated) |

## API

The dispatcher (`app/api.py`) answers these paths; `api.call(method, path, body)` returns a
dict (or bytes, for a save file) or raises `ApiError(status, message)`.

- `GET /api/teams` lists every team with ratings, colors, stadium and head coach.
- `GET /api/teams/{slug}` adds the roster with starters, returners and display ratings.
- Seasons: `POST /api/season`, `GET /api/seasons`, `GET` and `DELETE /api/season/{id}`, `DELETE /api/seasons`;
  `POST /api/season/{id}/advance` and `/gameday` start a sim that `api.step()` plays a week (or your game) at a
  time, `GET /api/season/{id}/status` reports it and `POST /api/season/{id}/pause` stops it.
- Coach Career (404 `not a Coach Career` on any other season): `GET /api/season/{id}/recruiting`
  (hours, NIL points, offers, your board and the week's news), `GET /api/season/{id}/prospects`
  (`position`, `stars`, `state`, `status`, `q`, `offset`, `limit`), `GET /api/season/{id}/prospect/{pid}`
  (the Prospect Profile), `POST /api/season/{id}/recruit` `{"pid", "action", "pitch"?, "nil"?}`,
  `POST /api/season/{id}/board` `{"pid", "on"}`, `POST /api/season/{id}/staff` `{"staff_id", "area"}`,
  `POST /api/season/{id}/settings` `{"auto_recruit"}`, `GET /api/season/{id}/export` (`?full=true` adds
  every box score) and `POST /api/season/import`.
- `api.routes()` lists the rest (the week, schedules, standings, stats, depth charts, the offseason, coaches).

## How the data feeds the engine

**Players: our ratings** (`teamdata/game_scale.py`, `data/game_scale.json`). The source rosters came with
EA College Football's ratings; they were only the jumping-off point. Once, from the 2026
rosters, the game froze its own scale: each of 54 skills per position group on 1-99, where 50
is the middle Power 4 starter at the position, 15 points a standard deviation above him and 9
below (a typical Power 4 backup or Group of 5 starter reads about 40, a walk-on in the 20s); the
player card attributes on the same shape (`tests/test_scale.py` holds every position and
attribute to 50); and **our overall**, a formula per position on those skills, fit once to the
card overall the game showed then (r 0.97-0.995, about 1.5 points off); the card shape is re-centered
when the real depth charts are re-tuned (`python -m teamdata.game_scale`, October 26 after the week 8
re-tune: the skills' middles and the frozen engine means did not move). Since then nothing reads
EA: a career's league and its recruits store our ratings, develop in them, and every overall the
game uses is ours (cards, depth charts, team ratings, the draft, the portal, recruiting's playing
time, comps, projected overall). Generated recruits are drawn by a model learned from real
players and converted the moment they are made; careers saved in EA numbers convert on load. A
god-mode edit moves the card overall by what the edit does to the engine composite.
The engine works on its own position-relative values underneath (an average FBS starter
at the position is 55, scaled by `SPREAD_SCALE`): it reads our ratings back through the frozen
scale into the formulas it was tuned on, so 2026 plays exactly as it did (the same fingerprint).
`teamdata/build_teams.py` maps them to the engine's attributes: throw accuracy and power to
passing, awareness and throwing under pressure to decision making, agility, jukes and
break tackle to elusiveness, man and zone coverage to coverage, power and finesse moves
plus block shedding to pass rush, and so on (the full map is in the file's docstring).
Every attribute is then re-centered so that the league-average FBS starter at that position
group sits at the engine's neutral rating, with the spread between players scaled by
`SPREAD_SCALE` (1.38, set by the season replay). The engine's formulas work on rating
differences, so this keeps a league of these teams playing like FBS football while
keeping who is better than whom. Starters come from the data's depth chart (11
personnel on offense, nickel on defense); the rest of the 85-man roster rotates in on fatigue.

**Returners are roles, not roster slots.** The designated kick and punt returners return
kicks whether or not they start. If a team has no designated returner, the engine picks
the best return rating: 35% EA kick-return skill, 20% speed, 15% acceleration, 15%
elusiveness, 10% vision, 5% ball security. Return yardage and return-touchdown odds use
the same rating.

**Punts** (`_attempt_punt` in `engine/drive_functions.py`, constants `PUNT_*` in
`engine/game_config.py`). The kick carries `PUNT_DISTANCE` (44.2 yards, sd 5) plus a fifth of
the punter's power above 50. One that would carry inside the 10 is aimed short: it is
fair-caught or downed between the 1 and the 12 (75% for an average punter, more with
accuracy) or goes into the end zone for a touchback. Anything shorter is returned 54% of
the time (28% when it lands inside the 20); a return is usually a few yards with an
occasional breakaway, and a better returner gains more. The rest are fair catches, downed
after a short roll (sometimes into the end zone) or kicked out of bounds. Across 400
random FBS games: 34% of punts returned for 8.5 yards a return, 7% touchbacks, gross 43.4
and net 39.2 (real FBS: about 43 and 39.5). Gross is the official distance (to the goal line
on a touchback); net takes off the return and 20 yards a touchback.

**Coaches.** The coordinators' pass-rate and tempo tendencies shift the run/pass table and
the clock, the head coach's fourth-down tendency scales the go-for-it odds, and the
play-calling ratings of the two coordinators tilt whether the defense guesses the play.
Tendencies are centered so the FBS average is 50. Army, Navy and Air Force run about 70%
of their snaps.

**Venue.** At a home site the home team gains and the away team loses half of a home
edge of 2.0 rating points plus up to 0.8 for stadium size (the data's 0-99 home field
number), which comes to about 4 points of margin for a big stadium. A neutral site applies
nothing. The `home_field_advantage` slider scales it.

## Any given Saturday: upsets

Each team plays a little above or below itself on the day: a gaussian shift of
`GAME_FORM_SD` (3.6) rating points per team per game, drawn once before kickoff on the
same attributes as home field and shown in the box score's meta line. It widens the
spread of outcomes from a 13-point standard deviation to about 16, which is what real
college football shows around the closing line, so a 21-point favorite now loses about
one game in ten and a 28-point favorite a few in a hundred (they lost almost never
before). `python tools/upset_odds.py` simulates seven mismatches 200 times and prints the
upset rate and margins; `tools/calibrate_season.py` showed the sim's margins were not too
steep (actual margins run 15% larger than predicted on the 2026 games), only too sure of
themselves in the 7-to-14-point range.

## How realistic is it?

Three checks, all reproducible.

**Season replay** (`python tools/fetch_results.py` then `python tools/calibrate_season.py 30`): the 388
games played through week 8 of 2026 between two FBS teams, each simulated 30 times at
the real venue, compared with the real score.

| Measure | Sim | Reference |
|---|---|---|
| Straight-up picks correct | 71.1% | Vegas favorites win about 75-78% |
| Margin error (mean absolute / RMS) | 12.9 / 16.7 | Closing spreads: about 12-13 / 16-17 |
| Slope of actual on predicted margin | 1.01 | 1.0 means rating gaps are worth exactly what the sim says |
| Home bias (actual minus predicted, home games) | -0.1 points | 0 |
| Combined points, actual vs predicted | 52.0 vs 52.9 | |

By predicted margin the real results track the sim all the way out: home teams the sim
makes 14-to-21-point favorites won by 16.0 (sim 16.9) and 84% of the time (sim 84%), and
21 or more by 32.5 (sim 29.8), 95% (sim 96%). Before the October 19 tuning (below) the
biggest mismatches ended about 5 points too close (slope 1.10).

**League benchmarks** (`python tools/calibrate.py league 400`): 400 random FBS matchups with the
real rosters, per team per game, against the mean of all 137 FBS teams in 2025 read from
TeamRankings on 2026-10-15. Official stats count a sack as a rushing play for the yards it
lost, so the tool counts the sim's rushing the same way (the engine keeps sacks apart).

| Stat | Sim | FBS 2025 | Stat | Sim | FBS 2025 |
|---|---|---|---|---|---|
| Points | 25.1 | 25.9 | First downs | 19.4 | 20.0 |
| Plays | 65.6 | 68.7 | Third down % | 42.9 | 39.0 |
| Total yards | 366 | 375 | Red zone trips / % | 3.85 / 85 | 3.5 / 83 |
| Yards per play | 5.6 | 5.46 | Fourth down tries / % | 1.5 / 55 | 2.1 / 53 |
| Completion % | 63.4 | 61.7 | Punts / gross / net | 4.15 / 43.4 / 39.2 | 4.1 / 43.0 / 39.5 |
| Yards per attempt | 7.4 | 7.24 | Field goal tries / % | 1.3 / 77 | 1.6 / 75 |
| Yards per carry (sacks as rushes) | 4.05 | 4.23 | Penalties | 5.9 | 6.0 |
| Sacks taken | 2.2 | 2.03 | Giveaways | 1.45 | 1.32 |

31 of 32 checks are inside their band (October 19, after the punting change); fourth-down
tries run a little low. Combined points 50.0 (51.7), and the margins of random FBS matchups
spread 21.1 points (real FBS-vs-FBS games 2023-2025: 21.8-22.2). Before punts had fair
catches and touchbacks, every punt short of the 10 was returned 5-15 yards and the same
run gave 53.3 combined points and 4.05 red zone trips.

**Season stats against real seasons** (`python tools/fetch_leaders.py`, then
`python tools/realism.py --seeds 3`): whole simulated seasons, bowls and playoff
included, against the real 2023, 2024 and 2025 seasons from cfbstats.com (the national
top 100 by season total in each category, and every FBS team's per-game offense; only the
numbers are kept, in `data/history/fbs_leaders.json`). Sim and real (the three-season
average) at each rank:

| | #1 | #10 | #25 | #50 |
|---|---|---|---|---|
| Passing yards | 4,303 / 4,687 | 3,435 / 3,635 | 3,088 / 3,157 | 2,765 / 2,724 |
| Rushing yards | 2,133 / 1,997 | 1,487 / 1,362 | 1,183 / 1,155 | 976 / 969 |
| Receiving yards | 1,568 / 1,497 | 1,239 / 1,159 | 1,040 / 1,018 | 891 / 880 |
| Tackles | 215 / 163 | 130 / 130 | 113 / 114 | 101 / 103 |
| Sacks | 15 / 16 | 11 / 10 | 10 / 9 | 8 / 7 |
| Interceptions | 7 / 7 | 5 / 5 | 4 / 4 | 4 / 4 |

Over the usual marks (sim / real 2023, 2024, 2025): 3,000-yard passers 32 / 34, 30, 37;
1,000-yard rushers 45 / 45, 51, 44; 1,000-yard receivers 30 / 33, 28, 22; 100-tackle
players 56 / 59, 51, 64; 5-interception players 17 / 18, 20, 22; 10-sack players 24 /
17, 15, 17. Teams, best / median / worst per game: points 42.8 / 26.9 / 15.0 against
44.8 / 27.6 / 13.2; yards 470 / 368 / 259 against 531 / 387 / 238; plays 76.0 / 65.8 / 55.9
against 78.3 / 66.8 / 56.3. What is left: the very best offenses (about 7.8 yards a play
in real seasons, 6.7 in the sim) are still not quite as explosive, lead backs carry about
10% more for the same yards, and the number-one tackler of a season runs high (one
linebacker on a team that faces many plays). The same tool compares the first 8 weeks of
a simulated 2026 with the real 2026 box scores: team scoring is about 10% higher than the
real season so far (2026 is a lower-scoring year than 2023-2025, which the engine is tuned
to), and real player totals run a few percent low because 7% of real stat lines do not
match a roster player.

**The October 19, 2026 tuning** that got it there, from the first run of
`tools/realism.py`:

- **Blowouts.** Real FBS-vs-FBS games end 42 or more apart 8-9% of the time; the sim had
  2-3%, so good teams never ran up the yardage real ones do. Garbage time came on too early
  (now a 35-point lead in the second half, 45 any time; was 28 and 38), slowed the clock
  less (1.15, was 1.30), ran less (0.25, was 0.35) and kept more of the big plays (0.75,
  was 0.5). Starters sit at 42 (was 35), and on both sides: the trailing team used to keep
  its starters in against the leader's backups.
- **Team rating spread** 1.38 to 1.50 (`build_teams.SPREAD_SCALE`) and **tempo** 0.40 to
  0.60 (`TEMPO_EFFECT`): the gap between the best and worst teams, and between fast and
  slow ones, closer to real seasons.
- **Rushing** was about 15% short of real once sacks are counted the official way (the
  benchmark used to compare the sim's sack-free rushing with official rushing that
  includes them); `RUSH_BASE_YARDS` 3.4 to 3.75.
- **Tackles.** Middle and left outside linebackers were never credited with a tackle (a
  position lookup missed them), so the line had 40% of all tackles. Tackles now go by
  position group with the middle linebacker usually the team's leader, 30% are assisted
  (was 20%), and the better tackler at a spot gets more of them
  (`TACKLE_WEIGHTS_*`, `TACKLE_SKILL_POWER`, `TACKLE_ASSIST_CHANCE`).
- **Sacks and interceptions** lean toward the best pass rusher and cover man
  (`SACK_SKILL_POWER` 1.3, `INT_SKILL_POWER` 1.5): five-interception players 14 to 17,
  real 18-22.
- **Quarterbacks and backs get hurt more** (`INJURY_POSITION_MULT`: QB 2.2, RB 1.7): real
  teams start more than one passer and lead back over a season; 3,000-yard passers 38 to 32.
- **Receivers.** A real-usage target weight is capped at 2 (`TARGET_MULT_MAX`, was up to 3)
  and targets are a little less steep (`TARGET_WEIGHT_POWER` 4, was 5): the season's top
  receiver 1,782 to 1,568 yards (real 1,497).

The play-log fingerprint is now 18d9479c93b6e1e5. On the week 7 forward test (the same
59 games and rosters) the picks went from 61.0% to 67.8% straight up, the margin error
from 11.8 to 11.2 points (RMS 15.8 to 14.2) and the distance from the closing line from
7.4 to 4.8 points; against the spread 64.9% to 59.6%. Every constant lives in
`engine/game_config.py`; change one, rerun the three tools, and compare.

**Punting (October 19, later).** Punts now end in fair catches, downed balls, kicks out of
bounds and touchbacks as well as returns (see "Punts" above), and `tools/calibrate.py`
reports gross and net separately (it used to compare the gross with the real net). Gross
43.4 and net 39.2 (real 43 and 39.5); `tools/realism.py` now prints the net punting
leaders, #1 44.7 over three seasons (real leaders net about 44-46). Receiving teams start
about ten yards further back than when every punt was returned, so scoring fell: combined
points 53.3 to 50.0 in `calibrate.py league 400` (real 51.7), 52.9 to 50.5 in the season
replay (real 52.0), and the replay's slope rose from 1.01 to 1.07 (predicted margins a
little narrower than the real ones). The engine's offense has not been retuned for this.
The play-log fingerprint is now d85b69de4e69a568.

## Game randomness and defense weight (overnight review, items 2.2 and 2.4)

The overnight review (10 simulated seasons against the real 2026 season through week 8,
team by team) found records bunched toward .500 for two engine reasons. The same
matchup swung 17.5 points from game to game, more than real football's whole unexplained
spread (15.9). And defense counted for too little: points allowed per defense-rating point
were -0.28 in the sim against -0.50 real, while offense counted for too much (0.73 against 0.58).

- **Less day-to-day form** (`GAME_FORM_SD` 4.4 to 2.5).
- **Coverage matters more** (`COMPLETION_PER_COV_POINT` 0.0025 to 0.0032) and the QB a
  little less (`COMPLETION_PER_QB_POINT` 0.0030 to 0.0026); `COMPLETION_BASE` 0.645 to 0.637
  keeps league completion at 63%.
- **The ball carrier runs against the defense.** His rating is measured against the front
  seven's pursuit (speed and tackling) instead of a neutral 55, so a slow front gives up more.
- **Tackling limits yards after the catch** (`PASS_TACKLE_EFFECT` 0.006 per point of the
  coverage players' tackling); WR catch yards 12.6 to 12.3 hold yards per attempt at 7.4.
- **Home field 2.0 to 1.7 rating points**: the bigger defense terms made each rating point
  worth more, and the predicted home margin had grown to 8.2 against a real 7.1.

| 10 seasons through week 8 | Real | Before | After |
|---|---|---|---|
| Same-matchup margin SD | (15.9 residual) | 17.5 | 15.9 |
| Favorite wins, rating gap 6-10 | 92.5% | 77.6% | 84.2% |
| Power 4 over Group of Five | 96.2% | 87.9% | 92.8% |
| Points allowed per defense-rating point | -0.50 | -0.28 | -0.51 |
| Points scored per offense-rating point | 0.58 | 0.73 | 0.65 |
| Bottom-third defenses, points allowed | 30.2 | 28.4 | 30.7 |
| Sim favorite won (388 games) | | 68.6% | 70.6% |
| Brier score | | 0.202 | 0.195 |

`tools/calibrate_season.py 30` (the real games so far): straight up 71.6% to 73.5%, margin
MAE 12.9 to 12.7, correlation 0.59 to 0.61, home bias +0.1 to -0.5. League scoring is
27.1 points a team-game against 26.0 real; the extra passing touchdowns and punt returns
(items 2.3 and 2.6) are the known causes, left for their own fixes. Play-log fingerprint ebe00215526c19dd.

## Red-zone passing (overnight review, items 2.5 and 2.6)

The sim threw 25% too many touchdown passes (1.81 a team-game against 1.53 real; 9.7% of
completions against 8.1%) and kicked too few field goals. A short field now squeezes the
coverage (`REDZONE_COMPLETION`: -0.06 completion inside the 20, -0.10 inside the 10), and
`COMPLETION_BASE` 0.637 to 0.641 keeps league completion at 62-63%. Over 20 seasons through
week 8: touchdown passes 1.81 to 1.67 a team-game (9.0% of completions), field goals made
0.97 to 1.05, with game picks unchanged (favorite won 72.6% / 72.8%).

Two other changes were tested the same way (20 seasons each, one change at a time) and
left out:

- **Fewer interceptions** (the scramble decided before the throw, `INT_BASE` 0.065 to
  0.060; and the review's flatter slopes, 0.0013 to 0.0007 a point). Interceptions fell from
  3.0 to 2.5 per 100 attempts (real 2.3 through week 8, 2.6 over the 2025 season), but every
  run with it picked fewer winners: favorite won 70.2% against 72.6%, Brier 0.190 against
  0.177. Interceptions are one of the places where QB and coverage ratings decide games, so
  they stay; the worst cases (low-rated QBs who throw few real interceptions) are rating
  cards to fix, not the engine.
- **Kicker accuracy** (`FG_PER_ACCURACY_POINT` 0.004 to 0.002) made no difference to field
  goals made.

`tools/calibrate_season.py 30`: straight up 72.7%, margin MAE 12.7, slope 0.99, home bias
-0.1. Play-log fingerprint 6ffc7217ca716433.

## Tackles (overnight review item 2.8 and the full-season check)

Over full seasons the sim had 84 hundred-tackle players against 51-64 in real 2023-2025
seasons, and every leaderboard rank from #1 to #100 ran 8-14% high. Team totals were right
(67.7 tackles a team-game against 66.6 real), so the tackles were too concentrated. Changing
defensive rotation moved it little: on-field shares were already about 65% for the top
linebacker. The causes were elsewhere:

- **No special-teams tackles.** Real totals include about 3-4 coverage tackles a team-game
  on returned kicks and punts, mostly by second-string linebackers and defensive backs. A
  returned kickoff or punt now ends in a coverage tackle (`play_functions.credit_coverage_tackle`,
  `COVERAGE_TACKLE_WEIGHTS` 0.3 / 1.0 / 0.4 for the starter, the second-stringer and the rest).
- **Every gain ended in a tackle.** 16% of gains of 4+ yards now go out of bounds with
  nobody credited (`NO_TACKLE_CHANCE`), which keeps the team total level.
- **The best tackler at a spot took too much.** `TACKLE_SKILL_POWER` 1.0 to 0.7.
- **Shared tackles are scored the NCAA way:** an assist each (was a solo and an assist),
  with `TACKLE_ASSIST_CHANCE` 0.33: assisted / solo about 1.0 against 0.94 in real 2026 box
  scores (was 0.28). The review suggested 0.38-0.40, which under NCAA scoring would have
  overshot.
- **The defensive line** made 23% of tackles (real about 20%): its short-run weight 0.22 to
  0.18 and mid-run weight 0.08 to 0.065. Cutting it to the review's 0.13 sent the tackles to
  the linebackers who already led and raised the hundred-tackle count to 114.
- **Forced fumbles** were credited on every fumble (1.03 a team-game against 0.67 real);
  `FORCED_FUMBLE_SHARE` 0.7.

Result (4 full seasons): hundred-tackle players 64 (real 51-64), tackle leaders within 1%
of real at ranks 5-100 (mean gap 10% to 2%). Game picks held (20 seasons through week 8:
favorite won 72.4% before, 73.6% after; Brier 0.187, 0.182; `calibrate_season.py 30`:
74.0%, MAE 12.5, slope 1.01). One cost: sim players who never appear in a real box score
but play 5+ sim games rose from 170 to 188, because coverage tackles give backups a stat
line. Play-log fingerprint 5368e4b5cb876edc.

**More fourth-down tries (left out at first, kept on a 40-season retest).** The sim goes for it 1.5 times a game
(real 2.1) and tries 1.4 field goals (real 1.6). Multiplying the go-for-it odds by 1.8
short of the opponent's 40 or on fourth-and-1 or 2, and trying 60% of 50+ yard field goals
instead of 45%, gave 1.7 tries a game at a 52% conversion rate, points +0.7 a game in
`calibrate.py league 400` (+0.3 over full seasons), and every benchmark in band. It cost
picks in both checks: 20 seasons through week 8, favorite won 73.6% to 71.4% and Brier
0.182 to 0.187; `calibrate_season.py 30` 74.0% to 71.9%. More fourth-down tries add variance,
which helps underdogs. (A version applying the multiplier everywhere took the tries from
field-goal range: 1.8 tries but 1.25 field goals.)

Retested later on 40 seasons, once the run-to-run noise had been measured (about +-0.004
Brier and 2-3 points of favorite-won rate on 20 seasons) and on top of the margin-corrected
fourth-down tendencies: favorite won 75.0% to 75.9%, Brier 0.173 to 0.171, wins correlation
0.656 to 0.667; `calibrate_season.py 30` 71.9% both, MAE 12.7 to 12.8. League (400 games):
1.6 tries a game at 53% (real 2.1 at 53%), combined points 52.0 (real 51.7), field goals 1.4.
So it is in (`FOURTH_DOWN_AGGRESSION` 1.8, `FG_LONG_ATTEMPT_CHANCE` 0.6). Play-log fingerprint
4702d67fb4482f2d.

**The pass lean, halved.** Over full seasons against real 2023-2025, the full lean (0.016)
had teams passing 235 yards a game against 226 and rushing 148 against 157: 2026's first
eight weeks run more pass-heavy than whole past seasons. At 0.008 both sit within about 2%
(2026 week 8: pass share -0.5 points; 2023-2025: 231 pass yards, 150 rush yards a game), with
picks inside the noise (40 seasons: Brier 0.171 to 0.172; `calibrate_season.py 30` 70.1%, MAE
12.7, slope 0.95). Play-log fingerprint a4be3c99a12835b2.

**Still open: receiving leaders.** Over full seasons the receiving leaderboard runs about 20%
above real 2023-2025 seasons at ranks 1-50 (48 thousand-yard receivers against 22-33). It was
13% before this round (37); the receiver rating fix took it to 42 and the tempo and
fourth-down changes to 48. Per game the top receiver's share of catches is right (30% against
32% in 2026 box scores), so the excess is a season-level effect, most likely that sim
receivers miss fewer games than real ones. Not changed here.

**Tested and left out: fewer sacks.** Full seasons have 24-27 ten-sack players against
15-17 real, and every rank of the sack leaderboard runs 10-19% high (team sacks 2.25 a game
against 2.0), so it is volume, not who gets the credit. The review's `SACK_BASE` 0.050 to
0.046 with `SACK_PER_QB_POINT` 0.0004 to 0.0002 brought ten-sack players to 19, but cost
picks (20 seasons: favorite won 74.0% to 71.8%, Brier 0.182 to 0.184); the base cut alone
was worse (Brier 0.190, real-versus-sim wins correlation 0.66 to 0.61). The sack rate is
one of the places where line and QB ratings decide games, so it stays.

After the real-import fixes the sack leaderboard came back to real size on its own (13 to 20
ten-sack players over 4 full seasons, real 15-17). The other complaint, team sack totals too
narrow (UTEP is sacked 5.8 times a game; no rating gap took the sim past about 12% of
dropbacks), was retested on 40 seasons with a steeper line slope (`SACK_PER_LINE_POINT`
0.0015 to 0.0022): team sacks taken spread only 0.55 to 0.62 a game (real 0.92), the
real-versus-sim correlation stayed 0.32, and picks fell (favorite won 75.9% to 73.1%, Brier
0.171 to 0.176; `calibrate_season` slope 0.94 to 0.92). Left out: the spread is a rating
question (pass rush and protection cards), not the slope.

## Quarterback runs (overnight review item 2.7)

Designed QB runs came from QB1's share of his team's rushes less a flat 10 points (6 for
sacks, which college box scores count as rushes, and 4 for scrambles). Low-sack teams and
teams with a run-package second quarterback lost most of their designed runs: James Madison
3.7% (real 15-18%), Texas Tech 0.5, Notre Dame 0, NDSU 1.2. Now `tools/derive_tendencies.py`
counts every quarterback's carries (anyone who threw a pass, or is on the roster as a QB) and
the sacks the team took (the opponent's defensive line), and `teamdata/build_teams.py` takes the
team's own sack share and 4 points of scrambles off (`SCRAMBLE_SHARE`). Navy 34 to 44,
Army 29 to 39, Air Force 22 to 36, James Madison 4 to 15, Texas Tech 0.5 to 11, NDSU 1 to 7,
Kansas State 12 to 19. (The two new fields in `data/observed_tendencies.json`, `qb_all_rush_share`
and `sack_share`, come from the box scores on hand on October 20; the other fields were left as
they were, so the change is only this.) A designed QB run also reads the runner the way a
back's carry does, on speed, strength, elusiveness and vision (it used speed and strength
only, so Kansas State's Avery Johnson, elusiveness 80 and vision 93, gained 5.3 a carry
against 9.3 real).

League (400 games): yards per carry 4.05 to 4.2 (real 4.2), points +0.5 a team-game. Full
seasons: carries leaders' gap 9% to 4%, rushing leaders 5% to 4%. Game picks are mixed: the
Brier score is the best of this round (20 seasons through week 8: 0.182 to 0.181) and the
margin error held (`calibrate_season.py 30`: MAE 12.4, slope 1.00), but the favorite won
less often (73.9% to 71.1%; `calibrate_season` 74.5% to 72.2%; the October 20 baseline before
this round was 72.7% in both). The share fix alone was worse on every measure (Brier 0.185),
so the two go together. Rebuild the teams after pulling this (`python -m teamdata.build_teams`).
Play-log fingerprint 098527ba508d3a73.

**Flexbone fullbacks.** Air Force, Army and Navy's dive fullbacks carry 30-44% of the time
for real; at the usual fullback weight (0.10 next to a halfback's 0.80) they got 6-8%. A
Flexbone Triple Option team now gives its fullback a weight of 1.5
(`FLEXBONE_FB_CARRY_WEIGHT`), and a team that almost never throws (pass_rate 5 or lower)
may run up to 96% of the time instead of 92% (`RUN_CHANCE_MAX_OPTION`): fullback share
Navy 28%, Army 33%, Air Force 35% over 30 games each. The academies' games are now picked
better (Brier over their 16 games through week 8 0.170 to 0.150). The other 409 games
changed only through what carries over inside a season (opponents' injuries, morale and
form), and that alone moved their Brier 0.172 to 0.176: a direct measure of the run-to-run
noise in these checks (about +-0.004 Brier, 2-3 points of favorite-won rate).
Play-log fingerprint 99510529d1e1827c.

**Blitzing defensive backs.** `blitz_rate` was written into every team but read nowhere,
and only linemen and linebackers rushed, so corners and safeties had no sacks (real 2026
through week 8: 158 of about 1,900). Now a sack goes to a corner or safety on the field
`DB_SACK_SHARE` 8% of the time at blitz_rate 50, scaled by the defense's blitz_rate (13 to
89 across FBS). It is credit only, drawn from the stat random stream, so every game score
is unchanged (checked on 40 games). Play-log fingerprint 0b3de0274cc130a7.

**3-3-5 fronts play three safeties** (Wake Forest, Troy, Tulsa and UAB do; `personnel.FRONTS`
had three corners and two safeties). Tested together with a 75/25 split between the second
and third running back (`BACKUP_RB_ROTATION` 0.40 to 0.20): picks held (20 seasons: favorite
won 69.8% to 72.0%, Brier 0.185 to 0.183; `calibrate_season.py 30` 72.2% to 70.9%, MAE 12.4
to 12.6), but the backs' carries matched real box scores worse (average miss 15.8 to 18.0
carries), so the running-back split was left out. Play-log fingerprint 33a30b0570a78958.

## Receiving leaders and repeatable seasons (October 20 check)

The full-season check after the overnight fixes had the receiving leaders 17% over real
2023-2025 seasons (45 thousand-yard receivers against about 28) while the passing leaders
matched. At week 8 each team's top receiver had about his real share (32% against 31%),
so the excess came from a few receivers whose early real share the sim held all season.

- **Real target shares count half at 30 catches** (`TARGET_SHRINK` in tools/tune_from_real.py,
  was 15). A receiver's share over his last four real games is partly a hot start; real
  seasons pull it back toward his ratings, and the sim now does too.
- **Targets a little less steep** (`TARGET_WEIGHT_POWER` 4.0 to 3.5); the real-usage weights
  are re-tuned against it.
- **Pass lean halved again** (`PASS_LEAN` 0.008 to 0.004): passing volume ran 4-7% over real
  2026 at week 8.

Tested one at a time over full seasons: dropping the receiver rating fix, a weaker speed
effect on catch yards, and following real shares more closely (all games, shrink 8) all
left the leaders 14-19% high.

**Seeded seasons repeat.** Games finish in any order across the worker processes and their
results were applied as they arrived; the morale baseline and the injury list depend on
that order, so the same seed gave a different champion on every run. Results are now
applied in schedule order (progress is still reported as games finish), and a seed gives
the same 950 scores every time.

## Passing by depth (ratings v2, phase 2)

The pass game now reads the ratings v2 attributes (docs/RATINGS_V2.md):

- **Every throw to a receiver or tight end has a depth.** Short (under 10 yards), intermediate
  (10-20) or deep (20+), with shares of 50 / 32 / 18% for receivers and 58 / 35 / 7% for
  tight ends. A receiver's speed and his Deep Routes over his route average tilt it deeper;
  garbage time and prevent defenses tilt it shorter. Backs catch short.
- **Depth sets the completion chance and the yards** (`DEPTH_COMPLETION`, `PASS_YARDS_SHORT`,
  `PASS_YARDS_MID`, `PASS_YARDS_DEEP`), replacing the old flat big-play roll. A short or
  intermediate catch can still break long (`PASS_BREAKAWAY_CHANCE`). Over 300 games: short
  54% of throws, 72% complete, 8.4 yards a catch; intermediate 33%, 59%, 16.2; deep 13.5%,
  40%, 35.
- **The attributes add how a player differs from his own average at each depth.** The
  composites still set his level, so league totals stay where they were:
  - the QB's accuracy at the throw's depth over his accuracy average
    (`DEPTH_ACCURACY_EFFECT`);
  - arm strength on deep throws (`ARM_DEEP_EFFECT`);
  - the receiver's route skill at the depth over his route average (`ROUTE_DEPTH_EFFECT`).
- **Man or zone is called on every pass play** (`MAN_COVERAGE_SHARE` 45% man). The coverage
  players' Man or Zone over their average of the two moves completion (`COVERAGE_TYPE_EFFECT`).
- **Contested catches.** 10% of short, 25% of intermediate and 45% of deep throws have a
  defender at the catch point. Completion then moves with the receiver's Contested Catches
  against the defender's Ball Skills, Leaping against Leaping, and height (two rating points
  an inch).

Controlled test (Ohio State against Penn State, 150 games each, only attributes changed):

| Change | Deep completion | Short completion | Contested completion |
|---|---|---|---|
| none | 57.6% | 83.5% | |
| Julian Sayin deep accuracy 95, short 60 | 62.3% | 79.6% | |
| Julian Sayin deep 50, short 99 | 54.3% | 85.5% | |
| Jeremiah Smith contested catches and leaping 20 | 50.3% | | 73.1% to 64.6% |

Against main before it (same checks): 20 seasons through week 8, favorite won 73.3% (70.6%),
Brier 0.181 (0.179); forward test MAE 12.5 (12.6), correlation 0.62 (0.60), straight up
71.6% (73.7%, eight games); full seasons, receiving leaders 7% over real (10%), receptions 2%
(6%), passing leaders 4% (3%). Play-log fingerprint 2fe2a3cb1e3a5d74.

## Running, pass rush, turnovers and traits (ratings v2, phases 3-6)

- **Running (phase 3).** Every carry goes inside or outside (`RUN_OUTSIDE_SHARE` 40%, tilted
  by the back's speed style over his power style). Inside runs read the line's Drive Blocking
  over Reach Blocking and the line's weight over the front's (against the usual 52-pound
  gap), against the front's Block Shedding; outside runs the reverse, against Pursuit. The
  carrier's power or speed style and Running Vision add yards; short yardage leans on Power
  Running and drive blocking. Controlled test, Bo Jackson as a power back: inside 85% of
  carries at 6.7 a carry; as a speed back: outside 75% at 6.6.
- **Pass rush (phase 4).** Each rush is power or speed (the rushers' style tilts it): Power
  Rush meets Pass Pro: Anchor, Speed Rush meets Footwork. Sack Escape slips sacks. A pressure
  that is not a sack now hurries the throw (completion -0.08, back up for Pocket Poise).
  Controlled test: power rushers against a line that cannot anchor double the sack rate
  (3% to 7% of dropbacks); a matched line holds it at 3%.
- **Turnovers and the body (phase 5).** Fumbles from Ball Security against the tacklers' Hit
  Power; interceptions more likely on deep (x1.65) and hurried throws and against ball-hawking
  coverage; Durability scales injuries and Football IQ penalties. Level effects are centered
  on the FBS starter average (`ATTR_LEAGUE_AVG` 46).
- **Traits (phase 6).** About 30 traits change games a little, per tier (`TRAIT_FX`): Pinpoint
  and Timing Passer (accuracy), Unflappable (pressure), Jump-Ball Winner, Glue Hands, Double
  Move, Breakaway Speed, Bulldozer, Road Grader and the line's traits, Pocket Collapser and
  the rushers' traits, Sure Tackler, Heavy Hitter, Iron Horse (stamina), Long Range and
  Automatic (kicking), Crowd Favorite and Road Warrior (venue).

The effects that reward absolute levels, and the traits, mostly favor teams that are
already better, so they widened margins: the forward test's slope fell to 0.78. They were
scaled down (level effects to 60%, traits to 30% of the first design) and home field to 1.5
rating points. Forward test against main before these phases: straight up 73.5% (71.6%),
correlation 0.62 (0.62), MAE 12.6 (12.5), slope 0.87 (0.94). 20 seasons through week 8:
records spread more like real ones (win SD 1.05 against 0.97, real 1.50) and favorites in the
6-10 rating gap win 87.6% (82.9%, real 92.5%).

## Diminishing returns at the top (October 21)

Ratings v2 took the forward test's slope (real margin on sim margin) from 0.92-0.97 to 0.81-0.86, and the
miss was all at the top of the scale. Through week 8 of 2026, FBS against FBS, 20 seasons through
`tools/team_reality.py`: real margin on sim margin ran 0.58 in Power 4 v Power 4 games, 0.73 across the
tiers and 1.02 in Group of Five v Group of Five games. A point of source rating gap was worth 1.4 real
points between Power 4 teams and 3.1 between Group of Five teams; the sim paid 2.0 in both. The source
ratings spread the tiers unevenly (team overall SD 4.9 for Power 4 teams, 2.6 for Group of Five; the
engine's starter composites 3.8 against 1.7) while real expected margins spread about 10 points in both.

`build_teams.team_level` (`TEAM_LEVEL_TOP_SCALE` 0.70, `BUILD_TOP_SCALE=1` builds without it): a team's level
is its starters' mean engine rating over NEUTRAL across the composites; above zero only 70% of it counts,
and every player on the roster moves down by the rest, so depth charts and the house-scale cards do not
change. 62 Power 4 teams move 0 to -3.9 engine points (Indiana, Oregon, Notre Dame, Ohio State the most);
Group of Five teams and FCS stand-ins do not move. A per-player kink (a steeper `SPREAD_SCALE` below the
position mean) widened both tiers, because Power 4 starters straddle the position means; a global shrink
(`SPREAD_SCALE` 1.2) reached slope 0.99 but left Power 4 v Power 4 at 0.78 and took the cross-tier margins to
+19.5 against +24.1 real.

Forward test (`calibrate_season.py 30`): slope 0.86 to 0.98, picks 72.2% to 72.7%, Brier 0.184 to 0.177, MAE
12.7 to 12.6; Power 4 v Power 4 slope 0.70 to 0.82, Group of Five games unchanged. 20 seasons under the same
tree: slope 0.82 to 0.90, Brier 0.186 to 0.179, MAE 13.0 to 12.7, wins correlation 0.65 to 0.66, favorite
won 72.2% to 73.5%. The two confidence rates the report tracks fell 1-3 points (favorite at rating gap 6-10
85.0% to 81.9%, Power 4 over Group of Five 93.1% to 92.3%; real 91.4% and 96.2%, n 70 and 78).

Two findings from the same review. The report's "records bunch toward .500" (win SD across teams 1.03
against 1.50 real) compared each team's 20-season mean wins with one real season; one season at a time the
sim's win SD is 1.46. And two numbers from the source file (1.8 points per overall point plus 3.4 at home)
predict real margins better than the sim does (R2 0.465 against 0.431): the sim's margin beyond the overall
gap has an SD of 5.8 points that reality does not reward, mostly extra weight on the starters' composite
average (+0.94 points per point in the sim, +0.16 real) and on the starting quarterback (+0.14 against
+0.03). That is the next gap to close.

## Quarterback and interception slopes (October 21, branch margin-noise)

Remeasured on the top-scale build (20 seasons through week 8 of 2026, FBS against FBS), the starters'
composite average is no longer over-weighted (+1.13 points per point beyond the overall in the sim, +1.30
real). The quarterback still is: the sim's margin paid +0.155 points per engine point of the starting QB
beyond the team overall, real margins +0.05 (se 0.06). Team stats show the formulas responsible. Per QB
engine point (all offensive units in the fit, same schedules), team completion % moved +0.20 in the sim
against +0.095 real, interception rate -0.055 against -0.004; per point of the secondary, interception
rate +0.067 against -0.007. Real interceptions barely follow the ratings.

`COMPLETION_PER_QB_POINT` 0.0026 to 0.0013, `INT_PER_QB_POINT` and `INT_PER_COV_POINT` 0.0013 to 0.0004. QB
margin weight beyond the overall 0.155 to 0.086; completion per QB point 0.20 to 0.12; interceptions per
QB point -0.055 to -0.022; league completion 63.7% to 64.3% (real 62.9%), interceptions 2.37 to 2.34 per
100 attempts (real 2.30). Forward test (`calibrate_season.py 30`): picks 72.7% to 73.2%, Brier 0.177 to
0.174, MAE 12.6 to 12.5, slope 0.98 to 1.09. 20 seasons: favorite won 71.4% to 73.2%, slope 0.92 to 0.985,
Brier 0.178 to 0.180, correlation 0.664 to 0.656, wins correlation 0.663 to 0.650. Game prediction is
unchanged within the tests' noise; the gain is in the passing stats. The cost: completion % spreads less
across teams (SD 4.3 to 3.1; real about 4.5 once a 7-game sample's noise is taken out).

Tested and left out: flattening the generated head-coach discipline to 50 (picks 73.2% to 72.2%, wins
correlation 0.650 to 0.621) and letting the secondary's speed and tackling cut long runs (defense's share
of the margin 0.62 to 0.66 against 1.00 real, Brier 0.182 to 0.185). Play-calling ratings pay what reality
pays (+0.01-0.03 points per point in both). Still open: the sim's margin pays offense more than defense
(per point of gap, offense 0.83 and defense 0.63 in the sim, 0.81 and 1.00 real).

## Coach styles

Coaches now change how a team plays, so a new coach or coordinator plays differently:

- **Offensive scheme** (`SCHEME_STYLE`): throw depth (Air Raid more deep and quick throws,
  West Coast short), run direction (Power Spread and Pro Style inside, Spread Option and Spread
  RPO outside) and how often play-action is used.
- **The OC's deep-shot and play-action rates.** Play-action is a real call now (20% of first-
  and second-down dropbacks at an average rate): the fake holds linebackers by the QB's
  Play-Action against the defense's Diagnosis (+0.05 completion on intermediate and deep
  throws, deep share x1.3), at the cost of a longer dropback (sack rate x1.15).
- **The DC's man-coverage and press rates** set how often his defense plays man and presses;
  press puts the receiver's Release against the corners' Press (0.00125 completion per point).
- **Blitz** (the DC's blitz rate): a blitz raises the sack rate 35% and long gains 35%; a
  defense that does not blitz gives back 12% of each. (At 60% and 20% the blitz magnified
  talent edges: team margins spread 4% wider than the ratings support and game picks fell.)
- **The head coach's discipline** scales penalties. Only the part his team's talent does not
  explain counts (`build_teams.decouple_discipline`): the source gives better programs more
  disciplined coaches, and their players' Football IQ already cuts their penalties, so the raw
  rating counted that edge twice and spread margins too far.

Same Ohio State roster, different offensive coordinators (120 games against Penn State): Air
Raid 27% deep throws and 3.6 plays of 25+ a game; West Coast 7.5% deep, 79% completion, 1.6
plays of 25+; Pro Style 34% play-action and 72% inside runs; Spread Option 47% outside runs.

## Your coach

Starting a season asks who coaches your team: **take over as the team's own head coach**
(his scheme and tendencies, as built) or **your own coach**, one you created on the Your
coach page (`/coach`, `web/coach.js`, `sim/coaches.py`; saved in `data/coaches/`, git-ignored).
Either way the team's coordinators stay for the season; staff changes come after it
(the offseason, with coach mode).

- **Who he is:** name, age, hometown, alma mater, the position and level he played. Story
  only; the Background box can be written by hand or filled from these choices.
- **Archetype and ratings:** six archetypes (Offensive Guru, Defensive Mastermind, Recruiting
  Ace, Program Builder, Players' Coach, Game-Day CEO) set starting values for seven ratings,
  which may total at most 525. In the sim today: his offense or defense rating is the
  play-calling rating on a side he calls, and his discipline moves penalties by the
  difference from the coach he replaces. Recruiting, development, game management and
  motivation are stored for coach mode.
- **Coaching style:** offensive and defensive scheme, and sliders on the league scale (50 =
  FBS average) for pass rate, tempo, deep shots, play-action, fourth-down aggressiveness,
  blitz, man coverage and press. When he calls his own offense, his scheme and the offensive
  sliders are used instead of the coordinator's (the coordinator stays on staff); the same
  on defense. Fourth downs always apply. Same Ohio State roster against Michigan, 40 games
  each: the team's own staff throws 27 passes a game; a coach calling a triple option 13; an
  Air Raid 37.
- **His look:** skin tone, hair, hair color, facial hair, glasses, headwear and sideline
  outfit, drawn as an SVG portrait (`web/coachsprite.js`) in the colors of the team picked
  for the preview.

The season page shows the coach, with his portrait when he is yours, and who runs each side
under the title. `coaches.OC_POOL` and `DC_POOL` hold fictional coordinators for the
offseason hiring to come.

## Recruiting model (learned from real classes; the recruits are fictional)

Recruiting will generate fictional classes every year, Dynasty style. The real classes only
teach the model what a class looks like and how each school and coach recruits.
`tools/fetch_recruits.py` downloads them from CollegeFootballData.com (a free key in
`CFBD_API_KEY`; about 125 of the 1,000 free monthly calls) into `data/recruiting/`, which is
git-ignored. `tools/recruiting_footprints.py` and `tools/recruiting_model.py` reduce them to
`data/recruiting_model.json` (185 KB, committed: distributions only, no real recruit):

- **Generation** (classes 2017-2026; counts from 2022-2026): 36 five-stars, 428 four-stars,
  2,487 three-stars and 1,141 two-stars a class. It also holds the composite rating spread
  inside each star band, the position mix by stars, height and weight by position (QB 74.0 in
  and 195 lb; OT 77.5 in and 287 lb), and each state's share of every star band (four-stars:
  TX 14%, FL 13%, GA 10%, CA 9%). Each state's 30 most productive towns, with coordinates, give
  generated players their hometowns.
- **Schools:** each school's class size, star mix, position mix, in-state share, home states
  and distance from home (Texas 68% in-state, median 187 miles; Boise State 13% and 676 miles,
  35% from California), and its class strength by year (a z-score of its class points among FBS
  teams that year).
- **Dynamics** (2,619 team-classes, 2005-2026): a school's level persists (a class correlates
  0.87 with the one before it). Schools' baselines spread 0.95 standard deviations; a class
  strays from its school's baseline by 0.36. Around the baseline, 0.28 of last year's deviation
  carries over, a season 25 points of win percentage above the school's norm adds 0.08, a new
  head coach's first class drops 0.13 and his second rises 0.16.
- **Coaches:** a coach's classes against his school's baseline (444 coaches with 3+ classes)
  spread 0.25. That edge barely travels: between a coach's consecutive jobs it correlates 0.07,
  so recruiting is mostly the school. His old school's top states rise from 17% to 20% of his
  new school's signees. The game's coach recruiting ratings (generated) do not match the
  measured edge (correlation -0.02 across 78 current coaches); they will be rebuilt from it when
  recruiting lands.

## Generated recruiting classes (`coach_career/recruits.py`)

`recruits.generate_class(year, seed)` builds a national class of fictional prospects (4,092:
36 five-stars, 428 four-stars, 2,487 three-stars and 1,141 two-stars) from
`data/recruiting_model.json`, following docs/PLAYER_DEVELOPMENT.md. The model's `players`
section is learned from the 8,300 real 2026 roster players matched to their own recruiting
record. A prospect is built in this order:

- **Stars and composite rating** from the real spread inside each band; then a **recruiting
  position**, then the **EA position** he plays (where real recruits at that position ended up:
  DL plays DT 73%, edge 27%; ATH plays WR, CB, safety, back and TE), a **hometown** (state by star
  band, then a real town) and **size** (within two standard deviations of real recruits).
- **Attributes, athleticism first:** the EA position's expected attributes at his composite
  rating (fit on 3,050 real first- and second-year players) plus the deviations of three real
  young players there, blended and rescaled to keep a real player's spread, plus noise. The
  main donor gives his archetype. Speed, burst, agility and jumping rise with stars and come
  with the donors; below the three-star floor a two-star's expected attributes follow at 15% of
  the slope (few two-stars are among the donors).
- **Potential per attribute:** room = the attribute's real career gain at his position (a
  fifth-year player against a true freshman), trimmed 15% for survivors, divided by the share
  an average player realizes in four offseasons, times a player-level potential (log-normal,
  spread 0.45) and a star factor (5* 1.0, 4* 0.75, 3* 1.6, 2* 1.8), with per-attribute spread.
  A receiver's speed gets about 1 point of room, his awareness and release about 20.
- **Coachability** from the six levels (2/8/20/40/20/10%), independent of stars.
- **Overall:** EA's overall from a ridge fit on the EA attributes per position and archetype
  (mean error about 1 point; QB 1.5), then the source curve, so `as_roster_player` hands
  build_teams a player in the source format.

`recruits.develop(p, rng, coach_factor)` is one offseason: each attribute closes
`rate x coach factor x (potential - current) x U(0.8, 1.2)` of its gap. `tools/check_recruits.py`
holds generated classes to the real players (four classes, source-scale overall, generated / real):

| Stars | Year 0 | Year 1 | Year 2 | Year 3 | Year 4 |
|---|---|---|---|---|---|
| 5* | 64.3 / 65.0 | 68.3 / 68.1 | 71.0 / 72.8 | 72.9 / 73.1 | 74.0 / 64.6 (11 players) |
| 4* | 53.7 / 53.0 | 56.6 / 55.2 | 58.8 / 57.5 | 60.2 / 61.0 | 61.1 / 60.4 |
| 3* | 42.5 / 42.6 | 47.2 / 45.5 | 50.9 / 48.9 | 53.5 / 54.7 | 55.5 / 56.9 |
| 2* | 37.0 / 39.2 | 42.0 / 42.9 | 45.7 / 46.9 | 48.5 / 51.2 | 50.6 / 52.9 |

Two-stars run 1-2 points under: the real ones are the two-stars who made FBS rosters, the
generated ones every two-star prospect. Young athleticism by stars matches within about 1 point
for three- to five-stars (WR speed 93.2 / 89.7 / 87.0 against a real 92.4 / 90.0 / 87.7), and
sizes match by position. Names recombine real recruits' first and last names (2,500 first,
7,510 last); `taken` keeps real roster names and earlier classes out.

**The real players** get the same two things (`recruits.seed_real_players`, written by
teamdata/build_teams.py to `data/player_potential.json`, git-ignored). Coachability: the league is ranked
by EA development trait, then within a trait by how far ahead of the real norm for his stars and
years he already is, and cut into the six shares exactly. Every Elite player is a Coach's Dream;
Star players are Film Junkies (the furthest ahead 17% Coach's Dreams); Impact players 81% Quick
Study, 11% Steady Grinder, 8% Film Junkie; Normal players 55% Steady Grinder, 30% Slow to Click,
15% Set in His Ways. Potential: each attribute's career gain times the share of his career left,
divided by what an average player realizes in that time, times a level from his stars (8,300
players' stars ship in the model), his trait (Elite 1.35 to Normal 0.9) and 2% per point ahead.
A fifth-year player has no room. One offseason over the whole league raises overall by 4.3
(first-year players), 4.2, 3.8 and 3.3 (seniors), against real year-to-year steps of 2.2 to 5.8.
The engine does not read any of it yet (fingerprint unchanged).

## Coach Career (recruiting, scouting and saves)

A **New season** on the season page is a Coach Career (`coach_career/career.py`): the 2026 season played
as the head coach, recruiting the class of 2027 as it goes (`coach_career/recruiting.py`, spec in
`docs/superpowers/specs/2026-10-22-coach-career-design.md`). A season without a career block
plays exactly as before; recruiting never changes how games play (the engine fingerprint is
unchanged).

**The class.** `recruits.generate_class(2027)` (above): 4,092 fictional seniors, nobody
committed at the start. Each gets three priorities from seven topics (close to home, playing
time, prestige, winning now, NIL, the coach, academics), drawn with fixed odds.

**What pulls a prospect to a school** (each 0-1): distance from his home (`exp(-miles / 300)`),
playing time (returning players at his position rated at least as high), prestige and NIL
strength (the school's real class-strength baseline), the coach's measured recruiting edge,
academics, and winning, which blends last season's real record and final rank with this
season's: last season is 80% of it at week 0, 30% at week 7 and 5% from week 15. His
interest in a school is his priorities' weights on those pulls plus what the school's
actions have earned with him.

**Your week.** Hours: `50 + (recruiting rating - 50) / 4`. A message costs 5, a call 15 (half
the time he lets slip one of his priorities, `CALL_REVEAL`, and you come away with his ask as a
range of about 15% either side, not the number), a head coach in-home visit 30 (once a month; it
tells you one priority for sure and his number), an official visit invite 10 (at your next home
game; a win sells, a 21-point loss hurts, a big stadium helps, and the weekend tells you all
three of his priorities), a scouting trip 5 (one look by your best evaluator, any week, allowed
while his report is short of complete; a prospect with a complete report shows his grades in one
line on his card and at the top of his profile) and an offer nothing.
**Looks come in trip units** (`REPORT_LOOKS = 3`, `SEND_LOOK = 1.0`, `AREA_LOOK = 0.5`,
`AREA_CAP = 2.0`). A full report is three looks and nothing goes past it (`read["looks"]` is never
over 3). A Send adds one look (or what is left: at 2.5 one Send finishes him). An area scout's
weekly look adds half a look, the read moving half as far (`look(weight=)` scales the step toward
what he saw and the confidence gained alike), and stops once his area has put in two
(`read["area"]`) or his report is complete: four weeks in an area make 2 of 3, then one trip (5
hours) finalizes the report. Flags, "our comp" and the SCOUTED line wait for a complete report
(`FIND_LOOKS`, `OUR_COMP_LOOKS`, `scouted` all compare against 3). A Send on a complete report is a
409, "his report is complete: 3 of 3 looks". The look log and the tallies keep their shape; the
tallies count looks in units (an area look 0.5), so a scout's yield reads "151.5 looks this week".
An old save's read may hold more than 3 looks and no `area`: it reads as complete (`min(3, looks)`,
area `min(2, looks)`) without a re-look. Nothing about a recruitment is shown as a number you could not know: your
standing with him reads as words (clear favorite, narrow favorite, close race, behind but in
the picture, long shot) over a bar, and so does his list on the profile.
**Pitches are tied to your program.** Each topic has your strength for this prospect, 0-1 (the
pitch picker shows it as strong, fair or weak): playing time from where he would sit on your depth chart, winning from
your record and poll, prestige, proximity, coach, academics, and NIL as your offer against his
ask. A pitch on one of his priorities counts 1x to 4x by that strength (1 + 3 x strength); under
25% it backfires (he isn't buying it: minus half the action's worth); any other topic counts
0.3x to 0.7x. **Stages:** cold until a contact, in touch, his top group (his top eight schools by
interest, your offer in hand), visited, committed. An official visit needs his top group; an
offer before any contact counts half. AI boards start warm (the staff has evaluated and spoken to
everyone on them, one priority known) and pitch the strongest priority they know. Each contact
from a school is worth a little less than the last, and a
prospect takes one message and one call a week from a school (more contact is not more interest:
the rest of your hours go to other prospects). **Pestering costs you:** after three contacts while
he is not considering you (you outside his top three, or under 60% of his leader's interest, among
the schools that have worked or offered him; an offer does not change that, an official visit or his
commitment does), each further message, call or in-home visit counts against you (1.5 times the
action's worth, half again more each time, the pitch ignored) and raises his ask from you 10%; the
count clears once he is considering you, and the weekly report says so once a week.
Only your own hand pesters: AI schools and Auto-recruit for your school never do. Offers are capped at
1.5 times your open spots: 85 minus returning players, plus four early leavers, capped at
the school's real class size plus two.

**Feedback once a week.** Your actions spend hours and are logged at once, but what they earn
lands at the week step: the board shows his list as the last step left it (each school's share
of the leader's interest as a bar, your place, each school's move since the week before and the
action behind the biggest ones), and after Advance the Office's "What changed" is a glance, not
a ledger: the six prospects on your board where something happened to you (your place moved, a
commitment, a flip, a decommitment, a signing, "wants more", "isn't buying the pitch"), the
biggest first, one line each; rivals' offers and the rest of the movement stay on each card's
list. The report holds everything (`GET /api/season/{id}/recruiting/report`, the last four kept). `tools/check_recruiting.py` prints
what each action earns on average over a season and how many prospects change leader a week, so
an action's weight is read off a season instead of guessed.

**Verbal commits lock into hard commits.** A commitment is verbal at first, with a firmness
of 0-100: 40 at the commitment (60 after an official visit there). He warms to his school on his
own, +3 a quiet week, +8 in a week the school messaged, called or hosted him, +3 while the NIL
it promised is still held, and -6 per rival in his top three with more playing time to offer (a
big push from a rival outruns the drift). The weekly flip chance is the usual one (the best
rival's lead in interest) times (100 - firmness) / 100. At 90 he is a hard commit: he cannot flip,
his offer cannot be pulled, and he signs on signing day. The board tags your commits Verbal (with
the number) or Hard; the needs' firm count is hard commits. You can still let a verbal commit go
by pulling his offer. Once he commits to you, scouting him stops: his file stays what it was.
Once he signs with you, his profile shows every attribute, now and at his potential.

**NIL asks and offers.** Every prospect wants something: an ask in NIL points from his stars
(five-stars about 60, four-stars 30, three-stars 8, two-stars nothing) times his position
(quarterbacks 1.5, edges, tackles, receivers and corners 1.2, backs and tight ends 0.9,
specialists 0.3) with a spread. What he wants *from you* rises 15% per place you trail on his
list, and 25% each time a rival's NIL on him is half again yours while you are in his top eight.
His card shows a range ("wants about 30-60") until a call, in-home visit or official visit tells
you the number. NIL points are a yearly budget from the program's level, attached to offers. An
offer goes out with a pitch (what you are selling him) and a number: the NIL counts in full up to
his ask and 30% past it; under half his ask (or nothing when he asks 20 or more) is a lowball:
the offer itself earns nothing and he cools on you for three weeks (contacts count half, he
declines a visit) until you **Raise NIL** to what he wants. AI schools offer up to 110% of his ask
within their budget share and raise once when he asks for more.

**Recruiting by need.** Each school's need at each position group this class is a healthy
85-man roster's make-up (`offseason.TARGET`: QB 4, RB 6, WR 11, TE 6, OL 15, DL 15, LB 9, CB 8,
S 8, K 2, P 1) minus the players coming back (seniors gone, draft-eligible underclassmen who
project a top-100 pick counted 35%, 10% attrition off the rest) minus its commits; a class takes
a quarterback whatever the room. A school takes its need plus one at a group (quarterbacks and
specialists: one, unless the need is higher), keeps offers out up to twice that, pulls its open
offers at a group once it is full, and a prospect cannot commit to a school full at his group
(recruiting by hand, you may oversign a group you offered). From week 12, the late market: every
school refreshes its board weekly from whoever is still out there, offers 25% more, and takes one
flier past a cap. The Board shows your needs ("NEED OL 4 · DL 3 · QB 1 · full: WR, TE") and a
Need / Full tag on each prospect. Checked against the real classes (`tools/check_recruiting.py`):
the league's signed positions a class within 0.3 a group of the real mix, 6-8% of schools without
a quarterback, at most 3, nobody more than 2 past his room at a group. (Before: 25 schools signed
3+ quarterbacks, 34 none, one signed ten receivers, and the offseason patched the holes with 281
walk-ons.)

**AI schools.** Every other FBS school runs Auto-recruit each week: a board sampled in
proportion to its real recruiting (its states' real shares spread over each state's
prospects, the rest leaning to nearby states, its star level against the national mix, its
usual position mix as a tilt) and weighted by its needs (1.6 for a group short two or more, 1.2
short one, 0.6 covered, 0.25 over; a blue blood's five-stars never under 0.6); blue-chip programs
also chase the best four- and five-stars nationally. They
offer more as the fall goes, invite top targets to home games and spend their hours on a call
and a message a week to each target, under the same rule. The real head coaches' recruiting ratings are rebuilt from their measured
edge (`build_teams.measured_recruiting`).

**Commitments and signing.** Each week a prospect may commit to the offering school he likes
most (more likely with a bigger lead, later in the fall, and after an official visit there);
recruits already committed at his position who are rated at least as high count against a
school. AI schools keep chasing committed top-300 prospects, and a rival's lead can flip
one. The early signing period (selection week) signs every commitment; national signing
day signs the rest with their leader if it has room, or an FCS program. A prospect whose
best FBS interest is low, or who has no FBS offer by week 8, shows "Leaning FCS".

**Realism** (`tools/check_recruiting.py`, held by `tests/test_recruiting_realism.py` on two
seeds):

| Measure | Seed 1 | Seed 2 | Real | Held to |
|---|---|---|---|---|
| Power 4 class size | 21.5 | 21.5 | 21.7 | 19.5-24.5 |
| Group of 5 class size | 20.0 | 20.0 | 18.9 | 16.5-21.5 |
| Signees from the school's state | 0.35 | 0.35 | 0.36 | 0.30-0.42 |
| Median miles from home | 304 | 302 | 280 | 220-340 |
| Schools with half their class blue chips | 19 | 20 | 18 | 12-24 |
| Most five-stars at one school | 5 | 5 | 6 | 6 or fewer |
| Class strength vs the real baseline (rank r) | 0.86 | 0.82 | | 0.75 or more |
| FBS signees committed before week 12 | 0.56 | 0.56 | | 0.50 or more |
| FBS signees signed in the early period | 0.84 | 0.82 | | 0.80-0.90 |
| Top-300 prospects who decommit | 0.13 | 0.17 | about 0.15 | 0.08-0.22 |
| Prospects who sign with an FCS program | 0.30 | 0.30 | about a third | |

**Scouting.** Your OC and DC (evaluation = their player development) and three generated
recruiters each cover one of nine areas; every week each prospect in a covered area gets a
look. A look sees each grade (athleticism, size and strength, technique, football IQ,
potential, coachability) with error `16 * (1 - s) + 4` points, `s = rating / 99`, and its own confidence strays a little (more for a weak
evaluator, who is sometimes sure and wrong). The read is the confidence-weighted mean, shown
as a range of words that narrows with looks. Over 500 prospects after four looks the word range
holds the true word 74% of the time for an evaluator rated 40, 83% at 60 and 86% at 95.
Grades are on the game's scale, the same numbers as the player cards: a grade is the average
of the card attributes behind it (athleticism: Top Speed, Burst, Agility, Leaping; size and
strength: Strength, Stamina, Durability; football IQ; technique: the first four skills of his
position's card), potential is his projected overall, and the grades are words, not letters,
cut on that scale: All-American from 90, Elite 80, Strong 65, Solid 50 (the middle Power 4
starter), Fair 40, Weak below. A high schooler's football IQ and technique mostly read Fair or
Weak next to college starters; his athleticism and potential are where five-stars stand out.
About 15% of two-stars and low three-stars are hidden until a look.

**Generational prospects.** A few a class (at most four, some years none) are generational: a
seeded draw among the four- and five-stars whose true potential is 95 or better, with odds of 40%
for a five-star and 10% for a four-star. The tag is your staff's to find: it shows on his row, his
profile and the Classes view once your staff have looked at him three times (or once he signs with
you), and his NIL ask is 1.5 times larger whether you know it or not. Every program wants him.

**Gems and bust risks** are your staff's finds, read from the scouting, never the truth. The cuts
are relative to his star tier, because potential varies nearly as much within a tier as across
them (about a fifth of two- and three-stars project Elite, so an absolute Elite cut once named a
quarter of the class). Once his report is complete (three looks), a three-star or lower ranked past 300 whose potential
read, even at its low end, beats the 94th percentile of true potential at his star level
(`GEM_PERCENTILE`, computed once from the class) is a gem; a four- or five-star whose read, even
at its high end, sits under the lowest 1.75% of his star level (`BUST_PERCENTILE`, one four-star in
57) is a bust risk. With a complete report (three looks) on every prospect in a staffed area that
leaves gems at 2-5% of them and bust risks at 2-5% of the four- and five-stars, nearly all real. A flag holds once found: it
stays until the read moves four points back past its cut (`FLAG_HOLD`, the slack a read already
carries), so one look that widens the read a little does not flicker it off and on. The read can still be wrong.
When he signs with you, the Classes view judges the call: "Gem: the read held" (his potential is
Elite) or "The read was off".

**Calls and in-home visits are scenes** (`coach_career/scenes.py`). For you, a call or an in-home
visit without a pitch opens a two-step scene: he says his lines, with a cue that hints at what he
cares about (one topic, or two when he is torn); then you choose your pitch and he answers with a
hit, a polite answer or a quiet one. The hours are spent when the scene opens and the points land
when you pitch. A scene you leave open is dropped at the week step: no points, the hours stay
spent. The CPU schools keep the one-shot path. A player's call reveals one of his priorities about
0.69 of the time against the CPU's 0.5.

**Prospect Profiles** (`coach_career/prospects.py`). The public block is the national rankings' read (it
has its own error). The top 300 get a written evaluation (his three strongest and two weakest
public grades) and a comp: the nearest real 2026 starter at his EA position, measuring his
ceiling against the starter's ratings over the ten attributes most tied to overall there, and
only when closer than 30% of starter pairs are to each other. "Our comp" appears after three
looks, measured from your staff's read, so a wrong read can give a different comp.

**Redshirts and position changes** (`season.redshirt_toggle` and `season.change_position` during
the season; `offseason.redshirt`, `offseason.change_position` and the Your Roster card in the
offseason). A player who has
played four games or fewer (`REDSHIRT_GAMES`) with his redshirt year unused (FR, SO, JR) can take
it: his class stays for next season and he still develops. During the season his page has a
"Redshirt him" button and every eligible row of your Depth Chart a "Redshirt" control (the
chart's cards carry his standing: `redshirt_status`): he sits out every remaining game (kept
out like an injury, `_injured`) and can come back off it while he is still at four games or fewer.
A Redshirting panel above your chart lists everyone sitting out, his games and the way back,
and how many others are still eligible. At the Departures step every
candidate waits on you, the ones you sat down already marked (a freshman off the depth chart's
top takes it unless you say otherwise; an older player only if he never played); the AI programs
draw as before but only within the four-game rule. A position change can be made any time, from
the Depth Chart during the season or the offseason's Your roster card at any stage: it moves one
of your players to any spot (kickers and punters among themselves), his overall recomputed by our
formula there (`position_options` shows what he would be everywhere before you choose). During the
season (`GET .../position_options/{team}/{player}`, `POST .../position` with `team`, `player`,
`pos`) the change applies at once: `state["position_changes"]` rides along with every game's
edits (`team_edits` → `with_edits` → `with_positions`), so the next game, the Depth Chart, his
profile and the stat views all have him at the new spot, placed in the new role's order by his
overall there and out of every slot of his old one (his season stat line, injury and redshirt
follow him; the chart's rows carry `moved_from`); the career's league roster row follows (at
once in a later season, at the offseason's start in the first). Moving him back to the position
the league file has clears the change. An injured or redshirting player may change too.

**Your schedule** (`season.schedule_options`, `season.schedule_swap`; the Schedule tab's "Trade a
non-conference game" before week 1 of a career). Each of your non-conference dates can be traded
for another FBS school's non-conference game the same week: you play them at your old venue and
the two displaced opponents play each other, so every team keeps its game count. The school
agrees when it gets the home game or you rate within 8 of it in attractiveness (`SCHEDULE_DRAW`);
rivalry games and schools busy with a conference game, a bye or an FCS date that week are not
offered. An FCS date can go to any other FCS team (they always come to you). Trades are kept in
`state["schedule_changes"]`.

**A player keeps his seasons** (`offseason.record_seasons`, run when the offseason opens): every
player's season line and honors go onto his entry in the career's league (`c["hist"]`, the last
eight), follow him through the rollover and a transfer, and his page lists them under "Season by
season" with the current season as the last row and a career line (totals, longs as the best). The Office's program card and the programs table
show a standing in words (a tag: blue blood, power, solid, Group of 5, bottom), with no rating
number or rank.

**Needs, recommendations and the first weeks.** Both the board and the class open with a needs
strip by position (`recruiting.needs_detail`: a healthy roster's make-up minus who comes back
minus your commits), counted the way you pick (what's left; committed, firm commits, your
board or your offers against the spots to fill; only what's short); a position picked there
filters the board or the class to it. The class's **Recommended for you** view
(`recruiting.recommended`) lists the prospects the Auto-recruit rules would put on your board
this week, best fit first, each with why (your states, your star level, a position you need),
with one button to add them all: a base to build a board from. Nobody commits anywhere in the
first three weeks (`COMMIT_FREEZE_WEEKS`), so there is time to scout and build a board before
the class moves. A school's weekly hours are a multiple of 5.

**The screens** (`web/recruiting.js`). A career opens on the **Office**: this week's opponent
with the win chance and projected score, your week's three steps (Recruit, Game day, Advance)
and the play buttons, the recruiting summary (commitments, class rank, hours, NIL points, your
hottest targets, the week's news) and tiles to every screen. The tab bar is two rows: the
screens you act on (Office, Offseason once the season is over, Recruiting, Prospects, Scouting,
Schedule, Depth Chart) and a League row that follows the calendar (Standings, Rankings and Stats
all year; Awards from week 4; Classes, Bracket and Bowls from selection week; Summary when the
season is done). A plain season keeps every League tab. The **Recruiting board** (a prospect you take off it stays off, Auto-recruit included, until
you put him back) is stage tabs with counts (All, Cold, In touch, Top 8, Visited, Committed),
a search and a sort, then a plain list beside one sticky pane. A list row is his avatar, name, one
line (stars, position, state) and one word of standing; a dot marks a move up or down this week.
The pane is the only place anything happens to him: a head with his status chip and one **Recruit
▾** button, whose menu lists every action with its hour cost or the reason it waits (Once a
week, Monthly, Offer him first, Finish your call first). Message and Offer… open a step in the
pane: the pitch as a dropdown (his known priorities first, each with your program's case), the
NIL points with his ask for an offer; a call or in-home visit plays as a scene in the pane. When
he asks about a named player on that call (the starter ahead of him, or another recruit you
offered), the scene shows his line with three answers (straight, a promise, a sidestep) and
locks the pitch until you pick one; his reply comes back in place (no toast) and History keeps
the answer (`Told him straight about …`, `Promised him the job over …`). Under
the head, a strip of four cells (your chance, his list, NIL, scouted), the tags you know (a
prospect who is tuning you out carries a `Tuning you out` tag, a warning above the Recruit button
says another contact costs you interest, and History lists each tuned-out contact), and
sub-tabs: Overview, Scouting, Profile, History. A ★ tag is a priority he has confirmed to you and a ☆
tag a topic he brought up on this week's call or visit (a topic that is both shows once, as ★). History lists every contact you have had with
him from the contact log, newest first, one line each (`Week 4 · Call · Program prestige · He lit
up`, `Week 5 · Offer · 120 NIL`, his commitments too). The sub-tab strip stays pinned at the top of
the pane while its body scrolls, and the Profile sub-tab starts below the pane's head instead of
repeating it. Sort: your chance climbs the ladder (yours, favorite, not offered while you lead
his list, in it, long shot, not offered elsewhere, lost). On a phone the pane is a full-screen dialog and
the menu a bottom sheet. Every standing word (Yours, Lost, Favorite, In it, Long shot, Not
offered) is one ladder read from his list, with your offer as the qualifier
(`standingOf` in `web/recruiting.js`), so the list, the pane and the Office agree. His list is
drawn as a race, one lane a school, a school without an offer in as a hollow pill, and a map of
the US shows your nine areas and where the board's prospects live. Every color is a theme variable, so the screens work
in the light and the dark theme. One set of spacing rules holds on every Coach Career screen:
button rows keep 8 px between buttons, tag rows 6 px, cards 12 px of padding, and buttons stand
36 px tall (44 px on a phone), segment controls and the depth chart's compact controls aside
(`tests/test_spacing.py`).

**The Scouting tab** (`web/scouting.js`, `GET /api/season/{id}/scouting`) replaces Staff: a
dashboard in three regions. My scouts, a compact row per staff member (every one of them, the DC
included): avatar, name, role word (OC, DC, Recruiter), his evaluation word, the area dropdown
(posts to `POST .../staff`; "Marcus Reed now scouts Texas") and a thin bar of this week's yield from
the look log, "255 looks this week · 478 narrowed" (looks in trip units: each of his is half), with a
flags count when there are any; "Not covered: …" is one
muted line under the list. Reports beside it, with tabs This week · Last week · Flags: the looks
grouped by scout (scout · area, "364 looks, 299 changed"), only the looks that changed a grade word
or found a flag, in compact rows (stars, position, name, what changed, flag tags), past eight folded
behind "Show all n"; Flags lists your staff's gems, bust risks and generational prospects this class
with his looks and where he stands with you. A name anywhere opens him in the board's pane (he goes
on your board if he was not); the pane's Scouting sub-tab links back to the reports. Under them the
Scouting queue, a table of the recruits worth a trip (your board first, then the class by your need
and his rank), 25 to a page on the API's `offset`/`limit`/`queue_total` with "Showing 1 to 25 of
1,204" and Previous · 1 2 … 49 · Next: columns BOARD (a "★ On board" pill and a left accent in the
team color on your board's rows), NAME (avatar, name, "pos · stars · state"), NEED ("Need 2", or a
muted "Set"), RANK, POTENTIAL (the word range, or "Not read"), LOOKS (three segments filled in
halves, "1.5 of 3"; no separate trips count) and `Send (5h)`, which reads `Send (5h) · finishes his
report` when one look is left, is grayed with the reason (Not enough hours) and gives way to a
"Complete" tag on a complete report; the queue lists only reports short of complete, your board's
one Send from complete at the top. The help line under SCOUTING: "A full report is three looks. A
trip is one look; a week in a scout's area is half a look, up to two. After four weeks in an area
one trip finishes him." Above it the chips All ·
On my board · Not on my board (the board ones client-side on one ask of the whole board, which the
API lists first), the search (name or home state), position and roster-group filters and the hours
pill; NEED, RANK, POTENTIAL and LOOKS sort the page shown (`aria-sort`). Send posts the `scout`
action and patches the row in place: the LOOKS bar and POTENTIAL cell pulse, the look's before and
after reads on a line under his row, a toast "Scouted Wesley Adams · 2.5 of 3 looks" ("· his
report is complete" at 3), the hours pill patches, and the page refetches so every other Send
follows `can_send` (a row whose report the Send just completed stays, with its tag); a click on the
row itself opens him on the board. The pane's Scouting sub-tab reads "2 of 3 looks · one trip
finishes his report", and its Recruit menu grays Scout with the 409 text once he is complete.

**The odds you see** (`prospects.odds`). Each offering school's chance to land a prospect is a
softmax of his interest in it (`exp(interest / 3)`), against the field: the schools not yet in
it, worth 14 interest points at week 0, 10 at week 8 and 4 by signing day. The board shows your
chance as a range that narrows as signing day nears (plus or minus 25 points at week 0, 12 at
week 8, 4 from week 13), labeled Early read, Taking shape or Solid read. Class rank weighs each
class's best commitments most (each counts 0.85 times the one before).

**Interested in you** (a Prospects filter and sort): the 15% of the class your school appeals
to most right now (his interest in you: distance, playing time, prestige, winning, NIL, the coach,
academics and what you have done), most interested first; every row shows High, Medium or Low.

**Classes**: every FBS school's class ranked nationally (as class rank: best commitments count
most), each opening to its recruits; the Office points to it after the early signing period
and national signing day.

**Auto-recruit** works from your board (your picks first) and puts everyone it recruits on it. It is off, this week (your staff spend your hours through the next advance, then
it turns itself off) or all season.

**Saves.** Every action and every week writes the season file (the state, with your own games'
box scores in it), and the browser worker writes it to IndexedDB right after the call (see
"Run it"). The dispatcher keeps one season in memory at a time: opening another one replaces
it, except while a sim runs. A career is 100-300 MB in memory.
**Download career** saves the state with every box score as a `.ccsave` file. Prospects store
their EA ratings as lists in one key order, so a new career's save is under 1.5 MB.

## Coach Career: the offseason and many seasons (`coach_career/league.py`, `coach_career/offseason.py`)

Design: docs/superpowers/specs/2026-10-23-career-offseason-design.md.

**A league per career.** The first season plays the real 2026 rosters. At the first offseason
the career copies every FBS roster into its state (`state["league"]`): our ratings and the room
to potential as lists in one key order, our overall, coachability, class, size, archetype,
stars, hometown and (real receivers) target share; each team's coaches and lineup shape; about
7 MB in the state and under 2 MB in a downloaded save. The 146 source files (68 MB of JSON) are
read one at a time and dropped: only each team's identity (`league.base_meta`: names, state,
conference, colors, program) stays cached, since keeping the decoded files pushed the old server past
a 512 MB instance's limit the first time a played career opened its offseason (peak 530 MB, now
under 470). Each season the league goes back into the
source format (our ratings back through the frozen scale) and through the same build as the real
data (`build_teams.build`, about 4 s), without the real 2026 adjustments (depth by real usage,
rating nudges). Each team's depth chart is picked then (`league.lineup`): a CPU staff by the
coaches' eye (overall, `DEPTH_EXPERIENCE` a year in college and a fixed draw per player of what
the numbers miss, `DEPTH_EYE`, set so its starters sit as far below the best available as the real
2026 starters did); your own team by overall, ties by name, every season (you are the eye: moves
on your Depth Chart pin the players you move, everyone else falls in by overall, and the season's
overrides and redshirts end with the season; `tests/test_depth_default.py`). The engine's attributes go onto its scale through the real 2026 build's starter
means, frozen in `data/game_scale.json` (`engine_means`): re-centring each season on its own
starters moved every player's numbers whenever a league's talent or depth charts shifted (team
rushing ran 12% low with the 2026 players themselves). Lineups take each role's best by our
overall, plus 5 points a year in college (real coaches start the veteran: with it a later
season's starters are 30% freshmen and sophomores, 2026's real ones 28%), plus the coaches' own eye, one draw per player a year, sized by group so the 2026 rosters'
starters picked this way have the real starters' overall: 1.5 points on the offensive line, 8 at
quarterback, 12-16 elsewhere (real usage starts players well below the top overall at most
positions: rotations, fits, what the ratings miss). A receiver without a real 2026 target weight
gets one from the same draw (log sd 0.32, as the real weights), so the receivers the coaches
start also get the ball, less 0.4 in log per 10 overall points above his team's receivers on the
field (the engine's pull toward the best-rated receiver is steep; with it a later season's
number-one receivers take 27% of their team's yards, as the 2026 season's do). Linebacker spots take the best MIKE, WILL and SAM in
that order. A team keeps its observed 2026 tendencies until its head coach changes. Team ratings
come from the starters' overall, fit once to the 2026 team ratings (r 0.98 offense, 0.997
defense). The built file is cached in `data/leagues/` and rebuilt from the state when missing;
the dispatcher switches leagues when you open a career (never while another sims). Later seasons
replay the 2026 schedule with home and away swapped every other year; the preseason poll comes
from team ratings; dates show a year on.

**Rosters of 85** (EA's limit, and the real 2026 rosters'; the NCAA's has been 105 since 2025).
Recruiting counts open spots against 85, capped by the school's usual class size. A healthy
roster's make-up by group is the real 2026 mean (QB 4, RB 6, WR 11, TE 6, OL 15, DL 15, LB 9, CB
8, S 8, K 2, P 1).

**Departures** (after national signing day). Class years FR, SO, JR, SR with a redshirt each
(FRRS ... SRRS). A player who did not start may take his redshirt once: 78% of freshmen off
the top of the depth chart, 35% of sophomores, 25% of juniors (half that for the next man up).
Seniors leave; a senior with his redshirt unused who barely played stays a fifth year 60% of the
time. The NFL draft has 257 picks, 97% from FBS, ranked by a draft score: the card overall
times a position scale, plus a position value, plus noise (4 points). The scale and value are
fitted by `tools/calibrate_draft.py` to the real 2021-2025 drafts (`data/draft_targets.json`,
counted by position bucket): round one has about 3.4 QB, 1.2 RB, 5.0 WR, 1.0 TE, 5.4 OT, 1.8
IOL, 5.0 EDGE, 2.4 DL, 2.0 LB, 3.8 CB and 0.8 S a year; the whole draft 11 QB, 22 RB, 32 WR, 15
TE, 23 OT, 23 IOL, 25 EDGE, 23 DL, 24 LB, 35 CB, 20 S, 2 K and 2 P. The sim's drafts land within
a pick of those in round one and within three over seven rounds (before the fit it took no backs
in round one, 3 a draft, and 40 corners). Underclassmen three years out of high school declare by
projected pick (95% in the first round, 65% by pick 100, 12% by 257): about 55-80 a year (real
58-82). The transfer portal takes 5% of freshmen to 18% of fifth-year
seniors, times 0.12 for starters, 0.65 for the next man up and 1.3 for the bench, and 1.25 after
a losing year; a Group of 5 player with a card overall of 50 or more (a Power 4 starter) enters
40% of the time to move up. About 1.2% quit a year (2.5 times as likely in a team's bottom 15%).

**Keep them home** (the step after Departures). Your players who mean to leave with eligibility
left wait on you: transfers and early draft entrants (graduating seniors and quitters are gone
either way). Each card says why he is going, from the factors that decided it: buried behind a
named teammate, a rotation role, a losing year, a Power 4 program calling a Group of 5 standout,
or a draft projection with his pick; his role now and next year (where he would sit on your depth
chart after the departures); and, once you meet him (free), his ask: a starting role, or NIL
(`RETAIN_ASK`: 25 plus 0.8 a card-overall point over 50, times his position; 1.5 times that when
what he really wants is snaps; 2.5 times for a draft entrant, 1.5 more for a top-100 projection).
A promised starting role counts only if your depth chart would really start him (a hollow
promise is worth a few points, and he knows); NIL comes off next year's budget, so it is money
your recruits and your portal pool will not have, and the portal pool reads the smaller budget
at once. When you advance each one stays or goes (`stay_chance`: 10% for nothing, about 75% at
his ask, about 70% for a real starting role, 92% at most; a draft entrant projected in the first
round stays at most 8%, a day-three projection about 20% plus what the NIL buys). A player you
keep carries `kept` (his portal chance the next year is 0.7 times) and a promise `promised` (3
times if the snaps do not come). The leavers join the portal class or the draft as they would
have; the week 1 portal screen lists the answers. On Auto nobody is talked to. AI schools keep a
would-be portal entrant who would start for them a third of the time (`AI_KEEP`).

**The portal is recruited like a class**, condensed to four weeks after national signing day
(the real window is a month). The entrants are the departures' portal players (section above),
each shown as a transfer, not a prospect (the Prospects tab lists them as the portal during those
weeks: class, last school and role, no stars): no stars, his class next year, last school, last
season's line (games, starts, his position's numbers), a public portal rank (his overall plus a
little noise), your staff's grade read (half a high schooler's error: there is film), the role he
would have with you next season (would start / next in line / depth, from your depth chart with
your signees) and his ask (25 NIL plus 0.6 per overall point over 50, times his position). His
priorities lean to playing time (45%), NIL (20%) and winning (15%); an entrant rated a four-star
or better (an overall of 58 and up) chases NIL (35%), a contender (25%) and prestige (12%) ahead
of playing time (18%), as the best real transfers do. The actions are recruiting's with the same
hours and weekly limits, a campus visit in place of the home-game visit (it happens that week and
tells you everything), NIL from a portal pool of 70% of next year's budget (the portal takes the
bigger share now), and the same asks, lowballs, raises, pitches and stages. Your spots are the
roster limit plus up to 8 by releasing the end of your roster (a Power 4 school gets the same).
When the portal opens your staff puts the twenty entrants who fit your needs on your board; the
forty best entrants by portal rank are on every Power 4 board, and a school takes a transfer who
would start for it (better than the last starter at his group next year) past its group's cap.
Before these three (top entrants' priorities, every Power 4 board, upgrades past the cap, and the
bigger pool) 27 of the best 50 entrants got no offer from a top-25 program and 19 of the 50 signed
with one; after, 34 of 50 (real: about 70%). At each week's step the
entrants with offers decide, best players first, a quarter of them the first week, then 40%,
60%, then everyone, for the school they like best with room at their position (crowded by the
transfers it already took there); a decision is a signing. After the last week an unsigned
entrant may walk on, half the time, at a school from his top group that had spoken to him and has
a spot (an AI school takes him when it needs his group or he beats its worst player there; your
staff takes him on Auto); the rest leave FBS. Transfers keep their years in college. **Preferred
walk-ons** from the class too: when the offseason fills rosters, an unsigned high school prospect
who had the school on his list comes first (a named walk-on), then generated ones.

**Development.** Every returning player (transfers too) develops once a year on our scale: each
skill closes part of its gap to potential at his coachability's rate times 0.75 (`DEV_RATE`),
times his year (booms and busts: a lognormal factor with a spread of 0.35, `PLAYER_YEAR_SD`)
times his team's year (its strength program, culture and luck: one lognormal factor on the whole
roster, spread 0.15, `TEAM_YEAR_SD`; both mean-preserving, so the league's pace does not change
but teams have good and bad years and programs' paths part),
times a pace by seasons in college (0.45, 0.7, 1.35, 1.35, then 1.0: real players gain little in
their first offseasons and most in their third and fourth; a real 2026 player's seasons come from
his class, and a transfer keeps his). A real 2026 underclassman's room to potential is 1.2 times
his seeded one (it ran short of a generated player's at the same class, and the Group of 5 dipped
as those players became its upperclassmen). A generated player's room
to potential is scaled by position group (`game_scale.ROOM`: 1.0 for backs to 1.63 for safeties),
set so a career's starters settle, season after season, where the real 2026 starters were (two
40-season runs had defenses 2.6-4.7 points low and receivers' yards 27% high before it; a class
now runs a little above the real players by stars and years, `tools/check_development.py`, since
the real ones are the survivors and a league's starters are younger than its best). The rate also takes a
coach factor (the head coach's player development with the coordinator on his side of the ball,
40%: 0.8 at 30, 1.0 at 50, 1.2 at 90) and the program's own (1 + 0.25 times its recruiting
baseline above the average program, 0.10 below). The signed class arrives as it is. Rosters are then topped up to 80, the thinnest
groups first: walk-ons (generated two-star freshmen) and, 30% of the time at a Group of 5 school
(15% in the Power 4), FCS and junior-college transfers (three-stars a year or two in, sophomores
or juniors).

**Development from production and honors** (more than EA's development trait). The season's
production is each player's standardized score at his position group against the average starter
(`awards.Pool`, the same numbers the awards use), for players who played at least half their
team's games. It sets his pace: 1 + 0.25 per standard deviation (0.75 to 1.6 times). A breakout
year (one standard deviation over the average starter) raises his ceiling in skill and football
IQ by 2.5 points (our scale) per deviation beyond half of one; so do honors: the Heisman 8, a
national award 6, All-America first team 5, a finalist, second team or conference award 3,
all-conference 2 or 1 (the best counts in full, the next two at half, at most 10 in a year). Speed,
strength and the other gifts are not raised. A Heisman winner, national award winner or
first-team All-American moves up a coachability level 40% of the time. The Development step
lists your risers with the reasons. It opens on a transfer portal recap (who you signed out of the
portal and where from, who you lost to it, where he went and why he left; one collapsed line at
the Staff and Ready steps), your transfers are marked in the risers and listed in their own block,
and the position-change picker groups them first.

**The coaching carousel** (`coach_career/carousel.py`). Each program's AD sets a goal from its tier
(program ratings, below): make the playoff, win nine, win eight, win seven and go bowling, reach a
bowl; a strong Group of 5 program expects its conference title. His patience is 2 to 5 years (the
blue bloods least). A head coach's job security (0-100, a new hire starts at
70; a real coach already in his third season or later starts somewhere between 35 and 85, his
standing before the career began) moves 8 points per win over or under the goal, plus 10 for a
conference title, 12 for the playoff, 25 for the national title, minus 6 when a playoff or
conference goal is missed; a bad year counts 3/patience as much, and half in a coach's first two
years. Under 25 after two years he is fired 70% of the time (always under 8). Coaches retire
(3% a year, more after 12 years in the job and past 60; the 2026 head coaches' ages are real,
from their birth years in `data/coach_birth_years.json`, generated coaches draw theirs) and an
80+ coach after 10 wins leaves for the NFL 12% of the time.

**The coaching market** (`carousel.market`, `lgd["market"]`). The league keeps a pool of about
150 coaches for hire. Fired head coaches and let-go coordinators join it with why they are
available ("Fired by Purdue after a 3-9 season", "Let go at Baylor when X brought his own
staff", "Left Oregon State after 4 seasons to look for a bigger job") and their job history;
the rest is a generated supply (FCS and Division II head coaches, NFL assistants, coordinators
and position coaches from lower levels), each with the roles he would take. A coach fired this
offseason sits out the cycle; after three years in the pool, or at 66, a coach leaves it.
A coach the market or the generator produces is drawn to the program's tier (the real 2026
head coaches' overall by tier: 77, 65, 60, 48, 40; the generated supply runs mostly below the
league's mean), and a coach rated 12 or more above a program's tier is not interested in its
head coaching job, so a bottom program hires a bottom-tier coach and the bottom stays the bottom.
Openings are filled in order of attractiveness: the best of the head coaches at programs at
least 3 less attractive with a three-year .550 run (a proven head coach gets 8 points), the
coordinators at nine-win programs within 15, and the market's best three for the job (a coach who has not held
the role gets ratings drawn for it, shifted by the program's level). A head coach hired away
opens his job, which joins the queue; nobody is hired twice. A coordinator hired away, let go
by a new head coach (half of new head coaches bring their own coordinator) or moving on (13% a
year) is replaced from the market; every change records where the new coach came from
(`from`, `from_market`). `tools/check_carousel.py` plays quick offseasons and counts the churn:
six seasons gave 25 head coaching changes a year (15 fired, 5 retired, 5 hired away, a few to
the NFL; real FBS years run 25-30) and 63 coordinator changes (real: 60-80).

**Program ratings** (`coach_career/programs.py`, spec `docs/superpowers/specs/2026-10-26-program-ratings-design.md`).
Every program in a career's league carries a living rating, six metrics on 0-100 kept in
`lgd["teams"][slug]["program"]` and moved every offseason by `programs.update` (run by the carousel):

| metric | what | moves |
|---|---|---|
| prestige | the program's name: history plus a decade of results | at most 3 a year toward history + 0.3 × (the ten-season mean of its season scores − its real 2023-25 winning): results like the real ones move nothing |
| winning | the last three seasons, 3-2-1 | every offseason: a season scores win share plus AP finishes (top 25 and top 10 0.35 each, top 5 0.5, number one 0.8; max 3.0), on a fixed curve where a 2-10 season is about 18 and a 12-0 number one 100 |
| NIL | the collective's tier | settles at its start plus 0.55 × the prestige change, 0.30 × the winning change and 0.15 × the market change, pushed 6 above that by the AD after a year that met his goal and 6 below after a losing year, at most 4 up or 3 down a year, 10-100; the NIL budget is 3 × tier points (Ohio State 275, Texas Tech 189, SMU 136, Tulane 112, Akron 71: the top as the recruiting baseline gave it, the middle with room for a few blue-chip asks) |
| market | crowds and TV | a fixed base (below) plus a live part that steps at most 3 a year toward 0.3 × (winning − its real 2023-25 winning), capped at ±8 where the building is full (base 85+) and ±18 elsewhere; a new head coach's first year adds 1.5 |
| conference | the conference's strength | the mean engine rating of its members, on the 2026 scale, anchored to its start (half of any change counts) |
| coach | the head coach's appeal | his overall plus 3 a year of tenure up to five, minus 5 |

The rating is 0.35 prestige + 0.20 winning + 0.15 NIL + 0.10 market + 0.10 conference + 0.10
coach; tiers are 1 at 76 and up (blue blood), 2 at 65, 3 at 50, 4 at 35, 5 below (at the start 7,
13, 34, 25 and 59 programs). **History** (`tools/build_program_history.py`, from the coaching
records in `data/recruiting/coaches.json`: every FBS head coach's seasons since 1995 with wins,
games and the final AP rank) is the recency-weighted mean season score 1995-2025 (half-life 12
years), blended 65/35 with the recruiting baseline (class strength 2005-2026) and scaled so the
best program is 100 and the median 39: Alabama 100, Ohio State 98, Georgia 93, Oklahoma 82,
Oregon 80, Texas 80, LSU 79, Clemson and Michigan 78. The starting top 25 by rating holds 21 of a
reasonable 2026 top 25 (Indiana, Missouri, Nebraska and South Carolina in for Utah, Wisconsin,
Oklahoma State and Kansas State). Ten straight 12-0 seasons lift a mid Power 4 program about 20
rating points (tier 3 to tier 1, prestige +11, market +14, NIL to the cap); ten 2-10 seasons at
Alabama take about 17 (tier 1 to 2, prestige 97 to 76): a decade moves a program about a tier.

**What reads it.** The AD's goal follows the tier (1: the playoff; 2: nine wins; 3: eight; 4: seven and a
bowl; 5: a bowl; a Group of 5 program rated 42 or more: its conference) and his
patience the tier at the start. A job's attractiveness is the rating plus 5 under a patient AD:
a sitting head coach takes an opening at least 3 more attractive than his own job, a coordinator
a head coaching job at any program within 15 of his own, your offers after a big year are
openings at least 3 above you, and a fired coach's openings are at or below. The market's
candidates and generated coaches are drawn against the rating on the baseline's scale (`z_of`,
fitted so the ratings line up with the recruiting baseline). Recruiting's prestige pull reads
0.6 × prestige + 0.4 × rating and the NIL pull the NIL tier; the portal's prestige and the
program's share of development read the rating. The Office shows your program's card (the six
metrics as bars read in words: elite 80 and up, strong 65, solid 50, fair 35, weak below; the
standing as a tag) and opens every program in a table of the same words. `tools/check_programs.py`
checks the starting top 25 and, over a run, that the top 25 keeps at least 18 of its starting
members; `tools/long_run.py` prints the same each season.

**A program's market** (`coach_career/programs.py`, `data/program_market.json`, built by
`tools/build_program_market.py` from CFBD's game list in the git-ignored `data/market/`). The first
piece of the living program rating (spec: `docs/superpowers/specs/2026-10-26-program-ratings-design.md`):
60% the mean home crowd over 2023-2025 against the biggest (Michigan's 110,000; a square-root
curve) and 40% the TV audience against 8 million a game. Nielsen publishes per-team averages
only for the most-watched teams (14 known: Alabama 7.9 million a game, Georgia 7.6, Tennessee
7.0, Texas 6.5, Ohio State 6.3, LSU 6.2, Oklahoma 6.1, Florida 5.7, Texas A&M 5.0, Florida State
4.9, Ole Miss 4.7, Michigan 5.2 and Kentucky 4.5 from 2024, Miami 3.6); the rest are fitted on
those from the crowd (1.9 + 0.044 million per thousand in the stands), a Group of 5 crowd at 35%
of a Power 4 crowd's audience. Alabama 97, Georgia and Penn State 93, the Power 4 median 62, the
Group of 5 median 30, Akron 19; a program new to FBS gets 25.

**Your meeting with the AD** (`offseason.review`, the Departures step). Every offseason opens with his
verdict: the goal, your record, your security and his patience. Under 40 he warns you; under
25 (after two years, always under 8) he is deciding whether to make a change, and the firing is
decided there, only at the end of a season. You can make your case (2-10 points of goodwill),
offer a change on your staff (let a coordinator go: he joins the market, his job gets
candidates at the Staff step, +10), ask for one more year (he always says yes, with an
ultimatum: miss the goal next season and you are gone; the Office shows "ultimatum year") or
say nothing (he decides). The meeting also says where the collective goes: next year's NIL points, up after a year that
met the goal and down after a losing one. Auto says nothing. Fired, you walk the rest of the offseason on Auto
(the program's next coach runs it) and pick your next job from the openings at or below your
program's standing at the Staff step (Auto takes the best).

**You** get the same goal and security (on the Office). After a year that puts your security at 80
or more, up to three better programs with an opening offer you their job; take one on the
Offseason screen and you move there for the next season (its coordinators join your staff, your
recruiters come along). Your coordinators leave when another program hires them as its head
coach; a recruiter moves on 12% of the time. Each coordinator opening offers the market's best
five (why each is available, his last job, his stops and age); a recruiter's opening five
position coaches. At the Staff step you can also let any of your own coaches go and hire from
the market, and the screen lists the market's top 40. Auto hires the best. Your coordinators' evaluation
moves with their unit's year (a top-third offense or defense by points +2, a bottom third −2)
and every recruiter's recruiting with the class you signed (top 25 +2, outside the top 70 −1),
plus a point of noise.

**Many seasons** (`tools/long_run.py`, every step on Auto). Six 20-season careers on 85-man rosters
(120 seasons) held the league's mean team rating at 59.0-60.0 every season (2026: 59.4) with
stats 6.3-7.8% off real (the 2026 rosters: 5.6%) and 26 points a game. Then depth charts favoring
experience and stronger development at the better programs (three 12-season careers): from
2031 the top 25's starters 58.6-59.8 (2026: 59.1), the Group of 5's 40.4-41.2 (40.0), starters
26-32% freshmen and sophomores in the Power 4 (real 27-31%) and 32-39% in the Group of 5; the
first year runs high at the top (64.4 in 2027) and settles by 2030. After the recruiting
overhaul (need, NIL asks, pitches, soft commits, the portal as recruiting; three 20-season
careers to 2045): the mean team rating 59.4-60.8 every season, stats 6.4-8.1% off, 26-27 points
a game, Power 4 starters 27-35% freshmen and sophomores, classes 18.5-21 a school, 44-65 early
entrants, 72-79% of portal entrants signed (plus preferred walk-ons), walk-ons after the
offseason 40-60 a year (281 before the overhaul). The top 25's starters settle at 56-57 from
2032 (59.1 in 2026, 58-60 before the overhaul) while the rest of the Power 4 rise to 52 (48.8)
and the Group of 5 to 42 (40.0): the ratings' spread narrows from 6.7 to 5.6. Sending the best
transfers to the top programs (the portal paragraph above; three more 20-season careers) did not
move that: the top 25's starters 56-57 from 2031, the rest of the Power 4 50, the Group of 5
42-43, the spread 5.1-5.6, with 55-69% of portal entrants signed (real: about half land at an
FBS school), walk-ons 31-60 a year and classes 18-21.

**Were the top teams getting weaker?** No: the tier followed the 2026 top 25 by team rating, and a
team at its peak in 2026 (Indiana at 75.7) regresses to its program over the years, which is
right. Built from a 2046 league, the top looks like 2026's: the top five 74-79 (2026: 74-76), #10
at 69-72 (72.5), #25 at 66 (65.4), the 25 strongest programs by recruiting baseline at 68-70
(68.6), the floor 50 (49.8). What had narrowed was the spread between teams (6.7 to 5.5):
development followed each program's baseline in lockstep. Now a program has an era (a
slow-moving factor on its development, spread 0.3, carried at 0.75 a year), every team a year
(spread 0.15) and every player a year (spread 0.35), all mean-preserving, and the strongest
programs develop faster (0.35 a baseline point above average, 0.15 below): the spread holds at
6.0-6.4 over 20 seasons, and the top ten changes hands (Clemson, Oklahoma, South Carolina,
Georgia Tech have had their years). `tools/long_run.py`'s tiers now follow the 25 strongest
programs. Still open: the first offseason runs hot at the top (the real rosters' seeded
potential: the top tier's starters 63-64 in 2027 before settling), so year two looks like a leap.

**Advancing, only from the Office.** The Office's play card is the one place time moves: **Sim
the week** plays every game this week (yours included, unless you played it on **Game day**, drive
by drive), **Sim to selection day** and **Sim to signing day** jump ahead, and the ▾ beside them
picks any week to sim through; the recruiting weeks between run on Auto. The season header keeps
no time-moving control, only Settings and Download career; its line leads with your next game
(opponent and rank). Clicking a week on the schedule or standings only looks at it. The staff
live on the Office and the coach page.

**The compact header.** With a season open the top bar's team picker, New season, Seasons and
Load career fold into one **Seasons ▾** menu (the saved seasons, New season, Load career, Clear
all; the side panel serves the empty state only). Once the page scrolls past the header card a
one-line bar sticks under the top bar (`#season-compact`): the team, the record and rank, what is
up next (or the offseason stage), an **Office** button and ▾ (settings, the career file). On a
phone the bar is the default and the header row opens from its ▾ as a sheet, so the Office is the
first thing on screen. The career tabs and the League tabs share one scrolling row.

**The top bar hides while a season scrolls** (`season.js` `onTopbarScroll`, `setTopbarHidden`;
`.topbar.topbar-hidden`). With a season open the sticky top bar slides up out of view (a
transform, 160 ms; instant under reduced motion) once the page has scrolled past the bar's own
height, and `--topbar-h` goes to 0 in the same breath so the compact bar and the tab row ride up
flush at the top (their sticky `top` transitions at the same pace). It slides back when the player
scrolls up 24 px or more, reaches the top, puts the mouse in the top 8 px of the window, focuses
anything inside it (Tab) or opens its Seasons menu, and it never hides while that menu is open.
There is no "show the bar" button: scrolling up or the pointer at the top edge reveals it, and the
compact bar's ▾ menu carries the bar's essentials after a divider (Seasons, which opens the same
Seasons menu anchored to the ▾; Your coach; Light theme / Dark theme, the switch it makes), as
does the phone's sheet. With no season open, on the Your coach page, and on a phone (where the bar
is not sticky and scrolls away on its own) it never hides.

**NIL economy** (`coach_career/recruiting.py` `portal_pool`, `reward`, `carry_over`; spec
`docs/superpowers/specs/2026-10-30-nil-economy-design.md`). The season budget B is the
collective's tier times three. At signing day what is left of B (`left = B − spent`) plus a reward
from the season just played (a winning record 10% of B, nine or more wins 20% instead, +10% for a
conference title, +10% for the playoff, +15% for the national title, +10% for a met AD goal, capped
at 50%, in fives) makes the portal pool, never less than the collective's portal fund of 30% of B:
`pool = max(0.3·B, left + reward)`. Keeping players home spends from that pool, and the transfers
you sign hold the rest. When the portal closes, what is unspent carries into next year's budget up
to a cap by tier (15% of next year's B for tier 1, 20% for tier 2, 25% for tier 3, 30% for tiers 4
and 5; anything above is gone), applied once to the next class. AI schools earn, pool, keep and
carry by the same rules. The review shows the math ("NIL for the portal: 60 left + 40 earned (nine
wins, AD goal met) = 100", "raised to the 85 portal fund" when the floor applied, what keeping
players home cost and what carries), the portal board's header shows the pool, and the next
season's first Office card says "NIL carried over: 25 (of 135 this year)".

**The Offseason screen** walks the steps: Departures (your leavers by kind, the league's numbers,
the first round), Transfer portal round 1 and 2 (entrants with position and status filters, your
offers, who he would be with you, your moves), Development (who improved), Staff (hire
replacements, the coaching carousel), then Start the next season. **Sim to next season** runs
every step on Auto. Your program's history (record, final AP rank, titles, class rank, players
drafted) grows a row a year.

## Player stat lines against real box scores

`tools/fetch_boxscores.py` downloads every played game's box score from the NCAA GraphQL feed
(per-player passing, rushing, receiving, kicking, punting, returns and defense, plus team
plays, third and fourth downs, penalties and fumbles) into `data/boxscores/`.
`tools/derive_tendencies.py` turns those into each team's real 2026 pass rate, pace, QB run
share, back and receiver shares and fourth-down rate (`data/observed_tendencies.json`),
and `teamdata/build_teams.py` uses them in place of the generated coach tendencies for every team
with two or more box scores. `tools/calibrate_players.py` replays each game and compares the
sim's player lines with the real ones. Rerun all three after each week.

Results on 333 games (8 sims each), sim against real, per team-game:

| Metric | Real | Sim | Correlation | Metric | Real | Sim | Correlation |
|---|---|---|---|---|---|---|---|
| Pass rate | 45.8% | 44.3% | 0.64 | RB1 carries | 14.0 | 14.5 | 0.35 |
| Pass attempts | 30.2 | 30.3 | 0.58 | RB1 share of back carries | 53% | 48% | low |
| QB1 attempts | 28.1 | 30.3 | 0.54 | Top receiver catches | 5.6 | 5.9 | 0.33 |
| QB1 pass yards | 208 | 228 | 0.41 | Top receiver share | 30.5% | 30.5% | low |
| QB1 carries (sacks included) | 8.3 | 7.8 | 0.70 | Top three receivers share | 66% | 65% | low |
| Plays | 65.8 | 68.5 | 0.36 | FG attempts | 1.4 | 1.4 | low |

The correlation column says whether the sim knows which teams and players get more:
pass rate and QB usage now track real teams (they were near zero before the observed
tendencies were fed in). The sim's starting quarterback is the real one in 73% of
team-games, the lead back in 43%, the top receiver in 25%; the shares are right on
average but which player gets them is still mostly set by the EA ratings. QB1 passing
yards run about 20 high because the sim's starter takes every attempt while real
starters sit in blowouts.

## Tuned to how teams really play in 2026

`python tools/tune_from_real.py` reads the real season (`sim/realdata.py`) and writes
`data/real_adjustments.json`, which `teamdata/build_teams.py` applies on top of the source rosters
(the source data is never edited; delete the file and rebuild to go back):

- **Depth charts from who plays.** Within each depth-chart role, players are reordered by
  real usage over the team's last three games: pass attempts for quarterbacks, carries for
  backs, catches and yards for receivers and tight ends, tackles, sacks and interceptions for
  defenders, kicks for specialists. Each role keeps its number of starters; offensive
  linemen keep the source order (box scores have nothing on them). After week 8 this
  changed the starting quarterback at 41 teams, the lead back at 70 and the kicker at 22.
- **Linebackers as one pool; specialists where they really kick.** Linebacker starters are
  picked across SAM, MIKE and WILL from one usage order (EA's starter count per role had
  benched real tackle leaders such as Alabama's Luke Metz and Utah's Trey Reynolds), and a
  2-linebacker front plays the two most-used. A real kicker listed as a punter (or the other
  way round) is moved to that spot with his attributes rebuilt for it (Liberty, Missouri,
  Navy, North Carolina after week 8).
- **The engine plays the depth chart.** `teamdata/build_teams.py` writes each roster in depth order
  (the source lists are not), and bench players come in by depth: the next halfback, receiver
  or defender down, with production only breaking ties. Before, every backup tied at zero at
  kickoff, so the first player in the file came in and then kept winning on production, and
  return yards counted, so a designated returner jumped the depth chart. Return, kicking and
  punting stats no longer count toward substitution. Play-log fingerprint 2f629474cdddbbf2.
- **Usage from who gets the ball.** The engine hands out carries and targets from ratings.
  Each team now carries its real lead-back split (its share of running back carries,
  mapped to the engine's committee-to-workhorse scale by simulation), and each receiver a
  target weight: his real share of the team's catches over his ratings' share, shrunk
  toward 1 for small samples.

Tested out of sample (built from weeks 1-6, scored on weeks 7-8 with
`tools/calibrate_players.py --from-week 6`): the sim starts the real quarterback in 76% of
team-games (63% before), its top running back is the real one in 56% (39%) and its top
receiver in 28% (24%); the lead back's carries correlate 0.39 with the real ones (0.26)
and the top receiver's yards run 3 high instead of 9. Nudging ratings toward each
player's real efficiency (completion %, yards per carry or catch, field goal %) was tried
too and made weeks 7-8 worse, so ratings stay as the source has them: a season of box
scores is not enough to tell talent from context and luck.

**Receivers the target cap cannot cover, and card extremes (overnight review section 5,
bugs 8 and 11).** Section 5 listed about 1,000 rating and depth edits; most are cards that
disagree with 2026 production, and nudging ratings toward production was tried before and
lost out of sample (above). Two narrower fixes were tested the same way (tuned on weeks 1-6,
scored on 7-8 with `calibrate_players.py --from-week 6`, then 40 seasons through week 8):

- **Receivers.** When a receiver's real share of catches needs a target weight above the
  engine's cap (`TARGET_MULT_MAX` 2.0), his route running and hands are what is off, not
  his coach: `tune_from_real.py` now raises both by what the capped weight cannot give (up
  to 85; `TARGET_RATING_FIX`, written under "ratings" in `data/real_adjustments.json`).
  39 receivers, among them the review's Oregon State, Kentucky, Wake Forest, New Mexico,
  Western Kentucky and Boise State WR1s. A rostered WR or TE at depth 1-2 with no real catch
  is hardly thrown to (`ZERO_CATCH_FLOOR` 0.3). Out of sample: QB1 pass-yard error 71.2 to
  69.6, top receiver's yards 34.9 to 34.6.
- **Card extremes.** Re-centring each attribute on the position's starter mean and
  stretching it by `SPREAD_SCALE` turned ordinary raw values into extremes where a
  position's starters bunch: 35 starting linemen had coverage of 90 or more, and a few
  starting receivers route running of 1. `build_teams.clamp_extremes` now holds a skill a
  position does not use to 25-85 and gives a core skill of an EA-60+ player a floor of 20
  (`CORE_SKILLS`, `OFF_SKILL_RANGE`, `CORE_FLOOR`; `BUILD_NO_CLAMP=1` builds without it).

40 seasons through week 8 against the committed data: favorite won 72.7% to 73.1%, Brier
0.177 to 0.176, real-versus-sim receiving yards correlation 0.515 to 0.537, sim-only players
178 to 171; `calibrate_season.py 30` 70.4%, MAE 12.5, slope 1.00. The lead-back splits in
`data/real_adjustments.json` are the ones from before this change: rerunning the tool with
today's engine re-measured them and that tested worse (20 seasons: Brier 0.184 to 0.188,
back carries' average miss 15.4 to 17.1), so a fresh `tune_from_real.py` run should be
checked the same way before it is kept.

**Bug 11 (quarterbacks by the last 3 games)** no longer matters: with the real-import fixes,
ordering quarterbacks by the season so far changes one team's starter, and the sim's QB1 is
the real one in 76% of later team-games either way, so `QB_RECENT` stays at 3.

**Real starters missing from the rosters** (section 5's list). Nine real players with a
real season's work have no EA card, so the sim played someone else in their place: Navy QB
Jackson Gutierrez and FB Michael Barrow, Utah State QB Grady Brosterhous, NIU QB Taron
Dickens, Georgia Tech RB Justice Haynes, Louisiana Tech RB Andrew Burnette, Syracuse WR
Umari Hatcher, Eastern Michigan WR Joshua Long and Akron S Donelius Johnson.
`tune_from_real.py` now lists them under "added" in `data/real_adjustments.json` (a line
scoring `MISSING_MIN_SCORE` 100: pass attempts + 2 x carries + 3 x catches + 2 x tackles +
5 x field-goal tries) and `build_teams.add_real_player` puts each on his roster with the
ratings of the player at the top of his role, so the team plays as strong as it did and the
real line goes to the right name; then `sim/realdata.py` matches his box scores and the depth
order by real usage starts him. Rated as an average FBS starter instead, the added
quarterbacks lifted NIU from 1.5 to 2.1 sim wins at week 8 (real 0-6) and picks fell, so
that was not kept. Real lines matched to a roster player: 92.8% to 93.0%.

**Team tendencies (section 6), from the box scores.** The observed tendencies were
refreshed from all eight weeks of box scores (they were from the first five or six), and
`tools/derive_tendencies.py` now records each team's average margin. Two corrections use it:

- **Pass rate and game script.** A team that leads a lot runs to protect leads, and the
  engine already plays that out, so the observed pass rate counted it twice: the sim's error
  ran -0.07 points of pass share per point of margin, and Indiana (+24 a game) passed 34% in
  the sim against 44% real. The observed rate now gets back `GAME_SCRIPT_PASS` 0.10 points per
  point of margin. Over 40 seasons: pass-share error 2.9 to 2.2 points, the margin slope
  gone (+0.008), Indiana 39%.
- **Fourth-down go rate.** Teams that trail try more fourth downs out of need (FBS slope:
  0.013 fewer tries a game per point of margin), which pushed bad teams' go rates to the
  limit (Sac State 99). The tries expected from the margin come off first
  (`FOURTH_PER_MARGIN`).

Tested together with the added players (40 seasons through week 8): favorite won 73.1% to
71.9% and Brier 0.176 to 0.177 (both inside the noise), real-versus-sim wins correlation
0.639 to 0.652; `calibrate_season.py 30` 70.4% to 72.9%, MAE 12.5, slope 0.99. Play-log
fingerprint e8d02e170713db66.

Then the engine side: teams still passed 1.2 points of share less than real across the
board (`PASS_LEAN` 0.016 now comes off every run chance), and plays per game varied too
little from team to team (`TEMPO_EFFECT` 0.60 to 0.80). Over 40 seasons: pass-share bias
-1.2 to +0.2 points (error 2.19 to 2.06), plays per game across teams spread 3.5 to 4.1 (real
5.1, about 4.4 once the sampling noise of seven games is taken out) and correlation 0.76 to
0.81; favorite won 71.9% to 73.3%, Brier 0.177 to 0.176. `calibrate_season.py 30`: 72.2%,
MAE 12.7, slope 0.94 (0.99 before: faster teams run up wider margins). Play-log fingerprint
276d229ae94c1256.

**Schemes the source codes wrong.** `data/scheme_overrides.json` (applied by `teamdata/build_teams.py`,
the source data untouched) plays Oklahoma's defense as a 4-2-5 (coded 3-4), Wisconsin's as a
3-4 (coded 4-3) and New Mexico's offense as a Spread Option (coded Air Raid, four receivers,
for a team that passes about 27% of the time). Their 15 games through week 8 over 40 seasons:
Brier 0.234 to 0.213.

## The real box scores (`sim/realdata.py`)

`sim/realdata.py` turns each NCAA.com box score into the game's stat lines and matches 93% of
player lines to a roster player by name and jersey number (`python -m sim.realdata --fetch`
downloads the latest results, box scores and polls and rebuilds). It is an owner-side import
for the tuning and research tools; the site has no page of its own for the real season.

### How the real box scores are read

`realdata.import_real_boxes` reads every real game's NCAA box score twice: first every
game's player lines, then the season stats and saved box scores from them. What it does
with the gaps and quirks in the NCAA feed (fixed after the overnight review, week 8):

- **Names.** A box score row is matched to a roster player by full name with accents,
  apostrophes, suffixes and quoted nicknames ignored (Ja'Bari Odoemenem, Ethan "Boobie"
  Feaster, a nickname such as "JayR" also tried as the first name). Letters the feed lost
  match any letter (it spells Öhrström with a replacement mark for each Ö and ö). Then
  jersey number and last name; then a last name only one player has, if the first name
  fits ("Cam" for Cameron, "BJ"
  for Boubacar, or a first name the feed dropped: it lists Kenny Soares Jr. as "Jr. Soares").
- **Side of the ball.** Each row is matched on its own, against the side of the ball its
  stat belongs to (passing, rushing and receiving: offense; defense; kicking and punting:
  specialists; returns: anyone). NCAA stat crews give two players who share a number one
  name, so a name on the wrong side gives way to a same-number, same-last-name player on
  the right side: USC's #0 receiver is listed as CB Jontez Williams, and his 18 catches now
  go to WR Zacharyus Williams. Florida's Duke and Kanye Clark (#20) and West Virginia's
  Latimers (#1) were the same case. A name on the wrong side with no such teammate stays
  (a punter's fake-punt pass, a corner's jet sweep).
- **Players missing from the rosters** get one position for the season, set from all their
  games: quarterback at 5 or more passes (Navy's Jackson Gutierrez, NIU's Taron Dickens and
  Utah State's Grady Brosterhous were filed as backs), back or receiver by carries against
  catches, defenders by jersey (60 and up a lineman, 40-59 a linebacker, under 40 a safety).
  Before, the first stat seen in each game set it, so 46 players were split across two
  positions; now none are.
- **Kicking.** The kicking table lists only kickers who tried a field goal (all 687 lines
  have one), so a team without a kicker line tried none: its field goals are a true 0. Its
  extra points are not listed anywhere, so they are left out (the team line has no PAT keys
  and `events.pats_listed` is 0; 220 team-games through week 8). NCAA lists no extra-point
  attempts at all (`patAttempted` is 0 on every line), and a missed kick cannot be told from
  a failed two-point try in the score, so real PAT attempts count each make as one attempt.
  Real PAT percentage cannot be measured from this feed; compare PATs made per listed game.
- **Net punting** is gross less the opponent's punt return yards, less 20 yards on the
  expected 7% of punts that are touchbacks (`PUNT_TOUCHBACK_RATE`; box scores list no
  touchbacks). Without that charge, a punter whose punts were never returned showed net
  equal to gross. League net reads 39.3 on 43.3 gross (the official FBS net is about 39.5).
  Team lines now carry "Punt Net Yards" too, as the sim's do.
- **Fumbles.** "Fumbles" is every fumble on both sides (the engine counts each fumble before
  the recovery, as NCAA does); fumbles lost are `events.fumbles_lost` on both sides. Real
  1.11 fumbles and 0.52 lost a team-game.
- **Games against FCS schools.** The season plays them against the fictional stand-in for
  the school's region (`data/fcs_map.json`), so the NCAA name (UNI) never matches the
  season's opponent (Red Prairie St.). `_ncaa_index` files a game where one side is an FBS
  team and the other matches no team under (the FBS team, `FCS`), and `_real_games` takes
  it for a stand-in game when the dates are within 2 days (`FCS_DATE_DAYS`; season dates
  are UTC). The FCS school's team box goes to the stand-in's side: its team line (yards,
  punts, field goals) counts in both teams' season stats and opponent stats, as a
  simulated stand-in game does. Its players are left out of the box score and season
  stats, since the stand-in never names the real school it replaces and its roster is
  fictional. Before, these 122 games had no box score, so real per-game averages left out
  the FBS teams' easiest games while the sim's included them (overnight review item A1:
  about +2.7 points and +13.7 yards a game on the sim side).

Through week 8: 25,610 player lines, 92.8% matched (was 92.7%, with the cross-unit jersey
matches counted as right); 138 notable lines unmatched (was 142), all players missing from
the rosters. Real field goals: 1,111 tried, 927 made (83.4%), 1.43 a team-game; 1,513 extra
points made in the 556 team-games that list them. `tests/test_realdata.py` checks the
matching rules. Re-tuned from the new import (`tools/tune_from_real.py`): depth charts
changed at Miami, Oregon State, USC, Utah State and UTSA, and USC's target weights now
include Zacharyus Williams and Ethan Feaster. Play-log fingerprint 74752a0512ab4386.

With the FCS games added (the figures above are before them): all 510 played games through
week 8 have a box score (was 388), 122 of them against FCS schools. 30,566 FBS player lines,
92.2% matched (the FCS games bring in walk-ons and backups who play in blowouts and are not
on the rosters). Real FBS teams average 28.9 points and 393.5 yards a team-game, up from
26.0 and 374.6 without the FCS games. Extra points are not listed for 307 team-games (was
220; the FCS games add 87 team-games that scored without trying a field goal). Re-tuned: depth
charts changed at 13 teams and target weights at 127. Play-log fingerprint 9e2043dd737958e7.

## The season page

The site opens on the season page (`web/index.html`). Pick your team, start a season, and
play it a week at a time with **Sim the week**, or jump with **Sim to
selection day** or **Sim to signing day** (a career moves time from the Office's play card). The
week strip lets you look back at any week. Tabs:

- **Games**: every game that week, your game first, with the AP ranks the teams carried
  into it; click your game for the full box score.
- **My Schedule**, **Standings**: every conference, ordered by conference winning
  percentage with the conferences' tiebreak ladder (below). After championship week the
  champion carries a crown and the title-game loser a silver medal; hover a rank to see
  which tiebreak placed a team.
- **AP Poll**: the poll released after the selected week, with each team's move.
- **CFP Rankings**: the committee's ranking after weeks 9 through 13 and the final one
  after championship week, the 2026 release calendar (Nov 3, 10, 17, 24, Dec 1, Dec 6).
- **Bracket**: a projected bracket as soon as the first committee ranking exists (current
  conference leaders as projected champions), then the real bracket on selection day and
  the playoff results as the rounds are played.
- **Summary**: the season in review (or the season so far): the national champion and
  title game, every playoff round, each conference's champion and title-game score, the
  final CFP ranking and AP poll, then your team's record, conference finish, postseason
  result, scoring, longest win streak, best win, worst loss, biggest win and closest loss,
  your statistical leaders (passer, rusher, receiver, tackler, sacks, interceptions,
  kicker, returner) totaled from the box scores of your games, the national leaders in
  passing, rushing and receiving yards, tackles, sacks, interceptions and kicker scoring
  from the season-long stats of every simulated game, and the biggest surprise and
  disappointment of the season: each FBS team's expectation is its preseason AP rank, or
  a slot below the top 25 by roster rating, and its finish is its final AP rank, or a slot
  below the top 25 by record and point differential; the swing is the log ratio of the two
  (plus ten, so a preseason #1 that finishes #8 is not a bigger letdown than a preseason
  #10 that goes 7-6), and the three largest each way are shown (`/api/season/{id}/review`).

The calendar: weeks 1-13 are the regular season (the 2026 schedule ends Nov 28), week 14
is championship week (the top two in every conference's standings meet, on a neutral
field for the Power Four and at the higher seed's stadium in the Group of Five), week 15 holds Army-Navy and the selection, weeks 16-19
are the playoff. A season starts from the real 2026 preseason AP poll and simulates
everything (the **New season** button). `sim/season.py` also keeps a "remaining" mode for
the command line and the tools (`python -m sim.season ohio-state remaining`): the real
results and real polls through the last completed week, then the rest simulated. FCS opponents play as the fictional school from the same region
(`data/fcs_map.json`), moved by the strength of the real school it replaces (`season.fcs_strength`):
+9 rating points for the strong FCS programs (South Dakota State, Montana State, Montana, Idaho, UC
Davis, Villanova, Tarleton State and others), +3 for good ones, -7 for weak ones (most of the NEC and
the lower SWAC and MEAC), 0 for the rest. One stand-in per region used to play every school alike:
replaying the 122 real 2026 FBS-FCS games, the FCS side won 2.5% (real 4.9%); with the tiers it wins
4.2% (strong programs 12%, good 7%, weak under 1%) and FBS teams win by 36 on average (real 37). No injuries.

Ties in the standings follow the procedure the Power Four (and most Group of Five)
conferences publish for seeding their title games, in this order: head-to-head (the
combined record among the tied teams when more than two are tied); record against the
conference opponents common to all tied teams; record against the highest-placed common
opponent, then the next one down; conference strength of schedule (the conference winning
percentage of each team's conference opponents); the latest ranking (the committee's,
else the AP poll, which stands in for the Big 12's analytics ranking); and point margin
in place of the conferences' draw. Once a step separates some of the tied teams from the
rest, each smaller group restarts at head-to-head, as the written procedures do. The Sun
Belt still plays divisions, so its title game is East winner against West winner.

### The schedule: real games, two clean-ups

A new season takes every real 2026 game from `data/schedules.json` and places it in a
week by its kickoff date (weeks run Tuesday to Monday from Aug 25). Two things in the
real data need help, and `season.new_season` handles both:

- **No team plays twice in one week.** A few games land in the same sim week as another
  game of the same team: MAC Tuesday nights, and games whose kickoff time is not set
  yet (stored at midnight Eastern, so a Tuesday game reads as Monday night of the week
  before). `_spread_double_bookings` moves the later unplayed game to the nearest week
  where both teams are free.
- **Unannounced games are filled in.** The Pac-12's Nov. 28 "flex" games name their
  opponents about a week ahead, so Boise State, Oregon State, Texas State and San Diego
  State had 11 games. `_fill_open_dates` pairs every FBS team with fewer than 12 games,
  trying every pairing and keeping the one with the oldest rematches (then conference
  mates together), in the latest week both teams have open. The game is titled
  "Pac-12 flex game".

Records shown anywhere on the page (header, standings, schedules, summary, the saved
season list) count playoff games. Bowl selection, the committee and the weekly polls
work on the record before the playoff.

### Speed

A game is pure Python, about 100 ms on a desktop core and a fifth faster than before
the last pass. The fatigue penalty used to be recomputed for every player carrying
fatigue on every snap (and, with momentum on, for every player on the roster, since the
factor moves every snap); now ratings are refreshed lazily, only for the players about
to be read: the snap's two lineups when they are set, a returner before a kick, the
returner candidates. A team's position groups are built once per game instead of being
filtered from the roster ten times a snap. With momentum on a week dropped from 62 to
28 seconds under the profiler; the only change in results is that a kick returner's
ratings reflect his current fatigue rather than the previous snap's. `python
tools/profile_sim.py game|week` profiles the engine and a week; `tests/test_play_log.py`
prints the fingerprint of five seeded games that must not change when the engine is
edited (7f1f625a5f714c6c).

While a sim runs the page shows what the engine is doing, live: "Simming Week 7 · 38 of
92 games", then "Updating the AP poll and CFP rankings", "Setting the conference title
games", "Building the playoff bracket", "Selecting the bowls", and so on, with the bar
counting weeks done plus the fraction of the current week's games (the status endpoint
carries `stage`, `week`, `games_done` and `games_total`).

`SIM_WORKERS` sets how many processes simulate games: unset uses the machine's cores
(capped at 8); `1` simulates in-process, which the browser always does (Pyodide has no
worker processes), so a week there takes longer than under the dev server on a desktop.

The This week card simulates your next game 20 times. Those sims run in parallel on the
worker pool when there is one (about 1 second instead of 4 on a desktop) and are
cached for the week; a second request for the same game waits for the first instead of simulating
it again. The Awards tab's live race is cached until more games are played (or god mode
edits a player), and the award pools list each position group's eligible players once
instead of scanning the whole league for every award (2.5 seconds to 1 on first load).
If a progress check collides with the sim thread changing the season, it answers with
the last good record; the page retries a missed check up to five times, and if the
season is gone it closes the season and says so instead of waiting forever.

### Team colors

While a season is open the page wears the team's colors. The accent (buttons, week
chips, the progress bar, your row in tables) is the first of the team's primary,
secondary and accent colors that reads against the page in the current light or dark
theme (contrast at least 2.6 to the background and panels); if none does, the primary is
pushed toward white or black until it does. The ink on the accent is black or white,
whichever contrasts more. The top bar and the season header's title band are solid in
the primary with a line of the secondary, their buttons take the first other team color
that reads against the primary, the page background is washed in the primary at the top,
and panel headings and the active tab take the accent. Michigan is maize on dark and navy on light, Penn State is
navy on light and white on dark, Oregon is green on light and yellow on dark, and so on;
the accent is re-picked when the theme toggle flips.

### Smooth actions (`web/ui.js`)

An action patches the screen in place; it never rebuilds the part of the page the player is
looking at. `window.CFP.ui` (loaded right after `gameview.js`, before every screen's script)
holds the shared helpers: `morph` patches a live tree to match a freshly drawn one (nodes matched
by `data-key`, text and attributes moved onto the live node, a field the player is typing in left
alone), `reconcile` keeps a keyed list (an existing row is patched and moved into order, a new one
fades in over 150 ms, a gone one fades out), `pulse` marks what changed with a 600 ms background
pulse (`.go-changed`), `busy` disables the control that acted and shows a spinner until the request
and the re-fetch land, then hands the focus back to it (or the nearest live control if it left), and
`toast` says what happened in one short sentence on a stack bottom-left: a polite `status` region,
newest on top, three at most, 3.5 s each; `#toast` stays as a hidden mirror of the latest for older
scripts. The recruiting board, the depth chart, Settings, every offseason stage and Your coach use
these, so the scroll never jumps and focus never falls to the page body. Under
`prefers-reduced-motion: reduce` there is no pulse, no fade and no cross-fade: changes are instant.
`tests/test_smoothness.py` measures all of it through the real page (a MutationObserver counts
removals of anything holding the watched element; the scroll must stay within 2 px), and the UX
sweep does the same for every board action.

### Later seasons: a schedule of their own (`sim/schedule_gen.py`)

A career's seasons after 2026 no longer replay the 2026 slate. Each new year is built the way
the conferences build theirs, from two data files. `data/schedule_rules.json` holds every
conference's league games by year (nine in the SEC, Big Ten and Big 12; nine in the ACC with
one rotating eight-game team; eight elsewhere, the MAC's ninth from 2028; the Pac-12's round
robin), its protected pairs (the SEC's trios, the Big Ten's twelve, the Big 12's four, the ACC's
pods, Sun Belt divisions with two cross-division games), its rotation cycle, and what its members
must do outside the league: a Power team's required Power opponent and single FCS game (none in
the Big Ten), a Group of Five team's Power pay games and FCS game. `data/series.json` holds the
annual non-conference rivalries with the years they run and the home-and-homes and neutral
kickoffs schools have announced through 2032.

The generator seeds the annual series (their finales on Thanksgiving weekend, Army-Navy on
selection weekend), the returns owed from last year's home-and-homes and the announced games;
builds each league slate so every pair meets within its cycle, never at the same site two years
running, with league home games alternating 5/4; fills the non-conference dates by tier, Power
pay games at the Power team's place and never returned, FCS games against the regional stand-in;
and lays the weeks out with non-conference games early, league games from week 3, nobody twice
in a week. The career's league carries the history (`schedule_history`: every meeting and host,
home-game counts, returns owed), seeded from the 2026 schedule so 2027 returns the 2026 sites.
Conference membership stays as in 2026. `tests/test_schedule_gen.py` generates 2027-2032 and
checks every rule.

### The polls: built from twelve seasons of real polls

`tools/fetch_polls.py` downloads every weekly AP Top 25 and CFP committee ranking from 2014
through 2025 plus every FBS result with the teams' ranks at kickoff (ESPN's archive;
`data/history/`). `tools/analyze_polls.py` reports how voters actually behave. The numbers
below are from that archive, 2014-2025 (1,749 committee-vs-AP team-weeks, about 3,000
ranked-team losses and 2,600 ranked-team wins):

| After a loss, by the loser's rank | avg spots dropped (to ranked / unranked opp.) | fell out |
|---|---|---|
| 1-5 | 4.8 / 7.0 | 0% / 0% |
| 6-10 | 5.6 / 9.1 | 0% / 5% |
| 11-15 | 5.7 / 9.8 | 6% / 41% |
| 16-20 | 5.5 / 7.6 | 42% / 87% |
| 21-25 | 2.8 / 3.0 | 88% / 100% |

| After a win, by rank | avg spots gained (ranked / unranked opp.) |
|---|---|
| 1-5 | 0.5 / 0.0 |
| 6-10 | 1.9 / 0.4 |
| 11-15 | 3.6 / 1.2 |
| 16-20 | 4.8 / 1.7 |
| 21-25 | 6.7 / 2.4 |

Other findings used by the model: a home loss costs about a spot more than a road loss;
margin barely matters for wins and adds about a spot for 21-point losses; a bye week
gains 0.7 spots on average; unranked teams enter at an average rank of 22.7 and only 36%
of them got there by beating a ranked team; 14 of the 25 preseason teams are still ranked
at the end and 6 of the final top 10 were preseason top 10; in the final regular-season
poll, one-loss teams sit at a median rank of 5, two-loss teams at 11, three-loss teams at
16; the committee ranks Group of Five teams 2.6 spots lower than the AP does and its top
12 differs from the AP's by 0.6 teams per week.

`tools/calibrate_polls.py` then fits the model: each historical season is replayed from its real
preseason poll with the real results, and the model's weekly top 25 is compared with the
real one. Result (data/poll_params.json): the AP model is off by **2.2 spots** per ranked
team on average and ranks **91%** of the teams the real poll ranked; the committee model
is off by **2.2 spots** and covers **90%**. The committee model adds strength of schedule,
wins over ranked teams, a heavier Group of Five discount, head-to-head among close teams
and a conference-title bonus on top of the AP-style score.

**First-place votes and points.** The AP tab shows the poll the way the AP publishes it:
first-place votes in parentheses after the team, a points column (25 for a first-place
vote down to 1 for 25th) and "Others receiving votes" with their points. The numbers come
from 62 simulated ballots (`polls.ballots`): each voter ranks the teams by the model's
score plus their own noise, so a close race at the top splits the first-place votes and a
runaway number one takes nearly all of them, while the totals are handed down the
published order so they always agree with the ranking. Under the table: "Others receiving
votes" with points, "Dropped from rankings" with the spot each team held, the count by
conference, and the coming week's games involving ranked teams.

**Coaches Poll.** A second tab carries the AFCA / USA Today Coaches Poll. Across 2014-2025
(`tools/fetch_polls.py` now pulls it too) the two polls agree on No.1 in 95% of weeks, share 24.1
of 25 teams and sit 0.84 spots apart per team, with the coaches leaning slightly more on
the record and on their own previous poll, and voting more unanimously at the top (the
No.1 takes a median 93% of first-place votes, the AP's 87%). The sim builds the coaches
order from the AP order with those nudges plus each team's standing opinion among the
coaches for the season (damped near the top), then casts its own 65 ballots; a simulated
season lands at 94% same No.1, 24.3 shared and 0.79 spots apart.

**The final poll.** The AP's last Top 25 comes out after the national championship, so
week 19 carries one: every bowl and playoff result is scored, the champion is first and
the runner-up second (true of every final poll of the playoff era), and the Summary tab's
final AP is that poll.

### The AP poll week to week

Each week's AP poll moves from last week's poll the way voters move it: last week's vote
points (the Top 25 and the others receiving votes) are the starting line, a win adds
points scaled by the opponent's own share of the vote, a loss takes points away (more
for losing to a team nobody voted for, at home, or by a lot), teams on a bye hold, and
a head-to-head winner goes above a close loser (`polls.next_poll`). It was fit one week
ahead, every week since 2014 (`python tools/backtest_polls.py fit`): from the real poll
and the real results it lands within 1.07 spots per team of the next real poll on
2014-2023 and 1.04 on the held-out 2024-2025, against 2.3-2.4 for "last week's poll
unchanged"; on the October 18, 2026 poll it was 1.68 with all ten of the real top ten.
In a simulated season a top-5 team drops 6 spots after a loss to a ranked team and 8 to
an unranked one, against 5 and 7 in real polls, and about 3 teams a week turn over
(`tests/test_poll_behavior.py`). In "rest of season" mode the real weeks show the real
polls with their real vote points, so the first modeled poll starts from the real one.
The season-long scores still run underneath for the committee model.
`python tools/ap_forecast.py predict` freezes a forecast of the next real poll and
`score NN` compares it once the poll is out; `python tools/fetch_polls.py --others` adds
the others receiving votes to an older archive.


**Who gets in from outside.** Voters rank a resume, not a result: of 456 teams that entered the
Top 25 from unranked since 2014, 89% already had votes the week before and only 3 had three or
more losses with no votes. On a voter's ballot a win over No. 2 is worth more than the 25th
spot, so the simulated voters once let a 4-3 team nobody voted for (UCF, after beating No. 2
BYU in October 2026) in at No. 25. Now a team with no votes has its win counted at
`1 - entry_losses x (losses beyond two)` (0.5 a loss: a three-loss resume gets half, four
nothing), so it takes an unbeaten or a one- or two-loss team to jump in on one upset
(`tests/test_poll_entries.py`).

#### The voters' own ballots

`tools/fetch_ballots.py` downloads every AP voter's ballot from collegepolltracker.com,
2014 to now: about 200 weekly polls and 13,000 ballots (60 to 70 voters a week). It waits
2.5 seconds between requests, caches every page it fetches, and keeps the data local in
`data/ballots/` (git-ignored: the site's compilation is its own). Run it with a season to
add the new weeks: `python tools/fetch_ballots.py 2026`.

`tools/backtest_ballots.py` maps the site's teams to ESPN ids by their point totals
(each team's ballot points equal the published points in the same week, so the totals
are a fingerprint; a name match covers the few teams with a vote or two) and finds which
of our weeks each site week is (2026 numbers its weeks one lower than ESPN). Then it runs
the week-to-week rules on each voter's ballot instead of the vote shares: the week's
results move the value the voter gives each team, the voter re-ranks and names 25, and
the ballots are added up. Fitted on 2014-2023:

| Rank error one week ahead | Vote-share model | Ballot model |
|---|---|---|
| 2014-2023 (fitted, 129 weeks) | 1.021 | 1.013 |
| 2024-2025 (held out, 28 weeks) | 1.007 | 0.985 |
| 2026 so far (6 weeks) | 1.560 | 1.540 |

The ballot model is ahead in each set but by about 2%, which the week-to-week noise
does not let us call real yet (it wins 13 of the 22 held-out weeks that differ).
`tools/ap_forecast.py` freezes both every week ("model" and "ballots") so the live
season settles it. The ballots also check the game's simulated voters: the share of
points at each rank matches real polls within a point from No. 1 to No. 15 (No. 20 gets
20.8% in the game, 23.2% for real), and No. 1 takes 82% of first-place votes in the
game against 87% for real.

**Season mode runs on the ballots.** A simulated season has no real poll to lean on after
its start, so the question that matters is how each model holds up when it rolls its own
polls forward for a whole season. Replaying 2014-2025 from each season's first ballots
through the real results, never resetting to the real poll (159 weeks):

| Weeks since the last real poll | Vote-share model | Ballot model |
|---|---|---|
| 1 to 4 | 2.19 | 2.27 |
| 5 to 8 | 3.46 | 3.24 |
| 9 to 12 | 3.81 | 3.32 |
| 13 and later | 4.00 | 2.95 |
| All weeks | 3.23 | 2.94 |

Each voter keeps their own view, so the poll does not drift the way a single consensus
does (the ballot model wins 9 of the 12 seasons). The game cannot ship the real ballots,
so it seeds its voters from the last poll's vote points (`polls.seed_ballots`: each voter
ranks by the team's share of the vote plus their own noise, 0.06 of a share), which
keeps most of the gain (2.997 against 2.942 from the real ballots). From then on
`season._ballot_poll` moves every voter's ballot each week (`polls.next_ballots`, the
same step the backtest runs), keeps the ballots in the season, and publishes the ballots
added up: the points and first-place votes are the voters' own. In "rest of season" mode
the voters are seeded from the last real poll. The final poll runs the bowl and playoff
results through the same ballots with the champion first and the runner-up second on
every ballot. One difference from real polls: late in a simulated season the voters
agree more, so 3 to 5 teams receive votes outside the Top 25 where real polls list 10 to 15.

**How the poll behaves over a season (October 20 review).** Ten simulated 2026 seasons
against the real 2026 poll flagged three behaviors: narrow wins were never punished, teams
ranked 16-25 always fell out after a loss, and teams with three or more losses stayed
ranked. `python tools/backtest_ballots.py season` now measures each of them on the real
2014-2025 polls and on the model rolled through the same seasons (seeded voters, real
results, never reset), so one season's small samples do not decide it:

| 2014-2025 season replay | Real | Model before | Model now |
|---|---|---|---|
| Ranked team beats an unranked FBS team by 7 or fewer: share that dropped | 24% | 5% | 8% |
| Ranked 16-25 loses to a ranked team: share out of the poll | 63% | 63% | 66% |
| Ranked 21-25 loses: share out | 95% | 100% | 97% |
| Teams with 3+ losses in the week-8 poll, per season | 0.08 | 1.25 | 0.83 |
| Teams with 3+ losses ranked, weeks 6-12, per week | 0.98 | 2.35 | 1.75 |
| Ranked loser, mean drop (spots, out = 30) | 7.56 | 7.18 | 7.27 |
| Top-10 loser, mean drop | 6.59 | 6.15 | 6.32 |
| No. 1's share of first-place votes | 0.82 | 0.74 | 0.74 |

- **16-25 teams after a loss** were right all along over twelve seasons; the 2026 figure
  (4 of 9 stayed) is a small sample.
- **Three-loss teams** stayed because 5-1 and 6-0 teams outside the poll could not climb
  past a preseason-ranked 3-3 team (2015 Tennessee, 2022 Texas A&M and Notre Dame, and
  others). A loss now costs a little more against a weak opponent (`loss_bad_pow` 1.19: the
  bad-loss term is `loss_bad` x (1 - opponent's value) ** 1.19) and each loss drags a team
  a little more (`loss_edge` 0.014 to 0.023).
- **Narrow wins** barely moved. A narrow-win penalty (`close_win`, scaled by how narrow the
  win was and by the winner's own value) does make narrow winners drop (12% at 0.15), but
  it makes the one-week-ahead forecast worse every time: most real narrow winners still
  move up (mean +0.7 spots), and the ones voters drop are dropped for something the score
  does not show. The fit keeps it near zero.
- **Unanimous No. 1** (the review's optional item): over 2014-2025 the model's No. 1 is
  already less unanimous than real voters (0.74 against 0.82 of first-place votes), so the
  per-voter wobble (`voter_noise`) stays off.

The new terms live in `polls.BALLOT_PARAMS` (all off by default) and the fitted values in
`data/poll_params.json` under "ballots". `python tools/backtest_ballots.py fit` scores the
season replay plus 0.05 x the gap to the real behaviors above (`BEHAVIORS`), with the
one-week-ahead error held within 0.01 of the earlier fit (train 1.013) and the season replay
no worse than it was (3.114); it starts from the best of a few starting points
(`FIT_STARTS`), since a coordinate search cannot leave a switched-off term. Result, with
2024-2025 held out:

| | Before | Now |
|---|---|---|
| One week ahead, 2014-2023 (fitted) | 1.013 | 1.021 |
| One week ahead, 2024-2025 (held out) | 0.985 | 0.963 |
| Season replay, 2014-2023 | 3.114 | 2.965 |
| Season replay, 2024-2025 | 2.841 | 2.699 |
| Behavior gap, 2024-2025 (units) | 6.30 | 4.29 |

On 20 simulated 2026 seasons (weeks 1-8): teams with 3+ losses in the week-8 poll 1.10 to
0.80 a season, top-10 loser drop 6.38 to 6.59 spots (real 6.7), ranked loser drop 7.19 to
7.29 (real 7.76); narrow winners still drop 5% of the time (real 2026: 40%).

### The bracket rules (2026)

From NCAA.com's "How the College Football Playoff works" (Aug 27, 2026) and the CFP
management committee's May 22, 2025 seeding revision: 12 teams; the ACC, Big Ten, Big 12
and SEC champions and the highest-ranked team from the American, CUSA, MAC, Mountain West,
Pac-12 or Sun Belt (champion or not) qualify automatically, Notre Dame qualifies if it is
ranked in the top 12, and seven at-large teams fill the field by ranking; seeds are
straight by the final ranking, so the four highest-ranked teams get the byes regardless of
titles; an automatic qualifier ranked outside the top 12 takes the lowest seed; the first
round is 5v12, 6v11, 7v10, 8v9 at the higher seed's home; quarterfinals are 1 vs the 8/9
winner, 2 vs 7/10, 3 vs 6/11, 4 vs 5/12 on neutral fields; no reseeding.

### The bowl season (weeks 16-19)

Every bowl of the 2026-27 season is played, and the playoff rounds carry their real bowl
names and sites. The lineup comes from Wikipedia's "2026-27 NCAA football bowl games"
page (`tools/fetch_bowls.py` writes `data/bowls.json`): 35 non-playoff bowls plus the seven
playoff games, with each bowl's date, kickoff time and stadium. Each bowl's own article
supplies its infobox conference tie-ins (current and previous, with the years each
contract ran) and its complete game-by-game results table, from which the app derives the
number of editions, the first year played, the all-time appearance leaders with their
records, and the last five results. The "Winning team / Losing team" tables and the Rose
Bowl's "West / East" table are both read; the winner in the two-sided table is the side
with the higher score. Two new bowls (the Frisco Football Classic's return and the Puerto
Rico Bowl) have no history yet.

**How teams are placed.** Once the 12-team field is set, every other team with six wins is
bowl-eligible; five-win teams are used only if a bowl would otherwise go empty, which is
what the NCAA allows. Bowls select in order of payout and prestige (Citrus, ReliaQuest,
Alamo, Holiday, Pop-Tarts, Gator, Music City, Texas, Las Vegas, Sun, Liberty, Duke's Mayo,
Pinstripe, Military, Fenway, Independence, Birmingham, Armed Forces, First Responder,
Cactus, Arizona, Hawaii, New Mexico, Frisco, Boca Raton, Gasparilla, Cure, Myrtle Beach,
Famous Idaho Potato, New Orleans, 68 Ventures, Poinsettia, Puerto Rico, Frisco Football
Classic, Salute to Veterans). Each bowl fills its two slots from its contracted
conferences, taking the best remaining team there by the committee's final order, then
record, then rating. Wikipedia's infobox mixes historical and current partners, so the
slots used for selection are a curated 2026 table in `sim/bowls.py` (for example Citrus: SEC
vs Big Ten; Alamo: Big 12 vs Pac-12; Gator: ACC vs SEC; Hawaii: Mountain West vs
American). When a conference has no eligible team left, a Group of Five bowl takes the
best remaining Group of Five team and a power-conference bowl takes the best remaining
team from anywhere, so the Gasparilla Bowl can end up with an SEC at-large team the way
Florida landed there in 2024. Two teams from the same conference are never paired.

**Calendar.** Bowls are dispersed into the playoff weeks by date: week 16 ("First round &
bowls") holds the four first-round games at the higher seeds' stadiums and the bowls
through December 24; week 17 ("Quarterfinals & bowls") holds the December 26-31 bowls
and the quarterfinals, the Fiesta Bowl on December 30 and the Peach, Rose and Cotton Bowls
on January 1; week 18 ("Semifinals & New Year bowls") holds the January 2 bowls (Citrus,
First Responder, Arizona, Liberty) and the semifinals, the Orange Bowl on January 14 and
the Sugar Bowl on January 15; week 19 is the national championship on January 25, 2027 at
Allegiant Stadium in Las Vegas. Quarterfinal bowls go to the top four seeds by their
traditional affinity (Rose: Big Ten or Pac-12; Peach: SEC or ACC; Cotton: Big 12 or SEC;
Fiesta: the rest), seed 1 choosing first, which matches how the CFP has placed the byes.

From the committee's first ranking (week 9) until selection day, the **Bowls** tab shows a
projected lineup: every record is carried to the end of the regular season on rating-based
win odds, the current conference leaders stand in as champions, the projected playoff field
is left out, and each bowl picks from its tie-ins. The tab sorts by date, bowl, team or
conference, filters to one conference, or shows only your team's bowl.

The **Bowls** tab lists every bowl by week with the matchup and score, tie-ins, editions
and first year, most appearances, recent results and previous tie-ins; your own bowl opens
the box score. The Games and My Schedule tabs show each playoff game's bowl name and site.

### Team and player stats all season

Two more tabs, **Team Stats** and **Player Stats**, work at any point in the season. Full
box scores are kept only for your own games, so for every simulated game the workers send
back a compact line per team (team totals, situational counts, plays, possession, and
each player's stat line) that is summed into the season as it goes. Team Stats is a
sortable per-game table for every FBS team (points, yards, pass and rush yards, yards per
play, completion rate, third-down and red-zone rates, possession, turnovers, sacks,
penalties, and the same on defense), with a conference filter. Player Stats opens on a
leaders board for your team (passing, rushing and receiving yards, tackles, sacks,
interceptions, touchdowns, kicking points, top five each, from `/stats/leaders`); pick
"All teams" for the national leaders, a chip for the full category table (passing,
rushing, receiving, defense, kicking, punting, returns; top 100 or one team's full list,
sortable), or Roster for the team's players by position with ratings and starters marked,
which is also what shows before the first game is played. A season saved before season-long
stats existed shows only your own games.

### Awards: the Heisman, every national award, All-America and all-conference teams

The research is in `docs/AWARDS_RESEARCH.md` (every award and who wins it, the Heisman
vote 2014-2025, the All-America and all-conference formats, winning stat lines). The
engine now keeps the stats the awards need: tackles for loss, passes defended, hurries,
explosive plays, first downs, long plays, field goals by distance, punt placement, snaps
and starts, and offensive-line credits (sacks and pressures allowed, stuffs, key blocks).
Attribution choices use a separate random source, so game results for a given seed are
unchanged. Rosters now carry class, height, weight, jersey and the depth-chart role (LT,
LG, C, RG, RT, edge, DT, SAM/MIKE/WILL, CB, FS, SS).

`sim/awards.py` scores every player from the season stats: a production score per position
(for example a quarterback's yards, touchdowns, interceptions and passer rating), then
standardized against the league's starters at that position so a cross-position vote can
compare a quarterback with a back. Each award is a pool (position, class, role), a
production score and a team term where the real award rewards team success:

- **Heisman**: 870 media voters in six regions, the past winners and a fan vote, each
  ranking three players (3-2-1 points), with a regional bump, a per-voter team-quality
  bias and noise; finalists are the top four (five when close). The position prior
  (QB 1.0, RB and WR about 0.6, defenders about 0.4) comes from the twelve-year history.
- National awards: Maxwell, Walter Camp, AP and Sporting News player of the year, Davey
  O'Brien, Unitas Golden Arm (upperclassmen), Doak Walker, Biletnikoff, Mackey, Outland
  (interior OL and DTs), Rimington (centers), Lombardi (linemen and linebackers), Bednarik,
  Nagurski, Lott IMPACT, Butkus, Thorpe, Hendricks (edge rushers), Groza, Ray Guy, Jet,
  Hornung (versatile), Shaun Alexander Freshman; coach of the year from the AP, AFCA, FWAA
  (Eddie Robinson), Dodd, Munger, Home Depot and Walter Camp, each weighing wins over
  expectation (from the roster's rating rank and the preseason poll) differently; the
  Broyles Award for the coordinator whose unit most outran its rating; after the playoff,
  the Manning Award, the Bear Bryant Award and the Joe Moore Award for the best line.
- **All-America**: five selectors (AP, AFCA, FWAA, Sporting News, Walter Camp) each pick
  first and second teams with their own bias and noise; consensus is first team on three of
  five, unanimous on all five.
- **Conference awards and all-conference teams** for all ten conferences with their real
  award names (the Big Ten's sixteen named awards, the Big 12's lineman and freshman
  awards, the SEC's Jacobs Blocking Trophy, the Pac-12's Morris Trophy, the MAC's Vern
  Smith award) and each conference's team layout and selectors (coaches, media, or both).

Calendar: conference awards after championship week, the Heisman and national awards in
selection week, the postseason awards after the title game. Until an award is given, the
**Awards** tab shows the live race: a Heisman straw poll, the top five for every national
award, the coach-of-the-year races and your conference's races, with your team's players
listed first. The Summary tab shows the Heisman winner. Awards that need data the sim does
not have (transfers, walk-ons, academics, hometowns, injuries) are not given.

The stats pages show the new numbers too: every Player Stats category gained columns
(passer rating, first downs, third-down conversions and long plays for passing and
rushing, 20-plus runs and 25-plus catches, tackles for loss, hurries and passes defended,
field goals by distance, net punting with punts inside the 20 and touchbacks, return
longs), a **Blocking** category lists linemen by snaps, starts, sacks and pressures
allowed, stuffs and key blocks, the leaders board adds tackles for loss, passes defended,
explosive plays and net punting, the team table adds TFL, hurries, PBU, explosive plays
and pressures allowed, and the roster cards show class, height, weight and depth-chart
role.

`tools/calibrate_awards.py N` runs N seasons and reports the Heisman position mix, winner team
rank, Group of Five and defensive finalists, All-America consensus counts and the coach of
the year profile against the research targets.

### Player cards: the ratings that matter

A player card shows the ratings that matter at his position, most important first
(`POSITION_RATINGS` in sim/season.py: passing, decisions and awareness for a quarterback;
coverage, speed and tackling for a corner; kick power and accuracy for a kicker, and so
on; a returner gets his return rating too). "All ratings" opens a modal with every
rating he carries, the position ratings marked, morale arrows and god-mode edits
shown, and his rating at every position (what the depth chart's "By position" view
uses when you move him).

### Momentum and morale

A season setting (on for new seasons, off for older ones; ⚙ Settings). Inside a game,
big plays swing each team's momentum between -1 and 1: touchdowns, turnovers, sacks,
explosive plays, fourth-down stops and conversions, blocked and missed kicks, return
touchdowns. Momentum fades a little every snap and halves at halftime, and at full swing
a team's ratings move 5% either way (the same fatigue pass that already scales ratings
applies it, so with the setting off a game is bit-for-bit what it was). Between games,
every team carries a mood from its results and every player a form from how each game
compared with his season so far; both fade 15% a week. A team's mood moves by half of
(result minus its pre-game win chance, from the rating gap and home field) plus 0.05 for
a 21-point result, so a heavy favorite's win or an FCS win adds little and an upset
moves both teams a lot (`MORALE_RESULT`, `MORALE_BLOWOUT`). Flat steps of 0.25 a result
used to pin good teams at +1 by midseason: in 5 simulated seasons at week 8, 50 of 690
team values sat at +1 and Notre Dame was at +1 in 4 of 5; now 7 of 690, Notre Dame
0.72-0.82, still in record order. Player form leaves FCS games out (an FCS opener inflated
the season average, so later games read below par) and takes off the league's running
mean (`MORALE_Z_TRACK`): form averaged -0.04 with 56% of values negative, now -0.004 and
51%, with hot and cold streaks equally common (8% each). Game picks did not move
(20 seasons through week 8: favorite won 72.7% before, 72.4% after; Brier 0.186, 0.187).
Entering a game, a player's ratings scale by up to 6% for his form and 3% for the team's
mood. The player card shows the boosts as green ▲ and red ▼ arrows next to each rating,
with a 🔥 Hot streak or ❄ Cold streak tag and the team's mood; the depth chart marks hot
and cold players. `python tests/test_morale.py` checks that the engine is unchanged with the
setting off and that moods, form and the boosts move with results when it is on.

### Settings and god mode

The ⚙ Settings button next to the sim buttons opens the season's settings. God mode
lets you edit every player and every depth chart: any player card gets an Edit button
(ratings 0-99, jersey, class, height, weight and development trait; names and positions
stay, since the season's stats are keyed on them) and every team's depth chart becomes
editable, not just yours. Edits are saved with the season (`player_edits` in the state)
and used by every game from the next sim on; an edited rating is marked on the card.
`GET/POST /api/season/{id}/settings`, `POST /api/season/{id}/player/edit`;
`python tests/test_godmode.py` checks validation, the views and the sim's team data.

### This week

Your Team Schedule opens with a "This week" card: the next game with both teams' rank
and record, the venue, the date and the trophy on the line, then a prediction from 20
simulations of the matchup with the current depth charts, injuries and edits (the likely
score, your win odds, the line and the total, the passer, rusher and receiver to watch),
and your injury report. The week's row in the schedule below is highlighted with a
"this week" tag. On a bye the card just says so. Once game day has played your game
the card shows the result instead of a prediction, with the box score a click away, and
the schedule rows update as soon as a game of yours is in.
`GET /api/season/{id}/preview?team=`. Win odds blend the simulated
win rate (with a one-game prior) with a margin model and stay between 2% and 98%:
never 100%, since upsets happen.

### Rivalry trophies and the all-time series

`data/rivalries.json` lists 90 FBS rivalries: the game's name, its trophy (Paul Bunyan's
Axe, Floyd of Rosedale, the Old Oaken Bucket, the Commander-in-Chief's Trophy, the Iron
Skillet, the Jeweled Shillelagh and the rest; blank where the game has none) and the
all-time series entering 2025, leader first. The simulator adds its own games on top:
the Team Schedule marks a rivalry game with the trophy and the series entering it, the
box score says who takes or keeps the trophy and the series after it, and the Summary
tab's Rivalries card lists each rival, this season's meeting and the series today, with
who holds the trophy. Army-Navy in selection week counts like any other game.
`GET /api/season/{id}/rivalries?team=` serves a team's list; `python tests/test_rivalries.py`
checks every slug resolves and that a series moves when the game is played.

### The committee's resume

The Rankings tab has a Resume chip: the way the committee explains its rankings, for
every FBS team through the week you are looking at. Record and conference record, wins
and losses against teams ranked today (the CFP ranking once released, the AP poll
before), strength of schedule (two thirds the opponents' record, one third their
opponents', ranked 1 to 136 with FCS stand-ins left out), the record against teams over
.500, the best win and the worst loss. Click a team for its full resume: tiles, the best
win and worst loss with the opponent's rank at the time and today, and every game with
a click through to its box score. `GET /api/season/{id}/resume?week=&team=` serves it;
`python tests/test_resume.py` checks the numbers against the standings and a hand count.

### Game day: your game, drive by drive

The "Game day · vs Michigan" button simulates only your game this week, then replays
it from its play log instead of jumping to the final box score: a live scoreboard with
the quarter and clock, the down and distance, each play appearing in turn (runs, passes,
sacks, turnovers, penalties, kicks and punts with the players involved), a scoring
summary and a list of finished drives. Slow / Normal / Fast set the pace; "Skip to
final" opens the normal box score at once. "Advance to Next Week" then plays the rest
of the week's games; if you skipped game day it plays all of them. Every game of a
week draws its random seed when the week starts, so the results are the same either
way. The multi-week sims never open the replay, and the button hides on a bye week or
once your game is played.

The log comes from the engine: every snap, kick, punt and kickoff is recorded per drive
(`log` on each drive in the box score) with the players involved. Nothing in the logging
draws a random number, so a game's result is identical with or without it
(`python tests/test_play_log.py --check` prints a fingerprint of five seeded games that must not
change when the engine is edited).

### Personnel, schemes and injuries

The engine now fields a different eleven on every snap (`engine/personnel.py`). The
offense picks a grouping from its coordinator's scheme in the coach data (Air Raid, Spread
RPO, Spread Option, Power Spread, West Coast, Pro Style, Multiple, Flexbone) and the
situation: 11, 12, 10, 21, 13 and 22 personnel on normal downs in the scheme's mix, four
wide on third-and-long, three tight ends or a sixth lineman in short yardage and at the
goal line, heavier sets when a leader is milking the clock, the flexbone's three backs for
option teams. The defense answers from its scheme's base front (4-3, 3-4, 4-2-5, 3-3-5)
with a fifth back against three receivers, a sixth against four or on passing downs, and
a linebacker for a back against extra tight ends; a three-man front sends its best-rushing
linebacker. Who is on the field follows the depth chart, the fatigue rotation (linemen now
rotate at a lower fatigue point than backs, so edge rushers and tackles play about 60% of
snaps with the next men up behind them), the blowout rest (linemen included) and injuries.
Tight ends and fullbacks earn blocking credits on runs and, with two tight ends in, in pass
protection; a fullback carries rarely. The Blocking stats category lists all of them, and
each box score shows the personnel snap counts and schemes.

Injuries: every player on the field can go down on a snap (about 1.3 per team per game),
most for the rest of the day only, some for one to eight weeks, a few for the season. The
injured sit out in the sim, the season carries the list week to week and heals it, the My
Schedule tab shows your injury report with the league's behind it, and each box score
lists the game's injuries. Injury rolls use their own random stream, so a seed reproduces
the same game with injuries off. The calibrations after the change: 2026 replay 70.3%
straight up (was 72.4%), margin error 13.4 (was 13.5), slope 1.06; player usage closer to
the real box scores (lead back yards within 9 a game, was 13); all 31 league benchmarks in
band.

## Player stat lines and usage (box score calibration)

`tools/fetch_boxscores.py` pulls the full player box score for every final game from NCAA.com
(the same feed its game pages use), `tools/derive_tendencies.py` turns them into each team's
observed 2026 pass rate, pace, quarterback run share, fourth-down rate and backfield split
(which `teamdata/build_teams.py` feeds into the sim in place of the generated coach tendencies), and
`tools/calibrate_players.py` replays every game 8 times and compares the sim's player lines
with the real ones. Per team-game, 333 games (bias is sim minus real; "corr" is whether
the sim knows which teams or players get more):

| Metric | Real | Sim | Corr | Metric | Real | Sim | Corr |
|---|---|---|---|---|---|---|---|
| Pass rate % | 45.8 | 46.0 | 0.58 | RB1 carries | 14.0 | 14.7 | 0.33 |
| Plays | 65.8 | 65.3 | 0.35 | RB1 share of RB carries % | 52.9 | 52.4 | 0.10 |
| Total yards | 373 | 367 | 0.40 | RB2 share % | 26.9 | 27.8 | 0.09 |
| QB1 attempts | 28.1 | 29.7 | 0.48 | Top receiver catches | 5.6 | 6.0 | 0.26 |
| QB1 pass yards | 208 | 220 | 0.32 | Top receiver share % | 30.5 | 31.5 | 0.12 |
| QB1 carries (incl. sacks) | 8.3 | 7.1 | 0.69 | Top 3 receivers share % | 65.8 | 65.4 | 0.15 |
| QB1 pass TD | 1.4 | 1.8 | 0.24 | FG attempts | 1.4 | 1.4 | 0.13 |

The sim's starting quarterback is the real one in 73% of team-games, its leading rusher
the real one in 45%, its leading receiver in 25% (the real leader changes week to week).
Still open: the starting quarterback throws for about 12 yards a game too many. Before this
calibration the sim did not know which teams throw more (correlation 0.09) and gave
quarterbacks a fifth of their real carries; the lead back's share ran six points low until
the running back rotation below.

### Running back usage

Real backfields are not even rotations. In the 2026 box scores the lead back takes 51% of
his team's non-quarterback carries in an average game, about a third on a committee team
and 70% or more on a team with a feature back (season level, 138 teams: mean 46%, p10 33%,
p90 63%, max 83%), and the top backs project to 275-330 carries and 1,700-1,900 yards over
13 games. The engine used to rotate backs by fatigue alone, so every lead back landed
between 44% and 50% and the country's leading rusher ended a season near 1,300 yards on
240 carries, which made the Heisman and Doak Walker races look wrong.

`roster.Team.rotate_backs` now runs the backfield the way coaches do (the constants under
"Running back usage" in `engine/game_config.py`). The lead back is the healthy halfback
highest on the depth chart. He comes out when he passes his fatigue limit or, on a
committee team, by the coach's series rotation; once rested he returns at once if he is a
clear feature back and after the backups' series if he is not; the backups rotate among
themselves and call on him only when no other fresh back is left. Where a team sits
between committee and workhorse is its feature score: the lead back's carrier rating
(speed, strength, elusiveness, vision) minus the next back's, mapped onto 0..1 over a gap
of -4 to +24 points, with the return chance rising as the fourth power of that score so
only a clear star carries 70%. Backs recover on the bench twice as fast as receivers (a
back's rest is a few plays, not a series), a second halfback on the field next to the lead
back carries at 0.45 against his 0.80, and the quarterback's designed runs and the pass
game are untouched. Game results for a seed changed with this.

Season level, three seeds (11 to 13) against the real 2026 teams, lead back's share of
non-quarterback carries:

| | Real | Sim |
|---|---|---|
| Mean | 46% | 47% |
| Standard deviation | 11.3 | 10.9 to 11.5 |
| p10 / p50 / p90 | 33 / 45 / 63 | 34 / 45 / 64 |
| Teams at 60% or more | 13% | 14 to 15% |
| Lead back carries a game, mean / p90 | 12.3 / 16.7 | 13.6 / 20 to 21 |
| Lead back yards a game, mean / p90 | 65 / 100 | 62 / 101 to 107 |

The leading rusher now ends a 13-game regular season around 1,600 to 2,000 yards on 300 to
360 carries, the real 2026 pace (seed 13's Doak Walker winner: 348 carries, 2,038 yards). The sim's lead back carries a little more than the real
one because the sim hands non-quarterbacks two or three more carries a game than real
teams do.

The sim now knows which real teams ride one back. `tools/derive_tendencies.py` computes
each team's observed split (the top back's share of running back carries in an average
game, `rb1_share`, and the second back's), `teamdata/build_teams.py` passes it into the team's
tendencies for every team with two or more box scores, and `roster.Team._lead_profile`
reads the feature score off `RB_LEAD_SHARE_CURVE` in `engine/game_config.py`, the share
each feature produces in the sim (measured by forcing a feature over 120 real games),
whenever the team's real lead back leads. Fictional teams, teams without box scores and a
team whose lead back is hurt keep the roster-derived score; the split that
`tools/tune_from_real.py` writes is the fallback when there is no observed share. The
observed share counts games against FCS schools, where real teams bench their backs harder
than the sim does, so it runs about two points under the share in FBS games; the curve is
the midpoint of the lead back's own share and the top back's, which leaves the per-game
share a point low and the season-level share a point or two high.

`calibrate_players.py 8` (388 games): RB1 share of RB carries 52.1% against 53.1 real
(was 52.9), correlation 0.49 (was 0.34 with the tuned split, 0.10 from the roster alone),
average miss 10.8 points (12.0); RB2 share 27.8 (26.8 real); RB1 carries 13.7 (14.0),
yards 67 (70); the sim's top back is the real one in 61% of team-games (63%). The honest
ceiling for that correlation is about 0.40 to 0.60: a team's own season mean predicts its
per-game share at 0.40 leaving each game out, 0.61 keeping it in. Season level (seed 11):
lead back share mean 48.7% (real 46), sd 10.5 (11.3), p10 / p50 / p90 37 / 47 / 63
(33 / 45 / 63), max 82 (83), 15% of teams at 60% or more (13%); the sim's season share
correlates 0.81 with the observed per-game share across the 138 real teams. smoke_test 400:
0 mismatches. Game results for a seed change.

Later, with the depth-chart fix and the carrier running against the defense's pursuit, the
lead backs ran hot over full seasons (54 thousand-yard rushers against 44-51 real, leaders
8% above real at ranks 1-50). The workhorse end of the return chance went from 1.0 to 0.6 a
snap (`RB_LEAD_RETURN_CHANCE` (0.07, 0.6)): over 4 full seasons 47 thousand-yard rushers and
the rushing leaders 5% off; game picks held (20 seasons through week 8: favorite won 73.6%
to 74.0%, Brier 0.182 both; real-versus-sim wins correlation 0.62 to 0.66;
`calibrate_season.py 30` 74.5%, MAE 12.4, slope 1.02).

Weekly refresh, in order: `python tools/fetch_results.py`, `python tools/fetch_boxscores.py`,
`python tools/derive_tendencies.py`, `python -m teamdata.build_teams`, then the three calibration scripts.
footballdb.com (season team stat tables, past seasons) is reachable from Python as well
and is a good cross-check for the team-level numbers; NCAA.com stays the primary source.

## In-season form

The preseason ratings never moved during a season, so by midseason the sim was still
rating teams the way the rosters looked in August while the market had six weeks of
results priced in. On the week 7 forward test the market beat the sim 12-5 when the two
disagreed on a winner, and the gap sat in G5 games, where the roster ratings are
thinnest. `sim/form.py` fits one number per team, in points of margin, by ridge least
squares on the real 2026 margins (`data/season_games.json`): margin = home field +
preseason gap + form of the home team minus form of the away team. Margins are capped at
28 so a blowout does not swing a team, and the ridge pulls toward zero, so after n games
a team keeps n / (n + 4) of what the results say. The sim carries the form as a shift of
every player's ratings (points divided by 1.36, the sim's margin per rating point, capped
at 12). `python -m sim.form [through_week]` prints the table.

The forward test fits the form from every result before the predicted week and sims with
the shifted ratings (`--no-form` for preseason ratings only; the frozen file records each
side's form). A "rest of season" season fits it once, from the results through its
current week, and applies it in every sim and in the This week preview; a full season
from the preseason carries none. `python tests/test_form.py` checks the fit and the shift.

Back-test on week 7 (59 games, 50 sims each, the same engine and seeds, form fitted on
weeks 1-6 only): margin MAE 11.8 to 11.2, RMSE 16.1 to 14.2, slope of actual on
predicted 0.47 to 0.89, correlation 0.21 to 0.46, and the sim's margins sit 4.5 points
from the closing line instead of 7.5. Straight up (66.1%) and against the spread
(36-21-2 against 37-20-2) did not move that week: the form fixes how big the margins are
far more than which side they fall on.

### Game-day spread

Real college football margins land about 16-17 points from the line; the engine's own
spread was 15.6 with `GAME_FORM_SD` at 3.6, so it is 4.4 now (16.3 measured by
`python tools/measure_variance.py`). With team form and the wider spread together the
week 7 back-test reads 72.9% straight up, 38-19-2 against the closing spread, margin MAE
10.9, and the win odds are calibrated bucket by bucket (sim 32% / won 29%, 50 / 50,
72 / 75, 84 / 83).

### Player form (fitted, shown, not applied)

`sim/form.py` also fits every matched player from the real box scores: his production
(passer rating, yards a carry with volume, receiving yards a game, field goal rate, punt
average, tackles with loss tackles, sacks and interceptions weighted) placed on the
league's distribution for his position, against where his rating sits among the league's
starters, shrunk by games played and capped at 5 rating points; defensive backs are left
out because tackles say little about coverage. The player card in a rest-of-season
season shows the result as a "Box scores" tag. The shifts reach the sims only with
`FORM_PLAYERS=1` set, because on the week 7 back-test they made the picks worse (72.9% to
66-70% straight up, MAE 10.9 to 11.1-11.3): production percentiles punish players on
dominant teams, whose defenses sit and whose backs rest in blowouts. A production model
that accounts for the team's pace, leads and opponents would be the way to make this
pay; the fit and the plumbing are in place for it.

## Forward test: picks frozen before kickoff

Everything above is in-sample: the ratings and tendencies already reflect the games they
are checked against. `tools/forward_test.py` is the out-of-sample check. Before the week's games:

```
python tools/forward_test.py predict
```

runs `tools/fetch_results.py`, takes every unplayed game in the lowest week that still has one,
keeps the games between two teams the engine knows, simulates each 50 times at the real
venue (`--sims N` to change), prints the picks, and writes `data/predictions/weekNN.json`:
predicted margin and its spread over the sims, home win probability, predicted total, each
team's expected points, and each team's expected QB1 (attempts, completions, yards, TD),
RB1 (carries, yards) and top-receiver (catches, yards) lines under the sim's player names,
plus the time it was made and the git commit of the engine. An existing week file is never
overwritten, so commit it: the commit is the proof the picks were frozen before kickoff.
The site shows the latest file as the "This week's picks" panel; its Open button sets the
pickers to that matchup.

After the games are final:

```
python tools/forward_test.py score 07
```

reruns `tools/fetch_results.py` and `tools/fetch_boxscores.py`, then scores the frozen file the way
`tools/calibrate_season.py` does (straight-up accuracy, margin MAE and RMSE, slope of actual on
predicted, home bias, total-points bias, win-probability calibration by bucket) and, for
the player lines, the error and bias of the QB1, RB1 and top receiver yards against the
real box score, matching the sim's player to the real one by last name (a second column
compares the same role regardless of who filled it). The report is saved next to the
prediction file as `weekNN_score.json` and `weekNN_score.txt`, and the picks panel shows
the headline numbers. Games not yet final are listed as pending and can be scored again later.

**Hand rating edits** (`data/manual_ratings.json`, applied by `build_teams.apply_manual_ratings`
after the real adjustments, so `tools/tune_from_real.py` never overwrites them). Engine points on
the normalized scale, each with its reason: the real 2026 player form after week 8 (production
percentile against the rating's, six games or more). The first set, October 26: four
quarterbacks up (Mississippi State's Kamario Taylor, 91st percentile against a 5th percentile
rating, +10 passing +6 decision making; West Virginia's Michael Hawkins Jr. +8/+4; Wake
Forest's Gio Lopez and Northwestern's Aidan Chiles +5/+3), two backs and two receivers up (Texas
Tech's J'Koby Williams, Iowa State's Aiden Flora, Syracuse's Umari Hatcher, Oklahoma State's
Justin Bowick), and Minnesota's Darius Taylor, Michigan's Jordan Marshall, Auburn's Byrum Brown,
Kansas State's Avery Johnson and Clemson's T.J. Moore and Bryant Wesco Jr. down. The edits move
the attributes the engine plays with, not the card's overall. `tests/test_manual_ratings.py`
checks every edit names a rostered player and that the build applied them all; the dry runs of
weeks 7 and 8 before and after are the out-of-sample check (below).

Betting lines come from scoresandodds.com (`tools/fetch_lines.py`, one small request per
game date). `predict` stores the line on the board when the picks are frozen (spread,
total and the opener); `score` fetches the closing line for every final game and reports
the record against the closing spread next to straight up (the sim's side of the line is
the home team when its predicted margin beats the spread; a game that lands on the number
is a push), plus how far the sim's margins sit from the market on average. A frozen file
without lines, or a day the board cannot be reached, falls back to the frozen line or to
"no line" for that game.

`python tools/forward_test.py dryrun 6` proves the whole path on a week already played: it
predicts that week into a temporary folder, scores it, prints the report and deletes the
folder. Being in-sample, its numbers are a check of the code, not of forward accuracy.
On week 6 (58 games, 50 sims each) the dry run scored 62.1% straight up, margin MAE 14.3,
slope 0.72, total points 49.4 predicted against 51.1 real, QB1 pass yards 36 high and RB1
rush yards 22 low for the real lead back (the sim spreads carries over more backs).

### Week 7 re-pick with the current engine

The week 7 picks were first frozen on Oct 15 at 50 sims per game on the engine before the
garbage-time, situational-football and speed work. Brian chose to replace them, so
`data/predictions/week07.json` now holds the week re-simulated 100 times on the engine as
of 1a5854a, made Thursday evening Oct 15 before the Thursday games. The four Tuesday and
Wednesday games it includes were already final (it got three of the four right) and are
not out of sample. Against the first file: 9 of 55 picks flipped, all games the first
file had inside 6 points; the average pick moved 2.5 points and blowouts came in shorter
(Texas over Florida 27 to 18, Oregon over Nebraska 22 to 16). The first file is in git
history at commit 1fb13db's successors (`git show 6aad296^:data/predictions/week07.json`).

## Situational football and the clock

`engine/situation.py` decides what each team is trying to do on every snap, at the end of
either half and late in close games, under the college clock rules:

- **Clock rules.** The clock stops on an incomplete pass, out of bounds, a penalty, a score,
  a change of possession and a timeout. After a first down or an out-of-bounds play it
  restarts on the ready-for-play signal, except inside the last two minutes of either
  half, where it stays stopped until the snap. Each team has three timeouts per half. A
  snap takes 5 to 8 seconds; the runoff before the next snap depends on the offense's pace.
- **Two-minute offense.** Trailing inside four minutes of the game, tied inside 1:40 (and in
  the last 100 seconds of the first half when in or near range): fast snaps, more passes,
  ball carriers get out of bounds, timeouts after in-bounds plays, a spike with no timeouts
  left, a field goal on any down when the clock leaves one play, and a Hail Mary from
  beyond range with seconds left. Tied before 1:40, a team plays normal football; tied and
  inside its own 30 with under 40 seconds, it runs it out and takes overtime.
- **Playing for the kick.** Tied or down 1-3 inside the last minute with a field goal of 40
  yards or less: run more, fewer big-play risks, kick at the end. Down 1-3 late on fourth
  down with a kick of 50 or less, the coach kicks to tie or take the lead instead of going
  for it. Down one score with more than four minutes left, fourth downs are normal football,
  40% bolder, not desperation.
- **Running the clock.** A leader in the fourth quarter runs more, stays in bounds and
  snaps late: fully inside five minutes, from ten minutes up two scores, all quarter up
  17 or more. It kneels once the remaining time can be burned given the defense's
  timeouts. Deep in its own end with under 30 seconds in the first half, a team runs it out.
- **Defense.** Leading late by two scores or less: prevent (more completions underneath,
  half the big plays, carriers kept in bounds). Trailing late (tied: inside 1:40): timeouts to stop the clock.
- **Onside kicks** trailing by one score inside two minutes or two scores inside five
  (11% recovery), and the standard **two-point chart** in the fourth quarter (go for two
  when trailing by 2, 5, 10, 13, 16, 18 or 21 after the touchdown, or leading by 1, 4, 5 or 12).
- **Garbage time.** Up 35 in the second half (45 any time): conservative play, slower pace;
  at 42 both teams' starters sit (see "The October 19, 2026 tuning").

`tools/fetch_linescores.py` pulls quarter scores for every FBS game 2014-2025 and
`tools/calibrate_late.py` compares how games end. Against 8,603 real regular-season games
(the sim plays 1,500 random FBS matchups, which are more lopsided than real schedules, so it
has fewer one-score games); "before" is the engine before the late-game changes above
(tied teams hurrying from 4:00, no playing for the kick):

| Measure | Real | Sim | Before |
|---|---|---|---|
| Points by quarter | 22 / 30 / 23 / 25 % | 21 / 31 / 21 / 28 % | 21 / 31 / 21 / 28 % |
| One-score games (8 or fewer) | 36.7% | 29.1% | 27.4% |
| Overtime | 4.4% | 3.2% | 2.3% |
| Trailer wins when down 1-3 entering the 4th | 37.7% | 33.1% | 39.3% |
| Trailer wins when down 4-8 | 24.4% | 21.9% | 22.3% |
| Trailer wins when down 9-16 | 9.3% | 9.0% | 6.7% |
| Trailer wins when down 17+ | 0.7% | 0.4% | 0.0% |
| 4th-quarter points, team trailing after three | 6.66 | 5.68 | 5.69 |
| 4th-quarter points, team leading after three | 7.22 | 8.39 | 8.45 |

## Changes from the original football_sim engine

The drive loop, special teams, fatigue, substitutions and play-calling tables are the
original code. The play cores (`get_run_yards`, `get_pass_yards`) were rewritten as
rating-difference formulas because the originals could not be tuned. Bugs fixed along
the way: 4th-down conversions followed by a punt, defensive touchdowns that never ended
the drive, uncredited or double-credited rushing touchdowns, punt returns by the wrong
team, ignored interception and fumble return spots, an offside that moved the offense
backward, field goals from 65 to 71 yards, and kickoffs that gave the receiving team the
ball near midfield. Calibration changes: two 30-minute halves with a clock that stops on
incompletions and ends drives at the half, penalty rates cut to real levels, fumbles on
catches and strips on sacks, fourth-down decisions built around real attempt rates
including trailing-late desperation, a college field goal make table, college kickoff rules,
and per-team counters for first downs, third and fourth downs, red zone trips, penalties
and fumbles lost.

`tests/smoke_test.py 400` runs 400 games and reports any game whose stats do not add up to its
score. It should report zero mismatches.
