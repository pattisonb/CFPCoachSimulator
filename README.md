# CFP Coach Simulator

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
| `fetch_results.py` | Downloads the 2026 FBS results played so far from NCAA.com into `data/season_games.json` |
| `fetch_schedules.py` | Downloads every FBS team's 2026 schedule from ESPN into `data/schedules.json` |
| `season.py` | Week-by-week season engine: polls, title games, bracket, playoff (`python season.py ohio-state full`) |
| `polls.py` | AP poll model, committee model and the 2026 bracket rules |
| `fetch_polls.py`, `analyze_polls.py`, `calibrate_polls.py` | 2014-2025 poll archive, the behaviour study, and the model fit |
| `calibrate_season.py` | Replays every real 2026 game N times and compares predicted and actual margins |
| `calibrate.py` | Per-team stat benchmarks against FBS 2025 averages (`league` mode uses the real rosters) |
| `fetch_boxscores.py` | Downloads every played game's player box score into `data/boxscores/` |
| `derive_tendencies.py` | Each team's real 2026 pass rate, pace and usage shares, used by `build_teams.py` |
| `calibrate_players.py` | Compares sim player lines and usage shares with the real box scores |
| `forward_test.py` | Freezes the sim's picks for the next week of real games, then scores them once played |
| `data/predictions/` | The frozen weekly picks (`weekNN.json`) and their score reports (`weekNN_score.*`) |
| `smoke_test.py` | Runs N games and checks that every team's stats add up to its score |

## API

- `GET /api/teams` lists every team with ratings, colors, stadium and head coach.
- `GET /api/teams/{slug}` adds the roster with starters, returners and display ratings.
- `POST /api/sim` with `{"home": "ohio-state", "away": "texas", "venue": "home" | "neutral", "count": 1, "sliders": {}}`
  returns `{"games": [...], "summary": {...}}`. The first team hosts unless the venue is neutral.
- `GET /api/games`, `GET /api/games/{id}`, `GET /api/history/summary`, `DELETE /api/games`.
- `GET /api/sliders` returns slider defaults and groups.
- `GET /api/predictions` returns the latest frozen week of picks from `forward_test.py`, with a `score`
  block once that week has been scored (`{"week": null, "games": []}` when there are none).

## How the data feeds the engine

**Players.** Each source player has 54 EA-style ratings (0-99, 50 = average FBS player).
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

**Coaches.** The coordinators' pass-rate and tempo tendencies shift the run/pass table and
the clock, the head coach's fourth-down tendency scales the go-for-it odds, and the
play-calling ratings of the two coordinators tilt whether the defense guesses the play.
Tendencies are centred so the FBS average is 50. Army, Navy and Air Force run about 70%
of their snaps.

**Venue.** At a home site the home team gains and the away team loses half of a home
edge of 2.0 rating points plus up to 0.8 for stadium size (the data's 0-99 home field
number), which comes to about 4 points of margin for a big stadium. A neutral site applies
nothing. The `home_field_advantage` slider scales it.

## How realistic is it?

Two checks, both reproducible.

**Season replay** (`python fetch_results.py` then `python calibrate_season.py 30`): the 333
games played through week 6 of 2026 between two FBS teams, each simulated 30 times at
the real venue, compared with the real score.

| Measure | Sim | Reference |
|---|---|---|
| Straight-up picks correct | 71.5% | Vegas favorites win about 75-78% |
| Margin error (mean absolute / RMS) | 13.3 / 16.8 | Closing spreads: about 12-13 / 16-17 |
| Slope of actual on predicted margin | 0.94 | 1.0 means rating gaps are worth exactly what the sim says |
| Home bias (actual minus predicted, home games) | -0.6 points | 0 |
| Combined points, actual vs predicted | 52.2 vs 50.4 | |

By predicted margin, the real win rates track the sim's probabilities: home teams the sim
makes 7-to-14-point favorites won 76% (sim 73%), 14-to-21 won 84% (sim 86%), 21 or more
won 96% (sim 96%). The sim knows nothing about injuries, weather or week-to-week form,
which is most of the remaining gap to the betting market.

**League benchmarks** (`python calibrate.py league 400`): 400 random FBS matchups with the
real rosters, per team per game, against the mean of all 137 FBS teams in 2025 read from
TeamRankings on 2026-10-15:

| Stat | Sim | FBS 2025 | Stat | Sim | FBS 2025 |
|---|---|---|---|---|---|
| Points | 25.4 | 25.9 | First downs | 19.1 | 20.0 |
| Plays | 68.8 | 68.7 | Third down % | 40.7 | 39.1 |
| Total yards | 384 | 375 | Red zone trips / % | 3.9 / 83 | 3.5 / 83 |
| Yards per play | 5.6 | 5.46 | Fourth down tries / % | 1.65 / 63 | 2.1 / 53 |
| Completion % | 63.6 | 61.7 | Punts / net | 4.9 / 39.7 | 4.1 / 39.5 |
| Yards per attempt | 7.4 | 7.24 | Field goal tries / % | 1.45 / 80 | 1.59 / 75 |
| Yards per carry | 4.35 | 4.23 | Penalties | 6.0 | 6.0 |
| Sacks taken | 2.35 | 2.03 | Giveaways | 1.35 | 1.32 |

29 of 31 checks sit within about a tenth of the real number; punts run slightly high and
fourth-down conversions slightly easy. Average drive start after a kickoff is the own 27
(real: 27 to 30). Every constant lives in `engine/game_config.py`; change one, rerun the
two scripts, and compare.

## Player stat lines against real box scores

`fetch_boxscores.py` downloads every played game's box score from the NCAA GraphQL feed
(per-player passing, rushing, receiving, kicking, punting, returns and defense, plus team
plays, third and fourth downs, penalties and fumbles) into `data/boxscores/`.
`derive_tendencies.py` turns those into each team's real 2026 pass rate, pace, QB run
share, back and receiver shares and fourth-down rate (`data/observed_tendencies.json`),
and `build_teams.py` uses them in place of the generated coach tendencies for every team
with two or more box scores. `calibrate_players.py` replays each game and compares the
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

## Season mode (its own page)

Open **/season** (or hit **Sim Season** on the matchup page). Pick your team and a mode,
start a season, and play it a week at a time with **Advance week**, or jump with **Sim to
selection** or **Sim to the end**. The week strip lets you look back at any week. Tabs:

- **Games**: every game that week, your game first, with the AP ranks the teams carried
  into it; click your game for the full box score.
- **My Schedule**, **Standings** (every conference, champions marked after title games).
- **AP Poll**: the poll released after the selected week, with each team's move.
- **CFP Rankings**: the committee's ranking after weeks 9 through 13 and the final one
  after championship week, the 2026 release calendar (Nov 3, 10, 17, 24, Dec 1, Dec 6).
- **Bracket**: a projected bracket as soon as the first committee ranking exists (current
  conference leaders as projected champions), then the real bracket on selection day and
  the playoff results as the rounds are played.

The calendar: weeks 1-13 are the regular season (the 2026 schedule ends Nov 28), week 14
is championship week (the top two in every conference's standings meet on a neutral
field; head-to-head breaks ties), week 15 holds Army-Navy and the selection, weeks 16-19
are the playoff. **Full season** starts from the real 2026 preseason AP poll and
simulates everything; **Rest of season** keeps the real results and real polls through
the last completed week. FCS opponents play as the fictional school from the same region
(`data/fcs_map.json`). No injuries.

### The polls: built from twelve seasons of real polls

`fetch_polls.py` downloads every weekly AP Top 25 and CFP committee ranking from 2014
through 2025 plus every FBS result with the teams' ranks at kickoff (ESPN's archive;
`data/history/`). `analyze_polls.py` reports how voters actually behave. The numbers
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

`calibrate_polls.py` then fits the model: each historical season is replayed from its real
preseason poll with the real results, and the model's weekly top 25 is compared with the
real one. Result (data/poll_params.json): the AP model is off by **2.2 spots** per ranked
team on average and ranks **91%** of the teams the real poll ranked; the committee model
is off by **2.2 spots** and covers **90%**. The committee model adds strength of schedule,
wins over ranked teams, a heavier Group of Five discount, head-to-head among close teams
and a conference-title bonus on top of the AP-style score.

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

## Player stat lines and usage (box score calibration)

`fetch_boxscores.py` pulls the full player box score for every final game from NCAA.com
(the same feed its game pages use), `derive_tendencies.py` turns them into each team's
observed 2026 pass rate, pace, quarterback run share and fourth-down rate (which
`build_teams.py` feeds into the sim in place of the generated coach tendencies), and
`calibrate_players.py` replays every game 8 times and compares the sim's player lines
with the real ones. Per team-game, 333 games (bias is sim minus real; "corr" is whether
the sim knows which teams or players get more):

| Metric | Real | Sim | Corr | Metric | Real | Sim | Corr |
|---|---|---|---|---|---|---|---|
| Pass rate % | 45.8 | 44.2 | 0.63 | RB1 carries | 14.0 | 13.8 | 0.39 |
| Plays | 65.8 | 66.7 | 0.34 | RB1 share of RB carries % | 52.9 | 46.8 | 0.09 |
| Total yards | 373 | 374 | 0.43 | RB2 share % | 26.9 | 32.8 | 0.01 |
| QB1 attempts | 28.1 | 29.5 | 0.50 | Top receiver catches | 5.6 | 5.6 | 0.36 |
| QB1 pass yards | 208 | 224 | 0.41 | Top receiver share % | 30.5 | 29.8 | 0.10 |
| QB1 carries (incl. sacks) | 8.3 | 7.6 | 0.69 | Top 3 receivers share % | 65.8 | 63.6 | 0.18 |
| QB1 pass TD | 1.4 | 1.8 | 0.32 | FG attempts | 1.4 | 1.3 | 0.12 |

The sim's starting quarterback is the real one in 73% of team-games, its leading rusher
the real one in 45%, its leading receiver in 26% (the real leader changes week to week).
Still open: the lead back's carry share runs about six points low because the fatigue
rotation hands the backup more series than real coaches do, and the starting quarterback
throws for about 15 yards a game too many. Before this calibration the sim did not know
which teams throw more (correlation 0.09) and gave quarterbacks a fifth of their real carries.

Weekly refresh, in order: `python fetch_results.py`, `python fetch_boxscores.py`,
`python derive_tendencies.py`, `python build_teams.py`, then the three calibration scripts.
footballdb.com (season team stat tables, past seasons) is reachable from Python as well
and is a good cross-check for the team-level numbers; NCAA.com stays the primary source.

## Forward test: picks frozen before kickoff

Everything above is in-sample: the ratings and tendencies already reflect the games they
are checked against. `forward_test.py` is the out-of-sample check. Before the week's games:

```
python forward_test.py predict
```

runs `fetch_results.py`, takes every unplayed game in the lowest week that still has one,
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
python forward_test.py score 07
```

reruns `fetch_results.py` and `fetch_boxscores.py`, then scores the frozen file the way
`calibrate_season.py` does (straight-up accuracy, margin MAE and RMSE, slope of actual on
predicted, home bias, total-points bias, win-probability calibration by bucket) and, for
the player lines, the error and bias of the QB1, RB1 and top receiver yards against the
real box score, matching the sim's player to the real one by last name (a second column
compares the same role regardless of who filled it). The report is saved next to the
prediction file as `weekNN_score.json` and `weekNN_score.txt`, and the picks panel shows
the headline numbers. Games not yet final are listed as pending and can be scored again later.

`python forward_test.py dryrun 6` proves the whole path on a week already played: it
predicts that week into a temporary folder, scores it, prints the report and deletes the
folder. Being in-sample, its numbers are a check of the code, not of forward accuracy.
On week 6 (58 games, 50 sims each) the dry run scored 62.1% straight up, margin MAE 14.3,
slope 0.72, total points 49.4 predicted against 51.1 real, QB1 pass yards 36 high and RB1
rush yards 22 low for the real lead back (the sim spreads carries over more backs).

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

`smoke_test.py 400` runs 400 games and reports any game whose stats do not add up to its
score. It should report zero mismatches.
