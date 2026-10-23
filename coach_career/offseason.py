"""The offseason of a Coach Career and the step to the next season
(docs/superpowers/specs/2026-10-23-career-offseason-design.md).

After national signing day `start` opens the offseason: the career's league is taken for next
year (league.py), players leave (graduation, the NFL draft, the transfer portal, quitting) and
the signed classes arrive. Then `advance` walks the stages: two transfer portal rounds, player
development, staff changes, and `next_season` hands back the new season's state.

    state["offseason"] = {"stage": one of STAGES, "year": next season, "departures": [event],
                          "portal": {"players": {id: entrant}, "round": 1}, "staff": {...}, "report": {...}}
"""
from __future__ import annotations

import math
import random
import statistics as st
from typing import Optional

from coach_career import league as lg
from coach_career import recruits

STAGES = ("departures", "portal_w1", "portal_w2", "portal_w3", "portal_w4", "development", "staff", "ready")
PORTAL_STAGES = ("portal_w1", "portal_w2", "portal_w3", "portal_w4")
OLD_PORTAL = {"portal_1": "portal_w1", "portal_2": "portal_w2"}     # saves from the two-round portal
STAGE_NAMES = {"departures": "Departures", "portal_w1": "Transfer portal, week 1", "portal_w2": "Transfer portal, week 2",
               "portal_w3": "Transfer portal, week 3", "portal_w4": "Transfer portal, week 4",
               "portal_1": "Transfer portal, round 1", "portal_2": "Transfer portal, round 2",
               "development": "Development", "staff": "Staff", "ready": "Ready for next season"}
ROSTER_LIMIT = 85          # EA's roster limit (the real 2026 rosters; the NCAA's has been 105 since 2025)
FILL_TO = 80               # walk-ons and lower-level transfers top a roster up to this
GROUP = {"QB": "QB", "HB": "RB", "FB": "RB", "WR": "WR", "TE": "TE", "LT": "OL", "LG": "OL", "C": "OL", "RG": "OL", "RT": "OL",
         "LEDG": "DL", "REDG": "DL", "DT": "DL", "SAM": "LB", "MIKE": "LB", "WILL": "LB", "CB": "CB", "FS": "S", "SS": "S",
         "K": "K", "P": "P"}
# a healthy roster's players per group (the real 2026 FBS mean) and the floor walk-ons top up to
TARGET = {"QB": 4, "RB": 6, "WR": 11, "TE": 6, "OL": 15, "DL": 15, "LB": 9, "CB": 8, "S": 8, "K": 2, "P": 1}
LOWER_LEVEL = 0.3          # the share of roster top-ups who come from FCS or junior college (three-stars, a year or two in), not walk-ons
LOWER_LEVEL_P4 = 0.15     # ... at a Power 4 school (mostly walk-ons there)
FLOOR = {"QB": 3, "RB": 3, "WR": 6, "TE": 3, "OL": 10, "DL": 9, "LB": 5, "CB": 5, "S": 4, "K": 1, "P": 1}
ENGINE_POS = {"QB": "QB", "RB": "RB", "WR": "WR", "TE": "TE", "OL": "OL", "DL": "DL", "LB": "MLB", "CB": "CB", "S": "S", "K": "K", "P": "P"}

# ----- departures *tune* -----
NEXT_CLASS = {"FR": "SO", "FRRS": "SORS", "SO": "JR", "SORS": "JRRS", "JR": "SR", "JRRS": "SRRS"}
REDSHIRT = {"FR": 0.78, "SO": 0.35, "JR": 0.25}   # chance a player off the depth chart's top takes his redshirt year
FIFTH_YEAR = 0.60                                  # a senior with his redshirt unused who barely played comes back
DRAFT_PICKS = 257
DRAFT_FROM_FBS = 0.97                              # the share of picks from FBS (the rest from lower levels)
# the draft by position, fitted by tools/calibrate_draft.py to data/draft_targets.json (the 2021-2025 NFL
# drafts' round-one and all-pick counts by position): his draft score is POSITION_SCALE[pos] * card overall
# + POSITION_VALUE[pos] + noise, so quarterbacks and tackles go early and backs, tight ends and safeties late
POSITION_VALUE = {"QB": -269.38, "HB": -28.91, "FB": -28.91, "WR": -193.15, "TE": -55.25, "LT": -73.69, "RT": -73.69, "LG": -73.1,
                  "RG": -73.1, "C": -73.1, "LEDG": -84.02, "REDG": -84.02, "DT": -49.06, "SAM": -147.83, "MIKE": -147.83,
                  "WILL": -147.83, "CB": -74.02, "FS": -52.39, "SS": -52.39, "K": -236.12, "P": -318.77}
POSITION_SCALE = {"QB": 5.0, "HB": 1.607, "FB": 1.607, "WR": 3.871, "TE": 1.664, "LT": 2.105, "RT": 2.105, "LG": 1.932, "RG": 1.932,
                  "C": 1.932, "LEDG": 2.127, "REDG": 2.127, "DT": 1.674, "SAM": 2.892, "MIKE": 2.892, "WILL": 2.892, "CB": 2.013,
                  "FS": 1.579, "SS": 1.579, "K": 3.563, "P": 5.0}
DRAFT_NOISE = 4.0
DECLARE = ((32, 0.95), (64, 0.88), (100, 0.65), (160, 0.35), (257, 0.12), (10**9, 0.004))   # projected pick -> an underclassman declares
UNDERCLASS_ELIGIBLE = {"JR", "JRRS", "SORS"}       # three years out of high school
PORTAL_BASE = {"FR": 0.05, "FRRS": 0.09, "SO": 0.10, "SORS": 0.12, "JR": 0.10, "JRRS": 0.12, "SR": 0.18}
PORTAL_USAGE = {"starter": 0.12, "rotation": 0.65, "bench": 1.3}
PORTAL_LOSING = 1.25                               # a losing season pushes players out
TRANSFER_UP_FROM, TRANSFER_UP = 50, 0.40              # a Group of 5 player this good (card overall) enters this often
QUIT = 0.012                                       # quitting or a medical retirement, a year
QUIT_LOW = 2.5                                     # ... this much likelier in the team's bottom 15%

# ----- the portal *tune* -----
PORTAL_OFFER_FACTOR = 2.0                          # a school's offers a round, times its open spots
PORTAL_PASSES = 3                                  # offer-and-sign passes in a portal round (schools with spots left offer again)
PORTAL_TAKE = 4                                    # transfers an AI school takes in a round from its open spots (real: 5-15 a year with churn)
CHURN = 8                                          # portal spots a Power 4 school makes by releasing its weakest players
OPEN_TAKE_ANY = 4                                  # with this many open spots a school takes good players at any position
# an entrant's choice: playing time, the program (its recruiting pull and team rating), winning, home
PT_WEIGHT, PRESTIGE_WEIGHT, RATING_WEIGHT, WIN_WEIGHT, HOME_WEIGHT, PICK_NOISE = 1.0, 0.8, 0.3, 0.6, 0.4, 0.5

# ----- development and staff *tune* -----
DEV_RATE = 0.75                                    # coachability's pace on our scale: a class tracks the real players by stars and
                                                   # years (tools/check_development.py), three- and two-stars a little under the survivors
# real players gain little in their first offseasons and most in their third and fourth (the real rosters
# by years in college: four-stars +1, +1, +5.5): the pace by seasons already played in the program *tune*
YEAR_CURVE = (0.45, 0.7, 1.35, 1.35, 1.0)
PROGRAM_DEV = 0.25                                 # development rate per point of the program's recruiting baseline
PROGRAM_DEV_BELOW = 0.10                           # ... below the average program (the Group of 5 develops less, not half as much)
COORD_SHARE = 0.4                                  # the coordinator's part of a player's coach factor
RECRUITER_LEAVE = 0.12


def _rng(state: dict, what: str) -> random.Random:
    return random.Random(f"offseason-{state['id']}-{state.get('year', 2026)}-{what}")


def _attrs(lgd: dict) -> list[str]:
    return lgd["attrs"]


def house(pos: str, ovr: float) -> int:
    """A league player's overall as shown: ours already ("o", game_scale.overall of his ratings)."""
    return int(ovr)


def _record(state: dict, slug: str) -> tuple[int, int]:
    from sim import season
    r = season._records(state, include_playoff=True).get(slug) or {}
    return r.get("wins", 0), r.get("losses", 0)


def _usage() -> dict[str, dict[str, str]]:
    """team -> player slug -> starter / rotation (next on his role's depth) / bench, from the season's teams."""
    from sim import season
    out = {}
    for slug, t in season.load_teams().items():
        if t.get("fictional"):
            continue
        u, starts = {}, {}
        players = t["offense"] + t["defense"]
        for p in players:
            if p.get("in_game"):
                starts[p.get("role")] = starts.get(p.get("role"), 0) + 1
        for p in players:
            if p.get("in_game"):
                u[p["slug"]] = "starter"
            elif (p.get("depth") or 99) <= starts.get(p.get("role"), 1) + 1:
                u[p["slug"]] = "rotation"
            else:
                u[p["slug"]] = "bench"
        out[slug] = u
    return out


# ----- start: departures and the arriving classes ----------------------------------------------

def start(state: dict) -> dict:
    """Open the offseason after national signing day: next year's league, every program's
    departures and the signed classes on the rosters, the portal open for round 1."""
    from sim import season
    if state.get("offseason"):
        return state["offseason"]
    year = season.season_year(state) + 1
    lgd = state.get("league") or lg.from_base(year)
    lgd["year"] = year
    state["league"] = lgd
    usage = _usage()
    deps, entrants = _departures(state, lgd, usage)
    signed = _sign_classes(state, lgd)
    state["offseason"] = {"stage": "departures", "year": year, "departures": deps,
                          "portal": {"players": entrants, "round": 1, "offers": {}, "moves": []},
                          "signed": signed, "staff": None, "report": None, "performance": _performance(state)}
    from coach_career import recruiting
    if state.get("recruiting"):                # the portal is recruited like a class: the signed class is kept aside
        state["recruiting_last"] = state["recruiting"]
        state["recruiting"] = recruiting.portal_rc(state, entrants, year)
        recruiting.reset_caches()
        me = state.get("team")
        if me in lgd["teams"]:                 # your staff's first look: the entrants who fit your needs, on your board
            state["recruiting"]["board"] = recruiting._build_board(state, me, _rng(state, "portal-board"))[:PORTAL_BOARD]
    return state["offseason"]


# ----- the season's production and honors, for development *tune* -----
PERF_RATE = 0.25                 # development rate change per standard deviation of production over the average starter's
PERF_RANGE = (-1.0, 2.4)         # ... so a player develops 0.75 to 1.6 times as fast
BREAKOUT_FROM = 1.0              # production this far over the average starter raises his ceiling ...
BREAKOUT_ROOM = 2.5              # ... by this many points (our scale) per standard deviation beyond half of one
HONOR_ROOM = {"heisman": 8, "national": 6, "all_america_1": 5, "national_finalist": 3, "all_america_2": 3,
              "conference_award": 3, "all_conference_1": 2, "all_conference_2": 1}
HONOR_NAMES = {"heisman": "Heisman Trophy", "all_america_1": "All-America first team", "all_america_2": "All-America second team",
               "all_conference_1": "All-conference first team", "all_conference_2": "All-conference second team"}
ROOM_CAP = 10                     # the most a year's honors and production add to his ceiling
LEVEL_UP = 0.4                   # a national award winner or All-American moves up a coachability level this often
PHYSICAL = {"speed", "acceleration", "agility", "change_of_direction", "jumping", "stamina", "injury", "toughness", "strength",
            "kick_power", "throw_power"}   # gifts and body: production does not raise these ceilings


def _performance(state: dict) -> dict[str, dict]:
    """player id -> {"z": production against the average starter at his group, "honors": [(kind, name)]}
    from the season's stats (awards.Pool, the same scores the awards use) and its honors."""
    from sim import awards
    from sim import season
    teams = season.load_teams()
    ids = {(slug, p["name"], p["position"]): p["slug"] for slug, t in teams.items() for p in t["offense"] + t["defense"]}
    out: dict[str, dict] = {}
    if state.get("season_stats"):
        pool = awards.Pool(state, teams, season._records(state, include_playoff=True))
        for p in pool.players:
            sid = ids.get((p["team"], p["name"], p["position"]))
            z = p["zb"].get(p["group"])
            if sid and z is not None and pool.played_enough(p):
                out[sid] = {"z": round(z, 2), "honors": []}

    def honor(c: Optional[dict], kind: str, name: str) -> None:
        sid = c and ids.get((c.get("team"), c.get("name"), c.get("position")))
        if sid:
            out.setdefault(sid, {"z": None, "honors": []})["honors"].append((kind, name))

    aw = state.get("awards") or {}
    nat = aw.get("national") or {}
    h = nat.get("heisman") or {}
    for i, c in enumerate((h.get("finalists") or [])[:4]):
        honor(c, "heisman" if i == 0 else "national_finalist", "Heisman Trophy" if i == 0 else "Heisman finalist")
    for a in (nat.get("awards") or []) + ((aw.get("postseason") or {}).get("awards") or []):
        honor(a.get("winner"), "national", a["name"])
        for c in (a.get("finalists") or [])[1:]:
            honor(c, "national_finalist", f"{a['name']} finalist")
    for row in ((nat.get("all_america") or {}).get("consensus") or []):
        honor(row, f"all_america_{min(2, row.get('level', 1))}", HONOR_NAMES[f"all_america_{min(2, row.get('level', 1))}"])
    for conf in (aw.get("conference") or {}).values():
        for a in conf.get("awards") or []:
            honor(a.get("winner"), "conference_award", a["name"])
        seen = set()
        for rows in ((conf.get("teams") or {}).get("selectors") or {}).values():
            for row in rows:
                key = (row.get("team"), row.get("name"))
                if key in seen:
                    continue
                seen.add(key)
                kind = f"all_conference_{min(2, row.get('level', 1))}"
                honor(row, kind, HONOR_NAMES[kind])
    return out


def growth_terms(perf: Optional[dict]) -> tuple[float, int, list[str], bool]:
    """(development rate multiplier, EA points added to his room in skill and football IQ, the
    reasons, whether he may move up a coachability level) from a season's production and honors."""
    if not perf:
        return 1.0, 0, [], False
    mult, room, why = 1.0, 0.0, []
    z = perf.get("z")
    if z is not None:
        mult = 1 + PERF_RATE * max(PERF_RANGE[0], min(PERF_RANGE[1], z))
        if z >= BREAKOUT_FROM:
            room += BREAKOUT_ROOM * (z - 0.5)
            why.append("Breakout season")
        elif z <= -0.75:
            why.append("Struggled as a starter")
    kinds = [k for k, _ in perf.get("honors", [])]
    pts = sorted((HONOR_ROOM.get(k, 0) for k in kinds), reverse=True)
    if pts:
        room += pts[0] + 0.5 * sum(pts[1:3])
    names = list(dict.fromkeys(n for _, n in perf.get("honors", [])))
    why += names[:3]
    level_up = any(k in ("heisman", "national", "all_america_1") for k in kinds)
    return mult, int(round(min(ROOM_CAP, room))), why, level_up


def _departures(state: dict, lgd: dict, usage: dict) -> tuple[list[dict], dict]:
    rng = _rng(state, "departures")
    attrs = _attrs(lgd)
    events, entrants = [], {}
    records = {slug: _record(state, slug) for slug in lgd["teams"]}
    # the draft: seniors and the underclassmen who declare, ranked by draft score
    declared, drafted = draft_board(lgd, rng)
    leaving: dict[str, set] = {slug: set() for slug in lgd["teams"]}
    from sim import season
    teams = season.load_teams()
    p4 = {slug: season._is_p4(slug, teams[slug]) for slug in lgd["teams"]}
    for slug, t in lgd["teams"].items():
        u = usage.get(slug, {})
        wins, losses = records[slug]
        losing = wins < losses
        os_ = sorted(q["o"] for q in t["roster"])
        low = os_[max(0, int(len(os_) * 0.15) - 1)] if os_ else 0
        team_name = lg.base_team(slug)["short_name"]
        for p in t["roster"]:
            ev = {"id": p["id"], "name": p["n"], "pos": p["pos"], "cls": p["cls"], "team": slug, "team_name": team_name,
                  "overall": house(p["pos"], p["o"]), "stars": p.get("s")}
            use = u.get(p["id"], "bench")
            if p["id"] in drafted:
                ev.update(kind="draft", pick=drafted[p["id"]], round=min(7, (drafted[p["id"]] - 1) // 32 + 1),
                          early=p["cls"] not in ("SR", "SRRS"))
            elif p["id"] in declared:
                ev.update(kind="undrafted", early=True)
            elif p["cls"] == "SRRS" or (p["cls"] == "SR" and not (use == "bench" and rng.random() < FIFTH_YEAR)):
                ev.update(kind="graduated")
            else:
                nxt = "SRRS" if p["cls"] == "SR" else _next_class(p, use, rng)
                if rng.random() < QUIT * (QUIT_LOW if p["o"] <= low else 1.0):
                    ev.update(kind="quit")
                else:
                    chance = PORTAL_BASE.get(p["cls"], 0.15) * PORTAL_USAGE[use] * (PORTAL_LOSING if losing else 1.0)
                    if not p4[slug] and house(p["pos"], p["o"]) >= TRANSFER_UP_FROM:
                        chance = max(chance, TRANSFER_UP)            # a Group of 5 standout moves up
                    if rng.random() < chance:
                        ev.update(kind="portal")
                        q = dict(p, cls=nxt)
                        entrants[p["id"]] = {"player": q, "from": slug, "from_name": team_name, "offers": [],
                                             "signed": None, "usage": use}
                    else:
                        p["cls"] = nxt
                        continue
            events.append(ev)
            leaving[slug].add(p["id"])
    for slug, t in lgd["teams"].items():
        t["roster"] = [p for p in t["roster"] if p["id"] not in leaving[slug]]
    return events, entrants


def draft_score(pos: str, overall: int, rng: random.Random) -> float:
    """Where he projects: his card overall scaled by his position's draft value, plus noise."""
    return POSITION_SCALE.get(pos, 1.0) * house(pos, overall) + POSITION_VALUE.get(pos, 0) + rng.gauss(0, DRAFT_NOISE)


def draft_board(lgd: dict, rng: random.Random) -> tuple[set, dict]:
    """The draft: every senior and draft-eligible underclassman scored, the underclassmen who
    declare by their projected pick (DECLARE), the first DRAFT_PICKS * DRAFT_FROM_FBS picked.
    Returns (the ids who declared early, {id: pick})."""
    pool = []
    for slug, t in lgd["teams"].items():
        for p in t["roster"]:
            if p["cls"] in ("SR", "SRRS") or p["cls"] in UNDERCLASS_ELIGIBLE:
                pool.append((draft_score(p["pos"], p["o"], rng), slug, p))
    pool.sort(key=lambda x: -x[0])
    fbs_picks = round(DRAFT_PICKS * DRAFT_FROM_FBS)
    declared = set()
    for i, (score, slug, p) in enumerate(pool, 1):
        if p["cls"] in UNDERCLASS_ELIGIBLE:
            chance = next(c for cut, c in DECLARE if i <= cut)
            if rng.random() < chance:
                declared.add(p["id"])
    board = [(score, slug, p) for score, slug, p in pool if p["cls"] in ("SR", "SRRS") or p["id"] in declared]
    return declared, {p["id"]: pick for pick, (score, slug, p) in enumerate(board[:fbs_picks], 1)}


def _next_class(p: dict, use: str, rng: random.Random) -> str:
    """Next year's class: a player who did not play much may take his redshirt (once)."""
    cls = p["cls"]
    if not cls.endswith("RS") and use != "starter":
        chance = REDSHIRT.get(cls, 0.0) * (0.5 if use == "rotation" else 1.0)
        if rng.random() < chance:
            return cls + "RS"
    return NEXT_CLASS.get(cls, cls)


def _jersey(roster: list[dict], pos: str, rng: random.Random) -> Optional[str]:
    used = {str(p.get("j")) for p in roster}
    ranges = {"QB": range(1, 20), "HB": range(1, 50), "WR": range(1, 90), "TE": range(80, 90), "K": range(1, 50),
              "P": range(1, 50), "CB": range(1, 50), "FS": range(1, 50), "SS": range(1, 50)}
    if GROUP[pos] == "OL":
        rng_nums = range(50, 80)
    elif GROUP[pos] in ("DL", "LB"):
        rng_nums = range(1, 100)
    else:
        rng_nums = ranges.get(pos, range(1, 100))
    free = [str(n) for n in rng_nums if str(n) not in used] or [str(n) for n in range(100) if str(n) not in used]
    return rng.choice(free) if free else None


def _sign_classes(state: dict, lgd: dict) -> dict[str, int]:
    """Every school's signed high school class joins its roster as freshmen."""
    from coach_career import recruiting
    rc = state.get("recruiting")
    if not rc:
        return {}
    rng = _rng(state, "jerseys")
    attrs = _attrs(lgd)
    out: dict[str, int] = {}
    for pid, s in rc["status"].items():
        slug = s.get("signed")
        if not slug or slug == "FCS" or slug not in lgd["teams"]:
            continue
        team = lgd["teams"][slug]
        c = _compact_prospect(state, rc["prospects"][pid], attrs)
        c["j"] = _jersey(team["roster"], c["pos"], rng)
        c["signed"] = True
        team["roster"].append(c)
        out[slug] = out.get(slug, 0) + 1
    return out


def _compact_prospect(state: dict, p: dict, attrs: list[str]) -> dict:
    """A high school prospect as a league player (a freshman)."""
    from coach_career import recruiting
    src = {"slug": p["id"], "name": p["name"], "position": p["ea_position"], "class": "FR", "height": p["height"],
           "weight_lbs": p["weight"], "archetype": p["archetype"], "dev_trait": "Normal",
           "ours": recruiting.attributes(state, p, "ratings"), "potential_ours": recruiting.attributes(state, p),
           "coachability": p["coachability"], "stars": p["stars"], "hometown": p["hometown"]}
    return lg.compact(src, attrs)


# ----- the transfer portal ----------------------------------------------------------------------

def p4_school(slug: str) -> bool:
    from sim import season
    return season._is_p4(slug, season.load_teams()[slug])


def open_spots(lgd: dict, slug: str, portal: dict) -> int:
    taken = sum(1 for e in portal["players"].values() if e["signed"] == slug)
    return max(0, ROSTER_LIMIT - len(lgd["teams"][slug]["roster"]) - taken)


def churn_left(portal: dict, slug: str) -> int:
    """Spots a school can still make by releasing the end of its roster this portal (CHURN in all)."""
    return max(0, CHURN - sum(1 for e in portal["players"].values() if e["signed"] == slug and e.get("churn")))


def my_spots(lgd: dict, me: str, portal: dict) -> int:
    """Your portal spots: open roster spots plus the ones releasing the end of your roster makes."""
    return open_spots(lgd, me, portal) + churn_left(portal, me)


def _group_counts(roster: list[dict]) -> dict[str, int]:
    out = {g: 0 for g in TARGET}
    for p in roster:
        out[GROUP[p["pos"]]] += 1
    return out


def _depth_values(roster: list[dict]) -> dict[str, list[int]]:
    out: dict[str, list[int]] = {g: [] for g in TARGET}
    for p in roster:
        out[GROUP[p["pos"]]].append(p["o"])
    for v in out.values():
        v.sort(reverse=True)
    return out


STARTERS = {"QB": 1, "RB": 1, "WR": 3, "TE": 1, "OL": 5, "DL": 4, "LB": 2, "CB": 2, "S": 2, "K": 1, "P": 1}


def playing_time(lgd: dict, slug: str, p: dict) -> float:
    """Where he would play at `slug`: 1 a starter, 0.5 next in line, 0.15 behind that."""
    g = GROUP[p["pos"]]
    ahead = sum(1 for o in _depth_values(lgd["teams"][slug]["roster"])[g] if o > p["o"])
    return 1.0 if ahead < STARTERS[g] else 0.5 if ahead < STARTERS[g] + 2 else 0.15


def _prestige(slug: str) -> float:
    """The program's pull on a transfer: its recruiting baseline (NIL, brand; about -2 to +2) and its team now."""
    from coach_career import recruiting
    from sim import season
    t = season.load_teams().get(slug) or {}
    return PRESTIGE_WEIGHT * recruiting._baseline(slug) + RATING_WEIGHT * ((t.get("team_ratings") or {}).get("overall", 60) - 60) / 10


def entrant_interest(state: dict, lgd: dict, slug: str, e: dict, rng: Optional[random.Random] = None) -> float:
    p = e["player"]
    wins, losses = _record(state, slug)
    home = 1.0 if lg.base_team(slug).get("state") == p.get("home") else 0.0
    noise = rng.gauss(0, PICK_NOISE) if rng else 0.0
    return (PT_WEIGHT * playing_time(lgd, slug, p) + _prestige(slug)
            + WIN_WEIGHT * wins / max(1, wins + losses) + HOME_WEIGHT * home + noise)


def ai_offers(state: dict, slug: str, left: Optional[int] = None) -> list[str]:
    """A school's portal offers this round: by need (groups short of a healthy depth first), the
    best entrants who would play there, up to PORTAL_OFFER_FACTOR times its open spots (`left`:
    the spots it still has later in the round)."""
    off = state["offseason"]
    lgd, portal = state["league"], off["portal"]
    if left is not None:
        spots = left
    else:
        spots = min(open_spots(lgd, slug, portal), PORTAL_TAKE)
        if p4_school(slug):
            spots += max(0, CHURN - sum(1 for e in portal["players"].values() if e["signed"] == slug and e.get("churn")))
    if spots <= 0:
        return []
    roster = lgd["teams"][slug]["roster"]
    counts = _group_counts(roster + [e["player"] for e in portal["players"].values() if e["signed"] == slug])
    depth = _depth_values(roster)
    need = {g: TARGET[g] - counts[g] for g in TARGET}
    free = [(pid, e) for pid, e in portal["players"].items() if not e["signed"] and e["from"] != slug]
    scored = []
    for pid, e in free:
        p = e["player"]
        g = GROUP[p["pos"]]
        vals = depth[g]
        starter_bar = vals[min(len(vals) - 1, STARTERS[g] - 1)] if vals else 0
        if p["o"] > starter_bar:                                         # he would start here: worth a spot, need or not
            scored.append((10 + (p["o"] - starter_bar) / 2, pid))
            continue
        if need[g] <= 0 and spots < OPEN_TAKE_ANY:
            continue
        bar = vals[min(len(vals) - 1, STARTERS[g] + 3)] if vals else 0      # about as good as his depth there
        if p["o"] < bar - 4:
            continue
        scored.append((need[g] * 2 + (p["o"] - bar) / 3, pid))
    scored.sort(reverse=True)
    return [pid for _, pid in scored[:math.ceil(PORTAL_OFFER_FACTOR * spots)]]


def resolve_round(state: dict) -> list[dict]:
    """The round's decisions: every entrant with offers picks the school he likes best that still
    has a spot, best players first. Returns the moves."""
    off = state["offseason"]
    lgd, portal = state["league"], off["portal"]
    rng = _rng(state, f"portal-{portal['round']}")
    me = state["team"]
    mine = set(portal["offers"].get(me, []))
    if (state.get("career") or {}).get("settings", {}).get("auto_recruit") not in (None, False, "off") and not mine:
        mine = set(ai_offers(state, me))
    moves = []
    spots = {slug: open_spots(lgd, slug, portal) if slug == me else min(open_spots(lgd, slug, portal), PORTAL_TAKE)
             for slug in lgd["teams"]}
    churn = {slug: churn_left(portal, slug) if p4_school(slug) or slug == me else 0 for slug in lgd["teams"]}
    for rolling in range(PORTAL_PASSES):    # schools with spots left keep offering to who is still out there
        offers: dict[str, list[str]] = {}
        for pid in (mine if rolling == 0 else ()):
            offers.setdefault(pid, []).append(me)
        for slug in lgd["teams"]:
            if slug == me or (rolling and spots.get(slug, 0) <= 0 and churn.get(slug, 0) <= 0):
                continue
            for pid in ai_offers(state, slug, spots[slug] + churn[slug] if rolling else None):
                offers.setdefault(pid, []).append(slug)
        for pid in sorted(offers, key=lambda q: -portal["players"][q]["player"]["o"]):
            e = portal["players"][pid]
            if e["signed"]:
                continue
            e["offers"] = sorted(set(e["offers"]) | set(offers[pid]))
            choices = [s for s in offers[pid] if spots.get(s, 0) > 0 or churn.get(s, 0) > 0]
            if not choices:
                continue
            pick = max(choices, key=lambda s: entrant_interest(state, lgd, s, e, rng))
            e["signed"] = pick
            if spots.get(pick, 0) > 0:
                spots[pick] -= 1
            else:                          # a spot made by releasing the end of the roster (over the limit after the portal)
                churn[pick] -= 1
                e["churn"] = True
            moves.append({"id": pid, "name": e["player"]["n"], "pos": e["player"]["pos"], "from": e["from"], "to": pick,
                          "overall": house(e["player"]["pos"], e["player"]["o"]), "round": portal["round"]})
    portal["moves"] += moves
    portal["offers"] = {}
    return moves


def _close_portal_rounds(state: dict) -> None:
    """The two-round portal of older saves: signed transfers join their new rosters; the rest leave FBS."""
    lgd, portal = state["league"], state["offseason"]["portal"]
    rng = _rng(state, "portal-jerseys")
    for pid, e in portal["players"].items():
        if e["signed"]:
            p = dict(e["player"])
            team = lgd["teams"][e["signed"]]
            p["j"] = _jersey(team["roster"], p["pos"], rng)
            p["transfer"] = e["from"]
            team["roster"].append(p)


def _close_portal(state: dict) -> None:
    """After the last portal week: signed transfers join their new rosters, an unsigned entrant may
    walk on at a school from his top group (PORTAL_WALK_ON) or leaves FBS, and the recruiting
    block goes back to the signed class."""
    from coach_career import recruiting
    lgd, off = state["league"], state["offseason"]
    portal, rc = off["portal"], state["recruiting"]
    rng = _rng(state, "portal-jerseys")
    me, auto = state.get("team"), bool(off.get("auto")) or recruiting.auto_mode(state) != "off"
    for pid, e in portal["players"].items():
        st_ = rc["status"].get(pid) or {}
        school = st_.get("signed")
        if not school:                      # a preferred walk-on: a school he was considering that had spoken to him
            if rng.random() < recruiting.PORTAL_WALK_ON:
                p = rc["prospects"][pid]
                for s_ in recruiting.top_group(state, pid):
                    c = (rc["contacts"].get(pid) or {}).get(s_) or {}
                    if not (c.get("n") or pid in rc["offers"].get(s_, [])) or (s_ == me and not auto):
                        continue
                    if recruiting.portal_spots(state, s_) <= 0:
                        continue
                    need = recruiting.needs(state, s_)[p["group"]]
                    worst = min((q["o"] for q in lgd["teams"][s_]["roster"] if GROUP[q["pos"]] == p["group"]), default=0)
                    if need > 0 or p["ovr"] > worst:
                        school = s_
                        break
            if not school:
                continue
        p = dict(e["player"])
        team = lgd["teams"][school]
        p["j"] = _jersey(team["roster"], p["pos"], rng)
        p["transfer"] = e["from"]
        if not st_.get("signed"):
            p["walk_on"] = p["preferred"] = True
            st_["signed"] = school
            recruiting._event(state, "signed", pid, school, walk_on=True)
        team["roster"].append(p)
        e["signed"] = school
        portal["moves"].append({"id": pid, "name": p["n"], "pos": p["pos"], "from": e["from"], "to": school,
                                "overall": house(p["pos"], p["o"]), "round": rc.get("week", PORTAL_WEEKS_DONE), "walk_on": bool(p.get("walk_on"))})
    off["portal_recruiting"] = {"reports": rc.get("reports") or [], "log": rc.get("log") or []}
    if state.get("recruiting_last"):
        state["recruiting"] = state.pop("recruiting_last")
        recruiting.reset_caches()


PORTAL_WEEKS_DONE = 4
PORTAL_BOARD = 20                 # entrants your staff puts on your board when the portal opens


# ----- development ------------------------------------------------------------------------------

def program_factor(slug: str) -> float:
    """A program's own pull on development (facilities, staff size, strength and conditioning): its
    recruiting baseline, about -2 to +2, at PROGRAM_DEV a point."""
    from coach_career import recruiting
    b = recruiting._baseline(slug)
    return 1 + (PROGRAM_DEV if b > 0 else PROGRAM_DEV_BELOW) * b


def coach_factor(coaches: dict, pos: str) -> float:
    """His coaches' factor on development: the head coach's player development with the
    coordinator on his side of the ball; about 0.8 at 30, 1.0 at 50, 1.2 at 90."""
    hc = (coaches.get("head_coach") or {}).get("ratings", {}).get("player_development", 50)
    side = "offensive_coordinator" if pos in lg.OFFENSE_ROLES else "defensive_coordinator" if GROUP[pos] not in ("K", "P") else "head_coach"
    co = (coaches.get(side) or {}).get("ratings", {}).get("player_development", hc)
    r = (1 - COORD_SHARE) * hc + COORD_SHARE * co
    return 1 + (r - 50) / 200 if r >= 50 else 1 + (r - 50) / 100


def develop(p: dict, attrs: list[str], factor: float, rng: random.Random) -> int:
    """One offseason's growth on our scale: each skill closes part of its gap to potential at his
    coachability's rate times `factor`; his overall follows (our formula). Returns the overall gained."""
    rate = recruits.RATE.get(p.get("c"), 0.27) * factor * DEV_RATE * YEAR_CURVE[min(len(YEAR_CURVE) - 1, int(p.get("yrs") or 0))]
    new_r, new_g = [], []
    for v, g in zip(p["r"], p["g"]):
        step = int(round(min(g, g * rate * rng.uniform(0.8, 1.2)))) if g > 0 else 0
        new_r.append(min(99, v + step))
        new_g.append(g - step)
    before = p["o"]
    p["r"], p["g"] = new_r, new_g
    p["o"] = lg.overall(p, attrs)
    return p["o"] - before


def _develop_all(state: dict) -> dict:
    """Everyone back from last season develops; transfers too; this year's signees arrive as they are."""
    lgd = state["league"]
    rng = _rng(state, "develop")
    attrs = _attrs(lgd)
    perf = state["offseason"].get("performance") or {}
    levels = [name for name, _, _ in recruits.COACHABILITY]
    gains, mine, breakouts = [], [], 0
    for slug, t in lgd["teams"].items():
        for p in t["roster"]:
            if p.pop("signed", False):
                continue
            mult, room, why, level_up = growth_terms(perf.get(p["id"]))
            if room:                       # a big year raises his ceiling where it shows: skill and football IQ
                p["g"] = [g + room if k not in PHYSICAL else g for k, g in zip(attrs, p["g"])]
                p["g"] = [min(g, 99 - v) for g, v in zip(p["g"], p["r"])]
                breakouts += 1
            if level_up and rng.random() < LEVEL_UP and p.get("c") in levels[1:]:
                p["c"] = levels[levels.index(p["c"]) - 1]
                why.append(f"Now a {p['c']}")
            g = develop(p, attrs, coach_factor(t["coaches"], p["pos"]) * mult * program_factor(slug), rng)
            p["yrs"] = p.get("yrs", 0) + 1
            gains.append(g)
            if slug == state["team"]:
                mine.append({"id": p["id"], "name": p["n"], "pos": p["pos"], "cls": p["cls"], "gain": g, "overall": p["o"], "why": why})
    mine.sort(key=lambda r: -r["gain"])
    return {"mean_gain_ea": round(st.mean(gains), 2) if gains else 0.0, "mine": mine, "raised_ceilings": breakouts}


def _newcomer(r: dict, slug: str) -> dict:
    """A generated player (recruits.recruit, drawn by the model learned from real players) on our
    scale, in the form league.compact takes."""
    from teamdata import game_scale
    ours = game_scale.from_ea(r["ratings_ea"], r["ea_position"])
    pot = game_scale.potential_from_ea(r["potential_ea"], ours, r["ea_position"])
    return {"slug": slug, "name": r["name"], "position": r["ea_position"], "class": "FR", "height": r["height"],
            "weight_lbs": r["weight"], "archetype": r["archetype"], "dev_trait": "Normal", "ours": ours,
            "potential_ours": {k: max(v, ours.get(k, v)) for k, v in pot.items()}, "coachability": r["coachability"],
            "stars": r["stars"], "hometown": r["hometown"]}


def _preferred_walk_on(state: dict, slug: str, group: str, taken: set) -> Optional[dict]:
    """An unsigned prospect from the class who had the school on his list, at this group: the one
    it interested most (a named walk-on, not a generated one)."""
    from coach_career import recruiting
    rc = state.get("recruiting") or {}
    if rc.get("portal") or not rc.get("prospects"):
        return None
    best, best_pts = None, -1.0
    for pid, st_ in rc["status"].items():
        if st_["signed"] != "FCS" or pid in taken or slug not in rc["lists"].get(pid, {}):
            continue
        p = rc["prospects"][pid]
        if recruiting._group_of(p) != group:
            continue
        pts = rc["lists"][pid][slug]
        if pts > best_pts:
            best, best_pts = p, pts
    if best is not None:
        taken.add(best["id"])
    return best


def _fill_rosters(state: dict) -> dict:
    """Walk-ons where a group has fallen below its floor and then up to FILL_TO (the
    thinnest groups first, against a healthy roster's make-up); rosters over the limit release
    their lowest-rated non-seniors (counted as quitting)."""
    lgd = state["league"]
    rng = _rng(state, "walk-ons")
    attrs = _attrs(lgd)
    added = released = 0
    walk_ons: dict[str, list] = {}
    taken: set = set()
    from sim import season
    for slug, t in lgd["teams"].items():
        p4 = season._is_p4(slug, season.load_teams()[slug])
        counts = _group_counts(t["roster"])
        wanted = [g for g, floor in FLOOR.items() for _ in range(max(0, floor - counts[g]))]
        size = len(t["roster"]) + len(wanted)
        short = dict(counts)
        for g in wanted:
            short[g] += 1
        while size < FILL_TO:
            g = max(TARGET, key=lambda k: (TARGET[k] - short[k]) / TARGET[k])
            wanted.append(g)
            short[g] += 1
            size += 1
        for g in wanted:
            pref = _preferred_walk_on(state, slug, g, taken)
            if pref is not None:
                c = _compact_prospect(state, pref, attrs)
                c["j"] = _jersey(t["roster"], c["pos"], rng)
                c["walk_on"] = c["preferred"] = True
                t["roster"].append(c)
                added += 1
                continue
            band = "3" if rng.random() < (LOWER_LEVEL_P4 if p4 else LOWER_LEVEL) else "2"
            pool = walk_ons.setdefault((band, g), [])
            while not pool:
                r = recruits.recruit(rng, state["offseason"]["year"], band, taken)
                walk_ons.setdefault((band, GROUP.get(r["ea_position"], "S")), []).append(r)
            r = pool.pop()
            c = lg.compact(_newcomer(r, f"w{state['offseason']['year']}-{slug}-{added}"), attrs)
            c["j"] = _jersey(t["roster"], c["pos"], rng)
            if band == "3":                           # from FCS or junior college: a year or two of college behind him
                years = rng.choice((1, 2))
                for _ in range(years):
                    develop(c, attrs, 0.8, rng)
                c["cls"] = rng.choice(("SO", "SORS") if years == 1 else ("JR", "JRRS"))
                c["yrs"] = years
                c["transfer"] = "FCS"
            else:
                c["walk_on"] = True
            t["roster"].append(c)
            added += 1
        if len(t["roster"]) > ROSTER_LIMIT:
            counts = _group_counts(t["roster"])
            spare = sorted((p for p in t["roster"] if counts[GROUP[p["pos"]]] > FLOOR[GROUP[p["pos"]]] and p["cls"] not in ("SR", "SRRS")),
                           key=lambda p: p["o"])
            cut = set()
            for p in spare:
                if len(t["roster"]) - len(cut) <= ROSTER_LIMIT:
                    break
                if counts[GROUP[p["pos"]]] > FLOOR[GROUP[p["pos"]]]:
                    cut.add(p["id"])
                    counts[GROUP[p["pos"]]] -= 1
            t["roster"] = [p for p in t["roster"] if p["id"] not in cut]
            released += len(cut)
    return {"walk_ons": added, "released": released}


# ----- staff and coaches ------------------------------------------------------------------------

def _coach_pool(lgd: dict, role: str) -> list[dict]:
    return [t["coaches"][role] for t in lgd["teams"].values() if t["coaches"].get(role)]


def _new_coach(lgd: dict, role: str, slug: str, year: int, rng: random.Random, like: Optional[dict] = None) -> dict:
    """A generated coach for `role`: ratings drawn like a random coach in the league at that role
    (a little below: a first-time hire), scheme and tendencies from `like` (the program's
    predecessor) or a random coach."""
    import json
    model = rng.choice(_coach_pool(lgd, role))
    base = json.loads(json.dumps(like or model))
    ratings = {k: int(max(30, min(95, v + rng.gauss(-2, 6)))) for k, v in model["ratings"].items()}
    base.update(name=recruits._name(rng, set()), ratings=ratings, since=year, coach_id=f"{slug}:{role}:{year}",
                previous_job="Promoted from the staff", ratings_generated=True)
    return base


def _staff_changes(state: dict, poached: list[str]) -> dict:
    """Your staff: a coordinator another program hired as its head coach (the carousel), a
    recruiter who moves on now and then; each opening gets three candidates."""
    rng = _rng(state, "staff")
    staff = state["career"]["staff"]
    leaving, candidates = [], {}
    taken = {s["name"] for s in staff}
    roles = {"OC": "offensive_coordinator", "DC": "defensive_coordinator"}
    for s in staff:
        gone = roles[s["role"]] in poached if s["role"] in roles else rng.random() < RECRUITER_LEAVE
        if gone:
            leaving.append(s["id"])
            candidates[s["id"]] = [_candidate(rng, s, taken) for _ in range(3)]
    for s in staff:                       # the rest grow a little (or slip)
        if s["id"] not in leaving:
            s["evaluation"] = int(max(35, min(99, s["evaluation"] + rng.choice((-1, 0, 1, 1, 2)))))
            s["recruiting"] = int(max(35, min(99, s["recruiting"] + rng.choice((-1, 0, 1, 1, 2)))))
    return {"leaving": leaving, "candidates": candidates, "hired": {}}


def _candidate(rng: random.Random, s: dict, taken: set) -> dict:
    name = recruits._name(rng, taken)
    taken.add(name)
    return {"name": name, "role": s["role"], "evaluation": int(max(40, min(92, rng.gauss(64, 10)))),
            "recruiting": int(max(40, min(92, rng.gauss(64, 10))))}


def hire(state: dict, staff_id: str, index: int) -> dict:
    off = state["offseason"]
    staff = off["staff"]
    if not staff or staff_id not in staff["candidates"]:
        raise ValueError("no opening for that staff member")
    cands = staff["candidates"][staff_id]
    if not 0 <= index < len(cands):
        raise ValueError("no such candidate")
    staff["hired"][staff_id] = index
    return staff


def _apply_staff(state: dict) -> list[dict]:
    """Openings are filled: your pick, else the best candidate (Auto)."""
    staff, off = state["career"]["staff"], state["offseason"]["staff"]
    out = []
    coaches = state["league"]["teams"][state["team"]]["coaches"]
    for s in staff:
        if s["id"] not in off["leaving"]:
            continue
        cands = off["candidates"][s["id"]]
        i = off["hired"].get(s["id"])
        if i is None:
            i = max(range(len(cands)), key=lambda j: cands[j]["evaluation"] + cands[j]["recruiting"])
        c = cands[i]
        out.append({"role": s["role"], "old": s["name"], "new": c["name"]})
        s.update(name=c["name"], evaluation=c["evaluation"], recruiting=c["recruiting"])
        key = {"OC": "offensive_coordinator", "DC": "defensive_coordinator"}.get(s["role"])
        if key and coaches.get(key):
            coaches[key]["name"] = c["name"]
            coaches[key]["ratings"]["player_development"] = c["evaluation"]
            coaches[key]["ratings"]["recruiting"] = c["recruiting"]
    return out


def choose_job(state: dict, slug: Optional[str]) -> dict:
    """Take a job offer (or, fired, an opening); None stays (or lets Auto pick the best opening)."""
    off = state.get("offseason") or {}
    car = off.get("carousel")
    if off.get("stage") != "staff" or not car:
        raise ValueError("no jobs to decide on now")
    if slug is not None and slug not in car["offers"] + car["openings"]:
        raise ValueError("that job is not open to you")
    car["choice"] = slug
    return car


def _take_job(state: dict, slug: str) -> None:
    """You leave for `slug` next season: you take its head coaching job (your coordinators and
    recruiters follow only as far as your recruiters do); your old program hires a new coach."""
    from coach_career import carousel
    lgd = state["league"]
    me = state["team"]
    year = state["offseason"]["year"]
    rng = _rng(state, "move")
    mine = lgd["teams"][me]["coaches"]["head_coach"]
    lgd["teams"][slug]["coaches"]["head_coach"] = dict(mine, since=year)
    lgd["teams"][me]["coaches"]["head_coach"] = carousel.generated(rng, lgd, "head_coach", me, year, level=2 * carousel.baseline(me))
    lgd["teams"][slug]["style"] = lgd["teams"][me].get("style", me)          # you bring your way of playing
    lgd["teams"][me]["style"] = carousel.new_style(rng, lgd, me)
    for s in (slug, me):
        carousel.ad(lgd["teams"][s], s)["security"] = carousel.START_SECURITY
    state["offseason"]["move_to"] = slug
    state["offseason"]["coaching_changes"].append({"team": slug, "role": "head_coach", "new": "You", "reason": "hired",
                                                   "from": f"head coach at {lg.base_team(me)['short_name']}"})


# ----- walking the stages -----------------------------------------------------------------------

def advance(state: dict) -> dict:
    """Finish the current stage and open the next one."""
    off = state["offseason"]
    stage = off["stage"]
    from coach_career import recruiting
    if stage == "departures":
        off["stage"] = "portal_w1" if recruiting.is_portal(state) else "portal_1"
    elif stage in PORTAL_STAGES:
        week = PORTAL_STAGES.index(stage) + 1
        recruiting.weekly_step(state, week, auto_user=bool(off.get("auto")))
        if week < len(PORTAL_STAGES):
            state["recruiting"]["week"] = week + 1
            off["stage"] = PORTAL_STAGES[week]
        else:
            _close_portal(state)
            off["report"] = {"development": _develop_all(state), **_fill_rosters(state)}
            off["stage"] = "development"
    elif stage == "portal_1":
        resolve_round(state)
        off["portal"]["round"] = 2
        off["stage"] = "portal_2"
    elif stage == "portal_2":
        resolve_round(state)
        _close_portal_rounds(state)
        off["report"] = {"development": _develop_all(state), **_fill_rosters(state)}
        off["stage"] = "development"
    elif stage == "development":
        from coach_career import carousel
        car = carousel.run(state)
        off["carousel"] = car
        off["coaching_changes"] = car["changes"]
        off["staff"] = _staff_changes(state, car["poached"])
        off["stage"] = "staff"
    elif stage == "staff":
        off["staff"]["changes"] = _apply_staff(state)
        car = off.get("carousel") or {}
        choice = car.get("choice") or ((car.get("openings") or [None])[0] if (car.get("you") or {}).get("fired") else None)
        if choice:
            _take_job(state, choice)
        off["stage"] = "ready"
    return off


def run_all(state: dict) -> None:
    """Every remaining stage on Auto (the portal weeks recruited by your staff)."""
    start(state)
    state["offseason"]["auto"] = True
    while state["offseason"]["stage"] != "ready":
        advance(state)


# ----- the next season --------------------------------------------------------------------------

def summary(state: dict) -> dict:
    """The season just finished, for the career's history."""
    from sim import season
    me = state["team"]
    wins, losses = _record(state, me)
    final = state["polls"].get(str(season.FINAL_WEEK)) or state["polls"].get(str(max(int(w) for w in state["polls"])), {})
    rank = next((e["rank"] for e in final.get("ap", []) if e["team"] == me), None)
    aw = state.get("awards") or {}
    top = (((aw.get("national") or {}).get("heisman") or {}).get("candidates") or [None])[0] or {}
    out = {"year": season.season_year(state), "wins": wins, "losses": losses, "ap_rank": rank,
           "champion": state.get("champion"), "won_title": state.get("champion") == me,
           "conference_champion": state.get("champions", {}).get(state["conference"]) == me,
           "heisman": {"name": top.get("name"), "team": top.get("team")} if top.get("name") else None}
    rc = state.get("recruiting")
    if rc:
        from coach_career import prospects
        out["class_rank"] = prospects.class_rank(state, me)
        out["signed"] = sum(1 for s in rc["status"].values() if s.get("signed") == me)
    off = state.get("offseason") or {}
    out["drafted"] = sum(1 for d in off.get("departures", []) if d["team"] == me and d.get("kind") == "draft")
    return out


def next_season(state: dict) -> dict:
    """The next season's state for this career: same id, the league as the offseason left it,
    the career (staff, settings, history) carried over, a new class of high school seniors."""
    from coach_career import career as career_mod
    from coach_career import recruiting
    from sim import season
    off = state["offseason"]
    if off["stage"] != "ready":
        raise ValueError("the offseason is not finished")
    year = off["year"]
    lgd = state["league"]
    lgd["year"] = year
    season.use_league(lg.ensure_built({"id": state["id"], "league": lgd, "year": year}))
    teams = season.load_teams()
    # every program's last three records, for the coaching carousel
    records = state["career"].setdefault("league_records", {})
    for slug in lgd["teams"]:
        records.setdefault(slug, []).append(list(_record(state, slug)))
        records[slug] = records[slug][-3:]
    history = state["career"].setdefault("history", [])
    history.append(summary(state))
    team = off.get("move_to") or state["team"]
    new = season.new_season(team, "full", seed=_rng(state, "seed").randrange(1 << 30), coach=state.get("coach"), year=year)
    new.update(id=state["id"], created_at=state["created_at"], league=lgd, settings=state.get("settings", new["settings"]))
    car = state["career"]
    car["year"] = year
    car["saved_week"] = 0
    car["saved_at"] = career_mod._now()
    settings = car.setdefault("settings", {})
    if settings.get("auto_recruit") == "week":
        settings["auto_recruit"] = "off"
    new["career"] = car
    if off.get("move_to"):                 # a new school: its coordinators join your staff, your recruiters come along
        coaches = lgd["teams"][team]["coaches"]
        for s in car["staff"]:
            key = {"OC": "offensive_coordinator", "DC": "defensive_coordinator"}.get(s["role"])
            c = coaches.get(key) if key else None
            if c:
                r = c.get("ratings") or {}
                s.update(name=c.get("name") or s["name"], evaluation=int(r.get("player_development", 60)), recruiting=int(r.get("recruiting", 60)))
        history[-1]["moved_to"] = team
        car.setdefault("schools", []).append({"team": team, "from": year})
    new.pop("recruiting_last", None)
    recruiting.start(new, year=year + 1)
    from coach_career import prospects
    prospects.reset_caches()
    old = lg.path(state["id"], year - 1)
    if old.exists():
        try:
            old.unlink()
        except OSError:
            pass
    return new


# ----- what the page shows ----------------------------------------------------------------------

KIND_NAMES = {"draft": "Drafted", "undrafted": "Declared, undrafted", "graduated": "Graduated", "portal": "Transfer portal",
              "quit": "Left the team"}
PT_NAMES = {1.0: "Would start", 0.5: "Next in line", 0.15: "Depth"}


def portal_offer(state: dict, pid: str, on: bool) -> list[str]:
    """Offer a portal player a spot (or take it back) for the round being played."""
    off = state.get("offseason") or {}
    from coach_career import recruiting
    if off.get("stage") in PORTAL_STAGES:            # the portal is recruited on the board: an offer with a pitch
        p = state["recruiting"]["prospects"][pid]
        recruiting.act(state, state["team"], pid, "offer" if on else "pull_offer", pitch=p["priorities"][0] if on else None,
                       nil=recruiting.ask_from(state, state["team"], pid) if on else 0)
        return list(state["recruiting"]["offers"].get(state["team"], []))
    if off.get("stage") not in ("portal_1", "portal_2"):
        raise ValueError("the portal is not open")
    e = off["portal"]["players"].get(pid)
    if e is None:
        raise KeyError(pid)
    me = state["team"]
    mine = off["portal"]["offers"].setdefault(me, [])
    if on:
        if e["signed"]:
            raise ValueError("he has already picked a school")
        if pid not in mine:
            if len(mine) >= max(1, math.ceil(PORTAL_OFFER_FACTOR * my_spots(state["league"], me, off["portal"]))):
                raise OverflowError("no offers left this round")
            mine.append(pid)
    elif pid in mine:
        mine.remove(pid)
    return mine


def recruiting_spots(state: dict, slug: str) -> int:
    from coach_career import recruiting
    return recruiting.portal_spots(state, slug)


def recruiting_offer_cap(state: dict, slug: str) -> int:
    from coach_career import recruiting
    return recruiting.offer_cap(state, slug)


def portal_rows(state: dict, position: Optional[str] = None, status: Optional[str] = None, limit: int = 100) -> list[dict]:
    off = state["offseason"]
    lgd, portal, me = state["league"], off["portal"], state["team"]
    mine = set(portal["offers"].get(me, []))
    rows = []
    for pid, e in portal["players"].items():
        p = e["player"]
        if position and GROUP[p["pos"]] != position and p["pos"] != position:
            continue
        if status == "offered" and pid not in mine:
            continue
        if status == "available" and e["signed"]:
            continue
        if status == "signed" and not e["signed"]:
            continue
        pt = playing_time(lgd, me, p)
        rows.append({"id": pid, "name": p["n"], "pos": p["pos"], "group": GROUP[p["pos"]], "cls": p["cls"],
                     "overall": house(p["pos"], p["o"]), "stars": p.get("s"), "from": e["from"], "from_name": e["from_name"],
                     "last_year": e.get("usage"), "home": p.get("home"), "fit": PT_NAMES[pt], "offered": pid in mine,
                     "signed": e["signed"], "signed_name": lg.base_team(e["signed"])["short_name"] if e["signed"] else None,
                     "offers": len(e["offers"])})
    rows.sort(key=lambda r: (bool(r["signed"]), -r["overall"]))
    return rows[:limit]


def view(state: dict, position: Optional[str] = None, status: Optional[str] = None) -> dict:
    """The Offseason screen: where the offseason stands and what it means for your program."""
    off = state["offseason"]
    me = state["team"]
    lgd = state["league"]
    deps = off["departures"]
    kinds: dict[str, int] = {}
    for d in deps:
        kinds[d["kind"]] = kinds.get(d["kind"], 0) + 1
    portal = off["portal"]
    rc = state.get("recruiting") or {}
    new_portal = bool(rc.get("portal"))
    my_moves = [m for m in portal["moves"] if m["to"] == me or m["from"] == me]
    if new_portal:
        for pid, st_ in rc["status"].items():
            e = portal["players"][pid]
            if st_["signed"] and (st_["signed"] == me or e["from"] == me):
                p = e["player"]
                my_moves.append({"id": pid, "name": p["n"], "pos": p["pos"], "from": e["from"], "to": st_["signed"],
                                 "overall": house(p["pos"], p["o"]), "round": rc.get("week")})
    staff = off.get("staff")
    cur = OLD_PORTAL.get(off["stage"], off["stage"])
    out = {
        "stage": off["stage"], "stage_name": STAGE_NAMES[off["stage"]], "year": off["year"],
        "stages": [{"key": s, "name": STAGE_NAMES[s], "done": STAGES.index(s) < STAGES.index(cur),
                    "current": s == cur} for s in STAGES],
        "departures": {"mine": [dict(d, kind_name=KIND_NAMES[d["kind"]]) for d in deps if d["team"] == me],
                       "league": kinds, "first_round": [d for d in sorted((d for d in deps if d["kind"] == "draft"), key=lambda d: d["pick"])][:32],
                       "early_entrants": sum(1 for d in deps if d.get("early"))},
        "signed": off.get("signed", {}).get(me, 0),
        "roster": len(lgd["teams"][me]["roster"]), "roster_limit": ROSTER_LIMIT,
        "open_spots": recruiting_spots(state, me) if new_portal else open_spots(lgd, me, portal),
        "release_spots": 0 if new_portal else churn_left(portal, me),
        "portal": {"round": rc.get("week") if new_portal else portal["round"], "week": rc.get("week") if new_portal else None,
                   "weeks": len(PORTAL_STAGES), "entrants": len(portal["players"]),
                   "signed": sum(1 for st_ in rc["status"].values() if st_["signed"]) if new_portal
                   else sum(1 for e in portal["players"].values() if e["signed"]),
                   "offers": list(rc["offers"].get(me, [])) if new_portal else list(portal["offers"].get(me, [])),
                   "offers_left": (max(0, recruiting_offer_cap(state, me) - len(rc["offers"].get(me, []))) if new_portal
                                   else max(0, math.ceil(PORTAL_OFFER_FACTOR * my_spots(lgd, me, portal)) - len(portal["offers"].get(me, [])))),
                   "moves_mine": my_moves,
                   "rows": portal_rows(state, position, status) if off["stage"] in ("portal_1", "portal_2") else []},
        "report": off.get("report") and {"mine": off["report"]["development"]["mine"][:25],
                                         "mean_gain_ea": off["report"]["development"]["mean_gain_ea"],
                                         "walk_ons": off["report"]["walk_ons"]},
        "staff": None,
        "coaching_changes": [c for c in off.get("coaching_changes", []) if c["role"] == "head_coach"][:60],
        "history": (state.get("career") or {}).get("history", []),
    }
    car = off.get("carousel")
    if car:
        from coach_career import carousel
        out["job"] = {"you": car.get("you") or {}, "offers": carousel.job_rows(state, car["offers"]),
                      "openings": carousel.job_rows(state, car["openings"]), "choice": car.get("choice"),
                      "moving_to": off.get("move_to")}
    if staff:
        by_id = {s["id"]: s for s in state["career"]["staff"]}
        out["staff"] = {"leaving": [by_id[i] for i in staff["leaving"] if i in by_id], "candidates": staff["candidates"],
                        "hired": staff["hired"], "changes": staff.get("changes", [])}
    return out
