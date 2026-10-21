"""Download every AP voter's ballot from collegepolltracker.com (2014 onward).

The site publishes each week's AP Top 25 as a grid: one row per voter (name, outlet) and
their 25 teams in order. The aggregate poll we already have (data/history/polls.json)
is the sum of these ballots; the ballots themselves show how each voter moves teams.

Output (local only, git-ignored: the site's compilation is its own, "All Rights Reserved"):
    data/ballots/raw/<season>_<week>.html       the fetched grid page (a cache: never re-fetched)
    data/ballots/<season>.json                  {"season", "weeks": {week: {"title", "voters": [
                                                   {"slug", "name", "outlet", "ballot": [site team slug x25]}]}},
                                                 "teams": {site team slug: display name}}
Weeks use the site's (and polls.json's) labels: "preseason", "1".."16", "final".

Polite by default: one request every 2.5 seconds, a descriptive User-Agent, and a page
already in the cache is never fetched again.

Usage (from the project root):
    python tools/fetch_ballots.py              # every season 2014-2026
    python tools/fetch_ballots.py 2025 2026    # some seasons
    python tools/fetch_ballots.py --refresh 2026   # re-fetch the current season's weeks
"""
from __future__ import annotations

import html
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "ballots"
RAW = OUT / "raw"
SITE = "https://collegepolltracker.com"
UA = "CFPCoachSimulator/1.0 (personal college football sim; polite single-thread fetch)"
DELAY = 2.5
SEASONS = list(range(2014, 2027))

_last = [0.0]


def fetch(path: str) -> str | None:
    """GET a page, waiting DELAY seconds since the last request. None on 404 or a redirect away."""
    wait = DELAY - (time.monotonic() - _last[0])
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(SITE + path, headers={"User-Agent": UA})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                _last[0] = time.monotonic()
                if r.geturl().rstrip("/") != (SITE + path).rstrip("/"):
                    return None          # redirected (no such week): the site sends you elsewhere
                return r.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            _last[0] = time.monotonic()
            if e.code == 404:
                return None
            time.sleep(10 * (attempt + 1))
        except (urllib.error.URLError, TimeoutError):
            _last[0] = time.monotonic()
            time.sleep(10 * (attempt + 1))
    return None


def site_weeks(season: int) -> list[str]:
    """The site's poll weeks for a season, in order: pre-season, week-1.., final-rankings."""
    page = fetch(f"/football/{season}/final-rankings") or fetch(f"/football/{season}/week-1") or ""
    opts = re.findall(r'<option[^>]*value="(pre-season|week-\d+|final-rankings)"', page)
    return sorted(set(opts), key=week_order)


def week_order(site_week: str) -> int:
    """Sort key for the site's weeks: pre-season first, final-rankings last."""
    if site_week == "pre-season":
        return -1
    if site_week == "final-rankings":
        return 99
    return int(site_week.split("-")[1])


def label(site_week: str) -> str:
    """The site's week ('pre-season', 'week-5', 'final-rankings') as polls.json labels it."""
    if site_week == "pre-season":
        return "preseason"
    if site_week == "final-rankings":
        return "final"
    return site_week.split("-")[1]


def parse_grid(page: str) -> tuple[str, list[dict], dict[str, str]]:
    """(page title, voters, {team slug: display name}) from a grid page."""
    title = re.search(r'class="weekBarDate">.*?</span>([^<]+)</span>', page, re.S)
    teams: dict[str, str] = {}
    voters = []
    for row in re.split(r'<div class="gridRow"', page)[1:]:
        a = re.search(r'<a href="/football/pollster/([\w-]+)/[^"]*">(.*?)</a>', row, re.S)
        aff = re.search(r'class="gridPollsterAffiliation"[^>]*>(.*?)</span>', row, re.S)
        cells = re.findall(r'class="gridTeam gi_([\w-]+)"[^>]*>\s*<img[^>]*title="([^"]*)"', row)
        if not a or len(cells) < 20:
            continue
        for slug, name in cells:
            teams.setdefault(slug, html.unescape(name).strip())
        voters.append({"slug": a.group(1), "name": html.unescape(re.sub(r"<[^>]+>", "", a.group(2))).strip(),
                       "outlet": html.unescape(re.sub(r"<[^>]+>", "", aff.group(1))).strip() if aff else None,
                       "ballot": [slug for slug, _ in cells]})
    return (title.group(1).strip() if title else ""), voters, teams


def season_ballots(season: int, refresh: bool) -> dict:
    path = OUT / f"{season}.json"
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"season": season, "weeks": {}, "teams": {}}
    for sw in site_weeks(season):
        wk = label(sw)
        cache = RAW / f"{season}_{wk}.html"
        if cache.exists() and not refresh:
            page = cache.read_text(encoding="utf-8")
        else:
            page = fetch(f"/football/grid/{season}/{sw}")
            if not page:
                print(f"  {season} {sw}: no grid")
                continue
            cache.write_text(page, encoding="utf-8")
        title, voters, teams = parse_grid(page)
        if not voters:
            print(f"  {season} {sw}: no ballots on the page")
            continue
        data["weeks"][wk] = {"title": title, "voters": voters}
        data["teams"].update(teams)
        print(f"  {season} {wk:>9}: {len(voters)} ballots  ({title})", flush=True)
    path.write_text(json.dumps(data, indent=1), encoding="utf-8")
    return data


def main() -> None:
    args = sys.argv[1:]
    refresh = "--refresh" in args
    seasons = [int(a) for a in args if a.isdigit()] or SEASONS
    RAW.mkdir(parents=True, exist_ok=True)
    for y in seasons:
        print(f"{y}:", flush=True)
        season_ballots(y, refresh)
    print(f"written to {OUT}")


if __name__ == "__main__":
    main()
