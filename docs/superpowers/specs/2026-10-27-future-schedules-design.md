# Future schedules: every season after 2026 gets its own slate

Approved 2026-10-27. Research: `docs/schedules_research.md`.

## Problem

A career's later seasons replay the 2026 schedule with home and away swapped every other
year. Real conferences rotate opponents on fixed cycles, protect rivalries, split home games
evenly over years, and schools book non-conference series years ahead. The game should do the
same so a 2029 schedule looks like a 2029 schedule.

## Data

- `data/schedule_rules.json`: per conference, the number of league games by year (the ACC's
  rotating eight-game team, the MAC's ninth game from 2028), protected pairs (the SEC's trios,
  the Big Ten's twelve pairs, the Big 12's four, the ACC's pods, Sun Belt divisions with two
  cross-division games), the rotation cycle in years, and non-conference rules: how many Power
  opponents a Power team must play (the ACC's eight-game team two), how many FCS games are
  allowed (Big Ten none), and for Group of Five teams how many Power pay games and FCS games.
  Notre Dame plays five ACC teams a year and Navy every year; those count as Power games for
  the ACC side.
- `data/series.json`: annual non-conference series (home alternates, or a neutral site), with
  the years they run where known, and the announced 2027–2032 home-and-homes and neutral
  kickoffs from the research, each with its year and site.
- Conference membership comes from the league's teams file as of 2026; realignment is out of
  scope.

## Generator (`sim/schedule_gen.py`)

`generate(year, teams, history, rng)` returns the season's games (the record `new_season`
builds) and the updated history. The history lives in the career's league (`schedule_history`):
for every pair, the years they met and who hosted; it is seeded from the 2026 schedule so 2027
returns the 2026 games' sites.

1. Fixed games: the annual series active in `year` and the announced series for `year`. A
   rivalry finale (the series file marks them) lands in week 14; Army–Navy in selection week.
2. Conference slates: protected pairs every year; the rest of each team's league games chosen
   so every pair meets within its cycle and home and away alternate; a pair never plays at the
   same site two years running; home league games alternate 5/4 by year (4/4 in eight-game
   leagues). Sun Belt: six division games and two across. Pac-12: a round robin.
3. Non-conference fill: a Power team gets its required Power opponent (a home-and-home against
   another Power team needing one, the site from history), at most its FCS allowance, and Group
   of Five home games for the rest. A Group of Five team gets one or two Power road games, one
   FCS home game and Group of Five home-and-homes. FCS games use the eight fictional stand-ins,
   picked by region. Buy games are home for the Power team and not returned.
4. Weeks: fourteen regular-season Saturdays (the 2026 calendar, which the UI shifts by year),
   non-conference games early, conference games from week 3, finales in week 14, no team twice
   in a week, two open dates each, never consecutive when it can be helped, the championship
   game week and the playoff untouched.
5. Every game record carries `title` for a named rivalry and a `fcs_shift` drawn from the FCS
   tiers for a stand-in opponent.

## Wiring

`offseason.next_season` generates the coming year's games and stores the history on the
league; `season.new_season` takes a `schedule` argument and uses it instead of the 2026 file.
The schedule trade window and every view keep working on the generated games.

## Tests (`tests/test_schedule_gen.py`)

Generate 2027 through 2032 from the 2026 history: every FBS team has 12 games (one a week,
none twice), each conference's league-game count and protected pairs hold every year, no
conference pair plays at the same site in consecutive years and every pair meets within its
cycle, Big Ten teams play no FCS game and nobody plays more than one, Power teams have a Power
opponent, Group of Five teams a Power road game, announced series appear in their year at their
site, annual series every year, home games over any two years differ by at most one, finales
sit in week 14 and Army–Navy in selection week, and a career can roll from 2026 into a generated
2027 and play it.
