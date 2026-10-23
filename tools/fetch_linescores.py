"""Download quarter-by-quarter scores for every FBS game 2014-2025 from ESPN's scoreboard
feed into data/history/linescores.json, for calibrating late-game behavior.

Output: {season: [{"id", "week", "neutral", "home": {"id","name","q": [q1,q2,q3,q4,ot...],
"score"}, "away": {...}}]}

Usage:  python fetch_linescores.py           # all seasons not yet saved
"""
from __future__ import annotations
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from sim import season` works from here

import json
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "history" / "linescores.json"
SITE = "https://site.api.espn.com/apis/site/v2/sports/football/college-football"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"


def get(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=40) as resp:
        return json.loads(resp.read().decode("utf-8"))


def week_games(season: int, stype: int, week: int) -> list[dict]:
    d = get(f"{SITE}/scoreboard?dates={season}&seasontype={stype}&week={week}&groups=80&limit=400")
    out = []
    for ev in d.get("events", []):
        if not ev.get("competitions"):
            continue
        comp = ev["competitions"][0]
        if comp.get("status", {}).get("type", {}).get("name") != "STATUS_FINAL":
            continue
        rec = {"id": ev["id"], "week": week, "type": stype, "neutral": bool(comp.get("neutralSite"))}
        ok = True
        for c in comp["competitors"]:
            side = c.get("homeAway")
            if side not in ("home", "away"):
                ok = False
                break
            q = [int(float(x.get("value") or 0)) for x in c.get("linescores", [])]
            rec[side] = {"id": c["team"]["id"], "name": c["team"].get("location") or c["team"].get("displayName"),
                         "q": q, "score": int(float(c.get("score") or 0)),
                         "conference_id": c["team"].get("conferenceId")}
        if ok and "home" in rec and "away" in rec and rec["home"]["q"] and rec["away"]["q"]:
            out.append(rec)
    return out


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    data = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    for season in range(2014, 2026):
        if str(season) in data:
            print(f"{season}: saved")
            continue
        games = []
        for week in range(1, 17):
            try:
                games.extend(week_games(season, 2, week))
            except Exception as exc:  # noqa: BLE001
                print(f"  {season} wk{week}: {exc}")
            time.sleep(0.15)
        try:
            games.extend(week_games(season, 3, 1))
        except Exception as exc:  # noqa: BLE001
            print(f"  {season} post: {exc}")
        data[str(season)] = games
        OUT.write_text(json.dumps(data), encoding="utf-8")
        print(f"{season}: {len(games)} games with line scores")


if __name__ == "__main__":
    main()
