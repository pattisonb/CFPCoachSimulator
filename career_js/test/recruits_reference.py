"""Python's answers for career_js/recruits.js, written as JSON for recruits_compare.mjs to hold the JavaScript to:

    python3 career_js/test/recruits_reference.py out.json && node career_js/test/recruits_compare.mjs out.json

(the file is large: whole national classes, every prospect and every field)
"""
import copy
import json
import math
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from coach_career import recruits    # noqa: E402

# (year, seed, the names already in use, scored)
CLASSES = [(2027, 0, "none", True), (2027, 7, "none", True), (2028, 12345, "none", True), (2031, 3, "rosters", True),
           (2029, 1, "rosters", False), (2040, 99, "empty", True)]


class EveryName(set):
    """A set of names with every name in it."""
    def __contains__(self, name):
        return True


def roster_names() -> list[str]:
    teams = json.loads((ROOT / "data" / "engine_teams.json").read_text(encoding="utf-8"))["teams"]
    return sorted({p["name"].lower() for t in teams.values() for p in t["offense"] + t["defense"]})


def main(out_path: str) -> None:
    m = recruits.model()
    gen, pl = m["generation"], m["players"]
    out: dict = {}

    # every dict of the model: its keys in Python's order (the file's), for the JavaScript to compare with its own
    orders = []

    def walk(d, path):
        if isinstance(d, dict):
            orders.append([path, list(d)])
            for k, v in d.items():
                walk(v, path + [k])
        elif isinstance(d, list):
            for i, v in enumerate(d):
                if isinstance(v, (dict, list)):
                    walk(v, path + [i])
    walk(m, [])
    out["key_orders"] = orders

    out["constants"] = {
        "REALIZED": recruits.REALIZED, "RATE": recruits.RATE, "COACHABILITY": recruits.COACHABILITY,
        "potential_mean": -recruits.POTENTIAL_SD ** 2 / 2, "size_root": math.sqrt(1 - recruits.HEIGHT_WEIGHT_R ** 2),
        "powers": [[rate, left, (1 - rate) ** left] for _, rate, _ in recruits.COACHABILITY for left in range(1, 5)],
        "STAR_BANDS": recruits.STAR_BANDS, "QUANTILE_AT": recruits.QUANTILE_AT, "STAR_ROOM": recruits.STAR_ROOM,
        "YEARS_IN": recruits.YEARS_IN, "TRAIT_ORDER": recruits.TRAIT_ORDER, "TRAIT_ROOM": recruits.TRAIT_ROOM,
        "MIN_WEIGHT": recruits.MIN_WEIGHT, "SKIP_POSITIONS": sorted(recruits.SKIP_POSITIONS),
        "numbers": {k: getattr(recruits, k) for k in (
            "CAREER_YEARS", "SURVIVOR_TRIM", "POTENTIAL_SD", "ATTRIBUTE_SPREAD", "DONORS", "SAME_BAND_WEIGHT", "NOISE",
            "HEIGHT_WEIGHT_R", "SIZE_SD_LIMIT", "MIN_WEIGHT_OTHER", "EXPECT_FLOOR", "BELOW_FLOOR_SLOPE",
            "UNKNOWN_STAR_ROOM", "AHEAD_ROOM", "LEVEL_RANGE")},
    }

    # the two helpers the JavaScript needs to do as Python does: float ** a small whole number, and sum() of floats
    r = random.Random("helpers")
    pw = [[r.choice([r.random(), r.uniform(-3, 3), round(r.random(), 2), r.uniform(0, 100)]), r.randint(0, 6)] for _ in range(20000)]
    out["pow"] = [[x, n, x ** n] for x, n in pw]
    out["exp"] = [[x, math.exp(x)] for x in ([r.gauss(-recruits.POTENTIAL_SD ** 2 / 2, recruits.POTENTIAL_SD) for _ in range(20000)]
                                             + [recruits.AHEAD_ROOM * r.uniform(-40, 40) for _ in range(20000)])]
    sm = []
    for i in range(20000):
        n = r.randint(0, 60)
        scale = r.choice([1.0, 1.0, 100.0, 1e-3])
        xs = [r.choice([r.random(), r.uniform(-1, 1), round(r.uniform(-1, 1), 4), float(r.randint(-99, 99))]) * scale for _ in range(n)]
        sm.append([xs, sum(xs), sum(x for x in xs)])
    out["sum"] = sm

    # curve: every whole number and a spread of others
    r = random.Random("curve")
    xs = list(range(-5, 131)) + [r.uniform(-10, 130) for _ in range(2000)]
    out["curve"] = [[x, recruits.curve(x)] for x in xs]

    # from_quantiles: every band's quantiles, the knots and a spread between them
    r = random.Random("quantiles")
    us = list(recruits.QUANTILE_AT) + [r.random() for _ in range(500)]
    out["from_quantiles"] = [[band, u, recruits.from_quantiles(gen["rating_quantiles"][band], u)] for band in recruits.STAR_BANDS for u in us]

    # weighted: a model list (cumulative weights kept), a dict's items, pairs made for the draw; the generator's
    # next random number after the draws says the two drew the same number of times
    w = []
    for n, (what, pairs) in enumerate([
            ("first", lambda: pl["names"]["first"]), ("last", lambda: pl["names"]["last"]),
            ("suffix", lambda: pl["names"]["suffix"].items()),
            *[(f"position_share|{b}", lambda b=b: gen["position_share"][b].items()) for b in recruits.STAR_BANDS],
            *[(f"position_map|{rp}", lambda rp=rp: pl["position_map"][rp].items()) for rp in pl["position_map"]],
            *[(f"state_share|{b}", lambda b=b: ((s, v.get(b, 0)) for s, v in gen["state_share"].items())) for b in recruits.STAR_BANDS],
            ("coachability", lambda: ((nm, s) for nm, _, s in recruits.COACHABILITY))]):
        rng = random.Random(f"weighted-{n}")
        w.append([what, n, [recruits.weighted(rng, pairs()) for _ in range(400)], rng.random()])
    out["weighted"] = w

    # a few classes whole (their names taken as they go), then the pieces on their prospects
    names = roster_names()
    out["roster_names"] = names
    classes = []
    for year, seed, start, scored in CLASSES:
        taken = None if start == "none" else set(names) if start == "rosters" else set()
        cls = recruits.generate_class(year, seed, taken, scored) if taken is not None else recruits.generate_class(year, seed)
        classes.append({"year": year, "seed": seed, "taken": start, "scored": scored, "class": cls,
                        "taken_after": sorted(taken) if taken is not None else None})
    out["classes"] = classes
    first = classes[0]["class"]

    # overall_ea and rescore: prospects as generated, and with their ratings moved (an archetype with no fit of its own too)
    r = random.Random("rescore")
    oe, rs = [], []
    for p in first[::7]:
        oe.append([p["ea_position"], p["archetype"], p["ratings_ea"], recruits.overall_ea(p["ea_position"], p["archetype"], p["ratings_ea"])])
        oe.append([p["ea_position"], "No Such Archetype", {}, recruits.overall_ea(p["ea_position"], "No Such Archetype", {})])
        q = copy.deepcopy(p)
        q["ratings_ea"] = {k: max(0, min(99, v + r.randint(-30, 30))) for k, v in q["ratings_ea"].items()}
        before = copy.deepcopy(q)
        recruits.rescore(q)
        rs.append([before, q])
    out["overall_ea"], out["rescore"] = oe, rs

    # _name: fresh generators seeded with text (as the coaches' names are drawn), an empty set, the rosters', and one
    # where every name is taken, so the fifty tries run out
    nm = []
    for i in range(300):
        rng = random.Random(f"name-{i}")
        taken = set(names) if i % 2 else set()
        got = [recruits._name(rng, taken) for _ in range(5)]
        nm.append([i, i % 2, got, rng.random()])
    out["name"] = nm
    rng = random.Random("name-full")
    full = EveryName()
    out["name_full"] = [[recruits._name(rng, full) for _ in range(3)], rng.random()]

    # _attributes, _potential and recruit on their own
    at, po, rc = [], [], []
    for i in range(400):
        pos = list(pl["shapes"])[i % len(pl["shapes"])]
        band = recruits.STAR_BANDS[i % 4]
        composite = round(0.70 + 0.3 * random.Random(f"c-{i}").random(), 4)
        rng = random.Random(f"attributes-{i}")
        ratings, arch = recruits._attributes(rng, pos, band, composite)
        at.append([pos, band, composite, ratings, arch, rng.random()])
        rng = random.Random(f"potential-{i}")
        po.append([pos, int(band), ratings, recruits._potential(rng, pos, int(band), ratings), rng.random()])
        rng = random.Random(f"recruit-{i}")
        taken = set()
        rc.append([band, i % 3 != 0, recruits.recruit(rng, 2030, band, taken, i % 3 != 0), sorted(taken), rng.random()])
    out["attributes"], out["potential"], out["recruit"] = at, po, rc

    # develop: four offseasons each, the coaches' factor varied; as_roster_player
    dv, rp = [], []
    for i, p in enumerate(first[::9]):
        q = copy.deepcopy(p)
        rng = random.Random(f"develop-{i}")
        factor = [1.0, 0.8, 1.25, 1.1][i % 4]
        years = []
        for _ in range(4):
            if i % 5 == 0:
                recruits.develop(q, rng)
            else:
                recruits.develop(q, rng, factor)
            years.append(copy.deepcopy(q))
        dv.append([p, i % 5 == 0, factor, years, rng.random()])
        team = [{"short_name": "State", "name": "State University", "slug": "state"}, {"name": "Tech", "slug": "tech"}, {}][i % 3]
        rp.append([p, team, f"gen-{i}", None if i % 2 else str(i % 100),
                   recruits.as_roster_player(p, team, f"gen-{i}") if i % 2 else recruits.as_roster_player(p, team, f"gen-{i}", str(i % 100))])
    out["develop"], out["as_roster_player"] = dv, rp

    # the real players: the norms, every source roster player seeded, and the file's text as it is written
    out["norms"] = list(recruits._norms())
    files = sorted((ROOT / "cfb_sim_data" / "teams").glob("*.json"))
    players = []
    for path in files:
        players += json.loads(path.read_text(encoding="utf-8"))["roster"]
    seeded = recruits.seed_real_players(players)
    out["team_files"] = [p.name for p in files]
    out["seed_real_players"] = seeded
    out["seed_real_players_order"] = list(seeded)
    out["potential_text"] = json.dumps(seeded, separators=(",", ":"))
    out["potential_file_same"] = recruits.POTENTIAL_FILE.read_text(encoding="utf-8") == out["potential_text"]
    # odd rows: no ratings, a class year the table does not have, no overall, no trait, an unknown position
    odd = copy.deepcopy(players[:60])
    for i, p in enumerate(odd):
        if i % 6 == 0:
            p["ratings_ea"] = {}
        elif i % 6 == 1:
            p["class_year"] = None if i % 12 == 1 else "Graduate"
        elif i % 6 == 2:
            p["overall"] = None
        elif i % 6 == 3:
            p["dev_trait"] = None
        elif i % 6 == 4:
            p["position"] = "LS"
    out["seed_odd"] = [odd, recruits.seed_real_players(odd), list(recruits.seed_real_players(odd))]

    Path(out_path).write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"{len(classes)} classes ({sum(len(c['class']) for c in classes)} prospects), {len(out['curve'])} curve points, "
          f"{len(out['from_quantiles'])} quantiles, {len(w)} weighted populations x 400, {len(oe)} overalls, {len(rs)} rescores, "
          f"{len(nm)} name runs, {len(at)} attributes/potentials/recruits, {len(dv)} developed, {len(seeded)} real players seeded "
          f"(the file on disk the same: {out['potential_file_same']}) -> {out_path}")


if __name__ == "__main__":
    main(sys.argv[1])
