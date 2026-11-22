"""Python's answers for career_js/recruiting/part1.js (coach_career/recruiting.py lines 1 to 814), as JSON for
recruiting_part1_compare.mjs to hold the JavaScript to:

    python3 career_js/test/recruiting_part1_reference.py OUTDIR && node career_js/test/recruiting_part1_compare.mjs OUTDIR

A real seeded career (ohio-state, seed 5) is played by the Python to weeks 2, 6, 13, into the dead period, and through
the offseason into the portal's second week; its states are kept in OUTDIR as pickles (state_<name>.pkl) and played
only when they are missing. What it writes:
  static.json        the part's names and constants, and the functions that need no career (_miles, _logistic, _interp,
                     _percentile, market_value, is_lowball, _group, the team models, _priorities, tilt_for, nil_ask, _home)
  start_<seed>.json  recruiting.start on a new career (the class, converted; persona's draws and the truths replayed)
  snap_<name>.json   a state, then a list of calls made on it in order with Python's answers, and what the state held
                     after (contacts, scenes, asks, groups, truths, reads). What the part asked the other parts of
                     recruiting.py (interest, pending, _winning, _five, _returning, _group_of, _truths, reset_caches) and
                     persona is recorded per question, in order (`rec`), and replayed by the compare script."""
import ast
import json
import math
import os
import pickle
import random
import struct
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("CFP_SEASONS_DIR", tempfile.mkdtemp())
os.environ.setdefault("SIM_WORKERS", "1")

from sim import season                                              # noqa: E402
from coach_career import offseason, persona, recruiting             # noqa: E402
from teamdata import build_teams                                    # noqa: E402

TEAM, SEED = "ohio-state", 5
LAST_LINE = 814                       # the part's last line of coach_career/recruiting.py
SNAPS = ("w02", "w06", "w13", "dead", "portal")

REC = None            # what the part asked the others during a snapshot: {"name:[key]": [answers in order]}
DEPTH = 0             # only the part's own questions are recorded, not what an answer goes on to ask


def bits(x) -> str:
    return struct.pack(">d", float(x)).hex()


def jclone(v):
    return json.loads(json.dumps(v))


def plain(v):
    """A constant as JSON: a set as its sorted members, a tuple as a list."""
    if isinstance(v, (set, frozenset)):
        return {"__set__": sorted(v)}
    if isinstance(v, (list, tuple)):
        return [plain(x) for x in v]
    if isinstance(v, dict):
        return {str(k): plain(x) for k, x in v.items()}
    if isinstance(v, float) and math.isinf(v):
        return "inf"
    if isinstance(v, Path):
        return "path"
    return v


def record(mod, modname, name, keyfn, keep=lambda out, *a, **k: out):
    orig = getattr(mod, name)

    def w(*a, **k):
        global DEPTH
        if REC is None or DEPTH:
            return orig(*a, **k)
        DEPTH += 1
        try:
            out = orig(*a, **k)
        finally:
            DEPTH -= 1
        REC.setdefault(f"{modname}.{name}:" + json.dumps(keyfn(*a, **k), separators=(",", ":")), []).append(jclone(plain(keep(out, *a, **k))))
        return out
    for extra in ("cache_clear", "cache_info"):
        if hasattr(orig, extra):
            setattr(w, extra, getattr(orig, extra))
    setattr(mod, name, w)


def install():
    record(recruiting, "recruiting", "interest", lambda state, slug, pid, win=None: [slug, pid])
    record(recruiting, "recruiting", "pending", lambda state, slug, pid: [slug, pid])
    record(recruiting, "recruiting", "_winning", lambda state: [], keep=lambda out, *a: None)
    record(recruiting, "recruiting", "_five", lambda x: [bits(x)])
    record(recruiting, "recruiting", "_returning", lambda slug, group: [slug, group])
    record(recruiting, "recruiting", "_group_of", lambda p: [p.get("id")])
    record(recruiting, "recruiting", "_truths", lambda prospects, attrs: [], keep=lambda out, prospects, attrs: {pid: p["truth"] for pid, p in prospects.items()})
    record(recruiting, "recruiting", "reset_caches", lambda: [])
    record(persona, "persona", "draw", lambda pid, seed, *a, **k: [pid, seed])
    record(persona, "persona", "nil_over", lambda state, pid: [pid])
    record(persona, "persona", "offer_mult", lambda state, pid: [pid])
    record(persona, "persona", "pester_free", lambda state, pid: [pid])


def slim_teams() -> dict:
    out = {}
    for slug, t in season.load_teams().items():
        o = {k: t[k] for k in ("fictional",) if k in t}
        for side in ("offense", "defense"):
            o[side] = [{k: p[k] for k in ("name", "position", "class", "ovr", "slug") if k in p} for p in t[side]]
        out[slug] = o
    return out


def reset_own_caches():
    recruiting._ASKS.clear()
    recruiting._TIERS = (None, {})
    recruiting._CUTS = (None, {})
    recruiting._LEAVER_CUT = (None, 0)
    recruiting._STEP_WEEK[0] = None


# ----- the career's states ---------------------------------------------------------------------------------------

def make_states(out: Path) -> None:
    st = season.new_season(TEAM, "full", seed=SEED, career=True)

    def dump(name):
        pickle.dump(st, open(out / f"state_{name}.pkl", "wb"))
        print("played to", name, flush=True)
    for w in (2, 6, 13):
        season.advance_to(st, w)
        dump(f"w{w:02d}")
    season.advance_to(st, season.CCG_WEEK)
    dump("dead")
    season.advance_to(st, season.FINAL_WEEK)
    off = offseason.start(st)
    off["auto"] = True
    while st["offseason"]["stage"] != "portal_w2":
        offseason.advance(st)
    dump("portal")


# ----- static.json ---------------------------------------------------------------------------------------------------

def part_names():
    """The part's module-level names, from the source: (functions, constants and variables)."""
    src = (ROOT / "coach_career" / "recruiting.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    funcs, consts = [], []
    for node in tree.body:
        if node.lineno > LAST_LINE:
            break
        if isinstance(node, ast.FunctionDef):
            funcs.append(node.name)
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for t in targets:
                for n in (t.elts if isinstance(t, ast.Tuple) else [t]):
                    consts.append(n.id)
    return funcs, consts


def static(out: Path, w00: dict, portal: dict) -> None:
    global REC
    rng = random.Random("recruiting-part1")
    funcs, consts = part_names()
    data = {"functions": funcs, "constants": {n: plain(getattr(recruiting, n)) for n in consts},
            "POSITION_MAP_keys": list(build_teams.POSITION_MAP)}
    model = recruiting.model()
    ps = list(w00["recruiting"]["prospects"].values())
    pps = list(portal["recruiting"]["prospects"].values())
    locs = [tm["location"] for tm in model["teams"].values() if tm.get("location") and tm["location"][0] is not None]

    pairs = [(rng.choice(ps)["home"], rng.choice(locs)) for _ in range(4000)] + [([0.0, 0.0], [0.0, 0.0]), ([40.0, -83.0], [40.0, -83.0])]
    data["miles"] = [[a, b, bits(recruiting._miles(tuple(a), tuple(b)))] for a, b in pairs]
    xs = [rng.uniform(-12, 12) for _ in range(3000)] + [0, 1, -1, 0.5, 40, -40, 800.0, -700.0]
    data["logistic"] = [[x, bits(recruiting._logistic(x))] for x in xs]
    data["interp"] = []
    for name in ("LAST_SEASON_WEIGHT", "POLL_BUMP", "COMMIT_ODDS", "NEED_FACTOR"):
        pts = getattr(recruiting, name)
        for x in [i / 2 for i in range(-4, 60)] + list(range(-2, 30)) + [rng.uniform(-3, 30) for _ in range(40)]:
            data["interp"].append([name, x, recruiting._interp(pts, x)])
    data["percentile"] = []
    for _ in range(400):
        vals = sorted(rng.choice([rng.randint(20, 99), float(rng.randint(20, 99)), round(rng.uniform(20, 99), 1)]) for _ in range(rng.randint(1, 60)))
        for q in (recruiting.GEM_PERCENTILE, recruiting.BUST_PERCENTILE, 0.0, 1.0, 0.5, rng.random()):
            data["percentile"].append([vals, q, recruiting._percentile(vals, q)])
    data["market_value"] = [[pos, ovr, recruiting.market_value(pos, ovr)] for pos in list(recruiting.ASK_POS) + ["MLB", "FS", "RG", "XX"] for ovr in list(range(0, 100)) + [57.5, 70.0]]
    data["is_lowball"] = [[nil, ask, share, recruiting.is_lowball(nil, ask) if share is None else recruiting.is_lowball(nil, ask, share)]
                          for nil in (0, 1, 5, 9, 10, 15, 20, 30, 59, 60, 100) for ask in (0, 5, 19, 20, 21, 30, 60, 120, 200) for share in (None, 0.5, 0.8)]
    eas = sorted({p["ea_position"] for p in ps} | set(build_teams.POSITION_MAP) | set(build_teams.POSITION_MAP.values()) | {"XX", "ATH"})
    data["group"] = [[ea, recruiting._group(ea)] for ea in eas]

    # the team models, the built-in ones and a league's own over them
    slugs = list(model["teams"]) + ["nowhere-state"]
    seq = []
    REC = {}

    def models_step(what, models):
        before = len(REC.get("recruiting.reset_caches:[]", []))
        recruiting.use_league_models(models)
        seq.append({"what": what, "models": models, "resets": len(REC.get("recruiting.reset_caches:[]", [])) - before,
                    "team_model": {s: recruiting._team_model(s) for s in slugs[:6] + slugs[-3:] + list((models or {}))},
                    "baseline": {s: recruiting._baseline(s) for s in slugs + list((models or {}))}})
    recruiting.use_league_models({})
    models_step("none", {})
    own = {slugs[0]: dict(jclone(model["teams"][slugs[0]]), strength={"baseline": 0.123}), "alder-tech": jclone(model["teams"][slugs[5]]),
           "no-strength": {"location": [40.0, -80.0]}, "empty-strength": {"strength": {}, "x": 1}, "zero": {"strength": {"baseline": 0.0}}}
    models_step("own", own)
    models_step("own again (an equal copy, keys in another order)", {k: jclone(own[k]) for k in reversed(list(own))})
    models_step("changed", dict(own, zero={"strength": {"baseline": 0.5}}))
    models_step("None", None)
    models_step("{} again", {})
    data["models"] = seq
    REC = None

    # priorities and leans
    data["priorities"] = []
    tilts = [None, {}, {"nil": 1.5, "exposure": 2.25}, {"proximity": 1.5, "stability": 2.25, "academics": 1.5, "playing_time": 1.5}]
    for i, p in enumerate(ps + pps):
        table = [None, "PRIORITY_ODDS", "PORTAL_PRIORITY_ODDS", "PORTAL_TOP_PRIORITY_ODDS"][i % 4]
        tilt = tilts[(i // 4) % 4]
        data["priorities"].append([p["id"], table, tilt, recruiting._priorities(p["id"], getattr(recruiting, table) if table else None, tilt)])
    data["tilt_for"] = []
    REC = {}
    deciders = list(recruiting.TILTS["decider"]) + [None, "nobody"]
    personalities = list(recruiting.TILTS["personality"]) + [None]
    for i in range(1500):
        p = {"id": f"t{i}"}
        if rng.random() < 0.8:
            p["stars"] = rng.choice([5, 4, 3, 2, None])
        if rng.random() < 0.4:
            p["tier"] = rng.choice([5, 4, 3, 2])
        kind = rng.random()
        if kind < 0.5:
            p["group"] = rng.choice(list(recruiting.STARTERS))
        elif kind < 0.85:
            p["ea_position"] = rng.choice(eas)
        d = {}
        if rng.random() < 0.9:
            d["decider"] = rng.choice(deciders)
        if rng.random() < 0.9:
            d["personality"] = rng.choice(personalities)
        before = jclone(p)
        ret = recruiting.tilt_for(p, d)
        data["tilt_for"].append([before, d, list(ret.items()), jclone(p)])
    for p in (ps + pps)[::7]:
        d = persona.draw(p["id"], SEED, portal=bool(p.get("portal")))
        data["tilt_for"].append([jclone({k: p[k] for k in ("id", "stars", "tier", "group", "ea_position") if k in p}), jclone(d), list(recruiting.tilt_for(p, d).items()), None])
    data["tilt_rec"] = REC
    REC = None

    keep = ("id", "stars", "ea_position", "portal", "ovr")
    data["nil_ask"] = [[{k: p[k] for k in keep if k in p}, year, seed, recruiting.nil_ask(p, year, seed)]
                       for i, p in enumerate(ps + pps) for year, seed in ((2027, SEED), (2026 + i % 5, [0, 7, 123456789, "abc"][i % 4]))]
    homes = [{"hometown": p["hometown"]} for p in ps + pps]
    towns = model["generation"]["towns"]
    homes += [{"hometown": {"state": s}} for s in list(towns)] + [{"hometown": {"lat": None, "lon": None, "state": s}} for s in list(towns)[:10]]
    homes += [{"hometown": {}}, {"hometown": {"state": "ZZ"}}, {"hometown": {"state": None}}, {"hometown": {"lat": 0, "lon": 0}}, {"hometown": {"lat": 12.5, "lon": -3.25, "state": "TX"}}]
    data["home"] = [[h, recruiting._home(h)] for h in homes]
    (out / "static.json").write_text(json.dumps(data), encoding="utf-8")
    print("static:", {k: len(v) for k, v in data.items() if isinstance(v, list)}, flush=True)


# ----- start_<seed>.json -------------------------------------------------------------------------------------------

def starts(out: Path) -> None:
    global REC
    season.use_league(None)
    recruiting.use_league_models({})
    teams = slim_teams()
    (out / "teams_start.json").write_text(json.dumps(teams), encoding="utf-8")
    real_stories = persona.apply_stories
    for seed, year in ((5, None), (11, 2028), (None, None)):
        state = {} if seed is None else {"rng_state": seed}
        REC = {}
        calls = []
        persona.apply_stories = lambda s: calls.append(1)          # the class as start left it for the stories
        try:
            recruiting.start(state) if year is None else recruiting.start(state, year)
        finally:
            persona.apply_stories = real_stories
        rec, REC = REC, None
        assert calls == [1]
        (out / f"start_{seed}.json").write_text(json.dumps({"seed": seed, "year": year, "rec": rec, "state": state}), encoding="utf-8")
        print("start", seed, len(state["recruiting"]["prospects"]), state["recruiting"]["generational"], flush=True)


# ----- snap_<name>.json ----------------------------------------------------------------------------------------------

def inject(state: dict, rng: random.Random) -> None:
    """Things a real state rarely holds, put there so the part's branches are taken: open and stale scenes, in-home
    visits with and without their log lines, cooled and pestered contacts, asks known and narrowed, portal marks."""
    rc, me, week = state["recruiting"], state["team"], state["current_week"]
    pids = list(rc["prospects"])
    mine = [pid for pid, by in rc["contacts"].items() if me in by and pid in rc["prospects"]]
    scenes = rc.setdefault("scenes", {})
    for i, pid in enumerate(rng.sample(pids, 12)):
        scenes.setdefault(me if i % 3 else "michigan", {})[pid] = {"week": week if i % 2 else week - 1, "action": "call"}
    kinds = ["present", "pitch", "contact+pitch", "contact", "none", "scene", "other-week", "other-action"]
    for i, pid in enumerate(rng.sample(pids, 32) + mine[:8]):
        c = rc["contacts"].setdefault(pid, {}).setdefault(me, {"n": 0, "hc_week": None})
        w = max(1, week - i % 3)
        c["hc_week"] = w
        kind = kinds[i % len(kinds)]
        e = {"week": w, "pid": pid, "school": me, "action": "hc_visit", "kind": "contact"}
        if kind in ("present", "pitch"):
            e["kind"] = kind
        elif kind == "contact+pitch":
            e["pitch"] = "nil"
        elif kind == "other-week":
            e.update(kind="present", week=w + 1)
        elif kind == "other-action":
            e.update(kind="present", action="call")
        elif kind == "scene":
            scenes.setdefault(me, {})[pid] = {"week": week, "action": "hc_visit"}
        if kind not in ("none", "scene"):
            rc["log"].insert(rng.randrange(len(rc["log"]) + 1), e)
    for i, pid in enumerate(rng.sample(pids, 40) + mine[8:30]):
        c = rc["contacts"].setdefault(pid, {}).setdefault(me, {"n": 0, "hc_week": None})
        c["n"] = max(c.get("n", 0), rng.choice([0, 2, 3, 4, 6]))
        if i % 4 == 0:
            c["cooled_until"] = week + rng.choice([-1, 0, 1, 3])
        if i % 5 == 0:
            c["pester"] = rng.randint(1, 3)
            c["ask_mult"] = round(recruiting.PESTER_ASK ** c["pester"], 4)
        if i % 3 == 0:
            c["asked"] = rng.choice([True, "range", None])
    if rc.get("portal"):
        for pid in rng.sample(pids, 30):
            for slug in rng.sample(list(rc["lists"][pid]) or [me], 1):
                c = rc["contacts"].setdefault(pid, {}).setdefault(slug, {"n": 1, "hc_week": None})
                c["week"] = {"message": rng.choice([1, 2, 4, 5, 20, 0, None]), "call": rng.choice([1, 3, 20, 2.0])}


def snapshot(out: Path, name: str) -> None:
    global REC
    state = pickle.load(open(out / f"state_{name}.pkl", "rb"))
    season.activate(state)
    rc, me = state["recruiting"], state["team"]
    rng = random.Random(f"snap-{name}")
    inject(state, rng)
    reset_own_caches()
    pros = rc["prospects"]
    pids = list(pros)
    by_rank = sorted(pids, key=lambda q: pros[q].get("rank") or 9999)
    mine = [pid for pid, by in rc["contacts"].items() if me in by and pid in pros]
    offered = [pid for pid in rc["offers"].get(me, []) if pid in pros]
    committed = [pid for pid in pids if rc["status"][pid]["committed"]]
    sample = list(dict.fromkeys(by_rank[:25] + rng.sample(pids, 45) + mine[:45] + offered[:20] + rng.sample(committed, min(20, len(committed)))))
    fbs = recruiting.fbs_schools(state)

    keep = {k: state[k] for k in ("id", "team", "current_week", "rng_state") if k in state}
    keep["recruiting"] = rc
    if rc.get("portal"):
        keep["league"] = {"teams": {s: {"roster": [{k: c[k] for k in ("pos", "o", "n", "cls", "id")} for c in t["roster"]]}
                                    for s, t in state["league"]["teams"].items()}}
    data = {"name": name, "state": jclone(keep), "teams": slim_teams(),
            "season": {"CCG_WEEK": season.CCG_WEEK, "FINAL_WEEK": season.FINAL_WEEK},
            "offseason": {"GROUP": offseason.GROUP, "UNDERCLASS_ELIGIBLE": sorted(offseason.UNDERCLASS_ELIGIBLE)},
            "POS_247_OF": recruiting.POS_247_OF}
    cases = []
    REC = {}

    def call(fn, *args, show=None):
        ret = getattr(recruiting, fn)(*[state if a == "$state" else rc if a == "$rc" else pros[a[3:]] if isinstance(a, str) and a.startswith("$p:") else a
                                        for a in args])
        cases.append({"fn": fn, "args": list(args), "ret": jclone(plain(show(ret) if show else ret))})
        return ret

    def op(what, **more):
        cases.append(dict(more, op=what))

    call("fbs_schools", "$state")
    call("_early_leaver_cut", "$state")
    call("_early_leaver_cut", "$state")
    call("_tiers", "$rc", show=lambda r: list(r.items()))
    call("_tiers", "$rc", show=lambda r: len(r))
    call("flag_cuts", "$rc", show=lambda r: [[k, list(v)] for k, v in r.items()])
    call("flag_cuts", "$rc", show=lambda r: [[k, list(v)] for k, v in r.items()])
    call("draw_generational", "$rc")
    call("_ck", "$rc")
    for fn in ("closed", "is_portal", "contact_week"):
        call(fn, "$state")
    op("step_week", week=7)
    recruiting._STEP_WEEK[0] = 7
    call("contact_week", "$state")
    op("step_week", week=None)
    recruiting._STEP_WEEK[0] = None
    for fn in ("close_week", "early_signing_week", "signing_week"):
        call(fn)
    for fn in ("closed", "is_portal", "heal_contacts", "upgrade_generational", "upgrade_asks"):       # nothing to read
        cases.append({"fn": fn, "args": [{}], "ret": getattr(recruiting, fn)({})})
        cases.append({"fn": fn, "args": [{"recruiting": None, "current_week": 30}], "ret": getattr(recruiting, fn)({"recruiting": None, "current_week": 30})})
    cases.append({"fn": "is_generational", "args": [{}, "x"], "ret": recruiting.is_generational({}, "x")})

    for i, pid in enumerate(sample):
        p = pros[pid]
        on_list = list(rc["lists"][pid])
        slugs = list(dict.fromkeys([me] + on_list[:3] + rng.sample(on_list, min(2, len(on_list))) + rng.sample(fbs, 2)))
        call("tier_of", f"$p:{pid}")
        call("is_generational", "$state", pid)
        call("attributes", "$state", f"$p:{pid}", show=lambda r: list(r.items()))
        call("attributes", "$state", f"$p:{pid}", "ratings", show=lambda r: list(r.items()))
        call("_home", f"$p:{pid}")
        call("_group", p["ea_position"])
        for slug in slugs:
            call("depth_place", "$state", slug, pid)
            call("_ahead", "$state", slug, rng.choice(list(recruiting.STARTERS)), rng.choice([p["ovr"], 30, 55.5, 80]))
            call("ahead_of", "$state", slug, pid)
            call("other_offered", "$state", slug, pid)
            call("hc_visit_week", "$state", slug, pid)
            call("pesters", "$state", slug, pid)
            call("_pester_exempt", "$state", slug, pid)
            call("would_pester", "$state", slug, pid)
            call("not_considering", "$state", slug, pid)
            if i % 3 == 0:
                call("not_considering", "$state", slug, pid, {"given": 1})
            call("ask_from", "$state", slug, pid, None, True)
            call("ask_view", "$state", slug, pid, True)
            if i % 2 == 0 or slug == me:
                call("cooled", "$state", slug, pid)
                call("ask_from", "$state", slug, pid)
                call("ask_from", "$state", slug, pid, {"given": 1})
                call("ask_view", "$state", slug, pid)
                ask = recruiting.ask_from(state, slug, pid, peek=True)
                for nil in sorted({0, 5, ask // 2, ask, ask + 10, int(ask * 1.2), ask * 2, ask * 3 + 5}):
                    call("nil_value", f"$p:{pid}", nil, ask)
                    call("nil_value", f"$p:{pid}", nil, ask, "$state")
        other = sample[(i * 7 + 3) % len(sample)]
        for question in ({"kind": "roster", "about": {"name": "A Player"}}, {"kind": "recruit", "about": {"pid": other}},
                         {"kind": "recruit", "about": {"pid": "nobody"}}, {"kind": "recruit", "about": {}}):
            call("promise_holds", "$state", me, pid, question)

    # the upgrades of old saves, and the scenes and marks that never closed
    call("heal_contacts", "$state")
    call("heal_contacts", "$state")
    gone = rng.sample(pids, 150)
    op("del_nil_ask", pids=gone)
    for pid in gone:
        del pros[pid]["nil_ask"]
    call("upgrade_asks", "$state")
    call("upgrade_asks", "$state")
    call("upgrade_generational", "$state")
    op("del_generational")
    rc.pop("generational", None)
    call("upgrade_generational", "$state")
    if not rc.get("portal"):
        call("upgrade_generational", "$state")
    if name in ("w06", "portal") and all("g" in r for r in rc["reads"].values()):
        moved = rng.sample(pids, 200)
        op("move_truths", pids=moved)                       # as if the old truths were on another scale
        for pid in moved:
            for g in pros[pid]["truth"]:
                pros[pid]["truth"][g] = round(pros[pid]["truth"][g] * 0.5 + 3.3, 1)
        call("upgrade_grades", "$state")
    data["cases"] = cases
    data["rec"] = REC
    REC = None
    data["after"] = jclone({"contacts": rc["contacts"], "scenes": rc.get("scenes"), "generational": rc.get("generational"), "grades": rc.get("grades"),
                            "reads": rc["reads"], "prospects": {pid: {k: p.get(k) for k in ("nil_ask", "group", "truth")} for pid, p in pros.items()},
                            "keys": list(rc)})
    (out / f"snap_{name}.json").write_text(json.dumps(data), encoding="utf-8")
    print("snap", name, "week", state["current_week"], "cases", len(cases), "questions", sum(len(v) for v in data["rec"].values()), flush=True)


def main() -> None:
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    if not all((out / f"state_{n}.pkl").exists() for n in SNAPS):
        make_states(out)
    install()
    w00 = season.new_season(TEAM, "full", seed=SEED, career=True)
    portal = pickle.load(open(out / "state_portal.pkl", "rb"))
    static(out, w00, portal)
    starts(out)
    for name in SNAPS:
        snapshot(out, name)


if __name__ == "__main__":
    main()
