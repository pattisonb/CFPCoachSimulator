"""Python's answers for career_js/recruiting/part3.js (coach_career/recruiting.py, lines 1625 to 2494), written for
recruiting_part3_compare.mjs to hold the JavaScript to:

    python3 career_js/test/recruiting_part3_reference.py OUT && node career_js/test/recruiting_part3_compare.mjs OUT

OUT (a folder outside the repo) gets:
    setup.json    the part's function names and constants, every constant of the rest of recruiting.py, the constants
                  the part reads on scenes and offseason, the names of what it calls elsewhere, and every team's name
    cases.jsonl   one call of one of the part's functions a line: the slice of the state it reads (before and after),
                  its arguments, every call it made out of the part in order (the rest of recruiting.py, persona,
                  scenes, word, promises, prospects, season) with Python's answer and what that call changed in the
                  slice, and its result or the RecruitingError it raised

The cases come from real seeded careers. Your own week is played through recruiting.act (messages, quick calls, calls
and in-home visits with their scenes, offers with and without NIL, raises, pulled offers, visits, scouting trips, job
promises, plans, and what the game refuses); the week step then runs for real, and what it calls in this part (the
planned actions, the flush, the rank snapshot, the report, a sample of the other schools' actions) is recorded as it
happens. Then the transfer portal of a finished season.
"""
import inspect
import json
import os
import random
import sys
import tempfile
import time
from pathlib import Path

os.environ.setdefault("CFP_CLEAR", "0")
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from coach_career import clear, offseason, persona, promises, prospects, recruiting, scenes, word    # noqa: E402
from sim import season                                                                              # noqa: E402

OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
season.SEASONS_DIR = Path(tempfile.mkdtemp(prefix="recruiting-part3-reference-"))

LO, HI = 1625, 2494                                       # the part's lines of recruiting.py
FUNCS = {k: v for k, v in vars(recruiting).items() if inspect.isfunction(v) and v.__module__ == recruiting.__name__}
MINE = sorted(k for k, v in FUNCS.items() if LO <= v.__code__.co_firstlineno <= HI)
OTHER = sorted(k for k in FUNCS if k not in MINE)
MY_CONSTANTS = ["PITCH_MARK", "JOB_PRIORITY", "JOB_NOT_PRIORITY", "JOB_CROWD", "JOB_CROWD_DOUBT", "JOB_STRAIN_FIRM", "JOB_STRAIN_SCORE",
                "REPORTS_KEPT", "MOVES_SHOWN", "REPORT_KINDS", "CONTACT_KINDS", "HISTORY_ONLY"]
EXTERNAL = {
    "persona": ["hollow_mult", "set_cooled_why", "pitch_mult", "story_mult", "twist_mult", "counts_as_priority", "climbs", "shown_to",
                "note_contact", "lowball_share", "lowball_weeks", "cooled_why", "call_reveals", "learn_on_contact", "knock_back"],
    "scenes": ["tells", "reaction", "answer_reply", "present", "open_scene"],
    "word": ["believes", "promise_mult", "last_broken"],
    "promises": ["promised_now", "add_strain"],
    "prospects": ["staff_likes", "looks_out"],
    "season": ["load_teams", "rank_map", "week_label", "team_display", "season_year"],
}
MODULES = {"recruiting": recruiting, "persona": persona, "scenes": scenes, "word": word, "promises": promises, "prospects": prospects,
           "season": season}
ORIG = {k: FUNCS[k] for k in MINE}


def plain(v):
    """A constant as JSON: a tuple is a list, a set is {"$set": [...]}."""
    if isinstance(v, (set, frozenset)):
        return {"$set": sorted(v)}
    if isinstance(v, (list, tuple)):
        return [plain(x) for x in v]
    if isinstance(v, dict):
        return {k: plain(x) for k, x in v.items()}
    return v


def constants_of(mod, skip=()):
    out = {}
    for k, v in vars(mod).items():
        if k.startswith("__") or k in skip or inspect.isfunction(v) or inspect.ismodule(v) or inspect.isclass(v) or callable(v):
            continue
        try:
            out[k] = json.loads(json.dumps(plain(v)))
        except (TypeError, ValueError):
            pass
    return out


SETUP = {
    "mine": MINE, "my_constants": {k: plain(getattr(recruiting, k)) for k in MY_CONSTANTS},
    "other_constants": constants_of(recruiting, skip=set(MY_CONSTANTS) | {"_LAST_LOOK", "_MARKS", "annotations"}),
    "other_functions": OTHER, "external": EXTERNAL,
    "scenes": {k: plain(getattr(scenes, k)) for k in ("ANSWERS", "WORD_DOUBT", "WORD_DOUBT_ANY", "JOB_SAID", "HEARD_RIVAL", "REPLY_LINES")},
    "offseason": {"GROUP": offseason.GROUP},
}

REC = {"on": False, "depth": 0, "state": None, "calls": None, "spec": None, "res": None, "keep": None}
N = {"cases": 0, "skipped": {}, "by_fn": {}, "seen": {}, "errors": {}, "dep_calls": 0}
FORCE = [False]
TAG = ["start"]
# one call in this many is a case when the game itself makes it (the week step, a page's view); mine are all cases
RATE = {"_act": 20, "_add_points": 60, "_nil": 150, "nil_left": 150, "points_now": 400, "pending": 400, "action_hours": 150,
        "_home_game_left": 6, "hours_free": 25, "manual_offers": 40, "_open_roster_promise": 60, "job_crowd": 4, "_unmark": 5,
        "visit_weekends": 20, "home_weekends": 3, "pitch_marks": 60, "hours_planned": 25, "planned": 40, "rival_stamp": 3,
        "_snapshot_ranks": 2, "latest_report": 2}
CAP = {"_snapshot_ranks": 5, "_report": 40, "_flush": 60}
cases_file = open(OUT / "cases.jsonl", "w", encoding="utf-8")


def slim(p: dict) -> dict:
    """A prospect without his rating lists (this part never reads them)."""
    return {k: v for k, v in p.items() if k not in ("ratings", "potential")}


WHOLE = {"planned", "carry"}               # walked whole whatever the case is about (the energy your plans hold)
LEFT_OUT = {"boards", "attrs", "looks"}    # never read by this part
# read only by the week's snapshot and report (their cases name them): left out of every other case's slice
NARROW_OUT = {"reports", "traits_known", "look_changes", "look_counts", "generational", "twists", "moved", "why", "ranks", "stages",
              "leader_changes"}
LIGHT = ("contacts", "prospects", "status")    # what a case holds of the recruits it only walks past (job_crowd's walk)


def snap(state, spec, want_ids=True):
    """The slice of the state a case reads, as JSON-ready data that points at the real objects, and where each of
    those objects sits in it ({id: path})."""
    rc = state["recruiting"]
    P, S, keys = spec["P"], spec["S"], spec["keys"]
    P2 = spec.get("P2") or set()
    teams = TEAM_NAMES
    out = {k: state[k] for k in ("id", "team", "current_week", "year", "done", "nil_carry") if k in state}
    if "offseason" in state:
        off = state["offseason"]
        out["offseason"] = ({"year": off["year"]} if "year" in off else {"_": 1}) if off else off
    if spec["league"] and state.get("league"):
        lt = state["league"].get("teams") or {}
        out["league"] = {"teams": {s: {"roster": [{k: c[k] for k in ("id", "n", "pos", "promised") if k in c} for c in (lt[s].get("roster") or [])]}
                                   for s in sorted(S or ()) if s in lt}}
    out["games"] = [[eid, g] for eid, g in state["games"].items() if g["home"] in spec["games"]]
    r = {}
    real = {}
    for k, v in rc.items():
        if (k not in keys if keys is not None else k in NARROW_OUT) or k in LEFT_OUT:
            continue
        if k == "prospects":
            r[k] = {pid: (slim(p) if P is None or pid in P else {"name": p["name"]}) for pid, p in v.items() if P is None or pid in P or pid in P2}
            for pid in r[k]:
                real[id(v[pid])] = ["recruiting", "prospects", pid]
        elif k == "log":
            how = spec["log"]
            r[k] = [e for e in v if how == "all" or (how == "pids" and e.get("pid") in P) or (how == "schools" and e.get("school") in S)]
        elif k in WHOLE or not isinstance(v, dict) or not v:
            r[k] = v
        elif next(iter(v)) in rc["prospects"]:
            sub = v if P is None else {pid: x for pid, x in v.items() if pid in P or (k in LIGHT and pid in P2)}
            if k == "contacts" and S is not None:
                sub = {pid: {s: c for s, c in by.items() if s in S} for pid, by in sub.items()}
            r[k] = sub
        elif next(iter(v)) in teams:
            sub = v if S is None else {s: x for s, x in v.items() if s in S}
            if k in ("revealed", "cooled_why") and P is not None:
                sub = {s: {pid: x for pid, x in by.items() if pid in P} for s, by in sub.items()}
            r[k] = sub
        else:
            r[k] = v
    out["recruiting"] = r
    ids = {}
    if want_ids:
        def reg(o, path):
            ids[id(o)] = path
            for k, v in (o.items() if isinstance(o, dict) else enumerate(o)):
                if isinstance(v, (dict, list)):
                    reg(v, path + [k])
        reg(r, ["recruiting"])
        ids.update(real)
    return out, ids


def enc(v, ids, top=True):
    """An argument or an answer as JSON: the state, an object of the slice (where it sits), an earlier answer (which),
    a generator (its next draw), a function, or the value itself."""
    if v is REC["state"] and v is not None:
        return "$state"
    if isinstance(v, random.Random):
        twin = random.Random()
        twin.setstate(v.getstate())
        return {"$rng": twin.random()}
    if inspect.isfunction(v) or inspect.ismethod(v):
        return "$fn"
    if isinstance(v, (dict, list)):
        if id(v) in ids:
            return {"$ref": ids[id(v)]}
        if REC["res"] is not None and id(v) in REC["res"]:
            return {"$res": REC["res"][id(v)]}
        if isinstance(v, dict):
            if "ratings" in v and "potential" in v:
                v = slim(v)
            return {k: enc(x, ids, False) for k, x in v.items()}
        return [enc(x, ids, False) for x in v]
    if isinstance(v, tuple):
        return [enc(x, ids, False) for x in v]
    if isinstance(v, (set, frozenset)):
        return {"$set": sorted(v)}
    return v


def diff(a, b, path, ops):
    """What turns the slice `a` into `b`, as steps the JavaScript makes on its own copy in place."""
    if isinstance(a, dict) and isinstance(b, dict):
        for k in a:
            if k not in b:
                ops.append(["del", path + [k]])
        for k in b:
            if k not in a:
                ops.append(["set", path + [k], b[k]])
            else:
                diff(a[k], b[k], path + [k], ops)
        if [k for k in a if k in b] + [k for k in b if k not in a] != list(b):
            ops.append(["order", path, list(b)])
    elif isinstance(a, list) and isinstance(b, list):
        if len(b) >= len(a):
            for i in range(len(a)):
                diff(a[i], b[i], path + [i], ops)
            for v in b[len(a):]:
                ops.append(["push", path, v])
        else:
            ops.append(["splice", path, b])
    elif json.dumps(a) != json.dumps(b):
        ops.append(["set", path, b])


def wrap_dep(mod_name: str, name: str) -> None:
    mod = MODULES[mod_name]
    fn = getattr(mod, name)
    sig = inspect.signature(fn)
    params = list(sig.parameters)

    def wrapper(*a, **k):
        if not REC["on"] or REC["depth"]:
            return fn(*a, **k)
        spec, state = REC["spec"], REC["state"]
        N["dep_calls"] += 1
        given = sig.bind(*a, **k).arguments
        last = max((params.index(p) for p in given), default=-1)
        pre, ids = (None, REC["ids0"])                    # (a case whose calls change nothing: where things sat at its start)
        if state is not None and spec["diff"]:
            data, ids = snap(state, spec)
            pre = json.dumps(data)
            REC["keep"].append(data)
        args = json.dumps([enc(given[p], ids) if p in given else "$default" for p in params[:last + 1]])
        REC["depth"] = 1
        raised = None
        try:
            out = fn(*a, **k)
        except recruiting.RecruitingError as e:
            raised, out = e, None
        finally:
            REC["depth"] = 0
        ops, ids = [], REC["ids0"]
        if state is not None and spec["diff"]:
            data, ids = snap(state, spec)
            post = json.dumps(data)
            REC["keep"].append(data)
            if post != pre:
                diff(json.loads(pre), json.loads(post), [], ops)
        if raised is not None:
            res = {"$raise": [raised.code, raised.message]}
        elif mod_name == "season" and name == "load_teams":
            res = "$teams"
        else:
            res = enc(out, ids)
        index = len(REC["calls"])
        if isinstance(out, (dict, list)):
            REC["res"][id(out)] = index
            REC["keep"].append(out)
        REC["calls"].append(f"[{json.dumps(mod_name)}, {json.dumps(name)}, {args}, {json.dumps(res)}, {json.dumps(ops)}]")
        if raised is not None:
            raise raised
        return out
    wrapper.__wrapped__ = fn
    setattr(mod, name, wrapper)


def spec_for(name, A, state):
    """Which prospects, schools and parts of the recruiting block a case's slice holds."""
    rc = state["recruiting"]
    me = state.get("team")
    slug, pid = A.get("slug"), A.get("pid")
    S = {s for s in (slug, me) if isinstance(s, str)}
    P = {pid} if isinstance(pid, str) else set()
    spec = {"P": P, "S": S, "log": "pids", "games": set(S), "keys": None, "league": False, "diff": True, "unordered": False}
    if name in ("job_crowd", "_job_promise", "_promise_job", "_strain") or (
            name == "act" and (A["action"] in ("promise_job", "promise_role") or A.get("answer") == "promise")):
        spec["P2"] = {q for q, by in rc["contacts"].items() if any(by.get(s) for s in S)}   # everyone the school has talked to: job_crowd walks them all
        spec["league"] = True
    if name == "job_crowd":
        spec.update(keys={"contacts", "prospects", "status", "portal", "week", "year"}, diff=False, games=set())
    if name == "latest_report":
        spec["keys"] = {"reports"}
    if name == "_strain":
        spec["P2"] |= {x["id"] for x in A["crowd"] if x["kind"] == "recruit"}
    if name in ("_run_planned", "_carry_planned", "plan"):
        P |= set(rc.get("planned") or {}) | set(rc.get("carry") or {})
    if name == "_flush":
        P |= set(rc.get("pending") or {}) | set(rc.get("why_week") or {}) | set((rc.get("scenes") or {}).get(me) or {})
        spec["keys"] = {"pending", "why_week", "why", "lists", "scenes", "log", "portal", "week"}
    if name == "_snapshot_ranks":
        spec.update(P=None, S=None, keys={"lists", "offers", "ranks", "board", "stages", "leader_changes"}, diff=False, unordered=True, games=set())
    if name == "_report":
        P |= set(rc["board"]) | set(rc["offers"].get(me, []))
        spec.update(keys={"board", "offers", "log", "ranks", "why", "prospects", "reports", "portal", "week"}, log="all", diff=False, games=set())
    if name in ("_marks_index", "pitch_marks"):
        spec["log"] = "schools"
    return spec


def run_case(name, fn, bound):
    bound.apply_defaults()
    A = bound.arguments
    args = list(bound.args)
    state = A.get("state")
    if not (isinstance(state, dict) and isinstance(state.get("recruiting"), dict) and "prospects" in state["recruiting"]):
        state = None
    spec = spec_for(name, A, state) if state is not None else {"diff": False, "unordered": False}
    REC.update(on=True, depth=0, state=state, calls=[], spec=spec, res={}, keep=[])
    pre, ids = (None, {})
    if state is not None:
        data, ids = snap(state, spec)
        pre = json.dumps(data)
        REC["keep"].append(data)
    REC["ids0"] = ids
    before = json.dumps([enc(a, ids) for a in args])
    out, error = None, None
    try:
        out = fn(*args)
    except recruiting.RecruitingError as e:
        error = e
    except Exception as e:                                # an input Python itself breaks on: not a case
        key = f"{name}: {type(e).__name__}"
        N["skipped"][key] = N["skipped"].get(key, 0) + 1
        REC.update(on=False, state=None, calls=None, res=None, keep=None)
        raise
    calls = REC["calls"]
    post = json.dumps(snap(state, spec, False)[0]) if state is not None else None
    REC["res"] = None
    res = json.dumps(enc(out, {}))
    REC.update(on=False, state=None, calls=None, res=None, keep=None)
    err = json.dumps([error.code, error.message] if error else None)
    line = ('{"n": %d, "fn": %s, "tag": %s, "unordered": %s, "state": %s, "args": %s, "calls": [%s], "out": %s, "error": %s, "after": %s}'
            % (N["cases"], json.dumps(name), json.dumps(TAG[0]), json.dumps(spec["unordered"]), pre or "null", before, ", ".join(calls), res, err,
               post or "null"))
    cases_file.write(line + "\n")
    N["cases"] += 1
    N["by_fn"][name] = N["by_fn"].get(name, 0) + 1
    if error:
        N["errors"][error.message] = N["errors"].get(error.message, 0) + 1
        raise error
    return out


def wrap_entry(name: str) -> None:
    fn = ORIG[name]
    sig = inspect.signature(fn)

    def wrapper(*a, **k):
        if REC["on"]:
            return fn(*a, **k)
        N["seen"][name] = N["seen"].get(name, 0) + 1
        if not FORCE[0] and (N["seen"][name] % RATE.get(name, 1) or N["by_fn"].get(name, 0) >= CAP.get(name, 100000)):
            return fn(*a, **k)
        return run_case(name, fn, sig.bind(*a, **k))
    wrapper.__wrapped__ = fn
    setattr(recruiting, name, wrapper)


def case(name, *args, **kw):
    """One of the part's functions called by hand: always a case. A RecruitingError is its answer (None here)."""
    FORCE[0] = True
    try:
        return getattr(recruiting, name)(*args, **kw)
    except recruiting.RecruitingError:
        return None
    except Exception as e:                                # (counted in run_case: a made-up input, not a case)
        if type(e).__name__ not in ("KeyError", "TypeError", "IndexError", "AttributeError", "StopIteration"):
            raise
        return None
    finally:
        FORCE[0] = False


def act(state, pid, action, **kw):
    return case("act", state, state["team"], pid, action, **kw)


# ----- making a season move without playing its games (as career_js/test/scenes_reference.py does) -------------------
def fbs() -> list[str]:
    return [s for s, t in season.load_teams().items() if not t.get("fictional")]


def play(state, week, rng) -> None:
    for g in state["games"].values():
        if g["week"] != week or g.get("played"):
            continue
        hi, lo = rng.randint(17, 48), rng.randint(0, 16)
        home_wins = rng.random() < 0.55
        g.update(played=True, home_score=hi if home_wins else lo, away_score=lo if home_wins else hi)


def visible(state, n, rng, skip=()):
    rc = state["recruiting"]
    pids = [q for q in rc["prospects"] if not rc["prospects"][q].get("hidden") and not rc["status"][q].get("signed")
            and not rc["status"][q].get("committed") and q not in skip]
    return rng.sample(pids, min(n, len(pids)))


def conversation(state, pid, action, rng, mode) -> None:
    """A call or in-home visit played through: the open scene, your three things (or what the game refuses), his
    question and your answer, the job promised on some, your lead-with."""
    rc = state["recruiting"]
    p = rc["prospects"][pid]
    got = act(state, pid, action)
    sc = (got or {}).get("scene")
    if not sc:
        return
    sid = sc["id"]
    act(state, pid, action)                               # finish your call with him first
    rest = [t for t in recruiting.PITCHES if t not in p["priorities"]]
    if mode % 4 == 0:
        topics = (list(p["priorities"]) + rest)[:3]
    elif mode % 4 == 1:
        topics = rng.sample(list(recruiting.PITCHES), 3)
    elif mode % 4 == 2:
        topics = rng.sample(rest, 3)
    else:
        topics = [rng.choice(list(p["priorities"]))] + rng.sample(rest, 2)
        rng.shuffle(topics)
    if mode % 5 == 0:                                     # what the game refuses, before the real opening
        act(state, pid, "pitch", pitch=topics[0], scene=sid)                     # present your program first
        act(state, pid, "present", scene=sid, topics=topics[:2])
        act(state, pid, "present", scene=sid, topics=[topics[0], topics[0], topics[1]])
        act(state, pid, "present", scene=sid, topics=[topics[0], topics[1], "the weather"])
        act(state, pid, "present", scene="not-this-one", topics=topics)
        act(state, pid, "answer", scene=sid, answer="straight")                  # he asked nothing (yet)
    got = act(state, pid, "present", scene=sid, topics=topics)
    act(state, pid, "present", scene=sid, topics=topics)                          # you already presented
    sc = (got or {}).get("scene") or sc
    if sc.get("question"):
        if mode % 3 == 0:
            act(state, pid, "pitch", pitch=topics[0], scene=sid)                 # answer him first
            act(state, pid, "answer", scene=sid)                                 # answer is required
            act(state, pid, "answer", scene=sid, answer="shrug")
            act(state, pid, "answer", scene="other", answer="straight")
        act(state, pid, "answer", scene=sid, answer=scenes.ANSWERS[(mode + len(pid) + state["current_week"]) % 3])
        act(state, pid, "answer", scene=sid, answer="straight")                  # you already answered
    if mode % 3 == 1:
        act(state, pid, "promise_job", scene=sid)
        act(state, pid, "promise_job", scene=sid)                                # already promised
        act(state, pid, "answer", scene=sid, answer="promise")
    if mode % 7 == 6:
        return                                            # left open: hung up at the week step
    cue_topics = (sc.get("cue") or {}).get("topics") or []
    pitch = "nil" if mode % 6 == 2 else rng.choice(cue_topics) if cue_topics and rng.random() < 0.5 else \
        rng.choice(list(p["priorities"])) if rng.random() < 0.5 else rng.choice(list(recruiting.PITCHES))
    act(state, pid, "pitch", scene=sid)                                           # pick a pitch
    act(state, pid, "pitch", pitch=pitch, scene="wrong")
    act(state, pid, "pitch", pitch=pitch, scene=sid)
    for slug in (state["team"],):
        case("pitch_marks", state, slug, pid)
        case("_marks_index", state, slug)


def views(state, rng, pids) -> None:
    """The part's read-only functions over schools and prospects."""
    me = state["team"]
    rc = state["recruiting"]
    schools = [me] + rng.sample(fbs(), 3)
    for slug in schools:
        case("hours_free", state, slug)
        case("nil_left", state, slug)
        case("_nil", state, slug)
        case("home_weekends", state, slug)
        case("_home_game_left", state, slug)
        case("manual_offers", state, slug)
        case("_marks_index", state, slug)
        for group in ("QB", "OL"):
            case("job_crowd", state, slug, group, rng.choice(pids))
    case("planned", state)
    case("hours_planned", state)
    case("rival_stamp", state)
    case("rival_stamp", {})
    case("rival_stamp", {"current_week": None, "recruiting": {"portal": True, "week": 3}})
    case("latest_report", state)
    case("_pester_line", "Dre O'Neal", "SMU")
    homes = recruiting.home_weekends(state, me)
    for i, pid in enumerate(pids):
        for slug in [me] + ([rng.choice(schools)] if i % 3 == 0 else []):
            for action in ("official_visit", "hc_visit", "call"):
                case("action_hours", state, slug, pid, action)
            case("visit_weekends", state, slug, pid)
            case("visit_weekends", state, slug, pid, homes if slug == me else [])
            case("_home_game_left", state, slug, pid)
            case("pending", state, slug, pid)
            case("points_now", state, slug, pid)
            case("pitch_marks", state, slug, pid)
            c = (rc["contacts"].get(pid) or {}).get(slug)
            if c:
                case("_open_roster_promise", c)
    case("_open_roster_promise", {})
    case("_open_roster_promise", {"promises": [{"kind": "package", "broken": None}, {"kind": "roster", "broken": None, "closed": 3},
                                               {"kind": "roster", "broken": 4}, {"kind": "roster", "broken": None, "week": 2}]})


def my_week(state, rng, step) -> None:
    """Your own week: every action the page can send, and what the game refuses."""
    me = state["team"]
    rc = state["recruiting"]
    week = state["current_week"]
    recruiting._hours(state, me)
    if step % 3 != 2:
        rc["hours"][me] = 100000                          # (one week in three runs on the real energy: it runs out)
    pids = visible(state, 48, rng)
    for pid in pids[:14]:
        try:
            recruiting.set_board(state, pid, True)
        except Exception:
            pass
    for i, pid in enumerate(pids):
        p = rc["prospects"][pid]
        kind = i % 8
        if kind == 0:
            act(state, pid, "message", pitch="winning")
            act(state, pid, "message")                    # done this week
            act(state, pid, "call_recruit")
        elif kind == 1:
            act(state, pid, "call", answer="quick")
            act(state, pid, "call", answer="quick")
            act(state, pid, "call", pitch=p["priorities"][0])      # the one-shot call with a pitch
        elif kind == 2:
            conversation(state, pid, "call", rng, i // 8 + step)
        elif kind == 3:
            conversation(state, pid, "hc_visit", rng, i // 8 + 2 * step)
            if i % 16 == 3:
                act(state, pid, "hc_visit", pitch="coach")         # one in-home visit a month
        elif kind == 4:
            ask = recruiting.ask_from(state, me, pid, peek=True)
            nil = [0, ask, max(0, ask // 3), ask + 5, 10 ** 6, -1][(i // 8 + step) % 6]
            act(state, pid, "raise_nil", nil=5)                    # no offer to raise
            act(state, pid, "pull_offer")                          # no offer to pull
            act(state, pid, "promise_role")                        # offer him first
            act(state, pid, "offer", nil=nil, answer="promise" if i % 16 == 4 else None)
            act(state, pid, "offer")                               # already offered
            if pid in rc["offers"].get(me, []):
                held = recruiting._nil(state, me)["held"].get(pid, 0)
                act(state, pid, "raise_nil", nil=held)             # raise it above what you offered
                act(state, pid, "raise_nil", nil=held + 10 ** 6)
                act(state, pid, "raise_nil", nil=max(held + 1, ask if i % 3 else held + 2))
                act(state, pid, "promise_role")
                act(state, pid, "promise_role")                    # already promised
                act(state, pid, "offer", answer="promise")
                if (i // 8) % 3 == 0:
                    act(state, pid, "pull_offer")
                elif (i // 8) % 3 == 1:
                    st = rc["status"][pid]                         # your own commit, let go; a hard one stays
                    st.update(committed=me, firmness=40, hard=bool(i % 16 == 4))
                    act(state, pid, "scout")                       # he has committed to you
                    if i % 16 == 12:
                        act(state, pid, "pull_offer")
                    else:
                        st.update(committed=None, firmness=None, hard=False)
        elif kind == 5:
            for _ in range(1 + (i // 8) % 4):
                act(state, pid, "scout")
        elif kind == 6:
            if i % 16 == 6:
                rc["lists"][pid][me] = rc["lists"][pid].get(me, 0.0) + 400.0       # into his top group
            homes = recruiting.home_weekends(state, me)
            pick = [None, homes[-1]["week"] if homes else 3, 99, homes[0]["week"] if homes else None][(i // 8 + step) % 4]
            if i % 32 == 6 and homes:                              # he is booked elsewhere that weekend
                rc["visits"].setdefault(pid, {})[rng.choice(fbs())] = {"week": homes[0]["week"], "done": False}
            act(state, pid, "official_visit", week=pick)
            act(state, pid, "official_visit")                      # one official visit per school
        else:
            for action in ("message", "call", "call_recruit", "offer"):
                case("plan", state, pid, action, True)
            case("plan", state, pid, "call", True)
            if i % 16 == 7:
                case("plan", state, pid, "message", False)
                case("plan", state, pid, "call", False)
                case("plan", state, pid, "call_recruit", False)
                case("plan", state, pid, "call_recruit", False)
            case("plan", state, "nobody", "call", True)
    # the same position group, promised twice and more: the crowd, his doubt, the strain
    by_group: dict = {}
    for pid in visible(state, 400, rng):
        by_group.setdefault(recruiting._group_of(rc["prospects"][pid]), []).append(pid)
    for group in ("QB", "WR", "OL")[:1 + step % 3]:
        for j, pid in enumerate(by_group.get(group, [])[:4]):
            act(state, pid, "offer", nil=0)
            if j == 1:
                rc["status"][pid].update(committed=me, firmness=30 if step % 2 else 0, hard=False)
            if j == 2 and step % 2:
                rc["status"][pid].update(committed=me, firmness=55, hard=True)
            act(state, pid, "promise_role")
            case("job_crowd", state, me, group, pid)
    # what the game refuses outright
    some = pids[0]
    act(state, "r0000-none", "call")
    act(state, some, "dance")
    act(state, some, "call", pitch="the weather")
    act(state, some, "offer", nil=-5)
    act(state, some, "answer", scene="x", answer="straight")
    act(state, some, "promise_job", scene="x")
    act(state, some, "present", scene="x", topics=["nil", "coach", "pro"])
    act(state, "r0000-none", "answer", scene="x", answer="straight")
    act(state, "r0000-none", "present", scene="x", topics=["nil", "coach", "pro"])
    act(state, "r0000-none", "promise_job", scene="x")
    case("act", state, rng.choice(fbs()), some, "promise_job", scene="x")
    case("_act", state, rng.choice(fbs()), some, "offer")          # an offer needs a pitch
    signed = next((q for q in rc["status"] if rc["status"][q].get("signed")), None)
    if signed:
        act(state, signed, "call")
        case("plan", state, signed, "call", True)
    # another school's actions by hand (the week step's are sampled as they happen)
    for j, pid in enumerate(visible(state, 24, rng)):
        slug = rng.choice(fbs())
        p = rc["prospects"][pid]
        pitch = p["priorities"][j % 3] if j % 2 else rng.choice(list(recruiting.PITCHES))
        action = ["message", "call", "hc_visit", "offer", "official_visit", "call_recruit", "offer", "pull_offer"][j % 8]
        case("_act", state, slug, pid, action, pitch, 5 * (j % 4) if action == "offer" else 0, 1.0 if j % 3 else 0.5, None, False, bool(j % 5 == 0))
        if action == "offer":
            case("_act", state, slug, pid, "raise_nil", None, 40 + j)
            case("_unmark", state, slug, pid)
            case("clear_scenes", state, slug)
    case("_unmark", state, me, rc["offers"].get(me, [None])[0] if rc["offers"].get(me) else some)
    views(state, rng, pids[:10] + visible(state, 4, rng))
    if step % 4 == 3:
        case("clear_scenes", state, me)


def season_of(team, seed, weeks, rng, tag, clear_mode) -> dict:
    clear.CLEAR = clear_mode
    state = season.new_season(team, "full", seed=seed, career=True)
    for step in range(weeks):
        week = state["current_week"]
        TAG[0] = f"{tag} week {week}"
        t0 = time.time()
        my_week(state, rng, step)
        play(state, week, rng)
        recruiting.weekly_step(state, week, auto_user=step % 3 == 1)
        state["current_week"] = week + 1
        TAG[0] = f"{tag} after week {week}"
        views(state, rng, visible(state, 5, rng))
        print(f"{TAG[0]}: {N['cases']} cases so far ({time.time() - t0:.0f}s)", flush=True)
    return state


def doubts(state, rng) -> None:
    """Keeps His Word under its floor (word.believes made to say no for these cases, with and without a broken promise
    to name): he doubts the job you promise, on a call, on a visit and with your offer."""
    me = state["team"]
    rc = state["recruiting"]
    real = {k: getattr(word, k) for k in ("believes", "last_broken")}
    for round_, name in enumerate(("Sam Dial", None, "Ty $& O'Neal")):
        word.believes = lambda state, group: False
        word.last_broken = lambda state, group, name=name: name
        wrap_dep("word", "believes")
        wrap_dep("word", "last_broken")
        TAG[0] = f"doubted round {round_}"
        recruiting._hours(state, me)
        rc["hours"][me] = 100000
        for i, pid in enumerate(visible(state, 30, rng)):
            if i % 3 == 0:
                act(state, pid, "offer", answer="promise" if i % 2 else None)
                act(state, pid, "promise_role")
                continue
            sc = (act(state, pid, "hc_visit" if i % 2 else "call") or {}).get("scene")
            if not sc:
                continue
            p = rc["prospects"][pid]
            got = act(state, pid, "present", scene=sc["id"], topics=(list(p["priorities"]) + ["nil", "coach", "pro"])[:3])
            if ((got or {}).get("scene") or {}).get("question") and i % 3 == 1:
                act(state, pid, "answer", scene=sc["id"], answer="promise")
            else:
                act(state, pid, "promise_job", scene=sc["id"])
            act(state, pid, "pitch", pitch=p["priorities"][0], scene=sc["id"])
    for k, fn in real.items():
        setattr(word, k, fn)


def portal(rng) -> None:
    """The transfer portal of a finished season (tests/test_portal_profile.to_portal)."""
    from app import api
    from tests.test_portal_profile import to_portal
    clear.CLEAR = False
    sid = api.call("POST", "/api/season", {"team": "ohio-state", "mode": "full", "seed": 11, "career": True})["id"]
    to_portal(sid)
    state = api.loaded_state()
    rc = state["recruiting"]
    me = state["team"]
    year = (state.get("offseason") or {}).get("year")
    roster = ((state.get("league") or {}).get("teams", {}).get(me) or {}).get("roster") or []
    for c in roster[:40:4]:                               # some of next year's players hold your word on a job
        c["promised"] = year
    for round_ in range(3):
        TAG[0] = f"portal round {round_}"
        recruiting._hours(state, me)
        rc["hours"][me] = 100000
        pids = [q for q in visible(state, 500, rng) if rc["prospects"][q].get("from") != me][:40]
        for pid in pids[:8]:
            try:
                recruiting.set_board(state, pid, True)
            except Exception:
                pass
        for i, pid in enumerate(pids):
            kind = i % 5
            if kind == 0:
                conversation(state, pid, "hc_visit" if i % 2 else "call", rng, i // 5 + round_)
            elif kind == 1:
                act(state, pid, "offer", nil=[0, 20, 5][i % 3], answer="promise" if i % 2 else None)
                act(state, pid, "promise_role")
                act(state, pid, "raise_nil", nil=60)
            elif kind == 2:
                rc["lists"][pid][me] = rc["lists"][pid].get(me, 0.0) + 400.0
                act(state, pid, "official_visit")
                act(state, pid, "official_visit", week=3)
            elif kind == 3:
                act(state, pid, "call", answer="quick")
                act(state, pid, "message")
                case("plan", state, pid, "call_recruit", True)
            else:
                act(state, pid, "scout")
                act(state, pid, "official_visit")         # not in his top group
        for j, pid in enumerate(pids[:12]):
            slug = rng.choice(fbs())
            case("_act", state, slug, pid, ["offer", "official_visit", "call", "hc_visit"][j % 4], rc["prospects"][pid]["priorities"][0], 5 * (j % 3))
            case("_nil", state, slug)
            case("nil_left", state, slug)
            for group in ("QB", "WR", "OL", "DL")[:2 + j % 3]:
                case("job_crowd", state, slug if j % 2 else me, group, pid)
        views(state, rng, pids[:8])
        print(f"{TAG[0]}: {N['cases']} cases so far", flush=True)
        if round_ < 2:
            api._save_loaded()
            api.call("POST", f"/api/season/{sid}/offseason/advance", {})
            state = api.loaded_state()
            rc = state["recruiting"]
            if not rc.get("portal"):
                break


TEAM_NAMES: dict = {}


def main() -> None:
    TEAM_NAMES.update({s: {"name": t["name"]} for s, t in season.load_teams().items()})
    SETUP["teams"] = TEAM_NAMES
    wanted = set()
    src = "".join(inspect.getsourcelines(recruiting)[0][LO - 1:HI])
    for name in OTHER:                                    # the rest of recruiting.py: whatever the part names
        if f"{name}(" in src:
            wanted.add(name)
    SETUP["recruiting_deps"] = sorted(wanted)
    for name in sorted(wanted):
        wrap_dep("recruiting", name)
    for mod_name, names in EXTERNAL.items():
        for name in names:
            wrap_dep(mod_name, name)
    for name in MINE:
        wrap_entry(name)
    rng = random.Random(20261122)
    t0 = time.time()
    season_of("smu", 5, 4, rng, "smu", False)
    season_of("ohio-state", 11, 3, rng, "ohio-state", False)
    doubts(season_of("kent-state", 7, 2, rng, "kent-state clear", True), rng)
    portal(rng)
    clear.CLEAR = False
    cases_file.close()
    (OUT / "setup.json").write_text(json.dumps(SETUP), encoding="utf-8")
    print(f"{N['cases']} cases, {N['dep_calls']} recorded calls in {time.time() - t0:.0f}s -> {OUT}")
    print("by function:", json.dumps(dict(sorted(N["by_fn"].items()))))
    print("never a case:", [k for k in MINE if k not in N["by_fn"]])
    print("refusals:", json.dumps(N["errors"], indent=0))
    if N["skipped"]:
        print("inputs Python itself broke on (not cases):", N["skipped"])


if __name__ == "__main__":
    main()
