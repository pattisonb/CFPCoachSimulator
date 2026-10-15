"""Compare the sim's player stat lines and usage shares with real 2026 box scores.

Input: data/season_games.json (fetch_results.py), data/boxscores/*.json (fetch_boxscores.py),
data/engine_teams.json (build_teams.py). Every final game with a box score between two
known teams is simulated N times at the real venue; per team-game the same metrics are
computed from the real box score and from the sim's player stats, then averaged.

Usage:
    python calibrate_players.py          # 8 sims per game
    python calibrate_players.py 20

Reports: team usage (pass rate, plays), QB1 line, RB1/RB2 carry shares, top receivers'
reception shares, kicker usage, and whether the sim's starters are the real starters.
"""
from __future__ import annotations

import json
import statistics as st
import sys
from multiprocessing import Pool
from pathlib import Path

from calibrate_season import build_matcher, match

ROOT = Path(__file__).resolve().parent
GAMES_FILE = ROOT / "data" / "season_games.json"
BOX_DIR = ROOT / "data" / "boxscores"
TEAMS_FILE = ROOT / "data" / "engine_teams.json"


def num(x) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def real_team_metrics(team_box: dict) -> dict:
    """Usage and stat lines for one team from an NCAA box score."""
    ps = team_box["playerStats"]
    ts = team_box["teamStats"]
    passers = sorted([p for p in ps if p.get("category") == "passing"], key=lambda p: -num(p.get("passingAttempts")))
    rushers = sorted([p for p in ps if p.get("category") == "rushing"], key=lambda p: -num(p.get("rushingAttempts")))
    receivers = sorted([p for p in ps if p.get("category") == "receiving"], key=lambda p: -num(p.get("receivingReceptions")))
    kickers = [p for p in ps if p.get("category") == "kicking"]
    qb = passers[0] if passers else {}
    qb_name = f"{qb.get('firstName', '')} {qb.get('lastName', '')}".strip().upper()
    backs = [r for r in rushers if f"{r.get('firstName', '')} {r.get('lastName', '')}".strip().upper() != qb_name]
    pass_att = num(ts["TeamPassingStats"]["passingAttempts"])
    rush_att = num(ts["TeamRushingStats"]["rushingAttempts"])
    rb_att = sum(num(r.get("rushingAttempts")) for r in backs) or 1.0
    recs = sum(num(r.get("receivingReceptions")) for r in receivers) or 1.0
    fga = sum(num(k.get("fieldGoalsAttempted") or k.get("fgAttempts") or 0) for k in kickers)
    return {
        "pass_att": pass_att, "rush_att": rush_att,
        "pass_rate": 100 * pass_att / max(1.0, pass_att + rush_att),
        "plays": num(ts.get("teamPlays")), "yards": num(ts.get("teamYards")),
        "qb_name": qb_name, "qb_att": num(qb.get("passingAttempts")), "qb_cmp": num(qb.get("passingCompletions")),
        "qb_yds": num(qb.get("passingYards")), "qb_td": num(qb.get("passingTDs")), "qb_int": num(qb.get("passingInterceptions")),
        "qb_rush_att": num(next((r.get("rushingAttempts") for r in rushers
                                 if f"{r.get('firstName', '')} {r.get('lastName', '')}".strip().upper() == qb_name), 0)),
        "rb1_name": f"{backs[0].get('firstName', '')} {backs[0].get('lastName', '')}".strip().upper() if backs else "",
        "rb1_att": num(backs[0].get("rushingAttempts")) if backs else 0.0,
        "rb1_yds": num(backs[0].get("rushingYards")) if backs else 0.0,
        "rb1_share": 100 * (num(backs[0].get("rushingAttempts")) if backs else 0.0) / rb_att,
        "rb2_share": 100 * (num(backs[1].get("rushingAttempts")) if len(backs) > 1 else 0.0) / rb_att,
        "wr1_name": f"{receivers[0].get('firstName', '')} {receivers[0].get('lastName', '')}".strip().upper() if receivers else "",
        "wr1_rec": num(receivers[0].get("receivingReceptions")) if receivers else 0.0,
        "wr1_yds": num(receivers[0].get("receivingYards")) if receivers else 0.0,
        "wr1_share": 100 * (num(receivers[0].get("receivingReceptions")) if receivers else 0.0) / recs,
        "top3_share": 100 * sum(num(r.get("receivingReceptions")) for r in receivers[:3]) / recs,
        "n_receivers": sum(1 for r in receivers if num(r.get("receivingReceptions")) > 0),
        "n_rushers": sum(1 for r in backs if num(r.get("rushingAttempts")) > 0),
        "fga": fga,
        "third_pct": 100 * num(ts.get("thirdDowns")) / max(1.0, num(ts.get("thirdDownAttempts"))),
        "penalties": num(ts.get("penalty")),
    }


def sim_team_metrics(team: dict) -> dict:
    """The same metrics from one simulated game's player stats."""
    P = team["players"]
    s = team["team_stats"]
    ev = team["team_events"]
    g = lambda p, k: p["stats"].get(k, 0)
    qbs = sorted([p for p in P if g(p, "pass_attempts")], key=lambda p: -g(p, "pass_attempts"))
    qb = qbs[0] if qbs else None
    backs = sorted([p for p in P if p["position"] != "QB" and g(p, "carries")], key=lambda p: -g(p, "carries"))
    receivers = sorted([p for p in P if g(p, "receptions")], key=lambda p: -g(p, "receptions"))
    rb_att = sum(g(p, "carries") for p in backs) or 1
    recs = sum(g(p, "receptions") for p in receivers) or 1
    # College stats count sacks as rushing attempts (negative yards) for the quarterback.
    pass_att, rush_att = s["Pass Attempts"], s["Carries"] + s["Sacks Taken"]
    return {
        "pass_att": pass_att, "rush_att": rush_att, "pass_rate": 100 * pass_att / max(1, pass_att + rush_att),
        "plays": pass_att + rush_att, "yards": s["Pass Yards"] + s["Rush Yards"],
        "qb_name": qb["name"].upper() if qb else "", "qb_att": g(qb, "pass_attempts") if qb else 0,
        "qb_cmp": g(qb, "completions") if qb else 0, "qb_yds": g(qb, "pass_yards") if qb else 0,
        "qb_td": g(qb, "passing_touchdowns") if qb else 0, "qb_int": g(qb, "interceptions_thrown") if qb else 0,
        "qb_rush_att": (g(qb, "carries") + g(qb, "sacks_taken")) if qb else 0,
        "rb1_name": backs[0]["name"].upper() if backs else "", "rb1_att": g(backs[0], "carries") if backs else 0,
        "rb1_yds": g(backs[0], "rush_yards") if backs else 0,
        "rb1_share": 100 * (g(backs[0], "carries") if backs else 0) / rb_att,
        "rb2_share": 100 * (g(backs[1], "carries") if len(backs) > 1 else 0) / rb_att,
        "wr1_name": receivers[0]["name"].upper() if receivers else "", "wr1_rec": g(receivers[0], "receptions") if receivers else 0,
        "wr1_yds": g(receivers[0], "receiving_yards") if receivers else 0,
        "wr1_share": 100 * (g(receivers[0], "receptions") if receivers else 0) / recs,
        "top3_share": 100 * sum(g(p, "receptions") for p in receivers[:3]) / recs,
        "n_receivers": len(receivers), "n_rushers": len(backs),
        "fga": s["Field Goals Attempted"],
        "third_pct": 100 * ev.get("third_down_conversions", 0) / max(1, ev.get("third_downs", 0)),
        "penalties": ev.get("penalties", 0),
    }


_TEAMS: dict = {}


def _init(path: str) -> None:
    global _TEAMS
    _TEAMS = json.loads(Path(path).read_text(encoding="utf-8"))["teams"]


NUMERIC = ["pass_att", "rush_att", "pass_rate", "plays", "yards", "qb_att", "qb_cmp", "qb_yds", "qb_td", "qb_int",
           "qb_rush_att", "rb1_att", "rb1_yds", "rb1_share", "rb2_share", "wr1_rec", "wr1_yds", "wr1_share",
           "top3_share", "n_receivers", "n_rushers", "fga", "third_pct", "penalties"]


def _sim_game(args: tuple) -> dict:
    from engine.game import simulate_game
    idx, home, away, n, venue = args
    acc = {"home": {k: [] for k in NUMERIC}, "away": {k: [] for k in NUMERIC}}
    names = {"home": {"qb": [], "rb1": [], "wr1": []}, "away": {"qb": [], "rb1": [], "wr1": []}}
    for i in range(n):
        r = simulate_game(_TEAMS[home], _TEAMS[away], seed=idx * 777 + i, venue=venue)
        for side in ("home", "away"):
            m = sim_team_metrics(r[side])
            for k in NUMERIC:
                acc[side][k].append(m[k])
            names[side]["qb"].append(m["qb_name"]); names[side]["rb1"].append(m["rb1_name"]); names[side]["wr1"].append(m["wr1_name"])
    out = {"idx": idx}
    for side in ("home", "away"):
        out[side] = {k: st.mean(v) for k, v in acc[side].items()}
        for role in ("qb", "rb1", "wr1"):
            vals = names[side][role]
            out[side][role + "_name"] = max(set(vals), key=vals.count) if vals else ""
    return out


def main() -> None:
    n = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 8
    teams = json.loads(TEAMS_FILE.read_text(encoding="utf-8"))["teams"]
    lookup = build_matcher(teams)
    games = [g for g in json.loads(GAMES_FILE.read_text(encoding="utf-8")) if g.get("final")]
    rows = []
    for g in games:
        path = BOX_DIR / f"{g['contest_id']}.json"
        if not path.exists():
            continue
        h = match(g["home_name"], lookup) or match(g["home_seo"], lookup)
        a = match(g["away_name"], lookup) or match(g["away_seo"], lookup)
        if not h or not a or h == a:
            continue
        box = json.loads(path.read_text(encoding="utf-8"))["data"]["boxscore"]
        by_id = {t["teamId"]: t for t in box["teams"]}
        real = {}
        for tb in box["teamBoxscore"]:
            info = by_id.get(str(tb["teamId"])) or by_id.get(tb["teamId"])
            side = "home" if info and info.get("isHome") else "away"
            real[side] = real_team_metrics(tb)
        if "home" not in real or "away" not in real:
            continue
        rows.append({"game": g, "home_slug": h, "away_slug": a, "real": real})
    print(f"{len(rows)} games with box scores between known teams")

    jobs = [(i, r["home_slug"], r["away_slug"], n, "neutral" if r["game"].get("neutral") else "home") for i, r in enumerate(rows)]
    with Pool(initializer=_init, initargs=(str(TEAMS_FILE),)) as pool:
        for res in pool.imap_unordered(_sim_game, jobs, chunksize=4):
            rows[res["idx"]]["sim"] = {"home": res["home"], "away": res["away"]}

    labels = {
        "pass_rate": "Pass rate % (att / att+rush)", "pass_att": "Pass attempts", "rush_att": "Rush attempts",
        "plays": "Plays", "yards": "Total yards", "qb_att": "QB1 attempts", "qb_cmp": "QB1 completions",
        "qb_yds": "QB1 pass yards", "qb_td": "QB1 pass TD", "qb_int": "QB1 INT", "qb_rush_att": "QB1 carries",
        "rb1_att": "RB1 carries", "rb1_yds": "RB1 rush yards", "rb1_share": "RB1 share of RB carries %",
        "rb2_share": "RB2 share of RB carries %", "n_rushers": "Non-QB rushers used",
        "wr1_rec": "Top receiver receptions", "wr1_yds": "Top receiver yards", "wr1_share": "Top receiver share of catches %",
        "top3_share": "Top 3 receivers share %", "n_receivers": "Receivers with a catch",
        "fga": "FG attempts", "third_pct": "Third down %", "penalties": "Penalties",
    }
    print(f"\n{'metric (per team-game)':<36}{'real':>8}{'sim':>8}{'bias':>8}{'MAE':>8}{'corr':>7}")
    for k, label in labels.items():
        real = [r["real"][s][k] for r in rows for s in ("home", "away")]
        sim = [r["sim"][s][k] for r in rows for s in ("home", "away")]
        bias = st.mean(x - y for x, y in zip(sim, real))
        mae = st.mean(abs(x - y) for x, y in zip(sim, real))
        mr, ms = st.mean(real), st.mean(sim)
        cov = sum((x - ms) * (y - mr) for x, y in zip(sim, real)) / len(sim)
        corr = cov / (st.pstdev(sim) * st.pstdev(real)) if st.pstdev(sim) and st.pstdev(real) else float("nan")
        print(f"{label:<36}{mr:>8.1f}{ms:>8.1f}{bias:>+8.1f}{mae:>8.1f}{corr:>7.2f}")

    def same(a: str, b: str) -> bool:
        return bool(a) and bool(b) and (a == b or a.split()[-1] == b.split()[-1])
    for role, label in (("qb", "QB1"), ("rb1", "top running back"), ("wr1", "top receiver")):
        hits = sum(1 for r in rows for s in ("home", "away") if same(r["sim"][s][role + "_name"], r["real"][s][role + "_name"]))
        print(f"sim's {label} is the real {label}: {100 * hits / (2 * len(rows)):.0f}% of team-games")
    print("\nbias = sim minus real; corr = does the sim know which teams/players get more (1.0 = perfect ordering)")


if __name__ == "__main__":
    main()
