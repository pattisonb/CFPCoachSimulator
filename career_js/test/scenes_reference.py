"""Python's answers for career_js/scenes.js (coach_career/scenes.py), written for scenes_compare.mjs to hold the
JavaScript to:

    python3 career_js/test/scenes_reference.py OUT && node career_js/test/scenes_compare.mjs OUT

OUT (a folder outside the repo) gets:
    setup.json     every constant of scenes.py, its function names, and the constants scenes reads on the modules
                   that are not ported yet (recruiting, persona, programs)
    epochs/N.json  a season's games and polls at one moment (the JavaScript season reads them)
    cases.jsonl    one call of one scenes function a line: the slice of the state it reads, its arguments, every call
                   it made to recruiting, persona, programs and clear (in order, with Python's answer), its result,
                   its arguments afterwards and what it changed in the state
    pool.jsonl     those answers, each once

The cases come from real seeded careers: calls and in-home visits played through recruiting.act (the open scene, your
opening, his question and your answer, your lead-with) over several weeks in word mode and Clear Mode, with games
played, polls released, offers, promises, twists and forced personalities, then the transfer portal; and every
function called directly over many prospects, schools and weeks, and over grids of made-up facts.
"""
import copy
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

from coach_career import clear, league, persona, programs, recruiting, scenes    # noqa: E402
from sim import season                                                     # noqa: E402

OUT = Path(sys.argv[1])
(OUT / "epochs").mkdir(parents=True, exist_ok=True)
season.SEASONS_DIR = Path(tempfile.mkdtemp(prefix="scenes-reference-"))

# what scenes.py calls on the modules that are not ported yet (their answers are recorded and replayed)
WRAPPED = {
    "recruiting": ["_team_model", "strengths", "_group", "depth_place", "rival_stamp", "would_pester", "ask_view", "_five", "nil_left",
                   "portal_budget", "is_portal", "nil_budget", "_open_roster_promise", "ahead_of", "other_offered"],
    "persona": ["_twist", "of", "call_reveals", "story_fields", "twist_fields", "style", "known", "story_line", "learn", "story", "mate",
                "counts_as_priority"],
    "programs": ["get"],
    "clear": ["on"],
}
MODULES = {"recruiting": recruiting, "persona": persona, "programs": programs, "clear": clear}
CONSTANTS = {
    "recruiting": {"PITCHES": list(recruiting.PITCHES), "STRONG_CASE": recruiting.STRONG_CASE, "BACKFIRE": recruiting.BACKFIRE},
    "persona": {k: getattr(persona, k) for k in ("LINES", "NO_TOPIC", "DECIDER_LINES", "DECIDER_LABEL", "STORY_LINES", "STORY_LINES_OFFERED",
                                                 "TWIST_CALL_LINE", "STYLE_CALL_LINE")},
    "programs": {"GROUP_DRAFT": {k: list(v) for k, v in programs.GROUP_DRAFT.items()}},
    "clear": {},
    # (the JavaScript season's load_teams reads these three of league.py, which is not ported yet)
    "league": {"OFFENSE_ROLES": sorted(league.OFFENSE_ROLES), "TEAM_FIT": league.TEAM_FIT, "GROUP_OF": league.GROUP_OF},
}

# the module as it is, before anything is wrapped
SCENES_FUNCTIONS = sorted(k for k, v in vars(scenes).items() if inspect.isfunction(v) and v.__module__ == scenes.__name__)
SCENES_CONSTANTS = {k: v for k, v in vars(scenes).items()
                    if not k.startswith("__") and not inspect.isfunction(v) and not inspect.ismodule(v) and k != "annotations"}
ORIG = {k: getattr(scenes, k) for k in SCENES_FUNCTIONS}

REC = {"log": None, "depth": 0, "state": None}
POOL: dict[str, int] = {}
N = {"cases": 0, "epoch": -1, "skipped": {}}
TAG = ["start"]
cases_file = open(OUT / "cases.jsonl", "w", encoding="utf-8")


def pooled(value) -> int:
    text = json.dumps(value)
    if text not in POOL:
        POOL[text] = len(POOL)
    return POOL[text]


def wrap_dep(mod_name: str, name: str) -> None:
    mod = MODULES[mod_name]
    fn = getattr(mod, name)
    sig = inspect.signature(fn)

    def wrapper(*a, **k):
        log = REC["log"]
        if log is None or REC["depth"]:
            REC["depth"] += 1
            try:
                return fn(*a, **k)
            finally:
                REC["depth"] -= 1
        args = json.dumps(["$state" if v is REC["state"] else v for v in sig.bind(*a, **k).args])      # as they are at the call
        REC["depth"] += 1
        try:
            out = fn(*a, **k)
        finally:
            REC["depth"] -= 1
        log.append([mod_name, name, json.loads(args), pooled(out)])
        return out
    wrapper.__wrapped__ = fn
    setattr(mod, name, wrapper)


def slim(p: dict) -> dict:
    """A prospect without his rating lists (scenes never reads them)."""
    return {k: v for k, v in p.items() if k not in ("ratings", "potential")}


def mini(state, slug, pid):
    """The slice of the state scenes.py itself reads for this school and prospect (games and polls ride in the epoch)."""
    if state is None:
        return None
    rc = state["recruiting"]
    out = {"id": state.get("id"), "team": state.get("team"), "current_week": state["current_week"]}
    if "career" in state:
        car = state["career"]
        out["career"] = {"coach": car["coach"]} if isinstance(car, dict) and "coach" in car else ({} if isinstance(car, dict) else car)
    if "offseason" in state:
        off = state["offseason"]
        if isinstance(off, dict) and isinstance(off.get("portal"), dict) and "players" in off["portal"]:
            e = (off["portal"]["players"] or {}).get(pid)
            players = {pid: ({"driver": e["driver"]} if "driver" in e else {})} if isinstance(e, dict) else {}
            out["offseason"] = {"portal": {"players": players}}
        else:
            out["offseason"] = {"portal": off.get("portal")} if isinstance(off, dict) and "portal" in off else ({} if isinstance(off, dict) else off)
    m = persona.mate(state, pid) if pid in rc["prospects"] else None
    prospects = {}
    if pid in rc["prospects"]:
        prospects[pid] = slim(rc["prospects"][pid])
    for o in [m] + list(rc["offers"].get(slug, [])):
        if o and o in rc["prospects"] and o not in prospects:
            q = rc["prospects"][o]
            prospects[o] = {k: q[k] for k in ("id", "name", "cls", "position") if k in q}
    r = {k: rc[k] for k in ("seed", "portal", "week", "year") if k in rc}
    r["prospects"] = prospects
    r["status"] = {x: rc["status"][x] for x in (pid, m) if x and x in rc["status"]}
    r["contacts"] = {pid: ({slug: rc["contacts"][pid][slug]} if slug in rc["contacts"][pid] else {})} if pid in rc["contacts"] else {}
    if "ranks" in rc:
        r["ranks"] = {pid: rc["ranks"][pid]} if isinstance(rc["ranks"], dict) and pid in rc["ranks"] else ({} if isinstance(rc["ranks"], dict) else rc["ranks"])
    r["log"] = [e for e in rc["log"] if e.get("pid") == pid and e.get("school") == slug]
    r["revealed"] = {slug: ({pid: rc["revealed"][slug][pid]} if pid in rc["revealed"][slug] else {})} if slug in rc["revealed"] else {}
    r["offers"] = {slug: rc["offers"][slug]} if slug in rc["offers"] else {}
    r["nil"] = {slug: rc["nil"][slug]} if slug in rc["nil"] else {}
    out["recruiting"] = r
    return out


class Rng(random.Random):
    """A seeded generator that remembers its seed's text (an argument the JavaScript rebuilds)."""
    def __init__(self, text):
        super().__init__(text)
        self.text = text


def encode(args, state):
    return [("$state" if a is state and state is not None else {"$rng": a.text} if isinstance(a, Rng) else slim(a) if isinstance(a, dict) and "potential" in a else a)
            for a in args]


def run_case(name, args, state, slug, pid, strict=False):
    """One call of one scenes function, recorded whole. A case in progress passes the call through."""
    fn = ORIG[name]
    if REC["log"] is not None:
        return fn(*args)
    pre = json.dumps(mini(state, slug, pid))
    before = json.dumps(encode(args, state))
    REC.update(log=[], depth=0, state=state)
    try:
        out = fn(*args)
    except Exception as e:                                # a made-up input Python itself refuses: not a case
        if strict:
            raise
        N["skipped"][f"{name}: {type(e).__name__}"] = N["skipped"].get(f"{name}: {type(e).__name__}", 0) + 1
        return None
    finally:
        log, REC["log"], REC["state"] = REC["log"], None, None
    post = None
    if state is not None and pid is not None:
        rc = state["recruiting"]
        c = (rc["contacts"].get(pid) or {}).get(slug) or {}
        seen = (rc["revealed"].get(slug) or {}).get(pid)
        post = {"slug": slug, "pid": pid, "heard_rival": c["heard_rival"] if "heard_rival" in c else "$absent",
                "revealed": "$absent" if seen is None else seen}
    line = ('{"n": %d, "fn": %s, "tag": %s, "clear": %s, "epoch": %d, "state": %s, "args": %s, "calls": %s, "out": %s, "args_after": %s, "post": %s}'
            % (N["cases"], json.dumps(name), json.dumps(TAG[0]), json.dumps(clear.CLEAR), N["epoch"], pre, before, json.dumps(log),
               json.dumps(out), json.dumps(encode(args, state)), json.dumps(post)))
    cases_file.write(line + "\n")
    N["cases"] += 1
    return out


def wrap_entry(name: str) -> None:
    """A scenes function recruiting.py calls: every call it makes while a week is played is a case."""
    sig = inspect.signature(ORIG[name])

    def wrapper(*a, **k):
        b = sig.bind(*a, **k)
        return run_case(name, list(b.args), b.arguments.get("state"), b.arguments.get("slug"), b.arguments.get("pid"), strict=True)
    setattr(scenes, name, wrapper)


def case(name, *args, state=None, slug=None, pid=None):
    return run_case(name, list(args), state, slug, pid)


def new_epoch(state) -> None:
    N["epoch"] += 1
    path = season._league_path
    league = None if Path(path) == Path(season.TEAMS_FILE) else str(path)
    (OUT / "epochs" / f"{N['epoch']}.json").write_text(json.dumps({"league": league, "games": state["games"], "polls": state["polls"]}), encoding="utf-8")


# ----- making a season move without playing its games ----------------------------------------------------------------
def fbs() -> list[str]:
    return [s for s, t in season.load_teams().items() if not t.get("fictional")]


def play(state, week, rng, me_wins=None) -> None:
    """Every game of `week` gets a score (`me_wins`: your school's result, None for chance)."""
    me = state["team"]
    for g in state["games"].values():
        if g["week"] != week or g.get("played"):
            continue
        hi, lo = rng.randint(17, 48), rng.randint(0, 16)
        home_wins = rng.random() < 0.55
        if me_wins is not None and me in (g["home"], g["away"]):
            home_wins = (g["home"] == me) == me_wins
        g.update(played=True, home_score=hi if home_wins else lo, away_score=lo if home_wins else hi)


def fake_poll(state, week, rng, kind, include_me) -> None:
    """A poll released after `week`, in the season's own shape: the AP poll, the committee's top 25 or its full ranking."""
    teams = season.load_teams()
    slugs = rng.sample(fbs(), 40)
    me = state["team"]
    if me in slugs:
        slugs.remove(me)
    if include_me:
        slugs.insert(rng.randrange(20), me)
    entry = lambda i, s: {"rank": i + 1, "team": s, "name": teams[s]["name"], "previous": None, "record": "0-0",   # noqa: E731
                          "conference": teams[s].get("conference"), "first_place": 0, "points": 1000 - 10 * i}
    ap = [entry(i, s) for i, s in enumerate(slugs[:25])]
    if kind == "ap":
        state["polls"][str(week)] = {"ap": ap}
    elif kind == "cfp":
        other = rng.sample(slugs, 25)
        state["polls"][str(week)] = {"ap": [entry(i, s) for i, s in enumerate(other)], "cfp": ap}
    else:
        state["polls"][str(week)] = {"ap": [], "cfp_full": slugs}


PERSONALITIES = list(persona.LINES)
DECIDERS = list(persona.DECIDER_LABEL)
TWISTS = ["surprise", "at_game", "hot_seat", "late_offer", "family_move", "grades", "beat"]


def visible(state, n, rng, skip=()):
    rc = state["recruiting"]
    pids = [q for q in rc["prospects"] if not rc["prospects"][q].get("hidden") and not rc["status"][q].get("signed") and q not in skip]
    return rng.sample(pids, min(n, len(pids)))


def force(state, pid, personality, decider, topic=None) -> None:
    """His personality and decider set by hand (his story stays the class's draw: no "story" key)."""
    state["recruiting"]["prospects"][pid]["persona"] = {"personality": personality, "decider": decider, "decider_topic": topic}


def conversation(state, pid, action, rng, mode) -> None:
    """One call or in-home visit played through recruiting.act: the open scene, your three things, his question and
    your answer, your lead-with. Every scenes function recruiting calls on the way is a case."""
    me = state["team"]
    rc = state["recruiting"]
    rc["hours"][me] = 100000
    p = rc["prospects"][pid]
    try:
        sc = recruiting.act(state, me, pid, action)["scene"]
    except recruiting.RecruitingError:
        return
    if not sc:
        return
    rest = [t for t in recruiting.PITCHES if t not in p["priorities"]]
    if mode == 0:
        topics = (list(p["priorities"]) + rest)[:3]
    elif mode == 1:
        topics = rng.sample(list(recruiting.PITCHES), 3)
    elif mode == 2:
        topics = rng.sample(rest, 3)
    else:
        topics = [rng.choice(list(p["priorities"]))] + rng.sample(rest, 2)
        rng.shuffle(topics)
    try:
        sc = recruiting.act(state, me, pid, "present", scene=sc["id"], topics=topics)["scene"]
        if sc.get("question"):
            recruiting.act(state, me, pid, "answer", scene=sc["id"], answer=rng.choice(scenes.ANSWERS))
        cue_topics = (sc.get("cue") or {}).get("topics") or []
        pitch = rng.choice(cue_topics) if cue_topics and rng.random() < 0.5 else rng.choice(list(p["priorities"])) if rng.random() < 0.5 else rng.choice(list(recruiting.PITCHES))
        recruiting.act(state, me, pid, "pitch", pitch=pitch, scene=sc["id"])
    except recruiting.RecruitingError:
        return


def direct(state, rng, n_prospects, n_react) -> None:
    """Every function called directly on this state: over schools and weeks, and over a sample of prospects."""
    me = state["team"]
    rc = state["recruiting"]
    week = state["current_week"]
    schools = fbs()
    for slug in schools:                                  # the school's facts and names, at this week and at others
        for w in (None, max(0, week - 2), week + 3):
            case("facts", state, slug, w, state=state, slug=slug)
        case("_record", state, slug, state=state, slug=slug)
        case("_conf", state, slug, state=state, slug=slug)
        case("coach_name", state, slug, state=state, slug=slug)
        for w in (week, max(0, week - 1), week + 2) + ((0, 30) if schools.index(slug) % 6 == 0 else ()):
            case("last_game", state, slug, w, state=state, slug=slug)
            case("next_game", state, slug, w, state=state, slug=slug)
    case("coach_name", state, "no-such-school", state=state, slug="no-such-school")
    with_twist = [q for q in (rc.get("twists") or {}) if q in rc["prospects"]]
    with_story = [q for q in rc["prospects"] if persona.story(state, q)[0]]
    committed = [q for q in rc["prospects"] if rc["status"][q].get("committed") and not rc["status"][q].get("signed")]
    pids = visible(state, n_prospects, rng) + rng.sample(with_twist, min(8, len(with_twist))) + rng.sample(with_story, min(8, len(with_story))) \
        + rng.sample(committed, min(5, len(committed)))
    for i, pid in enumerate(pids):
        p = rc["prospects"][pid]
        now = ((rc.get("ranks") or {}).get(pid) or {}).get("now") or {}
        lead = next((s for s, rk in now.items() if rk == 1), None)
        for slug in [me] + ([lead] if lead and lead != me and i % 2 else [rng.choice(schools)] if i % 3 == 0 else []):
            kw = dict(state=state, slug=slug, pid=pid)
            for w in (None, week + 1):
                case("_fields", state, slug, p, w, **kw)
                case("truth", state, slug, pid, w, **kw)
            case("pro_truth", state, slug, pid, True, **kw)
            case("pro_truth", state, slug, pid, False, **kw)
            case("_role", state, slug, pid, **kw)
            case("leader_of", state, slug, pid, **kw)
            case("last_talk", state, slug, pid, week, **kw)
            case("last_talk", state, slug, pid, week + 2, **kw)
            case("heard_rival_due", state, slug, pid, **kw)
            case("package_about", state, slug, pid, **kw)
            case("tells", state, slug, pid, "call", **kw)
            case("tells", state, slug, pid, "hc_visit", **kw)
            f = json.loads(json.dumps(scenes._fields(state, slug, p, week)))
            sid = f"call-{pid}-{week}"
            for always in (False, True):
                case("twist_line", state, slug, pid, sid, f, always, **kw)
            case("twist_line", state, slug, pid, f"hc_visit-{pid}-{week}", f, **kw)
            case("style_line", state, slug, pid, sid, f, **kw)
            if slug == me and i % 2 == 0:                 # his commit style, once you know it: a fifth of the calls say it
                persona.learn(state, me, pid, "style")
                for n in range(8):
                    case("style_line", state, slug, pid, f"{sid}-{n}", f, **kw)
            for tired in (False, True):
                case("context_line", state, slug, pid, week, f, Rng(f"ctx-{pid}-{slug}-{week}-{tired}"), tired, **kw)
            case("context_line", state, slug, pid, week + 2, f, Rng(f"ctx-{pid}-{slug}-{week}-later"), False, **kw)
            case("context_line", state, slug, pid, 0, {**f, "opponent": "FCS West", "leader": ""}, Rng(f"ctx-{pid}-{slug}-fcs"), False, **kw)
            for tells in (True, False):
                case("cue", state, slug, pid, week, f, tells, **kw)
            case("cue", state, slug, pid, week + 1, f, **kw)
            about = scenes.package_about(state, slug, pid)
            case("question", state, slug, pid, week, **kw)
            case("question", state, slug, pid, week + 1, None, **kw)
            if about:
                case("question", state, slug, pid, week, about, **kw)
                case("package_answers", about)
            other = rng.choice(list(rc["prospects"]))
            made = {"pid": other, "name": rc["prospects"][other]["name"], "offered": bool(i % 2)}
            case("question", state, slug, pid, week, made, **kw)
            ask = recruiting.ask_view(state, slug, pid, peek=True)
            for a in (ask, {"exact": 40}, {"exact": 0}, {"exact": 100000}, {"lo": 20, "hi": 55}, {"lo": 0, "hi": 0}, {}):
                case("ask_note", state, slug, pid, a, **kw)
            for key in ("open", "visit_open", "small_talk", "hit", "quiet"):
                case("_persona_line", state, pid, f"{sid}-{slug}", key, f, **kw)
                case("_persona_line", state, pid, f"{sid}-{slug}", key, f, True, "react", **kw)
            case("_persona_line", state, pid, sid, "open", f, False, "", ["open", "small_talk"], **kw)
            case("_no_tell_line", state, pid, f"{sid}-react", f, **kw)
            case("_no_tell_line", state, pid, f"{sid}-present", f, "Okay, Coach.", **kw)
            if rc.get("portal") and p.get("portal"):
                pf = case("portal_fields", state, p, **kw)
                for tag in ("a", "b"):
                    case("portal_line", state, p, f"{sid}-{tag}", {**f, **pf}, **kw)
                    case("portal_line", state, p, f"{sid}-{tag}", {**f, **pf, "why": rng.choice(list(scenes.PORTAL_WHY)), "started": i % 2, "games": i % 3,
                                                               "has_did": bool(i % 2)}, **kw)
            if i < n_react and slug == me:                # his reaction to every lead-with, told and untold
                for j, pitch in enumerate(recruiting.PITCHES):
                    for tells in (True, False):
                        action = "call" if (i + j) % 2 else "hc_visit"
                        case("reaction", state, slug, pid, action, pitch, p, rng.random() < 0.1, tells, rng.random() < 0.15, **kw)
            if i % 4 == 0:                                # the scene opened and your opening made by hand: every branch of his reaction
                work = copy.deepcopy(state) if i % 8 == 0 else state
                wp = work["recruiting"]["prospects"][pid]
                for action in ("call", "hc_visit"):
                    for w in (week, week + 2):
                        sc = case("open_scene", work, slug, pid, action, w, state=work, slug=slug, pid=pid)
                        if not sc:
                            continue
                        rest = [t for t in recruiting.PITCHES if t not in wp["priorities"]]
                        pri = list(wp["priorities"])
                        shapes = [(pri[:3], pri[:3], [], False), (pri[:2] + rest[:1], pri[:1], pri[1:2], False), (rest[:3], [], [], False),
                                  (pri[:1] + rest[:2], [], pri[:1], False), (pri[:3], pri[:2], pri[2:3], True),
                                  (rng.sample(list(recruiting.PITCHES), 3), [], [], False)]
                        for topics, hits, back, tired in shapes:
                            if len(set(topics)) != 3:
                                continue
                            case("present", work, slug, pid, copy.deepcopy(sc), topics, hits, back, tired, state=work, slug=slug, pid=pid)


def grids(rng) -> None:
    """The functions that read no season: whole grids of made-up inputs."""
    for n in list(range(0, 1100)) + [1234, 99999]:
        case("words", n)
    for i in range(0, 101):
        case("_case_word", i / 100)
        case("case_kind", i / 100)
    for x in (0.6, 0.25, 0.5999999, 0.2500001, 0.0, 1.0):
        case("_case_word", x)
        case("case_kind", x)
    topics = list(scenes.PHRASES)
    forms = ["hot", "winning", "even", "losing", "pre_up", "pre_down"]
    trs = []
    for i in range(400):
        tr = {t: rng.random() < 0.5 for t in topics if t not in ("winning", "coach")}
        tr.update(pro_any=rng.random() < 0.5, pro_spot=rng.random() < 0.6)
        form = rng.choice(forms)
        fx = {"w": rng.randint(0, 9), "l": rng.randint(0, 9), "cw": rng.randint(0, 5), "cl": rng.randint(0, 5), "last_won": rng.choice([True, False, None]),
              "streak": rng.randint(-4, 4), "rank": rng.choice([None, None, 3, 17]), "last": [8, 5], "history": rng.random() < 0.5, "form": form}
        tr.update(winning=(form in ("hot", "winning", "pre_up")) if i % 3 else rng.random() < 0.5, history=fx["history"], coach=rng.random() < 0.7,
                  form=form, facts=fx)
        trs.append(tr)
    for i, tr in enumerate(trs):
        case("_win_key", tr)
        for t in topics:
            case("lead_line", tr, t)
            case("said_phrase", tr, t)
        if i % 5 == 0:                                    # a truth without the Pro Pipeline's own facts (an older caller)
            bare = {k: v for k, v in tr.items() if k not in ("pro_any", "pro_spot")}
            case("lead_line", bare, "pro")
    every = [(t, k, line) for t, kinds in scenes.LINES.items() if t != "_two_sided" for k, pool in kinds.items() for line in pool]
    for t, k, line in every:
        for i in range(14):
            tr = rng.choice(trs)
            case("_holds", line, tr)
            case("true_line", tr, t, k, line, f"call-r2027-{i:04d}-{i % 7}")
    for line in ("A line that claims nothing.", ""):
        case("_holds", line, trs[0])
    for offered in (True, False):
        case("package_answers", {"pid": "x", "name": "Dre O'Neal", "offered": offered})
    case("package_answers", {"pid": "x", "name": "Sam {mate} Lee"})
    for mode in (False, True):
        clear.CLEAR = mode
        for kind in ("roster", "recruit", "package"):
            for offered in (True, False, None):
                q = {"kind": kind, "about": {"pid": "x", "name": "X"} if offered is None else {"pid": "x", "name": "X", "offered": offered}}
                for answer in scenes.ANSWERS:
                    for truthful in (True, False, None):
                        case("answer_reply", None, "smu", "r2027-0001", q, answer, truthful)
    clear.CLEAR = False
    texts = [x for kinds in scenes.LINES.values() for pool in kinds.values() for x in pool] + scenes.FAIR_LINES + scenes.TIRED
    for i, text in enumerate(texts):
        ph = scenes.PHRASES[topics[i % len(topics)]]
        case("bare_reaction", text)
        case("bare_reaction", f"{ph[0].upper()}{ph[1:]}? {text}")
        case("bare_reaction", f"{scenes.REPEAT_LINE} {ph[0].upper()}{ph[1:]}? {text}")
        case("bare_reaction", f"{scenes.REPEAT_LINE} {text}")
    # a transfer's fields from made-up lines: whole numbers, thousands, halves, nothing at all
    lines = [{"games": 12, "started": 12, "stats": {"pass_yards": 2841, "passing_touchdowns": 22}}, {"games": 0, "started": 0, "stats": {}},
             {"games": 9, "started": 0, "stats": {"carries": 4, "snaps": 310}}, {"games": 11, "started": 3, "stats": {"tackles": 61, "sacks": 7.5, "tackles_for_loss": 11}},
             {"games": 13, "started": 13, "stats": {"rush_yards": 1234567, "rushing_touchdowns": 0, "receptions": 3}}, {"stats": {"interceptions_thrown": 9, "punts": 55}},
             {"games": None, "started": None, "stats": None}, {}]
    for i, line in enumerate(lines):
        for usage in ("starter", "rotation", "bench", "nonsense", None):
            for name in ("Akron", None):
                p = {"id": f"x{i}", "line": line, "from_name": name, "usage": usage}
                f = case("portal_fields", {}, p)
                for why in list(scenes.PORTAL_WHY):
                    case("portal_line", {}, p, f"call-x{i}-20-{why}", {**f, "why": why, "from_name": f["from_name"]})
    case("portal_fields", {}, {"id": "y"})
    case("_turn", "him", "Okay.")
    case("_lines", {"turns": [{"who": "you", "text": "a"}, {"who": "him", "text": "b"}, {"who": "note", "text": "c"}, {"who": "him", "text": "d"}], "lines": []})


def season_of(team, seed, weeks, rng, me_wins, tag, n_talks, n_prospects, n_react, poll_kinds, clear_mode) -> dict:
    """A career's season moved along week by week (its games scored by hand, the recruiting week run for real), with
    conversations and direct calls at every stop."""
    clear.CLEAR = clear_mode
    state = season.new_season(team, "full", seed=seed, career=True)
    rc = state["recruiting"]
    regulars: list[str] = []
    for step in range(weeks):
        week = state["current_week"]
        TAG[0] = f"{tag} week {week}"
        new_epoch(state)
        t0 = time.time()
        fresh = visible(state, n_talks, rng, skip=regulars)
        made: list[str] = []                              # twists made by hand, taken back before the week is run
        if step == 0:
            regulars += fresh[:12]
        for i, pid in enumerate(fresh):
            if i % 3 == 0:                                # his personality and who decides, set by hand: every voice is heard
                force(state, pid, PERSONALITIES[(i // 3 + step) % len(PERSONALITIES)], DECIDERS[(i // 3 + 2 * step) % len(DECIDERS)],
                      rng.choice(list(recruiting.PITCHES)) if i % 2 else None)
            if i % 7 == 0:                                # something happened to him this week
                k = TWISTS[(i // 7 + step) % len(TWISTS)]
                s = None if k in ("family_move", "grades") else team if (i // 7) % 2 == 0 or k == "beat" and i % 2 else rng.choice(fbs())
                if not rc.get("twists"):
                    rc["twists"] = {}
                if pid not in rc["twists"]:
                    made.append(pid)
                    rc["twists"][pid] = {"k": k, "s": s, "w": 2, "o": rng.choice(fbs()), "b": 1.0, "g": week + 1}
            was = rc["status"][pid].get("committed")
            if i % 11 == 0 and not was:
                rc["status"][pid]["committed"] = team     # your own commit: you ask how he feels
            conversation(state, pid, "hc_visit" if i % 3 == 1 else "call", rng, i % 4)
            rc["status"][pid]["committed"] = was
        for i, pid in enumerate(regulars):                # the same recruits every week: he knows you, he tires of you
            if step and i % 4 == 0 and pid not in rc["offers"].get(team, []):
                try:
                    recruiting.act(state, team, pid, "offer", pitch=rc["prospects"][pid]["priorities"][0], nil=5 * (i % 3))
                except recruiting.RecruitingError:
                    pass
            if step >= 2 and i % 6 == 1:                  # he heard something about your promises
                recruiting._contact(state, team, pid)["heard_rival"] = [[week - 1, 0], week - 1, [week, 0], [week, 1]][(i // 6 + step) % 4]
            for again in range(1 + (i % 3 == 0)):
                conversation(state, pid, "call" if (i + step + again) % 4 else "hc_visit", rng, (i + step) % 4)
        direct(state, rng, n_prospects, n_react)
        print(f"{TAG[0]}: {N['cases']} cases so far ({time.time() - t0:.0f}s)", flush=True)
        for pid in made:
            del rc["twists"][pid]
        play(state, week, rng, me_wins if step % 4 != 3 else (None if me_wins is None else not me_wins))
        recruiting.weekly_step(state, week)
        if poll_kinds:
            fake_poll(state, week, rng, poll_kinds[step % len(poll_kinds)], include_me=step % 3 != 2)
        if step == 2:
            state["polls"]["final"] = {"ap": [{"rank": 1, "team": team}]}       # a key that is no week
        state["current_week"] = week + 1 if step != 3 else week + 2             # (one stop comes after an open date)
    ties(state, rng, tag)
    return state


def ties(state, rng, tag) -> None:
    """Two games in one week for your school, added after the rest under low event ids (a JavaScript object would list
    "7" before "401856766"; Python lists it last): the first of equals, and the order a week's results are read in."""
    st = copy.deepcopy(state)
    me, week, rc = st["team"], st["current_week"], st["recruiting"]
    mine = [g for g in st["games"].values() if me in (g["home"], g["away"])]
    played, unplayed = [g for g in mine if g.get("played")], [g for g in mine if not g.get("played")]
    others = [s for s in rng.sample(fbs(), 8) if s != me]
    for n, src in enumerate(played[-2:] + unplayed[:2]):
        g = dict(src)
        side = "away" if g["home"] == me else "home"
        g.update({"event_id": str(7 - n), side: others[n], "home_score": src["away_score"], "away_score": src["home_score"]})   # the other result
        st["games"][g["event_id"]] = g
    TAG[0] = f"{tag} two games a week"
    new_epoch(st)
    for w in range(0, week + 3):
        case("last_game", st, me, w, state=st, slug=me)
        case("next_game", st, me, w, state=st, slug=me)
        case("facts", st, me, w, state=st, slug=me)
    for pid in visible(st, 12, rng):
        p = rc["prospects"][pid]
        kw = dict(state=st, slug=me, pid=pid)
        for w in (week, max(0, week - 1), week + 1):
            f = case("_fields", st, me, p, w, **kw)
            case("truth", st, me, pid, w, **kw)
            case("context_line", st, me, pid, w, f, Rng(f"ties-{pid}-{w}"), False, **kw)
            case("open_scene", st, me, pid, "call", w, **kw)
        for pitch in ("winning", "prestige"):
            case("reaction", st, me, pid, "call", pitch, p, False, True, False, **kw)


def portal(rng) -> None:
    """The transfer portal of a finished season (tests/test_portal_profile.to_portal), in word mode and Clear Mode."""
    from app import api
    from tests.test_portal_profile import to_portal
    clear.CLEAR = False
    sid = api.call("POST", "/api/season", {"team": "ohio-state", "mode": "full", "seed": 11, "career": True})["id"]
    to_portal(sid)
    state = api.loaded_state()
    rc = state["recruiting"]
    me = state["team"]
    for round_, mode in enumerate((False, True, False)):
        clear.CLEAR = mode
        TAG[0] = f"portal round {round_}{' clear' if mode else ''}"
        new_epoch(state)
        pids = [q for q in visible(state, 400, rng) if rc["prospects"][q].get("from") != me][:60]
        for i, pid in enumerate(pids):
            if i % 3 == 0:
                force(state, pid, PERSONALITIES[(i // 3) % len(PERSONALITIES)], DECIDERS[(i // 3 + round_) % len(DECIDERS)])
            if i % 9 == 4:
                recruiting._contact(state, me, pid)["heard_rival"] = [[state["current_week"], max(0, rc.get("week", 0) - 1)], [state["current_week"], rc.get("week", 0)], state["current_week"] - 1][(i // 9) % 3]
            for again in range(1 + (i % 5 == 0)):
                conversation(state, pid, "hc_visit" if (i + again) % 3 == 0 else "call", rng, i % 4)
        direct(state, rng, 30, 8)
        print(f"{TAG[0]}: {N['cases']} cases so far", flush=True)
        if round_ == 1:
            rc["week"] = rc.get("week", 0) + 1            # the portal's own week moves on (the draws' own salt)


def main() -> None:
    for mod_name, names in WRAPPED.items():
        for name in names:
            wrap_dep(mod_name, name)
    for name in ("open_scene", "present", "reaction", "answer_reply", "tells"):
        wrap_entry(name)
    rng = random.Random(20261122)
    t0 = time.time()
    TAG[0] = "grids"
    grids(rng)
    print(f"grids: {N['cases']} cases", flush=True)
    season_of("smu", 5, 6, rng, None, "smu word", 60, 12, 5, ["ap", "ap", "cfp", "cfp_full"], False)
    season_of("ohio-state", 11, 5, rng, True, "ohio-state word", 45, 10, 4, ["ap", "cfp"], False)
    season_of("kent-state", 7, 4, rng, False, "kent-state clear", 45, 10, 4, ["ap"], True)
    season_of("texas", 3, 3, rng, True, "texas clear", 40, 8, 4, ["cfp_full", "ap"], True)
    portal(rng)
    clear.CLEAR = False
    cases_file.close()
    with open(OUT / "pool.jsonl", "w", encoding="utf-8") as fh:
        for text in POOL:                                  # (a dict keeps the order they were added in: the index is the line)
            fh.write(text + "\n")
    setup = {"scenes_constants": SCENES_CONSTANTS, "scenes_functions": SCENES_FUNCTIONS, "constants": CONSTANTS, "wrapped": WRAPPED}
    (OUT / "setup.json").write_text(json.dumps(setup), encoding="utf-8")
    print(f"{N['cases']} cases, {len(POOL)} recorded answers, {N['epoch'] + 1} epochs in {time.time() - t0:.0f}s -> {OUT}")
    if N["skipped"]:
        print("made-up inputs Python refused (not cases):", N["skipped"])


if __name__ == "__main__":
    main()
