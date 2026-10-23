"""Coach Career recruiting (docs/superpowers/specs/2026-10-22-coach-career-design.md, sections
2-5): a generated class of high school seniors, every FBS school's pull on each of them, and
(later sections of this file) the actions, the weekly step, signing and scouting.

The recruiting state lives in `state["recruiting"]` (a Coach Career season only):
    year, prospects {pid: prospect; ratings_ea and potential_ea as lists in `attrs` order}, lists {pid: {slug: action points}}, status {pid: {committed,
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
PROXIMITY_MILES = 300.0                    # distance pull exp(-miles / this) *tune*
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
EARLY_LEAVERS = 4                          # returning players expected to leave early (draft, transfers) *tune*
CLASS_ROOM = 2                             # a class tops out this far over the school's real mean size *tune*
OFFER_FACTOR = 1.5
FCS_LINE = 4.0                             # best FBS interest under this: Leaning FCS *tune*
FCS_NO_OFFER_WEEK = 8                      # from this week a prospect with no FBS offer leans FCS
COMMIT_ODDS = ((0, 0.02), (6, 0.05), (12, 0.08), (16, 0.10), (20, 0.30))   # weekly base chance by week *tune*
LEAD_SCALE = 3.0                           # interest lead worth a doubling of the base chance *tune*
VISIT_BOOST = 1.6                          # after an official visit to the leader
DECOMMIT_RATE = 0.20                       # weekly chance of a decommitment at an even race *tune*
FLIP_MARGIN = 4.0                          # a rival's lead that doubles-ish it (logistic) *tune*
CROWD = 2.0                                # interest lost per committed recruit at his position rated at least as high *tune*
RIVAL_RANK = 300                           # AI schools keep chasing committed prospects this highly ranked
REST_MILES, REST_NEAR = 700.0, 2.5         # outside its top states a school recruits near home first *tune*
NATIONAL_TILT = 40                         # how hard national targets lean to the very best *tune*
NATIONAL_TARGETS = 25                      # national targets on a board, times the school's blue-chip share *tune*
BOARD_FACTOR = 3                           # an AI school's board holds this many prospects per open spot
NATIONAL_REACH = 0.08                      # a blue-chip program's pull on four- and five-stars anywhere *tune*
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


def attributes(state: dict, p: dict, field: str = "potential_ea") -> dict[str, int]:
    """A prospect's EA ratings ("ratings_ea") or potential ("potential_ea") by attribute."""
    return dict(zip(state["recruiting"]["attrs"], p[field]))


def fbs_schools(state: dict) -> list[str]:
    import season
    return sorted(s for s, t in season.load_teams().items() if not t.get("fictional") and s in model()["teams"])


# ----- scouting (spec section 6) *tune* -----
GROUPS = ("athleticism", "size_strength", "technique", "football_iq", "potential", "coachability")
LETTERS = ("A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F")
# letters on the game's 1-99 scale (50 is the middle Power 4 starter at the position, 65 one standard
# deviation better, 80 two): C+ is that starter, B a clearly better one, A an all-conference level
LETTER_FLOORS = (85, 78, 72, 66, 60, 55, 50, 45, 40, 35, 30, 25, -1e9)
GRADE_LOW, GRADE_SPAN = 1.0, 98.0          # grades run the whole scale
COACHABILITY_POINTS = {"Coach's Dream": 90, "Film Junkie": 80, "Quick Study": 68, "Steady Grinder": 52,
                       "Slow to Click": 37, "Set in His Ways": 20}
LOOK_SD = (16.0, 4.0)                      # a look's error sd in grade points: 16 * (1 - s) + 4, s = rating / 99
LETTER_SLACK = 1.65                        # half a letter: a letter range already spans its end letters' width
CONFIDENCE_NOISE = 0.5                     # how far a look's own confidence strays (log sd, times 1 - s)
HIDDEN_RATE, HIDDEN_BELOW = 0.15, 0.82     # two-stars and three-stars under this composite, hidden until a look
_ATHLETIC = ("speed", "acceleration", "agility", "change_of_direction", "jumping")
_SIZE = ("strength", "toughness", "stamina")
_IQ = ("awareness", "play_recognition")

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
        hideable = p["stars"] == 2 or (p["stars"] == 3 and p["composite"] < HIDDEN_BELOW)
        p["hidden"] = hideable and random.Random(f"hidden-{year}-{state.get('rng_state', 0)}-{p['id']}").random() < HIDDEN_RATE
        prospects[p["id"]] = p
    _truths(prospects)
    # saved small: the EA ratings as lists in one key order (the house-scale copy is derived
    # again from ratings_ea when a signee joins a roster)
    attrs = sorted(next(iter(prospects.values()))["ratings_ea"]) if prospects else []
    for p in prospects.values():
        p["ratings_ea"] = [p["ratings_ea"][k] for k in attrs]
        p["potential_ea"] = [p["potential_ea"][k] for k in attrs]
        p.pop("ratings", None)
    state["recruiting"] = {
        "year": year, "prospects": prospects, "lists": {pid: {} for pid in prospects},
        "status": {pid: {"committed": None, "signed": None, "fcs": False} for pid in prospects},
        "offers": {}, "visits": {}, "contacts": {}, "hours": {}, "nil": {}, "revealed": {}, "board": [], "log": [],
        "boards": {}, "seed": state.get("rng_state", 0), "reads": {}, "attrs": attrs, "grades": "game",
    }


def upgrade_grades(state: dict) -> None:
    """A career saved when grades were class percentiles in school points: its true grades move
    to the game's scale and each read keeps how far off it was (and its looks)."""
    rc = state["recruiting"]
    old = {pid: dict(p["truth"]) for pid, p in rc["prospects"].items()}
    fresh = {pid: {**p, "ratings_ea": attributes(state, p, "ratings_ea"), "potential_ea": attributes(state, p)}
             for pid, p in rc["prospects"].items()}
    _truths(fresh)
    for pid, p in rc["prospects"].items():
        p["truth"] = fresh[pid]["truth"]
    for pid, read in rc["reads"].items():
        p = rc["prospects"].get(pid)
        if p is None:
            continue
        for g, (mean, prec) in read["g"].items():
            read["g"][g] = [round(p["truth"][g] + (mean - old[pid][g]), 3), prec]
    rc["grades"] = "game"


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
    import season
    hc = ((season.load_teams().get(slug) or {}).get("coaches") or {}).get("head_coach") or {}
    if (hc.get("since") or 0) > 2026:                 # a career's new hire: his rating is all there is to go on
        return ((hc.get("ratings") or {}).get("recruiting", 50) - 50) / 160
    cur = (model()["coaches"]["current"].get(slug) or {})
    return cur.get("edge") or 0.0


def pull(state: dict, slug: str, pid: str, winning: bool = True) -> dict[str, float]:
    """The school's pull on the prospect by topic, each 0-1 (`winning=False`: all but this
    season's standing, the part that holds all season)."""
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
        **({"winning": min(1.0, on_field(state, slug, state["current_week"]))} if winning else {}),
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
        static = _STATIC[key] = sum(w[t] * v for t, v in pull(state, slug, pid, winning=False).items())
    win = min(1.0, (win if win is not None else _winning(state)).get(slug, 0.5))
    return PULL_SCALE * (static + weights(p)["winning"] * win) + state["recruiting"]["lists"][pid].get(slug, 0.0)


_STATIC: dict = {}       # a prospect's pulls that hold all season (everything but winning), per school


def reset_caches() -> None:
    """Forget everything worked out from the league's rosters (season.use_league switched it)."""
    global _WINNING, _FITS
    _STATIC.clear()
    _WINNING, _FITS = (None, {}), (None, {}, None)
    _returning.cache_clear()
    _open_spots.cache_clear()
_WINNING: tuple = (None, {})   # (career and week, this week's on-field standing of every school)


def _winning(state: dict) -> dict[str, float]:
    import season
    global _WINNING
    played = sum(1 for g in state["games"].values() if g["played"])
    key = (state["id"], state.get("year"), state["current_week"], played)
    cached = _WINNING                     # one read: another request may swap it in meanwhile
    if cached[0] == key:
        return cached[1]
    records, ranks = season._records(state), season.rank_map(state, state["current_week"])
    value = {slug: on_field(state, slug, state["current_week"], records, ranks) for slug in fbs_schools(state)}
    _WINNING = (key, value)
    return value


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
    usual = math.ceil(((_team_model(slug).get("class_size") or {}).get("mean")) or 20) + CLASS_ROOM
    return max(MIN_OPEN, min(ROSTER_LIMIT - returning + EARLY_LEAVERS, usual))


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
        if action in ("call", "hc_visit"):           # a call or an in-home visit tells you one thing he cares about
            revealed = _reveal(state, slug, pid)
        points = _contact_points(p, action, pitch) / (1 + DIMINISH * contact["n"])
        contact["n"] += 1
    rc["hours"][slug] = _hours(state, slug) - HOURS[action]
    if points:
        rc["lists"][pid][slug] = rc["lists"][pid].get(slug, 0.0) + points * scale
    return revealed


# ----- the week: AI schools, visits, commitments, flips and signing ----------------------------------

def _reveal(state: dict, slug: str, pid: str) -> Optional[str]:
    """The next of his priorities this school learns, if any are left."""
    rc = state["recruiting"]
    seen = rc["revealed"].setdefault(slug, {}).setdefault(pid, [])
    revealed = next((t for t in rc["prospects"][pid]["priorities"] if t not in seen), None)
    if revealed:
        seen.append(revealed)
    return revealed


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


def _fit_all(slug: str, prospects: dict, pool: dict) -> dict[str, float]:
    """How well each prospect fits a school's usual recruiting: its states (each state's real share
    of its signees spread over that state's prospects in this class; the rest over everyone else,
    nearer first), a blue-chip program's national reach, its star level and its positions."""
    tm = _team_model(slug)
    shares = dict(tm.get("top_states") or [])
    rest = pool["total"] - sum(pool["states"].get(s, 0) for s in shares)
    rest_w = max(0.0, 1 - sum(shares.values())) / max(1, rest)
    reach = NATIONAL_REACH * (tm.get("blue_chip_share") or 0.0) / pool["blue_chips"]
    star_share = tm.get("star_share") or {}
    lift = {n: star_share.get(STAR_KEY.get(n, "2*"), 0.0) / _national_share(n) + 0.05 for n in (2, 3, 4, 5)}
    per_class = tm.get("positions_per_class") or {}
    loc = tm.get("location")
    lat0, lon0 = (math.radians(loc[0]), math.radians(loc[1])) if loc else (None, None)
    cos0 = math.cos(lat0) if loc else 0.0
    out = {}
    for pid, p in prospects.items():
        home = p["hometown"]["state"]
        if home in shares:
            w = shares[home] / pool["states"][home]
        elif loc:
            lat, lon = math.radians(p["home"][0]), math.radians(p["home"][1])
            h = math.sin((lat - lat0) / 2) ** 2 + cos0 * math.cos(lat) * math.sin((lon - lon0) / 2) ** 2
            w = rest_w * REST_NEAR * math.exp(-3958.8 * 2 * math.asin(math.sqrt(h)) / REST_MILES)
        else:
            w = rest_w
        if p["stars"] >= 4:
            w += reach
        pos = per_class.get(POS_247.get(p["position"], p["position"]), 1.0)
        out[pid] = w * lift.get(p["stars"], lift[2]) * (0.7 + 0.3 * min(1.0, pos / 2))
    return out


def _pool(state: dict) -> dict:
    """The class's prospects by home state, for spreading schools' state shares."""
    pros = state["recruiting"]["prospects"].values()
    states: dict[str, int] = {}
    for p in pros:
        states[p["hometown"]["state"]] = states.get(p["hometown"]["state"], 0) + 1
    return {"states": states, "total": len(pros), "blue_chips": max(1, sum(1 for p in pros if p["stars"] >= 4))}


@lru_cache(maxsize=None)
def _national_share(stars: int) -> float:
    """The share of a class at a star level: a school's star lift is its share over this."""
    counts = model()["generation"]["prospects_per_class"]
    return int(counts.get(str(stars), 1)) / sum(int(v) for v in counts.values())


_FITS: tuple = (None, {}, None)   # (career and class, each school's fit for every prospect, the pool)


def _fits(state: dict, slug: str) -> dict[str, float]:
    """A school's fit for every prospect in the class (fixed all season), cached for one career."""
    global _FITS
    rc = state["recruiting"]
    key = (state["id"], rc["year"])
    cached = _FITS
    if cached[0] != key:
        cached = _FITS = (key, {}, _pool(state))
    fits = cached[1].get(slug)
    if fits is None:
        fits = cached[1][slug] = _fit_all(slug, rc["prospects"], cached[2])
    return fits


def _build_board(state: dict, slug: str, rng: random.Random) -> list[str]:
    rc = state["recruiting"]
    free = [pid for pid, st in rc["status"].items() if not st["signed"] and not st["committed"]]
    # weighted sampling without replacement (key u^(1/fit)): the board's mix of states and star
    # levels follows the school's real shares instead of always taking its home state first
    keyed, fits = [], _fits(state, slug)
    for pid in free:
        f = fits[pid]
        if f > 0:
            keyed.append((math.log(rng.random() or 1e-12) / f, pid))
    keyed.sort(reverse=True)
    sampled = [pid for _, pid in keyed[:BOARD_FACTOR * open_spots(state, slug)]]
    # blue-chip programs chase the best four- and five-stars nationally, ahead of the rest
    tm = _team_model(slug)
    n = round(NATIONAL_TARGETS * (tm.get("blue_chip_share") or 0.0)) if (tm.get("blue_chip_share") or 0) >= 0.25 else 0
    lift = lambda p: (tm.get("star_share") or {}).get(STAR_KEY.get(p["stars"], "2*"), 0.0) / _national_share(p["stars"])
    keyed = []
    for pid in free:
        p = rc["prospects"][pid]
        if p["stars"] >= 4 and lift(p) >= 1:
            weight = lift(p) * math.exp(NATIONAL_TILT * (p["composite"] - 0.9))
            keyed.append((math.log(rng.random() or 1e-12) / weight, pid))
    national = [pid for _, pid in sorted(keyed, reverse=True)[:n]]
    return list(dict.fromkeys(national + sampled))


def auto_recruit(state: dict, slug: str, rng: Optional[random.Random] = None, commits: Optional[dict] = None,
                 yours: bool = False) -> None:
    """A school's week by the Auto-recruit rules: keep a board from its footprint and star level,
    offer its best fits as the fall goes, invite top targets to home games, and spend the rest of
    its hours on calls and messages pitching the priorities it knows, NIL on its top offers.
    `yours`: your school on Auto-recruit works from your board (your picks first) and puts
    everyone it recruits on your board, so you see what your staff are doing."""
    rc = state["recruiting"]
    rng = rng or random.Random(f"auto-{rc['seed']}-{slug}-{state['current_week']}")
    week = state["current_week"]
    spots_left = open_spots(state, slug) - (commits if commits is not None else _commits(state)).get(slug, 0)
    live = lambda pid: not rc["status"][pid]["signed"] and rc["status"][pid]["committed"] in (None, slug)
    dropped = set(rc.get("dropped", [])) if yours else set()      # ones you took off your board stay off
    picks = [pid for pid in rc["board"] if live(pid)] if yours else []
    board = list(dict.fromkeys(picks + [pid for pid in rc["boards"].get(slug, []) if live(pid) and pid not in dropped]))
    if spots_left > 0 and len(board) < 2 * spots_left:
        board = list(dict.fromkeys(board + [pid for pid in _build_board(state, slug, rng) if pid not in dropped]))
    rc["boards"][slug] = board
    if yours:
        before = {pid: by[slug]["n"] for pid, by in rc["contacts"].items() if slug in by}
        try:
            _auto_week(state, slug, rng, board, spots_left, week)
        finally:                                # everyone your staff recruited this week shows on your board
            worked = [pid for pid, by in rc["contacts"].items() if slug in by and by[slug]["n"] != before.get(pid)]
            for pid in list(rc["offers"].get(slug, [])) + worked:
                if pid not in rc["board"] and pid not in dropped and not rc["status"][pid]["signed"]:
                    rc["board"].append(pid)
        return
    _auto_week(state, slug, rng, board, spots_left, week)


def _auto_week(state: dict, slug: str, rng: random.Random, board: list, spots_left: int, week: int) -> None:
    """Auto-recruit's offers, visits and contacts for one school's week, best of its board first."""
    rc = state["recruiting"]
    if spots_left <= 0:
        return
    offers = rc["offers"].setdefault(slug, [])
    for pid in [q for q in offers if rc["status"][q]["committed"] not in (None, slug)
                and (rc["status"][q]["signed"] or rc["prospects"][q]["rank"] > RIVAL_RANK)]:
        offers.remove(pid)                     # he went elsewhere: the offer frees up (a top prospect is still chased)
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
    targets += [pid for pid in offers if rc["status"][pid]["committed"] not in (None, slug) and not rc["status"][pid]["signed"]]
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
        action = "call" if len(known.get(pid) or []) < 3 and _hours(state, slug) >= HOURS["call"] else "message"
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
            while _reveal(state, slug, pid):     # a weekend on campus: you learn everything he cares about
                pass
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


def _class_by_position(state: dict) -> dict[tuple, list[float]]:
    rc = state["recruiting"]
    out: dict[tuple, list[float]] = {}
    for pid, st in rc["status"].items():
        if st["committed"] and st["committed"] != "FCS":
            p = rc["prospects"][pid]
            out.setdefault((st["committed"], p["position"]), []).append(p["composite"])
    return out


def _draws(state: dict, week: int, rng: random.Random) -> None:
    rc = state["recruiting"]
    commits = _commits(state)
    room = lambda slug: commits.get(slug, 0) < open_spots(state, slug)
    base = _interp(COMMIT_ODDS, week)
    win, offered, by_pos = _winning(state), _offers_by_prospect(state), _class_by_position(state)

    def score(slug: str, pid: str) -> float:
        """His interest less the crowd: recruits already committed there at his position, rated at least as high."""
        p = rc["prospects"][pid]
        crowd = sum(1 for c in by_pos.get((slug, p["position"]), ()) if c >= p["composite"])
        if rc["status"][pid]["committed"] == slug:
            crowd -= 1                                 # not himself
        return interest(state, slug, pid, win) - CROWD * crowd

    for pid in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"]):
        st = rc["status"][pid]
        if st["signed"]:
            continue
        scores = sorted(((score(s, pid), s) for s in offered.get(pid, [])), reverse=True)
        if st["committed"]:
            mine = score(st["committed"], pid)
            rival = next(((v, s) for v, s in scores if s != st["committed"] and room(s)), None)
            if rival and rng.random() < 2 * DECOMMIT_RATE * _logistic((rival[0] - mine) / FLIP_MARGIN):
                commits[st["committed"]] -= 1
                _event(state, "decommit", pid, st["committed"])
                _commit(state, pid, rival[1], "flip")
                commits[rival[1]] = commits.get(rival[1], 0) + 1
                by_pos.setdefault((rival[1], rc["prospects"][pid]["position"]), []).append(rc["prospects"][pid]["composite"])
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
            by_pos.setdefault((leader, rc["prospects"][pid]["position"]), []).append(rc["prospects"][pid]["composite"])


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
        else:
            continue
        for school, pids in rc["offers"].items():  # every other school's offer to him lapses
            if school != st["signed"] and pid in pids:
                pids.remove(pid)
                rc["nil"].get(school, {}).get("held", {}).pop(pid, None)


AUTO_MODES = ("off", "week", "season")


def auto_mode(state: dict) -> str:
    """Your Auto-recruit: "off", "week" (this coming week only) or "season" (saves from before the
    one-week option stored true or false)."""
    v = ((state.get("career") or {}).get("settings") or {}).get("auto_recruit")
    return "season" if v is True else v if v in AUTO_MODES else "off"


def weekly_step(state: dict, week: int, auto_user: bool = False) -> list[dict]:
    """The recruiting week after `week`'s games: visits, every AI school (and yours on Auto),
    commitment draws, signing, then the hours reset. Returns the week's events."""
    import season
    rc = state["recruiting"]
    start_log = len(rc["log"])
    rng = random.Random(f"recruiting-{rc['seed']}-{week}")
    _visits(state, week)
    scout_week(state)
    mine = state.get("team")
    mode = auto_mode(state)
    auto_mine = auto_user or mode != "off"
    commits = _commits(state)          # AI weeks change offers and interest, not commitments
    for slug in fbs_schools(state):
        if slug != mine or auto_mine:
            auto_recruit(state, slug, random.Random(f"auto-{rc['seed']}-{slug}-{week}"), commits, yours=slug == mine)
    if week < season.FINAL_WEEK:
        _draws(state, week, rng)
    if week == season.SELECTION_WEEK:
        _sign(state, final=False)
    if week >= season.FINAL_WEEK:
        _sign(state, final=True)
    rc["hours"] = {}
    if mode == "week":                       # Auto-recruit for one week: done, so off again
        state["career"]["settings"]["auto_recruit"] = "off"
    return rc["log"][start_log:]


# ----- scouting: truths, looks, reads and grades -------------------------------------------------------

def _truths(prospects: dict) -> None:
    """Each prospect's true grade per group, on the game's own scale: the average of the player-card
    attributes behind it (athleticism: Top Speed, Burst, Agility, Leaping; technique: his position's
    skills), and for potential his projected overall. Coachability comes from his label. Hidden from
    the player; reads estimate them."""
    import prospects as pr
    import season
    for p in prospects.values():
        cards = pr.card_attributes(p["ratings_ea"], p)
        truth = {g: round(sum(cards[k] for k in pr.group_keys(p, g)) / len(pr.group_keys(p, g)), 1) for g in GROUPS[:-2]}
        truth["potential"] = float(season.ea_house(pr.engine_position(p), recruits.overall_ea(p["ea_position"], p["archetype"], p["potential_ea"])))
        truth["coachability"] = COACHABILITY_POINTS.get(p.get("coachability"), COACHABILITY_POINTS["Steady Grinder"])
        p["truth"] = truth


def letter(points: float) -> str:
    return next(l for l, floor in zip(LETTERS, LETTER_FLOORS) if points >= floor)


def look(state: dict, pid: str, evaluator_rating: int, rng: random.Random) -> None:
    """One look at a prospect by an evaluator: every group's read moves toward what he saw. A look's
    error shrinks with the rating; so does how far its confidence can stray (a weak evaluator is
    sometimes sure and wrong)."""
    p = state["recruiting"]["prospects"][pid]
    s = evaluator_rating / 99
    sd = LOOK_SD[0] * (1 - s) + LOOK_SD[1]
    read = state["recruiting"]["reads"].setdefault(pid, {"looks": 0, "by": {}, "g": {}})
    for g in GROUPS:
        seen = p["truth"][g] + rng.gauss(0, sd)
        felt = sd * math.exp(rng.gauss(0, CONFIDENCE_NOISE * (1 - s)))
        add = 1 / felt ** 2
        mean, prec = read["g"].get(g, (0.0, 0.0))
        read["g"][g] = [round((mean * prec + seen * add) / (prec + add), 3), round(prec + add, 6)]
    read["looks"] += 1
    key = str(evaluator_rating)
    read["by"][key] = read["by"].get(key, 0) + 1


def read_interval(state: dict, pid: str, group: str) -> Optional[tuple[float, float]]:
    """Your staff's read as a range of grade points, or None before any look."""
    read = state["recruiting"]["reads"].get(pid)
    if not read:
        return None
    s = int(max(read["by"].items(), key=lambda kv: (kv[1], int(kv[0])))[0]) / 99
    mean, prec = read["g"][group]
    half = max(0.0, (0.6 + 1.1 * s) / math.sqrt(prec) - LETTER_SLACK)
    return mean - half, mean + half


def grade_range(state: dict, pid: str, group: str) -> Optional[tuple[str, str]]:
    """(low, high) letter grades, e.g. ("B-", "A-"); None before any look."""
    iv = read_interval(state, pid, group)
    return (letter(iv[0]), letter(iv[1])) if iv else None


def make_staff(state: dict) -> list[dict]:
    """Your OC and DC (evaluation = player development) and three generated recruiters, each on
    one area: the school's own states first."""
    import season
    t = season.load_teams()[state["team"]]
    rng = random.Random(f"staff-{state.get('rng_state', 0)}-{state['team']}")
    taken = {p["name"].lower() for p in state["recruiting"]["prospects"].values()}
    staff = []
    for sid, role, key in (("oc", "OC", "offensive_coordinator"), ("dc", "DC", "defensive_coordinator")):
        c = (t.get("coaches") or {}).get(key) or {}
        r = c.get("ratings") or {}
        staff.append({"id": sid, "role": role, "name": c.get("name") or role, "evaluation": int(r.get("player_development", 60)),
                      "recruiting": int(r.get("recruiting", 60))})
    for i in range(1, 4):
        staff.append({"id": f"r{i}", "role": "Recruiter", "name": recruits._name(rng, taken),
                      "evaluation": rng.randint(40, 80), "recruiting": rng.randint(40, 80)})
    order = []
    for st_code, _ in (_team_model(state["team"]).get("top_states") or []) + [([t.get("state")], 0)]:
        codes = st_code if isinstance(st_code, list) else [st_code]
        for code in codes:
            area = next((a for a, states in AREAS.items() if code in states), None)
            if area and area not in order:
                order.append(area)
    order += [a for a in AREAS if a not in order]
    for member, area in zip(staff, order):
        member["area"] = area
    return staff


def set_board(state: dict, pid: str, on: bool) -> None:
    """Put a prospect on your board or take him off; one you take off stays off, Auto-recruit
    included, until you put him back."""
    rc = state["recruiting"]
    dropped = rc.setdefault("dropped", [])
    if on:
        if pid not in rc["board"]:
            rc["board"].append(pid)
        if pid in dropped:
            dropped.remove(pid)
    else:
        if pid in rc["board"]:
            rc["board"].remove(pid)
        if pid not in dropped:
            dropped.append(pid)
        mine = rc["boards"].get(state["team"])
        if mine and pid in mine:
            mine.remove(pid)


def assign(state: dict, staff_id: str, area: str) -> None:
    if area not in AREAS:
        raise RecruitingError(400, "unknown area")
    member = next((m for m in state["career"].get("staff", []) if m["id"] == staff_id), None)
    if member is None:
        raise RecruitingError(400, "unknown staff member")
    member["area"] = area


def scout_week(state: dict) -> None:
    """Every prospect in each staffed area gets a look from the staff member there."""
    staff = (state.get("career") or {}).get("staff") or []
    rng = random.Random(f"scout-{state['recruiting']['seed']}-{state['current_week']}")
    by_state: dict[str, list[str]] = {}
    for pid, p in state["recruiting"]["prospects"].items():
        if not state["recruiting"]["status"][pid]["signed"]:
            by_state.setdefault(p["hometown"]["state"], []).append(pid)
    for member in staff:
        for code in AREAS.get(member.get("area"), []):
            for pid in by_state.get(code, []):
                look(state, pid, member["evaluation"], rng)


def visible(state: dict) -> set[str]:
    """The prospects you can see: everyone but the hidden ones your staff have not seen and your
    school has not offered or landed (Auto-recruit can find them)."""
    rc, me = state["recruiting"], state.get("team")
    mine = set(rc["offers"].get(me, []))
    return {pid for pid, p in rc["prospects"].items()
            if not p.get("hidden") or pid in rc["reads"] or pid in mine or me in (rc["status"][pid]["committed"], rc["status"][pid]["signed"])}


def prospect_list(state: dict) -> list[str]:
    """The class as you can see it (`visible`), by rank."""
    rc = state["recruiting"]
    return sorted(visible(state), key=lambda pid: rc["prospects"][pid]["rank"])


def _set_record(state: dict, slug: str, wins: int, losses: int) -> None:
    """Tests: mark the team's first wins + losses games played, the wins first."""
    games = sorted((g for g in state["games"].values() if slug in (g["home"], g["away"]) and g["kind"] == "regular"),
                   key=lambda g: g["week"])
    for i, g in enumerate(games[:wins + losses]):
        won = i < wins
        mine_home = g["home"] == slug
        g.update(played=True, home_score=(28 if won else 10) if mine_home else (10 if won else 28),
                 away_score=(10 if won else 28) if mine_home else (28 if won else 10))

