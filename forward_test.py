"""Forward test: freeze the sim's picks for the next week of real games, then score them.

All other calibration in this project is in-sample (the ratings and tendencies already
reflect the games they are checked against). This script is the out-of-sample check: it
writes the sim's predictions for games that have not been played yet, refuses to change
them afterwards, and compares them with the real results once the games are final.

Usage:
    python forward_test.py predict              # next unplayed week -> data/predictions/weekNN.json
    python forward_test.py predict --sims 100   # more sims per game (default 50)
    python forward_test.py score 07             # score week 7 once its games are final
    python forward_test.py dryrun 6             # predict a past week into a temp file, score it, delete it

`predict` runs fetch_results.py first, takes every unplayed game in the lowest week that
still has unplayed games, keeps the ones between two teams in data/engine_teams.json,
simulates each N times at the real venue, and writes the week file with the predicted
margin, its spread over the sims, the home win probability, the predicted total, each
team's expected points, and each team's expected QB1, RB1 and top-receiver lines (the
player who held that role most often across the sims, with that player's average line).
The file also records when it was made and the git commit of the engine. An existing
week file is never overwritten.

`score NN` reruns fetch_results.py and fetch_boxscores.py, then compares the frozen
predictions with the real scores (straight-up accuracy, margin MAE and RMSE, slope of
actual on predicted, home bias, total-points bias, win-probability calibration) and the
real box scores (error and bias of the QB1, RB1 and top receiver yards, matching the
sim's player to the real one by last name). The report is written next to the prediction
file as weekNN_score.json and weekNN_score.txt and printed.

Options for both modes: --no-fetch skips the downloads; --week N / --out PATH / --file PATH
pick a different week or file (used by `dryrun`).
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import statistics as st
import subprocess
import sys
import tempfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from multiprocessing import Pool
from pathlib import Path

from calibrate_season import build_matcher, match

ROOT = Path(__file__).resolve().parent
GAMES_FILE = ROOT / "data" / "season_games.json"
TEAMS_FILE = ROOT / "data" / "engine_teams.json"
BOX_DIR = ROOT / "data" / "boxscores"
PRED_DIR = ROOT / "data" / "predictions"

DEFAULT_SIMS = 50
SUFFIXES = {"JR", "SR", "II", "III", "IV", "V"}

# Sim stat keys for each role's expected line, and the names used in the prediction file.
QB_KEYS = {"attempts": "pass_attempts", "completions": "completions", "yards": "pass_yards",
           "td": "passing_touchdowns", "interceptions": "interceptions_thrown"}
RB_KEYS = {"carries": "carries", "yards": "rush_yards", "td": "rushing_touchdowns"}
WR_KEYS = {"catches": "receptions", "yards": "receiving_yards", "td": "receiving_touchdowns"}


# ----- helpers ---------------------------------------------------------------

def run_script(name: str) -> None:
    """Run a sibling script; a failure (no network, NCAA change) is a warning, not a stop."""
    print(f"--- running {name}")
    proc = subprocess.run([sys.executable, str(ROOT / name)], cwd=ROOT)
    if proc.returncode != 0:
        print(f"warning: {name} exited with {proc.returncode}; continuing with the data on disk")


def git_commit() -> str:
    try:
        head = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True,
                              text=True, check=True).stdout.strip()
        dirty = subprocess.run(["git", "status", "--porcelain", "--untracked-files=no"], cwd=ROOT,
                               capture_output=True, text=True, check=True).stdout.strip()
        return head + (" (uncommitted changes)" if dirty else "")
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def load_season() -> list[dict]:
    return json.loads(GAMES_FILE.read_text(encoding="utf-8"))


def load_teams() -> dict:
    if not TEAMS_FILE.exists():
        subprocess.run([sys.executable, str(ROOT / "build_teams.py")], check=True, cwd=ROOT)
    return json.loads(TEAMS_FILE.read_text(encoding="utf-8"))["teams"]


def lowest_unplayed_week(games: list[dict]) -> int | None:
    weeks = [g["week"] for g in games if not g.get("final")]
    return min(weeks) if weeks else None


def matched_games(games: list[dict], week: int, lookup: dict, include_final: bool) -> list[dict]:
    """Games in `week` between two known teams, with the engine slugs attached."""
    out = []
    for g in games:
        if g["week"] != week or (g.get("final") and not include_final):
            continue
        h = match(g["home_name"], lookup) or match(g["home_seo"], lookup)
        a = match(g["away_name"], lookup) or match(g["away_seo"], lookup)
        if h and a and h != a:
            out.append({**g, "home_slug": h, "away_slug": a})
    return out


def last_name(name: str) -> str:
    tokens = [t for t in re.sub(r"[.,']", "", (name or "").upper()).split() if t not in SUFFIXES]
    return tokens[-1] if tokens else ""


def week_file(week: int) -> Path:
    return PRED_DIR / f"week{week:02d}.json"


# ----- simulation (one process per core) ---------------------------------------

_TEAMS: dict = {}


def _init(path: str) -> None:
    global _TEAMS
    _TEAMS = json.loads(Path(path).read_text(encoding="utf-8"))["teams"]


def _role_players(team: dict) -> tuple[str, str, str]:
    """Names of this sim's QB1 (most attempts), RB1 (most non-QB carries), top receiver."""
    P = team["players"]
    g = lambda p, k: p["stats"].get(k, 0)
    qb = max((p for p in P if g(p, "pass_attempts")), key=lambda p: g(p, "pass_attempts"), default=None)
    rb = max((p for p in P if p["position"] != "QB" and g(p, "carries")), key=lambda p: g(p, "carries"), default=None)
    wr = max((p for p in P if g(p, "receptions")), key=lambda p: g(p, "receptions"), default=None)
    return (qb["name"] if qb else "", rb["name"] if rb else "", wr["name"] if wr else "")


def _sim_game(args: tuple) -> dict:
    from engine.game import simulate_game
    idx, home, away, n, venue = args
    margins, totals, wins = [], [], 0
    pts = {"home": [], "away": []}
    roles = {"home": {"qb": [], "rb": [], "wr": []}, "away": {"qb": [], "rb": [], "wr": []}}
    sums: dict[str, dict[str, Counter]] = {"home": defaultdict(Counter), "away": defaultdict(Counter)}
    positions: dict[str, dict[str, str]] = {"home": {}, "away": {}}
    for i in range(n):
        r = simulate_game(_TEAMS[home], _TEAMS[away], seed=idx * 1000 + i, venue=venue)
        m = r["home"]["score"] - r["away"]["score"]
        margins.append(m)
        totals.append(r["home"]["score"] + r["away"]["score"])
        wins += 1 if m > 0 else 0
        for side in ("home", "away"):
            pts[side].append(r[side]["score"])
            qb, rb, wr = _role_players(r[side])
            roles[side]["qb"].append(qb)
            roles[side]["rb"].append(rb)
            roles[side]["wr"].append(wr)
            for p in r[side]["players"]:
                if p["stats"]:
                    sums[side][p["name"]].update(p["stats"])
                    positions[side][p["name"]] = p["position"]

    def line(side: str, role: str, keys: dict[str, str]) -> dict:
        names = [x for x in roles[side][role] if x]
        if not names:
            return {"name": "", "position": "", "share": 0.0}
        name = max(set(names), key=names.count)
        out = {"name": name, "position": positions[side].get(name, ""),
               "share": round(names.count(name) / n, 2)}      # how often this player held the role
        for label, key in keys.items():
            out[label] = round(sums[side][name][key] / n, 1)
        return out

    res = {"idx": idx, "pred_margin": round(st.mean(margins), 2), "pred_sd": round(st.pstdev(margins), 2),
           "pred_total": round(st.mean(totals), 2), "home_win_prob": round(wins / n, 3)}
    for side in ("home", "away"):
        res[side] = {"expected_points": round(st.mean(pts[side]), 2),
                     "qb1": line(side, "qb", QB_KEYS), "rb1": line(side, "rb", RB_KEYS), "wr1": line(side, "wr", WR_KEYS)}
    return res


def simulate_week(games: list[dict], sims: int) -> None:
    jobs = [(i, g["home_slug"], g["away_slug"], sims, "neutral" if g.get("neutral") else "home") for i, g in enumerate(games)]
    with Pool(initializer=_init, initargs=(str(TEAMS_FILE),)) as pool:
        done = 0
        for res in pool.imap_unordered(_sim_game, jobs, chunksize=2):
            games[res.pop("idx")].update(res)
            done += 1
            if done % 10 == 0 or done == len(jobs):
                print(f"  {done}/{len(jobs)} games simulated")


# ----- predict ---------------------------------------------------------------

def predict(week: int | None, out: Path | None, sims: int, fetch: bool) -> Path:
    if fetch:
        run_script("fetch_results.py")
    season = load_season()
    explicit = week is not None
    if week is None:
        week = lowest_unplayed_week(season)
        if week is None:
            sys.exit("every game in data/season_games.json is final; nothing to predict")
    out = out or week_file(week)
    if out.exists():
        sys.exit(f"{out} already exists; predictions are frozen once written (delete it by hand to redo)")

    teams = load_teams()
    lookup = build_matcher(teams)
    games = matched_games(season, week, lookup, include_final=explicit)
    in_week = [g for g in season if g["week"] == week]
    print(f"week {week}: {len(in_week)} games listed, {sum(1 for g in in_week if g.get('final'))} already final, "
          f"{len(games)} to predict between two known teams, {sims} sims each")
    if not games:
        sys.exit("nothing to predict")

    simulate_week(games, sims)
    payload = {
        "week": week,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "commit": git_commit(),
        "sims_per_game": sims,
        "games": [],
    }
    for g in games:
        payload["games"].append({
            "contest_id": g["contest_id"], "date": g["date"], "neutral": bool(g.get("neutral")),
            "home": {"slug": g["home_slug"], "name": teams[g["home_slug"]]["name"], "ncaa_name": g["home_name"],
                     "rank": g.get("home_rank"), **g["home"]},
            "away": {"slug": g["away_slug"], "name": teams[g["away_slug"]]["name"], "ncaa_name": g["away_name"],
                     "rank": g.get("away_rank"), **g["away"]},
            "pred_margin": g["pred_margin"], "pred_sd": g["pred_sd"],
            "home_win_prob": g["home_win_prob"], "pred_total": g["pred_total"],
        })
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=1), encoding="utf-8")
    print_picks(payload)
    print(f"\n{len(games)} predictions written to {out} (commit {payload['commit']}, {payload['created_at']})")
    return out


def pick_text(g: dict) -> str:
    m = g["pred_margin"]
    if abs(m) < 0.05:
        return "even"
    fav = g["home"]["name"] if m > 0 else g["away"]["name"]
    return f"{fav} by {abs(m):.1f}"


def print_picks(payload: dict) -> None:
    print(f"\nWeek {payload['week']} picks ({payload['sims_per_game']} sims per game)")
    print(f"{'date':<11}{'away':<22}{'home':<22}{'pick':<28}{'sd':>5}{'home win':>10}{'total':>7}  QB1 (pass yds) away / home")
    for g in payload["games"]:
        sep = "vs" if g["neutral"] else "at"
        qb = f"{g['away']['qb1']['name']} {g['away']['qb1']['yards']:.0f} / {g['home']['qb1']['name']} {g['home']['qb1']['yards']:.0f}"
        print(f"{g['date']:<11}{g['away']['name'][:21]:<22}{(sep + ' ' + g['home']['name'])[:21]:<22}{pick_text(g):<28}"
              f"{g['pred_sd']:>5.1f}{100 * g['home_win_prob']:>9.0f}%{g['pred_total']:>7.1f}  {qb}")


# ----- score -----------------------------------------------------------------

def real_lines(team_box: dict) -> dict:
    """Per-player lines from one team's NCAA box score, keyed by category."""
    out = {"passing": [], "rushing": [], "receiving": []}
    for p in team_box.get("playerStats", []):
        cat = p.get("category")
        if cat not in out:
            continue
        full = f"{p.get('firstName', '')} {p.get('lastName', '')}".strip()
        rec = {"name": full, "last": last_name(p.get("lastName") or full)}
        if cat == "passing":
            rec.update(attempts=num(p.get("passingAttempts")), completions=num(p.get("passingCompletions")),
                       yards=num(p.get("passingYards")), td=num(p.get("passingTDs")))
        elif cat == "rushing":
            rec.update(carries=num(p.get("rushingAttempts")), yards=num(p.get("rushingYards")), td=num(p.get("rushingTDs")))
        else:
            rec.update(catches=num(p.get("receivingReceptions")), yards=num(p.get("receivingYards")), td=num(p.get("receivingTDs")))
        out[cat].append(rec)
    return out


def num(x) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def load_box(contest_id: int, home_seo: str) -> dict | None:
    """{'home': lines, 'away': lines} for one game, or None without a box score."""
    path = BOX_DIR / f"{contest_id}.json"
    if not path.exists():
        return None
    try:
        box = json.loads(path.read_text(encoding="utf-8"))["data"]["boxscore"]
    except (ValueError, KeyError, TypeError):
        return None
    by_id = {str(t["teamId"]): t for t in box.get("teams", [])}
    sides = {}
    for tb in box.get("teamBoxscore", []):
        info = by_id.get(str(tb["teamId"])) or {}
        side = "home" if info.get("seoname") == home_seo or (info.get("isHome") and "home" not in sides) else "away"
        sides[side] = real_lines(tb)
    return sides if "home" in sides and "away" in sides else None


ROLES = [("qb1", "passing", "attempts", "QB1 pass yards"),
         ("rb1", "rushing", "carries", "RB1 rush yards"),
         ("wr1", "receiving", "catches", "Top receiver yards")]


def score(week: int, file: Path | None, fetch: bool) -> Path:
    file = file or week_file(week)
    if not file.exists():
        sys.exit(f"no prediction file {file}; run `python forward_test.py predict` first")
    payload = json.loads(file.read_text(encoding="utf-8"))
    if fetch:
        run_script("fetch_results.py")
        run_script("fetch_boxscores.py")
    season = {g["contest_id"]: g for g in load_season()}

    rows, pending = [], []
    for p in payload["games"]:
        real = season.get(p["contest_id"])
        if not real or not real.get("final"):
            pending.append(p)
            continue
        rows.append({**p, "home_score": real["home_score"], "away_score": real["away_score"],
                     "actual_margin": real["home_score"] - real["away_score"], "home_seo": real["home_seo"]})
    lines = [f"Week {payload['week']} forward test: predictions made {payload['created_at']} at commit {payload['commit']}, "
             f"{payload['sims_per_game']} sims per game",
             f"{len(payload['games'])} predicted games, {len(rows)} final, {len(pending)} not yet played"]
    if not rows:
        report = "\n".join(lines)
        print(report)
        sys.exit("nothing to score yet")

    # ----- game level, same measures as calibrate_season.py -----
    actual = [r["actual_margin"] for r in rows]
    pred = [r["pred_margin"] for r in rows]
    errors = [a - p for a, p in zip(actual, pred)]
    su = sum(1 for a, p in zip(actual, pred) if (a > 0) == (p > 0)) / len(rows)
    mae = st.mean(abs(e) for e in errors)
    rmse = st.mean(e * e for e in errors) ** 0.5
    mp, ma = st.mean(pred), st.mean(actual)
    cov = sum((p - mp) * (a - ma) for p, a in zip(pred, actual)) / len(pred)
    varp = st.pvariance(pred)
    slope = cov / varp if varp else float("nan")
    corr = cov / (st.pstdev(pred) * st.pstdev(actual)) if varp and st.pstdev(actual) else float("nan")
    home_errs = [a - p for r, a, p in zip(rows, actual, pred) if not r["neutral"]]
    home_bias = st.mean(home_errs) if home_errs else float("nan")
    tot_actual = st.mean(r["home_score"] + r["away_score"] for r in rows)
    tot_pred = st.mean(r["pred_total"] for r in rows)
    neutral_n = sum(1 for r in rows if r["neutral"])
    lines += [
        "",
        f"{len(rows)} games ({neutral_n} neutral site)",
        f"straight-up picks correct:      {100 * su:.1f}%   (Vegas favorites win about 75-78%)",
        f"margin MAE / RMSE:              {mae:.1f} / {rmse:.1f} points   (closing spreads: MAE about 12-13)",
        f"actual-on-predicted slope:      {slope:.2f}   (1.0 = rating gaps worth exactly what the sim says)",
        f"correlation:                    {corr:.2f}",
        f"home bias (actual - predicted): {home_bias:+.1f} points",
        f"mean home margin actual/pred:   {ma:+.1f} / {mp:+.1f}",
        f"total points actual/pred:       {tot_actual:.1f} / {tot_pred:.1f}   (bias {tot_pred - tot_actual:+.1f})",
        "",
        "Win-probability calibration (home win probability from the sim):",
        f"{'bucket':>12}{'games':>7}{'sim prob':>10}{'home won':>10}",
    ]
    prob_buckets = []
    for lo, hi in [(0, 0.2), (0.2, 0.4), (0.4, 0.6), (0.6, 0.8), (0.8, 1.01)]:
        b = [r for r in rows if lo <= r["home_win_prob"] < hi]
        if not b:
            continue
        sim_p = st.mean(r["home_win_prob"] for r in b)
        won = st.mean(1 if r["actual_margin"] > 0 else 0 for r in b)
        prob_buckets.append({"bucket": f"{int(100 * lo)}-{int(100 * min(hi, 1))}%", "games": len(b),
                             "sim_prob": round(sim_p, 3), "home_won": round(won, 3)})
        lines.append(f"{prob_buckets[-1]['bucket']:>12}{len(b):>7}{100 * sim_p:>9.0f}%{100 * won:>9.0f}%")
    lines += ["", "By predicted margin bucket (home favored by...):",
              f"{'bucket':>12}{'games':>7}{'pred':>8}{'actual':>8}{'home win%':>11}{'sim prob':>10}"]
    for lo, hi in [(-99, -21), (-21, -14), (-14, -7), (-7, -3), (-3, 3), (3, 7), (7, 14), (14, 21), (21, 99)]:
        b = [r for r in rows if lo <= r["pred_margin"] < hi]
        if not b:
            continue
        lines.append(f"{f'{lo} to {hi}':>12}{len(b):>7}{st.mean(r['pred_margin'] for r in b):>8.1f}"
                     f"{st.mean(r['actual_margin'] for r in b):>8.1f}"
                     f"{100 * st.mean(1 if r['actual_margin'] > 0 else 0 for r in b):>10.0f}%"
                     f"{100 * st.mean(r['home_win_prob'] for r in b):>9.0f}%")

    # ----- player lines against the box scores -----
    player: dict[str, dict] = {}
    boxes = 0
    for r in rows:
        box = load_box(r["contest_id"], r["home_seo"])
        r["player"] = {}
        if not box:
            continue
        boxes += 1
        for side in ("home", "away"):
            for role, cat, sort_key, _label in ROLES:
                pred_line = r[side][role]
                real_list = box[side][cat]
                real_top = max(real_list, key=lambda x: x[sort_key], default=None)
                same = [x for x in real_list if x["last"] == last_name(pred_line["name"])]
                real_same = max(same, key=lambda x: x[sort_key], default=None) if same else None
                r["player"][f"{side}_{role}"] = {
                    "pred_name": pred_line["name"], "pred_yards": pred_line.get("yards", 0.0),
                    "real_name": real_same["name"] if real_same else None,
                    "real_yards": real_same["yards"] if real_same else None,
                    "real_top_name": real_top["name"] if real_top else None,
                    "real_top_yards": real_top["yards"] if real_top else None,
                }
                acc = player.setdefault(role, {"pred": [], "real": [], "role_pred": [], "role_real": [],
                                               "team_games": 0, "matched": 0, "is_top": 0})
                acc["team_games"] += 1
                if real_same:
                    acc["matched"] += 1
                    acc["pred"].append(pred_line.get("yards", 0.0))
                    acc["real"].append(real_same["yards"])
                    if real_top and real_same["name"] == real_top["name"]:
                        acc["is_top"] += 1
                if real_top:
                    acc["role_pred"].append(pred_line.get("yards", 0.0))
                    acc["role_real"].append(real_top["yards"])
    lines += ["", f"Player lines against the real box scores ({boxes} of {len(rows)} games have one; "
                  "sim player matched to the real one by last name):",
              f"{'line':<22}{'team-games':>11}{'matched':>9}{'is real #1':>11}{'pred':>7}{'real':>7}{'bias':>7}{'MAE':>7}"
              f"   | same role regardless of name: pred / real / bias / MAE"]
    player_summary = {}
    for role, _cat, _k, label in ROLES:
        acc = player.get(role)
        if not acc or not acc["team_games"]:
            continue
        s = {"team_games": acc["team_games"], "matched": acc["matched"], "is_real_top": acc["is_top"]}
        if acc["pred"]:
            s.update(pred_mean=round(st.mean(acc["pred"]), 1), real_mean=round(st.mean(acc["real"]), 1),
                     bias=round(st.mean(p - a for p, a in zip(acc["pred"], acc["real"])), 1),
                     mae=round(st.mean(abs(p - a) for p, a in zip(acc["pred"], acc["real"])), 1))
        if acc["role_pred"]:
            s.update(role_pred_mean=round(st.mean(acc["role_pred"]), 1), role_real_mean=round(st.mean(acc["role_real"]), 1),
                     role_bias=round(st.mean(p - a for p, a in zip(acc["role_pred"], acc["role_real"])), 1),
                     role_mae=round(st.mean(abs(p - a) for p, a in zip(acc["role_pred"], acc["role_real"])), 1))
        player_summary[role] = s
        by_name = (f"{s['pred_mean']:>7.1f}{s['real_mean']:>7.1f}{s['bias']:>+7.1f}{s['mae']:>7.1f}" if acc["pred"]
                   else f"{'-':>7}{'-':>7}{'-':>7}{'-':>7}")
        by_role = (f"{s['role_pred_mean']:.1f} / {s['role_real_mean']:.1f} / {s['role_bias']:+.1f} / {s['role_mae']:.1f}"
                   if acc["role_pred"] else "-")
        lines.append(f"{label:<22}{s['team_games']:>11}{s['matched']:>9}{s['is_real_top']:>11}{by_name}   | {by_role}")
    lines += ["bias = predicted minus real. 'matched' = the sim's player appears in the real box score; "
              "'is real #1' = that player was also the real leader in the role."]

    lines += ["", "Worst misses (actual margin vs predicted):"]
    for r in sorted(rows, key=lambda r: -abs(r["actual_margin"] - r["pred_margin"]))[:10]:
        lines.append(f"  {r['away']['name']} {r['away_score']} at {r['home']['name']} {r['home_score']}: "
                     f"actual {r['actual_margin']:+d}, predicted {r['pred_margin']:+.1f}")
    lines += ["", "Every game (actual margin vs predicted, home perspective):"]
    for r in rows:
        hit = "ok " if (r["actual_margin"] > 0) == (r["pred_margin"] > 0) else "MISS"
        lines.append(f"  {hit} {r['away']['name']} {r['away_score']} at {r['home']['name']} {r['home_score']}: "
                     f"actual {r['actual_margin']:+d}, predicted {r['pred_margin']:+.1f} ({100 * r['home_win_prob']:.0f}% home)")
    if pending:
        lines += ["", "Not yet played: " + ", ".join(f"{p['away']['name']} at {p['home']['name']}" for p in pending)]

    report = "\n".join(lines)
    print(report)
    summary = {
        "week": payload["week"], "scored_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "prediction_file": file.name, "predicted": len(payload["games"]), "scored": len(rows), "pending": len(pending),
        "straight_up": round(su, 4), "mae": round(mae, 2), "rmse": round(rmse, 2), "slope": round(slope, 3),
        "correlation": round(corr, 3), "home_bias": round(home_bias, 2),
        "total_actual": round(tot_actual, 2), "total_pred": round(tot_pred, 2), "total_bias": round(tot_pred - tot_actual, 2),
        "win_prob_buckets": prob_buckets, "players": player_summary, "games_with_boxscore": boxes,
        "games": [{k: r[k] for k in ("contest_id", "date", "neutral", "pred_margin", "pred_sd", "home_win_prob",
                                      "pred_total", "home_score", "away_score", "actual_margin", "player")}
                  | {"home": r["home"]["name"], "away": r["away"]["name"]} for r in rows],
    }
    stem = file.with_suffix("")
    json_out, txt_out = Path(f"{stem}_score.json"), Path(f"{stem}_score.txt")
    json_out.write_text(json.dumps(summary, indent=1), encoding="utf-8")
    txt_out.write_text(report + "\n", encoding="utf-8")
    print(f"\nreport written to {json_out} and {txt_out}")
    return json_out


# ----- dry run ---------------------------------------------------------------

def dryrun(week: int, sims: int, fetch: bool) -> None:
    """Prove the scoring path on a week already played: predict into a temp folder, score, delete.

    This is in-sample (the ratings already reflect these games), so the numbers are a
    check of the code path, not of the sim's forward accuracy."""
    tmp = Path(tempfile.mkdtemp(prefix="forward_test_"))
    try:
        out = tmp / f"week{week:02d}.json"
        print(f"dry run: predicting week {week} into {out}")
        predict(week, out, sims, fetch)
        print("\ndry run: scoring")
        score(week, out, fetch=False)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
        print(f"\ndry run: temporary folder {tmp} deleted")


# ----- command line ----------------------------------------------------------

def main() -> None:
    # Team names such as Hawaiʻi and San José State do not fit the Windows console code page.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="mode", required=True)
    p = sub.add_parser("predict", help="freeze picks for the next unplayed week")
    p.add_argument("--sims", type=int, default=DEFAULT_SIMS)
    p.add_argument("--week", type=int, help="predict this week instead (includes played games)")
    p.add_argument("--out", type=Path, help="write here instead of data/predictions/weekNN.json")
    p.add_argument("--no-fetch", action="store_true", help="do not run fetch_results.py first")
    s = sub.add_parser("score", help="score a frozen week against the real results")
    s.add_argument("week", type=int)
    s.add_argument("--file", type=Path, help="score this prediction file instead")
    s.add_argument("--no-fetch", action="store_true", help="do not run fetch_results.py and fetch_boxscores.py first")
    d = sub.add_parser("dryrun", help="predict a played week into a temp file, score it, delete it")
    d.add_argument("week", type=int)
    d.add_argument("--sims", type=int, default=DEFAULT_SIMS)
    d.add_argument("--no-fetch", action="store_true")
    a = ap.parse_args()
    if a.mode == "predict":
        predict(a.week, a.out, a.sims, fetch=not a.no_fetch)
    elif a.mode == "score":
        score(a.week, a.file, fetch=not a.no_fetch)
    else:
        dryrun(a.week, a.sims, fetch=not a.no_fetch)


if __name__ == "__main__":
    main()
