"""Python's answers for career_js/offseason/part3.js (coach_career/offseason.py lines 1668 to 2468):
python3 career_js/test/offseason_part3_reference.py OUTDIR, then node career_js/test/offseason_part3_compare.mjs OUTDIR.

Real careers (a faked finished season, as tests/test_offseason.py fakes one, then the real offseason on Auto up to the
Conferences step), each in its own folder OUTDIR/<tag>/. The part's stage functions are caught as the offseason
calls them: the state before (slimmed: no games, a prospect cut to his id and group), the answer, and the state's
parts they change after. So `_carry_over`, then `_develop_all`, `_fill_rosters` and `_develop_coaches` one after the
other on one state, then `_staff_changes`, `open_role` and `hire` at the Staff step, then `_apply_staff`.
One career runs with Clear Mode off (CFP_CLEAR=0, in a child process). Some careers get a made-up season's stats and
production (a faked season has none), so every branch of development is taken.

What the part asks of the file's other parts and of modules outside JavaScript is recorded here and replayed by the
compare script: growth_terms and _compact_prospect call by call, recruiting's pool numbers by school, the season's
records and Power 4 flags, prospects' class table and class rank. `unit.json` holds the part's small functions on
real players, coaches and made-up grids."""
import copy
import json
import os
import random
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from coach_career import carousel, clear, league as lg, offseason, programs, prospects, recruiting, recruits   # noqa: E402
from sim import season                                                                                # noqa: E402
from test_offseason import finished                                                                   # noqa: E402

OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
# (tag, team, seed, made-up stats and production, a created coach, Clear Mode)
CASES = (("a", "ohio-state", 5, False, False, True), ("b", "troy", 11, True, True, True), ("c", "texas", 3, True, False, True),
         ("d", "georgia-tech", 21, True, False, False))


def jd(v):
    return json.loads(json.dumps(v))


def write(folder: Path, name: str, v) -> None:
    (folder / name).write_text(json.dumps(v), encoding="utf-8")


def slim(state: dict) -> dict:
    """The state as the part needs it: no games or boxes, the departures and the portal's own recruiting left out, a
    prospect cut to what _preferred_walk_on reads."""
    out = {k: v for k, v in state.items() if k not in ("games", "my_boxes", "recruiting", "offseason", "recruiting_last")}
    rc = state.get("recruiting") or {}
    out["recruiting"] = {k: v for k, v in rc.items() if k in ("portal", "status", "lists", "nil")}
    out["recruiting"]["prospects"] = {pid: {"id": p["id"], "ea_position": p.get("ea_position"), **({"group": p["group"]} if "group" in p else {})}
                                      for pid, p in (rc.get("prospects") or {}).items()}
    out["offseason"] = {k: v for k, v in state["offseason"].items() if k not in ("departures", "portal_recruiting", "retention")}
    return jd(out)


def constants() -> dict:
    """Every constant of the offseason file a JSON can hold (a set as {"__set__": [...]})."""
    out = {}
    for k, v in vars(offseason).items():
        if not k.isupper() and not (k.startswith("_") and k[1:].isupper()):
            continue
        if isinstance(v, (set, frozenset)):
            out[k] = {"__set__": sorted(v)}
            continue
        try:
            out[k] = jd(v)
        except (TypeError, ValueError):
            pass
    return out


# ----- recording what the part asks of the rest -------------------------------------------------------------------
class Rec:
    on = None            # the dict being filled, or None
    depth = 0            # inside a recorded call: what it asks in turn is its own business


def record(mod, name, key, keep):
    orig = getattr(mod, name)

    def f(*a, **kw):
        if Rec.on is None or Rec.depth:
            return orig(*a, **kw)
        Rec.depth += 1
        try:
            out = orig(*a, **kw)
        except Exception as e:      # noqa: BLE001
            keep(Rec.on.setdefault(key, [] if key.endswith("[]") else {}), a, {"__raised__": type(e).__name__})
            raise
        finally:
            Rec.depth -= 1
        keep(Rec.on.setdefault(key, [] if key.endswith("[]") else {}), a, out)
        return out
    setattr(mod, name, f)


record(offseason, "growth_terms", "growth_terms[]", lambda box, a, out: box.append(jd(list(out))))
record(offseason, "_compact_prospect", "_compact_prospect[]", lambda box, a, out: box.append({"pid": a[1]["id"], "out": jd(out)}))
record(recruiting, "portal_budget", "portal_budget", lambda box, a, out: box.__setitem__(a[1], out))
record(recruiting, "nil_left", "nil_left", lambda box, a, out: box.__setitem__(a[1], out))
record(recruiting, "carry_over", "carry_over", lambda box, a, out: box.__setitem__(a[1], [a[2], out]))
record(season, "_is_p4", "_is_p4", lambda box, a, out: box.__setitem__(a[0], bool(out)))
record(season, "_records", "_records[]", lambda box, a, out: box.append(jd(out)))
record(prospects, "class_table", "class_table[]", lambda box, a, out: box.append(jd(out)))
record(prospects, "class_rank", "class_rank[]", lambda box, a, out: box.append(jd(out)))


class Case:
    folder = None
    n = 0


def after_of(state: dict, name: str):
    if name == "_carry_over":
        return {"nil_carry": state["nil_carry"], "nil_pool": state["nil_pool"], "portal_nil": state["offseason"]["portal_nil"]}
    if name in ("_develop_all", "_fill_rosters"):
        return {"teams": state["league"]["teams"]}
    if name == "_develop_coaches":
        return {"teams": {s: {"coaches": t["coaches"]} for s, t in state["league"]["teams"].items()}, "market": state["league"].get("market"),
                "staff": state["career"]["staff"]}
    if name == "_staff_changes":
        return {"staff": state["career"]["staff"]}
    return {"coaches": state["league"]["teams"][state["team"]]["coaches"], "market": state["league"].get("market"), "staff": state["career"]["staff"]}


def hook(name: str, before: bool):
    orig = getattr(offseason, name)

    def f(state, *a, **kw):
        if Case.folder is None:
            return orig(state, *a, **kw)
        if before:
            st0 = slim(state)
            if name == "_carry_over":       # only what it reads: the schools, the pools, who signed
                st0 = {"team": st0.get("team"), "league": {"teams": {s: {} for s in state["league"]["teams"]}}, "nil_pool": st0.get("nil_pool"),
                       "recruiting": {"nil": st0["recruiting"].get("nil"), "status": st0["recruiting"]["status"]}, "offseason": {}}
            write(Case.folder, f"{name}.before.json", st0)
        Rec.on = {}
        try:
            out = orig(state, *a, **kw)
        finally:
            rec, Rec.on = Rec.on, None
        write(Case.folder, f"{name}.json", {"args": jd(list(a)), "out": jd(out), "rec": rec, "after": jd(after_of(state, name))})
        return out
    setattr(offseason, name, f)


for name_, before_ in (("_carry_over", True), ("_develop_all", True), ("_fill_rosters", False), ("_develop_coaches", False),
                       ("_staff_changes", True), ("_apply_staff", False)):
    hook(name_, before_)


def made_up_year(st: dict, rng: random.Random) -> None:
    """A season's stats for every team and last season's production for a third of the players (a faked season has
    neither): the thirds, a breakout, a hard year, honors."""
    ss = {"__meta__": {"games": 3}}
    for slug in st["league"]["teams"]:
        ss[slug] = {"games": rng.choice((12, 13, 14)), "points": rng.randint(150, 560), "opp_points": rng.randint(150, 560)}
    ss[rng.choice(list(st["league"]["teams"]))]["games"] = 0
    ss["not-a-team"] = 7
    st["season_stats"] = ss
    perf = {}
    honors = (("heisman", "Heisman Trophy"), ("national", "Biletnikoff Award"), ("all_america_1", "First-Team All-American"),
              ("all_america_2", "Second-Team All-American"), ("national_finalist", "Maxwell Award Finalist"), ("all_conference_1", "First-Team All-Conference"))
    for t in st["league"]["teams"].values():
        for p in t["roster"]:
            u = rng.random()
            if u < 0.35:
                perf[p["id"]] = {"z": round(rng.gauss(0, 1.2), 3)}
                if rng.random() < 0.12:
                    perf[p["id"]]["honors"] = [list(h) for h in rng.sample(honors, rng.randint(1, 3))]
            elif u < 0.40:
                perf[p["id"]] = {"z": None, "honors": [list(rng.choice(honors))]}
    st["offseason"]["performance"] = perf


def walk_on_class(st: dict, rng: random.Random) -> None:
    """The unsigned prospects of the class as a real signing day leaves them (a faked season signs only the top of
    the class): most to the FCS, a few of those to pro baseball."""
    rc = st["recruiting"]
    assert not rc.get("portal"), "the class is not back yet"
    for pid, s_ in rc["status"].items():
        if not s_.get("signed") and rng.random() < 0.8:
            s_["signed"] = "FCS"
            if rng.random() < 0.05:
                s_["pro"] = True


def staff_variants(st: dict, car: dict, rng: random.Random) -> list:
    """_staff_changes on copies of the state at the Development step: contracts up or not, coordinators poached,
    declined, with and without a reason."""
    year = st["offseason"]["year"]
    out = []
    for i in range(10):
        s2 = copy.deepcopy(st)
        for s in s2["career"]["staff"]:
            u = rng.random()
            if u < 0.3:
                s.pop("contract_until", None)
            else:
                s["contract_until"] = year + rng.choice((-1, -1, 0, 1, 2))
        poached = rng.choice(([], ["offensive_coordinator"], ["defensive_coordinator"], ["offensive_coordinator", "defensive_coordinator"]))
        why = rng.choice((None, {}, {"offensive_coordinator": "was hired as head coach at Somewhere", "defensive_coordinator": ""}))
        declined = rng.choice((None, {}, {"defensive_coordinator": "akron"}, {"offensive_coordinator": None, "defensive_coordinator": "akron"}))
        s2["seed"] = (st.get("seed") or 0) * 100 + i
        staff0 = jd(s2["career"]["staff"])
        Case.folder, keep = None, Case.folder
        res = offseason._staff_changes(s2, list(poached), why, declined)
        Case.folder = keep
        out.append({"seed": s2["seed"], "staff": staff0, "poached": poached, "why": why, "declined": declined, "out": jd(res),
                    "staff_after": jd(s2["career"]["staff"])})
    return out


def errors(f, *a):
    try:
        f(*a)
    except ValueError as e:
        return str(e)
    return None


def run(tag: str, slug: str, seed: int, made_up: bool, coach: bool) -> dict:
    folder = OUT / tag
    folder.mkdir(parents=True, exist_ok=True)
    st = season.new_season(slug, "full", seed=seed, career=True)
    finished(st)
    off = offseason.start(st)
    off["auto"] = True
    rng = random.Random(f"part3-{tag}")
    if made_up:
        made_up_year(st, rng)
    if coach:
        st["career"]["coach"] = {"id": "c-test", "name": "Walter Testwell", "first_name": "Walter", "last_name": "Testwell"}
    Case.folder = folder
    while off["stage"] != "portal_recap":
        offseason.advance(st)
        off = st["offseason"]
    if made_up:
        walk_on_class(st, rng)
    offseason.advance(st)
    off = st["offseason"]
    assert off["stage"] == "development", off["stage"]
    # a second year of coach development on the same state (hidden levels already drawn), and the marks on their own
    again = copy.deepcopy(st)
    Case.folder = None
    Rec.on = {}
    res = offseason._develop_coaches(again)
    rec, Rec.on = Rec.on, None
    write(folder, "_develop_coaches.again.json", {"out": jd(res), "rec": rec, "after": jd(after_of(again, "_develop_coaches"))})
    Case.folder = folder
    # the Staff step: _staff_changes (caught by its hook), then letting people go and picking candidates
    offseason.advance(st)
    off = st["offseason"]
    assert off["stage"] == "staff", off["stage"]
    car = off["carousel"]
    ops = []
    stay = [s for s in st["career"]["staff"] if s["id"] not in off["staff"]["leaving"]]
    ops.append({"op": "open_role", "id": "nobody", "error": errors(offseason.open_role, st, "nobody")})
    for s in ([x for x in stay if x["role"] == "Recruiter"][:1] + [x for x in stay if x["role"] in offseason.STAFF_ROLES][:1]) if tag != "a" else stay[:1]:
        ops.append({"op": "open_role", "id": s["id"], "error": None, "out": jd(offseason.open_role(st, s["id"]))})
        ops.append({"op": "open_role", "id": s["id"], "error": errors(offseason.open_role, st, s["id"])})
    leaving = list(off["staff"]["leaving"])
    ops.append({"op": "hire", "id": "nobody", "index": 0, "error": errors(offseason.hire, st, "nobody", 0)})
    for i, sid in enumerate(leaving):
        ops.append({"op": "hire", "id": sid, "index": 9, "error": errors(offseason.hire, st, sid, 9)})
        ops.append({"op": "hire", "id": sid, "index": -1, "error": errors(offseason.hire, st, sid, -1)})
        if i % 2 == 0:
            idx = rng.randrange(len(off["staff"]["candidates"][sid]))
            ops.append({"op": "hire", "id": sid, "index": idx, "error": None, "out": jd(offseason.hire(st, sid, idx))})
    write(folder, "staff_ops.json", {"ops": ops, "offseason": jd({k: off.get(k) for k in ("coaching_changes", "staff_open", "staff")}),
                                     "market": jd(st["league"].get("market"))})
    offseason.advance(st)            # _apply_staff (caught by its hook) and the rest of the Staff step
    Case.folder = None
    return {"tag": tag, "team": slug, "seed": seed, "clear": clear.on()}


# ----- the small functions on real data ----------------------------------------------------------------------------
def unit(st: dict) -> dict:
    """`st`: a career at the Development step's start (before anyone develops)."""
    rng = random.Random("part3-unit")
    lgd = st["league"]
    attrs = lgd["attrs"]
    year = st["offseason"]["year"]
    u = {}
    levels = [n for n, _, _ in recruits.COACHABILITY] + ["Nobody's Level", None]
    cases = []
    for level in levels:
        for cls in ("FR", "SORS", "JR", "JRRS", "SR", "SRRS", None, ""):
            for z in (None, -2.0, -0.75, -0.5, 0.99, 1.0, 2.2):
                for rated in (40, 69.9, 70, 80, 85.5, 90, 99):
                    for rs, benched in ((False, False), (True, False), (False, True), (True, True)):
                        cases.append([[level, cls, z, rated, rs, benched], jd(list(offseason.coachability_chances(level, cls, z, rated, rs, benched)))])
    u["coachability_chances"] = cases
    cases = []
    for i in range(1500):
        level = rng.choice(levels)
        chances = {k: rng.choice((0.06, 0.2, 0.5, 0.9)) for k in offseason.COACH_CASES if rng.random() < 0.5}
        drop = rng.choice((0.0, 0.05, 0.6))
        cases.append([[level, chances, drop, f"roll-{i}"], jd(list(offseason.coachability_roll(level, chances, drop, random.Random(f"roll-{i}"))))])
    u["coachability_roll"] = cases
    u["coachability_note"] = [[[lv, c, coach], offseason.coachability_note(lv, c, coach) if coach else offseason.coachability_note(lv, c)]
                              for lv in levels[:-2] for c in offseason.COACH_NOTES for coach in (None, "Coach Smith")]
    teams = list(lgd["teams"].items())
    positions = list(offseason.GROUP)
    cases = []
    for slug, t in teams:
        co = jd(t["coaches"])
        variants = [co, {**co, "offensive_coordinator": None}, {"head_coach": co.get("head_coach")}, {}]
        for v in variants[:1] + [rng.choice(variants[1:])]:
            for pos in rng.sample(positions, 5):
                cases.append([[v, pos], [offseason._dev_side(pos), offseason.dev_rating(v, pos), offseason.coach_factor(v, pos), offseason._coach_title(v, pos)]])
    u["coaches"] = cases
    u["_coach_title"] = [[[c, "QB"], offseason._coach_title(c, "QB")] for c in ({"offensive_coordinator": {"name": "  Bob   Van Der Meer  "}},
                                                                                {"offensive_coordinator": {"name": ""}, "head_coach": {"name": "Al"}},
                                                                                {"head_coach": {"name": None}})]
    u["year_pace"] = [[[p, s], offseason.year_pace(p, s)] for p in ({}, {"yrs": None}, {"yrs": 0}, {"yrs": 1}, {"yrs": 2}, {"yrs": 3}, {"yrs": 4}, {"yrs": 7})
                      for s in (False, True)]
    abs_ = sorted({a for _, t in teams for p in t["roster"] for a in (p.get("ab") or [])})[:200] + ["The Natural|Gold", "Whatever", "X|Nope", "A|B|Platinum"]
    u["rv2_tier"] = [[a, offseason.rv2_tier(a)] for a in abs_]
    u["program_factor"] = {slug: offseason.program_factor(st, slug) for slug, _ in teams}
    u["ages"] = [[a, offseason.age_factor(a), offseason.pot_mean(a)] for a in range(22, 80)]
    u["_round"] = [[x, f"round-{i}", offseason._round(x, random.Random(f"round-{i}"))]
                   for i, x in enumerate([0, 0.0, 1.3, -1.3, 2.0, -2.0, 0.5, -0.5, 0.999, -0.001] + [round(rng.uniform(-4, 4), 3) for _ in range(300)])]
    u["term_of"] = [[r, list(offseason.term_of(r))] for r in ("OC", "DC", "Recruiter", "Whoever")]
    u["expiring"] = [[[s, y], offseason.expiring(s, y)] for s in ({}, {"contract_until": None}, {"contract_until": 2027}, {"contract_until": 2028})
                     for y in (2027, 2028, 2029)]
    cases = []
    for age in (30, 39, 40, 54, 55, 62, 63, 70):
        for unit_ in ("O", "D", "W", "class"):
            for m in ({}, {"O": 2, "D": -2, "W": 0, "class": 2}, {"O": -2, "D": 2, "W": 2, "class": -1}, {"W": -2, "class": 0}):
                for gained in (False, True):
                    cases.append([[age, unit_, m, gained], offseason._why(age, unit_, m, gained)])
    u["_why"] = cases
    # players: a year's growth, a step back, the card's moved attributes; Clear Mode on and off
    players = [(slug, p) for slug, t in teams for p in t["roster"]]
    was_clear = clear.CLEAR
    cases, grew, back = [], [], []
    for i in range(1200):
        slug, p0 = rng.choice(players)
        p = jd(p0)
        if i % 7 == 0:
            p["ab"] = (p.get("ab") or []) + [f"The Natural|{rng.choice(('Bronze', 'Silver', 'Gold', 'Platinum'))}"]
        if i % 11 == 0:
            p["c"] = "Unknown Level"
        if i % 13 == 0:
            p["yrs"] = None
        factor, starter, on = rng.choice((0.4, 0.8, 1.0, 1.37, 2.6)), rng.random() < 0.4, i % 3 != 0
        clear.CLEAR = on
        before = jd(p)
        gain = offseason.develop(p, attrs, factor, random.Random(f"dev-{i}"), starter) if i % 2 else offseason.develop(p, attrs, factor, random.Random(f"dev-{i}"))
        cases.append({"p": before, "factor": factor, "starter": starter, "clear": on, "seed": f"dev-{i}", "two": i % 2 == 0, "gain": gain,
                      "r": p["r"], "g": p["g"], "o": p["o"]})
        if i < 400:
            grew.append({"was": before["r"], "now": p["r"], "pos": p["pos"], "out": jd(offseason._card_growth(before["r"], p["r"], attrs, p["pos"]))})
        clear.CLEAR = was_clear
        q = jd(p0)
        perf = rng.choice((None, {}, {"z": None}, {"z": -1.0}, {"z": -1.6}, {"z": -2.4}, {"z": 0.4}))
        benched = rng.random() < 0.6
        if i % 3 == 0:
            q["c"] = rng.choice(clear.SLOW_LEVELS)
            q["yrs"] = rng.choice((None, 1, 2, 3))
        if i % 17 == 0:
            q["r"] = [1 if k not in offseason.PHYSICAL else v for k, v in zip(attrs, q["r"])]
        yr = rng.choice((2027, 2028, 2031))
        before = jd(q)
        note = offseason.regress(q, attrs, perf, benched, yr)
        back.append({"p": before, "perf": perf, "benched": benched, "year": yr, "note": note, "r": q["r"], "g": q["g"], "o": q["o"]})
    clear.CLEAR = was_clear
    u["develop"], u["_card_growth"], u["regress"] = cases, grew, back
    # coaches: a year for his ratings, his hidden levels
    coaches = [c for _, t in teams for c in t["coaches"].values() if c and c.get("ratings")]
    cases = []
    for i in range(1500):
        c = jd(rng.choice(coaches))
        ratings = c["ratings"] if i % 5 else {"evaluation": rng.randint(30, 95), "recruiting": rng.randint(30, 95)}
        if i % 9 == 0:
            ratings[rng.choice(list(ratings))] = rng.randint(20, 39)                 # under the floor: held, not lifted
        age = rng.choice((28, 35, 39, 40, 47, 54, 55, 60, 62, 63, 66, 71))
        holder = {} if i % 4 else {"pot": {k: v + rng.randint(-9, 9) for k, v in list(ratings.items())[:3] if k != "overall"}}
        before, holder0 = jd(ratings), jd(holder)
        r1 = random.Random(f"pot-{i}")
        pot = offseason._pot(holder, ratings, r1, age)
        pot_out = jd(pot)
        perf = rng.choice((0.0, 2.0, -1.0, -2.0, {k: rng.choice((2.0, 0.0, -1.0, -2.0)) for k in ratings if rng.random() < 0.8}))
        base = None if i % 6 == 0 else holder["base"]
        pace = rng.choice((1.0, 1.0, 0.5))
        args = [ratings, pot, age, perf, r1, base] + ([pace] if i % 3 == 0 else [])
        if i % 3:
            pace = 1.0
        changes = offseason.grow_coach(*args)
        cases.append({"ratings": before, "holder": holder0, "age": age, "seed": f"pot-{i}", "pot": pot_out, "holder_after": jd(holder), "perf": perf,
                      "base": i % 6 != 0, "pace": pace, "changes": changes, "after": jd(ratings)})
    u["coach_growth"] = cases
    # newcomers, candidates, the names taken, the walk-on a school would rather have, the marks
    cases = []
    for i in range(120):
        band = rng.choice(("2", "3", "4"))
        r = recruits.recruit(random.Random(f"new-{i}"), year, band, set())
        cases.append({"r": jd(r), "slug": f"w{year}-x-{i}", "out": jd(offseason._newcomer(r, f"w{year}-x-{i}"))})
    u["_newcomer"] = cases
    cases = []
    for i in range(300):
        taken = set(rng.sample(sorted(carousel._taken_names(lgd)), 40))
        s = {"role": rng.choice(("Recruiter", "OC", "DC"))}
        t0 = sorted(taken)
        out = offseason._candidate(random.Random(f"cand-{i}"), s, taken)
        cases.append({"s": s, "taken": t0, "seed": f"cand-{i}", "out": jd(out), "taken_after": sorted(taken)})
    u["_candidate"] = cases
    u["_staff_taken"] = sorted(offseason._staff_taken(st))
    taken, cases = set(), []
    for slug, _ in teams[::3]:
        for g in offseason.TARGET:
            best = offseason._preferred_walk_on(st, slug, g, taken)
            cases.append([[slug, g], best["id"] if best else None])
    u["_preferred_walk_on"] = cases
    u["_preferred_walk_on_taken"] = sorted(taken)
    Rec.on = {}
    u["_staff_marks"] = offseason._staff_marks(st)
    u["_league_marks"] = offseason._league_marks(st)
    u["marks_rec"], Rec.on = Rec.on, None
    bare = {"team": st["team"], "league": {"teams": {s: {} for s in lgd["teams"]}}, "games": {}, "career": True}
    try:
        u["marks_bare"] = [offseason._staff_marks(bare), None]
    except Exception as e:      # noqa: BLE001
        u["marks_bare"] = [None, type(e).__name__]
    return u


if __name__ == "__main__":
    if len(sys.argv) > 2:                      # the child: one career with Clear Mode as the environment says
        tag, slug, seed, made_up, coach = sys.argv[2], sys.argv[3], int(sys.argv[4]), sys.argv[5] == "1", sys.argv[6] == "1"
        info = run(tag, slug, seed, made_up, coach)
        write(OUT / tag, "info.json", info)
        sys.exit(0)
    infos = []
    for tag, slug, seed, made_up, coach, clear_on in CASES:
        env = dict(os.environ, CFP_CLEAR="1" if clear_on else "0")
        subprocess.run([sys.executable, __file__, str(OUT), tag, slug, str(seed), "1" if made_up else "0", "1" if coach else "0"], check=True, env=env)
        infos.append(json.loads((OUT / tag / "info.json").read_text(encoding="utf-8")))
        print("career", infos[-1], flush=True)
    # the small functions, and _staff_changes many ways, on a career of this process's own (Clear Mode as it is here)
    st = season.new_season("lsu", "full", seed=44, career=True)
    finished(st)
    off = offseason.start(st)
    off["auto"] = True
    made_up_year(st, random.Random("part3-unit-year"))
    while off["stage"] != "portal_recap":
        offseason.advance(st)
        off = st["offseason"]
    walk_on_class(st, random.Random("part3-unit-class"))
    write(OUT, "unit.state.json", slim(st))
    write(OUT, "unit.json", unit(st))
    offseason.advance(st)                       # development
    write(OUT, "variants.state.json", slim(st))
    write(OUT, "variants.json", staff_variants(st, {}, random.Random("part3-variants")))
    teams = season.load_teams()
    write(OUT, "setup.json", {"cases": infos, "constants": constants(), "clear": clear.on(), "names": {s: t["name"] for s, t in teams.items()},
                              "p4": {s: bool(season._is_p4(s, t)) for s, t in teams.items()},
                              "squares": [x ** 2 for x in (offseason.ERA_PERSIST, offseason.ERA_SD, offseason.TEAM_YEAR_SD, offseason.PLAYER_YEAR_SD)]})
    print("written", OUT)
