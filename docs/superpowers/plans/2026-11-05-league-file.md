# League File Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player start a Coach Career from a league file (`cfp-league/1`) that updates, adds or removes teams and rosters, and export the built-in league as that file.

**Architecture:** Two new modules carry the feature. `coach_career/league_file.py` owns the format: export, parse, validate, merge and the summary. `coach_career/league_fill.py` owns generation: strength targets, generated players, coaches, programs and recruiting models. A checked import becomes a career league, the same `state["league"]` structure `coach_career/league.py` builds at the first offseason. The career carries it from season one, and `league.ensure_built` builds it the way later seasons are built (`build_teams.build(real=False)`). An import that changes nothing collapses to the built-in path: the state has no `league`, the season reads `data/engine_teams.json`, and the golden digest cannot move.

**Tech Stack:** Python 3 (runs natively and in Pyodide), vanilla JS (`web/`), Playwright browser tests, plain-script tests (`python3 tests/<file>.py`).

**Spec:** `docs/superpowers/specs/2026-11-05-league-file-design.md`

## Global Constraints

- New careers only. An imported league applies only to careers started from it. Careers already in progress are never touched.
- `"format": "cfp-league/1"`. JSON only. No in-game editor, no CSV.
- Merging is by team id (slug). A team in the import replaces the built-in team, a new slug adds a team, teams left out are unchanged, and `"remove": [slugs]` drops teams. A one-team file is a valid import.
- Required fields: a new team needs `slug`, `name` and `conference`. A team replacing a built-in one needs only `slug`, and every field it leaves out (including `roster`) keeps the built-in value. A player needs `name`, `pos` and `class`.
- Positions: `QB RB WR TE LT LG C RG RT LEDG DT REDG SAM MIKE WILL CB FS SS K P` (plus `HB` and `FB`, see Task 2). Classes: `FR SO JR SR` plus the `RS` variants (`FRRS SORS JRRS SRRS`, as in `league.CLASSES`).
- Strength is a word (`Elite`, `Strong`, `Average`, `Weak`) or a number from 1 to 100.
- An empty roster gets 85 players. A roster short at a position is topped up to `offseason.FLOOR`. Every added player is reported in the import summary.
- All generation uses `random.Random(f"league-{seed}-{slug}")`, so a file and a seed always give the same league. The season-one schedule uses its own stream, `random.Random(f"league-schedule-{seed}")`.
- Season one keeps the real 2026 schedule when no conference changed and no team was added or removed. Otherwise `sim/schedule_gen.generate` builds 2026. FCS stand-ins stay available as fill.
- `python3 tests/test_sim_golden.py` stays byte-identical. Recruiting reads, flags and scenes are never in the digest.
- Copy: labels, chips, buttons and options are Title Case. Errors and summary lines are sentences that start with a capital and end with a period. American spelling. No "null", "undefined" or "NaN" on the page.
- FCS stand-in names, and their conference's name, never appear on the page or in an error. Do not hardcode stand-in slugs: read `league.base_meta(s)["fictional"]`. Another branch is renaming them.
- FCS stand-in team names must never appear on the page; every display name goes through `season.team_display`. A separate branch, `fcs-names-purge`, may land on main while this work runs and rename the stand-in slugs to `fcs-<region>`. If it lands, merge main into `league-file` and adapt; no stand-in slug or name is hardcoded in code or tests.
- Front end: actions patch in place (`window.CFP.ui`). Every URL is relative. Controls are at least 44 px tall on a phone. `tests/test_spacing.py` and `tests/test_ux_sweep.py` stay green. Browser layout assertions are font-robust (CI uses `tests/fonts-ci.conf`): compare boxes to each other and to the viewport, never to pixel constants that depend on text width.
- Constants the player may want to tune are module-level, marked `*tune*`, with a one-line comment.
- Commits end with the session's two attribution trailer lines. No model identifiers in code or commits.

## Review Focus

1. **A depth chart that names a player who is not on the roster** (a typo, or a player the file dropped). Expect a sentence naming the team, the role and the name, for example "Rice: the depth chart's QB list names Jay Smyth, who is not on the roster." Never a KeyError at Start Career. The test is in Task 2.
2. **Two players with the same name on one roster.** Depth charts name players, so this is ambiguous. Expect "Rice: players 14 and 31 are both named Jay Smith; give each a different name." The same name on two different teams is fine. The test is in Task 2.
3. **A team that is in `remove` and is also listed in `teams`.** Expect "Kent State: the file removes it and also lists it; do one or the other." Do not apply one action silently. The test is in Task 2.
4. **A conference with too few teams to schedule its `games`.** This covers an imported conference, and a built-in one that `remove` has cut down. Expect the check to fail before Start Career with "Big Sky East: 3 teams can't play 8 conference games each; it needs at least 9." `ScheduleError` is never raised at Start Career. The test is in Task 2. Task 7 also proves the generator builds what the check passes.
5. **A file far too large or too wide.** This covers a file of hundreds of teams and a file of tens of megabytes. Over `MAX_TEAMS` FBS teams after merging, expect one sentence. Over `MAX_LEAGUE_BYTES`, the browser refuses the file before reading it (`file.size`) and Python refuses it before decoding. The exported built-in file (about 22 MB) checks cleanly. The tests are in Task 2 (Python) and Task 9 (browser).

---

## Key Decisions

- **Collapse to the built-in league.** `merge` compares each imported team, after applying its defaults, with the export of the built-in team. A team that is equal does not count as changed. If nothing is added, changed or removed and no conference changed, the check returns `builtin: True`, and Start Career runs the existing path without a `league`. This is what keeps the round trip and the golden digest byte-identical.
- **A changed league plays season one through `league.build`.** The whole merged league is built once with `build_teams.build(real=False)`, exactly as a career's second season is. Unchanged teams therefore lose the real-2026-only adjustments (real depth charts, manual nudges) in an imported career. This is accepted: a subset build would be inconsistent, because tendency centering and discipline decoupling are computed over the whole league.
- **Where the built-in `league.json` comes from.** `league_file.export_document()` is computed from `league.from_base()` and `league.base_meta()` (the precomputed `data/base_league.json` and `data/base_meta.json`). `tools/build_site.py` writes it to `dist/league.json`, a static file next to the page. It is not in `game.zip`, so the first load does not grow by 22 MB. `tools/dev_server.py` serves `/league.json` from `league_file.builtin_bytes()`. Export League fetches the relative URL `league.json`.
- **Lossless export.** Every compact player field is written (`id`, ratings for all 54 skills, potential for skills with room, and the rest), so `to_league(parse(export))` equals `from_base()` field for field. A second export is byte-identical to the first.
- **Validation lives in `league_file.validate`.** It is pure and runs before any generation. It returns every error as a sentence, up to `MAX_ERRORS`, with an "And N more." line. It names the team by short name (by "Team N" when there is none) and the player as "player N (Name)". Schedule feasibility is checked from member counts here and proven by the generator at check time in Task 8.
- **Seed.** `league_fill.league_seed(blob, seed)` returns the career's seed when one is given, otherwise `int(sha256(blob)[:8], 16)`. The check fills with that seed, and Start Career refills only when the request carries a different seed.
- **Identity of new or edited teams.** It is stored on the league entry as `meta` (the source-format identity `league._meta_of` gives). `league.team_meta(lgd, slug)` reads it and falls back to `base_meta`.
- **Recruiting, programs, AD goals and NIL** already read `programs.get(state, slug)` from the league. For new teams, `league_fill` writes `program` and a synthesized recruiting team model into the league. `recruiting.use_league_models` makes `_team_model` see that model (location from `lat`/`lon`, so pulls by distance work).

## File Structure

- Create `coach_career/league_file.py`: format constants, export, `parse`, `validate`, `merge`, `check`, summary sentences, schedule rules and divisions for a merged league.
- Create `coach_career/league_fill.py`: strength targets, `fit_overall`, roster fill, new-team coaches, style, formation, program, recruiting model and meta; `to_league`.
- Modify `coach_career/league.py`: `team_meta`, `league_slugs`, `lineup(preferred=)`, `source_teams`, `ensure_built` for an imported season one, `is_imported`.
- Modify `coach_career/offseason.py`: `base_meta` calls become `team_meta`, the first offseason drops `depth`, and `next_season` passes the league's schedule rules.
- Modify `coach_career/recruiting.py`: `use_league_models`, plus `_team_model` and `fbs_schools` reading it.
- Modify `sim/season.py`: `activate` sets league models; `divisions(state)`; `new_season(league=, career_id=, real_polls=)`; `summary["league"]`.
- Modify `sim/schedule_gen.py`: `generate(..., rules_override=)`, `empty_history()`.
- Modify `app/api.py`: `POST /api/league/check`, `POST /api/season` with `league`, `GET /api/season/{season_id}/teams`; `_activate` calls `season.activate`.
- Modify `tools/build_site.py` (writes `dist/league.json`) and `tools/dev_server.py` (serves `/league.json`).
- Create `web/leaguefile.js`. Modify `web/index.html` (League panel, script tag), `web/season.js` (team picker swap, `league` on new season, career teams merge) and `web/styles.css`.
- Tests: create `tests/test_league_file.py`, `tests/test_league_fill.py`, `tests/test_league_schedule.py`, `tests/test_league_career.py` and `tests/test_league_file_ui.py`. Modify `tests/test_site_bundle.py`, `tests/test_copy_case.py` (add `leaguefile.js` to `PAGES`) and `tests/run_all.py` (add `test_league_career.py` to `SLOW`).
- Docs: `docs/HOW_IT_WORKS.md` gets a new section, "League files (`coach_career/league_file.py`)", in Task 8.

---

### Task 1: The built-in league as a file, losslessly

**Files:**
- Create: `coach_career/league_file.py`
- Modify: `tools/build_site.py` (`build`: write `out / "league.json"`), `tools/dev_server.py` (`_static`: serve `league.json`)
- Test: `tests/test_league_file.py`, `tests/test_site_bundle.py`

**Interfaces:**
- Consumes: `league.from_base(year) -> dict`, `league.base_meta(slug)`, `league.base_slugs()`, `game_scale.keys()`, `recruiting.model()["teams"][slug]["location"]`.
- Produces:
  - `FORMAT = "cfp-league/1"`
  - `conference_id(name: str) -> str`: lowercase, with runs of non-alphanumerics turned into `-` ("American Athletic Conference" becomes "american-athletic-conference").
  - `export_document() -> dict`: `{"format", "name": "Built-in League", "year": 2026, "conferences": [...], "teams": [...]}`. It includes FBS teams only and never a fictional team or the stand-ins' conference.
  - `team_doc(lgd: dict, slug: str) -> dict`: one team in file form.
  - `player_doc(c: dict, attrs: list[str]) -> dict` and `player_compact(p: dict, attrs: list[str]) -> dict`, which are exact inverses on a complete player.
  - `to_league_team(doc: dict, attrs: list[str]) -> dict`: a complete team doc as a league entry (`roster`, `coaches`, `formation`, optional `style`).
  - `dumps(doc: dict) -> bytes`: `json.dumps(doc, ensure_ascii=False, separators=(",", ":"))` plus `"\n"`, UTF-8, in insertion order.
  - `builtin_bytes() -> bytes` (`lru_cache`) and `write_builtin(path: Path) -> int` (bytes written).

The file form of a team is the spec's fields, plus the exported extras. Team keys:
- `slug`; `name` (= `school_name`); `short_name`; `abbreviation`; `mascot`; `city`; `state`; `lat` and `lon` (from the recruiting model's `location`);
- `conference` (a conference id); `level`; `colors`; `stadium`; `home_field`; `prestige` (the program's base `prestige`, 0 to 100); `rivals`;
- `coaches` (`head`, `oc` and `dc` as the league's full coach dicts, plus `offense` and `defense`, the head coach's scheme words);
- `formation`; `style` (only when it is not the slug); `roster`.

Player keys:
- `id`, `name`, `pos` (`HB` is written as `RB`), `class`, `overall`, `stars`;
- `ratings` (all 54 skills by name), `potential` (absolute values, only skills where `g > 0`);
- `height`, `weight`, `jersey`, `archetype`, `dev`, `abilities`, `coachability`, `hometown` (the state code), `years`, and `target_share` when present.

Conferences: `{"id", "name", "level": "FBS", "games"}`. `games` is the schedule rule's `_league_games(rule, 2026)`, or 0 for the independents.

- [ ] **Step 1: Write the failing tests** in `tests/test_league_file.py`:

```python
def test_export_round_trips_to_from_base():
    doc = league_file.export_document()
    attrs = game_scale.keys()
    base = league.from_base(2027)
    rebuilt = {d["slug"]: league_file.to_league_team(d, attrs) for d in doc["teams"]}
    for slug, entry in base["teams"].items():
        want = {k: entry[k] for k in ("roster", "coaches", "formation")}
        got = {k: rebuilt[slug][k] for k in ("roster", "coaches", "formation")}
        assert json.dumps(got, sort_keys=True) == json.dumps(want, sort_keys=True), slug
    assert set(rebuilt) == set(base["teams"])

def test_export_is_byte_stable_and_fcs_free():
    a = league_file.dumps(league_file.export_document())
    assert a == league_file.dumps(json.loads(a)) == league_file.builtin_bytes()
    fictional = [league.base_meta(s) for s in league.base_slugs() if league.base_meta(s)["fictional"]]
    text = a.decode("utf-8")
    for m in fictional:
        assert f'"{m["slug"]}"' not in text and m["short_name"] not in text
        assert m["conference"] not in text
    assert json.loads(a)["format"] == "cfp-league/1"
```

Add to `tests/test_site_bundle.py`: after `build_site.build(tmp)`, check that `tmp / "league.json"` exists, that `json.loads` of it has `format == "cfp-league/1"`, and that `"league.json"` is not among `info["files"]`.

- [ ] **Step 2: Run** `python3 tests/test_league_file.py`. Expected: FAIL with `ModuleNotFoundError: coach_career.league_file`.
- [ ] **Step 3: Implement** the Produces list in `coach_career/league_file.py`. Then implement `build_site.build`: after the web copy, `league_file.write_builtin(out / "league.json")`. In `dev_server._static`: when `name == "league.json"` and `web/league.json` does not exist, send `league_file.builtin_bytes()` as `application/json`.
- [ ] **Step 4: Run** `python3 tests/test_league_file.py`, `python3 tests/test_base_league.py` and `python3 tests/test_site_bundle.py`. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "League file: export the built-in league losslessly"`, plus the trailer lines.

### Task 2: Parse and validate

**Files:**
- Modify: `coach_career/league_file.py`
- Test: `tests/test_league_file.py`

**Interfaces:**
- Consumes: `export_document()`, `conference_id()`, `league.base_slugs()`, `league.base_meta()`, `schedule_gen.rules()`, `league.CLASSES`, `game_scale.keys()`, `offseason.ROSTER_LIMIT`.
- Produces:
  - `MAX_LEAGUE_BYTES = 64 * 1024 * 1024  # *tune* the largest league file read (the built-in export is about 22 MB)`
  - `MAX_TEAMS = 256  # *tune* FBS teams in a merged league (138 built in)`
  - `MAX_ERRORS = 50  # errors listed before "And N more."`
  - `POSITIONS = ("QB","RB","WR","TE","LT","LG","C","RG","RT","LEDG","DT","REDG","SAM","MIKE","WILL","CB","FS","SS","K","P")`, and `POS_IN = {**{p: p for p in POSITIONS}, "RB": "HB", "HB": "HB", "FB": "FB"}` (file position to league position).
  - `STRENGTH_WORDS = ("Elite", "Strong", "Average", "Weak")`
  - `class LeagueFileError(Exception)` with `.errors: list[str]`.
  - `parse(blob: bytes) -> dict`: raises `LeagueFileError` for size, UTF-8, JSON, a top level that is not an object, and format.
  - `validate(doc: dict) -> list[str]`: every error sentence, capped as above.

Rules `validate` enforces, each with its exact sentence:
- Slugs match `^[a-z0-9]+(-[a-z0-9]+)*$`.
- Duplicate slugs are an error.
- A slug or `remove` entry that names a fictional team gives "Team N: that slug is reserved for the game's FCS opponents; pick another." The name is never echoed.
- A conference id or name that names the stand-ins' conference gives "Alder Tech: that conference is reserved for the game's FCS opponents."
- `remove` of an unknown slug is an error.
- `level` other than `"FBS"` gives "Alder Tech: level 'FCS' is not supported; FCS games use the game's own opponents."
- `year` other than 2026 gives "The file's year is 2027; careers start in 2026, so use 2026 or leave it out."
- A `conference` must be a file conference id or a built-in conference id or name. Otherwise: "Alder Tech: conference 'big-sky-e' is not in the file or the game."
- `games` is 0 to 11.
- Members after the merge, n, must satisfy n - 1 >= games for every conference with `games > 0`. Otherwise: "Big Sky East: 3 teams can't play 8 conference games each; it needs at least 9."
- FBS teams after the merge must be at most `MAX_TEAMS`.
- Player rules:
  - `name`, `pos` and `class` are required.
  - `pos` must be in `POS_IN`: "Rice, player 14 (Jay Smith): position 'WRR' is not a position."
  - `class` must be in `league.CLASSES`.
  - `overall` and every `ratings` or `potential` value are integers from 1 to 99, and every rating key is in `game_scale.keys()`.
  - `stars` is 1 to 5. `height` is 60 to 90. `weight` is 140 to 420. `id` matches the slug pattern and is unique across the whole merged league.
- Two players on one roster may not share a name (case-insensitive).
- A roster may have at most `offseason.ROSTER_LIMIT` players.
- Each `depth_chart` key is in `POSITIONS` or is `HB` or `FB`, and each name is on the roster (or on the kept built-in roster).
- `rivals` must be known slugs.
- `strength` is one of `STRENGTH_WORDS` or a number from 1 to 100.
- Colors are `#RRGGBB`.
- `lat` is -90 to 90 and `lon` is -180 to 180. `state` is a two-letter code that `recruiting.model()["generation"]["towns"]` knows.
- A team in `remove` and in `teams` is an error (Review Focus 3).

- [ ] **Step 1: Write the failing tests.** One per error kind, each asserting the exact sentence is in `errors`. Build fixtures by editing a minimal file `{"format": "cfp-league/1", "teams": [ALDER]}` (the spec's example team, with conference `"big-sky-east"` declared with `games: 8` plus nine more minimal members):

```python
def test_bad_position():        assert "Alder Tech, player 1 (Jay Smith): position 'WRR' is not a position." in errs(pos="WRR")
def test_unknown_conference():  assert "Alder Tech: conference 'big-sky-e' is not in the file or the game." in errs(conference="big-sky-e")
def test_duplicate_slug():      assert any("is used by two teams" in e for e in validate(two_alders))
def test_bad_json():            raises(lambda: league_file.parse(b'{"format": "cfp-league/1",'), "The file is not valid JSON")
def test_wrong_format():        raises(lambda: league_file.parse(b'{"format": "cfp-league/2"}'), "The file's format is 'cfp-league/2'; this game reads 'cfp-league/1'.")
def test_depth_chart_unknown_player():  # Review Focus 1
    assert "Alder Tech: the depth chart's QB list names Jay Smyth, who is not on the roster." in errs(depth_chart={"QB": ["Jay Smyth"]})
def test_duplicate_player_names():      # Review Focus 2
    assert "Alder Tech: players 1 and 3 are both named Jay Smith; give each a different name." in errs(roster=[JAY, MAX, JAY])
def test_remove_and_list():             # Review Focus 3
    assert "Kent State: the file removes it and also lists it; do one or the other." in validate({**F, "remove": ["kent-state"], "teams": [{"slug": "kent-state"}]})
def test_conference_too_small():        # Review Focus 4
    assert "Big Sky East: 3 teams can't play 8 conference games each; it needs at least 9." in validate(three_team_conf)
    assert any("Mountain West: " in e and "it needs at least" in e for e in validate({**F, "remove": MWC_SLUGS[:5]}))
def test_size_and_width():              # Review Focus 5
    raises(lambda: league_file.parse(b" " * (league_file.MAX_LEAGUE_BYTES + 1)), "The file is 64.0 MB; the game reads league files up to 64 MB.")
    assert any("FBS teams" in e and "256" in e for e in validate(file_of_300_new_teams))
    assert league_file.validate(league_file.parse(league_file.builtin_bytes())) == []
def test_fcs_never_named():
    fcs = next(s for s in league.base_slugs() if league.base_meta(s)["fictional"])
    out = " ".join(validate({**F, "remove": [fcs]}))
    assert "reserved for the game's FCS opponents" in out and fcs not in out and league.base_meta(fcs)["short_name"] not in out
def test_errors_capped():
    e = validate(file_with_80_bad_positions)
    assert len(e) == league_file.MAX_ERRORS + 1 and e[-1] == "And 30 more."
```

Every error ends with a period and starts with a capital: `assert all(e[0].isupper() and e.endswith(".") for e in every_error_above)`.

- [ ] **Step 2: Run** `python3 tests/test_league_file.py`. Expected: FAIL with `AttributeError: module 'coach_career.league_file' has no attribute 'validate'`.
- [ ] **Step 3: Implement** `parse(blob: bytes) -> dict` and `validate(doc: dict) -> list[str]` with the constants above. The JSON error reads "The file is not valid JSON: line L, column C: msg." Sizes are shown in MB (1 MB = 1024 × 1024 bytes) with one decimal place.
- [ ] **Step 4: Run** `python3 tests/test_league_file.py`. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "League file: parse and validate with errors in sentences"`.

### Task 3: Merge and the summary

**Files:**
- Modify: `coach_career/league_file.py`
- Test: `tests/test_league_file.py`

**Interfaces:**
- Consumes: `team_doc`, `export_document`, `validate`.
- Produces: `merge(doc: dict) -> dict`, returning:
  - `teams`: `{slug: full team doc}`, where an edited built-in team is `{**builtin_doc, **given}` and a new team is the given doc;
  - `added`, `changed` and `removed`: sorted slug lists;
  - `conferences`: `{conf_id: {"id", "name", "level", "games", "members": [slugs]}}`;
  - `structural: bool`: true when a team was added or removed, or a conference's members or `games` differ from the built-in one;
  - `builtin: bool`: true when nothing was added, changed or removed and nothing is structural;
  - `name`: the file's `name` or "Imported League".
- A team counts as changed only when its merged doc differs from `team_doc(from_base, slug)`.
- Conference resolution: a team's `conference` value is matched to a file conference id, then to a built-in conference id, then to a built-in conference name.

- [ ] **Step 1: Write the failing tests:**

```python
def test_unchanged_export_collapses():
    m = league_file.merge(league_file.parse(league_file.builtin_bytes()))
    assert m["builtin"] and not (m["added"] or m["changed"] or m["removed"] or m["structural"])

def test_one_team_file():
    m = league_file.merge({"format": "cfp-league/1", "teams": [{"slug": "rice", "prestige": 55}]})
    assert m["changed"] == ["rice"] and not m["structural"] and len(m["teams"]) == 138
    assert m["teams"]["rice"]["roster"] == league_file.team_doc(league.from_base(2027), "rice")["roster"]   # roster left out: kept

def test_add_and_remove_are_structural():
    m = league_file.merge(file_with_alder_and_remove_kent)
    assert m["added"] == ["alder-tech"] and m["removed"] == ["kent-state"] and m["structural"]
    assert "kent-state" not in m["teams"] and "alder-tech" in m["conferences"]["big-sky-east"]["members"]
```

- [ ] **Step 2: Run** the tests. Expected: FAIL on `merge` missing.
- [ ] **Step 3: Implement** `merge(doc: dict) -> dict`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "League file: merge by slug, collapse an unchanged import"`.

### Task 4: Filling a roster

**Files:**
- Create: `coach_career/league_fill.py`
- Modify: `coach_career/league.py` (add `team_meta`; `source_team` reads identity through it)
- Test: `tests/test_league_fill.py`

**Interfaces:**
- Consumes: `recruits._attributes(rng, pos, band, composite)`, `recruits._potential(rng, pos, stars, ratings_ea)`, `recruits._name(rng, taken)`, `recruits.COACHABILITY`, `recruits.weighted`, `game_scale.from_ea`, `game_scale.potential_from_ea`, `game_scale.overall`, `game_scale.data()["overall"][pos]["w"]` (overall is linear in the skills), `league.compact`, `league.source_team`, `league.TEAM_FIT`, `offseason.FLOOR`, `offseason.TARGET`, `offseason.GROUP`, `league_file.POS_IN`, `league_file.player_compact`.
- Produces:
  - `league.team_meta(lgd: Optional[dict], slug: str) -> dict`: `lgd["teams"][slug]["meta"]` when present, otherwise `base_meta(slug)`. `league.source_team` calls it instead of `base_meta`, so the nudge can build a team the game does not know yet.
  - `STRENGTH_GRADE = {"Elite": 95, "Strong": 75, "Average": 50, "Weak": 20}  # *tune* each word's place among the FBS teams (percentile)`
  - `SLOT_STEP = {"starter": 0.0, "backup": -7.0, "depth": -12.0}  # *tune* generated overall by depth slot, against the team's starter level`
  - `CLASS_STEP = {"FR": -5.0, "FRRS": -4.0, "SO": -2.5, "SORS": -1.5, "JR": 0.0, "JRRS": 0.5, "SR": 1.0, "SRRS": 1.5}  # *tune* juniors and seniors above freshmen`
  - `STAR_STEP = {5: 6.0, 4: 3.0, 3: 0.0, 2: -3.0, 1: -5.0}  # *tune* given stars' lift`
  - `PLAYER_SD = 3.0  # *tune* spread of a generated overall around its slot`
  - `base_strengths() -> dict[str, float]` (`lru_cache`): each built-in FBS team's `team_ratings(...)["overall"]` from `league.source_team(league.from_base(2027), slug)`.
  - `strength_target(team: dict, conference: dict, strengths: dict) -> float`. With `strength` given: a word maps through `STRENGTH_GRADE`, a number is used as is, and the grade g becomes the FBS teams' overall at percentile g (linear interpolation over the sorted `strengths`). Without it: the mean of the conference's built-in members' strengths, or the FBS median for a new conference.
  - `fit_overall(ours: dict[str, int], pos: str, target: int, keys: Iterable[str]) -> dict[str, int]`: shifts only `keys`, all by the same amount (clamped 1 to 99), so that `game_scale.overall(out, pos) == target` when reachable. Use bisection on the shift, because clamping makes it non-linear.
  - `fill_roster(team: dict, target: float, rng: random.Random, attrs: list[str], taken: set[str]) -> tuple[list[dict], list[str]]`: returns the league roster (compact players) and the summary sentences for this team.

`fill_roster` in order (the spec's "Filling a Roster"):
1. Order: each player's slot comes from `depth_chart` when it names him, otherwise from his place among the same position in roster order. The first `formation` count are starters, the next equal number are backups, and the rest are depth.
2. A complete player (all 54 `ratings` given) goes through `league_file.player_compact`. If his given `overall` differs from the ratings' formula by more than 1, `fit_overall` moves all his skills to it, and the summary says "Alder Tech: Max Lee's ratings were moved to match his overall 74."
3. Some `ratings` given: generate a template (step 5), overwrite the given keys, then `fit_overall` over the missing keys to his `overall` if given, otherwise to the template's overall.
4. Only `overall` given: the template, then `fit_overall` over every key.
5. Neither given: band `str(stars or 3)`. The composite is the band's median from `model()["generation"]["rating_quantiles"]`. The overall target is `S + SLOT_STEP[slot] + CLASS_STEP[cls] + STAR_STEP.get(stars, 0) + rng.gauss(0, PLAYER_SD)`, rounded and clamped to 25 to 95. S is the starter level that gives the target team overall through `league.TEAM_FIT`:

   ```
   S = (target - Σ_u w_u b_u) / Σ_u w_u a_u
   ```

   Here `(a_u, b_u)` is `TEAM_FIT[u]` and `w = {"offense": 0.45, "defense": 0.45, "special_teams": 0.1}`.
6. Potential is `game_scale.potential_from_ea(recruits._potential(rng, pos, stars or 3, ratings_ea), ours, pos)`, where `ratings_ea` is the template's. A complete player's given `potential` is kept. Coachability is `recruits.weighted(rng, ((n, s) for n, _, s in recruits.COACHABILITY))` unless given.
7. Short rosters:
   - An empty roster gets `offseason.TARGET`'s group counts (85 players). Each group is spread over its positions by the formation, and each player gets a generated name via `recruits._name(rng, taken)`.
   - A roster short of `offseason.FLOOR` in a group is topped up to the floor.
   - The summary says "Alder Tech: 85 players generated (the roster was empty)." or "Rice: 3 players added to reach the position floors (2 OL, 1 K)."
8. Nudge: build the team with `league.source_team` on a one-team scratch league. Then shift every generated player's overall by one common delta (via `fit_overall` over all keys), found by bisection on [-30, 30] over at most 20 steps, until `|team overall - target| <= 0.5`. Players with a given `overall` or `ratings` never move.
9. Player ids: the given `id`, otherwise `f"{team_slug}-{slugify(name)}"`, made unique against `taken` by adding `-2`, `-3` and so on.
10. Draw order is fixed: players in roster order (template, then overall noise, then potential, then coachability), then the top-ups by group in `offseason.FLOOR` order, then names.

- [ ] **Step 1: Write the failing tests** in `tests/test_league_fill.py`:

```python
def test_names_only_lands_on_target():
    team = alder(roster=[{"name": f"P{i}", "pos": pos, "class": "JR"} for i, pos in enumerate(POSITIONS_85)])
    for grade in ("Elite", "Average", "Weak", 63):
        tgt = league_fill.strength_target({**team, "strength": grade}, CONF, STR)
        roster, _ = league_fill.fill_roster({**team, "strength": grade}, tgt, random.Random("league-1-alder-tech"), ATTRS, set())
        assert abs(team_overall(roster, team) - tgt) <= 2, (grade, tgt)

def test_no_grade_sits_in_conference_spread():
    conf = [STR[s] for s in MWC_SLUGS]
    tgt = league_fill.strength_target({**names_only, "conference": "mountain-west"}, MWC, STR)
    assert abs(tgt - statistics.mean(conf)) < 1e-9
    assert min(conf) <= team_overall(fill(names_only, tgt), names_only) <= max(conf)

def test_given_ratings_kept_exactly():
    roster, _ = fill(alder(roster=[MAX_LEE_74, AL_CRUZ_PB82_RB78] + names_only_rest), 58.0)
    by = {c["n"]: c for c in roster}
    assert by["Max Lee"]["o"] == 74
    r = dict(zip(ATTRS, by["Al Cruz"]["r"])); assert (r["pass_block"], r["run_block"]) == (82, 78)

def test_empty_roster_85_by_target():
    roster, lines = fill(alder(roster=[]), 55.0)
    assert len(roster) == 85 and group_counts(roster) == offseason.TARGET
    assert "Alder Tech: 85 players generated (the roster was empty)." in lines

def test_short_roster_topped_to_floor():
    roster, lines = fill(alder(roster=[two_qbs_only]), 55.0)
    assert all(group_counts(roster)[g] >= n for g, n in offseason.FLOOR.items())
    assert any(l.startswith("Alder Tech: ") and "to reach the position floors" in l for l in lines)

def test_same_file_and_seed_same_league():
    a = fill(names_only, 55.0, rng=random.Random("league-7-alder-tech"))
    b = fill(names_only, 55.0, rng=random.Random("league-7-alder-tech"))
    assert json.dumps(a) == json.dumps(b)
    assert json.dumps(a) != json.dumps(fill(names_only, 55.0, rng=random.Random("league-8-alder-tech")))
```

`team_overall(roster, team)` is `league.source_team({"year": 2026, "attrs": ATTRS, "teams": {slug: {"roster": roster, "coaches": C, "formation": F, "meta": M}}}, slug)["team_ratings"]["overall"]`, where `M` is a copy of `league.base_meta("rice")` with `slug`, `short_name` and `conference` set to Alder Tech's values.

- [ ] **Step 2: Run** `python3 tests/test_league_fill.py`. Expected: FAIL with `ModuleNotFoundError: coach_career.league_fill`.
- [ ] **Step 3: Implement** the constants, `base_strengths`, `strength_target`, `fit_overall` and `fill_roster` in `coach_career/league_fill.py`.
- [ ] **Step 4: Run** `python3 tests/test_league_fill.py` and `python3 tests/test_sim_golden.py`. Expected: PASS, and golden unchanged.
- [ ] **Step 5: Commit** with `git commit -m "League fill: generated players, given ratings kept, rosters topped up"`.

### Task 5: A new team's coaches, program, recruiting model and identity; `to_league`

**Files:**
- Modify: `coach_career/league_fill.py`
- Test: `tests/test_league_fill.py`

**Interfaces:**
- Consumes: `carousel.generated(rng, lgd, role, slug, year, like=None, level=0.0)`, `programs.base`, `programs.mix`, `programs.tier_of`, `programs.BASE_DEFAULT`, `programs.MARKET_DEFAULT`, `recruiting.model()["teams"]`, `recruits.model()["generation"]["towns"]`, `league.from_base`, `league._meta_of`, `league_file.merge`, `fill_roster`.
- Produces:
  - `STATE_CENTER: dict[str, tuple[float, float]]`: the town-weighted mean `lat`/`lon` of each state in `model()["generation"]["towns"]`, computed once.
  - `NEUTRAL_COLORS = {"primary": {"name": "Gray", "hex": "#5A6270"}, "secondary": {"name": "White", "hex": "#FFFFFF"}, "accent": None}  # *tune*`. A `None` accent gives the neutral pill border the season page already draws.
  - `team_meta_doc(team: dict, conf_name: str) -> dict`: the source-format identity:
    - `school_name` = `name`; `short_name` defaults to `name`;
    - `abbreviation` defaults to the initials of the words in `name` (up to 4, upper case);
    - `mascot` defaults to `name`'s last word;
    - `subdivision` "FBS"; `fictional` False;
    - `stadium` defaults to `{"name": f"{short_name} Stadium", "capacity": 30000, "surface": "turf"}`;
    - `program` = `{"prestige": 1 + round(5 * prestige / 100), "home_field_advantage": home_field or the conference's median, "generated": True}`;
    - `rivals`; `roster_size`.
  - `coaches_for(team: dict, conf: dict, lgd: dict, rng: random.Random) -> dict`. Each role missing from `coaches` is `carousel.generated(rng, lgd, role, slug, 2026, like=<the conference's most common head coach scheme carrier>)`. A given `name` replaces the generated name. A given `rating` sets `ratings["overall"]`, and the other ratings shift by the same amount. A role given with full `ratings` is kept as given. `offense`/`defense` words set `scheme.offensive_philosophy`/`defensive_philosophy` (and the coordinator's `offensive_scheme`/`defensive_scheme`), and default to the conference's most common.
  - `style_and_formation(team: dict, conf: dict, lgd: dict) -> tuple[str, dict]`: the alphabetically first built-in conference member whose head coach's offensive philosophy matches. Its slug is the `style` and a copy of its `formation` is the formation. In a new conference, use the FBS-wide match.
  - `program_for(team: dict, conf: dict, lgd: dict) -> dict`: `history = prestige = team["prestige"]` if given, otherwise the conference members' mean `prestige`. `winning`, `nil` and `conference` are the conference members' medians (a new conference uses `programs.BASE_DEFAULT`). `market` is `programs.MARKET_DEFAULT`, and `coach` is the head coach's overall. Then `rating = programs.mix(p)` and `tier = programs.tier_of(rating)`, in the shape `programs.init` gives (`*_base` keys, `live 0.0`, `seasons []`, `year 2025`).
  - `recruiting_model_for(team: dict, conf: dict, strength: float) -> dict`: `location = [lat, lon]` (or `STATE_CENTER[state]`); `top_states = [[state, in_state_share]]`; `class_size`, `star_share`, `blue_chip_share`, `positions_per_class`, `in_state_share` and `distance_miles` are the conference members' medians (FBS medians for a new conference); `strength.baseline` is the baseline of the built-in team whose strength is nearest; `last_season` None; `tier` "Group of 5".
  - `to_league(merged: dict, seed: int) -> tuple[dict, list[str]]`:
    - Start from `league.from_base(2026)`, which gives `year 2026` and programs `year 2025`. Drop `removed`.
    - For each added or changed team, rebuild what it changed: `roster` given → `fill_roster`; `coaches` given or new → `coaches_for`; identity fields differ → `meta`; new team → `program`, `style`, `formation` and `recruiting_model`; `prestige` differs on a built-in team → its program `prestige` and `history`.
    - A given `depth_chart` becomes `depth`: `{role: [player ids]}`.
    - Each team uses `random.Random(f"league-{seed}-{slug}")`.
    - Set `lgd["source"] = {"format": FORMAT, "name": merged["name"]}`, `lgd["recruiting_models"] = {slug: model}` (new teams, and edited teams whose `lat`/`lon`/`state` moved), `lgd["schedule_rules"]` and `lgd["divisions"]` (Task 7).
    - The returned lines are the summary sentences: first "1 team added, 2 changed and 1 removed." then each team's fill lines.
  - `league_seed(blob: bytes, seed: Optional[int]) -> int`

- [ ] **Step 1: Write the failing tests:**

```python
def test_new_team_complete():
    lgd, lines = league_fill.to_league(league_file.merge(ALDER_FILE), 1)
    t = lgd["teams"]["alder-tech"]
    assert {"roster", "coaches", "formation", "program", "meta", "style"} <= set(t)
    assert t["coaches"]["head_coach"]["name"] == "Pat Doe" and t["coaches"]["head_coach"]["ratings"]["overall"] == 60
    assert t["meta"]["colors"]["primary"]["hex"] == "#0B6E4F" and t["meta"]["conference"] == "Big Sky East"
    assert t["program"]["prestige"] == 40 and 1 <= t["program"]["tier"] <= 5
    assert lgd["recruiting_models"]["alder-tech"]["location"] == [44.05, -121.31]
    assert lgd["source"]["name"] == "My League" and "kent-state" not in lgd["teams"]
    assert lines[0] == "1 team added, 0 changed and 1 removed."

def test_defaults_derived():   # minimal_new_team_file: slug "owl-state", name "Owl State", state "OR", a built-in conference
    lgd, _ = league_fill.to_league(league_file.merge(minimal_new_team_file), 1)
    m = lgd["teams"]["owl-state"]["meta"]
    assert m["short_name"] == "Owl State" and m["abbreviation"] == "OS" and m["mascot"] == "State"
    assert m["colors"]["accent"] is None
    assert lgd["recruiting_models"]["owl-state"]["location"] == list(league_fill.STATE_CENTER["OR"])

def test_to_league_deterministic():
    assert json.dumps(league_fill.to_league(M, 3)[0], sort_keys=True) == json.dumps(league_fill.to_league(M, 3)[0], sort_keys=True)
```

- [ ] **Step 2: Run** `python3 tests/test_league_fill.py`. Expected: FAIL on `to_league` missing.
- [ ] **Step 3: Implement** the Produces list.
- [ ] **Step 4: Run** `python3 tests/test_league_fill.py`. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "League fill: new teams' coaches, program, recruiting model and identity"`.

### Task 6: The career league from season one

**Files:**
- Modify: `coach_career/league.py`, `coach_career/offseason.py` (lines 562, 814, 1264, 2146, 2414, 2428: `lg.base_meta(x)` → `lg.team_meta(state.get("league"), x)`; `start`: `t.pop("depth", None)` for every team), `coach_career/recruiting.py`, `sim/season.py` (`activate`), `app/api.py` (`_activate` → `season.activate(state)`)
- Test: `tests/test_league_fill.py` (build), `tests/test_base_league.py` (unchanged), `tests/test_sim_golden.py` (unchanged)

**Interfaces:**
- Consumes: `league_fill.to_league`, `league.team_meta` (Task 4).
- Produces:
  - `league.league_slugs(lgd: dict) -> tuple[str, ...]`: `sorted(set(lgd["teams"]) | {fictional base slugs})`. For the built-in league this is exactly `base_slugs()`.
  - `league.is_imported(lgd: Optional[dict]) -> bool`: `bool((lgd or {}).get("source"))`.
  - `league.lineup(roster, shape, year=FIRST_YEAR + 1, by_overall=False, preferred: Optional[dict] = None)`. In `preferred` (`{role: [player slugs]}`), the named players lead their role's depth order in the given order, and the rest follow as before. When it is None, the behavior is unchanged.
  - `league.source_team` passes `entry.get("depth")` as `preferred`. `source_teams` iterates `league_slugs(league)`.
  - `league.ensure_built(state)` returns None when there is no league, or when `year <= FIRST_YEAR` and the league is not imported. An imported league builds `path(id, 2026)` in season one.
  - `recruiting.use_league_models(models: dict) -> None`: sets the module's `_LEAGUE_MODELS`, and calls `reset_caches()` only when the models changed. `reset_caches` does not clear `_LEAGUE_MODELS`.
  - `recruiting._team_model(slug)` returns `_LEAGUE_MODELS.get(slug) or model()["teams"].get(slug) or {}`. `fbs_schools` keeps the schools with a non-empty `_team_model(s)`.
  - `season.activate(state)` first calls `recruiting.use_league_models((state.get("league") or {}).get("recruiting_models") or {})`, then does what it does today.

- [ ] **Step 1: Write the failing test** in `tests/test_league_fill.py`:

```python
def test_imported_league_builds_from_season_one():
    lgd, _ = league_fill.to_league(league_file.merge(ALDER_FILE), 1)
    st = {"id": "lf-test", "league": lgd, "year": 2026, "team": "alder-tech"}
    try:
        p = league.ensure_built(st)
        teams = json.loads(p.read_text())["teams"]
        assert "alder-tech" in teams and "kent-state" not in teams
        assert teams["alder-tech"]["name"] == "Alder Tech" and teams["alder-tech"]["conference"] == "Big Sky East"
        assert any(t["fictional"] for t in teams.values())                     # the stand-ins are still there as fill
        assert teams["alder-tech"]["offense"][0]["slug"].startswith("alder-tech-")
    finally:
        league.forget("lf-test")
    assert league.ensure_built({"id": "x", "league": league.from_base(2027), "year": 2026}) is None   # built-in: unchanged
```

Also add `test_depth_chart_preferred`: `league.lineup(roster, shape, 2026, preferred={"QB": [backup_slug]})[1]["QB"][0] == backup_slug`.

- [ ] **Step 2: Run** `python3 tests/test_league_fill.py`. Expected: FAIL, because `ensure_built` returns None.
- [ ] **Step 3: Implement** the Produces list, and replace the `offseason` `base_meta` calls.
- [ ] **Step 4: Run** `python3 tests/test_league_fill.py`, `python3 tests/test_base_league.py`, `python3 tests/test_offseason.py`, `python3 tests/test_recruiting.py` and `python3 tests/test_sim_golden.py`. Expected: PASS, and golden byte-identical.
- [ ] **Step 5: Commit** with `git commit -m "Career league from season one for an imported league"`.

### Task 7: Schedules for a merged league

**Files:**
- Modify: `sim/schedule_gen.py`, `coach_career/league_file.py`, `sim/season.py` (`DIVISIONS` reads), `coach_career/offseason.py` (`next_season`'s `generate` call)
- Test: `tests/test_league_schedule.py`

**Interfaces:**
- Consumes: `merge` output, `schedule_gen.rules()`.
- Produces:
  - `schedule_gen.empty_history() -> dict`: `{"pairs": {}, "home_conf": {}, "pending": [], "years": []}`.
  - `schedule_gen.generate(year, teams, history, rng, rules_override: Optional[dict] = None)`: the conferences come from `{**rules()["conferences"], **(rules_override or {}).get("conferences", {})}`. Power status is unchanged. New conferences are never Power.
  - `league_file.schedule_rules(merged: dict) -> dict`: `{"conferences": {name: rule}}` for each new conference, and for each built-in one whose members or `games` changed.
    - A new conference's rule is `{"games": g, "cycle": 1 if n - 1 == g else 2, "home_split": "even", "protected": [], "finales": [], "non_conference": {"games": 12 - g, "power_road": [1, 2], "fcs_max": 1}}`.
    - A changed built-in rule keeps its fields. It drops `protected` and `finales` pairs whose teams are gone, `eight_game_team` when that team is gone, and `round_robin` when the count no longer allows it.
    - Same-conference `rivals` of added or changed teams are appended to `protected` (deduplicated, as `[a, b]` sorted).
  - `league_file.divisions(merged: dict) -> dict`: for each conference in `season.DIVISIONS` whose membership changed, the built-in divisions minus the removed teams, with each added member placed in the smaller division (ties go to the first division in alphabetical order). When a division would be empty, `{conf: {}}` (no divisions). The changed rule's `divisions` matches.
  - `season.divisions(state: dict) -> dict`: `{**DIVISIONS, **((state.get("league") or {}).get("divisions") or {})}`, minus conferences mapped to `{}`. `standings`, `_ccg_matchups` and `division_of(conference, slug, divs=None)` read it.
  - Cross-conference `rivals` are passed to the generator as `rules_override["annual"]`: `[{"teams": [a, b], "name": ""}]`. `_fixed_games` adds these after `series()["annual"]`.

- [ ] **Step 1: Write the failing tests** in `tests/test_league_schedule.py`:

```python
def test_new_conference_season():
    lgd, _ = league_fill.to_league(league_file.merge(TEN_TEAM_BIG_SKY_EAST), 1)
    teams = built_teams(lgd)                       # league.build, as Task 6
    games, hist = schedule_gen.generate(2026, teams, schedule_gen.empty_history(), random.Random("league-schedule-1"), lgd["schedule_rules"])
    count = Counter(s for g in games.values() for s in (g["home"], g["away"]) if not teams[s]["fictional"])
    assert set(count.values()) == {12}
    conf = [g for g in games.values() if teams[g["home"]]["conference"] == teams[g["away"]]["conference"] == "Big Sky East"]
    assert all(sum(1 for g in conf if s in (g["home"], g["away"])) == 8 for s in BIG_SKY_EAST)
    assert any({g["home"], g["away"]} == {"alder-tech", "oregon-state"} for g in games.values())   # listed rival, other conference
    assert all(g["home_display"] and "null" not in json.dumps(g) for g in games.values())

def test_sun_belt_add_rebalances_divisions():
    d = league_file.divisions(league_file.merge(file_adding_one_sun_belt_team))["Sun Belt"]
    assert sorted(len(v) for v in d.values()) == [7, 8]

def test_removed_team_drops_from_rules():
    r = league_file.schedule_rules(league_file.merge({"format": "cfp-league/1", "remove": ["kent-state"]}))
    assert all("kent-state" not in p for p in r["conferences"]["MAC"]["protected"])

def test_builtin_rules_unchanged():
    assert schedule_gen.generate(2027, T, H, random.Random(5))[0] == schedule_gen.generate(2027, T, H, random.Random(5), None)[0]
```

- [ ] **Step 2: Run** `python3 tests/test_league_schedule.py`. Expected: FAIL on `empty_history` missing.
- [ ] **Step 3: Implement** the Produces list. In `offseason.next_season`, call `schedule_gen.generate(year, teams, lgd.get("schedule_history"), _rng(state, "schedule"), lgd.get("schedule_rules"))`. In `league_fill.to_league`, store `schedule_rules(merged)` (with the `annual` list) and `divisions(merged)`.
- [ ] **Step 4: Run** `python3 tests/test_league_schedule.py`, `python3 tests/test_schedule_gen.py` and `python3 tests/test_sim_golden.py`. Expected: PASS, and golden byte-identical.
- [ ] **Step 5: Commit** with `git commit -m "Schedules for an imported league: new conferences, rivals, divisions"`.

### Task 8: Check and Start Career through the API; a full imported career

**Files:**
- Modify: `coach_career/league_file.py` (`check`), `sim/season.py` (`new_season`, `summary`), `app/api.py`, `tests/run_all.py` (`SLOW`), `docs/HOW_IT_WORKS.md` (new section after "Coach Career: the offseason and many seasons")
- Test: `tests/test_league_career.py`, `tests/test_api_dispatch.py` (routes listed)

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `league_file.check(blob: bytes, seed: Optional[int] = None) -> dict`. On error: `{"ok": False, "errors": [...]}`. When the import collapses: `{"ok": True, "builtin": True, "summary": {...}}`. Otherwise: `{"ok": True, "builtin": False, "league": lgd, "engine": built teams dict, "games": schedule or None, "summary": {"name", "added", "changed", "removed", "generated", "lines"}}`.
    - `games` is generated with `random.Random(f"league-schedule-{seed}")` and `schedule_gen.empty_history()` when `structural`.
    - A `ScheduleError` becomes the error "The 2026 schedule could not be built for this league: {reason}." Its reason never names an FCS stand-in: map stand-in slugs to "an FCS opponent" in the message.
    - `generated` is the number of players the fill made.
  - `season.new_season(..., league: Optional[dict] = None, career_id: Optional[str] = None, real_polls: bool = True)`. When `league` is given, the state gets `league` and `id = career_id` before `career_mod.new_career` runs. `real_polls=False` skips `_real_polls_2026` and `_real_ap_votes_2026`, so preseason comes from `_rating_poll`. Without the new arguments, behavior is identical.
  - `season.summary(state)["league"]`: `state["league"]["source"]["name"]` when imported, otherwise None.
  - `POST /api/league/check`: the body is the file's bytes. It returns `{"ok", "errors", "summary", "key", "teams": [_team_card(t) for FBS teams, sorted by name]}` and holds `_pending_league = {"key": sha256 hex of the blob, "seed", "lgd", "engine", "games", "real_polls": not structural}`. For a collapsed import, `key` is `"builtin"` and `teams` is the normal list.
  - `POST /api/season` accepts `league: Optional[str]`:
    - `"builtin"` or absent: today's path.
    - An unknown key: 409, "That league file is no longer loaded; import it again."
    - A valid key with a team that is not in the pending engine teams: 404.
    - When `seed` differs from the pending seed, re-run `check` with it.
    - Then: `cid = uuid4().hex[:12]`; write the pending engine to `league.path(cid, 2026)`; `season.use_league(that path)`; `recruiting.use_league_models(...)`; `season.new_season(team, "full", seed, coach, career=True, schedule=pending["games"], league=lgd, career_id=cid, real_polls=...)`. Clear `_pending_league` after a successful start.
  - `GET /api/season/{season_id}/teams` returns `{"teams": [_team_card(t) for t in season.load_teams().values()]}` after `_activate`.

- [ ] **Step 1: Write the failing test** in `tests/test_league_career.py` (slow; add it to `SLOW` in `tests/run_all.py`):

```python
if __name__ == "__main__":
    blob = league_file.dumps(ALDER_IN_NEW_TEN_TEAM_CONFERENCE)
    r = api_call("POST", "/api/league/check", body_bytes=blob)
    assert r["ok"] and not r["errors"] and any(t["slug"] == "alder-tech" for t in r["teams"]), r.get("errors")
    s = api_call("POST", "/api/season", {"team": "alder-tech", "mode": "full", "seed": 4, "league": r["key"]})
    st = season.load_season(s["id"])
    assert st["league"]["source"]["name"] == "My League" and s["league"] == "My League"
    assert sum(1 for g in st["games"].values() if "alder-tech" in (g["home"], g["away"])) == 12
    season.advance_to(st, 2)                                          # real games, weeks 1-2
    assert all(g["played"] for g in st["games"].values() if g["week"] <= 2)
    test_offseason.finished(st)                                       # the rest of the season, faked
    table = season.standings(st)
    assert "Big Sky East" in table and len(table["Big Sky East"]) == 10
    assert recruiting.fbs_schools(st).count("alder-tech") == 1
    assert recruiting.nil_budget(st, "alder-tech") >= recruiting.NIL_FLOOR
    offseason.start(st)
    while st["offseason"]["stage"] != "ready":
        offseason.advance(st)
    nxt = offseason.next_season(st)
    assert "alder-tech" in nxt["league"]["teams"] and nxt["year"] == 2027
    assert sum(1 for g in nxt["games"].values() if "alder-tech" in (g["home"], g["away"])) == 12
    text = json.dumps(api_call("GET", f"/api/season/{s['id']}"))
    for f in FCS_META:
        assert f["short_name"] not in text
    print("league career ok")
```

`api_call` calls `api.call_js` the way `tests/test_api_dispatch.py` does. Add to the same file: an unchanged export collapses (`r["key"] == "builtin"`), and a new season with it equals `season.new_season("smu", "full", seed=11, career=True)`'s games and polls. Add to `tests/test_api_dispatch.py`: the three new routes appear in `api.routes()`.

- [ ] **Step 2: Run** `python3 tests/test_league_career.py`. Expected: FAIL with 404 on `/api/league/check`.
- [ ] **Step 3: Implement** the Produces list. Write the HOW_IT_WORKS section: the format, merging, collapse, fill order and constants, the season-one schedule rule, where the league lives in the save, and the seeds.
- [ ] **Step 4: Run** `python3 tests/test_league_career.py`, `python3 tests/test_api_dispatch.py`, `python3 tests/test_career.py` and `python3 tests/test_sim_golden.py`. Expected: PASS, and golden byte-identical.
- [ ] **Step 5: Commit** with `git commit -m "Start a career from a league file"`.

### Task 9: The New Career screen: import, export, errors and summary

**Files:**
- Create: `web/leaguefile.js`
- Modify: `web/index.html` (League panel inside `#season-empty`, `<script src="./leaguefile.js">` before `season.js`), `web/season.js` (`loadTeams`, `newSeason`, `showSeason`), `web/styles.css`, `tests/test_copy_case.py` (`PAGES` += `"leaguefile.js"`)
- Test: `tests/test_league_file_ui.py`

**Interfaces:**
- Consumes: `POST /api/league/check`, `POST /api/season` `league`, `GET /api/season/{id}/teams`, `league.json` (relative), `window.CFP.game.fetch`, `window.CFP.ui` (`busy`, `morph`, `reconcile`, `toast`, `fadeIn`).
- Produces:
  - Markup:
    - `<section id="league-panel" class="panel league-panel">` with `<h2>League</h2>`;
    - `<select id="pick-league" aria-label="League">`, with options `League: Built-in` (value `builtin`) and `Import League File…` (value `import`);
    - `<button id="btn-export-league" class="ghost" type="button">Export League</button>`;
    - `<input id="league-file" type="file" accept=".json,application/json" hidden>`;
    - `<div id="league-result" aria-live="polite">`.
  - `window.LeagueFile = { key(): string, teams(): Array|null, onChange(fn) }`. `key()` returns `"builtin"` until a checked import succeeds.
  - Choosing `Import League File…` opens the picker. A file over 64 MB is refused before it is read, with the same sentence Python uses, as a toast: "The file is 80.0 MB; the game reads league files up to 64 MB." Otherwise the file's bytes are posted with `Content-Type: application/json`.
    - On errors, `#league-result` shows `<ul class="league-errors">` with one `<li>` per sentence, and the select returns to `builtin`.
    - On success: four stat chips (`Teams Added`, `Teams Changed`, `Teams Removed`, `Players Generated`), then the summary lines as `<p>`, then `<button class="accent" id="btn-league-start">Start Career</button>`. The select gains and selects an option `League: {name}` (value `file`).
    - All of this is patched with `ui.morph`, not a page redraw.
  - Start Career calls the existing `chooseCoach("full")`. `#pick-team` is reconciled to the import's teams in place (`ui.reconcile` keyed by slug), and their cards are merged into `window.CFP.teamsBySlug`.
  - `newSeason` posts `league: window.LeagueFile.key()`.
  - `showSeason`, on opening a season whose summary has `league`, fetches `/api/season/{id}/teams` and merges the cards into `window.CFP.teamsBySlug` before drawing. This is allowed because opening a season is a career change.
  - Export League fetches `league.json` and downloads it as `league.json` (Blob, `a.download`), busy while it runs.
  - Controls `#pick-league`, `#btn-export-league` and `#btn-league-start` have `min-height: 44px` at phone width. At 400 px the panel stacks, with no sideways scroll.

- [ ] **Step 1: Write the failing browser test** `tests/test_league_file_ui.py`. Follow `tests/test_scouting_layout.py`'s pattern: `launch`, the dev server from `test_career_e2e`, and skipped without Playwright. For each of 1280×900 and 400×860:

```python
page.set_input_files("#league-file", BAD_FILE)     # bad position + depth-chart typo + remove-and-list
page.wait_for_selector("#league-result .league-errors li")
errs = page.eval_on_selector_all("#league-result .league-errors li", "els => els.map(e => e.textContent)")
assert "Alder Tech, player 1 (Jay Smith): position 'WRR' is not a position." in errs
assert all(e[0].isupper() and e.endswith(".") for e in errs)
assert page.input_value("#pick-league") == "builtin"
page.set_input_files("#league-file", GOOD_FILE)    # Alder Tech in a new ten-team conference, Kent State removed
page.wait_for_selector("#btn-league-start")
chips = page.eval_on_selector_all("#league-result .go-chip", "els => els.map(e => e.textContent.trim())")
assert chips[0].startswith("Teams Added") and "Players Generated" in chips[3]
assert page.eval_on_selector("#pick-team", "s => [...s.options].some(o => o.value === 'alder-tech')")
assert page.evaluate("() => document.documentElement.scrollWidth <= document.documentElement.clientWidth")
body = page.inner_text("body")
assert not re.search(r"\b(null|undefined|NaN)\b", body) and not any(f in body for f in FCS_NAMES)
if width == 400:
    for sel in ("#pick-league", "#btn-export-league", "#btn-league-start"):
        assert page.eval_on_selector(sel, "e => e.getBoundingClientRect().height") >= 44, sel
# font-robust: boxes against each other, never pixel widths
assert page.evaluate("() => { const p = document.querySelector('#league-panel').getBoundingClientRect(); return [...document.querySelectorAll('#league-panel button, #league-panel select')].every(e => { const r = e.getBoundingClientRect(); return r.left >= p.left - 1 && r.right <= p.right + 1; }); }")
page.screenshot(path=str(SHOTS / f"league-{width}.png"))
```

Then the export:

```python
with page.expect_download() as d:
    page.click("#btn-export-league")
dl = d.value
assert dl.suggested_filename == "league.json"
doc = json.loads(Path(dl.path()).read_text(encoding="utf-8"))
assert doc["format"] == "cfp-league/1" and len(doc["teams"]) == 138
```

Then Start Career, then "Start As …" in the coach modal. The season opens with Alder Tech's name in the header, and `window.CFP.teamsBySlug['alder-tech'].name === 'Alder Tech'`. Also check that a 65 MB file shows the toast and never posts: watch `page.on("request")` for `/api/league/check`, or the worker message.

- [ ] **Step 2: Run** `python3 tests/test_league_file_ui.py`. Expected: FAIL on the missing `#league-file`.
- [ ] **Step 3: Implement** `web/leaguefile.js`, the markup, the `season.js` hooks and the styles as listed.
- [ ] **Step 4: Run** `python3 tests/test_league_file_ui.py`, `python3 tests/test_copy_case.py`, `python3 tests/test_spacing.py`, `python3 tests/test_ux_sweep.py` and then `python3 tests/run_all.py`. Expected: all PASS. Golden is unchanged. Look at the scratchpad screenshots for both widths.
- [ ] **Step 5: Commit** with `git commit -m "New Career screen: import and export a league file"`, then push the branch.

---

### Task 10: Every reader of team data uses the career's league

**Files:**
- Modify: every server route and engine reader that loads teams and does not yet read the career's league. Audit at least `sim/season.py` (`load_teams`, `TEAMS_FILE`, standings, rankings, stats, `team_display`), `app/api.py` (`/api/teams`, `/api/teams/{slug}`, programs, standings, rankings, stats, Office, the coach market, recruiting, offseason routes), `coach_career/*` (`base_meta` callers: `offseason.py`, `persona.py`, `carousel.py`, `office.py`, `programs.py`, `career.py`, `recruiting.py`, `prospects.py`, `scenes.py`, `position_fit.py`), `sim/form.py`, `sim/realdata.py`, `sim/news.py`, and the `web/` code that reads team cards or colors.
- Test: `tests/test_league_readers.py` (Python audit) and `tests/test_league_tabs_e2e.py` (browser).

**Interfaces:**
- Consumes: `league.team_meta(lgd, slug)`, `league.league_slugs(lgd)`, `league.is_imported(state)`, `GET /api/season/{season_id}/teams`, `season.team_display`, the Task 8 imported career fixture (Alder Tech in a new ten-team conference, Kent State removed).
- Produces: no new public API. Every reader that resolves a team's name, colors, conference, logo, program, roster or recruiting model resolves it through the career's league when the career has one (`state["league"]`), and through the built-in files only when it does not. A reader never raises for a slug that the career's league holds but the built-in data lacks.

- [ ] **Step 1: Write the audit.** `grep -rn "load_teams\|engine_teams.json\|base_meta\|TEAMS_FILE" app coach_career sim web` and list every hit in the task report with its verdict (already league-aware, fixed here, or built-in by design with the reason).
- [ ] **Step 2: Write the failing Python test** `tests/test_league_readers.py`. Start a career from the imported fixture with seed 7. Call every team-reading API route for Alder Tech and its conference, during the season, at an offseason stage and after `next_season`: team page, roster, schedule, standings, rankings, stats, programs, Office, coach market, recruiting board and pulls. Assert each returns 200, names "Alder Tech", carries its colors and its conference name, and that no response body contains "null", "undefined", "NaN", Kent State, or any FCS stand-in name (read the names from `league.base_meta(s)["fictional"]`, never hardcoded).
- [ ] **Step 3: Run it.** Expected: FAIL on at least one reader.
- [ ] **Step 4: Fix each reader** found in Step 1 to read the career's league. Keep the built-in path untouched when the career has no `league`.
- [ ] **Step 5: Write the browser test** `tests/test_league_tabs_e2e.py`, in the pattern of `tests/test_career_e2e.py` and `tests/test_ux_sweep.py`, skipped without Playwright. Import the fixture through the New Career screen, start a career as Alder Tech, then click through every tab (and every offseason stage reachable by advancing) at 1280x900 and 400x860. On each tab assert: no console error and no failed request; "Alder Tech" appears where the coached team is shown; its conference name appears on Standings; no "null", "undefined" or "NaN" in the body; no FCS stand-in name; no horizontal scroll. Rerun it with the wide-font `FONTCONFIG_FILE` to check it is font-robust.
- [ ] **Step 6: Run** `python3 tests/test_league_readers.py`, `python3 tests/test_league_tabs_e2e.py`, `python3 tests/test_sim_golden.py` (byte-identical) and `python3 tests/run_all.py`. Add both new tests to `tests/run_all.py` (`test_league_tabs_e2e.py` in `SLOW`).
- [ ] **Step 7: Commit** with the message "Every team reader uses the career's league", then push the branch.

---

## Self-Review Notes

- **Spec coverage:**
  - Format: Tasks 1 and 2. Merging: Task 3. Required fields and defaults: Tasks 2 and 5.
  - Filling a roster (steps 1 to 5): Task 4. Seeded stream: Tasks 4 and 5.
  - New Career screen, the check, the summary and Export: Tasks 8 and 9.
  - Season-one schedule: Tasks 7 and 8. The save and league.py from season one: Task 6.
  - Program history, AD goals, recruiting pulls, coach market and NIL for a new team: Tasks 5 and 6, proven in Task 8.
  - House rules: Global Constraints. Every Testing bullet in the spec maps to a test above.
- **Types:**
  - `to_league(merged, seed) -> (lgd, lines)` is used in Tasks 5 to 8.
  - `check(blob, seed) -> dict` is used in Task 8.
  - `team_meta(lgd, slug)` is defined in Task 4, because the nudge builds new teams. `league_slugs(lgd)` is defined in Task 6.
  - `schedule_rules`, `divisions` and `empty_history` are defined in Task 7.
- **Proportion:** the plan carries signatures, values and assertions. It contains no bodies, except the starter-level formula that the tests do not determine.
