"""Python's answers for career_js/carousel.js: python3 career_js/test/carousel_reference.py OUTDIR, then
node career_js/test/carousel_compare.mjs OUTDIR.

Real careers (a faked finished season with a playoff and conference champions, the real offseason up to the
Development step, where the carousel runs; one of them a second season on its own league) and, from each, many
carousels: the career's seed changed, your meeting with the AD decided each way or not held, your security high
or low, your coordinators under contract. For each: carousel.run's record, every team's coaches, AD and style
after it, the market, and a round of the module's other functions on the state it left.

The modules the carousel asks that are not in JavaScript yet (programs, recruiting._baseline, offseason.expiring)
are recorded call by call (arguments and answer, in order) and replayed by the compare script; the season is the
JavaScript season there."""
import inspect
import json
import random
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from coach_career import carousel, offseason, programs, recruiting    # noqa: E402
from sim import season                                                  # noqa: E402

OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
SEEDS = (101, 202, 303, 404)


# ----- recording the modules that are not ported ----------------------------------------------------------------
class Rec:
    calls = None
    depth = 0
    state = None


def norm(a):
    """An argument as the compare script can check it: the state and a team by a mark, the rest as it is."""
    if a is Rec.state:
        return "<state>"
    if isinstance(a, dict) and ("coaches" in a or "roster" in a):
        return "<team>"
    return json.loads(json.dumps(a))


def wrap(mod, name, trim=None):
    orig = getattr(mod, name)
    sig = inspect.signature(orig)

    def f(*a, **kw):
        if Rec.calls is None or Rec.depth:
            return orig(*a, **kw)
        args = [norm(x) for x in sig.bind(*a, **kw).arguments.values()]      # before the call: it may change them
        Rec.depth += 1
        try:
            out = orig(*a, **kw)
        finally:
            Rec.depth -= 1
        Rec.calls.append([f"{mod.__name__.split('.')[-1]}.{name}", args, json.loads(json.dumps(trim(out) if trim else out))])
        return out
    setattr(mod, name, f)


for fn in ("goal_for", "attract", "z", "coach_level", "coach_ceiling", "update", "final_ranks", "nil_move"):
    wrap(programs, fn)
wrap(programs, "get", lambda p: {"tier": p["tier"], "rating": p["rating"]})       # all the carousel reads of a program
wrap(programs, "base", lambda p: {"tier": p["tier"]})
wrap(recruiting, "_baseline")
wrap(offseason, "expiring")


# ----- real careers ----------------------------------------------------------------------------------------------
def finished(st: dict) -> None:
    """Every game played (the better team usually wins), a playoff of twelve and each conference's champion,
    every school's class signed, season over (tests/test_offseason.py's, with the playoff added)."""
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


def to_development(st: dict) -> None:
    off = offseason.start(st)
    while off["stage"] != "development":
        offseason.advance(st)


def trimmed(st: dict) -> dict:
    """What the carousel reads of a career: everything small, the league's teams without their rosters."""
    keep = {k: v for k, v in st.items() if k not in ("recruiting", "recruiting_last", "offseason", "league", "my_boxes", "games")}
    keep["offseason"] = {k: st["offseason"][k] for k in ("year", "review") if k in st["offseason"]}
    lg = st["league"]
    keep["league"] = {k: v for k, v in lg.items() if k != "teams" and len(json.dumps(v)) < 400_000}
    keep["league"]["teams"] = {s: {k: t[k] for k in ("coaches", "ad", "style") if k in t} for s, t in lg["teams"].items()}
    return keep


def left(st: dict) -> dict:
    lg = st["league"]
    return {"teams": {s: {k: t[k] for k in ("coaches", "ad", "style") if k in t} for s, t in lg["teams"].items()}, "market": lg["market"]}


def put(st: dict, path: list, value) -> None:
    """One change to a state: the value at a path of keys, or "__del__" to take the key away."""
    d = st
    for k in path[:-1]:
        d = d[k]
    if value == "__del__":
        d.pop(path[-1], None)
    else:
        d[path[-1]] = json.loads(json.dumps(value))      # (its own copy: the carousel changes it)


def variants(st: dict, seed: int) -> list:
    me, year = st["team"], st["offseason"]["year"]
    ad = ["league", "teams", me, "ad"]
    staff = [["career", "staff", i, "contract_until", year + 2] for i, s in enumerate(st["career"].get("staff") or []) if s["role"] in ("OC", "DC")]
    seeded = [[["seed"], seed]]
    return [
        ("as-is", seeded),
        ("no-review", seeded + [[["offseason", "review"], "__del__"]]),
        ("fired", seeded + [[["offseason", "review", "fired"], True], [["offseason", "review", "security"], 4]]),
        ("wanted", seeded + [[["offseason", "review", "fired"], False], [["offseason", "review", "security"], 96]]),
        ("must-fire", seeded + [[["offseason", "review"], "__del__"], [ad, {"patience": 2, "security": 3}]]),
        ("at-risk", seeded + [[["offseason", "review"], "__del__"], [ad, {"patience": 3, "security": 30}],
                              [["league", "teams", me, "coaches", "head_coach", "since"], year - 6]]),
        ("contracts", seeded + [[["offseason", "review"], "__del__"]] + [[p[:-1], p[-1]] for p in staff]),
    ]


def extras(st: dict, res: dict) -> list:
    """The module's other functions on the state the carousel left, in the order the compare script calls them."""
    me, year = st["team"], st["offseason"]["year"]
    lgd = st["league"]
    out = []

    def add(label, value):
        out.append([label, json.loads(json.dumps(value))])
    add("_results", carousel._results(st))
    add("market_rows", carousel.market_rows(st))
    add("market_rows hc", carousel.market_rows(st, "head_coach"))
    add("status", carousel.status(st))
    slugs = list(dict.fromkeys(res["offers"] + res["openings"] + list(lgd["teams"])[:6]))
    add("job_rows", carousel.job_rows(st, slugs))
    for role in ("head_coach",) + carousel.COORD_ROLES:
        add(f"market_candidates {role}", [[s, e["id"]] for s, e in carousel.market_candidates(st, me, role, 5)])
    cands = carousel.market_candidates(st, me, "offensive_coordinator", 2, random.Random("take"), year)
    add("market_take", carousel.market_take(st, cands[0][1]["id"], "offensive_coordinator", me, year) if cands else None)
    try:
        carousel.market_take(st, "m-nobody", "head_coach", me, year)
        add("market_take gone", None)
    except ValueError as e:
        add("market_take gone", str(e))
    for role in carousel.COORD_ROLES:
        add(f"contract_holds {role}", carousel.contract_holds(st, role, year))
    some = list(lgd["teams"])[::9]
    add("goal", [carousel.goal(s, st) for s in some])
    add("goal bare", [carousel.goal(s) for s in some[:4]])
    add("attract", [carousel.attract(st, s) for s in some])
    add("baseline", [carousel.baseline(s) for s in some[:4]])
    other = some[3]
    add("market_add", carousel.market_add(st, lgd["teams"][other]["coaches"]["defensive_coordinator"], "defensive_coordinator", other,
                                         "Left to test the market", year))
    add("market_add roles", carousel.market_add(st, lgd["teams"][other]["coaches"]["head_coach"], "head_coach", other, "Stepped away", year,
                                               ["head_coach"]))
    add("_pick_coordinator", list(carousel._pick_coordinator(st, some[5], "offensive_coordinator", random.Random("pc"), year)))
    kept = lgd["market"]["coaches"]
    lgd["market"]["coaches"] = []                               # nobody for hire: a coach is generated
    add("_pick_coordinator generated", list(carousel._pick_coordinator(st, some[6], "defensive_coordinator", random.Random("pg"), year)))
    lgd["market"]["coaches"] = kept
    hire, src = carousel._pick_head_coach(st, some[7], {s: {"tenure": 3} for s in lgd["teams"]},
                                          carousel._results(st), {}, random.Random("ph"), year)
    add("_pick_head_coach", [hire, src])
    return out


def pure(st: dict) -> list:
    """The small functions, on the career before its carousel (the compare script calls them in this order)."""
    lgd, year, me = st["league"], st["offseason"]["year"], st["team"]
    out = []

    def add(label, value):
        out.append([label, json.loads(json.dumps(value))])
    add("mood", [carousel.mood(s) for s in range(0, 101)])
    add("_seasons", [carousel._seasons(n) for n in range(0, 4)])
    add("_why_generated", [[list(carousel._why_generated(s[1], True)), list(carousel._why_generated(s[1], False))] for s in carousel.SUPPLY])
    names = [t["coaches"]["head_coach"]["name"] for t in lgd["teams"].values()]
    add("hometown", [carousel.hometown(n) for n in names + [None, "Nobody At All"]])
    add("_rng", [carousel._rng(st, w).random() for w in ("run", "x")])
    add("_taken_names", sorted(carousel._taken_names(lgd)))
    ads = []
    for y in (year, None, year + 4):
        for slug, t in lgd["teams"].items():
            ads.append(carousel.ad({k: v for k, v in t.items() if k != "ad"}, slug, y))
    add("ad", ads)
    ages, ratings = [], []
    for t in lgd["teams"].values():
        for c in t["coaches"].values():
            if c:
                c2 = {k: v for k, v in c.items() if k != "age_at"}
                ages.append([carousel._age(c2, year), c2["age_at"], carousel._age(dict(c), year + 3)])
                ratings.append(carousel._rating(c))
    add("_age", ages)
    add("_rating", ratings + [carousel._rating({}), carousel._rating({"ratings": {"play_calling": 71, "recruiting": 44}})])
    res = carousel._results(st)
    add("judge", [carousel.judge(json.loads(json.dumps({k: t[k] for k in ("coaches", "ad") if k in t})), slug,
                                 res.get(slug, {"wins": 0, "losses": 0, "playoff": False, "conference": False}), year, st)
                  for slug, t in lgd["teams"].items()])
    slugs = list(lgd["teams"])
    add("new_style", [carousel.new_style(random.Random(f"ns{i}"), lgd, s) for i, s in enumerate(slugs[:40])])
    gen = []
    for i, s in enumerate(slugs[:30]):
        role = ("head_coach",) + carousel.COORD_ROLES
        gen.append(carousel.generated(random.Random(f"g{i}"), lgd, role[i % 3], s, year, like=lgd["teams"][s]["coaches"].get(role[i % 3]) if i % 2 else None,
                                      level=(i % 7) - 3.5))
    add("generated", gen)
    rf = []
    for i, s in enumerate(slugs[:30]):
        c = lgd["teams"][s]["coaches"]["offensive_coordinator"] or lgd["teams"][s]["coaches"]["head_coach"]
        rng = random.Random(f"rf{i}")
        rf.append([carousel._ratings_for(lgd, r, {"ratings": c["ratings"], "role": "offensive_coordinator"}, rng, i - 10.0)
                   for r in ("head_coach",) + carousel.COORD_ROLES])
    add("_ratings_for", rf)
    ent = []
    for i, s in enumerate(slugs[:30]):
        for role, c in lgd["teams"][s]["coaches"].items():
            if c and c.get("name"):
                e = carousel._entry(json.loads(json.dumps(c)), role, s if i % 3 else None, "Looking", year, [role], random.Random(f"e{i}{role}"))
                ent.append([e, carousel._previous_job(e), carousel._fired_why(s, res.get(s, {}))])
    add("_entry", ent)
    later = json.loads(json.dumps({"id": st["id"], "seed": st.get("seed"), "year": st.get("year"), "team": me,
                                   "offseason": {"year": year}, "league": {"teams": {s: {"coaches": t["coaches"]} for s, t in lgd["teams"].items()}}}))
    mk = carousel.market(later)                       # a market built when first asked
    add("market", mk)
    for e in mk["coaches"][:40]:                      # ... then two years on: the old leave, the supply is topped up
        e["year"] -= 1
    later["offseason"]["year"] = year + 2
    carousel.market_refresh(later)
    add("market_refresh", later["league"]["market"])
    return out


def cases(name: str, st: dict) -> None:
    """One career at its Development step: the files the compare script reads."""
    text = json.dumps(st)
    path = Path(str(season._league_path))
    league_file = None
    if path.resolve() != Path(str(season.TEAMS_FILE)).resolve():
        league_file = f"{name}_league.json"
        shutil.copyfile(path, OUT / league_file)
    base = json.loads(text)
    (OUT / f"{name}_games.json").write_text(json.dumps({"games": base["games"]}))
    Rec.state, Rec.calls = base, []
    programs.init(base["league"])
    small = pure(base)
    (OUT / f"{name}_base.json").write_text(json.dumps({"state": trimmed(json.loads(text)), "league_file": league_file,
                                                       "pure": small, "calls": Rec.calls}))
    Rec.calls = None
    n = 0
    for seed in SEEDS:
        for label, changes in variants(base, seed):
            st2 = json.loads(text)
            for path_, value in changes:
                put(st2, path_, value)
            Rec.state, Rec.calls = st2, []
            res = carousel.run(st2)
            after = left(json.loads(json.dumps(st2)))
            more = extras(st2, res)
            (OUT / f"{name}_case_{n:02d}.json").write_text(json.dumps({
                "label": f"{name} seed {seed} {label}", "changes": changes, "result": res, "after": after, "extras": more, "calls": Rec.calls}))
            Rec.calls = None
            print(f"{name} seed {seed} {label}: {len(res['changes'])} changes, offers {res['offers']}, openings {len(res['openings'])}, "
                  f"poached {res['poached']}, declined {res['declined']}", flush=True)
            n += 1


if __name__ == "__main__":
    season.SEASONS_DIR = Path(tempfile.mkdtemp(prefix="cfp-carousel-ref-"))
    names = []
    for name, team, seed, seasons in (("osu", "ohio-state", 5, 2), ("toledo", "toledo", 7, 1)):
        st = season.new_season(team, "full", seed=seed, career=True)
        finished(st)
        to_development(st)
        cases(f"{name}1", st)
        names.append(f"{name}1")
        if seasons > 1:                                # on to a second season, on the career's own league
            while st["offseason"]["stage"] != "ready":
                offseason.advance(st)
            st = offseason.next_season(st)
            finished(st)
            to_development(st)
            cases(f"{name}2", st)
            names.append(f"{name}2")
    from coach_career import clear, league
    (OUT / "setup.json").write_text(json.dumps({
        "careers": names, "clear": clear.on(), "OFFENSE_ROLES": sorted(league.OFFENSE_ROLES), "TEAM_FIT": league.TEAM_FIT, "GROUP_OF": league.GROUP_OF,
        "INDEPENDENTS": sorted(programs.INDEPENDENTS), "STAFF_ROLES": offseason.STAFF_ROLES, "UNDER_CONTRACT": offseason.UNDER_CONTRACT}))
    print("wrote", OUT)
