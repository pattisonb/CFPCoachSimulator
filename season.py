"""Full-season simulation: every FBS team's 2026 regular-season schedule, with
conference standings at the end.

Games come from data/schedules.json (fetch_schedules.py). FCS opponents are replaced by
the fictional FCS school closest to them (same region, data/fcs_map.json; built from the
school's home state the first time and editable afterwards). No injuries.

Modes:
    full       simulate every game from week 1
    remaining  keep the real scores of games already played, simulate the rest

Usage:  python season.py ohio-state [full|remaining]
"""
from __future__ import annotations

import json
import random
import time
import uuid
from datetime import datetime, timezone
from multiprocessing import Pool
from pathlib import Path
from typing import Callable, Optional

ROOT = Path(__file__).resolve().parent
TEAMS_FILE = ROOT / "data" / "engine_teams.json"
SCHEDULES_FILE = ROOT / "data" / "schedules.json"
FCS_MAP_FILE = ROOT / "data" / "fcs_map.json"
SEASONS_DIR = ROOT / "data" / "seasons"

# Fictional FCS schools by region (cfb_sim_data/README.md), keyed by US state.
REGION_TEAM = {
    "New England": "kestrel-bay", "Mid-Atlantic": "alder-ridge-state", "Southeast": "calder-springs",
    "Gulf Coast": "port-rennick-state", "Great Lakes": "wendt-lake-tech", "Plains": "red-prairie-state",
    "Mountain West": "talus-peak", "Pacific Northwest": "cedar-sound",
}
STATE_REGION = {
    **{s: "New England" for s in ("ME", "NH", "VT", "MA", "RI", "CT")},
    **{s: "Mid-Atlantic" for s in ("NY", "NJ", "PA", "DE", "MD", "DC", "VA", "WV")},
    **{s: "Southeast" for s in ("NC", "SC", "GA", "FL", "AL", "MS", "TN", "KY")},
    **{s: "Gulf Coast" for s in ("TX", "LA", "AR", "OK")},
    **{s: "Great Lakes" for s in ("MI", "OH", "IN", "IL", "WI", "MN")},
    **{s: "Plains" for s in ("ND", "SD", "NE", "KS", "IA", "MO")},
    **{s: "Mountain West" for s in ("CO", "UT", "MT", "ID", "WY", "AZ", "NM", "NV")},
    **{s: "Pacific Northwest" for s in ("WA", "OR", "CA", "AK", "HI")},
}
# Home states of the FCS schools that appear on 2026 FBS schedules.
FCS_STATES = {
    "Abilene Christian": "TX", "Alabama State": "AL", "Alcorn State": "MS", "Arkansas-Pine Bluff": "AR",
    "Austin Peay": "TN", "Bethune-Cookman": "FL", "Bryant": "RI", "Bucknell": "PA", "Cal Poly": "CA",
    "Campbell": "NC", "Central Arkansas": "AR", "Central Connecticut": "CT", "Charleston Southern": "SC",
    "Chattanooga": "TN", "Colgate": "NY", "Delaware State": "DE", "Duquesne": "PA",
    "East Tennessee State": "TN", "East Texas A&M": "TX", "Eastern Illinois": "IL", "Eastern Kentucky": "KY",
    "Eastern Washington": "WA", "Elon": "NC", "Florida A&M": "FL", "Fordham": "NY", "Furman": "SC",
    "Gardner-Webb": "NC", "Grambling": "LA", "Hampton": "VA", "Holy Cross": "MA", "Houston Christian": "TX",
    "Howard": "DC", "Idaho State": "ID", "Idaho": "ID", "Illinois State": "IL", "Incarnate Word": "TX",
    "Indiana State": "IN", "Lafayette": "PA", "Lamar": "TX", "Lindenwood": "MO", "Long Island University": "NY",
    "Maine": "ME", "McNeese": "LA", "Mercer": "GA", "Mercyhurst": "PA", "Merrimack": "MA",
    "Mississippi Valley State": "MS", "Monmouth": "NJ", "Montana": "MT", "Montana State": "MT",
    "Morgan State": "MD", "Murray State": "KY", "New Hampshire": "NH", "Nicholls": "LA", "Norfolk State": "VA",
    "North Alabama": "AL", "North Carolina A&T": "NC", "North Carolina Central": "NC", "North Dakota": "ND",
    "Northern Arizona": "AZ", "Northern Colorado": "CO", "Northern Iowa": "IA", "Northwestern State": "LA",
    "Portland State": "OR", "Prairie View A&M": "TX", "Rhode Island": "RI", "Richmond": "VA",
    "Robert Morris": "PA", "SE Louisiana": "LA", "Sacred Heart": "CT", "Samford": "AL", "South Dakota": "SD",
    "South Dakota State": "SD", "Southeast Missouri State": "MO", "Southern Illinois": "IL", "Southern": "LA",
    "Southern Utah": "UT", "Stonehill": "MA", "Stony Brook": "NY", "Tarleton State": "TX",
    "Tennessee State": "TN", "Tennessee Tech": "TN", "Texas Southern": "TX", "The Citadel": "SC",
    "Towson": "MD", "UAlbany": "NY", "UC Davis": "CA", "UT Martin": "TN", "UT Rio Grande Valley": "TX",
    "Utah Tech": "UT", "VMI": "VA", "Villanova": "PA", "Wagner": "NY", "Weber State": "UT",
    "West Georgia": "GA", "Western Carolina": "NC", "Western Illinois": "IL", "William & Mary": "VA",
    "Wofford": "SC",
}


def load_data() -> tuple[dict, dict]:
    teams = json.loads(TEAMS_FILE.read_text(encoding="utf-8"))["teams"]
    schedules = json.loads(SCHEDULES_FILE.read_text(encoding="utf-8"))
    return teams, schedules


def fcs_map(schedules: dict, teams: dict) -> dict[str, str]:
    """ESPN id of each non-FBS opponent -> fictional FCS slug. Built from the state table
    on first use and saved so it can be edited by hand."""
    if FCS_MAP_FILE.exists():
        saved = json.loads(FCS_MAP_FILE.read_text(encoding="utf-8"))
    else:
        saved = {}
    fictional = sorted(slug for slug, t in teams.items() if t["fictional"])
    changed = False
    for espn_id, info in schedules["fcs"].items():
        if espn_id in saved:
            continue
        location = info.get("location") or ""
        state = FCS_STATES.get(location)
        if state and STATE_REGION.get(state) in REGION_TEAM:
            slug = REGION_TEAM[STATE_REGION[state]]
        else:
            slug = fictional[hash(info.get("name", espn_id)) % len(fictional)]
        saved[espn_id] = {"name": info.get("name"), "state": state, "counterpart": slug}
        changed = True
    if changed:
        FCS_MAP_FILE.write_text(json.dumps(saved, indent=1), encoding="utf-8")
    return {k: v["counterpart"] for k, v in saved.items()}


# ----- simulation (one process per core) -----------------------------------

_TEAMS: dict = {}


def _init(path: str) -> None:
    global _TEAMS
    _TEAMS = json.loads(Path(path).read_text(encoding="utf-8"))["teams"]


def _sim_one(args: tuple) -> dict:
    from engine.game import simulate_game
    event_id, home, away, neutral, seed, keep_full = args
    r = simulate_game(_TEAMS[home], _TEAMS[away], None, seed, venue="neutral" if neutral else "home")
    out = {"event_id": event_id, "home_score": r["home"]["score"], "away_score": r["away"]["score"],
           "overtime": r["overtime_periods"]}
    if keep_full:
        r["home_slug"], r["away_slug"] = home, away
        out["game"] = r
    return out


def simulate_season(team_slug: str, mode: str = "full", seed: Optional[int] = None,
                    progress: Optional[Callable[[int, int], None]] = None, processes: Optional[int] = None) -> dict:
    teams, schedules = load_data()
    if team_slug not in teams:
        raise ValueError(f"unknown team {team_slug}")
    counterparts = fcs_map(schedules, teams)
    rng = random.Random(seed)
    jobs, fixed, meta = [], [], {}
    for g in schedules["games"]:
        home = g["home_slug"] or counterparts.get(g["home_espn"])
        away = g["away_slug"] or counterparts.get(g["away_espn"])
        if not home or not away or home == away or home not in teams or away not in teams:
            continue
        meta[g["event_id"]] = {**g, "home": home, "away": away,
                               "home_display": teams[home]["name"] if g["home_slug"] else f"{g['home_name']} (as {teams[home]['name']})",
                               "away_display": teams[away]["name"] if g["away_slug"] else f"{g['away_name']} (as {teams[away]['name']})"}
        if mode == "remaining" and g["final"] and g["home_score"] is not None:
            fixed.append({"event_id": g["event_id"], "home_score": g["home_score"], "away_score": g["away_score"],
                          "overtime": 0, "real": True})
            continue
        keep_full = team_slug in (home, away)
        jobs.append((g["event_id"], home, away, g["neutral"], rng.randrange(1 << 30), keep_full))

    results = {r["event_id"]: r for r in fixed}
    done, total = 0, len(jobs)
    started = time.perf_counter()
    with Pool(processes=processes, initializer=_init, initargs=(str(TEAMS_FILE),)) as pool:
        for r in pool.imap_unordered(_sim_one, jobs, chunksize=8):
            results[r["event_id"]] = r
            done += 1
            if progress and (done % 10 == 0 or done == total):
                progress(done, total)

    return build_result(team_slug, mode, teams, meta, results, seed, time.perf_counter() - started)


def build_result(team_slug: str, mode: str, teams: dict, meta: dict, results: dict, seed, elapsed: float) -> dict:
    records = {slug: {"slug": slug, "name": t["name"], "conference": t["conference"], "fictional": t["fictional"],
                      "wins": 0, "losses": 0, "conf_wins": 0, "conf_losses": 0, "points_for": 0, "points_against": 0,
                      "results": []}
               for slug, t in teams.items()}
    games_out = []
    for event_id, r in results.items():
        g = meta[event_id]
        home, away = g["home"], g["away"]
        hs, as_ = r["home_score"], r["away_score"]
        winner = home if hs > as_ else away
        conf_game = teams[home]["conference"] == teams[away]["conference"] and not teams[home]["fictional"]
        for slug, pf, pa, opp, venue in ((home, hs, as_, away, "neutral" if g["neutral"] else "home"),
                                        (away, as_, hs, home, "neutral" if g["neutral"] else "away")):
            rec = records[slug]
            rec["points_for"] += pf
            rec["points_against"] += pa
            won = slug == winner
            rec["wins" if won else "losses"] += 1
            if conf_game:
                rec["conf_wins" if won else "conf_losses"] += 1
            rec["results"].append({"event_id": event_id, "week": g["week"], "date": g["date"], "opponent": opp,
                                   "opponent_name": g["away_display"] if slug == home else g["home_display"],
                                   "venue": venue, "won": won, "points_for": pf, "points_against": pa,
                                   "overtime": r.get("overtime", 0), "real": r.get("real", False),
                                   "conference_game": conf_game, "has_box": "game" in r})
        games_out.append({"event_id": event_id, "week": g["week"], "home": home, "away": away, "home_score": hs,
                          "away_score": as_, "neutral": g["neutral"], "real": r.get("real", False)})
    for rec in records.values():
        rec["results"].sort(key=lambda x: (x["week"] or 99, x["date"] or ""))

    def key(rec):
        cg = rec["conf_wins"] + rec["conf_losses"]
        g = rec["wins"] + rec["losses"]
        return (-(rec["conf_wins"] / cg if cg else 0), -(rec["wins"] / g if g else 0),
                -(rec["points_for"] - rec["points_against"]))

    standings = {}
    for rec in records.values():
        if rec["fictional"] or rec["wins"] + rec["losses"] == 0:
            continue
        standings.setdefault(rec["conference"], []).append(rec)
    for conf in standings:
        standings[conf].sort(key=key)
        for i, rec in enumerate(standings[conf], 1):
            rec["conf_rank"] = i
    poll = sorted((rec for rec in records.values() if not rec["fictional"]),
                  key=lambda rec: (-(rec["wins"] / max(1, rec["wins"] + rec["losses"])),
                                   -(rec["points_for"] - rec["points_against"])))[:25]

    my_games = {eid: r["game"] for eid, r in results.items() if "game" in r}
    return {
        "id": uuid.uuid4().hex[:12], "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "team": team_slug, "team_name": teams[team_slug]["name"], "conference": teams[team_slug]["conference"],
        "mode": mode, "seed": seed, "elapsed_s": round(elapsed, 1), "games_simulated": sum(1 for r in results.values() if not r.get("real")),
        "my_record": {k: records[team_slug][k] for k in ("wins", "losses", "conf_wins", "conf_losses", "points_for", "points_against", "results")},
        "standings": {conf: [{k: v for k, v in rec.items() if k != "results"} for rec in rows] for conf, rows in standings.items()},
        "top25": [{k: v for k, v in rec.items() if k != "results"} for rec in poll],
        "games": games_out,
        "my_boxes": my_games,
    }


def save_season(result: dict) -> Path:
    SEASONS_DIR.mkdir(parents=True, exist_ok=True)
    path = SEASONS_DIR / f"{result['id']}.json"
    path.write_text(json.dumps(result), encoding="utf-8")
    return path


if __name__ == "__main__":
    import sys
    slug = sys.argv[1] if len(sys.argv) > 1 else "ohio-state"
    mode = sys.argv[2] if len(sys.argv) > 2 else "full"
    res = simulate_season(slug, mode, progress=lambda d, t: print(f"  {d}/{t}", end="\r"))
    rec = res["my_record"]
    print(f"\n{res['team_name']} {rec['wins']}-{rec['losses']} ({rec['conf_wins']}-{rec['conf_losses']} {res['conference']}), "
          f"{res['games_simulated']} games simulated in {res['elapsed_s']}s")
    for g in rec["results"]:
        print(f"  wk{g['week']:>2} {'W' if g['won'] else 'L'} {g['points_for']:>2}-{g['points_against']:<2} "
              f"{'vs' if g['venue'] != 'away' else 'at'} {g['opponent_name']}{' (real)' if g['real'] else ''}")
    print(f"\n{res['conference']} standings:")
    for r in res["standings"][res["conference"]]:
        print(f"  {r['conf_rank']:>2}. {r['name']:<20} {r['conf_wins']}-{r['conf_losses']}  ({r['wins']}-{r['losses']})")
    print("\nTop 10 by record:", [(r['name'], f"{r['wins']}-{r['losses']}") for r in res["top25"][:10]])
    print("saved to", save_season(res))
