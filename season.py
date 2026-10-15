"""Week-by-week season simulation with polls, conference championships, the CFP bracket
and the playoff. No injuries.

A season is a JSON-serialisable dict (data/seasons/<id>.json) that advances one week at
a time. Weeks 1-13 are the regular season (2026 calendar: week 13 ends Nov 28), week 14
is conference championship week, week 15 holds the games scheduled after it (Army-Navy)
and the playoff selection, then weeks 16-19 are the playoff rounds (first round at the
higher seed's home, quarterfinals, semifinals, championship on neutral fields).

Polls: the AP poll starts from the real 2026 preseason poll and is updated after every
week by the model in polls.py; the committee ranking appears after weeks 9-13 and the
final one after week 14, matching the 2026 release schedule (Nov 3 through Dec 6).

Modes:
    full       every game simulated from week 1
    remaining  real results and real polls kept through the last completed week; the
               rest is simulated

Games against FCS schools are played against the fictional FCS school from the same
region (data/fcs_map.json).

Usage:  python season.py ohio-state [full|remaining]      # simulate to the end and print
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

import polls

ROOT = Path(__file__).resolve().parent
TEAMS_FILE = ROOT / "data" / "engine_teams.json"
SCHEDULES_FILE = ROOT / "data" / "schedules.json"
FCS_MAP_FILE = ROOT / "data" / "fcs_map.json"
HISTORY_POLLS = ROOT / "data" / "history" / "polls.json"
SEASONS_DIR = ROOT / "data" / "seasons"

LAST_REGULAR_WEEK = 13
CCG_WEEK = 14
SELECTION_WEEK = 15
PLAYOFF_WEEKS = {16: "First round", 17: "Quarterfinals", 18: "Semifinals", 19: "National championship"}
CFP_WEEKS = {9, 10, 11, 12, 13, 14}   # committee rankings released after these weeks (Nov 3 ... Dec 6, 2026)

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
    "Wofford": "SC", "Youngstown State": "OH",
}

# NCAA.com / ESPN short names used in the 2026 polls -> our slugs (beyond the generic matcher)
_teams_cache: dict = {}


def load_teams() -> dict:
    global _teams_cache
    if not _teams_cache:
        _teams_cache = json.loads(TEAMS_FILE.read_text(encoding="utf-8"))["teams"]
    return _teams_cache


def tier_of(team: dict) -> str:
    if team["fictional"]:
        return "FCS"
    if team["conference"] in polls.P4 or team["slug"] == "notre-dame":
        return "P4"
    return "G5"


def fcs_map(schedules: dict, teams: dict) -> dict[str, str]:
    saved = json.loads(FCS_MAP_FILE.read_text(encoding="utf-8")) if FCS_MAP_FILE.exists() else {}
    fictional = sorted(slug for slug, t in teams.items() if t["fictional"])
    changed = False
    for espn_id, info in schedules["fcs"].items():
        if espn_id in saved:
            continue
        state = FCS_STATES.get(info.get("location") or "")
        if state and STATE_REGION.get(state) in REGION_TEAM:
            slug = REGION_TEAM[STATE_REGION[state]]
        else:
            slug = fictional[hash(info.get("name", espn_id)) % len(fictional)]
        saved[espn_id] = {"name": info.get("name"), "state": state, "counterpart": slug}
        changed = True
    if changed:
        FCS_MAP_FILE.write_text(json.dumps(saved, indent=1), encoding="utf-8")
    return {k: v["counterpart"] for k, v in saved.items()}


# ----- real 2026 polls (preseason and, in "remaining" mode, the weeks already played) ----

def _real_polls_2026(teams: dict) -> dict:
    """{week_after: [slugs]} for the AP polls in data/history/polls.json; week 0 = preseason."""
    if not HISTORY_POLLS.exists():
        return {}
    hist = json.loads(HISTORY_POLLS.read_text(encoding="utf-8")).get("2026")
    if not hist:
        return {}
    from calibrate_season import build_matcher, match
    lookup = build_matcher(teams)
    out = {}
    pre = hist.get("preseason") or []
    if pre:
        out[0] = [match(r["name"] or "", lookup) for r in sorted(pre, key=lambda r: r["rank"])]
    for w, v in hist.get("weeks", {}).items():
        if "ap" in v:
            # ESPN's "week N" poll is the one heading into week N, i.e. after week N-1
            out[int(w) - 1] = [match(r["name"] or "", lookup) for r in sorted(v["ap"], key=lambda r: r["rank"])]
    return {w: [s for s in lst if s] for w, lst in out.items()}


# ----- season state --------------------------------------------------------

def new_season(team_slug: str, mode: str = "full", seed: Optional[int] = None) -> dict:
    teams = load_teams()
    if team_slug not in teams:
        raise ValueError(f"unknown team {team_slug}")
    schedules = json.loads(SCHEDULES_FILE.read_text(encoding="utf-8"))
    counterparts = fcs_map(schedules, teams)
    rng = random.Random(seed)
    games = {}
    for g in schedules["games"]:
        home = g["home_slug"] or counterparts.get(g["home_espn"])
        away = g["away_slug"] or counterparts.get(g["away_espn"])
        if not home or not away or home == away or home not in teams or away not in teams:
            continue
        week = g["week"] or SELECTION_WEEK
        if week == 14:
            week = SELECTION_WEEK  # ESPN "week 14" is after the title games on this calendar
        rec = {"event_id": g["event_id"], "week": week, "date": g["date"], "neutral": g["neutral"],
               "home": home, "away": away,
               "home_display": teams[home]["name"] if g["home_slug"] else f"{g['home_name']} (as {teams[home]['name']})",
               "away_display": teams[away]["name"] if g["away_slug"] else f"{g['away_name']} (as {teams[away]['name']})",
               "conference_game": teams[home]["conference"] == teams[away]["conference"] and not teams[home]["fictional"],
               "played": False, "home_score": None, "away_score": None, "overtime": 0, "real": False, "kind": "regular"}
        if mode == "remaining" and g["final"] and g["home_score"] is not None:
            rec.update(played=True, home_score=g["home_score"], away_score=g["away_score"], real=True)
        games[rec["event_id"]] = rec

    # current week = last week in which every game has been played (remaining mode)
    current = 0
    if mode == "remaining":
        for w in range(1, LAST_REGULAR_WEEK + 1):
            wk = [g for g in games.values() if g["week"] == w]
            if wk and all(g["played"] for g in wk):
                current = w
            else:
                break

    state = {
        "id": uuid.uuid4().hex[:12], "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "team": team_slug, "team_name": teams[team_slug]["name"], "conference": teams[team_slug]["conference"],
        "mode": mode, "seed": seed, "current_week": current, "phase": "regular", "done": False,
        "games": games, "polls": {}, "scores": {}, "champions": {}, "bracket": None, "playoff": {}, "my_boxes": {},
        "rng_state": rng.randrange(1 << 30),
    }
    real = _real_polls_2026(teams) if mode == "remaining" else {}
    preseason = real.get(0) or _real_polls_2026(teams).get(0) or _rating_poll(teams)
    ap_params, _ = polls.load_params()
    ratings = {slug: t["team_ratings"]["overall"] for slug, t in teams.items() if not t["fictional"]}
    state["scores"] = polls.preseason_scores(preseason[:25], ratings, ap_params)
    state["polls"]["0"] = {"ap": _poll_entries(preseason[:25], {}, state, teams)}
    # remaining mode: replay the played weeks through the model (scores) but show the real polls
    if mode == "remaining" and current > 0:
        for w in range(1, current + 1):
            _update_polls_after_week(state, teams, w, real_ap=real.get(w))
    return state


def _rating_poll(teams: dict) -> list[str]:
    return [slug for slug, t in sorted(teams.items(), key=lambda kv: -kv[1]["team_ratings"]["overall"]) if not t["fictional"]][:25]


def _records(state: dict, through_week: Optional[int] = None) -> dict[str, dict]:
    teams = load_teams()
    rec = {slug: {"wins": 0, "losses": 0, "conf_wins": 0, "conf_losses": 0, "points_for": 0, "points_against": 0}
           for slug in teams}
    for g in state["games"].values():
        if not g["played"] or (through_week is not None and g["week"] > through_week) or g["kind"] == "playoff":
            continue
        hs, as_ = g["home_score"], g["away_score"]
        for slug, pf, pa in ((g["home"], hs, as_), (g["away"], as_, hs)):
            r = rec[slug]
            r["points_for"] += pf
            r["points_against"] += pa
            won = pf > pa
            r["wins" if won else "losses"] += 1
            if g["conference_game"] and g["kind"] == "regular":
                r["conf_wins" if won else "conf_losses"] += 1
    return rec


def _opponents(state: dict) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for g in state["games"].values():
        if not g["played"] or g["kind"] == "playoff":
            continue
        for side, opp in (("home", "away"), ("away", "home")):
            out.setdefault(g[side], []).append({"opp": g[opp], "won": g[f"{side}_score"] > g[f"{opp}_score"], "week": g["week"]})
    return out


def standings(state: dict) -> dict[str, list[dict]]:
    teams = load_teams()
    rec = _records(state)
    opp = _opponents(state)
    table: dict[str, list[dict]] = {}
    for slug, t in teams.items():
        if t["fictional"]:
            continue
        r = {"slug": slug, "name": t["name"], **rec[slug]}
        table.setdefault(t["conference"], []).append(r)

    def h2h(a: str, b: str) -> int:
        for o in opp.get(a, []):
            if o["opp"] == b:
                return 1 if o["won"] else -1
        return 0

    for conf, rows in table.items():
        def key(r):
            cg = r["conf_wins"] + r["conf_losses"]
            g = r["wins"] + r["losses"]
            return (-(r["conf_wins"] / cg if cg else 0), -(r["wins"] / g if g else 0), -(r["points_for"] - r["points_against"]))
        rows.sort(key=key)
        # head-to-head between adjacent teams with the same conference record
        for i in range(1, len(rows)):
            a, b = rows[i - 1], rows[i]
            if (a["conf_wins"], a["conf_losses"]) == (b["conf_wins"], b["conf_losses"]) and h2h(b["slug"], a["slug"]) > 0:
                rows[i - 1], rows[i] = b, a
        for i, r in enumerate(rows, 1):
            r["conf_rank"] = i
        champ = state["champions"].get(conf)
        if champ:
            for r in rows:
                r["champion"] = r["slug"] == champ
    return table


def _poll_entries(order: list[str], prev_rank: dict[str, int], state: dict, teams: dict, week: Optional[int] = None) -> list[dict]:
    rec = _records(state, week)
    out = []
    for i, slug in enumerate(order, 1):
        r = rec.get(slug, {"wins": 0, "losses": 0})
        out.append({"rank": i, "team": slug, "name": teams[slug]["name"], "previous": prev_rank.get(slug),
                    "record": f"{r['wins']}-{r['losses']}", "conference": teams[slug]["conference"]})
    return out


def _update_polls_after_week(state: dict, teams: dict, week: int, real_ap: Optional[list[str]] = None) -> None:
    ap_params, cfp_params = polls.load_params()
    tiers = {slug: tier_of(t) for slug, t in teams.items()}
    prev = state["polls"].get(str(week - 1), {}).get("ap", [])
    prev_rank = {e["team"]: e["rank"] for e in prev}
    week_games = [{"home": g["home"], "away": g["away"], "home_score": g["home_score"], "away_score": g["away_score"],
                   "neutral": g["neutral"]} for g in state["games"].values() if g["played"] and g["week"] == week and g["kind"] != "playoff"]
    rec = _records(state, week)
    rec_t = {s: (r["wins"], r["losses"]) for s, r in rec.items()}
    state["scores"] = polls.update_scores(state["scores"], week_games, prev_rank, rec_t, tiers, week, CCG_WEEK, ap_params)
    order = real_ap[:25] if real_ap else polls.rank(state["scores"], rec_t, tiers, ap_params)
    entry = {"ap": _poll_entries(order, prev_rank, state, teams, week)}
    if week in CFP_WEEKS:
        opp = _opponents(state)
        opp_full = {t: [{"opp": o["opp"], "won": o["won"], "opp_record": rec_t.get(o["opp"], (0, 0))} for o in lst] for t, lst in opp.items()}
        ap_rank = {e["team"]: e["rank"] for e in entry["ap"]}
        champions = state["champions"] if week >= CCG_WEEK else None
        corder = polls.committee_rank(state["scores"], rec_t, tiers, opp_full, ap_rank, champions, cfp_params, n=60)
        prev_cfp = {e["team"]: e["rank"] for e in state["polls"].get(str(week - 1), {}).get("cfp", [])}
        entry["cfp"] = _poll_entries(corder[:25], prev_cfp, state, teams, week)
        entry["cfp_full"] = corder   # the committee's full order, used for the bracket's auto bids
    state["polls"][str(week)] = entry


# ----- simulation ----------------------------------------------------------

_TEAMS: dict = {}


def _init(path: str) -> None:
    global _TEAMS
    _TEAMS = json.loads(Path(path).read_text(encoding="utf-8"))["teams"]


def _sim_one(args: tuple) -> dict:
    from engine.game import simulate_game
    event_id, home, away, neutral, seed, keep_full = args
    r = simulate_game(_TEAMS[home], _TEAMS[away], None, seed, venue="neutral" if neutral else "home")
    out = {"event_id": event_id, "home_score": r["home"]["score"], "away_score": r["away"]["score"], "overtime": r["overtime_periods"]}
    if keep_full:
        r["home_slug"], r["away_slug"] = home, away
        out["game"] = r
    return out


def _run_games(state: dict, game_ids: list[str], pool: Optional[Pool] = None) -> None:
    rng = random.Random(state["rng_state"])
    jobs = []
    for eid in game_ids:
        g = state["games"][eid]
        keep = state["team"] in (g["home"], g["away"])
        jobs.append((eid, g["home"], g["away"], g["neutral"], rng.randrange(1 << 30), keep))
    state["rng_state"] = rng.randrange(1 << 30)
    if not jobs:
        return
    if pool is None:
        with Pool(initializer=_init, initargs=(str(TEAMS_FILE),)) as p:
            results = list(p.imap_unordered(_sim_one, jobs, chunksize=4))
    else:
        results = list(pool.imap_unordered(_sim_one, jobs, chunksize=4))
    for r in results:
        g = state["games"][r["event_id"]]
        g.update(played=True, home_score=r["home_score"], away_score=r["away_score"], overtime=r["overtime"])
        if "game" in r:
            state["my_boxes"][r["event_id"]] = r["game"]


def _ccg_matchups(state: dict, teams: dict) -> list[dict]:
    table = standings(state)
    out = []
    for conf, rows in table.items():
        if conf in polls.INDEPENDENT or len(rows) < 4:
            continue
        a, b = rows[0], rows[1]
        out.append({"event_id": f"ccg-{conf.lower().replace(' ', '-')}", "week": CCG_WEEK, "date": None, "neutral": True,
                    "home": a["slug"], "away": b["slug"], "home_display": a["name"], "away_display": b["name"],
                    "conference_game": False, "played": False, "home_score": None, "away_score": None, "overtime": 0,
                    "real": False, "kind": "ccg", "conference": conf, "title": f"{conf} Championship"})
    return out


def _playoff_round(state: dict, week: int, teams: dict) -> list[dict]:
    """Create the games of a playoff round from the bracket and earlier rounds."""
    br = state["bracket"]
    seeds = {s["seed"]: s["team"] for s in br["seeds"]}
    games = []

    def mk(eid, home, away, neutral, title, home_seed, away_seed):
        return {"event_id": eid, "week": week, "date": None, "neutral": neutral, "home": home, "away": away,
                "home_display": f"({home_seed}) {teams[home]['name']}", "away_display": f"({away_seed}) {teams[away]['name']}",
                "conference_game": False, "played": False, "home_score": None, "away_score": None, "overtime": 0,
                "real": False, "kind": "playoff", "title": title, "home_seed": home_seed, "away_seed": away_seed}

    def winner(eid):
        g = state["games"][eid]
        return (g["home"], g["home_seed"]) if g["home_score"] > g["away_score"] else (g["away"], g["away_seed"])

    if week == 16:
        for hs, as_ in ((5, 12), (6, 11), (7, 10), (8, 9)):
            games.append(mk(f"cfp-r1-{hs}", seeds[hs], seeds[as_], False, f"First round: {hs} vs {as_}", hs, as_))
    elif week == 17:
        for top, eid, label in ((1, "cfp-r1-8", "1 vs 8/9"), (2, "cfp-r1-7", "2 vs 7/10"), (3, "cfp-r1-6", "3 vs 6/11"), (4, "cfp-r1-5", "4 vs 5/12")):
            w, ws = winner(eid)
            games.append(mk(f"cfp-qf-{top}", seeds[top], w, True, f"Quarterfinal: {label}", top, ws))
    elif week == 18:
        (a, a_s), (b, b_s) = winner("cfp-qf-1"), winner("cfp-qf-4")
        games.append(mk("cfp-sf-1", a, b, True, "Semifinal", a_s, b_s))
        (c, c_s), (d, d_s) = winner("cfp-qf-2"), winner("cfp-qf-3")
        games.append(mk("cfp-sf-2", c, d, True, "Semifinal", c_s, d_s))
    elif week == 19:
        (a, a_s), (b, b_s) = winner("cfp-sf-1"), winner("cfp-sf-2")
        games.append(mk("cfp-final", a, b, True, "National championship", a_s, b_s))
    return games


def advance(state: dict, pool: Optional[Pool] = None) -> dict:
    """Play the next week. Returns the state."""
    if state["done"]:
        return state
    teams = load_teams()
    week = state["current_week"] + 1
    if week == CCG_WEEK:
        for g in _ccg_matchups(state, teams):
            state["games"][g["event_id"]] = g
    if week in PLAYOFF_WEEKS:
        for g in _playoff_round(state, week, teams):
            state["games"][g["event_id"]] = g
    ids = [eid for eid, g in state["games"].items() if g["week"] == week and not g["played"]]
    _run_games(state, ids, pool)

    if week == CCG_WEEK:
        for g in state["games"].values():
            if g["kind"] == "ccg":
                state["champions"][g["conference"]] = g["home"] if g["home_score"] > g["away_score"] else g["away"]
    if week <= CCG_WEEK:
        _update_polls_after_week(state, teams, week)
    if week == CCG_WEEK:
        final = state["polls"][str(week)].get("cfp_full") or [e["team"] for e in state["polls"][str(week)]["cfp"]]
        conf_of = {slug: t["conference"] for slug, t in teams.items()}
        names = {slug: t["name"] for slug, t in teams.items()}
        state["bracket"] = polls.build_bracket(final, state["champions"], conf_of, names)
        state["phase"] = "playoff"
    if week in PLAYOFF_WEEKS:
        state["playoff"][PLAYOFF_WEEKS[week]] = [eid for eid, g in state["games"].items() if g["week"] == week]
        if week == 19:
            g = state["games"]["cfp-final"]
            state["champion"] = g["home"] if g["home_score"] > g["away_score"] else g["away"]
            state["done"] = True
            state["phase"] = "done"
    state["current_week"] = week
    return state


def advance_to(state: dict, target_week: int, progress: Optional[Callable[[int, int], None]] = None) -> dict:
    target = min(target_week, 19)
    with Pool(initializer=_init, initargs=(str(TEAMS_FILE),)) as pool:
        while state["current_week"] < target and not state["done"]:
            advance(state, pool)
            if progress:
                progress(state["current_week"], target)
    return state


def save_season(state: dict) -> Path:
    SEASONS_DIR.mkdir(parents=True, exist_ok=True)
    path = SEASONS_DIR / f"{state['id']}.json"
    path.write_text(json.dumps(state), encoding="utf-8")
    return path


def load_season(season_id: str) -> Optional[dict]:
    path = SEASONS_DIR / f"{season_id}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


# ----- views for the page --------------------------------------------------

def week_view(state: dict, week: int) -> list[dict]:
    teams = load_teams()
    ap = {e["team"]: e["rank"] for e in state["polls"].get(str(week - 1), {}).get("ap", [])}
    out = []
    for g in state["games"].values():
        if g["week"] != week:
            continue
        out.append({**{k: v for k, v in g.items()}, "home_rank": ap.get(g["home"]), "away_rank": ap.get(g["away"]),
                    "mine": state["team"] in (g["home"], g["away"]), "has_box": g["event_id"] in state["my_boxes"],
                    "home_name": teams[g["home"]]["name"], "away_name": teams[g["away"]]["name"]})
    out.sort(key=lambda g: (not g["mine"], g["kind"] != "playoff", g["date"] or "", g["event_id"]))
    return out


def summary(state: dict) -> dict:
    teams = load_teams()
    rec = _records(state)[state["team"]]
    my_games = sorted((g for g in state["games"].values() if state["team"] in (g["home"], g["away"])),
                      key=lambda g: (g["week"], g["date"] or ""))
    schedule = []
    for g in my_games:
        home = g["home"] == state["team"]
        opp = g["away"] if home else g["home"]
        schedule.append({"event_id": g["event_id"], "week": g["week"], "kind": g["kind"], "title": g.get("title"),
                         "opponent": opp, "opponent_name": g["away_display"] if home else g["home_display"],
                         "venue": "neutral" if g["neutral"] else ("home" if home else "away"), "played": g["played"],
                         "won": (g["home_score"] > g["away_score"]) == home if g["played"] else None,
                         "points_for": (g["home_score"] if home else g["away_score"]) if g["played"] else None,
                         "points_against": (g["away_score"] if home else g["home_score"]) if g["played"] else None,
                         "overtime": g["overtime"], "real": g["real"], "has_box": g["event_id"] in state["my_boxes"]})
    weeks = sorted({g["week"] for g in state["games"].values()} | {CCG_WEEK, SELECTION_WEEK} | set(PLAYOFF_WEEKS))
    return {
        "id": state["id"], "team": state["team"], "team_name": state["team_name"], "conference": state["conference"],
        "mode": state["mode"], "created_at": state["created_at"], "current_week": state["current_week"],
        "phase": state["phase"], "done": state["done"], "champion": state.get("champion"),
        "champion_name": teams[state["champion"]]["name"] if state.get("champion") else None,
        "record": rec, "schedule": schedule, "weeks": weeks,
        "week_labels": {**{w: f"Week {w}" for w in range(1, LAST_REGULAR_WEEK + 1)}, CCG_WEEK: "Championship week",
                        SELECTION_WEEK: "Selection", **PLAYOFF_WEEKS},
        "polls": state["polls"], "champions": state["champions"], "bracket": state["bracket"], "playoff": state["playoff"],
        "cfp_weeks": sorted(CFP_WEEKS),
    }


if __name__ == "__main__":
    import sys
    slug = sys.argv[1] if len(sys.argv) > 1 else "ohio-state"
    mode = sys.argv[2] if len(sys.argv) > 2 else "full"
    t0 = time.perf_counter()
    st = new_season(slug, mode)
    advance_to(st, 19, progress=lambda w, t: print(f"  week {w}", end="\r"))
    s = summary(st)
    print(f"\n{s['team_name']} {s['record']['wins']}-{s['record']['losses']} in {time.perf_counter() - t0:.1f}s; champion: {s['champion_name']}")
    for g in s["schedule"]:
        print(f"  wk{g['week']:>2} {'W' if g['won'] else 'L'} {g['points_for']:>2}-{g['points_against']:<2} {g['opponent_name']} {g.get('title') or ''}")
    print("\nFinal AP top 10:", [(e["rank"], e["name"], e["record"]) for e in st["polls"]["14"]["ap"][:10]])
    print("Final CFP top 12:", [(e["rank"], e["name"], e["record"]) for e in st["polls"]["14"]["cfp"][:12]])
    print("Champions:", st["champions"])
    print("Bracket seeds:", [(x["seed"], x["name"], x["bid"]) for x in st["bracket"]["seeds"]])
    print("saved", save_season(st))
