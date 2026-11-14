# Player Data: What Each Field Does

A guide for anyone (or any agent) changing player data, ratings or the UI that shows them. It answers one question per
field: **does it change what happens in the game, and where?** Traced from the code on 2026-11-14; line numbers drift,
so search for the function names.

Two loops read player data:

- **The game sim** (`engine/`): one game, play by play. Entry: `sim/season.py` builds the team (`team_data`,
  `apply_depth`, `_game_team`), then `engine/roster.py Player.__init__` reads the player dict.
- **The career loop** (`coach_career/`, `sim/season.py`): the season around the games and the offseason (development,
  departures, the portal, recruiting, promises). League rows use compact keys (`coach_career/league.py` top): `cls`,
  `c` coachability, `s` stars, `r` ratings, `g` room to potential, `o` overall, `ab` abilities, `yrs` seasons in the
  program, `home`, `j` jersey, `tm` target share, `a` archetype, `dev` dev trait.

House rules that apply to any change here (see `CLAUDE.md`): `python3 tests/test_sim_golden.py` must stay
byte-identical unless the change is to the season sim and the player agreed; new randomness gets its own seeded stream;
tunable constants are module-level and marked `*tune*`.

---

## 1. The three rating scales (read this first)

| Scale | Where | Center | Who reads it |
| --- | --- | --- | --- |
| **Skills / "ours"** (54 skills, 1-99) | `skills`, league `r`; `teamdata/game_scale.py` (`to_ours`, `to_base`) | 50 = the middle Power 4 starter | Career loop (development, draft, overall). **Not the engine.** |
| **Engine composites** (`speed`, `strength`, `passing`, `hands`, `route_running`, `run_blocking`, `pass_blocking`, `rushing`, `tackling`, `coverage`, `decision_making`, `intelligence`, `elusiveness`, `vision`, `endurance`, kicking/punting, …) | flat keys on the player dict | ~55 = an FBS starter (`build_teams.normalize`) | **The engine.** Built from base ratings (`build_teams.map_player`); careers convert skills back with `league.base_from_ours`. |
| **Card attributes** (`attributes`: `top_speed`, `burst`, `arm_strength`, `pocket_poise`, `contested_catch`, …) | `attributes` | 50 = a Power 4 starter (`build_teams.house_attributes_of`) | The engine, as small style terms relative to `ATTR_LEAGUE_AVG = 46` (`engine/game_config.py`); the player card. |

**`ovr` (the overall on every card) is display only.** `build_teams.py`: "The engine never reads it." Its one
indirect use: a player moved to a new position is placed in that role's order by his recomputed `ovr`
(`season.with_positions`). Team ratings (`team_ratings`, `position_groups`) are built from starters' `ovr` and feed
polls and morale's expected result, never the game.

---

## 2. Field by field

| Field | Game sim | Career loop | Notes |
| --- | --- | --- | --- |
| `name`, `slug` | Identity only | Identity; a recruit's id becomes his slug when he signs | Stats are keyed `name|position`, so names can't be edited |
| `position` | Yes: which slots he can fill | Draft groups, development pace, needs | Engine positions: QB RB WR TE OL DL MLB LOLB ROLB CB S K P |
| `role`, `depth`, `in_game` | **Yes: who plays** (section 3) | Usage for portal odds (starter / rotation / bench) | The depth chart |
| Engine composites | **Yes: every play outcome** (section 4) | Rebuilt from skills each season | |
| `attributes` (card) | Yes: small style terms (section 4) | Display | Many are never read (section 7) |
| `skills` / `r` / `g` | No | **Development, draft, overall** | Potential = `r + g` |
| `ovr` / `o` | No (one indirect use above) | Draft grade, team ratings, polls, playing-time pitch, market value | Display everywhere |
| `traits` / abilities (`ab`) | **Yes**, small per tier (section 5) | Natural Talent speeds growth; earned via ability goals | |
| `height_in` | Yes: contested catches, 2 points per inch | Position-change size penalty | The `height` string is display |
| `weight` | Yes: inside runs, 0.015 yd per pound of line-vs-front gap | Position-change size penalty | |
| `class` | No (`Player.cls` is stored, never read) | **Eligibility, departures, redshirts, portal base odds, development pace via `yrs`** | |
| `coachability` / `c` | No | **The main development multiplier** (section 6) | Hidden for other teams' players |
| `dev_trait` | No | Only when real 2026 players were first seeded | Effectively display after that |
| `stars` / `s` | No | Your word's cost when you break a star's promise; recruits' stars drive recruiting and Clear Mode abilities | Display on roster players |
| `archetype` | No | No | Display only |
| `jersey` | No | No | Display only |
| `hometown` / `home` | No | Portal destination pull (+0.4 home state) | Not sent by the player API |
| `form` / morale | **Yes**: composites ×(1 + 0.06·form + 0.03·team), clamped 0.9-1.1 | No: season only | Off in preview sims |
| `injury` | Yes: he's skipped | Promise weeks exempted | Heals one week at a time |
| `redshirt` | Yes: skipped like an injury | Eligibility (section 6) | Your roster, ≤4 games |
| `promise` | No | **Portal, retention, your word** (section 6) | |
| `target_mult` / `tm` | Yes: pass target share | No | |
| `ratings_at` | No | Position options list | Display |

---

## 3. Who plays (game sim)

- `Team._take` (`engine/roster.py`) fills each personnel grouping with **healthy** players: `in_game` first, then by
  `order`. `order` is `depth`, except linebackers, which share one usage order across SAM/MIKE/WILL.
- Offense `set_grouping` counts come from `personnel.GROUPINGS` (11, 12, 10 personnel…); defense `set_front` splits
  the line by `role` (LEDG/REDG are edges, the rest tackles), then fills LB/CB/S.
- `apply_depth` (`sim/season.py`) applies the season's depth-chart overrides: renumbers depth in each role, keeps
  that role's base starter count, moves the player's position with his role (`ROLE_POSITION`), and sets the KR/PR
  returners.
- Injured and redshirting players: `_injured` / `_with_injuries` set `injured=True, in_game=False`; `_take` never
  picks them, so the next man plays.
- Fatigue rotation: WR/TE/backup RB sub out at fatigue 62; DL 30, LB 50, DB 58 (`game_config.py`). The lead RB's
  share comes from his rating gap over the next back, or the team's real `rb1_share`. Blowouts (lead ≥ 42) rest
  starters.
- `role == "FB"` carries 0.10 weight (Flexbone 1.5) against 0.80 for the lead back.
- Specialists: the `in_game` K and P; returners are the designated KR/PR, else the best `return_rating` among
  non-K/P/OL/DL/QB.

---

## 4. Ratings → play outcomes (game sim, mostly `engine/play_functions.py`)

Neutral starter 55; a missing attribute reads 50. All terms below are additive unless marked ×.

**Passing (`get_pass_yards`)**
- QB accuracy = 0.6·passing + 0.25·decision_making + 0.15·intelligence → +0.0013 completion per point.
- Receiver = (route_running + hands)/2 for WR/TE, (hands + elusiveness)/2 for RBs → +0.0015 per point.
- Coverage = mean `coverage` of CB/S (+LBs when the target isn't a WR) → −0.0032 per point.
- Card style terms: QB accuracy at the throw's depth ±0.0025; `arm_strength` on deep throws 0.0012; route skill at
  the depth 0.002; man vs zone lean 0.0025; contested catch (`contested_catch` − `ball_skills`, `leaping`, 2 points
  per inch) ×0.0035; `release` vs `press` 0.00125; `play_action` vs `diagnosis` 0.0015; pressure −0.08, eased 0.0015
  per point of `pocket_poise`.
- Completion clamped 0.25-0.86. Targets: weight ∝ (((route_running + hands)/2 + speed/2)/100)^3.5 × `target_mult`.
- Yards after catch: ×(1 + (target speed − DB speed)·0.007 − (DB tackling − 55)·0.006); breakaway 0.05·speed/55.

**Sacks:** 0.05 + (rush − protection)·0.0015. Rush = DL (+LBs by `rushing`, up to 4) (strength + rushing)/2;
protection = **OL only** (strength + pass_blocking)/2. −0.0004 per QB decision_making point; power/speed rush vs
anchor/footwork lean 0.0012; ×(1 − (sack_escape − 46)·0.0024). Clamped 0.01-0.25.

**Interceptions:** 0.045 + (coverage − 55)·0.0004 − (decision_making − 55)·0.0004, × depth, × pressure,
×(1 + (ball_skills − 46)·0.004).

**Scrambles:** 0.13 × QB speed/55 on throws that are neither complete nor picked.

**Rushing (`get_run_yards`):** gauss(3.75, 2.7) + (blockers − front)·0.04 + (carrier − pursuit)·0.035.
Blockers = OL+TE (strength + run_blocking)/2; front = DL+LB (strength + tackling)/2; carrier = mean of speed, strength,
elusiveness, vision (WRs: speed, strength). Inside/outside tilt from burst/agility/elusiveness vs
power_running/tackle_breaking/strength; inside runs +0.015 yd per pound of weight gap; `run_vision` 0.015; big plays
0.045·speed/55; short yardage 0.62 + (power_running − 46 + leans)·0.0024.

**Fumbles:** runs 0.017 × strength and intelligence terms × `ball_security` (−0.0072/pt) and tacklers' `hit_power`
(+0.0048/pt); strip-sacks 0.13 × QB strength term; after a catch 0.010 × the same multiplier. Recovery is 50/50.

**Penalties (`drive_functions.py`):** offense 0.05, defense 0.035 per snap ×(1 − (unit `football_iq` − 46)·0.006)
× the head coach's `discipline`.

**Kicking:** FG make + (kick_accuracy − 55)·0.004; range 52 + (kick_power − 50)/8; PAT 0.975 + (accuracy − 50)·0.003;
kickoffs + (kick_power − 55)·0.25 yd; punts + (punt_power − 50)/5 yd, pin chance 0.75 + (punt_accuracy − 55)/100.

**Returns:** `return_skill` = return_rating/100; kickoffs + (skill − 0.5)·12 yd, TD odds ×(0.5 + skill); punts
×(1 + (skill − 0.53)·1.5).

**Stat credit only** (no score effect): who makes the tackle, forces or recovers a fumble, gets the sack, blocks.

---

## 5. Traits and abilities

`Player.traits` maps key → tier (1 Bronze … 4 Platinum); effects per tier in `TRAIT_FX` (`engine/game_config.py`).
They're real but small, roughly +0.3 to +1.2 completion points per tier. Examples: `steps_up` / `escape_artist`
sack rate ×(1 − 0.009·tier); `ball_handler` +0.004·tier on play-action; `pinpoint` +0.003; `breakaway_speed` big plays
×(1 + 0.036·tier); `iron_horse` +0.9 endurance; `cannon_leg` +1.5 yd of FG range; `ice_water` +0.015 in the clutch;
`crowd_favorite` +0.15·tier points at home. `natural_talent` only affects offseason growth (+6% per tier).

In Clear Mode (on by default) players earn abilities through ability goals (`coach_career/ability_goals.py`); an
earned ability joins the engine team from the next game and is written to `ab` at the offseason. Recruits can arrive
with abilities (5★ 75% … 2★ 10%).

---

## 6. The career loop

**Development (`offseason.develop`, after the portal closes).** Each skill closes part of its room `g`:
`rate = RATE[coachability] × factor × 0.75 × year_pace`, slowed above overall 55, × position pace (RB 0.5 … OT 1.32),
capped at 0.5 a year. Coachability's share per offseason: Coach's Dream 0.55, Film Junkie 0.45, Quick Study 0.35,
Steady Grinder 0.27, Slow to Click 0.18, Set in His Ways 0.10. `factor` multiplies staff development (head coach 60%,
coordinator 40%), production (`1 + 0.25·z`), random team and player years, and the program. Breakouts and honors
raise the ceiling (skill and IQ only, cap 10). Clear Mode: physical ratings grow at 0.5×, the rest 1.08×. This
year's high school class skips its first offseason. Coachability can move one level a year (honors, breakouts, strong
staff, redshirt years).

**Departures (`offseason._departures`).** Seniors graduate (a benched SR with an unused redshirt returns as SRRS 60%
of the time). The draft grades `ovr` within position groups; juniors and redshirt sophomores declare by projected
pick (top 16 → 0.99, top 64 → 0.88); rated ≥95 with ≥6 games always declares. Portal odds stack class base × usage
(starter 0.12, rotation 0.65, bench 1.3) × losing year, NIL shortfall, a slipping program and broken or bent promises.
**Morale/form is never read here.**

**Keep Them Home (retention).** The ask scales with `ovr`, playing-time wants and draft status; stay chance comes from
your NIL share, plus an honored start promise.

**Redshirts.** In season: FR/SO/JR with ≤4 games, kept out of games. At Departures your picks move `cls` to the RS
class (an extra year of eligibility); AI teams roll it. Development continues (`yrs` still counts).

**Promises.** Weekly snapshots of starts (later weeks ×3, big games ×2) grade On Track / Slipping / Broken by
personality band. Broken: he likely leaves, his ask at retention ×2.5. Your **word** (starts 70) moves +3 kept,
−2 bent, −8 broken (more for stars); recruits scale your promises by it and ignore them below 35.

**Position changes (`coach_career/position_fit.py`).** Ratings transfer by group (whole within a technique group,
0.85 of the excess within a unit, 0.6 across units), minus a size penalty up to 30; floor overall 20.

**Recruits → players (`offseason._compact_prospect`).** slug = prospect id; ratings and potential from
`recruiting.attributes`; class FR, dev trait Normal; coachability, stars and hometown carry over; random jersey.
Walk-ons fill rosters to 80; rosters over 85 cut.

**Team level.** Team ratings come from starters' `ovr` and feed the preseason poll and morale's expectations. The AD
judges record and goal only. The playing-time recruiting pitch counts returning players at or above the prospect's
`ovr` (not the depth chart).

**God mode (`season.edit_player`).** Edits ratings, attributes, jersey, class, height, weight and dev trait into
`state["player_edits"]`, merged into every game from the next sim. **They never reach the league rows:**
development, departures and the draft ignore them, and they vanish at the next season.

---

## 7. Display-only and dead data

- **Never affects anything:** `archetype`, `jersey`, `dev_trait` (after seeding), the `height` string, `ratings_at`
  (except listing position options), `hist`.
- **Card attributes the engine never reads:** `top_speed`, `stamina`, `hands`, `tackling`, `lead_block`,
  `finish_block`, `highlight_catch`, `stiff_arm`, `throw_on_move`, `return_skill`, `decision_making`. (`strength`,
  `burst`, `agility`, `elusiveness` are read only for ball carriers.)
- **Composites that exist but are unused:** RB/WR run and pass blocking (blocking counts OL+TE only), TE
  pass_blocking, RB route_running, WR/TE elusiveness and vision, QB hands, CB/S hands, DL coverage, CB/S rushing.
- **Coach ratings not used in games:** motivation, game_management, the offense/defense ratings, clock_management,
  aggressiveness. Used: schemes, play calling, discipline, tendencies.

---

## 8. Known quirks worth checking

These were found by reading code, not by running it.

- A backup who fills an injured starter's slot stays `in_game=False`, so bench recovery keeps resetting his fatigue
  and fatigue subs never rotate him out (`roster.recover_bench_players`).
- LOLB is missing from the skill set in `game_functions.apply_general_fatigue`, so LOLBs tire at the lineman rate.
- Two-point runs leave LOLB out of the defenders list; two-point passes hit the 0.75 cap almost always.
- `position_fit` moves change `r` but leave `g`, so potential at the new spot = transferred ratings + the old room.
- The `injury_frequency` slider isn't implemented; injury length never depends on the player.
- God-mode edits don't carry into the career loop (section 6).
