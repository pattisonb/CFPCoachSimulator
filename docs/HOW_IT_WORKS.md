# CFP Coach Simulator: how it works

The technical guide: running and hosting the server, the engine, the data, the
calibration and the test tools. File paths are relative to the project root. The
player-facing overview is the [README](../README.md).

Pick any two of the 146 teams in `cfb_sim_data/` (138 real 2026 FBS programs plus 8
fictional FCS schools), choose a home field or a neutral site, and hit **Sim Game** for
one game or **Sim batch** for a series. Every game shows the scoreboard by quarter, the
scoring summary, team stats, player stats and a drive chart, and is saved to the history
column. The engine is calibrated against FBS season averages and against the real 2026
results played so far.

## Run it

```
pip install -r requirements.txt
python server.py
```

Then open <http://127.0.0.1:8000>. On Windows, `run.bat` does the same. The first start
builds `data/engine_teams.json` from `cfb_sim_data/` (about 20 seconds); run
`python build_teams.py` again whenever the source data changes.

### On a phone

The server listens on every network interface, so a phone on the same Wi-Fi opens the
site at `http://<this PC's address>:8000` (the server prints the address when it starts;
`ipconfig` shows it as the Wi-Fi IPv4 address). The page is laid out for phones, and on
iPhone "Add to Home Screen" installs it as an app icon. Two things can block it:

- **Windows Firewall.** Windows blocks Python on networks marked Public. Either mark your
  home Wi-Fi as Private (Settings > Network & internet > Wi-Fi > your network > Private),
  or allow Python through the firewall for Private and Public networks.
- **Address changes.** Home routers can hand the PC a different address after a restart;
  check the server's startup line again if the phone stops connecting.

`python server.py --local` keeps the server reachable from this PC only.

## GitHub and hosting

The code lives at <https://github.com/pattisonb/CFPCoachSimulator>. Generated files
(`data/engine_teams.json`, `data/games.json`, `data/season_results.json`) are ignored
and rebuilt on the server; the source data, box scores and season results are committed.

**Free hosting on Render** (fits a Python server that runs CPU-bound sims; Vercel's
serverless functions time out on long batches and cannot keep a running process):

1. Sign in at <https://render.com> with GitHub and choose New > Blueprint.
2. Pick the `CFPCoachSimulator` repo. Render reads `render.yaml`, installs the
   requirements, runs `build_teams.py`, and starts the server on its port.
3. The site comes up at `https://cfp-coach-simulator.onrender.com` (or whatever name
   Render assigns). Every push to `main` redeploys.

Free-tier limits: the service sleeps after 15 minutes without traffic and takes up to a
minute to wake; game history is kept in memory and resets on each deploy or wake. A
batch of 100 games takes about 5 seconds on Render's free CPU.

## House style for team marks

Every team mark on the site is the diagonal square from `teamPill(slug)` in
`web/gameview.js`: primary over secondary on a diagonal with the accent color as the
border. Never draw a flat single-color square (`pill-inline` with an inline background);
the only plain square is the gray "empty" placeholder for a slot with no team yet.

## What is where

| Path | What it is |
|---|---|
| `cfb_sim_data/` | Source data: rosters with EA-derived ratings, coaches, stadiums, colors (see its README) |
| `build_teams.py` | Converts the source into the engine's roster format (rating map and normalization below) |
| `data/engine_teams.json` | The converted league the server loads (10 MB, generated) |
| `engine/` | The simulation engine; `engine/game.py` plays a full game and returns a result dict |
| `engine/game_config.py` | Sliders and every calibration constant |
| `server.py` | FastAPI server: team list, sim, history; serves `web/` |
| `web/` | The site: plain HTML, CSS and JavaScript, no build step |
| `tools/fetch_results.py` | Downloads the 2026 FBS results played so far from NCAA.com into `data/season_games.json` |
| `tools/fetch_schedules.py` | Downloads every FBS team's 2026 schedule from ESPN into `data/schedules.json` |
| `season.py` | Week-by-week season engine: polls, title games, bracket, playoff (`python season.py ohio-state full`) |
| `polls.py` | AP poll model, committee model and the 2026 bracket rules |
| `awards.py` | The awards: Heisman vote, national awards, All-America and all-conference teams, coaches |
| `teamnames.py` | Matches real-world team names (NCAA.com, ESPN, poll archives) to the engine's slugs |
| `data/rivalries.json` | Rivalry games, trophies and the all-time series entering 2025 |
| `tests/` | The checks, one script each, run as files: `python tests/run_all.py` runs them all and reports pass/fail |
| `tools/` | Data downloads, calibration and research scripts, run from the project root (`python tools/fetch_polls.py`) |
| `bowls.py` | The 2026-27 bowl lineup, selection by conference tie-ins, and which bowls host the playoff rounds |
| `tools/fetch_bowls.py` | Downloads the bowl schedule and every bowl's tie-ins and history from Wikipedia into `data/bowls.json` |
| `tools/fetch_polls.py`, `tools/analyze_polls.py`, `tools/calibrate_polls.py` | 2014-2025 poll archive, the behaviour study, and the model fit |
| `tools/calibrate_season.py` | Replays every real 2026 game N times and compares predicted and actual margins |
| `tools/calibrate.py` | Per-team stat benchmarks against FBS 2025 averages (`league` mode uses the real rosters) |
| `tools/fetch_linescores.py`, `tools/calibrate_late.py` | Quarter scores 2014-2025 and the late-game comparison (close games, comebacks, overtime) |
| `tools/fetch_boxscores.py` | Downloads every played game's player box score into `data/boxscores/` |
| `tools/derive_tendencies.py` | Each team's real 2026 pass rate, pace and usage shares, used by `build_teams.py` |
| `tools/calibrate_players.py` | Compares sim player lines and usage shares with the real box scores |
| `tools/forward_test.py` | Freezes the sim's picks for the next week of real games, then scores them once played |
| `data/predictions/` | The frozen weekly picks (`weekNN.json`) and their score reports (`weekNN_score.*`) |

## API

- `GET /api/teams` lists every team with ratings, colors, stadium and head coach.
- `GET /api/teams/{slug}` adds the roster with starters, returners and display ratings.
- `POST /api/sim` with `{"home": "ohio-state", "away": "texas", "venue": "home" | "neutral", "count": 1, "sliders": {}}`
  returns `{"games": [...], "summary": {...}}`. The first team hosts unless the venue is neutral.
- `GET /api/games`, `GET /api/games/{id}`, `GET /api/history/summary`, `DELETE /api/games`.
- `GET /api/sliders` returns slider defaults and groups.
- `GET /api/predictions` returns the latest frozen week of picks from `tools/forward_test.py`, with a `score`
  block once that week has been scored (`{"week": null, "games": []}` when there are none).

## How the data feeds the engine

**Players.** Each source player has 54 EA-style ratings (0-99, 50 = average FBS player):
EA College Football ratings put through one curve that stretches the low end (EA 90
becomes 82, EA 80 becomes 63, EA 72 becomes 49). The source keeps EA's own numbers too
(`overall_ea`, `ratings_ea`); `build_teams.py` carries the EA overall as `ea_overall`.
The pages show the house scale instead: 1-99 where 50 is an average Power 4 starter at
the position, 65, 80 and 95 are a Power 4 starter one, two and three standard deviations
better, and below the average a standard deviation is worth 60% as much (`BELOW` in
season.py), so a typical Power 4 backup or Group of 5 starter reads about 40 and a
walk-on in the 20s. A card's overall is EA's overall on that scale (`ea_house`; a
god-mode edit moves it by what the edit does to the engine composite); attributes and
"rated at every position" put the engine values on the same shape (`_house_scale`, one
pair of slopes per position group). Jeremiah Smith is a 98, a good Power 4 quarterback
about 70, a former five-star rated EA 82 about 51 whether he starts or not.
The engine works on its own position-relative values underneath (an average FBS starter
at the position is 55, scaled by `SPREAD_SCALE`) and never reads the EA overall;
god-mode edits typed on the house scale are converted back.
`build_teams.py` maps them to the engine's attributes: throw accuracy and power to
passing, awareness and throwing under pressure to decision making, agility, jukes and
break tackle to elusiveness, man and zone coverage to coverage, power and finesse moves
plus block shedding to pass rush, and so on (the full map is in the file's docstring).
Every attribute is then re-centred so that the league-average FBS starter at that position
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
Tendencies are centred so the FBS average is 50. Army, Navy and Air Force run about 70%
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
college football shows around the closing line, so a 21-point favourite now loses about
one game in ten and a 28-point favourite a few in a hundred (they lost almost never
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
| Favourite wins, rating gap 6-10 | 92.5% | 77.6% | 84.2% |
| Power 4 over Group of Five | 96.2% | 87.9% | 92.8% |
| Points allowed per defense-rating point | -0.50 | -0.28 | -0.51 |
| Points scored per offense-rating point | 0.58 | 0.73 | 0.65 |
| Bottom-third defenses, points allowed | 30.2 | 28.4 | 30.7 |
| Sim favourite won (388 games) | | 68.6% | 70.6% |
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
0.97 to 1.05, with game picks unchanged (favourite won 72.6% / 72.8%).

Two other changes were tested the same way (20 seasons each, one change at a time) and
left out:

- **Fewer interceptions** (the scramble decided before the throw, `INT_BASE` 0.065 to
  0.060; and the review's flatter slopes, 0.0013 to 0.0007 a point). Interceptions fell from
  3.0 to 2.5 per 100 attempts (real 2.3 through week 8, 2.6 over the 2025 season), but every
  run with it picked fewer winners: favourite won 70.2% against 72.6%, Brier 0.190 against
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
favourite won 72.4% before, 73.6% after; Brier 0.187, 0.182; `calibrate_season.py 30`:
74.0%, MAE 12.5, slope 1.01). One cost: sim players who never appear in a real box score
but play 5+ sim games rose from 170 to 188, because coverage tackles give backups a stat
line. Play-log fingerprint 5368e4b5cb876edc.

**Tested and left out: more fourth-down tries.** The sim goes for it 1.5 times a game
(real 2.1) and tries 1.4 field goals (real 1.6). Multiplying the go-for-it odds by 1.8
short of the opponent's 40 or on fourth-and-1 or 2, and trying 60% of 50+ yard field goals
instead of 45%, gave 1.7 tries a game at a 52% conversion rate, points +0.7 a game in
`calibrate.py league 400` (+0.3 over full seasons), and every benchmark in band. It cost
picks in both checks: 20 seasons through week 8, favourite won 73.6% to 71.4% and Brier
0.182 to 0.187; `calibrate_season.py 30` 74.0% to 71.9%. More fourth-down tries add variance,
which helps underdogs. (A version applying the multiplier everywhere took the tries from
field-goal range: 1.8 tries but 1.25 field goals.)

**Tested and left out: fewer sacks.** Full seasons have 24-27 ten-sack players against
15-17 real, and every rank of the sack leaderboard runs 10-19% high (team sacks 2.25 a game
against 2.0), so it is volume, not who gets the credit. The review's `SACK_BASE` 0.050 to
0.046 with `SACK_PER_QB_POINT` 0.0004 to 0.0002 brought ten-sack players to 19, but cost
picks (20 seasons: favourite won 74.0% to 71.8%, Brier 0.182 to 0.184); the base cut alone
was worse (Brier 0.190, real-versus-sim wins correlation 0.66 to 0.61). The sack rate is
one of the places where line and QB ratings decide games, so it stays.

## Quarterback runs (overnight review item 2.7)

Designed QB runs came from QB1's share of his team's rushes less a flat 10 points (6 for
sacks, which college box scores count as rushes, and 4 for scrambles). Low-sack teams and
teams with a run-package second quarterback lost most of their designed runs: James Madison
3.7% (real 15-18%), Texas Tech 0.5, Notre Dame 0, NDSU 1.2. Now `tools/derive_tendencies.py`
counts every quarterback's carries (anyone who threw a pass, or is on the roster as a QB) and
the sacks the team took (the opponent's defensive line), and `build_teams.py` takes the
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
margin error held (`calibrate_season.py 30`: MAE 12.4, slope 1.00), but the favourite won
less often (73.9% to 71.1%; `calibrate_season` 74.5% to 72.2%; the October 20 baseline before
this round was 72.7% in both). The share fix alone was worse on every measure (Brier 0.185),
so the two go together. Rebuild the teams after pulling this (`python build_teams.py`).
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
noise in these checks (about +-0.004 Brier, 2-3 points of favourite-won rate).
Play-log fingerprint 99510529d1e1827c.

**Blitzing defensive backs.** `blitz_rate` was written into every team but read nowhere,
and only linemen and linebackers rushed, so corners and safeties had no sacks (real 2026
through week 8: 158 of about 1,900). Now a sack goes to a corner or safety on the field
`DB_SACK_SHARE` 8% of the time at blitz_rate 50, scaled by the defense's blitz_rate (13 to
89 across FBS). It is credit only, drawn from the stat random stream, so every game score
is unchanged (checked on 40 games). Play-log fingerprint 0b3de0274cc130a7.

**3-3-5 fronts play three safeties** (Wake Forest, Troy, Tulsa and UAB do; `personnel.FRONTS`
had three corners and two safeties). Tested together with a 75/25 split between the second
and third running back (`BACKUP_RB_ROTATION` 0.40 to 0.20): picks held (20 seasons: favourite
won 69.8% to 72.0%, Brier 0.185 to 0.183; `calibrate_season.py 30` 72.2% to 70.9%, MAE 12.4
to 12.6), but the backs' carries matched real box scores worse (average miss 15.8 to 18.0
carries), so the running-back split was left out. Play-log fingerprint 33a30b0570a78958.

## Player stat lines against real box scores

`tools/fetch_boxscores.py` downloads every played game's box score from the NCAA GraphQL feed
(per-player passing, rushing, receiving, kicking, punting, returns and defense, plus team
plays, third and fourth downs, penalties and fumbles) into `data/boxscores/`.
`tools/derive_tendencies.py` turns those into each team's real 2026 pass rate, pace, QB run
share, back and receiver shares and fourth-down rate (`data/observed_tendencies.json`),
and `build_teams.py` uses them in place of the generated coach tendencies for every team
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

`python tools/tune_from_real.py` reads the real season (`realdata.py`) and writes
`data/real_adjustments.json`, which `build_teams.py` applies on top of the source rosters
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
- **The engine plays the depth chart.** `build_teams.py` writes each roster in depth order
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

40 seasons through week 8 against the committed data: favourite won 72.7% to 73.1%, Brier
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
real line goes to the right name; then `realdata.py` matches his box scores and the depth
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

Tested together with the added players (40 seasons through week 8): favourite won 73.1% to
71.9% and Brier 0.176 to 0.177 (both inside the noise), real-versus-sim wins correlation
0.639 to 0.652; `calibrate_season.py 30` 70.4% to 72.9%, MAE 12.5, slope 0.99. Play-log
fingerprint e8d02e170713db66.

Then the engine side: teams still passed 1.2 points of share less than real across the
board (`PASS_LEAN` 0.016 now comes off every run chance), and plays per game varied too
little from team to team (`TEMPO_EFFECT` 0.60 to 0.80). Over 40 seasons: pass-share bias
-1.2 to +0.2 points (error 2.19 to 2.06), plays per game across teams spread 3.5 to 4.1 (real
5.1, about 4.4 once the sampling noise of seven games is taken out) and correlation 0.76 to
0.81; favourite won 71.9% to 73.3%, Brier 0.177 to 0.176. `calibrate_season.py 30`: 72.2%,
MAE 12.7, slope 0.94 (0.99 before: faster teams run up wider margins). Play-log fingerprint
276d229ae94c1256.

## Real 2026 (its own page)

`/real` (the "Real 2026" tab in the top nav) shows the actual 2026 season with the season
page's tabs, read-only: every real result, the real AP polls with their vote points, the
standings, the bracket and bowl projections from them, and real stats from the NCAA.com
box scores (`realdata.py` turns each one into the game's stat lines and matches 93% of
player lines to a roster player by name and jersey number). Every FBS game opens its real
box score; player pages show the real season, a real game-by-game log and FBS ranks; the
Awards tab runs a real Heisman straw poll and award races on the real numbers. Pick any
team in the header to follow it. "Refresh real data" downloads the latest results, box
scores and polls (a few minutes) and rebuilds; `python realdata.py --fetch` does the same
from the command line. The page never simulates anything; the sim sections are "Sim a
game" and "Sim a season".

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

Through week 8: 25,610 player lines, 92.8% matched (was 92.7%, with the cross-unit jersey
matches counted as right); 138 notable lines unmatched (was 142), all players missing from
the rosters. Real field goals: 1,111 tried, 927 made (83.4%), 1.43 a team-game; 1,513 extra
points made in the 556 team-games that list them. `tests/test_realdata.py` checks the
matching rules. Re-tuned from the new import (`tools/tune_from_real.py`): depth charts
changed at Miami, Oregon State, USC, Utah State and UTSA, and USC's target weights now
include Zacharyus Williams and Ethan Feaster. Play-log fingerprint 74752a0512ab4386.

## Season mode (its own page)

Open **/season** (or hit **Sim Season** on the matchup page). Pick your team and a mode,
start a season, and play it a week at a time with **Advance week**, or jump with **Sim to
selection** or **Sim to the end**. The week strip lets you look back at any week. Tabs:

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
  kicker, returner) totalled from the box scores of your games, the national leaders in
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
are the playoff. **Full season** starts from the real 2026 preseason AP poll and
simulates everything (the **New season** button); **Start from today** (the "remaining"
mode) keeps the real results, real polls, real stats and real box scores through the last
completed week: `realdata.import_real_boxes`, the same import the Real 2026 page runs,
turns every played game's NCAA box score into the game's stat lines and a box score the
season can open, so the leaders, awards races, player game logs and your season summary
start from the real numbers and simulated weeks add to them. FCS opponents play as the fictional school from the same region
(`data/fcs_map.json`). No injuries.

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
  "Pac-12 flex game". The real 2026 page skips this step and shows only real games.

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
(capped at 8); `1` simulates in-process, which `render.yaml` sets because the free tier
has a fraction of one shared CPU and 512 MB, where a pool only adds memory and spawn
cost. On that tier a week still takes 10 to 20 seconds and the service sleeps after 15
idle minutes, so a full season is a few minutes there; the fix for that is a paid Render
instance with a dedicated CPU or running the server locally (`python server.py`, LAN
access from a phone as described above).

The This week card simulates your next game 20 times. Those sims run in parallel on the
worker pool (about 1 second instead of 4 on a desktop), and the server starts them in
the background the moment a week finishes, so the card is ready or nearly ready when the
page asks; a second request for the same game waits for the first instead of simulating
it again. The Awards tab's live race is cached until more games are played (or god mode
edits a player), and the award pools list each position group's eligible players once
instead of scanning the whole league for every award (2.5 seconds to 1 on first load).
If a progress check collides with the sim thread changing the season, it answers with
the last good record; the page retries a missed check up to five times, and if the
server no longer has the season (the free host forgets saved seasons when it restarts)
it closes the season and says so instead of waiting forever.

### Team colours

While a season is open the page wears the team's colours. The accent (buttons, week
chips, the progress bar, your row in tables) is the first of the team's primary,
secondary and accent colours that reads against the page in the current light or dark
theme (contrast at least 2.6 to the background and panels); if none does, the primary is
pushed toward white or black until it does. The ink on the accent is black or white,
whichever contrasts more. The top bar and the season header's title band are solid in
the primary with a line of the secondary, their buttons take the first other team colour
that reads against the primary, the page background is washed in the primary at the top,
and panel headings and the active tab take the accent. Michigan is maize on dark and navy on light, Penn State is
navy on light and white on dark, Oregon is green on light and yellow on dark, and so on;
the accent is re-picked when the theme toggle flips.

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
(`tests/test_poll_behaviour.py`). In "rest of season" mode the real weeks show the real
polls with their real vote points, so the first modelled poll starts from the real one.
The season-long scores still run underneath for the committee model.
`python tools/ap_forecast.py predict` freezes a forecast of the next real poll and
`score NN` compares it once the poll is out; `python tools/fetch_polls.py --others` adds
the others receiving votes to an older archive.


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
against the real 2026 poll flagged three behaviours: narrow wins were never punished, teams
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
season replay plus 0.05 x the gap to the real behaviours above (`BEHAVIOURS`), with the
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
| Behaviour gap, 2024-2025 (units) | 6.30 | 4.29 |

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
slots used for selection are a curated 2026 table in `bowls.py` (for example Citrus: SEC
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
which is also what shows before the first game is played. A season started from today counts the real games already played (from their NCAA
box scores) and adds every simulated game; a season saved before season-long stats
existed shows only your own games.

### Awards: the Heisman, every national award, All-America and all-conference teams

The research is in `docs/AWARDS_RESEARCH.md` (every award and who wins it, the Heisman
vote 2014-2025, the All-America and all-conference formats, winning stat lines). The
engine now keeps the stats the awards need: tackles for loss, passes defended, hurries,
explosive plays, first downs, long plays, field goals by distance, punt placement, snaps
and starts, and offensive-line credits (sacks and pressures allowed, stuffs, key blocks).
Attribution choices use a separate random source, so game results for a given seed are
unchanged. Rosters now carry class, height, weight, jersey and the depth-chart role (LT,
LG, C, RG, RT, edge, DT, SAM/MIKE/WILL, CB, FS, SS).

`awards.py` scores every player from the season stats: a production score per position
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
(`POSITION_RATINGS` in season.py: passing, decisions and awareness for a quarterback;
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
a 21-point result, so a heavy favourite's win or an FCS win adds little and an upset
moves both teams a lot (`MORALE_RESULT`, `MORALE_BLOWOUT`). Flat steps of 0.25 a result
used to pin good teams at +1 by midseason: in 5 simulated seasons at week 8, 50 of 690
team values sat at +1 and Notre Dame was at +1 in 4 of 5; now 7 of 690, Notre Dame
0.72-0.82, still in record order. Player form leaves FCS games out (an FCS opener inflated
the season average, so later games read below par) and takes off the league's running
mean (`MORALE_Z_TRACK`): form averaged -0.04 with 56% of values negative, now -0.004 and
51%, with hot and cold streaks equally common (8% each). Game picks did not move
(20 seasons through week 8: favourite won 72.7% before, 72.4% after; Brier 0.186, 0.187).
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
observed 2026 pass rate, pace, quarterback run share and fourth-down rate (which
`build_teams.py` feeds into the sim in place of the generated coach tendencies), and
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
teams do, and the sim still does not know which real teams ride one back (correlation
0.10): the feature score comes from the roster, not from the observed shares that
`tools/derive_tendencies.py` already computes per team.

Later, with the depth-chart fix and the carrier running against the defense's pursuit, the
lead backs ran hot over full seasons (54 thousand-yard rushers against 44-51 real, leaders
8% above real at ranks 1-50). The workhorse end of the return chance went from 1.0 to 0.6 a
snap (`RB_LEAD_RETURN_CHANCE` (0.07, 0.6)): over 4 full seasons 47 thousand-yard rushers and
the rushing leaders 5% off; game picks held (20 seasons through week 8: favourite won 73.6%
to 74.0%, Brier 0.182 both; real-versus-sim wins correlation 0.62 to 0.66;
`calibrate_season.py 30` 74.5%, MAE 12.4, slope 1.02).

Weekly refresh, in order: `python tools/fetch_results.py`, `python tools/fetch_boxscores.py`,
`python tools/derive_tendencies.py`, `python build_teams.py`, then the three calibration scripts.
footballdb.com (season team stat tables, past seasons) is reachable from Python as well
and is a good cross-check for the team-level numbers; NCAA.com stays the primary source.

## In-season form

The preseason ratings never moved during a season, so by midseason the sim was still
rating teams the way the rosters looked in August while the market had six weeks of
results priced in. On the week 7 forward test the market beat the sim 12-5 when the two
disagreed on a winner, and the gap sat in G5 games, where the roster ratings are
thinnest. `form.py` fits one number per team, in points of margin, by ridge least
squares on the real 2026 margins (`data/season_games.json`): margin = home field +
preseason gap + form of the home team minus form of the away team. Margins are capped at
28 so a blowout does not swing a team, and the ridge pulls toward zero, so after n games
a team keeps n / (n + 4) of what the results say. The sim carries the form as a shift of
every player's ratings (points divided by 1.36, the sim's margin per rating point, capped
at 12). `python form.py [through_week]` prints the table.

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

`form.py` also fits every matched player from the real box scores: his production
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
- **Two-minute offense.** Trailing or tied inside four minutes of the game (and in the last
  100 seconds of the first half when in or near range): fast snaps, more passes, ball
  carriers get out of bounds, timeouts after in-bounds plays, a spike with no timeouts
  left, a field goal on any down when the clock leaves one play, and a Hail Mary from
  beyond range with seconds left.
- **Running the clock.** A leader in the fourth quarter runs more, stays in bounds and
  snaps late: fully inside five minutes, from ten minutes up two scores, all quarter up
  17 or more. It kneels once the remaining time can be burned given the defense's
  timeouts. Deep in its own end with under 30 seconds in the first half, a team runs it out.
- **Defense.** Leading late by two scores or less: prevent (more completions underneath,
  half the big plays, carriers kept in bounds). Trailing or tied late: timeouts to stop the clock.
- **Onside kicks** trailing by one score inside two minutes or two scores inside five
  (11% recovery), and the standard **two-point chart** in the fourth quarter (go for two
  when trailing by 2, 5, 10, 13, 16, 18 or 21 after the touchdown, or leading by 1, 4, 5 or 12).
- **Garbage time.** Up 35 in the second half (45 any time): conservative play, slower pace;
  at 42 both teams' starters sit (see "The October 19, 2026 tuning").

`tools/fetch_linescores.py` pulls quarter scores for every FBS game 2014-2025 and
`tools/calibrate_late.py` compares how games end. Against 8,603 real regular-season games:

| Measure | Real | Sim |
|---|---|---|
| Points by quarter | 22 / 30 / 23 / 25 % | 21 / 31 / 20 / 28 % |
| One-score games (8 or fewer) | 36.7% | 37.0% |
| Overtime | 4.4% | 2.5% |
| Trailer wins when down 1-3 entering the 4th | 37.7% | 41.2% |
| Trailer wins when down 4-8 | 24.4% | 22.8% |
| Trailer wins when down 9-16 | 9.3% | 9.5% |
| Trailer wins when down 17+ | 0.7% | 0.8% |
| 4th-quarter points, team trailing after three | 6.66 | 7.01 |
| 4th-quarter points, team leading after three | 7.22 | 6.98 |

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
