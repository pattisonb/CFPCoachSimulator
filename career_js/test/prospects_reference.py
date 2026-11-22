"""Python's answers for career_js/prospects.js, written as JSON for prospects_compare.mjs to hold the JavaScript to:

    python3 career_js/test/prospects_reference.py OUTDIR && node career_js/test/prospects_compare.mjs OUTDIR

A real seeded career is taken through five moments (a fresh class with your staff's looks, five recruiting weeks in,
every class signed, the transfer portal's first week and its second), and at each one the module's functions are asked
for real prospects, lists and views. The modules prospects.py calls that are not in JavaScript yet (recruiting, persona,
clear, grades, ability_goals) are recorded as they answer: every call's arguments and result go to a table the compare
script replays, so the JavaScript is given exactly what the Python was. The run is made twice: Clear Mode on (the
default, OUTDIR/clear) and off (CFP_CLEAR=0, fewer moments, OUTDIR/words). About eight minutes and 600 MB of JSON.
(`--one`: only the run for the Clear Mode the environment sets; `--first`: only the first moment.)
"""
import hashlib
import inspect
import json
import os
import random
import re
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import coach_career                                                   # noqa: E402
from app import api                                                   # noqa: E402
from coach_career import ability_goals, clear, grades, offseason, persona, prospects, recruiting   # noqa: E402
from sim import season                                                # noqa: E402

TEAM, SEED = "smu", 62
NUMBER_KEY = re.compile(r"0|[1-9]\d*")


# ----- what the JavaScript is told of a value ---------------------------------------------------------------------

def ck(rc: dict) -> str:
    return str(rc.get("cache_key") or rc["year"])


def canon(a) -> str:
    """One argument of a recorded call as text, written the same way by the compare script."""
    if isinstance(a, dict):
        if "games" in a and "recruiting" in a:
            return "S:" + ck(a["recruiting"])
        if "prospects" in a and "status" in a:
            return "RC:" + ck(a)
        if "truth" in a and "ea_position" in a:
            return "P:" + a["id"]
        if len(a) > 40:
            return "BIG"
        return "{" + ",".join(json.dumps(str(k), ensure_ascii=False) + ":" + canon(a[k]) for k in sorted(a, key=str)) + "}"
    if a is None:
        return "null"
    if a is True:
        return "true"
    if a is False:
        return "false"
    if isinstance(a, int):
        return str(a)
    if isinstance(a, float):
        return str(int(a)) if a.is_integer() else repr(a)
    if isinstance(a, str):
        return json.dumps(a, ensure_ascii=False)
    if isinstance(a, (list, tuple)):
        return "BIG" if len(a) > 40 else "[" + ",".join(canon(x) for x in a) + "]"
    if callable(a):
        return "FN"
    raise TypeError(f"no text for {type(a)}")


def enc(v):
    """A value as JSON: a tuple as a list, a set as {"__set__": [...]} in the order Python walks it, and a dict with a
    number-like key as {"__od__": [[key, value], ...]} (JavaScript would list those keys first; the compare script
    rebuilds the dict in this order)."""
    if isinstance(v, dict):
        if any(NUMBER_KEY.fullmatch(str(k)) for k in v):
            return {"__od__": [["null" if k is None else str(k), enc(x)] for k, x in v.items()]}
        return {("null" if k is None else str(k)): enc(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [enc(x) for x in v]
    if isinstance(v, (set, frozenset)):
        return {"__set__": [enc(x) for x in v]}
    return v


class Recorder:
    """A module as prospects.py sees it: its functions answer as ever, and each call is written to the table."""

    def __init__(self, mod, name: str):
        self.__dict__["_mod"], self.__dict__["_name"], self.__dict__["_made"] = mod, name, {}

    def __getattr__(self, attr):
        v = getattr(self._mod, attr)
        if not callable(v) or isinstance(v, type):
            return v
        made = self._made.get(attr)
        if made is None or made[0] is not v:
            sig = inspect.signature(v)

            def call(*a, _v=v, _sig=sig, _attr=attr, **kw):
                out = _v(*a, **kw)
                bound = _sig.bind(*a, **kw)
                key = f"{self._name}.{_attr}(" + ",".join(canon(x) for x in bound.args) + ")"
                assert not bound.kwargs, key
                text = json.dumps(enc(out))
                had = TABLE.get(key)
                if had is not None and had != text:
                    CONFLICTS.append(key)
                TABLE[key] = text
                return out
            made = self._made[attr] = (v, call)
        return made[1]

    def __setattr__(self, attr, value):
        setattr(self._mod, attr, value)


TABLE: dict = {}
CONFLICTS: list = []
RECORDED = {"recruiting": recruiting, "persona": persona, "clear": clear, "grades": grades, "ability_goals": ability_goals}


def record() -> None:
    for name, mod in RECORDED.items():
        rec = Recorder(mod, name)
        if hasattr(prospects, name):
            setattr(prospects, name, rec)
        if name == "ability_goals":               # imported inside the function that asks it
            coach_career.ability_goals = rec


def constants_of(mod) -> dict:
    out = {}
    for k, v in vars(mod).items():
        if k.startswith("__") or callable(v) or inspect.ismodule(v):
            continue
        if isinstance(v, (str, int, float, tuple, list, dict)) or v is None:
            try:
                json.dumps(v)
            except (TypeError, ValueError):
                continue
            if isinstance(v, dict) and any(not isinstance(key, (str, int)) for key in v):
                continue
            out[k] = enc(v)
    return out


# ----- the cases ----------------------------------------------------------------------------------------------

S, RC = {"@": "state"}, {"@": "rc"}
POOL = {"@": "pool"}


def P(pid: str) -> dict:
    return {"@": "p", "id": pid}


def READ(pid: str) -> dict:
    return {"@": "read", "id": pid}


class Cases:
    def __init__(self, st: dict):
        self.st, self.rows = st, []

    def real(self, a):
        if isinstance(a, dict) and "@" in a:
            rc = self.st["recruiting"]
            return {"state": lambda: self.st, "rc": lambda: rc, "pool": prospects.player_pool,
                    "p": lambda: rc["prospects"][a["id"]], "read": lambda: rc["reads"].get(a["id"])}[a["@"]]()
        return a

    def add(self, fn: str, *args, close: bool = False, block: bool = False) -> None:
        """One call of prospects.<fn>; `close`: numbers may differ in their last digits (the C library's exp, cos, pow);
        `block`: asked inside `with prospects.class_block(state)`, as the Classes tab asks during the portal weeks."""
        try:
            if block:
                with prospects.class_block(self.st):
                    want = {"want": enc(getattr(prospects, fn)(*[self.real(a) for a in args]))}
            else:
                want = {"want": enc(getattr(prospects, fn)(*[self.real(a) for a in args]))}
        except recruiting.RecruitingError as e:
            want = {"error": [e.code, e.message]}
        self.rows.append({"fn": fn, "args": [enc(a) for a in args], **want, **({"close": True} if close else {}), **({"block": True} if block else {})})


def sample(st: dict, n_random: int, seed: str) -> list:
    """Prospects worth asking about: your board, your offers, the ones your staff has read, commits (yours, others',
    quiet ones), FCS leaners, the generational ones, the top of the class and a random draw."""
    rc, me = st["recruiting"], st["team"]
    rng = random.Random(seed)
    ranked = sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"])
    picks: list = []

    def take(pids, n):
        pids = [q for q in pids if q in rc["prospects"] and q not in picks]
        picks.extend(pids if len(pids) <= n else rng.sample(pids, n))

    take([q for q in rc["reads"] if prospects.find(st, q) == "gem"], 5)       # the flags: a few percent of the complete reports
    take([q for q in rc["reads"] if prospects.find(st, q) == "bust"], 5)
    take(rc["board"], 14)
    take(rc["offers"].get(me, []), 8)
    take([q for q, r in rc["reads"].items() if recruiting.report_complete(r)], 14)
    take(list(rc["reads"]), 10)
    take([q for q, s in rc["status"].items() if me in (s["committed"], s["signed"])], 8)
    take([q for q, s in rc["status"].items() if s["committed"] and s["committed"] != me and not s["signed"]], 8)
    take([q for q in rc["status"] if persona.hidden_from(st, me, q)], 4)
    take([q for q, s in rc["status"].items() if s["signed"] and s["signed"] != me], 6)
    take([q for q, s in rc["status"].items() if s["fcs"] or s.get("pro")], 4)
    take(list(rc.get("generational") or []), 3)
    take([q for q in rc["visits"]], 5)
    take(ranked[:8], 8)
    take([q for q in ranked if rc["prospects"][q]["ea_position"] in ("K", "P")], 3)
    take(ranked, n_random)
    visible = recruiting.visible(st)
    return [q for q in picks if q in visible] + [q for q in picks if q not in visible][:2]


def pure_cases(c: Cases) -> None:
    for pos in ["QB", "HB", "FB", "WR", "TE", "LT", "LG", "C", "RG", "RT", "LEDG", "REDG", "DT", "MIKE", "WILL", "SAM", "CB", "FS", "SS", "K", "P", "ATH"]:
        c.add("display_pos", pos)
    for h in [None, 74, 60, 83.0, "6'2\"", 71.9]:
        c.add("height_text", h)
    for w in [None, 215, 180]:
        c.add("weight_text", w)
    for h in [None, 74, 72.6, True, "6'2\"", "5'11\"", "6'", "6", "", "six'two", " 6 ' 3 \"", "6'2'1", "6'2.5\""]:
        c.add("_height_in", h)
    for x in [-0.1, 0, 0.0, 1e-9, 0.049, 0.05, 0.1499, 0.15, 0.6, 1.0]:
        c.add("flip_word", x)
    rng = random.Random("pure")
    for _ in range(40):
        c.add("_middle", [rng.choice([rng.randint(-5, 110), round(rng.uniform(0, 99), 2)]) for _ in range(rng.randint(1, 40))])
    for _ in range(40):
        c.add("class_points", [round(rng.uniform(0.6, 1.0), 4) for _ in range(rng.randint(0, 32))], close=True)
    for pts in [0, 20, 20.0, 25.5, 37, 44.4, 52, 60, 68, 75.2, 80, 85, 90, 99, 110] + [round(rng.uniform(10, 100), 3) for _ in range(40)]:
        c.add("_dev_rate", pts)
        c.add("growth_share", pts)
    cuts = {5: [9.5, 7.0, 1.0], 4: [8.0, 5.5, 0.5], None: [3.0, 2.0, 1.0], 2: []}
    for stars in (5, 4, 3, 2, None):
        for v in (10, 9.5, 7.2, 5.5, 2.0, 0.4):
            c.add("_level", v, stars, cuts)
    for traits in [{"personality": None, "decider": "Mom", "story": None, "commit_style": None, "has_style": False},
                   {"personality": "Loyal", "decider": None, "story": None, "commit_style": None, "has_style": True},
                   {"personality": None, "other": None, "commit_style": None}, {}]:
        c.add("trait_hints", traits)
    for place in ("start", "next", "depth"):
        c.add("_role", place)
    W = recruiting.WORDS
    for e in [{"after": {"potential": [W[3], W[1]]}, "before": {}}, {"after": {"potential": [W[2], W[2]]}, "before": {"potential": [W[3], W[1]]}},
              {"after": {"potential": [W[4], W[2]]}, "before": {"potential": [W[3], W[1]]}}, {"after": {}, "before": {}},
              {"after": {"technique": [W[4], W[3]], "athleticism": [W[1], W[1]]}, "before": {"technique": [W[5], W[2]]}}]:
        c.add("_look_change", e)


def stage_cases(st: dict, light: bool) -> list:
    c = Cases(st)
    rc, me = st["recruiting"], st["team"]
    teams = season.load_teams()
    rng = random.Random(f"cases-{ck(rc)}-{st['current_week']}")
    pids = sample(st, 12 if light else 30, f"sample-{ck(rc)}")
    others = [s for s in recruiting.fbs_schools(st) if s != me]
    other = next((s for s in others if rc["offers"].get(s)), others[0])        # another school, one that is recruiting

    # the pools and the comps' measures
    c.add("player_pool")
    c.add("starter_pool")
    positions = sorted({s["position"] for s in prospects.player_pool()})
    for pos in positions + ["XX"]:
        c.add("_attributes", pos)
        c.add("comp_max_distance", pos)
    c.add("warm")
    for pos in ["QB", "RB", "WR", "TE", "OL", "DL", "MLB", "ROLB", "LOLB", "CB", "S", "K", "P"]:
        for key in ["overall", "top_speed", "strength", "football_iq", "kick_power", "nope"]:
            c.add("league_values", pos, key)
            c.add("league_rank", pos, key, rng.choice([40, 55.5, 63, 71, 88, 99]))
    c.add("_ranks", S)

    # one prospect at a time
    for i, pid in enumerate(pids):
        p = rc["prospects"][pid]
        full = i < (10 if light else 26)
        c.add("profile", S, pid, me, close=True)
        if not full:
            continue
        c.add("row", S, pid, me)
        c.add("board_row", S, pid, me, close=True)
        for fn in ("find", "report", "read_overall", "pos_rank"):
            c.add(fn, S, pid)
        c.add("staff_likes", S, pid, me)
        c.add("staff_likes", S, pid, other)
        c.add("odds", S, pid, None, me, close=True)
        c.add("odds", S, pid, 3, None, close=True)
        c.add("odds", S, pid, 14, other, close=True)
        c.add("standing", S, pid, me, close=True)
        c.add("standing", S, pid, other, close=True)
        c.add("flip_view", S, pid, me, close=True)
        c.add("flip_view", S, pid, None, close=True)
        c.add("_flip_risk", S, pid, me)
        for viewer in (me, None, other):
            c.add("seen_status", S, pid, viewer)
        c.add("_schools", S, pid, me, close=True)
        c.add("_schools", S, pid, None, close=True)
        c.add("_public_grades", P(pid), close=True)
        public = prospects._public_grades(p)
        c.add("_evaluation", P(pid), public)
        c.add("ceiling", S, P(pid))
        c.add("projection", S, P(pid), public)
        c.add("projection", S, P(pid), {g: p["truth"][g] + 3 for g in recruiting.GROUPS if g != "coachability"})
        for field in ("ratings", "potential"):
            c.add("_shifted", S, P(pid), public, field)
            c.add("game_attributes", S, P(pid), field)
        c.add("game_attributes", S, P(pid))
        vector = prospects.projection(st, p, public)
        c.add("comp", vector, p["ea_position"], POOL, f"public-{pid}", close=True)
        c.add("comp", vector, p["ea_position"], POOL, None, close=True)
        c.add("comp", prospects.ceiling(st, p), p["ea_position"], POOL, f"x-{pid}")
        for g in recruiting.GROUPS:
            c.add("uncertainty", S, pid, g)
            c.add("group_keys", P(pid), g) if g in ("athleticism", "size_strength", "football_iq", "technique") else None
            lo = rng.uniform(20, 80)
            c.add("grade_detail", S, P(pid), g, lo, lo + rng.choice([0.5, 6, 15, 40]))
            c.add("grade_detail", S, P(pid), g, p["truth"][g], p["truth"][g])
        c.add("generational_seen", RC, pid, me)
        c.add("generational_seen", RC, pid, None)
        c.add("can_scout", S, me, pid)
        c.add("signed_ratings", S, P(pid))
        c.add("_high_school", P(pid))
        c.add("_stage_move", S, pid, me)
        c.add("shown", S, P(pid))
        c.add("engine_position", P(pid))
        c.add("_abilities_seen", P(pid))
        c.add("_standing_word", S, pid, me)
        c.add("looks_out", READ(pid))
        c.add("card_attributes", prospects.ceiling(st, p), P(pid))
        for s, v in (rc["visits"].get(pid) or {}).items():
            c.add("visit_view", S, s, v)
        c.add("visit_view", S, me, None)
        c.add("visit_view", S, me, {"week": st["current_week"], "done": False})
        c.add("visit_view", S, me, {"week": max(1, st["current_week"] - 1), "done": True})
    c.add("profile", S, pids[0], other, close=True)
    c.add("profile", S, "nobody", me)
    if rc.get("portal") and st.get("recruiting_last"):                 # a signee of the class kept aside, opened in the portal weeks
        kept = st["recruiting_last"]
        signee = next((q for q, s in kept["status"].items() if s["signed"] == me), None) or next(iter(kept["prospects"]))
        c.add("profile", S, signee, me, close=True)

    # the lists
    visible = recruiting.prospect_list(st)
    c.add("your_interest", S, me, visible[:400])
    c.add("history_index", S, me)
    c.add("history_index", S, other)
    home = rc["prospects"][pids[0]]["hometown"]["state"]
    name = rc["prospects"][pids[1]]["name"].split()[-1][:4].upper()
    searches = [
        [], [None, None, None, None, None, 50, 50], [None, None, None, None, None, 0, 25, "-rank"],
        ["QB"], ["LT"], [None, 4], [None, 5, None, None, None, 0, 9999], [None, None, home], [None, None, None, None, f"  {name} "],
        *[[None, None, None, status, None, 0, 40] for status in ("open", "committed", "signed", "leaning_fcs", "offered", "favorites", "board", "interested", "recommended")],
        [None, None, None, "recommended", None, 0, 30, "-rank"], [None, None, None, "recommended", None, 0, 30, "interest"],
        *[[None, None, None, None, None, 0, 60, sort] for sort in ("interest", "-int", "name", "-who", "pos", "ht", "-ht", "wt", "-wt", "stars", "-stars", "status",
                                                                    "-status", "ask", "-ask", "offers", "-offers", "sc", "-sc", "pot", "-pot", "-", "nothing")],
        [None, None, None, None, None, 0, 40, "rank", "OT"], [None, None, None, None, None, 0, 40, "pot", "EDGE"], [None, None, None, None, None, 0, 0, "rank", "QB"],
        *[[None, None, None, None, None, 0, 40, "rank", None, cols] for cols in (
            {"commit": "open"}, {"commit": "committed", "interest": ""}, {"commit": "signed", "ht_min": None}, {"interest": "High"}, {"interest": "Medium"},
            {"interest": "Low", "wt_min": 250}, {"scouted": "none"}, {"scouted": "partly"}, {"scouted": "fully"}, {"pot": "A"}, {"pot": "B"}, {"pot": "S"}, {"pot": "E"},
            {"ht_min": 74, "ht_max": 76}, {"wt_max": 190}, {"offers_min": 3}, {"offers_min": 1, "offers_max": 4, "commit": "open"}, {"ask_min": 20}, {"ask_max": 15, "ask_min": 1},
            {"ht_min": 70, "wt_min": 200, "offers_max": 10, "ask_max": 200, "scouted": "partly"})],
    ]
    for args in (searches[::3] if light else searches):
        c.add("search", S, me, *args)
    c.add("search", S, other, None, None, None, None, None, 0, 15, "interest")
    needs = recruiting.needs_by_spot(st, me)
    c.add("class_summary", S, me, visible, needs)
    c.add("class_summary", S, other, visible[:300], needs)
    c.add("recruiting_view", S, close=True)
    views = [[], ["  " + name.lower()], [home], [None, "qb"], [None, None, "ot"], [None, None, None, 10, 30], [None, None, None, -4, 9999.0], [None, None, None, 0, 0],
             [None, None, None, 0, 60, True], [None, None, None, 0, 60, False, "board"], [None, None, None, 0, 60, False, "need"],
             [None, None, None, 0, 60, False, "potential"], [None, None, None, 0, 60, False, "looks"], [None, None, None, 0, 60, False, "what"],
             [None, None, None, 0, 60, False, "board", True], [None, None, None, 0, 60, True, "potential", True]]
    for args in (views[::3] if light else views):
        c.add("scouting_view", S, *args)

    # the classes
    for viewer in (me, None, other):
        c.add("national_classes", S, viewer, close=True)
        c.add("class_table", S, viewer, close=True)
    c.add("national_classes", S)
    schools = [me, other] + [s for s in recruiting.fbs_schools(st) if s not in (me, other)][:: 16 if light else 9]
    portal = bool(rc.get("portal"))                  # the Classes tab asks for a class inside class_block then
    for slug in schools:
        c.add("class_detail", S, slug, me, block=portal)
        c.add("class_rank", S, slug)
        c.add("class_rank", S, slug, me)
    c.add("class_detail", S, me, other, block=portal)
    if portal:
        c.add("national_classes", S, me, close=True, block=True)
        c.add("search", S, me, None, None, None, None, None, 0, 20, block=True)
    c.add("season_week_label", st["current_week"])
    for w in range(0, 22):
        c.add("season_week_label", w)
    c.add("reset_caches")
    c.add("player_pool")
    return c.rows


def extras(st: dict) -> dict:
    """What is asked for outside a plain call: the correlations under _attributes (the JavaScript's own correlation is
    held to Python's digit for digit), class_block's swap, and the namespace's caches."""
    corr = []
    for pos in sorted({s["position"] for s in prospects.starter_pool()}):
        starters = [s for s in prospects.starter_pool() if s["position"] == pos and s.get("overall") is not None]
        if len(starters) < 3:
            continue
        overall = [s["overall"] for s in starters]
        for k in starters[0]["skills"]:
            x = [s["skills"].get(k, 0) for s in starters]
            try:
                r = statistics.correlation(x, overall)
            except statistics.StatisticsError:
                r = None
            corr.append([x, overall, r])
    rng = random.Random("corr")
    for _ in range(300):
        n = rng.randint(2, 60)
        x = [rng.choice([rng.gauss(50, 12), float(rng.randint(30, 99)), rng.randint(30, 99)]) for _ in range(n)]
        y = [xi * rng.uniform(-1, 2) + rng.gauss(0, rng.choice([0, 1e-9, 5])) for xi in x] if rng.random() < 0.9 else [7.5] * n
        try:
            r = statistics.correlation(x, y)
        except statistics.StatisticsError:
            r = None
        corr.append([x, y, r])
    before = ck(st["recruiting"])
    with prospects.class_block(st) as inside:
        during = ck(inside["recruiting"])
    return {"correlation": corr, "class_block": [before, during, ck(st["recruiting"])], "class_rc": ck(prospects.class_rc(st))}


# ----- the career's moments ---------------------------------------------------------------------------------------

def G(sid: str, path: str) -> dict:
    return api.call("GET", f"/api/season/{sid}/{path}")


def staff_looks(st: dict) -> None:
    """Your staff's reads on a spread of the class: one to three trips each, a few area looks, a board, favorites."""
    rc, me = st["recruiting"], st["team"]
    rng = random.Random(f"looks-{rc['seed']}")
    ranked = sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"])
    staff = st["career"]["staff"]
    rest = ranked[40:]
    chosen = ranked[:40] + rng.sample(rest[:560], min(90, len(rest[:560]))) + rng.sample(rest[560:], min(90, len(rest[560:])))
    week = recruiting.look_week(st)
    for i, pid in enumerate(chosen):
        member = staff[i % len(staff)]
        for _ in range((3, 3, 2, 1, 3, 2)[i % 6]):
            recruiting.look(st, pid, member["evaluation"], rng, by="trip", week=week)
        if i % 6 == 5 or i % 7 == 0:                    # an area scout's half look: 2.5 looks, or one on top
            recruiting.look(st, pid, member["evaluation"], rng, by=member["id"], week=week, weight=recruiting.AREA_LOOK)
    for pid in chosen[::5]:
        try:
            recruiting.set_board(st, pid, True)
        except recruiting.RecruitingError:
            pass
    for pid in chosen[1::9]:
        recruiting.set_favorite(st, pid, True)
    for pid in chosen[::10]:
        for action in ("offer", "message"):
            try:
                recruiting.act(st, me, pid, action)
            except recruiting.RecruitingError:
                pass


def fake_weeks(st: dict, first: int, last: int) -> None:
    """The recruiting weeks without the games: each week's games get a score, then recruiting's week runs (your
    school on Auto). The season's own sim is not this module's business."""
    teams = season.load_teams()
    rng = random.Random(f"weeks-{first}")
    for week in range(first, last + 1):
        for g in st["games"].values():
            if g["week"] == week and not g.get("played"):
                h, a = teams[g["home"]]["team_ratings"]["overall"], teams[g["away"]]["team_ratings"]["overall"]
                hs = rng.randint(10, 45)
                win = rng.random() < 1 / (1 + 10 ** ((a - h) / 12))
                g.update(played=True, home_score=hs if win else max(0, hs - rng.randint(1, 20)), away_score=hs - rng.randint(1, 20) if win else hs)
                if g["home_score"] == g["away_score"]:
                    g["home_score"] += 3
                if rng.random() < 0.1:
                    g["overtime"] = 1
        st["current_week"] = week
        recruiting.weekly_step(st, week, True)


def to_portal(sid: str) -> None:
    from tests.test_offseason import finished
    finished(api.loaded_state())
    api._save_loaded()
    G(sid, "offseason")
    while api.loaded_state()["offseason"]["stage"] != "portal_w1":
        api.call("POST", f"/api/season/{sid}/offseason/advance", {})


def write(out: Path, name: str, st: dict, light: bool, first: bool) -> None:
    t0 = time.time()
    TABLE.clear()
    CONFLICTS.clear()
    folder = out / name
    folder.mkdir(parents=True, exist_ok=True)
    state_text = json.dumps(enc(st))                 # before the cases: whether the views change it is reported
    c_pure = Cases(st)
    if first:
        pure_cases(c_pure)
    rows = c_pure.rows + stage_cases(st, light)
    extra = extras(st)
    after = json.dumps(enc(st))
    teams_text = json.dumps(season.load_teams())
    teams_name = f"teams-{hashlib.md5(teams_text.encode()).hexdigest()[:10]}.json"
    if not (out / teams_name).exists():
        (out / teams_name).write_text(teams_text)
    (folder / "state.json").write_text(after)        # as the cases left it (a view may fill in an empty entry)
    (folder / "table.json").write_text("{" + ",".join(json.dumps(k) + ":" + v for k, v in TABLE.items()) + "}")
    (folder / "cases.json").write_text(json.dumps({"cases": rows, "extra": extra}))
    (folder / "setup.json").write_text(json.dumps({
        "teams": teams_name, "clear": clear.on(), "state_changed": after != state_text, "conflicts": sorted(set(CONFLICTS))[:20],
        "consts": {name: constants_of(mod) for name, mod in {**RECORDED, "offseason": offseason}.items()},
        "prospects": constants_of(prospects),
        "names": sorted(k for k, v in vars(prospects).items() if not k.startswith("__") and not inspect.ismodule(v)
                        and getattr(v, "__module__", prospects.__name__) == prospects.__name__ and k not in ("annotations",)),
    }))
    print(f"{name}: {len(rows)} cases, {len(TABLE)} recorded calls, week {st['current_week']}, "
          f"{len(st['recruiting']['reads'])} reads, state changed by the views: {after != state_text}, "
          f"recorded answers that changed: {len(set(CONFLICTS))}, {time.time() - t0:.0f} s", flush=True)


def main(out: Path) -> None:
    words = not clear.on()
    out = out / ("words" if words else "clear")
    out.mkdir(parents=True, exist_ok=True)
    season.SEASONS_DIR = Path(tempfile.mkdtemp(prefix="cfp-prospects-ref-"))
    record()
    try:
        sid = api.call("POST", "/api/season", {"team": TEAM, "mode": "full", "seed": SEED, "career": True})["id"]
        st = api.loaded_state()
        staff_looks(st)
        write(out, "1-fresh", st, words, True)
        if "--first" in sys.argv:
            return
        fake_weeks(st, 1, 2 if words else 5)
        write(out, "2-weeks", st, words, False)
        if not words:
            from tests.test_offseason import finished
            fake_weeks(st, 6, 8)
            finished(st)
            write(out, "3-signed", st, True, False)
        to_portal(sid)
        st = api.loaded_state()
        staff_looks(st)
        write(out, "4-portal", st, words, False)
        if not words:
            api.call("POST", f"/api/season/{sid}/offseason/advance", {})
            write(out, "5-portal-week-2", api.loaded_state(), True, False)
    finally:
        season.close_pool()
        import shutil
        shutil.rmtree(season.SEASONS_DIR, ignore_errors=True)


if __name__ == "__main__":
    target = Path(sys.argv[1])
    main(target)
    if clear.on() and "--one" not in sys.argv:           # then the same with Clear Mode off (the switch is read as the module loads)
        subprocess.run([sys.executable, __file__, str(target)], env={**os.environ, "CFP_CLEAR": "0"}, check=True)
