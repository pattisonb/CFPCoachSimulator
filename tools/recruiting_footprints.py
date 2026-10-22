"""Each school's recruiting footprint and the national patterns behind it, from the classes
tools/fetch_recruits.py saved: what recruit generation and the AI's target lists will be
tuned to.

Per school (engine slug), over the chosen high school classes:
    class size by year, star mix, average rating, blue-chip share, position mix per class,
    top home states, in-state share, and the distance from home (median, p25, p75, p90).
National:
    recruits per class by stars, the share signing in their home state and the median distance
    by stars, the share of each state's blue-chips who stay home, and a distance curve: the
    share of commits within each distance band, by stars and by tier (Power 4 / Group of 5).

Input:  data/recruiting/players_<year>.json, fbs_teams.json (fetch_recruits.py),
        data/engine_teams.json (build_teams.py) for the slugs and conferences.
Output: data/recruiting/footprints.json  {"years", "teams": {slug: {...}}, "national": {...}}

Usage:  python tools/recruiting_footprints.py               # the last 10 classes saved
        python tools/recruiting_footprints.py 2016 2025     # classes 2016 to 2025
"""
from __future__ import annotations
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `import season` works from here

import json
import math
import statistics as st
import sys
from collections import Counter, defaultdict
from pathlib import Path

import season
from teamnames import build_matcher, match

ROOT = Path(__file__).resolve().parents[1]
DIR = ROOT / "data" / "recruiting"
POWER4 = {"SEC", "Big Ten", "Big 12", "ACC"}
BANDS = (50, 100, 200, 300, 500, 800, 1200)       # miles; the last band is everything beyond 1,200
# CFBD positions -> the engine's position groups
POS_GROUP = {"PRO": "QB", "DUAL": "QB", "QB": "QB", "RB": "RB", "APB": "RB", "FB": "RB", "WR": "WR", "TE": "TE",
             "OT": "OL", "IOL": "OL", "OG": "OL", "OC": "OL", "OL": "OL", "DL": "DL", "DT": "DL", "SDE": "EDGE",
             "WDE": "EDGE", "EDGE": "EDGE", "DE": "EDGE", "LB": "LB", "ILB": "LB", "OLB": "LB", "CB": "CB",
             "S": "S", "SAF": "S", "ATH": "ATH", "K": "K", "P": "P", "LS": "LS"}


def miles(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 3958.8 * 2 * math.asin(math.sqrt(h))


def quantiles(xs: list[float]) -> dict:
    if not xs:
        return {}
    xs = sorted(xs)
    q = lambda p: round(xs[min(len(xs) - 1, int(p * len(xs)))])
    return {"p25": q(0.25), "median": q(0.5), "p75": q(0.75), "p90": q(0.9), "n": len(xs)}


def band_of(d: float) -> str:
    for b in BANDS:
        if d <= b:
            return f"<={b}"
    return f">{BANDS[-1]}"


def star_key(p: dict) -> str:
    s = p.get("stars") or 0
    return f"{s}*" if s >= 2 else "unrated/1*"


def main() -> None:
    files = sorted(DIR.glob("players_*.json"))
    if not files:
        sys.exit("No classes saved: run tools/fetch_recruits.py first (needs CFBD_API_KEY).")
    saved = [int(f.stem.split("_")[1]) for f in files]
    lo, hi = (int(sys.argv[1]), int(sys.argv[2])) if len(sys.argv) > 2 else (max(saved) - 9, max(saved))
    years = [y for y in saved if lo <= y <= hi]

    teams = season.load_teams()
    lookup = build_matcher(teams)
    where = {}      # slug -> (lat, lon, state) from CFBD's team locations
    for t in json.loads((DIR / "fbs_teams.json").read_text(encoding="utf-8")):
        slug = match(t["school"], lookup)
        loc = t.get("location") or {}
        if slug and loc.get("latitude") is not None:
            where[slug] = (loc["latitude"], loc["longitude"], loc.get("state"))
    tier = {s: ("Power 4" if t.get("conference") in POWER4 or s == "notre-dame" else "Group of 5") for s, t in teams.items()}

    per_team: dict[str, list[dict]] = defaultdict(list)
    unmatched: Counter = Counter()
    national = {"by_year": {}, "stars": defaultdict(lambda: {"n": 0, "home_state": 0, "dist": []}),
                "bands": defaultdict(Counter), "state_bluechips": defaultdict(lambda: [0, 0])}
    for y in years:
        players = json.loads((DIR / f"players_{y}.json").read_text(encoding="utf-8"))
        hs = [p for p in players if p.get("recruitType") == "HighSchool"]
        national["by_year"][y] = dict(Counter(star_key(p) for p in hs))
        for p in hs:
            if not p.get("committedTo"):
                continue
            slug = match(p["committedTo"], lookup)
            if not slug or slug not in where:
                unmatched[p["committedTo"]] += 1
                continue
            lat, lon, state = where[slug]
            home = p.get("hometownInfo") or {}
            d = miles((home["latitude"], home["longitude"]), (lat, lon)) if home.get("latitude") is not None else None
            r = {"year": y, "stars": p.get("stars") or 0, "rating": p.get("rating"), "state": p.get("stateProvince"),
                 "pos": POS_GROUP.get((p.get("position") or "").upper(), p.get("position") or "?"), "dist": d,
                 "in_state": p.get("stateProvince") == state}
            per_team[slug].append(r)
            n = national["stars"][star_key(p)]
            n["n"] += 1
            n["home_state"] += r["in_state"]
            if d is not None:
                n["dist"].append(d)
                national["bands"][f"{tier[slug]} {star_key(p)}"][band_of(d)] += 1
            if r["stars"] >= 4 and r["state"]:
                sb = national["state_bluechips"][r["state"]]
                sb[0] += 1
                sb[1] += r["in_state"]

    out_teams = {}
    for slug, rs in sorted(per_team.items()):
        by_year = Counter(r["year"] for r in rs)
        stars = Counter(r["stars"] for r in rs)
        states = Counter(r["state"] for r in rs if r["state"])
        ratings = [r["rating"] for r in rs if r["rating"]]
        out_teams[slug] = {
            "tier": tier[slug],
            "signees": len(rs),
            "class_size": {"mean": round(len(rs) / len(years), 1), "by_year": dict(sorted(by_year.items()))},
            "star_share": {f"{s}*": round(c / len(rs), 3) for s, c in sorted(stars.items(), reverse=True)},
            "blue_chip_share": round(sum(c for s, c in stars.items() if s >= 4) / len(rs), 3),
            "avg_rating": round(st.mean(ratings), 4) if ratings else None,
            "positions_per_class": {k: round(v / len(years), 2) for k, v in Counter(r["pos"] for r in rs).most_common()},
            "in_state_share": round(sum(r["in_state"] for r in rs) / len(rs), 3),
            "top_states": [[s, round(c / len(rs), 3)] for s, c in states.most_common(8)],
            "distance_miles": quantiles([r["dist"] for r in rs if r["dist"] is not None]),
        }

    nat = {
        "recruits_per_class_by_stars": national["by_year"],
        "by_stars": {k: {"signees": v["n"], "home_state_share": round(v["home_state"] / v["n"], 3) if v["n"] else None,
                         "distance_miles": quantiles(v["dist"])} for k, v in sorted(national["stars"].items())},
        "distance_bands": {k: {b: round(c / sum(v.values()), 3) for b, c in sorted(v.items())} for k, v in sorted(national["bands"].items())},
        "bluechip_stay_home_by_state": {s: {"bluechips": n, "stay_home": round(h / n, 3)}
                                        for s, (n, h) in sorted(national["state_bluechips"].items(), key=lambda kv: -kv[1][0]) if n >= 10},
    }
    out = {"years": years, "teams": out_teams, "national": nat,
           "unmatched_schools": dict(unmatched.most_common(40))}
    (DIR / "footprints.json").write_text(json.dumps(out, indent=1), encoding="utf-8")

    print(f"classes {years[0]}-{years[-1]}: {sum(len(v) for v in per_team.values())} signees with "
          f"{len(out_teams)} engine teams ({sum(unmatched.values())} to schools outside the engine)")
    for k, v in nat["by_stars"].items():
        print(f"  {k:<11} {v['signees']:>6} signees · {v['home_state_share']:.0%} in-state · median {v['distance_miles'].get('median')} mi")
    for slug in ("ohio-state", "georgia", "alabama", "texas", "boise-state"):
        t = out_teams.get(slug)
        if t:
            print(f"  {slug:<12} {t['class_size']['mean']:>4} a class · blue-chips {t['blue_chip_share']:.0%} · "
                  f"in-state {t['in_state_share']:.0%} · median {t['distance_miles'].get('median')} mi · {t['top_states'][:3]}")


if __name__ == "__main__":
    main()
