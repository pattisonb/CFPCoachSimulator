"""The recruiting model the game generates fictional classes from, learned from the real
classes tools/fetch_recruits.py saved. No real recruit is kept: only distributions, each
school's habits and the effects that move them.

    generation  prospects per class by stars, the rating spread inside each star band, the
                position mix by stars, height and weight by position, where prospects come
                from (each state's prospects per class by stars) and the hometowns to give them
                (each state's towns, weighted by how many prospects they produce)
    teams       each engine team's footprint (recruiting_footprints.py), its class strength by
                year (a z-score of the class's points among FBS teams that year) and its baseline
    dynamics    how much of a class's strength carries to the next one, and what moves it: the
                last season's win percentage against the team's norm, a new head coach (his
                first and second classes) and the team's tier
    coaches     each head coach's classes against his school's baseline (recruiting over
                expectation), whether that edge travels with him to a new school, whether his old
                school's states come with him, and the edge of every current head coach

Input:  data/recruiting/players_<year>.json, teams_<year>.json, coaches.json, footprints.json
Output: data/recruiting_model.json  (small; the game reads it at run time, so it is committed)

Usage:  python tools/recruiting_model.py
"""
from __future__ import annotations
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `import season` works from here

import json
import math
import statistics as st
from collections import Counter, defaultdict
from pathlib import Path

import season
from teamnames import build_matcher, match

ROOT = Path(__file__).resolve().parents[1]
DIR = ROOT / "data" / "recruiting"
OUT = ROOT / "data" / "recruiting_model.json"
SHAPE_YEARS = range(2017, 2027)     # ten full classes for the shapes (positions, bodies, ratings, states)
COUNT_YEARS = range(2022, 2027)     # the last five for how many prospects a class holds
DYN_YEARS = range(2005, 2027)       # class strength and coaching history (the earliest classes are thin)
TOWNS_PER_STATE = 30
STAR_BANDS = ("5", "4", "3", "2")
# CFBD's older position labels -> the current ones
POSITION = {"PRO": "QB", "DUAL": "QB", "APB": "RB", "FB": "RB", "OG": "IOL", "OC": "IOL", "SDE": "EDGE",
            "WDE": "EDGE", "DT": "DL", "ILB": "LB", "OLB": "LB"}


def band(p: dict) -> str:
    s = p.get("stars") or 0
    return str(min(5, s)) if s >= 2 else "2"        # the few unrated or one-star prospects go with the two-stars


def pos(p: dict) -> str:
    raw = (p.get("position") or "ATH").upper()
    return POSITION.get(raw, raw)


def load(name: str):
    return json.loads((DIR / name).read_text(encoding="utf-8"))


def hs_class(year: int) -> list[dict]:
    path = DIR / f"players_{year}.json"
    return [p for p in json.loads(path.read_text(encoding="utf-8")) if p.get("recruitType") == "HighSchool"] if path.exists() else []


def q(xs: list[float], ps=(0, .1, .25, .5, .75, .9, 1)) -> list[float]:
    xs = sorted(xs)
    return [round(xs[min(len(xs) - 1, int(p * len(xs)))], 4) for p in ps] if xs else []


def ols(rows: list[list[float]], ys: list[float]) -> tuple[list[float], float]:
    """Least squares by the normal equations (a handful of predictors): coefficients and R^2."""
    k = len(rows[0])
    a = [[sum(r[i] * r[j] for r in rows) for j in range(k)] + [sum(r[i] * y for r, y in zip(rows, ys))] for i in range(k)]
    for c in range(k):                                  # Gauss-Jordan with partial pivoting
        piv = max(range(c, k), key=lambda r: abs(a[r][c]))
        a[c], a[piv] = a[piv], a[c]
        for r in range(k):
            if r != c and a[c][c]:
                f = a[r][c] / a[c][c]
                a[r] = [x - f * y for x, y in zip(a[r], a[c])]
    beta = [a[i][k] / a[i][i] for i in range(k)]
    pred = [sum(b * x for b, x in zip(beta, r)) for r in rows]
    my = st.mean(ys)
    ss_tot = sum((y - my) ** 2 for y in ys)
    r2 = 1 - sum((y - p) ** 2 for y, p in zip(ys, pred)) / ss_tot if ss_tot else 0.0
    return beta, r2


def generation() -> dict:
    per_class = defaultdict(list)
    for y in COUNT_YEARS:
        c = Counter(band(p) for p in hs_class(y))
        for b in STAR_BANDS:
            per_class[b].append(c[b])
    ratings, positions, bodies = defaultdict(list), defaultdict(Counter), defaultdict(lambda: ([], []))
    states, towns, abroad = defaultdict(Counter), defaultdict(Counter), Counter()
    town_at = {}
    n_years = len(SHAPE_YEARS)
    for y in SHAPE_YEARS:
        for p in hs_class(y):
            b = band(p)
            if p.get("rating"):
                ratings[b].append(p["rating"])
            positions[b][pos(p)] += 1
            if p.get("height") and p.get("weight"):
                bodies[pos(p)][0].append(p["height"])
                bodies[pos(p)][1].append(p["weight"])
            if p.get("country") not in (None, "USA"):
                abroad[b] += 1
                continue
            s = p.get("stateProvince")
            if not s:
                continue
            states[s][b] += 1
            home = p.get("hometownInfo") or {}
            if p.get("city") and home.get("latitude") is not None:
                towns[s][p["city"]] += 1
                town_at[(s, p["city"])] = (round(home["latitude"], 3), round(home["longitude"], 3))
    total = {b: sum(states[s][b] for s in states) + abroad[b] for b in STAR_BANDS}
    return {
        "classes": {"counts": list(COUNT_YEARS), "shapes": [SHAPE_YEARS[0], SHAPE_YEARS[-1]]},
        "prospects_per_class": {b: round(st.mean(v)) for b, v in per_class.items()},
        "rating_quantiles": {"at": [0, .1, .25, .5, .75, .9, 1], **{b: q(v) for b, v in ratings.items()}},
        "position_share": {b: {k: round(v / sum(c.values()), 4) for k, v in c.most_common()} for b, c in positions.items()},
        "body": {k: {"height_in": [round(st.mean(h), 1), round(st.pstdev(h), 1)], "weight_lb": [round(st.mean(w), 1), round(st.pstdev(w), 1)], "n": len(h)}
                 for k, (h, w) in sorted(bodies.items()) if len(h) >= 30},
        "state_share": {s: {b: round(c[b] / total[b], 5) for b in STAR_BANDS if c[b]} for s, c in sorted(states.items(), key=lambda kv: -sum(kv[1].values()))},
        "abroad_share": {b: round(abroad[b] / total[b], 4) for b in STAR_BANDS},
        "towns": {s: [[t, n, *town_at[(s, t)]] for t, n in c.most_common(TOWNS_PER_STATE)] for s, c in sorted(towns.items())},
        "note": f"state_share: a state's share of each star band's prospects ({n_years} classes); towns: [name, prospects, lat, lon]",
    }


def head_coaches(lookup: dict) -> dict[tuple[str, int], str]:
    """(slug, season) -> the head coach who coached most of that season's games."""
    best: dict[tuple[str, int], tuple[int, str]] = {}
    for c in load("coaches.json"):
        name = f"{c['firstName']} {c['lastName']}"
        for s in c.get("seasons") or []:
            slug = match(s["school"], lookup)
            if slug:
                key = (slug, s["year"])
                if (s.get("games") or 0) >= best.get(key, (-1, ""))[0]:
                    best[key] = (s.get("games") or 0, name)
    return {k: v[1] for k, v in best.items()}


def win_pct(lookup: dict) -> dict[tuple[str, int], float]:
    games = defaultdict(lambda: [0, 0])
    for c in load("coaches.json"):
        for s in c.get("seasons") or []:
            slug = match(s["school"], lookup)
            if slug and s.get("games"):
                games[(slug, s["year"])][0] += s.get("wins") or 0
                games[(slug, s["year"])][1] += s["games"]
    return {k: w / g for k, (w, g) in games.items() if g}


def class_strength(lookup: dict) -> dict[str, dict[int, float]]:
    """slug -> {class year: z-score of the class's points among that year's FBS classes}."""
    out = defaultdict(dict)
    for y in DYN_YEARS:
        path = DIR / f"teams_{y}.json"
        if not path.exists():
            continue
        pts = {}
        for t in json.loads(path.read_text(encoding="utf-8")):
            slug = match(t["team"], lookup)
            if slug and t.get("points"):
                pts[slug] = t["points"]
        if len(pts) < 60:
            continue
        m, sd = st.mean(pts.values()), st.pstdev(pts.values())
        for slug, p in pts.items():
            out[slug][y] = (p - m) / sd
    return out


def dynamics_and_coaches(teams: dict, lookup: dict, power4: set[str]) -> tuple[dict, dict]:
    z = class_strength(lookup)
    coach = head_coaches(lookup)
    wp = win_pct(lookup)
    base = {s: st.mean(v.values()) for s, v in z.items() if len(v) >= 8}
    wbase = defaultdict(list)
    for (s, y), w in wp.items():
        if y in DYN_YEARS:
            wbase[s].append(w)
    wmean = {s: st.mean(v) for s, v in wbase.items() if v}

    # class Y is recruited by season Y's head coach (hired by December of Y-1) off season Y-1's results
    rows, ys, rows_raw = [], [], []
    for s, zs in z.items():
        if s not in base:
            continue
        for y, zy in zs.items():
            if y - 1 not in zs or (s, y - 1) not in wp or (s, y) not in coach or (s, y - 1) not in coach:
                continue
            first = coach[(s, y)] != coach[(s, y - 1)]
            second = not first and (s, y - 2) in coach and coach[(s, y - 1)] != coach[(s, y - 2)]
            p4 = 1.0 if s in power4 else 0.0
            rows.append([1.0, zs[y - 1] - base[s], wp[(s, y - 1)] - wmean[s], float(first), float(second), p4])
            ys.append(zy - base[s])
            rows_raw.append((zs[y - 1], zy))
    beta, r2 = ols(rows, ys)
    lag1 = [(a, b) for a, b in rows_raw]
    dyn = {
        "model": "class_dev[Y] = c + a*class_dev[Y-1] + b*(win%[Y-1] - team win% norm) + new_coach_first + new_coach_second + power4",
        "class_dev": "z-score of class points among FBS that year, minus the team's 2005-2026 mean",
        "coefficients": dict(zip(("const", "carryover", "win_pct_vs_norm", "new_coach_first_class", "new_coach_second_class", "power4"),
                                 (round(b, 3) for b in beta))),
        "r2": round(r2, 3),
        "n": len(ys),
        "raw_year_to_year_correlation": round(st.correlation([a for a, _ in lag1], [b for _, b in lag1]), 3),
        "team_baseline_sd": round(st.pstdev(base.values()), 3),
        "residual_sd": round(math.sqrt(sum((y - sum(b * x for b, x in zip(beta, r))) ** 2 for r, y in zip(rows, ys)) / len(ys)), 3),
    }

    # coaches: classes under each coach at each school against that school's baseline
    stints = defaultdict(list)                      # (coach, slug) -> [(year, dev)]
    for (s, y), name in coach.items():
        if s in base and y in z.get(s, {}):
            stints[(name, s)].append((y, z[s][y] - base[s]))
    edge = {k: st.mean(d for _, d in v) for k, v in stints.items() if len(v) >= 3}
    by_coach = defaultdict(list)
    for (name, s), e in edge.items():
        by_coach[name].append((min(y for y, _ in stints[(name, s)]), s, e))
    pairs = []
    follow = []
    signees_by_state = defaultdict(Counter)        # (slug, class) -> state counts, for the footprint test
    for y in DYN_YEARS:
        for p in hs_class(y):
            s = match(p["committedTo"], lookup) if p.get("committedTo") else None
            if s and p.get("stateProvince"):
                signees_by_state[(s, y)][p["stateProvince"]] += 1
    for name, ss in by_coach.items():
        ss.sort()
        for (y0, a, ea), (y1, b, eb) in zip(ss, ss[1:]):
            pairs.append((ea, eb))
            # does school A's footprint come to school B? A's top states outside B's home state,
            # their share of B's signees in the 3 classes before the coach and in his first 3
            home_b = teams[b].get("state")
            a_states = Counter()
            for yy in range(y0, y1):
                a_states.update(signees_by_state.get((a, yy), {}))
            top = [st_ for st_, _ in a_states.most_common(6) if st_ != home_b and st_ != teams[a].get("state")][:4]
            if not top:
                continue
            share = lambda years: (sum(signees_by_state.get((b, yy), {}).get(t, 0) for yy in years for t in top) /
                                   max(1, sum(sum(signees_by_state.get((b, yy), {}).values()) for yy in years)))
            follow.append((share(range(y1 - 3, y1)), share(range(y1, y1 + 3))))
    current = {}
    for s in teams:
        name = coach.get((s, max(DYN_YEARS)))
        if name and (name, s) in edge:
            current[s] = {"coach": name, "classes": len(stints[(name, s)]), "edge": round(edge[(name, s)], 3)}
        elif name:
            current[s] = {"coach": name, "classes": len(stints.get((name, s), [])), "edge": None}
    coaches_out = {
        "edge": "mean class z-score above the school's baseline across a coach's classes there (3+ classes)",
        "edge_sd": round(st.pstdev(edge.values()), 3),
        "coaches_with_edge": len(edge),
        "edge_travels": {"pairs": len(pairs), "correlation": round(st.correlation(*zip(*pairs)), 3) if len(pairs) > 5 else None},
        "footprint_follows": {"moves": len(follow),
                              "old_states_share_before": round(st.mean(a for a, _ in follow), 3) if follow else None,
                              "old_states_share_after": round(st.mean(b for _, b in follow), 3) if follow else None},
        "current": current,
    }
    team_series = {s: {"baseline": round(base[s], 3), "by_class": {y: round(v, 3) for y, v in sorted(z[s].items())}}
                   for s in base}
    dyn["team_strength"] = team_series
    return dyn, coaches_out


def main() -> None:
    teams = season.load_teams()
    lookup = build_matcher(teams)
    power4 = {s for s, t in teams.items() if t.get("conference") in {"SEC", "Big Ten", "Big 12", "ACC"} or s == "notre-dame"}
    foot = load("footprints.json")
    dyn, coaches = dynamics_and_coaches(teams, lookup, power4)
    strength = dyn.pop("team_strength")
    out = {
        "source": "CollegeFootballData.com recruiting classes, team class rankings and head coaches; distributions only",
        "generation": generation(),
        "teams": {s: {**f, "strength": strength.get(s)} for s, f in foot["teams"].items()},
        "national": foot["national"],
        "dynamics": dyn,
        "coaches": coaches,
    }
    OUT.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    g = out["generation"]
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")
    print("prospects per class:", g["prospects_per_class"])
    print("rating p10/p50/p90:", {b: (v[1], v[3], v[5]) for b, v in g["rating_quantiles"].items() if b != "at"})
    print("5-star positions:", list(g["position_share"]["5"].items())[:6])
    print("QB/OT/CB bodies:", {k: g["body"][k] for k in ("QB", "OT", "CB") if k in g["body"]})
    print("top states for 4-stars:", sorted(((s, v.get("4", 0)) for s, v in g["state_share"].items()), key=lambda x: -x[1])[:6])
    print("dynamics:", json.dumps({k: dyn[k] for k in ("coefficients", "r2", "n", "raw_year_to_year_correlation", "team_baseline_sd", "residual_sd")}))
    print("coaches:", json.dumps({k: v for k, v in coaches.items() if k != "current"}))
    top = sorted(((v["edge"], s, v["coach"]) for s, v in coaches["current"].items() if v["edge"] is not None), reverse=True)
    print("current coaches, best edge:", top[:6])
    print("current coaches, worst edge:", top[-4:])


if __name__ == "__main__":
    main()
