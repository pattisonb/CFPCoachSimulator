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
| `fetch_results.py` | Downloads the 2026 FBS results played so far from NCAA.com into `data/season_games.json` |
| `fetch_schedules.py` | Downloads every FBS team's 2026 schedule from ESPN into `data/schedules.json` |
| `season.py` | Week-by-week season engine: polls, title games, bracket, playoff (`python season.py ohio-state full`) |
| `polls.py` | AP poll model, committee model and the 2026 bracket rules |
| `bowls.py` | The 2026-27 bowl lineup, selection by conference tie-ins, and which bowls host the playoff rounds |
| `fetch_bowls.py` | Downloads the bowl schedule and every bowl's tie-ins and history from Wikipedia into `data/bowls.json` |
| `fetch_polls.py`, `analyze_polls.py`, `calibrate_polls.py` | 2014-2025 poll archive, the behaviour study, and the model fit |
| `calibrate_season.py` | Replays every real 2026 game N times and compares predicted and actual margins |
| `calibrate.py` | Per-team stat benchmarks against FBS 2025 averages (`league` mode uses the real rosters) |
| `fetch_linescores.py`, `calibrate_late.py` | Quarter scores 2014-2025 and the late-game comparison (close games, comebacks, overtime) |
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
simulates everything; **Rest of season** keeps the real results and real polls through
the last completed week. FCS opponents play as the fictional school from the same region
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

### Speed

A game takes about 70 ms of pure Python on a desktop core (it was 200 ms: the per-play
fatigue penalty recomputed every rating of every player on both rosters on every snap,
and each game deep-copied both rosters; now only players whose fatigue changed are
touched, and the copy is shallow, with identical results for the same seed). A week of
about 90 games runs in 2 seconds with the worker pool and 7 seconds in one process.

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
(`fetch_polls.py` now pulls it too) the two polls agree on No.1 in 95% of weeks, share 24.1
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
page (`fetch_bowls.py` writes `data/bowls.json`): 35 non-playoff bowls plus the seven
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
which is also what shows before the first game is played. Stats cover simulated games only, so in **Rest of season** mode the real
games already played are not in them; a season saved before this existed shows only your
own games.

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

`calibrate_awards.py N` runs N seasons and reports the Heisman position mix, winner team
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
every team carries a mood from its results (wins and losses, upsets, blowouts) and every
player a form from how each game compared with his season so far; both fade 15% a week.
Entering a game, a player's ratings scale by up to 4% for his form and 3% for the team's
mood. The player card shows the boosts as green ▲ and red ▼ arrows next to each rating,
with a 🔥 Hot streak or ❄ Cold streak tag and the team's mood; the depth chart marks hot
and cold players. `python test_morale.py` checks that the engine is unchanged with the
setting off and that moods, form and the boosts move with results when it is on.

### Settings and god mode

The ⚙ Settings button next to the sim buttons opens the season's settings. God mode
lets you edit every player and every depth chart: any player card gets an Edit button
(ratings 0-99, jersey, class, height, weight and development trait; names and positions
stay, since the season's stats are keyed on them) and every team's depth chart becomes
editable, not just yours. Edits are saved with the season (`player_edits` in the state)
and used by every game from the next sim on; an edited rating is marked on the card.
`GET/POST /api/season/{id}/settings`, `POST /api/season/{id}/player/edit`;
`python test_godmode.py` checks validation, the views and the sim's team data.

### This week

Your Team Schedule opens with a "This week" card: the next game with both teams' rank
and record, the venue, the date and the trophy on the line, then a prediction from 20
simulations of the matchup with the current depth charts, injuries and edits (the likely
score, your win odds, the line and the total, the passer, rusher and receiver to watch),
and your injury report. The week's row in the schedule below is highlighted with a
"this week" tag. On a bye the card just says so. Once game day has played your game
the card shows the result instead of a prediction, with the box score a click away, and
the schedule rows update as soon as a game of yours is in.
`GET /api/season/{id}/preview?team=`.

### Rivalry trophies and the all-time series

`data/rivalries.json` lists 90 FBS rivalries: the game's name, its trophy (Paul Bunyan's
Axe, Floyd of Rosedale, the Old Oaken Bucket, the Commander-in-Chief's Trophy, the Iron
Skillet, the Jeweled Shillelagh and the rest; blank where the game has none) and the
all-time series entering 2025, leader first. The simulator adds its own games on top:
the Team Schedule marks a rivalry game with the trophy and the series entering it, the
box score says who takes or keeps the trophy and the series after it, and the Summary
tab's Rivalries card lists each rival, this season's meeting and the series today, with
who holds the trophy. Army-Navy in selection week counts like any other game.
`GET /api/season/{id}/rivalries?team=` serves a team's list; `python test_rivalries.py`
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
`python test_resume.py` checks the numbers against the standings and a hand count.

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
(`python test_play_log.py --check` prints a fingerprint of five seeded games that must not
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

`fetch_boxscores.py` pulls the full player box score for every final game from NCAA.com
(the same feed its game pages use), `derive_tendencies.py` turns them into each team's
observed 2026 pass rate, pace, quarterback run share and fourth-down rate (which
`build_teams.py` feeds into the sim in place of the generated coach tendencies), and
`calibrate_players.py` replays every game 8 times and compares the sim's player lines
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
`derive_tendencies.py` already computes per team.

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
- **Garbage time.** Up 28 in the second half (38 any time): conservative play, slow pace,
  starters sit at 35.

`fetch_linescores.py` pulls quarter scores for every FBS game 2014-2025 and
`calibrate_late.py` compares how games end. Against 8,603 real regular-season games:

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

`smoke_test.py 400` runs 400 games and reports any game whose stats do not add up to its
score. It should report zero mismatches.
