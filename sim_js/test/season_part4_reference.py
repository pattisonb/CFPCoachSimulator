"""sim/season.py lines 2736-3448 (sim_js/season/part4.js): real inputs and Python's answers, as JSON, for
season_part4_compare.mjs. Run: python3 sim_js/test/season_part4_reference.py <out.json>   (it plays twelve weeks)."""
import copy
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
os.environ.setdefault("CFP_SEASONS_DIR", tempfile.mkdtemp())
from sim import season, schedule_gen
from coach_career import programs, league


def tables(state):
    """What the part asks the rest of the season file and the modules not ported yet, as plain tables."""
    teams = season.load_teams()
    weeks = range(0, 21)
    return {
        "teams": {s: {"name": t["name"], "conference": t["conference"], "fictional": t["fictional"]} for s, t in teams.items()},
        "fcs_label": {s: season.fcs_label(s) for s, t in teams.items() if t.get("fictional")},
        "records": {str(w): season._records(state, w) for w in weeks},
        "records_none": season._records(state),
        "records_playoff": season._records(state, include_playoff=True),
        "has_box": {eid: season.has_box(state, g) for eid, g in state["games"].items()},
        "unit_overalls": {s: season._unit_overalls(state, s) for s in teams},
        "attract": {s: programs.attract(state, s) for s in teams},
        "program": {s: {"tier": programs.get(state, s)["tier"], "rating": programs.get(state, s)["rating"]} for s in teams},
        "TIER_NAMES": programs.TIER_NAMES, "FINALE_WEEK": schedule_gen.FINALE_WEEK, "base_slugs": list(league.base_slugs()),
        "LAST_REGULAR_WEEK": season.LAST_REGULAR_WEEK, "POSTSEASON_DATES": season.POSTSEASON_DATES,
        "NO_ARTICLE_TROPHIES": list(season.NO_ARTICLE_TROPHIES),
    }


def err(fn):
    try:
        return {"ok": fn()}
    except season.ScheduleError as e:
        return {"error": [e.code, str(e)]}


def schedule_cases(state):
    st = copy.deepcopy(state)
    st["career"] = {"x": 1}                      # the trades are a career's: only the flag is read here
    out = {"state": copy.deepcopy(st), "editable": season.schedule_editable(st), "options": {}, "swaps": [], "moves": season.schedule_moves(st), "move": []}
    for g in out["editable"]:
        opts = season.schedule_options(st, g["event_id"])
        out["options"][g["event_id"]] = opts
        for o in opts[:3] + [x for x in opts if not x["accepts"]][:1]:
            s2 = copy.deepcopy(st)
            out["swaps"].append({"event_id": g["event_id"], "slug": o["slug"], "result": err(lambda: season.schedule_swap(s2, g["event_id"], o["slug"])),
                                 "games": s2["games"], "changes": s2.get("schedule_changes")})
    for eid, rows in out["moves"].items():
        for r in rows[:2] + [x for x in rows if x["swap"]][:1]:
            s2 = copy.deepcopy(st)
            out["move"].append({"event_id": eid, "week": r["week"], "result": err(lambda: season.schedule_move(s2, eid, r["week"])), "games": s2["games"]})
        s2 = copy.deepcopy(st)
        out["move"].append({"event_id": eid, "week": 14, "result": err(lambda: season.schedule_move(s2, eid, 14)), "games": s2["games"]})
    out["bad_option"] = err(lambda: season.schedule_options(st, "nope"))
    return out


def views(state, slugs, confs):
    teams = season.load_teams()
    out = {"rank_map": {str(w): season.rank_map(state, w) for w in range(-1, 21)},
           "resume": season.resume(state), "resume_w": {str(w): season.resume(state, w) for w in (0, 3, 7, 99)},
           "resume_team": {s: season.resume(state, None, s) for s in slugs}, "resume_team_w": {s: season.resume(state, 4, s) for s in slugs},
           "current_rank": season.current_rank(state), "week_view": {str(w): season.week_view(state, w) for w in range(1, 21)},
           "team_stats_view": season.team_stats_view(state), "week_dates": {str(k): v for k, v in season.week_dates(state).items()},
           "week_dates_order": [k for k in season.week_dates(state)],
           "player_stats": {}, "player_leaders": {}, "rivalries_view": {s: season.rivalries_view(state, s) for s in slugs},
           "team_schedule": {s: season.team_schedule(state, s) for s in slugs},
           "game_rivalry": {eid: [season.game_rivalry(state, g), season.game_rivalry(state, g, after=True)] for eid, g in state["games"].items()},
           "fcs_picker_names": season._fcs_picker_names(teams),
           "rivalry_series": [[r["teams"], w, season.rivalry_series(state, r, w)] for k, r in season.load_rivalries().items() if isinstance(k, frozenset) for w in (None, 1, 9)],
           "fresh": [season.rivalry_series(state, {"teams": ["michigan", "ohio-state"], "name": "M vs. O", "trophy": "", "series": {}}, w)["text"] for w in (None, 1)]}
    for cat in season.PLAYER_CATEGORIES:
        out["player_stats"][cat] = {"league": season.player_stats_view(state, None, cat), "limit7": season.player_stats_view(state, None, cat, 7),
                                    **{f"team:{s}": season.player_stats_view(state, s, cat) for s in slugs},
                                    **{f"conf:{c}": season.player_stats_view(state, None, cat, 40, c) for c in confs}}
    out["player_leaders"] = {"league": season.player_leaders_view(state), "n3": season.player_leaders_view(state, None, 3),
                             **{f"team:{s}": season.player_leaders_view(state, s) for s in slugs},
                             **{f"conf:{c}": season.player_leaders_view(state, None, 5, c) for c in confs}}
    # the season's stats rebuilt from the kept box scores: _accumulate_stats and _add_into on real game lines
    # (the boxes in the order a JavaScript object lists them: all-digit event ids first, by number; Python's own order
    # is the order they were played, which a parsed save cannot give back there)
    ids = sorted((k for k in state["my_boxes"] if k.isdigit()), key=int) + [k for k in state["my_boxes"] if not k.isdigit()]
    s2 = {"my_boxes": {k: state["my_boxes"][k] for k in ids}, "games": state["games"]}
    season._season_stats(s2)
    out["rebuilt"] = {"season_stats": s2["season_stats"], "partial": s2["season_stats_partial"],
                      "personnel_order": {t: list(v.get("personnel", {})) for t, v in s2["season_stats"].items()}}
    return out


if __name__ == "__main__":
    slugs, confs = ["michigan", "ohio-state", "army", "boise-state"], ["SEC", "MAC"]
    st = season.new_season("michigan", "full", seed=11)
    cases = []
    cases.append({"name": "week 0", "tables": tables(st), "state": copy.deepcopy(st), "views": views(st, slugs, confs), "schedule": schedule_cases(st)})
    for target in (5, 12):
        season.advance_to(st, target)
        cases.append({"name": f"week {target}", "tables": tables(st), "state": copy.deepcopy(st), "views": views(st, slugs, confs)})
    Path(sys.argv[1]).write_text(json.dumps({"cases": cases}), encoding="utf-8")
    print("written", sys.argv[1])
