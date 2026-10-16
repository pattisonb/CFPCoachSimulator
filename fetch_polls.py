"""Download the College Football Playoff era (2014-2025) poll archive from ESPN:
every weekly AP Top 25 and CFP committee ranking, the preseason and final AP polls, and
every FBS game result with the teams' ranks at kickoff. Also the current (2026)
preseason and weekly AP polls.

Output: data/history/polls.json
    {season: {"preseason": [rank...], "weeks": {week: {"ap": [rank...], "cfp": [rank...]}},
              "final": [rank...]}}
    rank = {"rank", "previous", "team" (ESPN id), "name", "record", "points", "first_place"}
Output: data/history/results.json
    {season: {week: [{"id", "date", "neutral", "conference_game", "home": {"id","name","rank","score","record"},
                      "away": {...}}]}}

Usage:  python fetch_polls.py            # all seasons, skipping ones already saved
        python fetch_polls.py 2024       # one season (re-fetched)
"""
from __future__ import annotations

import json
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT_DIR = ROOT / "data" / "history"
CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football"
SITE = "https://site.api.espn.com/apis/site/v2/sports/football/college-football"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
SEASONS = list(range(2014, 2026))
MAX_WEEK = 16


def get(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=40) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise


def ref_id(ref: str) -> str:
    return ref.split("?")[0].rstrip("/").split("/")[-1]


def parse_ranking(d: dict, names: dict) -> list[dict]:
    out = []
    for r in d.get("ranks", []):
        tid = ref_id(r["team"]["$ref"])
        rec = r.get("record")
        out.append({"rank": r.get("current"), "previous": r.get("previous"), "team": tid, "name": names.get(tid),
                    "record": rec.get("summary") if isinstance(rec, dict) else rec,
                    "points": r.get("points"), "first_place": r.get("firstPlaceVotes")})
    return out


def rankings_for(season: int, stype: int, week: int, names: dict) -> dict:
    """AP and CFP rankings for one week, found by name in the week's ranking list."""
    lst = get(f"{CORE}/seasons/{season}/types/{stype}/weeks/{week}/rankings?limit=50")
    out = {}
    for item in (lst or {}).get("items", []):
        rid = ref_id(item["$ref"])
        if rid not in ("1", "21") and rid not in ("20",):
            # cheap first pass: AP is id 1; the CFP id varies, so read names for the rest
            pass
        d = get(f"{CORE}/seasons/{season}/types/{stype}/weeks/{week}/rankings/{rid}")
        if not d:
            continue
        name = (d.get("name") or "").lower()
        if name == "ap top 25":
            out["ap"] = parse_ranking(d, names)
        elif name == "afca coaches poll":        # the FBS one; ESPN also lists FCS, D-II and D-III coaches polls
            out["coaches"] = parse_ranking(d, names)
        elif "playoff" in name:
            out["cfp"] = parse_ranking(d, names)
        time.sleep(0.1)
    return out


def scoreboard(season: int, stype: int, week: int) -> list[dict]:
    d = get(f"{SITE}/scoreboard?dates={season}&seasontype={stype}&week={week}&groups=80&limit=400")
    games = []
    for ev in (d or {}).get("events", []):
        if not ev.get("competitions"):
            continue
        comp = ev["competitions"][0]
        if comp.get("status", {}).get("type", {}).get("name") != "STATUS_FINAL":
            continue
        rec = {"id": ev["id"], "date": ev.get("date"), "neutral": bool(comp.get("neutralSite")),
               "conference_game": bool(comp.get("conferenceCompetition")), "week": week, "type": stype}
        ok = True
        for c in comp["competitors"]:
            side = c.get("homeAway")
            if side not in ("home", "away"):
                ok = False
                break
            rank = (c.get("curatedRank") or {}).get("current")
            rec[side] = {"id": c["team"]["id"], "name": c["team"].get("location") or c["team"].get("displayName"),
                         "rank": None if rank in (None, 99) else rank,
                         "score": int(float(c.get("score") or 0)),
                         "record": next((r.get("summary") for r in c.get("records", []) if r.get("type") == "total"), None),
                         "conference_id": c["team"].get("conferenceId")}
        if ok and "home" in rec and "away" in rec:
            games.append(rec)
    return games


def fetch_season(season: int) -> tuple[dict, dict]:
    results, names = {}, {}
    for week in range(1, MAX_WEEK + 1):
        games = scoreboard(season, 2, week)
        if games:
            results[str(week)] = games
            for g in games:
                for side in ("home", "away"):
                    names[g[side]["id"]] = g[side]["name"]
        time.sleep(0.15)
    post = scoreboard(season, 3, 1)
    if post:
        results["post"] = post
        for g in post:
            for side in ("home", "away"):
                names[g[side]["id"]] = g[side]["name"]

    polls = {"preseason": [], "weeks": {}, "final": []}
    pre = get(f"{CORE}/seasons/{season}/types/1/weeks/1/rankings/1")
    if pre:
        polls["preseason"] = parse_ranking(pre, names)
    for week in range(1, MAX_WEEK + 1):
        r = rankings_for(season, 2, week, names)
        if r:
            polls["weeks"][str(week)] = r
        time.sleep(0.1)
    final = get(f"{CORE}/seasons/{season}/types/3/weeks/1/rankings/1")
    if final:
        polls["final"] = parse_ranking(final, names)
    post = rankings_for(season, 3, 1, names)
    if post.get("cfp"):
        polls["cfp_final"] = post["cfp"]
    if post.get("coaches"):
        polls["coaches_final"] = post["coaches"]
    pre_coaches = rankings_for(season, 1, 1, names).get("coaches")
    if pre_coaches:
        polls["coaches_preseason"] = pre_coaches
    return polls, results


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    polls_file, results_file = OUT_DIR / "polls.json", OUT_DIR / "results.json"
    polls = json.loads(polls_file.read_text(encoding="utf-8")) if polls_file.exists() else {}
    results = json.loads(results_file.read_text(encoding="utf-8")) if results_file.exists() else {}
    seasons = [int(sys.argv[1])] if len(sys.argv) > 1 else SEASONS + [2026]
    for season in seasons:
        if str(season) in polls and len(sys.argv) == 1 and season != 2026:
            print(f"{season}: already saved")
            continue
        t0 = time.time()
        p, r = fetch_season(season)
        polls[str(season)] = p
        results[str(season)] = r
        polls_file.write_text(json.dumps(polls), encoding="utf-8")
        results_file.write_text(json.dumps(results), encoding="utf-8")
        weeks_ap = sum(1 for w in p["weeks"].values() if "ap" in w)
        weeks_cfp = sum(1 for w in p["weeks"].values() if "cfp" in w)
        print(f"{season}: {sum(len(v) for v in r.values())} games, {weeks_ap} AP weeks, {weeks_cfp} CFP weeks, "
              f"preseason {len(p['preseason'])}, final {len(p['final'])} ({time.time() - t0:.0f}s)")


if __name__ == "__main__":
    main()
