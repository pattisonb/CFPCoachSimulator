"""Python's answers for career_js/persona.js, as JSON for persona_compare.mjs to hold the JavaScript to:

    python3 career_js/test/persona_reference.py OUTDIR [last week, 11] && node career_js/test/persona_compare.mjs OUTDIR

A real seeded career season is played by the Python. What it writes into OUTDIR:
  static.json      the module's constants, the league's teams as persona reads them, the fixed draws (draw, draw_style)
  apply_<seed>.json  apply_stories as recruiting.start called it on a new class (two seeds)
  step_<week>_<fn>.json  cool_quiet, bloom, twist_week, learn_styles and roll_twists as each week's step called them
  snap_<week>.json  the state at three weeks: every read-only function over a sample of prospects and schools (and the
                    portal, a class without stories, forced personas, another seed), and the functions that change the
                    state, each on a copy (every twist set off on a set of prospects, learning, contacts)
Each case holds the (slimmed) state before, what persona asked the modules that are not ported (recruiting, programs,
carousel: `stubs`, replayed by the compare script) and what Python answered and left changed (`diff`)."""
import json
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

from sim import season                                                    # noqa: E402
from coach_career import carousel, clear, persona, programs, recruiting   # noqa: E402

TEAM = "ohio-state"
SEED = 5
SNAP_WEEKS = (2, 6, 10)

OUT = None
REC = None            # what persona asked the other modules during a case: {"module.name:[key]": [answers in order]}
DEPTH = 0             # only persona's own calls are recorded, not what those calls go on to ask
READ_PID: dict = {}   # id(a prospect's read) -> his id (report_looks is keyed by him)
BLOOMERS: set = set()
LOG_BASE = 0          # the log's length when the case's state was taken: older lines that are not twists are left out
CLEAR_FORCE = None
LOW_SEC = False
SAVED: dict = {}      # week -> the whole state pickled as roll_twists was called
CAPTURE = False
COUNTS: dict = {}

P_KEEP = ("name", "stars", "composite", "rank", "id", "group", "ea_position", "priorities", "home", "hometown", "hidden",
          "nil_ask", "real", "persona")
RC_KEEP = ("year", "seed", "portal", "topics_v", "contacts", "status", "cooled_why", "traits_known", "revealed", "stories",
           "generational", "offers", "nil", "lists", "twists", "moved", "boards", "board", "class_v", "visits", "offer_weeks",
           "manual_offers", "week")


def bits(x) -> str:
    return struct.pack(">d", float(x)).hex()


def jclone(v):
    return json.loads(json.dumps(v))


def norm(v):
    """JSON has no infinity."""
    if isinstance(v, float) and v in (float("inf"), float("-inf")):
        return "Infinity" if v > 0 else "-Infinity"
    if isinstance(v, (list, tuple)):
        return [norm(x) for x in v]
    if isinstance(v, dict):
        return {k: norm(x) for k, x in v.items()}
    return v


def slim(state: dict) -> dict:
    """The state as persona reads it (and as the compare script gets it): the prospects' fields it uses, the
    recruiting block's keys it uses, each read only as whose it is, the log's twists and everything new."""
    rc = state["recruiting"]
    out = {}
    for k, v in rc.items():
        if k == "prospects":
            out[k] = {pid: {f: p[f] for f in p if f in P_KEEP} for pid, p in v.items()}
        elif k == "reads":
            out[k] = {pid: (None if r is None else {"_pid": pid}) for pid, r in v.items()}
        elif k == "log":
            out[k] = [e for i, e in enumerate(v) if i >= LOG_BASE or e.get("kind") == "twist"]
        elif k in RC_KEEP:
            out[k] = v
    s = {k: state[k] for k in ("id", "team", "current_week", "year") if k in state}
    s["games"] = state.get("games", {})
    s["recruiting"] = out
    return jclone(s)


def diff(a, b, path=(), ops=None) -> list:
    """What changed from a to b: ["set", path, value], ["del", path], ["app", path, the items added to a list]."""
    if ops is None:
        ops = []
    if type(a) is dict and type(b) is dict:
        for k in a:
            if k not in b:
                ops.append(["del", list(path) + [k]])
        for k, v in b.items():
            if k not in a:
                ops.append(["set", list(path) + [k], v])
            else:
                diff(a[k], v, path + (k,), ops)
    elif type(a) is list and type(b) is list:
        if len(a) == len(b):
            for i, (x, y) in enumerate(zip(a, b)):
                diff(x, y, path + (i,), ops)
        elif len(b) > len(a) and b[:len(a)] == a and json.dumps(b[:len(a)]) == json.dumps(a):
            ops.append(["app", list(path), b[len(a):]])
        else:
            ops.append(["set", list(path), b])
    elif isinstance(a, bool) != isinstance(b, bool) or a != b:
        ops.append(["set", list(path), b])
    return ops


def apply(obj, ops) -> None:
    for op in ops:
        at = obj
        for k in op[1][:-1]:
            at = at[k]
        if op[0] == "app":
            (at[op[1][-1]] if op[1] else at).extend(jclone(op[2]))
        elif op[0] == "del":
            del at[op[1][-1]]
        else:
            at[op[1][-1]] = jclone(op[2])


def checked_diff(before, after) -> list:
    ops = diff(before, after)
    again = jclone(before)
    apply(again, ops)
    assert json.dumps(again) == json.dumps(after), "the diff does not rebuild the state (a dict's key order moved?)"
    return ops


# ---- recording what persona asks the modules that are not ported --------------------------------------------------

def rec(mod, modname: str, name: str, keyfn, keep=lambda out, *a, **k: out, over=None) -> None:
    orig = getattr(mod, name)

    def w(*a, **k):
        global DEPTH
        if REC is None or DEPTH:
            return orig(*a, **k)
        DEPTH += 1
        try:
            out = over(orig, *a, **k) if over else orig(*a, **k)
        finally:
            DEPTH -= 1
        REC.setdefault(f"{modname}.{name}:" + json.dumps(keyfn(*a, **k), separators=(",", ":")), []).append(jclone(keep(out, *a, **k)))
        return out
    for extra in ("cache_clear", "cache_info"):
        if hasattr(orig, extra):
            setattr(w, extra, getattr(orig, extra))
    setattr(mod, name, w)


def rec_act() -> None:
    orig = recruiting._act

    def w(state, slug, pid, action, pitch=None, nil=0, *a, **k):
        global DEPTH
        if REC is None or DEPTH:
            return orig(state, slug, pid, action, pitch, nil, *a, **k)
        assert not a and not k
        before = slim(state)
        DEPTH += 1
        err, out = None, None
        try:
            out = orig(state, slug, pid, action, pitch, nil)
        except recruiting.RecruitingError as e:
            err = e
        finally:
            DEPTH -= 1
        REC.setdefault("recruiting._act:" + json.dumps([slug, pid, action, pitch, nil], separators=(",", ":")), []).append(
            {"raise": None if err is None else str(err), "ret": out, "diff": checked_diff(before, slim(state))})
        if err is not None:
            raise err
        return out
    recruiting._act = w


def hooks() -> None:
    R = recruiting
    rec(R, "recruiting", "report_looks", lambda read: [None if read is None else READ_PID[id(read)]])
    rec(R, "recruiting", "interest", lambda state, slug, pid, win=None: [slug, pid, win is not None])
    rec(R, "recruiting", "ask_from", lambda state, slug, pid, win=None, peek=False: [slug, pid, win is not None])
    rec(R, "recruiting", "_fits", lambda state, slug: [slug], lambda out, state, slug: {p: out[p] for p in BLOOMERS if p in out})
    rec(R, "recruiting", "_winning", lambda state: [], lambda out, state: {"$win": 1})
    rec(R, "recruiting", "_commits", lambda state: [])
    rec(R, "recruiting", "open_spots", lambda state, slug: [slug])
    rec(R, "recruiting", "offer_cap", lambda state, slug: [slug])
    rec(R, "recruiting", "nil_left", lambda state, slug: [slug])
    rec(R, "recruiting", "_nil", lambda state, slug: [slug], lambda out, state, slug: {"budget": out["budget"]})
    rec(R, "recruiting", "best_pitch", lambda state, slug, pid, required=False: [slug, pid, bool(required)])
    rec(R, "recruiting", "tier_of", lambda p: [p["id"], p["stars"]])
    rec(R, "recruiting", "nil_ask", lambda p, year, seed: [p["id"], p["stars"], bits(p["composite"]), year, seed])
    rec(R, "recruiting", "fbs_schools", lambda state: [])
    rec(R, "recruiting", "_baseline", lambda slug: [slug])
    rec(R, "recruiting", "_team_model", lambda slug: [slug], lambda out, slug: {k: out[k] for k in ("location", "star_share") if k in out})
    rec(R, "recruiting", "_national_share", lambda stars: [stars])
    rec(R, "recruiting", "_group_of", lambda p: [p.get("ea_position")])
    rec(R, "recruiting", "academic", lambda slug: [slug])
    rec(R, "recruiting", "academic_schools", lambda: [])
    rec(R, "recruiting", "early_signing_week", lambda: [])
    rec(R, "recruiting", "_miles", lambda a, b: [bits(a[0]), bits(a[1]), bits(b[0]), bits(b[1])])
    rec_act()
    rec(programs, "programs", "get", lambda state, slug: [slug], lambda out, state, slug: {"tier": out["tier"]})
    rec(carousel, "carousel", "ad", lambda team, slug, year=None: [slug], lambda out, team, slug, year=None: {"security": out.get("security")},
        over=lambda orig, team, slug, year=None: {"security": 12} if LOW_SEC else orig(team, slug, year))
    rec(season, "season", "season_year", lambda state: [])
    on = clear.on
    clear.on = lambda: on() if CLEAR_FORCE is None else CLEAR_FORCE


def packed(table: dict) -> dict:
    """The answers to one question, once when they are all the same."""
    return {k: (v[:1] if all(json.dumps(x) == json.dumps(v[0]) for x in v) else v) for k, v in table.items()}


def begin(state: dict) -> None:
    """Before a case, here and in the compare script: nothing kept in memory from the case before."""
    global REC, READ_PID, BLOOMERS
    REC = None
    persona._STORIES = (None, None, {})
    BLOOMERS = {pid for pid, s in persona.stories(state).items() if s["story"] == "bloomer"}
    persona._STORIES = (None, None, {})
    persona._FRONT = (None, {})
    persona._SCHOOL_STATE.clear()
    READ_PID = {id(r): pid for pid, r in (state["recruiting"].get("reads") or {}).items() if r is not None}
    REC = {}


def end() -> dict:
    global REC
    table, REC = REC, None
    return packed(table)


def write(name: str, data: dict) -> None:
    (OUT / name).write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print(f"  {name}: {(OUT / name).stat().st_size // 1024} KB", flush=True)


# ---- the calls the game itself makes, caught as they happen -----------------------------------------------------

def capture(name: str, keep) -> None:
    orig = getattr(persona, name)

    def w(state, *a):
        global LOG_BASE
        if REC is not None or not CAPTURE:
            return orig(state, *a)
        LOG_BASE = len(state["recruiting"].get("log", []))
        before = slim(state)
        if name == "roll_twists" and a[0] in SNAP_WEEKS:
            SAVED[a[0]] = pickle.dumps(state)
        begin(state)
        try:
            ret = orig(state, *a)
        finally:
            stubs = end()
        ops = checked_diff(before, slim(state))
        if keep(a, ret, ops):
            case = {"kind": "case", "pre": [], "clear": clear.on(), "calls": [[name, ["$state", *a]]], "rets": [jclone(ret)], "diff": ops, "stubs": stubs}
            tag = f"apply_{state['recruiting'].get('seed')}" if name == "apply_stories" else f"step_{a[0]:02d}_{name}"
            write(f"{tag}.json", {"week": a[0] if a else 0, "state": before, "groups": [case]})
            COUNTS[name] = COUNTS.get(name, 0) + 1
        return ret
    setattr(persona, name, w)


# ---- cases on a kept state --------------------------------------------------------------------------------------

def resolve(arg, state):
    if arg == "$state":
        return state
    if isinstance(arg, dict):
        rc = state["recruiting"]
        if "$p" in arg:
            return rc["prospects"][arg["$p"]]
        if "$tw" in arg:
            return rc["twists"][arg["$tw"]]
        if "$contact" in arg:
            return rc["contacts"][arg["$contact"][0]][arg["$contact"][1]]
        if "$sd" in arg:
            return persona.story(state, arg["$sd"])[1]
        if "$e" in arg:
            return arg["$e"]
    return arg


def call(state, fn: str, args: list, week: int):
    if fn == "$setup":
        pid, kind, seed = args
        rng = random.Random(seed)
        got = persona._setup(state, persona._Week(state, week), pid, kind, rng)
        return [got, rng.random()]
    if fn == "$rerank":
        return persona.rerank(state["recruiting"])
    if fn == "$week_games":
        return {s: [g["event_id"] for g in gs] for s, gs in persona._Week(state, args[0]).games().items()}
    if fn == "$week_homes":
        return persona._Week(state, args[0]).homes()
    if fn == "$week_security":
        wk = persona._Week(state, args[0])
        return [wk.security(args[1]), wk.security(args[1])]
    out = getattr(persona, fn)(*[resolve(a, state) for a in args])
    if fn == "_his_schools":
        return [out[0], sorted(out[1].items())]
    return out


def copy_of(base: dict, pre: list) -> dict:
    st = dict(base)
    st["recruiting"] = pickle.loads(pickle.dumps(base["recruiting"]))
    apply(st, pre)
    return st


def case(base: dict, week: int, calls: list, pre=(), clear_on=None, low=False) -> dict:
    """Calls that change the state, on a copy of it."""
    global CLEAR_FORCE, LOW_SEC
    st = copy_of(base, list(pre))
    before = slim(st)
    CLEAR_FORCE, LOW_SEC = clear_on, low
    begin(st)
    try:
        rets = [norm(jclone(norm(call(st, fn, args, week)))) for fn, args in calls]
    finally:
        stubs = end()
        used_clear = clear.on()
        CLEAR_FORCE, LOW_SEC = None, False
    return {"kind": "case", "pre": list(pre), "clear": used_clear, "calls": calls, "rets": rets, "diff": checked_diff(before, slim(st)), "stubs": stubs}


def sweep(base: dict, week: int, entries: list, pre=(), name="") -> dict:
    """Calls that only read, one after another on one copy."""
    st = copy_of(base, list(pre))
    before = json.dumps(slim(st))
    begin(st)
    done, skipped = [], 0
    try:
        for fn, args in entries:
            try:
                done.append([fn, args, norm(jclone(norm(call(st, fn, args, week))))])
            except (AssertionError, KeyboardInterrupt):
                raise
            except Exception as e:                       # the Python itself cannot answer (a made-up state): not a case
                skipped += 1
                if skipped <= 3:
                    print(f"    skipped {name} {fn}{args}: {type(e).__name__} {e}", flush=True)
    finally:
        stubs = end()
    assert json.dumps(slim(st)) == before, f"a read-only call changed the state ({name})"
    print(f"    sweep {name}: {len(done)} calls ({skipped} skipped)", flush=True)
    return {"kind": "sweep", "name": name, "pre": list(pre), "clear": clear.on(), "entries": done, "stubs": stubs}


FIELDS = {"coach": "Smith", "school": "Ohio State", "first": "Jay", "position": "QB", "state": "Ohio", "town": "Columbus"}
ACTIONS = ("message", "call", "hc_visit", "offer")


def per_pid(st, pid, pitches) -> list:
    S = "$state"
    out = [[fn, [S, pid]] for fn in ("of", "offer_mult", "decommit_mult", "lowball_share", "nil_over", "pester_free", "story", "mate",
                                     "story_public", "story_learned_line", "story_fields", "style", "is_quiet", "needs_attention",
                                     "quiet_mark", "moved", "_twist", "twist_fields", "_name_of", "hollow_mult", "_his_schools")]
    out += [["home_of", [S, {"$p": pid}]], ["_real", [{"$p": pid}]], ["read_mult", [S, pid, "potential"]], ["read_mult", [S, pid, "speed"]],
            ["hero_state", [S, pid, {"$sd": pid}]]]
    out += [["commit_odds_mult", [S, pid, w]] for w in (3, 4, 8, 9)]
    out += [["start_firmness", [S, pid, f]] for f in (40, 80, 95)]
    out += [[fn, [S, pid, w]] for fn in ("waits", "signs_now") for w in (5, 13, 14, 15, 16, 17, 20)]
    out += [["counts_as_priority", [S, pid, t]] for t in pitches]
    out += [["pitch_mult", [S, pid, a, t, f]] for a in ACTIONS for t in pitches for f in (False, True)]
    out += [["pitch_mult", [S, pid, "call", "prestige"]]]
    return out


def per_pair(st, slug, pid, pitches) -> list:
    S = "$state"
    out = [[fn, [S, slug, pid]] for fn in ("known", "view", "story_detail", "mate_offered", "lowball_weeks", "draft_risk", "goes_pro",
                                           "ai_doubts", "cooled_why", "call_reveals", "hidden_from", "twist_bonus", "scared_off", "twist_view")]
    out += [["hollow_mult", [S, pid, slug]], ["call_reveals", [S, slug, pid, False]], ["story_interest", [S, slug, pid, 3.5]]]
    out += [["story_mult", [S, slug, pid, t]] for t in pitches] + [["twist_mult", [S, slug, pid, t]] for t in pitches]
    out += [["climbs", [S, slug, pid, x]] for x in (2.5, -1.0, 0)]
    for i, (who, action, first) in enumerate((("him", "call", False), ("him", "call", True), ("family", "hc_visit", False), ("him", "hc_visit", False))):
        for n in range(3):
            f = {**FIELDS, **persona.story_fields(st, pid)}
            out.append(["story_line", [S, slug, pid, f"scene-{pid}-{slug}-{n}", who, {"$e": f}, action, first]])
    return out


def sample(st: dict) -> list:
    rc = st["recruiting"]
    r = random.Random(7)
    drawn = persona.stories(st)
    pids: list = []
    tw = sorted(rc.get("twists") or {})
    pids += r.sample(tw, min(30, len(tw)))
    for kind in persona.STORIES:
        ks = sorted(p for p, s in drawn.items() if s["story"] == kind)
        pids += r.sample(ks, min(8, len(ks)))
    for group in (sorted(p for p, s in rc["status"].items() if s["committed"]), sorted(rc.get("moved") or {}),
                  sorted(rc["offers"].get(TEAM, [])), sorted(p for p, by in rc["contacts"].items() if TEAM in by), sorted(rc["prospects"])):
        pids += r.sample(group, min(12, len(group)))
    return list(dict.fromkeys(pids))


def schools_for(st: dict, pid: str, teams: dict) -> list:
    rc = st["recruiting"]
    k, d = persona.story(st, pid)
    tw = (rc.get("twists") or {}).get(pid) or {}
    out = [TEAM, "michigan", d.get("school"), tw.get("s"), tw.get("o"), rc["status"][pid]["committed"], *list(rc["lists"][pid])[:2],
           *[s for s, c in (rc["contacts"].get(pid) or {}).items() if c.get("loyal") or c.get("pt")][:1]]
    return list(dict.fromkeys(s for s in out if isinstance(s, str) and s in teams))


FORCED = [
    {"personality": "cocky", "decider": "trainer", "decider_topic": "nil", "story": "legacy", "story_data": {"school": TEAM}, "commit_style": "early_bird"},
    {"personality": "shy", "decider": "mom", "decider_topic": "proximity", "story": "package", "story_data": {"mate": "$next", "lead": True}, "commit_style": "quiet"},
    {"personality": "guarded", "decider": "self", "decider_topic": None, "story": "two_sport", "story_data": {}, "commit_style": "hat"},
    {"personality": "attention", "decider": "dad", "decider_topic": "pro", "story": "comeback", "story_data": {}, "commit_style": "needs_attention"},
    {"personality": "business", "decider": "grandma", "decider_topic": "coach", "story": "bloomer", "story_data": {"week": 6, "jump": 1}, "commit_style": "signing_day"},
    {"personality": "cocky", "decider": "hs_coach", "decider_topic": "winning", "story": "hero", "story_data": {"state": "OH"}, "commit_style": None},
    {"personality": "shy", "decider": "mom", "decider_topic": "academics"},
    {"personality": "business", "decider": "self", "decider_topic": None, "story": None, "story_data": {}},
    {"personality": "attention", "decider": "trainer", "decider_topic": "exposure", "story": "legacy", "story_data": {"school": "michigan"}, "commit_style": "quiet"},
    {"personality": "guarded", "decider": "dad", "decider_topic": "playing_time", "story": "package", "story_data": {"mate": "r0000-none", "lead": False}},
]


def forced_pre(pids: list) -> list:
    pre = []
    for i, (pid, f) in enumerate(zip(pids, FORCED)):
        f = jclone(f)
        if (f.get("story_data") or {}).get("mate") == "$next":
            f["story_data"]["mate"] = pids[(i + 1) % len(pids)]
        pre.append(["set", ["recruiting", "prospects", pid, "persona"], f])
    return pre


def snapshot(week: int, teams: dict) -> None:
    global LOG_BASE
    base = pickle.loads(SAVED[week])
    recruiting.reset_caches()
    recruiting._STEP_WEEK[0] = base["current_week"]
    rc = base["recruiting"]
    LOG_BASE = len(rc["log"])
    pitches = [*recruiting.PITCHES, None]
    S = "$state"
    groups = []
    pids = sample(base)
    print(f"  week {week}: {len(pids)} prospects sampled, {len(rc.get('twists') or {})} twists on", flush=True)

    # every read-only function, on the state as it is
    entries = [["stories", [S]]]
    for pid in pids:
        entries += per_pid(base, pid, pitches)
        for slug in schools_for(base, pid, teams):
            entries += per_pair(base, slug, pid, pitches)
    slugs = [TEAM, "michigan", "texas", "georgia", "notre-dame", "vanderbilt", "stanford", "akron", *sorted(teams)[::9]]
    slugs = list(dict.fromkeys(slugs))
    fcs = [s for s, t in teams.items() if t.get("fictional")][:3]
    for slug in slugs + fcs:
        entries += [[fn, [S, slug]] for fn in ("board_front", "security", "pro_line")] + [["school_state", [slug]]]
    entries += [[fn, [s]] for fn in ("_school_name", "_rival_name") for s in (*slugs[:6], *fcs, None, "", "nowhere-state")]
    entries += [["pro_line", [S, "nowhere-state"]], ["security", [S, "nowhere-state"]], ["_teams", []]]
    entries += [["draft_word", [x]] for x in (0.0, 0.02, 0.0399, 0.04, 0.06, 0.08, 0.1, 0.5)]
    shown = slim(base)["recruiting"]["log"]
    entries += [["shown_to", [{"$e": e}, v]] for e in shown[-250:] for v in (TEAM, e.get("school"), "michigan")]
    entries += [["twist_label", [{"$tw": pid}]] for pid in sorted(rc.get("twists") or {})]
    entries += [["$week_games", [w]] for w in (week, week + 1, 13)] + [["$week_homes", [week]]]
    entries += [["$week_security", [week, s]] for s in slugs[:5]]
    groups.append(sweep(base, week, entries, name="as it is"))
    # ... with a league kept in the career (a second season on): the security read from it
    league = {"teams": {TEAM: {"coaches": {"head_coach": {"name": "A"}}, "ad": {"security": 22, "patience": 3}},
                        "michigan": {"coaches": {}, "ad": {"security": 70}}, "texas": {"coaches": {"head_coach": {"name": "B"}}, "ad": {"patience": 1}}}}
    league["teams"]["georgia"] = {"coaches": {"head_coach": {"name": "C"}}}
    groups.append(sweep(base, week, [["security", [S, s]] for s in (TEAM, "michigan", "texas", "georgia", "oregon", "nowhere-state")],
                        [["set", ["league"], league]], "a league in the career"))

    # the portal, a class without stories, a class from before the campus topics, another seed: fewer prospects
    few = pids[::4]
    for name, pre in (("portal", [["set", ["recruiting", "portal"], True]]), ("no stories", [["del", ["recruiting", "stories"]]]),
                      ("old topics", [["del", ["recruiting", "topics_v"]]])):
        entries = [["stories", [S]]]
        for pid in few:
            entries += [e for e in per_pid(base, pid, pitches) if e[0] != "_his_schools"]
            for slug in schools_for(base, pid, teams)[:2]:
                entries += [e for e in per_pair(base, slug, pid, pitches) if e[0] not in ("draft_risk", "goes_pro", "story_detail", "view")]
                entries += [["view", [S, slug, pid]]] if name != "portal" else []
        entries += [["board_front", [S, s]] for s in slugs[:6]]
        groups.append(sweep(base, week, entries, pre, name))
    entries = [["stories", [S]]] + [["board_front", [S, s]] for s in slugs] + [[fn, [S, pid]] for pid in pids for fn in ("story", "of", "style", "mate")]
    groups.append(sweep(base, week, entries, [["set", ["recruiting", "seed"], 1000 + week]], "another seed"))

    # personas a save or a test set on the prospect
    plain = [p for p in pids if not persona.story(base, p)[0] and p not in (rc.get("twists") or {})][:len(FORCED)]
    pre = forced_pre(plain)
    entries = []
    for pid in plain:
        entries += per_pid(base, pid, pitches)
        for slug in list(dict.fromkeys([TEAM, "michigan", *schools_for(base, pid, teams)]))[:4]:
            entries += per_pair(base, slug, pid, pitches)
    groups.append(sweep(base, week, entries, pre, "forced personas"))

    # ---- the functions that change the state, each on a copy ----
    cases = []
    # every twist set off on a set of prospects: the best on the boards (a late offer wants four stars) and others
    pool = set(rc.get("board") or ())
    for b in rc["boards"].values():
        pool.update(b)
    free = sorted((q for q in pool if not rc["status"][q]["committed"] and not rc["status"][q]["signed"] and q not in (rc.get("twists") or {})),
                  key=lambda q: (rc["prospects"][q]["rank"], q))
    r = random.Random(week)
    chosen = free[:40:6] + r.sample(free[40:], min(9, len(free[40:])))
    for kind in persona.TWISTS:
        for i, pid in enumerate(chosen):
            cases.append(case(base, week, [["$setup", [pid, kind, f"setup-{week}-{kind}-{pid}"]], ["twist_view", [S, TEAM, pid]]],
                              low=kind == "hot_seat" and i % 2 == 0))
    cases.append(case(base, week, [["$setup", [chosen[0], "nothing", "x"]]]))
    # the week's own calls again, on the kept state
    cases.append(case(base, week, [["roll_twists", [S, week]]]))
    cases.append(case(base, week, [["roll_twists", [S, season.FINAL_WEEK]]]))
    cases.append(case(base, week, [["roll_twists", [S, week]]], [["set", ["recruiting", "portal"], True]]))
    cases.append(case(base, week, [["twist_week", [S, week + 1]], ["twist_week", [S, week + 2]]]))
    cases.append(case(base, week, [["cool_quiet", [S, week + 2]]]))
    cases.append(case(base, week, [["learn_styles", [S, week + 4]], ["learn_styles", [S, week + 4]]]))
    cases.append(case(base, week, [["learn_styles", [S, week + 4]]], [["set", ["recruiting", "portal"], True]]))
    for w in range(persona.BLOOM_WEEKS[0], persona.BLOOM_WEEKS[1] + 1):
        cases.append(case(base, week, [["bloom", [S, w]], ["bloom", [S, w]]]))
    cases.append(case(base, week, [["$rerank", []]], [["set", ["recruiting", "prospects", q, "composite"], c]
                                                    for q, c in zip(free[5:60:11], (0.2, 0.9991, 0.85, 0.5, 0.97))]))
    # learning
    for pid in pids[::3]:
        for slug in (TEAM, "michigan"):
            cases.append(case(base, week, [["learn", [S, slug, pid, t]] for t in ("personality", "decider", "story", "style", "style", "story")]
                              + [["known", [S, slug, pid]], ["view", [S, slug, pid]]]))
        for action in ("call", "hc_visit", "message"):
            cases.append(case(base, week, [["learn_on_contact", [S, TEAM, pid, action]], ["learn_on_contact", [S, "michigan", pid, action]]]))
        for looks, on in ((1.0, False), (2.0, False), (3.0, False), (3.0, True), (2.5, True)):
            cases.append(case(base, week, [["learn_from_read", [S, pid, looks]], ["known", [S, TEAM, pid]]], clear_on=on))
        cases.append(case(base, week, [["set_cooled_why", [S, TEAM, pid, "promise"]], ["cooled_why", [S, TEAM, pid]],
                                       ["set_cooled_why", [S, "michigan", pid, "quiet"]], ["cooled_why", [S, "michigan", pid]]]))
    for pid in plain:                                 # ... and with the forced personas (a portal class learns no style)
        cases.append(case(base, week, [["learn", [S, TEAM, pid, t]] for t in ("personality", "decider", "story", "style")]
                          + [["learn_on_contact", [S, TEAM, pid, "call"]], ["view", [S, TEAM, pid]]], pre))
        cases.append(case(base, week, [["learn", [S, TEAM, pid, "style"]], ["learn", [S, TEAM, pid, "story"]]],
                          pre + [["set", ["recruiting", "portal"], True]]))
    # what a contact leaves: the contacts there are, with a comeback's and a two-sport's story forced on him
    have = [(pid, s) for pid in sorted(rc["contacts"]) for s in sorted(rc["contacts"][pid])][::max(1, len(rc["contacts"]) // 12)][:12]
    for i, (pid, slug) in enumerate(have):
        f = dict(FORCED[2 + i % 2])
        for cw in (3, 8):
            cases.append(case(base, week, [["note_contact", [S, slug, pid, {"$contact": [pid, slug]}, t]] for t in ("playing_time", "nil", "playing_time", None)]
                              + [["draft_risk", [S, slug, pid]], ["story_mult", [S, slug, pid, "coach"]], ["goes_pro", [S, slug, pid]]],
                              [["set", ["recruiting", "prospects", pid, "persona"], f], ["set", ["current_week"], cw]]))
    # a surprise school knocked back out by a top-three school's call or visit
    for i, pid in enumerate(chosen[:6]):
        tw = {"k": "surprise", "s": "texas", "w": 2, "b": 1.5, "r": [TEAM, "michigan", "georgia"]}
        for slug, action in ((TEAM, "call"), (TEAM, "hc_visit"), ("michigan", "call"), ("oregon", "call")):
            cases.append(case(base, week, [["knock_back", [S, slug, pid, action]], ["twist_view", [S, TEAM, pid]], ["twist_bonus", [S, "texas", pid]]],
                              [["set", ["recruiting", "twists", pid], tw]]))
    for pid in sorted(rc.get("twists") or {})[:8]:
        cases.append(case(base, week, [["knock_back", [S, TEAM, pid, "call"]]]))
    print(f"    {len(cases)} cases that change the state", flush=True)
    write(f"snap_{week:02d}.json", {"week": week, "state": slim(base), "groups": groups + cases})
    COUNTS[f"snap {week}"] = [len(groups), len(cases)]


def static(teams: dict) -> dict:
    consts = {}
    for name in dir(persona):
        v = getattr(persona, name)
        if (name.isupper() or name.startswith("_TOPICS")) and name not in ("_STORIES", "_FRONT", "_SCHOOL_STATE") and not callable(v):
            consts[name] = norm(jclone(v))
    R = recruiting
    draws = []
    r = random.Random(3)
    ids = [f"r2027-{i:04d}" for i in r.sample(range(1, 4000), 500)] + ["p1", "x", "Zoë-17"]
    for pid in ids:
        for seed in (0, 5, 548563996, "abc"):
            for portal in (False, True):
                for grades in (False, True):
                    draws.append(["draw", [pid, seed, portal, grades], persona.draw(pid, seed, portal, grades)])
            draws.append(["draw", [pid, seed], persona.draw(pid, seed)])
            draws.append(["_drawn", [pid, seed], persona._drawn(pid, seed)])
            draws.append(["_drawn", [pid, seed, True], persona._drawn(pid, seed, True)])
            draws.append(["draw_style", [pid, seed], persona.draw_style(pid, seed)])
            draws.append(["_style_drawn", [pid, seed], persona._style_drawn(pid, seed)])
    return {
        "constants": consts, "draws": draws, "clear": clear.on(),
        "teams": {s: {"name": t.get("name"), "state": t.get("state"), "fictional": t.get("fictional"),
                      "coaches": {"head_coach": bool((t.get("coaches") or {}).get("head_coach"))}, **({"ad": t["ad"]} if "ad" in t else {})}
                  for s, t in teams.items()},
        "display": {s: season.team_display(s, teams) for s in teams},
        "FINAL_WEEK": season.FINAL_WEEK,
        "recruiting": {k: getattr(R, k) for k in ("LOWBALL", "NIL_OVER", "PESTER_FREE", "CALL_REVEAL", "REPORT_LOOKS", "COOL_WEEKS", "HARD_AT",
                                                  "AI_OVER_ASK", "STAR_KEY", "AI_NIL")},
    }


def main() -> None:
    global OUT, CAPTURE
    OUT = Path(sys.argv[1])
    OUT.mkdir(parents=True, exist_ok=True)
    for f in OUT.glob("*.json"):
        f.unlink()
    last = int(sys.argv[2]) if len(sys.argv) > 2 else 11
    hooks()
    capture("apply_stories", lambda a, ret, ops: True)
    capture("twist_week", lambda a, ret, ops: True)
    capture("roll_twists", lambda a, ret, ops: True)
    capture("bloom", lambda a, ret, ops: bool(ret) or a[0] == 3)
    capture("cool_quiet", lambda a, ret, ops: bool(ops) and a[0] % 2 == 1)
    capture("learn_styles", lambda a, ret, ops: bool(ops) and a[0] % 2 == 0)
    CAPTURE = True
    print("a second class (another seed), for apply_stories", flush=True)
    season.new_season("texas", "full", seed=11, career=True)
    print(f"the career: {TEAM}, seed {SEED}", flush=True)
    st = season.new_season(TEAM, "full", seed=SEED, career=True)
    st["career"].setdefault("settings", {})["auto_recruit"] = "season"         # your school recruits too: offers, calls, visits
    teams = season.load_teams()
    write("static.json", static(teams))
    while st["current_week"] < last and not st["done"]:
        season.advance_to(st, st["current_week"] + 1)
        print(f"week {st['current_week']} ({len(st['recruiting'].get('twists') or {})} twists on)", flush=True)
    CAPTURE = False
    for week in SNAP_WEEKS:
        if week in SAVED:
            snapshot(week, teams)
    write("summary.json", {"counts": COUNTS, "files": sorted(f.name for f in OUT.glob("*.json"))})
    print(json.dumps(COUNTS)[:600])


if __name__ == "__main__":
    main()
