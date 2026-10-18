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

import hashlib
import json
import math
import os
import random
import signal
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from multiprocessing import Pool
from pathlib import Path
from typing import Callable, Optional

import awards
import bowls
import polls

ROOT = Path(__file__).resolve().parent
TEAMS_FILE = ROOT / "data" / "engine_teams.json"
SCHEDULES_FILE = ROOT / "data" / "schedules.json"
FCS_MAP_FILE = ROOT / "data" / "fcs_map.json"
HISTORY_POLLS = ROOT / "data" / "history" / "polls.json"
SEASONS_DIR = ROOT / "data" / "seasons"

LAST_REGULAR_WEEK = 14   # Aug 29 through Nov 28, 2026: fourteen Saturdays, so every team has a bye or two
CCG_WEEK = 15            # Dec 4-5
SELECTION_WEEK = 16      # Dec 6 selection, Dec 12 Army-Navy
FINAL_WEEK = 20          # Jan 25, 2027
# Weeks run Tuesday to Monday (Labor Day games belong to that weekend); week 1 starts Aug 25.
SEASON_EPOCH = datetime(2026, 8, 25)


def week_of_date(date_iso: Optional[str]) -> Optional[int]:
    """Calendar week of a game from its UTC kickoff (US evening games land on the next UTC day)."""
    if not date_iso or len(date_iso) < 10:
        return None
    try:
        local = datetime.fromisoformat(date_iso.replace("Z", "+00:00")).replace(tzinfo=None) - timedelta(hours=6)
    except ValueError:
        return None
    return max(1, (local - SEASON_EPOCH).days // 7 + 1)
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
PLAYOFF_WEEKS = {17: "First round", 18: "Quarterfinals", 19: "Semifinals", 20: "National championship"}
BOWL_WEEK_LABELS = {17: "First round & bowls", 18: "Quarterfinals & bowls", 19: "Semifinals & New Year bowls", 20: "National championship"}
CFP_WEEKS = {10, 11, 12, 13, 14, 15}   # committee rankings released after these weeks (Nov 3 ... Dec 6, 2026)
# Calendar of the postseason weeks (regular-season weeks take their dates from the schedule).
POSTSEASON_DATES = {CCG_WEEK: ("2026-12-04", "2026-12-05"), SELECTION_WEEK: ("2026-12-06", "2026-12-12"),
                    17: ("2026-12-15", "2026-12-24"), 18: ("2026-12-26", "2027-01-01"), 19: ("2027-01-02", "2027-01-15"),
                    20: ("2027-01-25", "2027-01-25")}

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


_norms_cache: dict = {}


def load_norms() -> dict:
    """How build_teams normalized the ratings: the engine's neutral value, the spread scale
    and each position group's starter mean per attribute (before normalization). Lets the
    pages show ratings on the EA 0-99 scale and turn edits back into engine values."""
    if not _norms_cache:
        d = json.loads(TEAMS_FILE.read_text(encoding="utf-8"))
        _norms_cache.update(neutral=d.get("neutral", 55), spread=d.get("spread_scale", 1.0) or 1.0,
                            means=d.get("starter_means_before_normalization", {}))
    return _norms_cache


def _norm_mean(p: dict, key: str) -> float:
    n = load_norms()
    k = "returners:return_rating" if key == "return_rating" else f"{p['position']}:{key}"
    return float(n["means"].get(k, n["neutral"]))


def display_rating(p: dict, key: str, value: Optional[float] = None) -> int:
    """An engine attribute (position-relative, neutral 55) back on the EA 0-99 scale."""
    n = load_norms()
    v = p.get(key) if value is None else value
    return int(round(max(1, min(99, _norm_mean(p, key) + (v - n["neutral"]) / n["spread"]))))


def engine_rating(p: dict, key: str, ea: float) -> int:
    """An EA-scale rating turned into the engine's position-relative value."""
    n = load_norms()
    return int(round(max(1, min(99, n["neutral"] + (ea - _norm_mean(p, key)) * n["spread"]))))


def shown_overall(p: dict, base: Optional[dict] = None) -> int:
    """The overall on the card: the EA overall, moved by any god-mode edit's effect on the
    engine's own composite (so an edit shows), else the engine composite."""
    ea = (base or p).get("ea_overall")
    if ea is None:
        return player_overall(p)
    if base is not None and base is not p:
        ea += (player_overall(p) - player_overall(base)) / load_norms()["spread"]
    return int(round(max(1, min(99, ea))))


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
    from teamnames import build_matcher, match
    lookup = build_matcher(teams)
    out = {}
    pre = hist.get("preseason") or []
    if pre:
        out[0] = [match(r["name"] or "", lookup) for r in sorted(pre, key=lambda r: r["rank"])]
    for w, v in hist.get("weeks", {}).items():
        if "ap" in v:
            # ESPN's "week N" poll is released after our week N: ESPN's week 1 spans our weeks 1 and
            # 2 (the Labor Day weekend), so from week 2 on the numbers line up
            out[int(w)] = [match(r["name"] or "", lookup) for r in sorted(v["ap"], key=lambda r: r["rank"])]
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
        week = week_of_date(g["date"]) or SELECTION_WEEK
        if week > LAST_REGULAR_WEEK:
            week = SELECTION_WEEK  # games after championship week (Army-Navy) sit in selection week
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
        "settings": {"god_mode": False, "morale": True},
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
    pre_votes = _ap_votes(state, preseason[:25] + pre_others, tiers, ap_params, 0)
    state["polls"]["0"] = {"ap": _poll_entries(preseason[:25], {}, state, teams, votes=pre_votes),
                           "ap_others": _poll_entries(pre_others, {}, state, teams, start=26, votes=pre_votes)}
    state["polls"]["0"].update(_coaches_entries(state, teams, preseason[:25], pre_others, {}, tiers, ap_params, 0, None))
    # remaining mode: replay the played weeks through the model (scores) but show the real polls
    if mode == "remaining" and current > 0:
        for w in range(1, current + 1):
            _update_polls_after_week(state, teams, w, real_ap=real.get(w))
    return state


def _rating_poll(teams: dict) -> list[str]:
    return [slug for slug, t in sorted(teams.items(), key=lambda kv: -kv[1]["team_ratings"]["overall"]) if not t["fictional"]][:25]


def _records(state: dict, through_week: Optional[int] = None, include_playoff: bool = False) -> dict[str, dict]:
    """Won-lost records. Playoff games are left out (standings and bowl records stop at the
    bowls) unless include_playoff is set, which the final AP poll uses."""
    teams = load_teams()
    rec = {slug: {"wins": 0, "losses": 0, "conf_wins": 0, "conf_losses": 0, "points_for": 0, "points_against": 0}
           for slug in teams}
    for g in state["games"].values():
        if not g["played"] or (through_week is not None and g["week"] > through_week) or (g["kind"] == "playoff" and not include_playoff):
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


def _team_form(state: dict, teams: dict) -> dict[str, dict]:
    """Per team: home and away records, streak (+n wins / -n losses), the last game, and
    the current AP and CFP ranks. Playoff games are left out like the records."""
    latest = state["polls"].get(str(state["current_week"])) or {}
    ap = {e["team"]: e["rank"] for e in latest.get("ap", [])}
    cfp = {e["team"]: e["rank"] for e in latest.get("cfp", [])}
    out = {slug: {"home_wins": 0, "home_losses": 0, "away_wins": 0, "away_losses": 0, "streak": 0, "last": None,
                  "ap_rank": ap.get(slug), "cfp_rank": cfp.get(slug)} for slug in teams}
    played = sorted((g for g in state["games"].values() if g["played"] and g["kind"] != "playoff"),
                    key=lambda g: (g["week"], g.get("date") or ""))
    for g in played:
        hs, as_ = g["home_score"], g["away_score"]
        for slug, opp, pf, pa, side in ((g["home"], g["away"], hs, as_, "home"), (g["away"], g["home"], as_, hs, "away")):
            f = out.get(slug)
            if f is None:
                continue
            won = pf > pa
            venue = "neutral" if g["neutral"] else side
            if venue != "neutral":
                f[f"{venue}_{'wins' if won else 'losses'}"] += 1
            f["streak"] = (f["streak"] + 1 if f["streak"] > 0 else 1) if won else (f["streak"] - 1 if f["streak"] < 0 else -1)
            f["last"] = {"won": won, "score": f"{pf}-{pa}", "opponent": opp,
                         "opponent_name": teams[opp]["name"] if opp in teams else opp, "venue": venue, "week": g["week"]}
    return out


def standings(state: dict) -> dict[str, list[dict]]:
    """Conference tables. Rows carry `division` (None where the conference has none),
    `conf_rank` (counted within the division when there is one), `champion` and
    `runner_up` once the title game is played, and `tiebreak` when the ladder placed them."""
    teams = load_teams()
    rec = _records(state)
    opp = _opponents(state)
    rank_pos = _ranking_positions(state)
    form = _team_form(state, teams)
    table: dict[str, list[dict]] = {}
    for slug, t in teams.items():
        if t["fictional"]:
            continue
        r = {"slug": slug, "name": t["name"], "division": division_of(t["conference"], slug), **rec[slug], **form[slug]}
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
                  start: int = 1, votes: Optional[dict] = None, records: Optional[dict] = None) -> list[dict]:
    rec = records if records is not None else _records(state, week)
    out = []
    for i, slug in enumerate(order, start):
        r = rec.get(slug, {"wins": 0, "losses": 0})
        e = {"rank": i, "team": slug, "name": teams[slug]["name"], "previous": prev_rank.get(slug),
             "record": f"{r['wins']}-{r['losses']}", "conference": teams[slug]["conference"]}
        if votes is not None:
            v = votes.get(slug, {"first_place": 0, "points": 0})
            e["first_place"], e["points"] = v["first_place"], v["points"]
        out.append(e)
    return out


def _ap_votes(state: dict, order: list[str], tiers: dict[str, str], params: dict, week: int) -> dict[str, dict]:
    return polls.ballots(order, state["scores"], tiers, params, seed=(state.get("seed") or 0) * 1000 + week)


def _coaches_entries(state: dict, teams: dict, ap_order: list[str], others: list[str], rec_t: dict, tiers: dict,
                     params: dict, week: int, prev_week: Optional[int], records: Optional[dict] = None,
                     pinned: tuple = ()) -> dict:
    """The Coaches Poll for a week: the AP order nudged by record and the previous
    coaches poll, then its own 65 ballots. `pinned` teams (the champion and runner-up
    in the final poll) stay on top."""
    prev = state["polls"].get(str(prev_week), {}).get("coaches", []) if prev_week is not None else []
    prev_rank = {e["team"]: e["rank"] for e in prev}
    opinion = polls.coaches_opinion(ap_order + others, state.get("seed") or 0, week)
    order = polls.coaches_order(ap_order + others, rec_t, prev_rank, opinion)
    order = [t for t in pinned if t] + [t for t in order if t not in pinned]
    top, rest = order[:25], order[25:25 + AP_OTHERS]
    votes = polls.ballots(top + rest, state["scores"], tiers, params, n_voters=polls.COACHES_VOTERS,
                          seed=(state.get("seed") or 0) * 1000 + week + 500, noise=polls.COACHES_NOISE)
    return {"coaches": _poll_entries(top, prev_rank, state, teams, week, votes=votes, records=records),
            "coaches_others": _poll_entries(rest, prev_rank, state, teams, week, start=26, votes=votes, records=records)}


def _final_ap_poll(state: dict, teams: dict) -> None:
    """The AP's last poll, released after the national championship: every bowl and
    playoff result counts, the champion is first and the runner-up second (true of every
    final poll of the playoff era), and the rest fall in by the model."""
    ap_params, _ = polls.load_params()
    tiers = {slug: tier_of(t) for slug, t in teams.items()}
    last_week = max((int(k) for k, v in state["polls"].items() if v.get("ap")), default=CCG_WEEK)
    prev = state["polls"][str(last_week)]["ap"]
    prev_rank = {e["team"]: e["rank"] for e in prev}
    post_games = [{"home": g["home"], "away": g["away"], "home_score": g["home_score"], "away_score": g["away_score"],
                   "neutral": g["neutral"]} for g in state["games"].values() if g["played"] and g["week"] > SELECTION_WEEK]
    rec = _records(state, include_playoff=True)
    rec_t = {s: (r["wins"], r["losses"]) for s, r in rec.items()}
    scores = polls.update_scores(state["scores"], post_games, prev_rank, rec_t, tiers, CCG_WEEK, CCG_WEEK, ap_params)
    final = state["games"].get("cfp-final")
    champion = state.get("champion")
    runner_up = None
    if final and champion:
        runner_up = final["away"] if final["home"] == champion else final["home"]
        top = max(scores.values())
        scores[champion] = top + 120.0          # the title settles the top of the poll
        scores[runner_up] = max(scores.get(runner_up, 0.0), top + 40.0)
    state["scores"] = scores
    full = polls.rank(scores, rec_t, tiers, ap_params, n=25 + AP_OTHERS)
    order = [t for t in (champion, runner_up) if t] + [t for t in full if t not in (champion, runner_up)]
    order, others = order[:25], order[25:25 + AP_OTHERS]
    votes = _ap_votes(state, order + others, tiers, ap_params, FINAL_WEEK)
    state["polls"]["19"] = {"ap": _poll_entries(order, prev_rank, state, teams, votes=votes, records=rec),
                            "ap_others": _poll_entries(others, prev_rank, state, teams, start=26, votes=votes, records=rec),
                            "final": True}
    state["polls"]["19"].update(_coaches_entries(state, teams, order, others, rec_t, tiers, ap_params, 19, last_week,
                                                 records=rec, pinned=(champion, runner_up)))


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
    votes = _ap_votes(state, order + others, tiers, ap_params, week)
    entry = {"ap": _poll_entries(order, prev_rank, state, teams, week, votes=votes),
             "ap_others": _poll_entries(others, prev_rank, state, teams, week, start=26, votes=votes)}
    entry.update(_coaches_entries(state, teams, order, others, rec_t, tiers, ap_params, week, week - 1))
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
    # Pool workers ignore Ctrl-C; the server stops them on shutdown (keeps tracebacks out of the
    # console). In-process sims (SIM_WORKERS=1, as on Render) run on the server's job thread,
    # where Python refuses signal.signal, so only a process's main thread sets it.
    if threading.current_thread() is threading.main_thread():
        signal.signal(signal.SIGINT, signal.SIG_IGN)
    _TEAMS = json.loads(Path(path).read_text(encoding="utf-8"))["teams"]


def _with_injuries(team: dict, injured: list) -> dict:
    """The team data with the listed (name, position) players marked out."""
    if not injured:
        return team
    out = set(tuple(x) for x in injured)
    t = dict(team)
    for unit in ("offense", "defense"):
        t[unit] = [dict(p, injured=True, in_game=False) if (p["name"], p["position"]) in out else p for p in team[unit]]
    return t


def _sim_one(args: tuple) -> dict:
    from engine.game import simulate_game
    event_id, home, away, neutral, seed, keep_full, depth, home_out, away_out, edits, morale = args
    home_team = _with_injuries(apply_depth(with_morale(with_edits(_TEAMS[home], edits[0]), morale[0]), depth[0]), home_out)
    away_team = _with_injuries(apply_depth(with_morale(with_edits(_TEAMS[away], edits[1]), morale[1]), depth[1]), away_out)
    r = simulate_game(home_team, away_team, None, seed, venue="neutral" if neutral else "home", momentum=morale[2])
    out = {"event_id": event_id, "home_score": r["home"]["score"], "away_score": r["away"]["score"], "overtime": r["overtime_periods"],
           "stats": {"home": _compact_side(r["home"], r["drives"], "home"), "away": _compact_side(r["away"], r["drives"], "away")},
           "injuries": {"home": r["home"].get("injuries", []), "away": r["away"].get("injuries", [])}}
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


def _week_seeds(state: dict, week: int) -> dict[str, int]:
    """The random seed of every unplayed game of the week, drawn once in schedule order, so
    playing your game first (game day) and the rest later gives the same results as the
    whole week at once."""
    seeds = state.setdefault("seeds", {})
    if str(week) not in seeds:
        rng = random.Random(state["rng_state"])
        seeds[str(week)] = {eid: rng.randrange(1 << 30) for eid, g in state["games"].items() if g["week"] == week and not g["played"]}
        state["rng_state"] = rng.randrange(1 << 30)
    return seeds[str(week)]


def _run_games(state: dict, game_ids: list[str], pool: Optional[Pool] = None, report: Optional[Reporter] = None,
               stage: str = "Simulating") -> None:
    jobs = []
    if game_ids:
        seeds = _week_seeds(state, state["games"][game_ids[0]]["week"])
        spare = random.Random(state["rng_state"])
    for eid in game_ids:
        g = state["games"][eid]
        keep = True   # every game's box score is kept (on disk; yours also in the state)
        depth = state.get("depth") or {}
        injuries = state.get("injuries") or {}
        jobs.append((eid, g["home"], g["away"], g["neutral"], seeds.get(eid) if eid in seeds else spare.randrange(1 << 30), keep, (depth.get(g["home"]), depth.get(g["away"])),
                     [(i["name"], i["position"]) for i in injuries.get(g["home"], {}).values()],
                     [(i["name"], i["position"]) for i in injuries.get(g["away"], {}).values()],
                     (player_edits(state, g["home"]), player_edits(state, g["away"])),
                     (morale_payload(state, g["home"]), morale_payload(state, g["away"]), morale_on(state))))
    before = rank_map(state, state["current_week"]) if morale_on(state) else {}
    if not jobs:
        return
    if report:
        report(stage, 0, len(jobs))

    def take(r: dict, n: int) -> None:
        g = state["games"][r["event_id"]]
        g.update(played=True, home_score=r["home_score"], away_score=r["away_score"], overtime=r["overtime"])
        if "stats" in r:
            _accumulate_stats(state, g, r["stats"])
            _update_morale(state, g, r["stats"], before)
        if "game" in r:
            if state["team"] in (g["home"], g["away"]):
                state["my_boxes"][r["event_id"]] = r["game"]
            save_box(state, r["event_id"], r["game"])
        for side in ("home", "away"):
            for inj in r.get("injuries", {}).get(side, []):
                if inj["weeks"] > 0:
                    key = f"{inj['name']}|{inj['position']}"
                    state.setdefault("injuries", {}).setdefault(g[side], {})[key] = {
                        "name": inj["name"], "position": inj["position"], "type": inj["type"], "weeks": inj["weeks"],
                        "weeks_left": inj["weeks"], "since_week": g["week"], "event_id": r["event_id"]}
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

    if week == min(PLAYOFF_WEEKS):
        for hs, as_ in ((5, 12), (6, 11), (7, 10), (8, 9)):
            games.append(mk(f"cfp-r1-{hs}", seeds[hs], seeds[as_], False, f"First round: {hs} vs {as_}", hs, as_))
    elif week == min(PLAYOFF_WEEKS) + 1:
        for top, eid, label in ((1, "cfp-r1-8", "1 vs 8/9"), (2, "cfp-r1-7", "2 vs 7/10"), (3, "cfp-r1-6", "3 vs 6/11"), (4, "cfp-r1-5", "4 vs 5/12")):
            w, ws = winner(eid)
            games.append(mk(f"cfp-qf-{top}", seeds[top], w, True, f"Quarterfinal: {label}", top, ws, site_key=f"qf-{top}"))
    elif week == min(PLAYOFF_WEEKS) + 2:
        (a, a_s), (b, b_s) = winner("cfp-qf-1"), winner("cfp-qf-4")
        games.append(mk("cfp-sf-1", a, b, True, "Semifinal", a_s, b_s, site_key="sf-1"))
        (c, c_s), (d, d_s) = winner("cfp-qf-2"), winner("cfp-qf-3")
        games.append(mk("cfp-sf-2", c, d, True, "Semifinal", c_s, d_s, site_key="sf-2"))
    elif week == FINAL_WEEK:
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


def _setup_week(state: dict, week: int, teams: dict, say) -> None:
    """What happens before a week's games, once: injuries heal a week, and the title games,
    the playoff round and the bowls are set. Game day and the full advance both call it."""
    if state.get("week_setup") == week:
        return
    state["week_setup"] = week
    _heal(state)
    _decay_morale(state)
    if week == CCG_WEEK:
        say("Setting the conference title games")
        for g in _ccg_matchups(state, teams):
            state["games"][g["event_id"]] = g
    if week in PLAYOFF_WEEKS:
        say(f"Setting the {PLAYOFF_WEEKS[week].lower()} matchups")
        for g in _playoff_round(state, week, teams):
            state["games"][g["event_id"]] = g
    if week == min(PLAYOFF_WEEKS):
        say("Selecting the bowls")
        for g in _bowl_games(state, teams):
            state["games"][g["event_id"]] = g


def my_game_id(state: dict, week: Optional[int] = None) -> Optional[str]:
    """Your unplayed game in `week` (default: the week up next), or None on a bye."""
    week = state["current_week"] + 1 if week is None else week
    me = state["team"]
    return next((eid for eid, g in state["games"].items() if g["week"] == week and not g["played"] and me in (g["home"], g["away"])), None)


def play_my_game(state: dict, pool: Optional[Pool] = None, report: Optional[Reporter] = None) -> Optional[str]:
    """Game day: set the week up if it is not yet, then simulate only your game. The rest
    of the week waits for `advance`. Returns the game's event id, or None on a bye."""
    if state["done"]:
        return None

    def say(stage: str) -> None:
        if report:
            report(stage, None, None)

    week = state["current_week"] + 1
    _setup_week(state, week, load_teams(), say)
    eid = my_game_id(state, week)
    if eid is None:
        return None
    _run_games(state, [eid], pool, report, stage="Simming your game")
    return eid


def advance(state: dict, pool: Optional[Pool] = None, report: Optional[Reporter] = None) -> dict:
    """Play the next week (the rest of it, after a game day). Returns the state.
    `report(stage, games_done, games_total)` is called as the week goes, for a live
    progress display."""
    if state["done"]:
        return state

    def say(stage: str) -> None:
        if report:
            report(stage, None, None)

    teams = load_teams()
    week = state["current_week"] + 1
    label = week_label(week)
    _setup_week(state, week, teams, say)
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
        if week == FINAL_WEEK:
            g = state["games"]["cfp-final"]
            state["champion"] = g["home"] if g["home_score"] > g["away_score"] else g["away"]
            say("Final AP poll")
            _final_ap_poll(state, teams)
            state["done"] = True
            state["phase"] = "done"
    state["current_week"] = week
    if week in (CCG_WEEK, SELECTION_WEEK, FINAL_WEEK):
        say({CCG_WEEK: "Handing out the conference awards", SELECTION_WEEK: "Counting the Heisman vote and the national awards",
             FINAL_WEEK: "Handing out the postseason awards"}[week])
        _award_step(state, teams, week)
    return state


def _heal(state: dict) -> None:
    """One week passes: everyone on the injury list gets a week closer to returning."""
    for slug, lst in list(state.get("injuries", {}).items()):
        for key, inj in list(lst.items()):
            inj["weeks_left"] -= 1
            if inj["weeks_left"] <= 0:
                del lst[key]
        if not lst:
            del state["injuries"][slug]


def injury_report(state: dict, team: Optional[str] = None) -> list[dict]:
    """Current injuries, longest absences first; one team or the whole league."""
    teams = load_teams()
    out = []
    for slug, lst in state.get("injuries", {}).items():
        if team and slug != team:
            continue
        for inj in lst.values():
            out.append({**inj, "team": slug, "team_name": teams[slug]["name"], "conference": teams[slug]["conference"],
                        "returns_week": state["current_week"] + inj["weeks_left"]})
    out.sort(key=lambda i: (-i["weeks_left"], i["team_name"], i["name"]))
    return out


def _award_step(state: dict, teams: dict, week: int) -> None:
    """Conference awards after championship week, the Heisman and national awards in
    selection week, the postseason awards after the title game."""
    aw = state.setdefault("awards", {})
    pool = awards.Pool(state, teams, _records(state, include_playoff=(week == FINAL_WEEK)))
    if week == CCG_WEEK:
        aw["conference"] = awards.conference_awards(pool, state)
    elif week == SELECTION_WEEK:
        aw["national"] = awards.national_awards(pool, state)
    elif week == FINAL_WEEK:
        aw["postseason"] = awards.postseason_awards(pool, state)
    aw["given_through"] = week


def player_overall(p: dict) -> int:
    """A display rating from the engine attributes that matter at the position."""
    pos = p["position"]
    if pos == "K":
        primary, secondary = ["kick_power", "kick_accuracy"], []
    elif pos == "P":
        primary, secondary = ["punt_power", "punt_accuracy"], []
    elif pos == "QB":
        primary, secondary = ["passing", "decision_making", "intelligence"], ["speed", "elusiveness"]
    elif pos == "RB":
        primary, secondary = ["speed", "elusiveness", "vision", "strength"], ["hands", "pass_blocking"]
    elif pos in ("WR", "TE"):
        primary, secondary = ["hands", "route_running", "speed"], ["run_blocking", "elusiveness"]
    elif pos == "OL":
        primary, secondary = ["run_blocking", "pass_blocking", "strength"], ["intelligence"]
    elif pos == "DL":
        primary, secondary = ["rushing", "tackling", "strength"], ["intelligence", "speed"]
    elif pos in ("MLB", "ROLB", "LOLB"):
        primary, secondary = ["tackling", "rushing", "coverage", "speed"], ["intelligence"]
    else:
        primary, secondary = ["coverage", "speed", "tackling"], ["intelligence", "hands"]
    total = count = 0
    for k in primary:
        if isinstance(p.get(k), (int, float)):
            total += p[k] * 3
            count += 3
    for k in secondary:
        if isinstance(p.get(k), (int, float)):
            total += p[k]
            count += 1
    return round(total / count) if count else 0


DEPTH_ROWS = [
    ("Offense", [("QB", "Quarterback"), ("HB", "Running back"), ("FB", "Fullback"), ("WR", "Wide receiver"), ("TE", "Tight end"),
                 ("LT", "Left tackle"), ("LG", "Left guard"), ("C", "Center"), ("RG", "Right guard"), ("RT", "Right tackle")]),
    ("Defense", [("LEDG", "Left edge"), ("DT", "Defensive tackle"), ("REDG", "Right edge"), ("SAM", "Strongside LB"), ("MIKE", "Middle LB"),
                 ("WILL", "Weakside LB"), ("CB", "Cornerback"), ("FS", "Free safety"), ("SS", "Strong safety")]),
    ("Special teams", [("K", "Kicker"), ("P", "Punter"), ("KR", "Kick returner"), ("PR", "Punt returner")]),
]


ROLE_POSITION = {"QB": "QB", "HB": "RB", "FB": "RB", "WR": "WR", "TE": "TE", "LT": "OL", "LG": "OL", "C": "OL", "RG": "OL", "RT": "OL",
                 "LEDG": "DL", "REDG": "DL", "DT": "DL", "MIKE": "MLB", "WILL": "ROLB", "SAM": "LOLB", "CB": "CB", "FS": "S", "SS": "S",
                 "K": "K", "P": "P"}
OFFENSE_POSITIONS = {"QB", "RB", "WR", "TE", "OL", "K", "P"}
RATING_KEY = {"MLB": "MLB", "ROLB": "MLB", "LOLB": "MLB"}   # linebacker roles share one rating


def overall_at(p: dict, pos: str) -> int:
    """A player's rating at an engine position (his own, or another one he could be moved to)."""
    ra = p.get("ratings_at") or {}
    key = RATING_KEY.get(pos, pos)
    if key in ra:
        return int(ra[key])
    return player_overall(p) if pos == p["position"] else 0


def apply_depth(team: dict, overrides: Optional[dict]) -> dict:
    """A copy of the team with the season's depth-chart changes applied. Players named in an
    overridden role take that role (and its position, even from another position group),
    in the saved order; every role then starts its usual number of players (three
    receivers, two tackles, one everywhere else). KR and PR overrides pick the returner."""
    if not overrides:
        return team
    out = {**team}
    players = [dict(p) for p in team["offense"] + team["defense"]]
    by_slug = {p["slug"]: p for p in players}
    starters = {}
    for p in players:
        if p.get("role") and p.get("in_game"):
            starters[p["role"]] = starters.get(p["role"], 0) + 1
    moved = set()
    for role, order in overrides.items():
        if role in ("KR", "PR"):
            if order and order[0] in by_slug:
                out["kick_returner" if role == "KR" else "punt_returner"] = order[0]
            continue
        chosen = [by_slug[s] for s in order if s in by_slug]
        for i, p in enumerate(chosen):
            p["role"], p["depth"] = role, i + 1
            moved.add(p["slug"])
        rest = sorted((p for p in players if p.get("role") == role and p["slug"] not in moved), key=lambda p: p.get("depth") or 99)
        for i, p in enumerate(rest):
            p["depth"] = len(chosen) + i + 1
    stat_keys = sorted({k for p in players for k in (p.get("stats") or {})})
    for role in {p.get("role") for p in players if p.get("role")}:
        group = sorted((p for p in players if p.get("role") == role), key=lambda p: (p.get("depth") or 99, p["name"]))
        for i, p in enumerate(group):
            p["depth"] = i + 1
            p["in_game"] = i < starters.get(role, 1 if role in ROLE_POSITION else 0)
            new_pos = ROLE_POSITION.get(role, p["position"])
            if new_pos != p["position"]:
                p["position"] = new_pos
                p["stats"] = {k: 0 for k in stat_keys}   # a player crossing units needs every box-score key
    out["offense"] = [p for p in players if p["position"] in OFFENSE_POSITIONS]
    out["defense"] = [p for p in players if p["position"] not in OFFENSE_POSITIONS]
    return out


def position_candidates(state: dict, slug: str, role: str) -> dict:
    """Every player on the roster rated at one depth-chart role, best first, with where he
    sits now, so anyone can be moved into that spot."""
    team = apply_depth(team_data(state, slug), (state.get("depth") or {}).get(slug))
    ss = (state.get("season_stats") or {}).get(slug, {}).get("players", {})
    pos = "KR" if role in ("KR", "PR") else ROLE_POSITION.get(role, role)
    current = depth_order(state, slug, role)
    rows = []
    for p in team["offense"] + team["defense"]:
        rating = int(p.get("return_rating") or 0) if pos == "KR" else overall_at(p, pos)
        rec = ss.get(f"{p['name']}|{p['position']}")
        st = rec["stats"] if rec else {}
        group = awards.Pool._group(p["position"], p.get("role"), st) or p["position"]
        rows.append({"name": p["name"], "slug": p["slug"], "position": p["position"], "role": p.get("role"), "depth": p.get("depth"),
                     "class": p.get("class"), "height": p.get("height"), "weight": p.get("weight"), "jersey": p.get("jersey"),
                     "rating": rating, "natural": player_overall(p), "starter": bool(p.get("in_game")),
                     "in_role": p["slug"] in current, "spot": (current.index(p["slug"]) + 1) if p["slug"] in current else None,
                     "games": rec["games"] if rec else 0, "headline": awards.headline({"stats": st}, group) if st else ""})
    rows.sort(key=lambda r: (-r["rating"], r["name"]))
    return {"role": role, "position": pos, "players": rows, "current": current}


def depth_order(state: dict, slug: str, role: str) -> list[str]:
    """The current order of a role, overrides applied."""
    team = apply_depth(load_teams()[slug], (state.get("depth") or {}).get(slug))
    if role in ("KR", "PR"):
        pick = team.get("kick_returner" if role == "KR" else "punt_returner")
        return [pick] if pick else []
    return [p["slug"] for p in sorted((p for p in team["offense"] + team["defense"] if p.get("role") == role), key=lambda p: p.get("depth") or 99)]


def move_depth(state: dict, slug: str, role: str, player: str, move: str) -> None:
    """Move a player within his role: up, down, or to the top (the starter spot). KR and
    PR take the named player as the returner."""
    team = load_teams()[slug]
    by_slug = {p["slug"]: p for p in team["offense"] + team["defense"]}
    if player not in by_slug:
        raise ValueError("unknown player")
    overrides = state.setdefault("depth", {}).setdefault(slug, {})
    if role in ("KR", "PR"):
        overrides[role] = [player]
        return
    order = depth_order(state, slug, role)
    if player not in order:
        # a player from any position group can be moved into the role; he leaves his old one
        for other, lst in overrides.items():
            if other != role and player in lst:
                lst.remove(player)
        order.append(player)
    i = order.index(player)
    if move == "top":
        order.insert(0, order.pop(i))
    elif move == "up" and i > 0:
        order[i - 1], order[i] = order[i], order[i - 1]
    elif move == "down" and i < len(order) - 1:
        order[i + 1], order[i] = order[i], order[i + 1]
    overrides[role] = order


def reset_depth(state: dict, slug: str) -> None:
    (state.get("depth") or {}).pop(slug, None)


def depth_chart_view(state: dict, slug: str) -> dict:
    """A team's depth chart: every role in formation order, players in depth order, with
    class, size, rating and the player's season headline."""
    teams = load_teams()
    overrides = (state.get("depth") or {}).get(slug)
    t = apply_depth(team_data(state, slug), overrides)
    ss = (state.get("season_stats") or {}).get(slug, {}).get("players", {})
    players = t["offense"] + t["defense"]
    base_by_slug = {x.get("slug"): x for x in teams[slug]["offense"] + teams[slug]["defense"]}
    by_role: dict[str, list[dict]] = {}
    for p in players:
        if p.get("role"):
            by_role.setdefault(p["role"], []).append(p)
    for role in by_role:
        by_role[role].sort(key=lambda p: (p.get("depth") or 99, -player_overall(p)))
    returners = {"KR": [p for p in players if p.get("slug") == t.get("kick_returner")],
                 "PR": [p for p in players if p.get("slug") == t.get("punt_returner")]}

    injured = (state.get("injuries") or {}).get(slug, {})

    def card(p: dict, role: str) -> dict:
        inj = injured.get(f"{p['name']}|{p['position']}")
        rec = ss.get(f"{p['name']}|{p['position']}")
        st = rec["stats"] if rec else {}
        group = awards.Pool._group(p["position"], p.get("role"), st) or p["position"]
        if role in ("KR", "PR"):
            group = "RS"
        return {"name": p["name"], "slug": p.get("slug"), "position": p["position"], "role": p.get("role"), "depth": p.get("depth"), "class": p.get("class"),
                "height": p.get("height"), "weight": p.get("weight"), "jersey": p.get("jersey"), "overall": shown_overall(p, base_by_slug.get(p.get("slug"))),
                "starter": bool(p.get("in_game")), "games": rec["games"] if rec else 0,
                "form": round(player_form(state, slug, p["name"], p["position"]), 2) if morale_on(state) else 0.0,
                "headline": awards.headline({"stats": st}, group) if st else "",
                "injury": {"type": inj["type"], "weeks_left": inj["weeks_left"], "returns_week": state["current_week"] + inj["weeks_left"]} if inj else None}

    units = []
    for unit, rows in DEPTH_ROWS:
        out_rows = []
        for role, label in rows:
            group = returners.get(role) if role in returners else by_role.get(role, [])
            if not group:
                continue
            out_rows.append({"role": role, "label": label, "players": [card(p, role) for p in group[:6]]})
        units.append({"name": unit, "rows": out_rows})
    hc = (t.get("coaches") or {}).get("head_coach") or {}
    return {"team": slug, "name": t["name"], "conference": t["conference"], "head_coach": hc.get("name"),
            "ratings": t.get("team_ratings", {}), "roster_size": len(players), "units": units,
            "overridden": bool(overrides), "editable": True}


def awards_view(state: dict) -> dict:
    """The Awards tab: the live race until the awards are given, then the results."""
    teams = load_teams()
    aw = state.get("awards") or {}
    out = {"given_through": aw.get("given_through", 0), "conference": aw.get("conference", {}), "national": aw.get("national"),
           "postseason": aw.get("postseason"), "mine": awards.my_awards(state, aw) if aw else [],
           "my_conference": teams[state["team"]]["conference"], "team": state["team"]}
    if not aw.get("national"):
        out["race"] = awards.race_view(state, teams, _records(state))
    return out


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
               report: Optional[Reporter] = None, should_stop: Optional[Callable[[], bool]] = None) -> dict:
    """Play weeks up to target_week; `should_stop` is checked between weeks (the Pause button)."""
    target = min(target_week, FINAL_WEEK)
    pool = shared_pool()
    while state["current_week"] < target and not state["done"]:
        if should_stop and should_stop():
            break
        advance(state, pool, report)
        if progress:
            progress(state["current_week"], target)
    return state


def my_results(state: dict, since_week: int) -> list[dict]:
    """Your team's played games after `since_week`, for the live ticker while simming."""
    me = state["team"]
    out = []
    for eid, g in state["games"].items():
        if not g["played"] or g["week"] <= since_week or me not in (g["home"], g["away"]):
            continue
        home = g["home"] == me
        pf, pa = (g["home_score"], g["away_score"]) if home else (g["away_score"], g["home_score"])
        out.append({"week": g["week"], "title": g.get("title"), "kind": g["kind"], "won": pf > pa, "points_for": pf, "points_against": pa,
                    "opponent": g["away"] if home else g["home"], "opponent_name": g["away_display"] if home else g["home_display"],
                    "venue": "neutral" if g["neutral"] else ("home" if home else "away"), "overtime": g.get("overtime") or 0,
                    "event_id": eid, "has_box": eid in state.get("my_boxes", {}) or (box_dir(state) / f"{eid}.json").exists()})
    out.sort(key=lambda r: r["week"])
    return out


def box_dir(state_or_id) -> Path:
    sid = state_or_id if isinstance(state_or_id, str) else state_or_id["id"]
    return SEASONS_DIR / sid / "boxes"


def save_box(state: dict, event_id: str, game: dict) -> None:
    """Every simulated game's box score, one small file each, so any game can be opened."""
    d = box_dir(state)
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{event_id}.json").write_text(json.dumps(game), encoding="utf-8")


def load_box(state: dict, event_id: str) -> Optional[dict]:
    box = state.get("my_boxes", {}).get(event_id)
    if box is not None:
        return box
    path = box_dir(state) / f"{event_id}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return None


def has_box(state: dict, g: dict) -> bool:
    return bool(g.get("played")) and not g.get("real") and (g["event_id"] in state.get("my_boxes", {}) or (box_dir(state) / f"{g['event_id']}.json").exists())


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

def rank_map(state: dict, after_week: int) -> dict[str, int]:
    """Team -> rank from the poll released after `after_week`: the CFP ranking once the
    committee has released one, the AP poll before that (top 25 either way)."""
    p = state["polls"].get(str(after_week), {})
    if p.get("cfp_full"):
        return {t: i + 1 for i, t in enumerate(p["cfp_full"][:25])}
    if p.get("cfp"):
        return {e["team"]: e["rank"] for e in p["cfp"]}
    return {e["team"]: e["rank"] for e in p.get("ap", [])}


# ----- the committee's resume -------------------------------------------------------

def _wl_pct(w: int, l: int) -> float:
    """Winning percentage from wins and losses."""
    return w / (w + l) if (w + l) else 0.0


def resume(state: dict, after_week: Optional[int] = None, team: Optional[str] = None) -> dict:
    """How the committee reads every FBS team through `after_week`: record, wins over
    ranked teams (rank at the time and today), strength of schedule, record against
    winning teams, best win and worst loss. With `team`, that team's full game list too.
    "Ranked" means the current top 25: the CFP ranking once released, the AP poll before."""
    teams = load_teams()
    cur = state["current_week"]
    w = cur if after_week is None else max(0, min(int(after_week), cur))
    rec = _records(state, w)
    now = rank_map(state, w)
    p = state["polls"].get(str(w), {})
    kind = "cfp" if (p.get("cfp_full") or p.get("cfp")) else "ap"
    real = {s for s, t in teams.items() if not t["fictional"]}
    games: dict[str, list[dict]] = {s: [] for s in teams}
    for eid, g in state["games"].items():
        if not g["played"] or g["week"] > w or g["kind"] == "playoff":
            continue
        before = rank_map(state, g["week"] - 1)
        for side, opp in (("home", "away"), (" away".strip(), "home")):
            me, o = g[side], g[opp]
            pf, pa = g[f"{side}_score"], g[f"{opp}_score"]
            r = rec.get(o, {"wins": 0, "losses": 0})
            games[me].append({"opp": o, "opp_name": g[f"{opp}_display"], "won": pf > pa, "pf": pf, "pa": pa, "week": g["week"],
                              "venue": "neutral" if g["neutral"] else ("home" if side == "home" else "away"),
                              "rank_then": before.get(o), "rank_now": now.get(o), "opp_record": f"{r['wins']}-{r['losses']}",
                              "opp_pct": _wl_pct(r["wins"], r["losses"]), "fcs": o not in real, "event_id": eid,
                              "title": g.get("title"), "conference_game": g["conference_game"]})
    # strength of schedule: two thirds the opponents' record, one third their opponents'
    # (FBS opponents only; the FCS stand-ins play too many schedules to have a record)
    opp_pct: dict[str, float] = {}
    for s in real:
        opps = [x["opp"] for x in games[s] if not x["fcs"]]
        ow, ol = sum(rec[o]["wins"] for o in opps), sum(rec[o]["losses"] for o in opps)
        opp_pct[s] = _wl_pct(ow, ol)
    sos: dict[str, float] = {}
    oo_pct: dict[str, float] = {}
    for s in real:
        opps = [x["opp"] for x in games[s] if not x["fcs"]]
        oo_pct[s] = sum(opp_pct[o] for o in opps) / len(opps) if opps else 0.0
        sos[s] = (2 * opp_pct[s] + oo_pct[s]) / 3
    order = sorted(real, key=lambda s: (-sos[s], s))
    sos_rank = {s: i + 1 for i, s in enumerate(order)}

    def quality(x: dict) -> tuple:
        # a ranked opponent first (the higher the better), then the opponent's record, then the margin
        return (x["rank_now"] is not None, -(x["rank_now"] or 99), x["opp_pct"], x["pf"] - x["pa"])

    def badness(x: dict) -> tuple:
        # an unranked opponent first, then the worse its record, then the bigger the margin
        return (x["rank_now"] is not None, x["opp_pct"], -(x["pa"] - x["pf"]))

    def wl(lst: list[dict]) -> str:
        return f"{sum(1 for x in lst if x['won'])}-{sum(1 for x in lst if not x['won'])}"

    rows = []
    for s in real:
        gl = games[s]
        wins = [x for x in gl if x["won"]]
        losses = [x for x in gl if not x["won"]]
        r = rec[s]
        conf = [x for x in gl if x["conference_game"]]
        row = {"team": s, "name": teams[s]["name"], "conference": teams[s]["conference"], "rank": now.get(s),
               "record": f"{r['wins']}-{r['losses']}", "wins": r["wins"], "losses": r["losses"], "conf_record": wl(conf),
               "sos_rank": sos_rank[s], "sos": round(sos[s], 3), "opp_pct": round(opp_pct[s], 3), "oo_pct": round(oo_pct[s], 3),
               "top25": wl([x for x in gl if x["rank_now"]]), "top25_wins": sum(1 for x in wins if x["rank_now"]),
               "vs_winning": wl([x for x in gl if not x["fcs"] and x["opp_pct"] > 0.5]),
               "road_wins": sum(1 for x in wins if x["venue"] != "home"), "fcs_wins": sum(1 for x in wins if x["fcs"]),
               "margin": round((r["points_for"] - r["points_against"]) / len(gl), 1) if gl else 0.0,
               "best_win": max(wins, key=quality) if wins else None, "worst_loss": min(losses, key=badness) if losses else None}
        if team == s:
            row["games"] = sorted(gl, key=lambda x: x["week"])
        rows.append(row)
    rows.sort(key=lambda x: (x["rank"] is None, x["rank"] or 99, -_wl_pct(x["wins"], x["losses"]), x["sos_rank"]))
    if team is not None:
        rows = [x for x in rows if x["team"] == team]
    return {"week": w, "kind": kind, "rows": rows}


def current_rank(state: dict) -> Optional[dict]:
    """Your team's rank in the latest ranking, with which poll it came from."""
    for w in range(state["current_week"], -1, -1):
        p = state["polls"].get(str(w))
        if not p:
            continue
        kind = "cfp" if (p.get("cfp_full") or p.get("cfp")) else "ap"
        r = rank_map(state, w).get(state["team"])
        return {"rank": r, "kind": kind, "week": w}
    return None


def week_view(state: dict, week: int) -> list[dict]:
    teams = load_teams()
    ap = rank_map(state, week - 1)
    rec = _records(state, include_playoff=True)
    out = []
    for g in state["games"].values():
        if g["week"] != week:
            continue
        out.append({**{k: v for k, v in g.items()}, "home_rank": ap.get(g["home"]), "away_rank": ap.get(g["away"]),
                    "mine": state["team"] in (g["home"], g["away"]), "has_box": has_box(state, g),
                    "home_name": teams[g["home"]]["name"], "away_name": teams[g["away"]]["name"],
                    "home_record": f"{rec[g['home']]['wins']}-{rec[g['home']]['losses']}", "away_record": f"{rec[g['away']]['wins']}-{rec[g['away']]['losses']}"})
    out.sort(key=lambda g: (not g["mine"], {"playoff": 0, "bowl": 1}.get(g["kind"], 2), g["date"] or "", g["event_id"]))
    return out


# ----- season stats --------------------------------------------------------
# Full box scores are kept only for your own games; for every game the workers send
# back a compact per-team line (team totals, situational counts, plays, possession and
# each player's stat line) which is summed into state["season_stats"] as the season goes.

PLAYER_CATEGORIES = {
    "passing": ("pass_attempts", ["completions", "pass_attempts", "pass_yards", "passing_touchdowns", "interceptions_thrown", "sacks_taken",
                                  "passing_first_downs", "passing_conversions", "long_pass"], "pass_yards"),
    "rushing": ("carries", ["carries", "rush_yards", "rushing_touchdowns", "fumbles", "explosive_runs", "rushing_first_downs", "rushing_conversions", "long_rush"], "rush_yards"),
    "receiving": ("receptions", ["targets", "receptions", "receiving_yards", "receiving_touchdowns", "explosive_catches", "receiving_first_downs", "long_reception"], "receiving_yards"),
    "defense": ("solo_tackles", ["solo_tackles", "assisted_tackles", "tackles_for_loss", "sacks", "hurries", "interceptions", "interception_return_yards",
                                 "passes_defended", "forced_fumbles", "fumble_recoveries", "defensive_touchdowns"], "solo_tackles"),
    "kicking": ("fg_attempted", ["fg_made", "fg_attempted", "fg_40_made", "fg_40_att", "fg_50_made", "fg_50_att", "long_fg", "pat_made", "pat_attempts"], "fg_made"),
    "punting": ("punts", ["punts", "punt_yards", "punt_net_yards", "punts_inside_20", "punt_touchbacks", "long_punt"], "punts"),
    "returns": ("kickoff_returns", ["kickoff_returns", "kickoff_return_yards", "kickoff_return_touchdowns", "long_kickoff_return", "punt_returns",
                                    "punt_return_yards", "punt_return_touchdowns", "long_punt_return"], "kickoff_return_yards"),
    # offensive linemen: snaps, starts and the line credits the engine keeps
    "blocking": ("snaps", ["snaps", "games_started", "sacks_allowed", "pressures_allowed", "stuffs_allowed", "key_blocks"], "snaps"),
}


def _compact_side(side: dict, drives: list[dict], which: str) -> dict:
    own = [d for d in drives if d["offense"] == which and d["quarter"] <= 4]
    return {"score": side["score"], "team": side["team_stats"], "events": side.get("team_events") or {},
            "personnel": side.get("personnel") or {}, "schemes": side.get("schemes") or {},
            "plays": sum(d["plays"] for d in own), "top": sum(d["seconds"] for d in own),
            "players": [{"name": p["name"], "position": p["position"], "unit": p["unit"], "stats": {k: v for k, v in p["stats"].items() if v}}
                        for p in side["players"] if any(p["stats"].values())]}


def _add_into(total: dict, add: dict) -> None:
    for k, v in add.items():
        if isinstance(v, (int, float)):
            if k.startswith("long_"):
                total[k] = max(total.get(k, 0), v)
            else:
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
        pers = t.setdefault("personnel", {})
        for k, v in (mine.get("personnel") or {}).items():
            pers[k] = pers.get(k, 0) + v
        if mine.get("schemes"):
            t["schemes"] = mine["schemes"]
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
        extra = {k: 0 for k in ("tackles_for_loss", "passes_defended", "hurries", "explosive_runs", "explosive_catches", "pressures_allowed")}
        for pl in t.get("players", {}).values():
            for k in extra:
                extra[k] += pl["stats"].get(k, 0)
        rows.append({
            "tfl": extra["tackles_for_loss"], "pbu": extra["passes_defended"], "hurries": extra["hurries"],
            "explosives": extra["explosive_runs"] + extra["explosive_catches"], "pressures_allowed": extra["pressures_allowed"],
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


def player_stats_view(state: dict, team: Optional[str] = None, category: str = "passing", limit: int = 100,
                      conference: Optional[str] = None) -> dict:
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
        if conference and not team and info["conference"] != conference:
            continue
        for p in t["players"].values():
            st = p["stats"]
            if category == "blocking" and (p["position"] not in ("OL", "TE", "RB") or not st.get("snaps")):
                continue
            if not st.get(gate) and not (category == "defense" and any(st.get(k) for k in keys)) \
                    and not (category == "returns" and st.get("punt_returns")) and not (category == "kicking" and st.get("pat_attempts")):
                continue
            out.append({"name": p["name"], "position": p["position"], "team": slug, "team_name": info["name"], "games": p["games"],
                        "team_games": t["games"], "stats": {k: st.get(k, 0) for k in keys}})
    out.sort(key=lambda p: (-p["stats"].get(sort_key, 0), p["name"]))
    if not team:
        out = out[:limit]
    return {"category": category, "team": team, "players": out, "partial": bool(state.get("season_stats_partial"))}


LEADER_KEYS = {
    "passing": ("passing", lambda st: st.get("pass_yards", 0)),
    "rushing": ("rushing", lambda st: st.get("rush_yards", 0)),
    "receiving": ("receiving", lambda st: st.get("receiving_yards", 0)),
    "tackles": ("defense", lambda st: st.get("solo_tackles", 0) + st.get("assisted_tackles", 0)),
    "sacks": ("defense", lambda st: st.get("sacks", 0)),
    "interceptions": ("defense", lambda st: st.get("interceptions", 0)),
    "touchdowns": ("rushing", lambda st: st.get("rushing_touchdowns", 0) + st.get("receiving_touchdowns", 0)),
    "kicking": ("kicking", lambda st: st.get("fg_made", 0) * 3 + st.get("pat_made", 0)),
    "tfl": ("defense", lambda st: st.get("tackles_for_loss", 0)),
    "pbu": ("defense", lambda st: st.get("passes_defended", 0)),
    "explosives": ("rushing", lambda st: st.get("explosive_runs", 0) + st.get("explosive_catches", 0)),
    "punting": ("punting", lambda st: round(st.get("punt_net_yards", 0) / st["punts"], 1) if st.get("punts", 0) >= 10 else 0),
}


def player_leaders_view(state: dict, team: Optional[str] = None, n: int = 5, conference: Optional[str] = None) -> dict:
    """Top n in each leader category, for one team, one conference or the league, with full stat lines."""
    teams = load_teams()
    ss = _season_stats(state)
    rows: list[dict] = []
    for slug, t in ss.items():
        if team and slug != team:
            continue
        info = teams.get(slug)
        if not info or (info["fictional"] and not team):
            continue
        if conference and not team and info["conference"] != conference:
            continue
        for pl in t["players"].values():
            rows.append({"name": pl["name"], "position": pl["position"], "unit": pl["unit"], "team": slug, "team_name": info["name"],
                         "games": pl["games"], "stats": pl["stats"]})
    out: dict[str, list[dict]] = {}
    for cat, (table, value) in LEADER_KEYS.items():
        keys = PLAYER_CATEGORIES[table][1]
        if cat in ("touchdowns", "explosives"):
            keys = sorted(set(PLAYER_CATEGORIES["rushing"][1]) | set(PLAYER_CATEGORIES["receiving"][1]))
        ranked = sorted((r for r in rows if value(r["stats"]) > 0), key=lambda r: (-value(r["stats"]), r["name"]))[:n]
        out[cat] = [{**r, "stats": {k: r["stats"].get(k, 0) for k in keys}, "value": value(r["stats"])} for r in ranked]
    return {"team": team, "conference": conference, "leaders": out, "partial": bool(state.get("season_stats_partial"))}


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


# ----- rivalries: trophies and the all-time series -----------------------------------

RIVALRIES_FILE = ROOT / "data" / "rivalries.json"
_rivalry_cache: dict = {}


def load_rivalries() -> dict[frozenset, dict]:
    """Pair of slugs -> rivalry (name, trophy, base series), from data/rivalries.json."""
    if not _rivalry_cache:
        data = json.loads(RIVALRIES_FILE.read_text(encoding="utf-8"))
        for r in data["rivalries"]:
            _rivalry_cache[frozenset(r["teams"])] = r
        _rivalry_cache["__as_of__"] = data.get("as_of", "")
    return _rivalry_cache


def rivalry_for(a: str, b: str) -> Optional[dict]:
    return load_rivalries().get(frozenset((a, b)))


def rivalry_series(state: dict, riv: dict, before_week: Optional[int] = None, teams: Optional[dict] = None) -> dict:
    """The series entering `before_week` (or today): the base record plus this season's
    games between the two. Says who leads, by how much, and who won the last meeting."""
    teams = teams or load_teams()
    a, b = riv["teams"]
    wins = {a: riv["series"].get(a, 0), b: riv["series"].get(b, 0)}
    ties = riv["series"].get("ties", 0)
    last = None
    for g in sorted((g for g in state["games"].values() if {g["home"], g["away"]} == {a, b} and g["played"]), key=lambda g: g["week"]):
        if before_week is not None and g["week"] >= before_week:
            break
        if g["home_score"] == g["away_score"]:
            ties += 1
            continue
        winner = g["home"] if g["home_score"] > g["away_score"] else g["away"]
        wins[winner] += 1
        last = {"winner": winner, "week": g["week"], "event_id": g["event_id"],
                "score": f"{max(g['home_score'], g['away_score'])}–{min(g['home_score'], g['away_score'])}"}
    lead = a if wins[a] > wins[b] else b if wins[b] > wins[a] else None
    if lead is None:
        text = f"Series tied {wins[a]}-{wins[b]}" + (f"-{ties}" if ties else "")
    else:
        other = b if lead == a else a
        text = f"{teams[lead]['name']} leads {wins[lead]}-{wins[other]}" + (f"-{ties}" if ties else "")
    return {"wins": wins, "ties": ties, "leader": lead, "text": text, "last": last}


def game_rivalry(state: dict, g: dict, after: bool = False) -> Optional[dict]:
    """The rivalry line for one game: the trophy and the series entering it (or, with
    `after`, including it, with who takes or keeps the trophy)."""
    riv = rivalry_for(g["home"], g["away"])
    if riv is None:
        return None
    teams = load_teams()
    series = rivalry_series(state, riv, None if after else g["week"], teams)
    out = {"name": riv["name"], "trophy": riv.get("trophy") or "", "series": series["text"], "leader": series["leader"]}
    if after and g["played"] and g["home_score"] != g["away_score"]:
        winner = g["home"] if g["home_score"] > g["away_score"] else g["away"]
        loser = g["away"] if winner == g["home"] else g["home"]
        before = rivalry_series(state, riv, g["week"], teams)
        kept = before["last"] and before["last"]["winner"] == winner
        thing = riv.get("trophy") or "bragging rights"
        out["headline"] = f"{teams[winner]['name']} {'keeps' if kept else 'takes'} the {thing}" + (f" from {teams[loser]['name']}" if not kept and riv.get("trophy") else "")
    return out


def rivalries_view(state: dict, slug: str) -> dict:
    """Your rivals this season: the trophy, the series today and this season's meeting."""
    teams = load_teams()
    out = []
    for pair, riv in load_rivalries().items():
        if not isinstance(pair, frozenset) or slug not in pair:
            continue
        opp = next(t for t in pair if t != slug)
        if opp not in teams:
            continue
        series = rivalry_series(state, riv, None, teams)
        game = next((g for g in state["games"].values() if {g["home"], g["away"]} == pair), None)
        this = None
        if game is not None:
            home = game["home"] == slug
            this = {"week": game["week"], "played": game["played"], "event_id": game["event_id"], "venue": "neutral" if game["neutral"] else ("home" if home else "away"),
                    "won": ((game["home_score"] > game["away_score"]) == home) if game["played"] else None,
                    "points_for": (game["home_score"] if home else game["away_score"]) if game["played"] else None,
                    "points_against": (game["away_score"] if home else game["home_score"]) if game["played"] else None, "has_box": has_box(state, game)}
        out.append({"name": riv["name"], "trophy": riv.get("trophy") or "", "opponent": opp, "opponent_name": teams[opp]["name"],
                    "series": series["text"], "leader": series["leader"], "my_wins": series["wins"][slug], "their_wins": series["wins"][opp], "ties": series["ties"],
                    "holder": series["last"]["winner"] if series["last"] else None, "game": this})
    out.sort(key=lambda r: (r["game"] is None, r["game"]["week"] if r["game"] else 99))
    return {"team": slug, "as_of": load_rivalries().get("__as_of__", ""), "rivalries": out}


def team_schedule(state: dict, slug: str) -> list[dict]:
    """One team's season, game by game, with byes: the Team Schedule tab."""
    my_games = sorted((g for g in state["games"].values() if slug in (g["home"], g["away"])),
                      key=lambda g: (g["week"], g["date"] or ""))
    schedule = []
    all_rec = _records(state, include_playoff=True)
    ap_cache: dict[int, dict[str, int]] = {}

    def ap_before(week: int) -> dict[str, int]:
        if week not in ap_cache:
            ap_cache[week] = rank_map(state, week - 1)
        return ap_cache[week]

    for g in my_games:
        home = g["home"] == slug
        opp = g["away"] if home else g["home"]
        ap = ap_before(g["week"])
        schedule.append({"event_id": g["event_id"], "week": g["week"], "kind": g["kind"], "title": g.get("title"), "site": g.get("site"),
                         "opponent": opp, "opponent_name": g["away_display"] if home else g["home_display"],
                         "opponent_rank": ap.get(opp), "my_rank": ap.get(slug),
                         "venue": "neutral" if g["neutral"] else ("home" if home else "away"), "played": g["played"],
                         "won": (g["home_score"] > g["away_score"]) == home if g["played"] else None,
                         "points_for": (g["home_score"] if home else g["away_score"]) if g["played"] else None,
                         "points_against": (g["away_score"] if home else g["home_score"]) if g["played"] else None,
                         "overtime": g["overtime"], "real": g["real"], "has_box": has_box(state, g),
                         "opponent_record": f"{all_rec[opp]['wins']}-{all_rec[opp]['losses']}", "date": g.get("date"),
                         "rivalry": game_rivalry(state, g)})
    played_weeks = {g["week"] for g in schedule}
    for w in range(1, LAST_REGULAR_WEEK + 1):
        if w not in played_weeks:
            schedule.append({"event_id": None, "week": w, "kind": "bye", "title": None, "site": None, "opponent": None, "opponent_name": "Bye",
                             "opponent_rank": None, "my_rank": ap_before(w).get(slug), "venue": None, "played": w <= state["current_week"],
                             "won": None, "points_for": None, "points_against": None, "overtime": 0, "real": False, "has_box": False,
                             "opponent_record": None, "date": None})
    schedule.sort(key=lambda g: (g["week"], g["date"] or ""))
    return schedule


# ----- this week: the upcoming game and a simulated prediction ------------------------

_preview_cache: dict = {}


def _preview_team(state: dict, slug: str) -> dict:
    """The team as the next sim will see it: god-mode edits where that exists, the depth
    chart and the injury list."""
    td = globals().get("team_data")
    base = td(state, slug) if td else load_teams()[slug]
    out = [(i["name"], i["position"]) for i in (state.get("injuries") or {}).get(slug, {}).values()]
    return _with_injuries(apply_depth(base, (state.get("depth") or {}).get(slug)), out)


def game_preview(state: dict, slug: str, sims: int = 20) -> dict:
    """This week for one team: the next game with both ranks and records, and a prediction
    from simulating it `sims` times (win odds, the likely score, the margin, the passer and
    rusher to watch). Nothing here touches the season's random stream."""
    from engine.game import simulate_game
    teams = load_teams()
    week = state["current_week"] + 1
    g = next((x for x in state["games"].values() if slug in (x["home"], x["away"]) and x["week"] == week), None)
    if state["done"]:
        return {"team": slug, "team_name": teams[slug]["name"], "game": None, "reason": "done", "injuries": injury_report(state, slug)}
    if g is None:
        return {"team": slug, "team_name": teams[slug]["name"], "game": None, "reason": "bye", "week": week, "injuries": injury_report(state, slug)}
    home = g["home"] == slug
    opp = g["away"] if home else g["home"]
    ranks = rank_map(state, state["current_week"])
    rec = _records(state, include_playoff=True)
    riv = globals().get("game_rivalry")
    if g["played"]:
        # game day is done: the result, not a prediction
        pf, pa = (g["home_score"], g["away_score"]) if home else (g["away_score"], g["home_score"])
        game = {"event_id": g["event_id"], "week": g["week"], "kind": g["kind"], "title": g.get("title"), "site": g.get("site"), "date": g.get("date"),
                "opponent": opp, "opponent_name": g["away_display"] if home else g["home_display"], "opponent_rank": ranks.get(opp),
                "opponent_record": f"{rec[opp]['wins']}-{rec[opp]['losses']}" if opp in rec and not teams.get(opp, {}).get("fictional") else "",
                "my_rank": ranks.get(slug), "my_record": f"{rec[slug]['wins']}-{rec[slug]['losses']}",
                "venue": "neutral" if g["neutral"] else ("home" if home else "away"), "rivalry": riv(state, g, after=True) if riv else None,
                "played": True, "won": pf > pa, "points_for": pf, "points_against": pa, "overtime": g.get("overtime") or 0, "has_box": has_box(state, g)}
        return {"team": slug, "team_name": teams[slug]["name"], "game": game, "played": True, "prediction": None, "injuries": injury_report(state, slug)}
    game = {"event_id": g["event_id"], "week": g["week"], "kind": g["kind"], "title": g.get("title"), "site": g.get("site"), "date": g.get("date"),
            "bye_first": g["week"] > state["current_week"] + 1,
            "opponent": opp, "opponent_name": g["away_display"] if home else g["home_display"], "opponent_rank": ranks.get(opp),
            "opponent_record": f"{rec[opp]['wins']}-{rec[opp]['losses']}" if opp in rec and not teams.get(opp, {}).get("fictional") else "",
            "my_rank": ranks.get(slug), "my_record": f"{rec[slug]['wins']}-{rec[slug]['losses']}",
            "venue": "neutral" if g["neutral"] else ("home" if home else "away"), "rivalry": riv(state, g) if riv else None}
    key = (state["id"], state["current_week"], g["event_id"], json.dumps(state.get("player_edits") or {}, sort_keys=True)[:200],
           json.dumps(state.get("depth") or {}, sort_keys=True)[:200], len(json.dumps(state.get("injuries") or {})))
    pred = _preview_cache.get(key)
    if pred is None:
        h, a = _preview_team(state, g["home"]), _preview_team(state, g["away"])
        seed0 = int(hashlib.sha256(f"{state['id']}|{g['event_id']}|{state['current_week']}".encode()).hexdigest()[:8], 16)
        wins = 0
        pts = {"home": [], "away": []}
        stat_sum: dict[str, dict[str, dict]] = {"home": {}, "away": {}}
        for i in range(sims):
            r = simulate_game(h, a, seed=seed0 + i, venue="neutral" if g["neutral"] else "home")
            if r["home"]["score"] > r["away"]["score"]:
                wins += 1
            for side in ("home", "away"):
                pts[side].append(r[side]["score"])
                for p in r[side]["players"]:
                    if p.get("stats"):
                        acc = stat_sum[side].setdefault(f"{p['name']}|{p['position']}", {"name": p["name"], "position": p["position"], "stats": {}})
                        for k, v in p["stats"].items():
                            if isinstance(v, (int, float)):
                                acc["stats"][k] = acc["stats"].get(k, 0) + v

        def watch(side: str, key_stat: str, keys: list[str]) -> Optional[dict]:
            best = max(stat_sum[side].values(), key=lambda x: x["stats"].get(key_stat, 0), default=None)
            if not best or not best["stats"].get(key_stat):
                return None
            return {"name": best["name"], "position": best["position"], **{k: round(best["stats"].get(k, 0) / sims, 1) for k in keys}}

        avg = {s: sum(v) / sims for s, v in pts.items()}
        # Win odds: the simulated win rate (with a one-game prior so 20 of 20 is not "certain")
        # blended with a margin model (a 16-point favourite wins about 84% of the time in
        # college football), and never below 2% or above 98%: upsets happen.
        p_sims = (wins + 1) / (sims + 2)
        p_margin = 0.5 * (1 + math.erf((avg["home"] - avg["away"]) / (16 * math.sqrt(2))))
        p_home = max(0.02, min(0.98, 0.5 * p_sims + 0.5 * p_margin))
        pred = {"sims": sims, "home_win_prob": round(p_home, 2), "home_points": round(avg["home"], 1), "away_points": round(avg["away"], 1),
                "margin": round(round(avg["home"], 1) - round(avg["away"], 1), 1), "total": round(round(avg["home"], 1) + round(avg["away"], 1), 1),
                "watch": {side: {"passer": watch(side, "pass_yards", ["completions", "pass_attempts", "pass_yards", "passing_touchdowns", "interceptions_thrown"]),
                                 "rusher": watch(side, "rush_yards", ["carries", "rush_yards", "rushing_touchdowns"]),
                                 "receiver": watch(side, "receiving_yards", ["receptions", "receiving_yards", "receiving_touchdowns"])} for side in ("home", "away")}}
        _preview_cache.clear() if len(_preview_cache) > 64 else None
        _preview_cache[key] = pred
    mine, theirs = ("home", "away") if home else ("away", "home")
    prediction = {"sims": pred["sims"], "win_prob": pred["home_win_prob"] if home else round(1 - pred["home_win_prob"], 2),
                  "points_for": pred[f"{mine}_points"], "points_against": pred[f"{theirs}_points"],
                  "margin": round(pred[f"{mine}_points"] - pred[f"{theirs}_points"], 1), "total": pred["total"],
                  "watch": pred["watch"][mine], "their_watch": pred["watch"][theirs]}
    return {"team": slug, "team_name": teams[slug]["name"], "game": game, "prediction": prediction,
            "injuries": injury_report(state, slug)}


def team_schedule_view(state: dict, slug: str) -> dict:
    teams = load_teams()
    t = teams[slug]
    rec = _records(state, include_playoff=True)[slug]
    ranks = rank_map(state, state["current_week"]) if state["current_week"] else {}
    rk = None
    for w in range(state["current_week"], -1, -1):
        if str(w) in state["polls"]:
            rk = rank_map(state, w).get(slug)
            break
    return {"team": slug, "team_name": t["name"], "conference": t["conference"], "record": {"wins": rec["wins"], "losses": rec["losses"],
            "conf_wins": rec["conf_wins"], "conf_losses": rec["conf_losses"]}, "rank": rk, "schedule": team_schedule(state, slug)}


def summary(state: dict) -> dict:
    teams = load_teams()
    rec = _records(state)[state["team"]]
    schedule = team_schedule(state, state["team"])
    weeks = sorted({g["week"] for g in state["games"].values()} | {CCG_WEEK, SELECTION_WEEK} | set(PLAYOFF_WEEKS))
    return {
        "id": state["id"], "team": state["team"], "team_name": state["team_name"], "conference": state["conference"],
        "mode": state["mode"], "created_at": state["created_at"], "current_week": state["current_week"],
        "phase": state["phase"], "done": state["done"], "champion": state.get("champion"),
        "champion_name": teams[state["champion"]]["name"] if state.get("champion") else None,
        "record": rec, "schedule": schedule, "weeks": weeks, "my_rank": current_rank(state),
        "week_labels": {**{w: f"Week {w}" for w in range(1, LAST_REGULAR_WEEK + 1)}, CCG_WEEK: "Championship week",
                        SELECTION_WEEK: "Selection", **BOWL_WEEK_LABELS},
        "polls": state["polls"], "champions": state["champions"], "bracket": state["bracket"], "playoff": state["playoff"],
        "cfp_weeks": sorted(CFP_WEEKS), "bowls": bowl_view(state), "playoff_sites": state.get("playoff_sites"),
        "bowl_projection": bowl_projection(state),
        "week_dates": week_dates(state),
        "heisman": ((state.get("awards") or {}).get("national") or {}).get("heisman"),
        "settings": settings(state),
        "injuries": injury_report(state, state["team"]),
        "injury_count": sum(len(v) for v in state.get("injuries", {}).values()),
        "my_awards": awards.my_awards(state, state["awards"]) if state.get("awards") else [],
    }


def bowl_projection(state: dict) -> Optional[dict]:
    """Projected bowl lineup from the current committee ranking: each team's record is
    carried to the end of the regular season with rating-based win odds, the playoff
    field is the projected bracket (current conference leaders as champions), and the
    bowls then pick as they will on selection day. None until the first CFP ranking."""
    if state.get("bowls") or state["current_week"] < min(CFP_WEEKS):
        return None
    polls_state = state.get("polls", {})
    weeks = [w for w in range(state["current_week"], 0, -1) if polls_state.get(str(w), {}).get("cfp")]
    if not weeks:
        return None
    pw = weeks[0]
    p = polls_state[str(pw)]
    order = p.get("cfp_full") or [e["team"] for e in p["cfp"]]
    teams = load_teams()
    rec = _records(state)
    ratings = {slug: t["team_ratings"]["overall"] for slug, t in teams.items()}
    # carry every record through the regular season
    expected = {slug: 0.0 for slug in teams}
    for g in state["games"].values():
        if g["played"] or g["week"] > LAST_REGULAR_WEEK:
            continue
        edge = (ratings[g["home"]] - ratings[g["away"]]) / 60 + (0.0 if g["neutral"] else 0.04)
        p_home = max(0.08, min(0.92, 0.5 + edge))
        expected[g["home"]] += p_home
        expected[g["away"]] += 1 - p_home
    projected = {}
    for slug, r in rec.items():
        add = expected[slug]
        projected[slug] = {**r, "wins": r["wins"] + int(round(add)), "losses": r["losses"] + int(round(_remaining(state, slug) - add))}
    # projected champions: the current leader of each conference
    conf_of = {slug: t["conference"] for slug, t in teams.items()}
    leaders: dict[str, tuple] = {}
    for slug, t in teams.items():
        if t["fictional"]:
            continue
        r = rec[slug]
        cg = r["conf_wins"] + r["conf_losses"]
        key = (r["conf_wins"] / cg if cg else 0.0, r["wins"] / max(1, r["wins"] + r["losses"]), -order.index(slug) if slug in order else -99, ratings[slug])
        if t["conference"] not in leaders or key > leaders[t["conference"]][0]:
            leaders[t["conference"]] = (key, slug)
    champions = {conf: slug for conf, (_, slug) in leaders.items()}
    names = {slug: t["name"] for slug, t in teams.items()}
    try:
        bracket = polls.build_bracket(order, champions, conf_of, names)
        field = {x["team"] for x in bracket.get("seeds", [])}
    except Exception:  # noqa: BLE001
        field = set(order[:12])
    info = {b["bowl"]: b for b in bowls.load_bowls()["bowls"]}
    out = []
    for b in bowls.select_bowls(projected, teams, field, order, ratings):
        meta = info.get(b["bowl"], {})
        entry = {**b, "projected": True, "played": False, "has_box": False, "mine": state["team"] in (b.get("home"), b.get("away")),
                 "home_name": teams[b["home"]]["name"] if b.get("home") else None, "away_name": teams[b["away"]]["name"] if b.get("away") else None,
                 "home_record": f"{projected[b['home']]['wins']}-{projected[b['home']]['losses']}" if b.get("home") else None,
                 "away_record": f"{projected[b['away']]['wins']}-{projected[b['away']]['losses']}" if b.get("away") else None,
                 "home_conference": conf_of.get(b.get("home")), "away_conference": conf_of.get(b.get("away")),
                 "games_played": meta.get("games_played"), "first_played": meta.get("first_played")}
        out.append(entry)
    out.sort(key=lambda b: (b["week"], b["date"] or "", b["time"] or ""))
    return {"week": pw, "bowls": out, "playoff": sorted(field, key=lambda s: order.index(s) if s in order else 99)}


def _remaining(state: dict, slug: str) -> int:
    return sum(1 for g in state["games"].values() if not g["played"] and g["week"] <= LAST_REGULAR_WEEK and slug in (g["home"], g["away"]))


def bowl_view(state: dict) -> list[dict]:
    """Every bowl of the season with its matchup, result, tie-ins and history."""
    teams = load_teams()
    info = {b["bowl"]: b for b in bowls.load_bowls()["bowls"]}
    rec = _records(state)
    out = []
    for b in state.get("bowls", []):
        g = state["games"].get(b["event_id"])
        meta = info.get(b["bowl"], {})
        out.append({**b, "home_name": teams[b["home"]]["name"] if b.get("home") else None,
                    "away_name": teams[b["away"]]["name"] if b.get("away") else None,
                    "home_conference": teams[b["home"]]["conference"] if b.get("home") else None,
                    "away_conference": teams[b["away"]]["conference"] if b.get("away") else None,
                    "home_record": f"{rec[b['home']]['wins']}-{rec[b['home']]['losses']}" if b.get("home") else None,
                    "away_record": f"{rec[b['away']]['wins']}-{rec[b['away']]['losses']}" if b.get("away") else None,
                    "played": bool(g and g["played"]), "home_score": g["home_score"] if g else None, "away_score": g["away_score"] if g else None,
                    "overtime": (g.get("overtime") or 0) if g else 0,
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


# ----- player profiles --------------------------------------------------------------------
# Everything about one player: bio and ratings from the roster, season totals, league and
# conference ranks, the game log (your own team's games keep full box scores), honors.

# the ratings that matter at each position, most important first: the player card shows
# these; the All ratings view shows everything the player carries
POSITION_RATINGS = {
    "QB": ["passing", "decision_making", "intelligence", "speed", "elusiveness", "strength", "endurance"],
    "RB": ["speed", "elusiveness", "vision", "strength", "hands", "pass_blocking", "endurance"],
    "WR": ["hands", "route_running", "speed", "elusiveness", "run_blocking", "strength", "endurance"],
    "TE": ["hands", "route_running", "run_blocking", "pass_blocking", "speed", "strength", "endurance"],
    "OL": ["run_blocking", "pass_blocking", "strength", "intelligence", "speed", "endurance"],
    "DL": ["rushing", "tackling", "strength", "speed", "intelligence", "endurance"],
    "MLB": ["tackling", "rushing", "coverage", "speed", "intelligence", "strength", "endurance"],
    "ROLB": ["tackling", "rushing", "coverage", "speed", "intelligence", "strength", "endurance"],
    "LOLB": ["tackling", "rushing", "coverage", "speed", "intelligence", "strength", "endurance"],
    "CB": ["coverage", "speed", "tackling", "hands", "intelligence", "endurance"],
    "S": ["coverage", "tackling", "speed", "hands", "intelligence", "strength", "endurance"],
    "K": ["kick_power", "kick_accuracy"],
    "P": ["punt_power", "punt_accuracy"],
}
RATING_LABELS = [("speed", "Speed"), ("strength", "Strength"), ("intelligence", "Awareness"), ("endurance", "Stamina"),
                 ("passing", "Passing"), ("decision_making", "Decisions"), ("elusiveness", "Elusiveness"), ("vision", "Vision"),
                 ("hands", "Hands"), ("route_running", "Route running"), ("run_blocking", "Run blocking"), ("pass_blocking", "Pass blocking"),
                 ("rushing", "Pass rush"), ("tackling", "Tackling"), ("coverage", "Coverage"), ("kick_power", "Kick power"),
                 ("kick_accuracy", "Kick accuracy"), ("punt_power", "Punt power"), ("punt_accuracy", "Punt accuracy"), ("return_rating", "Returns")]
CLASS_NAMES = {"FR": "Freshman", "FRRS": "Redshirt freshman", "SO": "Sophomore", "SORS": "Redshirt sophomore", "JR": "Junior",
               "JRRS": "Redshirt junior", "SR": "Senior", "SRRS": "Redshirt senior"}

# ----- settings and god mode -----------------------------------------------------------

DEFAULT_SETTINGS = {"god_mode": False, "morale": False}   # new seasons turn morale on (see new_season)
DEV_TRAITS = ("Normal", "Impact", "Star", "Elite")
EDITABLE_RATINGS = tuple(k for k, _ in RATING_LABELS)
EDITABLE_FIELDS = EDITABLE_RATINGS + ("jersey", "class", "height", "weight", "dev_trait")


def settings(state: dict) -> dict:
    return {**DEFAULT_SETTINGS, **(state.get("settings") or {})}


def update_settings(state: dict, changes: dict) -> dict:
    cur = settings(state)
    for k, v in changes.items():
        if k in DEFAULT_SETTINGS and v is not None:
            cur[k] = bool(v) if isinstance(DEFAULT_SETTINGS[k], bool) else v
    state["settings"] = cur
    return cur


# ----- morale: form carried from game to game -------------------------------------------
# Each team and each player carries a value between -1 and 1. A team's moves with results
# (wins, losses, upsets, blowouts); a player's with how his game compared with his season
# so far. Both fade week by week. Entering a game, ratings scale by a few percent either
# way; inside the game, momentum takes over play by play (engine/game_config.MOMENTUM).

MORALE_PLAYER_EFFECT = 0.06      # a hot player is up to 6% better, a cold one 6% worse
MORALE_TEAM_EFFECT = 0.03        # a team riding high adds up to 3% to everyone
MORALE_WEEKLY_DECAY = 0.85
MORALE_HOT = 0.35                # form above this is a hot streak, below minus this a cold one


def morale_on(state: dict) -> bool:
    return bool(settings(state).get("morale"))


def _morale_store(state: dict) -> dict:
    return state.setdefault("morale", {"teams": {}, "players": {}})


def team_morale(state: dict, slug: str) -> float:
    return float((state.get("morale") or {}).get("teams", {}).get(slug, 0.0))


def player_form(state: dict, slug: str, name: str, position: str) -> float:
    return float(((state.get("morale") or {}).get("players", {}).get(slug) or {}).get(f"{name}|{position}", 0.0))


def morale_factor(state: dict, slug: str, name: str, position: str) -> float:
    """How a player's ratings scale entering the next game."""
    if not morale_on(state):
        return 1.0
    f = 1.0 + MORALE_PLAYER_EFFECT * player_form(state, slug, name, position) + MORALE_TEAM_EFFECT * team_morale(state, slug)
    return max(0.9, min(1.1, f))


def morale_payload(state: dict, slug: str) -> Optional[dict]:
    """What a game needs for one team: the team value and every player's form."""
    if not morale_on(state):
        return None
    return {"team": team_morale(state, slug), "players": dict((state.get("morale") or {}).get("players", {}).get(slug) or {})}


def with_morale(team: dict, morale: Optional[dict]) -> dict:
    """A copy of the team with every player's ratings scaled by his form and the team's mood."""
    if not morale:
        return team
    tm = morale.get("team", 0.0)
    players = morale.get("players") or {}
    if not tm and not players:
        return team
    out = {**team}
    for unit in ("offense", "defense"):
        rows = []
        for p in team[unit]:
            form = players.get(f"{p['name']}|{p['position']}", 0.0)
            f = max(0.9, min(1.1, 1.0 + MORALE_PLAYER_EFFECT * form + MORALE_TEAM_EFFECT * tm))
            if abs(f - 1.0) < 0.004:
                rows.append(p)
                continue
            q = dict(p)
            for k, _ in RATING_LABELS:
                v = p.get(k)
                if isinstance(v, (int, float)):
                    q[k] = max(1, min(99, round(v * f)))
            rows.append(q)
        out[unit] = rows
    return out


def _perf_score(position: str, st: dict) -> float:
    """One number for a game (or a per-game average) at a position, on a points-like scale."""
    n = lambda k: st.get(k, 0) or 0
    if position == "QB":
        return n("pass_yards") * 0.04 + n("passing_touchdowns") * 4 - n("interceptions_thrown") * 4 + n("rush_yards") * 0.1 + n("rushing_touchdowns") * 6 - n("fumbles") * 3
    if position in ("RB", "WR", "TE"):
        return n("rush_yards") * 0.1 + n("receiving_yards") * 0.1 + (n("rushing_touchdowns") + n("receiving_touchdowns")) * 6 - n("fumbles") * 4
    if position == "OL":
        return n("key_blocks") * 2 - n("sacks_allowed") * 3 - n("pressures_allowed") * 0.5 - n("stuffs_allowed") * 0.5 + n("snaps") * 0.05
    if position in ("DL", "MLB", "ROLB", "LOLB", "CB", "S"):
        return n("solo_tackles") + n("assisted_tackles") * 0.5 + n("tackles_for_loss") * 2 + n("sacks") * 4 + n("interceptions") * 6 + n("passes_defended") * 1.5 + n("forced_fumbles") * 4 + n("fumble_recoveries") * 2
    if position == "K":
        return n("fg_made") * 3 - (n("fg_attempted") - n("fg_made")) * 4 + n("pat_made") * 0.5 - (n("pat_attempts") - n("pat_made")) * 2
    return 0.0


def _decay_morale(state: dict) -> None:
    """A week passes: every team's mood and every player's form fade toward neutral."""
    if not morale_on(state):
        return
    m = _morale_store(state)
    m["teams"] = {k: round(v * MORALE_WEEKLY_DECAY, 4) for k, v in m["teams"].items() if abs(v * MORALE_WEEKLY_DECAY) >= 0.02}
    for slug, rows in list(m["players"].items()):
        kept = {k: round(v * MORALE_WEEKLY_DECAY, 4) for k, v in rows.items() if abs(v * MORALE_WEEKLY_DECAY) >= 0.02}
        if kept:
            m["players"][slug] = kept
        else:
            del m["players"][slug]


def _update_morale(state: dict, g: dict, lines: dict, before: dict[str, int]) -> None:
    """After a game: the result moves both teams' moods; each player's game against his
    season so far moves his form. `before` is the ranking entering the week."""
    if not morale_on(state) or g.get("real"):
        return
    m = _morale_store(state)
    teams = m["teams"]
    margin = g["home_score"] - g["away_score"]
    for side, opp in (("home", "away"), ("away", "home")):
        slug, other = g[side], g[opp]
        won = (margin > 0) if side == "home" else (margin < 0)
        own_margin = margin if side == "home" else -margin
        delta = 0.25 if won else -0.25
        if won and before.get(other):
            delta += 0.15
        if not won and before.get(slug) and not before.get(other):
            delta -= 0.15
        if abs(own_margin) >= 21:
            delta += 0.1 if won else -0.1
        teams[slug] = round(max(-1.0, min(1.0, teams.get(slug, 0.0) + delta)), 4)
        # players: this game against the per-game average before it
        ss = (state.get("season_stats") or {}).get(slug, {})
        rows = m["players"].setdefault(slug, {})
        for p in lines[side].get("players", []):
            key = f"{p['name']}|{p['position']}"
            game = _perf_score(p["position"], p["stats"])
            line = (ss.get("players") or {}).get(key)
            games = line["games"] if line else 1
            if games > 1:
                prior = {k: (v - p["stats"].get(k, 0)) for k, v in line["stats"].items() if isinstance(v, (int, float))}
                avg = _perf_score(p["position"], prior) / (games - 1)
                z = (game - avg) / max(abs(avg) * 0.6, 4.0)
            else:
                z = 0.0
            z = max(-1.0, min(1.0, z)) + (0.1 if won else -0.1)
            form = round(max(-1.0, min(1.0, 0.7 * rows.get(key, 0.0) + 0.3 * z)), 4)
            if abs(form) >= 0.02:
                rows[key] = form
            else:
                rows.pop(key, None)
        if not rows:
            m["players"].pop(slug, None)


def morale_view(state: dict, slug: str, name: str, position: str) -> dict:
    """The player card's morale block: form, the team's mood and the boost each gives."""
    on = morale_on(state)
    form = player_form(state, slug, name, position) if on else 0.0
    tm = team_morale(state, slug) if on else 0.0
    label = "Hot streak" if form >= MORALE_HOT else "Cold streak" if form <= -MORALE_HOT else "Steady"
    team_label = "Team riding high" if tm >= MORALE_HOT else "Team in a slump" if tm <= -MORALE_HOT else ""
    return {"enabled": on, "form": round(form, 2), "team": round(tm, 2), "factor": round(morale_factor(state, slug, name, position), 3),
            "label": label, "team_label": team_label}


def player_edits(state: dict, slug: str) -> dict:
    """God-mode edits for one team: player slug -> {field: value}."""
    return (state.get("player_edits") or {}).get(slug) or {}


def with_edits(team: dict, edits: Optional[dict]) -> dict:
    """A copy of the team with god-mode edits merged into its players."""
    if not edits:
        return team
    out = {**team}
    for unit in ("offense", "defense"):
        out[unit] = [dict(p, **edits[p["slug"]]) if p.get("slug") in edits else p for p in team[unit]]
    return out


def team_data(state: dict, slug: str) -> dict:
    """The team as this season sees it: the base data plus any god-mode edits."""
    return with_edits(load_teams()[slug], player_edits(state, slug))


def edit_player(state: dict, slug: str, player_slug: str, changes: dict) -> dict:
    """Store god-mode changes to one player. Ratings are whole numbers 0-99; the class, the
    development trait and the size must be real values. Names and positions stay as they
    are (the season's stats are keyed on them). Returns the stored edits for the player."""
    team = load_teams().get(slug)
    if team is None:
        raise ValueError("unknown team")
    base = next((p for p in team["offense"] + team["defense"] if p.get("slug") == player_slug), None)
    if base is None:
        raise ValueError("unknown player")
    cur = dict(player_edits(state, slug).get(player_slug) or {})
    for k, v in changes.items():
        if k not in EDITABLE_FIELDS:
            raise ValueError(f"{k} cannot be edited")
        if k in EDITABLE_RATINGS:
            if not isinstance(base.get(k), (int, float)):
                raise ValueError(f"{base['name']} has no {k} rating")
            try:
                v = int(round(float(v)))
            except (TypeError, ValueError):
                raise ValueError(f"{k} must be a number")
            v = engine_rating(base, k, max(0, min(99, v)))   # the form shows the EA scale; the engine keeps its own
        elif k == "class":
            if v not in CLASS_NAMES:
                raise ValueError("class must be one of " + ", ".join(CLASS_NAMES))
        elif k == "dev_trait":
            if v not in DEV_TRAITS:
                raise ValueError("development trait must be one of " + ", ".join(DEV_TRAITS))
        elif k == "weight":
            try:
                v = max(150, min(400, int(v)))
            except (TypeError, ValueError):
                raise ValueError("weight must be a number")
        else:
            v = str(v).strip()[:12]
        if base.get(k) == v:
            cur.pop(k, None)
        else:
            cur[k] = v
    edits = state.setdefault("player_edits", {}).setdefault(slug, {})
    if cur:
        edits[player_slug] = cur
    else:
        edits.pop(player_slug, None)
    return cur

# the stats a position is ranked on: (stat key or derived name, label, higher is better, minimum qualifier)
RANK_STATS = {
    "QB": [("pass_yards", "Passing yards"), ("passing_touchdowns", "Passing TDs"), ("rating", "Passer rating"), ("completion_pct", "Completion %"),
           ("rush_yards", "Rushing yards"), ("total_touchdowns", "Total TDs")],
    "RB": [("rush_yards", "Rushing yards"), ("rushing_touchdowns", "Rushing TDs"), ("yards_per_carry", "Yards per carry"), ("receiving_yards", "Receiving yards"),
           ("scrimmage_yards", "Scrimmage yards"), ("explosive_runs", "Runs of 20+")],
    "WR": [("receiving_yards", "Receiving yards"), ("receptions", "Receptions"), ("receiving_touchdowns", "Receiving TDs"), ("yards_per_catch", "Yards per catch"),
           ("explosive_catches", "Catches of 25+")],
    "TE": [("receiving_yards", "Receiving yards"), ("receptions", "Receptions"), ("receiving_touchdowns", "Receiving TDs")],
    "OL": [("snaps", "Snaps"), ("key_blocks", "Key blocks"), ("sacks_allowed", "Sacks allowed")],
    "DEF": [("tackles", "Tackles"), ("tackles_for_loss", "Tackles for loss"), ("sacks", "Sacks"), ("interceptions", "Interceptions"),
            ("passes_defended", "Passes defended"), ("forced_fumbles", "Forced fumbles")],
    "K": [("fg_made", "Field goals"), ("points", "Points"), ("fg_pct", "Field goal %"), ("long_fg", "Long field goal")],
    "P": [("punt_avg", "Punt average"), ("net_avg", "Net average"), ("punts_inside_20", "Inside the 20")],
}
RANK_MINIMUM = {"rating": ("pass_attempts", 100), "completion_pct": ("pass_attempts", 100), "yards_per_carry": ("carries", 60),
                "yards_per_catch": ("receptions", 20), "fg_pct": ("fg_attempted", 8), "punt_avg": ("punts", 15), "net_avg": ("punts", 15)}
LOWER_IS_BETTER = {"sacks_allowed"}


def derived_stat(st: dict, key: str) -> Optional[float]:
    get = st.get
    if key == "rating":
        return awards.passer_rating(st) if get("pass_attempts") else None
    if key == "completion_pct":
        return 100 * get("completions", 0) / get("pass_attempts") if get("pass_attempts") else None
    if key == "total_touchdowns":
        return get("passing_touchdowns", 0) + get("rushing_touchdowns", 0) + get("receiving_touchdowns", 0)
    if key == "yards_per_carry":
        return get("rush_yards", 0) / get("carries") if get("carries") else None
    if key == "scrimmage_yards":
        return get("rush_yards", 0) + get("receiving_yards", 0)
    if key == "yards_per_catch":
        return get("receiving_yards", 0) / get("receptions") if get("receptions") else None
    if key == "tackles":
        return get("solo_tackles", 0) + get("assisted_tackles", 0)
    if key == "points":
        return 3 * get("fg_made", 0) + get("pat_made", 0)
    if key == "fg_pct":
        return 100 * get("fg_made", 0) / get("fg_attempted") if get("fg_attempted") else None
    if key == "punt_avg":
        return get("punt_yards", 0) / get("punts") if get("punts") else None
    if key == "net_avg":
        return get("punt_net_yards", 0) / get("punts") if get("punts") else None
    v = get(key)
    return float(v) if isinstance(v, (int, float)) else None


def _rank_group(position: str) -> str:
    return "DEF" if position in ("DL", "MLB", "ROLB", "LOLB", "OLB", "CB", "S") else position


def player_ranks(state: dict, teams: dict, team: str, name: str, position: str) -> list[dict]:
    """Where the player's main numbers rank among FBS players at his position group, and
    within his conference."""
    ss = state.get("season_stats", {})
    group = _rank_group(position)
    specs = RANK_STATS.get(group, [])
    if not specs:
        return []
    conf = teams[team]["conference"]
    rows = []
    for slug, ts in ss.items():
        info = teams.get(slug)
        if not info or info["fictional"]:
            continue
        for p in ts["players"].values():
            if _rank_group(p["position"]) != group:
                continue
            rows.append((slug, info["conference"], p["name"], p["position"], p["stats"]))
    out = []
    for key, label in specs:
        qual = RANK_MINIMUM.get(key)
        vals = []
        mine = None
        for slug, c, n, pos, st in rows:
            if qual and st.get(qual[0], 0) < qual[1]:
                continue
            v = derived_stat(st, key)
            if v is None or (not qual and v == 0):
                continue
            vals.append((v, slug, c))
            if slug == team and n == name and pos == position:
                mine = v
        if mine is None:
            continue
        better = (lambda a, b: a < b) if key in LOWER_IS_BETTER else (lambda a, b: a > b)
        fbs_rank = 1 + sum(1 for v, _, _ in vals if better(v, mine))
        conf_rank = 1 + sum(1 for v, _, c in vals if c == conf and better(v, mine))
        conf_n = sum(1 for _, _, c in vals if c == conf)
        out.append({"key": key, "label": label, "value": round(mine, 1) if isinstance(mine, float) and mine != int(mine) else int(mine),
                    "fbs_rank": fbs_rank, "fbs_n": len(vals), "conf_rank": conf_rank, "conf_n": conf_n})
    return out


def player_honors(state: dict, team: str, name: str) -> list[dict]:
    """Awards, finalist spots, All-America and all-conference selections, Heisman finish."""
    aw = state.get("awards") or {}
    out = []

    def hit(c: Optional[dict]) -> bool:
        return bool(c) and c.get("team") == team and c.get("name") == name

    nat = aw.get("national") or {}
    h = nat.get("heisman") or {}
    for i, c in enumerate(h.get("candidates", [])):
        if hit(c):
            place = "Heisman Trophy winner" if i == 0 else f"{i + 1}{'th' if 4 <= i + 1 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get((i + 1) % 10, 'th')} in the Heisman vote"
            out.append({"stage": "Heisman", "award": "Heisman Trophy", "place": place + (" (finalist)" if i and c in h.get("finalists", []) else ""), "detail": f"{c['points']} points"})
    for a in nat.get("awards", []) + (aw.get("postseason") or {}).get("awards", []):
        if hit(a.get("winner")):
            out.append({"stage": "National awards", "award": a["name"], "place": "winner", "detail": a.get("honors", "")})
        else:
            for c in a.get("finalists", [])[1:]:
                if hit(c):
                    out.append({"stage": "National awards", "award": a["name"], "place": "finalist", "detail": a.get("honors", "")})
    aa = nat.get("all_america") or {}
    for c in aa.get("consensus", []):
        if hit(c):
            out.append({"stage": "All-America", "award": "Consensus All-American" + (" (unanimous)" if c.get("unanimous") else ""), "place": c["slot"], "detail": f"first team on {c['selectors']} of 5 selectors"})
    for sel, picks in (aa.get("selectors") or {}).items():
        for c in picks:
            if hit(c):
                out.append({"stage": "All-America", "award": f"{sel} All-America", "place": f"{'first' if c['level'] == 1 else 'second'} team ({c['slot']})", "detail": ""})
    for conf, entry in (aw.get("conference") or {}).items():
        for a in entry.get("awards", []):
            if hit(a.get("winner")):
                out.append({"stage": f"{conf} awards", "award": a["name"], "place": "winner", "detail": ""})
            else:
                for c in a.get("finalists", [])[1:]:
                    if hit(c):
                        out.append({"stage": f"{conf} awards", "award": a["name"], "place": "finalist", "detail": ""})
        for sel, picks in (entry.get("teams") or {}).get("selectors", {}).items():
            for c in picks:
                if hit(c):
                    out.append({"stage": f"All-{conf}", "award": f"{sel} {['first', 'second', 'third'][c['level'] - 1]} team", "place": c["slot"], "detail": ""})
    return out


def player_game_log(state: dict, team: str, name: str, position: str) -> Optional[list[dict]]:
    """Per-game lines from the box scores the season keeps (your own team's games)."""
    if team != state["team"]:
        return None
    out = []
    for eid, box in state["my_boxes"].items():
        g = state["games"].get(eid)
        if not g:
            continue
        side = "home" if g["home"] == team else "away"
        p = next((x for x in box[side]["players"] if x["name"] == name and x["position"] == position), None)
        if not p:
            continue
        opp = g["away"] if side == "home" else g["home"]
        pf, pa = (g["home_score"], g["away_score"]) if side == "home" else (g["away_score"], g["home_score"])
        out.append({"event_id": eid, "week": g["week"], "title": g.get("title"), "opponent": opp,
                    "opponent_name": g["away_display"] if side == "home" else g["home_display"],
                    "venue": "neutral" if g["neutral"] else ("home" if side == "home" else "away"),
                    "won": pf > pa, "points_for": pf, "points_against": pa, "stats": p["stats"], "started": bool(p.get("starter"))})
    out.sort(key=lambda r: r["week"])
    return out


_STAR_CUTS: Optional[list[int]] = None


def recruit_stars(p: dict) -> int:
    """Recruiting stars estimated from the player's rating against the whole FBS player
    pool (the rosters carry no recruiting rankings): the top 1% are five stars, the next
    12% four, the next 60% three, the rest two."""
    global _STAR_CUTS
    if _STAR_CUTS is None:
        vals = sorted((shown_overall(x) for t in load_teams().values() if not t["fictional"] for x in t["offense"] + t["defense"]), reverse=True)
        n = max(1, len(vals))
        _STAR_CUTS = [vals[min(n - 1, int(n * q))] for q in (0.01, 0.13, 0.73)]
    o = shown_overall(p)
    return 5 if o >= _STAR_CUTS[0] else 4 if o >= _STAR_CUTS[1] else 3 if o >= _STAR_CUTS[2] else 2


def player_profile(state: dict, team: str, name: Optional[str] = None, position: Optional[str] = None,
                   slug: Optional[str] = None) -> Optional[dict]:
    teams = load_teams()
    t = teams.get(team)
    if not t:
        return None
    t = with_edits(t, player_edits(state, team))
    roster = t["offense"] + t["defense"]
    p = next((x for x in roster if (slug and x.get("slug") == slug) or (name and x["name"] == name and (not position or x["position"] == position))), None)
    if not p:
        return None
    name, position = p["name"], p["position"]
    ss = state.get("season_stats", {}).get(team, {})
    line = (ss.get("players") or {}).get(f"{name}|{position}")
    stats = dict(line["stats"]) if line else {}
    mf = morale_factor(state, team, name, position)
    base_p = next((x for x in teams[team]["offense"] + teams[team]["defense"] if x.get("slug") == p.get("slug")), p)
    ratings = [{"key": k, "label": lbl, "value": display_rating(p, k),
                "boost": display_rating(p, k, max(1, min(99, round(p[k] * mf)))) - display_rating(p, k)}
               for k, lbl in RATING_LABELS if isinstance(p.get(k), (int, float)) and p.get(k) is not None]
    have = {r["key"] for r in ratings}
    key_ratings = [k for k in POSITION_RATINGS.get(position, []) if k in have]
    if p.get("slug") and p["slug"] in (t.get("kick_returner"), t.get("punt_returner")) and "return_rating" in have:
        key_ratings.append("return_rating")
    injuries = state.get("injuries") or {}
    injured = False
    for entry in (injuries.get(team) or []) if isinstance(injuries, dict) else []:
        n = entry[0] if isinstance(entry, (list, tuple)) else (entry.get("name") if isinstance(entry, dict) else None)
        if n == name:
            injured = True
    hc = (t.get("coaches") or {}).get("head_coach") or {}
    rec = _records(state)[team]
    return {
        "name": name, "slug": p.get("slug"), "position": position, "role": p.get("role"), "depth": p.get("depth"),
        "class": p.get("class"), "class_name": CLASS_NAMES.get(p.get("class") or "", p.get("class")), "height": p.get("height"),
        "weight": p.get("weight"), "jersey": p.get("jersey"), "dev_trait": p.get("dev_trait"), "starter": bool(p.get("in_game")),
        "injured": injured, "overall": shown_overall(p, base_p), "stars": recruit_stars(base_p), "ratings": ratings,
        "edited": sorted(player_edits(state, team).get(p.get("slug"), {}).keys()), "editable_classes": list(CLASS_NAMES), "dev_traits": list(DEV_TRAITS),
        "key_ratings": key_ratings,
        "morale": morale_view(state, team, name, position),
        "ratings_at": {k: int(v) for k, v in (p.get("ratings_at") or {}).items() if isinstance(v, (int, float))},
        "team": {"slug": team, "name": t["name"], "conference": t["conference"], "coach": hc.get("name"),
                 "record": f"{rec['wins']}-{rec['losses']}", "rank": awards.Pool(state, teams, _records(state)).rank_of(team) if ss else None},
        "games": line["games"] if line else 0, "team_games": ss.get("games", 0), "stats": stats,
        "rating": awards.passer_rating(stats) if stats.get("pass_attempts") else None,
        "ranks": player_ranks(state, teams, team, name, position) if line else [],
        "game_log": player_game_log(state, team, name, position),
        "honors": player_honors(state, team, name),
    }
