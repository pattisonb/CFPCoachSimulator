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
FCS_LINE = 4.0                             # best FBS interest under this: Leaning FCS *tune*
FCS_NO_OFFER_WEEK = 8                      # from this week a prospect with no FBS offer leans FCS
COMMIT_ODDS = ((0, 0.02), (6, 0.05), (12, 0.10), (16, 0.16), (20, 0.30))   # weekly base chance by week *tune*
LEAD_SCALE = 3.0                           # interest lead worth a doubling of the base chance *tune*
VISIT_BOOST = 1.6                          # after an official visit to the leader
DECOMMIT_RATE = 0.04                       # weekly chance per FLIP_MARGIN of a rival's lead *tune*
FLIP_MARGIN = 4.0
BOARD_FACTOR = 3                           # an AI school's board holds this many prospects per open spot
NATIONAL_REACH = 0.08                      # a blue-chip program's pull on four- and five-stars anywhere *tune*
STATE_SHARE_FLOOR = 0.004                  # a state outside a school's top states
STAR_KEY = {5: "5*", 4: "4*", 3: "3*", 2: "2*"}
AI_NIL = {5: 0.25, 4: 0.12, 3: 0.04, 2: 0.0}   # share of the budget an AI school puts on one offer by stars *tune*
POS_247 = {"OT": "OL", "IOL": "OL"}
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
        "boards": {}, "seed": state.get("rng_state", 0),
    }


# ----- what pulls a prospect to a school -----------------------------------------------------------

def _group(ea_position: str) -> str:
    import build_teams
    pos = build_teams.POSITION_MAP.get(ea_position, ea_position)
    return "LB" if pos in ("MLB", "ROLB", "LOLB") else pos


def _ahead(slug: str, group: str, overall_ea: float) -> int:
    """Returning players at his position group on that roster rated at least as high as him."""
    return sum(1 for o in _returning(slug, group) if o >= overall_ea)


@lru_cache(maxsize=None)
def _returning(slug: str, group: str) -> tuple:
    import season
    t = season.load_teams()[slug]
    return tuple((p.get("ea_overall") or 0) for p in t["offense"] + t["defense"]
                 if ("LB" if p["position"] in ("MLB", "ROLB", "LOLB") else p["position"]) == group
                 and p.get("class") not in LEAVING)


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


def on_field(state: dict, slug: str, week: int, records: Optional[dict] = None, ranks: Optional[dict] = None) -> float:
    """Last season blended with this one, this season counting more every week (spec section 3)."""
    import season
    records = records if records is not None else season._records(state)
    ranks = ranks if ranks is not None else season.rank_map(state, state["current_week"])
    ls = _team_model(slug).get("last_season")
    if ls and ls["wins"] + ls["losses"]:
        last = ls["wins"] / (ls["wins"] + ls["losses"]) + _bump(ls.get("final_rank"))
    else:
        last = 0.5
    rec = records[slug]
    games = rec["wins"] + rec["losses"]
    now = rec["wins"] / games + _bump(ranks.get(slug)) if games else last
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


def interest(state: dict, slug: str, pid: str, win: Optional[dict] = None) -> float:
    p = state["recruiting"]["prospects"][pid]
    key = (state["id"], state["recruiting"]["year"], pid, slug)
    static = _STATIC.get(key)
    if static is None:
        if len(_STATIC) > 2_000_000:
            _STATIC.clear()
        w = weights(p)
        static = _STATIC[key] = sum(w[t] * v for t, v in pull(state, slug, pid).items() if t != "winning")
    win = min(1.0, (win if win is not None else _winning(state)).get(slug, 0.5))
    return PULL_SCALE * (static + weights(p)["winning"] * win) + state["recruiting"]["lists"][pid].get(slug, 0.0)


_STATIC: dict = {}       # a prospect's pulls that hold all season (everything but winning), per school
_WINNING: dict = {}      # this week's on-field standing of every school


def _winning(state: dict) -> dict[str, float]:
    import season
    played = sum(1 for g in state["games"].values() if g["played"])
    key = (state["id"], state["current_week"], played)
    if _WINNING.get("key") != key:
        records, ranks = season._records(state), season.rank_map(state, state["current_week"])
        _WINNING.clear()
        _WINNING.update(key=key, value={slug: on_field(state, slug, state["current_week"], records, ranks)
                                        for slug in fbs_schools(state)})
    return _WINNING["value"]


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


def open_spots(state: dict, slug: str) -> int:
    return _open_spots(slug)


@lru_cache(maxsize=None)
def _open_spots(slug: str) -> int:
    import season
    t = season.load_teams()[slug]
    returning = sum(1 for p in t["offense"] + t["defense"] if p.get("class") not in LEAVING)
    return max(MIN_OPEN, ROSTER_LIMIT - returning)


def offer_cap(state: dict, slug: str) -> int:
    return math.ceil(OFFER_FACTOR * open_spots(state, slug))


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
    revealed = _act(state, slug, pid, action, pitch, nil)
    return {"interest": interest(state, slug, pid), "hours_left": state["recruiting"]["hours"][slug], "revealed": revealed}


def _act(state: dict, slug: str, pid: str, action: str, pitch: Optional[str] = None, nil: int = 0,
         scale: float = 1.0) -> Optional[str]:
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
        rc["lists"][pid][slug] = rc["lists"][pid].get(slug, 0.0) + points * scale
    return revealed


# ----- the week: AI schools, visits, commitments, flips and signing ----------------------------------

def _commits(state: dict) -> dict[str, int]:
    out: dict[str, int] = {}
    for st in state["recruiting"]["status"].values():
        if st["committed"] and st["committed"] != "FCS":
            out[st["committed"]] = out.get(st["committed"], 0) + 1
    return out


def signed_class(state: dict, slug: str) -> list[str]:
    return [pid for pid, st in state["recruiting"]["status"].items() if st["signed"] == slug]


def _event(state: dict, kind: str, pid: str, school: Optional[str] = None, **extra) -> dict:
    e = {"week": state["current_week"], "kind": kind, "pid": pid, "school": school, **extra}
    state["recruiting"]["log"].append(e)
    return e


def _fit(slug: str, p: dict) -> float:
    """How well a prospect fits a school's usual recruiting: its states, its star level, its positions."""
    tm = _team_model(slug)
    shares = dict(tm.get("top_states") or [])
    state_share = shares.get(p["hometown"]["state"], 0.0) + \
        (NATIONAL_REACH * (tm.get("blue_chip_share") or 0.0) if p["stars"] >= 4 else STATE_SHARE_FLOOR)
    stars = (tm.get("star_share") or {}).get(STAR_KEY.get(p["stars"], "2*"), 0.0) / _national_share(p["stars"]) + 0.05
    pos = (tm.get("positions_per_class") or {}).get(POS_247.get(p["position"], p["position"]), 1.0)
    return state_share * stars * (0.7 + 0.3 * min(1.0, pos / 2))


@lru_cache(maxsize=None)
def _national_share(stars: int) -> float:
    """The share of a class at a star level: a school's star lift is its share over this."""
    counts = model()["generation"]["prospects_per_class"]
    return int(counts.get(str(stars), 1)) / sum(int(v) for v in counts.values())


def _build_board(state: dict, slug: str, rng: random.Random) -> list[str]:
    rc = state["recruiting"]
    free = [pid for pid, st in rc["status"].items() if not st["signed"] and not st["committed"]]
    scored = sorted(free, key=lambda pid: -_fit(slug, rc["prospects"][pid]) * rng.uniform(0.8, 1.2))
    return scored[:BOARD_FACTOR * open_spots(state, slug)]


def auto_recruit(state: dict, slug: str, rng: Optional[random.Random] = None) -> None:
    """A school's week by the Auto-recruit rules: keep a board from its footprint and star level,
    offer its best fits as the fall goes, invite top targets to home games, and spend the rest of
    its hours on calls and messages pitching the priorities it knows, NIL on its top offers."""
    rc = state["recruiting"]
    rng = rng or random.Random(f"auto-{rc['seed']}-{slug}-{state['current_week']}")
    week = state["current_week"]
    spots_left = open_spots(state, slug) - _commits(state).get(slug, 0)
    board = [pid for pid in rc["boards"].get(slug, []) if not rc["status"][pid]["signed"]
             and rc["status"][pid]["committed"] in (None, slug)]
    if spots_left > 0 and len(board) < 2 * spots_left:
        board = list(dict.fromkeys(board + _build_board(state, slug, rng)))
    rc["boards"][slug] = board
    if spots_left <= 0:
        return
    offers = rc["offers"].setdefault(slug, [])
    for pid in [q for q in offers if rc["status"][q]["committed"] not in (None, slug)]:
        offers.remove(pid)                     # he went elsewhere: the offer frees up
        _nil(state, slug)["held"].pop(pid, None)
    edge = 1 + _coach_edge(state, slug)
    allowed = math.ceil(offer_cap(state, slug) * min(1.0, 0.35 + 0.65 * week / 8))
    budget = _nil(state, slug)["budget"]
    for pid in board:
        if len(offers) >= allowed:
            break
        if pid not in offers and rc["status"][pid]["committed"] is None:
            p = rc["prospects"][pid]
            nil = min(nil_left(state, slug), round(budget * AI_NIL.get(p["stars"], 0)))
            try:
                _act(state, slug, pid, "offer", nil=nil, scale=edge)
            except RecruitingError:
                break
    targets = [pid for pid in offers if rc["status"][pid]["committed"] is None and not rc["status"][pid]["signed"]]
    known = rc["revealed"].get(slug, {})
    for pid in targets[:2]:
        if slug not in rc["visits"].get(pid, {}):
            try:
                _act(state, slug, pid, "official_visit")
            except RecruitingError:
                pass
    if targets:
        try:
            _act(state, slug, targets[0], "hc_visit", pitch=(known.get(targets[0]) or [None])[0], scale=edge)
        except RecruitingError:
            pass
    i = 0
    while targets and _hours(state, slug) >= HOURS["message"] and i < 4 * len(targets):
        pid = targets[i % len(targets)]
        pitch = (known.get(pid) or [None])[0]
        action = "call" if pitch is None and _hours(state, slug) >= HOURS["call"] else "message"
        try:
            _act(state, slug, pid, action, pitch=pitch, scale=edge)
        except RecruitingError:
            pass
        i += 1


def _visits(state: dict, week: int) -> None:
    """Official visits at this week's home games: a win sells, a blowout loss hurts, a big crowd helps."""
    rc = state["recruiting"]
    import season
    for pid, by_school in rc["visits"].items():
        for slug, v in by_school.items():
            if v["done"] or v["week"] != week:
                continue
            game = next((g for g in state["games"].values() if g["week"] == week and g["home"] == slug and g["played"]), None)
            v["done"] = True
            if game is None:
                continue
            margin = game["home_score"] - game["away_score"]
            mood = 1.2 if margin > 0 else (0.6 if margin <= -21 else 0.9)
            cap = ((season.load_teams()[slug].get("stadium") or {}).get("capacity") or 50000)
            crowd = min(1.15, max(0.85, cap / 80000))
            rc["lists"][pid][slug] = rc["lists"][pid].get(slug, 0.0) + BASE_POINTS["official_visit"] * mood * crowd


def _offers_by_prospect(state: dict) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for slug, pids in state["recruiting"]["offers"].items():
        for pid in pids:
            out.setdefault(pid, []).append(slug)
    return out


def _commit(state: dict, pid: str, slug: str, kind: str = "commit") -> None:
    rc = state["recruiting"]
    old = rc["status"][pid]["committed"]
    rc["status"][pid].update(committed=slug, fcs=False)
    for school, n in rc["nil"].items():           # rivals' NIL packages for him are released
        if school != slug:
            n["held"].pop(pid, None)
    _event(state, kind, pid, slug, **({"from": old} if old else {}))


def _draws(state: dict, week: int, rng: random.Random) -> None:
    rc = state["recruiting"]
    commits = _commits(state)
    room = lambda slug: commits.get(slug, 0) < open_spots(state, slug)
    base = _interp(COMMIT_ODDS, week)
    win, offered = _winning(state), _offers_by_prospect(state)
    for pid in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"]):
        st = rc["status"][pid]
        if st["signed"]:
            continue
        scores = sorted(((interest(state, s, pid, win), s) for s in offered.get(pid, [])), reverse=True)
        if st["committed"]:
            mine = interest(state, st["committed"], pid, win)
            rival = next(((v, s) for v, s in scores if s != st["committed"] and room(s)), None)
            if rival and rival[0] - mine > FLIP_MARGIN and rng.random() < DECOMMIT_RATE * (rival[0] - mine) / FLIP_MARGIN:
                commits[st["committed"]] -= 1
                _event(state, "decommit", pid, st["committed"])
                _commit(state, pid, rival[1], "flip")
                commits[rival[1]] = commits.get(rival[1], 0) + 1
            continue
        scores = [(v, s) for v, s in scores if room(s)]
        lean = (not scores and week >= FCS_NO_OFFER_WEEK) or (scores and scores[0][0] < FCS_LINE)
        if lean != st["fcs"]:
            st["fcs"] = bool(lean)
            if lean:
                _event(state, "leaning_fcs", pid)
        if not scores or lean:
            continue
        top, leader = scores[0]
        lead = top - (scores[1][0] if len(scores) > 1 else 0.8 * top)
        visited = (rc["visits"].get(pid, {}).get(leader) or {}).get("done")
        odds = min(0.9, base * (0.5 + lead / LEAD_SCALE) * (VISIT_BOOST if visited else 1.0))
        if rng.random() < odds:
            _commit(state, pid, leader)
            commits[leader] = commits.get(leader, 0) + 1


def _sign(state: dict, final: bool) -> None:
    """Early signing period: every committed prospect signs. Signing day (final): the rest go to
    their leader with room, or to an FCS program."""
    rc = state["recruiting"]
    if final:
        commits, win, offered = _commits(state), _winning(state), _offers_by_prospect(state)
        for pid in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"]):
            st = rc["status"][pid]
            if st["committed"]:
                continue
            schools = set(offered.get(pid, [])) | set(rc["lists"][pid])
            scores = sorted(((interest(state, s, pid, win), s) for s in schools
                             if commits.get(s, 0) < open_spots(state, s)), reverse=True)
            if scores and scores[0][0] >= FCS_LINE:
                _commit(state, pid, scores[0][1])
                commits[scores[0][1]] = commits.get(scores[0][1], 0) + 1
    for pid, st in rc["status"].items():
        if st["signed"]:
            continue
        if st["committed"]:
            st["signed"] = st["committed"]
            n = rc["nil"].get(st["committed"])
            if n and pid in n["held"]:                 # the package is spent
                n["budget"] -= n["held"].pop(pid)
            _event(state, "signed", pid, st["committed"])
        elif final:
            st.update(signed="FCS", committed="FCS", fcs=True)
            _event(state, "signed", pid, "FCS")


def weekly_step(state: dict, week: int, auto_user: bool = False) -> list[dict]:
    """The recruiting week after `week`'s games: visits, every AI school (and yours on Auto),
    commitment draws, signing, then the hours reset. Returns the week's events."""
    import season
    rc = state["recruiting"]
    start_log = len(rc["log"])
    rng = random.Random(f"recruiting-{rc['seed']}-{week}")
    _visits(state, week)
    mine = state.get("team")
    auto_mine = auto_user or ((state.get("career") or {}).get("settings") or {}).get("auto_recruit")
    for slug in fbs_schools(state):
        if slug != mine or auto_mine:
            auto_recruit(state, slug, random.Random(f"auto-{rc['seed']}-{slug}-{week}"))
    if week < season.FINAL_WEEK:
        _draws(state, week, rng)
    if week == season.SELECTION_WEEK:
        _sign(state, final=False)
    if week >= season.FINAL_WEEK:
        _sign(state, final=True)
    rc["hours"] = {}
    return rc["log"][start_log:]


def _set_record(state: dict, slug: str, wins: int, losses: int) -> None:
    """Tests: mark the team's first wins + losses games played, the wins first."""
    games = sorted((g for g in state["games"].values() if slug in (g["home"], g["away"]) and g["kind"] == "regular"),
                   key=lambda g: g["week"])
    for i, g in enumerate(games[:wins + losses]):
        won = i < wins
        mine_home = g["home"] == slug
        g.update(played=True, home_score=(28 if won else 10) if mine_home else (10 if won else 28),
                 away_score=(10 if won else 28) if mine_home else (28 if won else 10))

