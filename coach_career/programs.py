"""Program ratings (docs/superpowers/specs/2026-10-26-program-ratings-design.md). This first
piece is the market: how many people watch a program, from real home crowds (CFBD, 2023-2025)
and TV audiences (Nielsen's published per-team averages, estimated from the crowd where none is
published), built by tools/build_program_market.py into data/program_market.json."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

MARKET = Path(__file__).resolve().parents[1] / "data" / "program_market.json"
HISTORY = Path(__file__).resolve().parents[1] / "data" / "program_history.json"
WEIGHTS = {"prestige": 0.35, "winning": 0.20, "nil": 0.15, "market": 0.10, "conference": 0.10, "coach": 0.10}
TIERS = ((76, 1), (65, 2), (50, 3), (35, 4))         # rating floors; below the last is tier 5
TIER_NAMES = {1: "Blue blood", 2: "Power", 3: "Solid", 4: "Group of 5", 5: "Bottom"}
BASE_DEFAULT = {"history": 15.0, "prestige": 15.0, "winning": 20.0, "market": 25, "nil": 15.0, "conference": 10.0, "coach": 55.0}
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
    """The rating: the weighted mix of the six metrics."""
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


def base(slug: str) -> dict:
    """A program's starting values (data/program_history.json), a new FBS program's floor when unknown."""
    p = _history()["teams"].get(slug)
    if p:
        return dict(p)
    p = dict(BASE_DEFAULT, market=market(slug))
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


def season_score(wins: int, games: int, rank=None) -> float:
    """A season's score: win share plus the AP finish (top 25 and top 10 0.35 each, top 5 0.5, number one 0.8)."""
    s = wins / games if games else 0.0
    if rank:
        s += sum(b for top, b in RANK_BONUS if rank <= top)
    return s


def init(lgd: dict) -> None:
    """Every team in a league carries its program (from the base values) the first time it is asked."""
    for slug, t in lgd["teams"].items():
        if "program" not in t:
            p = base(slug)
            t["program"] = dict(p, market_base=p["market"], nil_base=p["nil"], winning_base=p["winning"], conference_base=p["conference"],
                                live=0.0, seasons=[], year=lgd.get("year", 2026) - 1)


def get(state: dict, slug: str) -> dict:
    """The program's metrics: from the career's league when it exists, else the base values."""
    lgd = state.get("league") if isinstance(state, dict) else None
    t = (lgd or {}).get("teams", {}).get(slug)
    if t:
        if "program" not in t:
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
                    **{k: p[k] for k in ("prestige", "winning", "nil", "market", "conference", "coach", "history")}})
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
