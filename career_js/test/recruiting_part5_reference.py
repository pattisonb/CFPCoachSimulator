"""Python's answers for career_js/recruiting/part5.js (coach_career/recruiting.py from line 3255: signing, the weekly
step, the portal's decisions, scouting), as JSON for recruiting_part5_compare.mjs to hold the JavaScript to:

    python3 career_js/test/recruiting_part5_reference.py OUTDIR && node career_js/test/recruiting_part5_compare.mjs OUTDIR

Two real seeded careers are played by the Python (a season and its portal each; about three minutes each, kept as
pickles in OUTDIR/states and reused), the state saved as each week's recruiting step was called. What it writes:
  setup.json         the constants of the other parts of the file that this part reads, persona's and offseason's
  snap_<tag>.json    one saved state (slimmed: no rating lists, the log's tail) and the batches of calls made on it
  big_<name>.json    portal_rc, _truths, make_staff, _set_record and the functions that need no state
A batch is a fresh copy of the state, a list of calls, what each returned, what the batch left changed (`ops`), and
what this part asked the rest of the game meanwhile (`rec`: the other parts of recruiting.py, persona, news,
prospects.find; every question with its answers in order and, where the answer changed the state, the change), which
the compare script replays as stubs. _event, _unmark and _contact are three small functions of other parts the
compare script writes out itself. The weekly step is run with every function it calls replaced by one that only
notes the call (the same on both sides): what it is held to is the order, the arguments and the seeds."""
import inspect
import json
import os
import pickle
import random
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("CFP_SEASONS_DIR", tempfile.mkdtemp())
os.environ.setdefault("SIM_WORKERS", "1")

from sim import season, news                                                   # noqa: E402
from coach_career import clear, offseason, persona, recruiting                 # noqa: E402
from coach_career import prospects as pr                                       # noqa: E402

CAREERS = (("smu", 11, "season"), ("ohio-state", 5, "off"))
TAGS = ("week_03", "week_09", "week_14", "week_15", "week_16", "week_20", "portal_01", "portal_02", "portal_04")
LOG_KEEP = 20
PURE_AT = ("week_03", "week_20", "portal_02")     # where a function taken as changing nothing is proved to (once each)
OUT = None
T0 = time.time()


def say(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


# ---- the careers ------------------------------------------------------------------------------------------------

def play(states: Path, team: str, seed: int, mode: str) -> None:
    """A career season and its portal, the state pickled at every call of recruiting.weekly_step."""
    real = recruiting.weekly_step

    def wrapped(state, week, auto_user=False):
        tag = f"{'portal' if state['recruiting'].get('portal') else 'week'}_{week:02d}"
        with open(states / f"{team}_{seed}_{tag}.pkl", "wb") as f:
            pickle.dump({"state": state, "week": week, "auto_user": auto_user}, f)
        return real(state, week, auto_user)
    recruiting.weekly_step = wrapped
    try:
        st = season.new_season(team, "full", seed=seed, career=True)
        st["career"]["settings"]["auto_recruit"] = mode
        with open(states / f"{team}_{seed}_start.pkl", "wb") as f:
            pickle.dump({"state": st}, f)
        while not st.get("done"):
            season.advance(st)
        off = offseason.start(st)
        off["auto"] = True
        for _ in range(12):
            if off["stage"] in ("portal_recap", "development"):
                break
            offseason.advance(st)
        with open(states / f"{team}_{seed}_after_portal.pkl", "wb") as f:
            pickle.dump({"state": st}, f)
    finally:
        recruiting.weekly_step = real


# ---- JSON, slimming, diffs ----------------------------------------------------------------------------------------

def canon(v):
    """A value as both sides write it: whole floats as whole numbers, tuples as lists, sets sorted."""
    if isinstance(v, bool) or v is None or isinstance(v, (int, str)):
        return v
    if isinstance(v, float):
        return int(v) if v.is_integer() and abs(v) < 1e15 else v
    if isinstance(v, (list, tuple)):
        return [canon(x) for x in v]
    if isinstance(v, (set, frozenset)):
        return sorted(canon(x) for x in v)
    if isinstance(v, dict):
        return {str(k): canon(x) for k, x in v.items()}
    raise TypeError(type(v))


def jclone(v):
    return json.loads(json.dumps(v))


P_DROP = ("ratings", "potential")
STATE_KEEP = ("id", "team", "current_week", "year", "rng_state", "done", "coach", "career")


def slim(state: dict, base: int) -> dict:
    """The state as this part reads it: the prospects without their rating lists, the log from `base` on."""
    out = {k: state[k] for k in STATE_KEEP if k in state}
    rc = {}
    for k, v in state["recruiting"].items():
        if k == "prospects":
            rc[k] = {pid: {f: x for f, x in p.items() if f not in P_DROP} for pid, p in v.items()}
        elif k == "log":
            rc[k] = v[base:]
        else:
            rc[k] = v
    out["recruiting"] = rc
    return jclone(out)


def lite(state: dict, base: int) -> dict:
    """What the weekly step itself reads and writes (its calls are notes): enough of the state for those batches."""
    rc = state["recruiting"]
    out = {k: state[k] for k in ("id", "team", "current_week", "year", "career") if k in state}
    out["recruiting"] = {k: (rc[k][base:] if k == "log" else rc[k]) for k in ("seed", "portal", "week", "hours", "scout_points", "log") if k in rc}
    return jclone(out)


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
        elif len(b) > len(a) and json.dumps(b[:len(a)]) == json.dumps(a):
            ops.append(["app", list(path), b[len(a):]])
        else:
            ops.append(["set", list(path), b])
    elif isinstance(a, bool) != isinstance(b, bool) or a != b or type(a) is not type(b) and not (isinstance(a, (int, float)) and isinstance(b, (int, float))):
        ops.append(["set", list(path), b])
    return ops


def apply(obj, ops) -> None:
    for op in ops:
        at = obj
        for k in op[1][:-1]:
            if isinstance(at, dict) and k not in at:
                at[k] = {}
            at = at[k]
        if op[0] == "app":
            at[op[1][-1]].extend(jclone(op[2]))
        elif op[0] == "del":
            del at[op[1][-1]]
        else:
            at[op[1][-1]] = jclone(op[2])


def checked_diff(before, after) -> list:
    ops = jclone(diff(before, after))
    again = jclone(before)
    apply(again, ops)
    assert json.dumps(again) == json.dumps(after), "the diff does not rebuild the state (a dict's key order moved?)"
    return ops


# ---- recording what this part asks the rest of the game ------------------------------------------------------------

class Tape:
    state = None          # the batch's state
    base = 0              # its log's base
    rec = None            # {"name:[key]": [{"r": answer, "o": ops}, ...]}
    depth = 0
    took = None           # a _Room's took calls
    rooms = None          # the fliers of the rooms made
    pure_seen = None      # per snapshot: how many times a function's purity was checked
    asked = 0


T = Tape()
MISSING = object()
FULL = "full"
# a function that changes the state: where (paths under state["recruiting"]; the log is always followed)
SCOPES = {
    "recruiting._commit": [("status",), ("commits_v",), ("nil",), ("hats",)],
    "recruiting.act": FULL,
    "recruiting.scout_points_left": [("scout_points",)],
    "persona.learn_from_read": [("traits_known",), ("revealed", "$team")],
}
HAND = ("_event", "_unmark", "_contact")       # written out in the compare script


def key_of(v):
    if v is T.state or (isinstance(v, dict) and "recruiting" in v and "team" in v):
        return "<state>"
    if isinstance(v, random.Random):
        return "<rng>"
    if isinstance(v, recruiting._Room):
        return "<room>"
    if isinstance(v, dict):
        if "prospects" in v and "status" in v:
            return "<rc>"
        if "id" in v and "name" in v:
            return f"<p:{v['id']}>"
        if len(v) > 20:
            return "<dict>"
        return {str(k): key_of(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [key_of(x) for x in v]
    return canon(v)


def at_path(rc, path):
    for k in path:
        if not isinstance(rc, dict) or k not in rc:
            return MISSING
        rc = rc[k]
    return rc


def scoped_before(scope):
    rc = T.state["recruiting"]
    paths = [tuple(T.state["team"] if k == "$team" else k for k in p) for p in scope]
    return paths, [(MISSING if at_path(rc, p) is MISSING else jclone(at_path(rc, p))) for p in paths], len(rc["log"])


def scoped_ops(paths, before, log_len) -> list:
    rc = T.state["recruiting"]
    ops = []
    for p, was in zip(paths, before):
        now = at_path(rc, p)
        where = ["recruiting", *p]
        if now is MISSING:
            if was is not MISSING:
                ops.append(["del", where])
        elif was is MISSING:
            ops.append(["set", where, jclone(now)])
        else:
            diff(was, jclone(now), tuple(where), ops)
    if len(rc["log"]) > log_len:
        ops.append(["app", ["recruiting", "log"], jclone(rc["log"][log_len:])])
    return jclone(ops)


def foreign(owner, label: str, name: str, method: bool = False) -> None:
    real = getattr(owner, name)
    sig = inspect.signature(real)
    full = f"{label}.{name}"

    def w(*a, **k):
        if T.rec is None or T.depth:
            return real(*a, **k)
        bound = sig.bind(*a, **k)
        args = []
        for pname, val in bound.arguments.items():
            kind = sig.parameters[pname].kind
            if kind is inspect.Parameter.VAR_KEYWORD:
                if val:
                    args.append(val)
            elif not (method and pname == "self"):
                args.append(val)
        key = f"{full}:" + json.dumps(key_of(args), separators=(",", ":"), ensure_ascii=False)
        scope = SCOPES.get(full)
        check = False
        if scope is None:                                 # taken as changing nothing: proved the first times in a snapshot
            n = T.pure_seen.get(full, 0)
            check = n < 1
            T.pure_seen[full] = n + 1
        whole = slim(T.state, T.base) if (scope == FULL or check) else None
        part = scoped_before(scope) if scope not in (None, FULL) else None
        T.depth += 1
        err = None
        try:
            out = real(*a, **k)
        except recruiting.RecruitingError as e:
            err, out = e, None
        finally:
            T.depth -= 1
        ans = {"r": canon(out)}
        if err is not None:
            ans["e"] = [err.code, err.message]
        if scope == FULL:
            ans["o"] = checked_diff(whole, slim(T.state, T.base))
        elif scope is not None:
            ans["o"] = scoped_ops(*part)
        elif check:
            assert not diff(whole, slim(T.state, T.base)), f"{full} changed the state"
        T.rec.setdefault(key, []).append(ans)
        T.asked += 1
        if err is not None:
            raise err
        return out
    for extra in ("cache_clear", "cache_info"):
        if hasattr(real, extra):
            setattr(w, extra, getattr(real, extra))
    setattr(owner, name, w)


MINE = ("_hat _pair_ok _last_quarterbacks _sign auto_mode _asks_for_more weekly_step _weekly_step _portal_draws _title no_room _lost_why "
        "lost_reason lost_line school_name _season_line portal_rc _truths word word_band look_week _read_words _flags report_looks "
        "area_looks report_complete looks_left _normalize_read look look_notability read_spread read_interval shown_range grade_range "
        "make_staff set_favorite set_board assign scout_week spend_leftover area_open visible prospect_list _set_record").split()
OTHER_PARTS = ("_team_model fbs_schools _home tilt_for _priorities nil_ask tier_of close_week early_signing_week signing_week is_portal "
               "_group_of commits_by_group interest _winning best_evaluator scout_points_left look_cost _run_planned _carry_planned act "
               "_flush _snapshot_ranks _report _forgive_pesters _commits auto_recruit _visits _offers_by_prospect _commit _promises "
               "_firm_up _draws").split()
PERSONA = "mate _school_name goes_pro pro_line cool_quiet bloom twist_week learn_styles roll_twists read_mult learn_from_read draw".split()
STEP_FAKES = ("_run_planned _flush _visits scout_week spend_leftover _asks_for_more _commits auto_recruit _forgive_pesters _portal_draws "
              "_promises _firm_up _draws _sign _snapshot_ranks _report _carry_planned").split()
STEP_PERSONA = "cool_quiet bloom twist_week learn_styles roll_twists".split()
CLEAR = [None]


def hooks() -> None:
    for name in OTHER_PARTS:
        foreign(recruiting, "recruiting", name)
    for name in PERSONA:
        foreign(persona, "persona", name)
    foreign(news, "news", "_when")
    foreign(pr, "prospects", "find")
    foreign(pr, "prospects", "generational_seen")
    foreign(recruiting._Room, "room", "why_not", method=True)
    took, init = recruiting._Room.took, recruiting._Room.__init__

    def took_w(self, slug, pid, n=1):
        if T.rec is not None and not T.depth:
            T.took.append([slug, pid, n])
        return took(self, slug, pid, n)

    def init_w(self, state, flier=False):
        if T.rec is not None and not T.depth:
            T.rooms.append(bool(flier))
        T.depth += 1                       # what a room asks as it is made is its own business
        try:
            init(self, state, flier)
        finally:
            T.depth -= 1
    recruiting._Room.took, recruiting._Room.__init__ = took_w, init_w
    on = clear.on
    clear.on = lambda: on() if CLEAR[0] is None else CLEAR[0]


# ---- a batch ----------------------------------------------------------------------------------------------------------

class Snap:
    def __init__(self, tag: str, blob: dict):
        self.tag = tag
        self.pickle = pickle.dumps(blob["state"])
        self.week, self.auto_user = blob.get("week"), blob.get("auto_user", False)
        st = blob["state"]
        self.base = max(0, len(st["recruiting"]["log"]) - LOG_KEEP)
        self.slim = slim(st, self.base)
        self.lines, self.n_calls = [], 0
        if T.pure_seen is None or tag.endswith(PURE_AT):
            T.pure_seen = {}

    def fresh(self) -> dict:
        return pickle.loads(self.pickle)

    def batch(self, name: str, calls: list, pre=None, clear_on=None, fakes=None) -> None:
        """`calls`: [fn, args]; an argument {"$": "state" | "rng" | "room" | "read" | "name"} is made on each side.
        `pre`: ops applied to the fresh state first. `fakes`: the weekly step's calls replaced by notes."""
        st = self.fresh()
        T.base = self.base
        pre = jclone(pre or [])
        apply(st, pre)
        view = lite if fakes is not None else slim
        before = view(st, self.base)
        T.state, T.rec, T.took, T.rooms, T.depth = st, {}, [], [], 0
        CLEAR[0] = clear_on
        rngs, results, notes = [], [], []
        undo = install_fakes(st, notes, fakes) if fakes is not None else None

        def arg(a):
            if isinstance(a, dict) and "$" in a:
                if a["$"] == "state":
                    return st
                if a["$"] == "rng":
                    rngs.append(random.Random(a["seed"]))
                    return rngs[-1]
                if a["$"] == "room":
                    return recruiting._Room(st, flier=a["flier"])
                if a["$"] == "read":
                    return st["recruiting"]["reads"].get(a["pid"])
                if a["$"] == "offered":
                    return recruiting._offers_by_prospect(st)
                if a["$"] == "win":
                    return recruiting._winning(st)
            return a
        try:
            for fn, args in calls:
                real_args = [arg(a) for a in args]
                try:
                    results.append({"r": canon(getattr(recruiting, fn)(*real_args))})
                except recruiting.RecruitingError as e:
                    results.append({"e": [e.code, e.message]})
                except StepBoom:
                    results.append({"boom": True})
        finally:
            rec = T.rec
            T.rec = None
            CLEAR[0] = None
            if undo:
                undo()
        b = {"name": name, "pre": pre, "calls": calls, "clear": clear_on, "fakes": fakes, "results": results, "rec": rec,
             "took": T.took, "rooms": T.rooms, "rngs": [r.random() for r in rngs], "notes": notes, "step_week": recruiting._STEP_WEEK[0],
             "ops": checked_diff(before, view(st, self.base)), "state": before if fakes is not None else None}
        self.lines.append(json.dumps(b))
        self.n_calls += len(calls)

    def write(self) -> None:
        with open(OUT / f"snap_{self.tag}.jsonl", "w") as f:           # the state, then a batch a line
            f.write(json.dumps({"tag": self.tag, "state": self.slim}) + "\n")
            for line in self.lines:
                f.write(line + "\n")
        say(self.tag, len(self.lines), "batches,", self.n_calls, "calls")


class StepBoom(Exception):
    pass


def install_fakes(st: dict, notes: list, fakes: dict):
    """The weekly step's calls as notes: [name, the arguments (a generator as its next number)], the same in the
    compare script. `_commits` hands back a marker, `_report` adds a line to the log, and `fakes["boom"]` names one
    that raises (the step must still put _STEP_WEEK back)."""
    kept = []

    def note(owner, label, name):
        real = getattr(owner, name)
        kept.append((owner, name, real))

        def f(*a, **k):
            row = [f"{label}.{name}", recruiting._STEP_WEEK[0]]
            for x in list(a) + list(k.values()):
                if x is st:
                    row.append("<state>")
                elif isinstance(x, random.Random):
                    row.append(x.random())
                else:
                    row.append(canon(x))
            notes.append(row)
            if fakes.get("boom") == name:
                raise StepBoom()
            if name == "_commits":
                return {"marker": 7}
            if name == "_report":
                st["recruiting"]["log"].append({"week": st["current_week"], "kind": "report-note"})
                return {}
            return None
        setattr(owner, name, f)
    for name in STEP_FAKES:
        note(recruiting, "recruiting", name)
    for name in STEP_PERSONA:
        note(persona, "persona", name)

    def undo():
        for owner, name, real in kept:
            setattr(owner, name, real)
    return undo


S = {"$": "state"}


def rng_arg(seed):
    return {"$": "rng", "seed": seed}


# ---- the cases on one saved state -------------------------------------------------------------------------------------

def spread(xs: list, n: int) -> list:
    """About n of xs, evenly."""
    xs = list(xs)
    if len(xs) <= n:
        return xs
    step = len(xs) / n
    return [xs[int(i * step)] for i in range(n)]


def cases(snap: Snap) -> None:
    st = snap.fresh()
    rc = st["recruiting"]
    me = st["team"]
    portal = bool(rc.get("portal"))
    week = snap.week
    pids = list(rc["prospects"])
    by_rank = sorted(pids, key=lambda q: rc["prospects"][q]["rank"])
    read_pids = [q for q in pids if rc["reads"].get(q)]
    unread = [q for q in by_rank if q not in rc["reads"]]
    complete = [q for q in read_pids if recruiting.report_complete(rc["reads"][q])]
    short = [q for q in read_pids if not recruiting.report_complete(rc["reads"][q])]
    board = list(rc.get("board") or [])
    my_offers = list(rc["offers"].get(me, []))
    mine_committed = [q for q in pids if rc["status"][q]["committed"] == me]
    schools = sorted(rc["boards"]) or sorted(recruiting.fbs_schools(st))
    rand = random.Random(f"cases-{snap.tag}")

    # ---- reads as words and numbers
    sample = spread(read_pids, 150) + unread[:10] + list(rc.get("generational") or [])[:5] + spread(complete, 40)
    calls = []
    for q in sample:
        calls.append(["_read_words", [S, q]])
        calls.append(["_flags", [S, q]])
        for g in recruiting.GROUPS:
            calls += [["read_spread", [S, q, g]], ["read_interval", [S, q, g]], ["grade_range", [S, q, g]], ["shown_range", [S, q, g]]]
        r = {"$": "read", "pid": q}
        calls += [[f, [r]] for f in ("report_looks", "area_looks", "report_complete", "looks_left", "area_open")]
    calls += [["visible", [S]], ["prospect_list", [S]], ["look_week", [S]], ["auto_mode", [S]]]
    calls += [["look_notability", [e]] for e in (rc.get("looks") or [])[:60]]
    snap.batch("reads (words)", calls, clear_on=False)
    calls = []
    for q in spread(sample, 80):
        for g in recruiting.GROUPS:
            calls += [["shown_range", [S, q, g]], ["shown_range", [S, q, g, True]], ["shown_range", [S, q, g, False]]]
    snap.batch("reads (Clear Mode)", calls, clear_on=True)
    # an old save's reads: whole looks past the cap, no area tally
    old = spread(read_pids, 12)
    if old:
        pre = []
        for i, q in enumerate(old):
            pre.append(["set", ["recruiting", "reads", q, "looks"], [4, 3, 2, 5, 1, 0][i % 6]])
            if i % 2:
                pre.append(["del", ["recruiting", "reads", q, "area"]])
            else:
                pre.append(["set", ["recruiting", "reads", q, "area"], [None, 3, 0.5][i % 3]])
        calls = []
        for q in old:
            r = {"$": "read", "pid": q}
            calls += [[f, [r]] for f in ("report_looks", "area_looks", "report_complete", "looks_left", "area_open")]
            calls += [["_normalize_read", [r]], ["_read_words", [S, q]], ["read_interval", [S, q, "potential"]]]
            calls.append(["look", [S, q, 70, rng_arg(f"old-{q}"), "r1"]])
        snap.batch("old-save reads", calls, pre=pre, clear_on=False)

    # ---- looks
    calls = []
    lookers = spread(short, 40) + spread(complete, 8) + unread[:25] + spread(unread, 25) + board[:15]
    rng = rng_arg(f"looks-{snap.tag}")
    for i, q in enumerate(lookers):
        rating = [40, 55, 61, 70, 79, 88, 95, 99][i % 8]
        form = i % 7
        if form == 0:
            calls.append(["look", [S, q, rating, rng]])
        elif form == 1:
            calls.append(["look", [S, q, rating, rng, None, None, 0.5]])
        elif form == 2:
            calls.append(["look", [S, q, rating, rng, "r1", week]])
        elif form == 3:
            calls.append(["look", [S, q, rating, rng, "oc", (week or 1) + 1, recruiting.AREA_LOOK]])
        elif form == 4:
            calls.append(["look", [S, q, rating, rng, "trip", None, 2.0]])
        elif form == 5:
            calls.append(["look", [S, q, rating, rng, "dc", None, 0.25]])
        else:
            calls.append(["look", [S, q, rating, rng, None, week, 1]])
        if i % 5 == 0:
            calls.append(["look", [S, q, rating, rng]])                # a second trip the same week
            calls.append(["_read_words", [S, q]])
    snap.batch("looks", calls, clear_on=False)
    # one scout's week of many looks: the log keeps LOOK_LOG_KEEP
    many = (unread[:60] + spread(short, 30))
    snap.batch("looks (one scout, the log's cap)",
               [["look", [S, q, 45 + (i % 3) * 20, rng_arg(f"cap-{i}"), "r2", week, 1.0]] for i, q in enumerate(many)], clear_on=False)
    snap.batch("looks (Clear Mode)", [["look", [S, q, 90, rng_arg(f"clear-{q}")]] for q in spread(short, 12) + unread[:6]], clear_on=True)

    # ---- the staff's week
    snap.batch("scout_week", [["scout_week", [S]]], clear_on=False)
    areas = list(recruiting.AREAS)
    snap.batch("assign, scout_week", [["assign", [S, "oc", areas[2]]], ["assign", [S, "r1", areas[5]]], ["assign", [S, "r3", "Atlantis"]],
                                      ["assign", [S, "nobody", areas[0]]], ["assign", [S, "dc", areas[-1]]],
                                      ["scout_week", [S, (week or 1) + 1]]], clear_on=False)
    on_board = [["set_board", [S, q, True]] for q in (by_rank[5:11] + spread(short, 6) + unread[40:46])]
    snap.batch("spend_leftover", on_board + [["spend_leftover", [S, week or 1]], ["spend_leftover", [S, week or 1]]], clear_on=False)
    snap.batch("spend_leftover (few points)", on_board + [["spend_leftover", [S, (week or 1) + 1]]],
               pre=[["set", ["recruiting", "scout_points"], {me: 15}]], clear_on=False)
    snap.batch("spend_leftover (no points, no staff)", [["spend_leftover", [S, 3]], ["scout_week", [S, week or 1]]],
               pre=[["set", ["recruiting", "scout_points"], {me: 0}], ["set", ["career", "staff"], []]])
    snap.batch("spend_leftover (no career)", [["spend_leftover", [S, 3]], ["scout_week", [S]], ["auto_mode", [S]]], pre=[["del", ["career"]]])

    # ---- your board and favorites
    calls = [["set_favorite", [S, by_rank[0], True]], ["set_favorite", [S, by_rank[0], True]], ["set_favorite", [S, by_rank[1], False]],
             ["set_favorite", [S, by_rank[2], True]], ["set_favorite", [S, by_rank[0], False]]]
    for q in board[:6] + my_offers[:10] + mine_committed[:8] + by_rank[20:24]:
        calls.append(["set_board", [S, q, False]])
    for q in board[:3] + mine_committed[:3] + by_rank[20:22]:
        calls.append(["set_board", [S, q, True]])
    calls += [["set_board", [S, by_rank[30], True]], ["set_board", [S, by_rank[30], True]], ["set_board", [S, by_rank[30], False]],
              ["set_board", [S, by_rank[30], False]]]
    snap.batch("favorites and the board", calls)
    hard = [q for q in mine_committed if not rc["status"][q]["signed"]][:3]
    if hard:
        snap.batch("the board: a hard commit", [["set_board", [S, q, False]] for q in hard] + [["set_board", [S, hard[0], True]]],
                   pre=[["set", ["recruiting", "status", q, "hard"], True] for q in hard[:2]])

    # ---- the weekly step, every call a note
    for auto_user in (False, True):
        for setting in ("keep", "off", "week", "season", True, "bogus"):
            pre = [] if setting == "keep" else [["set", ["career", "settings", "auto_recruit"], setting]]
            snap.batch(f"weekly_step ({auto_user}, {setting})", [["weekly_step", [S, week, auto_user]]], pre=pre, fakes={})
    snap.batch("weekly_step (default)", [["weekly_step", [S, week]]], fakes={})
    snap.batch("weekly_step (a failure inside)", [["weekly_step", [S, week]]], fakes={"boom": "_forgive_pesters"})
    if not portal:
        for w in (1, 14, 15, 16, 19, 20, 21):
            if w != week:
                snap.batch(f"weekly_step (as week {w})", [["weekly_step", [S, w, False]]], fakes={})
    else:
        for w in (1, 2, 3, 4):
            if w != week:
                snap.batch(f"weekly_step (as portal week {w})", [["weekly_step", [S, w, True]]], fakes={})

    if portal:
        # ---- the portal's decisions
        snap.batch("_portal_draws", [["_portal_draws", [S, week, rng_arg(f"recruiting-{rc['seed']}-portal-{week}")]]])
        snap.batch("_portal_draws (the last week, your Auto off)", [["_portal_draws", [S, 4, rng_arg("last")]]],
                   pre=[["set", ["career", "settings", "auto_recruit"], "off"]])
        snap.batch("_portal_draws (week 0 and past the last)", [["_portal_draws", [S, 0, rng_arg("zero")]], ["_portal_draws", [S, 9, rng_arg("nine")]]])
        watch = (board + my_offers + by_rank[:40])[:80]
        calls = [["no_room", [S, s, q]] for q in watch for s in ([me] + rand.sample(schools, 2))]
        snap.batch("no_room", calls)
        snap.batch("no_room (the last week, your Auto off)", calls[:90],
                   pre=[["set", ["career", "settings", "auto_recruit"], "off"], ["set", ["recruiting", "week"], 4]])
        offered = recruiting._offers_by_prospect(st)
        calls = []
        for q in watch:
            got = list(offered.get(q, []))
            for school in (got[:2] + [me, schools[3]]):
                calls.append(["_lost_why", [S, {"$": "room", "flier": False}, q, school, got]])
                calls.append(["_lost_why", [S, {"$": "room", "flier": True}, q, school, got + [me]]])
        snap.batch("_lost_why", calls)
        snap.batch("_lost_why (your Auto off)", calls[:120], pre=[["set", ["career", "settings", "auto_recruit"], "off"]])
        snap.batch("_lost_why (no team)", calls[:6], pre=[["set", ["team"], None]])
    else:
        # ---- hats, asks, signing
        fin = [schools[3:4], schools[10:12], schools[20:23], schools[30:34]]
        calls = [["_hat", [S, by_rank[i], w, fin[i % 4]]] for i, w in enumerate((week, 1, 9, 12, 13, 14, 15, 16, 19, 20))]
        snap.batch("_hat", calls)
        snap.batch("_asks_for_more", [["_asks_for_more", [S, week]], ["_asks_for_more", [S, week]]])
        # a rival's bigger number, made: schools holding NIL on the same prospect
        held = {}
        for slug, n in rc["nil"].items():
            for q in n["held"]:
                if q in rc["offers"].get(slug, []):
                    held.setdefault(q, []).append(slug)
        pre = []
        for q, ss in list(held.items())[:60]:
            others = [s for s in rc["offers"] if q in rc["offers"][s] and s not in ss][:2]
            for j, s in enumerate(others):
                if s in rc["nil"]:
                    pre.append(["set", ["recruiting", "nil", s, "held", q], rc["nil"][ss[0]]["held"][q] * (2 + j)])
        if pre:
            snap.batch("_asks_for_more (bigger numbers)", [["_asks_for_more", [S, week]], ["_asks_for_more", [S, week]]], pre=pre)
        offered = recruiting._offers_by_prospect(st)
        mates = [q for q in pids if persona.mate(st, q)]
        calls = []
        for q in spread(mates, 40) + by_rank[:5]:
            for s in (list(offered.get(q, []))[:3] + rand.sample(schools, 2)):
                calls.append(["_pair_ok", [S, s, q, {"$": "offered"}, {"$": "room", "flier": bool(len(calls) % 2)}]])
        snap.batch("_pair_ok", calls)
        snap.batch("_sign (early)", [["_sign", [S, False]]])
        snap.batch("_sign (early), your Auto off", [["_sign", [S, False]]], pre=[["set", ["career", "settings", "auto_recruit"], "off"]])
        if week >= 14:
            snap.batch("_last_quarterbacks", [["_last_quarterbacks", [S, {"$": "room", "flier": True}, {"$": "win"}, {"$": "offered"}]]])
            snap.batch("_sign (final)", [["_sign", [S, True]]])
            snap.batch("_sign (early, then final), your Auto off", [["_sign", [S, False]], ["_sign", [S, True]]],
                       pre=[["set", ["career", "settings", "auto_recruit"], "off"]])
    snap.write()


# ---- the cases that need no saved state, or their own ---------------------------------------------------------------------

def big(name: str, data: dict) -> None:
    with open(OUT / f"big_{name}.json", "w") as f:
        json.dump(data, f)
    say("big", name)


def record(fn):
    """Run fn() with the tape on (no state to follow): its answer and what it asked."""
    T.state, T.rec, T.took, T.rooms, T.depth, T.pure_seen, T.base = {"team": None, "recruiting": {"log": []}}, {}, [], [], 0, {}, 0
    try:
        out = fn()
    finally:
        rec = T.rec
        T.rec = None
    return out, rec


def stateless(states: Path) -> None:
    name = {"$": "name"}               # a school's name from its slug: "<slug>" on both sides
    calls = []
    pts = [x / 4 for x in range(-40, 440)] + [f + d for f in recruiting.WORD_FLOORS[:-1] for d in (-1e-9, 0, 1e-9, -1e-12)] + [-1e9, 1e9]
    for p in pts:
        calls += [["word", [p]], ["word_band", [p]]]
    for words in ("offensive line", "quarterback", "  tight   end ", "", "his position", "éclair maker", "a b c"):
        calls.append(["_title", [words]])
    for v in ("off", "week", "season", True, False, None, "bogus", 1, 0):
        calls.append(["auto_mode", [{"career": {"settings": {"auto_recruit": v}}}]])
    calls += [["auto_mode", [{}]], ["auto_mode", [{"career": None}]], ["auto_mode", [{"career": {}}]], ["auto_mode", [{"career": {"settings": None}}]]]
    for why in ("no_room_roster", "no_room_group", "passed", "behind", "no_offer", "unsigned", "other", None, ""):
        for kind in ("signed", "unsigned"):
            for school in ("georgia", None):
                for group in ("linebacker", None):
                    for walk in (True, False):
                        e = {"kind": kind, "lost": why, "school": school, "group": group, "walk_on": walk}
                        calls.append(["lost_reason", [e, name]])
                        if school is not None or kind == "unsigned" or not why:
                            calls.append(["lost_line", [e, name]])
    calls += [["lost_reason", [{"kind": "signed"}, name]], ["lost_line", [{"kind": "signed"}, name]],
              ["lost_reason", [{"lost": "passed", "school": "texas"}, name]], ["lost_line", [{"kind": "signed", "lost": "behind", "school": "texas"}, name]]]
    teams = season.load_teams()
    for slug in list(teams) + ["nowhere", None, "FCS", ""]:
        calls.append(["school_name", [slug]])
    for e in ({"flags": ["gem"], "after": {}}, {"flags": [], "after": {"potential": ["Solid", "Strong"]}}, {"flags": [], "after": {"technique": ["Fair", "Fair"]}},
              {"flags": ["bust"], "after": {"potential": ["Fair", "Fair"]}}, {"flags": [], "after": {}}):
        calls.append(["look_notability", [e]])
    for read in (None, {}, {"looks": 0}, {"looks": 2}, {"looks": 2.5, "area": 2.0}, {"looks": 3, "area": 0.5}, {"looks": 7}, {"looks": None, "area": None},
                 {"looks": 1.5, "area": None}, {"looks": 1, "area": 5}, {"looks": 2.999, "area": 1.999}, {"area": 1.0}):
        calls += [[f, [read]] for f in ("report_looks", "area_looks", "report_complete", "looks_left", "area_open")]
        if read:
            calls.append(["_normalize_read", [read]])
    for st_ in ({"current_week": 7, "recruiting": {}}, {"current_week": 7, "recruiting": {"portal": True, "week": 3}},
                {"current_week": 20, "recruiting": {"portal": False, "week": 2}}):
        calls.append(["look_week", [st_]])
    results = []
    for fn, args in calls:
        real = [(lambda slug: f"<{slug}>") if a == name else jclone(a) for a in args]
        out = getattr(recruiting, fn)(*real)
        results.append({"r": canon(out), "arg": canon(real[0]) if fn == "_normalize_read" else None})
    big("stateless", {"calls": calls, "results": results})

    # _set_record on a real schedule
    st = pickle.load(open(states / f"{CAREERS[0][0]}_{CAREERS[0][1]}_start.pkl", "rb"))["state"]
    cases_ = []
    for slug, w, l in (("smu", 7, 0), ("kent-state", 3, 4), ("alabama", 0, 12), ("texas", 12, 0), ("ohio-state", 2, 2), ("nowhere", 3, 3), ("smu", 0, 0)):
        games = jclone(st["games"])
        fake = {"games": games}
        recruiting._set_record(fake, slug, w, l)
        cases_.append({"slug": slug, "wins": w, "losses": l, "after": [[k, g] for k, g in games.items()]})
    big("set_record", {"games": [[k, g] for k, g in st["games"].items()], "cases": cases_})

    # make_staff: many schools, seeds and coaches on a real class's names
    names = {q: {"name": p["name"]} for q, p in st["recruiting"]["prospects"].items()}
    slugs = spread(sorted(recruiting.fbs_schools(st)), 45)
    cases_ = []
    for i, slug in enumerate(slugs):
        head = (teams[slug].get("coaches") or {}).get("head_coach") or {}
        oc = (teams[slug].get("coaches") or {}).get("offensive_coordinator") or {}
        coach = [None, {"name": "Pat Example"}, {"name": head.get("name")}, {"name": oc.get("name") or "Sam Other"}, {}][i % 5]
        mini = {"team": slug, "rng_state": [0, 11, 971477686, 5][i % 4], "career": {"coach": coach} if i % 7 else None, "recruiting": {"prospects": names}}
        if i % 3:
            mini["year"] = 2026 + i % 4
        if i % 11 == 0:
            mini.pop("rng_state")
        out, rec = record(lambda: recruiting.make_staff(jclone(mini)))
        cases_.append({"state": {k: v for k, v in mini.items() if k != "recruiting"}, "ret": canon(out), "rec": rec})
    big("make_staff", {"names": names, "cases": cases_})

    # _truths on a real class and on a portal's entrants; portal_rc and _season_line on each career's portal
    for team, seed, _ in CAREERS:
        st = pickle.load(open(states / f"{team}_{seed}_start.pkl", "rb"))["state"]
        ps = jclone({q: {k: v for k, v in p.items() if k != "truth"} for q, p in list(st["recruiting"]["prospects"].items())[::3]})
        given = jclone(ps)
        recruiting._truths(ps, st["recruiting"]["attrs"])
        big(f"truths_{team}", {"prospects": given, "attrs": st["recruiting"]["attrs"], "truth": {q: canon(p["truth"]) for q, p in ps.items()},
                               "kept": {q: canon(p["truth"]) for q, p in list(st["recruiting"]["prospects"].items())[::3]}})
        pst = pickle.load(open(states / f"{team}_{seed}_portal_01.pkl", "rb"))["state"]
        entrants = jclone(pst["offseason"]["portal"]["players"])
        mini = {"rng_state": pst.get("rng_state", 0), "season_stats": jclone(pst.get("season_stats") or {}), "team": pst["team"]}
        runs = []
        for year, state_ in ((pst["offseason"]["year"], mini), (2031, {k: v for k, v in mini.items() if k != "rng_state"})):
            ents = entrants if year != 2031 else dict(list(entrants.items())[:150])
            out, rec = record(lambda: recruiting.portal_rc(jclone(state_), jclone(ents), year))
            runs.append({"year": year, "has_seed": "rng_state" in state_, "n": len(ents), "ret": canon(out), "rec": rec})
        lines = []
        for q, e in list(entrants.items())[:300]:
            c = e["player"]
            for group in (offseason.GROUP.get(c["pos"], "S"), "QB", "OL", "nothing"):
                lines.append([e["from"], c["n"], group, canon(recruiting._season_line(mini, e["from"], c["n"], group))])
        lines.append(["nowhere", "Nobody", "QB", canon(recruiting._season_line(mini, "nowhere", "Nobody", "QB"))])
        lines.append(["x", "Nobody", "QB", canon(recruiting._season_line({}, "x", "Nobody", "QB"))])
        same = canon(pst["recruiting"]) == runs[0]["ret"] if pst["recruiting"].get("week") == 1 and not pst["recruiting"]["log"] else None
        big(f"portal_rc_{team}", {"state": mini, "entrants": entrants, "runs": runs, "lines": lines, "as_played": same})


def setup() -> None:
    R = recruiting
    names = ("QB_EVERY_CLASS AREAS REPORT_LOOKS SEND_LOOK AREA_LOOK AREA_CAP ASK_MORE TOP_GROUP LOOK_LOG_KEEP PORTAL_WEEKS PORTAL_PRIORITY_ODDS "
             "PORTAL_TOP_PRIORITY_ODDS PORTAL_TOP_TIER PORTAL_COMMIT PORTAL_RANK_NOISE PORTAL_LOOK FCS_LINE CROWD GROUPS WORDS WORD_FLOORS GRADE_LOW "
             "GRADE_SPAN COACHABILITY_POINTS LOOK_SD WORD_SLACK CONFIDENCE_NOISE").split()
    mine = {n: canon(getattr(R, n)) for n in ("AUTO_MODES", "GROUP_WORDS", "POS_247_OF", "LINE_KEYS", "LEFTOVER_LOOK")}
    with open(OUT / "setup.json", "w") as f:
        json.dump({"recruiting": {n: canon(getattr(R, n)) for n in names}, "mine": mine, "names": MINE,
                   "persona": {"HAT_LEAD": persona.HAT_LEAD}, "offseason": {"GROUP": offseason.GROUP},
                   "careers": [list(c) for c in CAREERS], "tags": list(TAGS)}, f)


if __name__ == "__main__":
    OUT = Path(sys.argv[1])
    OUT.mkdir(parents=True, exist_ok=True)
    states = OUT / "states"
    states.mkdir(exist_ok=True)
    if sys.argv[2:3] == ["--play"]:                    # a career, in a process of its own (it leaves the league and caches changed)
        play(states, sys.argv[3], int(sys.argv[4]), sys.argv[5])
        sys.exit(0)
    only = sys.argv[2:]                                # snapshot names to (re)write, e.g. smu_11_week_15, or "big"; none: everything
    import subprocess
    for team, seed, mode in CAREERS:
        if not (states / f"{team}_{seed}_after_portal.pkl").exists():
            say("playing", team, seed)
            subprocess.run([sys.executable, __file__, str(OUT), "--play", team, str(seed), mode], check=True)
    hooks()
    setup()
    if not only or "big" in only:
        stateless(states)
    for team, seed, _ in CAREERS:
        for tag in TAGS:
            full = f"{team}_{seed}_{tag}"
            if only and full not in only:
                continue
            snap = Snap(full, pickle.load(open(states / f"{full}.pkl", "rb")))
            cases(snap)
    say("done")
