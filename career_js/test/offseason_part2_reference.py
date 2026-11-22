"""Python's answers for career_js/offseason/part2.js (coach_career/offseason.py, lines 812 to 1667), written as JSON for
offseason_part2_compare.mjs to hold the JavaScript to:

    python3 career_js/test/offseason_part2_reference.py OUT [--quick] && node career_js/test/offseason_part2_compare.mjs OUT

Three careers' offseasons are walked from the season's end to "ready":

- `real1`: a real career's first season, played week by week (Georgia, seed 7; about three minutes, kept in OUT as a
  pickle so a second run does not play it again), then its offseason;
- `real2`: that career's second season played the same way, then its offseason, with a few of your players marked as
  promised a start or kept home and judged kept, bent and broken (so those branches run);
- `fake`: a new career (Boise State, seed 3) whose season is made over in a second, as the offseason's tests do.

`--quick` walks only `fake`.

Two kinds of cases are written (cases.jsonl; big values in their own .json.gz files, named by their hash):

- the part's functions as the offseason itself calls them (`_departures`, `_sign_classes`, `_redshirt_block`,
  `_run_draft`, `_apply_redshirts`, `_close_portal`, `fill_roles`): the state before, the arguments, what came back and
  the state after;
- every function of the part called directly on the state at two points of the offseason (after `start`, and at the
  Departures step), with sampled and made-up arguments.

A case holds, in the order made, every call the part made out of itself: into the file's other parts (`_record`,
`_carry_over`), the season, recruiting, persona, and the stateful functions of programs, carousel, promises, word,
prospects and league. The Node script replays them as stubs and checks that the JavaScript asks the same things, in the
same order, with the same arguments.
"""
import copy
import gzip
import hashlib
import json
import os
import pickle
import random
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
QUICK = "--quick" in sys.argv
os.environ["CFP_SEASONS_DIR"] = tempfile.mkdtemp()
os.environ["SIM_WORKERS"] = "1"
os.environ.pop("CFP_CLEAR", None)

from canon import canon                                                            # noqa: E402
from coach_career import carousel, clear, league, offseason, persona, programs, promises, prospects, recruiting, word   # noqa: E402
from sim import season                                                             # noqa: E402
import test_offseason                                                              # noqa: E402

# ----- writing ---------------------------------------------------------------------------------------------------------

WRITTEN = set()


def big(value, text=None):
    """A value kept in its own file, named by its hash: {"$file": name}."""
    text = json.dumps(canon(value)) if text is None else text
    h = hashlib.sha1(text.encode()).hexdigest()[:16]
    if h not in WRITTEN:
        WRITTEN.add(h)
        with gzip.open(out / f"v_{h}.json.gz", "wt", compresslevel=3) as f:
            f.write(text)
    return {"$file": f"v_{h}.json.gz"}


def keep(value):
    """A value as it goes into a case: itself when small, its own file when big."""
    text = json.dumps(canon(value))
    return json.loads(text) if len(text) < 2000 else big(None, text)


CASES = open(out / "cases.jsonl", "w")
COUNT = {}


def write(case):
    CASES.write(json.dumps(canon(case)) + "\n")
    for s in case["steps"]:
        if "fn" in s:
            COUNT[s["fn"]] = COUNT.get(s["fn"], 0) + 1


# ----- the state a case runs on ----------------------------------------------------------------------------------------

SCALARS = ("seed", "id", "year", "team", "current_week", "conference", "done")
RC_KEYS = ("year", "week", "portal", "seed", "topics_v", "prospects", "status", "log", "lists", "contacts", "offers", "board", "reports")


def slim_stats(ss):
    return {slug: {"games": t.get("games", 0), "players": {k: {"games": v["games"]} if "games" in v else {} for k, v in (t.get("players") or {}).items()}}
            for slug, t in (ss or {}).items()}


def state_slice(st, keys):
    """What the part reads of a state: its scalars and the `keys` asked for (the season's games, polls and boxes are
    only read by the functions replayed as stubs)."""
    d = {k: st[k] for k in SCALARS if k in st}
    for k in keys:
        if k not in st:
            continue
        if k == "season_stats":
            d[k] = slim_stats(st[k])
        elif k == "recruiting":
            d[k] = {x: st[k][x] for x in RC_KEYS if x in st[k]} if st[k] else st[k]
        elif k == "recruiting_last":
            d[k] = {"marker": "the signed class, kept aside"} if st[k] else st[k]
        else:
            d[k] = st[k]
    return d


def at(root, path):
    for k in path:
        root = root[k]
    return root


MISSING = "$missing"


def watched(st, paths):
    vals = {}
    for path in paths:
        try:
            vals["/".join(str(k) for k in path)] = at(st, path)
        except (KeyError, IndexError, TypeError):
            vals["/".join(str(k) for k in path)] = MISSING
    return vals


# ----- the recorder: what the part asked of everything outside it ------------------------------------------------------

class Rec:
    log = None      # the calls made out of the part while a case runs, in order
    depth = 0       # inside a recorded function: what it asks in turn is its own business


class Cur:
    state = None    # the state the case in hand runs on (an argument that is it, or its league, is written as a marker)
    natural = False


def mark(v):
    if v is Cur.state:
        return "$state"
    if Cur.state is not None and v is Cur.state.get("league"):
        return "$lgd"
    return v


def default_args(a, k):
    assert not k, k
    return [mark(v) for v in a]


TEAMS_MEMO = {}


def slim_teams(teams):
    key = id(teams)
    if key not in TEAMS_MEMO:
        row = lambda p: {"slug": p.get("slug"), "name": p["name"], "position": p["position"]}
        TEAMS_MEMO[key] = (teams, big({s: {"conference": t["conference"], "team_ratings": {"overall": (t.get("team_ratings") or {}).get("overall")},
                                           "offense": [row(p) for p in t.get("offense", [])], "defense": [row(p) for p in t.get("defense", [])]}
                                       for s, t in teams.items()}))
    return TEAMS_MEMO[key][1]


def ext(mod, name, args=default_args, ret=lambda r: r, effect=None, kept=keep):
    orig = getattr(mod, name)
    label = f"{mod.__name__.split('.')[-1]}.{name}"

    def wrapped(*a, **k):
        if Rec.log is None or Rec.depth:
            return orig(*a, **k)
        entry = {"fn": label, "args": keep(args(a, k))}
        Rec.depth += 1
        try:
            r = orig(*a, **k)
        except Exception as exc:
            entry["raise"] = type(exc).__name__
            Rec.log.append(entry)
            raise
        finally:
            Rec.depth -= 1
        entry["ret"] = kept(ret(r))
        if effect:
            entry["effect"] = effect(a, k, r)
        Rec.log.append(entry)
        return r
    wrapped.__wrapped__ = orig
    setattr(mod, name, wrapped)


ext(offseason, "_record", ret=list)
ext(offseason, "_carry_over")
ext(season, "season_year")
ext(season, "load_teams", ret=slim_teams, kept=lambda r: r)
ext(season, "_is_p4", args=lambda a, k: [a[0]])
ext(recruiting, "market_value")
ext(recruiting, "attributes", args=lambda a, k: ["$state", a[1]["id"], a[2] if len(a) > 2 else "potential"])
ext(recruiting, "early_signing_week")
ext(recruiting, "auto_mode")
ext(recruiting, "top_group")
ext(recruiting, "portal_spots")
ext(recruiting, "needs")
ext(recruiting, "_event", args=lambda a, k: ["$state", a[1], a[2], a[3] if len(a) > 3 else None, k])
ext(recruiting, "reset_caches")
ext(persona, "of", ret=lambda r: {"personality": r["personality"]})
ext(word, "apply_bands")
ext(carousel, "_results")
ext(programs, "final_ranks")
ext(programs, "z")
ext(programs, "update", args=lambda a, k: [a[0], a[1], a[2], k.get("year")],
    effect=lambda a, k, r: {s: t["program"]["tier"] for s, t in a[0]["league"]["teams"].items()})
ext(prospects, "history_index")
ext(league, "team_meta")

# real2: a few of your players judged on a promise (the bands the part reads are made up here; the rest is the game's)
MADE_BANDS = {}
_bands = promises.bands
promises.bands = lambda state, year: dict(_bands(state, year), **MADE_BANDS)
ext(promises, "bands")


# ----- what a function gives back, as JSON -----------------------------------------------------------------------------

RET = {
    "_would_start": lambda r: sorted(r),
    "draft_scores": lambda r: [[[s, slug, p["id"]] for s, slug, p in r[0]], sorted(r[1])],
    "draft_board": lambda r: [sorted(r[0]), r[1]],
}
CLOSE = {"draft_score", "draft_scores", "draft_board", "entrant_interest", "_departures", "resolve_round"}   # a gauss draw's last digit (PORTING.md)


# ----- the part's functions as the offseason calls them ----------------------------------------------------------------

def natural(name, keys, watch, extra=None):
    orig = getattr(offseason, name)

    def wrapped(*a, **k):
        if not Cur.natural or Rec.log is not None:
            return orig(*a, **k)
        st = Cur.state
        assert a[0] is st, name
        before = big(state_slice(st, keys))
        args = [mark(v) if isinstance(mark(v), str) and mark(v) in ("$state", "$lgd") else copy.deepcopy(v) for v in a]
        if k:
            assert name == "_departures" and list(k) == ["draft"] and k["draft"] == {}, k
            args += [None, {}]                                  # shifts, draft
        Rec.log = []
        try:
            r = orig(*a, **k)
        finally:
            calls, Rec.log = Rec.log, None
        step = {"fn": name, "args": args, "ret": keep(RET.get(name, lambda x: x)(r))}
        if k:
            step["after"] = {str(len(args) - 1): keep(k["draft"])}
        write({"name": f"{Cur.tag}: {name} as the offseason calls it", "state": before, "fresh": True, "steps": [step], "calls": big(calls),
               "watch": [[p, big(v) if len(json.dumps(canon(v))) > 2000 else v] for p, v in watched(st, watch(st)).items()],
               "close": name in CLOSE, "clear": clear.on()})
        print("   ", Cur.tag, name, len(calls), "calls out", flush=True)
        return r
    setattr(offseason, name, wrapped)


LEAGUE = lambda st: [["league", "teams"]]
natural("_departures", ("league", "season_stats", "career"), LEAGUE)
natural("_sign_classes", ("league", "recruiting"), LEAGUE)
natural("_redshirt_block", ("league", "season_stats", "redshirting"), lambda st: [])
natural("_run_draft", ("offseason",), lambda st: [["offseason", "departures"], ["offseason", "draft"]])
natural("_apply_redshirts", ("offseason", "league"), lambda st: [["league", "teams", st["team"], "roster"], ["offseason", "redshirts"]])
natural("_close_portal", ("league", "offseason", "recruiting", "recruiting_last", "career"),
        lambda st: [["league", "teams"], ["offseason", "portal"], ["offseason", "portal_recruiting"], ["recruiting"], ["recruiting_last"]])
natural("fill_roles", ("league", "offseason"), lambda st: [["league", "teams"], ["offseason", "position_changes"]])


# ----- the part's functions called directly ----------------------------------------------------------------------------

def resolve(v, st, rngs):
    if v == "$state":
        return st
    if v == "$lgd":
        return st["league"]
    if isinstance(v, dict) and "$path" in v:
        return at(st, v["$path"])
    if isinstance(v, dict) and "$rng" in v:
        rngs.append(random.Random(v["$rng"]))
        return rngs[-1]
    return copy.deepcopy(v)


def is_marker(v):
    return v in ("$state", "$lgd") if isinstance(v, str) else isinstance(v, dict) and ("$path" in v or "$rng" in v)


def fresh_copy(st, keys):
    """The state with the parts a case changes copied (the rest shared: the stubs' real functions read it)."""
    st2 = dict(st)
    for k in keys:
        if k in st2:
            st2[k] = pickle.loads(pickle.dumps(st2[k]))
    return st2


def run_case(name, st, snap, steps, fresh=False, watch=(), patch=(), clear_on=None, close=False):
    target = fresh_copy(st, ("league", "offseason", "recruiting", "career", "redshirting", "position_changes")) if fresh else st
    for path, value in patch:
        at(target, path[:-1])[path[-1]] = copy.deepcopy(value)
    was_clear = clear.CLEAR
    if clear_on is not None:
        clear.CLEAR = clear_on
    Cur.state, Rec.log = target, []
    done = []
    try:
        for s in steps:
            if "set" in s:
                path, value = s["set"]
                at(target, path[:-1])[path[-1]] = copy.deepcopy(value)
                done.append(s)
                continue
            rngs = []
            args = [resolve(v, target, rngs) for v in s["args"]]
            step = {"fn": s["fn"], "args": s["args"]}
            try:
                r = getattr(offseason, s["fn"])(*args)
                step["ret"] = keep(RET.get(s["fn"], lambda x: x)(r))
            except offseason.RosterError as exc:
                step["raise"] = [exc.code, str(exc)]
            step["after"] = {str(i): keep(args[i]) for i, v in enumerate(s["args"]) if isinstance(v, (dict, list)) and not is_marker(v)}
            if rngs:
                step["rng_next"] = [g.random() for g in rngs]
            done.append(step)
    finally:
        calls, Rec.log = Rec.log, None
        Cur.state = st
        clear.CLEAR = was_clear
    write({"name": f"{Cur.tag}: {name}", "state": snap, "fresh": fresh, "patch": [list(p) for p in patch], "steps": done,
           "calls": keep(calls), "watch": [[p, keep(v)] for p, v in watched(target, watch).items()],
           "close": close or any(s.get("fn") in CLOSE for s in done), "clear": clear.on() if clear_on is None else clear_on})


KEYS_A = ("league", "season_stats", "recruiting", "offseason", "career", "redshirting", "position_changes")
CLASSES = ("FR", "FRRS", "SO", "SORS", "JR", "JRRS", "SR", "SRRS")
USES = ("starter", "rotation", "bench")


def slim_row(p, *more):
    return {k: p[k] for k in ("id", "pos", "cls", "o", "kept", "promised") + more if k in p}


def direct_start(tag, st, usage):
    """Every function of the part on the state right after `start` (the Keep Them Home step)."""
    R = random.Random(f"offseason-part2-{tag}")
    lgd, me, off = st["league"], st["team"], st["offseason"]
    slugs = list(lgd["teams"])
    snap = big(state_slice(st, KEYS_A))
    some = R.sample(slugs, 24) + [me]
    all_rows = [(s, i, p) for s in slugs for i, p in enumerate(lgd["teams"][s]["roster"])]
    year = lgd["year"]

    def ro(name, fn, args, **kw):
        run_case(name, st, snap, [{"fn": fn, "args": args}], **kw)

    # --- why players leave
    ro("program_shifts", "program_shifts", ["$state", "$lgd"])
    gone = dict(st)
    del gone["games"]                                              # no season behind the state: nothing moves
    Cur.state, Rec.log = gone, []
    assert offseason.program_shifts(gone, lgd) == {}
    calls, Rec.log, Cur.state = Rec.log, None, st
    write({"name": f"{tag}: program_shifts with no season", "state": snap, "fresh": False, "patch": [],
           "steps": [{"fn": "program_shifts", "args": ["$state", "$lgd"], "ret": {}, "after": {}}], "calls": calls, "watch": [], "close": False, "clear": clear.on()})
    shifts = offseason.program_shifts(st, lgd)
    for s in slugs:
        sh = shifts if R.random() < 0.7 else {s: R.choice((-1, 0, 1, 2))} if R.random() < 0.8 else {}
        ro(f"_program_context {s}", "_program_context", ["$lgd", s, R.random() < 0.5, R.random() < 0.5, sh])
    # a school with no program on its row, a new head coach, a weak developer after a losing year
    hc_path = ["league", "teams", some[0], "coaches", "head_coach"]
    hc = copy.deepcopy(at(st, hc_path))
    for label, patch, losing in (
            ("no program", [(["league", "teams", some[0], "program"], None)], False),
            ("new coach", [(hc_path, dict(hc, since=year - 1))], False),
            ("weak coach", [(hc_path, dict(hc, since=2020, ratings=dict(hc.get("ratings") or {}, player_development=41)))], True),
            ("no ratings", [(hc_path, {"since": 2020})], True),
            ("no coaches", [(["league", "teams", some[0], "coaches"], None)], True)):
        run_case(f"_program_context, {label}", st, snap, [{"fn": "_program_context", "args": ["$lgd", some[0], losing, True, {}]}], fresh=True, patch=patch)
    kinds = ("shy", "cocky", "business", None)
    for n in range(500):
        s, i, p = R.choice(all_rows)
        q = slim_row(p)
        if R.random() < 0.4:
            q["cls"] = R.choice(CLASSES + ("XX",))
        if R.random() < 0.3:
            q["o"] = R.randint(20, 99)
        if R.random() < 0.35:
            q["kept"] = R.choice((year - 1, year - 1, year - 2, None))
        promise = {}
        if R.random() < 0.5:
            q["promised"] = R.choice((year - 1, year - 1, year - 1, year - 2, None))
            roll = R.random()
            if roll < 0.75:
                promise[q["id"]] = {"band": R.choice(("kept", "bent", "broken", "broken", "odd")), "score": R.random(),
                                    "benched_big": R.random() < 0.3, "personality": R.choice(kinds)}
            elif roll < 0.8:
                promise[q["id"]] = {}
            elif roll < 0.85:
                promise[q["id"]] = None
        ctx = {"losing": R.random() < 0.5, "p4": R.random() < 0.5, "year": year, "tier": R.choice((1, 2, 3, 4, 5, 9)),
               "slipping": R.choice((None, None, "slipping", "better_coach")), "rising": R.random() < 0.3}
        if R.random() < 0.9:
            ctx["promise"] = promise if R.random() < 0.9 else None
        if R.random() < 0.05:
            del ctx["slipping"], ctx["rising"]
        ro(f"portal_odds {n}", "portal_odds", [q, R.choice(USES), ctx])
    for s in some:
        ro(f"_would_start {s}", "_would_start", [{"$path": ["league", "teams", s, "roster"]}, recruiting.PORTAL_STARTERS])
    ro("_would_start, short", "_would_start", [[{"id": "a", "pos": "QB", "o": 50}, {"id": "b", "pos": "QB", "o": 50}, {"id": "c", "pos": "XX", "o": 9},
                                                  {"id": "d", "pos": "WR", "o": 3}], {"QB": 1}])
    # --- the draft
    eligible = [slim_row(p) for s, i, p in all_rows if p["cls"] in ("SR", "SRRS") or p["cls"] in offseason.UNDERCLASS_ELIGIBLE]
    for n, k in enumerate((1, 2, 5, 13, 40, 300, 1500, len(eligible))):
        ro(f"draft_grades of {k}", "draft_grades", [R.sample(eligible, min(k, len(eligible)))])
    ro("draft_grades of none", "draft_grades", [[]])
    ro("draft_grades, a position of its own", "draft_grades", [[{"pos": "ATH", "o": 61.7}, {"pos": "QB", "o": 80}, {"pos": "ATH", "o": 44}]])
    grades = {g: list(v) for g, v in offseason.draft_grades(eligible).items()}
    positions = list(offseason.GROUP) + ["ATH"]
    for n in range(160):
        g = R.choice((grades, grades, None, {}, {"QB": [61.5, 4.0]}, {"*": [55.25, 7.5]}))
        ro(f"draft_score {n}", "draft_score", [R.choice(positions), R.choice((R.randint(20, 99), R.uniform(20, 99))), {"$rng": f"ds-{tag}-{n}"}, g],
           clear_on=R.random() < 0.5)
    games = offseason._games_played(st)
    for n in range(200):
        s, i, p = R.choice(all_rows)
        q = slim_row(p)
        if R.random() < 0.6:
            q["o"] = R.randint(88, 99)
        if R.random() < 0.6:
            q["cls"] = R.choice(("JR", "JRRS", "SORS", "SO", "SR"))
        g = R.choice((None, {}, {q["id"]: R.randint(0, 13)}, games.get(s, {})))
        ro(f"elite {n}", "elite", [q, g])
    ro("draft_scores, no games", "draft_scores", ["$lgd", {"$rng": f"board-{tag}-1"}, None])
    ro("draft_scores", "draft_scores", ["$lgd", {"$rng": f"board-{tag}-2"}, games])
    ro("draft_scores, a few teams' games", "draft_scores", ["$lgd", {"$rng": f"board-{tag}-3"}, {s: games.get(s, {}) for s in some[:9]}])
    ro("draft_board", "draft_board", ["$lgd", {"$rng": f"board-{tag}-4"}, games])
    ro("draft_board, Clear Mode off", "draft_board", ["$lgd", {"$rng": f"board-{tag}-5"}, None], clear_on=False)
    ro("draft_board, Clear Mode on", "draft_board", ["$lgd", {"$rng": f"board-{tag}-5"}, None], clear_on=True)
    for pick in (None, 0, 1, 16, 32, 33, 64, 100, 101, 257, 258, 10 ** 6, 10 ** 9):
        for el in (False, True):
            ro(f"ai_keep_chance {pick} {el}", "ai_keep_chance", [pick, el])
    for n in range(260):
        s, i, p = R.choice(all_rows)
        q = slim_row(p)
        if R.random() < 0.3:
            q["cls"] = R.choice(CLASSES + ("XX",))
        g = R.choice((0, 0, 1, 3, 4, 5, 12))
        ro(f"_next_class {n}", "_next_class", [q, R.choice(USES), {"$rng": f"nc-{tag}-{n}"}, g])
        ro(f"_redshirt_candidate {n}", "_redshirt_candidate", [q, g])
    ro("_games_played", "_games_played", ["$state"])
    # --- your roster: redshirts and position changes
    mine = lgd["teams"][me]["roster"]
    sat = {p["id"]: {"week": 3} for p in R.sample(mine, 5)}
    run_case("_redshirt_block, some sat down in the season", st, snap, [{"fn": "_redshirt_block", "args": ["$state", "$lgd", {me: usage.get(me, {})}]}],
             fresh=True, patch=[(["redshirting"], {me: sat})])
    ro("_redshirt_block, no usage", "_redshirt_block", ["$state", "$lgd", {}])
    ro("redshirt before the Departures step", "redshirt", ["$state", mine[0]["id"], True])
    for p in mine:
        ro(f"position_options {p['id']}", "position_options", ["$state", p["id"]])
    ro("position_options, nobody", "position_options", ["$state", "nobody-at-all"])
    for s in slugs:
        ro(f"defense_scheme {s}", "defense_scheme", [{"$path": ["league", "teams", s]}])
        ro(f"empty_roles {s}", "empty_roles", [{"$path": ["league", "teams", s]}])
    for n, team in enumerate(({}, {"coaches": None}, {"coaches": {"head_coach": {"scheme": {"defensive_philosophy": "3-4"}}}},
                              {"coaches": {"defensive_coordinator": {"scheme": {"defensive_scheme": ""}}, "head_coach": {"scheme": None}}},
                              {"coaches": {"defensive_coordinator": {"scheme": {"defensive_scheme": "3-3-5"}}, "head_coach": {"scheme": {"defensive_philosophy": "4-3"}}}})):
        ro(f"defense_scheme made up {n}", "defense_scheme", [team])
        ro(f"empty_roles made up {n}", "empty_roles", [dict(team, roster=[{"pos": "QB"}, {"pos": "LG"}])])
        ro(f"empty_roles made up {n}, filled", "empty_roles", [dict(team, roster=[{"pos": "C"}, {"pos": "SAM"}])])
    for scheme in ("4-3", "3-4", "Tite Front 3-4", "4-2-5", "Multiple 4-2-5", "3-3-5", "46", "", None):
        ro(f"has_sam {scheme}", "has_sam", [scheme])
    positions = list(offseason.GROUP)
    for n in range(200):
        s = R.choice(slugs)
        ro(f"_jersey {n}", "_jersey", [{"$path": ["league", "teams", s, "roster"]}, R.choice(positions), {"$rng": f"j-{tag}-{n}"}])
    full = [{"j": str(n)} for n in range(1, 100)]
    ro("_jersey, only 0 left", "_jersey", [full, "QB", {"$rng": "j0"}])
    ro("_jersey, none left", "_jersey", [full + [{"j": "0"}], "LT", {"$rng": "j1"}])
    ro("_jersey, numbers kept as numbers and one missing", "_jersey", [[{"j": n} for n in range(1, 19)] + [{}, {"j": None}], "QB", {"$rng": "j2"}])
    ro("_jersey, the line's numbers taken", "_jersey", [[{"j": str(n)} for n in range(50, 80)], "C", {"$rng": "j3"}])
    # --- his story
    for n, rows in enumerate((None, [], [{"year": 2020 + i, "kind": "x"} for i in range(29)], [{"year": i, "kind": "x"} for i in range(30)],
                              [{"year": i, "kind": "x"} for i in range(37)])):
        p = {"id": "p"} if rows is None else {"id": "p", "life": rows}
        run_case(f"life {n}", st, snap, [{"fn": "life", "args": [p, 2026, "promise", {"band": "bent", "benched_big": None}]}])
        run_case(f"life {n}, plain", st, snap, [{"fn": "life", "args": [p, 2027, "progress"]}])
        run_case(f"life {n}, more", st, snap, [{"fn": "life", "args": [p, 2027, "transfer", {"to": "x", "overall": 0, "from": "y", "walk_on": True, "promised": None, "log": [{"a": 1}]}]}])
    ro("_recruit_stories", "_recruit_stories", ["$state"])
    rc = st["recruiting"]
    signed = [q for q, s_ in rc["status"].items() if s_.get("signed") and s_["signed"] != "FCS"]
    for q in R.sample(signed, 40) + R.sample(sorted(rc["prospects"]), 20):
        ro(f"_compact_prospect {q}", "_compact_prospect", ["$state", {"$path": ["recruiting", "prospects", q]}, {"$path": ["league", "attrs"]}], clear_on=R.random() < 0.8)
    # --- the portal
    portal = ["offseason", "portal"]
    pids = list(off["portal"]["players"])
    for s in some[:8]:
        ro(f"p4_school {s}", "p4_school", [s])
    for s in slugs:
        ro(f"open_spots {s}", "open_spots", ["$lgd", s, {"$path": portal}])
        ro(f"_prestige {s}", "_prestige", ["$state", s])
    ro("_prestige, no such school", "_prestige", ["$state", "no-such-school"])
    for s in some:
        ro(f"churn_left {s}", "churn_left", [{"$path": portal}, s])
        ro(f"my_spots {s}", "my_spots", ["$lgd", s, {"$path": portal}])
        ro(f"_group_counts {s}", "_group_counts", [{"$path": ["league", "teams", s, "roster"]}])
        ro(f"_depth_values {s}", "_depth_values", [{"$path": ["league", "teams", s, "roster"]}])
    for n in range(300):
        ro(f"playing_time {n}", "playing_time", ["$lgd", R.choice(slugs), {"$path": portal + ["players", R.choice(pids), "player"]}])
    ro("playing_time, the best there is", "playing_time", ["$lgd", me, {"pos": "QB", "o": 99}])
    ro("playing_time, the worst", "playing_time", ["$lgd", me, {"pos": "WR", "o": 1}])
    for n in range(240):
        rng = {"$rng": f"ei-{tag}-{n}"} if n % 3 else None
        ro(f"entrant_interest {n}", "entrant_interest", ["$state", "$lgd", R.choice(slugs), {"$path": portal + ["players", R.choice(pids)]}, rng])
    for s in slugs:
        ro(f"ai_offers {s}", "ai_offers", ["$state", s])
    for n in range(40):
        ro(f"ai_offers with spots left {n}", "ai_offers", ["$state", R.choice(slugs), R.choice((0, -1, 1, 2, 3, 4, 5, 9, 14))])
    # some entrants signed already, a few into spots made by releasing players
    taken = R.sample(pids, min(60, len(pids)))
    patch = []
    for n, q in enumerate(taken):
        patch.append((portal + ["players", q, "signed"], some[n % 6]))
        if n % 3 == 0:
            patch.append((portal + ["players", q, "churn"], True))
    steps = []
    for s in some[:8]:
        steps += [{"fn": "open_spots", "args": ["$lgd", s, {"$path": portal}]}, {"fn": "churn_left", "args": [{"$path": portal}, s]},
                  {"fn": "my_spots", "args": ["$lgd", s, {"$path": portal}]}, {"fn": "ai_offers", "args": ["$state", s]},
                  {"fn": "ai_offers", "args": ["$state", s, 6]}]
    run_case("the portal's counts with entrants signed", st, snap, steps, fresh=True, patch=patch)
    # --- cases that change the state
    movers = R.sample([p for p in mine if p["pos"] not in ("K", "P")], 5)
    a, b, c_, d, e_ = movers
    other = lambda p, n=0: [x for x in positions if x != p["pos"] and offseason.GROUP[x] != offseason.GROUP[p["pos"]] and x not in ("K", "P")][n * 5 + 2]
    near = lambda p: [x for x in positions if x != p["pos"] and offseason.GROUP[x] == offseason.GROUP[p["pos"]]][:1] or [other(p, 2)]
    steps = [{"fn": "change_position", "args": ["$state", a["id"], "XX"]},
             {"fn": "change_position", "args": ["$state", a["id"], None]},
             {"fn": "change_position", "args": ["$state", "nobody-at-all", "QB"]},
             {"fn": "change_position", "args": ["$state", a["id"], a["pos"]]},
             {"fn": "change_position", "args": ["$state", a["id"], other(a)]},
             {"fn": "position_options", "args": ["$state", a["id"]]},
             {"fn": "change_position", "args": ["$state", a["id"], other(a, 1)]},
             {"fn": "change_position", "args": ["$state", b["id"], near(b)[0]]},
             {"fn": "change_position", "args": ["$state", a["id"], a["pos"]]},
             {"fn": "change_position", "args": ["$state", c_["id"], "K"]},
             {"fn": "change_position", "args": ["$state", d["id"], other(d)]},
             {"fn": "change_position", "args": ["$state", d["id"], other(d)]},
             {"fn": "position_options", "args": ["$state", d["id"]]},
             {"fn": "change_position", "args": ["$state", e_["id"], near(e_)[0]]},
             {"fn": "change_position", "args": ["$state", b["id"], b["pos"]]}]
    mine_path = ["league", "teams", me, "roster"]
    run_case("change_position, there and back", st, snap, steps, fresh=True, watch=[mine_path, ["offseason", "position_changes"]])
    run_case("change_position with no list of changes yet", st, snap, steps[4:8], fresh=True, watch=[mine_path, ["offseason", "position_changes"]],
             patch=[(["offseason", "position_changes"], [{"id": a["id"], "name": "x", "from": "QB", "to": "WR", "overall": 1}, {"id": "zz", "name": "y"}])])
    them = some[3]
    theirs = lgd["teams"][them]["roster"]
    moves = {me: {a["id"]: {"to": other(a)}, b["id"]: {"to": b["pos"]}, "nobody-at-all": {"to": "QB"}, c_["id"]: {"to": near(c_)[0]}},
             them: {theirs[2]["id"]: {"to": other(theirs[2])}, theirs[7]["id"]: {"to": other(theirs[7], 1)}}, "no-such-school": {"x": {"to": "QB"}}}
    run_case("_season_moves", st, snap, [{"fn": "_season_moves", "args": ["$state", "$lgd"]}], fresh=True, patch=[(["position_changes"], moves)],
             watch=[mine_path, ["league", "teams", them, "roster"]])
    ro("_season_moves, none", "_season_moves", ["$state", "$lgd"])
    run_case("fill_roles, every team", st, snap, [{"fn": "fill_roles", "args": ["$state", None]}], fresh=True, watch=[["league", "teams"], ["offseason", "position_changes"]])
    # rosters with no center or no SAM, and one with nobody to move
    six = [me] + some[4:9]
    patch = []
    for n, s in enumerate(six):
        drop = ("C", "SAM") if n < 4 else ("C", "SAM", "LG", "RG", "LT", "RT") if n == 4 else ("SAM", "WILL")
        patch.append((["league", "teams", s, "roster"], [p for p in lgd["teams"][s]["roster"] if p["pos"] not in drop]))
    run_case("fill_roles, six teams short a role", st, snap, [{"fn": "fill_roles", "args": ["$state", six]}, {"fn": "fill_roles", "args": ["$state", six]}],
             fresh=True, patch=patch, watch=[["league", "teams", s, "roster"] for s in six] + [["offseason", "position_changes"]])
    run_case("fill_roles, yours with a change already made", st, snap,
             [{"fn": "change_position", "args": ["$state", a["id"], other(a)]}, {"fn": "fill_roles", "args": ["$state", [me]]}], fresh=True, patch=patch[:1],
             watch=[mine_path, ["offseason", "position_changes"]])
    # the two-round portal of older saves: your offers (no two of the same overall: the Python walks a set of them)
    by_o = {}
    for q in R.sample(pids, len(pids)):
        by_o.setdefault(off["portal"]["players"][q]["player"]["o"], q)
    best = [by_o[o] for o in sorted(by_o, reverse=True)]
    first, second = best[:14:2], best[1:14:2] + best[14:20]
    steps = [{"fn": "resolve_round", "args": ["$state"]}, {"set": [portal + ["round"], 2]}, {"set": [portal + ["offers"], {me: second}]},
             {"fn": "resolve_round", "args": ["$state"]}, {"fn": "_close_portal_rounds", "args": ["$state"]}]
    run_case("the two-round portal", st, snap, steps, fresh=True, patch=[(portal + ["offers"], {me: first})],
             watch=[["league", "teams"], portal])
    # ... and on Auto with nothing offered, when what your staff would offer is in a sure order (one, or no two alike)
    for size in (84, 83, 82):
        st2 = fresh_copy(st, ("league", "career"))
        st2["league"]["teams"][me]["roster"] = st2["league"]["teams"][me]["roster"][:size]
        would = offseason.ai_offers(st2, me)
        if would and len({off["portal"]["players"][q]["player"]["o"] for q in would}) == len(would):
            run_case(f"the two-round portal on Auto ({len(would)} offers of yours)", st, snap, [{"fn": "resolve_round", "args": ["$state"]}], fresh=True,
                     patch=[(mine_path, lgd["teams"][me]["roster"][:size]), (["career", "settings"], dict(st["career"].get("settings") or {}, auto_recruit="on"))],
                     watch=[portal])
            break
    run_case("the two-round portal, Auto set to 0", st, snap, [{"fn": "resolve_round", "args": ["$state"]}], fresh=True,
             patch=[(["career", "settings"], {"auto_recruit": 0})], watch=[portal])


def direct_departures(tag, st):
    """At the Departures step: your redshirt calls, then the step's end."""
    R = random.Random(f"offseason-part2-{tag}-departures")
    me, off = st["team"], st["offseason"]
    snap = big(state_slice(st, ("league", "offseason")))
    rows = off["redshirts"]["players"]
    steps = [{"fn": "redshirt", "args": ["$state", "nobody-at-all", True]}]
    for p in R.sample(rows, min(8, len(rows))):
        steps.append({"fn": "redshirt", "args": ["$state", p["id"], R.choice((True, False, 1, 0, None))]})
    steps.append({"fn": "_apply_redshirts", "args": ["$state"]})
    steps.append({"fn": "_apply_redshirts", "args": ["$state"]})
    steps.append({"fn": "redshirt", "args": ["$state", rows[0]["id"] if rows else "x", True]})
    steps.append({"fn": "_run_draft", "args": ["$state"]})
    run_case("redshirts at the Departures step", st, snap, steps, fresh=True,
             watch=[["league", "teams", me, "roster"], ["offseason", "redshirts"], ["offseason", "departures"]])
    # one of yours changed class since the list was made (he is skipped), one left
    patch = []
    if len(rows) > 2:
        i = next(i for i, c in enumerate(st["league"]["teams"][me]["roster"]) if c["id"] == rows[1]["id"])
        patch = [(["league", "teams", me, "roster", i, "cls"], "SR"), (["offseason", "redshirts", "players", 2, "id"], "gone")]
    run_case("_apply_redshirts with a row that no longer fits", st, snap, [{"fn": "_apply_redshirts", "args": ["$state"]}], fresh=True, patch=patch,
             watch=[["league", "teams", me, "roster"], ["offseason", "redshirts"]])
    run_case("_run_draft with no draft kept", st, snap, [{"fn": "_run_draft", "args": ["$state"]}], fresh=True, patch=[(["offseason", "draft"], {})],
             watch=[["offseason", "departures"], ["offseason", "draft"]])
    # the draft run again from its scores (as a save made before it ran)
    run_case("_run_draft from the scores", st, snap, [{"fn": "_run_draft", "args": ["$state"]}], fresh=True,
             patch=[(["offseason", "draft", "done"], False)], watch=[["offseason", "departures"], ["offseason", "draft"]])


# ----- the careers -----------------------------------------------------------------------------------------------------

def played(me, seed):
    """A real career's first two seasons, each played to its end (kept as pickles in OUT)."""
    one, two = out / f"played_{me}_{seed}_y1.pkl", out / f"played_{me}_{seed}_y2.pkl"
    if not (one.exists() and two.exists()):
        st = season.new_season(me, "full", seed=seed, career=True)
        while not st["done"]:
            st = season.advance(st, auto_recruit=True)
            print("    season 1, week", st["current_week"], flush=True)
        pickle.dump(st, open(one, "wb"))
        offseason.start(st)
        offseason.run_all(st)
        st = offseason.next_season(st)
        while not st["done"]:
            st = season.advance(st, auto_recruit=True)
            print("    season 2, week", st["current_week"], flush=True)
        pickle.dump(st, open(two, "wb"))
    return pickle.load(open(one, "rb")), pickle.load(open(two, "rb"))


def walk(tag, st):
    """One offseason, start to ready, with the part's work written down along the way."""
    print(tag, flush=True)
    Cur.tag, Cur.state, Cur.natural = tag, st, True
    recruiting.reset_caches()
    usage = offseason._usage(st)
    off = offseason.start(st)
    Cur.natural = False
    direct_start(tag, st, usage)
    Cur.natural = True
    off["auto"] = True
    offseason.advance(st)
    assert off["stage"] == "departures", off["stage"]
    Cur.natural = False
    direct_departures(tag, st)
    Cur.natural = True
    while off["stage"] != "ready":
        offseason.advance(st)
    Cur.natural = False
    print("   ", tag, "walked;", sum(COUNT.values()), "calls so far", flush=True)


def promised(st):
    """real2: six of yours promised a start for the season just played (five judged, one not), three kept home."""
    R = random.Random("offseason-part2-promised")
    year = season.season_year(st)
    rows = [p for p in st["league"]["teams"][st["team"]]["roster"] if p["cls"] not in ("SR", "SRRS")]
    picked = R.sample(rows, 8)
    for p, band, kind, big_ in zip(picked[:5], ("kept", "bent", "broken", "broken", "bent"), ("shy", "cocky", None, "business", "shy"), (False, True, True, False, False)):
        p["promised"] = year
        MADE_BANDS[p["id"]] = {"band": band, "score": round(R.random(), 3), "benched_big": big_, "personality": kind}
    picked[5]["promised"] = year
    for p in picked[5:]:
        p["kept"] = year
    MADE_BANDS["not-on-your-roster"] = {"band": "broken", "score": 0.1, "benched_big": False, "personality": "shy"}


fake = season.new_season("boise-state", "full", seed=3, career=True)
test_offseason.finished(fake)
walk("fake", fake)
if not QUICK:
    one, two = played("georgia", 7)
    walk("real1", one)
    promised(two)
    walk("real2", two)
    MADE_BANDS.clear()
CASES.close()

# ----- what the Node script needs of the file's other parts ------------------------------------------------------------

MINE = ("STORY_OTHERS", "LIFE_KEEP", "STARTERS", "PORTAL_WEEKS_DONE")        # the constants this part defines: compared, not given


def const(v):
    if isinstance(v, (set, frozenset)):
        return {"$set": sorted(v)}
    if isinstance(v, tuple):
        return [const(x) for x in v]
    if isinstance(v, dict):
        return {str(k): const(x) for k, x in v.items()}
    return v


consts = {k: const(v) for k, v in vars(offseason).items() if k.isupper() and isinstance(v, (int, float, str, tuple, dict, set, frozenset, list))}
(out / "setup.json").write_text(json.dumps({
    "offseason": {k: v for k, v in consts.items() if k not in MINE}, "mine": {k: consts[k] for k in MINE},
    "recruiting": {"PORTAL_STARTERS": recruiting.PORTAL_STARTERS, "PORTAL_WALK_ON": recruiting.PORTAL_WALK_ON},
    "BENT_MULT": promises.BENT_MULT, "count": COUNT}))
print(json.dumps(COUNT, indent=0).replace("\n", " "))
print(sum(COUNT.values()), "calls of", len(COUNT), "functions written to", out)
