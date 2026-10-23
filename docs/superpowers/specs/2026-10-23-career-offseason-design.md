# Coach Career: the offseason and many seasons (design)

Status: written overnight October 23, 2026 from the user's request ("departures, transfer portal,
progression, staff hiring: anything we need to wrap around to the next season and repeat, tested
over hundreds of seasons"). Decisions below were made without a review round; each names what it
costs if wrong. Values marked *tune* are set by the long-run check (section 8).

## 1. What and why

After national signing day a career now goes on: players leave (graduation, the NFL draft, the
transfer portal, quitting), a two-round transfer portal fills holes, everyone develops, staff
change, the signed class arrives, and the next season starts. Repeat forever. Success: a career
plays through many seasons with rosters, ratings, stats and the balance of power staying
realistic, and every offseason step is something you can see and act on.

## 2. One league per career

Until now every season read the real 2026 rosters (`data/engine_teams.json`). A career now owns
its league from its second season: `state["league"]`, compact source-format rosters of every
team (EA ratings and potential as lists in one key order, coachability, class, redshirt, size,
archetype, stars, hometown) plus each team's coaches and formation. Each season the league is
built into engine teams by the same pipeline as the real data (`build_teams.build`), cached on
disk per career and year (`data/leagues/`), and rebuilt from the state when missing. The 2026
season of a career still reads the shared file. Cost if wrong: saves grow by about 2 MB
compressed; the build takes about 5 s per offseason.

Year-2026-only data stays with 2026: real polls, real depth-chart and stat nudges. Later seasons
use the same schedule template (home and away swapped every other year, dates moved a year on),
a preseason poll from team ratings, and team ratings computed from the rosters (fit to EA's 2026
team ratings).

## 3. Calendar

| Step | What happens | You |
|---|---|---|
| National signing day (week 20) | The class signs (as now) | |
| Departures | Seniors graduate; the NFL draft (seven rounds, early entrants); portal entries; a few quit | See who leaves and why |
| Portal, round 1 and 2 | Entrants pick among offers, AI schools fill needs | Offer portal players |
| Development | Signees and transfers join, everyone develops, redshirts, class years advance | See who improved |
| Staff | Coordinators and recruiters may leave; candidates to hire | Hire replacements |
| Next season | Depth charts, the new class of high school seniors, week 0 | |

Auto-recruit covers the portal too. "Sim to the end" in the offseason runs every step on Auto.

## 4. Departures *tune*

- **Eligibility:** class years FR, SO, JR, SR, each with a redshirt (FRRS ... SRRS). A player who
  started or played much does not redshirt; freshmen who barely played usually do (once). A
  senior leaves; a senior with his redshirt unused and little playing time can stay a fifth year.
- **NFL draft:** 257 picks from the players three or more years out of high school, ranked by a
  draft score (overall on the game's scale, position value, athleticism). Seniors in range are
  drafted; juniors and redshirt sophomores declare when projected in the first three rounds
  (likelier the higher). Real targets: about 85-100 underclassmen declare a year; about 90% of
  picks come from Power 4 schools.
- **Transfer portal:** about 15% of FBS scholarship players enter a year (real 2023-25: about
  20-25% including walk-ons), most of them backups buried on the depth chart, sophomores and
  juniors; starters rarely, more at a school that lost. Graduate transfers (redshirt seniors
  with a year left) too.
- **Quit / medical:** about 2% a year, more for low-rated players.

## 5. Transfer portal

Entrants keep their ratings, potential and class. Two rounds: each round you may offer up to
your open spots (85 minus your roster after departures and signees); every AI school offers by
need (positions short of a healthy depth) and fit (better than its own depth there). At the end
of a round each entrant with offers picks by interest: playing time (where he would sit on the
depth chart) first, then prestige, winning, proximity, a little noise. Round 2 offers go to whoever
is left; entrants unsigned after round 2 leave FBS. Your staff's reads apply: a portal player's
grades are his real ones as public as his film (narrow ranges).

## 6. Development

Every returning player develops once a year (`recruits.develop`: each attribute closes part of
its gap to potential at his coachability rate times a coach factor from his head coach's player
development and the coordinator on his side of the ball). Redshirts and class years advance.
Rosters below a healthy depth at a position are topped up with walk-ons (generated two-stars).
Rosters above 85 release their lowest-rated non-seniors (counted as quitting).

## 7. Staff and coaches

- **Your staff:** after a winning season a coordinator may be hired away (likelier the better he
  is and the better you did); a recruiter leaves about one year in eight. You pick replacements
  from three generated candidates each, or Auto picks the best. Staff improve a point or two a
  year until about 60 years of service... simply, small random drift.
- **AI head coaches:** retire (about 4% a year, more after a long tenure) or are fired after a
  bad three-year run (P4 under .400); replaced by a generated coach (ratings drawn like the
  league's, a scheme copied from a similar program). Coordinators turn over about 15% a year.
- **You:** you stay at your school (as before); your ratings drift up slowly with success.

## 8. Testing: many seasons

`tools/long_run.py` plays careers headlessly (every step on Auto) for N seasons and records each
season: roster sizes and position depth, the EA overall of starters by position against 2026,
the league's team-rating spread and how often the top ten turns over, departures by kind, portal
volume, draft picks by conference, and the season's stats against real (tools/realism.py's
scores). Pass marks: rosters 80-90 with every position at healthy depth, starters' EA overall per
position within 2 points of 2026, team-rating spread within 15% of 2026, at least 3 new teams in
the final top ten each year on average, and stats scores no worse than the 2026 season's plus a
couple of points. Unit tests cover each step; an end-to-end browser test plays a career into its
second season.
