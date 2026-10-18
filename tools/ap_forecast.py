"""Forecast this week's AP Top 25 before it is released, then score the forecast.

The poll model in polls.py moves each team's "poll score" by its result and ranks the
scores. This tool feeds it last week's real AP poll and this week's real results and
freezes two forecasts in data/predictions/ap_weekNN.json:

  model     the game's own poll for the week (polls.next_poll from last week's real poll,
            its vote points and this week's results; see tools/backtest_polls.py)
  last_week a baseline: last week's real poll unchanged

(the week 8 file predates the week-to-week model: its "game" and "anchored" columns are
the old season-long score model.)

Usage (from the project root):
    python tools/ap_forecast.py predict          # forecast the poll after the last completed week
    python tools/ap_forecast.py score 08         # once the real poll is out: compare and report
Options: --no-fetch skips refreshing the schedule and the poll archive first. An existing
forecast file is never overwritten.
"""
from __future__ import annotations

import argparse
import json
import statistics as st
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import polls  # noqa: E402
import season  # noqa: E402
from teamnames import build_matcher, match  # noqa: E402

PRED_DIR = ROOT / "data" / "predictions"
HISTORY_POLLS = ROOT / "data" / "history" / "polls.json"


def run_tool(name: str, *args: str) -> None:
    print(f"--- running {name} {' '.join(args)}".rstrip())
    subprocess.run([sys.executable, str(Path(__file__).resolve().parent / name), *args], cwd=ROOT, check=True)


def git_commit() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def real_poll(week: int, teams: dict) -> list[dict]:
    """The real AP poll released after our week `week`: [{slug, name, rank, points, record}]."""
    hist = json.loads(HISTORY_POLLS.read_text(encoding="utf-8")).get("2026") or {}
    rows = (hist.get("weeks", {}).get(str(week)) or {}).get("ap") or []
    lookup = build_matcher(teams)
    out = []
    for r in sorted(rows, key=lambda r: r["rank"]):
        slug = match(r.get("name") or "", lookup)
        if slug:
            out.append({"slug": slug, "name": teams[slug]["name"], "rank": r["rank"], "points": r.get("points"), "record": r.get("record")})
    return out


def forecast(no_fetch: bool) -> dict:
    if not no_fetch:
        run_tool("fetch_schedules.py")
        run_tool("fetch_polls.py", "2026")
    teams = season.load_teams()
    any_team = next(s for s, t in teams.items() if not t["fictional"])
    st_game = season.new_season(any_team, "remaining")
    week = st_game["current_week"]
    real = season._real_polls_2026(teams)
    if week in real:
        print(f"note: the real poll after week {week} is already in the archive; this is not a forecast")
    last = real_poll(week - 1, teams)
    if not last:
        raise SystemExit(f"no real AP poll after week {week - 1} to start from")

    def listing(entries):
        return [{"slug": e["team"], "name": e["name"], "rank": e["rank"], "record": e.get("record")} for e in entries[:25]]

    # the game's own poll for the week: polls.next_poll from last week's real poll and its vote points
    return {"week": week, "made_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "commit": git_commit(),
            "starts_from": f"the real AP poll after week {week - 1}",
            "forecasts": {"model": listing(st_game["polls"][str(week)]["ap"]),
                          "last_week": [{"slug": e["slug"], "name": e["name"], "rank": e["rank"], "record": e["record"]} for e in last]}}


def predict(no_fetch: bool) -> None:
    data = forecast(no_fetch)
    path = PRED_DIR / f"ap_week{data['week']:02d}.json"
    if path.exists():
        raise SystemExit(f"{path.name} exists; a frozen forecast is never overwritten")
    PRED_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=1), encoding="utf-8")
    print(f"AP forecast for the poll after week {data['week']}, made {data['made_at']} at commit {data['commit']}")
    f = data["forecasts"]
    print(f"{'#':>3}  {'model':<22} {'last week':<22}")
    for i in range(25):
        cells = [f.get(k)[i]["name"] if i < len(f.get(k)) else "" for k in ("model", "last_week")]
        print(f"{i + 1:>3}  {cells[0]:<22} {cells[1]:<22}")
    print(f"\nwritten to {path}")


def metrics(pred: list[dict], real: list[dict]) -> dict:
    prank = {e["slug"]: i + 1 for i, e in enumerate(pred)}
    errs = [abs(prank.get(e["slug"], 26) - e["rank"]) for e in real]
    top10 = {e["slug"] for e in real if e["rank"] <= 10}
    return {"in_top25": sum(1 for e in real if e["slug"] in prank), "mae": round(st.mean(errs), 2),
            "exact": sum(1 for e in real if prank.get(e["slug"]) == e["rank"]),
            "within2": sum(1 for e in real if abs(prank.get(e["slug"], 99) - e["rank"]) <= 2),
            "top10": sum(1 for e in pred[:10] if e["slug"] in top10),
            "no1": bool(pred) and bool(real) and pred[0]["slug"] == real[0]["slug"]}


def score(week: int, no_fetch: bool) -> None:
    path = PRED_DIR / f"ap_week{week:02d}.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    if not no_fetch:
        run_tool("fetch_polls.py", "2026")
    teams = season.load_teams()
    real = real_poll(week, teams)
    if not real:
        raise SystemExit(f"the real AP poll after week {week} is not out yet")
    f = data["forecasts"]
    res = {k: metrics(v, real) for k, v in f.items()}
    lines = [f"AP forecast for the poll after week {week}: made {data['made_at']} at commit {data['commit']}, starting from {data['starts_from']}",
             "", f"{'forecast':<11}{'in top 25':>10}{'rank MAE':>10}{'exact':>7}{'within 2':>10}{'top 10':>8}{'No. 1':>7}"]
    for k in f:
        m = res[k]
        lines.append(f"{k:<11}{m['in_top25']:>8}/25{m['mae']:>10.2f}{m['exact']:>7}{m['within2']:>10}{m['top10']:>6}/10{'yes' if m['no1'] else 'no':>7}")
    lines.append("rank MAE: mean |forecast rank - real rank| over the real Top 25, unranked counted as 26")
    lines.append("")
    pos = {k: {e["slug"]: i + 1 for i, e in enumerate(v)} for k, v in f.items()}
    lines.append(f"{'real':>4}  {'team':<22}{'record':>8}" + "".join(f"{k:>11}" for k in f))
    for e in real:
        lines.append(f"{e['rank']:>4}  {e['name']:<22}{e['record'] or '':>8}" + "".join(f"{str(pos[k].get(e['slug'], '-')):>11}" for k in f))
    realset = {e["slug"] for e in real}
    for k in [k for k in f if k != "last_week"]:
        extra = [e["name"] for e in f[k] if e["slug"] not in realset]
        if extra:
            lines.append(f"{k} ranked but the real poll did not: {', '.join(extra)}")
    text = "\n".join(lines)
    print(text)
    (PRED_DIR / f"ap_week{week:02d}_score.txt").write_text(text + "\n", encoding="utf-8")
    (PRED_DIR / f"ap_week{week:02d}_score.json").write_text(json.dumps({"week": week, "metrics": res, "real": real}, indent=1), encoding="utf-8")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("predict")
    p.add_argument("--no-fetch", action="store_true")
    s = sub.add_parser("score")
    s.add_argument("week", type=int)
    s.add_argument("--no-fetch", action="store_true")
    a = ap.parse_args()
    if a.cmd == "predict":
        predict(a.no_fetch)
    else:
        score(a.week, a.no_fetch)
