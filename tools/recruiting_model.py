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
    players     what a recruit becomes on the field, from the real 2026 roster players matched to
                their own recruiting record (cfb_sim_data has their EA ratings): where each
                recruiting position plays, each EA position's expected attributes by composite
                rating with real young players' deviations around it (a recruit's shape), each
                attribute's career gain by position (his room to grow), EA's overall as a fit on
                the attributes (per position and archetype), and first and last names to recombine

Input:  data/recruiting/players_<year>.json, teams_<year>.json, coaches.json, footprints.json,
        cfb_sim_data/teams/*.json (the 2026 rosters with EA ratings)
Output: data/recruiting_model.json  (small; the game reads it at run time, so it is committed)

Usage:  python tools/recruiting_model.py
"""
from __future__ import annotations
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from sim import season` works from here

import json
import math
import re
import statistics as st
from collections import Counter, defaultdict
from pathlib import Path

from sim import season
from sim.teamnames import build_matcher, match

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


# ----- players: what a recruit becomes ----------------------------------------------------------

YEARS_IN = {"Freshman": 0, "Freshman (RS)": 1, "Sophomore": 1, "Sophomore (RS)": 2, "Junior": 2,
            "Junior (RS)": 3, "Senior": 3, "Senior (RS)": 4}
SUFFIX = re.compile(r"\b(jr|sr|ii|iii|iv|v)\b\.?", re.I)
NAME_YEARS = range(2002, 2028)
MIN_DONORS = 12             # an EA position needs this many young matched players to shape recruits


def name_key(n: str) -> str:
    return re.sub(r"[^a-z]", "", SUFFIX.sub("", (n or "").lower()))


def roster_players() -> list[dict]:
    out = []
    for path in sorted((ROOT / "cfb_sim_data" / "teams").glob("*.json")):
        t = json.loads(path.read_text(encoding="utf-8"))
        if not t.get("fictional"):
            out += [p for p in t["roster"] if p.get("ratings_ea") and p.get("class_year") in YEARS_IN]
    return out


def match_recruits(players: list[dict]) -> dict[str, dict]:
    """player slug -> his high school recruiting record, when the name is unique among recruits."""
    by_name = defaultdict(list)
    for y in range(2017, 2027):
        for r in hs_class(y):
            by_name[name_key(r["name"])].append(r)
    return {p["slug"]: by_name[name_key(p["name"])][0] for p in players if len(by_name.get(name_key(p["name"]), [])) == 1}


def ridge(rows: list[list[float]], ys: list[float], lam: float) -> list[float]:
    """Least squares with a small ridge penalty (not on the intercept, the last column)."""
    k = len(rows[0])
    a = [[sum(r[i] * r[j] for r in rows) + (lam if i == j and i < k - 1 else 0.0) for j in range(k)]
         + [sum(r[i] * y for r, y in zip(rows, ys))] for i in range(k)]
    for c in range(k):
        piv = max(range(c, k), key=lambda r: abs(a[r][c]))
        a[c], a[piv] = a[piv], a[c]
        for r in range(k):
            if r != c and a[c][c]:
                f = a[r][c] / a[c][c]
                a[r] = [x - f * y for x, y in zip(a[r], a[c])]
    return [a[i][k] / a[i][i] if a[i][i] else 0.0 for i in range(k)]


def players_section() -> dict:
    players = roster_players()
    rec = match_recruits(players)
    keys = sorted({k for p in players for k in p["ratings_ea"]})

    # where each recruiting position plays (shares of 5% or more)
    plays = defaultdict(Counter)
    for p in players:
        if p["slug"] in rec:
            r = rec[p["slug"]]
            plays[POSITION.get((r.get("position") or "ATH").upper(), (r.get("position") or "ATH").upper())][p["position"]] += 1
    position_map = {}
    for rp, c in plays.items():
        n = sum(c.values())
        kept = {k: v for k, v in c.items() if v / n >= 0.05}
        if n >= 20:
            position_map[rp] = {k: round(v / sum(kept.values()), 3) for k, v in sorted(kept.items(), key=lambda kv: -kv[1])}

    # each EA position's expected attributes by composite rating, and real young players' deviations
    by_pos = defaultdict(list)
    for p in players:
        if p["slug"] in rec and YEARS_IN[p["class_year"]] <= 1 and rec[p["slug"]].get("rating"):
            by_pos[p["position"]].append(p)
    shapes = {}
    for pos, ps in sorted(by_pos.items()):
        if len(ps) < MIN_DONORS:
            continue
        used = [k for k in keys if st.pstdev([p["ratings_ea"].get(k, 0) for p in ps]) > 0.5]
        x = [[rec[p["slug"]]["rating"], 1.0 if p["class_year"] == "Freshman (RS)" else 0.0, 1.0] for p in ps]
        coef, dev = {}, [[] for _ in ps]
        for k in used:
            ys = [p["ratings_ea"].get(k, 0) for p in ps]
            b = ridge(x, ys, 1e-6)
            coef[k] = [round(v, 3) for v in b]          # [per composite point, redshirt year, intercept]
            for i, (row, yv) in enumerate(zip(x, ys)):
                dev[i].append(round(yv - sum(c * v for c, v in zip(b, row))))
        fixed = {k: round(st.mean(p["ratings_ea"].get(k, 0) for p in ps)) for k in keys if k not in used}
        shapes[pos] = {"keys": used, "expected": coef, "fixed": fixed,
                       "donors": [[min(max(rec[p["slug"]].get("stars") or 2, 2), 5), p.get("archetype") or ""] + d
                                  for p, d in zip(ps, dev)]}

    # each attribute's career gain by EA position: fifth-year mean minus true-freshman mean
    years = defaultdict(lambda: defaultdict(list))
    for p in players:
        for k, v in p["ratings_ea"].items():
            years[(p["position"], k)][YEARS_IN[p["class_year"]]].append(v)
    gain = defaultdict(dict)
    for (pos, k), by in years.items():
        if len(by[0]) >= 10 and len(by[4]) >= 10:
            gain[pos][k] = round(st.mean(by[4]) - st.mean(by[0]), 1)

    # EA's overall as a fit on the EA attributes, per position and archetype (per position when thin)
    fits = {}
    groups = defaultdict(list)
    for p in players:
        groups[p["position"]].append(p)
        groups[f"{p['position']}|{p.get('archetype')}"].append(p)
    for g, ps in sorted(groups.items()):
        if len(ps) < (60 if "|" in g else 15) or not all(isinstance(p.get("overall_ea"), (int, float)) for p in ps):
            continue
        used = [k for k in keys if st.pstdev([p["ratings_ea"].get(k, 0) for p in ps]) > 0.5]
        rows = [[p["ratings_ea"].get(k, 0) for k in used] + [1.0] for p in ps]
        ys = [p["overall_ea"] for p in ps]
        b = ridge(rows, ys, 1.0)
        pred = [sum(c * v for c, v in zip(b, r)) for r in rows]
        err = st.mean(abs(a - c) for a, c in zip(ys, pred))
        fits[g] = {"weights": {k: round(w, 4) for k, w in zip(used, b) if abs(w) >= 1e-4}, "const": round(b[-1], 3),
                   "mean_abs_error": round(err, 2)}

    # what generated classes are checked against: the real overall (source scale) by stars and
    # years in college, and the athletic attributes of first- and second-year players by stars
    targets = defaultdict(lambda: defaultdict(list))
    athletic = defaultdict(lambda: defaultdict(list))
    for p in players:
        if p["slug"] not in rec:
            continue
        s_ = str(min(max(rec[p["slug"]].get("stars") or 2, 2), 5))
        targets[s_][YEARS_IN[p["class_year"]]].append(p["overall"])
        if YEARS_IN[p["class_year"]] <= 1:
            for k in ("speed", "acceleration", "agility", "jumping"):
                athletic[f"{p['position']}|{k}"][s_].append(p["ratings_ea"].get(k, 0))
    target_out = {s_: {y: [round(st.mean(v), 1), len(v)] for y, v in sorted(by.items()) if len(v) >= 5} for s_, by in sorted(targets.items())}
    athletic_out = {k: {s_: [round(st.mean(v), 1), len(v)] for s_, v in sorted(by.items()) if len(v) >= 5} for k, by in sorted(athletic.items())}

    # names to recombine: first and last names across the real classes
    first, last, suffix = Counter(), Counter(), Counter()
    for y in NAME_YEARS:
        for r in hs_class(y):
            m = SUFFIX.search(r.get("name") or "")
            parts = SUFFIX.sub("", r.get("name") or "").replace(".", "").split()
            if len(parts) < 2:
                continue
            first[parts[0]] += 1
            last[" ".join(parts[1:])] += 1
            sfx = m.group(1).lower() if m else ""
            suffix[sfx.capitalize() + "." if sfx in ("jr", "sr") else sfx.upper()] += 1
    n = sum(suffix.values())
    return {
        "matched_players": len(rec),
        # each matched real player's recruiting stars: the live game has no CFBD data, and real
        # players' potential (recruits.seed_real_players) starts from them
        "real_stars": {slug: min(max(r.get("stars") or 2, 2), 5) for slug, r in sorted(rec.items())},
        "position_map": position_map,
        "shapes": shapes,
        "career_gain": gain,
        "overall_fit": fits,
        "targets": {"overall_by_stars_and_years": target_out, "young_athletic_by_stars": athletic_out},
        "names": {"first": [[k, v] for k, v in first.most_common(2500) if v >= 3],
                  "last": [[k, v] for k, v in last.most_common(8000) if v >= 2],
                  "suffix": {k or "none": round(v / n, 4) for k, v in suffix.most_common() if v / n >= 0.002}},
        "curve": json.loads((ROOT / "cfb_sim_data" / "league.json").read_text(encoding="utf-8"))["rating_scale"]["curve_anchors_ea_to_new"],
    }


def main() -> None:
    teams = season.load_teams()
    lookup = build_matcher(teams)
    power4 = {s for s, t in teams.items() if t.get("conference") in {"SEC", "Big Ten", "Big 12", "ACC"} or s == "notre-dame"}
    foot = load("footprints.json")
    # what the live game needs from CFBD for each school: where it is (the distance pull) and how
    # last season went (on-field standing at the start of the career)
    locs = {}
    for t in load("fbs_teams.json"):
        slug = match(t["school"], lookup)
        loc = t.get("location") or {}
        if slug and loc.get("latitude") is not None:
            locs[slug] = [round(loc["latitude"], 4), round(loc["longitude"], 4)]
    last_year = max(DYN_YEARS) - 1
    last = {}
    for c in load("coaches.json"):
        for s_ in c.get("seasons") or []:
            slug = match(s_["school"], lookup)
            if slug and s_["year"] == last_year and s_.get("games"):
                cur = last.setdefault(slug, {"wins": 0, "losses": 0, "final_rank": None})
                cur["wins"] += s_.get("wins") or 0
                cur["losses"] += s_.get("losses") or 0
                if s_.get("postseasonRank"):
                    cur["final_rank"] = s_["postseasonRank"]
    for slug, f in foot["teams"].items():
        f["location"] = locs.get(slug)
        f["last_season"] = {"year": last_year, **last[slug]} if slug in last else None
    dyn, coaches = dynamics_and_coaches(teams, lookup, power4)
    strength = dyn.pop("team_strength")
    out = {
        "source": "CollegeFootballData.com recruiting classes, team class rankings and head coaches; distributions only",
        "generation": generation(),
        "teams": {s: {**f, "strength": strength.get(s)} for s, f in foot["teams"].items()},
        "national": foot["national"],
        "dynamics": dyn,
        "coaches": coaches,
        "players": players_section(),
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
    pl = out["players"]
    print(f"players: {pl['matched_players']} roster players matched to a recruiting record; shapes for "
          f"{len(pl['shapes'])} EA positions ({sum(len(v['donors']) for v in pl['shapes'].values())} young donors)")
    print("DL plays:", pl["position_map"].get("DL"), "| ATH plays:", pl["position_map"].get("ATH"))
    print("WR career gain:", {k: pl["career_gain"]["WR"].get(k) for k in ("speed", "release", "awareness", "catching")})
    worst = sorted(((v["mean_abs_error"], g) for g, v in pl["overall_fit"].items()), reverse=True)[:5]
    print(f"overall fits: {len(pl['overall_fit'])}, largest mean errors {worst}")
    print(f"names: {len(pl['names']['first'])} first, {len(pl['names']['last'])} last, suffixes {pl['names']['suffix']}")


if __name__ == "__main__":
    main()
