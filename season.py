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
import math
import os
import random
import signal
import time
import uuid
from datetime import datetime, timedelta, timezone
from multiprocessing import Pool
from pathlib import Path
from typing import Callable, Optional

import bowls
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
AP_OTHERS = 15        # teams listed under "also receiving votes" below the top 25
# Conferences that still play divisions: the title game is division winner vs division winner.
DIVISIONS = {
    "Sun Belt": {
        "East": ["app-st", "c-carolina", "ga-southern", "georgia-state", "james-madison", "marshall", "old-dominion"],
        "West": ["arkansas-state", "louisiana", "louisiana-tech", "south-alabama", "southern-miss", "troy", "ul-monroe"],
    },
}
# Title games played at the higher seed's stadium rather than a neutral site.
HOSTED_CCG = {"Sun Belt", "Mountain West", "American Athletic Conference", "Conference USA"}
PLAYOFF_WEEKS = {16: "First round", 17: "Quarterfinals", 18: "Semifinals", 19: "National championship"}
BOWL_WEEK_LABELS = {16: "First round & bowls", 17: "Quarterfinals & bowls", 18: "Semifinals & New Year bowls", 19: "National championship"}
CFP_WEEKS = {9, 10, 11, 12, 13, 14}   # committee rankings released after these weeks (Nov 3 ... Dec 6, 2026)
# Calendar of the postseason weeks (regular-season weeks take their dates from the schedule).
POSTSEASON_DATES = {CCG_WEEK: ("2026-12-04", "2026-12-05"), SELECTION_WEEK: ("2026-12-06", "2026-12-12"),
                    16: ("2026-12-15", "2026-12-24"), 17: ("2026-12-26", "2027-01-01"), 18: ("2027-01-02", "2027-01-15"),
                    19: ("2027-01-25", "2027-01-25")}

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


TEAM_REGION = {slug: region for region, slug in REGION_TEAM.items()}


def fcs_label(slug: str) -> str:
    """How a fictional FCS stand-in is shown on a schedule: 'FCS Southeast', never the
    real school it replaces."""
    region = TEAM_REGION.get(slug)
    return f"FCS {region}" if region else "FCS"


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
               "home_display": teams[home]["name"] if g["home_slug"] else fcs_label(home),
               "away_display": teams[away]["name"] if g["away_slug"] else fcs_label(away),
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
        "games": games, "polls": {}, "scores": {}, "champions": {}, "runners_up": {}, "bracket": None, "playoff": {}, "my_boxes": {},
        "rng_state": rng.randrange(1 << 30),
    }
    real = _real_polls_2026(teams) if mode == "remaining" else {}
    preseason = real.get(0) or _real_polls_2026(teams).get(0) or _rating_poll(teams)
    ap_params, _ = polls.load_params()
    ratings = {slug: t["team_ratings"]["overall"] for slug, t in teams.items() if not t["fictional"]}
    state["scores"] = polls.preseason_scores(preseason[:25], ratings, ap_params)
    tiers = {slug: tier_of(t) for slug, t in teams.items()}
    pre_full = polls.rank(state["scores"], {}, tiers, ap_params, n=25 + AP_OTHERS)
    pre_others = [t for t in pre_full if t not in set(preseason[:25])][:AP_OTHERS]
    state["polls"]["0"] = {"ap": _poll_entries(preseason[:25], {}, state, teams),
                           "ap_others": _poll_entries(pre_others, {}, state, teams, start=26)}
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
            out.setdefault(g[side], []).append({"opp": g[opp], "won": g[f"{side}_score"] > g[f"{opp}_score"], "week": g["week"],
                                                "kind": g["kind"], "conference_game": g["conference_game"]})
    return out


def division_of(conference: str, slug: str) -> Optional[str]:
    for name, members in DIVISIONS.get(conference, {}).items():
        if slug in members:
            return name
    return None


TIEBREAK_STEPS = ["head-to-head", "record against common opponents", "record against the highest-placed common opponent",
                  "conference strength of schedule", "latest ranking", "point margin"]


def _ranking_positions(state: dict) -> dict[str, int]:
    """Position of every team in the most recent ranking: the committee's full order when
    it exists, else the AP poll (top 25 plus others receiving votes)."""
    for w in sorted((int(k) for k in state["polls"]), reverse=True):
        p = state["polls"][str(w)]
        order = p.get("cfp_full") or [e["team"] for e in p.get("cfp", [])] or \
            [e["team"] for e in p.get("ap", [])] + [e["team"] for e in p.get("ap_others", [])]
        if order:
            return {t: i for i, t in enumerate(order)}
    return {}


def _pct(wins: int, games: int) -> float:
    return wins / games if games else 0.0


def _order_rows(rows: list[dict], conf_rows: list[dict], opp: dict, rank_pos: dict[str, int]) -> list[dict]:
    """Order a conference (or division) table the way the conferences do it.

    Teams sort by conference winning percentage. Tied teams go through the ladder the
    Power Four and most Group of Five conferences use for seeding the title game:
      1. head-to-head among the tied teams (combined record when more than two are tied);
      2. record against the conference opponents common to all tied teams;
      3. record against the highest-placed common opponent, then the next one down;
      4. conference strength of schedule (conference winning percentage of each team's
         conference opponents);
      5. the latest ranking (the committee's, else the AP poll), which the SEC, Big Ten and
         ACC use directly and the Big 12 approximates with an analytics ranking;
      6. point margin, standing in for the conferences' draw.
    When a step separates some of the tied teams from the rest, each smaller group restarts
    at step 1, as the written procedures do once a tie is reduced. Rows that needed the
    ladder get `tiebreak`, the step that placed them.
    """
    conf_slugs = {r["slug"] for r in conf_rows}
    by_slug = {r["slug"]: r for r in conf_rows}
    conf_games = {sl: [o for o in opp.get(sl, []) if o["opp"] in conf_slugs and o.get("kind", "regular") == "regular"
                       and o.get("conference_game", True)] for sl in by_slug}
    provisional = sorted(conf_rows, key=lambda r: (-_pct(r["conf_wins"], r["conf_wins"] + r["conf_losses"]),
                                                   -_pct(r["wins"], r["wins"] + r["losses"]), -(r["points_for"] - r["points_against"])))
    place = {r["slug"]: i for i, r in enumerate(provisional)}

    def vs(team: str, opponents: set) -> tuple[int, int]:
        gs = [o for o in conf_games[team] if o["opp"] in opponents]
        return sum(1 for o in gs if o["won"]), len(gs)

    def metric(step: int, group: list[dict]) -> Optional[dict[str, float]]:
        slugs = {r["slug"] for r in group}
        if step == 0:
            vals = {}
            for sl in slugs:
                w, g = vs(sl, slugs - {sl})
                if g == 0:
                    return None
                vals[sl] = w / g
            return vals
        if step in (1, 2):
            common = set.intersection(*[{o["opp"] for o in conf_games[sl]} for sl in slugs]) - slugs
            if not common:
                return None
            if step == 1:
                return {sl: _pct(*vs(sl, common)) for sl in slugs}
            for c in sorted(common, key=lambda sl: place[sl]):
                vals = {sl: _pct(*vs(sl, {c})) for sl in slugs}
                if len(set(vals.values())) > 1:
                    return vals
            return None
        if step == 3:
            vals = {}
            for sl in slugs:
                gs = conf_games[sl]
                if not gs:
                    return None
                vals[sl] = sum(_pct(by_slug[o["opp"]]["conf_wins"], by_slug[o["opp"]]["conf_wins"] + by_slug[o["opp"]]["conf_losses"])
                               for o in gs) / len(gs)
            return vals
        if step == 4:
            return {sl: -rank_pos.get(sl, 10_000) for sl in slugs}
        return {sl: by_slug[sl]["points_for"] - by_slug[sl]["points_against"] for sl in slugs}

    def resolve(group: list[dict]) -> list[dict]:
        if len(group) <= 1:
            return list(group)
        for step in range(len(TIEBREAK_STEPS)):
            vals = metric(step, group)
            if vals is None:
                continue
            best = max(vals.values())
            top = [r for r in group if vals[r["slug"]] == best]
            if len(top) == len(group):
                continue
            rest = [r for r in group if vals[r["slug"]] != best]
            for r in group:
                r.setdefault("tiebreak", TIEBREAK_STEPS[step])
            return resolve(top) + resolve(rest)
        return list(group)

    for r in rows:
        r.pop("tiebreak", None)
    groups: dict[float, list[dict]] = {}
    for r in rows:
        groups.setdefault(_pct(r["conf_wins"], r["conf_wins"] + r["conf_losses"]), []).append(r)
    ordered: list[dict] = []
    for pct in sorted(groups, reverse=True):
        ordered.extend(resolve(groups[pct]))
    return ordered


def standings(state: dict) -> dict[str, list[dict]]:
    """Conference tables. Rows carry `division` (None where the conference has none),
    `conf_rank` (counted within the division when there is one), `champion` and
    `runner_up` once the title game is played, and `tiebreak` when the ladder placed them."""
    teams = load_teams()
    rec = _records(state)
    opp = _opponents(state)
    rank_pos = _ranking_positions(state)
    table: dict[str, list[dict]] = {}
    for slug, t in teams.items():
        if t["fictional"]:
            continue
        r = {"slug": slug, "name": t["name"], "division": division_of(t["conference"], slug), **rec[slug]}
        table.setdefault(t["conference"], []).append(r)

    for conf, rows in table.items():
        if conf in DIVISIONS:
            ordered = []
            for div in DIVISIONS[conf]:
                group = _order_rows([r for r in rows if r["division"] == div], rows, opp, rank_pos)
                for i, r in enumerate(group, 1):
                    r["conf_rank"] = i
                ordered.extend(group)
            rows[:] = ordered
        else:
            rows[:] = _order_rows(rows, rows, opp, rank_pos)
            for i, r in enumerate(rows, 1):
                r["conf_rank"] = i
        champ = state["champions"].get(conf)
        second = state.get("runners_up", {}).get(conf)
        for r in rows:
            r["champion"] = bool(champ) and r["slug"] == champ
            r["runner_up"] = bool(second) and r["slug"] == second
            if conf in polls.INDEPENDENT:
                r.pop("tiebreak", None)   # independents have no conference table to break
    return table


def _poll_entries(order: list[str], prev_rank: dict[str, int], state: dict, teams: dict, week: Optional[int] = None,
                  start: int = 1) -> list[dict]:
    rec = _records(state, week)
    out = []
    for i, slug in enumerate(order, start):
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
    full = polls.rank(state["scores"], rec_t, tiers, ap_params, n=25 + AP_OTHERS)
    order = real_ap[:25] if real_ap else full[:25]
    others = [t for t in full if t not in set(order)][:AP_OTHERS]
    entry = {"ap": _poll_entries(order, prev_rank, state, teams, week),
             "ap_others": _poll_entries(others, prev_rank, state, teams, week, start=26)}
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
    # workers ignore Ctrl-C; the server stops them on shutdown (keeps tracebacks out of the console)
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    _TEAMS = json.loads(Path(path).read_text(encoding="utf-8"))["teams"]


def _sim_one(args: tuple) -> dict:
    from engine.game import simulate_game
    event_id, home, away, neutral, seed, keep_full = args
    r = simulate_game(_TEAMS[home], _TEAMS[away], None, seed, venue="neutral" if neutral else "home")
    out = {"event_id": event_id, "home_score": r["home"]["score"], "away_score": r["away"]["score"], "overtime": r["overtime_periods"],
           "stats": {"home": _compact_side(r["home"], r["drives"], "home"), "away": _compact_side(r["away"], r["drives"], "away")}}
    if keep_full:
        r["home_slug"], r["away_slug"] = home, away
        out["game"] = r
    return out


def sim_workers() -> int:
    """How many processes simulate games: SIM_WORKERS if set (1 means in-process, which
    is right for a small host like Render's free tier), else the machine's cores, capped."""
    try:
        n = int(os.environ.get("SIM_WORKERS", "0"))
    except ValueError:
        n = 0
    return n if n > 0 else max(1, min(os.cpu_count() or 1, 8))


def _make_pool() -> Optional[Pool]:
    """A worker pool, or None to simulate in this process."""
    n = sim_workers()
    if n <= 1:
        _init(str(TEAMS_FILE))
        return None
    return Pool(processes=n, initializer=_init, initargs=(str(TEAMS_FILE),))


Reporter = Callable[[str, Optional[int], Optional[int]], None]   # (stage text, games done, games total)


def _run_games(state: dict, game_ids: list[str], pool: Optional[Pool] = None, report: Optional[Reporter] = None,
               stage: str = "Simulating") -> None:
    rng = random.Random(state["rng_state"])
    jobs = []
    for eid in game_ids:
        g = state["games"][eid]
        keep = state["team"] in (g["home"], g["away"])
        jobs.append((eid, g["home"], g["away"], g["neutral"], rng.randrange(1 << 30), keep))
    state["rng_state"] = rng.randrange(1 << 30)
    if not jobs:
        return
    if report:
        report(stage, 0, len(jobs))

    def take(r: dict, n: int) -> None:
        g = state["games"][r["event_id"]]
        g.update(played=True, home_score=r["home_score"], away_score=r["away_score"], overtime=r["overtime"])
        if "stats" in r:
            _accumulate_stats(state, g, r["stats"])
        if "game" in r:
            state["my_boxes"][r["event_id"]] = r["game"]
        if report:
            report(stage, n, len(jobs))

    if pool is not None:
        for n, r in enumerate(pool.imap_unordered(_sim_one, jobs, chunksize=2), 1):
            take(r, n)
    elif sim_workers() <= 1:
        if not _TEAMS:
            _init(str(TEAMS_FILE))
        for n, job in enumerate(jobs, 1):
            take(_sim_one(job), n)
    else:
        with _make_pool() as p:
            for n, r in enumerate(p.imap_unordered(_sim_one, jobs, chunksize=2), 1):
                take(r, n)


def _ccg_matchups(state: dict, teams: dict) -> list[dict]:
    table = standings(state)
    out = []
    for conf, rows in table.items():
        if conf in polls.INDEPENDENT or len(rows) < 4:
            continue
        if conf in DIVISIONS:
            # division winners; the better record (conference, then overall, then margin) is the higher seed
            winners = [next(r for r in rows if r["division"] == div and r["conf_rank"] == 1) for div in DIVISIONS[conf]]
            winners.sort(key=lambda r: (-(r["conf_wins"] / max(1, r["conf_wins"] + r["conf_losses"])),
                                        -(r["wins"] / max(1, r["wins"] + r["losses"])), -(r["points_for"] - r["points_against"])))
            a, b = winners[0], winners[1]
        else:
            a, b = rows[0], rows[1]
        hosted = conf in HOSTED_CCG
        site = f"{teams[a['slug']]['stadium']['name']}, {a['name']}" if hosted else None
        out.append({"event_id": f"ccg-{conf.lower().replace(' ', '-')}", "week": CCG_WEEK, "date": None, "neutral": not hosted,
                    "home": a["slug"], "away": b["slug"], "home_display": a["name"], "away_display": b["name"],
                    "conference_game": False, "played": False, "home_score": None, "away_score": None, "overtime": 0,
                    "real": False, "kind": "ccg", "conference": conf, "title": f"{conf} Championship", "site": site,
                    "divisions": [a.get("division"), b.get("division")] if conf in DIVISIONS else None})
    return out


def _playoff_round(state: dict, week: int, teams: dict) -> list[dict]:
    """Create the games of a playoff round from the bracket and earlier rounds."""
    br = state["bracket"]
    seeds = {s["seed"]: s["team"] for s in br["seeds"]}
    games = []
    conf_of = {slug: t["conference"] for slug, t in teams.items()}
    sites = state.get("playoff_sites")
    if sites is None:
        sites = state["playoff_sites"] = bowls.playoff_sites(seeds, conf_of)

    def mk(eid, home, away, neutral, title, home_seed, away_seed, site_key=None):
        site = sites.get(site_key) if site_key else None
        bowl_name = site["bowl"] if site else None
        return {"event_id": eid, "week": week, "date": (site or {}).get("date"), "neutral": neutral, "home": home, "away": away,
                "home_display": f"({home_seed}) {teams[home]['name']}", "away_display": f"({away_seed}) {teams[away]['name']}",
                "conference_game": False, "played": False, "home_score": None, "away_score": None, "overtime": 0,
                "real": False, "kind": "playoff",
                "title": bowl_name if bowl_name and "Championship" in bowl_name else (f"{bowl_name} ({title.split(':')[0]})" if bowl_name else title),
                "bowl": bowl_name, "site": (site or {}).get("site") or (f"{teams[home]['stadium']['name']}, {teams[home]['name']}" if not neutral else None),
                "home_seed": home_seed, "away_seed": away_seed}

    def winner(eid):
        g = state["games"][eid]
        return (g["home"], g["home_seed"]) if g["home_score"] > g["away_score"] else (g["away"], g["away_seed"])

    if week == 16:
        for hs, as_ in ((5, 12), (6, 11), (7, 10), (8, 9)):
            games.append(mk(f"cfp-r1-{hs}", seeds[hs], seeds[as_], False, f"First round: {hs} vs {as_}", hs, as_))
    elif week == 17:
        for top, eid, label in ((1, "cfp-r1-8", "1 vs 8/9"), (2, "cfp-r1-7", "2 vs 7/10"), (3, "cfp-r1-6", "3 vs 6/11"), (4, "cfp-r1-5", "4 vs 5/12")):
            w, ws = winner(eid)
            games.append(mk(f"cfp-qf-{top}", seeds[top], w, True, f"Quarterfinal: {label}", top, ws, site_key=f"qf-{top}"))
    elif week == 18:
        (a, a_s), (b, b_s) = winner("cfp-qf-1"), winner("cfp-qf-4")
        games.append(mk("cfp-sf-1", a, b, True, "Semifinal", a_s, b_s, site_key="sf-1"))
        (c, c_s), (d, d_s) = winner("cfp-qf-2"), winner("cfp-qf-3")
        games.append(mk("cfp-sf-2", c, d, True, "Semifinal", c_s, d_s, site_key="sf-2"))
    elif week == 19:
        (a, a_s), (b, b_s) = winner("cfp-sf-1"), winner("cfp-sf-2")
        games.append(mk("cfp-final", a, b, True, "National championship", a_s, b_s, site_key="final"))
    return games


def _bowl_games(state: dict, teams: dict) -> list[dict]:
    """Bowl matchups for the whole bowl season, placed in weeks 16-18 by date."""
    rec = _records(state)
    field = {x["team"] for x in (state.get("bracket") or {}).get("seeds", [])}
    final = state["polls"].get(str(CCG_WEEK), {}).get("cfp_full") or []
    ratings = {slug: t["team_ratings"]["overall"] for slug, t in teams.items()}
    out = []
    state["bowls"] = []
    for i, b in enumerate(bowls.select_bowls(rec, teams, field, final, ratings)):
        eid = f"bowl-{i}-{b['bowl'].lower().replace(' ', '-').replace(chr(39), '')}"
        entry = {**b, "event_id": eid}
        state["bowls"].append(entry)
        if b["unfilled"]:
            continue
        out.append({"event_id": eid, "week": b["week"], "date": b["date"], "neutral": True, "home": b["home"], "away": b["away"],
                    "home_display": teams[b["home"]]["name"], "away_display": teams[b["away"]]["name"], "conference_game": False,
                    "played": False, "home_score": None, "away_score": None, "overtime": 0, "real": False, "kind": "bowl",
                    "title": b["name"], "bowl": b["bowl"], "site": b["site"]})
    return out


def week_label(week: int) -> str:
    if week == CCG_WEEK:
        return "Championship week"
    if week == SELECTION_WEEK:
        return "Selection week"
    return BOWL_WEEK_LABELS.get(week) or f"Week {week}"


def advance(state: dict, pool: Optional[Pool] = None, report: Optional[Reporter] = None) -> dict:
    """Play the next week. Returns the state. `report(stage, games_done, games_total)` is
    called as the week goes, for a live progress display."""
    if state["done"]:
        return state

    def say(stage: str) -> None:
        if report:
            report(stage, None, None)

    teams = load_teams()
    week = state["current_week"] + 1
    label = week_label(week)
    if week == CCG_WEEK:
        say("Setting the conference title games")
        for g in _ccg_matchups(state, teams):
            state["games"][g["event_id"]] = g
    if week in PLAYOFF_WEEKS:
        say(f"Setting the {PLAYOFF_WEEKS[week].lower()} matchups")
        for g in _playoff_round(state, week, teams):
            state["games"][g["event_id"]] = g
    if week == 16:
        say("Selecting the bowls")
        for g in _bowl_games(state, teams):
            state["games"][g["event_id"]] = g
    ids = [eid for eid, g in state["games"].items() if g["week"] == week and not g["played"]]
    _run_games(state, ids, pool, report, stage=f"Simming {label}")

    if week == CCG_WEEK:
        for g in state["games"].values():
            if g["kind"] == "ccg":
                won_home = g["home_score"] > g["away_score"]
                state["champions"][g["conference"]] = g["home"] if won_home else g["away"]
                state.setdefault("runners_up", {})[g["conference"]] = g["away"] if won_home else g["home"]
    if week <= CCG_WEEK:
        say("Updating the AP poll and CFP rankings" if week in CFP_WEEKS else "Updating the AP poll")
        _update_polls_after_week(state, teams, week)
    if week == CCG_WEEK:
        say("Building the playoff bracket")
        final = state["polls"][str(week)].get("cfp_full") or [e["team"] for e in state["polls"][str(week)]["cfp"]]
        conf_of = {slug: t["conference"] for slug, t in teams.items()}
        names = {slug: t["name"] for slug, t in teams.items()}
        state["bracket"] = polls.build_bracket(final, state["champions"], conf_of, names)
        state["phase"] = "playoff"
    if week in PLAYOFF_WEEKS:
        state["playoff"][PLAYOFF_WEEKS[week]] = [eid for eid, g in state["games"].items() if g["week"] == week and g["kind"] == "playoff"]
        if week == 19:
            g = state["games"]["cfp-final"]
            state["champion"] = g["home"] if g["home_score"] > g["away_score"] else g["away"]
            state["done"] = True
            state["phase"] = "done"
    state["current_week"] = week
    return state


_SHARED_POOL: Optional[Pool] = None


def shared_pool() -> Optional[Pool]:
    """One worker pool for the life of the process: spawning the workers and loading the
    league into each costs a few seconds, which should not be paid on every click."""
    global _SHARED_POOL
    if _SHARED_POOL is None:
        _SHARED_POOL = _make_pool()
    return _SHARED_POOL


def close_pool() -> None:
    """Stop the workers (called when the server shuts down, so Ctrl-C exits at once)."""
    global _SHARED_POOL
    if _SHARED_POOL is not None:
        _SHARED_POOL.terminate()
        _SHARED_POOL.join()
        _SHARED_POOL = None


def advance_to(state: dict, target_week: int, progress: Optional[Callable[[int, int], None]] = None,
               report: Optional[Reporter] = None) -> dict:
    target = min(target_week, 19)
    pool = shared_pool()
    while state["current_week"] < target and not state["done"]:
        advance(state, pool, report)
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
    if not path.exists():
        return None
    state = json.loads(path.read_text(encoding="utf-8"))
    # seasons saved before the FCS stand-ins were anonymised still carry "Duquesne (as ...)"
    for g in state["games"].values():
        for side in ("home", "away"):
            if " (as " in (g.get(f"{side}_display") or ""):
                g[f"{side}_display"] = fcs_label(g[side])
    return state


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
    out.sort(key=lambda g: (not g["mine"], {"playoff": 0, "bowl": 1}.get(g["kind"], 2), g["date"] or "", g["event_id"]))
    return out


# ----- season stats --------------------------------------------------------
# Full box scores are kept only for your own games; for every game the workers send
# back a compact per-team line (team totals, situational counts, plays, possession and
# each player's stat line) which is summed into state["season_stats"] as the season goes.

PLAYER_CATEGORIES = {
    "passing": ("pass_attempts", ["completions", "pass_attempts", "pass_yards", "passing_touchdowns", "interceptions_thrown", "sacks_taken"], "pass_yards"),
    "rushing": ("carries", ["carries", "rush_yards", "rushing_touchdowns", "fumbles"], "rush_yards"),
    "receiving": ("receptions", ["targets", "receptions", "receiving_yards", "receiving_touchdowns"], "receiving_yards"),
    "defense": ("solo_tackles", ["solo_tackles", "assisted_tackles", "sacks", "interceptions", "interception_return_yards", "forced_fumbles", "fumble_recoveries", "defensive_touchdowns"], "solo_tackles"),
    "kicking": ("fg_attempted", ["fg_made", "fg_attempted", "pat_made", "pat_attempts"], "fg_made"),
    "punting": ("punts", ["punts", "punt_yards"], "punts"),
    "returns": ("kickoff_returns", ["kickoff_returns", "kickoff_return_yards", "kickoff_return_touchdowns", "punt_returns", "punt_return_yards", "punt_return_touchdowns"], "kickoff_return_yards"),
}


def _compact_side(side: dict, drives: list[dict], which: str) -> dict:
    own = [d for d in drives if d["offense"] == which and d["quarter"] <= 4]
    return {"score": side["score"], "team": side["team_stats"], "events": side.get("team_events") or {},
            "plays": sum(d["plays"] for d in own), "top": sum(d["seconds"] for d in own),
            "players": [{"name": p["name"], "position": p["position"], "unit": p["unit"], "stats": {k: v for k, v in p["stats"].items() if v}}
                        for p in side["players"] if any(p["stats"].values())]}


def _add_into(total: dict, add: dict) -> None:
    for k, v in add.items():
        if isinstance(v, (int, float)):
            total[k] = total.get(k, 0) + v


def _accumulate_stats(state: dict, g: dict, lines: dict) -> None:
    ss = state.setdefault("season_stats", {})
    for side, opp in (("home", "away"), ("away", "home")):
        mine, theirs = lines[side], lines[opp]
        t = ss.setdefault(g[side], {"games": 0, "wins": 0, "points": 0, "opp_points": 0, "plays": 0, "top": 0, "opp_plays": 0,
                                    "team": {}, "events": {}, "opp": {}, "opp_events": {}, "players": {}})
        t["games"] += 1
        t["wins"] += 1 if mine["score"] > theirs["score"] else 0
        t["points"] += mine["score"]
        t["opp_points"] += theirs["score"]
        t["plays"] += mine["plays"]
        t["top"] += mine["top"]
        t["opp_plays"] += theirs["plays"]
        _add_into(t["team"], mine["team"])
        _add_into(t["events"], mine["events"])
        _add_into(t["opp"], theirs["team"])
        _add_into(t["opp_events"], theirs["events"])
        for p in mine["players"]:
            key = f"{p['name']}|{p['position']}"
            rec = t["players"].setdefault(key, {"name": p["name"], "position": p["position"], "unit": p["unit"], "games": 0, "stats": {}})
            rec["games"] += 1
            _add_into(rec["stats"], p["stats"])


def _season_stats(state: dict) -> dict:
    """The accumulated stats; a season saved before this existed is rebuilt from the box
    scores it kept (your own games only)."""
    if "season_stats" in state:
        return state["season_stats"]
    tmp = {"season_stats": {}}
    for eid, box in state["my_boxes"].items():
        g = state["games"].get(eid)
        if not g:
            continue
        lines = {"home": _compact_side(box["home"], box["drives"], "home"), "away": _compact_side(box["away"], box["drives"], "away")}
        _accumulate_stats(tmp, g, lines)
    state["season_stats"] = tmp["season_stats"]
    state["season_stats_partial"] = True
    return state["season_stats"]


def team_stats_view(state: dict) -> dict:
    """Per-game team numbers for every team that has played a simulated game."""
    teams = load_teams()
    ss = _season_stats(state)
    rows = []
    for slug, t in ss.items():
        info = teams.get(slug)
        if not info:
            continue
        g = t["games"] or 1
        s, o, e, oe = t["team"], t["opp"], t["events"], t["opp_events"]
        yards = s.get("Pass Yards", 0) + s.get("Rush Yards", 0)
        opp_yards = o.get("Pass Yards", 0) + o.get("Rush Yards", 0)
        lost = e.get("fumbles_lost", s.get("Fumbles", 0))
        opp_lost = oe.get("fumbles_lost", o.get("Fumbles", 0))
        rows.append({
            "team": slug, "name": info["name"], "conference": info["conference"], "fictional": info["fictional"],
            "games": t["games"], "wins": t["wins"], "losses": t["games"] - t["wins"],
            "ppg": t["points"] / g, "opp_ppg": t["opp_points"] / g, "margin": (t["points"] - t["opp_points"]) / g,
            "ypg": yards / g, "pass_ypg": s.get("Pass Yards", 0) / g, "rush_ypg": s.get("Rush Yards", 0) / g,
            "ypp": yards / t["plays"] if t["plays"] else 0, "plays_pg": t["plays"] / g,
            "ypc": s.get("Rush Yards", 0) / s["Carries"] if s.get("Carries") else 0,
            "ypa": s.get("Pass Yards", 0) / s["Pass Attempts"] if s.get("Pass Attempts") else 0,
            "comp_pct": 100 * s.get("Completions", 0) / s["Pass Attempts"] if s.get("Pass Attempts") else 0,
            "third_pct": 100 * e.get("third_down_conversions", 0) / e["third_downs"] if e.get("third_downs") else 0,
            "red_zone_pct": 100 * e.get("red_zone_scores", 0) / e["red_zone_trips"] if e.get("red_zone_trips") else 0,
            "first_downs_pg": e.get("first_downs", 0) / g, "top": t["top"] / g,
            "turnovers": s.get("Interceptions Thrown", 0) + lost, "takeaways": s.get("Interceptions", 0) + s.get("Fumble Recoveries", 0),
            "sacks": s.get("Sacks", 0), "sacks_allowed": s.get("Sacks Taken", 0), "penalties_pg": e.get("penalties", 0) / g,
            "penalty_ypg": e.get("penalty_yards", 0) / g,
            "opp_ypg": opp_yards / g, "opp_pass_ypg": o.get("Pass Yards", 0) / g, "opp_rush_ypg": o.get("Rush Yards", 0) / g,
            "opp_ypp": opp_yards / t["opp_plays"] if t["opp_plays"] else 0,
            "opp_third_pct": 100 * oe.get("third_down_conversions", 0) / oe["third_downs"] if oe.get("third_downs") else 0,
            "opp_turnovers": o.get("Interceptions Thrown", 0) + opp_lost,
        })
    rows.sort(key=lambda r: (-r["margin"], r["name"]))
    return {"teams": rows, "partial": bool(state.get("season_stats_partial"))}


def player_stats_view(state: dict, team: Optional[str] = None, category: str = "passing", limit: int = 100) -> dict:
    teams = load_teams()
    ss = _season_stats(state)
    if category not in PLAYER_CATEGORIES:
        raise ValueError(f"unknown category {category}")
    gate, keys, sort_key = PLAYER_CATEGORIES[category]
    out = []
    for slug, t in ss.items():
        if team and slug != team:
            continue
        info = teams.get(slug)
        if not info or (info["fictional"] and not team):
            continue
        for p in t["players"].values():
            st = p["stats"]
            if not st.get(gate) and not (category == "defense" and any(st.get(k) for k in keys)) \
                    and not (category == "returns" and st.get("punt_returns")) and not (category == "kicking" and st.get("pat_attempts")):
                continue
            out.append({"name": p["name"], "position": p["position"], "team": slug, "team_name": info["name"], "games": p["games"],
                        "team_games": t["games"], "stats": {k: st.get(k, 0) for k in keys}})
    out.sort(key=lambda p: (-p["stats"].get(sort_key, 0), p["name"]))
    if not team:
        out = out[:limit]
    return {"category": category, "team": team, "players": out, "partial": bool(state.get("season_stats_partial"))}


def week_dates(state: dict) -> dict[int, dict]:
    """{week: {"start", "end", "main"}} as ISO dates in US time. Regular-season weeks span
    their first and last game, with the Saturday (the busiest day) as the main date; the
    postseason weeks follow the 2026-27 calendar. Week 0 is the preseason."""
    by_week: dict[int, list[str]] = {}
    for g in state["games"].values():
        d = g.get("date") or ""
        if len(d) >= 10 and d[4] == "-":
            try:
                local = datetime.fromisoformat(d.replace("Z", "+00:00")) - timedelta(hours=6)
            except ValueError:
                continue
            by_week.setdefault(g["week"], []).append(local.strftime("%Y-%m-%d"))
    out: dict[int, dict] = {}
    for w in sorted(set(by_week) | set(POSTSEASON_DATES)):
        if w in POSTSEASON_DATES:
            start, end = POSTSEASON_DATES[w]
            out[w] = {"start": start, "end": end, "main": end}
        else:
            ds = sorted(by_week[w])
            saturdays = [d for d in ds if datetime.fromisoformat(d).weekday() == 5]
            out[w] = {"start": ds[0], "end": ds[-1], "main": saturdays[0] if saturdays else max(set(ds), key=ds.count)}
    first = out.get(1, {}).get("start")
    if first:
        eve = (datetime.fromisoformat(first) - timedelta(days=1)).strftime("%Y-%m-%d")
        out[0] = {"start": None, "end": eve, "main": eve}
    return out


def summary(state: dict) -> dict:
    teams = load_teams()
    rec = _records(state)[state["team"]]
    my_games = sorted((g for g in state["games"].values() if state["team"] in (g["home"], g["away"])),
                      key=lambda g: (g["week"], g["date"] or ""))
    schedule = []
    ap_cache: dict[int, dict[str, int]] = {}

    def ap_before(week: int) -> dict[str, int]:
        if week not in ap_cache:
            ap_cache[week] = {e["team"]: e["rank"] for e in state["polls"].get(str(week - 1), {}).get("ap", [])}
        return ap_cache[week]

    for g in my_games:
        home = g["home"] == state["team"]
        opp = g["away"] if home else g["home"]
        ap = ap_before(g["week"])
        schedule.append({"event_id": g["event_id"], "week": g["week"], "kind": g["kind"], "title": g.get("title"), "site": g.get("site"),
                         "opponent": opp, "opponent_name": g["away_display"] if home else g["home_display"],
                         "opponent_rank": ap.get(opp), "my_rank": ap.get(state["team"]),
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
                        SELECTION_WEEK: "Selection", **BOWL_WEEK_LABELS},
        "polls": state["polls"], "champions": state["champions"], "bracket": state["bracket"], "playoff": state["playoff"],
        "cfp_weeks": sorted(CFP_WEEKS), "bowls": bowl_view(state), "playoff_sites": state.get("playoff_sites"),
        "week_dates": week_dates(state),
    }


def bowl_view(state: dict) -> list[dict]:
    """Every bowl of the season with its matchup, result, tie-ins and history."""
    teams = load_teams()
    info = {b["bowl"]: b for b in bowls.load_bowls()["bowls"]}
    out = []
    for b in state.get("bowls", []):
        g = state["games"].get(b["event_id"])
        meta = info.get(b["bowl"], {})
        out.append({**b, "home_name": teams[b["home"]]["name"] if b.get("home") else None,
                    "away_name": teams[b["away"]]["name"] if b.get("away") else None,
                    "played": bool(g and g["played"]), "home_score": g["home_score"] if g else None, "away_score": g["away_score"] if g else None,
                    "mine": state["team"] in (b.get("home"), b.get("away")), "has_box": b["event_id"] in state["my_boxes"],
                    "games_played": meta.get("games_played"), "first_played": meta.get("first_played"),
                    "most_appearances": meta.get("most_appearances", [])[:4], "recent": meta.get("recent", [])[:3],
                    "wiki_tie_ins": meta.get("tie_ins", []), "previous_tie_ins": meta.get("previous_tie_ins", []),
                    "payout": meta.get("payout")})
    out.sort(key=lambda b: (b["week"], b["date"] or "", b["time"] or ""))
    return out


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


# ----- season summary ------------------------------------------------------

def _game_line(g: dict, teams: dict) -> dict:
    return {"event_id": g["event_id"], "week": g["week"], "title": g.get("title"), "site": g.get("site"), "played": g["played"],
            "home": g["home"], "away": g["away"], "home_name": g.get("home_display") or teams[g["home"]]["name"],
            "away_name": g.get("away_display") or teams[g["away"]]["name"], "home_score": g["home_score"], "away_score": g["away_score"],
            "overtime": g.get("overtime", 0), "winner": (g["home"] if g["home_score"] > g["away_score"] else g["away"]) if g["played"] else None}


def _player_leaders(boxes: list[dict], me: str) -> dict:
    """Season totals for your players from the stored box scores, and the leader in each category."""
    totals: dict[tuple[str, str], dict] = {}
    for box in boxes:
        side = box["home"] if box.get("home_slug") == me else box["away"]
        for p in side["players"]:
            if not any(p["stats"].values()):
                continue
            t = totals.setdefault((p["name"], p["position"]), {"name": p["name"], "position": p["position"], "games": 0, "stats": {}})
            t["games"] += 1
            for k, v in p["stats"].items():
                t["stats"][k] = t["stats"].get(k, 0) + v
    players = list(totals.values())

    def top(key, *needs):
        pool = [p for p in players if all(p["stats"].get(n) for n in needs)]
        best = max(pool, key=lambda p: p["stats"].get(key, 0), default=None)
        return best if best and best["stats"].get(key, 0) > 0 else None

    def tackles(p):
        return p["stats"].get("solo_tackles", 0) + p["stats"].get("assisted_tackles", 0)

    tackler = max(players, key=tackles, default=None)
    returner = max(players, key=lambda p: p["stats"].get("kickoff_return_yards", 0) + p["stats"].get("punt_return_yards", 0), default=None)
    return {
        "passer": top("pass_yards", "pass_attempts"), "rusher": top("rush_yards", "carries"), "receiver": top("receiving_yards", "receptions"),
        "tackler": tackler if tackler and tackles(tackler) else None, "sacks": top("sacks"), "interceptions": top("interceptions"),
        "kicker": top("fg_made", "fg_attempted") or top("pat_made", "pat_attempts"),
        "returner": returner if returner and (returner["stats"].get("kickoff_return_yards", 0) + returner["stats"].get("punt_return_yards", 0)) else None,
        "games_with_stats": len(boxes),
    }


def _national_leaders(state: dict) -> dict:
    """The country's leader in each category from the season-long stats of every
    simulated game (empty when the season only has your own games' box scores)."""
    if state.get("season_stats_partial") or not state.get("season_stats"):
        _season_stats(state)
        if state.get("season_stats_partial"):
            return {}

    def top(category: str, key: str):
        players = player_stats_view(state, None, category, limit=10_000)["players"]
        best = max(players, key=lambda p: p["stats"].get(key, 0), default=None)
        return best if best and best["stats"].get(key, 0) > 0 else None

    out = {"passing": top("passing", "pass_yards"), "rushing": top("rushing", "rush_yards"), "receiving": top("receiving", "receiving_yards"),
           "sacks": top("defense", "sacks"), "interceptions": top("defense", "interceptions")}
    defenders = player_stats_view(state, None, "defense", limit=10_000)["players"]
    for p in defenders:
        p["stats"]["tackles"] = p["stats"].get("solo_tackles", 0) + p["stats"].get("assisted_tackles", 0)
    out["tackles"] = max(defenders, key=lambda p: p["stats"]["tackles"], default=None)
    kickers = player_stats_view(state, None, "kicking", limit=10_000)["players"]
    for p in kickers:
        p["stats"]["points"] = p["stats"].get("fg_made", 0) * 3 + p["stats"].get("pat_made", 0)
    out["kicking"] = max(kickers, key=lambda p: p["stats"]["points"], default=None)
    return {k: v for k, v in out.items() if v}


def _surprises(state: dict, teams: dict, final_ap: list[dict]) -> tuple[list[dict], list[dict]]:
    """Teams whose finish most exceeded (surprise) or fell short of (disappointment) what
    was expected of them. Expectation is the preseason AP rank, or for unranked teams a
    slot below the top 25 by roster rating. The finish is the final AP rank, or for
    unranked teams a slot below the top 25 by record and point differential."""
    records = _records(state)
    fbs = [s for s, t in teams.items() if not t["fictional"]]
    by_rating = sorted(fbs, key=lambda s: -teams[s]["team_ratings"]["overall"])
    rating_rank = {s: i + 1 for i, s in enumerate(by_rating)}
    pre_ap = {e["team"]: e["rank"] for e in state["polls"].get("0", {}).get("ap", [])}
    fin_ap = {e["team"]: e["rank"] for e in final_ap}
    unranked = [s for s in fbs if s not in fin_ap]
    unranked.sort(key=lambda s: (-(records[s]["wins"] / max(1, records[s]["wins"] + records[s]["losses"])),
                                 -(records[s]["points_for"] - records[s]["points_against"])))
    finish_rank = {**fin_ap, **{s: 26 + i for i, s in enumerate(unranked)}}
    pre_unranked = [s for s in by_rating if s not in pre_ap]
    expected_rank = {**pre_ap, **{s: 26 + i for i, s in enumerate(pre_unranked)}}
    # each team's AP path through the season: [(week, rank)] for the weeks it was ranked
    path: dict[str, list[tuple[int, int]]] = {}
    poll_weeks = sorted(int(k) for k in state["polls"])
    for w in poll_weeks:
        if w == 0:
            continue
        for e in state["polls"][str(w)].get("ap", []):
            path.setdefault(e["team"], []).append((w, e["rank"]))
    last_week = poll_weeks[-1] if poll_weeks else 0
    rows = []
    for s in fbs:
        r = records[s]
        if r["wins"] + r["losses"] < 6:
            continue
        # log ratio of (rank + 10): climbing from 99th to 19th outweighs climbing from 138th
        # to 50th, and a preseason #1 that finishes #8 is not a bigger letdown than a
        # preseason #10 that finishes 7-6 and unranked
        swing = math.log((expected_rank[s] + 10) / (finish_rank[s] + 10))
        ranked = path.get(s, [])
        peak = min(ranked, key=lambda wr: (wr[1], wr[0])) if ranked else None
        rows.append({"team": s, "name": teams[s]["name"], "conference": teams[s]["conference"], "record": f"{r['wins']}-{r['losses']}",
                     "preseason_rank": pre_ap.get(s), "rating_rank": rating_rank[s], "expected": expected_rank[s],
                     "final_rank": fin_ap.get(s), "finish": finish_rank[s], "swing": round(swing, 3),
                     "peak_rank": peak[1] if peak else None, "peak_week": peak[0] if peak else None,
                     "first_ranked_week": ranked[0][0] if ranked else None, "last_ranked_week": ranked[-1][0] if ranked else None,
                     "last_week": last_week})
    rows.sort(key=lambda x: -x["swing"])
    return rows[:3], list(reversed(rows[-3:]))


def season_review(state: dict) -> dict:
    """The season's big results (title game, playoff rounds, conference champions, final
    polls) and your team's season in review (record, finish, best win, worst loss, streaks,
    postseason, and your statistical leaders from the box scores)."""
    teams = load_teams()
    me = state["team"]
    games = state["games"]
    last_poll = state["polls"].get(str(max((int(k) for k in state["polls"]), default=0)), {})
    ap = last_poll.get("ap", [])
    cfp = last_poll.get("cfp", [])
    my_ap = next((e["rank"] for e in ap if e["team"] == me), None)
    my_cfp = next((e["rank"] for e in cfp if e["team"] == me), None)

    rounds = []
    for week, label in sorted(PLAYOFF_WEEKS.items()):
        gs = sorted((g for g in games.values() if g["kind"] == "playoff" and g["week"] == week), key=lambda g: g["event_id"])
        if gs:
            rounds.append({"round": label, "week": week, "games": [_game_line(g, teams) for g in gs]})
    final = games.get("cfp-final")
    title_game = _game_line(final, teams) if final else None
    ccgs = {g["event_id"]: g for g in games.values() if g["kind"] == "ccg"}
    champions = []
    for conf, slug in sorted(state["champions"].items()):
        g = ccgs.get(f"ccg-{conf.lower().replace(' ', '-')}")
        champions.append({"conference": conf, "team": slug, "name": teams[slug]["name"], "game": _game_line(g, teams) if g else None})

    rec = _records(state)[me]
    row = next((r for r in standings(state).get(state["conference"], []) if r["slug"] == me), None)
    my_games = sorted((g for g in games.values() if me in (g["home"], g["away"]) and g["played"]), key=lambda g: (g["week"], g["date"] or ""))

    def ap_before(week: int) -> dict[str, int]:
        return {e["team"]: e["rank"] for e in state["polls"].get(str(week - 1), {}).get("ap", [])}

    lines, wins, losses = [], [], []
    streak, best_streak, cur = 0, 0, 0
    for g in my_games:
        home = g["home"] == me
        opp = g["away"] if home else g["home"]
        pf = g["home_score"] if home else g["away_score"]
        pa = g["away_score"] if home else g["home_score"]
        won = pf > pa
        orank = ap_before(g["week"]).get(opp)
        orec = _records(state)[opp] if opp in teams else None
        line = {"event_id": g["event_id"], "week": g["week"], "kind": g["kind"], "title": g.get("title"), "opponent": opp,
                "opponent_name": teams[opp]["name"], "opponent_rank": orank, "opponent_record": f"{orec['wins']}-{orec['losses']}" if orec else None,
                "venue": "neutral" if g["neutral"] else ("home" if home else "away"), "won": won, "points_for": pf, "points_against": pa,
                "margin": pf - pa, "overtime": g.get("overtime", 0), "has_box": g["event_id"] in state["my_boxes"]}
        lines.append(line)
        (wins if won else losses).append(line)
        cur = cur + 1 if won else 0
        best_streak = max(best_streak, cur)

    def opp_quality(line):   # ranked opponents first, then by their record
        return (0 if line["opponent_rank"] else 1, line["opponent_rank"] or 99, -_records(state)[line["opponent"]]["wins"])

    best_win = min(wins, key=opp_quality) if wins else None
    worst_loss = max(losses, key=opp_quality) if losses else None
    biggest_win = max(wins, key=lambda l: l["margin"]) if wins else None
    closest_loss = min(losses, key=lambda l: -l["margin"]) if losses else None
    n = len(my_games) or 1
    postseason = [l for l in lines if l["kind"] in ("ccg", "bowl", "playoff")]
    if state.get("champion") == me:
        finish = "National champion"
    elif any(l["kind"] == "playoff" for l in lines):
        last = [l for l in lines if l["kind"] == "playoff"][-1]
        finish = "Lost the national championship game" if last["event_id"] == "cfp-final" else f"Lost in the {PLAYOFF_WEEKS.get(last['week'], 'playoff').lower()}"
    elif any(l["kind"] == "bowl" for l in lines):
        last = [l for l in lines if l["kind"] == "bowl"][-1]
        finish = f"{'Won' if last['won'] else 'Lost'} the {last['title']}"
    elif state["done"]:
        finish = "No bowl"
    else:
        finish = None
    boxes = [b for b in state["my_boxes"].values()]
    surprises, disappointments = _surprises(state, teams, ap)
    return {
        "done": state["done"], "current_week": state["current_week"],
        "national_leaders": _national_leaders(state), "surprises": surprises, "disappointments": disappointments,
        "champion": state.get("champion"), "champion_name": teams[state["champion"]]["name"] if state.get("champion") else None,
        "title_game": title_game, "rounds": rounds, "champions": champions,
        "final_ap": ap[:10], "final_cfp": cfp[:12], "poll_week": max((int(k) for k in state["polls"]), default=0),
        "mine": {
            "team": me, "name": state["team_name"], "conference": state["conference"], "wins": rec["wins"], "losses": rec["losses"],
            "conf_wins": rec["conf_wins"], "conf_losses": rec["conf_losses"], "conf_rank": row["conf_rank"] if row else None,
            "division": row["division"] if row else None, "conf_champion": state["champions"].get(state["conference"]) == me,
            "final_ap": my_ap, "final_cfp": my_cfp, "finish": finish,
            "points_per_game": round(sum(l["points_for"] for l in lines) / n, 1), "allowed_per_game": round(sum(l["points_against"] for l in lines) / n, 1),
            "best_win": best_win, "worst_loss": worst_loss, "biggest_win": biggest_win, "closest_loss": closest_loss,
            "longest_streak": best_streak, "postseason": postseason, "leaders": _player_leaders(boxes, me),
        },
    }
