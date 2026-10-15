"""Replay the real 2026 season so far and compare the sim with what actually happened.

Input: data/season_games.json from fetch_results.py. Every final game between two teams
in data/engine_teams.json is simulated N times (at the home stadium, or on a neutral
field when NCAA flags neither team as home) and the average predicted margin is compared
with the real margin.

Usage:
    python calibrate_season.py              # 30 sims per game
    python calibrate_season.py 50           # more sims per game
    python calibrate_season.py 30 --spread 0.7   # rebuild teams with another spread scale first

Reports: straight-up accuracy, mean absolute error of the margin, the slope of actual
margin on predicted margin (1.0 means rating gaps are worth exactly what the sim thinks),
the home-field bias, calibration of win probability by bucket, and the worst misses.
"""
from __future__ import annotations

import json
import re
import statistics as st
import subprocess
import sys
from multiprocessing import Pool
from pathlib import Path

ROOT = Path(__file__).resolve().parent
GAMES_FILE = ROOT / "data" / "season_games.json"
TEAMS_FILE = ROOT / "data" / "engine_teams.json"
RESULTS_FILE = ROOT / "data" / "season_results.json"

# NCAA.com names that the automatic matcher cannot resolve.
ALIASES = {
    "southern california": "usc", "miami (fl)": "miami", "army west point": "army",
    "app state": "app-st", "middle tenn": "mtsu", "south fla": "usf", "massachusetts": "umass",
    "kennesaw st": "kennesaw-st", "jacksonville st": "jax-state", "ulm": "ul-monroe",
    "western ky": "w-kentucky", "central mich": "c-michigan", "eastern mich": "e-michigan",
    "western mich": "w-michigan", "coastal carolina": "c-carolina", "ga southern": "ga-southern",
    "fla atlantic": "fla-atlantic", "hawaii": "hawai-i", "san jose st": "san-jose-state",
    "new mexico st": "new-mexico-st", "missouri st": "missouri-state", "southern miss": "southern-miss",
    "louisiana tech": "louisiana-tech", "texas st": "texas-state", "arkansas st": "arkansas-state",
    "georgia st": "georgia-state", "ohio st": "ohio-state", "michigan st": "michigan-state",
    "mississippi st": "mississippi-state", "oklahoma st": "oklahoma-state", "oregon st": "oregon-state",
    "penn st": "penn-state", "iowa st": "iowa-state", "kansas st": "kansas-state", "florida st": "florida-state",
    "boise st": "boise-state", "colorado st": "colorado-state", "fresno st": "fresno-state",
    "utah st": "utah-state", "san diego st": "san-diego-state", "ball st": "ball-state",
    "kent st": "kent-state", "arizona st": "arizona-state", "washington st": "washington-state",
    "nc state": "nc-state", "north carolina": "north-carolina", "south carolina": "south-carolina",
    "notre dame": "notre-dame", "ole miss": "ole-miss", "texas a&m": "texas-am", "texas tech": "texas-tech",
    "west virginia": "west-virginia", "virginia tech": "virginia-tech", "georgia tech": "georgia-tech",
    "boston college": "boston-college", "wake forest": "wake-forest", "east carolina": "east-carolina",
    "old dominion": "old-dominion", "james madison": "james-madison", "south alabama": "south-alabama",
    "north texas": "north-texas", "new mexico": "new-mexico", "air force": "air-force",
    "bowling green": "bowling-green", "sam houston": "sam-houston", "miami (oh)": "miami-oh",
}


def norm(name: str) -> str:
    s = name.lower().replace(".", "").replace("'", "")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def load_games() -> list[dict]:
    """Final games from data/season_games.json (see fetch_results.py)."""
    games = json.loads(GAMES_FILE.read_text(encoding="utf-8"))
    out = []
    for g in games:
        if not g.get("final"):
            continue
        out.append({"week": g["week"], "date": g["date"], "neutral": g.get("neutral", False),
                    "home": g["home_name"], "home_seo": g["home_seo"], "home_score": g["home_score"],
                    "away": g["away_name"], "away_seo": g["away_seo"], "away_score": g["away_score"]})
    return out


def build_matcher(teams: dict) -> dict[str, str]:
    lookup = {}
    for slug, t in teams.items():
        for key in (slug, slug.replace("-", " "), t["name"], t["school"], t["abbreviation"]):
            lookup.setdefault(norm(key), slug)
    for k, v in ALIASES.items():
        if v in teams:
            lookup[norm(k)] = v
    return lookup


def match(name: str, lookup: dict[str, str]) -> str | None:
    n = norm(name)
    if n in lookup:
        return lookup[n]
    n2 = n.replace(" st", " state") if n.endswith(" st") else n
    return lookup.get(n2)


# ----- simulation (one process per core) -----------------------------------

_TEAMS: dict = {}


def _init(path: str) -> None:
    global _TEAMS
    _TEAMS = json.loads(Path(path).read_text(encoding="utf-8"))["teams"]


def _sim_game(args: tuple) -> dict:
    from engine.game import simulate_game
    idx, home, away, n, venue = args
    margins, totals, wins = [], [], 0
    for i in range(n):
        r = simulate_game(_TEAMS[home], _TEAMS[away], seed=idx * 1000 + i, venue=venue)
        m = r["home"]["score"] - r["away"]["score"]
        margins.append(m)
        totals.append(r["home"]["score"] + r["away"]["score"])
        wins += 1 if m > 0 else 0
    return {"idx": idx, "pred_margin": st.mean(margins), "pred_sd": st.pstdev(margins),
            "pred_total": st.mean(totals), "home_win_prob": wins / n}


def main() -> None:
    args = [a for a in sys.argv[1:]]
    n = 30
    if args and args[0].isdigit():
        n = int(args.pop(0))
    if "--spread" in args:
        scale = args[args.index("--spread") + 1]
        subprocess.run([sys.executable, str(ROOT / "build_teams.py"), scale], check=True)
    teams = json.loads(TEAMS_FILE.read_text(encoding="utf-8"))["teams"]
    lookup = build_matcher(teams)
    games = load_games()
    matched, unmatched = [], {}
    for g in games:
        h = match(g["home"], lookup) or match(g["home_seo"], lookup)
        a = match(g["away"], lookup) or match(g["away_seo"], lookup)
        if h and a and h != a:
            g["home_slug"], g["away_slug"] = h, a
            matched.append(g)
        else:
            for nm, slug in ((g["home"], h), (g["away"], a)):
                if slug is None:
                    unmatched[nm] = unmatched.get(nm, 0) + 1
    print(f"{len(games)} games parsed, {len(matched)} between two known teams, {len(unmatched)} unmatched names")
    fbs_like = {k: v for k, v in unmatched.items() if v >= 3}
    if fbs_like:
        print("unmatched names seen 3+ times (probably FBS, add an alias):", fbs_like)

    jobs = [(i, g["home_slug"], g["away_slug"], n, "neutral" if g["neutral"] else "home") for i, g in enumerate(matched)]
    with Pool(initializer=_init, initargs=(str(TEAMS_FILE),)) as pool:
        for res in pool.imap_unordered(_sim_game, jobs, chunksize=4):
            matched[res["idx"]].update(res)

    # ----- report -----
    actual = [g["home_score"] - g["away_score"] for g in matched]
    pred = [g["pred_margin"] for g in matched]
    errors = [a - p for a, p in zip(actual, pred)]
    su = sum(1 for a, p in zip(actual, pred) if (a > 0) == (p > 0)) / len(matched)
    mae = st.mean(abs(e) for e in errors)
    home_errs = [a - p for g, a, p in zip(matched, actual, pred) if not g["neutral"]]
    bias = st.mean(home_errs) if home_errs else float("nan")
    mp, ma = st.mean(pred), st.mean(actual)
    cov = sum((p - mp) * (a - ma) for p, a in zip(pred, actual)) / len(pred)
    varp = st.pvariance(pred)
    slope = cov / varp if varp else float("nan")
    corr = cov / (st.pstdev(pred) * st.pstdev(actual)) if varp else float("nan")
    rmse = (st.mean(e * e for e in errors)) ** 0.5
    tot_actual = st.mean(g["home_score"] + g["away_score"] for g in matched)
    tot_pred = st.mean(g["pred_total"] for g in matched)
    neutral_n = sum(1 for g in matched if g["neutral"])
    print(f"\n{len(matched)} games ({neutral_n} neutral site), {n} sims each")
    print(f"straight-up picks correct:      {100 * su:.1f}%   (Vegas favorites win about 75-78%)")
    print(f"margin MAE / RMSE:              {mae:.1f} / {rmse:.1f} points   (closing spreads: MAE about 12-13)")
    print(f"actual-on-predicted slope:      {slope:.2f}   (1.0 = rating gaps worth exactly what the sim says)")
    print(f"correlation:                    {corr:.2f}")
    print(f"home bias (actual - predicted): {bias:+.1f} points   (sim home edge is in the prediction already)")
    print(f"mean home margin actual/pred:   {ma:+.1f} / {mp:+.1f}")
    print(f"total points actual/pred:       {tot_actual:.1f} / {tot_pred:.1f}")

    print("\nBy predicted margin bucket (home favored by...):")
    print(f"{'bucket':>12}{'games':>7}{'pred':>8}{'actual':>8}{'home win%':>11}{'sim prob':>10}")
    buckets = [(-99, -21), (-21, -14), (-14, -7), (-7, -3), (-3, 3), (3, 7), (7, 14), (14, 21), (21, 99)]
    for lo, hi in buckets:
        rows = [g for g in matched if lo <= g["pred_margin"] < hi]
        if not rows:
            continue
        print(f"{f'{lo} to {hi}':>12}{len(rows):>7}{st.mean(g['pred_margin'] for g in rows):>8.1f}"
              f"{st.mean(g['home_score'] - g['away_score'] for g in rows):>8.1f}"
              f"{100 * st.mean(1 if g['home_score'] > g['away_score'] else 0 for g in rows):>10.0f}%"
              f"{100 * st.mean(g['home_win_prob'] for g in rows):>9.0f}%")

    print("\nWorst misses (actual margin vs predicted):")
    for g in sorted(matched, key=lambda g: -abs(g["home_score"] - g["away_score"] - g["pred_margin"]))[:12]:
        print(f"  wk{g['week']} {g['away']} {g['away_score']} at {g['home']} {g['home_score']}: "
              f"actual {g['home_score'] - g['away_score']:+d}, predicted {g['pred_margin']:+.1f}")

    RESULTS_FILE.write_text(json.dumps(matched, indent=1), encoding="utf-8")
    print(f"\nper-game results written to {RESULTS_FILE}")


if __name__ == "__main__":
    main()
