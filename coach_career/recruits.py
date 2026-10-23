"""Fictional recruiting classes and player development (docs/PLAYER_DEVELOPMENT.md).

Every recruit is generated from data/recruiting_model.json, which tools/recruiting_model.py
learns from real classes and from the real 2026 roster players matched to their recruiting
record. No real recruit is kept or reproduced: names are recombined first and last names,
hometowns are real towns, and ratings are real players' shapes blended and perturbed.

A recruit, in order (athleticism first):
    star band and composite rating -> recruiting position -> EA position -> hometown and size
    -> attributes: the position's expected attributes at his composite rating plus the blended
       deviations of real young players there (athleticism comes with them: it rises with
       stars and barely changes in college)
    -> potential per attribute: his room to grow is the attribute's real career gain at his
       position, scaled by a player-level potential and per-attribute spread
    -> coachability: how fast he closes the gap each offseason, independent of stars
Ratings are on EA's scale (ratings_ea, overall_ea) like the source rosters, plus the source
curve's scale (`ratings`, `overall`) that build_teams.py reads.

Usage:  python -m coach_career.recruits [year] [seed]     # print a generated class's top 25 and its make-up
"""
from __future__ import annotations

import json
import math
import random
from itertools import accumulate
import sys
from bisect import bisect
from functools import lru_cache
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parents[1]   # the project root
MODEL_FILE = ROOT / "data" / "recruiting_model.json"

STAR_BANDS = ("5", "4", "3", "2")
QUANTILE_AT = (0, .1, .25, .5, .75, .9, 1)
# (label, share of the gap to potential closed per offseason, share of players)
COACHABILITY = (
    ("Coach's Dream", 0.55, 0.02),
    ("Film Junkie", 0.45, 0.08),
    ("Quick Study", 0.35, 0.20),
    ("Steady Grinder", 0.27, 0.40),
    ("Slow to Click", 0.18, 0.20),
    ("Set in His Ways", 0.10, 0.10),
)
RATE = {name: rate for name, rate, _ in COACHABILITY}
CAREER_YEARS = 4                       # career_gain is a fifth-year player against a true freshman
SURVIVOR_TRIM = 0.85                   # the real gains compare survivors: players who stalled often left
# the share of his room an average player realizes in four offseasons, over the coachability mix
REALIZED = sum(share * (1 - (1 - rate) ** CAREER_YEARS) for _, rate, share in COACHABILITY)
POTENTIAL_SD = 0.45                    # spread of the player-level potential multiplier (log scale) *tune*
ATTRIBUTE_SPREAD = (0.6, 1.4)          # per-attribute spread of room around the player's level *tune*
DONORS = 3                             # real young players blended into a recruit's shape
SAME_BAND_WEIGHT = 3.0                 # a donor from the recruit's own star band is this much likelier
NOISE = 1.5                            # EA points of independent noise per attribute
HEIGHT_WEIGHT_R = 0.5                  # height and weight move together
SIZE_SD_LIMIT = 2.0                    # sizes stay within this many standard deviations of the position's
MIN_WEIGHT = {"K": 150, "P": 150}      # the high school listings' spread runs light at skill positions
MIN_WEIGHT_OTHER = 160
# The young players recruits are shaped from include few two-stars, so a two-star's expected
# attributes are not extrapolated at full slope below the three-star floor (the two-stars who
# reach FBS rosters are close to low three-stars).
EXPECT_FLOOR, BELOW_FLOOR_SLOPE = 0.80, 0.15
# Room to grow by stars, tuned so a class's overall by offseason follows the real roster players'
# (tools/check_recruits.py), a little under them for three- and two-stars, whose real numbers are
# the survivors: the ones who stalled left. *tune*
STAR_ROOM = {5: 1.0, 4: 0.75, 3: 1.6, 2: 1.8}
SKIP_POSITIONS = {"LS"}                # long snappers are not generated (the engine has none)


@lru_cache(maxsize=1)
def model() -> dict:
    return json.loads(MODEL_FILE.read_text(encoding="utf-8"))


def curve(ea: float) -> float:
    """EA's scale -> the source scale (cfb_sim_data/league.json's piecewise-linear curve)."""
    pts = model()["players"]["curve"]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if ea <= x1:
            return y0 + (ea - x0) * (y1 - y0) / (x1 - x0)
    return pts[-1][1]


_CUMULATIVE: dict = {}   # id of a model list -> (its keys, cumulative weights): built once, not on every draw


def weighted(rng: random.Random, pairs) -> str:
    """One key drawn by weight (the same draw as rng.choices with these weights)."""
    cached = _CUMULATIVE.get(id(pairs)) if isinstance(pairs, list) else None
    if cached is None or cached[0] is not pairs:
        keys, weights = zip(*pairs)
        cached = (pairs, keys, list(accumulate(weights)))
        if isinstance(pairs, list):
            _CUMULATIVE[id(pairs)] = cached
    return rng.choices(cached[1], cum_weights=cached[2])[0]


def from_quantiles(qs: list[float], u: float) -> float:
    i = min(len(QUANTILE_AT) - 2, bisect(QUANTILE_AT, u) - 1)
    lo, hi = QUANTILE_AT[i], QUANTILE_AT[i + 1]
    return qs[i] + (u - lo) / (hi - lo) * (qs[i + 1] - qs[i])


def overall_ea(position: str, archetype: str, ratings: dict) -> float:
    fits = model()["players"]["overall_fit"]
    f = fits.get(f"{position}|{archetype}") or fits[position]
    return f["const"] + sum(w * ratings.get(k, 0) for k, w in f["weights"].items())


def rescore(p: dict) -> None:
    """Recompute the overall and the source-scale ratings after the EA ratings change."""
    p["overall_ea"] = int(round(max(1, min(99, overall_ea(p["ea_position"], p["archetype"], p["ratings_ea"])))))
    p["overall"] = int(round(curve(p["overall_ea"])))
    p["ratings"] = {k: int(round(curve(v))) for k, v in p["ratings_ea"].items()}


def _name(rng: random.Random, taken: set[str]) -> str:
    names = model()["players"]["names"]
    for _ in range(50):
        n = f"{weighted(rng, names['first'])} {weighted(rng, names['last'])}"
        sfx = weighted(rng, names["suffix"].items())
        n = n if sfx == "none" else f"{n} {sfx}"
        if n.lower() not in taken:
            taken.add(n.lower())
            return n
    return n


def _attributes(rng: random.Random, pos: str, band: str, composite: float) -> tuple[dict, str]:
    """The position's expected attributes at this composite rating, plus the blended deviations
    of real young players there; the archetype comes from the main donor."""
    shape = model()["players"]["shapes"][pos]
    donors = shape["donors"]
    weights = [SAME_BAND_WEIGHT if str(d[0]) == band else 1.0 for d in donors]
    picks = rng.choices(donors, weights=weights, k=DONORS)
    w = [rng.uniform(0.2, 1.0) for _ in picks]
    w[0] += 1.0                                              # the main donor sets the archetype
    norm = math.sqrt(sum(x * x for x in w))                  # keeps the blend's spread at a real player's
    eff = composite if composite >= EXPECT_FLOOR else EXPECT_FLOOR - BELOW_FLOOR_SLOPE * (EXPECT_FLOOR - composite)
    out = dict(shape["fixed"])
    for i, k in enumerate(shape["keys"]):
        per_point, _, const = shape["expected"][k]
        dev = sum(x * d[2 + i] for x, d in zip(w, picks)) / norm
        out[k] = int(round(max(0, min(99, per_point * eff + const + dev + rng.gauss(0, NOISE)))))
    return out, picks[0][1]


def _potential(rng: random.Random, pos: str, stars: int, ratings: dict) -> dict:
    """Room to grow per attribute: the attribute's real career gain at his position, scaled by
    one player-level potential and per-attribute spread. Physical gifts get little room."""
    gain = model()["players"]["career_gain"].get(pos, {})
    level = math.exp(rng.gauss(-POTENTIAL_SD ** 2 / 2, POTENTIAL_SD)) * STAR_ROOM[stars]     # mean 1 before stars
    out = {}
    for k, v in ratings.items():
        room = max(0.0, gain.get(k, 0.0)) * SURVIVOR_TRIM / REALIZED * level * rng.uniform(*ATTRIBUTE_SPREAD)
        out[k] = int(round(min(99, v + room)))
    return out


def recruit(rng: random.Random, year: int, band: str, taken: set[str]) -> dict:
    gen = model()["generation"]
    pl = model()["players"]
    composite = round(from_quantiles(gen["rating_quantiles"][band], rng.random()), 4)
    while True:
        rpos = weighted(rng, gen["position_share"][band].items())
        if rpos not in SKIP_POSITIONS and rpos in pl["position_map"]:
            break
    pos = weighted(rng, pl["position_map"][rpos].items())
    if pos not in pl["shapes"]:                              # a thin EA position: its recruiting position's main one
        pos = next(p for p in pl["position_map"][rpos] if p in pl["shapes"])
    state = weighted(rng, ((s, v.get(band, 0)) for s, v in gen["state_share"].items()))
    towns = gen["towns"].get(state) or [["", 1, None, None]]
    town = rng.choices(towns, weights=[t[1] for t in towns])[0]
    body = gen["body"].get(rpos) or gen["body"].get("ATH")
    lim = SIZE_SD_LIMIT
    zh = max(-lim, min(lim, rng.gauss(0, 1)))
    zw = max(-lim, min(lim, HEIGHT_WEIGHT_R * zh + math.sqrt(1 - HEIGHT_WEIGHT_R ** 2) * rng.gauss(0, 1)))
    height = round(body["height_in"][0] + body["height_in"][1] * zh)
    weight = max(MIN_WEIGHT.get(rpos, MIN_WEIGHT_OTHER), round(body["weight_lb"][0] + body["weight_lb"][1] * zw))
    ratings_ea, archetype = _attributes(rng, pos, band, composite)
    p = {
        "name": _name(rng, taken),
        "class_of": year,
        "stars": int(band),
        "composite": composite,
        "position": rpos,
        "ea_position": pos,
        "archetype": archetype,
        "height": height,
        "weight": weight,
        "hometown": {"city": town[0], "state": state, "lat": town[2], "lon": town[3]},
        "coachability": weighted(rng, ((n, s) for n, _, s in COACHABILITY)),
        "ratings_ea": ratings_ea,
        "potential_ea": _potential(rng, pos, int(band), ratings_ea),
    }
    rescore(p)
    return p


def generate_class(year: int, seed: int = 0, taken: Optional[set[str]] = None) -> list[dict]:
    """A national class: every prospect from five stars to two, ranked by composite rating.
    `taken`: names already in use (real rosters, earlier classes), lower case; never reused."""
    rng = random.Random(f"class-{year}-{seed}")
    taken = taken if taken is not None else set()
    counts = model()["generation"]["prospects_per_class"]
    out = [recruit(rng, year, band, taken) for band in STAR_BANDS for _ in range(counts[band])]
    out.sort(key=lambda p: -p["composite"])
    for i, p in enumerate(out, 1):
        p["rank"] = i
        p["id"] = f"r{year}-{i:04d}"
    return out


def develop(p: dict, rng: random.Random, coach_factor: float = 1.0) -> None:
    """One offseason: every attribute closes part of its gap to potential, at the player's
    coachability rate times his coaches' factor (docs/PLAYER_DEVELOPMENT.md, section 2)."""
    rate = RATE[p["coachability"]] * coach_factor
    for k, v in p["ratings_ea"].items():
        gap = p["potential_ea"].get(k, v) - v
        if gap > 0:
            p["ratings_ea"][k] = int(round(min(99, v + gap * rate * rng.uniform(0.8, 1.2))))
    rescore(p)


def as_roster_player(p: dict, team: dict, slug: str, jersey: Optional[str] = None) -> dict:
    """A signed recruit in the source roster format (cfb_sim_data/teams/*.json), so he joins a
    roster and build_teams.map_player reads him like a real player. Potential and
    coachability ride along; the development trait is left for the code that replaces it."""
    return {
        "slug": slug, "name": p["name"], "position": p["ea_position"], "class": "FR", "class_year": "Freshman",
        "height": f"{p['height'] // 12}'{p['height'] % 12}\"", "weight_lbs": p["weight"], "jersey": jersey,
        "dev_trait": "Normal", "archetype": p["archetype"], "overall": p["overall"], "overall_ea": p["overall_ea"],
        "ratings": dict(p["ratings"]), "ratings_ea": dict(p["ratings_ea"]), "potential_ea": dict(p["potential_ea"]),
        "coachability": p["coachability"], "stars": p["stars"], "composite": p["composite"], "hometown": dict(p["hometown"]),
        "team": team.get("short_name") or team.get("name"), "team_slug": team.get("slug"),
    }


# ----- the real 2026 players: potential and coachability (docs/PLAYER_DEVELOPMENT.md, section 5) -----

POTENTIAL_FILE = ROOT / "data" / "player_potential.json"
YEARS_IN = {"Freshman": 0, "Freshman (RS)": 1, "Sophomore": 1, "Sophomore (RS)": 2, "Junior": 2,
            "Junior (RS)": 3, "Senior": 3, "Senior (RS)": 4}
TRAIT_ORDER = {"Elite": 3, "Star": 2, "Impact": 1, "Normal": 0}
TRAIT_ROOM = {"Elite": 1.35, "Star": 1.2, "Impact": 1.05, "Normal": 0.9}   # *tune*
UNKNOWN_STAR_ROOM = 1.4            # no recruiting record (walk-ons, older and fictional players): about a three-star's
AHEAD_ROOM = 0.02                  # each point of overall above the norm for his stars and years: 2% more room *tune*
LEVEL_RANGE = (0.2, 3.0)


def _norms() -> tuple[dict, dict]:
    """The real overall (source scale) by stars and years in college, and by years alone."""
    t = model()["players"]["targets"]["overall_by_stars_and_years"]
    by_stars = {int(s): {int(y): v[0] for y, v in ys.items()} for s, ys in t.items()}
    by_years = {}
    for y in range(5):
        cells = [ys[str(y)] for ys in t.values() if str(y) in ys]
        by_years[y] = sum(m * n for m, n in cells) / sum(n for _, n in cells)
    return by_stars, by_years


def seed_real_players(players: list[dict]) -> dict[str, dict]:
    """slug -> {"coachability", "potential_ea", "stars"} for source roster players (cfb_sim_data).
    Coachability: the league is ranked by EA development trait, then within a trait by how far
    ahead of the norm for his stars and years a player already is, and cut into the six levels'
    shares. Potential: each attribute's room is its real career gain at his position times the
    share of his career still to come, divided by what an average player realizes in that time,
    times a player level from his stars, trait and how far ahead he is. Same players, same answer."""
    stars_of = model()["players"]["real_stars"]
    gains = model()["players"]["career_gain"]
    by_stars, by_years = _norms()
    rows = []
    for p in players:
        if not p.get("ratings_ea") or p.get("class_year") not in YEARS_IN:
            continue
        y = YEARS_IN[p["class_year"]]
        s = stars_of.get(p["slug"])
        norm = by_stars.get(s, {}).get(y, by_years[y]) if s else by_years[y]
        rows.append((p, y, s, (p.get("overall") or 0) - norm))
    # coachability: best trait first, then furthest ahead, cut into the levels' shares
    rows.sort(key=lambda r: (-TRAIT_ORDER.get(r[0].get("dev_trait"), 0), -r[3]))
    cuts, acc = [], 0.0
    for name, _, share in COACHABILITY:
        acc += share
        cuts.append((round(acc * len(rows)), name))
    out = {}
    for i, (p, y, s, ahead) in enumerate(rows):
        level_name = next(name for cut, name in cuts if i < cut) if i < cuts[-1][0] else COACHABILITY[-1][0]
        rng = random.Random(f"real-{p['slug']}")
        left = max(0, CAREER_YEARS - y)
        realized = sum(share * (1 - (1 - rate) ** left) for _, rate, share in COACHABILITY) if left else 1.0
        level = math.exp(rng.gauss(-POTENTIAL_SD ** 2 / 2, POTENTIAL_SD))
        level *= STAR_ROOM.get(s, UNKNOWN_STAR_ROOM) * TRAIT_ROOM.get(p.get("dev_trait"), 1.0) * math.exp(AHEAD_ROOM * ahead)
        level = max(LEVEL_RANGE[0], min(LEVEL_RANGE[1], level))
        gain = gains.get(p["position"], {})
        pot = {}
        for k, v in p["ratings_ea"].items():
            room = max(0.0, gain.get(k, 0.0)) * SURVIVOR_TRIM * (left / CAREER_YEARS) / realized * level * rng.uniform(*ATTRIBUTE_SPREAD)
            top = int(round(min(99, v + room)))
            if top > v:
                pot[k] = top               # attributes with no room are left out: potential = current
        out[p["slug"]] = {"coachability": level_name, "potential_ea": pot, **({"stars": s} if s else {})}
    return out


def write_player_potential() -> int:
    """Seed every source roster player and write data/player_potential.json (build_teams.py runs this)."""
    players = []
    for path in sorted((ROOT / "cfb_sim_data" / "teams").glob("*.json")):
        players += json.loads(path.read_text(encoding="utf-8"))["roster"]
    seeded = seed_real_players(players)
    POTENTIAL_FILE.write_text(json.dumps(seeded, separators=(",", ":")), encoding="utf-8")
    return len(seeded)


def main() -> None:
    year = int(sys.argv[1]) if len(sys.argv) > 1 else 2027
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    cls = generate_class(year, seed)
    print(f"class of {year} (seed {seed}): {len(cls)} prospects")
    for p in cls[:25]:
        h = p["hometown"]
        print(f"{p['rank']:>4} {'*' * p['stars']:<5} {p['composite']:.4f} {p['name']:<24} {p['position']:<4} "
              f"{p['ea_position']:<4} {p['archetype']:<20} {p['height'] // 12}'{p['height'] % 12}\" {p['weight']:>3}  "
              f"{h['city']}, {h['state']:<3} ovr {p['overall']:>2}  {p['coachability']}")


if __name__ == "__main__":
    main()
