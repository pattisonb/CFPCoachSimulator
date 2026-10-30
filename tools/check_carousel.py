"""Is the coaching carousel realistic? Plays N offseasons (the games decided quickly from team
ratings, the points kept so the coaches' offense and defense verdicts exist, every stage on Auto) and counts the year's head coach and coordinator changes against
the real FBS numbers: about 25-30 head coaching changes a year (12 or so fired, a few retired, 8-10
hired away by a better program, one or two to the NFL) and 60-80 coordinator changes.

    python tools/check_carousel.py [--seasons 6] [--seed 1] [--team ohio-state]
"""
from __future__ import annotations

import argparse
import collections
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

BANDS = {"fired": (7, 18), "retired": (1, 8), "moved": (4, 15), "nfl": (0, 4), "head_coach": (18, 38),
         "coordinators": (45, 110), "market": (100, 260)}


def quick_season(state: dict, rng: random.Random) -> None:
    """Every game decided from the team ratings, the class signed, the season over."""
    from sim import season
    teams = season.load_teams()
    ss = state.setdefault("season_stats", {})          # the totals coach development reads (points for and against: the offense and defense thirds)
    for g in state["games"].values():
        h, a = teams[g["home"]]["team_ratings"]["overall"], teams[g["away"]]["team_ratings"]["overall"]
        hs = rng.randint(10, 45)
        win = rng.random() < 1 / (1 + 10 ** ((a - h) / 12))
        g.update(played=True, home_score=hs if win else max(0, hs - rng.randint(1, 20)), away_score=hs - rng.randint(1, 20) if win else hs)
        if g["home_score"] == g["away_score"]:
            g["home_score"] += 3
        for side, opp in (("home", "away"), ("away", "home")):
            t = ss.setdefault(g[side], {"games": 0, "wins": 0, "points": 0, "opp_points": 0, "plays": 0, "top": 0, "opp_plays": 0,
                                        "team": {}, "events": {}, "opp": {}, "opp_events": {}, "players": {}})
            t["games"] += 1
            t["wins"] += g[f"{side}_score"] > g[f"{opp}_score"]
            t["points"] += g[f"{side}_score"]
            t["opp_points"] += g[f"{opp}_score"]
    state["current_week"] = season.FINAL_WEEK
    state["done"] = True
    rc = state.get("recruiting")
    if rc:
        rc["signing_done"] = True


def year_counts(car: dict) -> dict:
    c = collections.Counter()
    for ch in car["changes"]:
        if ch["role"] == "head_coach":
            r = ch["reason"]
            if r == "fired":
                c["fired"] += 1
            elif r == "retired":
                c["retired"] += 1
            elif r == "left for the NFL":
                c["nfl"] += 1
            elif r.startswith("left for"):
                c["moved"] += 1
            elif r == "hired":
                c["hc_hired"] += 1
                c["hc_from_market"] += bool(ch.get("from_market"))
        elif ch["reason"] == "hired":
            c["coordinators"] += 1
            c["coord_from_market"] += bool(ch.get("from_market"))
    c["head_coach"] = c["fired"] + c["retired"] + c["nfl"] + c["moved"]
    return dict(c)


def run(seasons: int, seed: int, team: str) -> list[dict]:
    from coach_career import carousel, offseason
    from sim import season
    rng = random.Random(seed)
    st = season.new_season(team, "full", seed=seed, career=True)
    st["career"]["settings"]["auto_recruit"] = "season"
    rows = []
    for _ in range(seasons):
        quick_season(st, rng)
        offseason.run_all(st)
        off = st["offseason"]
        row = year_counts(off["carousel"])
        row["year"] = off["year"]
        row["market"] = len(carousel.market(st)["coaches"])
        row["you"] = off["carousel"]["you"].get("security")
        rows.append(row)
        print("  ".join(f"{k} {row.get(k, 0)}" for k in ("year", "head_coach", "fired", "retired", "moved", "nfl", "hc_from_market",
                                                        "coordinators", "coord_from_market", "market", "you")), flush=True)
        st = offseason.next_season(st)
    from coach_career import league
    league.forget(st["id"])
    season.close_pool()
    return rows


def verdict(rows: list[dict]) -> tuple[bool, str]:
    skip = 1 if len(rows) > 2 else 0                  # the first year is the real coaches' unknown standing settling
    means = {k: sum(r.get(k, 0) for r in rows[skip:]) / max(1, len(rows) - skip) for k in BANDS}
    bad = [f"{k} {v:.1f} not in {BANDS[k]}" for k, v in means.items() if not BANDS[k][0] <= v <= BANDS[k][1]]
    text = "  ".join(f"{k} {v:.1f}" for k, v in means.items())
    return not bad, text + ("" if not bad else "  OUT OF BAND: " + "; ".join(bad))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seasons", type=int, default=6)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--team", default="ohio-state")
    a = ap.parse_args()
    rows = run(a.seasons, a.seed, a.team)
    ok, text = verdict(rows)
    print(("carousel ok: " if ok else "carousel OFF: ") + text)
    sys.exit(0 if ok else 1)
