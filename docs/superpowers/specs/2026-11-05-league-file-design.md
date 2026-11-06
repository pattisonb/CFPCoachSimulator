# League File: Teams and Rosters From One JSON

Status: approved in conversation, 2026-11-05. One pull request, which merges when its tests pass.

## Why

Every team, roster, coach and color comes from data that is built into the game at deploy time
(`cfb_sim_data/teams/*.json` → `teamdata.build_teams` → `data/engine_teams.json`, plus
`data/base_league.json`). The player wants anyone to be able to:
- update teams and rosters;
- add new teams;
- share a league as one JSON file.

## Decisions (the player's)

- **New careers only.** An imported league applies to careers started from it. Careers already in progress are never touched.
- **The file sets new teams' conferences.** A new team's conference can be existing or new. Schedules come from the existing generator.
- **Players can be simple.** A player needs only a name, position and class. Overall and skill ratings are optional overrides. Anything missing is generated.
- **Strength comes from an optional team grade.** Without one, a team matches its conference's average strength.
- **JSON only for now.** There is no in-game editor yet.

## Approach

One code path. The built-in league becomes a real file, `league.json`, written at build time from today's data. Every career starts from a league document: the built-in one, or the built-in one with an import merged in.

**Merging is by team id (slug):**
- a team in the import replaces the built-in team;
- a new slug adds a team;
- teams left out are unchanged;
- `"remove": [slugs]` drops teams.

So a one-team file is a valid import.

The merged league is checked, filled in (generated players, depth charts, ratings) and stored in the career's save. From then on the career reads only its own copy.

Rejected:
- **Full-file replace only.** Too much to write to fix one roster.
- **A separate patch format.** It would add a second code path.

## The File Format (`format: "cfp-league/1"`)

```json
{
  "format": "cfp-league/1",
  "name": "My League",
  "year": 2026,
  "remove": ["kent-state"],
  "conferences": [{"id": "big-sky-east", "name": "Big Sky East", "level": "FBS", "games": 8}],
  "teams": [{
    "slug": "alder-tech", "name": "Alder Tech", "short_name": "Alder Tech", "abbreviation": "ATU",
    "mascot": "Owls", "city": "Bend", "state": "OR", "lat": 44.05, "lon": -121.31,
    "conference": "big-sky-east", "level": "FBS",
    "colors": {"primary": {"name": "Green", "hex": "#0B6E4F"}, "secondary": {"name": "White", "hex": "#FFFFFF"}, "accent": {"name": "Black", "hex": "#000000"}},
    "strength": "Average",
    "prestige": 40,
    "rivals": ["oregon-state"],
    "coaches": {"head": {"name": "Pat Doe", "rating": 60}, "oc": {"name": "Sam Roe"}, "dc": {"name": "Lee Poe"}, "offense": "Spread", "defense": "4-3"},
    "roster": [
      {"name": "Jay Smith", "pos": "QB", "class": "JR"},
      {"name": "Max Lee", "pos": "WR", "class": "SO", "overall": 74, "stars": 4, "height": 73, "weight": 190, "hometown": "Portland, OR", "jersey": "1"},
      {"name": "Al Cruz", "pos": "LT", "class": "SR", "ratings": {"pass_block": 82, "run_block": 78}}
    ],
    "depth_chart": {"QB": ["Jay Smith"]}
  }]
}
```

**Required fields:**
- For a new team: `slug`, `name`, `conference`.
- For a team replacing a built-in one: `slug` alone. Every field it leaves out keeps the built-in value. This applies to `roster` too: give one to replace the whole roster, or leave it out to keep it.
- For a player: `name`, `pos`, `class`.

**Optional fields and their defaults:**
- `short_name`, `abbreviation` and `mascot` are derived from `name`.
- `colors` default to a neutral pair. A missing accent gives a neutral pill border.
- `lat`/`lon` default to the state's center.
- `prestige` defaults to the conference average.
- `rivals` default to none.
- Coaches are generated (names and ratings) like the coach market's hires. Playbook defaults come from the conference's most common style.
- `depth_chart` is built by overall, as today.

**Values:**
- Positions and classes are the game's existing ones: `QB RB WR TE LT LG C RG RT LEDG DT REDG SAM MIKE WILL CB FS SS K P`, and `FR SO JR SR` plus `RS` variants.
- Strength is a word (`Elite`, `Strong`, `Average`, `Weak`) or a number from 1 to 100.

## Filling a Roster

1. **Strength.** A team's target strength is its `strength` grade if given, otherwise the mean strength (team ratings) of its conference's built-in teams. A new conference uses the FBS median.
2. **Given ratings win.**
   - Any `overall` or `ratings` given are kept exactly.
   - Missing skills of a player who gave some are filled from the position templates (`recruits._attributes`) so his overall holds.
   - A player with only an `overall` gets template skills scaled to it.
3. **Generated players.**
   - A player with neither overall nor ratings is generated from the position templates.
   - His overall comes from the team's target, his depth slot (starters above backups), his class (juniors and seniors above freshmen), and `stars` if given.
   - Then the whole roster is nudged so the team's ratings land on the target. The nudge only moves generated players.
4. **Short rosters.**
   - An empty roster gets a full roster: 85 players by the position counts in `offseason.FLOOR`, with generated names.
   - A roster short at a position is topped up to the floor.
   - Every added player is reported in the import summary.
5. **Potential and coachability** are generated as for recruits (`recruits._potential`). The ratings run through the same pipeline as the built-in data (`teamdata.build_teams`), so the sim sees an ordinary team.

All generation uses its own stream, `random.Random(f"league-{seed}-{slug}")`, so a file and a seed always give the same league.

## Starting a Career

**On the New Career screen:**
- "League: Built-in" by default, or "Import League File…" (a .json picker).
- **Export League** downloads the built-in `league.json` as a starting point.

**The import is checked before anything starts.** Each error names the team and player:
- "Rice, player 14 (Jay Smith): position 'WRR' is not a position"
- "Alder Tech: conference 'big-sky-e' is not in the file or the game"

Then a summary (teams added, changed and removed; players generated) and Start Career.

**Season one schedule:**
- If no conference changed and no team was added or removed, the real 2026 schedule is kept.
- Otherwise the existing generator (`tools`/schedule generator, 2027+ formats) builds 2026 from the merged conferences: conference games by each conference's `games`, listed rivalries, and non-conference fill.
- FCS stand-ins stay available as fill.

**The save:**
- The merged, filled league goes into the career's state as its league, the same structure `coach_career/league.py` uses from the first offseason on. `league.py` reads it from season one instead of `data/engine_teams.json`.
- Program history, AD goals, recruiting pulls (distance from `lat`/`lon`), the coach market and NIL budgets read the career's league. A new team gets base program values from its `prestige` and conference.

## House Rules

- Title Case labels; error messages and the summary in sentences.
- American spelling.
- No "null" on the page.
- 44 px controls.
- The import and export controls patch in place.
- The golden digest stays byte-identical for the built-in league.
- New randomness goes in its own stream. Tunable constants are marked `*tune*`.

## Testing

- **Round trip.** Exporting the built-in league and importing it unchanged gives identical teams, ratings and rosters, and `test_sim_golden.py` stays byte-identical.
- **Validation.** One test per error kind: bad position, unknown conference, duplicate slug, bad JSON, wrong `format`.
- **Generation.**
  - A team with only names lands within ±2 of its target strength, and within its conference's spread with no grade.
  - Given ratings are kept exactly.
  - An empty roster comes out at 85 players by position floors.
  - The same file and seed give the same league.
- **Integration.** A career with an added team in a new conference plays a full season (schedule, games, standings, recruiting) and an offseason (the career league carries it on).
- **UI.**
  - The New Career screen shows import errors and the summary at 1280 and 400.
  - Export downloads valid JSON.
- **Suite.** `tests/run_all.py` is fully green.

## Not in Scope

- Editing a career in progress.
- An in-game editor.
- CSV import.
- Custom bowls or playoffs beyond what conferences imply.
