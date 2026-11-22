"""Python's answers for career_js/offseason/part1.js (coach_career/offseason.py, lines 1 to 811):
python3 career_js/test/offseason_part1_reference.py OUTDIR, then node career_js/test/offseason_part1_compare.mjs OUTDIR.

Real careers: one played from kickoff to signing day (four minutes; kept in OUTDIR as a pickle and reused), one with a
faked finished season (tests/test_offseason.py's, with a playoff and conference champions) and that career's second
season (the real offseason to the next season, then faked again: a career on its own league). With CFP_CLEAR=0 in the
environment the careers are other teams and seeds, with Clear Mode off. For each career, in this order:

  A  before the offseason: seed_key, _rng, house, _record, _usage (with depth-chart changes), _performance,
     growth_terms, record_seasons on a fresh league;
  B  offseason.start, the whole state after it;
  C  after it: season_facts, _retention_view, _retention_entries on many made-up lists of leavers (with promises
     judged week by week), stay_chance, _chance_word, _broken_promise, _keeps_promise, retain (and its errors),
     _review and review_decide on many standings with the AD, _resolve_retention on many offers and seeds,
     _open_portal, and the whole state at the end.

What part 1 asks of the file's other parts (_season_moves, _departures, _sign_classes, _redshirt_block, _would_start,
life) and of recruiting (portal_pool, portal_rc) is recorded call by call: what the state was before (so the compare
script can check what part 1 did up to there), what it was after, and the answer."""
import inspect
import json
import os
import pickle
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from coach_career import carousel, clear, league as lg, offseason, promises, recruiting    # noqa: E402
from sim import season                                                                    # noqa: E402

OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
(OUT / "leagues").mkdir(exist_ok=True)
lg.CACHE_DIR = OUT / "leagues"                 # a career's own league (its second season) is written here, not in the repo
CLEAR = bool(clear.on())
CASES = [("played", "ohio-state", 11), ("faked", "ohio-state", 5), ("second", "ohio-state", 5)] if CLEAR else \
        [("played", "troy", 23), ("faked", "smu", 9)]


def J(v):
    return json.loads(json.dumps(v))


# ----- recording what part 1 asks of the other parts and of recruiting -------------------------------------------
class Rec:
    on = False
    state = None
    base = None          # the state's text, key by key, when the recording began
    calls = []
    pending = None


def texts(st: dict) -> dict:
    return {k: json.dumps(v) for k, v in st.items()}


def wrap_part(name: str, light: bool = False) -> None:
    orig = getattr(offseason, name)
    sig = inspect.signature(orig)

    def f(*a, **kw):
        if not Rec.on:
            return orig(*a, **kw)
        bound = sig.bind(*a, **kw).arguments
        rec = {"fn": name}
        if not light:
            before = texts(Rec.state)
            rec["before"] = {k: json.loads(v) for k, v in before.items() if Rec.base.get(k) != v}
            rec["before_keys"] = list(before)
        if name == "_departures":
            rec["usage"] = J(bound["usage"])
        if name == "_would_start":
            rec["ids"], rec["starters"] = [p["id"] for p in bound["roster"]], J(bound["starters"])
        if name == "life":
            rec["args"] = [bound["p"]["id"], bound["season_year"], bound["kind"], J(bound.get("extra") or {})]
        Rec.on = False                       # what the other part asks in turn is its own business
        try:
            out = orig(*a, **kw)
        finally:
            Rec.on = True
        if not light:
            after = texts(Rec.state)
            rec["after"] = {k: json.loads(v) for k, v in after.items() if before.get(k) != v}
            rec["gone"] = [k for k in before if k not in after]
        if name == "_departures":
            rec["draft"] = J(bound.get("draft"))
            Rec.pending = out[2]
        if name == "life":
            rec["life"] = J(bound["p"]["life"])
        rec["ret"] = J(sorted(out) if isinstance(out, (set, frozenset)) else out)
        Rec.calls.append(rec)
        return out
    setattr(offseason, name, f)


def wrap_recruiting(name: str, args) -> None:
    orig = getattr(recruiting, name)
    sig = inspect.signature(orig)

    def f(*a, **kw):
        if not Rec.on:
            return orig(*a, **kw)
        bound = sig.bind(*a, **kw).arguments
        rec = {"fn": f"recruiting.{name}", "args": J([bound.get(k) for k in args])}
        Rec.on = False
        try:
            out = orig(*a, **kw)
        finally:
            Rec.on = True
        rec["ret"] = J(out)
        Rec.calls.append(rec)
        return out
    setattr(recruiting, name, f)


for fn in ("_season_moves", "_departures", "_sign_classes", "_redshirt_block"):
    wrap_part(fn)
for fn in ("_would_start", "life"):
    wrap_part(fn, light=True)
wrap_recruiting("portal_pool", ("slug", "facts"))
wrap_recruiting("portal_rc", ("entrants", "year"))


def recorded(st: dict, fn):
    """fn() with the recording on: [its answer or its error, the calls it made of the other parts]."""
    Rec.on, Rec.state, Rec.calls = True, st, []
    try:
        out = fn()
    finally:
        Rec.on = False
    return out, Rec.calls


# ----- real careers ----------------------------------------------------------------------------------------------
def played(slug: str, seed: int) -> dict:
    """A career's first season played to signing day (kept as a pickle beside the answers)."""
    keep = OUT / f"played-{slug}-{seed}-{'clear' if CLEAR else 'words'}.pkl"
    if keep.exists():
        return pickle.loads(keep.read_bytes())
    st = season.new_season(slug, "full", seed=seed, career=True)
    while not st.get("done"):
        st = season.advance(st)
    keep.write_bytes(pickle.dumps(st))
    return st


def finished(st: dict) -> None:
    """Every game played (the better team usually wins), a playoff of twelve and each conference's champion,
    every school's class signed, season over (career_js/test/carousel_reference.py's)."""
    rng = random.Random(1)
    teams = season.load_teams()
    for g in st["games"].values():
        h, a = teams[g["home"]]["team_ratings"]["overall"], teams[g["away"]]["team_ratings"]["overall"]
        hs = rng.randint(10, 45)
        win = rng.random() < 1 / (1 + 10 ** ((a - h) / 12))
        g.update(played=True, home_score=hs if win else max(0, hs - rng.randint(1, 20)), away_score=hs - rng.randint(1, 20) if win else hs)
        if g["home_score"] == g["away_score"]:
            g["home_score"] += 3
    recs = season._records(st)
    fbs = [s for s, t in teams.items() if not t["fictional"]]
    best = sorted(fbs, key=lambda s: (-recs[s]["wins"], s))
    st["champions"] = {}
    for s in best:
        st["champions"].setdefault(teams[s]["conference"], s)
    field = best[:12]
    model = next(g for g in st["games"].values() if g["kind"] == "regular")
    pairs = [(field[4 + i], field[11 - i], False) for i in range(4)] + [(field[i], field[4 + i], True) for i in range(4)] \
        + [(field[0], field[1], True), (field[2], field[3], True), (field[0], field[2], True)]
    for i, (home, away, neutral) in enumerate(pairs):
        st["games"][f"99000{i:02d}"] = dict(model, home=home, away=away, kind="playoff", neutral=neutral, played=True, conference_game=False,
                                            home_score=31, away_score=17 + i, week=season.FINAL_WEEK, event_id=f"99000{i:02d}")
    rc = st["recruiting"]
    pids = sorted(rc["prospects"], key=lambda p: rc["prospects"][p]["rank"])
    for i, pid in enumerate(pids[:len(fbs) * 21]):
        rc["status"][pid]["signed"] = fbs[i % len(fbs)]
    st.update(done=True, current_week=season.FINAL_WEEK, champion=field[0])


def second_season(slug: str, seed: int) -> dict:
    """The faked career's next season on its own league (the real offseason, walked on Auto), faked to its end too."""
    st = season.new_season(slug, "full", seed=seed, career=True)
    finished(st)
    off = offseason.start(st)
    off["auto"] = True
    for e in off["retention"]["players"][:6]:                # kept home with a promise: rows marked `kept` and `promised`
        e["offers"].update(nil=0, promise=True)
    while off["stage"] != "ready":
        offseason.advance(st)
    new = offseason.next_season(st)
    season.activate(new)
    finished(new)
    return new


# ----- the checks ------------------------------------------------------------------------------------------------
def section_a(st: dict, add) -> None:
    me = st["team"]
    teams = season.load_teams()
    add("seed_key", [offseason.seed_key(st), offseason.seed_key({"id": "abc123", "seed": None}), offseason.seed_key({"id": "x", "seed": 0}),
                     offseason.seed_key({"id": "only-id"})])
    for what, s in (("retention", st), ("x", {"id": "abc", "year": 2031}), ("y", {"seed": 7}), ("z", {"seed": 7, "year": None})):
        r = offseason._rng(s, what)
        add(f"_rng {what}", [r.random(), r.random(), r.randint(1, 1000)])
    add("house", [offseason.house(p, o) for p, o in (("QB", 71), ("K", 0), ("WR", 99), ("CB", 64.9), ("DT", 12.2))])
    add("_attrs", offseason._attrs({"attrs": ["a", "b"]}))
    add("_record", [list(offseason._record(st, s)) for s in list(teams) + ["no-such-team"]])
    add("_usage", offseason._usage(st))
    add("_usage none", offseason._usage(None) == offseason._usage({}))
    depth = {}
    for slug in (me, list(teams)[3], list(teams)[40]):         # depth-chart changes: the backups first at three roles
        t = teams[slug]
        by_role = {}
        for p in t["offense"] + t["defense"]:
            by_role.setdefault(p.get("role"), []).append(p["slug"])
        depth[slug] = {role: by_role[role][::-1] for role in ("QB", "HB", "CB") if len(by_role.get(role, [])) > 1}
    add("depth", depth)
    add("_usage depth", {s: offseason._usage({**st, "depth": depth})[s] for s in depth})
    perf = offseason._performance(st)
    add("_performance", perf)
    add("_performance order", list(perf))
    made = [None, {}, {"z": None, "honors": []}, {"z": 0.0, "honors": []}] + [{"z": z / 4, "honors": []} for z in range(-12, 17)]
    kinds = list(offseason.HONOR_ROOM) + ["unknown"]
    rnd = random.Random("growth")
    for _ in range(150):
        hs = [[rnd.choice(kinds), rnd.choice(["Award A", "Award B", "Award C", "Award D", "Award E"])] for _ in range(rnd.randint(0, 6))]
        made.append({"z": rnd.choice([None, round(rnd.uniform(-2.5, 3.5), 2)]), "honors": hs})
    add("growth made", made)
    add("growth_terms made", [list(offseason.growth_terms(p)) for p in made])
    add("growth_terms real", [list(offseason.growth_terms(p)) for p in perf.values()])
    # record_seasons on a league of its own (the career's when it has one, else next year's from the base)
    lgd = J(st["league"]) if st.get("league") else lg.from_base(season.season_year(st) + 1)
    rows = [c for t in lgd["teams"].values() for c in t["roster"]]
    year = season.season_year(st)
    for i, c in enumerate(rows[::7]):                         # some with a long history already, some with this year's line
        c["hist"] = [{"year": year - 9 + k, "team": "old"} for k in range(i % 11)] + ([{"year": year, "team": "now"}] if i % 5 == 0 else [])
    add("record_seasons n", offseason.record_seasons(st, lgd))
    add("record_seasons hist", [[c["id"], c.get("hist")] for c in rows])
    add("record_seasons again", offseason.record_seasons(st, lgd))
    add("record_seasons no stats", offseason.record_seasons({k: v for k, v in st.items() if k != "season_stats"}, lg.from_base(year + 1)) if not st.get("league") else None)


def pending_lists(st: dict, pending: list, tag: str) -> list:
    """Made-up lists of leavers for _retention_entries: the real ones, then every third player of your roster, each
    with his reasons drawn; some with a promise judged week by week (kept, bent, broken)."""
    me = st["team"]
    lgd = st["league"]
    roster = lgd["teams"][me]["roster"]
    year = season.season_year(st)
    rnd = random.Random(f"pending-{tag}")
    out = [{"setup": None, "pending": J(pending)}, {"setup": None, "pending": []}]
    for n in range(6):
        items, rows, weeks = [], {}, {}
        base = J(pending) + [{"ev": {"id": p["id"], "name": p["n"], "pos": p["pos"], "cls": p["cls"], "team": me, "kind": "portal"},
                              "use": "starter", "losing": False, "winning": True, "p4": True, "driver": None, "shortfall": None, "elite": False}
                             for p in roster[n % 3::3]]
        base.append({"ev": {"id": "nobody-here", "kind": "portal", "cls": "SO"}, "use": "bench", "losing": False, "winning": False, "p4": True})
        for item in base:
            item["use"] = rnd.choice(["starter", "rotation", "bench"])
            item["losing"] = rnd.random() < 0.3
            item["winning"] = not item["losing"] and rnd.random() < 0.7
            item["p4"] = rnd.random() < 0.6
            item["driver"] = rnd.choice([None, None, None, "deal", "better_coach", "slipping", "promised"])
            item["shortfall"] = rnd.choice([None, 0, 15, 240]) if item["driver"] == "deal" or rnd.random() < 0.3 else None
            item["elite"] = rnd.random() < 0.2
            if rnd.random() < 0.3:
                item["ev"]["kind"] = "declared"
                item["ev"]["proj"] = rnd.choice([None, 1, 20, 32, 33, 64, 100, 101, 180, 224, 225, 257, 300])
            elif rnd.random() < 0.5:
                item["ev"].pop("proj", None)
            if n >= 2 and rnd.random() < 0.4:                 # promised a start this season, with a weekly record
                pid = item["ev"]["id"]
                rows[pid] = {"promised": year}
                if rnd.random() < 0.5:
                    rows[pid]["promised_again"] = rnd.choice([year, year - 1, None])
                if rnd.random() < 0.5:
                    rows[pid]["persona"] = {"personality": rnd.choice(["guarded", "cocky", "business", "loyal", "humble"])}
                start = rnd.choice([0.0, 0.2, 0.5, 0.8, 1.0])
                weeks[pid] = [{"week": w, "started": rnd.random() < start, "injured": rnd.random() < 0.05, "big": rnd.random() < 0.2}
                              for w in range(1, rnd.randint(4, 15))]
            if rnd.random() < 0.1:
                del item["elite"], item["winning"]
            items.append(item)
        setup = {"rows": rows, "promises": {str(year): weeks}} if rows else None
        out.append({"setup": setup, "pending": items})
    return out


def with_setup(st: dict, setup, fn):
    """fn() with the promise records and the roster rows' marks of a made-up list in place, taken away after."""
    if not setup:
        return fn()
    me = st["team"]
    by_id = {p["id"]: p for p in st["league"]["teams"][me]["roster"]}
    had = "promises" in st, st.get("promises")
    old = {pid: {k: (k in by_id[pid], by_id[pid].get(k)) for k in marks} for pid, marks in setup["rows"].items() if pid in by_id}
    st["promises"] = J(setup["promises"])
    for pid, marks in setup["rows"].items():
        if pid in by_id:
            by_id[pid].update(J(marks))
    try:
        return fn()
    finally:
        for pid, marks in old.items():
            for k, (was, v) in marks.items():
                if was:
                    by_id[pid][k] = v
                else:
                    by_id[pid].pop(k, None)
        if had[0]:
            st["promises"] = had[1]
        else:
            del st["promises"]


def put_market(lgd: dict, market) -> None:
    """The coaches' market as it was (a league that has none yet has no key for it)."""
    if market is None:
        lgd.pop("market", None)
    else:
        lgd["market"] = J(market)


def attempt(fn):
    try:
        return J(fn())
    except (offseason.ReviewError, offseason.RetentionError) as e:
        return {"error": [type(e).__name__, e.code, str(e)]}


def section_c(st: dict, add, tag: str, pending: list, ref: dict) -> None:
    me, off, lgd = st["team"], st["offseason"], st["league"]
    year = off["year"]
    team = lgd["teams"][me]
    add("start again", offseason.start(st) is off)
    add("season_facts", offseason.season_facts(st))
    rv = off["review"]
    off["review"] = {k: v for k, v in rv.items() if k != "met"}
    add("season_facts no met", offseason.season_facts(st)[me])
    off["review"] = {**rv, "met": not rv["met"]}
    add("season_facts flipped", offseason.season_facts(st)[me])
    off["review"] = rv
    add("_retention_view", offseason._retention_view(st))
    add("_retention_view none", offseason._retention_view({"team": me, "offseason": {}}))
    add("_retention_entries no team", offseason._retention_entries({**st, "team": "no-such-team"}, lgd, pending or [{"ev": {}}]))

    # _retention_entries on made-up lists
    lists = pending_lists(st, pending, tag)
    entries = []
    for i, row in enumerate(lists):
        out, calls = recorded(st, lambda: with_setup(st, row["setup"], lambda: J(offseason._retention_entries(st, lgd, row["pending"]))))
        row["out"], row["calls"] = out, calls
        entries += out
    ref["entries"] = lists

    # stay_chance: every entry seen, with what you might offer and what he might be
    rnd = random.Random(f"stay-{tag}")
    cases = []
    for e in J(off["retention"]["players"]) + entries:
        for _ in range(6):
            x = J(e)
            ask = x["ask"]["nil"]
            x["offers"]["nil"] = rnd.choice([0, 0, int(ask * 0.3), int(ask * 0.5), ask // 2, ask, 2 * ask, 5])
            x["offers"]["promise"] = rnd.random() < 0.5
            if rnd.random() < 0.1:
                del x["offers"]["nil"]
            if rnd.random() < 0.1:
                x["ask"]["nil"] = 0
            if rnd.random() < 0.3:
                x["broken_promise"] = True
                x["no_third"] = rnd.random() < 0.3
                if rnd.random() < 0.5:
                    x["personality"] = rnd.choice(["guarded", "cocky", "business", None])
            if rnd.random() < 0.15:
                x["intent"] = "draft"
                x["draft_pick"] = rnd.choice([None, 3, 32, 33, 100, 101, 250])
                x["elite"] = rnd.random() < 0.3
            if rnd.random() < 0.05:
                x["pos"] = rnd.choice([None, "XX"])
            mode = rnd.choice(["none", "state", "state", "low", "high"])
            cases.append([x, mode])
    words = {"low": {"overall": 12.0, "by_group": {"QB": -6.0}}, "high": {"overall": 88.0, "by_group": {"QB": 9.0, "OL": -30.0, "WR": 4.5}}}
    answers = []
    had = st["career"].get("word")
    for x, mode in cases:
        if mode in words:
            st["career"]["word"] = J(words[mode])
        answers.append(offseason.stay_chance(x) if mode == "none" else offseason.stay_chance(x, st))
        if mode in words:
            if had is None:
                st["career"].pop("word", None)
            else:
                st["career"]["word"] = had
    ref["stay"] = {"cases": cases, "words": words, "answers": answers}
    grid = [i / 40 for i in range(41)] + [0.65, 0.4, 0.2, 0.6499999, 0.39999, 0.19999]
    add("_chance_word", [offseason._chance_word(c) for c in grid])
    add("_broken_promise", [offseason._broken_promise(k, info, intent) for k in ("promised", "deal", "buried")
                            for info in (None, {"band": "broken"}, {"band": "kept"}, {}) for intent in ("portal", "draft")])
    add("_keeps_promise", [offseason._keeps_promise({"offers": o, **x}) for o in ({"promise": True}, {"promise": False}, {})
                           for x in ({}, {"no_third": True}, {"no_third": False}, {"no_third": None})])

    # retain: a run of moves and every error
    ret = off["retention"]
    ids = [e["id"] for e in ret["players"]]
    pool = recruiting.pool_record(st, me)["pool"]
    moves = [["nobody", "meet", 0], [ids[0] if ids else "x", "dance", 0]]
    for i, pid in enumerate(ids):
        ask = next(e for e in ret["players"] if e["id"] == pid)["ask"]["nil"]
        if i % 2 == 0:
            moves.append([pid, "meet", 0])
        if i % 3 == 0:
            moves.append([pid, "promise", 0])
        if i % 4 == 0:
            moves += [[pid, "nil", -5], [pid, "nil", pool + 5], [pid, "nil", min(ask, pool // 4)], [pid, "nil", min(ask // 2, pool // 4)]]
        if i % 5 == 3:
            moves += [[pid, "nil", 10], [pid, "release", 0]]
        if i % 7 == 6:
            moves += [[pid, "release", 0], [pid, "promise", 0]]
    if ids:
        moves.append([ids[-1], "nil", 7.0])
    ref["moves"] = moves
    add("retain", [attempt(lambda: offseason.retain(st, pid, action, nil)) for pid, action, nil in moves])
    add("retain default nil", attempt(lambda: offseason.retain(st, ids[0], "nil")) if ids else None)
    off["stage"] = "departures"
    add("retain wrong stage", attempt(lambda: offseason.retain(st, "x", "meet")))
    off["stage"] = "retention"
    off["fired"] = True
    add("retain fired", attempt(lambda: offseason.retain(st, "x", "meet")))
    del off["fired"]
    add("retain no offseason", attempt(lambda: offseason.retain({}, "x", "meet")))
    add("_retention_spent", [offseason._retention_spent(off), offseason._retention_spent({}), offseason._retention_spent({"retention": None})])
    add("_retention_view after", offseason._retention_view(st))

    # the meeting with the AD: many standings, every answer
    saved = {"ad": J(team["ad"]), "hc": J(team["coaches"]["head_coach"]), "market": J(lgd.get("market")), "review": off["review"],
             "staff": J(st["career"]["staff"]), "seed": st.get("seed"), "coaches": J(team["coaches"])}
    coords = [s["id"] for s in st["career"]["staff"] if s["role"] in offseason.STAFF_ROLES]
    reviews = []
    n = 0
    for sec in (2, 7, 12, 24, 30, 39, 45, 70, 96):
        for since in (year - 1, year - 6):
            for ult in (None, year):
                n += 1
                bare = n % 7 == 3                      # no coordinators on your staff: nothing to offer
                team["ad"] = {"patience": saved["ad"]["patience"], "security": sec, **({"ultimatum": ult} if ult else {})}
                team["coaches"]["head_coach"]["since"] = since
                if bare:
                    st["career"]["staff"] = [s for s in saved["staff"] if s["role"] not in offseason.STAFF_ROLES]
                rv = J(offseason._review(st, lgd))
                after = J(team["ad"])
                decides = []
                for k, (action, sid) in enumerate([(o, None) for o in rv["options"] if o != "change"] + [("change", c) for c in coords]
                                                  + [("change", None), ("change", "nobody"), ("bogus", None)]):
                    team["ad"], team["coaches"] = J(after), J(saved["coaches"])
                    team["coaches"]["head_coach"]["since"] = since
                    put_market(lgd, saved["market"])
                    off["review"] = J(rv)
                    for key in ("staff_open", "fired", "auto"):
                        off.pop(key, None)
                    st["seed"] = (saved["seed"] or 0) + (k if n % 2 else 0)
                    ans = attempt(lambda: offseason.review_decide(st, action, sid) if sid is not None else offseason.review_decide(st, action))
                    market = (lgd.get("market") or {}).get("coaches") or []
                    decides.append({"action": action, "staff_id": sid, "seed": st["seed"], "answer": ans, "ad": J(team["ad"]),
                                    "review": J(off["review"]), "off": {key: off.get(key) for key in ("staff_open", "fired", "auto")},
                                    "market": [len(market), J(market[-1]) if market else None]})
                reviews.append({"ad": {"security": sec, "ultimatum": ult}, "since": since, "bare": bare, "review": rv, "ad_after": after, "decides": decides})
                st["career"]["staff"] = J(saved["staff"])
    team["ad"], team["coaches"], off["review"], st["seed"] = J(saved["ad"]), J(saved["coaches"]), saved["review"], saved["seed"]
    put_market(lgd, saved["market"])
    for key in ("staff_open", "fired", "auto"):
        off.pop(key, None)
    ref["reviews"] = reviews
    off["review"] = J(saved["review"])
    off["stage"] = "portal_w1"
    add("review closed", attempt(lambda: offseason.review_decide(st, "case")))
    off["stage"] = "retention"
    off["review"]["decided"] = True
    add("review decided", attempt(lambda: offseason.review_decide(st, "case")))
    off["review"] = saved["review"]
    add("review none", attempt(lambda: offseason.review_decide({}, "case")))

    # _resolve_retention: many offers and seeds, the pieces it changes put back each time
    keep = {"team": J(team), "off": J(off), "pool": J(st["nil_pool"][me]), "seed": st.get("seed")}
    runs = []
    for k in range(12):
        lgd["teams"][me] = team = J(keep["team"])
        st["offseason"] = off = J(keep["off"])
        st["nil_pool"][me] = J(keep["pool"])
        st["seed"] = (keep["seed"] or 0) + k
        rnd = random.Random(f"resolve-{tag}-{k}")
        for e in off["retention"]["players"]:
            kind = k % 6
            if kind == 1:                              # everything he asks
                e["offers"].update(nil=e["ask"]["nil"], promise=True, released=False)
            elif kind == 2:                            # nothing
                e["offers"].update(nil=0, promise=False, released=False)
            elif kind == 3:                            # let them all go
                e["offers"].update(nil=0, promise=False, released=True)
            elif kind >= 4:                            # a mix, some with a promise broken before
                e["offers"].update(nil=rnd.choice([0, e["ask"]["nil"], e["ask"]["nil"] // 2]), promise=rnd.random() < 0.6, released=rnd.random() < 0.1)
                e["met"] = rnd.random() < 0.5
                if rnd.random() < 0.4:
                    e["broken_promise"], e["no_third"] = True, rnd.random() < 0.3
        if k == 7:
            off["auto"] = True
        if k == 8 and off.get("redshirts"):
            off["redshirts"]["decided"] = True
        if k == 9 and off["retention"]["players"]:    # one of them is no longer on the roster
            gone = off["retention"]["players"][0]["id"]
            team["roster"] = [p for p in team["roster"] if p["id"] != gone]
        setup = {"seed": st["seed"], "team": J(team), "off": J(off)}
        _, calls = recorded(st, lambda: offseason._resolve_retention(st))
        runs.append({"setup": setup, "calls": calls, "team": J(team), "off": J(off), "pool": J(st["nil_pool"][me])})
    lgd["teams"][me], st["offseason"], st["nil_pool"][me], st["seed"] = J(keep["team"]), J(keep["off"]), J(keep["pool"]), keep["seed"]
    off = st["offseason"]
    ref["resolves"] = runs

    # the portal opens
    before = st["recruiting"]
    _, calls = recorded(st, lambda: offseason._open_portal(st))
    ref["open_portal"] = {"calls": calls, "same_last": st.get("recruiting_last") is before}
    add("_open_portal recruiting", st["recruiting"])
    offseason._open_portal(st)                          # already open: nothing happens
    add("_open_portal again", [st.get("recruiting_last") is before, st["recruiting"]["board"], list(st)])


def run(kind: str, slug: str, seed: int) -> None:
    tag = f"{kind}-{slug}-{seed}"
    print(tag, flush=True)
    if kind == "played":
        st = played(slug, seed)
    elif kind == "faked":
        st = season.new_season(slug, "full", seed=seed, career=True)
        finished(st)
    else:
        st = second_season(slug, seed)
    st = J(st)                                           # as a save read back: text keys, lists for tuples
    season.activate(st)
    out = OUT / tag
    out.mkdir(exist_ok=True)
    (out / "state0.json").write_text(json.dumps(st))
    ref = {"tag": tag, "clear": CLEAR, "team": st["team"]}
    a = []
    section_a(st, lambda label, value: a.append([label, J(value)]))
    ref["A"] = a
    Rec.base = texts(st)
    _, calls = recorded(st, lambda: offseason.start(st))
    ref["start_calls"] = calls
    (out / "state1.json").write_text(json.dumps(st))
    c = []
    section_c(st, lambda label, value: c.append([label, J(value)]), tag, Rec.pending, ref)
    ref["C"] = c
    (out / "state2.json").write_text(json.dumps(st))
    (out / "ref.json").write_text(json.dumps(ref))
    print("  ", len(a), "checks before,", len(c), "after;", len(ref["entries"]), "lists of leavers,", len(ref["stay"]["cases"]), "stay chances,",
          len(ref["reviews"]), "reviews,", sum(len(r["decides"]) for r in ref["reviews"]), "decisions,", len(ref["resolves"]), "retention runs", flush=True)


if __name__ == "__main__":
    setup = {"clear": CLEAR, "cases": [f"{k}-{s}-{n}" for k, s, n in CASES], "leagues": str(OUT / "leagues"),
             "recruiting": {k: getattr(recruiting, k) for k in ("NIL_FLOOR", "NIL_PER_TIER", "PORTAL_STARTERS", "ASK_POS")},
             "STAFF_ROLES": offseason.STAFF_ROLES}
    done = []
    for kind, slug, seed in CASES:
        try:
            run(kind, slug, seed)
            done.append(f"{kind}-{slug}-{seed}")
        except Exception as e:                           # (the second season needs the whole offseason to walk on Auto)
            if kind != "second":
                raise
            print("   no second season:", type(e).__name__, e, flush=True)
    setup["cases"] = done
    (OUT / "setup.json").write_text(json.dumps(setup))
