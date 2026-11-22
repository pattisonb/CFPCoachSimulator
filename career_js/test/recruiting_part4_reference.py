"""Python's answers for career_js/recruiting/part4.js (coach_career/recruiting.py lines 2495 to 3254), written for
recruiting_part4_compare.mjs to hold the JavaScript to:

    python3 career_js/test/recruiting_part4_reference.py OUT [--weeks N] [--portal 0] [--second 0] [--dump]
    node career_js/test/recruiting_part4_compare.mjs OUT

It plays real careers through the API (Clear Mode off, so the calls and visits are scenes): Ohio State, seed 11, a
whole season recruited by hand and then on Auto-recruit, the offseason up to the transfer portal and the portal's
weeks; then Toledo, seed 5, eight weeks by hand (a small school: a broken money promise can be forgiven).

The part cannot run a recruiting week alone, so its functions are recorded one call at a time, as a stream
(ops.jsonl) the Node script replays in order against one state it keeps itself:

- the state the part reads (your team, the career's id, the week, each game's week, home and score, and the whole
  recruiting block) is written once ("init"); after that only what changed is written, as small edits;
- a "case" is one call of one of the part's functions: the edits since the last look ("sync": what the rest of the
  Python did meanwhile, applied by the Node script), its arguments, every call it made into another part of the
  recruiting file or into persona, word, programs and the season (in the order made: the arguments, the answer, the
  edits the part itself had made up to then ("own": the JavaScript's state must show the same) and the edits that
  call made ("patch": applied)), its answer, and the edits it made after its last such call;
- a "digest" is the hash of that whole state after a week's step: the JavaScript's own copy must hash the same, so
  nothing it changed was missed and nothing was changed that should not be.

Every call of the week's steps (_visits, _promises, _firm_up, _draws, _forgive_pesters, _commits) is a case; a share
of the schools' Auto-recruit weeks, boards, contacts, events and commitments are (chosen by a hash, so a rerun
picks the same ones); the rest are asked directly each week (the flip odds, a money promise as the page shows it,
a school's room, the fits, the pool).
"""
import hashlib
import inspect
import json
import os
import random
import re
import sys
import tempfile
import time
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)


def opt(name, default):
    return int(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv else default


WEEKS = opt("--weeks", 99)
PORTAL = opt("--portal", 1)
SECOND = opt("--second", 1)
DUMP = "--dump" in sys.argv
os.environ["SIM_WORKERS"] = "1"
os.environ["CFP_CLEAR"] = "0"

from app import api                                                                # noqa: E402
from coach_career import persona, programs, recruiting, scenes, word               # noqa: E402
from sim import season                                                             # noqa: E402

season.SEASONS_DIR = Path(tempfile.mkdtemp(prefix="cfp-rec4-"))

# ----- the names -------------------------------------------------------------------------------------------------------

MINE = ["_contact_land", "_forgive_pesters", "_reveal", "_commits", "signed_class", "_rng", "_event", "_pool", "_national_share",
        "_fits", "_build_board", "auto_recruit", "_auto_week", "_visits", "_offers_by_prospect", "_commit", "flip_weekly",
        "flip_by_signing", "_money_talk", "money_owed", "_promises", "_firm_up", "_class_by_position", "_draws"]
# (run inside those, never a case of their own: _fit_all, _money_promise, _neglected, _Room)

# calls out of the part: None = it changes nothing the part reads; "hot" = it may change the recruiting block (all but the
# big parts no action touches); a function = the one branch it may change
contacts_of = lambda a: {"recruiting": {"contacts": {a["pid"]: None}}}
nil_of = lambda a: {"recruiting": {"nil": {a["slug"]: None}}}
hours_of = lambda a: {"recruiting": {"hours": {a["slug"]: None}}}
OUT_REC = {n: None for n in (
    "not_considering _pester_exempt cooled _grade_points _contact_points _team_model model needs _tiers open_spots is_portal _p4 "
    "academic manual_offers _coach_edge offer_cap _winning commits_by_group is_generational offers_by_group group_full "
    "portal_upgrade best_pitch would_pester _logistic top_group strengths auto_mode portal_room _interp interest "
    "early_signing_week").split()}
# one action's reach (a miss shows in the Node script as an edit of the part's own that the JavaScript never made)
act_of = lambda a: {"recruiting": {"contacts": {a["pid"]: None}, "lists": {a["pid"]: None}, "pending": {a["pid"]: None}, "why_week": {a["pid"]: None},
                                   "offers": {a["slug"]: None}, "nil": {a["slug"]: None}, "hours": {a["slug"]: None}, "visits": {a["pid"]: None},
                                   "revealed": {a["slug"]: {a["pid"]: None}}, "log": None, "status": {a["pid"]: None}, "board": None,
                                   "manual_offers": None, "action_points": None, "scenes": {a["slug"]: None}, "hats": {a["pid"]: None},
                                   "dropped": None, "planned": None, "scout_points": {a["slug"]: None}}}
points_of = lambda a: {"recruiting": {"pending": {a["pid"]: None}, "why_week": {a["pid"]: None}, "action_points": None}}
OUT_REC.update({"_contact": contacts_of, "ask_from": contacts_of, "_nil": nil_of, "nil_left": nil_of, "_hours": hours_of,
                "_act": act_of, "_add_points": points_of, "_unmark": "hot", "_hat": "hot"})
OUT_PERSONA = {n: None for n in ("pester_free board_front scared_off ai_doubts mate start_firmness quiet_mark decommit_mult "
                                 "counts_as_priority climbs of needs_attention _school_name style").split()}
OUT_PERSONA.update({"note_contact": contacts_of,
                    "set_cooled_why": lambda a: {"recruiting": {"contacts": {a["pid"]: None}, "cooled_why": {a["slug"]: None}}}})
# (real in the Node script too, small and pure: tier_of, _group_of, need_factor, group_cap, _ck, and _pair_ok, which
#  calls back into the part's _Room)
COLD = ("prospects", "reads", "ranks", "looks", "why", "reports", "attrs")       # the recruiting block's big parts no action changes
CONSTANTS = ("ASK_MULT_MAX PESTER_ASK PESTER_COST BASE_POINTS PESTER_RAMP COOLED_CONTACT DIMINISH NATIONAL_REACH STAR_KEY POS_247 "
             "REST_NEAR REST_MILES BOARD_FACTOR NATIONAL_TARGETS NATIONAL_TILT PORTAL_NATIONAL RIVAL_RANK AI_NIL AI_OVER_ASK "
             "FIRM_VISIT FIRM_START HARD_AT DECOMMIT_RATE FLIP_MARGIN FIRM_TOUCH FIRM_NIL NIL_PROMISE_SHARE NIL_PROMISE_WEEKS "
             "PACKAGE_KEPT MONEY_FORGIVE_TIER MONEY_FORGIVE_CHANCE PROMISE_RIVAL COOL_WEEKS PACKAGE_PROMISE_WEEKS FIRM_DRIFT "
             "FIRM_RIVALS FIRM_RIVAL COMMIT_FREEZE_WEEKS COMMIT_ODDS CROWD FCS_NO_OFFER_WEEK FCS_LINE LEAD_SCALE VISIT_BOOST "
             "LATE_MARKET LATE_OFFERS FIVE_STAR_FLOOR HOURS TIER_FROM_OVERALL NEED_FACTOR NEED_FLOOR ONE_A_CLASS").split()

# ----- values as JSON ----------------------------------------------------------------------------------------------------

NUMKEY = re.compile(r"^(0|[1-9]\d*)$")
BLOBS = {}
blob_file = open(out / "blobs.jsonl", "w")


def enc(v):
    """A value for the Node script: a whole float as a whole number, a tuple as a list, a set marked, a dict with a
    number-like key as its pairs in order (JavaScript would move such keys to the front), a tuple key joined."""
    if isinstance(v, float):
        return int(v) if v.is_integer() else v
    if isinstance(v, dict):
        keys = ["\u0000".join(map(str, k)) if isinstance(k, tuple) else k if isinstance(k, str) else str(k) for k in v]
        if any(NUMKEY.match(k) for k in keys) and not all(isinstance(k, int) for k in v):
            return {"$od": [[k, enc(x)] for k, x in zip(keys, v.values())]}
        return {k: enc(x) for k, x in zip(keys, v.values())}
    if isinstance(v, (list, tuple)):
        return [enc(x) for x in v]
    if isinstance(v, (set, frozenset)):
        return {"$set": sorted(v)}
    if isinstance(v, random.Random):
        s = v.getstate()
        return {"$rng": [list(s[1][:-1]), s[1][-1], s[2]]}
    return v


def blob(value):
    """A big answer, kept once by its hash."""
    text = json.dumps(value)
    if len(text) < 3000:
        return value
    h = hashlib.sha1(text.encode()).hexdigest()[:16]
    if h not in BLOBS:
        BLOBS[h] = True
        blob_file.write(json.dumps({"id": h, "value": value}) + "\n")
    return {"$blob": h}


def dcopy(v):
    if isinstance(v, dict):
        return {k: dcopy(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [dcopy(x) for x in v]
    return v


def same_leaf(o, v):
    return o == v and (type(o) is bool) == (type(v) is bool)


# ----- the state the part reads, and what changed in it since the last look ------------------------------------------------

class T:
    st = None           # the career being followed
    shadow = None       # the state as the Node script has it
    case = None         # the case being recorded
    depth = 0           # inside a call out of the part: what that asks in turn is its own business
    force = False
    counts = {}
    stats = {}
    diff_time = 0.0


ops_file = open(out / "ops.jsonl", "w")


def emit(rec):
    ops_file.write(json.dumps(rec) + "\n")


def view(st):
    return {"team": st.get("team"), "id": st["id"], "current_week": st["current_week"],
            "games": {eid: {k: g.get(k) for k in ("week", "home", "played", "home_score", "away_score")} for eid, g in st["games"].items()},
            "recruiting": st.get("recruiting") or {}}


def diff(old, new, path, ops, mask=None, skip=()):
    """The edits that turn `old` (the shadow, edited as it goes) into `new`. `mask`: only these branches. Returns
    "replace" when the keys both hold changed their order (the caller then writes the whole dict)."""
    if mask is None:
        for k in [k for k in old if k not in new]:
            ops.append(["del", path + [k]])
            del old[k]
        if [k for k in new if k in old] != list(old):
            return "replace"
        keys = new.keys()
    else:
        keys = [k for k in mask if k in new or k in old]
    for k in keys:
        if k in skip and k in old:          # (a new one is still written, where Python put it: the keys' order is the state's)
            continue
        sub = mask[k] if mask else None
        if k not in new:
            ops.append(["del", path + [k]])
            del old[k]
            continue
        v = new[k]
        if k not in old:
            ops.append(["set", path + [k], enc(v)])
            old[k] = dcopy(v)
            continue
        o = old[k]
        if isinstance(o, dict) and isinstance(v, dict):
            if sub is None and o == v:
                continue
            if diff(o, v, path + [k], ops, sub) == "replace":
                ops.append(["set", path + [k], enc(v)])
                old[k] = dcopy(v)
        elif isinstance(o, list) and isinstance(v, (list, tuple)):
            if len(o) == len(v) and (o == v or o == dcopy(v)):
                continue
            n = len(o)
            if len(v) > n and isinstance(v, list) and v[:n] == o:
                ops.append(["ext", path + [k], enc(v[n:]), len(v)])
                o.extend(dcopy(v[n:]))
            else:
                ops.append(["set", path + [k], enc(v)])
                old[k] = dcopy(v)
        elif not same_leaf(o, v):
            ops.append(["set", path + [k], enc(v)])
            old[k] = dcopy(v)
    return None


def look(mask=None):
    """The edits since the last look (within `mask`; "hot": all but the recruiting block's big parts; "warm": the
    prospects too, all the part reads; None: everything, at a digest)."""
    t = time.time()
    ops = []
    live = view(T.st)
    if mask in ("hot", "warm"):
        for k in ("team", "id", "current_week"):
            if not same_leaf(T.shadow[k], live[k]):
                ops.append(["set", [k], live[k]])
                T.shadow[k] = live[k]
        if mask == "warm":
            diff(T.shadow["games"], live["games"], ["games"], ops)
        if diff(T.shadow["recruiting"], live["recruiting"], ["recruiting"], ops, None, COLD if mask == "hot" else COLD[1:]) == "replace":
            ops.append(["set", ["recruiting"], enc(live["recruiting"])])
            T.shadow["recruiting"] = dcopy(live["recruiting"])
    else:
        diff(T.shadow, live, [], ops, mask)
    T.diff_time += time.time() - t
    return ops


def follow(st):
    """Start following a career: the whole state the part reads, written once."""
    T.st = st
    T.shadow = dcopy(view(st))
    emit({"t": "init", "state": enc(T.shadow)})


def digest(label):
    sync = look()
    # a dict rebuilt with the same items in another order is equal in Python, so the looks miss it: the parts the part
    # under test never touches are written again whole when their text moved (any other is left to fail the hash)
    rc, was = T.st.get("recruiting") or {}, T.shadow["recruiting"]
    for k in rc:
        if json.dumps(enc_plain(rc[k])) != json.dumps(was[k]) and json.dumps(enc_plain(rc[k])) != json.dumps(enc_plain(was[k])):
            if k in COLD[1:]:
                sync.append(["set", ["recruiting", k], enc(rc[k])])
                was[k] = dcopy(rc[k])
            else:
                print(f"  ({label}: the order inside recruiting/{k} moved without its items changing)", flush=True)
    text = json.dumps(enc_plain(view(T.st)))
    rec = {"t": "digest", "label": label, "sync": sync, "sha": hashlib.sha1(text.encode()).hexdigest()}
    emit(rec)
    if DUMP:
        (out / f"full_{label}.json").write_text(text)


def enc_plain(v):
    """The state as its JSON text has it (a whole float as a whole number), for the hash."""
    if isinstance(v, float):
        return int(v) if v.is_integer() else v
    if isinstance(v, dict):
        return {k: enc_plain(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [enc_plain(x) for x in v]
    return v


# ----- recording ---------------------------------------------------------------------------------------------------------

def scalar(v):
    if v is None or isinstance(v, (bool, int, str)):
        return v
    if isinstance(v, float):
        return int(v) if v.is_integer() else v
    return "$o"


def ref_of(v, args):
    """Where in the state an argument lives (the part changes it in place), or None."""
    rc = T.st["recruiting"]
    if isinstance(v, dict):
        if v.get("id") and rc["prospects"].get(v["id"]) is v:
            return ["recruiting", "prospects", v["id"]]
        pid = args.get("pid") or (args.get("p") or {}).get("id")
        slug = args.get("slug") or args.get("school")
        if pid and slug and (rc["contacts"].get(pid) or {}).get(slug) is v:
            return ["recruiting", "contacts", pid, slug]
    if isinstance(v, list) and args.get("slug") and rc["boards"].get(args["slug"]) is v:
        return ["recruiting", "boards", args["slug"]]
    return None


def enc_arg(v, args):
    if v is T.st:
        return "$state"
    r = ref_of(v, args) if isinstance(v, (dict, list)) else None
    return {"$ref": r} if r else blob(enc(v))


def enc_ret(label, r, args):
    if label == "recruiting._contact":
        return {"$ref": ["recruiting", "contacts", args["pid"], args["slug"]]}
    if label == "recruiting._nil":
        return {"$ref": ["recruiting", "nil", args["slug"]]}
    if label == "recruiting.model":
        r = {"generation": {"prospects_per_class": r["generation"]["prospects_per_class"]}}
    if label == "season.load_teams":
        r = {s: {"stadium": t.get("stadium")} for s, t in r.items()}
    return blob(enc(r))


def run_case(name, orig, sig, a, k):
    sync = look("warm")
    b = sig.bind(*a, **k)
    b.apply_defaults()
    rec = {"t": "case", "fn": name, "sync": sync, "args": [enc_arg(v, b.arguments) for v in b.arguments.values()], "calls": []}
    T.case, T.depth = rec, 0
    recruiting._FITS = (None, {}, None, None, {})       # the fits kept from before: the Node script holds none either
    T.stats[name] = T.stats.get(name, 0) + 1
    try:
        try:
            r = orig(*a, **k)
            rec["result"] = blob(enc(r))
        except recruiting.RecruitingError as exc:
            rec["raise"] = [exc.code, exc.message]
            raise
    finally:
        T.case = None
        rec["own"] = look("warm")
        emit(rec)
    return r


def sampled(name, a, k):
    """Whether this call of one of the part's functions is a case (the same choice on a rerun)."""
    if T.force:
        return True
    if name == "_national_share":
        return T.st is not None and tick(name, 50)
    if T.st is None or not a or a[0] is not T.st:
        return False
    slug = a[1] if len(a) > 1 and isinstance(a[1], str) else ""
    h = (zlib.crc32(slug.encode()) + T.st["current_week"] + (T.st["recruiting"].get("week") or 0)) % 9
    me = T.st.get("team")
    if name == "auto_recruit":
        return h == 0 or slug == me
    if name == "_build_board":
        return h == 1
    if name == "_auto_week":
        return h == 2
    if name == "_contact_land":
        return slug == me or tick(name, 150)
    if name == "_event":
        return (len(a) > 3 and a[3] == me and tick(name + "-me", 5)) or tick(name, 400)
    if name == "_reveal":
        return tick(name, 200)
    if name == "_commit":
        return tick(name, 5)
    if name == "_fits":
        return tick(name, 25)
    if name in ("flip_weekly", "flip_by_signing", "money_owed", "signed_class", "_rng", "_pool", "_commits"):
        return tick(name, 20)
    return True


def tick(name, every):
    T.counts[name] = n = T.counts.get(name, 0) + 1
    return n % every == 1


def wrap_mine(name):
    orig = getattr(recruiting, name)
    sig = inspect.signature(orig)

    def w(*a, **k):
        if T.case is not None or not sampled(name, a, k):
            return orig(*a, **k)
        return run_case(name, orig, sig, a, k)
    w.__wrapped__ = orig
    setattr(recruiting, name, w)


def wrap_out(mod, modname, name, scope):
    orig = getattr(mod, name)
    sig = inspect.signature(orig)
    label = f"{modname}.{name}"

    def w(*a, **k):
        rec = T.case
        if rec is None or T.depth:
            return orig(*a, **k)
        b = sig.bind(*a, **k)
        b.apply_defaults()
        call = {"f": label, "a": [scalar(v) for v in b.arguments.values()]}
        mask = scope(b.arguments) if callable(scope) else scope
        if mask is not None:
            call["own"] = look(mask)
        T.depth = 1
        try:
            r = orig(*a, **k)
            call["r"] = enc_ret(label, r, b.arguments)
        except recruiting.RecruitingError as exc:
            call["x"] = [exc.code, exc.message]
            raise
        finally:
            T.depth = 0
            if mask is not None:
                call["patch"] = look(mask)
            rec["calls"].append(call)
        return r
    w.__wrapped__ = orig
    setattr(mod, name, w)


for n_ in MINE:
    wrap_mine(n_)
for n_, scope_ in OUT_REC.items():
    wrap_out(recruiting, "recruiting", n_, scope_)
for n_, scope_ in OUT_PERSONA.items():
    wrap_out(persona, "persona", n_, scope_)
wrap_out(word, "word", "recruit_event", "hot")
wrap_out(programs, "programs", "get", None)
wrap_out(season, "season", "load_teams", None)


def ask(name, *a):
    """One of the part's functions asked directly, as a case."""
    T.force = True
    try:
        return getattr(recruiting, name)(*a)
    except recruiting.RecruitingError:
        return None
    finally:
        T.force = False


# ----- things asked directly that are not one function of the part (the Node script has the same) ---------------------------

def probe(name, fn, *a):
    T.stats[name] = T.stats.get(name, 0) + 1
    return run_case(name, fn, inspect.signature(fn), a, {})


def probe_room(state, flier, steps):
    """A school's room (_Room), asked and moved step by step: each answer, then its commits and what it has looked up."""
    room = recruiting._Room(state, flier=flier)
    got = []
    for s in steps:
        if s[0] == "why":
            got.append(room.why_not(s[1], s[2], offered=s[3]))
        elif s[0] == "call":
            got.append(room(s[1], s[2]))
        else:
            room.took(s[1], s[2], s[3])
            got.append(None)
    return {"got": got, "commits": room.commits, "groups": {s: list(pair) for s, pair in room.groups.items()}, "slack": room.slack,
            "yours": room.yours, "portal": room.portal}


def probe_rng(state, what):
    r = recruiting._rng(state, what)
    return [r.random(), r.random(), r.randint(1, 1000)]


def probe_redo(state, slugs, pid, stars):
    """The fits kept, then a star that moves (a Late Bloomer's jump): only what it touches is worked out again."""
    rc = state["recruiting"]
    p = rc["prospects"][pid]
    was, had, v = p["stars"], "class_v" in rc, rc.get("class_v", 0)
    first = [recruiting._fits(state, s)[pid] for s in slugs]
    p["stars"], rc["class_v"] = stars, v + 1
    try:
        return [first, {s: recruiting._fits(state, s) for s in slugs}, recruiting._fits(state, slugs[0]) is recruiting._FITS[1][slugs[0]]]
    finally:
        p["stars"] = was
        if had:
            rc["class_v"] = v
        else:
            del rc["class_v"]


def probe_shares(state):
    return [recruiting._national_share(n) for n in (2, 3, 4, 5)]


# ----- your week by hand ----------------------------------------------------------------------------------------------------

def act(st, pid, action, **k):
    try:
        return recruiting.act(st, st["team"], pid, action, **k)
    except recruiting.RecruitingError:
        return None


def scene_call(st, pid, pitch, answer):
    """A call as the page makes it: open, present, answer what he asks, pitch."""
    r = act(st, pid, "call")
    sc = (r or {}).get("scene")
    if not sc:
        return
    topics = [t for t in ("winning", "nil", "coach", "prestige") if t != pitch][:2] + [pitch]
    r = act(st, pid, "present", scene=sc["id"], topics=topics)
    sc = (r or {}).get("scene") or sc
    if sc.get("question"):
        r = act(st, pid, "answer", scene=sc["id"], answer=answer)
        sc = (r or {}).get("scene") or sc
    act(st, pid, "pitch", scene=sc["id"], pitch=pitch)


NEAR = {"ohio-state": ("OH", "PA", "MI", "IN", "KY", "WV"), "toledo": ("OH", "MI", "IN")}
FAR = ("CA", "WA", "OR", "AZ", "FL", "TX")


def hand_week(st, week, plan):
    """Your recruiting week by hand: offers with and without NIL, messages, calls that pitch NIL (a money promise),
    promises answered, visits, and a few far-off prospects kept after until they tire of it."""
    me = st["team"]
    rc = st["recruiting"]
    rng = random.Random(f"hand-{me}-{week}")
    free = [pid for pid in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"])
            if not rc["prospects"][pid].get("hidden") and not rc["status"][pid]["signed"]]
    lo, hi = (0, 400) if me == "ohio-state" else (700, 2600)
    near = [pid for pid in free[lo:hi] if rc["prospects"][pid]["hometown"]["state"] in NEAR[me] and rc["status"][pid]["committed"] in (None, me)]
    far = [pid for pid in free[lo:hi] if rc["prospects"][pid]["hometown"]["state"] in FAR and rc["status"][pid]["committed"] is None]
    if not plan:
        plan.update(near=near[:14], far=far[20:25], money=[])
    rc["hours"][me] = 1000                                # room for a full week by hand
    for pid in plan["near"] + plan["far"]:
        if pid not in rc["board"]:
            rc["board"].append(pid)
    for i, pid in enumerate(plan["near"]):
        if pid not in rc["offers"].get(me, []) and i < 4 + week:
            nil = recruiting.ask_from(st, me, pid) if i % 2 == 0 else 0
            act(st, pid, "offer", pitch=recruiting.best_pitch(st, me, pid), nil=min(nil, recruiting.nil_left(st, me)))
        act(st, pid, "message", pitch=rng.choice(recruiting.PITCHES))
        if i % 3 == week % 3:
            act(st, pid, "official_visit")
        if i % 5 == week % 5:
            act(st, pid, "hc_visit", pitch=recruiting.best_pitch(st, me, pid))
    for pid in plan["far"]:                               # not considering you: the fourth contact on is a pester
        act(st, pid, "message", pitch="prestige")
        act(st, pid, "call", pitch="winning", answer="quick")
        act(st, pid, "message", pitch="coach")
    # calls that pitch NIL to prospects who care about it: he names his number and you owe him the money
    cares = [pid for pid in free[lo:hi] if persona.counts_as_priority(st, pid, "nil") and rc["status"][pid]["committed"] is None
             and pid not in plan["money"] and pid not in rc["offers"].get(me, [])]
    for pid in cares[:5]:
        plan["money"].append(pid)
        rc["board"].append(pid) if pid not in rc["board"] else None
        scene_call(st, pid, "nil", "promise")
    for i, pid in enumerate(plan["money"]):
        if rc["status"][pid]["signed"]:
            continue
        kind = i % 5
        if kind == 0:                                     # the money put on the offer: kept
            act(st, pid, "offer", pitch="nil", nil=min(recruiting.ask_from(st, me, pid), recruiting.nil_left(st, me)))
        elif kind == 1:                                   # too little put on it: broken, short
            act(st, pid, "offer", pitch="nil", nil=5)
        elif kind == 2:                                   # kept after with no offer: broken
            act(st, pid, "message", pitch="nil")
        elif kind == 3 and pid in rc["board"] and week % 2:   # walked away
            rc["board"].remove(pid)
        # kind 4: silence, it fades
    for pid in plan["near"][:6]:                          # a call with his question answered by a promise
        if rng.random() < 0.5:
            scene_call(st, pid, recruiting.best_pitch(st, me, pid) or "winning", rng.choice(["promise", "straight", "deflect"]))


def asked(st, week):
    """What the week's own steps never ask, asked directly."""
    rc = st["recruiting"]
    me = st["team"]
    rng = random.Random(f"asked-{me}-{week}-{rc.get('week')}")
    schools = sorted(rc["boards"]) or [me]
    ask("_commits", st)
    ask("_offers_by_prospect", st)
    ask("_class_by_position", st)
    ask("_pool", st)
    probe("probe_shares", probe_shares, st)
    probe("probe_rng", probe_rng, st, rng.choice(["twists", "bloom", "anything"]))
    for s in [me] + rng.sample(schools, min(2, len(schools))):
        ask("_fits", st, s)
        ask("signed_class", st, s)
    if not rc.get("portal"):
        three = [pid for pid, p in rc["prospects"].items() if p["stars"] == 3]
        four = [pid for pid, p in rc["prospects"].items() if p["stars"] == 4]
        probe("probe_redo", probe_redo, st, rng.sample(schools, min(2, len(schools))), rng.choice(three), 4)   # one more blue chip
        probe("probe_redo", probe_redo, st, rng.sample(schools, min(2, len(schools))), rng.choice(four), 5)    # the same number of them
    committed = [pid for pid, s in rc["status"].items() if s["committed"] and s["committed"] != "FCS" and not s["signed"]]
    for pid in rng.sample(committed, min(12, len(committed))) + [next(iter(rc["status"]))]:
        gap = rng.choice([-3.0, 0.0, 0.7, 2.5, 8.0, 40.0])
        ask("flip_weekly", st, pid, gap)
        ask("flip_weekly", st, pid, gap, rng.choice([10, 40, 75, 89, 90, 100]))
        ask("flip_by_signing", st, pid, gap, rng.choice([-1, 0, 1, 3, 9, 15]))
    owed = [pid for pid, by in rc["contacts"].items() if (by.get(me) or {}).get("promises")]
    for pid in owed[:12] + rng.sample(list(rc["prospects"]), 3):
        ask("money_owed", st, me, pid)
    offers = rc["offers"]
    pairs = [(s, pid) for s in rng.sample(schools, min(8, len(schools))) for pid in rng.sample(offers.get(s) or list(rc["prospects"])[:5], min(4, len(offers.get(s) or [1] * 5)))]
    pairs += [(me, pid) for pid in (offers.get(me) or [])[:6]] + [(me, pid) for pid in rng.sample(list(rc["prospects"]), 4)]
    for flier in (False, True):
        steps = []
        for s, pid in pairs:
            steps.append(["why", s, pid, rng.choice([None, None, True, False])])
            steps.append(["call", s, pid])
            if rng.random() < 0.4:
                steps.append(["took", s, pid, rng.choice([1, 1, 2, -1])])
                steps.append(["call", s, pid])
        probe("probe_room", probe_room, st, flier, steps)


# ----- the careers ----------------------------------------------------------------------------------------------------------

def setup():
    consts = {n: enc(getattr(recruiting, n)) for n in CONSTANTS}
    (out / "setup.json").write_text(json.dumps({
        "constants": consts,
        "persona": {n: enc(getattr(persona, n)) for n in ("NEEDS_SILENT", "NEEDS_DROP", "EARLY_WEEKS", "EARLY_ODDS", "HAT_FINALISTS")},
        "scenes": {n: enc(getattr(scenes, n)) for n in ("MONEY_OWED_LINE", "MONEY_KEPT_LINE", "MONEY_FORGIVEN_LINES", "MONEY_FORGIVEN_LINE",
                                                       "MONEY_BROKEN_LINES", "MONEY_BROKEN_LINE", "PROMISE_KEPT_LINE")},
        "group": dict(__import__("coach_career.offseason", fromlist=["GROUP"]).GROUP),
    }))


def play_week(sid):
    api.call("POST", f"/api/season/{sid}/advance", {})
    while api.running():
        api.step(None)


def career(team, seed, weeks, portal):
    t0 = time.time()
    sid = api.call("POST", "/api/season", {"team": team, "mode": "full", "seed": seed, "career": True})["id"]
    st = api.loaded_state()
    follow(st)
    plan = {}
    for n in range(weeks):
        st = api.loaded_state()
        assert st is T.st, "the career's state was replaced"
        if st["done"]:
            break
        week = st["current_week"] + 1
        settings = st["career"].setdefault("settings", {})
        if not recruiting.closed(st):
            if week <= 9 or team != "ohio-state":
                hand_week(st, week, plan)
            elif week == 10:
                settings["auto_recruit"] = "week"
            else:
                settings["auto_recruit"] = "season"
        asked(st, week)
        play_week(sid)
        digest(f"{team}-w{week:02d}")
        print(f"{team} week {week}: {time.time() - t0:.0f}s, diffs {T.diff_time:.0f}s, log {len(st['recruiting']['log'])}", flush=True)
    if not portal or not api.loaded_state()["done"]:
        return
    api.call("GET", f"/api/season/{sid}/offseason")
    for n in range(40):
        st = api.loaded_state()
        if st is not T.st:
            break
        stage = (st.get("offseason") or {}).get("stage")
        if stage and stage.startswith("portal_w") and st.get("recruiting", {}).get("portal"):
            rc = st["recruiting"]
            me = st["team"]
            best = [pid for pid in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"])
                    if rc["prospects"][pid].get("from") != me and not rc["status"][pid]["signed"]]
            for pid in best[5:12]:
                if pid not in rc["board"]:
                    rc["board"].append(pid)
                act(st, pid, "offer", pitch="playing_time", nil=min(recruiting.ask_from(st, me, pid), recruiting.nil_left(st, me)))
                act(st, pid, "message", pitch="winning")
            asked(st, 0)
        if stage in ("development", "ready") or not stage:
            break
        api.call("POST", f"/api/season/{sid}/offseason/advance", {})
        st2 = api.loaded_state()
        if st2 is T.st:
            digest(f"{team}-off{n:02d}-{stage}")
        print(f"{team} offseason {stage}: {time.time() - t0:.0f}s, diffs {T.diff_time:.0f}s", flush=True)


if __name__ == "__main__":
    setup()
    career("ohio-state", 11, WEEKS, PORTAL)
    if SECOND:
        career("toledo", 5, min(WEEKS, 8), 0)
    ops_file.close()
    blob_file.close()
    print("cases:", json.dumps(T.stats, sort_keys=True))
