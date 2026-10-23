"""The game's own ratings: the one scale every player, prospect and number in the game is on.

EA's ratings were only the jumping-off point. `fit()` reads the real 2026 rosters once and
freezes, in data/game_scale.json:
  - each of the 54 skills on our 1-99 scale per position group: 50 is the middle Power 4 starter
    at the position, 15 points a standard deviation above him, 9 below (as the player cards),
  - the player card attributes' scale (ratings.py, the same shape),
  - our overall: a formula per position on those skills, fit once to the 2026 card overall.
After that nothing reads EA: a career's league and its recruits store our ratings, develop in
them, and the engine reads them back through `to_base` (the frozen inverse) into the formulas it
was tuned on. Generated recruits are drawn by a model learned from real players and converted
with `from_ea` the moment they are made.

Usage:  python game_scale.py      # refit data/game_scale.json from the source rosters (rarely: it is frozen)
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent
FILE = ROOT / "data" / "game_scale.json"
ABOVE, BELOW = 15.0, 9.0         # scale points per standard deviation above and below the middle starter
GROUP_OF = {"QB": "QB", "HB": "RB", "FB": "RB", "WR": "WR", "TE": "TE", "LT": "OL", "LG": "OL", "C": "OL", "RG": "OL", "RT": "OL",
            "LEDG": "DL", "REDG": "DL", "DT": "DL", "SAM": "LB", "MIKE": "LB", "WILL": "LB", "CB": "CB", "FS": "S", "SS": "S",
            "K": "K", "P": "P"}
OVERALL_RIDGE = 2.0              # shrinkage of the overall fit's weights (keeps rarely used skills from swinging it)


@lru_cache(maxsize=1)
def data() -> dict:
    return json.loads(FILE.read_text(encoding="utf-8"))


def keys() -> list[str]:
    return data()["keys"]


def group(pos: str) -> str:
    """The scale group of an EA position (LT, MIKE, ...) or an engine position (OL, MLB, ...)."""
    return GROUP_OF.get(pos) or {"RB": "RB", "OL": "OL", "DL": "DL", "MLB": "LB", "ROLB": "LB", "LOLB": "LB", "S": "S"}.get(pos, pos)


def to_ours(base: float, grp: str, key: str) -> int:
    m, sd = data()["skills"][grp][key]
    return int(round(max(1, min(99, 50 + (base - m) / sd * (ABOVE if base >= m else BELOW)))))


def to_base(ours: float, grp: str, key: str) -> float:
    m, sd = data()["skills"][grp][key]
    return m + (ours - 50) * sd / (ABOVE if ours >= 50 else BELOW)


def ours_from_base(ratings: dict, pos: str) -> dict[str, int]:
    g = group(pos)
    return {k: to_ours(ratings[k], g, k) for k in keys() if k in ratings}


def base_from_ours(ours: dict, pos: str) -> dict[str, float]:
    g = group(pos)
    return {k: round(to_base(v, g, k), 1) for k, v in ours.items()}


def from_ea(ratings_ea: dict, pos: str) -> dict[str, int]:
    """A generated recruit's EA-scale draw, converted once (the source curve, then our scale)."""
    import recruits
    return ours_from_base({k: recruits.curve(v) for k, v in ratings_ea.items()}, pos)


# How far a generated player grows, by position group: his drawn room to potential times this. Set
# so a career's starters settle, season after season, where the real 2026 starters were (tools/long_run.py).
ROOM = {"QB": 1.33, "RB": 1.0, "WR": 1.11, "TE": 1.21, "OL": 1.24, "DL": 1.35, "LB": 1.45, "CB": 1.48, "S": 1.63, "K": 1.25, "P": 0.85}


def potential_from_ea(potential_ea: dict, ours: dict, pos: str) -> dict[str, int]:
    """A generated player's potential on our scale: his room above his ratings scaled by ROOM."""
    m = ROOM.get(group(pos), 1.0)
    pot = from_ea(potential_ea, pos)
    return {k: int(round(min(99, ours.get(k, v) + m * max(0, v - ours.get(k, v))))) for k, v in pot.items()}


def has_overall() -> bool:
    return bool(FILE.exists() and data().get("overall"))


def overall(ours: dict, pos: str) -> int:
    """Our overall for a player at EA position `pos` (or his engine position's group)."""
    f = data()["overall"].get(pos) or data()["overall"][_FIRST.get(group(pos), "QB")]
    return int(round(max(1, min(99, f["const"] + sum(w * ours.get(k, 50) for k, w in f["w"].items())))))


_FIRST = {"QB": "QB", "RB": "HB", "WR": "WR", "TE": "TE", "OL": "LG", "DL": "DT", "LB": "MIKE", "CB": "CB", "S": "FS", "K": "K", "P": "P"}


def engine_means() -> Optional[dict]:
    """The real 2026 build's FBS starter means of the engine's attributes ("POS:attr" -> mean),
    frozen: a career's later seasons go onto the engine scale through them (build_teams.normalize)."""
    return data().get("engine_means")


def freeze_engine_means() -> int:
    """Store the real 2026 build's starter means (data/engine_teams.json) in data/game_scale.json."""
    built = json.loads((ROOT / "data" / "engine_teams.json").read_text(encoding="utf-8"))
    d = json.loads(FILE.read_text(encoding="utf-8"))
    d["engine_means"] = built["starter_means_before_normalization"]
    FILE.write_text(json.dumps(d, indent=0), encoding="utf-8")
    data.cache_clear()
    return len(d["engine_means"])


def card_scale() -> dict:
    """The player card attributes' scale ("group|attr" -> [middle, slope above, slope below]), frozen."""
    return data()["card_scale"]


# ----- saves from before: EA numbers converted once ------------------------------------------------

def _convert(r: list, g: list, attrs: list, pos: str) -> tuple[list, list, int]:
    ea = dict(zip(attrs, r))
    ours = from_ea(ea, pos)
    pot = from_ea({k: v + d for k, v, d in zip(attrs, r, g)}, pos)
    rr = [ours.get(k, 50) for k in keys()]
    return rr, [max(0, pot.get(k, 50) - v) for k, v in zip(keys(), rr)], overall(ours, pos)


def upgrade(state: dict) -> bool:
    """A career saved while its league and recruits were kept in EA numbers: converted to ours
    (each read of a prospect keeps how far off it was). Returns whether anything changed."""
    changed = False
    lg = state.get("league")
    if lg and lg.get("scale") != "ours":
        attrs = lg["attrs"]
        players = [c for t in lg["teams"].values() for c in t["roster"]]
        players += [e["player"] for e in ((state.get("offseason") or {}).get("portal") or {}).get("players", {}).values()]
        for c in players:
            c["r"], c["g"], c["o"] = _convert(c["r"], c["g"], attrs, c["pos"])
        lg["attrs"], lg["scale"] = keys(), "ours"
        import league
        league.forget(state["id"])
        changed = True
    rc = state.get("recruiting")
    if rc and rc.get("scale") != "ours" and rc.get("prospects"):
        import recruiting
        attrs = rc["attrs"]
        old = {pid: dict(p["truth"]) for pid, p in rc["prospects"].items()}
        for p in rc["prospects"].values():
            ea_r, ea_p = p.pop("ratings_ea"), p.pop("potential_ea")
            rr, gg, ovr = _convert(ea_r, [b - a for a, b in zip(ea_r, ea_p)], attrs, p["ea_position"])
            p["ratings"], p["potential"] = rr, [a + b for a, b in zip(rr, gg)]
            p["ovr"] = ovr
            p["pot_ovr"] = overall(dict(zip(keys(), p["potential"])), p["ea_position"])
            for k in ("overall_ea", "overall"):
                p.pop(k, None)
        rc["attrs"], rc["scale"], rc["grades"] = keys(), "ours", "game"
        recruiting._truths(rc["prospects"], rc["attrs"])
        for pid, read in rc["reads"].items():
            p = rc["prospects"].get(pid)
            if p is None:
                continue
            for g, (mean, prec) in read["g"].items():
                read["g"][g] = [round(p["truth"][g] + (mean - old[pid][g]), 3), prec]
        changed = True
    return changed


# ----- the one-time fit ----------------------------------------------------------------------------

def fit() -> dict:
    """Freeze the scale from the real 2026 rosters (cfb_sim_data): the skills' middle starters and
    spreads, the card attribute scale (one build without the frozen scale), and our overall, fit to
    the card overall the game showed from EA's (its own scale: 50 the middle Power 4 starter)."""
    import statistics as st
    import numpy as np
    import build_teams
    import polls
    src_dir = ROOT / "cfb_sim_data" / "teams"
    sources = [json.loads(path.read_text(encoding="utf-8")) for path in sorted(src_dir.glob("*.json"))]
    p4 = {t["slug"] for t in sources if not t["fictional"] and (t["conference"] in polls.P4 or t["slug"] == "notre-dame")}
    ea_mid: dict = {}
    for t in sources:
        if t["slug"] in p4:
            starters = {s for unit in t["starters"].values() for v in unit.values() for s in (v or [])}
            for p in t["roster"]:
                if p["slug"] in starters and p.get("overall_ea"):
                    ea_mid.setdefault(group(p["position"]), []).append(p["overall_ea"])
    ea_mid = {g: (st.median(v), max(2.0, st.pstdev(v))) for g, v in ea_mid.items()}

    def shown(p: dict) -> float:       # the card overall the game showed from EA's (the old season.ea_house)
        m, sd = ea_mid[group(p["position"])]
        return max(1, min(99, 50 + (p["overall_ea"] - m) * 15 / sd * (1 if p["overall_ea"] >= m else 0.6)))
    vals: dict = {}
    rows: dict = {}
    mid: dict = {}
    all_keys: set = set()
    for t in sources:
        starters = {s for unit in t["starters"].values() for v in unit.values() for s in (v or [])}
        for p in t["roster"]:
            if not p.get("ratings"):
                continue
            all_keys |= set(p["ratings"])
            g = group(p["position"])
            if t["slug"] in p4 and p["slug"] in starters:
                for k, v in p["ratings"].items():
                    vals.setdefault(g, {}).setdefault(k, []).append(v)
            if not t["fictional"] and p.get("overall_ea"):
                rows.setdefault(p["position"], []).append((p["ratings"], shown(p)))
                if t["slug"] in p4:
                    mid.setdefault(g, []).append((t["slug"], p["slug"], p["position"], p["ratings"]))
    ks = sorted(all_keys)
    skills = {g: {k: [round(st.median(v.get(k, [50])), 2), round(max(2.0, st.pstdev(v.get(k, [50]))), 3)] for k in ks}
              for g, v in vals.items()}
    out = {"keys": ks, "skills": skills, "card_scale": {}, "overall": {}}
    FILE.write_text(json.dumps(out), encoding="utf-8")
    data.cache_clear()
    build_teams.USE_FROZEN = False          # the card scale, measured by one build without a frozen one
    try:
        built = build_teams.build(sources, quiet=True)
    finally:
        build_teams.USE_FROZEN = True
    out["card_scale"] = built["attribute_scale"]
    playing = {(s_, q["slug"]) for s_, t in built["teams"].items() for q in t["offense"] + t["defense"] if q.get("in_game")}
    fits = {}
    for pos, rs in rows.items():
        X = np.array([[ours_from_base(r, pos).get(k, 50) for k in ks] for r, _ in rs], dtype=float)
        y = np.array([o for _, o in rs], dtype=float)
        mu = X.mean(axis=0)
        Xc, yc = X - mu, y - y.mean()
        lam = OVERALL_RIDGE * len(y) * 0.01 + (4000.0 if len(y) < 100 else 0.0)   # a small group (fullbacks) leans hard on the prior
        w = np.linalg.solve(Xc.T @ Xc + lam * np.eye(len(ks)), Xc.T @ yc)
        const = y.mean() - mu @ w
        pred = X @ w + const
        fits[pos] = {"const": round(float(const), 4), "w": {k: round(float(x), 5) for k, x in zip(ks, w) if abs(x) >= 1e-4},
                     "r": round(float(np.corrcoef(pred, y)[0, 1]), 4), "rmse": round(float(np.sqrt(np.mean((pred - y) ** 2))), 2)}
    out["overall"] = fits
    FILE.write_text(json.dumps(out, indent=0), encoding="utf-8")
    data.cache_clear()
    # the middle Power 4 starter of each group reads 50 exactly (the fit's error is not centred there)
    for g, players in mid.items():               # ... the starters the game plays (real usage), not EA's depth chart
        shift = 50 - st.median(overall(ours_from_base(r, pos), pos) for team, slug, pos, r in players if (team, slug) in playing)
        for pos in {pos for pos, _ in rows.items() if group(pos) == g}:
            fits[pos]["const"] = round(fits[pos]["const"] + shift, 4)
    out["overall"] = fits
    FILE.write_text(json.dumps(out, indent=0), encoding="utf-8")
    data.cache_clear()
    build_teams.OUT.write_text(json.dumps(build_teams.build(sources, quiet=True)), encoding="utf-8")
    freeze_engine_means()
    return {pos: (f["r"], f["rmse"]) for pos, f in fits.items()}


if __name__ == "__main__":
    for pos, (r, rmse) in sorted(fit().items()):
        print(f"{pos:<5} overall fit r {r:.3f}  rmse {rmse:.2f}")
