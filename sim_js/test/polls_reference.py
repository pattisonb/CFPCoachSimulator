"""Python's answers for sim_js/polls.js, written as JSON for polls_compare.mjs to hold the JavaScript to:

    python3 sim_js/test/polls_reference.py out.json && node sim_js/test/polls_compare.mjs out.json

Seasons are played with every public function of sim/polls.py wrapped, so each call the season makes is kept with
its exact arguments and its result; then the functions and the paths the season does not reach (next_poll, the
helpers, the default parameters, voter noise, ties, short fields) are called directly on those same inputs.
"""
import copy
import inspect
import json
import os
import random
import sys
from pathlib import Path

os.environ["SIM_WORKERS"] = "1"
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from sim import polls, season    # noqa: E402

PUBLIC = ["load_params", "load_next_params", "load_ballot_params", "preseason_scores", "update_scores", "rank",
          "next_poll", "ballots", "coaches_order", "coaches_opinion", "committee_rank", "build_bracket",
          "seed_ballots", "next_ballots", "tally"]
PRIVATE = ["_new_entry_value", "_win_gain", "_winners_over", "_head_to_head", "_share_table"]
ORIGINAL = {name: getattr(polls, name) for name in PUBLIC + PRIVATE}
SIGNATURES = {name: list(inspect.signature(fn).parameters) for name, fn in ORIGINAL.items()}
# (team, mode, seed, career, real_polls, last week)
SEASONS = [("smu", "full", 11, True, True, season.FINAL_WEEK),
           ("ohio-state", "full", 2027, False, False, season.FINAL_WEEK),
           ("boise-state", "full", 5, True, True, season.CCG_WEEK + 1)]


def plain(v):
    """As JSON would carry it (tuples are lists), copied."""
    return json.loads(json.dumps(v))


def record(calls: list, where: str, name: str, *args, **kwargs) -> object:
    """Call the real function, keeping the arguments it was given (by name: only those given) and its result."""
    given = dict(inspect.signature(ORIGINAL[name]).bind(*args, **kwargs).arguments)
    before = plain(given)
    result = ORIGINAL[name](*args, **kwargs)
    calls.append({"fn": name, "where": where, "args": before, "result": plain(result)})
    return result


def wrap(calls: list, where: list) -> None:
    for name in PUBLIC:
        setattr(polls, name, (lambda n: lambda *a, **k: record(calls, where[0], n, *a, **k))(name))


def unwrap() -> None:
    for name, fn in ORIGINAL.items():
        setattr(polls, name, fn)


def direct(calls: list, where: str, name: str, *args, **kwargs) -> object:
    return record(calls, where, name, *args, **kwargs)


def extras(calls: list, season_calls: list) -> None:
    """The functions and branches the season does not reach, on the season's own inputs."""
    rng = random.Random("polls-reference")
    by = {}
    for c in season_calls:
        by.setdefault(c["fn"], []).append(c)

    def some(name, k):
        rows = by.get(name, [])
        return rows if len(rows) <= k else rng.sample(rows, k)

    for name in ("load_params", "load_next_params", "load_ballot_params"):
        direct(calls, "direct", name)

    odd = {"voter_noise": 0.012, "entry_all": 0.6, "close_own": 0.5, "close_win": 0.02, "loss_edge_extra": 0.004,
           "loss_ranked_cap": 0.21, "bye": -0.003, "unbeaten": 0.02, "g5_entry": 0.4}
    for n, c in enumerate(some("next_ballots", 40)):
        a = copy.deepcopy(c["args"])
        prev, games, records, tiers = a["prev"], a["games"], a["records"], a["tiers"]
        w = "next_ballots inputs"
        direct(calls, w, "next_poll", prev, games, records, tiers)
        direct(calls, w, "next_poll", prev, games, records, tiers, polls.load_next_params(), 40)
        direct(calls, w, "next_poll", prev, games, records, tiers, params=polls.load_ballot_params(), n=10)
        direct(calls, w, "_share_table", prev)
        direct(calls, w, "_winners_over", games)
        direct(calls, w, "tally", a["ballots"])
        direct(calls, w, "tally", [b[:rng.randrange(0, 30)] for b in a["ballots"]] + [[]])
        # default parameters, then the fitted ones with every optional term switched on (each voter draws noise)
        direct(calls, w, "next_ballots", a["ballots"], prev, games, records, tiers)
        direct(calls, w, "next_ballots", a["ballots"], prev, games, records, tiers,
               {**polls.load_ballot_params(), **odd}, seed=1000 + n)
        direct(calls, w, "next_ballots", a["ballots"][:7], prev, games, records, tiers, {"voter_noise": 0.05, "h2h": 0.3}, 3)
        # a tie, a neutral game, a team in nobody's poll or records, and a poll whose first-place votes are missing
        tied = copy.deepcopy(games)
        if len(tied) >= 3:
            tied[0]["away_score"] = tied[0]["home_score"]
            tied[1]["neutral"] = True
            tied[2]["neutral"] = None
        tied.append({"home": "nobody-state", "away": prev[0]["team"], "home_score": 31, "away_score": 30})
        bare = [{k: v for k, v in e.items() if k != "first_place"} for e in prev]
        bare[-1]["points"] = None
        bare[3]["rank"] = None
        direct(calls, w, "next_ballots", a["ballots"], bare, tied, records, tiers, polls.load_ballot_params(), seed=n)
        direct(calls, w, "next_poll", bare, tied, records, tiers, polls.load_next_params())
        direct(calls, w, "_share_table", bare)
        direct(calls, w, "_winners_over", tied)
        direct(calls, w, "seed_ballots", prev)
        direct(calls, w, "seed_ballots", prev, 9, 77 + n, 0.15)
        direct(calls, w, "seed_ballots", bare, seed=-n - 1, noise=0.0)
        # the helpers on their own
        order, key = ORIGINAL["next_poll"](prev, games, records, tiers, polls.load_next_params(), 400)
        for window in (0.02, 0.12, 0.5):
            moved = list(order)
            ORIGINAL["_head_to_head"](moved, key, ORIGINAL["_winners_over"](tied), window)
            calls.append({"fn": "_head_to_head", "where": w, "result": moved,
                          "args": plain({"order": order, "key": key, "winners_over": ORIGINAL["_winners_over"](tied), "window": window})})
        p = polls.load_ballot_params()
        for t in rng.sample(sorted(records), 12):
            direct(calls, w, "_new_entry_value", p, records[t], tiers.get(t))
            direct(calls, w, "_win_gain", p, rng.random(), rng.randrange(0, 22) / 21.0, rng.random() < 0.5, rng.random() < 0.2, tiers.get(t))

    for n, c in enumerate(some("update_scores", 40)):
        a = copy.deepcopy(c["args"])
        w = "update_scores inputs"
        direct(calls, w, "update_scores", a["scores"], a["games"], a["prev_rank"], a["records"], a["tiers"], a["week"], a["last_week"], polls.AP_PARAMS)
        direct(calls, w, "update_scores", a["scores"], a["games"], a["prev_rank"], a["records"], a["tiers"], 3, 15, a["params"])
        for params in (a["params"], polls.AP_PARAMS):
            direct(calls, w, "rank", a["scores"], a["records"], a["tiers"], params)
            direct(calls, w, "rank", c["result"], a["records"], a["tiers"], params, n=400)
        order = ORIGINAL["rank"](c["result"], a["records"], a["tiers"], a["params"], 40)
        direct(calls, w, "ballots", order, c["result"], a["tiers"], a["params"])
        direct(calls, w, "ballots", order, c["result"], a["tiers"], polls.AP_PARAMS, 13, 9 + n, 3.5)
        direct(calls, w, "ballots", order[:20], c["result"], a["tiers"], a["params"], seed=-5 - n, noise=0.0)
        prev_c = {t: i for i, t in enumerate(rng.sample(order, 25), 1)}
        direct(calls, w, "coaches_order", order, a["records"], prev_c)
        direct(calls, w, "coaches_order", order, a["records"], {}, {})
        direct(calls, w, "coaches_order", order, a["records"], prev_c, ORIGINAL["coaches_opinion"](order, n, 4))
        direct(calls, w, "coaches_opinion", order, 0, n)
        direct(calls, w, "coaches_opinion", order, 123456789 + n, 19)

    for c in by.get("preseason_scores", []):
        a = copy.deepcopy(c["args"])
        w = "preseason_scores inputs"
        direct(calls, w, "preseason_scores", a["preseason_poll"], a["ratings"], polls.AP_PARAMS)
        direct(calls, w, "preseason_scores", a["preseason_poll"], {}, a["params"])
        direct(calls, w, "preseason_scores", [], a["ratings"], a["params"])
        direct(calls, w, "preseason_scores", a["preseason_poll"][:7] + ["nobody-state"],
               {t: r + rng.random() for t, r in a["ratings"].items()}, a["params"])

    for n, c in enumerate(by.get("committee_rank", [])):
        a = copy.deepcopy(c["args"])
        w = "committee_rank inputs"
        champs = a["champions"] or {"SEC": c["result"][2], "Big Ten": c["result"][0], "MAC": c["result"][-1]}
        for params in (a["params"], polls.CFP_PARAMS, {**a["params"], "head_to_head": 40}):
            direct(calls, w, "committee_rank", a["scores"], a["records"], a["tiers"], a["opponents"], a["ap_rank"], champs, params)
            direct(calls, w, "committee_rank", a["scores"], a["records"], a["tiers"], a["opponents"], a["ap_rank"], None, params, n=12)
            direct(calls, w, "committee_rank", a["scores"], a["records"], a["tiers"], a["opponents"], {}, {}, params, 400)

    for n, c in enumerate(by.get("build_bracket", [])):
        a = copy.deepcopy(c["args"])
        w = "build_bracket inputs"
        ranking, champions, conf_of, names = a["ranking"], a["champions"], a["conference_of"], a.get("names")
        direct(calls, w, "build_bracket", ranking, champions, conf_of)
        direct(calls, w, "build_bracket", ranking[:9], champions, conf_of, names)
        direct(calls, w, "build_bracket", ranking, {}, conf_of, names)
        for _ in range(12):
            mixed = list(ranking)
            rng.shuffle(mixed)
            if rng.random() < 0.5 and "notre-dame" in conf_of:
                mixed = [t for t in mixed if t != "notre-dame"]
                mixed.insert(rng.randrange(0, 14), "notre-dame")
            ch = dict(champions)
            if rng.random() < 0.5:      # a champion from far down the ranking, or one the ranking does not have
                ch["SEC"] = mixed[-1]
                ch["Big 12"] = "nobody-state"
            if rng.random() < 0.3:
                ch["ACC"] = None
            direct(calls, w, "build_bracket", mixed, ch, conf_of, names)
            direct(calls, w, "build_bracket", mixed[:rng.randrange(0, 40)], ch, conf_of, names)

    # tests/test_poll_entries.py's frame
    prev = [{"team": f"t{i}", "rank": i, "points": 1700 - 62 * (i - 1), "first_place": 0} for i in range(1, 26)]
    prev += [{"team": "votes", "rank": None, "points": 128, "first_place": 0}, {"team": "fewvotes", "rank": None, "points": 30, "first_place": 0}]
    tiers = {e["team"]: "P4" for e in prev} | {"nobody": "P4", "unranked_a": "P4", "unranked_b": "P4"}
    games = [{"home": "nobody", "away": "t2", "home_score": 39, "away_score": 31, "neutral": False},
             {"home": "votes", "away": "unranked_a", "home_score": 57, "away_score": 24, "neutral": False},
             {"home": "t25", "away": "unranked_b", "home_score": 10, "away_score": 13, "neutral": False}]
    for nobody in ((4, 3), (7, 0)):
        records = {e["team"]: (6, 1) for e in prev} | {"t1": (7, 0), "t2": (6, 1), "nobody": nobody, "votes": (5, 2), "fewvotes": (5, 2),
                                                       "unranked_a": (3, 4), "unranked_b": (3, 4)}
        direct(calls, "test_poll_entries", "next_poll", prev, games, records, tiers)
        seeded = direct(calls, "test_poll_entries", "seed_ballots", prev, seed=3)
        direct(calls, "test_poll_entries", "next_ballots", seeded, prev, games, records, tiers, polls.load_ballot_params(), seed=3)


def main(out_path: str) -> None:
    season_calls: list = []
    where = [""]
    wrap(season_calls, where)
    try:
        for team, mode, seed, career, real, last in SEASONS:
            where[0] = f"{team} seed {seed} preseason"
            st = season.new_season(team, mode, seed=seed, career=career, real_polls=real)
            for week in range(1, last + 1):
                where[0] = f"{team} seed {seed} to week {week}"
                season.advance_to(st, week)
                print(f"{team} seed {seed}: week {week}, {len(season_calls)} calls", file=sys.stderr)
    finally:
        unwrap()
    direct_calls: list = []
    extras(direct_calls, season_calls)
    consts = {k: (sorted(v) if isinstance(v, set) else v) for k, v in vars(polls).items()
              if k.isupper() and k not in ("ROOT", "PARAMS_FILE")}
    out = {"signatures": SIGNATURES, "constants": consts, "season": season_calls, "direct": direct_calls}
    Path(out_path).write_text(json.dumps(out), encoding="utf-8")
    print(f"{len(season_calls)} season calls, {len(direct_calls)} direct calls -> {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "polls_reference.json")
