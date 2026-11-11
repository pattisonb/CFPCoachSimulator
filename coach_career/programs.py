"""Program ratings (docs/superpowers/specs/2026-10-26-program-ratings-design.md). This first
piece is the market: how many people watch a program, from real home crowds (CFBD, 2023-2025)
and TV audiences (Nielsen's published per-team averages, estimated from the crowd where none is
published), built by tools/build_program_market.py into data/program_market.json."""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Optional

MARKET = Path(__file__).resolve().parents[1] / "data" / "program_market.json"
HISTORY = Path(__file__).resolve().parents[1] / "data" / "program_history.json"
WEIGHTS = {"prestige": 0.30, "winning": 0.15, "nil": 0.15, "market": 0.10, "conference": 0.10, "coach": 0.10, "pro": 0.10}
TIERS = ((76, 1), (65, 2), (50, 3), (35, 4))         # rating floors; below the last is tier 5
WORD_FLOORS = (("Elite", 90), ("Excellent", 80), ("Strong", 70), ("Good", 60), ("Solid", 50), ("Fair", 40), ("Thin", 30), ("Weak", 0))   # a metric's grade words, by floor *tune*
PRO_GROUP_ORDER = ("QB", "RB", "WR", "TE", "OT", "IOL", "EDGE", "DL", "LB", "CB", "S", "K", "P")   # offseason.DRAFT_GROUP's groups, in its order
TIER_NAMES = {1: "Blue Blood", 2: "Power", 3: "Solid", 4: "Group of 5", 5: "Bottom"}
BASE_DEFAULT = {"history": 15.0, "prestige": 15.0, "winning": 20.0, "market": 25, "nil": 15.0, "conference": 10.0, "coach": 55.0, "pro": 0}
RANK_BONUS = ((1, 0.8), (5, 0.5), (10, 0.35), (25, 0.35))     # a season's score: win share plus these (cumulative), max 3.0
PRESTIGE_STEP = 3.0              # prestige moves at most this much a year toward its target *tune*
PRESTIGE_HISTORY = 0.7           # the target: history's share (the rest a ten-season mean of winning)
WINNING_WEIGHTS = (3, 2, 1)      # the last three seasons
MARKET_STEP = 3.0                # the market's live part moves at most this much a year
MARKET_LIVE = 0.3                # the live part's target: this much of (winning - 40); a decade of 100-winning +18
MARKET_FULL = 85                 # a base market this big has a full building: the crowd side is capped
MARKET_CAP_FULL, MARKET_CAP = 8.0, 18.0
NEW_COACH_LIFT = 1.5             # a new head coach's first year
NIL_UP, NIL_DOWN = 4.0, 3.0      # the AD's biggest move a year: up after a year that met the goal, down after a losing year
NIL_TARGET = {"prestige": 0.55, "winning": 0.30, "market": 0.15}   # the collective follows these from where the program started
NIL_PUSH = 6.0                   # the AD's push above (goal met) or below (losing year) that target
NIL_FLOOR_TIER = 10.0
COACH_TENURE = 3.0               # coach appeal: overall + this a year of tenure (up to five) - 5
COACH_TIER_MEAN = {1: 77, 2: 65, 3: 60, 4: 48, 5: 40}   # real 2026 head coaches' overall by tier: what a program of that tier can hire
COACH_LEAGUE_MEAN = 52           # the real 2026 head coaches' mean overall
GOALS = {1: ("playoff", 10, "Make the College Football Playoff"), 2: ("wins", 9, "Win nine games"),
         3: ("wins", 8, "Win eight games"), 4: ("wins", 7, "Win seven games and go bowling"), 5: ("wins", 6, "Reach a bowl game")}
G5_TITLE_FROM = 42.0             # a Group of 5 program rated this high expects to win its conference
MARKET_DEFAULT = 25              # a program without three seasons of FBS crowds (new to FBS)
P4 = {"SEC", "Big Ten", "Big 12", "ACC"}
PRO_ROUND_POINTS = {1: 4, 2: 3, 3: 2}   # a pick's points by round; every later round is 1 *tune*
PRO_RECENT_YEARS = 5             # the newest drafts that count extra *tune*
PRO_RECENT_WEIGHT = 2.0          # a recent draft's weight against an older one's 1 *tune*
PRO_YEARS = 10                   # drafts kept per program *tune*
_cache: dict = {}


def _market() -> dict:
    if "teams" not in _cache:
        _cache["teams"] = json.loads(MARKET.read_text(encoding="utf-8"))["teams"] if MARKET.exists() else {}
    return _cache["teams"]


def market(slug: str) -> int:
    """The program's market, 0-100 (60% crowd, 40% TV)."""
    return int(_market().get(slug, {}).get("market", MARKET_DEFAULT))


def market_row(slug: str) -> dict:
    """The market with its parts: attendance, games counted, TV millions and whether published."""
    row = _market().get(slug)
    if not row:
        return {"attendance": None, "attendance_games": 0, "tv_millions": None, "tv_known": False, "market": MARKET_DEFAULT}
    return dict(row)


def mix(p: dict) -> float:
    """The rating: the weighted mix of the seven metrics."""
    return sum(w * float(p.get(k, 0)) for k, w in WEIGHTS.items())


def tier_of(rating: float) -> int:
    for floor, t in TIERS:
        if rating >= floor:
            return t
    return 5


def _history() -> dict:
    if "history" not in _cache:
        _cache["history"] = json.loads(HISTORY.read_text(encoding="utf-8")) if HISTORY.exists() else {"teams": {}, "z_fit": {"a": -3.0, "b": 0.05}}
    return _cache["history"]


def empty_drafts(year_before: int) -> list:
    """Ten draft lines with no picks, the newest being `year_before`'s."""
    return [[y, 0, {}] for y in range(year_before - PRO_YEARS + 1, year_before + 1)]


def base(slug: str) -> dict:
    """A program's starting values (data/program_history.json), a new FBS program's floor when unknown."""
    p = _history()["teams"].get(slug)
    if p:
        return dict(p)
    p = dict(BASE_DEFAULT, market=market(slug), pro_groups={}, drafts=empty_drafts(2025))
    p["rating"] = round(mix(p), 1)
    p["tier"] = tier_of(p["rating"])
    return p


def z_of(rating: float) -> float:
    """The rating on the recruiting baseline's scale (about -2 to +2), for the readers that grew up on it."""
    f = _history()["z_fit"]
    return f["a"] + f["b"] * float(rating)


def scaled(v: float, sc: dict) -> float:
    share = max(0.0, min(1.0, (v - sc["lo"]) / (sc["hi"] - sc["lo"]))) if sc["hi"] > sc["lo"] else 0.0
    return 100 * share ** sc.get("k", 1.0)


def pick_points(round_: int) -> int:
    """What a draft pick is worth by its round."""
    return PRO_ROUND_POINTS.get(round_, 1)


def draft_line(year: int, picks: list) -> list:
    """One draft's line for a program: [year, points, {position group: points}] from (round, group) pairs."""
    groups: dict = {}
    for r, g in picks:
        groups[g] = groups.get(g, 0) + pick_points(r)
    return [year, sum(groups.values()), groups]


def _pro_lines(lines: list, year_now: int):
    for y, pts, groups in lines[-PRO_YEARS:]:
        yield (PRO_RECENT_WEIGHT if y > year_now - PRO_RECENT_YEARS else 1.0), pts, groups


def pro_score(lines: list, year_now: int) -> float:
    """The raw Pro Pipeline score: the last ten drafts' points, the newest five counting double."""
    return sum(w * pts for w, pts, _ in _pro_lines(lines, year_now))


def pro_group_scores(lines: list, year_now: int) -> dict:
    """The raw score per position group, the same weights."""
    out: dict = {}
    for w, _, groups in _pro_lines(lines, year_now):
        for g, pts in groups.items():
            out[g] = out.get(g, 0) + w * pts
    return out


def pro_recompute(p: dict, year_now: int) -> None:
    """Set a program's pro and pro_groups (0-100) from its draft lines on the fixed scales."""
    sc = _history().get("scales", {})
    lines = p.get("drafts") or []
    p["pro"] = scaled(pro_score(lines, year_now), sc["pro"]) if lines and "pro" in sc else 0
    gs = sc.get("pro_group", {})
    p["pro_groups"] = {g: scaled(v, gs[g]) if g in gs else 0 for g, v in pro_group_scores(lines, year_now).items()}


GROUP_DRAFT = {"QB": ("QB",), "RB": ("RB",), "WR": ("WR",), "TE": ("TE",), "OL": ("OT", "IOL"), "DL": ("EDGE", "DL"),
               "LB": ("LB",), "CB": ("CB",), "S": ("S",)}   # roster group -> the draft groups it reads (K and P read the overall grade; an athlete carries an engine position, so he reads that position's group)


def pro_group_grade(p: dict, group: str) -> float:
    """A program's Pro Pipeline grade at a roster group (the mean of its draft groups; any other group, the overall grade)."""
    keys = GROUP_DRAFT.get(group)
    if not keys:
        return p.get("pro", 0)
    pg = p.get("pro_groups") or {}
    return sum(pg.get(k, 0) for k in keys) / len(keys)


def season_score(wins: int, games: int, rank=None) -> float:
    """A season's score: win share plus the AP finish (top 25 and top 10 0.35 each, top 5 0.5, number one 0.8)."""
    s = wins / games if games else 0.0
    if rank:
        s += sum(b for top, b in RANK_BONUS if rank <= top)
    return s


def init(lgd: dict) -> None:
    """Every team in a league carries its program (from the base values) the first time it is asked."""
    for slug, t in lgd["teams"].items():
        if "program" in t and "drafts" not in t["program"]:
            upgrade(t["program"], slug)
        if "program" not in t:
            p = base(slug)
            p.setdefault("pro_groups", {})
            p["drafts"] = [[y, pts, dict(g)] for y, pts, g in p["drafts"]] if p.get("drafts") else empty_drafts(lgd.get("year", 2026) - 1)
            t["program"] = dict(p, market_base=p["market"], nil_base=p["nil"], winning_base=p["winning"], conference_base=p["conference"],
                                live=0.0, seasons=[], year=lgd.get("year", 2026) - 1)


def upgrade(p: dict, slug: str) -> None:
    """A program from a save made before the Pro Pipeline: it takes the base's ten draft lines, pro and
    pro_groups (copies), so the real decade is not lost, and its rating and tier follow."""
    b = base(slug)
    p["drafts"] = [[y, pts, dict(g)] for y, pts, g in b["drafts"]]
    p["pro"] = b["pro"]
    p["pro_groups"] = dict(b.get("pro_groups") or {})
    p["rating"] = round(mix(p), 1)
    p["tier"] = tier_of(p["rating"])


def get(state: dict, slug: str) -> dict:
    """The program's metrics: from the career's league when it exists, else the base values."""
    lgd = state.get("league") if isinstance(state, dict) else None
    t = (lgd or {}).get("teams", {}).get(slug)
    if t:
        if "program" not in t or "drafts" not in t["program"]:
            init(lgd)
        return t["program"]
    return base(slug)


def z(state: dict, slug: str) -> float:
    return z_of(get(state, slug)["rating"])


def goal_for(tier: int, p4: bool, rating: Optional[float] = None) -> dict:
    """What the AD expects of a program of this tier (a strong Group of 5 program: its conference)."""
    if not p4 and (rating if rating is not None else 100 if tier <= 3 else 0) >= G5_TITLE_FROM:
        return {"kind": "conference", "wins": 10, "text": "Win the conference"}
    kind, wins, text = GOALS[tier]
    return {"kind": kind, "wins": wins, "text": text}


def final_ranks(state: dict) -> dict[str, int]:
    """The season's final AP ranks (the last poll with an AP top 25)."""
    polls = state.get("polls") or {}
    weeks = sorted((int(w) for w, v in polls.items() if v.get("ap")), reverse=True)
    if not weeks:
        return {}
    return {e["team"]: e["rank"] for e in polls[str(weeks[0])]["ap"]}


def draft_picks(state: dict) -> dict:
    """This offseason's draft by school: team slug -> [(round, position group)] from the departure
    events that were drafted; a position with no draft group is skipped."""
    from coach_career import offseason
    out: dict = {}
    for ev in ((state.get("offseason") or {}).get("departures") or []):
        if ev.get("kind") != "draft":
            continue
        g = offseason.DRAFT_GROUP.get(ev.get("pos"))
        if g:
            out.setdefault(ev["team"], []).append((ev.get("round", 7), g))
    return out


def update(state: dict, results: dict, ranks: dict, year: Optional[int] = None, only=None) -> None:
    """The offseason's move of every program's metrics (once a year): the season joins the last
    ten, winning is the last three (3-2-1), prestige and the market's live part step toward their
    targets, conference strength and the coach's appeal are read again, the rating and tier follow.
    NIL moves separately by the AD's hand (nil_move)."""
    from sim import season
    lgd = state["league"]
    init(lgd)
    year = year or (state.get("offseason") or {}).get("year") or lgd.get("year", 2026)
    sc = _history().get("scales") or {}
    wsc = sc.get("winning") or {"lo": 0.0, "hi": 3.0, "k": 1.0}
    csc = sc.get("conference") or {"lo": 40.0, "hi": 70.0, "k": 1.0}
    teams = season.load_teams()
    picks = draft_picks(state)
    conf_members: dict[str, list[float]] = {}
    for s, t in lgd["teams"].items():
        bt = teams.get(s)
        if bt:
            conf_members.setdefault(bt["conference"], []).append(bt["team_ratings"]["overall"])
    conf_score = {c: scaled(sum(v) / len(v), csc) for c, v in conf_members.items()}
    conf_start = {}                                                     # the start is the fixed point: a league that plays like 2026 keeps its score
    for s, t in lgd["teams"].items():
        bt = teams.get(s)
        if bt and "conference_base" in t["program"]:
            conf_start.setdefault(bt["conference"], []).append(t["program"]["conference_base"])
    if "conference_start" not in lgd:
        lgd["conference_start"] = {c: round(v, 2) for c, v in conf_score.items()}
    conf_score = {c: (sum(conf_start[c]) / len(conf_start[c]) if conf_start.get(c) else v) + (v - lgd["conference_start"].get(c, v)) * 0.5
                  for c, v in conf_score.items()}
    for s, t in lgd["teams"].items():
        if only and s not in only:
            continue
        p = t["program"]
        if p.get("year") == year:
            continue
        r = results.get(s) or {"wins": 0, "losses": 12}
        games = r["wins"] + r["losses"]
        value = scaled(season_score(r["wins"], games, ranks.get(s)), wsc)
        p["seasons"] = (p.get("seasons") or [])[-9:] + [[year - 1, round(value, 1)]]
        recent = [v for _, v in p["seasons"][-3:]][::-1]                     # latest first
        ws = WINNING_WEIGHTS[:len(recent)]
        p["winning"] = round(sum(w * v for w, v in zip(ws, recent)) / sum(ws), 1)
        ten = [v for _, v in p["seasons"]]
        wb = p.get("winning_base", 40.0)                                    # the start is the fixed point: results like the real ones move nothing
        target = p["history"] + (1 - PRESTIGE_HISTORY) * (sum(ten) / len(ten) - wb)
        p["prestige"] = round(max(0.0, min(100.0, p["prestige"] + max(-PRESTIGE_STEP, min(PRESTIGE_STEP, target - p["prestige"])))), 1)
        cap = MARKET_CAP_FULL if p["market_base"] >= MARKET_FULL else MARKET_CAP
        live_target = max(-cap, min(cap, MARKET_LIVE * (p["winning"] - wb)))
        live = p.get("live", 0.0) + max(-MARKET_STEP, min(MARKET_STEP, live_target - p.get("live", 0.0)))
        hc = (t.get("coaches") or {}).get("head_coach") or {}
        if hc.get("since") == year:
            live += NEW_COACH_LIFT
        p["live"] = round(max(-cap, min(cap, live)), 1)
        p["market"] = int(round(max(0, min(100, p["market_base"] + p["live"]))))
        tenure = max(0, year - (hc.get("since") or year))
        p["coach"] = round(max(0.0, min(100.0, (hc.get("ratings") or {}).get("overall", 60) + COACH_TENURE * min(5, tenure) - 5)), 1)
        bt = teams.get(s)
        if bt and bt["conference"] in conf_score:
            p["conference"] = round(conf_score[bt["conference"]], 1)
        p.setdefault("drafts", empty_drafts(year - 2))
        p["drafts"] = (p["drafts"] + [draft_line(year - 1, picks.get(s, []))])[-PRO_YEARS:]    # a new list: a probe's copy never writes back
        pro_recompute(p, year - 1)
        p["rating"] = round(mix(p), 1)
        p["tier"] = tier_of(p["rating"])
        p["year"] = year


def nil_move(team: dict, met: bool, losing: bool) -> None:
    """The collective settles where the program's prestige, winning and market put it; the AD
    pushes it above that after a year that met his goal and it sinks below after a losing year,
    at most NIL_UP up or NIL_DOWN down a year."""
    p = team["program"]
    bases = {"prestige": p["history"], "winning": p.get("winning_base", 40.0), "market": p.get("market_base", p["market"])}
    target = p.get("nil_base", p["nil"]) + sum(w * (float(p[k]) - bases[k]) for k, w in NIL_TARGET.items()) + (NIL_PUSH if met else -NIL_PUSH if losing else 0.0)
    step = max(-NIL_DOWN, min(NIL_UP, target - p["nil"]))
    p["nil"] = round(max(NIL_FLOOR_TIER, min(100.0, p["nil"] + step)), 1)
    p["rating"] = round(mix(p), 1)
    p["tier"] = tier_of(p["rating"])


# ----- School Grades, Phase 1 (docs/superpowers/specs/2026-11-10-school-grades-expansion-design.md): six grades graded
# on read from data/program_profile.json (tools/build_program_profile.py). Fixed in Phase 1, so nothing goes into a
# save; the rating, tiers and market do not read them.

PROFILE = Path(__file__).resolve().parents[1] / "data" / "program_profile.json"
ACADEMICS_W = (0.60, 0.25, 0.15)          # *tune* Academics: U.S. News rank, football GSR, football APR
RANK_ZERO = 400                           # *tune* the U.S. News rank that scores 0 (log; rank 1 scores 100)
RANK_CURVE = 2.0                          # *tune* how the log rank bends: 1 is the plan's straight log; 2 keeps the top 10 Elite
UNRANKED = 25.0                           # *tune* an unranked school's rank score
ACADEMY_RANK = 85.0                       # *tune* a service academy's rank score (ranked among the top liberal arts colleges)
ACADEMIES = ("army", "navy", "air-force")
GSR_SCALE = (60, 100)                     # *tune* GSR scoring 0 and 100
APR_SCALE = (930, 1000)                   # *tune* APR scoring 0 and 100
FACILITIES_W = (0.35, 0.40, 0.25)         # *tune* Facilities: stadium, football building, indoor practice
FACILITY_NOW = 2026                       # *tune* a facility built or renovated this year scores 100 ...
FACILITY_PER_YEAR = 4                     # *tune* ... minus this a year ...
FACILITY_FLOOR = 10                       # *tune* ... never under this (and no indoor facility scores this)
LOCATION_W = (0.6, 0.4)                   # *tune* Location: metro size, January warmth
SIZE_SCALE = ((50_000, 20), (5_000_000, 100))   # *tune* metro population to score (log)
WARMTH_SCALE = ((20, 20), (65, 100))      # *tune* January average °F to score
COACH_STEP, COACH_FLOOR = 15, 10          # *tune* Stability: 100 less this for each head coach after the first, never under the floor
GAME_DAY_W = (0.6, 0.4)                   # *tune* Game Day: the crowd, how full the stadium is
CROWD_SCALE = ((15_000, 15), (105_000, 100))   # *tune* the home crowd to score
FILL_SCALE = ((0.5, 20), (1.0, 100))      # *tune* crowd over capacity to score
EXPOSURE_W = (0.5, 0.5)                   # *tune* Exposure: TV, Instagram
TV_SCALE = ((0.3, 10), (8.0, 100))        # *tune* TV millions to score (log)
INSTAGRAM_SCALE = ((20_000, 10), (2_000_000, 100))   # *tune* Instagram followers to score (log)
BIG_CITY, MID_CITY = 1_000_000, 500_000   # *tune* the metro a Big City and a Mid-Size City start at
WARM_AT, MILD_AT = 50, 35                 # *tune* January °F a Warm and a Mild climate start at
REGIONS = {"South": "AL AR DE FL GA KY LA MD MS NC OK SC TN TX VA WV", "Midwest": "IA IL IN KS MI MN MO ND NE OH SD WI",
           "West": "AK AZ CA CO HI ID MT NM NV OR UT WA WY", "Northeast": "CT MA ME NH NJ NY PA RI VT"}


def _profile() -> dict:
    if "profile" not in _cache:
        _cache["profile"] = json.loads(PROFILE.read_text(encoding="utf-8"))["teams"] if PROFILE.exists() else {}
    return _cache["profile"]


def profile_rows() -> dict:
    """Every profiled program's facts, by slug."""
    return {s: r["facts"] for s, r in _profile().items()}


def _num(v) -> Optional[float]:
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return None if v != v else float(v)
    try:
        return float(str(v).replace(",", "").split()[0])
    except (ValueError, IndexError):
        return None


def _line(x: float, scale, log: bool = False) -> float:
    (x0, y0), (x1, y1) = scale
    if log:
        x, x0, x1 = math.log(max(x, 1e-9)), math.log(x0), math.log(x1)
    return max(0.0, min(100.0, y0 + (y1 - y0) * (x - x0) / (x1 - x0)))


def rank_score(rank, slug: str = "") -> float:
    r = _num(rank)
    if r is None:
        return ACADEMY_RANK if slug in ACADEMIES else UNRANKED
    share = min(1.0, math.log(max(1.0, r)) / math.log(RANK_ZERO))
    return max(0.0, min(100.0, 100.0 * (1 - share ** RANK_CURVE)))


def recency(year) -> float:
    y = _num(year)
    if y is None:
        return float(FACILITY_FLOOR)
    return float(max(FACILITY_FLOOR, min(100, 100 - FACILITY_PER_YEAR * (FACILITY_NOW - y))))


def facilities_score(f: dict) -> float:
    a, b, c = FACILITIES_W
    return a * recency(f.get("stadium_renovated")) + b * recency(f.get("football_building_year")) + c * recency(f.get("indoor_practice"))


def warmth(temp_f) -> float:
    t = _num(temp_f)
    return _line(t, WARMTH_SCALE) if t is not None else 50.0


def fill_score(crowd, capacity) -> float:
    c, cap = _num(crowd), _num(capacity)
    if c is None or not cap:
        return 50.0
    return _line(min(1.0, c / cap), FILL_SCALE)


def grades(slug: str) -> Optional[dict]:
    """The six grades (cached: Phase 1's grades are fixed, read from the profile file); None with no profile row."""
    if slug not in _GRADES:
        _GRADES[slug] = _grades(slug)
    g = _GRADES[slug]
    return dict(g) if g is not None else None


_GRADES: dict = {}


def _grades(slug: str) -> Optional[dict]:
    """The six grades, 0-100 (0.1), from the profile; None for a program with no profile row (a fictional or new one)."""
    f = profile_rows().get(slug)
    if f is None:
        return None
    gw = ACADEMICS_W
    gsr, apr = _num(f.get("football_gsr")), _num(f.get("football_apr"))
    academics = gw[0] * rank_score(f.get("us_news_rank"), slug) + gw[1] * (_line(gsr, ((GSR_SCALE[0], 0), (GSR_SCALE[1], 100))) if gsr is not None else 50.0) \
        + gw[2] * (_line(apr, ((APR_SCALE[0], 0), (APR_SCALE[1], 100))) if apr is not None else 50.0)
    metro = _num(f.get("metro_population"))
    location = LOCATION_W[0] * (_line(metro, SIZE_SCALE, log=True) if metro else 20.0) + LOCATION_W[1] * warmth(f.get("jan_avg_temp_f"))
    coaches = _num(f.get("head_coaches_since_2010"))
    stability = float(max(COACH_FLOOR, 100 - COACH_STEP * ((coaches or 1) - 1)))
    crowd = _num(f.get("attendance"))
    game_day = GAME_DAY_W[0] * (_line(crowd, CROWD_SCALE) if crowd else 15.0) + GAME_DAY_W[1] * fill_score(crowd, f.get("stadium_capacity"))
    tv, ig = _num(f.get("tv_millions")), _num(f.get("instagram_followers"))
    exposure = EXPOSURE_W[0] * (_line(tv, TV_SCALE, log=True) if tv else 10.0) + EXPOSURE_W[1] * (_line(ig, INSTAGRAM_SCALE, log=True) if ig else 10.0)
    out = {"academics": academics, "facilities": facilities_score(f), "location": location, "stability": stability,
           "game_day": game_day, "exposure": exposure}
    return {k: round(max(0.0, min(100.0, v)), 1) for k, v in out.items()}


def tags(slug: str) -> Optional[dict]:
    """Location's tags (cached, like grades)."""
    if slug not in _TAGS:
        _TAGS[slug] = _tags(slug)
    t = _TAGS[slug]
    return dict(t) if t is not None else None


_TAGS: dict = {}


def _tags(slug: str) -> Optional[dict]:
    """Location's tags: the setting (Big City, Mid-Size City, College Town, Small Town), the climate (Warm, Mild, Cold) and
    the region (South, Midwest, West, Northeast); None for a program with no profile row."""
    f = profile_rows().get(slug)
    if f is None:
        return None
    metro, temp, said = _num(f.get("metro_population")) or 0, _num(f.get("jan_avg_temp_f")), f.get("setting")
    if metro >= BIG_CITY:
        setting = "Big City"
    elif metro >= MID_CITY and said != "College Town":
        setting = "Mid-Size City"
    else:
        setting = said if said in ("College Town", "Small Town") else "Small Town"
    climate = None if temp is None else "Warm" if temp >= WARM_AT else "Mild" if temp >= MILD_AT else "Cold"
    region = next((r for r, states in REGIONS.items() if (f.get("state") or "") in states.split()), None)
    return {"setting": setting, "climate": climate, "region": region}


def word_of(v: float) -> str:
    """The grade word for a 0-100 metric."""
    return next(w for w, f in WORD_FLOORS if v >= f)


def rows(state: dict) -> list[dict]:
    """Every program for the page, by rating: the metrics, the tier and the AD's goal."""
    from sim import season
    teams = season.load_teams()
    out = []
    for s, bt in teams.items():
        if bt.get("fictional"):
            continue
        p = get(state, s)
        p4 = season._is_p4(s, bt)
        out.append({"team": s, "name": bt["name"], "conference": bt["conference"], "tier": p["tier"], "tier_name": TIER_NAMES[p["tier"]],
                    "rating": p["rating"], "goal": goal_for(p["tier"], p4, p["rating"])["text"],
                    **{k: p[k] for k in ("prestige", "winning", "nil", "market", "conference", "coach", "history", "pro", "pro_groups")},
                    "grades": grades(s), "tags": tags(s)})
    out.sort(key=lambda r: -r["rating"])
    for i, r in enumerate(out, 1):
        r["rank"] = i
    return out


def attract(state: dict, slug: str) -> float:
    """How attractive the job is to a coach: the rating, a little more where the AD is patient."""
    p = get(state, slug)
    t = ((state.get("league") or {}).get("teams") or {}).get(slug) or {}
    patience = (t.get("ad") or {}).get("patience") or 3
    return p["rating"] + (5 if patience >= 4 else 0)


def coach_level(state: dict, slug: str) -> float:
    """How far above or below the league's mean a coach this program can hire sits (the tier's real mean)."""
    return COACH_TIER_MEAN[get(state, slug)["tier"]] - COACH_LEAGUE_MEAN


def coach_ceiling(state: dict, slug: str) -> float:
    """A coach rated this far above the program's tier is not interested in the job."""
    return COACH_TIER_MEAN[get(state, slug)["tier"]] + 12
