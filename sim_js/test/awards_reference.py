"""Python's answers for sim_js/awards.js, written as JSON for awards_compare.mjs to hold the JavaScript to:

    python3 sim_js/test/awards_reference.py out.json && node sim_js/test/awards_compare.mjs out.json

Two seeded careers are played with the real game (season A to the title game, season B to mid-season). Every call the
season and the Awards page make into sim/awards.py (Pool, conference_awards, national_awards, postseason_awards,
race_view, my_awards) is recorded with its arguments as they were at the call and what it returned. On some of them
(SPEC["battery"]) every function of the module is then run on the same arguments, read back from JSON as the
JavaScript reads them, and those answers are written too.

The teams are written with what awards.py reads of them and nothing else (a player's name, position, role, class and
two blocking ratings: the full file is 21 MB a copy); the script checks that Python gives the recorded answer from the
trimmed, read-back arguments before it writes them (out["python_checks"]).

REF_QUICK=1 plays four weeks of one season (for trying the pair out).
"""
import hashlib
import json
import os
import random
import sys
from pathlib import Path

os.environ["SIM_WORKERS"] = "1"
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from sim import awards, season    # noqa: E402

QUICK = bool(os.environ.get("REF_QUICK"))
STATE_KEYS = ["id", "seed", "year", "team", "current_week", "polls", "season_stats", "champions", "bracket", "champion"]
TEAM_KEYS = ["name", "conference", "fictional", "state", "team_ratings", "coaches"]
PLAYER_KEYS = ["name", "position", "role", "class", "run_blocking", "pass_blocking"]
GROUPS = ["QB", "RB", "WR", "TE", "EDGE", "DT", "LB", "DB", "OL", "K", "P", "RS"]
KINDS = ["mvp", "mvp_team", "opoy", "versatile", "freshman", "off_freshman", "dpoy", "dpoy_alt", "def_freshman", "qb", "rb", "wr",
         "te", "lb", "db", "k", "p", "rs", "qb_upper", "edge", "dl", "ol", "blocker", "c", "interior", "front", "stpoy", "nope"]
SLOTS = ["QB", "RB", "WR", "TE", "K", "P", "LB", "DB", "EDGE", "DT", "OL", "RS", "C", "G", "T", "CB", "S", "DL", "AP", "ZZ"]
SPEC = {
    "groups": GROUPS, "kinds": KINDS, "slots": SLOTS,
    # by_group's conditions (roles and classes are sets there)
    "conds": [{}, {"conference": "SEC"}, {"conference": "MAC"}, {"classes": sorted(awards.FRESHMAN)},
              {"classes": sorted(awards.UPPERCLASS), "conference": "Big Ten"}, {"roles": ["C"]}, {"roles": ["FS", "SS"]},
              {"unit": "offense"}, {"unit": "defense"}, {"unit": "defense", "conference": "Sun Belt", "roles": ["LEDG", "REDG", "CB"]}],
    "confs": [None, "ACC", "Sun Belt", "Big 12"],
    "race": [[c, n, noise] for c in (None, "Big 12", "Mountain West") for n, noise in ((5, 0.0), (5, 0.2), (40, 0.15))],
    "heisman": [[12, False], [12, True], [6, True], [30, False]],
    "coach_weights": [[ww, sw] for _, ww, sw in awards.COACH_AWARDS] + [[0.5, 1.0], [0.6, 0.6]],
    "all_conference": list(awards.CONF_LAYOUTS) + ["FBS Independent"],
    "line_step": 5,
}

calls: list = []          # every recorded call, in the order the game made them
teams_seen: dict = {}     # hash -> trimmed teams
depth = 0


def norm(v):
    """A value as the JSON file holds it."""
    return json.loads(json.dumps(v))


def trim_teams(teams: dict) -> str:
    out = {}
    for slug, t in teams.items():
        row = {k: t[k] for k in TEAM_KEYS if k in t}
        for unit in ("offense", "defense"):
            row[unit] = [{k: p[k] for k in PLAYER_KEYS if k in p} for p in t[unit]]
        out[slug] = row
    text = json.dumps(out)
    h = hashlib.sha1(text.encode()).hexdigest()[:12]
    teams_seen.setdefault(h, json.loads(text))
    return h


def snap(state: dict, teams: dict, records: dict, through_week) -> dict:
    return {"state": norm({k: state[k] for k in STATE_KEYS if k in state}), "teams": trim_teams(teams),
            "records": norm(records), "through_week": through_week}


# ----- recording the game's own calls -------------------------------------------------------

_init = awards.Pool.__init__


def _pool_init(self, state, teams, records, through_week=None):
    self._through_week_arg = through_week
    _init(self, state, teams, records, through_week)


awards.Pool.__init__ = _pool_init


def _record(fn_name: str, takes_pool: bool):
    real = getattr(awards, fn_name)

    def wrapped(*args, **kwargs):
        global depth
        if depth:
            return real(*args, **kwargs)
        if takes_pool:
            pool, state = args[0], args[1]
            inputs = snap(pool.state, pool.teams, pool.records, pool._through_week_arg)
            assert state is pool.state
            extra = {"final": kwargs.get("final", args[2] if len(args) > 2 else True)} if fn_name != "postseason_awards" else {}
        elif fn_name == "race_view":
            inputs = snap(args[0], args[1], args[2], None)
            extra = {}
        else:    # my_awards(state, awards)
            inputs = {"state": {"team": args[0]["team"]}, "awards": norm(args[1])}
            extra = {}
        depth += 1
        try:
            result = real(*args, **kwargs)
        finally:
            depth -= 1
        calls.append({"fn": fn_name, "label": f"{label} week {args[1 if takes_pool else 0].get('current_week')}", **inputs, **extra,
                      "result": norm(result)})
        return result

    setattr(awards, fn_name, wrapped)
    return real


label = ""
REAL = {name: _record(name, pool) for name, pool in (("conference_awards", True), ("national_awards", True),
                                                      ("postseason_awards", True), ("race_view", False), ("my_awards", False))}


def play(team: str, seed: int, last_week: int, pages: set) -> None:
    """A career's first season to `last_week`, the Awards page opened after the weeks in `pages` and every award step."""
    global label
    label = f"{team} seed {seed}"
    state = season.new_season(team, "full", seed=seed, career=True)
    season._race_cache.clear()
    while state["current_week"] < last_week and not state["done"]:
        before = len(calls)
        season.advance_to(state, state["current_week"] + 1)
        stepped = len(calls) > before
        if state["current_week"] in pages or stepped:
            season.awards_view(state)
        print(f"  {label}: week {state['current_week']}, {len(calls)} calls recorded", file=sys.stderr)


# ----- every function, on one recorded call's arguments ---------------------------------------


def keys_of(players: list) -> list:
    return [p["key"] for p in players]


def as_cond(c: dict) -> dict:
    return {k: (set(v) if k in ("roles", "classes") else v) for k, v in c.items()}


def battery(case: dict, tag: str) -> dict:
    state, teams, records = norm(case["state"]), norm(teams_seen[case["teams"]]), norm(case["records"])
    A = awards
    pool = A.Pool(state, teams, records, case["through_week"])
    b: dict = {}
    b["pool"] = {"week": pool.week, "ranks": pool.ranks, "params": pool.params, "n": len(pool.players),
                 "players": [[p["key"], p["name"], p["position"], p["role"], p["group"], p["class"], p["team"], p["team_name"],
                              p["conference"], p["games"], p["team_games"], p["raw"], p["z"], p["zb"]] for p in pool.players]}
    b["rank_of"] = {s: pool.rank_of(s) for s in teams}
    b["team_term"] = {s: pool.team_term(s) for s in teams if s in records}
    b["heisman_score"] = [pool.heisman_score(p) for p in pool.players]
    b["played_enough"] = [[pool.played_enough(p), pool.played_enough(p, 0.4)] for p in pool.players]
    b["passer_rating"] = [A.passer_rating(p["stats"]) for p in pool.players]
    b["cards"] = [pool.card(p) for p in pool.players]
    b["cards_rs"] = [pool.card(p, "RS") for p in pool.players if "RS" in p["z"]]
    b["lines"] = [[[A.headline(p, g), A.stat_line(p, g)] for g in GROUPS + ["XX"]] for p in pool.players[::SPEC["line_step"]]]
    b["by_group"] = [[keys_of(pool.by_group(g, **as_cond(c))) for c in SPEC["conds"]] for g in GROUPS + ["XX"]]
    b["candidates"] = [[[[keys_of(ps), g] for ps, g in A._candidates(pool, kind, conf)] for conf in SPEC["confs"]] for kind in KINDS]
    b["award_race"] = [[A.award_race(pool, kind, 0.1 + 0.07 * i, random.Random(f"{tag}|race|{kind}|{j}"), conference=conf, n=n, noise=noise)
                        for j, (conf, n, noise) in enumerate(SPEC["race"])] for i, kind in enumerate(KINDS)]
    b["award_race_defaults"] = A.award_race(pool, "mvp", 0.9, random.Random(f"{tag}|race"))
    b["heisman_vote"] = [A.heisman_vote(pool, random.Random(f"{tag}|heisman|{j}"), n_candidates=n, straw=straw)
                         for j, (n, straw) in enumerate(SPEC["heisman"])]
    b["heisman_vote_defaults"] = A.heisman_vote(pool, random.Random(f"{tag}|heisman"))
    table = A.coach_table(pool)
    b["coach_table"] = [table, A.coach_table(pool, include_playoff=True)]
    b["coach_award"] = [[A.coach_award(table, ww, sw, random.Random(f"{tag}|coach|{j}|{title}"), title=title) for title in (False, True)]
                        for j, (ww, sw) in enumerate(SPEC["coach_weights"])]
    b["coach_award_conference"] = [A.coach_award([c for c in table if c["conference"] == conf], 0.5, 1.0, random.Random(f"{tag}|coach|{conf}"))
                                   for conf in A.CONF_AWARDS]
    b["broyles_table"] = A.broyles_table(pool)
    b["ol_units"] = A.ol_units(pool)
    b["slot_pool"] = [[[keys_of(ps), g] for ps, g in [A._slot_pool(pool, slot, conf)]][0] for slot in SLOTS for conf in SPEC["confs"]]
    b["select_team"] = [A.select_team(pool, A.AA_SLOTS, tw, noise, random.Random(f"{tag}|team|{name}"), levels=2)
                        for name, (tw, noise) in A.SELECTORS.items()]
    b["select_team_defaults"] = A.select_team(pool, A.AA_SLOTS, 0.3, 0.4, random.Random(f"{tag}|team"))
    b["all_america"] = A.all_america(pool, random.Random(f"{tag}|aa"))
    b["all_conference"] = [A.all_conference(pool, conf, random.Random(f"{tag}|ac|{conf}")) for conf in SPEC["all_conference"]]
    conference = [REAL["conference_awards"](pool, state), REAL["conference_awards"](pool, state, final=False)]
    national = [REAL["national_awards"](pool, state), REAL["national_awards"](pool, state, final=False)]
    postseason = REAL["postseason_awards"](pool, state)
    b["conference_awards"], b["national_awards"], b["postseason_awards"] = conference, national, postseason
    b["race_view"] = REAL["race_view"](state, teams, records)
    # my_awards for the teams with the most to show, on what the season keeps (read back from a save) and on less
    kept = norm({"conference": conference[0], "national": national[0], "postseason": postseason, "given_through": 20})
    mine_teams = [state["team"]] + [c["team"] for c in kept["national"]["heisman"]["candidates"]]
    mine_teams += [a["winner"]["team"] for a in kept["postseason"]["awards"] + kept["national"]["coach_awards"] if a["winner"]]
    mine_teams = list(dict.fromkeys(mine_teams))[:14]
    shapes = [kept, {"conference": kept["conference"]}, {"national": norm(national[1])}, {"postseason": kept["postseason"], "national": None}, {}]
    b["my_awards"] = [[t, [REAL["my_awards"]({"team": t}, shape) for shape in shapes]] for t in mine_teams]
    b["my_awards_shapes"] = shapes[1:]     # (the first is built by the JavaScript from its own answers)
    live = {"conference": conference[0], "national": national[0], "postseason": postseason}      # as the season holds it before a save
    assert all(REAL["my_awards"]({"team": t}, live) == rows[0] for t, rows in b["my_awards"]), "my_awards differs after a save"
    return norm(b)


def small(rng: random.Random) -> dict:
    """The helpers that need no season."""
    A = awards
    lists = [[], [3.5], [1, 2], [4.0, 4.0, 4.0], [1, 2, 3], [0.1, 0.2, 0.3, 0.7]]
    lists += [[round(rng.gauss(10, 25), rng.choice([1, 2, 6])) for _ in range(rng.randint(3, 90))] for _ in range(300)]
    lists += [[rng.gauss(0, 1) for _ in range(rng.randint(3, 400))] for _ in range(200)]
    counts = [0, 1, 1.0, 2, 2.5, 0.5, 1.5, 10, 12.0, 100, 1234, 123456, 1234567, 0.00001, 7.25, 33.5, 1e21]
    positions = ["QB", "RB", "WR", "TE", "OL", "K", "P", "DL", "MLB", "ROLB", "LOLB", "OLB", "CB", "S", "ATH", "FB", "LS"]
    roles = [None, "LEDG", "REDG", "DT", "C", "CB", "FS"]
    stats = []
    for _ in range(400):
        att = rng.choice([0, 0, 1, 12, 59, 60, 61, 240, 410])
        stats.append({"pass_attempts": att, "completions": rng.randint(0, att), "pass_yards": rng.randint(-5, 4200),
                      "passing_touchdowns": rng.randint(0, 45), "interceptions_thrown": rng.randint(0, 18)})
    stats += [{}, {"pass_attempts": 3}, {"pass_yards": 100}]
    states = [{"seed": 11, "id": "abc", "year": 2026}, {"seed": None, "id": "35ca2889c2ad", "year": 2031}, {"id": "x1", "year": None},
              {"seed": 0, "id": "zz"}, {"seed": 4000000007, "id": "q", "year": 0}]
    races = [[], [{"a": 1}], [{"a": 1}, {"a": 2}, {"a": 3}, {"a": 4}]]
    return {
        "lists": lists, "_z": [A._z(v) for v in lists],
        "_ordinal": [A._ordinal(n) for n in range(0, 130)],
        "ranks": [None] + list(range(1, 40)), "_rank_bonus": [A._rank_bonus(r) for r in [None] + list(range(1, 40))],
        "counts": counts, "_n": [[A._n(v, "sack"), A._n(v, "key block")] for v in counts],
        "positions": positions, "roles": roles, "_group": [[A.Pool._group(pos, role, {}) for role in roles] for pos in positions],
        "stats": stats, "passer_rating": [A.passer_rating(st) for st in stats],
        "states": states, "_rng": [[A._rng(st, salt).gauss(0, 1) for salt in ("conference", "national", "postseason")] for st in states],
        "races": races, "_podium": [A._podium(r) for r in races],
        "tables": {name: json.loads(json.dumps(getattr(A, name), default=sorted)) for name in
                   ("G5", "FRESHMAN", "UPPERCLASS", "EDGE_ROLES", "LB_POSITIONS", "DB_POSITIONS", "REGIONS", "POSITION_PRIOR",
                    "STARTERS_PER_TEAM", "SELECTORS", "AA_SLOTS", "CONF_LAYOUTS", "_OPOY", "_DPOY", "_ST", "_COY", "CONF_AWARDS",
                    "NATIONAL_AWARDS", "COACH_AWARDS")},
        "table_pairs": {name: [[k, json.loads(json.dumps(v, default=sorted))] for k, v in getattr(A, name).items()]      # the order of each table
                        for name in ("REGIONS", "POSITION_PRIOR", "STARTERS_PER_TEAM", "SELECTORS", "CONF_LAYOUTS", "CONF_AWARDS")},
    }


def replay(case: dict):
    """Python's answer to a recorded call from the arguments as the file holds them."""
    if case["fn"] == "my_awards":
        return REAL["my_awards"](norm(case["state"]), norm(case["awards"]))
    state, teams, records = norm(case["state"]), norm(teams_seen[case["teams"]]), norm(case["records"])
    if case["fn"] == "race_view":
        return REAL["race_view"](state, teams, records)
    pool = awards.Pool(state, teams, records, case["through_week"])
    if case["fn"] == "postseason_awards":
        return REAL["postseason_awards"](pool, state)
    return REAL[case["fn"]](pool, state, final=case["final"])


def main(out_path: str) -> None:
    if QUICK:
        play("smu", 11, 4, {1, 2, 3, 4})
    else:
        play("smu", 11, season.FINAL_WEEK, {1, 3, 5, 8, 11, 14, 17, 19})
        play("akron", 23, 9, {2, 4, 6, 9})
    global depth
    depth = 1               # the recording is over: what follows calls the module without adding to `calls`
    checks = 0
    for case in calls:
        assert norm(replay(case)) == case["result"], f"{case['fn']} {case['label']}: not the recorded answer from the trimmed arguments"
        checks += 1
    # every function of the module, on: the three award steps, and the races of both seasons a few weeks apart
    with_teams = [c for c in calls if "teams" in c]
    steps = [c for c in with_teams if c["fn"] != "race_view"]
    races = [c for c in with_teams if c["fn"] == "race_view"]
    chosen = steps + (races if QUICK else [c for i, c in enumerate(races) if i % 2 == 0])
    for n, case in enumerate(chosen):
        case["tag"] = f"{case['label']}|{n}"
        case["battery"] = battery(case, case["tag"])
        print(f"  every function on {case['fn']} {case['label']}", file=sys.stderr)
    out = {"spec": SPEC, "small": small(random.Random("awards-reference")), "teams": teams_seen, "calls": calls, "python_checks": checks}
    Path(out_path).write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    by_fn: dict = {}
    for c in calls:
        by_fn[c["fn"]] = by_fn.get(c["fn"], 0) + 1
    print(f"{len(calls)} recorded calls {by_fn}, {len(chosen)} with every function, {len(teams_seen)} sets of teams, "
          f"{checks} answers reproduced by Python from the written arguments -> {out_path}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "awards_reference.json")
