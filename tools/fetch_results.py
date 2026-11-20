"""Download the 2026 FBS results played so far from NCAA.com into data/season_games.json.

The weekly scoreboard pages embed their games in a Drupal settings JSON block, so this
needs only the HTML. Each record keeps the NCAA short names and "seo" ids, both scores,
whether the game was at a home site (NCAA flags neither team as home for neutral sites),
and whether it is final.

Usage:  python tools/fetch_results.py      # weeks 1-14, skipping weeks with no finals
"""
from __future__ import annotations
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from sim import season` works from here

import json
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "season_games.json"
SEASON = 2026
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,*/*;q=0.8"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


def parse_week(html: str, week: int) -> list[dict]:
    m = re.search(r'<script type="application/json" data-drupal-selector="drupal-settings-json">(.*?)</script>', html, re.S)
    if not m:
        return []
    settings = json.loads(m.group(1))
    games = []
    for c in settings.get("scoreboard", {}).get("initialGames", []):
        teams = c.get("teams") or []
        if len(teams) != 2:
            continue
        home = next((t for t in teams if t.get("isHome")), None)
        away = next((t for t in teams if t is not home), None)
        neutral = home is None
        if neutral:
            # NCAA lists the designated home team second
            away, home = teams[0], teams[1]
        games.append({
            "week": week,
            "date": c.get("startDate"),
            "contest_id": c.get("contestId"),
            "final": c.get("gameState") == "F",
            "neutral": neutral,
            "home_seo": home.get("seoname"), "home_name": home.get("nameShort"),
            "home_score": int(home.get("score") or 0), "home_rank": home.get("teamRank"),
            "home_conf": home.get("conferenceSeo"),
            "away_seo": away.get("seoname"), "away_name": away.get("nameShort"),
            "away_score": int(away.get("score") or 0), "away_rank": away.get("teamRank"),
            "away_conf": away.get("conferenceSeo"),
        })
    return games


def main() -> None:
    last_week = int(sys.argv[1]) if len(sys.argv) > 1 else 14
    all_games = []
    for week in range(1, last_week + 1):
        url = f"https://www.ncaa.com/scoreboard/football/fbs/{SEASON}/{week:02d}/all-conf"
        try:
            games = parse_week(fetch(url), week)
        except Exception as exc:  # noqa: BLE001
            print(f"week {week}: failed ({exc})")
            continue
        finals = sum(1 for g in games if g["final"])
        print(f"week {week}: {len(games)} games, {finals} final, {sum(1 for g in games if g['neutral'])} neutral")
        all_games.extend(games)
        if games and finals == 0:
            break
        time.sleep(0.5)
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(all_games, indent=1), encoding="utf-8")
    print(f"wrote {len(all_games)} games to {OUT}")


if __name__ == "__main__":
    main()
