"""Derive each team's observed 2026 tendencies from real box scores.

Reads data/boxscores/*.json (fetch_boxscores.py) and data/season_games.json and writes
data/observed_tendencies.json with, per team slug: games, pass rate, plays per game,
QB1 and all-QB carry shares of all rushes, sacks taken as a share of rushes, RB1 and RB2 share of non-QB carries, top receiver share
of catches, fourth-down attempts per game, average scoring margin. build_teams.py blends these into the team
tendencies the engine uses, so a team that throws 60% of the time in real life throws
about 60% of the time in the sim.
"""
from __future__ import annotations
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `import season` works from here

import json
import statistics as st
from pathlib import Path

from teamnames import build_matcher, match
from calibrate_players import real_team_metrics

ROOT = Path(__file__).resolve().parents[1]
GAMES_FILE = ROOT / "data" / "season_games.json"
BOX_DIR = ROOT / "data" / "boxscores"
TEAMS_FILE = ROOT / "data" / "engine_teams.json"
OUT = ROOT / "data" / "observed_tendencies.json"


def main() -> None:
    teams = json.loads(TEAMS_FILE.read_text(encoding="utf-8"))["teams"]
    lookup = build_matcher(teams)
    roster_qbs = {slug: {p["name"].strip().upper() for p in t.get("offense", []) if p.get("position") == "QB"} for slug, t in teams.items()}
    games = [g for g in json.loads(GAMES_FILE.read_text(encoding="utf-8")) if g.get("final")]
    per_team: dict[str, list[dict]] = {}
    for g in games:
        path = BOX_DIR / f"{g['contest_id']}.json"
        if not path.exists():
            continue
        box = json.loads(path.read_text(encoding="utf-8"))["data"]["boxscore"]
        by_id = {str(t["teamId"]): t for t in box["teams"]}
        for tb in box["teamBoxscore"]:
            info = by_id.get(str(tb["teamId"]))
            if not info:
                continue
            slug = match(info.get("nameShort", ""), lookup) or match(info.get("seoname", ""), lookup)
            if not slug:
                continue
            m = real_team_metrics(tb)
            m["fourth_att"] = float(tb["teamStats"].get("fourthDownAttempts") or 0)
            m["qb_rush_share"] = 100 * m["qb_rush_att"] / max(1.0, m["rush_att"])
            # every quarterback's carries (a run-package QB2 too): anyone who threw a pass, or
            # who is on the roster as a QB; and the sacks the team took (the other side's
            # defense line), which college box scores count as QB rushes
            qbs = {f"{p.get('firstName', '')} {p.get('lastName', '')}".strip().upper() for p in tb["playerStats"]
                   if p.get("category") == "passing" and float(p.get("passingAttempts") or 0) > 0}
            qbs |= roster_qbs.get(slug, set())
            m["qb_all_rush_att"] = sum(float(p.get("rushingAttempts") or 0) for p in tb["playerStats"] if p.get("category") == "rushing"
                                       and f"{p.get('firstName', '')} {p.get('lastName', '')}".strip().upper() in qbs)
            home = info.get("seoname") == g.get("home_seo")
            m["margin"] = (g["home_score"] - g["away_score"]) * (1 if home else -1) if g.get("home_score") is not None else 0.0
            opp = next((o for o in box["teamBoxscore"] if str(o["teamId"]) != str(tb["teamId"])), None)
            m["sacks_taken"] = float(((opp or {}).get("teamStats") or {}).get("TeamDefenseStats", {}).get("sacks") or 0)
            per_team.setdefault(slug, []).append(m)

    out = {}
    for slug, rows in per_team.items():
        n = len(rows)
        tot_pass = sum(r["pass_att"] for r in rows)
        tot_rush = sum(r["rush_att"] for r in rows)
        out[slug] = {
            "games": n,
            "pass_rate": round(100 * tot_pass / max(1.0, tot_pass + tot_rush), 1),
            "plays_per_game": round(st.mean(r["plays"] for r in rows), 1),
            "qb_rush_share": round(100 * sum(r["qb_rush_att"] for r in rows) / max(1.0, tot_rush), 1),
            "qb_all_rush_share": round(100 * sum(r["qb_all_rush_att"] for r in rows) / max(1.0, tot_rush), 1),
            "sack_share": round(100 * sum(r["sacks_taken"] for r in rows) / max(1.0, tot_rush), 1),
            "rb1_share": round(st.mean(r["rb1_share"] for r in rows), 1),
            "rb2_share": round(st.mean(r["rb2_share"] for r in rows), 1),
            "wr1_share": round(st.mean(r["wr1_share"] for r in rows), 1),
            "fourth_att_per_game": round(st.mean(r["fourth_att"] for r in rows), 2),
            "margin_per_game": round(st.mean(r["margin"] for r in rows), 1),
        }
    league = {k: round(st.mean(v[k] for v in out.values()), 1)
              for k in ("pass_rate", "plays_per_game", "qb_rush_share", "qb_all_rush_share", "sack_share", "rb1_share", "rb2_share",
                        "wr1_share", "fourth_att_per_game")}
    OUT.write_text(json.dumps({"league": league, "teams": out}, indent=1), encoding="utf-8")
    print(f"{len(out)} teams, league averages {league}")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
