# Task 7 Report: Schedules for a Merged League

Status: DONE

Commits on `league-file`:
- 50c941a, "WIP: Task 7, schedules for a merged league (in progress)". The coordinator committed this one. It holds all the code and tests below.
- A follow-up commit adds this report.

## Files
- `sim/schedule_gen.py`
  - Adds `empty_history()`.
  - `generate(..., rules_override=None)`: conferences come from `{**rules()["conferences"], **override["conferences"]}`, and `override["annual"]` runs after `series()["annual"]` in `_fixed_games`.
  - `_nonconference` reads the merged conferences.
  - Power status still comes from `rules()["power"]` only.
  - New `_balance_divisions`: when two divisions can't give every team the same number of cross-division games, the larger side gives some up. Equal divisions, which covers every built-in one, are untouched and it draws no random numbers.
- `coach_career/league_file.py`
  - `divisions(merged)` and `schedule_rules(merged)`, which returns `{"conferences", "annual"}`.
  - Helpers `_new_rule`, `_trimmed_rule` and `_protect_fits`.
  - Two `*tune*` constants: `NEW_CONFERENCE_POWER_ROAD` and `NEW_CONFERENCE_FCS_MAX`.
- `sim/season.py`
  - `divisions(state)`, and `division_of(conference, slug, divs=None)`.
  - `standings` and `_ccg_matchups` now read `divisions(state)`.
- `coach_career/league_fill.py`: `to_league` stores `lgd["schedule_rules"]` and `lgd["divisions"]`.
- `coach_career/offseason.py`: `next_season` passes `lgd.get("schedule_rules")` to `generate`.
- `tests/test_league_schedule.py`: 14 tests.

## Behavior
- **New conference.** It gets the brief's rule verbatim. It is never Power.
- **Changed built-in conference** (members, games or name changed):
  - Drops `protected`, `finales` and `neutral` pairs whose teams are gone, and `eight_game_team` years whose team is gone.
  - Drops `round_robin` unless n-1 == games.
  - Drops `games_from` entries above n-1. If the file changed the games, `games_from` goes entirely and `non_conference.games` becomes 12 - games.
  - Its divisions are `divisions()`'s, with `cross_division` recomputed. When there are no divisions, both keys are removed.
- **Divisions.**
  - Teams that are gone (removed, or moved to another conference) leave their division.
  - Each added member joins the smaller division; a tie goes to the first alphabetically.
  - The result is `{}` when a division would be empty, or when a division is too big for the conference's games.
- **Rivals.**
  - Rivals listed by added teams, or by changed teams whose `rivals` differ from the built-in list, are used.
  - A same-conference rival becomes a protected pair (sorted, deduplicated) when the conference has league games and the pair fits.
  - Any other rival becomes an `annual` entry, skipping pairs that are already built-in annual series.
  - A built-in conference that gains a protected pair is included in the rules.

## Tests
- `python3 tests/test_league_schedule.py`: ok, all 14 pass.
- `python3 tests/test_schedule_gen.py`: "schedule gen ok: 2027-2032 generated, 138 teams x 12 games each year, every rule held; a career rolled into 2027 and played week 1".
- `python3 tests/test_league_file.py`: ok.
- `python3 tests/test_league_fill.py`: ok.
- `python3 tests/test_offseason.py`: ok.
- `python3 tests/test_sim_golden.py`: "sim golden ok: 99 games, every stat line and the recruiting week identical to the golden file".
- **Built-in output unchanged.** `test_builtin_rules_unchanged` checks SHA-256 digests of 2027 and 2028 (seed 5), recorded before the change.
- **Review Focus.** `test_every_width_validate_passes_schedules` covers sizes that `validate` passes, including n = games + 1 and odd n×games.
- **Stress run** (scratchpad script, not committed): 137 combinations, each run with 3 seeds for 2026 then 2027, all passed.
  - New conferences of 2 to 15 teams at 0 to 11 games.
  - The Sun Belt plus 1 to 4 teams at 5 to 11 games.
  - Same-conference and cross-conference rivals in both.
  - The combinations validate rejects (games above n-1) were skipped.
- The full `run_all.py` was not run.

## Self-review and Concerns
- **Brief's null check.** The brief's `"null" not in json.dumps(g)` can never pass, because an unplayed game always has `home_score: None`. The test checks the game's non-None fields for "null", "None", "undefined" and "NaN" instead.
- **Rivals of changed teams.** Only rivals of added teams, and of changed teams whose list differs from the built-in one, count. Otherwise a roster-only edit would turn the team's built-in rivals (for example Michigan and Minnesota) into new protected pairs.
- **Uneven divisions.** With divisions of different sizes (Sun Belt 8/7 at 8 games), some teams on the larger-demand side play one fewer conference game and fill that slot outside the conference. Every team still plays 12.
- **Power by name.** Power status is still matched by conference name. A new conference given exactly a Power conference's name would count as Power. `validate` doesn't block duplicate names.
- **Stand-ins.** No stand-in slug or name appears anywhere in this code or its tests. Stand-ins are read only through the teams' `fictional` flag.
- **Cleanup.** The generated test files under `data/seasons` and `data/leagues` were removed.
