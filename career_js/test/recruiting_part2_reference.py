"""Python's answers for career_js/recruiting/part2.js (coach_career/recruiting.py lines 815 to 1624), as JSON for
recruiting_part2_compare.mjs to hold the JavaScript to:

    python3 career_js/test/recruiting_part2_reference.py OUTDIR && node career_js/test/recruiting_part2_compare.mjs OUTDIR

Real seeded careers are taken through a few moments (a fresh class with your staff's looks, recruiting weeks in, the
late market, the transfer portal's first and second week; a second school's first weeks), and at each one every
function of the part is asked for real schools and prospects. The part is checked alone, so what it calls outside
itself is given to the JavaScript as Python had it: the rest of recruiting.py, persona, offseason and season are
recorded as they answer (every call's arguments and result, in a table the compare script replays), and the teams,
the recruiting models and the constants are written whole. programs is the real career_js/programs.js.

What each moment's folder holds: state.json (the state before the cases, slimmed to what the part reads), setup.json
(teams, models, constants, the part's own names), table.json (the recorded calls), cases.json (each call and Python's
answer), after.json (what the cases left in the state)."""
import inspect
import json
import os
import random
import re
import struct
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("CFP_SEASONS_DIR", tempfile.mkdtemp())
os.environ.setdefault("SIM_WORKERS", "1")

from app import api                                                   # noqa: E402
from coach_career import offseason, persona, recruiting               # noqa: E402
from sim import season                                                # noqa: E402

FIRST_LINE, LAST_LINE = 815, 1624

# ----- the part's own names (from the Python file's lines) ---------------------------------------------------------

SOURCE = (ROOT / "coach_career" / "recruiting.py").read_text().split("\n")
MINE = []
for line in SOURCE[FIRST_LINE - 1:LAST_LINE]:
    m = re.match(r"(?:def|class) (\w+)", line) or re.match(r"([A-Za-z_]\w*)\s*(?::[^=]*)?=", line)
    if m and m.group(1) not in MINE:
        MINE.append(m.group(1))
MINE_CONSTANTS = ("SPOTS", "SPOT_OF", "SPOT_ORDER", "SPOT_GROUP", "SPOT_STARTERS", "RECOMMENDED_WHY")


# ----- what the JavaScript is told of a value -----------------------------------------------------------------------

def num(x) -> str:
    return "n" + struct.pack(">d", float(x)).hex()


def canon(a) -> str:
    """One argument of a recorded call as text, written the same way by the compare script."""
    if isinstance(a, dict):
        if "recruiting" in a and "team" in a:
            return "S"
        if "ea_position" in a and "id" in a:
            return "P:" + a["id"]
        if "offense" in a and "defense" in a:
            return "T"
        if len(a) > 40:
            return "BIG"
        return "{" + ",".join(json.dumps(str(k)) + ":" + canon(a[k]) for k in sorted(a, key=str)) + "}"
    if a is None:
        return "null"
    if a is True:
        return "true"
    if a is False:
        return "false"
    if isinstance(a, (int, float)):
        return num(a)
    if isinstance(a, str):
        return json.dumps(a)
    if isinstance(a, random.Random):
        return "RNG"
    if isinstance(a, (list, tuple)):
        return "[" + ",".join(canon(x) for x in a) + "]"
    raise TypeError(f"an argument the table cannot key: {type(a)}")


def enc(v):
    """A value as JSON: a set as its sorted members, a tuple as a list."""
    if isinstance(v, (set, frozenset)):
        return {"$set": sorted(enc(x) for x in v)}
    if isinstance(v, (list, tuple)):
        return [enc(x) for x in v]
    if isinstance(v, dict):
        return {str(k): enc(x) for k, x in v.items()}
    if isinstance(v, Path):
        return str(v)
    return v


# ----- recording what the part asks outside itself -----------------------------------------------------------------

TABLE: dict = {}
CONFLICTS: list = []
RECORDING = False
DEPTH = 0

RECORDED = {
    recruiting: ("_ck", "is_portal", "_early_leaver_cut", "_build_board", "_fits", "prospect_list", "tier_of", "_miles", "_group",
                 "_ahead", "_logistic", "_interp", "fbs_schools", "ask_view", "ask_from", "pending", "_national_share"),
    persona: ("home_of", "story_interest", "pitch_mult", "story_mult", "twist_mult", "offer_mult", "counts_as_priority"),
    offseason: ("season_facts",),
    season: ("_records", "rank_map", "_is_p4"),
}


class Guarded(dict):
    """One of the part's caches: what a recorded call's own work would keep in it is not kept (the JavaScript never
    runs that work, so its cache would not have it)."""

    def __setitem__(self, k, v):
        if DEPTH == 0:
            super().__setitem__(k, v)


def wrap(mod, name: str):
    real = getattr(mod, name)
    sig = inspect.signature(real)
    names = list(sig.parameters)
    label = f"{mod.__name__.split('.')[-1]}.{name}"

    def wrapper(*a, **k):
        global DEPTH
        if not RECORDING or DEPTH:
            return real(*a, **k)
        given = sig.bind(*a, **k).arguments
        last = max(names.index(n) for n in given) if given else -1
        key = label + "(" + ",".join(canon(given[n]) if n in given else "U" for n in names[:last + 1]) + ")"
        kept = (recruiting._WINNING, recruiting._GROUP_COUNTS, recruiting._SPOT_NEEDS)
        DEPTH += 1
        try:
            out = real(*a, **k)
        finally:
            DEPTH -= 1
            recruiting._WINNING, recruiting._GROUP_COUNTS, recruiting._SPOT_NEEDS = kept
        text = json.dumps(enc(out))
        if key in TABLE and TABLE[key] != text:
            CONFLICTS.append(key)
        TABLE[key] = text
        return out

    setattr(mod, name, wrapper)


def record() -> None:
    for mod, names in RECORDED.items():
        for name in names:
            wrap(mod, name)
    recruiting._PULLS = Guarded()
    recruiting._STATIC = Guarded()


def forget() -> None:
    """The part's caches emptied (the compare script starts each moment the same way)."""
    recruiting._PULLS.clear()
    recruiting._STATIC.clear()
    recruiting._FORCED.clear()
    recruiting._WINNING, recruiting._GROUP_COUNTS, recruiting._SPOT_NEEDS = (None, {}), (None, {}), (None, {})
    recruiting._returning.cache_clear()
    recruiting._open_spots.cache_clear()
    recruiting._taste.cache_clear()


# ----- the state as the part reads it ---------------------------------------------------------------------------------

STATE_DROP = ("games", "my_boxes", "polls", "scores", "bracket", "rng_state")
P_DROP = ("ratings", "potential", "truth")


def slim(st: dict) -> dict:
    out = {k: v for k, v in st.items() if k not in STATE_DROP}
    for name in ("recruiting", "recruiting_last"):
        rc = st.get(name)
        if rc:
            rc = dict(rc)
            rc["prospects"] = {pid: {f: v for f, v in p.items() if f not in P_DROP} for pid, p in rc["prospects"].items()}
            rc.pop("log", None)
            rc.pop("reports", None)
            out[name] = rc
    lg = st.get("league")
    if lg:
        lg = {k: v for k, v in lg.items() if k in ("teams", "year")}
        lg["teams"] = {s: {**{k: v for k, v in t.items() if k not in ("roster", "history")},
                           "roster": [{"pos": c["pos"], "o": c["o"]} for c in t["roster"]]} for s, t in lg["teams"].items()}
        out["league"] = lg
    return out


def after_of(st: dict) -> dict:
    rc = st["recruiting"]
    return {"scout_points": rc.get("scout_points"), "hours": rc.get("hours"), "nil_pool": st.get("nil_pool"),
            "groups": {pid: p.get("group") for pid, p in rc["prospects"].items()}}


def slim_teams() -> dict:
    out = {}
    for s, t in season.load_teams().items():
        hc = (t.get("coaches") or {}).get("head_coach")
        out[s] = {"fictional": t.get("fictional"), "state": t.get("state"),
                  "coaches": {"head_coach": None if hc is None else {k: v for k, v in hc.items() if k in ("since", "ratings")}},
                  "offense": [{k: p[k] for k in ("position", "class", "ovr", "role") if k in p} for p in t["offense"]],
                  "defense": [{k: p[k] for k in ("position", "class", "ovr", "role") if k in p} for p in t["defense"]]}
    return out


def constants() -> dict:
    out = {}
    for k, v in vars(recruiting).items():
        if k.startswith("__") or k in MINE or callable(v) or inspect.ismodule(v) or isinstance(v, Path):
            continue
        if k.startswith("_") and k != "_GROUP":         # the other parts' caches: the compare script makes its own
            continue
        try:
            json.dumps(enc(v))
        except TypeError:
            continue
        out[k] = enc(v)
    return out


# ----- the cases -------------------------------------------------------------------------------------------------------

class Cases:
    def __init__(self, st: dict):
        self.st, self.rows = st, []

    def real(self, a):
        if a == "$S":
            return self.st
        if a == "$W":
            return recruiting._winning(self.st)
        if isinstance(a, dict) and "$p" in a:
            return self.st["recruiting"]["prospects"][a["$p"]]
        return a

    def add(self, fn: str, *args, close: bool = False) -> None:
        global RECORDING
        RECORDING = True
        try:
            out = getattr(recruiting, fn)(*[self.real(a) for a in args])
        finally:
            RECORDING = False
        self.rows.append([fn, list(args), json.loads(json.dumps(enc(out))), close])

    def forced(self, slug: str, pid: str, topic: str, value: float) -> None:
        """forced_strength around strengths, best_pitch and _contact_points."""
        global RECORDING
        p = self.st["recruiting"]["prospects"][pid]
        RECORDING = True
        try:
            with recruiting.forced_strength(self.st, slug, pid, topic, value):
                inside = [recruiting.strengths(self.st, slug, pid), recruiting.best_pitch(self.st, slug, pid, True),
                          recruiting._contact_points(self.st, slug, p, "call", topic)]
            outside = recruiting.strengths(self.st, slug, pid)
        finally:
            RECORDING = False
        self.rows.append(["$forced", [slug, pid, topic, value], enc([inside, outside]), False])


def pure_cases(c: Cases) -> None:
    rng = random.Random("pure")
    for n in range(-4, 7):
        c.add("need_factor", n)
    for r in [None, 0] + list(range(1, 31)):
        c.add("_bump", r)
    for _ in range(400):
        c.add("_five", round(rng.uniform(-20, 700), rng.choice([0, 1, 2, 6])))
    for x in (2.5, 7.5, 12.5, 17.5, 22.5, -2.5, 0, 5, 1000):
        c.add("_five", x)
    for _ in range(400):
        n = rng.randint(1, 5)
        weights = [float(rng.randint(0, 9)) for _ in range(n)] if rng.random() < 0.7 else [rng.randint(0, 3) for _ in range(n)]
        c.add("_share", rng.randint(0, 30), weights)
    for _ in range(300):
        f = {"wins": rng.randint(0, 15), "losses": rng.randint(0, 12)}
        for k in ("conference", "playoff", "host", "title", "met"):
            if rng.random() < 0.6:
                f[k] = rng.random() < 0.4
        if rng.random() < 0.05:
            f = {}
        c.add("_reward_lines", f)
        c.add("reward_why", f)
        c.add("reward", rng.choice([30, 60, 110, 135, 200, 275, 500]), f)
    groups = list(offseason.TARGET) + ["ATH", None]
    roles = sorted({p.get("role") or "" for t in season.load_teams().values() for p in t["offense"] + t["defense"]}) + [None, "XX"]
    for g in groups:
        for r in roles:
            c.add("spot_of_player", r, g)
    for g in offseason.TARGET:
        for n in range(-3, 6):
            c.add("group_cap", {g: n}, g)
    c.add("academic_schools")
    for s in list(season.load_teams()) + ["no-such-school"]:
        c.add("academic", s)
    states = sorted(recruiting.WARM_STATES | recruiting.COLD_STATES) + ["NC", "VA", "MO", None]
    for i in range(600):
        c.add("_taste", f"r{2027 + i % 3}-{rng.randint(1, 4000):04d}", rng.choice(states))


def sample(st: dict, n: int, seed: str) -> list:
    """Prospects worth asking about: the top of the class, the ones with commitments, offers, visits, twists or a
    move, and a random spread."""
    rc = st["recruiting"]
    rng = random.Random(seed)
    ranked = sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"])
    out = list(ranked[:8])

    def take(pids, k):
        pids = [q for q in pids if q not in out]
        out.extend(rng.sample(pids, min(k, len(pids))))

    take([q for q, s in rc["status"].items() if s.get("committed") or s.get("signed")], 10)
    take([q for q, s in rc["status"].items() if s.get("committed") == st["team"] or s.get("signed") == st["team"]], 6)
    take(list(rc.get("board") or []), 8)
    take([q for q in rc["offers"].get(st["team"], [])], 8)
    take([q for q, v in rc["visits"].items() if v], 6)
    take(list(rc.get("twists") or {}), 8)
    take(list(rc.get("moved") or {}), 6)
    take(list(rc.get("pending") or {}), 6)
    take([q for q, r in (rc.get("reads") or {}).items() if r], 6)
    take(ranked, n)
    return out


def stage_cases(st: dict, light: bool) -> list:
    c = Cases(st)
    rc, me = st["recruiting"], st["team"]
    rng = random.Random(f"cases-{st['current_week']}-{rc.get('cache_key')}")
    teams = season.load_teams()
    schools = sorted(s for s, t in teams.items() if not t.get("fictional") and recruiting._team_model(s))
    some = [me] + rng.sample([s for s in schools if s != me], 5 if light else 9)
    for extra in ("stanford", "air-force", "ohio-state"):
        if extra in schools and extra not in some:
            some.append(extra)
    portal = recruiting.is_portal(st)
    groups = list(offseason.TARGET)
    pids = sample(st, 20 if light else 45, f"sample-{st['current_week']}")
    everyone = list(rc["prospects"])

    # ---- every prospect's position and taste
    for pid in rng.sample(everyone, min(len(everyone), 150 if light else 500)) + pids:
        P = {"$p": pid}
        c.add("_group_of", P)
        c.add("spot_of", P)
        c.add("place_taste", P)
        c.add("weights", P)
        for key in (None, "", "OL", "OT", "QB", "WILL", "S", "EDGE", "LB"):
            c.add("spot_matches", P, key)

    # ---- every school's needs, spots and money
    c.add("_winning", "$S", close=False)
    for s in schools if not light else some:
        c.add("commits_by_group", "$S", s)
        c.add("offers_by_group", "$S", s)
        c.add("needs", "$S", s)
        c.add("needs_detail", "$S", s)
        c.add("needs_by_spot", "$S", s)
        c.add("needs_by_spot", "$S", s)                     # the kept answer
        c.add("need_levels", "$S", s)
        c.add("open_spots", "$S", s)
        c.add("offer_cap", "$S", s)
        c.add("_recruiting_rating", "$S", s)
        c.add("weekly_hours", "$S", s)
        c.add("_hours", "$S", s)
        c.add("nil_budget", "$S", s)
        c.add("nil_room", "$S", s)
        c.add("_coach_edge", "$S", s)
        c.add("_p4", s)
        c.add("on_field", "$S", s, st["current_week"])
        for week in (0, 3, 7, 11, 15, 20):
            c.add("on_field", "$S", s, week, None, None)
        c.add("carry_over", "$S", s, rng.choice([0, 3, 4, 5, 12, 37.5, 60, 140, 1000]))
        for g in groups:
            c.add("group_full", "$S", s, g)
        need = recruiting.needs(st, s)
        c.add("group_full", "$S", s, rng.choice(groups), need, None, None)
        if not portal:
            c.add("_open_spots", s)
            for g in groups:
                c.add("_returning", s, g)
        else:
            c.add("portal_room", "$S", s)
            c.add("portal_spots", "$S", s)
    for s in some:
        c.add("portal_pool", "$S", s)
        c.add("portal_pool", "$S", s, {"wins": 10, "losses": 3, "conference": True, "playoff": True, "met": True})
        c.add("pool_record", "$S", s)
        c.add("portal_budget", "$S", s)

    # ---- your side
    c.add("best_evaluator", "$S")
    c.add("covered_states", "$S")
    c.add("scout_points", "$S", me)
    c.add("scout_points_left", "$S", me)
    c.add("scout_points_left", "$S", some[1])
    for s in [me, some[1]] if not light else [me]:
        c.add("recommended", "$S", s)
    c.add("recommended", "$S", me)

    # ---- a school and a prospect
    for pid in pids:
        P = {"$p": pid}
        mine = list(rc["lists"][pid])
        rng.shuffle(mine)
        offered = [s for s, v in rc["offers"].items() if pid in v]
        with_ = list(dict.fromkeys([me] + offered[:2] + mine[:3] + [rng.choice(some)]))
        c.add("top_group", "$S", pid)
        c.add("top_group", "$S", pid, "$W")
        c.add("near_home", "$S", me, pid)
        c.add("look_cost", "$S", me, pid)
        c.add("known_ask", "$S", me, pid)
        for s in with_:
            c.add("pull", "$S", s, pid, close=True)
            c.add("pull", "$S", s, pid, False, close=True)
            c.add("interest", "$S", s, pid, close=True)
            c.add("interest", "$S", s, pid, "$W", close=True)
            c.add("strengths", "$S", s, pid)
            c.add("stage", "$S", s, pid)
            c.add("best_pitch", "$S", s, pid)
            c.add("best_pitch", "$S", s, pid, True)
            c.add("portal_upgrade", "$S", s, P)
            c.add("near_home", "$S", s, pid)
        c.add("strengths", "$S", me, pid, True)
        for s in with_[:2]:
            for action in ("message", "call", "offer", "hc_visit"):
                c.add("_grade_points", "$S", s, P, action)
                for pitch in [None] + rng.sample(list(recruiting.PITCHES), 3) + list(rc["prospects"][pid]["priorities"][:1]):
                    c.add("_contact_points", "$S", s, P, action, pitch)
                    c.add("_contact_points", "$S", s, P, action, pitch, True)
    for pid in pids[:6]:
        c.forced(me, pid, rng.choice(recruiting.PITCHES), rng.choice([0.0, 0.1, 0.24, 0.9, 1.7]))
    c.add("reset_caches")
    for pid in pids[:5]:
        c.add("interest", "$S", me, pid, close=True)
        c.add("strengths", "$S", me, pid)
    c.add("needs_by_spot", "$S", me)
    return c.rows


# ----- the career's moments (as career_js/test/prospects_reference.py makes them) -------------------------------------

def G(sid: str, path: str) -> dict:
    return api.call("GET", f"/api/season/{sid}/{path}")


def staff_looks(st: dict) -> None:
    """Your staff's reads on a spread of the class, a board, offers and messages."""
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
        if i % 6 == 5 or i % 7 == 0:
            recruiting.look(st, pid, member["evaluation"], rng, by=member["id"], week=week, weight=recruiting.AREA_LOOK)
    for pid in chosen[::5]:
        try:
            recruiting.set_board(st, pid, True)
        except recruiting.RecruitingError:
            pass
    for pid in chosen[::10]:
        for action in ("offer", "message"):
            try:
                recruiting.act(st, me, pid, action)
            except recruiting.RecruitingError:
                pass


def fake_weeks(st: dict, first: int, last: int) -> None:
    """The recruiting weeks without the games: each week's games get a score, then recruiting's week runs (your
    school on Auto)."""
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
    forget()
    folder = out / name
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "state.json").write_text(json.dumps(slim(st)))
    slugs = list(season.load_teams())
    setup = {
        "teams": slim_teams(),
        "models": {s: recruiting._team_model(s) for s in slugs if recruiting._team_model(s)},
        "coaches_current": recruiting.model()["coaches"]["current"],
        "consts": constants(),
        "offseason": {"GROUP": offseason.GROUP, "TARGET": offseason.TARGET, "UNDERCLASS_ELIGIBLE": enc(offseason.UNDERCLASS_ELIGIBLE)},
        "mine": MINE,
        "mine_constants": {k: enc(getattr(recruiting, k)) for k in MINE_CONSTANTS},
    }
    c = Cases(st)
    if first:
        pure_cases(c)
    rows = c.rows + stage_cases(st, light)
    (folder / "setup.json").write_text(json.dumps(setup))
    (folder / "table.json").write_text("{" + ",".join(json.dumps(k) + ":" + v for k, v in TABLE.items()) + "}")
    (folder / "cases.json").write_text(json.dumps(rows))
    (folder / "after.json").write_text(json.dumps(after_of(st)))
    print(f"{name}: {len(rows)} cases, {len(TABLE)} recorded calls, week {st['current_week']}, portal {recruiting.is_portal(st)}, "
          f"recorded answers that changed: {len(set(CONFLICTS))} {sorted(set(CONFLICTS))[:3]}, {time.time() - t0:.0f} s", flush=True)


def main(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    season.SEASONS_DIR = Path(tempfile.mkdtemp(prefix="cfp-rec2-ref-"))
    record()
    names = []
    try:
        sid = api.call("POST", "/api/season", {"team": "smu", "mode": "full", "seed": 62, "career": True})["id"]
        st = api.loaded_state()
        staff_looks(st)
        write(out, "1-fresh", st, False, True)
        names.append("1-fresh")
        if "--first" not in sys.argv:
            fake_weeks(st, 1, 5)
            write(out, "2-weeks", st, False, False)
            fake_weeks(st, 6, 13)
            write(out, "3-late", st, True, False)
            to_portal(sid)
            st = api.loaded_state()
            staff_looks(st)
            write(out, "4-portal", st, False, False)
            api.call("POST", f"/api/season/{sid}/offseason/advance", {})
            write(out, "5-portal-week-2", api.loaded_state(), True, False)
            names += ["2-weeks", "3-late", "4-portal", "5-portal-week-2"]
            # another school, another seed
            api.call("POST", "/api/season", {"team": "ohio-state", "mode": "full", "seed": 9, "career": True})
            st = api.loaded_state()
            staff_looks(st)
            fake_weeks(st, 1, 3)
            write(out, "6-other", st, True, False)
            names.append("6-other")
        (out / "moments.json").write_text(json.dumps(names))
    finally:
        season.close_pool()
        import shutil
        shutil.rmtree(season.SEASONS_DIR, ignore_errors=True)


if __name__ == "__main__":
    main(Path(sys.argv[1]))
