# CFP Coach Simulator

![CFP Coach Simulator](web/icons/og-image.png)

**Play it now: <https://pattisonb.github.io/CFPCoachSimulator/>**

A college football coaching career built on the real 2026 season. Take one of 138 FBS
schools through the season to the playoff and the bowls, recruit your classes, and keep
going season after season. It is free and runs in any browser, phones included. There is
nothing to install and no account to make.

> The whole game runs in your browser. The first visit downloads it (about 20 MB, Python
> included) and takes a little while; after that your browser keeps it, so later visits start faster.

## Coach Career

Pick your team and start a season. **New season** starts a Coach Career: the whole 2026
schedule from week 1, with you as the head coach recruiting the class of 2027 as the season
goes. Then play a week at a time or jump ahead: each week is **Recruit → Your game → Advance**.

- **Your office.** A career opens on your office: this week's opponent and win chance, your
  week's steps, the play buttons and your recruiting at a glance.
- **Recruiting.** A fictional class of about 4,000 high school seniors, generated from how
  real classes look, and nobody committed at the start. Each week you have hours (more with a
  better recruiter as head coach) and a yearly budget of NIL points: message, call, send the
  head coach on an in-home visit, invite a prospect to an official visit at a home game, and
  offer, with a pitch and NIL. Every prospect wants something (his ask shows as a range until a
  call or visit tells you the number; a lowball cools him on you), a pitch counts by how strong
  your program really is on it (and backfires where you are weak), and what you do lands at the
  week step: his list shows where you stand and the Office's "What changed" tells you what moved.
  Commitments start soft and firm up only if you keep in touch; schools recruit to their roster
  needs by position, and so does your Auto-recruit. Every other FBS school recruits too,
  the way it really recruits: its states, its star level, its coach. This season's results
  count more every week. Commitments come over the fall, top prospects can flip, the early
  signing period is in December and the rest sign in January. Prospects without real FBS
  options lean FCS. The board is a five-column pipeline by stage, a card for each prospect with your chance to land him,
  a range that narrows as signing day nears, his list drawn as a race and a map of the US with
  your areas. Grades are words (All-American to Weak), not letters. A few prospects a class are
  generational; three looks by your staff reveal the tag, a gem or a bust risk.
  A call or an in-home visit is a short scene: he talks, you pitch, he answers (the CPU schools
  recruit as before). Turn on **Auto-recruit** to let your staff do it.
- **Prospects and Prospect Profiles.** The whole class with filters, and a profile for each
  prospect: his rankings, his list of schools, an evaluation for the top 300 and a comp to a
  real starter when one is close.
- **Staff.** Your coordinators and three recruiters each scout an area. Their grades
  narrow with every look, but a read can be wrong, and a weak evaluator more often.
- **The offseason and the next season.** After national signing day the career goes on.
  Seniors graduate, the NFL draft takes its 257 (juniors declare early when they project high),
  players enter the transfer portal (mostly backups) and a few quit. Then four portal weeks
  recruited like a class (no stars: his last season, a portal rank, the role he would have with
  you, a campus visit, your portal NIL pool) where entrants decide week by week, development (everyone grows toward his
  potential at his coachability's pace, faster under good developers), staff changes (a
  coordinator may be hired away after a big year; you hire from three candidates) and the
  coaching carousel around the league. Then the next season: same schedule template with home
  and away swapped, a new class of seniors to recruit, and your program's history kept. A
  career plays as many seasons as you like.
- **Saves.** Your careers are saved in your browser's storage after every week, so they are
  there when you come back on the same device. **Download career** saves one as a `.ccsave`
  file to keep or move to another device; **Load career** opens it again.

- **Game day.** Play your own game drive by drive, then advance the week to play
  everyone else's.
- **This week.** Your next opponent, your odds and the matchup. You see the result as
  soon as the game is played.
- **Polls and the playoff.** A weekly AP Top 25 that moves the way real voters move it,
  and the committee's rankings from November. The 12-team bracket is set on selection
  day, then come the playoff and every bowl game.
- **The committee's resume.** Each team's best wins, worst losses and strength of
  schedule, the way the committee looks at them.
- **Rivalry trophies.** Every trophy game, who holds it and the all-time series.
- **Awards.** A Heisman race all season, every national award, All-America teams and
  all-conference teams.
- **Stats, standings and box scores.** Every team and player, all season long.
- **Players and depth charts.** Each player's card shows the ratings that matter at that
  position, with a full list one tap away.
- **Momentum and morale.** Turn them on in Settings. Swings carry inside a game, hot and
  cold streaks carry from week to week, and player cards show the boost or slump with
  green or red arrows.
- **God mode.** Turn it on in Settings to edit any player and any depth chart in the
  country.

## Player ratings

Ratings start from EA College Football's ratings and run from 1 to 99 on our own scale:

| Rating | Meaning |
|---|---|
| 50 | An average starter in the Power 4 conferences |
| 65 / 80 / 95 | One, two and three steps above that |
| About 40 | A typical Power 4 backup or Group of 5 starter |
| 99 | The top of the scale |

Rosters follow how teams really play in 2026. Depth charts and who gets the ball are
updated from the real box scores, so the real starting quarterback and lead back usually
start in the sim too.

## How realistic is it?

The engine is tuned against FBS season averages, and most team stats land within about a
tenth of the real numbers. Upsets happen about as often as they do on real Saturdays.

The picks are tested honestly. Before each week's real games, the sim's picks are saved
and never changed, then scored once the games are final. With the current engine and the
2026 rosters, it picks about 6 in 10 winners on those weeks. The betting favorite wins
about 7 in 10.

## Add it to your phone

On iPhone, open the site in Safari, tap **Share**, then **Add to Home Screen**. On
Android, open it in Chrome and choose **Install app** or **Add to Home screen** from the
menu. It opens full screen with its own icon.

## Good to know

- **Saves stay on the device.** Clearing this site's data in your browser deletes its saved
  careers. Download a career you want to keep.
- **This is a fan project.** It is not affiliated with the College Football Playoff, the
  NCAA, any conference or any school. Schedules, results and stats come from public
  sources.

## Run it on your own computer

You need Python 3.12. The game needs nothing else installed.

```
python tools/dev_server.py
```

Then open <http://127.0.0.1:8000> (`--port N` picks another port; `--host 0.0.0.0` lets
phones on the same Wi-Fi open it at this computer's address).

`teamdata/build_teams.py` writes the game's team file (`data/engine_teams.json`). Run it once after
cloning (`python -m teamdata.build_teams`), and again after pulling new rosters or engine changes.
Saves made this way live on disk under `data/`.

The tests run on your computer too: `python tests/run_all.py`.

## Publishing

The site is static: every push to `main` runs `.github/workflows/pages.yml`, which builds the
team data and the site (`python tools/build_site.py` writes `dist/`) and publishes it to
GitHub Pages. One setting is needed once, in the repository's Settings → Pages: Source:
**GitHub Actions**. The data refresh tools (real results, rosters, polls) stay on the owner's
computer; their output is committed and goes out with the next push.

To learn how it works, including the engine, the data, hosting, calibration and the test
tools, read [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md).
