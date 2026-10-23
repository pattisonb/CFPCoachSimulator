"""Simulated seasons against the real 2026 season, team by team and week by week.

Plays N simulated 2026 seasons from week 1 up to the real season's current week (same
schedule, same opponents), snapshotting every team after every week, and lays them next
to the real results and box scores (data/seasons/real-2026.json and its boxes). Writes
one JSON file per FBS team plus a league file, for review by people or agents:

  <out>/teams/<slug>.json   real week by week vs the sims' distribution for the same game,
                            season-to-date team and player stats (real vs sim mean), the
                            team's ratings and its players' ratings, AP rank by week
  <out>/league.json         AP polls by week (real vs each sim), league per-game averages
                            by week, national leaders, upset and close-game rates
  <out>/README.md           what the fields mean

Counting note: official (real) rushing counts a sack as a rush for the yards it lost; the
engine keeps sacks apart. Sim team rushing is given both ways ("rush_yds" and "carries"
official-style, "rush_yds_engine" and "carries_engine" without sacks) so the two can be
compared like for like; sim player rushing (the QBs') is counted the official way too.

Usage (from the project root): python tools/team_reality.py [--seasons 10] [--out data/analysis/overnight]
"""
from __future__ import annotations

import argparse
import copy
import json
import shutil
import statistics as st
import sys
import time
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from engine import game_config as cfg  # noqa: E402

SACK_LOSS = cfg.SACK_YARDS[0]      # the engine's mean sack loss: what official counting moves from passing to rushing
TEAM_KEYS = {"pass_att": "Pass Attempts", "completions": "Completions", "pass_yds": "Pass Yards", "pass_td": "Passing Touchdowns",
             "int_thrown": "Interceptions Thrown", "carries": "Carries", "rush_yds_engine": "Rush Yards", "rush_td": "Rushing Touchdowns",
             "sacks_taken": "Sacks Taken", "fumbles": "Fumbles", "punts": "Punts", "fg_att": "Field Goals Attempted", "fg_made": "Field Goals Made",
             "def_sacks": "Sacks", "def_ints": "Interceptions", "forced_fumbles": "Forced Fumbles"}
PLAYER_KEYS = ["pass_attempts", "completions", "pass_yards", "passing_touchdowns", "interceptions_thrown", "carries", "rush_yards",
               "rushing_touchdowns", "receptions", "receiving_yards", "receiving_touchdowns", "solo_tackles", "assisted_tackles",
               "tackles_for_loss", "sacks", "interceptions", "forced_fumbles", "fg_made", "fg_attempted", "pat_made", "pat_attempts",
               "punts", "punt_yards", "punt_net_yards", "kickoff_returns", "kickoff_return_yards", "punt_returns", "punt_return_yards",
               "sacks_taken"]


def official_player(stats: dict) -> dict:
    """A sim player's line counted the official way: each sack taken is a carry for the
    sack's loss (real box scores count it so; the engine keeps sacks apart)."""
    out = dict(stats)
    sk = out.get("sacks_taken", 0)
    if sk:
        out["carries"] = out.get("carries", 0) + sk
        out["rush_yards"] = round(out.get("rush_yards", 0) - SACK_LOSS * sk, 1)
    return out


def line_from(team_stats: dict, points: float, plays: float, official: bool) -> dict:
    """One game's (or a per-game average's) team line in plain keys."""
    out = {k: team_stats.get(v, 0) for k, v in TEAM_KEYS.items()}
    sacks = out["sacks_taken"]
    out["rush_yds"] = out["rush_yds_engine"] if official else out["rush_yds_engine"] - SACK_LOSS * sacks
    if official:
        out["rush_yds_engine"] = None          # real box scores only have the official number
    else:
        out["carries_engine"] = out["carries"]
        out["carries"] = out["carries"] + sacks   # official counting: a sack is a rush
    out["total_yds"] = out["pass_yds"] + out["rush_yds"]
    out["points"] = points
    out["plays"] = plays
    return out


def diff(a: dict, b: dict) -> dict:
    """b - a for nested numeric dicts (one week's game from two cumulative snapshots)."""
    out = {}
    for k, v in b.items():
        if isinstance(v, dict):
            out[k] = diff(a.get(k, {}) or {}, v)
        elif isinstance(v, (int, float)):
            out[k] = v - (a.get(k, 0) or 0)
    return out


def snapshot(state: dict) -> dict:
    """Every team's cumulative team-level numbers (not players: those are taken at the end)."""
    return {t: {"games": v.get("games", 0), "wins": v.get("wins", 0), "points": v.get("points", 0), "opp_points": v.get("opp_points", 0),
                "plays": v.get("plays", 0), "opp_plays": v.get("opp_plays", 0),
                "team": dict(v.get("team") or {}), "opp": dict(v.get("opp") or {})}
            for t, v in (state.get("season_stats") or {}).items()}


def mean(xs):
    xs = [x for x in xs if x is not None]
    return round(st.mean(xs), 2) if xs else None


def avg_lines(lines: list[dict]) -> dict:
    keys = set().union(*[l.keys() for l in lines]) if lines else set()
    return {k: mean([l.get(k) for l in lines]) for k in sorted(keys)}


def real_week_lines(real: dict, teams: dict) -> dict:
    """{team: {week: {game, line, opp_line}}} from the real season and its box scores."""
    from sim import season
    out: dict = defaultdict(dict)
    for g in real["games"].values():
        if not (g["played"] and g.get("real")):
            continue
        box = season.load_box(real, g["event_id"])
        for side, opp in (("home", "away"), ("away", "home")):
            t = g[side]
            entry = {"opponent": g[opp], "opponent_name": teams[g[opp]]["name"], "venue": "neutral" if g["neutral"] else side,
                     "points": g[f"{side}_score"], "opp_points": g[f"{opp}_score"], "won": g[f"{side}_score"] > g[f"{opp}_score"]}
            if box and box.get("real_box"):
                entry["line"] = line_from(box[side]["team"], g[f"{side}_score"], box[side].get("plays") or 0, official=True)
                entry["allowed"] = line_from(box[opp]["team"], g[f"{opp}_score"], box[opp].get("plays") or 0, official=True)
            out[t][g["week"]] = entry
    return out


def ap_list(poll: dict, n: int = 40) -> list[dict]:
    rows = (poll.get("ap") or []) + (poll.get("ap_others") or [])
    return [{"rank": e["rank"], "team": e["team"], "points": e.get("points"), "first": e.get("first_place"), "record": e.get("record")} for e in rows[:n]]


def notable(d: dict) -> bool:
    """A season-to-date line worth listing: a real role on offense, defense or special teams."""
    return (d["pass_attempts"] >= 20 or d["carries"] >= 15 or d["receptions"] >= 8 or d["solo_tackles"] + d["assisted_tackles"] >= 15
            or d["sacks"] >= 1.5 or d["interceptions"] >= 1 or d["fg_attempted"] >= 3 or d["punts"] >= 5)


def upset_rate(games: list[dict], rank: dict) -> float | None:
    """Share of games with a ranked team that a lower-ranked or unranked team won."""
    ranked = [g for g in games if rank.get(g["home"]) or rank.get(g["away"])]
    ups = 0
    for g in ranked:
        hw = g["home_score"] > g["away_score"]
        wr, lr = (rank.get(g["home"]), rank.get(g["away"])) if hw else (rank.get(g["away"]), rank.get(g["home"]))
        ups += bool(lr) and (not wr or wr > lr)
    return round(ups / len(ranked), 3) if ranked else None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--seasons", type=int, default=10)
    ap.add_argument("--out", default="data/analysis/overnight")
    a = ap.parse_args()
    from sim import season
    teams = season.load_teams()
    real = season.load_season("real-2026")
    if real is None:
        raise SystemExit("build the real season first: python -m sim.realdata")
    W = real["current_week"]
    out = ROOT / a.out
    (out / "teams").mkdir(parents=True, exist_ok=True)
    fbs = [s for s, t in teams.items() if not t["fictional"]]

    sims = []
    for i in range(a.seasons):
        t0 = time.perf_counter()
        stt = season.new_season("ohio-state", "full", seed=1000 + i)
        weekly = {0: snapshot(stt)}
        polls = {0: ap_list(stt["polls"]["0"])}
        games = defaultdict(dict)
        for w in range(1, W + 1):
            season.advance_to(stt, w)
            weekly[w] = snapshot(stt)
            polls[w] = ap_list(stt["polls"].get(str(w), {}))
            for g in stt["games"].values():
                if g["week"] == w and g["played"]:
                    for side, opp in (("home", "away"), ("away", "home")):
                        games[g[side]][w] = {"opponent": g[opp], "points": g[f"{side}_score"], "opp_points": g[f"{opp}_score"],
                                             "won": g[f"{side}_score"] > g[f"{opp}_score"]}
        players = {t: {k: {"name": p["name"], "position": p["position"], "games": p["games"],
                           "stats": official_player({s_: p["stats"].get(s_, 0) for s_ in PLAYER_KEYS})}
                       for k, p in v.get("players", {}).items()} for t, v in stt["season_stats"].items()}
        morale = copy.deepcopy(stt.get("morale") or {})
        sims.append({"weekly": weekly, "polls": polls, "games": games, "players": players, "morale": morale})
        shutil.rmtree(season.SEASONS_DIR / stt["id"], ignore_errors=True)   # the sims' box scores; the seasons are never saved
        print(f"sim season {i + 1}/{a.seasons}: weeks 1-{W} in {time.perf_counter() - t0:.0f}s", flush=True)
    season.close_pool()

    real_lines = real_week_lines(real, teams)
    real_polls = {w: ap_list(real["polls"].get(str(w), {})) for w in range(0, W + 1)}
    real_rank = {w: {e["team"]: e for e in real_polls[w]} for w in real_polls}

    def sim_week_line(s: dict, t: str, w: int, key: str) -> dict | None:
        a_, b = s["weekly"][w - 1].get(t), s["weekly"][w].get(t)
        if not b or (a_ and a_["games"] == b["games"]):
            return None
        d = diff(a_ or {}, b)
        src = d.get("team" if key == "line" else "opp", {})
        pts = d.get("points" if key == "line" else "opp_points", 0)
        return line_from(src, pts, d.get("plays" if key == "line" else "opp_plays", 0), official=False)

    for t in fbs:
        info = teams[t]
        weeks = []
        for w in range(1, W + 1):
            r = real_lines.get(t, {}).get(w)
            sg = [s["games"].get(t, {}).get(w) for s in sims]
            sg = [x for x in sg if x]
            if not r and not sg:
                weeks.append({"week": w, "bye": True})
                continue
            sl = [sim_week_line(s, t, w, "line") for s in sims]
            sa = [sim_week_line(s, t, w, "allowed") for s in sims]
            weeks.append({
                "week": w, "real": r,
                "sim": {"games": len(sg), "win_pct": round(sum(x["won"] for x in sg) / len(sg), 2) if sg else None,
                        "points": mean([x["points"] for x in sg]), "opp_points": mean([x["opp_points"] for x in sg]),
                        "scores": [f"{x['points']}-{x['opp_points']}" for x in sg],
                        "line": avg_lines([x for x in sl if x]), "allowed": avg_lines([x for x in sa if x])},
                "ap": {"real": (real_rank.get(w, {}).get(t) or {}).get("rank"),
                       "real_points": (real_rank.get(w, {}).get(t) or {}).get("points"),
                       "sim_ranks": [next((e["rank"] for e in s["polls"][w][:25] if e["team"] == t), None) for s in sims]}})
        real_wins = sum(1 for wk in weeks if (wk.get("real") or {}).get("won"))
        real_losses = sum(1 for wk in weeks if wk.get("real") and not wk["real"].get("won"))
        sim_records = []
        for s in sims:
            gs = s["games"].get(t, {})
            sim_records.append(f"{sum(1 for x in gs.values() if x['won'])}-{sum(1 for x in gs.values() if not x['won'])}")
        # season-to-date players: real (matched names) vs the sims' mean, any player with a role in either
        rp = (real.get("season_stats") or {}).get(t, {}).get("players", {})
        keys = set(rp)
        for s in sims:
            keys |= set(s["players"].get(t, {}))
        roster = {f"{p['name']}|{p['position']}": p for p in info["offense"] + info["defense"]}
        players = []
        for k in keys:
            real_p = rp.get(k)
            sim_ps = [s["players"].get(t, {}).get(k) for s in sims]
            sim_ps = [x for x in sim_ps if x]
            sim_mean = {s_: round(sum(x["stats"].get(s_, 0) for x in sim_ps) / len(sims), 1) for s_ in PLAYER_KEYS}
            real_stats = {s_: (real_p or {}).get("stats", {}).get(s_, 0) for s_ in PLAYER_KEYS}
            if not (notable(real_stats) or notable(sim_mean)):
                continue
            r_ = roster.get(k)
            players.append({"key": k, "name": k.split("|")[0], "position": k.split("|")[1],
                            "in_real_box_scores": real_p is not None, "real_games": (real_p or {}).get("games", 0),
                            "sim_games_mean": round(sum(x["games"] for x in sim_ps) / len(sims), 1),
                            "real": {s_: v for s_, v in real_stats.items() if v}, "sim_mean": {s_: v for s_, v in sim_mean.items() if v},
                            "sim_form_at_week": [round(((s["morale"].get("players") or {}).get(t) or {}).get(k, 0.0), 3) for s in sims],
                            "rating": ({"overall": season.shown_overall(r_), "ea_overall": r_.get("ea_overall"), "depth": r_.get("depth"),
                                        "role": r_.get("role"), "starter": bool(r_.get("in_game")),
                                        "attributes": {a_: r_[a_] for a_ in ("speed", "strength", "passing", "decision_making", "elusiveness", "vision", "hands",
                                                                            "route_running", "run_blocking", "pass_blocking", "rushing", "tackling", "coverage",
                                                                            "kick_power", "kick_accuracy", "punt_power", "punt_accuracy") if isinstance(r_.get(a_), (int, float))},
                                        "target_mult": r_.get("target_mult")} if r_ else None)})
        players.sort(key=lambda p: -(p["real"].get("pass_yards", 0) + p["real"].get("rush_yards", 0) + p["real"].get("receiving_yards", 0)
                                     + 10 * (p["real"].get("solo_tackles", 0) + p["real"].get("assisted_tackles", 0))
                                     + p["sim_mean"].get("pass_yards", 0) + p["sim_mean"].get("rush_yards", 0) + p["sim_mean"].get("receiving_yards", 0)))
        real_line = avg_lines([wk["real"]["line"] for wk in weeks if (wk.get("real") or {}).get("line")])
        real_allowed = avg_lines([wk["real"]["allowed"] for wk in weeks if (wk.get("real") or {}).get("allowed")])
        sim_line = avg_lines([wk["sim"]["line"] for wk in weeks if (wk.get("sim") or {}).get("line")])
        sim_allowed = avg_lines([wk["sim"]["allowed"] for wk in weeks if (wk.get("sim") or {}).get("allowed")])
        # season._decay_morale drops values under 0.02, so a missing team is at 0
        team_morale = [((s["morale"] or {}).get("teams") or {}).get(t, 0.0) for s in sims]
        doc = {"team": t, "name": info["name"], "conference": info["conference"], "tier": season.tier_of(info),
               "through_week": W, "sim_seasons": a.seasons,
               "record": {"real": f"{real_wins}-{real_losses}", "sim": sim_records,
                          "sim_mean_wins": mean([int(r.split("-")[0]) for r in sim_records])},
               "team_ratings": info.get("team_ratings"), "tendencies": info.get("tendencies"),
               "coaches": {k: {"name": v.get("name"), "scheme": v.get("scheme")} for k, v in (info.get("coaches") or {}).items()},
               "per_game": {"real_offense": real_line, "sim_offense": sim_line, "real_defense_allowed": real_allowed, "sim_defense_allowed": sim_allowed},
               "weeks": weeks, "players": players[:45],
               "sim_team_morale_at_week": team_morale,
               "notes": ["rush_yds and carries count sacks as rushes (official, sim players too); sim rush_yds_engine and carries_engine leave them out",
                         "plays_allowed is the opponents' plays",
                         "real player lines match a roster player about 93% of the time; unmatched real players appear only under 'real' with no rating",
                         "sim_mean player stats average over all sim seasons (a player who did not play in a season counts as 0)"]}
        (out / "teams" / f"{t}.json").write_text(json.dumps(doc, indent=1), encoding="utf-8")

    # league file
    league_weeks = []
    for w in range(1, W + 1):
        real_games = [g for g in real["games"].values() if g["week"] == w and g["played"] and g.get("real")]
        r_rank = {e["team"]: e["rank"] for e in real_polls[w - 1][:25]}
        sim_rates = []
        for s in sims:
            s_rank = {e["team"]: e["rank"] for e in s["polls"][w - 1][:25]}
            sg = []
            for t, gs in s["games"].items():
                g = gs.get(w)
                if g:
                    sg.append({"home": t, "away": g["opponent"], "home_score": g["points"], "away_score": g["opp_points"]})
            sim_rates.append(upset_rate([g for g in sg if g["home"] < g["away"]], s_rank))
        league_weeks.append({"week": w,
                             "real_games": len(real_games),
                             "real_mean_total_points": mean([g["home_score"] + g["away_score"] for g in real_games]),
                             "real_mean_margin": mean([abs(g["home_score"] - g["away_score"]) for g in real_games]),
                             "real_upset_rate_vs_ranked": upset_rate(real_games, r_rank),
                             "sim_upset_rate_vs_ranked": sim_rates,
                             "real_ap": real_polls[w][:25], "sim_ap": [s["polls"][w][:25] for s in sims]})
    nat = {}
    for key in ("pass_yards", "rush_yards", "receiving_yards", "sacks", "interceptions"):
        real_vals = sorted(((p["stats"].get(key, 0), p["name"], t) for t, v in real["season_stats"].items() if not teams[t]["fictional"]
                            for p in v["players"].values()), reverse=True)[:15]
        sim_vals = [sorted(((p["stats"].get(key, 0), p["name"], t) for t, v in s["players"].items() if not teams[t]["fictional"]
                            for p in v.values()), reverse=True)[:15] for s in sims]
        nat[key] = {"real_top15": real_vals, "sim_top15_each_season": sim_vals}
    (out / "league.json").write_text(json.dumps({"through_week": W, "sim_seasons": a.seasons, "weeks": league_weeks, "national_leaders": nat,
                                                 "real_ap_preseason": real_polls[0][:25], "sim_ap_preseason": sims[0]["polls"][0][:25]}, indent=1), encoding="utf-8")
    (out / "README.md").write_text(__doc__, encoding="utf-8")
    print(f"wrote {len(fbs)} team files and league.json to {out}")


if __name__ == "__main__":
    main()
