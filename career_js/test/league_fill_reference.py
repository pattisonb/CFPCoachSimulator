"""Python's answers for career_js/league_fill.js (the port is held to them exactly):
    python3 career_js/test/league_fill_reference.py OUTDIR && node career_js/test/league_fill_compare.mjs OUTDIR

Writes into OUTDIR:
  constants.json    the constants and tables of the modules league_fill asks that the compare script stands in for
                    (league, league_file, offseason, programs, carousel), and the built-in league's two years
  scenarios.jsonl   one call of a league_fill function a line: {"name", "fn", "args", "result", "after", "tape"}.
                    "tape": every call the function made into those modules, in order, with its arguments and its
                    answer (and, for carousel.generated, the generator's state before and after), which the compare
                    script replays, checking the JavaScript asks the same things in the same order.
                    {"$rng": seed} is a random.Random(seed), {"$set": [...]} a set."""
import copy
import hashlib
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from coach_career import carousel, league, league_file, league_fill as lf, offseason, programs, recruits   # noqa: E402
from teamdata import game_scale                                                                            # noqa: E402

OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
ATTRS = game_scale.keys()

# ---- the tape ---------------------------------------------------------------------------------------------------------
TAPE = None
DEPTH = 0


def snap(v):
    return json.loads(json.dumps(v))


def rng_state(rng):
    s = rng.getstate()
    return {"mt": list(s[1][:624]), "index": s[1][624], "gauss": s[2]}


def roster_digest(roster):
    text = "\n".join(f"{c['id']}|{c['n']}|{c['pos']}|{c['cls']}|{c['o']}|{','.join(map(str, c['r']))}|{','.join(map(str, c['g']))}" for c in roster)
    return hashlib.sha256(text.encode()).hexdigest()


def taped(mod, modname, name, describe, result=snap, rng_at=None):
    real = getattr(mod, name)

    def f(*a, **k):
        global DEPTH
        if DEPTH or TAPE is None:
            return real(*a, **k)
        entry = {"fn": f"{modname}.{name}", "args": snap(describe(*a, **k))}
        if rng_at is not None:
            entry["rng_before"] = rng_state(a[rng_at])
        DEPTH += 1
        try:
            out = real(*a, **k)
        finally:
            DEPTH -= 1
        if rng_at is not None:
            entry["rng_after"] = rng_state(a[rng_at])
        entry["result"] = result(out)
        TAPE.append(entry)
        return out

    setattr(mod, name, f)


def describe_source_team(lgd, slug, by_overall=False):
    if len(lgd["teams"]) > 1:
        return {"slug": slug, "base": lgd["year"]}
    t = lgd["teams"][slug]
    return {"slug": slug, "year": lgd["year"], "attrs": len(lgd["attrs"]), "digest": roster_digest(t["roster"]), "players": len(t["roster"]),
            "coaches": t["coaches"], "formation": t["formation"], "meta": t["meta"]}


taped(league, "league", "source_team", describe_source_team, result=lambda out: out["team_ratings"]["overall"])
taped(league, "league", "compact", lambda p, attrs, home=None: [p, len(attrs), home])
taped(league_file, "league_file", "player_compact", lambda p, attrs: [p, len(attrs)])
taped(league_file, "league_file", "engine_name", lambda merged, cid: [cid])
taped(league_file, "league_file", "schedule_rules", lambda merged: [])
taped(league_file, "league_file", "divisions", lambda merged: [])
taped(league_file, "league_file", "conference_names", lambda merged: [])
taped(programs, "programs", "mix", lambda p: [p])
taped(programs, "programs", "tier_of", lambda rating: [rating])
taped(programs, "programs", "empty_drafts", lambda year: [year])
taped(carousel, "carousel", "generated", lambda rng, lgd, role, slug, year, like=None, level=0.0: [role, slug, year, like, level], rng_at=0)
taped(carousel, "carousel", "_taken_names", lambda lgd: [], result=lambda out: sorted(out))



def silent(mod, name):
    """A function the compare script answers from constants.json: what it asks inside itself stays off the tape."""
    real = getattr(mod, name)

    def f(*a, **k):
        global DEPTH
        DEPTH += 1
        try:
            return real(*a, **k)
        finally:
            DEPTH -= 1

    setattr(mod, name, f)


for _mod, _name in ((league, "from_base"), (league, "base_meta"), (league, "base_slugs"), (league_file, "_builtin_docs")):
    silent(_mod, _name)

BASE = {str(y): league.from_base(y) for y in (league.FIRST_YEAR, league.FIRST_YEAR + 1)}
DOCS = league_file._builtin_docs()
(OUT / "constants.json").write_text(json.dumps({
    "attrs": ATTRS,
    "league": {"FIRST_YEAR": league.FIRST_YEAR, "TEAM_FIT": league.TEAM_FIT, "EXPERIENCE": league.EXPERIENCE},
    "league_file": {"POS_IN": league_file.POS_IN, "_FILE_POS": league_file._FILE_POS, "YEAR": league_file.YEAR,
                    "FORMAT": league_file.FORMAT, "_COACH_ROLES": league_file._COACH_ROLES},
    "offseason": {"GROUP": offseason.GROUP, "FLOOR": offseason.FLOOR, "TARGET": offseason.TARGET},
    "programs": {"BASE_DEFAULT": programs.BASE_DEFAULT, "MARKET_DEFAULT": programs.MARKET_DEFAULT},
    "base_slugs": list(league.base_slugs()), "base_meta": {s: league.base_meta(s) for s in league.base_slugs()},
    "from_base": BASE, "builtin_docs": DOCS}), encoding="utf-8")

# ---- scenarios --------------------------------------------------------------------------------------------------------
lines_out = (OUT / "scenarios.jsonl").open("w", encoding="utf-8")
COUNT = {}


class Rng:
    def __init__(self, seed):
        self.seed = seed


class Base:
    """The built-in league of a year (league.from_base), handed over as it is: named in the file, not written out."""
    def __init__(self, year):
        self.year = str(year)


class Merged:
    """A merged league file; its teams that are the built-in ones are named in the file, not written out."""
    def __init__(self, merged):
        self.merged = merged


def build(a):
    if isinstance(a, Rng):
        return random.Random(a.seed)
    if isinstance(a, Base):
        return BASE[a.year]
    if isinstance(a, Merged):
        return copy.deepcopy(a.merged)
    return copy.deepcopy(a)


def enc(a):
    if isinstance(a, Rng):
        return {"$rng": a.seed}
    if isinstance(a, Base):
        return {"$base": a.year}
    if isinstance(a, Merged):
        m = dict(a.merged)
        m["teams"] = {s: ("$same" if s in DOCS and t == DOCS[s] else t) for s, t in m["teams"].items()}
        return {"$merged": m}
    if isinstance(a, (set, frozenset)):
        return {"$set": sorted(a)}
    if isinstance(a, random.Random):
        return {"$rngstate": rng_state(a)}
    if isinstance(a, tuple):
        return [enc(x) for x in a]
    return a


def slim_league(lgd):
    """A league with the teams the fill left as the built-in league has them named, not written out."""
    base = BASE[str(lgd["year"])]["teams"]
    out = dict(lgd)
    out["teams"] = {s: ("$same" if s in base and json.dumps(t) == json.dumps(base[s]) else t) for s, t in lgd["teams"].items()}
    return out


def scenario(name, fn, *args, breaking=None):
    global TAPE
    real_args = [build(a) for a in args]
    row = {"name": name, "fn": fn, "args": [enc(a) for a in args], "breaking": breaking}
    TAPE = []
    was = lf.fill_roster
    if breaking == "fill_roster":
        def boom(*a, **k):
            raise RuntimeError("boom")
        lf.fill_roster = boom
    try:
        out = getattr(lf, fn)(*real_args)
        if fn == "to_league":
            out = (slim_league(out[0]), out[1])
        row["result"] = snap(enc(out))
    except lf.TeamBuildError as e:
        row["error"] = {"slug": e.slug, "label": e.label, "message": str(e)}
    finally:
        lf.fill_roster = was
    row["tape"], TAPE = TAPE, None
    row["after"] = snap([enc(a) if isinstance(a, (Base, Merged)) else enc(r) for a, r in zip(args, real_args)])
    lines_out.write(json.dumps(row) + "\n")
    COUNT[fn] = COUNT.get(fn, 0) + 1
    return row.get("result")


rnd = random.Random("league-fill-reference")

# the caches first, with their calls on the tape (Python keeps one answer of each; so does the JavaScript)
lf._base_tables.cache_clear()
lf.base_strengths.cache_clear()
lf._base_league.cache_clear()
scenario("the built-in tables", "_base_tables")
scenario("the built-in strengths", "base_strengths")
scenario("the built-in league", "_base_league")
STR = lf.base_strengths()
row = {"name": "STATE_CENTER", "fn": "$STATE_CENTER", "args": [], "result": snap(lf.STATE_CENTER), "tape": [], "after": []}
lines_out.write(json.dumps(row) + "\n")
scenario("the states' centers", "_state_center")

# ---- the small functions
vals = list(STR.values())
for g in [0, 1, 20, 50, 63, 75, 95, 99, 100, 120, -5, 33.3, 99.9] + [rnd.uniform(0, 100) for _ in range(80)]:
    scenario("percentile", "_percentile", vals, g)
for n in (2, 3, 7):
    scenario("percentile of a few", "_percentile", [rnd.uniform(40, 90) for _ in range(n)], rnd.uniform(0, 100))
b = league_file._builtin()
CONFS = {}
for s, c in b["team_conf"].items():
    CONFS.setdefault(c, {"id": c, "name": b["conf_names"][c], "level": "FBS", "games": 8, "members": []})["members"].append(s)
NEW_CONF = {"id": "big-sky-east", "name": "Big Sky East", "level": "FBS", "games": 8, "members": ["alder-tech"]}
ALL_CONFS = list(CONFS.values()) + [NEW_CONF, {}, None, {"members": None}]
for conf in ALL_CONFS:
    for grade in (None, "Elite", "Strong", "Average", "Weak", 63, 0, 100, 41.5):
        scenario("strength target", "strength_target", {} if grade is None else {"strength": grade}, conf, STR)
for t in [30.0, 44.4, 50.0, 55.5, 61.7, 70.0, 82.25, 95.0] + [rnd.uniform(35, 90) for _ in range(40)]:
    scenario("starter level", "starter_level", t)
for name in ["Jay Smith", "  D'Andre O'Neil Jr. ", "ÉMILE Zola", "---", "", "Ty   West III", 12, "a.b_c", "Straße Ünïcode", "İstanbul"]:
    scenario("slugify", "_slugify", name)
for base_id, taken in [("a-b", set()), ("a-b", {"a-b"}), ("a-b", {"a-b", "a-b-2", "a-b-3"}), ("x", {"x-2"})]:
    scenario("unique id", "_unique_id", base_id, taken)
F = {"offense": {"QB": 1, "HB": 1, "WR": 3, "TE": 1, "LT": 1, "LG": 1, "C": 1, "RG": 1, "RT": 1},
     "defense": {"LEDG": 1, "REDG": 1, "DT": 2, "LB": 2, "CB": 3, "FS": 1, "SS": 1},
     "special_teams": {"K": 1, "P": 1, "KR": 1, "PR": 1}}
F_FB = {"offense": {"QB": 1, "HB": 1, "FB": 1, "WR": 2, "TE": 1, "LT": 1, "LG": 1, "C": 1, "RG": 1, "RT": 1},
        "defense": {"LEDG": 1, "REDG": 1, "DT": 1, "LB": 3, "CB": 3, "FS": 1, "SS": 1}, "special_teams": {"K": 1, "P": 1}}
F_ODD = {"offense": {"QB": 1, "WR": 5}, "defense": {"LB": 1, "CB": 2}, "special_teams": None}
FORMS = [F, F_FB, F_ODD, {}, {"offense": None, "defense": {"LB": 0}}] + [t["formation"] for t in list(BASE["2026"]["teams"].values())[:25]]
for fm in FORMS:
    scenario("group positions", "_group_positions", fm)
    for pos in list(offseason.GROUP) + ["KR", "LB", "ZZ"]:
        scenario("starters at", "_starters_at", fm, pos)
for p in [{}, {"hometown": "Bend, OR"}, {"hometown": "OR"}, {"hometown": "Bend, Oregon"}, {"hometown": "  "}, {"hometown": "Paris, FR "},
          {"hometown": 5}, {"hometown": "A, B, tx"}, {"hometown": "Bend, O1"}, {"hometown": None}, {"hometown": "X, ÉÉ"}]:
    for st in ("WA", None):
        scenario("home", "_home", p, st)
scenario("default formation", "_default_formation")
for n in list(range(-1, 61)) + [85, 100, 137]:
    scenario("class order", "_class_order", n)
for x in [-10, 0, 24.5, 25, 25.5, 26.5, 59.5, 60.5, 94.49, 94.5, 95, 95.5, 200] + [rnd.uniform(20, 100) for _ in range(40)]:
    scenario("clamp overall", "_clamp_overall", x)
for name in ["Alder Tech", "University of Notre Dame du Lac", "a", "", "!!!", "Texas A&M", "one two three four five six", "é è", "x9 y"]:
    scenario("initials", "_initials", name)
for words in [[], [None, ""], ["a"], ["b", "a", "b", "a"], ["Spread", "Air Raid", "Spread", None, "Air Raid", "Pro"], ["z", "y", "x"]]:
    scenario("common", "_common", words)
for v in [[], [1, 2, 3, 4], [1, None, "x", True, 2.5], [True, False], [3]]:
    scenario("median", "_median", v)
    scenario("median or", "_median", v, 7.5)
tms = recruits.model()["teams"]
some = [tms[s] for s in sorted(tms)[:40]]
for key in ("star_share", "positions_per_class", "distance_miles"):
    for zero in (False, True):
        scenario("tree median", "_tree_median", [r.get(key) or {} for r in some], zero)
        scenario("tree median of few", "_tree_median", [r.get(key) for r in some[:3]] + [None, 4], zero)
scenario("tree median, number-like keys", "_tree_median", [{"10": 1, "9": 2, "b": 3}, {"9": 5, "100": 1, "a": 2}], True)
scenario("tree median of class sizes", "_tree_median", [(r.get("class_size") or {}).get("by_year") or {} for r in some])
towns = recruits.model()["generation"]["towns"]
for st, rows in list(towns.items())[:30]:
    for row in rows[:3]:
        scenario("town", "_town", row[0], st)
        scenario("town, other case", "_town", f"  {str(row[0]).upper()} ", st)
for city, st in [("Bend", "OR"), ("Nowhere Junction", "OR"), ("", "OR"), (None, "OR"), ("Bend", None), ("Bend", "ZZ"), (5, "OR"), ("el paso", "TX")]:
    scenario("town", "_town", city, st)
MEMBERS = [tms[s] for s in sorted(tms)[:12]]
for team in [{"lat": 44.05, "lon": -121.31}, {"lat": 44, "lon": None, "city": "Bend", "state": "OR"}, {"city": "Nowhere", "state": "OR"},
             {"state": "ZZ"}, {}, {"lat": True, "lon": 3}, {"city": "Austin", "state": "TX"}, {"state": None}]:
    scenario("location", "_location", team, MEMBERS)
    scenario("location, no members", "_location", team, [])
    scenario("location, members without one", "_location", team, [{"location": None}, {}])
for c, rating in [({"ratings": {"overall": 60, "offense": 70, "defense": 98, "x": 2}}, 75), ({"ratings": {"overall": 60, "offense": 70}}, 12.5),
                  ({"ratings": {"overall": 80, "a": 1}}, 60.5), ({"ratings": {"overall": 50}}, 99)]:
    row = {"name": "set rating", "fn": "$_set_rating", "args": [copy.deepcopy(c), rating], "tape": [], "after": []}
    lf._set_rating(c, rating)
    row["result"] = c
    lines_out.write(json.dumps(row) + "\n")
blobs = ["", "abc", json.dumps({"format": "cfp-league/1", "teams": []}), "x" * 55, "x" * 56, "x" * 63, "x" * 64, "x" * 119, "é" * 1000, "league " * 5000]
for blob in blobs:
    row = {"name": "league seed", "fn": "$league_seed", "args": [blob, None], "result": lf.league_seed(blob.encode("utf-8"), None), "tape": [], "after": []}
    lines_out.write(json.dumps(row) + "\n")
for seed in (0, 7, 3.9, "12", True):
    row = {"name": "league seed given", "fn": "$league_seed", "args": ["abc", seed], "result": lf.league_seed(b"abc", seed), "tape": [], "after": []}
    lines_out.write(json.dumps(row) + "\n")

# fit_overall: real players' ratings moved to other overalls, every key or a few
players = [(c, t) for t in BASE["2027"]["teams"].values() for c in t["roster"]]
for c, _ in rnd.sample(players, 700):
    ours = dict(zip(ATTRS, c["r"]))
    pos = c["pos"]
    have = game_scale.overall(ours, pos)
    for target in {have, max(1, have - rnd.randint(1, 30)), min(99, have + rnd.randint(1, 30)), rnd.choice([1, 25, 99])}:
        keys = ATTRS if rnd.random() < 0.6 else rnd.sample(ATTRS, rnd.randint(0, 12)) + (["no_such"] if rnd.random() < 0.2 else [])
        scenario("fit overall", "fit_overall", ours, pos, target, keys)
flat = {k: 50 for k in ATTRS}
for pos in list(offseason.GROUP) + ["RB", "OL", "ZZ"]:
    for target in (30, 50, 77):
        scenario("fit overall, flat", "fit_overall", flat, pos, target, ATTRS)
for c, _ in rnd.sample(players, 60):
    ours = dict(zip(ATTRS, c["r"]))
    room = {k: rnd.randint(0, 12) for k in ATTRS}
    gpot = {k: rnd.randint(40, 99) for k in rnd.sample(ATTRS, rnd.randint(0, 6))}
    scenario("with ratings", "_with_ratings", c, ours, room, gpot, ATTRS)
SIZES = lf._base_tables()[1]
for c, _ in rnd.sample(players, 40):
    ours = dict(zip(ATTRS, c["r"]))
    room = {k: rnd.randint(0, 12) for k in ATTRS}
    p = rnd.choice([{}, {"name": "Max Lee", "height": 75, "weight": 201, "jersey": 7, "archetype": "Deep Threat", "dev": "Star", "stars": 4, "years": 2,
                         "abilities": [{"name": "Takeoff", "tier": "Gold"}], "target_share": 1.4, "hometown": "Bend, OR",
                         "potential": {k: rnd.randint(40, 99) for k in rnd.sample(ATTRS, 5)}},
                    {"name": "Al Cruz", "potential": {}, "hometown": "nowhere"}])
    scenario("compact", "_compact", p, "alder-tech-x", c["pos"], c["cls"], ours, room, "Field General", "Quick Study", ATTRS, SIZES, rnd.choice(["OR", None]))

# ---- a new team's parts
ALDER = {"slug": "alder-tech", "name": "Alder Tech", "short_name": "Alder Tech", "abbreviation": "ATU", "mascot": "Owls",
         "city": "Bend", "state": "OR", "lat": 44.05, "lon": -121.31, "conference": "big-sky-east",
         "colors": {"primary": {"name": "Green", "hex": "#0B6E4F"}, "secondary": {"name": "White", "hex": "#FFFFFF"}},
         "strength": "Average", "prestige": 40, "rivals": ["oregon-state"],
         "coaches": {"head": {"name": "Pat Doe", "rating": 60}, "oc": {"name": "Sam Roe"}, "offense": "Air Raid"},
         "roster": [{"name": "Jay Smith", "pos": "QB", "class": "JR"}, {"name": "Max Lee", "pos": "WR", "class": "SO"}],
         "depth_chart": {"QB": ["Jay Smith"]}}
OWL = {"slug": "owl-state", "name": "  Owl State ", "state": "OR", "conference": "mountain-west"}
TEAMS = [ALDER, OWL,
         {"slug": "x-u", "name": "X", "colors": {"primary": None, "secondary": {}, "accent": {"name": "Red", "hex": "#FF0000"}},
          "stadium": {"name": "The Pit", "capacity": None, "city": "Bend"}, "home_field": 71, "prestige": 0, "roster": [{}] * 3},
         {"slug": "y-u", "name": "The University of Y at Z", "prestige": 100, "stadium": {}, "colors": "green", "mascot": "", "abbreviation": ""}]
for team in TEAMS:
    for conf_name in ("Mountain West", "Big Sky East", "SEC"):
        scenario("team meta", "team_meta_doc", team, conf_name)
BASE26 = BASE["2026"]
B26 = Base(2026)
HEADS = [{}, {"head": {"name": "Pat Doe", "rating": 60}, "offense": "Air Raid"}, {"offense": "Flexbone Triple Option"}, {"offense": "No Such Offense"},
         {"head_coach": {"scheme": {"offensive_philosophy": "Pro Style"}, "ratings": {"overall": 77}}},
         {"head": {"scheme": {"offensive_philosophy": "Spread Option"}, "ratings": {}, "rating": 44.5}}, {"head": "nobody"}]
for conf in [CONFS["mountain-west"], CONFS["sec"], NEW_CONF, None, {"members": ["no-such-team"]}]:
    scenario("members", "_members", conf, B26)
    scenario("schemes", "_schemes", conf, B26)
    for coaches in HEADS:
        team = {"slug": "alder-tech", "coaches": coaches}
        scenario("head", "_head", team)
        scenario("style and formation", "style_and_formation", team, conf, B26)
        for prestige in (None, 40, 0):
            scenario("program", "program_for", {**team, "prestige": prestige}, conf, B26)
    for team in TEAMS:
        for strength in (48.0, 61.3, 75.0):
            scenario("recruiting model", "recruiting_model_for", team, conf, strength)
RICE = DOCS["rice"]
GIVEN = [{}, {"head": {"name": "Pat Doe", "rating": 60}, "oc": {"name": "Sam Roe"}, "offense": "Air Raid"},
         {"head": {"name": " Pat Doe ", "ratings": {"overall": 71, "no_such": 5, "discipline": "66"}}, "dc": {"rating": 82.5}, "defense": "3-3-5"},
         {"head": copy.deepcopy(RICE["coaches"]["head"]), "oc": {**copy.deepcopy(RICE["coaches"]["oc"]), "rating": 90},
          "dc": {**copy.deepcopy(RICE["coaches"]["dc"]), "is_interim": True}, "offense": "Pro Style", "defense": "4-3"},
         {"head": None, "oc": "x", "dc": {"ratings": "y"}, "offense": 5}]
taken_names = carousel._taken_names(BASE26)
for i, conf in enumerate([CONFS["mountain-west"], CONFS["big-ten"], NEW_CONF]):
    for j, given in enumerate(GIVEN):
        for seed in (1, 2):
            scenario("coaches", "coaches_for", {"slug": "alder-tech", "coaches": given}, conf, B26, Rng(f"league-{seed}-alder-tech"), set(taken_names))
scenario("coaches, no names taken", "coaches_for", {"slug": "alder-tech"}, NEW_CONF, B26, Rng("league-9-alder-tech"), None)
# a generated name that is taken is drawn again: every name the generator could give first is taken
first = copy.deepcopy(carousel.generated(random.Random("league-5-alder-tech"), BASE26, "head_coach", "alder-tech", 2026,
                                         BASE26["teams"][lf._schemes(NEW_CONF, BASE26)[2]]["coaches"]["head_coach"]))
scenario("coaches, a taken name drawn again", "coaches_for", {"slug": "alder-tech"}, NEW_CONF, B26, Rng("league-5-alder-tech"), {first["name"].lower()})
for slug in ("akron", "rice", "notre-dame"):
    bdoc = DOCS[slug]
    edits = [{}, {"name": "Akron Rubber", "colors": {"primary": {"name": "Gold", "hex": "#C9A227"}}},
             {"short_name": "Zips U", "abbreviation": "ZU", "mascot": "Rubbers", "city": "Cleveland", "state": "PA", "stadium": {"name": "New Bowl", "capacity": 12345}},
             {"home_field": 99, "rivals": ["ohio-state", "kent-state"]}, {"rivals": []}, {"rivals": None, "colors": "x", "stadium": None, "home_field": None, "name": None}]
    for e in edits:
        scenario("meta edit", "_meta_edit", slug, {**copy.deepcopy(bdoc), **e, "roster": []}, {**bdoc, "roster": []}, "Mid-American")
roster26 = BASE26["teams"]["rice"]["roster"]
names = [c["n"] for c in roster26]
scenario("depth", "_depth", {"depth_chart": {"QB": [names[0], "  " + names[1].upper() + " ", "nobody", 5], "RB": [names[2]], "HB": [names[3]], "K": None}}, roster26)
scenario("depth, none", "_depth", {}, roster26)


# ---- fill_roster
def alder(**kw):
    return {"slug": "alder-tech", "name": "Alder Tech", "short_name": "Alder Tech", "conference": "big-sky-east", "state": "OR",
            "formation": copy.deepcopy(F), **kw}


POSITIONS_85 = (["QB"] * 4 + ["RB"] * 6 + ["WR"] * 11 + ["TE"] * 6 + ["LT", "LG", "C", "RG", "RT"] * 3
                + ["LEDG"] * 4 + ["DT"] * 7 + ["REDG"] * 4 + ["SAM", "MIKE", "WILL"] * 3 + ["CB"] * 8 + ["FS"] * 4 + ["SS"] * 4
                + ["K"] * 2 + ["P"])
CLASSES = ("FR", "FRRS", "SO", "SORS", "JR", "JRRS", "SR", "SRRS")


def _names(positions, cls=None):
    return [{"name": f"P{i}", "pos": pos, "class": cls or CLASSES[i % 8]} for i, pos in enumerate(positions)]


names_only = alder(roster=_names(POSITIONS_85, "JR"))
rest = list(POSITIONS_85)
rest.remove("WR")
rest.remove("LT")
rest.remove("CB")
names_rest = _names(rest)
MAX_LEE = {"name": "Max Lee", "pos": "WR", "class": "SO", "overall": 74, "stars": 4}
AL_CRUZ = {"name": "Al Cruz", "pos": "LT", "class": "SR", "ratings": {"pass_block": 82, "run_block": 78}}
TY_WEST = {"name": "Ty West", "pos": "CB", "class": "JR", "overall": 70, "ratings": {"speed": 90}}


def fill(name, team, target, seed="league-1-alder-tech", taken=()):
    return scenario(name, "fill_roster", team, target, Rng(seed), ATTRS, set(taken))


for grade in ("Elite", "Strong", "Average", "Weak", 63, 5, 99):
    fill(f"names only, {grade}", {**names_only, "strength": grade}, lf.strength_target({"strength": grade}, NEW_CONF, STR))
fill("names of every class", alder(roster=_names(POSITIONS_85)), 58.0, "league-2-alder-tech")
fill("given overall, given ratings, both", alder(roster=[MAX_LEE, AL_CRUZ, TY_WEST] + names_rest), 58.0)
for slug in ("rice", "ohio-state", "kent-state"):
    doc = DOCS[slug]
    whole = copy.deepcopy(doc["roster"])
    fill(f"{slug}'s complete players", alder(roster=whole, formation=doc["formation"]), 60.0, f"league-3-{slug}")
    off = copy.deepcopy(whole)
    for i, p in enumerate(off):                      # every kind of given player: overalls off their ratings, no id, no potential,
        k = i % 9                                    # a few ratings, an overall alone, a name alone, stars, a hometown, coachability
        if k == 0:
            p["overall"] = min(99, p["overall"] + 9)
        elif k == 1:
            p.update(id=None, overall=max(1, p["overall"] - 12), potential=None)
        elif k == 2:
            p.update(potential=None, overall=None, coachability=None, dev=None, years=None, hometown=None)
        elif k == 3:
            p["ratings"] = {a: v for a, v in list(p["ratings"].items())[:rnd.randint(1, 20)]}
        elif k == 4:
            p["ratings"] = {a: v for a, v in rnd.sample(list(p["ratings"].items()), 5)}
            p["overall"] = None
        elif k == 5:
            off[i] = {"name": p["name"], "pos": p["pos"], "class": p["class"], "overall": p["overall"], "stars": rnd.choice([None, 1, 2, 3, 4, 5]),
                      "potential": {a: 99 for a in rnd.sample(ATTRS, 3)}}
        elif k == 6:
            off[i] = {"name": p["name"], "pos": p["pos"], "class": p["class"], "stars": rnd.choice([1, 2, 3, 4, 5]), "hometown": "Bend, OR",
                      "coachability": "Film Junkie", "height": 70, "weight": 180, "jersey": 3, "years": 1, "dev": "Elite"}
        elif k == 7:
            off[i] = {"name": p["name"], "pos": p["pos"], "class": p["class"], "id": f"given-{i}"}
    chart = {}
    for p in reversed(off):
        chart.setdefault(p["pos"], []).append(p["name"].upper() if len(chart) % 2 else p["name"])
    fill(f"{slug}'s players, every kind of given", alder(roster=off, formation=doc["formation"], depth_chart=chart), 57.0, f"league-4-{slug}")
    fill(f"{slug}'s first thirty", {"slug": slug, "name": doc["name"], "roster": off[:30], "state": None}, 66.0, f"league-5-{slug}", taken={f"{slug}-{lf._slugify(off[7]['name'])}"})
for seed, tgt in enumerate((40.0, 52.0, 56.0, 60.0, 64.0, 68.0, 72.0, 88.0), 1):
    fill(f"empty roster to {tgt}", alder(roster=[]), tgt, f"league-{seed}-alder-tech")
fill("empty roster, a fullback formation", alder(roster=[], formation=F_FB), 55.0, "league-11-alder-tech")
fill("empty roster, no formation, no state", {"slug": "alder-tech", "name": "Alder Tech"}, 55.0, "league-12-alder-tech")
fill("empty roster, an odd formation", alder(roster=None, formation={**F_ODD, "special_teams": {"K": 1}}), 55.0, "league-13-alder-tech")
fill("two quarterbacks", alder(roster=[{"name": "Jay Smith", "pos": "QB", "class": "JR"}, {"name": "Bo Jones", "pos": "QB", "class": "SO"}]), 55.0)
fill("one short", alder(roster=_names([p for p in POSITIONS_85 if p != "K"])), 55.0)
fill("ids given and taken", alder(roster=[{"name": "P1", "pos": "QB", "class": "JR"}, {"name": "Zed", "pos": "QB", "class": "JR", "id": "zed-9"}]), 50.0, 1, taken={"alder-tech-p1"})
qbs = [{"name": f"Q{i}", "pos": "QB", "class": "JR"} for i in range(3)]
fill("a depth chart", alder(roster=qbs + names_rest[4:], depth_chart={"QB": ["Q2"], "HB": ["P5", "p4"], "RB": ["P6"]}), 55.0)
fill("the file's words for positions, not players in the list", alder(roster=[{"name": "A B", "pos": "RB", "class": "FR"}, "x", None,
                                                                                {"name": "C D", "pos": "FB", "class": "SRRS"}, {"name": "E F", "pos": "HB", "class": "XX"}]), 61.0)
for seed in range(20, 30):
    n = rnd.randint(1, 60)
    fill(f"{n} names, seed {seed}", alder(roster=_names(rnd.sample(POSITIONS_85, n)), formation=rnd.choice(FORMS[:2] + FORMS[5:])), rnd.uniform(42, 80), f"league-{seed}-alder-tech")

# ---- to_league
ALDER_FILE = {"format": "cfp-league/1", "name": "My League", "remove": ["kent-state"],
              "conferences": [{"id": "big-sky-east", "name": "Big Sky East", "level": "FBS", "games": 0}], "teams": [ALDER]}


def _new_team(slug, state, conference, **kw):
    return {"slug": slug, "name": " ".join(w.capitalize() for w in slug.split("-")), "state": state, "conference": conference, **kw}


BIG_SKY_EAST = ["alder-tech", "bend-state", "cascade-a-and-m", "deschutes", "elk-river", "fort-rock"]
TEN = {"format": "cfp-league/1", "name": "Big Sky East League",
       "conferences": [{"id": "big-sky-east", "name": "Big Sky East", "level": "FBS", "games": 5}],
       "teams": [_new_team(s, st, "big-sky-east", **({"rivals": ["oregon-state"]} if s == "alder-tech" else {}))
                 for s, st in zip(BIG_SKY_EAST, ["OR", "OR", "WA", "ID", "MT", "OR"])]}
akron = copy.deepcopy(DOCS["akron"]["roster"])
EDITS = {"format": "cfp-league/1", "name": "Edits", "remove": ["kent-state", "umass"], "teams": [
    {"slug": "akron", "name": "Akron Rubber", "colors": {"primary": {"name": "Gold", "hex": "#C9A227"}}, "city": "Cleveland",
     "roster": akron[:40] + [{"name": "New Guy", "pos": "QB", "class": "FR", "stars": 5}], "depth_chart": {"QB": ["New Guy"]}, "strength": "Strong"},
    {"slug": "rice", "coaches": {"head": {"name": "New Coach", "rating": 70}, "offense": "Air Raid"}, "prestige": 80},
    {"slug": "ohio", "state": "PA", "stadium": {"name": "New Bowl", "capacity": 40000}, "home_field": 80, "rivals": ["akron"]},
    {"slug": "toledo", "lat": 41.0, "lon": -80.0, "style": "navy", "formation": copy.deepcopy(F_FB)},
    {"slug": "army", "city": "Nowhere Junction", "mascot": "Mules", "abbreviation": "ARM", "short_name": "Army West Point"},
    {"slug": "navy", "roster": [], "strength": "Elite", "coaches": {"dc": {"name": "Sea Dog"}, "defense": "3-4"}},
    {"slug": "air-force", "prestige": 12, "city": "Denver"},
    {"slug": "smu", "roster": [{**p, "overall": min(99, p["overall"] + (5 if i % 4 == 0 else 0))} for i, p in enumerate(copy.deepcopy(DOCS["smu"]["roster"]))]},
    _new_team("gulf-coast-tech", "AL", "sun-belt", coaches={"head": copy.deepcopy(DOCS["rice"]["coaches"]["head"])}, formation=copy.deepcopy(F), style="navy"),
]}
FILES = [("alder", ALDER_FILE, 1), ("alder", ALDER_FILE, 3), ("owl", {"format": "cfp-league/1", "teams": [OWL]}, 1),
         ("a new conference of six", TEN, 1),
         ("a renamed conference", {"format": "cfp-league/1", "conferences": [{"id": "sun-belt", "name": "Southern Belt", "level": "FBS", "games": 9}],
                                    "teams": [_new_team("gulf-coast-tech", "AL", "sun-belt")]}, 2),
         ("edits of built-in teams", EDITS, 7),
         ("teams removed", {"format": "cfp-league/1", "remove": ["kent-state", "akron"]}, 1),
         ("nothing changed", {"format": "cfp-league/1"}, 1),
         ("the cities of the home-spot test", {"format": "cfp-league/1", "teams": [
             {"slug": "akron", "city": "Cleveland"}, {"slug": "rice", "city": "el paso"}, {"slug": "ohio", "state": "TX"},
             {"slug": "toledo", "lat": 45.0}, {"slug": "army", "state": "ZZ" if False else "OR", "city": "Bend"}]}, 5)]
for name, doc, seed in FILES:
    errs = league_file.validate(doc)
    if errs:
        print(f"   ({name}: the checks say {errs[:3]}; filled all the same)")
    merged = league_file.merge(copy.deepcopy(doc))
    scenario(f"to_league: {name}, seed {seed}", "to_league", Merged(merged), seed)
merged = league_file.merge(copy.deepcopy(ALDER_FILE))
scenario("to_league: a team that cannot be built (fill_roster raises)", "to_league", Merged(merged), 1, breaking="fill_roster")
bad = copy.deepcopy(ALDER_FILE)
bad["teams"][0]["roster"][1]["pos"] = "ZZ"
bad["teams"][0]["short_name"] = "  "
scenario("to_league: a team that cannot be built (a position the checks would refuse)", "to_league", Merged(league_file.merge(bad)), 1)

lines_out.close()
print("scenarios:", sum(COUNT.values()), COUNT)
