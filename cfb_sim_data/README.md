# College Football Sim Data — 2026 Season

146 teams: 138 FBS teams with real 2026 details, and 8 fictional FCS schools. Total roster count is 12,410 players.

## Files

| File | What it holds |
|---|---|
| `league.json` | Season, rating scale and conversion curve, conferences with member team slugs, team and player counts |
| `teams_index.json` | Every team's details without rosters. Use it for menus, standings and schedule building |
| `coaches.json` | All 438 coaches (head coach, offensive coordinator, defensive coordinator for each team) in one list |
| `teams/<slug>.json` | One team, complete: details, colors, stadium, coaches, team ratings, starters, depth chart and full 85-man roster |

The team slug (`ohio-state`, `smu`, `talus-peak`) is the ID used everywhere. A player's ID is their `slug`. Player IDs are unique across the whole league.

## Rating scale

- **Player ratings run 0–99, and 50 is an average FBS player.** They were converted from EA College Football 27 ratings using one curve for overall and every skill. 99 stays 99, an EA 90 becomes 82, an EA 80 becomes 63, and an EA 72 becomes 49. The exact curve points are in `league.json`.
- **The original EA numbers are kept** in each player's `overall_ea` and `ratings_ea`.
- **Skills that don't fit a position sit near 0.** For example, a quarterback's tackling or a lineman's catching.

## Team file layout

- **Identity:**
  - `school_name`, `short_name`, `abbreviation`, `mascot`
  - `city`, `state`, `conference`, `subdivision`
  - `fictional`, which is true for the 8 FCS schools
- **`stadium`:** `name`, `capacity`, `surface`, which is grass or turf.
- **`colors`:** `primary`, `secondary` and `accent`. Each has a `name` and a `hex` value, and `accent` can be null.
- **`rivals`:** team slugs.
- **`program`:**
  - `prestige` runs 1–6. It is set from how the current roster ranks, not from program history.
  - `home_field_advantage` runs 0–99 and is based on stadium size.
  - Both values are generated, and you can replace them with your own.
- **`team_ratings`:**
  - `offense`, `defense` and `special_teams` are averages of the starters. The quarterback counts three times in `offense`.
  - `overall` combines them: 45% offense, 45% defense, 10% special teams.
  - `roster_avg` is the average of all 85 players.
  - `position_groups` gives starter averages for QB, RB, WR, TE, OL, DL, LB, DB, K and P.
- **`starters`:**
  - The offense is 11 personnel: 1 quarterback, 1 running back, 3 receivers, 1 tight end and 5 linemen.
  - The defense is a nickel look: 2 edge rushers, 2 tackles, 2 linebackers, 3 cornerbacks and 2 safeties.
  - Special teams lists the kicker, punter, kick returner and punt returner.
  - All entries are player slugs, picked by highest overall rating.
- **`depth_chart`:** every position with player slugs from best to worst.
- **`coaches`:** `head_coach`, `offensive_coordinator` and `defensive_coordinator`. Each coach block is described in the next section.
- **`verification`:** applies to real teams only. It shows how well the coaching staff was confirmed (`verified` or `partially_verified`), with notes and sources.
- **`roster`:** all 85 players, sorted by position and then by rating.

## Coaches

The real-world fields (`name`, `since`, `previous_job`, `is_interim`, `alma_mater`, `co_coordinator`, `plays_called_by_hc`) come from research current to October 15, 2026.

The fields below are generated. They are not real-world or EA data, and each block has `ratings_generated: true`.

- **`ratings`:** 0–99, where 50 is average. They loosely follow roster strength, with random variation, and interim coaches get a small penalty. Each role has its own ratings:
  - **Head coach:** offense, defense, recruiting, player_development, game_management, motivation, discipline.
  - **Offensive coordinator:** play_calling, player_development, recruiting, qb_development, ol_development.
  - **Defensive coordinator:** play_calling, player_development, recruiting, pass_rush_development, secondary_development.
- **`tendencies`:** 0–100 sliders that describe style, not quality. They include pass_rate, tempo, blitz_rate, man_coverage_rate, fourth_down_go_rate and others.
- **`scheme`:**
  - The offensive scheme is based on the starting quarterback's archetype and the roster's tight ends and fullbacks.
  - Army, Navy and Air Force run the flexbone triple option.
  - Defensive schemes are assigned at random, weighted toward 4-2-5.

When a school has no one in a coordinator title (Washington's OC, for example), the block has `name: null` and `vacant: true`. Its ratings describe the unit the head coach runs.

## The 8 FCS schools (Eight Rivers Football Conference)

These schools are fictional, and so are their players and coaches. Each roster was built from the makeup of a real low-tier FBS roster, using different player templates, with ratings lowered to FCS level. Team averages are 34–40, compared with 43–61 for FBS teams, and each school has a few standout players.

| School | Mascot | Location | Region |
|---|---|---|---|
| Kestrel Bay University | Sea Wolves | Kestrel Bay, ME | New England |
| Alder Ridge State University | Forgers | Alder Ridge, PA | Mid-Atlantic |
| Calder Springs University | Cottonmouths | Calder Springs, SC | Southeast |
| Port Rennick State University | Mariners | Port Rennick, TX | Gulf Coast |
| Wendt Lake Polytechnic Institute | Freighters | Wendt Lake, MI | Great Lakes |
| Red Prairie State University | Plainsmen | Red Prairie, NE | Plains |
| Talus Peak University | Miners | Talus Peak, CO | Mountain West |
| Cedar Sound University | Orcas | Cedar Sound, WA | Pacific Northwest |

## What is not included yet

- A 2026 schedule
- Recruiting classes
- Player hometowns
- Real coach career records
- Uniform and logo artwork

Stadium capacities and color hex values come mostly from general knowledge and were spot-checked, not pulled from each school's brand guide.
