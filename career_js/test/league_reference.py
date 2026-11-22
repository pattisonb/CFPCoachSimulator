"""coach_career/league.py's answers on the real data, for league_compare.mjs to hold career_js/league.js to:
python3 career_js/test/league_reference.py OUT   (then: node career_js/test/league_compare.mjs OUT)

What it writes: the base league computed from the 146 source files (every real player through compact), every
team's identity, the development reads, three leagues (the base one, an aged one, one made like a league file's) with
every team of each in the source format (expand, lineup, team_ratings, source_team), the base files written and read
back, and a career's cached teams files (ensure_built, forget) with build_teams.build replaced by a small digest.
build_teams is not part of this port: what measured_recruiting did to the coaches is recorded for the compare to replay."""
import copy, json, os, random, shutil, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("CFP_CLEAR", "0")
out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)

from coach_career import league
from teamdata import build_teams, game_scale


def write(name, data):
    (out / name).write_text(json.dumps(data), encoding="utf-8")


# ----- build_teams' two functions the league calls: one recorded, one a digest (the same digest in the compare) -----
measured = {}
_measured = build_teams.measured_recruiting


def measured_recruiting(teams):
    n = _measured(teams)
    for t in teams:
        measured[t["slug"]] = copy.deepcopy(t["coaches"])
    return n


def build_digest(sources, real=True, observed=None, quiet=False, styles=None):
    return {"teams": {s["slug"]: {"n": len(s.get("roster") or []), "qb": ((s.get("starters") or {}).get("offense") or {}).get("QB"),
                                  "ratings": s.get("team_ratings")} for s in sources},
            "real": real, "observed": observed, "quiet": quiet, "styles": styles}


build_teams.measured_recruiting = measured_recruiting
build_teams.build = build_digest

# ----- identities -----
slugs = list(league.base_slugs())
write("meta.json", {"source_slugs": list(league._source_slugs()), "base_slugs": slugs,
                    "base_meta": {s: league.base_meta(s) for s in slugs},
                    "path": [str(league.path("abc123", 2031).relative_to(ROOT)).replace(os.sep, "/")]})

# ----- the base league, computed from the source files -----
base = league.from_base(2027)
write("measured.json", measured)
write("base.json", base)
other = league.from_base(2030)
write("base_year.json", {"year": other["year"], "overall_v": other["overall_v"], "n": len(other["teams"]),
                         "program_years": sorted({t["program"]["year"] for t in other["teams"].values()})})
write("development.json", {"of": league._development_of(base), "base": {k: list(v) for k, v in league.base_development().items()}})

# ----- small functions on many inputs -----
attrs = base["attrs"]
heights = [72, 0, 6.0, 72.5, None, True, "6'2\"", "6'2", "5'11\"", "6'", "'4", "6' 2\"", " 6 ' 2 ", "6'2'1", "six'two", "6'2.5", "6-2", "", "6'-1",
           "+6'+3", "1_0'1", "6'_1", "74", [6, 2], {"ft": 6}]
rng = random.Random("league-reference")
players = [(slug, c) for slug, t in base["teams"].items() for c in t["roster"]]
some = rng.sample(players, 400)
small = {"height_in": [[h, league.height_in(h)] for h in heights],
         "ratings": [[c, league.ratings(c, attrs), league.potential(c, attrs), league.overall(c, attrs)] for _, c in some[:150]],
         "expand": [[c, slug, league.expand(c, attrs, league.base_meta(slug))] for slug, c in some[:150]]}
# compact on players who carry our ratings already (signees, walk-ons), with what a caller may leave out
made = []
for i, (slug, c) in enumerate(some):
    ours = league.ratings(c, attrs)
    p = {"slug": f"made-{i}", "name": c["n"], "position": c["pos"], "ours": ours}
    if i % 2:
        p["potential_ours"] = league.potential(c, attrs)
    if i % 3 == 0:
        p["class"] = c["cls"]
    if i % 4 == 0:
        p["yrs"] = [3, "2", 1.9, 0][(i // 4) % 4]
    if i % 5 == 0:
        p["height"] = ["6'1\"", 75, "5'9", None][(i // 5) % 4]
    if i % 6 == 0:
        p["hometown"] = [{"state": "TX", "city": "Austin"}, {}, None, {"state": None}][(i // 6) % 4]
    if i % 7 == 0:
        p["abilities"] = [[{"name": "Workhorse", "tier": "Gold"}, {"name": "Shifty"}], [{"tier": 2}], []][(i // 7) % 3]
    if i % 8 == 0:
        p["target_mult"] = [1.25, 0, None, 0.731][(i // 8) % 4]
    if i % 9 == 0:
        p.update(coachability=["Gym Rat", None, ""][(i // 9) % 3], stars=[4, 0, None][(i // 9) % 3], dev_trait=["Star", None][(i // 9) % 2],
                 weight_lbs=205, jersey=12, archetype="Scrambler")
    if i % 10 == 0:
        p["ours"] = {k: v for k, v in ours.items() if rng.random() < 0.8}        # skills left out read as 50
        p["potential_ours"] = {} if i % 20 == 0 else {k: v + rng.randint(-2, 9) for k, v in ours.items() if rng.random() < 0.9}
    home = [None, "OH", "CA"][i % 3]
    made.append([p, home, league.compact(copy.deepcopy(p), attrs, home)])
small["compact"] = made
small["formation"] = [[s, league.formation(league.base_team(s))] for s in slugs[::9]]
write("small.json", small)


# ----- three leagues, every team of each in the source format -----
def aged(lgd, year, seed):
    """A later season's league made from the base one: players gone, a year older, ratings moved, new ones signed,
    lineups reshaped, styles and conferences changed (what the offseason does, by hand)."""
    r = random.Random(seed)
    lg = copy.deepcopy(lgd)
    lg["year"] = year
    order = list(league.CLASSES)
    for slug, t in lg["teams"].items():
        keep = []
        for c in t["roster"]:
            if r.random() < 0.18:
                continue
            c["cls"] = order[min(len(order) - 1, order.index(c["cls"]) + r.choice((1, 2)))] if c["cls"] in order else c["cls"]
            c["r"] = [max(1, min(99, v + r.choice((-1, 0, 0, 1, 2, 3)))) for v in c["r"]]
            c["yrs"] = (c.get("yrs") or 0) + 1
            if r.random() < 0.5:
                c.pop("tm", None)
            keep.append(c)
        for i in range(r.randint(8, 22)):
            like = r.choice(t["roster"])
            p = {"slug": f"{slug}-new-{year}-{i}", "name": f"New {like['n']}", "position": like["pos"], "class": r.choice(("FR", "FRRS", "SO")),
                 "ours": {k: max(1, v - r.randint(0, 12)) for k, v in zip(attrs, like["r"])}, "height": like.get("ht"), "weight_lbs": like.get("wt")}
            p["potential_ours"] = {k: min(99, v + r.randint(0, 15)) for k, v in p["ours"].items()}
            keep.append(league.compact(p, attrs, "TX"))
        t["roster"] = keep
        if r.random() < 0.3:
            t["formation"]["defense"]["LB"] = r.choice((2, 3, 4))
        if r.random() < 0.2:
            t["formation"]["offense"]["WR"] = r.choice((2, 3, 4, 5))
        if r.random() < 0.15:
            t["style"] = r.choice(list(lgd["teams"]))
    moves = r.sample(sorted(lg["teams"]), 6)
    lg["conference_moves"] = {s: r.choice(("SEC", "Big Ten", "Sun Belt", league.base_meta(s)["conference"])) for s in moves}
    return lg


def imported(lgd, year, seed):
    """A league as a league file makes one: a source, teams gone, new teams with their own identity, depth charts
    the file asked for (unknown players, repeats and players out of position among them), and thin rosters."""
    r = random.Random(seed)
    lg = aged(lgd, year, seed + "-aged")
    lg["source"] = {"name": "A League File", "teams": 3}
    names = sorted(lg["teams"])
    gone = r.sample(names, 4)
    for i, s in enumerate(gone):
        t = lg["teams"].pop(s)
        if i < 2:        # two come back as teams the game does not know
            meta = dict(league.base_meta(s), slug=f"new-team-{i}", name=f"New Team {i}", short_name=f"NT{i}", conference="Big 12")
            lg["teams"][f"new-team-{i}"] = dict(t, meta=meta, style=s)
    for s in r.sample(sorted(lg["teams"]), 30):
        t = lg["teams"][s]
        ids = [c["id"] for c in t["roster"]]
        depth = {}
        for role in r.sample(("QB", "HB", "WR", "TE", "LT", "C", "LEDG", "DT", "MIKE", "SAM", "LB", "CB", "FS", "K", "P"), 6):
            pool = [c["id"] for c in t["roster"] if c["pos"] == role] + r.sample(ids, 2) + ["no-such-player"]
            r.shuffle(pool)
            depth[role] = None if r.random() < 0.1 else (pool + pool[:1])[:r.randint(0, 5)]
        t["depth"] = depth
    thin = r.sample(sorted(lg["teams"]), 8)
    for s, cut in zip(thin, ("K", "P", "QB", "MIKE", "LT", "CB", "WR", "HB")):
        t = lg["teams"][s]
        t["roster"] = [c for c in t["roster"] if c["pos"] != cut]
    for s in thin[:2]:                       # and no kicker or punter at all
        lg["teams"][s]["roster"] = [c for c in lg["teams"][s]["roster"] if c["pos"] not in ("K", "P")]
    lg["teams"][thin[7]]["roster"] = lg["teams"][thin[7]]["roster"][:9]      # nine players
    return lg


leagues = {"base": base, "aged": aged(base, 2028, "aged"), "imported": imported(base, 2031, "imported")}
for name, lg in leagues.items():
    write(f"league_{name}.json", lg)
    r = random.Random(f"mine-{name}")
    mine = r.sample(sorted(lg["teams"]), 20)
    ans = {"is_imported": league.is_imported(lg), "league_slugs": list(league.league_slugs(lg)),
           "team_meta": {s: league.team_meta(lg, s) for s in league.league_slugs(lg)},
           "source_team": {s: league.source_team(lg, s) for s in lg["teams"]},
           "by_overall": {s: league.source_team(lg, s, True) for s in mine},
           "source_teams": [[t["slug"], t.get("roster_size"), len(t["roster"]), t["starters"]] for t in league.source_teams(lg, mine[0])],
           "me": mine[0], "build": league.build(lg, mine[1])}
    write(f"answers_{name}.json", ans)
write("is_imported.json", [[v, league.is_imported(v)] for v in (None, {}, {"source": {}}, {"source": None}, {"source": {"a": 1}}, {"source": "x"})])

# ----- a career's cached teams files -----
league.CACHE_DIR = out / "cache_py"
shutil.rmtree(league.CACHE_DIR, ignore_errors=True)
league.CACHE_DIR.mkdir(parents=True)
for n in ("aaa-2026.json", "aaa-2027.json", "aaa-b-2026.json", "aaa-2029.json", "aaab-2026.json", "aaa-2026.txt", "bbb-2027.json"):
    (league.CACHE_DIR / n).write_text("{}")
listing = lambda: sorted(p.name for p in league.CACHE_DIR.iterdir())
rel = lambda p: None if p is None else p.name
steps = []
for state in ({"id": "aaa", "year": 2026, "league": None}, {"id": "aaa", "year": 2026, "league": leagues["base"]},
              {"id": "aaa", "league": leagues["aged"]},
              {"id": "ccc", "year": 2026, "team": "ohio-state", "league": leagues["imported"]},
              {"id": "aaa", "year": 2028, "team": "ohio-state", "league": leagues["aged"]},
              {"id": "aaa", "year": 2028, "team": "texas", "league": leagues["aged"]},          # there already: left as it is
              {"id": "bbb", "year": 2031, "team": sorted(leagues["imported"]["teams"])[5], "league": leagues["imported"]}):
    got = league.ensure_built(state)
    steps.append({"state": {k: (v if k != "league" else (None if v is None else [n for n, lg in leagues.items() if lg is v][0])) for k, v in state.items()},
                  "path": rel(got), "files": listing(), "text": None if got is None else json.loads(got.read_text())})
league.forget("aaa")
after = [listing()]
league.forget("nobody")
after.append(listing())
write("cache.json", {"steps": steps, "after_forget": after})

# ----- the base files: written from the source files, then read back -----
base_dir = out / "base_py"
shutil.rmtree(base_dir, ignore_errors=True)
league.BASE_LEAGUE_FILE, league.BASE_META_FILE = base_dir / "base_league.json", base_dir / "base_meta.json"
league.write_base_files()
for f in (league.base_meta, league.base_slugs, league._meta_file, league.base_development):
    f.cache_clear()
again = league.from_base(2029)
write("base_files.json", {"base_slugs": list(league.base_slugs()), "base_meta": {s: league.base_meta(s) for s in slugs[::5]},
                          "from_base": again, "development": {k: list(v) for k, v in league.base_development().items()},
                          "league_slugs": list(league.league_slugs(again))})
shutil.copy(base_dir / "base_development.json", out / "base_development_written.json")
(base_dir / "base_development.json").unlink()           # without the ready file: worked out from the league file
league.base_development.cache_clear()
write("base_files_2.json", {"development": {k: list(v) for k, v in league.base_development().items()}})
print("written", sorted(p.name for p in out.iterdir()))
