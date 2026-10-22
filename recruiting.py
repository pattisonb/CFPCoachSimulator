"""Coach Career recruiting (docs/superpowers/specs/2026-10-22-coach-career-design.md, sections
2-5): a generated class of high school seniors, every FBS school's pull on each of them, and
(later sections of this file) the actions, the weekly step, signing and scouting.

The recruiting state lives in `state["recruiting"]` (a Coach Career season only):
    year, prospects {pid: prospect}, lists {pid: {slug: action points}}, status {pid: {committed,
    signed, fcs}}, offers {slug: [pid]}, visits {pid: {slug: week}}, contacts {pid: {slug:
    {hc_week}}}, hours {slug: hours left}, nil {slug: {budget, held {pid: points}}},
    revealed {slug: {pid: [topic]}}, board [pid], log [event]
A prospect's interest in a school = his priorities' weights on the school's pulls (each 0-1)
plus the points that school's actions have earned with him.

Values marked *tune* are set by tools/check_recruiting.py against the real classes.
"""
from __future__ import annotations

import math
import random
from functools import lru_cache
from pathlib import Path
from typing import Optional

import recruits

ROOT = Path(__file__).resolve().parent
PITCHES = ("proximity", "playing_time", "prestige", "winning", "nil", "coach", "academics")
# how often each topic is a prospect's priority (drawn without replacement for his top three) *tune*
PRIORITY_ODDS = {"proximity": 0.20, "playing_time": 0.18, "prestige": 0.16, "winning": 0.14, "nil": 0.14,
                 "coach": 0.12, "academics": 0.06}
PRIORITY_WEIGHTS = (0.35, 0.25, 0.15)      # his first, second and third priority; the rest share 0.25 *tune*
OTHER_WEIGHT = 0.25
PULL_SCALE = 10.0                          # interest points for a pull of 1.0 at full weight *tune*
PROXIMITY_MILES = 350.0                    # distance pull exp(-miles / this) *tune*
PROXIMITY_FLOOR = 0.05
LAST_SEASON_WEIGHT = ((0, 0.8), (7, 0.3), (15, 0.05))   # (week, weight on last season), linear between
POLL_BUMP = ((10, 0.15), (25, 0.07))       # (rank at or better, bump) on this season's standing
STARTERS = {"QB": 1, "RB": 1, "WR": 3, "TE": 1, "OL": 5, "DL": 4, "LB": 3, "CB": 2, "S": 2, "K": 1, "P": 1}
LEAVING = {"SR", "SRRS"}                   # seniors: gone after the season (the open spots rule)
# schools whose academics recruits weigh (a pull of 0.9); every other school 0.5
# the nine recruiting areas staff are assigned to (spec section 6)
AREAS = {
    "Texas": ["TX"],
    "Florida": ["FL"],
    "Georgia-Carolinas": ["GA", "SC", "NC"],
    "Deep South": ["AL", "MS", "LA", "TN", "AR"],
    "Mid-Atlantic": ["VA", "MD", "DC", "DE", "PA", "NJ", "WV"],
    "Northeast": ["NY", "CT", "MA", "RI", "VT", "NH", "ME"],
    "Midwest": ["OH", "MI", "IN", "IL", "WI", "MN", "IA", "MO", "KY", "KS", "NE", "ND", "SD"],
    "West Coast": ["CA", "OR", "WA", "HI", "AK"],
    "Mountain-Southwest": ["AZ", "NV", "UT", "CO", "NM", "ID", "MT", "WY", "OK"],
}
HOURS = {"message": 5, "call": 15, "hc_visit": 30, "offer": 0, "official_visit": 10, "pull_offer": 0}
BASE_POINTS = {"message": 1.0, "call": 2.5, "hc_visit": 6.0, "offer": 4.0, "official_visit": 8.0}   # *tune*
PITCH_MATCH, PITCH_MISS = 2.0, 0.5         # a pitch on one of his three priorities, any other topic
DIMINISH = 0.2                             # each earlier contact from the school cuts a new one's worth *tune*
HC_VISIT_GAP = 4                           # weeks between head coach in-home visits to one prospect
NIL_VALUE = {5: 0.04, 4: 0.07, 3: 0.12, 2: 0.15}   # interest per NIL point by stars: top prospects expect more *tune*
NIL_FLOOR = 30
ROSTER_LIMIT = 85                          # the game's rosters carry the 85 scholarship players
MIN_OPEN = 12
OFFER_FACTOR = 1.5
ACADEMIC = {"stanford", "notre-dame", "northwestern", "duke", "vanderbilt", "rice", "california", "ucla", "michigan",
            "virginia", "georgia-tech", "wake-forest", "boston-college", "navy", "army", "air-force", "usc", "north-carolina"}


@lru_cache(maxsize=1)
def model() -> dict:
    return recruits.model()


def _miles(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 3958.8 * 2 * math.asin(math.sqrt(h))


def _logistic(x: float) -> float:
    return 1 / (1 + math.exp(-x))


def _interp(points: tuple, x: float) -> float:
    if x <= points[0][0]:
        return points[0][1]
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        if x <= x1:
            return y0 + (x - x0) * (y1 - y0) / (x1 - x0)
    return points[-1][1]


def _team_model(slug: str) -> dict:
    return model()["teams"].get(slug) or {}


def _baseline(slug: str) -> float:
    return ((_team_model(slug).get("strength") or {}).get("baseline")) or -1.0


def fbs_schools(state: dict) -> list[str]:
    import season
    return sorted(s for s, t in season.load_teams().items() if not t.get("fictional") and s in model()["teams"])


# ----- the class ---------------------------------------------------------------------------------

def _home(p: dict) -> list[float]:
    h = p["hometown"]
    if h.get("lat") is not None:
        return [h["lat"], h["lon"]]
    towns = model()["generation"]["towns"].get(h.get("state")) or []
    return [towns[0][2], towns[0][3]] if towns and towns[0][2] is not None else [39.8, -98.6]


def _priorities(pid: str) -> list[str]:
    rng = random.Random(f"priorities-{pid}")
    topics, odds = list(PRIORITY_ODDS), list(PRIORITY_ODDS.values())
    out = []
    for _ in range(3):
        t = rng.choices(topics, weights=odds)[0]
        i = topics.index(t)
        topics.pop(i)
        odds.pop(i)
        out.append(t)
    return out


def start(state: dict, year: int = 2027) -> None:
    """Give a Coach Career its class of high school seniors (recruits.generate_class) and an empty
    recruiting board. Nobody is committed at the start."""
    import season
    taken = {p["name"].lower() for t in season.load_teams().values() for p in t["offense"] + t["defense"]}
    cls = recruits.generate_class(year, seed=state.get("rng_state", 0), taken=taken)
    prospects = {}
    for p in cls:
        p["priorities"] = _priorities(p["id"])
        p["home"] = _home(p)
        prospects[p["id"]] = p
    state["recruiting"] = {
        "year": year, "prospects": prospects, "lists": {pid: {} for pid in prospects},
        "status": {pid: {"committed": None, "signed": None, "fcs": False} for pid in prospects},
        "offers": {}, "visits": {}, "contacts": {}, "hours": {}, "nil": {}, "revealed": {}, "board": [], "log": [],
    }


# ----- what pulls a prospect to a school -----------------------------------------------------------

def _group(ea_position: str) -> str:
    import build_teams
    pos = build_teams.POSITION_MAP.get(ea_position, ea_position)
    return "LB" if pos in ("MLB", "ROLB", "LOLB") else pos


def _ahead(slug: str, group: str, overall_ea: float) -> int:
    """Returning players at his position group on that roster rated at least as high as him."""
    import season
    t = season.load_teams()[slug]
    n = 0
    for p in t["offense"] + t["defense"]:
        pos = "LB" if p["position"] in ("MLB", "ROLB", "LOLB") else p["position"]
        if pos == group and p.get("class") not in LEAVING and (p.get("ea_overall") or 0) >= overall_ea:
            n += 1
    return n


def _coach_edge(state: dict, slug: str) -> float:
    if slug == state.get("team") and (state.get("coach") or {}).get("ratings"):
        return ((state["coach"]["ratings"].get("recruiting", 50)) - 50) / 160      # your created coach
    cur = (model()["coaches"]["current"].get(slug) or {})
    return cur.get("edge") or 0.0


def pull(state: dict, slug: str, pid: str) -> dict[str, float]:
    """The school's pull on the prospect by topic, each 0-1."""
    p = state["recruiting"]["prospects"][pid]
    loc = _team_model(slug).get("location")
    miles = _miles(tuple(p["home"]), tuple(loc)) if loc else 1500.0
    group = _group(p["ea_position"])
    starters = STARTERS.get(group, 2)
    z = _baseline(slug)
    return {
        "proximity": max(PROXIMITY_FLOOR, math.exp(-miles / PROXIMITY_MILES)),
        "playing_time": max(0.1, 1 - _ahead(slug, group, p["overall_ea"]) / (2 * starters + 1)),
        "prestige": _logistic(1.2 * z),
        "winning": min(1.0, on_field(state, slug, state["current_week"])),
        "nil": _logistic(1.4 * z),
        "coach": min(1.0, max(0.0, 0.5 + 1.5 * _coach_edge(state, slug))),
        "academics": 0.9 if slug in ACADEMIC else 0.5,
    }


def on_field(state: dict, slug: str, week: int) -> float:
    """Last season blended with this one, this season counting more every week (spec section 3)."""
    import season
    ls = _team_model(slug).get("last_season")
    if ls and ls["wins"] + ls["losses"]:
        last = ls["wins"] / (ls["wins"] + ls["losses"]) + _bump(ls.get("final_rank"))
    else:
        last = 0.5
    rec = season._records(state)[slug]
    games = rec["wins"] + rec["losses"]
    now = rec["wins"] / games + _bump(season.rank_map(state, state["current_week"]).get(slug)) if games else last
    w = _interp(LAST_SEASON_WEIGHT, week)
    return w * last + (1 - w) * now


def _bump(rank: Optional[int]) -> float:
    if not rank:
        return 0.0
    return next((b for top, b in POLL_BUMP if rank <= top), 0.0)


def weights(p: dict) -> dict[str, float]:
    """How much each topic counts for this prospect: his three priorities, the rest evenly."""
    rest = OTHER_WEIGHT / (len(PITCHES) - 3)
    w = {t: rest for t in PITCHES}
    for t, x in zip(p["priorities"], PRIORITY_WEIGHTS):
        w[t] = x
    return w


def interest(state: dict, slug: str, pid: str) -> float:
    p = state["recruiting"]["prospects"][pid]
    w = weights(p)
    base = PULL_SCALE * sum(w[t] * v for t, v in pull(state, slug, pid).items())
    return base + state["recruiting"]["lists"][pid].get(slug, 0.0)


# ----- your hours, points and actions -----------------------------------------------------------------

class RecruitingError(Exception):
    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code, self.message = code, message


def _recruiting_rating(state: dict, slug: str) -> float:
    if slug == state.get("team") and (state.get("coach") or {}).get("ratings"):
        return state["coach"]["ratings"].get("recruiting", 50)
    import season
    hc = (season.load_teams()[slug].get("coaches") or {}).get("head_coach") or {}
    return (hc.get("ratings") or {}).get("recruiting", 50)


def weekly_hours(state: dict, slug: str) -> int:
    return int(50 + max(0, _recruiting_rating(state, slug) - 50) // 4)


def nil_budget(state: dict, slug: str) -> int:
    return max(NIL_FLOOR, round(100 * (1 + _baseline(slug))))


def open_spots(slug: str) -> int:
    import season
    t = season.load_teams()[slug]
    returning = sum(1 for p in t["offense"] + t["defense"] if p.get("class") not in LEAVING)
    return max(MIN_OPEN, ROSTER_LIMIT - returning)


def offer_cap(state: dict, slug: str) -> int:
    return math.ceil(OFFER_FACTOR * open_spots(slug))


def _contact_points(p: dict, action: str, pitch: Optional[str]) -> float:
    """What one action is worth to the prospect before diminishing returns."""
    mult = 1.0 if pitch is None else (PITCH_MATCH if pitch in p["priorities"] else PITCH_MISS)
    return BASE_POINTS[action] * mult


def _hours(state: dict, slug: str) -> float:
    return state["recruiting"]["hours"].setdefault(slug, weekly_hours(state, slug))


def _nil(state: dict, slug: str) -> dict:
    return state["recruiting"]["nil"].setdefault(slug, {"budget": nil_budget(state, slug), "held": {}})


def nil_left(state: dict, slug: str) -> int:
    n = _nil(state, slug)
    return n["budget"] - sum(n["held"].values())


def _home_game_left(state: dict, slug: str) -> Optional[int]:
    weeks = [g["week"] for g in state["games"].values()
             if g["home"] == slug and g["kind"] == "regular" and not g["played"] and g["week"] > state["current_week"]]
    return min(weeks) if weeks else None


def act(state: dict, slug: str, pid: str, action: str, pitch: Optional[str] = None, nil: int = 0) -> dict:
    """One recruiting action by `slug` on prospect `pid` this week. Raises RecruitingError."""
    rc = state["recruiting"]
    p = rc["prospects"].get(pid)
    if p is None:
        raise RecruitingError(400, "unknown prospect")
    if action not in HOURS:
        raise RecruitingError(400, "unknown action")
    if pitch is not None and pitch not in PITCHES:
        raise RecruitingError(400, "unknown pitch")
    if nil < 0:
        raise RecruitingError(400, "NIL points cannot be negative")
    if rc["status"][pid]["signed"]:
        raise RecruitingError(409, "he has already signed")
    if _hours(state, slug) < HOURS[action]:
        raise RecruitingError(409, "not enough hours left this week")
    offers = rc["offers"].setdefault(slug, [])
    contact = rc["contacts"].setdefault(pid, {}).setdefault(slug, {"n": 0, "hc_week": None})
    week, revealed, points = state["current_week"], None, 0.0
    if action == "pull_offer":
        if pid not in offers:
            raise RecruitingError(409, "no offer to pull")
        offers.remove(pid)
        _nil(state, slug)["held"].pop(pid, None)
    elif action == "offer":
        if nil > nil_left(state, slug):
            raise RecruitingError(400, "not enough NIL points")
        if pid in offers:
            raise RecruitingError(409, "already offered")
        if len(offers) >= offer_cap(state, slug):
            raise RecruitingError(409, "offer limit reached")
        offers.append(pid)
        if nil:
            _nil(state, slug)["held"][pid] = nil
        points = _contact_points(p, "offer", None) + nil * NIL_VALUE.get(p["stars"], 0.1)
    elif action == "official_visit":
        if slug in rc["visits"].get(pid, {}):
            raise RecruitingError(409, "one official visit per school")
        game_week = _home_game_left(state, slug)
        if game_week is None:
            raise RecruitingError(409, "no home game left for a visit")
        rc["visits"].setdefault(pid, {})[slug] = {"week": game_week, "done": False}
    else:
        if action == "hc_visit":
            if contact["hc_week"] is not None and week - contact["hc_week"] < HC_VISIT_GAP:
                raise RecruitingError(409, "one in-home visit a month")
            contact["hc_week"] = week
        if action == "call":
            seen = rc["revealed"].setdefault(slug, {}).setdefault(pid, [])
            revealed = next((t for t in p["priorities"] if t not in seen), None)
            if revealed:
                seen.append(revealed)
        points = _contact_points(p, action, pitch) / (1 + DIMINISH * contact["n"])
        contact["n"] += 1
    rc["hours"][slug] = _hours(state, slug) - HOURS[action]
    if points:
        rc["lists"][pid][slug] = rc["lists"][pid].get(slug, 0.0) + points
    return {"interest": interest(state, slug, pid), "hours_left": rc["hours"][slug], "revealed": revealed}


def _set_record(state: dict, slug: str, wins: int, losses: int) -> None:
    """Tests: mark the team's first wins + losses games played, the wins first."""
    games = sorted((g for g in state["games"].values() if slug in (g["home"], g["away"]) and g["kind"] == "regular"),
                   key=lambda g: g["week"])
    for i, g in enumerate(games[:wins + losses]):
        won = i < wins
        mine_home = g["home"] == slug
        g.update(played=True, home_score=(28 if won else 10) if mine_home else (10 if won else 28),
                 away_score=(10 if won else 28) if mine_home else (28 if won else 10))

