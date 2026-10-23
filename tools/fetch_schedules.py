"""Download every FBS team's 2026 regular-season schedule from ESPN into data/schedules.json.

ESPN's site API (the JSON behind espn.com/college-football/team/schedule/_/id/<id>)
lists each team's games with the week, date, neutral-site flag, both competitors and
the result for games already played. Each game appears on both teams' schedules, so
games are de-duplicated by ESPN event id.

Output: {"season": 2026, "teams": {slug: {"espn_id", "espn_name"}}, "fcs": {espn_id:
{"name", "conference"}}, "games": [{"event_id", "week", "date", "neutral", "home_slug",
"away_slug", "home_name", "away_name", "home_espn", "away_espn", "final", "home_score",
"away_score"}]}. A slug of null means the opponent is not one of the 138 FBS teams in
the data (an FCS school); its name and ESPN id are kept.

Usage:  python tools/fetch_schedules.py
"""
from __future__ import annotations
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from sim import season` works from here

import json
import re
import time
import urllib.request
from pathlib import Path

from sim.teamnames import ALIASES, norm

ROOT = Path(__file__).resolve().parents[1]
TEAMS_FILE = ROOT / "data" / "engine_teams.json"
OUT = ROOT / "data" / "schedules.json"
SEASON = 2026
API = "https://site.api.espn.com/apis/site/v2/sports/football/college-football"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

# ESPN "location" names that the matcher cannot resolve to our slugs.
ESPN_ALIASES = {
    "miami": "miami", "miami (oh)": "miami-oh", "ole miss": "ole-miss", "hawai'i": "hawai-i",
    "hawaii": "hawai-i", "ul monroe": "ul-monroe", "louisiana": "louisiana", "umass": "umass",
    "uconn": "uconn", "utsa": "utsa", "utep": "utep", "unlv": "unlv", "usf": "usf", "uab": "uab",
    "ucf": "ucf", "byu": "byu", "tcu": "tcu", "smu": "smu", "lsu": "lsu", "fiu": "fiu",
    "san josé state": "san-jose-state", "san jose state": "san-jose-state", "app state": "app-st",
    "appalachian state": "app-st", "coastal carolina": "c-carolina", "georgia southern": "ga-southern",
    "florida atlantic": "fla-atlantic", "middle tennessee": "mtsu", "jacksonville state": "jax-state",
    "kennesaw state": "kennesaw-st", "western kentucky": "w-kentucky", "central michigan": "c-michigan",
    "eastern michigan": "e-michigan", "western michigan": "w-michigan", "northern illinois": "niu",
    "sam houston": "sam-houston", "sacramento state": "sac-state", "north dakota state": "ndsu",
    "texas a&m": "texas-a-m", "army": "army", "navy": "navy", "air force": "air-force",
    "southern miss": "southern-miss", "mississippi state": "mississippi-st", "missouri state": "missouri-state",
    "washington state": "washington-st", "san diego state": "san-diego-st", "new mexico state": "new-mexico-st",
    "louisiana tech": "louisiana-tech", "south florida": "usf", "usc": "usc", "southern california": "usc",
}


def get(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def build_lookup(teams: dict) -> dict[str, str]:
    lookup: dict[str, str] = {}
    for slug, t in teams.items():
        for key in (slug, slug.replace("-", " "), t["name"], t["school"], t["abbreviation"]):
            lookup.setdefault(norm(key), slug)
    for k, v in list(ALIASES.items()) + list(ESPN_ALIASES.items()):
        if v in teams:
            lookup[norm(k)] = v
    return lookup


def match_espn(team: dict, lookup: dict[str, str]) -> str | None:
    for key in (team.get("location", ""), team.get("displayName", ""), team.get("shortDisplayName", ""),
                team.get("abbreviation", ""), (team.get("slug") or "").replace("-", " ")):
        if key and norm(key) in lookup:
            return lookup[norm(key)]
    loc = norm(team.get("location", ""))
    if loc.endswith(" state") and loc[:-6] + " st" in lookup:
        return lookup[loc[:-6] + " st"]
    return None


def main() -> None:
    ours = json.loads(TEAMS_FILE.read_text(encoding="utf-8"))["teams"]
    fbs = {slug: t for slug, t in ours.items() if not t["fictional"]}
    lookup = build_lookup(fbs)

    listing = get(f"{API}/teams?limit=1000")["sports"][0]["leagues"][0]["teams"]
    espn_to_slug: dict[str, str] = {}
    for entry in listing:
        t = entry["team"]
        slug = match_espn(t, lookup)
        if slug and slug not in espn_to_slug.values():
            espn_to_slug[t["id"]] = slug
    missing = sorted(set(fbs) - set(espn_to_slug.values()))
    print(f"matched {len(espn_to_slug)} of {len(fbs)} FBS teams to ESPN ids; missing: {missing}")

    games: dict[str, dict] = {}
    fcs: dict[str, dict] = {}
    team_info = {}
    for i, (espn_id, slug) in enumerate(sorted(espn_to_slug.items(), key=lambda kv: kv[1]), 1):
        try:
            sched = get(f"{API}/teams/{espn_id}/schedule?season={SEASON}")
        except Exception as exc:  # noqa: BLE001
            print(f"  {slug}: schedule failed ({exc})")
            continue
        team_info[slug] = {"espn_id": espn_id, "espn_name": sched.get("team", {}).get("displayName")}
        for ev in sched.get("events", []):
            if ev.get("seasonType", {}).get("type", 2) != 2:
                continue            # regular season only
            comp = ev["competitions"][0]
            sides = {c["homeAway"]: c for c in comp["competitors"]}
            if "home" not in sides or "away" not in sides:
                continue
            rec = {"event_id": ev["id"], "week": ev.get("week", {}).get("number"), "date": ev.get("date"),
                   "neutral": bool(comp.get("neutralSite")),
                   "final": comp.get("status", {}).get("type", {}).get("name") == "STATUS_FINAL"}
            for side in ("home", "away"):
                team = sides[side]["team"]
                s = espn_to_slug.get(team["id"])
                rec[f"{side}_slug"] = s
                rec[f"{side}_name"] = team.get("displayName")
                rec[f"{side}_espn"] = team["id"]
                score = sides[side].get("score", {})
                rec[f"{side}_score"] = int(float(score["value"])) if isinstance(score, dict) and score.get("value") is not None else None
                if s is None:
                    fcs.setdefault(team["id"], {"name": team.get("displayName"), "location": team.get("location")})
            games[rec["event_id"]] = rec
        if i % 20 == 0:
            print(f"  {i}/{len(espn_to_slug)} schedules")
        time.sleep(0.2)

    # conference names for the non-FBS opponents (one request each)
    for espn_id, info in fcs.items():
        try:
            t = get(f"{API}/teams/{espn_id}")["team"]
            summary = t.get("standingSummary") or ""
            m = re.search(r"in (.+)$", summary)
            info["conference"] = m.group(1) if m else None
            info["group"] = (t.get("groups") or {}).get("id")
        except Exception:  # noqa: BLE001
            info["conference"] = None
        time.sleep(0.15)

    out = {"season": SEASON, "teams": team_info, "fcs": fcs,
           "games": sorted(games.values(), key=lambda g: (g["week"] or 99, g["date"] or ""))}
    OUT.write_text(json.dumps(out, indent=1), encoding="utf-8")
    n_fbs = sum(1 for g in out["games"] if g["home_slug"] and g["away_slug"])
    print(f"wrote {len(out['games'])} games ({n_fbs} FBS vs FBS, {len(out['games']) - n_fbs} vs non-FBS), "
          f"{len(fcs)} non-FBS opponents, to {OUT}")


if __name__ == "__main__":
    main()
