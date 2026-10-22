"""Download every recruiting class from CollegeFootballData.com (CFBD): each high school,
JUCO and prep-school recruit with stars, composite rating, position, size, hometown
(city, state, coordinates) and the school he committed to, plus each team's class ranking,
every FBS team's location, and the transfer portal.

Needs a free CFBD API key (https://collegefootballdata.com/key) in the CFBD_API_KEY
environment variable. The free tier allows 1,000 calls a month; a full run is about 125
(28 classes x 4 calls, the portal, the teams) and years already saved are skipped.

Output: data/recruiting/  (git-ignored: CFBD's compilation, kept local like data/ballots/)
    players_<year>.json   [{"id", "athleteId", "recruitType" (HighSchool/JUCO/PrepSchool), "year",
                            "ranking", "name", "school" (high school), "committedTo", "position",
                            "height", "weight", "stars", "rating", "city", "stateProvince",
                            "country", "hometownInfo": {"latitude", "longitude", "fipsCode"}}]
    teams_<year>.json     [{"year", "rank", "team", "points"}]   class rankings
    portal_<year>.json    [{"season", "firstName", "lastName", "position", "origin", "destination",
                            "transferDate", "rating", "stars", "eligibility"}]
    fbs_teams.json        [{"school", "conference", "location": {"city", "state", "latitude", "longitude", ...}}]

Usage:  python tools/fetch_recruits.py              # 2000 to next year's class, skipping saved years
        python tools/fetch_recruits.py 2024 2025    # just these classes (re-fetched)
"""
from __future__ import annotations

import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data" / "recruiting"
API = "https://api.collegefootballdata.com"
FIRST_CLASS = 2000        # CFBD's high school recruits start with the 2000 class
FIRST_PORTAL = 2021       # the portal endpoint starts with the 2021 season
TYPES = ("HighSchool", "JUCO", "PrepSchool")


def get(path: str, **params):
    key = os.environ.get("CFBD_API_KEY")
    if not key:
        sys.exit("Set CFBD_API_KEY first (a free key from https://collegefootballdata.com/key).")
    url = f"{API}{path}?{urllib.parse.urlencode(params)}" if params else f"{API}{path}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {key}", "Accept": "application/json"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403):
                sys.exit(f"CFBD refused the key ({exc.code}): check CFBD_API_KEY and the account's tier.")
            if exc.code == 429 or exc.code >= 500:
                time.sleep(2 ** (attempt + 1))
                continue
            raise
        except urllib.error.URLError:
            time.sleep(2 ** (attempt + 1))
    raise RuntimeError(f"gave up on {url}")


def save(name: str, data) -> None:
    (OUT_DIR / name).write_text(json.dumps(data, indent=0), encoding="utf-8")


def fetch_class(year: int) -> None:
    players = []
    for t in TYPES:
        players += get("/recruiting/players", year=year, classification=t) or []
    save(f"players_{year}.json", players)
    save(f"teams_{year}.json", get("/recruiting/teams", year=year) or [])
    hs = [p for p in players if p.get("recruitType") == "HighSchool"]
    signed = sum(1 for p in hs if p.get("committedTo"))
    print(f"{year}: {len(hs)} high school recruits ({signed} committed), "
          f"{len(players) - len(hs)} JUCO/prep")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    asked = [int(a) for a in sys.argv[1:]]
    last = datetime.date.today().year + 1          # in the fall, next year's class is the current cycle
    years = asked or list(range(FIRST_CLASS, last + 1))
    for y in years:
        if not asked and (OUT_DIR / f"players_{y}.json").exists() and y < last - 1:
            continue                               # a finished class does not change; the last two still move
        fetch_class(y)
    for y in range(FIRST_PORTAL, last):
        if asked and y not in asked:
            continue
        if not asked and (OUT_DIR / f"portal_{y}.json").exists() and y < last - 1:
            continue
        portal = get("/player/portal", year=y) or []
        save(f"portal_{y}.json", portal)
        print(f"portal {y}: {len(portal)} transfers")
    if not (OUT_DIR / "fbs_teams.json").exists() or not asked:
        save("fbs_teams.json", get("/teams/fbs") or [])


if __name__ == "__main__":
    main()
