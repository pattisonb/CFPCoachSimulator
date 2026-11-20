"""Every FBS team's players and their season stats so far from cfbstats.com, for tuning the game's ratings against
the real season (the player's ask: any rating is fair game if it brings the sim closer to what really happened).

For each team: its rushing, passing, receiving, tackle, sack, interception, kicking and punting tables, a row a
player (name, class, position, games, then the table's own columns). Written to data/history/team_players_<year>.json
as {"season", "fetched", "teams": {cfbstats name: {"id", category: {"head": [...], "rows": [[...]]}}}}. Real names:
the file stays in data/history (the published site packs neither that folder nor real names).

Usage (from the project root): python tools/fetch_team_stats.py [2026]
One request every 1.5 seconds; pages are cached in data/history/cfbstats_cache/ (ignored), so a run that stops
picks up where it left off.
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "history" / "cfbstats_cache"
UA = {"User-Agent": "Mozilla/5.0 (CFPCoachSimulator stat check)"}
CATEGORIES = ("rushing", "passing", "receiving", "tackle", "sack", "interception", "kicking", "punting")
WAIT = 1.5            # seconds between requests


def get(url: str) -> str:
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / (re.sub(r"[^\w]+", "_", url.split("cfbstats.com/")[1]) + ".html")
    if f.exists():
        return f.read_text(encoding="utf-8", errors="replace")
    time.sleep(WAIT)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        s = r.read().decode("utf-8", errors="replace")
    f.write_text(s, encoding="utf-8")
    return s


def cells(row: str) -> list[str]:
    return [re.sub(r"<[^>]+>", "", c).replace("&amp;", "&").strip() for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", row, re.S)]


def table(s: str) -> dict:
    """The page's player table: its header and a row a player (the totals and opponents rows dropped)."""
    rows = [cells(r) for r in re.findall(r"<tr[^>]*>(.*?)</tr>", s, re.S)]
    rows = [r for r in rows if r]
    head = next((r for r in rows if "Name" in r), None)
    if not head:
        return {"head": [], "rows": []}
    at = head.index("Name")
    body = [r for r in rows if len(r) == len(head) and r is not head and r[at] and r[at] not in ("Total", "Opponents", "Team")]
    return {"head": head[at:], "rows": [r[at:] for r in body]}


def main(year: str) -> None:
    index = get(f"https://cfbstats.com/{year}/team/index.html")
    teams = re.findall(rf'href="/{year}/team/(\d+)/index\.html"[^>]*>([^<]+)<', index)
    out = {"season": int(year), "fetched": date.today().isoformat(), "teams": {}}
    for n, (tid, name) in enumerate(teams, 1):
        entry = {"id": tid}
        for cat in CATEGORIES:
            try:
                entry[cat] = table(get(f"https://cfbstats.com/{year}/team/{tid}/{cat}/index.html"))
            except Exception as e:      # one page failing does not lose the rest: it is asked again on the next run
                print(f"  {name} {cat}: {type(e).__name__} {e}", flush=True)
        out["teams"][name.replace("&amp;", "&")] = entry
        print(f"{n}/{len(teams)} {name}: " + " ".join(f"{c} {len((entry.get(c) or {}).get('rows', []))}" for c in CATEGORIES), flush=True)
    f = ROOT / "data" / "history" / f"team_players_{year}.json"
    f.write_text(json.dumps(out, indent=0), encoding="utf-8")
    print(f"wrote {f} ({len(out['teams'])} teams)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "2026")
