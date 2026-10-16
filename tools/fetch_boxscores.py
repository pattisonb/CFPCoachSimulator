"""Download player box scores for the final games in data/season_games.json.

NCAA.com's game pages load their box score from a GraphQL persisted query at
sdataprod.ncaa.com. Each response holds, for both teams, per-player lines by category
(rushing, passing, receiving, kicking, punting, returns, defense) and team totals
(plays, yards, first downs, third and fourth downs, penalties, fumbles).

Usage:  python fetch_boxscores.py          # fetch what is missing in data/boxscores/
        python fetch_boxscores.py 50       # only the first 50 missing games
"""
from __future__ import annotations
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `import season` works from here

import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GAMES_FILE = ROOT / "data" / "season_games.json"
OUT_DIR = ROOT / "data" / "boxscores"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
QUERY = "NCAA_GetGamecenterBoxscoreFootballById_web"
# Hash of the persisted query, read from the drupal settings block of any ncaa.com game page
# (settings.gamecenter.gqlShas). Update it here if NCAA changes the query.
SHA = "babb939def47c602a6e81af7aa3f6b35197fb1f1b1a2f2b081f3a3e4924be82e"


def fetch_boxscore(contest_id: int) -> dict:
    params = {
        "meta": QUERY,
        "extensions": json.dumps({"persistedQuery": {"version": 1, "sha256Hash": SHA}}, separators=(",", ":")),
        "variables": json.dumps({"contestId": str(contest_id), "staticTestEnv": None}, separators=(",", ":")),
    }
    url = "https://sdataprod.ncaa.com/?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json",
                                               "Origin": "https://www.ncaa.com", "Referer": "https://www.ncaa.com/"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> None:
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else None
    games = [g for g in json.loads(GAMES_FILE.read_text(encoding="utf-8")) if g.get("final")]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    todo = [g for g in games if not (OUT_DIR / f"{g['contest_id']}.json").exists()]
    if limit:
        todo = todo[:limit]
    print(f"{len(games)} final games, {len(games) - len(todo)} already saved, fetching {len(todo)}")
    ok = failed = 0
    for i, g in enumerate(todo, 1):
        try:
            data = fetch_boxscore(g["contest_id"])
            box = data.get("data", {}).get("boxscore")
            if not box or not box.get("teamBoxscore"):
                raise ValueError("no boxscore in response")
            (OUT_DIR / f"{g['contest_id']}.json").write_text(json.dumps(data), encoding="utf-8")
            ok += 1
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"  {g['contest_id']} {g['away_name']} at {g['home_name']}: failed ({exc})")
        if i % 25 == 0:
            print(f"  {i}/{len(todo)} done")
        time.sleep(0.4)
    print(f"saved {ok}, failed {failed}, folder {OUT_DIR}")


if __name__ == "__main__":
    main()
