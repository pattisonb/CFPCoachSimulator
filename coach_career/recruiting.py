"""Coach Career recruiting (docs/superpowers/specs/2026-10-22-coach-career-design.md, sections
2-5): a generated class of high school seniors, every FBS school's pull on each of them, and
(later sections of this file) the actions, the weekly step, signing and scouting.

The recruiting state lives in `state["recruiting"]` (a Coach Career season only):
    year, prospects {pid: prospect; "ratings" and "potential" on our scale (game_scale.py) as lists in `attrs` order}, lists {pid: {slug: action points}}, status {pid: {committed,
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

from teamdata import game_scale
from coach_career import recruits

ROOT = Path(__file__).resolve().parents[1]   # the project root
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
ENGINE_GROUP = {"MLB": "LB", "ROLB": "LB", "LOLB": "LB"}   # engine positions to roster groups (the rest are their own)
EARLY_LEAVER_POOL = 100                    # the underclassmen projecting a top-100 pick leave early ... *tune*
ATTRITION = 0.10                           # the share of returning players who leave anyway (the portal, quitting) *tune*
LATE_MARKET = 12                           # from this week the late market: a school refreshes its board every week, offers
LATE_OFFERS = 1.25                         # ... this much more, and takes one flier past a group's cap *tune*
EARLY_LEAVER_RATE = 0.65                   # ... this often (offseason.DECLARE's middle), so they only part-count as returning
NEED_FACTOR = ((2, 1.6), (1, 1.2), (0, 0.6))   # a board's pull toward a group by its need (need, factor); below 0: NEED_FLOOR *tune*
NEED_FLOOR = 0.25
ONE_A_CLASS = ("QB", "K", "P")              # groups a class takes one of unless the need is higher
OFFER_ROOM = 2.0                            # open offers a school keeps out at a group: this times its cap there (it offers more than it takes)
QB_EVERY_CLASS = True                       # a class takes a quarterback whatever the room (the one-starter spot turns over)
FIVE_STAR_FLOOR = 0.6                       # a blue blood's board pull on a five-star never drops below this for need
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
HOURS = {"message": 5, "call": 15, "hc_visit": 30, "offer": 0, "official_visit": 10, "pull_offer": 0, "raise_nil": 0, "scout": 5,
         "pitch": 0}                               # a pitch finishes your call or visit scene: its hours went on the call
SCENES = ("call", "hc_visit")              # your calls and in-home visits without a pitch open a scene (scenes.py)
# looks come in trip units: a full report is REPORT_LOOKS looks and nothing goes past it (read["looks"] <= 3 always)
REPORT_LOOKS = 3                           # a complete scouting report: three looks (flags, "our comp" and the SCOUTED line wait for it)
SEND_LOOK = 1.0                            # a scouting trip (a Send, 5 hours): one look by your best evaluator, allowed while his report is short
AREA_LOOK = 0.5                            # an area scout's weekly look: half a look (the read moves half as far) ...
AREA_CAP = 2.0                             # ... up to this many looks from his area (read["area"]), so four weeks there leave one trip to finish him
CALL_REVEAL = 0.5                          # a call tells you one of his priorities this often; an in-home visit always does
ASK_NARROW = (0.85, 1.15)                  # the ask range after a call; the number itself takes a visit
BASE_POINTS = {"message": 1.0, "call": 2.5, "hc_visit": 6.0, "offer": 4.0, "official_visit": 8.0}   # *tune*
PITCH_PRIORITY = (1.0, 3.0)                # a pitch on one of his three priorities: 1 + 3 * your strength on it (1x weak, 4x strong) *tune*
PITCH_OTHER = (0.3, 0.4)                   # any other topic: 0.3 + 0.4 * strength
BACKFIRE = 0.25                            # a priority pitched at a strength under this backfires (he isn't buying it) ...
BACKFIRE_COST = 0.5                        # ... and costs this much of the action's base points
COLD_OFFER = 0.5                           # an offer before any contact counts this much
STAGES = ("cold", "contact", "top", "visited", "committed")
DIMINISH = 0.2                             # each earlier contact from the school cuts a new one's worth *tune*
WEEKLY_ONCE = ("message", "call")           # each of these once a week per prospect: more contact is not more interest
HC_VISIT_GAP = 4                           # weeks between head coach in-home visits to one prospect
NIL_VALUE = {5: 0.04, 4: 0.07, 3: 0.12, 2: 0.15}   # interest per NIL point by stars: top prospects expect more *tune*
NIL_FLOOR = 30
NIL_PER_TIER = 3.0                         # NIL points a year per point of the program's NIL tier *tune*
# what a prospect wants in NIL points (his ask): by stars, times his position, times a lognormal spread *tune*
ASK = {5: 60, 4: 30, 3: 8, 2: 0}
ASK_POS = {"QB": 1.5, "LEDG": 1.2, "REDG": 1.2, "LT": 1.2, "WR": 1.2, "CB": 1.2, "HB": 0.9, "TE": 0.9, "K": 0.3, "P": 0.3}
ASK_SPREAD = 0.3
ASK_TRAIL = 0.15                           # he wants this much more per place you trail on his list
ASK_SHOWN = (0.7, 1.3)                     # the range shown before a call or visit tells you the number
NIL_OVER = 0.3                             # NIL past his ask counts this much of the usual value
LOWBALL = 0.5                              # an offer under this share of his ask from you is a lowball ...
LOWBALL_MIN = 20                           # ... as is a 0-NIL offer when he asks for at least this
COOL_WEEKS = 3                             # a lowball cools him on you for this long: contacts count half, no visit
COOLED_CONTACT = 0.5
ANSWER_STRAIGHT = 1.0                      # his question about a named player (scenes.question): a straight answer's points ...
ANSWER_PROMISE = 3.0                       # ... a promise he can believe (he would start; he is the better recruit) ...
ANSWER_HOLLOW = 2.0                        # ... and what a hollow one costs (he cools on you a week too) *tune*
PROMISE_MARGIN = 5                         # a roster promise holds when he is within this of the player ahead, or that player is in his last year *tune: tools/check_recruiting.py*
LAST_YEAR = {"JR", "JRRS"}                 # this season's class of a player in his last year next season (the portal's rosters already read next season: LEAVING)
PROMISE_RIVAL = 20                         # firmness lost when the other recruit you promised him over commits to you too
ASK_MORE = (1.5, 1.25)                     # a rival's NIL this much over yours, with you in his top group: his ask from you rises this much
TOP_GROUP = 8                              # the schools he is seriously considering: his top this many by interest
# pestering: contacts past his patience from a school he is not considering cost it *tune*
PESTER_FREE = 3                            # contacts (message, call, in-home visit; a scene's pitch is the contact it finishes) a school gets
#                                            before more count as pestering while he is not considering it (an offer in hand does not
#                                            exempt it; an official visit or his commitment does)
PESTER_TOP = 3                             # he is not considering a school outside his top this many (by interest plus pending, among the
PESTER_SHARE = 0.6                         # schools that worked or offered him) or under this share of his leader's; his leader never
PESTER_COST = 1.5                          # a pestering contact costs this times the action's base points (no pitch bonus) ...
PESTER_RAMP = 0.5                          # ... and each pester costs this much more than the one before
PESTER_ASK = 1.1                           # his ask from the school rises this much per pester (ask_mult, capped at ASK_MULT_MAX overall)
ASK_MULT_MAX = 2.0
# Only your own hand pesters. AI schools (_auto_week acting for them) are exempt, and Auto-recruit acting
# for your school never does it: it skips a contact that would pester and spends the hours elsewhere (and
# _act's `auto` flag keeps the penalty off its contacts regardless). The AI's targeting does not spam, and
# tests/test_sim_golden.py stays byte-identical.
AI_OVER_ASK = 1.1                          # an AI school offers up to this times his ask from it
# generational prospects: a public tag on a few top four- and five-stars, drawn once per class *tune*
GENERATIONAL_FROM = 95                     # true projected overall at least this
GENERATIONAL_ODDS = {5: 0.4, 4: 0.1}       # a qualifying prospect is drawn this often, by stars
GENERATIONAL_MAX = 4                       # at most this many a class (some years none)
GENERATIONAL_ASK = 1.5                     # his NIL ask is this times larger
GEM_RANK = 300                             # a gem is a three-star or less ranked past this
FIND_LOOKS = REPORT_LOOKS                  # looks before your staff names a gem, a bust risk or a generational talent: a complete report
GEM_PERCENTILE = 0.94                      # a gem's potential read beats, even at its low end, this share of his star tier's true potential
BUST_PERCENTILE = 0.0175                   # a bust risk's read sits, even at its high end, under this share of his star tier's (one in 57)
FLAG_HOLD = 4.0                            # a flag found stays until the read moves this far back past its cut (a read's slack, WORD_SLACK): no flicker
LOOK_LOG_KEEP = 30                         # the look log keeps this many of a scout's looks a week (flags, then potential, then the rest)
# the transfer portal as recruiting (offseason.py runs it): four weeks after signing day *tune*
PORTAL_WEEKS = 4
PORTAL_PRIORITY_ODDS = {"playing_time": 0.45, "nil": 0.20, "winning": 0.15, "proximity": 0.10, "prestige": 0.07, "coach": 0.03}
PORTAL_TOP_PRIORITY_ODDS = {"nil": 0.35, "winning": 0.25, "playing_time": 0.18, "prestige": 0.12, "proximity": 0.06, "coach": 0.04}
PORTAL_TOP_TIER = 4                        # an entrant rated a four-star or better draws his priorities from PORTAL_TOP_PRIORITY_ODDS: the best transfers chase NIL and a contender
PORTAL_NATIONAL = 40                       # the best entrants by portal rank are on every Power 4 board (the whole country chases them)
PORTAL_STARTERS = {"QB": 1, "RB": 1, "WR": 3, "TE": 1, "OL": 5, "DL": 4, "LB": 3, "CB": 2, "S": 2, "K": 1, "P": 1}   # a group's starters: an entrant better than the last of them is an upgrade, taken past the group's cap
PORTAL_COMMIT = (0.25, 0.4, 0.6, 1.0)      # an entrant with offers decides at each week's step this often
# the portal runs on this season's money: what a school had left of the year's budget plus a reward
# for the season (shares of the budget, summed then capped), never less than the collective's
# portal fund; what it does not spend carries into next year, capped by the program's tier
REWARD = {"winning": 0.10, "nine_wins": 0.20, "conference": 0.10, "playoff": 0.10, "title": 0.15, "goal": 0.10}
REWARD_CAP = 0.50                          # the reward at most this share of the budget
REWARD_WHY = {"winning": "winning record", "nine_wins": "nine wins", "conference": "conference champion",
              "playoff": "made the playoff", "title": "national champion", "goal": "AD goal met"}
PORTAL_FLOOR = 0.30                        # the collective's portal fund: no program enters the portal with less
CARRY_CAP = {1: 0.15, 2: 0.20, 3: 0.25, 4: 0.30, 5: 0.30}   # the share of next year's budget that may carry over, by program tier
PORTAL_ASK = (25, 0.6)                     # an entrant's ask: this plus this per overall point over 50, times his position
PORTAL_RANK_NOISE = 3.0                    # the public portal ranking: his overall plus this much noise (points)
PORTAL_LOOK = 0.5                          # a staff's look at a transfer errs this much of a high schooler's: there is film
PORTAL_WALK_ON = 0.5                       # an entrant unsigned after the last week takes a walk-on spot this often
PORTAL_CHURN = 8                           # portal spots a Power 4 school (and you) make by releasing the end of the roster
TIER_FROM_OVERALL = ((70, 5), (58, 4), (45, 3), (0, 2))   # a transfer's standing for the boards' star lifts, from his overall
ROSTER_LIMIT = 85                          # EA's roster limit (offseason.ROSTER_LIMIT)
MIN_OPEN = 12
EARLY_LEAVERS = 6                          # returning players expected to leave early (draft, transfers, quitting; offseason.py) *tune*
CLASS_ROOM = 2                             # a class tops out this far over the school's real mean size *tune*
OFFER_FACTOR = 1.5
FCS_LINE = 4.0                             # best FBS interest under this: Leaning FCS *tune*
FCS_NO_OFFER_WEEK = 8                      # from this week a prospect with no FBS offer leans FCS
COMMIT_ODDS = ((0, 0.02), (6, 0.05), (12, 0.08), (16, 0.10), (20, 0.30))   # weekly base chance by week *tune*
COMMIT_FREEZE_WEEKS = 3                     # nobody commits anywhere in the first weeks: time to scout and build a board before the class moves
LEAD_SCALE = 3.0                           # interest lead worth a doubling of the base chance *tune*
VISIT_BOOST = 1.6                          # after an official visit to the leader
DECOMMIT_RATE = 0.45                       # weekly chance of a decommitment at an even race *tune*
# a commitment's firmness, 0-100: it starts soft and firms up only if the school keeps in touch *tune*
FIRM_START, FIRM_VISIT = 40, 60            # at commitment (after an official visit there)
FIRM_TOUCH, FIRM_DRIFT = 8, 3              # a week with a message, call or visit from the school / a quiet week (he still warms to you)
HARD_AT = 90                               # a verbal commit this firm is a hard commit: no flip, no pulled offer, he signs
FIRM_NIL = 3                               # the NIL promised is still held
FIRM_RIVAL, FIRM_RIVALS = -6, 3            # per rival in his top three offering more playing time
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


def attributes(state: dict, p: dict, field: str = "potential") -> dict[str, int]:
    """A prospect's ratings ("ratings") or potential ("potential") by skill, on our scale."""
    return dict(zip(state["recruiting"]["attrs"], p[field]))


def fbs_schools(state: dict) -> list[str]:
    from sim import season
    return sorted(s for s, t in season.load_teams().items() if not t.get("fictional") and s in model()["teams"])


# ----- scouting (spec section 6) *tune* -----
GROUPS = ("athleticism", "size_strength", "technique", "football_iq", "potential", "coachability")
WORDS = ("All-American", "Elite", "Strong", "Solid", "Fair", "Weak")
# words on the game's 1-99 scale (50 is the middle Power 4 starter at the position, 65 one standard
# deviation better, 80 two): Solid is that starter, Strong a clearly better one, Elite an all-conference level
WORD_FLOORS = (90, 80, 65, 50, 40, -1e9)
GRADE_LOW, GRADE_SPAN = 1.0, 98.0          # grades run the whole scale
COACHABILITY_POINTS = {"Coach's Dream": 90, "Film Junkie": 80, "Quick Study": 68, "Steady Grinder": 52,
                       "Slow to Click": 37, "Set in His Ways": 20}
LOOK_SD = (16.0, 4.0)                      # a look's error sd in grade points: 16 * (1 - s) + 4, s = rating / 99
WORD_SLACK = 4.0                           # a word range already spans its end words' width, so the read narrows by this much
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


def _priorities(pid: str, table: Optional[dict] = None) -> list[str]:
    rng = random.Random(f"priorities-{pid}")
    table = table or PRIORITY_ODDS
    topics, odds = list(table), list(table.values())
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
    from sim import season
    taken = {p["name"].lower() for t in season.load_teams().values() for p in t["offense"] + t["defense"]}
    cls = recruits.generate_class(year, seed=state.get("rng_state", 0), taken=taken)
    prospects = {}
    for p in cls:
        p["priorities"] = _priorities(p["id"])
        p["home"] = _home(p)
        hideable = p["stars"] == 2 or (p["stars"] == 3 and p["composite"] < HIDDEN_BELOW)
        p["hidden"] = hideable and random.Random(f"hidden-{year}-{state.get('rng_state', 0)}-{p['id']}").random() < HIDDEN_RATE
        p["nil_ask"] = nil_ask(p, year, state.get("rng_state", 0))
        prospects[p["id"]] = p
    # the class is drawn by a model learned from real players and converted to our scale at once:
    # only our ratings are kept (as lists in one key order), with our overall now and projected
    attrs = game_scale.keys()
    for p in prospects.values():
        ours = game_scale.from_ea(p.pop("ratings_ea"), p["ea_position"])
        pot = game_scale.potential_from_ea(p.pop("potential_ea"), ours, p["ea_position"])
        p["ratings"] = [ours.get(k, 50) for k in attrs]
        p["potential"] = [pot.get(k, 50) for k in attrs]
        p["ovr"], p["pot_ovr"] = game_scale.overall(ours, p["ea_position"]), game_scale.overall(pot, p["ea_position"])
        for k in ("overall_ea", "overall"):
            p.pop(k, None)
    _truths(prospects, attrs)
    state["recruiting"] = {
        "year": year, "prospects": prospects, "lists": {pid: {} for pid in prospects},
        "status": {pid: {"committed": None, "signed": None, "fcs": False} for pid in prospects},
        "offers": {}, "visits": {}, "contacts": {}, "hours": {}, "nil": {}, "revealed": {}, "board": [], "log": [],
        "boards": {}, "seed": state.get("rng_state", 0), "reads": {}, "attrs": attrs, "grades": "game", "scale": "ours",
        "pending": {}, "why": {}, "ranks": {}, "reports": [], "action_points": {}, "leader_changes": {},
    }
    state["recruiting"]["generational"] = draw_generational(state["recruiting"])


def nil_ask(p: dict, year: int, seed) -> int:
    """What he wants in NIL points: his stars and position, with a spread (a transfer: his overall)."""
    rng = random.Random(f"ask-{year}-{seed}-{p['id']}")
    base = max(0.0, PORTAL_ASK[0] + PORTAL_ASK[1] * (p["ovr"] - 50)) if p.get("portal") else ASK.get(p["stars"], 0)
    return int(round(base * ASK_POS.get(p["ea_position"], 1.0) * math.exp(rng.gauss(0, ASK_SPREAD))))


def draw_generational(rc: dict) -> list[str]:
    """The class's generational prospects, highest true potential first: each four- or five-star whose
    true potential is at the top of the scale is drawn on his own seeded odds, the first few kept."""
    cands = sorted((pid for pid, p in rc["prospects"].items()
                    if p["stars"] is not None and p["stars"] >= 4 and p["truth"]["potential"] >= GENERATIONAL_FROM),
                   key=lambda pid: (-rc["prospects"][pid]["truth"]["potential"], pid))
    drawn = [pid for pid in cands
             if random.Random(f"generational-{rc['seed']}-{pid}").random() < GENERATIONAL_ODDS[rc["prospects"][pid]["stars"]]]
    return drawn[:GENERATIONAL_MAX]


def is_generational(state: dict, pid: str) -> bool:
    rc = state.get("recruiting") or {}
    return not rc.get("portal") and pid in (rc.get("generational") or ())


def upgrade_generational(state: dict) -> bool:
    """A career saved before generational prospects: draw its class's. Returns whether it did."""
    rc = state.get("recruiting") or {}
    if not rc.get("prospects") or rc.get("portal") or "generational" in rc:
        return False
    rc["generational"] = draw_generational(rc)
    return True


def tier_of(p: dict) -> int:
    """His standing for the boards' star lifts and NIL values: his stars, or a transfer's from his overall."""
    if p.get("stars") is not None:
        return p["stars"]
    return p.get("tier") or next(t for at, t in TIER_FROM_OVERALL if p["ovr"] >= at)


def _tiers(rc: dict) -> dict[str, int]:
    """Every prospect's tier, once per class (stars and a transfer's overall are fixed all season)."""
    key = _ck(rc)
    cached = _TIERS
    if cached[0] != key or len(cached[1]) != len(rc["prospects"]):
        cached = globals()["_TIERS"] = (key, {pid: tier_of(p) for pid, p in rc["prospects"].items()})
    return cached[1]


_TIERS: tuple = (None, {})


def flag_cuts(rc: dict) -> dict[int, tuple[float, float]]:
    """Each star tier's (gem, bust) cuts on potential: the GEM_PERCENTILE and BUST_PERCENTILE of the
    class's true potential at that star level, once per class (prospects.find reads against them).
    Potential varies nearly as much within a tier as across tiers (about a fifth of two- and
    three-stars project Elite), so an absolute cut names a quarter of the class; a tier-relative one
    names the few who stand out among their own."""
    key = (_ck(rc), rc.get("seed"), len(rc["prospects"]))
    cached = _CUTS
    if cached[0] != key:
        by: dict[int, list[float]] = {}
        for p in rc["prospects"].values():
            if p.get("stars") is not None and p.get("truth"):
                by.setdefault(p["stars"], []).append(p["truth"]["potential"])
        cuts = {}
        for stars, vals in by.items():
            vals.sort()
            cuts[stars] = (_percentile(vals, GEM_PERCENTILE), _percentile(vals, BUST_PERCENTILE))
        cached = globals()["_CUTS"] = (key, cuts)
    return cached[1]


_CUTS: tuple = (None, {})


def _percentile(sorted_vals: list[float], q: float) -> float:
    """The q-quantile of sorted values, interpolated between neighbors (potentials are whole numbers,
    so a nearest-rank cut would jump a whole point and a share of the tier with it)."""
    pos = q * (len(sorted_vals) - 1)
    i = int(pos)
    j = min(i + 1, len(sorted_vals) - 1)
    return round(sorted_vals[i] + (sorted_vals[j] - sorted_vals[i]) * (pos - i), 2)


def _ck(rc: dict):
    """A recruiting block's cache key: its class year, or the portal's own (the two share a year)."""
    return rc.get("cache_key") or rc["year"]


def is_portal(state: dict) -> bool:
    return bool((state.get("recruiting") or {}).get("portal"))


def upgrade_asks(state: dict) -> bool:
    """A career saved before prospects had NIL asks: give them theirs. Returns whether any were added."""
    rc = state.get("recruiting") or {}
    added = False
    for p in (rc.get("prospects") or {}).values():
        if "nil_ask" not in p:
            p["nil_ask"] = nil_ask(p, rc.get("year", 2027), rc.get("seed", 0))
            added = True
    return added


def _contact(state: dict, slug: str, pid: str) -> dict:
    return state["recruiting"]["contacts"].setdefault(pid, {}).setdefault(slug, {"n": 0, "hc_week": None})


_ASKS: dict = {}          # (career, class, week, prospect, school, his ask multiplier) -> his ask from the school this week


def ask_from(state: dict, slug: str, pid: str, win: Optional[dict] = None) -> int:
    """What he wants from `slug`: his ask, raised when a rival's number beat the school's, times
    ASK_TRAIL per place the school trails on his list (as the week's step left it)."""
    rc = state["recruiting"]
    p = rc["prospects"][pid]
    mult = _contact(state, slug, pid).get("ask_mult", 1.0)
    base = p["nil_ask"] * mult
    if not base:
        return 0
    key = (state["id"], _ck(rc), state["current_week"], rc.get("week"), pid, slug, mult)
    ask = _ASKS.get(key)
    if ask is None:
        if len(_ASKS) > 500_000:
            _ASKS.clear()
        schools = set(rc["lists"][pid]) | {slug}
        win = win if win is not None else _winning(state)
        order = sorted(schools, key=lambda s: -interest(state, s, pid, win))
        ask = _ASKS[key] = max(5, _five(base * (1 + ASK_TRAIL * max(0, order.index(slug)))))
    return int(round(ask * GENERATIONAL_ASK)) if is_generational(state, pid) else ask


def ask_view(state: dict, slug: str, pid: str) -> dict:
    """His ask from your school as you know it: the number after a call or visit, a range before."""
    ask = ask_from(state, slug, pid)
    asked = _contact(state, slug, pid).get("asked")
    if asked is True:
        return {"exact": ask}
    lo, hi = ASK_NARROW if asked == "range" else ASK_SHOWN
    return {"lo": max(0, min(ask - 5, _five(ask * lo))), "hi": max(ask + 5, _five(ask * hi))}     # a range in fives that straddles the number


def nil_value(p: dict, nil: int, ask: int) -> float:
    """The interest NIL on an offer is worth: in full up to his ask, NIL_OVER past it."""
    return NIL_VALUE.get(tier_of(p), 0.1) * (min(nil, ask) + NIL_OVER * max(0, nil - ask))


def is_lowball(nil: int, ask: int) -> bool:
    return nil < LOWBALL * ask or (nil == 0 and ask >= LOWBALL_MIN)


def cooled(state: dict, slug: str, pid: str) -> bool:
    """Whether he is cooled on the school after a lowball (contacts count half, no visit)."""
    return (_contact(state, slug, pid).get("cooled_until") or -1) > state["current_week"]


def _pester_exempt(state: dict, slug: str, pid: str) -> bool:
    """He has committed to the school or taken an official visit there: none of its contacts pester."""
    rc = state["recruiting"]
    st = rc["status"][pid]
    return slug in (st["committed"], st["signed"]) or bool((rc["visits"].get(pid, {}).get(slug) or {}).get("done"))


def not_considering(state: dict, slug: str, pid: str, win: Optional[dict] = None) -> bool:
    """He is not considering the school: among the schools that have worked or offered him (the set
    `top_group` reads), ordered by interest plus this week's pending, it sits outside his top
    PESTER_TOP or under PESTER_SHARE of his leader's. His leader never is."""
    rc = state["recruiting"]
    schools = set(rc["lists"][pid]) | {s for s, pids in rc["offers"].items() if pid in pids} | set((rc.get("pending") or {}).get(pid, {})) | {slug}
    win = win if win is not None else _winning(state)
    score = {s: interest(state, s, pid, win) + pending(state, s, pid) for s in schools}
    order = sorted(schools, key=lambda s: -score[s])
    if order[0] == slug:
        return False
    return order.index(slug) >= PESTER_TOP or score[slug] < PESTER_SHARE * score[order[0]]


def would_pester(state: dict, slug: str, pid: str) -> bool:
    """Whether the school's next contact would pester him: PESTER_FREE contacts landed, he is not
    considering the school, no official visit or commitment. Only your school (by hand) ever does."""
    if slug != state.get("team"):
        return False
    c = (state["recruiting"]["contacts"].get(pid) or {}).get(slug) or {}
    if c.get("n", 0) < PESTER_FREE or _pester_exempt(state, slug, pid):
        return False
    return not_considering(state, slug, pid)


def pesters(state: dict, slug: str, pid: str) -> int:
    """How many times the school has pestered him (reset once he is considering it)."""
    return ((state["recruiting"]["contacts"].get(pid) or {}).get(slug) or {}).get("pester", 0)


def upgrade_grades(state: dict) -> None:
    """A career saved when grades were class percentiles in school points: its true grades move
    to the game's scale and each read keeps how far off it was (and its looks)."""
    rc = state["recruiting"]
    old = {pid: dict(p["truth"]) for pid, p in rc["prospects"].items()}
    fresh = {pid: dict(p) for pid, p in rc["prospects"].items()}
    _truths(fresh, rc["attrs"])
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
    from teamdata import build_teams
    pos = build_teams.POSITION_MAP.get(ea_position, ea_position)
    return "LB" if pos in ("MLB", "ROLB", "LOLB") else pos


def _ahead(state: dict, slug: str, group: str, ovr: float) -> int:
    """Returning players at his position group on that roster rated at least as high as him
    (in the portal: next year's roster in the career's league, signees included)."""
    if is_portal(state):
        from coach_career import offseason
        return sum(1 for c in state["league"]["teams"][slug]["roster"] if offseason.GROUP.get(c["pos"]) == group and c["o"] >= ovr)
    return sum(1 for o in _returning(slug, group) if o >= ovr)


def ahead_of(state: dict, slug: str, pid: str) -> Optional[dict]:
    """The best returning player at his position group on that roster rated at least as high as him
    (`_ahead`'s test, the one player it names): {name, position, cls, ovr, slug}, or None. In the
    portal the career league's roster (next year's, signees included); otherwise the season's."""
    p = state["recruiting"]["prospects"][pid]
    group = _group_of(p)
    best = None
    if is_portal(state):
        from coach_career import offseason
        for c in state["league"]["teams"][slug]["roster"]:
            if offseason.GROUP.get(c["pos"]) == group and c["o"] >= p["ovr"] and (best is None or c["o"] > best["ovr"]):
                best = {"name": c["n"], "position": POS_247_OF.get(c["pos"], c["pos"]), "cls": c["cls"], "ovr": c["o"], "slug": c["id"],
                        "last_year": c["cls"] in LEAVING}
        return best
    if not any(o >= p["ovr"] for o in _returning(slug, group)):       # `_ahead`'s own test, so the two always agree
        return None
    from sim import season
    t = season.load_teams()[slug]
    for q in t["offense"] + t["defense"]:
        ovr = q.get("ovr") or 0
        if (("LB" if q["position"] in ("MLB", "ROLB", "LOLB") else q["position"]) == group and q.get("class") not in LEAVING
                and ovr >= p["ovr"] and (best is None or ovr > best["ovr"])):
            best = {"name": q["name"], "position": q["position"], "cls": q.get("class"), "ovr": ovr, "slug": q["slug"],
                    "last_year": q.get("class") in LAST_YEAR}
    return best


def promise_holds(state: dict, slug: str, pid: str, question: dict) -> bool:
    """Whether he can believe your promise: over a roster player, when that player is in his last
    year or the recruit's overall is within PROMISE_MARGIN of his; over another recruit, when the
    recruit is rated at least as high."""
    rc = state["recruiting"]
    p = rc["prospects"][pid]
    about = question["about"]
    if question["kind"] == "roster":
        if "ovr" not in about or "last_year" not in about:          # a scene from before these were kept: read him again
            ahead = ahead_of(state, slug, pid) or {}
            about = {**about, "ovr": ahead.get("ovr", 99), "last_year": ahead.get("last_year", False)}
        return bool(about["last_year"]) or p["ovr"] >= about["ovr"] - PROMISE_MARGIN
    other = rc["prospects"].get(about.get("pid"))
    return other is None or p["ovr"] >= other["ovr"]


def other_offered(state: dict, slug: str, pid: str) -> Optional[dict]:
    """The highest-ranked other recruit at his position group the school has offered who is
    uncommitted or committed to that school: {pid, name, position, rank}, or None."""
    rc = state["recruiting"]
    group = _group_of(rc["prospects"][pid])
    best = None
    for other in rc["offers"].get(slug, []):
        st_ = rc["status"][other]
        if other == pid or st_["signed"] or st_["committed"] not in (None, slug):
            continue
        q = rc["prospects"][other]
        if _group_of(q) == group and (best is None or q["rank"] < best["rank"]):
            best = {"pid": other, "name": q["name"], "position": q["position"], "rank": q["rank"]}
    return best


_LEAVER_CUT: tuple = (None, 0)   # (career and year, the overall at the EARLY_LEAVER_POOL-th best draft-eligible underclassman)


def _early_leaver_cut(state: dict) -> float:
    """The overall from which a draft-eligible underclassman (three years out of high school)
    projects a top-100 pick this season, league-wide."""
    global _LEAVER_CUT
    key = (state["id"], _ck(state["recruiting"]))
    if _LEAVER_CUT[0] != key:
        from sim import season
        from coach_career import offseason
        pool = sorted((p.get("ovr") or 0 for t in season.load_teams().values() if not t["fictional"]
                       for p in t["offense"] + t["defense"] if p.get("class") in offseason.UNDERCLASS_ELIGIBLE), reverse=True)
        _LEAVER_CUT = (key, pool[EARLY_LEAVER_POOL - 1] if len(pool) >= EARLY_LEAVER_POOL else 99)
    return _LEAVER_CUT[1]


_GROUP: dict = {}        # EA position -> roster group (offseason.GROUP, read once)


def _group_of(p: dict) -> str:
    """A prospect's roster group (QB, RB, ... K, P) from his EA position."""
    g = p.get("group")
    if g is None:
        if not _GROUP:
            from coach_career import offseason
            _GROUP.update(offseason.GROUP)
        g = p["group"] = _GROUP.get(p["ea_position"], "S")
    return g


_GROUP_COUNTS: tuple = (None, {})   # (career, class and events so far; every school's commits by group)


def commits_by_group(state: dict, slug: str) -> dict[str, int]:
    """The school's commits and signees this class, by roster group (every school's are counted
    in one pass and kept until the next commitment, signing or flip (`_commit` and `_sign` bump
    `commits_v`; a commitment set any other way needs reset_caches())."""
    global _GROUP_COUNTS
    from coach_career import offseason
    rc = state["recruiting"]
    key = (state["id"], _ck(rc), rc.get("commits_v", 0))
    if _GROUP_COUNTS[0] != key:
        counts: dict[str, dict] = {}
        for pid, st in rc["status"].items():
            school = st["signed"] or st["committed"]
            if school and school != "FCS":
                counts.setdefault(school, {g: 0 for g in offseason.TARGET})[_group_of(rc["prospects"][pid])] += 1
        _GROUP_COUNTS = (key, counts)
    return dict(_GROUP_COUNTS[1].get(slug) or {g: 0 for g in offseason.TARGET})


def needs(state: dict, slug: str) -> dict[str, int]:
    """What the school still needs at each group this class: a healthy 85-man make-up
    (offseason.TARGET) minus the players coming back (seniors gone, the draft-eligible
    underclassmen projecting a top-100 pick part-counted, the usual attrition off the rest)
    minus its commits and signees."""
    from sim import season
    from coach_career import offseason
    if is_portal(state):                       # next year's roster is known: signees in, leavers gone
        back = {g: 0.0 for g in offseason.TARGET}
        for c in state["league"]["teams"][slug]["roster"]:
            back[offseason.GROUP.get(c["pos"], "S")] += 1
        commits = commits_by_group(state, slug)
        return {g: int(round(offseason.TARGET[g] - back[g] - commits[g])) for g in offseason.TARGET}
    t = season.load_teams()[slug]
    cut = _early_leaver_cut(state)
    back = {g: 0.0 for g in offseason.TARGET}
    for p in t["offense"] + t["defense"]:
        g = ENGINE_GROUP.get(p["position"], p["position"])
        if g not in back or p.get("class") in LEAVING:
            continue
        early = p.get("class") in offseason.UNDERCLASS_ELIGIBLE and (p.get("ovr") or 0) >= cut
        back[g] += (1 - EARLY_LEAVER_RATE if early else 1) * (1 - ATTRITION)
    commits = commits_by_group(state, slug)
    out = {g: int(round(offseason.TARGET[g] - back[g] - commits[g])) for g in offseason.TARGET}
    if QB_EVERY_CLASS:
        out["QB"] = max(out["QB"], 1 - commits["QB"])
    return out


def needs_detail(state: dict, slug: str) -> dict[str, dict]:
    """Needs for the page, per roster group: the healthy make-up (target), who comes back, the
    school's commits (firm: FIRM_VISIT and up; soft below), its board and open offers there, and
    what is left (`need`, as needs())."""
    from coach_career import offseason
    rc = state["recruiting"]
    need = needs(state, slug)
    commits = commits_by_group(state, slug)
    offers = offers_by_group(state, slug)
    firm = {g: 0 for g in offseason.TARGET}
    board = {g: 0 for g in offseason.TARGET}
    for pid, st in rc["status"].items():
        if (st["signed"] or st["committed"]) == slug and (st["signed"] or st.get("hard")):
            firm[_group_of(rc["prospects"][pid])] += 1
    for pid in rc["board"] if slug == state["team"] else []:
        st = rc["status"][pid]
        if not st["signed"] and st["committed"] in (None, slug):
            board[_group_of(rc["prospects"][pid])] += 1
    out = {}
    for g, target in offseason.TARGET.items():
        c = commits[g]
        out[g] = {"target": target, "back": max(0, target - need[g] - c), "commits": c, "firm": min(c, firm[g]), "soft": c - min(c, firm[g]),
                  "board": board[g], "offers": offers[g], "need": need[g]}
    return out


RECOMMENDED_WHY = {"home": "from a state you sign from", "near": "close to campus", "national": "a national target for a program like yours",
                   "stars": "the star level you usually sign", "need": "a position you need", "position": "a position you sign every class"}


def recommended(state: dict, slug: str) -> list[dict]:
    """The prospects the Auto-recruit rules would put on your board this week (the same draw the AI
    schools make: fit by state, star level and position, need), not already on it, best fit first,
    each with why he fits. The same list all week."""
    rc = state["recruiting"]
    rng = random.Random(f"recs-{state['id']}-{rc.get('year')}-{state.get('current_week')}")
    board = set(rc["board"]) if slug == state["team"] else set()
    seen = set(prospect_list(state)) if slug == state["team"] else set(rc["prospects"])     # only prospects you can see
    picks = [pid for pid in _build_board(state, slug, rng, touch=False) if pid not in board and pid in seen]
    fits = _fits(state, slug)
    need = needs(state, slug)
    tm = _team_model(slug)
    shares = dict(tm.get("top_states") or [])
    per_class = tm.get("positions_per_class") or {}
    star_share = tm.get("star_share") or {}
    out = []
    for pid in picks:
        p = rc["prospects"][pid]
        g = _group_of(p)
        why = []
        if p["hometown"]["state"] in shares:
            why.append(RECOMMENDED_WHY["home"])
        elif fits[pid] > 0 and tier_of(p) < 4:
            why.append(RECOMMENDED_WHY["near"])
        if tier_of(p) >= 4 and (tm.get("blue_chip_share") or 0) >= 0.25:
            why.append(RECOMMENDED_WHY["national"])
        if star_share.get(STAR_KEY.get(tier_of(p), "2*"), 0.0) / _national_share(tier_of(p)) >= 1:
            why.append(RECOMMENDED_WHY["stars"])
        if need.get(g, 0) >= 1:
            why.append(f"{RECOMMENDED_WHY['need']}: {g} {need[g]} left")
        if per_class.get(POS_247.get(p["position"], p["position"]), 0) >= 1.5:
            why.append(RECOMMENDED_WHY["position"])
        out.append({"pid": pid, "fit": round(fits[pid] * need_factor(need.get(g, 0)), 4), "why": why[:3] or ["fits your usual class"]})
    out.sort(key=lambda r: (-r["fit"], -rc["prospects"][r["pid"]]["composite"], r["pid"]))
    return out


def need_factor(need: int) -> float:
    for at, factor in NEED_FACTOR:
        if need >= at:
            return factor
    return NEED_FLOOR


def offers_by_group(state: dict, slug: str) -> dict[str, int]:
    """The school's open offers by group: to prospects not committed elsewhere (an offer chasing a
    flip does not hold a spot)."""
    from coach_career import offseason
    rc = state["recruiting"]
    out = {g: 0 for g in offseason.TARGET}
    for pid in rc["offers"].get(slug, []):
        st = rc["status"][pid]
        if not st["signed"] and st["committed"] is None:
            out[_group_of(rc["prospects"][pid])] += 1
    return out


def group_cap(need: dict, group: str) -> int:
    """How many a school takes at a group this class: its need plus one (quarterbacks and
    specialists: one unless the need is higher)."""
    return max(1, need[group]) if group in ONE_A_CLASS else need[group] + 1


def group_full(state: dict, slug: str, group: str, need: Optional[dict] = None, commits: Optional[dict] = None,
               offers: Optional[dict] = None) -> bool:
    """Whether a school stops offering at a group: its commits there reach the cap, or its commits
    and open offers reach OFFER_ROOM times the cap (it offers more than it takes) plus one."""
    need = need if need is not None else needs(state, slug)
    commits = commits if commits is not None else commits_by_group(state, slug)
    offers = offers if offers is not None else offers_by_group(state, slug)
    cap = group_cap(need, group)
    return commits[group] >= cap or commits[group] + offers[group] >= math.ceil(OFFER_ROOM * cap) + 1


@lru_cache(maxsize=None)
def _returning(slug: str, group: str) -> tuple:
    from sim import season
    t = season.load_teams()[slug]
    return tuple((p.get("ovr") or 0) for p in t["offense"] + t["defense"]
                 if ("LB" if p["position"] in ("MLB", "ROLB", "LOLB") else p["position"]) == group
                 and p.get("class") not in LEAVING)


def _coach_edge(state: dict, slug: str) -> float:
    if slug == state.get("team") and (state.get("coach") or {}).get("ratings"):
        return ((state["coach"]["ratings"].get("recruiting", 50)) - 50) / 160      # your created coach
    from sim import season
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
    from coach_career import programs
    pr = programs.get(state, slug)
    z = programs.z_of(pr["prestige"] * 0.6 + pr["rating"] * 0.4)       # the brand, with the program's standing today
    zn = programs.z_of(pr["nil"])
    return {
        "proximity": max(PROXIMITY_FLOOR, math.exp(-miles / PROXIMITY_MILES)),
        "playing_time": max(0.1, 1 - _ahead(state, slug, group, p["ovr"]) / (2 * starters + 1)),
        "prestige": _logistic(1.2 * z),
        **({"winning": min(1.0, on_field(state, slug, state["current_week"]))} if winning else {}),
        "nil": _logistic(1.4 * zn),
        "coach": min(1.0, max(0.0, 0.5 + 1.5 * _coach_edge(state, slug))),
        "academics": 0.9 if slug in ACADEMIC else 0.5,
    }


_FORCED: dict = {}        # tests: (career, school, prospect, topic) -> strength


_PULLS: dict = {}         # (career, class, prospect, school) -> the school's pulls that hold all season


def strengths(state: dict, slug: str, pid: str) -> dict[str, float]:
    """Your program's strength on each topic for this prospect, 0-1: the school's pull on him
    (playing time from his place on the depth chart, winning, prestige, proximity, coach,
    academics) with NIL read as your offer against his ask (the program's level before an offer)."""
    key = (state["id"], _ck(state["recruiting"]), pid, slug)
    static = _PULLS.get(key)
    if static is None:
        if len(_PULLS) > 2_000_000:
            _PULLS.clear()
        static = _PULLS[key] = pull(state, slug, pid, winning=False)
    out = dict(static)
    out["winning"] = min(1.0, _winning(state).get(slug, 0.5))
    held = state["recruiting"]["nil"].get(slug, {}).get("held", {}).get(pid)
    if pid in state["recruiting"]["offers"].get(slug, []):
        ask = ask_from(state, slug, pid)
        out["nil"] = 1.0 if not ask else min(1.0, (held or 0) / ask)
    for (sid, s_, p_, topic), v in _FORCED.items():
        if sid == state["id"] and s_ == slug and p_ == pid:
            out[topic] = v
    return {t: round(max(0.0, min(1.0, v)), 3) for t, v in out.items()}


class forced_strength:
    """A test's lever: `with forced_strength(state, slug, pid, topic, value): ...`."""

    def __init__(self, state: dict, slug: str, pid: str, topic: str, value: float):
        self.key, self.value = (state["id"], slug, pid, topic), value

    def __enter__(self):
        _FORCED[self.key] = self.value

    def __exit__(self, *exc):
        _FORCED.pop(self.key, None)


def top_group(state: dict, pid: str, win: Optional[dict] = None) -> list[str]:
    """The schools he is seriously considering: his top TOP_GROUP by interest among those that
    have offered or worked him."""
    rc = state["recruiting"]
    schools = set(rc["lists"][pid]) | {s for s, pids in rc["offers"].items() if pid in pids} | set((rc.get("pending") or {}).get(pid, {}))
    win = win if win is not None else _winning(state)
    return sorted(schools, key=lambda s: -(interest(state, s, pid, win) + pending(state, s, pid)))[:TOP_GROUP]


def stage(state: dict, slug: str, pid: str) -> str:
    """Where the school stands with him: cold, contact, top (his top group, offer in hand),
    visited (an official visit happened) or committed."""
    rc = state["recruiting"]
    if rc["status"][pid]["committed"] == slug or rc["status"][pid]["signed"] == slug:
        return "committed"
    if (rc["visits"].get(pid, {}).get(slug) or {}).get("done"):
        return "visited"
    if pid in rc["offers"].get(slug, []) and slug in top_group(state, pid):
        return "top"
    c = (rc["contacts"].get(pid) or {}).get(slug) or {}
    return "contact" if c.get("n") or pid in rc["offers"].get(slug, []) else "cold"


def on_field(state: dict, slug: str, week: int, records: Optional[dict] = None, ranks: Optional[dict] = None) -> float:
    """Last season blended with this one, this season counting more every week (spec section 3)."""
    from sim import season
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
    key = (state["id"], _ck(state["recruiting"]), pid, slug)
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
    global _WINNING, _FITS, _GROUP_COUNTS, _LEAVER_CUT
    _STATIC.clear()
    _PULLS.clear()
    _ASKS.clear()
    _WINNING, _FITS, _GROUP_COUNTS, _LEAVER_CUT = (None, {}), (None, {}, None), (None, {}), (None, 0)
    _returning.cache_clear()
    _open_spots.cache_clear()
_WINNING: tuple = (None, {})   # (career and week, this week's on-field standing of every school)


def _winning(state: dict) -> dict[str, float]:
    from sim import season
    global _WINNING
    key = (state["id"], state.get("year"), state["current_week"], bool(state.get("done")))
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
    from sim import season
    hc = (season.load_teams()[slug].get("coaches") or {}).get("head_coach") or {}
    return (hc.get("ratings") or {}).get("recruiting", 50)


def weekly_hours(state: dict, slug: str) -> int:
    """A school's recruiting hours a week, a multiple of 5: 50 plus a quarter of its recruiting rating over 50."""
    return 5 * int(round((50 + max(0, _recruiting_rating(state, slug) - 50) / 4) / 5))


def nil_budget(state: dict, slug: str) -> int:
    """A school's NIL points for the year: 3 × its NIL tier (10-100), so the top programs keep the
    budget the recruiting baseline gave (Ohio State about 275) and the middle has room for a few
    blue-chip asks (SMU about 135, Tulane 110). The class adds last year's carry-over (`_nil`)."""
    from coach_career import programs
    return max(NIL_FLOOR, _five(NIL_PER_TIER * programs.get(state, slug)["nil"]))


def _reward_lines(facts: dict) -> list[str]:
    """The reward lines a season earns: a winning record (nine wins replaces it), the conference
    title, the playoff, the national title, the AD's goal met."""
    lines = []
    if facts.get("wins", 0) >= 9:
        lines.append("nine_wins")
    elif facts.get("wins", 0) > facts.get("losses", 0):
        lines.append("winning")
    for k in ("conference", "playoff", "title"):
        if facts.get(k):
            lines.append(k)
    if facts.get("met"):
        lines.append("goal")
    return lines


def reward(budget: int, facts: dict) -> int:
    """The NIL the season just played earns for the portal: the lines' shares of the year's budget,
    summed and capped at REWARD_CAP, in fives. `facts`: wins, losses, conference, playoff, title, met."""
    share = min(REWARD_CAP, sum(REWARD[k] for k in _reward_lines(facts)))
    return _five(share * budget)


def reward_why(facts: dict) -> list[str]:
    """The reward's lines in words, for the review."""
    return [REWARD_WHY[k] for k in _reward_lines(facts)]


def portal_pool(state: dict, slug: str, facts: Optional[dict] = None) -> dict:
    """A school's NIL for the portal: what it had left of the year's budget after signing day plus
    the season's reward, never less than the collective's portal fund (PORTAL_FLOOR of the budget).
    The record the review shows: left, reward, reward_why, floor, pool, record; `retained` (keep
    them home) and, after the portal, `unspent` and `carry` are filled in as they happen."""
    if facts is None:
        from coach_career import offseason
        facts = offseason.season_facts(state).get(slug) or {}
    budget = nil_budget(state, slug)
    rc = state.get("recruiting_last") if is_portal(state) else state.get("recruiting")
    n = (rc or {}).get("nil", {}).get(slug) if rc else None
    left = max(0, n["budget"] - sum(n["held"].values())) if n else budget
    earned = reward(budget, facts)
    floor = _five(PORTAL_FLOOR * budget)
    return {"budget": budget, "left": left, "reward": earned, "reward_why": reward_why(facts), "floor": floor,
            "pool": max(floor, left + earned), "retained": 0, "record": [facts.get("wins", 0), facts.get("losses", 0)]}


def pool_record(state: dict, slug: str) -> dict:
    """The school's portal pool record, seeded by offseason.start (a save from before the pool: seeded now)."""
    pools = state.setdefault("nil_pool", {})
    if slug not in pools:
        pools[slug] = portal_pool(state, slug)
    return pools[slug]


def portal_budget(state: dict, slug: str) -> int:
    """What the school brings to the portal: its pool less what it spent keeping players home."""
    p = pool_record(state, slug)
    return max(0, p["pool"] - p.get("retained", 0))


def carry_over(state: dict, slug: str, unspent: int) -> int:
    """What a school's unspent portal NIL carries into next year: capped at CARRY_CAP of next
    year's budget by the program's tier; anything above is gone."""
    from coach_career import programs
    cap = _five(CARRY_CAP[programs.get(state, slug)["tier"]] * nil_budget(state, slug))
    return max(0, min(5 * (int(unspent) // 5), cap))          # whole fives only: a few stray points are not carried


def _five(x: float) -> int:
    """NIL numbers come in fives: budgets, pools and asks."""
    return int(5 * round(x / 5))


def open_spots(state: dict, slug: str) -> int:
    if is_portal(state):
        return portal_spots(state, slug)
    return _open_spots(slug)


def portal_spots(state: dict, slug: str) -> int:
    """A school's portal spots: the roster limit (plus the end of the roster a Power 4 school or
    you would release) minus next year's roster minus the transfers it has signed."""
    taken = sum(1 for st_ in state["recruiting"]["status"].values() if st_["signed"] == slug)
    extra = PORTAL_CHURN if slug == state.get("team") or _p4(slug) else 0
    return max(0, ROSTER_LIMIT + extra - len(state["league"]["teams"][slug]["roster"]) - taken)


def portal_upgrade(state: dict, slug: str, p: dict) -> bool:
    """Whether a transfer would start for the school: his overall beats the last starter at his
    group on next year's roster. A school takes an upgrade past its group's cap, as a real one does."""
    if not is_portal(state):
        return False
    from coach_career import offseason
    g = p.get("group") or _group_of(p)
    ovrs = sorted((q["o"] for q in state["league"]["teams"][slug]["roster"] if offseason.GROUP.get(q["pos"]) == g), reverse=True)
    n = PORTAL_STARTERS.get(g, 1)
    return p["ovr"] > (ovrs[n - 1] if len(ovrs) >= n else 0)


def _p4(slug: str) -> bool:
    from sim import season
    return season._is_p4(slug, season.load_teams()[slug])


@lru_cache(maxsize=None)
def _open_spots(slug: str) -> int:
    from sim import season
    t = season.load_teams()[slug]
    players = t["offense"] + t["defense"]
    returning = sum(1 for p in players if p.get("class") not in LEAVING)
    limit = ROSTER_LIMIT
    usual = math.ceil(((_team_model(slug).get("class_size") or {}).get("mean")) or 20) + CLASS_ROOM
    return max(MIN_OPEN, min(limit - returning + EARLY_LEAVERS, usual))


def offer_cap(state: dict, slug: str) -> int:
    return math.ceil(OFFER_FACTOR * open_spots(state, slug))


def _contact_points(state: dict, slug: str, p: dict, action: str, pitch: Optional[str]) -> float:
    """What one action is worth to the prospect before diminishing returns: the pitch on one of
    his priorities counts by your strength there (and backfires where you are weak); any other
    topic counts a little."""
    if pitch is None:
        return BASE_POINTS[action]
    strength = strengths(state, slug, p["id"])[pitch]
    if pitch in p["priorities"]:
        if strength < BACKFIRE:
            return -BACKFIRE_COST * BASE_POINTS[action]
        return BASE_POINTS[action] * (PITCH_PRIORITY[0] + PITCH_PRIORITY[1] * strength)
    return BASE_POINTS[action] * (PITCH_OTHER[0] + PITCH_OTHER[1] * strength)


def best_pitch(state: dict, slug: str, pid: str, required: bool = False) -> Optional[str]:
    """The topic a staff pitches: the strongest of the priorities it knows that will not backfire;
    nothing in particular when it knows none (`required`, an offer: its strongest topic)."""
    known = (state["recruiting"]["revealed"].get(slug) or {}).get(pid) or []
    st_ = strengths(state, slug, pid)
    pool = [t for t in known if st_[t] >= BACKFIRE]
    if not pool:
        return max(PITCHES, key=lambda t: st_[t]) if required else None
    return max(pool, key=lambda t: st_[t])


def _hours(state: dict, slug: str) -> float:
    return state["recruiting"]["hours"].setdefault(slug, weekly_hours(state, slug))


def _nil(state: dict, slug: str) -> dict:
    """The school's NIL record this block: in the portal its pool; in the class the year's budget
    plus last year's carry-over, consumed once when the record is created."""
    n = state["recruiting"]["nil"].get(slug)
    if n is None:
        if is_portal(state):
            n = {"budget": portal_budget(state, slug), "held": {}}
        else:                                   # the carry is next season's: the old class block (the offseason still open) leaves it alone
            carry = int((state.get("nil_carry") or {}).pop(slug, 0) or 0) if not state.get("offseason") else 0
            n = {"budget": nil_budget(state, slug) + carry, "held": {}}
            if carry:
                n["carry"] = carry
        state["recruiting"]["nil"][slug] = n
    return n


def nil_left(state: dict, slug: str) -> int:
    n = _nil(state, slug)
    return n["budget"] - sum(n["held"].values())


def _home_game_left(state: dict, slug: str) -> Optional[int]:
    weeks = [g["week"] for g in state["games"].values()
             if g["home"] == slug and g["kind"] == "regular" and not g["played"] and g["week"] > state["current_week"]]
    return min(weeks) if weeks else None


def manual_offers(state: dict, slug: str) -> set[str]:
    """Your offers made by hand (through `act`), which Auto-recruit never pulls; empty for any
    other school (Auto-recruit's own offers and the AI's are never marked)."""
    if slug != state.get("team"):
        return set()
    return set(state["recruiting"].get("manual_offers") or ())


def _unmark(state: dict, slug: str, pid: str) -> None:
    """Your offer to him is gone (pulled by hand, or lapsed when he signed): its hand mark goes too."""
    if slug == state.get("team"):
        marks = state["recruiting"].get("manual_offers")
        if marks and pid in marks:
            marks.remove(pid)


_LAST_LOOK: list = [None]        # the trip's look entry, for the scout action's response


def act(state: dict, slug: str, pid: str, action: str, pitch: Optional[str] = None, nil: int = 0,
        scene: Optional[str] = None, answer: Optional[str] = None) -> dict:
    """One recruiting action by `slug` on prospect `pid` this week. Its interest lands at the week
    step (you see his list move next week), so this returns no interest. Your call or in-home visit
    without a pitch opens a scene (returned); `answer` with the scene's id fields his question
    (`_answer`); `pitch` with the scene's id finishes it and returns his reaction. Raises RecruitingError."""
    rc = state["recruiting"]
    if action == "answer":
        return _answer(state, slug, pid, scene, answer)
    if action == "pitch":
        sc = ((rc.get("scenes") or {}).get(slug) or {}).get(pid)
        start = len(rc["log"])
        revealed = _act(state, slug, pid, action, pitch, nil, scene=scene)
        from coach_career import scenes
        tired = any(e["kind"] == "pester" for e in rc["log"][start:])      # the call or visit pestered him: the pitch fell flat
        said = scenes.reaction(state, slug, pid, sc["action"], pitch, rc["prospects"][pid], tired=tired)
        if slug == state.get("team"):                 # your History: the pitch and how he took it
            _event(state, "pitch", pid, slug, action=sc["action"], pitch=pitch, reaction=said["kind"])
        return {"hours_left": rc["hours"][slug], "reaction": {**said, "revealed": revealed}}
    opens = slug == state.get("team") and action in SCENES and pitch is None
    revealed = _act(state, slug, pid, action, pitch, nil, opens=opens)
    if action == "offer" and slug == state.get("team"):     # your offer by hand: Auto-recruit leaves it be
        marks = rc.setdefault("manual_offers", [])
        if pid not in marks:
            marks.append(pid)
    out = {"hours_left": rc["hours"][slug], "revealed": revealed}
    if action == "scout":                                   # the desk shows the trip's before/after from this, and the like a completed report earned
        from coach_career import prospects as pr
        out["look"] = dict(_LAST_LOOK[0], likes=pr.staff_likes(state, pid, slug))
    if opens:
        out["scene"] = rc["scenes"][slug][pid]
    return out


def clear_scenes(state: dict, slug: str) -> None:
    """Drop the school's open scenes (Auto-recruit took over): no points, the hours stay spent."""
    (state["recruiting"].get("scenes") or {}).pop(slug, None)


def _answer(state: dict, slug: str, pid: str, scene: Optional[str], answer: Optional[str]) -> dict:
    """Your answer to the open scene's question (spec section 3), no hours: straight earns
    ANSWER_STRAIGHT and tells you he cares about playing time; a promise earns ANSWER_PROMISE when
    he can believe it (`promise_holds`) and
    otherwise costs ANSWER_HOLLOW and cools him a week; a deflection does nothing. The points go on
    the scene's action; the answer and his reply are kept on the scene, a promise on his contact."""
    from coach_career import scenes
    rc = state["recruiting"]
    p = rc["prospects"].get(pid)
    if p is None:
        raise RecruitingError(400, "unknown prospect")
    if answer is None:
        raise RecruitingError(422, "answer is required")
    if answer not in scenes.ANSWERS:
        raise RecruitingError(400, "unknown answer")
    sc = ((rc.get("scenes") or {}).get(slug) or {}).get(pid)
    if sc is None or scene is None or sc["id"] != scene:
        raise RecruitingError(409, "no call or visit open")
    q = sc.get("question")
    if not q:
        raise RecruitingError(409, "he asked nothing")
    if q.get("answer"):
        raise RecruitingError(409, "you already answered")
    contact = _contact(state, slug, pid)
    week = state["current_week"]
    points, truthful, revealed = 0.0, None, []
    if answer == "straight":
        points = ANSWER_STRAIGHT
        seen = rc["revealed"].setdefault(slug, {}).setdefault(pid, [])
        if "playing_time" not in seen:
            seen.append("playing_time")
            revealed.append("playing_time")
    elif answer == "promise":
        truthful = promise_holds(state, slug, pid, q)
        if truthful:
            points = ANSWER_PROMISE
        else:
            points = -ANSWER_HOLLOW
            contact["cooled_until"] = week + 1
            _event(state, "not_buying", pid, slug, topic="playing_time")
        contact.setdefault("promises", []).append({"kind": q["kind"], "about": q["about"], "week": week, "broken": None})
    q["answer"] = answer
    q["reply"] = scenes.answer_reply(state, slug, pid, q, answer, truthful)
    _event(state, "answer", pid, slug, action=sc["action"], answer=answer, about=q["about"]["name"], truthful=truthful)
    if points:
        _add_points(state, slug, pid, points, sc["action"])
    return {"scene": sc, "points": points, "truthful": truthful, "revealed": revealed, "hours_left": rc["hours"].get(slug, _hours(state, slug))}


REPORTS_KEPT = 4           # weekly reports kept (the Office shows the latest)
MOVES_SHOWN = 3            # the biggest movers on his list a report names


def _add_points(state: dict, slug: str, pid: str, points: float, action: str) -> None:
    """Interest from an action this week: pending until the week step, with what earned it."""
    rc = state["recruiting"]
    rc.setdefault("pending", {}).setdefault(pid, {})[slug] = rc["pending"].get(pid, {}).get(slug, 0.0) + points
    why = rc.setdefault("why_week", {}).setdefault(pid, {}).setdefault(slug, {})
    why[action] = why.get(action, 0.0) + points
    tally = rc.setdefault("action_points", {}).setdefault(action, [0, 0.0])
    tally[0] += 1
    tally[1] += points


def pending(state: dict, slug: str, pid: str) -> float:
    return (state["recruiting"].get("pending") or {}).get(pid, {}).get(slug, 0.0)


def points_now(state: dict, slug: str, pid: str) -> float:
    """His list points for the school as they stand: landed plus this week's pending."""
    return state["recruiting"]["lists"][pid].get(slug, 0.0) + pending(state, slug, pid)


def _flush(state: dict, week: int) -> None:
    """The week's pending interest lands on the lists; each school's top reason is kept for the moves."""
    rc = state["recruiting"]
    for pid, by in (rc.get("pending") or {}).items():
        for slug, pts in by.items():
            rc["lists"][pid][slug] = rc["lists"][pid].get(slug, 0.0) + pts
    for pid, by in (rc.get("why_week") or {}).items():
        for slug, acts in by.items():
            top = max(acts.items(), key=lambda kv: abs(kv[1]))
            rc.setdefault("why", {}).setdefault(pid, {})[slug] = {"week": week, "action": top[0], "points": round(top[1], 2)}
    rc["pending"], rc["why_week"] = {}, {}
    if rc.get("scenes"):                       # a call or visit you never finished: no points, a line in the report
        me = state.get("team")
        for pid, sc in (rc["scenes"].get(me) or {}).items():
            _event(state, "hung_up", pid, me, action=sc["action"])
        rc["scenes"] = {}


def _snapshot_ranks(state: dict, week: int) -> None:
    """Every prospect's list as of this week step: each school's rank (the week before kept for the moves)."""
    rc = state["recruiting"]
    win = _winning(state)
    ranks = rc.setdefault("ranks", {})
    changed = 0
    for pid, lst in rc["lists"].items():
        schools = set(lst) | {s for s, pids in rc["offers"].items() if pid in pids}
        if not schools:
            continue
        order = sorted(schools, key=lambda s: -interest(state, s, pid, win))
        now = {s: i + 1 for i, s in enumerate(order)}
        prev = (ranks.get(pid) or {}).get("now")
        if prev and next(iter(prev)) != order[0] and min(prev.values()) == 1 and prev.get(order[0]) != 1:
            changed += 1
        ranks[pid] = {"week": week, "now": now, "prev": prev}
    rc.setdefault("leader_changes", {})[str(week)] = changed
    stages = rc.setdefault("stages", {})          # the viewer's board and offers: which column each prospect sits in
    me = state["team"]
    for pid in set(rc["board"]) | set(rc["offers"].get(me, [])):
        old = stages.get(pid) or {}               # an entry older than last week's step is stale: no move from it
        stages[pid] = {"week": week, "now": stage(state, me, pid), "prev": old.get("now") if old.get("week", -99) >= week - 1 else None}


def _report(state: dict, week: int) -> dict:
    """What changed this week for the prospects on your board: your rank on his list, the leader,
    the biggest movers and why, and the events (offers, commitments, flips, asks)."""
    from sim import season
    rc = state["recruiting"]
    me = state.get("team")
    teams = season.load_teams()
    name = lambda s: teams[s]["name"] if s in teams else s
    pids = list(dict.fromkeys(list(rc["board"]) + list(rc["offers"].get(me, []))))
    events, pestered = [], set()
    for e in rc["log"]:
        if e["week"] != week or e["kind"] not in REPORT_KINDS:
            continue
        if e["kind"] == "pester":                 # once per prospect per week, however many contacts wore on him
            if e["pid"] in pestered:
                continue
            pestered.add(e["pid"])
        events.append(e)
    rows = []
    for pid in pids:
        r = rc.get("ranks", {}).get(pid) or {}
        now, prev = r.get("now") or {}, r.get("prev") or {}
        moves = []
        for s_, rk in now.items():
            before = prev.get(s_)
            why = (rc.get("why", {}).get(pid) or {}).get(s_)
            moves.append({"school": s_, "name": name(s_), "from": before, "to": rk,
                          "why": why["action"] if why and why["week"] == week else None,
                          "you": s_ == me})
        moves.sort(key=lambda m: (-(abs((m["from"] or len(now) + 1) - m["to"])), m["to"]))
        leader = next((s_ for s_, rk in now.items() if rk == 1), None)
        p = rc["prospects"][pid]
        rows.append({"pid": pid, "name": p["name"], "position": p["position"], "stars": p["stars"],
                     "rank": now.get(me), "prev_rank": prev.get(me) if prev else None, "of": len(now),
                     "leader": {"school": leader, "name": name(leader)} if leader else None,
                     "moves": [m for m in moves if m["from"] != m["to"]][:MOVES_SHOWN],
                     "events": [dict(e, school_name=name(e["school"]) if e.get("school") else None,
                                     rival_name=name(e["rival"]) if e.get("rival") else None,
                                     **({"line": _pester_line(p["name"], name(e["school"]))} if e["kind"] == "pester" else {}))
                                for e in events if e["pid"] == pid]})
    report = {"week": week, "rows": rows}
    reports = rc.setdefault("reports", [])
    reports.append(report)
    del reports[:-REPORTS_KEPT]
    return report


REPORT_KINDS = ("offer", "commit", "hard", "flip", "decommit", "signed", "asked_more", "not_buying", "hung_up", "pester", "promise_broken")
CONTACT_KINDS = ("contact", "pitch", "raise_nil", "pull_offer", "answer")   # your actions, logged for his History (not news)


def _pester_line(prospect: str, school: str) -> str:
    return f"{prospect} is tuning you out: he is not considering {school}, and more calls push him further away."


def latest_report(state: dict) -> Optional[dict]:
    reports = state["recruiting"].get("reports") or []
    return reports[-1] if reports else None


def _act(state: dict, slug: str, pid: str, action: str, pitch: Optional[str] = None, nil: int = 0,
         scale: float = 1.0, scene: Optional[str] = None, opens: bool = False, auto: bool = False) -> Optional[str]:
    """The one action path every school takes (yours, the AI's, Auto-recruit's). Only `act` passes
    `opens` (your call or visit with no pitch: a scene, no points yet) and `scene` (the pitch that
    finishes it); every other caller keeps the one-shot path. `auto`: Auto-recruit's contact, which
    never pesters him."""
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
    if action == "scout" and rc["status"][pid]["committed"] == slug:
        raise RecruitingError(409, "he has committed to you: no more looks")
    contact = rc["contacts"].setdefault(pid, {}).setdefault(slug, {"n": 0, "hc_week": None})
    week, revealed, points = state["current_week"], None, 0.0
    you = slug == state.get("team")                   # your actions go in the log for his History (the AI's are not kept)
    if action in WEEKLY_ONCE and (contact.get("week") or {}).get(action) == week:
        raise RecruitingError(409, f"you already {'messaged' if action == 'message' else 'called'} him this week")
    if action == "scout" and report_complete(rc["reads"].get(pid)):
        raise RecruitingError(409, f"his report is complete: {REPORT_LOOKS} of {REPORT_LOOKS} looks")
    if opens and pid in ((rc.get("scenes") or {}).get(slug) or {}):
        raise RecruitingError(409, "finish your call with him first")
    if _hours(state, slug) < HOURS[action]:
        raise RecruitingError(409, "not enough hours left this week")
    offers = rc["offers"].setdefault(slug, [])
    if action == "pull_offer":
        if pid not in offers:
            raise RecruitingError(409, "no offer to pull")
        if rc["status"][pid]["committed"] == slug and rc["status"][pid].get("hard"):
            raise RecruitingError(409, "he is a hard commit: his offer stands until he signs")
        offers.remove(pid)
        _unmark(state, slug, pid)
        held = _nil(state, slug)["held"].pop(pid, None)
        if you:
            _event(state, "pull_offer", pid, slug, nil=held or 0)
        if rc["status"][pid]["committed"] == slug and not rc["status"][pid]["signed"]:   # you let your own verbal commit go
            rc["status"][pid].update(committed=None, firmness=None, hard=False)
            rc["commits_v"] = rc.get("commits_v", 0) + 1
            _event(state, "decommit", pid, slug)
    elif action == "offer":
        if pitch is None:
            raise RecruitingError(400, "an offer needs a pitch: what you are selling him")
        if nil > nil_left(state, slug):
            raise RecruitingError(400, "not enough NIL points")
        if pid in offers:
            raise RecruitingError(409, "already offered")
        if len(offers) >= offer_cap(state, slug):
            raise RecruitingError(409, "offer limit reached")
        ask = ask_from(state, slug, pid)
        offers.append(pid)
        if nil:
            _nil(state, slug)["held"][pid] = nil
        _event(state, "offer", pid, slug, nil=nil)
        points = nil_value(p, nil, ask)
        if is_lowball(nil, ask):                # he reads it as a lowball: no points for the offer, and he cools on the school
            contact["cooled_until"] = week + COOL_WEEKS
            contact["lowball"] = True
        else:
            cold = not contact["n"] and not (rc["visits"].get(pid, {}).get(slug) or {}).get("done")
            contact["cold_offer"] = cold
            points += _contact_points(state, slug, p, "offer", pitch) * (COLD_OFFER if cold else 1.0)
    elif action == "raise_nil":
        if pid not in offers:
            raise RecruitingError(409, "no offer to raise")
        held = _nil(state, slug)["held"].get(pid, 0)
        if nil <= held:
            raise RecruitingError(400, "raise it above what you offered")
        if nil - held > nil_left(state, slug):
            raise RecruitingError(400, "not enough NIL points")
        ask = ask_from(state, slug, pid)
        _nil(state, slug)["held"][pid] = nil
        if you:
            _event(state, "raise_nil", pid, slug, nil=nil)
        points = nil_value(p, nil, ask) - nil_value(p, held, ask)
        if nil >= ask and contact.get("cooled_until"):     # meeting his ask ends the cooling
            contact.pop("cooled_until", None)
            points += _contact_points(state, slug, p, "offer", None)      # and the offer itself counts now
    elif action == "official_visit":
        if cooled(state, slug, pid):
            raise RecruitingError(409, "he has cooled on you after that offer: raise it to what he wants")
        if slug not in top_group(state, pid):
            raise RecruitingError(409, "he is not considering you yet: get into his top group first")
        if slug in rc["visits"].get(pid, {}):
            raise RecruitingError(409, "one official visit per school")
        if is_portal(state):                       # a campus visit: this week, no game; he sees it all
            rc["visits"].setdefault(pid, {})[slug] = {"week": week, "done": True}
            while _reveal(state, slug, pid):
                pass
            contact.update(asked=True, last_contact=week)
            contact.pop("pester", None)
            points = BASE_POINTS["official_visit"]
        else:
            game_week = _home_game_left(state, slug)
            if game_week is None:
                raise RecruitingError(409, "no home game left for a visit")
            rc["visits"].setdefault(pid, {})[slug] = {"week": game_week, "done": False}
        if you:
            _event(state, "contact", pid, slug, action=action)
    elif action == "pitch":                        # your scene's pitch: the stored call or visit's points, as the one-shot rule
        sc = ((rc.get("scenes") or {}).get(slug) or {}).get(pid)
        if sc is None or scene is None or sc["id"] != scene:
            raise RecruitingError(409, "no open call or visit with him")
        if sc.get("question") and not sc["question"].get("answer"):
            raise RecruitingError(409, "answer him first")
        if pitch is None:
            raise RecruitingError(400, "a pitch: what you are selling him")
        if pitch in p["priorities"]:                  # he tells you plainly when it is one of his
            seen = rc["revealed"].setdefault(slug, {}).setdefault(pid, [])
            if pitch not in seen:
                seen.append(pitch)
        points = _contact_land(state, slug, p, contact, sc["action"], pitch, auto)
        del rc["scenes"][slug][pid]
        if points:                                    # the points are the call's or the visit's; its hours went when it opened
            _add_points(state, slug, pid, points * scale, sc["action"])
        return pitch if pitch in p["priorities"] else None      # a hit or a quiet one tells you his priority
    elif action == "scout":                        # a scouting trip: your best evaluator's look, no contact with him
        contact["scouted"] = contact.get("scouted", 0) + 1       # trips sent, a tally; the gate is his report's looks
        if you:
            _event(state, "contact", pid, slug, action=action)
        staff = (state.get("career") or {}).get("staff") or []
        rating = max([m.get("evaluation", 50) for m in staff] + [((state.get("coach") or {}).get("ratings") or {}).get("evaluation", 60)])
        rng = random.Random(f"scout-{rc['seed']}-{slug}-{pid}-{week}-{contact['scouted']}")
        _LAST_LOOK[0] = look(state, pid, rating, rng)          # one look, SEND_LOOK, or what is left of his report
    else:
        if action == "hc_visit":
            if contact["hc_week"] is not None and week - contact["hc_week"] < HC_VISIT_GAP:
                raise RecruitingError(409, "one in-home visit a month")
            contact["hc_week"] = week
        if you:                                       # a message, call or in-home visit (a scene's pitch is logged when it lands)
            _event(state, "contact", pid, slug, action=action, **({"pitch": pitch} if pitch else {}))
        if action in WEEKLY_ONCE:
            contact.setdefault("week", {})[action] = week
        if opens:                                     # your scene: the contact is marked, his lines and cue stored; no points until the pitch
            contact["asked"] = True if action == "hc_visit" or contact.get("asked") is True else "range"
            contact["last_contact"] = week
            from coach_career import scenes
            rc.setdefault("scenes", {}).setdefault(slug, {})[pid] = scenes.open_scene(state, slug, pid, action, week)
        elif action == "hc_visit":                    # an in-home visit tells you one thing he cares about, and his number
            revealed = _reveal(state, slug, pid)
            contact["asked"] = True
        elif action == "call":                        # a call: sometimes a priority, and about what he wants
            if random.Random(f"call-{rc['seed']}-{slug}-{pid}-{week}").random() < CALL_REVEAL:
                revealed = _reveal(state, slug, pid)
            if contact.get("asked") is not True:
                contact["asked"] = "range"
        if not opens:
            contact["last_contact"] = week
            points = _contact_land(state, slug, p, contact, action, pitch, auto)
    rc["hours"][slug] = _hours(state, slug) - HOURS[action]
    if points:
        _add_points(state, slug, pid, points * scale, action)
    return revealed


def _contact_land(state: dict, slug: str, p: dict, contact: dict, action: str, pitch: Optional[str],
                  auto: bool = False) -> float:
    """A contact's points (a message, call or visit, one-shot or a scene's pitch): the pitch's worth
    cut by earlier contacts, halved while he is cooled; a backfire is logged. Past PESTER_FREE
    contacts from your hand while he is not considering you (`not_considering`), the contact pesters him instead: negative
    points that grow with each pester, the pitch ignored, his ask from you up (not Auto-recruit's,
    never an AI school's)."""
    pid = p["id"]
    if not auto and slug == state.get("team") and contact["n"] >= PESTER_FREE and not _pester_exempt(state, slug, pid):
        if not not_considering(state, slug, pid):
            contact.pop("pester", None)           # he is considering you: the old pesters are forgotten
        else:
            k = contact.get("pester", 0)
            contact["pester"] = k + 1
            contact["ask_mult"] = round(min(ASK_MULT_MAX, contact.get("ask_mult", 1.0) * PESTER_ASK), 3)
            _event(state, "pester", pid, slug, action=action, n=k + 1)
            points = -(PESTER_COST * BASE_POINTS[action]) * (1 + PESTER_RAMP * k)
            if cooled(state, slug, pid):
                points *= COOLED_CONTACT
            contact["n"] += 1
            return points
    points = _contact_points(state, slug, p, action, pitch) / (1 + DIMINISH * contact["n"])
    if points < 0:
        _event(state, "not_buying", pid, slug, topic=pitch)
    if cooled(state, slug, pid):
        points *= COOLED_CONTACT
    contact["n"] += 1
    return points


def _forgive_pesters(state: dict) -> None:
    """A school he has come to consider (or that hosted or landed him) starts clean: a later slide
    does not carry the old pesters. Only your school ever has any."""
    rc, me = state["recruiting"], state.get("team")
    for pid, by in rc["contacts"].items():
        c = by.get(me)
        if c and c.get("pester") and (_pester_exempt(state, me, pid) or not not_considering(state, me, pid)):
            c.pop("pester")


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
    tiers = {pid: tier_of(p) for pid, p in prospects.items()}
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
        tier = tiers[pid]
        if tier >= 4:
            w += reach
        pos = per_class.get(POS_247.get(p["position"], p["position"]), 1.0)
        out[pid] = w * lift.get(tier, lift[2]) * (0.9 + 0.2 * min(1.0, pos / 2))
    return out


def _pool(state: dict) -> dict:
    """The class's prospects by home state, for spreading schools' state shares."""
    pros = state["recruiting"]["prospects"].values()
    states: dict[str, int] = {}
    for p in pros:
        states[p["hometown"]["state"]] = states.get(p["hometown"]["state"], 0) + 1
    return {"states": states, "total": len(pros), "blue_chips": max(1, sum(1 for p in pros if tier_of(p) >= 4))}


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
    key = (state["id"], _ck(rc))
    cached = _FITS
    if cached[0] != key:
        cached = _FITS = (key, {}, _pool(state))
    fits = cached[1].get(slug)
    if fits is None:
        fits = cached[1][slug] = _fit_all(slug, rc["prospects"], cached[2])
    return fits


def _build_board(state: dict, slug: str, rng: random.Random, touch: bool = True) -> list[str]:
    rc = state["recruiting"]
    free = [pid for pid, st in rc["status"].items() if not st["signed"] and not st["committed"]]
    # weighted sampling without replacement (key u^(1/fit)): the board's mix of states and star
    # levels follows the school's real shares instead of always taking its home state first
    keyed, fits = [], _fits(state, slug)
    need = needs(state, slug)
    factor_of = {g: need_factor(n) for g, n in need.items()}
    tm0 = _team_model(slug)
    takes_fives = ((tm0.get("star_share") or {}).get("5*", 0.0) / _national_share(5)) >= 1   # a blue blood takes a five-star anywhere
    pros = rc["prospects"]
    tiers = _tiers(rc)
    for pid in free:
        p = pros[pid]
        factor = factor_of[p.get("group") or _group_of(p)]
        if takes_fives and tiers[pid] == 5:
            factor = max(factor, FIVE_STAR_FLOOR)
        f = fits[pid] * factor
        if f > 0:
            keyed.append((math.log(rng.random() or 1e-12) / f, pid))
    keyed.sort(reverse=True)
    sampled = [pid for _, pid in keyed[:BOARD_FACTOR * open_spots(state, slug)]]
    # blue-chip programs chase the best four- and five-stars nationally, ahead of the rest
    tm = _team_model(slug)
    n = round(NATIONAL_TARGETS * (tm.get("blue_chip_share") or 0.0)) if (tm.get("blue_chip_share") or 0) >= 0.25 else 0
    # the school's star lift at each tier, once (the same expression the per-prospect lambda evaluated)
    lift_at = {t: (tm.get("star_share") or {}).get(STAR_KEY.get(t, "2*"), 0.0) / _national_share(t) for t in (4, 5)}
    keyed = []
    for pid in free:
        tier = tiers[pid]
        if tier >= 4 and lift_at[tier] >= 1:
            p = pros[pid]
            weight = lift_at[tier] * math.exp(NATIONAL_TILT * (p["composite"] - 0.9))
            keyed.append((math.log(rng.random() or 1e-12) / weight, pid))
    national = [pid for _, pid in sorted(keyed, reverse=True)[:n]]
    if is_portal(state) and _p4(slug):     # the portal: the best entrants hear from every Power 4 program
        national = sorted((pid for pid in free if pros[pid]["rank"] <= PORTAL_NATIONAL), key=lambda q: pros[q]["rank"]) + national
    board = list(dict.fromkeys(national + sampled))
    for pid in board if touch else []:   # a board is prospects the staff has evaluated and spoken to: not cold, one priority known
        c = _contact(state, slug, pid)
        if not c["n"]:
            c["n"] = 1
            _reveal(state, slug, pid)
    return board


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
    if (week >= LATE_MARKET or is_portal(state)) and spots_left > 0:        # the late market: whoever is still out there is worth a look
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
    kept = manual_offers(state, slug)          # your offers by hand: never pulled here (a signing elsewhere still ends one)
    for pid in [q for q in offers if rc["status"][q]["committed"] not in (None, slug)
                and (rc["status"][q]["signed"] or (rc["prospects"][q]["rank"] > RIVAL_RANK and q not in kept))]:
        offers.remove(pid)                     # he went elsewhere: the offer frees up (a top prospect is still chased)
        _unmark(state, slug, pid)
        _nil(state, slug)["held"].pop(pid, None)
    edge = 1 + _coach_edge(state, slug)
    allowed = math.ceil(offer_cap(state, slug) * (1.0 if is_portal(state) else min(1.0, 0.35 + 0.65 * week / 8) * (LATE_OFFERS if week >= LATE_MARKET else 1.0)))
    budget = _nil(state, slug)["budget"]
    known = rc["revealed"].get(slug, {})
    win = _winning(state)
    need, commits = needs(state, slug), commits_by_group(state, slug)
    for pid in list(offers):                   # a group at its cap: the open offers there are pulled (no more chasing flips), yours by hand kept
        if pid not in kept and rc["status"][pid]["committed"] != slug and not rc["status"][pid]["signed"] \
                and commits[_group_of(rc["prospects"][pid])] >= group_cap(need, _group_of(rc["prospects"][pid])):
            offers.remove(pid)
            _nil(state, slug)["held"].pop(pid, None)
    open_ = offers_by_group(state, slug)
    for pid in board:                          # its board's order (the board already leans to the thin groups); the caps hold
        if len(offers) >= allowed:
            break
        if pid not in offers and rc["status"][pid]["committed"] is None:
            p = rc["prospects"][pid]
            g = _group_of(p)
            if group_full(state, slug, g, need, commits, open_) and not portal_upgrade(state, slug, p):
                continue
            open_[g] += 1
            nil = min(nil_left(state, slug), round(budget * AI_NIL.get(tier_of(p), 0)), round(AI_OVER_ASK * ask_from(state, slug, pid, win)))
            try:
                _act(state, slug, pid, "offer", pitch=best_pitch(state, slug, pid, required=True), nil=nil, scale=edge)
            except RecruitingError:
                break
    for pid in offers:                          # asked for more: raise once to his ask, as the budget allows
        c = _contact(state, slug, pid)
        if c.get("asked_more") and not c.get("ai_raised") and rc["status"][pid]["committed"] in (None, slug):
            want = min(ask_from(state, slug, pid, win), _nil(state, slug)["held"].get(pid, 0) + nil_left(state, slug))
            c["ai_raised"] = True
            if want > _nil(state, slug)["held"].get(pid, 0):
                try:
                    _act(state, slug, pid, "raise_nil", nil=want, scale=edge)
                except RecruitingError:
                    pass
    targets = [pid for pid in offers if rc["status"][pid]["committed"] is None and not rc["status"][pid]["signed"]]
    targets += [pid for pid in offers if rc["status"][pid]["committed"] not in (None, slug) and not rc["status"][pid]["signed"]]
    for pid in targets[:2]:
        if slug not in rc["visits"].get(pid, {}):
            try:
                _act(state, slug, pid, "official_visit")
            except RecruitingError:
                pass
    targets = [pid for pid in targets if not would_pester(state, slug, pid)]   # your staff on Auto never pester: those hours go elsewhere
    if targets:
        try:
            _act(state, slug, targets[0], "hc_visit", pitch=best_pitch(state, slug, targets[0]), scale=edge, auto=True)
        except RecruitingError:
            pass
    for action in ("call", "message"):          # each target a call and a message a week, as the hours allow
        for pid in targets:
            if _hours(state, slug) < HOURS[action]:
                break
            try:
                _act(state, slug, pid, action, pitch=best_pitch(state, slug, pid), scale=edge, auto=True)
            except RecruitingError:
                pass
    for pid in [q for q in offers if rc["status"][q]["committed"] == slug and not rc["status"][q]["signed"]]:
        if _hours(state, slug) < HOURS["message"]:
            break                              # out of hours: the commits go quiet this week and soften
        try:                                   # a message a week keeps a commitment firm
            _act(state, slug, pid, "message", pitch=best_pitch(state, slug, pid), scale=edge, auto=True)
        except RecruitingError:
            pass


def _visits(state: dict, week: int) -> None:
    """Official visits at this week's home games: a win sells, a blowout loss hurts, a big crowd helps."""
    rc = state["recruiting"]
    from sim import season
    for pid, by_school in rc["visits"].items():
        for slug, v in by_school.items():
            if v["done"] or v["week"] != week:
                continue
            game = next((g for g in state["games"].values() if g["week"] == week and g["home"] == slug and g["played"]), None)
            v["done"] = True
            if game is None:
                continue
            while _reveal(state, slug, pid):     # a weekend on campus: you learn everything he cares about, his ask too
                pass
            _contact(state, slug, pid).update(asked=True, last_contact=week)
            _contact(state, slug, pid).pop("pester", None)     # a weekend on campus clears the air
            margin = game["home_score"] - game["away_score"]
            mood = 1.2 if margin > 0 else (0.6 if margin <= -21 else 0.9)
            cap = ((season.load_teams()[slug].get("stadium") or {}).get("capacity") or 50000)
            crowd = min(1.15, max(0.85, cap / 80000))
            _add_points(state, slug, pid, BASE_POINTS["official_visit"] * mood * crowd, "official_visit")


def _offers_by_prospect(state: dict) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for slug, pids in state["recruiting"]["offers"].items():
        for pid in pids:
            out.setdefault(pid, []).append(slug)
    return out


def _commit(state: dict, pid: str, slug: str, kind: str = "commit") -> None:
    rc = state["recruiting"]
    old = rc["status"][pid]["committed"]
    visited = bool((rc["visits"].get(pid, {}).get(slug) or {}).get("done"))
    rc["status"][pid].update(committed=slug, fcs=False, firmness=FIRM_VISIT if visited else FIRM_START, hard=False)
    rc["commits_v"] = rc.get("commits_v", 0) + 1
    for school, n in rc["nil"].items():           # rivals' NIL packages for him are released
        if school != slug:
            n["held"].pop(pid, None)
    _event(state, kind, pid, slug, **({"from": old} if old else {}))


def flip_weekly(state: dict, pid: str, gap: float, firmness: Optional[float] = None) -> float:
    """This week's chance a commit flips, from the best rival's lead in interest and how firm he is.
    A hard commit never flips."""
    st = state["recruiting"]["status"][pid]
    if st.get("hard"):
        return 0.0
    if firmness is None:
        firmness = st.get("firmness") or FIRM_START
    if firmness >= HARD_AT:
        return 0.0
    return 2 * DECOMMIT_RATE * _logistic(gap / FLIP_MARGIN) * (100 - firmness) / 100


def flip_by_signing(state: dict, pid: str, gap: float, weeks_left: int) -> float:
    """His chance to flip before signing day, his commitment firming up FIRM_TOUCH + FIRM_NIL a week
    as a school that keeps in touch would see it, and locking hard at HARD_AT."""
    st = state["recruiting"]["status"][pid]
    if st.get("hard"):
        return 0.0
    f = st.get("firmness") or FIRM_START
    keep = 1.0
    for _ in range(max(0, weeks_left)):
        if f >= HARD_AT:
            break
        keep *= 1 - flip_weekly(state, pid, gap, f)
        f = min(100, f + FIRM_TOUCH + FIRM_NIL)
    return 1 - keep


def _promises(state: dict, week: int) -> None:
    """Promises follow him (spec section 4): a recruit told he was the one over another recruit
    (a "recruit" promise) remembers when that recruit commits to the school too, once: committed
    to the school, his firmness drops PROMISE_RIVAL (a hard commit is immune); otherwise he cools on
    it for COOL_WEEKS. The promise is marked broken and a promise_broken event logged either way."""
    rc = state["recruiting"]
    for pid, by in rc["contacts"].items():
        for slug, c in by.items():
            for pr in c.get("promises") or ():
                if pr["kind"] != "recruit" or pr.get("broken") is not None:
                    continue
                other = rc["status"].get(pr["about"].get("pid"))
                if not other or slug not in (other["committed"], other["signed"]):
                    continue
                st_ = rc["status"][pid]
                if st_["signed"]:
                    continue
                if st_["committed"] == slug:
                    if st_.get("hard"):
                        continue
                    st_["firmness"] = int(max(0, (st_.get("firmness") or FIRM_START) - PROMISE_RIVAL))
                else:
                    c["cooled_until"] = week + COOL_WEEKS
                pr["broken"] = week
                _event(state, "promise_broken", pid, slug, about=pr["about"]["name"], other=pr["about"].get("pid"))


def _firm_up(state: dict, week: int) -> None:
    """Every verbal commitment firms up with the week: he warms to his school on his own
    (FIRM_DRIFT), faster with contact from it (FIRM_TOUCH) and the NIL still held, and cools
    when rivals in his top three offer more playing time. At HARD_AT he is a hard commit and
    nothing moves him again."""
    rc = state["recruiting"]
    win = _winning(state)
    for pid, st_ in rc["status"].items():
        school = st_["committed"]
        if st_["signed"] or not school or school == "FCS" or st_.get("hard"):
            continue
        c = (rc["contacts"].get(pid) or {}).get(school) or {}
        delta = FIRM_TOUCH if c.get("last_contact") == week else FIRM_DRIFT
        if rc["nil"].get(school, {}).get("held", {}).get(pid, 0) > 0 and pid in rc["offers"].get(school, []):
            delta += FIRM_NIL
        rivals = [s for s in top_group(state, pid, win) if s != school and pid in rc["offers"].get(s, [])][:FIRM_RIVALS]
        if rivals:
            mine = strengths(state, school, pid)["playing_time"]
            delta += FIRM_RIVAL * sum(1 for r in rivals if strengths(state, r, pid)["playing_time"] > mine)
        st_["firmness"] = int(max(0, min(100, st_.get("firmness", FIRM_START) + delta)))
        if st_["firmness"] >= HARD_AT:
            st_["hard"] = True
            _event(state, "hard", pid, school)


def _class_by_position(state: dict) -> dict[tuple, list[float]]:
    rc = state["recruiting"]
    out: dict[tuple, list[float]] = {}
    for pid, st in rc["status"].items():
        if st["committed"] and st["committed"] != "FCS":
            p = rc["prospects"][pid]
            out.setdefault((st["committed"], p["position"]), []).append(p["composite"])
    return out


class _Room:
    """Where a school can still take a prospect: a spot in the class and room at his group (its
    commits under the group's cap). Recruiting by hand, you may oversign a group you offered; in
    the late market (`flier`: from LATE_MARKET and on signing day) every school takes one past a cap."""

    def __init__(self, state: dict, flier: bool = False):
        self.state, self.commits = state, _commits(state)
        self.groups: dict[str, tuple[dict, dict]] = {}
        self.slack = 1 if flier else 0
        self.yours = state.get("team") if auto_mode(state) == "off" else None

    def _at(self, slug: str) -> tuple[dict, dict]:
        if slug not in self.groups:
            self.groups[slug] = (needs(self.state, slug), commits_by_group(self.state, slug))
        return self.groups[slug]

    def __call__(self, slug: str, pid: str) -> bool:
        if self.commits.get(slug, 0) >= open_spots(self.state, slug):
            return False
        if slug == self.yours and pid in self.state["recruiting"]["offers"].get(slug, []):
            return True                                 # you offered him: your call to oversign
        need, com = self._at(slug)
        p = self.state["recruiting"]["prospects"][pid]
        g = _group_of(p)
        return com[g] < group_cap(need, g) + self.slack or portal_upgrade(self.state, slug, p)

    def took(self, slug: str, pid: str, n: int = 1) -> None:
        self.commits[slug] = self.commits.get(slug, 0) + n
        self._at(slug)[1][_group_of(self.state["recruiting"]["prospects"][pid])] += n


def _draws(state: dict, week: int, rng: random.Random) -> None:
    rc = state["recruiting"]
    room = _Room(state, flier=week >= LATE_MARKET)
    commits = room.commits
    base = 0.0 if week < COMMIT_FREEZE_WEEKS else _interp(COMMIT_ODDS, week)
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
        if st["committed"] and not st.get("hard"):
            mine = score(st["committed"], pid)
            rival = next(((v, s) for v, s in scores if s != st["committed"] and room(s, pid)), None)
            if rival and rng.random() < flip_weekly(state, pid, rival[0] - mine):
                room.took(st["committed"], pid, -1)
                _event(state, "decommit", pid, st["committed"])
                _commit(state, pid, rival[1], "flip")
                room.took(rival[1], pid)
                by_pos.setdefault((rival[1], rc["prospects"][pid]["position"]), []).append(rc["prospects"][pid]["composite"])
            continue
        scores = [(v, s) for v, s in scores if room(s, pid)]
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
            room.took(leader, pid)
            by_pos.setdefault((leader, rc["prospects"][pid]["position"]), []).append(rc["prospects"][pid]["composite"])


def _sign(state: dict, final: bool) -> None:
    """Early signing period: every committed prospect signs. Signing day (final): the rest go to
    their leader with room, or to an FCS program."""
    rc = state["recruiting"]
    if final:
        room, win, offered = _Room(state, flier=True), _winning(state), _offers_by_prospect(state)
        for pid in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"]):
            st = rc["status"][pid]
            if st["committed"]:
                continue
            schools = set(offered.get(pid, [])) | set(rc["lists"][pid])
            scores = sorted(((interest(state, s, pid, win), s) for s in schools if room(s, pid)), reverse=True)
            if scores and scores[0][0] >= FCS_LINE:
                _commit(state, pid, scores[0][1])
                room.took(scores[0][1], pid)
    rc["commits_v"] = rc.get("commits_v", 0) + 1
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
                _unmark(state, school, pid)
                rc["nil"].get(school, {}).get("held", {}).pop(pid, None)


AUTO_MODES = ("off", "week", "season")


def auto_mode(state: dict) -> str:
    """Your Auto-recruit: "off", "week" (this coming week only) or "season" (saves from before the
    one-week option stored true or false)."""
    v = ((state.get("career") or {}).get("settings") or {}).get("auto_recruit")
    return "season" if v is True else v if v in AUTO_MODES else "off"


def _asks_for_more(state: dict, week: int) -> None:
    """A prospect who has heard a bigger number: when a rival's NIL on him is ASK_MORE[0] times a
    school's and that school is in his top group, his ask from it rises ASK_MORE[1], once per rival."""
    rc = state["recruiting"]
    win = _winning(state)
    by_pid: dict[str, dict] = {}
    for slug, n in rc["nil"].items():
        for pid, held in n["held"].items():
            if pid in rc["offers"].get(slug, []):
                by_pid.setdefault(pid, {})[slug] = held
    for pid, held in by_pid.items():
        if len(held) < 2 or rc["status"][pid]["signed"] or not rc["prospects"][pid]["nil_ask"]:
            continue
        top = sorted(held, key=lambda s: -interest(state, s, pid, win))[:TOP_GROUP]
        for slug in top:
            c = _contact(state, slug, pid)
            heard = c.setdefault("heard", [])
            for rival, theirs in held.items():
                if rival != slug and rival not in heard and theirs >= ASK_MORE[0] * max(1, held[slug]):
                    heard.append(rival)
                    c["ask_mult"] = round(c.get("ask_mult", 1.0) * ASK_MORE[1], 3)
                    c["asked_more"] = True
                    _event(state, "asked_more", pid, slug, rival=rival)


def weekly_step(state: dict, week: int, auto_user: bool = False) -> list[dict]:
    """The recruiting week after `week`'s games: visits, every AI school (and yours on Auto),
    commitment draws, signing, then the hours reset. Returns the week's events. In the portal
    `week` is the portal week (1-4) and entrants decide at each step instead of committing."""
    from sim import season
    rc = state["recruiting"]
    start_log = len(rc["log"])
    rng = random.Random(f"recruiting-{rc['seed']}-{'portal-' if rc.get('portal') else ''}{week}")
    _flush(state, week)                # your week's actions land
    if not rc.get("portal"):
        _visits(state, week)
    scout_week(state, week + 1 if rc.get("portal") else week)   # the portal's week counter moves after the step
    mine = state.get("team")
    mode = auto_mode(state)
    auto_mine = auto_user or mode != "off"
    _asks_for_more(state, week)
    commits = _commits(state)          # AI weeks change offers and interest, not commitments
    for slug in fbs_schools(state):
        if slug != mine or auto_mine:
            auto_recruit(state, slug, random.Random(f"auto-{rc['seed']}-{slug}-{week}"), commits, yours=slug == mine)
    _flush(state, week)                # the other schools' week lands with yours
    _forgive_pesters(state)
    if rc.get("portal"):
        _portal_draws(state, week, rng)
    else:
        _promises(state, week)         # the recruit you promised him over committed too: he remembers
        _firm_up(state, week)
        if week < season.FINAL_WEEK:
            _draws(state, week, rng)
        if week == season.SELECTION_WEEK:
            _sign(state, final=False)
        if week >= season.FINAL_WEEK:
            _sign(state, final=True)
    _snapshot_ranks(state, week)
    _report(state, week)
    rc["hours"] = {}
    if mode == "week":                       # Auto-recruit for one week: done, so off again
        state["career"]["settings"]["auto_recruit"] = "off"
    return rc["log"][start_log:]


def _portal_draws(state: dict, week: int, rng: random.Random) -> None:
    """A portal week's decisions: each entrant with offers decides with PORTAL_COMMIT's chance for
    the week, best players first, for the school he likes best with room (less the transfers it
    already took at his position rated at least as high); a decision is a signing."""
    rc = state["recruiting"]
    room = _Room(state, flier=week >= PORTAL_WEEKS)
    win, offered = _winning(state), _offers_by_prospect(state)
    taken: dict[tuple, list[float]] = {}
    for pid, st_ in rc["status"].items():
        if st_["signed"]:
            taken.setdefault((st_["signed"], rc["prospects"][pid]["position"]), []).append(rc["prospects"][pid]["composite"])
    chance = PORTAL_COMMIT[min(len(PORTAL_COMMIT), max(1, week)) - 1]
    for pid in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"]):
        st_ = rc["status"][pid]
        if st_["signed"] or not offered.get(pid) or rng.random() >= chance:
            continue
        p = rc["prospects"][pid]
        scores = sorted(((interest(state, s, pid, win) - CROWD * sum(1 for c in taken.get((s, p["position"]), ()) if c >= p["composite"]), s)
                         for s in offered[pid] if room(s, pid)), reverse=True)
        if not scores:
            continue
        school = scores[0][1]
        _commit(state, pid, school)
        st_["signed"] = school
        rc["commits_v"] = rc.get("commits_v", 0) + 1
        room.took(school, pid)
        taken.setdefault((school, p["position"]), []).append(p["composite"])
        _event(state, "signed", pid, school)
        for other, pids in rc["offers"].items():           # every other school's offer lapses
            if other != school and pid in pids:
                pids.remove(pid)
                _unmark(state, other, pid)
                rc["nil"].get(other, {}).get("held", {}).pop(pid, None)
        n = rc["nil"].get(school)
        if n and pid in n["held"]:
            n["budget"] -= n["held"].pop(pid)


POS_247_OF = {"QB": "QB", "HB": "RB", "FB": "RB", "WR": "WR", "TE": "TE", "LT": "OT", "RT": "OT", "LG": "IOL", "RG": "IOL", "C": "IOL",
              "LEDG": "EDGE", "REDG": "EDGE", "DT": "DL", "SAM": "LB", "MIKE": "LB", "WILL": "LB", "CB": "CB", "FS": "S", "SS": "S",
              "K": "K", "P": "P"}
LINE_KEYS = {"QB": ("pass_yards", "passing_touchdowns", "interceptions_thrown", "rush_yards"), "RB": ("carries", "rush_yards", "rushing_touchdowns"),
             "WR": ("receptions", "receiving_yards", "receiving_touchdowns"), "TE": ("receptions", "receiving_yards", "receiving_touchdowns"),
             "OL": ("snaps",), "DL": ("tackles", "sacks", "tackles_for_loss"), "LB": ("tackles", "sacks", "interceptions"),
             "CB": ("tackles", "interceptions", "passes_defended"), "S": ("tackles", "interceptions", "passes_defended"),
             "K": ("field_goals_made", "field_goals_attempted"), "P": ("punts", "punt_yards")}


def _season_line(state: dict, slug: str, name: str, group: str) -> dict:
    """What he did last season: games, starts and his position's numbers (the box scores' totals)."""
    team = (state.get("season_stats") or {}).get(slug) or {}
    rec = next((v for k, v in (team.get("players") or {}).items() if k.split("|")[0] == name), None)
    if not rec:
        return {"games": 0, "started": 0, "stats": {}}
    stats = rec.get("stats") or {}
    return {"games": rec.get("games", 0), "started": stats.get("games_started", 0),
            "stats": {k: stats[k] for k in LINE_KEYS.get(group, ()) if stats.get(k)}}


def portal_rc(state: dict, entrants: dict, year: int) -> dict:
    """The transfer portal as a recruiting class: every entrant in a prospect's form (no stars: his
    class, last school, last season's line, a public portal rank, his ask), empty boards, a
    four-week clock. `entrants`: offseason._departures' {pid: {"player": compact, "from", ...}}."""
    from coach_career import offseason
    from teamdata import game_scale
    attrs = game_scale.keys()
    seed = state.get("rng_state", 0)
    rng = random.Random(f"portal-rank-{year}-{seed}")
    prospects = {}
    for pid, e in entrants.items():
        c = e["player"]
        group = offseason.GROUP.get(c["pos"], "S")
        ht = c.get("ht") or 72
        ratings = list(c["r"])
        potential = [min(99, r + g) for r, g in zip(c["r"], c["g"])]
        p = {"id": pid, "name": c["n"], "position": POS_247_OF.get(c["pos"], c["pos"]), "ea_position": c["pos"], "archetype": c.get("a"),
             "height": f"{ht // 12}'{ht % 12}\"", "weight": c.get("wt"), "hometown": {"city": "", "state": c.get("home") or ""},
             "stars": None, "composite": round(c["o"] / 100, 4), "class_of": year, "portal": True,
             "from": e["from"], "from_name": e.get("from_name") or e["from"], "cls": c["cls"], "usage": e.get("usage"),
             "line": _season_line(state, e["from"], c["n"], group),
             "coachability": c.get("c") or "Steady Grinder", "ratings": ratings, "potential": potential,
             "ovr": c["o"], "pot_ovr": game_scale.overall(dict(zip(attrs, potential)), c["pos"]),
             "hidden": False, "group": group}
        p["tier"] = tier_of(p)
        p["priorities"] = _priorities(pid, PORTAL_TOP_PRIORITY_ODDS if p["tier"] >= PORTAL_TOP_TIER else PORTAL_PRIORITY_ODDS)
        p["home"] = _home(p)
        p["nil_ask"] = nil_ask(p, year, seed)
        p["_sort"] = c["o"] + rng.gauss(0, PORTAL_RANK_NOISE)
        prospects[pid] = p
    for i, pid in enumerate(sorted(prospects, key=lambda q: -prospects[q].pop("_sort")), 1):
        prospects[pid]["rank"] = prospects[pid]["portal_rank"] = i
    _truths(prospects, attrs)
    return {"portal": True, "week": 1, "weeks": PORTAL_WEEKS, "year": year, "cache_key": f"{year}-portal", "prospects": prospects,
            "lists": {pid: {} for pid in prospects},
            "status": {pid: {"committed": None, "signed": None, "fcs": False} for pid in prospects},
            "offers": {}, "visits": {}, "contacts": {}, "hours": {}, "nil": {}, "revealed": {}, "board": [], "log": [],
            "boards": {}, "seed": seed, "reads": {}, "attrs": attrs, "grades": "game", "scale": "ours",
            "pending": {}, "why": {}, "ranks": {}, "reports": [], "action_points": {}, "leader_changes": {}}


# ----- scouting: truths, looks, reads and grades -------------------------------------------------------

def _truths(prospects: dict, attrs: list[str]) -> None:
    """Each prospect's true grade per group, on the game's own scale: the average of the player-card
    attributes behind it (athleticism: Top Speed, Burst, Agility, Leaping; technique: his position's
    skills), and for potential his projected overall. Coachability comes from his label. Hidden from
    the player; reads estimate them."""
    from coach_career import prospects as pr
    for p in prospects.values():
        cards = pr.card_attributes(dict(zip(attrs, p["ratings"])), p)
        truth = {g: round(sum(cards[k] for k in pr.group_keys(p, g)) / len(pr.group_keys(p, g)), 1) for g in GROUPS[:-2]}
        truth["potential"] = float(p["pot_ovr"])
        truth["coachability"] = COACHABILITY_POINTS.get(p.get("coachability"), COACHABILITY_POINTS["Steady Grinder"])
        p["truth"] = truth


def word(points: float) -> str:
    return next(w for w, floor in zip(WORDS, WORD_FLOORS) if points >= floor)


def look_week(state: dict) -> int:
    """The week a look belongs to: the season's week, or the portal's own."""
    rc = state["recruiting"]
    return rc["week"] if rc.get("portal") else state["current_week"]


def _read_words(state: dict, pid: str) -> dict:
    """Every group's grade range in words, or {} before his first look (the look log's before/after)."""
    if pid not in state["recruiting"]["reads"]:
        return {}
    return {g: list(grade_range(state, pid, g)) for g in GROUPS}


def _flags(state: dict, pid: str) -> list[str]:
    """Your staff's flags on him from the read: gem, bust, generational (prospects.find, generational_seen)."""
    from coach_career import prospects as pr
    rc = state["recruiting"]
    out = []
    f = pr.find(state, pid)
    if f:
        out.append(f)
    if pr.generational_seen(rc, pid, state.get("team")):
        out.append("generational")
    return out


def report_looks(read: Optional[dict]) -> float:
    """A read's looks in trip units, never past REPORT_LOOKS (an old save may hold more); 0 before any look."""
    if not read:
        return 0.0
    return min(float(REPORT_LOOKS), float(read.get("looks") or 0))


def area_looks(read: Optional[dict]) -> float:
    """The looks his area scouts have put in, up to AREA_CAP; an old save without the tally counts its looks, capped."""
    if not read:
        return 0.0
    if read.get("area") is None:
        return min(float(AREA_CAP), float(read.get("looks") or 0))
    return min(float(AREA_CAP), float(read["area"]))


def report_complete(read: Optional[dict]) -> bool:
    """Whether his report is complete: REPORT_LOOKS looks, so no Send and no area look adds anything."""
    return report_looks(read) >= REPORT_LOOKS


def looks_left(read: Optional[dict]) -> float:
    """What a complete report still needs, in looks: the trips open on him (2.5 -> one Send finishes him)."""
    return max(0.0, REPORT_LOOKS - report_looks(read))


def _normalize_read(read: dict) -> None:
    """A read as this code keeps it: `looks` and `area` floats within their caps (old saves hold ints past 3 and no area)."""
    read["looks"] = report_looks(read)
    read["area"] = area_looks(read)


def look(state: dict, pid: str, evaluator_rating: int, rng: random.Random, by: Optional[str] = None,
         week: Optional[int] = None, weight: float = SEND_LOOK) -> dict:
    """One look at a prospect by an evaluator, worth `weight` looks (SEND_LOOK for a trip, AREA_LOOK
    for an area scout's week): every group's read moves toward what he saw, the step and the
    confidence gained scaled by the weight, and `read["looks"]` grows by it. Nothing goes past
    REPORT_LOOKS: the weight is cut to what his report still needs, and an area look (`by` a staff
    id) also to what AREA_CAP leaves his area (`read["area"]`); a look with nothing left is not
    counted or logged and returns an entry that changed nothing. A look's error shrinks with the
    rating; so does how far its confidence can stray (a weak evaluator is sometimes sure and wrong).
    Counted in looks in `rc["look_counts"][week][by]` and, when it changed a grade word or gained a
    flag, in `rc["look_changes"][week][by]` ({changed, flags}) and logged in `rc["looks"]` (the
    scouting desk's reports) as `by` (a staff id, or "trip" for your scouting trip) at `week`
    (default: look_week): the words before and after of the groups that changed, and the flags
    gained. The log keeps a scout's LOOK_LOG_KEEP most notable looks a week (the save is written
    after every action). Returns the entry, logged or not."""
    from coach_career import prospects as pr
    rc = state["recruiting"]
    p = rc["prospects"][pid]
    week = look_week(state) if week is None else week
    by = by or "trip"
    read = rc["reads"].get(pid)
    if read is not None:
        _normalize_read(read)
    w = min(float(weight), looks_left(read))
    if by != "trip":
        w = min(w, AREA_CAP - area_looks(read))
    w = round(w, 3)
    if w <= 0:                                        # nothing left to add: no look, only the flag he holds refreshed
        if read is not None:
            read["find"] = pr.find(state, pid)
        return {"week": week, "pid": pid, "by": by, "before": {}, "after": {}, "flags": []}
    before, flags_before = _read_words(state, pid), _flags(state, pid)     # before his first look: no words, no flags
    read = rc["reads"].setdefault(pid, {"looks": 0.0, "area": 0.0, "by": {}, "g": {}})
    s = evaluator_rating / 99
    sd = (LOOK_SD[0] * (1 - s) + LOOK_SD[1]) * (PORTAL_LOOK if is_portal(state) else 1.0)
    for g in GROUPS:
        seen = p["truth"][g] + rng.gauss(0, sd)
        felt = sd * math.exp(rng.gauss(0, CONFIDENCE_NOISE * (1 - s)))
        add = w / felt ** 2
        mean, prec = read["g"].get(g, (0.0, 0.0))
        read["g"][g] = [round((mean * prec + seen * add) / (prec + add), 3), round(prec + add, 6)]
    read["looks"] = round(read["looks"] + w, 3)
    if by != "trip":
        read["area"] = round(read["area"] + w, 3)
    key = str(evaluator_rating)
    read["by"][key] = round(read["by"].get(key, 0) + w, 3)
    read["find"] = pr.find(state, pid)               # the flag he holds after this look: find's hysteresis anchor
    after = _read_words(state, pid)
    moved = [g for g in GROUPS if before.get(g) != after.get(g)]
    entry = {"week": week, "pid": pid, "by": by,
             "before": {g: before[g] for g in moved if g in before}, "after": {g: after[g] for g in moved},
             "flags": [f for f in _flags(state, pid) if f not in flags_before]}
    counts = rc.setdefault("look_counts", {}).setdefault(str(week), {})
    counts[by] = round(counts.get(by, 0) + w, 3)
    if moved or entry["flags"]:                      # a look that changed nothing is only counted
        tally = rc.setdefault("look_changes", {}).setdefault(str(week), {}).setdefault(by, {"changed": 0, "flags": 0})
        tally["changed"] += 1
        tally["flags"] += 1 if entry["flags"] else 0
        log = rc.setdefault("looks", [])
        log.append(entry)
        mine = [i for i, e in enumerate(log) if e["week"] == week and e["by"] == by]
        if len(mine) > LOOK_LOG_KEEP:                # the log keeps a scout's most notable looks of the week
            del log[max(mine, key=lambda i: (look_notability(log[i]), -i))]
    return entry


def look_notability(e: dict) -> int:
    """A logged look's place in a scout's report: a flag gained first (0), then a potential change (1), then the rest (2)."""
    return 0 if e["flags"] else 1 if "potential" in e["after"] else 2


def read_interval(state: dict, pid: str, group: str) -> Optional[tuple[float, float]]:
    """Your staff's read as a range of grade points, or None before any look."""
    read = state["recruiting"]["reads"].get(pid)
    if not read:
        return None
    s = int(max(read["by"].items(), key=lambda kv: (kv[1], int(kv[0])))[0]) / 99
    mean, prec = read["g"][group]
    half = max(0.0, (0.6 + 1.1 * s) / math.sqrt(prec) - WORD_SLACK)
    return mean - half, mean + half


def grade_range(state: dict, pid: str, group: str) -> Optional[tuple[str, str]]:
    """(low, high) grade words, e.g. ("Solid", "Strong"); None before any look."""
    iv = read_interval(state, pid, group)
    return (word(iv[0]), word(iv[1])) if iv else None


def make_staff(state: dict) -> list[dict]:
    """Your OC and DC (evaluation = player development) and three generated recruiters, each on
    one area: the school's own states first."""
    from sim import season
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


def scout_week(state: dict, week: Optional[int] = None) -> None:
    """Every prospect in each staffed area gets half a look (AREA_LOOK) from the staff member there,
    logged at `week` (default: look_week; the portal's step passes the week it opens), until his
    area has put in AREA_CAP looks or his report is complete: then the scout passes him by. Looks
    older than the week before are dropped from the log and the counts first: the desk keeps this
    week's and last week's."""
    staff = (state.get("career") or {}).get("staff") or []
    rc = state["recruiting"]
    if week is None:
        week = look_week(state)
    rc["looks"] = [e for e in rc.get("looks") or [] if e["week"] >= week - 1]
    for key in ("look_counts", "look_changes"):
        rc[key] = {w: c for w, c in (rc.get(key) or {}).items() if int(w) >= week - 1}
    rng = random.Random(f"scout-{state['recruiting']['seed']}-{state['current_week']}")
    by_state: dict[str, list[str]] = {}
    me = state.get("team")
    for pid, p in state["recruiting"]["prospects"].items():
        st = state["recruiting"]["status"][pid]
        if not st["signed"] and st["committed"] != me:        # a commit of yours: his file is what it was
            by_state.setdefault(p["hometown"]["state"], []).append(pid)
    for member in staff:
        for code in AREAS.get(member.get("area"), []):
            for pid in by_state.get(code, []):
                if area_open(rc["reads"].get(pid)):
                    look(state, pid, member["evaluation"], rng, by=member["id"], week=week, weight=AREA_LOOK)


def area_open(read: Optional[dict]) -> bool:
    """Whether an area scout's look still adds to his report: under AREA_CAP from his area and not complete."""
    return not report_complete(read) and area_looks(read) < AREA_CAP


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

