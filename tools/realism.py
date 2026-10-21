"""How realistic are a simulated season's stats? Simulated full seasons (bowls and playoff
included) against real FBS seasons (tools/fetch_leaders.py: 2023-2025 national top 100s
and every team's per-game offense), plus the same seasons at week 8 against the real 2026
box scores through week 8 (the real season page's stats).

Usage (from the project root):
    python tools/realism.py              # 2 simulated seasons
    python tools/realism.py --seeds 3    # more seasons, steadier numbers
    python tools/realism.py --no-2026    # skip the week-8 comparison
    python tools/realism.py --json out.json   # also write the numbers (for tools/realism_pdf.py --fullseason)
Prints the leaders at ranks 1-100 in each category, the players over the usual marks, the
net punting leaders, team scoring and offense from best to worst with tempo (plays per
game) and efficiency (yards per play) split out, and a one-line score per area (mean
|sim/real - 1| over the ranks shown) to tune against.
"""
from __future__ import annotations

import argparse
import copy
import json
import statistics as st
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

HISTORY = ROOT / "data" / "history" / "fbs_leaders.json"
REAL_2026 = ROOT / "data" / "seasons" / "real-2026.json"
YEARS = ("2023", "2024", "2025")
SACK_LOSS = 7.5      # engine/game_config.SACK_YARDS mean: official stats count a sack as a run for its loss
RANKS = (1, 5, 10, 25, 50, 100)
PUNT_QUALIFY = 40   # punts in a season to rank among the net punting leaders
TEAM_RANKS = ("best", "10th", "25%", "median", "75%", "worst")

# name, label, sim value from a player's season stats, the real table and column
CATS = [("pass_yards", "Passing yards", lambda s: s.get("pass_yards", 0), "Yards"),
        ("pass_att", "Pass attempts", lambda s: s.get("pass_attempts", 0), ("pass_yards", "Att")),
        ("rush_yards", "Rushing yards", lambda s: s.get("rush_yards", 0), "Yards"),
        ("rush_att", "Carries", lambda s: s.get("carries", 0), ("rush_yards", "Att")),
        ("rec_yards", "Receiving yards", lambda s: s.get("receiving_yards", 0), "Yards"),
        ("receptions", "Receptions", lambda s: s.get("receptions", 0), ("rec_yards", "Rec.")),
        ("tackles", "Tackles", lambda s: s.get("solo_tackles", 0) + s.get("assisted_tackles", 0), "Total"),
        ("sacks", "Sacks", lambda s: s.get("sacks", 0), "Sacks"),
        ("interceptions", "Interceptions", lambda s: s.get("interceptions", 0), "Int.")]
MARKS = [("pass_yards", 4000), ("pass_yards", 3000), ("rush_yards", 1000), ("rec_yards", 1000),
         ("sacks", 10), ("tackles", 100), ("interceptions", 5)]


def real_values(hist: dict, year: str, cat: tuple) -> list[float]:
    name, _, _, col = cat
    table, column = (name, col) if isinstance(col, str) else col
    t = hist[year][table]
    i = t["columns"].index(column)
    return sorted((r[i] for r in t["rows"]), reverse=True)


def real_teams(hist: dict, year: str) -> dict[str, list[float]]:
    sc = hist[year]["team_scoring"]
    to = hist[year]["team_total_offense"]
    c = to["columns"]
    g, pl, ty, ry, py = (c.index(k) for k in ("G", "Plays", "Total Yards", "Rush Yards", "Pass Yards"))
    sg, sp = sc["columns"].index("G"), sc["columns"].index("Points")
    return {"ppg": [r[sp] / r[sg] for r in sc["rows"] if r[sg]],
            "ypg": [r[ty] / r[g] for r in to["rows"] if r[g]],
            "plays": [r[pl] / r[g] for r in to["rows"] if r[g]],
            "ypp": [r[ty] / r[pl] for r in to["rows"] if r[pl]],
            "pass_ypg": [r[py] / r[g] for r in to["rows"] if r[g]],
            "rush_ypg": [r[ry] / r[g] for r in to["rows"] if r[g]]}


def sim_players(season_stats: dict, teams: dict) -> dict[str, list[float]]:
    out = {}
    for name, _, f, _ in CATS:
        vals = [f(p["stats"]) for slug, t in season_stats.items() if not teams[slug]["fictional"] for p in t["players"].values()]
        out[name] = sorted(vals, reverse=True)
    return out


def sim_teams(season_stats: dict, teams: dict, official: bool = False) -> dict[str, list[float]]:
    """Per-game team numbers. The sim keeps sacks apart from rushing, so its sack losses come
    off rushing here; `official` stats (real box scores) already count them that way."""
    out = {k: [] for k in ("ppg", "ypg", "plays", "ypp", "pass_ypg", "rush_ypg")}
    for slug, t in season_stats.items():
        if teams[slug]["fictional"] or not t.get("games"):
            continue
        g, ts = t["games"], t["team"]
        # counted the official way: a sack is a rushing play for the yards it lost
        rush = ts.get("Rush Yards", 0) - (0 if official else SACK_LOSS * ts.get("Sacks Taken", 0))
        yards = ts.get("Pass Yards", 0) + rush
        plays = t.get("plays") or (ts.get("Pass Attempts", 0) + ts.get("Carries", 0) + ts.get("Sacks Taken", 0))
        out["ppg"].append(t["points"] / g)
        out["ypg"].append(yards / g)
        out["plays"].append(plays / g)
        out["ypp"].append(yards / plays if plays else 0)
        out["pass_ypg"].append(ts.get("Pass Yards", 0) / g)
        out["rush_ypg"].append(rush / g)
    return out


def at(vals: list[float], r: int) -> float:
    return vals[r - 1] if len(vals) >= r else float("nan")


def spots(vals: list[float]) -> dict[str, float]:
    v = sorted(vals, reverse=True)
    n = len(v)
    return {"best": v[0], "10th": v[9], "25%": v[n // 4], "median": st.median(v), "75%": v[(3 * n) // 4], "worst": v[-1]}


def simulate(seeds: list[int], snapshot_week: int | None) -> tuple[list[dict], list[dict]]:
    import season
    ends, snaps = [], []
    for seed in seeds:
        t0 = time.perf_counter()
        s = season.new_season("ohio-state", "full", seed=seed)
        if snapshot_week:
            season.advance_to(s, snapshot_week)
            snaps.append(copy.deepcopy(s["season_stats"]))
        season.advance_to(s, 20)
        ends.append(s["season_stats"])
        print(f"  season seed {seed}: {time.perf_counter() - t0:.0f}s", flush=True)
    season.close_pool()
    return ends, snaps


def report(ends: list[dict], snaps: list[dict], teams: dict, data: dict | None = None) -> str:
    """The text report; with `data`, also fills it with the same numbers for charts (--json)."""
    data = {} if data is None else data
    data.update({"seasons": len(ends), "years": list(YEARS), "ranks": list(RANKS), "team_ranks": list(TEAM_RANKS),
                 "leaders": {}, "marks": [], "teams": {}, "tackle_shares": {}, "area_off": {}})
    hist = json.loads(HISTORY.read_text(encoding="utf-8"))
    sp = [sim_players(e, teams) for e in ends]
    stm = [sim_teams(e, teams) for e in ends]
    lines = [f"END OF SEASON: {len(ends)} simulated season(s) vs real {', '.join(YEARS)} (sim / real average, gap)"]
    area_err = {}
    for cat in CATS:
        name, label = cat[0], cat[1]
        reals = {y: real_values(hist, y, cat) for y in YEARS}
        cells, errs = [], []
        for r in RANKS:
            sim = st.mean(at(x[name], r) for x in sp)
            real = st.mean(at(reals[y], r) for y in YEARS)
            gap = sim / real - 1 if real else 0.0
            if r <= 50:
                errs.append(abs(gap))
            cells.append(f"#{r} {sim:.0f}/{real:.0f} {100 * gap:+.0f}%")
            leader = data["leaders"].setdefault(name, {"label": label, "sim": [], "real": []})
            leader["sim"].append(sim)
            leader["real"].append(real)
        area_err[name] = st.mean(errs)
        lines.append(f"  {label:<16} " + " | ".join(cells) + f"   [off {100 * area_err[name]:.0f}%]")
    lines.append("  Players over a mark (sim / real 2023, 2024, 2025):")
    for name, mark in MARKS:
        cat = next(c for c in CATS if c[0] == name)
        sim = st.mean(sum(1 for v in x[name] if v >= mark) for x in sp)
        reals = [sum(1 for v in real_values(hist, y, cat) if v >= mark) for y in YEARS]
        lines.append(f"    {name} >= {mark}: {sim:.0f} / {', '.join(map(str, reals))}")
        data["marks"].append({"stat": name, "mark": mark, "sim": sim, "real": reals})
    shares: dict = {}
    for e in ends:
        for slug, t in e.items():
            if teams[slug]["fictional"]:
                continue
            for p in t["players"].values():
                grp = {"MLB": "LB", "ROLB": "LB", "LOLB": "LB"}.get(p["position"], p["position"])
                shares[grp] = shares.get(grp, 0) + p["stats"].get("solo_tackles", 0) + p["stats"].get("assisted_tackles", 0)
    tot = sum(shares.values()) or 1
    data["tackle_shares"] = {k: v / tot for k, v in shares.items() if v}
    lines.append("  Tackles by position (real FBS is roughly DL 20%, LB 40%, DB 40%): "
                 + ", ".join(f"{k} {100 * v / tot:.0f}%" for k, v in sorted(shares.items(), key=lambda kv: -kv[1]) if v))
    punters = [sorted(((p["stats"].get("punt_net_yards", 0) / p["stats"]["punts"], p["stats"]["punt_yards"] / p["stats"]["punts"])
                       for slug, t in e.items() if not teams[slug]["fictional"] for p in t["players"].values()
                       if p["stats"].get("punts", 0) >= PUNT_QUALIFY), reverse=True) for e in ends]
    lines.append(f"  Net punting leaders, {PUNT_QUALIFY}+ punts (net / gross; real FBS #1 nets about 44-46): "
                 + " | ".join(f"#{r} {st.mean(x[r - 1][0] for x in punters if len(x) >= r):.1f} / "
                              f"{st.mean(x[r - 1][1] for x in punters if len(x) >= r):.1f}" for r in (1, 5, 10, 25))
                 + f"   ({st.mean(len(x) for x in punters):.0f} qualify)")
    lines.append("  Teams per game (" + " / ".join(TEAM_RANKS) + "; mean):")
    rteams = {y: real_teams(hist, y) for y in YEARS}
    for key in ("ppg", "ypg", "plays", "ypp", "pass_ypg", "rush_ypg"):
        sim = {k: st.mean(spots(t[key])[k] for t in stm) for k in TEAM_RANKS}
        real = {k: st.mean(spots(rteams[y][key])[k] for y in YEARS) for k in TEAM_RANKS}
        smean = st.mean(st.mean(t[key]) for t in stm)
        rmean = st.mean(st.mean(rteams[y][key]) for y in YEARS)
        area_err["team_" + key] = st.mean(abs(sim[k] / real[k] - 1) for k in TEAM_RANKS)
        data["teams"][key] = {"sim": [sim[k] for k in TEAM_RANKS], "real": [real[k] for k in TEAM_RANKS], "sim_mean": smean, "real_mean": rmean}
        fmt = "{:.2f}" if key == "ypp" else "{:.1f}"
        lines.append(f"    {key:<9} sim  " + " / ".join(fmt.format(sim[k]) for k in TEAM_RANKS) + f"; {fmt.format(smean)}")
        lines.append(f"    {'':<9} real " + " / ".join(fmt.format(real[k]) for k in TEAM_RANKS) + f"; {fmt.format(rmean)}"
                     + f"   [off {100 * area_err['team_' + key]:.0f}%]")
    data["area_off"] = dict(area_err)
    lines.append("  Score (mean |gap| at ranks 1-50, teams over all spots): "
                 + ", ".join(f"{k} {100 * v:.0f}%" for k, v in area_err.items()))
    if snaps and REAL_2026.exists():
        real = json.loads(REAL_2026.read_text(encoding="utf-8"))
        rl, rt = sim_players(real["season_stats"], teams), sim_teams(real["season_stats"], teams, official=True)
        sl = [sim_players(x, teams) for x in snaps]
        stt = [sim_teams(x, teams) for x in snaps]
        lines.append("")
        lines.append(f"THIS YEAR AT WEEK {real['current_week']}: simulated vs the real 2026 box scores (real player lines match a roster player 93% of the time, so real totals run a little low)")
        for cat in CATS:
            name, label = cat[0], cat[1]
            cells = []
            for r in (1, 10, 25, 50, 100):
                sim = st.mean(at(x[name], r) for x in sl)
                rv = at(rl[name], r)
                cells.append(f"#{r} {sim:.0f}/{rv:.0f}" + (f" {100 * (sim / rv - 1):+.0f}%" if rv else ""))
            lines.append(f"  {label:<16} " + " | ".join(cells))
        for key in ("ppg", "ypg", "plays", "ypp"):
            sim = {k: st.mean(spots(t[key])[k] for t in stt) for k in TEAM_RANKS}
            rr = spots(rt[key])
            fmt = "{:.2f}" if key == "ypp" else "{:.1f}"
            lines.append(f"  team {key:<6} sim " + " / ".join(fmt.format(sim[k]) for k in TEAM_RANKS)
                         + " | real " + " / ".join(fmt.format(rr[k]) for k in TEAM_RANKS))
    return "\n".join(lines)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--seeds", type=int, default=2)
    ap.add_argument("--no-2026", action="store_true")
    ap.add_argument("--json", default=None, help="also write the numbers to this file (tools/realism_pdf.py --fullseason charts them)")
    a = ap.parse_args()
    import season
    teams = season.load_teams()
    ends, snaps = simulate([101 + 101 * i for i in range(a.seeds)], None if a.no_2026 else 8)
    data: dict = {}
    print(report(ends, snaps, teams, data))
    if a.json:
        Path(a.json).write_text(json.dumps(data, indent=1), encoding="utf-8")
